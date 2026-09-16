// tests/auth/onboarding-flow.spec.ts — the DoD file the login brief names
// (owner 2026-09-16). Runs under `node --test` (Node ≥ 23 strips types).
//
// Six clauses, each mechanical:
//   1 signup → first useful screen      3 every soft block is advanceable
//   2 resume after abandonment          4 both hard blocks are enforced
//   5 a fresh account has ZERO attached records (the SQL fixture, executed here when Postgres is available)
//   6 no route returns data without a session (the live anon probe, executed here; excuses must name an unapplied migration)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const root = new URL('../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const mod = read('src/mod-onboard.js');
const host = read('src/sporve-web.host.html').replace(/\/\*[\s\S]*?\*\//g, '');
const auth = read('src/mod-auth.js');
const account = read('src/mod-coachaccount.js');
const migration = read('supabase/migrations/20260915_001065_staff_only_signup.sql');

test('1. signup → first useful screen: passwordless, staff-only, lands on the queue', () => {
  assert.match(mod, /magicLink\(o\.email, [^)]*\{ role: "provider" \}\)/, 'the account step sends a magic link that creates a STAFF account');
  assert.match(auth, /data: Object\.assign\(\{ role: "provider" \}, meta \|\| \{\}\)/, 'mod-auth carries the staff role into the OTP request');
  assert.ok(!/type="password"/.test(mod), 'no password field on the login surface');
  assert.match(mod, /const ORDER = \["1", "2", "3", "4", "5", "6", "7"\]/, 'six numbered steps after the account step');
  assert.match(mod, /S\.coachTab = "queue"; S\.portal = "coach"; if \(typeof go === "function"\) go\("dashboard"\)/, 'step 7 opens the review queue');
  assert.match(mod, /body: \{ onboarding_completed: true \}/, 'finishing marks the org onboarded server-side');
  assert.match(host, /if\(r\.name==="setup"\)\{body=window\.MOD_ONBOARD\?window\.MOD_ONBOARD\.html\(\):"";\}/, 'the host routes to the surface');
  assert.match(host, /coachGateActive\(\)\)\{\s*S\.route=\{name:"setup",arg:null\}; return render\(\);/, 'a not-yet-onboarded org is sent to the surface on every render');
  assert.match(host, /\(r\.name==="coachgate"\|\|r\.name==="setup"\)\?"":topbarHTML\(\)/, 'fullscreen: no top bar');
  assert.match(mod, /@media\(max-width:900px\)\{\.ob\{grid-template-columns:1fr\}\.ob \.right\{display:none\}/, 'single column on a phone — the split pane is gone, not squeezed');
  assert.match(mod, /env\(safe-area-inset-bottom\)/, 'safe-area padding on the footer');
});

test('2. resume after abandonment: progress lives in provider_settings, not in the tab', () => {
  assert.match(mod, /settingsWrite\("onboarding", snapshot\(\)\)/, 'every advance persists the step');
  assert.match(mod, /key=in\.\(onboarding,legal_consent\)/, 'resume reads it back');
  assert.match(mod, /o\.step = p\.onboarding_completed \? "7" : step;/, 'a finished org resumes at the end, an unfinished one where it left off');
  assert.match(mod, /if \(signedIn\(\) && !o\.loaded\) resume\(\);/, 'resume runs on first render of a signed-in session');
});

test('3. every soft block is advanceable: a reason and a finish-later path, never a trap', () => {
  assert.match(mod, /const SKIP = \{ "3": "Finish later", "4": "Skip for now", "5": "Skip for now" \}/);
  assert.match(mod, /if \(s === "2" && skip && !o\.type\) o\.type = "blank";/, 'skipping "what you run" starts blank instead of blocking');
  assert.match(mod, /return \{ hard: false, msg: "Still needed: " \+ miss\.join\(", "\) \+ "\. You can finish this later from Settings\." \}/, 'the soft block says exactly what is missing and where to finish it');
  assert.match(mod, /data-obskip="1"[^>]*>\$\{SKIP\[s\]\}/, 'the finish-later control is rendered');
  assert.match(mod, /const showNext = !\(s === "1" \|\| s === "1b" \|\| \(s === "6" && !\(S\.agentRun && S\.agentRun\.done\)\)\)/, 'steps 6 and 7 progress by their own action');
  // no generic error: every fail() call states what went wrong and what to do
  const fails = [...mod.matchAll(/fail\(([\s\S]*?)\);/g)].map((m) => [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]).join('')).filter((f) => f.length > 3);
  assert.ok(fails.length >= 6);
  for (const f of fails) { assert.ok(!/something went wrong/i.test(f), f); assert.ok(/[.]/.test(f) && f.length > 40, `error too thin: ${f}`); }
});

