/* mod-catalog.js — PHASE C1. The listing catalogue, live.
   ---------------------------------------------------------------------------
   This is the change that stops the marketplace being a sample. Until now the
   thirty listings on this page came from `RAW`, a constant in the host. They
   render beautifully and cannot be booked, because no row behind them exists.
   After this file they come from `programs` in the production database — the
   same rows the Flutter app reads, so a listing added there appears here with
   no sync layer.

   THE ONE RULE THAT MAKES THIS SMALL
   `PROGRAMS` is read 747 times across the host and ten modules, and several
   modules capture it at load. So this file NEVER REASSIGNS IT. It empties the
   array and pushes the live rows into the same object:

       PROGRAMS.length = 0; PROGRAMS.push.apply(PROGRAMS, live);

   Every existing reference — including `const CAT = () => PROGRAMS` inside
   mod-companies' IIFE — keeps pointing at the array that just changed
   underneath it. Reassignment would work for the lazy readers and silently
   strand the eager ones, which is the kind of split-brain that renders half a
   page from live data and half from the seed.

   WHAT IS ACTUALLY DIFFERENT ABOUT LIVE ROWS:

     seed fixture                  live
     fixed fictional records       production rows that can grow or disappear
     ids "prog_1".."prog_30"       UUIDs
     disclosed sample activity     current catalogue and session records
     mixed fixture coordinates     Chicagoland listing coordinates

   Verification is not inferred from visibility. A live listing can render
   without a badge when its provider row lacks dated evidence, and the family
   can remove it with the verified-only filter. The database booking write is
   the final authority: a visible listing does not grant an unchecked coach the
   right to accept a booking.

   FAIL-SAFE, AND WHY IT IS NOT OPTIONAL
   Any failure — offline, CSP, RLS change, a 500 — leaves the seeded catalogue
   exactly as it is and the page renders as it does today. A marketplace that
   shows an empty grid when the network hiccups is worse than one showing
   sample data, and this page's whole architecture is "render from S, always".
   So hydration is additive and reversible: it either replaces the array
   wholesale or does not touch it.

   HOW TO TELL WHICH ONE YOU GOT
   `<html data-catalog>` is set to "live" or "seed". It is set at RUNTIME, so
   it never appears in the served HTML — grep the rendered DOM, not the
   response body (see CLAUDE.md §1).
*/
(function () {
  "use strict";

  var API = window.SporveAPI;
  if (!API) { return; }

  /* Columns are listed explicitly and `*` is never used. Two reasons, both
     load-bearing: `programs.embedding` is a 768-dimension vector that adds
     ~10 KB of base64 per row to a payload that is otherwise ~600 bytes, and
     `providers` has NO blanket select grant for anon — the column-privacy
     migration revoked it and granted fifteen columns by name, so `*` returns
     42501 permission denied rather than a trimmed row.

     The `providers(...)` embed is a PostgREST resource embedding over the
     programs.provider_id foreign key. It resolves in ONE round trip and obeys
     the same RLS and column grants as a direct read. Visibility is not treated
     as proof of clearance; toProgram() still requires status plus a completion
     date before it exposes a badge. */
  var PROGRAM_COLS = [
    "id", "title", "description", "sport_type", "skill_level", "age_group",
    "minimum_age", "maximum_age", "price", "currency", "pricing_model",
    "max_capacity", "enrolled_count", "average_rating", "total_reviews",
    "is_featured", "whats_included", "cancellation_policy", "program_type",
    "city", "state", "latitude", "longitude", "cover_image",
    "providers(id,business_name,bio,location,provider_type,background_check_status," +
      "background_check_completed_at," +
      "coach_years_coaching,credentials,public_latitude,public_longitude)",
  ].join(",");

  var SESSION_COLS = "id,program_id,title,start_date,start_time,end_time,timezone,address,capacity";

  function cap(s) {
    s = String(s || "");
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  /* Map one live row onto the record shape the renderer already knows. Every
     key here exists because something reads it; adding a live column without a
     reader belongs in the query, not in this object. */
  function toProgram(r) {
    var pv = r.providers || {};
    var sport = r.sport_type || "Soccer";
    var img = (typeof phShot === "function") ? phShot(sport) : "";
    return {
      id: r.id,
      biz: pv.business_name || "Sporv provider",
      /* THE BADGE NOW REQUIRES EVIDENCE, NOT A FLAG.
         `background_check_status='verified'` alone was true for 20 providers
         with background_check_completed_at NULL — every badge on production
         was a claim nobody had made. A status column can be set by anyone with
         write access; a COMPLETION DATE only exists if a check actually
         finished. So the badge keys on both, and until a vendor writes that
         date no coach is shown as checked.
         `checkedOn` is carried so the trust surfaces can say WHEN. */
      verified: pv.background_check_status === "verified"
                && !!pv.background_check_completed_at,
      checkedOn: pv.background_check_completed_at || null,
      sport: sport,
      title: r.title || "",
      desc: r.description || "",
      price: Number(r.price) || 0,
      model: r.pricing_model || "single_session",
      rating: Number(r.average_rating) || 0,
      reviews: Number(r.total_reviews) || 0,
      /* The listing's own coordinates: this is where the session happens and a
         parent has to be able to find it. Note for the backend, deliberately
         left visible rather than papered over: `programs.latitude/longitude`
         are readable by anon at full precision, while `providers` coordinates
         were rounded to 2dp and revoked in the column-privacy migration. The
         two tables disagree about how precise a public location may be. That
         is a backend decision, and rounding here would be theatre — the exact
         value stays fetchable whatever this client does with it. */
      lng: Number(r.longitude),
      lat: Number(r.latitude),
      featured: !!r.is_featured,
      skill: cap(r.skill_level) || "All Levels",
      ageGroup: r.age_group || "All Ages",
      minAge: Number(r.minimum_age) || 0,
      maxAge: Number(r.maximum_age) || 18,
      cap: Number(r.max_capacity) || 0,
      enrolled: Number(r.enrolled_count) || 0,
      /* cover_image is null on every published row today, so the generated
         placeholder stays. It is a deterministic per-sport SVG, not a remote
         fetch — a remote image would be blocked by this page's CSP anyway. */
      img: r.cover_image || img,
      gallery: [r.cover_image || img, img, img],
      whatsIncluded: Array.isArray(r.whats_included) && r.whats_included.length
        ? r.whats_included : ["Professional coaching"],
      address: [r.city, r.state].filter(Boolean).join(", ") || (pv.location || ""),
      cancellationPolicy: r.cancellation_policy || "moderate",
      /* Live-only extras. Nothing reads these yet; they are what Phase C3
         (provider detail) and Phase D (booking) need, and carrying them now
         costs nothing because they are already in the response. */
      providerId: pv.id || null,
      providerType: pv.provider_type || "solo",
      providerBio: pv.bio || "",
      providerYears: pv.coach_years_coaching || null,
      providerCredentials: Array.isArray(pv.credentials) ? pv.credentials : [],
      currency: r.currency || "USD",
      live: true,
    };
  }

  function toSlot(s) {
    return {
      id: s.id,
      programId: s.program_id,
      title: s.title || "Training Session",
      date: s.start_date,
      startTime: s.start_time || "",
      endTime: s.end_time || "",
      /* The seed carries a short label ("CST"); live carries an IANA zone
         ("America/Chicago"). Rendered as-is either way, so trim the zone to its
         city rather than print a slash in the middle of a time. */
      tz: String(s.timezone || "").split("/").pop().replace(/_/g, " "),
      address: s.address || "",
      capacity: s.capacity || null,
      live: true,
    };
  }

  function mark(state) {
    try { document.documentElement.setAttribute("data-catalog", state); } catch (e) {}
  }

  var loaded = false;
  /* Keep the deterministic fallback before the first live mutation. reload()
     can fail after a successful hydration; without this snapshot the module
     labeled the page "seed" while leaving yesterday's live rows and slots in
     memory. Preserve the array identity, but restore its original contents. */
  var fallbackPrograms = (typeof PROGRAMS !== "undefined" && Array.isArray(PROGRAMS))
    ? PROGRAMS.slice() : [];

  function clearLiveSlots() {
    if (typeof LIVE_SLOTS !== "object" || !LIVE_SLOTS) return;
    Object.keys(LIVE_SLOTS).forEach(function (key) { delete LIVE_SLOTS[key]; });
  }

  function restoreFallback() {
    if (typeof PROGRAMS !== "undefined" && Array.isArray(PROGRAMS) && fallbackPrograms.length) {
      PROGRAMS.length = 0;
      PROGRAMS.push.apply(PROGRAMS, fallbackPrograms);
      if (typeof rebuildBusinesses === "function") rebuildBusinesses();
    }
    clearLiveSlots();
    loaded = false;
    mark("seed");
    return false;
  }

  /* A `file://` page never hydrates.
     ------------------------------------------------------------------------
     Two reasons, and the second is the one that matters.

     1. It is not a deployment target. Production and every preview serve over
        https from a real origin under a real CSP; opening index.html off disk
        is a development convenience.

     2. IT KEEPS CI HONEST. smoke.sh opens the built file directly for most of
        its run, and roughly nine of its assertions measure RENDERED CONTENT —
        no emoji, no exclamation marks, every font size on the 8-step scale, no
        horizontal overflow at 390px, a contrast ratchet that fails if it
        moves. Those describe the DESIGN SYSTEM, and they can only be asserted
        against a fixed dataset. Let them read the database instead and a coach
        writing "Let's go!" in a listing title turns the build red, with no way
        for the person reading the failure to work out why. The seeded
        catalogue is the fixture those tests deserve.

     The live path is still tested — smoke's CSP-serving block runs on
     http://127.0.0.1 with production's real headers, which is where a
     connect-src or grant regression would actually show up, and where the
     structural live assertions live. */
  function offlineByDesign() {
    try { return window.location.protocol === "file:"; } catch (e) { return false; }
  }

  /* ── THE SWITCH, AND WHY IT IS OFF ──────────────────────────────────────
     Everything above works. It is not turned on yet, and that is a decision
     rather than an oversight.

     An audit of all 747 catalogue reads found that swapping the array is the
     easy half. The render layer carries assumptions the seed satisfied and
     production does not, and two of them are visible on the first screen:

       · MAP GEOGRAPHY — RESOLVED 2026-08-17. The map box was once hardcoded
         to Miami while the seed coordinates were also Miami under Chicago
         address strings. Both are fixed: seed coordinates are now real
         Chicagoland, and mapBounds() DERIVES the box from the listings, so any
         metro's coordinates project on-canvas. Left here as the record of why
         the box is computed, not constant.

       · THE "TEAM PROGRAMS" BAND GOES PERMANENTLY EMPTY. `ptypeOf()` sorts a
         listing into solo/camp/org, and the only route into `org` for a
         title without "squad|league|club|academy" is `model === "monthly"`.
         Every live row is `single_session`, so `org` is now unreachable and
         the browse page renders a heading over "No matching programs right
         now." forever. Separately mod-companies' `typeOf()` keys off literal
         "prog_N" ids, so it labels all ten `private` — two type systems that
         now disagree with each other.

     BOTH ARE NOW FIXED, and the switch is on:

       · map bounds are DERIVED from the listings (mapBounds() in the host),
         so they cannot drift from the data again
       · ptypeOf() reads `providers.provider_type`, a real column, in
         preference to guessing from the title; and a band with nothing in the
         whole catalogue renders NOTHING rather than a heading over a
         permanent empty state. Production is currently twenty solo providers,
         so browse shows one honest band instead of three with two dead.

     `?live=0` still forces the seeded catalogue for a single page load, which
     is how to compare the two or get a deterministic page for a screenshot. */
  var DEFAULT_LIVE = true;

  function enabled() {
    if (offlineByDesign()) return false;
    try {
      var q = String(window.location.search || "");
      if (/[?&]live=1\b/.test(q)) return true;
      if (/[?&]live=0\b/.test(q)) return false;
    } catch (e) {}
    return DEFAULT_LIVE;
  }

  /* Resolves true if the catalogue was replaced, false if the seed stands.
     It never rejects: a caller that has to remember to catch is a caller that
     will one day forget, and the consequence would be an unhandled rejection
     on a page whose only job at that moment is to render. */
  function hydrate() {
    if (loaded) return Promise.resolve(true);
    if (typeof PROGRAMS === "undefined" || !Array.isArray(PROGRAMS)) {
      mark("seed");
      return Promise.resolve(false);
    }
    if (!enabled()) {
      return Promise.resolve(restoreFallback());
    }

    return Promise.all([
      API.from("programs",
        "select=" + encodeURIComponent(PROGRAM_COLS) +
        "&status=eq.published&order=is_featured.desc,average_rating.desc&limit=200"),
      API.from("sessions",
        "select=" + encodeURIComponent(SESSION_COLS) +
        /* 5000, not 1000. Publishing the archived catalogue took future sessions
           from 302 to 1182 across 125 listings, and a 1000-row ceiling on a
           date-ordered query silently drops the tail — the listings whose
           sessions sort last simply have no openings, with no error anywhere.
           A truncated fetch is indistinguishable from an empty one at the call
           site, which is exactly how this class of bug hides. */
        "&start_date=gte." + todayISO() + "&order=start_date.asc&limit=5000"),
    ])
      .then(function (res) {
        var rows = res[0], slots = res[1];
        /* An empty catalogue is a FAILURE, not a result. Reaching the server
           and being told there is nothing to book would blank every grid,
           every rail and every stat line on the site. Whatever caused it — an
           RLS change, an unpublish, a bad filter — the seeded page is the
           better thing to show while it is investigated. */
        if (!Array.isArray(rows) || rows.length === 0) {
          return restoreFallback();
        }

        var live = rows.map(toProgram);

        /* Slots first: swapping the catalogue before the slot index exists
           would leave a window in which a live listing resolves to the seed's
           id-parsing fallback and produces Invalid Date. Microtask-sized, but
           the ordering is free. */
        var byProgram = {};
        (Array.isArray(slots) ? slots : []).forEach(function (s) {
          if (!s.program_id) return;
          (byProgram[s.program_id] = byProgram[s.program_id] || []).push(toSlot(s));
        });
        if (typeof LIVE_SLOTS === "object" && LIVE_SLOTS) {
          /* A refresh is a replacement, not a merge. If a session was deleted
             between fetches, retaining its old key would keep a bookable-looking
             time alive until the tab closed. */
          clearLiveSlots();
          Object.keys(byProgram).forEach(function (k) { LIVE_SLOTS[k] = byProgram[k]; });
        }

        /* In place. See the header — this is the whole migration strategy.
           The sample camp/team companies are appended so browse has three
           populated rows: production is solo trainers only, and those two rows
           would otherwise be empty. They carry sample:true / live:false, so the
           booking path refuses them — see SAMPLE_ORGS in the host. */
        PROGRAMS.length = 0;
        PROGRAMS.push.apply(PROGRAMS, live);
        if (typeof sampleListings === "function") {
          PROGRAMS.push.apply(PROGRAMS, sampleListings());
        }

        /* BUSINESSES is derived from PROGRAMS at load and captured by the
           browse rails, so mutating PROGRAMS alone leaves it describing six
           businesses that no longer exist. Recomputed in place, same array. */
        if (typeof rebuildBusinesses === "function") rebuildBusinesses();

        loaded = true;
        mark("live");
        return true;
      })
      .catch(function () {
        /* Offline, CSP, 5xx, a revoked grant — all identical from here, and
           all have the same right answer: restore the disclosed fallback. */
        return restoreFallback();
      });
  }

  /* The catalogue query asks for sessions from today forward. `TODAY` is the
     host's fixed demo anchor (2026-08-03) and the real clock is what a live
     query must use — a hardcoded date would start silently dropping real
     sessions the moment it fell behind. */
  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  /* `ready` settles when hydration is DECIDED — live or seed, success or
     failure — never rejecting. It exists because the test harness had no way
     to know when to measure: ci-browse's `goto` waits for the document `load`
     event, which a fetch started during script init does not delay, so every
     assertion after a navigation was racing the network. The previous answer
     to that class of problem in smoke.sh was `sleep 1`, which is a coin flip
     against a round trip of unbounded length.

     Playwright's page.evaluate auto-awaits a returned promise, so
     `SporveCatalog.ready.then(s => 'OK:' + s)` turns the race into a
     deterministic wait with no change to the harness. */
  var ready = null;

  window.SporveCatalog = {
    hydrate: function () {
      if (!ready) ready = hydrate();
      return ready;
    },
    /* Force a fresh fetch — used after a coach PUBLISHES a listing so the new
       program + its sessions appear immediately in their listings table and in
       browse, without a page reload. hydrate() short-circuits on `loaded`, so
       clearing it is what lets the second fetch run and re-fill PROGRAMS /
       LIVE_SLOTS in place. Resolves live/seed like the first hydrate; never
       rejects. */
    reload: function () {
      loaded = false;
      ready = hydrate();
      return ready;
    },
    get ready() { return ready || Promise.resolve(false); },
    isLive: function () { return loaded; },
    /* Whether this page load INTENDED to go live, independent of whether it
       succeeded — so a test can tell "opted out" from "tried and fell back". */
    enabled: enabled,
  };
})();
