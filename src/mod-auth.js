/* mod-auth.js — real identity, replacing the S.auth mock.
   ---------------------------------------------------------------------------
   PHASE B. This file owns the session. It does NOT touch the render layer and
   it does not change the shape of S.auth — 747 reads of S across 73 keys exist,
   and the whole migration strategy depends on the renderer never learning that
   anything changed. S.auth stays {status:"guest"|"verified", user:…}; only the
   contents become true.

   MEASURED AGAINST PRODUCTION 2026-08-11, not assumed:

     GET /auth/v1/settings
       disable_signup      false      email signup is open
       mailer_autoconfirm  FALSE      <- signup does NOT return a session
       external            google, email

   That third line is the one that matters. The mock flipped to "verified" the
   instant you clicked. Reality sends a confirmation email and returns a user
   with NO access_token, so a signup screen that assumes it can proceed will
   silently strand every new family. signUp() below returns
   {needsConfirmation:true} for exactly this case, and the caller must show it.

   ERROR SHAPES, also measured rather than guessed:

     wrong password        400  error_code=invalid_credentials
     expired / bad JWT     401  code=PGRST301   <- the refresh trigger
     bad refresh token     400  error_code=validation_failed

   WHY localStorage AND NOT sessionStorage
   The page already persists UI state to sessionStorage, which dies with the
   tab. A session must outlive that: the realistic flow is a parent browsing on
   Monday, closing the tab, and returning Wednesday to book. sessionStorage
   would force a re-login every visit. The refresh token is scoped to this
   origin, which is the same protection the Supabase SDK relies on.

   WHY REFRESH IS THE CENTRAL PROBLEM
   Access tokens live ~1 hour. The failure that matters is not signup — it is a
   parent who opens a tab, gets distracted, comes back, and taps Book. Without
   refresh every call 401s and they see "something went wrong" with no route
   out. So refresh happens two ways: proactively on a timer, and reactively when
   a request comes back PGRST301 (retried exactly once — see mod-api.js).
*/
(function () {
  "use strict";

  var API = window.SporveAPI;
  if (!API) { return; }                      // mod-api.js must inline first

  var KEY = "sporve:session:v1";
  var REFRESH_MARGIN_MS = 5 * 60 * 1000;     // refresh 5 min before expiry
  var session = null;                        // {access_token, refresh_token, expires_at, user}
  var refreshTimer = null;
  var refreshInFlight = null;                // de-dupes concurrent refreshes

  function nowMs() { return Date.now(); }

  function save() {
    try {
      if (session) localStorage.setItem(KEY, JSON.stringify(session));
      else localStorage.removeItem(KEY);
    } catch (e) { /* private mode / quota — session simply won't survive reload */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      /* Reject anything that isn't the shape we wrote. A malformed blob here
         would otherwise be handed to the API layer as a bearer token. */
      if (!s || typeof s.access_token !== "string" || typeof s.refresh_token !== "string") return null;
      return s;
    } catch (e) { return null; }
  }

  function apply(tokens) {
    if (!tokens || !tokens.access_token) { clear(); return null; }
    session = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      /* GoTrue returns expires_in (seconds). Store an absolute instant so a
         reload can reason about it without knowing when it was issued. */
      expires_at: nowMs() + ((tokens.expires_in || 3600) * 1000),
      user: tokens.user || (session && session.user) || null,
    };
    API.setAccessToken(session.access_token);
    save();
    scheduleRefresh();
    return session;
  }

  function clear() {
    session = null;
    API.setAccessToken(null);
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    save();
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    if (!session) return;
    var delay = session.expires_at - nowMs() - REFRESH_MARGIN_MS;
    if (delay < 0) delay = 0;
    /* setTimeout caps around 24.8 days; a session never lives that long, but
       clamp anyway so a corrupt expires_at cannot schedule in the past forever. */
    refreshTimer = setTimeout(function () { refresh().catch(function () {}); },
                              Math.min(delay, 2147483647));
  }

  /* Exchange the refresh token. Concurrent callers share one in-flight request:
     without this, three parallel 401s would fire three refreshes, and GoTrue
     rotates refresh tokens — the 2nd and 3rd would use an already-spent token
     and log the user out. */
  function refresh() {
    if (refreshInFlight) return refreshInFlight;
    if (!session || !session.refresh_token) return Promise.reject(new Error("no session"));

    refreshInFlight = fetch(API.url + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: API.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok || !res.d.access_token) {
          /* validation_failed = the refresh token is spent or revoked. There is
             no recovering; sign out cleanly rather than looping. */
          clear();
          throw new Error(res.d.msg || "Session expired");
        }
        return apply(res.d);
      })
      .then(function (s) { refreshInFlight = null; return s; })
      .catch(function (e) { refreshInFlight = null; throw e; });

    return refreshInFlight;
  }

  function post(path, body) {
    return fetch(API.url + path, {
      method: "POST",
      headers: { apikey: API.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) {
          var e = new Error(d.msg || d.error_description || "Something went wrong.");
          e.code = d.error_code || d.code || null;
          e.status = r.status;
          throw e;
        }
        return d;
      });
    });
  }

  var AUTH = {
    /* Sign in. Resolves the session; rejects with a message safe to show. */
    /* PASSWORD RESET, for real. The host's #forgotForm handler was a pure mock:
       no network call at all, any non-empty string accepted as the code, and a
       "Password reset — please log in" toast while the old password still
       failed. A locked-out parent had no recovery path and was told they did.

       GoTrue's flow is two calls, not one:
         recover()        POST /auth/v1/recover   -> emails a 6-digit OTP
         resetPassword()  POST /auth/v1/verify    -> exchanges OTP for a session
                          PUT  /auth/v1/user      -> sets the new password

       The PUT only works while the recovery session from verify is applied,
       which is why apply() runs in between rather than at the end. */
    recover: function (email) {
      /* Resolves the SAME way whether or not the address exists. GoTrue already
         behaves this way; surfacing a difference here would turn the form into
         an account-enumeration oracle — "this email has a Sporv account" is
         exactly the fact a stranger should not be able to test. */
      return post("/auth/v1/recover", { email: String(email || "").trim() })
        .then(function () { return true; })
        .catch(function () { return true; });
    },

    resetPassword: function (email, token, password) {
      return post("/auth/v1/verify", {
        type: "recovery",
        email: String(email || "").trim(),
        token: String(token || "").trim(),
      }).then(function (r) {
        var sess = apply(r);            // the recovery session authorises the PUT
        var tok = sess && sess.access_token;
        if (!tok) throw new Error("That code was not accepted. Request a new one.");
        /* Written out rather than routed through post(): this is the only PUT in
           the module and it is the only call that must carry a bearer token —
           post() sends the anon key alone, which GoTrue would reject here. */
        return fetch(API.url + "/auth/v1/user", {
          method: "PUT",
          headers: {
            apikey: API.anonKey,
            Authorization: "Bearer " + tok,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ password: String(password || "") }),
        }).then(function (res) {
          return res.json().then(function (d) {
            if (!res.ok) throw new Error(d.msg || d.error_description || "Could not set that password.");
            return d;
          });
        });
      });
    },

    signIn: function (email, password) {
      return post("/auth/v1/token?grant_type=password", {
        email: String(email || "").trim(),
        password: String(password || ""),
      }).then(apply);
    },

    /* Sign up. Because mailer_autoconfirm is FALSE, a successful signup returns
       a user WITHOUT tokens. Callers must handle {needsConfirmation:true} — the
       family cannot proceed until they click the emailed link.

       `meta` lands in raw_user_meta_data, which handle_new_user() reads to build
       the profiles row. It honours only 'searcher' | 'provider' and defaults to
       searcher, so a client cannot elect itself into a privileged role here. */
    signUp: function (email, password, meta) {
      return post("/auth/v1/signup", {
        email: String(email || "").trim(),
        password: String(password || ""),
        data: meta || {},
      }).then(function (d) {
        if (d.access_token) return { needsConfirmation: false, session: apply(d) };
        return { needsConfirmation: true, session: null, email: d.email || email };
      });
    },

    /* Start Google OAuth. GoTrue redirects back to redirectTo with the tokens
       in the URL FRAGMENT (never the query string, so they stay out of server
       logs and Referer headers). completeOAuth() picks them up. */
    oauthUrl: function (provider, redirectTo) {
      return API.url + "/auth/v1/authorize?provider=" + encodeURIComponent(provider || "google") +
             "&redirect_to=" + encodeURIComponent(redirectTo || window.location.origin);
    },

    /* Call on boot. If the URL fragment carries tokens from an OAuth return,
       adopt them and scrub the fragment so a shared link never leaks a session. */
    completeOAuth: function () {
      var h = window.location.hash || "";
      if (h.indexOf("access_token=") === -1) return null;
      var p = new URLSearchParams(h.replace(/^#/, ""));
      var s = apply({
        access_token: p.get("access_token"),
        refresh_token: p.get("refresh_token"),
        expires_in: Number(p.get("expires_in") || 3600),
      });
      try {
        history.replaceState(null, "", window.location.pathname + window.location.search);
      } catch (e) { /* non-fatal: the fragment stays visible but the session is valid */ }
      return s;
    },

    signOut: function () {
      var t = session && session.access_token;
      clear();
      if (!t) return Promise.resolve();
      /* Best-effort server-side revoke. The local session is already gone, so a
         failure here must never surface to the user. */
      return fetch(API.url + "/auth/v1/logout", {
        method: "POST",
        headers: { apikey: API.anonKey, Authorization: "Bearer " + t },
      }).then(function () {}).catch(function () {});
    },

    /* The authoritative user record: auth identity joined to the profiles row,
       which carries `role`. Role is READ FROM THE DATABASE, never inferred from
       the client, because profiles.role gates coach surfaces and a client-side
       guess would be a privilege decision made by the browser. */
    loadProfile: function () {
      if (!session) return Promise.resolve(null);
      return API.from("profiles", "select=id,role,first_name,last_name,email,phone_number&limit=1")
        .then(function (rows) { return (rows && rows[0]) || null; });
    },

    /* Restore on boot: adopt an OAuth return, else a stored session, refreshing
       if it is expired or close to it. Resolves the session or null. */
    restore: function () {
      var fromOAuth = AUTH.completeOAuth();
      if (fromOAuth) return Promise.resolve(fromOAuth);

      var stored = load();
      if (!stored) return Promise.resolve(null);

      session = stored;
      API.setAccessToken(session.access_token);

      if (nowMs() >= session.expires_at - REFRESH_MARGIN_MS) {
        return refresh().catch(function () { return null; });
      }
      scheduleRefresh();
      return Promise.resolve(session);
    },

    refresh: refresh,
    session: function () { return session; },
    isSignedIn: function () { return !!(session && session.access_token); },
    userId: function () { return (session && session.user && session.user.id) || null; },
  };

  /* Hand mod-api.js the refresh hook. It calls this on a 401/PGRST301 and
     retries the original request exactly once — see requestWithRetry there. */
  API.onUnauthorized(function () { return refresh(); });

  window.SporveAuth = AUTH;
})();
