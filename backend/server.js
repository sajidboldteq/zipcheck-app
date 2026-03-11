// backend/server.js
const express = require("express");
const cors    = require("cors");
const morgan  = require("morgan");
const { shopifyApi, LATEST_API_VERSION, LogSeverity } = require("@shopify/shopify-api");
require("@shopify/shopify-api/adapters/node");

const rulesRouter     = require("./routes/rules");
const groupsRouter    = require("./routes/groups");
const analyticsRouter = require("./routes/analytics");
const checkRouter     = require("./routes/check");
const settingsRouter  = require("./routes/settings");

const app  = express();
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "https://zip-code-checker-production.up.railway.app";

// ── Shopify Setup ─────────────────────────────────────────────────────────────
const shopify = shopifyApi({
  apiKey:        process.env.SHOPIFY_API_KEY    || "",
  apiSecretKey:  process.env.SHOPIFY_API_SECRET || "",
  scopes:        (process.env.SCOPES || "read_products,write_script_tags").split(","),
  hostName:      HOST.replace(/https?:\/\//, ""),
  apiVersion:    LATEST_API_VERSION,
  isEmbeddedApp: true,
  logger:        { level: LogSeverity.Info },
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: "*", credentials: true }));
app.use(morgan("dev"));
app.use(express.json());

// ── Shopify OAuth ─────────────────────────────────────────────────────────────
app.get("/auth", async (req, res) => {
  try {
    await shopify.auth.begin({
      shop:         shopify.utils.sanitizeShop(req.query.shop, true),
      callbackPath: "/auth/callback",
      isOnline:     false,
      rawRequest:   req,
      rawResponse:  res,
    });
  } catch (e) {
    console.error("Auth error:", e);
    res.status(500).send("Auth failed: " + e.message);
  }
});

app.get("/auth/callback", async (req, res) => {
  try {
    const callback = await shopify.auth.callback({ rawRequest: req, rawResponse: res });
    const session  = callback.session;
    console.log("✅ Installed on:", session.shop);

    // Save session
    const { read, write } = require("./utils/store");
    const sessions = read("sessions") || {};
    sessions[session.shop] = { shop: session.shop, accessToken: session.accessToken, installedAt: new Date().toISOString() };
    write("sessions", sessions);

    // Register widget script tag
    try {
      const client = new shopify.clients.Rest({ session });
      await client.post({ path: "script_tags", data: { script_tag: { event: "onload", src: `${HOST}/widget.js` } } });
      console.log("✅ Widget script tag registered");
    } catch (e) { console.log("Script tag:", e.message); }

    res.redirect(`https://${session.shop}/admin/apps/${shopify.config.apiKey}`);
  } catch (e) {
    console.error("Callback error:", e);
    res.status(500).send("Callback failed: " + e.message);
  }
});

