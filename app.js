/* Horario Espiritual — app.js
   Vanilla JS, no build step. Sections: constants · date utils · state · domain ops ·
   rendering (pure functions → HTML strings) · events · boot.  Spec: docs/PLAN.md */
'use strict';

// ===== constants =====
const STORAGE_KEY = 'he.v1';
const APP_VERSION = '0.1';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const DIAS_L = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const FREQS = [
  { id: 'daily', title: 'Diarias', one: 'diaria' },
  { id: 'weekly', title: 'Semanales', one: 'semanal' },
  { id: 'monthly', title: 'Mensuales', one: 'mensual' },
];
const SCORE_LABELS = { 1: 'Mal', 2: 'Flojo', 3: 'Regular', 4: 'Bien', 5: 'Muy bien' };

// ===== date utils (all local time; weeks start on Monday, ISO numbering) =====
const DAY_MS = 86400000;
const pad2 = n => String(n).padStart(2, '0');
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
function today() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function dayKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function monthKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
function monthKeyOf(y, m0) { return `${y}-${pad2(m0 + 1)}`; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function sameDay(a, b) { return dayKey(a) === dayKey(b); }
function daysInMonth(y, m0) { return new Date(y, m0 + 1, 0).getDate(); }
function weekdayIndex(d) { return (d.getDay() + 6) % 7; } // 0 = Monday
function startOfWeek(d) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(r, -weekdayIndex(r));
}
function isoWeekKey(d) {
  const monday = startOfWeek(d);
  const thursday = addDays(monday, 3);
  const year = thursday.getFullYear();
  const week1Monday = startOfWeek(new Date(year, 0, 4));
  const week = Math.round((monday - week1Monday) / (7 * DAY_MS)) + 1;
  return `${year}-W${pad2(week)}`;
}
function periodKey(freq, d) {
  return freq === 'daily' ? dayKey(d) : freq === 'weekly' ? isoWeekKey(d) : monthKey(d);
}
/** ISO weeks intersecting a month, clamped to the month for labelling. */
function weeksOfMonth(y, m0) {
  const first = new Date(y, m0, 1), last = new Date(y, m0, daysInMonth(y, m0));
  const out = [];
  for (let ws = startOfWeek(first); ws <= last; ws = addDays(ws, 7)) {
    const we = addDays(ws, 6);
    const s = ws < first ? first : ws, e = we > last ? last : we;
    out.push({ key: isoWeekKey(ws), start: s, end: e,
      label: s.getDate() === e.getDate() ? `${s.getDate()}` : `${s.getDate()}–${e.getDate()}` });
  }
  return out;
}
function fmtLong(d) { return `${DIAS[weekdayIndex(d)]}, ${d.getDate()} de ${MESES[d.getMonth()]}`; }
function weekLabel(d) {
  const s = startOfWeek(d), e = addDays(s, 6);
  return s.getMonth() === e.getMonth()
    ? `del ${s.getDate()} al ${e.getDate()} de ${MESES[e.getMonth()]}`
    : `del ${s.getDate()} de ${MESES[s.getMonth()]} al ${e.getDate()} de ${MESES[e.getMonth()]}`;
}

// ===== state & persistence =====
function defaultState() {
  return { version: 1, template: { particular: '', resolutions: [] }, months: {}, checks: {}, scores: {}, settings: {} };
}
function migrate(s) {
  if (!s || typeof s !== 'object') return defaultState();
  s.version = s.version || 1;
  s.template = s.template || {}; s.template.particular = s.template.particular || '';
  s.template.resolutions = Array.isArray(s.template.resolutions) ? s.template.resolutions : [];
  s.months = s.months || {}; s.checks = s.checks || {}; s.scores = s.scores || {}; s.settings = s.settings || {};
  return s;
}
function load() {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? migrate(JSON.parse(raw)) : defaultState(); }
  catch (e) { console.error('load failed', e); return defaultState(); }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { console.error('save failed', e); toast('No se pudo guardar. ¿Almacenamiento lleno?'); }
}
const uid = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
let state = load();

