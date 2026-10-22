"use strict";
/* ═══════════════════════════════════════════════════════════════════
   MOD_ACTIONS — the G4 guard registry (GATES.md G4, 2026-10-22).

   ONE table of every write the AI surface or the approval flow can execute.
   Each executable action declares:
     precondition(ctx) -> {ok, reason}       what must be true before it runs
     run(ctx)          -> {receipt, result}  the write; receipt names the row
     verify(ctx, receipt) -> true | {ok, reason}
                                             a READ-BACK that proves the row
                                             the receipt names really exists
     inverse           -> function(ctx, receipt) | {irreversible:true, why}
     receiptStore      -> where the receipt lives (table.column or store)

   execute(name, ctx) is the only dispatcher. It:
     · THROWS synchronously, console.errors, and raises a visible toast for an
       unknown action or a link/nav-only action — never a quiet return;
     · THROWS synchronously with the reason when the precondition fails —
       run() is never called;
     · returns a Promise that REJECTS when run() returns no receipt, or the
       read-back finds nothing written. A write that silently no-ops is a
       failure, never a success. This is the bug class that shipped once
       (create_note: approved, wrote nothing, reported "Note created").

   Receipts are kept for this session (SporvActions.receipts(), newest first)
   and, when the signed-in database has the `action_receipts` table (RED draft
   docs/red-drafts/2026-10-22-g4-action-receipts.sql), copied there too. If the
   table is absent the receipt stays in the session and in the visible
   confirmation bubble, and entry.durable says false — never a pretend save.

   Non-executable entries (kind "link" or "nav") exist so that EVERY action
   name the model or the command bar can emit is classified here; the static
   test (tests/e2e/g4-action-registry.spec.mjs) fails if one is missing.

   Host contract read lazily (never at load): S, render, toast, PROP_DISPATCH,
   propDraft, noteAthlete, policyField, sendRecapToParentDemo, queueIsLive,
   approvalDrafts, window.MOD_NOTES, window.SporveCoach, window.SporveAPI,
   window.SporvPersonalization. Loads standalone under node for the tests.
   ═══════════════════════════════════════════════════════════════════ */