// ── Widget JS — only renders in containers with data-zipcheck attribute ────────
// Fix #4: Does NOT auto-inject above Add to Cart anymore
// Fix #5: Use <div data-zipcheck></div> anywhere in theme to embed
app.get("/widget.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.send(`
(function() {
  var API = '${HOST}';

  var css = '#zc-wrap{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:16px 0;padding:16px;border:1px solid #e4e5e7;border-radius:10px;background:#fff}' +
    '#zc-wrap label{display:block;font-weight:700;font-size:14px;margin-bottom:8px;color:#1a1a1a}' +
    '.zc-row{display:flex;gap:8px;flex-wrap:wrap}' +
    '.zc-row input{flex:1;min-width:120px;padding:9px 12px;border:1.5px solid #c9cccf;border-radius:8px;font-size:15px;outline:none;font-family:inherit}' +
    '.zc-row button{padding:9px 20px;background:#008060;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer}' +
    '.zc-result{margin-top:10px;font-size:14px;min-height:18px;font-weight:500;line-height:1.5}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function buildWidget(container, index) {
    var inputId  = 'zc-zip-'  + index;
    var btnId    = 'zc-btn-'  + index;
    var resultId = 'zc-res-'  + index;
    var label    = container.getAttribute('data-label')       || 'Check Delivery Availability';
    var placeholder = container.getAttribute('data-placeholder') || 'Enter zip code';
    var btnText  = container.getAttribute('data-btn-text')    || 'Check';

    container.innerHTML =
      '<div id="zc-wrap">' +
        '<label>📍 ' + label + '</label>' +
        '<div class="zc-row">' +
          '<input id="' + inputId + '" placeholder="' + placeholder + '" maxlength="7" />' +
          '<button id="' + btnId + '">' + btnText + '</button>' +
        '</div>' +
        '<div class="zc-result" id="' + resultId + '"></div>' +
      '</div>';

    async function doCheck() {
      var zip = document.getElementById(inputId).value.trim();
      var out = document.getElementById(resultId);
      // Fix #2: supports both 5-digit (US) and 6-character (India/Canada) zip codes
      if (!zip || zip.length < 5 || zip.length > 7) {
        out.innerHTML = '<span style="color:#d72c0d">⚠ Please enter a valid zip / postal code</span>';
        return;
      }
      out.innerHTML = '<span style="color:#999">Checking...</span>';
      try {
        var r = await fetch(API + '/api/check/lookup/' + encodeURIComponent(zip));
        var json = await r.json();
        // Fix #3: show correct allow/block message
        if (!json.success) {
          out.innerHTML = '<span style="color:#d72c0d">⚠ ' + (json.message || 'Error checking zip code') + '</span>';
          return;
        }
        var d = json.data;
        if (d.result === 'allow') {
          out.innerHTML = '<span style="color:#008060">✅ ' + (d.message || 'Great! Delivery is available to your area.') + '</span>';
        } else if (d.result === 'block') {
          out.innerHTML = '<span style="color:#d72c0d">🚫 ' + (d.message || 'Sorry, delivery is not available to your area.') + '</span>';
        } else {
          out.innerHTML = '<span style="color:#f59e0b">ℹ️ No specific rule found. Delivery may be available — please contact us.</span>';
        }
      } catch(e) {
        out.innerHTML = '<span style="color:#d72c0d">Unable to check. Please try again.</span>';
      }
    }

    document.getElementById(btnId).onclick = doCheck;
    document.getElementById(inputId).onkeydown = function(e) { if (e.key === 'Enter') doCheck(); };
  }

  // Fix #5: Find all embed containers — <div data-zipcheck></div>
  function init() {
    var containers = document.querySelectorAll('[data-zipcheck]');
    containers.forEach(function(el, i) { buildWidget(el, i); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
  `);
});

// ── Embed page — standalone HTML widget for iFrame use ────────────────────────
app.get("/embed", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.send(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:16px;background:#fff}
  .wrap{border:1px solid #e4e5e7;border-radius:10px;padding:16px}
  label{display:block;font-weight:700;font-size:14px;margin-bottom:8px;color:#1a1a1a}
  .row{display:flex;gap:8px;flex-wrap:wrap}
  input{flex:1;min-width:100px;padding:9px 12px;border:1.5px solid #c9cccf;border-radius:8px;font-size:15px;outline:none}
  button{padding:9px 20px;background:#008060;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer}
  .result{margin-top:10px;font-size:14px;min-height:18px;font-weight:500;line-height:1.5}
</style>
</head><body>
<div class="wrap">
  <label>📍 Check Delivery Availability</label>
  <div class="row">
    <input id="zip" placeholder="Enter zip / postal code" maxlength="7" />
    <button onclick="check()">Check</button>
  </div>
  <div class="result" id="result"></div>
</div>
<script>
async function check() {
  var zip = document.getElementById('zip').value.trim();
  var out = document.getElementById('result');
  if (!zip || zip.length < 5) { out.innerHTML = '<span style="color:#d72c0d">⚠ Enter a valid zip code</span>'; return; }
  out.innerHTML = '<span style="color:#999">Checking...</span>';
  try {
    var r = await fetch('${HOST}/api/check/lookup/' + encodeURIComponent(zip));
    var d = (await r.json()).data;
    out.innerHTML = d.result === 'allow'
      ? '<span style="color:#008060">✅ ' + (d.message || 'Delivery available!') + '</span>'
      : d.result === 'block'
      ? '<span style="color:#d72c0d">🚫 ' + (d.message || 'Delivery not available.') + '</span>'
      : '<span style="color:#f59e0b">ℹ️ Please contact us for delivery info.</span>';
  } catch(e) { out.innerHTML = '<span style="color:#d72c0d">Error. Try again.</span>'; }
}
document.getElementById('zip').onkeydown = function(e) { if(e.key==='Enter') check(); };
</script>
</body></html>`);
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
