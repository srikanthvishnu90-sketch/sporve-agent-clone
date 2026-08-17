#!/usr/bin/env python3
"""Inline every mod-*.js into the host HTML at the <!--MODULES--> marker.

Idempotent: always rebuilds from the pristine host (sporve-web.host.html), so
re-running after a new module lands simply re-inlines the full current set.
Outputs the built page to every distribution target.
"""
import base64, glob, hashlib, json, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
HOST = os.path.join(HERE, "sporve-web.host.html")
MARKER = "<!--MODULES-->"
TARGETS = [os.path.join(ROOT, "index.html")]

def require_once(text, token, label):
    """Fail before emitting a partial build when a source injection drifts."""
    count = text.count(token)
    if count != 1:
        sys.exit("FATAL: expected exactly one %s; found %d" % (label, count))

ORDER = [
    # mod-api.js first: it defines window.SporveAPI, which later modules use.
    "mod-api.js",
    # mod-auth.js second: it registers its refresh hook on window.SporveAPI.
    "mod-auth.js",
    # mod-catalog.js third: it reads window.SporveAPI and mutates the host's
    # PROGRAMS array, so it must load after the API and before any module that
    # would otherwise capture a stale catalogue.
    "mod-catalog.js",
    # mod-coachaccount.js fourth: needs SporveAPI and SporveAuth on window.
    "mod-coachaccount.js",
    # mod-booking.js fifth: the booking write path, needs API + auth.
    "mod-booking.js",
    "mod-safety.js", "mod-reviews.js", "mod-coachops.js",
    "mod-payments.js", "mod-search.js", "mod-coachonboard.js",
    "mod-media.js", "mod-notes.js", "mod-insights.js",
]

host = open(HOST, encoding="utf-8").read()
require_once(host, MARKER, MARKER + " marker in host")
require_once(host, "/*__FONTFACE__*/", "font-face token in host")
require_once(host, "/*__SPORTVARS__*/", "sport-variable token in host")
_hero_source = '"__HERO_IMGS__".indexOf("__HERO") === 0 ? [] : []'
require_once(host, _hero_source, "hero-image expression in host")

found = {os.path.basename(p): p for p in glob.glob(os.path.join(HERE, "mod-*.js"))}
names = [n for n in ORDER if n in found] + sorted(n for n in found if n not in ORDER)

blocks, report = [], []
for n in names:
    src = open(found[n], encoding="utf-8").read()
    # A literal </script> inside a JS string would close the tag early.
    src = src.replace("</script>", "<\\/script>")
    blocks.append("<script>\n/* ---- %s ---- */\n%s\n</script>" % (n, src))
    report.append("  %-18s %6d bytes" % (n, len(src)))

built = host.replace(MARKER, "\n".join(blocks) if blocks else MARKER)

# (The hero photographs are handled further down, next to their token.)
# Sentinel is a paid Hoefler&Co face and is deliberately NOT in this repo.
# Drop the licensed webfonts in assets/fonts/ and they get emitted as @font-face
# rules with the binaries inlined, so the single-file + CSP constraints hold.
# Filenames drive weight/style: Sentinel-Bold.woff2, Sentinel-BookItalic.woff2, ...
# Order matters — the first key found in the tail wins, so "extrabold" has to be
# tested before "bold" or every ExtraBold file would inline as 700.
FONT_WEIGHTS = {"light": 300, "book": 400, "roman": 400, "regular": 400,
                "medium": 500, "semibold": 600, "extrabold": 800,
                "bold": 700, "black": 800}