// ===== domain ops =====
const sortedRes = list => [...list].sort((a, b) => a.order - b.order);
const snapshotOf = r => ({ id: r.id, text: r.text, freq: r.freq, order: r.order });
function getMonth(mk) { return state.months[mk] || null; }
/** Current month gets a snapshot of the template the first time it is opened. Past months never do. */
function ensureMonth(mk) {
  if (state.months[mk]) return state.months[mk];
  if (mk !== monthKey(today())) return null;
  state.months[mk] = { particular: state.template.particular, resolutions: state.template.resolutions.map(snapshotOf) };
  save();
  return state.months[mk];
}
const currentMonth = () => ensureMonth(monthKey(today()));

function addResolution(freq, text) {
  const same = state.template.resolutions.filter(r => r.freq === freq);
  const r = { id: uid(), text, freq, order: same.length ? Math.max(...same.map(x => x.order)) + 1 : 0, createdAt: dayKey(today()) };
  state.template.resolutions.push(r);
  currentMonth().resolutions.push(snapshotOf(r));
  save();
}
function editResolution(id, text) {
  const t = state.template.resolutions.find(r => r.id === id); if (t) t.text = text;
  const m = currentMonth().resolutions.find(r => r.id === id); if (m) m.text = text;
  save();
}
function hasChecksThisMonth(id) {
  const mk = monthKey(today()), c = state.checks[id] || {};
  const weekKeys = new Set(weeksOfMonth(today().getFullYear(), today().getMonth()).map(w => w.key));
  return Object.keys(c).some(k => c[k] && (k.startsWith(mk) || weekKeys.has(k)));
}
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
  const m = currentMonth();
  m.resolutions.forEach(mr => { const tr = state.template.resolutions.find(r => r.id === mr.id); if (tr) mr.order = tr.order; });
  save();
}
function setParticular(text) {
  state.template.particular = text;
  currentMonth().particular = text;
  save();
}
function isChecked(id, key) { return !!(state.checks[id] && state.checks[id][key]); }
function toggleCheck(id, key) {
  state.checks[id] = state.checks[id] || {};
  if (state.checks[id][key]) delete state.checks[id][key]; else state.checks[id][key] = true;
  save();
}
function getScore(dk) { return state.scores[dk] || null; }
function setScore(dk, v) { if (v == null) delete state.scores[dk]; else state.scores[dk] = v; save(); }

// ===== rendering =====
const ui = { tab: 'hoy', day: today(), month: { y: today().getFullYear(), m0: today().getMonth() }, editing: null };
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtAvg = n => n.toFixed(1).replace('.', ',');

function emptyCard(title, text, gotoTab) {
  return `<section class="card empty"><h2>${esc(title)}</h2><p>${esc(text)}</p>` +
    (gotoTab ? `<button class="pill" data-action="goto" data-tab="${gotoTab}">Ir a Resoluciones</button>` : '') + `</section>`;
}
function checklistHTML(list, keyFor) {
  return `<ul class="checklist">` + list.map(r => {
    const key = keyFor(r), on = isChecked(r.id, key);
    return `<li><button class="row ${on ? 'done' : ''}" data-action="check" data-id="${r.id}" data-key="${key}" aria-pressed="${on}">` +
      `<span class="box"></span><span class="txt">${esc(r.text)}</span></button></li>`;
  }).join('') + `</ul>`;
}

function renderHoy() {
  const d = ui.day, dk = dayKey(d), mk = monthKey(d), isToday = sameDay(d, today());
  const m = mk === monthKey(today()) ? ensureMonth(mk) : getMonth(mk);
  let html = `<div class="daynav">
    <button class="icon" data-action="day:prev" aria-label="Día anterior">&#8249;</button>
    <div class="daynav-title"><div class="big">${esc(cap(fmtLong(d)))}</div>
      ${isToday ? '' : `<button class="pill" data-action="day:today">Volver a hoy</button>`}</div>
    <button class="icon" data-action="day:next" ${isToday ? 'disabled' : ''} aria-label="Día siguiente">&#8250;</button>
  </div>`;
  if (!m) return html + emptyCard('Este mes no tiene horario', 'No se abrió la app durante este mes, así que no hay resoluciones registradas.');
  const res = sortedRes(m.resolutions);
  if (!res.length && !m.particular) return html + emptyCard('Aún no tienes resoluciones', 'Empieza por añadir tu examen particular y tus resoluciones.', 'resoluciones');
  if (m.particular) {
    const sc = getScore(dk);
    html += `<section class="card"><div class="card-label">Examen particular</div>
      <div class="particular-text">${esc(m.particular)}</div>
      <div class="scores">${[1, 2, 3, 4, 5].map(v => `<button class="score ${sc === v ? 'on' : ''}" data-action="score" data-v="${v}" aria-pressed="${sc === v}">${v}</button>`).join('')}</div>
      <div class="hint">${sc ? esc(SCORE_LABELS[sc]) : 'Puntúa del 1 al 5 cómo viviste tu propósito.'}</div></section>`;
  }
  if (res.length) {
    const done = res.filter(r => isChecked(r.id, periodKey(r.freq, d))).length;
    html += `<div class="progress">${done} de ${res.length} cumplidas</div>`;
  }
  for (const f of FREQS) {
    const list = res.filter(r => r.freq === f.id);
    if (!list.length) continue;
    const sub = f.id === 'weekly' ? weekLabel(d) : f.id === 'monthly' ? cap(MESES[d.getMonth()]) : '';
    html += `<section class="card"><div class="card-label">${f.title}${sub ? ` <span class="muted">· ${esc(sub)}</span>` : ''}</div>` +
      checklistHTML(list, r => periodKey(f.id, d)) + `</section>`;
  }
  return html;
}

