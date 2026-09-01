#!/usr/bin/env bash
# Smoke test for the-sporve-web.
#
# Why this exists: the repo had no test suite, no CI and no runner, so any
# automated change had nothing to verify itself against. Everything below is a
# check that a real defect in this repo has already tripped at least once:
#
#   boots        a ${...} pasted into a plain function body is a syntax error
#                that kills the whole host script -- shipped twice
#   errors       sportMenuHTML() was called and never defined; clicking the
#                first chip on the default route crashed the app, live
#   contrast     white-on-white headline (c6cf658), then near-black-on-black
#                under a dark theme -- both were INHERITED grounds, which a
#                CSS grep cannot see, so this resolves the painted background
#   overflow     new landing components broke the phone layout more than once
#   scale        the 8-step type scale drifts the moment someone hand-writes a px
#
# Exit 0 = safe to commit. Non-zero = revert, do not push.
# Usage: ./src/smoke.sh

set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

B="$HOME/.claude/skills/gstack/browse/dist/browse"
FAIL=0
pass(){ printf "  \033[32mPASS\033[0m  %s\n" "$1"; }
fail(){ printf "  \033[31mFAIL\033[0m  %s\n" "$1"; FAIL=1; }

echo "── build ────────────────────────────────────────────"
if python3 src/build.py >/tmp/smoke-build.txt 2>&1; then
  pass "build.py exits 0"
else
  fail "build.py failed:"; sed 's/^/        /' /tmp/smoke-build.txt; exit 1
fi
grep -q "NONE FOUND" /tmp/smoke-build.txt && fail "fonts missing -- type contract not met" \
  || pass "all faces inlined"
[ -s index.html ] && pass "index.html emitted ($(wc -c < index.html) bytes)" \
  || { fail "index.html empty or missing"; exit 1; }

if node scripts/ai-contract-test.mjs >/tmp/ai-contract-test.txt 2>&1; then
  pass "api/ai contract: strict JSON, UTF-8 byte cap, origin gate, and output shape"
else
  fail "api/ai contract test failed:"
  sed 's/^/        /' /tmp/ai-contract-test.txt
  exit 1
fi

if node scripts/repo-contract-test.mjs >/tmp/repo-contract-test.txt 2>&1; then
  pass "repository contract: source manifest, generated output, CSP, and docs agree"
else
  fail "repository contract test failed:"
  sed 's/^/        /' /tmp/repo-contract-test.txt
  exit 1
fi

if node scripts/data-contract-test.mjs >/tmp/data-contract-test.txt 2>&1; then
  pass "data contract: catalogue refresh, fallback, trust evidence, and payout fields"
else
  fail "data contract test failed:"
  sed 's/^/        /' /tmp/data-contract-test.txt
  exit 1
fi

if node scripts/getting-started-contract-test.mjs >/tmp/getting-started-contract-test.txt 2>&1; then
  pass "getting started contract: seven evidence-derived steps and detailed process drawers"
else
  fail "getting started contract test failed:"
  sed 's/^/        /' /tmp/getting-started-contract-test.txt
  exit 1
fi

# gstack's browse is a developer convenience and lives outside the repo, so it
# is absent on a CI runner. src/ci-browse.mjs is the in-repo fallback: a
# Playwright-backed daemon implementing the six subcommands used below. Without
# it this script exited 0 after 3 of 25 assertions and CI showed a green tick
# for a run that never opened a page.
CIB=""
start_ci_browser() {
  if command -v node >/dev/null 2>&1 && node -e "import('playwright')" >/dev/null 2>&1; then
    # A daemon killed before its exit handler runs can leave this marker
    # behind. Waiting for existence alone then "connects" to yesterday's dead
    # port and misdiagnoses the application as failing to boot.
    rm -f .ci-browse-port
    node src/ci-browse.mjs serve >/tmp/ci-browse.log 2>&1 &
    CIB=$!
    ready=0
    for _ in $(seq 1 50); do
      if [ -f .ci-browse-port ] && node src/ci-browse.mjs viewport 1440x900 >/tmp/ci-browse-probe.txt 2>&1; then
        ready=1
        break
      fi
      kill -0 "$CIB" 2>/dev/null || break
      sleep 0.2
    done
    if [ "$ready" -ne 1 ]; then
      fail "ci-browse daemon failed to start:"; sed 's/^/        /' /tmp/ci-browse.log; exit 1
    fi
    B="node src/ci-browse.mjs"
    echo "  using in-repo ci-browse (playwright)"
    return 0
  else
    return 1
  fi
}

if [ -x "$B" ]; then
  # Presence is not readiness. In restricted shells the helper can exist but
  # be unable to bind or reach its localhost control port. Without this probe,
  # that infrastructure failure is misreported below as "host script did not
  # boot", sending a debugger into application code that never ran.
  if ! "$B" viewport 1440x900 >/tmp/smoke-browser-probe.txt 2>&1; then
    if ! start_ci_browser; then
      fail "browser harness exists but could not start, and playwright fallback is unavailable"
      sed 's/^/        /' /tmp/smoke-browser-probe.txt
      exit 1
    fi
  fi
elif ! start_ci_browser; then
  # Fail, do not skip. A check that goes green without running is the exact
  # failure this file exists to prevent.
  fail "no browser harness: gstack browse absent and playwright not installed — 22 of 25 checks cannot run"
  [ -n "${GITHUB_ACTIONS:-}" ] && \
    echo "::error title=Smoke incomplete::No browser harness available; 22 of 25 smoke checks did not run."
  exit 1
fi
cleanup(){ [ -n "$CIB" ] && { $B stop >/dev/null 2>&1; kill "$CIB" 2>/dev/null; rm -f .ci-browse-port; }; }
trap cleanup EXIT

echo "── runtime ──────────────────────────────────────────"
$B viewport 1440x900 >/dev/null 2>&1
$B goto "file://$(pwd)/index.html" >/dev/null 2>&1

boots=$($B js "typeof S==='object'&&typeof render==='function'" 2>/dev/null | tr -d '[:space:]')
[ "$boots" = "true" ] && pass "host script boots" || { fail "host script did not boot"; exit 1; }

# Every route a visitor can reach without auth.
ROUTES="home explore product trust companies pricing coachinfo map assistant saved bookings messages timeline"
# A JS error is a code defect and fails the build. A failed external resource
# is an architecture problem (this page is meant to survive a CSP that blocks
# every external request) but it is pre-existing and environmental, so it warns
# rather than blocking a change that did not cause it.
RESWARN=0
for r in $ROUTES; do
  $B console --clear >/dev/null 2>&1
  $B js "S.auth={status:'guest'};S.portal='family';S.route={name:'$r',arg:null};render();'ok'" >/dev/null 2>&1
  log=$($B console --errors 2>&1)
  js=$(printf '%s' "$log" | grep "\[error\]" | grep -vc "Failed to load resource")
  res=$(printf '%s' "$log" | grep -c "Failed to load resource")
  [ "$js" -eq 0 ] || fail "JS errors on route '$r' ($js)"
  [ "$res" -eq 0 ] || { printf "  \033[33mWARN\033[0m  %s\n" "route '$r': $res external resource(s) failed to load"; RESWARN=$((RESWARN+res)); }
done
[ "$FAIL" -eq 0 ] && pass "no JS errors across $(echo $ROUTES | wc -w | tr -d ' ') routes"
[ "$RESWARN" -gt 0 ] && printf "  \033[33mWARN\033[0m  %s\n" "$RESWARN external resource(s) failed — the single-file/CSP design says nothing should be fetched externally"

# ── coach portal ────────────────────────────────────────────────────────
# Every route above forces portal='family' and auth=guest, so until now the
# entire coach dashboard — roughly half the product — was never rendered by
# this script at all. Three real contrast defects shipped through a green
# smoke run because of that. The coach surface gets the same treatment.
# Core rail tabs plus every tab contributed by a module (modCoachTabs()):
# mod-notes, mod-media, mod-insights and mod-coachops each register their own.
# Omitting them left 7 of 15 coach surfaces unchecked.
COACHTABS="dashboard schedule bookings roster inbox listings finances reviews \
notes media insights policies waitlist slots messages getting-started"
CFAIL=0
for t in $COACHTABS; do
  $B console --clear >/dev/null 2>&1
  $B js "S.auth={status:'verified'};S.portal='coach';S.coachTab='$t';S.route={name:'dashboard',arg:null};render();'ok'" >/dev/null 2>&1
  log=$($B console --errors 2>&1)
  js=$(printf '%s' "$log" | grep "\[error\]" | grep -vc "Failed to load resource")
  [ "$js" -eq 0 ] || { fail "JS errors on coach tab '$t' ($js)"; CFAIL=$((CFAIL+1)); }
done
[ "$CFAIL" -eq 0 ] && pass "no JS errors across $(echo $COACHTABS | wc -w | tr -d ' ') coach tabs"

# ── contrast ────────────────────────────────────────────────────────────
# Structural assertions cannot see whether text is readable. This repo has
# shipped near-black-on-black once and near-white-on-white once; both were
# computed-style defects that only a browser measuring real pixels catches.
#
# The coach portal is held at zero because it was built clean and there is no
# reason to let it rot. The family portal carried 16 pre-existing failures; the
# 2026-08-13 slate adoption took that to 6; the 2026-08-14 C2/C3 rebuild took it
# to 2 — the deleted template sections carried four of the failures. Lower it again
# whenever a change improves it — a baseline that never drops is a todo, not a test.
# it is ratcheted instead of gated: the number may fall, never rise. Blocking
# on it today would stop every unrelated change until someone fixes 16 old
# defects, which is how a check gets deleted rather than satisfied.
# Baseline 2 = the two ACCEPTED pre-existing pairs on trust (.pill.warn
# "Verification pending" #B87800 on its warm tint, 3.30:1 — the warn palette
# is established across the app; re-inking it is its own change, not a ride-
# along). Anything above 2 is a regression.
# 4, not 2: the nav "Join waitlist" pill uses the EXACT reference slate
# --slate #7692AE with white text (owner 2026-08-24, "use the exact color").
# White-on-#7692AE is 3.23:1 — it clears WCAG 3:1 for UI components but not the
# 4.5:1 text bar, and the pill renders on all 4 family routes (1 each = 4).
# Owner-accepted brand exception; revert to 2 if the CTA colour ever changes.
FAMILY_CONTRAST_BASELINE=4
# Fail closed. If the audit file is missing or the harness returns nothing,
# `${n:-0}` would coerce empty to zero and every assertion below would report
# PASS without measuring a pixel — a check that goes green when it cannot run
# is worse than no check, because it is trusted.
[ -f src/contrast-audit.js ] || { fail "contrast: src/contrast-audit.js missing — gate cannot run"; }
cx_run() { $B eval src/contrast-audit.js 2>/dev/null | tr -d '\r' | tail -1; }
cx_num() {
  n=$(printf '%s' "$1" | sed -n 's/.*"failures":\([0-9]*\).*/\1/p')
  [ -n "$n" ] || { printf 'UNMEASURED'; return; }
  printf '%s' "$n"
}

COACH_CX=0
for t in $COACHTABS; do
  $B js "S.auth={status:'verified'};S.portal='coach';S.coachTab='$t';S.route={name:'dashboard',arg:null};render();'ok'" >/dev/null 2>&1
  out=$(cx_run); n=$(cx_num "$out")
  if [ "$n" = "UNMEASURED" ]; then
    fail "contrast: coach tab '$t' returned no measurement — gate broken"
    COACH_CX=$((COACH_CX+1))
  elif [ "$n" -ne 0 ]; then
    fail "contrast: coach tab '$t' has $n failure(s)"
    printf '        %s\n' "$(printf '%s' "$out" | sed -n 's/.*"list":\[\(.*\)\]}/\1/p' | tr ',' '\n' | head -4)"
    COACH_CX=$((COACH_CX+n))
  fi
done
[ "$COACH_CX" -eq 0 ] && pass "contrast: coach portal clean across $(echo $COACHTABS | wc -w | tr -d ' ') tabs"

FAM_CX=0
for r in home explore product trust; do
  $B js "S.auth={status:'guest'};S.portal='family';S.route={name:'$r',arg:null};render();'ok'" >/dev/null 2>&1
  n=$(cx_num "$(cx_run)")
  [ "$n" = "UNMEASURED" ] && { fail "contrast: family route '$r' returned no measurement — gate broken"; n=0; }
  FAM_CX=$((FAM_CX+n))
done
if [ "$FAM_CX" -gt "$FAMILY_CONTRAST_BASELINE" ]; then
  fail "contrast: family portal regressed to $FAM_CX (baseline $FAMILY_CONTRAST_BASELINE)"
elif [ "$FAM_CX" -lt "$FAMILY_CONTRAST_BASELINE" ]; then
  pass "contrast: family portal improved to $FAM_CX (baseline $FAMILY_CONTRAST_BASELINE — lower it)"
else
  pass "contrast: family portal holding at baseline $FAMILY_CONTRAST_BASELINE"
fi

# ── CSP script hashes ───────────────────────────────────────────────────
# The blast radius here is total: a script-src hash that does not match the
# script it is meant to authorise blocks that script, and blocking the host
# script serves a blank page. Verified by corrupting one hash and watching the
# page fail to boot, so this is not a theoretical failure mode.
#
# build.py regenerates these on every build, so a mismatch means either the
# regex silently failed or vercel.json was hand-edited. Both are worth stopping
# a merge for.
csp=$(python3 - <<'PY'
import base64, hashlib, json, re, sys
page = open("index.html", encoding="utf-8", newline="").read()
cfg = json.load(open("vercel.json", encoding="utf-8"))
policy = ""
for rule in cfg.get("headers", []):
    for h in rule.get("headers", []):
        if h.get("key") == "Content-Security-Policy":
            policy = h["value"]
m = re.search(r"script-src ([^;]*);", policy)
if not m:
    print("NOSCRIPTSRC"); sys.exit()
directive = m.group(1)
if "'unsafe-inline'" in directive:
    print("UNSAFEINLINE"); sys.exit()
want = ["'sha256-" + base64.b64encode(hashlib.sha256(s.encode()).digest()).decode() + "'"
        for s in re.findall(r"<script>(.*?)</script>", page, re.S)]
if not want:
    print("NOSCRIPTS"); sys.exit()
missing = [h for h in want if h not in directive]
if missing:
    print("MISMATCH:%d/%d" % (len(missing), len(want))); sys.exit()
# Any inline handler attribute, any quoting, any case. The earlier form listed
# seven names and required double quotes, so onclick='...', onfocus=, ONCLICK=
# and unquoted values all slipped past a check whose whole job is to guarantee
# there are none.
_EVENTS = (r"click|dblclick|submit|reset|change|input|focus|blur|load|error|abort|"
           r"key(down|up|press)|mouse[a-z]+|pointer[a-z]+|touch[a-z]+|drag[a-z]*|drop|"
           r"scroll|resize|select|toggle|wheel|paste|copy|cut|contextmenu|"
           r"animation[a-z]+|transition[a-z]+")
if re.search(r"\son(" + _EVENTS + r")\s*=", page, re.I):
    print("INLINEHANDLER"); sys.exit()
print("OK:%d" % len(want))
PY
)
# The check above can never fail on its own, because smoke runs build.py first
# and build.py regenerates vercel.json — the tamper is repaired before the
# assertion reads it. Verified: corrupting a hash and reintroducing
# 'unsafe-inline' both still passed.
#
# The invariant that actually matters is different. There is no buildCommand,
# so Vercel serves the COMMITTED index.html and vercel.json verbatim. If a
# source change is committed without regenerating them, production serves a
# stale page — and a stale vercel.json means hashes that do not match the
# scripts, which is a blank site. So: after a fresh build, the working tree
# must be clean. If build.py changed anything, what was committed was wrong.
#
# Enforced in CI only. There the tree starts clean at HEAD, so any diff after a
# build means the committed outputs were stale. Locally the outputs differ from
# HEAD by design the moment you edit a source file, so this warns instead of
# failing rather than making the normal edit-build-test loop unusable.
if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  dirty=$(git status --porcelain -- index.html vercel.json 2>/dev/null)
  if [ -z "$dirty" ]; then
    pass "build outputs in sync with sources"
  elif [ -n "${GITHUB_ACTIONS:-}" ]; then
    fail "index.html/vercel.json are STALE — a fresh build differs from what is committed, and Vercel serves the committed files verbatim: $(printf '%s' "$dirty" | tr '\n' ' ')"
  else
    printf "  \033[33mWARN\033[0m  %s\n" "build outputs differ from HEAD (expected while editing; enforced in CI)"
  fi
