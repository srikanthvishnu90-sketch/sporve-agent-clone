#!/usr/bin/env bash
# Free vs Pro side-by-side test script — Sporv launch sprint.
#
# This script is a RUNNABLE CHECKLIST. It prints every test step, the click
# path, and the expected result for the Free workspace vs the Pro workspace.
# It never attempts a purchase, never writes to the database, and never calls
# a billing endpoint. The single purchase happens manually at launch via
# Account -> Billing -> Get Pro (Stripe Checkout).
#
# Optional read-only probes: set SUPABASE_URL and SUPABASE_ANON_KEY to run an
# anonymous read of plan_entitlements (the one table anon may read).
# Usage: ./tests/qa/free-vs-pro.side-by-side.sh [--probe]
set -u

PASS=0; EXPECTED_FAIL=0; MANUAL=0

step()  { printf '\n== %s ==\n' "$1"; }
cmd()   { printf '  run: %s\n' "$1"; }
want()  { printf '  FREE expects: %s\n' "$1"; printf '  PRO  expects: %s\n' "$2"; }
note()  { printf '  note: %s\n' "$1"; }
verdict(){ printf '  verdict: %s\n' "$1";
           case "$1" in PASS*) PASS=$((PASS+1));; EXPECTED-FAIL*) EXPECTED_FAIL=$((EXPECTED_FAIL+1));; *) MANUAL=$((MANUAL+1));; esac; }

echo "Sporv Free-vs-Pro side-by-side test checklist"
echo "Workspaces: FREE (email 1) and PRO-TO-BE (email 2). See docs/qa/free-vs-pro-test-prep.md section 1 for setup."

if [ "${1:-}" = "--probe" ]; then
  step "PROBE 0 — read-only: plan_entitlements rows in production"
  if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then
    echo "  skipped: set SUPABASE_URL and SUPABASE_ANON_KEY for the read-only probe"
  else
    curl -s -m 20 "${SUPABASE_URL}/rest/v1/plan_entitlements?select=plan,ai_monthly_quota,seat_limit,purchasable,price_usd_month,connectors" \
      -H "apikey: ${SUPABASE_ANON_KEY}" -H "Authorization: Bearer ${SUPABASE_ANON_KEY}"
    echo
    note "Non-null ai_monthly_quota / seat_limit / price_usd_month and purchasable=true for pro are required before T2/T7 can pass."
  fi
fi

step "T1 — command-bar Ask, 5 identical prompts (e.g. 'Who is past due?')"
cmd "sporv.ai -> command bar -> type prompt -> Enter, x5, in each workspace"
want "Allowed (quota verdict returned, receipt in ai_usage)" "Allowed, metered in ai_usage"
verdict "MANUAL — compare the five answers match"

step "T2 — Ask until the monthly quota is exhausted"
cmd "keep asking in FREE until the response changes; note prompt count"
want "HTTP 402 {reason:'quota_exhausted', current_plan:'free', upgrade_to:'pro', limit, current} + copy 'upgrade to Pro for unlimited'" "Never 402s"
note "Gap: ai_monthly_quota is NULL today (unlimited for Free) and the 402 path needs contract_version===2 which no shipped RPC returns. EXPECTED-FAIL until both are fixed."
verdict "EXPECTED-FAIL (known gaps 1+3)"

step "T3 — connector OAuth start: Gmail (pro-only connector)"
cmd "Settings -> Connectors -> Gmail -> Connect, in each workspace"
want "402 {reason:'connector_not_in_plan', current_plan:'free'}; UI shows lock card naming Solo/Pro value. Note: upgrade_to currently emits stale 'solo' — flag it" "Redirects to Google OAuth consent"
verdict "MANUAL — 402 shape check; flag the 'solo' upgrade_to"

step "T4 — free connectors: website extractor and CSV import"
cmd "Onboarding -> connect website extractor; import the shared test CSV, in each workspace"
want "Allowed" "Allowed"
verdict "MANUAL — both workspaces identical"