function renderMes() {
  const { y, m0 } = ui.month, mk = monthKeyOf(y, m0), isCurrent = mk === monthKey(today());
  const m = isCurrent ? ensureMonth(mk) : getMonth(mk);
  let html = `<div class="daynav">
    <button class="icon" data-action="month:prev" aria-label="Mes anterior">&#8249;</button>
    <div class="daynav-title"><div class="big">${cap(MESES[m0])} ${y}</div></div>
    <button class="icon" data-action="month:next" ${isCurrent ? 'disabled' : ''} aria-label="Mes siguiente">&#8250;</button>
  </div>`;
  if (!m) return html + emptyCard('Sin horario este mes', 'No hay resoluciones registradas para este mes.');
  const res = sortedRes(m.resolutions);
  if (!res.length && !m.particular) return html + emptyCard('Sin resoluciones', 'Este mes no tiene resoluciones registradas.', isCurrent ? 'resoluciones' : null);

  const nDays = daysInMonth(y, m0);
  const lastDay = isCurrent ? today().getDate() : nDays;           // days elapsed
  const weeks = weeksOfMonth(y, m0);
  const elapsedWeeks = weeks.filter(w => w.start <= today()).length;
  const cls = d => { const wd = weekdayIndex(new Date(y, m0, d)); return (wd >= 5 ? 'we ' : '') + (isCurrent && d === lastDay ? 'today' : ''); };
  const scores = range(1, nDays).map(d => getScore(`${mk}-${pad2(d)}`)).filter(Boolean);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  if (m.particular) {
    html += `<section class="card"><div class="card-label">Examen particular</div>
      <div class="particular-text">${esc(m.particular)}</div>
      <div class="stat">${avg ? `Media <b>${fmtAvg(avg)}</b> · ${scores.length} ${scores.length === 1 ? 'día puntuado' : 'días puntuados'}` : 'Sin puntuaciones todavía'}</div></section>`;
  }
  const daily = res.filter(r => r.freq === 'daily');
  if (daily.length || m.particular) {
    html += `<section class="card grid-card"><div class="card-label">Diarias</div><div class="gridwrap"><table class="grid"><thead>
      <tr><th class="lab"></th>${range(1, nDays).map(d => `<th class="${cls(d)}">${DIAS_L[weekdayIndex(new Date(y, m0, d))]}</th>`).join('')}<th class="tot"></th></tr>
      <tr><th class="lab"></th>${range(1, nDays).map(d => `<th class="${cls(d)}">${d}</th>`).join('')}<th class="tot">Total</th></tr></thead><tbody>`;
    if (m.particular) {
      html += `<tr class="examen"><th class="lab">Examen particular</th>` + range(1, nDays).map(d => {
        const s = getScore(`${mk}-${pad2(d)}`);
        return `<td class="${cls(d)} ${s ? 's' + s : ''}">${d <= lastDay ? (s || '·') : ''}</td>`;
      }).join('') + `<td class="tot">${avg ? fmtAvg(avg) : '–'}</td></tr>`;
    }
    for (const r of daily) {
      let n = 0;
      const cells = range(1, nDays).map(d => {
        const k = `${mk}-${pad2(d)}`, on = isChecked(r.id, k), future = d > lastDay;
        if (on) n++;
        return `<td class="${cls(d)} ${on ? 'on' : ''} ${future ? 'future' : ''}" ${future ? '' : `data-action="check" data-id="${r.id}" data-key="${k}"`}>${on ? '✓' : (future ? '' : '·')}</td>`;
      }).join('');
      html += `<tr><th class="lab">${esc(r.text)}</th>${cells}<td class="tot">${n}/${lastDay}</td></tr>`;
    }
    html += `</tbody></table></div></section>`;
  }
  const weekly = res.filter(r => r.freq === 'weekly');
  if (weekly.length) {
    html += `<section class="card grid-card"><div class="card-label">Semanales</div><div class="gridwrap"><table class="grid weeks"><thead>
      <tr><th class="lab"></th>${weeks.map(w => `<th>${w.label}</th>`).join('')}<th class="tot">Total</th></tr></thead><tbody>`;
    for (const r of weekly) {
      let n = 0;
      const cells = weeks.map(w => {
        const on = isChecked(r.id, w.key), future = w.start > today();
        if (on) n++;
        return `<td class="${on ? 'on' : ''} ${future ? 'future' : ''}" ${future ? '' : `data-action="check" data-id="${r.id}" data-key="${w.key}"`}>${on ? '✓' : (future ? '' : '·')}</td>`;
      }).join('');
      html += `<tr><th class="lab">${esc(r.text)}</th>${cells}<td class="tot">${n}/${elapsedWeeks}</td></tr>`;
    }
    html += `</tbody></table></div></section>`;
  }
  const monthly = res.filter(r => r.freq === 'monthly');
  if (monthly.length) html += `<section class="card"><div class="card-label">Mensuales</div>${checklistHTML(monthly, () => mk)}</section>`;
  html += `<div class="actions"><button class="primary" data-action="pdf">Exportar PDF</button></div>`;
  return html;
}

