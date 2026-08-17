#!/usr/bin/env bash
# Post-deploy verification against the real production URL.
#
# CI proves a PR is sound before merge. It does not prove what is actually being
# served afterwards: a deploy can fail, roll back, land a stale build, or lose
# headers to a config change, and none of that is visible from a green PR. This
# closes that gap — the repo's release rule is "not done until verified live",
# and this is that rule as code instead of a habit.
#
# Usage: bash src/verify-prod.sh [url]
# Exit 0 = production is serving this commit's build, with its headers and gates.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

URL="${1:-https://the-sporve-web.vercel.app}"
FAIL=0
pass(){ printf "  \033[32mPASS\033[0m  %s\n" "$1"; }
fail(){ printf "  \033[31mFAIL\033[0m  %s\n" "$1"; FAIL=1; }

# The stamp is a content hash of the built page, so this asks production
# "which build are you serving?" and compares it to the one in this checkout.
EXPECT=$(grep -o 'name="sporve-build" content="[a-f0-9]*"' index.html | grep -o '[a-f0-9]\{16\}')
[ -n "$EXPECT" ] || { fail "no build stamp in local index.html — run build.py first"; exit 1; }
echo "── waiting for $EXPECT ─────────────────────────────"

# Vercel builds take time, and a push-triggered check will always arrive first.
LIVE=""
for i in $(seq 1 60); do
  LIVE=$(curl -sL --compressed "$URL" | grep -o 'name="sporve-build" content="[a-f0-9]*"' | grep -o '[a-f0-9]\{16\}')
  [ "$LIVE" = "$EXPECT" ] && break
  sleep 10
done
if [ "$LIVE" = "$EXPECT" ]; then
  pass "production serving build $EXPECT"
else
  fail "production serving '$LIVE', expected '$EXPECT' after 10 minutes"
  exit 1
fi

echo "── headers ─────────────────────────────────────────"
H=$(curl -sI "$URL")
for h in "content-security-policy" "x-frame-options" "x-content-type-options" \
         "referrer-policy" "permissions-policy" "strict-transport-security"; do
  printf '%s' "$H" | grep -qi "^$h:" && pass "$h present" || fail "$h MISSING in production"
done
# CORS is asserted on the API, not on the marketing page.
#
# Vercel serves static assets with `access-control-allow-origin: *` by default.
# On fully public HTML that is untidy rather than dangerous: it exposes nothing
# that is not already public, carries no credentials, and CORS grants no access
# a plain GET does not already have. The header that would matter is on
# /api/ai, which spends money — and that endpoint must emit none at all, so a
# browser refuses to hand a cross-origin caller its response.
API_CORS=$(curl -sI -X POST "$URL/api/ai" | grep -ci "^access-control-allow-origin:")
[ "$API_CORS" -eq 0 ] && pass "/api/ai emits no CORS headers" \
  || fail "/api/ai is emitting CORS headers — cross-origin callers can read it"

# The CSP authorises inline scripts by hash. If the policy production sends
# does not match the scripts production serves, every script is blocked and the
# site is blank — with a 200 and all the right headers, so every other check
# here would still pass. Compare the two as production actually serves them.
csp_live=$(python3 - "$URL" <<'PY'
import base64, hashlib, re, subprocess, sys
url = sys.argv[1]
page = subprocess.run(["curl", "-sL", "--compressed", url],
                      capture_output=True, text=True).stdout
head = subprocess.run(["curl", "-sI", url], capture_output=True, text=True).stdout
m = re.search(r"(?im)^content-security-policy:\s*(.*)$", head)
if not m:
    print("NOCSP"); sys.exit()
policy = m.group(1)
scripts = re.findall(r"<script>(.*?)</script>", page, re.S)
if not scripts:
    print("NOSCRIPTS"); sys.exit()
missing = [s for s in scripts
           if "'sha256-" + base64.b64encode(hashlib.sha256(s.encode()).digest()).decode() + "'"
           not in policy]
print("MISMATCH:%d/%d" % (len(missing), len(scripts)) if missing else "OK:%d" % len(scripts))
PY
)
case "$csp_live" in
  OK:*)       pass "csp: all ${csp_live#OK:} live scripts authorised by the live policy" ;;
  NOCSP)      fail "csp: production is serving no Content-Security-Policy" ;;
  NOSCRIPTS)  fail "csp: no inline scripts in the live page — check has gone blind" ;;
  *)          fail "csp: ${csp_live#MISMATCH:} live scripts are BLOCKED by the live policy — the site is blank" ;;
esac

echo "── /api/ai gates ───────────────────────────────────"
code(){ curl -s -o /dev/null -w "%{http_code}" "$@"; }
A="$URL/api/ai"
[ "$(code "$A")" = "405" ] && pass "GET rejected (405)" || fail "GET not rejected"
[ "$(code -X POST "$A" -H 'content-type: text/plain' -d x)" = "415" ] \
  && pass "non-JSON rejected (415)" || fail "non-JSON not rejected"
[ "$(code -X POST "$A" -H 'content-type: application/json' -H 'origin: https://evil.example' -d '{"text":"hi"}')" = "403" ] \
  && pass "cross-origin rejected (403)" || fail "cross-origin NOT rejected"
# Same-origin WITHOUT a bearer token is 401 with a key configured (the
# entitlements gate charges nobody anonymous) and 503 without one. A 200 here
# would mean the auth gate fell off and any same-origin curl spends money.
SO=$(code -X POST "$A" -H 'content-type: application/json' -H "origin: $URL" -d '{"text":"open my earnings"}')
case "$SO" in
  401) pass "same-origin unauthenticated rejected (401 — entitlements gate live)";;
  503) pass "same-origin gates pass (503 — no key set yet)";;
  200) fail "same-origin unauthenticated returned 200 — the auth gate is MISSING";;
  *)   fail "same-origin returned $SO — expected 401 or 503";;
esac

echo "────────────────────────────────────────────────────"
[ "$FAIL" -eq 0 ] && echo "  PRODUCTION VERIFIED" || echo "  PRODUCTION VERIFICATION FAILED"
exit $FAIL
