/* Horario Espiritual — app.js
   Vanilla JS, no build step. Sections: constants · date utils · state · domain ops ·
   rendering (pure functions → HTML strings) · sheet/toast · events · boot.  Spec: docs/PLAN.md */
'use strict';

// ===== constants =====
const STORAGE_KEY = 'he.v1';
/* The theme lives in its own key, not in the state blob: it is a preference of this device, so it must
   not travel in backups, and index.html reads it synchronously before the first paint. */
const THEME_KEY = 'he.theme';
const THEMES = [{ id: 'auto', label: 'Automático' }, { id: 'light', label: 'Claro' }, { id: 'dark', label: 'Oscuro' }];
const DEFAULT_THEME = 'dark'; // he fills the horario at night
const APP_VERSION = '0.9.0';
const DAY_ROLLOVER_HOUR = 6; // the "day" changes at 06:00, not at midnight (night-time filling)
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const DIAS_L = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const FREQS = [
  { id: 'daily', title: 'Diarios', one: 'diario', scope: '' },
  { id: 'weekly', title: 'Semanales', one: 'semanal', scope: 'Esta semana' },
  { id: 'monthly', title: 'Mensuales', one: 'mensual', scope: 'Este mes' },
];
const TITLES = { hoy: 'Hoy', mes: 'Mes', config: 'Puntos del horario espiritual' };

// ===== date utils (local time; weeks start on Monday, ISO numbering) =====
const DAY_MS = 86400000;
const pad2 = n => String(n).padStart(2, '0');
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
const now = () => new Date();
/** Logical "today": before 06:00 we are still on the previous calendar day. */
function today() {
  const n = now(), d = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  return n.getHours() < DAY_ROLLOVER_HOUR ? addDays(d, -1) : d;
}
const isLateNight = () => now().getHours() < DAY_ROLLOVER_HOUR;
function dayKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function monthKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
function monthKeyOf(y, m0) { return `${y}-${pad2(m0 + 1)}`; }
function parseDay(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function sameDay(a, b) { return dayKey(a) === dayKey(b); }
function daysInMonth(y, m0) { return new Date(y, m0 + 1, 0).getDate(); }
function weekdayIndex(d) { return (d.getDay() + 6) % 7; } // 0 = Monday
function startOfWeek(d) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(r, -weekdayIndex(r));
}
function isoWeekKey(d) {
  const monday = startOfWeek(d), thursday = addDays(monday, 3), year = thursday.getFullYear();
  const week1Monday = startOfWeek(new Date(year, 0, 4));
  return `${year}-W${pad2(Math.round((monday - week1Monday) / (7 * DAY_MS)) + 1)}`;
}
/** ISO weeks intersecting a month. start/end are clamped to the month; ws/we are the full week. */
function weeksOfMonth(y, m0) {
  const first = new Date(y, m0, 1), last = new Date(y, m0, daysInMonth(y, m0));
  const out = [];
  for (let ws = startOfWeek(first); ws <= last; ws = addDays(ws, 7)) {
    const we = addDays(ws, 6);
    const s = ws < first ? first : ws, e = we > last ? last : we;
    out.push({ key: isoWeekKey(ws), ws, we, start: s, end: e,
      label: s.getDate() === e.getDate() ? `${s.getDate()}` : `${s.getDate()}–${e.getDate()}` });
  }
  return out;
}
function fmtLong(d) { return `${DIAS[weekdayIndex(d)]}, ${d.getDate()} de ${MESES[d.getMonth()]}`; }
function fmtShort(d) { return `${DIAS[weekdayIndex(d)]} ${d.getDate()}`; }

// ===== state & persistence =====
function defaultState() {
  return { version: 3, template: { particular: '', resolutions: [] }, months: {}, checks: {}, scores: {}, settings: {} };
}
function migrate(s) {
  if (!s || typeof s !== 'object') return defaultState();
  s.template = s.template || {}; s.template.particular = s.template.particular || '';
  s.template.resolutions = Array.isArray(s.template.resolutions) ? s.template.resolutions : [];
  s.months = s.months || {}; s.checks = s.checks || {}; s.scores = s.scores || {}; s.settings = s.settings || {};
  if ((s.version || 1) < 2) { // v1 stored weekly/monthly checks by period key; now everything is per day
    for (const id of Object.keys(s.checks))
      for (const k of Object.keys(s.checks[id])) if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) delete s.checks[id][k];
    s.version = 2;
  }
  if (s.version < 3) { repairDuplicates(s); s.version = 3; }
  return s;
}
const normText = t => String(t || '').trim().toLowerCase().replace(/\s+/g, ' ');
/** Before v0.7, deleting a punto with ticks and re-adding it produced two rows with the same text in the
 *  month (old retired id + new id). Fold later duplicates into the first one and re-point the template. */
function repairDuplicates(s) {
  const tpl = s.template.resolutions;
  for (const mk of Object.keys(s.months)) {
    const m = s.months[mk], seen = new Map();
    for (const r of [...m.resolutions]) {
      const k = normText(r.text);
      if (!seen.has(k)) { seen.set(k, r); continue; }
      const keep = seen.get(k), drop = r;
      m.resolutions.splice(m.resolutions.indexOf(drop), 1);
      if (drop.id === keep.id) continue;
      const from = s.checks[drop.id] || {}; s.checks[keep.id] = s.checks[keep.id] || {};
      for (const d of Object.keys(from)) if (from[d]) s.checks[keep.id][d] = true;
      delete s.checks[drop.id];
      const t = tpl.find(x => x.id === drop.id);
      if (t) { if (tpl.some(x => x.id === keep.id)) tpl.splice(tpl.indexOf(t), 1); else t.id = keep.id; }
      for (const mk2 of Object.keys(s.months)) for (const rr of s.months[mk2].resolutions) if (rr.id === drop.id) rr.id = keep.id;
    }
  }
}
function load() {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? migrate(JSON.parse(raw)) : defaultState(); }
  catch (e) { console.error('load failed', e); return defaultState(); }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { console.error('save failed', e); toast('No se pudo guardar. ¿Almacenamiento lleno?'); return; }
  noteDataSince();
}
const uid = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
let state = load();

