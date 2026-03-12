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
const HOST = process.env.HOST || "https://zipcheck-app-production.up.railway.app";
const SHOPIFY_API_KEY    = process.env.SHOPIFY_API_KEY    || "";
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "";
const SCOPES             = process.env.SCOPES || "read_products,write_script_tags";

// ── Simple HTTPS POST helper ──────────────────────────────────────────────────
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

// ── App Status API ────────────────────────────────────────────────────────────
let appActive = true;
app.get("/api/app-status", (req, res) => res.json({ active: appActive }));
app.post("/api/app-status", (req, res) => {
  if (typeof req.body.active === "boolean") appActive = req.body.active;
  res.json({ active: appActive });
});

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
    const tokenRes = await httpsPost(
      `https://${shop}/admin/oauth/access_token`,
      { client_id: SHOPIFY_API_KEY, client_secret: SHOPIFY_API_SECRET, code }
    );
    const accessToken = tokenRes.data.access_token;
    console.log("✅ Installed on:", shop);
    try {
      const { read, write } = require("./utils/store");
      const sessions = read("sessions") || {};
      sessions[shop] = { shop, accessToken, installedAt: new Date().toISOString() };
      write("sessions", sessions);
    } catch (e) { console.log("Session save:", e.message); }
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
  if(!${appActive})return;
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
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Zip Code Checker</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --green:#00a67e;--green-lt:#e6f7f2;--green-dk:#007a5e;--green-xdk:#005c47;
  --red:#e53e3e;--red-lt:#fff0f0;--red-dk:#c53030;
  --purple:#7c3aed;--purple-lt:#f3f0ff;
  --blue:#2563eb;--blue-lt:#eff6ff;
  --amber:#d97706;--amber-lt:#fffbeb;
  --g900:#111827;--g800:#1f2937;--g700:#374151;--g600:#4b5563;--g500:#6b7280;
  --g400:#9ca3af;--g300:#d1d5db;--g200:#e5e7eb;--g100:#f3f4f6;--g50:#f9fafb;
  --white:#ffffff;--r:10px;--r-lg:14px;
  --font:'Inter',sans-serif;--mono:'JetBrains Mono',monospace;
  --shadow-sm:0 1px 3px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.06);
  --shadow:0 4px 6px -1px rgba(0,0,0,.07),0 2px 4px -1px rgba(0,0,0,.05);
  --shadow-lg:0 10px 25px -3px rgba(0,0,0,.1),0 4px 6px -2px rgba(0,0,0,.05);
}
body{font-family:var(--font);background:var(--g50);color:var(--g900);height:100vh;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased;overflow:hidden}

/* ── SIDEBAR ── */
.app-shell{display:flex;flex:1;overflow:hidden}
.sidebar{width:230px;background:var(--white);border-right:1px solid var(--g200);display:flex;flex-direction:column;flex-shrink:0;overflow-y:auto}
.sidebar-brand{padding:18px 16px 14px;border-bottom:1px solid var(--g100);display:flex;align-items:center;gap:10px}
.brand-icon{width:34px;height:34px;background:linear-gradient(135deg,var(--green),var(--green-dk));border-radius:9px;display:grid;place-items:center;font-size:18px;flex-shrink:0;box-shadow:0 2px 8px rgba(0,166,126,.3)}
.brand-name{font-size:14px;font-weight:700;color:var(--g900);line-height:1.2}
.brand-sub{font-size:11px;color:var(--g500);font-weight:400}
.sidebar-nav{flex:1;padding:10px 8px}
.nav-section{margin-bottom:4px}
.nav-section-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--g400);padding:8px 8px 4px}
.nav-btn{display:flex;align-items:center;gap:9px;width:100%;padding:8px 10px;border:none;background:none;cursor:pointer;font-family:var(--font);font-size:13px;font-weight:500;color:var(--g600);text-align:left;transition:all .15s;border-radius:8px;margin-bottom:1px}
.nav-btn:hover{background:var(--g50);color:var(--g900)}
.nav-btn.active{background:var(--green-lt);color:var(--green-dk);font-weight:600}
.nav-btn .nav-icon{width:18px;text-align:center;font-size:14px;flex-shrink:0}
.nav-badge{margin-left:auto;background:var(--green);color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px}
.sidebar-footer{padding:10px 8px 14px;border-top:1px solid var(--g100)}
.app-status-pill{display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:8px;background:var(--g50);border:1px solid var(--g200)}
.status-dot{width:8px;height:8px;border-radius:50%;background:var(--green);flex-shrink:0;box-shadow:0 0 0 2px rgba(0,166,126,.25)}
.status-dot.off{background:var(--g400);box-shadow:none}
.status-text{font-size:12px;font-weight:600;color:var(--g700);flex:1}
.status-toggle{position:relative;width:32px;height:18px;cursor:pointer;display:inline-block;flex-shrink:0}
.status-toggle input{opacity:0;width:0;height:0}
.status-slider{position:absolute;inset:0;background:var(--g300);border-radius:20px;transition:.2s;cursor:pointer}
.status-slider::after{content:'';position:absolute;left:2px;top:2px;width:14px;height:14px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.status-toggle input:checked+.status-slider{background:var(--green)}
.status-toggle input:checked+.status-slider::after{transform:translateX(14px)}

/* ── MAIN CONTENT ── */
.content{flex:1;overflow-y:auto;padding:28px 32px}
.page{display:none}.page.active{display:block;max-width:880px}
.page-header{margin-bottom:24px}
.page-title{font-size:22px;font-weight:800;color:var(--g900);letter-spacing:-.4px}
.page-sub{font-size:13px;color:var(--g500);margin-top:3px}

/* ── STATS ── */
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px}
.stat{background:var(--white);border:1px solid var(--g200);border-radius:var(--r-lg);padding:18px 20px;box-shadow:var(--shadow-sm)}
.stat-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--g500);margin-bottom:8px}
.stat-val{font-size:30px;font-weight:800;font-family:var(--mono);letter-spacing:-.5px}
.stat-val.g{color:var(--green)}.stat-val.r{color:var(--red)}.stat-val.b{color:var(--blue)}

/* ── CARDS ── */
.card{background:var(--white);border:1px solid var(--g200);border-radius:var(--r-lg);margin-bottom:16px;overflow:hidden;box-shadow:var(--shadow-sm)}
.card-head{padding:14px 20px;border-bottom:1px solid var(--g100);display:flex;align-items:center;gap:10px}
.card-head h2{font-size:14px;font-weight:700;flex:1;color:var(--g800)}
.card-head .cnt{background:var(--g100);color:var(--g600);font-size:11px;padding:2px 8px;border-radius:20px;font-weight:600}

/* ── FORMS ── */
.form-row{padding:16px 20px;display:flex;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--g100)}
.fld{display:flex;flex-direction:column;gap:5px;flex:1;min-width:120px}
.fld label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--g500)}
.fld input,.fld select{padding:9px 12px;border:1.5px solid var(--g200);border-radius:8px;font-size:14px;font-family:var(--font);outline:none;color:var(--g900);transition:border-color .15s;background:var(--white);box-shadow:var(--shadow-sm)}
.fld input:focus,.fld select:focus{border-color:var(--green);box-shadow:0 0 0 3px rgba(0,166,126,.1)}

