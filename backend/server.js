// backend/server.js — ZERO external deps beyond express/cors/morgan/uuid
const express = require("express");
const cors    = require("cors");
const morgan  = require("morgan");
const crypto  = require("crypto");
const https   = require("https");   // built-in Node — no install needed

const rulesRouter     = require("./routes/rules");
const groupsRouter    = require("./routes/groups");
const analyticsRouter = require("./routes/analytics");
const checkRouter     = require("./routes/check");
const settingsRouter  = require("./routes/settings");

const app  = express();
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "https://zip-code-checker-production.up.railway.app";
const SHOPIFY_API_KEY    = process.env.SHOPIFY_API_KEY    || "";
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "";
const SCOPES             = process.env.SCOPES || "read_products,write_script_tags";

// ── Simple HTTPS POST helper (replaces axios) ─────────────────────────────────
function httpsPost(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify(data);
    const parsed  = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname,
      method:   "POST",
      headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...headers },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => {
        try { resolve({ data: JSON.parse(raw), status: res.statusCode }); }
        catch (e) { resolve({ data: raw, status: res.statusCode }); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", "frame-ancestors https://*.myshopify.com https://admin.shopify.com");
  res.removeHeader("X-Frame-Options");
  next();
});
app.use(cors({ origin: "*", credentials: true }));
app.use(morgan("dev"));
app.use(express.json());

// ── OAuth: Begin ──────────────────────────────────────────────────────────────
app.get("/auth", (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send("Missing ?shop= parameter");
  const nonce       = crypto.randomBytes(16).toString("hex");
  const redirectUri = encodeURIComponent(`${HOST}/auth/callback`);
  const url = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${redirectUri}&state=${nonce}`;
  res.redirect(url);
});

// ── OAuth: Callback ───────────────────────────────────────────────────────────
app.get("/auth/callback", async (req, res) => {
  const { shop, code } = req.query;
  if (!shop || !code) return res.status(400).send("Missing shop or code");
  try {
    // Exchange code for access token
    const tokenRes = await httpsPost(
      `https://${shop}/admin/oauth/access_token`,
      { client_id: SHOPIFY_API_KEY, client_secret: SHOPIFY_API_SECRET, code }
    );
    const accessToken = tokenRes.data.access_token;
    console.log("✅ Installed on:", shop);

    // Save session
    try {
      const { read, write } = require("./utils/store");
      const sessions = read("sessions") || {};
      sessions[shop] = { shop, accessToken, installedAt: new Date().toISOString() };
      write("sessions", sessions);
    } catch (e) { console.log("Session save:", e.message); }

    // Register widget script tag
    try {
      await httpsPost(
        `https://${shop}/admin/api/2025-01/script_tags.json`,
        { script_tag: { event: "onload", src: `${HOST}/widget.js` } },
        { "X-Shopify-Access-Token": accessToken }
      );
      console.log("✅ Script tag registered");
    } catch (e) { console.log("Script tag:", e.message); }

    res.redirect(`https://${shop}/admin/apps/${SHOPIFY_API_KEY}`);
  } catch (e) {
    console.error("❌ Auth error:", e.message);
    res.status(500).send("Installation failed: " + e.message);
  }
});

// ── Admin Dashboard ───────────────────────────────────────────────────────────
app.get("/", (req, res) => res.send(buildAdminHTML()));
app.get("/app", (req, res) => res.send(buildAdminHTML()));

// ── Widget JS ─────────────────────────────────────────────────────────────────
app.get("/widget.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-cache");
  const { read } = require("./utils/store");
  const s = (() => { try { return read("widget-settings") || {}; } catch(e) { return {}; } })();
  const btnColor = s.btnColor || "#008060";
  const btnTxt   = s.btnTxt   || "#ffffff";
  const okColor  = s.okColor  || "#008060";
  const errColor = s.errColor || "#d72c0d";
  const okMsg    = (s.okMsg  || "Delivery available!").replace(/'/g, "\\'");
  const errMsg   = (s.errMsg || "Delivery not available in your area.").replace(/'/g, "\\'");
  res.send(`(function(){
  var API='${HOST}';
  function addStyles(){if(document.getElementById('zc-styles'))return;var st=document.createElement('style');st.id='zc-styles';st.textContent='[data-zipcheck] .zc-wrap{font-family:-apple-system,BlinkMacSystemFont,sans-serif;margin:10px 0;padding:16px;border:1px solid #e4e5e7;border-radius:10px;background:#fff}[data-zipcheck] .zc-lbl{display:block;font-weight:700;font-size:14px;margin-bottom:10px;color:#1a1a1a}[data-zipcheck] .zc-row{display:flex;gap:8px;flex-wrap:wrap}[data-zipcheck] .zc-inp{flex:1;min-width:120px;padding:9px 12px;border:1.5px solid #c9cccf;border-radius:8px;font-size:15px;outline:none;font-family:inherit}[data-zipcheck] .zc-btn{padding:9px 20px;background:${btnColor};color:${btnTxt};border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer}[data-zipcheck] .zc-res{margin-top:10px;font-size:14px;min-height:18px;font-weight:500;line-height:1.5}';document.head.appendChild(st);}
  function build(el,i){addStyles();var label=el.getAttribute('data-label')||'Check Delivery Availability';var ph=el.getAttribute('data-placeholder')||'Enter zip / postal code';var btn=el.getAttribute('data-btn-text')||'Check';var ii='zci'+i,bi='zcb'+i,ri='zcr'+i;el.innerHTML='<div class="zc-wrap"><span class="zc-lbl">\\u{1F4CD} '+label+'</span><div class="zc-row"><input class="zc-inp" id="'+ii+'" placeholder="'+ph+'" maxlength="10"/><button class="zc-btn" id="'+bi+'">'+btn+'</button></div><div class="zc-res" id="'+ri+'"></div></div>';async function chk(){var zip=document.getElementById(ii).value.trim().toUpperCase(),out=document.getElementById(ri);if(!zip||zip.length<5){out.innerHTML='<span style="color:${errColor}">\\u26A0 Enter a valid zip / postal code</span>';return;}out.innerHTML='<span style="color:#999">Checking...</span>';try{var r=await fetch(API+'/api/check/lookup/'+encodeURIComponent(zip));var j=await r.json();if(!j.success){out.innerHTML='<span style="color:${errColor}">\\u26A0 '+(j.message||'Error')+'</span>';return;}var d=j.data;if(d.result==='allow'){out.innerHTML='<span style="color:${okColor}">\\u2705 '+(d.message||'${okMsg}')+'</span>';}else if(d.result==='block'||d.result==='deny'){out.innerHTML='<span style="color:${errColor}">\\u{1F6AB} '+(d.message||'${errMsg}')+'</span>';}else{out.innerHTML='<span style="color:#f59e0b">\\u2139\\uFE0F No specific rule. Please contact us.</span>';}}catch(e){out.innerHTML='<span style="color:${errColor}">Unable to check. Try again.</span>';}}document.getElementById(bi).onclick=chk;document.getElementById(ii).onkeydown=function(e){if(e.key==='Enter')chk();};}
  function init(){document.querySelectorAll('[data-zipcheck]').forEach(function(el,i){build(el,i);});}
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}else{init();}
})();`);
});