# The filename PREFIX names the family, so every contracted face inlines from
# the same drop folder:
#   Syne-Variable.woff2    -> font-family:"Syne",              weight 600 800
#   Jakarta-Variable.woff2 -> font-family:"Plus Jakarta Sans",  weight 400 700
#   Hanken-Variable.woff2  -> font-family:"Hanken Grotesk",     weight 400 800
# Anything else keeps working under its own prefix (e.g. Sentinel-Book.woff2).
FAMILY_BY_PREFIX = {
    "syne": "Syne",
    "jakarta": "Plus Jakarta Sans",
    "bricolage": "Bricolage Grotesque",
    "hanken": "Hanken Grotesk",
    "instrument": "Instrument Serif",   # editorial serif, mini-page heroes only
    "archivo": "Archivo",               # display / large text
    "jetbrainsmono": "JetBrains Mono",  # NUMERALS only (prices/ratings/counts)
    "inter": "Inter",                   # body / small text
    "sentinel": "Sentinel",
}
# Google serves ONE variable woff2 per family — every weight URL in a css2
# response for Syne or Plus Jakarta Sans returns a byte-identical file. Seven
# static faces would have been 208KB of duplicate binary; two variable faces are
# 60KB. A file named <Prefix>-Variable.woff2 therefore emits a single @font-face
# carrying the whole weight range instead of one face per weight.
VARIABLE_RANGE = {"Syne": "600 800", "Plus Jakarta Sans": "400 700",
                  # The serious register. One family doing display AND body, so
                  # it needs the full working range rather than a display band:
                  # 400 body, 700 UI labels, 800 headlines.
                  "Hanken Grotesk": "400 800",
                  # New primary pair: Archivo display (large), Inter body (small).
                  "Archivo": "400 800", "Inter": "400 700",
                  # JetBrains Mono: tabular numerals only (prices, ratings,
                  # counts, distances). Instrument Serif ships as static
                  # Regular/Italic faces, so it needs no variable range here.
                  "JetBrains Mono": "400 700"}
font_files = sorted(glob.glob(os.path.join(ROOT, "assets", "fonts", "*.woff2")))
faces, fam_seen = [], set()
for fp in font_files:
    stem = os.path.basename(fp).rsplit(".", 1)[0]
    prefix = stem.split("-", 1)[0].lower()
    family = FAMILY_BY_PREFIX.get(prefix, stem.split("-", 1)[0])
    tail = stem.split("-", 1)[1].lower() if "-" in stem else "regular"
    italic = "italic" in tail
    if "variable" in tail:
        weight = VARIABLE_RANGE.get(family, "100 900")
    else:
        weight = next((v for k, v in FONT_WEIGHTS.items() if k in tail.replace("italic", "")), 400)
    import base64 as _b64
    with open(fp, "rb") as f:
        b64 = _b64.b64encode(f.read()).decode("ascii")
    faces.append(
        '@font-face{font-family:"%s";font-weight:%s;font-style:%s;font-display:swap;'
        'src:url(data:font/woff2;base64,%s) format("woff2")}'
        % (family, weight, "italic" if italic else "normal", b64))
    fam_seen.add(family)
if faces:
    built = built.replace("/*__FONTFACE__*/", "\n".join(faces))
    print("fonts: %d face(s) inlined across %s" % (len(faces), ", ".join(sorted(fam_seen))))
else:
    print("fonts: NONE FOUND at assets/fonts/*.woff2")
    print("       The type contract names Syne (display) + Plus Jakarta Sans")
    print("       (body). Neither is present, so the page renders on the system")
    print("       fallback stacks and the contract is NOT met.")
    print("       Drop Syne-Variable.woff2 and Jakarta-Variable.woff2 into")
    print("       assets/fonts/ and rebuild. Both are OFL, from Google Fonts.")

