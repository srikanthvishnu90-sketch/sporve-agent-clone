"use strict";
/* ═══════════════════════════════════════════════════════════════════
   MOD_FAMILIES — the coach-facing Families tab (Enterprise-gated).

   Guardians and the athletes they cover: who pays, who to contact.

   THE LINKING CHAIN, MODELLED HONESTLY ON THE REAL SCHEMA
     guardians (id uuid PK, provider_id NOT NULL → providers.id) holds the
     guardian record. guardian_links (guardian_id → guardians.id, member_id
     → team_athletes.id, is_payer, relationship, provider_id NOT NULL) is the
     link — and member_id points at the ROSTER ROW (team_athletes.id), not
     athletes.id, so the UI always says "athlete on a team" and joins
     team_athletes → teams for the team name. Verified read-only against the
     production schema 2026-09-22: all four FKs on guardian_links are
     ON DELETE CASCADE (confdeltype='c'), so removing a guardian removes its
     links — the delete confirm says exactly that, and nothing is orphaned.

   GATING
     Enterprise-only. The plan comes from the same place the billing page
     reads it (window.SporveCoach.plan(): {id, entitled, ...}). The
     plan_entitlements enterprise row is publicly readable; verified
     2026-09-22: purchasable=false, workspace_enabled=true. workspace_enabled
     is truthful (a real flag, true on the enterprise row), so the tab opens
     only when the plan is enterprise AND entitled AND the enterprise row has
     workspace_enabled true (row unreadable → falls back to the plan-id
     check). Non-enterprise gets an honest teaser: no data fetched, no
     checkout button (buyable:false), no numeric quotas, no "Unlimited".

   HONESTY RULES OBSERVED HERE
     · Every guardian, link, athlete row, and team name is a real row read
       off the provider's own records. No invented guardians or athletes —
       empty states say so plainly.
     · is_payer renders as a cui-badge "Payer" on the exact link row that
       carries it. Nothing infers payer status.
     · Duplicate (guardian_id, member_id) links are refused in app code with
       an honest inline error before any POST is attempted.
     · COPPA-conscious: guardian/parent data is display-only here. There is
       no messaging feature on this tab and none is proposed.
     · No ai-gateway calls, no approvals/sends/schedules/payments.

   Host contract used, never redefined:
     S, render(), toast(), esc(), window.COACH_UI, window.SporveAPI,
     window.SporveCoach (ACCOUNT), window.confirm.
   ═══════════════════════════════════════════════════════════════════ */
