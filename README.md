# The Sporv Web

Sporv is the web surface for a two-sided youth-sports marketplace. Families can
discover coaches, inspect current verification state, choose real sessions, book,
pay, message, and follow an athlete's progress. Coaches can manage listings,
availability, clients, messages, notes, media consent, and payouts.

The app is vanilla JavaScript assembled into one self-contained browser document.
When served over HTTP it hydrates public catalogue data from the production
Supabase project. When opened directly with `file://`, it deliberately uses the
deterministic sample catalogue so local visual checks do not depend on production
data. Sample-only panels identify their data in the interface.

## Build and run

`index.html` is generated output. Edit files in `src/`, then rebuild:

```sh
python3 src/build.py
./src/smoke.sh
```

For a local HTTP surface:

```sh
python3 -m http.server 8420
```

Then open `http://127.0.0.1:8420`. The page also opens directly from disk for the
seeded fixture path, although same-origin API endpoints are available only when it
is served.

## Architecture

```text
index.html                   generated, deployable single-file app
vercel.json                  redirects, security headers, generated CSP hashes
api/ai.js                    same-origin, origin-gated AI command endpoint
src/sporve-web.host.html     host markup, styles, state, and route renderer
src/mod-api.js               Supabase REST and Edge Function client
src/mod-auth.js              Supabase Auth session lifecycle
src/mod-catalog.js           live listings and session hydration
src/mod-coachaccount.js      coach profile, listings, and payout onboarding
src/mod-booking.js           server-authoritative booking and checkout flow
src/mod-payments.js          receipts, refunds, wallet, and payment views
src/mod-productpages.js      fourteen text-first product-page compositions
src/mod-*.js                 remaining feature modules
src/build.py                 module/font/image assembly and CSP generation
src/smoke.sh                 build, browser, security, data, and layout checks
scripts/*-audit.js           focused product, overlap, and slop audits
scripts/*-contract-test.mjs  server and repository boundary tests
```

The build inlines local fonts, the landing image, and every browser module. No
browser framework or external asset CDN is required. Production catalogue,
authentication, booking, and payment calls go to the configured Supabase project;
the command bar calls the same-origin `/api/ai` endpoint. A strict Content Security
Policy limits those connections and whitelists each inline script by a generated
SHA-256 hash.

## Product truth

- Verification belongs to the named coach, not to a business. A visible badge
  requires both a cleared status and a completion date.
- Families may browse unbadged supply unless they enable the verified-only filter.
  The server checks provider safety again when a booking is written.
- Child profiles require parental consent, and media permission remains a separate
  per-athlete decision that a coach cannot grant.
- Reviews unlock from completed sessions. Cancellation and refund calculations use
  the policy snapshot attached to the paid booking.
- Coaches cannot grant themselves verification, payout readiness, or other
  server-owned state through the browser client.

## Data and location

The deployed catalogue is live data. The local fixture is intentionally fictional
and exists for deterministic development and screenshots; it must never be
presented as measured marketplace activity. Sporv's current market and public copy
are based in Chicagoland.

## Release

Changes to `src/` are incomplete until `python3 src/build.py` has regenerated
`index.html` and the CSP hashes in `vercel.json`. Pull requests run the complete
browser smoke suite. A push to `main` triggers production verification against
`https://the-sporve-web.vercel.app`.

Contact: support@sporve.com · Chicago, IL
