# Landing sections removed 2026-08-30 (owner: keep landing, remove demo-scroll + company rail)

## 1. Pinned scrollytelling demo (was landingHTML, after peekRow) — re-add verbatim:
```html

  ${/* THE ONE pinned scrollytelling showcase (anti-slop: exactly one on the site).
       300vh track + a sticky 100vh stage; a single rAF handler in wireLanding()
       writes --p (0->1) and three eased state opacities (--s1/2/3) that CSS reads.
       Scroll-LINKED, never scroll-jacked: nothing moves the scroll. Degrades to
       three stacked static blocks with no js-rev (reduced-motion / no-JS) — the
       CSS default IS the readable end state. CSS-composed product mocks, no
       screenshots (none exist; the CSP would force base64 into a 2.2MB file). */""}
  <section class="scrolly" data-scrolly aria-label="How Sporv works for coaches">
    <div class="scrolly-pin"><div class="shell scrolly-in">
      <div class="scrolly-device" aria-hidden="true">
        <div class="dframe">
          <div class="dscreen ds1">
            <div class="dsc-top">Sporv AI</div>
            <div class="dsc-bubble">Here's a parent-friendly recap for Nia — edit or send.</div>
            <div class="dsc-card">
              <p class="dsc-draft">"Hi — quick update from today. Nia's weak-foot passing is really coming along, and the effort was there start to finish."</p>
              <div class="dsc-acts"><span class="dsc-btn">Approve &amp; send</span><span class="dsc-btn ghost">Edit</span></div>
            </div>
          </div>
          <div class="dscreen ds2">
            <div class="dsc-top">Today</div>
            <div class="dsc-line"><b>4:30 · Shooting · Ava R.</b><span class="dsc-pill on">Present</span></div>
            <div class="dsc-line"><b>6:00 · U12 group</b><span class="dsc-pill">3 of 4</span></div>
            <div class="dsc-line"><b>7:15 · Maya K.</b><span class="dsc-pill off">Absent</span></div>
          </div>
          <div class="dscreen ds3">
            <div class="dsc-top">Earnings</div>
            <div class="dsc-big num">$1,260</div>
            <div class="dsc-subt">Month to date · next payout Friday</div>
            <div class="dsc-line"><span>Paid out</span><em class="num">$980</em></div>
            <div class="dsc-line"><span>In transit</span><em class="num">$280</em></div>
          </div>
        </div>
        <div class="srail" aria-hidden="true"><i></i><i></i><i></i></div>
      </div>
      <div class="scrolly-copy">
        <div class="snarr sn1"><h2>Draft a parent update in a sentence.</h2>
          <p>The assistant writes a warm, clear recap any parent understands. You approve — it sends.</p></div>
        <div class="snarr sn2"><h2>Take attendance as you coach.</h2>
          <p>Mark who showed in a tap. It flows into your notes and the family's view — no clipboard.</p></div>
        <div class="snarr sn3"><h2>Watch the money land.</h2>
          <p>Every booking pays out on its own. See what's cleared, what's in transit, and your next payout.</p></div>
      </div>
    </div></div>
  </section>
```

## 2. Company/marketplace rail call (peekRowHTML stays defined in host, only the call removed):
```
  ${peekRowHTML()}
```

The .scrolly CSS (~4312-4360) and wireLanding()'s [data-scrolly] handler stay in place (both are no-ops without the section).

## EXACT removed block (lines 8251-8295 at removal time):
```html
  ${/* THE ONE pinned scrollytelling showcase (anti-slop: exactly one on the site).
       300vh track + a sticky 100vh stage; a single rAF handler in wireLanding()
       writes --p (0->1) and three eased state opacities (--s1/2/3) that CSS reads.
       Scroll-LINKED, never scroll-jacked: nothing moves the scroll. Degrades to
       three stacked static blocks with no js-rev (reduced-motion / no-JS) — the
       CSS default IS the readable end state. CSS-composed product mocks, no
       screenshots (none exist; the CSP would force base64 into a 2.2MB file). */""}
  <section class="scrolly" data-scrolly aria-label="How Sporv works for coaches">
    <div class="scrolly-pin"><div class="shell scrolly-in">
      <div class="scrolly-device" aria-hidden="true">
        <div class="dframe">
          <div class="dscreen ds1">
            <div class="dsc-top">Sporv AI</div>
            <div class="dsc-bubble">Here's a parent-friendly recap for Nia — edit or send.</div>
            <div class="dsc-card">
              <p class="dsc-draft">"Hi — quick update from today. Nia's weak-foot passing is really coming along, and the effort was there start to finish."</p>
              <div class="dsc-acts"><span class="dsc-btn">Approve &amp; send</span><span class="dsc-btn ghost">Edit</span></div>
            </div>
          </div>
          <div class="dscreen ds2">
            <div class="dsc-top">Today</div>
            <div class="dsc-line"><b>4:30 · Shooting · Ava R.</b><span class="dsc-pill on">Present</span></div>
            <div class="dsc-line"><b>6:00 · U12 group</b><span class="dsc-pill">3 of 4</span></div>
            <div class="dsc-line"><b>7:15 · Maya K.</b><span class="dsc-pill off">Absent</span></div>
          </div>
          <div class="dscreen ds3">
            <div class="dsc-top">Earnings</div>
            <div class="dsc-big num">$1,260</div>
            <div class="dsc-subt">Month to date · next payout Friday</div>
            <div class="dsc-line"><span>Paid out</span><em class="num">$980</em></div>
            <div class="dsc-line"><span>In transit</span><em class="num">$280</em></div>
          </div>
        </div>
        <div class="srail" aria-hidden="true"><i></i><i></i><i></i></div>
      </div>
      <div class="scrolly-copy">
        <div class="snarr sn1"><h2>Draft a parent update in a sentence.</h2>
          <p>The assistant writes a warm, clear recap any parent understands. You approve — it sends.</p></div>
        <div class="snarr sn2"><h2>Take attendance as you coach.</h2>
          <p>Mark who showed in a tap. It flows into your notes and the family's view — no clipboard.</p></div>
        <div class="snarr sn3"><h2>Watch the money land.</h2>
          <p>Every booking pays out on its own. See what's cleared, what's in transit, and your next payout.</p></div>
      </div>
    </div></div>
  </section>
```

