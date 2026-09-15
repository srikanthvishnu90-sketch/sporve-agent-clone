# Decision — retire the Flutter surface (D1, 2026-09-15)

**Decision.** Sporv ships one client: the web app (installable PWA). The Flutter/Dart
mobile client is retired. Parents install nothing and create no account; they are
reached by SMS, email, magic links and ICS (spec 13). Coaches/directors use the web
app installed to the home screen (spec 11).

**What this changes in `sporve-web` (this PR).**
- `supabase/functions/_shared/push.ts` (FCM web/native push) is deleted, and its
  three call sites — `lifecycle-approve`, `lifecycle-process`, `parent-update-send` —
  no longer fan out a push. It was already a no-op in production: the
  `FCM_SERVICE_ACCOUNT` secret was never set and the `push_tokens` table it reads
  does not exist. Time-critical items reach staff by SMS/email instead (spec 11.3).
- `FCM_SERVICE_ACCOUNT` is not a Supabase secret (verified 2026-09-15); there is
  nothing to delete server-side. It no longer appears in code.
- `PRODUCT.md`, `CONTEXT.md`, `AGENTS.md` in this repo carried no mobile/Flutter
  references (verified by grep); nothing to remove.

**What this does NOT do (owner-run, separate).** The Flutter repo
`srikanthvishnu90-sketch/sporve-app` also hosts ~44 edge-function directories and
103 migrations, including the `stripe-webhook` patched in sporve-app#47. Deleting
"the Flutter surface" there means removing the CLIENT (`lib/`, `ios/`, `android/`,
`web/`, `test/`, `pubspec.*`, `analysis_options.yaml`) and NOT `supabase/`. That
deletion, and reconciling which repo is the canonical home of the shared functions,
is an owner decision outside spec 11's file surface.

**Readiness docs.** Any readiness or gate document that lists a mobile client as a
surface is superseded by this decision.
