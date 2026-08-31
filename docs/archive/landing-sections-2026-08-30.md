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
