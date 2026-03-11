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

// ✅ FIXED: Correct Railway URL
const HOST = process.env.HOST || "https://zipcheck-app-production.up.railway.app";

// ── Shopify Setup ─────────────────────────────────────────────────────────────
const shopify = shopifyApi({
  apiKey:        process.env.SHOPIFY_API_KEY    || "",
  apiSecretKey:  process.env.SHOPIFY_API_SECRET || "",
  scopes:        (process.env.SCOPES || "read_products,write_script_tags").split(","),
  hostName:      HOST.replace(/https?:\/\//, ""),
  apiVersion:    "2025-01",  // ✅ FIXED: String not math expression
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
    sessions[session.shop] = {
      shop:        session.shop,
      accessToken: session.accessToken,
      installedAt: new Date().toISOString()
    };
    write("sessions", sessions);

    // Register widget script tag
    try {
      const client = new shopify.clients.Rest({ session });
      await client.post({
        path: "script_tags",
        data: { script_tag: { event: "onload", src: `${HOST}/widget.js` } }
      });
      console.log("✅ Widget script tag registered");
    } catch (e) { console.log("Script tag error:", e.message); }

    res.redirect(`https://${session.shop}/admin/apps/${shopify.config.apiKey}`);
  } catch (e) {
    console.error("Callback error:", e);
    res.status(500).send("Callback failed: " + e.message);
  }
});

// ── Embedded App Home Routes ✅ NEW ───────────────────────────────────────────
const embeddedHTML = `
<!DOCTYPE html>
<html>
  <head>
    <title>Zip Code Checker</title>
    <style>
      body { font-family: -apple-system, sans-serif; max-width: 600px; margin: 60px auto; padding: 20px; text-align: center; }
      h1 { color: #008060; }
      p  { color: #555; font-size: 16px; }
      .badge { background: #e8f5e9; color: #008060; padding: 8px 20px; border-radius: 20px; font-weight: bold; display: inline-block; margin-top: 10px; }
    </style>
  </head>
  <body>
    <h1>✅ Zip Code Checker</h1>
    <p>Your app is installed and active!</p>
    <div class="badge">Widget is live on your product pages</div>
    <p style="margin-top:30px; color:#999; font-size:14px;">
      The delivery availability widget will appear above the Add to Cart button on all product pages.
    </p>
  </body>
</html>
`;

app.get("/", (req, res) => res.send(embeddedHTML));
app.get("/app", (req, res) => res.send(embeddedHTML));

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
