/* MOD_PRODUCTPAGES — the fourteen assigned, text-first product pages.
   The host owns navigation and the small real-UI artifacts. This module owns
   page composition and prose so each recipe can be inspected as rendered DOM. */
(function () {
  "use strict";

  var IDS = [
    "what-is", "background-checks",
    "search", "map-search", "instant-booking", "messaging",
    "bookings-receipts", "athlete-progress",
    "scheduling", "payments", "roster", "session-notes",
    "media-consent", "insights"
  ];

  function hero(meta, headline, standfirst) {
    return "<section class='pgband slate pg-hero' data-section='hero'><div class='shell' data-rev>" +
      "<h1 class='pg-serif pg-h1'>" + headline + "</h1>" +
      "<p class='pg-sub' data-prose data-standfirst>" + standfirst + "</p>" +
      "<div class='pg-ctarow'>" + pageCTA(meta) + "</div>" +
      "</div></section>";
  }

  function wrap(id, recipe, body) {
    var meta = PAGE_META[id];
    return "<div class='pgroot pg-" + id + " rebuild-page' data-product-page='true' data-page-id='" +
      id + "' data-recipe='" + recipe + "'>" + body + pageKX(id) + "</div>";
  }

  function walkthroughSection(steps) {
    return "<section class='pgband white' data-section='walkthrough'><div class='shell pg-walkthrough'>" +
      steps.map(function (step, index) {
        return "<article class='pg-walk-step'><div class='pg-walk-num'>" +
          String(index + 1).padStart(2, "0") + "</div><h2>" + step[0] +
          "</h2><p data-prose data-step-prose>" + step[1] + "</p></article>";
      }).join("") + "</div></section>";
  }

  function searchPage(meta) {
    var intro = "Start with the sport your child wants to play, then narrow the real catalogue by age, level, price, format, and distance. Each result is a listing that exists, from a coach whose own check has cleared, with availability the family can inspect. Saving belongs here too: a saved coach is simply a useful search result kept for later comparison.";
    var steps = [
      ["Say what the athlete needs",
       "A parent begins with a sport and an age, because those two facts decide whether a session belongs in the result set at all. Level, format, budget, and distance then narrow the same catalogue; they do not open separate directories. The coach sees the sport, ages, price, location, and session capacity they published, exactly as the family will search them."],
      ["Filters remove, never invent",
       "Every filter operates on fields stored with a real listing. Choosing weekends removes sessions on weekdays. Setting a maximum price removes anything above it. Asking for a private lesson removes camps and teams. If nothing matches, Sporv says so and leaves the criteria visible. It never fills an empty result with a coach who missed the request."],
      ["Verification wins before ranking",
       "Trust is applied before sport, age, price, distance, or rating can affect order. A coach without a cleared personal background check is removed from bookable search, even when the business they work for is approved. Families see the remaining coach, the check state, the session details, and the price together. A strong profile cannot outrank a missing safety requirement."],
      ["Keep the result worth returning to",
       "Saving does not need its own thin destination story. A parent saves a coach from search, returns to the shortlist, and compares that real listing with other results. The saved record points back to current price and availability, so stale facts do not become a second catalogue. If a listing stops being bookable, saving it never makes it bookable again. The shortlist is a view, never an exemption."]
    ];
    return wrap("search", "R1", hero(meta,
      "Search the catalogue, then keep <em>the right coach.</em>", intro) +
      walkthroughSection(steps));
  }

  function schedulingPage(meta) {
    var intro = "A coach publishes the hours they are prepared to teach, attaches each opening to a service and capacity, and lets families book only those times. The calendar is not a promise to call back; it is the supply families can actually take. When a slot fills or closes, it leaves availability, so the public schedule and the coach's working week stay the same record.";
    var steps = [
      ["Set the repeating week",
       "The coach starts with the hours that normally belong to coaching: Tuesday after school, Saturday morning, or any other repeatable block. Each block has a start, duration, service, place, and capacity. Sporv turns those rules into dated openings. Families never see the private calendar around them; they see only the lesson times the coach deliberately made bookable."],
      ["Change one date or the rule",
       "A tournament, holiday, or court closure should not force the coach to rebuild the month. A single occurrence can close without deleting the repeating rule, while a permanent change updates future openings. The coach sees which dates were generated and which were edited. Families see the resulting truth: open, full, or unavailable, with no internal scheduling notes exposed."],
      ["Capacity closes the door",
       "Every opening carries the number of athletes it can hold. Checkout claims a seat against that number, and the last available seat closes the slot. Two families cannot both take one remaining place merely because their screens were open at the same time. The database checks capacity again when the booking is written; the calendar display alone is never the safety mechanism."],
      ["Move the week without losing history",
       "Changing future availability does not rewrite a session that was already booked. The existing booking keeps its date, price, participants, and policy snapshot until the coach and family deliberately change or cancel it. That separation protects both sides: the coach can shape next week freely, while a parent can still prove what was agreed for the session already on the books."]
    ];
    return wrap("scheduling", "R1", hero(meta,
      "Publish the hours. Families take <em>the real openings.</em>", intro) +
      walkthroughSection(steps));
  }

  function mapPage(meta) {
    var argument = "A list can sort by distance, but it still makes a parent translate every address into a journey. The map starts with place. Each pin represents the location attached to an existing listing, and opening it keeps the coach, sport, ages, price, verification state, and available sessions together. The rule underneath is the same as search: an unchecked person is not promoted by geography, and a pin never creates availability that the listing does not have.";
    var rows = [
      ["Find the practical radius",
       "Read addresses one by one, estimate unfamiliar neighborhoods, and discover the drive only after opening several profiles.",
       "See session locations together, begin with what is realistically close, and keep the stated distance beside every coach you inspect."],
      ["Understand one pin",
       "A marker often hides the useful facts, so the parent leaves the map and loses the place they were comparing.",
       "Opening a pin shows the named coach or program, sport, ages, price, check state, and next real opening without replacing the map."],
      ["Narrow the visible set",
       "Filters rebuild a detached list, making it hard to tell whether fewer results are closer or simply elsewhere.",
       "Sport, age, level, price, and format remove pins in place, so the family can see both the criteria and the geography that remain."],
      ["Protect the booking",
       "A directory pin can point at a business even when the individual coach or the advertised time has not been verified.",
       "The same personal-check and live-capacity rules govern map results. Location changes presentation; it never weakens who may appear or what may be booked."]
    ];
    var table = "<section class='pgband white' data-section='comparison-table'><div class='shell pg-comparison-wrap'>" +
      "<table class='pg-comparison'><thead><tr><th>The job</th><th>Elsewhere</th><th>On Sporv</th></tr></thead><tbody>" +
      rows.map(function (row) {
        return "<tr><th scope='row' data-prose>" + row[0] + "</th><td data-prose>" +
          row[1] + "</td><td data-prose>" + row[2] + "</td></tr>";
      }).join("") + "</tbody></table></div></section>";
    return wrap("map-search", "R2", hero(meta,
      "A list of coaches does not tell you <em>what a map does.</em>",
      "Distance is not a detail to check after choosing a coach. It decides whether a Tuesday lesson can become part of family life. Sporv puts real session locations on the map first, then lets sport, age, level, price, and format narrow what remains. Every visible pin still obeys the personal-check and live-availability rules that protect ordinary search.") +
      "<section class='pgband slate alt' data-section='argument'><div class='shell'><p class='pg-argument' data-prose>" +
      argument + "</p></div></section>" + table);
  }

  function insightsPage(meta) {
    var argument = "Insights are useful only when the coach can trace them back to work that happened in the product. Sporv derives the view from searches, listing visits, checkout starts, paid bookings, payouts, and return dates. The screen separates sample data from a coach's own data and keeps named client watchlists behind sign-in. A rising number should lead to a decision the coach understands, not a decorative score the platform cannot explain.";
    var rows = [
      ["Read local demand",
       "A coach guesses which sports, ages, or times families nearby want, usually from the messages loud enough to reach them.",
       "Search demand is grouped from catalogue activity, so the coach can compare what families sought with the services and hours they actually publish."],
      ["Follow the booking path",
       "Page views, inquiries, and bookings live in separate tools, leaving no reliable way to see where interest stopped.",
       "Listing views, checkout starts, and completed bookings form one funnel. Each stage comes from a recorded action rather than a coach-entered estimate."],
      ["Position a price",
       "A broad internet average mixes formats, locations, and age groups, then presents the result as advice for one coach.",
       "Price position compares relevant listings and names the comparison set. Sporv shows evidence; the coach keeps authority over the price they publish."],
      ["Notice who did not return",
       "A spreadsheet becomes stale between sessions, and a quiet family disappears until the coach happens to remember them.",
       "The watchlist uses real booking dates to identify a lapse, stays private to the signed-in coach, and never treats seeded sample families as outreach targets."]
    ];
    var table = "<section class='pgband slate alt' data-section='comparison-table'><div class='shell pg-comparison-wrap'>" +
      "<table class='pg-comparison'><thead><tr><th>The job</th><th>Elsewhere</th><th>On Sporv</th></tr></thead><tbody>" +
      rows.map(function (row) {
        return "<tr><th scope='row' data-prose>" + row[0] + "</th><td data-prose>" +
          row[1] + "</td><td data-prose>" + row[2] + "</td></tr>";
      }).join("") + "</tbody></table></div></section>";
    return wrap("insights", "R2", hero(meta,
      "A dashboard number should explain <em>what changed.</em>",
      "Bookings, earnings, search demand, price position, and returning clients already leave records as a coach works. Insights turns those records into a readable view of the business without asking for a second spreadsheet. Every figure is derived, sample figures are labeled, and the client watchlist stays private because business guidance never justifies exposing a family's history.") +
      "<section class='pgband white' data-section='argument'><div class='shell'><p class='pg-argument' data-prose>" +
      argument + "</p></div></section>" + table);
  }

  function instantBookingPage(meta) {
    var copy = [
      "Instant booking begins with supply the coach has already published. A family chooses a dated opening, sees the service, duration, location, capacity, and full price, then confirms the athlete who will attend. Nothing is sent as a vague request. The selected opening is held through checkout so the parent knows which session the payment is buying.",
      "Capacity is checked again when the booking is written. That second check matters when two families reach the last seat at nearly the same moment: one confirmed write can take it, and the other must choose another opening. A screen that merely looked open cannot override the stored count. Once full, the slot stops appearing as available.",
      "Payment and the policy snapshot attach to the same booking record. The parent receives confirmation, the coach sees the athlete on the roster, and both sides can reopen the date, price, messages, receipt, and cancellation terms. If payment fails, the session is not presented as confirmed. A clean failure is safer than a booking that exists only in one person's inbox."
    ];
    var figure = "<figure class='pg-flat-figure'><div class='pg-mono-ui' aria-label='Sample open baseball session'>" +
      "<div class='pg-ui-head'><span>Grand Slam Baseball / Hitting Lab</span><span>Sample data</span></div>" +
      "<div class='pg-ui-row'><span class='pg-ui-key'>coach</span><span class='pg-ui-value'>Maya Rivera / background check cleared</span></div>" +
      "<div class='pg-ui-choice' aria-current='true'><span>Sat May 16 / 9:00 AM / 60 min</span><span>$45.00</span></div>" +
      "<div class='pg-ui-choice'><span>Sat May 16 / 10:30 AM / 60 min</span><span>$45.00</span></div>" +
      "<div class='pg-ui-row'><span class='pg-ui-key'>capacity</span><span class='pg-ui-value'>1 seat held while payment completes</span></div>" +
      "<div class='pg-ui-row'><span class='pg-ui-key'>result</span><span class='pg-ui-value'>confirmed only after the card succeeds</span></div>" +
      "</div><figcaption data-prose>The figure stays flat because the record is the product: a real coach, one dated opening, the complete price, capacity, and the rule that separates a temporary hold from a confirmed session. It also shows the parent what the coach will receive as a booked athlete, rather than hiding the operational result behind a decorative confirmation screen. Nothing here depends on a callback or manual acceptance after payment.</figcaption></figure>";
    return wrap("instant-booking", "R4", hero(meta,
      "Choose the opening and leave with <em>a confirmed session.</em>",
      "A bookable time is not an invitation to start a text thread. It is a dated opening the coach published, with a service, duration, place, price, and seat count behind it. Sporv holds the selected seat while payment completes, checks capacity when the booking is written, and confirms only after the charge succeeds, so both sides leave the flow reading the same record.") +
      "<section class='pgband white' data-section='product-figure'><div class='shell pg-r4-grid'><div class='pg-r4-copy'><h2>The slot, charge, and rule travel together.</h2>" +
      copy.map(function (p) { return "<p data-prose>" + p + "</p>"; }).join("") +
      "</div>" + figure + "</div></section>");
  }

  function athleteProgressPage(meta) {
    var copy = [
      "Progress begins with a session that happened. The coach records the focus, what changed, and what should come next against the athlete who attended. A goal can name a skill, distance, time, or other concrete target. The parent sees the same dated note and can read improvement without reconstructing it from messages sent across a season.",
      "The timeline belongs to the athlete's family account, not to one coach's private notebook. Training with another coach does not erase the earlier record, and a new note does not rewrite an older one. Each entry keeps its author and session context, so continuity never turns into anonymous advice. The family decides which athlete record a booking uses.",
      "Numbers appear only when someone recorded a real measure. A personal best can show the baseline and later result; an ordinary practice can remain a written observation. Sporv does not turn every child into a leaderboard or infer medical conclusions from coaching notes. The rule is simple: show what was observed, preserve who wrote it, and keep the history with the athlete."
    ];
    var figure = "<figure class='pg-flat-figure'><div class='pg-mono-ui' aria-label='Sample athlete progress timeline'>" +
      "<div class='pg-ui-head'><span>Avery / Sprint development</span><span>Sample data</span></div>" +
      "<div class='pg-ui-row'><span class='pg-ui-key'>APR 18</span><span class='pg-ui-value'>Baseline 100m / 14.4s / first timed run</span></div>" +
      "<div class='pg-ui-row'><span class='pg-ui-key'>MAY 02</span><span class='pg-ui-value'>Block starts / first three steps sharper</span></div>" +
      "<div class='pg-ui-row'><span class='pg-ui-key'>MAY 16</span><span class='pg-ui-value'>150m rep / held form through the turn</span></div>" +
      "<div class='pg-ui-row'><span class='pg-ui-key'>MAY 30</span><span class='pg-ui-value'>100m / 13.9s / new personal best</span></div>" +
      "</div><figcaption data-prose>The timeline distinguishes measurement from observation, keeps every entry dated and attributed, and gives the next coach continuity without pretending that one number explains the whole athlete. Parents can read the change over time while the coach prepares the next session from the same evidence. A gap stays a gap; the interface does not manufacture progress for dates when nobody recorded an observation or result.</figcaption></figure>";
    return wrap("athlete-progress", "R4", hero(meta,
      "The coach can change. <em>The record stays.</em>",
      "Session notes, goals, and measured results accumulate around the athlete who did the work. Parents can read what happened, what the coach noticed, and what comes next without keeping a parallel notebook. Because the record belongs to the athlete's account, changing coaches does not reset the season, while every entry still shows who wrote it and which session produced it.") +
      "<section class='pgband slate alt' data-section='product-figure'><div class='shell pg-r4-grid'><div class='pg-r4-copy'><h2>A dated account of work, not a score for childhood.</h2>" +
      copy.map(function (p) { return "<p data-prose>" + p + "</p>"; }).join("") +
      "</div>" + figure + "</div></section>");
  }

  function rosterPage(meta) {
    var copy = [
      "A coach can begin with the families they already train instead of waiting for the first marketplace booking to make the product useful. Imported clients enter as roster records with the minimum contact and athlete context needed for the coach's work. New paid bookings then join the same roster automatically, avoiding a second list for clients who happened to arrive through Sporv.",
      "Opening an athlete connects the practical history: upcoming and completed sessions, notes, payment state, messages, and media-consent status. The coach does not have to match a nickname in a group text to a payer in a receipt export. Parents still control their own account and consent decisions. A roster link gives the coach working context; it does not transfer ownership of family data.",
      "The roster is private to the signed-in coach or authorized organization member. Public visitors see listings, not client names, attendance, or notes. Sorting and search happen inside that protected view. When access to an athlete is no longer justified, removing the coaching relationship closes future operational access without rewriting completed booking and payment records that both sides may still need."
    ];
    var figure = "<figure class='pg-flat-figure'><div class='pg-mono-ui' aria-label='Sample private client roster'>" +
      "<div class='pg-ui-head'><span>Hockey roster / private coach view</span><span>Sample data</span></div>" +
      "<table class='pg-roster-ui'><thead><tr><th>Athlete</th><th>Sessions</th><th>Last seen</th></tr></thead><tbody>" +
      "<tr><td>Cole S.</td><td>31</td><td>Yesterday</td></tr><tr><td>Mason B.</td><td>24</td><td>2 days</td></tr>" +
      "<tr><td>Ella T.</td><td>12</td><td>5 days</td></tr><tr><td>Ava L.</td><td>8</td><td>1 week</td></tr>" +
      "</tbody></table></div><figcaption data-prose>The sample table shows the useful minimum at a glance. Names and attendance stay in the signed-in coach view; a public listing never inherits private roster data. Sorting the table changes order, not access, and every row opens the same athlete record rather than a copied profile for that coaching relationship.</figcaption></figure>";
    return wrap("roster", "R4", hero(meta,
      "Every client becomes <em>one working record.</em>",
      "Bring the families you already coach, then let new bookings add themselves. The roster joins each athlete to sessions, notes, payment state, messages, and consent without making the coach rebuild those links in a spreadsheet. It is a private operations view: families keep their own accounts and permissions, while public visitors never see the names or histories a coach uses to run the week.") +
      "<section class='pgband white' data-section='product-figure'><div class='shell pg-r4-grid'><div class='pg-r4-copy'><h2>The book of business, without the duplicate books.</h2>" +
      copy.map(function (p) { return "<p data-prose>" + p + "</p>"; }).join("") +
      "</div>" + figure + "</div></section>");
  }

  function whatIsPage(meta) {
    var sportCount = String(new Set(PROGRAMS.map(function (p) { return p.sport; })).size);
    var prose = [
      "For a family, Sporv begins as a catalogue of independent youth-sports coaches, trainers, camps, and teams. Search reads the sport, athlete age, level, format, price, location, and real availability stored on each listing. A family can compare, ask a question, choose an open session, pay, and return later to the same booking for messages, notes, receipts, or a cancellation.",
      "For a coach, the other side of that booking is the operating system for the week. Listings define the service. Availability creates supply. Checkout fills capacity, adds the athlete to the roster, and starts the payment record. Session notes and consent-aware media continue the relationship after attendance. Payouts and insights are derived from those records instead of requiring a separate reconstruction.",
      "The marketplace is held together by rules that apply before presentation. Every bookable coach needs their own cleared background check. Parents control athlete and media consent. The cancellation policy saved at purchase governs a later refund. Reviews open after completed sessions. Coaches remain independent professionals, set their own services and prices, and pay Sporv a flat platform fee only when a booking is paid. That shared record also gives support a concrete place to investigate a dispute. The platform can inspect the listing, booking state, policy, payment trail, messages, and safety status that existed at the time instead of asking each side to reconstruct the event from memory. One marketplace does not mean one role; it means the roles meet around evidence both can name. That evidence makes support and safety review possible without turning either party's memory into the system of record."
    ];
    var rail = "<aside class='pg-stat-rail' aria-label='Real Sporv platform numbers'>" +
      "<div class='pg-rail-stat'><span class='pg-rail-value'>" + sportCount + "</span><span class='pg-rail-label'>catalogue sports in the current product data</span></div>" +
      "<div class='pg-rail-stat'><span class='pg-rail-value'>100%</span><span class='pg-rail-label'>of bookable coaches require a cleared personal check</span></div>" +
      "<div class='pg-rail-stat'><span class='pg-rail-value'>12%</span><span class='pg-rail-label'>flat coach platform fee on a paid booking</span></div></aside>";
    return wrap("what-is", "R3", hero(meta,
      "One marketplace, with rules on <em>both sides.</em>",
      "Sporv connects families seeking youth-sports coaching with independent professionals who publish real services and availability. Families search, message, book, pay, and keep the record. Coaches manage that same session through schedule, roster, notes, consent, and payout. Safety, capacity, payment, and policy rules hold before either side sees a success state.") +
      "<section class='pgband white' data-section='essay-stat'><div class='shell pg-essay-stat'><div class='pg-essay'><h2>The booking is the shared object.</h2>" +
      prose.map(function (p) { return "<p data-prose>" + p + "</p>"; }).join("") +
      "</div>" + rail + "</div></section>");
  }

  function bookingsPage(meta) {
    var prose = [
      "A booking starts with the coach, service, athlete, dated opening, duration, place, and price that were accepted at checkout. Sporv stores those facts together instead of leaving the parent to match a card charge with an email and a calendar event. The coach sees the same session on the roster. Messages about arrival, equipment, or a change remain attached to that context.",
      "Payment creates an itemized receipt inside the booking. Families pay the coach's listed price with no added family booking fee. The coach's platform fee is deducted from the coach payout and shown there, not quietly placed on the parent total. If a charge fails, the record cannot present the session as paid. If money is returned, the refund amount and status remain beside the original charge.",
      "Cancellation uses the policy saved when the parent booked, not whatever the listing says later. The current flexible policy returns the paid amount when cancellation happens at least twenty-four hours before the session; inside that window, the saved terms decide the result. The calculation reads the time, amount paid, policy snapshot, and any earlier refund. No one types a convenient number over the record. When a coach cancels or a session does not happen, support can inspect the same record rather than guessing from competing screenshots. The family can see whether the refund is requested, processing, or completed, and the coach can see how that change affects the payout. A finished refund remains in history; it does not erase the original payment."
    ];
    var rail = "<aside class='pg-stat-rail' aria-label='Booking record rules'>" +
      "<div class='pg-rail-stat'><span class='pg-rail-value'>1</span><span class='pg-rail-label'>record for session, payment, messages, and refund</span></div>" +
      "<div class='pg-rail-stat'><span class='pg-rail-value'>$0</span><span class='pg-rail-label'>family booking fee added to the coach's listed price</span></div>" +
      "<div class='pg-rail-stat'><span class='pg-rail-value'>24h</span><span class='pg-rail-label'>current full-refund threshold, saved at purchase</span></div></aside>";
    return wrap("bookings-receipts", "R3", hero(meta,
      "The session and its money stay <em>on one record.</em>",
      "Every booking keeps the coach, athlete, dated session, price, payment, messages, cancellation terms, receipt, and any refund together. A parent can reopen what was agreed without searching email, and a coach can read the same operational record. The policy is copied onto the booking at purchase, so later listing edits cannot change the terms that protect either side.") +
      "<section class='pgband slate alt' data-section='essay-stat'><div class='shell pg-essay-stat'><div class='pg-essay'><h2>A receipt is part of the session history.</h2>" +
      prose.map(function (p) { return "<p data-prose>" + p + "</p>"; }).join("") +
      "</div>" + rail + "</div></section>");
  }

  function paymentsPage(meta) {
    var prose = [
      "A family pays the price the coach published. Sporv does not add a family booking fee at checkout. The paid booking records the gross service price, and the coach side records the platform fee and resulting net payout. Keeping incidence explicit matters: the parent should not discover a surcharge at the last step, and the coach should not have to reverse-engineer what arrived.",
      "The platform fee is a flat twelve percent of the paid booking. It is taken only when there is paid revenue, then itemized on the payout record as gross, fee, and net. The coach connects a payout account after the required onboarding and safety gates clear. Payout state moves from pending to in transit to paid, so a balance never disappears behind a generic success message.",
      "Refunds preserve the same arithmetic. When money goes back under the saved cancellation policy, Sporv returns the corresponding portion of its fee instead of keeping a fee on refunded coach revenue. The original charge, refunded amount, remaining paid amount, returned fee, and payout adjustment stay visible. That trail lets both sides distinguish a pending transfer from money that was actually deposited."
    ];
    var rail = "<aside class='pg-stat-rail' aria-label='Worked payout example'>" +
      "<div class='pg-rail-stat'><span class='pg-rail-value'>$45.00</span><span class='pg-rail-label'>family pays the coach's listed lesson price</span></div>" +
      "<div class='pg-rail-stat'><span class='pg-rail-value'>−$5.40</span><span class='pg-rail-label'>twelve percent platform fee from coach revenue</span></div>" +
      "<div class='pg-rail-stat'><span class='pg-rail-value'>$39.60</span><span class='pg-rail-label'>coach net payout before any later refund</span></div></aside>";
    var worked = "<div class='pg-worked-math'><code>gross       $45.00\nfee      ×     .12\n-----------------\nplatform   −$5.40\ncoach net   $39.60</code>" +
      "<p data-prose>A forty-five-dollar lesson produces a five-dollar-and-forty-cent fee and a thirty-nine-dollar-and-sixty-cent coach payout. The same formula applies to every paid booking; there is no tier to infer and no separate invoice after the fact. The rail repeats those exact amounts in the transfer record the coach can reopen later.</p></div>";
    return wrap("payments", "R3", hero(meta,
      "Gross, fee, and net are <em>shown before payout.</em>",
      "The parent's charge and the coach's payout are two views of the same paid booking. Families pay the coach's listed price without an added booking fee. Coaches pay one flat platform fee from that revenue, then see the exact gross, fee, and net amounts as the transfer moves. Refunds keep their own trail and return the matching portion of the fee when coach revenue is returned.") +
      "<section class='pgband white' data-section='essay-stat'><div class='shell pg-essay-stat'><div class='pg-essay'><h2>The arithmetic should fit on four lines.</h2>" +
      prose.map(function (p) { return "<p data-prose>" + p + "</p>"; }).join("") + worked +
      "</div>" + rail + "</div></section>");
  }

  function definitionSection(rows) {
    return "<section class='pgband white' data-section='definition-list'><div class='shell'><dl class='pg-definition-list'>" +
      rows.map(function (row) {
        return "<div class='pg-definition-row'><dt>" + row[0] + "</dt><dd data-prose>" +
          row[1] + "</dd></div>";
      }).join("") + "</dl></div></section>";
  }

  function messagingPage(meta) {
    var blocks = [
      "A family can ask a background-checked coach about level, equipment, accessibility, timing, or fit before paying. The conversation stays inside the account instead of requiring a public phone number. The coach sees who is asking and which listing opened the thread, so an answer can refer to the actual service rather than a context-free message copied from another app. The family can leave without creating a second contact channel at all.",
      "When the family books, the existing conversation remains connected to that booking. Arrival instructions, a promised accommodation, or a schedule clarification do not vanish behind a new thread. Both sides can read what was said before the session and continue from there. Sporv does not turn a message into a booking; payment, capacity, and confirmation still have to clear their own rules. Later messages keep that session context even when the calendar becomes busy.",
      "Messaging also needs an exit. Either side can stop engaging, report a safety concern, or use the published support route when the issue is not ordinary scheduling. A coach cannot use access to a roster as permission to broadcast unrelated marketing. Keeping the thread attached, attributed, and reportable gives the product a record without pretending that software can replace judgment in an urgent situation. The safety route remains visible when an ordinary reply is not enough."
    ];
    var defs = [
      ["Listing thread", "The conversation starts from a real coach or program listing, so sport, service, and sender remain identifiable."],
      ["Booking context", "After checkout, the same thread carries the dated session instead of opening a disconnected replacement conversation."],
      ["Delivery record", "Sent messages remain attributed and ordered; a draft or failed send is not presented as delivered to the other side."],
      ["Safety route", "Reporting is separate from ordinary replies, and emergencies still belong with local emergency services rather than a marketplace inbox."]
    ];
    return wrap("messaging", "R5", hero(meta,
      "Ask first. Keep the answer <em>with the booking.</em>",
      "Parents can message a coach before money moves, using the listing as context and without publishing a personal phone number. If they book, the same thread follows the dated session instead of restarting. Messages remain attributed and ordered, while confirmation still depends on capacity and payment. A conversation can explain the service; it cannot quietly bypass the rules that decide whether a session exists.") +
      "<section class='pgband dark pg-dark-essay' data-section='dark-essay'><div class='shell'><h2>Conversation is part of the record.</h2><div class='pg-dark-copy'>" +
      blocks.map(function (p) { return "<p data-prose data-dark-block>" + p + "</p>"; }).join("") +
      "</div></div></section>" + definitionSection(defs));
  }

  function sessionNotesPage(meta) {
    var blocks = [
      "The coach writes a note against a completed or scheduled session and selects the athlete it describes. The note can record the drill, observation, adjustment, and next focus in the coach's own words. A draft remains on the coach side until it is sent. Sporv does not label unfinished text as a parent update, because writing something and delivering it are different product states. That distinction stays visible in the coach's queue.",
      "Sending creates the family-facing copy inside the athlete's record. The parent sees which coach wrote it and which session produced it, rather than receiving a floating paragraph with no date. The coach can review written notes and see which sessions still need one. Private operational details do not belong in the shared note; the field is for a useful account of the athlete's work. Delivery state stays visible after the page is reopened.",
      "Over time, sent notes become the narrative layer of athlete progress. Measurements can sit beside them, but a time or count never replaces the coach's observation. A later coach can understand what was tried while every entry keeps its author. The rule protects continuity without laundering opinion into fact: old notes persist as dated statements, and a new note never edits their history. The parent can always see that order for themselves."
    ];
    var defs = [
      ["Draft", "Text visible to the coach while it is still being written; the family has not received it."],
      ["Sent note", "A dated, attributed update delivered to the athlete's family and attached to the source session."],
      ["Needs a note", "A queue built from session records, helping the coach find completed work that has no written update yet."],
      ["Progress timeline", "The athlete-level sequence of sent observations and real measurements, preserved across sessions and coaches."]
    ];
    return wrap("session-notes", "R5", hero(meta,
      "Write once. Send a note that <em>keeps its context.</em>",
      "A session note names the athlete, the session, what the coach observed, and what should happen next. Coaches can keep a draft, send it to the parent, and see which completed sessions still need an update. Once sent, the note joins the athlete's progress record with its author and date, so useful continuity does not depend on a loose notebook or a screenshot.") +
      "<section class='pgband dark pg-dark-essay' data-section='dark-essay'><div class='shell'><h2>A note has a source and a destination.</h2><div class='pg-dark-copy'>" +
      blocks.map(function (p) { return "<p data-prose data-dark-block>" + p + "</p>"; }).join("") +
      "</div></div></section>" + definitionSection(defs));
  }

  function questionSection(rows) {
    return "<section class='pgband white' data-section='question-ledger'><div class='shell'><dl class='pg-question-ledger'>" +
      rows.map(function (row) {
        return "<div class='pg-question-row'><dt>" + row[0] + "</dt><dd data-prose>" +
          row[1] + "</dd></div>";
      }).join("") + "</dl></div></section>";
  }

  function backgroundChecksPage(meta) {
    var questions = [
      ["Who is actually checked?",
       "The individual coach is checked. A facility, club, camp, or company may operate the listing, but its approval never substitutes for the person who will work with the athlete. Each coach supplies the identity information and consent required by the screening process. The record belongs to that person, so one cleared colleague cannot make the rest of a staff bookable."],
      ["Who decides whether the check cleared?",
       "An independent screening process returns the result, and Sporv stores the resulting state. A coach or business cannot click its own profile into a cleared condition, write a convincing badge, or publish around a pending result. The product reads the stored safety state before showing bookable supply. Operational review can investigate exceptions; marketing copy cannot create clearance."],
      ["When can families see and book the coach?",
       "A coach becomes bookable only after their personal check is recorded as cleared and the rest of the listing requirements are met. Pending and failed states do not enter the bookable result set, map, or coach finder. The family sees the coach and the verification state together. Discovery never outruns the gate simply because a session starts soon."],
      ["What happens if the cleared state changes?",
       "The badge is a view of a current stored state, not a permanent award. If the record no longer qualifies as cleared, the badge stops showing and the coach stops passing the bookable-supply check. Existing records still preserve what was booked and when for review, but a saved coach, old link, or business membership cannot restore the right to accept another booking."],
      ["What can a parent verify for themselves?",
       "Parents can read the named coach, the background-check state, the listing owner, and the session they are about to book. They should still ask questions, review the service, and report a mismatch between the person listed and the person who arrives. A background check is one enforced gate; it is not a promise about fit, performance, or every future action."]
    ];
    return wrap("background-checks", "R6", hero(meta,
      "The person clears the check, <em>not the organization.</em>",
      "Every coach who can accept a booking must have their own cleared background-check record. A club cannot extend its status to an unchecked staff member, and a coach cannot set the badge themselves. Sporv reads the stored result before the person appears as bookable. If the cleared state stops being true, the badge and access to new bookings stop with it.") +
      questionSection(questions));
  }

  function mediaConsentPage(meta) {
    var questions = [
      ["Who can grant consent?",
       "A parent or authorized family account grants consent for the athlete. A coach can request it and explain the intended use, but cannot approve the request on the family's behalf. Organization membership does not change that boundary. The product records who granted the decision and when, so an unchecked box in a coach workflow never becomes permission by implication."],
      ["What exactly receives permission?",
       "Consent is tied to the athlete and the allowed use presented to the family, such as private sharing with tagged families or eligibility for a public profile. The coach tags the athletes shown in an asset before sharing it. When several children appear, each child's state matters. One parent's yes cannot cover another family's athlete in the same photo or clip."],
      ["What does the coach see before consent?",
       "The coach sees that permission is missing or awaiting a family decision. The blocked asset cannot be marked shareable with that athlete or published as though the decision existed. This is a product gate, not a reminder beside an active button. Private storage for review is different from permission to distribute, and the interface keeps those states separate."],
      ["What happens after a parent revokes it?",
       "The athlete's permission changes immediately for future sharing, and affected media loses the shareable state inside Sporv. Revocation cannot pull back a file another person already saved outside the service, so the product does not make that impossible promise. Families can use the support and safety routes when a copy remains somewhere it should not."],
      ["Can consent be assumed from a booking?",
       "No. Paying for coaching, attending a session, joining a team, or accepting ordinary service terms does not silently grant media permission. The booking can establish who attended and which family controls the athlete record; consent remains a separate choice. A missing decision stays missing until the family acts, and the coach sees a locked state rather than a default yes."]
    ];
    return wrap("media-consent", "R6", hero(meta,
      "A child's image moves only after <em>the parent's yes.</em>",
      "Photos and clips are useful for feedback, but a booking is not media consent. The family decides for each athlete, the product records that decision, and the coach sees a locked state until permission exists. Sharing checks every tagged child rather than trusting a blanket team waiver. When consent is revoked, future sharing closes; the interface does not keep treating an old yes as current.") +
      questionSection(questions));
  }

  function render(id) {
    var meta = PAGE_META[id];
    if (!meta) return "";
    if (id === "search") return searchPage(meta);
    if (id === "scheduling") return schedulingPage(meta);
    if (id === "map-search") return mapPage(meta);
    if (id === "insights") return insightsPage(meta);
    if (id === "instant-booking") return instantBookingPage(meta);
    if (id === "athlete-progress") return athleteProgressPage(meta);
    if (id === "roster") return rosterPage(meta);
    if (id === "what-is") return whatIsPage(meta);
    if (id === "bookings-receipts") return bookingsPage(meta);
    if (id === "payments") return paymentsPage(meta);
    if (id === "messaging") return messagingPage(meta);
    if (id === "session-notes") return sessionNotesPage(meta);
    if (id === "background-checks") return backgroundChecksPage(meta);
    if (id === "media-consent") return mediaConsentPage(meta);
    return "";
  }

  window.SporvProductPages = {
    ids: IDS.slice(),
    has: function (id) { return IDS.indexOf(id) !== -1; },
    render: render
  };
})();
