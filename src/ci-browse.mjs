#!/usr/bin/env node
/* A minimal stand-in for gstack's `browse`, so smoke.sh's browser checks can
 * run in CI.
 *
 * Why this exists: `smoke.sh` shells out to a binary under ~/.claude/skills/,
 * which does not exist on a GitHub runner. The script detected that and exited
 * 0, so `pr-checks` reported a green tick while running 3 of its 25 assertions.
 * Every PR merged under that tick was effectively unreviewed by CI.
 *
 * The load-bearing design constraint is STATE PERSISTENCE. smoke.sh sets
 * `S.route` in one invocation and reads the resulting DOM in the next, so a
 * process that launches a browser per command would lose everything between
 * them. This therefore runs as a daemon holding a single page, with the CLI
 * acting as a thin client over loopback HTTP.
 *
 * Only the six subcommands smoke.sh actually uses are implemented:
 *   serve | goto <url> | js <expr> | eval <file> | viewport <WxH>
 *   console --errors | console --clear | stop
 *
 * Output format matches gstack's where smoke.sh depends on it: strings print
 * raw (unquoted), everything else prints as JSON, and console errors print as
 * `[error] ...` lines — smoke greps for that prefix and for the substring
 * "Failed to load resource".
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const PORT_FILE = path.join(process.cwd(), ".ci-browse-port");
const [cmd, ...args] = process.argv.slice(2);

/* ── daemon ─────────────────────────────────────────────────────────── */
async function serve() {
  const { chromium } = await import("playwright");
  /* Default launch — the headless shell that `playwright install chromium`
     provides. --allow-file-access-from-files is required because smoke.sh
     loads the built page over file:// and the page reads its own inlined
     resources. */
  const browser = await chromium.launch({
    /* --font-render-hinting=none: on Linux, FreeType hinting rounds glyph
       advances up to integers, inflating rendered text ~2-4% versus the
       fractional metrics macOS uses. That was enough to wrap several product
       h1s one line wider in CI than anywhere else, failing the ≤5-line and
       45vh hero laws for layouts that are correct on every real platform the
       design targets. Disabling hinting gives fractional advances and brings
       CI's text layout in line with the metrics the design was tuned against. */
    args: ["--allow-file-access-from-files", "--font-render-hinting=none"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  /* One buffer, drained by `console --clear`. Both genuine console errors and
     failed subresource loads land here, because smoke distinguishes them by
     message text rather than by channel. */
  let errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[error] ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`[error] ${e.message}`));
  page.on("requestfailed", (r) =>
    errors.push(`[error] Failed to load resource: ${r.url()}`)
  );

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      let out = "";
      try {
        const { op, arg } = JSON.parse(raw || "{}");
        if (op === "goto") {
          await page.goto(arg, { waitUntil: "load" });
          /* The built page embeds its fonts as data: URIs and loads each face
             LAZILY on first use. The per-page accent faces (Archivo, Syne,
             Hanken Grotesk) are first used only after smoke's js snippets call
             render() for a product page — and those snippets measure line
             counts and hero heights synchronously, so in CI they measured the
             fallback serif and headlines wrapped 6–7 lines where the real
             faces wrap ≤5 (deterministic FAIL; local daemons pass on platform
             timing). Force EVERY declared face to decode now, so later
             render()+measure cycles see final metrics. */
          await page.evaluate(async () => {
            await Promise.all([...document.fonts].map((f) => f.load()));
            await document.fonts.ready;
          });
          out = "ok";
        } else if (op === "viewport") {
          const [w, h] = String(arg).split("x").map(Number);
          await page.setViewportSize({ width: w, height: h });
          out = "ok";
        } else if (op === "js") {
          /* eval, deliberately. smoke.sh passes multi-statement programs
             ("S.portal='coach';render();'ok'"), and the gstack tool returns the
             program's completion value — the last expression — which is exactly
             eval's semantics. Wrapping in `return (...)` instead makes those
             semicolons a syntax error, so every state-setting call fails
             silently and later assertions measure the wrong page. That is not
             hypothetical: it is what this file did on its first CI run.
             Safe here because smoke drives a file:// page with no CSP. */
          const v = await page.evaluate((c) => eval(c), arg);
          out = typeof v === "string" ? v : JSON.stringify(v);
        } else if (op === "eval") {
          const src = fs.readFileSync(arg, "utf8");
          const v = await page.evaluate(src);
          out = typeof v === "string" ? v : JSON.stringify(v);
        } else if (op === "errors") {
          out = errors.join("\n");
        } else if (op === "clear") {
          errors = [];
          out = "ok";
        } else if (op === "stop") {
          res.end("ok");
          server.close();
          await browser.close();
          try { fs.unlinkSync(PORT_FILE); } catch {}
          process.exit(0);
        } else {
          out = `unknown op: ${op}`;
        }
      } catch (e) {
        /* An evaluate() that throws is a real signal — surface it in the same
           shape a page error would take, so smoke's grep still sees it. */
        out = `[error] ${e.message}`;
      }
      res.end(out);
    });
  });

  server.listen(0, "127.0.0.1", () => {
    fs.writeFileSync(PORT_FILE, String(server.address().port));
    process.stdout.write(`ci-browse listening on ${server.address().port}\n`);
  });
}

/* ── client ─────────────────────────────────────────────────────────── */
function call(op, arg) {
  if (!fs.existsSync(PORT_FILE)) {
    process.stderr.write("ci-browse: daemon not running\n");
    process.exit(2);
  }
  const port = Number(fs.readFileSync(PORT_FILE, "utf8").trim());
  const body = JSON.stringify({ op, arg });
  const req = http.request(
    { host: "127.0.0.1", port, method: "POST", headers: { "content-length": Buffer.byteLength(body) } },
    (res) => {
      let out = "";
      res.on("data", (c) => (out += c));
      res.on("end", () => process.stdout.write(out + "\n"));
    }
  );
  req.on("error", (e) => {
    process.stderr.write(`ci-browse: ${e.message}\n`);
    process.exit(2);
  });
  req.end(body);
}

if (cmd === "serve") {
  await serve();
} else if (cmd === "console") {
  call(args[0] === "--clear" ? "clear" : "errors");
} else if (["goto", "js", "eval", "viewport", "stop"].includes(cmd)) {
  call(cmd, args.join(" "));
} else {
  process.stderr.write(`ci-browse: unsupported command '${cmd}'\n`);
  process.exit(2);
}