# ── Per-page sport-colour tokens ──────────────────────────────────────────
# Each mini-page wears ONE sport as its identity (the Stripe model: rigid
# neutral system, per-product accent). From the raw hue this derives two text-
# safe variants and emits them as page-scoped CSS vars, so no hand-tuned hex is
# ever scattered in a view. The raw hues come from the host's SPORT_COLOR map;
# they are duplicated here only as the page->hue assignment, and a mismatch
# would be caught by the sport-thread grep in smoke.
#
#   --ps        raw hue        marks: eyebrow dot, chip fill, underline, accent line
#   --ps-ink    darkened       text on light: hero accent, links, CTA fill, numerals
#   --ps-bright lightened      text on the #09090B dark interstitials
#
# WCAG is enforced at build time: --ps-ink must clear 4.5:1 on #F1F5F9 (the
# binding light ground; white is easier) AND carry white text at 4.5:1;
# --ps-bright must clear 4.5:1 on #09090B. A miss FAILS THE BUILD rather than
# shipping unreadable text.
PAGE_SPORT = {
    "what-is": "#2EA136", "background-checks": "#009AA0", "examples": "#009F77",
    # search was #DA5A05 and bookings-receipts #C27000 — both inside the 15-45deg
    # orange band the standing rule bans. As PAGE accents they are chrome, not
    # sport-context, so the exemption does not apply; the audit caught them as
    # orange primary CTAs and 64px orange numerals. Swapped within the existing
    # ramp (Water Polo cyan, Cricket teal); the WCAG derivation below re-checks
    # the ink/bright variants and fails the build on a miss.
    "search": "#0096BA", "map-search": "#748C00", "instant-booking": "#2384FB",
    "messaging": "#D54F8A", "bookings-receipts": "#009D87", "saved": "#DA4E77",
    "athlete-progress": "#9A68E0", "scheduling": "#878500", "payments": "#00A15E",
    "roster": "#0092CA", "session-notes": "#886AF4", "media-consent": "#AB61D3",
    "insights": "#537BFD", "ai-coach": "#7172FA",
}

def _rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def _hex(rgb):
    return "#%02X%02X%02X" % tuple(max(0, min(255, round(c))) for c in rgb)

def _lum(rgb):
    def ch(c):
        c /= 255.0
        return c/12.92 if c <= 0.03928 else ((c+0.055)/1.055)**2.4
    r, g, b = (ch(c) for c in rgb)
    return 0.2126*r + 0.7152*g + 0.0722*b

def _cr(a, b):
    la, lb = _lum(a), _lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi+0.05)/(lo+0.05)

def _scale(rgb, f):
    return tuple(c*f for c in rgb)

def _sport_vars(hexval):
    base = _rgb(hexval)
    slate_bg, dark_bg = _rgb("#E9EEF4"), _rgb("#09090B")
    # darken toward black until the ink clears 4.5:1 on the slate ground AND
    # carries white text (symmetric, so the slate check is the binding one).
    ink = base
    for _ in range(60):
        if _cr(ink, slate_bg) >= 4.5 and _cr((255, 255, 255), ink) >= 4.5:
            break
        ink = _scale(ink, 0.94)
    # lighten toward white until it clears 4.5:1 on the dark interstitial.
    bright = base
    for _ in range(60):
        if _cr(bright, dark_bg) >= 4.5:
            break
        bright = tuple(c + (255-c)*0.10 for c in bright)
    return _hex(ink), _hex(bright)

_sport_css, _sport_fail = [], []
for pid, hx in PAGE_SPORT.items():
    ink, bright = _sport_vars(hx)
    if _cr(_rgb(ink), _rgb("#E9EEF4")) < 4.5 or _cr((255, 255, 255), _rgb(ink)) < 4.5:
        _sport_fail.append("%s ink %s fails AA" % (pid, ink))
    if _cr(_rgb(bright), _rgb("#09090B")) < 4.5:
        _sport_fail.append("%s bright %s fails AA on dark" % (pid, bright))
    _sport_css.append(".pg-%s{--ps:%s;--ps-ink:%s;--ps-bright:%s}" % (pid, hx, ink, bright))
if _sport_fail:
    sys.exit("FATAL: sport-colour AA failures:\n  " + "\n  ".join(_sport_fail))
built = built.replace("/*__SPORTVARS__*/", "\n".join(_sport_css))
print("sport colours: %d pages, all AA-verified" % len(PAGE_SPORT))