// ----- theme (see the pre-paint script in index.html) -----
const prefersDark = matchMedia('(prefers-color-scheme: dark)'); // keep the reference: a stray MediaQueryList can be collected
function getTheme() {
  try { const t = localStorage.getItem(THEME_KEY); return THEMES.some(x => x.id === t) ? t : DEFAULT_THEME; }
  catch (e) { return DEFAULT_THEME; }
}
function setTheme(id) {
  try { localStorage.setItem(THEME_KEY, id); } catch (e) { /* private mode: applies for this session only */ }
  applyTheme();
}
/** Resolve auto/light/dark to the attribute the stylesheet keys off, and repaint the iOS status bar. */
function applyTheme() {
  const pref = getTheme();
  const dark = pref === 'dark' || (pref === 'auto' && prefersDark.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
}
prefersDark.addEventListener('change', () => { if (getTheme() === 'auto') applyTheme(); });

// ===== domain ops =====
const sortedRes = list => [...list].sort((a, b) => a.order - b.order);
const snapshotOf = r => ({ id: r.id, text: r.text, freq: r.freq, order: r.order });
function getMonth(mk) { return state.months[mk] || null; }
/** The current month gets a snapshot of the template the first time it is opened. Past months never do. */
function ensureMonth(mk) {
  if (state.months[mk]) return state.months[mk];
  if (mk !== monthKey(today())) return null;
  state.months[mk] = { particular: state.template.particular, resolutions: state.template.resolutions.map(snapshotOf) };
  save();
  return state.months[mk];
}
const currentMonth = () => ensureMonth(monthKey(today()));

/** Adds a punto. If the same text exists retired in this month (deleted after having ticks) it is revived;
 *  if it existed in a past month its id is reused so history stays continuous. Returns false on a duplicate. */
function addResolution(freq, text) {
  const key = normText(text), m = currentMonth();
  if (state.template.resolutions.some(r => normText(r.text) === key)) return false;
  const retired = m.resolutions.find(r => normText(r.text) === key);
  const past = retired ? null : Object.values(state.months).flatMap(mm => mm.resolutions).find(r => normText(r.text) === key);
  const id = retired ? retired.id : past ? past.id : uid();
  const same = state.template.resolutions.filter(r => r.freq === freq);
  const r = { id, text, freq, order: same.length ? Math.max(...same.map(x => x.order)) + 1 : 0, createdAt: dayKey(today()) };
  state.template.resolutions.push(r);
  if (retired) { retired.text = text; retired.freq = freq; retired.order = r.order; } else m.resolutions.push(snapshotOf(r));
  save();
  return true;
}
function editResolution(id, text) {
  const t = state.template.resolutions.find(r => r.id === id); if (t) t.text = text;
  const m = currentMonth().resolutions.find(r => r.id === id); if (m) m.text = text;
  save();
}
/** Checked day keys for a resolution within [fromKey, toKey] (day keys sort lexicographically). */
function checkedDaysIn(id, fromKey, toKey) {
  const c = state.checks[id] || {};
  return Object.keys(c).filter(k => c[k] && k >= fromKey && k <= toKey).sort();
}
function doneInWeek(id, d) { const s = startOfWeek(d); return checkedDaysIn(id, dayKey(s), dayKey(addDays(s, 6))); }
function doneInMonth(id, d) { const mk = monthKey(d); return checkedDaysIn(id, `${mk}-01`, `${mk}-31`); }
function hasChecksThisMonth(id) { return doneInMonth(id, today()).length > 0; }
/** Removes from the template; from the current month only if it has no checks there yet. */
function removeResolution(id) {
  state.template.resolutions = state.template.resolutions.filter(r => r.id !== id);
  const m = currentMonth();
  if (!hasChecksThisMonth(id)) m.resolutions = m.resolutions.filter(r => r.id !== id);
  save();
}
function moveResolution(id, dir) {
  const t = state.template.resolutions.find(r => r.id === id); if (!t) return;
  const same = sortedRes(state.template.resolutions.filter(r => r.freq === t.freq));
  const i = same.indexOf(t), j = i + dir;
  if (j < 0 || j >= same.length) return;
  [same[i], same[j]] = [same[j], same[i]];
  same.forEach((r, k) => { r.order = k; });
  currentMonth().resolutions.forEach(mr => { const tr = state.template.resolutions.find(r => r.id === mr.id); if (tr) mr.order = tr.order; });
  save();
}
function setParticular(text) { state.template.particular = text; currentMonth().particular = text; save(); }
function isChecked(id, key) { return !!(state.checks[id] && state.checks[id][key]); }
function toggleCheck(id, key) {
  state.checks[id] = state.checks[id] || {};
  if (state.checks[id][key]) delete state.checks[id][key]; else state.checks[id][key] = true;
  save();
}
function getScore(dk) { return state.scores[dk] || null; }
function setScore(dk, v) { if (v == null) delete state.scores[dk]; else state.scores[dk] = v; save(); }
/** Whether a resolution is "up to date" on day d: daily → checked that day; weekly/monthly → done any day in the period. */
function upToDate(r, d) {
  if (r.freq === 'daily') return isChecked(r.id, dayKey(d));
  return (r.freq === 'weekly' ? doneInWeek(r.id, d) : doneInMonth(r.id, d)).length > 0;
}
// ===== rendering =====
const ui = { tab: 'hoy', day: today(), month: { y: today().getFullYear(), m0: today().getMonth() }, editing: null,
  rotated: false, anim: 'fade' };
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtAvg = n => n.toFixed(1).replace('.', ',');
const listES = arr => arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} y ${arr[arr.length - 1]}`;

function emptyCard(title, text, gotoTab) {
  return `<section class="card empty"><h2>${esc(title)}</h2><p>${esc(text)}</p>` +
    (gotoTab ? `<button class="pill" data-action="goto" data-tab="${gotoTab}">Ir a Configuración</button>` : '') + `</section>`;
}

function renderHoy() {
  const d = ui.day, dk = dayKey(d), mk = monthKey(d), isToday = sameDay(d, today());
  const m = mk === monthKey(today()) ? ensureMonth(mk) : getMonth(mk);
  let html = backupBannerHtml() + `<div class="daynav">
    <button class="icon" data-action="day:prev" aria-label="Día anterior">&#8249;</button>
    <div class="daynav-title"><div class="big">${esc(cap(fmtLong(d)))}</div>
      ${isToday && isLateNight() ? `<div class="latenight">Madrugada: el día sigue siendo el ${esc(DIAS[weekdayIndex(d)])} hasta las 6:00</div>` : ''}
      ${isToday ? '' : `<button class="pill" data-action="day:today">Día pasado · volver a hoy</button>`}</div>
    <button class="icon" data-action="day:next" ${isToday ? 'disabled' : ''} aria-label="Día siguiente">&#8250;</button>
  </div>`;
  if (!m) return html + emptyCard('Este mes no tiene horario', 'No se abrió la app durante este mes, así que no hay puntos registrados.');
  const res = sortedRes(m.resolutions);
  if (!res.length && !m.particular) return html + emptyCard('Aún no tienes puntos', 'Empieza por definir tu examen particular y los puntos de tu horario.', 'config');
  if (m.particular) {
    const sc = getScore(dk);
    html += `<section class="card"><div class="card-label">Examen particular</div>
      <div class="particular-text">${esc(m.particular)}</div>
      <div class="scores">${[1, 2, 3, 4, 5].map(v => `<button class="score ${sc === v ? 'on' : ''}" data-action="score" data-v="${v}" aria-pressed="${sc === v}">${v}</button>`).join('')}</div>
      ${sc ? '' : `<div class="hint">Puntúa del 1 al 5 cómo viviste hoy tu propósito.</div>`}</section>`;
  }
  for (const f of FREQS) {
    const list = res.filter(r => r.freq === f.id);
    if (!list.length) continue;
    html += `<section class="card"><div class="card-label">${f.title}</div><ul class="checklist">` + list.map(r => {
      const on = isChecked(r.id, dk);
      let sub = '';
      if (f.id !== 'daily') {
        const others = (f.id === 'weekly' ? doneInWeek(r.id, d) : doneInMonth(r.id, d)).filter(k => k !== dk);
        sub = others.length ? `${f.scope}: hecho el ${listES(others.map(k => fmtShort(parseDay(k))))}` : (on ? '' : `${f.scope}: pendiente`);
      }
      return `<li><button class="row ${on ? 'done' : ''}" data-action="check" data-id="${r.id}" data-key="${dk}" aria-pressed="${on}">` +
        `<span class="box"></span><span class="txt">${esc(r.text)}${sub ? `<small>${esc(sub)}</small>` : ''}</span></button></li>`;
    }).join('') + `</ul></section>`;
  }
  return html;
}

/** Everything the month view and the PDF need for one month. `m` is null when the month has no snapshot. */
function monthModel(y, m0) {
  const mk = monthKeyOf(y, m0), isCurrent = mk === monthKey(today());
  const m = isCurrent ? ensureMonth(mk) : getMonth(mk);
  if (!m) return { mk, isCurrent, m: null };
  const res = sortedRes(m.resolutions), nDays = daysInMonth(y, m0), days = range(1, nDays);
  const lastDay = isCurrent ? today().getDate() : nDays;            // days elapsed
  const weeks = weeksOfMonth(y, m0), elapsed = weeks.filter(w => w.start <= today());
  const groups = FREQS.map(f => ({ ...f, items: res.filter(r => r.freq === f.id) })).filter(g => g.items.length);
  const scores = days.map(d => getScore(`${mk}-${pad2(d)}`)).filter(Boolean);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const countOf = r => days.filter(d => d <= lastDay && isChecked(r.id, `${mk}-${pad2(d)}`)).length;
  const weeksDone = r => elapsed.filter(w => checkedDaysIn(r.id, dayKey(w.ws), dayKey(w.we)).length).length;
  return { mk, isCurrent, m, res, nDays, days, lastDay, weeks, elapsed, groups, scores, avg, countOf, weeksDone };
}

function renderMes() {
  const { y, m0 } = ui.month;
  const M = monthModel(y, m0), { mk, isCurrent, m } = M;
  let html = `<div class="daynav">
    <button class="icon" data-action="month:prev" aria-label="Mes anterior">&#8249;</button>
    <div class="daynav-title"><div class="big">${cap(MESES[m0])} ${y}</div>
      ${m && m.particular ? `<div class="sub show-rotated">Examen particular: <b>${esc(m.particular)}</b></div>` : ''}
      <button class="pill" data-action="rotate" title="${ui.rotated ? 'Volver a vertical' : 'Ver el mes entero girado'}">${ui.rotated ? 'Volver' : 'Girar'}</button></div>
    <button class="icon" data-action="month:next" ${isCurrent ? 'disabled' : ''} aria-label="Mes siguiente">&#8250;</button>
  </div>`;
  if (!m) return html + emptyCard('Sin horario este mes', 'No hay puntos registrados para este mes.');
  const { res, nDays, days, lastDay, weeks, elapsed, groups, scores, avg } = M;
  if (!res.length && !m.particular) return html + emptyCard('Sin puntos', 'Este mes no tiene puntos registrados.', isCurrent ? 'config' : null);
  const dateOf = d => new Date(y, m0, d);
  const cls = d => [weekdayIndex(dateOf(d)) >= 5 ? 'we' : '', isCurrent && d === lastDay ? 'today' : '',
    d > 1 && weekdayIndex(dateOf(d)) === 0 ? 'wk' : ''].filter(Boolean).join(' ');

  if (m.particular) {
    html += `<section class="card hide-rotated"><div class="card-label">Examen particular</div>
      <div class="particular-text">${esc(m.particular)}</div>
      <div class="stat">${avg ? `Media <b>${fmtAvg(avg)}</b> · ${scores.length} ${scores.length === 1 ? 'día puntuado' : 'días puntuados'}` : 'Sin puntuaciones todavía'}</div></section>`;
  }
  html += `<section class="card grid-card"><div class="gridwrap"><table class="grid"><colgroup><col class="c-lab">${days.map(() => '<col>').join('')}<col class="c-tot"></colgroup><thead>
    <tr class="weeksrow"><th class="lab"></th>${weeks.map(w => `<th colspan="${w.end.getDate() - w.start.getDate() + 1}" class="${w.start.getDate() > 1 ? 'wk' : ''}">${w.label}</th>`).join('')}<th class="tot"></th></tr>
    <tr><th class="lab"></th>${days.map(d => `<th class="${cls(d)}">${DIAS_L[weekdayIndex(dateOf(d))]}</th>`).join('')}<th class="tot"></th></tr>
    <tr><th class="lab"></th>${days.map(d => `<th class="${cls(d)}">${d}</th>`).join('')}<th class="tot">Total</th></tr></thead><tbody>`;
  if (m.particular) {
    html += `<tr class="examen"><th class="lab" title="${esc(m.particular)}">Examen particular</th>` + days.map(d => {
      const sc = getScore(`${mk}-${pad2(d)}`);
      return `<td class="${cls(d)} ${sc ? 's' + sc : ''}">${d <= lastDay ? (sc || '·') : ''}</td>`;
    }).join('') + `<td class="tot">${avg ? fmtAvg(avg) : '–'}</td></tr>`;
  }
  for (const g of groups) {
    html += `<tr class="group"><th class="lab">${g.title}</th><td colspan="${nDays}"></td><td class="tot"></td></tr>`;
    for (const r of g.items) {
      const n = M.countOf(r);
      const cells = days.map(d => {
        const k = `${mk}-${pad2(d)}`, on = isChecked(r.id, k), future = d > lastDay;
        return `<td class="${cls(d)} ${on ? 'on' : ''} ${future ? 'future' : ''}" ${future ? '' : `data-action="check" data-id="${r.id}" data-key="${k}"`}>${on ? '✓' : (future ? '' : '·')}</td>`;
      }).join('');
      const total = g.id === 'daily' ? `${n}/${lastDay}` : g.id === 'weekly' ? `${M.weeksDone(r)}/${elapsed.length}` : (n ? '✓' : '–');
      html += `<tr><th class="lab" title="${esc(r.text)}">${esc(r.text)}</th>${cells}<td class="tot">${total}</td></tr>`;
    }
  }
  html += `</tbody></table></div></section>`;
  html += `<div class="actions"><button class="primary" data-action="pdf">Exportar PDF</button></div>`;
  return html;
}

// ===== PDF export (jsPDF, loaded on demand from cdnjs; cached by the service worker afterwards) =====
const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
let jspdfLoading = null;
function loadJsPdf() {
  if (window.jspdf) return Promise.resolve(window.jspdf);
  if (!jspdfLoading) jspdfLoading = new Promise((resolve, reject) => {
    const sc = document.createElement('script'); sc.src = JSPDF_URL;
    sc.onload = () => resolve(window.jspdf); sc.onerror = () => { jspdfLoading = null; sc.remove(); reject(new Error('jspdf')); };
    document.head.appendChild(sc);
  });
  return jspdfLoading;
}
const userName = () => (state.settings.name || '').trim();
const pdfTitle = (y, m0) => `Horario espiritual${userName() ? ` de ${userName()}` : ''} · ${cap(MESES[m0])} ${y}`;
const pdfFileName = (y, m0) => `Horario espiritual${userName() ? ` - ${userName().replace(/[\/\\:*?"<>|]+/g, '')}` : ''} - ${cap(MESES[m0])} ${y}.pdf`;
/** One A4 landscape page: title, examen line, then the month grid (days across, puntos down). */
function buildPdf(lib, y, m0, M) {
  const { mk, m, nDays, days, lastDay, weeks, elapsed, groups, scores, avg } = M;
  const doc = new lib.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const W = 297, H = 210, MG = 12;
  const INK = [28, 30, 38], MUTED = [107, 114, 128], LINE = [229, 231, 235], LINE2 = [203, 207, 214], WE = [244, 245, 248], GREEN = [31, 122, 77];
  const dateOf = d => new Date(y, m0, d);
  // title
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...INK);
  doc.text(pdfTitle(y, m0), MG, MG + 5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
  if (m.particular) {
    const extra = avg ? `   ·   media ${fmtAvg(avg)} (${scores.length} ${scores.length === 1 ? 'día' : 'días'})` : '';
    doc.text(`Examen particular: ${m.particular}${extra}`, MG, MG + 11);
  }
  // geometry
  const labelW = 62, totW = 16, x0 = MG, tableW = W - 2 * MG, dayW = (tableW - labelW - totW) / nDays;
  const xDay = d => x0 + labelW + (d - 1) * dayW, xTot = x0 + labelW + nDays * dayW;
  const hdr = [4.6, 4.6, 5.4], hdrH = hdr.reduce((a, b) => a + b, 0);
  const yTop = MG + (m.particular ? 16 : 10);
  const rows = (m.particular ? 1 : 0) + groups.reduce((n, g) => n + 1 + g.items.length, 0);
  const rowH = Math.min(6.4, Math.max(4.4, (H - MG - 6 - yTop - hdrH) / Math.max(rows, 1)));
  const tableH = hdrH + rows * rowH, yBottom = yTop + tableH;
  // weekend shading and week separators (full table height)
  doc.setFillColor(...WE);
  days.forEach(d => { if (weekdayIndex(dateOf(d)) >= 5) doc.rect(xDay(d), yTop + hdr[0], dayW, tableH - hdr[0], 'F'); });
  doc.setDrawColor(...LINE2); doc.setLineWidth(0.25);
  days.forEach(d => { if (d > 1 && weekdayIndex(dateOf(d)) === 0) doc.line(xDay(d), yTop, xDay(d), yBottom); });
  doc.line(x0 + labelW, yTop, x0 + labelW, yBottom); doc.line(xTot, yTop, xTot, yBottom);
  // header rows
  doc.setFontSize(6.5); doc.setTextColor(...MUTED);
  weeks.forEach(w => { const a = w.start.getDate(), b = w.end.getDate(); doc.text(w.label, xDay(a) + (b - a + 1) * dayW / 2, yTop + hdr[0] - 1.3, { align: 'center' }); });
  days.forEach(d => doc.text(DIAS_L[weekdayIndex(dateOf(d))], xDay(d) + dayW / 2, yTop + hdr[0] + hdr[1] - 1.3, { align: 'center' }));
  doc.setFontSize(7.5); doc.setTextColor(...INK);
  days.forEach(d => doc.text(String(d), xDay(d) + dayW / 2, yTop + hdrH - 1.6, { align: 'center' }));
  doc.setFontSize(6.5); doc.setTextColor(...MUTED); doc.text('Total', xTot + totW - 1, yTop + hdrH - 1.6, { align: 'right' });
  doc.setDrawColor(...LINE2); doc.setLineWidth(0.3); doc.line(x0, yTop + hdrH, x0 + tableW, yTop + hdrH);
  // helpers
  const fit = (t, maxW) => { let s = t; if (doc.getTextWidth(s) <= maxW) return s; while (s.length > 1 && doc.getTextWidth(s + '…') > maxW) s = s.slice(0, -1); return s.trimEnd() + '…'; };
  const box = Math.min(dayW, rowH) * 0.62, bx = (dayW - box) / 2, by = (rowH - box) / 2;
  const drawBox = (d, yRow, on) => {
    const x = xDay(d) + bx, yy = yRow + by;
    if (on) {
      doc.setFillColor(...GREEN); doc.setDrawColor(...GREEN); doc.roundedRect(x, yy, box, box, 0.5, 0.5, 'F');
      doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.4);
      doc.line(x + box * 0.24, yy + box * 0.52, x + box * 0.43, yy + box * 0.72); doc.line(x + box * 0.43, yy + box * 0.72, x + box * 0.78, yy + box * 0.3);
    } else { doc.setDrawColor(...LINE2); doc.setLineWidth(0.25); doc.roundedRect(x, yy, box, box, 0.5, 0.5, 'S'); }
  };
  let yRow = yTop + hdrH;
  const rowLine = yy => { doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.line(x0, yy, x0 + tableW, yy); };
  if (m.particular) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...INK);
    doc.text('Examen particular', x0 + 1.5, yRow + rowH / 2, { baseline: 'middle' });
    days.forEach(d => { const sc = getScore(`${mk}-${pad2(d)}`); if (sc) doc.text(String(sc), xDay(d) + dayW / 2, yRow + rowH / 2, { align: 'center', baseline: 'middle' }); });
    if (avg) doc.text(fmtAvg(avg), xTot + totW - 1, yRow + rowH / 2, { align: 'right', baseline: 'middle' });
    yRow += rowH; rowLine(yRow);
  }
  for (const g of groups) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...MUTED);
    doc.text(g.title.toUpperCase(), x0 + 1.5, yRow + rowH / 2, { baseline: 'middle', charSpace: 0.3 });
    yRow += rowH; rowLine(yRow);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    for (const r of g.items) {
      doc.setTextColor(...INK); doc.text(fit(r.text, labelW - 3), x0 + 1.5, yRow + rowH / 2, { baseline: 'middle' });
      days.forEach(d => { if (d <= lastDay) drawBox(d, yRow, isChecked(r.id, `${mk}-${pad2(d)}`)); });
      const n = M.countOf(r);
      const total = g.id === 'daily' ? `${n}/${lastDay}` : g.id === 'weekly' ? `${M.weeksDone(r)}/${elapsed.length}` : String(n);
      doc.setTextColor(...MUTED); doc.text(total, xTot + totW - 1, yRow + rowH / 2, { align: 'right', baseline: 'middle' });
      yRow += rowH; rowLine(yRow);
    }
  }
  // footer
  const t = new Date(); // calendar date, not the 06:00 logical day
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...MUTED);
  doc.text(`Generado el ${t.getDate()} de ${MESES[t.getMonth()]} de ${t.getFullYear()} · Horario Espiritual`, MG, H - MG + 4);
  return doc;
}
async function exportPdf() {
  const { y, m0 } = ui.month, M = monthModel(y, m0);
  if (!M.m || (!M.res.length && !M.m.particular)) { toast('Este mes no tiene horario que exportar.'); return; }
  let lib;
  try { lib = await loadJsPdf(); } catch (e) { toast('No se pudo cargar el generador de PDF. ¿Sin conexión?'); return; }
  const doc = buildPdf(lib, y, m0, M);
  const name = pdfFileName(y, m0), blob = doc.output('blob');
  const file = new File([blob], name, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: pdfTitle(y, m0) }); return; }
    catch (e) { if (e.name === 'AbortError') return; if (e.name === 'NotAllowedError') { toast('Toca de nuevo para compartir el PDF.'); return; } }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function renderConfig() {
  const t = state.template;
  let html = `<section class="card"><div class="card-label">Examen particular</div>
    <textarea id="particular" rows="2" placeholder="Ej.: Vivir la paciencia en casa">${esc(t.particular)}</textarea>
    <div class="hint">Lo puntúas cada día del 1 al 5. Cámbialo cuando cambies de propósito: se aplica a este mes y a los siguientes. Cada mes conserva el suyo y lo verás al volver a él en la vista Mes.</div></section>`;
  for (const f of FREQS) {
    const list = sortedRes(t.resolutions.filter(r => r.freq === f.id));
    html += `<section class="card"><div class="card-label">${f.title}</div><ul class="editlist">`;
    list.forEach((r, i) => {
      html += `<li class="editrow">` + (ui.editing === r.id
        ? `<input class="edit-input" data-id="${r.id}" value="${esc(r.text)}" aria-label="Editar punto">`
        : `<button class="txt" data-action="edit" data-id="${r.id}" title="Tocar para editar">${esc(r.text)}</button>`) +
        `<span class="rowbtns">
          <button class="mini" data-action="move" data-id="${r.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir">&#8593;</button>
          <button class="mini" data-action="move" data-id="${r.id}" data-dir="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Bajar">&#8595;</button>
          <button class="mini danger" data-action="remove" data-id="${r.id}" aria-label="Eliminar">&#215;</button>
        </span></li>`;
    });
    html += `</ul><form class="addrow" data-freq="${f.id}"><input name="text" placeholder="Nuevo punto ${f.one}" autocomplete="off" enterkeyhint="done"><button type="submit">Añadir</button></form></section>`;
  }
  html += `<p class="note">Los cambios se aplican al mes actual y a los siguientes; los meses anteriores no cambian. Si eliminas un punto que ya tiene marcas este mes, se conserva en este mes y desaparece a partir del próximo.</p>`;
  html += `<section class="card"><div class="card-label">Tu nombre</div>
    <input id="name" class="field" value="${esc(state.settings.name || '')}" placeholder="Ej.: Josef Engling" autocomplete="name">
    <div class="hint">Aparece en el título del PDF y en el nombre del archivo.</div></section>`;
  const theme = getTheme();
  html += `<section class="card"><div class="card-label">Apariencia</div>
    <div class="segmented" role="group" aria-label="Apariencia">` +
    THEMES.map(t => `<button class="${t.id === theme ? 'on' : ''}" data-action="theme" data-theme="${t.id}"
      aria-pressed="${t.id === theme}">${t.label}</button>`).join('') +
    `</div><div class="hint">Oscuro es lo normal aquí: casi siempre lo rellenas de noche. «Automático» sigue
    al iPhone. El PDF sale siempre en claro, para imprimirlo.</div></section>`;
  const kb = ((localStorage.getItem(STORAGE_KEY) || '').length / 1024).toFixed(1);
  const months = Object.keys(state.months).length;
  const backedUp = readStamp(BACKUP_AT_KEY);
  html += `<section class="card"><div class="card-label">Datos</div>
    <p>Todo se guarda en este dispositivo (${kb} KB, ${months} ${months === 1 ? 'mes' : 'meses'}).</p>
    <p class="hint">«Guardar copia» abre la hoja para compartir: puedes mandarla por WhatsApp o dejarla en Archivos, iCloud o Drive. Hazlo de vez en cuando. Si borras la app de la pantalla de inicio, sus datos se borran con ella.</p>
    <p class="hint">${backedUp ? `Última copia: ${esc(fmtBackupDate(backedUp))}.` : 'Todavía no has guardado una copia desde este dispositivo.'}</p>
    <div class="actions col"><button class="primary" data-action="export">Guardar copia</button>
    <button class="secondary" data-action="import">Restaurar copia…</button></div></section>
    <section class="card"><div class="card-label">Versión</div>
    <p>Horario Espiritual · versión ${APP_VERSION}</p>
    <p class="hint">Al abrir la app con conexión se carga siempre la última versión. Si tienes dudas, fuérzalo aquí.</p>
    <div class="actions col"><button class="secondary" data-action="update">Buscar actualizaciones</button></div></section>`;
  const standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  if (!standalone) html += `<section class="card"><div class="card-label">Instalar en el iPhone</div>
    <p>En Safari, toca <b>Compartir</b> y luego <b>«Añadir a pantalla de inicio»</b>. La app se abrirá a pantalla completa y funcionará sin conexión.</p></section>`;
  return html;
}

function render() {
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === ui.tab));
  $('#title').textContent = TITLES[ui.tab];
  $('#app').classList.toggle('rotated', ui.tab === 'mes' && ui.rotated);
  const view = $('#view');
  view.className = ui.anim ? `anim-${ui.anim}` : '';
  ui.anim = null;
  view.innerHTML = ({ hoy: renderHoy, mes: renderMes, config: renderConfig })[ui.tab]();
  markScrollHints();
  if (ui.tab === 'mes' && navigator.onLine !== false) loadJsPdf().catch(() => {});
  if (ui.editing) { const inp = $('.edit-input'); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }
}
/** Fade the grid's right edge while more days sit past the sticky total. */
function markScrollHints() {
  document.querySelectorAll('.gridwrap').forEach(el => {
    const update = () => {
      const more = el.scrollWidth > el.clientWidth + 2 && el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
      el.classList.toggle('can-scroll', more);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
  });
}
/** Re-render and briefly animate the element matching `sel` (the thing the user just touched). */
function renderAndPop(sel) {
  render();
  const el = document.querySelector(sel);
  if (el) { el.classList.add('pop'); el.addEventListener('animationend', () => el.classList.remove('pop'), { once: true }); }
}
function toast(msg, { sticky = false, onTap = null } = {}) {
  const t = $('#toast'); clearTimeout(toast.timer);
  t.textContent = msg; t.hidden = false; t.onclick = () => { hideToast(); if (onTap) onTap(); };
  requestAnimationFrame(() => t.classList.add('show'));
  if (!sticky) toast.timer = setTimeout(hideToast, 3500);
}
function hideToast() {
  const t = $('#toast'); clearTimeout(toast.timer); t.classList.remove('show');
  toast.timer = setTimeout(() => { t.hidden = true; }, 240);
}
/** In-app confirmation (bottom sheet). Native confirm() is unreliable in iOS home-screen apps. */
let sheetDone = null;
function confirmSheet(msg, { ok = 'Aceptar', danger = false } = {}) {
  return new Promise(resolve => {
    const sh = $('#sheet'), okBtn = $('#sheet-ok');
    $('#sheet-msg').textContent = msg; okBtn.textContent = ok; okBtn.classList.toggle('danger', danger);
    sh.hidden = false; sh.classList.remove('closing'); requestAnimationFrame(() => sh.classList.add('open'));
    sheetDone = v => { sheetDone = null; sh.classList.add('closing'); sh.classList.remove('open'); sh.onclick = null;
      setTimeout(() => { sh.hidden = true; sh.classList.remove('closing'); }, 300); resolve(v); };
    sh.onclick = e => { const b = e.target.closest('[data-sheet]'); if (b && sheetDone) sheetDone(b.dataset.sheet === 'ok'); };
  });
}
/** Drag the sheet down to dismiss (momentum + damping when pulling up), like a native iOS sheet. */
(function initSheetDrag() {
  const sh = $('#sheet'), panel = $('.sheet-panel', sh), backdrop = $('.sheet-backdrop', sh);
  let active = false, startY = 0, lastY = 0, lastT = 0, vel = 0;
  panel.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    active = true; startY = lastY = e.clientY; lastT = performance.now(); vel = 0;
    panel.classList.add('dragging'); try { panel.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
  });
  panel.addEventListener('pointermove', e => {
    if (!active) return;
    const t = performance.now(), dy = e.clientY - startY;
    vel = (e.clientY - lastY) / Math.max(1, t - lastT); lastY = e.clientY; lastT = t;
    const y = dy > 0 ? dy : -Math.pow(-dy, 0.6);              // damping when pulling up
    panel.style.transform = `translateY(${y}px)`;
    backdrop.style.opacity = dy > 0 ? String(Math.max(0, 1 - dy / panel.offsetHeight)) : '';
  });
  const end = () => {
    if (!active) return; active = false; panel.classList.remove('dragging');
    const dy = lastY - startY, close = dy > panel.offsetHeight * 0.35 || vel > 0.6;
    panel.style.transform = ''; backdrop.style.opacity = '';
    if (close && sheetDone) sheetDone(false);
  };
  panel.addEventListener('pointerup', end); panel.addEventListener('pointercancel', end);
})();

// ===== backup =====
/* The reminder clock stays out of the state blob, like the theme: a copia is the horario, not
   "when this phone last saved one". he.dataSince is the first day we saw real data (or an older
   day inferred from checks and createdAt), so someone who already has months of history is
   reminded now, and someone who just started is not reminded for 30 days. */
const BACKUP_AT_KEY = 'he.backupAt';
const BACKUP_SNOOZE_KEY = 'he.backupSnooze';
const DATA_SINCE_KEY = 'he.dataSince';
const BACKUP_REMIND_MS = 30 * DAY_MS;
const FREQ_IDS = new Set(FREQS.map(f => f.id));
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const WEEK_RE = /^\d{4}-W\d{2}$/;
function validMonthKey(k) {
  if (!MONTH_RE.test(k)) return false;
  const m = Number(k.slice(5));
  return m >= 1 && m <= 12;
}
function validDayKey(k) {
  if (!DAY_RE.test(k)) return false;
  const m = Number(k.slice(5, 7)), d = Number(k.slice(8));
  return m >= 1 && m <= 12 && d >= 1 && d <= 31;
}
function validWeekKey(k) {
  if (!WEEK_RE.test(k)) return false;
  const w = Number(k.slice(6));
  return w >= 1 && w <= 53;
}

function readStamp(key) {
  try { const n = Number(localStorage.getItem(key)); return Number.isFinite(n) && n > 0 ? n : 0; }
  catch (e) { return 0; }
}
function plainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
/** Real horario content. The empty month snapshot created just by opening Hoy does not count. */
function hasUserData(s = state) {
  const t = s.template || {};
  if (String(t.particular || '').trim()) return true;
  if (Array.isArray(t.resolutions) && t.resolutions.length) return true;
  if (s.settings && String(s.settings.name || '').trim()) return true;
  if (s.scores && Object.keys(s.scores).length) return true;
  if (s.checks) for (const days of Object.values(s.checks)) if (days && Object.keys(days).length) return true;
  if (s.months) for (const m of Object.values(s.months)) {
    if (!m) continue;
    if (String(m.particular || '').trim()) return true;
    if (Array.isArray(m.resolutions) && m.resolutions.length) return true;
  }
  return false;
}
function inferOldestDataTime() {
  let oldest = '';
  const limit = dayKey(today());
  const consider = k => { if (typeof k === 'string' && DAY_RE.test(k) && k <= limit && (!oldest || k < oldest)) oldest = k; };
  for (const r of (state.template && state.template.resolutions) || []) consider(r.createdAt);
  for (const m of Object.values(state.months || {})) for (const r of (m && m.resolutions) || []) consider(r.createdAt);
  for (const days of Object.values(state.checks || {})) {
    if (!days || typeof days !== 'object') continue;
    for (const k of Object.keys(days)) if (days[k]) consider(k);
  }
  for (const k of Object.keys(state.scores || {})) if (state.scores[k]) consider(k);
  return oldest ? parseDay(oldest).getTime() : 0;
}
function noteDataSince() {
  try {
    if (!hasUserData()) { localStorage.removeItem(DATA_SINCE_KEY); return; }
    if (readStamp(DATA_SINCE_KEY)) return;
    localStorage.setItem(DATA_SINCE_KEY, String(inferOldestDataTime() || Date.now()));
  } catch (e) { /* private mode */ }
}
function markBackup() {
  try { localStorage.setItem(BACKUP_AT_KEY, String(Date.now())); localStorage.removeItem(BACKUP_SNOOZE_KEY); }
  catch (e) { /* the copy itself still went out */ }
}
function snoozeBackupReminder() {
  try { localStorage.setItem(BACKUP_SNOOZE_KEY, String(Date.now() + BACKUP_REMIND_MS)); } catch (e) {}
}
function reminderDue() {
  if (!hasUserData()) return false;
  if (readStamp(BACKUP_SNOOZE_KEY) > Date.now()) return false;
  const at = readStamp(BACKUP_AT_KEY);
  if (at) return Date.now() - at >= BACKUP_REMIND_MS;
  const since = readStamp(DATA_SINCE_KEY);
  return !!since && Date.now() - since >= BACKUP_REMIND_MS;
}
function fmtBackupDate(ts) {
  const d = new Date(ts), y = d.getFullYear();
  const base = `${d.getDate()} de ${MESES[d.getMonth()]}`;
  return y === today().getFullYear() ? base : `${base} de ${y}`;
}
function backupBannerHtml() {
  if (!reminderDue()) return '';
  const at = readStamp(BACKUP_AT_KEY);
  const msg = at
    ? `La última copia es del ${esc(fmtBackupDate(at))}. Si borras la app, lo apuntado desde entonces puede perderse.`
    : 'Hace más de un mes que no guardas una copia. Si borras la app de la pantalla de inicio, estos datos se pierden.';
  return `<aside class="card banner"><p>${msg}</p><div class="banner-actions">
      <button class="pill" data-action="export">Guardar copia</button>
      <button class="textbtn" data-action="backup-dismiss">Ahora no</button>
    </div></aside>`;
}
function validResolution(r) {
  if (!plainObject(r)) return false;
  if (typeof r.id !== 'string' || !r.id || r.id.length > 80) return false;
  if (typeof r.text !== 'string' || r.text.length > 1000) return false;
  if (!FREQ_IDS.has(r.freq)) return false;
  if (r.order != null && (typeof r.order !== 'number' || !Number.isFinite(r.order))) return false;
  if (r.createdAt != null && (typeof r.createdAt !== 'string' || !validDayKey(r.createdAt))) return false;
  return true;
}
/** Structural check before any confirm or write. Legacy v1 period keys are allowed; migrate() drops them. */
function isBackup(s) {
  if (!plainObject(s) || !plainObject(s.template) || !plainObject(s.months)) return false;
  if (s.version != null && (!Number.isInteger(s.version) || s.version < 1 || s.version > 99)) return false;
  const t = s.template;
  if (t.particular != null && (typeof t.particular !== 'string' || t.particular.length > 1000)) return false;
  if (t.resolutions != null && !Array.isArray(t.resolutions)) return false;
  if (Array.isArray(t.resolutions) && (t.resolutions.length > 400 || !t.resolutions.every(validResolution))) return false;
  const monthKeys = Object.keys(s.months);
  if (monthKeys.length > 240) return false;
  for (const mk of monthKeys) {
    const m = s.months[mk];
    if (!validMonthKey(mk) || !plainObject(m)) return false;
    if (m.particular != null && (typeof m.particular !== 'string' || m.particular.length > 1000)) return false;
    if (m.resolutions != null && !Array.isArray(m.resolutions)) return false;
    if (Array.isArray(m.resolutions) && (m.resolutions.length > 400 || !m.resolutions.every(validResolution))) return false;
  }
  if (s.checks != null && !plainObject(s.checks)) return false;
  if (s.checks) {
    let n = 0;
    for (const days of Object.values(s.checks)) {
      if (!plainObject(days)) return false;
      for (const [k, v] of Object.entries(days)) {
        if (v !== true || !(validDayKey(k) || validWeekKey(k) || validMonthKey(k))) return false;
        if (++n > 100000) return false;
      }
    }
  }
  if (s.scores != null && !plainObject(s.scores)) return false;
  if (s.scores) {
    const scores = Object.entries(s.scores);
    if (scores.length > 20000) return false;
    for (const [k, v] of scores) if (!validDayKey(k) || !Number.isInteger(v) || v < 1 || v > 5) return false;
  }
  if (s.settings != null && !plainObject(s.settings)) return false;
  if (s.settings && s.settings.name != null && (typeof s.settings.name !== 'string' || s.settings.name.length > 200)) return false;
  return true;
}
/** File the share sheet will actually take. WebKit (iPhone) accepts the .json. Chromium's canShare()
 *  returns true and then share() throws for application/json — it isn't on the allowlist — so on
 *  Android the same JSON goes out as .txt, which the sheet does accept. The download fallback keeps
 *  the .json name. Restore reads either; it checks the contents, not the extension. */
function backupShareFile(body, jsonName) {
  if (!navigator.canShare) return null;
  const json = new File([body], jsonName, { type: 'application/json' });
  const text = new File([body], jsonName.replace(/\.json$/i, '.txt'), { type: 'text/plain' });
  const androidChrome = /Android/.test(navigator.userAgent) && /Chrome|Chromium/.test(navigator.userAgent);
  const candidates = androidChrome ? [text, json] : [json, text];
  return candidates.find(file => { try { return navigator.canShare({ files: [file] }); } catch (e) { return false; } }) || null;
}
function downloadBackup(body, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
function finishBackup(message) {
  markBackup();
  render();
  toast(message);
}
/** Phones and iPads get the system sheet. Desktop always downloads: Chrome there says it can share a
 *  JSON file and then rejects it, and a download is the reliable one-tap path at a computer. */
function isHandheld() {
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}
async function exportBackup() {
  const name = `horario-espiritual-${dayKey(today())}.json`;
  const body = JSON.stringify(state, null, 2);
  const file = isHandheld() ? backupShareFile(body, name) : null;
  if (file) {
    try {
      await navigator.share({ files: [file], title: 'Copia de Horario Espiritual' });
      finishBackup('Copia lista.');
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      if (e && e.name === 'NotAllowedError') { toast('Toca de nuevo para compartir la copia.'); return; }
    }
  }
  downloadBackup(body, name);
  finishBackup('Copia descargada.');
}
function importBackup(file) {
  if (!file) return;
  const rd = new FileReader();
  rd.onerror = () => toast('No se pudo leer el archivo.');
  rd.onload = async () => {
    const text = String(rd.result || '').replace(/^\uFEFF/, '').trim();
    if (text.length > 4000000) { toast('El archivo es demasiado grande.'); return; }
    let s;
    try { s = JSON.parse(text); }
    catch (e) { toast('El archivo no es una copia válida.'); return; }
    if (!isBackup(s)) { toast('El archivo no es una copia válida.'); return; }
    const n = Object.keys(s.months).length;
    const ok = await confirmSheet(
      `Restaurar reemplazará todos los datos actuales por la copia (${n} ${n === 1 ? 'mes' : 'meses'}). ¿Continuar?`,
      { ok: 'Restaurar' });
    if (!ok) return;
    let next;
    try { next = migrate(JSON.parse(JSON.stringify(s))); }
    catch (e) { toast('El archivo no es una copia válida.'); return; }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    catch (e) { console.error('restore failed', e); toast('No se pudo restaurar. ¿Almacenamiento lleno?'); return; }
    state = next;
    markBackup();
    noteDataSince();
    ui.editing = null;
    ui.anim = 'fade';
    render();
    toast('Copia restaurada.');
  };
  rd.readAsText(file);
}

// ===== events =====
async function removeResolutionUI(id) {
  const r = state.template.resolutions.find(x => x.id === id); if (!r) return;
  const msg = hasChecksThisMonth(id)
    ? `«${r.text}» ya tiene marcas este mes. Se quitará de la plantilla: este mes se conserva y desaparece a partir del próximo.`
    : `¿Eliminar «${r.text}»?`;
  if (await confirmSheet(msg, { ok: 'Eliminar', danger: true })) { removeResolution(id); render(); }
}

$('#view').addEventListener('click', e => {
  const el = e.target.closest('[data-action]'); if (!el || el.disabled) return;
  const id = el.dataset.id, key = el.dataset.key;
  switch (el.dataset.action) {
    case 'day:prev': ui.day = addDays(ui.day, -1); ui.anim = 'right'; break;
    case 'day:next': if (ui.day < today()) { ui.day = addDays(ui.day, 1); ui.anim = 'left'; } break;
    case 'day:today': ui.day = today(); ui.anim = 'left'; break;
    case 'month:prev': { const d = new Date(ui.month.y, ui.month.m0 - 1, 1); ui.month = { y: d.getFullYear(), m0: d.getMonth() }; ui.anim = 'right'; break; }
    case 'month:next': { const d = new Date(ui.month.y, ui.month.m0 + 1, 1); if (d <= today()) { ui.month = { y: d.getFullYear(), m0: d.getMonth() }; ui.anim = 'left'; } break; }
    case 'rotate': ui.rotated = !ui.rotated; ui.anim = 'fade'; $('#view').scrollTop = 0; break;
    case 'check': toggleCheck(id, key); renderAndPop(`[data-action="check"][data-id="${id}"][data-key="${key}"]`); return;
    case 'score': { const v = +el.dataset.v, dk = dayKey(ui.day); setScore(dk, getScore(dk) === v ? null : v); renderAndPop(`[data-action="score"][data-v="${v}"]`); return; }
    case 'edit': ui.editing = id; break;
    case 'move': moveResolution(id, +el.dataset.dir); break;
    case 'remove': removeResolutionUI(id); return;
    case 'goto': ui.tab = el.dataset.tab; ui.anim = 'fade'; break;
    case 'theme': setTheme(el.dataset.theme); break;
    case 'pdf': exportPdf(); return;
    case 'export': exportBackup(); return;
    case 'backup-dismiss': snoozeBackupReminder(); break;
    case 'update': checkForUpdates(); return;
    case 'import': $('#file-import').click(); return;
    default: return;
  }
  render();
});
$('#view').addEventListener('submit', e => {
  const f = e.target.closest('form.addrow'); if (!f) return;
  e.preventDefault();
  const text = f.text.value.trim(); if (!text) return;
  if (!addResolution(f.dataset.freq, text)) { toast('Ya tienes un punto con ese nombre.'); return; }
  render();
  const inp = $(`form.addrow[data-freq="${f.dataset.freq}"] input`); if (inp) inp.focus();
});
$('#view').addEventListener('keydown', e => {
  if (!e.target.matches('.edit-input')) return;
  if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  if (e.key === 'Escape') { ui.editing = null; render(); }
});
$('#view').addEventListener('focusout', e => {
  if (!e.target.matches('.edit-input') || ui.editing !== e.target.dataset.id) return;
  const text = e.target.value.trim();
  if (text) editResolution(e.target.dataset.id, text);
  ui.editing = null; render();
});
$('#view').addEventListener('input', e => {
  if (e.target.id === 'particular') setParticular(e.target.value);
  if (e.target.id === 'name') { state.settings.name = e.target.value.trim(); save(); }
});
document.querySelector('.tabbar').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]'); if (!b || b.dataset.tab === ui.tab) return;
  ui.tab = b.dataset.tab; ui.editing = null; ui.anim = 'fade'; $('#view').scrollTop = 0; render();
});
$('#file-import').addEventListener('change', e => { const f = e.target.files[0]; if (f) importBackup(f); e.target.value = ''; });

// Day rollover (06:00) while the app stays open: follow the logical "today" if the user was on it.
let lastToday = dayKey(today());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const t = dayKey(today());
  if (t !== lastToday) { if (dayKey(ui.day) === lastToday) ui.day = today(); lastToday = t; }
  render();
});

// ===== boot =====
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
applyTheme();
noteDataSince();
render();
// Service worker: offline shell. Files are network-first, so a fresh launch already shows the latest
// deploy; the toast only appears if the SW that just activated is newer than the page that is running.
async function checkForUpdates() {
  toast('Buscando actualizaciones…');
  try { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (e) { /* offline */ }
  setTimeout(() => location.reload(), 400);
}
if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  navigator.serviceWorker.addEventListener('message', e => {
    if (!e.data || e.data.type !== 'sw-activated' || e.data.version === APP_VERSION) return;
    toast(`Versión ${e.data.version} disponible · toca para actualizar`, { sticky: true, onTap: () => location.reload() });
  });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
