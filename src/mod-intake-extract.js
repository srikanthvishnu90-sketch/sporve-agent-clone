/* mod-intake-extract.js — the deterministic "forward something" extractor.
   ─────────────────────────────────────────────────────────────────────────
   Used by the Queue's "Turn into drafts" box wherever no AI runs (the
   signed-out sample workspace). Pure: text + a small context in, draft
   obligations out. No network, no model, no state, no writes — the host turns
   the result into DRAFT queue rows that still need Approve / Dismiss.

   What it reads out of a forwarded email or text:
     money   — every amount with its unit (per team / per athlete / per player /
               per family / per session / flat), late fees kept apart
     dates   — month-day dates and ranges, bound to what they are for
               (payment due, waiver due, registration closes, event dates,
               schedule change), weekdays resolved inside the event range
     times   — bound to check-in, first games / start, or the session
     names   — the event ("Windy City Shootout"), the venue, the form
   What it drafts:
     Collect  (per-athlete / per-family / per-session amount, unit, due date,
               roster total when the roster size is known; team fees noted)
     Team fee (only when the text has no per-athlete amount)
     Waiver   (form + due date, cross-checked against known missing waivers)
     Event    (name, dates, venue, check-in / start) as a schedule item
     Schedule change + the family message, Registration deadline
   Every draft says what it could not determine. Titles are built from the
   parsed facts, never from truncated raw text.

   Test seam: tests/intake/intake-extract.spec.mjs loads this file in a vm
   context and calls SporvIntakeExtract.extract directly. */