function renderResoluciones() {
  const t = state.template;
  let html = `<section class="card"><div class="card-label">Examen particular</div>
    <textarea id="particular" rows="2" placeholder="Ej.: Vivir la paciencia en casa">${esc(t.particular)}</textarea>
    <div class="hint">Tu propósito particular. Lo puntúas cada día del 1 al 5.</div></section>`;
  for (const f of FREQS) {
    const list = sortedRes(t.resolutions.filter(r => r.freq === f.id));
    html += `<section class="card"><div class="card-label">${f.title}</div><ul class="editlist">`;
    list.forEach((r, i) => {
      html += `<li class="editrow">` + (ui.editing === r.id
        ? `<input class="edit-input" data-id="${r.id}" value="${esc(r.text)}" aria-label="Editar resolución">`
        : `<button class="txt" data-action="edit" data-id="${r.id}" title="Tocar para editar">${esc(r.text)}</button>`) +
        `<span class="rowbtns">
          <button class="mini" data-action="move" data-id="${r.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir">&#8593;</button>
          <button class="mini" data-action="move" data-id="${r.id}" data-dir="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Bajar">&#8595;</button>
          <button class="mini danger" data-action="remove" data-id="${r.id}" aria-label="Eliminar">&#215;</button>
        </span></li>`;
    });
    html += `</ul><form class="addrow" data-freq="${f.id}"><input name="text" placeholder="Nueva resolución ${f.one}" autocomplete="off" enterkeyhint="done"><button type="submit">Añadir</button></form></section>`;
  }
  html += `<p class="note">Los cambios se aplican al mes actual y a los siguientes; los meses anteriores no cambian. Si eliminas una resolución que ya tiene marcas este mes, se conserva en este mes y desaparece a partir del próximo.</p>`;
  return html;
}

function renderAjustes() {
  const kb = ((localStorage.getItem(STORAGE_KEY) || '').length / 1024).toFixed(1);
  const months = Object.keys(state.months).length;
  return `<section class="card"><div class="card-label">Datos</div>
    <p>Todo se guarda en este dispositivo (${kb} KB, ${months} ${months === 1 ? 'mes' : 'meses'}). Nada sale del teléfono.</p>
    <p class="hint">Haz una copia de vez en cuando: si borras la app de la pantalla de inicio, sus datos se borran con ella.</p>
    <div class="actions col"><button class="secondary" data-action="export">Exportar copia (JSON)</button>
    <button class="secondary" data-action="import">Importar copia…</button></div></section>
    <section class="card"><div class="card-label">Acerca de</div><p>Horario Espiritual · versión ${APP_VERSION}</p>
    <p class="hint">Una ayuda para vivir el Horario Espiritual: pocas resoluciones, revisadas cada mes.</p></section>`;
}