## 3. Family middle sections deleted 2026-08-30 (owner: landing = hero + B2B only). Re-add verbatim:
```html
  <section class="band alt">
    <div class="shell" data-rev>
      <h2>What changes with Sporv</h2>
      <div class="cmp-wrap" style="margin-top:18px">
        <table class="cmp" aria-label="Finding a coach, compared">
          <thead><tr><th>The job</th><th>Elsewhere</th><th>On Sporv</th></tr></thead>
          <tbody>
            <tr><th scope="row">Finding a coach</th>
              <td>Group-chat threads, a flyer at the gym, a friend of a friend.</td>
              <td>Browse every coach free. Search by sport, your child's age, and budget.</td></tr>
            <tr><th scope="row">Knowing who you're hiring</th>
              <td>A business vouches for its own staff.</td>
              <td>Each person clears their own background check before they can take a booking.</td></tr>
            <tr><th scope="row">Booking and paying</th>
              <td>Texts until a time sticks, then cash or Venmo.</td>
              <td>A real open slot that holds while you pay. Sessions, receipts and messages in one thread.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <section class="band dark">
    <div class="shell lgrid">
      <div data-rev>
        <div class="eyebrow" style="color:var(--accent-on-dark)">What's on Sporv today</div>
        <h2 style="margin-top:12px">The rules every listing runs on.</h2>
        <p class="sub" style="margin-top:14px">
          The catalogue below is sample inventory, shown so you can see how Sporv
          works — every demo card is labelled. Real coaches are onboarding now, and
          these are the rules they clear before a listing goes live.</p>
        <div class="lchecks">
          ${[["Per-person background checks, not business-level"],
             ["Reviews open only after a completed session"],
             ["A child profile needs recorded parental consent"]]
            .map(([t])=>`<div class="lcheck"><i>${TICK(12,3.4)}</i><span>${esc(t)}</span></div>`).join("")}
        </div>
      </div>
      ${/* B2, not a card: the figures sit bare on the dark ground, hairline
           -separated. The card chrome (.lcard bg/border) is stripped in CSS —
           a stat row is only credible when it is not dressed up. */""}
      <div class="lcard bare" data-rev data-rev-d="1">
        <div class="lstats">
          <div class="lstat"><span>Programs</span><b class="num">${f.programs}</b></div>
          <div class="lstat"><span>Sports</span><b class="num">${f.sports}</b></div>
          <div class="lstat"><span>Businesses</span><b class="num">${f.bizCount}</b></div>
        </div>
        <div class="lrow"><span>Background-checked businesses</span>
          <em>${f.verifiedCount} of ${f.bizCount}</em></div>
        <div class="lrow"><span>Sessions start from</span><em>${money(f.minPrice)}</em></div>
      </div>
    </div>
  </section>

  <section class="band">
    <div class="shell" data-rev>
      <h2>What you get, and how it starts</h2>
      <div class="deflist">
        ${[["Background checks, per person","An unverified coach cannot take a booking. Not policy copy — the booking system refuses it."],
           ["Search in plain words","Describe the goal; matching covers age, level, budget and distance."],
           ["One thread per athlete","Sessions, receipts, and coach updates stay together."],
           ["Message before you commit","Ask about equipment, group size, or experience before you spend anything."]]
          .map(([t,d])=>`<div class="defrow"><b>${esc(t)}</b><p>${esc(d)}</p></div>`).join("")}
        ${[["Search","Tell us the sport, your kid's age, and your budget."],
           ["Book","Pick a real open slot and pay in one flow — cancellation terms shown before you commit."],
           ["Show up","Directions, coach contact, notes and receipts land in the thread."]]
          .map(([t,d],i)=>`<div class="defrow"><b><span class="defnum num">0${i+1}</span>${esc(t)}</b><p>${esc(d)}</p></div>`).join("")}
      </div>
    </div>
  </section>

```
