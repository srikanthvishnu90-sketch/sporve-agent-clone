import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
let assertions = 0;
const check = (condition, message) => {
  assertions += 1;
  assert.ok(condition, message);
};

const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
const lockRoot = lock.packages?.[""] || {};
assertions += 2;
assert.deepEqual(lockRoot.dependencies || {}, pkg.dependencies || {},
  "package-lock root dependencies must match package.json");
assert.deepEqual(lockRoot.devDependencies || {}, pkg.devDependencies || {},
  "package-lock root devDependencies must match package.json");

const product = read("PRODUCT.md");
for (const heading of ["## Register", "## Users", "## Product Purpose",
  "## Brand Personality", "## Anti-references", "## Design Principles",
  "## Accessibility & Inclusion"]) {
  check(product.includes(heading), `PRODUCT.md is missing ${heading}`);
}
check(!product.includes("communication,so"), "PRODUCT.md contains the known sentence corruption");
check(product.includes("Sporv is a two-sided youth-sports marketplace"),
  "PRODUCT.md must use the current visible brand name");

const readme = read("README.md");
for (const retired of ["No build step", "picsum.photos", "Miami, FL",
  "Typography is Arial", "Thirty listings across six businesses",
  "Same product, same data, same functionality"]) {
  check(!readme.includes(retired), `README still contains retired claim: ${retired}`);
}
for (const current of ["python3 src/build.py", "./src/smoke.sh", "Chicagoland",
  "same-origin `/api/ai`", "deterministic sample catalogue"]) {
  check(readme.includes(current), `README is missing current architecture fact: ${current}`);
}

const index = read("index.html");
for (const token of ["<!--MODULES-->", "/*__FONTFACE__*/", "/*__SPORTVARS__*/",
  "__SPORVE_BODY__", "__HERO_IMGS__"]) {
  check(!index.includes(token), `generated index contains unresolved token ${token}`);
}
check((index.match(/<meta name="sporve-build" content="[a-f0-9]{16}">/g) || []).length === 1,
  "generated index must contain exactly one build stamp");
check(index.includes("<title>Sporv — Every sport. One app.</title>"),
  "generated document title must use Sporv");

const modules = fs.readdirSync(path.join(root, "src"))
  .filter((name) => /^mod-.*\.js$/.test(name)).sort();
for (const name of modules) {
  const marker = `/* ---- ${name} ---- */`;
  check(index.split(marker).length - 1 === 1,
    `${name} must be inlined exactly once into index.html`);
}

const scriptBodies = [...index.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1]);
check(scriptBodies.length > modules.length,
  "generated index must include host scripts as well as every feature module");
const expectedHashes = scriptBodies.map((body) =>
  `'sha256-${crypto.createHash("sha256").update(body, "utf8").digest("base64")}'`);

const vercel = JSON.parse(read("vercel.json"));
const allHeaders = (vercel.headers || []).flatMap((rule) => rule.headers || []);
const cspHeaders = allHeaders.filter((header) =>
  String(header.key).toLowerCase() === "content-security-policy");
check(cspHeaders.length === 1, "vercel.json must define exactly one CSP header");
const csp = cspHeaders[0]?.value || "";
const directive = csp.match(/(?:^|;\s*)script-src ([^;]*);/);
check(Boolean(directive), "CSP must contain script-src");
const actualHashes = (directive?.[1].match(/'sha256-[^']+'/g) || []);
assertions += 1;
assert.deepEqual(actualHashes, expectedHashes,
  "CSP script hashes must exactly match the generated inline script bodies");
check(!directive?.[1].includes("'unsafe-inline'"),
  "script-src must not permit unsafe-inline");
for (const [key, value] of [
  ["X-Frame-Options", "DENY"],
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Cross-Origin-Opener-Policy", "same-origin"],
  ["Cross-Origin-Resource-Policy", "same-origin"],
]) {
  check(allHeaders.some((header) => header.key === key && header.value === value),
    `vercel.json is missing ${key}: ${value}`);
}

const rabbit = read(".coderabbit.yaml");
check(rabbit.startsWith("# yaml-language-server: $schema="),
  ".coderabbit.yaml must advertise its schema to editors and validators");
check(rabbit.includes('- "tools/**"'), "CodeRabbit must review operator tooling");
check(rabbit.includes('- "!package-lock.json"'),
  "CodeRabbit must exclude the generated dependency lock from prose review");

const productPages = read("src/mod-productpages.js");
for (const retired of ["published intensity", "varsity-intensity",
  "Pending supply stays outside bookable search and map results",
  "personal-check and live-availability rules that protect ordinary search",
  "demo listings in the seeded catalogue"]) {
  check(!productPages.includes(retired),
    `product-page copy still contains an unsupported claim: ${retired}`);
}

console.log(`repo contract: ${assertions} assertions passed`);