test('4. exactly two hard blocks: legal consent here, payment identity at checkout — nothing else blocks', () => {
  assert.match(mod, /const HARD_BLOCKS = \["legal_consent", "payment_identity"\]/);
  assert.match(mod, /if \(step === "2" && !o\.consent\) return \{ hard: true,/, 'consent is the only hard block in the flow');
  assert.equal((mod.match(/hard: true/g) || []).length, 1, 'no other hard block exists in the flow');
  assert.match(mod, /settingsWrite\("legal_consent", \{ version: CONSENT_VERSION, at: o\.consentAt \}\)/, 'consent is recorded with a version');
  assert.ok(!/stripe.*disabled|disabled.*stripe/i.test(mod), 'Stripe never gates a step');
  assert.match(mod, /never blocks setup/, 'the copy says so');
  assert.match(account, /billing-create-checkout/, 'payment identity is enforced where money moves, not in onboarding');
});

test('5. a fresh account has ZERO attached records (SQL fixture, run for real when Postgres is available)', () => {
  assert.match(migration, /values \(new\.id, 'provider',/, 'every new account is staff');
  assert.match(migration, /values \(new\.id, coalesce\(nullif\(biz_name, ''\), 'Your organization'\)\)/, 'its own empty org, never a lookup');
  assert.ok(!/raw_user_meta_data ->> 'role'/.test(migration), 'the client cannot elect a role');
  assert.ok(!/email.*like|domain/i.test(migration), 'no email-domain matching anywhere in signup');
  const fixture = 'docs/red-drafts/2026-09-16-auth-fresh-account.test.sql';
  assert.ok(existsSync(new URL(fixture, root)));
  let hasPg = false; try { execSync('command -v initdb', { stdio: 'ignore' }); hasPg = true; } catch { /* CI without Postgres */ }
  if (!hasPg) { console.log('   (initdb not on PATH — the fixture ran in tools/run-sql-fixtures.sh before this PR opened; see the PR body)'); return; }
  const out = execSync('bash tools/run-sql-fixtures.sh 2026-09-16-auth-fresh', { cwd: new URL('.', root), encoding: 'utf8', timeout: 240000 });
  assert.match(out, /PASS +2026-09-16-auth-fresh-account\.test\.sql/, out.slice(-600));
});

test('6. no route returns data without a session (live probe with the publishable key; excuses must name an unapplied migration)', async () => {
  const { TABLES, probe, pendingOk } = await import(new URL('tools/check-anon-surface.mjs', root).href);
  const pending = JSON.parse(read('tools/anon-surface-pending.json'));
  assert.deepEqual(pendingOk(pending, new URL('supabase/migrations/', root)), [], 'every excuse names a migration that revokes anon on that table');
  let reachable = false; try { await fetch('https://tseszaprvtvqrkfpditu.supabase.co/auth/v1/health', { signal: AbortSignal.timeout(5000) }); reachable = true; } catch { /* offline */ }
  if (!reachable) { console.log('   (network unavailable — live probe skipped; the weekly anon-surface workflow runs it)'); return; }
  const open: string[] = [];
  for (const t of TABLES) { const p = await probe(t); if (p.rows > 0 && !pending[t]) open.push(`${t} (${p.columns.slice(0, 5).join(',')})`); }
  assert.deepEqual(open, [], 'tables readable anonymously with no closing migration');
});

test('demo and guest doors are gone; the demo roster is never seeded for a real org; the name-save PATCH selects granted columns', () => {
  assert.ok(!/data-demoacct="1"/.test(host), 'no "Use the demo account"');
  assert.ok(!/Continue as a guest/.test(host), 'no guest path on the auth sheet');
  assert.ok(!/completeAuth\(\{\.\.\.SEED\.user/.test(host), 'no code path signs in as the demo user');
  assert.match(host, /S\.teamRoster=queueIsLive\(\)\?\[\]:/, 'a real org starts with an empty roster (gated on the signed-in state since C4, PR #30)');
  assert.match(account, /"&select=id,business_name,bio,sports,location,provider_type,status,onboarding_completed/, 'save() names its returning columns (the 42501 that made the name unsaveable)');
});
