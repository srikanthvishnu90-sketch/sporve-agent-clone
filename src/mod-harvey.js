"use strict";
/* ═══════════════════════════════════════════════════════════════════
   MOD_HARVEY — the coach-app visual layer (owner decision 2026-10-21).

   Owner, 2026-10-21: "harvey's design for their product is genuinely
   brilliant ... help me find the adjustments to make the website look like
   harveys", then "rebuild it rn". This REVERSES CONTEXT.md §7 for the coach
   product: Archivo-uppercase-on-near-black is replaced by Harvey's register:

     - warm off-white canvas, white cards, hairline borders, near-black ink
     - a dark left rail (and top bar) framing a light working area
     - an editorial serif (Newsreader) for page titles and big numbers only
     - sentence case everywhere; no uppercase tracking-heavy labels
     - one black primary button; everything else quiet

   Every functional rule is unchanged: no emoji, no decorative icons, honest
   empty states, draft-first. This file only restyles. It is injected LAST
   and re-appended whenever another module injects its own <style>, so it
   wins the cascade without !important wars in the other modules.
   ═══════════════════════════════════════════════════════════════════ */
(function(){

const CSS = `
/* ── Tokens ─────────────────────────────────────────────────────── */
html #app.coachdark,html body.reg-coach{
  --hv-canvas:#F7F6F2;--hv-surface:#FFFFFF;--hv-sunk:#F1EFEA;
  --hv-ink:#161616;--hv-ink-2:#3B3A37;--hv-muted:#66655F;
  --hv-rule:#E6E3DD;--hv-rule-2:#D6D3CC;
  --hv-rail:#111111;--hv-rail-2:#1C1C1C;--hv-rail-3:#2A2A2A;
  --hv-rail-ink:#EDEDEA;--hv-rail-muted:#A3A39E;
  --hv-good:#2F6F47;--hv-good-tint:#E8F1EA;
  --hv-attn:#2C557E;--hv-attn-tint:#E9EFF5;
  --hv-warn:#7A5B0E;--hv-warn-tint:#F6F0DF;
  --hv-danger:#A3352A;--hv-danger-tint:#F8E9E6;
  --hv-serif:"Newsreader",Georgia,"Times New Roman",serif;
  --hv-sans:"Archivo",system-ui,-apple-system,"Segoe UI",sans-serif;
  --hv-r:8px;--hv-r-card:12px;
}

/* ── Frame: dark top bar + dark rail around a light working area ──── */
html body.reg-coach,html #app.coachdark,html #app.coachdark .dash,html #app.coachdark .dash>div{background:var(--hv-canvas)!important}
html #app.coachdark .coachtop{display:none}
html body.reg-coach header.topbar{background:var(--hv-rail);border-bottom:1px solid var(--hv-rail-2);box-shadow:none}
html #app.coachdark header.topbar .btn:not(.ghost),html body.reg-coach header.topbar .btn:not(.ghost){background:#FFFFFF;color:var(--hv-ink);
  text-transform:none;letter-spacing:0;font-weight:600;border-radius:var(--hv-r)}
html #app.coachdark header.topbar .navlink,html body.reg-coach header.topbar .navlink{color:var(--hv-rail-ink);text-transform:none;letter-spacing:0}

html #app.coachdark .dash{
  --paper:var(--hv-canvas);--raise:var(--hv-surface);--raise2:var(--hv-sunk);
  --ink:var(--hv-ink);--ink-2:var(--hv-ink-2);--muted:var(--hv-muted);--faint:var(--hv-muted);
  --rule:var(--hv-rule);--rule-strong:var(--hv-rule-2);
  --slate:var(--hv-attn);--slate-ink:var(--hv-attn);--slate-deep:var(--hv-attn);
  --slate-tint:var(--hv-attn-tint);--slate-ring:rgba(44,85,126,.25);
  --accent:var(--hv-ink);--accent-ink:var(--hv-ink);--accent-tint:var(--hv-sunk);
  --good:var(--hv-good);--good-tint:var(--hv-good-tint);
  --warn:var(--hv-warn);--warn-tint:var(--hv-warn-tint);
  --gold-ink:var(--hv-warn);--gold-tint:var(--hv-warn-tint);
  --danger:var(--hv-danger);
  --panel:var(--hv-surface);--panel-2:var(--hv-sunk);--line:var(--hv-rule);--line-2:var(--hv-rule-2);
  --shadow:0 1px 2px rgba(22,22,22,.04);--shadow-lift:0 8px 24px -12px rgba(22,22,22,.18);
  background:var(--hv-canvas);color:var(--hv-ink);font-family:var(--hv-sans);
}
html #app.coachdark .dash,html #app.coachdark .dash>div:not(.rail){color:var(--hv-ink)!important}
html #app.coachdark .dash *{text-transform:none!important}
html #app.coachdark .dash :is(h1,h2,h3,h4,b,strong,label,button,.btn,.pill){letter-spacing:0!important}

/* Rail — Harvey's sidebar: near-black, quiet, sentence case. */
html #app.coachdark .dash>.rail{
  --ink:var(--hv-rail-ink);--ink-2:var(--hv-rail-ink);--muted:var(--hv-rail-muted);--faint:var(--hv-rail-muted);
  --rule:var(--hv-rail-2);--rule-strong:var(--hv-rail-3);
  background:var(--hv-rail);color:var(--hv-rail-ink);border-right:0}
html #app.coachdark .dash>.rail .railmark{font-family:var(--hv-serif);font-size:26px;font-weight:400;
  color:#FFFFFF;letter-spacing:-.01em;padding:4px 12px 14px}
html #app.coachdark .dash>.rail .railgroup{color:var(--hv-rail-muted);font-weight:500;font-size:14px;margin-top:18px}
html #app.coachdark .dash>.rail button{color:var(--hv-rail-ink);font-size:15px;font-weight:400;border-radius:var(--hv-r)}
html #app.coachdark .dash>.rail button:hover{background:var(--hv-rail-2)}
html #app.coachdark .dash>.rail button.on{background:var(--hv-rail-3);color:#FFFFFF;box-shadow:none}
html #app.coachdark .dash>.rail button.on::before{display:none}
html #app.coachdark .dash>.rail svg{color:var(--hv-rail-muted);opacity:1}
html #app.coachdark .dash>.rail button.on svg{color:#FFFFFF}
html #app.coachdark .dash>.rail .raildiv{background:var(--hv-rail-2)}
html #app.coachdark .dash>.rail .railhead{color:var(--hv-rail-ink)}
html #app.coachdark .dash .avatar{background:#3A3A3A!important;color:#FFFFFF!important}
html #app.coachdark .dash>.rail .avatar{background:#3A3A3A;color:#FFFFFF}
html #app.coachdark .dash>.rail .rbadge{background:#2F2F2F;color:#FFFFFF}
html #app.coachdark .dash>.rail .gsbar{background:var(--hv-rail-3)}
html #app.coachdark .dash>.rail .gsbar i{background:#FFFFFF}
html #app.coachdark .dash>.rail .railmenu{background:var(--hv-rail-2);border:1px solid var(--hv-rail-3)}

/* ── Type ───────────────────────────────────────────────────────── */
html #app.coachdark .dash>:not(.rail) h1,
html #app.coachdark .cui-page .cui-h1{
  font-family:var(--hv-serif)!important;font-weight:400!important;font-size:clamp(28px,2.6vw,36px)!important;
  line-height:1.12!important;letter-spacing:-.015em!important;color:var(--hv-ink)!important;
  font-stretch:100%!important;margin:0 0 8px}
html #app.coachdark .dash>:not(.rail) :is(h2,h3,h4){
  font-family:var(--hv-sans)!important;font-weight:600!important;font-stretch:100%!important;
  color:var(--hv-ink);line-height:1.3}
html #app.coachdark .dash>:not(.rail) h2{font-size:18px!important}
html #app.coachdark .dash>:not(.rail) :is(h3,h4){font-size:16px!important}
html #app.coachdark .dash p{color:inherit}
html #app.coachdark .dash .sub,html #app.coachdark .dash small{color:var(--hv-muted)}
/* Eyebrows ("Coach dashboard", "Business") repeat the rail. Harvey has none. */
html #app.coachdark .cui-eyebrow,html #app.coachdark .dash .eyebrow,html #app.coachdark .dash .kicker{display:none!important}

/* ── Buttons: one black primary, quiet secondaries ─────────────── */
html #app.coachdark .dash :is(.btn,.cui-button){
  font-family:var(--hv-sans)!important;font-weight:600!important;font-size:14px!important;font-stretch:100%!important;
  border-radius:var(--hv-r)!important;box-shadow:none!important}
html #app.coachdark .dash .btn:not(.ghost),
html #app.coachdark .dash .cui-button--primary{background:var(--hv-ink)!important;color:#FFFFFF!important;border:1px solid var(--hv-ink)!important}
html #app.coachdark .dash .btn:not(.ghost):hover,
html #app.coachdark .dash .cui-button--primary:hover{background:#333331!important}
html #app.coachdark .dash .btn.ghost,
html #app.coachdark .dash .cui-button--secondary{background:var(--hv-surface)!important;color:var(--hv-ink)!important;border:1px solid var(--hv-rule-2)!important}
html #app.coachdark .dash .btn.ghost:hover,
html #app.coachdark .dash .cui-button--secondary:hover{background:var(--hv-sunk)!important}

/* ── Surfaces ───────────────────────────────────────────────────── */
html #app.coachdark .dash :is(.panel,.card,.qcard,.cw-card,.gs2,.statcard,.box){
  background:var(--hv-surface);border:1px solid var(--hv-rule);border-radius:var(--hv-r-card);box-shadow:none;color:var(--hv-ink)}
html #app.coachdark .dash input:not([type=checkbox]):not([type=radio]),
html #app.coachdark .dash select,html #app.coachdark .dash textarea{
  background:var(--hv-surface)!important;color:var(--hv-ink)!important;border:1px solid var(--hv-rule-2)!important;
  border-radius:var(--hv-r)!important;font-family:var(--hv-sans);font-stretch:100%}
html #app.coachdark .dash input::placeholder,html #app.coachdark .dash textarea::placeholder{color:#8C8B85}
html #app.coachdark .dash :is(input,select,textarea):focus{outline:2px solid var(--hv-ink)!important;outline-offset:1px;border-color:var(--hv-ink)!important}
/* Native time/date fields were clipped ("08:00 Al"): give them their width. */
html #app.coachdark .dash input[type=time]{min-width:128px}
html #app.coachdark .dash input[type=date]{min-width:156px}
html #app.coachdark .dash .pill{border-radius:999px;font-weight:500;font-size:13.5px;background:var(--hv-sunk);color:var(--hv-ink-2);border:0}
html #app.coachdark .dash .pill.warn{background:var(--hv-attn-tint);color:var(--hv-attn)}
html #app.coachdark .dash .pill.good{background:var(--hv-good-tint);color:var(--hv-good)}
html #app.coachdark .previewbar{background:var(--hv-surface);border:1px solid var(--hv-rule);color:var(--hv-muted)}
html #app.coachdark .previewbar b,html #app.coachdark .previewbar-acts .navlink{color:var(--hv-ink)}

/* Settings / Connect cards (.stcard) and their segmented controls */
html #app.coachdark .dash .stcard{background:var(--hv-surface);border:1px solid var(--hv-rule);border-radius:var(--hv-r-card)}
html #app.coachdark .dash .strow{border-color:var(--hv-rule)}
html #app.coachdark .dash .strail button{color:var(--hv-muted);border-radius:var(--hv-r)}
html #app.coachdark .dash .strail button:hover{color:var(--hv-ink);background:var(--hv-sunk)}
html #app.coachdark .dash .strail button.on,html #app.coachdark .dash .strail button[aria-current]{background:var(--hv-surface);color:var(--hv-ink);
  box-shadow:inset 0 0 0 1px var(--hv-rule)}

/* Literal light-on-dark colours left in older rules (found by a rendered
   contrast audit across every coach tab): remap to the light ground. */
html #app.coachdark .dash :is(.sec-head p,.sthead p,.panel>p,.empty p,.stfoot,.stmut,.qcard-why){color:var(--hv-muted)!important}
html #app.coachdark .dash :is(.cxr-l b,.stlab b,.sthead h2,.sthead h3,.ob2gh b,.stsec){color:var(--hv-ink)!important}
html #app.coachdark .dash .co-row{background:var(--hv-surface)!important;border-color:var(--hv-rule)!important;color:var(--hv-ink)!important}
html #app.coachdark .dash :is(.co-opt span,.co-opt b,.sec-head .num){color:var(--hv-ink-2)!important}
html #app.coachdark .dash :is(.field label,.stat .k){color:var(--hv-ink-2)!important}
html #app.coachdark .dash :is(.stat .d,.co-lede){color:var(--hv-muted)!important}
html #app.coachdark .dash .stat .v{color:var(--hv-ink)!important}
html #app.coachdark .dash .pill{color:var(--hv-ink-2)!important}
html #app.coachdark .dash .panel{background:var(--hv-surface)!important;color:var(--hv-ink)}
html #app.coachdark .dash .ob2gh .num{color:var(--hv-muted)!important}
html #app.coachdark .dash .strail .stsec{color:var(--hv-muted)!important;font-weight:500}
html #app.coachdark .dash :is(.stseg,.stdays) button{color:var(--hv-muted)!important}
html #app.coachdark .dash :is(.stseg,.stdays) button:is(.on,[aria-pressed=true],[aria-checked=true]){background:var(--hv-ink)!important;color:#FFFFFF!important}

/* Segmented controls (Inbox Direct/Groups, Session-notes panels) */
html #app.coachdark .dash :is(.seg2,.nt-seg){background:var(--hv-sunk)!important;border:1px solid var(--hv-rule)!important;box-shadow:none!important}
html #app.coachdark .dash :is(.seg2,.nt-seg) button{color:var(--hv-muted)!important;background:transparent!important}
html #app.coachdark .dash :is(.seg2,.nt-seg) button.on{background:var(--hv-surface)!important;color:var(--hv-ink)!important;
  box-shadow:0 1px 2px rgba(22,22,22,.08)!important}

/* Inbox */
html #app.coachdark .dash .msg-wrap{background:var(--hv-surface);border:1px solid var(--hv-rule);border-radius:var(--hv-r-card);overflow:hidden}
html #app.coachdark .dash .msg-list{background:var(--hv-surface)!important;border-right:1px solid var(--hv-rule)!important}
html #app.coachdark .dash .msg-list :is(button,.conv,.mrow){color:var(--hv-ink)}
html #app.coachdark .dash .msg-list :is(button,.conv,.mrow).on{background:var(--hv-sunk)!important}
html #app.coachdark .dash .msg-thread,html #app.coachdark .dash .msg-compose{background:var(--hv-surface)!important;border-color:var(--hv-rule)!important}
html #app.coachdark .dash .msg-wrap b{color:var(--hv-ink)!important}
html #app.coachdark .dash :is(.msg-sub,.nt-filter label){color:var(--hv-muted)!important}
html #app.coachdark .dash .bub.them{background:var(--hv-sunk)!important;color:var(--hv-ink)!important}
html #app.coachdark .dash .bub.me{background:var(--hv-ink)!important;color:#FFFFFF!important}

/* Session notes: its hero band and stats sit on the light ground */
html #app.coachdark .dash .band,html #app.coachdark .dash .band.alt{background:transparent!important;color:var(--hv-ink)!important}
html #app.coachdark .dash .band .shell{max-width:none;padding:0 40px}
html #app.coachdark .dash .nt-lede{color:var(--hv-muted)!important}
html #app.coachdark .dash .nt-stats{border-color:var(--hv-rule)!important}
html #app.coachdark .dash .nt-stat span{color:var(--hv-muted)!important;font-size:14px}
html #app.coachdark .dash .nt-stat b{font-family:var(--hv-serif)!important;font-weight:400!important;font-size:30px;color:var(--hv-ink)!important}
html #app.coachdark .dash .nt-blank{border-color:var(--hv-rule-2)!important;color:var(--hv-muted)!important;background:var(--hv-surface)}

/* Guest lock ("Sign in to see this") renders outside the dash shell. */
html #app.coachdark>.sec-head{padding:40px 40px 0;max-width:880px;margin:0 auto}
html #app.coachdark>.sec-head h1{font-family:var(--hv-serif)!important;font-weight:400!important;font-size:36px!important;
  text-transform:none!important;letter-spacing:-.015em!important;color:var(--hv-ink)!important;font-stretch:100%!important}
html #app.coachdark>.empty{max-width:800px;margin:24px auto 0!important;padding:48px 32px;background:var(--hv-surface);
  border:1px solid var(--hv-rule);border-radius:var(--hv-r-card);color:var(--hv-muted)}
html #app.coachdark>.empty h3{font-family:var(--hv-sans)!important;font-weight:600!important;font-size:18px!important;
  text-transform:none!important;letter-spacing:0!important;color:var(--hv-ink)!important}
html #app.coachdark>.empty .btn{background:var(--hv-ink)!important;color:#FFFFFF!important;text-transform:none!important;
  letter-spacing:0!important;border-radius:var(--hv-r)!important;font-weight:600}

/* ── Shared coach components (MOD_COACHUI) ──────────────────────── */
html #app.coachdark .cui-page,html #app.coachdark .cui-drawer,.cui-drawer{
  --cui-bg:var(--hv-canvas);--cui-panel:var(--hv-surface);--cui-panel-2:var(--hv-sunk);
  --cui-line:var(--hv-rule);--cui-line-2:var(--hv-rule-2);--cui-ink:var(--hv-ink);
  --cui-ink-2:var(--hv-ink-2);--cui-ink-3:var(--hv-muted);--cui-steel:var(--hv-ink);
  --cui-good:var(--hv-good);--cui-warn:var(--hv-warn);
  --fs-body:15px;--fs-eyebrow:14px;--fs-fine:14px;
  color-scheme:light;font-family:var(--hv-sans)}
html #app.coachdark .cui-header{padding:36px 40px 0;background:var(--hv-canvas)}
html #app.coachdark .cui-lede{font-size:15px;color:var(--hv-muted);max-width:62ch}
html #app.coachdark .cui-tabs{background:rgba(247,246,242,.96);padding:0 40px;margin-top:20px}
html #app.coachdark .cui-tab{font-size:14px;font-weight:500;color:var(--hv-muted)}
html #app.coachdark .cui-tab:hover{color:var(--hv-ink)}
html #app.coachdark .cui-tab.on{color:var(--hv-ink);border-color:var(--hv-ink)}
html #app.coachdark .cui-count{background:var(--hv-sunk);color:var(--hv-muted)}
html #app.coachdark .cui-block__title{font-family:var(--hv-sans)!important;font-size:16px!important;font-weight:600!important;color:var(--hv-ink)}
html #app.coachdark .cui-block__subtitle{font-size:14px;color:var(--hv-muted)}
html #app.coachdark .cui-card{background:var(--hv-surface);border:1px solid var(--hv-rule);border-radius:var(--hv-r-card);box-shadow:none}
html #app.coachdark .cui-page *{letter-spacing:0}
html #app.coachdark .cui-stat__label{font-size:14px;font-weight:500;color:var(--hv-muted)}
html #app.coachdark .cui-stat__value{font-family:var(--hv-serif);font-weight:400;font-size:34px;letter-spacing:-.01em;
  font-variant-numeric:lining-nums tabular-nums;color:var(--hv-ink)}
html #app.coachdark .cui-stat__context{font-size:14px;color:var(--hv-muted)}
html #app.coachdark .cui-list__row{border-color:var(--hv-rule);color:var(--hv-ink-2)}
html #app.coachdark .cui-list__label{color:var(--hv-ink)}
html #app.coachdark .cui-list__value{color:var(--hv-muted);font-size:14px}
html #app.coachdark .cui-table th{background:var(--hv-sunk);color:var(--hv-muted);font-weight:500;font-size:14px}
html #app.coachdark .cui-table td{border-color:var(--hv-rule);color:var(--hv-ink)}
html #app.coachdark .cui-empty{text-align:center;color:var(--hv-muted)}
html #app.coachdark .cui-empty b{color:var(--hv-ink);font-weight:600}
html #app.coachdark .cui-callout{background:var(--hv-surface);border:1px solid var(--hv-rule);border-left:3px solid var(--hv-ink);color:var(--hv-ink-2)}
html #app.coachdark .cui-badge{border-radius:999px;font-weight:500}
html #app.coachdark .cui-badge--good{background:var(--hv-good-tint);color:var(--hv-good)}

html #app.coachdark .cui-table td::before{text-transform:none!important;letter-spacing:0!important;color:var(--hv-muted)!important;font-weight:500}
@media (max-width:760px){
  html #app.coachdark .cui-header{padding:24px 16px 0}
  html #app.coachdark .cui-tabs{padding:0 16px}
  html #app.coachdark .dash .band .shell{padding:0 16px}
  html #app.coachdark>.sec-head{padding:24px 16px 0}
  html #app.coachdark>.empty{margin:16px!important;padding:32px 20px}
}

/* ── AI dock: a quiet white column, not a dark slab ─────────────── */
html body.reg-coach .aidock-panel,html body.reg-coach .aidock-col{
  background:var(--hv-surface)!important;color:var(--hv-ink)!important;
  border:0!important;border-left:1px solid var(--hv-rule)!important;box-shadow:none!important;border-radius:0!important}
html body.reg-coach .aidock-head{border-bottom:1px solid var(--hv-rule)!important;background:var(--hv-surface)!important}
html body.reg-coach .aidock-head-t,html body.reg-coach .aidock-head b{font-family:var(--hv-serif)!important;font-size:20px!important;
  font-weight:400!important;text-transform:none!important;letter-spacing:0!important;color:var(--hv-ink)!important}
html body.reg-coach .aidock-empty h3{font-family:var(--hv-serif)!important;font-weight:400!important;font-size:24px!important;
  text-transform:none!important;letter-spacing:-.01em!important;color:var(--hv-ink)!important}
html body.reg-coach .aidock-compose,html body.reg-coach .aidock-input{
  background:var(--hv-surface)!important;color:var(--hv-ink)!important;border:1px solid var(--hv-rule-2)!important;
  border-radius:12px!important;box-shadow:0 1px 2px rgba(22,22,22,.05)!important}
html body.reg-coach .aidock-compose .aidock-input,html body.reg-coach .aidock-compose input,html body.reg-coach .aidock-compose textarea{border:0!important;box-shadow:none!important}
html body.reg-coach .aidock-compose textarea,html body.reg-coach .aidock-compose input{background:transparent!important;color:var(--hv-ink)!important}
html body.reg-coach .aidock-compose ::placeholder{color:#8C8B85!important}
html body.reg-coach .aidock-panel button{color:var(--hv-ink-2)}
html body.reg-coach .cxpill{background:var(--hv-sunk)!important;color:var(--hv-ink-2)!important;border:1px solid var(--hv-rule)!important;
  font-family:var(--hv-sans)!important;text-transform:none!important;letter-spacing:0!important}
/* Onboarding banner on Home ("Set up your workspace") */
html #app.coachdark .pob-banner{background:var(--hv-surface)!important;border:1px solid var(--hv-rule)!important;color:var(--hv-ink)!important;
  border-radius:var(--hv-r-card)!important;box-shadow:none!important}
html #app.coachdark .pob-banner *{color:inherit}
html #app.coachdark .pob-banner p{color:var(--hv-muted)}
html body.reg-coach .aidock-chip,html body.reg-coach .aidock-suggbtn,html body.reg-coach .aidock-sugg button{
  background:var(--hv-surface)!important;color:var(--hv-ink-2)!important;border:1px solid var(--hv-rule-2)!important;border-radius:999px!important}
html body.reg-coach .aidock-chip:hover,html body.reg-coach .aidock-suggbtn:hover{background:var(--hv-sunk)!important}
html body.reg-coach .aidock-fab{background:var(--hv-ink)!important;color:#FFFFFF!important;text-transform:none!important;
  letter-spacing:0!important;font-family:var(--hv-sans)!important;font-weight:600!important;border:0!important;border-radius:999px!important}
html body.reg-coach .aidock-panel :is(.bub,.msg){font-family:var(--hv-sans)}
html body.reg-coach .aidock-panel .bub.me,html body.reg-coach .aidock-panel .msg.user{background:var(--hv-sunk)!important;color:var(--hv-ink)!important}

/* ════════════ Public site (landing + header), Harvey register ════════════ */
html body:not(.reg-coach) header.topbar{background:rgba(247,246,242,.94)!important;backdrop-filter:blur(10px);
  border-bottom:1px solid #E6E3DD!important;box-shadow:none!important;color:#161616}
html body:not(.reg-coach) header.topbar :is(.tnav,.navlink,.topnav button){color:#3B3A37!important;text-transform:none!important;
  letter-spacing:0!important;font-family:"Archivo",system-ui,sans-serif!important;font-stretch:100%!important;font-weight:500!important;font-size:15px!important}
html body:not(.reg-coach) header.topbar :is(.tnav,.navlink):hover,html body:not(.reg-coach) header.topbar .tnav.on{color:#161616!important;background:transparent!important}
html body:not(.reg-coach) header.topbar .cta{border-radius:8px!important;text-transform:none!important;letter-spacing:0!important;
  font-family:"Archivo",system-ui,sans-serif!important;font-stretch:100%!important;font-weight:600!important;font-size:14px!important;box-shadow:none!important}
html body:not(.reg-coach) header.topbar .cta.start{background:#161616!important;color:#FFFFFF!important;border:1px solid #161616!important}
html body:not(.reg-coach) header.topbar .cta.login{background:transparent!important;color:#161616!important;border:1px solid #D6D3CC!important}
html body:not(.reg-coach) header.topbar .burger{color:#161616!important}
html body:not(.reg-coach) header.topbar .burger *{background:#161616}

/* The wordmark PNG still contains the retired final "e"; the crop box hides
   it only if the image keeps its natural width. On phones a max-width rule
   squeezed the whole word into the box and "Sporve" showed. */
.navlogo-crop .navlogo{max-width:none!important;width:auto!important}
@media (max-width:760px){html #app .hvl .hvl-win-ask{display:none}html #app .hvl .hvl-win-title{font-size:24px}html #app .hvl .hvl-win-main{padding:18px 14px 6px}}

/* Pricing page: same register as the landing */
html body:not(.reg-coach) #app:has(.pr-h1c){background:#F7F6F2!important}
html body:not(.reg-coach) #app .pr-h1c{font-family:"Newsreader",Georgia,serif!important;font-weight:400!important;text-transform:none!important;
  letter-spacing:-.02em!important;font-stretch:100%!important;color:#161616!important;font-size:clamp(40px,4.6vw,60px)!important;line-height:1.05!important}
html body:not(.reg-coach) #app:has(.pr-h1c) .eyebrow{display:none}
html body:not(.reg-coach) #app :is(.pp-name,.pp-badge,.pp-cta,.btn){text-transform:none!important;letter-spacing:0!important;font-stretch:100%!important}
html body:not(.reg-coach) #app:has(.pr-h1c) .btn:not(.ghost),html body:not(.reg-coach) #app .pp-cta:not(.pp-cta-alt){background:#161616!important;color:#FFFFFF!important;border-radius:8px!important}
html body:not(.reg-coach) #app:has(.pr-h1c) .btn.ghost{background:transparent!important;color:#161616!important;border:1px solid #D6D3CC!important;border-radius:8px!important}
html body:not(.reg-coach) #app .pp-name{font-weight:600!important}
html body:not(.reg-coach) #app .pp-badge{background:#161616!important;color:#FFFFFF!important}

/* Scroll-reveal fades are switched off site-wide: content that is invisible
   until it scrolls into view read as a glitch on fast scrolls. */
.js-rev [data-rev]{opacity:1!important;transform:none!important;transition:none!important}

html #app:has(.hvl){background:#F7F6F2!important}
html #app .hvl{--ink:#161616;--ink-2:#3B3A37;--muted:#66655F;--rule:#E6E3DD;--rule-2:#D6D3CC;--canvas:#F7F6F2;--sunk:#F1EFEA;
  --serif:"Newsreader",Georgia,"Times New Roman",serif;--sans:"Archivo",system-ui,-apple-system,"Segoe UI",sans-serif;
  background:var(--canvas);color:var(--ink);font-family:var(--sans);font-stretch:100%}
html #app .hvl *{text-transform:none;letter-spacing:0}
html #app .hvl-wrap{max-width:1280px;margin:0 auto;padding:0 40px}
@media (max-width:760px){html #app .hvl-wrap{padding:0 16px}}
html #app .hvl-h1{font-family:var(--serif)!important;font-weight:400!important;font-size:clamp(44px,5.6vw,76px)!important;line-height:1.02!important;
  letter-spacing:-.025em!important;color:var(--ink)!important;margin:0;text-transform:none!important}
html #app .hvl-h1-sm{font-size:clamp(36px,4.4vw,56px)!important}
html #app .hvl-h2{font-family:var(--serif)!important;font-weight:400!important;font-size:clamp(30px,3.2vw,44px)!important;line-height:1.1!important;
  letter-spacing:-.02em!important;color:var(--ink)!important;margin:0;max-width:22ch;text-transform:none!important}
html #app .hvl h3{font-family:var(--sans)!important;font-weight:600!important;font-size:17px!important;line-height:1.35!important;color:var(--ink)!important;
  margin:0;text-transform:none!important;letter-spacing:0!important}
html #app .hvl-p,html #app .hvl-lede{color:var(--muted);font-size:17px;line-height:1.6;margin:16px 0 0}
html #app .hvl-lede{font-size:19px;color:var(--ink-2);margin:0}
html #app .hvl-center{text-align:center}html #app .hvl-center .hvl-h2,html #app .hvl-center .hvl-p{margin-left:auto;margin-right:auto}
html #app .hvl-center-row{justify-content:center}
html #app .hvl-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:8px;
  font-family:var(--sans);font-weight:600;font-size:15px;text-decoration:none;cursor:pointer;border:1px solid transparent;transition:background .15s}
html #app .hvl-btn-pri{background:var(--ink);color:#FFFFFF;border-color:var(--ink)}
html #app .hvl-btn-pri:hover{background:#333331}
html #app .hvl-btn-sec{background:transparent;color:var(--ink);border-color:var(--rule-2)}
html #app .hvl-btn-sec:hover{background:var(--sunk)}
html #app .hvl-ctas{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}

html #app .hvl-hero{padding:72px 0 0}
html #app .hvl-hero-grid{display:grid;grid-template-columns:1.15fr 1fr;gap:64px;align-items:end;padding-bottom:56px}
html #app .hvl-hero-side{padding-bottom:8px}
@media (max-width:900px){html #app .hvl-hero{padding-top:40px}html #app .hvl-hero-grid{grid-template-columns:1fr;gap:24px;padding-bottom:40px}}

/* The product, framed over the one stadium photograph */
html #app .hvl-shot{position:relative;border-radius:16px;overflow:hidden;padding:64px 64px 0;min-height:0;background:#1B1D1F}
html #app .hvl-shot .hero-media{position:absolute;inset:0;z-index:0}
html #app .hvl-shot .hero-still{position:absolute;inset:0;background-size:cover;background-position:center 35%}
html #app .hvl-shot .hero-media::after{content:"";position:absolute;inset:0;background:rgba(20,20,20,.38)}
html #app .hvl-shot .hero-in{position:relative;z-index:1;text-align:center;padding:0;max-width:none}
html #app .hvl-note{margin:14px 0 0;font-size:14px;color:var(--muted)}
@media (max-width:760px){html #app .hvl-shot{padding:24px 12px 0;border-radius:12px}}

html #app .hvl-win{display:grid;grid-template-columns:184px 1fr;text-align:left;background:#FFFFFF;border-radius:12px 12px 0 0;overflow:hidden;
  box-shadow:0 30px 80px -20px rgba(0,0,0,.55);max-width:1060px;margin:0 auto}
html #app .hvl-win-rail{background:#111111;color:#EDEDEA;display:flex;flex-direction:column;gap:4px;padding:18px 12px;font-size:14px}
html #app .hvl-win-rail b{font-family:var(--serif);font-weight:400;font-size:22px;color:#FFFFFF;padding:0 8px 12px}
html #app .hvl-win-rail span{padding:7px 8px;border-radius:6px;color:#A3A39E}
html #app .hvl-win-rail span.on{background:#2A2A2A;color:#FFFFFF}
html #app .hvl-win-main{padding:24px 28px 8px;background:#F7F6F2;min-width:0}
html #app .hvl-win-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
html #app .hvl-win-title{font-family:var(--serif);font-size:28px;letter-spacing:-.015em;color:var(--ink)}
html #app .hvl-win-ask{background:#161616;color:#fff;border-radius:8px;padding:7px 12px;font-size:13.5px;font-weight:600}
html #app .hvl-win-banner{margin-top:16px;background:#FFFFFF;border:1px solid var(--rule);border-radius:10px;padding:12px 14px;font-size:14px;color:var(--ink-2)}
html #app .hvl-win-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:12px}
html #app .hvl-win-stats div{background:#FFFFFF;border:1px solid var(--rule);border-radius:10px;padding:12px 14px}
html #app .hvl-win-stats span{display:block;font-size:13.5px;color:var(--muted)}
html #app .hvl-win-stats b{display:block;margin-top:4px;font-family:var(--serif);font-weight:400;font-size:28px;color:var(--ink)}
html #app .hvl-win-list{margin-top:12px;background:#FFFFFF;border:1px solid var(--rule);border-radius:10px 10px 0 0;border-bottom:0}
html #app .hvl-win-row{display:grid;grid-template-columns:150px 1fr auto 96px;gap:14px;align-items:center;padding:11px 14px;border-bottom:1px solid var(--rule);font-size:14px}
html #app .hvl-win-row .nm{font-weight:600;color:var(--ink)}
html #app .hvl-win-row .nm small{display:block;font-weight:400;color:var(--muted);font-size:13.5px}
html #app .hvl-win-row .msg{color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
html #app .hvl-win-row .amt{font-family:"JetBrains Mono",ui-monospace,monospace;color:var(--ink)}
html #app .hvl-win-row .st{justify-self:end;font-size:13.5px;color:#2F6F47;background:#E8F1EA;border-radius:999px;padding:3px 10px}
html #app .hvl-win-row .st.hold{color:#2C557E;background:#E9EFF5}
@media (max-width:900px){html #app .hvl-win{grid-template-columns:1fr}html #app .hvl-win-rail{display:none}
  .hvl-win-row{grid-template-columns:1fr auto}html #app .hvl-win-row .msg,html #app .hvl-win-row .st{display:none}
  .hvl-win-stats{grid-template-columns:1fr 1fr}html #app .hvl-win-stats div:last-child{display:none}}

html #app .hvl-sec{padding:112px 0}
html #app .hvl-sec-alt{background:#FFFFFF;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
@media (max-width:760px){html #app .hvl-sec{padding:64px 0}}
html #app .hvl-split{display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:start}
@media (max-width:900px){html #app .hvl-split{grid-template-columns:1fr;gap:28px}}
html #app .hvl-who{display:grid;grid-template-columns:repeat(3,1fr);gap:0;margin-top:56px;border-top:1px solid var(--rule)}
html #app .hvl-who>div{padding:28px 28px 0 0}
html #app .hvl-who>div+div{padding-left:28px;border-left:1px solid var(--rule)}
html #app .hvl-who p{color:var(--muted);font-size:16px;line-height:1.6;margin:10px 0 18px}
html #app .hvl-who span{font-size:14px;color:var(--ink-2);background:var(--sunk);border-radius:999px;padding:4px 12px}
@media (max-width:900px){html #app .hvl-who{grid-template-columns:1fr}html #app .hvl-who>div+div{padding-left:0;border-left:0;border-top:1px solid var(--rule)}html #app .hvl-who>div{padding:24px 0}}
html #app .hvl-steps{list-style:none;margin:0;padding:0;border-top:1px solid var(--rule)}
html #app .hvl-steps li{display:grid;grid-template-columns:48px 1fr;gap:16px;padding:24px 0;border-bottom:1px solid var(--rule)}
html #app .hvl-steps li>span{font-family:var(--serif);font-size:30px;line-height:1;color:var(--muted)}
html #app .hvl-steps p{color:var(--muted);font-size:16px;line-height:1.6;margin:8px 0 0}
html #app .hvl-files{background:#FFFFFF;border:1px solid var(--rule);border-radius:12px;overflow:hidden}
html #app .hvl-files div{display:flex;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid var(--rule);font-size:15px}
html #app .hvl-files div:last-child{border-bottom:0}
html #app .hvl-files small{color:var(--muted);font-size:14px}
html #app .hvl-cx{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:40px}
html #app .hvl-cx-card{background:var(--canvas);border:1px solid var(--rule);border-radius:12px;padding:20px}
html #app .hvl-cx-card .cxlogo{display:inline-flex;width:36px;height:36px;border-radius:8px;background:#FFFFFF;border:1px solid var(--rule);
  align-items:center;justify-content:center;overflow:hidden}
html #app .hvl-cx-card .cxlogo svg,html #app .hvl-cx-card .cxlogo img{width:22px;height:22px}
html #app .hvl-cx-card b{display:block;margin-top:14px;font-weight:600;font-size:16px;color:var(--ink)}
html #app .hvl-cx-card p{margin:6px 0 0;color:var(--muted);font-size:14px;line-height:1.55}
@media (max-width:900px){html #app .hvl-cx{grid-template-columns:1fr 1fr}}
@media (max-width:520px){html #app .hvl-cx{grid-template-columns:1fr}}
html #app .hvl-close{padding:120px 0 40px;background:var(--canvas);border-top:1px solid var(--rule)}
html #app .hvl-close .hvl-p{max-width:60ch}
html #app .hvl-foot{margin-top:96px;padding-top:32px;border-top:1px solid var(--rule);display:grid;gap:16px;justify-items:center;text-align:center}
html #app .hvl-foot .foot-links{display:flex;flex-wrap:wrap;gap:6px 20px;justify-content:center}
html #app .hvl-foot .foot-link{color:var(--muted)!important;font-size:14px!important;text-transform:none!important;letter-spacing:0!important;background:none;border:0}
html #app .hvl-foot .foot-link:hover{color:var(--ink)!important}
html #app .hvl-foot .foot-line{color:var(--muted);font-size:14px;margin:0}
html #app .hvl-foot .foot-mail{color:var(--ink)}
html #app .hvl .close-zone{background:transparent!important;padding:0 40px!important;border:0!important;box-shadow:none!important}
html #app .hvl .hvl-foot{background:transparent!important;color:var(--muted)!important;display:flex!important;flex-direction:column;align-items:center}
html #app .hvl .hvl-foot .foot-brand{margin:0}
html #app .hvl .hvl-win-row .st{white-space:nowrap}

/* ═══ OWNER CORRECTION 2026-10-21 (same day) ═══════════════════════════════
   "your job wasnt to change sporve's color, copy harvey's dashboard color but
   have the slate coloring and keep sporve's athletic main font."
   Kept from Harvey: the light working area, white cards, hairlines, dark left
   rail, calm spacing. Restored from Sporv: the SLATE palette for every accent
   and action (no black buttons), and ARCHIVO EXPANDED UPPERCASE as the
   headline voice (no serif). Numbers return to JetBrains Mono. */
html #app.coachdark,html body.reg-coach,html #app .hvl{
  --hv-slate:#6B7F9E;--hv-slate-l:#9DB0CB;--hv-slate-deep:#3E566E;--hv-slate-hover:#47617C;
  --hv-slate-tint:#EEF2F6;--hv-rail:#0B0D0F;--hv-rail-2:#151A21;--hv-rail-3:#1A212B;
  --hv-canvas:#F5F7F9;--hv-sunk:#EDF1F5;--hv-rule:#E1E6EC;--hv-rule-2:#CFD7E0;
  --hv-muted:#5B6878;--hv-ink-2:#334155;--hv-ink:#0B0D0F;
  --hv-attn:#3E566E;--hv-attn-tint:#EEF2F6;
}
/* Headline voice: Archivo expanded, uppercase */
html #app.coachdark .dash>:not(.rail) h1,
html #app.coachdark .cui-page .cui-h1,
html #app.coachdark>.sec-head h1{
  font-family:"Archivo",system-ui,sans-serif!important;font-stretch:125%!important;font-weight:800!important;
  text-transform:uppercase!important;letter-spacing:.005em!important;font-size:clamp(24px,2.2vw,32px)!important;line-height:1.1!important}
html #app.coachdark .dash>.rail .railmark{font-family:"Archivo",system-ui,sans-serif!important;font-stretch:125%;font-weight:800;
  text-transform:uppercase;letter-spacing:.02em;font-size:20px}
html body.reg-coach .aidock-head-t,html body.reg-coach .aidock-head b,html body.reg-coach .aidock-empty h3{
  font-family:"Archivo",system-ui,sans-serif!important;font-stretch:125%!important;font-weight:800!important;
  text-transform:uppercase!important;letter-spacing:.02em!important}
html body.reg-coach .aidock-head-t,html body.reg-coach .aidock-head b{font-size:15px!important}
/* Coach register caps weight at 600 (smoke 'coach UI register') */
html body.reg-coach :is(.aidock-head-t,.aidock-head b,.aidock-empty h3){font-weight:600!important}
html body.reg-coach .aidock-empty h3{font-size:22px!important}
/* Numbers: JetBrains Mono, as the Sporv system specifies */
html #app.coachdark .cui-stat__value,html #app.coachdark .dash .nt-stat b{
  font-family:"JetBrains Mono",ui-monospace,monospace!important;font-weight:500!important;font-size:28px!important;letter-spacing:-.01em!important}

/* Actions in slate, not black */
html #app.coachdark .dash .btn:not(.ghost),
html #app.coachdark .dash .cui-button--primary,
html #app.coachdark>.empty .btn{background:var(--hv-slate-deep)!important;border-color:var(--hv-slate-deep)!important;color:#FFFFFF!important}
html #app.coachdark .dash .btn:not(.ghost):hover,
html #app.coachdark .dash .cui-button--primary:hover{background:var(--hv-slate-hover)!important}
html #app.coachdark .dash :is(input,select,textarea):focus{outline-color:var(--hv-slate)!important;border-color:var(--hv-slate)!important}
html #app.coachdark .cui-tab.on{border-color:var(--hv-slate)!important;color:var(--hv-ink)!important}
html #app.coachdark .dash :is(.stseg,.stdays) button:is(.on,[aria-pressed=true],[aria-checked=true]){background:var(--hv-slate-deep)!important}
html #app.coachdark .dash .bub.me{background:var(--hv-slate-deep)!important}
html #app.coachdark .cui-callout{border-left-color:var(--hv-slate)!important}
html body.reg-coach .aidock-fab{background:var(--hv-slate-deep)!important}
html #app.coachdark header.topbar .btn:not(.ghost),html body.reg-coach header.topbar .btn:not(.ghost){background:var(--hv-slate)!important;color:#0B0D0F!important}

/* Rail: Sporv near-black with slate highlights */
html #app.coachdark .dash>.rail{background:var(--hv-rail)!important}
html body.reg-coach header.topbar{background:var(--hv-rail)!important;border-bottom-color:var(--hv-rail-2)!important}
html #app.coachdark .dash>.rail button:hover{background:var(--hv-rail-2)!important}
html #app.coachdark .dash>.rail button.on{background:var(--hv-rail-3)!important;color:#FFFFFF!important;box-shadow:inset 2px 0 0 var(--hv-slate)!important}
html #app.coachdark .dash>.rail button.on svg{color:var(--hv-slate-l)!important}
html #app.coachdark .dash>.rail .railgroup{color:var(--hv-slate-l)!important;text-transform:uppercase!important;letter-spacing:.08em!important;font-size:13.5px!important;font-weight:600!important}
html #app.coachdark .dash>.rail .gsbar i{background:var(--hv-slate-l)!important}
html #app.coachdark .dash .avatar{background:var(--hv-slate-deep)!important}

/* Public site: same correction */
html #app .hvl{--serif:"Archivo",system-ui,sans-serif;--ink:#0B0D0F;--ink-2:#334155;--muted:#5B6878;--rule:#E1E6EC;--rule-2:#CFD7E0;--canvas:#F5F7F9;--sunk:#EDF1F5}
html #app:has(.hvl){background:#F5F7F9!important}
html #app .hvl .hvl-h1,html #app .hvl .hvl-h2,html body:not(.reg-coach) #app .pr-h1c{
  font-family:"Archivo",system-ui,sans-serif!important;font-stretch:125%!important;font-weight:800!important;text-transform:uppercase!important;letter-spacing:0!important}
html #app .hvl .hvl-h1{font-size:clamp(38px,5vw,64px)!important;line-height:1!important}
html #app .hvl .hvl-h2{font-size:clamp(24px,2.6vw,36px)!important;line-height:1.08!important}
html body:not(.reg-coach) #app .pr-h1c{font-size:clamp(32px,3.8vw,52px)!important}
html #app .hvl .hvl-steps li>span{font-family:"JetBrains Mono",ui-monospace,monospace!important;font-size:18px!important;color:#3E566E!important}
html #app .hvl .hvl-win-rail b{font-family:"Archivo",system-ui,sans-serif;font-stretch:125%;font-weight:800;text-transform:uppercase;font-size:16px}
html #app .hvl .hvl-win-title{font-family:"Archivo",system-ui,sans-serif;font-stretch:125%;font-weight:800;text-transform:uppercase;font-size:20px}
html #app .hvl .hvl-win-stats b{font-family:"JetBrains Mono",ui-monospace,monospace;font-weight:500;font-size:22px}
html #app .hvl .hvl-win-rail{background:#0B0D0F}
html #app .hvl .hvl-win-rail span.on{background:#1A212B;box-shadow:inset 2px 0 0 #6B7F9E}
html #app .hvl .hvl-win-ask{background:#3E566E}
html #app .hvl .hvl-btn-pri{background:#3E566E;border-color:#3E566E}
html #app .hvl .hvl-btn-pri:hover{background:#47617C}
html body:not(.reg-coach) header.topbar{background:rgba(245,247,249,.94)!important;border-bottom-color:#E1E6EC!important}
html body:not(.reg-coach) header.topbar .cta.start{background:#3E566E!important;border-color:#3E566E!important}
html body:not(.reg-coach) #app:has(.pr-h1c){background:#F5F7F9!important}
html body:not(.reg-coach) #app:has(.pr-h1c) .btn:not(.ghost),html body:not(.reg-coach) #app .pp-cta:not(.pp-cta-alt),html body:not(.reg-coach) #app .pp-badge{background:#3E566E!important}

/* ═══ Landing blend (owner 2026-10-22): stadium hero on top ═══ */
html #app .hvl .hvl-stadium{padding:0;margin:0}
html #app .hvl .hvl-stadium .hero-panel{position:relative;min-height:min(86vh,780px);display:flex;align-items:center;justify-content:center;overflow:hidden;background:#0B0D0F}
html #app .hvl .hvl-stadium .hero-media{position:absolute;inset:0}
html #app .hvl .hvl-stadium .hero-still{position:absolute;inset:0;background-size:cover;background-position:center 40%}
html #app .hvl .hvl-stadium .hero-media::after{content:"";position:absolute;inset:0;background:rgba(11,13,15,.55)}
html #app .hvl .hvl-stadium-in{position:relative;z-index:1;text-align:center;max-width:980px;padding:96px 24px}
html #app .hvl .hvl-h1-on-dark{color:#FFFFFF!important;font-size:clamp(40px,6vw,84px)!important}
html #app .hvl .hvl-lede-on-dark{color:#D5DDE6!important;max-width:58ch;margin:24px auto 0!important}
html #app .hvl .hvl-btn-ghost-dark{background:transparent;color:#FFFFFF;border-color:rgba(255,255,255,.45)}
html #app .hvl .hvl-btn-ghost-dark:hover{background:rgba(255,255,255,.08)}
html #app .hvl .hvl-sec-shot{padding-top:96px}
html #app .hvl .hvl-frame{margin-top:40px;background:#0B0D0F;border-radius:16px;padding:56px 56px 0;overflow:hidden}
@media (max-width:760px){html #app .hvl .hvl-frame{padding:20px 12px 0;border-radius:12px}html #app .hvl .hvl-stadium-in{padding:72px 16px}}

/* ═══ Public top nav, Harvey's anatomy (owner 2026-10-22) ═══
   Thin dark announcement strip, then a light 72px bar: logo and nav items as
   one left group, Log in (outlined) and Get started (solid slate) on the
   right, square-cornered buttons, ink text, no underline on "Book a call". */
html .hvl-ann{display:flex;align-items:center;justify-content:center;gap:10px;min-height:36px;padding:6px 48px;
  background:#0B0D0F;color:#E6EBF1;font-family:"Archivo",system-ui,sans-serif;font-size:14px;position:relative;text-align:center}
html .hvl-ann a{color:#FFFFFF;font-weight:600;text-decoration:underline;text-underline-offset:3px}
html .hvl-ann-x{position:absolute;right:16px;top:50%;transform:translateY(-50%);background:none;border:0;color:#9DB0CB;font-size:18px;cursor:pointer;line-height:1}
html body:not(.reg-coach) header.topbar .topbar-in{min-height:72px}
html body:not(.reg-coach) header.topbar .nav-left{gap:36px}
html body:not(.reg-coach) header.topbar :is(.tnav,.navlink){color:#0B0D0F!important;font-size:15px!important;font-weight:500!important;
  text-decoration:none!important;padding:8px 10px!important}
html body:not(.reg-coach) header.topbar .tnav:hover{color:#3E566E!important}
html body:not(.reg-coach) header.topbar .cta{border-radius:6px!important;min-height:38px;padding:0 16px!important;font-size:14.5px!important}
html body:not(.reg-coach) header.topbar .cta.login{border-color:#0B0D0F!important;color:#0B0D0F!important}
html body:not(.reg-coach) header.topbar .cta-pair{gap:10px}
@media (max-width:760px){html .hvl-ann{font-size:13.5px;padding:6px 40px 6px 16px;justify-content:flex-start;text-align:left}}

html body:not(.reg-coach) header.topbar.has-ann{display:block!important;height:auto!important;padding-top:0!important}
html body:not(.reg-coach) header.topbar .hvl-ann{margin:0;width:100%}
html body:not(.reg-coach) header.topbar .tnav.on{font-style:normal!important;color:#3E566E!important}
html body:not(.reg-coach) #app .pr-cyc.on{background:#3E566E!important;color:#FFFFFF!important}

html #app .hvl .hvl-stadium-in{padding-top:128px!important;padding-bottom:112px!important}
html .hvl-ann a{white-space:nowrap}
@media (max-width:760px){html #app .hvl .hvl-stadium-in{padding-top:88px!important;padding-bottom:72px!important}
  html #app .hvl .hvl-h1-on-dark{font-size:40px!important}}
`;

const ID = "harvey-layer";
function ensureLast(){
  let el = document.getElementById(ID);
  if(!el){
    el = document.createElement("style");
    el.id = ID;
    el.textContent = CSS;
  }
  if(document.head.lastElementChild !== el) document.head.appendChild(el);
}
ensureLast();
/* Other modules inject their <style> lazily; keep this layer after them. */
try{
  new MutationObserver(muts => {
    if(muts.some(m => [...m.addedNodes].some(n => n.nodeName === "STYLE" && n.id !== ID))) ensureLast();
  }).observe(document.head, { childList:true });
}catch(e){}

window.MOD_HARVEY = { css: CSS, ensureLast };
})();