// ── iFrame embed ──────────────────────────────────────────────────────────────
app.get("/embed", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;padding:12px;background:#fff}.w{border:1px solid #e4e5e7;border-radius:10px;padding:16px}label{display:block;font-weight:700;font-size:14px;margin-bottom:10px}.row{display:flex;gap:8px;flex-wrap:wrap}input{flex:1;min-width:100px;padding:9px 12px;border:1.5px solid #c9cccf;border-radius:8px;font-size:15px;outline:none}button{padding:9px 20px;background:#008060;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer}.res{margin-top:10px;font-size:14px;min-height:18px;font-weight:500}</style></head><body><div class="w"><label>📍 Check Delivery Availability</label><div class="row"><input id="z" placeholder="Enter zip / postal code" maxlength="10"/><button onclick="chk()">Check</button></div><div class="res" id="r"></div></div><script>async function chk(){var zip=document.getElementById('z').value.trim().toUpperCase(),out=document.getElementById('r');if(!zip||zip.length<5){out.innerHTML='<span style="color:#d72c0d">Enter a valid zip code</span>';return;}out.innerHTML='<span style="color:#999">Checking...</span>';try{var r=await fetch('${HOST}/api/check/lookup/'+encodeURIComponent(zip)),d=(await r.json()).data;out.innerHTML=d.result==='allow'?'<span style="color:#008060">✅ '+(d.message||'Delivery available!')+'</span>':d.result==='block'?'<span style="color:#d72c0d">🚫 '+(d.message||'Not available.')+'</span>':'<span style="color:#f59e0b">ℹ️ Please contact us.</span>';}catch(e){out.innerHTML='<span style="color:#d72c0d">Error. Try again.</span>';}}document.getElementById('z').onkeydown=function(e){if(e.key==='Enter')chk();};<\/script></body></html>`);
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
  console.log(`🌐 Dashboard: ${HOST}`);
  console.log(`🔐 Install:   ${HOST}/auth?shop=YOUR_STORE.myshopify.com\n`);
});


