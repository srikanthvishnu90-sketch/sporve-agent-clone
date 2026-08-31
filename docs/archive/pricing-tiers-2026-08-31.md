# Pricing tier cards retired 2026-08-31 (owner: one money claim — 2.9%+30c transactional)
Billing edge fns (billing-create-checkout/portal) stay deployed; only the page section retired.

```js
    ${(()=>{
      const CK=`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>`;
      const CARDS=[
        {id:"free",name:"Free",price:"$0",per:"",
         desc:"For a coach just getting started.",
         feats:["Browse checked coaches, free","List your services, no fee","Verified badge — one-time add-on to reach parents · planned","3 AI actions a month","0% taken from bookings"],
         cta:"Start free"},
        {id:"pro",name:"Pro",price:"$34.99",per:"/mo",rec:true,
         desc:"For a private trainer or solo coach.",
         feats:["Verified badge — background check included · planned","Unlimited AI actions — drafts, recaps & parent updates","Roster, schedule, session notes & messaging","Automatic payouts","Up to 3 seats","0% taken from bookings"],
         cta:"Start coaching"},
        {id:"grow",name:"Grow",price:"$99.99",per:"/mo",
         desc:"For a growing training business.",
         feats:["5× AI usage — recaps, progress reports & campaigns","Up to 10 staff seats with roles","Group sessions, camps & clinic pages · planned","Retention & revenue analytics · planned","0% taken from bookings"],
         cta:"Talk to us"},
        {id:"enterprise",name:"Enterprise",price:"Custom",per:"",dev:true,
         desc:"For a club, AAU team, or academy.",
         feats:["Unlimited coach & staff seats","Roles & granular permissions","Per-staff background-check gating","Compliance dashboard — certs & waivers","Consolidated org billing · planned"],
         cta:"Talk to team"},
      ];
      const feat=f=>{const i=f.indexOf(" · planned");return i<0?esc(f):esc(f.slice(0,i))+`<em class="pt-planned"> · planned</em>`;};
      return `<section class="pp-plans" aria-label="Plans">${CARDS.map(t=>{
        const rec=!!t.rec;
        return `<div class="pp-card${rec?" pp-rec":""}">
          ${rec?`<span class="pp-badge">Recommended</span>`:""}
          <h3 class="pp-name">${esc(t.name)}</h3>
          <div class="pp-price"><b>${esc(t.price)}</b>${t.per?`<span>${esc(t.per)}</span>`:""}</div>
          <p class="pp-desc">${esc(t.desc)}</p>
          <ul class="pp-feats">${t.feats.map(f=>`<li>${CK}<span>${feat(f)}</span></li>`).join("")}</ul>
          <button class="${rec?"btn pp-cta":"pp-cta pp-cta-alt"}" data-planbuy="${t.id}">${esc(t.cta)}</button>
          ${t.dev?`<p class="pp-dev">In development — early access only</p>`:""}
        </div>`;
      }).join("")}</section>`;
    })()}
```
