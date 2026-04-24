/* ============================================================
   ngos.js – Pages 3 & 4: NGO Management + Per-NGO Detail
   Uses Leaflet.js + OpenStreetMap + Nominatim (no Google Maps)
   ============================================================ */

const SA = window.SmartAid;
const TILE_URL  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

let ngoMap = null, ngoMarker = null;
let detailMap = null;
let selectedWorkTypes = new Set();
let ngoSearchTimeout = null;

// ── Helpers ───────────────────────────────────────────────────
function makeIcon(color, size = 14) {
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,.8);box-shadow:0 0 8px ${color}88;"></div>`,
    className: '', iconSize: [size, size], iconAnchor: [size/2, size/2],
  });
}

async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
      { headers:{ 'Accept-Language':'en' } }
    );
    const d = await r.json();
    return d.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch { return `${lat.toFixed(5)}, ${lng.toFixed(5)}`; }
}

// ── Nominatim search dropdown ─────────────────────────────────
function setupNominatimSearch(inputId, onSelect) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('input', () => {
    clearTimeout(ngoSearchTimeout);
    ngoSearchTimeout = setTimeout(async () => {
      const q = input.value;
      if (!q || q.length < 3) { document.getElementById('ngo-suggestions')?.remove(); return; }
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`, { headers:{ 'Accept-Language':'en' } });
        const results = await res.json();
        document.getElementById('ngo-suggestions')?.remove();
        if (!results.length) return;
        const dl = document.createElement('div');
        dl.id = 'ngo-suggestions';
        dl.style.cssText = `position:absolute;z-index:9999;background:#151b2d;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:4px 0;margin-top:4px;width:100%;box-shadow:0 8px 24px rgba(0,0,0,.6);`;
        input.parentElement.style.position = 'relative';
        results.forEach(r => {
          const item = document.createElement('div');
          item.style.cssText = 'padding:10px 14px;cursor:pointer;font-size:.85rem;color:#94a3b8;transition:.15s;';
          item.textContent = r.display_name;
          item.addEventListener('mouseover', () => item.style.background = 'rgba(255,255,255,.07)');
          item.addEventListener('mouseout',  () => item.style.background = '');
          item.addEventListener('click', () => {
            input.value = r.display_name;
            onSelect(parseFloat(r.lat), parseFloat(r.lon), r.display_name);
            dl.remove();
          });
          dl.appendChild(item);
        });
        input.parentElement.appendChild(dl);
      } catch {}
    }, 500);
  });
  document.addEventListener('click', e => { if (e.target !== input) document.getElementById('ngo-suggestions')?.remove(); });
}


// =========================================================
// ── PAGE 3: NGO Portal ───────────────────────────────────
// =========================================================

window.switchNgoTab = function (tab) {
  ['list','register','board'].forEach(t => {
    document.getElementById(`ngo-tab-${t}`).style.display = t === tab ? '' : 'none';
  });
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active', ['list','register','board'][i] === tab);
  });
  if (tab === 'register' && !ngoMap) initNgoMap();
  if (tab === 'board') loadBoardView();
};

function initNgoMap() {
  const el = document.getElementById('ngo-map');
  if (!el || ngoMap) return;
  ngoMap = L.map('ngo-map', { attributionControl: true }).setView([20.5937, 78.9629], 5);
  L.tileLayer(TILE_URL, { maxZoom:19, subdomains:'abcd' }).addTo(ngoMap);
  setTimeout(() => ngoMap.invalidateSize(), 100);

  ngoMap.on('click', async (e) => {
    const { lat, lng } = e.latlng;
    placeNgoMarker(lat, lng);
    const addr = await reverseGeocode(lat, lng);
    setNgoFields(lat, lng, addr);
    document.getElementById('n-location').value = addr;
  });

  setupNominatimSearch('n-location', (lat, lng, addr) => {
    placeNgoMarker(lat, lng);
    setNgoFields(lat, lng, addr);
    ngoMap.setView([lat, lng], 13);
  });
}

function placeNgoMarker(lat, lng) {
  if (ngoMarker) ngoMap.removeLayer(ngoMarker);
  ngoMarker = L.marker([lat, lng], { icon: makeIcon('#10b981', 16) }).addTo(ngoMap);
  setNgoFields(lat, lng, null);
}

