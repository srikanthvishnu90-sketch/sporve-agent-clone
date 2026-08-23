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
    "media-consent", "insights",
    // For organizations — the Enterprise ($149/mo, in development) showcase.
    // These are SALES/DESIGN artifacts: every one frames the tier as "in
    // development / early access", carries no purchasable path (CTA navigates
    // to the pricing tab, which describes early access), and labels every demo
    // card "Sample · Enterprise in development". Enterprise is
    // plan_entitlements.purchasable=false and billing-create-checkout rejects
    // it server-side, so none of these may claim a live feature.
    "enterprise", "enterprise-roster", "enterprise-finance", "enterprise-compliance"
  ];

  function hero(meta, headline, standfirst, options) {
    var o = options || {};
    var tone = o.tone || "white";
    var layout = o.layout || "split";
    var eyebrow = o.eyebrow
      ? "<p class='pg-eyebrow'>" + o.eyebrow + "</p>"
      : "";
    return "<section class='pgband " + tone + " pg-hero pg-hero--" + layout +
      "' data-section='hero' data-layout='hero-" + layout + "'><div class='shell pg-hero-inner' data-rev>" +
      "<div class='pg-hero-title'>" + eyebrow + "<h1 class='pg-serif pg-h1'>" + headline + "</h1></div>" +
      "<div class='pg-hero-copy'><p class='pg-sub' data-prose data-standfirst>" + standfirst + "</p>" +
      "<div class='pg-ctarow'>" + pageCTA(meta) + "</div></div>" +
      (o.aside || "") + "</div></section>";
  }

  function wrap(id, recipe, composition, rhythm, body) {
    return "<div class='pgroot pg-" + id + " rebuild-page' data-product-page='true' data-page-id='" +
      id + "' data-recipe='" + recipe + "' data-composition='" + composition +
      "' data-rhythm='" + rhythm + "'>" + body + "</div>";
  }

  function walkthroughSection(steps, options) {
    var o = options || {};
    return "<section class='pgband " + (o.tone || "white") + "' data-section='walkthrough' data-layout='" +
      (o.layout || "walk-rows") + "'><div class='shell pg-walkthrough'>" +
      steps.map(function (step, index) {
        return "<article class='pg-walk-step'><div class='pg-walk-num'>" +
          String(index + 1 + (o.start || 0)).padStart(2, "0") + "</div><h2>" + step[0] +
          "</h2><p data-prose data-step-prose>" + step[1] + "</p></article>";
      }).join("") + "</div></section>";
  }

  function searchPage(meta) {
    var intro = "Sport is only the first filter. Sporv also reads the athlete's age, the listing's published skill level, preferred format, budget, distance, and current availability. Families narrow one real catalogue rather than browsing invented recommendations. Verification remains visible on every result, and a verified-only control removes coaches without dated clearance. A saved coach still points to the current listing, so changed availability or check state cannot be frozen into a misleading shortlist.";
    var figure = "<figure class='pg-flat-figure pg-filter-figure'><div class='pg-mono-ui' aria-label='Demonstration of family search filters'>" +
      "<div class='pg-ui-head'><span>FAMILY SEARCH</span><span>DEMO DATA</span></div>" +
      "<div class='pg-ui-row'><span class='pg-ui-key'>SPORT</span><span class='pg-ui-value'>Baseball</span></div>" +
      "<div class='pg-ui-row'><span class='pg-ui-key'>ATHLETE AGE</span><span class='pg-ui-value'>9 years</span></div>" +
      "<div class='pg-ui-row'><span class='pg-ui-key'>LEVEL</span><span class='pg-ui-value'>Developing fundamentals</span></div>" +
      "<div class='pg-ui-row'><span class='pg-ui-key'>FORMAT</span><span class='pg-ui-value'>Single session</span></div>" +
      "<div class='pg-ui-row'><span class='pg-ui-key'>RESULT</span><span class='pg-ui-value'>6 matching listings remain</span></div></div>" +
      "<figcaption data-prose>This disclosed demo uses fictional filter values to show the mechanism, not current catalogue supply. Each row removes listings that do not match; none of the values can create a coach, a session, or a cleared check.</figcaption></figure>";
    var rows = [
      ["Respect the age range", "A broad sport directory leaves the parent to inspect every profile for age fit.", "Minimum and maximum age stay with the listing. Selecting an athlete's age removes services whose published range does not include them."],
      ["Show real supply", "A recommendation can look relevant while the coach has no dated opening to take.", "Only published services and current availability enter the result, with price, place, format, and capacity still attached."],
      ["Keep trust legible", "A polished profile can make an unchecked person look equivalent to someone with dated clearance.", "The check state stays beside the result. Verified-only removes unbadged supply, and the server checks provider safety again before accepting a booking."],
      ["Save without freezing", "A bookmark often preserves an old promise long after the underlying listing changes.", "The shortlist points back to the current record. A coach who stops being bookable stops being bookable there too."]
    ];
    var table = "<section class='pgband slate pg-search-compare' data-section='comparison-table' data-layout='compare-ledger'><div class='shell pg-comparison-wrap'>" +
      "<table class='pg-comparison'><thead><tr><th>The job</th><th>Elsewhere</th><th>On Sporv</th></tr></thead><tbody>" +
      rows.map(function (row) {
        return "<tr><th scope='row' data-prose>" + row[0] + "</th><td data-prose>" + row[1] +
          "</td><td data-prose>" + row[2] + "</td></tr>";
      }).join("") + "</tbody></table></div></section>";
    return wrap("search", "B03", "filter-figure-to-comparison", "L-D-L", hero(meta,
      "Match the athlete, not just <em>the sport.</em>", intro,
      { tone: "white", layout: "search-gate", eyebrow: "SPORT, AGE, LEVEL, FORMAT" }) +
      "<section class='pgband dark pg-search-match' data-section='filter-figure' data-layout='dark-copy-filter'><div class='shell pg-search-match-grid'>" +
      "<div class='pg-search-copy'><p class='pg-eyebrow'>THE MATCHING RULE</p><h2>The athlete's age range stays attached to every result.</h2>" +
      "<p data-prose>A parent starts with facts the coach has already committed to the listing. Sport and age narrow eligibility. The selected level, format, price, distance, and available date decide whether the service can work in family life. The result set gets smaller as those facts become specific; Sporv does not invent a nearby substitute that ignores a selected filter. If nothing matches, the empty result keeps the criteria visible so the family can revise a choice deliberately.</p>" +
      "<p data-prose>The coach sees the same structured fields while publishing: ages served, skill level, format, price, location, and schedule. That symmetry matters. Search is not interpreting a vague biography after the fact; it is comparing the family's request with supply the coach can correct before anyone books. A parent can understand why a listing belongs, while a coach can identify which published fact kept another listing out.</p>" +
      "<p data-prose>Verification is visible and filterable, not silently inferred from a polished profile. With verified-only selected, a coach without a cleared status and completion date leaves the results. Without it, the listing remains unbadged rather than being called clear. When a family proceeds, the server checks provider safety again as the booking is written, so an old result or saved link cannot grant permission that the current record no longer supports.</p></div>" + figure + "</div></section>" + table);
  }

  function schedulingPage(meta) {
    var intro = "A coach publishes the hours they are prepared to teach, attaches each opening to a service and capacity, and lets families book only those times. The calendar is not a promise to call back; it is the supply families can actually take. When a slot fills or closes, it leaves availability, so the public schedule and the coach's working week stay the same record. The next parent reads that change immediately instead of waiting for a manual correction.";
    var steps = [
      ["Set the repeating week",
       "The coach starts with the hours that normally belong to coaching: Tuesday after school, Saturday morning, or any other repeatable block. Each block has a start, duration, service, place, and capacity. Sporv turns those rules into dated openings. Families never see the private calendar around them; they see only the lesson times the coach deliberately made bookable. The coach previews the dated result before publishing, so one recurring mistake cannot become a month of misleading supply before it goes live."],
      ["Change one date or the rule",
       "A tournament, holiday, or court closure should not force the coach to rebuild the month. A single occurrence can close without deleting the repeating rule, while a permanent change updates future openings. The coach sees which dates were generated and which were edited. Families see the resulting truth: open, full, or unavailable, with no internal scheduling notes exposed. A closed occurrence leaves family search immediately, while an existing booking remains in the records of both sides. That state is definitive."],
      ["Capacity closes the door",
       "Every opening carries the number of athletes it can hold. Checkout claims a seat against that number, and the last available seat closes the slot. Two families cannot both take one remaining place merely because their screens were open at the same time. The database checks capacity again when the booking is written; the calendar display alone is never the safety mechanism. A temporary hold expires after failed payment, returning that seat without changing the coach's published rule."],
      ["Move the week without losing history",
       "Changing future availability does not rewrite a session that was already booked. The existing booking keeps its date, price, participants, and policy snapshot until the coach and family deliberately change or cancel it. That separation protects both sides: the coach can shape next week freely, while a parent can still prove what was agreed for the session already on the books. An agreed move creates a dated update and notification rather than silently altering the original promise."]
    ];
    var week = "<aside class='pg-hero-schedule' aria-label='Example published week'>" +
      "<div><span>TUE 04:00</span><b>2 openings</b></div><div><span>THU 05:30</span><b>full</b></div>" +
      "<div><span>SAT 09:00</span><b>4 openings</b></div><div><span>SUN</span><b>closed</b></div></aside>";
    return wrap("scheduling", "R1", "calendar-head-to-split-walk", "D-L-L", hero(meta,
      "Publish the hours. Families take <em>the real openings.</em>", intro,
      { tone: "dark", layout: "calendar", eyebrow: "COACH AVAILABILITY", aside: week }) +
      walkthroughSection(steps.slice(0, 2), { tone: "slate", layout: "walk-staggered" }) +
      walkthroughSection(steps.slice(2, 4), { tone: "white", layout: "walk-staggered", start: 2 }));
  }

  function mapPage(meta) {
    var argument = "A list can sort by distance, but it still makes a parent translate every address into a journey. The map starts with place. Each pin represents the location attached to an existing listing, and opening it keeps the coach, sport, ages, price, verification state, and available sessions together. Geography never upgrades an unbadged coach: the state remains readable, and verified-only removes that pin. A pin also cannot create availability the listing does not have. The parent can return without losing filters, and the coach corrects an address at its source. A moved session removes the old pin instead of leaving an attractive but false destination.";
    var rows = [
      ["Find the practical radius",
       "Read addresses one by one, estimate unfamiliar neighborhoods, and discover the drive only after opening several profiles. The comparison becomes driving homework for the family.",
       "See session locations together, begin with what is realistically close, and keep the stated distance beside every coach you inspect. Changing the radius updates the visible set without discarding the filters."],
      ["Understand one pin",
       "A marker often hides the useful facts, so the parent leaves the map and loses the place they were comparing. Backtracking makes promising options feel interchangeable.",
       "Opening a pin shows the named coach or program, sport, ages, price, check state, and next real opening without replacing the map. Closing it returns the parent to the same geographic comparison."],
      ["Narrow the visible set",
       "Filters rebuild a detached list, making it hard to tell whether fewer results are closer or simply elsewhere. The family cannot explain which choice removed which option.",
       "Sport, age, level, price, and format remove pins in place, so the family can see both the criteria and the geography that remain. An empty area stays empty instead of filling with distant substitutes."],
      ["Protect the booking",
       "A directory pin can point at a business even when the individual coach or the advertised time has not been verified. The marker looks current even when the offer behind it is not.",
       "The map keeps check state visible and offers the same verified-only filter as search. Location changes presentation, not authority: the server verifies provider safety and the chosen seat again before accepting the booking."]
    ];
    var table = "<section class='pgband dark pg-map-table' data-section='comparison-table' data-layout='dark-wide-table'><div class='shell pg-comparison-wrap'>" +
      "<table class='pg-comparison'><thead><tr><th>The job</th><th>Elsewhere</th><th>On Sporv</th></tr></thead><tbody>" +
      rows.map(function (row) {
        return "<tr><th scope='row' data-prose>" + row[0] + "</th><td data-prose>" +
          row[1] + "</td><td data-prose>" + row[2] + "</td></tr>";
      }).join("") + "</tbody></table></div></section>";
    return wrap("map-search", "R2", "offset-argument-to-dark-table", "L-L-D", hero(meta,
      "A list of coaches does not tell you <em>what a map does.</em>",
      "Distance is not a detail to check after choosing a coach. It decides whether a Tuesday lesson can become part of family life. Sporv puts real listing locations on the map first, then lets sport, age, level, price, format, and verified-only narrow what remains. Each pin keeps its current check state and available sessions visible rather than turning geography into an unsupported trust signal.",
      { tone: "white", layout: "map-corner", eyebrow: "LOCATION AS A DECISION" }) +
      "<section class='pgband slate pg-map-argument' data-section='argument' data-layout='offset-argument'><div class='shell'><p class='pg-argument' data-prose>" +
      argument + "</p></div></section>" + table);
  }

  function insightsPage(meta) {
    var argument = "Insights are useful only when the coach can tell measured account activity from an example. The current web build does not measure search impressions or profile views, so demand and funnel counts are seeded samples and carry that label. Price position is derived from comparable catalogue listings. Availability and return timing are computed from current schedule and booking records, while named client watchlists stay behind sign-in. A number should lead to a decision the coach understands. Sample evidence demonstrates the intended reading; it is never described as this coach's performance.";
    var rows = [
      ["Read local demand",
       "A coach guesses which sports, ages, or times families nearby want, usually from the messages loud enough to reach them. Quiet searches never enter that anecdotal picture.",
       "The current web demo groups seeded search figures by sport and labels them Sample data. It shows the intended demand comparison without presenting those counts as measured account activity. The coach can compare the example with published sports and hours, but the screen does not claim that a family actually ran those searches."],
      ["Follow the booking path",
       "Page views, inquiries, and bookings live in separate tools, leaving no reliable way to see where interest stopped. A large top-line count can hide an unusable checkout path.",
       "The funnel is a labeled sample 30-day window with appearances, profile views, checkout starts, and completed bookings. It demonstrates the stage-by-stage view; it does not claim those counts came from the signed-in coach. Real paid bookings remain separate from the sample funnel."],
      ["Position a price",
       "A broad internet average mixes formats, locations, and age groups, then presents the result as advice for one coach. The average sounds precise while its peers remain invisible.",
       "Price position compares relevant listings and names the comparison set. Sporv shows evidence; the coach keeps authority over the price they publish. No suggested figure edits the listing by itself."],
      ["Notice who did not return",
       "A spreadsheet becomes stale between sessions, and a quiet family disappears until the coach happens to remember them. Manual notes rarely distinguish a deliberate pause from forgotten follow-up.",
       "The watchlist uses real booking dates to identify a lapse, stays private to the signed-in coach, and never treats seeded sample families as outreach targets. It offers context, not an instruction to contact anyone."]
    ];
    var table = "<section class='pgband white pg-insights-table' data-section='comparison-table' data-layout='stacked-comparison'><div class='shell pg-comparison-wrap'>" +
      "<table class='pg-comparison'><thead><tr><th>The job</th><th>Elsewhere</th><th>On Sporv</th></tr></thead><tbody>" +
      rows.map(function (row) {
        return "<tr><th scope='row' data-prose>" + row[0] + "</th><td data-prose>" +
          row[1] + "</td><td data-prose>" + row[2] + "</td></tr>";
      }).join("") + "</tbody></table></div></section>";
    var snapshot = "<aside class='pg-hero-metrics' aria-label='Data provenance for the insights view'>" +
      "<div><strong>DEMO</strong><span>search demand and funnel figures</span></div>" +
      "<div><strong>LIVE</strong><span>bookings, availability, and client dates</span></div></aside>";
    return wrap("insights", "R2", "metric-head-to-argument-to-stacked-table", "D-L-L", hero(meta,
      "A dashboard number should explain <em>what changed.</em>",
      "Bookings, earnings, price position, availability, and returning clients can leave records as a coach works. Search demand and funnel activity do not yet: the current web build uses clearly labeled sample figures to demonstrate those views. Insights keeps derived account evidence separate from seeded examples, and the client watchlist stays private because business guidance never justifies exposing a family's history.",
      { tone: "dark", layout: "metrics", eyebrow: "COACH BUSINESS EVIDENCE", aside: snapshot }) +
      "<section class='pgband slate pg-insights-argument' data-section='argument' data-layout='narrow-right-argument'><div class='shell'><p class='pg-argument' data-prose>" +
      argument + "</p></div></section>" + table);
  }

  function instantBookingPage(meta) {
    var copy = [
      "Instant booking begins with supply the coach has already published. A family chooses a dated opening, sees the service, duration, location, capacity, and full price, then confirms the athlete who will attend. Nothing is sent as a vague request. The selected opening is held through checkout so the parent knows which session the payment is buying. The athlete is selected before payment, keeping age fit, family authority, and the coach's eventual roster aligned with the person who will actually arrive.",
      "Capacity is checked again when the booking is written. That second check matters when two families reach the last seat at nearly the same moment: one confirmed write can take it, and the other must choose another opening. A screen that merely looked open cannot override the stored count. Once full, the slot stops appearing as available. The coach sees confirmed capacity, not abandoned checkout attempts, and an expired hold returns to supply without requiring a manual calendar repair.",
      "Payment and the policy snapshot attach to the same booking record. The parent receives confirmation, the coach sees the athlete on the roster, and both sides can reopen the date, price, messages, receipt, and cancellation terms. If payment fails, the session is not presented as confirmed. A clean failure is safer than a booking that exists only in one person's inbox. A cancellation or agreed move updates this shared record rather than inventing a replacement in private messages. The change remains dated, attributed, and readable to both sides."
    ];
    var figure = "<figure class='pg-flat-figure'><div class='pg-mono-ui' aria-label='Sample open baseball session'>" +
      "<div class='pg-ui-head'><span>Grand Slam Baseball / Hitting Lab</span><span>Sample data</span></div>" +
      "<div class='pg-ui-row'><span class='pg-ui-key'>coach</span><span class='pg-ui-value'>Maya Rivera / background check cleared</span></div>" +
      "<div class='pg-ui-choice' aria-current='true'><span>Sat May 16 / 9:00 AM / 60 min</span><span>$45.00</span></div>" +
      "<div class='pg-ui-choice'><span>Sat May 16 / 10:30 AM / 60 min</span><span>$45.00</span></div>" +
      "<div class='pg-ui-row'><span class='pg-ui-key'>capacity</span><span class='pg-ui-value'>1 seat held while payment completes</span></div>" +
      "<div class='pg-ui-row'><span class='pg-ui-key'>result</span><span class='pg-ui-value'>confirmed only after the card succeeds</span></div>" +
      "</div><figcaption data-prose>This flat figure uses disclosed demo data to explain the record: a fictional coach, one dated opening, the complete price, capacity, and the rule that separates a temporary hold from a confirmed session. It also shows the parent what the coach will receive as a booked athlete, rather than hiding the operational result behind a decorative confirmation screen. Nothing here depends on a callback or manual acceptance after payment. The real interface follows the same sequence for every sport: choose published supply, hold one seat, take payment, write confirmation, and preserve capacity from the stored outcome.</figcaption></figure>";
    return wrap("instant-booking", "R4", "ticket-head-to-split-product", "L-L-D", hero(meta,
      "Choose the opening and leave with <em>a confirmed session.</em>",
      "A bookable time is not an invitation to start a text thread. It is a dated opening the coach published, with a service, duration, place, price, and seat count behind it. Sporv holds the selected seat while payment completes, checks capacity when the booking is written, and confirms only after the charge succeeds, so both sides leave the flow reading the same record.",
      { tone: "white", layout: "booking-ticket", eyebrow: "LIVE CAPACITY, PAID CONFIRMATION" }) +
      "<section class='pgband slate pg-instant-copy pg-split-copy' data-section='product-copy' data-layout='inverse-copy'><div class='shell'><div class='pg-r4-copy'><h2>The slot, charge, and rule travel together.</h2>" +
      copy.map(function (p) { return "<p data-prose>" + p + "</p>"; }).join("") +
      "</div></div></section>" +
      "<section class='pgband dark pg-instant-product pg-split-figure' data-section='product-figure' data-layout='inverse-copy-figure'><div class='shell'>" + figure + "</div></section>");
  }

  function athleteProgressPage(meta) {
    var copy = [
      "Progress begins with a session that happened. The coach records the focus, what changed, and what should come next against the athlete who attended. A goal can name a skill, distance, time, or other concrete target. The parent sees the same dated note and can read improvement without reconstructing it from messages sent across a season. The next session can reopen that context, so a stated follow-up becomes work to revisit rather than a compliment that disappears after delivery.",
      "The timeline belongs to the athlete's family account, not to one coach's private notebook. Training with another coach does not erase the earlier record, and a new note does not rewrite an older one. Each entry keeps its author and session context, so continuity never turns into anonymous advice. The family decides which athlete record a booking uses. That ownership also prevents a coach from merging two athletes because their names look similar; every entry follows the selected account and source booking.",
      "Numbers appear only when someone recorded a real measure. A personal best can show the baseline and later result; an ordinary practice can remain a written observation. Sporv does not turn every child into a leaderboard or infer medical conclusions from coaching notes. The rule is simple: show what was observed, preserve who wrote it, and keep the history with the athlete. Corrections create a visible update rather than silently improving an old result, and a missing measurement remains missing until someone actually records one."
    ];
    var figure = "<figure class='pg-flat-figure'><div class='pg-mono-ui' aria-label='Sample athlete progress timeline'>" +
      "<div class='pg-ui-head'><span>Avery / Sprint development</span><span>Sample data</span></div>" +
      "<div class='pg-ui-row'><span class='pg-ui-key'>APR 18</span><span class='pg-ui-value'>Baseline 100m / 14.4s / first timed run</span></div>" +
      "<div class='pg-ui-row'><span class='pg-ui-key'>MAY 02</span><span class='pg-ui-value'>Block starts / first three steps sharper</span></div>" +
      "<div class='pg-ui-row'><span class='pg-ui-key'>MAY 16</span><span class='pg-ui-value'>150m rep / held form through the turn</span></div>" +
      "<div class='pg-ui-row'><span class='pg-ui-key'>MAY 30</span><span class='pg-ui-value'>100m / 13.9s / new personal best</span></div>" +
      "</div><figcaption data-prose>This timeline uses disclosed demo data for a fictional athlete. It distinguishes measurement from observation, keeps every entry dated and attributed, and gives the next coach continuity without pretending that one number explains the whole athlete. Parents can read the change over time while the coach prepares the next session from the same evidence. A gap stays a gap; the interface does not manufacture progress for dates when nobody recorded an observation or result. In the real record, the family sees the author and source session for every line, while coach access follows the active coaching relationship instead of turning the timeline into a public profile.</figcaption></figure>";
    var change = "<aside class='pg-hero-progress' aria-label='Demonstration of dated progress'><span>APR 18</span><strong>14.4s</strong><span>MAY 30</span><strong>13.9s</strong></aside>";
    return wrap("athlete-progress", "R4", "progress-head-to-split-figure", "D-L-L", hero(meta,
      "The coach can change. <em>The record stays.</em>",
      "Session notes, goals, and measured results accumulate around the athlete who did the work. Parents can read what happened, what the coach noticed, and what comes next without keeping a parallel notebook. Because the record belongs to the athlete's account, changing coaches does not reset the season, while every entry still shows who wrote it and which session produced it.",
      { tone: "dark", layout: "progress", eyebrow: "ATHLETE-OWNED HISTORY", aside: change }) +
      "<section class='pgband slate pg-progress-product pg-split-copy' data-section='product-copy' data-layout='progress-copy'><div class='shell'><div class='pg-r4-copy'><h2>A dated account of work, not a score for childhood.</h2>" +
      copy.map(function (p) { return "<p data-prose>" + p + "</p>"; }).join("") +
      "</div></div></section>" +
      "<section class='pgband white pg-progress-product pg-split-figure' data-section='product-figure' data-layout='figure-first-record'><div class='shell'>" + figure + "</div></section>");
  }

  function rosterPage(meta) {
    var copy = [
      "A coach can begin with the families they already train instead of waiting for the first marketplace booking to make the product useful. Imported clients enter as roster records with the minimum contact and athlete context needed for the coach's work. New paid bookings then join the same roster automatically, avoiding a second list for clients who happened to arrive through Sporv. A likely duplicate is surfaced before creation, so an email variation does not quietly split one athlete's week across two operational histories.",
      "Opening an athlete connects the practical history: upcoming and completed sessions, notes, payment state, messages, and media-consent status. The coach does not have to match a nickname in a group text to a payer in a receipt export. Parents still control their own account and consent decisions. A roster link gives the coach working context; it does not transfer ownership of family data. The family sees its own athletes and bookings, while the coach sees only the relationships required to deliver and account for instruction.",
      "The roster is private to the signed-in coach or authorized organization member. Public visitors see listings, not client names, attendance, or notes. Sorting and search happen inside that protected view. When access to an athlete is no longer justified, removing the coaching relationship closes future operational access without rewriting completed booking and payment records that both sides may still need. Organization roles narrow who may open, import, or message roster entries; belonging to the business is not blanket permission to read every family's history."
    ];
    var figure = "<figure class='pg-flat-figure'><div class='pg-mono-ui' aria-label='Sample private client roster'>" +
      "<div class='pg-ui-head'><span>Hockey roster / private coach view</span><span>Sample data</span></div>" +
      "<table class='pg-roster-ui'><thead><tr><th>Athlete</th><th>Sessions</th><th>Last seen</th></tr></thead><tbody>" +
      "<tr><td>Cole S.</td><td>31</td><td>Yesterday</td></tr><tr><td>Mason B.</td><td>24</td><td>2 days</td></tr>" +
      "<tr><td>Ella T.</td><td>12</td><td>5 days</td></tr><tr><td>Ava L.</td><td>8</td><td>1 week</td></tr>" +
      "</tbody></table></div><figcaption data-prose>This table uses disclosed demo names and attendance counts to show the useful minimum at a glance. Names and attendance stay in the signed-in coach view; a public listing never inherits private roster data. Sorting the table changes order, not access, and every row opens the same athlete record rather than a copied profile for that coaching relationship. The real roster can also show a next session, an unfinished note, or missing consent as operational context, but those cues never turn private family information into catalogue content or a public ranking.</figcaption></figure>";
    return wrap("roster", "R4", "compact-head-to-split-roster", "D-L-L", hero(meta,
      "Every client becomes <em>one working record.</em>",
      "Bring the families you already coach, then let new bookings add themselves. The roster joins each athlete to sessions, notes, payment state, messages, and consent without making the coach rebuild those links in a spreadsheet. It is a private operations view: families keep their own accounts and permissions, while public visitors never see the names or histories a coach uses to run the week.",
      { tone: "dark", layout: "roster-index", eyebrow: "PRIVATE COACH OPERATIONS" }) +
      "<section class='pgband slate pg-roster-product pg-split-copy' data-section='product-copy' data-layout='roster-copy'><div class='shell pg-roster-grid'><div class='pg-r4-copy'><h2>The book of business, without the duplicate books.</h2>" +
      copy.map(function (p) { return "<p data-prose>" + p + "</p>"; }).join("") +
      "</div></div></section>" +
      "<section class='pgband white pg-roster-product pg-split-figure' data-section='product-figure' data-layout='wide-roster-first'><div class='shell'>" + figure + "</div></section>");
  }

  function whatIsPage(meta) {
    var cells = [
      ["Marketplace", "Families compare real services by sport, age, level, place, price, format, and dated availability. Coaches publish that supply themselves. An empty match stays empty; Sporv does not pad the catalogue with a coach who missed the request. Reopening a result reads its current record again."],
      ["Verification", "Every person who can accept a booking needs their own cleared background-check state. A company cannot lend its status to staff. A badge that stops being true stops showing, and new booking access stops with it. The named person remains the unit of trust."],
      ["Booking", "A parent chooses a published opening with duration, place, capacity, and full price attached. Checkout checks the remaining seat again before writing confirmation. A failed payment or a full session never becomes a polite fiction. Both sides leave with the same dated record."],
      ["Payments", "Families pay the listed service price without an added booking fee. Sporv takes zero percent of bookings, so gross and net payout match on the record. A refund keeps the original charge and adjustment visible. No transfer is reduced to an unexplained balance."],
      ["Messaging", "A question begins from a listing and remains attributed. If the family books, the same thread follows the dated session. Conversation can clarify fit or arrival; it cannot bypass verification, capacity, payment, or confirmation. Reporting stays separate from an ordinary reply."],
      ["Progress", "Dated notes, goals, and real measurements stay with the athlete account while retaining each coach's authorship. Parents can read the season without rebuilding it from screenshots, and changing coaches does not erase earlier work. A missing observation is never filled by inference."]
    ];
    var questions = [
      ["Who is Sporv for?", "Families use Sporv to find and manage youth-sports instruction. Independent coaches, trainers, camps, teams, and authorized organizations use the other side to publish supply and operate the sessions they sell."],
      ["What does it cost?", "Families pay the coach's listed price and no family booking fee. Coaches keep one hundred percent of booking revenue and run the software on a flat subscription — free to start, Pro at thirty-four ninety-nine a month."],
      ["When will it be near me?", "Search can only show supply that a real coach has published in the chosen area. Coverage grows coach by coach, so Sporv shows an honest empty result and keeps the criteria visible when a local match does not exist yet."]
    ];
    var cellCard = function (cell) {
      return "<article><h2>" + cell[0] + "</h2><p data-prose>" + cell[1] + "</p></article>";
    };
    return wrap("what-is", "B01", "manifesto-split-grid-claim-questions", "D-L-L-D-L", hero(meta,
      "Every sport. One app.",
      "Sporv is the shared operating record between a family and an independent youth-sports professional. Families discover a suitable service, ask questions, take an actual opening, pay, and keep the receipt. Coaches publish that supply, manage the athlete, write the follow-up, and receive the payout. Verification, consent, capacity, and policy rules decide what either side is allowed to see or do.",
      { tone: "dark", layout: "manifesto", eyebrow: "WHAT IS SPORV" }) +
      "<section class='pgband white pg-capability-section' data-section='capability-grid' data-layout='six-cell-border-grid'><div class='shell pg-capability-grid'>" +
      cells.slice(0, 3).map(cellCard).join("") + "</div></section>" +
      "<section class='pgband slate pg-capability-section' data-section='capability-grid' data-layout='six-cell-border-grid'><div class='shell pg-capability-grid'>" +
      cells.slice(3, 6).map(cellCard).join("") + "</div></section>" +
      "<section class='pgband dark pg-market-claim' data-section='market-claim' data-layout='claim-band'><div class='shell'><h2 class='pg-serif'>The gossip-and-cash economy, <em class='pg-accent-phrase'>replaced.</em></h2>" +
      "<p data-prose>One marketplace does not erase the difference between parent and coach. It gives both roles evidence they can name: the listing that was offered, the person who cleared the gate, the opening that was taken, the policy saved at purchase, the messages sent, and the money moved. Support can inspect that record instead of asking two people to reconstruct a season from memory.</p></div></section>" +
      "<section class='pgband white pg-what-questions' data-section='question-ledger' data-layout='three-question-close'><div class='shell'><dl class='pg-question-ledger'>" +
      questions.map(function (row) { return "<div class='pg-question-row'><dt>" + row[0] + "</dt><dd data-prose>" + row[1] + "</dd></div>"; }).join("") +
      "</dl></div></section>");
  }

  function bookingsPage(meta) {
    var prose = [
      "A booking starts with the coach, service, athlete, dated opening, duration, place, and price that were accepted at checkout. Sporv stores those facts together instead of leaving the parent to match a card charge with an email and a calendar event. The coach sees the same session on the roster. Messages about arrival, equipment, or a change remain attached to that context. Confirmation records when the booking was created and which account made it. If the family and coach agree to move the session, the updated time remains linked to the original purchase instead of becoming an orphaned calendar entry. Attendance or completion can be recorded later without rewriting what checkout originally promised.",
      "Payment creates an itemized receipt inside the booking. Families pay the coach's listed price with no added family booking fee, and the coach's payout is the full amount — Sporv takes zero percent of a booking, and nothing is quietly placed on the parent total. If a charge fails, the record cannot present the session as paid. If money is returned, the refund amount and status remain beside the original charge. The parent sees the paid total and payment state; the coach sees gross revenue and the matching expected payout. Those views describe the same transaction without exposing private payout-account details to the family. A receipt can be reopened from the session after the email is gone, and a processing state stays distinct from settled money.",
      "Cancellation uses the policy saved when the parent booked, not whatever the listing says later. The current flexible policy returns the paid amount when cancellation happens at least twenty-four hours before the session; inside that window, the saved terms decide the result. The calculation reads the time, amount paid, policy snapshot, and any earlier refund. No one types a convenient number over the record. When a coach cancels or a session does not happen, support can inspect the same record rather than guessing from competing screenshots. The family can see whether the refund is requested, processing, or completed, and the coach can see how that change affects the payout. A finished refund remains in history; it does not erase the original payment."
    ];
    var rail = "<aside class='pg-stat-rail' aria-label='Booking record rules'>" +
      "<div class='pg-rail-stat'><span class='pg-rail-value'>1</span><span class='pg-rail-label'>record for session, payment, messages, and refund</span></div>" +
      "<div class='pg-rail-stat'><span class='pg-rail-value'>$0</span><span class='pg-rail-label'>family booking fee added to the coach's listed price</span></div>" +
      "<div class='pg-rail-stat'><span class='pg-rail-value'>24h</span><span class='pg-rail-label'>current full-refund threshold, saved at purchase</span></div></aside>";
    var receipt = "<aside class='pg-hero-receipt' aria-label='Disclosed demo booking record'>" +
      "<div><span>BOOKING</span><b>#S-1842 / DEMO</b></div><div><span>SESSION</span><b>MAY 16 / 09:00</b></div>" +
      "<div><span>PAID</span><b>$45.00</b></div><div><span>REFUND RULE</span><b>24H SNAPSHOT</b></div></aside>";
    return wrap("bookings-receipts", "R3", "receipt-head-to-split-record", "L-L-L", hero(meta,
      "The session and its money stay <em>on one record.</em>",
      "Every booking keeps the coach, athlete, dated session, price, payment, messages, cancellation terms, receipt, and any refund together. A parent can reopen what was agreed without searching email, and a coach can read the same operational record. The policy is copied onto the booking at purchase, so later listing edits cannot change the terms that protect either side. The adjacent record uses disclosed demo values.",
      { tone: "white", layout: "receipt", eyebrow: "BOOKINGS AND RECEIPTS", aside: receipt }) +
      "<section class='pgband slate pg-booking-record' data-section='essay-stat' data-layout='horizontal-stat-record'><div class='shell'><div class='pg-essay'><h2>A receipt is part of the session history.</h2>" +
      prose.map(function (p) { return "<p data-prose>" + p + "</p>"; }).join("") +
      "</div></div></section>" +
      "<section class='pgband white pg-booking-record' data-section='stat-rail' data-layout='rail-record'><div class='shell'>" + rail + "</div></section>");
  }

  function paymentsPage(meta) {
    var prose = [
      "A family pays the price the coach published. Sporv does not add a family booking fee at checkout, and it does not take a percentage from the coach either. The paid booking records the gross service price, and the payout record shows that same amount reaching the coach. Keeping incidence explicit matters: the parent should not discover a surcharge at the last step, and the coach should not have to reverse-engineer what arrived. Tax or processor information, when applicable, is labeled separately, and no estimate is presented as a settled transfer.",
      "Sporv takes zero percent of the paid booking. The platform's revenue is the coach subscription — free to start, thirty-four ninety-nine a month for Pro — so the money a family pays for coaching is not the money that funds the software. The coach connects a payout account after the required onboarding and safety gates clear, and the full booking amount moves as one transfer. Payout state moves from pending to in transit to paid, so a balance never disappears behind a generic success message. A failed or paused transfer keeps its amount and status while the coach follows the remediation path; it does not masquerade as revenue that reached the bank. Bookings paid during the earlier flat-fee era keep the fee that was actually recorded on them; a historical receipt is never rewritten by a pricing change.",
      "Refunds preserve the same arithmetic. When money goes back under the saved cancellation policy, the refunded amount is the coach revenue being returned — there is no platform fee on the booking to unwind. On historical bookings that did record a fee, the matching portion of that fee is returned with the refund rather than kept on money the coach gave back. The original charge, refunded amount, remaining paid amount, and payout adjustment stay visible. That trail lets both sides distinguish a pending transfer from money that was actually deposited, and several partial adjustments still reconcile to the original booking instead of producing a second unexplained ledger entry."
    ];
    var rail = "<aside class='pg-stat-rail' aria-label='Worked payout example'>" +
      "<div class='pg-rail-stat'><span class='pg-rail-value'>$45.00</span><span class='pg-rail-label'>family pays the coach's listed lesson price</span></div>" +
      "<div class='pg-rail-stat'><span class='pg-rail-value'>−$0.00</span><span class='pg-rail-label'>zero percent of bookings taken by Sporv</span></div>" +
      "<div class='pg-rail-stat'><span class='pg-rail-value'>$45.00</span><span class='pg-rail-label'>coach net payout before any later refund</span></div></aside>";
    var worked = "<div class='pg-worked-math'><code>gross       $45.00\nfee      ×    .00\n-----------------\nplatform   −$0.00\ncoach net   $45.00</code>" +
      "<p data-prose>A forty-five-dollar lesson produces a forty-five-dollar coach payout. The same rule applies to every paid booking; there is no tier to infer, no percentage to reverse-engineer, and no separate invoice after the fact. The rail repeats those exact amounts in the transfer record the coach can reopen later. These are disclosed demo amounts, but the live calculation is written from the booking's stored gross value rather than copied from a marketing example, and a booking that recorded a fee in the earlier era keeps that recorded arithmetic on its own receipt.</p></div>";
    var formula = "<aside class='pg-hero-math' aria-label='Disclosed demo payout calculation'><code>$45.00\n×   .00\n────────\n− $0.00\n= $45.00</code><span>DEMO BOOKING</span></aside>";
    return wrap("payments", "R3", "math-head-to-split-ledger", "D-L-L", hero(meta,
      "The whole booking is <em>the coach's payout.</em>",
      "The parent's charge and the coach's payout are two views of the same paid booking. Families pay the coach's listed price without an added booking fee, and Sporv takes zero percent of it — the software is a flat subscription instead. The coach sees the exact gross and net amounts, equal, as the transfer moves. Refunds keep their own trail. The adjacent calculation uses disclosed demo values.",
      { tone: "dark", layout: "payout-math", eyebrow: "PAYMENTS AND PAYOUTS", aside: formula }) +
      "<section class='pgband slate pg-payment-ledger' data-section='essay-stat' data-layout='rail-first-essay'><div class='shell'><div class='pg-essay'><h2>The arithmetic should fit on four lines.</h2>" +
      prose.map(function (p) { return "<p data-prose>" + p + "</p>"; }).join("") + worked +
      "</div></div></section>" +
      "<section class='pgband white pg-payment-ledger' data-section='stat-rail' data-layout='rail-record'><div class='shell'>" + rail + "</div></section>");
  }

  function definitionSection(rows, options) {
    var o = options || {};
    return "<section class='pgband " + (o.tone || "white") + " " + (o.className || "") +
      "' data-section='definition-list' data-layout='" + (o.layout || "definition-rows") +
      "'><div class='shell'><dl class='pg-definition-list'>" +
      rows.map(function (row) {
        return "<div class='pg-definition-row'><dt>" + row[0] + "</dt><dd data-prose>" +
          row[1] + "</dd></div>";
      }).join("") + "</dl></div></section>";
  }

  function messagingPage(meta) {
    var blocks = [
      "A family can ask a background-checked coach about level, equipment, accessibility, timing, or fit before paying. The conversation stays inside the account instead of requiring a public phone number. The coach sees who is asking and which listing opened the thread, so an answer can refer to the actual service rather than a context-free message copied from another app. The family can leave without creating a second contact channel at all. Starting elsewhere does not earn a hidden advantage in search or booking.",
      "When the family books, the existing conversation remains connected to that booking. Arrival instructions, a promised accommodation, or a schedule clarification do not vanish behind a new thread. Both sides can read what was said before the session and continue from there. Sporv does not turn a message into a booking; payment, capacity, and confirmation still have to clear their own rules. Later messages keep that session context even when the calendar becomes busy. An agreed change remains conversation evidence until the booking record itself changes.",
      "Messaging also needs an exit. Either side can stop engaging, report a safety concern, or use the published support route when the issue is not ordinary scheduling. A coach cannot use access to a roster as permission to broadcast unrelated marketing. Keeping the thread attached, attributed, and reportable gives the product a record without pretending that software can replace judgment in an urgent situation. The safety route remains visible when an ordinary reply is not enough. If ordinary replies stop, the dated thread remains intact for both sides."
    ];
    var defs = [
      ["Listing thread", "The conversation starts from a real coach or program listing, so sport, service, sender, and the offer being discussed remain identifiable."],
      ["Booking context", "After checkout, the same thread carries the dated session instead of opening a disconnected replacement conversation with no purchase history."],
      ["Delivery record", "Sent messages remain attributed and ordered; a draft or failed send is not presented as delivered to the other side or quietly inserted later."],
      ["Safety route", "Reporting is separate from ordinary replies, preserves the relevant thread for review, and leaves emergencies with local emergency services rather than a marketplace inbox."]
    ];
    return wrap("messaging", "R5", "centered-question-to-three-column-essay", "L-D-L", hero(meta,
      "Ask first. Keep the answer <em>with the booking.</em>",
      "Parents can message a coach before money moves, using the listing as context and without publishing a personal phone number. If they book, the same thread follows the dated session instead of restarting. Messages remain attributed and ordered, while confirmation still depends on capacity and payment. A conversation can explain the service; it cannot quietly bypass the rules that decide whether a session exists.",
      { tone: "white", layout: "message-question", eyebrow: "MESSAGING" }) +
      "<section class='pgband dark pg-dark-essay pg-message-essay' data-section='dark-essay' data-layout='three-column-dark-essay'><div class='shell'><h2>Conversation is part of the record.</h2><div class='pg-dark-copy'>" +
      blocks.map(function (p) { return "<p data-prose data-dark-block>" + p + "</p>"; }).join("") +
      "</div></div></section>" + definitionSection(defs, { tone: "slate", layout: "definition-index", className: "pg-message-defs" }));
  }

  function sessionNotesPage(meta) {
    var blocks = [
      "The coach writes a note against a completed or scheduled session and selects the athlete it describes. The note can record the drill, observation, adjustment, and next focus in the coach's own words. A draft remains on the coach side until it is sent. Sporv does not label unfinished text as a parent update, because writing something and delivering it are different product states. That distinction stays visible in the coach's queue. Autosave protects the draft without changing who can read it.",
      "Sending creates the family-facing copy inside the athlete's record. The parent sees which coach wrote it and which session produced it, rather than receiving a floating paragraph with no date. The coach can review written notes and see which sessions still need one. Private operational details do not belong in the shared note; the field is for a useful account of the athlete's work. Delivery state stays visible after the page is reopened. A failed send stays failed until delivery actually succeeds.",
      "Over time, sent notes become the narrative layer of athlete progress. Measurements can sit beside them, but a time or count never replaces the coach's observation. A later coach can understand what was tried while every entry keeps its author. The rule protects continuity without laundering opinion into fact: old notes persist as dated statements, and a new note never edits their history. The parent can always see that order for themselves. Corrections remain dated rather than silently replacing the original account."
    ];
    var defs = [
      ["Draft", "Text visible to the coach while it is still being written; the family has not received it, and autosave never changes that boundary."],
      ["Sent note", "A dated, attributed update delivered to the athlete's family, attached to the source session, and kept in its original order."],
      ["Needs a note", "A private queue built from session records, helping the coach find completed work that has no written update yet without exposing a family reminder publicly."],
      ["Progress timeline", "The athlete-level sequence of sent observations and real measurements, preserved across sessions and coaches while every entry keeps its author."]
    ];
    return wrap("session-notes", "R5", "margin-head-to-numbered-dark-notes", "L-D-L", hero(meta,
      "Write once. Send a note that <em>keeps its context.</em>",
      "A session note names the athlete, the session, what the coach observed, and what should happen next. Coaches can keep a draft, send it to the parent, and see which completed sessions still need an update. Once sent, the note joins the athlete's progress record with its author and date, so useful continuity does not depend on a loose notebook or a screenshot.",
      { tone: "slate", layout: "note-margin", eyebrow: "SESSION NOTES" }) +
      "<section class='pgband dark pg-dark-essay pg-note-essay' data-section='dark-essay' data-layout='numbered-note-sequence'><div class='shell'><h2>A note has a source and a destination.</h2><div class='pg-dark-copy'>" +
      blocks.map(function (p, index) { return "<article><span>0" + (index + 1) + "</span><p data-prose data-dark-block>" + p + "</p></article>"; }).join("") +
      "</div></div></section>" + definitionSection(defs, { layout: "two-column-definitions", className: "pg-note-defs" }));
  }

  function questionSection(rows, options) {
    var o = options || {};
    return "<section class='pgband " + (o.tone || "white") + " " + (o.className || "") +
      "' data-section='question-ledger' data-layout='" + (o.layout || "question-rows") +
      "'><div class='shell'><dl class='pg-question-ledger'>" +
      rows.map(function (row) {
        return "<div class='pg-question-row'><dt>" + row[0] + "</dt><dd data-prose>" +
          row[1] + "</dd></div>";
      }).join("") + "</dl></div></section>";
  }

  function backgroundChecksPage(meta) {
    var steps = [
      ["Invite the person", "The coach receives the screening request in their own name and supplies the identity information and consent the independent vendor requires. A company administrator may begin the invitation, but cannot complete or inherit the check for the person who will coach."],
      ["Run the vendor check", "The screening vendor compares the submitted identity against the sources included in its service. Sporv receives a state from that process; the coach cannot type a result, design a badge, or approve themselves from the listing editor."],
      ["Review the result", "A returned result can require operational review before it becomes a product state. Review resolves identity or record questions without turning urgency into clearance. Pending means pending, even when a coach has clients waiting or a business owner asks to publish early."],
      ["Show a dated badge", "A cleared state makes the named coach eligible for the badge and for bookable supply, subject to the other listing gates. The visible state belongs to that person and date. It never spreads across colleagues, locations, or an organization logo."],
      ["Re-check the current truth", "The product reads the stored state again when a booking is written. If clearance expires, changes, or is withdrawn, the badge stops showing and the server closes new booking access. An old link or saved coach cannot preserve a safety claim that is no longer true."]
    ];
    var questions = [
      ["Does a club's check cover its coaches?", "No. Every person who can appear as bookable needs their own stored cleared state. Organization membership changes administration, not the identity that was screened or the date attached to that result."],
      ["Can a pending coach take a booking?", "No. Pending coaches can appear without a badge when verified-only is off. Verified-only removes them. If a family reaches booking from an old result or link, the server reads the current provider state and refuses the booking until the required check is complete."],
      ["What does the parent see?", "The family sees the named coach and current verification state beside the service. They should report any mismatch between that person and the person who arrives, because the badge cannot travel to a substitute."],
      ["What happens to earlier bookings?", "Historical records keep what was booked and when for support and review. They do not restore the coach's right to accept another booking after the safety state changes or make an expired badge current again."]
    ];
    return wrap("background-checks", "B02", "threshold-head-split-walk-honesty-questions", "D-L-L-D-L", hero(meta,
      "The check is <em>per person.</em>",
      "Every coach who can accept a booking must have their own cleared background-check record. A club cannot extend its standing to an unchecked staff member, and a coach cannot set the badge themselves. Sporv shows the current state on the listing and reads it again when a booking is written. If clearance stops being true, the badge and access to new bookings stop with it.",
      { tone: "dark", layout: "check-threshold", eyebrow: "HOW BACKGROUND CHECKS WORK" }) +
      walkthroughSection(steps.slice(0, 3), { tone: "white", layout: "walk-five" }) +
      walkthroughSection(steps.slice(3, 5), { tone: "slate", layout: "walk-five", start: 3 }) +
      "<section class='pgband dark pg-check-honesty' data-section='honesty-panel' data-layout='two-paragraph-honesty'><div class='shell'><h2>What a check cannot promise</h2><div>" +
      "<p data-prose>A cleared result is an enforced screening gate, not a guarantee of personality, coaching quality, fit, or every future action. Families should still read the service, ask questions, and decide whether the named professional suits their athlete.</p>" +
      "<p data-prose>Screening also cannot replace immediate judgment. A parent who sees a different person arrive, unsafe conduct, or an urgent risk should leave the situation and use the appropriate emergency or support route. The badge records a check; it does not ask anyone to ignore new evidence.</p></div></section>" +
      questionSection(questions, { layout: "compact-parent-questions", className: "pg-check-questions" }));
  }

  function mediaConsentPage(meta) {
    var questions = [
      ["Who can grant consent?",
       "A parent or authorized family account grants consent for the athlete. A coach can request it and explain the intended use, but cannot approve the request on the family's behalf. Organization membership does not change that boundary. The product records who granted the decision and when, so an unchecked box in a coach workflow never becomes permission by implication. A request can expire unanswered without becoming a yes."],
      ["What exactly receives permission?",
       "Consent is tied to the athlete and the allowed use presented to the family, such as private sharing with tagged families or eligibility for a public profile. The coach tags the athletes shown in an asset before sharing it. When several children appear, each child's state matters. One parent's yes cannot cover another family's athlete in the same photo or clip. A different use requires its own stated permission."],
      ["What does the coach see before consent?",
       "The coach sees that permission is missing or awaiting a family decision. The blocked asset cannot be marked shareable with that athlete or published as though the decision existed. This is a product gate, not a reminder beside an active button. Private storage for review is different from permission to distribute, and the interface keeps those states separate. The blocked reason remains readable beside the action."],
      ["What happens after a parent revokes it?",
       "The athlete's permission changes immediately for future sharing, and affected media loses the shareable state inside Sporv. Revocation cannot pull back a file another person already saved outside the service, so the product does not make that impossible promise. Families can use the support and safety routes when a copy remains somewhere it should not. The decision history records when future use closed."],
      ["Can consent be assumed from a booking?",
       "No. Paying for coaching, attending a session, joining a team, or accepting ordinary service terms does not silently grant media permission. The booking can establish who attended and which family controls the athlete record; consent remains a separate choice. A missing decision stays missing until the family acts, and the coach sees a locked state rather than a default yes. Repeated attendance never weakens that separation."]
    ];
    return wrap("media-consent", "R6", "consent-head-to-split-ledger", "D-L-L", hero(meta,
      "A child's image moves only after <em>the parent's yes.</em>",
      "Photos and clips are useful for feedback, but a booking is not media consent. The family decides for each athlete, the product records that decision, and the coach sees a locked state until permission exists. Sharing checks every tagged child rather than trusting a blanket team waiver. When consent is revoked, future sharing closes; the interface does not keep treating an old yes as current.",
      { tone: "dark", layout: "consent-line", eyebrow: "MEDIA AND CONSENT" }) +
      questionSection(questions.slice(0, 3), { tone: "slate", layout: "staggered-consent-ledger", className: "pg-consent-questions" }) +
      questionSection(questions.slice(3, 5), { tone: "white", layout: "staggered-consent-ledger", className: "pg-consent-questions" }));
  }

  /* ── For organizations: the Enterprise ($149/mo, in development) showcase ──
     Honesty law: Enterprise is not purchasable. Each page frames the tier as
     in development / early access, uses pageCTA(meta) → the pricing tab (no
     checkout), and labels every demo card "Sample · Enterprise in development".
     No live metric is stated as real; sample figures carry that label. */

  function enterprisePage(meta) {
    var argument = "A growing academy rarely fails for lack of effort. It fails because the roster lives in one app, payments in another, waivers in a drawer, and background checks in someone's inbox, so the same family gets re-entered four times and no one number can be trusted. Enterprise is designed to hold those in a single organization record: staff, athletes, programs, locations, money, and compliance reading from one source. The design goal is one place a director can trust, not another dashboard to reconcile by hand every week.";
    var rows = [
      ["Onboard the organization",
       "A new academy stitches together a booking site, a spreadsheet of families, a separate payments login, and a group chat, then re-enters the same people into each one before it can teach a single lesson.",
       "The intended flow imports staff and existing families once, into a single organization with owner, admin, director, head-coach, assistant, and front-desk roles. This onboarding module is in development and shown here as a labelled sample."],
      ["Give people the right access",
       "Access is all-or-nothing: everyone shares one login, so a front-desk hire can open the payout account and any coach can edit another team's roster without anyone deciding they should.",
       "The design scopes each role to what it needs. A front-desk account books and checks people in, a director sees a location, and only an owner or admin reaches org-wide money. These permissions are the plan, not a live guarantee yet."],
      ["Run more than one location",
       "Each site becomes its own detached account, so the head office cannot compare two gyms without exporting and merging spreadsheets by hand at the end of every month.",
       "Multi-location is designed so programs, staff, and schedules belong to a named site while the organization reads across all of them at once. Coverage would grow site by site; this sample only shows the intended structure."],
      ["See the whole business at once",
       "A weekly picture means opening four tools and hoping the totals agree, which they rarely do once refunds, no-shows, and split pay are counted against each other.",
       "The org dashboard is designed to summarise staff, active athletes, live programs, and a compliance score from the same records that run bookings. Every figure shown on this page is sample data while Enterprise is in development."]
    ];
    // Real org figures for a signed-in org admin (from the same live hydration
    // as the compliance board); guests see the full labelled sample. Only the two
    // figures we truly have (staff count, clearance %) go live — athlete/program
    // counts have no live source yet, so the real board drops them rather than
    // show a number it cannot back (honesty law).
    var ocO = (typeof window !== "undefined") ? window.SporveOrgCompliance : null;
    var board;
    if (ocO && ocO.total) {
      board = "<aside class='pg-hero-orgboard' aria-label='Your organization dashboard'>" +
        "<div class='pg-board-top'><span>ACADEMY OS</span><span>Live · your organization</span></div>" +
        "<div><span>Staff</span><b>" + ocO.total + "</b></div>" +
        "<div><span>Cleared</span><b>" + ocO.cleared + " of " + ocO.total + "</b></div>" +
        "<div><span>Compliance</span><b>" + Math.round((ocO.cleared / ocO.total) * 100) + "%</b></div></aside>";
    } else {
      board = "<aside class='pg-hero-orgboard' aria-label='Sample organization dashboard'>" +
        "<div class='pg-board-top'><span>ACADEMY OS</span><span>Sample · Enterprise in development</span></div>" +
        "<div><span>Staff</span><b>18</b></div><div><span>Active athletes</span><b>240</b></div>" +
        "<div><span>Programs</span><b>12</b></div><div><span>Compliance</span><b>92%</b></div></aside>";
    }
    var table = "<section class='pgband white pg-enterprise-table' data-section='comparison-table' data-layout='org-ledger'><div class='shell pg-comparison-wrap'>" +
      "<table class='pg-comparison'><thead><tr><th>The job</th><th>Elsewhere</th><th>On Sporv</th></tr></thead><tbody>" +
      rows.map(function (row) {
        return "<tr><th scope='row' data-prose>" + row[0] + "</th><td data-prose>" + row[1] +
          "</td><td data-prose>" + row[2] + "</td></tr>";
      }).join("") + "</tbody></table></div></section>";
    return wrap("enterprise", "R2", "org-overview-slate-argument-comparison", "L-L-L", hero(meta,
      "One organization. <em>One operating record.</em>",
      "Sporv Enterprise is the multi-player workspace an academy would run its whole operation on: many coaches, teams, and families under one organization instead of a dozen disconnected tools. It is in development and available by early access only, so every screen below is a labelled sample of the intended design rather than a live feature anyone can buy today.",
      { tone: "white", layout: "org-overview", eyebrow: "ENTERPRISE · IN DEVELOPMENT", aside: board }) +
      "<section class='pgband slate pg-enterprise-argument' data-section='argument' data-layout='org-argument'><div class='shell'><p class='pg-argument' data-prose>" +
      argument + "</p></div></section>" + table);
  }

  function enterpriseRosterPage(meta) {
    var copy = [
      "The family side of the roster is designed around households, not loose contacts. A guardian record links to one or more athletes, so a parent with three children in three sports is one relationship rather than three duplicated entries. Medical notes, allergies, and emergency contacts attach to the athlete but sit behind a permission gate: a front-desk account can check a child in without reading their health history, while only the roles a director approves can open it. Waivers and consent are captured once and travel with the athlete instead of living on paper.",
      "The staff side is designed to make hiring legible. Each coach, assistant, and front-desk member is a person with a role, the locations they work, and their own background-check status, shown as clear, pending, or expired. A pending hire is never quietly treated as cleared to get through a busy week; the design fails closed, keeping an unverified person out of bookable supply. Smart groups can gather staff or athletes by sport, site, or age so a director messages exactly the right people without rebuilding a distribution list by hand every single time.",
      "Because the roster is one organization record, a family is never re-entered when it moves between coaches inside the same academy, and a departing staff member's future access closes without erasing the completed sessions and payments both sides may still need. Guardians keep control of their own account and consent decisions; the organization sees the operational relationships required to deliver instruction, not a licence to read every family's private history. All of this is the intended design, presented as a labelled sample while Enterprise remains in development rather than a live product."
    ];
    var figure = "<figure class='pg-flat-figure'><div class='pg-mono-ui' aria-label='Sample organization staff roster'>" +
      "<div class='pg-ui-head'><span>Staff roster · Riverside Academy</span><span>Sample · Enterprise in development</span></div>" +
      "<table class='pg-staff-ui'><thead><tr><th>Name</th><th>Role</th><th>Check</th></tr></thead><tbody>" +
      "<tr><td>Dana Whitfield</td><td><span class='pg-role'>Director</span></td><td class='pg-ck pg-ck-clear'>Clear</td></tr>" +
      "<tr><td>Marcus Ellery</td><td><span class='pg-role'>Head coach</span></td><td class='pg-ck pg-ck-clear'>Clear</td></tr>" +
      "<tr><td>Priya Nadkarni</td><td><span class='pg-role'>Assistant</span></td><td class='pg-ck pg-ck-pending'>Pending</td></tr>" +
      "<tr><td>Tom Boyer</td><td><span class='pg-role'>Front desk</span></td><td class='pg-ck pg-ck-expired'>Expired</td></tr>" +
      "</tbody></table></div><figcaption data-prose>This flat figure uses disclosed demo names to show the intended roster: each hire carries a role and their own background-check state, and a pending or expired check keeps that person out of bookable supply rather than being rounded up to cleared. Enterprise is in development, so these are sample rows, not live staff records.</figcaption></figure>";
    return wrap("enterprise-roster", "R4", "roster-import-to-split-figure", "D-L-L", hero(meta,
      "Every household and every hire, <em>on one roster.</em>",
      "Enterprise roster is designed to hold the two lists an academy actually runs on: the families it serves and the staff it employs. Guardians link to athletes, sensitive medical and emergency details stay permission-gated, and every staff member carries their own background-check state. It is in development and shown here as a labelled sample, not a live system anyone operates yet.",
      { tone: "dark", layout: "roster-columns", eyebrow: "ENTERPRISE · IN DEVELOPMENT" }) +
      "<section class='pgband slate pg-enterprise-roster-figure pg-split-copy' data-section='product-copy' data-layout='household-copy'><div class='shell'><div class='pg-r4-copy'><h2>Two lists, one household-aware record.</h2>" +
      copy.map(function (p) { return "<p data-prose>" + p + "</p>"; }).join("") +
      "</div></div></section>" +
      "<section class='pgband white pg-enterprise-roster-figure pg-split-figure' data-section='product-figure' data-layout='household-and-staff'><div class='shell'>" + figure + "</div></section>");
  }

  function enterpriseFinancePage(meta) {
    var prose = [
      "At one coach, payment is simple: the family pays the listed price and the whole amount reaches the coach. An academy adds a layer the design has to handle honestly, because the person who taught the session may not be the person who owns the payout account. Enterprise is designed so a booking can carry a revenue split: a head coach and an assistant, or a coach and the organization, each see the agreed share on the same record instead of settling up by side transfer after the fact every month.",
      "The split divides the coach revenue; it does not hide a marketplace cut. Sporv takes zero percent of a booking under this model, because the platform is funded by a flat software subscription rather than a percentage of what families pay for coaching. So the gross a family pays and the total that reaches the staff still match, and the split only decides how that same amount is shared between named people. A director can read gross, each share, and the net payout without reverse-engineering a booking fee that is not there.",
      "Recurring memberships and invoicing are designed to sit beside single bookings, so a season pass, a monthly training plan, and a one-off clinic all land in one financial view rather than three exports. The dashboard's job is to show where money came from, which coach earned which share, and what is pending versus settled, read from the same records that run the schedule. Everything on this page is the intended design shown as a labelled sample; Enterprise is in development, and no figure here is a real transaction anyone was paid."
    ];
    var worked = "<div class='pg-worked-math'><code>gross        $90.00\nhead coach   × .60    $54.00\nassistant    × .40    $36.00\nplatform     −$0.00\n------------------------\nstaff total           $90.00</code>" +
      "<p data-prose>A ninety-dollar session split sixty-forty between a head coach and an assistant pays fifty-four and thirty-six, and the two shares add back to the full ninety because Sporv takes nothing from the booking itself. These are disclosed demo amounts; the live calculation would read each share from the booking's stored gross rather than from a marketing example on a page.</p></div>";
    var rail = "<aside class='pg-stat-rail' aria-label='Sample consolidated payout'>" +
      "<div class='pg-rail-stat'><span class='pg-rail-value'>$90.00</span><span class='pg-rail-label'>family pays the listed session price · sample</span></div>" +
      "<div class='pg-rail-stat'><span class='pg-rail-value'>−$0.00</span><span class='pg-rail-label'>zero percent of bookings taken by Sporv</span></div>" +
      "<div class='pg-rail-stat'><span class='pg-rail-value'>$90.00</span><span class='pg-rail-label'>shared across the assigned staff · sample</span></div></aside>";
    var comp = "<aside class='pg-hero-comp' aria-label='Sample staff compensation summary'>" +
      "<div class='pg-comp-top'><span>THIS MONTH</span><span>Sample · in development</span></div>" +
      "<div><span>Marcus E. · head coach</span><b>$2,140</b></div><div><span>Priya N. · assistant</span><b>$860</b></div>" +
      "<div><span>Org share · programs</span><b>$1,020</b></div></aside>";
    return wrap("enterprise-finance", "R3", "org-payout-split-essay-rail", "D-L-L", hero(meta,
      "Pay the whole staff, <em>from one ledger.</em>",
      "Enterprise finance is designed for the academy that pays many coaches, not one. Consolidated payouts, per-coach revenue splits, recurring memberships, and a single financial view sit on the booking records families already pay into. Sporv still takes zero percent of a booking — the platform earns a flat software subscription — and every figure here is a labelled sample while the module is in development.",
      { tone: "dark", layout: "comp-summary", eyebrow: "ENTERPRISE · IN DEVELOPMENT", aside: comp }) +
      "<section class='pgband slate pg-enterprise-ledger' data-section='essay-stat' data-layout='comp-essay'><div class='shell'><div class='pg-essay'><h2>One amount, shared between named people.</h2>" +
      prose.map(function (p) { return "<p data-prose>" + p + "</p>"; }).join("") + worked +
      "</div></div></section>" +
      "<section class='pgband white pg-enterprise-ledger' data-section='stat-rail' data-layout='rail-record'><div class='shell'>" + rail + "</div></section>");
  }

  function enterpriseCompliancePage(meta) {
    var questions = [
      ["How does a check get run for a whole staff?",
       "Each staff member is screened as an individual through an independent consumer reporting agency — the model here is a vendor such as Checkr. The organization can invite and track the check, but it never marks itself cleared. Sporv stores the state that comes back, and a director cannot type a result or grant a badge from an admin screen. This is the intended design, shown as a labelled sample while Enterprise is in development."],
      ["What does the compliance dashboard show?",
       "The board is designed to list every staff member with their current check state, certification status, and waiver status, each tied to a date rather than a vague yes. A director can see at a glance who is clear, whose check is pending, and whose clearance has expired and needs a re-run. The sample board on this page shows pending as pending; it does not round an unfinished check up to cleared to make the screen look complete."],
      ["Can a pending or expired coach still be booked?",
       "No. The design fails closed: an unverified person is kept out of bookable supply, and the server re-reads provider safety when a booking is written, so an old link cannot grant access a current record no longer supports. This mirrors the single-coach rule the live marketplace already enforces. Enterprise extends that same gate across an organization's whole staff rather than trusting the business to police itself."],
      ["What do parents see?",
       "Enterprise is designed to give families the same trust surface they get for an independent coach: the named person who will run the session and that person's current verification state, not a company logo standing in for an individual. A badge that stops being true stops showing. Parents should report any mismatch between the person listed and the person who arrives, because clearance never travels to a substitute."],
      ["How does this handle minors and COPPA?",
       "Athlete records describe children, so the design keeps sensitive data permission-gated, keeps media consent a separate parent decision, and limits which roles can open a child's information. The organization holding a booking does not become an owner of the family's data. These COPPA-minded boundaries are the intended posture; Enterprise is in development, and this page is a labelled sample rather than a live compliance system."]
    ];
    // Enterprise slice 1: a signed-in org admin sees their org's REAL clearance
    // board (from live organization_members, RLS-scoped, fail-closed); everyone
    // else sees the labelled sample. window.* is the only channel to the host.
    var oc = (typeof window !== "undefined") ? window.SporveOrgCompliance : null;
    var escP = function (s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    };
    var prettyRole = function (r) {
      return escP(String(r || "Staff").replace(/[_-]+/g, " ").replace(/\b\w/g, function (m) { return m.toUpperCase(); }));
    };
    var board;
    if (oc && oc.total) {
      var badge = function (m) {
        if (m.state === "clear") return "<b class='pg-cbd pg-cbd-clear'>Clear</b>";
        if (m.state === "expiring") return "<b class='pg-cbd pg-cbd-pending'>Expiring" + (m.daysLeft != null ? " · " + m.daysLeft + "d" : "") + "</b>";
        if (m.state === "expired") return "<b class='pg-cbd pg-cbd-expired'>Expired</b>";
        if (m.state === "pending") return "<b class='pg-cbd pg-cbd-pending'>Pending</b>";
        return "<b class='pg-cbd pg-cbd-pending'>Not cleared</b>";
      };
      var headClass = oc.cleared === oc.total ? "pg-cbd-clear" : "pg-cbd-pending";
      var attention = (oc.expiring || 0) + (oc.expired || 0);
      var sc = (typeof window !== "undefined") ? window.SporveStaffCerts : null;
      var certLine = (sc && sc.total)
        ? "<div><span>Certs / waivers</span><b class='pg-cbd " +
            (sc.expired ? "pg-cbd-expired" : (sc.expiring ? "pg-cbd-pending" : "pg-cbd-clear")) + "'>" +
            sc.current + " current" + (sc.expiring ? " · " + sc.expiring + " exp." : "") +
            (sc.expired ? " · " + sc.expired + " expired" : "") + "</b></div>"
        : "";
      board = "<aside class='pg-hero-compliance' aria-label='Your organization compliance board'>" +
        "<div class='pg-board-top'><span>COMPLIANCE BOARD</span><span>Live · your organization</span></div>" +
        "<div><span>Adults cleared</span><b class='pg-cbd " + headClass + "'>" + oc.cleared + " of " + oc.total + "</b></div>" +
        (attention ? "<div><span>Re-run needed</span><b class='pg-cbd pg-cbd-expired'>" + attention + "</b></div>" : "") +
        certLine +
        oc.rows.slice(0, 8).map(function (m) {
          return "<div><span>" + prettyRole(m.role) + "</span>" + badge(m) + "</div>";
        }).join("") + "</aside>";
    } else {
      board = "<aside class='pg-hero-compliance' aria-label='Sample organization compliance board'>" +
        "<div class='pg-board-top'><span>COMPLIANCE BOARD</span><span>Sample · in development</span></div>" +
        "<div><span>Dana W. · director</span><b class='pg-cbd pg-cbd-clear'>Clear</b></div>" +
        "<div><span>Marcus E. · head coach</span><b class='pg-cbd pg-cbd-clear'>Clear</b></div>" +
        "<div><span>Priya N. · assistant</span><b class='pg-cbd pg-cbd-pending'>Pending</b></div>" +
        "<div><span>Tom B. · front desk</span><b class='pg-cbd pg-cbd-expired'>Expired</b></div></aside>";
    }
    // Slice 6 write path — a signed-in org admin can RECORD a staff cert. It is
    // stored as 'pending'; the DB rejects a client trying to set 'verified' (only
    // a vendor/attestation process can), so a director can't self-clear anyone.
    var kinds = [["cpr", "CPR"], ["first_aid", "First Aid"], ["safesport", "SafeSport"],
                 ["concussion", "Concussion"], ["waiver", "Waiver"], ["other", "Other"]];
    var certForm = (oc && oc.total && oc.orgId) ? (
      "<section class='pgband white pg-certform-band'><div class='shell'>" +
      "<h2>Record a certification</h2>" +
      "<p class='pg-certform-note'>Saved as <b>pending</b> — a verification step confirms it. You can record a cert or waiver; you cannot mark it cleared yourself.</p>" +
      "<div class='pg-certform' data-certform>" +
      "<select data-cert-member aria-label='Staff member'>" +
        oc.rows.filter(function (m) { return m.memberId; }).map(function (m) {
          return "<option value='" + escP(m.memberId) + "'>" + prettyRole(m.role) + " · " + escP(String(m.memberId).slice(0, 4)) + "</option>";
        }).join("") +
      "</select>" +
      "<select data-cert-kind aria-label='Certification'>" +
        kinds.map(function (k) { return "<option value='" + k[0] + "'>" + k[1] + "</option>"; }).join("") +
      "</select>" +
      "<input type='date' data-cert-expiry aria-label='Expiry date'>" +
      "<button type='button' class='btn' data-certsave data-org='" + escP(oc.orgId) + "'>Record</button>" +
      "</div></div></section>"
    ) : "";
    return wrap("enterprise-compliance", "R6", "compliance-board-to-split-ledger", "D-L-L", hero(meta,
      "Trust that <em>fails closed.</em>",
      "Enterprise compliance is designed to run the trust layer for a whole staff at once: each person's background check orchestrated through an independent vendor, every certificate and waiver tracked to a date, and a single board showing who is clear, pending, or expired. The rule the whole company is built on holds here — an unverified person cannot take a booking. It is in development and shown as a labelled sample.",
      { tone: "dark", layout: "compliance-board", eyebrow: "ENTERPRISE · IN DEVELOPMENT", aside: board }) +
      certForm +
      questionSection(questions.slice(0, 3), { tone: "slate", layout: "org-compliance-ledger", className: "pg-compliance-questions" }) +
      questionSection(questions.slice(3, 5), { tone: "white", layout: "org-compliance-ledger", className: "pg-compliance-questions" }));
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
    if (id === "enterprise") return enterprisePage(meta);
    if (id === "enterprise-roster") return enterpriseRosterPage(meta);
    if (id === "enterprise-finance") return enterpriseFinancePage(meta);
    if (id === "enterprise-compliance") return enterpriseCompliancePage(meta);
    return "";
  }

  window.SporvProductPages = {
    ids: IDS.slice(),
    has: function (id) { return IDS.indexOf(id) !== -1; },
    render: render
  };
})();
