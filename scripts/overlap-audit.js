/* ═══════════════════════════════════════════════════════════════════════
   overlap-audit.js — text-collision auditor (owner spec, 2026-08-16).

   Injected into the BUILT page by src/smoke.sh and evaluated per route — the
   same mechanism as scripts/slop-audit.js, because these pages render from
   template literals and a static scan can't see a rendered box. smoke.sh runs
   on every PR via .github/workflows/pr-checks.yml, which is what wires this
   into CI.

   THE FAIL is deliberately the ONE deterministic, zero-false-positive class the
   spec leads with (STEP 0.4): two absolutely-positioned SIBLINGS anchored to the
   same corner of the same container whose boxes actually overlap — the exact
   Demo-chip-vs-sport-tag bug. The spec's general "any cross-component bbox
   intersection > 2px" sweep is intentionally NOT the fail here: on this page a
   full-cover `inset:0` open-button overlay and every designed backdrop trip it,
   so it is a false-positive machine until it carries a curated allowlist (a
   later slice). A designed ancestor-cover (an element the size of its parent —
   the tap overlay, a scrim) is excluded here.

   STEP 0.3 clipped-text is reported as an advisory (warn), not a fail, because
   this repo has no confirmed live instance and the check is prone to noise on
   nested layouts.

   Returns {fail:{sameCorner:[...]}, warn:{clipped:[...]}}.
   ═══════════════════════════════════════════════════════════════════════ */
window.OVERLAP_AUDIT = function (root) {
  const scope = root || document.querySelector("#app") || document.body;
  const out = { fail: { sameCorner: [] }, warn: { clipped: [] } };

  const visible = (el) => !!el.offsetParent || getComputedStyle(el).position === "fixed";
  const path = (el) => {
    const bits = [];
    for (let n = el; n && n.id !== "app" && bits.length < 4; n = n.parentElement) {
      bits.unshift(n.tagName.toLowerCase() +
        (typeof n.className === "string" && n.className ? "." + n.className.split(" ")[0] : ""));
    }
    return bits.join(">");
  };
  // An element that covers its parent (± 2px both axes) is a designed
  // ancestor-cover — the full-bleed tap overlay, a scrim — not a colliding chip.
  const coversParent = (el, parent) => {
    const r = el.getBoundingClientRect(), pr = parent.getBoundingClientRect();
    return Math.abs(r.width - pr.width) < 3 && Math.abs(r.height - pr.height) < 3;
  };

  scope.querySelectorAll("*").forEach((parent) => {
    const abs = [...parent.children].filter(
      (c) => visible(c) && getComputedStyle(c).position === "absolute" && !coversParent(c, parent));
    for (let i = 0; i < abs.length; i++) {
      for (let j = i + 1; j < abs.length; j++) {
        const a = abs[i].getBoundingClientRect(), b = abs[j].getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox <= 2 || oy <= 2) continue;
        // "SAME CORNER" (STEP 0.4) = the pair starts at the SAME anchor point —
        // stacked — which is the chip-collision bug. Elements that overlap at
        // DIFFERENT anchors are data-positioned (map pins placed by lat/long,
        // a cluster of markers), not a CSS stacking defect, and are excluded.
        const sameAnchor = Math.abs(abs[i].offsetTop - abs[j].offsetTop) < 4 &&
                           Math.abs(abs[i].offsetLeft - abs[j].offsetLeft) < 4;
        if (!sameAnchor) continue;
        out.fail.sameCorner.push(
          path(parent) + " :: " + abs[i].className + " vs " + abs[j].className +
          " overlap " + Math.round(ox) + "x" + Math.round(oy) + "px");
      }
    }
  });

  // Advisory: text clipped with no intentional ellipsis.
  scope.querySelectorAll("*").forEach((el) => {
    if (!visible(el)) return;
    const cs = getComputedStyle(el);
    if (cs.overflow !== "hidden" && cs.overflowX !== "hidden") return;
    if (cs.textOverflow === "ellipsis") return;
    if (!el.textContent || !el.textContent.trim()) return;
    if ([...el.children].some((c) => c.textContent && c.textContent.trim())) return; // leaf text only
    if (el.scrollWidth > el.clientWidth + 2) out.warn.clipped.push(path(el));
  });

  return out;
};