/* ── BUTTONS ── */
.btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none;font-family:var(--font);transition:all .15s;white-space:nowrap}
.btn-primary{background:var(--green);color:#fff;box-shadow:0 1px 3px rgba(0,166,126,.4)}.btn-primary:hover{background:var(--green-dk);transform:translateY(-1px)}
.btn-danger{background:var(--red-lt);color:var(--red)}.btn-danger:hover{background:#ffe0e0}
.btn-ghost{background:var(--g50);color:var(--g700);border:1px solid var(--g200)}.btn-ghost:hover{background:var(--g100)}
.btn-purple{background:var(--purple);color:#fff}.btn-purple:hover{opacity:.9}
.btn-sm{padding:6px 12px;font-size:12px}

/* ── TABLE ── */
.tbl-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse}
thead tr{background:var(--g50);border-bottom:2px solid var(--g200)}
th{padding:10px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--g500);white-space:nowrap}
tbody tr{border-bottom:1px solid var(--g100)}tbody tr:last-child{border-bottom:none}tbody tr:hover{background:var(--g50)}
td{padding:11px 16px;font-size:13.5px}td.mono{font-family:var(--mono);font-weight:600;font-size:13px}
.badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700}
.badge-allow{background:var(--green-lt);color:var(--green-dk)}.badge-deny,.badge-block{background:var(--red-lt);color:var(--red-dk)}