function setNgoFields(lat, lng, address) {
  document.getElementById('n-lat').value = lat;
  document.getElementById('n-lng').value = lng;
  if (address) {
    document.getElementById('n-address').value = address;
    document.getElementById('ngo-location-text').textContent = address;
    document.getElementById('ngo-location-display').style.display = 'block';
  }
}

// Work type checkboxes
document.querySelectorAll('.wt-check').forEach(el => {
  el.addEventListener('click', () => {
    const t = el.dataset.type;
    selectedWorkTypes.has(t) ? (selectedWorkTypes.delete(t), el.classList.remove('selected'))
                              : (selectedWorkTypes.add(t), el.classList.add('selected'));
  });
});

// NGO Registration form
const ngoForm = document.getElementById('ngo-form');
if (ngoForm) {
  ngoForm.addEventListener('submit', async e => {
    e.preventDefault();
    const name      = document.getElementById('n-name').value.trim();
    const members   = parseInt(document.getElementById('n-members').value, 10);
    const workforce = parseInt(document.getElementById('n-workforce').value, 10);
    const lat       = parseFloat(document.getElementById('n-lat').value);
    const lng       = parseFloat(document.getElementById('n-lng').value);
    const address   = document.getElementById('n-address').value;
    const work_types = [...selectedWorkTypes];

    if (!name)                               { SA.showToast('Enter NGO name.', 'error'); return; }
    if (isNaN(members) || members < 1)       { SA.showToast('Enter total members.', 'error'); return; }
    if (isNaN(workforce) || workforce < 0)   { SA.showToast('Enter available workforce.', 'error'); return; }
    if (isNaN(lat) || isNaN(lng))            { SA.showToast('Pin the NGO location on the map.', 'error'); return; }
    if (!work_types.length)                  { SA.showToast('Select at least one work type.', 'error'); return; }

    const btn = document.getElementById('ngo-submit-btn');
    btn.classList.add('loading');
    btn.querySelector('.btn-text').style.display='none';
    btn.querySelector('.btn-spinner').style.display='inline-block';

    try {
      const { error } = await SA.supabase.from('ngos').insert([{
        name, lat, lng, address: address || null,
        total_members: members, available_workforce: workforce,
        work_types, status: 'available', pct_done: 0.0,
      }]);
      if (error) throw error;
      SA.showToast('NGO registered successfully!', 'success');
      clearNgoForm();
      switchNgoTab('list');
      loadNGOs();
    } catch (err) {
      SA.showToast('Failed: ' + err.message, 'error');
    } finally {
      btn.classList.remove('loading');
      btn.querySelector('.btn-text').style.display='';
      btn.querySelector('.btn-spinner').style.display='none';
    }
  });
}

window.clearNgoForm = function () {
  document.getElementById('ngo-form')?.reset();
  ['n-lat','n-lng','n-address'].forEach(id => { const el = document.getElementById(id); if (el) el.value=''; });
  document.getElementById('ngo-location-display').style.display = 'none';
  document.getElementById('n-location').value = '';
  selectedWorkTypes.clear();
  document.querySelectorAll('.wt-check').forEach(el => el.classList.remove('selected'));
  if (ngoMarker) { ngoMap.removeLayer(ngoMarker); ngoMarker = null; }
};