(function(){

/* ═══════════════════ MODULE-LOCAL STATE ═══════════════════ */
/* View + cache state, not product data: it never lands in S. Rows are only
   ever real DB rows (or the empty arrays that mean "loaded, nothing there"). */
const st = {
  loaded: false, loading: false, error: null,
  guardians: [], links: [], roster: [], teams: {},
  dialog: null,   // {type:"add"} | {type:"link", guardianId} | null
  formErr: null, busy: false,
  entChecked: false, entRow: null,
};

/* ═══════════════════ ACCESSORS ═══════════════════ */
const pid = () => (typeof S !== "undefined" && S.coachProvider && S.coachProvider.id) || null;
const api = () => window.SporveAPI || null;
const plan = () =>
  (window.SporveCoach && typeof window.SporveCoach.plan === "function")
    ? window.SporveCoach.plan() : null;

/* Read the enterprise row once. plan_entitlements is publicly readable and
   the single source the billing tab reconciles against. */
function fireEntCheck(){
  if (st.entChecked || !api()) return;
  st.entChecked = true;
  api().from("plan_entitlements", "select=plan,purchasable,workspace_enabled")
    .then(rows => {
      st.entRow = (rows || []).find(r => r.plan === "enterprise") || null;
      if (typeof render === "function") render();
    })
    .catch(() => { if (typeof render === "function") render(); });
}

/* The gate. workspace_enabled is truthful on the enterprise row (true, and
   the flag the billing copy keys its "in development" prose off), so the
   tab opens only when the server-owned plan is an entitled enterprise plan
   and the row agrees. Row unreadable → fall back to the plan-id check. */
function isOpen(){
  const p = plan();
  if (!p || p.id !== "enterprise" || !p.entitled) return false;
  if (st.entChecked && st.entRow && st.entRow.workspace_enabled === false) return false;
  return true;
}

/* ═══════════════════ LOADS ═══════════════════ */
/* Four real reads, joined client-side. All scoped to the coach's own
   provider_id — RLS (owner ALL + self SELECT) scopes them again server-side. */
function loadAll(){
  const id = pid(), A = api();
  if (!id || !A || st.loading) return Promise.resolve();
  st.loading = true; st.error = null;
  const q = (t, sel) => A.from(t, sel + "&provider_id=eq." + encodeURIComponent(id));
  return Promise.all([
    q("guardians", "select=id,first_name,last_name,email,phone,email_status&order=created_at&limit=200"),
    q("guardian_links", "select=id,guardian_id,member_id,is_payer,relationship&order=created_at&limit=1000"),
    q("team_athletes", "select=id,first_name,last_name,team_id&order=last_name,first_name&limit=500"),
    q("teams", "select=id,name&order=name&limit=200"),
  ]).then(rs => {
    st.guardians = rs[0] || [];
    st.links = rs[1] || [];
    st.roster = rs[2] || [];
    st.teams = {};
    (rs[3] || []).forEach(t => { st.teams[t.id] = t.name; });
    st.loaded = true; st.loading = false;
  }).catch(e => {
    st.loading = false;
    st.error = (e && e.message) || "Could not load guardian records.";
  });
}
function ensureLoad(){
  if (st.loaded || st.loading) return;
  loadAll().then(() => { if (typeof render === "function") render(); });
}
function reload(){
  st.loaded = false; st.dialog = null; st.formErr = null; st.busy = false;
  ensureLoad();
  if (typeof render === "function") render();
}

/* ═══════════════════ DERIVED READS ═══════════════════ */
const fullName = g => [g.first_name, g.last_name].filter(Boolean).join(" ") || "(unnamed)";
const rosterName = r => [r.first_name, r.last_name].filter(Boolean).join(" ") || "(unnamed athlete)";
const teamNameOf = r => (r && r.team_id && st.teams[r.team_id]) || "No team";
const rosterById = id => st.roster.find(r => r.id === id) || null;
const guardianById = id => st.guardians.find(g => g.id === id) || null;
const linksFor = gid => st.links.filter(l => l.guardian_id === gid);
const sortedGuardians = () => st.guardians.slice().sort((a, b) =>
  fullName(a).toLowerCase().localeCompare(fullName(b).toLowerCase()));
const payerLinks = gid => linksFor(gid).filter(l => l.is_payer);
/* Roster rows this provider has that are not yet linked to this guardian —
   the only honest options for the "Link athlete" dropdown. */
const linkableRoster = gid => {
  const taken = {};
  linksFor(gid).forEach(l => { taken[l.member_id] = 1; });
  return st.roster.filter(r => !taken[r.id]);
};

/* ═══════════════════ CSS ═══════════════════ */
const CSS = `
/* Families tab. All type at 14px or above; 8px grid; dark-ground tokens
   only (no light borders on dark surfaces — the badge/line tokens are the
   cui scale, same as every other coach page). */
.fam-lines{display:flex;flex-direction:column;gap:8px;align-items:flex-start}
.fam-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.fam-muted{color:var(--cui-ink-3)}
.fam-acts{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.fam-mini{background:none;border:0;padding:0;color:var(--cui-steel);font-size:14px;
  font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.fam-mini:hover{color:var(--cui-ink)}
.fam-form{display:grid;gap:16px;max-width:480px}
.fam-field{display:grid;gap:8px}
.fam-field label{font-size:14px;font-weight:600;color:var(--cui-ink-2)}
.fam-field input[type="text"],.fam-field input[type="email"],.fam-field input[type="tel"],.fam-field select{
  height:40px;padding:0 12px;border:1px solid var(--cui-line-2);border-radius:8px;
  background:var(--cui-panel-2);color:var(--cui-ink);font-size:14px;width:100%}
.fam-field input:focus,.fam-field select:focus{outline:none;border-color:var(--cui-steel)}
.fam-check{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--cui-ink-2)}
.fam-check input{width:16px;height:16px;accent-color:#fff}
.fam-err{padding:12px 16px;border:1px solid var(--cui-line-2);border-radius:8px;
  background:var(--cui-panel-2);color:var(--cui-ink);font-size:14px;line-height:1.5}
.fam-formbtns{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
`;

/* ═══════════════════ VIEW: ENTERPRISE TEASER ═══════════════════ */
function teaserView(ui){
  return ui.Page({
    page: "families", eyebrow: "ENTERPRISE", h1: "Families is an Enterprise feature",
    lede: "Guardian records linked to the athletes they cover — who pays, who to contact — built for clubs running full rosters.",
    actions: [ui.Button({
      label: "Join the early-access list", size: "lg", variant: "primary",
      attrs: 'data-fam-pricing="1"',
    })],
    /* No checkout button on purpose: enterprise is not self-serve
       (purchasable=false). No numeric quotas, no "Unlimited" — the vague
       plan prose lives on the billing page, which is where the button goes. */
    body: ui.Callout({
      title: "How Enterprise works. ",
      body: "Enterprise is invite-only while it is in development. The plan list shows what is coming; joining the early-access list puts your club in line and we reach out when your workspace is ready.",
    }),
  });
}

/* ═══════════════════ VIEW: FAMILIES ═══════════════════ */
function familiesView(){
  const ui = window.COACH_UI;
  if (!ui) return "";
  fireEntCheck();
  if (!isOpen()) return teaserView(ui);
  ensureLoad();

  const G = sortedGuardians();
  const linkedAthletes = {};
  st.links.forEach(l => { linkedAthletes[l.member_id] = 1; });
  const payerCount = G.filter(g => payerLinks(g.id).length).length;

  const body =
    (st.error ? ui.Callout({ title: "Could not load families. ", body: st.error }) : "") +
    (st.loading && !st.loaded
      ? ui.EmptyState("Loading guardians", "Fetching guardian and link records.")
      : "") +
    dialogBlock(ui) +
    (st.loaded && !st.loading ? ui.StatGrid([
      ui.StatCard({ label: "Guardians", value: String(G.length), context: "Guardian records on file." }),
      ui.StatCard({ label: "Athletes linked", value: String(Object.keys(linkedAthletes).length), context: "Roster rows with at least one guardian." }),
      ui.StatCard({ label: "Payers", value: String(payerCount), context: "Guardians marked as payer on a link." }),
    ]) : "") +
    (st.loaded && !st.loading
      ? ui.Block({
          title: "Guardians",
          subtitle: "Each guardian links to roster rows — an athlete on a team — never to a bare athlete record.",
          action: ui.Button({ label: "Add guardian", size: "sm", variant: "secondary", attrs: 'data-fam-add="1"' }),
          body: ui.DataTable({
            columns: [
              { label: "Guardian", key: "guardian" },
              { label: "Contact", key: "contact" },
              { label: "Linked athletes", key: "athletes" },
              { label: "Payer", key: "payer" },
            ],
            emptyTitle: "No guardians yet",
            emptyBody: "Add a guardian to start linking the athletes they cover.",
            rows: G.map(g => guardianRow(ui, g)),
          }),
        })
      : "");

  return ui.Page({
    page: "families", eyebrow: "Business", h1: "Families",
    lede: "Guardians and the athletes they cover — who pays, who to contact.",
    actions: [ui.Button({ label: "Add guardian", size: "lg", variant: "primary", attrs: 'data-fam-add="1"' })],
    body: body,
  });
}

function guardianRow(ui, g){
  const links = linksFor(g.id);
  const contact = [g.email, g.phone].filter(Boolean);
  const payer = payerLinks(g.id);

  const athleteLines = links.length
    ? links.map(l => {
        const r = rosterById(l.member_id);
        const name = r ? rosterName(r) : "Athlete no longer on roster";
        const team = r ? teamNameOf(r) : "";
        return `<div class="fam-line"><span><b>${esc(name)}</b>${team ? ` <span class="fam-muted">· ${esc(team)}</span>` : ""}` +
          (l.relationship ? ` <span class="fam-muted">(${esc(l.relationship)})</span>` : "") + "</span>" +
          (l.is_payer ? `<span class="cui-badge cui-badge--good">Payer</span>` : "") +
          `<button type="button" class="fam-mini" data-fam-unlink="${esc(l.id)}" data-fam-gname="${esc(fullName(g))}" data-fam-aname="${esc(name)}">Unlink</button></div>`;
      }).join("")
    : `<span class="fam-muted">No athletes linked yet</span>`;

  const payerCell = payer.length
    ? payer.map(l => {
        const r = rosterById(l.member_id);
        return `<div class="fam-line"><span class="cui-badge cui-badge--good">Payer</span><span>${esc(r ? rosterName(r) : "Athlete no longer on roster")}</span></div>`;
      }).join("")
    : `<span class="fam-muted">Not marked as payer</span>`;

  return {
    guardian: ui.html(
      `<b>${esc(fullName(g))}</b>` +
      `<div class="fam-acts"><button type="button" class="cui-button cui-button--sm cui-button--secondary" data-fam-link="${esc(g.id)}">Link athlete</button>` +
      `<button type="button" class="cui-button cui-button--sm cui-button--secondary" data-fam-remove="${esc(g.id)}" data-fam-gname="${esc(fullName(g))}" data-fam-nlinks="${links.length}">Remove</button></div>`
    ),
    contact: ui.html(contact.length
      ? contact.map(c => `<div>${esc(c)}</div>`).join("")
      : `<span class="fam-muted">No contact on file</span>`),
    athletes: ui.html(`<div class="fam-lines">${athleteLines}</div>`),
    payer: ui.html(`<div class="fam-lines">${payerCell}</div>`),
  };
}

/* ═══════════════════ DIALOGS (inline blocks, not host modals) ═══════════════════ */
function dialogBlock(ui){
  const d = st.dialog;
  if (!d) return "";
  if (d.type === "add") return addGuardianBlock(ui);
  if (d.type === "link") return linkAthleteBlock(ui, d.guardianId);
  return "";
}

function addGuardianBlock(ui){
  return ui.Block({
    title: "Add guardian",
    subtitle: "A real guardian record on your provider. First name is required; everything else is optional.",
    body: `<form id="famAddForm" class="fam-form" novalidate>
      <div class="fam-field"><label for="famF-first">First name</label>
        <input type="text" id="famF-first" name="first_name" autocomplete="off" maxlength="80"></div>
      <div class="fam-field"><label for="famF-last">Last name</label>
        <input type="text" id="famF-last" name="last_name" autocomplete="off" maxlength="80"></div>
      <div class="fam-field"><label for="famF-email">Email</label>
        <input type="email" id="famF-email" name="email" autocomplete="off" maxlength="160"></div>
      <div class="fam-field"><label for="famF-phone">Phone</label>
        <input type="tel" id="famF-phone" name="phone" autocomplete="off" maxlength="40"></div>
      ${st.formErr ? `<div class="fam-err" role="alert">${esc(st.formErr)}</div>` : ""}
      <div class="fam-formbtns">
        <button type="submit" class="cui-button cui-button--lg cui-button--primary"${st.busy ? " disabled" : ""}>${st.busy ? "Saving…" : "Save guardian"}</button>
        <button type="button" class="cui-button cui-button--lg cui-button--secondary" data-fam-cancel="1">Cancel</button>
      </div>
    </form>`,
  });
}

function linkAthleteBlock(ui, guardianId){
  const g = guardianById(guardianId);
  if (!g) return ui.Callout({ title: "Guardian not found. ", body: "That guardian is no longer on file." });
  const opts = linkableRoster(guardianId);
  return ui.Block({
    title: "Link athlete",
    subtitle: "Link " + fullName(g) + " to a roster row — an athlete on a team. Rows already linked to this guardian are not offered twice.",
    body: `<form id="famLinkForm" class="fam-form" novalidate data-fam-gid="${esc(guardianId)}">
      ${opts.length ? `<div class="fam-field"><label for="famF-athlete">Athlete</label>
        <select id="famF-athlete" name="member_id">
          ${opts.map(r => `<option value="${esc(r.id)}">${esc(rosterName(r))} — ${esc(teamNameOf(r))}</option>`).join("")}
        </select></div>` : `<div class="fam-err" role="alert">Every roster row is already linked to ${esc(fullName(g))}, or there are no roster rows yet. Add athletes to a team first.</div>`}
      <div class="fam-field"><label for="famF-rel">Relationship</label>
        <input type="text" id="famF-rel" name="relationship" placeholder="Mother, Father, Guardian…" autocomplete="off" maxlength="60"></div>
      <label class="fam-check"><input type="checkbox" id="famF-payer" name="is_payer"> This guardian pays for this athlete</label>
      ${st.formErr ? `<div class="fam-err" role="alert">${esc(st.formErr)}</div>` : ""}
      <div class="fam-formbtns">
        ${opts.length ? `<button type="submit" class="cui-button cui-button--lg cui-button--primary"${st.busy ? " disabled" : ""}>${st.busy ? "Linking…" : "Link athlete"}</button>` : ""}
        <button type="button" class="cui-button cui-button--lg cui-button--secondary" data-fam-cancel="1">Cancel</button>
      </div>
    </form>`,
  });
}

/* ═══════════════════ WRITES ═══════════════════ */
/* POST/PATCH/DELETE via SporveAPI.from, the same shape as the Settings →
   People Revoke/Restore writes. A write that does not confirm a row is
   treated as a failure — never a silent local-only change. */
function postRow(table, body){
  return api().from(table, "", {
    method: "POST", headers: { Prefer: "return=representation" }, body: body,
  }).then(rows => {
    if (!rows || !rows[0]) throw new Error("The record was not saved — nothing was written.");
    return rows[0];
  });
}

function saveGuardian(){
  const id = pid();
  if (!id){ st.formErr = "No provider workspace is loaded, so there is nowhere to save this."; render(); return; }
  const v = name => {
    const el = document.getElementById("famF-" + name);
    return el ? el.value.trim() : "";
  };
  const first = v("first"), last = v("last"), email = v("email"), phone = v("phone");
  if (!first){ st.formErr = "First name is required."; render(); return; }
  st.busy = true; st.formErr = null; render();
  postRow("guardians", {
    provider_id: id, first_name: first,
    last_name: last || null, email: email || null, phone: phone || null,
  }).then(() => {
    reload();
    toast("Guardian added — " + first);
  }).catch(e => {
    st.busy = false;
    st.formErr = (e && e.message) || "Could not save the guardian.";
    render();
  });
}

function saveLink(){
  const form = document.getElementById("famLinkForm");
  if (!form) return;
  const gid = form.getAttribute("data-fam-gid");
  const g = guardianById(gid);
  if (!g){ st.formErr = "That guardian is no longer on file."; render(); return; }
  const sel = document.getElementById("famF-athlete");
  const mid = sel ? sel.value : "";
  if (!mid){ st.formErr = "Choose an athlete to link."; render(); return; }
  const r = rosterById(mid);
  if (!r){ st.formErr = "That roster row is no longer available."; render(); return; }
  /* App-level duplicate guard: one (guardian, roster row) pair, one link. */
  if (st.links.some(l => l.guardian_id === gid && l.member_id === mid)){
    st.formErr = rosterName(r) + " is already linked to " + fullName(g) + " — choose a different athlete.";
    render();
    return;
  }
  const rel = document.getElementById("famF-rel");
  const pay = document.getElementById("famF-payer");
  st.busy = true; st.formErr = null; render();
  postRow("guardian_links", {
    provider_id: pid(), guardian_id: gid, member_id: mid,
    is_payer: !!(pay && pay.checked),
    relationship: (rel && rel.value.trim()) || null,
  }).then(() => {
    reload();
    toast(fullName(g) + " linked to " + rosterName(r));
  }).catch(e => {
    st.busy = false;
    st.formErr = (e && e.message) || "Could not link the athlete.";
    render();
  });
}

function unlink(linkId, gname, aname){
  if (!window.confirm("Remove the link between " + gname + " and " + aname + "?")) return;
  api().from("guardian_links", "id=eq." + encodeURIComponent(linkId), { method: "DELETE" })
    .then(() => { reload(); toast("Link removed — " + aname + " is no longer tied to " + gname + "."); })
    .catch(e => toast((e && e.message) || "Could not remove the link."));
}

function removeGuardian(gid, gname, nlinks){
  /* ON DELETE CASCADE is verified on guardian_links.guardian_id_fkey, so the
     links go with the guardian — the confirm states that plainly rather than
     pretending the links survive somewhere. */
  const tail = nlinks > 0
    ? " Their " + nlinks + " athlete link" + (nlinks === 1 ? "" : "s") + " will be removed with them."
    : " They have no athlete links.";
  if (!window.confirm("Remove guardian " + gname + "?" + tail + " This cannot be undone.")) return;
  api().from("guardians", "id=eq." + encodeURIComponent(gid), { method: "DELETE" })
    .then(() => { reload(); toast("Guardian removed" + (nlinks > 0 ? " — their links went with them." : ".")); })
    .catch(e => toast((e && e.message) || "Could not remove the guardian."));
}

/* ═══════════════════ NAV: EARLY-ACCESS CTA → PLAN LIST ═══════════════════ */
/* The pricing surface inside the dashboard is the billing tab's Plan
   sub-tab (plan cards, enterprise "talk to us" copy, buyable:false honored
   there). No checkout is ever started from this module. */
function goPricing(){
  if (typeof S === "undefined" || typeof render !== "function") return;
  S.coachTab = "billing";
  S.billingTab = "plan";
  S.modal = null;
  S.route = { name: "coach", arg: null };
  render();
}

/* ═══════════════════ WIRING ═══════════════════ */
function ensureCSS(){
  if (typeof document === "undefined" || document.getElementById("mod-families-css")) return;
  const el = document.createElement("style");
  el.id = "mod-families-css";
  el.textContent = CSS;
  document.head.appendChild(el);
}

function wire(){
  ensureCSS();
  if (typeof document === "undefined") return;
  const q = s => document.querySelectorAll(s);

  q("[data-fam-pricing]").forEach(b => { b.onclick = goPricing; });

  q("[data-fam-add]").forEach(b => { b.onclick = () => { st.dialog = { type: "add" }; st.formErr = null; render(); }; });
  q("[data-fam-cancel]").forEach(b => { b.onclick = () => { st.dialog = null; st.formErr = null; render(); }; });
  q("[data-fam-link]").forEach(b => { b.onclick = () => { st.dialog = { type: "link", guardianId: b.getAttribute("data-fam-link") }; st.formErr = null; render(); }; });

  q("[data-fam-unlink]").forEach(b => { b.onclick = () =>
    unlink(b.getAttribute("data-fam-unlink"), b.getAttribute("data-fam-gname") || "this guardian", b.getAttribute("data-fam-aname") || "this athlete"); });
  q("[data-fam-remove]").forEach(b => { b.onclick = () =>
    removeGuardian(b.getAttribute("data-fam-remove"), b.getAttribute("data-fam-gname") || "this guardian", Number(b.getAttribute("data-fam-nlinks")) || 0); });

  const addForm = document.getElementById("famAddForm");
  if (addForm) addForm.onsubmit = ev => { ev.preventDefault(); if (!st.busy) saveGuardian(); };
  const linkForm = document.getElementById("famLinkForm");
  if (linkForm) linkForm.onsubmit = ev => { ev.preventDefault(); if (!st.busy) saveLink(); };
}

/* ═══════════════════ EXPORT ═══════════════════ */
window.MOD_FAMILIES = {
  css: CSS,
  tabs: { families: "Families" },
  views: { families: familiesView },
  wire: wire,
  state: st,
};

})();
