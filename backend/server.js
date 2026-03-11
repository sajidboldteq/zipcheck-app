// backend/server.js
const express  = require("express");
const cors     = require("cors");
const morgan   = require("morgan");
const crypto   = require("crypto");
const axios    = require("axios");

const rulesRouter     = require("./routes/rules");
const groupsRouter    = require("./routes/groups");
const analyticsRouter = require("./routes/analytics");
const checkRouter     = require("./routes/check");
const settingsRouter  = require("./routes/settings");

const app  = express();
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "https://zipcheck-app-production.up.railway.app";

const SHOPIFY_API_KEY    = process.env.SHOPIFY_API_KEY    || "";
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "";
const SCOPES             = process.env.SCOPES             || "read_products,write_script_tags";

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: "*", credentials: true }));
app.use(morgan("dev"));
app.use(express.json());

// ── Manual OAuth: Step 1 — Begin ─────────────────────────────────────────────
app.get("/auth", (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send("Missing shop parameter");
  const nonce       = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${HOST}/auth/callback`;
  const installUrl  = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${nonce}&grant_options[]=`;
  console.log("🔐 Starting OAuth for:", shop);
  res.redirect(installUrl);
});

// ── Manual OAuth: Step 2 — Callback ──────────────────────────────────────────
app.get("/auth/callback", async (req, res) => {
  const { shop, code, state } = req.query;
  try {
    const tokenRes = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id:     SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code,
    });
    const accessToken = tokenRes.data.access_token;
    console.log("✅ Installed on:", shop);
    try {
      const { read, write } = require("./utils/store");
      const sessions = read("sessions") || {};
      sessions[shop] = { shop, accessToken, installedAt: new Date().toISOString() };
      write("sessions", sessions);
    } catch (e) { console.log("Session save error:", e.message); }
    try {
      await axios.post(
        `https://${shop}/admin/api/2025-01/script_tags.json`,
        { script_tag: { event: "onload", src: `${HOST}/widget.js` } },
        { headers: { "X-Shopify-Access-Token": accessToken } }
      );
      console.log("✅ Widget script tag registered");
    } catch (e) { console.log("Script tag error:", e.message); }
    res.redirect(`https://${shop}/admin/apps/${SHOPIFY_API_KEY}`);
  } catch (e) {
    console.error("❌ Token exchange failed:", e.response?.data || e.message);
    res.status(500).send("Installation failed: " + (e.response?.data?.error_description || e.message));
  }
});

