# Email deliverability ramp — sporv.ai

Launch item 11. The sending domain was verified on 2026-09-06 (SPF + DKIM +
MX at Resend). It has **zero sending reputation**. Blasting a full club's dues
reminders on day one lands them in spam and can poison the domain for weeks.

## Records (owner-verified)

| record | state |
|---|---|
| SPF `send.sporv.ai` | verified |
| DKIM `resend._domainkey.sporv.ai` | verified |
| MX `send.sporv.ai` | verified |
| DMARC `_dmarc.sporv.ai` | present: `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net` (GoDaddy default) |

DMARC is already **enforcing (quarantine)** with relaxed alignment; Resend's
DKIM signs as `sporv.ai`, so aligned mail passes. Optional improvement — edit
the existing record at GoDaddy so reports also reach us:

```
Type: TXT   Name: _dmarc   Value: v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net,mailto:sporve123@gmail.com
```

## Volume ramp (per sending domain, all orgs combined)

| window | max sends / day | rule |
|---|---|---|
| Days 1–3 | 50 | pilots only; every message is a human-approved draft |
| Days 4–7 | 150 | keep bounce rate < 2%, complaint rate < 0.1% |
| Week 2 | 400 | same thresholds |
| Week 3 | 1,000 | same thresholds |
| Week 4+ | unlimited | review weekly |

If bounces exceed 2% or complaints 0.1% in any window: freeze at the previous
tier for three days and fix the list (the resend-webhook rail already writes
bounces/complaints to `email_suppressions`; those addresses are never mailed
again).

## Enforcement

- The lifecycle worker only sends what a human approved — there is no bulk
  blast path. Approve-all holds 8 seconds and is per group.
- Suppressions: enforced in `lifecycle-process` (live); `unsubscribe` function
  live with List-Unsubscribe headers.
- Monitoring: `email_suppressions` count + Resend dashboard bounce/complaint
  rates, checked daily during weeks 1–3 (ops-monitor run).

## Content rules that protect reputation

Plain text, one link, the club's real name in the From display, no
attachments, no URL shorteners, physical address in footer once the club
supplies it, and every recipient opted in by registering with the club.
