# Codex collaboration rules

Claude Code may edit this repository concurrently. Use Clo's local coordination
ledger to avoid stale reads and overwritten work.

Before changing files:

1. Read `.clo-sync/activity.md` when it exists and run `git status --short`.
2. Register intent: `python3 .claude/hooks/clo-sync.py begin codex "TASK" FILE...`.
3. If Claude has an unfinished claim on the same file, re-read the file and
   narrow the edit or leave a ledger `note`; never overwrite it from stale context.

After changing files, run the relevant verification and register completion:

`python3 .claude/hooks/clo-sync.py end codex "RESULT; verification: CHECK" FILE...`

Log only observable work—task, files, checks, conflicts, and handoffs. Never log
prompts, secrets, tool responses, private reasoning, or chain of thought. The
ledger is runtime state and is intentionally ignored by Git. Source files remain
the authority; `.clo-sync/activity.md` is coordination evidence only.

## Codex owns prompt intake

Codex is the primary agent for new owner prompts in this repository. For every
substantive request, create or continue the gitignored folder described in
`prompts/README.md`: keep the request verbatim in `PROMPT.md`, enumerate every
ask in `BREAKDOWN.md`, and close every ask with evidence in `STATUS.md`. Add
mid-turn requests to the same open folder instead of relying on chat memory.

## Shared product contract

- Change only what the owner asked for. Verify load-bearing claims against the
  repository before editing and surface contradictions instead of guessing.
- Before UI, layout, typography, colour, or motion work, read
  `src/design-rules.md`. `CLAUDE.md` remains design-decision history; consult the
  relevant current section when needed, but do not revive text marked retired
  or superseded.
- Edit source files, never generated `index.html`. `python3 src/build.py`
  produces the build, and `bash src/smoke.sh` is the required local gate when
  command execution is available.
- Treat RLS, Stripe writes, auth, database migrations, booking capacity,
  consent/COPPA, and secrets as `[CRITICAL-PATH]`. Default to analysis or a
  reviewable draft; do not apply or merge those changes without explicit owner
  authorization.
- Explain completed edits in plain founder-level language: what changed, why it
  changed, and what it means for the product. When the owner must act, give the
  exact URL, button labels, and copy-paste-ready values.
- End change turns with exactly three concise sentences: what was done, what is
  next, and where the current feature or thread stands.

## Release every completed change

Work with Clo as the release gate. A repository change is not complete from a
local diff or passing test alone. After verification:

1. Re-read `git status` and the diff; commit only the intended files.
2. Push the current `main` commit to `origin/main` on GitHub.
3. Wait for that commit's Vercel production deployment for project
   `the-sporve-web` to finish successfully.
4. Verify `https://the-sporve-web.vercel.app` using a source marker, response
   size comparison, or live DOM assertion. Do not search served HTML for text
   produced at runtime by a template literal.
5. Record the commit SHA, deployment result, verification method, and live URL
   in the Clo ledger and final report.

If push, deployment, or live verification fails, report the task as blocked or
incomplete—never as done. Never force-push, bypass a failed smoke test, include
another agent's unfinished files, or deploy a critical-path change without its
required review.
