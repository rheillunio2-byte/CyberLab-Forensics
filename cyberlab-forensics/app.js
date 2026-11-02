/* CyberLab UI layer. All file-derived text is inserted with textContent (never innerHTML),
 * so specimen content can never become markup or script. Analysis lives in analysis.js. */
(function () {
'use strict';
const E = window.CyberLabEngine, PDF = window.CyberLabPDF;
const $ = id => document.getElementById(id);
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const state = { cases: [], current: null, busy: false, view: 'analyze', tab: 'info', strings: { q: '', tag: 'all', enc: 'all', min: 5, shown: 200 }, bf: { kind: 'all', cat: 'all' } };
const cur = () => state.cases.find(c => c.id === state.current) || null;

/* ---------- DOM helpers ---------- */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
    else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const svg = (tag, attrs) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v); return el; };
const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
const hex = n => '0x' + n.toString(16).toUpperCase();
const slug = s => s.toLowerCase().replace(/[^a-z]+/g, '-');
const fmtTime = t => new Date(t).toLocaleString();

/* ---------- Notifications, modal, tooltip, clipboard, download ---------- */
function toast(msg, type) {
  const box = $('toasts'); while (box.children.length >= 4) box.firstChild.remove();
  const t = h('div', { class: 'toast ' + (type || 'info'), role: 'status', onclick: () => t.remove() }, h('i', {}, { ok: '✓', warn: '△', error: '✕', info: '◈' }[type || 'info']), h('span', { text: msg }));
  box.append(t); setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3600);
}
let lastFocus = null, modalDone = null;
function modal(title, body, actions) {
  return new Promise(resolve => {
    lastFocus = document.activeElement; modalDone = resolve;
    $('modal-title').textContent = title; clear($('modal-body')).append(body); clear($('modal-actions'));
    actions.forEach(a => $('modal-actions').append(h('button', { class: 'action' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''), text: a.label, onclick: () => closeModal(a.value) })));
    $('modal').hidden = false; requestAnimationFrame(() => { $('modal').classList.add('open'); $('modal-actions').lastChild.focus(); });
  });
}
function closeModal(v) { $('modal').classList.remove('open'); $('modal').hidden = true; if (modalDone) modalDone(v); modalDone = null; if (lastFocus) lastFocus.focus(); }
const confirmBox = (title, text, label) => modal(title, h('p', { text }), [{ label: 'Cancel', value: false }, { label, value: true, primary: true, danger: true }]);
$('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(false); });
document.addEventListener('keydown', e => {
  if (!$('modal').hidden) { if (e.key === 'Escape') closeModal(false); if (e.key === 'Tab') { const f = [...$('modal').querySelectorAll('button')]; const i = f.indexOf(document.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); } }
});
function tip(e, text) { const t = $('tooltip'); t.textContent = text; t.hidden = false; const x = Math.min(e.clientX + 14, window.innerWidth - t.offsetWidth - 8); t.style.setProperty('left', x + 'px'); t.style.setProperty('top', (e.clientY - 38) + 'px'); }
const hideTip = () => { $('tooltip').hidden = true; };
async function copyText(text, btn, okMsg) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) { const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }); ta.value = text; document.body.append(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (x) { /* ignored */ } ta.remove(); if (!ok) { toast('Clipboard unavailable. Select the text and copy manually.', 'error'); return; } }
  toast(okMsg || 'Copied to clipboard.', 'ok');
  if (btn) { const old = btn.textContent; btn.textContent = 'COPIED ✓'; btn.classList.add('done'); setTimeout(() => { btn.textContent = old; btn.classList.remove('done'); }, 1300); }
}
const copyBtn = (label, getText, msg) => h('button', { class: 'copy', text: label, onclick: e => copyText(getText(), e.currentTarget, msg) });
function download(name, blob) { const url = URL.createObjectURL(blob), a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); }

/* ---------- Counters ---------- */
function countTo(el, to, dec) {
  dec = dec || 0; const from = parseFloat(el.dataset.v || '0') || 0; el.dataset.v = to;
  const set = v => { el.textContent = dec ? v.toFixed(dec) : Math.round(v).toLocaleString(); };
  if (REDUCED || from === to) { set(to); return; }
  const t0 = performance.now(), dur = 750;
  (function step(t) { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); set(from + (to - from) * e); if (p < 1) requestAnimationFrame(step); })(t0);
}
const counter = (to, dec) => { const s = h('span', { class: 'num' }); countTo(s, to, dec); return s; };

