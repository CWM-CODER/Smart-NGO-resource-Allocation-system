/* ============================================================
   SmartAid – Shared Application Utilities
   ============================================================ */

// ── Config (replace with your real keys) ──────────────────────
const CONFIG = {
  SUPABASE_URL:  window.SUPABASE_URL  || 'YOUR_SUPABASE_URL',
  SUPABASE_KEY:  window.SUPABASE_KEY  || 'YOUR_SUPABASE_ANON_KEY',
  BACKEND_URL:   window.BACKEND_URL   || 'http://127.0.0.1:8000',
};

// ── Supabase Client ───────────────────────────────────────────
// Use _supabase (not 'supabase') so page scripts can
// destructure window.SmartAid.supabase without name collision
const _supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

// ── Problem Types Map ─────────────────────────────────────────
const PROBLEM_TYPES = {
  death_casualty: { label:'Death / Mass Casualty',   emoji:'🔴', weight:100, badgeClass:'bp1', priority:1 },
  pandemic:       { label:'Pandemic / Disease',       emoji:'🟠', weight:90,  badgeClass:'bp2', priority:2 },
  flood_disaster: { label:'Flood / Natural Disaster', emoji:'🟡', weight:80,  badgeClass:'bp3', priority:3 },
  shelter:        { label:'Shelter / Housing Crisis', emoji:'🟤', weight:70,  badgeClass:'bp4', priority:4 },
  food_water:     { label:'Food / Water Scarcity',    emoji:'🍽️', weight:60,  badgeClass:'bp5', priority:5 },
  medical:        { label:'Medical / Health',         emoji:'🏥', weight:50,  badgeClass:'bp6', priority:6 },
  education:      { label:'Education Disruption',     emoji:'📚', weight:40,  badgeClass:'bp7', priority:7 },
  infrastructure: { label:'Infrastructure Damage',    emoji:'🔧', weight:30,  badgeClass:'bp8', priority:8 },
};

const WORK_TYPE_LABELS = {
  death_casualty:'Death/Casualty', pandemic:'Pandemic',
  flood_disaster:'Flood/Disaster', shelter:'Shelter',
  food_water:'Food/Water',         medical:'Medical',
  education:'Education',           infrastructure:'Infrastructure',
};

// ── NGO Status Map ────────────────────────────────────────────
const NGO_STATUS = {
  available:   { label:'Available',   class:'sb-available' },
  busy:        { label:'Busy',        class:'sb-busy'      },
  en_route:    { label:'En Route',    class:'sb-busy'      },
  pending:     { label:'Pending',     class:'sb-pending'   },
};

// ── Toast Notifications ───────────────────────────────────────
function showToast(message, type = 'info', durationMs = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icons = { success:'✅', error:'❌', info:'ℹ️', warning:'⚠️' };
  t.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transform='translateX(110%)'; t.style.transition='.3s ease'; }, durationMs - 300);
  setTimeout(() => t.remove(), durationMs);
}

// ── API Helpers ───────────────────────────────────────────────
async function apiGet(path) {
  const r = await fetch(`${CONFIG.BACKEND_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' }
  });
  if (!r.ok) throw new Error(`API error ${r.status}: ${await r.text()}`);
  return r.json();
}

async function apiPost(path, body) {
  const r = await fetch(`${CONFIG.BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`API error ${r.status}: ${await r.text()}`);
  return r.json();
}

// ── Supabase Helpers ──────────────────────────────────────────
async function fetchProblems(limit = 50) {
  const { data, error } = await _supabase
    .from('problems')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

async function fetchNGOs() {
  const { data, error } = await _supabase
    .from('ngos')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function fetchNGOById(id) {
  const { data, error } = await _supabase
    .from('ngos')
    .select('*, problems:current_problem_id(*)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

async function fetchAssignmentHistory(ngoId) {
  const { data, error } = await _supabase
    .from('assignments')
    .select('*, problems:problem_id(type, description, people_affected)')
    .eq('ngo_id', ngoId)
    .order('started_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ── Formatting Helpers ────────────────────────────────────────
function typeBadge(typeKey) {
  const t = PROBLEM_TYPES[typeKey] || { label: typeKey, emoji:'❓', badgeClass:'bp8' };
  return `<span class="badge ${t.badgeClass}">${t.emoji} ${t.label}</span>`;
}

function statusBadge(statusKey) {
  const s = NGO_STATUS[statusKey] || { label: statusKey, class:'sb-pending' };
  return `<span class="sb ${s.class}"><span class="sb-dot"></span>${s.label}</span>`;
}

function problemStatusBadge(statusKey) {
  const map = {
    open:        { label:'Open',        c:'sb-pending' },
    assigned:    { label:'Assigned',    c:'sb-assigned' },
    resolved:    { label:'Resolved',    c:'sb-resolved' },
    pending:     { label:'Pending',     c:'sb-pending' },
    interrupted: { label:'Interrupted', c:'sb-interrupted' },
  };
  const s = map[statusKey] || { label: statusKey, c:'sb-pending' };
  return `<span class="sb ${s.c}"><span class="sb-dot"></span>${s.label}</span>`;
}

function scoreClass(score) {
  if (score >= 200) return 'sc-high';
  if (score >= 100) return 'sc-mid';
  return 'sc-low';
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function etaDisplay(ngo) {
  if (!ngo.assignment_start || !ngo.eta_days) return '—';
  const start = new Date(ngo.assignment_start);
  const endMs = start.getTime() + ngo.eta_days * 86400000;
  const diffMs = endMs - Date.now();
  if (diffMs < 0) return '<span style="color:var(--amber)">Overdue</span>';
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);
  if (days > 0) return `~${days}d ${hours}h left`;
  return `~${hours}h left`;
}

function truncate(str, len = 60) {
  if (!str) return '—';
  return str.length > len ? str.slice(0, len) + '…' : str;
}

// ── Skeleton Loader ───────────────────────────────────────────
function skeletonRows(cols, rows = 5) {
  return Array.from({ length: rows }, () =>
    `<tr>${Array.from({ length: cols }, () =>
      `<td><div class="skeleton" style="height:14px;width:80%;border-radius:4px;"></div></td>`
    ).join('')}</tr>`
  ).join('');
}

// ── Cluster colour palette ────────────────────────────────────
const CLUSTER_COLORS = [
  '#00d4ff','#7c3aed','#f43f5e','#10b981','#f59e0b',
  '#6366f1','#ec4899','#14b8a6','#8b5cf6','#f97316',
];
function clusterColor(idx) {
  return CLUSTER_COLORS[Math.abs(idx) % CLUSTER_COLORS.length];
}

// ── Export globals needed by page scripts ─────────────────────
window.SmartAid = {
  CONFIG, supabase: _supabase, PROBLEM_TYPES, WORK_TYPE_LABELS, NGO_STATUS,
  showToast, apiGet, apiPost,
  fetchProblems, fetchNGOs, fetchNGOById, fetchAssignmentHistory,
  typeBadge, statusBadge, problemStatusBadge, scoreClass,
  timeAgo, etaDisplay, truncate, skeletonRows, clusterColor,
};