// ── Admin HTML ────────────────────────────────────────────────────────────────
function buildAdminHTML() {
  const h = HOST;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Zip Code Checker</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--green:#008060;--green-lt:#e3f1ed;--green-dk:#004c3f;--red:#d72c0d;--red-lt:#fce8e3;--g900:#1a1a1a;--g700:#3d4047;--g500:#6b7280;--g300:#c9cccf;--g200:#e4e5e7;--g100:#f1f3f4;--g50:#f6f6f7;--white:#fff;--r:10px}
body{font-family:'DM Sans',sans-serif;background:var(--g50);color:var(--g900);min-height:100vh;display:flex;flex-direction:column}
.topbar{background:var(--green-dk);height:52px;display:flex;align-items:center;padding:0 20px;gap:12px;flex-shrink:0}
.topbar-icon{background:var(--green);width:30px;height:30px;border-radius:7px;display:grid;place-items:center;font-size:16px}
.topbar h1{font-size:15px;font-weight:700;color:#fff}
.shell{display:flex;flex:1;min-height:0}
.sidebar{width:210px;background:var(--white);border-right:1px solid var(--g200);padding:12px 0;flex-shrink:0;overflow-y:auto}
.nav-label{padding:6px 14px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--g300);margin-top:8px}
.nav-btn{display:flex;align-items:center;gap:9px;width:100%;padding:9px 14px;border:none;background:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:500;color:var(--g500);text-align:left;transition:all .15s}
.nav-btn:hover{background:var(--g50);color:var(--g900)}.nav-btn.active{background:var(--green-lt);color:var(--green-dk);font-weight:700}
.content{flex:1;overflow-y:auto;padding:28px}
.page{display:none}.page.active{display:block;max-width:860px}
.page-title{font-size:20px;font-weight:800;margin-bottom:4px}.page-sub{font-size:13px;color:var(--g500);margin-bottom:22px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px}
.stat{background:var(--white);border:1px solid var(--g200);border-radius:var(--r);padding:18px 20px}
.stat-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--g500);margin-bottom:6px}
.stat-val{font-size:28px;font-weight:800;font-family:'DM Mono',monospace}.stat-val.g{color:var(--green)}.stat-val.r{color:var(--red)}
.card{background:var(--white);border:1px solid var(--g200);border-radius:var(--r);margin-bottom:14px;overflow:hidden}
.card-head{padding:14px 18px;border-bottom:1px solid var(--g200);display:flex;align-items:center;gap:8px}
.card-head h2{font-size:14px;font-weight:700;flex:1}
.card-head .cnt{background:var(--g100);color:var(--g700);font-size:12px;padding:2px 8px;border-radius:20px;font-weight:600}
.form-row{padding:14px 18px;display:flex;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--g100)}
.fld{display:flex;flex-direction:column;gap:4px;flex:1;min-width:120px}
.fld label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--g500)}
.fld input,.fld select{padding:8px 11px;border:1.5px solid var(--g200);border-radius:8px;font-size:14px;font-family:'DM Sans',sans-serif;outline:none;color:var(--g900);transition:border-color .15s;background:var(--white)}
.fld input:focus,.fld select:focus{border-color:var(--green)}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;border:none;font-family:'DM Sans',sans-serif;transition:all .15s}
.btn-primary{background:var(--green);color:#fff}.btn-primary:hover{background:var(--green-dk)}
.btn-danger{background:var(--red-lt);color:var(--red)}.btn-danger:hover{background:#ffd9d3}
.btn-ghost{background:var(--g100);color:var(--g700)}.btn-ghost:hover{background:var(--g200)}
.btn-sm{padding:5px 11px;font-size:12px}
.tbl-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse}
thead tr{background:var(--g50);border-bottom:1px solid var(--g200)}
th{padding:9px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--g500);white-space:nowrap}
tbody tr{border-bottom:1px solid var(--g100)}tbody tr:last-child{border-bottom:none}tbody tr:hover{background:var(--g50)}
td{padding:10px 14px;font-size:14px}td.mono{font-family:'DM Mono',monospace;font-weight:600}
.badge{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:20px;font-size:12px;font-weight:700}
.badge-allow{background:var(--green-lt);color:var(--green-dk)}.badge-deny,.badge-block{background:var(--red-lt);color:var(--red)}
.toggle{position:relative;width:36px;height:20px;cursor:pointer;display:inline-block}
.toggle input{opacity:0;width:0;height:0}
.slider{position:absolute;inset:0;background:var(--g300);border-radius:20px;transition:.2s}
.slider::after{content:'';position:absolute;left:3px;top:3px;width:14px;height:14px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.toggle input:checked+.slider{background:var(--green)}.toggle input:checked+.slider::after{transform:translateX(16px)}
.empty{padding:40px;text-align:center;color:var(--g500)}.empty-icon{font-size:36px;margin-bottom:8px}
.code-block{background:#1a1a2e;color:#a8ff78;font-family:'DM Mono',monospace;font-size:13px;padding:16px 20px;border-radius:8px;overflow-x:auto;white-space:pre;margin:10px 0;position:relative;line-height:1.7}
.copy-btn{position:absolute;right:10px;top:10px;background:rgba(255,255,255,.12);color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:600}
.info-box{background:#fff8e1;border:1px solid #f9c74f;border-radius:8px;padding:12px 16px;font-size:13px;color:#7c5800;margin:10px 0;line-height:1.6}
.settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:18px}
.set-item{display:flex;flex-direction:column;gap:5px}
.set-item label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--g500)}
.set-item input{padding:8px 11px;border:1.5px solid var(--g200);border-radius:8px;font-size:14px;font-family:'DM Sans',sans-serif;outline:none;background:var(--white)}
.set-item input:focus{border-color:var(--green)}
.color-row{display:flex;align-items:center;gap:8px}.color-row input[type=color]{width:38px;height:34px;padding:2px;border:1.5px solid var(--g200);border-radius:6px;cursor:pointer}.color-row input[type=text]{flex:1}
.preview-wrap{padding:18px;background:var(--g50);border-top:1px solid var(--g200)}
.preview-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--g500);margin-bottom:10px}
#toast{position:fixed;bottom:20px;right:20px;background:var(--g900);color:#fff;padding:11px 18px;border-radius:8px;font-size:13px;font-weight:700;opacity:0;transform:translateY(8px);transition:all .2s;pointer-events:none;z-index:9999}
#toast.on{opacity:1;transform:translateY(0)}#toast.s{background:var(--green)}#toast.e{background:var(--red)}
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:500;align-items:center;justify-content:center}
.modal-overlay.open{display:flex}
.modal-box{background:#fff;border-radius:14px;width:min(700px,95vw);max-height:85vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3)}
@media(max-width:640px){.sidebar{display:none}.stats{grid-template-columns:1fr 1fr}.settings-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="topbar"><div class="topbar-icon">📍</div><h1>Zip Code Checker — Admin Dashboard</h1></div>
<div class="shell">
<nav class="sidebar">
  <div class="nav-label">Main</div>
  <button class="nav-btn active" onclick="nav(this,'rules')">🗺️&nbsp; Zip Rules</button>
  <button class="nav-btn" onclick="nav(this,'settings')">⚙️&nbsp; Settings</button>
  <div class="nav-label">Developer</div>
  <button class="nav-btn" onclick="nav(this,'embed')">🔗&nbsp; Embed / Shortcode</button>
  <button class="nav-btn" onclick="nav(this,'analytics')">📊&nbsp; Analytics</button>
</nav>
<main class="content">

<!-- ═══ Zip Rules Page ═══ -->
<div class="page active" id="page-rules">
  <div class="page-title">Zip Code Rules</div>
  <div class="page-sub">Add zip / postal codes and mark Allow or Deny. Widget checks these in real time.</div>
  <div class="stats">
    <div class="stat"><div class="stat-label">Total Rules</div><div class="stat-val" id="s-total">—</div></div>
    <div class="stat"><div class="stat-label">Allowed</div><div class="stat-val g" id="s-allow">—</div></div>
    <div class="stat"><div class="stat-label">Denied</div><div class="stat-val r" id="s-deny">—</div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>➕ Add New Rule</h2></div>
    <div class="form-row">
      <div class="fld" style="max-width:180px"><label>Zip / Postal Code</label><input id="f-zip" placeholder="e.g. 10001 or 400001" maxlength="10"/></div>
      <div class="fld" style="max-width:150px"><label>Type</label><select id="f-type"><option value="allow">✅ Allow</option><option value="deny">🚫 Deny</option></select></div>
      <div class="fld"><label>Custom Message (optional)</label><input id="f-msg" placeholder="e.g. Delivery in 2 days!"/></div>
      <div class="fld" style="flex:0;min-width:auto;justify-content:flex-end"><label>&nbsp;</label><button class="btn btn-primary" onclick="addRule()">Add Rule</button></div>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h2>📂 Import &amp; Export</h2></div>
    <div style="padding:14px 18px;display:flex;flex-wrap:wrap;gap:14px;align-items:center">
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--g500);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Export All</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" onclick="exportRules('csv')">⬇️ CSV</button>
          <button class="btn btn-ghost btn-sm" onclick="exportRules('xlsx')">⬇️ Excel</button>
        </div>
      </div>
      <div style="width:1px;height:36px;background:var(--g200)"></div>
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--g500);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Bulk Import</div>
        <button class="btn btn-primary btn-sm" onclick="openImport()">⬆️ Upload CSV / Excel</button>
      </div>
      <div style="margin-left:auto">
        <button class="btn btn-ghost btn-sm" onclick="downloadTemplate()">⬇️ Template</button>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-head">
      <h2>📋 All Rules</h2><span class="cnt" id="rules-cnt">0</span>
      <button class="btn btn-danger btn-sm" id="bulk-del-btn" style="display:none;margin-left:auto" onclick="bulkDelete()">🗑️ Delete Selected</button>
    </div>
    <div class="tbl-wrap"><table>
      <thead><tr>
        <th><input type="checkbox" id="sel-all" onchange="toggleAll(this)"/></th>
        <th>Zip / Postal Code</th><th>Type</th><th>Message</th><th>Enabled</th><th>Delete</th>
      </tr></thead>
      <tbody id="rules-tbody"><tr><td colspan="6"><div class="empty"><div class="empty-icon">⏳</div>Loading...</div></td></tr></tbody>
    </table></div>
  </div>
