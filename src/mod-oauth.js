/* mod-oauth.js — OAuth connect via same-tab redirect.
   The connect flow used to open a BLANK popup synchronously in the click
   handler and navigate it once the server minted the consent URL. That
   pattern is dead: when the popup takes focus, several browsers (mobile
   Safari, and the automation browser in production testing 2026-09-21)
   suspend the opener tab's JavaScript — fetch callbacks and timers never
   run while the popup is open, so the blank popup is never navigated, never
   closed, and no error ever surfaces. Six consecutive production tests
   showed the identical stranded blank popup.
   The redirect flow keeps everything in ONE tab: the click fetches the
   consent URL (bounded by REQUEST_TIMEOUT_MS so a hung backend can never
   hang the UI), then the current tab navigates to it. The OAuth callback
   returns to the app, so this is safe, and a failure prints an actionable
   error instead of stranding the user on a blank tab. */
(function () {
  "use strict";

  /* Longer than the edge function's own 20s deadline, so a slow-but-alive
     backend still wins the race; short enough that a hung request never
     hangs the UI indefinitely. */
  var REQUEST_TIMEOUT_MS = 25000;

  /* Actionable copy for each failure reason. Errors state what failed and
     what to do — never a blank pane, never a raw 500. */
  var MESSAGES = {
    expired: "Your sign-in expired. Sign out and sign back in, then try connecting again.",
    "no-url": "Could not start the connection.",
    error: "Could not start the connection."
  };

  function errorMessage(reason) {
    return MESSAGES[reason] || MESSAGES.error;
  }

  /* Bounds the OAuth-start request so a hung backend or network can never
     hang the UI forever. The timer is cleared as soon as the request settles
     either way. */
  function requestWithTimeout(deps, ms) {
    var timer = null;
    var timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        var err = new Error("The connection request timed out. Check your connection and try again.");
        err.status = 0;
        err.code = "timeout";
        reject(err);
      }, ms);
    });
    var req;
    try {
      req = deps.request();
    } catch (e) {
      /* A synchronously-throwing request must never strand the flow with no
         settlement: convert it into a rejection so the caller always gets a
         reason it can print. */
      clearTimeout(timer);
      return Promise.reject(e);
    }
    return Promise.race([req, timeout]).then(
      function (v) { clearTimeout(timer); return v; },
      function (e) { clearTimeout(timer); throw e; }
    );
  }

  /* REDIRECT FLOW. Fetches the consent URL, then navigates the CURRENT tab
     to it. Resolves { ok:true } once navigation starts, or
     { ok:false, reason } where reason is one of "no-url" | "expired" |
     "error". deps:
       request() — Promise of the OAuth-start call, resolving { url }. */
  function startRedirect(deps, opts) {
    opts = opts || {};
    var timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : REQUEST_TIMEOUT_MS;
    return requestWithTimeout(deps, timeoutMs).then(
      function (r) {
        if (r && r.url) {
          window.location.href = r.url;
          return { ok: true };
        }
        return { ok: false, reason: "no-url" };
      },
      function (err) {
        if (err && err.status === 401) return { ok: false, reason: "expired", err: err };
        return { ok: false, reason: "error", err: err };
      }
    );
  }

  window.SporvOAuth = { startRedirect: startRedirect, errorMessage: errorMessage };
})();
