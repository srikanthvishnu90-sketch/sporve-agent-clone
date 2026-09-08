# Incident runbook — Sporv (launch item 17)

One page. Who does what, with the exact command, when something breaks. The
uptime workflow (`.github/workflows/uptime.yml`) emails the owner on failure
every 15 minutes; everything below starts from that email or a user report.

## 0. First minute, every incident

1. Is it us or them? `curl -sI --connect-timeout 5 --max-time 15 https://sporv.ai | head -1` and
   `curl -s -o /dev/null --connect-timeout 5 --max-time 15 -w '%{http_code}\n' https://tseszaprvtvqrkfpditu.supabase.co/rest/v1/` — a 5xx from either is ours.
2. Note the time. Open `.clo-sync/activity.md` — if Codex or Claude deployed
   in the last hour, that is the first suspect.
3. Do not touch money tables by hand. Ever. Corrections are new ledger rows.

## 1. Site down / blank page (sporv.ai)

- Vercel → project **sporv1** → Deployments → open the latest → **Redeploy** the
  previous good build (the one whose `sporve-build` stamp matched the last
  verified merge). That is the rollback. ~2 minutes.
- If a fresh build is failing: `python3 src/build.py && bash src/smoke.sh`
  locally; the smoke output names the broken invariant.

## 2. Payments failing (checkout errors, webhook 5xx)

- Check the function: `supabase functions logs stripe-webhook --project-ref tseszaprvtvqrkfpditu`
  (or Supabase dashboard → Edge Functions → stripe-webhook → Logs).
- Stripe dashboard → Developers → Webhooks → the endpoint → **Recent deliveries**
  shows every event and Stripe's retry schedule (it retries for 3 days, so a
  short outage loses nothing).
- The ledger is append-only and idempotent on event id: re-delivery is safe.
  Never mark anything paid by hand — replay the event from Stripe instead
  (**Resend** on the delivery row).
- Rollback a bad function deploy. `supabase functions deploy` ships whatever is
  on disk, so pin the tree to the last verified commit first:
  ```sh
  git switch --detach <verified-commit>
  test "$(git rev-parse HEAD)" = "<verified-commit>"
  supabase functions deploy stripe-webhook --project-ref tseszaprvtvqrkfpditu --no-verify-jwt
  ```

## 3. The agent drafted something wrong / sent something wrong

- Nothing sends without an approval click, so "sent something wrong" means an
  approved draft was wrong. Find it: Queue → Done, or
  `select * from outbound_messages where provider_id='…' order by created_at desc limit 20`.
- Stop the bleeding for one org: Settings → Automation → set the job to
  **Off** (writes `lifecycle_message_prefs.mode='off'`; the cron skips that org).
- Stop it for everyone (nuclear, owner-only): PAUSE the agent jobs — do not
  unschedule, that deletes them. The jobs are named `sporv-*` (generators) and
  `lifecycle-*` (the sender):
  ```sql
  select cron.alter_job(jobid, active := false) from cron.job where jobname like 'sporv-%' or jobname like 'lifecycle-%';
  select jobname, active from cron.job order by jobname;   -- confirm all false
  ```
  Resume after the fix:
  ```sql
  select cron.alter_job(jobid, active := true) from cron.job where jobname like 'sporv-%' or jobname like 'lifecycle-%';
  ```
- Re-run the golden set before re-enabling: `node scripts/agent-golden.mjs`
  must be green.

## 4. Email bouncing / going to spam

- Resend dashboard → Emails: bounce and complaint rates. Above 2% / 0.1%:
  freeze volume at the previous ramp tier for **three days** and fix the list
  first (`docs/deliverability-ramp.md`); volume resumes only after the owner
  confirms both — the cooldown elapsed and the bad addresses are suppressed.
- Suppressed addresses are automatic (`email_suppressions`); do not re-add them.
- DNS drift: `dig +short TXT send.sporv.ai` and `dig +short TXT resend._domainkey.sporv.ai`
  must both answer; `dig +short TXT _dmarc.sporv.ai` must show `p=quarantine`.

## 5. Data problem / need to restore

- Daily backups exist on the Pro plan (Supabase → Database → Backups).
  **Point-in-time recovery is OFF** — enabling it (Settings → Add-ons → PITR)
  is the owner's call and is recommended before the first real charge.
- Restoring is a dashboard action by the owner. There is **no enforced write
  barrier** — the Clo ledger only tells the agents to stop. Before a restore,
  stop the machine writers yourself: pause the cron jobs (section 3 SQL), and
  in Stripe → Developers → Webhooks **disable** the endpoint (Stripe queues
  events for 3 days and replays after re-enable). App writes arriving during
  the restore window are lost; say so to any club that was active.

## 6. Security event (leaked key, suspicious account)

- Rotate first, investigate second: Supabase → Settings → API → rotate anon /
  service keys; Resend → API keys → revoke; Stripe → Developers → API keys → roll.
- After a Supabase key rotation, every consumer must be updated or it goes
  dark: Vercel env (project sporv1, `SUPABASE_ANON_KEY`); the Edge Function
  secrets (`supabase secrets list --project-ref tseszaprvtvqrkfpditu` —
  `SUPABASE_SERVICE_ROLE_KEY` is injected by the platform and rotates with it);
  Vault (`lifecycle-process` reads the service key from `vault.secrets`);
  the GitHub Actions secret `SUPABASE_ANON_KEY` (uptime workflow); and
  `src/mod-api.js` (the publishable key shipped in the page — rebuild + deploy).
- Then run `bash tools/strix-scan.sh` (needs Docker) or the clo pentest pass.

## Contacts and ownership

| what | owner |
|---|---|
| Vercel, GoDaddy DNS, Resend, Stripe, Supabase dashboards | Vishnu (owner) |
| Code rollback, function redeploy, smoke, golden set | Claude / Codex in session |
| Money-table changes | nobody by hand — new ledger rows only |