</div>

<!-- ═══ Settings Page ═══ -->
<div class="page" id="page-settings">
  <div class="page-title">Widget Settings</div>
  <div class="page-sub">Customize the widget colors and text.</div>
  <div class="card">
    <div class="card-head"><h2>🎨 Appearance</h2></div>
    <div class="settings-grid">
      <div class="set-item"><label>Button Color</label><div class="color-row"><input type="color" id="s-btn-c" value="#008060" oninput="sc('s-btn-c','s-btn-ch')"/><input type="text" id="s-btn-ch" value="#008060" maxlength="7" oninput="sh('s-btn-ch','s-btn-c')"/></div></div>
      <div class="set-item"><label>Button Text Color</label><div class="color-row"><input type="color" id="s-btxt-c" value="#ffffff" oninput="sc('s-btxt-c','s-btxt-ch')"/><input type="text" id="s-btxt-ch" value="#ffffff" maxlength="7" oninput="sh('s-btxt-ch','s-btxt-c')"/></div></div>
      <div class="set-item"><label>Success Color</label><div class="color-row"><input type="color" id="s-ok-c" value="#008060" oninput="sc('s-ok-c','s-ok-ch')"/><input type="text" id="s-ok-ch" value="#008060" maxlength="7" oninput="sh('s-ok-ch','s-ok-c')"/></div></div>
      <div class="set-item"><label>Error Color</label><div class="color-row"><input type="color" id="s-err-c" value="#d72c0d" oninput="sc('s-err-c','s-err-ch')"/><input type="text" id="s-err-ch" value="#d72c0d" maxlength="7" oninput="sh('s-err-ch','s-err-c')"/></div></div>
    </div>
    <div class="settings-grid" style="border-top:1px solid var(--g200)">
      <div class="set-item"><label>Widget Title</label><input id="s-title" value="Check Delivery Availability" oninput="upv()"/></div>
      <div class="set-item"><label>Button Text</label><input id="s-btn-lbl" value="Check" oninput="upv()"/></div>
      <div class="set-item"><label>Placeholder</label><input id="s-ph" value="Enter zip / postal code" oninput="upv()"/></div>
      <div class="set-item"><label>Allow Message</label><input id="s-ok-msg" value="Delivery available!"/></div>
      <div class="set-item"><label>Deny Message</label><input id="s-err-msg" value="Delivery not available in your area."/></div>
    </div>
    <div style="padding:0 18px 18px"><button class="btn btn-primary" onclick="saveSettings()">💾 Save Settings</button></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>👁️ Live Preview</h2></div>
    <div class="preview-wrap"><div class="preview-label">Widget Preview</div>
      <div style="max-width:400px;border:1px solid #e4e5e7;border-radius:10px;padding:16px;background:#fff">
        <div id="pv-title" style="font-weight:700;font-size:14px;margin-bottom:10px">📍 Check Delivery Availability</div>
        <div style="display:flex;gap:8px"><input id="pv-input" placeholder="Enter zip / postal code" style="flex:1;padding:9px 12px;border:1.5px solid #c9cccf;border-radius:8px;font-size:15px;outline:none" readonly/><button id="pv-btn" style="padding:9px 18px;background:#008060;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">Check</button></div>
        <div id="pv-result" style="margin-top:10px;font-size:14px;font-weight:500;color:#008060">✅ Delivery available!</div>
      </div>
    </div>
  </div>
