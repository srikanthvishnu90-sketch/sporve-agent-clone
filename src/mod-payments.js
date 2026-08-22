"use strict";
/* ═══════════════════════════════════════════════════════════════════
   MOD_PAYMENTS — money for Sporv Web.

   THE FEE ERA CHANGED (2026-08, subscription pivot). Sporv charged a flat 12%
   of every booking; it now charges providers a subscription and takes 0% of a
   booking, so FEE_PCT is 0 and new checkouts show no fee line at all. The 12%
   is not deleted from this file, it is demoted to HISTORY: a fee recorded on a
   past booking or ledger row is still rendered, at the rate it was actually
   charged. Derived fees follow the constant; recorded fees follow the record.

   Four real backend flows, mirrored exactly on the client:
     · checkout        review → payment method → confirm, platform fee itemized
                       only when non-zero, card validated (Luhn + IIN + expiry)
     · cancellation    refund follows the policy SNAPSHOTTED onto the booking
                       at purchase, never the listing's current policy
     · wallet          payment methods (last-4 only), transaction ledger with
                       gross / fee / net, and 5-session credit packs
     · split pay       one booking across two guardians, cents reconciled

   Money is held in INTEGER CENTS everywhere and only formatted at the edge.
   The host's money() renders whole dollars; a percentage fee is rarely whole,
   so amounts computed here print through usd() at two decimals. Nothing here
   invents a movement of money: every figure shown comes from a row in
   S.transactions that a user action actually wrote.

   Host contract used, never redefined: S, render, toast, esc, money,
   fmtDate, slotsFor, modelLabel, isVerified, requireAuth, PROGRAMS,
   sportColor, ICON.
   ═══════════════════════════════════════════════════════════════════ */
