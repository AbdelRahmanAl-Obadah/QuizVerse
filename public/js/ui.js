// UI helpers. All dynamic text goes through textContent / text nodes: imported content is never parsed as HTML.
export const TZ = 'Asia/Amman';
const NS = 'http://www.w3.org/2000/svg';

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, kids);
  return el;
}
export function append(el, kids) { for (const c of kids.flat(Infinity)) { if (c == null || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(String(c))); } return el; }
export function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of kids.flat()) if (c) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
const ICONS = {
  home: 'M3 11l9-8 9 8M5 10v10h14V10', book: 'M4 4h12a4 4 0 014 4v12H8a4 4 0 01-4-4zM8 20V8', trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0zM17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3',
  clock: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z', users: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', upload: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12',
  sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4', moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9', plus: 'M12 5v14M5 12h14', eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z',
  eyeoff: 'M17.9 17.9A10.1 10.1 0 0112 20c-7 0-11-8-11-8a18.5 18.5 0 015.1-5.9M9.9 4.2A9.1 9.1 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.2 3.2M1 1l22 22',
  flag: 'M4 22V4M4 4h13l-2 4 2 4H4', shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', chart: 'M3 3v18h18M7 14l4-4 3 3 5-6', back: 'M19 12H5M12 19l-7-7 7-7', check: 'M20 6L9 17l-5-5',
};
export const icon = (n) => svg('svg', { class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d: ICONS[n] || '' }));
export const spinner = (sm) => h('span', { class: 'spinner' + (sm ? ' sm' : ''), role: 'status', 'aria-label': 'Loading' });
export const loading = () => h('div', { class: 'center' }, spinner());
export const empty = (title, hint) => h('div', { class: 'empty' }, h('h3', {}, title), hint && h('p', {}, hint));

const HUES = { abood: 250, loge: 160, jana: 330, kinda: 28 };
export const avatar = (id, name, size = 44) => h('div', { class: 'avatar', style: { '--h': HUES[id] ?? 200, '--sz': size + 'px' }, 'aria-hidden': 'true' }, (name || '?')[0].toUpperCase());

export function toast(msg, bad) {
  const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), bad ? 6000 : 3500);
}
/** Runs fn with the button disabled; shows an error toast on failure. */
export async function busy(btn, fnc) {
  if (btn.disabled) return;
  btn.disabled = true; const old = btn.textContent; btn.replaceChildren(spinner(true), ' ' + old);
  try { return await fnc(); } catch (e) { toast(e.message, true); } finally { btn.disabled = false; btn.textContent = old; }
}
export function modal(content, label) {
  const d = h('dialog', { class: 'modal', 'aria-label': label || 'Dialog' }, content);
  document.body.append(d); d.addEventListener('close', () => d.remove()); d.showModal(); return d;
}
export function confirmDialog({ title, message, confirmText = 'Confirm', danger = false }) {
  return new Promise((res) => {
    let result = false;
    const d = modal(h('div', { class: 'modal-body' }, h('h2', {}, title), h('p', {}, message),
      h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => d.close() }, 'Cancel'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { result = true; d.close(); } }, confirmText))), title);
    d.addEventListener('close', () => res(result));
  });
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
  catch { const ta = h('textarea', {}, text); document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Copied to clipboard'); }
}
export function download(name, text, type = 'application/json') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); a.remove();
}
// ---------- formatting (Asia/Amman) ----------
const dtf = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });
const df = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' });
export const fmtDate = (ms) => (ms ? dtf.format(ms) : '—');
export const fmtShort = (ms) => (ms ? df.format(ms) : '');
export const fmtN = (n) => new Intl.NumberFormat('en-US').format(Math.round(n || 0));
export const fmtPct = (n) => (n == null ? '—' : `${Math.round(n * 10) / 10}%`);
export function fmtDur(s) {
  if (s == null) return '—'; s = Math.max(0, Math.round(s));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh ? `${hh}h ${String(mm).padStart(2, '0')}m` : `${mm}:${String(ss).padStart(2, '0')}`;
}
function offsetAt(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(ms).map((x) => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}
export const toInputDT = (ms) => (ms ? new Date(ms + offsetAt(ms)).toISOString().slice(0, 16) : '');
export function fromInputDT(s) { // "YYYY-MM-DDTHH:mm" interpreted in Asia/Amman -> epoch ms
  if (!s) return null; const [d, t] = s.split('T'); const [y, mo, da] = d.split('-').map(Number); const [hh, mm] = t.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, hh, mm); return guess - offsetAt(guess - offsetAt(guess));
}
export function startOfPeriod(kind, now = Date.now()) { // Monday-start week / calendar month, midnight in Asia/Amman
  const local = new Date(now + offsetAt(now)); let y = local.getUTCFullYear(), m = local.getUTCMonth(), d = local.getUTCDate();
  if (kind === 'month') d = 1; else d -= (local.getUTCDay() + 6) % 7;
  return fromInputDT(`${new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10)}T00:00`);
}
// ---------- charts (native SVG) ----------
export function chart(points, { title = '', bar = false, unit = '' } = {}) {
  const fig = h('figure', { class: 'chart' }, h('figcaption', {}, title));
  if (!points.length) { fig.append(h('p', { class: 'muted small' }, 'No data yet. Finish an examination to see this chart.')); return fig; }
  const W = 600, H = 220, P = { l: 44, r: 12, t: 12, b: 28 }, iw = W - P.l - P.r, ih = H - P.t - P.b;
  const max = Math.max(1, ...points.map((p) => p.y)), n = points.length;
  const X = (i) => P.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1)), Y = (y) => P.t + ih - (y / max) * ih;
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': `${title}: ${points.map((p) => `${p.x} ${p.y}${unit}`).join(', ')}` });
  for (let i = 0; i <= 4; i++) { const y = P.t + (ih * i) / 4; s.append(svg('line', { class: 'grid-l', x1: P.l, x2: W - P.r, y1: y, y2: y }), svg('text', { x: P.l - 6, y: y + 4, 'text-anchor': 'end' }, fmtN(max * (1 - i / 4)))); }
  if (bar) {
    const bw = Math.min(40, (iw / n) * 0.6);
    points.forEach((p, i) => { const x = P.l + (iw / n) * (i + 0.5) - bw / 2; s.append(svg('rect', { class: 'bar-r', x, y: Y(p.y), width: bw, height: P.t + ih - Y(p.y), rx: 3 }, svg('title', {}, `${p.x}: ${p.y}${unit}`))); });
  } else {
    s.append(svg('polyline', { class: 'ln', points: points.map((p, i) => `${X(i)},${Y(p.y)}`).join(' ') }));
    points.forEach((p, i) => s.append(svg('circle', { class: 'pt', cx: X(i), cy: Y(p.y), r: 4 }, svg('title', {}, `${p.x}: ${p.y}${unit}`))));
  }
  const step = Math.ceil(n / 6);
  points.forEach((p, i) => { if (i % step === 0) s.append(svg('text', { x: bar ? P.l + (iw / n) * (i + 0.5) : X(i), y: H - 8, 'text-anchor': 'middle' }, p.x)); });
  fig.append(s); return fig;
}