</div>

<!-- ═══ Embed Page ═══ -->
<div class="page" id="page-embed">
  <div class="page-title">Embed &amp; Shortcode</div>
  <div class="page-sub">Add the zip checker anywhere on your store.</div>
  <div class="card"><div class="card-head"><h2>🏪 Shopify Theme (Recommended)</h2></div>
    <div style="padding:16px 18px">
      <p style="font-size:14px;color:var(--g700);margin-bottom:8px">Paste in any Liquid file — product page, cart, homepage:</p>
      <div class="code-block" id="c1"><button class="copy-btn" onclick="copyCode('c1')">Copy</button>&lt;div data-zipcheck data-label="Check Delivery" data-placeholder="Enter zip code" data-btn-text="Check"&gt;&lt;/div&gt;
&lt;script src="${h}/widget.js" async&gt;&lt;/script&gt;</div>
      <div class="info-box">💡 Widget only appears where you paste this snippet.</div>
    </div>
  </div>
  <div class="card"><div class="card-head"><h2>🌐 iFrame Embed</h2></div>
    <div style="padding:16px 18px">
      <div class="code-block" id="c2"><button class="copy-btn" onclick="copyCode('c2')">Copy</button>&lt;iframe src="${h}/embed" width="100%" height="160" frameborder="0" style="border-radius:10px;border:none"&gt;&lt;/iframe&gt;</div>
    </div>
  </div>
  <div class="card"><div class="card-head"><h2>🔌 REST API</h2></div>
    <div style="padding:16px 18px">
      <div class="code-block" id="c3"><button class="copy-btn" onclick="copyCode('c3')">Copy</button>GET ${h}/api/check/lookup/{zipcode}
Response: { "success":true, "data": { "zip":"10001","result":"allow","message":"..." } }</div>
    </div>
  </div>
</div>

<!-- ═══ Analytics Page ═══ -->
<div class="page" id="page-analytics">
  <div class="page-title">Analytics</div>
  <div class="page-sub">Every zip code check by your customers, in real time.</div>
  <div class="card">
    <div class="card-head"><h2>📊 Recent Checks</h2><button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="loadAnalytics()">↻ Refresh</button></div>
    <div id="analytics-body" style="padding:20px"><div class="empty"><div class="empty-icon">📊</div>No data yet.</div></div>
  </div>
</div>

</main>
</div><!-- end shell -->

<!-- ═══ Import Modal (outside shell) ═══ -->
<div class="modal-overlay" id="imp-modal">
  <div class="modal-box">
    <div style="padding:18px 22px;border-bottom:1px solid var(--g200);display:flex;align-items:center;gap:10px">
      <span style="font-size:18px">📥</span>
      <span style="font-size:16px;font-weight:800">Bulk Import Zip Codes</span>
      <button onclick="closeImport()" style="margin-left:auto;border:none;background:none;font-size:22px;cursor:pointer;color:var(--g500);line-height:1">&times;</button>
    </div>
    <div style="padding:20px 22px;overflow-y:auto;flex:1">
      <div id="imp-step1">
        <div style="font-size:12px;font-weight:700;color:var(--g500);text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px">Step 1 — Choose File</div>
        <div id="drop-zone" onclick="document.getElementById('file-inp').click()"
          style="border:2px dashed var(--g300);border-radius:10px;padding:40px 20px;text-align:center;cursor:pointer;transition:all .2s;background:var(--g50)"
          ondragover="event.preventDefault();this.style.borderColor='#008060';this.style.background='#e3f1ed'"
          ondragleave="this.style.borderColor='var(--g300)';this.style.background='var(--g50)'"
          ondrop="handleDrop(event)">
          <div style="font-size:36px;margin-bottom:8px">📄</div>
          <div style="font-size:15px;font-weight:700;margin-bottom:4px">Click to browse or drag &amp; drop</div>
          <div style="font-size:13px;color:var(--g500)">Supports .csv and .xlsx files up to 10MB</div>
          <input type="file" id="file-inp" accept=".csv,.xlsx,.xls" style="display:none" onchange="handleFileSelect(this.files[0])"/>
        </div>
        <div style="margin-top:12px;font-size:13px;color:var(--g500)">
          <strong>Required column:</strong> <code>ZipCode</code> &nbsp;
          <strong>Optional:</strong> <code>Type</code> (allow/deny), <code>Message</code>
        </div>
      </div>
      <div id="imp-step2" style="display:none">
        <div style="font-size:12px;font-weight:700;color:var(--g500);text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px">Step 2 — Preview &amp; Confirm</div>
        <div id="imp-summary" style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap"></div>
        <div style="margin-bottom:12px;display:flex;gap:10px;align-items:center;font-size:13px">
          <strong>Import mode:</strong>
          <label style="cursor:pointer;display:flex;align-items:center;gap:4px"><input type="radio" name="imp-mode" value="merge" checked/> Merge</label>
          <label style="cursor:pointer;display:flex;align-items:center;gap:4px"><input type="radio" name="imp-mode" value="replace"/> Replace all</label>
        </div>
        <div style="max-height:280px;overflow-y:auto;border:1px solid var(--g200);border-radius:8px">
          <table style="width:100%;border-collapse:collapse">
            <thead style="position:sticky;top:0;background:var(--g50)">
              <tr>
                <th style="padding:8px 12px;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--g500);text-align:left">Zip Code</th>
                <th style="padding:8px 12px;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--g500);text-align:left">Type</th>
                <th style="padding:8px 12px;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--g500);text-align:left">Message</th>
                <th style="padding:8px 12px;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--g500);text-align:left">Status</th>
              </tr>
            </thead>
            <tbody id="imp-preview-tbody"></tbody>
          </table>
        </div>
      </div>
    </div>
    <div style="padding:14px 22px;border-top:1px solid var(--g200);display:flex;gap:10px;justify-content:flex-end">
      <button class="btn btn-ghost" onclick="closeImport()">Cancel</button>
      <button class="btn btn-ghost" id="imp-back-btn" style="display:none" onclick="impBack()">&#8592; Back</button>
      <button class="btn btn-primary" id="imp-action-btn" onclick="impAction()">Choose File</button>
    </div>
  </div>
