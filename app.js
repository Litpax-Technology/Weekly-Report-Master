'use strict';

const state = { week: null };

/* ---------- source colours (naya app add hote hi apne aap rang mil jayega) ---------- */
const SOURCE_ORDER = ['ERP', 'IMS', 'Service', 'Repair', 'Courier', 'SOMS'];
const SOURCE_COLORS = {
  ERP:     { c: '#635bff', bg: '#eef0ff' },
  IMS:     { c: '#0d9488', bg: '#e6fbf7' },
  Service: { c: '#ea580c', bg: '#fff1e8' },
  Repair:  { c: '#9333ea', bg: '#f6ecfe' },
  Courier: { c: '#0284c7', bg: '#e6f5fe' },
  SOMS:    { c: '#c026d3', bg: '#fdebff' }
};
const FALLBACK = [{ c: '#2563eb', bg: '#eaf1ff' }, { c: '#16a34a', bg: '#eafbf0' },
                  { c: '#d97706', bg: '#fff6e6' }, { c: '#db2777', bg: '#fdeef6' }];
function sourceMeta(src, idx) { return SOURCE_COLORS[src] || FALLBACK[idx % FALLBACK.length]; }
function srcRank(s) { const i = SOURCE_ORDER.indexOf(s); return i === -1 ? 99 : i; }

/* ---------- JSONP with timeout ---------- */
function api(action, params = {}) {
  return new Promise((resolve, reject) => {
    const cb = 'jp_' + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    const timer = setTimeout(() => { cleanup(); reject(new Error('Network timeout — check connection')); }, 30000);
    function cleanup() { clearTimeout(timer); delete window[cb]; s.remove(); }
    window[cb] = (res) => { cleanup(); resolve(res); };
    const qs = Object.keys(params)
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
    s.src = CONFIG.API_URL + '?action=' + action + '&callback=' + cb + (qs ? '&' + qs : '');
    s.onerror = () => { cleanup(); reject(new Error('Network error')); };
    document.body.appendChild(s);
  });
}

/* ---------- Toast ---------- */
function toast(msg, ok = true) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show ' + (ok ? 'ok' : 'bad');
  setTimeout(() => t.className = 'toast', 2800);
}

