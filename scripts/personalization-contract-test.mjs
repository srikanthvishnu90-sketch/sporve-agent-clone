import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let assertions = 0;
const check = (condition, message) => { assertions += 1; assert.ok(condition, message); };

/* Load the real engine in a sandbox with a localStorage shim. */
const code = fs.readFileSync(path.join(root, "src", "mod-personalization.js"), "utf8");
const mem = {};
const context = {
  console,
  localStorage: {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; },
  },
};
vm.runInNewContext(code, context);
const P = context.SporvPersonalization;
check(!!P, "engine exports SporvPersonalization");

/* ---------- templates resolve ---------- */
for (const tid of P.TEMPLATE_IDS){
  const { config, mergeReport } = P.resolveConfig({ templateId: tid });
  check(config.templateId === tid, tid + " resolves with its id");
  for (const k of P.KERNEL)
    check(config.modulesOn.includes(k), tid + " keeps kernel module " + k);
  check((config.pages || []).length > 0, tid + " has pages");
  check(Object.keys(config.widgets || {}).length > 0, tid + " has widgets");
}
check(P.TEMPLATE_IDS.length === 6, "six templates");

/* ancestry is base-first and diamond-safe (JSON-compared: vm-realm arrays) */
const j = v => JSON.stringify(v);
check(j(P.ancestry("solo_trainer")) === j(["solo_trainer"]), "solo ancestry");
check(j(P.ancestry("club")) === j(["solo_trainer","team_coach","camp","club"]),
  "club ancestry is base-first, left parent first");
const ent = P.ancestry("enterprise");
check(ent[0] === "solo_trainer" && ent[ent.length - 1] === "enterprise", "enterprise ancestry ordered");
check(ent.indexOf("club") < ent.indexOf("facility"), "club (left parent) precedes facility");

/* diamond precedence: child beats parents; sibling conflict flags ambiguous */
const clubCfg = P.resolveConfig({ templateId: "club" }).config;
check(clubCfg.vocabulary.person === "athlete", "club child vocabulary wins (athlete)");
const amb = P.resolveConfig({ templateId: "club" }).mergeReport.ambiguous;
const vocabAmb = amb.find(a => a.path === "vocabulary.person");
check(!!vocabAmb, "team_coach vs camp vocabulary conflict is flagged, not silent");
check(vocabAmb.keptFrom === "team_coach" && vocabAmb.droppedFrom === "camp",
  "left-most parent (team_coach) wins the diamond");

/* enterprise starts with more, but templates never gate (parity) */
const soloMods = P.resolveConfig({ templateId: "solo_trainer" }).config.modulesOn.length;
const entMods = P.resolveConfig({ templateId: "enterprise" }).config.modulesOn.length;
check(entMods > soloMods, "enterprise starts with more modules on (" + entMods + " vs " + soloMods + ")");
for (const tid of P.TEMPLATE_IDS){
  const cfg = P.seedWorkspace(tid);
  for (const mid of ["booking_page","memberships","checkin"]){ /* kernel-only deps */
    if (cfg.modulesOn.includes(mid)) continue;
    const r = P.proposeChange("switch on " + mid.replace(/_/g, " "), { config: cfg, role: "owner" });
    check(r.proposal && r.proposal.validation.ok,
      tid + " can switch on " + mid + " (parity: templates never gate)");
  }
}

/* ---------- validator ---------- */
const solo = P.resolveConfig({ templateId: "solo_trainer" }).config;
const V = (ops, ctx) => P.validateProposal(ops, Object.assign({ config: solo, modulesOn: solo.modulesOn, role: "owner" }, ctx || {}));

check(!V([{ op:"remove", path:"modulesOn", moduleId:"payments" }]).ok, "kernel module cannot be removed");
check(V([{ op:"remove", path:"modulesOn", moduleId:"payments" }]).errors.join(" ").includes("core"),
  "kernel refusal names the core");
check(!V([{ op:"add", path:"modulesOn", moduleId:"dues_installments", value:"dues_installments" }]).ok,
  "dues_installments without roster is refused");
