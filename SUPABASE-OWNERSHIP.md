# Supabase deploy-surface ownership (settled 2026-09-01)

| surface | canonical repo | deploy command |
|---|---|---|
| **edge functions** | `the-sporve-web` — `supabase/functions/` (moved 2026-09-02, owner order; sporve-app copy is historical) | `supabase functions deploy <name>` from THIS repo only |
| **migrations** | `the-sporve-web` — `supabase/migrations/` (baseline + dated files, mirrored 1:1 with what was applied) | applied via MCP/psql; `db push` stays forbidden from every repo |

One rule each way: functions are never edited in the dashboard, migrations are
never applied without a same-body file landing in `the-sporve-web`. Doc 08 §1
asked for the functions to live in *this* repo; refused (rule 9) — a second
copy of 40 functions is a drift machine, and the sporve-app repo is what
actually deploys. This file is the pointer doc 08 wanted instead.
