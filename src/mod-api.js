/* mod-api.js — the site's one door to the backend.
   ---------------------------------------------------------------------------
   PHASE A of turning this page into the booking engine. Read-only wiring: it
   opens the connection and proves it works. No screen consumes it yet.

   WHY A FETCH WRAPPER AND NOT @supabase/supabase-js
   The SDK is ~40 KB, and this build inlines every script into one file and
   writes a sha256 of each into the CSP. Every added library is therefore a hash
   to maintain, a dependency to audit, and the first runtime dependency in a repo
   that has zero. Supabase's data, auth, RPC and function surfaces are all plain
   HTTP, so `fetch` reaches every one of them. RLS, the COPPA consent gate and
   the background-check gate apply identically either way — they live in the
   database, not in the client.

   Revisit only if realtime subscriptions are needed (live messaging). The SDK's
   other headline feature, token refresh, is ~15 lines here.

   WHY THE KEY IS IN THE SOURCE
   SUPABASE_ANON is a PUBLISHABLE key. It is designed to ship inside every
   client, identifies the project rather than a person, and grants exactly what
   the `anon` Postgres role is granted — which this project has deliberately
   narrowed. Verified against production 2026-08-11 from an anonymous client:

     providers.latitude / .longitude   -> 401 permission denied
     providers.stripe_account_id       -> 401 permission denied
     athletes                          -> [] (parent-only RLS)
     providers (approved)              -> 20 of 23; the 3 without a background
                                          check are hidden by the safety gate

   That is the security model working as intended. The key is not a secret; the
   grants behind it are the control.

   CONSEQUENCE OF THE SHARED BACKEND
   This page and the Flutter app talk to the SAME project. A booking made here
   appears in the app, and the reverse, with no sync layer — the database is the
   integration point. Every guard is enforced once, server-side, for both.
*/
(function () {
  "use strict";

  var SUPABASE_URL = "https://tseszaprvtvqrkfpditu.supabase.co";
  var SUPABASE_ANON = "sb_publishable_CLawpS61QZDONSyy8ZdhTQ_rjCBLYBW";

  /* The access token for a signed-in visitor. Null while anonymous, in which
     case the publishable key is sent as the bearer and PostgREST resolves the
     request to the `anon` role. Phase B replaces this with a real session. */
  var accessToken = null;

  function authHeaders() {
    return {
      apikey: SUPABASE_ANON,
      Authorization: "Bearer " + (accessToken || SUPABASE_ANON),
    };
  }

  /* One error shape for every failure — network, HTTP or Postgres — so callers
     never have to distinguish "fetch threw" from "PostgREST returned 401" from
     "a trigger raised". A raised trigger is the NORMAL way this backend rejects
     a write (consent missing, provider unverified, session full), so `message`
     must stay human-readable enough to show a user. */
  function ApiError(status, code, message) {
    this.name = "ApiError";
    this.status = status;
    this.code = code || null;
    this.message = message || "Something went wrong.";
  }
  ApiError.prototype = Object.create(Error.prototype);

  /* Set by mod-auth.js. Called when a request comes back 401/PGRST301 — an
     expired access token — so the request can be retried once with a fresh one.
     Kept as a hook rather than a direct import because mod-api.js inlines FIRST
     and must not depend on a module that may not exist. */
  var onUnauthorized = null;

  function rawRequest(path, opts) {
    opts = opts || {};
    var headers = authHeaders();
    headers["Content-Type"] = "application/json";
    if (opts.headers) {
      for (var k in opts.headers) headers[k] = opts.headers[k];
    }
    return fetch(SUPABASE_URL + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
      .then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
          if (!res.ok) {
            var msg = (data && (data.message || data.error_description || data.error)) ||
                      ("Request failed (" + res.status + ")");
            throw new ApiError(res.status, data && data.code, msg);
          }
          return data;
        });
      })
      .catch(function (err) {
        if (err instanceof ApiError) throw err;
        /* Offline, DNS, CORS, or a CSP connect-src violation all land here. The
           CSP case is worth calling out: the browser blocks the request before
           it leaves, and the only symptom is a TypeError plus a console entry. */
        throw new ApiError(0, "network", "Could not reach the server. Check your connection.");
      });
  }

  /* An access token lives ~1 hour. The failure that matters is not sign-in —
     it is a parent who opens a tab, is interrupted, returns, and taps Book.
     Without this they get "something went wrong" and no route out.

     PGRST301 is PostgREST's code for a JWT it cannot accept, which is what an
     expired token produces. Retry EXACTLY ONCE: if the refreshed token is also
     rejected the problem is not staleness, and looping would hammer the API
     and hide the real error. mod-auth's refresh() de-dupes concurrent callers,
     so three parallel 401s trigger one refresh, not three — which matters
     because GoTrue rotates refresh tokens and the 2nd would be spent. */
  function request(path, opts) {
    return rawRequest(path, opts).catch(function (err) {
      var expired = err instanceof ApiError && err.status === 401 &&
                    (err.code === "PGRST301" || err.code === "PGRST303");
      if (!expired || !onUnauthorized) throw err;
      return Promise.resolve()
        .then(function () { return onUnauthorized(); })
        .then(function () { return rawRequest(path, opts); })
        .catch(function () { throw err; });   // surface the ORIGINAL error
    });
  }

  var API = {
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON,

    /* mod-auth.js registers its refresh here. */
    onUnauthorized: function (cb) { onUnauthorized = typeof cb === "function" ? cb : null; },

    /* PostgREST. `query` is a raw query string, e.g.
       "select=id,title&status=eq.published&limit=20"

       `opts` is optional and reaches the same {method, headers, body} shape
       every other call here uses. It was NOT forwarded originally, which made
       writes fail in the most misleading way available: a caller passing
       {method:"PATCH", body:{...}} had the whole object dropped, so the
       request went out as a GET, PostgREST answered 200 with the row
       UNCHANGED, and the caller's .then() saw a perfectly valid record and
       reported success. Nothing threw, nothing logged, and the edit simply did
       not happen. Read paths could never have caught it — they pass no opts. */
    from: function (table, query, opts) {
      return request("/rest/v1/" + table + (query ? "?" + query : ""), opts);
    },

    /* A SECURITY DEFINER function, e.g. search_listings / search_relax. */
    rpc: function (fn, args) {
      return request("/rest/v1/rpc/" + fn, { method: "POST", body: args || {} });
    },

    /* An Edge Function, e.g. stripe-create-checkout. */
    fn: function (name, body) {
      return request("/functions/v1/" + name, { method: "POST", body: body || {} });
    },

    setAccessToken: function (t) { accessToken = t || null; },
    isSignedIn: function () { return !!accessToken; },
    /* Read access for callers that talk to NON-Supabase same-origin endpoints
       (/api/ai) yet must prove who the visitor is. The token is the visitor's
       own credential — handing it to their own next request leaks nothing. */
    getAccessToken: function () { return accessToken; },

    /* Liveness probe. Resolves { ok, programs } or rejects with an ApiError.
       Used by smoke.sh to assert the built page can actually reach the backend
       under its real CSP — the check that would have caught connect-src 'self'
       silently blocking every request. */
    ping: function () {
      return API.from("programs", "select=id&status=eq.published&limit=1")
        .then(function (rows) {
          return { ok: true, programs: Array.isArray(rows) ? rows.length : 0 };
        });
    },
  };

  window.SporveAPI = API;
})();
