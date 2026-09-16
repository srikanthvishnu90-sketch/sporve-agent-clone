# 2026-09-12 — an implant on the development machine ran for about two and a half weeks with production credentials present

**Window:** ~2026-08-26 → 2026-09-12 (removal). The exact start was never reconstructed.
**Impact:** no customer data was in the product (pre-launch). Every credential the machine held — Supabase service role, Stripe, Vercel, GitHub — was within reach of the implant for the window. No misuse has been observed; absence of evidence is not evidence of absence.
**Detected by:** a hidden `folderOpen` task in `.vscode/tasks.json` executing `public/fonts/fa-solid-400.woff2` (a space-padded JavaScript blob) — found during repository review, not by an alert.

## Timeline
- 2026-09-12 — implant found and removed; both repositories cleaned across every branch (`git filter-branch` on the relocated payload); credentials rotated.
- 2026-09-13 — `scripts/no-implant-check.mjs` added to CI: fails on the task shape, on any disguised binary, and on the payload hash. A second relocation (a non-standard `tasks` key in `settings.json`) was caught and covered.
- 2026-09-15 — D10 ruled: clean OS reinstall, new SSH/GPG keys, re-enrolled 2FA. **Pending.** Standing rule: nothing under `.vscode/` or `public/fonts/` is opened or executed; no `npm`/`deno install` on a branch not confirmed implant-free.

## Cause
A repository-carried task runner entry executed on folder open. The editor trusted the repository.

## What we changed
- CI tripwire (`scripts/no-implant-check.mjs`, `pr-checks`), repository history rewritten, all secrets rotated.
- Open: OS reinstall + fresh keys (D10). Until it is done this incident is **not closed**.

## What would have caught it sooner
A rule that repository contents are data, never instructions to the editor — now in `AGENTS.md`/`CLAUDE.md` — and the tripwire that now exists.
