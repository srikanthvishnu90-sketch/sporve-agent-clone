/* UI smoke for mod-personalize-ui.js: renders all surfaces with mocked globals. */
"use strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

const store = {};
const sandbox = {
  console,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    key: i => Object.keys(store)[i] || null,
    get length() { return Object.keys(store).length; },
  },
  document: undefined,
  prompt: undefined,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ["mod-personalization.js", "mod-personalize-ui.js"]) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), "utf8"), sandbox, { filename: f });
}

const E = sandbox.SporvPersonalization;
const UI = sandbox.SporvPersonalizeUI;
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.error("FAIL:", name); } };

// seed a workspace via the engine (as finishOnboarding would)
E.seedWorkspace("team_coach", "test");

// 1. onboarding screens render
for (let step = 0; step < 4; step++) {
  // stub S for obStep
  sandbox.S = { pers: { obStep: step, ob: { templateId: "team_coach", orgName: "Test Org", runsWhat: "teams", rosterSize: "26-100", sport: "Basketball", commStyle: "calm", rosterChoice: "later", calChoice: "later", inboxChoice: "later" } }, chat: [] };
  sandbox.render = () => {}; sandbox.toast = () => {};
  const html = UI.onboardView();
  ok(html.includes("pob-wrap"), "onboard screen " + step + " renders");
}
ok(UI.onboardView().includes("Your workspace is ready"), "screen 4 done copy");

// 2. dock proposal flow
sandbox.S = { pers: null, chat: [] };
const pp = UI.persProposalFor("turn on checkin");
ok(pp && pp.persProposal && pp.persProposal.ops.length > 0, "proposal generated for module request");
ok(pp.reply.includes("Nothing changes until you approve"), "reply copy is approval-gated");

const card = UI.persPropCardHTML(pp.persProposal, 0);
ok(card.includes("Proposed change"), "card header renders");
ok(card.includes("data-apply") || card.includes("Apply"), "card has apply action");

// 3. apply the proposal through the UI path
sandbox.S = { pers: null, chat: [{ role: "coach", text: pp.reply, persProposal: pp.persProposal }] };
sandbox.render = () => {}; sandbox.toast = () => {};
UI.persApply(pp.persProposal.id);
ok(E.currentConfig().modulesOn.includes("checkin"), "apply enables the module");

// 3b. dependency guard: waitlist needs registration first
const pw = UI.persProposalFor("turn on the waitlist");
ok(pw && pw.persProposal, "waitlist proposal created");
const cardW = UI.persPropCardHTML(pw.persProposal, 1);
ok(!cardW.includes("data-apply") && cardW.includes("Cannot apply yet"), "blocked proposal shows why, no Apply");

// 4. settings surfaces
const personal = UI.personalSettingsHTML();
ok(personal.includes("Private preferences") && personal.includes("AI instructions") && personal.includes("Learned memory"), "personal tab has 5 layers");
const workspace = UI.workspaceSettingsHTML();
ok(workspace.includes("Modules") && workspace.includes("Version history") && workspace.includes("Chatbox"), "workspace tab sections");

// 5. voice/copy audit on rendered HTML
const all = sandbox.S ? "" : "";
const rendered = [UI.onboardView(), personal, workspace, card].join(" ");
ok(!/[😀🎉✨🚀👍✅❌⚠️🎯💡🔥]/.test(rendered), "no emojis in rendered UI");
ok(!/seamless|empower|supercharge|revolutionize|leverage|unlock/i.test(rendered), "no banned SaaS words");

console.log(`ui smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