</div>

<div id="toast"></div>

<script>
var API = window.location.origin;
var _impRows = [];

function nav(btn, page) {
  document.querySelectorAll('.nav-btn').forEach(function(b){b.classList.remove('active');});
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  btn.classList.add('active');
  document.getElementById('page-' + page).classList.add('active');
  if (page === 'rules') loadRules();
  if (page === 'analytics') loadAnalytics();
  if (page === 'settings') loadSettings();
}

// ── Rules ──────────────────────────────────────────────────────────────────────
function loadRules() {
  fetch(API + '/api/rules')
    .then(function(r){ return r.json(); })
    .then(function(j){ renderRules(j.data || j.rules || (Array.isArray(j) ? j : [])); })
    .catch(function(){ document.getElementById('rules-tbody').innerHTML = '<tr><td colspan="6"><div class="empty"><div class="empty-icon">⚠️</div>Failed to load rules</div></td></tr>'; });
}

function renderRules(rules) {
  document.getElementById('rules-cnt').textContent = rules.length;
  document.getElementById('s-total').textContent   = rules.length;
  document.getElementById('s-allow').textContent   = rules.filter(function(r){ return r.action==='allow'; }).length;
  document.getElementById('s-deny').textContent    = rules.filter(function(r){ return r.action==='deny'||r.action==='block'; }).length;
  var tbody = document.getElementById('rules-tbody');
  if (!rules.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty"><div class="empty-icon">📭</div>No rules yet. Add your first zip code!</div></td></tr>';
    return;
  }
  var html = '';
  rules.forEach(function(r) {
    var id   = r.id || r._id;
    var zips = r.zipCodes ? r.zipCodes.join(', ') : (r.zip || r.zipCode || '—');
    var type = r.action || r.type || 'allow';
    var msg  = r.message || r.errorMessage || '—';
    var ena  = r.status === 'active' || r.enabled !== false;
    var badge = type === 'allow'
      ? '<span class="badge badge-allow">✅ Allow</span>'
      : '<span class="badge badge-deny">🚫 Deny</span>';
    var toggle = '<label class="toggle"><input type="checkbox" ' + (ena ? 'checked' : '') + ' onchange="toggleRule(\'' + id + '\')"/><span class="slider"></span></label>';
    var del = '<button class="btn btn-danger btn-sm" onclick="deleteRule(\'' + id + '\')">Delete</button>';
    html += '<tr>'
      + '<td><input type="checkbox" class="row-chk" data-id="' + id + '" onchange="onChk()"/></td>'
      + '<td class="mono">' + zips + '</td>'
      + '<td>' + badge + '</td>'
      + '<td style="color:var(--g500);font-size:13px;max-width:200px;overflow:hidden;text-overflow:ellipsis">' + msg + '</td>'
      + '<td>' + toggle + '</td>'
      + '<td>' + del + '</td>'
      + '</tr>';
  });
  tbody.innerHTML = html;
}

