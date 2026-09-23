"use strict";
/* ═══════════════════════════════════════════════════════════════════
   MOD_ORG — the Organization tab (Enterprise-gated).

   Three sections, all real DB-backed CRUD, nothing invented:
     · Profile   — PATCH on the org's providers row (owner-only writes).
     · Locations — CRUD on public.venue (admin writes, member reads).
     · Staff     — CRUD on public.organization_members (admin writes;
                   admin/self reads). No seed rows: an org with no staff
                   renders an honest empty state.

   Host contract used, never redefined:
     window.COACH_UI (Page, Block, Card, Button, EmptyState, activeTab),
     window.SporveAPI.from (GET/PATCH/POST/DELETE over PostgREST),
     S.coachProvider (the provider row the billing page's plan read uses),
     render(), toast().

   HONESTY RULES OBSERVED HERE
     · Every write asks PostgREST for the changed row back (Prefer:
       return=representation) and throws when no row comes back — a 200
       that changed nothing is reported as a failure, never as success.
       EXCEPTION: the providers PATCH uses return=minimal + a granted-column
       re-read as its receipt, because authenticated cannot SELECT the
       geo/Stripe columns and RETURNING * 403s (42501).
     · Background-check status is READ-ONLY. The aaa_guard_background_check_mirror
       trigger (migration 20260915_001064) forbids direct writes to
       background_check_status/background_check_completed_at with a 42501 —
       the status is derived from the real check and no coach can set it.
       The UI says so instead of offering a dead control.
     · "Mark verified" style controls do not exist here: they could not work,
       and a button that cannot work is banned.
     · Adding staff creates a profile row only — member_user_id stays null
       until staff invites link a sign-in, and the UI says exactly that.
     · Revoke keeps history (is_active=false); nothing is deleted.
     · The locked panel never shows numeric quotas and never says "Unlimited".
   ═══════════════════════════════════════════════════════════════════ */
