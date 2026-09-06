import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const source = await fs.readFile("src/sporve-web.host.html", "utf8");

test("website extraction remains a draft until confirmation", () => {
  const extract = source.indexOf('window.SporveAPI.fn("club-site-extract"');
  const confirm = source.indexOf("const suwC=document.getElementById(\"suwConfirmForm\")");
  assert.notEqual(extract, -1);
  assert.notEqual(confirm, -1);
  const extractionFlow = source.slice(extract, confirm);
  assert.match(extractionFlow, /w\.extracted=true/);
  assert.doesNotMatch(extractionFlow, /\.from\(\s*["'](?:seasons|teams|programs)["']/);
  assert.match(source, /Nothing is saved until you confirm/);
});

test("confirmed extraction retries reuse provider-scoped rows", () => {
  for (const marker of ["existingSeasons", "existingTeams", "existingPrograms"]) {
    assert.match(source, new RegExp(marker));
  }
  const confirm = source.indexOf("const suwC=document.getElementById(\"suwConfirmForm\")");
  const billing = source.indexOf("const suwB=document.getElementById(\"suwBillForm\")");
  const flow = source.slice(confirm, billing);
  assert.match(flow, /provider_id=eq\./g);
  assert.match(flow, /season_id=eq\./g);
  assert.match(flow, /&limit=1/g);
  assert.match(flow, /existingTeams/);
  assert.match(flow, /existingPrograms/);
});

test("roster re-upload checks the provider-scoped active content hash first", () => {
  const start = source.indexOf("const raw=(w.rawText||w.fileName||\"\")");
  const end = source.indexOf("const batchId=", start);
  const flow = source.slice(start, end);
  assert.match(flow, /import_batches/);
  assert.match(flow, /provider_id=eq\./);
  assert.match(flow, /content_hash=eq\./);
  assert.match(flow, /undone_at=is\.null/);
  assert.match(flow, /prior&&prior\[0\]/);
});

test("roster undo does not claim success before server confirmation", () => {
  const start = source.indexOf('$("[data-imp-undo]")');
  const end = source.indexOf('$("[data-imp-toinvites]")', start);
  const flow = source.slice(start, end);
  assert.notEqual(start, -1);
  assert.match(flow, /undoing/);
  assert.match(flow, /await window\.SporveAPI\.from\("team_athletes"/);
  assert.match(flow, /await window\.SporveAPI\.from\("import_batches"/);
  assert.match(flow, /localUndo\(\);/);
  assert.ok(flow.indexOf("localUndo();") > flow.indexOf('await window.SporveAPI.from("team_athletes"'));
  assert.match(flow, /Undo failed — no roster rows were removed/);
  assert.match(flow, /older than 24 hours and cannot be undone/);
});

test("switching real accounts purges prior organization collections", () => {
  const start = source.indexOf("function adoptIdentity(newUid)");
  const end = source.indexOf("function toggleFav", start);
  const flow = source.slice(start, end);
  assert.match(flow, /prev!==newUid/);
  assert.match(flow, /resetPersonalState\(\)/);
  for (const key of ["athletes", "bookings", "messages", "roster", "listings", "teams", "parentUpdates"]) {
    assert.match(flow, new RegExp(`"${key}"`));
  }
});