(function (root) {
"use strict";

var MON_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
var WD_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
var WD_LONG = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
var MON_RX = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
var WD_RX = "(Mon|Tues?|Wed(?:nes)?|Thu(?:rs?)?|Fri|Sat(?:ur)?|Sun)(?:day)?(s)?";
var NUMW = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12 };

var K = {
  waiver: /\b(waivers?|release forms?|consent forms?|medical forms?|physicals?|paperwork)\b/i,
  reg: /\b(register|registration|registrations|sign[- ]?ups?|enroll(?:ment)?|rsvp|rosters? (?:are |is )?due|rosters? lock)\b/i,
  pay: /\b(pay|payment|paid|entry|fee|fees|dues|cost|tuition|deposit|balance|payable)\b|\$/i,
  dueish: /\b(due|by|deadline|before|no later than|closes?|payable)\b/i,
  checkin: /\b(check[- ]?in|arriv(?:e|al)|doors open)\b/i,
  start: /\b(first games?|games? (?:start|begin)|tip[- ]?off|starts?|begins?|kick[- ]?off|warm[- ]?ups?)\b/i,
  end: /\b(ends?|until|wrap(?:s)? up|done by)\b/i,
  change: /\b(moved|move|moving|reschedul\w*|changed?|cancel+ed|instead|relocat\w*|swapp?\w*|pushed|now (?:at|on|in))\b/i,
  late: /\blate\b/i,
};

/* ── small helpers ─────────────────────────────────────────────────────── */
function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
function moneyLabel(cents) {
  var d = cents / 100;
  return "$" + (cents % 100 ? d.toFixed(2) : Math.round(d).toLocaleString("en-US"));
}
function monthIndex(word) {
  var w = String(word || "").slice(0, 3).toLowerCase();
  var i = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(w);
  return i;
}
function wdIndex(word) {
  var w = String(word || "").slice(0, 2).toLowerCase();
  return ["su","mo","tu","we","th","fr","sa"].indexOf(w);
}
function refDate(ctx) {
  var t = ctx && ctx.today;
  var d = t ? new Date(String(t).slice(0, 10) + "T12:00:00Z") : new Date();
  return isNaN(d.getTime()) ? new Date() : d;
}
function utc(y, m, d) { return new Date(Date.UTC(y, m, d, 12)); }
function iso(dt) { return dt.toISOString().slice(0, 10); }
function dayLabel(dt, withWd) {
  return (withWd ? WD_SHORT[dt.getUTCDay()] + " " : "") + MON_SHORT[dt.getUTCMonth()] + " " + dt.getUTCDate();
}
function rangeLabel(a, b) {
  if (!b || iso(a) === iso(b)) return dayLabel(a);
  if (a.getUTCMonth() === b.getUTCMonth()) return dayLabel(a) + "–" + b.getUTCDate();
  return dayLabel(a) + "–" + dayLabel(b);
}
function uniq(arr) { var s = {}, out = []; arr.forEach(function (x) { if (!s[x]) { s[x] = 1; out.push(x); } }); return out; }
function toNum(w) { w = String(w || "").toLowerCase(); return NUMW[w] || (/^\d+$/.test(w) ? +w : 0); }

/* Normalise the text the regexes see: a.m./p.m., typographic dashes, spaces. */
function normalise(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\b([ap])\.\s?m\.?/gi, function (_, a) { return a.toLowerCase() + "m"; })
    .replace(/[–—]/g, "-")
    /* "June 9 - July 14" / "5 - 6:30pm" are ranges, not clause breaks */
    .replace(/(\d)\s+-\s+(?=\d|[A-Z][a-z]{2,8}\.?\s+\d)/g, "$1-")
    .replace(/[‘’]/g, "'")
    .replace(/[ \t]+/g, " ")
    .trim();
}
function sentencesOf(t) {
  return t.split(/(?<=[.!?])\s+(?=[A-Z0-9$"'(])|\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
}
function clausesOf(s) {
  return s.split(/[,;]\s+|\s+-\s+|:\s+/).map(function (c) { return c.trim(); }).filter(Boolean);
}

/* ── dates ─────────────────────────────────────────────────────────────── */
function yearFor(m, d, ref, explicit) {
  if (explicit) return { y: +explicit, assumed: false };
  var y = ref.getUTCFullYear();
  /* A date well in the past reads as next year: "Jan 10" forwarded in late
     October is next January, not nine months ago. */
  if (utc(y, m, d).getTime() < ref.getTime() - 60 * 86400000) y += 1;
  return { y: y, assumed: true };
}
function findDates(str, ref) {
  var out = [], m;
  var rx = new RegExp("\\b" + MON_RX + "\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*(?:-|to|through|thru)\\s*(?:" + MON_RX + "\\.?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?)?(?:,?\\s*(\\d{4}))?\\b", "gi");
  while ((m = rx.exec(str))) {
    var mi = monthIndex(m[1]), d1 = +m[2];
    if (mi < 0 || d1 < 1 || d1 > 31) continue;
    var yy = yearFor(mi, d1, ref, m[5]);
    var start = utc(yy.y, mi, d1), end = null;
    if (m[4]) {
      var mi2 = m[3] ? monthIndex(m[3]) : mi, d2 = +m[4];
      if (d2 >= 1 && d2 <= 31) {
        end = utc(yy.y + (mi2 < mi ? 1 : 0), mi2, d2);
        if (end < start) end = null;
      }
    }
    out.push({ index: m.index, end: m.index + m[0].length, raw: m[0], start: start, endDate: end, yearAssumed: yy.assumed });
  }
  var nrx = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
  while ((m = nrx.exec(str))) {
    var mo = +m[1] - 1, da = +m[2];
    if (mo < 0 || mo > 11 || da < 1 || da > 31) continue;
    var ex = m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : null;
    var y2 = yearFor(mo, da, ref, ex);
    out.push({ index: m.index, end: m.index + m[0].length, raw: m[0], start: utc(y2.y, mo, da), endDate: null, yearAssumed: y2.assumed });
  }
  return out.sort(function (a, b) { return a.index - b.index; });
}
function findWeekdays(str) {
  var out = [], m, rx = new RegExp("\\b" + WD_RX + "\\b", "gi");
  while ((m = rx.exec(str))) {
    var i = wdIndex(m[1]);
    if (i < 0) continue;
    /* "Sat" inside "Saturday" is one match; "Mon" as in "Mon 14" stays. */
    out.push({ index: m.index, wd: i, plural: !!m[3] || /days$/i.test(m[0]), raw: m[0] });
  }
  return out;
}

/* ── times ─────────────────────────────────────────────────────────────── */
function fmtTime(h, mm, ap) {
  return h + (mm && mm !== "00" ? ":" + mm : (mm === "00" ? ":00" : "")) + (ap || "");
}
function findTimes(str) {
  var out = [], m;
  var rx = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(noon)\b/gi;
  while ((m = rx.exec(str))) {
    if (m[4]) {
      var ap2 = m[6].toLowerCase(), ap1 = m[3] ? m[3].toLowerCase() : "";
      out.push({ index: m.index, label: fmtTime(m[1], m[2], ap1 && ap1 !== ap2 ? ap1 : "") + "–" + fmtTime(m[4], m[5], ap2), range: true });
    } else if (m[7]) {
      out.push({ index: m.index, label: fmtTime(m[7], m[8], m[9].toLowerCase()), range: false });
    } else if (m[10]) {
      out.push({ index: m.index, label: "noon", range: false });
    }
  }
  return out;
}

/* ── money ─────────────────────────────────────────────────────────────── */
var ATHLETE_WORDS = /^(athlete|player|kid|child|participant|camper|swimmer|wrestler|skater|gymnast|dancer|person|head|student)$/;
var SESSION_WORDS = /^(session|class|clinic|lesson|day|week|month|night|game|practice)$/;
function unitClass(word) {
  if (!word) return "flat";
  if (word === "team") return "team";
  if (word === "family" || word === "household") return "family";
  if (ATHLETE_WORDS.test(word)) return "athlete";
  if (SESSION_WORDS.test(word)) return "session";
  if (word === "each") return "each";
  return "flat";
}
function singular(w) {
  w = String(w || "").toLowerCase();
  if (w === "families") return "family";
  if (w === "children") return "child";
  if (w === "classes") return "class";
  return w.replace(/s$/, "");
}
function findMoney(t) {
  var out = [], m, rx = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g;
  var UNIT = "(team|athlete|player|kid|child|children|participant|camper|swimmer|wrestler|skater|gymnast|dancer|person|head|student|family|families|household|session|class|classes|clinic|lesson|day|week|month|night|game|practice)s?";
  var after = new RegExp("^\\s*(?:\\/\\s*|per\\s+|a\\s+|an\\s+|for each\\s+|each\\s+|every\\s+)?" + UNIT + "\\b", "i");
  var before = new RegExp("\\b" + UNIT + "\\s+(?:entry|entry fee|fee|cost|price|dues)\\s*(?:is|of|:|=)?\\s*$", "i");
  var perBefore = new RegExp("\\bper[- ]" + UNIT + "\\s+(?:entry|entry fee|fee|cost|price|dues)?\\s*(?:is|of|:|=)?\\s*$", "i");
  while ((m = rx.exec(t))) {
    var cents = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
    if (!(cents > 0)) continue;
    var tail = t.slice(m.index + m[0].length, m.index + m[0].length + 30);
    var head = t.slice(Math.max(0, m.index - 30), m.index);
    var u = null, um;
    if ((um = tail.match(after))) u = singular(um[1]);
    else if (/^\s*each\b/i.test(tail)) u = "each";
    else if ((um = head.match(perBefore)) || (um = head.match(before))) u = singular(um[1]);
    out.push({
      index: m.index, cents: cents, unitWord: u, unit: unitClass(u),
      late: K.late.test(head.slice(-20)) || /^\s*late\b/i.test(tail),
    });
  }
  /* the same amount + unit said twice is one fact */
  var seen = {};
  return out.filter(function (x) { var k = x.cents + "|" + x.unit + "|" + x.late; if (seen[k]) return false; seen[k] = 1; return true; });
}

/* ── names ─────────────────────────────────────────────────────────────── */
var EV_WORDS = "Shootout|Classic|Tournament|Invitational|Showcase|Cup|Camp|Clinic|Jamboree|Tryouts?|League|Festival|Combine|Challenge|Championships?|Meet|Series|Slam|Jam|Bash|Open|Hoopfest";
var LEAD_STOP = /^(hi|hey|hello|dear|fwd|fw|re|the|our|your|this|all|reminder|update|coaches|coach|team|teams|for|and)$/i;
function findEvent(t) {
  var rx = new RegExp("((?:[A-Z0-9][\\w'&]*\\s+){1,5}(?:" + EV_WORDS + "))\\b", "g"), m;
  while ((m = rx.exec(t))) {
    var words = m[1].split(/\s+/);
    while (words.length > 1 && LEAD_STOP.test(words[0])) words.shift();
    if (words.length >= 2 || !LEAD_STOP.test(words[0])) {
      var name = words.join(" ");
      if (name.split(/\s+/).length >= 2) return { name: name, index: m.index + m[1].indexOf(name) };
    }
  }
  var sub = t.match(/^(?:subject|fwd|fw|re):\s*([^\n]{3,60})$/im);
  if (sub) return { name: sub[1].replace(/\s*[-|].*$/, "").trim(), index: sub.index };
  return null;
}
var NOT_PLACE = new RegExp("^(?:" + MON_RX + "|" + WD_RX + "|Noon|Check|Entry|Every|First|Registration|Payment)$", "i");
function findPlaces(t) {
  var out = [], m;
  var rx = /(?:\bat|@|\bvenue:?|\blocation:?|\bmoved to|\bnow at|\brelocated to)\s+((?:the\s+)?[A-Z][\w'&-]*(?:\s+(?:[A-Z0-9][\w'&-]*|of|the|and|&|on))*)/g;
  while ((m = rx.exec(t))) {
    var p = m[1].replace(/\s+(?:on|and|the|of|&)$/i, "").trim();
    var first = p.replace(/^the\s+/i, "").split(/\s+/)[0];
    if (NOT_PLACE.test(first)) continue;
    out.push({ index: m.index, name: p });
  }
  var rx2 = /\b(?:in|at)\s+(the\s+[a-z][\w'-]*(?:\s+[a-z][\w'-]*){0,3}?\s+(?:gym|court|field|room|rink|pool|hall|center|centre|complex|park|fieldhouse|gymnasium))\b/gi;
  while ((m = rx2.exec(t))) out.push({ index: m.index, name: m[1].trim() });
  return out.sort(function (a, b) { return a.index - b.index; });
}
function findForm(t) {
  var m = t.match(/\b((?:signed\s+)?(?:(?:liability|medical|photo|media|concussion|participation|parental|parent|tournament|player|athlete|insurance)\s+)?(?:waivers?|release forms?|consent forms?|medical forms?|physicals?))\b/i);
  if (!m) return null;
  return singular(m[1].toLowerCase().replace(/\s+/g, " ")).replace(/forms$/, "form");
}

