/* mod-oauth.js — synchronous OAuth popup starter.
   Browsers only honor window.open() as a user gesture when it runs
   synchronously inside the click handler. Awaiting the OAuth-start API first
   lets the popup blocker silently eat the consent window, so this module
   opens a BLANK popup first and navigates it once the server mints the URL.
   On any failure the blank popup is closed and the caller gets a
   machine-readable reason, mapped here to the actionable message the UI
   renders. */
(function () {
  "use strict";

  /* Actionable copy for each failure reason. Errors state what failed and
     what to do — never a blank pane, never a raw 500. */
  var MESSAGES = {
    blocked: "The sign-in window was blocked. Allow popups for sporv.ai, then click Connect again.",
    expired: "Your sign-in expired. Sign out and sign back in, then try connecting again.",
    "no-url": "Could not start the connection.",
    error: "Could not start the connection."
  };

  function errorMessage(reason) {
    return MESSAGES[reason] || MESSAGES.error;
  }

  /* deps:
       open()     — window.open("", "_blank", "noopener"); null when blocked.
                    MUST be called synchronously inside the click handler.
       navigate(w, url) — point the blank popup at the consent URL.
       close(w)   — close the blank popup on failure.
       request()  — Promise of the OAuth-start call, resolving { url }.
     Resolves { ok:true } on success, or { ok:false, reason } where reason is
     one of "blocked" | "no-url" | "expired" | "error". */
  function startPopup(deps) {
    var win;
    try {
      win = deps.open();
    } catch (e) {
      win = null;
    }
    if (!win) return Promise.resolve({ ok: false, reason: "blocked" });
    return deps.request().then(
      function (r) {
        if (r && r.url) {
          deps.navigate(win, r.url);
          return { ok: true };
        }
        deps.close(win);
        return { ok: false, reason: "no-url" };
      },
      function (err) {
        deps.close(win);
        if (err && err.status === 401) return { ok: false, reason: "expired", err: err };
        return { ok: false, reason: "error", err: err };
      }
    );
  }

  window.SporvOAuth = { startPopup: startPopup, errorMessage: errorMessage };
})();
