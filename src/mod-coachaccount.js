/* mod-coachaccount.js — a real coach account.
   ---------------------------------------------------------------------------
   WHAT WAS THERE BEFORE

   "Become a coach" called enterCoachPortal(), which set S.portal="coach" and
   routed to the dashboard BEFORE asking who you were. So a stranger who had
   never signed in saw Apex Performance Club's dashboard — a seeded business
   that does not exist — with its listings, its schedule and its earnings,
   behind a login sheet. Signing in did not help: the form called

       completeAuth({...SEED.user, role:"provider"})

   which fabricates a verified session out of the seed regardless of what you
   typed. No password was checked, no account was created, nothing was written.
   Whatever a coach filled in vanished on reload, because there was nowhere for
   it to go.

   WHAT THIS DOES

   Signup and sign-in go to GoTrue for real, with role=provider in the user
   metadata that handle_new_user() reads to build the profiles row. Then the
   coach gets a `providers` record they own, and every field they fill in is
   PATCHed onto it.

   THE BACKEND WAS ALREADY READY, which is worth stating because it is why this
   file is short. RLS on `providers`, verified 2026-08-12:

     providers_insert_owner   INSERT  authenticated  check (owner_id = auth.uid())
     providers_select_owner   SELECT  authenticated  using (owner_id = auth.uid())
     providers_update_owner   UPDATE  authenticated  using (owner_id = auth.uid())
     providers_select_public  SELECT  anon+auth      using (status='approved'
                                                       and provider_safety_cleared(id))

   So a coach can create and edit exactly their own row and nobody else's, and
   the server enforces it — this client could be hostile and the rule holds.

   A NEW COACH IS NOT PUBLIC, AND THAT IS THE POINT. The column defaults are
   status='pending', background_check_status='none', verification_status=
   'unverified'. providers_select_public requires 'approved' AND a cleared
   safety check, so a freshly created coach is invisible to browse and search
   until a human approves them and the check clears. Signing up does not put an
   unchecked adult in front of a family, which is the whole product promise.

   IMAGES. `providers.avatar_url` / `logo_url` and the `provider-media` bucket
   were added 2026-08-12 — the project previously had NO storage buckets at
   all, so an uploaded photo had nowhere to go. Writes are owner-scoped by path:
   the first folder segment must equal auth.uid(), so a coach cannot overwrite
   another coach's headshot by guessing a filename.
*/
(function () {
  "use strict";

  var API = window.SporveAPI, AUTH = window.SporveAuth;
  if (!API || !AUTH) { return; }

  /* The coach's own provider row, once loaded. Null while signed out or while
     a signed-in provider has not created one yet. */
  var provider = null;

  function uid() { return AUTH.userId(); }

  /* Its OWN guard. This called guard() — which is defined inside
     mod-booking.js's IIFE, not this one. Each module is wrapped in its own
     closure by build.py, so the name simply did not exist here: clicking
     "Connect payouts" threw a ReferenceError SYNCHRONOUSLY, before the promise
     was constructed, so the .catch() in the handler never ran and the button
     sat disabled on "Opening Stripe…" forever. The one action that lets a
     coach get paid was unreachable, and it failed in the one way the error
     handling could not report. */
  function guard() {
    return uid() ? null : Promise.reject(new Error("Sign in to continue."));
  }

  /* Columns a coach may set about themselves. An allowlist rather than passing
     the form object straight through: `status`, `verification_status` and
     `background_check_status` all live on this table, and a PATCH built from
     arbitrary keys is how a coach approves themselves. RLS would still let the
     write through — it scopes rows, not columns — so this is the guard that
     matters. Server-side column grants are the belt to this braces. */
  var EDITABLE = [
    "business_name", "bio", "sports", "location", "provider_type",
    "coach_years_coaching", "coach_years_played", "credentials",
    "avatar_url", "logo_url", "faq", "buffer_minutes",
    /* Logistics policies the coach owns — added 2026-08-15 for the assistant's
       set_policy port. what_to_bring + travel_radius (service area) are pure
       logistics. cancellation_policy is DELIBERATELY NOT here: it drives refund
       math, which is frozen while payments move to the subscription model. */
    "what_to_bring", "travel_radius",
  ];

  function pick(patch) {
    var out = {};
    Object.keys(patch || {}).forEach(function (k) {
      if (EDITABLE.indexOf(k) >= 0 && patch[k] !== undefined) out[k] = patch[k];
    });
    return out;
  }

  var ACCOUNT = {
    /* Sign up as a coach. mailer_autoconfirm is FALSE in this project, so this
       resolves {needsConfirmation:true} and NO session — the provider row
       cannot be created until they click the emailed link, because
       owner_id = auth.uid() requires an authenticated request. */
    signUp: function (email, password, businessName) {
      return AUTH.signUp(email, password, {
        role: "provider",
        business_name: String(businessName || "").trim(),
      });
    },

    signIn: function (email, password) { return AUTH.signIn(email, password); },

    /* The coach's own row. Selected by owner_id rather than trusting a stored
       id: the session is the source of truth for who you are. */
    load: function () {
      if (!uid()) { provider = null; return Promise.resolve(null); }
      return API.from("providers",
        "select=id,business_name,bio,sports,location,provider_type,status," +
        "verification_status,background_check_status,onboarding_completed," +
        "coach_years_coaching,coach_years_played,credentials,avatar_url,logo_url" +
        "&owner_id=eq." + encodeURIComponent(uid()) + "&limit=1"
      ).then(function (rows) {
        provider = (rows && rows[0]) || null;
        return provider;
      });
    },

    /* Get the coach's provider row, creating it only if it is genuinely absent.
       ---------------------------------------------------------------------
       IT USUALLY EXISTS ALREADY. handle_new_user() fires on auth.users insert
       and, when the metadata says role=provider, inserts a providers row
       itself — named from raw_user_meta_data->>'name', or 'My Academy' when
       that is empty. It reads 'name', NOT the 'business_name' this client
       sends, so a coach who typed "QA Probe Athletics" got a business called
       "My Academy" and no error anywhere: the row was created, just not by us
       and not with their name.

       So the job here is mostly to RENAME. If the coach typed a name during
       signup it is their stated intent and it wins — applied once, then
       forgotten, so a later rename in settings is not overwritten on next
       login.

       The insert path is kept for the case the trigger did not run (an account
       that became a provider later). `on conflict (owner_id)` in the trigger
       tells us owner_id is UNIQUE, so a race here loses cleanly rather than
       producing two businesses for one coach. */
    ensure: function (businessName) {
      if (!uid()) return Promise.reject(new Error("not signed in"));
      var wanted = String(businessName || "").trim();
      return ACCOUNT.load().then(function (existing) {
        if (existing) {
          if (wanted && existing.business_name !== wanted) {
            return ACCOUNT.save({ business_name: wanted });
          }
          return existing;
        }
        return API.from("providers", "", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: {
            owner_id: uid(),
            business_name: String(businessName || "").trim() || "My coaching business",
            /* Everything else takes its column default: pending, unverified,
               background check 'none'. Deliberately not set here — a client
               that names those columns is a client one typo away from
               self-approval. */
          },
        }).then(function (rows) {
          provider = (rows && rows[0]) || null;
          return provider;
        });
      });
    },

    /* Persist a patch. This is what makes what a coach types survive a reload,
       which it previously did not do at all. */
    save: function (patch) {
      var body = pick(patch);
      if (!uid()) return Promise.reject(new Error("not signed in"));
      if (!Object.keys(body).length) return Promise.resolve(provider);
      if (!provider) {
        return ACCOUNT.ensure(body.business_name).then(function () {
          return ACCOUNT.save(patch);
        });
      }
      return API.from("providers",
        "id=eq." + encodeURIComponent(provider.id),
        { method: "PATCH", headers: { Prefer: "return=representation" }, body: body }
      ).then(function (rows) {
        provider = (rows && rows[0]) || provider;
        return provider;
      });
    },

    /* Upload a headshot or logo and record its URL.

       The path MUST start with the user's id: the storage policy checks
       (storage.foldername(name))[1] = auth.uid(), so any other prefix is
       rejected by the server. The timestamp keeps a re-upload from being
       cached under the old URL. */
    uploadImage: function (file, kind) {
      var id = uid();
      if (!id) return Promise.reject(new Error("not signed in"));
      if (!file) return Promise.reject(new Error("no file"));
      var ok = ["image/jpeg", "image/png", "image/webp", "image/avif"];
      if (ok.indexOf(file.type) < 0) {
        return Promise.reject(new Error("Use a JPEG, PNG, WebP or AVIF image."));
      }
      if (file.size > 5 * 1024 * 1024) {
        return Promise.reject(new Error("That image is over 5 MB."));
      }
      var ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      var path = id + "/" + (kind === "logo" ? "logo" : "avatar") + "-" + Date.now() + "." + ext;
      var sess = AUTH.session();

      /* Raw fetch, not API.from: this is the Storage API, the body is binary
         rather than JSON, and the shared wrapper always sets
         Content-Type: application/json. */
      return fetch(API.url + "/storage/v1/object/" + encodeURIComponent("provider-media") + "/" + path, {
        method: "POST",
        headers: {
          apikey: API.anonKey,
          Authorization: "Bearer " + (sess && sess.access_token),
          "Content-Type": file.type,
          "x-upsert": "true",
        },
        body: file,
      }).then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            throw new Error("Upload failed" + (t ? ": " + t.slice(0, 120) : "."));
          });
        }
        var url = API.url + "/storage/v1/object/public/provider-media/" + path;
        var patch = {};
        patch[kind === "logo" ? "logo_url" : "avatar_url"] = url;
        return ACCOUNT.save(patch).then(function () { return url; });
      });
    },

    /* STRIPE CONNECT — the step that turns a 409 at checkout into a payment.
       -----------------------------------------------------------------------
       Of 23 approved providers, ZERO had stripe_charges_enabled, so
       stripe-create-checkout correctly refused every booking with "This coach
       can't accept payments yet." Nothing in either client called this
       function; the coach had no way to connect a bank at all.

       The Edge Function owns everything that matters — it creates or reuses the
       Stripe account, writes stripe_account_id with the service role, and
       returns chargesEnabled read from STRIPE, not from our column. This client
       sends a return URL and follows a link.

       `returnUrl` must be in CONNECT_RETURN_ORIGINS, which was NOT SET at all
       until 2026-08-12 — the function 503'd before it even reached auth, which
       is why this looked like a missing feature rather than a missing variable.

       Resolves {accountId, chargesEnabled, onboardingUrl}. onboardingUrl is
       absent once Stripe is satisfied, which is the signal that the coach is
       done rather than a failure. */
    connectPayouts: function () {
      var no = guard(); if (no) return no;
      return API.fn("stripe-connect-onboarding", {
        returnUrl: window.location.origin + "/?connect=done",
      });
    },

    /* §10 — THE APPROVAL QUEUE.
       -----------------------------------------------------------------------
       Reads outbound_messages, which already existed: the lifecycle worker
       drafts messages into it and a coach approves them before anything is
       sent. What did not exist was a write path — the table carried only
       om_select_owner[SELECT], so a coach could read every draft and approve
       none of them. A queue you can only look at is not an approval queue.

       VOCABULARY IS READ FROM THE CONSTRAINT, NOT GUESSED. The check is
         pending | processing | drafted | approved | sent | skipped
       so "reject" is `skipped` and "send back" is `drafted`. My first attempt
       used 'rejected'/'draft'; neither exists, and it would have blocked every
       legitimate rejection.

       `sent` is deliberately NOT settable here. A client that can write it can
       claim a message was delivered that never left — the trigger refuses it,
       and this client does not try. */
    queue: function () {
      if (!uid()) return Promise.resolve([]);
      return API.from("outbound_messages",
        "select=id,event_type,status,content,scheduled_for,created_at," +
        "approved_at,booking_id,child_id" +
        "&status=in.(pending,processing,drafted,approved)" +
        "&order=created_at.desc&limit=50"
      ).then(function (r) { return r || []; });
    },

    /* One call for all three coach decisions, because they differ only by the
       status written — and keeping them together stops a fourth verb being
       invented that the trigger would then refuse. */
    decide: function (id, decision) {
      var no = guard(); if (no) return no;
      /* APPROVE SENDS — and sending is NOT a column write. It is the
         lifecycle-approve edge function: the ONLY code that delivers a drafted
         message to the verified guardian, re-runs the credential/medical/safety
         claim guardrail on the body server-side, and stamps sent/approved_by
         under the service role. This client used to PATCH status='approved'
         here, but nothing consumes 'approved' — the lifecycle worker claims
         only 'pending' — so an approved message was stranded forever while the
         coach was told "the worker will send it." A control that reported
         success on a send that never happened, on a child-facing surface.
         reject/redraft stay plain column writes; only the SEND crosses a rail. */
      if (decision === "approve") {
        return API.fn("lifecycle-approve", { id: id });
      }
      var MAP = { reject: "skipped", redraft: "drafted" };
      var status = MAP[decision];
      if (!status) return Promise.reject(new Error("Unknown decision: " + decision));
      return API.from("outbound_messages", "id=eq." + encodeURIComponent(id), {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        /* approved_by / approved_at are stamped server-side. Sending them from
           here would be a self-reported audit field, which is worth nothing. */
        body: { status: status },
      }).then(function (r) { return (r && r[0]) || null; });
    },

    /* THE ASSISTANT'S ONLY SEND RAIL — a coach-approved chat draft to ONE
       parent, through the messaging tables the product already has.
       -----------------------------------------------------------------------
       coach-command (the chatbox brain) is interpret-only by law: it returns a
       draft_message PROPOSAL and never touches a table. When the coach taps
       Approve, THIS function dispatches it — and it is deliberately nothing
       but the existing conversations/messages rail under the coach's own JWT:

         booking (RLS: only visible via the coach's own session chain)
           → its searcher_id is the parent
           → find or create the conversation (RLS: participants only)
           → insert the message (RLS: sender must be auth.uid())

       No service role, no new policy, no path a coach couldn't already walk
       by hand in the Messages tab. If any step is refused, the whole thing
       rejects and the chat shows the failure — a draft must never be reported
       sent when it wasn't (the control-that-lied class). */
    sendParentMessage: function (bookingId, bodyText) {
      var no = guard(); if (no) return no;
      /* guard() proves a session, not a profile. enterCoachPortal() can route
         here before load() resolves, and provider.id on null would throw
         SYNCHRONOUSLY — the caller's .catch never runs and its card sticks on
         "Sending…". A rejection keeps the failure on the promise path. */
      if (!provider || !provider.id) {
        return Promise.reject(new Error("Your coach profile hasn't loaded yet — try again in a moment."));
      }
      var text = String(bodyText || "").trim();
      if (!bookingId) return Promise.reject(new Error("No booking attached to this draft."));
      if (!text) return Promise.reject(new Error("The message is empty."));
      var provId = provider.id;
      return API.from("bookings",
        "id=eq." + encodeURIComponent(bookingId) +
        "&select=id,searcher_id,program_id,athlete_first_name&limit=1"
      ).then(function (rows) {
        var b = rows && rows[0];
        if (!b) throw new Error("That booking isn't visible to this account.");
        if (!b.searcher_id) throw new Error("That booking has no parent account attached.");
        return API.from("conversations",
          "provider_id=eq." + encodeURIComponent(provId) +
          "&searcher_id=eq." + encodeURIComponent(b.searcher_id) +
          "&select=id&order=created_at.desc&limit=1"
        ).then(function (cs) {
          if (cs && cs[0]) return cs[0].id;
          return API.from("conversations", "", {
            method: "POST",
            headers: { Prefer: "return=representation" },
            body: { provider_id: provId, searcher_id: b.searcher_id, program_id: b.program_id || null },
          }).then(function (r) {
            if (!r || !r[0]) throw new Error("Could not open a conversation with that parent.");
            return r[0].id;
          }).catch(function (err) {
            /* Two approvals racing can both see "no conversation" and both
               POST — the table has no unique key on (provider, searcher), so
               the second insert may succeed as a duplicate or fail on RLS
               quirks. On ANY create failure, look again: if a conversation
               now exists (the other writer won), use it; otherwise surface
               the original error. */
            return API.from("conversations",
              "provider_id=eq." + encodeURIComponent(provId) +
              "&searcher_id=eq." + encodeURIComponent(b.searcher_id) +
              "&select=id&order=created_at.desc&limit=1"
            ).then(function (cs2) {
              if (cs2 && cs2[0]) return cs2[0].id;
              throw err;
            });
          });
        }).then(function (cid) {
          return API.from("messages", "", {
            method: "POST",
            headers: { Prefer: "return=representation" },
            body: { conversation_id: cid, sender_id: uid(), body: text },
          }).then(function (r) {
            if (!r || !r[0]) throw new Error("The message was not accepted.");
            /* Preview columns are convenience, not truth — never fail the send
               over them. */
            API.from("conversations", "id=eq." + encodeURIComponent(cid), {
              method: "PATCH",
              body: { last_message: text.slice(0, 140), last_message_at: new Date().toISOString() },
            }).catch(function () {});
            return { conversationId: cid, messageId: r[0].id, firstName: b.athlete_first_name || null };
          });
        });
      });
    },

    /* PUBLISH A BOOKABLE LISTING — the path that turns a coach profile into
       supply a family can actually find and book.
       -----------------------------------------------------------------------
       Until now the "Create a listing" form only pushed a row into the
       in-memory PROGRAMS array (with a fabricated verified:true), so the
       listing lived in one browser tab, vanished on reload, and no family
       could ever see it. This writes the real `programs` row under the coach's
       own JWT — RLS `programs_insert_owner` already permits it (WITH CHECK the
       provider is owned by auth.uid()). status='published' so it goes live
       immediately; booking is still gated server-side by the
       enforce_booking_provider_verified trigger, so an unverified coach's
       listing is visible-but-not-bookable, never a safety hole.
       cancellation_policy is left to its 'flexible' default and NOT exposed —
       it drives refund math, frozen for the subscription rebuild. */
    createListing: function (f) {
      var no = guard(); if (no) return no;
      if (!provider || !provider.id) {
        return Promise.reject(new Error("Your coach profile hasn't finished loading — try again in a moment."));
      }
      var title = String((f && f.title) || "").trim();
      var sport = String((f && f.sport) || "").trim();
      if (!title) return Promise.reject(new Error("A listing needs a title."));
      if (!sport) return Promise.reject(new Error("Pick a sport for the listing."));
      var cap = Math.max(1, Math.floor(Number(f.cap) || 1));
      var body = {
        provider_id: provider.id,
        title: title,
        sport_type: sport,
        description: String((f.desc) || "").trim(),
        price: Math.max(0, Number(f.price) || 0),
        pricing_model: f.model || "single_session",
        max_capacity: cap,
        minimum_age: Math.max(0, Math.floor(Number(f.minAge) || 0)),
        maximum_age: Math.max(0, Math.floor(Number(f.maxAge) || 18)),
        program_type: "Training",
        status: "published",
      };
      var city = String((f.city) || provider.location || "").trim();
      if (city) body.city = city;
      return API.from("programs", "", {
        method: "POST", headers: { Prefer: "return=representation" }, body: body,
      }).then(function (rows) {
        if (!rows || !rows[0]) throw new Error("The listing was not created.");
        return rows[0];
      });
    },

    /* A listing is only BOOKABLE once it has a future session — a program with
       no sessions renders "No upcoming" and a family has nothing to book. Same
       owner-scoped rail (RLS sessions_insert_owner joins through the program to
       the provider's owner_id). */
    addSession: function (programId, s) {
      var no = guard(); if (no) return no;
      if (!programId) return Promise.reject(new Error("No listing to add a session to."));
      if (!s || !s.date) return Promise.reject(new Error("A session needs a date."));
      var body = {
        program_id: programId,
        start_date: s.date,
        start_time: s.startTime || null,
        end_time: s.endTime || null,
      };
      var capN = Number(s.capacity);
      if (isFinite(capN) && capN > 0) body.capacity = Math.floor(capN);
      if (s.title) body.title = String(s.title).trim();
      return API.from("sessions", "", {
        method: "POST", headers: { Prefer: "return=representation" }, body: body,
      }).then(function (rows) { return (rows && rows[0]) || null; });
    },

    current: function () { return provider; },
    clear: function () { provider = null; },

    /* What the dashboard should call the business. Falls back to the profile
       name, then to a neutral string — never to the seeded "Apex Performance
       Club", which is another operator's business. */
    displayName: function () {
      if (provider && provider.business_name) return provider.business_name;
      return "Your coaching business";
    },

    /* Whether this coach is publicly visible, and if not, why. The dashboard
       has to be able to say "pending review" honestly rather than implying a
       new signup is already listed. */
    publicState: function () {
      if (!provider) return { live: false, reason: "no-profile" };
      if (provider.status !== "approved") return { live: false, reason: "pending-approval" };
      if (provider.background_check_status !== "verified") {
        return { live: false, reason: "pending-check" };
      }
      return { live: true, reason: null };
    },
  };

  window.SporveCoach = ACCOUNT;
})();
