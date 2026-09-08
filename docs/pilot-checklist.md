# Sporv pilot checklist — scripted end-to-end, per persona

Launch item 10. Hand this to each pilot. Every step names the exact screen and
the one thing to confirm; pilots report the step number + what they saw. A
step that cannot be completed is a defect, not a note.

Send defects to sporve123@gmail.com with the step number and a screenshot.

---

## Pilot A — Team / club director (the launch wedge)

Time: about 20 minutes on your phone.

1. Open https://sporv.ai → **Get started**. Confirm: the sign-up screen asks for
   email + password only (no organization name yet), the eye icon shows the
   password, and the Create account button stays grey until the password is
   12+ characters.
2. Create the account. Confirm: you land immediately on **"What are you
   running?"** with three doors — no email-confirmation detour.
3. Tap **Team / club**. Confirm: the next screen asks **"What's your club
   called?"** (not "business" or "practice"). Type your club name.
4. **Confirm the shape**: the three answers are pre-set (seasonal / Team /
   installments). Change one and change it back. Continue.
5. **Set up your club**: paste your club's website. Confirm: within ~20
   seconds the drafted teams/fees/season appear on the next screen with real
   names from your site. Edit anything wrong. Nothing is saved until you press
   Confirm & create.
6. **Bring your roster** → Open the import wizard → paste or upload a CSV.
   Confirm: the column mapping shows YOUR headers, the dry-run counts are
   right, and after Commit the toast says nothing was emailed.
7. **Connect payouts** → Connect with Stripe. Confirm: Stripe's own page opens;
   finish or Skip for now. Back in Sporv the status shown matches what Stripe
   says (not "active" unless Stripe said active).
8. **Draft the first billing run** → Draft N schedules. Confirm: the copy says
   no one was charged and no email went out.
9. Press **Done**. Confirm: **"Reading your organization"** appears with four
   phases, log lines (Google shows "not connected — skipped"), and a final
   count. Press Open the review queue.
10. **Queue**: every row shows who / what / why / tone. Press **Edit** on one,
    change a word, Approve. Press **Approve all N** on a group — confirm the
    8-second undo bar appears and **Undo** puts the rows back.
11. **Clients → Invites**: press Copy link on a family. Open that link in a
    private window. Confirm: you're asked to sign up, then asked
    **"Accept this invite?"** — nothing joins until you press Accept.
12. **Settings → Organization**: change Organization type to Camp and back.
    Confirm the roster tab label changes (Roster ↔ Campers).
13. **Settings → People**: confirm you are listed as Owner and the copy states
    money stays with the Owner.
14. Share your public page: https://sporv.ai/?org=YOUR-ORG-ID (ask Sporv for
    the id). Confirm it shows your name, programs and prices, and says no
    reviews exist.
15. Log out. Log in. Confirm: you land straight in your queue, not the
    marketing page.

## Pilot B — Solo trainer (1v1)

1–2. As above.
3. Tap **Private training**. Confirm: **"What's your training business
   called?"** appears with the link **"I don't have a business name — I go by
   my own name"**. Use it; enter your name. Confirm the name shown afterwards
   is yours.
4. Confirm the shape: continuous / Client / per session pre-set.
5. **Set up your practice** (not "club"). Paste a description instead of a
   URL. Confirm the drafted name + sport appear.
6. Roster: add two clients. 7. Stripe as above. 8–9. As above.
10. Queue: confirm rows say **Clients**, never "Roster".
11. Settings → Organization: confirm the roster field label for your sport
    (golf → Handicap, swimming → Event, soccer → Jersey).

## Pilot C — Family (a parent invited by A or B)

1. Open the invite link from your text/email on your phone.
2. Sign up as a parent. Confirm: **"Accept this invite?"** names the club and
   nothing happens until you press Accept.
3. Open the club's public page link. Confirm prices match what the club told
   you and the page says no reviews are shown.
4. (When the club approves a dues reminder) confirm the email arrives from
   **hello@sporv.ai** with the club's name in the body and the amount you owe,
   and that the unsubscribe link works.

## What "pass" means

Every step confirms exactly what it says; every send-shaped moment said
"nothing was sent" until you pressed Approve; nothing showed a state the server
didn't confirm. Anything else is a defect — send the step number.
