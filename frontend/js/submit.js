/* ============================================================
   submit.js – Page 1: Problem Submission Logic
   Uses Leaflet.js + OpenStreetMap + Nominatim (100% free)
   ============================================================ */

// Use SA alias to avoid re-declaring identifiers already in global scope from app.js
const SA = window.SmartAid;

// ── Dark CartoDB tile layer ───────────────────────────────────
const TILE_URL  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

let submitMap = null;
let submitMarker = null;
let searchTimeout = null;

// ── Init Leaflet Map ──────────────────────────────────────────
function initMap() {
  const container = document.getElementById('submit-map');
  if (!container) return;

  submitMap = L.map('submit-map', { zoomControl: true, attributionControl: true }).setView([20.5937, 78.9629], 5);

  L.tileLayer(TILE_URL, {
    attribution: TILE_ATTR, maxZoom: 19, subdomains: 'abcd',
  }).addTo(submitMap);

  // Must call after CSS has settled to ensure Leaflet measures the container correctly
  setTimeout(() => submitMap.invalidateSize(), 100);

  submitMap.on('click', async (e) => {
    const { lat, lng } = e.latlng;
    placeMarker(lat, lng);
    const addr = await reverseGeocode(lat, lng);
    setLocationFields(lat, lng, addr);
  });

  // Wire up search input
  const searchEl = document.getElementById('f-location');
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => doSearch(searchEl.value), 500);
  });
}

// ── Nominatim Search ──────────────────────────────────────────
async function doSearch(query) {
  if (!query || query.length < 3) { closeSuggestions(); return; }
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const results = await res.json();
    showSuggestions(results);
  } catch { closeSuggestions(); }
}

function showSuggestions(results) {
  closeSuggestions();
  if (!results.length) return;
  const container = document.getElementById('f-location').parentElement;
  const dl = document.createElement('div');
  dl.id = 'location-suggestions';
  dl.style.cssText = `position:absolute;z-index:9999;background:#151b2d;border:1px solid rgba(255,255,255,.12);
    border-radius:8px;padding:4px 0;margin-top:4px;width:100%;box-shadow:0 8px 24px rgba(0,0,0,.6);`;
  container.style.position = 'relative';
  results.forEach(r => {
    const item = document.createElement('div');
    item.style.cssText = 'padding:10px 14px;cursor:pointer;font-size:.85rem;color:#94a3b8;transition:.15s;';
    item.textContent = r.display_name;
    item.addEventListener('mouseover', () => item.style.background = 'rgba(255,255,255,.07)');
    item.addEventListener('mouseout',  () => item.style.background = '');
    item.addEventListener('click', () => {
      const lat = parseFloat(r.lat), lng = parseFloat(r.lon);
      placeMarker(lat, lng);
      setLocationFields(lat, lng, r.display_name);
      document.getElementById('f-location').value = r.display_name;
      submitMap.setView([lat, lng], 13);
      closeSuggestions();
    });
    dl.appendChild(item);
  });
  container.appendChild(dl);
}

function closeSuggestions() {
  document.getElementById('location-suggestions')?.remove();
}

document.addEventListener('click', e => {
  if (!e.target.closest('#f-location')?.parentElement) closeSuggestions();
});

// ── Reverse Geocode (Nominatim) ───────────────────────────────
async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const d = await r.json();
    return d.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch { return `${lat.toFixed(5)}, ${lng.toFixed(5)}`; }
}

// ── Marker helpers ────────────────────────────────────────────
function placeMarker(lat, lng) {
  if (submitMarker) submitMap.removeLayer(submitMarker);
  const icon = L.divIcon({
    html: `<div style="width:18px;height:18px;border-radius:50%;background:#00d4ff;border:2px solid #fff;box-shadow:0 0 10px rgba(0,212,255,.6);"></div>`,
    className: '', iconSize: [18, 18], iconAnchor: [9, 9],
  });
  submitMarker = L.marker([lat, lng], { icon }).addTo(submitMap);
  setLocationFields(lat, lng, null);
}

