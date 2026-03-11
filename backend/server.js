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

// ── Allow Shopify to embed this app in iframe ─────────────────────────────────
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", "frame-ancestors https://*.myshopify.com https://admin.shopify.com");
  res.removeHeader("X-Frame-Options");
  next();
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: "*", credentials: true }));
app.use(morgan("dev"));
app.use(express.json());

// ── OAuth: Begin ──────────────────────────────────────────────────────────────
app.get("/auth", (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send("Missing shop parameter");
  const nonce       = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${HOST}/auth/callback`;
  const installUrl  = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${nonce}&grant_options[]=`;
  res.redirect(installUrl);
});

// ── OAuth: Callback ───────────────────────────────────────────────────────────
app.get("/auth/callback", async (req, res) => {
  const { shop, code } = req.query;
  try {
    const tokenRes = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: SHOPIFY_API_KEY, client_secret: SHOPIFY_API_SECRET, code,
    });
    const accessToken = tokenRes.data.access_token;
    console.log("✅ Installed on:", shop);
    try {
      const { read, write } = require("./utils/store");
      const sessions = read("sessions") || {};
      sessions[shop] = { shop, accessToken, installedAt: new Date().toISOString() };
      write("sessions", sessions);
    } catch (e) { console.log("Session save:", e.message); }
    try {
      await axios.post(
        `https://${shop}/admin/api/2025-01/script_tags.json`,
        { script_tag: { event: "onload", src: `${HOST}/widget.js` } },
        { headers: { "X-Shopify-Access-Token": accessToken } }
      );
      console.log("✅ Script tag registered");
    } catch (e) { console.log("Script tag:", e.message); }
    res.redirect(`https://${shop}/admin/apps/${SHOPIFY_API_KEY}`);
  } catch (e) {
    console.error("❌ Callback error:", e.response?.data || e.message);
    res.status(500).send("Installation failed: " + e.message);
  }
});