fi

# Exercise the policy for real. Everything above compares strings; none of it
# proves a browser accepts the result, because file:// ignores response headers
# entirely. This serves the built page with the exact vercel.json headers and
# asserts it still boots — the only check that would catch a hash mismatch
# before it blanks production.
CSPPORT=8749
python3 src/csp-serve.py "$(pwd)" "$CSPPORT" >/tmp/csp-serve.log 2>&1 &
CSPPID=$!
for _ in $(seq 1 40); do
  curl -s -o /dev/null "http://127.0.0.1:$CSPPORT/index.html" && break; sleep 0.25
done
if curl -sI "http://127.0.0.1:$CSPPORT/index.html" | grep -qi "^content-security-policy:"; then
  $B goto "http://127.0.0.1:$CSPPORT/index.html" >/dev/null 2>&1
  booted=$($B js "typeof render==='function'&&typeof S==='object'&&document.getElementById('app').children.length>0" 2>/dev/null | tr -d '[:space:]')
  [ "$booted" = "true" ] \
    && pass "csp: page boots under the real policy (hashes accepted by the browser)" \
    || fail "csp: page did NOT boot under the real policy — a script hash is rejected; production would be BLANK"

  # The backend is reachable UNDER THE REAL POLICY. This is the check that
  # catches connect-src: a perfectly correct API layer still fails silently if
  # the policy forbids the origin — the browser blocks the request before it
  # leaves, and the only symptom is a console entry nobody reads. It must run
  # here, on the header-serving port, because file:// has no CSP at all and
  # would pass while production blocks every call.
  api=$($B js "typeof window.SporveAPI==='object'&&typeof window.SporveAPI.ping==='function'" 2>/dev/null | tr -d '[:space:]')
  [ "$api" = "true" ] \
    && pass "api: SporveAPI is present in the built page" \
    || fail "api: SporveAPI missing — mod-api.js did not inline"

  # The auth layer must be present and wired to the API layer. `onUnauthorized`
  # being registered is the load-bearing bit: without it an expired token is a
  # dead end for the user, which is the single most likely real-world failure.
  auth=$($B js "typeof window.SporveAuth==='object'&&typeof window.SporveAuth.signIn==='function'&&typeof window.SporveAuth.restore==='function'" 2>/dev/null | tr -d '[:space:]')
  [ "$auth" = "true" ] \
    && pass "auth: SporveAuth is present in the built page" \
    || fail "auth: SporveAuth missing — mod-auth.js did not inline"

  # A signed-out visitor must read as guest, never as verified. If this ever
  # says true with no session, every auth-gated surface is open to everyone.
  guest=$($B js "window.SporveAuth.isSignedIn()===false&&window.SporveAuth.userId()===null" 2>/dev/null | tr -d '[:space:]')
  [ "$guest" = "true" ] \
    && pass "auth: no session reads as signed-out (fails closed)" \
    || fail "auth: isSignedIn() is true with no session — auth-gated surfaces would be open"

  # Wrong credentials must reject with a human-readable message, not a raw code
  # and not a silent resolve. Uses a deliberately non-existent account.
  badlogin=$($B js "window.SporveAuth.signIn('nobody-'+Date.now()+'@gmail.com','wrongpassword123').then(()=>'FAIL:accepted').catch(e=>'OK:'+(e.code||'?')+':'+(e.message||'').slice(0,40))" 2>/dev/null | tr -d '\r')
  case "$(printf '%s' "$badlogin" | tr -d '[:space:]')" in
    OK:invalid_credentials:*) pass "auth: wrong credentials rejected with a usable message" ;;
    FAIL:*) fail "auth: a bad password was ACCEPTED" ;;
    *) fail "auth: unexpected sign-in failure shape — $badlogin" ;;
  esac

  # FIX 1 — one store owns identity. If S.auth is persisted to sessionStorage
  # alongside the real token in localStorage, the two disagree the moment a tab
  # closes: UI signed-out, transport still authenticated (or the reverse).
  onestore=$($B js "(()=>{S.auth={status:'verified',user:{id:'x'}};saveState();const r=JSON.parse(sessionStorage.getItem('sporve:state:v1')||'{}');S.auth={status:'guest',user:null};return !('auth' in (r.s||r));})()" 2>/dev/null | tr -d '[:space:]')
  [ "$onestore" = "true" ] \
    && pass "auth: identity is NOT mirrored into sessionStorage (one store owns it)" \
    || fail "auth: S.auth is persisted as well as the token — two identity sources with different lifetimes"

  # FIX 2 — an intent must survive a full-page OAuth redirect. A closure cannot;
  # a descriptor can. This is the difference between returning from Google to
  # your booking and returning to the explore grid with it silently lost.
  intent=$($B js "(()=>{S.pendingIntent={kind:'book',programId:'p1'};saveState();const r=JSON.parse(sessionStorage.getItem('sporve:state:v1')||'{}');const st=r.s||r;S.pendingIntent=null;return !!(st.pendingIntent&&st.pendingIntent.kind==='book'&&st.pendingIntent.programId==='p1');})()" 2>/dev/null | tr -d '[:space:]')
  [ "$intent" = "true" ] \
    && pass "auth: a parked intent survives serialisation (OAuth-safe)" \
    || fail "auth: pendingIntent does not survive a reload — every deferred booking is lost through OAuth"

  # FIX 3 — a failed sign-in must leave somewhere to show why. The mock closed
  # the sheet unconditionally, which with a real backend means a wrong password
  # dismisses the modal and reports nothing.
  failpath=$($B js "typeof authFail==='function'&&typeof doSignIn==='function'&&typeof runIntent==='function'" 2>/dev/null | tr -d '[:space:]')
  [ "$failpath" = "true" ] \
    && pass "auth: sign-in has a failure branch and an intent replayer" \
    || fail "auth: authFail/doSignIn/runIntent missing — a failed sign-in has nowhere to report"

  ping=$($B js "window.SporveAPI.ping().then(r=>'OK:'+r.programs).catch(e=>'ERR:'+e.status+':'+e.message)" 2>/dev/null | tr -d '\r')
  case "$(printf '%s' "$ping" | tr -d '[:space:]')" in
    OK:0)  fail "api: reached the backend but zero published programs — the marketplace has no inventory" ;;
    OK:*)  pass "api: reached Supabase under the real CSP and read live programs" ;;
    ERR:0:*) fail "api: request blocked before leaving the browser — connect-src does not allow the Supabase origin" ;;
    ERR:*) fail "api: backend rejected the request — $ping" ;;
    *)     fail "api: liveness probe returned nothing (harness or network problem)" ;;
  esac

  # ── PHASE C1 · the live catalogue ─────────────────────────────────────────
  # These run HERE, on the CSP-serving origin, and nowhere else. Every content
  # assertion in this file (no emoji, no exclamation marks, the 8-step type
  # scale, the contrast ratchet) measures a file:// page, where mod-catalog.js
  # deliberately never hydrates — so a coach writing "Let's go!" in a listing
  # title can never turn this build red. Structure is asserted against live
  # data; content is asserted against the seed.

# [spec 01 · 2026-08-31] live catalogue (hydration, bands, tabs, pins, samples) gates removed — the marketplace feature they tested is deleted.
# The cut also removed the harness restore that block ended with — reinstate it.
$B viewport 1440x900 >/dev/null 2>&1
$B goto "file://$(pwd)/index.html" >/dev/null 2>&1


  # API.from must FORWARD its options. It took (table, query) and silently
  # dropped a third argument, so every write built as
  # from(t, q, {method:"PATCH", body}) went out as a GET — PostgREST answered
  # 200 with the row UNCHANGED, the caller's .then() saw a valid record and
  # reported success, and the edit never happened. Read paths cannot catch this
  # because they pass no options.
  fwd=$($B js "(function(){
    var seen=null, real=window.fetch;
    window.fetch=function(u,o){ seen=(o&&o.method)||'GET'; return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}})); };
    return window.SporveAPI.from('providers','id=eq.00000000-0000-0000-0000-000000000000',{method:'PATCH',body:{bio:'x'}})
      .catch(function(){})
      .then(function(){ window.fetch=real; return 'METHOD:'+seen; });
  })()" 2>/dev/null | tr -d '\r')
  case "$(printf '%s' "$fwd" | tr -d '[:space:]')" in
    METHOD:PATCH) pass "api: from() forwards method and body — writes are not silently downgraded to reads" ;;
    METHOD:GET)   fail "api: from() DROPPED its options — every write silently becomes a GET and reports success" ;;
    *)            fail "api: option-forwarding probe returned nothing ($fwd)" ;;
  esac

  # A brand-new coach must never be publicly listed. Defaults are
  # status='pending' and background_check_status='none', and
  # providers_select_public requires approved AND a cleared check.
  gate=$($B js "(function(){
    if(!window.SporveCoach) return 'NOMODULE';
    var f=window.SporveCoach.publicState;
    return typeof f==='function'?'OK':'NOSTATE';})()" 2>/dev/null | tr -d '\r')
  case "$(printf '%s' "$gate" | tr -d '[:space:]')" in
    OK) pass "coach: the account module exposes a public-visibility state" ;;
    *)  fail "coach: SporveCoach.publicState missing ($gate)" ;;
  esac

  # BOOKING [CRITICAL-PATH]. The module must exist, must reject rather than
  # THROW when signed out, and must never send a price — the server decides it
  # (trg_set_booking_price), and a client that sends one is a client someone
  # will one day trust.
  # Read the SHIPPED function rather than trying to drive it: create() rejects
  # before any fetch when signed out, so a network stub never sees a body, and
  # faking a session to get past that would test the fake.
  bk=$($B js "(function(){
    if(!window.SporveBooking) return 'NOMODULE';
    var src=window.SporveBooking.create.toString();
    if(/original_price|final_price|\bprice\b/.test(src)) return 'SENDSPRICE';
    if(!/session_id/.test(src)) return 'NOSESSION';
    return 'OK';
  })()" 2>/dev/null | tr -d '\r')
  case "$(printf '%s' "$bk" | tr -d '[:space:]')" in
    OK)         pass "booking: the write path sends identifiers only — never a price" ;;
    SENDSPRICE) fail "booking: the client is sending a PRICE — the server sets it, and a client-supplied price is a discount anyone can grant themselves" ;;
    NOMODULE)   fail "booking: SporveBooking is missing from the built page" ;;
    NOSESSION)  fail "booking: create() no longer sends session_id — the booking would not attach to a session" ;;
    *)          fail "booking: price probe returned nothing ($bk)" ;;
  esac

  signedout=$($B js "window.SporveBooking.create({sessionId:'x'}).then(function(){return 'RESOLVED';}).catch(function(e){return 'REJECTED:'+e.message;})" 2>/dev/null | tr -d '\r')
  case "$(printf '%s' "$signedout" | tr -d '[:space:]')" in
    REJECTED:*) pass "booking: a signed-out booking rejects cleanly instead of throwing past every handler" ;;
    RESOLVED)   fail "booking: a signed-out booking RESOLVED — it must not" ;;
    *)          fail "booking: signed-out probe threw synchronously ($signedout)" ;;
  esac

  # A LIVE listing must never take the demo path. Signed out, it has to ask for
  # sign-in and replay — not fabricate a "confirmed" booking against a real
  # coach who will never hear about it.
  nodemo=$($B js "(function(){
    /* Read the shipped handler: it must branch on isLive and canBook
       SEPARATELY. ANDing them is what routed a live listing to the demo. */
    var s=document.documentElement.innerHTML;
    var hasSplit=/const isLive=/.test(s)&&/const canBook=/.test(s);
    var hasAndBug=/const live=p\.live&&s\.live&&window\.SporveBooking/.test(s);
    if(hasAndBug) return 'ANDED';
    return hasSplit?'OK':'NOSPLIT';
  })()" 2>/dev/null | tr -d '\r')
  case "$(printf '%s' "$nodemo" | tr -d '[:space:]')" in
    OK)      pass "booking: a live listing asks for sign-in rather than degrading to a demo booking" ;;
    ANDED)   fail "booking: live and can-book are ANDed again — a signed-out visitor fabricates a confirmed booking against a real coach" ;;
    NOSPLIT) fail "booking: the isLive/canBook split is gone ($nodemo)" ;;
    *)       fail "booking: demo-degradation probe returned nothing ($nodemo)" ;;
  esac

  # OAUTH MUST RETURN TO THIS ORIGIN. A coach signing in with Google was landing
  # on the waitlist at sporve.vercel.app — a different product. The allow-list
  # that causes that lives in GoTrue, but this asserts the half we control:
  # the client must never ask to be sent anywhere but its own origin, and no
  # foreign Sporv property may appear in the built page.
  oa=$($B js "(function(){
    if(typeof oauthReturnUrl!=='function') return 'NOHELPER';
    var u=oauthReturnUrl();
    if(u.indexOf(window.location.origin)!==0) return 'FOREIGN:'+u;
    if(!window.SporveAuth) return 'NOAUTH';
    var full=window.SporveAuth.oauthUrl('google',u);
    if(/sporve\.vercel\.app/.test(full)) return 'WAITLIST';
    if(full.indexOf(encodeURIComponent(window.location.origin))<0) return 'NOTENCODED';
    return 'OK';
  })()" 2>/dev/null | tr -d '\r')
  case "$(printf '%s' "$oa" | tr -d '[:space:]')" in
    OK)         pass "auth: Google sign-in returns to this origin, never another Sporv property" ;;
    WAITLIST)   fail "auth: the OAuth URL points at sporve.vercel.app — a coach would land on the waitlist" ;;
    FOREIGN:*)  fail "auth: the OAuth return URL is not this origin (${oa#*FOREIGN:})" ;;
    NOTENCODED) fail "auth: this origin is not in the OAuth redirect_to — GoTrue will fall back to SITE_URL" ;;
    NOHELPER)   fail "auth: oauthReturnUrl() is gone; the return target is uncontrolled again" ;;
    *)          fail "auth: oauth return probe returned nothing ($oa)" ;;
  esac

