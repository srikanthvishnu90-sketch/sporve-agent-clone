# Marketplace teardown notes — reasoning preserved from deleted code (2026-08-31)

Everything below was extracted before deletion; full source lives at tag `pre-pivot-2026-08`.

## From mod-productpages.js
```
/* MOD_PRODUCTPAGES — the fourteen assigned, text-first product pages.
   The host owns navigation and the small real-UI artifacts. This module owns
   page composition and prose so each recipe can be inspected as rendered DOM. */
(function () {
  "use strict";

  var IDS = [
    "what-is", "background-checks",
    /* "search" and "map-search" removed (spec 01 + owner 2026-08-31: keep the
--
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

--
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
```

## The header contract (verbatim)
```
/* MOD_PRODUCTPAGES — the fourteen assigned, text-first product pages.
   The host owns navigation and the small real-UI artifacts. This module owns
   page composition and prose so each recipe can be inspected as rendered DOM. */
(function () {
  "use strict";

  var IDS = [
    "what-is", "background-checks",
    /* "search" and "map-search" removed (spec 01 + owner 2026-08-31: keep the
       product pages, delete only content that doesn't relate to what we're
       building — parent-side discovery is exactly that). Bodies archived via
       tag pre-pivot-2026-08. */
    "instant-booking", "messaging",
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
```
