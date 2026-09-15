# Mail DNS for sporv.ai — what is live, what D7 needs, exactly what to click

External-dependency checklist item 6. Live state read 2026-09-15 over
DNS-over-HTTPS (`node tools/check-mail-dns.mjs`); re-checked weekly by
`.github/workflows/mail-dns.yml`, which fails until DMARC is enforcing.

## Live on 2026-09-15

| record | live value | verdict |
|---|---|---|
| `_dmarc.sporv.ai` TXT | `v=DMARC1; p=none; rua=mailto:sporve123@gmail.com` | **p=none — monitoring only.** A spoofed `@sporv.ai` dues reminder is delivered, not quarantined. `docs/deliverability-ramp.md` said quarantine on 09-06; DNS says otherwise now. |
| `sporv.ai` TXT | `v=spf1 include:dc-aa8e722993._spfm.sporv.ai ~all` | present (GoDaddy-flattened SPF) |
| `send.sporv.ai` TXT | `v=spf1 include:dc-fd741b8612._spfm.send.sporv.ai ~all` | present — Resend return-path |
| `resend._domainkey.sporv.ai` TXT | `p=MIGf…` | present — Resend DKIM, signs as `sporv.ai` |
| `sporv.ai` MX | Google Workspace (`aspmx.l.google.com` …) | inbox is Google — a `dmarc@sporv.ai` group can receive reports |
| `mail.sporv.ai` | **no records** | `lifecycle-process` defaults `MAIL_DOMAIN` to `mail.sporv.ai`; unless the `MAIL_DOMAIN` secret is set to a Resend-verified domain, sends from `<slug>@mail.sporv.ai` are refused. **Owner: confirm the secret's value in Supabase → Edge Functions → Secrets.** |
| `tx.sporv.ai`, `msg.sporv.ai`, `reply.sporv.ai` | **do not exist** | D7 not started |

## 1. Ratchet DMARC to quarantine (5 minutes, GoDaddy)

Monitoring for a week first is the textbook advice; `rua` has pointed at the
owner's Gmail since at least 09-15, so the reports already exist to read.

1. Google Admin → **Groups** → Create group `dmarc@sporv.ai`, add yourself as a member, allow "anyone on the internet" to post. (A Gmail address works too; a group is what survives a mailbox change.)
2. GoDaddy → **My Products** → sporv.ai → **DNS** → find the TXT row named `_dmarc` → **Edit** → set Value to exactly:

   ```
   v=DMARC1; p=quarantine; pct=100; adkim=r; aspf=r; rua=mailto:dmarc@sporv.ai; ruf=mailto:dmarc@sporv.ai; fo=1
   ```

3. Save. Within an hour: `node tools/check-mail-dns.mjs --require quarantine` prints `DMARC policy  quarantine`.
4. After 30 days of clean reports, change `p=quarantine` to `p=reject`. Nothing else changes.

## 2. D7 sending subdomains (Resend, 10 minutes each)

D7 (2026-09-15): `tx.sporv.ai` for transactional (magic links, receipts,
sign-in), `msg.sporv.ai` for org-to-family messages. Separate reputations,
so a club's bulk reminders can never cost a parent their sign-in link.

For each of `tx.sporv.ai` and `msg.sporv.ai`:

1. resend.com → **Domains** → **Add Domain** → type the subdomain → Region: same as the existing `sporv.ai` domain → **Add**.
2. Resend shows three rows (one MX + one TXT for the return-path `send.<sub>.sporv.ai`, one TXT for `resend._domainkey.<sub>.sporv.ai`). Copy each into GoDaddy → DNS → **Add** as shown — names are relative to `sporv.ai`, so paste `send.tx` not `send.tx.sporv.ai`.
3. Back in Resend click **Verify**. Green = done.
4. Then set the edge-function secret: Supabase → project → **Edge Functions** → **Secrets** → `MAIL_DOMAIN` = `msg.sporv.ai`. (Transactional senders will read `MAIL_DOMAIN_TX` = `tx.sporv.ai` once those functions exist — spec 13 slices.)

## 3. Inbound route `reply.sporv.ai` (spec 15.6 / 13 — not before the inbound tables exist)

Resend → **Domains** → `reply.sporv.ai` → **Receiving** tab → add the MX record Resend shows there at GoDaddy (`Name: reply`, priority as shown). Do not add it before the `resend-inbound` edge function and the inbound table ship; an MX with nothing behind it bounces parent replies, which is worse than no MX.

## Never

- Never set `p=reject` while any sender (Google Workspace, Resend, a future SMS-provider email) is unaligned — check the reports first.
- Never put a second `v=spf1` TXT on the same name; two SPF records is a permanent fail.
