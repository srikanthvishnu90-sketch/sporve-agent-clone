# Edge functions — canonical home (moved here 2026-09-02, owner order)

Deploy with `supabase functions deploy <name>` from THIS repo.
**Never edit a function in the Supabase dashboard** — dashboard edits are
invisible to git and get clobbered by the next CLI deploy.

Fresh-clone reproduction: `supabase link --project-ref tseszaprvtvqrkfpditu`
then `supabase functions deploy` (deploys everything here).

Secrets (never in the repo, never in vercel.json — set via
`supabase secrets set`): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
STRIPE_CONNECT_WEBHOOK_SECRET, ANTHROPIC_API_KEY, CHECKOUT_ORIGINS,
CONNECT_RETURN_ORIGINS, RESEND_API_KEY, RESEND_WEBHOOK_SECRET, MAIL_DOMAIN.
SQL-side `project_url`/`cron_secret` live in Vault, one place each.
