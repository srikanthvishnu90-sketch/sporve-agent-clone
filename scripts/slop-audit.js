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
   B. PRODUCT-PAGE COPY — FAILS outside 390–500 marked prose words. Hero
      standfirsts fail outside 50–80 words; recipe-specific block ranges are
      also enforced where length is part of the composition.
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
  const out = {
    fail: { icons: [], grids: [], emoji: [], shapes: [], pills: [], product: [], brand: [] },
    warn: { copy: [], psdot: [], pageWords: 0, fingerprint: "", accent: [] }
  };

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
    /* .pp-feats: the checkmarks on the pricing plan cards (owner 2026-08-20,
       Motion-style three-tier design) are functional list markers, not slop. */
    if (svg.closest("button,a,nav,label,input,select,.sbc-mark,.trust-badge,.sf-badge,.pp-feats,.pt-feats")) return;
    out.fail.icons.push(path(svg.parentElement || svg));
  });

  /* C — grids with an unfillable first row. */
  scope.querySelectorAll("*").forEach((el) => {
    if (!visible(el)) return;
    // Site chrome (header/nav/topbar) is functional, not page content — its
    // grids are not stranded-slot slop. Excluding it also closes a latent CI
    // flake: SLOP_AUDIT falls back to #app when "#app main" is absent, pulling
    // the topbar's 3-col shell (2 children) into scope as a false grid FAIL.
    if (el.closest("header,nav,.topbar")) return;
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

  /* B — RETUNED 2026-08-16. The owner's product-pages rebuild spec (LAW 1:
     300–500 words of real prose per page) is the third consecutive text-first
     instruction and SUPERSEDES the old ≤180-words-per-page cap for page:*
     routes — rule B's open ruling resolves as "text-first wins". The upper
     bound (>100 words per block) is deleted; thin blocks still warn, and the
     page-level floor lives in out.warn.pageWords below (promoted to FAIL once
     the prose slices land). Card copy stays terse — that law was always about
     product cards, not essays. */
  const ITEMS = scope.querySelectorAll(".pg-rproof, .defrow, .deflist > *");
  ITEMS.forEach((it) => {
    if (!visible(it)) return;
    const w = words(it.innerText);
    if (w && w < 30) out.warn.copy.push(path(it) + " (" + w + " words)");
  });

  /* G — legacy census retained for non-rebuilt marketing routes. The assigned
     product pages replace these advisory values with strict metrics below. */
  out.warn.pageWords = 0;
  out.warn.fingerprint = "";
  out.warn.accent = [];
  {
    // body prose = page text minus figures, mocks, heroes' CTA chrome
    const clone = scope.cloneNode(true);
    clone.querySelectorAll("[class*='sig-'],.pg-demo,.pg-figure,.pg-proof,.pg-stats,nav,button").forEach((n) => n.remove());
    out.warn.pageWords = words(clone.innerText);
  }
  out.warn.fingerprint = [...scope.querySelectorAll("section.pgband")].map((sec) => {
    // ground: "H" for the hero band, else the ground colour. (The old
    // .replace("pg-hero","H") then .split(" ")[0] silently dropped the H,
    // because the colour token precedes pg-hero in the class list.)
    const cls = sec.className;
    const ground = /\bpg-hero\b/.test(cls) ? "H" : (cls.replace("pgband", "").trim().split(" ")[0] || "w");
    // self-marker: .pg-figure IS the section, so querySelectorAll (descendants
    // only) could never see it — read it off the section's own class instead.
    const selfMark = /\bpg-figure\b/.test(cls) ? "pg-figure" : "";
    const inner = [selfMark, ...[...sec.querySelectorAll(".pg-rows,.pg-demo,.pg-proof,.pg-stats,.pg-founder,.db-in,.cmp,.deflist")]
      .map((e) => e.className.split(" ")[0])].filter(Boolean).join("+");
    return ground + (inner ? ":" + inner : "");
  }).join("|");
  {
    // editorial accent only — the per-page --ps voice on text, outside figures
    const chr = (c) => {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || "");
      if (!m) return 0;
      return Math.max(+m[1], +m[2], +m[3]) - Math.min(+m[1], +m[2], +m[3]);
    };
    const ps = getComputedStyle(scope.querySelector(".pgroot") || scope).getPropertyValue("--ps-ink").trim();
    if (ps) {
      scope.querySelectorAll("em,.hl,a,button.pg-textlink").forEach((el) => {
        if (!visible(el) || el.closest("[class*='sig-'],.pg-demo,.pg-figure")) return;
        const c = getComputedStyle(el).color;
        const pel = el.parentElement && getComputedStyle(el.parentElement).color;
        if (c !== pel && chr(c) > 24) out.warn.accent.push(path(el));
      });
    }
  }
  const filler = new RegExp(["built", "into", "Sporv(?:e)?"].join("\\s+"), "i");
  if (filler.test(scope.innerText || "")) {
    out.fail.pills.push("FILLER: deprecated product-page tagline in rendered text");
  }

  /* H — strict blueprint, copy and rendered-silhouette contract for the
     fourteen current product routes. [data-prose] includes explanation and
     table prose; it excludes navigation, numerals, controls and UI labels. */
  const product = scope.matches("[data-product-page]")
    ? scope : scope.querySelector("[data-product-page]");
  if (product) {
    const id = product.getAttribute("data-page-id") || "unknown";
    const expectedRecipe = {
      "search":"B03", "map-search":"R2", "instant-booking":"R4",
      "messaging":"R5", "bookings-receipts":"R3", "athlete-progress":"R4",
      "scheduling":"R1", "payments":"R3", "roster":"R4",
      "session-notes":"R5", "media-consent":"R6", "insights":"R2",
      "what-is":"B01", "background-checks":"B02",
      "enterprise":"R2", "enterprise-roster":"R4",
      "enterprise-finance":"R3", "enterprise-compliance":"R6"
    };
    /* SHARED SLATE-CENTERED RHYTHM (owner decision 2026-08-23): the anti-uniformity
       gate that pinned each page to a UNIQUE rhythm/composition was retired so every
       product page can wear the same house ground-rhythm — a single slate band held
       in the centre, blacks and whites balanced around it (2 black + 2 white + 1
       slate at 5 bands; the honest 3-band version B-S-W / W-S-D where a page lacks
       real content for five). Per-page character now lives in the header colour/text
       and each body's silhouette, not in a bespoke band sequence. These maps still
       pin each page to ITS chosen rhythm/composition (so a regression is caught);
       they simply no longer forbid two pages from sharing one. */
    const expectedComposition = {
      "what-is":"manifesto-split-grid-claim-questions",
      "background-checks":"threshold-head-split-walk-honesty-questions",
      "search":"filter-figure-to-comparison",
      "map-search":"offset-argument-to-dark-table",
      "instant-booking":"ticket-head-to-split-product",
      "messaging":"centered-question-to-three-column-essay",
      "bookings-receipts":"receipt-head-to-split-record",
      "athlete-progress":"progress-head-to-split-figure",
      "scheduling":"calendar-head-to-split-walk",
      "payments":"math-head-to-split-ledger",
      "roster":"compact-head-to-split-roster",
      "session-notes":"margin-head-to-numbered-dark-notes",
      "media-consent":"consent-head-to-split-ledger",
      "insights":"metric-head-to-argument-to-stacked-table",
      "enterprise":"org-overview-slate-argument-comparison",
      "enterprise-roster":"roster-import-to-split-figure",
      "enterprise-finance":"org-payout-split-essay-rail",
      "enterprise-compliance":"compliance-board-to-split-ledger"
    };
    const expectedRhythm = {
      "what-is":"D-L-L-D-L", "background-checks":"D-L-L-D-L", "search":"L-D-L",
      "map-search":"L-L-D", "instant-booking":"L-L-D", "messaging":"L-D-L",
      "bookings-receipts":"L-L-L", "athlete-progress":"D-L-L", "scheduling":"D-L-L",
      "payments":"D-L-L", "roster":"D-L-L", "session-notes":"L-D-L",
      "media-consent":"D-L-L", "insights":"D-L-L",
      "enterprise":"L-L-L", "enterprise-roster":"D-L-L",
      "enterprise-finance":"D-L-L", "enterprise-compliance":"D-L-L"
    };
    const prose = [...product.querySelectorAll("[data-prose]")].filter(visible);
    out.warn.pageWords = prose.reduce((sum, el) => sum + words(el.textContent), 0);
    if (out.warn.pageWords < 390 || out.warn.pageWords > 500) {
      out.fail.product.push(id + ": prose=" + out.warn.pageWords + " (expected 390–500)");
    }

    const standfirst = product.querySelector("[data-standfirst]");
    const standWords = standfirst ? words(standfirst.textContent) : 0;
    if (standWords < 50 || standWords > 80) {
      out.fail.product.push(id + ": standfirst=" + standWords + " (expected 50–80)");
    }
    prose.filter((el) => !el.hasAttribute("data-standfirst")).forEach((el) => {
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size > 16.1) out.fail.product.push(id + ": oversized body prose " + path(el) + "=" + size + "px");
    });

    const recipe = product.getAttribute("data-recipe") || "";
    const composition = product.getAttribute("data-composition") || "";
    const declaredRhythm = product.getAttribute("data-rhythm") || "";
    if (expectedRecipe[id] !== recipe) {
      out.fail.product.push(id + ": recipe=" + (recipe || "missing") + " expected=" + expectedRecipe[id]);
    }
    if (expectedComposition[id] !== composition) {
      out.fail.product.push(id + ": composition=" + (composition || "missing"));
    }

    const sections = [...product.querySelectorAll(":scope > section[data-section]")]
      .filter((sec) => sec.getAttribute("data-section") !== "keep-exploring");
    const rhythm = sections.map((sec) => sec.classList.contains("dark") ? "D" : "L").join("-");
    if (rhythm !== expectedRhythm[id] || declaredRhythm !== expectedRhythm[id]) {
      out.fail.product.push(id + ": rhythm=" + rhythm + " declared=" + declaredRhythm +
        " expected=" + expectedRhythm[id]);
    }
    sections.filter((sec) => sec.classList.contains("dark")).forEach((sec) => {
      const bg = getComputedStyle(sec).backgroundColor.replace(/\s+/g, "");
      if (bg !== "rgb(10,12,15)" && bg !== "rgba(10,12,15,1)") {
        out.fail.product.push(id + ": dark section is not --canvas-dark (" + bg + ")");
      }
    });

    /* Geometry, not recipe names, forms the fingerprint. Widths are recorded
       as percentages of their actual parent so editorially equivalent grids
       collide even when viewport pixels differ. */
    const geom = (container) => {
      if (!container) return "none";
      const r = container.getBoundingClientRect();
      const cs = getComputedStyle(container);
      const kids = [...container.children].filter(visible);
      const spans = kids.map((el) => {
        const k = el.getBoundingClientRect();
        return Math.round(((k.left - r.left) / Math.max(1, r.width)) * 100) + "/" +
          Math.round((k.width / Math.max(1, r.width)) * 100);
      }).join(",");
      const cols = cs.display === "grid"
        ? cs.gridTemplateColumns.split(" ").filter(Boolean).map((n) => Math.round(parseFloat(n) || 0)).join("/")
        : "0";
      return cs.display + ":" + cols + ":" + kids.length + ":" + spans;
    };
    const heroInner = product.querySelector(".pg-hero-inner");
    const bodyGeometry = sections.slice(1, 3).map((sec) => {
      const inner = sec.querySelector(":scope > .shell") || sec;
      return (sec.classList.contains("dark") ? "D" : "L") + ":" + geom(inner);
    }).join("|");
    /* Uniqueness gate retired 2026-08-23 (owner): the shared slate-centered
       rhythm means two pages may legitimately share a rendered silhouette, so the
       "no two pages alike" fail in smoke.sh (DUPLICATE/ADJACENT fingerprint) must
       no longer trigger. Prefixing the fingerprint with the page id makes every
       fingerprint distinct by construction, neutralising that comparison from here
       without touching smoke.sh; the silhouette string is retained for diagnostics. */
    out.warn.fingerprint = id + "|" + rhythm + "|H:" + geom(heroInner) + "|B:" + bodyGeometry;

    if (sections.length < 2 || !heroInner ||
        !heroInner.querySelector(":scope > .pg-hero-title") ||
        !heroInner.querySelector(":scope > .pg-hero-copy")) {
      out.fail.product.push(id + ": matches deleted hero/whitespace/footer template");
    }

    const heroEyebrow = product.querySelector(".pg-hero .pg-eyebrow");
    if (!heroEyebrow || getComputedStyle(heroEyebrow).textTransform !== "uppercase" ||
        getComputedStyle(heroEyebrow).letterSpacing === "normal") {
      out.fail.product.push(id + ": hero needs a spaced-caps eyebrow");
    }

    product.querySelectorAll(".pg-flat-figure").forEach((figure) => {
      const caption = figure.querySelector("figcaption[data-prose]");
      if (!caption || !/\bdemo\b/i.test(caption.textContent)) {
        out.fail.product.push(id + ": every product figure must disclose demo data in its caption");
      }
    });

    if (id === "what-is" &&
        (product.querySelectorAll(".pg-capability-grid > article").length !== 6 ||
         !product.querySelector("[data-section='market-claim']") ||
         product.querySelectorAll(".pg-question-row").length !== 3)) {
      out.fail.product.push(id + ": needs six bordered capabilities, one dark claim, and three closing questions");
    }
    if (id === "background-checks" &&
        (product.querySelectorAll("[data-step-prose]").length !== 5 ||
         product.querySelectorAll("[data-section='honesty-panel'] p[data-prose]").length !== 2 ||
         product.querySelectorAll(".pg-question-row").length !== 4 ||
         product.querySelector("table,figure"))) {
      out.fail.product.push(id + ": needs five check stages, two honesty paragraphs, four questions, and no table or figure");
    }
    if (id === "search") {
      const heads = [...product.querySelectorAll(".pg-comparison thead th")]
        .map((el) => el.textContent.trim().toUpperCase()).join("|");
      if (!product.querySelector("[data-section='filter-figure'] .pg-flat-figure") ||
          heads !== "THE JOB|ELSEWHERE|ON SPORV") {
        out.fail.product.push(id + ": needs the dark filter figure and THE JOB / ELSEWHERE / ON SPORV ledger");
      }
    }

    if (recipe === "R1") {
      const blocks = [...product.querySelectorAll("[data-step-prose]")];
      if (blocks.length !== 4) out.fail.product.push(id + ": R1 needs four numbered steps");
      blocks.forEach((el, index) => {
        const count = words(el.textContent);
        if (count < 50 || count > 80) {
          out.fail.product.push(id + ": step " + (index + 1) + "=" + count + " (expected 50–80)");
        }
      });
    }
    if (recipe === "R2") {
      const table = product.querySelector(".pg-comparison");
      const heads = table
        ? [...table.querySelectorAll("thead th")].map((el) => el.textContent.trim().toUpperCase())
        : [];
      if (!product.querySelector(".pg-argument") || !table ||
          table.querySelectorAll("tbody tr").length < 3 ||
          heads.join("|") !== "THE JOB|ELSEWHERE|ON SPORV") {
        out.fail.product.push(id + ": R2 requires argument plus THE JOB / ELSEWHERE / ON SPORV table");
      }
    }
    if (recipe === "R3") {
      const paras = product.querySelectorAll(".pg-essay > p[data-prose]");
      if (paras.length < 2 || paras.length > 3 || !product.querySelector(".pg-stat-rail")) {
        out.fail.product.push(id + ": R3 requires two or three essay paragraphs plus a stat rail");
      }
    }
    /* R4 relaxed 2026-08-23: the copy and its flat figure used to share one
       .pg-r4-grid on a single band; under the slate-centered rhythm they split
       into a slate copy band + a figure band, so the grid wrapper is gone. The
       honesty checks that mattered — a real copy column and a captioned figure
       that discloses demo data (enforced separately above) — still hold. */
    if (recipe === "R4" &&
        (!product.querySelector(".pg-r4-copy") || !product.querySelector(".pg-flat-figure") ||
         !product.querySelector(".pg-flat-figure figcaption[data-prose]"))) {
      out.fail.product.push(id + ": R4 requires a copy column and one captioned flat figure");
    }
    if (recipe === "R5") {
      const blocks = [...product.querySelectorAll("[data-dark-block]")];
      if (blocks.length < 2 ||
          !product.querySelector("[data-section='dark-essay'] + [data-section='definition-list']")) {
        out.fail.product.push(id + ": R5 requires a dark essay followed by a light definition list");
      }
      blocks.forEach((el, index) => {
        const count = words(el.textContent);
        if (count < 70 || count > 90) {
          out.fail.product.push(id + ": dark block " + (index + 1) + "=" + count + " (expected 70–90)");
        }
      });
    }
    if (recipe === "R6") {
      const questions = product.querySelectorAll(".pg-question-row");
      if (questions.length < 4 || questions.length > 6) {
        out.fail.product.push(id + ": R6 needs four to six answered questions");
      }
    }

    const phrase = [...new Set(product.querySelectorAll(".pg-h1 em,.pg-accent-phrase"))];
    const accent = [...phrase, ...product.querySelectorAll(".pg-cta")].filter(visible);
    const cta = product.querySelector(".pg-cta");
    const extraEm = [...product.querySelectorAll("em")].filter((el) => phrase.indexOf(el) === -1);
    out.warn.accent = accent.map(path);
    if (phrase.length !== 1 || product.querySelectorAll(".pg-cta").length !== 1 ||
        accent.length !== 2 || extraEm.length) {
      out.fail.product.push(id + ": accent voice must be one italic phrase plus one CTA");
    }
    if (phrase.length === 1 && cta) {
      const phraseColor = getComputedStyle(phrase[0]).color;
      const ctaColor = getComputedStyle(cta).backgroundColor;
      if (phraseColor !== ctaColor) {
        out.fail.product.push(id + ": phrase/CTA colour mismatch " + phraseColor + " vs " + ctaColor);
      }
    }

    const h1 = product.querySelector(".pg-h1");
    const h1Ceiling = {
      "what-is":66.1, "background-checks":56.1, "search":60.1,
      "messaging":40.1, "insights":43.1
    }[id] || 48.1;
    if (h1 && parseFloat(getComputedStyle(h1).fontSize) > h1Ceiling) {
      out.fail.product.push(id + ": H1 exceeds " + h1Ceiling.toFixed(0) + "px ceiling");
    }
    [...product.querySelectorAll("section[data-section] h2")].forEach((heading) => {
      if (parseFloat(getComputedStyle(heading).fontSize) > 52.1) {
        out.fail.product.push(id + ": section heading exceeds 52px ceiling at " + path(heading));
      }
    });
  }

  if (/\bSporve\b/.test(scope.innerText || "")) {
    out.fail.brand.push("LEGACY BRAND: visible copy still uses the former spelling");
  }

  /* E — the CSS dots the spec's svg detector cannot see. (The .psdot class was
     purged by the 2026-08-16 text-only pass; this stays as the tripwire.) */
  out.warn.psdot = [...scope.querySelectorAll(".psdot")].filter(visible).map(path);

  /* F — text-only pass (2026-08-16), FAILING as of 2026-08-16 (census reached zero after the purge; the allowlist below is the ratified set): (i) a colored geometric shape ≤24px sitting next to text — a
     dot/square/swatch doing a label's job; (ii) a pill-styled element outside
     the sanctioned set. Sanctioned: sport tags on product cards (.sporttag,
     and .pill inside a listing/product card) and STATE-ENCODING chips (the
     verification badge, consent, booking/payment status — functional chips
     inside the product app, per the spec's own carve-out). Detection is by
     COMPUTED style, not class name, because the sanctioned sport tag itself
     uses class="pill". */
  const chroma = (c) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || "");
    if (!m) return 0;
    const r = +m[1], g = +m[2], b = +m[3];
    return Math.max(r, g, b) - Math.min(r, g, b);
  };
  
  scope.querySelectorAll("*").forEach((el) => {
    if (!visible(el)) return;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    // (i) tiny colored shape with no text of its own, beside sibling text
    if (r.width > 0 && r.width <= 24 && r.height > 0 && r.height <= 24 &&
        !el.textContent.trim() && el.children.length === 0 &&
        chroma(cs.backgroundColor) > 24 &&
        el.parentElement && el.parentElement.textContent.trim() &&
        /* FUNCTIONAL exclusions, not style ones: .sc-legend keys MAP colour to
           meaning (a legend is information, not decoration); .py-steps/.sbc-rail
           nodes are DIAGRAM geometry; .sbc-mark is the allowlisted verified
           badge; .cal/.mapcanvas are data-positioned. */
        !el.closest(".sporttag,.cardchips,.pin,svg,.sc-legend,.py-steps,.sbc-rail,.sbc-mark,.mapcanvas,.cal-grid")) {
      out.fail.shapes.push(path(el));
    }
    // (ii) pill-shaped label outside the sanctioned set
    const br = parseFloat(cs.borderRadius) || 0;
    if (br >= 99 && el.textContent.trim() && r.height > 0 && r.height <= 34 &&
        (cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.borderTopWidth !== "0px") &&
        !el.matches("button,a,input,select,kbd") &&
        /* .ac-chiprow: sport chips in the ai-coach mock — the sanctioned sport
           tag in demo form. */
        /* .pp-card: the "Recommended" badge on the pricing plan cards (owner
           2026-08-20, Motion-style tier design) is a sanctioned tier marker. */
        /* .pt-card: the "Popular" tier pill; .billtog: the "Save 20%" badge on
           the Monthly/Yearly toggle (owner 2026-08-22, 5-tier pricing) — both
           sanctioned tier/UI markers, same class as the old .pp-card badge. */
        !el.closest(".card,.pickcard,.detail,.sporttag,.sf-badge,[data-qdecide],.panel,.modal,.aidock-panel,.aimax-wrap,.cw,.ac-chiprow,.pp-card,.pt-card,.billtog")) {
      out.fail.pills.push(path(el) + " '" + el.textContent.trim().slice(0, 24) + "'");
    }
  });

  return out;
};
