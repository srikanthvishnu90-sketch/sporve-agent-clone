/* ═══════════════════════════════════════════════════════════════════════
   slop-audit.js — the enforcement instrument (owner spec, 2026-08-14).

   WHY THIS IS A BROWSER FUNCTION AND NOT A GREP: every product page renders
   from template literals, so its markup exists only in a live DOM. A static
   scan of the source sees `${...}` soup and nothing else — the same trap
   CLAUDE.md rule 1 documents for production verification. This file is
   therefore injected into the BUILT page by src/smoke.sh (and by any future
   runner) and evaluated per route; .github/workflows/pr-checks.yml runs
   smoke on every PR, which is what wires this into CI.

   THE RULES, and their standing relative to the spec:
   A. ICONS — FAILS. An <svg> inside page content that is not functional
      chrome is a violation. The allowlist, each item justified:
        · svg inside button/a/nav/label/input/select — functional controls:
          close/back glyphs, the search bar's field icons, toggles.
        · .sbc-mark — the verified-badge-with-date pill on trust (the one
          icon the spec names as REQUIRED to stay).
        · .trust-badge svg — same badge where it appears inline on cards.
   B. COPY DEPTH — WARNS, does not fail. The spec's 40–80-word floor
      contradicts the standing house law (card bodies ≤16 words, ≤180 words
      per page, owner-ratified in the anti-slop constitution) and its own
      8-word exemplar sentence. Until the owner adjudicates which law wins,
      this rule reports drift (body <30 or >100 words; siblings >2x apart)
      without blocking a PR on it.
   C. STRUCTURE — FAILS. A declared n-column grid whose visible children
      cannot fill its first row is a stranded-slot layout.
   D. EMOJI — FAILS. Any emoji codepoint in rendered text.
   E. .psdot — WARNS. A CSS dot beside a heading is named a violation by the
      spec's prose but invisible to its svg-only detector. It is slate, so
      it is legal under colour law; counted and surfaced for a ruling.

   Returns {fail:{icons,grids,emoji}, warn:{copy,psdot}} — arrays of
   human-readable strings, each carrying enough of a selector path to find
   the node again.
   ═══════════════════════════════════════════════════════════════════════ */
window.SLOP_AUDIT = function (root) {
  const scope = root || document.querySelector("#app main") || document.getElementById("app") || document.body;
  const out = { fail: { icons: [], grids: [], emoji: [] }, warn: { copy: [], psdot: [] } };

  const path = (el) => {
    const bits = [];
    for (let n = el; n && n.id !== "app" && bits.length < 4; n = n.parentElement) {
      bits.unshift(n.tagName.toLowerCase() +
        (typeof n.className === "string" && n.className ? "." + n.className.split(" ")[0] : ""));
    }
    return bits.join(">");
  };
  const words = (t) => String(t || "").trim().split(/\s+/).filter(Boolean).length;
  const visible = (el) => !!el.offsetParent || getComputedStyle(el).position === "fixed";

  /* A — icons. Functional-chrome ancestors and the allowlisted marks:
     .sbc-mark and .trust-badge are the verified-badge-with-date; .sf-badge
     rows on trust carry the SAME badge pills as a state legend ("this is
     what Background-checked / Verification pending look like") — the badge
     the spec's allowlist item #1 requires to keep. */
  scope.querySelectorAll("svg").forEach((svg) => {
    if (!visible(svg.parentElement || svg)) return;
    if (svg.closest("button,a,nav,label,input,select,.sbc-mark,.trust-badge,.sf-badge")) return;
    out.fail.icons.push(path(svg.parentElement || svg));
  });

  /* C — grids with an unfillable first row. */
  scope.querySelectorAll("*").forEach((el) => {
    if (!visible(el)) return;
    const cs = getComputedStyle(el);
    if (cs.display !== "grid") return;
    const cols = cs.gridTemplateColumns.split(" ").filter((c) => c && c !== "0px").length;
    if (cols < 2) return;
    const kids = [...el.children].filter(visible).length;
    if (kids > 0 && kids < cols) out.fail.grids.push(path(el) + " (" + kids + " children in " + cols + " columns)");
  });

  /* D — emoji codepoints in rendered text. */
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
  if (EMOJI.test(scope.innerText || "")) {
    const m = (scope.innerText.match(new RegExp(EMOJI, "gu")) || []).length;
    out.fail.emoji.push(m + " emoji codepoint(s) in rendered text");
  }

  /* B — copy depth over definition-style items (warn only, see header). */
  const ITEMS = scope.querySelectorAll(".pg-rproof, .defrow, .deflist > *");
  const bySection = new Map();
  ITEMS.forEach((it) => {
    if (!visible(it)) return;
    const w = words(it.innerText);
    if (w && (w < 30 || w > 100)) out.warn.copy.push(path(it) + " (" + w + " words)");
    const sec = it.closest("section,.band") || scope;
    if (!bySection.has(sec)) bySection.set(sec, []);
    bySection.get(sec).push(w);
  });
  bySection.forEach((ws, sec) => {
    const nz = ws.filter(Boolean);
    if (nz.length > 1 && Math.max(...nz) > 2 * Math.min(...nz)) {
      out.warn.copy.push(path(sec) + " (siblings " + Math.min(...nz) + "–" + Math.max(...nz) + " words, >2x)");
    }
  });

  /* E — the CSS dots the spec's svg detector cannot see. */
  out.warn.psdot = [...scope.querySelectorAll(".psdot")].filter(visible).map(path);

  return out;
};