// ── Admin Dashboard ───────────────────────────────────────────────────────────
const adminHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Zip Code Checker — Admin</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --green:      #008060;
      --green-lt:   #e8f5f0;
      --green-dk:   #004c3f;
      --red:        #d72c0d;
      --red-lt:     #fff4f2;
      --gray-50:    #f9fafb;
      --gray-100:   #f1f3f5;
      --gray-200:   #e4e5e7;
      --gray-400:   #8c9196;
      --gray-700:   #303030;
      --white:      #ffffff;
      --radius:     10px;
      --shadow:     0 1px 4px rgba(0,0,0,.08), 0 4px 16px rgba(0,0,0,.06);
    }

    body {
      font-family: 'DM Sans', sans-serif;
      background: var(--gray-50);
      color: var(--gray-700);
      min-height: 100vh;
    }

    /* ── Header ── */
    .header {
      background: var(--green-dk);
      padding: 0 32px;
      height: 56px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .header-logo {
      width: 28px; height: 28px;
      background: var(--green);
      border-radius: 6px;
      display: grid; place-items: center;
      font-size: 16px;
    }
    .header h1 {
      font-size: 16px;
      font-weight: 600;
      color: #fff;
      letter-spacing: -.01em;
    }
    .header-badge {
      margin-left: auto;
      background: rgba(255,255,255,.12);
      color: rgba(255,255,255,.8);
      font-size: 12px;
      padding: 3px 10px;
      border-radius: 20px;
      font-family: 'DM Mono', monospace;
    }

    /* ── Layout ── */
    .page { max-width: 860px; margin: 0 auto; padding: 32px 20px 60px; }

    /* ── Stats Row ── */
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 28px; }
    .stat-card {
      background: var(--white);
      border: 1px solid var(--gray-200);
      border-radius: var(--radius);
      padding: 20px 24px;
      box-shadow: var(--shadow);
    }
    .stat-label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--gray-400); margin-bottom: 8px; }
    .stat-value { font-size: 32px; font-weight: 700; color: var(--gray-700); font-family: 'DM Mono', monospace; line-height: 1; }
    .stat-value.green { color: var(--green); }
    .stat-value.red   { color: var(--red); }

    /* ── Card ── */
    .card {
      background: var(--white);
      border: 1px solid var(--gray-200);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      margin-bottom: 24px;
      overflow: hidden;
    }
    .card-header {
      padding: 18px 24px;
      border-bottom: 1px solid var(--gray-200);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .card-header h2 { font-size: 15px; font-weight: 600; }
    .card-header p  { font-size: 13px; color: var(--gray-400); margin-left: auto; }

    /* ── Add Form ── */
    .add-form { padding: 20px 24px; display: flex; gap: 10px; flex-wrap: wrap; }
    .input-group { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 160px; }
    .input-group label { font-size: 12px; font-weight: 600; color: var(--gray-400); text-transform: uppercase; letter-spacing: .05em; }
    .input-group input, .input-group select {
      padding: 9px 12px;
      border: 1.5px solid var(--gray-200);
      border-radius: 8px;
      font-size: 14px;
      font-family: 'DM Mono', monospace;
      outline: none;
      transition: border-color .15s;
      background: var(--white);
    }
    .input-group input:focus, .input-group select:focus { border-color: var(--green); }

    .btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 9px 18px;
      border-radius: 8px;
      font-size: 14px; font-weight: 600;
      cursor: pointer; border: none;
      transition: all .15s;
      font-family: 'DM Sans', sans-serif;
    }
    .btn-primary   { background: var(--green); color: #fff; }
    .btn-primary:hover { background: var(--green-dk); }
    .btn-danger    { background: var(--red-lt); color: var(--red); }
    .btn-danger:hover  { background: #ffd9d3; }
    .btn-ghost     { background: var(--gray-100); color: var(--gray-700); }
    .btn-ghost:hover   { background: var(--gray-200); }
    .btn-sm { padding: 5px 12px; font-size: 12px; border-radius: 6px; }
    .btn-add { align-self: flex-end; height: 40px; }

    /* ── Table ── */
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; }
    thead tr { background: var(--gray-50); border-bottom: 1px solid var(--gray-200); }
    thead th { padding: 10px 16px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--gray-400); }
    tbody tr { border-bottom: 1px solid var(--gray-100); transition: background .1s; }
    tbody tr:last-child { border-bottom: none; }
    tbody tr:hover { background: var(--gray-50); }
    tbody td { padding: 12px 16px; font-size: 14px; }
    td.zip-code { font-family: 'DM Mono', monospace; font-weight: 500; font-size: 15px; }

    /* ── Badge ── */
    .badge {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 3px 10px; border-radius: 20px;
      font-size: 12px; font-weight: 600;
    }
    .badge-allow  { background: var(--green-lt); color: var(--green-dk); }
    .badge-deny   { background: var(--red-lt);   color: var(--red); }
    .badge-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

    /* ── Toggle ── */
    .toggle { position: relative; width: 36px; height: 20px; cursor: pointer; }
    .toggle input { opacity: 0; width: 0; height: 0; }
    .toggle-slider {
      position: absolute; inset: 0;
      background: var(--gray-200);
      border-radius: 20px;
      transition: background .2s;
    }
    .toggle-slider::after {
      content: '';
      position: absolute;
      left: 2px; top: 2px;
      width: 16px; height: 16px;
      background: #fff;
      border-radius: 50%;
      transition: transform .2s;
      box-shadow: 0 1px 3px rgba(0,0,0,.2);
    }
    .toggle input:checked + .toggle-slider { background: var(--green); }
    .toggle input:checked + .toggle-slider::after { transform: translateX(16px); }

    .actions { display: flex; gap: 6px; align-items: center; }

    /* ── Empty state ── */
    .empty {
      padding: 48px 24px;
      text-align: center;
      color: var(--gray-400);
    }
    .empty-icon { font-size: 36px; margin-bottom: 10px; }
    .empty p { font-size: 14px; }

    /* ── Toast ── */
    #toast {
      position: fixed; bottom: 24px; right: 24px;
      background: var(--gray-700); color: #fff;
      padding: 12px 20px; border-radius: 8px;
      font-size: 14px; font-weight: 500;
      opacity: 0; transform: translateY(8px);
      transition: all .2s;
      pointer-events: none;
      z-index: 999;
    }
    #toast.show { opacity: 1; transform: translateY(0); }
    #toast.success { background: var(--green); }
    #toast.error   { background: var(--red); }

    /* ── Bulk actions bar ── */
    .bulk-bar {
      padding: 10px 16px;
      background: var(--green-lt);
      border-bottom: 1px solid var(--gray-200);
      display: none;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      font-weight: 500;
      color: var(--green-dk);
    }
    .bulk-bar.visible { display: flex; }

    @media (max-width: 600px) {
      .stats { grid-template-columns: 1fr 1fr; }
      .add-form { flex-direction: column; }
    }
  </style>
