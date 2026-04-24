/* ============================================================
   dashboard.js – Page 2: Analysis Dashboard
   Uses Leaflet.js + OpenStreetMap (no Google Maps)
   ============================================================ */

const SA = window.SmartAid;
const TILE_URL  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

let dashMap = null;
let dashLayers = [];
let lastAnalysis = null;
let activeTab = 'type';

// ── Tab Switching ─────────────────────────────────────────────
window.switchTab = function (tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active', ['type','geo','assignments','map'][i] === tab);
  });
  ['tab-type','tab-geo','tab-assignments','tab-map'].forEach(id => {
    document.getElementById(id).style.display = (id === `tab-${tab}`) ? '' : 'none';
  });
  // Initialise map when tab shown for first time
  if (tab === 'map') {
    if (!dashMap) initDashboardMap();
    else { dashMap.invalidateSize(); if (lastAnalysis) updateMapMarkers(lastAnalysis); }
  }
};

// ── Run Analysis ──────────────────────────────────────────────
window.runAnalysis = async function () {
  const btn = document.getElementById('run-btn');
  btn.querySelector('.btn-text').style.display = 'none';
  btn.querySelector('.btn-spinner').style.display = 'inline-block';
  btn.classList.add('loading');
  try {
    const data = await SA.apiGet('/api/analyze');
    lastAnalysis = data;
    renderAnalysis(data);
    document.getElementById('last-run').textContent = new Date().toLocaleTimeString();
    SA.showToast('AI analysis complete!', 'success');
  } catch (err) {
    SA.showToast('Analysis failed: ' + err.message, 'error');
  } finally {
    btn.querySelector('.btn-text').style.display = '';
    btn.querySelector('.btn-spinner').style.display = 'none';
    btn.classList.remove('loading');
  }
};

// ── Load Stats from Supabase ──────────────────────────────────
window.loadDashboard = async function () {
  try {
    const [problems, ngos, assignments] = await Promise.all([
      SA.fetchProblems(200), 
      SA.fetchNGOs(),
      SA.apiGet('/api/assignments')
    ]);
    document.getElementById('st-total').textContent    = problems.length;
    document.getElementById('st-flagged').textContent  = problems.filter(p => p.flag).length;
    document.getElementById('st-ngos').textContent     = ngos.length;
    document.getElementById('st-assigned').textContent = problems.filter(p => p.status === 'assigned').length;
    const ids = [...new Set(problems.map(p => p.geo_cluster).filter(c => c != null && c >= 0))];
    document.getElementById('st-clusters').textContent = ids.length;

    // Always render assignments from DB
    renderAssignments(assignments);
  } catch (err) { console.error(err); }
};

// ── Render full analysis result ───────────────────────────────
function renderAnalysis(data) {
  // We don't overwrite stats here, we let loadDashboard do it.
  
  if (data.priority_problem) {
    renderPriorityCard(data.priority_problem);
    document.getElementById('priority-section').style.display = '';
  }

  const preempted = (data.assignments || []).filter(a => a.preempted);
  if (preempted.length) {
    document.getElementById('preemption-section').style.display = '';
    document.getElementById('preemption-text').innerHTML = preempted.map(a =>
      `<div>🤖 <strong>${a.ngo_name}</strong> was <span style="color:var(--amber)">preempted</span> to handle 
      "<em>${SA.truncate(a.problem_description, 50)}</em>" 
      (score: <span class="score sc-high">${a.match_score.toFixed(1)}</span>). 
      <span style="color:var(--text-muted)">Reason: ${a.preemption_reason || 'Higher priority problem'}</span></div>`
    ).join('<div class="divider" style="margin:10px 0;"></div>');
  }

  renderTypeClusters(data.type_clusters);
  renderGeoClusters(data.geo_semantic_clusters);
  
  // Refresh the full assignments table from DB, then map markers
  loadDashboard().then(() => {
    if (dashMap) updateMapMarkers(data);
  });
}

