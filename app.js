'use strict';

const state = { week: null };

const SOURCE_ORDER = ['ERP', 'IMS', 'Service', 'Repair', 'Courier', 'SOMS'];
const SOURCE_COLORS = {
  ERP: { c: '#635bff' }, IMS: { c: '#0d9488' }, Service: { c: '#ea580c' },
  Repair: { c: '#9333ea' }, Courier: { c: '#0284c7' }, SOMS: { c: '#c026d3' }
};
const FALLBACK = ['#2563eb', '#16a34a', '#d97706', '#db2777'];
function srcColor(src, idx) { return (SOURCE_COLORS[src] || {}).c || FALLBACK[idx % FALLBACK.length]; }
function srcRank(s) { const i = SOURCE_ORDER.indexOf(s); return i === -1 ? 99 : i; }

function api(action, params = {}) {
  return new Promise((resolve, reject) => {
    const cb = 'jp_' + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    const timer = setTimeout(() => { cleanup(); reject(new Error('Network timeout')); }, 45000);
    function cleanup() { clearTimeout(timer); delete window[cb]; s.remove(); }
    window[cb] = (res) => { cleanup(); resolve(res); };
    const qs = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
    s.src = CONFIG.API_URL + '?action=' + action + '&callback=' + cb + (qs ? '&' + qs : '');
    s.onerror = () => { cleanup(); reject(new Error('Network error')); };
    document.body.appendChild(s);
  });
}