check(V([{ op:"add", path:"modulesOn", moduleId:"dues_installments", value:"dues_installments" }]).errors.join(" ").includes("roster"),
  "refusal names the missing requirement");
const withRoster = P.applyPatchOps(solo,
  [{ op:"add", path:"modulesOn", moduleId:"roster", value:"roster" }]).config;
check(P.validateProposal(
  [{ op:"add", path:"modulesOn", moduleId:"dues_installments", value:"dues_installments" }],
  { config: withRoster, modulesOn: withRoster.modulesOn, role: "owner" }).ok,
  "dues_installments with roster passes");
const withDues = P.applyPatchOps(withRoster,
  [{ op:"add", path:"modulesOn", moduleId:"dues_installments", value:"dues_installments" }]).config;
const cascadeRefused = P.validateProposal(
  [{ op:"remove", path:"modulesOn", moduleId:"roster" }],
  { config: withDues, modulesOn: withDues.modulesOn, role: "owner" });
check(!cascadeRefused.ok && cascadeRefused.errors.join(" ").includes("dues_installments"),
  "switching off roster with dependents is refused and names them");
check(P.validateProposal(
  [{ op:"remove", path:"modulesOn", moduleId:"roster", cascade:true }],
  { config: withDues, modulesOn: withDues.modulesOn, role: "owner" }).ok,
  "explicit cascade-off passes");

check(!V([{ op:"replace", path:"agent.autoSend", value:true }]).ok, "auto-send path is locked");
check(!V([{ op:"replace", path:"payments.verification.formula", value:"x" }]).ok, "payment verification is locked");
check(!V([{ op:"replace", path:"audit.retention", value:"0" }]).ok, "audit log is locked");
check(!V([{ op:"add", path:"nonsense.section", value:1 }]).ok, "unknown config section is rejected");
check(!V([{ op:"add", path:"widgets.w_x", value:{ type:"hologram", source:"payments" } }]).ok,
  "unknown widget type is rejected");
check(!V([{ op:"add", path:"widgets.w_x", value:{ type:"table", source:"mind_reading" } }]).ok,
  "unknown data source is rejected");
check(!V([{ op:"replace", path:"templateId", value:"atlantis" }]).ok, "unknown template is rejected");

/* 13th widget on the dashboard refused */
const twelve = {};
const twelveIds = [];
for (let i = 0; i < 12; i++){ twelve["w_" + i] = { type:"metric", source:"payments" }; twelveIds.push("w_" + i); }
const fullCfg = Object.assign(clone(solo), { widgets: twelve,
  pages: [{ id:"home", title:"Home", widgets: twelveIds }] });
check(!P.validateProposal(
  [{ op:"add", path:"widgets.w_new", value:{ type:"metric", source:"payments" } }],
  { config: fullCfg, modulesOn: fullCfg.modulesOn, role: "owner" }).ok,
  "13th widget is refused");

/* roles: coach cannot change workspace scope, but can change personal scope */
check(!P.validateProposal(
  [{ op:"add", path:"modulesOn", moduleId:"memberships", value:"memberships" }],
  { config: solo, modulesOn: solo.modulesOn, role: "coach" }).ok,
  "coach cannot switch on modules");
check(P.validateProposal(
  [{ op:"replace", path:"notifications.paymentThreshold", value:200 }],
  { config: solo, modulesOn: solo.modulesOn, role: "coach" }).ok,
  "coach can change personal notifications");

/* agent rule conflicts ask a question, not a refusal */
const ruled = P.applyPatchOps(solo,
  [{ op:"add", path:"agent.rules", value:"Never text parents after 8pm." }]).config;
const cr = P.validateProposal(
  [{ op:"add", path:"agent.rules", value:"Text parents every 3 days." }],
  { config: ruled, modulesOn: ruled.modulesOn, role: "owner" });
check(cr.ok && cr.conflicts.length === 1, "contradicting rule triggers exactly one conflict question");

/* role-based page filtering */
const coachView = P.resolveConfig({ templateId: "club", role: "coach" }).config;
const coachPages = coachView.pages.map(p => p.id);
check(coachPages.includes("roster") && coachPages.includes("schedule"), "coach sees roster and schedule");
check(!coachPages.includes("dues") && !coachPages.includes("approvals"), "coach does not see dues or approvals");