/* ---------- Navigation (radial) ---------- */
const ORDER = ['analyze', 'specimen', 'behavior', 'reports'], ANGLE = { analyze: -90, specimen: 0, behavior: 90, reports: 180 };
let arm = -90, navToken = 0;
function setArm(view) { const d = ((ANGLE[view] - arm) % 360 + 540) % 360 - 180; arm += d; $('orbit-arm').style.setProperty('--ang', arm + 'deg'); }
function go(id, opts) {
  if (!ORDER.includes(id)) return; opts = opts || {};
  if (id === state.view && !opts.force) return;
  const token = ++navToken, prev = $(state.view), next = $(id);
  state.view = id; setArm(id);
  document.querySelectorAll('[data-view]').forEach(b => { const on = b.dataset.view === id; b.classList.toggle('active', on); on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); });
  if (location.hash.slice(1) !== id) history.pushState(null, '', '#' + id);
  const show = () => { if (token !== navToken) return; document.querySelectorAll('.view').forEach(v => { v.classList.remove('active', 'leaving'); }); next.classList.add('active'); if (id === 'behavior') replayTimeline(); if (!opts.silent) next.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }); };
  if (prev !== next && !REDUCED && !opts.silent) { prev.classList.add('leaving'); setTimeout(show, 170); } else show();
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
document.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => go(b.dataset.jump)));
window.addEventListener('hashchange', () => go(location.hash.slice(1)));
document.addEventListener('keydown', e => {
  if (!$('modal').hidden || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
  if (e.key >= '1' && e.key <= '4') go(ORDER[+e.key - 1]);
  if (document.activeElement.closest && document.activeElement.closest('#orbit') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { const i = ORDER.indexOf(state.view), n = ORDER[(i + (e.key === 'ArrowRight' ? 1 : 3)) % 4]; go(n); document.querySelector('#orbit [data-view="' + n + '"]').focus(); }
});
new IntersectionObserver(([en]) => $('dock').classList.toggle('show', !en.isIntersecting), { threshold: 0.05 }).observe(document.querySelector('.hero'));
function clock() { $('clock').textContent = new Date().toLocaleTimeString(); } clock(); setInterval(clock, 1000);
$('safety-btn').addEventListener('click', () => modal('Safety model', h('div', { class: 'modal-list' },
  ['Files are read as bytes by the browser File API and are never executed, opened, rendered or emulated.', 'A strict Content-Security-Policy blocks all network requests and inline scripts, so nothing can be uploaded.', 'Extracted text is displayed with textContent, so specimen content cannot become markup.', 'Results are heuristic. A clean result does not prove safety and a flagged one does not prove malice.', 'Analyses live in memory only and disappear when you close or reload the tab.'].map(t => h('p', { text: '◈ ' + t }))), [{ label: 'Close', value: true, primary: true }]));

/* ---------- Charts ---------- */
function gauge(value, level, big) {
  const L = Math.PI * 80, s = svg('svg', { viewBox: '0 0 200 118', class: 'gauge' + (big ? ' big' : ''), role: 'img', 'aria-label': 'Heuristic indicator level ' + level + ', ' + value + ' of 100' });
  const d = 'M20 100 A80 80 0 0 1 180 100';
  const fg = svg('path', { d, class: 'g-fg lvl-' + level.toLowerCase(), fill: 'none', 'stroke-width': 14, 'stroke-linecap': 'round', 'stroke-dasharray': L, 'stroke-dashoffset': L });
  s.append(svg('path', { d, class: 'g-bg', fill: 'none', 'stroke-width': 14, 'stroke-linecap': 'round' }), fg);
  const num = svg('text', { x: 100, y: 92, 'text-anchor': 'middle', class: 'g-num' }), lab = svg('text', { x: 100, y: 112, 'text-anchor': 'middle', class: 'g-lab' }); num.textContent = '0'; lab.textContent = level.toUpperCase();
  s.append(num, lab);
  requestAnimationFrame(() => requestAnimationFrame(() => { fg.style.setProperty('stroke-dashoffset', REDUCED ? L * (1 - value / 100) : L * (1 - value / 100)); countTo(num, value); }));
  return s;
}
function barChart(vals, o) { // o: {max, h, cls(i), tip(i), label}
  const n = vals.length, W = 640, H = 150, bw = W / n, s = svg('svg', { viewBox: `0 0 ${W} ${H + 18}`, class: 'chart', role: 'img', 'aria-label': o.label, preserveAspectRatio: 'none' });
  (o.lines || []).forEach(l => { const y = H - l.v / o.max * (H - 14); s.append(svg('line', { x1: 0, x2: W, y1: y, y2: y, class: 'c-line' })); const t = svg('text', { x: W - 4, y: y - 3, 'text-anchor': 'end', class: 'c-lab' }); t.textContent = l.t; s.append(t); });
  vals.forEach((v, i) => {
    const bh = Math.max(1.5, v / o.max * (H - 14)), r = svg('rect', { x: i * bw + (n > 100 ? 0 : 1), y: H - bh, width: Math.max(1, bw - (n > 100 ? 0.4 : 2)), height: bh, rx: n > 100 ? 0 : 2, class: 'c-bar ' + o.cls(i) });
    r.style.setProperty('animation-delay', REDUCED ? '0ms' : (i * (600 / n)) + 'ms');
    r.addEventListener('mousemove', e => { tip(e, o.tip(i)); r.classList.add('hot'); }); r.addEventListener('mouseleave', () => { hideTip(); r.classList.remove('hot'); });
    s.append(r);
  });
  return s;
}

/* ---------- Dashboard / intake ---------- */
function buildStats() {
  const defs = [['spec', 'SPECIMENS ANALYZED', 'this session'], ['ind', 'INDICATORS DETECTED', 'current specimen'], ['str', 'STRINGS EXTRACTED', 'current specimen'], ['ent', 'ENTROPY (BITS/BYTE)', 'current specimen']];
  const box = clear($('stats'));
  defs.forEach(([k, label, sub]) => box.append(h('div', { class: 'stat', 'data-k': k }, h('label', { text: label }), h('strong', {}, h('span', { class: 'num', id: 'st-' + k, 'data-v': '0', text: '0' })), h('small', { id: 'sub-' + k, text: sub }))));
  box.append(h('div', { class: 'chips' }, h('span', { class: 'chip', id: 'chip-engine' }, h('i'), 'Engine ', h('b', { id: 'chip-engine-t', text: 'idle' })), h('span', { class: 'chip ok' }, h('i'), 'Execution ', h('b', { text: 'none' })), h('span', { class: 'chip ok', 'data-tip': 'Enforced by the page Content-Security-Policy' }, h('i'), 'Network ', h('b', { text: 'blocked' })), h('span', { class: 'chip', id: 'chip-level' }, h('i'), 'Indicator level ', h('b', { id: 'chip-level-t', text: '—' }))));
}
function renderStats() {
  const r = cur();
  countTo($('st-spec'), state.cases.length); countTo($('st-ind'), r ? r.indicators.length : 0); countTo($('st-str'), r ? r.strings.total : 0); countTo($('st-ent'), r ? r.entropy.overall : 0, 2);
  $('sub-ind').textContent = r ? 'in ' + r.file.name : 'current specimen'; $('sub-str').textContent = r ? (r.strings.items.length < r.strings.total ? r.strings.items.length + ' retained for browsing' : 'all retained for browsing') : 'current specimen'; $('sub-ent').textContent = r ? r.entropy.band : 'current specimen';
  $('chip-level-t').textContent = r ? r.score.level : '—'; $('chip-level').className = 'chip ' + (r ? 'lvl-' + r.score.level.toLowerCase() : '');
  const t = state.busy ? 'ANALYZING…' : r ? 'SPECIMEN READY' : 'ENGINE IDLE';
  $('engine-state').textContent = t; $('chip-engine-t').textContent = state.busy ? 'analyzing' : r ? 'ready' : 'idle'; $('chip-engine').className = 'chip ' + (state.busy ? 'busy' : 'ok'); $('engine-led').classList.toggle('busy', state.busy);
}
function renderCurrentCard() {
  const box = clear($('current-card')), r = cur(); if (!r) return;
  box.append(h('div', { class: 'current-card' }, h('div', { class: 'ext-badge', text: r.file.ext ? '.' + r.file.ext.slice(0, 5) : 'FILE' }), h('div', { class: 'cc-main' }, h('b', { text: r.file.name }), h('small', { text: E.fmtSize(r.size) + ' · ' + r.format + ' · analyzed ' + new Date(r.createdAt).toLocaleTimeString() })), h('span', { class: 'badge lvl-' + r.score.level.toLowerCase(), text: r.score.level + ' · ' + r.indicators.length + ' indicator' + (r.indicators.length === 1 ? '' : 's') }), h('button', { class: 'action', text: 'OPEN DOSSIER ↗', onclick: () => go('specimen') })));
}
const STAGES = [['read', 'Read bytes', .2], ['hash', 'SHA-256 fingerprint', .1], ['sig', 'File signatures', .05], ['entropy', 'Entropy profile', .25], ['strings', 'Strings & keywords', .4]];
function showError(msg) { const e = $('drop-error'); e.hidden = false; clear(e).append(h('b', { text: '△ Specimen rejected' }), h('p', { text: msg }), h('button', { class: 'action', text: 'TRY ANOTHER FILE', onclick: () => { e.hidden = true; $('dropzone').dataset.state = 'idle'; } })); $('dropzone').dataset.state = 'error'; $('drop-idle').hidden = true; toast(msg, 'error'); }
function resetDrop() { $('drop-error').hidden = true; $('drop-busy').hidden = true; $('drop-idle').hidden = false; $('dropzone').dataset.state = 'idle'; }
async function handleFile(file, opts) {
  if (!file) return; if (state.busy) { toast('An analysis is already running.', 'warn'); return; }
  resetDrop();
  if (file.size === 0) { showError('The file is empty (0 bytes), so there is nothing to inspect.'); return; }
  if (file.size > E.LIMITS.maxBytes) { showError('"' + file.name + '" is ' + E.fmtSize(file.size) + '. The inspection limit is 25 MB.'); return; }
  state.busy = true; renderStats(); go('analyze', { silent: true });
  const bar = h('div', { class: 'bar' }, h('i')), pct = h('b', { text: '0%' }), rows = STAGES.map(s => h('li', { 'data-s': s[0], class: 'pending' }, h('span', { class: 'dot' }), s[1], h('em')));
  const ext = file.name.includes('.') ? '.' + file.name.split('.').pop().slice(0, 6) : 'FILE';
  clear($('drop-busy')).append(h('div', { class: 'busy-file' }, h('div', { class: 'ext-badge', text: ext }), h('div', {}, h('b', { text: file.name }), h('small', { text: E.fmtSize(file.size) + ' · ' + (file.type || 'type not declared') }))), h('div', { class: 'busy-head' }, h('span', { text: 'STATIC INSPECTION IN PROGRESS' }), pct), bar, h('ul', { class: 'stage-list' }, rows), h('p', { class: 'busy-note', text: 'The specimen is only being read as data. Nothing is executed or transmitted.' }));
  $('drop-idle').hidden = true; $('drop-busy').hidden = false; $('dropzone').dataset.state = 'busy';
  const t0 = performance.now(); let result = null, failure = null;
  const onProgress = ({ stage, frac }) => {
    let done = 0, idx = STAGES.findIndex(s => s[0] === stage); if (stage === 'done') idx = STAGES.length;
    STAGES.forEach((s, i) => { if (i < idx) done += s[2]; else if (i === idx) done += s[2] * frac; const li = rows[i]; li.className = i < idx ? 'done' : i === idx ? 'active' : 'pending'; li.lastChild.textContent = i === idx ? Math.round(frac * 100) + '%' : i < idx ? '✓' : ''; });
    const p = Math.min(100, Math.round(done * 100)); bar.firstChild.style.setProperty('width', p + '%'); pct.textContent = p + '%';
  };
  try { result = await E.analyze(file, onProgress, opts); } catch (e) { failure = e; }
  if (!REDUCED) await sleep(Math.max(0, 900 - (performance.now() - t0)));
  state.busy = false;
  if (failure) { showError(failure.message || 'Analysis failed.'); renderStats(); return; }
  onProgress({ stage: 'done', frac: 1 }); await sleep(REDUCED ? 0 : 350);
  state.cases.push(result); if (state.cases.length > 10) state.cases.shift(); state.current = result.id; state.tab = 'info'; state.strings = { q: '', tag: 'all', enc: 'all', min: 5, shown: 200 };
  renderAll(); resetDrop(); toast('Static inspection complete. The sample was not executed.', 'ok'); go('specimen');
}
const dz = $('dropzone');
['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); if (!state.busy) dz.classList.add('drag'); }));
['dragleave', 'drop'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.remove('drag'); }));
dz.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files; if (!f || !f.length) { showError('No readable file was dropped. Folders are not supported.'); return; } if (f.length > 1) toast('Only the first of ' + f.length + ' files will be analyzed.', 'warn'); handleFile(f[0]); });
['dragover', 'drop'].forEach(t => window.addEventListener(t, e => e.preventDefault())); // never let the browser open a dropped file
$('file-input').addEventListener('change', e => { handleFile(e.target.files[0]); e.target.value = ''; });
const demo = (name, text) => handleFile(new File([new Blob([text], { type: 'text/plain' })], name, { type: 'text/plain' }), { demo: true });
$('demo-btn').addEventListener('click', () => demo('harmless-demo.txt', 'CYBERLAB HARMLESS DEMO FILE\nThis is a plain text specimen for static inspection only.\nExample URL: https://example.invalid/demo\nNo executable instructions are included.\n'));
$('demo-btn-2').addEventListener('click', () => demo('indicator-showcase.txt', 'CYBERLAB INDICATOR SHOWCASE (harmless text)\nThese lines are only words that match the keyword heuristics.\npowershell -EncodedCommand AAAA\nhttps://example.invalid/payload\nSoftware\\Microsoft\\Windows\\CurrentVersion\\Run\nVirtualAlloc WriteProcessMemory CreateRemoteThread\nkeylog password schtasks /create\nServer 10.20.30.40\n'));

