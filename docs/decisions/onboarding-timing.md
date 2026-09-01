# Onboarding timed acceptance (spec 04 / doc 09)

**Agent-driven run, 2026-09-01 (Claude, browser-driven, prod):** a brand-new
director account (signup → email confirm → org row) through the five-step
wizard — real URL extraction (norcalpremier.com), hand-corrected drafts
confirmed into a season + 2 teams + 2 programs, 3-member CSV import with
guardians, Stripe step skipped, billing run drafting 9 installments. Wall time
including two mid-run defects that were found and fixed (an RLS recursion on
teams, a provider column-grant 401): **~25 minutes**. Excluding the defect
repair, the wizard path itself took **~7 minutes**.

**Honest status:** the spec's acceptance — a HUMAN who has never seen the UI,
stopwatch, under 20 minutes — has NOT been run and is still owed. The agent run
above is evidence the path works, not evidence a stranger clears it in 20.
Hesitation points to watch in the human run: step 2's team-fee table (no
inline "what counts as a fee" hint), and step 3's column-mapping screen.

**Import invariants re-verified after #310 (2026-09-01):**
- identical CSV re-upload → 0 new rows (DB-refused by content-hash unique index; verified members=3, batches=1 after double upload)
- zero provider calls on import — structurally true: no email provider existed at import time, and the org-CSV path enqueues nothing into outbound_messages (the separate coach *invite* wizard sends by design, owner 2026-08-18)
- undo → exact pre-import counts (temp 1-member batch deleted server-side; billed roster untouched at 3)