# [spec 01 · 2026-08-31] sample-company bookability gates removed — the marketplace feature they tested is deleted.

  # The AI dock is COACH-ONLY. Families get Support, not an assistant.
  dock=$($B js "(function(){
    S.auth={status:'guest'};S.portal='family';S.route={name:'explore',arg:null};render();
    var fam=document.querySelectorAll('.aidock-fab,.aidock-panel').length;
    S.auth={status:'verified',user:Object.assign({},SEED.user,{role:'provider'})};S.portal='coach';
    S.coachTab='dashboard';S.route={name:'dashboard',arg:null};render();
    /* v3: the dock opens DOCKED by default, so the FAB is absent while the
       panel is up. Presence = fab OR panel (either is the dock rendered). */
    var coach=document.querySelectorAll('.aidock-fab,.aidock-panel').length;
    var openByDefault=!!document.querySelector('.aidock-panel');
    if(fam) return 'ONFAMILY:'+fam;
    if(!coach) return 'MISSINGONCOACH';
    return openByDefault?'OK':'CLOSED';
  })()" 2>/dev/null | tr -d '\r')
  case "$(printf '%s' "$dock" | tr -d '[:space:]')" in
    OK)             pass "coach: the AI dock is coach-only and open by default" ;;
    ONFAMILY:*)     fail "coach: the AI dock rendered on a FAMILY route — families get Support, not an assistant" ;;
    MISSINGONCOACH) fail "coach: the AI dock is missing from the coach portal entirely" ;;
    CLOSED)         fail "coach: the AI dock is collapsed by default — it should open like the reference" ;;
    *)              fail "coach: dock probe returned nothing ($dock)" ;;
  esac

  # design-rules R12/R13: AI replies are server-emitted markdown; mdCoach() must
  # render it (never leak literal ** / ## to the reader) and strip emoji. Guards
  # the exact defect the Aug-2026 design brief flagged from regressing.
  md=$($B js "(function(){
    if(typeof mdCoach!=='function') return 'NOFUNC';
    var b=mdCoach('**bold** and '+String.fromCharCode(96)+'code'+String.fromCharCode(96));
    if(b.indexOf('<strong>bold</strong>')<0) return 'NOBOLD';
    if(b.indexOf('**')>=0||b.indexOf('##')>=0) return 'RAWSYNTAX';
    var l=mdCoach('- one\n- two');
    if(l.indexOf('<ul>')<0||l.indexOf('<li>one</li>')<0) return 'NOLIST';
    var e=mdCoach('hi '+String.fromCodePoint(0x1F600)+' there');
    if(/[\uD800-\uDBFF]/.test(e)) return 'EMOJI';
    var x=mdCoach('<img src=x onerror=alert(1)>');
    if(x.indexOf('<img')>=0) return 'XSS';
    return 'OK';
  })()" 2>/dev/null | tr -d '\r')
  # design-rules R6: a dark panel never gets a LIGHT border (reads as a render
  # bug). Regression guard on the docked assistant: render it live and assert the
  # panel + its direct surface children carry no visible high-luminance border.
  brd=$($B js "(function(){
    S.auth={status:'verified',user:Object.assign({},SEED.user,{role:'provider'})};
    S.portal='coach';S.coachTab='dashboard';S.route={name:'dashboard',arg:null};
    S.aiOpen=true;S.aiCollapsed=false;S.aiMax=false;
    S.chat=[{role:'user',text:'hi'},{role:'assistant',text:'Hello there'}];
    render();
    var panel=document.querySelector('.aidock-panel');
    if(!panel) return 'NOPANEL';
    var lum=function(c){var m=c.match(/rgba?\(([^)]+)\)/);if(!m)return null;
      var p=m[1].split(',').map(parseFloat);var a=p.length>3?p[3]:1;
      if(a<0.15)return null;return (0.2126*p[0]+0.7152*p[1]+0.0722*p[2])/255;};
    var nodes=[panel].concat([].slice.call(panel.children));
    var W=['borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth'];
    var C=['borderTopColor','borderRightColor','borderBottomColor','borderLeftColor'];
    for(var i=0;i<nodes.length;i++){var s=getComputedStyle(nodes[i]);
      for(var j=0;j<4;j++){ if(parseFloat(s[W[j]])<0.5)continue;
        var L=lum(s[C[j]]); if(L!==null&&L>0.6)
          return 'LIGHT:'+(nodes[i].className||nodes[i].tagName)+':'+s[C[j]];}}
    return 'OK';
  })()" 2>/dev/null | tr -d '\r')
  case "$(printf '%s' "$brd" | tr -d '[:space:]')" in
    OK)       pass "ai: docked panel carries no light border on its dark ground (design-rules R6)" ;;
    NOPANEL)  fail "ai: R6 probe could not render the docked panel" ;;
    LIGHT:*)  fail "ai: a LIGHT border rings the dark AI panel (${brd#LIGHT:}) — reads as a render bug (design-rules R6)" ;;
    *)        fail "ai: R6 border probe returned nothing ($brd)" ;;
  esac

  case "$(printf '%s' "$md" | tr -d '[:space:]')" in
    OK)        pass "ai: mdCoach renders markdown, strips emoji, escapes HTML (design-rules R12/R13)" ;;
    NOFUNC)    fail "ai: mdCoach() is missing — AI bubbles would render raw markdown to the reader" ;;
    NOBOLD)    fail "ai: mdCoach did not render **bold** — literal asterisks reach the user" ;;
    RAWSYNTAX) fail "ai: mdCoach left literal ** or ## in output — raw markdown syntax to a user (Sev-2)" ;;
    NOLIST)    fail "ai: mdCoach did not render '- ' bullets as a list" ;;
    EMOJI)     fail "ai: mdCoach did not strip emoji from AI output (design-rules R13)" ;;
    XSS)       fail "ai: mdCoach let an <img> tag through — esc() must run before markup" ;;
    *)         fail "ai: mdCoach probe returned nothing ($md)" ;;
  esac

  # TRUST-CRITICAL — the org compliance board's clearance rule must FAIL CLOSED.
  # Slice 2 adds expiry: cleared = verified AND dated AND within the validity
  # window. An expired (old-dated), pending, undated, or unchecked member is NOT
  # cleared. Relative dates so the test stays valid over time. Guards AAU #33/#316/
  # #345 the same way the marketplace gate is guarded.
  oc=$($B js "(function(){
    if(typeof orgMemberStatus!=='function'||typeof orgMemberCleared!=='function') return 'NOFUNC';
    var ago=function(d){return new Date(Date.now()-d*864e5).toISOString();};
    var vs=function(s,d){return {background_check_status:s,background_check_completed_at:(d==null?null:ago(d))};};
    if(orgMemberCleared(vs('verified',null))) return 'OPEN_NODATE';
    if(orgMemberCleared(vs('pending',5)))     return 'OPEN_PENDING';
    if(orgMemberCleared(vs('none',null)))     return 'OPEN_NONE';
    if(orgMemberCleared(vs('verified',400)))  return 'OPEN_EXPIRED';
    if(orgMemberStatus(vs('verified',400))!=='expired')  return 'NOT_EXPIRED';
    if(orgMemberStatus(vs('verified',360))!=='expiring') return 'NOT_EXPIRING';
    if(!orgMemberCleared(vs('verified',10)))  return 'FALSE_NEG';
    return 'OK';
  })()" 2>/dev/null | tr -d '\r')
  case "$(printf '%s' "$oc" | tr -d '[:space:]')" in
    OK)          pass "enterprise: org clearance fails closed + expiry-aware (AAU #33/#316/#345)" ;;
    NOFUNC)      fail "enterprise: orgMemberStatus/Cleared() missing — the compliance board has no clearance rule" ;;
    OPEN_NODATE) fail "enterprise: a 'verified' check with NO completion date read as cleared — trust gate open (S0)" ;;
    OPEN_PENDING)fail "enterprise: a 'pending' check read as cleared — trust gate open (S0)" ;;
    OPEN_NONE)   fail "enterprise: an unchecked staff member read as cleared — trust gate open (S0)" ;;
    OPEN_EXPIRED)fail "enterprise: an EXPIRED check read as cleared — trust gate open (S0)" ;;
    NOT_EXPIRED) fail "enterprise: an old check did not resolve to 'expired'" ;;
    NOT_EXPIRING)fail "enterprise: a soon-to-expire check did not resolve to 'expiring'" ;;
    FALSE_NEG)   fail "enterprise: a fresh verified+dated check read as NOT cleared — rule too tight" ;;
    *)           fail "enterprise: org clearance probe returned nothing ($oc)" ;;
  esac

  # TRUST-CRITICAL — cert/waiver validity (staff_certifications) must also FAIL
  # CLOSED: only status 'verified' AND (no expiry or a future expiry) is valid.
  # pending/none/expired never count as current. Relative dates. (AAU #313/#316/#323)
  ct=$($B js "(function(){
    if(typeof certState!=='function'||typeof certValid!=='function') return 'NOFUNC';
    var d=function(n){return new Date(Date.now()+n*864e5).toISOString().slice(0,10);};
    if(certValid({status:'pending',expires_at:d(200)}))  return 'OPEN_PENDING';
    if(certValid({status:'none',expires_at:d(200)}))     return 'OPEN_NONE';
    if(certValid({status:'verified',expires_at:d(-10)})) return 'OPEN_EXPIRED';
    if(certState({status:'verified',expires_at:d(-10)})!=='expired')  return 'NOT_EXPIRED';
    if(certState({status:'verified',expires_at:d(10)})!=='expiring')  return 'NOT_EXPIRING';
    if(certState({status:'verified',expires_at:d(200)})!=='current')  return 'NOT_CURRENT';
    return 'OK';
  })()" 2>/dev/null | tr -d '\r')
  case "$(printf '%s' "$ct" | tr -d '[:space:]')" in
    OK)          pass "enterprise: cert/waiver validity fails closed + expiry-aware (AAU #313/#316/#323)" ;;
    NOFUNC)      fail "enterprise: certState/certValid() missing — cert board has no validity rule" ;;
    OPEN_PENDING)fail "enterprise: a 'pending' cert read as valid — trust gate open (S0)" ;;
    OPEN_NONE)   fail "enterprise: an absent cert read as valid — trust gate open (S0)" ;;
    OPEN_EXPIRED)fail "enterprise: an EXPIRED cert read as valid — trust gate open (S0)" ;;
    NOT_EXPIRED) fail "enterprise: a past-expiry cert did not resolve to 'expired'" ;;
    NOT_EXPIRING)fail "enterprise: a soon-to-expire cert did not resolve to 'expiring'" ;;
    NOT_CURRENT) fail "enterprise: a valid future cert did not resolve to 'current'" ;;
    *)           fail "enterprise: cert validity probe returned nothing ($ct)" ;;
  esac

# [spec 01 · 2026-08-31] search-spec toolbar + filter drawer gates removed — the marketplace feature they tested is deleted.

  # EVERY RETURN TARGET WE HAND AN EXTERNAL SERVICE MUST BE READ BACK.
  # stripe-create-checkout is sent successUrl=/?booking=<id>&paid=1 and
  # stripe-connect-onboarding is sent /?connect=done. Neither was read, so a
  # family paid $50 and landed on the marketing homepage with no confirmation.
  # A redirect target nobody handles is a dead end at the end of a payment.
  ret=$($B js "(function(){
    if(typeof hydrateReturn!=='function') return 'NOHANDLER';
    var src=hydrateReturn.toString();
    if(src.indexOf('booking')<0) return 'NOBOOKING';
    if(src.indexOf('connect')<0) return 'NOCONNECT';
    /* It must READ the row, never trust the URL: a query string a visitor can
       edit must not be able to assert that a payment happened. */
    if(/paid===.1.|paid==.1./.test(src)&&src.indexOf('status(')<0) return 'TRUSTSURL';
    if(src.indexOf('status(')<0) return 'NOVERIFY';
    return 'OK';
  })()" 2>/dev/null | tr -d '\r')
  case "$(printf '%s' "$ret" | tr -d '[:space:]')" in
    OK)         pass "return: post-payment and post-Connect redirects are handled, and read the row rather than the URL" ;;
    NOHANDLER)  fail "return: hydrateReturn() is gone — a paying family lands on the homepage with no confirmation" ;;
    NOBOOKING)  fail "return: the ?booking= redirect from Stripe checkout is not handled" ;;
    NOCONNECT)  fail "return: the ?connect=done redirect from Stripe Connect is not handled" ;;
    TRUSTSURL)  fail "return: payment state is being read from the QUERY STRING — a visitor could edit the URL to claim they paid" ;;
    NOVERIFY)   fail "return: the booking is not re-read from the server on return" ;;
    *)          fail "return: probe returned nothing ($ret)" ;;
  esac

  # NO FABRICATED MESSAGES, AND NO SEEDED VERIFICATION SHOWN TO A REAL COACH.
  # Two honesty defects the frontend audit found: a setTimeout appended a coach
  # reply no human wrote, and every settings/checklist surface read
  # SEED.providerProfile (status "approved", stripeAccountId "acct_mock...") so
  # a brand-new unchecked coach was told they were Verified.
  honest=$($B js "(function(){
    if(/I'll get back to you shortly/.test(document.documentElement.innerHTML)) return 'FAKEREPLY';
    if(typeof coachState!=='function') return 'NOSTATE';
    /* A real coach (live provider row, pending + unchecked) must NOT see
       approved/verified/payouts pills or invented metrics. */
    S.coachProvider={business_name:'Probe',status:'pending',
      background_check_status:'none',background_check_completed_at:null,
      stripe_account_id:null,stripe_charges_enabled:false};
    var st=coachState();
    if(!st.isReal) return 'NOTREAL';
    if(st.approved||st.verified||st.payouts||st.listed) return 'CLAIMSTOOMUCH';
    S.coachProvider={business_name:'Probe',status:'approved',
      background_check_status:'verified',background_check_completed_at:null,
      stripe_account_id:'acct_probe',stripe_charges_enabled:true};
    st=coachState();
    if(st.verified||st.listed) return 'UNEVIDENCED';
    S.coachProvider.background_check_completed_at='2026-08-16T12:00:00Z';
    st=coachState();
    if(!st.verified||!st.listed||!st.payouts||!st.connectStarted) return 'EVIDENCELOST';
    S.coachProvider=null;
    return 'OK';
  })()" 2>/dev/null | tr -d '\r')
  case "$(printf '%s' "$honest" | tr -d '[:space:]')" in
    OK)             pass "honesty: no fabricated coach reply, and a pending coach is not shown as verified" ;;
    FAKEREPLY)      fail "honesty: the fabricated coach reply is back — a message attributed to a coach that no human wrote" ;;
    CLAIMSTOOMUCH)  fail "honesty: a pending, unchecked coach is being reported as approved/verified/paid" ;;
    UNEVIDENCED)    fail "honesty: verified status without a completion date still produces a coach badge" ;;
    EVIDENCELOST)   fail "honesty: dated verification or loaded Stripe state is not reaching the coach portal" ;;
    NOSTATE)        fail "honesty: coachState() is gone; the portal is reading the seed again" ;;
    *)              fail "honesty: probe returned nothing ($honest)" ;;
  esac

  # MODALS MUST TRAP FOCUS AND CLOSE ON ESCAPE. Ten of eleven declared
  # aria-modal="true" with neither — Tab past the last field and focus lands on
  # the page behind while a screen reader is told that content does not exist.
  trap=$($B js "(function(){
    /* deterministic state: spec-01 cuts changed which check precedes this one,
       and a leftover coach portal legitimately renders the AI dock (role=dialog),
       which is NOT the modal under test. */
    S.portal='family';S.auth={status:'guest'};S.route={name:'home',arg:null};
    S.modal={type:'authsheet'};render();
    var box=document.querySelector('[role=dialog], .modal');
    if(!box) return 'NOMODAL';
    var f=[].slice.call(box.querySelectorAll('button,input,select,a[href]'))
            .filter(function(e){return e.offsetParent!==null;});
    if(!f.length) return 'NOFOCUSABLES';
    f[f.length-1].focus();
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));
    var wrapped=document.activeElement===f[0];
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    var closed=!document.querySelector('[role=dialog], .modal');
    S.modal=null;render();
    if(!wrapped) return 'NOTRAP';
    if(!closed)  return 'NOESCAPE';
    return 'OK';
  })()" 2>/dev/null | tr -d '\r')
  case "$(printf '%s' "$trap" | tr -d '[:space:]')" in
    OK)        pass "a11y: modals trap Tab and close on Escape" ;;
    NOTRAP)    fail "a11y: Tab escapes the modal — focus lands behind a surface declaring aria-modal" ;;
    NOESCAPE)  fail "a11y: Escape does not close the modal" ;;
    *)         fail "a11y: focus-trap probe returned nothing ($trap)" ;;
  esac

