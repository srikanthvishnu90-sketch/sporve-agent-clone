"use strict";
/* ═══════════════════════════════════════════════════════════════════
   MOD_TEAMS — the Enterprise "Teams" tab: real CRUD on the teams table.

   One coach tab ("Teams") listing every squad in the org with roster
   counts, seasons, and target sizes. All reads and writes go through
   window.SporveAPI (PostgREST) against the org's own provider_id —
   the same pv.id pattern loadSchedule uses. Nothing here is seeded.

   ENTERPRISE GATING
     The view is gated on two server-owned facts:
       1. plan_entitlements.enterprise.workspace_enabled (public read) —
          the feature flag for the multi-player workspace. mod-coachaccount
          keeps Enterprise's "in development" prose while this is false,
          so the tab treats false as "not enabled yet".
       2. SporveCoach.plan() — the billing page's own read of the provider
          row: entitled AND plan id === 'enterprise'.
     If the flag reads true, both are required. If it reads false, nobody
     gets the tab. If the flag cannot be read, the gate falls back to the
     plan check alone. Anything else renders the honest early-access panel:
     no checkout button (Enterprise is purchasable=false), no numeric
     quotas, no "Unlimited" anywhere.

   HONESTY RULES OBSERVED HERE
     · Teams, roster counts, and seasons are read live from the database.
       An empty org sees "No teams yet", never a fabricated squad.
     · The roster count counts ACTIVE team_athletes rows per team_id for
       this provider. team_athletes.team_id is ON DELETE CASCADE, and
       waivers.member_id is ON DELETE RESTRICT against team_athletes —
       so deleting a team with rostered athletes is BLOCKED, not cascaded:
       "Move or remove N rostered athletes first." No membership record is
       ever destroyed as a side effect of deleting a team.
     · No (provider_id, name) unique constraint exists in the schema, so
       exact-duplicate names are blocked in app code with an inline error,
       checked fresh against the server right before the write.
     · If the seasons table cannot be read, the form skips the season
       field and says so — a team is saved with season_id NULL rather than
       against an invented season.

   Host contract used, never redefined:
     S, render(), toast(), esc(), ICON.
     window.COACH_UI { Page, Button, Block, DataTable, Callout, Card,
       EmptyState, html } — module-local alias `ui`.
   ═══════════════════════════════════════════════════════════════════ */