(function (root) {
  var REG = Object.create(null);
  var LOG = [];
  var LOG_MAX = 50;
  /* unknown | present | absent — whether action_receipts exists server-side. */
  var durable = { state: "unknown" };
  var KINDS = { write: 1, link: 1, nav: 1 };
  /* Failures that mean the SYSTEM is wrong (not that the coach's input was):
     these always reach the screen, whatever the caller does with the error. */
  var LOUD_CODES = { unknown_action: 1, not_executable: 1, no_receipt: 1, verify_failed: 1 };

  function ActionError(code, action, message, detail) {
    var e = new Error(message);
    e.name = "ActionError";
    e.code = code;
    e.action = action;
    if (detail) e.detail = detail;
    return e;
  }

  function loud(err) {
    try { console.error("[SporvActions] " + err.code + " (" + (err.action || "?") + "): " + err.message); } catch (_) {}
    if (LOUD_CODES[err.code]) {
      try { if (API.onLoudFailure) API.onLoudFailure(err); } catch (_) {}
    }
    return err;
  }

  function nonEmpty(s) { return typeof s === "string" && s.trim().length > 0; }

  function define(name, spec) {
    if (!nonEmpty(name)) throw new Error("SporvActions.define: an action needs a name.");
    if (REG[name]) throw new Error("SporvActions.define: duplicate action \"" + name + "\".");
    spec = spec || {};
    var kind = spec.kind || "write";
    if (!KINDS[kind]) throw new Error(name + ": unknown kind \"" + kind + "\".");
    if (kind === "write") {
      if (typeof spec.precondition !== "function") throw new Error(name + ": precondition(ctx) is required.");
      if (typeof spec.run !== "function") throw new Error(name + ": run(ctx) is required.");
      if (typeof spec.verify !== "function") throw new Error(name + ": verify(ctx, receipt) read-back is required.");
      var inv = spec.inverse;
      var invOk = typeof inv === "function" || (inv && inv.irreversible === true && nonEmpty(inv.why));
      if (!invOk) throw new Error(name + ": inverse must be a function or {irreversible:true, why}.");
      if (!nonEmpty(spec.receiptStore)) throw new Error(name + ": receiptStore must say where the receipt is written.");
    } else if (!nonEmpty(spec.why)) {
      throw new Error(name + ": a " + kind + "-only action must say why it does not write.");
    }
    var entry = { name: name, kind: kind };
    for (var k in spec) if (Object.prototype.hasOwnProperty.call(spec, k)) entry[k] = spec[k];
    entry.kind = kind;
    REG[name] = entry;
    return entry;
  }

  function get(name) { return REG[name] || null; }
  function has(name) { return !!REG[name]; }
  function names(kind) {
    return Object.keys(REG).filter(function (n) { return !kind || REG[n].kind === kind; }).sort();
  }

  function describeInverse(a) {
    if (!a || a.kind !== "write") return null;
    return typeof a.inverse === "function" ? { reversible: true } : { reversible: false, why: a.inverse.why };
  }

  /* Pre-flight without side effects. Used by the review card to decide
     whether to draw an Approve button, so the button and the dispatcher can
     never disagree about what is allowed. */
  function check(name, ctx) {
    var a = REG[name];
    if (!a) return { ok: false, code: "unknown_action", reason: "Unknown action \"" + name + "\"." };
    if (a.kind !== "write") return { ok: false, code: "not_executable", reason: a.why };
    var r;
    try { r = a.precondition(ctx || {}); }
    catch (e) { return { ok: false, code: "precondition_failed", reason: (e && e.message) || "A precondition threw." }; }
    if (!r || r.ok !== true) {
      return { ok: false, code: "precondition_failed", reason: (r && r.reason) || "A precondition was not met." };
    }
    return { ok: true };
  }

  function validReceipt(rc) {
    if (!rc || typeof rc !== "object") return false;
    if ((typeof rc.id === "string" && rc.id.length) || (typeof rc.id === "number" && isFinite(rc.id))) return true;
    if (Array.isArray(rc.ids) && rc.ids.length && rc.ids.every(function (x) { return x != null && x !== ""; })) return true;
    return false;
  }

  function record(entry) {
    LOG.unshift(entry);
    if (LOG.length > LOG_MAX) LOG.length = LOG_MAX;
    persist(entry);
  }

  /* Best-effort durable copy. Never changes the outcome of an action that
     already passed its read-back; it only says honestly where the receipt
     lives. A missing table is remembered so we stop asking. */
  function persist(entry) {
    entry.durable = false;
    var api = root.SporveAPI;
    if (durable.state === "absent" || !api || !api.from || !(api.isSignedIn && api.isSignedIn())) return;
    var row = {
      action: entry.action,
      receipt_store: entry.store,
      receipt_id: String(entry.receipt.id != null ? entry.receipt.id : (entry.receipt.ids || []).join(",")),
      receipt: entry.receipt,
      reversible: !!(entry.inverse && entry.inverse.reversible),
      verified_at: entry.at,
    };
    try {
      Promise.resolve(api.from("action_receipts", "select=id", {
        method: "POST", headers: { Prefer: "return=representation" }, body: row,
      })).then(function (rows) {
        if (Array.isArray(rows) && rows[0] && rows[0].id) {
          durable.state = "present"; entry.durable = true; entry.durableId = rows[0].id;
        }
      }, function (e) {
        var m = String((e && (e.message || e.code)) || "");
        if ((e && e.status === 404) || /42P01|PGRST205|does not exist|Could not find the table/i.test(m)) durable.state = "absent";
        entry.durableError = m || "unavailable";
      });
    } catch (_) { /* the session copy stands */ }
  }

  function execute(name, ctx) {
    ctx = ctx || {};
    var a = REG[name];
    if (!a) throw loud(ActionError("unknown_action", name,
      "Unknown action \"" + name + "\" was refused. Nothing was written."));
    if (a.kind !== "write") throw loud(ActionError("not_executable", name,
      "\"" + name + "\" has no write rail — " + a.why));
    var pre = check(name, ctx);
    if (!pre.ok) throw loud(ActionError("precondition_failed", name, pre.reason));

    return Promise.resolve().then(function () { return a.run(ctx); }).then(function (out) {
      var rc = out && out.receipt;
      if (!validReceipt(rc)) {
        throw loud(ActionError("no_receipt", name,
          "The " + name.replace(/_/g, " ") + " step returned no receipt, so it is treated as failed. Nothing is confirmed written."));
      }
      return Promise.resolve().then(function () { return a.verify(ctx, rc, out); }).then(function (v) {
        var ok = v === true || (v && v.ok === true);
        if (!ok) {
          throw loud(ActionError("verify_failed", name,
            "Read-back found nothing written for " + name.replace(/_/g, " ") +
            ((v && v.reason) ? " (" + v.reason + ")" : "") + ", so it is treated as failed.", { receipt: rc }));
        }
        var entry = {
          action: name, store: a.receiptStore, receipt: rc, verified: true,
          inverse: describeInverse(a), at: new Date().toISOString(),
        };
        record(entry);
        return { ok: true, action: name, receipt: rc, result: out.result, entry: entry };
      }, function (e) {
        if (e && e.name === "ActionError") throw e;
        throw loud(ActionError("verify_failed", name,
          "Could not read back the " + name.replace(/_/g, " ") + " write (" + ((e && e.message) || "read failed") +
          "), so it is not reported as done.", { receipt: rc, cause: e }));
      });
    }, function (e) {
      if (e && e.name === "ActionError") throw e;
      /* run() refused: keep its own words — the card shows them verbatim. */
      throw loud(ActionError("run_failed", name, (e && e.message) || "The write was refused.", { cause: e }));
    });
  }

  /* Reverse a recorded write. Irreversible actions refuse loudly with why. */
  function invert(name, ctx, receipt) {
    var a = REG[name];
    if (!a) throw loud(ActionError("unknown_action", name, "Unknown action \"" + name + "\" cannot be reversed."));
    if (a.kind !== "write") throw loud(ActionError("not_executable", name, a.why));
    if (typeof a.inverse !== "function") {
      throw loud(ActionError("irreversible", name, a.inverse.why));
    }
    return Promise.resolve().then(function () { return a.inverse(ctx || {}, receipt); });
  }

  function receipts() { return LOG.slice(); }
  function receiptLine(res) {
    if (!res || !res.entry) return "";
    var rc = res.entry.receipt, id = rc.id != null ? rc.id : (rc.ids || []).join(", ");
    return "Receipt: " + res.entry.store.split(" ")[0] + " " + id + ".";
  }

  var API = {
    define: define, get: get, has: has, names: names, check: check,
    execute: execute, invert: invert, receipts: receipts, receiptLine: receiptLine,
    durableState: function () { return durable.state; },
    ActionError: ActionError,
    onLoudFailure: function (err) {
      if (typeof root.toast === "function") root.toast(err.message);
    },
    _reset: function () { LOG.length = 0; durable.state = "unknown"; },
  };
  root.SporvActions = API;

  /* ───────────────── host lookups (lazy; undefined under node) ───────────────── */
  function H() {
    return {
      S: typeof S !== "undefined" ? S : null,
      D: typeof PROP_DISPATCH !== "undefined" ? PROP_DISPATCH : null,
      draft: typeof propDraft === "function" ? propDraft : function () { return ""; },
      athlete: typeof noteAthlete === "function" ? noteAthlete : function () { return ""; },
      policyField: typeof policyField === "function" ? policyField : function () { return null; },
    };
  }
  function no(reason) { return { ok: false, reason: reason }; }
  var YES = { ok: true };
  function textOf(ctx) { return String((ctx && ctx.text) != null ? ctx.text : "").trim(); }
  function rail(tool) {
    var D = H().D;
    if (!D || !D[tool] || typeof D[tool].run !== "function") throw new Error("The " + tool.replace(/_/g, " ") + " rail didn't load.");
    return D[tool];
  }
  function apiOrThrow() {
    var api = root.SporveAPI;
    if (!api || !api.from) throw new Error("Not connected.");
    return api;
  }
  function rowsOf(r) { return Array.isArray(r) ? r : (r ? [r] : []); }
  function resolveAthleteFor(ctx) {
    var M = root.MOD_NOTES;
    if (!M || !M.resolveAthlete) return { error: "The session-notes module didn't load." };
    var nm = H().athlete(ctx.proposal || {});
    var hit = M.resolveAthlete(nm) || {};
    if (hit.ambiguous) return { error: "More than one athlete matches “" + String(nm).trim() + "” — name one exactly." };
    if (!hit.athlete) return { error: "No athlete named “" + String(nm || "").trim() + "” on your roster." };
    return { athlete: hit.athlete };
  }

  /* ═════════════ CHAT PROPOSALS (the review card's Approve) ═════════════
     ctx = { proposal, text } — text is the coach's edited draft. run() goes
     through the existing PROP_DISPATCH rail; this layer adds the receipt and
     the read-back the rails never had. */
  var noteSpec = {
    surface: "chat-proposal",
    receiptStore: "S.sessionNotes (session demo store; no server table yet)",
    precondition: function (ctx) {
      var r = resolveAthleteFor(ctx);
      if (r.error) return no(r.error);
      if (!textOf(ctx)) return no("The note is empty.");
      return YES;
    },
    run: function (ctx) {
      return Promise.resolve(rail("create_note").run(ctx.proposal, ctx.text)).then(function (res) {
        return { result: res, receipt: res && res.note && res.note.id ? { id: res.note.id, athlete: res.athlete } : null };
      });
    },
    verify: function (ctx, rc) {
      var st = H().S, list = (st && st.sessionNotes) || [];
      return list.some(function (n) { return n && n.id === rc.id; }) || { ok: false, reason: "no note row " + rc.id };
    },
    inverse: function (ctx, rc) {
      var st = H().S; if (!st || !Array.isArray(st.sessionNotes)) throw new Error("Notes store unavailable.");
      var before = st.sessionNotes.length;
      st.sessionNotes = st.sessionNotes.filter(function (n) { return n.id !== rc.id; });
      if (st.sessionNotes.length === before) throw new Error("That note was already gone.");
      return { removed: rc.id };
    },
  };
  define("create_note", noteSpec);
  /* A coach "document" from the chat card IS a session note (same store) —
     the server-side create_document tool is separate and guarded by
     coach-command WRITE_GUARDS. */
  define("create_document", noteSpec);

  define("mark_attendance", {
    surface: "chat-proposal",
    receiptStore: "S.attendance (session demo store; production attendance is session_attendance via the Flutter client)",
    precondition: function (ctx) {
      var M = root.MOD_NOTES;
      if (!M || !M.markAttendanceFromAI) return no("The attendance module didn't load.");
      var r = resolveAthleteFor(ctx);
      if (r.error) return no(r.error);
      var s = String((ctx.proposal && ctx.proposal.args && ctx.proposal.args.status) || "").toLowerCase();
      if (!/^(present|absent|late|excused)$/.test(s)) return no("Attendance must be present, absent, late, or excused.");
      return YES;
    },
    run: function (ctx) {
      var M = root.MOD_NOTES, a = resolveAthleteFor(ctx).athlete;
      /* Snapshot this athlete's rows first so the inverse can restore them. */
      var prev = (M.attendance ? M.attendance() : []).filter(function (r) { return r.athleteId === a.id; })
        .map(function (r) { return { id: r.id, status: r.status }; });
      return Promise.resolve(rail("mark_attendance").run(ctx.proposal, ctx.text)).then(function (res) {
        var row = res && (M.attendance ? M.attendance() : []).find(function (r) {
          return r.athleteId === a.id && r.day === res.day && r.status === res.status;
        });
        ctx._prev = prev;
        return { result: res, receipt: row ? { id: row.id, day: row.day, status: row.status } : null };
      });
    },
    verify: function (ctx, rc) {
      var M = root.MOD_NOTES, rows = (M && M.attendance) ? M.attendance() : [];
      return rows.some(function (r) { return r.id === rc.id && r.status === rc.status; }) || { ok: false, reason: "no attendance row " + rc.id };
    },
    inverse: function (ctx, rc) {
      var M = root.MOD_NOTES, rows = (M && M.attendance) ? M.attendance() : null;
      if (!rows) throw new Error("Attendance store unavailable.");
      var was = (ctx._prev || []).find(function (p) { return p.id === rc.id; });
      var i = rows.findIndex(function (r) { return r.id === rc.id; });
      if (i < 0) throw new Error("That attendance row is already gone.");
      if (was) rows[i].status = was.status; else rows.splice(i, 1);
      return { restored: rc.id };
    },
  });

  var SENT_WHY = "A message delivered to a parent cannot be recalled; send a correction instead.";

  define("draft_recap", {
    surface: "chat-proposal",
    receiptStore: "S.messages (session demo inbox; production sends via draft_message / lifecycle-approve)",
    precondition: function (ctx) {
      var r = resolveAthleteFor(ctx);
      if (r.error) return no(r.error);
      if (!textOf(ctx)) return no("The recap is empty.");
      return YES;
    },
    run: function (ctx) {
      return Promise.resolve(rail("draft_recap").run(ctx.proposal, ctx.text)).then(function (res) {
        return { result: res, receipt: res && res.messageId ? { id: res.messageId, conversationId: res.conversationId } : null };
      });
    },
    verify: function (ctx, rc) {
      var st = H().S, list = (st && st.messages && st.messages[rc.conversationId]) || [];
      return list.some(function (m) { return m && m.id === rc.id; }) || { ok: false, reason: "no message " + rc.id };
    },
    inverse: { irreversible: true, why: SENT_WHY },
  });

  define("draft_message", {
    surface: "chat-proposal",
    receiptStore: "messages.id (server, coach JWT)",
    precondition: function (ctx) {
      var p = ctx.proposal || {};
      if (!(p.args && p.args.booking_id)) return no("No booking attached to this draft.");
      if (!textOf(ctx)) return no("The message is empty.");
      if (!root.SporveCoach || !root.SporveCoach.sendParentMessage) return no("The coach account module didn't load.");
      return YES;
    },
    run: function (ctx) {
      return Promise.resolve(rail("draft_message").run(ctx.proposal, ctx.text)).then(function (res) {
        return { result: res, receipt: res && res.messageId ? { id: res.messageId, conversationId: res.conversationId } : null };
      });
    },
    verify: function (ctx, rc) {
      return apiOrThrow().from("messages", "id=eq." + encodeURIComponent(rc.id) + "&select=id").then(function (r) {
        return rowsOf(r).some(function (x) { return x && x.id === rc.id; }) || { ok: false, reason: "message " + rc.id + " not readable" };
      });
    },
    inverse: { irreversible: true, why: SENT_WHY },
  });

  /* Profile fields: SporveCoach.save() falls back to the cached provider when
     a PATCH matches zero rows, so its return value proves nothing. The
     read-back below re-reads the column and compares it to what was saved. */
  function providerFieldSpec(field) {
    return {
      surface: "chat-proposal",
      receiptStore: "providers." + (field || "<field>") + " (server, coach JWT)",
      precondition: function (ctx) {
        if (!root.SporveCoach || !root.SporveCoach.save) return no("The coach account module didn't load.");
        var f = field || H().policyField(ctx.proposal || {});
        if (f !== "bio" && f !== "what_to_bring" && f !== "travel_radius") return no("That policy can't be edited here yet.");
        if (!textOf(ctx)) return no(f === "bio" ? "The bio is empty." : "The policy text is empty.");
        return YES;
      },
      run: function (ctx) {
        var f = field || H().policyField(ctx.proposal || {});
        var cur = root.SporveCoach.current ? root.SporveCoach.current() : null;
        ctx._prev = { field: f, value: cur ? cur[f] : undefined, known: !!(cur && f in cur) };
        return Promise.resolve(rail(field ? "draft_bio" : "set_policy").run(ctx.proposal, ctx.text)).then(function (res) {
          var after = root.SporveCoach.current ? root.SporveCoach.current() : null;
          var id = (res && res.id) || (after && after.id);
          return { result: res, receipt: id ? { id: id, field: f, value: textOf(ctx) } : null };
        });
      },
      verify: function (ctx, rc) {
        return apiOrThrow().from("providers", "id=eq." + encodeURIComponent(rc.id) + "&select=id," + rc.field).then(function (r) {
          var row = rowsOf(r)[0];
          return (row && String(row[rc.field] == null ? "" : row[rc.field]).trim() === rc.value) ||
            { ok: false, reason: "providers." + rc.field + " does not hold the saved text" };
        });
      },
      inverse: function (ctx) {
        var p = ctx._prev;
        if (!p || !p.known) throw new Error("The previous value was not captured, so it cannot be restored.");
        var patch = {}; patch[p.field] = p.value == null ? "" : p.value;
        return root.SporveCoach.save(patch);
      },
    };
  }
  define("draft_bio", providerFieldSpec("bio"));
  define("set_policy", providerFieldSpec(null));

  /* Proposed by coach-command / the ai.js command bar, but with NO write rail.
     The card deep-links to the tab that owns the work. Listed so the static
     test can prove nothing proposable is unclassified. */
  var LINKS = {
    schedule_change: "it opens Schedule; the coach makes the change there.",
    payout: "RED — money never moves through the assistant; it opens Earnings for the human.",
    cancel_booking: "it opens Schedule; cancellations (refund terms) are a human action there.",
    open_slot: "it opens Schedule.",
    close_slot: "it opens Schedule.",
    add_availability_exception: "it opens Schedule.",
    create_service: "it opens Listings; publishing is the createListing form.",
    set_profile_image: "it opens Media; image upload is a human file pick.",
    set_gallery_image: "it opens Media; image upload is a human file pick.",
    camp_broadcast: "the camp-broadcast function writes coach-only drafts; sending is per row in the inbox.",
    draft_waitlist_offer: "waitlist-offer-draft writes a coach-only draft; the coach sends it from Messages.",
    draft_bulk_message: "coach-command inserts DRAFTED rows (WRITE_GUARDS); each row sends only via Approve & send (lifecycle-approve).",
  };
  Object.keys(LINKS).forEach(function (n) { define(n, { kind: "link", surface: "chat-proposal", why: LINKS[n] }); });
  define("open_tab", { kind: "nav", surface: "command-bar", why: "navigation only; it switches the visible tab." });
  define("create_group", { kind: "nav", surface: "command-bar", why: "it opens the New group form; the human submits it." });

  /* ═════════════ COMMAND BAR (api/ai.js classifier) ═════════════ */
  define("send_group_message", {
    surface: "command-bar",
    receiptStore: "S.messages (session only — this rail never reaches a server table)",
    precondition: function (ctx) {
      var st = H().S, p = ctx.pending;
      if (!st || !p) return no("Nothing is waiting to send.");
      if (!p.convId || !(st.conversations || []).some(function (c) { return c.id === p.convId; })) return no("That group no longer exists.");
      if (!nonEmpty(p.body)) return no("The message is empty.");
      return YES;
    },
    run: function (ctx) {
      var st = H().S, p = ctx.pending, id = p.convId;
      var list = (st.messages[id] = st.messages[id] || []);
      var msg = { id: "msg_" + (list.length + 1) + "_" + Date.now().toString(36), me: false, text: p.body, at: (typeof TODAY !== "undefined" ? TODAY : new Date().toISOString().slice(0, 10)) };
      list.push(msg);
      var c = (st.conversations || []).find(function (x) { return x.id === id; }); if (c) c.last = p.body;
      if (st.unread) st.unread[id] = 0;
      return { result: msg, receipt: { id: msg.id, conversationId: id } };
    },
    verify: function (ctx, rc) {
      var st = H().S, list = (st && st.messages && st.messages[rc.conversationId]) || [];
      return list.some(function (m) { return m.id === rc.id; }) || { ok: false, reason: "no message " + rc.id };
    },
    inverse: function (ctx, rc) {
      var st = H().S, list = st && st.messages && st.messages[rc.conversationId];
      if (!list) throw new Error("Thread unavailable.");
      var i = list.findIndex(function (m) { return m.id === rc.id; });
      if (i < 0) throw new Error("That message is already gone.");
      list.splice(i, 1);
      return { removed: rc.id };
    },
  });

  /* ═════════════ APPROVAL QUEUE (Approvals / Queue tabs) ═════════════ */
  define("queue_approve", {
    surface: "approval-queue",
    receiptStore: "outbound_messages.id + status (server; lifecycle-approve stamps approved_by / sent_at)",
    precondition: function (ctx) {
      if (!nonEmpty(ctx.id)) return no("No message id.");
      if (!root.SporveCoach || !root.SporveCoach.decide) return no("The coach account module didn't load.");
      return YES;
    },
    run: function (ctx) {
      return Promise.resolve(root.SporveCoach.decide(ctx.id, "approve")).then(function (r) {
        var good = r && r.ok === true && (r.status === "sent" || r.status === "approved");
        return { result: r, receipt: good ? {
          id: r.message_id || ctx.id, status: r.status, queuedEmail: !!r.queuedEmail,
          notificationId: r.notification_id || null,
        } : null };
      });
    },
    verify: function (ctx, rc) {
      return apiOrThrow().from("outbound_messages", "id=eq." + encodeURIComponent(rc.id) + "&select=id,status").then(function (r) {
        var row = rowsOf(r)[0];
        return (row && /^(sent|approved|processing)$/.test(row.status)) || { ok: false, reason: "status is " + (row ? row.status : "missing") };
      });
    },
    inverse: { irreversible: true, why: SENT_WHY + " An approved row still waiting for email can be returned to draft from Approvals." },
  });

  function queueStatusSpec(decision, expected, inverse) {
    return {
      surface: "approval-queue",
      receiptStore: "outbound_messages.id + status (server PATCH RETURNING)",
      precondition: function (ctx) {
        if (!nonEmpty(ctx.id)) return no("No message id.");
        if (!root.SporveCoach || !root.SporveCoach.decide) return no("The coach account module didn't load.");
        return YES;
      },
      run: function (ctx) {
        return Promise.resolve(root.SporveCoach.decide(ctx.id, decision)).then(function (row) {
          return { result: row, receipt: row && row.id && row.status === expected ? { id: row.id, status: row.status } : null };
        });
      },
      /* The PATCH used return=representation: the row came back from the
         UPDATE itself, so its status IS the read-back. */
      verify: function (ctx, rc) { return rc.status === expected || { ok: false, reason: "status is " + rc.status }; },
      inverse: inverse,
    };
  }
  define("queue_reject", queueStatusSpec("reject", "skipped", function (ctx) {
    return root.SporveCoach.decide(ctx.id, "redraft");
  }));
  define("queue_redraft", queueStatusSpec("redraft", "drafted", {
    irreversible: true, why: "Re-approving is a send; it must go through Approve & send (lifecycle-approve), never an automatic inverse.",
  }));

  define("obligation_approve", {
    surface: "approval-queue",
    receiptStore: "obligations.id + status (server RPC approve_obligation_and_queue)",
    precondition: function (ctx) {
      var o = ctx.obligation;
      if (!o || !o.id) return no("No obligation.");
      if (o.status !== "draft") return no("Only a draft can be approved.");
      if (!root.SporveAPI || !root.SporveAPI.rpc) return no("Not connected.");
      return YES;
    },
    run: function (ctx) {
      return Promise.resolve(root.SporveAPI.rpc("approve_obligation_and_queue", { p_obligation_id: ctx.obligation.id })).then(function (msgId) {
        return { result: msgId || null, receipt: { id: ctx.obligation.id, queuedMessageId: msgId || null } };
      });
    },
    verify: function (ctx, rc) {
      return apiOrThrow().from("obligations", "id=eq." + encodeURIComponent(rc.id) + "&select=id,status").then(function (r) {
        var row = rowsOf(r)[0];
        return (row && row.status === "approved") || { ok: false, reason: "status is " + (row ? row.status : "missing") };
      });
    },
    inverse: { irreversible: true, why: "The approval is stamped with the owner's decision; a queued draft can still be skipped in Approvals before it sends." },
  });

  define("obligation_set_status", {
    surface: "approval-queue",
    receiptStore: "obligations.id + status (server PATCH RETURNING; 000200 lifecycle trigger is the authority)",
    precondition: function (ctx) {
      var o = ctx.obligation;
      if (!o || !o.id || !o.live) return no("No live obligation.");
      if (!/^(approved|done|void)$/.test(String(ctx.status || ""))) return no("Unknown obligation status.");
      if (!root.SporveAPI) return no("Not connected.");
      return YES;
    },
    run: function (ctx) {
      return Promise.resolve(root.SporveAPI.from("obligations", "id=eq." + encodeURIComponent(ctx.obligation.id) + "&select=id,status", {
        method: "PATCH", headers: { Prefer: "return=representation" }, body: { status: ctx.status },
      })).then(function (rows) {
        var row = rowsOf(rows)[0];
        return { result: row || null, receipt: row && row.id ? { id: row.id, status: row.status } : null };
      });
    },
    verify: function (ctx, rc) {
      return rc.status === ctx.status || { ok: false, reason: "The server did not record that change." };
    },
    inverse: { irreversible: true, why: "The obligation lifecycle trigger only walks forward (draft, approved, done; void from any non-done)." },
  });

  define("intake_decide", {
    surface: "approval-queue",
    receiptStore: "intake_proposals.id + status (server RPC decide_intake_proposal)",
    precondition: function (ctx) {
      if (!nonEmpty(ctx.id)) return no("No proposal id.");
      if (ctx.decision !== "approve" && ctx.decision !== "void") return no("Unknown decision.");
      if (!root.SporveAPI || !root.SporveAPI.rpc) return no("Not connected.");
      return YES;
    },
    run: function (ctx) {
      var expected = ctx.decision === "approve" ? "applied" : "void";
      return Promise.resolve(root.SporveAPI.rpc("decide_intake_proposal", { p_proposal: ctx.id, p_decision: ctx.decision })).then(function (res) {
        /* No status back means no proof — the old client assumed one. */
        return { result: res, receipt: res && res.status === expected ? { id: ctx.id, status: res.status } : null };
      });
    },
    verify: function (ctx, rc) {
      return apiOrThrow().from("intake_proposals", "id=eq." + encodeURIComponent(rc.id) + "&select=id,status").then(function (r) {
        var row = rowsOf(r)[0];
        return (row && row.status === rc.status) || { ok: false, reason: "status is " + (row ? row.status : "missing") };
      });
    },
    inverse: { irreversible: true, why: "decide_intake_proposal applies the change server-side and has no revert RPC yet (owner follow-up)." },
  });

  define("finding_dismiss", {
    surface: "approval-queue",
    receiptStore: "agent_findings.id + status (server PATCH RETURNING)",
    precondition: function (ctx) {
      if (!nonEmpty(ctx.id)) return no("No finding id.");
      if (!root.SporveAPI || !root.SporveAPI.from) return no("Not connected.");
      return YES;
    },
    run: function (ctx) {
      return Promise.resolve(root.SporveAPI.from("agent_findings", "id=eq." + encodeURIComponent(ctx.id) + "&select=id,status", {
        method: "PATCH", headers: { Prefer: "return=representation" }, body: { status: "dismissed" },
      })).then(function (rows) {
        var row = rowsOf(rows)[0];
        return { result: row || null, receipt: row && row.id ? { id: row.id, status: row.status } : null };
      });
    },
    verify: function (ctx, rc) { return rc.status === "dismissed" || { ok: false, reason: "status is " + rc.status }; },
    inverse: function (ctx, rc) {
      return apiOrThrow().from("agent_findings", "id=eq." + encodeURIComponent(rc.id) + "&select=id,status", {
        method: "PATCH", headers: { Prefer: "return=representation" }, body: { status: "open" },
      });
    },
  });

  /* Guest preview only: the seeded Approvals drafts (approvalDrafts()). */
  define("demo_queue_approve", {
    surface: "approval-queue (guest demo)",
    receiptStore: "S.approvalSent (guest demo session only)",
    precondition: function (ctx) {
      var live = typeof queueIsLive === "function" ? queueIsLive() : true;
      if (live) return no("Signed-in accounts approve real rows, not the sample drafts.");
      var list = typeof approvalDrafts === "function" ? approvalDrafts() : [];
      if (!list[ctx.index]) return no("That draft is gone.");
      return YES;
    },
    run: function (ctx) {
      var st = H().S, list = approvalDrafts(), d = list[ctx.index];
      var row = { id: "demo_sent_" + Date.now().toString(36), kind: d.kind, to: d.to, preview: String(ctx.text || d.body).slice(0, 68) };
      st.approvalSent = [row].concat(st.approvalSent || []);
      list.splice(ctx.index, 1);
      return { result: d, receipt: { id: row.id } };
    },
    verify: function (ctx, rc) {
      var st = H().S;
      return ((st && st.approvalSent) || []).some(function (r) { return r.id === rc.id; }) || { ok: false, reason: "no demo row" };
    },
    inverse: { irreversible: true, why: "Guest demo: the sample draft is consumed; reload restores the seed." },
  });

  /* ═════════════ PERSONALIZATION (spec 30 chat proposals) ═════════════ */
  define("pers_apply", {
    surface: "chat-proposal (personalization)",
    receiptStore: "personalization version store (this device)",
    precondition: function (ctx) {
      var P = root.SporvPersonalization;
      if (!P || !P.applyProposal) return no("Personalization didn't load.");
      if (!nonEmpty(ctx.id)) return no("No proposal id.");
      return YES;
    },
    run: function (ctx) {
      var r = root.SporvPersonalization.applyProposal(ctx.id, { role: ctx.role, author: ctx.author });
      if (!r || !r.ok) {
        var e = new Error(r && r.conflict ? r.message : ("Could not apply: " + ((r && r.errors) || ["unknown error"]).join(" ")));
        e.conflict = !!(r && r.conflict); e.diff = r && r.diff; e.raw = r;
        throw e;
      }
      return { result: r, receipt: { id: "version:" + r.version, version: r.version } };
    },
    verify: function (ctx, rc) {
      var P = root.SporvPersonalization;
      return (P.currentVersion && P.currentVersion() === rc.version) || { ok: false, reason: "current version is not " + rc.version };
    },
    inverse: function () { return root.SporvPersonalization.undo(); },
  });
})(typeof window !== "undefined" ? window : globalThis);