step "T5 — coach-command draft generation x10"
cmd "coach-command -> request 10 drafts (e.g. lapsed-outreach), in each workspace"
want "Allowed but counted; quota verdicts visible in network panel. Gap: coach-command has no quota check today" "Allowed"
note "Gap: no entitlement call in coach-command at all. EXPECTED-FAIL for metering, PASS for allowed."
verdict "EXPECTED-FAIL (metering gap 4)"

step "T6 — invite staff seats 2 and 3"
cmd "Settings -> Team -> Invite, send 2 invites, in each workspace"
want "2nd invite allowed; 3rd allowed today (no server cap — flag)" "Allowed (Pro = 3 seats)"
note "No seat_cap enforcement exists. EXPECTED-FAIL for any cap."
verdict "EXPECTED-FAIL (seat gap)"

step "T7 — invite staff seat 4"
cmd "Settings -> Team -> Invite a 4th seat, in each workspace"
want "Must fail with 402 and upgrade copy (currently no cap — EXPECTED-FAIL)" "Allowed (within 3 seats)"
verdict "EXPECTED-FAIL (seat gap)"

step "T8 — cancelled / incomplete checkout grants nothing"
cmd "Account -> Billing -> Get Pro -> close the Stripe tab without paying; then try an expired session link"
want "Billing tab: 'Free plan - Sporv Pro checkout not finished'; plan_status='incomplete'; no AI/Gmail access change" "n/a"
verdict "MANUAL — verify no paid state"

step "T9 — purchase Pro, then refresh / re-login (launch-time step)"
cmd "Account -> Billing -> Get Pro -> complete Stripe Checkout -> refresh -> log out -> log in"
want "n/a" "Billing tab: 'Sporv Pro - renews <date>'; plan='pro', plan_status='active'; AI asks and Gmail connector both work after re-login"
note "Depends on the billing-webhook -> providers.plan projection (known broken until gap 5 fixed). Run DB Q2 after."
verdict "MANUAL — blocked until gap 5 fixed"

step "T10 — cancel in Stripe portal, period ends"
cmd "Account -> Billing -> Manage -> cancel in Stripe portal; check again after the paid period ends"
want "n/a" "Drops to free: plan='free', plan_status='canceled'; billing tab shows 'Free plan - Sporv Pro canceled'; roster reads, exports, and dues collection still work; new AI writes return 402"
verdict "MANUAL — I11 downgrade behavior"

step "T11 — failed renewal (invoice.payment_failed)"
cmd "in Stripe test clock or by failing the card, let the invoice fail"
want "n/a" "Access continues through Stripe's dunning window, then free entitlements + a finding naming what was lost. Gap: dunning delay not implemented"
verdict "MANUAL — flag missing dunning"

step "T12 — plan self-tamper attempt (negative test)"
cmd "as the FREE owner, REST PATCH /rest/v1/providers?owner_id=eq.<uid> body {\"plan\":\"pro\",\"plan_status\":\"active\"}"
want "Rejected (no trigger guards these columns today — providers_update_owner RLS permits it. Likely SUCCEEDS: flag as P0)" "n/a"
note "Run with the test account's own token only. If it succeeds, Pro is self-grantable — that is a launch blocker."
verdict "MANUAL — confirm rejection; EXPECTED-FAIL until a column guard lands"

step "T13 — export is never gated (I4)"
cmd "Roster -> Export CSV as FREE, then again after T10 cancellation"
want "Allowed in every state, including cancelled and over-cap" "Allowed"
verdict "MANUAL"

echo
echo "----------------------------------------"
printf "PASS: %s | EXPECTED-FAIL: %s | MANUAL: %s\n" "$PASS" "$EXPECTED_FAIL" "$MANUAL"
echo "EXPECTED-FAIL items are documented gaps; they must flip to PASS before launch."
echo "Design scoring: each task is 4 (function) + 1 (design quality of the visible output)."