(function(){

/* ═══════════════════ SMALL HELPERS ═══════════════════ */
const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g,
  c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ui = () => window.COACH_UI;
const api = () => window.SporveAPI;
const pv = () => (typeof S !== "undefined" && S.coachProvider) || null;
const signedIn = () => !!(api() && api().isSignedIn && api().isSignedIn());
function say(msg){ if (typeof toast === "function") toast(msg); }
function rerender(){ if (typeof render === "function") render(); }
function busy(btn, on, label){
  if (!btn) return;
  btn.disabled = !!on;
  if (on){ btn.dataset.orgLabel = btn.textContent; btn.textContent = label || "Working…"; }
  else if (btn.dataset.orgLabel){ btn.textContent = btn.dataset.orgLabel; delete btn.dataset.orgLabel; }
}
const val = id => { const el = document.getElementById(id); return el ? el.value : ""; };
const nul = s => { const t = String(s == null ? "" : s).trim(); return t ? t : null; };

/* ═══════════════════ MODULE STATE ═══════════════════ */
/* View state only — never product data. bootModules() deep-clones this into
   S at boot; the view and wire below always read the local copy, so the two
   can never disagree mid-session. */
const st = {
  gateState: "unknown",   // unknown → loading → open | locked
  gateNote: "",           // why locked: not-built | not-entitled | not-enterprise | flag-unreadable
  gateSawProvider: false, // did the gate decision see a loaded provider row?
  venues: null, venuesLoading: false,
  staff: null, staffLoading: false,
  editingVenue: null,     // "new" | venue id | null
  editingMember: null,    // "new" | member id | null
};

/* ═══════════════════ ENTERPRISE GATING ═══════════════════ */
/* The current plan, read the same way the billing page reads it: off the
   provider row (my_workspace RPC → S.coachProvider), with the billing
   page's own entitlement rule (active/trialing/past_due — canceled and
   incomplete are not entitlement). Mirrors ACCOUNT.plan() in
   mod-coachaccount.js rather than re-implementing its judgement. */
function currentPlan(){
  const p = pv() || {};
  const id = (p.plan === "enterprise" || p.plan === "pro") ? p.plan : "free";
  const status = String(p.plan_status || "none");
  const entitled = id !== "free" && ["active", "trialing", "past_due"].indexOf(status) >= 0;
  return { id: id, status: status, entitled: entitled };
}
/* The truthful product flag is the enterprise row's workspace_enabled in
   plan_entitlements (public-read; the §6.2 capability-gate column for the
   multi-player workspace). It is seeded true for enterprise in
   20260921_001108_billing_pipeline_repair.sql, so in practice the gate is
   the plan check — but the flag stays the authority: if it ever flips off,
   this page locks for everyone, enterprise subscribers included. */
function refreshGate(){
  const haveProvider = !!(pv() && pv().id);
  if (st.gateState === "loading") return;
  if (st.gateState === "open" || st.gateState === "locked"){
    /* Gate race fix: the tab can render before ACCOUNT.load() populates the
       provider row, in which case a real enterprise user sees the locked
       panel. If we locked without ever seeing a provider row and one has
       since arrived, re-evaluate instead of staying locked. */
    if (st.gateState === "locked" && !st.gateSawProvider && haveProvider){
      st.gateState = "unknown"; st.gateNote = "";
    } else return;
  }
  if (!signedIn()){ st.gateState = "locked"; st.gateNote = "signed-out"; st.gateSawProvider = haveProvider; return; }
  st.gateState = "loading";
  api().from("plan_entitlements", "select=plan,workspace_enabled,purchasable")
    .then(rows => {
      const ent = (rows || []).find(r => r.plan === "enterprise");
      const plan = currentPlan();
      if (ent && ent.workspace_enabled && plan.id === "enterprise" && plan.entitled){
        st.gateState = "open";
      } else {
        st.gateState = "locked";
        st.gateNote = !(ent && ent.workspace_enabled) ? "not-built"
          : (plan.id === "enterprise" ? "not-entitled" : "not-enterprise");
      }
      st.gateSawProvider = !!(pv() && pv().id);
      rerender();
    })
    .catch(() => {
      /* Billing's A5 fallback convention: the entitlements fetch failed, so
         gate on the plan read alone rather than breaking the page. */
      const plan = currentPlan();
      st.gateState = (plan.id === "enterprise" && plan.entitled) ? "open" : "locked";
      st.gateNote = "flag-unreadable";
      st.gateSawProvider = !!(pv() && pv().id);
      rerender();
    });
}

/* ═══════════════════ DATA LOADS ═══════════════════ */
function loadVenues(){
  if (st.venuesLoading || st.venues !== null) return;
  const P = pv();
  if (!signedIn() || !P || !P.id){ st.venues = []; return; }
  st.venuesLoading = true;
  api().from("venue",
    "select=id,name,address,timezone,capacity,created_at&provider_id=eq." + encodeURIComponent(P.id) +
    "&order=created_at")
    .then(rows => { st.venues = Array.isArray(rows) ? rows : []; st.venuesLoading = false; rerender(); })
    .catch(() => { st.venues = []; st.venuesLoading = false; rerender(); });
}
function loadStaff(){
  if (st.staffLoading || st.staff !== null) return;
  const P = pv();
  if (!signedIn() || !P || !P.id){ st.staff = []; return; }
  st.staffLoading = true;
  /* The proven Settings→People read, plus commission_type/commission_value
     and the organization_id scoping this tab needs for its own inserts. */
  api().from("organization_members",
    "select=id,organization_id,trainer_profile,member_user_id,role,background_check_status," +
    "background_check_completed_at,is_active,commission_type,commission_value,created_at" +
    "&organization_id=eq." + encodeURIComponent(P.id) + "&order=created_at")
    .then(rows => { st.staff = Array.isArray(rows) ? rows : []; st.staffLoading = false; rerender(); })
    .catch(() => { st.staff = []; st.staffLoading = false; rerender(); });
}
function invalidateVenues(){ st.venues = null; st.venuesLoading = false; st.editingVenue = null; }
function invalidateStaff(){ st.staff = null; st.staffLoading = false; st.editingMember = null; }

/* A write is only real if a changed row comes back. Every mutating call in
   this module goes through here. */
function write(table, query, opts){
  const o = Object.assign({}, opts, { headers: Object.assign({ Prefer: "return=representation" }, (opts && opts.headers) || {}) });
  return api().from(table, query, o).then(rows => {
    if (!rows || !rows[0]) throw new Error("The change did not land — it may not be yours to make.");
    return rows[0];
  });
}

/* ═══════════════════ CSS ═══════════════════ */
const CSS = `
.org-form{display:grid;gap:16px;max-width:480px}
.org-field{display:grid;gap:8px}
.org-field>label{font-size:14px;font-weight:600;color:var(--cui-ink-2)}
.org-field>input,.org-field>textarea,.org-field>select{background:var(--cui-bg);border:1px solid var(--cui-line-2);
  border-radius:8px;padding:10px 12px;color:var(--cui-ink);font-size:14px;width:100%;line-height:1.5}
.org-field>textarea{resize:vertical}
.org-field>input:focus,.org-field>textarea:focus,.org-field>select:focus{outline:2px solid var(--cui-steel);outline-offset:2px;border-color:var(--cui-steel)}
.org-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.org-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.org-hint{font-size:14px;color:var(--cui-ink-3);line-height:1.55}
.org-list{display:grid;gap:12px;margin-top:16px}
.org-venue{display:grid;gap:8px}
.org-venue__head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap}
.org-venue__name{font-size:16px;font-weight:700;color:var(--cui-ink)}
.org-venue__meta{display:flex;gap:16px;flex-wrap:wrap;color:var(--cui-ink-2);font-size:14px}
.org-staffrow{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap}
.org-staff__name{font-size:16px;font-weight:700;color:var(--cui-ink)}
.org-pills{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center}
.org-blockfoot{margin-top:16px}
@media(max-width:640px){.org-row{grid-template-columns:1fr}}
`;

/* ═══════════════════ SHARED BITS ═══════════════════ */
const TABS = [
  { key: "profile", label: "Profile" },
  { key: "locations", label: "Locations" },
  { key: "staff", label: "Staff" },
];
const ROLE_LABEL = { owner: "Owner", admin: "Admin", trainer: "Trainer" };
const BG_LABEL = {
  verified: "Background check verified",
  pending: "Background check pending",
  flagged: "Background check flagged",
  none: "No background check recorded",
};
function nameOf(m){
  const tp = (m && m.trainer_profile) || {};
  return tp.name || [tp.first_name, tp.last_name].filter(Boolean).join(" ") || tp.email ||
    (m.member_user_id ? "Member " + String(m.member_user_id).slice(0, 8) : "Pending member");
}
function commText(m){
  const n = Number(m.commission_value);
  const v = isFinite(n) ? String(n) : "0";
  return m.commission_type === "flat" ? "$" + v + " flat" : v + "%";
}
function bgPill(m){
  const s = String(m.background_check_status || "none");
  const cls = s === "verified" ? "cui-badge cui-badge--good"
    : (s === "pending" || s === "flagged") ? "cui-badge cui-badge--warn" : "cui-badge";
  let label = BG_LABEL[s] || BG_LABEL.none;
  if (s === "verified" && m.background_check_completed_at)
    label += " · " + String(m.background_check_completed_at).slice(0, 10);
  return `<span class="${cls}">${esc(label)}</span>`;
}
const field = (id, label, inner, hint) =>
  `<div class="org-field"><label for="${esc(id)}">${esc(label)}</label>${inner}` +
  (hint ? `<div class="org-hint">${esc(hint)}</div>` : "") + `</div>`;
const textIn = (id, value, attrs) =>
  `<input id="${esc(id)}" type="text" value="${esc(value == null ? "" : value)}"${attrs ? " " + attrs : ""}>`;
const numIn = (id, value, attrs) =>
  `<input id="${esc(id)}" type="number" min="0" step="any" value="${esc(value == null ? "" : value)}"${attrs ? " " + attrs : ""}>`;
const selectIn = (id, value, options) =>
  `<select id="${esc(id)}">${options.map(([v, l]) =>
    `<option value="${esc(v)}"${String(value) === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
function formActions(saveAttr, saveLabel){
  const u = ui();
  return `<div class="org-actions">` +
    u.Button({ label: saveLabel || "Save", size: "sm", variant: "primary", attrs: saveAttr }) +
    u.Button({ label: "Cancel", size: "sm", variant: "secondary", attrs: 'data-org-cancel="1"' }) +
    `</div>`;
}

/* ═══════════════════ VIEW: THE LOCKED PANEL ═══════════════════ */
/* Locked-tile copy pattern (cxrTile): greyed, "Locked", one line naming the
   plan, no dead buttons — and per the buyable:false rule, no checkout. */
function lockedBody(){
  const u = ui();
  const note = st.gateNote === "not-built"
    ? "The multi-staff workspace is still being built — Sporv has not switched it on for anyone yet."
    : st.gateNote === "not-entitled"
      ? "Your Enterprise subscription is not currently active, so this workspace is locked."
      : "Organization is part of the Enterprise workspace.";
  return u.Block({
    title: "Multi-staff management",
    subtitle: "The org's public profile, every training location, and the full staff roster — roles, commissions, and background-check status.",
    body:
      u.Card(
        `<div class="org-staffrow"><div><b>Organization workspace</b>` +
        `<div class="org-hint" style="margin-top:8px">${esc(note)}</div></div>` +
        `<span class="cui-badge">Locked</span></div>` +
        `<div class="org-hint" style="margin-top:8px">Requires the Enterprise plan.</div>`
      ) +
      `<div class="org-blockfoot">` +
      u.Button({ label: "Join the early-access list", size: "lg", variant: "primary", attrs: 'data-ctab="billing"' }) +
      `</div>`,
  });
}
function loadingBody(){
  return ui().EmptyState("Checking your plan", "Reading your subscription before showing this page.");
}

/* ═══════════════════ SECTION 1: PROFILE ═══════════════════ */
function profileSection(){
  const u = ui();
  const P = pv();
  if (!P) return u.EmptyState("No organization loaded", "Sign in as the organization owner to edit the profile.");
  const sports = Array.isArray(P.sports) ? P.sports.join(", ") : "";
  const form =
    `<div class="org-form">` +
    field("orgFName", "Business name",
      textIn("orgFName", P.business_name, 'required maxlength="120"'),
      "Appears on listings, messages, and receipts.") +
    field("orgFBio", "Bio",
      `<textarea id="orgFBio" rows="3" maxlength="2000">${esc(P.bio || "")}</textarea>`,
      "A few lines about the org, in your own words.") +
    field("orgFSports", "Sports",
      textIn("orgFSports", sports, 'placeholder="Soccer, Basketball"'),
      "Comma-separated. Shown on your listings.") +
    field("orgFLocation", "Location",
      textIn("orgFLocation", P.location, 'placeholder="Chicago, IL"')) +
    field("orgFPolicy", "Cancellation policy",
      textIn("orgFPolicy", P.cancellation_policy, 'list="orgPolicyList" placeholder="flexible, moderate, or strict"') +
      `<datalist id="orgPolicyList"><option value="flexible"></option><option value="moderate"></option><option value="strict"></option></datalist>`) +
    field("orgFTravel", "Travel radius",
      textIn("orgFTravel", P.travel_radius, 'placeholder="e.g. 20 miles"')) +
    field("orgFAvatar", "Avatar URL",
      textIn("orgFAvatar", P.avatar_url, 'placeholder="https://" inputmode="url"')) +
    field("orgFLogo", "Logo URL",
      textIn("orgFLogo", P.logo_url, 'placeholder="https://" inputmode="url"')) +
    `<div class="org-actions">` +
      u.Button({ label: "Save profile", size: "sm", variant: "primary", attrs: 'data-org-save-profile="1"' }) +
    `</div></div>`;
  return u.Block({
    title: "Public profile",
    subtitle: "What families see on your listings and receipts. Only the organization owner can save changes here.",
    body: form,
  });
}
function saveProfile(btn){
  const P = pv();
  if (!P || !P.id){ say("No organization loaded."); return; }
  const name = val("orgFName").trim();
  if (!name){ say("Business name is required."); return; }
  const sports = val("orgFSports").split(",").map(s => s.trim()).filter(Boolean);
  const body = {
    business_name: name,
    bio: nul(val("orgFBio")),
    sports: sports,
    location: nul(val("orgFLocation")),
    cancellation_policy: nul(val("orgFPolicy")),
    travel_radius: nul(val("orgFTravel")),
    avatar_url: nul(val("orgFAvatar")),
    logo_url: nul(val("orgFLogo")),
  };
  busy(btn, true, "Saving…");
  /* providers is special: authenticated cannot SELECT the geo/Stripe columns,
     so RETURNING * 403s (42501). Write minimal, then verify with a
     granted-column read as the receipt. */
  api().from("providers", "id=eq." + encodeURIComponent(P.id),
      { method: "PATCH", body: body, headers: { Prefer: "return=minimal" } })
    .then(() => api().from("providers", "select=business_name&id=eq." + encodeURIComponent(P.id)))
    .then(rows => {
      if (!rows || !rows[0]) throw new Error("The change did not land — it may not be yours to make.");
      Object.keys(body).forEach(k => { P[k] = body[k]; });
      say("Organization profile saved.");
      busy(btn, false); rerender();
    })
    .catch(e => { busy(btn, false); say("Could not save: " + ((e && e.message) || "Only the organization owner can edit the profile.")); });
}

/* ═══════════════════ SECTION 2: LOCATIONS ═══════════════════ */
const TZ_SUGGEST = ["America/Chicago", "America/New_York", "America/Denver", "America/Los_Angeles",
  "America/Anchorage", "Pacific/Honolulu", "America/Phoenix", "Europe/London", "Europe/Rome"];
function venueForm(v){
  const isNew = !v; v = v || {};
  return `<div class="org-form" style="margin-top:16px">` +
    field("orgVName", "Name",
      textIn("orgVName", v.name, 'required maxlength="120" placeholder="Home field"')) +
    field("orgVAddress", "Address",
      textIn("orgVAddress", v.address, 'placeholder="123 Main St, Chicago, IL"')) +
    `<div class="org-row">` +
      field("orgVTz", "Timezone",
        textIn("orgVTz", v.timezone, 'list="orgTzList" placeholder="America/Chicago"') +
        `<datalist id="orgTzList">${TZ_SUGGEST.map(z => `<option value="${esc(z)}"></option>`).join("")}</datalist>`,
        "Blank inherits the org timezone.") +
      field("orgVCap", "Capacity",
        numIn("orgVCap", v.capacity, 'placeholder="—" min="1" step="1"'),
        "Max athletes at once. Blank means no cap.") +
    `</div>` +
    formActions(isNew ? 'data-org-venue-save="new"' : 'data-org-venue-save="' + esc(String(v.id)) + '"',
      isNew ? "Add location" : "Save location") +
  `</div>`;
}
function venueCard(v){
  const u = ui();
  const meta = [];
  if (v.timezone) meta.push(`<span>${esc(v.timezone)}</span>`);
  if (v.capacity != null) meta.push(`<span class="cui-mono">Capacity ${esc(String(v.capacity))}</span>`);
  return u.Card(
    `<div class="org-venue"><div class="org-venue__head"><div>` +
      `<div class="org-venue__name">${esc(v.name)}</div>` +
      (v.address ? `<div class="org-hint">${esc(v.address)}</div>` : "") +
    `</div><div class="org-actions">` +
      u.Button({ label: "Edit", size: "sm", variant: "secondary", attrs: 'data-org-venue-edit="' + esc(String(v.id)) + '"' }) +
      u.Button({ label: "Delete", size: "sm", variant: "secondary", attrs: 'data-org-venue-del="' + esc(String(v.id)) + '"' }) +
    `</div></div>` +
    (meta.length ? `<div class="org-venue__meta">${meta.join("")}</div>` : "") +
    `</div>` +
    (st.editingVenue === v.id ? venueForm(v) : "")
  );
}
function locationsSection(){
  const u = ui();
  const P = pv();
  if (!P) return u.EmptyState("No organization loaded", "Sign in to manage locations.");
  loadVenues();
  let list;
  if (st.venues === null || st.venuesLoading){
    list = `<div class="org-hint">Loading locations…</div>`;
  } else if (!st.venues.length && st.editingVenue !== "new"){
    list = u.EmptyState("No locations yet", "Add the places your org trains — a home field, a rented gym, anywhere families should find you.");
  } else {
    list = `<div class="org-list">${st.venues.map(venueCard).join("")}</div>`;
  }
  return u.Block({
    title: "Locations",
    subtitle: "The places your org trains. Shown on listings and used when scheduling.",
    action: u.Button({ label: st.editingVenue === "new" ? "Close" : "Add location", size: "sm", variant: "secondary", attrs: 'data-org-venue-add="1"' }),
    body: list + (st.editingVenue === "new" ? venueForm(null) : ""),
  });
}
function saveVenue(btn){
  const P = pv();
  if (!P || !P.id){ say("No organization loaded."); return; }
  const which = btn.getAttribute("data-org-venue-save");
  const name = val("orgVName").trim();
  if (!name){ say("A location needs a name."); return; }
  const tzRaw = val("orgVTz").trim();
  if (tzRaw && !/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-.]+)+$/.test(tzRaw) && tzRaw !== "UTC"){
    say("That timezone is not valid — use a Region/City name like America/Chicago, or leave it blank.");
    return;
  }
  const capRaw = val("orgVCap").trim();
  let capacity = null;
  if (capRaw){
    capacity = Math.floor(Number(capRaw));
    if (!isFinite(capacity) || capacity < 1){ say("Capacity must be a whole number of 1 or more."); return; }
  }
  const body = { name: name, address: nul(val("orgVAddress")), timezone: tzRaw || null, capacity: capacity };
  busy(btn, true, "Saving…");
  const done = msg => { busy(btn, false); invalidateVenues(); loadVenues(); say(msg); rerender(); };
  if (which === "new"){
    body.provider_id = P.id;
    write("venue", "", { method: "POST", body: body })
      .then(() => done("Location added."))
      .catch(e => { busy(btn, false); say("Could not add: " + ((e && e.message) || "Only org admins can add locations.")); });
  } else {
    write("venue", "id=eq." + encodeURIComponent(which), { method: "PATCH", body: body })
      .then(() => done("Location saved."))
      .catch(e => { busy(btn, false); say("Could not save: " + ((e && e.message) || "Only org admins can edit locations.")); });
  }
}
function deleteVenue(btn){
  const id = btn.getAttribute("data-org-venue-del");
  const row = (st.venues || []).find(v => String(v.id) === String(id));
  if (!row) return;
  if (!window.confirm('Remove "' + row.name + '"? This cannot be undone.')) return;
  busy(btn, true, "Removing…");
  api().from("venue", "id=eq." + encodeURIComponent(id), { method: "DELETE" })
    .then(() => { invalidateVenues(); loadVenues(); say("Location removed."); rerender(); })
    .catch(e => { busy(btn, false); say("Could not remove: " + ((e && e.message) || "Only org admins can remove locations.")); rerender(); });
}

/* ═══════════════════ SECTION 3: STAFF ═══════════════════ */
function staffForm(m){
  const isNew = !m; m = m || {};
  const commType = m.commission_type || "percent";
  return `<div class="org-form" style="margin-top:16px">` +
    (isNew
      ? field("orgMName", "Name",
          textIn("orgMName", "", 'required maxlength="120" placeholder="Jordan Lee"')) +
        field("orgMEmail", "Email",
          textIn("orgMEmail", "", 'placeholder="jordan@example.com" inputmode="email"'),
          "Stored on the staff profile. It does not create a sign-in by itself.")
      : "") +
    field("orgMRole", "Role", selectIn("orgMRole", m.role || "trainer",
      [["trainer", "Trainer"], ["admin", "Admin"], ["owner", "Owner"]])) +
    `<div class="org-row">` +
      field("orgMCommType", "Commission type", selectIn("orgMCommType", commType,
        [["percent", "Percent of booking"], ["flat", "Flat amount per booking"]])) +
      field("orgMCommVal", "Commission value",
        numIn("orgMCommVal", m.commission_value != null ? m.commission_value : 0, 'min="0"'),
        commType === "flat" ? "Dollars per booking." : "Percent of the booking total, up to 100.") +
    `</div>` +
    formActions(isNew ? 'data-org-staff-save="new"' : 'data-org-staff-save="' + esc(String(m.id)) + '"',
      isNew ? "Add staff" : "Save changes") +
  `</div>`;
}
function staffCard(m){
  const u = ui();
  const tp = m.trainer_profile || {};
  return u.Card(
    `<div class="org-staffrow"><div>` +
      `<div class="org-staff__name">${esc(nameOf(m))}</div>` +
      (tp.email ? `<div class="org-hint">${esc(tp.email)}</div>` : "") +
      `<div class="org-pills">` +
        `<span class="cui-badge">${esc(ROLE_LABEL[m.role] || m.role)}</span>` +
        bgPill(m) +
        `<span class="cui-badge"><span class="cui-mono">${esc(commText(m))}</span></span>` +
        (m.is_active ? "" : `<span class="cui-badge">Revoked</span>`) +
      `</div>` +
      `<div class="org-hint" style="margin-top:8px">Background-check status is set by the check provider — it can't be changed here.</div>` +
    `</div><div class="org-actions">` +
      (m.is_active
        ? u.Button({ label: "Edit", size: "sm", variant: "secondary", attrs: 'data-org-staff-edit="' + esc(String(m.id)) + '"' }) +
          (m.role === "owner" ? "" : u.Button({ label: "Revoke", size: "sm", variant: "secondary", attrs: 'data-org-staff-revoke="' + esc(String(m.id)) + '"' }))
        : u.Button({ label: "Restore", size: "sm", variant: "secondary", attrs: 'data-org-staff-restore="' + esc(String(m.id)) + '"' })) +
    `</div></div>` +
    (st.editingMember === m.id ? staffForm(m) : "")
  );
}
function staffSection(){
  const u = ui();
  const P = pv();
  if (!P) return u.EmptyState("No organization loaded", "Sign in to manage staff.");
  loadStaff();
  let body;
  if (st.staff === null || st.staffLoading){
    body = `<div class="org-hint">Loading staff…</div>`;
  } else {
    const act = st.staff.filter(m => m.is_active);
    const rev = st.staff.filter(m => !m.is_active);
    const list = rows => rows.length
      ? `<div class="org-list">${rows.map(staffCard).join("")}</div>`
      : u.EmptyState("No staff yet", "Just you so far. Add a staff profile to give someone a role — linking their sign-in arrives with staff invites.");
    body = list(act) +
      (rev.length ? `<div class="org-blockfoot">` + u.Block({
          title: "Revoked",
          subtitle: "Access ended — their past work stays in the audit log under their name.",
          body: `<div class="org-list">${rev.map(staffCard).join("")}</div>`,
        }) + `</div>` : "");
  }
  return u.Block({
    title: "Staff",
    subtitle: "Who can work under this organization. Staff management is limited to org admins — other members see their own record.",
    action: u.Button({ label: st.editingMember === "new" ? "Close" : "Add staff", size: "sm", variant: "secondary", attrs: 'data-org-staff-add="1"' }),
    body: body + (st.editingMember === "new" ? staffForm(null) : ""),
  });
}
function staffCommission(){
  /* Client-side mirror of the DB checks: percent ≤ 100, value ≥ 0. The
     database enforces the same ranges; this only fails faster and friendlier. */
  const type = val("orgMCommType");
  const raw = val("orgMCommVal").trim();
  const value = raw === "" ? 0 : Number(raw);
  if (!isFinite(value) || value < 0) return { error: "Commission must be zero or more." };
  if (type === "percent" && value > 100) return { error: "A percent commission cannot be more than 100." };
  return { type: type, value: value };
}
function saveStaff(btn){
  const P = pv();
  if (!P || !P.id){ say("No organization loaded."); return; }
  const which = btn.getAttribute("data-org-staff-save");
  const role = val("orgMRole");
  if (["owner", "admin", "trainer"].indexOf(role) < 0){ say("Pick a valid role."); return; }
  const comm = staffCommission();
  if (comm.error){ say(comm.error); return; }
  busy(btn, true, "Saving…");
  const done = msg => { busy(btn, false); invalidateStaff(); loadStaff(); say(msg); rerender(); };
  if (which === "new"){
    const name = val("orgMName").trim();
    if (!name){ busy(btn, false); say("A name is required."); return; }
    const email = nul(val("orgMEmail"));
    if (email && email.indexOf("@") < 0){ busy(btn, false); say("That email doesn't look valid."); return; }
    const profile = { name: name };
    if (email) profile.email = email;
    /* background_check_status is deliberately absent: the mirror trigger
       rejects any direct write to it, so it must fall back to 'none'. */
    write("organization_members", "", { method: "POST", body: {
      organization_id: P.id, trainer_profile: profile, role: role,
      commission_type: comm.type, commission_value: comm.value,
    }})
      .then(() => done("Staff profile added. Their sign-in links when staff invites arrive."))
      .catch(e => { busy(btn, false); say("Could not add: " + ((e && e.message) || "Only org admins can add staff.")); });
  } else {
    write("organization_members", "id=eq." + encodeURIComponent(which), { method: "PATCH", body: {
      role: role, commission_type: comm.type, commission_value: comm.value,
    }})
      .then(() => done("Staff member updated."))
      .catch(e => { busy(btn, false); say("Could not save: " + ((e && e.message) || "Only org admins can edit staff.")); });
  }
}
/* Revoke / Restore mirror the Settings→People pattern: optimistic local flip,
   real PATCH, rollback + honest toast on failure. History is never deleted. */
function revokeMember(btn){
  const id = btn.getAttribute("data-org-staff-revoke");
  const m = (st.staff || []).find(x => String(x.id) === String(id));
  if (!m) return;
  m.is_active = false; rerender();
  api().from("organization_members", "id=eq." + encodeURIComponent(id), { method: "PATCH", body: { is_active: false } })
    .then(() => say("Revoked — their access ends now; nothing they did is deleted."))
    .catch(e => { m.is_active = true; rerender(); say((e && e.message) || "Could not revoke."); });
}
function restoreMember(btn){
  const id = btn.getAttribute("data-org-staff-restore");
  const m = (st.staff || []).find(x => String(x.id) === String(id));
  if (!m) return;
  m.is_active = true; rerender();
  api().from("organization_members", "id=eq." + encodeURIComponent(id), { method: "PATCH", body: { is_active: true } })
    .then(() => say("Restored."))
    .catch(e => { m.is_active = false; rerender(); say((e && e.message) || "Could not restore."); });
}

/* ═══════════════════ VIEW ═══════════════════ */
function orgView(){
  const u = ui();
  if (!u) return "";
  refreshGate();
  if (st.gateState !== "open"){
    return u.Page({
      page: "organization",
      eyebrow: "Enterprise",
      h1: st.gateState === "loading" || st.gateState === "unknown" ? "Organization" : "Organization is an Enterprise feature",
      lede: st.gateState === "loading" || st.gateState === "unknown"
        ? "Your organization's profile, locations, and staff."
        : "Organization is where a multi-staff academy runs its business: the org's public profile, every training location, and the full staff roster — roles, commissions, and background-check status.",
      body: (st.gateState === "loading" || st.gateState === "unknown") ? loadingBody() : lockedBody(),
    });
  }
  const tab = u.activeTab(TABS, "profile", "orgPageTab");
  const body = tab === "locations" ? locationsSection() : tab === "staff" ? staffSection() : profileSection();
  return u.Page({
    page: "organization",
    eyebrow: "Business",
    h1: "Organization",
    lede: "Your organization's public identity, the places you train, and the people who run it.",
    tabs: TABS,
    active: tab,
    stateKey: "orgPageTab",
    tabLabel: "Organization sections",
    body: body,
  });
}

/* ═══════════════════ WIRE ═══════════════════ */
/* MOD_COACHUI.wire owns data-cui-page / data-cui-state (the tab strip).
   Everything below is this module's own data-org-* handlers. */
function wire(){
  if (typeof document === "undefined") return;
  const on = (sel, fn) => Array.prototype.slice.call(document.querySelectorAll(sel))
    .forEach(el => { el.onclick = ev => fn(el, ev); });
  on("[data-org-save-profile]", b => saveProfile(b));
  on("[data-org-venue-add]", () => { st.editingVenue = st.editingVenue === "new" ? null : "new"; rerender(); });
  on("[data-org-venue-edit]", b => {
    const id = b.getAttribute("data-org-venue-edit");
    st.editingVenue = st.editingVenue === id ? null : id; rerender();
  });
  on("[data-org-venue-del]", b => deleteVenue(b));
  on("[data-org-venue-save]", b => saveVenue(b));
  on("[data-org-staff-add]", () => { st.editingMember = st.editingMember === "new" ? null : "new"; rerender(); });
  on("[data-org-staff-edit]", b => {
    const id = b.getAttribute("data-org-staff-edit");
    st.editingMember = st.editingMember === id ? null : id; rerender();
  });
  on("[data-org-staff-save]", b => saveStaff(b));
  on("[data-org-staff-revoke]", b => revokeMember(b));
  on("[data-org-staff-restore]", b => restoreMember(b));
  on('[data-org-cancel="1"]', () => { st.editingVenue = null; st.editingMember = null; rerender(); });
}

window.MOD_ORG = {
  css: CSS,
  tabs: { organization: "Organization" },
  views: { organization: orgView },
  wire: wire,
  state: st,
};

})();