function addRule() {
  var zip  = document.getElementById('f-zip').value.trim();
  var type = document.getElementById('f-type').value;
  var msg  = document.getElementById('f-msg').value.trim();
  if (!zip) { toast('Enter a zip / postal code', 'e'); return; }
  if (zip.length < 5) { toast('Must be at least 5 characters', 'e'); return; }
  var body = { name: zip + ' Rule', action: type, status: 'active', zipCodes: [zip.toUpperCase()], message: type === 'allow' ? msg : '', errorMessage: type === 'deny' ? msg : '' };
  fetch(API + '/api/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function(r){ return r.json().then(function(j){ return {ok:r.ok,j:j}; }); })
    .then(function(res) {
      if (!res.ok) { toast(res.j.message || 'Failed to add rule', 'e'); return; }
      document.getElementById('f-zip').value = '';
      document.getElementById('f-msg').value = '';
      toast('✅ Rule added!', 's');
      loadRules();
    })
    .catch(function(e){ toast('Error: ' + e.message, 'e'); });
}

function deleteRule(id) {
  if (!confirm('Delete this rule?')) return;
  fetch(API + '/api/rules/' + id, { method: 'DELETE' })
    .then(function(){ toast('🗑️ Deleted', 's'); loadRules(); })
    .catch(function(){ toast('Delete failed', 'e'); });
}

function toggleRule(id) {
  fetch(API + '/api/rules/' + id + '/toggle', { method: 'PATCH' })
    .then(function(){ toast('Updated', 's'); })
    .catch(function(){ toast('Failed', 'e'); });
}

document.addEventListener('keydown', function(e) { if (e.target.id === 'f-zip' && e.key === 'Enter') addRule(); });

function onChk() {
  var checked = document.querySelectorAll('.row-chk:checked');
  var btn = document.getElementById('bulk-del-btn');
  var selAll = document.getElementById('sel-all');
  var total = document.querySelectorAll('.row-chk').length;
  btn.style.display = checked.length ? 'inline-flex' : 'none';
  btn.textContent = '🗑️ Delete ' + checked.length + ' selected';
  selAll.indeterminate = checked.length > 0 && checked.length < total;
  selAll.checked = checked.length === total && total > 0;
}

function toggleAll(cb) {
  document.querySelectorAll('.row-chk').forEach(function(el){ el.checked = cb.checked; });
  onChk();
}

function bulkDelete() {
  var ids = Array.from(document.querySelectorAll('.row-chk:checked')).map(function(el){ return el.dataset.id; });
  if (!ids.length) return;
  if (!confirm('Delete ' + ids.length + ' rules?')) return;
  Promise.all(ids.map(function(id){ return fetch(API + '/api/rules/' + id, { method: 'DELETE' }); }))
    .then(function(){ toast('🗑️ ' + ids.length + ' rules deleted', 's'); loadRules(); });
}

// ── Export ─────────────────────────────────────────────────────────────────────
function exportRules(format) {
  var a = document.createElement('a');
  a.href = API + '/api/rules/export/download?format=' + format;
  a.download = 'zipcode-rules.' + format;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast('📥 Downloading ' + format.toUpperCase() + '...', 's');
}

function downloadTemplate() {
  var csv = 'ZipCode,Type,Message\n10001,allow,Delivery available!\n90210,deny,We do not deliver to this area.';
  var blob = new Blob([csv], { type: 'text/csv' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'zipcode-import-template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast('📄 Template downloaded', 's');
}

// ── Import Modal ───────────────────────────────────────────────────────────────
function openImport() {
  document.getElementById('imp-modal').classList.add('open');
}

function closeImport() {
  document.getElementById('imp-modal').classList.remove('open');
  document.getElementById('imp-step1').style.display = 'block';
  document.getElementById('imp-step2').style.display = 'none';
  document.getElementById('imp-action-btn').textContent = 'Choose File';
  document.getElementById('imp-back-btn').style.display = 'none';
  document.getElementById('file-inp').value = '';
  _impRows = [];
}

function impBack() {
  document.getElementById('imp-step1').style.display = 'block';
  document.getElementById('imp-step2').style.display = 'none';
  document.getElementById('imp-action-btn').textContent = 'Choose File';
  document.getElementById('imp-back-btn').style.display = 'none';
  _impRows = [];
}

function handleDrop(e) {
  e.preventDefault();
  var dz = document.getElementById('drop-zone');
  dz.style.borderColor = 'var(--g300)';
  dz.style.background = 'var(--g50)';
  var file = e.dataTransfer.files[0];
  if (file) handleFileSelect(file);
}

function handleFileSelect(file) {
  if (!file) return;
  toast('🔍 Parsing file...', '');
  var fd = new FormData();
  fd.append('file', file);
  fetch(API + '/api/rules/import/preview', { method: 'POST', body: fd })
    .then(function(r){ return r.json(); })
    .then(function(j) {
      if (!j.success) { toast(j.message || 'Parse failed', 'e'); return; }
      _impRows = j.data;
      showPreview(j);
    })
    .catch(function(e){ toast('Upload failed: ' + e.message, 'e'); });
}

function showPreview(j) {
  document.getElementById('imp-step1').style.display = 'none';
  document.getElementById('imp-step2').style.display = 'block';
  document.getElementById('imp-action-btn').textContent = '✅ Import Now';
  document.getElementById('imp-back-btn').style.display = 'inline-flex';
  var valid   = j.data.filter(function(r){ return r.valid; }).length;
  var invalid = j.data.filter(function(r){ return !r.valid; }).length;
  var dupes   = j.data.filter(function(r){ return r.duplicate; }).length;
  document.getElementById('imp-summary').innerHTML =
    '<span style="background:var(--green-lt);color:var(--green-dk);padding:6px 12px;border-radius:8px;font-size:13px;font-weight:700">✅ ' + valid + ' valid</span>'
    + (invalid ? '<span style="background:var(--red-lt);color:var(--red);padding:6px 12px;border-radius:8px;font-size:13px;font-weight:700">⚠️ ' + invalid + ' invalid</span>' : '')
    + (dupes ? '<span style="background:#fff8e1;color:#7c5800;padding:6px 12px;border-radius:8px;font-size:13px;font-weight:700">🔁 ' + dupes + ' duplicates</span>' : '')
    + '<span style="background:var(--g100);color:var(--g700);padding:6px 12px;border-radius:8px;font-size:13px;font-weight:700">📋 ' + j.total + ' total</span>';
  var html = '';
  j.data.slice(0, 200).forEach(function(r) {
    var bg = !r.valid ? 'background:#fff0ee' : r.duplicate ? 'background:#fffde7' : '';
    var status = !r.valid ? '<span style="color:var(--red)">⚠ Invalid</span>'
      : r.duplicate ? '<span style="color:#7c5800">🔁 Duplicate</span>'
      : '<span style="color:var(--green)">✅ New</span>';
    html += '<tr style="border-bottom:1px solid var(--g100);' + bg + '">'
      + '<td style="padding:7px 12px;font-family:\'DM Mono\',monospace;font-size:13px">' + (r.zip || '—') + '</td>'
      + '<td style="padding:7px 12px"><span class="badge badge-' + r.type + '">' + r.type + '</span></td>'
      + '<td style="padding:7px 12px;font-size:12px;color:var(--g500)">' + (r.message || '—') + '</td>'
      + '<td style="padding:7px 12px;font-size:12px">' + status + '</td>'
      + '</tr>';
  });
  document.getElementById('imp-preview-tbody').innerHTML = html;
}

function impAction() {
  if (_impRows.length === 0) { document.getElementById('file-inp').click(); return; }
  var mode = document.querySelector('input[name="imp-mode"]:checked') ? document.querySelector('input[name="imp-mode"]:checked').value : 'merge';
  var validRows = _impRows.filter(function(r){ return r.valid; });
  if (!validRows.length) { toast('No valid rows to import', 'e'); return; }
  fetch(API + '/api/rules/import/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: validRows, mode: mode })
  })
    .then(function(r){ return r.json(); })
    .then(function(j) {
      if (!j.success) { toast(j.message || 'Import failed', 'e'); return; }
      toast('✅ Imported ' + j.added + ' zip codes!' + (j.skipped ? ' (' + j.skipped + ' skipped)' : ''), 's');
      closeImport();
      loadRules();
    })
    .catch(function(e){ toast('Import error: ' + e.message, 'e'); });
}

// ── Settings ───────────────────────────────────────────────────────────────────
function sc(cId, hId) { document.getElementById(hId).value = document.getElementById(cId).value; upv(); }
function sh(hId, cId) { var v = document.getElementById(hId).value; if (/^#[0-9a-f]{6}$/i.test(v)) { document.getElementById(cId).value = v; upv(); } }
function upv() {
  document.getElementById('pv-btn').style.background = document.getElementById('s-btn-c').value;
  document.getElementById('pv-btn').style.color = document.getElementById('s-btxt-c').value;
  document.getElementById('pv-btn').textContent = document.getElementById('s-btn-lbl').value || 'Check';
  document.getElementById('pv-result').style.color = document.getElementById('s-ok-c').value;
  document.getElementById('pv-input').placeholder = document.getElementById('s-ph').value || 'Enter zip code';
  document.getElementById('pv-title').textContent = '📍 ' + (document.getElementById('s-title').value || 'Check Delivery Availability');
}

function loadSettings() {
  fetch(API + '/api/settings')
    .then(function(r){ return r.json(); })
    .then(function(j) {
      var s = j.data || j.settings || j || {};
      if (s.btnColor) { document.getElementById('s-btn-c').value = s.btnColor; document.getElementById('s-btn-ch').value = s.btnColor; }
      if (s.btnTxt)   { document.getElementById('s-btxt-c').value = s.btnTxt; document.getElementById('s-btxt-ch').value = s.btnTxt; }
      if (s.okColor)  { document.getElementById('s-ok-c').value = s.okColor; document.getElementById('s-ok-ch').value = s.okColor; }
      if (s.errColor) { document.getElementById('s-err-c').value = s.errColor; document.getElementById('s-err-ch').value = s.errColor; }
      upv();
    }).catch(function(){});
}

function saveSettings() {
  var s = {
    btnColor: document.getElementById('s-btn-c').value,
    btnTxt:   document.getElementById('s-btxt-c').value,
    okColor:  document.getElementById('s-ok-c').value,
    errColor: document.getElementById('s-err-c').value,
    widgetLabel:       document.getElementById('s-title').value,
    widgetPlaceholder: document.getElementById('s-ph').value,
    okMsg:    document.getElementById('s-ok-msg').value,
    errMsg:   document.getElementById('s-err-msg').value
  };
  fetch(API + '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) })
    .then(function(){ toast('💾 Saved!', 's'); })
    .catch(function(){ toast('Save failed', 'e'); });
}

// ── Analytics ──────────────────────────────────────────────────────────────────
function loadAnalytics() {
  var el = document.getElementById('analytics-body');
  el.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div>Loading...</div>';
  fetch(API + '/api/analytics/recent?limit=50')
    .then(function(r){ return r.json(); })
    .then(function(j) {
      var rows = j.data || [];
      if (!rows.length) { el.innerHTML = '<div class="empty"><div class="empty-icon">📊</div>No checks yet. Place the widget on your store!</div>'; return; }
      var html = '<table><thead><tr><th>Zip</th><th>Result</th><th>Rule</th><th>Time</th></tr></thead><tbody>';
      rows.forEach(function(r) {
        html += '<tr>'
          + '<td class="mono">' + r.zip + '</td>'
          + '<td><span class="badge badge-' + r.result + '">' + r.result + '</span></td>'
          + '<td style="color:var(--g500);font-size:13px">' + (r.ruleName || '—') + '</td>'
          + '<td style="color:var(--g500);font-size:12px">' + new Date(r.timestamp).toLocaleString() + '</td>'
          + '</tr>';
      });
      el.innerHTML = html + '</tbody></table>';
    })
    .catch(function(){ el.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div>Could not load analytics</div>'; });
}

// ── Copy code blocks ───────────────────────────────────────────────────────────
function copyCode(id) {
  var el = document.getElementById(id);
  var t = el.innerText.replace(/^Copy/, '').trim();
  navigator.clipboard.writeText(t).then(function(){ toast('📋 Copied!', 's'); });
}

// ── Toast ──────────────────────────────────────────────────────────────────────
function toast(msg, type) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'on ' + (type || '');
  setTimeout(function(){ t.className = ''; }, 2800);
}

// ── Init ───────────────────────────────────────────────────────────────────────
loadRules();
upv();
</script>
</body>
</html>`;
}