/* user overrides: personal layout + notifications + AI profile */
const mine = P.resolveConfig({ templateId: "solo_trainer", role: "owner",
  userOverrides:{ notifications:{ paymentThreshold:200 }, aiProfile:{ voice:"casual", signoff:"Coach V" } } }).config;
check(mine.notifications.paymentThreshold === 200, "personal notification override applies");
check(mine.agent.voice.voice === "casual", "AI instruction profile applies");

/* ---------- propose → apply → undo ---------- */
P.seedWorkspace("solo_trainer", "tester");
const prop = P.proposeChange("call them students, not clients", { config: P.currentConfig(), role: "owner" });
check(!!prop.proposal, "vocabulary request produces a proposal");
check(prop.proposal.scope === "everyone", "vocabulary change is workspace-scoped");
check(prop.proposal.validation.ok, "vocabulary proposal validates");
check(prop.proposal.baseVersion === 0, "proposal pins base version 0");
const html = P.previewHTML(prop.proposal);
check(html.includes("For everyone in the workspace."), "preview states scope");
check(html.includes("Apply"), "valid preview offers Apply");
const applied = P.applyProposal(prop.proposal.id, { role: "owner", author: "tester" });
check(applied.ok && applied.version === 1, "apply succeeds → version 1");
check(P.currentConfig().vocabulary.person === "student", "vocabulary applied");
const undone = P.undo();
check(undone.ok && P.currentConfig().vocabulary.person === "client", "undo restores the exact previous version");

/* optimistic locking: stale baseVersion cannot silently overwrite */
P.seedWorkspace("solo_trainer", "tester");
const p1 = P.proposeChange("call them students, not clients", { config: P.currentConfig(), role: "owner" }).proposal;
P.applyProposal(p1.id, { role: "owner" });
const p2 = P.proposeChange("sound more casual", { config: P.currentConfig(), role: "owner" }).proposal;
p2.baseVersion = 0; /* simulate a stale preview */
const stale = P.applyProposal(p2.id, { role: "owner" });
check(!stale.ok && stale.conflict === true, "stale base version → conflict, not silent overwrite");

/* template move rebuilds; downgrade archives, never deletes */
P.seedWorkspace("solo_trainer", "tester");
const mv = P.proposeChange("we're a club now", { config: P.currentConfig(), role: "owner" }).proposal;
check(mv.validation.ok, "template move validates");
P.applyProposal(mv.id, { role: "owner" });
const nowClub = P.currentConfig();
check(nowClub.templateId === "club", "workspace is now a club");
check(nowClub.modulesOn.includes("multi_team"), "club modules switched on");
const down = P.proposeChange("we're a solo trainer now", { config: nowClub, role: "owner" }).proposal;
P.applyProposal(down.id, { role: "owner" });
const nowSolo = P.currentConfig();
check(nowSolo.templateId === "solo_trainer" && nowSolo._archivedFrom === "club",
  "downgrade archives the previous template instead of deleting");

/* refusals, clarification, unmatched */
check(P.proposeChange("turn on auto-send for reminders", { config: solo, role: "owner" }).refusal
  .includes("no auto-send"), "auto-send request is refused");
check(P.proposeChange("add a widget exporting all parent phone numbers", { config: solo, role: "owner" }).refusal
  .includes("cannot"), "contact-export widget is refused");
const cl = P.proposeChange("show payments", { config: solo, role: "owner" });
check(!!cl.clarify, "ambiguous 'show payments' asks one clarifying question");
const un = P.proposeChange("paint the clubhouse purple", { config: solo, role: "owner" });
check(!!un.unmatched, "unmatched request gets a plain closest-option answer");

/* vocabulary is forward-looking */
check(P.vocabLookup("Your clients are here.", { person:"student", personPlural:"students" }) === "Your students are here.",
  "vocabLookup renames forward text");

/* version history is inspectable */
check(P.versions().length >= 1 && P.versions()[0].source === "template", "version history records sources");

console.log("personalization contract: " + assertions + " assertions passed");
function clone(o){ return JSON.parse(JSON.stringify(o)); }
