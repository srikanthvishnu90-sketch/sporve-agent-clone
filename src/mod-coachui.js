"use strict";
/* ═══════════════════════════════════════════════════════════════════
   MOD_COACHUI — the approved Media page extracted into shared pieces.

   Page renderers pass data and already-authorized action attributes; this
   module owns the coach-dashboard typography, spacing, surfaces, buttons,
   URL-backed local tabs, and responsive table behavior. Page files should
   not mint their own font sizes or font stacks around these components.
   ═══════════════════════════════════════════════════════════════════ */
(function(){

const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g,
  c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const html = value => ({ html:String(value == null ? "" : value) });
const valueHTML = value => value && typeof value === "object" && "html" in value
  ? String(value.html) : esc(value);
const attrs = value => value ? " " + String(value).trim() : "";

function Button(options){
  options = options || {};
  const size = options.size === "sm" ? "sm" : "lg";
  const variant = options.variant === "primary" ? "primary" : "secondary";
  const tag = options.href ? "a" : "button";
  const href = options.href ? ` href="${esc(options.href)}"` : "";
  const type = tag === "button" ? ` type="${esc(options.type || "button")}"` : "";
  return `<${tag} class="cui-button cui-button--${size} cui-button--${variant}"${type}${href}${attrs(options.attrs)}>${valueHTML(options.label || "")}</${tag}>`;
}

function PageHeader(options){
  options = options || {};
  const actions = (options.actions || []).filter(Boolean).join("");
  return `<header class="cui-header">
    <div class="cui-header__row">
      <div class="cui-header__copy">
        <p class="cui-eyebrow">${esc(options.eyebrow || "Coach dashboard")}</p>
        <h1 class="cui-h1"${options.id ? ` id="${esc(options.id)}"` : ""}>${esc(options.h1 || "")}</h1>
        <p class="cui-lede">${esc(options.lede || "")}</p>
      </div>
      ${actions ? `<div class="cui-header__actions">${actions}</div>` : ""}
    </div>
  </header>`;
}

function TabStrip(options){
  options = options || {};
  const tabs = options.tabs || [];
  if(tabs.length <= 1) return "";
  return `<nav class="cui-tabs" role="tablist" aria-label="${esc(options.label || "Page sections")}">
    ${tabs.map(tab => `<button type="button" class="cui-tab${tab.key === options.active ? " on" : ""}"
      role="tab" aria-selected="${tab.key === options.active}" tabindex="${tab.key === options.active ? "0" : "-1"}"
      data-cui-page="${esc(options.page || "")}" data-cui-state="${esc(options.stateKey || "")}" data-cui-tab="${esc(tab.key)}">
      ${esc(tab.label)}${tab.count === undefined || tab.count === null ? "" : `<span class="cui-count">${esc(tab.count)}</span>`}
    </button>`).join("")}
  </nav>`;
}

function Block(options){
  options = options || {};
  return `<section class="cui-block"${options.id ? ` id="${esc(options.id)}"` : ""}>
    <div class="cui-block__head">
      <div>
        <h2 class="cui-block__title">${esc(options.title || "")}</h2>
        <p class="cui-block__subtitle">${esc(options.subtitle || "")}</p>
      </div>
      ${options.action || ""}
    </div>
    ${options.body || ""}
  </section>`;
}

function StatCard(options){
  options = options || {};
  return `<div class="cui-card cui-stat">
    <div class="cui-stat__label">${esc(options.label || "")}</div>
    <div class="cui-stat__value">${esc(options.value == null ? "" : options.value)}</div>
    <div class="cui-stat__context">${esc(options.context || "")}</div>
  </div>`;
}

function StatGrid(cards){
  const list = (cards || []).filter(Boolean);
  if(!list.length) return "";
  return `<div class="cui-statgrid cui-statgrid--${Math.min(4, list.length)}">${list.map(StatCard).join("")}</div>`;
}

function ListCard(rows, options){
  options = options || {};
  const list = rows || [];
  if(!list.length) return EmptyState(options.emptyTitle || "Nothing here yet", options.emptyBody || "No records are available for this section.");
  return `<div class="cui-card cui-list">${list.map(row => `<div class="cui-list__row">
    <span class="cui-list__label">${valueHTML(row.label)}</span>
    <span class="cui-list__value${row.mono === false ? "" : " cui-mono"}">${valueHTML(row.value)}</span>
  </div>`).join("")}</div>`;
}

function DataTable(options){
  options = options || {};
  const columns = options.columns || [];
  const rows = options.rows || [];
  if(!rows.length) return EmptyState(options.emptyTitle || "No records", options.emptyBody || "Nothing has been loaded for this view.");
  return `<div class="cui-tablewrap"><table class="cui-table">
    <thead><tr>${columns.map(col => `<th scope="col">${esc(col.label || "")}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(row => `<tr>${columns.map(col => `<td data-label="${esc(col.label || "")}"${col.mono ? ` class="cui-mono"` : ""}>${valueHTML(row[col.key])}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}

function Callout(options){
  options = typeof options === "string" ? { body:options } : (options || {});
  return `<aside class="cui-callout">${options.title ? `<b>${esc(options.title)}</b> ` : ""}${esc(options.body || "")}</aside>`;
}

function Card(body, className){
  return `<div class="cui-card${className ? " " + esc(className) : ""}">${body || ""}</div>`;
}

function EmptyState(title, body){
  return `<div class="cui-card cui-empty"><b>${esc(title || "Nothing here yet")}</b><p>${esc(body || "")}</p></div>`;
}

/* Getting-started is a process, not a second card vocabulary. These three
   helpers extend the approved Media component system so the onboarding module
   supplies only state and copy; type, spacing, status chrome, and the drawer
   remain shared with every coach page. */
function ProgressCard(options){
  options = options || {};
  const value = Math.max(0, Math.min(100, Number(options.value) || 0));
  return `<div class="cui-card cui-progress">
    <div class="cui-progress__top">
      <b>${esc(options.label || "Setup progress")}</b>
      <span class="cui-mono">${esc(options.count || "")}</span>
    </div>
    <div class="cui-progress__track" role="progressbar" aria-label="${esc(options.label || "Setup progress")}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}">
      <i style="width:${value}%"></i>
    </div>
    ${options.context ? `<p>${valueHTML(options.context)}</p>` : ""}
  </div>`;
}

function ProcessPhases(phases){
  const statusLabel = { done:"Done", review:"In review", current:"Next", open:"Open", locked:"Locked", blocked:"Needs wiring" };
  return (phases || []).map(phase => `<section class="cui-phase" aria-labelledby="cui-phase-${esc(phase.key)}">
    <div class="cui-phase__label"><h2 id="cui-phase-${esc(phase.key)}">${esc(phase.label)}</h2><span></span></div>
    <p class="cui-phase__subtitle">${esc(phase.subtitle || "")}</p>
    <div class="cui-process">
      ${(phase.steps || []).map(step => {
        const status = statusLabel[step.state] ? step.state : "open";
        return `<article class="cui-process__step cui-process__step--${status}">
          <span class="cui-process__marker" aria-hidden="true">${status === "done"
            ? '<svg viewBox="0 0 20 20" fill="none"><path d="M5 10.5l3 3 7-7"/></svg>' : ""}</span>
          <div class="cui-process__copy">
            <h3>${esc(step.title || "")}${step.optional ? ' <span class="cui-process__optional">Optional</span>' : ""}</h3>
            <p>${esc(step.description || "")}</p>
            <div class="cui-process__meta">
              <span>Time <b class="cui-mono">${esc(step.time || "Varies")}</b></span>
              <span>Owner <b>${esc(step.owner || "You")}</b></span>
              <span>${esc(step.unlocks || "")}</span>
            </div>
          </div>
          <div class="cui-process__action">
            <span class="cui-process__status">${esc(statusLabel[status])}</span>
            ${step.statusNote ? `<small>${esc(step.statusNote)}</small>` : ""}
            ${step.action || ""}
          </div>
        </article>`;
      }).join("")}
    </div>
  </section>`).join("");
}

function Drawer(options){
  options = options || {};
  return `<div class="cui-drawer-scrim" data-cui-drawer-close="1"></div>
    <aside class="cui-drawer" role="dialog" aria-modal="true" aria-labelledby="${esc(options.headingId || "cui-drawer-title")}">
      <header class="cui-drawer__head">
        <span class="cui-mono">${esc(options.kicker || "")}</span>
        <h2 id="${esc(options.headingId || "cui-drawer-title")}" tabindex="-1">${esc(options.title || "")}</h2>
        <button type="button" class="cui-drawer__close" data-cui-drawer-close="1" aria-label="Close step details">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </header>
      <div class="cui-drawer__body">${options.body || ""}</div>
      <footer class="cui-drawer__foot">${options.actions || ""}${options.time ? `<span>${esc(options.time)}</span>` : ""}</footer>
    </aside>`;
}

function Page(options){
  options = options || {};
  return `<section class="cui-page" data-cui-page-root="${esc(options.page || "")}" aria-labelledby="${esc(options.headingId || "cui-page-title")}">
    ${PageHeader({
      eyebrow:options.eyebrow,
      h1:options.h1,
      lede:options.lede,
      actions:options.actions,
      id:options.headingId || "cui-page-title",
    })}
    <div class="cui-scroll" data-cui-scroll="${esc(options.page || "")}">
      ${TabStrip({page:options.page,tabs:options.tabs,active:options.active,stateKey:options.stateKey,label:options.tabLabel})}
      <div class="cui-pane" role="tabpanel">${options.body || ""}</div>
    </div>
  </section>`;
}

function activeTab(tabs, fallback, stateKey){
  const keys = (tabs || []).map(tab => typeof tab === "string" ? tab : tab.key);
  let fromUrl = null;
  try { fromUrl = new URLSearchParams(window.location.search).get("tab"); } catch(_e) {}
  if(keys.indexOf(fromUrl) >= 0){
    if(stateKey && typeof S !== "undefined") S[stateKey] = fromUrl;
    return fromUrl;
  }
  const fromState = stateKey && typeof S !== "undefined" ? S[stateKey] : null;
  const chosen = keys.indexOf(fromState) >= 0 ? fromState : (keys.indexOf(fallback) >= 0 ? fallback : keys[0]);
  if(chosen) writeTab(chosen);
  return chosen;
}

function writeTab(value){
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  } catch(_e) {}
}

function clearTab(){
  try {
    const url = new URL(window.location.href);
    if(!url.searchParams.has("tab")) return;
    url.searchParams.delete("tab");
    history.replaceState(null, "", url.pathname + (url.searchParams.toString() ? "?" + url.searchParams.toString() : "") + url.hash);
  } catch(_e) {}
}

function wire(){
  const groups = {};
  Array.prototype.slice.call(document.querySelectorAll("[data-cui-tab]")).forEach(button => {
    const key = button.dataset.cuiPage || "page";
    (groups[key] = groups[key] || []).push(button);
    button.onclick = () => {
      if(button.dataset.cuiState && typeof S !== "undefined") S[button.dataset.cuiState] = button.dataset.cuiTab;
      writeTab(button.dataset.cuiTab);
      if(typeof render === "function") render();
    };
  });
  Object.keys(groups).forEach(key => groups[key].forEach((button, index) => {
    button.onkeydown = event => {
      const list = groups[key];
      if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
      event.preventDefault();
      let next = index;
      if(event.key === "ArrowLeft") next = (index - 1 + list.length) % list.length;
      if(event.key === "ArrowRight") next = (index + 1) % list.length;
      if(event.key === "Home") next = 0;
      if(event.key === "End") next = list.length - 1;
      list[next].click();
    };
  }));
}

const CSS = `
.cui-page,.cui-drawer{
  --fs-h1:24px;--fs-nav-side:14px;--fs-eyebrow:12px;--fs-body:14px;--fs-fine:12px;
  --cui-bg:#0E0E0F;--cui-panel:#121315;--cui-panel-2:#17191C;
  --cui-line:#1F2226;--cui-line-2:#2A3138;--cui-ink:#F5F5F2;
  --cui-ink-2:#A3A3AB;--cui-ink-3:#8B98A6;--cui-steel:#6B7F9E;
  --cui-good:#8FD19E;--cui-warn:#C9A227;--cui-gutter:32px;
  color:var(--cui-ink);color-scheme:dark;
  font-family:"Inter",system-ui,-apple-system,"Segoe UI",sans-serif;font-size:var(--fs-body)
}
.cui-page{
  grid-row:2;min-width:0;min-height:0;height:100%;margin:0 calc(var(--cui-gutter) * -1);
  display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden;
  background:var(--cui-bg)
}
#app:has(.cui-page) .coachtop{display:none}
#app:has(.cui-page) .dash{height:calc(100vh - 60px);overflow:hidden}
#app:has(.cui-page) .dash>.rail{height:100%;overflow-y:auto}
#app:has(.cui-page) .dash>div{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden}
.cui-page button,.cui-page input,.cui-page textarea,.cui-page select,
.cui-drawer button,.cui-drawer input,.cui-drawer textarea,.cui-drawer select{font:inherit;color:inherit}
.cui-page :focus-visible,.cui-drawer :focus-visible{outline:2px solid var(--cui-steel);outline-offset:2px}
.cui-header{padding:22px 28px 0;background:var(--cui-bg)}
.cui-header__row{display:flex;align-items:flex-start;gap:24px}
.cui-header__copy{min-width:0}
.cui-header__actions{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none}
.cui-eyebrow{margin:0 0 8px;color:var(--cui-ink-3);font-family:"Roboto Condensed",sans-serif;
  font-size:var(--fs-eyebrow);font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.cui-page .cui-h1{margin:0 0 6px;color:var(--cui-ink);font-family:"Roboto Condensed",sans-serif;
  font-size:var(--fs-h1);font-weight:500;letter-spacing:.01em;line-height:1.15;text-transform:uppercase}
.cui-lede{max-width:64ch;margin:0;color:var(--cui-ink-2);font-size:var(--fs-body);line-height:1.55}
.cui-scroll{min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-color:var(--cui-line-2) transparent}
.cui-tabs{position:sticky;top:0;z-index:4;display:flex;gap:0;margin-top:18px;padding:0 28px;
  overflow-x:auto;border-bottom:1px solid var(--cui-line);background:rgba(14,14,15,.97);backdrop-filter:blur(10px);
  scrollbar-width:none}
.cui-tabs::-webkit-scrollbar{display:none}
.cui-tab{min-height:43px;margin-bottom:-1px;padding:0 16px;border:0;border-bottom:2px solid transparent;
  display:flex;align-items:center;gap:8px;flex:none;color:var(--cui-ink-3);font-family:"Roboto Condensed",sans-serif;
  font-size:var(--fs-eyebrow);font-weight:600;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap}
.cui-tab:hover{color:var(--cui-ink-2)}
.cui-tab.on{border-color:var(--cui-ink);color:var(--cui-ink)}
.cui-count{padding:2px 7px;border-radius:999px;background:var(--cui-panel-2);color:var(--cui-ink-3);
  font-family:"JetBrains Mono",monospace;font-size:var(--fs-fine);letter-spacing:0;font-variant-numeric:tabular-nums}
.cui-pane{padding:24px 28px 60px}
.cui-block{margin:0 0 28px}
.cui-block:last-child{margin-bottom:0}
.cui-block__head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin:0 0 14px}
.cui-block__title{margin:0 0 4px;color:var(--cui-ink);font-family:"Roboto Condensed",sans-serif;
  font-size:var(--fs-nav-side);font-weight:600;letter-spacing:.04em;line-height:1.25;text-transform:uppercase}
.cui-block__subtitle{margin:0;color:var(--cui-ink-3);font-size:var(--fs-fine);line-height:1.5}
.cui-card{padding:18px;border:1px solid var(--cui-line);border-radius:12px;background:var(--cui-panel)}
.cui-button{border:1px solid var(--cui-line-2);border-radius:8px;display:inline-flex;align-items:center;
  justify-content:center;gap:7px;color:var(--cui-ink);font-family:"Roboto Condensed",sans-serif;
  font-size:var(--fs-eyebrow);font-weight:700;letter-spacing:.04em;line-height:1;text-decoration:none;text-transform:uppercase}
.cui-button--lg{height:36px;padding:0 14px}
.cui-button--sm{height:30px;padding:0 10px}
.cui-button--secondary{background:transparent}
.cui-button--secondary:hover{border-color:#3B424B;background:var(--cui-panel-2)}
.cui-page .cui-button--primary{border-color:#FFFFFF;background:#FFFFFF;color:#0E0E0F}
.cui-page .cui-button--primary:hover{border-color:#E9E9E6;background:#E9E9E6;color:#0E0E0F}
.cui-button:disabled{cursor:not-allowed;opacity:.42}
.cui-statgrid{display:grid;gap:14px}
.cui-statgrid--1{grid-template-columns:1fr}
.cui-statgrid--2{grid-template-columns:repeat(2,minmax(0,1fr))}
.cui-statgrid--3{grid-template-columns:repeat(3,minmax(0,1fr))}
.cui-statgrid--4{grid-template-columns:repeat(4,minmax(0,1fr))}
.cui-stat__label{color:var(--cui-ink-3);font-family:"Roboto Condensed",sans-serif;
  font-size:var(--fs-eyebrow);font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.cui-stat__value{margin:8px 0 2px;color:var(--cui-ink);font-family:"JetBrains Mono",monospace;
  font-size:26px;font-variant-numeric:tabular-nums}
.cui-stat__context{color:var(--cui-ink-3);font-size:var(--fs-fine);line-height:1.45}
.cui-list{padding:6px 18px}
.cui-list__row{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:12px 0;
  border-bottom:1px solid var(--cui-line);color:var(--cui-ink-2);font-size:var(--fs-body);line-height:1.45}
.cui-list__row:last-child{border-bottom:0}
.cui-list__label{min-width:0}.cui-list__label b{color:var(--cui-ink);font-weight:600}
.cui-list__label small{display:block;margin-top:2px;color:var(--cui-ink-3);font-size:var(--fs-fine)}
.cui-list__value{flex:none;color:var(--cui-ink-3);font-size:var(--fs-fine)}
.cui-mono{font-family:"JetBrains Mono",monospace;font-variant-numeric:tabular-nums}
.cui-tablewrap{overflow:hidden;border:1px solid var(--cui-line);border-radius:12px;background:var(--cui-panel)}
.cui-table{width:100%;border-collapse:collapse;color:var(--cui-ink-2);font-size:var(--fs-body)}
.cui-table thead{background:var(--cui-panel-2)}
.cui-table th{padding:10px 16px;text-align:left;color:var(--cui-ink-3);font-family:"Roboto Condensed",sans-serif;
  font-size:var(--fs-eyebrow);font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.cui-table td{padding:13px 16px;border-top:1px solid var(--cui-line);vertical-align:middle}
.cui-table td b{color:var(--cui-ink);font-weight:600}
.cui-table td small{display:block;margin-top:2px;color:var(--cui-ink-3);font-size:var(--fs-fine);line-height:1.45}
.cui-table td:last-child{text-align:right}
.cui-callout{margin:0 0 18px;padding:14px 16px;border:1px solid var(--cui-line);border-left:2px solid var(--cui-steel);
  border-radius:10px;background:var(--cui-panel);color:var(--cui-ink-2);font-size:var(--fs-body);line-height:1.55}
.cui-callout b{color:var(--cui-ink);font-weight:600}
.cui-empty{text-align:center;color:var(--cui-ink-3)}
.cui-empty b{display:block;color:var(--cui-ink);font-weight:600}
.cui-empty p{margin:6px auto 0;max-width:58ch;font-size:var(--fs-fine);line-height:1.55}
.cui-stack{display:flex;flex-direction:column;gap:12px}
.cui-inline{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cui-badge{display:inline-flex;width:max-content;padding:3px 9px;border:1px solid var(--cui-line-2);border-radius:999px;
  color:var(--cui-ink-3);font-size:var(--fs-fine);white-space:nowrap}
.cui-badge--good{border-color:#2C4433;color:var(--cui-good)}
.cui-badge--warn{border-color:#4A3F16;color:var(--cui-warn)}
.cui-draft{margin:8px 0 12px;padding:12px;border:1px solid var(--cui-line-2);border-radius:8px;
  background:var(--cui-bg);color:var(--cui-ink-2);font-size:var(--fs-body);line-height:1.55}
.cui-draft:focus{border-color:var(--cui-steel)}
.cui-note{color:var(--cui-ink-3);font-size:var(--fs-fine);line-height:1.5}
.cui-error{margin:14px 0 0;color:#F0A3A3;font-size:var(--fs-fine)}
.cui-teamthumb{width:72px;aspect-ratio:3/2;border-radius:8px;object-fit:cover;vertical-align:middle}
.cui-progress{padding:18px 20px;margin-bottom:22px}
.cui-progress__top{display:flex;align-items:baseline;gap:12px;margin-bottom:10px}
.cui-progress__top b{font-family:"Roboto Condensed",sans-serif;font-size:var(--fs-nav-side);font-weight:600;
  letter-spacing:.04em;text-transform:uppercase}
.cui-progress__top span{margin-left:auto;color:var(--cui-ink-2);font-size:var(--fs-fine)}
.cui-progress__track{height:6px;overflow:hidden;border-radius:3px;background:var(--cui-panel-2)}
.cui-progress__track i{display:block;height:100%;border-radius:3px;background:var(--cui-ink)}
.cui-progress p{margin:12px 0 0;color:var(--cui-ink-2);font-size:var(--fs-body);line-height:1.55}
.cui-progress p b{color:var(--cui-ink);font-weight:600}
.cui-phase{margin:0 0 28px}
.cui-phase:last-child{margin-bottom:0}
.cui-phase__label{display:flex;align-items:center;gap:10px;margin-bottom:4px}
.cui-phase__label h2{margin:0;color:var(--cui-ink-3);font-family:"Roboto Condensed",sans-serif;
  font-size:var(--fs-eyebrow);font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.cui-phase__label span{height:1px;flex:1;background:var(--cui-line)}
.cui-phase__subtitle{margin:0 0 14px;color:var(--cui-ink-3);font-size:var(--fs-fine);line-height:1.5}
.cui-process{overflow:hidden;border:1px solid var(--cui-line);border-radius:12px;background:var(--cui-panel)}
.cui-process__step{display:grid;grid-template-columns:26px minmax(0,1fr) auto;gap:14px;padding:16px 18px;
  align-items:start;border-bottom:1px solid var(--cui-line)}
.cui-process__step:last-child{border-bottom:0}
.cui-process__marker{width:20px;height:20px;margin-top:2px;border:2px solid var(--cui-ink-3);border-radius:999px;
  display:grid;place-items:center;color:var(--cui-bg)}
.cui-process__marker svg{width:14px;height:14px;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.cui-process__step--done .cui-process__marker{border-color:var(--cui-good);background:var(--cui-good)}
.cui-process__step--review .cui-process__marker{border-color:var(--cui-warn);border-style:dashed}
.cui-process__step--current .cui-process__marker{border-color:var(--cui-ink)}
.cui-process__step--locked .cui-process__marker,.cui-process__step--blocked .cui-process__marker{border-color:var(--cui-line-2)}
.cui-process__copy h3{margin:0 0 3px;color:var(--cui-ink);font-size:var(--fs-body);font-weight:600;line-height:1.4}
.cui-process__step--done .cui-process__copy h3,.cui-process__step--locked .cui-process__copy h3{color:var(--cui-ink-2);font-weight:500}
.cui-process__copy>p{max-width:70ch;margin:0;color:var(--cui-ink-3);font-size:var(--fs-body);line-height:1.5}
.cui-process__optional{margin-left:6px;color:var(--cui-ink-3);font-size:var(--fs-fine);font-weight:400}
.cui-process__meta{display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;color:var(--cui-ink-3);font-size:var(--fs-fine);line-height:1.5}
.cui-process__meta span{display:inline-flex;gap:6px}
.cui-process__meta b{color:var(--cui-ink-2);font-weight:500}
.cui-process__action{display:flex;min-width:112px;align-items:flex-end;flex-direction:column;gap:7px}
.cui-process__status{padding:5px 9px;border:1px solid var(--cui-line-2);border-radius:6px;color:var(--cui-ink-2);
  font-family:"Roboto Condensed",sans-serif;font-size:var(--fs-fine);font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.cui-process__step--done .cui-process__status{border-color:#2C4433;color:var(--cui-good)}
.cui-process__step--review .cui-process__status{border-color:#4A3F16;color:var(--cui-warn)}
.cui-process__step--blocked .cui-process__status{border-color:#493334;color:#F0A3A3}
.cui-process__action small{max-width:22ch;color:var(--cui-ink-3);font-size:var(--fs-fine);line-height:1.4;text-align:right}
.cui-drawer-scrim{position:fixed;inset:0;z-index:210;background:rgba(0,0,0,.66)}
.cui-drawer{position:fixed;z-index:211;inset:0 0 0 auto;width:min(560px,100%);display:flex;flex-direction:column;
  border-left:1px solid var(--cui-line);background:var(--cui-bg);color:var(--cui-ink);box-shadow:-18px 0 48px rgba(0,0,0,.35)}
.cui-drawer__head{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;padding:16px 20px;
  border-bottom:1px solid var(--cui-line)}
.cui-drawer__head>span{color:var(--cui-ink-3);font-size:var(--fs-fine)}
.cui-drawer__head h2{margin:0;font-family:"Roboto Condensed",sans-serif;font-size:var(--fs-nav-side);font-weight:600;
  letter-spacing:.03em;text-transform:uppercase}
.cui-drawer__close{width:44px;height:44px;margin:-8px -10px -8px 0;display:grid;place-items:center;color:var(--cui-ink-2)}
.cui-drawer__close svg{width:20px;height:20px;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}
.cui-drawer__body{flex:1;overflow:auto;padding:20px;overscroll-behavior:contain}
.cui-drawer__intro{margin:0 0 20px;color:var(--cui-ink-2);font-size:var(--fs-body);line-height:1.6}
.cui-drawer__section{margin:0 0 20px}
.cui-drawer__section:last-child{margin-bottom:0}
.cui-drawer__section h3{margin:0 0 8px;color:var(--cui-ink);font-family:"Roboto Condensed",sans-serif;
  font-size:var(--fs-eyebrow);font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.cui-drawer__section ul,.cui-drawer__section ol{margin:0;padding-left:20px;color:var(--cui-ink-2);font-size:var(--fs-body);line-height:1.6}
.cui-drawer__section li+li{margin-top:7px}
.cui-drawer__truth{padding:14px 16px;border:1px solid var(--cui-line-2);border-radius:10px;background:var(--cui-panel);
  color:var(--cui-ink-2);font-size:var(--fs-body);line-height:1.55}
.cui-drawer__truth b{display:block;margin-bottom:4px;color:var(--cui-ink);font-weight:600}
.cui-drawer__foot{display:flex;align-items:center;gap:10px;padding:16px 20px;border-top:1px solid var(--cui-line)}
.cui-drawer__foot>span{margin-left:auto;color:var(--cui-ink-3);font-size:var(--fs-fine)}
@media(max-width:1100px){
  .cui-statgrid--4{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:1020px){
  .cui-page{--cui-gutter:0}
  #app:has(.cui-page) .dash{height:calc(100vh - 65px);grid-template-rows:auto minmax(0,1fr)}
  #app:has(.cui-page) .dash>.rail{height:auto;overflow-x:auto;overflow-y:hidden}
  #app:has(.cui-page) .dash>div{min-height:0}
}
@media(max-width:760px){
  .cui-header{padding:20px 18px 0}
  .cui-header__row{flex-direction:column;gap:16px}
  .cui-header__actions{width:100%;margin-left:0}
  .cui-header__actions .cui-button{flex:1}
  .cui-tabs{padding:0 8px}
  .cui-tab{min-height:46px;padding:0 12px}
  .cui-pane{padding:20px 18px 48px}
  .cui-statgrid--2,.cui-statgrid--3,.cui-statgrid--4{grid-template-columns:1fr}
  .cui-block__head{align-items:flex-start;flex-direction:column}
  .cui-tablewrap{overflow:visible;border:0;background:transparent}
  .cui-table,.cui-table tbody,.cui-table tr,.cui-table td{display:block;width:100%}
  .cui-table thead{display:none}
  .cui-table tbody{display:flex;flex-direction:column;gap:12px}
  .cui-table tr{overflow:hidden;border:1px solid var(--cui-line);border-radius:12px;background:var(--cui-panel)}
  .cui-table td{display:grid;grid-template-columns:minmax(96px,.8fr) minmax(0,1fr);gap:14px;padding:10px 14px;
    border-top:1px solid var(--cui-line);text-align:right}
  .cui-table td:first-child{border-top:0}
  .cui-table td::before{content:attr(data-label);align-self:start;text-align:left;color:var(--cui-ink-3);
    font-family:"Roboto Condensed",sans-serif;font-size:var(--fs-eyebrow);font-weight:600;letter-spacing:.06em;text-transform:uppercase}
  .cui-table td:last-child{text-align:right}
  .cui-process__step{grid-template-columns:24px minmax(0,1fr);padding:16px}
  .cui-process__action{grid-column:2;min-width:0;align-items:flex-start;flex-direction:row;flex-wrap:wrap}
  .cui-process__action small{max-width:none;text-align:left}
  .cui-process__action .cui-button{min-height:44px}
  .cui-drawer__foot{align-items:stretch;flex-direction:column}
  .cui-drawer__foot .cui-button{min-height:44px}
  .cui-drawer__foot>span{margin-left:0}
}
@media(max-width:480px){
  .cui-list__row{align-items:flex-start;flex-direction:column;gap:5px}
  .cui-list__value{white-space:normal}
}
@media(prefers-reduced-motion:reduce){.cui-scroll{scroll-behavior:auto}}
`;

window.COACH_UI = {
  html:html, Button:Button, PageHeader:PageHeader, TabStrip:TabStrip, Block:Block,
  StatCard:StatCard, StatGrid:StatGrid, ListCard:ListCard, DataTable:DataTable,
  Callout:Callout, Card:Card, EmptyState:EmptyState, ProgressCard:ProgressCard,
  ProcessPhases:ProcessPhases, Drawer:Drawer, Page:Page,
  activeTab:activeTab, writeTab:writeTab, clearTab:clearTab,
};
window.MOD_COACHUI = { css:CSS, wire:wire };

})();