/* ---------- Helpers ---------- */
function fmtNum(v, label) {
  const n = Number(v);
  if (v === '' || v == null || isNaN(n)) return String(v == null ? '—' : v);
  const s = n.toLocaleString('en-IN');
  return (label && /₹/.test(label)) ? '₹' + s : s;
}
function fmtWeekLabel(start, end) {
  const d = s => { const p = String(s).split('-'); return p.length === 3 ? p[2] + '/' + p[1] : s; };
  return d(start) + ' – ' + d(end);
}
function sev(status) {
  if (['ZERO', 'CRITICAL', 'DROP', 'SPIKE', 'PILEUP'].indexOf(status) !== -1) return 'red';
  if (status === 'WATCH') return 'amber';
  if (status === 'UP_GOOD') return 'green';
  if (status === 'ERROR') return 'grey';
  return 'normal';
}
function statusText(status) {
  return { ZERO: 'Stopped', CRITICAL: 'Critical', DROP: 'Down', SPIKE: 'High',
           PILEUP: 'Piling up', WATCH: 'Watch', UP_GOOD: 'Up', ERROR: 'Error',
           NORMAL: 'Normal' }[status] || status;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function baseNote(x) {
  if (x.Baseline === '' || x.Baseline == null) return 'no baseline yet';
  return 'normal ~ ' + fmtNum(x.Baseline, x.Label);
}
function rank(status) {
  const order = { CRITICAL: 0, ZERO: 1, PILEUP: 2, DROP: 3, SPIKE: 4, WATCH: 5, ERROR: 9 };
  return order[status] !== undefined ? order[status] : 6;
}
function emptyState(title, sub) {
  return `<div class="all-clear" style="background:#fff;border-color:var(--border);color:var(--text)">
    <div><b>${esc(title)}</b><div class="muted" style="margin-top:4px">${sub}</div></div></div>`;
}
function isFlagged(x) { const b = sev(x.Status); return b === 'red' || b === 'amber' || b === 'grey'; }

/* ---------- Weeks dropdown ---------- */
async function loadWeeks(selectStart) {
  try {
    const r = await api('getWeeks');
    const sel = document.getElementById('weekSelect');
    if (!r.ok || !r.weeks.length) {
      sel.innerHTML = '<option>No weeks yet</option>';
      document.getElementById('report').innerHTML =
        emptyState('No report generated yet.',
          'Run <b>backfillWeeks</b> once in the Apps Script editor to create the first snapshot.');
      return;
    }
    sel.innerHTML = r.weeks.map(w =>
      `<option value="${w.start}">Week of ${fmtWeekLabel(w.start, w.end)}</option>`).join('');
    const pick = selectStart && r.weeks.some(w => w.start === selectStart) ? selectStart : r.weeks[0].start;
    sel.value = pick;
    await loadReport(pick);
  } catch (e) {
    document.getElementById('report').innerHTML = emptyState('Could not connect', e.message);
  }
}

/* ---------- Report ---------- */
async function loadReport(week) {
  state.week = week;
  const rep = document.getElementById('report');
  rep.innerHTML = '<div class="skeleton"></div>'.repeat(4);
  try {
    const r = await api('getReport', { week });
    if (!r.ok) return toast(r.message || 'Load failed', false);
    renderReport(r);
  } catch (e) { rep.innerHTML = emptyState('Could not load', e.message); }
}

function metricCard(x) {
  const bucket = sev(x.Status);
  const flag = bucket === 'red' ? 'flag-red' : bucket === 'amber' ? 'flag-amber' : bucket === 'green' ? 'flag-green' : '';
  const dev = x.DeviationPct;
  let arrow = '';
  if (dev !== '' && dev != null && !isNaN(Number(dev)) && Number(dev) !== 0) {
    const up = Number(dev) > 0;
    arrow = `<span class="m-arrow ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(Number(dev))}%</span>`;
  }
  const pill = (bucket === 'red' || bucket === 'amber')
    ? `<span class="pill ${bucket}">${statusText(x.Status)}</span>` : '';
  return `<div class="metric ${flag}">
    <div class="m-label">${esc(x.Label)}${pill}</div>
    <div class="m-main"><span class="m-val">${fmtNum(x.Value, x.Label)}</span>${arrow}</div>
    <div class="m-base">${baseNote(x)}</div>
  </div>`;
}

function renderReport(r) {
  const rows = r.rows || [];
  document.getElementById('weekHeader').innerHTML =
    `<h2>Week of ${fmtWeekLabel(r.week, r.weekEnd)}</h2>` +
    `<div class="gen muted">Sunday to Saturday${r.generatedAt ? ' · generated ' + r.generatedAt : ''}</div>`;

  if (!rows.length) {
    document.getElementById('report').innerHTML =
      emptyState('No data for this week.', 'This week has not been generated yet.');
    return;
  }

  let html = '';

  /* ---- Layer 1: attention band (cross-app, severity sorted) ---- */
  const attn = rows.filter(isFlagged).sort((a, b) => rank(a.Status) - rank(b.Status));
  html += `<div class="section-title attn"><span class="dot"></span>Needs Attention This Week</div>`;
  if (!attn.length) {
    html += `<div class="all-clear">✓ All clear — nothing abnormal across the tracked areas this week.</div>`;
  } else {
    html += '<div class="attn-grid">';
    attn.forEach(x => {
      const bucket = sev(x.Status);
      html += `<div class="attn-card ${bucket}">
        <div class="ac-top">
          <div>
            <div class="ac-label">${esc(x.Label)}</div>
            <div class="ac-dept">${esc(x.Source)} · ${esc(x.Department)}</div>
          </div>
          <span class="pill ${bucket === 'grey' ? 'grey' : bucket}">${statusText(x.Status)}</span>
        </div>
        <div class="ac-val">${fmtNum(x.Value, x.Label)}</div>
        <div class="ac-note">${esc(x.Note || baseNote(x))}</div>
      </div>`;
    });
    html += '</div>';
  }

  /* ---- Layer 2: ek panel per app (ERP / IMS / Service ...) ---- */
  const bySource = {};
  rows.forEach(x => (bySource[x.Source || 'Other'] = bySource[x.Source || 'Other'] || []).push(x));
  const sources = Object.keys(bySource).sort((a, b) => srcRank(a) - srcRank(b) || a.localeCompare(b));

  sources.forEach((src, si) => {
    const meta = sourceMeta(src, si);
    const list = bySource[src];
    const flagged = list.filter(isFlagged).length;
    const countTxt = flagged ? flagged + ' need attention' : 'all normal';

    html += `<div class="src-panel" style="--sc:${meta.c};--sbg:${meta.bg}">
      <div class="src-head">
        <span class="src-badge">${esc(src.charAt(0))}</span>
        <span class="src-name">${esc(src)}</span>
        <span class="src-count ${flagged ? 'has' : ''}">${countTxt}</span>
      </div>`;

    const byDept = {};
    list.forEach(x => (byDept[x.Department || ''] = byDept[x.Department || ''] || []).push(x));
    const depts = Object.keys(byDept);
    const multi = depts.length > 1;

    depts.forEach(dep => {
      if (multi && dep) html += `<div class="dept-label">${esc(dep)}</div>`;
      html += `<div class="dept-rows">`;
      byDept[dep].forEach(x => html += metricCard(x));
      html += `</div>`;
    });

    html += `</div>`;
  });

  document.getElementById('report').innerHTML = html;
}

/* ---------- Wire up ---------- */
document.getElementById('printBtn').onclick = () => window.print();
document.getElementById('weekSelect').addEventListener('change', e => loadReport(e.target.value));

/* ---------- Start ---------- */
loadWeeks();

/* ---------- PWA ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