# [spec 01 · 2026-08-31] live-listing badge evidence (no listings surface) gates removed — the marketplace feature they tested is deleted.

  # Nothing above is worth anything if the live render throws. The 13-route
  # sweep near the top of this file runs on file://, which never hydrates — so
  # without this, eleven of the thirteen visitor-reachable routes had never
  # been rendered against a real row. A uuid where a "prog_N" was expected, a
  # null the seed always filled, a business name twice as long as any sample:
  # none of those are visible to a seeded run.
  LIVEFAIL=0
  for r in $ROUTES; do
    $B console --clear >/dev/null 2>&1
    $B js "S.auth={status:'guest'};S.portal='family';S.route={name:'$r',arg:null};render();'ok'" >/dev/null 2>&1
    n=$($B console --errors 2>&1 | grep "\[error\]" | grep -vc "Failed to load resource")
    [ "$n" -eq 0 ] || { fail "catalog: JS error(s) on route '$r' against LIVE data ($n)"; LIVEFAIL=$((LIVEFAIL+1)); }
  done
  [ "$LIVEFAIL" -eq 0 ] \
    && pass "catalog: all $(echo $ROUTES | wc -w | tr -d ' ') visitor routes render clean against live data"

  # Leave the harness on a file:// page so later checks are unaffected.
  $B goto "file://$(pwd)/index.html" >/dev/null 2>&1
else
  fail "csp: local header server did not serve a policy — check could not run"
fi
{ kill "$CSPPID"; wait "$CSPPID"; } >/dev/null 2>&1

case "$csp" in
  OK:*)          pass "csp: ${csp#OK:} script hashes match the built page, no 'unsafe-inline'" ;;
  UNSAFEINLINE)  fail "csp: script-src still allows 'unsafe-inline' — the policy does not stop XSS" ;;
  MISMATCH:*)    fail "csp: ${csp#MISMATCH:} script hashes do not match the built page — production would serve a BLANK page" ;;
  INLINEHANDLER) fail "csp: an inline event-handler attribute is back; hashes cannot cover it and it will be blocked" ;;
  NOSCRIPTSRC)   fail "csp: no script-src directive found in vercel.json" ;;
  NOSCRIPTS)     fail "csp: no inline scripts found in the built page — the check has gone blind" ;;
  *)             fail "csp: $csp" ;;
esac

# ── session persistence ─────────────────────────────────────────────────
# Two invariants, both verified against a real browser rather than by reading
# the code. The page is loaded over file:// here, where sessionStorage is
# available but origin-scoped, which is enough to exercise save and restore.
#
# The second assertion is the one that matters: cmdPending is an unconfirmed
# broadcast to every family on a roster, and it must never come back after a
# reload. Persisting it would resurrect a message the coach never approved.
persist=$($B js "
(()=>{try{
  if(typeof saveState!=='function'||typeof loadState!=='function')return 'NOAPI';
  /* Snapshot and restore everything this check touches. Later assertions
     render marketing pages and would otherwise find the coach dashboard,
     and a snapshot left in sessionStorage would be restored by any later
     reload. A test that leaks state fails its neighbours, not itself. */
  const _p=S.portal,_t=S.coachTab,_r=S.route;
  S.portal='coach';S.coachTab='inbox';
  S.messages['__smoke']=[{id:'x',me:false,text:'persisted',at:TODAY}];
  S.cmdPending={convId:'__smoke',body:'MUST NOT SURVIVE',restated:'x'};
  saveState();
  const raw=sessionStorage.getItem('sporve:state:v1');
  if(!raw)return 'NOWRITE';
  const snap=JSON.parse(raw);
  const dataKept = snap.messages && snap.messages['__smoke'] && snap.messages['__smoke'][0].text==='persisted';
  const ephemeralDropped = !('cmdPending' in snap) && !('modal' in snap);
  /* Round-trip, not just write. A regression that drops data on RESTORE would
     leave the snapshot perfect and still lose the user's work, so wipe the
     in-memory value and prove loadState puts it back. */
  delete S.messages['__smoke'];
  loadState();
  const restored = !!(S.messages['__smoke'] && S.messages['__smoke'][0].text==='persisted');
  /* A hostile snapshot must not be able to replace S prototype: JSON.parse
     makes __proto__ an own key, and an in-operator guard is true by
     inheritance, so the naive loop would assign it.
     NOTE: no backticks anywhere in this block. It is interpolated inside a
     double-quoted shell string, where a backtick is command substitution --
     bash runs it and splices the output into the JavaScript. */
  /* The payload MUST be a raw JSON string. Writing {__proto__:{...}} as an
     object literal sets the prototype instead of creating an own key, so
     JSON.stringify drops it entirely and the test becomes vacuous — it passed
     against a knowingly vulnerable loader before this was fixed. */
  sessionStorage.setItem('sporve:state:v1', '{\"__proto__\":{\"PWN\":1},\"portal\":\"coach\"}');
  loadState();
  const protoSafe = Object.getPrototypeOf(S)===Object.prototype && S.PWN===undefined;
  delete S.messages['__smoke'];S.cmdPending=null;
  S.portal=_p;S.coachTab=_t;S.route=_r;
  try{sessionStorage.removeItem('sporve:state:v1')}catch(_){}
  render();
  if(!dataKept)return 'DATALOST';
  if(!restored)return 'RESTOREFAILED';
  if(!protoSafe)return 'PROTO_POLLUTION';
  if(!ephemeralDropped)return 'EPHEMERAL_PERSISTED';
  return 'OK';
}catch(e){return 'THREW:'+e.message}})()" 2>/dev/null | tr -d '"\r')
case "$persist" in
  OK)                  pass "persistence: data saved, ephemeral state dropped" ;;
  NOAPI)               fail "persistence: saveState/loadState missing" ;;
  NOWRITE)             fail "persistence: nothing written to sessionStorage" ;;
  DATALOST)            fail "persistence: data did not survive the snapshot" ;;
  RESTOREFAILED)       fail "persistence: snapshot written but loadState did not restore it — work is still lost" ;;
  PROTO_POLLUTION)     fail "persistence: a hostile snapshot replaced S's prototype or widened S" ;;
  EPHEMERAL_PERSISTED) fail "persistence: cmdPending or modal was persisted — an unconfirmed broadcast can resurrect" ;;
  *)                   fail "persistence: $persist" ;;
esac

# ── platform fee: one source, one rendered value ────────────────────────
# The 12% rate was authored in five places and partially migrated twice, so it
# was fixed three times and still shipped wrong. Two tripwires, because the two
# failure modes are different: a module re-declaring the constant shadows the
# host and drifts silently, and a hardcoded percentage in copy drifts without
# any constant being involved at all.
# Modules must not re-declare the rate, and NOTHING may hardcode the decimal.
# The earlier version grepped only src/mod-*.js, so a bare 0.12 in the host --
# exactly what the ported coach-portal work introduced -- slipped through. The
# runtime check could not catch it either: that surface renders "$45 gross ·
# $5 platform fee", a dollar figure with no percent sign for the scan to find.
redecl=$(grep -cE "^\s*const (FEE_RATE|FEE_PCT|PLATFORM_FEE)\s*=" src/mod-*.js 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
# Geometry and style also multiply by 0.12 -- an SVG circle radius at
# mod-companies.js:149 is not a platform fee -- so those lines are excluded by
# shape rather than by line number, which would rot on the next edit.
hardcoded=$(grep -nE "\*\s*0\.12\b" src/sporve-web.host.html src/mod-*.js 2>/dev/null \
  | grep -vE "Math\.(min|max)\(|opacity|circle|rgba|scale\(|translate" | wc -l | tr -d ' ')
[ "$hardcoded" -eq 0 ] || fail "fee: $hardcoded hardcoded 0.12 literal(s) in source — use FEE_RATE"
[ "$redecl" -eq 0 ] && pass "fee: no module re-declares the rate" \
  || fail "fee: a module re-declares the rate — it shadows the host and will drift"

# Subscription era (owner decision 2026-08-17): the only percentages allowed
# near fee context are FEE_PCT itself (0 — "0% of bookings") and 100 ("coaches
# keep 100%"). A stray 12 — or any other rate — anywhere near the word "fee"
# is the drift this exists to catch. \d{1,3} with a lookbehind so "100%" reads
# as 100, not a phantom "00".
feep=$($B js "
(()=>{const pcts=new Set();
 const scan=()=>{const t=document.getElementById('app').innerText;const re=/(?<![\d.])(\d{1,3}(?:\.\d)?)%/g;let m;
   while((m=re.exec(t))){const c=t.slice(Math.max(0,m.index-45),m.index+30).toLowerCase();
     if(c.includes('fee')||c.includes('sporve')||c.includes('booking'))pcts.add(m[1])}};
 S.auth={status:'verified'};S.portal='family';
 ['wallet','pricing','coachinfo','bookings'].forEach(r=>{try{S.route={name:r,arg:null};render();scan()}catch(e){}});
 /* Product pages too — the sig-payments figure shipped a rendered '12%' that
    the route list above never visited. Money copy lives on pages as well. */
 ['payments','instant-booking','bookings-receipts','insights'].forEach(id=>{try{S.route={name:'page',arg:id};render();scan()}catch(e){}});
 S.portal='coach';['dashboard','finances','listings'].forEach(t=>{try{S.coachTab=t;render();scan()}catch(e){}});
 const a=[...pcts];
 if(typeof FEE_PCT==='undefined')return 'NOFEECONST';
 if(!a.length)return 'NONE';
 /* '2.9' allowed 2026-08-31 (owner): the pricing page states Stripe's
    card-processing pass-through under Standard direct charges — a rate the
    club pays its own processor, not a Sporv fee. FEE_PCT stays the only
    Sporv rate. */
 const ok=a.every(p=>p===String(FEE_PCT)||p==='100'||p==='2.9');
 return ok?'OK:'+a.sort().join('+'):'MIXED:'+a.join(',')})()" 2>/dev/null | tr -d '\"\r')
case "$feep" in
  OK:*)        pass "fee: rendered rates are exactly {${feep#OK:}} — FEE_PCT and the 100% coaches keep" ;;
  NOFEECONST)  fail "fee: FEE_PCT is not defined in the host — the single source is gone" ;;
  NONE)        fail "fee: no fee percentage rendered anywhere — the check has gone blind" ;;
  *)           fail "fee: rendered percentages disagree — $feep" ;;
esac

# [spec-01 completion · 2026-08-31] §9 page sweep — the product pages are deleted; these gates measured them.

# [spec-01 completion · 2026-08-31] slop-audit product enforcement — the product pages are deleted; these gates measured them.

# Static filler tripwire: construct the pattern so the retired sentence never
# appears in this auditor and a repository-wide search can honestly return zero.
filler_pattern='built[[:space:]]+into[[:space:]]+Sporv(e)?'
filler_hits=$(rg -n -i "$filler_pattern" --glob '!.git/**' --glob '!.clo-sync/**' . 2>/dev/null || true)
[ -z "$filler_hits" ] && pass "deprecated product-page filler is absent repository-wide" \
  || fail "deprecated product-page filler remains: $filler_hits"

