/* rsvp.js — the one-tap RSVP page (spec 13, slice 1). No framework, no build.
   Talks only to the guardian-link function; the token in the URL is the
   credential. Exposes its pure parts on window.SporvRsvp for tests. */
(function () {
  "use strict";
  var API = "https://tseszaprvtvqrkfpditu.supabase.co/functions/v1/guardian-link";
  var TOKEN_RE = /^[0-9a-f]{64}$/;

  function tokenFrom(search) {
    var m = /(?:^|[?&])t=([^&]*)/.exec(search || "");
    var t = m ? decodeURIComponent(m[1]) : "";
    return TOKEN_RE.test(t) ? t : null;
  }
  function when(iso, tz) {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: tz || "America/Chicago", weekday: "short", month: "short",
        day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
    } catch (e) { return String(iso || ""); }
  }
  function words(response) {
    return response === "yes" ? "See you there." : response === "no" ? "Got it — marked as not coming." : "Noted — we will check back closer to the day.";
  }

  function run(doc, fetchImpl, search) {
    var show = function (id) {
      ["loading", "ask", "done", "invalid", "error"].forEach(function (s) { doc.getElementById(s).hidden = s !== id; });
    };
    var t = tokenFrom(search);
    if (!t) { show("invalid"); return Promise.resolve("invalid"); }
    var load = function () {
      show("loading");
      return fetchImpl(API + "?t=" + t, { headers: { Accept: "application/json" } }).then(function (r) {
        if (r.status === 404) { show("invalid"); return "invalid"; }
        if (!r.ok) { show("error"); return "error"; }
        return r.json().then(function (g) {
          if (g.scope !== "rsvp") { show("invalid"); return "invalid"; }
          doc.getElementById("q").textContent = g.subject_label || "Are you coming?";
          doc.getElementById("when").textContent = when(g.subject_at, g.subject_tz) + (g.guardian_first_name ? " · Hi " + g.guardian_first_name : "");
          show("ask"); return "ask";
        });
      }).catch(function () { show("error"); return "error"; });
    };
    var form = doc.getElementById("f");
    form.onsubmit = function (ev) {
      ev.preventDefault();
      var btn = ev.submitter || form.querySelector("button[name=response]");
      var response = btn && btn.value;
      if (!/^(yes|no|maybe)$/.test(response || "")) return;
      Array.prototype.forEach.call(form.querySelectorAll("button"), function (b) { b.disabled = true; });
      return fetchImpl(API, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ t: t, response: response }) }).then(function (r) {
        Array.prototype.forEach.call(form.querySelectorAll("button"), function (b) { b.disabled = false; });
        if (r.status === 404) { show("invalid"); return "invalid"; }
        if (!r.ok) { show("error"); return "error"; }
        return r.json().then(function (res) {
          var n = (res.members && res.members.length) || 1;
          doc.getElementById("doneH").textContent = words(response);
          doc.getElementById("doneP").textContent = response + " recorded for " + n + " athlete" + (n === 1 ? "" : "s") + ".";
          show("done"); return "done";
        });
      }).catch(function () {
        Array.prototype.forEach.call(form.querySelectorAll("button"), function (b) { b.disabled = false; });
        show("error"); return "error";
      });
    };
    doc.getElementById("retry").onsubmit = function (ev) { ev.preventDefault(); load(); };
    return load();
  }

  if (typeof window !== "undefined") {
    window.SporvRsvp = { tokenFrom: tokenFrom, when: when, words: words, run: run, API: API };
    if (typeof document !== "undefined" && document.getElementById && document.getElementById("f") && !window.__SPORV_RSVP_NOBOOT) {
      run(document, window.fetch.bind(window), window.location.search);
    }
  }
})();
