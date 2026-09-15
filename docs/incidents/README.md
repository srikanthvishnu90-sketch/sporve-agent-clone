# Incidents

Every incident produces a written postmortem here (spec 18.3). Clubs that
left an incumbent over support will read these and stay. Name files
`YYYY-MM-DD-short-slug.md`; use the template below; never include a family's
name, address or message text.

## Alerting (what pages, what digests)

| signal | source | severity | where |
|---|---|---|---|
| Stripe dead letters (unresolved / new in 24h) | `webhook_dead_letter` | **page** | `ops_alerts()` → `ops-health` → `.github/workflows/ops-alerts.yml` |
| paid booking with no ledger row | `bookings` × `payment_event_ledger` | **page** | same |
| approved message failed / stuck > 15 min | `outbound_messages` | **page** (≥5 failures, or any stuck) | same |
| cron HTTP failures in the last hour | `cron_http_audit` | **page** | same |
| pg_cron heartbeat stale > 10 min | `cron.job_run_details` | **page** | same |
| AI error rate > 10% of ≥10 requests | `ai_observability_events` | digest | same (`::warning`) |
| site / webhook / gateway / PostgREST liveness | HTTP probes | **page** | `.github/workflows/uptime.yml` |
| mail authentication drift (DMARC) | DNS | weekly | `.github/workflows/mail-dns.yml` |

## Arming ops-alerts (owner, ~5 minutes, after migration 001061 is applied)

1. Generate a token: `openssl rand -hex 32`.
2. Supabase → project → **Edge Functions** → **Secrets** → **Add** → name `OPS_HEALTH_TOKEN`, value = the token → Save.
3. Deploy `ops-health` (`supabase functions deploy ops-health --project-ref <the D5 project>`; `verify_jwt=false` is set in `supabase/config.toml` because the function authenticates its caller itself).
4. GitHub → repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret** → `OPS_HEALTH_TOKEN` → same value.
5. **Actions** → **ops-alerts** → **Run workflow**. Green = armed. A red run emails you; that is the pager.

Support model to publish (18.3): business-hours response; during season a named Saturday 07:00–13:00 local window is watched. Under-promise in writing; do not sell an SLA one person cannot staff.

## Postmortem template

```
# YYYY-MM-DD — <one line: what a club would have noticed>

**Window:** start → end (local time of the affected clubs)
**Impact:** who could not do what. Numbers, not adjectives.
**Detected by:** which alert, or which human, and how long after start.

## Timeline
- hh:mm — …

## Cause
The mechanism, in one paragraph a director can follow.

## What we changed
- code / config / process, each with the PR or commit.

## What would have caught it sooner
One alert or check we did not have. If it now exists, link it.
```