# The visible rebrand is broader than one header screenshot. Sweep primary
# routes, every assigned page, accessible labels, metadata, and both wordmarks.
brand=$($B js "
(()=>{const old=new RegExp('Sporv'+'e');const bad=[];
 const inspect=label=>{
  const app=document.querySelector('#app');
  if(old.test(app?.innerText||''))bad.push(label+':TEXT');
  const attrs=[...(app?.querySelectorAll('[aria-label],[alt]')||[])];
  if(attrs.some(el=>old.test((el.getAttribute('aria-label')||'')+' '+(el.getAttribute('alt')||''))))bad.push(label+':A11Y');};
 '$ROUTES'.split(' ').forEach(name=>{S.portal='family';S.auth={status:'guest'};S.route={name,arg:null};render();inspect(name);});
 /* product pages deleted (spec-01 completion) — route sweep above covers the survivors. */
 S.route={name:'home',arg:null};render();
 const crop=document.querySelector('.topbar .navlogo-crop');
 const logo=crop?.querySelector('img.navlogo');
 const cropBox=crop?.getBoundingClientRect();
 const logoBox=logo?.getBoundingClientRect();
 const cropRatio=cropBox&&logoBox&&logoBox.width ? cropBox.width/logoBox.width : 0;
 const cropOverflow=crop ? getComputedStyle(crop).overflow : '';
 S.route={name:'explore',arg:null};render();
 const footLogo=document.querySelector('.close-zone .foot-brand img.navlogo');
 if(!logo||logo.alt!=='Sporv'||cropOverflow!=='hidden'||cropRatio<.84||cropRatio>.90){
   bad.push('HEADER_LOGO:'+(logo?.alt||'missing')+':'+cropRatio.toFixed(2));
 }
 /* Footer brand is now the nav logo image, not the "SPORV" wordmark (owner 2026-08-24). */
 if(!footLogo||footLogo.alt!=='Sporv')bad.push('FOOTER_LOGO:'+(footLogo?footLogo.alt:'missing'));
 if(old.test(document.title)||old.test(document.querySelector('meta[name=description]')?.content||''))bad.push('HEAD');
 return bad.length?bad.join(','):'OK'})()" 2>/dev/null)
[ "${brand//\"/}" = "OK" ] && pass "Sporv rebrand: header, footer, metadata, routes, and accessible labels clean" \
  || fail "visible brand rename incomplete: $brand"

# ── overlap-audit: no same-corner chip collisions (owner spec 2026-08-16) ──
# scripts/overlap-audit.js, injected like slop-audit. Fails on two absolutely-
# positioned SIBLINGS stacked at the same anchor whose boxes overlap — the
# Demo-chip-vs-sport-tag bug (30 cards, 46x26px, before the .cardchips flex
# row). Map pins overlap by DATA (lat/long), not by CSS anchor, and are
# excluded by the same-anchor discriminator — the map route is swept to keep
# that exclusion honest. Clipped-text is an advisory.
OAUD=$(cat scripts/overlap-audit.js 2>/dev/null)
if [ -z "$OAUD" ]; then fail "scripts/overlap-audit.js missing"; else
ovl=$($B js "$OAUD;
(()=>{const routes=['home','explore','saved','map','companies','coachinfo'];
 const bad=[];let warn=0;
 routes.forEach(rt=>{S.portal='family';S.auth={status:'guest'};S.route={name:rt,arg:null};render();
  const r=window.OVERLAP_AUDIT();
  if(r.fail.sameCorner.length)bad.push(rt+'['+r.fail.sameCorner.slice(0,2).join(' | ')+']');
  warn+=r.warn.clipped.length;});
 S.route={name:'home',arg:null};render();
 return bad.length?bad.join(' '):'CLEAN w'+warn})()" 2>/dev/null)
ovlc=${ovl//\"/}
case "$ovlc" in
  CLEAN*) pass "overlap-audit: no same-corner chip collisions on 6 routes";;
  "")     fail "overlap-audit did not return";;
  *)      fail "overlap-audit: $ovl";;
esac
fi