/* ---------- Specimen dossier ---------- */
const TABS = [['info', 'File information'], ['static', 'Static analysis'], ['strings', 'Strings'], ['assess', 'Security assessment']];
function kvRow(k, v, extra) { return h('div', { class: 'kv' }, h('span', { text: k, 'data-tip': extra }), h('b', { text: v })); }
function renderSpecimen() {
  const r = cur(), box = $('specimen-data'); $('empty-specimen').hidden = !!r; box.hidden = !r; $('spec-status').textContent = r ? 'SPECIMEN LOADED' : 'AWAITING SPECIMEN';
  if (!r) return; clear(box);
  box.append(h('div', { class: 'specimen-banner' }, h('div', {}, h('div', { class: 'kicker', text: 'CURRENT SPECIMEN · ' + r.caseId }), h('h3', { id: 'file-name', text: r.file.name }), h('p', { id: 'file-meta', text: r.file.mime + '  /  ' + fmtTime(r.createdAt) + '  /  ' + (r.demo ? 'BUILT-IN DEMO' : 'LOCAL FILE') })), h('div', { class: 'banner-side' }, h('span', { class: 'badge lvl-' + r.score.level.toLowerCase(), text: r.score.level + ' indicator level' }), h('button', { class: 'copy', text: 'COPY TECHNICAL SUMMARY', onclick: e => copyText(E.reportText(r), e.currentTarget, 'Technical summary copied.') })), h('div', { class: 'file-emblem', text: (r.file.ext || 'file').slice(0, 5).toUpperCase() })));
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, l]) => h('button', { role: 'tab', 'data-tab': k, class: k === state.tab ? 'on' : '', 'aria-selected': k === state.tab ? 'true' : 'false', onclick: () => setTab(k) }, l, k === 'assess' ? h('em', { text: r.indicators.length }) : k === 'strings' ? h('em', { text: r.strings.total > 999 ? '999+' : r.strings.total }) : null)));
  box.append(tabs, h('div', { class: 'tab-panel', 'data-p': 'info' }, infoTab(r)), h('div', { class: 'tab-panel', 'data-p': 'static' }, staticTab(r)), h('div', { class: 'tab-panel', 'data-p': 'strings' }, stringsTab(r)), h('div', { class: 'tab-panel', 'data-p': 'assess' }, assessTab(r)));
  setTab(state.tab, true);
}
function setTab(k, quiet) {
  state.tab = k; document.querySelectorAll('#specimen-data .tabs button').forEach(b => { const on = b.dataset.tab === k; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  document.querySelectorAll('#specimen-data .tab-panel').forEach(p => { p.hidden = p.dataset.p !== k; });
  if (k === 'strings' && !quiet) refreshStrings();
}
function infoTab(r) {
  const meter = (h_) => h('div', { class: 'meter' }, h('i', { style: { left: Math.min(100, h_ / 8 * 100) + '%' } }));
  return h('div', {},
    h('div', { class: 'data-grid' },
      h('article', { class: 'data-card' }, h('label', { text: 'FILE SIZE' }), h('strong', { id: 'size', text: E.fmtSize(r.size) }), h('small', { text: r.size.toLocaleString() + ' bytes' })),
      h('article', { class: 'data-card' }, h('label', { text: 'FORMAT' }), h('strong', { id: 'format', class: 'sm', text: r.format }), h('small', { text: r.signature.matched ? 'Matched by signature' : 'Heuristic guess' })),
      h('article', { class: 'data-card' }, h('label', { text: 'ENTROPY' }), h('strong', {}, counter(r.entropy.overall, 3)), meter(r.entropy.overall), h('small', { id: 'entropy-note', text: r.entropy.band })),
      h('article', { class: 'data-card' }, h('label', { text: 'INDICATORS' }), h('strong', {}, counter(r.indicators.length)), h('small', { text: r.strings.total.toLocaleString() + ' strings extracted' })),
      h('article', { class: 'data-card wide' }, h('label', { text: 'SHA-256 FINGERPRINT' }), h('code', { id: 'sha', text: r.sha256 }), copyBtn('COPY HASH', () => r.sha256, 'SHA-256 copied.'), h('small', { text: 'Computed with: ' + r.hashMethod }))),
    h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, 'FILE INFORMATION', copyBtn('COPY', () => ['Name: ' + r.file.name, 'Size: ' + r.size + ' bytes', 'Extension: ' + (r.file.ext || 'none'), 'MIME: ' + r.file.mime, 'Format: ' + r.format, 'SHA-256: ' + r.sha256].join('\n'), 'File information copied.')),
      h('div', { class: 'kv-grid' }, kvRow('File name', r.file.name), kvRow('File size', E.fmtSize(r.size) + ' (' + r.size.toLocaleString() + ' B)'), kvRow('Extension', r.file.ext ? '.' + r.file.ext : 'none'), kvRow('Declared MIME type', r.file.mime, 'Guessed by the browser from the extension; not verified.'), kvRow('Identified format', r.format), kvRow('First 16 bytes', r.magicHex), kvRow('Last modified', r.file.lastModified ? fmtTime(r.file.lastModified) : 'not available'), kvRow('Analyzed', fmtTime(r.createdAt) + ' (' + r.durationMs + ' ms)'))));
}
function staticTab(r) {
  const e = r.entropy, wrap = h('div', {}), chart = h('div', { class: 'chart-wrap' });
  const drawProfile = () => { clear(chart).append(barChart(e.blocks.map(b => b.h), { max: 8, label: 'Entropy per block across the file', cls: i => e.blocks[i].h > 7 ? 'hi' : e.blocks[i].h > 5 ? 'mid' : 'lo', lines: [{ v: 7, t: '7.0' }, { v: 4, t: '4.0' }], tip: i => 'Block ' + (i + 1) + '/' + e.blocks.length + ' · ' + hex(e.blocks[i].start) + '–' + hex(e.blocks[i].end) + ' · ' + e.blocks[i].h.toFixed(2) + ' bits/byte' })); };
  const drawHist = () => { const mx = Math.sqrt(Math.max(...e.histogram, 1)), tot = r.size; clear(chart).append(barChart(e.histogram.map(Math.sqrt), { max: mx, label: 'Byte value distribution (square-root scale)', cls: i => i === 0 ? 'zero' : i >= 32 && i < 127 ? 'lo' : 'dim', tip: i => 'Byte ' + hex(i) + (i >= 32 && i < 127 ? " ('" + String.fromCharCode(i) + "')" : '') + ' · ' + e.histogram[i].toLocaleString() + ' (' + (e.histogram[i] / tot * 100).toFixed(2) + '%)' })); };
  const seg = h('div', { class: 'seg' }, h('button', { class: 'on', text: 'Entropy profile', onclick: ev => { seg.querySelectorAll('button').forEach(b => b.classList.remove('on')); ev.currentTarget.classList.add('on'); drawProfile(); } }), h('button', { text: 'Byte distribution', onclick: ev => { seg.querySelectorAll('button').forEach(b => b.classList.remove('on')); ev.currentTarget.classList.add('on'); drawHist(); } }));
  drawProfile();
  wrap.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, 'ENTROPY ESTIMATE', h('span', { text: 'HEURISTIC · HOVER THE CHART' })), h('div', { class: 'entropy-head' }, h('div', {}, h('strong', { class: 'big' }, counter(e.overall, 3)), h('small', { text: ' bits per byte (max 8)' }), h('p', { text: e.band })), seg), chart));
  const sigPanel = h('div', { class: 'panel' }, h('div', { class: 'panel-title', text: 'FILE SIGNATURE' }), h('div', { class: 'kv-grid' }, kvRow('Identified as', r.format), kvRow('Method', r.signature.matched ? 'Magic-byte match' : 'Content heuristic'), kvRow('Leading bytes', r.magicHex), kvRow('Extension check', (() => { const i = r.indicators.find(x => x.id === 'ext-mismatch'); return i ? 'MISMATCH — ' + i.evidence : r.file.ext ? 'No conflict found for .' + r.file.ext : 'No extension'; })())));
  wrap.append(sigPanel);
  const pe = r.structure.pe, elf = r.structure.elf;
  if (pe && pe.valid) wrap.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title', text: 'PE STRUCTURE' }, h('span', { text: 'PARSED FROM HEADERS' })), h('div', { class: 'kv-grid' }, kvRow('Format', pe.bits + (pe.isDll ? ' DLL' : ' executable')), kvRow('Machine', pe.machine), kvRow('Subsystem', pe.subsystem), kvRow('Compile timestamp (claimed)', pe.timestamp ? new Date(pe.timestamp * 1000).toISOString().slice(0, 10) : 'not set', 'Can be forged; do not rely on it.')), pe.sections.length ? h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['Section', 'Raw size', 'Flags', 'Entropy'].map(t => h('th', { text: t })))), h('tbody', {}, pe.sections.map(s => h('tr', {}, h('td', { text: s.name }), h('td', { text: s.rawSize.toLocaleString() }), h('td', { text: (s.exec ? 'X ' : '') + (s.write ? 'W' : '') || '—' }), h('td', { class: s.entropy > 7 ? 'hot' : '', text: s.entropy.toFixed(2) }))))) : null));
  else if (pe) wrap.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title', text: 'PE STRUCTURE' }), h('p', { class: 'muted', text: 'The file starts with MZ but no valid PE header was found (could be a DOS program or a damaged file).' })));
  if (elf) wrap.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title', text: 'ELF STRUCTURE' }), h('div', { class: 'kv-grid' }, kvRow('Class', elf.bits), kvRow('Byte order', elf.endian), kvRow('Type', elf.type), kvRow('Machine', elf.machine))));
  const hits = r.strings.hits, groups = {}; hits.forEach(k => (groups[k.group] = groups[k.group] || []).push(k));
  wrap.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, 'SUSPICIOUS KEYWORDS', h('span', { text: hits.length + ' TERM(S) · CONTEXT UNKNOWN' })),
    hits.length ? h('div', { class: 'kw-groups' }, Object.entries(groups).map(([g, list]) => h('div', { class: 'kw-group' }, h('h4', { text: E.GROUP_LABEL[g] || g }), list.map(k => h('div', { class: 'kw' }, h('span', { class: 'sev ' + k.severity, text: k.severity }), h('div', {}, h('b', { text: k.label }), h('code', { text: k.term }), h('small', { text: k.count + '× · first at ' + hex(k.offset) })), h('button', { class: 'copy', text: 'FIND', 'data-tip': 'Search the strings list', onclick: () => { state.strings.q = k.term; state.strings.tag = 'all'; setTab('strings'); syncStringControls(); refreshStrings(); } })))))) : h('p', { class: 'muted', text: 'No listed keyword appeared in the extracted strings. This does not mean the file is safe.' })));
  wrap.append(h('div', { class: 'panel' }, h('div', { class: 'panel-title', text: 'ANALYSIS CHECKS PERFORMED' }), h('div', { class: 'indicators' }, r.checks.map(([a, b]) => h('div', { class: 'indicator' }, h('span', { class: 'mark', text: '✓' }), h('div', {}, h('b', { text: a }), h('small', { text: b })))))));
  return wrap;
}
/* Strings tab: search, filters, highlight, copy */
function filteredStrings(r) { const f = state.strings, q = f.q.toLowerCase(); return r.strings.items.filter(s => (f.tag === 'all' || s.tag === f.tag) && (f.enc === 'all' || s.enc === f.enc) && s.text.length >= f.min && (!q || s.text.toLowerCase().includes(q))); }
function highlight(text, q) { if (!q) return text; const out = [], lo = text.toLowerCase(), ql = q.toLowerCase(); let i = 0, j; while ((j = lo.indexOf(ql, i)) >= 0) { out.push(text.slice(i, j), h('mark', { text: text.slice(j, j + q.length) })); i = j + q.length; } out.push(text.slice(i)); return out; }
function stringsTab(r) {
  const tags = Object.entries(r.strings.tags).sort((a, b) => b[1] - a[1]), f = state.strings;
  return h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, 'READABLE STRINGS', h('span', { id: 'str-note', text: '' })),
    h('div', { class: 'str-tools' },
      h('input', { id: 'str-q', type: 'search', placeholder: 'Search strings…', 'aria-label': 'Search strings', value: f.q, oninput: debounce(e => { state.strings.q = e.target.value; state.strings.shown = 200; refreshStrings(); }, 120) }),
      h('select', { id: 'str-enc', 'aria-label': 'Encoding', onchange: e => { state.strings.enc = e.target.value; state.strings.shown = 200; refreshStrings(); } }, h('option', { value: 'all', text: 'ASCII + UTF-16' }), h('option', { value: 'ascii', text: 'ASCII only' }), h('option', { value: 'utf16', text: 'UTF-16LE only' })),
      h('label', { class: 'minlen' }, 'Min length ', h('b', { id: 'str-min-t', text: f.min }), h('input', { id: 'str-min', type: 'range', min: 5, max: 40, value: f.min, oninput: e => { state.strings.min = +e.target.value; $('str-min-t').textContent = e.target.value; state.strings.shown = 200; refreshStrings(); } })),
      h('button', { class: 'copy', text: 'COPY FILTERED', onclick: e => { const l = filteredStrings(r).slice(0, 1000); copyText(l.map(s => s.text).join('\n'), e.currentTarget, l.length + ' string(s) copied.'); } })),
    h('div', { class: 'chip-row', id: 'str-tags' }, [['all', 'All', r.strings.items.length], ...tags.map(([t, n]) => [t, E.GROUP_LABEL[t] || (t === 'path' ? 'Paths' : 'Other'), n])].map(([t, l, n]) => h('button', { class: 'fchip' + (f.tag === t ? ' on' : ''), 'data-tag': t, onclick: () => { state.strings.tag = t; state.strings.shown = 200; syncStringControls(); refreshStrings(); } }, l, h('em', { text: n })))),
    h('div', { class: 'str-list', id: 'str-list' }), h('div', { class: 'more-row', id: 'str-more' }));
}
function syncStringControls() { const f = state.strings; if ($('str-q')) { $('str-q').value = f.q; $('str-enc').value = f.enc; $('str-min').value = f.min; $('str-min-t').textContent = f.min; document.querySelectorAll('#str-tags .fchip').forEach(c => c.classList.toggle('on', c.dataset.tag === f.tag)); } }
function refreshStrings() {
  const r = cur(); if (!r || !$('str-list')) return; const list = filteredStrings(r), f = state.strings, box = clear($('str-list'));
  $('str-note').textContent = list.length.toLocaleString() + ' MATCH' + (list.length === 1 ? '' : 'ES') + (r.strings.truncated ? ' · FIRST ' + r.strings.items.length + ' OF ' + r.strings.total.toLocaleString() + ' RETAINED' : '');
  if (!list.length) box.append(h('div', { class: 'empty-mini', text: r.strings.items.length ? 'No strings match the current filters.' : 'No printable strings of 5+ characters were found.' }));
  list.slice(0, f.shown).forEach(s => box.append(h('div', { class: 'str-row' }, h('code', { class: 'off', text: hex(s.offset) }), h('span', { class: 'enc', text: s.enc === 'utf16' ? 'U16' : 'ASC' }), h('span', { class: 'txt' }, highlight(s.text, f.q)), s.tag !== 'text' ? h('span', { class: 'tag t-' + s.tag, text: E.GROUP_LABEL[s.tag] || s.tag }) : null, h('button', { class: 'copy mini', text: 'COPY', 'aria-label': 'Copy string', onclick: e => copyText(s.text, e.currentTarget, 'String copied.') }))));
  clear($('str-more')); if (list.length > f.shown) $('str-more').append(h('button', { class: 'action', text: 'SHOW ' + Math.min(200, list.length - f.shown) + ' MORE', onclick: () => { state.strings.shown += 200; refreshStrings(); } }));
}
function debounce(fn, ms) { let t; return e => { clearTimeout(t); t = setTimeout(() => fn(e), ms); }; }
function assessTab(r) {
  const sorted = [...r.indicators].sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]));
  const top = r.score.breakdown.sort((a, b) => b.points - a.points), mx = Math.max(1, ...top.map(t => t.points));
  const summary = r.indicators.length ? r.indicators.length + ' static indicator' + (r.indicators.length === 1 ? ' was' : 's were') + ' detected, mostly in: ' + top.slice(0, 2).map(t => t.category.toLowerCase()).join(' and ') + '. The heuristic indicator level is ' + r.score.level.toLowerCase() + ' (' + r.score.value + '/100). Many of these clues also occur in legitimate software.' : 'No listed static indicator matched. This does not establish that the file is safe; it only means these basic checks found nothing to flag.';
  return h('div', {}, h('div', { class: 'assess-top' },
    h('div', { class: 'panel gauge-panel' }, gauge(r.score.value, r.score.level, true), h('small', { text: 'HEURISTIC INDICATOR LEVEL — NOT A VERDICT' })),
    h('div', { class: 'panel' }, h('div', { class: 'panel-title', text: 'ANALYSIS SUMMARY' }), h('p', { class: 'summary', text: summary }),
      h('div', { class: 'breakdown' }, top.length ? top.map(t => h('div', { class: 'bd' }, h('span', { text: t.category }), h('div', { class: 'track' }, h('i', { style: { width: (t.points / mx * 100) + '%' } })), h('b', { text: '+' + t.points }))) : h('small', { class: 'muted', text: 'Nothing contributed to the score.' })))),
    h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, 'DETECTED INDICATORS', h('span', { text: r.indicators.length + ' STATIC FINDING(S) · TAP TO EXPAND' })),
      sorted.length ? sorted.map(i => h('details', { class: 'ind-card ' + i.severity, id: 'ind-' + i.id.replace(/[^\w-]/g, '_') }, h('summary', {}, h('span', { class: 'sev ' + i.severity, text: i.severity }), h('b', { text: i.title }), h('em', { text: i.category }), h('span', { class: 'pts', text: '+' + i.points })),
        h('div', { class: 'ind-body' }, h('p', {}, h('strong', { text: 'Evidence: ' }), i.evidence), h('p', {}, h('strong', { text: 'Why it may matter: ' }), i.why), h('p', {}, h('strong', { text: 'Benign explanations: ' }), i.benign), h('span', { class: 'kind', text: 'DETECTED STATIC INDICATOR' })))) : h('div', { class: 'empty-mini', text: 'No indicators to show.' })));
}
function openIndicator(id) { setTab('assess'); go('specimen'); const el = $('ind-' + id.replace(/[^\w-]/g, '_')); if (el) { el.open = true; el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); } }

