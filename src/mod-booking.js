/* mod-booking.js — PHASE D. The booking write path. [CRITICAL-PATH]
   ---------------------------------------------------------------------------
   The marketplace has shown ten real listings with eighty real sessions since
   the catalogue went live, and not one of them could be booked. Every
   "booking" was an object pushed into S — grep mod-payments.js for SporveAPI,
   SporveCoach or fetch and you get zero hits. The family saw a confirmation,
   the coach never heard about it, and closing the tab erased it.

   THIS FILE WRITES ALMOST NOTHING, WHICH IS THE POINT

   A booking insert carries {searcher_id, session_id, program_id, athlete_id,
   selected_tier}. It does NOT carry a price. `trg_set_booking_price` reads
   programs.price server-side and applies the tier multiplier itself:

     original_price := round(base, 2)
     final_price    := round(base * mult, 2)     PRO 1.6, ELITE 2.6

   So a hostile client cannot book a $120 session for $1 — the number it sends
   is discarded. Twelve triggers sit on this table, and between them they
   enforce consent, provider verification, session capacity, the cancellation
   -policy snapshot, the enrolled count and the lifecycle queue. The correct
   client is therefore a thin one: send the identifiers, let the database
   decide, and REPORT what it says.

   THE COPPA GATE IS THE REASON THE ERROR PATH MATTERS

     enforce_booking_athlete_consent:
       if v_consent is not true then
         raise exception 'cannot book: parental consent is not on file
                          for this athlete (COPPA)';

   That is a raised exception, not a silent skip — PostgREST turns it into a
   4xx with the message intact. Those messages are written to be read by a
   parent, so they are surfaced rather than replaced with "Something went
   wrong". A consent failure that reads as a generic error is a parent who
   cannot tell a bug from a rule.

   CONSENT IS COLLECTED, NOT ASSUMED. This file never sends `true` unless the
   caller passes an explicit affirmative — there is no default-on path, and no
   code here can set consent as a side effect of creating a child.

   AND THE GATE IS EARLIER THAN THE BOOKING. Measured against production
   2026-08-12, not read off a migration: `enforce_athlete_consent()` refuses
   the ATHLETE INSERT itself —

     parental consent (parent_consent = true) is required before an
     athlete record can exist (COPPA)

   — so a child without consent cannot be created at all, let alone booked.
   createAthlete({consent:false}) is therefore rejected by the server rather
   than quietly producing a record that fails later at checkout. That is the
   stronger and better design, and it means the booking-level consent trigger
   is a second line rather than the only one.

   PROVEN, in a transaction that rolled itself back:
     · an athlete insert with parent_consent=false      -> refused
     · a booking sent with original_price/final_price 1 -> stored at the
       program's real price, because trg_set_booking_price overwrites both
*/
(function () {
  "use strict";

  var API = window.SporveAPI, AUTH = window.SporveAuth;
  if (!API || !AUTH) { return; }

  /* Bumped when the consent wording changes. Stored ON the athlete row, so a
     later dispute can establish WHICH text a parent agreed to rather than
     whatever the page says today. */
  var CONSENT_VERSION = "2026-08-12.v1";

  function uid() { return AUTH.userId(); }

  /* Returns a REJECTED PROMISE, never a synchronous throw.
     ------------------------------------------------------------------------
     The first version threw from inside these methods. Because the throw
     happened before the promise was constructed, it escaped the whole chain:
     `create(...).then(ok).catch(bad)` never reached .catch(), the error blew
     past every handler, and in the browser it surfaced as an uncaught
     exception that killed the click handler mid-booking. A function that
     returns a promise on its happy path must return one on every path, or its
     callers cannot handle failure at all. */
  function guard() {
    return uid() ? null : Promise.reject(new Error("Sign in to continue."));
  }

  var ATHLETE_COLS =
    "id,first_name,last_name,date_of_birth,preferred_sports,skill_level," +
    "parent_consent,consent_at,consent_version";

  var BOOKING_COLS =
    "id,session_id,program_id,athlete_id,status,payment_status," +
    "original_price,final_price,currency,selected_tier,created_at";

  var BOOKING = {
    athletes: function () {
      if (!uid()) return Promise.resolve([]);
      /* No parent_id filter: athletes_select RLS already scopes rows to the
         signed-in parent. Filtering here too would imply the client is the
         control, and the day someone removes the filter it would still be
         safe — which is the property worth preserving. */
      return API.from("athletes", "select=" + ATHLETE_COLS + "&order=first_name")
        .then(function (r) { return r || []; });
    },

    /* Create a child. `consent` MUST be an explicit true from an affirmative
       the parent actually gave; everything else is treated as no consent and
       the row is written with parent_consent false, which the booking gate
       will then correctly refuse. */
    createAthlete: function (a) {
      var no = guard(); if (no) return no;
      var consented = a && a.consent === true;
      return API.from("athletes", "", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          parent_id: uid(),
          first_name: String((a && a.firstName) || "").trim(),
          last_name: String((a && a.lastName) || "").trim() || null,
          date_of_birth: (a && a.dob) || null,
          preferred_sports: (a && a.sports) || [],
          skill_level: (a && a.skillLevel) || null,
          parent_consent: consented,
          /* Timestamp and version are written ONLY alongside a true consent.
             A row claiming consent with no time and no version is unauditable,
             and this is the record a COPPA question would be answered from. */
          consent_at: consented ? new Date().toISOString() : null,
          consent_version: consented ? CONSENT_VERSION : null,
        },
      }).then(function (r) { return (r && r[0]) || null; });
    },

    /* Record consent for an existing child. Separate from creation because a
       parent may add a child and consent later, and because an UPDATE that
       could flip consent as a side effect of an unrelated edit is exactly the
       shape to avoid on this column. */
    grantConsent: function (athleteId) {
      var no = guard(); if (no) return no;
      return API.from("athletes", "id=eq." + encodeURIComponent(athleteId), {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: {
          parent_consent: true,
          consent_at: new Date().toISOString(),
          consent_version: CONSENT_VERSION,
        },
      }).then(function (r) { return (r && r[0]) || null; });
    },

    /* THE BOOKING. Identifiers only — see the header on why no price is sent. */
    create: function (b) {
      var no = guard(); if (no) return no;
      if (!b || !b.sessionId) return Promise.reject(new Error("Pick a session first."));
      return API.from("bookings", "", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          searcher_id: uid(),
          session_id: b.sessionId,
          program_id: b.programId || null,
          athlete_id: b.athleteId || null,
          selected_tier: b.tier || null,
        },
      }).then(function (r) { return (r && r[0]) || null; });
    },

    /* CANCEL. [CRITICAL-PATH: money]
       -----------------------------------------------------------------------
       The parent may set status/cancelled_at/cancellation_reason on their own
       row and NOTHING ELSE — verified against production by attempting the
       greedy version first: a PATCH carrying payment_status:'paid',
       final_price:0 and refund_amount:9999 is refused by a trigger with
       "Not allowed to modify booking financial or identity fields." RLS scopes
       ROWS, not columns, so that trigger is the actual control and it holds.

       THE REFUND IS NOT ISSUED HERE, and cannot be. refund_amount stays 0
       after a client cancel because money movement belongs to Stripe and to a
       server that can read the cancellation policy snapshot. Cancelling
       therefore RELEASES THE SLOT and records the request; it does not promise
       money back, and the UI must not say otherwise until a refund function
       exists. */
    cancel: function (bookingId, reason) {
      var no = guard(); if (no) return no;
      return API.from("bookings", "id=eq." + encodeURIComponent(bookingId), {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: {
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancellation_reason: String(reason || "").slice(0, 500) || null,
        },
      }).then(function (r) { return (r && r[0]) || null; });
    },

    mine: function () {
      if (!uid()) return Promise.resolve([]);
      return API.from("bookings",
        "select=" + BOOKING_COLS + "&order=created_at.desc&limit=50"
      ).then(function (r) { return r || []; });
    },

    /* Stripe Checkout. The Edge Function owns the amount, the fee split and
       the idempotency key; this sends a booking id and the origin to come back
       to. `window.location.origin` rather than a constant because this page is
       served from production, from previews and from a local CSP harness, and
       a hardcoded origin would send a family from a preview to production
       mid-payment. That origin must be in CHECKOUT_ORIGINS server-side — the
       function 503s otherwise, which is how it failed for everyone before. */
    checkout: function (bookingId) {
      var no = guard(); if (no) return no;
      /* NORMALISE THE RESPONSE KEY. The Edge Function returns `checkoutUrl`;
         this client read `r.url` and got undefined — so a booking row was
         created, a real Stripe session was opened, and the family was sent
         nowhere. No error was thrown on either side: the fetch succeeded, the
         object was valid, and the only symptom was a page that did nothing.
         Caught by driving the live flow rather than reading the contract.
         Both keys are exposed so a caller cannot pick the wrong one. */
      return API.fn("stripe-create-checkout", {
        bookingId: bookingId,
        origin: window.location.origin,
        successUrl: window.location.origin + "/?booking=" + encodeURIComponent(bookingId) + "&paid=1",
        cancelUrl: window.location.origin + "/?booking=" + encodeURIComponent(bookingId) + "&paid=0",
      }).then(function (r) {
        r = r || {};
        var u = r.checkoutUrl || r.url || null;
        return { url: u, checkoutUrl: u, sessionId: r.sessionId || null, raw: r };
      });
    },

    /* Read a booking's payment state after the Stripe redirect. The webhook is
       the authority and it is idempotent; this only reads what it recorded, so
       a family refreshing the return page cannot double-anything. */
    status: function (bookingId) {
      var no = guard(); if (no) return no;
      return API.from("bookings",
        "select=" + BOOKING_COLS + "&id=eq." + encodeURIComponent(bookingId) + "&limit=1"
      ).then(function (r) { return (r && r[0]) || null; });
    },

    /* REFUND. [CRITICAL-PATH: money]
       -----------------------------------------------------------------------
       Sends a booking id and NOTHING ELSE. The amount is decided by
       booking_refund_quote() on the server, from the cancellation policy
       snapshotted at booking time. Deliberately no amount parameter exists on
       this function: a client that cannot express a figure cannot inflate one,
       and the edge function logs-and-ignores any amount that arrives anyway.

       Resolves for BOTH outcomes rather than rejecting when nothing is due —
       {refunded:false, reason:"outside the flexible refund window"} is a real
       answer a parent needs to read, not an error. Only a transport or server
       failure rejects. */
    refund: function (bookingId) {
      var no = guard(); if (no) return no;
      if (!bookingId) return Promise.reject(new Error("Which booking?"));
      return API.fn("stripe-refund", { bookingId: bookingId }).then(function (r) {
        r = r || {};
        return {
          refunded: r.refunded === true,
          amount: typeof r.amount === "number" ? r.amount : 0,
          policy: r.policy || null,
          reason: r.reason || null,
          note: r.note || null,
        };
      });
    },

    consentVersion: CONSENT_VERSION,
  };

  window.SporveBooking = BOOKING;
})();