</head>
<body>

<header class="header">
  <div class="header-logo">📍</div>
  <h1>Zip Code Checker</h1>
  <span class="header-badge" id="store-badge">Admin Dashboard</span>
</header>

<main class="page">

  <!-- Stats -->
  <div class="stats">
    <div class="stat-card">
      <div class="stat-label">Total Rules</div>
      <div class="stat-value" id="stat-total">—</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Allowed</div>
      <div class="stat-value green" id="stat-allowed">—</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Denied</div>
      <div class="stat-value red" id="stat-denied">—</div>
    </div>
  </div>

  <!-- Add Rule Card -->
  <div class="card">
    <div class="card-header">
      <span>➕</span>
      <h2>Add Zip Code Rule</h2>
    </div>
    <div class="add-form">
      <div class="input-group">
        <label>Zip Code</label>
        <input id="zip-input" type="text" placeholder="e.g. 10001" maxlength="10"/>
      </div>
      <div class="input-group" style="max-width:160px">
        <label>Type</label>
        <select id="type-select">
          <option value="allow">✅ Allow</option>
          <option value="deny">🚫 Deny</option>
        </select>
      </div>
      <div class="input-group" style="max-width:220px">
        <label>Custom Message (optional)</label>
        <input id="msg-input" type="text" placeholder="Delivery available!"/>
      </div>
      <button class="btn btn-primary btn-add" onclick="addRule()">Add Rule</button>
    </div>
  </div>

  <!-- Rules Table Card -->
  <div class="card">
    <div class="card-header">
      <span>📋</span>
      <h2>Zip Code Rules</h2>
      <p id="rules-count">Loading...</p>
    </div>

    <div class="bulk-bar" id="bulk-bar">
      <span id="bulk-count">0 selected</span>
      <button class="btn btn-danger btn-sm" onclick="bulkDelete()">Delete Selected</button>
      <button class="btn btn-ghost btn-sm" onclick="clearSelection()">Cancel</button>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th><input type="checkbox" id="select-all" onchange="toggleAll(this)"/></th>
            <th>Zip Code</th>
            <th>Type</th>
            <th>Message</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="rules-body">
          <tr><td colspan="6"><div class="empty"><div class="empty-icon">⏳</div><p>Loading rules...</p></div></td></tr>
        </tbody>
      </table>
    </div>
  </div>

</main>

<div id="toast"></div>