# The hero photographs are inlined as data URIs rather than linked, for the same
# single-file/CSP reason as the fonts. Every assets/hero-*.{jpg,jpeg,png,webp} is
# picked up, sorted by filename. The slideshow is gone (2026-08-13): the hero is
# one still, assets/hero-stadium.webp, and heroMediaHTML() draws HERO_IMGS[0]
# only. With none present the token stays and the CSS gradient fallback renders.
HERO_TOKEN = "__HERO_IMGS__"
MIME = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "webp": "webp"}
hero_dir = os.path.join(ROOT, "assets")
heroes = sorted(p for ext in MIME for p in glob.glob(os.path.join(hero_dir, "hero-*." + ext)))
if heroes:
    import base64
    uris, hero_bytes = [], 0
    for h in heroes:
        with open(h, "rb") as f:
            raw = f.read()
        hero_bytes += len(raw)
        uris.append("data:image/%s;base64,%s"
                    % (MIME[h.rsplit(".", 1)[1].lower()], base64.b64encode(raw).decode("ascii")))
    built = built.replace(_hero_source,
                          "[%s]" % ",".join('"%s"' % u for u in uris))
    print("hero images: %d inlined (%.0f KB) — %s"
          % (len(heroes), hero_bytes / 1024, ", ".join(os.path.basename(h) for h in heroes)))
    if len(heroes) != 1:
        print("       NOTE: the hero is a SINGLE still now — the slideshow and its")
        print("       @keyframes were deleted 2026-08-13. heroMediaHTML() renders")
        print("       HERO_IMGS[0] only, so the other %d file(s) here are inlined as"
              % (len(heroes) - 1))
        print("       base64 and shipped to every visitor WITHOUT ever being drawn.")
        print("       Remove them from assets/ or the page carries dead bytes.")
else:
    print("hero images: none at assets/hero-*.* — gradient fallback in use")

# The Artifact platform supplies <!doctype>/<head>, but a file opened from disk
# or served by a plain static server does not — without an explicit charset the
# browser falls back to latin-1 and every emoji/en-dash renders as mojibake.
# Local copies therefore get a complete standalone document.
# A finished <head> (100-point #88): real title, description, Open Graph +
# Twitter cards, theme-color, and a self-contained SVG favicon (no external
# host, so the CSP + single-file constraints still hold).
_OG = "https://the-sporve-web.vercel.app/og.png"
_FAVICON = ("data:image/svg+xml,"
    "%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%3E"
    "%3Crect%20width='32'%20height='32'%20rx='7'%20fill='%2309090B'/%3E"
    "%3Ccircle%20cx='16'%20cy='16'%20r='6'%20fill='white'/%3E%3C/svg%3E")
# Built by f-string (NOT %-formatting) because the favicon data-URI is full of
# literal % escapes that would break a later "% built" substitution. The body
# is spliced with a token replace for the same reason.
STANDALONE = (
    '<!doctype html>\n<html lang="en">\n<head>\n'
    '<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
    '<title>Sporv — Every sport. One app.</title>\n'
    '<meta name="description" content="Sporv connects families with coaches, trainers, camps '
    'and teams across 20+ sports in Chicagoland — searchable by sport, age, and distance.">\n'
    '<meta name="theme-color" content="#09090B">\n'
    '<meta property="og:type" content="website">\n'
    '<meta property="og:site_name" content="Sporv">\n'
    '<meta property="og:title" content="Sporv — Every sport. One app.">\n'
    '<meta property="og:description" content="Find coaches, trainers, camps and teams across 20+ sports in Chicagoland.">\n'
    '<meta property="og:url" content="https://the-sporve-web.vercel.app/">\n'
    f'<meta property="og:image" content="{_OG}">\n'
    '<meta property="og:image:width" content="1200">\n'
    '<meta property="og:image:height" content="630">\n'
    '<meta property="og:image:type" content="image/png">\n'
    '<meta property="og:image:alt" content="Sporv — Every sport. One app.">\n'
    '<meta name="twitter:card" content="summary_large_image">\n'
    '<meta name="twitter:title" content="Sporv — Every sport. One app.">\n'
    '<meta name="twitter:description" content="Find coaches, trainers, camps and teams across 20+ sports in Chicagoland.">\n'
    f'<meta name="twitter:image" content="{_OG}">\n'
    f'<link rel="icon" href="{_FAVICON}">\n'
    "</head>\n<body>\n__SPORVE_BODY__\n</body>\n</html>\n"
)
require_once(STANDALONE, "__SPORVE_BODY__", "standalone body token")

