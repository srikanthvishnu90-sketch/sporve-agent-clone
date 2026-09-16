# 2026-09-16 — the golden-eval account password was a literal in the repository

**Window:** 2026-09-10 (commit `da76650`, PR #371) → 2026-09-16 (rotated by the owner).
**Impact:** the password of `sporve123+goldeneval@gmail.com` — the Supabase auth user that owns the EVAL organisation used by `scripts/agent-golden.mjs` — was readable by anyone with repository access, and remains in git history. The account is a provider-role user on the production project; with it, one could sign in as that org's owner and read or write that org's rows under RLS. It holds no real families.
**Detected by:** external-dependency checklist item 8 review (PR #15), 2026-09-15.

## Timeline
- 2026-09-10 — `scripts/agent-golden.mjs` lands with `process.env.GOLDEN_PW || "<literal>"`.
- 2026-09-15 — PR #15 removes the defaults; the script now exits 2 without `GOLDEN_EMAIL`/`GOLDEN_PW`.
- 2026-09-16 — owner rotates the credential. Reuse check (read-only): the literal appears in exactly one tracked file on every branch and in three commits (`da76650`, `06db7d6`, `541db74` — the removal); no match in shell profiles or `.env*`; no `GOLDEN*` name among Supabase Edge Function secrets; the address appears elsewhere only in `docs/launch-readiness-2026-09-10.md` as text. **Not reused.**

## Cause
A convenience default for a local script, committed. gitleaks did not flag it because the value does not match a known key shape.

## What we changed
- Defaults removed (#15); a test now fails any `scripts/*.mjs` that defaults a password or email literal.
- Rotated by the owner. History is not rewritten: the value is dead.

## What would have caught it sooner
A gitleaks custom rule for `PW|PASSWORD\s*\|\|\s*"` — added to the test in #15 instead, which runs on every PR.