// Load & render NGO cards
window.loadNGOs = async function () {
  const container = document.getElementById('ngo-cards-container');
  if (!container) return;
  container.innerHTML = `<div class="skeleton" style="height:180px;grid-column:1/-1;"></div>`;
  try {
    const ngos = await SA.fetchNGOs();
    updateNgoStats(ngos);
    if (!ngos.length) {
      container.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🏢</div><p>No NGOs registered yet</p></div>`;
      return;
    }
    container.innerHTML = ngos.map(ngoCard).join('');
  } catch (err) {
    container.innerHTML = `<div style="color:var(--pink);padding:24px;">${err.message}</div>`;
  }
};

function updateNgoStats(ngos) {
  document.getElementById('st-total-ngo')?.setAttribute('data-val', ngos.length);
  document.getElementById('st-total-ngo').textContent  = ngos.length;
  document.getElementById('st-available').textContent  = ngos.filter(n => n.status === 'available').length;
  document.getElementById('st-busy').textContent       = ngos.filter(n => n.status === 'busy').length;
  document.getElementById('st-workforce').textContent  = ngos.reduce((a,n) => a + (n.available_workforce||0), 0);
}

function ngoCard(ngo) {
  const chips = (ngo.work_types||[]).map(t => {
    const p = SA.PROBLEM_TYPES[t]||{emoji:'❓',label:t};
    return `<span class="chip">${p.emoji} ${p.label}</span>`;
  }).join('');
  return `
    <a href="ngo-detail.html?id=${ngo.id}" class="ngo-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
        <div class="ngo-avatar">${ngo.name.charAt(0).toUpperCase()}</div>
        ${SA.statusBadge(ngo.status)}
      </div>
      <div style="font-size:1.1rem;font-weight:700;margin-bottom:6px;">${ngo.name}</div>
      <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:14px;">📍 ${SA.truncate(ngo.address||`${ngo.lat?.toFixed(3)}, ${ngo.lng?.toFixed(3)}`, 40)}</div>
      <div style="display:flex;gap:20px;margin-bottom:14px;">
        <div class="info-block"><div class="info-lbl">Members</div><div class="info-val">${ngo.total_members}</div></div>
        <div class="info-block"><div class="info-lbl">Available</div><div class="info-val" style="color:var(--green);">${ngo.available_workforce}</div></div>
        <div class="info-block"><div class="info-lbl">Progress</div><div class="info-val">${ngo.pct_done||0}%</div></div>
      </div>
      ${ngo.status==='busy'?`<div style="margin-bottom:12px;"><div class="progress-wrap"><div class="progress-bar" style="width:${ngo.pct_done||0}%"></div></div><div style="font-size:.72rem;color:var(--text-muted);margin-top:4px;">${SA.etaDisplay(ngo)}</div></div>`:''}
      <div class="chip-wrap">${chips}</div>
    </a>`;
}

// Assignment board
async function loadBoardView() {
  const tbody = document.getElementById('board-tbody');
  tbody.innerHTML = SA.skeletonRows(8);
  try {
    const ngos = await SA.fetchNGOs();
    const busy = ngos.filter(n => n.status === 'busy' && n.current_problem_id);
    if (!busy.length) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">📋</div><p>No active assignments</p></div></td></tr>`;
      return;
    }
    const { data: problems } = await SA.supabase.from('problems').select('*').in('id', busy.map(n => n.current_problem_id));
    const pMap = Object.fromEntries((problems||[]).map(p => [p.id, p]));
    tbody.innerHTML = busy.map(ngo => {
      const p = pMap[ngo.current_problem_id] || {};
      return `<tr>
        <td><a href="ngo-detail.html?id=${ngo.id}" style="color:var(--cyan);font-weight:600;">${ngo.name}</a></td>
        <td style="font-size:.82rem;">${SA.truncate(p.description,45)}</td>
        <td>${p.type ? SA.typeBadge(p.type) : '—'}</td>
        <td><span class="score ${SA.scoreClass(p.score||0)}">${(p.score||0).toFixed(1)}</span></td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="progress-wrap" style="flex:1;"><div class="progress-bar" style="width:${ngo.pct_done||0}%"></div></div>
            <span style="font-size:.75rem;color:var(--text-muted);">${ngo.pct_done||0}%</span>
          </div>
        </td>
        <td style="font-size:.82rem;">${SA.etaDisplay(ngo)}</td>
        <td>${SA.statusBadge(ngo.status)}</td>
        <td><button class="btn btn-secondary btn-sm" onclick="openUpdateModal('${ngo.id}','${ngo.pct_done||0}')">📝 Update %</button></td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:var(--pink);padding:20px;">${err.message}</td></tr>`;
  }
}

window.openUpdateModal = async function (ngoId, currentPct) {
  const newPct = prompt(`Update work completion % (current: ${currentPct}%):`, currentPct);
  if (newPct === null) return;
  const val = parseFloat(newPct);
  if (isNaN(val) || val < 0 || val > 100) { SA.showToast('Enter 0–100', 'error'); return; }
  try {
    await SA.apiPost(`/api/ngo/${ngoId}/progress`, { pct_done: val });
    SA.showToast('Progress updated!', 'success');
    loadBoardView();
  } catch (err) { SA.showToast(err.message, 'error'); }
};


// =========================================================
// ── PAGE 4: Per-NGO Detail ───────────────────────────────
// =========================================================

function isDetailPage() { return !!document.getElementById('detail-content'); }

async function initDetailPageMap() {
  const el = document.getElementById('ngo-detail-map');
  if (!el || detailMap) return;
  detailMap = L.map('ngo-detail-map', { attributionControl: false }).setView([20.5937, 78.9629], 5);
  L.tileLayer(TILE_URL, { maxZoom:19, subdomains:'abcd' }).addTo(detailMap);
}

window.loadDetail = async function () {
  if (!isDetailPage()) return;
  const id = new URLSearchParams(window.location.search).get('id');
  if (!id) { document.getElementById('detail-loading').innerHTML = '<p style="color:var(--pink)">No NGO ID in URL</p>'; return; }
  try {
    const [ngo, history] = await Promise.all([SA.fetchNGOById(id), SA.fetchAssignmentHistory(id)]);
    renderDetail(ngo, history);
  } catch (err) {
    document.getElementById('detail-loading').innerHTML = `<p style="color:var(--pink)">${err.message}</p>`;
  }
};

function renderDetail(ngo, history) {
  document.getElementById('detail-loading').style.display = 'none';
  document.getElementById('detail-content').style.display = '';
  document.title = `${ngo.name} – SmartAid`;

  document.getElementById('hero-name').textContent    = ngo.name;
  document.getElementById('hero-address').textContent = ngo.address || `${ngo.lat?.toFixed(4)}, ${ngo.lng?.toFixed(4)}`;
  document.getElementById('hero-status').innerHTML    = SA.statusBadge(ngo.status);
  document.getElementById('hero-work-types').innerHTML = (ngo.work_types||[]).map(t => {
    const p = SA.PROBLEM_TYPES[t]||{emoji:'❓',label:t};
    return `<span class="chip">${p.emoji} ${p.label}</span>`;
  }).join('');

  document.getElementById('m-members').textContent   = ngo.total_members;
  document.getElementById('m-workforce').textContent = ngo.available_workforce;
  document.getElementById('m-pct').textContent       = `${ngo.pct_done||0}%`;
  document.getElementById('m-eta').textContent       = SA.etaDisplay(ngo);
  document.getElementById('m-history').textContent   = history.length;

  const wrapper = document.getElementById('current-task-wrapper');
  if (ngo.status === 'busy' && ngo.problems) {
    const p = ngo.problems;
    wrapper.innerHTML = `
      <div class="current-task-card">
        <div class="section-head" style="margin-bottom:20px;">
          <div class="section-title"><div class="icon-box ib-cyan">⚡</div>Currently Working On</div>
          ${SA.typeBadge(p.type)}
        </div>
        <p style="color:var(--text-secondary);font-size:.9rem;margin-bottom:20px;">${p.description}</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px;margin-bottom:20px;">
          <div class="info-block"><div class="info-lbl">Score</div><div class="score sc-high" style="font-size:1.2rem;">${(p.score||0).toFixed(1)}</div></div>
          <div class="info-block"><div class="info-lbl">People Affected</div><div class="info-val">${(p.people_affected||0).toLocaleString()}</div></div>
          <div class="info-block"><div class="info-lbl">Delay</div><div class="info-val">${p.delay_days} days</div></div>
          <div class="info-block"><div class="info-lbl">Location</div><div class="info-val" style="font-size:.8rem;">${SA.truncate(p.address||'—',30)}</div></div>
        </div>
        <div class="info-lbl" style="margin-bottom:8px;">Work Progress – ${ngo.pct_done||0}%</div>
        <div class="progress-wrap"><div class="progress-bar" style="width:${ngo.pct_done||0}%"></div></div>
        <div style="margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <input type="number" id="pct-input" min="0" max="100" value="${ngo.pct_done||0}" style="max-width:90px;">
          <button class="btn btn-primary btn-sm" onclick="updateProgress('${ngo.id}')">Update Progress</button>
          <button class="btn btn-secondary btn-sm" onclick="markResolved('${ngo.id}','${p.id}')">✅ Mark Resolved</button>
        </div>
      </div>`;
    if (detailMap) renderDetailMap(ngo, p);
  } else {
    wrapper.innerHTML = `
      <div class="task-not-assigned">
        <div style="font-size:2rem;margin-bottom:12px;opacity:.4;">✅</div>
        <strong style="color:var(--green);">NGO is currently available</strong>
        <p style="margin-top:8px;font-size:.85rem;">No active assignment. Run AI Analysis to assign a problem.</p>
      </div>`;
    if (detailMap) renderDetailMap(ngo, null);
  }
  renderHistory(history);
}

function renderDetailMap(ngo, problem) {
  if (!detailMap || !ngo.lat) return;
  const bounds = [];

  L.marker([ngo.lat, ngo.lng], { icon: makeIcon('#10b981', 16) })
    .bindPopup(`<b>${ngo.name}</b><br>📍 ${SA.truncate(ngo.address||'', 40)}`).addTo(detailMap);
  bounds.push([ngo.lat, ngo.lng]);

  if (problem?.lat) {
    L.marker([problem.lat, problem.lng], { icon: makeIcon('#ef4444', 14) })
      .bindPopup(`<b>Assigned Problem</b><br>${SA.truncate(problem.description||'', 50)}`).addTo(detailMap);
    bounds.push([problem.lat, problem.lng]);

    L.polyline([[ngo.lat, ngo.lng], [problem.lat, problem.lng]], {
      color: '#00d4ff', weight: 2, opacity: 0.5, dashArray: '6, 6',
    }).addTo(detailMap);
  }
  if (bounds.length > 0) detailMap.fitBounds(bounds, { padding: [60, 60] });
  else detailMap.setView([ngo.lat, ngo.lng], 12);
}

function renderHistory(history) {
  const el = document.getElementById('history-timeline');
  if (!history.length) { el.innerHTML = `<div class="empty-state"><div class="empty-icon">📜</div><p>No past assignments</p></div>`; return; }
  el.innerHTML = history.map(a => {
    const p = a.problems || {};
    return `
      <div class="tl-item ${a.status==='completed'?'completed':a.status==='interrupted'?'interrupted':''}">
        <div class="tl-date">${new Date(a.started_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</div>
        <div style="font-size:.9rem;font-weight:600;margin-bottom:4px;">${p.type ? SA.typeBadge(p.type) : '—'}</div>
        <div style="font-size:.82rem;color:var(--text-secondary);">${SA.truncate(p.description||'—',70)}</div>
        <div style="display:flex;gap:12px;margin-top:6px;">
          ${SA.problemStatusBadge(a.status)}
          ${a.pct_done_at_interrupt!=null?`<span style="font-size:.75rem;color:var(--text-muted);">Done: ${a.pct_done_at_interrupt}%</span>`:''}
          ${a.preemption_reason?`<span style="font-size:.75rem;color:var(--amber);">${a.preemption_reason}</span>`:''}
        </div>
      </div>`;
  }).join('');
}

window.updateProgress = async function (ngoId) {
  const val = parseFloat(document.getElementById('pct-input').value);
  if (isNaN(val)||val<0||val>100) { SA.showToast('Enter 0–100', 'error'); return; }
  try { await SA.apiPost(`/api/ngo/${ngoId}/progress`, { pct_done: val }); SA.showToast('Updated!', 'success'); loadDetail(); }
  catch (err) { SA.showToast(err.message, 'error'); }
};

window.markResolved = async function (ngoId, problemId) {
  if (!confirm('Mark problem as resolved and free the NGO?')) return;
  try { await SA.apiPost(`/api/ngo/${ngoId}/resolve`, { problem_id: problemId }); SA.showToast('Resolved!', 'success'); loadDetail(); }
  catch (err) { SA.showToast(err.message, 'error'); }
};

// ── Bootstrap ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (isDetailPage()) {
    await initDetailPageMap();
    loadDetail();
  } else {
    loadNGOs();
    setInterval(loadNGOs, 30000);
  }
});