/* ---------- Behavior observatory ---------- */
const CATS = ['Execution', 'Network', 'Persistence', 'Obfuscation', 'Credential access', 'Document-borne code', 'Impact'];
const KINDS = { static: ['Detected static', 'Actually performed or found by CyberLab in the bytes.'], inferred: ['Inferred', 'A hypothesis derived from static indicators. Not observed.'], illustrative: ['Illustrative', 'A teaching scenario. Not observed and not a prediction.'] };
function behaviorEvents(r) {
  const ev = [], order = ['Document-borne code', 'Execution', 'Persistence', 'Obfuscation', 'Credential access', 'Network', 'Impact'];
  r.stageLog.forEach(s => ev.push({ kind: 'static', cat: 'Analysis', title: s.label, text: s.detail, meta: 'T+' + s.ms + ' ms (real analysis time)' }));
  ev.push({ kind: 'static', cat: 'Analysis', title: r.indicators.length + ' static indicator' + (r.indicators.length === 1 ? '' : 's') + ' detected', text: r.indicators.length ? 'Click an item below to view it in the assessment.' : 'No listed indicator matched.', links: r.indicators.map(i => i.id), linkTitles: r.indicators.map(i => i.title) });
  r.behavior.forEach(b => ev.push({ kind: 'inferred', cat: b.category, title: b.category + ' — ' + b.strength.toLowerCase() + ' basis', text: b.statement, why: b.why, benign: b.benign, verify: b.verify, links: b.basis, linkTitles: b.basisTitles }));
  const present = order.filter(c => r.behavior.some(b => b.category === c));
  if (!present.length) ev.push({ kind: 'illustrative', cat: 'Baseline', title: 'No scenario suggested', text: 'No static clue maps to a behavior hypothesis, so there is nothing to illustrate. Only run-time analysis in a managed lab could say more.', verify: 'Dynamic analysis in an isolated sandbox with snapshots.' });
  present.forEach((c, i) => { const b = r.behavior.find(x => x.category === c); ev.push({ kind: 'illustrative', cat: c, title: 'Scenario step ' + (i + 1) + ': ' + c, text: 'Illustration only: if a file with these clues were run in a lab, an analyst would look for ' + c.toLowerCase() + ' activity at this stage.', why: 'Included because: ' + b.why, benign: b.benign, verify: b.verify }); });
  return ev;
}
function renderBehavior() {
  const r = cur(), box = $('behavior-data'); $('empty-behavior').hidden = !!r; box.hidden = !r; if (!r) return; clear(box);
  const events = behaviorEvents(r), counts = k => events.filter(e => k === 'all' || e.kind === k).length;
  const kindChips = h('div', { class: 'chip-row' }, ['all', 'static', 'inferred', 'illustrative'].map(k => h('button', { class: 'fchip k-' + k + (state.bf.kind === k ? ' on' : ''), 'data-kind': k, 'data-tip': k === 'all' ? 'Everything' : KINDS[k][1], onclick: () => { state.bf.kind = k; applyBF(); } }, k === 'all' ? 'All events' : KINDS[k][0], h('em', { text: counts(k) }))));
  const list = h('div', { class: 'timeline', id: 'timeline' }, events.map((e, i) => {
    const det = h('div', { class: 'ev-detail' }, e.why ? h('p', {}, h('strong', { text: 'Why this may be suspicious: ' }), e.why) : null, e.benign ? h('p', {}, h('strong', { text: 'Benign alternatives: ' }), e.benign) : null, e.verify ? h('p', {}, h('strong', { text: 'How it would be verified: ' }), e.verify) : null,
      e.links && e.links.length ? h('div', { class: 'ev-links' }, e.links.map((id, n) => h('button', { class: 'copy', text: e.linkTitles[n], onclick: () => openIndicator(id) }))) : null);
    const hasDet = det.children.length > 0;
    return h('article', { class: 'ev k-' + e.kind + ' c-' + slug(e.cat), 'data-kind': e.kind, 'data-cat': e.cat, style: { '--d': i * 70 + 'ms' } }, h('div', { class: 'ev-mark' }),
      h('div', { class: 'ev-card' }, h('button', { class: 'ev-head', 'aria-expanded': 'false', disabled: !hasDet, onclick: ev => { const c = ev.currentTarget.parentNode; const o = c.classList.toggle('open'); ev.currentTarget.setAttribute('aria-expanded', o); } }, h('span', { class: 'kbadge', text: KINDS[e.kind][0].toUpperCase() }), h('b', { text: e.title }), hasDet ? h('i', { class: 'chev', text: '▾' }) : null), h('p', { text: e.text }), e.meta ? h('small', { class: 'muted', text: e.meta }) : null, hasDet ? det : null, e.kind === 'illustrative' ? h('span', { class: 'kind', text: 'ILLUSTRATIVE — NOT OBSERVED' }) : e.kind === 'inferred' ? h('span', { class: 'kind', text: 'INFERRED FROM STATIC CLUES — NOT OBSERVED' }) : null));
  }));
  const catPanel = h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, 'BEHAVIOR CATEGORIES', h('span', { text: 'UNCONFIRMED · CLICK TO FILTER' })), h('div', { class: 'categories' }, CATS.map(c => { const b = r.behavior.find(x => x.category === c), lv = !b ? 0 : b.strength === 'Moderate' ? 2 : 1; return h('button', { class: 'category lvl' + lv + (state.bf.cat === c ? ' on' : ''), 'data-cat': c, onclick: () => { state.bf.cat = state.bf.cat === c ? 'all' : c; applyBF(); } }, h('b', { text: c }), h('span', { class: 'pips' }, h('i'), h('i')), h('small', { text: lv ? (lv === 2 ? 'Moderate static basis' : 'Weak static basis') : 'No static clue' })); })), h('p', { class: 'muted note', text: '"No static clue" means nothing was found in the bytes. It is not evidence that the behavior is absent.' }));
  box.append(h('div', { class: 'legend' }, ['static', 'inferred', 'illustrative'].map(k => h('div', { class: 'lg k-' + k }, h('i'), h('div', {}, h('b', { text: KINDS[k][0] }), h('small', { text: KINDS[k][1] }))))), h('div', { class: 'bar-tools' }, kindChips, h('button', { class: 'action', id: 'replay', text: '↻ REPLAY', onclick: replayTimeline })), h('div', { class: 'behavior-grid' }, h('div', { class: 'panel' }, h('div', { class: 'panel-title', text: 'OBSERVATION TIMELINE' }, h('span', { id: 'tl-count' })), list), catPanel));
  applyBF();
}
function applyBF() {
  document.querySelectorAll('#timeline .ev').forEach(e => { e.hidden = !((state.bf.kind === 'all' || e.dataset.kind === state.bf.kind) && (state.bf.cat === 'all' || e.dataset.cat === state.bf.cat)); });
  document.querySelectorAll('#behavior-data .chip-row .fchip').forEach(c => c.classList.toggle('on', c.dataset.kind === state.bf.kind));
  document.querySelectorAll('#behavior-data .category').forEach(c => c.classList.toggle('on', c.dataset.cat === state.bf.cat));
  const n = [...document.querySelectorAll('#timeline .ev')].filter(e => !e.hidden).length; if ($('tl-count')) $('tl-count').textContent = n + ' EVENT' + (n === 1 ? '' : 'S') + (state.bf.cat !== 'all' ? ' · ' + state.bf.cat.toUpperCase() : '');
}
function replayTimeline() { const t = $('timeline'); if (!t) return; t.classList.remove('play'); void t.offsetWidth; t.classList.add('play'); }

