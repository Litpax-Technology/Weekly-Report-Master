'use strict';

const state = { week: null };

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

  const attn = rows.filter(x => ['red', 'amber', 'grey'].indexOf(sev(x.Status)) !== -1)
    .sort((a, b) => rank(a.Status) - rank(b.Status));

  let html = '';
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

  const depts = {};
  rows.forEach(x => { (depts[x.Department] = depts[x.Department] || []).push(x); });
  Object.keys(depts).forEach(dep => {
    html += `<div class="section-title"><span class="dot"></span>${esc(dep)}</div>`;
    html += `<div class="dept-block"><div class="dept-rows">`;
    depts[dep].forEach(x => {
      const bucket = sev(x.Status);
      const flag = bucket === 'red' ? 'flag-red' : bucket === 'amber' ? 'flag-amber' : bucket === 'green' ? 'flag-green' : '';
      const dev = x.DeviationPct;
      let arrow = '';
      if (dev !== '' && dev != null && !isNaN(Number(dev)) && Number(dev) !== 0) {
        const up = Number(dev) > 0;
        arrow = `<span class="m-arrow ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(Number(dev))}%</span>`;
      }
      html += `<div class="metric ${flag}">
        <div class="m-label">${esc(x.Label)}</div>
        <div class="m-main"><span class="m-val">${fmtNum(x.Value, x.Label)}</span>${arrow}</div>
        <div class="m-base">${baseNote(x)}</div>
      </div>`;
    });
    html += `</div></div>`;
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