/* ── TOGGLE ── */
.toggle{position:relative;width:36px;height:20px;cursor:pointer;display:inline-block}
.toggle input{opacity:0;width:0;height:0}
.slider{position:absolute;inset:0;background:var(--g300);border-radius:20px;transition:.2s}
.slider::after{content:'';position:absolute;left:3px;top:3px;width:14px;height:14px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.toggle input:checked+.slider{background:var(--green)}.toggle input:checked+.slider::after{transform:translateX(16px)}

/* ── EMPTY ── */
.empty{padding:48px;text-align:center;color:var(--g400)}.empty-icon{font-size:40px;margin-bottom:10px}
.empty p{font-size:14px;font-weight:500}

/* ── CODE ── */
.code-block{background:#0f172a;color:#7dd3fc;font-family:var(--mono);font-size:12.5px;padding:18px 20px;border-radius:10px;overflow-x:auto;white-space:pre;margin:10px 0;position:relative;line-height:1.8;border:1px solid #1e293b}
.copy-btn{position:absolute;right:10px;top:10px;background:rgba(255,255,255,.1);color:#94a3b8;border:none;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:var(--font);font-weight:600;transition:all .15s}
.copy-btn:hover{background:rgba(255,255,255,.2);color:#fff}
.info-box{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;font-size:13px;color:#92400e;margin:10px 0;line-height:1.6}

/* ── SETTINGS WIDGET LAYOUT ── */
.settings-layout{display:grid;grid-template-columns:1fr 340px;gap:20px;padding:20px}
.settings-left{}
.settings-section{margin-bottom:20px}
.settings-section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--g500);margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--g100)}
.settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.set-item{display:flex;flex-direction:column;gap:5px}
.set-item label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--g600)}
.set-item input[type=text],.set-item input:not([type=color]){padding:9px 12px;border:1.5px solid var(--g200);border-radius:8px;font-size:13.5px;font-family:var(--font);outline:none;background:var(--white);transition:border-color .15s;box-shadow:var(--shadow-sm)}
.set-item input:focus{border-color:var(--green);box-shadow:0 0 0 3px rgba(0,166,126,.1)}
.color-row{display:flex;align-items:center;gap:8px}
.color-row input[type=color]{width:40px;height:36px;padding:2px;border:1.5px solid var(--g200);border-radius:8px;cursor:pointer;box-shadow:var(--shadow-sm)}
.color-row input[type=text]{flex:1}
.settings-preview-sticky{position:sticky;top:0}
.preview-card{background:var(--white);border:1px solid var(--g200);border-radius:var(--r-lg);overflow:hidden;box-shadow:var(--shadow)}
.preview-card-head{padding:12px 16px;background:var(--g50);border-bottom:1px solid var(--g200);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--g500)}
.preview-card-body{padding:20px}
.preview-widget{border:1px solid var(--g200);border-radius:10px;padding:16px;background:#fff}

/* ── FAQ ── */
.faq-item{border:1px solid var(--g200);border-radius:var(--r);margin-bottom:10px;overflow:hidden;transition:all .2s}
.faq-q{width:100%;padding:15px 18px;background:var(--white);border:none;cursor:pointer;font-family:var(--font);font-size:14px;font-weight:600;color:var(--g800);text-align:left;display:flex;align-items:center;justify-content:space-between;gap:12px;transition:background .15s}
.faq-q:hover{background:var(--g50)}
.faq-q.open{background:var(--green-lt);color:var(--green-dk)}
.faq-arrow{font-size:12px;transition:transform .2s;color:var(--g400)}
.faq-q.open .faq-arrow{transform:rotate(180deg);color:var(--green)}
.faq-a{display:none;padding:14px 18px;font-size:14px;color:var(--g600);line-height:1.7;border-top:1px solid var(--g200);background:var(--g50)}
.faq-a.open{display:block}

/* ── PRICING ── */
.pricing-toggle{display:flex;align-items:center;gap:14px;margin-bottom:28px;justify-content:center}
.pricing-toggle-label{font-size:15px;font-weight:600;color:var(--g700)}
.pricing-toggle-label.active{color:var(--g900)}
.billing-toggle{position:relative;width:50px;height:26px;cursor:pointer;display:inline-block}
.billing-toggle input{opacity:0;width:0;height:0}
.billing-slider{position:absolute;inset:0;background:var(--green);border-radius:20px;transition:.2s}
.billing-slider::after{content:'';position:absolute;left:4px;top:4px;width:18px;height:18px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.billing-toggle input:checked+.billing-slider::after{transform:translateX(24px)}
.save-badge{background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;border:1px solid #fde68a}
.plans-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px}
.plan-card{background:var(--white);border:2px solid var(--g200);border-radius:16px;padding:24px 20px;position:relative;transition:all .2s}
.plan-card:hover{border-color:var(--g300);box-shadow:var(--shadow)}
.plan-card.popular{border-color:var(--green);box-shadow:0 0 0 1px var(--green),var(--shadow-lg)}
.plan-popular-badge{position:absolute;top:-13px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#ff6b6b,#ee0979);color:#fff;font-size:11px;font-weight:700;padding:4px 14px;border-radius:20px;white-space:nowrap}
.plan-enterprise-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--purple);margin-bottom:4px}
.plan-name{font-size:20px;font-weight:800;color:var(--g900);margin-bottom:6px}
.plan-desc{font-size:12px;color:var(--g500);margin-bottom:16px;line-height:1.5;min-height:36px}
.plan-price{display:flex;align-items:flex-end;gap:2px;margin-bottom:4px}
.plan-currency{font-size:16px;font-weight:700;color:var(--g700);line-height:1.8}
.plan-amount{font-size:36px;font-weight:800;color:var(--g900);line-height:1;letter-spacing:-1px}
.plan-period{font-size:13px;color:var(--g500);line-height:2.2}
.plan-billed{font-size:11px;color:var(--g400);margin-bottom:16px;min-height:16px}
.plan-btn{width:100%;padding:10px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;border:none;font-family:var(--font);transition:all .15s;margin-bottom:20px}
.plan-btn-free{background:transparent;color:var(--green);border:2px solid var(--green)}.plan-btn-free:hover{background:var(--green-lt)}
.plan-btn-basic{background:#4dabf7;color:#fff}.plan-btn-basic:hover{background:#339af0}
.plan-btn-starter{background:linear-gradient(135deg,#f093fb,#ee0979);color:#fff;box-shadow:0 4px 15px rgba(238,9,121,.3)}.plan-btn-starter:hover{opacity:.9;transform:translateY(-1px)}
.plan-btn-pro{background:var(--purple);color:#fff}.plan-btn-pro:hover{opacity:.9}
.plan-features{list-style:none;display:flex;flex-direction:column;gap:8px}
.plan-features li{font-size:12.5px;color:var(--g700);display:flex;align-items:flex-start;gap:8px;line-height:1.4}
.plan-features li .fi{flex-shrink:0;margin-top:1px}
.plan-features li.disabled{color:var(--g400);text-decoration:line-through}
.plan-divider{border:none;border-top:1px solid var(--g100);margin:14px 0}

/* ── TOAST ── */
#toast{position:fixed;bottom:24px;right:24px;background:var(--g900);color:#fff;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:600;opacity:0;transform:translateY(10px);transition:all .25s;pointer-events:none;z-index:9999;box-shadow:var(--shadow-lg)}
#toast.on{opacity:1;transform:translateY(0)}#toast.s{background:var(--green)}#toast.e{background:var(--red)}

/* ── MODAL ── */
.modal-ov{display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:500;align-items:center;justify-content:center;backdrop-filter:blur(2px)}
.modal-ov.open{display:flex}
.modal-box{background:#fff;border-radius:16px;width:min(680px,95vw);max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 25px 60px rgba(0,0,0,.3)}

/* ── RESPONSIVE ── */
@media(max-width:900px){.plans-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:640px){.sidebar{display:none}.stats{grid-template-columns:1fr 1fr}.settings-layout{grid-template-columns:1fr}.plans-grid{grid-template-columns:1fr}}
</style></head><body>
<div class="app-shell">

<!-- ═══ SIDEBAR ═══ -->
<nav class="sidebar">
  <div class="sidebar-brand">
    <div class="brand-icon">📍</div>
    <div><div class="brand-name">ZipCheck</div><div class="brand-sub">Admin Dashboard</div></div>
  </div>
  <div class="sidebar-nav">
    <div class="nav-section">
      <div class="nav-section-label">Main</div>
      <button class="nav-btn active" onclick="nav(this,'rules')"><span class="nav-icon">🗺️</span> Zip Rules</button>
      <button class="nav-btn" onclick="nav(this,'settings')"><span class="nav-icon">⚙️</span> Settings</button>
      <button class="nav-btn" onclick="nav(this,'analytics')"><span class="nav-icon">📊</span> Analytics</button>
    </div>
    <div class="nav-section">
      <div class="nav-section-label">Developer</div>
      <button class="nav-btn" onclick="nav(this,'embed')"><span class="nav-icon">🔗</span> Embed / Shortcode</button>
    </div>
    <div class="nav-section">
      <div class="nav-section-label">Account</div>
      <button class="nav-btn" onclick="nav(this,'pricing')"><span class="nav-icon">💳</span> Pricing Plans</button>
      <button class="nav-btn" onclick="nav(this,'faq')"><span class="nav-icon">❓</span> FAQ</button>
    </div>
  </div>
  <div class="sidebar-footer">
    <div class="app-status-pill">
      <div class="status-dot" id="status-dot"></div>
      <span class="status-text" id="status-text">App Active</span>
      <label class="status-toggle">
        <input type="checkbox" id="app-toggle" checked onchange="toggleApp(this.checked)"/>
        <span class="status-slider"></span>
      </label>
    </div>
  </div>
</nav>

<!-- ═══ MAIN CONTENT ═══ -->
<main class="content">

<!-- ZIP RULES PAGE -->
<div class="page active" id="page-rules">
  <div class="page-header">
    <div class="page-title">Zip Code Rules</div>
    <div class="page-sub">Add zip / postal codes and mark Allow or Deny. Widget checks these in real time.</div>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-label">Total Rules</div><div class="stat-val b" id="s-total">—</div></div>
    <div class="stat"><div class="stat-label">Allowed</div><div class="stat-val g" id="s-allow">—</div></div>
    <div class="stat"><div class="stat-label">Denied</div><div class="stat-val r" id="s-deny">—</div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>➕ Add New Rule</h2></div>
    <div class="form-row">
      <div class="fld" style="max-width:170px"><label>Zip / Postal Code</label><input id="f-zip" placeholder="e.g. 10001" maxlength="10"/></div>
      <div class="fld" style="max-width:150px"><label>Type</label><select id="f-type"><option value="allow">✅ Allow</option><option value="deny">🚫 Deny</option></select></div>
      <div class="fld"><label>Custom Message (optional)</label><input id="f-msg" placeholder="e.g. Delivery in 2 days!"/></div>
      <div class="fld" style="flex:0;min-width:auto;justify-content:flex-end"><label>&nbsp;</label><button class="btn btn-primary" onclick="addRule()">Add Rule</button></div>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h2>📂 Import &amp; Export</h2></div>
    <div style="padding:16px 20px;display:flex;flex-wrap:wrap;gap:14px;align-items:center">
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--g500);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Export All</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" onclick="exportRules('csv')">⬇️ CSV</button>
          <button class="btn btn-ghost btn-sm" onclick="exportRules('xlsx')">⬇️ Excel</button>
        </div>
      </div>
      <div style="width:1px;height:36px;background:var(--g200)"></div>
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--g500);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Bulk Import</div>
        <button class="btn btn-primary btn-sm" onclick="openImport()">⬆️ Upload CSV / Excel</button>
      </div>
      <div style="margin-left:auto">
        <button class="btn btn-ghost btn-sm" onclick="dlTemplate()">⬇️ Template CSV</button>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h2>📋 All Rules</h2><span class="cnt" id="rules-cnt">0</span></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Zip / Postal Code</th><th>Type</th><th>Message</th><th>Enabled</th><th>Delete</th></tr></thead>
      <tbody id="rules-tbody"><tr><td colspan="5"><div class="empty"><div class="empty-icon">⏳</div><p>Loading...</p></div></td></tr></tbody>
    </table></div>
  </div>
</div>

<!-- SETTINGS PAGE -->
<div class="page" id="page-settings">
  <div class="page-header">
    <div class="page-title">Widget Settings</div>
    <div class="page-sub">All changes are reflected live on the widget preview and your storefront.</div>
  </div>
  <div class="card">
    <div class="card-head"><h2>Widget Configuration</h2><button class="btn btn-primary btn-sm" onclick="saveSettings()">💾 Save Settings</button></div>
    <div class="settings-layout">
      <div class="settings-left">
        <div class="settings-section">
          <div class="settings-section-title">🎨 Colors</div>
          <div class="settings-grid">
            <div class="set-item"><label>Button Color</label><div class="color-row"><input type="color" id="s-btn-c" value="#008060" oninput="sc('s-btn-c','s-btn-ch');upv()"/><input type="text" id="s-btn-ch" value="#008060" maxlength="7" oninput="sh('s-btn-ch','s-btn-c');upv()"/></div></div>
            <div class="set-item"><label>Button Text Color</label><div class="color-row"><input type="color" id="s-btxt-c" value="#ffffff" oninput="sc('s-btxt-c','s-btxt-ch');upv()"/><input type="text" id="s-btxt-ch" value="#ffffff" maxlength="7" oninput="sh('s-btxt-ch','s-btxt-c');upv()"/></div></div>
            <div class="set-item"><label>Success Color</label><div class="color-row"><input type="color" id="s-ok-c" value="#008060" oninput="sc('s-ok-c','s-ok-ch');upv()"/><input type="text" id="s-ok-ch" value="#008060" maxlength="7" oninput="sh('s-ok-ch','s-ok-c');upv()"/></div></div>
            <div class="set-item"><label>Error Color</label><div class="color-row"><input type="color" id="s-err-c" value="#d72c0d" oninput="sc('s-err-c','s-err-ch');upv()"/><input type="text" id="s-err-ch" value="#d72c0d" maxlength="7" oninput="sh('s-err-ch','s-err-c');upv()"/></div></div>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-title">📝 Text & Labels</div>
          <div class="settings-grid">
            <div class="set-item"><label>Widget Title</label><input type="text" id="s-title" value="Check Delivery Availability" oninput="upv()"/></div>
            <div class="set-item"><label>Button Text</label><input type="text" id="s-btn-lbl" value="Check" oninput="upv()"/></div>
            <div class="set-item"><label>Placeholder</label><input type="text" id="s-ph" value="Enter zip / postal code" oninput="upv()"/></div>
            <div class="set-item"><label>Allow Message</label><input type="text" id="s-ok-msg" value="Delivery available!" oninput="upv()"/></div>
            <div class="set-item" style="grid-column:span 2"><label>Deny Message</label><input type="text" id="s-err-msg" value="Delivery not available in your area." oninput="upv()"/></div>
          </div>
        </div>
      </div>
      <div class="settings-preview-sticky">
        <div class="preview-card">
          <div class="preview-card-head">👁️ Live Preview</div>
          <div class="preview-card-body">
            <div class="preview-widget">
              <div id="pv-title" style="font-weight:700;font-size:14px;margin-bottom:12px;color:#1a1a1a">📍 Check Delivery Availability</div>
              <div style="display:flex;gap:8px;margin-bottom:10px">
                <input id="pv-input" placeholder="Enter zip / postal code" style="flex:1;padding:9px 12px;border:1.5px solid #c9cccf;border-radius:8px;font-size:14px;outline:none;font-family:inherit" readonly/>
                <button id="pv-btn" style="padding:9px 16px;background:#008060;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap;transition:all .2s">Check</button>
              </div>
              <div id="pv-result" style="font-size:13px;font-weight:600;color:#008060">✅ <span id="pv-ok-msg">Delivery available!</span></div>
              <div id="pv-err" style="font-size:13px;font-weight:600;color:#d72c0d;margin-top:4px">🚫 <span id="pv-err-msg">Delivery not available in your area.</span></div>
            </div>
            <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--g100)">
              <div style="font-size:11px;font-weight:600;color:var(--g400);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Changes take effect after Save</div>
              <div style="font-size:12px;color:var(--g500);line-height:1.5">Colors and text update in real-time on your live store once saved.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ANALYTICS PAGE -->
<div class="page" id="page-analytics">
  <div class="page-header">
    <div class="page-title">Analytics</div>
    <div class="page-sub">Every zip code check by your customers, in real time.</div>
  </div>
  <div class="card">
    <div class="card-head"><h2>📊 Recent Checks</h2><button class="btn btn-ghost btn-sm" onclick="loadAnalytics()">↻ Refresh</button></div>
    <div id="analytics-body" style="padding:20px"><div class="empty"><div class="empty-icon">📊</div><p>Loading...</p></div></div>
  </div>
</div>

<!-- EMBED PAGE -->
<div class="page" id="page-embed">
  <div class="page-header">
    <div class="page-title">Embed &amp; Shortcode</div>
    <div class="page-sub">Add the zip checker anywhere. You control placement — no auto-injection.</div>
  </div>
  <div class="card"><div class="card-head"><h2>🏪 Shopify Theme (Recommended)</h2></div>
    <div style="padding:16px 20px">
      <p style="font-size:14px;color:var(--g700);margin-bottom:10px">Paste in any Liquid file — product page, cart, homepage:</p>
      <div class="code-block" id="c1"><button class="copy-btn" onclick="cc('c1')">Copy</button>&lt;div data-zipcheck
  data-label="Check Delivery Availability"
  data-placeholder="Enter zip / postal code"
  data-btn-text="Check"&gt;
&lt;/div&gt;
&lt;script src="${HOST}/widget.js" async&gt;&lt;/script&gt;</div>
      <div class="info-box">💡 Widget only appears where you paste this. It will NOT auto-insert anywhere.</div>
    </div>
  </div>
  <div class="card"><div class="card-head"><h2>🌐 iFrame — Any Website</h2></div>
    <div style="padding:16px 20px">
      <div class="code-block" id="c2"><button class="copy-btn" onclick="cc('c2')">Copy</button>&lt;iframe src="${HOST}/embed" width="100%" height="160" frameborder="0" style="border-radius:10px;border:none"&gt;&lt;/iframe&gt;</div>
    </div>
  </div>
  <div class="card"><div class="card-head"><h2>📝 WordPress Shortcode</h2></div>
    <div style="padding:16px 20px">
      <p style="font-size:14px;color:var(--g700);margin-bottom:10px">Add to <code style="background:var(--g100);padding:2px 6px;border-radius:4px;font-family:var(--mono);font-size:12px">functions.php</code>, then use <code style="background:var(--g100);padding:2px 6px;border-radius:4px;font-family:var(--mono);font-size:12px">[zipcheck]</code> in any page:</p>
      <div class="code-block" id="c3"><button class="copy-btn" onclick="cc('c3')">Copy</button>function zipcheck_widget() {
  return '&lt;div data-zipcheck&gt;&lt;/div&gt;&lt;script src="${HOST}/widget.js" async&gt;&lt;/script&gt;';
}
add_shortcode('zipcheck', 'zipcheck_widget');</div>
    </div>
  </div>
  <div class="card"><div class="card-head"><h2>🔌 REST API</h2></div>
    <div style="padding:16px 20px">
      <div class="code-block" id="c4"><button class="copy-btn" onclick="cc('c4')">Copy</button>GET ${HOST}/api/check/lookup/{zipcode}

// Allowed: { "data": { "zip":"10001","result":"allow","allowed":true,"message":"..." } }
// Blocked: { "data": { "zip":"90210","result":"block","allowed":false,"message":"..." } }</div>
    </div>
  </div>
</div>

<!-- PRICING PAGE -->
<div class="page" id="page-pricing">
  <div class="page-header">
    <div class="page-title">Pricing Plans</div>
    <div class="page-sub">Choose the plan that fits your store. All paid plans include a 3-day free trial.</div>
  </div>
  <div class="pricing-toggle">
    <span class="pricing-toggle-label active" id="lbl-monthly">Monthly</span>
    <label class="billing-toggle">
      <input type="checkbox" id="billing-toggle" onchange="switchBilling(this.checked)"/>
      <span class="billing-slider"></span>
    </label>
    <span class="pricing-toggle-label" id="lbl-yearly">Yearly</span>
    <span class="save-badge">Save 20%</span>
  </div>
  <div class="plans-grid">
    <!-- FREE -->
    <div class="plan-card">
      <div class="plan-name">Free</div>
      <div class="plan-desc">Get started with basic zip code validation</div>
      <div class="plan-price"><span class="plan-currency">$</span><span class="plan-amount">0</span></div>
      <div class="plan-billed">&nbsp;</div>
      <button class="plan-btn plan-btn-free" onclick="selectPlan('free')">Get Started Free</button>
      <hr class="plan-divider"/>
      <ul class="plan-features">
        <li><span class="fi">✅</span> Inline widget (product page)</li>
        <li><span class="fi">✅</span> Up to 50 zip codes (manual)</li>
        <li><span class="fi">✅</span> Real-time validation</li>
        <li><span class="fi">✅</span> Disable Add to Cart (invalid)</li>
        <li><span class="fi">✅</span> Global zip code formats</li>
        <li><span class="fi">✅</span> Basic button color editor</li>
        <li class="disabled"><span class="fi">✗</span> Popup / Header Bar modes</li>
        <li class="disabled"><span class="fi">✗</span> Bulk CSV upload</li>
      </ul>
    </div>
    <!-- BASIC -->
    <div class="plan-card">
      <div class="plan-name">Basic</div>
      <div class="plan-desc">For small stores ready to grow their reach</div>
      <div class="plan-price"><span class="plan-currency">$</span><span class="plan-amount" id="p-basic">4.99</span><span class="plan-period">/mo</span></div>
      <div class="plan-billed" id="b-basic">&nbsp;</div>
      <button class="plan-btn plan-btn-basic" onclick="selectPlan('basic')">Start 3-Day Free Trial</button>
      <hr class="plan-divider"/>
      <ul class="plan-features">
        <li><span class="fi">✅</span> Inline + Popup widget modes</li>
        <li><span class="fi">✅</span> Up to 500 zip codes</li>
        <li><span class="fi">✅</span> Whitelist + Blacklist</li>
        <li><span class="fi">✅</span> Custom status messages</li>
        <li><span class="fi">✅</span> Full widget design editor</li>
        <li><span class="fi">✅</span> Collection-specific rules</li>
        <li><span class="fi">✅</span> Email support</li>
        <li class="disabled"><span class="fi">✗</span> CSV bulk upload</li>
      </ul>
    </div>
    <!-- STARTER (Popular) -->
    <div class="plan-card popular">
      <div class="plan-popular-badge">⭐ Most Popular</div>
      <div class="plan-name">Starter</div>
      <div class="plan-desc">Advanced ZIP Validation for Growing Stores</div>
      <div class="plan-price"><span class="plan-currency">$</span><span class="plan-amount" id="p-starter">9.99</span><span class="plan-period">/mo</span></div>
      <div class="plan-billed" id="b-starter">&nbsp;</div>
      <button class="plan-btn plan-btn-starter" onclick="selectPlan('starter')">Start 3-Day Free Trial</button>
      <hr class="plan-divider"/>
      <ul class="plan-features">
        <li><span class="fi">✅</span> Inline + Popup + Header Bar</li>
        <li><span class="fi">✅</span> Up to 5,000 zip codes</li>
        <li><span class="fi">✅</span> Bulk CSV upload &amp; export</li>
        <li><span class="fi">✅</span> Ranges &amp; wildcard patterns</li>
        <li><span class="fi">✅</span> Product-specific rules</li>
        <li><span class="fi">✅</span> Dynamic placeholders</li>
        <li><span class="fi">✅</span> Icon / no-icon mode</li>
        <li><span class="fi">✅</span> Chat &amp; email support</li>
      </ul>
    </div>
    <!-- PRO -->
    <div class="plan-card">
      <div class="plan-enterprise-label">ENTERPRISE</div>
      <div class="plan-name">Pro</div>
      <div class="plan-desc">Full power for high-volume &amp; multi-region stores</div>
      <div class="plan-price"><span class="plan-currency">$</span><span class="plan-amount" id="p-pro">14.99</span><span class="plan-period">/mo</span></div>
      <div class="plan-billed" id="b-pro">&nbsp;</div>
      <button class="plan-btn plan-btn-pro" onclick="selectPlan('pro')">Start 3-Day Free Trial</button>
      <hr class="plan-divider"/>
      <ul class="plan-features">
        <li><span class="fi">✅</span> Everything in Starter</li>
        <li><span class="fi">✅</span> Unlimited zip codes</li>
        <li><span class="fi">✅</span> Live Preview design editor</li>
        <li><span class="fi">✅</span> Rule priority management</li>
        <li><span class="fi">✅</span> Incremental CSV updates</li>
        <li><span class="fi">✅</span> Up to 3 stores</li>
        <li><span class="fi">✅</span> Priority support (chat + email)</li>
      </ul>
    </div>
  </div>
</div>

<!-- FAQ PAGE -->
<div class="page" id="page-faq">
  <div class="page-header">
    <div class="page-title">Frequently Asked Questions</div>
    <div class="page-sub">Everything you need to know about the Zip Code Checker app.</div>
  </div>
  <div id="faq-list">
    <div class="faq-item">
      <button class="faq-q" onclick="toggleFaq(this)">
        <span>How does the Zip Code Checker widget work?</span>
        <span class="faq-arrow">▼</span>
      </button>
      <div class="faq-a">The widget is a small snippet of code you embed on your Shopify store. When a customer enters their zip or postal code, it instantly checks against your allow/deny rules and shows a real-time delivery availability message — without any page reload.</div>
    </div>
    <div class="faq-item">
      <button class="faq-q" onclick="toggleFaq(this)">
        <span>How do I add or import zip codes?</span>
        <span class="faq-arrow">▼</span>
      </button>
      <div class="faq-a">You can add zip codes manually one at a time using the form in the Zip Rules tab. For bulk uploads, use the Import feature which supports both CSV and Excel (.xlsx) files. Your file needs at least a <code style="background:var(--g100);padding:1px 5px;border-radius:4px;font-family:var(--mono);font-size:12px">ZipCode</code> column — you can also include <code style="background:var(--g100);padding:1px 5px;border-radius:4px;font-family:var(--mono);font-size:12px">Type</code> (allow/deny) and <code style="background:var(--g100);padding:1px 5px;border-radius:4px;font-family:var(--mono);font-size:12px">Message</code> columns.</div>
    </div>
    <div class="faq-item">
      <button class="faq-q" onclick="toggleFaq(this)">
        <span>Will the widget slow down my store?</span>
        <span class="faq-arrow">▼</span>
      </button>
      <div class="faq-a">No. The widget script loads asynchronously, meaning it never blocks your page from rendering. The zip code check itself is a lightweight API call that typically responds in under 100ms. Your store's performance is not affected.</div>
    </div>
    <div class="faq-item">
      <button class="faq-q" onclick="toggleFaq(this)">
        <span>Can I customize the widget colors and text?</span>
        <span class="faq-arrow">▼</span>
      </button>
      <div class="faq-a">Yes, fully. Go to the Settings tab to customize the button color, button text color, success/error colors, widget title, placeholder text, button label, and the allow/deny messages. All changes are reflected live on your storefront the moment you save.</div>
    </div>
    <div class="faq-item">
      <button class="faq-q" onclick="toggleFaq(this)">
        <span>What happens if a zip code isn't in my list?</span>
        <span class="faq-arrow">▼</span>
      </button>
      <div class="faq-a">If a customer enters a zip code that doesn't match any of your rules, the widget displays a neutral message saying "No specific rule. Please contact us." — so you never leave a customer confused. You can always add more rules or use wildcard patterns (on the Starter plan and above) to cover ranges.</div>
    </div>
    <div class="faq-item">
      <button class="faq-q" onclick="toggleFaq(this)">
        <span>How do I temporarily deactivate the app?</span>
        <span class="faq-arrow">▼</span>
      </button>
      <div class="faq-a">Use the App Active toggle at the bottom of the left sidebar. When deactivated, the widget will stop loading on your storefront immediately — no code removal needed. Simply toggle it back on to re-enable it. Your rules and settings are preserved throughout.</div>
    </div>
  </div>
</div>

</main>
</div>

<!-- IMPORT MODAL -->
<div class="modal-ov" id="imp-modal">
  <div class="modal-box">
    <div style="padding:16px 20px;border-bottom:1px solid var(--g200);display:flex;align-items:center;gap:10px">
      <span style="font-size:18px">📥</span><span style="font-size:15px;font-weight:800;flex:1">Bulk Import Zip Codes</span>
      <button onclick="closeImport()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--g500);line-height:1">&times;</button>
    </div>
    <div style="padding:18px 20px;overflow-y:auto;flex:1">
      <div id="imp-s1">
        <div style="font-size:12px;font-weight:700;color:var(--g500);text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px">Step 1 — Choose File</div>
        <div id="drop-zone" onclick="document.getElementById('file-inp').click()"
          style="border:2px dashed var(--g300);border-radius:10px;padding:36px 20px;text-align:center;cursor:pointer;transition:all .2s;background:var(--g50)"
          ondragover="event.preventDefault();this.style.borderColor='var(--green)';this.style.background='var(--green-lt)'"
          ondragleave="this.style.borderColor='var(--g300)';this.style.background='var(--g50)'"
          ondrop="handleDrop(event)">
          <div style="font-size:34px;margin-bottom:8px">📄</div>
          <div style="font-size:15px;font-weight:700;margin-bottom:4px">Click to browse or drag &amp; drop</div>
          <div style="font-size:13px;color:var(--g500)">Supports .csv and .xlsx files</div>
          <input type="file" id="file-inp" accept=".csv,.xlsx,.xls" style="display:none" onchange="handleFile(this.files[0])"/>
        </div>
        <div style="margin-top:10px;font-size:13px;color:var(--g500)"><strong>Required column:</strong> <code style="background:var(--g100);padding:1px 5px;border-radius:4px;font-family:var(--mono);font-size:12px">ZipCode</code> &nbsp; <strong>Optional:</strong> <code style="background:var(--g100);padding:1px 5px;border-radius:4px;font-family:var(--mono);font-size:12px">Type</code> (allow/deny), <code style="background:var(--g100);padding:1px 5px;border-radius:4px;font-family:var(--mono);font-size:12px">Message</code></div>
      </div>
      <div id="imp-s2" style="display:none">
        <div style="font-size:12px;font-weight:700;color:var(--g500);text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px">Step 2 — Preview &amp; Confirm</div>
        <div id="imp-summary" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"></div>
        <div style="margin-bottom:12px;display:flex;gap:10px;align-items:center;font-size:13px">
          <strong>Mode:</strong>
          <label style="cursor:pointer;display:flex;align-items:center;gap:4px"><input type="radio" name="imp-mode" value="merge" checked/> Merge (keep existing)</label>
          <label style="cursor:pointer;display:flex;align-items:center;gap:4px"><input type="radio" name="imp-mode" value="replace"/> Replace all</label>
        </div>
        <div style="max-height:260px;overflow-y:auto;border:1px solid var(--g200);border-radius:8px">
          <table style="width:100%;border-collapse:collapse">
            <thead style="position:sticky;top:0;background:var(--g50)">
              <tr>
                <th style="padding:7px 12px;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--g500);text-align:left">Zip</th>
                <th style="padding:7px 12px;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--g500);text-align:left">Type</th>
                <th style="padding:7px 12px;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--g500);text-align:left">Message</th>
                <th style="padding:7px 12px;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--g500);text-align:left">Status</th>
              </tr>
            </thead>
            <tbody id="imp-tbody"></tbody>
          </table>
        </div>
      </div>
    </div>
    <div style="padding:12px 20px;border-top:1px solid var(--g200);display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-ghost" onclick="closeImport()">Cancel</button>
      <button class="btn btn-ghost" id="imp-back" style="display:none" onclick="impBack()">&#8592; Back</button>
      <button class="btn btn-primary" id="imp-action" onclick="impAction()">Choose File</button>
    </div>
  </div>
</div>

<div id="toast"></div>
<script>
const API=window.location.origin;

// ── NAV ──
function nav(btn,page){
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('page-'+page).classList.add('active');
  if(page==='rules')loadRules();
  if(page==='analytics')loadAnalytics();
  if(page==='settings')loadSettings();
}

// ── APP TOGGLE ──
async function toggleApp(active){
  try{
    const r=await fetch(API+'/api/app-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({active})});
    const j=await r.json();
    const dot=document.getElementById('status-dot');
    const txt=document.getElementById('status-text');
    if(j.active){dot.className='status-dot';txt.textContent='App Active';toast('✅ App activated','s');}
    else{dot.className='status-dot off';txt.textContent='App Inactive';toast('⏸️ App deactivated','');}
  }catch(e){toast('Failed to update status','e');}
}

// ── RULES ──
async function loadRules(){
  try{const r=await fetch(API+'/api/rules');const j=await r.json();renderRules(j.data||j.rules||(Array.isArray(j)?j:[]));}
  catch(e){document.getElementById('rules-tbody').innerHTML='<tr><td colspan="5"><div class="empty"><div class="empty-icon">⚠️</div><p>Failed to load rules</p></div></td></tr>';}
}
function renderRules(rules){
  document.getElementById('rules-cnt').textContent=rules.length;
  document.getElementById('s-total').textContent=rules.length;
  document.getElementById('s-allow').textContent=rules.filter(r=>r.action==='allow'||r.type==='allow').length;
  document.getElementById('s-deny').textContent=rules.filter(r=>r.action==='deny'||r.action==='block'||r.type==='deny').length;
  const tbody=document.getElementById('rules-tbody');
  if(!rules.length){tbody.innerHTML='<tr><td colspan="5"><div class="empty"><div class="empty-icon">📭</div><p>No rules yet. Add your first zip code!</p></div></td></tr>';return;}
  tbody.innerHTML=rules.map(r=>{
    const id=r.id||r._id;
    const zip=r.zip||r.zipCode||(r.zipCodes&&r.zipCodes[0])||'—';
    const type=r.action||r.type||'allow';
    const msg=r.message||r.errorMessage||'—';
    const ena=r.status==='active'||r.enabled!==false;
    return \`<tr><td class="mono">\${zip}</td><td><span class="badge badge-\${type}">\${type==='allow'?'✅ Allow':'🚫 Deny'}</span></td><td style="color:var(--g600);font-size:13px">\${msg}</td><td><label class="toggle"><input type="checkbox" \${ena?'checked':''} onchange="toggleRule('\${id}',this.checked)"/><span class="slider"></span></label></td><td><button class="btn btn-danger btn-sm" onclick="deleteRule('\${id}')">Delete</button></td></tr>\`;
  }).join('');
}
async function addRule(){
  const zip=document.getElementById('f-zip').value.trim();
  const type=document.getElementById('f-type').value;
  const msg=document.getElementById('f-msg').value.trim();
  if(!zip){toast('Enter a zip / postal code','e');return;}
  if(zip.length<5){toast('Must be at least 5 characters','e');return;}
  try{
    const body={name:zip+' Rule',action:type,status:'active',zipCodes:[zip.toUpperCase()],message:type==='allow'?msg:'',errorMessage:type==='deny'?msg:''};
    const r=await fetch(API+'/api/rules',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json();
    if(!r.ok){toast(j.message||'Failed','e');return;}
    document.getElementById('f-zip').value='';document.getElementById('f-msg').value='';
    toast('✅ Rule added!','s');loadRules();
  }catch(e){toast('Error: '+e.message,'e');}
}
async function deleteRule(id){if(!confirm('Delete this rule?'))return;await fetch(API+'/api/rules/'+id,{method:'DELETE'});toast('🗑️ Deleted','s');loadRules();}
async function toggleRule(id){try{await fetch(API+'/api/rules/'+id+'/toggle',{method:'PATCH'});toast('Updated','s');}catch(e){toast('Failed','e');}}
document.addEventListener('keydown',e=>{if(e.target.id==='f-zip'&&e.key==='Enter')addRule();});

// ── SETTINGS ──
function sc(cId,hId){document.getElementById(hId).value=document.getElementById(cId).value;}
function sh(hId,cId){const v=document.getElementById(hId).value;if(/^#[0-9a-f]{6}$/i.test(v))document.getElementById(cId).value=v;}
function upv(){
  const btn=document.getElementById('s-btn-c').value;
  const btxt=document.getElementById('s-btxt-c').value;
  const ok=document.getElementById('s-ok-c').value;
  const err=document.getElementById('s-err-c').value;
  const title=document.getElementById('s-title').value||'Check Delivery Availability';
  const ph=document.getElementById('s-ph').value||'Enter zip / postal code';
  const lbl=document.getElementById('s-btn-lbl').value||'Check';
  const okMsg=document.getElementById('s-ok-msg').value||'Delivery available!';
  const errMsg=document.getElementById('s-err-msg').value||'Delivery not available in your area.';
  document.getElementById('pv-btn').style.background=btn;
  document.getElementById('pv-btn').style.color=btxt;
  document.getElementById('pv-btn').textContent=lbl;
  document.getElementById('pv-result').style.color=ok;
  document.getElementById('pv-err').style.color=err;
  document.getElementById('pv-input').placeholder=ph;
  document.getElementById('pv-title').textContent='📍 '+title;
  document.getElementById('pv-ok-msg').textContent=okMsg;
  document.getElementById('pv-err-msg').textContent=errMsg;
}
async function loadSettings(){
  try{
    const r=await fetch(API+'/api/settings');const j=await r.json();const s=j.data||j.settings||j||{};
    if(s.btnColor){document.getElementById('s-btn-c').value=s.btnColor;document.getElementById('s-btn-ch').value=s.btnColor;}
    if(s.btnTxt){document.getElementById('s-btxt-c').value=s.btnTxt;document.getElementById('s-btxt-ch').value=s.btnTxt;}
    if(s.okColor){document.getElementById('s-ok-c').value=s.okColor;document.getElementById('s-ok-ch').value=s.okColor;}
    if(s.errColor){document.getElementById('s-err-c').value=s.errColor;document.getElementById('s-err-ch').value=s.errColor;}
    if(s.widgetLabel)document.getElementById('s-title').value=s.widgetLabel;
    if(s.widgetPlaceholder)document.getElementById('s-ph').value=s.widgetPlaceholder;
    if(s.okMsg)document.getElementById('s-ok-msg').value=s.okMsg;
    if(s.errMsg)document.getElementById('s-err-msg').value=s.errMsg;
    upv();
  }catch(e){}
}
async function saveSettings(){
  const s={btnColor:document.getElementById('s-btn-c').value,btnTxt:document.getElementById('s-btxt-c').value,okColor:document.getElementById('s-ok-c').value,errColor:document.getElementById('s-err-c').value,widgetLabel:document.getElementById('s-title').value,widgetPlaceholder:document.getElementById('s-ph').value,okMsg:document.getElementById('s-ok-msg').value,errMsg:document.getElementById('s-err-msg').value};
  try{await fetch(API+'/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)});toast('💾 Settings saved!','s');}
  catch(e){toast('Failed to save','e');}
}

// ── ANALYTICS ──
async function loadAnalytics(){
  const el=document.getElementById('analytics-body');
  try{
    const r=await fetch(API+'/api/analytics/recent?limit=50');const j=await r.json();const rows=j.data||[];
    if(!rows.length){el.innerHTML='<div class="empty"><div class="empty-icon">📊</div><p>No checks yet. Place the widget on your store!</p></div>';return;}
    el.innerHTML='<table><thead><tr><th>Zip</th><th>Result</th><th>Rule</th><th>Time</th></tr></thead><tbody>'+rows.map(r=>\`<tr><td class="mono">\${r.zip}</td><td><span class="badge badge-\${r.result}">\${r.result}</span></td><td style="color:var(--g500);font-size:13px">\${r.ruleName||'—'}</td><td style="color:var(--g500);font-size:12px">\${new Date(r.timestamp).toLocaleString()}</td></tr>\`).join('')+'</tbody></table>';
  }catch(e){el.innerHTML='<div class="empty"><div class="empty-icon">⚠️</div><p>Could not load analytics</p></div>';}
}

// ── PRICING ──
const PRICES={monthly:{basic:4.99,starter:9.99,pro:14.99},yearly:{basic:3.99,starter:7.99,pro:11.99}};
const YEARLY_BILLED={basic:47.88,starter:95.88,pro:143.88};
let billingMode='monthly';
function switchBilling(isYearly){
  billingMode=isYearly?'yearly':'monthly';
  document.getElementById('lbl-monthly').classList.toggle('active',!isYearly);
  document.getElementById('lbl-yearly').classList.toggle('active',isYearly);
  ['basic','starter','pro'].forEach(plan=>{
    const p=PRICES[billingMode][plan];
    document.getElementById('p-'+plan).textContent=p.toFixed(2);
    const bEl=document.getElementById('b-'+plan);
    if(isYearly){bEl.textContent='Billed $'+YEARLY_BILLED[plan]+'/year';}
    else{bEl.innerHTML='&nbsp;';}
  });
}
function selectPlan(plan){
  const names={free:'Free',basic:'Basic',starter:'Starter',pro:'Pro'};
  toast('🚀 Starting '+names[plan]+' plan trial...','s');
}

// ── FAQ ──
function toggleFaq(btn){
  const ans=btn.nextElementSibling;
  const isOpen=btn.classList.contains('open');
  document.querySelectorAll('.faq-q').forEach(b=>{b.classList.remove('open');b.nextElementSibling.classList.remove('open');});
  if(!isOpen){btn.classList.add('open');ans.classList.add('open');}
}

// ── UTILS ──
function cc(id){const el=document.getElementById(id);const t=el.innerText.replace(/^Copy/,'').trim();navigator.clipboard.writeText(t).then(()=>toast('📋 Copied!','s'));}
function toast(msg,type=''){const t=document.getElementById('toast');t.textContent=msg;t.className='on '+(type||'');setTimeout(()=>t.className='',2500);}
function exportRules(fmt){var a=document.createElement('a');a.href=API+'/api/rules/export/download?format='+fmt;a.download='zipcode-rules.'+fmt;document.body.appendChild(a);a.click();document.body.removeChild(a);toast('📥 Downloading '+fmt.toUpperCase()+'...','s');}
function dlTemplate(){var csv='ZipCode,Type,Message\\n10001,allow,Delivery in 2 days!\\n90210,deny,Sorry, no delivery here.';var b=new Blob([csv.replace(/\\\\n/g,'\\n')],{type:'text/csv'});var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='import-template.csv';document.body.appendChild(a);a.click();document.body.removeChild(a);toast('📄 Template downloaded','s');}

// ── IMPORT ──
var _rows=[];
function openImport(){document.getElementById('imp-modal').classList.add('open');}
function closeImport(){document.getElementById('imp-modal').classList.remove('open');document.getElementById('imp-s1').style.display='block';document.getElementById('imp-s2').style.display='none';document.getElementById('imp-action').textContent='Choose File';document.getElementById('imp-back').style.display='none';document.getElementById('file-inp').value='';_rows=[];}
function impBack(){document.getElementById('imp-s1').style.display='block';document.getElementById('imp-s2').style.display='none';document.getElementById('imp-action').textContent='Choose File';document.getElementById('imp-back').style.display='none';_rows=[];}
function handleDrop(e){e.preventDefault();var dz=document.getElementById('drop-zone');dz.style.borderColor='var(--g300)';dz.style.background='var(--g50)';var f=e.dataTransfer.files[0];if(f)handleFile(f);}
function handleFile(f){if(!f)return;toast('🔍 Parsing...','');var fd=new FormData();fd.append('file',f);fetch(API+'/api/rules/import/preview',{method:'POST',body:fd}).then(function(r){return r.json();}).then(function(j){if(!j.success){toast(j.message||'Parse failed','e');return;}_rows=j.data;showPreview(j);}).catch(function(e){toast('Upload failed: '+e.message,'e');});}
function showPreview(j){document.getElementById('imp-s1').style.display='none';document.getElementById('imp-s2').style.display='block';document.getElementById('imp-action').textContent='✅ Import Now';document.getElementById('imp-back').style.display='inline-flex';var valid=j.data.filter(function(r){return r.valid;}).length;var inv=j.data.filter(function(r){return !r.valid;}).length;var dup=j.data.filter(function(r){return r.duplicate;}).length;document.getElementById('imp-summary').innerHTML='<span style="background:var(--green-lt);color:var(--green-dk);padding:5px 10px;border-radius:8px;font-size:12px;font-weight:700">✅ '+valid+' valid</span>'+(inv?'<span style="background:var(--red-lt);color:var(--red);padding:5px 10px;border-radius:8px;font-size:12px;font-weight:700">⚠️ '+inv+' invalid</span>':'')+(dup?'<span style="background:#fff8e1;color:#7c5800;padding:5px 10px;border-radius:8px;font-size:12px;font-weight:700">🔁 '+dup+' dupes</span>':'')+'<span style="background:var(--g100);color:var(--g700);padding:5px 10px;border-radius:8px;font-size:12px;font-weight:700">📋 '+j.total+' total</span>';var html='';j.data.slice(0,200).forEach(function(r){var bg=!r.valid?'background:#fff0ee':r.duplicate?'background:#fffde7':'';var st=!r.valid?'<span style="color:var(--red)">⚠ Invalid</span>':r.duplicate?'<span style="color:#7c5800">🔁 Dup</span>':'<span style="color:var(--green)">✅ New</span>';html+='<tr style="border-bottom:1px solid var(--g100);'+bg+'">'+'<td style="padding:6px 12px;font-family:var(--mono);font-size:13px">'+(r.zip||'—')+'</td>'+'<td style="padding:6px 12px"><span class="badge badge-'+(r.type||'allow')+'">'+(r.type||'allow')+'</span></td>'+'<td style="padding:6px 12px;font-size:12px;color:var(--g500)">'+(r.message||'—')+'</td>'+'<td style="padding:6px 12px;font-size:12px">'+st+'</td>'+'</tr>';});document.getElementById('imp-tbody').innerHTML=html;}
function impAction(){if(_rows.length===0){document.getElementById('file-inp').click();return;}var mode=document.querySelector('input[name="imp-mode"]:checked');mode=mode?mode.value:'merge';var valid=_rows.filter(function(r){return r.valid;});if(!valid.length){toast('No valid rows','e');return;}fetch(API+'/api/rules/import/commit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows:valid,mode:mode})}).then(function(r){return r.json();}).then(function(j){if(!j.success){toast(j.message||'Import failed','e');return;}toast('✅ Imported '+j.added+' rules'+(j.skipped?' ('+j.skipped+' skipped)':''),'s');closeImport();loadRules();}).catch(function(e){toast('Error: '+e.message,'e');});}

// ── INIT ──
loadRules();upv();
</script></body></html>`;
}