// ── Priority Card ─────────────────────────────────────────────
function renderPriorityCard(p) {
  document.getElementById('priority-content').innerHTML = `
    <div>
      <div class="info-lbl" style="margin-bottom:8px;">Problem</div>
      ${SA.typeBadge(p.type)}
      <div style="font-size:1.1rem;font-weight:700;margin-top:12px;margin-bottom:8px;">${SA.truncate(p.description, 80)}</div>
      ${p.flag ? '<span class="badge b-flag">🚩 FLAGGED (in ≥2 clusters)</span>' : ''}
    </div>
    <div>
      <div class="info-block" style="margin-bottom:12px;"><div class="info-lbl">Score</div><div class="score sc-high" style="font-size:1.5rem;">${p.score.toFixed(1)}</div></div>
      <div class="info-block" style="margin-bottom:12px;"><div class="info-lbl">People Affected</div><div class="info-val">${p.people_affected.toLocaleString()}</div></div>
      <div class="info-block"><div class="info-lbl">Days Delayed</div><div class="info-val">${p.delay_days} days</div></div>
    </div>
    <div>
      <div class="info-block" style="margin-bottom:12px;"><div class="info-lbl">Location</div><div class="info-val" style="font-size:.85rem;">${p.address || `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`}</div></div>
      <div class="info-block" style="margin-bottom:12px;"><div class="info-lbl">Assigned NGO</div><div class="info-val">${p.assigned_ngo_name || '<span style="color:var(--amber)">Pending</span>'}</div></div>
      <div class="info-block"><div class="info-lbl">Clusters Found In</div><div class="info-val">${p.cluster_count}</div></div>
    </div>`;
}

