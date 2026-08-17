import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
let assertions = 0;
const check = (condition, message) => {
  assertions += 1;
  assert.ok(condition, message);
};

async function catalogueContract() {
  const seed = { id: "seed-program", title: "Disclosed sample" };
  const programs = [seed];
  const slots = { deleted_program: [{ id: "deleted-session" }] };
  const state = { mode: "live", marker: null, rebuilds: 0 };
  const liveProgram = {
    id: "live-program",
    title: "Live lesson",
    description: "A current listing",
    sport_type: "Soccer",
    skill_level: "beginner",
    minimum_age: 8,
    maximum_age: 12,
    price: 45,
    max_capacity: 4,
    providers: {
      id: "provider-1",
      business_name: "Current Coach",
      background_check_status: "verified",
      background_check_completed_at: "2026-08-01T00:00:00Z",
    },
  };
  const liveSession = {
    id: "session-1",
    program_id: "live-program",
    start_date: "2026-09-01",
    start_time: "17:00",
    end_time: "18:00",
    timezone: "America/Chicago",
  };
  const api = {
    from(table) {
      if (state.mode === "failure") return Promise.reject(new Error("offline"));
      if (state.mode === "empty") return Promise.resolve([]);
      return Promise.resolve(table === "programs" ? [liveProgram] : [liveSession]);
    },
  };
  const context = {
    window: { SporveAPI: api, location: { protocol: "https:", search: "" } },
    document: {
      documentElement: {
        setAttribute(name, value) {
          if (name === "data-catalog") state.marker = value;
        },
      },
    },
    PROGRAMS: programs,
    LIVE_SLOTS: slots,
    sampleListings: () => [],
    rebuildBusinesses: () => { state.rebuilds += 1; },
    phShot: () => "data:image/svg+xml,fixture",
  };
  vm.runInNewContext(read("src/mod-catalog.js"), context,
    { filename: "src/mod-catalog.js" });

  const originalArray = context.PROGRAMS;
  const hydrated = await context.window.SporveCatalog.hydrate();
  check(hydrated === true, "catalogue hydration should report live success");
  check(context.PROGRAMS === originalArray, "catalogue must preserve PROGRAMS identity");
  check(context.PROGRAMS.length === 1 && context.PROGRAMS[0].id === "live-program",
    "catalogue must replace the fixture with live rows");
  check(!("deleted_program" in context.LIVE_SLOTS),
    "successful hydration must delete session keys absent from the new response");
  check(context.LIVE_SLOTS["live-program"]?.[0]?.id === "session-1",
    "successful hydration must index current sessions");
  check(state.marker === "live" && context.window.SporveCatalog.isLive(),
    "successful hydration must expose live state");

  state.mode = "failure";
  const reloaded = await context.window.SporveCatalog.reload();
  check(reloaded === false, "failed reload should resolve to the fallback state");
  check(context.PROGRAMS === originalArray && context.PROGRAMS.length === 1 &&
    context.PROGRAMS[0].id === "seed-program",
  "failed reload must restore the original fixture without reassigning PROGRAMS");
  check(Object.keys(context.LIVE_SLOTS).length === 0,
    "failed reload must remove stale live sessions");
  check(state.marker === "seed" && !context.window.SporveCatalog.isLive(),
    "failed reload must expose seed state rather than mislabeled live data");
  check(state.rebuilds >= 2, "catalogue replacement and rollback must rebuild businesses");
}

async function coachAccountContract() {
  let query = "";
  let row = {
    id: "provider-1",
    business_name: "Probe Coaching",
    status: "approved",
    background_check_status: "verified",
    background_check_completed_at: null,
    stripe_account_id: "acct_probe",
    stripe_charges_enabled: true,
  };
  const api = {
    url: "https://example.supabase.co",
    anonKey: "public-test-key",
    from(table, nextQuery) {
      if (table === "providers") query = nextQuery;
      return Promise.resolve([row]);
    },
    fn() { return Promise.resolve({}); },
  };
  const auth = {
    userId: () => "user-1",
    signUp: () => Promise.resolve({}),
    signIn: () => Promise.resolve({}),
    session: () => ({ access_token: "test-token" }),
  };
  const context = { window: { SporveAPI: api, SporveAuth: auth } };
  vm.runInNewContext(read("src/mod-coachaccount.js"), context,
    { filename: "src/mod-coachaccount.js" });
  await context.window.SporveCoach.load();

  for (const field of ["background_check_completed_at", "stripe_account_id",
    "stripe_charges_enabled"]) {
    check(query.includes(field), `coach provider select must include ${field}`);
  }
  check(context.window.SporveCoach.current().stripe_charges_enabled === true,
    "loaded payout readiness must remain available to the coach UI");
  check(context.window.SporveCoach.publicState().live === false,
    "verified status without a completion date must not become public trust");

  row = { ...row, background_check_completed_at: "2026-08-16T12:00:00Z" };
  await context.window.SporveCoach.load();
  check(context.window.SporveCoach.publicState().live === true,
    "dated verified state should satisfy the coach public-state contract");
}

await catalogueContract();
await coachAccountContract();
console.log(`data contract: ${assertions} assertions passed`);
