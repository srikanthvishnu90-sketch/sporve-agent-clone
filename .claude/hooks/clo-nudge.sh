#!/usr/bin/env bash
# UserPromptSubmit hook — fires Clo's thesis pass on pasted recommendations.
#
# Why length-gated rather than every prompt: a thesis pass on "yes" or "push
# that" is pure cost and noise. A pasted spec, brief or recommendation is long.
# 900 chars is comfortably above a normal instruction and below any real brief.
#
# The hook cannot invoke a subagent itself — hooks run shell, not the agent
# loop. What it can do is put an instruction into the turn's context, which is
# what this does. Claude then invokes the `clo` agent before writing code.
#
# Remove by deleting the UserPromptSubmit block from .claude/settings.json.

payload=$(cat)
prompt=$(printf '%s' "$payload" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("prompt",""))' 2>/dev/null || echo "")
len=${#prompt}

# ── Strix cadence: activate the deep security pass every ~10 real prompts ─────
# Count genuine user prompts only — background-agent notifications and system
# results also arrive in the user role and must not inflate the count. The hook
# cannot run a subagent; it injects a STRIX-DUE instruction into the turn and
# the in-session agent runs tools/strix-scan.sh (read-only, findings-only).
case "$prompt" in
  *"<task-notification>"*|*"SYSTEM NOTIFICATION"*|*"hook success:"*) : ;;
  *)
    ctr="${CLAUDE_PROJECT_DIR:-.}/.clo-sync/strix-counter"
    n=$(( $(cat "$ctr" 2>/dev/null || echo 0) + 1 ))
    printf '%s' "$n" > "$ctr" 2>/dev/null || true
    if [ $(( n % 10 )) -eq 0 ]; then
      cat <<EOF
<system-reminder>
STRIX DUE — $n user prompts since the cadence started. Per the owner's standing
instruction (a Strix deep security pass every ~10 prompts), run it now as a
READ-ONLY step that reports findings and applies nothing:

  bash tools/strix-scan.sh

Strix (usestrix/strix) targets the real attack surface — ~/SportsMan-main +
Supabase, NOT this static site. If its preconditions are unmet it prints the
exact setup and exits 2; then run the clo agent in MODE: pentest as the
always-available static triage and tell the owner Strix setup is still pending.
Do this alongside the current task; do not skip it silently. See docs/strix.md.
</system-reminder>
EOF
    fi
  ;;
esac

[ "$len" -lt 900 ] && exit 0

# Observed firing on a background-agent completion notification, which arrives
# in the user role and is easily over the length gate. Those are results coming
# back, not recommendations going out — a thesis pass on one is circular.
case "$prompt" in
  *"<task-notification>"*|*"SYSTEM NOTIFICATION"*|*"hook success:"*) exit 0 ;;
esac

cat <<'EOF'
<system-reminder>
The message above is long enough to be a pasted recommendation, spec, or brief.
Per the owner's standing instruction: run the `clo` agent in MODE: thesis
(.claude/agents/clo.md) on it BEFORE writing any code, and report its
thesis. If the message is not actually a recommendation — it is a long bug
report, a stack trace, or a direct instruction — skip the thesis pass and say
in one line that you skipped it and why.
</system-reminder>
EOF