/* ---------- Reports ---------- */
function renderReports() {
  const r = cur(), box = $('report-content'); $('empty-report').hidden = !!r; box.hidden = !r; if (!r) return; clear(box);
  const side = h('aside', { class: 'archive' }, h('div', { class: 'panel-title' }, 'SESSION ARCHIVE', h('span', { text: state.cases.length + ' / 10' })),
    [...state.cases].reverse().map(c => h('div', { class: 'arch-item' + (c.id === r.id ? ' on' : '') }, h('button', { class: 'arch-open', onclick: () => { state.current = c.id; renderAll(); } }, h('b', { text: c.file.name }), h('small', { text: c.caseId + ' · ' + new Date(c.createdAt).toLocaleTimeString() }), h('span', { class: 'badge lvl-' + c.score.level.toLowerCase(), text: c.score.level })), h('button', { class: 'arch-del', 'aria-label': 'Remove ' + c.file.name, text: '✕', onclick: async () => { if (await confirmBox('Remove report?', 'Remove "' + c.file.name + '" from this session? It cannot be recovered.', 'Remove')) removeCase(c.id); } }))),
    h('button', { class: 'action danger', text: 'CLEAR ARCHIVE', onclick: async () => { if (await confirmBox('Clear the whole archive?', 'All ' + state.cases.length + ' analyses held in this session will be deleted.', 'Clear all')) { state.cases = []; state.current = null; renderAll(); toast('Archive cleared.', 'info'); } } }));
  const sorted = [...r.indicators].sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]));
  const notable = [...r.strings.urls.map(u => ['URL', u]), ...r.strings.hits.filter(k => k.severity !== 'low' || k.group !== 'network').slice(0, 10).map(k => [k.label, k.sample])].slice(0, 20);
  const doc = h('div', { class: 'report-card' },
    h('div', { class: 'rep-head' }, h('div', {}, h('div', { class: 'kicker', text: 'CYBERLAB / STATIC ANALYSIS REPORT' }), h('h3', { text: r.file.name }), h('p', { class: 'muted', text: r.caseId + ' · analyzed ' + fmtTime(r.createdAt) })), h('span', { class: 'chip ok' }, h('i'), 'Execution ', h('b', { text: 'NOT EXECUTED' }))),
    h('p', { text: 'This report summarizes static observations only. It is not a malware verdict and contains no runtime execution results.' }),
    h('div', { class: 'rep-summary' }, gauge(r.score.value, r.score.level, false), h('div', {}, h('b', { text: 'Heuristic indicator level: ' + r.score.level }), h('p', { class: 'muted', text: r.indicators.length + ' static indicator(s) · entropy ' + r.entropy.overall.toFixed(3) + ' bits/byte · ' + r.strings.total.toLocaleString() + (r.strings.total === 1 ? ' string' : ' strings') }))),
    h('div', { class: 'rep-sha' }, h('label', { text: 'SHA-256 FINGERPRINT' }), h('code', { text: r.sha256 }), copyBtn('COPY', () => r.sha256, 'SHA-256 copied.')),
    h('div', { class: 'rep-grid' }, [['File size', E.fmtSize(r.size)], ['Extension', r.file.ext ? '.' + r.file.ext : 'none'], ['Format', r.format], ['Declared MIME', r.file.mime], ['Entropy', r.entropy.overall.toFixed(3) + ' bits/byte'], ['Execution status', 'NOT EXECUTED']].map(([k, v]) => h('div', { class: 'report-table' }, h('span', { text: k }), h('b', { text: v })))),
    h('h4', { text: 'Detected indicators' }), sorted.length ? sorted.map(i => h('div', { class: 'rep-ind' }, h('span', { class: 'sev ' + i.severity, text: i.severity }), h('div', {}, h('b', { text: i.title }), h('small', { text: i.evidence })))) : h('p', { class: 'muted', text: 'No listed static indicator matched. This does not establish that the file is safe.' }),
    notable.length ? [h('h4', { text: 'Notable strings' }), notable.map(([k, v]) => h('div', { class: 'rep-ind' }, h('span', { class: 'sev info', text: 'text' }), h('div', {}, h('b', { text: k }), h('small', { text: v }))))] : null,
    h('h4', { text: 'Inferred behavior hypotheses' }), r.behavior.length ? r.behavior.map(b => h('div', { class: 'rep-ind' }, h('span', { class: 'sev info', text: b.strength }), h('div', {}, h('b', { text: b.category }), h('small', { text: b.statement + ' (inferred, not observed)' })))) : h('p', { class: 'muted', text: 'No static clue mapped to a behavior hypothesis.' }),
    h('div', { class: 'limits' }, h('b', { text: 'Limitations' }), h('p', { text: E.LIMITATION })));
  box.append(side, doc);
}
function removeCase(id) { state.cases = state.cases.filter(c => c.id !== id); if (state.current === id) state.current = state.cases.length ? state.cases[state.cases.length - 1].id : null; renderAll(); toast('Report removed.', 'info'); }
$('export-report').addEventListener('click', () => { const r = cur(); if (!r) { toast('Analyze a specimen first.', 'warn'); return; } download('cyberlab-static-report-' + r.caseId + '.txt', new Blob([E.reportText(r)], { type: 'text/plain' })); toast('TXT report exported to your device.', 'ok'); });
$('export-pdf').addEventListener('click', () => { const r = cur(); if (!r) { toast('Analyze a specimen first.', 'warn'); return; } try { const s = PDF.build(r, E.reportBlocks(r)), u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 255; download('cyberlab-static-report-' + r.caseId + '.pdf', new Blob([u8], { type: 'application/pdf' })); toast('PDF report exported to your device.', 'ok'); } catch (e) { toast('PDF export failed: ' + e.message, 'error'); } });

function renderAll() { renderStats(); renderCurrentCard(); renderSpecimen(); renderBehavior(); renderReports(); }
buildStats(); renderAll(); setArm('analyze');
if (ORDER.includes(location.hash.slice(1))) go(location.hash.slice(1), { silent: true, force: true });
})();