(function(){

/* ── host contract (read, never redefined) ─────────────────────────── */
function api(){ return window.SporveAPI || null; }
function coachAccount(){ return window.SporveCoach || null; }
function providerRow(){
  return (typeof S !== "undefined" && S.coachProvider) || null;
}
function signedIn(){
  var a = api();
  return !!(a && a.isSignedIn && a.isSignedIn());
}

/* ── module-local view state (view state, never product data) ───────── */
var st = {
  phase: "idle",      // idle | loading | ready | denied | error
  gateKey: null,      // identity the gate was last evaluated under
  teams: [],          // live teams rows for this provider
  counts: {},         // team_id -> active roster count
  seasons: [],        // live seasons rows for the season dropdown
  seasonsOk: true,    // false when the seasons read failed
  sports: [],         // provider.sports (text[]) for the sport datalist
  err: null,
  _recheck: false,
};

/* ═══════════════════ ENTERPRISE GATE ═══════════════════ */
/* The same two facts the billing page rests on: plan_entitlements (the
   public, server-owned price/flag list mod-coachaccount syncs from) and
   SporveCoach.plan() (the provider row's plan + status). workspace_enabled
   is the multi-player workspace feature flag; while false, Enterprise is
   sold as "in development", so the tab stays closed even for an entitled
   Enterprise row until the flag flips. */
async function gateCheck(){
  var a = api();
  var ws = null;  // null = unreadable
  if (a){
    try {
      var rows = await a.from("plan_entitlements",
        "select=workspace_enabled&plan=eq.enterprise&limit=1");
      if (rows && rows[0] && typeof rows[0].workspace_enabled === "boolean")
        ws = rows[0].workspace_enabled;
    } catch (e) { /* flag unreadable: fall back to the plan check */ }
  }
  var plan = null;
  try {
    var acc = coachAccount();
    if (acc && typeof acc.plan === "function") plan = acc.plan();
  } catch (e) { /* treat as not entitled */ }
  var ent = !!(plan && plan.entitled && plan.id === "enterprise");
  if (ws === true) return ent;    // flag truthful: entitled Enterprise required
  if (ws === false) return false; // flag truthful: workspace not enabled yet
  return ent;                     // flag unreadable: plan check alone
}
function gateKeyNow(){
  var pv = providerRow();
  return (signedIn() ? "1" : "0") + ":" + (pv && pv.id ? pv.id : "");
}

/* ═══════════════════ DATA ═══════════════════ */
async function loadTeams(){
  var a = api();
  var pv = providerRow();
  if (!(a && pv && pv.id && signedIn()))
    throw new Error("Finish coach onboarding first — your org record is what everything attaches to.");
  var q = "select=id,name,sport,season_id,target_size,created_at" +
    "&provider_id=eq." + encodeURIComponent(pv.id) +
    "&order=name.asc&limit=200";
  st.teams = await a.from("teams", q) || [];

  /* Roster counts: active team_athletes rows per team_id for this provider.
     A separate query (not a join) so a membership-table hiccup degrades to
     zero counts instead of killing the whole page. */
  var tallies = {};
  try {
    var members = await a.from("team_athletes",
      "select=team_id&provider_id=eq." + encodeURIComponent(pv.id) +
      "&team_id=not.is.null&status=eq.active&limit=2000") || [];
    members.forEach(function (m){
      if (m && m.team_id) tallies[m.team_id] = (tallies[m.team_id] || 0) + 1;
    });
  } catch (e) { /* counts stay zero; the list still renders */ }
  st.counts = tallies;

  /* Seasons for the dropdown. Verified columns (migration
     20260831_001001_seasons.sql): id, provider_id, name, start_date,
     end_date. A failed read marks seasonsOk=false and the form skips the
     season field instead of guessing. */
  try {
    st.seasons = await a.from("seasons",
      "select=id,name,start_date,end_date&provider_id=eq." + encodeURIComponent(pv.id) +
      "&order=start_date.desc&limit=50") || [];
    st.seasonsOk = true;
  } catch (e) {
    st.seasons = [];
    st.seasonsOk = false;
  }
  st.sports = (pv && Array.isArray(pv.sports)) ? pv.sports.filter(Boolean) : [];
}

/* One load per tab visit; writes reload explicitly. The gate re-runs when
   the identity under it changes (guest -> signed in, provider row landing
   after the cold-start fetch), so an early denial never sticks. */
function kickLoad(){
  if (st.phase === "idle"){
    st.phase = "loading";
    runGate();
    return;
  }
  if (st.phase === "denied" && st.gateKey !== gateKeyNow() && !st._recheck){
    st._recheck = true;
    st.gateKey = gateKeyNow();
    gateCheck().then(function (ok){
      st._recheck = false;
      if (ok){ st.phase = "loading"; runGate(); }
      else if (typeof render === "function") render();
    }).catch(function (){ st._recheck = false; });
  }
}
function runGate(){
  st.gateKey = gateKeyNow();
  gateCheck().then(function (ok){
    if (!ok){ st.phase = "denied"; }
    else return loadTeams().then(function (){ st.phase = "ready"; });
  }).then(function (){
    if (typeof render === "function") render();
  }).catch(function (e){
    st.phase = "error";
    st.err = (e && e.message) || "Could not load teams.";
    if (typeof render === "function") render();
  });
}
function teamById(id){
  return st.teams.find(function (t){ return String(t.id) === String(id); }) || null;
}
/* Fresh roster count straight from the server, used by the delete flow so
   the confirm dialog never decides on a stale tally. */
function countRoster(teamId){
  var a = api();
  var pv = providerRow();
  return a.from("team_athletes",
    "select=id&team_id=eq." + encodeURIComponent(teamId) +
    "&provider_id=eq." + encodeURIComponent(pv.id) + "&limit=2000"
  ).then(function (rows){ return (rows || []).length; });
}

/* ═══════════════════ WRITES ═══════════════════ */
/* POST/PATCH/DELETE mirror the host's own PostgREST write pattern
   (Prefer: return=representation; a 204 with no row is a failure, the
   same rule the obligations queue enforces in C4). */
function saveTeam(id, vals){
  var a = api();
  var pv = providerRow();
  if (!(a && pv && pv.id && signedIn()))
    return Promise.reject(new Error("Finish coach onboarding first — your org record is what everything attaches to."));
  /* Fresh duplicate check right before the write: there is no
     (provider_id, name) unique constraint, so app code blocks exact
     duplicates. Excludes the row being edited. */
  return a.from("teams",
      "select=id&provider_id=eq." + encodeURIComponent(pv.id) +
      "&name=eq." + encodeURIComponent(vals.name) + "&limit=2"
    ).then(function (dupes){
      var clash = (dupes || []).filter(function (r){ return String(r.id) !== String(id || ""); });
      if (clash.length) throw new Error("A team named \u201c" + vals.name + "\u201d already exists.");
      var body = {
        provider_id: pv.id,
        name: vals.name,
        sport: vals.sport || null,
        season_id: vals.season_id || null,
        target_size: vals.target_size == null ? null : vals.target_size,
      };
      if (id){
        return a.from("teams",
          "id=eq." + encodeURIComponent(id) + "&provider_id=eq." + encodeURIComponent(pv.id),
          { method: "PATCH", headers: { Prefer: "return=representation" }, body: body }
        ).then(function (rows){
          if (!(rows && rows[0])) throw new Error("The team was not updated — it may not be yours.");
          return rows[0];
        });
      }
      return a.from("teams", "",
        { method: "POST", headers: { Prefer: "return=representation" }, body: body }
      ).then(function (rows){
        if (!(rows && rows[0] && rows[0].id))
          throw new Error("The team was not saved — the server did not return it.");
        return rows[0];
      });
    }).then(function (){
      S.modal = null;
      return loadTeams();
    }).then(function (){
      render();
      toast(id ? "Team updated." : "Team created.");
    });
}

function deleteTeam(id){
  var a = api();
  var pv = providerRow();
  return a.from("teams",
      "id=eq." + encodeURIComponent(id) + "&provider_id=eq." + encodeURIComponent(pv.id),
      { method: "DELETE" }
    ).then(function (){
      return loadTeams();
    }).then(function (){
      S.modal = null;
      render();
      toast("Team deleted.");
    });
}

/* ═══════════════════ CSS ═══════════════════ */
var CSS = `
.tm-mrow{display:flex;gap:10px;justify-content:flex-end;margin-top:20px;flex-wrap:wrap}
.tm-note{font-size:var(--text-sm);color:var(--faint);margin:6px 0 0;line-height:1.45}
`;

/* ═══════════════════ VIEW ═══════════════════ */
function teamsView(){
  var ui = window.COACH_UI;
  if (!ui) return "";
  kickLoad();
  if (st.phase === "denied") return deniedPage(ui);
  var body;
  if (st.phase === "loading" || st.phase === "idle"){
    body = ui.Card("Loading teams\u2026");
  } else if (st.phase === "error"){
    body = ui.Callout({ title: "Could not load teams.", body: st.err || "Try again." });
  } else {
    body = listBody(ui);
  }
  var actions = st.phase === "denied" ? [] :
    [ui.Button({ label: "New team", size: "lg", variant: "primary", attrs: 'data-tm-new="1"' })];
  return ui.Page({
    page: "teams",
    eyebrow: "Business",
    h1: "Teams",
    lede: "Every squad in your organization \u2014 roster sizes, seasons, and targets.",
    actions: actions,
    body: body,
  });
}

/* The non-enterprise surface. No checkout button (Enterprise is
   purchasable=false), no numeric quotas, no "Unlimited". The CTA follows
   the established early-access pattern: it points at the pricing tab,
   which describes early access — never a checkout. */
function deniedPage(ui){
  return ui.Page({
    page: "teams",
    eyebrow: "ENTERPRISE",
    h1: "Teams is an Enterprise feature",
    lede: "Teams is part of the Sporv Enterprise multi-player workspace \u2014 one organization, many coaches, every squad in one place. It is in early access right now.",
    actions: [ui.Button({
      label: "Join the early-access list", size: "lg", variant: "primary",
      attrs: 'data-nav="pricing"',
    })],
    body: ui.Callout({
      title: "Early access.",
      body: "The Teams tab opens automatically for Enterprise organizations once the workspace is enabled for them. Enterprise is not sold as a self-serve checkout, so there is nothing to buy here.",
    }),
  });
}

function listBody(ui){
  if (!st.teams.length){
    return ui.EmptyState("No teams yet", "Create your first squad.") +
      '<div style="margin-top:16px;text-align:center">' +
      ui.Button({ label: "New team", size: "lg", variant: "primary", attrs: 'data-tm-new="1"' }) +
      "</div>";
  }
  var seasonName = {};
  st.seasons.forEach(function (s){ seasonName[s.id] = s.name; });
  var cols = [
    { key: "team", label: "Team" },
    { key: "sport", label: "Sport" },
    { key: "season", label: "Season" },
    { key: "roster", label: "Roster" },
    { key: "target", label: "Target size" },
    { key: "actions", label: "" },
  ];
  var rows = st.teams.map(function (t){
    var n = st.counts[t.id] || 0;
    /* Roster-vs-target: "12 / 18" when a target is set, the bare count
       otherwise. The Target size column carries the raw target. */
    var rosterTxt = (t.target_size != null) ? (n + " / " + t.target_size) : String(n);
    return {
      team: ui.html("<b>" + esc(t.name) + "</b>"),
      sport: t.sport ? esc(t.sport) : "\u2014",
      season: (t.season_id && seasonName[t.season_id]) ? esc(seasonName[t.season_id]) : "\u2014",
      roster: ui.html('<span class="num">' + esc(rosterTxt) + "</span>"),
      target: ui.html('<span class="num">' + (t.target_size != null ? esc(String(t.target_size)) : "\u2014") + "</span>"),
      actions: ui.html('<span class="cui-inline">' +
        '<button type="button" class="btn ghost sm" data-tm-edit="' + esc(t.id) + '">Edit</button>' +
        '<button type="button" class="btn ghost sm" data-tm-del="' + esc(t.id) + '">Delete</button>' +
        "</span>"),
    };
  });
  return ui.DataTable({ columns: cols, rows: rows });
}

/* ═══════════════════ MODALS ═══════════════════ */
function wrap(title, body){
  return '<div class="scrim" data-scrim="1"><div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
    '<div class="modal-head"><b>' + esc(title) + '</b><button class="x" data-close="1" aria-label="Close">' + ICON.x + "</button></div>" +
    '<div class="modal-body">' + body + "</div></div></div>";
}

function teamFormModal(){
  var m = (typeof S !== "undefined" && S.modal) || {};
  var t = m.teamId ? teamById(m.teamId) : null;
  if (m.teamId && !t)
    return wrap("Team", '<p style="color:var(--muted)">That team is no longer in your list.</p>');
  var isEdit = !!t;
  var sportVal = t ? (t.sport || "") : "";
  var sportOpts = st.sports.map(function (s){
    return '<option value="' + esc(s) + '">';
  }).join("");
  var seasonField;
  if (st.seasonsOk){
    var opts = st.seasons.map(function (s){
      var label = s.name + " \u00b7 " + String(s.start_date || "").slice(0, 10) +
        " to " + String(s.end_date || "").slice(0, 10);
      var sel = (t && String(t.season_id) === String(s.id)) ? " selected" : "";
      return '<option value="' + esc(s.id) + '"' + sel + ">" + esc(label) + "</option>";
    }).join("");
    seasonField =
      '<div class="field"><label for="tmF-season">Season (optional)</label>' +
      '<select id="tmF-season" name="season_id"><option value="">No season</option>' + opts + "</select></div>";
  } else {
    seasonField =
      '<p class="tm-note" style="margin:0 0 16px">The seasons list could not be loaded, so the season picker is hidden \u2014 the team will be saved without a season.</p>';
  }
  return wrap(isEdit ? "Edit team" : "New team",
    '<form id="tmTeamForm">' +
    '<div class="field"><label for="tmF-name">Team name</label>' +
    '<input id="tmF-name" name="name" type="text" maxlength="120" required autocomplete="off" value="' + esc(t ? t.name : "") + '"></div>' +
    '<div class="field"><label for="tmF-sport">Sport</label>' +
    '<input id="tmF-sport" name="sport" type="text" list="tmSportList" autocomplete="off" placeholder="e.g. Soccer" value="' + esc(sportVal) + '">' +
    '<datalist id="tmSportList">' + sportOpts + "</datalist>" +
    (st.sports.length ? '<p class="tm-note">Free text \u2014 your sports are suggested above.</p>' : "") + "</div>" +
    seasonField +
    '<div class="field"><label for="tmF-target">Target roster size (optional)</label>' +
    '<input id="tmF-target" name="target_size" type="number" min="1" step="1" inputmode="numeric" value="' +
      esc(t && t.target_size != null ? String(t.target_size) : "") + '"></div>' +
    '<div id="tmFormErr" class="err hide" style="margin:12px 0" role="alert"></div>' +
    '<button class="btn wide" type="submit">' + (isEdit ? "Save changes" : "Create team") + "</button>" +
    "</form>");
}

function teamDeleteModal(){
  var m = (typeof S !== "undefined" && S.modal) || {};
  var t = m.teamId ? teamById(m.teamId) : null;
  if (!t)
    return wrap("Delete team", '<p style="color:var(--muted)">That team is no longer in your list.</p>');
  var n = Number(m.count || 0);
  if (n > 0){
    /* Blocked, honestly: team_athletes.team_id cascades on delete, so
       deleting the team would erase these membership records (and
       waivers.member_id is RESTRICT against them). The coach moves or
       removes the athletes first. */
    return wrap("Delete team",
      "<p><b>" + esc(t.name) + "</b> has <b class=\"num\">" + n + "</b> rostered athlete" + (n === 1 ? "" : "s") + ".</p>" +
      '<p style="color:var(--muted)">Move or remove ' + (n === 1 ? "them" : "these athletes") +
      " from the team first \u2014 deleting the team would also remove its roster membership records.</p>" +
      '<div class="tm-mrow"><button class="btn ghost" data-close="1">Keep the team</button></div>');
  }
  return wrap("Delete team",
    "<p>Delete <b>" + esc(t.name) + "</b>? This cannot be undone.</p>" +
    '<div id="tmDelErr" class="err hide" style="margin:12px 0" role="alert"></div>' +
    '<div class="tm-mrow"><button class="btn ghost" data-close="1">Cancel</button>' +
    '<button class="btn" id="tmDelGo">Delete team</button></div>');
}

/* ═══════════════════ WIRING ═══════════════════ */
function ensureCSS(){
  if (typeof document === "undefined" || document.getElementById("mod-teams-css")) return;
  var el = document.createElement("style");
  el.id = "mod-teams-css";
  el.textContent = CSS;
  document.head.appendChild(el);
}

function wire(){
  ensureCSS();
  if (typeof document === "undefined") return;
  var q = function (s){ return document.querySelectorAll(s); };

  q("[data-tm-new]").forEach(function (b){
    b.onclick = function (){
      S.modal = { type: "teamform" };
      render();
    };
  });
  q("[data-tm-edit]").forEach(function (b){
    b.onclick = function (){
      if (!teamById(b.dataset.tmEdit)) return;
      S.modal = { type: "teamform", teamId: b.dataset.tmEdit };
      render();
    };
  });
  q("[data-tm-del]").forEach(function (b){
    b.onclick = function (){
      if (b.dataset.busy || !teamById(b.dataset.tmDel)) return;
      b.dataset.busy = "1";
      var label = b.textContent;
      b.textContent = "\u2026";
      countRoster(b.dataset.tmDel).then(function (n){
        delete b.dataset.busy;
        b.textContent = label;
        S.modal = { type: "teamdelete", teamId: b.dataset.tmDel, count: n };
        render();
      }).catch(function (e){
        delete b.dataset.busy;
        b.textContent = label;
        toast("Could not check the roster: " + ((e && e.message) || "try again."));
      });
    };
  });

  /* ── team form modal ── */
  var form = document.getElementById("tmTeamForm");
  if (form) form.onsubmit = function (ev){
    ev.preventDefault();
    var m = S.modal || {};
    var err = document.getElementById("tmFormErr");
    var show = function (msg){
      if (err){ err.textContent = msg; err.classList.remove("hide"); }
      return false;
    };
    /* Read off the live DOM (never a re-rendered copy) so a validation
       error cannot throw away what the coach already typed. */
    var fd = new FormData(form);
    var name = String(fd.get("name") == null ? "" : fd.get("name")).trim();
    var sport = String(fd.get("sport") == null ? "" : fd.get("sport")).trim();
    var seasonId = String(fd.get("season_id") == null ? "" : fd.get("season_id")).trim();
    var targetRaw = String(fd.get("target_size") == null ? "" : fd.get("target_size")).trim();
    if (!name) return show("Give the team a name.");
    var target = null;
    if (targetRaw){
      var tn = Number(targetRaw);
      if (!isFinite(tn) || Math.floor(tn) !== tn || tn < 1)
        return show("Target size must be a whole number of 1 or more, or left blank.");
      target = tn;
    }
    var btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    saveTeam(m.teamId || null, { name: name, sport: sport, season_id: seasonId, target_size: target })
      .catch(function (e){
        if (btn) btn.disabled = false;
        show((e && e.message) || "Could not save the team \u2014 try again.");
      });
    return false;
  };

  /* ── delete confirm modal ── */
  var go = document.getElementById("tmDelGo");
  if (go){
    var delId = (S.modal || {}).teamId;
    go.onclick = function (){
      go.disabled = true;
      var err = document.getElementById("tmDelErr");
      deleteTeam(delId).catch(function (e){
        go.disabled = false;
        if (err){
          err.textContent = (e && e.message) || "Could not delete the team \u2014 try again.";
          err.classList.remove("hide");
        }
      });
    };
  }
}

/* ═══════════════════ EXPORT ═══════════════════ */
window.MOD_TEAMS = {
  css: CSS,
  tabs: { teams: "Teams" },
  views: { teams: teamsView },
  modals: { teamform: teamFormModal, teamdelete: teamDeleteModal },
  wire: wire,
  state: {},
};

})();