(function () {

  /* ── the app's clock is pinned; every date rule below reads from here ── */
  const TODAY = "2026-08-03";
  const NOW = new Date(2026, 7, 3, 0, 0, 0);

  /* FEE_PCT comes from the host — single source, do not redeclare. */
  const PACK_SESSIONS = 5;
  const PACK_DISCOUNT_PCT = 10;
  const SPLIT_VALID_DAYS = 7;

  /* booking + payment vocabularies are the backend's */
  const BOOKING_STATUS = ["pending", "confirmed", "declined", "completed", "cancelled", "no_show", "expired"];
  const PAYMENT_STATUS = ["unpaid", "paid", "partially_refunded", "refunded", "failed"];
  const STATUS_TONE = {
    pending: "warn", confirmed: "good", completed: "good", paid: "good",
    partially_refunded: "warn", refunded: "slate", cancelled: "closed",
    declined: "closed", no_show: "closed", expired: "closed",
    unpaid: "warn", failed: "closed",
  };
  const STATUS_LABEL = {
    pending: "Pending", confirmed: "Confirmed", declined: "Declined",
    completed: "Completed", cancelled: "Cancelled", no_show: "No show",
    expired: "Expired", unpaid: "Unpaid", paid: "Paid",
    partially_refunded: "Partially refunded", refunded: "Refunded", failed: "Failed",
    accepted: "Accepted",
  };

  /* ── cancellation policies ──────────────────────────────────────────
     Each policy is a ladder read top-down against hours-until-session.
     These are the three the listings carry (flexible | moderate | strict). */
  const POLICIES = {
    flexible: {
      label: "Flexible",
      blurb: "Full refund up to 24 hours before the session.",
      bands: [
        { minHours: 24, pct: 100, text: "24 hours or more before the session" },
        { minHours: 0, pct: 0, text: "less than 24 hours before the session" },
      ],
    },
    moderate: {
      label: "Moderate",
      blurb: "Full refund up to 3 days before; half inside that window.",
      bands: [
        { minHours: 72, pct: 100, text: "3 days (72 hours) or more before the session" },
        { minHours: 0, pct: 50, text: "less than 3 days before the session" },
      ],
    },
    strict: {
      label: "Strict",
      blurb: "Half refund up to 7 days before; none after that.",
      bands: [
        { minHours: 168, pct: 50, text: "7 days (168 hours) or more before the session" },
        { minHours: 0, pct: 0, text: "less than 7 days before the session" },
      ],
    },
  };

  /* ── card networks, read from the IIN prefix — never guessed ────────
     A brand is claimed only once the digits typed can only belong to that
     network. Amex is 15 digits with a 4-digit CVC; the rest are 16/3. */
  const BRANDS = {
    visa: { label: "Visa", digits: 16, cvc: 3, groups: [4, 4, 4, 4] },
    mastercard: { label: "Mastercard", digits: 16, cvc: 3, groups: [4, 4, 4, 4] },
    amex: { label: "Amex", digits: 15, cvc: 4, groups: [4, 6, 5] },
    discover: { label: "Discover", digits: 16, cvc: 3, groups: [4, 4, 4, 4] },
  };

  function brandOf(digits) {
    const d = String(digits || "").replace(/\D/g, "");
    if (!d) return null;
    if (/^3[47]/.test(d)) return "amex";
    if (/^4/.test(d)) return "visa";
    if (/^5[1-5]/.test(d)) return "mastercard";
    if (/^6011/.test(d) || /^65/.test(d) || /^64[4-9]/.test(d)) return "discover";
    if (d.length >= 6) {
      const p6 = parseInt(d.slice(0, 6), 10);
      if (p6 >= 222100 && p6 <= 272099) return "mastercard";   // Mastercard 2-series
      if (p6 >= 622126 && p6 <= 622925) return "discover";     // Discover China UnionPay range
    }
    return null;
  }

  /* Luhn: double every second digit from the right, subtract 9 when > 9 */
  function luhnOK(digits) {
    const d = String(digits || "").replace(/\D/g, "");
    if (d.length < 12) return false;
    let sum = 0, dbl = false;
    for (let i = d.length - 1; i >= 0; i--) {
      let n = d.charCodeAt(i) - 48;
      if (dbl) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
      dbl = !dbl;
    }
    return sum % 10 === 0;
  }

  function groupCard(digits, brandKey) {
    const g = (BRANDS[brandKey] || {}).groups || [4, 4, 4, 4];
    const d = String(digits || "").replace(/\D/g, "");
    const out = [];
    let i = 0;
    for (const size of g) {
      if (i >= d.length) break;
      out.push(d.slice(i, i + size));
      i += size;
    }
    if (i < d.length) out.push(d.slice(i));
    return out.join(" ");
  }

  /* ── money — integer cents in, formatted string out ─────────────────── */
  const usd = c => {
    const n = Math.abs(Number(c) || 0) / 100;
    const s = "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (Number(c) || 0) < 0 ? "−" + s : s;
  };
  const feeOn = cents => Math.round(cents * FEE_PCT / 100);
  const pctOf = (cents, pct) => Math.round(cents * pct / 100);

  /* ── fee truth has two paths, and they must never be crossed ──────────
     DERIVED — feeOn() prices a NEW booking off the host's FEE_PCT. Under the
     subscription model that constant is 0, so feeOn() returns 0 and every fee
     line below drops out: a "$0.00 platform fee" row is noise, not disclosure.
     All of it is written against the constant, never against a hardcoded 0, so
     if FEE_PCT is ever non-zero again the rows itemize themselves with no edit.

     RECORDED — a fee already written onto a booking or a ledger row is history.
     It is never recomputed and never hidden. A booking that was charged 12% has
     to keep saying 12% forever, whatever FEE_PCT reads today, so the label for a
     recorded fee cannot interpolate the live constant. recordedPct() reads the
     rate back OUT of the two numbers that were stored, and returns it only when
     it reproduces the stored cents exactly; otherwise the row says "fee" and
     asserts no percentage it cannot prove. Zero and unknown stay distinct: a
     recorded 0 means no fee was taken, null means nothing was ever captured. */
  const feeLive = () => Number(FEE_PCT) > 0;
  function recordedPct(feeCents, grossCents) {
    const f = Math.abs(Number(feeCents) || 0), g = Math.abs(Number(grossCents) || 0);
    if (!f || !g) return null;
    const pct = Math.round(f * 100 / g);
    return Math.round(g * pct / 100) === f ? pct : null;
  }
  const feeLabel = (feeCents, grossCents, tail) => {
    const pct = recordedPct(feeCents, grossCents);
    return `Sporv's ${pct == null ? "fee" : pct + "%"} ${tail}`;
  };

  /* ── dates ──────────────────────────────────────────────────────────── */
  function sessionStart(dateStr, startTime) {
    const [y, m, d] = String(dateStr || "").split("-").map(Number);
    if (!y) return null;
    let hh = 0, mm = 0;
    const t = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(startTime || "").trim());
    if (t) {
      hh = parseInt(t[1], 10) % 12;
      mm = parseInt(t[2], 10);
      if (/pm/i.test(t[3])) hh += 12;
    }
    return new Date(y, m - 1, d, hh, mm, 0);
  }
  const hoursUntil = dt => dt ? (dt.getTime() - NOW.getTime()) / 3600000 : 0;
  function addDays(n) {
    const d = new Date(NOW.getTime());
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function stampDate(dt) {
    return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  function stampDateTime(dt) {
    return stampDate(dt) + " · " + dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  const roundHours = h => (Math.abs(h) >= 10 ? Math.round(h) : Math.round(h * 10) / 10);

  /* ── ledger helpers ─────────────────────────────────────────────────── */
  const cards = () => (S.cards = S.cards || []);
  const txns = () => (S.transactions = S.transactions || []);
  const packs = () => (S.creditPacks = S.creditPacks || []);
  const splits = () => (S.splitRequests = S.splitRequests || []);

  const cardById = id => cards().find(c => c.id === id) || null;
  const defaultCard = () => cards().find(c => c.isDefault) || cards()[0] || null;
  const bookingById = id => (S.bookings || []).find(b => b.id === id) || null;
  const programOf = b => PROGRAMS.find(p => p.id === (b && b.programId)) || null;

  const cardLabel = c => c ? `${c.brand ? BRANDS[c.brand].label : "Card"} ···· ${c.last4}` : "—";
  const expLabel = c => c ? `${String(c.expMonth).padStart(2, "0")}/${String(c.expYear).slice(-2)}` : "";

  /* session credits are derived from the ledger, never stored twice */
  const creditsFor = pid => txns().reduce((s, t) => s + (t.programId === pid ? (t.credits || 0) : 0), 0);
  function creditValueFor(pid) {
    /* the per-session value of the most recent pack bought for this program */
    for (let i = 0; i < txns().length; i++) {
      const t = txns()[i];
      if (t.kind === "pack" && t.programId === pid && t.perSessionCents) return t.perSessionCents;
    }
    return 0;
  }
  const openSplitFor = id => splits().find(r => r.bookingId === id && splitStatus(r) === "pending") || null;
  function splitStatus(r) {
    if (r.status !== "pending") return r.status;
    return r.expiresAt && r.expiresAt < TODAY ? "expired" : "pending";
  }

  /* what a booking actually charged. Bookings written before this module
     existed carry only `price`, so the fee is shown as unrecorded rather
     than back-computed — we don't put numbers on money we can't see. */
  function charged(b) {
    if (!b) return { gross: 0, fee: null, total: 0, itemized: false };
    if (typeof b.grossCents === "number" && typeof b.totalCents === "number") {
      return { gross: b.grossCents, fee: typeof b.feeCents === "number" ? b.feeCents : null, total: b.totalCents, itemized: true };
    }
    const g = Math.round(Number(b.price || 0) * 100);
    return { gross: g, fee: null, total: g, itemized: false };
  }

  function policyFor(b) {
    const snap = b && b.cancellationPolicy;
    if (snap && POLICIES[snap]) return { key: snap, policy: POLICIES[snap], snapshotted: true };
    const p = programOf(b);
    const cur = p && POLICIES[p.cancellationPolicy] ? p.cancellationPolicy : "moderate";
    return { key: cur, policy: POLICIES[cur], snapshotted: false };
  }
  function bandFor(policy, hours) {
    for (const band of policy.bands) if (hours >= band.minHours) return band;
    return policy.bands[policy.bands.length - 1];
  }

  /* ── pills / chrome ─────────────────────────────────────────────────── */
  /* the only writer of a booking's lifecycle fields — a value outside the
     backend's vocabulary is refused rather than written through */
  function setStatus(b, status, payment) {
    if (status && BOOKING_STATUS.includes(status)) b.status = status;
    if (payment && PAYMENT_STATUS.includes(payment)) b.paymentStatus = payment;
  }

  function pill(v) {
    const tone = STATUS_TONE[v] || "slate";
    const cls = tone === "closed" ? "pill pm-closed" : "pill " + tone;
    return `<span class="${cls}">${esc(STATUS_LABEL[v] || v)}</span>`;
  }
  function wrap(title, body) {
    return `<div class="scrim" data-scrim="1"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><b>${esc(title)}</b><button class="x" data-close="1" aria-label="Close">${ICON.x}</button></div><div class="modal-body"><div class="pm-body">${body}</div></div></div></div>`;
  }
  const sumRow = (label, value, cls) =>
    `<div class="pm-sum-row ${cls || ""}"><span>${label}</span><span class="num">${value}</span></div>`;

  function stepBar(step) {
    const names = ["Review", "Payment", "Confirm"];
    return `<ol class="pm-steps" aria-label="Checkout progress">
      ${names.map((n, i) => {
        const idx = i + 1;
        const state = step > idx ? "done" : step === idx ? "on" : "";
        return `<li class="pm-step ${state}"${step === idx ? ' aria-current="step"' : ""}>
          <span class="pm-step-n num" aria-hidden="true">${step > idx ? ICON.check : idx}</span>
          <span>${n}</span></li>`;
      }).join("")}
    </ol>`;
  }

  /* ═══════════════════ CHECKOUT ═══════════════════
     The draft lives beside S.modal so that stepping out to "add a card"
     and back doesn't lose the athlete, slot, or tier already chosen. */
  let draft = { key: null };

  function syncDraft(m) {
    /* keyed on the modal object itself: every re-render during a flow passes the
       same object (so the draft survives a trip to "add a card"), while every
       fresh open passes a new one (so a finished receipt never comes back) */
    if (draft.modalRef !== m) {
      const slots = slotsFor(m.programId) || [];
      const first = (S.athletes || [])[0];
      draft = {
        modalRef: m,
        key: m.programId,
        step: 1,
        athleteId: m.athleteId || (first ? first.id : null),
        slotId: m.slotId || (slots[0] ? slots[0].id : null),
        tier: m.tier || "Standard",
        cardId: (defaultCard() || {}).id || null,
        useCredit: false,
      };
    }
    if (draft.cardId && !cardById(draft.cardId)) draft.cardId = (defaultCard() || {}).id || null;
    if (!draft.cardId && !draft.useCredit) draft.cardId = (defaultCard() || {}).id || null;
    return draft;
  }

  const tierExtraCents = t => /^Premium/.test(String(t || "")) ? 1500 : 0;

  function totalsFor(p, tier, useCredit) {
    if (useCredit) {
      const value = creditValueFor(p.id);
      return { gross: 0, fee: 0, total: 0, creditValue: value };
    }
    const gross = Math.round(Number(p.price) * 100) + tierExtraCents(tier);
    const fee = feeOn(gross);
    /* deducted incidence: the family is charged the coach's price. Any fee is Sporv's
       share of that price, not a surcharge, so it is itemized but never added to total.
       Under the subscription model fee is 0 and the total is the coach's price exactly. */
    return { gross, fee, total: gross, creditValue: 0 };
  }

  function checkoutModal() {
    const m = S.modal || {};
    const p = PROGRAMS.find(x => x.id === m.programId);
    if (!p) {
      return wrap("Checkout", `
        <div class="pm-note"><h3>We can't find that program</h3>
          <p>It may have been unpublished while this was open. Open Explore and start again.</p></div>
        <button class="btn ghost wide" data-nav="explore">Back to Explore</button>`);
    }
    const d = syncDraft(m);
    const slots = slotsFor(p.id) || [];
    const athletes = S.athletes || [];

    if (!athletes.length) {
      return wrap("Checkout", `
        <div class="pm-note pm-note-warn"><h3>Add an athlete first</h3>
          <p>A session is booked for a specific child, and a child profile can't exist without
             recorded parental consent. Add one, then come back to checkout.</p></div>
        <button class="btn wide" data-addchild="1">Add a child</button>
        <button class="btn ghost wide pm-gap" data-close="1">Not now</button>`);
    }

    const slot = slots.find(s => s.id === d.slotId) || slots[0];
    const athlete = athletes.find(a => a.id === d.athleteId) || athletes[0];
    const credits = creditsFor(p.id);
    const t = totalsFor(p, d.tier, d.useCredit);
    const card = cardById(d.cardId);

    /* ── step 4: the receipt for what just moved ── */
    if (d.step === 4 && d.receipt) {
      const r = d.receipt;
      return wrap("Payment complete", `
        <div class="pm-done">
          <span class="pm-done-mark" aria-hidden="true">${ICON.check}</span>
          <h3>${esc(r.paidWith === "credit" ? "Session credit applied" : "Paid " + usd(r.totalCents))}</h3>
          <p>${esc(r.program)}</p>
        </div>
        <div class="pm-sum">
          ${sumRow("Athlete", esc(r.athlete))}
          ${sumRow("Session", esc(r.sessionLabel))}
          ${sumRow("Tier", esc(r.tier))}
          ${r.paidWith === "credit"
            ? sumRow("Paid with", "1 session credit")
            : sumRow("Paid with", esc(r.method))}
          ${sumRow("Session price", usd(r.grossCents))}
          ${r.feeCents ? sumRow(feeLabel(r.feeCents, r.grossCents, "(paid by the coach)"), "−" + usd(r.feeCents)) : ""}
          ${sumRow("Charged", usd(r.totalCents), "total")}
        </div>
        <p class="pm-fine">Cancellation policy on this booking: <b>${esc(POLICIES[r.policy].label)}</b> —
          ${esc(POLICIES[r.policy].blurb)} It was copied onto the booking at purchase and governs any
          refund even if the listing changes its policy later.</p>
        <button class="btn wide pm-gap" data-nav="bookings">View my bookings</button>
        <button class="btn ghost wide pm-gap" data-pm-nav="wallet">Open wallet</button>`);
    }

    /* ── step 1: review ── */
    if (d.step === 1) {
      return wrap("Checkout", `
        ${stepBar(1)}
        <div class="pm-target">
          <span class="pm-dot" aria-hidden="true" style="background:${sportColor(p.sport)}"></span>
          <div><b>${esc(p.title)}</b>
            <span class="pm-meta">${esc(p.biz)} · ${esc(p.sport)}</span></div>
        </div>

        <form id="pmReviewForm" novalidate>
          <div class="field">
            <label for="pmAthlete">Athlete</label>
            <select id="pmAthlete" name="athleteId">
              ${athletes.map(a => `<option value="${esc(a.id)}" ${a.id === (athlete || {}).id ? "selected" : ""}>${esc(a.firstName + " " + (a.lastName || ""))}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="pmSlot">Session</label>
            <select id="pmSlot" name="slotId">
              ${slots.map(s => `<option value="${esc(s.id)}" ${s.id === (slot || {}).id ? "selected" : ""}>${esc(fmtDate(s.date))} · ${esc(s.startTime)}–${esc(s.endTime)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="pmTier">Tier</label>
            <select id="pmTier" name="tier">
              ${["Standard", "Premium (+$15)"].map(x => `<option ${x === d.tier ? "selected" : ""}>${esc(x)}</option>`).join("")}
            </select>
          </div>

          <div class="pm-sum">
            ${sumRow(`${esc(p.title)} · ${esc(modelLabel(p.model))}`, money(p.price))}
            ${tierExtraCents(d.tier) ? sumRow("Premium tier", usd(tierExtraCents(d.tier))) : ""}
            ${sumRow("Session price", usd(t.gross))}
            ${t.fee ? sumRow(`Sporv's ${FEE_PCT}% (paid by the coach)`, "−" + usd(t.fee)) : ""}
            ${sumRow("Total", usd(t.total), "total")}
          </div>
          <p class="pm-fine">${t.fee
            ? `You pay the coach's price. The ${FEE_PCT}% fee is Sporv's share of it,
               deducted from the coach's earnings and never added to your total.`
            : `You pay the coach's price. Sporv takes 0% of the booking — the coach keeps
               every dollar and pays for the software by subscription.`}
            ${esc(POLICIES[p.cancellationPolicy] ? POLICIES[p.cancellationPolicy].label : "Moderate")}
            cancellation applies and is copied onto the booking when you pay.</p>

          <div id="pmReviewErr" class="err hide"></div>
          <button class="btn wide pm-gap" type="submit">Continue to payment</button>
        </form>`);
    }

    /* ── step 2: payment method ── */
    if (d.step === 2) {
      const list = cards();
      return wrap("Payment method", `
        ${stepBar(2)}
        ${credits > 0 ? `
          <label class="pm-choice ${d.useCredit ? "on" : ""}">
            <input type="radio" name="pmMethod" value="credit" ${d.useCredit ? "checked" : ""}>
            <span class="pm-choice-in">
              <b>Use 1 session credit</b>
              <span class="num">${credits} credit${credits === 1 ? "" : "s"} left for ${esc(p.biz)} · worth ${usd(creditValueFor(p.id))} each</span>
            </span>
          </label>` : ""}

        ${list.length ? list.map(c => `
          <label class="pm-choice ${(!d.useCredit && d.cardId === c.id) ? "on" : ""}">
            <input type="radio" name="pmMethod" value="card:${esc(c.id)}" ${(!d.useCredit && d.cardId === c.id) ? "checked" : ""}>
            <span class="pm-choice-in">
              <b>${esc(cardLabel(c))}</b>
              <span class="num">Expires ${esc(expLabel(c))}${c.isDefault ? " · default" : ""}</span>
            </span>
          </label>`).join("") : `
          <div class="pm-note">
            <h3>No card on file</h3>
            <p>Add one to pay for this session. Sporv stores the brand, the last four digits, and
               the expiry — never the full card number.</p>
          </div>`}

        <button class="btn ghost wide pm-gap" data-pm-addcard="1">Add a card</button>

        <div class="pm-sum pm-gap">
          ${sumRow("Session price", usd(t.gross))}
          ${t.fee ? sumRow(`Sporv's ${FEE_PCT}% (paid by the coach)`, "−" + usd(t.fee)) : ""}
          ${sumRow("Total", usd(t.total), "total")}
        </div>

        <div id="pmPayErr" class="err hide"></div>
        <div class="pm-actions">
          <button class="btn ghost" data-pm-step="1">Back</button>
          <button class="btn" data-pm-step="3">Review and pay</button>
        </div>`);
    }

    /* ── step 3: confirm ── */
    const pol = POLICIES[p.cancellationPolicy] || POLICIES.moderate;
    return wrap("Confirm and pay", `
      ${stepBar(3)}
      <div class="pm-sum">
        ${sumRow("Program", esc(p.title))}
        ${sumRow("Athlete", esc((athlete.firstName + " " + (athlete.lastName || "")).trim()))}
        ${sumRow("Session", slot ? `${esc(fmtDate(slot.date))} · ${esc(slot.startTime)}` : "—")}
        ${sumRow("Tier", esc(d.tier))}
        ${sumRow("Paying with", d.useCredit ? "1 session credit" : esc(cardLabel(card)))}
      </div>
      <div class="pm-sum pm-gap">
        ${sumRow("Session price", usd(t.gross))}
        ${t.fee ? sumRow(`Sporv's ${FEE_PCT}% (paid by the coach)`, "−" + usd(t.fee)) : ""}
        ${sumRow(d.useCredit ? "Charged today" : "Total", usd(t.total), "total")}
      </div>
      ${d.useCredit ? `<p class="pm-fine">Nothing is charged today — a credit you already paid for covers
        this session, and its ${usd(creditValueFor(p.id))} value is what a refund is measured against.</p>` : ""}
      <div class="pm-note pm-gap">
        <h3>${esc(pol.label)} cancellation</h3>
        <p>${esc(pol.blurb)} This policy is copied onto the booking now and is the one that governs
           your refund later, even if ${esc(p.biz)} changes the listing.</p>
      </div>
      <div id="pmConfirmErr" class="err hide"></div>
      <div class="pm-actions">
        <button class="btn ghost" data-pm-step="2">Back</button>
        <button class="btn" data-pm-confirm="1">${d.useCredit ? "Use credit and book" : "Pay " + usd(t.total)}</button>
      </div>`);
  }

  function confirmCheckout() {
    const m = S.modal || {};
    const p = PROGRAMS.find(x => x.id === m.programId);
    if (!p) return showErr("pmConfirmErr", "That program is no longer available.");
    const d = draft;
    const slots = slotsFor(p.id) || [];
    const slot = slots.find(s => s.id === d.slotId) || slots[0];
    const athlete = (S.athletes || []).find(a => a.id === d.athleteId) || (S.athletes || [])[0];
    if (!slot || !athlete) return showErr("pmConfirmErr", "Pick an athlete and a session before paying.");

    const useCredit = !!d.useCredit && creditsFor(p.id) > 0;
    const card = useCredit ? null : cardById(d.cardId);
    if (!useCredit && !card) return showErr("pmConfirmErr", "Select a card to pay with.");

    const t = totalsFor(p, d.tier, useCredit);
    const creditValue = useCredit ? creditValueFor(p.id) : 0;
    const stamp = Date.now();
    const txId = "txn_" + stamp;
    const bookId = "book_" + stamp;

    const booking = {
      id: bookId,
      athlete: (athlete.firstName + " " + (athlete.lastName || "")).trim(),
      programId: p.id,
      program: p.title,
      sessionId: slot.id,
      session: slot.title,
      date: slot.date,
      startTime: slot.startTime,
      tier: d.tier,
      price: (useCredit ? creditValue : t.gross) / 100,
      status: "confirmed",
      paymentStatus: "paid",
      createdAt: TODAY,
      /* itemized capture + the policy snapshot the refund will be read from */
      grossCents: t.gross,
      feeCents: t.fee,
      totalCents: t.total,
      creditValueCents: creditValue,
      paidWith: useCredit ? "credit" : "card",
      cardId: card ? card.id : null,
      cardBrand: card ? card.brand : null,
      cardLast4: card ? card.last4 : null,
      cancellationPolicy: p.cancellationPolicy,
      policySnapshotAt: TODAY,
      transactionId: txId,
    };

    txns().unshift({
      id: txId,
      at: TODAY,
      kind: useCredit ? "redeem" : "booking",
      bookingId: bookId,
      programId: p.id,
      desc: `${p.title} · ${slot.title}`,
      grossCents: t.gross,
      feeCents: t.fee,
      netCents: t.gross - t.fee,
      chargedCents: t.total,
      credits: useCredit ? -1 : 0,
      method: useCredit ? "credit" : "card",
      cardId: card ? card.id : null,
      brand: card ? card.brand : null,
      last4: card ? card.last4 : null,
      status: "paid",
    });

    S.bookings = [booking, ...(S.bookings || [])];
    S.notifications = [{
      id: "n" + stamp, title: "Booking Confirmed",
      message: `Your booking for ${slot.title} has been confirmed.`,
      read: false, at: new Date().toISOString(),
    }, ...(S.notifications || [])];

    draft.step = 4;
    draft.receipt = {
      program: p.title,
      athlete: booking.athlete,
      sessionLabel: `${fmtDate(slot.date)} · ${slot.startTime}`,
      tier: d.tier,
      grossCents: t.gross,
      feeCents: t.fee,
      totalCents: t.total,
      paidWith: booking.paidWith,
      method: cardLabel(card),
      policy: p.cancellationPolicy,
    };
    render();
    toast(useCredit ? "Booked with a session credit" : `Paid ${usd(t.total)}`);
  }

  /* ═══════════════════ CANCEL A BOOKING ═══════════════════ */
  function cancelBookingModal() {
    const m = S.modal || {};
    const b = bookingById(m.bookingId);
    if (!b) {
      return wrap("Cancel booking", `
        <div class="pm-note"><h3>We can't find that booking</h3>
          <p>It may have been removed from your account. Open Bookings and try again from there.</p></div>
        <button class="btn ghost wide" data-nav="bookings">View bookings</button>`);
    }

    const done = ["cancelled", "declined", "completed", "no_show", "expired"];
    if (done.includes(b.status)) {
      return wrap("Cancel booking", `
        <div class="pm-note"><h3>This booking is already ${esc((STATUS_LABEL[b.status] || b.status).toLowerCase())}</h3>
          <p><b>${esc(b.program)}</b> is no longer active, so there is nothing left to cancel.
             Its payment status is ${esc((STATUS_LABEL[b.paymentStatus] || b.paymentStatus).toLowerCase())}.</p>
          <div class="pm-gap">${pill(b.status)} ${pill(b.paymentStatus)}</div>
        </div>
        <button class="btn ghost wide" data-close="1">Close</button>`);
    }

    const { key, policy, snapshotted } = policyFor(b);
    const start = sessionStart(b.date, b.startTime);
    const h = hoursUntil(start);
    const past = h <= 0;
    const band = past ? { pct: 0, text: "after the session has started" } : bandFor(policy, h);
    const ch = charged(b);
    const byCredit = b.paidWith === "credit";
    const basis = byCredit ? (b.creditValueCents || ch.gross) : ch.gross;
    const fullBand = band.pct === 100;
    /* a credit under a full-refund band comes back as the credit itself — no cash moves */
    const creditReturn = byCredit && fullBand && !past;
    const refundGross = (past || creditReturn) ? 0 : pctOf(basis, band.pct);
    const refundFee = (past || byCredit || ch.fee == null) ? 0 : pctOf(ch.fee, band.pct);
    /* deducted incidence: the family was only ever charged the coach's price, so the cash
       going back is the session share alone. refundFee is the coach-side clawback. */
    const refundTotal = refundGross;

    /* the ladder, with each threshold resolved to a real cutoff time */
    const ladder = policy.bands.map(bd => {
      const cut = start ? new Date(start.getTime() - bd.minHours * 3600000) : null;
      const applies = !past && bd === band;
      return `<div class="pm-math-row ${applies ? "on" : ""}">
        <span>${esc(bd.pct)}% back ${esc(bd.text)}${cut && bd.minHours > 0 ? ` — until ${esc(stampDateTime(cut))}` : ""}</span>
        <span class="num">${esc(bd.pct)}%</span></div>`;
    }).join("");

    return wrap("Cancel booking", `
      <div class="pm-target">
        <span class="pm-dot" aria-hidden="true" style="background:${sportColor((programOf(b) || {}).sport || "")}"></span>
        <div><b>${esc(b.program)}</b>
          <span class="pm-meta num">${esc(b.athlete)} · ${esc(fmtDate(b.date))} · ${esc(b.startTime || "")}</span></div>
      </div>
      <div class="pm-sum">
        ${sumRow("Booking status", pill(b.status))}
        ${sumRow("Payment status", pill(b.paymentStatus))}
      </div>

      <div class="pm-note ${snapshotted ? "" : "pm-note-warn"} pm-gap">
        <h3>${esc(policy.label)} policy${snapshotted ? "" : " (not snapshotted)"}</h3>
        <p>${snapshotted
          ? `This is the policy copied onto the booking on ${esc(fmtDate(b.policySnapshotAt || b.createdAt || TODAY))}.
             The listing's current policy does not apply to it.`
          : `This booking predates policy capture, so there is no snapshot on it. We are falling back to
             ${esc((programOf(b) || {}).biz || "the provider")}'s current listing policy — <b>${esc(key)}</b> — and saying so
             rather than pretending a snapshot exists.`}</p>
      </div>

      <div class="pm-math">
        <div class="eyebrow">The ladder on this booking</div>
        ${ladder}
        <div class="pm-math-row pm-math-sep">
          <span>${past ? "Session already started" : "Time until the session"}</span>
          <span class="num">${past ? esc(stampDateTime(start)) : esc(roundHours(h)) + " hours"}</span>
        </div>
        <div class="pm-math-row">
          <span>Band that applies</span><span class="num">${esc(band.pct)}% back</span>
        </div>
      </div>

      <div class="pm-sum pm-gap">
        ${byCredit
          ? sumRow("Credit value on this booking", usd(basis))
          : sumRow("Session price paid", usd(ch.gross))}
        ${/* RECORDED fee: labelled at the rate this booking actually paid, never at the
             live FEE_PCT — a 12% booking stays a 12% booking after the rate went to 0.
             A recorded 0 prints nothing; only a missing capture says "not recorded". */""}
        ${(!byCredit && ch.fee) ? sumRow(feeLabel(ch.fee, ch.gross, "(from the coach)"), "−" + usd(ch.fee)) : ""}
        ${(!byCredit && ch.fee == null) ? `<div class="pm-sum-row"><span>Sporv's fee</span><span class="pm-meta">not recorded on this booking</span></div>` : ""}
        ${(!byCredit && ch.itemized) ? sumRow("Charged", usd(ch.total)) : ""}
      </div>

      <div class="pm-math pm-gap">
        <div class="eyebrow">Refund arithmetic</div>
        ${byCredit ? `
          <div class="pm-math-row"><span>Credit value ${usd(basis)} × ${esc(band.pct)}%</span><span class="num">${usd(pctOf(basis, band.pct))}</span></div>
          <div class="pm-math-row pm-math-sep"><span>${creditReturn
            ? "A full-refund band returns the credit itself, so no cash moves"
            : band.pct > 0
              ? "A part-refund band can't split a credit, so that share is returned in cash to the card that bought the pack"
              : "No band, no return — the credit is consumed"}</span>
            <span class="num">${creditReturn ? "1 credit" : usd(refundGross)}</span></div>`
        : `
          <div class="pm-math-row"><span>Session price ${usd(ch.gross)} × ${esc(band.pct)}%</span><span class="num">${usd(refundGross)}</span></div>
          ${ch.fee
            ? `<div class="pm-math-row"><span>Sporv gives back its ${recordedPct(ch.fee, ch.gross) == null ? "fee" : recordedPct(ch.fee, ch.gross) + "%"} too — ${usd(ch.fee)} × ${esc(band.pct)}% — to the coach, not to you</span><span class="num">−${usd(refundFee)}</span></div>`
            : ch.fee == null
              ? `<div class="pm-math-row"><span>Sporv's fee</span><span class="pm-meta">nothing recorded, so nothing returned</span></div>`
              : ""}
          <div class="pm-math-row pm-math-sep"><span><b>Refund to ${esc(b.cardLast4 ? cardLabel({ brand: b.cardBrand, last4: b.cardLast4 }) : "your original payment method")}</b></span>
            <span class="num"><b>${usd(refundTotal)}</b></span></div>`}
      </div>

      <p class="pm-fine">${(refundTotal > 0 || creditReturn)
        ? (ch.fee
            ? "Sporv returns its fee in the same proportion as the session price — we don't keep a fee on money we give back."
            : "The refund is the session price alone. Sporv took no fee on this booking, so there is none to return.")
        : "This cancellation returns nothing. Cancelling is still recorded, and the seat is released to the waitlist."}</p>

      <div id="pmCancelErr" class="err hide"></div>
      <div class="pm-actions pm-gap">
        <button class="btn ghost" data-close="1">Keep my booking</button>
        <button class="btn pm-btn-danger" data-pm-docancel="${esc(b.id)}">
          ${refundTotal > 0 ? "Cancel and refund " + usd(refundTotal) : creditReturn ? "Cancel and return the credit" : "Cancel with no refund"}
        </button>
      </div>`);
  }

  function doCancel(id) {
    const b = bookingById(id);
    if (!b) return showErr("pmCancelErr", "That booking is no longer on your account.");

    const { policy } = policyFor(b);
    const start = sessionStart(b.date, b.startTime);
    const h = hoursUntil(start);
    const past = h <= 0;
    const band = past ? { pct: 0 } : bandFor(policy, h);
    const ch = charged(b);
    const byCredit = b.paidWith === "credit";
    const basis = byCredit ? (b.creditValueCents || ch.gross) : ch.gross;
    const refundGross = past ? 0 : pctOf(basis, band.pct);
    const refundFee = (past || byCredit || ch.fee == null) ? 0 : pctOf(ch.fee, band.pct);
    /* deducted incidence: the family was only ever charged the coach's price, so the cash
       going back is the session share alone. refundFee is the coach-side clawback. */
    const refundTotal = refundGross;
    const stamp = Date.now();

    setStatus(b, "cancelled");
    b.cancelledAt = TODAY;

    if (byCredit && band.pct === 100) {
      /* the credit itself goes back — no cash moves, so no cash row is written */
      txns().unshift({
        id: "txn_" + stamp, at: TODAY, kind: "credit_return", bookingId: b.id,
        programId: b.programId, desc: `Credit returned · ${b.program}`,
        grossCents: 0, feeCents: 0, netCents: 0, chargedCents: 0, credits: 1,
        method: "credit", status: "refunded",
      });
      setStatus(b, null, "refunded");
      b.refundCents = 0;
      S.modal = null; render();
      toast("Cancelled — 1 session credit returned");
      return;
    }

    if (refundTotal > 0) {
      txns().unshift({
        id: "txn_" + stamp, at: TODAY, kind: "refund", bookingId: b.id,
        programId: b.programId,
        desc: `Refund (${band.pct}%) · ${b.program}`,
        grossCents: -refundGross, feeCents: -refundFee,
        netCents: -(refundGross - refundFee), chargedCents: -refundTotal,
        credits: 0,
        method: "card",
        cardId: b.cardId || (defaultCard() || {}).id || null,
        brand: b.cardBrand || (defaultCard() || {}).brand || null,
        last4: b.cardLast4 || (defaultCard() || {}).last4 || null,
        status: band.pct === 100 ? "refunded" : "partially_refunded",
      });
      setStatus(b, null, band.pct === 100 && !byCredit ? "refunded" : "partially_refunded");
      b.refundCents = refundTotal;
      S.modal = null; render();
      toast(`Cancelled — ${usd(refundTotal)} refunded`);
      return;
    }

    /* nothing to give back: the payment status is untouched, because nothing moved */
    b.refundCents = 0;
    S.modal = null; render();
    toast("Booking cancelled — no refund under this policy");
  }

  /* ═══════════════════ ADD A CARD ═══════════════════ */
  function addCardModal() {
    const m = S.modal || {};
    return wrap("Add a card", `
      <form id="pmCardForm" novalidate>
        <div class="field">
          <label for="pmNum">Card number</label>
          <input id="pmNum" name="number" inputmode="numeric" autocomplete="cc-number"
                 placeholder="1234 5678 9012 3456" aria-describedby="pmBrand">
          <div id="pmBrand" class="pm-brandchip">Network is read from the card's first digits</div>
        </div>
        <div class="pm-row3">
          <div class="field">
            <label for="pmExp">Expiry</label>
            <input id="pmExp" name="exp" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/YY" maxlength="5">
          </div>
          <div class="field">
            <label for="pmCvc">CVC</label>
            <input id="pmCvc" name="cvc" inputmode="numeric" autocomplete="cc-csc" placeholder="123" maxlength="4">
          </div>
          <div class="field">
            <label for="pmZip">ZIP code</label>
            <input id="pmZip" name="postal" inputmode="numeric" autocomplete="postal-code" placeholder="33145" maxlength="10">
          </div>
        </div>
        <label class="pm-inline">
          <input type="checkbox" name="makeDefault" ${cards().length ? "" : "checked"}>
          <span>Make this my default payment method</span>
        </label>

        <div id="pmCardErr" class="err hide"></div>
        <button class="btn wide pm-gap" type="submit">Save card</button>
        ${m.returnTo ? `<button class="btn ghost wide pm-gap" type="button" data-pm-cardback="1">Back to checkout</button>` : ""}
        <p class="pm-fine">Sporv keeps the network, the last four digits, and the expiry. The full
          card number is never stored here and is never shown back to you.</p>
      </form>`);
  }

  function validateCard(d) {
    const digits = String(d.number || "").replace(/\D/g, "");
    if (!digits) return "Enter the card number.";
    const brand = brandOf(digits);
    if (!brand) return "We don't recognize that card network. Sporv takes Visa, Mastercard, Amex, and Discover.";
    const spec = BRANDS[brand];
    if (digits.length !== spec.digits) return `A ${spec.label} card has ${spec.digits} digits — you entered ${digits.length}.`;
    if (!luhnOK(digits)) return "That card number fails its checksum. Check for a mistyped digit.";

    const exp = /^(\d{2})\s*\/\s*(\d{2})$/.exec(String(d.exp || "").trim());
    if (!exp) return "Enter the expiry as MM/YY.";
    const mm = parseInt(exp[1], 10), yy = 2000 + parseInt(exp[2], 10);
    if (mm < 1 || mm > 12) return "The expiry month has to be 01 through 12.";
    /* a card is good through the last day of its expiry month */
    if (yy < NOW.getFullYear() || (yy === NOW.getFullYear() && mm < NOW.getMonth() + 1))
      return `That card expired in ${exp[1]}/${exp[2]}. Today is ${stampDate(NOW)}, 2026.`;
    if (yy > NOW.getFullYear() + 20) return "That expiry is too far out to be a real card.";

    const cvc = String(d.cvc || "").replace(/\D/g, "");
    if (cvc.length !== spec.cvc) return `A ${spec.label} security code is ${spec.cvc} digits.`;

    const postal = String(d.postal || "").trim();
    if (!/^\d{5}(-\d{4})?$/.test(postal)) return "Enter the 5-digit ZIP code on the card's billing address.";

    return { brand, last4: digits.slice(-4), expMonth: mm, expYear: yy, postal };
  }

  /* ═══════════════════ SPLIT PAY ═══════════════════ */
  function splitPayModal() {
    const m = S.modal || {};
    const b = bookingById(m.bookingId);
    if (!b) {
      return wrap("Split with a guardian", `
        <div class="pm-note"><h3>We can't find that booking</h3>
          <p>Open Bookings and start the split from the session you want to share.</p></div>
        <button class="btn ghost wide" data-nav="bookings">View bookings</button>`);
    }
    const ch = charged(b);
    if (b.paidWith === "credit" || ch.total <= 0) {
      return wrap("Split with a guardian", `
        <div class="pm-note pm-note-warn"><h3>Nothing was charged for this session</h3>
          <p><b>${esc(b.program)}</b> was covered by a session credit, so there is no amount to split.
             A credit is bought once and can't be divided after the fact.</p></div>
        <button class="btn ghost wide" data-close="1">Close</button>`);
    }

    const existing = splits().find(r => r.bookingId === b.id);
    if (existing) {
      const st = splitStatus(existing);
      return wrap("Split with a guardian", `
        <div class="pm-target">
          <div><b>${esc(b.program)}</b>
            <span class="pm-meta num">${esc(b.athlete)} · ${esc(fmtDate(b.date))}</span></div>
        </div>
        <div class="pm-sum">
          ${sumRow("Sent to", esc(existing.email))}
          ${sumRow("Their share", usd(existing.guardianCents))}
          ${sumRow("Your share", usd(existing.requesterCents))}
          ${sumRow("Together", usd(existing.totalCents), "total")}
          ${sumRow("Status", pill(st))}
        </div>
        <div class="pm-link">
          <span class="eyebrow">Share link</span>
          <code class="num" id="pmShareLink">${esc(existing.shareUrl)}</code>
          <button class="btn ghost sm" data-pm-copy="${esc(existing.shareUrl)}">Copy link</button>
        </div>
        <p class="pm-fine">${st === "expired"
          ? `This request expired on ${esc(fmtDate(existing.expiresAt))}. Nothing was collected from it.`
          : st === "accepted"
          ? `Accepted on ${esc(fmtDate(existing.acceptedAt))}. ${usd(existing.guardianCents)} was collected
             from the other guardian and credited back to your card, leaving ${usd(existing.requesterCents)} on it.`
          : `The request expires on ${esc(fmtDate(existing.expiresAt))}. Until the other guardian accepts,
             the full ${usd(existing.totalCents)} stays on your card — a split request does not move money on its own.`}</p>
        ${st === "pending" ? `<div class="pm-note pm-gap">
          <p>The other guardian accepts by opening that link on their own device. There is no server here,
             so you can play their side of it to see how the split settles.</p>
          <button class="btn ghost sm" data-pm-splitaccept="${esc(existing.id)}">Preview: accept as ${esc(existing.email)}</button>
        </div>` : ""}
        <button class="btn ghost wide pm-gap" data-close="1">Close</button>`);
    }

    /* the odd cent is kept, not dropped: the requester carries it */
    const half = Math.floor(ch.total / 2);
    const mine = ch.total - half;
    return wrap("Split with a guardian", `
      <div class="pm-target">
        <div><b>${esc(b.program)}</b>
          <span class="pm-meta num">${esc(b.athlete)} · ${esc(fmtDate(b.date))} · ${esc(b.startTime || "")}</span></div>
      </div>

      <form id="pmSplitForm" novalidate>
        <div class="field">
          <label for="pmSplitEmail">Second guardian's email</label>
          <input id="pmSplitEmail" name="email" type="email" placeholder="guardian@example.com">
        </div>

        <div class="pm-math">
          <div class="eyebrow">How ${usd(ch.total)} divides</div>
          <div class="pm-math-row"><span>Session price</span><span class="num">${usd(ch.gross)}</span></div>
          ${ch.fee ? `<div class="pm-math-row"><span>${feeLabel(ch.fee, ch.gross, "(paid by the coach)")}</span><span class="num">−${usd(ch.fee)}</span></div>` : ""}
          <div class="pm-math-row pm-math-sep"><span>Their half</span><span class="num">${usd(half)}</span></div>
          <div class="pm-math-row"><span>Your half${mine !== half ? " (carries the odd cent)" : ""}</span><span class="num">${usd(mine)}</span></div>
          <div class="pm-math-row on"><span><b>Together</b></span><span class="num"><b>${usd(mine + half)}</b></span></div>
        </div>

        <div id="pmSplitErr" class="err hide"></div>
        <button class="btn wide pm-gap" type="submit">${ICON.send} Send the request</button>
        <p class="pm-fine">Sending creates a link and a <b>pending</b> request that expires in
          ${SPLIT_VALID_DAYS} days. Your card already paid the full ${usd(ch.total)}; when the other
          guardian accepts, their ${usd(half)} comes back to you. Nothing is collected until then.</p>
      </form>`);
  }

  /* ═══════════════════ VIEW · WALLET ═══════════════════ */
  let packPid = null;

  function walletView() {
    const sub = typeof subnavHTML === "function" ? subnavHTML() : "";
    if (!isVerified()) {
      return `${sub}<main class="shell"><div class="empty">
        <h2>Sign in to open your wallet</h2>
        <p style="margin-top:8px">Payment methods, receipts, and session credits live here.</p>
        <button class="btn" data-signin="1" style="margin-top:20px">Log in or sign up</button>
      </div></main>`;
    }

    const list = cards();
    const rows = txns();
    const netCharged = rows.reduce((s, t) => s + (t.chargedCents || 0), 0);
    const feesPaid = rows.reduce((s, t) => s + (t.feeCents || 0), 0);
    const creditRows = [...new Set(rows.filter(t => t.credits).map(t => t.programId))]
      .map(pid => [pid, creditsFor(pid)])
      .filter(([, n]) => n > 0);
    const creditTotal = creditRows.reduce((s, [, n]) => s + n, 0);

    const txRows = rows.map(t => `<tr>
      <td class="num">${esc(fmtDate(t.at))}</td>
      <td>${esc(t.desc)}</td>
      <td>${esc(t.method === "credit" ? "Session credit" : (t.brand ? BRANDS[t.brand].label + " ···· " + t.last4 : "Card"))}</td>
      <td class="num">${usd(t.grossCents)}</td>
      <td class="num">${usd(t.feeCents)}</td>
      <td class="num">${usd(t.netCents)}</td>
      <td class="num">${usd(t.chargedCents)}</td>
      <td>${pill(t.status)}</td></tr>`).join("");

    /* credit-pack maths, computed against a real single-session listing */
    const eligible = PROGRAMS.filter(p => p.model === "single_session");
    const pid = packPid && eligible.some(p => p.id === packPid) ? packPid : (eligible[0] || {}).id;
    const pp = eligible.find(p => p.id === pid) || null;
    const pack = packs()[0] || { sessions: PACK_SESSIONS, discountPct: PACK_DISCOUNT_PCT };
    let packBlock = `<p class="pm-none">No single-session listings are available to buy a pack against.</p>`;
    if (pp) {
      const unit = Math.round(Number(pp.price) * 100);
      const full = unit * pack.sessions;
      const off = pctOf(full, pack.discountPct);
      const gross = full - off;
      const per = gross / pack.sessions;                 // exact: 5 divides both cents cleanly here
      const perCents = Math.round(gross / pack.sessions);
      const fee = feeOn(gross);
      packBlock = `
        <form id="pmPackForm" novalidate>
          <div class="field">
            <label for="pmPackProgram">Buy credits for</label>
            <select id="pmPackProgram" name="programId">
              ${eligible.map(p => `<option value="${esc(p.id)}" ${p.id === pid ? "selected" : ""}>${esc(p.biz)} — ${esc(p.title)} (${money(p.price)}/session)</option>`).join("")}
            </select>
          </div>
          <div class="pm-math">
            <div class="eyebrow">${pack.sessions}-session pack</div>
            <div class="pm-math-row"><span>${pack.sessions} × ${money(pp.price)} at list price</span><span class="num">${usd(full)}</span></div>
            <div class="pm-math-row"><span>Pack discount (${esc(pack.discountPct)}%)</span><span class="num">−${usd(off)}</span></div>
            <div class="pm-math-row pm-math-sep"><span>Pack price</span><span class="num">${usd(gross)}</span></div>
            ${fee ? `<div class="pm-math-row"><span>Sporv's ${FEE_PCT}% (paid by the coach)</span><span class="num">−${usd(fee)}</span></div>` : ""}
            <div class="pm-math-row on"><span><b>Charged today</b></span><span class="num"><b>${usd(gross)}</b></span></div>
            <div class="pm-math-row pm-math-sep"><span>Effective price per session</span>
              <span class="num">${usd(perCents)}${per === perCents ? "" : " (rounded)"}</span></div>
            <div class="pm-math-row"><span>Saved per session against ${money(pp.price)}</span>
              <span class="num">${usd(unit - perCents)}</span></div>
          </div>
          <div id="pmPackErr" class="err hide"></div>
          <button class="btn pm-gap" type="submit">Buy ${pack.sessions} sessions for ${usd(gross)}</button>
          <p class="pm-fine">Credits are held against this listing and pay for one session each at checkout.
            ${fee
              ? `The discount is applied to the coach's price; Sporv's fee is taken from the discounted
                 total, not the list price.`
              : `The discount is applied to the coach's price, and the coach keeps all of it —
                 Sporv takes 0% of a pack.`}</p>
        </form>`;
    }

    return `${sub}<main class="shell pm-wrap">
      <div class="sec-head"><div>
        <p class="eyebrow">Payments</p>
        <h1>Wallet</h1>
        <p class="pm-lede">${feeLive()
          ? `Your cards, every charge and refund with Sporv's ${FEE_PCT}% itemized so you can
             see it comes out of the coach's side, and any session credits you have bought.`
          : `Your cards, every charge and refund, and any session credits you have bought.
             Sporv takes 0% of a booking — the coach keeps every dollar you pay.`}
          Every row here corresponds to money that actually moved.</p>
      </div></div>

      <div class="stats">
        <div class="stat"><div class="k">Cards on file</div><div class="v num">${list.length}</div>
          <div class="d">${list.length ? esc(cardLabel(defaultCard())) + " is default" : "None yet"}</div></div>
        <div class="stat"><div class="k">Net charged</div><div class="v num">${usd(netCharged)}</div>
          <div class="d">${rows.length} transaction${rows.length === 1 ? "" : "s"}, refunds included</div></div>
        ${/* the stat sums RECORDED fees, so it keeps its value after the rate went to 0;
             only the description changes, because the money in it really was taken. */""}
        <div class="stat"><div class="k">Sporv's share</div><div class="v num">${usd(feesPaid)}</div>
          <div class="d">${feeLive()
            ? `${FEE_PCT}% of each booking, paid by the coach`
            : feesPaid
              ? "Taken on earlier bookings. New bookings are 0%"
              : "Sporv takes 0% of a booking"}</div></div>
        <div class="stat"><div class="k">Session credits</div><div class="v num">${creditTotal}</div>
          <div class="d">${creditRows.length ? "across " + creditRows.length + " listing" + (creditRows.length === 1 ? "" : "s") : "No packs bought"}</div></div>
      </div>

      <section class="panel pm-panel">
        <div class="pm-sec"><h2>Payment methods</h2>
          <button class="btn ghost sm" data-pm-addcard="1">Add a card</button></div>
        ${list.length ? list.map(c => `
          <div class="pm-cardrow">
            <div class="pm-card-in">
              <b>${esc(cardLabel(c))}</b>
              <span class="pm-meta num">Expires ${esc(expLabel(c))} · ZIP ${esc(c.postal)} · added ${esc(fmtDate(c.addedAt))}</span>
            </div>
            ${c.isDefault ? `<span class="pill slate">Default</span>`
              : `<button class="btn ghost sm" data-pm-default="${esc(c.id)}">Make default</button>`}
            <button class="pm-remove" data-pm-remove="${esc(c.id)}"
              aria-label="Remove ${esc(cardLabel(c))}">Remove</button>
          </div>`).join("")
          : `<p class="pm-none">No card on file. Sporv stores the network, the last four digits, and the
              expiry — never the full number.</p>`}
      </section>

      <section class="panel pm-panel">
        <div class="pm-sec"><h2>Transactions</h2>
          <span class="pm-meta num">${rows.length} record${rows.length === 1 ? "" : "s"}</span></div>
        ${rows.length ? `<div class="tblwrap"><table class="tbl" aria-label="Transaction history">
            <thead><tr><th>Date</th><th>Description</th><th>Method</th><th>Gross</th>
              <th>Fee</th><th>Net to coach</th><th>Charged</th><th>Status</th></tr></thead>
            <tbody>${txRows}</tbody></table></div>
          <p class="pm-fine"><b>Gross</b> is the coach's price. <b>Fee</b> is Sporv's share,
            taken from the coach's side${feeLive() ? ` — ${FEE_PCT}% today` : ` — 0% on new bookings, so the column
            only carries fees charged before the subscription model`}. <b>Net to coach</b> is gross
            minus the fee. <b>Charged</b> is what left your card — the coach's price, with no fee
            added. Refunds are the same four numbers with the sign flipped.</p>`
          : `<p class="pm-none">No transactions yet. Nothing has been charged to this account.</p>`}
      </section>

      <section class="panel pm-panel">
        <div class="pm-sec"><h2>Session credits</h2>
          <span class="pm-meta num">${creditTotal} available</span></div>
        ${creditRows.length ? `<div class="pm-credits">
          ${creditRows.map(([cpid, n]) => {
            const cp = PROGRAMS.find(x => x.id === cpid);
            return `<div class="pm-cardrow">
              <div class="pm-card-in"><b>${esc(cp ? cp.title : cpid)}</b>
                <span class="pm-meta num">${esc(cp ? cp.biz : "")} · worth ${usd(creditValueFor(cpid))} per session</span></div>
              <span class="pill good num">${n} left</span></div>`;
          }).join("")}
        </div>` : ""}
        ${packBlock}
      </section>
    </main>`;
  }

  /* ═══════════════════ WIRING ═══════════════════ */
  function showErr(id, msg) {
    const el = document.getElementById(id);
    if (!el) { toast(msg); return; }
    el.textContent = msg;
    el.classList.remove("hide");
  }
  function goWallet() {
    S.modal = null;
    S.portal = "family";
    S.route = { name: "wallet", arg: null };
    if (typeof window !== "undefined" && window.scrollTo) window.scrollTo(0, 0);
    render();
  }
  function openModal(next) {
    requireAuth(() => { S.modal = next; render(); });
  }

  /* the host binds [data-close] with an equality guard, so a click landing on
     the icon inside the close button doesn't dismiss. Rebind our own. */
  function wireClose() {
    const mine = document.querySelector(".pm-body");
    if (!mine || !mine.closest) return;
    const scrim = mine.closest(".scrim");
    if (!scrim) return;
    scrim.querySelectorAll("[data-close]").forEach(b => b.onclick = () => { S.modal = null; render(); });
    scrim.onclick = e => { if (e.target === scrim) { S.modal = null; render(); } };
  }

  /* ── host pages carry no payment affordances, so we add ours to the
        rendered DOM after each paint. No host file is modified. ── */
  function injectAccountRow() {
    const modal = document.querySelector("#layer .modal");
    if (!modal || modal.querySelector("[data-pm-walletrow]")) return;
    const anchor = modal.querySelector('[data-nav="notifications"]');
    if (!anchor || !anchor.parentNode) return;
    const btn = document.createElement("button");
    btn.className = "rail-lite";
    btn.setAttribute("data-pm-walletrow", "1");
    btn.style.cssText = "text-align:left;padding:11px 12px;border-radius:var(--r-m);font-weight:600";
    btn.textContent = "Payments & wallet";
    btn.onclick = goWallet;
    anchor.parentNode.insertBefore(btn, anchor);
  }

  function injectDetailCheckout() {
    if (!S.route || S.route.name !== "detail") return;
    const bookBtn = document.querySelector(".bookcard [data-book]");
    if (!bookBtn || !bookBtn.parentNode) return;
    if (document.querySelector("[data-pm-checkout]")) return;
    const pid = bookBtn.dataset.book;
    /* NEVER on a LIVE listing. [CRITICAL-PATH: money] This module's checkout is a
       local simulation — confirmCheckout() writes a status:'confirmed',
       paymentStatus:'paid' booking to S.bookings with ZERO backend/Stripe calls.
       On a real bookable coach that is the fabricated-paid lie the host book-modal
       comment (host ~13242) already condemns: the family sees "paid", nothing is
       charged, the coach never hears. Live listings must go ONLY through the real
       data-book flow (SporveBooking.create -> .checkout -> stripe-create-checkout).
       The sim stays for demo/seed listings, where "see how checkout works" is the
       point and no real charge is possible. */
    const prog = (typeof PROGRAMS !== "undefined" ? PROGRAMS : []).find(x => x.id === pid);
    if (prog && prog.live) return;
    const btn = document.createElement("button");
    btn.className = "btn ghost wide";
    btn.setAttribute("data-pm-checkout", pid);
    btn.style.marginTop = "9px";
    btn.textContent = "Check out with a card";
    btn.onclick = () => {
      const sel = document.querySelector(".bookcard [data-slot].on") || document.querySelector(".bookcard [data-slot]");
      openModal({ type: "checkout", programId: pid, slotId: sel ? sel.dataset.slot : null, athleteId: null, tier: "Standard" });
    };
    bookBtn.parentNode.insertBefore(btn, bookBtn.nextSibling);
  }

  function injectBookingActions() {
    if (!S.route || S.route.name !== "bookings" || S.portal === "coach" || !isVerified()) return;
    const head = document.querySelector("#app main .sec-head");
    if (head && !head.querySelector("[data-pm-walletbtn]")) {
      const w = document.createElement("button");
      w.className = "btn ghost sm";
      w.setAttribute("data-pm-walletbtn", "1");
      w.textContent = "Open wallet";
      w.onclick = goWallet;
      head.appendChild(w);
    }

    const panels = document.querySelectorAll("#app main .panel");
    const list = S.bookings || [];
    if (panels.length !== list.length) return;      // shapes disagree: leave the DOM alone
    panels.forEach((panel, i) => {
      const b = list[i];
      const anchor = panel.querySelector("[data-open]");
      if (!b || !anchor || !anchor.parentNode || panel.querySelector("[data-pm-acts]")) return;
      const box = document.createElement("div");
      box.setAttribute("data-pm-acts", "1");
      box.className = "pm-acts";

      const live = ["pending", "confirmed"].includes(b.status);
      const ch = charged(b);
      if (live) {
        const c = document.createElement("button");
        c.className = "btn ghost sm";
        c.textContent = "Cancel";
        c.onclick = () => openModal({ type: "cancelbooking", bookingId: b.id });
        box.appendChild(c);
      }
      if (live && b.paidWith !== "credit" && ch.total > 0) {
        const s = document.createElement("button");
        s.className = "btn ghost sm";
        const open = openSplitFor(b.id);
        s.textContent = open ? "Split · pending" : "Split";
        s.onclick = () => openModal({ type: "splitpay", bookingId: b.id });
        box.appendChild(s);
      }
      if (box.childNodes.length) anchor.parentNode.appendChild(box);
    });
  }

  function wire() {
    const all = sel => document.querySelectorAll(sel);
    wireClose();
    injectAccountRow();
    injectDetailCheckout();
    injectBookingActions();

    all("[data-pm-nav]").forEach(b => b.onclick = () => {
      if (b.dataset.pmNav === "wallet") goWallet();
    });
    all("[data-pm-open]").forEach(b => b.onclick = () => {
      openModal({
        type: b.dataset.pmOpen,
        bookingId: b.dataset.pmBooking || null,
        programId: b.dataset.pmProgram || null,
      });
    });
    all("[data-pm-checkout]").forEach(b => { if (!b.onclick) b.onclick = () => openModal({ type: "checkout", programId: b.dataset.pmCheckout }); });

    /* ── checkout stepping ── */
    all("[data-pm-step]").forEach(b => b.onclick = () => {
      const next = parseInt(b.dataset.pmStep, 10);
      if (next === 3) {
        if (!draft.useCredit && !cardById(draft.cardId))
          return showErr("pmPayErr", "Select a card, or add one, before you review the charge.");
      }
      draft.step = next;
      render();
    });

    const rf = document.getElementById("pmReviewForm");
    if (rf) rf.onsubmit = e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(rf));
      const p = PROGRAMS.find(x => x.id === (S.modal || {}).programId);
      if (!p) return showErr("pmReviewErr", "That program is no longer available.");
      const slots = slotsFor(p.id) || [];
      if (!slots.some(s => s.id === d.slotId)) return showErr("pmReviewErr", "Choose a session to book.");
      if (!(S.athletes || []).some(a => a.id === d.athleteId)) return showErr("pmReviewErr", "Choose the athlete this session is for.");
      draft.athleteId = d.athleteId;
      draft.slotId = d.slotId;
      draft.tier = d.tier;
      draft.step = 2;
      render();
    };

    all('input[name="pmMethod"]').forEach(i => i.onchange = () => {
      const v = String(i.value || "");
      if (v === "credit") { draft.useCredit = true; }
      else { draft.useCredit = false; draft.cardId = v.slice(5); }
      render();
    });

    all("[data-pm-addcard]").forEach(b => b.onclick = () => {
      const m = S.modal;
      const back = (m && m.type === "checkout") ? m : null;
      requireAuth(() => { S.modal = { type: "addcard", returnTo: back }; render(); });
    });
    all("[data-pm-cardback]").forEach(b => b.onclick = () => {
      const back = (S.modal || {}).returnTo;
      S.modal = back || null;
      render();
    });

    all("[data-pm-confirm]").forEach(b => b.onclick = () => confirmCheckout());
    all("[data-pm-docancel]").forEach(b => b.onclick = () => doCancel(b.dataset.pmDocancel));

    /* ── wallet: cards ── */
    all("[data-pm-default]").forEach(b => b.onclick = () => {
      const id = b.dataset.pmDefault;
      cards().forEach(c => c.isDefault = c.id === id);
      render();
      toast("Default payment method updated");
    });
    all("[data-pm-remove]").forEach(b => b.onclick = () => {
      const id = b.dataset.pmRemove;
      const gone = cardById(id);
      S.cards = cards().filter(c => c.id !== id);
      if (gone && gone.isDefault && S.cards.length) S.cards[0].isDefault = true;
      if (draft.cardId === id) draft.cardId = (defaultCard() || {}).id || null;
      render();
      toast(gone ? `${cardLabel(gone)} removed` : "Card removed");
    });

    /* ── add-card form: live brand read + full validation ── */
    const numEl = document.getElementById("pmNum");
    const brandEl = document.getElementById("pmBrand");
    if (numEl && brandEl) {
      const paint = () => {
        const digits = String(numEl.value || "").replace(/\D/g, "").slice(0, 19);
        const key = brandOf(digits);
        numEl.value = groupCard(digits, key);
        if (!digits.length) {
          brandEl.textContent = "Network is read from the card's first digits";
          brandEl.classList.remove("on");
        } else if (key) {
          const spec = BRANDS[key];
          brandEl.textContent = `${spec.label} · ${digits.length}/${spec.digits} digits · ${spec.cvc}-digit code`;
          brandEl.classList.add("on");
        } else {
          brandEl.textContent = digits.length < 6
            ? "Keep typing — the network needs the first digits"
            : "Not a network Sporv takes";
          brandEl.classList.remove("on");
        }
      };
      numEl.oninput = paint;
      paint();
    }
    const expEl = document.getElementById("pmExp");
    if (expEl) expEl.oninput = () => {
      const d = String(expEl.value || "").replace(/\D/g, "").slice(0, 4);
      expEl.value = d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d;
    };

    const cf = document.getElementById("pmCardForm");
    if (cf) cf.onsubmit = e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(cf));
      const res = validateCard(d);
      if (typeof res === "string") return showErr("pmCardErr", res);
      const makeDefault = !!d.makeDefault || !cards().length;
      if (makeDefault) cards().forEach(c => c.isDefault = false);
      const card = {
        id: "card_" + Date.now(),
        brand: res.brand, last4: res.last4,
        expMonth: res.expMonth, expYear: res.expYear,
        postal: res.postal, addedAt: TODAY,
        isDefault: makeDefault,
      };
      S.cards = [...cards(), card];
      const back = (S.modal || {}).returnTo;
      if (back) { draft.useCredit = false; draft.cardId = card.id; S.modal = back; draft.step = 2; }
      else S.modal = null;
      render();
      toast(`${cardLabel(card)} added`);
    };

    /* ── split pay ── */
    const sf = document.getElementById("pmSplitForm");
    if (sf) sf.onsubmit = e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(sf));
      const b = bookingById((S.modal || {}).bookingId);
      if (!b) return showErr("pmSplitErr", "That booking is no longer on your account.");
      const email = String(d.email || "").trim();
      if (!/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(email)) return showErr("pmSplitErr", "Enter a valid email for the second guardian.");
      if (S.auth && S.auth.user && email.toLowerCase() === String(S.auth.user.email || "").toLowerCase())
        return showErr("pmSplitErr", "That's your own email — a split needs a second guardian.");
      if (openSplitFor(b.id)) return showErr("pmSplitErr", "A split request is already open for this booking.");

      const ch = charged(b);
      const half = Math.floor(ch.total / 2);
      const mine = ch.total - half;
      const token = "sp_" + Math.random().toString(36).slice(2, 10);
      const req = {
        id: "split_" + Date.now(),
        bookingId: b.id, email, token,
        shareUrl: `https://sporve.app/split/${token}`,
        totalCents: ch.total, requesterCents: mine, guardianCents: half,
        status: "pending", createdAt: TODAY, expiresAt: addDays(SPLIT_VALID_DAYS),
      };
      S.splitRequests = [req, ...splits()];
      render();
      toast(`Split request sent to ${email}`);
    };

    /* Settle a split. Nothing else in this module could ever move a request
       off "pending", which left the share link promising a settlement that
       could not happen. The guardian's half is collected and credited back
       against the requester's original charge — one ledger row, no invention. */
    all("[data-pm-splitaccept]").forEach(el => el.onclick = () => {
      const req = splits().find(r => r.id === el.dataset.pmSplitaccept);
      if (!req || splitStatus(req) !== "pending") return;
      const bk = (S.bookings || []).find(x => x.id === req.bookingId);
      req.status = "accepted";
      req.acceptedAt = TODAY;
      txns().unshift({
        id: "tx_split_" + req.id,
        at: TODAY,
        kind: "split",
        bookingId: req.bookingId,
        programId: bk ? bk.programId : null,
        desc: `Split accepted · ${req.email}`,
        grossCents: req.guardianCents,
        feeCents: 0,
        totalCents: req.guardianCents,
      });
      render();
      toast(`${usd(req.guardianCents)} collected — credited to your card`);
    });

    all("[data-pm-copy]").forEach(b => b.onclick = () => {
      const text = b.dataset.pmCopy;
      const nav = typeof navigator !== "undefined" ? navigator : null;
      if (nav && nav.clipboard && nav.clipboard.writeText) {
        nav.clipboard.writeText(text).then(() => toast("Share link copied"), () => toast("Copy the link from the field above"));
      } else toast("Copy the link from the field above");
    });

    /* ── credit packs ── */
    const sel = document.getElementById("pmPackProgram");
    if (sel) sel.onchange = () => { packPid = sel.value; render(); };

    const pf = document.getElementById("pmPackForm");
    if (pf) pf.onsubmit = e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(pf));
      const p = PROGRAMS.find(x => x.id === d.programId);
      if (!p) return showErr("pmPackErr", "Choose the listing these credits are for.");
      const card = defaultCard();
      if (!card) return showErr("pmPackErr", "Add a card before buying a pack.");

      const pack = packs()[0] || { sessions: PACK_SESSIONS, discountPct: PACK_DISCOUNT_PCT };
      const unit = Math.round(Number(p.price) * 100);
      const gross = unit * pack.sessions - pctOf(unit * pack.sessions, pack.discountPct);
      const fee = feeOn(gross);
      txns().unshift({
        id: "txn_" + Date.now(), at: TODAY, kind: "pack",
        programId: p.id, desc: `${pack.sessions}-session pack · ${p.title}`,
        grossCents: gross, feeCents: fee, netCents: gross - fee, chargedCents: gross,
        credits: pack.sessions, perSessionCents: Math.round(gross / pack.sessions),
        method: "card", cardId: card.id, brand: card.brand, last4: card.last4,
        status: "paid",
      });
      render();
      toast(`${pack.sessions} session credits added · ${usd(gross)} charged`);
    };
  }

  /* ═══════════════════ CSS ═══════════════════ */
  const css = `
.pm-wrap{padding-bottom:80px}
.pm-wrap .sec-head{align-items:flex-start;margin:30px 0 18px}
.pm-lede{color:var(--muted);margin-top:9px;max-width:64ch;font-size:var(--text-md)}
.pm-fine{color:var(--faint);font-size:var(--text-sm);margin-top:12px;line-height:1.55;max-width:70ch}
.pm-meta{color:var(--muted);font-size:var(--text-sm);display:block}
.pm-gap{margin-top:12px}
.pm-none{color:var(--muted);font-size:var(--text-base);padding:6px 0 2px;max-width:70ch}

.pm-panel{margin-bottom:18px}
.pm-panel h2{font-size:var(--text-lg)}
.pm-sec{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:14px}
.pm-wrap .stats{margin-bottom:20px}

.pm-note{border:1px solid var(--rule);border-radius:var(--r-m);padding:15px 17px;background:var(--raise)}
.pm-note h3{font-size:var(--text-base)}
.pm-note p{color:var(--ink-2);font-size:var(--text-base);margin-top:6px;line-height:1.55;max-width:66ch}
.pm-note-warn{background:var(--warn-tint);border-color:transparent}
.pm-note-warn h3{color:var(--warn)}

.pill.pm-closed{background:var(--raise2);color:var(--ink-2)}

/* ── cards + credits ── */
.pm-cardrow{display:flex;gap:12px;align-items:center;flex-wrap:wrap;
  padding:13px 0;border-bottom:1px solid var(--rule)}
.pm-cardrow:last-child{border-bottom:0;padding-bottom:0}
.pm-card-in{display:flex;flex-direction:column;gap:2px;flex:1;min-width:210px}
.pm-card-in b{font-size:var(--text-base);letter-spacing:-.015em}
.pm-remove{font-size:var(--text-sm);font-weight:700;color:var(--danger);padding:6px 8px;border-radius:var(--r-s)}
.pm-remove:hover{background:var(--raise2)}
.pm-credits{margin-bottom:18px;padding-bottom:6px;border-bottom:1px solid var(--rule)}
.pm-acts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:9px}

/* ── modal internals ── */
.pm-body .pm-note{margin-bottom:4px}
.pm-body .field{margin-bottom:14px}
.pm-body .btn.wide+.btn.wide{margin-top:9px}
.pm-row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
.pm-inline{display:flex;gap:10px;align-items:center;font-size:var(--text-sm);color:var(--ink-2);cursor:pointer;margin:2px 0 4px}
.pm-inline input{width:17px;height:17px;flex:0 0 auto;accent-color:var(--slate)}
.pm-actions{display:flex;gap:9px;margin-top:14px}
.pm-actions .btn{flex:1}
.pm-btn-danger{background:var(--danger);color:var(--paper)}
.pm-btn-danger:hover{background:var(--danger);opacity:.9}

.pm-steps{display:flex;gap:6px;list-style:none;padding:0;margin:0 0 18px;align-items:center}
.pm-step{display:flex;align-items:center;gap:7px;flex:1;min-width:0;font-size:var(--text-sm);
  font-weight:700;color:var(--faint);white-space:nowrap}
.pm-step-n{width:20px;height:20px;border-radius:999px;display:grid;place-items:center;flex:0 0 auto;
  border:1.5px solid var(--rule-strong);font-size:var(--text-xs);font-weight:700}
.pm-step.on{color:var(--ink)}
.pm-step.on .pm-step-n{border-color:var(--slate);background:var(--slate-tint);color:var(--slate)}
.pm-step.done{color:var(--ink-2)}
.pm-step.done .pm-step-n{border-color:var(--good);background:var(--good-tint);color:var(--good)}

.pm-target{display:flex;gap:11px;align-items:flex-start;border:1px solid var(--rule);
  border-radius:var(--r-m);padding:12px 14px;margin-bottom:16px;background:var(--raise)}
.pm-target b{font-size:var(--text-base);letter-spacing:-.015em;display:block}
.pm-dot{width:9px;height:9px;border-radius:3px;flex:0 0 auto;margin-top:6px;display:block}

.pm-sum{border-top:1px solid var(--rule);padding-top:6px}
.pm-sum-row{display:flex;justify-content:space-between;gap:14px;padding:8px 0;
  font-size:var(--text-base);color:var(--ink-2);align-items:center}
.pm-sum-row.total{border-top:1px solid var(--rule);margin-top:6px;padding-top:13px;
  font-weight:700;color:var(--ink);font-size:var(--text-base)}

.pm-math{border:1px solid var(--rule);border-radius:var(--r-m);padding:13px 15px;background:var(--raise)}
.pm-math .eyebrow{margin-bottom:8px}
.pm-math-row{display:flex;justify-content:space-between;gap:14px;padding:5px 0;
  font-size:var(--text-sm);color:var(--muted);line-height:1.45}
.pm-math-row.on{color:var(--ink);font-weight:700}
.pm-math-row.pm-math-sep{border-top:1px solid var(--rule);margin-top:5px;padding-top:9px;color:var(--ink-2)}

.pm-brandchip{font-size:var(--text-sm);color:var(--faint);font-variant-numeric:tabular-nums}
.pm-brandchip.on{color:var(--slate);font-weight:700}

.pm-choice{display:block;cursor:pointer;margin-bottom:9px}
.pm-choice input{position:absolute;opacity:0;width:1px;height:1px}
.pm-choice-in{display:flex;flex-direction:column;gap:3px;padding:13px 15px;
  border:1.5px solid var(--rule);border-radius:var(--r-m);transition:.15s}
.pm-choice-in b{font-size:var(--text-base);letter-spacing:-.015em}
.pm-choice-in span{font-size:var(--text-sm);color:var(--muted)}
.pm-choice:hover .pm-choice-in{border-color:var(--ink-2);background:var(--raise)}
.pm-choice.on .pm-choice-in{border-color:var(--slate);background:var(--slate-tint);box-shadow:0 0 0 1px var(--slate)}
.pm-choice input:focus-visible+.pm-choice-in{outline:2px solid var(--slate);outline-offset:2px}

.pm-done{text-align:center;padding:6px 0 18px}
.pm-done h3{font-size:var(--text-lg);margin-top:12px}
.pm-done p{color:var(--muted);margin-top:5px;font-size:var(--text-base)}
.pm-done-mark{width:52px;height:52px;border-radius:999px;background:var(--good-tint);color:var(--good);
  display:grid;place-items:center;margin:0 auto}

.pm-link{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin-top:14px;padding:12px 14px;
  border:1px dashed var(--rule-strong);border-radius:var(--r-m);background:var(--raise)}
.pm-link .eyebrow{flex-basis:100%}
.pm-link code{font-size:var(--text-sm);color:var(--ink-2);word-break:break-all;flex:1;min-width:180px}

@media(max-width:620px){
  .pm-row3{grid-template-columns:1fr 1fr}
  .pm-actions{flex-direction:column}
  .pm-steps{gap:4px}
  .pm-step span:last-child{display:none}
}`;

  /* ═══════════════════ EXPORT ═══════════════════ */
  window.MOD_PAYMENTS = {
    css,
    views: { wallet: walletView },
    modals: {
      checkout: checkoutModal,
      cancelbooking: cancelBookingModal,
      addcard: addCardModal,
      splitpay: splitPayModal,
    },
    wire,
    state: {
      /* no seeded card, charge, or credit: nothing here moved money yet */
      cards: [],
      transactions: [],
      creditPacks: [{ id: "pack_5", sessions: PACK_SESSIONS, discountPct: PACK_DISCOUNT_PCT }],
      splitRequests: [],
    },
  };
})();