function fmtNum(v, label) {
  const n = Number(v);
  if (v === '' || v == null || isNaN(n)) return String(v == null ? '—' : v);
  const s = n.toLocaleString('en-IN');
  return (label && /₹/.test(label)) ? '₹' + s : s;
}
function cleanLabel(l) { return String(l || '').replace(/\s*\(₹\)|\s*\(Qty\)|\s*\(items\)/gi, ''); }
function fmtWeekLabel(a, b) {
  const d = s => { const p = String(s).split('-'); return p.length === 3 ? p[2] + '/' + p[1] : s; };
  return d(a) + ' – ' + d(b);
}
function sev(status) {
  if (['ZERO', 'CRITICAL', 'DROP', 'SPIKE', 'PILEUP'].indexOf(status) !== -1) return 'red';
  if (status === 'WATCH') return 'amber';
  if (status === 'UP_GOOD') return 'green';
  if (status === 'ERROR') return 'grey';
  return 'normal';
}
function statusText(s) {
  return { ZERO: 'Stopped', CRITICAL: 'Critical', DROP: 'Down', SPIKE: 'High', PILEUP: 'Piling up',
           WATCH: 'Unusual', UP_GOOD: 'Up', ERROR: 'Error', NORMAL: '' }[s] || s;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function isFlagged(x) { const b = sev(x.Status); return b === 'red' || b === 'amber' || b === 'grey'; }
function rank(s) { const o = { CRITICAL: 0, ZERO: 1, PILEUP: 2, DROP: 3, SPIKE: 4, WATCH: 5, ERROR: 9 }; return o[s] !== undefined ? o[s] : 6; }

async function loadWeeks(selectStart) {
  try {
    const r = await api('getWeeks');
    const sel = document.getElementById('weekSelect');
    if (!r.ok || !r.weeks.length) {
      sel.innerHTML = '<option>No weeks yet</option>';
      document.getElementById('report').innerHTML = card('No report yet', 'Run backfillWeeks once in the Apps Script editor.');
      return;
    }
    sel.innerHTML = r.weeks.map(w => `<option value="${w.start}">Week of ${fmtWeekLabel(w.start, w.end)}</option>`).join('');
    const pick = selectStart && r.weeks.some(w => w.start === selectStart) ? selectStart : r.weeks[0].start;
    sel.value = pick;
    await loadReport(pick);
  } catch (e) { document.getElementById('report').innerHTML = card('Could not connect', e.message); }
}
function card(t, s) { return `<div class="notice"><b>${esc(t)}</b><div class="muted">${esc(s)}</div></div>`; }

async function loadReport(week, attempt) {
  attempt = attempt || 1;
  state.week = week;
  document.getElementById('report').innerHTML = '<div class="skeleton"></div>'.repeat(2);
  try {
    const r = await api('getReport', { week });
    if (!r.ok) { document.getElementById('report').innerHTML = retryCard(r.message || 'Load failed', week); return; }
    renderReport(r);
  } catch (e) {
    if (attempt < 3) { return loadReport(week, attempt + 1); }   // transient timeout — retry
    document.getElementById('report').innerHTML = retryCard(e.message, week);
  }
}
function retryCard(msg, week) {
  return `<div class="notice"><b>Could not load</b>
    <div class="muted">${esc(msg)}</div>
    <button class="btn btn-ghost" style="margin-top:12px" onclick="loadReport('${esc(week)}')">Try again</button></div>`;
}

function tile(x, accent) {
  const b = sev(x.Status);
  const flag = b === 'red' ? 'red' : b === 'amber' ? 'amber' : b === 'green' ? 'green' : '';
  const dev = x.DeviationPct;
  let trend = '<span class="t-steady">steady</span>';
  if (b === 'red' || b === 'amber') trend = `<span class="t-flag ${b}">${statusText(x.Status)}</span>`;
  else if (dev !== '' && dev != null && !isNaN(Number(dev)) && Number(dev) !== 0) {
    const up = Number(dev) > 0; trend = `<span class="t-arrow ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(Number(dev))}%</span>`;
  }
  return `<div class="tile ${flag}" style="--sc:${accent}">
    <div class="t-label">${esc(cleanLabel(x.Label))}</div>
    <div class="t-num">${fmtNum(x.Value, x.Label)}</div>
    <div class="t-foot">${trend}</div>
  </div>`;
}

function renderReport(r) {
  const rows = r.rows || [];
  document.getElementById('weekHeader').innerHTML =
    `<h2>Week of ${fmtWeekLabel(r.week, r.weekEnd)}</h2>` +
    `<div class="gen muted">Sunday to Saturday${r.generatedAt ? ' · updated ' + r.generatedAt : ''}</div>`;

  if (!rows.length) { document.getElementById('report').innerHTML = card('No data for this week', 'Not generated yet.'); return; }

  let html = '';

  /* ---- Brief: pichhle hafte se behtar/bura, plain language ---- */
  const s = r.summary || { headline: '', good: [], bad: [] };
  html += `<div class="brief">
    <div class="brief-head">${esc(s.headline)}</div>`;
  if (s.good && s.good.length) {
    html += `<div class="brief-sec good"><div class="brief-cap"><i>✓</i> Better this week</div><ul>`;
    s.good.forEach(t => html += `<li>${esc(t)}</li>`);
    html += `</ul></div>`;
  }
  if (s.bad && s.bad.length) {
    html += `<div class="brief-sec bad"><div class="brief-cap"><i>!</i> Needs attention</div><ul>`;
    s.bad.forEach(t => html += `<li>${esc(t)}</li>`);
    html += `</ul></div>`;
  }
  if ((!s.good || !s.good.length) && (!s.bad || !s.bad.length)) {
    html += `<div class="brief-note">Everything ran about as usual — no big changes this week.</div>`;
  }
  html += `</div>`;

  /* ---- Numbers: tiles grouped by app (detail) ---- */
  const bySource = {};
  rows.forEach(x => (bySource[x.Source || 'Other'] = bySource[x.Source || 'Other'] || []).push(x));
  const sources = Object.keys(bySource).sort((a, b) => srcRank(a) - srcRank(b) || a.localeCompare(b));

  html += `<div class="detail-cap">The numbers</div>`;
  sources.forEach((src, si) => {
    const accent = srcColor(src, si);
    html += `<div class="app-title" style="--sc:${accent}"><span class="app-dot"></span>${esc(src)}</div>`;
    html += `<div class="tile-grid">`;
    bySource[src].forEach(x => html += tile(x, accent));
    html += `</div>`;
  });

  document.getElementById('report').innerHTML = html;
}

document.getElementById('printBtn').onclick = () => window.print();
document.getElementById('weekSelect').addEventListener('change', e => loadReport(e.target.value));
loadWeeks();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
