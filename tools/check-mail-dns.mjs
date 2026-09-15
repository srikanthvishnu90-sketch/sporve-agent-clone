#!/usr/bin/env node
// check-mail-dns.mjs — is sporv.ai's mail authentication what we say it is?
//
// External-dependency checklist item 6. docs/deliverability-ramp.md claimed
// DMARC was enforcing (p=quarantine) on 2026-09-06; on 2026-09-15 the live
// record read p=none. A document cannot notice a DNS edit — this can. It
// resolves over DNS-over-HTTPS so it runs the same from a laptop, a sandbox
// that blocks port 53, and GitHub Actions.
//
//   node tools/check-mail-dns.mjs                      # report
//   node tools/check-mail-dns.mjs --require quarantine # exit 1 unless DMARC >= quarantine
//
// Read-only. Never edits DNS. The records it wants are in docs/dns-records.md.
const DOMAIN = process.env.MAIL_ROOT_DOMAIN || 'sporv.ai';
const requireIdx = process.argv.indexOf('--require');
const REQUIRE = requireIdx > -1 ? process.argv[requireIdx + 1] : null;   // 'quarantine' | 'reject'
const RANK = { none: 0, quarantine: 1, reject: 2 };

async function txt(name, type = 'TXT') {
  const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, {
    headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`DoH ${r.status} for ${name}`);
  const j = await r.json();
  return (j.Answer || []).map((a) => String(a.data).replace(/^"|"$/g, '').replace(/"\s*"/g, ''));
}

const rows = [];
let failures = 0;
const row = (record, state, detail, ok) => { rows.push({ record, state, detail }); if (ok === false) failures++; };

// DMARC — the one that changes deliverability the most and the one that drifted.
const dmarc = (await txt(`_dmarc.${DOMAIN}`)).find((v) => /^v=DMARC1/i.test(v));
if (!dmarc) row('DMARC', 'MISSING', `_dmarc.${DOMAIN} has no v=DMARC1 record`, false);
else {
  const p = (/;\s*p=(\w+)/i.exec(dmarc) || [])[1]?.toLowerCase() || 'none';
  const rua = (/rua=([^;]+)/i.exec(dmarc) || [])[1] || '';
  const enough = REQUIRE ? RANK[p] >= (RANK[REQUIRE] ?? 1) : true;
  row('DMARC policy', p, dmarc, enough);
  row('DMARC reports (rua)', rua ? 'set' : 'MISSING', rua || 'no aggregate-report mailbox — nobody sees who is spoofing the domain', !!rua);
}

// SPF on the root and on Resend's return-path subdomain.
for (const host of [DOMAIN, `send.${DOMAIN}`]) {
  const spf = (await txt(host)).find((v) => /^v=spf1/i.test(v));
  row(`SPF ${host}`, spf ? 'present' : 'MISSING', spf || '', !!spf);
}

// DKIM — Resend signs as the root domain with this selector.
const dkim = (await txt(`resend._domainkey.${DOMAIN}`)).find((v) => /p=/.test(v));
row('DKIM resend._domainkey', dkim ? 'present' : 'MISSING', dkim ? `${dkim.slice(0, 40)}…` : '', !!dkim);

// D7 (2026-09-15): tx. transactional, msg. bulk, reply. inbound. Reported,
// not required — they do not exist yet and their absence is an owner action,
// not a regression.
for (const sub of ['tx', 'msg']) {
  const spf = (await txt(`${sub}.${DOMAIN}`)).find((v) => /^v=spf1/i.test(v));
  row(`D7 ${sub}.${DOMAIN} SPF`, spf ? 'present' : 'pending', spf || 'not created yet (docs/dns-records.md)');
}
const mx = await txt(`reply.${DOMAIN}`, 'MX');
row(`D7 reply.${DOMAIN} MX`, mx.length ? 'present' : 'pending', mx.join(' ') || 'no inbound route yet (docs/dns-records.md)');

const w = Math.max(...rows.map((r) => r.record.length));
for (const r of rows) console.log(`${r.record.padEnd(w)}  ${r.state.padEnd(10)}  ${r.detail}`);
console.log(`\n${DOMAIN}: ${failures ? `${failures} problem(s)` : 'mail authentication as expected'}${REQUIRE ? ` (required DMARC >= ${REQUIRE})` : ''}`);
process.exit(failures ? 1 : 0);