# Build stamp: a content hash of the emitted page, embedded in the page.
#
# Verifying a deploy by comparing `wc -c` of the live response against the local
# file is fragile — it depends on transfer encoding and cannot survive a byte
# that changes without changing length. A stamp lets any check ask the live
# site "which build are you serving?" and get an exact answer, which is what
# post-deploy verification and rollback both need.
_page = STANDALONE.replace("__SPORVE_BODY__", built)
for _token in (MARKER, "/*__FONTFACE__*/", "/*__SPORTVARS__*/", "__SPORVE_BODY__"):
    if _token in _page:
        sys.exit("FATAL: unresolved build token in output: %s" % _token)
if heroes and HERO_TOKEN in _page:
    sys.exit("FATAL: unresolved hero-image token in output")
_stamp = hashlib.sha256(_page.encode("utf-8")).hexdigest()[:16]
_page = _page.replace(
    "</head>", f'<meta name="sporve-build" content="{_stamp}">\n</head>', 1
)

# ── CSP script hashes ────────────────────────────────────────────────────
# The CSP shipped with script-src 'self' 'unsafe-inline', which is barely a CSP
# at all: 'unsafe-inline' is exactly what an injected <script> needs. It was
# there because the build inlines a dozen script blocks and a static policy
# cannot know their contents.
#
# It can if the build writes it. Each inline block is hashed and the digests
# are written into vercel.json's script-src. Browsers IGNORE 'unsafe-inline'
# once a hash or nonce is present, so dropping it is the point rather than a
# side effect.
#
# Hashes cover <script> bodies only, never inline event-handler attributes or
# javascript: URLs, so smoke asserts the built page has none. style-src keeps
# 'unsafe-inline' because the page uses inline style="" attributes throughout,
# which hashes cannot cover; a style injection is a defacement risk, not code
# execution, so that trade is deliberate.
#
# Failure mode to respect: a stale hash blocks EVERY script and serves a blank
# page. That is why this is generated on every build and asserted in smoke,
# rather than hand-maintained.
_scripts = re.findall(r"<script>(.*?)</script>", _page, re.S)
_hashes = [
    "'sha256-" + base64.b64encode(hashlib.sha256(s.encode("utf-8")).digest()).decode() + "'"
    for s in _scripts
]
_vercel = os.path.join(ROOT, "vercel.json")
if not _hashes:
    sys.exit("FATAL: no inline scripts found; refusing to emit an unhashed build")
if not os.path.exists(_vercel):
    sys.exit("FATAL: vercel.json missing; cannot publish CSP hashes")
with open(_vercel, encoding="utf-8") as f:
    _cfg = json.load(f)
_csp_headers = [
    h for rule in _cfg.get("headers", []) for h in rule.get("headers", [])
    if h.get("key", "").lower() == "content-security-policy"
]
if len(_csp_headers) != 1:
    sys.exit("FATAL: expected exactly one Content-Security-Policy header; found %d"
             % len(_csp_headers))
_src = "script-src 'self' " + " ".join(_hashes) + ";"
_current_csp = _csp_headers[0].get("value", "")
_new_csp, _replaced = re.subn(r"script-src [^;]*;", _src, _current_csp, count=1)
if _replaced != 1:
    sys.exit("FATAL: CSP header has no replaceable script-src directive")
_changed = _new_csp != _current_csp
_csp_headers[0]["value"] = _new_csp
if _changed:
    with open(_vercel, "w", encoding="utf-8") as f:
        json.dump(_cfg, f, indent=2, ensure_ascii=False)
        f.write("\n")
print("csp: %d inline script hash(es) %s"
      % (len(_hashes), "written to vercel.json" if _changed else "already current"))

# Emit only after every required source injection and security-header update has
# validated. A failed build must not leave a fresh index beside stale CSP hashes.
for t in TARGETS:
    os.makedirs(os.path.dirname(t), exist_ok=True)
    with open(t, "w", encoding="utf-8") as f:
        f.write(_page)

print("inlined %d module(s):" % len(names))
print("\n".join(report) if report else "  (none yet)")
print("built size: %d bytes" % len(built))
print("build stamp: %s" % _stamp)
print("targets:")
for t in TARGETS:
    print("  %s  %s" % ("OK " if os.path.exists(t) else "FAIL", t))
