"use strict";
/* ═══════════════════════════════════════════════════════════════════
   MOD_SAFETY — Trust & Safety for Sporv Web.

   Three real backend flows, mirrored exactly on the client:
     · safety reports   (7 categories, 10–4000 char details, 10/day quota)
     · refund requests  (paid | partially_refunded only, one open per booking)
     · privacy requests (access | export | correction | deletion — case-reviewed)

   Host contract used, never redefined: S, render, toast, esc, money,
   fmtDate, isVerified, requireAuth, PROGRAMS, ICON.
   ═══════════════════════════════════════════════════════════════════ */
(function () {

  /* ── vocabularies (values are the backend's; labels are for humans) ── */
  const CATEGORIES = [
    ["unsafe_behavior",       "Unsafe behavior or supervision"],
    ["harassment",            "Harassment or bullying"],
    ["discrimination",        "Discrimination"],
    ["identity_concern",      "Identity or credential concern"],
    ["inappropriate_content", "Inappropriate content or contact"],
    ["payment_dispute",       "Payment dispute"],
    ["other",                 "Something else"],
  ];
  const CATEGORY_LABEL = Object.fromEntries(CATEGORIES);

  const PRIVACY_TYPES = [
    ["access",     "Access my data",   "See what Sporv holds about you and your athletes."],
    ["export",     "Export my data",   "Get a machine-readable copy you can take elsewhere."],
    ["correction", "Correct my data",  "Fix something that is wrong or out of date."],
    ["deletion",   "Delete my data",   "Opens a reviewed case — not an instant delete."],
  ];
  const PRIVACY_LABEL = Object.fromEntries(PRIVACY_TYPES.map(t => [t[0], t[1]]));

  /* a refund request is "open" in exactly these states */
  const REFUND_OPEN = ["submitted", "reviewing", "approved", "processing"];
  const REFUND_ELIGIBLE_PAYMENT = ["paid", "partially_refunded"];

  const REPORT_DAILY_QUOTA = 10;
  const DETAILS_MIN = 10, DETAILS_MAX = 4000;
  const REASON_MIN = 10, REASON_MAX = 2000;
  const PRIVACY_MAX = 2000;

  const STATUS_LABEL = {
    submitted: "Submitted", untriaged: "Untriaged", reviewing: "In review",
    identity_check: "Identity check", processing: "Processing",
    approved: "Approved", completed: "Completed", fulfilled: "Fulfilled",
    denied: "Denied", failed: "Failed",
  };
  /* warn = still pending on us · good = resolved in your favour ·
     closed = terminal, no longer moving (never --danger: not destructive) */
  const STATUS_TONE = {
    submitted: "warn", untriaged: "warn", reviewing: "warn",
    identity_check: "warn", processing: "warn",
    approved: "good", completed: "good", fulfilled: "good",
    denied: "closed", failed: "closed",
  };
  const PAYMENT_REASON = {
    unpaid: "no payment has been captured for it yet",
    pending: "its payment has not settled yet",
    processing: "its payment is still processing",
    refunded: "it has already been refunded in full",
    failed: "its payment never completed",
    canceled: "it was canceled before any charge was captured",
  };

  /* ── small helpers ────────────────────────────────────────────────── */
  const today = () => new Date().toISOString().slice(0, 10);
  const nowISO = () => new Date().toISOString();
  /* `S.safety || {...}` was not enough. doSignOut() now resets every
     account-scoped field to its EMPTY shape, so S.safety comes back as {} — a
     truthy object with no arrays on it — and the next render threw
     "Cannot read properties of undefined (reading 'map')" on s.refunds. The whole
     trust route went blank for anyone who had signed out in that tab.

     A regression from my own sign-out fix, caught by smoke rather than by a
     user. Fill each key individually so ANY partial bag is repaired, not just a
     missing one. */
  const bag = () => {
    const b = (S.safety && typeof S.safety === "object") ? S.safety : {};
    if (!Array.isArray(b.reports)) b.reports = [];
    if (!Array.isArray(b.refunds)) b.refunds = [];
    if (!Array.isArray(b.privacy)) b.privacy = [];
    if (typeof b.reportsToday !== "number") b.reportsToday = 0;
    if (!b.quotaDate) b.quotaDate = today();
    S.safety = b;
    return b;
  };

  function reportsLeft() {
    const s = bag();
    if (s.quotaDate !== today()) { s.quotaDate = today(); s.reportsToday = 0; }
    return Math.max(0, REPORT_DAILY_QUOTA - (s.reportsToday || 0));
  }
  const ref = (prefix, n) => `${prefix}-${String(n).padStart(4, "0")}`;

  function statusPill(v) {
    const tone = STATUS_TONE[v] || "slate";
    const cls = tone === "closed" ? "pill sf-closed" : "pill " + tone;
    return `<span class="${cls}">${esc(STATUS_LABEL[v] || v)}</span>`;
  }
  function priorityPill(v) {
    return `<span class="pill sf-closed">${esc(STATUS_LABEL[v] || v)}</span>`;
  }
  const openRefundFor = id => bag().refunds.find(r => r.bookingId === id && REFUND_OPEN.includes(r.status));
  const paymentEligible = b => !!b && REFUND_ELIGIBLE_PAYMENT.includes(b.paymentStatus);
  const booking = id => (S.bookings || []).find(b => b.id === id);
  const providers = () => {
    const seen = new Map();
    PROGRAMS.forEach(p => { if (!seen.has(p.biz)) seen.set(p.biz, p.id); });
    return [...seen.entries()];
  };

  function targetLabel(m) {
    if (m.providerId) {
      const p = PROGRAMS.find(x => x.id === m.providerId);
      return p ? `${p.biz} — ${p.title}` : String(m.providerId);
    }
    if (m.bookingId) {
      const b = booking(m.bookingId);
      return b ? `${b.program} · ${b.athlete}` : String(m.bookingId);
    }
    if (m.conversationId) {
      const c = (S.conversations || []).find(x => x.id === m.conversationId);
      return c ? `Conversation with ${c.with}` : String(m.conversationId);
    }
    return "";
  }
  function reportTargetLabel(r) {
    return targetLabel({ providerId: r.providerId, bookingId: r.bookingId, conversationId: r.conversationId }) || "—";
  }

  /* modal chrome — the host's exact pattern; body content is ours */
  function wrap(title, body) {
    return `<div class="scrim" data-scrim="1"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><b>${esc(title)}</b><button class="x" data-close="1" aria-label="Close">${ICON.x}</button></div><div class="modal-body"><div class="sf-body">${body}</div></div></div></div>`;
  }
  function counter(id, n, min, max) {
    return `<div class="sf-count num" id="${id}">${n} / ${max} characters · ${min} minimum</div>`;
  }

  /* ═══════════════════ MODAL · SAFETY REPORT ═══════════════════ */
  function reportModal() {
    const m = S.modal || {};
    const left = reportsLeft();
    const known = !!(m.providerId || m.bookingId || m.conversationId);

    if (left <= 0) {
      return wrap("Report a safety concern", `
        <div class="sf-note sf-note-warn">
          <h3>Safety report limit reached</h3>
          <p>You have filed ${REPORT_DAILY_QUOTA} reports today, which is the daily limit on this account.
             The limit resets tomorrow and none of your open reports are affected.</p>
        </div>
        <p class="sf-fine">If something is happening right now that puts a child at risk, contact your
           local emergency services first, then follow up here.</p>
        <button class="btn ghost wide" data-close="1">Close</button>`);
    }

    return wrap("Report a safety concern", `
      <div class="sf-note sf-note-warn">
        <b>If anyone is in immediate danger, call local emergency services first.</b>
        <p>Sporv reviews every report, but we are not an emergency service.</p>
      </div>

      <form id="sfReportForm" novalidate>
        ${known ? `
          <div class="sf-target">
            <span class="eyebrow">Report about</span>
            <b>${esc(targetLabel(m))}</b>
          </div>`
        : `
          <div class="field">
            <label for="sfReportTarget">Who or what is this about</label>
            <select id="sfReportTarget" name="target" required>
              <option value="">Select a provider, booking, or conversation</option>
              <optgroup label="Providers">
                ${providers().map(([biz, id]) => `<option value="provider:${esc(id)}">${esc(biz)}</option>`).join("")}
              </optgroup>
              ${(S.bookings || []).length ? `<optgroup label="Bookings">
                ${(S.bookings || []).map(b => `<option value="booking:${esc(b.id)}">${esc(b.program)} · ${esc(fmtDate(b.date))}</option>`).join("")}
              </optgroup>` : ""}
              ${(S.conversations || []).length ? `<optgroup label="Conversations">
                ${(S.conversations || []).map(c => `<option value="conversation:${esc(c.id)}">${esc(c.with)}</option>`).join("")}
              </optgroup>` : ""}
            </select>
          </div>`}

        <div class="field">
          <label for="sfReportCategory">What happened</label>
          <select id="sfReportCategory" name="category">
            ${CATEGORIES.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}
          </select>
        </div>

        <div class="field">
          <label for="sfReportDetails">Details</label>
          <textarea id="sfReportDetails" name="details" rows="6"
            placeholder="When it happened, who was involved, and what you saw or heard."></textarea>
          ${counter("sfReportCount", 0, DETAILS_MIN, DETAILS_MAX)}
        </div>

        <div id="sfReportErr" class="err hide"></div>

        <button class="btn wide" type="submit">Submit report</button>
        <p class="sf-fine num">${left} of ${REPORT_DAILY_QUOTA} reports left today ·
          Reports arrive untriaged and are read by a person.</p>
      </form>`);
  }

  /* ═══════════════════ MODAL · REFUND REQUEST ═══════════════════ */
  function refundModal() {
    const m = S.modal || {};
    const b = m.bookingId ? booking(m.bookingId) : null;

    if (m.bookingId && !b) {
      return wrap("Request a refund", `
        <div class="sf-note"><h3>We can't find that booking</h3>
          <p>It may have been removed from your account. Open Bookings and try again from there.</p></div>
        <button class="btn ghost wide" data-close="1">Close</button>`);
    }

    if (b && !paymentEligible(b)) {
      const why = PAYMENT_REASON[b.paymentStatus] || `its payment status is “${b.paymentStatus}”`;
      return wrap("Request a refund", `
        <div class="sf-note sf-note-warn">
          <h3>This booking isn't refundable through this form</h3>
          <p><b>${esc(b.program)}</b> can't be refunded because ${esc(why)}.
             A refund can only be requested for a booking that is <b>paid</b> or <b>partially refunded</b>.</p>
        </div>
        <p class="sf-fine">If money did leave your account for this booking, file a safety report under
           <b>Payment dispute</b> and our team will trace the charge.</p>
        <button class="btn wide" data-sf-open="report" ${b.id ? `data-sf-booking="${esc(b.id)}"` : ""}>Report a payment dispute</button>
        <button class="btn ghost wide sf-gap" data-close="1">Close</button>`);
    }

    if (b) {
      const open = openRefundFor(b.id);
      if (open) {
        return wrap("Request a refund", `
          <div class="sf-note">
            <h3>A refund request is already open</h3>
            <p>Request <b class="num">${esc(open.ref)}</b> for <b>${esc(b.program)}</b> is
               ${esc((STATUS_LABEL[open.status] || open.status).toLowerCase())}.
               Only one request can be open per booking, so this one has to close before you can file another.</p>
            <div class="sf-gap">${statusPill(open.status)}</div>
          </div>
          <button class="btn ghost wide" data-nav="trust">See request status</button>`);
      }
    }

    /* no booking passed in — let them pick, showing why ineligible ones are blocked */
    const list = S.bookings || [];
    const pickable = list.filter(x => paymentEligible(x) && !openRefundFor(x.id));
    if (!b && !pickable.length) {
      return wrap("Request a refund", `
        <div class="sf-note">
          <h3>Nothing to refund right now</h3>
          <p>Refunds apply to bookings that are <b>paid</b> or <b>partially refunded</b> and don't already
             have an open request. None of your bookings match that today.</p>
        </div>
        <button class="btn ghost wide" data-nav="bookings">View bookings</button>`);
    }

    const amount = b ? money(b.price) : null;
    return wrap("Request a refund", `
      <form id="sfRefundForm" novalidate>
        ${b ? `
          <div class="sf-target">
            <span class="eyebrow">Booking</span>
            <b>${esc(b.program)}</b>
            <span class="sf-meta num">${esc(b.athlete)} · ${esc(fmtDate(b.date))} · ${esc(b.startTime || "")}</span>
          </div>
          <div class="linerow"><span>Paid</span><span class="num">${amount}</span></div>
          <div class="linerow"><span>Payment status</span><span class="pill slate">${esc(b.paymentStatus)}</span></div>`
        : `
          <div class="field">
            <label for="sfRefundBooking">Booking</label>
            <select id="sfRefundBooking" name="bookingId" required>
              <option value="">Select a booking</option>
              ${list.map(x => {
                const openReq = openRefundFor(x.id);
                const bad = !paymentEligible(x) ? "not eligible" : openReq ? "request already open" : "";
                return `<option value="${esc(x.id)}" ${bad ? "disabled" : ""}>${esc(x.program)} · ${esc(fmtDate(x.date))} · ${money(x.price)}${bad ? ` — ${bad}` : ""}</option>`;
              }).join("")}
            </select>
          </div>`}

        <div class="field">
          <label for="sfRefundReason">Why you're asking for a refund</label>
          <textarea id="sfRefundReason" name="reason" rows="5"
            placeholder="What went wrong, and what you'd like to happen."></textarea>
          ${counter("sfRefundCount", 0, REASON_MIN, REASON_MAX)}
        </div>

        <div id="sfRefundErr" class="err hide"></div>

        <button class="btn wide" type="submit">Submit request</button>
        <p class="sf-fine">Your booking's cancellation policy decides this, not a review queue:
          Sporv checks the policy saved when you booked and how long is left before the session,
          then refunds what it allows straight to your card. If nothing is due, we tell you why.</p>
      </form>`);
  }

  /* ═══════════════════ MODAL · PRIVACY REQUEST ═══════════════════ */
  function privacyModal() {
    return wrap("Make a privacy request", `
      <form id="sfPrivacyForm" novalidate>
        <p class="sf-lede">Choose what you want to happen to the data Sporv holds about you and
          the athletes on your account.</p>

        <div class="sf-choices" role="radiogroup" aria-label="Request type">
          ${PRIVACY_TYPES.map(([v, l, d], i) => `
            <label class="sf-choice">
              <input type="radio" name="type" value="${v}" ${i === 0 ? "checked" : ""}>
              <span class="sf-choice-in"><b>${esc(l)}</b><span>${esc(d)}</span></span>
            </label>`).join("")}
        </div>

        <div id="sfPrivacyDeletion" class="sf-note sf-note-warn hide">
          <h3>Deletion is reviewed as a case, not an instant delete</h3>
          <p>We verify who you are, then work through the request record by record. Financial records
             (payments, refunds, payouts) and safety records (reports and their investigations) are kept
             under legal hold and survive a deletion — we are required to retain them. Everything outside
             that hold is removed, and we write back to tell you exactly what stayed and why.</p>
        </div>

        <div class="field sf-gap">
          <label for="sfPrivacyDetails">Details <span class="sf-optional">(required for a correction)</span></label>
          <textarea id="sfPrivacyDetails" name="details" rows="4"
            placeholder="Which records, and what should change."></textarea>
          <div class="sf-count num" id="sfPrivacyCount">0 / ${PRIVACY_MAX} characters</div>
        </div>

        <div id="sfPrivacyErr" class="err hide"></div>

        <button class="btn wide" type="submit">Submit request</button>
        <p class="sf-fine">Every request starts as <b>submitted</b> and passes an <b>identity check</b>
          before it is fulfilled — that step exists so nobody else can pull your family's records.</p>
      </form>`);
  }

  /* ═══════════════════ VIEW · TRUST &amp; SAFETY ═══════════════════
     Page-level content, in the order a reader needs it. The per-person check
     policy is the proof behind the product's central claim, so it leads the
     page instead of sitting in the third panel down. */
  /* Anti-slop constitution C1: the icon column is GONE. These four rendered as
     shield/check/doc/clock cards in a 3-up grid — tells #1 (outline icons over
     text), #3 (icon+bold+gray as the only pattern), #16 (icon-card grid), and
     #23: four items in a three-column grid stranded "Checks are re-run" alone
     on its own row, which is the exact screenshot the constitution opens with.
     Now a B6 definition list sharing .sf-rule with the rules section below —
     a document's own rows, hairline-separated, the term doing the work the
     icon pretended to do.

     One copy correction while here: "stay bookable" was FALSE — since the
     evidence gate landed, an uncleared provider cannot take a booking at all.
     The page said the opposite of what the database enforces. */
  const POLICY = [
    ["Each person clears their own", "A background check is required before a coach can be booked."],
    ["Sporv sets the badge",        "An organization cannot verify its own staff."],
    ["Pending is shown",             "Uncleared listings read Verification pending — visible, but not bookable until the check clears."],
    ["Checks are re-run",            "A badge that stops being true stops showing."],
  ];
  const RULES = [
    ["Reports go to safety@sporve.com", "During beta a report opens an email to Sporv's safety address. Send it, and keep your copy — that email IS the record."],
    ["Refunds are reviewed",   "Full refund, partial refund, or a written denial."],
    ["Deletion is a case",     "Payment and safety records stay under legal hold. We write back."],
  ];
  /* PICON is the host's stroke-icon set (never emoji); guarded so a module
     loaded against an older host degrades to no icon rather than throwing. */

  function trustView() {
    const s = bag();
    const sub = typeof subnavHTML === "function" ? subnavHTML() : "";
    const left = reportsLeft();
    const paid = (S.bookings || []).filter(paymentEligible);

    const reportRows = s.reports.map(r => `<tr>
      <td class="num">${esc(r.ref)}</td>
      <td class="num">${esc(fmtDate(r.createdAt))}</td>
      <td>${esc(CATEGORY_LABEL[r.category] || r.category)}</td>
      <td>${esc(reportTargetLabel(r))}</td>
      <td>${priorityPill(r.priority)}</td>
      <td>${statusPill(r.status)}</td></tr>`).join("");

    const refundRows = s.refunds.map(r => {
      const b = booking(r.bookingId);
      return `<tr>
        <td class="num">${esc(r.ref)}</td>
        <td class="num">${esc(fmtDate(r.createdAt))}</td>
        <td>${esc(b ? b.program : r.bookingId)}</td>
        <td class="num">${b ? money(b.price) : "—"}</td>
        <td>${statusPill(r.status)}</td></tr>`;
    }).join("");

    const privacyRows = s.privacy.map(r => `<tr>
      <td class="num">${esc(r.ref)}</td>
      <td class="num">${esc(fmtDate(r.createdAt))}</td>
      <td>${esc(PRIVACY_LABEL[r.type] || r.type)}</td>
      <td>${statusPill(r.status)}</td></tr>`).join("");

    const table = (head, rows, empty, label) => rows
      ? `<div class="tblwrap"><table class="tbl" aria-label="${esc(label)}">
           <thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead>
           <tbody>${rows}</tbody></table></div>`
      : `<p class="sf-none">${esc(empty)}</p>`;

    /* Five full-width bands: slate → white → black → slate → white.
       The page is the same content, in the same order of importance, re-ground
       so the eye can tell the claim from the record while scrolling. Two rules
       specific to this page:

       · The serious register paints #app with --raise, so a bare `.band` is
         TRANSPARENT and would resolve slate, not white — `.band.alt` and
         `.band` would be one ground and the rhythm would not exist. `.sf-w`
         re-asserts --paper on the white bands. Token, not a new colour, and
         the same declaration `.band.alt` already makes for its own ground.
       · The black band carries WHITE CARDS, not text on black — the two badge
         states are exactly what a card is for, and the host's
         `.band.dark .prodcard` rules already invert their type correctly. */
    return `${sub}
    <section class="band alt sf-hero">
      <div class="shell" data-rev>
        <p class="eyebrow">Trust &amp; safety</p>
        <h1>Every coach must clear their own check.</h1>
        <p class="lede">A check belongs to a person, not a logo.</p>

        <div class="sf-actions">
          <button class="btn" data-sf-open="report">Report a safety concern</button>
          <button class="btn ghost" data-sf-open="refund">Request a refund</button>
          <button class="btn ghost" data-sf-open="privacy">Make a privacy request</button>
          <span class="sf-meta num sf-push">${left} of ${REPORT_DAILY_QUOTA} safety reports left today</span>
        </div>

        <div class="sf-note sf-note-warn sf-emergency" role="note">
          <h3>If anyone is in danger, call emergency services first</h3>
          <p>Report here afterwards. During beta this opens an email to safety@sporve.com — send it so there is a record we can act on.</p>
        </div>
      </div>
    </section>

    <section class="band sf-w">
      <div class="shell">
        <div class="prodsec" data-rev>
          <h2>The check is per person.</h2>
          <p class="sub">Approving a business says nothing about who coaches your child.</p>
        </div>
        <div class="sf-rules" data-rev>
          ${POLICY.map(([t, d]) => `<div class="sf-rule"><b>${esc(t)}</b><p>${esc(d)}</p></div>`).join("")}
        </div>
      </div>
    </section>

    <section class="band dark">
      <div class="shell">
        <div class="prodsec" data-rev>
          <p class="eyebrow">The badge</p>
          <h2>Withheld, never implied.</h2>
        </div>
        ${/* The two pills are the PRODUCT'S REAL UI — the one place an icon is
             earned, because it encodes state. What goes is the card chrome
             around them: flat hairline rows on the dark panel, badge left,
             clause right, same document grammar as the rest of the page. */""}
        <div class="sf-badges" data-rev>
          <div class="sf-badge"><span class="pill gold">${ICON.shield} Background-checked</span>
            <p>Check passed, and re-run on schedule.</p></div>
          <div class="sf-badge"><span class="pill warn">${ICON.shield} Verification pending</span>
            <p>The badge waits for that person's check.</p></div>
        </div>
      </div>
    </section>

    <section class="band alt">
      <div class="shell" data-rev>
        <div class="prodsec"><h2>Every request is tracked.</h2></div>
        <div class="sf-rules">
          ${RULES.map(([t, d]) => `<div class="sf-rule"><b>${esc(t)}</b><p>${esc(d)}</p></div>`).join("")}
        </div>
      </div>
    </section>

    <section class="band sf-w sf-records">
      <div class="shell" data-rev>
        <div class="prodsec"><h2>Your requests.</h2></div>

        <div class="sf-block">
          <div class="sf-sec"><h3>Safety reports</h3>
            <span class="sf-meta num">${s.reports.length} filed</span></div>
          ${table(["Reference", "Filed", "Category", "About", "Priority", "Status"], reportRows,
                  "No reports filed. Good.", "Your safety reports")}
        </div>

        <div class="sf-block">
          <div class="sf-sec"><h3>Refund requests</h3>
            <span class="sf-meta num">${s.refunds.length} filed</span></div>
          ${table(["Reference", "Filed", "Booking", "Paid", "Status"], refundRows,
                  "No refund requests.", "Your refund requests")}
          ${paid.length ? `<div class="sf-mini">
            <p class="eyebrow">Eligible bookings</p>
            ${paid.map(b => {
              const open = openRefundFor(b.id);
              return `<div class="sf-row">
                <div class="sf-row-in">
                  <b>${esc(b.program)}</b>
                  <span class="sf-meta num">${esc(b.athlete)} · ${esc(fmtDate(b.date))} · ${money(b.price)} · ${esc(b.paymentStatus)}</span>
                </div>
                ${open
                  ? `<span class="sf-meta num">Request ${esc(open.ref)} open</span>${statusPill(open.status)}`
                  : `<button class="btn ghost sm" data-sf-open="refund" data-sf-booking="${esc(b.id)}">Request a refund</button>`}
              </div>`;
            }).join("")}
          </div>` : ""}
        </div>

        <div class="sf-block">
          <div class="sf-sec"><h3>Privacy requests</h3>
            <span class="sf-meta num">${s.privacy.length} filed</span></div>
          ${table(["Reference", "Filed", "Type", "Status"], privacyRows,
                  "No privacy requests.", "Your privacy requests")}
        </div>
      </div>
    </section>`;
  }

  /* ═══════════════════ WIRING ═══════════════════ */
  function bindCounter(taId, outId, min, max) {
    const ta = document.getElementById(taId);
    const out = document.getElementById(outId);
    if (!ta || !out) return;
    const upd = () => {
      const n = ta.value.trim().length;
      out.textContent = min
        ? `${n} / ${max} characters · ${min} minimum`
        : `${n} / ${max} characters`;
      out.classList.toggle("out", n > max || (n > 0 && n < min));
    };
    ta.oninput = upd;
    upd();
  }
  function showErr(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hide");
  }

  function wire() {
    const all = sel => document.querySelectorAll(sel);

    /* open our modals — behind the host's auth gate, intent resumes after sign-in */
    all("[data-sf-open]").forEach(btn => btn.onclick = () => {
      const type = btn.dataset.sfOpen;
      const next = {
        type,
        providerId: btn.dataset.sfProvider || null,
        bookingId: btn.dataset.sfBooking || null,
        conversationId: btn.dataset.sfConversation || null,
      };
      requireAuth(() => { S.modal = next; render(); });
    });

    /* our modal's close affordances (the host's handler misses clicks on the icon) */
    const mine = document.querySelector(".sf-body");
    if (mine) {
      const scrim = mine.closest(".scrim");
      if (scrim) {
        const x = scrim.querySelector(".x[data-close]");
        if (x) x.onclick = () => { S.modal = null; render(); };
        scrim.querySelectorAll("[data-close]").forEach(b => b.onclick = () => { S.modal = null; render(); });
        scrim.onclick = e => { if (e.target === scrim) { S.modal = null; render(); } };
      }
    }

    bindCounter("sfReportDetails", "sfReportCount", DETAILS_MIN, DETAILS_MAX);
    bindCounter("sfRefundReason", "sfRefundCount", REASON_MIN, REASON_MAX);
    bindCounter("sfPrivacyDetails", "sfPrivacyCount", 0, PRIVACY_MAX);

    /* ── report submit ── */
    const rf = document.getElementById("sfReportForm");
    if (rf) rf.onsubmit = e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(rf));
      const m = S.modal || {};
      const s = bag();

      if (reportsLeft() <= 0) return showErr("sfReportErr", "Safety report limit reached");

      let providerId = m.providerId || null,
          bookingId = m.bookingId || null,
          conversationId = m.conversationId || null;
      if (!providerId && !bookingId && !conversationId) {
        const [kind, id] = String(d.target || "").split(":");
        if (!id) return showErr("sfReportErr", "Choose the provider, booking, or conversation this report is about.");
        if (kind === "provider") providerId = id;
        else if (kind === "booking") bookingId = id;
        else conversationId = id;
      }

      const details = String(d.details || "").trim();
      if (details.length < DETAILS_MIN || details.length > DETAILS_MAX)
        return showErr("sfReportErr", "Details must be 10 to 4000 characters.");

      const category = CATEGORY_LABEL[d.category] ? d.category : "other";
      /* [CRITICAL-PATH: child safety] THIS MODULE HAS ZERO NETWORK CALLS.
         `rg 'SporveAPI|API.from|fetch\(' mod-safety.js` returns nothing: every
         submission below lands in memory, persists only to sessionStorage, and
         dies with the tab. Yet it minted a reference number and a "Submitted"
         status, and the surrounding copy told a parent a human reads it.

         A parent reporting that a coach behaved unsafely toward their child
         believed Sporv was investigating. Sporv never knew.

         Until safety_reports exists with a triage path, the honest surface is
         email: the report opens a pre-filled message to safety@sporve.com, and
         the sent mail — held by the parent, not by us — is the record. The local
         entry is kept ONLY as the parent's own copy and is labelled as such; it
         no longer claims a case number Sporv is holding. Deleting the false
         claim is hours of work; building the triage system is weeks, and the
         claim must not survive the wait. */
      (function mailTheReport(){
        try{
          var body =
            "A safety report was started on Sporv.\n\n"+
            "Category: "+(CATEGORY_LABEL[category]||category)+"\n"+
            (providerId?("Provider: "+providerId+"\n"):"")+
            (bookingId?("Booking: "+bookingId+"\n"):"")+
            "\nWhat happened:\n"+details+"\n";
          window.location.href = "mailto:safety@sporve.com"
            + "?subject=" + encodeURIComponent("Safety report — " + (CATEGORY_LABEL[category]||category))
            + "&body=" + encodeURIComponent(body);
        }catch(e){}
      })();
      const r = {
        id: "rep_" + Date.now(),
        ref: "your copy",
        category, details, providerId, bookingId, conversationId,
        status: "submitted", priority: "untriaged",
        createdAt: today(), at: nowISO(),
      };
      s.reports = [r, ...s.reports];
      s.reportsToday = (s.reportsToday || 0) + 1;
      S.modal = null;
      render();
      toast(`Safety report ${r.ref} submitted`);
    };

    /* ── refund submit ── */
    const ff = document.getElementById("sfRefundForm");
    if (ff) ff.onsubmit = e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(ff));
      const s = bag();
      const id = (S.modal && S.modal.bookingId) || d.bookingId || "";
      const b = booking(id);

      if (!b) return showErr("sfRefundErr", "Choose the booking you want refunded.");
      if (!paymentEligible(b))
        return showErr("sfRefundErr", "Only a paid or partially refunded booking can be refunded.");
      if (openRefundFor(b.id))
        return showErr("sfRefundErr", "A refund request is already open for this booking.");

      const reason = String(d.reason || "").trim();
      if (reason.length < REASON_MIN || reason.length > REASON_MAX)
        return showErr("sfRefundErr", "Reason must be 10 to 2000 characters.");

      /* [CRITICAL-PATH: money] REAL NOW. This used to mint a "RR-0001" reference
         and push the request into memory — the module has no network calls — and
         claim `amount: b.price`, a FULL refund regardless of policy, for a
         request nobody would ever read.

         It now calls stripe-refund, which prices the refund server-side from the
         cancellation policy snapshotted at booking time. The client sends a
         booking id and nothing else; it cannot name a figure. */
      const btn = ff.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = "Checking your policy…"; }

      const B = window.SporveBooking;
      if (!B || !B.refund) {
        if (btn) { btn.disabled = false; btn.textContent = "Submit request"; }
        return showErr("sfRefundErr", "Refunds are unavailable right now. Email support@sporve.com.");
      }

      B.refund(b.id).then(res => {
        s.refunds = [{
          id: "ref_" + Date.now(),
          /* No invented case number. This is the parent's own record of a
             decision that already happened, not a ticket someone will work. */
          ref: res.refunded ? "issued" : "no refund due",
          bookingId: b.id, reason,
          amount: res.refunded ? res.amount : 0,
          status: res.refunded ? "refunded" : "declined",
          policy: res.policy || null, decision: res.reason || null,
          createdAt: today(), at: nowISO(),
        }, ...s.refunds];
        S.modal = null;
        render();
        toast(res.refunded
          ? `Refund of ${money(res.amount)} sent to your card`
          : (res.reason || "No refund is due under this booking's policy"));
      }).catch(err => {
        if (btn) { btn.disabled = false; btn.textContent = "Submit request"; }
        showErr("sfRefundErr",
          (err && err.message) || "That refund could not be processed. Nothing was charged or changed.");
      });
    };

    /* ── privacy: live deletion notice + submit ── */
    const pf = document.getElementById("sfPrivacyForm");
    if (pf) {
      const notice = document.getElementById("sfPrivacyDeletion");
      const sync = () => {
        const v = (pf.querySelector('input[name="type"]:checked') || {}).value;
        if (notice) notice.classList.toggle("hide", v !== "deletion");
        pf.querySelectorAll(".sf-choice").forEach(l => {
          const i = l.querySelector("input");
          l.classList.toggle("on", !!i && i.checked);
        });
      };
      pf.querySelectorAll('input[name="type"]').forEach(i => i.onchange = sync);
      sync();

      pf.onsubmit = e => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(pf));
        const s = bag();
        const type = PRIVACY_LABEL[d.type] ? d.type : "access";
        const details = String(d.details || "").trim();

        if (details.length > PRIVACY_MAX)
          return showErr("sfPrivacyErr", `Details must be ${PRIVACY_MAX} characters or fewer.`);
        if (type === "correction" && details.length < DETAILS_MIN)
          return showErr("sfPrivacyErr", "Tell us what is incorrect — at least 10 characters.");

        const r = {
          id: "prv_" + Date.now(),
          ref: ref("PR", s.privacy.length + 1),
          type, details, status: "submitted",
          createdAt: today(), at: nowISO(),
        };
        s.privacy = [r, ...s.privacy];
        S.modal = null;
        render();
        toast(type === "deletion"
          ? `Deletion case ${r.ref} opened for review`
          : `Privacy request ${r.ref} submitted`);
      };
    }
  }

  /* ═══════════════════ CSS ═══════════════════ */
  const css = `
.sf-lede{color:var(--muted);margin-top:9px;max-width:62ch;font-size:var(--text-md)}
.sf-fine{color:var(--faint);font-size:var(--text-sm);margin-top:12px;line-height:1.5}
.sf-meta{color:var(--muted);font-size:var(--text-sm)}
.sf-optional{text-transform:none;letter-spacing:0;font-weight:600;color:var(--faint)}
.sf-gap{margin-top:12px}
.sf-push{margin-left:auto}

.sf-note{border:1px solid var(--rule);border-radius:var(--r-m);padding:15px 17px;background:var(--raise)}
.sf-note h3{font-size:var(--text-base)}
.sf-note p{color:var(--ink-2);font-size:var(--text-base);margin-top:6px;line-height:1.5;max-width:66ch}
.sf-note-warn{background:var(--warn-tint);border-color:transparent}
.sf-note-warn h3,.sf-note-warn b{color:var(--warn)}
.sf-note-warn p{color:var(--ink-2)}

/* ── page bands ─────────────────────────────────────────────────────
   #app.reg-serious paints the whole app --raise, and .band declares no
   ground of its own, so an unqualified .band inherits the slate and the
   white step of the rhythm disappears. This restores it with the same
   token .band.alt uses for its own ground -- no new colour. */
.band.sf-w{background:var(--paper)}
.sf-hero h1{margin-top:15px;max-width:20ch}
.sf-hero .lede{margin:14px 0 0;max-width:52ch;text-align:left}
.sf-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:26px}
.sf-emergency{margin-top:24px;max-width:70ch}

/* Non-interactive cards. .prodcard is shared with the product page, where it
   is a <button>; here it states a policy, so the hover lift comes off rather
   than promising a click that does not exist. */
.sf-static{cursor:default}
.sf-static:hover{border-color:var(--rule);transform:none;box-shadow:none}
.sf-static .pill{align-self:flex-start;margin-bottom:3px}
/* Badge rows on the dark panel: flat, hairline-separated, no cards. Literals
   for the rules because this band is ALWAYS dark (§3). */
.sf-badges{max-width:720px;border-bottom:1px solid #1C222B}
.sf-badge{display:grid;grid-template-columns:minmax(0,240px) minmax(0,1fr);
  gap:5px 34px;padding:16px 0;border-top:1px solid #1C222B;align-items:center}
.sf-badge p{color:#9AA6B2;font-size:var(--text-base);line-height:1.5;margin:0}
@media(max-width:560px){.sf-badge{grid-template-columns:1fr;gap:8px}}

/* The rules read as a document's own rows, not as cards: a lead column and a
   clause column separated by the page's rule. */
.sf-rules{border-bottom:1px solid var(--rule);margin-top:20px}
.sf-rule{
  display:grid;grid-template-columns:minmax(0,24ch) minmax(0,1fr);
  gap:5px 34px;padding:17px 0;border-top:1px solid var(--rule);align-items:baseline;
}
.sf-rule b{font-size:var(--text-base);letter-spacing:-.018em}
.sf-rule p{color:var(--ink-2);font-size:var(--text-base);line-height:1.55;max-width:58ch}

.sf-block+.sf-block{margin-top:34px;padding-top:26px;border-top:1px solid var(--rule)}
.sf-sec{display:flex;justify-content:space-between;align-items:baseline;gap:14px;margin-bottom:14px}
.sf-sec h3{font-size:var(--text-lg)}

.sf-none{color:var(--muted);font-size:var(--text-base);padding:6px 0 2px}
.sf-records table.tbl td b{font-weight:700}

.sf-mini{margin-top:20px;padding-top:16px;border-top:1px solid var(--rule)}
.sf-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid var(--rule)}
.sf-row:last-child{border-bottom:0;padding-bottom:0}
.sf-row-in{display:flex;flex-direction:column;gap:2px;flex:1;min-width:210px}
.sf-row-in b{font-size:var(--text-base);letter-spacing:-.015em}

.pill.sf-closed{background:var(--raise2);color:var(--ink-2)}

/* ── modal internals ── */
.sf-body .sf-note{margin-bottom:16px}
.sf-body .sf-lede{margin:0 0 16px;font-size:var(--text-base)}
.sf-target{border:1px solid var(--rule);border-radius:var(--r-m);padding:12px 14px;margin-bottom:16px;
  display:flex;flex-direction:column;gap:3px;background:var(--raise)}
.sf-target b{font-size:var(--text-base);letter-spacing:-.015em}
.sf-count{color:var(--muted);font-size:var(--text-sm)}
.sf-count.out{color:var(--warn);font-weight:700}
.sf-body textarea{resize:vertical;min-height:96px;line-height:1.5}
.sf-body .btn.wide+.btn.wide,.sf-body .btn.wide.sf-gap{margin-top:9px}

.sf-choices{display:flex;flex-direction:column;gap:9px;margin-bottom:16px}
.sf-choice{display:block;cursor:pointer}
.sf-choice input{position:absolute;opacity:0;width:1px;height:1px}
.sf-choice-in{display:flex;flex-direction:column;gap:3px;padding:13px 15px;border:1.5px solid var(--rule);
  border-radius:var(--r-m);transition:.15s}
.sf-choice-in b{font-size:var(--text-base);letter-spacing:-.018em}
.sf-choice-in span{font-size:var(--text-sm);color:var(--muted);line-height:1.45}
.sf-choice:hover .sf-choice-in{border-color:var(--ink-2);background:var(--raise)}
.sf-choice.on .sf-choice-in{border-color:var(--slate);background:var(--slate-tint);box-shadow:0 0 0 1px var(--slate)}
.sf-choice input:focus-visible+.sf-choice-in{outline:2px solid var(--slate);outline-offset:2px}

@media(max-width:760px){
  .sf-push{margin-left:0;flex-basis:100%}
  .sf-actions .btn{flex:1 1 auto}
  /* The lead column stops earning its width once it wraps to two lines. */
  .sf-rule{grid-template-columns:1fr;gap:4px}
}`;

  /* ═══════════════════ EXPORT ═══════════════════ */
  window.MOD_SAFETY = {
    css,
    views: { trust: trustView },
    modals: { report: reportModal, refund: refundModal, privacy: privacyModal },
    wire,
    state: {
      safety: {
        reports: [],
        refunds: [],
        privacy: [],
        reportsToday: 0,
        quotaDate: today(),
      },
    },
  };
})();