function setLocationFields(lat, lng, address) {
  document.getElementById('f-lat').value = lat;
  document.getElementById('f-lng').value = lng;
  if (address) {
    document.getElementById('f-address').value = address;
    document.getElementById('location-text').textContent = address;
    document.getElementById('location-display').style.display = 'block';
  }
}

// ── Form Submit ───────────────────────────────────────────────
document.getElementById('problem-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const type            = document.getElementById('f-type').value;
  const description     = document.getElementById('f-desc').value.trim();
  const delay_days      = parseInt(document.getElementById('f-delay').value, 10);
  const people_affected = parseInt(document.getElementById('f-people').value, 10);
  const lat             = parseFloat(document.getElementById('f-lat').value);
  const lng             = parseFloat(document.getElementById('f-lng').value);
  const address         = document.getElementById('f-address').value;

  const errEl = document.getElementById('form-error');
  errEl.style.display = 'none';

  if (!type)                                   { showErr('Please select a problem type.'); return; }
  if (!description)                            { showErr('Please describe the problem.'); return; }
  if (isNaN(delay_days) || delay_days < 0)     { showErr('Enter valid days since problem started.'); return; }
  if (isNaN(people_affected) || people_affected < 1) { showErr('Enter how many people are affected.'); return; }
  if (isNaN(lat) || isNaN(lng))                { showErr('Pin the location on the map.'); return; }

  setBtnLoading(true);
  try {
    const { data, error } = await SA.supabase.from('problems').insert([{
      type, description, delay_days, people_affected,
      lat, lng, address: address || null,
      status: 'open', flag: false, score: null, cluster_count: 0,
    }]).select().single();
    if (error) throw error;
    SA.showToast('Problem reported successfully!', 'success');
    clearForm();
    loadRecentProblems();
  } catch (err) {
    SA.showToast('Failed: ' + err.message, 'error');
  } finally {
    setBtnLoading(false);
  }
});

function showErr(msg) {
  const el = document.getElementById('form-error');
  el.textContent = msg; el.style.display = 'block';
}

function setBtnLoading(on) {
  const btn = document.getElementById('submit-btn');
  btn.classList.toggle('loading', on);
  btn.querySelector('.btn-text').style.display = on ? 'none' : '';
  btn.querySelector('.btn-spinner').style.display = on ? 'inline-block' : 'none';
}

window.clearForm = function () {
  document.getElementById('problem-form').reset();
  ['f-lat','f-lng','f-address'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('location-display').style.display = 'none';
  document.getElementById('f-location').value = '';
  if (submitMarker) { submitMap.removeLayer(submitMarker); submitMarker = null; }
};

// ── Recent Problems Table ─────────────────────────────────────
async function loadRecentProblems() {
  const tbody = document.getElementById('recent-tbody');
  tbody.innerHTML = SA.skeletonRows(7);
  try {
    const problems = await SA.fetchProblems(25);
    if (!problems.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📭</div><p>No problems reported yet</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = problems.map(p => `
      <tr class="${p.flag ? 'flagged' : ''}">
        <td>${SA.typeBadge(p.type)}</td>
        <td style="font-size:.85rem;">
          ${p.flag ? '<span class="badge b-flag" style="margin-right:4px;">🚩 FLAGGED</span>' : ''}
          ${SA.truncate(p.description, 55)}
        </td>
        <td style="font-size:.82rem;color:var(--text-secondary);">${p.address ? SA.truncate(p.address, 35) : `${p.lat?.toFixed(4)}, ${p.lng?.toFixed(4)}`}</td>
        <td style="text-align:center;">${p.delay_days}</td>
        <td style="text-align:center;">${p.people_affected?.toLocaleString()}</td>
        <td>${SA.problemStatusBadge(p.status)}</td>
        <td style="font-size:.8rem;color:var(--text-muted);">${SA.timeAgo(p.created_at)}</td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--pink);padding:20px;">${err.message}</td></tr>`;
  }
}

// ── Bootstrap ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  loadRecentProblems();
  setInterval(loadRecentProblems, 30000);
});
