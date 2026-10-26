/* mod-sample-answers.js — the signed-out coach preview's assistant.
   ─────────────────────────────────────────────────────────────────────────
   A signed-out visitor in the sample workspace ("Northside Flight
   Basketball") has no account, so the real assistant (coach-command) cannot
   run for them. Before this module, their question fell through to the
   retired family-marketplace catalogue matcher and answered "No coach has
   cleared a background check yet ... Join the waitlist" to "Which families
   owe money?" — wrong product, wrong question.

   This is a deterministic responder: no model call, no network, no writes.
   It answers the common coach questions from the SAME sample data the preview
   already renders: the club (teams, roster, dues, waivers, events) is the one
   sample model in mod-preview.js (MOD_PREVIEW.model()); the Queue drafts and
   the recruiting sample board ride beside it. Every answer opens with the
   label saying exactly that.

   Pure: answer(question, snapshot) -> {text, intents}. The host builds the
   snapshot (sampleWorkspaceSnapshot in sporve-web.host.html). Unit tests:
   tests/intake/sample-answers.spec.mjs. */
(function (root) {
"use strict";

var LABEL = "Sample workspace — this answer comes from the example data, not the AI. Sign in to ask about your own program.";
var SUGGEST = ["Which families owe money and how much?", "Who is missing a waiver?", "What's on the schedule this week?"];

function money(n) { return "$" + Number(n).toLocaleString("en-US"); }
function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
var WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dLabel(isoDay) {
  var d = new Date(String(isoDay).slice(0, 10) + "T12:00:00Z");
  return isNaN(d) ? String(isoDay) : WD[d.getUTCDay()] + " " + MON[d.getUTCMonth()] + " " + d.getUTCDate();
}
function addDays(isoDay, n) {
  var d = new Date(String(isoDay).slice(0, 10) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function drafts(snap, kind) {
  return (snap.queue || []).filter(function (o) { return o && o.status === "draft" && (!kind || o.kind === kind); });
}

/* Order matters only for ties; every matched intent is answered. */
var INTENTS = [
  ["dues", /\b(owe|owes|owed|owing|overdue|unpaid|dues|balance|outstanding|paid|payments?|money|collect|fees?|behind)\b/i],
  ["waivers", /\b(waivers?|forms?|consent|release|paperwork|signed)\b/i],
  ["conflicts", /\b(conflicts?|double[- ]?book\w*|clash\w*|overlap\w*)\b/i],
  ["schedule", /\b(today|tonight|tomorrow|this week|next week|schedule|calendar|practices?|games?|upcoming|on deck|what'?s on|events?|tryouts?)\b/i],
  ["roster", /\b(roster|how many (athletes|players|kids)|team size|available|availability|who'?s on|players|athletes)\b/i],
  ["recruits", /\b(recruits?|recruiting|prospects?|rank\w*|top (players|prospects|recruits)|pipeline|commit\w*|offers?|signees?)\b/i],
  ["queue", /\b(queue|approve|approvals?|drafts?|pending|to[- ]?do)\b/i],
];

function duesAnswer(s) {
  var t = s.totals || {}, late = s.overdue || [];
  var out = [];
  if (late.length) {
    out.push("**Dues (" + (s.season || "this season") + "):** " + late.length + " " + (late.length === 1 ? "family is" : "families are") +
      " overdue, " + money(t.overdue) + " in total.");
    late.forEach(function (a) {
      out.push("- " + a.guardian + " (" + a.name + ", " + a.team + "): " + money(a.owed) + ", " + a.daysLate + " days late");
    });
  } else {
    out.push("**Dues (" + (s.season || "this season") + "):** no family is overdue.");
  }
  out.push(money(t.collected) + " of " + money(t.billed) + " billed has been collected; " + money(t.upcoming) +
    " is not yet due (installment " + (s.installments || 3) + " of " + (s.installments || 3) + ", due " + dLabel(s.nextDue) + ").");
  var fees = drafts(s, "fee");
  if (fees.length) {
    out.push("Also waiting in the Queue, not yet requested from anyone:");
    fees.forEach(function (o) {
      var m = /\$(\d[\d,]*)/.exec(o.title || ""), f = /(\d+)\s+families/.exec(o.title || "");
      var total = m && f ? " (" + money(+m[1].replace(/,/g, "") * +f[1]) + " if approved)" : "";
      out.push("- " + o.title + total);
    });
    out.push("Nothing is charged until you approve a draft.");
  }
  return out.join("\n");
}
function waiversAnswer(s) {
  var mw = s.missingWaivers || [];
  if (!mw.length) return "**Waivers:** every athlete on both rosters has a signed waiver on file.";
  var out = ["**Waivers:** " + plural(mw.length, "athlete") + " have no signed waiver on file:"];
  mw.forEach(function (a) { out.push("- " + a.name + " (" + a.team + ", guardian " + a.guardian + ")"); });
  var w = drafts(s, "waiver");
  if (w.length) out.push("A follow-up for them is already drafted in the Queue: " + w[0].title + ".");
  return out.join("\n");
}
function conflictsAnswer(s) {
  var ev = (s.events || []).filter(function (e) { return e.conflict; });
  var q = drafts(s, "schedule").filter(function (o) { return /conflict|double/i.test(o.title + " " + (o.detail || "")); });
  if (!ev.length && !q.length) return "**Schedule conflicts:** none in the sample calendar.";
  var out = ["**Schedule conflicts:**"];
  ev.forEach(function (e) { out.push("- " + dLabel(e.date) + ", " + e.time + " " + e.title + " at " + e.where + (e.note ? ": " + e.note : "")); });
  if (q.length) out.push("The fix is drafted in the Queue: " + q[0].title + ".");
  return out.join("\n");
}
function evLine(e, withDay) {
  return "- " + (withDay ? dLabel(e.date) + ", " : "") + e.time + " " + e.title + " — " + e.where + (e.conflict ? " (conflict)" : "");
}
function scheduleAnswer(s, q) {
  var today = s.today, end = addDays(today, 6);
  var all = (s.events || []).slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
  var items = all.filter(function (e) { return e.date >= today && e.date <= end; });
  var out = [];
  if (/\b(today|tonight)\b/i.test(q)) {
    var t = items.filter(function (e) { return e.date === today; });
    out.push("**Today in the sample calendar (" + dLabel(today) + "):**" + (t.length ? "" : " nothing scheduled."));
    t.forEach(function (e) { out.push(evLine(e, false)); });
    var next = all.filter(function (e) { return e.date > today; })[0];
    if (next) out.push("Next up: " + dLabel(next.date) + ", " + next.time + " " + next.title + " at " + next.where + ".");
  } else {
    out.push("**This week in the sample calendar (" + dLabel(today) + " to " + dLabel(end) + "):**");
    if (!items.length) out.push("- nothing scheduled");
    items.forEach(function (e) { out.push(evLine(e, true)); });
    var later = all.filter(function (e) { return e.date > end; })[0];
    if (later) out.push("After that: " + later.title + " on " + dLabel(later.date) + ".");
  }
  return out.join("\n");
}
function rosterAnswer(s) {
  var r = s.roster || [], teams = s.teams || [];
  var out = ["**Rosters:** " + plural(r.length, "athlete") + " across " + teams.map(function (t) { return t.short; }).join(" and ") + "."];
  teams.forEach(function (t) {
    var m = r.filter(function (a) { return a.team === t.short; });
    var paid = m.filter(function (a) { return a.paid; }).length;
    out.push("- " + t.name + ": " + m.length + " athletes, coach " + t.coach + ", " + paid + " of " + m.length + " paid to date, " +
      plural(t.missingWaivers.length, "waiver") + " missing");
  });
  return out.join("\n");
}
function recruitsAnswer(s) {
  var R = s.recruits || [];
  if (!R.length) return "**Recruits:** the sample recruiting board is empty.";
  var active = R.filter(function (x) { return x.stage !== "closed" && x.stage !== "signed"; });
  var ranked = active.filter(function (x) { return x.overall != null; }).sort(function (a, b) { return b.overall - a.overall; }).slice(0, 3);
  var out = ["**Recruits (sample " + (s.recruitSport ? s.recruitSport + " " : "") + "board):** " + R.length + " prospects, " + active.length + " still active in the pipeline."];
  if (ranked.length) {
    out.push("Top by average evaluation score (out of 5):");
    ranked.forEach(function (x, i) {
      out.push("- " + (i + 1) + ". " + x.name + " — " + x.position + ", class of " + x.gradYear + ", " + x.stage + " stage, " + x.overall.toFixed(2));
    });
  }
  return out.join("\n");
}
function queueAnswer(s) {
  var d = drafts(s);
  if (!d.length) return "**Queue:** nothing waiting for review.";
  var out = ["**Queue:** " + plural(d.length, "draft") + " waiting for your review:"];
  d.forEach(function (o) { out.push("- " + o.title); });
  return out.join("\n");
}
var ANSWER = { dues: duesAnswer, waivers: waiversAnswer, conflicts: conflictsAnswer, schedule: scheduleAnswer, roster: rosterAnswer, recruits: recruitsAnswer, queue: queueAnswer };

function answer(question, snap) {
  var q = String(question || "");
  var hit = INTENTS.filter(function (it) { return it[1].test(q); }).map(function (it) { return it[0]; });
  /* "how many players have paid" is a dues question, not a roster one */
  if (hit.indexOf("dues") >= 0) hit = hit.filter(function (h) { return h !== "roster"; });
  /* a conflict question is answered by the conflict section alone */
  if (hit.indexOf("conflicts") >= 0) hit = hit.filter(function (h) { return h !== "schedule"; });
  if (hit.indexOf("recruits") >= 0) hit = hit.filter(function (h) { return h !== "roster" && h !== "queue"; });
  hit = hit.slice(0, 2);
  if (!hit.length) {
    return {
      intents: [],
      text: LABEL + "\n\nThe sample workspace can only answer a few questions from its example data, and that one is not among them. Try:\n" +
        SUGGEST.map(function (x) { return "- " + x; }).join("\n"),
    };
  }
  return { intents: hit, text: LABEL + "\n\n" + hit.map(function (h) { return ANSWER[h](snap || {}, q); }).join("\n\n") };
}

root.SporvSampleAnswers = { answer: answer, LABEL: LABEL, SUGGEST: SUGGEST };
})(typeof window !== "undefined" ? window : globalThis);