function render() {
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === ui.tab));
  $('#title').textContent = { hoy: 'Hoy', mes: 'Mes', resoluciones: 'Resoluciones', ajustes: 'Ajustes' }[ui.tab];
  $('#view').innerHTML = ({ hoy: renderHoy, mes: renderMes, resoluciones: renderResoluciones, ajustes: renderAjustes })[ui.tab]();
  if (ui.editing) { const inp = $('.edit-input'); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ===== backup =====
async function exportBackup() {
  const name = `horario-espiritual-${dayKey(today())}.json`;
  const file = new File([JSON.stringify(state, null, 2)], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Copia de Horario Espiritual' }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importBackup(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const s = JSON.parse(rd.result);
      if (!s || typeof s !== 'object' || !s.template || !s.months) throw new Error('formato');
      if (!confirm('Importar reemplazará todos los datos actuales. ¿Continuar?')) return;
      state = migrate(s); save(); render(); toast('Copia importada.');
    } catch (e) { toast('El archivo no es una copia válida.'); }
  };
  rd.readAsText(file);
}

// ===== events =====
function removeResolutionUI(id) {
  const r = state.template.resolutions.find(x => x.id === id); if (!r) return;
  const msg = hasChecksThisMonth(id)
    ? `«${r.text}» ya tiene marcas este mes. Se quitará de la plantilla: este mes se conserva y desaparece a partir del próximo. ¿Continuar?`
    : `¿Eliminar «${r.text}»?`;
  if (confirm(msg)) removeResolution(id);
}

$('#view').addEventListener('click', e => {
  const el = e.target.closest('[data-action]'); if (!el || el.disabled) return;
  const a = el.dataset.action;
  switch (a) {
    case 'day:prev': ui.day = addDays(ui.day, -1); break;
    case 'day:next': if (ui.day < today()) ui.day = addDays(ui.day, 1); break;
    case 'day:today': ui.day = today(); break;
    case 'month:prev': { const d = new Date(ui.month.y, ui.month.m0 - 1, 1); ui.month = { y: d.getFullYear(), m0: d.getMonth() }; break; }
    case 'month:next': { const d = new Date(ui.month.y, ui.month.m0 + 1, 1); if (d <= today()) ui.month = { y: d.getFullYear(), m0: d.getMonth() }; break; }
    case 'check': toggleCheck(el.dataset.id, el.dataset.key); break;
    case 'score': { const v = +el.dataset.v, dk = dayKey(ui.day); setScore(dk, getScore(dk) === v ? null : v); break; }
    case 'edit': ui.editing = el.dataset.id; break;
    case 'move': moveResolution(el.dataset.id, +el.dataset.dir); break;
    case 'remove': removeResolutionUI(el.dataset.id); break;
    case 'goto': ui.tab = el.dataset.tab; break;
    case 'pdf': toast('La exportación a PDF llega en el siguiente paso.'); return;
    case 'export': exportBackup(); return;
    case 'import': $('#file-import').click(); return;
    default: return;
  }
  render();
});
$('#view').addEventListener('submit', e => {
  const f = e.target.closest('form.addrow'); if (!f) return;
  e.preventDefault();
  const text = f.text.value.trim(); if (!text) return;
  addResolution(f.dataset.freq, text); render();
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
$('#view').addEventListener('input', e => { if (e.target.id === 'particular') setParticular(e.target.value); });
document.querySelector('.tabbar').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  ui.tab = b.dataset.tab; ui.editing = null; render();
});
$('#btn-settings').addEventListener('click', () => { ui.tab = 'ajustes'; ui.editing = null; render(); });
$('#file-import').addEventListener('change', e => { const f = e.target.files[0]; if (f) importBackup(f); e.target.value = ''; });

// Midnight rollover while the app stays open: follow "today" if the user was on it.
let lastToday = dayKey(today());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const now = dayKey(today());
  if (now !== lastToday) { if (dayKey(ui.day) === lastToday) ui.day = today(); lastToday = now; }
  render();
});

// ===== boot =====
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
render();