<script>
  const API = window.location.origin;
  let rules = [];
  let selected = new Set();

  // ── Load rules ────────────────────────────────────────────────────────────
  async function loadRules() {
    try {
      const res = await fetch(API + '/api/rules');
      const data = await res.json();
      rules = Array.isArray(data) ? data : (data.rules || data.data || []);
      renderRules();
      updateStats();
    } catch(e) {
      document.getElementById('rules-body').innerHTML =
        '<tr><td colspan="6"><div class="empty"><div class="empty-icon">⚠️</div><p>Failed to load rules. Check API connection.</p></div></td></tr>';
    }
  }

  // ── Render table ──────────────────────────────────────────────────────────
  function renderRules() {
    const tbody = document.getElementById('rules-body');
    document.getElementById('rules-count').textContent = rules.length + ' rule' + (rules.length !== 1 ? 's' : '');

    if (!rules.length) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty"><div class="empty-icon">📭</div><p>No zip code rules yet. Add your first rule above!</p></div></td></tr>';
      return;
    }

    tbody.innerHTML = rules.map(r => {
      const isAllow   = r.type === 'allow';
      const isEnabled = r.enabled !== false;
      const id        = r.id || r._id || r.zip;
      return \`
        <tr>
          <td><input type="checkbox" class="row-check" data-id="\${id}" onchange="toggleSelect('\${id}', this.checked)"/></td>
          <td class="zip-code">\${r.zip || r.zipCode || r.code || '—'}</td>
          <td>
            <span class="badge \${isAllow ? 'badge-allow' : 'badge-deny'}">
              <span class="badge-dot"></span>
              \${isAllow ? 'Allow' : 'Deny'}
            </span>
          </td>
          <td style="color: var(--gray-400); font-size:13px">\${r.message || '—'}</td>
          <td>
            <label class="toggle" title="\${isEnabled ? 'Disable' : 'Enable'} rule">
              <input type="checkbox" \${isEnabled ? 'checked' : ''} onchange="toggleRule('\${id}', this.checked)"/>
              <span class="toggle-slider"></span>
            </label>
          </td>
          <td>
            <div class="actions">
              <button class="btn btn-danger btn-sm" onclick="deleteRule('\${id}')">Delete</button>
            </div>
          </td>
        </tr>
      \`;
    }).join('');
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  function updateStats() {
    document.getElementById('stat-total').textContent   = rules.length;
    document.getElementById('stat-allowed').textContent = rules.filter(r => r.type === 'allow').length;
    document.getElementById('stat-denied').textContent  = rules.filter(r => r.type === 'deny').length;
  }

  // ── Add rule ──────────────────────────────────────────────────────────────
  async function addRule() {
    const zip  = document.getElementById('zip-input').value.trim();
    const type = document.getElementById('type-select').value;
    const msg  = document.getElementById('msg-input').value.trim();

    if (!zip) { showToast('Enter a zip code', 'error'); return; }

    try {
      const res = await fetch(API + '/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zip, type, message: msg, enabled: true })
      });
      if (!res.ok) throw new Error('Failed');
      document.getElementById('zip-input').value = '';
      document.getElementById('msg-input').value = '';
      showToast('✅ Rule added!', 'success');
      loadRules();
    } catch(e) {
      showToast('Failed to add rule', 'error');
    }
  }

  // ── Delete rule ───────────────────────────────────────────────────────────
  async function deleteRule(id) {
    if (!confirm('Delete this rule?')) return;
    try {
      await fetch(API + '/api/rules/' + id, { method: 'DELETE' });
      showToast('🗑️ Rule deleted', 'success');
      loadRules();
    } catch(e) {
      showToast('Failed to delete', 'error');
    }
  }

  // ── Toggle enable/disable ─────────────────────────────────────────────────
  async function toggleRule(id, enabled) {
    try {
      await fetch(API + '/api/rules/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      showToast(enabled ? '✅ Rule enabled' : '⏸️ Rule disabled', 'success');
      loadRules();
    } catch(e) {
      showToast('Failed to update', 'error');
    }
  }

  // ── Bulk select ───────────────────────────────────────────────────────────
  function toggleSelect(id, checked) {
    checked ? selected.add(id) : selected.delete(id);
    document.getElementById('bulk-count').textContent = selected.size + ' selected';
    document.getElementById('bulk-bar').classList.toggle('visible', selected.size > 0);
  }

  function toggleAll(cb) {
    document.querySelectorAll('.row-check').forEach(el => {
      el.checked = cb.checked;
      toggleSelect(el.dataset.id, cb.checked);
    });
  }

  function clearSelection() {
    selected.clear();
    document.querySelectorAll('.row-check').forEach(el => el.checked = false);
    document.getElementById('select-all').checked = false;
    document.getElementById('bulk-bar').classList.remove('visible');
  }

  async function bulkDelete() {
    if (!selected.size || !confirm('Delete ' + selected.size + ' rules?')) return;
    await Promise.all([...selected].map(id => fetch(API + '/api/rules/' + id, { method: 'DELETE' })));
    showToast('🗑️ ' + selected.size + ' rules deleted', 'success');
    clearSelection();
    loadRules();
  }

  // ── Enter key on zip input ────────────────────────────────────────────────
  document.getElementById('zip-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addRule();
  });

  // ── Toast ─────────────────────────────────────────────────────────────────
  function showToast(msg, type = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'show ' + type;
    setTimeout(() => t.className = '', 2500);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  loadRules();
</script>
</body>
</html>`;

app.get("/", (req, res) => res.send(adminHTML));
app.get("/app", (req, res) => res.send(adminHTML));

// ── Widget JS ─────────────────────────────────────────────────────────────────
app.get("/widget.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.send(`
(function() {
  if (document.getElementById('zipcheck-widget')) return;
  var s = document.createElement('style');
  s.textContent = '#zipcheck-widget{font-family:-apple-system,sans-serif;margin:16px 0;padding:16px;border:1px solid #e4e5e7;border-radius:10px;background:#fff}#zipcheck-widget label{display:block;font-weight:700;font-size:14px;margin-bottom:8px}#zipcheck-widget .zc-row{display:flex;gap:8px}#zipcheck-widget input{flex:1;padding:9px 12px;border:1.5px solid #c9cccf;border-radius:8px;font-size:15px;outline:none}#zipcheck-widget button{padding:9px 18px;background:#008060;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer}#zc-result{margin-top:10px;font-size:14px;min-height:18px;font-weight:500}';
  document.head.appendChild(s);
  var w = document.createElement('div');
  w.id = 'zipcheck-widget';
  w.innerHTML = '<label>📍 Check Delivery Availability</label><div class="zc-row"><input id="zc-zip" placeholder="Enter zip code (e.g. 10001)" maxlength="10"/><button id="zc-btn">Check</button></div><div id="zc-result"></div>';
  var cart = document.querySelector('[name="add"],.product-form__submit,#AddToCart,.btn--add-to-cart');
  if (cart) { var f = cart.closest('form'); (f||cart).parentNode.insertBefore(w, f||cart); }
  else { var c = document.querySelector('.product__info-container,.product-single__meta'); if(c) c.appendChild(w); }
  document.getElementById('zc-btn').onclick = async function() {
    var zip = document.getElementById('zc-zip').value.trim();
    var out = document.getElementById('zc-result');
    if(!/^\\d{5}(-\\d{4})?$/.test(zip)){out.innerHTML='<span style="color:#d72c0d">⚠ Enter a valid 5-digit zip code</span>';return;}
    out.innerHTML='<span style="color:#999">Checking...</span>';
    try {
      var r = await fetch('${HOST}/api/check/lookup/'+zip);
      var d = (await r.json()).data;
      out.innerHTML = d.allowed
        ? '<span style="color:#008060">✅ '+(d.message||'Delivery available!')+'</span>'
        : '<span style="color:#d72c0d">🚫 '+(d.message||'Delivery not available.')+'</span>';
    } catch(e){out.innerHTML='<span style="color:#d72c0d">Error checking. Try again.</span>';}
  };
  document.getElementById('zc-zip').onkeydown=function(e){if(e.key==='Enter')document.getElementById('zc-btn').click();};
})();
  `);
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use("/api/rules",     rulesRouter);
app.use("/api/groups",    groupsRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/check",     checkRouter);
app.use("/api/settings",  settingsRouter);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 ZipCheck running on port ${PORT}`);
  console.log(`🔐 Install URL: ${HOST}/auth?shop=YOUR_STORE.myshopify.com\n`);
});
