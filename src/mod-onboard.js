/* MOD_ONBOARD — login and onboarding, staff-only, passwordless. Route: setup.
   Colour deviation from the prototype, on purpose: --ink-3 #6B7480 (4.11:1 on
   the ground) and the #7E8BA2 wordmark (3.90:1) fail AA and the repo's
   dark-ground gate; #8C95A3 and #93A1B8 are the nearest tints that pass.
   Owner prototype 2026-09-15 ("the login process should be like this and
   look exactly like this"): a split screen for the account step, fullscreen
   after; magic link OR Google/Apple; no password field; six numbered steps
   (what you run · who you are · connect · roster · first run · queue).
   Rules (owner 2026-09-16): everyone who logs in is staff; a new account
   starts EMPTY (its own org and nothing else); every step is advanceable —
   soft blocks say why and offer "finish later"; exactly two hard blocks:
   legal consent (step 2) and identity for payment (enforced at charge time
   by Stripe, never here); progress persists server-side in
   provider_settings['onboarding'] so closing the tab loses nothing; every
   error says what went wrong and what to do next. */
(function () {
  "use strict";
  const HARD_BLOCKS = ["legal_consent", "payment_identity"];   // the only two; payment_identity lives at checkout, not in this flow
  const CONSENT_VERSION = "2026-09-16";
  const PACK = {
    private: { cal: "Continuous", group: "Client", groups: "Clients", sess: "Session", member: "Athlete", bill: "Per session", org: false },
    team:    { cal: "Seasonal", group: "Team", groups: "Teams", sess: "Practice", member: "Player", bill: "Installments", org: true },
    camp:    { cal: "Date block", group: "Camp", groups: "Camps", sess: "Day", member: "Camper", bill: "One charge", org: true },
    blank:   { cal: "You choose", group: "Group", groups: "Groups", sess: "Session", member: "Member", bill: "You choose", org: true } };
  const SPORT_NOUN = { Swimming: { sess: "Swim" }, Tennis: { sess: "Lesson" }, Track: { sess: "Workout" } };
  const SPORTS = ["Basketball", "Soccer", "Baseball", "Softball", "Volleyball", "Football", "Lacrosse", "Hockey", "Swimming", "Tennis", "Track", "Wrestling", "Gymnastics"];
  const ORDER = ["1", "2", "3", "4", "5", "6", "7"];
  const LBL = { "1": "01 / 06", "1b": "01 / 06", "2": "02 / 06", "3": "03 / 06", "4": "04 / 06", "5": "05 / 06", "6": "06 / 06", "7": "COMPLETE" };
  const PCT = { "1": 6, "1b": 10, "2": 22, "3": 38, "4": 56, "5": 72, "6": 90, "7": 100 };
  /* B16 (audit 2026-09-15): every soft block offers a way past it. Step 2's
     soft block (no type picked) had no control — SKIP started at 3 — so a
     consenting user who had not picked a type was stuck. Step 2's skip
     starts blank (advance() sets type "blank"). */
  const SKIP = { "2": "Finish later — start blank", "3": "Finish later", "4": "Skip for now", "5": "Skip for now" };
  /* B18: the baseline trigger named live orgs 'My Academy'; the current one
     names them 'Your organization'. Both are placeholders, not names. */
  const PLACEHOLDER_ORG = ["Your organization", "My Academy"];
  const isPlaceholderOrg = (n) => !n || PLACEHOLDER_ORG.includes(String(n).trim());
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  /* Generation counter for the resend "Sent again" flash: the fade-out must
     not clobber a newer resend's flash. */
  let resentSeq = 0;
  const API = () => window.SporveAPI, AUTH = () => window.SporveAuth;
  const signedIn = () => !!(AUTH() && AUTH().isSignedIn && AUTH().isSignedIn());
  /* S is the host's top-level `const` — a global lexical binding, NOT a window
     property. The old `window.S && …` guard was always false, so every step
     saved nothing (no consent row, no name, no org, no progress, no
     onboarding_completed) and a returning org could never resume. */
  const pv = () => (typeof S !== "undefined" && S && S.coachProvider) || null;

  function ob() {
    if (!S.ob) S.ob = { step: "1", email: "", sent: false, code: false, type: null, name: "", org: "", sport: null, area: "",
      tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago"), web: "", consent: false, busy: false, err: null,
      loaded: false, providers: null, t0: null, conn: {}, roster: null, loading: false };
    return S.ob;
  }
  const fmt = (ms) => { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };

  /* ── persistence: provider_settings['onboarding'] is the resume point ── */
  function settingsWrite(key, value) {
    const p = pv(); if (!p || !API()) return Promise.resolve();
    return API().from("provider_settings", "", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
      body: { provider_id: p.id, key, value } });
  }
  function snapshot() {
    const o = ob();
    return { v: 2, step: o.step, type: o.type, sport: o.sport, area: o.area, tz: o.tz, web: o.web, consent_at: o.consentAt || null,
      consent_version: o.consentAt ? CONSENT_VERSION : null, t0: o.t0 };
  }
  function persist() { return settingsWrite("onboarding", snapshot()).catch(() => {}); }
  function resume() {
    const o = ob(), p = pv();
    if (o.loaded || o.loading || !p || !API()) return;
    o.loading = true;
    Promise.all([
      API().from("provider_settings", "select=key,value&provider_id=eq." + p.id + "&key=in.(onboarding,legal_consent)").catch(() => []),
      API().from("team_athletes", "select=id&provider_id=eq." + p.id + "&limit=200").catch(() => []),
      API().from("org_connectors", "select=kind,status&provider_id=eq." + p.id).catch(() => []),
    ]).then(([rows, roster, conns]) => {
      const st = (rows || []).find((r) => r.key === "onboarding"); const v = st && st.value || {};
      if (v.type) o.type = v.type; if (v.sport) o.sport = v.sport; if (v.area) o.area = v.area; if (v.tz) o.tz = v.tz; if (v.web) o.web = v.web;
      if (v.consent_at) { o.consent = true; o.consentAt = v.consent_at; }
      if (v.t0) o.t0 = v.t0;
      o.org = isPlaceholderOrg(p.business_name) ? "" : p.business_name;
      const u = S.auth && S.auth.user; o.name = u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : "";
      o.roster = (roster || []).length;
      (conns || []).forEach((c) => { if (c.status === "connected" || c.status === "active") o.conn[c.kind] = true; });
      const step = v.step && ORDER.includes(v.step) && v.step !== "1" ? v.step : "2";
      o.step = p.onboarding_completed ? "7" : step;
      o.loaded = true; o.loading = false; render();
    }).catch(() => { o.loaded = true; o.loading = false; render(); });
  }

  /* ── which sign-in providers the project actually offers ── */
  function loadProviders() {
    const o = ob(); if (o.providers || o.providersLoading || !API()) return;
    o.providersLoading = true;
    fetch(API().url + "/auth/v1/settings", { headers: { apikey: API().anonKey } })
      .then((r) => r.json()).then((d) => { o.providers = { google: !!(d.external && d.external.google), apple: !!(d.external && d.external.apple) }; })
      .catch(() => { o.providers = { google: false, apple: false }; })
      .then(() => { o.providersLoading = false; render(); });
  }

  /* ── validation: soft everywhere except the two hard blocks ── */
  function why(step) {
    const o = ob();
    if (step === "2" && !o.consent) return { hard: true, msg: "Agree to the Terms and Privacy policy to continue. This is the one thing we cannot skip." };
    if (step === "2" && !o.type) return { hard: false, msg: "Pick what you run so the calendar and billing are set up right — or finish later and start blank." };
    if (step === "3") { const p = PACK[o.type || "blank"]; const miss = [];
      if (o.name.trim().length < 2) miss.push("your name"); if (p.org && (o.org.trim().length < 2 || isPlaceholderOrg(o.org))) miss.push("the organization name"); if (!o.sport) miss.push("a sport");
      if (miss.length) return { hard: false, msg: "Still needed: " + miss.join(", ") + ". You can finish this later from Settings." }; }
    return null;
  }
  const canContinue = (step) => { const w = why(step); return !w || (!w.hard && false) ? !w : false; };

  /* ── markup ── */
  /* Auth-trap fix (2026-09-19): the step-1 logo is a real home control — a guest
     can always leave the signup flow. Button keeps the .logo class so the
     existing styles apply; the inline reset only removes native button chrome. */
  const logo = () => `<button type="button" class="logo" data-obexit="1" aria-label="Back to Sporv home" title="Back to Sporv home" style="background:none;border:0;cursor:pointer;padding:0;font:inherit"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" fill="none" stroke="#7E8BA2" stroke-width="10"/><path d="M38 78 L60 34 L82 78 Z" fill="#7E8BA2"/></svg><span>Sporv</span></button>`;
  const G = '<svg viewBox="0 0 24 24" class="gi"><path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h6a5.1 5.1 0 0 1-2.2 3.4v2.8h3.6c2.1-1.9 3.2-4.8 3.2-8.2z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.3 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.6H2.1v2.9A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14a6.6 6.6 0 0 1 0-4.2V6.9H2.1a11 11 0 0 0 0 9.9L5.8 14z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 6.9L5.8 9.8c.9-2.7 3.3-4.4 6.2-4.4z"/></svg>';
  const A = '<svg viewBox="0 0 24 24" class="gi" fill="#000"><path d="M16.4 12.6c0-2.4 2-3.5 2-3.6-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.8-3-.8-1.6 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.7 0 0-2.5-1-2.5-3.6zM14.1 5.5c.6-.8 1.1-1.9.9-3-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.8-1.3z"/></svg>';

  function step1() {
    const o = ob(), pr = o.providers;
    return `<section class="step on" data-s="1">${logo()}
      <div class="f"><label class="l" for="obEm">Email</label><input type="email" id="obEm" placeholder="you@yourclub.org" autocomplete="email" inputmode="email" value="${esc(o.email)}"></div>
      ${o.err ? `<p class="oberr" role="alert">${esc(o.err)}</p>` : ""}
      <button class="btn pri full big" id="obSend" ${EMAIL_RX.test(o.email) && !o.busy ? "" : "disabled"}>${o.busy ? "Sending…" : "Continue"}</button>
      ${pr && (pr.google || pr.apple) ? `<div class="or">or</div>` : ""}
      ${pr && pr.google ? `<button class="btn google full big" data-oboauth="google">${G}Sign up with Google</button>` : ""}
      ${pr && pr.apple ? `<button class="btn google full big" data-oboauth="apple">${A}Sign up with Apple</button>` : ""}
      <p class="fine" style="margin-top:20px">By continuing you agree to the <a href="#" data-obfoot="info:terms">Terms</a> and <a href="#" data-obfoot="info:privacy">Privacy policy</a>.</p>
      <p class="fine">Already have an account? <a href="#" data-oblogin="1">Log in</a> · <a href="#" data-obpw="1">Use a password instead</a></p>
    </section>`;
  }
  function step1b() {
    const o = ob();
    return `<section class="step on" data-s="1b">
      <h1 style="text-align:center">Check your inbox</h1>
      <p class="sub" style="text-align:center;margin:0 auto 16px"><span class="mono" style="color:var(--steel-l)">${esc(o.email)}</span></p>
      <p class="sub" style="text-align:center;margin:0 auto 18px;max-width:40ch">The link works for 15 minutes and signs you in on this device. No password to set.</p>
      ${o.err ? `<p class="oberr" role="alert">${esc(o.err)}</p>` : ""}
      ${o.code ? `<form id="obCode" class="f" style="max-width:280px;margin:0 auto 16px"><label class="l" for="obTok">6-digit code from the email</label><input type="text" id="obTok" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" value="${esc(o.tok || "")}"><button class="btn pri full" style="margin-top:8px" type="submit">Sign in</button></form>` : ""}
      <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap"><button class="btn ghost" data-obresend="1">${o.resent ? "Sent again" : "Resend link"}</button><button class="btn ghost" data-obwrong="1">Use a different email</button>${o.code ? "" : `<button class="btn ghost" data-obcode="1">Enter the code instead</button>`}</div>
    </section>`;
  }
  function step2() {
    const o = ob();
    return `<section class="step on" data-s="2"><h1>What are you running?</h1>
      <p class="sub">Sets what things are called, how the calendar works, and how families pay. All of it can change later.</p>
      <div class="opts" id="obOpts">${[["private", "Private training", "One-on-one or small group sessions, billed as they happen.", "PER SESSION"], ["team", "Team or club", "Rosters, a season with a start and end, dues in installments.", "INSTALLMENTS"], ["camp", "Camp", "A block of days with a roster cap and one charge at registration.", "ONE CHARGE"], ["blank", "Start blank", "Set the calendar, nouns, and billing yourself.", "MANUAL"]]
        .map(([t, b, s, k]) => `<button class="opt ${o.type === t ? "on" : ""}" data-obtype="${t}"><span><b>${b}</b><small>${s}</small></span><span class="k">${k}</span></button>`).join("")}</div>
      <p class="hint">Run more than one? Pick the one most families use. Add the others from Settings.</p>
      <label class="consent ${o.consent ? "on" : ""}"><input type="checkbox" id="obConsent" ${o.consent ? "checked" : ""}> <span>I agree to the <a href="#" data-obfoot="info:terms">Terms</a> and the <a href="#" data-obfoot="info:privacy">Privacy policy</a>, including how families' data is handled.</span></label>
    </section>`;
  }
  function step3() {
    const o = ob(), p = PACK[o.type || "blank"], sn = (o.sport && SPORT_NOUN[o.sport]) || {};
    const h = { private: "Tell us who you are", team: "Tell us about the club", camp: "Tell us about the camp", blank: "Tell us who you are" }[o.type || "blank"];
    return `<section class="step on" data-s="3"><h1>${h}</h1>
      <p class="sub">These pick your sport pack, calendar shape, and the words families see.</p>
      <div class="row2"><div class="f"><label class="l" for="obNm">Your name</label><input type="text" id="obNm" placeholder="Marcus Reed" autocomplete="name" value="${esc(o.name)}"></div>
        <div class="f" ${p.org ? "" : "hidden"}><label class="l" for="obOg">Organization</label><input type="text" id="obOg" placeholder="Northside Flight" value="${esc(o.org)}"></div></div>
      <div class="f"><label class="l">Sport</label><div class="chips" id="obSports">${SPORTS.map((s) => `<button class="chip ${o.sport === s ? "on" : ""}" data-obsport="${s}">${s}</button>`).join("")}${o.sport && !SPORTS.includes(o.sport) ? `<button class="chip on" data-obsport="${esc(o.sport)}">${esc(o.sport)}</button>` : ""}<input type="text" class="chip more" id="obSportOther" placeholder="Other…" size="8"></div></div>
      <div class="row2"><div class="f"><label class="l" for="obAr">Area</label><input type="text" id="obAr" placeholder="City or ZIP" autocomplete="postal-code" value="${esc(o.area)}"></div>
        <div class="f"><label class="l" for="obTz">Timezone</label><select id="obTz">${["America/Chicago", "America/New_York", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu"].concat(["America/Chicago", "America/New_York", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu"].includes(o.tz) ? [] : [o.tz]).map((z) => `<option ${o.tz === z ? "selected" : ""}>${esc(z)}</option>`).join("")}</select></div></div>
      <div class="f"><label class="l" for="obWeb">Website <span style="color:var(--ink-3);font-weight:400">· optional</span></label><input type="url" id="obWeb" placeholder="northsideflight.org" inputmode="url" value="${esc(o.web)}"><div class="hint">${p.org ? "We read your teams, fees, and dates from it while you keep going. Nothing on your site changes." : "We read your services and rates from it while you keep going."}</div></div>
      <div class="derived"><div class="h"><i></i>What these answers set</div>
        <div class="r"><span>Sport pack</span><span>${esc(o.sport || "—")}</span></div><div class="r"><span>Calendar</span><span>${p.cal}</span></div>
        <div class="r"><span>A group is a</span><span>${p.group}</span></div><div class="r"><span>A session is a</span><span>${sn.sess || p.sess}</span></div>
        <div class="r"><span>Families pay</span><span>${p.bill}</span></div><div class="r"><span>Send window</span><span>8:00–20:00 ${esc(o.tz.split("/")[1] || o.tz).replace(/_/g, " ")}</span></div></div>
      ${o.err ? `<p class="oberr" role="alert">${esc(o.err)}</p>` : ""}
    </section>`;
  }
  function step4() {
    const o = ob();
    const tile = (kind, ic, b, s, attr) => `<button class="cn ${o.conn[kind] ? "on" : ""} ${S.cxBusy === kind ? "busy" : ""}" ${attr}><span class="ic">${ic}</span><span class="b"><b>${b}</b><small>${s}</small></span><span class="st">${o.conn[kind] ? "Connected" : S.cxBusy === kind ? "Signing in…" : "Connect"}</span></button>`;
    return `<section class="step on" data-s="4"><h1>Connect what you already use</h1>
      <p class="sub">Read-only where it can be. Nothing is sent from any of these — Sporv drafts, you approve. Skip anything; add it later from Settings.</p>
      <div class="conn">
        ${tile("gmail", "GM", "Gmail", "Inbound parent email, tournament PDFs, league notices. Read-only scope — it cannot send.", 'data-cxconnect="gmail"')}
        ${tile("google_calendar", "GC", "Google Calendar", "Practices, games, conflicts. Changes you approve are written back.", 'data-cxconnect="google_calendar"')}
        ${tile("microsoft365", "M365", "Outlook / Microsoft 365", "Email and calendar for clubs on Microsoft. Read-only email; calendar changes you approve are written back.", 'data-cxconnect="microsoft365"')}
        ${tile("google_sheets", "SH", "Google Sheets", "The spreadsheet your club actually runs on. Read-only.", 'data-cxconnect="google_sheets"')}
        ${tile("google_drive", "DR", "Google Drive", "Waivers, forms and PDFs you already store. Read-only.", 'data-cxconnect="google_drive"')}
        <button class="cn" data-obgo="5"><span class="ic">CSV</span><span class="b"><b>A roster export or CSV</b><small>SportsEngine, TeamSnap, LeagueApps, Spond, or a plain sheet. Next step.</small></span><span class="st">Upload</span></button>
      </div>
      <p class="note"><b>Stripe</b> is connected from Money once you are in — identity checks for payouts take days, so start it early, but it never blocks setup.</p>
      ${S.connectError ? `<p class="oberr" role="alert">${esc(S.connectError)}</p>` : ""}
    </section>`;
  }
  function step5() {
    const o = ob(), p = PACK[o.type || "blank"];
    return `<section class="step on" data-s="5"><h1>Your roster</h1>
      <p class="sub">${o.roster ? `${o.roster} ${p.member.toLowerCase()}${o.roster === 1 ? "" : "s"} on file.` : `No ${p.groups.toLowerCase()} yet.`} Upload an export and see exactly what will be created before anything is written — nothing is dropped, nothing merged silently, and a re-upload creates no duplicates.</p>
      <div class="drop"><b>Drop a CSV or an export file</b>From SportsEngine, TeamSnap, LeagueApps, Spond or a plain sheet. Import sends zero emails.<div style="margin-top:14px"><button class="btn pri" data-import="1">Choose a file</button></div></div>
      <p class="hint">Rows Sporv cannot read are held for review, counted, and shown to you — never discarded.</p>
    </section>`;
  }
  function step6() {
    const o = ob(), ar = S.agentRun;
    return `<section class="step on" data-s="6"><h1>First run</h1>
      <p class="sub">Sporv reads what you connected and drafts what it finds — dues to chase, waivers to request, conflicts to flag. Under a minute. Nothing is sent; everything waits for you.</p>
      ${ar && ar.done ? `<div class="card"><div class="row"><span class="lab"><b>Done.</b><small>${ar.total} item${ar.total === 1 ? "" : "s"} in your queue — all drafts, none sent.</small></span><span class="pill ok">Ready</span></div></div>`
        : `<button class="btn pri full big" data-obrun="1" ${o.busy ? "disabled" : ""}>${ar ? "Running…" : "Run Sporv"}</button>`}
      ${o.err ? `<p class="oberr" role="alert">${esc(o.err)}</p>` : ""}
    </section>`;
  }
  function step7() {
    const o = ob(), ar = S.agentRun || {}, p = PACK[o.type || "blank"];
    return `<section class="step on" data-s="7"><h1>You're set up</h1>
      <p class="sub">${o.t0 ? "Set up in " + fmt(Date.now() - o.t0) + ". " : ""}${ar.total ? ar.total + " draft" + (ar.total === 1 ? "" : "s") + " waiting. " : ""}Approve what's right, edit what isn't, skip the rest. ${p.groups} and families can be added any time.</p>
    </section>`;
  }

  function html() {
    const o = ob(); if (signedIn() && !o.loaded) resume(); if (!signedIn() && !o.providers) loadProviders();
    if (!signedIn() && o.step !== "1" && o.step !== "1b") o.step = "1";
    const s = o.step, full = s !== "1";
    /* The step-4 tiles use the same server-gated [data-cxconnect] flow as
       every other surface: a tile only offers Connect when the server handed
       it a working connect_url. Warm the cache here so the tiles are live
       when the step renders; loadConnectors() no-ops once loaded/loading. */
    if (s === "4" && typeof loadConnectors === "function") loadConnectors();
    const body = { "1": step1, "1b": step1b, "2": step2, "3": step3, "4": step4, "5": step5, "6": step6, "7": step7 }[s]();
    const w = why(s), next = s === "5" ? "Run Sporv" : s === "7" ? "Open dashboard" : "Continue";
    const showNext = !(s === "1" || s === "1b" || (s === "6" && !(S.agentRun && S.agentRun.done)));
    return `<div class="ob ${full ? "full" : ""}"><div class="left">
      <div class="top"><span class="brand">Sporv</span><span class="stp">${LBL[s]}</span><span class="clock mono">${o.t0 && full ? fmt(Date.now() - o.t0) : ""}</span>${signedIn() ? `<button class="btn ghost obout" data-obsignout="1">Sign out</button>` : `<button class="btn ghost obout" data-obexit="1" aria-label="Back to Sporv home" title="Back to Sporv home">← Back</button>`}</div>
      <div class="prog"><i style="width:${PCT[s]}%"></i></div>
      <div class="body ${s === "1" || s === "1b" ? "center" : ""}"><div class="pad">${body}</div></div>
      <div class="foot">
        <button class="btn ghost" data-obback="1" style="visibility:${(s === "1" || s === "1b" || s === "2" || s === "6" || s === "7") ? "hidden" : "visible"}">Back</button>
        ${showNext ? `<button class="btn pri" id="obNext" data-obnext="1" ${w ? "disabled" : ""} ${w ? `title="${esc(w.msg)}"` : ""}>${next}</button>` : ""}
        ${SKIP[s] && (w ? !w.hard : (s === "4" || s === "5")) ? `<button class="btn ghost skip" data-obskip="1" style="display:inline-flex">${SKIP[s]}</button>` : ""}
      </div>
      ${w && showNext ? `<p class="obwhy ${w.hard ? "hard" : ""}">${esc(w.msg)}</p>` : ""}
    </div>
    <aside class="right" aria-hidden="true"><div class="ph"><svg viewBox="0 0 120 120" style="width:34%;height:auto;opacity:.9" aria-hidden="true"><circle cx="60" cy="60" r="52" fill="none" stroke="#7E8BA2" stroke-width="10"/><path d="M38 78 L60 34 L82 78 Z" fill="#7E8BA2"/></svg><div class="lab"><b>Welcome to Sporv</b></div></div><div class="cap"><span>Sporv</span><span>Account</span></div></aside>
    </div>`;
  }

  /* ── actions ── */
  function fail(msg) { const o = ob(); o.busy = false; o.err = msg; render(); }
  function sendLink() {
    const o = ob(); if (!EMAIL_RX.test(o.email)) return fail("That email address is not valid. Check it and try again.");
    if (!AUTH() || !AUTH().magicLink) return fail("Sign-in is unavailable right now. Reload the page; if it persists, write to security@sporv.ai.");
    o.busy = true; o.err = null; render();
    try { sessionStorage.setItem("sporv:oauth-intent", "signup"); } catch (e) { /* private mode: the return still works */ }
    AUTH().magicLink(o.email, window.location.origin + "/", { role: "provider" })
      .then(() => { o.busy = false; o.sent = true; o.step = "1b"; render(); })
      .catch((e) => fail("The link could not be sent" + (e && e.message ? " — " + e.message : "") + ". Try again in a moment, or use a different email."));
  }
  function verifyCode(tok) {
    const o = ob(); if (!/^\d{6}$/.test(tok)) return fail("The code is six digits. Copy it from the email.");
    o.busy = true; o.err = null; render();
    AUTH().verifyMagicCode(o.email, tok).then(() => AUTH().loadProfile()).then((p) => {
      o.busy = false; if (typeof completeAuth === "function") completeAuth({ id: p && p.id, firstName: (p && p.first_name) || "", lastName: (p && p.last_name) || "", email: (p && p.email) || o.email, phone: "", role: (p && p.role) || "provider", preferredSports: [], img: typeof phAvatar === "function" ? phAvatar() : "" });
    }).catch(() => fail("That code was not accepted. It may have expired (15 minutes) — send a new link."));
  }
  function saveStep(step) {
    const o = ob(), p = pv();
    if (!p) return Promise.resolve();
    const jobs = [];
    if (step === "2" && o.consent && !o.consentAt) { o.consentAt = new Date().toISOString(); jobs.push(settingsWrite("legal_consent", { version: CONSENT_VERSION, at: o.consentAt })); }
    if (step === "3") {
      const nm = o.name.trim().split(/\s+/); const first = nm[0] || null, last = nm.slice(1).join(" ") || null;
      if (first && AUTH() && AUTH().userId) jobs.push(API().from("profiles", "id=eq." + AUTH().userId() + "&select=id", { method: "PATCH", headers: { Prefer: "return=representation" }, body: { first_name: first, last_name: last } }));
      const patch = {}; if (o.org.trim() && !isPlaceholderOrg(o.org)) patch.business_name = o.org.trim(); else if (!PACK[o.type || "blank"].org && first) patch.business_name = o.name.trim();
      /* AUDIT 2026-09-17 P1-7: enforce_org_member() refuses staff on any
         provider whose provider_type is not 'organization', and setup never
         wrote it — so a club that finished setup could never add a coach.
         The pack decides: team/camp/blank are organizations, private is solo. */
      patch.provider_type = PACK[o.type || "blank"].org ? "organization" : "solo";
      if (o.sport) patch.sports = [o.sport]; if (o.area.trim()) patch.location = o.area.trim();
      if (Object.keys(patch).length && window.SporveCoach && window.SporveCoach.save) jobs.push(window.SporveCoach.save(patch).then((row) => { if (row) S.coachProvider = Object.assign({}, S.coachProvider, row); }));
    }
    jobs.push(persist());
    return Promise.all(jobs);
  }
  function advance(skip) {
    const o = ob(), s = o.step, i = ORDER.indexOf(s); if (i < 0) return;
    const w = why(s); if (w && w.hard) return fail(w.msg);
    if (w && !skip) return fail(w.msg);
    if (s === "2" && skip && !o.type) o.type = "blank";
    if (!o.t0) o.t0 = Date.now();
    if (s === "7") return finish();
    o.busy = true; o.err = null; render();
    saveStep(s).then(() => { o.busy = false; o.step = ORDER[i + 1]; if (o.step === "6" && S.agentRun && S.agentRun.done) {} persist(); render(); })
      .catch((e) => fail("Saved on this device, but not to Sporv" + (e && e.message ? " — " + e.message : "") + ". Check your connection and press Continue again; nothing you typed is lost."));
  }
  function finish() {
    const o = ob(), p = pv(); o.busy = true; render();
    /* PostHog (2026-09-23): the single point where the app knows the 6-step
       onboarding actually completed — after the DB PATCH confirms. The
       no-provider fallback below fires no event. */
    const phDone = () => { try { if (typeof window !== "undefined" && typeof window.__phCapture === "function") window.__phCapture("onboarding_completed"); } catch (e) {} };
    const done = () => { o.busy = false; if (p) p.onboarding_completed = true; S.coachTab = "queue"; S.portal = "coach"; if (typeof go === "function") go("dashboard"); };
    if (!p || !API()) return done();
    API().from("providers", "id=eq." + p.id + "&select=id,onboarding_completed", { method: "PATCH", headers: { Prefer: "return=representation" }, body: { onboarding_completed: true } })
      .then(() => settingsWrite("onboarding", Object.assign(snapshot(), { step: "done" })).catch(() => {})).then(() => { phDone(); done(); })
      .catch((e) => fail("Could not mark setup complete" + (e && e.message ? " — " + e.message : "") + ". Press Open dashboard again."));
  }

  function wire() {
    const root = document.querySelector(".ob"); if (!root) return;
    const o = ob(), q = (sel) => Array.from(root.querySelectorAll(sel)), id = (x) => document.getElementById(x);
    const em = id("obEm"); if (em) { em.oninput = () => { o.email = em.value.trim(); const b = id("obSend"); if (b) b.disabled = !EMAIL_RX.test(o.email) || o.busy; }; em.onkeydown = (e) => { if (e.key === "Enter" && EMAIL_RX.test(o.email)) sendLink(); }; if (o.step === "1" && !o.email) em.focus(); }
    const send = id("obSend"); if (send) send.onclick = sendLink;
    q("[data-oboauth]").forEach((b) => b.onclick = () => { if (!AUTH()) return fail("Sign-in is unavailable right now. Reload the page."); try { sessionStorage.setItem("sporv:oauth-intent", "signup"); if (typeof saveState === "function") saveState(); } catch (e) {} window.location.href = AUTH().oauthUrl(b.dataset.oboauth, window.location.origin + window.location.pathname); });
    /* Auth-trap fix (2026-09-19): "Log in" used to just focus the signup email
       field, which read as a dead link. It now opens the real "Log in or sign
       up" sheet, whose identifier flow routes an existing account to sign-in. */
    q("[data-oblogin]").forEach((a) => a.onclick = (e) => { e.preventDefault(); S.modal = { type: "authsheet" }; render(); });
    q("[data-obpw]").forEach((a) => a.onclick = (e) => { e.preventDefault(); S.authIdentifier = o.email; S.modal = { type: "login" }; render(); });
    q("[data-obfoot]").forEach((a) => a.onclick = (e) => { e.preventDefault(); const arg = a.dataset.obfoot.split(":")[1]; if(!arg) return; window.open(location.origin + "/?page=" + encodeURIComponent(arg), "_blank", "noopener"); });
    /* The "Sent again" flash fade-out must NOT re-render the form: render()
       rebuilds #obTok from state, so a re-render landing between an
       automation's focus and its text entry (or a fast typist's keystrokes)
       silently drops the typed code — the field keeps its previous value and
       the submit then fails as a wrong code. Only the button label changes
       here, so update it in place (flaky test 14, 2026-09-20). */
    q("[data-obresend]").forEach((b) => b.onclick = () => { o.resent = true; AUTH().magicLink(o.email, window.location.origin + "/", { role: "provider" }).catch(() => {}); render(); const my = ++resentSeq; setTimeout(() => { if (my !== resentSeq) return; o.resent = false; const rb = document.querySelector('[data-obresend]'); if (rb) rb.textContent = "Resend link"; }, 1800); });
    q("[data-obwrong]").forEach((b) => b.onclick = () => { o.step = "1"; o.sent = false; o.err = null; o.code = false; o.tok = ""; render(); });
    q("[data-obcode]").forEach((b) => b.onclick = () => { o.code = true; render(); });
    /* AUDIT 2026-09-17 (self-caught while fixing P1-1): the code field kept its
       value only in the DOM, so any render() — the "sent" flash fading 1.8s
       after Resend, a background load finishing — erased what was typed. Hold
       it in state like the email field. */
    const tk = id("obTok"); if (tk) tk.oninput = () => { o.tok = tk.value.trim(); };
    const cf = id("obCode"); if (cf) cf.onsubmit = (e) => { e.preventDefault(); verifyCode((id("obTok").value || "").trim()); };
    q("[data-obtype]").forEach((b) => b.onclick = () => { o.type = b.dataset.obtype; render(); });
    const cs = id("obConsent"); if (cs) cs.onchange = () => { o.consent = cs.checked; render(); };
    const bind = (elId, key) => { const el = id(elId); if (el) el.oninput = () => { o[key] = el.value; const n = id("obNext"); if (n) { const w = why(o.step); n.disabled = !!w; n.title = w ? w.msg : ""; } const wh = root.querySelector(".obwhy"); if (wh) wh.hidden = !why(o.step); }; };
    bind("obNm", "name"); bind("obOg", "org"); bind("obAr", "area"); bind("obWeb", "web");
    const tz = id("obTz"); if (tz) tz.onchange = () => { o.tz = tz.value; render(); };
    q("[data-obsport]").forEach((c) => c.onclick = () => { o.sport = c.dataset.obsport; render(); });
    const so = id("obSportOther"); if (so) so.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); const v = so.value.trim(); if (v) { o.sport = v; render(); } } };
    q("[data-obgo]").forEach((b) => b.onclick = () => { o.step = b.dataset.obgo; persist(); render(); });
    q("[data-obrun]").forEach((b) => b.onclick = () => { if (typeof startAgentRunScreen !== "function" || !startAgentRunScreen()) fail("The first run needs a saved organization and a session. Go back one step and press Continue, then try again."); });
    q("[data-obnext]").forEach((b) => b.onclick = () => advance(false));
    q("[data-obskip]").forEach((b) => b.onclick = () => advance(true));
    q("[data-obback]").forEach((b) => b.onclick = () => { const i = ORDER.indexOf(o.step); if (i > 0) { o.step = ORDER[i - 1]; o.err = null; persist(); render(); } });
    q("[data-obsignout]").forEach((b) => b.onclick = () => { S.ob = null; if (typeof doSignOut === "function") doSignOut(); else if (AUTH()) AUTH().signOut().then(() => location.reload()); });
    /* Auth-trap fix (2026-09-19): guest exit for the full-page signup flow.
       Clears the parked signup intent via the shared host exit; the signed-in
       guard keeps the intentional onboarding gate for real coaches. */
    q("[data-obexit]").forEach((b) => b.onclick = () => { if (typeof signedIn === "function" && signedIn()) return; if (typeof window.exitFullPageAuth === "function") window.exitFullPageAuth(); });
  }

  const CSS = `
  .ob{position:fixed;inset:0;z-index:60;height:100dvh;display:grid;grid-template-columns:1fr 1fr;background:#0B0D0F;color:#EDEFF2;font-family:Archivo,system-ui,sans-serif;font-size:14px;line-height:1.5;letter-spacing:-.003em;-webkit-font-smoothing:antialiased;transition:grid-template-columns .45s cubic-bezier(.2,.7,.2,1);
    --bg:#0B0D0F;--panel:#121417;--panel-2:#171A1E;--raise:#1C1F24;--line:#202429;--line-2:#2A3037;--line-3:#39424D;--ink:#EDEFF2;--ink-2:#9BA3AD;--ink-3:#8C95A3;--steel:#6B7F9E;--steel-l:#9DB0CB;--steel-bg:rgba(107,127,158,.12);--steel-br:rgba(107,127,158,.34);--ok:#6FA982;--ok-bg:rgba(111,169,130,.12);--ok-br:rgba(111,169,130,.28);--attn:#8EC5E8;--gutter:clamp(24px,6vw,96px);--col:600px;--col-wide:680px;--s-1:4px;--s-2:8px;--s-3:12px;--s-4:16px;--s-5:24px;--s-6:32px;--s-7:48px;--t-10:10.5px;--t-11:11.5px;--t-12:12.5px;--t-13:13.5px;--t-14:14px}
  .ob *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}.ob button,.ob input,.ob select{font:inherit;color:inherit;background:none;border:0}.ob button{cursor:pointer}.ob :focus-visible{outline:2px solid var(--steel);outline-offset:2px}
  .ob.full{grid-template-columns:1fr 0fr}.ob.full .right{opacity:0;pointer-events:none}
  .ob .left{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%}
  .ob .top{flex:none;height:calc(env(safe-area-inset-top) + 64px);padding-top:env(safe-area-inset-top);display:flex;align-items:center;gap:var(--s-5);padding-left:var(--gutter);padding-right:var(--gutter)}
  .ob .brand{font-family:"Archivo",sans-serif;font-weight:700;font-size:17px;letter-spacing:.04em;text-transform:uppercase}
  .ob .stp,.ob .clock{font-family:"JetBrains Mono",monospace;font-size:var(--t-11);color:var(--ink-3);letter-spacing:.08em}.ob .clock{margin-left:auto}.ob .obout{margin-left:8px}
  .ob .prog{flex:none;height:1px;background:var(--line);margin:0 var(--gutter)}.ob .prog i{display:block;height:100%;background:var(--steel);transition:width .5s cubic-bezier(.2,.7,.2,1)}
  .ob .body{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;display:flex;align-items:flex-start}.ob .body.center{align-items:center}
  .ob .pad{padding:var(--s-6) var(--gutter);max-width:var(--col);width:100%;margin:0 auto}.ob.full .pad,.ob.full .foot{max-width:var(--col-wide)}
  .ob .foot{flex:none;padding:var(--s-4) var(--gutter) calc(env(safe-area-inset-bottom) + var(--s-4));display:flex;gap:var(--s-3);align-items:center;max-width:var(--col);margin:0 auto;width:100%;border-top:1px solid var(--line)}
  .ob .foot #obNext{flex:1;height:46px;font-size:var(--t-13)}.ob .foot .skip{flex:none;font-size:var(--t-12);color:var(--ink-3)}
  .ob .right{position:relative;background:var(--panel);border-left:1px solid var(--line);display:grid;place-items:center;overflow:hidden;padding:var(--s-7);transition:opacity .3s}
  .ob .ph{position:relative;width:min(560px,86%);aspect-ratio:4/5;border:1px dashed var(--line-3);border-radius:18px;display:grid;place-items:center;background:rgba(11,13,15,.45)}
  .ob .ph .lab{position:absolute;bottom:22px;left:0;right:0;font-family:"JetBrains Mono",monospace;font-size:var(--t-10);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);text-align:center;line-height:2}.ob .ph .lab b{display:block;font-family:Inter,sans-serif;text-transform:none;font-weight:600;font-size:var(--t-14);letter-spacing:0;color:var(--ink-2)}
  .ob .cap{position:absolute;left:var(--s-7);bottom:var(--s-6);right:var(--s-7);display:flex;justify-content:space-between;font-family:"JetBrains Mono",monospace;font-size:var(--t-10);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
  @media(max-width:900px){.ob{grid-template-columns:1fr}.ob .right{display:none}.ob .body{align-items:flex-start}}
  .ob h1{font-family:"Archivo",sans-serif;text-transform:uppercase;font-weight:700;font-size:17px;letter-spacing:.035em;margin:0 0 var(--s-2);line-height:1.15;color:var(--ink)}
  .ob .sub{color:var(--ink-2);font-size:14px;margin:0 0 var(--s-5);max-width:56ch}
  .ob label.l{display:block;font-family:"Archivo",sans-serif;text-transform:uppercase;font-weight:700;font-size:var(--t-11);letter-spacing:.08em;color:var(--ink-3);margin:0 0 var(--s-2)}
  .ob .hint{color:var(--ink-3);font-size:var(--t-12);margin-top:var(--s-2);line-height:1.45}.ob .f{margin-bottom:var(--s-5)}.ob .row2{display:grid;grid-template-columns:1fr 1fr;gap:var(--s-4)}
  .ob input[type=text],.ob input[type=email],.ob input[type=url],.ob select{width:100%;height:38px;padding:0 var(--s-3);background:var(--bg);border:1px solid var(--line-2);border-radius:7px;font-size:var(--t-14);color:var(--ink)}
  @media(hover:none){.ob input[type=text],.ob input[type=email],.ob input[type=url],.ob select{font-size:16px}}
  .ob input:focus,.ob select:focus{border-color:var(--steel);outline:0}.ob input::placeholder{color:var(--ink-3)}
  .ob .btn{height:34px;padding:0 14px;border:1px solid var(--line-2);border-radius:7px;font-family:"Archivo",sans-serif;text-transform:uppercase;letter-spacing:.07em;font-weight:700;font-size:var(--t-12);display:inline-flex;align-items:center;justify-content:center;gap:8px;color:var(--ink);transition:transform .12s,background .15s}
  .ob .btn:hover{background:var(--panel-2)}.ob .btn:active{transform:scale(.985)}.ob .btn.pri{background:var(--steel);color:#fff;border-color:var(--steel)}.ob .btn.pri:hover{background:#7A8FAE;border-color:#7A8FAE}.ob .btn.pri:disabled{opacity:.38;cursor:not-allowed;transform:none}
  .ob .btn.full{width:100%}.ob .btn.big{height:44px;font-size:var(--t-13)}
  .ob .btn.ghost{border-color:transparent;color:var(--ink-2);font-family:Inter,sans-serif;text-transform:none;letter-spacing:0;font-weight:500}.ob .btn.ghost:hover{color:var(--ink);background:var(--panel-2)}
  .ob .btn.google{background:#fff;color:#0B0D0F;border-color:#fff;position:relative;font-family:Inter,sans-serif;text-transform:none;letter-spacing:0;font-weight:600}.ob .btn.google:hover{background:#E6E9EE}.ob .btn.google+.btn.google{margin-top:8px}.ob .gi{width:16px;height:16px;position:absolute;left:14px}
  .ob .or{display:flex;align-items:center;gap:var(--s-3);color:var(--ink-3);font-size:var(--t-12);margin:var(--s-5) 0}.ob .or::before,.ob .or::after{content:'';flex:1;height:1px;background:var(--line)}
  .ob .logo{display:flex;align-items:center;justify-content:center;gap:var(--s-3);margin:0 0 var(--s-7)}.ob .logo svg{width:34px;height:34px}.ob .logo span{font-family:"Archivo",sans-serif;font-weight:700;font-size:22px;letter-spacing:.03em;text-transform:uppercase;color:#93A1B8}
  .ob .fine{font-size:var(--t-12);color:var(--ink-3);text-align:center;margin-top:var(--s-4)}.ob .fine a{color:var(--ink-2)}
  .ob .oberr{margin:0 0 var(--s-4);padding:var(--s-2) var(--s-3);border-left:2px solid #C98A8A;color:#E6B8B8;font-size:var(--t-12);line-height:1.5}
  .ob .obwhy{max-width:var(--col-wide);margin:0 auto;padding:0 var(--gutter) var(--s-3);font-size:var(--t-12);color:var(--ink-3)}.ob .obwhy.hard{color:var(--attn)}
  .ob .opts{display:flex;flex-direction:column;gap:var(--s-2)}.ob .opt{display:grid;grid-template-columns:1fr auto;gap:var(--s-4);align-items:center;padding:var(--s-3) var(--s-4);border:1px solid var(--line-2);border-radius:9px;background:var(--bg);text-align:left;transition:transform .12s,border-color .15s}
  .ob .opt:hover{border-color:var(--line-3)}.ob .opt.on{border-color:var(--steel);background:var(--steel-bg)}.ob .opt b{display:block;font-size:var(--t-13);font-weight:500}.ob .opt small{display:block;color:var(--ink-3);font-size:var(--t-12);margin-top:2px;line-height:1.45}
  .ob .opt .k{font-family:"JetBrains Mono",monospace;font-size:var(--t-10);letter-spacing:.08em;color:var(--ink-3);white-space:nowrap}.ob .opt.on .k{color:var(--steel-l)}
  .ob .consent{display:flex;gap:10px;align-items:flex-start;margin-top:var(--s-5);padding:var(--s-3) var(--s-4);border:1px solid var(--line-2);border-radius:9px;font-size:var(--t-12);color:var(--ink-2);cursor:pointer}.ob .consent.on{border-color:var(--steel)}.ob .consent input{width:16px;height:16px;margin-top:2px;accent-color:#6B7F9E}.ob .consent a{color:var(--ink)}
  .ob .chips{display:flex;flex-wrap:wrap;gap:var(--s-2)}.ob .chip{height:28px;padding:0 11px;border:1px solid var(--line-2);border-radius:999px;font-size:var(--t-12);color:var(--ink-2);display:inline-flex;align-items:center}.ob .chip:hover{border-color:var(--line-3);color:var(--ink)}.ob .chip.on{background:var(--ink);color:var(--bg);border-color:var(--ink);font-weight:500}.ob input.chip.more{border-style:dashed;color:var(--ink-3);width:auto;height:28px;background:transparent}
  .ob .derived{margin-top:var(--s-6);border:1px solid var(--line);border-radius:10px;overflow:hidden}.ob .derived .h{padding:8px 13px;border-bottom:1px solid var(--line);font-weight:600;font-size:var(--t-12);display:flex;align-items:center;gap:8px}.ob .derived .h i{width:6px;height:6px;border-radius:50%;background:var(--steel);display:inline-block}
  .ob .derived .r{display:flex;justify-content:space-between;gap:14px;padding:8px 13px;border-bottom:1px solid var(--line);font-size:14px}.ob .derived .r:last-child{border-bottom:0}.ob .derived .r span:first-child{color:var(--ink-3)}.ob .derived .r span:last-child{font-family:"JetBrains Mono",monospace;font-size:var(--t-12);text-align:right}
  .ob .conn{display:grid;grid-template-columns:1fr;gap:var(--s-2)}.ob .cn{display:flex;align-items:flex-start;gap:var(--s-3);padding:var(--s-3) var(--s-4);border:1px solid var(--line-2);border-radius:9px;background:var(--bg);text-align:left}.ob .cn:hover{border-color:var(--line-3)}.ob .cn.on{border-color:var(--ok-br);background:var(--ok-bg)}
  .ob .cn .ic{width:28px;height:28px;border-radius:7px;background:var(--panel-2);border:1px solid var(--line);display:grid;place-items:center;font-family:"JetBrains Mono",monospace;font-size:var(--t-10);color:var(--ink-2);flex:none}.ob .cn.on .ic{border-color:var(--ok-br);color:var(--ok)}.ob .cn b{display:block;font-size:var(--t-13);font-weight:500}.ob .cn .b{flex:1;min-width:0}.ob .cn small{display:block;font-size:var(--t-11);color:var(--ink-3);line-height:1.45;margin-top:2px}
  .ob .cn .st{margin-left:auto;font-size:var(--t-11);color:var(--ink-3);flex:none;padding-top:2px;white-space:nowrap}.ob .cn.on .st{color:var(--ok)}.ob .cn.busy .st{color:var(--steel-l)}
  .ob .note{border-left:1px solid var(--steel);padding:var(--s-2) var(--s-4);color:var(--ink-2);font-size:var(--t-12);margin-top:var(--s-5);line-height:1.55}.ob .note b{color:var(--ink);font-weight:600}
  .ob .card{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}.ob .row{display:flex;align-items:center;gap:var(--s-4);padding:var(--s-3) var(--s-4)}.ob .row .lab{flex:1;min-width:0}.ob .row .lab b{display:block;font-size:var(--t-13);font-weight:500}.ob .row .lab small{display:block;font-size:var(--t-12);color:var(--ink-3);margin-top:1px}
  .ob .pill{font-size:var(--t-11);font-weight:500;padding:2px 8px;border-radius:999px;border:1px solid var(--line-2);color:var(--ink-3);white-space:nowrap}.ob .pill.ok{color:var(--ok);background:var(--ok-bg);border-color:var(--ok-br)}
  .ob .drop{border:1px dashed var(--line-3);border-radius:9px;padding:var(--s-6);text-align:center;color:var(--ink-3);font-size:var(--t-12)}.ob .drop b{display:block;color:var(--ink-2);font-weight:500;font-size:var(--t-13);margin-bottom:3px}
  @media(max-width:520px){.ob .row2{grid-template-columns:1fr}.ob .foot{flex-wrap:wrap}}`;

  window.MOD_ONBOARD = { css: CSS, html, wire, route: "setup", HARD_BLOCKS, CONSENT_VERSION, ORDER, SKIP, why, isPlaceholderOrg };
})();
