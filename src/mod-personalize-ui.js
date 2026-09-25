"use strict";
/* ═══════════════════════════════════════════════════════════════════
   MOD_PERSONALIZE_UI — the user-visible personalization surfaces
   (spec 30-PERSONALIZATION.md).

   The engine (mod-personalization.js) is pure logic on
   window.SporvPersonalization. This module renders it:

     1. Onboarding — four screens: template, five questions,
        skippable connections/imports, generated workspace.
     2. Dock proposal cards — a coach's plain-words request becomes a
        proposal card with preview, scope, Apply / Tweak / Cancel.
     3. Settings → Personal — the five per-person layers.
     4. Settings → Workspace — template, modules, chatbox config,
        version history and undo.

   Frontend-only: everything persists to localStorage under the
   engine's own key until the backend phase is authorized. Personal
   rows are labelled "Saved on this device" so nobody mistakes them
   for server state.

   Host contract used (never redefined here):
     S, render(), toast(), esc(), go(), coachSettingsPage dispatch,
     aiDockHTML message rendering, wire() module hook.
   ═══════════════════════════════════════════════════════════════════ */
(function(){
const G = typeof globalThis !== "undefined" ? globalThis : this;
const P = () => (G.SporvPersonalization || null);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
  (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* ── module state (lives in S so it survives re-render) ── */
function st(){
  if (!S.pers) S.pers = {
    obStep: 0,
    ob: { templateId:null, orgName:"", runsWhat:"", rosterSize:"", sport:"", commStyle:"calm",
          rosterChoice:"skip", calChoice:"skip", inboxChoice:"skip" },
    tweakFor: null,          // proposal id with the tweak editor open
    tweakText: "",
    histOpen: false,
  };
  return S.pers;
}
const role = () => "owner";   // single-owner workspaces today; roles arrive with the backend phase
const author = () => (S.coachProvider && S.coachProvider.id) || "local";
function cfg(){ const p = P(); return p ? (p.currentConfig() || null) : null; }
function seeded(){ return !!cfg(); }

/* ═══════════════ CSS ═══════════════ */
const css = `
/* personalization: onboarding */
.pob-wrap{max-width:760px;margin:34px auto 60px;padding:0 20px}
.pob-banner{max-width:1200px;margin:0 0 24px;padding:16px 24px;border:1px solid var(--rule);border-radius:12px;background:var(--panel,var(--raise));display:flex;align-items:center;gap:24px;justify-content:space-between}
.pob-banner b{font-size:16px;font-weight:700;display:block;margin-bottom:4px}
.pob-banner p{font-size:14px;color:var(--muted);margin:0;max-width:640px}
.pob-banner .btn{flex:none}
.pob-eyebrow{font-size:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
.pob-wrap h1{font-size:30px;line-height:1.2;margin:0 0 8px}
.pob-sub{font-size:15px;color:var(--muted);margin:0 0 26px;max-width:56ch}
.pob-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:0 0 26px}
@media(max-width:640px){.pob-grid{grid-template-columns:1fr 1fr}}
.pob-tcard{text-align:left;background:var(--raise);border:1px solid var(--rule);border-radius:12px;padding:16px;cursor:pointer;font-family:var(--sans)}
.pob-tcard b{display:block;font-size:15px;margin-bottom:6px}
.pob-tcard span{font-size:14px;color:var(--muted);line-height:1.45;display:block}
.pob-tcard[aria-pressed="true"]{border-color:var(--ink);box-shadow:0 0 0 1px var(--ink)}
.pob-tcard small{display:block;margin-top:10px;font-size:14px;color:var(--muted)}
/* 44px minimum touch target on every personalization surface. The host's
   .btn.sm is 42px; these flows keep the compact look but never go under. */
.pob-wrap .btn{min-height:44px}
.sthead .btn,.stcard .btn{min-height:44px}
.pob-q{margin:0 0 18px}
.pob-q label{display:block;font-size:15px;font-weight:700;margin-bottom:8px}
.pob-q input[type=text],.pob-q select{width:100%;max-width:420px;font-size:15px;font-family:var(--sans);padding:10px 12px;border:1px solid var(--rule);border-radius:8px;background:var(--raise);color:var(--ink)}
.pob-seg{display:flex;gap:8px;flex-wrap:wrap}
.pob-seg button{font-size:14px;font-family:var(--sans);padding:9px 14px;border:1px solid var(--rule);border-radius:999px;background:var(--raise);color:var(--ink);cursor:pointer}
.pob-seg button[aria-pressed="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.pob-row{display:flex;gap:10px;align-items:center;margin-top:26px;flex-wrap:wrap}
.pob-skip{background:none;border:none;color:var(--muted);font-size:15px;cursor:pointer;font-family:var(--sans);text-decoration:underline;text-underline-offset:3px}
.pob-conn{display:flex;gap:14px;align-items:flex-start;background:var(--raise);border:1px solid var(--rule);border-radius:12px;padding:16px;margin-bottom:12px}
.pob-conn b{display:block;font-size:15px;margin-bottom:4px}
.pob-conn p{font-size:14px;color:var(--muted);margin:0}
.pob-conn .pob-seg{margin-left:auto;flex:none}
.pob-done{background:var(--raise);border:1px solid var(--rule);border-radius:12px;padding:20px;margin-bottom:12px}
.pob-done b{display:block;font-size:15px;margin-bottom:6px}
.pob-done p{font-size:14px;color:var(--muted);margin:0}
.pob-prog{display:flex;gap:6px;margin-bottom:22px}
.pob-prog i{height:4px;flex:1;border-radius:2px;background:var(--rule)}
.pob-prog i.on{background:var(--ink)}
/* personalization: proposal card in the dock */
.ppcard{background:var(--raise);border:1px solid var(--rule);border-radius:12px;padding:14px;margin-top:4px}
.ppcard-head{font-size:14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.ppcard-title{font-size:15px;font-weight:700;margin:0 0 4px}
.ppcard-scope{font-size:14px;color:var(--muted);margin:0 0 10px}
.ppcard ul{margin:0 0 10px;padding-left:20px;font-size:14px}
.ppcard li{margin-bottom:4px}
.ppcard-err{background:rgba(180,40,40,.08);border:1px solid rgba(180,40,40,.3);border-radius:8px;padding:10px 12px;font-size:14px;margin:0 0 10px}
.ppcard-row{display:flex;gap:8px;flex-wrap:wrap}
.ppcard textarea{width:100%;font-size:14px;font-family:var(--sans);padding:10px;border:1px solid var(--rule);border-radius:8px;background:var(--bg);color:var(--ink);margin:0 0 10px;min-height:70px}
/* personalization: settings additions */
.ps-note{font-size:14px;color:var(--muted);margin:-6px 0 16px}
.ps-dev{font-size:14px;color:var(--muted);margin-top:8px}
`;

/* Inject the stylesheet once. Without this the module renders unstyled. */
function injectCSS(){
  if (typeof document === "undefined") return;
  if (document.getElementById("sporv-personalize-css")) return;
  const el = document.createElement("style");
  el.id = "sporv-personalize-css";
  el.textContent = css;
  document.head.appendChild(el);
}

/* ═══════════════ ONBOARDING — four screens ═══════════════
   Screen 1: template. Screen 2: five questions. Screen 3: skippable
   connections/imports. Screen 4: generated workspace, chatbox open. */
const TEMPLATE_ORDER = ["solo_trainer","team_coach","camp","facility","club","enterprise"];

function onboardView(){
  const s = st(), p = P();
  if (!p) return `<div class="pob-wrap"><div class="pob-eyebrow">Setup</div><h1>Setup is unavailable right now.</h1><p class="pob-sub">The personalization engine did not load. Reload the page and try again.</p></div>`;
  const step = s.obStep;
  const prog = `<div class="pob-prog" aria-hidden="true">${[0,1,2,3].map(i=>`<i class="${i<=step?"on":""}"></i>`).join("")}</div>`;
  let body = "";
  if (step === 0) body = obScreenTemplate(s, p);
  else if (step === 1) body = obScreenQuestions(s, p);
  else if (step === 2) body = obScreenConnections(s);
  else body = obScreenDone(s, p);
  return `<div class="pob-wrap">${prog}${body}</div>`;
}

function obScreenTemplate(s, p){
  const cards = TEMPLATE_ORDER.map(id => {
    const t = p.TEMPLATES[id];
    const mods = (t.modulesOn || []).length;
    return `<button type="button" class="pob-tcard" data-ob-tpl="${id}" aria-pressed="${s.ob.templateId===id}">` +
      `<b>${esc(t.name)}</b><span>${esc(t.description)}</span>` +
      `<small>${mods} add-on module${mods===1?"":"s"} on · ${esc(t.billingShape||"")}</small></button>`;
  }).join("");
  return `<div class="pob-eyebrow">Setup · 1 of 4</div>
    <h1>What best describes you.</h1>
    <p class="pob-sub">This sets your starting workspace. Every template has the same capabilities — it only changes what is switched on first. You can change it any time.</p>
    <div class="pob-grid" role="group" aria-label="Choose a template">${cards}</div>
    <div class="pob-row">
      <button type="button" class="btn sm" data-ob-next="1" ${s.ob.templateId?"":"disabled"}>Continue</button>
    </div>`;
}

function obScreenQuestions(s, p){
  const o = s.ob;
  const seg = (key, opts) => `<div class="pob-seg" role="group" aria-label="${esc(key)}">` +
    opts.map(([v,l]) => `<button type="button" data-ob-q="${key}" data-v="${esc(v)}" aria-pressed="${o[key]===v}">${esc(l)}</button>`).join("") + `</div>`;
  const tplName = o.templateId ? p.TEMPLATES[o.templateId].name : "your workspace";
  return `<div class="pob-eyebrow">Setup · 2 of 4</div>
    <h1>Five quick questions.</h1>
    <p class="pob-sub">These shape ${esc(tplName)} around your real roster, schedule, and services. Nothing here is final.</p>
    <div class="pob-q"><label for="obOrg">Organization or business name</label>
      <input type="text" id="obOrg" data-ob-field="orgName" value="${esc(o.orgName)}" placeholder="Northside Basketball Academy" autocomplete="organization"></div>
    <div class="pob-q"><label>What do you run</label>
      ${seg("runsWhat",[["sessions","1-on-1 sessions"],["teams","Teams"],["camps","Camps / clinics"],["facility","A facility"],["mixed","A mix"]])}</div>
    <div class="pob-q"><label>Athletes on your roster</label>
      ${seg("rosterSize",[["1-25","1–25"],["26-100","26–100"],["101-500","101–500"],["500+","500+"]])}</div>
    <div class="pob-q"><label for="obSport">Primary sport</label>
      <input type="text" id="obSport" data-ob-field="sport" value="${esc(o.sport)}" placeholder="Basketball" autocomplete="off"></div>
    <div class="pob-q"><label>How should Sporv sound to your people</label>
      ${seg("commStyle",[["calm","Calm and plain"],["direct","Short and direct"],["warm","Warm and personal"]])}</div>
    <div class="pob-row">
      <button type="button" class="btn ghost sm" data-ob-next="0">Back</button>
      <button type="button" class="btn sm" data-ob-next="2">Continue</button>
    </div>`;
}

function obScreenConnections(s){
  const o = s.ob;
  const connRow = (key, title, sub) => {
    const v = o[key];
    return `<div class="pob-conn"><div><b>${esc(title)}</b><p>${esc(sub)}</p></div>
      <div class="pob-seg">
        <button type="button" data-ob-conn="${key}" data-v="later" aria-pressed="${v==="later"}">Remind me</button>
        <button type="button" data-ob-conn="${key}" data-v="skip" aria-pressed="${v==="skip"}">Skip</button>
      </div></div>`;
  };
  return `<div class="pob-eyebrow">Setup · 3 of 4</div>
    <h1>Connect what you want.</h1>
    <p class="pob-sub">Each one gives the agent something real to work with. Skip anything — nothing here blocks setup.</p>
    ${connRow("rosterChoice","Bring your roster","Import athletes from a file. Names and groups only — medical details stay out.")}
    ${connRow("calChoice","Connect your calendar","Sessions and availability read from your real calendar.")}
    ${connRow("inboxChoice","Connect your inbox","Drafts and follow-ups reference real threads.")}
    <div class="pob-row">
      <button type="button" class="btn ghost sm" data-ob-next="1">Back</button>
      <button type="button" class="btn sm" data-ob-next="3">Continue</button>
      <button type="button" class="pob-skip" data-ob-next="3">Skip all for now</button>
    </div>`;
}

function obScreenDone(s, p){
  const o = s.ob;
  const t = o.templateId ? p.TEMPLATES[o.templateId] : null;
  const lines = [];
  if (t) lines.push(["Template", t.name + " — " + (t.modulesOn||[]).length + " add-on modules on."]);
  if (o.orgName) lines.push(["Organization", o.orgName]);
  if (o.runsWhat) lines.push(["You run", {sessions:"1-on-1 sessions",teams:"Teams",camps:"Camps and clinics",facility:"A facility",mixed:"A mix"}[o.runsWhat] || o.runsWhat]);
  if (o.rosterSize) lines.push(["Roster", o.rosterSize + " athletes."]);
  if (o.sport) lines.push(["Sport", o.sport]);
  lines.push(["Assistant tone", {calm:"Calm and plain.",direct:"Short and direct.",warm:"Warm and personal."}[o.commStyle] || o.commStyle]);
  const pending = [["rosterChoice","Roster import"],["calChoice","Calendar"],["inboxChoice","Inbox"]]
    .filter(([k]) => o[k]==="later").map(([,l]) => l);
  if (pending.length) lines.push(["Remind me about", pending.join(", ") + "."]);
  return `<div class="pob-eyebrow">Setup · 4 of 4</div>
    <h1>Your workspace is ready.</h1>
    <p class="pob-sub">Built from your answers. The assistant opens beside it — ask for anything in plain words and it proposes the change before touching anything.</p>
    ${lines.map(([k,v]) => `<div class="pob-done"><b>${esc(k)}</b><p>${esc(v)}</p></div>`).join("")}
    <div class="pob-row">
      <button type="button" class="btn ghost sm" data-ob-next="2">Back</button>
      <button type="button" class="btn sm" data-ob-finish="1">Open my workspace</button>
    </div>`;
}

/* Apply the onboarding answers: seed the template, then commit the
   answers as version 1 so history shows exactly what setup wrote. */
function finishOnboarding(){
  const s = st(), p = P(), o = s.ob;
  if (!p || !o.templateId) return;
  p.seedWorkspace(o.templateId, author());
  const ops = [];
  if (o.orgName) ops.push({ op:"replace", path:"identity.orgName", value:o.orgName });
  if (o.sport) ops.push({ op:"replace", path:"identity.sport", value:o.sport });
  if (o.commStyle) ops.push({ op:"replace", path:"agent.voice", value:o.commStyle });
  if (o.runsWhat || o.rosterSize){
    const note = [o.runsWhat, o.rosterSize ? o.rosterSize + " athletes" : null].filter(Boolean).join(", ");
    if (note) ops.push({ op:"replace", path:"identity.profile", value:note });
  }
  if (ops.length){
    const cur = p.currentConfig() || {};
    const patched = p.applyPatchOps(cur, ops).config;
    p.commitConfig(patched, { author:author(), source:"onboarding", request:"setup answers", ops });
  }
  /* reset the wizard so a later visit starts clean */
  s.obStep = 0;
  s.ob = { templateId:null, orgName:"", runsWhat:"", rosterSize:"", sport:"", commStyle:"calm",
           rosterChoice:"skip", calChoice:"skip", inboxChoice:"skip" };
  S.coachTab = "dashboard";
  S.aiOpen = true; S.aiMax = false; S.aiFull = false;
  toast("Workspace ready.");
  render();
}

/* ═══════════════ DOCK — proposal cards ═══════════════
   Called from the dock send flow (host), next to coachDemoProposal.
   A plain-words personalization request becomes a proposal card on the
   assistant's reply. Anything the classifier does not understand falls
   through to the normal server path — this never swallows a message. */
function persProposalFor(text){
  const p = P();
  if (!p || !seeded()) return null;
  let r;
  try { r = p.proposeChange(text, { role:role(), config:cfg() || {} }); }
  catch(e){ return null; }
  if (r.refusal) return { reply:r.refusal, persProposal:null, refused:true };
  if (r.clarify) return { reply:r.clarify, persProposal:null, clarify:true };
  if (r.unmatched || !r.proposal) return null;
  const prop = r.proposal;
  const reply = prop.summary
    ? "Here is the change as I understand it. Nothing changes until you approve."
    : "Here is a proposal. Nothing changes until you approve.";
  return { reply, persProposal:prop };
}

/* Rendered inside aiDockHTML for messages carrying m.persProposal. */
function persPropCardHTML(prop, i){
  const p = P();
  const s = st();
  const tweaking = s.tweakFor === prop.id;
  if (prop.status === "applied" || prop.status === "cancelled"){
    return `<div class="ppcard" data-pers-card="${esc(prop.id)}">
      <div class="ppcard-head">Proposed change</div>
      <p class="ps-note" style="margin:0">${prop.status === "applied" ? "Applied." : "Cancelled."} ${esc(prop.summary || "")}</p>
    </div>`;
  }
  return `<div class="ppcard" data-pers-card="${esc(prop.id)}">
    <div class="ppcard-head">Proposed change — nothing changes until you approve</div>
    ${p ? p.previewHTML(prop) : ""}
    ${tweaking ? `<label class="ps-dev" for="persTweak${i}">Describe the change in your own words</label>
      <textarea id="persTweak${i}" data-pers-tweaktext="${esc(prop.id)}" aria-label="Describe the change in your own words">${esc(s.tweakText)}</textarea>
      <div class="ppcard-row">
        <button type="button" class="btn sm" data-pers-tweakgo="${esc(prop.id)}">Propose the tweak</button>
        <button type="button" class="btn ghost sm" data-pers-tweakcancel="${esc(prop.id)}">Back</button>
      </div>` : ""}
  </div>`;
}

/* Apply / Tweak / Cancel actions. Apply uses compare-and-swap: a stale
   preview shows the diff instead of overwriting. */
function persApply(id){
  const p = P();
  if (!p) return;
  const r = p.applyProposal(id, { role:role(), author:author() });
  if (r.conflict){
    toast("The workspace changed since this preview.");
    S.chat = [...S.chat, { role:"coach",
      text:"This preview is stale — the workspace changed underneath it. " + r.message + " " + (r.diff || ""),
      persProposal:null }];
    render();
    return;
  }
  if (!r.ok){
    toast("Could not apply: " + (r.errors || ["unknown error"]).join(" "));
    return;
  }
  markProposalDone(id, "applied");
  toast("Change applied. Undo is in Settings, Workspace.");
  render();
}
function persCancel(id){
  markProposalDone(id, "cancelled");
  render();
}
function markProposalDone(id, status){
  for (const m of S.chat){
    if (m.persProposal && m.persProposal.id === id){ m.persProposal.status = status; }
  }
  if (st().tweakFor === id){ st().tweakFor = null; st().tweakText = ""; }
}
function persTweakOpen(id){
  const s = st();
  s.tweakFor = id;
  s.tweakText = "";
  render();
  const ta = document.querySelector(`[data-pers-tweaktext="${id}"]`);
  if (ta) ta.focus();
}
/* Leaving tweak mode keeps the proposal pending — it does not cancel it. */
function persTweakCancel(id){
  const s = st();
  if (s.tweakFor === id){ s.tweakFor = null; s.tweakText = ""; }
  render();
}
function persTweakGo(id){
  const p = P();
  const ta = document.querySelector(`[data-pers-tweaktext="${id}"]`);
  const text = ta ? ta.value.trim() : "";
  if (!text){ toast("Describe the tweak first."); return; }
  /* A tweak is a new proposal; the old one is cancelled so history is honest. */
  markProposalDone(id, "cancelled");
  const r = p.proposeChange(text, { role:role(), config:cfg() || {} });
  if (r.proposal){
    S.chat = [...S.chat, { role:"coach", text:"Here is the tweaked proposal. Nothing changes until you approve.", persProposal:r.proposal }];
  } else if (r.refusal || r.clarify){
    S.chat = [...S.chat, { role:"coach", text:r.refusal || r.clarify }];
  } else {
    S.chat = [...S.chat, { role:"coach", text:"I could not turn that tweak into a change. Say it another way." }];
  }
  st().tweakFor = null; st().tweakText = "";
  render();
}

/* ═══════════════ SETTINGS → PERSONAL — the five per-person layers ═══════════════
   Rendered by the host's settings dispatch. Every control writes to the
   personal store (this device). Comfort controls are never gated: this tab
   renders for every role. */
function personalSettingsHTML(){
  const p = P();
  const cfgNow = cfg();
  const per = p ? p.getPersonal() : null;
  if (!p || !per){
    return `<div class="sthead"><h2>Personal</h2><p>Your own layer of Sporv.</p></div>
      <div class="stcard"><p style="font-size:15px">Personal settings are unavailable until the workspace is set up.</p>
      ${seeded() ? "" : `<button class="btn sm" data-ctab="personalize-onboard">Run setup</button>`}</div>`;
  }
  const tplName = cfgNow && cfgNow.templateId && p.TEMPLATES[cfgNow.templateId]
    ? p.TEMPLATES[cfgNow.templateId].name : "Not set up yet";
  const mods = cfgNow && cfgNow.modulesOn ? cfgNow.modulesOn.length : 0;
  const row = (b, small, ctl) => `<div class="strow"><div class="stlab"><b>${b}</b>${small?`<small>${small}</small>`:""}</div><div class="stctl">${ctl}</div></div>`;
  const seg = (name, val, opts) => `<span class="stseg" data-pers-seg="${name}">` +
    opts.map(([v,l]) => `<button type="button" data-v="${v}" class="${val===v?"on":""}">${l}</button>`).join("") + `</span>`;
  const mem = per.memory || { enabled:true, items:[] };

  return `<div class="sthead"><h2>Personal</h2><p>Your own layer of Sporv. These change Sporv for you only — never for anyone else. Saved on this device.</p></div>

  <div class="sthead" style="margin-top:22px"><h2>Organization baseline</h2><p>What your workspace starts from. Read-only here — change it in Workspace.</p></div>
  <div class="stcard">
    ${row("Template", "", `<span class="stro">${esc(tplName)}</span>`)}
    ${row("Add-on modules on", "", `<span class="stro num">${mods}</span>`)}
  </div>

  <div class="sthead" style="margin-top:22px"><h2>Role defaults</h2><p>What your role can see. Read-only here.</p></div>
  <div class="stcard">
    ${row("Your role", "", `<span class="stro">Owner</span>`)}
    ${row("Can see", "", `<span class="stro">Everything in this workspace</span>`)}
  </div>

  <div class="sthead" style="margin-top:22px"><h2>Private preferences</h2><p>Layout and notifications, yours alone.</p></div>
  <div class="stcard">
    ${row("Density", "Comfortable breathes. Compact fits more on screen.", seg("density", per.layout.density, [["comfortable","Comfortable"],["compact","Compact"]]))}
    ${row("Home tab", "Where you land after signing in.", seg("homeTab", per.layout.homeTab, [["dashboard","Home"],["schedule","Schedule"],["inbox","Messages"]]))}
    ${row("Quiet hours", "No notifications in this window.", `<input type="time" class="stin" data-pers-time="quietStart" value="${esc(per.notifications.quietStart)}" style="width:110px" aria-label="Quiet hours start"> <span class="stmut">to</span> <input type="time" class="stin" data-pers-time="quietEnd" value="${esc(per.notifications.quietEnd)}" style="width:110px" aria-label="Quiet hours end">`)}
    ${row("Payment alerts", "", seg("paymentAlerts", String(per.notifications.paymentAlerts), [["true","On"],["false","Off"]]))}
    ${row("Draft alerts", "When the agent queues a draft for you.", seg("draftAlerts", String(per.notifications.draftAlerts), [["true","On"],["false","Off"]]))}
  </div>

  <div class="sthead" style="margin-top:22px"><h2>AI instructions</h2><p>Explicit instructions the assistant follows for you. They beat everything except safety rules.</p></div>
  <div class="stcard">
    ${row("Tone", "", seg("tone", per.aiProfile.tone, [["calm","Calm"],["direct","Direct"],["warm","Warm"]]))}
    ${row("Format", "How answers are shaped.", seg("format", per.aiProfile.format, [["bullets","Bullets"],["paragraphs","Paragraphs"]]))}
    ${row("Sign-off", "Appended to messages the agent drafts for you.", `<input type="text" class="stin" data-pers-text="signoff" value="${esc(per.aiProfile.signoff)}" placeholder="— Coach" style="max-width:280px">`)}
    ${row("What to call athletes", "Overrides the template's word for you only.", `<input type="text" class="stin" data-pers-text="personWord" value="${esc((per.aiProfile.vocabulary||{}).person||"")}" placeholder="players" style="max-width:200px">`)}
  </div>

  <div class="sthead" style="margin-top:22px"><h2>Learned memory</h2><p>What Sporv has learned about how you work. Inspect, edit, or delete anything. Turning it off stops new learning — existing items stay until you delete them.</p></div>
  <div class="stcard">
    ${row("Learning", "", seg("memoryEnabled", String(mem.enabled), [["true","On"],["false","Off"]]))}
    ${(mem.items||[]).length ? mem.items.map(it => {
      const editing = st().memEditing === it.id;
      const body = editing
        ? `<input type="text" class="stin" data-pers-meminput="${esc(it.id)}" value="${esc(it.text)}" aria-label="Edit memory" style="max-width:320px">
           <div class="stctl"><button type="button" class="btn sm" data-pers-memsave="${esc(it.id)}">Save</button>
           <button type="button" class="btn ghost sm" data-pers-memcancel>Cancel</button></div>`
        : `<b style="font-weight:400">${esc(it.text)}</b>
           <div class="stctl"><button type="button" class="btn ghost sm" data-pers-memedit="${esc(it.id)}">Edit</button>
           <button type="button" class="btn ghost sm" data-pers-memdel="${esc(it.id)}">Delete</button></div>`;
      return `<div class="strow"><div class="stlab">${body}<small>Learned ${esc((it.at||"").slice(0,10))}</small></div></div>`;
    }).join("")
      : `<p class="ps-note" style="margin:12px 0 0">Nothing learned yet. As you work, Sporv notes durable preferences here — each one editable.</p>`}
  </div>
  <p class="ps-dev">Personal settings live on this device until the backend phase ships. They never change anyone else's view.</p>`;
}

/* ═══════════════ SETTINGS → WORKSPACE — org baseline, history, chatbox ═══════════════
   Modules, pages, roles, vocabulary, version history/undo, and the chatbox
   appearance/targeting/handoff/data layers. Writes here go through proposals
   where they touch governance (modules, roles, vocabulary); simple fields
   commit directly with history. */
function workspaceSettingsHTML(){
  const p = P();
  const cfgNow = cfg();
  if (!p || !seeded() || !cfgNow){
    return `<div class="sthead"><h2>Workspace</h2><p>How your whole workspace is configured.</p></div>
      <div class="stcard"><p style="font-size:15px">Run setup first — this tab configures a workspace that exists.</p>
      <button class="btn sm" data-ctab="personalize-onboard">Run setup</button></div>`;
  }
  const mods = (p.TEMPLATES[cfgNow.templateId] ? Object.keys(p.MODULES) : []);
  const modList = Object.keys(p.MODULES).sort();
  const on = new Set(cfgNow.modulesOn || []);
  const row = (b, small, ctl) => `<div class="strow"><div class="stlab"><b>${b}</b>${small?`<small>${small}</small>`:""}</div><div class="stctl">${ctl}</div></div>`;
  const seg = (name, val, opts) => `<span class="stseg" data-ws-seg="${name}">` +
    opts.map(([v,l]) => `<button type="button" data-v="${v}" class="${val===v?"on":""}">${l}</button>`).join("") + `</span>`;
  const vers = p.versions();
  const curIdx = (typeof p.currentVersion === "function") ? p.currentVersion() : vers.length - 1;

  const vocabRows = Object.keys(cfgNow.vocabulary || {}).map(w =>
    `<div class="strow"><div class="stlab"><b>${esc(w)}</b><small>Used in agent drafts and on-screen copy</small></div>
     <div class="stctl"><input type="text" class="stin" data-ws-vocab="${esc(w)}" value="${esc(cfgNow.vocabulary[w])}" style="max-width:200px"></div></div>`).join("");

  return `<div class="sthead"><h2>Workspace</h2><p>How your whole workspace is configured. Changes here affect everyone and apply right away — every change is versioned, so you can undo from history below.</p></div>

  <div class="sthead" style="margin-top:22px"><h2>Organization</h2><p>What you told setup. Edit any field.</p></div>
  <div class="stcard">
    ${row("Organization name", "", `<input type="text" class="stin" data-ws-ident="orgName" value="${esc((cfgNow.identity||{}).orgName||"")}" style="max-width:320px">`)}
    ${row("Primary sport", "", `<input type="text" class="stin" data-ws-ident="sport" value="${esc((cfgNow.identity||{}).sport||"")}" style="max-width:200px">`)}
  </div>

  <div class="sthead" style="margin-top:22px"><h2>Modules</h2><p>Add-on modules switch whole feature sets on or off. Turning one off cascades to its widgets and pages — the proposal shows exactly what goes.</p></div>
  <div class="stcard">
    ${modList.map(m => {
      const meta = p.MODULES[m] || {};
      const isOn = on.has(m);
      return `<div class="strow"><div class="stlab"><b>${esc(m)}</b><small>${esc(meta.contains || "")}</small></div>
        <div class="stctl"><button type="button" class="btn ${isOn?"":"ghost"} sm" data-ws-module="${esc(m)}" data-state="${isOn?"off":"on"}" aria-pressed="${isOn}">${isOn?"On":"Off"}</button></div></div>`;
    }).join("")}
  </div>

  <div class="sthead" style="margin-top:22px"><h2>Pages</h2><p>Which pages exist in the workspace navigation.</p></div>
  <div class="stcard">
    ${(cfgNow.pages || []).map(pg => `<div class="strow"><div class="stlab"><b>${esc(pg.title || pg.id)}</b></div>
      <div class="stctl"><span class="stro">Shown</span></div></div>`).join("") || `<p class="ps-note">No pages configured.</p>`}
  </div>

  <div class="sthead" style="margin-top:22px"><h2>Vocabulary</h2><p>Words the agent uses for you. Changing a word here rewrites it everywhere it appears — past invoices keep the word they were sent with.</p></div>
  <div class="stcard">
    ${vocabRows || `<p class="ps-note">No vocabulary overrides on this template.</p>`}
  </div>

  <div class="sthead" style="margin-top:22px"><h2>Chatbox</h2><p>The widget your customers talk to. Five layers: appearance, guidance, targeting, escalation, per-user data.</p></div>
  <div class="stcard">
    ${row("Chatbox on", "", seg("chatboxOn", String(!!(cfgNow.chatbox && cfgNow.chatbox.on)), [["true","On"],["false","Off"]]))}
    ${row("Welcome message", "", `<input type="text" class="stin" data-ws-cb="greeting" value="${esc((cfgNow.chatbox||{}).greeting||"")}" style="max-width:320px">`)}
    ${row("Who sees it", "", seg("chatboxAudience", String((cfgNow.chatbox||{}).audience||"everyone"), [["everyone","Everyone"],["members","Members only"],["guests","Guests only"]]))}
    ${row("Escalation", "When the chatbox hands off to a human.", `<input type="text" class="stin" data-ws-cb="escalation" value="${esc((cfgNow.chatbox||{}).escalation||"")}" style="max-width:320px" placeholder="e.g. billing questions, injuries">`)}
    ${row("Remembers the visitor", "The chatbox recalls the visitor's name and last topic.", seg("chatboxMemory", String(!!(cfgNow.chatbox&&cfgNow.chatbox.rememberVisitor)), [["true","On"],["false","Off"]]))}
  </div>

  <div class="sthead" style="margin-top:22px"><h2>Version history</h2><p>Every change, who made it, when. Undo restores a version — it never deletes history.</p></div>
  <div class="stcard">
    ${vers.slice().reverse().map((v, ri) => {
      const idx = vers.length - 1 - ri;
      const isCur = idx === curIdx;
      return `<div class="strow"><div class="stlab"><b>Version ${v.version}${isCur?" — current":""}</b>
        <small>${esc(v.author || "system")} · ${esc((v.at||"").slice(0,16).replace("T"," "))} · ${esc(v.source || "")}${v.request?` · ${esc(v.request.slice(0,60))}`:""}</small></div>
        <div class="stctl">${isCur ? `<span class="stro">Current</span>` : `<button type="button" class="btn ghost sm" data-ws-undo="${v.version}">Restore</button>`}</div></div>`;
    }).join("")}
  </div>
  <p class="ps-dev">Restoring a version is itself a new version — the audit trail is append-only.</p>`;
}

function wsSetIdent(field, value){
  const p = P(), cur = cfg();
  if (!p || !cur) return;
  const op = { op:"replace", path:"identity."+field, value };
  const r = p.applyPatchOps(cur, [op]);
  p.commitConfig(r.config, { author:author(), source:"settings", request:"organization "+field, ops:[op] });
  render();
}
/* Workspace settings writes. Governance changes (modules, roles) go through
   validation; simple fields commit directly with history. */
function wsSetModule(mod, turnOn){
  const p = P(), cur = cfg();
  if (!p || !cur) return;
  const on = new Set(cur.modulesOn || []);
  if (on.has(mod) === turnOn) return;
  /* Validate first: turning off a module with dependents needs cascade
     confirmation, unknown modules are refused, requirements are checked. */
  const op = turnOn
    ? { op:"add", path:"modulesOn", moduleId:mod, value:mod }
    : { op:"remove", path:"modulesOn", moduleId:mod };
  const v = p.validateProposal([op], { role:role(), config:cur, modulesOn:cur.modulesOn || [] });
  if (!v.ok){ toast("Cannot turn that module " + (turnOn?"on":"off") + ": " + v.errors.join(" ")); return; }
  const r = p.applyPatchOps(cur, [op]);
  p.commitConfig(r.config, { author:author(), source:"settings",
    request:(turnOn?"enable":"disable")+" module "+mod, ops:[op] });
  toast("Module " + (turnOn?"enabled.":"disabled.") + " Undo is in version history.");
  render();
}
function wsSetChatboxField(field, value){
  const p = P(), cur = cfg();
  if (!p || !cur) return;
  const op = { op:"replace", path:"chatbox."+field, value };
  const r = p.applyPatchOps(cur, [op]);
  p.commitConfig(r.config, { author:author(), source:"settings", request:"chatbox "+field, ops:[op] });
  render();
}
function wsSetVocab(word, value){
  const p = P(), cur = cfg();
  if (!p || !cur) return;
  const op = { op:"replace", path:"vocabulary."+word, value };
  const r = p.applyPatchOps(cur, [op]);
  p.commitConfig(r.config, { author:author(), source:"settings", request:"vocabulary: "+word, ops:[op] });
  render();
}
function wsUndo(versionIdx){
  const p = P();
  if (!p) return;
  const r = p.restoreVersion(versionIdx);
  if (!r.ok){ toast("Could not restore: " + (r.errors||[]).join(" ")); return; }
  toast("Restored version " + versionIdx + ".");
  render();
}

/* ═══════════════ WIRING ═══════════════
   One delegated click listener per render cycle (bound once, guarded). */
let wired = false;
function wire(){
  injectCSS();
  if (wired || typeof document === "undefined") return;
  wired = true;
  document.addEventListener("click", (e) => {
    const q = (sel) => e.target.closest ? e.target.closest(sel) : null;
    let el;
    /* proposal card actions (bare data-apply/tweak/cancel come from the
       engine's previewHTML; pers- variants are this module's own) */
    if ((el = q("[data-apply]"))){ e.preventDefault(); persApply(el.getAttribute("data-apply")); return; }
    if ((el = q("[data-cancel]"))){ e.preventDefault(); persCancel(el.getAttribute("data-cancel")); return; }
    if ((el = q("[data-tweak]"))){ e.preventDefault(); persTweakOpen(el.getAttribute("data-tweak")); return; }
    if ((el = q("[data-pers-tweakgo]"))){ e.preventDefault(); persTweakGo(el.getAttribute("data-pers-tweakgo")); return; }
    if ((el = q("[data-pers-tweakcancel]"))){ e.preventDefault(); persTweakCancel(el.getAttribute("data-pers-tweakcancel")); return; }
    /* onboarding */
    if ((el = q("[data-ob-tpl]"))){ st().ob.templateId = el.getAttribute("data-ob-tpl"); render(); return; }
    if ((el = q("[data-ob-q]"))){ st().ob[el.getAttribute("data-ob-q")] = el.getAttribute("data-v"); render(); return; }
    if ((el = q("[data-ob-conn]"))){ st().ob[el.getAttribute("data-ob-conn")] = el.getAttribute("data-v"); render(); return; }
    if ((el = q("[data-ob-next]"))){ if (!el.disabled){ st().obStep = parseInt(el.getAttribute("data-ob-next"), 10) || 0; render(); } return; }
    if ((el = q("[data-ob-finish]"))){ finishOnboarding(); return; }
    /* personal settings segmented controls */
    if ((el = q("[data-pers-seg] button"))){
      const segName = el.closest("[data-pers-seg]").getAttribute("data-pers-seg");
      persSet(segName, el.getAttribute("data-v"));
      return;
    }
    /* workspace settings segmented controls */
    if ((el = q("[data-ws-seg] button"))){
      const segName = el.closest("[data-ws-seg]").getAttribute("data-ws-seg");
      wsSeg(segName, el.getAttribute("data-v"));
      return;
    }
    if ((el = q("[data-ws-module]"))){
      wsSetModule(el.getAttribute("data-ws-module"), el.getAttribute("data-state") === "on");
      return;
    }
    if ((el = q("[data-ws-undo]"))){ wsUndo(parseInt(el.getAttribute("data-ws-undo"), 10)); return; }
    /* memory item edit/delete */
    if ((el = q("[data-pers-memdel]"))){ memDel(el.getAttribute("data-pers-memdel")); return; }
    if ((el = q("[data-pers-memedit]"))){ memEdit(el.getAttribute("data-pers-memedit")); return; }
    if ((el = q("[data-pers-memsave]"))){ memSave(el.getAttribute("data-pers-memsave")); return; }
    if ((el = q("[data-pers-memcancel]"))){ memEditCancel(); return; }
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (!t || !t.getAttribute) return;
    if (t.hasAttribute("data-ob-field")){
      st().ob[t.getAttribute("data-ob-field")] = t.value;
      return; /* no render: keep focus while typing */
    }
    if (t.hasAttribute("data-pers-text") && t.getAttribute("data-pers-text") === "signoff"){
      /* commit on change below; input only stages */
    }
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (!t || !t.getAttribute) return;
    if (t.hasAttribute("data-pers-time")){
      persSetTime(t.getAttribute("data-pers-time"), t.value);
    }
    if (t.hasAttribute("data-pers-text")){
      persSetText(t.getAttribute("data-pers-text"), t.value);
    }
    if (t.hasAttribute("data-ws-cb")){
      wsSetChatboxField(t.getAttribute("data-ws-cb"), t.type === "checkbox" ? t.checked : t.value);
    }
    if (t.hasAttribute("data-ws-vocab")){
      wsSetVocab(t.getAttribute("data-ws-vocab"), t.value);
    }
    if (t.hasAttribute("data-ws-ident")){
      wsSetIdent(t.getAttribute("data-ws-ident"), t.value);
    }
  });
}

/* Personal store writes (device-local). */
function persSet(name, v){
  const p = P();
  if (!p) return;
  const patch = {};
  if (name === "density") patch.layout = { density:v };
  else if (name === "homeTab") patch.layout = { homeTab:v };
  else if (name === "paymentAlerts") patch.notifications = { paymentAlerts:v === "true" };
  else if (name === "draftAlerts") patch.notifications = { draftAlerts:v === "true" };
  else if (name === "tone") patch.aiProfile = { tone:v };
  else if (name === "format") patch.aiProfile = { format:v };
  else if (name === "memoryEnabled"){ p.memorySetEnabled(v === "true"); render(); return; }
  p.setPersonal(patch);
  /* density changes apply instantly */
  if (name === "density"){ document.documentElement.dataset.density = v; }
  render();
}
function persSetTime(name, v){
  const p = P();
  if (!p || !v) return;
  const n = {}; n[name] = v;
  p.setPersonal({ notifications:n });
  render();
}
function persSetText(name, v){
  const p = P();
  if (!p) return;
  if (name === "signoff") p.setPersonal({ aiProfile:{ signoff:v } });
  else if (name === "personWord") p.setPersonal({ aiProfile:{ vocabulary:{ person:v } } });
  render();
}
function memDel(id){
  const p = P();
  if (!p) return;
  p.memoryDelete(id);
  toast("Memory deleted.");
  render();
}
function memEdit(id){
  const s = st();
  s.memEditing = id;
  render();
  const inp = document.querySelector(`[data-pers-meminput="${id}"]`);
  if (inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}
function memEditCancel(){
  st().memEditing = null;
  render();
}
function memSave(id){
  const p = P();
  if (!p) return;
  const inp = document.querySelector(`[data-pers-meminput="${id}"]`);
  const next = inp ? inp.value.trim() : "";
  if (!next){ toast("Memory cannot be empty — delete it instead."); return; }
  p.memoryUpdate(id, next);
  st().memEditing = null;
  toast("Memory updated.");
  render();
}

/* Workspace segmented controls. */
function wsSeg(name, v){
  const bool = v === "true";
  if (name === "chatboxOn") wsSetChatboxField("on", bool);
  else if (name === "chatboxAudience") wsSetChatboxField("audience", v);
  else if (name === "chatboxMemory") wsSetChatboxField("rememberVisitor", bool);
  else render();
}

/* Density attribute for CSS hooks. */
function applyDensity(){
  const p = P();
  if (!p) return;
  try {
    const d = p.getPersonal().layout.density;
    document.documentElement.dataset.density = d;
  } catch(e){}
}

/* Boot: wire once, apply density. The host calls wire() from its own wire(). */
if (typeof document !== "undefined"){
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { wire(); applyDensity(); });
  else { wire(); applyDensity(); }
}

/* ═══════════════ EXPORT ═══════════════ */
/* The host renders through this module's view functions but never calls
   wire(); attach once at load so clicks/inputs work and styles apply. */
injectCSS();
wire();
G.SporvPersonalizeUI = {
  /* onboarding */
  onboardView, finishOnboarding,
  /* dock */
  persProposalFor, persPropCardHTML, persApply, persCancel, persTweakOpen, persTweakGo,
  /* settings */
  personalSettingsHTML, workspaceSettingsHTML,
  /* plumbing */
  seeded, cfg, role, author, applyDensity, wire,
};
})();