// ── Admin Dashboard HTML ──────────────────────────────────────────────────────
const adminHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Zip Code Checker</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet"/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --green:    #008060; --green-lt: #e6f4f0; --green-dk: #004c3f;
      --red:      #d72c0d; --red-lt:   #fff4f2;
      --yellow:   #b98900; --yellow-lt:#fdf3d9;
      --gray-50:  #f9fafb; --gray-100: #f1f3f5; --gray-200: #e4e5e7;
      --gray-400: #8c9196; --gray-600: #5c5f62; --gray-800: #202223;
      --white:    #ffffff;
      --sidebar:  220px;
      --radius:   10px;
      --shadow:   0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.06);
    }
    body { font-family:'DM Sans',sans-serif; background:var(--gray-50); color:var(--gray-800); min-height:100vh; display:flex; flex-direction:column; }

    /* ── Top Bar ── */
    .topbar { background:var(--green-dk); height:52px; display:flex; align-items:center; padding:0 20px; gap:12px; flex-shrink:0; }
    .topbar-logo { background:var(--green); width:30px; height:30px; border-radius:7px; display:grid; place-items:center; font-size:15px; }
    .topbar h1 { font-size:15px; font-weight:700; color:#fff; }
    .topbar-store { margin-left:auto; font-size:12px; color:rgba(255,255,255,.6); font-family:'DM Mono',monospace; }

    /* ── Shell ── */
    .shell { display:flex; flex:1; overflow:hidden; }

    /* ── Sidebar ── */
    .sidebar { width:var(--sidebar); background:var(--white); border-right:1px solid var(--gray-200); padding:16px 0; flex-shrink:0; }
    .sidebar-section { padding:6px 12px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--gray-400); margin-top:8px; }
    .nav-item {
      display:flex; align-items:center; gap:10px;
      padding:9px 16px; font-size:14px; font-weight:500;
      color:var(--gray-600); cursor:pointer; border:none; background:none;
      width:100%; text-align:left; border-radius:0;
      transition:all .15s;
    }
    .nav-item:hover { background:var(--gray-50); color:var(--gray-800); }
    .nav-item.active { background:var(--green-lt); color:var(--green-dk); font-weight:600; }
    .nav-item .icon { width:18px; font-size:15px; text-align:center; flex-shrink:0; }

    /* ── Content ── */
    .content { flex:1; overflow-y:auto; padding:24px; }

    /* ── Page ── */
    .page { display:none; max-width:800px; }
    .page.active { display:block; }
    .page-title { font-size:20px; font-weight:700; margin-bottom:4px; }
    .page-sub   { font-size:14px; color:var(--gray-400); margin-bottom:24px; }

    /* ── Stats ── */
    .stats { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-bottom:24px; }
    .stat { background:var(--white); border:1px solid var(--gray-200); border-radius:var(--radius); padding:18px 20px; box-shadow:var(--shadow); }
    .stat-label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--gray-400); margin-bottom:6px; }
    .stat-val   { font-size:28px; font-weight:700; font-family:'DM Mono',monospace; line-height:1; }
    .stat-val.g { color:var(--green); } .stat-val.r { color:var(--red); }

    /* ── Card ── */
    .card { background:var(--white); border:1px solid var(--gray-200); border-radius:var(--radius); box-shadow:var(--shadow); margin-bottom:20px; overflow:hidden; }
    .card-head { padding:16px 20px; border-bottom:1px solid var(--gray-200); display:flex; align-items:center; gap:8px; }
    .card-head h2 { font-size:14px; font-weight:600; }
    .card-head .badge-count { margin-left:auto; background:var(--gray-100); color:var(--gray-600); font-size:12px; padding:2px 8px; border-radius:20px; font-weight:600; }

    /* ── Form ── */
    .form-row { padding:16px 20px; display:flex; gap:10px; flex-wrap:wrap; border-bottom:1px solid var(--gray-200); }
    .fld { display:flex; flex-direction:column; gap:4px; flex:1; min-width:130px; }
    .fld label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--gray-400); }
    .fld input, .fld select, .fld textarea {
      padding:8px 11px; border:1.5px solid var(--gray-200); border-radius:8px;
      font-size:14px; font-family:'DM Sans',sans-serif; outline:none;
      transition:border-color .15s; background:var(--white); color:var(--gray-800);
    }
    .fld input:focus, .fld select:focus, .fld textarea:focus { border-color:var(--green); }
    .fld textarea { resize:vertical; min-height:70px; }

    /* ── Buttons ── */
    .btn { display:inline-flex; align-items:center; gap:6px; padding:8px 16px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; border:none; transition:all .15s; font-family:'DM Sans',sans-serif; }
    .btn-primary { background:var(--green); color:#fff; } .btn-primary:hover { background:var(--green-dk); }
    .btn-danger  { background:var(--red-lt); color:var(--red); } .btn-danger:hover { background:#ffd9d3; }
    .btn-ghost   { background:var(--gray-100); color:var(--gray-800); } .btn-ghost:hover { background:var(--gray-200); }
    .btn-sm { padding:5px 11px; font-size:12px; border-radius:6px; }
    .btn-save-bottom { margin-top:16px; }

    /* ── Table ── */
    .tbl-wrap { overflow-x:auto; }
    table { width:100%; border-collapse:collapse; }
    thead tr { background:var(--gray-50); border-bottom:1px solid var(--gray-200); }
    th { padding:9px 14px; text-align:left; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--gray-400); white-space:nowrap; }
    tbody tr { border-bottom:1px solid var(--gray-100); transition:background .1s; }
    tbody tr:last-child { border-bottom:none; }
    tbody tr:hover { background:var(--gray-50); }
    td { padding:11px 14px; font-size:14px; }
    td.mono { font-family:'DM Mono',monospace; font-weight:500; font-size:15px; }

    /* ── Badge ── */
    .badge { display:inline-flex; align-items:center; gap:5px; padding:3px 9px; border-radius:20px; font-size:12px; font-weight:600; }
    .badge-allow { background:var(--green-lt); color:var(--green-dk); }
    .badge-deny  { background:var(--red-lt);   color:var(--red); }
    .dot { width:6px; height:6px; border-radius:50%; background:currentColor; }

    /* ── Toggle ── */
    .toggle { position:relative; width:34px; height:18px; cursor:pointer; display:inline-block; }
    .toggle input { opacity:0; width:0; height:0; }
    .slider { position:absolute; inset:0; background:var(--gray-200); border-radius:20px; transition:.2s; }
    .slider::after { content:''; position:absolute; left:2px; top:2px; width:14px; height:14px; background:#fff; border-radius:50%; transition:.2s; box-shadow:0 1px 3px rgba(0,0,0,.2); }
    .toggle input:checked + .slider { background:var(--green); }
    .toggle input:checked + .slider::after { transform:translateX(16px); }

    /* ── Empty ── */
    .empty { padding:40px 20px; text-align:center; color:var(--gray-400); }
    .empty-icon { font-size:32px; margin-bottom:8px; }

    /* ── Bulk bar ── */
    .bulk-bar { padding:9px 14px; background:var(--green-lt); border-bottom:1px solid var(--gray-200); display:none; align-items:center; gap:10px; font-size:13px; font-weight:500; color:var(--green-dk); }
    .bulk-bar.on { display:flex; }

    /* ── Settings ── */
    .settings-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; padding:20px; }
    .setting-item { display:flex; flex-direction:column; gap:6px; }
    .setting-item label { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--gray-400); }
    .color-row { display:flex; align-items:center; gap:8px; }
    .color-row input[type=color] { width:40px; height:34px; padding:2px; border:1.5px solid var(--gray-200); border-radius:6px; cursor:pointer; background:var(--white); }
    .color-row input[type=text] { flex:1; }

    /* ── Widget Preview ── */
    .preview-box { padding:20px; background:var(--gray-50); border-top:1px solid var(--gray-200); }
    .preview-label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--gray-400); margin-bottom:12px; }
    #widget-preview { max-width:400px; }

    /* ── Shortcode ── */
    .code-block { background:var(--gray-800); color:#a8ff78; font-family:'DM Mono',monospace; font-size:13px; padding:16px 20px; border-radius:8px; overflow-x:auto; white-space:pre; margin:12px 0; position:relative; }
    .copy-btn { position:absolute; right:12px; top:12px; background:rgba(255,255,255,.1); color:#fff; border:none; border-radius:6px; padding:4px 10px; font-size:11px; cursor:pointer; font-family:'DM Sans',sans-serif; }
    .copy-btn:hover { background:rgba(255,255,255,.2); }
    .info-box { background:var(--yellow-lt); border:1px solid #f1c232; border-radius:8px; padding:14px 16px; font-size:13px; color:var(--yellow); margin:12px 0; }

    /* ── Toast ── */
    #toast { position:fixed; bottom:20px; right:20px; background:var(--gray-800); color:#fff; padding:11px 18px; border-radius:8px; font-size:13px; font-weight:600; opacity:0; transform:translateY(8px); transition:all .2s; pointer-events:none; z-index:9999; }
    #toast.on { opacity:1; transform:translateY(0); }
    #toast.s { background:var(--green); } #toast.e { background:var(--red); }

    @media(max-width:640px) {
      .sidebar { display:none; }
      .stats { grid-template-columns:1fr 1fr; }
      .settings-grid { grid-template-columns:1fr; }
    }
  </style>
</head>
<body>

<!-- Top Bar -->
<div class="topbar">
  <div class="topbar-logo">📍</div>
  <h1>Zip Code Checker</h1>
  <span class="topbar-store" id="store-name">Admin</span>
</div>

<!-- Shell -->
<div class="shell">

  <!-- Sidebar -->
  <nav class="sidebar">
    <div class="sidebar-section">Main</div>
    <button class="nav-item active" onclick="showPage('zip-codes')">
      <span class="icon">🗺️</span> Zip Codes
    </button>
    <button class="nav-item" onclick="showPage('settings')">
      <span class="icon">⚙️</span> Settings
    </button>
    <div class="sidebar-section">Developer</div>
    <button class="nav-item" onclick="showPage('shortcode')">
      <span class="icon">🔗</span> Embed / Shortcode
    </button>
    <button class="nav-item" onclick="showPage('analytics')">
      <span class="icon">📊</span> Analytics
    </button>
  </nav>

  <!-- Content -->
  <main class="content">

    <!-- ── Zip Codes Page ── -->
    <div class="page active" id="page-zip-codes">
      <div class="page-title">Zip Code Rules</div>
      <div class="page-sub">Control which zip codes can receive delivery. Rules are checked in order.</div>

      <!-- Stats -->
      <div class="stats">
        <div class="stat"><div class="stat-label">Total Rules</div><div class="stat-val" id="s-total">—</div></div>
        <div class="stat"><div class="stat-label">Allowed</div><div class="stat-val g" id="s-allow">—</div></div>
        <div class="stat"><div class="stat-label">Denied</div><div class="stat-val r" id="s-deny">—</div></div>
      </div>

      <!-- Add Rule -->
      <div class="card">
        <div class="card-head"><span>➕</span><h2>Add New Rule</h2></div>
        <div class="form-row">
          <div class="fld" style="max-width:150px">
            <label>Zip Code</label>
            <input id="f-zip" type="text" placeholder="e.g. 10001" maxlength="10"/>
          </div>
          <div class="fld" style="max-width:140px">
            <label>Type</label>
            <select id="f-type">
              <option value="allow">✅ Allow</option>
              <option value="deny">🚫 Deny</option>
            </select>
          </div>
          <div class="fld">
            <label>Custom Message (optional)</label>
            <input id="f-msg" type="text" placeholder="e.g. Delivery available in your area!"/>
          </div>
          <div class="fld" style="justify-content:flex-end; flex:0; min-width:auto">
            <label>&nbsp;</label>
            <button class="btn btn-primary" onclick="addRule()">Add Rule</button>
          </div>
        </div>
      </div>

      <!-- Rules Table -->
      <div class="card">
        <div class="card-head">
          <span>📋</span>
          <h2>All Rules</h2>
          <span class="badge-count" id="rules-count">0</span>
        </div>
        <div class="bulk-bar" id="bulk-bar">
          <span id="bulk-txt">0 selected</span>
          <button class="btn btn-danger btn-sm" onclick="bulkDelete()">🗑️ Delete Selected</button>
          <button class="btn btn-ghost btn-sm" onclick="clearSel()">Cancel</button>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr>
              <th><input type="checkbox" id="sel-all" onchange="toggleAll(this)"/></th>
              <th>Zip Code</th>
              <th>Type</th>
              <th>Custom Message</th>
              <th>Enabled</th>
              <th>Actions</th>
            </tr></thead>
            <tbody id="rules-tbody">
              <tr><td colspan="6"><div class="empty"><div class="empty-icon">⏳</div>Loading...</div></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ── Settings Page ── -->
    <div class="page" id="page-settings">
      <div class="page-title">Widget Settings</div>
      <div class="page-sub">Customize how the delivery checker widget looks on your store.</div>

      <div class="card">
        <div class="card-head"><span>🎨</span><h2>Colors & Appearance</h2></div>
        <div class="settings-grid">
          <div class="setting-item">
            <label>Button Color</label>
            <div class="color-row">
              <input type="color" id="s-btn-color" value="#008060" oninput="syncColor('s-btn-color','s-btn-color-hex')"/>
              <input type="text" id="s-btn-color-hex" value="#008060" maxlength="7" oninput="syncHex('s-btn-color-hex','s-btn-color')"/>
            </div>
          </div>
          <div class="setting-item">
            <label>Button Text Color</label>
            <div class="color-row">
              <input type="color" id="s-btn-txt" value="#ffffff" oninput="syncColor('s-btn-txt','s-btn-txt-hex')"/>
              <input type="text" id="s-btn-txt-hex" value="#ffffff" maxlength="7" oninput="syncHex('s-btn-txt-hex','s-btn-txt')"/>
            </div>
          </div>
          <div class="setting-item">
            <label>Success Color</label>
            <div class="color-row">
              <input type="color" id="s-ok-color" value="#008060" oninput="syncColor('s-ok-color','s-ok-color-hex')"/>
              <input type="text" id="s-ok-color-hex" value="#008060" maxlength="7" oninput="syncHex('s-ok-color-hex','s-ok-color')"/>
            </div>
          </div>
          <div class="setting-item">
            <label>Error Color</label>
            <div class="color-row">
              <input type="color" id="s-err-color" value="#d72c0d" oninput="syncColor('s-err-color','s-err-color-hex')"/>
              <input type="text" id="s-err-color-hex" value="#d72c0d" maxlength="7" oninput="syncHex('s-err-color-hex','s-err-color')"/>
            </div>
          </div>
          <div class="setting-item">
            <label>Border Color</label>
            <div class="color-row">
              <input type="color" id="s-border" value="#e4e5e7" oninput="syncColor('s-border','s-border-hex')"/>
              <input type="text" id="s-border-hex" value="#e4e5e7" maxlength="7" oninput="syncHex('s-border-hex','s-border')"/>
            </div>
          </div>
          <div class="setting-item">
            <label>Background Color</label>
            <div class="color-row">
              <input type="color" id="s-bg" value="#ffffff" oninput="syncColor('s-bg','s-bg-hex')"/>
              <input type="text" id="s-bg-hex" value="#ffffff" maxlength="7" oninput="syncHex('s-bg-hex','s-bg')"/>
            </div>
          </div>
        </div>

        <div class="settings-grid" style="border-top:1px solid var(--gray-200); padding-top:0">
          <div class="setting-item" style="padding:0 0 0 0">
            <label>Widget Title</label>
            <input class="fld input" type="text" id="s-title" value="📍 Check Delivery Availability" style="padding:8px 11px;border:1.5px solid var(--gray-200);border-radius:8px;font-size:14px;"/>
          </div>
          <div class="setting-item">
            <label>Button Text</label>
            <input class="fld input" type="text" id="s-btn-label" value="Check" style="padding:8px 11px;border:1.5px solid var(--gray-200);border-radius:8px;font-size:14px;"/>
          </div>
          <div class="setting-item">
            <label>Placeholder Text</label>
            <input class="fld input" type="text" id="s-placeholder" value="Enter zip code (e.g. 10001)" style="padding:8px 11px;border:1.5px solid var(--gray-200);border-radius:8px;font-size:14px;"/>
          </div>
          <div class="setting-item">
            <label>Default Allow Message</label>
            <input class="fld input" type="text" id="s-allow-msg" value="Delivery available!" style="padding:8px 11px;border:1.5px solid var(--gray-200);border-radius:8px;font-size:14px;"/>
          </div>
          <div class="setting-item">
            <label>Default Deny Message</label>
            <input class="fld input" type="text" id="s-deny-msg" value="Delivery not available in your area." style="padding:8px 11px;border:1.5px solid var(--gray-200);border-radius:8px;font-size:14px;"/>
          </div>
        </div>

        <div style="padding:0 20px 20px">
          <button class="btn btn-primary btn-save-bottom" onclick="saveSettings()">💾 Save Settings</button>
        </div>
      </div>

      <!-- Live Preview -->
      <div class="card">
        <div class="card-head"><span>👁️</span><h2>Live Preview</h2></div>
        <div class="preview-box">
          <div class="preview-label">Widget Preview</div>
          <div id="widget-preview">
            <div id="prev-widget" style="font-family:-apple-system,sans-serif;padding:16px;border:1px solid #e4e5e7;border-radius:10px;background:#fff;max-width:400px">
              <div id="prev-title" style="font-weight:700;font-size:14px;margin-bottom:10px">📍 Check Delivery Availability</div>
              <div style="display:flex;gap:8px">
                <input id="prev-input" type="text" placeholder="Enter zip code (e.g. 10001)" style="flex:1;padding:9px 12px;border:1.5px solid #c9cccf;border-radius:8px;font-size:15px;outline:none" readonly/>
                <button id="prev-btn" style="padding:9px 18px;background:#008060;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">Check</button>
              </div>
              <div style="margin-top:10px;font-size:14px;color:#008060;font-weight:500" id="prev-result">✅ Delivery available!</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Shortcode / Embed Page ── -->
    <div class="page" id="page-shortcode">
      <div class="page-title">Embed & Shortcode</div>
      <div class="page-sub">Add the zip code checker to any page in your store.</div>

      <div class="card">
        <div class="card-head"><span>🏪</span><h2>Method 1 — Script Tag (Auto, Recommended)</h2></div>
        <div style="padding:16px 20px">
          <p style="font-size:14px;color:var(--gray-600);margin-bottom:10px">
            The widget is already injected automatically on all product pages via a script tag registered during app installation. <strong>No extra steps needed.</strong>
          </p>
          <div class="info-box">⚠️ If the widget is not showing, make sure your theme uses a standard product form and has an "Add to Cart" button. The widget inserts itself above it.</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><span>📝</span><h2>Method 2 — Manual HTML Snippet</h2></div>
        <div style="padding:16px 20px">
          <p style="font-size:14px;color:var(--gray-600);margin-bottom:8px">Paste this anywhere in your theme's Liquid files (product page, cart page, etc.):</p>
          <div class="code-block" id="snippet-html"><button class="copy-btn" onclick="copyCode('snippet-html')">Copy</button>&lt;div id="zipcheck-manual"&gt;&lt;/div&gt;
&lt;script src="WIDGET_URL/widget.js"&gt;&lt;/script&gt;</div>
          <p style="font-size:13px;color:var(--gray-400);margin-top:8px">Replace <code>WIDGET_URL</code> with your Railway app URL.</p>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><span>🔌</span><h2>Method 3 — Shopify Theme App Extension (Advanced)</h2></div>
        <div style="padding:16px 20px">
          <p style="font-size:14px;color:var(--gray-600);margin-bottom:8px">
            For Online Store 2.0 themes, use a Theme App Extension block. Add this liquid snippet to your theme:
          </p>
          <div class="code-block" id="snippet-liquid"><button class="copy-btn" onclick="copyCode('snippet-liquid')">Copy</button>{% comment %} Zip Code Checker Widget {% endcomment %}
&lt;div id="zipcheck-widget-container"&gt;&lt;/div&gt;
&lt;script&gt;
  (function() {
    var s = document.createElement('script');
    s.src = 'WIDGET_URL/widget.js';
    s.async = true;
    document.head.appendChild(s);
  })();
&lt;/script&gt;</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><span>🔗</span><h2>API Endpoint</h2></div>
        <div style="padding:16px 20px">
          <p style="font-size:14px;color:var(--gray-600);margin-bottom:8px">Check delivery availability for a zip code programmatically:</p>
          <div class="code-block" id="snippet-api"><button class="copy-btn" onclick="copyCode('snippet-api')">Copy</button>GET WIDGET_URL/api/check/lookup/{zipcode}

// Example response:
{
  "data": {
    "zip": "10001",
    "allowed": true,
    "message": "Delivery available!"
  }
}</div>
        </div>
      </div>
    </div>

    <!-- ── Analytics Page ── -->
    <div class="page" id="page-analytics">
      <div class="page-title">Analytics</div>
      <div class="page-sub">See how customers are using the zip code checker.</div>
      <div class="card">
        <div class="card-head"><span>📊</span><h2>Lookup Statistics</h2></div>
        <div id="analytics-body" style="padding:20px">
          <div class="empty"><div class="empty-icon">📊</div><p>Loading analytics...</p></div>
        </div>
      </div>
    </div>

  </main>
</div><!-- end shell -->

<div id="toast"></div>

<script>
const API = window.location.origin;
let rules = [], selected = new Set();

// ── Navigation ───────────────────────────────────────────────────────────────
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  event.currentTarget.classList.add('active');
  if (id === 'zip-codes') loadRules();
  if (id === 'analytics') loadAnalytics();
  if (id === 'settings') loadSettings();
}

// ── Rules ─────────────────────────────────────────────────────────────────────
async function loadRules() {
  try {
    const res  = await fetch(API + '/api/rules');
    const data = await res.json();
    rules = Array.isArray(data) ? data : (data.rules || data.data || []);
    renderRules();
  } catch(e) {
    document.getElementById('rules-tbody').innerHTML =
      '<tr><td colspan="6"><div class="empty"><div class="empty-icon">⚠️</div>Failed to load rules</div></td></tr>';
  }
}

function renderRules() {
  const tbody = document.getElementById('rules-tbody');
  document.getElementById('rules-count').textContent = rules.length;
  document.getElementById('s-total').textContent  = rules.length;
  document.getElementById('s-allow').textContent  = rules.filter(r=>r.type==='allow').length;
  document.getElementById('s-deny').textContent   = rules.filter(r=>r.type==='deny').length;

  if (!rules.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty"><div class="empty-icon">📭</div><p>No rules yet. Add your first zip code above!</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = rules.map(r => {
    const id  = r.id || r._id || r.zip;
    const ena = r.enabled !== false;
    return \`<tr>
      <td><input type="checkbox" class="row-chk" data-id="\${id}" onchange="toggleSel('\${id}',this.checked)"/></td>
      <td class="mono">\${r.zip||r.zipCode||'—'}</td>
      <td><span class="badge badge-\${r.type}"><span class="dot"></span>\${r.type==='allow'?'Allow':'Deny'}</span></td>
      <td style="color:var(--gray-400);font-size:13px">\${r.message||'—'}</td>
      <td><label class="toggle"><input type="checkbox" \${ena?'checked':''} onchange="toggleRule('\${id}',this.checked)"/><span class="slider"></span></label></td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteRule('\${id}')">Delete</button></td>
    </tr>\`;
  }).join('');
}

async function addRule() {
  const zip  = document.getElementById('f-zip').value.trim();
  const type = document.getElementById('f-type').value;
  const msg  = document.getElementById('f-msg').value.trim();
  if (!zip) { toast('Enter a zip code', 'e'); return; }
  try {
    const res = await fetch(API+'/api/rules', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({zip, type, message:msg, enabled:true})
    });
    if (!res.ok) throw new Error();
    document.getElementById('f-zip').value = '';
    document.getElementById('f-msg').value = '';
    toast('✅ Rule added!', 's');
    loadRules();
  } catch(e) { toast('Failed to add rule', 'e'); }
}

async function deleteRule(id) {
  if (!confirm('Delete this rule?')) return;
  await fetch(API+'/api/rules/'+id, {method:'DELETE'});
  toast('🗑️ Deleted', 's');
  loadRules();
}

async function toggleRule(id, enabled) {
  try {
    await fetch(API+'/api/rules/'+id, {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({enabled})
    });
    toast(enabled ? '✅ Enabled' : '⏸️ Disabled', 's');
  } catch(e) { toast('Update failed','e'); }
}

function toggleSel(id, checked) {
  checked ? selected.add(id) : selected.delete(id);
  document.getElementById('bulk-txt').textContent = selected.size + ' selected';
  document.getElementById('bulk-bar').classList.toggle('on', selected.size > 0);
}
function toggleAll(cb) {
  document.querySelectorAll('.row-chk').forEach(el => {
    el.checked = cb.checked;
    toggleSel(el.dataset.id, cb.checked);
  });
}
function clearSel() {
  selected.clear();
  document.querySelectorAll('.row-chk').forEach(el => el.checked = false);
  document.getElementById('sel-all').checked = false;
  document.getElementById('bulk-bar').classList.remove('on');
}
async function bulkDelete() {
  if (!selected.size || !confirm('Delete ' + selected.size + ' rules?')) return;
  await Promise.all([...selected].map(id => fetch(API+'/api/rules/'+id, {method:'DELETE'})));
  toast('🗑️ ' + selected.size + ' rules deleted', 's');
  clearSel(); loadRules();
}

document.getElementById('f-zip').addEventListener('keydown', e => { if(e.key==='Enter') addRule(); });

// ── Settings ──────────────────────────────────────────────────────────────────
const COLOR_FIELDS = ['s-btn-color','s-btn-txt','s-ok-color','s-err-color','s-border','s-bg'];

function syncColor(colorId, hexId) {
  document.getElementById(hexId).value = document.getElementById(colorId).value;
  updatePreview();
}
function syncHex(hexId, colorId) {
  const v = document.getElementById(hexId).value;
  if (/^#[0-9a-f]{6}$/i.test(v)) { document.getElementById(colorId).value = v; updatePreview(); }
}

function updatePreview() {
  const btn = document.getElementById('prev-btn');
  const res = document.getElementById('prev-result');
  const wid = document.getElementById('prev-widget');
  const inp = document.getElementById('prev-input');
  btn.style.background  = document.getElementById('s-btn-color').value;
  btn.style.color       = document.getElementById('s-btn-txt').value;
  btn.textContent       = document.getElementById('s-btn-label').value || 'Check';
  res.style.color       = document.getElementById('s-ok-color').value;
  wid.style.border      = '1px solid ' + document.getElementById('s-border').value;
  wid.style.background  = document.getElementById('s-bg').value;
  inp.placeholder       = document.getElementById('s-placeholder').value || 'Enter zip code';
  document.getElementById('prev-title').textContent = document.getElementById('s-title').value || '📍 Check Delivery Availability';
}

['s-btn-label','s-title','s-placeholder','s-allow-msg','s-deny-msg'].forEach(id => {
  document.getElementById(id).addEventListener('input', updatePreview);
});

async function loadSettings() {
  try {
    const res  = await fetch(API+'/api/settings');
    const data = await res.json();
    const s    = data.settings || data || {};
    if (s.btnColor)    { document.getElementById('s-btn-color').value = s.btnColor;   document.getElementById('s-btn-color-hex').value = s.btnColor; }
    if (s.btnTxt)      { document.getElementById('s-btn-txt').value   = s.btnTxt;     document.getElementById('s-btn-txt-hex').value   = s.btnTxt; }
    if (s.okColor)     { document.getElementById('s-ok-color').value  = s.okColor;    document.getElementById('s-ok-color-hex').value  = s.okColor; }
    if (s.errColor)    { document.getElementById('s-err-color').value = s.errColor;   document.getElementById('s-err-color-hex').value = s.errColor; }
    if (s.border)      { document.getElementById('s-border').value    = s.border;     document.getElementById('s-border-hex').value    = s.border; }
    if (s.bg)          { document.getElementById('s-bg').value        = s.bg;         document.getElementById('s-bg-hex').value        = s.bg; }
    if (s.title)       document.getElementById('s-title').value       = s.title;
    if (s.btnLabel)    document.getElementById('s-btn-label').value   = s.btnLabel;
    if (s.placeholder) document.getElementById('s-placeholder').value = s.placeholder;
    if (s.allowMsg)    document.getElementById('s-allow-msg').value   = s.allowMsg;
    if (s.denyMsg)     document.getElementById('s-deny-msg').value    = s.denyMsg;
    updatePreview();
  } catch(e) {}
}

async function saveSettings() {
  const settings = {
    btnColor:    document.getElementById('s-btn-color').value,
    btnTxt:      document.getElementById('s-btn-txt').value,
    okColor:     document.getElementById('s-ok-color').value,
    errColor:    document.getElementById('s-err-color').value,
    border:      document.getElementById('s-border').value,
    bg:          document.getElementById('s-bg').value,
    title:       document.getElementById('s-title').value,
    btnLabel:    document.getElementById('s-btn-label').value,
    placeholder: document.getElementById('s-placeholder').value,
    allowMsg:    document.getElementById('s-allow-msg').value,
    denyMsg:     document.getElementById('s-deny-msg').value,
  };
  try {
    await fetch(API+'/api/settings', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({settings})
    });
    toast('💾 Settings saved!', 's');
  } catch(e) { toast('Save failed','e'); }
}

// ── Analytics ─────────────────────────────────────────────────────────────────
async function loadAnalytics() {
  try {
    const res  = await fetch(API+'/api/analytics');
    const data = await res.json();
    const rows = Array.isArray(data) ? data : (data.analytics || data.data || []);
    const el   = document.getElementById('analytics-body');
    if (!rows.length) {
      el.innerHTML = '<div class="empty"><div class="empty-icon">📊</div><p>No analytics data yet. Data is recorded as customers use the widget.</p></div>';
      return;
    }
    el.innerHTML = '<table><thead><tr><th>Zip Code</th><th>Lookups</th><th>Result</th><th>Last Checked</th></tr></thead><tbody>' +
      rows.map(r => \`<tr>
        <td class="mono">\${r.zip||'—'}</td>
        <td>\${r.count||r.lookups||1}</td>
        <td><span class="badge badge-\${r.allowed?'allow':'deny'}">\${r.allowed?'Allowed':'Denied'}</span></td>
        <td style="color:var(--gray-400);font-size:13px">\${r.lastChecked ? new Date(r.lastChecked).toLocaleDateString() : '—'}</td>
      </tr>\`).join('') + '</tbody></table>';
  } catch(e) {
    document.getElementById('analytics-body').innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><p>Could not load analytics</p></div>';
  }
}

// ── Shortcode copy ────────────────────────────────────────────────────────────
function copyCode(id) {
  const el = document.getElementById(id);
  const text = el.innerText.replace('Copy','').trim();
  navigator.clipboard.writeText(text).then(() => toast('📋 Copied!', 's'));
}

// ── Widget URL in snippets ────────────────────────────────────────────────────
document.querySelectorAll('.code-block').forEach(el => {
  el.innerHTML = el.innerHTML.replace(/WIDGET_URL/g, window.location.origin);
});

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'on ' + type;
  setTimeout(() => t.className = '', 2500);
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadRules();
updatePreview();
</script>
</body>
</html>`;

app.get("/", (req, res) => res.send(adminHTML));
app.get("/app", (req, res) => res.send(adminHTML));

// ── Widget JS (reads settings dynamically) ────────────────────────────────────
app.get("/widget.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-cache");

  // Load settings
  let settings = {};
  try {
    const { read } = require("./utils/store");
    settings = read("widget-settings") || {};
  } catch(e) {}

  const btnColor   = settings.btnColor   || "#008060";
  const btnTxt     = settings.btnTxt     || "#ffffff";
  const okColor    = settings.okColor    || "#008060";
  const errColor   = settings.errColor   || "#d72c0d";
  const border     = settings.border     || "#e4e5e7";
  const bg         = settings.bg         || "#ffffff";
  const title      = settings.title      || "📍 Check Delivery Availability";
  const btnLabel   = settings.btnLabel   || "Check";
  const placeholder= settings.placeholder|| "Enter zip code (e.g. 10001)";
  const allowMsg   = settings.allowMsg   || "Delivery available!";
  const denyMsg    = settings.denyMsg    || "Delivery not available in your area.";

  res.send(`
(function() {
  if (document.getElementById('zipcheck-widget')) return;
  var HOST = '${HOST}';
  var s = document.createElement('style');
  s.textContent = '#zipcheck-widget{font-family:-apple-system,BlinkMacSystemFont,sans-serif;margin:16px 0;padding:16px;border:1px solid ${border};border-radius:10px;background:${bg}}#zipcheck-widget .zc-label{display:block;font-weight:700;font-size:14px;margin-bottom:10px;color:#202223}#zipcheck-widget .zc-row{display:flex;gap:8px}#zipcheck-widget .zc-input{flex:1;padding:9px 12px;border:1.5px solid #c9cccf;border-radius:8px;font-size:15px;outline:none;font-family:inherit}#zipcheck-widget .zc-btn{padding:9px 18px;background:${btnColor};color:${btnTxt};border:none;border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit;font-size:14px}#zipcheck-widget .zc-btn:hover{opacity:.9}#zipcheck-widget .zc-result{margin-top:10px;font-size:14px;min-height:18px;font-weight:500}';
  document.head.appendChild(s);
  var w = document.createElement('div');
  w.id = 'zipcheck-widget';
  w.innerHTML = '<span class="zc-label">${title.replace(/'/g,"\\'")} </span><div class="zc-row"><input class="zc-input" id="zc-zip" placeholder="${placeholder.replace(/'/g,"\\'")} " maxlength="10"/><button class="zc-btn" id="zc-btn">${btnLabel.replace(/'/g,"\\'")} </button></div><div class="zc-result" id="zc-result"></div>';
  var cart = document.querySelector('[name="add"],.product-form__submit,#AddToCart,.btn--add-to-cart,[data-testid="Checkout-button"]');
  if (cart) { var f = cart.closest('form'); (f||cart).parentNode.insertBefore(w, f||cart); }
  else { var c = document.querySelector('.product__info-container,.product-single__meta,.product-form'); if(c) c.appendChild(w); }
  document.getElementById('zc-btn').onclick = async function() {
    var zip = document.getElementById('zc-zip').value.trim();
    var out = document.getElementById('zc-result');
    if(!/^\\d{5}(-\\d{4})?$/.test(zip)){out.innerHTML='<span style="color:${errColor}">⚠ Enter a valid 5-digit zip code</span>';return;}
    out.innerHTML='<span style="color:#999">Checking...</span>';
    try {
      var r = await fetch(HOST+'/api/check/lookup/'+zip);
      var d = (await r.json()).data;
      var def_ok  = '${allowMsg.replace(/'/g,"\\'")} ';
      var def_err = '${denyMsg.replace(/'/g,"\\'")} ';
      out.innerHTML = d.allowed
        ? '<span style="color:${okColor}">✅ '+(d.message||def_ok)+'</span>'
        : '<span style="color:${errColor}">🚫 '+(d.message||def_err)+'</span>';
    } catch(e){out.innerHTML='<span style="color:${errColor}">Error checking. Please try again.</span>';}
  };
  document.getElementById('zc-zip').onkeydown=function(e){if(e.key==='Enter')document.getElementById('zc-btn').click();};
})();
  `);
});

// ── Settings API (save/load widget settings) ──────────────────────────────────
app.get("/api/settings", (req, res) => {
  try {
    const { read } = require("./utils/store");
    const settings = read("widget-settings") || {};
    res.json({ settings });
  } catch(e) { res.json({ settings: {} }); }
});

app.post("/api/settings", (req, res) => {
  try {
    const { write } = require("./utils/store");
    write("widget-settings", req.body.settings || req.body);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use("/api/rules",     rulesRouter);
app.use("/api/groups",    groupsRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/check",     checkRouter);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 ZipCheck running on port ${PORT}`);
  console.log(`🔐 Install: ${HOST}/auth?shop=YOUR_STORE.myshopify.com\n`);
});