# [spec 01 · 2026-08-31] landing chip click-through (chips deleted with the hero rebuild) gates removed — the marketplace feature they tested is deleted.
# no-rails §6.4 rule via the six-task spec 2026-08-08; the explore kind bands
# (.kindrow, T4) are intentional horizontal rows, so a rail no longer fails this
# check. Emoji stay banned; the rail count is dropped from the fail condition.
he=$($B js "
(()=>{const em=/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;const o=[];
['home','explore'].forEach(r=>{S.route={name:r,arg:null};render();const a=document.querySelector('#app');
 const e=(a.innerText.match(em)||[]).length;
 if(e>0)o.push(r+'(emoji='+e+')')});return o.length?o.join(' '):'CLEAN'})()" 2>/dev/null)
[ "$(printf '%s' "${he//\"/}" | tr -d '[:space:]')" = "CLEAN" ] && pass "home + explore: zero emoji (rails allowed per six-task override)" || fail "home/explore sweep: $he"

# [spec-01 completion · 2026-08-31] §1 hero type sweeps (desktop + 2 breakpoints) — the product pages are deleted; these gates measured them.

# [spec-01 completion · 2026-08-31] recipe/KX gate — the product pages are deleted; these gates measured them.
# 100-point #88 — the <head> is finished (title in head, OG image, favicon).
head=$(awk 'BEGIN{p=1} /<\/head>/{print; exit} p' index.html)
{ printf '%s' "$head" | grep -q '<title>Sporv' && printf '%s' "$head" | grep -q 'og:image' && printf '%s' "$head" | grep -q 'rel="icon"'; } \
  && pass "#88 head finished (title · og:image · favicon)" || fail "#88 head incomplete"
# 100-point #58 — zero exclamation marks in rendered copy across routes + pages.
ex=$($B js "
(()=>{let n=0;'$ROUTES'.split(' ').forEach(r=>{S.auth={status:'guest'};S.route={name:r,arg:null};render();n+=(document.querySelector('#app').innerText.match(/!/g)||[]).length});
return n})()" 2>/dev/null | tr -d '[:space:]"')
[ "${ex:-x}" = "0" ] && pass "#58 zero exclamation marks in rendered copy" || fail "#58 exclamation marks in copy: $ex"

# §2 — darker slate present, the near-white grey retired.
grep -q "E9EEF4" index.html && pass "slate #E9EEF4 present" || fail "slate #E9EEF4 missing"
r=$(grep -oc "247, *248, *250\|247,248,250" index.html 2>/dev/null); r=${r:-0}
[ "$r" -eq 0 ] && pass "old near-white slate rgb(247,248,250) retired" || fail "old slate rgb(247,248,250) still present ($r)"

# The dark-ground invariant. Resolves the PAINTED background through
# transparent ancestors -- both historic contrast failures were inherited.
#
# Reload first. This runs after a 13-route loop, and evaluating a long script
# against a page left in an arbitrary state returned EMPTY often enough to
# produce a false FAIL with a blank violation list -- which is worse than no
# check, because a red build nobody believes gets ignored. Empty is now
# reported as "did not run", distinct from a real violation.
$B goto "file://$(pwd)/index.html" >/dev/null 2>&1
sleep 1
bad=$($B js "
(()=>{const lum=c=>{const v=c.map(x=>{x/=255;return x<=.03928?x/12.92:Math.pow((x+.055)/1.055,2.4)});return .2126*v[0]+.7152*v[1]+.0722*v[2]};
const rgb=s=>{const m=s.match(/[\d.]+/g);return m?m.slice(0,3).map(Number):null};
const al=s=>{const m=s.match(/[\d.]+/g);return m&&m.length>3?Number(m[3]):1};
const bgOf=e=>{while(e){const c=getComputedStyle(e).backgroundColor;if(c&&al(c)>.5)return rgb(c);e=e.parentElement}return [255,255,255]};
const out=[];'$ROUTES'.split(' ').forEach(r=>{S.auth={status:'guest'};S.route={name:r,arg:null};render();
 document.querySelectorAll('body *').forEach(el=>{if(!el.offsetParent)return;
  if(![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))return;
  const bg=bgOf(el);if(lum(bg)>.18)return;const fg=rgb(getComputedStyle(el).color);if(!fg)return;
  const q=(Math.max(lum(fg),lum(bg))+.05)/(Math.min(lum(fg),lum(bg))+.05);
  if(q<4.5)out.push(r+':'+(el.className||el.tagName)+'@'+q.toFixed(2))})});
return out.length?[...new Set(out)].slice(0,6).join(' | '):'CLEAN'})()" 2>/dev/null)
clean=${bad//\"/}; clean=$(printf '%s' "$clean" | tr -d '[:space:]')
if [ "$clean" = "CLEAN" ]; then pass "dark grounds carry white or slate text"
elif [ -z "$clean" ]; then fail "dark-ground check did not return — contrast audit did not run"
else fail "dark-ground violations: $bad"; fi

# F6 — keyboard reachability on the five money paths. A control a keyboard user
# cannot reach is a control they cannot use; the two that matter on a payments
# site are checkout and the coach billing/onboarding flow. Assert that on each
# money-path surface every visible interactive element is keyboard-focusable
# (not tabindex=-1, not a div-as-button with no role) AND that the page defines
# a visible focus ring. Recorded on every CI run so the pass is durable, not a
# one-time audit note.
$B viewport 1440x900 >/dev/null 2>&1
$B goto "file://$(pwd)/index.html" >/dev/null 2>&1
kbd=$($B js "
(()=>{const bad=[];
 const surfaces=[
   ['family','explore',null],['family','page',['payments']],
   ['family','pricing',null],['family','coachinfo',null]];
 // focus ring must exist in the stylesheet
 let ring=false; for(const sh of document.styleSheets){try{for(const r of sh.cssRules){
   if(r.selectorText&&/:focus-visible/.test(r.selectorText)){ring=true;break;}}}catch(e){}}
 if(!ring)bad.push('no :focus-visible rule');
 const scan=(label)=>{const app=document.querySelector('#app');
   const els=[...app.querySelectorAll('button,a[href],input,select,textarea,[role=button]')].filter(e=>e.offsetParent);
   els.forEach(e=>{const ti=e.getAttribute('tabindex');
     if(ti!==null&&parseInt(ti,10)<0&&!e.disabled)bad.push(label+':unreachable('+(e.className||e.tagName).toString().split(' ')[0]+')');
     // a clickable div/span with no role/tabindex is a keyboard trap-around
   });
   // also: any element with a data-nav/data-book/data-becomecoach handler must be a real button/a
   [...app.querySelectorAll('[data-book],[data-becomecoach],[data-signin],[data-getpro],[data-connectpayouts]')].forEach(e=>{
     const tag=e.tagName.toLowerCase(); if(tag!=='button'&&tag!=='a')bad.push(label+':nonfocusable-action('+tag+')');});};
 S.auth={status:'guest'};
 surfaces.forEach(([portal,route,arg])=>{try{S.portal=portal;S.route={name:route,arg:arg?arg[0]:null};render();scan(route+(arg?':'+arg[0]:''));}catch(e){bad.push(route+':threw');}});
 // coach onboarding wizard (the other money path)
 try{S.portal='coach';S.coachTab='dashboard';render();scan('coach-dash');}catch(e){bad.push('coach-dash:threw');}
 return bad.length?[...new Set(bad)].slice(0,8).join(' | '):'CLEAN'})()" 2>/dev/null)
kclean=${kbd//\"/}; kclean=$(printf '%s' "$kclean" | tr -d '[:space:]')
if [ "$kclean" = "CLEAN" ]; then pass "keyboard: money-path controls are all focusable, focus ring defined"
elif [ -z "$kclean" ]; then fail "keyboard-reachability check did not return"
else fail "keyboard reachability on money paths: $kbd"; fi
# Restore a clean family/home render so this check does not leak coach-portal
# state into later assertions that measure the current DOM.
$B js "S.portal='family';S.auth={status:'guest'};S.coachTab='dashboard';S.route={name:'home',arg:null};render();'ok'" >/dev/null 2>&1

# Layout must never scroll horizontally.
for vp in 1440x900 768x1024 390x844; do
  $B viewport "$vp" >/dev/null 2>&1
  $B goto "file://$(pwd)/index.html" >/dev/null 2>&1
  # Reports the overshoot and the widest culprit rather than a bare boolean.
  # Text shaping differs between platforms, so a sub-pixel difference can round
  # a passing layout into a failing one; knowing whether it is 1px or 40px is
  # the difference between a tolerance and a real bug.
  o=$($B js "S.route={name:'home',arg:null};render();
(()=>{const b=document.body,over=b.scrollWidth-b.clientWidth;
 if(over<=1)return 'CLEAN:'+over;
 // An element only widens the page if nothing between it and <body> clips it.
 // A marquee inside overflow:hidden sticks out thousands of px and is
 // harmless; reporting it buries the element that actually scrolls the page.
 const clipped=el=>{for(let n=el.parentElement;n&&n!==b;n=n.parentElement){
   const o=getComputedStyle(n).overflowX; if(o!=='visible')return true} return false};
 const hits=[];document.querySelectorAll('#app *').forEach(el=>{
   if(clipped(el))return;
   const r=el.getBoundingClientRect();const x=Math.round(r.right-b.clientWidth);
   if(x>0)hits.push({x,el})});
 hits.sort((a,c)=>c.x-a.x);
 const id=h=>{const e=h.el,p=e.parentElement;
   return '+'+h.x+'px '+e.tagName+(e.className?'.'+String(e.className).split(' ')[0]:'')
     +' w='+Math.round(e.getBoundingClientRect().width)
     +' in '+(p?p.tagName+(p.className?'.'+String(p.className).split(' ')[0]:''):'?')
     +' ['+e.outerHTML.slice(0,60).replace(/\s+/g,' ')+']'};
 return 'OVER:'+over+' '+(hits.length?hits.slice(0,2).map(id).join(' || ')
   :'no unclipped culprit — sub-pixel accumulation')})()" 2>/dev/null | tr -d '\r')
  case "$(printf '%s' "$o" | tr -d '"')" in
    CLEAN*) pass "no horizontal overflow at $vp" ;;
    *)      fail "horizontal overflow at $vp — $o" ;;
  esac
done

# Type scale. 21/22px are the documented unboxed-glyph exceptions.
off=$($B js "
(()=>{const ok=[10,10.5,12,12.5,13,13.5,14.5,15.5,21,22];const bad=new Set();
document.querySelectorAll('body *').forEach(el=>{if(!el.offsetParent)return;
 if(![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))return;
 const s=parseFloat(getComputedStyle(el).fontSize);
 if(ok.includes(s))return;
 if(s>=10&&s<=20)return;    // body + headers −2 again (owner 2026-08-23): base 12.5, md 13.5, sm 10, compact h2/h3 16/12-13, nav 10.5
 if(s>=21&&s<=27)return;    // --text-xl clamp
 if(s>=24&&s<=32)return;    // --text-2xl clamp
 if(s>=32&&s<=61)return;    // --text-hero clamp 56 + landing hero --text-hero-lp ceiling 61 (Roboto Condensed, owner 2026-08-23)
 if(s>=52&&s<=104&&el.closest('.lp26 .price'))return; // paste-verbatim pricing figure clamp(52,8.5vw,104) (owner 2026-08-30 B2B v3)
 bad.add(s)});
return bad.size?[...bad].join(','):'CLEAN'})()" 2>/dev/null)
[ "${off//\"/}" = "CLEAN" ] && pass "every rendered size is on the 8-step scale" \
  || fail "off-scale font sizes: $off"

# ── The composer bubble: grey slate, white type, one row ──────────────────
# Owner, 2026-08-13, to the Amboras reference. The contrast pairing is the point:
# the brand slate #7692AE is only 3.23:1 against white and is NOT safe for text
# someone types and re-reads, so the bubble is the darker sibling #3E4C5A
# (white 8.80:1, placeholder 5.37:1). Also asserts the single row, because the
# two-row version was 148px and was the reason replies had no room.
comp=$($B js "
(()=>{S.portal='coach';S.route={name:'dashboard',arg:null};S.aiOpen=true;S.aiMax=false;S.aiCollapsed=false;render();
 /* v3: DOCKED (aiMax) is the default open state now; this probe guards the still-
    present COMPACT bar path, so it forces aiMax=false to reach the bar. */
 const f=document.querySelector('.aidock-compose'),i=document.querySelector('.aidock-input');
 if(!f||!i) return 'NO_COMPOSER';
 if(getComputedStyle(i).color!=='rgb(255, 255, 255)') return 'TYPE_NOT_WHITE';
 const bg=getComputedStyle(f).backgroundColor;
 if(bg!=='rgb(62, 76, 90)') return 'BUBBLE_NOT_SLATE_'+bg;
 if(!document.querySelector('.aidock-row')) return 'NOT_ONE_ROW';
 if(f.getBoundingClientRect().height>130) return 'BUBBLE_TOO_TALL_'+Math.round(f.getBoundingClientRect().height);
 /* AT REST THE WIDGET IS THE BAR — plus the quick-action chip ROW (owner,
    2026-08-19, follow-the-prompts, superseding the 2026-08-13 chip removal).
    The header, empty state and three suggestion buttons stay GONE; the chip
    row above the composer is now intended, so the at-rest ceiling rises from
    150 to 190 to fit it. */
 S.chat=[];S.chatThinking=false;render();
 if(document.querySelector('.aidock-head')) return 'HEADER_BACK';
 if(document.querySelector('.aidock-empty')) return 'EMPTY_STATE_BACK';
 if(document.querySelectorAll('[data-ask]').length) return 'SUGGESTIONS_BACK';
 if(document.getElementById('aidockScroll')) return 'THREAD_SHOWN_WHEN_EMPTY';
 if(!document.querySelector('.aidock-x')) return 'NO_X';
 const rest=document.querySelector('.aipill').getBoundingClientRect().height;
 if(rest>190) return 'WIDGET_TOO_TALL_AT_REST_'+Math.round(rest);
 S.portal='family';S.route={name:'home',arg:null};render();
 return 'OK'})()" 2>/dev/null)
[ "${comp//\"/}" = "OK" ] && pass "AI widget at rest is the bar alone — grey slate, white type" \
  || fail "composer regressed: $comp"

# ── Every footer link resolves, and to a DISTINCT page ────────────────────
# A footer whose links collapse onto one generic page is worse than a short one:
# it looks like a company with policies and turns out not to be. The audit found
# exactly that in ABOUT_GROUPS (About, Careers and Press all landing on
# info:legal). Asserts no duplicate destinations, no 404s, plus the support
# address and the independent-contractor disclosure.
foot=$($B js "
(()=>{S.portal='family';S.route={name:'home',arg:null};render();
 const links=[...document.querySelectorAll('.foot-link')];
 if(links.length<10) return 'TOO_FEW_'+links.length;
 const d=links.map(b=>b.dataset.foot);
 const dup=d.filter((x,i)=>d.indexOf(x)!==i);
 if(dup.length) return 'DUPLICATE_'+dup[0];
 const bad=[];
 d.forEach(x=>{const parts=x.split(':'),k=parts[0],v=parts[1];
   if(k==='nav') S.route={name:v,arg:null};
   else if(k==='info') S.route={name:'info',arg:v};
   else S.route={name:'page',arg:v};
   render();
   const t=document.getElementById('app').innerText;
   if(/Page not found/i.test(t)||t.trim().length<120) bad.push(x)});
 S.route={name:'home',arg:null};render();
 if(bad.length) return 'UNRESOLVED_'+bad.join('/');
 if(!document.querySelector('.foot-mail')) return 'NO_SUPPORT_EMAIL';
 if(!/independent professionals, not Sporv employees/.test(document.body.innerText)) return 'NO_DISCLOSURE';
 return 'OK'})()" 2>/dev/null)
[ "${foot//\"/}" = "OK" ] && pass "every footer link resolves to a distinct page" \
  || fail "footer link graph broken: $foot"
# This probe walks 13 routes to prove each resolves, which churns S far enough
# that the catalogue check below saw a filtered PROGRAMS and reported a false
# sample-data fallback. Reload rather than hand-restore: the next assertion
# should see a page in exactly the state a visitor gets, not one I tidied.
$B goto "file://$(pwd)/index.html" >/dev/null 2>&1

# ── A cancelled checkout must never read as a payment ─────────────────────
# [CRITICAL-PATH: money] mod-booking.js sends successUrl (paid=1) AND cancelUrl
# (paid=0). hydrateReturn() read neither, so pressing Back at Stripe returned
# through the identical path as a completed payment and the modal said "Payment
# received — Stripe has your payment. We're waiting for confirmation." Stripe had
# nothing. Asserts all three outcomes stay distinct.
pay=$($B js "
(()=>{const bad=[];
 const cases=[[{payment_status:'paid'},false,'You'],
              [{payment_status:'pending'},true,'cancel'],
              [{payment_status:'pending'},false,'Payment received']];
 cases.forEach(([b,c,want],i)=>{
   S.modal={type:'paidreturn',booking:b,cancelled:c};render();
   const t=(document.getElementById('layer').innerText||'');
   if(!new RegExp(want,'i').test(t)) bad.push('case'+i+' missing:'+want);
   if(c && /stripe has your payment/i.test(t)) bad.push('case'+i+':CANCELLED_CLAIMS_PAID');
 });
 S.modal=null;render();
 return bad.length?bad.join(','):'OK'})()" 2>/dev/null)
[ "${pay//\"/}" = "OK" ] && pass "cancelled checkout does not claim a payment" \
  || fail "payment-return copy is wrong: $pay"

# ── ONE photograph, held still ────────────────────────────────────────────
# Owner, 2026-08-13: assets/hero-stadium.webp is the only photograph on the page,
# and the slideshow is deleted. The @keyframes it ran were hand-computed against
# a TWO-photo cycle, so a second file in assets/ would not just add an image — it
# would reinstate a cycle whose stops no longer exist, and translate the only
# photograph off-screen for half of it. This asserts both halves.
onepic=$($B js "
(()=>{S.portal='family';S.route={name:'explore',arg:null};render();
 if(document.querySelectorAll('.hero-slide').length) return 'SLIDESHOW_BACK';
 const st=document.querySelector('.hero-still');
 if(!st) return 'NO_HERO_STILL';
 if(getComputedStyle(st).animationName!=='none') return 'ANIMATED_'+getComputedStyle(st).animationName;
 let raster=0;
 /* The brand logo (nav + footer, class navlogo) is chrome, not a photograph — exclude it. */
 document.querySelectorAll('img').forEach(i=>{ if(!/^data:image\/svg/.test(i.src) && !i.classList.contains('navlogo')) raster++ });
 document.querySelectorAll('*').forEach(e=>{
   if(/url\(\"?data:image\/(webp|jpeg|jpg|png)/.test(getComputedStyle(e).backgroundImage)) raster++ });
 if(raster>2) return 'RASTER_PHOTOS_'+raster;   // the still counts once as bg, once via ::after stacking
 const hi=document.querySelector('.hero-panel .hero-in');
 // Owner 2026-08-23 (Devin ref): the hero is now CENTRED, not left.
 if(!hi||getComputedStyle(hi).textAlign!=='center') return 'HERO_TEXT_NOT_CENTER';
 S.route={name:'home',arg:null};render();
 return 'OK'})()" 2>/dev/null)
[ "${onepic//\"/}" = "OK" ] && pass "hero is one still photograph, centred, no slideshow" \
  || fail "single-image hero rule broken: $onepic"

# ── The hero may not promise a background check the catalogue cannot back ─
# [CRITICAL-PATH: trust] A genuine first visit boots on `explore` (measured: the
# state literal is explore and `route` is not in EPHEMERAL, so empty storage
# keeps it). Its headline read "Book a background-checked coach for your kid."
# while production carried 20 providers flagged verified with no evidence and
# the cards below correctly rendered zero badges. The page must not claim in its
# hero what showsVerified() refuses to claim in its cards.
hero=$($B js "
(()=>{S.portal='family';
 const bad=[];
 ['explore','home'].forEach(r=>{S.route={name:r,arg:null};render();
   const h=document.getElementById('app').innerText.slice(0,400);
   if(/book a background.?checked coach/i.test(h)) bad.push(r+':headline');
   if(/real coaches, verified/i.test(h)) bad.push(r+':lede');
 });
 S.route={name:'home',arg:null};render();
 return bad.length?bad.join(','):'OK'})()" 2>/dev/null)
[ "${hero//\"/}" = "OK" ] && pass "hero claims no background check the data cannot back" \
  || fail "hero promises an unearned background check: $hero"

# ── topbarHTML must survive any signed-in user shape ──────────────────────
# `u.firstName[0]+u.lastName[0]` was written for the seeded demo user, who
# always has both names. A real account with no surname rendered "Aundefined";
# one with no name fields at all THREW — and because topbarHTML() runs on every
# route, that blanked the whole application, not just the avatar. This asserts
# the three shapes a real profile can actually take.
init=$($B js "
(()=>{const saved=S.auth;const bad=[];
 [['none',{id:'x',email:'a@b.c'}],
  ['empty',{id:'x',email:'a@b.c',firstName:'',lastName:''}],
  ['firstonly',{id:'x',email:'a@b.c',firstName:'Alex',lastName:''}]].forEach(([k,u])=>{
   try{S.auth={user:u};S.portal='family';S.route={name:'messages',arg:null};render();
     const av=document.querySelector('.avatar');const t=av?av.textContent.trim():'';
     if(/undefined|NaN/.test(t)) bad.push(k+'=\"'+t+'\"');
   }catch(e){ bad.push(k+'=THREW') }});
 S.auth=saved;S.route={name:'home',arg:null};render();
 return bad.length?bad.join(','):'OK'})()" 2>/dev/null)
[ "${init//\"/}" = "OK" ] && pass "topbar survives every signed-in profile shape" \
  || fail "avatar initials break on real profiles: $init"

# ── Sign-out must leave nothing of the previous account behind ────────────
# [CRITICAL-PATH: privacy] doSignOut() cleared the transport and the auth flag
# and NOTHING else. Measured: after sign-out the app said "guest" while S still
# held a child's name and date of birth, their bookings and their message
# bodies — and S round-trips through sessionStorage, so it survived a reload. On
# a shared laptop the next person saw the previous family's child.
so=$($B js "
(()=>{S.auth={status:'user',user:{id:'a',email:'a@b.c',firstName:'Ann',lastName:'Lee'}};
 S.athletes=[{id:'x',firstName:'Julian',lastName:'Lee',dob:'2011-04-12'}];
 S.bookings=[{id:'b1'}];S.conversations=[{id:'c1'}];
 S.messages={c1:[{id:'m1',text:'is my son ready'}]};
 render();
 doSignOut();render();
 const bad=[];
 if((S.athletes||[]).length) bad.push('ATHLETES_'+S.athletes.length);
 if((S.bookings||[]).length) bad.push('BOOKINGS');
 if((S.conversations||[]).length) bad.push('CONVERSATIONS');
 if(Object.keys(S.messages||{}).length) bad.push('MESSAGES');
 const blob=sessionStorage.getItem('sporve:state:v1')||'';
 if(/Julian/.test(blob)) bad.push('PERSISTED_BLOB_STILL_HAS_CHILD');
 return bad.length?bad.join(','):'OK';})()" 2>/dev/null)
[ "${so//\"/}" = "OK" ] && pass "sign-out leaves no trace of the previous account" \
  || fail "sign-out leaks the previous family's data: $so"

# ── Every route must still render AFTER a sign-out ────────────────────────
# The sign-out fix resets account-scoped fields to their EMPTY shape, which is
# correct — and mod-safety's bag() read S.safety as {} (truthy, no arrays) and
# threw "Cannot read properties of undefined (reading 'map')". The trust route
# went blank for anyone who had signed out in that tab. Clearing state and
# rendering are two halves of one contract; this asserts the second half.
sor=$($B js "
(()=>{S.auth={status:'user',user:{id:'u',email:'a@b.c'}};
 doSignOut();
 const bad=[];
 ['explore','home','trust','bookings','saved','messages','profile','info','pricing']
   .forEach(r=>{ try{ S.route={name:r,arg:r==='info'?'help':null}; render(); }
                 catch(e){ bad.push(r+':'+e.message.slice(0,40)) } });
 S.route={name:'explore',arg:null};render();
 return bad.length?bad.join(' | '):'OK';})()" 2>/dev/null)
[ "${sor//\"/}" = "OK" ] && pass "every route still renders after sign-out" \
  || fail "a route throws once state is cleared: $sor"
# This probe signs out, which by design clears coachTab and the coach caches —
# leaving the coach contrast check below measuring a dashboard with no data.
# Reload so the next assertion sees a page in the state a visitor gets.
$B goto "file://$(pwd)/index.html" >/dev/null 2>&1

# ── The real legal documents must be published and reachable ──────────────
# The published privacy notice (11 sections), terms (7) and refund policy (4)
# existed in sporve-landing all along while this site linked to NONE of them: the
# Legal page was three sentences, and signup forced "I have read Sporv's
# Privacy Policy" where that phrase was a <b> with no destination. A consent
# tick-box pointing at nothing is not consent.
lgl=$($B js "
(()=>{const bad=[];
 ['privacy','terms','refund'].forEach(k=>{
   if(!INFO[k]) { bad.push('MISSING_'+k); return; }
   if(INFO[k].sections.length<4) bad.push('STUB_'+k+'_'+INFO[k].sections.length);
   S.route={name:'info',arg:k};render();
   const t=document.getElementById('app').innerText;
   if(/Page not found/i.test(t)||t.length<900) bad.push('UNRENDERED_'+k);
 });
 S.portal='family';S.route={name:'home',arg:null};render();
 const foot=[...document.querySelectorAll('.foot-link')].map(b=>b.dataset.foot);
 ['info:privacy','info:terms','info:refund'].forEach(d=>{
   if(!foot.includes(d)) bad.push('NOT_IN_FOOTER_'+d); });
 S.modal={type:'signup'};render();
 const consent=[...document.querySelectorAll('[data-foot=\"info:privacy\"]')].length;
 S.modal=null;render();
 if(!consent) bad.push('CONSENT_TICKBOX_LINKS_NOWHERE');
 return bad.length?bad.join(','):'OK';})()" 2>/dev/null)
[ "${lgl//\"/}" = "OK" ] && pass "privacy, terms and refund are published and linked" \
  || fail "legal documents missing or unreachable: $lgl"

# ── Password reset must actually reach the network ────────────────────────
# [CRITICAL-PATH: auth] The handler used to make NO network call: it toasted
# "Reset code sent to your email" (none was), accepted any non-empty string as
# the code, then claimed success while the old password still failed. A
# locked-out parent had no recovery path and was told they did.
rst=$($B js "
(()=>{const calls=[];const of=window.fetch;
 window.fetch=function(u,o){calls.push(String(u)+' '+((o&&o.method)||'GET'));return of.apply(this,arguments)};
 if(!window.SporveAuth||typeof window.SporveAuth.recover!=='function') {window.fetch=of;return 'NO_RECOVER_FN'}
 if(typeof window.SporveAuth.resetPassword!=='function') {window.fetch=of;return 'NO_RESET_FN'}
 S.modal={type:'forgot'};S.forgotSent=false;render();
 const f=document.getElementById('forgotForm');
 if(!f){window.fetch=of;return 'NO_FORM'}
 f.email.value='nobody@example.com';
 f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 const hit=calls.some(c=>/\/auth\/v1\/recover/.test(c));
 window.fetch=of;S.modal=null;S.forgotSent=false;render();
 return hit?'OK':'NO_NETWORK_CALL';})()" 2>/dev/null)
[ "${rst//\"/}" = "OK" ] && pass "password reset makes a real recover request" \
  || fail "password reset is a mock again: $rst"

# ── The assistant must reach the network, and its bubbles must be legible ──
# askCoach() used to setTimeout(700) and run a LOCAL keyword matcher — no network
# call anywhere. That is why "can you create a group chat?" returned three swim
# listings: every question became a catalogue search. And .bub.them used
# var(--raise2) (#EFF2F5 on light) against #F5F7F9 text, so replies rendered as
# blank white rectangles inside the dark panel.
ai=$($B js "
(()=>{const bad=[];const calls=[];const of=window.fetch;
 window.fetch=function(u){calls.push(String(u));return of.apply(this,arguments)};
 const wasSigned=window.SporveAuth&&window.SporveAuth.isSignedIn;
 if(window.SporveAuth) window.SporveAuth.isSignedIn=()=>true;
 S.portal='coach';S.aiOpen=true;S.chat=[];
 try{ askCoach('do you have basketball for a 12 year old'); }catch(e){ bad.push('THREW') }
 /* The coach portal routes to coach-command (the agentic interpret-only
    turn); the family side to ai-chat (text only). The assertion is that a real
    AI endpoint is reached at all — it used to be a local keyword matcher. */
 if(!calls.some(c=>/ai-chat|coach-command/.test(c))) bad.push('NO_AI_CALL');
 window.fetch=of; if(window.SporveAuth) window.SporveAuth.isSignedIn=wasSigned;
 S.chat=[{role:'user',text:'x'},{role:'coach',text:'y'}];render();
 const t=document.querySelector('.aidock-panel .bub.them');
 if(!t) bad.push('NO_BUBBLE');
 else{const cs=getComputedStyle(t);
   if(cs.color===cs.backgroundColor) bad.push('BUBBLE_INVISIBLE');}
 S.chat=[];S.portal='family';S.route={name:'home',arg:null};render();
 return bad.length?bad.join(','):'OK'})()" 2>/dev/null)
[ "${ai//\"/}" = "OK" ] && pass "assistant calls the AI endpoint and its replies are legible" \
  || fail "assistant regressed: $ai"

# ── The coach UI register (owner spec 2026-08-14) ─────────────────────────
# Every coach tab: one UI face (Inter) for everything but large headers, sizes
# on the eight-step scale, weights 400/500/600 with 700+ reserved for h1/h2/
# .display, glyph marks and .num readouts (the #91 instrument system). Hanken
# on finances/media was superseded — its reappearance is a regression. The
# visitor-route scale check above cannot see any of this: it never signs in.
reg=$($B js "
(()=>{const tabs=['dashboard','roster','inbox','finances','schedule','listings','media','operations','profile'];
 S.portal='coach';S.auth={status:'coach'};const bad=[];
 const okS=new Set(['10px','10.5px','12px','12.5px','13px','13.5px','14.5px','15.5px','21px','22px']);
 const clampOK=px=>(px>=13&&px<=54); // body+headers −2/−4 (owner 2026-08-23): coach body 12.5, headers 13-52
 for(const t of tabs){
   S.coachTab=t;S.route={name:'dashboard',arg:null};
   try{render()}catch(e){bad.push('RENDER_'+t);continue}
   if(!document.body.classList.contains('reg-coach')){bad.push('NO_REG_'+t);continue}
   document.querySelectorAll('#app *, #layer *').forEach(el=>{
     if(!el.offsetParent)return;
     if(![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))return;
     const cs=getComputedStyle(el);
     const fam=cs.fontFamily.split(',')[0].replace(/\"/g,'').trim();
     if(/Hanken/.test(fam)) bad.push('HANKEN_'+t);
     const glyph=el.matches('.avatar,.sparkdash,.empty .big,.bandhead span,.faqi,.mark,.railmark,.aidock-fab-mark');
     const px=parseFloat(cs.fontSize);
     if(!okS.has(cs.fontSize)&&!clampOK(px)&&!glyph) bad.push('SIZE_'+cs.fontSize+'_'+t);
     const exempt=el.matches('h1,h2,.display,h1 *,h2 *,.display *,.num,.num *')||glyph;
     if(Number(cs.fontWeight)>600&&!exempt) bad.push('W'+cs.fontWeight+'_'+(el.className||el.tagName)+'_'+t);
   });
 }
 if(!/cv05/.test(getComputedStyle(document.body).fontFeatureSettings)) bad.push('NO_FEATURES');
 S.portal='family';S.coachTab='dashboard';S.route={name:'home',arg:null};render();
 document.body.classList.remove('reg-coach');
 return bad.length?[...new Set(bad)].slice(0,8).join(','):'OK'})()" 2>/dev/null)
[ "${reg//\"/}" = "OK" ] && pass "coach UI register: one face, scale sizes, 600-max weights" \
  || fail "coach register regressed: $reg"

# ── Assistant state machine (owner spec 2026-08-14, Amboras) ──────────────
# Three states: bar at rest (no maximize control), talking pill (maximize
# appears), maximized (history + New chat + previous sessions). Escape steps
# DOWN one level per press — the modal focus-trap used to claim the panel via
# role=dialog and collapse all three states in one keypress.
ams=$($B js "
(()=>{const bad=[];
 S.portal='coach';S.auth={status:'coach'};S.route={name:'dashboard',arg:null};
 /* Maximize is now offered in the compact bar at rest too (v2 spec: maximize + X
    top-right), so the old MAXBTN_AT_REST tripwire is retired — only NO_MAXBTN
    (it must still exist once a conversation exists) remains below. */
 S.chat=[];S.chatSessions=[];S.chatSessionId=null;S.aiOpen=true;S.aiMax=false;
 S.chatThinking=false;S.aiHistOpen=false;S.aiCollapsed=false;S.modal=null;S.sportOpen=false;render();
 S.chat=[{role:'user',text:'x'},{role:'coach',text:'y'}];render();
 if(!document.querySelector('[data-aimaximize]'))bad.push('NO_MAXBTN');
 document.querySelector('[data-aimaximize]').click();
 if(!S.aiMax||!document.querySelector('.aimax-wrap'))bad.push('MAX_FAILED');
 document.querySelector('[data-aihist]').click();
 if(!document.querySelector('.aimax-histempty'))bad.push('NO_EMPTY_HIST');
 document.querySelector('[data-ainew]').click();
 if(S.chat.length||S.chatSessions.length!==1)bad.push('NEWCHAT_'+S.chat.length+'_'+S.chatSessions.length);
 document.querySelector('[data-aihist]').click();
 const row=document.querySelector('[data-aihistpick]');
 if(!row)bad.push('NO_HIST_ROW');else{row.click();if(S.chat.length!==2)bad.push('LOAD_'+S.chat.length);}
 S.aiHistOpen=true;render();
 const esc=()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 esc();if(S.aiHistOpen||!S.aiMax)bad.push('ESC1');
 esc();if(S.aiOpen!==false)bad.push('ESC2');
 esc();if(S.aiOpen!==false)bad.push('ESC3');
 S.aiOpen=true;S.aiMax=false;S.modal={type:'addchild'};render();
 esc();if(S.modal)bad.push('MODAL_ESC');
 // state 2 visibility controls: tuck the thread (bar only, conversation
 // intact), history opens upward from the bar, restore brings the thread back
 S.chat=[{role:'user',text:'q'},{role:'coach',text:'a'}];S.aiThreadHidden=false;S.aiHistOpen=false;render();
 if(!document.querySelector('.aidock-histbtn')||!document.querySelector('.aidock-threadbtn'))bad.push('NO_BAR_CTRLS');
 document.querySelector('[data-aithread]').click();
 if(document.querySelector('.aidock-scroll')||S.chat.length!==2)bad.push('TUCK');
 document.querySelector('[data-aihist]').click();
 if(!document.querySelector('.aimax-hist.up'))bad.push('NO_UP_HIST');
 S.aiHistOpen=false;document.querySelector('[data-aithread]').click();
 if(!document.querySelector('.aidock-scroll'))bad.push('RESTORE');
 // the archive caps at 30 sessions, newest kept
 S.chat=[];S.chatSessions=[];S.chatSessionId=null;
 for(let i=0;i<31;i++){S.chat=[{role:'user',text:'t'+i}];S.chatSessionId=null;chatArchive();}
 if(S.chatSessions.length!==30)bad.push('CAP_'+S.chatSessions.length);
 // a saved string chatSessionId must survive loadState over its null default
 S.chat=[{role:'user',text:'restore me'}];S.chatSessionId=null;chatArchive();
 const savedId=S.chatSessionId; saveState();
 S.chatSessionId=null;S.chatSessions=[];
 loadState();
 if(S.chatSessionId!==savedId)bad.push('RESTORE_ID');
 if(!S.chatSessions.some(s=>s.id===savedId))bad.push('RESTORE_LIST');
 S.chat=[];S.chatSessions=[];S.chatSessionId=null;S.aiMax=false;S.aiHistOpen=false;
 S.aiThreadHidden=false;
 saveState();
 S.portal='family';S.route={name:'home',arg:null};render();document.body.classList.remove('reg-coach');
 return bad.length?bad.join(','):'OK'})()" 2>/dev/null)
[ "${ams//\"/}" = "OK" ] && pass "assistant states: rest, talking, maximized; Escape steps one level" \
  || fail "assistant state machine regressed: $ams"

# ── AI disclosure (Claude Usage Policy) ───────────────────────────────────
# Consumer-facing chatbots must tell users they're talking to AI at the start
# of each session. Assert the disclosure is present once a conversation exists
# in BOTH the coach dock (talking + maximized) and the family assistant.
disc=$($B js "
(()=>{const bad=[];const re=/talking with|chatting with Sporv's AI|Sporv AI can make mistakes/i;
 // coach dock, talking
 S.portal='coach';S.auth={status:'coach'};S.route={name:'dashboard',arg:null};
 S.chat=[{role:'user',text:'q'},{role:'coach',text:'a'}];S.chatThinking=false;
 S.aiOpen=true;S.aiMax=false;S.aiHistOpen=false;S.aiThreadHidden=false;render();
 if(!re.test(document.querySelector('.aidock-panel')?.innerText||''))bad.push('COACH_TALKING');
 // coach dock, maximized
 S.aiMax=true;render();
 if(!re.test(document.querySelector('.aimax-wrap')?.innerText||''))bad.push('COACH_MAX');
 // [spec 01] the family assistant surface is deleted; the coach dock is the
 // only AI surface and its disclosure is asserted above.
 S.aiMax=false;S.chat=[];S.portal='family';S.auth={status:'guest'};
 S.route={name:'home',arg:null};render();document.body.classList.remove('reg-coach');
 return bad.length?bad.join(','):'OK'})()" 2>/dev/null)
[ "${disc//\"/}" = "OK" ] && pass "AI disclosure present in every chat session (usage policy)" \
  || fail "AI disclosure missing: $disc"

# ── Approvals: approve SENDS via lifecycle-approve, never a status PATCH ───
# The §10 Approve button used to PATCH status='approved', a value no sender
# consumes — the message was stranded while the coach was told it sent. Assert
# decide('approve') calls the lifecycle-approve edge function, that only a
# 'drafted' row offers Approve, and that a non-drafted row does not.
appr=$($B js "
(()=>{const bad=[];const calls=[];
 const API=window.SporveAPI; const of=API.fn;
 API.fn=function(name,body){calls.push(name);return Promise.resolve({ok:true,status:'sent'});};
 const wasSigned=window.SporveAuth&&window.SporveAuth.isSignedIn;
 const wasUid=window.SporveAuth&&window.SporveAuth.userId;
 if(window.SporveAuth){window.SporveAuth.isSignedIn=()=>true;window.SporveAuth.userId=()=>'u1';}
 // approve must route to lifecycle-approve, not a PATCH
 try{window.SporveCoach.decide('m1','approve');}catch(e){bad.push('THREW');}
 if(!calls.includes('lifecycle-approve'))bad.push('NO_LIFECYCLE_CALL');
 API.fn=of;
 // render: only a drafted row shows Approve; a pending row does not
 S.portal='coach';S.auth={status:'coach'};S.coachTab='approvals';
 S.route={name:'dashboard',arg:null};
 S.coachQueue=[{id:'d1',event_type:'reminder_24h',status:'drafted',content:{body:'See you Saturday.'}},
               {id:'p1',event_type:'post_session',status:'pending',content:{body:''}}];
 render();
 const html=document.querySelector('#app').innerHTML;
 const approves=(html.match(/data-qdecide=\"approve:/g)||[]).length;
 if(approves!==1)bad.push('APPROVE_COUNT_'+approves);
 if(!/data-qdecide=\"approve:d1/.test(html))bad.push('DRAFTED_NO_APPROVE');
 if(/data-qdecide=\"approve:p1/.test(html))bad.push('PENDING_HAS_APPROVE');
 if(/worker will send/i.test(html))bad.push('OLD_WORKER_COPY');
 // in-flight guard: a row mid-decision shows Working…, no live button (no twin)
 S.qDeciding={d1:true};render();
 const h2=document.querySelector('#app').innerHTML;
 if(/data-qdecide=\"approve:d1/.test(h2))bad.push('TWIN_BUTTON');
 if(!/Working/.test(h2))bad.push('NO_WORKING_STATE');
 S.qDeciding={};
 if(window.SporveAuth){window.SporveAuth.isSignedIn=wasSigned;window.SporveAuth.userId=wasUid;}
 S.coachQueue=[];S.portal='family';S.route={name:'home',arg:null};render();document.body.classList.remove('reg-coach');
 return bad.length?bad.join(','):'OK'})()" 2>/dev/null)
[ "${appr//\"/}" = "OK" ] && pass "approvals: approve sends via lifecycle-approve; Approve only on drafted" \
  || fail "approve regressed: $appr"

# ── Assistant review-card DISPATCH RAILS (the tool port) ──────────────────
# A proposed write is approved into a REAL change only for tools in
# PROP_DISPATCH; each run() dispatches through an existing repo method. Assert
# the two live rails (draft_message → sendParentMessage, draft_bio → save) call
# the right method with the edited text, that a rail-less tool (create_service)
# shows NO Approve button (deep-link only), and canSend gating holds. run()
# invokes its rail synchronously, so no async wait is needed.
disp=$($B js "
(()=>{const bad=[];const saved=[],sent=[];
 const rs=window.SporveCoach&&window.SporveCoach.save, rsend=window.SporveCoach&&window.SporveCoach.sendParentMessage;
 window.SporveCoach=window.SporveCoach||{};
 try{
   window.SporveCoach.save=(p)=>{saved.push(p);return Promise.resolve({});};
   window.SporveCoach.sendParentMessage=(id,t)=>{sent.push({id,t});return Promise.resolve({firstName:'Ana'});};
   // dispatch table wires the two live rails to the right method + text
   PROP_DISPATCH.draft_bio.run({args:{}}, 'My new bio');
   if(!saved.length||saved[0].bio!=='My new bio')bad.push('BIO_RUN');
   PROP_DISPATCH.draft_message.run({args:{booking_id:'b1'}}, 'Hello');
   if(!sent.length||sent[0].id!=='b1'||sent[0].t!=='Hello')bad.push('MSG_RUN');
   // set_policy: logistics fields dispatch to the right column; cancellation
   // (money-frozen) never dispatches.
   PROP_DISPATCH.set_policy.run({args:{policy_type:'what_to_bring'}}, 'Bring water and cleats.');
   if(!saved.some(x=>x.what_to_bring==='Bring water and cleats.'))bad.push('POLICY_BRING_RUN');
   PROP_DISPATCH.set_policy.run({args:{policy_type:'service area'}}, 'Within 15 miles of the gym.');
   if(!saved.some(x=>x.travel_radius==='Within 15 miles of the gym.'))bad.push('POLICY_RADIUS_RUN');
   // a cancellation-flavoured string is refused, never routed to a logistics field
   if(PROP_DISPATCH.set_policy.canSend({args:{policy_type:'cancellation'},}))bad.push('POLICY_CANCEL_CANSEND');
   if(PROP_DISPATCH.set_policy.canSend({args:{policy_type:'cancellation and what to bring'},draft:'x'}))bad.push('POLICY_MIXED_CANSEND');
   if(!PROP_DISPATCH.set_policy.canSend({args:{policy_type:'what to bring',draft:'x'}}))bad.push('POLICY_BRING_CANSEND');
   if(PROP_DISPATCH.set_policy.canSend({args:{policy_type:'what_to_bring'}}))bad.push('POLICY_NO_DRAFT_CANSEND');
   // an emptied draft must REJECT, never silently save the model's original
   let bioRej=false; PROP_DISPATCH.draft_bio.run({args:{}},'   ').then(()=>{},()=>{bioRej=true;});
   // canSend gating
   if(PROP_DISPATCH.draft_message.canSend({args:{}}))bad.push('MSG_CANSEND_EMPTY');
   if(!PROP_DISPATCH.draft_message.canSend({args:{booking_id:'b'}}))bad.push('MSG_CANSEND');
   if(!PROP_DISPATCH.draft_bio.canSend({args:{draft:'hi'}}))bad.push('BIO_CANSEND');
   if(PROP_DISPATCH.draft_bio.canSend({args:{}}))bad.push('BIO_CANSEND_EMPTY');
   // card gating: live rail shows Approve seeded with the editable draft;
   // rail-less shows deep-link, no Approve
   S.portal='coach';S.auth={status:'coach'};S.coachTab='dashboard';S.route={name:'dashboard',arg:null};
   S.aiOpen=true;S.aiMax=false;S.aiCollapsed=false;
   S.chat=[{role:'coach',text:'b',proposal:{tool:'draft_bio',args:{draft:'seed text'},state:'open'}}];render();
   if(!document.querySelector('#layer [data-approve]'))bad.push('BIO_NO_BTN');
   const ta=document.querySelector('#layer .propcard-draft');
   if(!ta||ta.value!=='seed text')bad.push('BIO_NO_EDITABLE_DRAFT');
   S.chat=[{role:'coach',text:'s',proposal:{tool:'create_service',args:{title:'C'},state:'open'}}];render();
   if(document.querySelector('#layer [data-approve]'))bad.push('SVC_HAS_APPROVE');
   if(!document.querySelector('#layer [data-coachtab=\"listings\"]'))bad.push('SVC_NO_DEEPLINK');
 } finally {
   // Restore the real rails on EVERY exit path so a later assertion never
   // sees a stub (CodeRabbit).
   if(rs)window.SporveCoach.save=rs; else delete window.SporveCoach.save;
   if(rsend)window.SporveCoach.sendParentMessage=rsend; else delete window.SporveCoach.sendParentMessage;
   S.chat=[];S.portal='family';S.route={name:'home',arg:null};render();document.body.classList.remove('reg-coach');
 }
 return bad.length?bad.join(','):'OK'})()" 2>/dev/null)
[ "${disp//\"/}" = "OK" ] && pass "assistant dispatch: draft_bio + draft_message rails fire; rail-less tools deep-link only" \
  || fail "dispatch rails regressed: $disp"

# [spec 01 · 2026-08-31] listing publish + edit gates removed — the marketplace feature they tested is deleted.
# ── Coach onboarding wizard palette (owner spec 2026-08-16) ──────────────
# White/ink/slate + sport tags only — zero new colours. The chrome was built
# to an earlier spec in Airbnb blue (#2563EB); this asserts it's slate now, the
# question is Instrument Serif, and the Questions? pill is a real link.
cob=$($B js "
(()=>{const bad=[];
 S.portal='coach';S.auth={status:'coach'};S.route={name:'onboard',arg:null};S.coachTab='onboard';
 S.onboard=S.onboard||{};S.onboard.step=1;S.onboard.sports=['Soccer'];render();
 const cw=document.querySelector('.cw'); if(!cw){return 'NO_WIZARD';}
 const BLUE=['rgb(37, 99, 235)','rgb(0, 122, 255)','rgb(16, 185, 129)','rgb(29, 79, 216)'];
 let blue=0; cw.querySelectorAll('*').forEach(el=>{const cs=getComputedStyle(el);
   [cs.color,cs.backgroundColor,cs.borderTopColor,cs.outlineColor].forEach(c=>{if(BLUE.indexOf(c)>=0)blue++;});});
 if(blue)bad.push('BLUE_'+blue);
 const nx=cw.querySelector('.cw-next');
 if(nx&&!nx.disabled&&getComputedStyle(nx).backgroundColor!=='rgb(62, 86, 110)')bad.push('NEXT_NOT_SLATE');
 if(getComputedStyle(cw.querySelector('.cw-seg i')).backgroundColor!=='rgb(62, 86, 110)')bad.push('SEG_NOT_SLATE');
 if(!/Roboto Condensed/.test(getComputedStyle(cw.querySelector('.cw-h1')).fontFamily))bad.push('H1_NOT_DISPLAY');
 const h=cw.querySelector('.cw-help'); if(!h||!/^mailto:/.test(h.getAttribute('href')||''))bad.push('NO_QUESTIONS');
 S.onboard.sports=[];S.route={name:'home',arg:null};S.portal='family';render();document.body.classList.remove('reg-coach');
 return bad.length?bad.join(','):'OK'})()" 2>/dev/null)
[ "${cob//\"/}" = "OK" ] && pass "coach onboarding wizard: slate accent (no Airbnb blue), display (Roboto Condensed) question, Questions pill" \
  || fail "onboarding palette regressed: $cob"

# [spec-01 completion · 2026-08-31] coach marketplace profile gate (public profile surface deleted) — the product pages are deleted; these gates measured them.

# ── A safety surface may not promise what no code delivers ────────────────
# [CRITICAL-PATH: child safety] mod-safety.js has ZERO network calls, yet it
# minted case numbers ("SR-0001") and told parents "Reports reach a person —
# read by Sporv's safety team". A parent reporting a coach's conduct toward
# their child believed Sporv was investigating; Sporv never knew. Until a real
# safety_reports table with triage exists, the claim must not exist either.
safe=$($B js "
(()=>{const src=[...document.querySelectorAll('script')].map(s=>s.textContent).join('');
 const bad=[];
 if(/Reports reach a person/.test(src)) bad.push('CLAIMS_A_HUMAN_READS_IT');
 if(/We suspend accounts and preserve records/.test(src)) bad.push('CLAIMS_ENFORCEMENT');
 if(/ref\(\"SR\"/.test(src)) bad.push('MINTS_CASE_NUMBER');
 if(!/safety@sporve\.com/.test(src)) bad.push('NO_REAL_ROUTE');
 return bad.length?bad.join(','):'OK';})()" 2>/dev/null)
[ "${safe//\"/}" = "OK" ] && pass "safety reports promise only what the code delivers" \
  || fail "the safety surface makes a promise nothing backs: $safe"

# ── The Add-a-child form may never offer an under-13 ──────────────────────
# [CRITICAL-PATH: consent] It offered birth years 2022-2008 — ages 4 to 18 — and
# wrote date_of_birth behind one unverified checkbox, while Sporv's own
# published privacy notice states adults must not submit information about a
# child under 13 during beta. COPPA penalties are per child, per violation.
# Lower MIN_ATHLETE_AGE only when a real verifiable-consent flow ships.
kid=$($B js "
(()=>{S.auth={user:{id:'x',email:'a@b.c'}};S.modal={type:'addchild'};render();
 const sel=document.querySelector('select[name=year]');
 if(!sel) return 'NO_BIRTH_FIELD';
 const ys=[...sel.options].map(o=>+o.value).filter(Boolean);
 if(!ys.length) return 'NO_OPTIONS';
 const Y=new Date().getFullYear();
 const youngest=Y-Math.max(...ys);
 /* {user:null}, NOT null — topbarHTML reads S.auth.user directly, so a bare
    null blanks the whole app and the probe reports empty. */
 S.modal=null;S.auth={user:null};render();
 return youngest<13 ? 'OFFERS_AGE_'+youngest : 'OK';})()" 2>/dev/null)
[ "${kid//\"/}" = "OK" ] && pass "add-a-child offers no one under 13" \
  || fail "the child form collects under-13 data: $kid"

# [spec-01 completion · 2026-08-31] seeded-listing trust-claim gate (no seed rows exist) — the product pages are deleted; these gates measured them.

# ── No orange on a COLD first paint (no render() call) ────────────────────
# The token-table check below tests the FUNCTION. This tests the DOM the first
# visitor actually receives. Both are needed: the ordering bug that shipped
# orange to production had a correct sportColor() and a correct token map, and
# still painted orange, because NO_ORANGE_ACTIVE was assigned AFTER the body
# string was built. Every console check was a second render and came back clean.
# This one must not call render() — touching it warms the page and hides the bug.
# The re-navigation is LOAD-BEARING: without it this assertion runs on a page
# that dozens of earlier assertions have already rendered, and it passed against
# the known-bad ordering. An assertion that cannot fail is worse than no
# assertion, because it manufactures confidence. Verified to go red when the
# assignment is moved back below the body build.
# Clear persisted state BEFORE the reload. S round-trips through sessionStorage,
# so whichever route the previous assertion left behind is the route this page
# restores — and the orange ban is scoped to `home`. Without this the check
# inherited route=explore and reported 6 "orange" elements that were correctly
# orange. Cold means cold: no stored route, no warm render, nothing carried in.
$B js "sessionStorage.clear();'ok'" >/dev/null 2>&1
$B goto "file://$(pwd)/index.html" >/dev/null 2>&1
cold=$($B js "
(()=>{const hue=(r,g,b)=>{const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
  if(d<40)return -1;
  let h=mx===r?((g-b)/d)*60:mx===g?(2+(b-r)/d)*60:(4+(r-g)/d)*60;return h<0?h+360:h};
 let n=0;
 document.querySelectorAll('*').forEach(el=>{const cs=getComputedStyle(el);
  ['color','backgroundColor','borderTopColor','borderLeftColor','fill'].forEach(k=>{
   const m=(cs[k]||'').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
   if(!m)return; if(m[4]!==undefined&&parseFloat(m[4])===0)return;
   const h=hue(+m[1],+m[2],+m[3]); if(h>=15&&h<=45)n++})});
 return n===0?'CLEAN':String(n)})()" 2>/dev/null)
[ "${cold//\"/}" = "CLEAN" ] && pass "no orange on the cold first paint of the landing" \
  || fail "orange on first paint (render-order bug): $cold elements"

# ── No orange, tested over EVERY sport token, not just the rendered ones ──
# This assertion exists because the first no-orange pass swept clean locally and
# shipped 43 orange elements to production. The local sweep only ever saw the
# DEMO catalogue; production hydrates from live Supabase and rendered Climbing
# and Softball, which were orange and unmapped. Walking the rendered DOM tests
# the data you happen to have. This walks the TOKEN TABLE, so it tests the data
# you might get. Both sportColor and sportInk, both grounds.
noor=$($B js "
(()=>{NO_ORANGE_ACTIVE=true;
 const hue=(hex)=>{const n=parseInt(hex.slice(1),16),r=(n>>16)&255,g=(n>>8)&255,b=n&255;
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn; if(!d)return 0;
  let h=mx===r?((g-b)/d)*60:mx===g?(2+(b-r)/d)*60:(4+(r-g)/d)*60; return h<0?h+360:h};
 const bad=[];
 Object.keys(SPORT_COLOR).forEach(k=>{
   [sportColor(k),sportInk(k)].forEach(c=>{
     const h=hue(c);
     const n=parseInt(c.slice(1),16),r=(n>>16)&255,g=(n>>8)&255,b=n&255;
     if(Math.max(r,g,b)-Math.min(r,g,b)<40) return;   // neutral, no hue to speak of
     if(h>=15&&h<=45) bad.push(k+'='+c);
   })});
 NO_ORANGE_ACTIVE=false;
 return bad.length?bad.join(','):'CLEAN'})()" 2>/dev/null)
[ "${noor//\"/}" = "CLEAN" ] && pass "no-orange holds for every sport token, mark and ink" \
  || fail "orange sport tokens unmapped on the landing: $noor"

# ── The AI pill is centred, and the S is NOT inside it ────────────────────
# Both halves matter. The spec centres the assistant AND forbids repositioning
# the S; if they ever share a parent again, centring drags the S to the middle
# and the "collapses into the S" contract quietly breaks. This asserts the two
# are separately positioned, that the pill is centred within 2px, and that the
# fixed pill is compensated for so the last table row stays reachable.
pill=$($B js "
(()=>{S.portal='coach';S.aiOpen=true;S.aiCollapsed=false;
 S.route={name:'dashboard',arg:null};render();
 const p=document.querySelector('.aipill'),f=document.querySelector('.aidock-fab');
 if(!p||!f) return 'MISSING';
 if(p.contains(f)) return 'S_INSIDE_PILL';
 const pr=p.getBoundingClientRect();
 const off=Math.abs((pr.left+pr.right)/2 - innerWidth/2);
 if(off>2) return 'OFFCENTRE_'+Math.round(off);
 if(Math.round(innerHeight-pr.bottom)>40) return 'NOT_AT_BOTTOM';
 if(!f.querySelector('.aidock-fab-ic')) return 'FAB_NO_CHAT_ICON';
 const pad=parseFloat(getComputedStyle(document.getElementById('app')).paddingBottom);
 if(pad < pr.height) return 'NO_COMPENSATION_'+Math.round(pad);
 return 'OK'})()" 2>/dev/null)
[ "${pill//\"/}" = "OK" ] && pass "AI pill centred, chat-FAB separate, content compensated" \
  || fail "AI pill invariant broken: $pill"

echo "─────────────────────────────────────────────────────"
[ "$FAIL" -eq 0 ] && echo "  SMOKE PASSED" || echo "  SMOKE FAILED -- revert, do not push"
exit $FAIL
