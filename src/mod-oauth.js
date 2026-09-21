/* mod-oauth.js — synchronous OAuth popup starter.
   Browsers only honor window.open() as a user gesture when it runs
   synchronously inside the click handler. Awaiting the OAuth-start API first
   lets the popup blocker silently eat the consent window, so this module
   opens a BLANK popup first and navigates it once the server mints the URL.
   On any failure the blank popup is closed and the caller gets a
   machine-readable reason, mapped here to the actionable message the UI
   renders.
   Two failure modes this module now defends against, both of which used to
   strand the user on a permanent blank tab with no error:
   1. The OAuth-start request never settles (hung backend/network). It is
      bounded by REQUEST_TIMEOUT_MS; on timeout the popup closes and the
      caller gets reason "error" with a timeout message.
   2. The popup opens but never navigates (observed on iOS: the blank tab
      stays at about:blank even though no error is thrown). After navigating,
      a delayed check reads the popup's location: still about:blank means the
      navigation failed, so the popup is closed and the CURRENT tab goes to
      the consent URL instead (same-tab fallback — the OAuth callback returns
      to the app, so this is safe). A cross-origin read throwing means the
      popup did navigate away, which counts as success. */
(function () {
  "use strict";

  /* Longer than the edge function's own 20s deadline, so a slow-but-alive
     backend still wins the race; short enough that a hung request never
     strands the user on a blank tab indefinitely. */
  var REQUEST_TIMEOUT_MS = 25000;
  /* Delay before verifying the popup actually left about:blank. Long enough
     for a real navigation to commit; the check is skipped entirely once the
     popup is cross-origin (read throws) or user-closed. */
  var NAVIGATE_VERIFY_MS = 2000;

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
     one of "blocked" | "no-url" | "expired" | "error".
     The request is bounded by REQUEST_TIMEOUT_MS so a hung backend can never
     strand the popup on about:blank forever. After a successful navigate, a
     delayed check confirms the popup actually left about:blank; if it did
     not (popup navigation silently failed), the popup is closed and the
     current tab navigates to the consent URL instead. */
  function startPopup(deps, opts) {
    opts = opts || {};
    var timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : REQUEST_TIMEOUT_MS;
    var verifyMs = typeof opts.verifyMs === "number" ? opts.verifyMs : NAVIGATE_VERIFY_MS;
    var win;
    try {
      win = deps.open();
    } catch (e) {
      win = null;
    }
    if (!win) return Promise.resolve({ ok: false, reason: "blocked" });
    return requestWithTimeout(deps, timeoutMs).then(
      function (r) {
        if (r && r.url) {
          var navigateThrew = false;
          try {
            deps.navigate(win, r.url);
          } catch (e) {
            navigateThrew = true;
          }
          if (navigateThrew) {
            /* navigate() itself threw: the popup is unusable, go same-tab. */
            deps.close(win);
            window.location.href = r.url;
            return { ok: true };
          }
          /* Verify the popup actually navigated. Reading a cross-origin
             location throws, which is the success signal here: it means the
             popup left about:blank for the consent page. */
          setTimeout(function () {
            var stillBlank = false;
            try {
              stillBlank = !win.closed && win.location.href === "about:blank";
            } catch (e) {
              stillBlank = false;
            }
            if (stillBlank) {
              deps.close(win);
              window.location.href = r.url;
            }
          }, verifyMs);
          return { ok: true };        }
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

  /* Bounds the OAuth-start request so a hung backend or network can never
     leave the blank popup open forever. The timer is cleared as soon as the
     request settles either way. */
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
    return Promise.race([deps.request(), timeout]).then(
      function (v) { clearTimeout(timer); return v; },
      function (e) { clearTimeout(timer); throw e; }
    );
  }

  /* SAME-TAB FALLBACK. When the popup is blocked or unreliable, navigate the
     current tab to the consent URL instead. The OAuth callback returns to
     the app, so this is a safe fallback. Resolves { ok:true } if navigation
     started, or { ok:false, reason } on failure. */
  function startSameTab(deps) {
    return deps.request().then(
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

  window.SporvOAuth = { startPopup: startPopup, startSameTab: startSameTab, errorMessage: errorMessage };
})();
