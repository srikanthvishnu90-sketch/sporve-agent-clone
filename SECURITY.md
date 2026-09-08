# Security policy — Sporv

Sporv handles club money (Stripe Connect) and data about minors (COPPA). If
you find a weakness, tell us before you tell anyone else.

**Report to:** sporve123@gmail.com — subject line `SECURITY`. Include the URL
or function, the steps, and what you could see or do. We acknowledge within
2 business days and fix confirmed issues before any public disclosure.

**In scope:** https://sporv.ai, the Supabase project behind it (REST, RPC,
Edge Functions), the Stripe webhook, transactional email from `@sporv.ai`.

**Please do not:** access, modify or delete data that is not yours; run
denial-of-service or volume tests; use social engineering against families,
coaches or clubs; or test against a real child's account.

**What is already enforced** (so you can skip it): row-level security on
every table, column-scoped anonymous reads on `providers`, service-role-only
payment RPCs, signed Stripe webhooks with an idempotent ledger, a hash-based
Content-Security-Policy, HSTS with preload, secret scanning and push
protection on this repository, and a 15-minute uptime probe.