// ── Type Clusters ─────────────────────────────────────────────
function renderTypeClusters(items) {
  const container = document.getElementById('type-cluster-container');
  if (!items?.length) { container.innerHTML = `<div class="empty-state"><div class="empty-icon">📂</div><p>No problems to cluster yet</p></div>`; return; }

  const groups = {};
  items.forEach(p => { if (!groups[p.type]) groups[p.type] = []; groups[p.type].push(p); });
  const sortedTypes = Object.keys(groups).sort((a,b) => (SA.PROBLEM_TYPES[a]?.priority||9) - (SA.PROBLEM_TYPES[b]?.priority||9));
  const bColors = ['#ef4444','#f97316','#eab308','#a78bfa','#60a5fa','#34d399','#818cf8','#6b7280'];

  container.innerHTML = sortedTypes.map(type => {
    const ps = groups[type];
    const t = SA.PROBLEM_TYPES[type] || { emoji:'❓', label:type };
    const color = bColors[(SA.PROBLEM_TYPES[type]?.priority||9) - 1] || '#6b7280';
    return `
      <div class="type-group">
        <div class="type-group-header" style="border-left-color:${color};">
          <span style="font-size:1.2rem;">${t.emoji}</span>
          <strong>${t.label}</strong>
          <span class="badge" style="background:rgba(255,255,255,.07);color:var(--text-secondary);">${ps.length} problem${ps.length > 1?'s':''}</span>
          <span style="margin-left:auto;font-size:.75rem;color:var(--text-muted);">Priority ${SA.PROBLEM_TYPES[type]?.priority||'?'}</span>
        </div>
        <div class="tbl-wrap">
          <table class="data-tbl">
            <thead><tr><th>Description</th><th>Verified Type</th><th>Score</th><th>People</th><th>Delay</th><th>Flag</th><th>Status</th></tr></thead>
            <tbody>${ps.map(p => `<tr class="${p.flag?'flagged':''}">
              <td style="max-width:280px;font-size:.82rem;">${SA.truncate(p.description,60)}</td>
              <td>${p.verified_type && p.verified_type !== p.type
                ? `${SA.typeBadge(p.verified_type)} <span style="font-size:.7rem;color:var(--amber);">↑ corrected</span>`
                : SA.typeBadge(p.type)}
                ${p.type_confidence!=null?`<div class="confidence-bar" style="width:80px;margin-top:4px;"><div class="confidence-fill" style="width:${(p.type_confidence*100).toFixed(0)}%"></div></div>`:''}</td>
              <td><span class="score ${SA.scoreClass(p.score)}">${p.score.toFixed(1)}</span></td>
              <td>${p.people_affected.toLocaleString()}</td>
              <td>${p.delay_days}d</td>
              <td>${p.flag?'<span class="badge b-flag">🚩</span>':'—'}</td>
              <td>${SA.problemStatusBadge(p.status)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`;
  }).join('');
}

// ── Geo Clusters ──────────────────────────────────────────────
function renderGeoClusters(items) {
  const container = document.getElementById('geo-cluster-container');
  if (!items?.length) { container.innerHTML = `<div class="empty-state"><div class="empty-icon">📍</div><p>No geo clusters yet</p></div>`; return; }

  const groups = {};
  items.forEach(p => { const c = p.cluster_id; if (!groups[c]) groups[c] = []; groups[c].push(p); });

  container.innerHTML = Object.keys(groups).sort((a,b)=>Number(a)-Number(b)).map(cid => {
    const ps = groups[cid];
    const color = SA.clusterColor(Number(cid));
    const label = cid == -1 ? 'Noise (Unclustered)' : `Cluster ${Number(cid)+1}`;
    const maxScore = Math.max(...ps.map(p => p.score));
    return `
      <div class="geo-cluster-wrap">
        <div class="geo-cluster-header" style="background:${color}22;border-left:3px solid ${color};">
          <div class="c-dot" style="background:${color};color:#000;">${Number(cid)+1}</div>
          <strong style="color:${color};">${label}</strong>
          <span class="badge" style="background:rgba(255,255,255,.07);color:var(--text-secondary);">${ps.length} problems</span>
          <span style="font-size:.75rem;color:var(--text-muted);margin-left:auto;">Max score: <span class="score sc-high">${maxScore.toFixed(1)}</span></span>
        </div>
        <div class="tbl-wrap">
          <table class="data-tbl">
            <thead><tr><th>Type</th><th>Description</th><th>Score</th><th>Location</th><th>People</th><th>Flag</th></tr></thead>
            <tbody>${ps.sort((a,b)=>b.score-a.score).map(p=>`<tr class="${p.flag?'flagged':''}">
              <td>${SA.typeBadge(p.type)}</td>
              <td style="font-size:.82rem;max-width:280px;">${SA.truncate(p.description,55)}</td>
              <td><span class="score ${SA.scoreClass(p.score)}">${p.score.toFixed(1)}</span></td>
              <td style="font-size:.78rem;color:var(--text-secondary);">${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</td>
              <td>${p.people_affected.toLocaleString()}</td>
              <td>${p.flag?'<span class="badge b-flag">🚩</span>':'—'}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`;
  }).join('');
}

// ── Assignments ───────────────────────────────────────────────
function renderAssignments(assignments) {
  const tbody = document.getElementById('assignments-tbody');
  if (!assignments?.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">🏢</div><p>Run AI Analysis to see assignments</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = assignments.map(a => `
    <tr>
      <td><a href="ngo-detail.html?id=${a.ngo_id}" style="color:var(--cyan);font-weight:600;">${a.ngo_name}</a></td>
      <td style="font-size:.82rem;max-width:240px;">${SA.truncate(a.problem_description,50)}</td>
      <td>${SA.typeBadge(a.problem_type)}</td>
      <td><span class="score ${SA.scoreClass(a.match_score)}">${a.match_score.toFixed(2)}</span></td>
      <td style="font-size:.85rem;">${a.distance_km.toFixed(1)} km</td>
      <td style="font-size:.85rem;">${a.eta_days.toFixed(1)} days</td>
      <td>${a.preempted?'<span class="badge b-flag">⚡ Preempted</span>':'<span style="color:var(--text-muted);font-size:.8rem;">—</span>'}</td>
      <td>${SA.statusBadge(a.ngo_status)}</td>
    </tr>`).join('');
}

// ── Leaflet Map ───────────────────────────────────────────────
function initDashboardMap() {
  const el = document.getElementById('assignments-map');
  if (!el || dashMap) return;
  dashMap = L.map('assignments-map', { attributionControl: false }).setView([20.5937, 78.9629], 5);
  L.tileLayer(TILE_URL, { maxZoom: 19, subdomains: 'abcd' }).addTo(dashMap);
  L.control.attribution({ prefix: '' }).addAttributeTo = () => {};
  if (lastAnalysis) updateMapMarkers(lastAnalysis);
}

function makeIcon(color, size = 12) {
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,.7);box-shadow:0 0 8px ${color}88;"></div>`,
    className: '', iconSize: [size, size], iconAnchor: [size/2, size/2],
  });
}

function updateMapMarkers(data) {
  if (!dashMap) return;
  dashLayers.forEach(l => dashMap.removeLayer(l));
  dashLayers = [];
  const bounds = [];

  const allProblems = [...(data.type_clusters || []), ...(data.geo_semantic_clusters || [])];
  const seen = new Set();
  allProblems.forEach(p => {
    if (!p.lat || !p.lng || seen.has(p.problem_id)) return;
    seen.add(p.problem_id);
    const color = p.flag ? '#ef4444' : p.status === 'assigned' ? '#10b981' : '#f59e0b';
    const marker = L.marker([p.lat, p.lng], { icon: makeIcon(color) })
      .bindPopup(`<b>${SA.PROBLEM_TYPES[p.type]?.label || p.type}</b><br>${SA.truncate(p.description, 60)}<br>Score: ${p.score?.toFixed(1)}`);
    marker.addTo(dashMap);
    dashLayers.push(marker);
    bounds.push([p.lat, p.lng]);
  });

  if (bounds.length) dashMap.fitBounds(bounds, { padding: [50, 50] });
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
  setInterval(loadDashboard, 60000);
});
