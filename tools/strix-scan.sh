#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# strix-scan.sh — the deep-pass security scan (usestrix/strix, the open-source
# AI pentester). Clo activates this every ~10 prompts (see .clo-sync counter in
# clo-nudge.sh) as the deep pass behind clo's always-available MODE: pentest
# static triage.
#
# WHAT IT TARGETS. Not this repo. `the-sporve-web` is one static HTML file with
# no server, no database, no user input — a scanner finds nothing here (clo.md
# MODE: pentest documents this). The real attack surface is the BACKEND:
# ~/SportsMan-main (81 SQL migrations, 31 edge functions, RLS, Stripe webhooks,
# the ai-gateway) + the live Supabase project. Default target is therefore
# ~/SportsMan-main; override with --target <path|url>.
#
# AUTHORIZATION. The owner's own codebase — authorized security testing. Strix
# reads and analyses; findings are validated with proof-of-concept but this
# runner passes --headless and NEVER points at production data. Third-party
# targets are refused.
#
# READ-ONLY CONTRACT. This produces FINDINGS ONLY. It never writes code, never
# opens a PR, never applies a fix. That keeps the scheduled/every-10-prompts
# activation inside the autonomy mandate's "unattended agents stay read-only —
# they think and report" rail.
#
# EXIT CODES: 0 scan ran (see strix_runs/ for findings) · 2 preconditions
# missing (Docker/key/install — exact remediation printed) · 3 refused target.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

TARGET="${HOME}/SportsMan-main"
RUN_NAME="sporve-backend-$(git -C "${HOME}/SportsMan-main" rev-parse --short HEAD 2>/dev/null || echo scan)"
OUT_DIR="strix_runs"

while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --name)   RUN_NAME="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

# CODE-ONLY by design. Strix does dynamic testing with live proof-of-concept
# exploits — pointing it at a live URL actively attacks that host. This runner
# therefore accepts only local owner-owned SOURCE trees, never a production URL.
# A live-infra scan is a deliberate RED action the owner stages by hand, not a
# door this tool leaves open (an unattended agent must never be able to hammer
# production). Any http(s) target — including our own Supabase/Vercel — is
# refused here.
case "$TARGET" in
  "${HOME}/SportsMan-main"*|"${HOME}/the-sporve-web"*|./*|.) : ;;
  http*://*) echo "REFUSED: $TARGET is a live URL. This runner scans SOURCE only; a live-infra pentest is a hand-staged RED action, not an automated one." >&2; exit 3 ;;
  *) echo "REFUSED: $TARGET is not an owner-owned source tree. Third-party pentesting is out of bounds." >&2; exit 3 ;;
esac

note() { printf '  %s\n' "$*"; }
missing=0

# ── Preconditions ───────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  note "✗ Docker not running. Strix runs its agents in a Docker sandbox."
  note "  FIX: open Docker Desktop (or 'colima start'), then re-run."
  missing=1
fi
if ! command -v strix >/dev/null 2>&1; then
  note "✗ strix not installed."
  note "  FIX: pipx install strix-agent   (or: pip3 install --user strix-agent)"
  missing=1
fi
if [ -z "${LLM_API_KEY:-}" ]; then
  note "✗ No LLM key. Strix needs its OWN key (separate from the service-role"
  note "  ai-gateway key, which is never handed to a client-side tool)."
  note "  FIX: export STRIX_LLM='anthropic/claude-opus-4-8'"
  note "       export LLM_API_KEY='sk-ant-...'   (an Anthropic key you control)"
  missing=1
fi
if [ ! -e "$TARGET" ] && [[ "$TARGET" != http* ]]; then
  note "✗ Target not found: $TARGET"; missing=1
fi

if [ "$missing" -ne 0 ]; then
  echo ""
  echo "STRIX DEEP PASS: STAGED, not run — preconditions above are the owner's"
  echo "one-time setup. Until then clo's MODE: pentest static triage stands in."
  exit 2
fi

# ── Run (headless, findings only) ───────────────────────────────────────────
mkdir -p "$OUT_DIR"
echo "▶ strix -n --target $TARGET  (run: $RUN_NAME)"
strix -n --target "$TARGET" --run-name "$RUN_NAME" 2>&1 | tee "$OUT_DIR/${RUN_NAME}.log"

# ── Summarise into the shared ledger (one line, observable only) ────────────
FIND_JSON=$(ls -t "$OUT_DIR/${RUN_NAME}"*/findings.json 2>/dev/null | head -1 || true)
if [ -n "$FIND_JSON" ]; then
  count=$(python3 -c "import json,sys;print(len(json.load(open('$FIND_JSON'))))" 2>/dev/null || echo "?")
  echo "STRIX: $count validated finding(s) in $FIND_JSON — triage with clo MODE: pentest"
  python3 "$(dirname "$0")/../.claude/hooks/clo-sync.py" note claude \
    "strix deep pass complete: $count finding(s), see $OUT_DIR/${RUN_NAME}" 2>/dev/null || true
else
  echo "STRIX: scan complete, no findings.json emitted (see $OUT_DIR/${RUN_NAME}.log)"
fi
