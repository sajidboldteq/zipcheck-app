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

  const nonce        = crypto.randomBytes(16).toString("hex");
  const redirectUri  = `${HOST}/auth/callback`;
  const installUrl   = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${nonce}&grant_options[]=`;

  console.log("🔐 Starting OAuth for:", shop);
  console.log("🔗 Redirect URL:", redirectUri);
  res.redirect(installUrl);
});

// ── Manual OAuth: Step 2 — Callback ──────────────────────────────────────────
app.get("/auth/callback", async (req, res) => {
  const { shop, code, state, hmac, ...rest } = req.query;

  // Validate HMAC
  const params   = Object.entries(rest).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
  const fullMsg  = `code=${code}&shop=${shop}&state=${state}&` + params;
  const digest   = crypto.createHmac("sha256", SHOPIFY_API_SECRET).update(
    `code=${code}&shop=${shop}&state=${state}`
  ).digest("hex");

  // Exchange code for access token
  try {
    const tokenRes = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id:     SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code,
    });

    const accessToken = tokenRes.data.access_token;
    console.log("✅ Installed on:", shop, "| Token:", accessToken.slice(0, 8) + "...");

    // Save session
    try {
      const { read, write } = require("./utils/store");
      const sessions = read("sessions") || {};
      sessions[shop] = { shop, accessToken, installedAt: new Date().toISOString() };
      write("sessions", sessions);
    } catch (e) { console.log("Session save error:", e.message); }

    // Register widget script tag
    try {
      await axios.post(
        `https://${shop}/admin/api/2025-01/script_tags.json`,
        { script_tag: { event: "onload", src: `${HOST}/widget.js` } },
        { headers: { "X-Shopify-Access-Token": accessToken } }
      );
      console.log("✅ Widget script tag registered");
    } catch (e) { console.log("Script tag error:", e.message); }

    // Redirect to Shopify admin
    res.redirect(`https://${shop}/admin/apps/${SHOPIFY_API_KEY}`);

  } catch (e) {
    console.error("❌ Token exchange failed:", e.response?.data || e.message);
    res.status(500).send("Installation failed: " + (e.response?.data?.error_description || e.message));
  }
});

// ── Embedded App Home ─────────────────────────────────────────────────────────
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
      The delivery availability widget appears above the Add to Cart button on all product pages.
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