/* ── binding: what is each date / time for? ────────────────────────────── */
function datePurpose(clause, sentence, isRange, eventName) {
  if (K.waiver.test(clause)) return "waiver";
  if (K.reg.test(clause)) return "registration";
  if (K.checkin.test(clause)) return "checkin";
  if (K.pay.test(clause) && K.dueish.test(clause)) return "payment";
  if (K.change.test(clause)) return "change";
  if (K.dueish.test(clause)) {
    if (K.waiver.test(sentence)) return "waiver";
    if (K.reg.test(sentence)) return "registration";
    if (K.pay.test(sentence)) return "payment";
    return "deadline";
  }
  if (K.change.test(sentence)) return "change";
  if (isRange || (eventName && sentence.indexOf(eventName) >= 0)) return "event";
  return "date";
}
function timePurpose(before) {
  /* the keyword nearest BEFORE the time, inside its clause, wins */
  var best = null, bestAt = -1;
  [["checkin", K.checkin], ["start", K.start], ["end", K.end]].forEach(function (p) {
    var rx = new RegExp(p[1].source, "gi"), m;
    while ((m = rx.exec(before))) { if (m.index > bestAt) { bestAt = m.index; best = p[0]; } }
  });
  return best || "time";
}

/* ── the extractor ─────────────────────────────────────────────────────── */
function extract(text, ctx) {
  ctx = ctx || {};
  var t = normalise(text);
  if (!t) return { facts: null, drafts: [] };
  var ref = refDate(ctx);
  var sentences = sentencesOf(t);
  var ev = findEvent(t);
  var eventName = ev ? ev.name : null;

  /* dates + times, bound clause by clause */
  var dates = [], times = [], weekdays = [];
  sentences.forEach(function (s, si) {
    clausesOf(s).forEach(function (c) {
      findDates(c, ref).forEach(function (d) {
        d.purpose = datePurpose(c, s, !!d.endDate, eventName);
        d.sentence = si; d.clause = c;
        dates.push(d);
      });
      var wds = findWeekdays(c);
      wds.forEach(function (w) { w.sentence = si; w.clause = c; weekdays.push(w); });
      findTimes(c).forEach(function (tm) {
        tm.purpose = timePurpose(c.slice(0, tm.index));
        tm.weekday = wds.length ? wds[0] : null;
        tm.sentence = si; tm.clause = c;
        times.push(tm);
      });
    });
  });
  var first = function (p) { for (var i = 0; i < dates.length; i++) if (dates[i].purpose === p) return dates[i]; return null; };
  var eventDate = first("event") || dates.filter(function (d) { return d.endDate; })[0] || null;
  if (!eventDate && eventName) {
    /* a lone date in the sentence that names the event is the event date */
    var evS = -1; sentences.forEach(function (s, i) { if (evS < 0 && s.indexOf(eventName) >= 0) evS = i; });
    eventDate = dates.filter(function (d) { return d.sentence === evS && d.purpose === "date"; })[0] || null;
  }
  var payDue = first("payment"), waiverDue = first("waiver"), regDue = first("registration"), genericDue = first("deadline");
  var resolveWd = function (w) {
    if (!w || !eventDate) return null;
    var a = eventDate.start, b = eventDate.endDate || eventDate.start;
    for (var d = new Date(a.getTime()); d <= b; d = new Date(d.getTime() + 86400000)) if (d.getUTCDay() === w.wd) return d;
    return null;
  };
  var timeLabel = function (tm) {
    var day = tm.weekday ? (tm.weekday.plural ? WD_LONG[tm.weekday.wd] + "s" : (resolveWd(tm.weekday) ? dayLabel(resolveWd(tm.weekday), true) : WD_LONG[tm.weekday.wd])) : "";
    return tm.label + (day ? " " + day : "");
  };

  /* places: prefer one in the event's sentence */
  var places = findPlaces(t);
  var evSentence = eventDate ? eventDate.sentence : -1;
  var place = null;
  if (places.length) {
    var offs = 0, bounds = sentences.map(function (s) { var i = t.indexOf(s, offs); offs = i + s.length; return [i, i + s.length]; });
    place = places.filter(function (p) { var b = bounds[evSentence]; return b && p.index >= b[0] && p.index < b[1]; })[0] || null;
    if (!place) place = places.filter(function (p) { return !/^the\s+[a-z]/.test(p.name); })[0] || places[0];
  }

  var amounts = findMoney(t);
  var teamsList = uniq((t.match(/\b\d{1,2}U\b/g) || []));
  var teamCountM = t.match(/\b(\d+|two|three|four|five|six)\s+teams\b/i);
  var teamCount = teamsList.length > 1 ? teamsList.length : (teamCountM ? toNum(teamCountM[1]) : 0);
  var sessCountM = t.match(/\b(\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(sessions|classes|clinics|lessons|days|weeks|nights|games|practices)\b/i);
  var sessCount = sessCountM ? toNum(sessCountM[1]) : 0;
  var form = findForm(t);
  var everyAthlete = /\b(every|each|all)\s+(athletes?|players?|kids?|campers?|participants?)\b/i.test(t);
  var hasUrl = /\bhttps?:\/\/|\bwww\.|\b[\w-]+\.(?:org|com|net)\b/i.test(t);
  var roster = +ctx.rosterCount || 0;
  var families = +ctx.familyCount || roster;
  var evLabel = eventName || "the forwarded event";
  var drafts = [];

  /* ── Collect: the per-athlete / per-family / per-session amount ── */
  var notLate = amounts.filter(function (a) { return !a.late; });
  var lateFees = amounts.filter(function (a) { return a.late; });
  var pick = function (u) { return notLate.filter(function (a) { return a.unit === u; })[0] || null; };
  var collect = pick("athlete") || pick("family") || pick("session") || pick("each") || null;
  var teamFee = pick("team");
  var flats = notLate.filter(function (a) { return a.unit === "flat"; });
  if (!collect && !teamFee && flats.length) collect = flats[0];
  var dueFor = function (pref) {
    if (pref) return { label: "due " + dayLabel(pref.start), iso: iso(pref.start) };
    if (regDue) return { label: "by " + dayLabel(regDue.start) + " (registration closes)", iso: iso(regDue.start) };
    if (genericDue) return { label: "due " + dayLabel(genericDue.start), iso: iso(genericDue.start) };
    return null;
  };
  if (collect) {
    var due = dueFor(payDue);
    var unitText = collect.unit === "flat" ? "" : collect.unit === "each" ? " each" : " per " + collect.unitWord;
    var lines = [], unknown = [];
    if (collect.unit === "athlete" || collect.unit === "each") {
      if (roster) lines.push(roster + " rostered athletes x " + moneyLabel(collect.cents) + " = " + moneyLabel(collect.cents * roster) + " if all of them take part.");
      unknown.push(roster ? "who is attending — the total assumes all " + roster + " rostered athletes" : "how many athletes are attending");
      if (collect.unit === "each") unknown.push("whether \"each\" means each athlete or each family");
    } else if (collect.unit === "family") {
      if (families) lines.push(families + " families x " + moneyLabel(collect.cents) + " = " + moneyLabel(collect.cents * families) + ".");
      else unknown.push("how many families this applies to");
    } else if (collect.unit === "session") {
      if (sessCount) lines.push(sessCount + " " + collect.unitWord + "s x " + moneyLabel(collect.cents) + " = " + moneyLabel(collect.cents * sessCount) + " per athlete for the full run.");
      else unknown.push("how many " + collect.unitWord + "s each athlete attends");
    } else {
      unknown.push("who pays " + moneyLabel(collect.cents) + " — the text does not say per athlete, per family or per team");
    }
    if (teamFee) {
      lines.push("Team entry " + moneyLabel(teamFee.cents) + " per team is the club's fee to the organizer" +
        (teamCount > 1 ? " (" + teamCount + " teams = " + moneyLabel(teamFee.cents * teamCount) + ")" : "") + " — noted here, not charged to families.");
    }
    flats.filter(function (a) { return a !== collect; }).forEach(function (a) {
      lines.push("Also in the text: " + moneyLabel(a.cents) + " with no unit stated (for example a bundle price) — not drafted.");
    });
    lateFees.forEach(function (a) { lines.push("Late fee in the text: " + moneyLabel(a.cents) + " — not drafted; only applies if you miss the deadline."); });
    if (!due) unknown.push("the payment due date");
    if (!eventName) unknown.push("the event name");
    lines.push("Draft only — nothing is charged and no family is asked to pay until you approve.");
    drafts.push({
      kind: "fee",
      title: "Collect " + moneyLabel(collect.cents) + unitText + " — " + evLabel + (due ? ", " + due.label : ""),
      detail: lines.join("\n"), unknown: unknown,
      amountCents: collect.cents, unit: collect.unit, unitWord: collect.unitWord || null, dueISO: due ? due.iso : null,
    });
  } else if (teamFee) {
    var dueT = dueFor(payDue), lt = [], ut = [];
    lt.push((teamCount > 1 ? teamCount + " teams" + (teamsList.length > 1 ? " (" + teamsList.join(", ") + ")" : "") + " x " + moneyLabel(teamFee.cents) + " = " + moneyLabel(teamFee.cents * teamCount) : "One team x " + moneyLabel(teamFee.cents)) + " owed by the club to the organizer.");
    lt.push("No per-athlete amount in the text, so no family charge was drafted.");
    if (!teamCount) ut.push("how many teams you are entering — assumed one");
    if (!dueT) ut.push("the payment due date");
    drafts.push({
      kind: "deadline",
      title: "Pay " + moneyLabel(teamFee.cents) + " per team entry — " + evLabel + (dueT ? ", " + dueT.label : ""),
      detail: lt.join("\n"), unknown: ut,
      amountCents: teamFee.cents * Math.max(1, teamCount), unit: "team", dueISO: dueT ? dueT.iso : null,
    });
  }

  /* ── Waiver ── */
  if (form || K.waiver.test(t)) {
    var fname = form || "waiver";
    var lw = [], uw = [];
    var gap = ctx.missingWaivers;
    if (gap && gap.count) lw.push("Your roster already has " + gap.count + " athlete" + (gap.count === 1 ? "" : "s") + " with no waiver on file" + (gap.names ? " (" + gap.names + ")" : "") + " — start with them.");
    else if (roster) lw.push("Check all " + roster + " rostered athletes; Sporv has no waiver status to cross-check against.");
    if (!waiverDue) uw.push("when the " + fname + " is due");
    if (/\bupload/i.test(t) && !hasUrl) uw.push("where to upload it — the text has no link");
    if (!form) uw.push("which form — the text only says waiver");
    lw.push("Draft only — no reminder goes to families until you approve.");
    drafts.push({
      kind: "waiver",
      title: cap(fname) + (everyAthlete ? " for every athlete" : "") + " — " + evLabel + (waiverDue ? ", due " + dayLabel(waiverDue.start) : ""),
      detail: lw.join("\n"), unknown: uw, dueISO: waiverDue ? iso(waiverDue.start) : null,
    });
  }

  /* ── Schedule change (+ the family message) ── */
  var changeSentence = sentences.filter(function (s) { return /\b(moved to|moving to|reschedul\w*|changed? to|pushed to|instead|now (?:at|on|in)|relocat\w*|cancel+ed)\b/i.test(s); })[0];
  if (changeSentence) {
    var split = changeSentence.search(/\b(moved to|moving to|rescheduled to|rescheduled for|changed? to|pushed to|instead|now (?:at|on|in)|relocated to|will be)\b/i);
    var beforeS = split > 0 ? changeSentence.slice(0, split) : "", afterS = split >= 0 ? changeSentence.slice(split) : changeSentence;
    var what = (changeSentence.match(/\b(practice|game|scrimmage|session|class|tryouts?|clinic|lift|workout|photos?)\b/i) || t.match(/\b(practice|game|scrimmage|session|class|tryouts?|clinic|lift|workout)\b/i) || [null, "session"])[1].toLowerCase();
    var mismatch = [];
    var describe = function (seg) {
      var bits = [];
      var d = findDates(seg, ref)[0], w = findWeekdays(seg)[0], tm = findTimes(seg)[0], pl = findPlaces(seg)[0];
      /* "Thursday Nov 6" when Nov 6 is a Friday: say so, never silently pick one */
      var clash = d && w && w.wd !== d.start.getUTCDay() ? WD_LONG[w.wd] + " " + dayLabel(d.start) + ", but " + dayLabel(d.start) + " " + d.start.getUTCFullYear() + " is a " + WD_LONG[d.start.getUTCDay()] : null;
      if (clash) mismatch.push(clash);
      if (d) bits.push(clash ? WD_LONG[w.wd] + " " + dayLabel(d.start) : dayLabel(d.start, true));
      else if (w) bits.push(WD_LONG[w.wd]);
      if (tm) bits.push(tm.label);
      var dayTime = bits.join(", ");
      return { text: dayTime + (pl ? (dayTime ? " " : "") + (/^the\s/i.test(pl.name) ? "in " : "at ") + pl.name : ""), has: !!(d || w || tm || pl), place: !!pl, when: !!(d || w || tm) };
    };
    /* the old slot may sit in the sentence before the change sentence */
    var ci = sentences.indexOf(changeSentence);
    var oldD = describe(beforeS);
    if (!oldD.has && ci > 0) oldD = describe(sentences[ci - 1]);
    var newD = describe(afterS);
    var cancelled = /\bcancel+ed\b/i.test(changeSentence) && !newD.has;
    var oldTxt = (oldD.has ? oldD.text + " " : "") + what;
    var lc = [], uc = [];
    if (!oldD.has) uc.push("which " + what + " this replaces");
    if (!cancelled && !newD.when) uc.push("the new day or time");
    if (!cancelled && !newD.place) uc.push("the venue — assumed unchanged");
    mismatch.forEach(function (m) { uc.push("the right date — the text says " + m); });
    lc.push("Draft only — your calendar and families are not changed until you approve.");
    drafts.push({
      kind: "schedule",
      title: cancelled ? "Schedule change: " + cap(oldTxt) + " is cancelled" : "Schedule change: " + cap(oldTxt) + " moves to " + (newD.text || "a new slot"),
      detail: lc.join("\n"), unknown: uc,
    });
    drafts.push({
      kind: "message",
      title: "Tell families: " + (cancelled ? cap(oldTxt) + " is cancelled" : cap(what) + " moves to " + (newD.text || "a new slot")),
      detail: (families ? "Drafted for the " + families + " rostered families" : "Drafted for the families on this team") + " — nothing sends until you approve.",
      unknown: [],
    });
  }

  /* ── Event (schedule item) ── */
  if (!changeSentence && (eventDate || (eventName && (place || times.length)))) {
    var le = [], ue = [];
    var checkin = times.filter(function (x) { return x.purpose === "checkin"; })[0];
    var starts = times.filter(function (x) { return x.purpose === "start"; })[0];
    var other = times.filter(function (x) { return x.purpose === "time"; })[0];
    var tl = [];
    if (checkin) tl.push("Check-in " + timeLabel(checkin));
    if (starts) tl.push("first games " + timeLabel(starts).replace(/^/, ""));
    var pluralWd = weekdays.filter(function (w) { return w.plural; })[0];
    if (!checkin && !starts && other) tl.push((other.weekday || !pluralWd ? "Time " : WD_LONG[pluralWd.wd] + "s ") + timeLabel(other));
    if (!tl.length) {
      var wdOnly = weekdays.filter(function (w) { return w.plural; })[0];
      if (wdOnly) tl.push("Runs on " + WD_LONG[wdOnly.wd] + "s");
    }
    if (tl.length) le.push(tl.join(" · ") + ".");
    if (!eventDate) ue.push("the event dates");
    if (!place) ue.push("the venue");
    if (!checkin && !starts && !other) ue.push("check-in or start time");
    if (!eventName) ue.push("the event name");
    if (eventDate && eventDate.yearAssumed) ue.push("the year — read as " + eventDate.start.getUTCFullYear());
    le.push("Schedule item — nothing is published to families from here.");
    drafts.push({
      kind: "schedule",
      title: (eventName || "Event") + (eventDate ? " — " + rangeLabel(eventDate.start, eventDate.endDate) : "") + (place ? " at " + place.name : ""),
      detail: le.join("\n"), unknown: ue,
      startISO: eventDate ? iso(eventDate.start) : null, endISO: eventDate && eventDate.endDate ? iso(eventDate.endDate) : null,
      location: place ? place.name : null,
    });
  } else if (!changeSentence && !drafts.length && (weekdays.length || times.length)) {
    /* "team photos Saturday 9am at the gym" — a dated item with no event name */
    var w0 = weekdays[0], t0 = times[0];
    var whenTxt = [w0 ? WD_LONG[w0.wd] : "", t0 ? t0.label : ""].filter(Boolean).join(" ");
    var topic = (t.match(/\b(team photos?|picture day|meeting|parent meeting|banquet|fundraiser|practice|game|scrimmage|tryouts?)\b/i) || [null, null])[1];
    drafts.push({
      kind: "schedule",
      title: (topic ? cap(topic.toLowerCase()) : "Schedule item") + " — " + whenTxt + (place ? " at " + place.name : ""),
      detail: "Schedule item — nothing is published to families from here.",
      unknown: [!topic ? "what the item is" : null, !place ? "the venue" : null, w0 && !dates.length ? "the exact date — only a weekday is given" : null].filter(Boolean),
    });
  }

  /* ── Registration deadline / other deadlines ── */
  if (regDue) {
    drafts.push({
      kind: "deadline",
      title: (/rosters?/i.test(regDue.clause) ? "Rosters due " : "Registration closes ") + dayLabel(regDue.start) + " — " + evLabel,
      detail: "Dated so it surfaces before it lapses.",
      unknown: eventName ? [] : ["the event name"], dueISO: iso(regDue.start),
    });
  }
  if (genericDue && !collect && !teamFee) {
    drafts.push({
      kind: "deadline",
      title: "Deadline " + dayLabel(genericDue.start) + " — " + evLabel,
      detail: "Dated so it surfaces before it lapses.", unknown: [], dueISO: iso(genericDue.start),
    });
  }

  /* ── nothing recognisable: one honest message draft ── */
  if (!drafts.length) {
    drafts.push({
      kind: "message",
      title: "Review this message — no fee, form, event or date found",
      detail: "Nothing in the text matched an amount, a waiver, a date or a schedule change, so nothing was drafted to collect or schedule.",
      unknown: ["what action this needs"],
    });
  } else if (!amounts.length && /\b(fee|fees|entry|dues|cost|payment|pay)\b/i.test(t)) {
    drafts[0].unknown = (drafts[0].unknown || []).concat(["any fee — no amount in the text, so no charge was drafted"]);
  }

  return {
    facts: {
      event: eventName, location: place ? place.name : null,
      amounts: amounts.map(function (a) { return { cents: a.cents, unit: a.unit, unitWord: a.unitWord, late: a.late }; }),
      dates: dates.map(function (d) { return { purpose: d.purpose, start: iso(d.start), end: d.endDate ? iso(d.endDate) : null }; }),
      times: times.map(function (x) { return { purpose: x.purpose, label: timeLabel(x) }; }),
      form: form, teams: teamCount,
    },
    drafts: drafts,
  };
}

root.SporvIntakeExtract = { extract: extract, _moneyLabel: moneyLabel };
})(typeof window !== "undefined" ? window : globalThis);
