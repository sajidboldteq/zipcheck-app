// backend/server.js
const express = require("express");
const cors    = require("cors");
const morgan  = require("morgan");
const crypto  = require("crypto");
const https   = require("https");

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

function httpsPost(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body   = JSON.stringify(data);
    const parsed = new URL(url);
    const opts   = { hostname: parsed.hostname, path: parsed.pathname, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...headers } };
    const req = https.request(opts, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => { try { resolve({ data: JSON.parse(raw), status: res.statusCode }); } catch(e) { resolve({ data: raw, status: res.statusCode }); } });
    });
    req.on("error", reject); req.write(body); req.end();
  });
}

app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", "frame-ancestors https://*.myshopify.com https://admin.shopify.com");
  res.removeHeader("X-Frame-Options");
  next();
});
app.use(cors({ origin: "*", credentials: true }));
app.use(morgan("dev"));
app.use(express.json());

// ── App State ─────────────────────────────────────────────────────────────────
let appActive      = true;
let currentPlan    = "free";
let customCSS      = "";
let placementMode  = "auto";
let hideCartBtns   = true;
let showOnValid    = true;
let currentSubscriptionId = null;
let currentCustomerId     = null;

app.get("/api/app-status",   (req, res) => res.json({ active: appActive, plan: currentPlan }));
app.post("/api/app-status",  (req, res) => {
  if (typeof req.body.active === "boolean") appActive = req.body.active;
  if (req.body.plan) currentPlan = req.body.plan;
  res.json({ active: appActive, plan: currentPlan });
});
app.get("/api/custom-css",   (req, res) => res.json({ css: customCSS }));
app.post("/api/custom-css",  (req, res) => { customCSS = req.body.css || ""; res.json({ success: true }); });
app.get("/api/placement",    (req, res) => res.json({ mode: placementMode, hideCart: hideCartBtns, showOnValid }));
app.post("/api/placement",   (req, res) => {
  if (req.body.mode)                       placementMode = req.body.mode;
  if (typeof req.body.hideCart === "boolean") hideCartBtns = req.body.hideCart;
  if (typeof req.body.showOnValid === "boolean") showOnValid = req.body.showOnValid;
  res.json({ mode: placementMode, hideCart: hideCartBtns, showOnValid });
});

// ── OAuth ─────────────────────────────────────────────────────────────────────
app.get("/auth", (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send("Missing ?shop=");
  const nonce = crypto.randomBytes(16).toString("hex");
  const redirectUri = encodeURIComponent(`${HOST}/auth/callback`);
  res.redirect(`https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${redirectUri}&state=${nonce}`);
});
app.get("/auth/callback", async (req, res) => {
  const { shop, code } = req.query;
  if (!shop || !code) return res.status(400).send("Missing shop or code");
  try {
    const tokenRes = await httpsPost(`https://${shop}/admin/oauth/access_token`, { client_id: SHOPIFY_API_KEY, client_secret: SHOPIFY_API_SECRET, code });
    const accessToken = tokenRes.data.access_token;
    console.log("✅ Installed on:", shop);
    try { const { read, write } = require("./utils/store"); const sessions = read("sessions") || {}; sessions[shop] = { shop, accessToken, installedAt: new Date().toISOString() }; write("sessions", sessions); } catch(e) { console.log("Session save:", e.message); }
    try { await httpsPost(`https://${shop}/admin/api/2025-01/script_tags.json`, { script_tag: { event: "onload", src: `${HOST}/widget.js` } }, { "X-Shopify-Access-Token": accessToken }); console.log("✅ Script tag registered"); } catch(e) { console.log("Script tag:", e.message); }
    res.redirect(`https://${shop}/admin/apps/${SHOPIFY_API_KEY}`);
  } catch(e) { console.error("❌ Auth error:", e.message); res.status(500).send("Installation failed: " + e.message); }
});

app.get("/",    (req, res) => res.send(buildAdminHTML()));
app.get("/app", (req, res) => res.send(buildAdminHTML()));

// ── Widget JS ─────────────────────────────────────────────────────────────────
app.get("/widget.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-cache");
  const { read } = require("./utils/store");
  const s       = (() => { try { return read("widget-settings") || {}; } catch(e) { return {}; } })();
  const btnColor = s.btnColor || "#008060";
  const btnTxt   = s.btnTxt   || "#ffffff";
  const okColor  = s.okColor  || "#008060";
  const errColor = s.errColor || "#d72c0d";
  const okMsg    = (s.okMsg   || "Delivery available!").replace(/'/g, "\\'");
  const errMsg   = (s.errMsg  || "Delivery not available in your area.").replace(/'/g, "\\'");
  const title    = (s.widgetLabel || "Check Delivery Availability").replace(/'/g, "\\'");
  const ph       = (s.widgetPlaceholder || "Enter zip / postal code").replace(/'/g, "\\'");
  const btnLbl   = (s.btnText || "Check").replace(/'/g, "\\'");
  const safeCss  = customCSS.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, " ");

  res.send(`(function(){
  if(!${appActive})return;
  var API='${HOST}';
  var PLACEMENT='${placementMode}';
  var HIDE_CART=${hideCartBtns};
  var SHOW_ON_VALID=${showOnValid};
  var _css='${safeCss}';
  var CART_SELS=['[name=add]','[data-testid=add-to-cart]','.product-form__submit','[data-action=add-to-cart]','#AddToCart','#add-to-cart-btn','.shopify-payment-button__button','[data-testid=BuyNow]','[data-action=buy-now]','.btn-product-form'];
  var CHECKOUT_SELS=['[name=checkout]','button[name=checkout]','.cart__checkout-button','.cart-checkout-button','[data-testid=checkout-btn]','input[name=checkout]'];

  function addStyles(){
    if(document.getElementById('zc-styles'))return;
    var st=document.createElement('style');st.id='zc-styles';
    st.textContent='[data-zipcheck]{margin:14px 0}[data-zipcheck] .zc-wrap{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:18px;border:1.5px solid #e4e5e7;border-radius:12px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.06)}[data-zipcheck] .zc-lbl{display:block;font-weight:700;font-size:14px;margin-bottom:12px;color:#1a1a1a}[data-zipcheck] .zc-row{display:flex;gap:8px;flex-wrap:wrap}[data-zipcheck] .zc-inp{flex:1;min-width:120px;padding:10px 14px;border:1.5px solid #d1d5db;border-radius:8px;font-size:15px;outline:none;font-family:inherit;transition:border-color .2s,box-shadow .2s}[data-zipcheck] .zc-inp:focus{border-color:${btnColor};box-shadow:0 0 0 3px ${btnColor}22}[data-zipcheck] .zc-btn{padding:10px 22px;background:${btnColor};color:${btnTxt};border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;transition:all .15s;white-space:nowrap}[data-zipcheck] .zc-btn:hover{opacity:.88;transform:translateY(-1px)}[data-zipcheck] .zc-res{margin-top:10px;font-size:14px;min-height:20px;font-weight:500;line-height:1.5}'
    +'.zc-popup-ov{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;align-items:center;justify-content:center;backdrop-filter:blur(4px);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}'
    +'.zc-popup-ov.open{display:flex}'
    +'.zc-popup-box{background:#fff;border-radius:20px;width:min(440px,95vw);overflow:hidden;box-shadow:0 30px 60px rgba(0,0,0,.3)}'
    +'.zc-popup-head{background:linear-gradient(135deg,#065f46,#059669);padding:22px 24px;display:flex;align-items:center;gap:12px}'
    +'.zc-popup-head-icon{font-size:28px}'
    +'.zc-popup-head-text{color:#fff;font-size:16px;font-weight:800;flex:1}'
    +'.zc-popup-close{color:rgba(255,255,255,.7);background:none;border:none;font-size:22px;cursor:pointer;line-height:1;padding:0;transition:color .15s}'
    +'.zc-popup-close:hover{color:#fff}'
    +'.zc-popup-body{padding:24px}'
    +'.zc-popup-note{font-size:13px;color:#6b7280;margin-bottom:16px;line-height:1.5}'
    +'.zc-popup-row{display:flex;gap:8px;flex-wrap:wrap}'
    +'.zc-popup-inp{flex:1;min-width:120px;padding:11px 14px;border:1.5px solid #d1d5db;border-radius:9px;font-size:15px;outline:none;font-family:inherit;transition:border-color .2s,box-shadow .2s}'
    +'.zc-popup-inp:focus{border-color:${btnColor};box-shadow:0 0 0 3px ${btnColor}22}'
    +'.zc-popup-btn{padding:11px 22px;background:${btnColor};color:${btnTxt};border:none;border-radius:9px;font-weight:700;font-size:14px;cursor:pointer;white-space:nowrap;transition:all .15s}'
    +'.zc-popup-btn:hover{opacity:.88;transform:translateY(-1px)}'
    +'.zc-popup-res{margin-top:12px;font-size:14px;min-height:20px;font-weight:500;line-height:1.5}'
    +'.zc-popup-proceed{display:none;margin-top:14px;width:100%;padding:12px;background:linear-gradient(135deg,#065f46,#059669);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;transition:all .15s}'
    +'.zc-popup-proceed:hover{opacity:.9;transform:translateY(-1px)}'
    +'.zc-cart-notice{margin:0 0 12px 0;padding:14px 18px;background:linear-gradient(135deg,#fffbeb,#fef9c3);border:1.5px solid #fde047;border-radius:12px;font-size:13px;color:#854d0e;font-weight:600;display:flex;align-items:center;gap:8px}';
    document.head.appendChild(st);
    if(_css){var cu=document.createElement('style');cu.id='zc-custom';cu.textContent=_css;document.head.appendChild(cu);}
  }
  /* ── Product page: hide/show Add-to-Cart buttons ── */
  function hideCartBtns(){if(!HIDE_CART)return;CART_SELS.forEach(function(sel){document.querySelectorAll(sel).forEach(function(el){el.style.opacity='0';el.style.pointerEvents='none';el.setAttribute('data-zc-h','1');});});}
  function showCartBtns(){CART_SELS.forEach(function(sel){document.querySelectorAll(sel).forEach(function(el){if(el.getAttribute('data-zc-h')){el.style.opacity='';el.style.pointerEvents='';el.removeAttribute('data-zc-h');}});});}
  /* ── Cart page: hide/show Checkout button only ── */
  function hideCheckout(){CHECKOUT_SELS.forEach(function(sel){document.querySelectorAll(sel).forEach(function(el){el.style.opacity='0.4';el.style.pointerEvents='none';el.setAttribute('data-zc-co','1');el.title='Verify zip code first';});});}
  function showCheckout(){CHECKOUT_SELS.forEach(function(sel){document.querySelectorAll(sel).forEach(function(el){if(el.getAttribute('data-zc-co')){el.style.opacity='';el.style.pointerEvents='';el.removeAttribute('data-zc-co');el.title='';}});});}
  function hideCart(){hideCartBtns();}
  function showCart(){showCartBtns();}

  async function lookupZip(zip){
    var r=await fetch(API+'/api/check/lookup/'+encodeURIComponent(zip));
    return await r.json();
  }

  /* ── Build widget (product page or cart page) ── */
  function build(el,i,opts){
    opts=opts||{};
    var isCartPage=opts.cartPage||false;
    addStyles();
    var label=el.getAttribute('data-label')||'${title}';
    var placeholder=el.getAttribute('data-placeholder')||'${ph}';
    var btn=el.getAttribute('data-btn-text')||'${btnLbl}';
    var ii='zci'+i,bi='zcb'+i,ri='zcr'+i;
    el.innerHTML='<div class="zc-wrap"><span class="zc-lbl">\u{1F4CD} '+label+'</span><div class="zc-row"><input class="zc-inp" id="'+ii+'" placeholder="'+placeholder+'" maxlength="12"/><button class="zc-btn" id="'+bi+'">'+btn+'</button></div><div class="zc-res" id="'+ri+'"></div></div>';
    if(isCartPage){hideCheckout();}else if(HIDE_CART){hideCartBtns();}
    async function chk(){
      var zip=document.getElementById(ii).value.trim().toUpperCase();
      var out=document.getElementById(ri);
      if(!zip||zip.length<4){out.innerHTML='<span style="color:${errColor}">\u26A0 Enter a valid zip / postal code</span>';return;}
      out.innerHTML='<span style="color:#9ca3af">Checking\u2026</span>';
      try{
        var j=await lookupZip(zip);
        if(!j.success){out.innerHTML='<span style="color:${errColor}">\u26A0 '+(j.message||'Error')+'</span>';return;}
        var d=j.data;
        if(d.result==='allow'){
          out.innerHTML='<span style="color:${okColor}">\u2705 '+(d.message||'${okMsg}')+'</span>';
          if(isCartPage){showCheckout();}else if(SHOW_ON_VALID){showCartBtns();}
        }else if(d.result==='block'||d.result==='deny'){
          out.innerHTML='<span style="color:${errColor}">\u{1F6AB} '+(d.message||'${errMsg}')+'</span>';
          if(isCartPage){hideCheckout();}else if(HIDE_CART){hideCartBtns();}
        }else{out.innerHTML='<span style="color:#f59e0b">\u2139\uFE0F No delivery rule found. Please contact us.</span>';}
      }catch(e){out.innerHTML='<span style="color:${errColor}">Unable to check. Please try again.</span>';}
    }
    document.getElementById(bi).onclick=chk;
    document.getElementById(ii).onkeydown=function(e){if(e.key==='Enter')chk();};
  }

  /* ── AUTO: inject above Add-to-Cart on product page ── */
  function autoPlace(){
    if(document.querySelector('[data-zc-auto]'))return;
    var selectors=['.product-form__submit','[name=add]','#AddToCart','.shopify-payment-button__button','[data-testid=add-to-cart]','.btn-product-form','[data-action=add-to-cart]'];
    var target=null;
    for(var i=0;i<selectors.length;i++){target=document.querySelector(selectors[i]);if(target)break;}
    if(!target)return;
    var wrap=document.createElement('div');wrap.setAttribute('data-zipcheck','');wrap.setAttribute('data-zc-auto','1');
    var parent=target.closest('form')||target.parentNode;
    parent.insertBefore(wrap,target);
    build(wrap,999,{cartPage:false});
  }

  /* ── CART PAGE: inject widget before Checkout, hide Checkout until ZIP valid ── */
  function cartPagePlace(){
    if(document.getElementById('zc-cart-block'))return;
    var isCart=window.location.pathname.indexOf('/cart')!==-1||document.querySelector('form[action="/cart"]')||document.querySelector('[data-cart-form]');
    if(!isCart)return;
    addStyles();
    var checkoutBtn=null;
    for(var ci=0;ci<CHECKOUT_SELS.length;ci++){checkoutBtn=document.querySelector(CHECKOUT_SELS[ci]);if(checkoutBtn)break;}
    var notice=document.createElement('div');notice.className='zc-cart-notice';
    notice.innerHTML='\u{1F4CD} Enter your zip code below to enable the Checkout button.';
    var wrap=document.createElement('div');wrap.id='zc-cart-block';wrap.setAttribute('data-zipcheck','');
    wrap.setAttribute('data-label','Verify Delivery Before Checkout');
    if(checkoutBtn){
      var parent=checkoutBtn.closest('form')||checkoutBtn.parentNode;
      parent.insertBefore(wrap,checkoutBtn);
      parent.insertBefore(notice,wrap);
    }else{
      var cartForm=document.querySelector('form[action="/cart"]')||document.querySelector('[data-cart-form]');
      if(cartForm){cartForm.appendChild(notice);cartForm.appendChild(wrap);}
      else{document.body.appendChild(notice);document.body.appendChild(wrap);}
    }
    build(wrap,888,{cartPage:true});
    // Watch for dynamically rendered checkout buttons
    var mo=new MutationObserver(function(){
      CHECKOUT_SELS.forEach(function(sel){
        document.querySelectorAll(sel).forEach(function(el){
          if(!el.getAttribute('data-zc-co')){
            el.style.opacity='0.4';el.style.pointerEvents='none';el.setAttribute('data-zc-co','1');el.title='Verify zip code first';
          }
        });
      });
    });
    mo.observe(document.body,{childList:true,subtree:true});
  }

  /* ── POPUP / OVERLAY ── */
  function setupPopup(){
    if(document.getElementById('zc-popup-overlay'))return;
    addStyles();
    var ov=document.createElement('div');ov.id='zc-popup-overlay';ov.className='zc-popup-ov';
    ov.innerHTML='<div class="zc-popup-box"><div class="zc-popup-head"><span class="zc-popup-head-icon">\u{1F4CD}</span><span class="zc-popup-head-text">${title}</span><button class="zc-popup-close" id="zc-popup-x">&times;</button></div><div class="zc-popup-body"><div class="zc-popup-note">Confirm your delivery area before adding to cart.</div><div class="zc-popup-row"><input class="zc-popup-inp" id="zc-popup-inp" placeholder="${ph}" maxlength="12"/><button class="zc-popup-btn" id="zc-popup-check">${btnLbl}</button></div><div class="zc-popup-res" id="zc-popup-res"></div><button class="zc-popup-proceed" id="zc-popup-proceed">\u2705 Confirmed — Continue to Cart</button></div></div>';
    document.body.appendChild(ov);
    var _pendingBtn=null;
    function closePopup(){ov.classList.remove('open');_pendingBtn=null;}
    document.getElementById('zc-popup-x').onclick=closePopup;
    ov.onclick=function(e){if(e.target===ov)closePopup();};
    document.getElementById('zc-popup-check').onclick=async function(){
      var zip=document.getElementById('zc-popup-inp').value.trim().toUpperCase();
      var out=document.getElementById('zc-popup-res');
      var pb=document.getElementById('zc-popup-proceed');
      if(!zip||zip.length<4){out.innerHTML='<span style="color:${errColor}">\u26A0 Enter a valid zip</span>';pb.style.display='none';return;}
      out.innerHTML='<span style="color:#9ca3af">Checking\u2026</span>';pb.style.display='none';
      try{
        var j=await lookupZip(zip);
        if(!j.success){out.innerHTML='<span style="color:${errColor}">\u26A0 '+(j.message||'Error')+'</span>';return;}
        var d=j.data;
        if(d.result==='allow'){out.innerHTML='<span style="color:${okColor}">\u2705 '+(d.message||'${okMsg}')+'</span>';pb.style.display='block';window._zcZipVerified=true;}
        else if(d.result==='block'||d.result==='deny'){out.innerHTML='<span style="color:${errColor}">\u{1F6AB} '+(d.message||'${errMsg}')+'</span>';pb.style.display='none';window._zcZipVerified=false;}
        else{out.innerHTML='<span style="color:#f59e0b">\u2139\uFE0F No rule found. Please contact us.</span>';}
      }catch(e){out.innerHTML='<span style="color:${errColor}">Unable to check. Try again.</span>';}
    };
    document.getElementById('zc-popup-inp').onkeydown=function(e){if(e.key==='Enter')document.getElementById('zc-popup-check').click();};
    document.getElementById('zc-popup-proceed').onclick=function(){closePopup();showCartBtns();if(_pendingBtn){window._zcZipVerified=true;_pendingBtn.click();_pendingBtn=null;}};
    function interceptBtn(btn){
      btn.setAttribute('data-zc-intercepted','1');
      btn.addEventListener('click',function(e){
        if(window._zcZipVerified)return;
        e.preventDefault();e.stopImmediatePropagation();
        _pendingBtn=btn;
        document.getElementById('zc-popup-inp').value='';
        document.getElementById('zc-popup-res').innerHTML='';
        document.getElementById('zc-popup-proceed').style.display='none';
        ov.classList.add('open');
        document.getElementById('zc-popup-inp').focus();
      },true);
    }
    CART_SELS.forEach(function(sel){document.querySelectorAll(sel).forEach(function(b){if(!b.getAttribute('data-zc-intercepted'))interceptBtn(b);});});
    var mo=new MutationObserver(function(){CART_SELS.forEach(function(sel){document.querySelectorAll(sel).forEach(function(b){if(!b.getAttribute('data-zc-intercepted'))interceptBtn(b);});});});
    mo.observe(document.body,{childList:true,subtree:true});
  }

  /* ── Init ── */
  function init(){
    if(PLACEMENT==='manual'){
      document.querySelectorAll('[data-zc-auto]').forEach(function(el){el.remove();});
      if(document.getElementById('zc-cart-block')){document.getElementById('zc-cart-block').remove();}
      var p=document.getElementById('zc-popup-overlay');if(p)p.remove();
      document.querySelectorAll('[data-zipcheck]:not([data-zc-auto])').forEach(function(el,i){build(el,i,{cartPage:false});});
      return;
    }
    if(PLACEMENT==='cart'){
      document.querySelectorAll('[data-zc-auto]').forEach(function(el){el.remove();});
      var p=document.getElementById('zc-popup-overlay');if(p)p.remove();
      document.querySelectorAll('[data-zipcheck]:not([data-zc-auto])').forEach(function(el,i){build(el,i,{cartPage:false});});
      cartPagePlace();
      return;
    }
    if(PLACEMENT==='popup'){
      document.querySelectorAll('[data-zc-auto]').forEach(function(el){el.remove();});
      if(document.getElementById('zc-cart-block')){document.getElementById('zc-cart-block').remove();}
      setupPopup();
      return;
    }
    document.querySelectorAll('[data-zipcheck]').forEach(function(el,i){build(el,i,{cartPage:false});});
    autoPlace();
  }
    if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}else{init();}
})();`);
});

app.get("/embed", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;padding:12px;background:#fff}.w{border:1px solid #e4e5e7;border-radius:12px;padding:18px;box-shadow:0 2px 8px rgba(0,0,0,.06)}label{display:block;font-weight:700;font-size:14px;margin-bottom:12px}.row{display:flex;gap:8px;flex-wrap:wrap}input{flex:1;min-width:100px;padding:10px 14px;border:1.5px solid #d1d5db;border-radius:8px;font-size:15px;outline:none}button{padding:10px 20px;background:#008060;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer}.res{margin-top:10px;font-size:14px;min-height:18px;font-weight:500}
/* ══ DASHBOARD CARDS ══ */
.dash-card{background:var(--white);border:1px solid var(--g200);border-radius:var(--r-xl);padding:22px;cursor:pointer;transition:all .2s;box-shadow:var(--shadow-sm)}
.dash-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-lg);border-color:var(--g300)}
.dash-card-icon{width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:14px}
.dash-card-title{font-size:15px;font-weight:700;color:var(--g900);margin-bottom:6px}
.dash-card-desc{font-size:13px;color:var(--g500);line-height:1.5;margin-bottom:16px}
.dash-card-btn{background:none;border:none;color:var(--green-dk);font-size:13px;font-weight:600;cursor:pointer;padding:0;font-family:var(--font);transition:color .15s}
.dash-card:hover .dash-card-btn{color:var(--green-xdk)}

</style></head><body><div class="w"><label>📍 Check Delivery Availability</label><div class="row"><input id="z" placeholder="Enter zip / postal code" maxlength="12"/><button onclick="chk()">Check</button></div><div class="res" id="r"></div></div><script>async function chk(){var zip=document.getElementById('z').value.trim().toUpperCase(),out=document.getElementById('r');if(!zip||zip.length<4){out.innerHTML='<span style="color:#d72c0d">Enter a valid zip code</span>';return;}out.innerHTML='<span style="color:#999">Checking...</span>';try{var r=await fetch('${HOST}/api/check/lookup/'+encodeURIComponent(zip)),d=(await r.json()).data;out.innerHTML=d.result==='allow'?'<span style="color:#008060">✅ '+(d.message||'Delivery available!')+'</span>':d.result==='block'?'<span style="color:#d72c0d">🚫 '+(d.message||'Not available.')+'</span>':'<span style="color:#f59e0b">ℹ️ Please contact us.</span>';}catch(e){out.innerHTML='<span style="color:#d72c0d">Error. Try again.</span>';}}document.getElementById('z').onkeydown=function(e){if(e.key==='Enter')chk();};<\/script></body></html>`);
});

app.get("/api/health", (req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

// ── Test Email Route ───────────────────────────────────────────────────────────
app.get("/api/test-email", async (req, res) => {
  const to = req.query.to || ADMIN_EMAIL || NOTIFY_FROM_EMAIL;
  if (!to) return res.status(400).json({ error: "No recipient — set ADMIN_EMAIL env var or pass ?to=your@email.com" });
  if (!SENDGRID_API_KEY) return res.status(400).json({ error: "SENDGRID_API_KEY env var not set" });
  try {
    const trialEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    await sendEmail({
      to,
      subject: "✅ ZipCheck Email Test — SendGrid is working!",
      html: buildSubscriptionEmailHTML({ name: "Test User", plan: "starter", billing: "monthly", trialEnd })
    });
    res.json({ success: true, message: `Test email sent to ${to}`, from: NOTIFY_FROM_EMAIL });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Stripe ─────────────────────────────────────────────────────────────────────
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

function stripeRequest(method, path, data) {
  return new Promise((resolve, reject) => {
    const body   = (data && method !== "DELETE") ? new URLSearchParams(data).toString() : "";
    const parsed = new URL("https://api.stripe.com" + path);
    const opts   = {
      hostname: "api.stripe.com", path: parsed.pathname + parsed.search, method,
      headers: {
        "Authorization": "Bearer " + STRIPE_SECRET,
        "Content-Type":  "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body)
      }
    };
    const req = https.request(opts, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => { try { resolve({ data: JSON.parse(raw), status: res.statusCode }); } catch(e) { resolve({ data: raw, status: res.statusCode }); } });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Email notification helper ──────────────────────────────────────────────────
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
const NOTIFY_FROM_EMAIL = process.env.NOTIFY_FROM_EMAIL || "noreply@zipcheck.app";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";

async function sendEmail({ to, subject, html }) {
  if (!SENDGRID_API_KEY) {
    console.log(`[Email] No SENDGRID_API_KEY set — would send to ${to}: ${subject}`);
    return;
  }
  try {
    const body = JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: NOTIFY_FROM_EMAIL, name: "ZipCheck" },
      subject,
      content: [{ type: "text/html", value: html }]
    });
    const opts = {
      hostname: "api.sendgrid.com", path: "/v3/mail/send", method: "POST",
      headers: {
        "Authorization": "Bearer " + SENDGRID_API_KEY,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    };
    await new Promise((resolve, reject) => {
      const req = https.request(opts, (res) => {
        let raw = ""; res.on("data", c => raw += c);
        res.on("end", () => { console.log(`✉️  Email sent to ${to} (${res.statusCode})`); resolve(); });
      });
      req.on("error", reject); req.write(body); req.end();
    });
  } catch(e) { console.error("Email error:", e.message); }
}

function buildSubscriptionEmailHTML({ name, plan, billing, trialEnd }) {
  const planDisplay = plan.charAt(0).toUpperCase() + plan.slice(1);
  const billingDisplay = billing === "yearly" ? "Yearly" : "Monthly";
  return `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f3f4f6;margin:0;padding:32px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)">
  <div style="background:linear-gradient(135deg,#065f46,#059669);padding:32px 36px;text-align:center">
    <div style="font-size:44px;margin-bottom:12px">🎉</div>
    <h1 style="color:#fff;margin:0;font-size:22px;font-weight:900">Welcome to ZipCheck ${planDisplay}!</h1>
    <p style="color:rgba(255,255,255,.8);margin:8px 0 0;font-size:14px">Your subscription is now active</p>
  </div>
  <div style="padding:32px 36px">
    <p style="font-size:15px;color:#374151;margin:0 0 20px">Hi <strong>${name}</strong>,</p>
    <p style="font-size:14px;color:#6b7280;margin:0 0 24px;line-height:1.6">
      Thank you for subscribing to ZipCheck <strong>${planDisplay}</strong>! Your 3-day free trial has started and you won't be charged until <strong>${trialEnd}</strong>.
    </p>
    <div style="background:#f0fdf4;border:1px solid #a7f3d0;border-radius:12px;padding:20px 24px;margin-bottom:24px">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:13px;color:#6b7280;font-weight:600">Plan</span>
        <span style="font-size:13px;color:#065f46;font-weight:800">${planDisplay}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:13px;color:#6b7280;font-weight:600">Billing</span>
        <span style="font-size:13px;color:#065f46;font-weight:800">${billingDisplay}</span>
      </div>
      <div style="display:flex;justify-content:space-between">
        <span style="font-size:13px;color:#6b7280;font-weight:600">Trial ends</span>
        <span style="font-size:13px;color:#065f46;font-weight:800">${trialEnd}</span>
      </div>
    </div>
    <p style="font-size:13px;color:#9ca3af;line-height:1.6;margin:0">
      If you have any questions, reply to this email or visit your admin dashboard. You can cancel anytime before the trial ends with no charge.
    </p>
  </div>
  <div style="padding:20px 36px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center">
    <p style="font-size:12px;color:#9ca3af;margin:0">© ${new Date().getFullYear()} ZipCheck · All rights reserved</p>
  </div>
</div></body></html>`;
}


app.post("/api/create-subscription", async (req, res) => {
  const { paymentMethodId, email, name, priceId, plan, billing } = req.body;
  if (!paymentMethodId || !email || !priceId) return res.status(400).json({ error: "Missing required fields" });
  try {
    // Create or retrieve customer
    const custRes = await stripeRequest("POST", "/v1/customers", { email, name, payment_method: paymentMethodId, "invoice_settings[default_payment_method]": paymentMethodId });
    if (custRes.status !== 200) return res.status(400).json({ error: custRes.data.error?.message || "Failed to create customer" });
    const customerId = custRes.data.id;
    // Create subscription with trial
    const subData = {
      customer:                  customerId,
      "items[0][price]":         priceId,
      "trial_period_days":       "3",
      "payment_settings[payment_method_types][0]": "card",
      "payment_settings[save_default_payment_method]": "on_subscription",
      "expand[0]":               "latest_invoice.payment_intent"
    };
    const subRes = await stripeRequest("POST", "/v1/subscriptions", subData);
    if (subRes.status !== 200) return res.status(400).json({ error: subRes.data.error?.message || "Failed to create subscription" });
    const sub = subRes.data;
    // Handle 3D Secure
    const pi = sub.latest_invoice?.payment_intent;
    if (pi && pi.status === "requires_action") {
      return res.json({ requiresAction: true, clientSecret: pi.client_secret, subscriptionId: sub.id });
    }
    console.log(`✅ Subscription created: ${sub.id} for ${email} (${plan} ${billing})`);
    currentSubscriptionId = sub.id;
    currentCustomerId     = customerId;
    currentPlan           = plan;

    // Send confirmation email to subscriber
    const trialEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    sendEmail({
      to: email,
      subject: `🎉 Welcome to ZipCheck ${plan.charAt(0).toUpperCase()+plan.slice(1)} — Your trial has started!`,
      html: buildSubscriptionEmailHTML({ name, plan, billing, trialEnd })
    }).catch(e => console.error("Subscriber email error:", e.message));

    // Send admin notification if configured
    if (ADMIN_EMAIL) {
      sendEmail({
        to: ADMIN_EMAIL,
        subject: `[ZipCheck] New subscription: ${plan} (${billing}) — ${email}`,
        html: `<p>New subscriber: <strong>${name}</strong> (${email})<br>Plan: <strong>${plan}</strong> (${billing})<br>Subscription ID: ${sub.id}<br>Customer ID: ${customerId}</p>`
      }).catch(e => console.error("Admin email error:", e.message));
    }

    res.json({ success: true, subscriptionId: sub.id, customerId });
  } catch(e) { console.error("Stripe error:", e.message); res.status(500).json({ error: "Payment processing failed" }); }
});

// Cancel subscription
app.post("/api/cancel-subscription", async (req, res) => {
  if (!currentSubscriptionId) return res.status(400).json({ error: "No active subscription found" });
  try {
    const cancelRes = await stripeRequest("DELETE", `/v1/subscriptions/${currentSubscriptionId}`, null);
    if (cancelRes.status !== 200) return res.status(400).json({ error: cancelRes.data.error?.message || "Failed to cancel subscription" });
    console.log(`❌ Subscription cancelled: ${currentSubscriptionId}`);
    currentSubscriptionId = null;
    currentPlan           = "free";
    res.json({ success: true, message: "Subscription cancelled. You are now on the Free plan." });
  } catch(e) { console.error("Cancel error:", e.message); res.status(500).json({ error: "Failed to cancel subscription" }); }
});

// Stripe Webhook (endpoint: https://webarttechsolution.com/api/stripe-webhook)
app.post("/api/stripe-webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig     = req.headers["stripe-signature"];
  const payload = req.body;
  let event;
  if (STRIPE_WEBHOOK_SECRET) {
    try {
      const hmac    = require("crypto").createHmac("sha256", STRIPE_WEBHOOK_SECRET);
      const parts   = sig.split(",").reduce((acc, p) => { const [k,v]=p.split("="); acc[k]=v; return acc; }, {});
      const signed  = `${parts.t}.${payload.toString()}`;
      const expected = require("crypto").createHmac("sha256", STRIPE_WEBHOOK_SECRET).update(signed).digest("hex");
      if (expected !== parts.v1) return res.status(400).send("Invalid signature");
      event = JSON.parse(payload);
    } catch(e) { return res.status(400).send("Webhook error: " + e.message); }
  } else { try { event = JSON.parse(payload); } catch(e) { return res.status(400).send("Invalid JSON"); } }
  switch (event.type) {
    case "customer.subscription.created": console.log("✅ Subscription created:", event.data.object.id); break;
    case "customer.subscription.updated": console.log("🔄 Subscription updated:", event.data.object.id); break;
    case "customer.subscription.deleted": console.log("❌ Subscription cancelled:", event.data.object.id); currentPlan = "free"; break;
    case "invoice.payment_succeeded":     console.log("💰 Payment succeeded:", event.data.object.id); break;
    case "invoice.payment_failed":        console.log("⚠️ Payment failed:", event.data.object.id); break;
    default: console.log("Unhandled webhook:", event.type);
  }
  res.json({ received: true });
});
app.use("/api/rules",     rulesRouter);
app.use("/api/groups",    groupsRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/check",     checkRouter);
app.use("/api/settings",  settingsRouter);

app.listen(PORT, () => {
  console.log(`\n🚀 ZipCheck running on port ${PORT}`);
  console.log(`🌐 Dashboard: ${HOST}`);
  console.log(`🔐 Install:   ${HOST}/auth?shop=YOUR_STORE.myshopify.com\n`);
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN HTML
// ══════════════════════════════════════════════════════════════════════════════
function buildAdminHTML() {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>ZipCheck — Admin</title>
<script src="https://js.stripe.com/v3/"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --green:#00a67e;--green-lt:#d1fae5;--green-md:#a7f3d0;--green-dk:#059669;--green-xdk:#065f46;
  --red:#ef4444;--red-lt:#fef2f2;--red-dk:#dc2626;
  --purple:#8b5cf6;--purple-lt:#f5f3ff;--purple-dk:#7c3aed;
  --blue:#3b82f6;--blue-lt:#eff6ff;--blue-dk:#2563eb;
  --amber:#f59e0b;--amber-lt:#fffbeb;--amber-dk:#d97706;
  --pink:#ec4899;--pink-lt:#fdf2f8;
  --g950:#030712;--g900:#111827;--g800:#1f2937;--g700:#374151;--g600:#4b5563;
  --g500:#6b7280;--g400:#9ca3af;--g300:#d1d5db;--g200:#e5e7eb;--g100:#f3f4f6;--g50:#f9fafb;
  --white:#fff;--r:10px;--r-lg:14px;--r-xl:18px;
  --font:'Inter',sans-serif;--mono:'JetBrains Mono',monospace;
  --shadow-xs:0 1px 2px rgba(0,0,0,.05);
  --shadow-sm:0 1px 3px rgba(0,0,0,.1),0 1px 2px rgba(0,0,0,.06);
  --shadow:0 4px 6px -1px rgba(0,0,0,.1),0 2px 4px -2px rgba(0,0,0,.1);
  --shadow-lg:0 10px 15px -3px rgba(0,0,0,.1),0 4px 6px -4px rgba(0,0,0,.1);
  --shadow-xl:0 20px 25px -5px rgba(0,0,0,.1),0 8px 10px -6px rgba(0,0,0,.1);
}
body{font-family:var(--font);background:#f0f2f5;color:var(--g900);height:100vh;display:flex;overflow:hidden;-webkit-font-smoothing:antialiased}

/* ══ SIDEBAR ══════════════════════════════════════════════════════════════ */
.sidebar{width:232px;background:#ffffff;border-right:1px solid var(--g200);display:flex;flex-direction:column;flex-shrink:0;overflow-y:auto;height:100vh;box-shadow:2px 0 8px rgba(0,0,0,.06)}
.sidebar-brand{padding:20px 16px 16px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--g100)}
.brand-icon{width:38px;height:38px;background:linear-gradient(135deg,var(--green),var(--green-dk));border-radius:10px;display:grid;place-items:center;font-size:20px;flex-shrink:0;box-shadow:0 4px 12px rgba(0,166,126,.4)}
.brand-name{font-size:15px;font-weight:800;color:var(--g900);line-height:1.2;letter-spacing:-.2px}
.brand-sub{font-size:11px;color:var(--g400);font-weight:400}
.sidebar-nav{flex:1;padding:10px 8px}
.nav-section-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--g400);padding:10px 10px 5px}
.nav-btn{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border:none;background:none;cursor:pointer;font-family:var(--font);font-size:13px;font-weight:500;color:var(--g600);text-align:left;transition:all .15s;border-radius:8px;margin-bottom:2px}
.nav-btn:hover{background:var(--g50);color:var(--g900)}
.nav-btn.active{background:linear-gradient(135deg,var(--green-lt),#ecfdf5);color:var(--green-xdk);font-weight:700;box-shadow:inset 0 0 0 1px var(--green-md)}
.nav-icon{width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;opacity:.7}
.nav-btn.active .nav-icon{opacity:1}
.sidebar-footer{padding:10px 8px 16px;border-top:1px solid var(--g100)}
.app-toggle-row{display:flex;align-items:center;gap:10px;padding:12px 12px;border-radius:10px;background:var(--g50);border:1px solid var(--g200);cursor:pointer;transition:all .2s}
.app-toggle-row:hover{background:var(--green-lt);border-color:var(--green-md)}
.status-indicator{width:8px;height:8px;border-radius:50%;background:var(--green);flex-shrink:0;box-shadow:0 0 0 3px rgba(0,166,126,.25);animation:pulse-green 2s infinite}
.status-indicator.off{background:var(--g400);box-shadow:none;animation:none}
@keyframes pulse-green{0%,100%{box-shadow:0 0 0 3px rgba(0,166,126,.25)}50%{box-shadow:0 0 0 5px rgba(0,166,126,.1)}}
.status-label{flex:1;font-size:12px;font-weight:600;color:var(--g800)}
.status-sub{font-size:10px;color:var(--g400);margin-top:1px}
.toggle-pill{position:relative;width:34px;height:19px;cursor:pointer;display:inline-block;flex-shrink:0}
.toggle-pill input{opacity:0;width:0;height:0}
.toggle-track{position:absolute;inset:0;background:var(--g300);border-radius:20px;transition:.2s}
.toggle-track::after{content:'';position:absolute;left:2px;top:2px;width:15px;height:15px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.toggle-pill input:checked+.toggle-track{background:var(--green)}
.toggle-pill input:checked+.toggle-track::after{transform:translateX(15px)}

/* ══ CONTENT ══════════════════════════════════════════════════════════════ */
.content{flex:1;overflow-y:auto;padding:28px 32px;height:100vh}
.page{display:none}.page.active{display:block;max-width:960px}
.page-header{margin-bottom:26px;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
.page-title{font-size:24px;font-weight:900;color:var(--g900);letter-spacing:-.5px}
.page-sub{font-size:13.5px;color:var(--g500);margin-top:4px;line-height:1.5}

/* ══ STATS ══ */
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:22px}
.stat{background:var(--white);border:1px solid var(--g200);border-radius:var(--r-lg);padding:20px 22px;box-shadow:var(--shadow-sm);position:relative;overflow:hidden}
.stat::before{content:'';position:absolute;top:0;left:0;right:0;height:3px}
.stat.blue::before{background:linear-gradient(90deg,var(--blue),#60a5fa)}
.stat.green::before{background:linear-gradient(90deg,var(--green),#34d399)}
.stat.red::before{background:linear-gradient(90deg,var(--red),#f87171)}
.stat-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--g500);margin-bottom:10px}
.stat-val{font-size:32px;font-weight:900;font-family:var(--mono);letter-spacing:-.8px}
.stat-val.g{color:var(--green)}.stat-val.r{color:var(--red)}.stat-val.b{color:var(--blue)}

/* ══ CARDS ══ */
.card{background:var(--white);border:1px solid var(--g200);border-radius:var(--r-xl);margin-bottom:18px;overflow:hidden;box-shadow:var(--shadow-sm)}
.card-head{padding:16px 22px;border-bottom:1px solid var(--g100);display:flex;align-items:center;gap:10px;background:linear-gradient(180deg,var(--white),var(--g50))}
.card-head h2{font-size:14px;font-weight:700;flex:1;color:var(--g800)}
.cnt{background:var(--g100);color:var(--g600);font-size:11px;padding:3px 10px;border-radius:20px;font-weight:700}

/* ══ FORMS ══ */
.form-row{padding:18px 22px;display:flex;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--g100)}
.fld{display:flex;flex-direction:column;gap:6px;flex:1;min-width:120px}
.fld label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--g500)}
.fld input,.fld select{padding:9px 13px;border:1.5px solid var(--g200);border-radius:9px;font-size:14px;font-family:var(--font);outline:none;color:var(--g900);transition:all .15s;background:var(--white);box-shadow:var(--shadow-xs)}
.fld input:focus,.fld select:focus{border-color:var(--green);box-shadow:0 0 0 3px rgba(0,166,126,.12)}

/* ══ BUTTONS ══ */
.btn{display:inline-flex;align-items:center;gap:7px;padding:9px 18px;border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;border:none;font-family:var(--font);transition:all .18s;white-space:nowrap;letter-spacing:-.1px}
.btn-primary{background:linear-gradient(135deg,var(--green),var(--green-dk));color:#fff;box-shadow:0 2px 8px rgba(0,166,126,.35)}.btn-primary:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,166,126,.45)}
.btn-danger{background:var(--red-lt);color:var(--red)}.btn-danger:hover{background:#fee2e2}
.btn-ghost{background:var(--g50);color:var(--g700);border:1px solid var(--g200)}.btn-ghost:hover{background:var(--g100);border-color:var(--g300)}
.btn-purple{background:linear-gradient(135deg,var(--purple),var(--purple-dk));color:#fff;box-shadow:0 2px 8px rgba(139,92,246,.35)}.btn-purple:hover{transform:translateY(-1px)}
.btn-sm{padding:6px 13px;font-size:12px}
.btn-xs{padding:4px 10px;font-size:11px}

/* ══ TABLE ══ */
.tbl-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse}
thead tr{background:var(--g50);border-bottom:2px solid var(--g200)}
th{padding:11px 18px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--g500);white-space:nowrap}
tbody tr{border-bottom:1px solid var(--g100);transition:background .1s}
tbody tr:last-child{border-bottom:none}
tbody tr:hover{background:#f8f9ff}
td{padding:12px 18px;font-size:13.5px}
td.mono{font-family:var(--mono);font-weight:600;font-size:13px}
.badge{display:inline-flex;align-items:center;gap:4px;padding:4px 11px;border-radius:20px;font-size:11px;font-weight:700}
.badge-allow{background:var(--green-lt);color:var(--green-xdk)}
.badge-deny,.badge-block{background:var(--red-lt);color:var(--red-dk)}
.badge-free{background:var(--g100);color:var(--g600)}
.badge-basic{background:var(--blue-lt);color:var(--blue-dk)}
.badge-starter{background:var(--pink-lt);color:#be185d}
.badge-pro{background:var(--purple-lt);color:var(--purple-dk)}

/* ══ TOGGLE ══ */
.toggle{position:relative;width:38px;height:22px;cursor:pointer;display:inline-block}
.toggle input{opacity:0;width:0;height:0}
.slider{position:absolute;inset:0;background:var(--g300);border-radius:20px;transition:.2s}
.slider::after{content:'';position:absolute;left:3px;top:3px;width:16px;height:16px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.toggle input:checked+.slider{background:var(--green)}
.toggle input:checked+.slider::after{transform:translateX(16px)}

/* ══ EMPTY ══ */
.empty{padding:52px;text-align:center;color:var(--g400)}
.empty-icon{font-size:44px;margin-bottom:12px}
.empty p{font-size:14px;font-weight:500}

/* ══ CODE ══ */
.code-block{background:#0d1117;color:#79c0ff;font-family:var(--mono);font-size:12.5px;padding:20px 22px;border-radius:12px;overflow-x:auto;white-space:pre;margin:12px 0;position:relative;line-height:1.8;border:1px solid #21262d}
.copy-btn{position:absolute;right:12px;top:12px;background:rgba(255,255,255,.08);color:#8b949e;border:1px solid rgba(255,255,255,.1);border-radius:7px;padding:5px 12px;font-size:11px;cursor:pointer;font-family:var(--font);font-weight:600;transition:all .15s}
.copy-btn:hover{background:rgba(255,255,255,.15);color:#fff}
.info-box{background:linear-gradient(135deg,#fffbeb,#fef9c3);border:1px solid #fde047;border-radius:10px;padding:14px 18px;font-size:13px;color:#854d0e;margin:12px 0;line-height:1.6;display:flex;gap:10px;align-items:flex-start}

/* ══ SETTINGS LAYOUT ══ */
.settings-outer{padding:22px}
.settings-2col{display:flex;flex-direction:column;gap:0}
.settings-section{margin-bottom:24px}
.settings-section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--g500);margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--g100);display:flex;align-items:center;gap:8px}
.settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.set-item{display:flex;flex-direction:column;gap:6px}
.set-item label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--g600)}
.set-item input[type=text],.set-item input:not([type=color]){padding:9px 13px;border:1.5px solid var(--g200);border-radius:9px;font-size:13.5px;font-family:var(--font);outline:none;background:var(--white);transition:all .15s;box-shadow:var(--shadow-xs)}
.set-item input:focus{border-color:var(--green);box-shadow:0 0 0 3px rgba(0,166,126,.12)}
.color-row{display:flex;align-items:center;gap:9px}
.color-swatch{width:42px;height:38px;padding:3px;border:1.5px solid var(--g200);border-radius:9px;cursor:pointer;box-shadow:var(--shadow-xs)}
.color-row input[type=text]{flex:1}

/* Preview panel — sits BELOW config, full width */
.preview-panel{margin-top:24px;padding-top:22px;border-top:1px solid var(--g100)}
.preview-panel-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--g500);margin-bottom:14px;display:flex;align-items:center;gap:8px}
.preview-card{background:var(--white);border:1px solid var(--g200);border-radius:var(--r-xl);overflow:hidden;box-shadow:var(--shadow)}
.preview-tabs{display:flex;border-bottom:2px solid var(--g100);background:var(--g50);padding:4px 4px 0;gap:4px}
.preview-tab{flex:1;max-width:160px;padding:9px 16px;border:none;background:none;font-size:12px;font-weight:600;color:var(--g500);cursor:pointer;font-family:var(--font);transition:all .15s;border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:center;gap:6px}
.preview-tab.active{color:var(--green-dk);background:var(--white);box-shadow:0 -1px 0 0 var(--g200) inset}
.preview-body{padding:22px;display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:start}
.preview-body-single{padding:22px}
.preview-section-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--g500);margin-bottom:12px}
.preview-widget-wrap{background:var(--g50);border-radius:12px;padding:16px}
.preview-widget{border:1.5px solid var(--g200);border-radius:12px;padding:18px;background:#fff;box-shadow:var(--shadow-sm)}
.mobile-outer{display:flex;flex-direction:column;align-items:center}
.mobile-frame{width:260px;border:8px solid #1c1c1e;border-radius:36px;overflow:hidden;background:#fff;box-shadow:var(--shadow-lg);position:relative}
.mobile-statusbar{height:28px;background:#1c1c1e;display:flex;align-items:center;justify-content:center}
.mobile-dynamic-island{width:90px;height:22px;background:#000;border-radius:20px;margin:3px auto 0}
.mobile-content{padding:14px}

/* ══ CUSTOM CSS ══ */
.css-editor{width:100%;min-height:320px;font-family:var(--mono);font-size:13px;padding:18px;border:1.5px solid var(--g200);border-radius:12px;background:#0d1117;color:#79c0ff;outline:none;resize:vertical;line-height:1.8;transition:border-color .15s}
.css-editor:focus{border-color:var(--green)}

/* ══ APP BLOCK ══ */
.ab-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:22px}
.ab-card{border:2px solid var(--g200);border-radius:14px;padding:22px 18px;cursor:pointer;transition:all .2s;text-align:center;position:relative;background:var(--white)}
.ab-card:hover{border-color:var(--green-md);background:var(--green-lt);transform:translateY(-2px);box-shadow:var(--shadow)}
.ab-card.selected{border-color:var(--green);background:linear-gradient(135deg,var(--green-lt),#ecfdf5);box-shadow:0 0 0 1px var(--green-md),var(--shadow)}
.ab-card .ab-badge{position:absolute;top:-11px;left:50%;transform:translateX(-50%);font-size:10px;font-weight:700;padding:3px 12px;border-radius:20px;white-space:nowrap}
.ab-icon{font-size:38px;margin-bottom:12px;filter:grayscale(0)}
.ab-name{font-size:14px;font-weight:800;margin-bottom:6px;color:var(--g900)}
.ab-desc{font-size:12px;color:var(--g500);line-height:1.6}
.behavior-row{display:flex;align-items:center;gap:14px;padding:16px 22px;border-bottom:1px solid var(--g100)}
.behavior-row:last-child{border-bottom:none}
.behavior-info{flex:1}
.behavior-label{font-size:14px;font-weight:600;color:var(--g800)}
.behavior-desc{font-size:12px;color:var(--g500);margin-top:2px}

/* ══ FAQ ══ */
.faq-item{border:1px solid var(--g200);border-radius:12px;margin-bottom:10px;overflow:hidden;transition:all .2s;box-shadow:var(--shadow-xs)}
.faq-item:hover{border-color:var(--g300)}
.faq-q{width:100%;padding:16px 20px;background:var(--white);border:none;cursor:pointer;font-family:var(--font);font-size:14px;font-weight:600;color:var(--g800);text-align:left;display:flex;align-items:center;justify-content:space-between;gap:12px;transition:background .15s}
.faq-q:hover{background:var(--g50)}
.faq-q.open{background:linear-gradient(135deg,var(--green-lt),#ecfdf5);color:var(--green-xdk)}
.faq-chevron{width:20px;height:20px;border-radius:50%;background:var(--g100);display:flex;align-items:center;justify-content:center;font-size:10px;transition:all .2s;flex-shrink:0;color:var(--g400)}
.faq-q.open .faq-chevron{background:var(--green);color:#fff;transform:rotate(180deg)}
.faq-a{display:none;padding:16px 20px;font-size:14px;color:var(--g600);line-height:1.75;border-top:1px solid var(--g200);background:var(--g50)}
.faq-a.open{display:block}

/* ══ PRICING ══ */
.pricing-toggle-wrap{display:flex;align-items:center;gap:14px;margin-bottom:30px;justify-content:center;padding:16px;background:var(--white);border-radius:14px;border:1px solid var(--g200);width:fit-content;margin-left:auto;margin-right:auto;box-shadow:var(--shadow-sm)}
.ptl{font-size:14px;font-weight:600;color:var(--g400);transition:color .15s}
.ptl.active{color:var(--g900)}
.billing-switch{position:relative;width:52px;height:28px;cursor:pointer;display:inline-block}
.billing-switch input{opacity:0;width:0;height:0}
.billing-track{position:absolute;inset:0;background:var(--g300);border-radius:20px;transition:.2s}
.billing-track::after{content:'';position:absolute;left:4px;top:4px;width:20px;height:20px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.billing-switch input:checked+.billing-track{background:linear-gradient(135deg,var(--green),var(--green-dk))}
.billing-switch input:checked+.billing-track::after{transform:translateX(24px)}
.save-pill{background:linear-gradient(135deg,#fef3c7,#fde68a);color:#92400e;font-size:11px;font-weight:800;padding:4px 12px;border-radius:20px;border:1px solid #fbbf24;letter-spacing:.02em}
.plans-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px}
.plan-card{background:var(--white);border:2px solid var(--g200);border-radius:18px;padding:24px 20px;position:relative;transition:all .22s;box-shadow:var(--shadow-xs)}
.plan-card:hover{transform:translateY(-3px);box-shadow:var(--shadow-lg)}
.plan-card.popular{border-color:var(--green);box-shadow:0 0 0 1px var(--green-md),var(--shadow-lg)}
.plan-card.current-plan{border-color:var(--blue);background:linear-gradient(180deg,var(--blue-lt),var(--white))}
.popular-badge{position:absolute;top:-14px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#f093fb,#ee0979);color:#fff;font-size:11px;font-weight:800;padding:5px 16px;border-radius:20px;white-space:nowrap;box-shadow:0 4px 10px rgba(238,9,121,.4)}
.current-badge{position:absolute;top:-14px;left:50%;transform:translateX(-50%);background:var(--blue);color:#fff;font-size:11px;font-weight:700;padding:5px 16px;border-radius:20px;white-space:nowrap;box-shadow:0 4px 10px rgba(59,130,246,.3)}
.plan-ent{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--purple);margin-bottom:6px}
.plan-name{font-size:20px;font-weight:900;color:var(--g900);margin-bottom:6px;letter-spacing:-.3px}
.plan-desc{font-size:12px;color:var(--g500);margin-bottom:16px;line-height:1.5;min-height:36px}
.plan-price{display:flex;align-items:flex-end;gap:2px;margin-bottom:3px}
.plan-curr{font-size:16px;font-weight:700;color:var(--g700);line-height:2}
.plan-amt{font-size:38px;font-weight:900;color:var(--g900);line-height:1;letter-spacing:-1.5px}
.plan-period{font-size:13px;color:var(--g500);line-height:2.4}
.plan-billed{font-size:11px;color:var(--g400);margin-bottom:16px;min-height:16px;font-weight:500}
.plan-btn{width:100%;padding:11px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;border:none;font-family:var(--font);transition:all .18s;margin-bottom:18px;letter-spacing:-.1px}
.plan-btn:hover{transform:translateY(-1px)}
.plan-btn-free{background:transparent;color:var(--green);border:2px solid var(--green)}.plan-btn-free:hover{background:var(--green-lt)}
.plan-btn-basic{background:linear-gradient(135deg,#60a5fa,#3b82f6);color:#fff;box-shadow:0 3px 10px rgba(59,130,246,.35)}.plan-btn-basic:hover{box-shadow:0 6px 16px rgba(59,130,246,.45)}
.plan-btn-starter{background:linear-gradient(135deg,#f093fb,#ee0979);color:#fff;box-shadow:0 3px 12px rgba(238,9,121,.35)}.plan-btn-starter:hover{box-shadow:0 6px 18px rgba(238,9,121,.45)}
.plan-btn-pro{background:linear-gradient(135deg,#a78bfa,#8b5cf6);color:#fff;box-shadow:0 3px 10px rgba(139,92,246,.35)}.plan-btn-pro:hover{box-shadow:0 6px 16px rgba(139,92,246,.45)}
.plan-btn-current{background:var(--g100);color:var(--g500);cursor:default;border:none;font-weight:600}.plan-btn-current:hover{transform:none}
.plan-features{list-style:none;display:flex;flex-direction:column;gap:8px}
.plan-features li{font-size:12px;color:var(--g700);display:flex;align-items:flex-start;gap:8px;line-height:1.4}
.plan-features li .fi{flex-shrink:0;margin-top:1px}
.plan-features li.no{color:var(--g400);text-decoration:line-through}
hr.plan-div{border:none;border-top:1px solid var(--g100);margin:14px 0}
.limit-banner{background:linear-gradient(135deg,var(--amber-lt),#fef9c3);border:1px solid #fde047;border-radius:12px;padding:14px 18px;margin-bottom:18px;display:flex;align-items:center;gap:12px;font-size:13px;color:var(--amber-dk)}
.payment-info-card{background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1px solid var(--green-md);border-radius:14px;padding:20px;margin-bottom:20px}

/* ══ MODAL ══ */
.modal-ov{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:500;align-items:center;justify-content:center;backdrop-filter:blur(4px)}
.modal-ov.open{display:flex}
.modal-box{background:#fff;border-radius:20px;width:min(680px,95vw);max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 30px 60px rgba(0,0,0,.3)}

/* ══ UPGRADE MODAL ══ */
.upgrade-modal-box{background:#fff;border-radius:20px;width:min(500px,95vw);overflow:hidden;box-shadow:0 30px 60px rgba(0,0,0,.3)}
.upgrade-modal-head{background:linear-gradient(135deg,#065f46 0%,#059669 50%,#00a67e 100%);padding:28px 28px 24px;text-align:center}
.upgrade-modal-icon{font-size:48px;margin-bottom:12px}
.upgrade-modal-title{font-size:22px;font-weight:900;color:#fff;margin-bottom:6px;letter-spacing:-.3px}
.upgrade-modal-sub{font-size:13px;color:rgba(255,255,255,.75)}
.upgrade-modal-body{padding:24px 28px;max-height:75vh;overflow-y:auto}
.upgrade-plan-summary{background:linear-gradient(135deg,var(--green-lt),#f0fdf4);border-radius:12px;padding:16px 18px;margin-bottom:20px;border:1px solid var(--green-md)}
.upgrade-form{display:flex;flex-direction:column;gap:14px}
.upgrade-input-group{display:flex;flex-direction:column;gap:6px}
.upgrade-input-group label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--g600)}
.upgrade-input{padding:11px 14px;border:1.5px solid var(--g200);border-radius:10px;font-size:14px;font-family:var(--font);outline:none;transition:all .15s;background:var(--white)}
.upgrade-input:focus{border-color:var(--green);box-shadow:0 0 0 3px rgba(0,166,126,.12)}
.card-row{display:grid;grid-template-columns:1fr 110px 88px;gap:10px}
.secure-badge{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--g400);justify-content:center;margin-top:4px}
.stripe-element{padding:11px 14px;border:1.5px solid var(--g200);border-radius:10px;background:var(--white);transition:all .15s;min-height:42px}
.stripe-element.StripeElement--focus{border-color:var(--green);box-shadow:0 0 0 3px rgba(0,166,126,.12)}
.trial-note{background:var(--green-lt);border:1px solid var(--green-md);border-radius:10px;padding:12px 16px;font-size:12px;color:var(--green-xdk);text-align:center;font-weight:600;margin-bottom:4px}

/* ══ TOAST ══ */
#toast{position:fixed;bottom:24px;right:24px;padding:13px 22px;border-radius:12px;font-size:13px;font-weight:600;opacity:0;transform:translateY(12px);transition:all .3s cubic-bezier(.34,1.56,.64,1);pointer-events:none;z-index:9999;box-shadow:var(--shadow-xl);display:flex;align-items:center;gap:10px;min-width:220px}
#toast.on{opacity:1;transform:translateY(0)}
#toast.s{background:linear-gradient(135deg,var(--green-xdk),var(--green-dk));color:#fff}
#toast.e{background:linear-gradient(135deg,var(--red-dk),var(--red));color:#fff}
#toast.w{background:linear-gradient(135deg,var(--amber-dk),var(--amber));color:#fff}
#toast.n{background:linear-gradient(135deg,var(--g800),var(--g900));color:#fff}

@media(max-width:960px){.plans-grid{grid-template-columns:repeat(2,1fr)}.settings-2col{grid-template-columns:1fr}}
@media(max-width:640px){.sidebar{display:none}.stats{grid-template-columns:1fr 1fr}.plans-grid{grid-template-columns:1fr}.settings-2col{grid-template-columns:1fr}}

/* ══ DASHBOARD CARDS ══ */
.dash-card{background:var(--white);border:1px solid var(--g200);border-radius:var(--r-xl);padding:22px;cursor:pointer;transition:all .2s;box-shadow:var(--shadow-sm)}
.dash-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-lg);border-color:var(--g300)}
.dash-card-icon{width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:14px}
.dash-card-title{font-size:15px;font-weight:700;color:var(--g900);margin-bottom:6px}
.dash-card-desc{font-size:13px;color:var(--g500);line-height:1.5;margin-bottom:16px}
.dash-card-btn{background:none;border:none;color:var(--green-dk);font-size:13px;font-weight:600;cursor:pointer;padding:0;font-family:var(--font);transition:color .15s}
.dash-card:hover .dash-card-btn{color:var(--green-xdk)}

</style></head><body>

<!-- ═══════════ SIDEBAR ═══════════ -->
<nav class="sidebar">
  <div class="sidebar-brand">
    <div class="brand-icon">📍</div>
    <div><div class="brand-name">ZipCheck</div><div class="brand-sub">Zip Code Checker</div></div>
  </div>
  <div class="sidebar-nav">
    <button class="nav-btn" onclick="nav(this,'dashboard')">
      <span class="nav-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
      </span>Dashboard</button>
    <button class="nav-btn" onclick="nav(this,'rules')">
      <span class="nav-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
      </span>Zip Codes</button>
    <button class="nav-btn" onclick="nav(this,'deliveryrules')">
      <span class="nav-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
      </span>Delivery Rules</button>
    <button class="nav-btn" onclick="nav(this,'waitlist')">
      <span class="nav-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      </span>Waitlist</button>
    <button class="nav-btn" onclick="nav(this,'settings')">
      <span class="nav-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </span>Widget Customization</button>
    <button class="nav-btn" onclick="nav(this,'appsettings')">
      <span class="nav-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </span>Settings</button>
    <button class="nav-btn" onclick="nav(this,'pricing')">
      <span class="nav-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
      </span>Pricing Plans</button>
    <button class="nav-btn" onclick="nav(this,'helpcenter')">
      <span class="nav-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </span>Help &amp; Support</button>
  </div>
  <div class="sidebar-footer">
    <div class="app-toggle-row" onclick="document.getElementById('app-chk').click();event.stopPropagation()">
      <div class="status-indicator" id="status-dot"></div>
      <div style="flex:1"><div class="status-label" id="status-text">App Active</div><div class="status-sub" id="status-sub">Widget live on store</div></div>
      <label class="toggle-pill" onclick="event.stopPropagation()">
        <input type="checkbox" id="app-chk" checked onchange="toggleApp(this.checked)"/>
        <span class="toggle-track"></span>
      </label>
    </div>
  </div>
</nav>

<!-- ═══════════ MAIN CONTENT ═══════════ -->
<main class="content">

<!-- ─── DASHBOARD ─── -->
<div class="page active" id="page-dashboard">
  <div class="page-header" style="align-items:center">
    <div>
      <div class="page-title">Dashboard</div>
      <div class="page-sub" id="dash-plan-label">Free Plan</div>
    </div>
    <button class="btn btn-primary" onclick="navToRules()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Add Zip Code
    </button>
  </div>

  <!-- Live banner -->
  <div id="dash-live-banner" style="background:linear-gradient(135deg,#065f46,#059669);border-radius:14px;padding:20px 24px;margin-bottom:22px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
    <div style="display:flex;align-items:center;gap:12px">
      <div style="width:10px;height:10px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 3px rgba(74,222,128,.3);flex-shrink:0;animation:pulse-green 2s infinite"></div>
      <div>
        <div style="color:#fff;font-weight:700;font-size:15px">Widget is live on your store</div>
        <div style="color:rgba(255,255,255,.75);font-size:13px;margin-top:2px">Any changes you make here apply to your storefront instantly.</div>
      </div>
    </div>
    <button onclick="navToPage('appblock')" style="background:rgba(255,255,255,.15);border:1.5px solid rgba(255,255,255,.3);color:#fff;padding:9px 18px;border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;backdrop-filter:blur(4px)" onmouseover="this.style.background=\'rgba(255,255,255,.25)\'" onmouseout="this.style.background=\'rgba(255,255,255,.15)\'">Open Theme Editor</button>
  </div>

  <!-- Stats bar -->
  <div style="background:var(--white);border:1px solid var(--g200);border-radius:var(--r-xl);padding:22px 28px;margin-bottom:22px;display:grid;grid-template-columns:repeat(5,1fr);gap:0;box-shadow:var(--shadow-sm)">
    <div style="text-align:center;padding:0 16px;border-right:1px solid var(--g100)">
      <div style="font-size:32px;font-weight:900;font-family:var(--mono);color:var(--g900)" id="dash-total">—</div>
      <div style="font-size:12px;color:var(--g500);margin-top:4px;font-weight:500">Zip codes</div>
    </div>
    <div style="text-align:center;padding:0 16px;border-right:1px solid var(--g100)">
      <div style="font-size:32px;font-weight:900;font-family:var(--mono);color:var(--green-dk)" id="dash-allow">—</div>
      <div style="font-size:12px;color:var(--g500);margin-top:4px;font-weight:500">Serviceable</div>
    </div>
    <div style="text-align:center;padding:0 16px;border-right:1px solid var(--g100)">
      <div style="font-size:32px;font-weight:900;font-family:var(--mono);color:var(--red)" id="dash-deny">—</div>
      <div style="font-size:12px;color:var(--g500);margin-top:4px;font-weight:500">Blocked</div>
    </div>
    <div style="text-align:center;padding:0 16px;border-right:1px solid var(--g100)">
      <div style="font-size:32px;font-weight:900;font-family:var(--mono);color:var(--amber-dk)" id="dash-waitlist">0</div>
      <div style="font-size:12px;color:var(--g500);margin-top:4px;font-weight:500">Waitlisted</div>
    </div>
    <div style="text-align:center;padding:0 16px">
      <div style="font-size:32px;font-weight:900;font-family:var(--mono);color:var(--blue)" id="dash-drules">0</div>
      <div style="font-size:12px;color:var(--g500);margin-top:4px;font-weight:500">Delivery rules</div>
    </div>
  </div>

  <!-- Feature cards -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">
    <div class="dash-card" onclick="navToPage('rules')">
      <div class="dash-card-icon" style="background:linear-gradient(135deg,#eff6ff,#dbeafe);color:#2563eb">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
      </div>
      <div class="dash-card-title">Zip Codes</div>
      <div class="dash-card-desc">Add, edit, import, or export your service areas.</div>
      <button class="dash-card-btn">Manage zip codes →</button>
    </div>
    <div class="dash-card" onclick="navToPage('deliveryrules')">
      <div class="dash-card-icon" style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);color:#16a34a">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      </div>
      <div class="dash-card-title">Delivery Rules</div>
      <div class="dash-card-desc">Set fees, cutoff times, and schedules by zone.</div>
      <button class="dash-card-btn">Manage rules →</button>
    </div>
    <div class="dash-card" onclick="navToPage('waitlist')">
      <div class="dash-card-icon" style="background:linear-gradient(135deg,#fffbeb,#fef3c7);color:#d97706">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      </div>
      <div class="dash-card-title">Waitlist</div>
      <div class="dash-card-desc">View customers requesting delivery to new areas.</div>
      <button class="dash-card-btn">View waitlist →</button>
    </div>
    <div class="dash-card" onclick="navToPage('settings')">
      <div class="dash-card-icon" style="background:linear-gradient(135deg,#fdf4ff,#fae8ff);color:#9333ea">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      </div>
      <div class="dash-card-title">Widget</div>
      <div class="dash-card-desc">Customize colors, text, and layout on your store.</div>
      <button class="dash-card-btn">Customize widget →</button>
    </div>
  </div>
</div>

<!-- ─── ZIP RULES ─── -->
<div class="page" id="page-rules">
  <div class="page-header">
    <div><div class="page-title">Zip Codes</div><div class="page-sub">Add, edit, import, or export your service areas.</div></div>
  </div>
  <div id="plan-limit-banner" style="display:none" class="limit-banner">
    ⚠️ <span id="plan-limit-msg" style="flex:1"></span>
    <button class="btn btn-sm btn-primary" onclick="navToPage('pricing')">Upgrade Plan →</button>
  </div>
  <div class="stats">
    <div class="stat blue"><div class="stat-label">Total Rules</div><div class="stat-val b" id="s-total">—</div></div>
    <div class="stat green"><div class="stat-label">Allowed</div><div class="stat-val g" id="s-allow">—</div></div>
    <div class="stat red"><div class="stat-label">Denied</div><div class="stat-val r" id="s-deny">—</div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>➕ Add New Rule</h2></div>
    <div class="form-row">
      <div class="fld" style="max-width:180px"><label>Zip / Postal Code</label><input id="f-zip" placeholder="e.g. 10001" maxlength="12"/></div>
      <div class="fld" style="max-width:160px"><label>Type</label><select id="f-type"><option value="allow">✅ Allow</option><option value="deny">🚫 Deny</option></select></div>
      <div class="fld"><label>Custom Message (optional)</label><input id="f-msg" placeholder="e.g. Delivery in 2 days!"/></div>
      <div class="fld" style="flex:0;min-width:auto;justify-content:flex-end"><label>&nbsp;</label><button class="btn btn-primary" onclick="addRule()">Add Rule</button></div>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h2>📂 Import &amp; Export</h2></div>
    <div style="padding:18px 22px;display:flex;flex-wrap:wrap;gap:14px;align-items:center">
      <div><div style="font-size:10px;font-weight:700;color:var(--g500);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Export All</div><div style="display:flex;gap:8px"><button class="btn btn-ghost btn-sm" onclick="exportRules('csv')">⬇️ CSV</button><button class="btn btn-ghost btn-sm" onclick="exportRules('xlsx')">⬇️ Excel</button></div></div>
      <div style="width:1px;height:40px;background:var(--g200)"></div>
      <div><div style="font-size:10px;font-weight:700;color:var(--g500);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Bulk Import</div><button class="btn btn-primary btn-sm" onclick="checkImportPlan()">⬆️ Upload CSV / Excel</button></div>
      <div style="margin-left:auto"><button class="btn btn-ghost btn-sm" onclick="dlTemplate()">⬇️ Template CSV</button></div>
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

<!-- ─── SETTINGS ─── -->
<div class="page" id="page-settings">
  <div class="page-header">
    <div><div class="page-title">Widget Customization</div><div class="page-sub">Customize colors, text, and layout. Changes reflect live in the preview.</div></div>
    <button class="btn btn-primary" onclick="saveSettings()">💾 Save Settings</button>
  </div>
  <div class="card">
    <div class="card-head"><h2>⚙️ Widget Configuration</h2></div>
    <div class="settings-outer">
      <div class="settings-2col">
        <!-- COLORS -->
        <div class="settings-section">
          <div class="settings-section-title">🎨 Colors</div>
          <div class="settings-grid">
            <div class="set-item"><label>Button Color</label><div class="color-row"><input type="color" class="color-swatch" id="s-btn-c" value="#008060" oninput="sc('s-btn-c','s-btn-ch');upv()"/><input type="text" id="s-btn-ch" value="#008060" maxlength="7" oninput="sh('s-btn-ch','s-btn-c');upv()"/></div></div>
            <div class="set-item"><label>Button Text</label><div class="color-row"><input type="color" class="color-swatch" id="s-btxt-c" value="#ffffff" oninput="sc('s-btxt-c','s-btxt-ch');upv()"/><input type="text" id="s-btxt-ch" value="#ffffff" maxlength="7" oninput="sh('s-btxt-ch','s-btxt-c');upv()"/></div></div>
            <div class="set-item"><label>Success Color</label><div class="color-row"><input type="color" class="color-swatch" id="s-ok-c" value="#008060" oninput="sc('s-ok-c','s-ok-ch');upv()"/><input type="text" id="s-ok-ch" value="#008060" maxlength="7" oninput="sh('s-ok-ch','s-ok-c');upv()"/></div></div>
            <div class="set-item"><label>Error Color</label><div class="color-row"><input type="color" class="color-swatch" id="s-err-c" value="#d72c0d" oninput="sc('s-err-c','s-err-ch');upv()"/><input type="text" id="s-err-ch" value="#d72c0d" maxlength="7" oninput="sh('s-err-ch','s-err-c');upv()"/></div></div>
          </div>
        </div>
        <!-- TEXT & LABELS -->
        <div class="settings-section">
          <div class="settings-section-title">📝 Text &amp; Labels</div>
          <div class="settings-grid">
            <div class="set-item"><label>Widget Title</label><input type="text" id="s-title" value="Check Delivery Availability" oninput="upv()"/></div>
            <div class="set-item"><label>Button Text</label><input type="text" id="s-btn-lbl" value="Check" oninput="upv()"/></div>
            <div class="set-item"><label>Placeholder</label><input type="text" id="s-ph" value="Enter zip / postal code" oninput="upv()"/></div>
            <div class="set-item"><label>Allow Message</label><input type="text" id="s-ok-msg" value="Delivery available!" oninput="upv()"/></div>
            <div class="set-item" style="grid-column:span 2"><label>Deny Message</label><input type="text" id="s-err-msg" value="Delivery not available in your area." oninput="upv()"/></div>
          </div>
        </div>
        <!-- LIVE PREVIEW — below config, side-by-side desktop+mobile -->
        <div class="preview-panel">
          <div class="preview-panel-title">👁 Live Preview</div>
          <div class="preview-card">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0">
              <!-- Desktop preview -->
              <div style="padding:20px;border-right:1px solid var(--g100)">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--g400);margin-bottom:14px;display:flex;align-items:center;gap:6px"><span>🖥</span> Desktop</div>
                <div class="preview-widget-wrap">
                  <div class="preview-widget">
                    <div id="pv-title" style="font-weight:700;font-size:14px;margin-bottom:12px;color:#1a1a1a">📍 Check Delivery Availability</div>
                    <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
                      <input id="pv-input" placeholder="Enter zip / postal code" style="flex:1;min-width:100px;padding:9px 12px;border:1.5px solid #d1d5db;border-radius:8px;font-size:13px;outline:none;font-family:inherit" readonly/>
                      <button id="pv-btn" style="padding:9px 14px;background:#008060;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap">Check</button>
                    </div>
                    <div id="pv-result" style="font-size:12px;font-weight:600;color:#008060">✅ <span id="pv-ok-msg">Delivery available!</span></div>
                    <div id="pv-err" style="font-size:12px;font-weight:600;color:#d72c0d;margin-top:4px">🚫 <span id="pv-err-msg">Not available in your area.</span></div>
                  </div>
                </div>
              </div>
              <!-- Mobile preview -->
              <div style="padding:20px;background:var(--g50)">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--g400);margin-bottom:14px;display:flex;align-items:center;gap:6px"><span>📱</span> Mobile</div>
                <div class="mobile-outer">
                  <div class="mobile-frame">
                    <div class="mobile-statusbar"><div class="mobile-dynamic-island"></div></div>
                    <div class="mobile-content">
                      <div style="font-size:11px;font-weight:700;margin-bottom:9px;color:#1a1a1a">📍 <span id="pvm-title">Check Delivery Availability</span></div>
                      <input id="pvm-input" placeholder="Enter zip / postal code" style="width:100%;padding:8px 10px;border:1.5px solid #d1d5db;border-radius:7px;font-size:12px;outline:none;margin-bottom:7px;box-sizing:border-box;font-family:inherit" readonly/>
                      <button id="pvm-btn" style="width:100%;padding:9px;background:#008060;color:#fff;border:none;border-radius:7px;font-weight:700;font-size:12px;cursor:pointer">Check</button>
                      <div id="pvm-result" style="font-size:11px;font-weight:600;color:#008060;margin-top:7px">✅ <span id="pvm-ok-msg">Delivery available!</span></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div style="padding:12px 20px;background:linear-gradient(90deg,var(--green-lt),#f0fdf4);border-top:1px solid var(--green-md);text-align:center">
              <span style="font-size:11px;font-weight:600;color:var(--green-xdk)">✅ Preview updates in real time · Changes go live on your store after Save</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ─── ANALYTICS ─── -->
<div class="page" id="page-analytics">
  <div class="page-header"><div><div class="page-title">Analytics</div><div class="page-sub">Every zip code check by your customers, in real time.</div></div></div>
  <div class="card">
    <div class="card-head"><h2>📊 Recent Checks</h2><button class="btn btn-ghost btn-sm" onclick="loadAnalytics()">↻ Refresh</button></div>
    <div id="analytics-body" style="padding:22px"><div class="empty"><div class="empty-icon">📊</div><p>Loading...</p></div></div>
  </div>
</div>

<!-- ─── DELIVERY RULES ─── -->
<div class="page" id="page-deliveryrules">
  <div class="page-header">
    <div><div class="page-title">Delivery Rules</div><div class="page-sub">Set custom fees, cutoff times, and delivery schedules by zip code zone.</div></div>
    <button class="btn btn-primary" onclick="addDeliveryRule()">+ Add Rule</button>
  </div>
  <div class="card">
    <div class="card-head"><h2>📋 Delivery Rule Zones</h2><span class="cnt" id="drules-cnt">0</span></div>
    <div style="padding:22px">
      <div id="drules-body">
        <div class="empty"><div class="empty-icon">🚚</div><p>No delivery rules yet — click <strong>Add Rule</strong> to define fees and schedules by zone.</p></div>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h2>💡 About Delivery Rules</h2></div>
    <div style="padding:20px 22px">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">
        <div style="background:var(--blue-lt);border-radius:12px;padding:16px;border:1px solid #bfdbfe">
          <div style="font-size:20px;margin-bottom:8px">💰</div>
          <div style="font-size:13px;font-weight:700;color:var(--blue-dk);margin-bottom:4px">Delivery Fees</div>
          <div style="font-size:12px;color:var(--g600);line-height:1.5">Assign different delivery charges for different zip code zones.</div>
        </div>
        <div style="background:var(--green-lt);border-radius:12px;padding:16px;border:1px solid var(--green-md)">
          <div style="font-size:20px;margin-bottom:8px">⏰</div>
          <div style="font-size:13px;font-weight:700;color:var(--green-xdk);margin-bottom:4px">Cutoff Times</div>
          <div style="font-size:12px;color:var(--g600);line-height:1.5">Set order cutoff times per zone so customers know when same-day delivery is available.</div>
        </div>
        <div style="background:var(--purple-lt);border-radius:12px;padding:16px;border:1px solid #ddd6fe">
          <div style="font-size:20px;margin-bottom:8px">📅</div>
          <div style="font-size:13px;font-weight:700;color:var(--purple-dk);margin-bottom:4px">Schedules</div>
          <div style="font-size:12px;color:var(--g600);line-height:1.5">Define delivery days and blackout dates for each zone.</div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ─── WAITLIST ─── -->
<div class="page" id="page-waitlist">
  <div class="page-header">
    <div><div class="page-title">Waitlist</div><div class="page-sub">Customers who checked a zip code not in your service area.</div></div>
    <button class="btn btn-ghost" onclick="loadWaitlist()">↻ Refresh</button>
  </div>
  <div style="background:linear-gradient(135deg,#fffbeb,#fef3c7);border:1px solid #fde047;border-radius:14px;padding:16px 20px;margin-bottom:18px;display:flex;align-items:center;gap:12px">
    <span style="font-size:20px">📬</span>
    <div>
      <div style="font-size:13px;font-weight:700;color:#92400e">Demand Intelligence</div>
      <div style="font-size:12px;color:#a16207;margin-top:2px;line-height:1.5">These are zip codes customers tried but you don't service yet. Consider adding high-demand areas to grow your reach.</div>
    </div>
  </div>
  <div class="card">
    <div class="card-head">
      <h2>👥 Requested Zip Codes</h2>
      <span class="cnt" id="waitlist-cnt">0</span>
      <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="exportWaitlist()">⬇️ Export CSV</button>
    </div>
    <div id="waitlist-body" style="padding:22px">
      <div class="empty"><div class="empty-icon">📭</div><p>No waitlist entries yet. Entries appear when customers check an unserviced zip code.</p></div>
    </div>
  </div>
</div>

<!-- ─── APP SETTINGS ─── -->
<div class="page" id="page-appsettings">
  <div class="page-header">
    <div><div class="page-title">Settings</div><div class="page-sub">Placement mode, cart behavior, custom CSS, and developer tools.</div></div>
  </div>
  <!-- Placement Mode (from appblock) -->
  <div class="card">
    <div class="card-head"><h2>🧩 Placement Mode</h2><button class="btn btn-primary btn-sm" onclick="saveBlock()">Save Placement</button></div>
    <div class="ab-grid">
      <div class="ab-card selected" id="ab2-auto" onclick="selectBlock2('auto')">
        <div class="ab-icon">⚡</div>
        <div class="ab-name">Auto Placement</div>
        <div class="ab-desc">Widget auto-inserts above Add to Cart &amp; Buy Now. No theme edits needed. Works on all themes.</div>
        <div style="margin-top:14px"><span style="background:var(--green-lt);color:var(--green-xdk);font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px">✅ Recommended</span></div>
      </div>
      <div class="ab-card" id="ab2-manual" onclick="selectBlock2('manual')">
        <div class="ab-icon">✏️</div>
        <div class="ab-name">Manual Placement</div>
        <div class="ab-desc">Auto placement disabled. Use the embed code to place the widget exactly where you need it.</div>
        <div style="margin-top:14px"><span style="background:var(--g100);color:var(--g600);font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px">Manual</span></div>
      </div>
      <div class="ab-card" id="ab2-cart" onclick="selectBlock2('cart')">
        <div class="ab-icon">🛒</div>
        <div class="ab-name">Cart Page Block</div>
        <div class="ab-desc">Widget appears on the cart page before checkout. Validates delivery before order placement.</div>
        <div style="margin-top:14px"><span style="background:var(--blue-lt);color:var(--blue-dk);font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px">Cart</span></div>
      </div>
      <div class="ab-card" id="ab2-popup" onclick="selectBlock2('popup')">
        <div class="ab-icon">💬</div>
        <div class="ab-name">Popup / Overlay</div>
        <div class="ab-desc">Widget triggers as a popup on Add to Cart click. Checks zip before proceeding to cart.</div>
        <div style="margin-top:14px"><span style="background:var(--amber-lt);color:var(--amber-dk);font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px">🔒 Starter+</span></div>
      </div>
    </div>
  </div>
  <!-- Cart Behavior -->
  <div class="card">
    <div class="card-head"><h2>🛒 Cart Button Behavior</h2><button class="btn btn-primary btn-sm" onclick="saveBlock()">Save</button></div>
    <div class="behavior-row">
      <div class="behavior-info">
        <div class="behavior-label">Hide Add to Cart &amp; Buy Now until valid zip entered</div>
        <div class="behavior-desc">Prevents customers from adding items before confirming delivery availability.</div>
      </div>
      <label class="toggle"><input type="checkbox" id="hide-cart-toggle2" checked/><span class="slider"></span></label>
    </div>
    <div class="behavior-row">
      <div class="behavior-info">
        <div class="behavior-label">Show Add to Cart &amp; Buy Now after valid zip confirmed</div>
        <div class="behavior-desc">Reveals cart buttons automatically once delivery is confirmed for the entered zip.</div>
      </div>
      <label class="toggle"><input type="checkbox" id="show-valid-toggle2" checked/><span class="slider"></span></label>
    </div>
  </div>
  <!-- Embed Codes -->
  <div class="card"><div class="card-head"><h2>🔗 Embed &amp; Shortcode</h2></div>
    <div style="padding:18px 22px">
      <p style="font-size:14px;color:var(--g700);margin-bottom:12px">Paste in any Liquid file — product page, cart, homepage:</p>
      <div class="code-block" id="c1b"><button class="copy-btn" onclick="cc('c1b')">Copy</button>&lt;div data-zipcheck
  data-label="Check Delivery Availability"
  data-placeholder="Enter zip / postal code"
  data-btn-text="Check"&gt;
&lt;/div&gt;
&lt;script src="${HOST}/widget.js" async&gt;&lt;/script&gt;</div>
    </div>
  </div>
  <!-- Custom CSS -->
  <div class="card">
    <div class="card-head"><h2>🎨 Custom CSS</h2><button class="btn btn-primary btn-sm" onclick="saveCSS()">💾 Save CSS</button></div>
    <div style="padding:20px 22px">
      <div style="font-size:13px;color:var(--g600);margin-bottom:12px;line-height:1.6">Target the widget using <code style="background:var(--g100);padding:2px 7px;border-radius:5px;font-family:var(--mono);font-size:12px">[data-zipcheck]</code> as the parent selector.</div>
      <textarea class="css-editor" id="css-editor2" placeholder="/* Example */
[data-zipcheck] .zc-wrap {
  border-radius: 20px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
}"></textarea>
    </div>
  </div>
</div>

<!-- ─── EMBED ─── -->
<div class="page" id="page-embed">
  <div class="page-header"><div><div class="page-title">Embed &amp; Shortcode</div><div class="page-sub">Add the zip checker anywhere. You control placement.</div></div></div>
  <div class="card"><div class="card-head"><h2>🏪 Shopify Theme (Recommended)</h2></div>
    <div style="padding:18px 22px">
      <p style="font-size:14px;color:var(--g700);margin-bottom:12px">Paste in any Liquid file — product page, cart, homepage:</p>
      <div class="code-block" id="c1"><button class="copy-btn" onclick="cc('c1')">Copy</button>&lt;div data-zipcheck
  data-label="Check Delivery Availability"
  data-placeholder="Enter zip / postal code"
  data-btn-text="Check"&gt;
&lt;/div&gt;
&lt;script src="${HOST}/widget.js" async&gt;&lt;/script&gt;</div>
      <div class="info-box"><span>💡</span><span>Auto Placement mode inserts the widget above Add to Cart automatically. Use manual embed for precise positioning.</span></div>
    </div>
  </div>
  <div class="card"><div class="card-head"><h2>🌐 iFrame — Any Website</h2></div>
    <div style="padding:18px 22px"><div class="code-block" id="c2"><button class="copy-btn" onclick="cc('c2')">Copy</button>&lt;iframe src="${HOST}/embed" width="100%" height="160" frameborder="0" style="border-radius:12px;border:none"&gt;&lt;/iframe&gt;</div></div>
  </div>
  <div class="card"><div class="card-head"><h2>📝 WordPress Shortcode</h2></div>
    <div style="padding:18px 22px"><div class="code-block" id="c3"><button class="copy-btn" onclick="cc('c3')">Copy</button>function zipcheck_widget() {
  return '&lt;div data-zipcheck&gt;&lt;/div&gt;&lt;script src="${HOST}/widget.js" async&gt;&lt;/script&gt;';
}
add_shortcode('zipcheck', 'zipcheck_widget');</div></div>
  </div>
  <div class="card"><div class="card-head"><h2>🔌 REST API</h2></div>
    <div style="padding:18px 22px"><div class="code-block" id="c4"><button class="copy-btn" onclick="cc('c4')">Copy</button>GET ${HOST}/api/check/lookup/{zipcode}
// Allowed → { "data": { "result":"allow", "message":"..." } }
// Blocked  → { "data": { "result":"block", "message":"..." } }</div></div>
  </div>
</div>

<!-- ─── APP BLOCK ─── -->
<div class="page" id="page-appblock">
  <div class="page-header"><div><div class="page-title">App Block</div><div class="page-sub">Control exactly how and where the widget appears on your storefront.</div></div></div>
  <div class="card">
    <div class="card-head"><h2>🧩 Placement Mode</h2><button class="btn btn-primary btn-sm" onclick="saveBlock()">Save Placement</button></div>
    <div class="ab-grid">
      <div class="ab-card selected" id="ab-auto" onclick="selectBlock('auto')">
        <div class="ab-icon">⚡</div>
        <div class="ab-name">Auto Placement</div>
        <div class="ab-desc">Widget auto-inserts above Add to Cart &amp; Buy Now. No theme edits needed. Works on all themes.</div>
        <div style="margin-top:14px"><span style="background:var(--green-lt);color:var(--green-xdk);font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px">✅ Recommended</span></div>
      </div>
      <div class="ab-card" id="ab-manual" onclick="selectBlock('manual')">
        <div class="ab-icon">✏️</div>
        <div class="ab-name">Manual Placement</div>
        <div class="ab-desc">Auto placement disabled. Use the embed code to place the widget exactly where you need it.</div>
        <div style="margin-top:14px"><span style="background:var(--g100);color:var(--g600);font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px">Manual</span></div>
      </div>
      <div class="ab-card" id="ab-cart" onclick="selectBlock('cart')">
        <div class="ab-icon">🛒</div>
        <div class="ab-name">Cart Page Block</div>
        <div class="ab-desc">Widget appears on the cart page before checkout. Validates delivery before order placement.</div>
        <div style="margin-top:14px"><span style="background:var(--blue-lt);color:var(--blue-dk);font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px">Cart</span></div>
      </div>
      <div class="ab-card" id="ab-popup" onclick="selectBlock('popup')">
        <div class="ab-icon">💬</div>
        <div class="ab-name">Popup / Overlay</div>
        <div class="ab-desc">Widget triggers as a popup on Add to Cart click. Checks zip before proceeding to cart.</div>
        <div style="margin-top:14px"><span id="popup-badge" style="background:var(--amber-lt);color:var(--amber-dk);font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px">🔒 Starter+</span></div>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h2>🛒 Cart Button Behavior</h2><button class="btn btn-primary btn-sm" onclick="saveCartBehavior()">Save Behavior</button></div>
    <div class="behavior-row">
      <div class="behavior-info">
        <div class="behavior-label">Hide Add to Cart &amp; Buy Now until valid zip entered</div>
        <div class="behavior-desc">Prevents customers from adding items before confirming delivery availability.</div>
      </div>
      <label class="toggle"><input type="checkbox" id="hide-cart-toggle" checked/><span class="slider"></span></label>
    </div>
    <div class="behavior-row">
      <div class="behavior-info">
        <div class="behavior-label">Show Add to Cart &amp; Buy Now after valid zip confirmed</div>
        <div class="behavior-desc">Reveals cart buttons automatically once delivery is confirmed for the entered zip.</div>
      </div>
      <label class="toggle"><input type="checkbox" id="show-valid-toggle" checked/><span class="slider"></span></label>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h2>🛠 Shopify Theme Editor (App Block)</h2></div>
    <div style="padding:20px 22px">
      <p style="font-size:14px;color:var(--g700);margin-bottom:16px;line-height:1.6">For Online Store 2.0 themes, add ZipCheck directly from the theme editor as an App Block:</p>
      <ol style="font-size:14px;color:var(--g600);line-height:2.2;padding-left:20px;margin-bottom:16px">
        <li>Go to <strong>Online Store → Themes → Customize</strong></li>
        <li>Open a <strong>Product page</strong> template</li>
        <li>Click <strong>"Add block"</strong> in the Product Information section</li>
        <li>Search for <strong>"ZipCheck"</strong> and add it</li>
        <li>Drag it above the Add to Cart button and click <strong>Save</strong></li>
      </ol>
      <div class="info-box"><span>💡</span><span>Auto Placement works even without theme editor access and is compatible with all Shopify themes including dev stores and vintage themes.</span></div>
    </div>
  </div>
</div>

<!-- ─── CUSTOM CSS ─── -->
<div class="page" id="page-customcss">
  <div class="page-header">
    <div><div class="page-title">Custom CSS</div><div class="page-sub">Write CSS to fully customize the widget beyond built-in settings.</div></div>
    <button class="btn btn-primary" onclick="saveCSS()">💾 Save CSS</button>
  </div>
  <div class="card">
    <div class="card-head"><h2>🎨 CSS Editor</h2></div>
    <div style="padding:20px 22px">
      <div style="font-size:13px;color:var(--g600);margin-bottom:12px;line-height:1.6">Target the widget using <code style="background:var(--g100);padding:2px 7px;border-radius:5px;font-family:var(--mono);font-size:12px">[data-zipcheck]</code> as the parent selector. CSS is injected on every storefront page where the widget is active.</div>
      <textarea class="css-editor" id="css-editor" placeholder="/* Example */
[data-zipcheck] .zc-wrap {
  border-radius: 20px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  background: linear-gradient(135deg, #f0fdf4, #fff);
}
[data-zipcheck] .zc-btn {
  border-radius: 50px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}"></textarea>
      <div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('css-editor').value=''">🗑 Clear</button>
        <span style="font-size:12px;color:var(--g400)">Changes go live on your store after saving.</span>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h2>📖 Useful Selectors</h2></div>
    <div style="padding:20px 22px"><div class="code-block" style="margin:0"><span style="color:#f8d66d">[data-zipcheck] .zc-wrap</span>   <span style="color:#6e7681">/* Widget outer container */</span>
<span style="color:#f8d66d">[data-zipcheck] .zc-lbl</span>    <span style="color:#6e7681">/* Title / label */</span>
<span style="color:#f8d66d">[data-zipcheck] .zc-inp</span>    <span style="color:#6e7681">/* Zip code input field */</span>
<span style="color:#f8d66d">[data-zipcheck] .zc-btn</span>    <span style="color:#6e7681">/* Check button */</span>
<span style="color:#f8d66d">[data-zipcheck] .zc-res</span>    <span style="color:#6e7681">/* Result message area */</span>
<span style="color:#f8d66d">[data-zipcheck] .zc-row</span>    <span style="color:#6e7681">/* Input + button flex row */</span></div></div>
  </div>
</div>

<!-- ─── PRICING ─── -->
<div class="page" id="page-pricing">
  <div class="page-header"><div><div class="page-title">Pricing Plans</div><div class="page-sub">Upgrade to unlock more zip codes, features, and support. All paid plans start with a 3-day free trial.</div></div></div>
  <div class="pricing-toggle-wrap">
    <span class="ptl active" id="lbl-monthly">Monthly</span>
    <label class="billing-switch"><input type="checkbox" id="billing-toggle" onchange="switchBilling(this.checked)"/><span class="billing-track"></span></label>
    <span class="ptl" id="lbl-yearly">Yearly</span>
    <span class="save-pill">💰 Save 20%</span>
  </div>
  <div class="plans-grid">
    <!-- FREE -->
    <div class="plan-card" id="pc-free">
      <div class="plan-name">Free</div>
      <div class="plan-desc">Get started with basic zip code validation for your store</div>
      <div class="plan-price"><span class="plan-curr">$</span><span class="plan-amt">0</span></div>
      <div class="plan-billed">&nbsp;</div>
      <button class="plan-btn plan-btn-free" id="pb-free" onclick="openUpgradeModal('free',0)">Get Started Free</button>
      <hr class="plan-div"/>
      <ul class="plan-features">
        <li><span class="fi">✅</span>Inline widget (product page)</li>
        <li><span class="fi">✅</span>Up to 50 zip codes (manual)</li>
        <li><span class="fi">✅</span>Real-time validation</li>
        <li><span class="fi">✅</span>Disable Add to Cart (invalid)</li>
        <li><span class="fi">✅</span>Global zip code formats</li>
        <li><span class="fi">✅</span>Basic color editor</li>
        <li class="no"><span class="fi">✗</span>Popup / Header Bar modes</li>
        <li class="no"><span class="fi">✗</span>Bulk CSV upload</li>
      </ul>
    </div>
    <!-- BASIC -->
    <div class="plan-card" id="pc-basic">
      <div class="plan-name">Basic</div>
      <div class="plan-desc">For small stores ready to grow their delivery reach</div>
      <div class="plan-price"><span class="plan-curr">$</span><span class="plan-amt" id="p-basic">4.99</span><span class="plan-period">/mo</span></div>
      <div class="plan-billed" id="b-basic">&nbsp;</div>
      <button class="plan-btn plan-btn-basic" id="pb-basic" onclick="openUpgradeModal('basic',4.99)">Start 3-Day Free Trial</button>
      <hr class="plan-div"/>
      <ul class="plan-features">
        <li><span class="fi">✅</span>Inline + Popup widget modes</li>
        <li><span class="fi">✅</span>Up to 500 zip codes</li>
        <li><span class="fi">✅</span>Whitelist + Blacklist</li>
        <li><span class="fi">✅</span>Custom status messages</li>
        <li><span class="fi">✅</span>Full widget design editor</li>
        <li><span class="fi">✅</span>Collection-specific rules</li>
        <li><span class="fi">✅</span>Email support</li>
        <li class="no"><span class="fi">✗</span>CSV bulk upload</li>
      </ul>
    </div>
    <!-- STARTER -->
    <div class="plan-card popular" id="pc-starter">
      <div class="popular-badge">⭐ Most Popular</div>
      <div class="plan-name">Starter</div>
      <div class="plan-desc">Advanced ZIP validation for fast-growing stores</div>
      <div class="plan-price"><span class="plan-curr">$</span><span class="plan-amt" id="p-starter">9.99</span><span class="plan-period">/mo</span></div>
      <div class="plan-billed" id="b-starter">&nbsp;</div>
      <button class="plan-btn plan-btn-starter" id="pb-starter" onclick="openUpgradeModal('starter',9.99)">Start 3-Day Free Trial</button>
      <hr class="plan-div"/>
      <ul class="plan-features">
        <li><span class="fi">✅</span>Inline + Popup + Header Bar</li>
        <li><span class="fi">✅</span>Up to 5,000 zip codes</li>
        <li><span class="fi">✅</span>Bulk CSV upload &amp; export</li>
        <li><span class="fi">✅</span>Ranges &amp; wildcard patterns</li>
        <li><span class="fi">✅</span>Product-specific rules</li>
        <li><span class="fi">✅</span>Dynamic placeholders</li>
        <li><span class="fi">✅</span>Icon / no-icon mode</li>
        <li><span class="fi">✅</span>Chat &amp; email support</li>
      </ul>
    </div>
    <!-- PRO -->
    <div class="plan-card" id="pc-pro">
      <div class="plan-ent">Enterprise</div>
      <div class="plan-name">Pro</div>
      <div class="plan-desc">Full power for high-volume &amp; multi-region stores</div>
      <div class="plan-price"><span class="plan-curr">$</span><span class="plan-amt" id="p-pro">14.99</span><span class="plan-period">/mo</span></div>
      <div class="plan-billed" id="b-pro">&nbsp;</div>
      <button class="plan-btn plan-btn-pro" id="pb-pro" onclick="openUpgradeModal('pro',14.99)">Start 3-Day Free Trial</button>
      <hr class="plan-div"/>
      <ul class="plan-features">
        <li><span class="fi">✅</span>Everything in Starter</li>
        <li><span class="fi">✅</span>Unlimited zip codes</li>
        <li><span class="fi">✅</span>Live Preview design editor</li>
        <li><span class="fi">✅</span>Rule priority management</li>
        <li><span class="fi">✅</span>Incremental CSV updates</li>
        <li><span class="fi">✅</span>Up to 3 stores</li>
        <li><span class="fi">✅</span>Priority support (chat + email)</li>
      </ul>
    </div>
  </div>

  <!-- ─── Cancel Subscription ─── -->
  <div class="card" id="cancel-sub-card" style="display:none;border:1.5px solid var(--red-lt)">
    <div class="card-head" style="background:var(--red-lt)"><h2 style="color:var(--red-dk)">⚠️ Cancel Subscription</h2></div>
    <div style="padding:20px 22px">
      <p style="font-size:14px;color:var(--g600);line-height:1.7;margin-bottom:16px">You are currently on the <strong id="cancel-plan-name" style="color:var(--g900)">—</strong> plan. Cancelling will immediately downgrade your account to the Free plan and stop all future charges.</p>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <button class="btn" style="background:var(--red);color:#fff;border:none;padding:10px 22px;border-radius:9px;font-weight:700;font-size:14px;cursor:pointer" onclick="openCancelModal()">🚫 Cancel Subscription</button>
        <span style="font-size:12px;color:var(--g400)">Your data and rules will be preserved after cancellation.</span>
      </div>
    </div>
  </div>
</div>
<div class="page" id="page-faq">
  <div class="page-header"><div><div class="page-title">Frequently Asked Questions</div><div class="page-sub">Everything you need to know about ZipCheck.</div></div></div>
  <div class="faq-item"><button class="faq-q" onclick="toggleFaq(this)"><span>How does the Zip Code Checker widget work?</span><span class="faq-chevron">▼</span></button><div class="faq-a">The widget is a lightweight script embedded on your Shopify store. When a customer enters their zip or postal code, it instantly checks your allow/deny rules via a fast API call and displays a real-time delivery message — no page reload needed. It works across all Shopify themes including dev stores.</div></div>
  <div class="faq-item"><button class="faq-q" onclick="toggleFaq(this)"><span>How do I add or import zip codes?</span><span class="faq-chevron">▼</span></button><div class="faq-a">Add zip codes manually one at a time using the Add Rule form in the Zip Rules tab. For bulk uploads (Starter plan+), use the Import feature which accepts CSV and Excel files. Your file needs at least a <code style="background:var(--g100);padding:1px 5px;border-radius:4px;font-family:var(--mono);font-size:12px">ZipCode</code> column. Optional columns: <code style="background:var(--g100);padding:1px 5px;border-radius:4px;font-family:var(--mono);font-size:12px">Type</code> (allow/deny) and <code style="background:var(--g100);padding:1px 5px;border-radius:4px;font-family:var(--mono);font-size:12px">Message</code>.</div></div>
  <div class="faq-item"><button class="faq-q" onclick="toggleFaq(this)"><span>Will the widget slow down my store?</span><span class="faq-chevron">▼</span></button><div class="faq-a">No. The widget script loads asynchronously and never blocks page rendering. The zip code lookup API call typically responds in under 100ms. Your store's Core Web Vitals score and page speed are not affected.</div></div>
  <div class="faq-item"><button class="faq-q" onclick="toggleFaq(this)"><span>Can I customize the widget design?</span><span class="faq-chevron">▼</span></button><div class="faq-a">Yes, fully. Use the Settings tab for built-in controls: button colors, success/error colors, all text labels, and placeholder copy. For advanced styling, go to Custom CSS and write your own CSS using the provided selectors. All changes sync to your storefront when saved.</div></div>
  <div class="faq-item"><button class="faq-q" onclick="toggleFaq(this)"><span>What happens if a zip code isn't in my list?</span><span class="faq-chevron">▼</span></button><div class="faq-a">If a customer enters a zip code with no matching rule, the widget shows a neutral message: "No delivery rule found. Please contact us." — so customers are never left confused. You can add rules at any time or use wildcard patterns (Starter+) to cover entire zip code ranges like 100* for 10000–10099.</div></div>
  <div class="faq-item"><button class="faq-q" onclick="toggleFaq(this)"><span>How do I temporarily deactivate the app?</span><span class="faq-chevron">▼</span></button><div class="faq-a">Use the App Active toggle at the bottom of the sidebar. When toggled off, the widget immediately stops loading on your storefront — no code changes needed. Toggle it back on to re-enable. All your rules, settings, and custom CSS are preserved.</div></div>
</div>

<!-- ═══════════════════════════════════════════════════════════
     HELP CENTER PAGE
════════════════════════════════════════════════════════════ -->
<div class="page" id="page-helpcenter" data-merged="true">
  <div class="page-header">
    <div>
      <div class="page-title">📚 Help Center</div>
      <div class="page-sub">Step-by-step guides to install and customize ZipCheck on your Shopify store.</div>
    </div>
  </div>

  <!-- Quick Nav Pills -->
  <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:28px">
    <a href="#hc-install" onclick="document.getElementById('hc-install').scrollIntoView({behavior:'smooth'});return false;" style="padding:8px 18px;background:var(--green-lt);border:1.5px solid var(--green-md);border-radius:20px;font-size:13px;font-weight:700;color:var(--green-xdk);text-decoration:none;cursor:pointer">1. Install App</a>
    <a href="#hc-embed" onclick="document.getElementById('hc-embed').scrollIntoView({behavior:'smooth'});return false;" style="padding:8px 18px;background:var(--g50);border:1.5px solid var(--g200);border-radius:20px;font-size:13px;font-weight:700;color:var(--g700);text-decoration:none;cursor:pointer">2. Add to Theme</a>
    <a href="#hc-placement" onclick="document.getElementById('hc-placement').scrollIntoView({behavior:'smooth'});return false;" style="padding:8px 18px;background:var(--g50);border:1.5px solid var(--g200);border-radius:20px;font-size:13px;font-weight:700;color:var(--g700);text-decoration:none;cursor:pointer">3. Placement Modes</a>
    <a href="#hc-rules" onclick="document.getElementById('hc-rules').scrollIntoView({behavior:'smooth'});return false;" style="padding:8px 18px;background:var(--g50);border:1.5px solid var(--g200);border-radius:20px;font-size:13px;font-weight:700;color:var(--g700);text-decoration:none;cursor:pointer">4. ZIP Rules</a>
    <a href="#hc-settings" onclick="document.getElementById('hc-settings').scrollIntoView({behavior:'smooth'});return false;" style="padding:8px 18px;background:var(--g50);border:1.5px solid var(--g200);border-radius:20px;font-size:13px;font-weight:700;color:var(--g700);text-decoration:none;cursor:pointer">5. Customize Widget</a>
    <a href="#hc-css" onclick="document.getElementById('hc-css').scrollIntoView({behavior:'smooth'});return false;" style="padding:8px 18px;background:var(--g50);border:1.5px solid var(--g200);border-radius:20px;font-size:13px;font-weight:700;color:var(--g700);text-decoration:none;cursor:pointer">6. Custom CSS</a>
  </div>

  <!-- ── STEP 1: Install ── -->
  <div id="hc-install" style="background:#fff;border:1.5px solid var(--g200);border-radius:16px;overflow:hidden;margin-bottom:24px;box-shadow:var(--shadow-sm)">
    <div style="background:linear-gradient(135deg,var(--green-lt),#e6faf3);padding:20px 24px;border-bottom:1.5px solid var(--g200);display:flex;align-items:center;gap:14px">
      <div style="width:36px;height:36px;background:var(--green);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">1</div>
      <div>
        <div style="font-size:16px;font-weight:800;color:var(--g900)">Install ZipCheck on Your Store</div>
        <div style="font-size:13px;color:var(--g500);margin-top:2px">Connect the app to your Shopify store in 2 minutes</div>
      </div>
    </div>
    <div style="padding:24px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px">
        <div style="border:1.5px solid var(--g200);border-radius:12px;overflow:hidden">
          <div style="background:var(--g50);padding:12px 16px;border-bottom:1px solid var(--g200)">
            <span style="font-size:12px;font-weight:700;color:var(--g500);text-transform:uppercase;letter-spacing:.06em">Step 1a</span>
            <div style="font-weight:700;color:var(--g800);margin-top:2px">Open Shopify App Store</div>
          </div>
          <div style="padding:16px">
            <div style="background:var(--g900);border-radius:10px;padding:32px 16px;text-align:center;margin-bottom:12px">
              <div style="font-size:36px;margin-bottom:8px">🏪</div>
              <div style="color:#fff;font-size:13px;font-weight:600">apps.shopify.com</div>
              <div style="color:var(--g400);font-size:12px;margin-top:4px">Search: "ZipCheck"</div>
            </div>
            <p style="font-size:13px;color:var(--g600);line-height:1.6">Go to your Shopify Admin → <strong>Apps</strong> → <strong>Visit Shopify App Store</strong>. Search for <strong>ZipCheck</strong> and click the app listing.</p>
          </div>
        </div>
        <div style="border:1.5px solid var(--g200);border-radius:12px;overflow:hidden">
          <div style="background:var(--g50);padding:12px 16px;border-bottom:1px solid var(--g200)">
            <span style="font-size:12px;font-weight:700;color:var(--g500);text-transform:uppercase;letter-spacing:.06em">Step 1b</span>
            <div style="font-weight:700;color:var(--g800);margin-top:2px">Click "Add App"</div>
          </div>
          <div style="padding:16px">
            <div style="background:linear-gradient(135deg,#008060,#00a870);border-radius:10px;padding:32px 16px;text-align:center;margin-bottom:12px">
              <div style="font-size:36px;margin-bottom:8px">✅</div>
              <div style="color:#fff;font-size:14px;font-weight:700;background:rgba(255,255,255,.2);padding:8px 20px;border-radius:8px;display:inline-block">Add app</div>
            </div>
            <p style="font-size:13px;color:var(--g600);line-height:1.6">Click <strong>Add app</strong> on the listing page. Shopify will ask you to review permissions — click <strong>Install app</strong> to confirm.</p>
          </div>
        </div>
        <div style="border:1.5px solid var(--g200);border-radius:12px;overflow:hidden">
          <div style="background:var(--g50);padding:12px 16px;border-bottom:1px solid var(--g200)">
            <span style="font-size:12px;font-weight:700;color:var(--g500);text-transform:uppercase;letter-spacing:.06em">Step 1c</span>
            <div style="font-weight:700;color:var(--g800);margin-top:2px">You're In!</div>
          </div>
          <div style="padding:16px">
            <div style="background:linear-gradient(135deg,#1e40af,#3b82f6);border-radius:10px;padding:32px 16px;text-align:center;margin-bottom:12px">
              <div style="font-size:36px;margin-bottom:8px">📍</div>
              <div style="color:#fff;font-size:13px;font-weight:600">ZipCheck Dashboard</div>
              <div style="color:rgba(255,255,255,.7);font-size:12px;margin-top:4px">Admin Panel Loaded</div>
            </div>
            <p style="font-size:13px;color:var(--g600);line-height:1.6">You'll land on this dashboard. Your free plan is active immediately with up to 50 zip rules. No credit card required to start.</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ── STEP 2: Add to Theme ── -->
  <div id="hc-embed" style="background:#fff;border:1.5px solid var(--g200);border-radius:16px;overflow:hidden;margin-bottom:24px;box-shadow:var(--shadow-sm)">
    <div style="background:linear-gradient(135deg,#eff6ff,#dbeafe);padding:20px 24px;border-bottom:1.5px solid var(--g200);display:flex;align-items:center;gap:14px">
      <div style="width:36px;height:36px;background:#3b82f6;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;font-weight:800;flex-shrink:0">2</div>
      <div>
        <div style="font-size:16px;font-weight:800;color:var(--g900)">Add the Widget to Your Theme</div>
        <div style="font-size:13px;color:var(--g500);margin-top:2px">Embed the ZipCheck script into your Shopify theme</div>
      </div>
    </div>
    <div style="padding:24px">
      <div style="background:#fffbeb;border:1.5px solid #fde047;border-radius:12px;padding:14px 18px;margin-bottom:20px;display:flex;gap:12px;align-items:flex-start">
        <span style="font-size:20px;flex-shrink:0">💡</span>
        <p style="font-size:13px;color:#92400e;line-height:1.6;margin:0"><strong>Two ways to add the widget:</strong> Option A uses Shopify's App Embed (easiest, no code). Option B uses the embed code for manual placement inside theme files.</p>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px">
        <div style="border:2px solid var(--green);border-radius:12px;overflow:hidden">
          <div style="background:var(--green-lt);padding:12px 16px;border-bottom:1.5px solid var(--green-md);display:flex;align-items:center;gap:8px">
            <span style="background:var(--green);color:#fff;font-size:11px;font-weight:800;padding:2px 8px;border-radius:10px">RECOMMENDED</span>
            <div style="font-weight:700;color:var(--green-xdk)">Option A — App Embed (No Code)</div>
          </div>
          <div style="padding:18px">
            <ol style="font-size:13px;color:var(--g700);line-height:2;padding-left:18px;margin:0">
              <li>In Shopify Admin, go to <strong>Online Store → Themes</strong></li>
              <li>Click <strong>Customize</strong> on your active theme</li>
              <li>In the left panel, click <strong>App embeds</strong> (puzzle icon 🧩)</li>
              <li>Find <strong>ZipCheck Widget</strong> and toggle it <strong>ON</strong></li>
              <li>Click <strong>Save</strong> — widget is now live!</li>
            </ol>
            <div style="background:var(--g900);border-radius:10px;padding:20px;margin-top:16px;text-align:center">
              <div style="color:var(--g400);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">Shopify Theme Editor</div>
              <div style="display:flex;align-items:center;gap:10px;background:var(--g800);padding:10px 14px;border-radius:8px">
                <span style="font-size:18px">🧩</span>
                <span style="color:#fff;font-size:13px;font-weight:600;flex:1;text-align:left">App embeds</span>
                <span style="font-size:10px;color:var(--g400)">▶</span>
              </div>
              <div style="display:flex;align-items:center;gap:10px;background:var(--g800);padding:10px 14px;border-radius:8px;margin-top:6px">
                <span style="font-size:18px">📍</span>
                <span style="color:#fff;font-size:13px;font-weight:600;flex:1;text-align:left">ZipCheck Widget</span>
                <div style="width:36px;height:20px;background:#00a870;border-radius:10px;position:relative"><div style="position:absolute;right:3px;top:3px;width:14px;height:14px;background:#fff;border-radius:50%"></div></div>
              </div>
            </div>
          </div>
        </div>
        <div style="border:1.5px solid var(--g200);border-radius:12px;overflow:hidden">
          <div style="background:var(--g50);padding:12px 16px;border-bottom:1px solid var(--g200)">
            <div style="font-weight:700;color:var(--g800)">Option B — Embed Code (Manual)</div>
          </div>
          <div style="padding:18px">
            <ol style="font-size:13px;color:var(--g700);line-height:2;padding-left:18px;margin:0 0 16px 0">
              <li>In this dashboard, go to <strong>Embed / Shortcode</strong> in the sidebar</li>
              <li>Copy the <strong>Script Tag</strong> code shown there</li>
              <li>In Shopify Admin → <strong>Online Store → Themes → Edit Code</strong></li>
              <li>Open <code style="background:var(--g100);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:12px">theme.liquid</code></li>
              <li>Paste the script just before the closing <code style="background:var(--g100);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:12px">&lt;/body&gt;</code> tag</li>
              <li>Click <strong>Save</strong></li>
            </ol>
            <div style="background:var(--g900);border-radius:10px;padding:16px;font-family:monospace;font-size:12px">
              <div style="color:#6ee7b7">&lt;!-- ZipCheck Widget --&gt;</div>
              <div style="color:#93c5fd">&lt;script</div>
              <div style="color:#fcd34d;padding-left:16px">src="https://zipcheck.app/widget.js"</div>
              <div style="color:#fcd34d;padding-left:16px">data-shop="your-store"</div>
              <div style="color:#93c5fd">&gt;&lt;/script&gt;</div>
              <div style="color:#6b7280;margin-top:6px">&lt;/body&gt;</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ── STEP 3: Placement Modes ── -->
  <div id="hc-placement" style="background:#fff;border:1.5px solid var(--g200);border-radius:16px;overflow:hidden;margin-bottom:24px;box-shadow:var(--shadow-sm)">
    <div style="background:linear-gradient(135deg,#fdf4ff,#f3e8ff);padding:20px 24px;border-bottom:1.5px solid var(--g200);display:flex;align-items:center;gap:14px">
      <div style="width:36px;height:36px;background:#9333ea;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;font-weight:800;flex-shrink:0">3</div>
      <div>
        <div style="font-size:16px;font-weight:800;color:var(--g900)">Choose a Placement Mode</div>
        <div style="font-size:13px;color:var(--g500);margin-top:2px">Control where and how the zip check widget appears</div>
      </div>
    </div>
    <div style="padding:24px">
      <p style="font-size:14px;color:var(--g600);line-height:1.7;margin-bottom:20px">Go to <strong>Settings → Placement Mode</strong> in the sidebar. Choose one of four modes:</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">
        <div style="border:1.5px solid #d1fae5;border-radius:12px;padding:16px;background:#f0fdf4">
          <div style="font-size:24px;margin-bottom:8px">⚡</div>
          <div style="font-weight:800;color:var(--g900);margin-bottom:6px">Auto Placement</div>
          <p style="font-size:13px;color:var(--g600);line-height:1.6;margin:0">Widget auto-injects above the Add to Cart button. <strong>Add to Cart is hidden</strong> until zip is validated. Works on all themes — no code needed.</p>
          <div style="margin-top:10px;font-size:12px;background:#dcfce7;color:#166534;padding:6px 10px;border-radius:6px;font-weight:600">✅ Recommended for most stores</div>
        </div>
        <div style="border:1.5px solid var(--g200);border-radius:12px;padding:16px;background:var(--g50)">
          <div style="font-size:24px;margin-bottom:8px">✏️</div>
          <div style="font-weight:800;color:var(--g900);margin-bottom:6px">Manual Placement</div>
          <p style="font-size:13px;color:var(--g600);line-height:1.6;margin:0">Auto inject is disabled. You place <code style="background:var(--g100);padding:1px 4px;border-radius:4px;font-family:monospace;font-size:11px">[data-zipcheck]</code> divs anywhere in your theme to control exact positioning.</p>
        </div>
        <div style="border:1.5px solid #fef9c3;border-radius:12px;padding:16px;background:#fffbeb">
          <div style="font-size:24px;margin-bottom:8px">🛒</div>
          <div style="font-weight:800;color:var(--g900);margin-bottom:6px">Cart Page Block</div>
          <p style="font-size:13px;color:var(--g600);line-height:1.6;margin:0">Widget appears on the cart page before checkout. <strong>Checkout button is hidden</strong> until zip is validated. Add to Cart on product pages works normally.</p>
        </div>
        <div style="border:1.5px solid #fce7f3;border-radius:12px;padding:16px;background:#fdf2f8">
          <div style="font-size:24px;margin-bottom:8px">💬</div>
          <div style="font-weight:800;color:var(--g900);margin-bottom:6px">Popup / Overlay</div>
          <p style="font-size:13px;color:var(--g600);line-height:1.6;margin:0">A modal popup appears when customers click Add to Cart. They must verify their zip before proceeding. Available on <strong>Starter+ plan</strong>.</p>
        </div>
      </div>
      <div style="margin-top:20px;background:var(--g50);border:1.5px solid var(--g200);border-radius:12px;padding:16px">
        <div style="font-weight:700;font-size:14px;color:var(--g800);margin-bottom:10px">📋 How to change placement:</div>
        <ol style="font-size:13px;color:var(--g600);line-height:2;padding-left:18px;margin:0">
          <li>Click <strong>Settings</strong> in the left sidebar</li>
          <li>Scroll to the <strong>Placement Mode</strong> section</li>
          <li>Click on the mode you want to activate</li>
          <li>Click <strong>Save Placement</strong> — changes go live instantly</li>
        </ol>
      </div>
    </div>
  </div>

  <!-- ── STEP 4: ZIP Rules ── -->
  <div id="hc-rules" style="background:#fff;border:1.5px solid var(--g200);border-radius:16px;overflow:hidden;margin-bottom:24px;box-shadow:var(--shadow-sm)">
    <div style="background:linear-gradient(135deg,#fff7ed,#fed7aa);padding:20px 24px;border-bottom:1.5px solid var(--g200);display:flex;align-items:center;gap:14px">
      <div style="width:36px;height:36px;background:#ea580c;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;font-weight:800;flex-shrink:0">4</div>
      <div>
        <div style="font-size:16px;font-weight:800;color:var(--g900)">Set Up ZIP Code Rules</div>
        <div style="font-size:13px;color:var(--g500);margin-top:2px">Define which zip codes can and cannot receive delivery</div>
      </div>
    </div>
    <div style="padding:24px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;margin-bottom:20px">
        <div>
          <div style="font-weight:700;font-size:14px;color:var(--g800);margin-bottom:12px">➕ Add a Single Rule</div>
          <ol style="font-size:13px;color:var(--g600);line-height:2;padding-left:18px;margin:0">
            <li>Click <strong>Zip Rules</strong> in the sidebar</li>
            <li>In the <strong>Add Rule</strong> form at the top, enter a zip code</li>
            <li>Set the type: <span style="color:#008060;font-weight:700">Allow</span> or <span style="color:#d72c0d;font-weight:700">Deny</span></li>
            <li>Optionally add a custom message (e.g. "Delivery available in 3–5 days")</li>
            <li>Click <strong>Add Rule</strong> — it's live immediately</li>
          </ol>
        </div>
        <div>
          <div style="font-weight:700;font-size:14px;color:var(--g800);margin-bottom:12px">📦 Bulk Import (Starter+)</div>
          <ol style="font-size:13px;color:var(--g600);line-height:2;padding-left:18px;margin:0">
            <li>Prepare a <strong>.csv</strong> or <strong>.xlsx</strong> file</li>
            <li>Required column: <code style="background:var(--g100);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:11px">ZipCode</code></li>
            <li>Optional columns: <code style="background:var(--g100);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:11px">Type</code>, <code style="background:var(--g100);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:11px">Message</code></li>
            <li>Click <strong>Import</strong> button on the Zip Rules page</li>
            <li>Drag & drop your file or click to browse</li>
            <li>Preview and confirm the import</li>
          </ol>
        </div>
      </div>
      <div style="background:var(--g900);border-radius:12px;padding:20px">
        <div style="color:var(--g400);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Example CSV Format</div>
        <table style="width:100%;border-collapse:collapse;font-family:monospace;font-size:13px">
          <tr style="border-bottom:1px solid var(--g700)">
            <td style="padding:8px 12px;color:#93c5fd;font-weight:700">ZipCode</td>
            <td style="padding:8px 12px;color:#93c5fd;font-weight:700">Type</td>
            <td style="padding:8px 12px;color:#93c5fd;font-weight:700">Message</td>
          </tr>
          <tr style="border-bottom:1px solid var(--g800)">
            <td style="padding:8px 12px;color:#6ee7b7">10001</td>
            <td style="padding:8px 12px;color:#6ee7b7">allow</td>
            <td style="padding:8px 12px;color:#9ca3af">Delivery in 2–3 days</td>
          </tr>
          <tr style="border-bottom:1px solid var(--g800)">
            <td style="padding:8px 12px;color:#6ee7b7">10002</td>
            <td style="padding:8px 12px;color:#6ee7b7">allow</td>
            <td style="padding:8px 12px;color:#9ca3af">Same day delivery</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;color:#fca5a5">90210</td>
            <td style="padding:8px 12px;color:#fca5a5">deny</td>
            <td style="padding:8px 12px;color:#9ca3af">Outside delivery zone</td>
          </tr>
        </table>
      </div>
    </div>
  </div>

  <!-- ── STEP 5: Customize Widget ── -->
  <div id="hc-settings" style="background:#fff;border:1.5px solid var(--g200);border-radius:16px;overflow:hidden;margin-bottom:24px;box-shadow:var(--shadow-sm)">
    <div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);padding:20px 24px;border-bottom:1.5px solid var(--g200);display:flex;align-items:center;gap:14px">
      <div style="width:36px;height:36px;background:#16a34a;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;font-weight:800;flex-shrink:0">5</div>
      <div>
        <div style="font-size:16px;font-weight:800;color:var(--g900)">Customize the Widget</div>
        <div style="font-size:13px;color:var(--g500);margin-top:2px">Change colors, labels, and messages to match your brand</div>
      </div>
    </div>
    <div style="padding:24px">
      <p style="font-size:14px;color:var(--g600);margin-bottom:20px;line-height:1.7">All customization is done in <strong>Settings → Widget Appearance</strong>. Every change previews instantly and goes live when you save.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
        <div style="border:1.5px solid var(--g200);border-radius:12px;padding:16px">
          <div style="font-size:20px;margin-bottom:8px">🎨</div>
          <div style="font-weight:700;font-size:14px;color:var(--g800);margin-bottom:6px">Button Color</div>
          <p style="font-size:13px;color:var(--g600);line-height:1.6;margin:0">Set the Check button color to match your store's primary color. Use any hex value.</p>
        </div>
        <div style="border:1.5px solid var(--g200);border-radius:12px;padding:16px">
          <div style="font-size:20px;margin-bottom:8px">✅</div>
          <div style="font-weight:700;font-size:14px;color:var(--g800);margin-bottom:6px">Success / Error Colors</div>
          <p style="font-size:13px;color:var(--g600);line-height:1.6;margin:0">Customize the green success and red error message colors to fit your brand palette.</p>
        </div>
        <div style="border:1.5px solid var(--g200);border-radius:12px;padding:16px">
          <div style="font-size:20px;margin-bottom:8px">🏷️</div>
          <div style="font-weight:700;font-size:14px;color:var(--g800);margin-bottom:6px">Widget Title & Labels</div>
          <p style="font-size:13px;color:var(--g600);line-height:1.6;margin:0">Change the widget heading (e.g. "Check Delivery"), placeholder text, and button label text.</p>
        </div>
        <div style="border:1.5px solid var(--g200);border-radius:12px;padding:16px">
          <div style="font-size:20px;margin-bottom:8px">💬</div>
          <div style="font-weight:700;font-size:14px;color:var(--g800);margin-bottom:6px">Success & Error Messages</div>
          <p style="font-size:13px;color:var(--g600);line-height:1.6;margin:0">Set the message shown when delivery is available or not available in a customer's area.</p>
        </div>
      </div>
    </div>
  </div>

  <!-- ── STEP 6: Custom CSS ── -->
  <div id="hc-css" style="background:#fff;border:1.5px solid var(--g200);border-radius:16px;overflow:hidden;margin-bottom:24px;box-shadow:var(--shadow-sm)">
    <div style="background:linear-gradient(135deg,#f8fafc,#e2e8f0);padding:20px 24px;border-bottom:1.5px solid var(--g200);display:flex;align-items:center;gap:14px">
      <div style="width:36px;height:36px;background:#475569;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;font-weight:800;flex-shrink:0">6</div>
      <div>
        <div style="font-size:16px;font-weight:800;color:var(--g900)">Advanced: Custom CSS</div>
        <div style="font-size:13px;color:var(--g500);margin-top:2px">Fine-tune the widget appearance with your own CSS rules</div>
      </div>
    </div>
    <div style="padding:24px">
      <p style="font-size:14px;color:var(--g600);margin-bottom:20px;line-height:1.7">Go to <strong>Custom CSS</strong> in the sidebar. Write CSS rules targeting the widget's built-in selectors. Your styles are injected into the storefront automatically.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px">
        <div>
          <div style="font-weight:700;font-size:13px;color:var(--g700);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Key CSS Selectors</div>
          <div style="background:var(--g900);border-radius:10px;padding:16px;font-family:monospace;font-size:12px;line-height:2">
            <div><span style="color:#93c5fd">[data-zipcheck]</span> <span style="color:var(--g400)">/* Widget container */</span></div>
            <div><span style="color:#93c5fd">[data-zipcheck] .zc-wrap</span> <span style="color:var(--g400)">/* Inner box */</span></div>
            <div><span style="color:#93c5fd">[data-zipcheck] .zc-inp</span> <span style="color:var(--g400)">/* Text input */</span></div>
            <div><span style="color:#93c5fd">[data-zipcheck] .zc-btn</span> <span style="color:var(--g400)">/* Check button */</span></div>
            <div><span style="color:#93c5fd">[data-zipcheck] .zc-res</span> <span style="color:var(--g400)">/* Result message */</span></div>
            <div><span style="color:#93c5fd">[data-zipcheck] .zc-lbl</span> <span style="color:var(--g400)">/* Widget label */</span></div>
          </div>
        </div>
        <div>
          <div style="font-weight:700;font-size:13px;color:var(--g700);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Example Styles</div>
          <div style="background:var(--g900);border-radius:10px;padding:16px;font-family:monospace;font-size:12px;line-height:2">
            <div><span style="color:#93c5fd">[data-zipcheck] .zc-wrap</span> <span style="color:#fff">{</span></div>
            <div style="padding-left:16px"><span style="color:#fcd34d">border-radius</span><span style="color:#fff">:</span> <span style="color:#6ee7b7">0px</span><span style="color:#fff">;</span></div>
            <div style="padding-left:16px"><span style="color:#fcd34d">box-shadow</span><span style="color:#fff">:</span> <span style="color:#6ee7b7">none</span><span style="color:#fff">;</span></div>
            <div><span style="color:#fff">}</span></div>
            <div style="margin-top:4px"><span style="color:#93c5fd">[data-zipcheck] .zc-btn</span> <span style="color:#fff">{</span></div>
            <div style="padding-left:16px"><span style="color:#fcd34d">border-radius</span><span style="color:#fff">:</span> <span style="color:#6ee7b7">4px</span><span style="color:#fff">;</span></div>
            <div style="padding-left:16px"><span style="color:#fcd34d">font-size</span><span style="color:#fff">:</span> <span style="color:#6ee7b7">16px</span><span style="color:#fff">;</span></div>
            <div><span style="color:#fff">}</span></div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ── Support Footer ── -->
  <div style="background:linear-gradient(135deg,var(--green-xdk),var(--green-dk));border-radius:16px;padding:28px;text-align:center;color:#fff">
    <div style="font-size:28px;margin-bottom:12px">🙋</div>
    <div style="font-size:18px;font-weight:800;margin-bottom:8px">Still need help?</div>
    <p style="font-size:14px;opacity:.85;margin-bottom:20px;line-height:1.6">Our support team is ready to help you set up and configure ZipCheck for your store.</p>
    <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
      <a href="mailto:support@zipcheck.app" style="background:rgba(255,255,255,.15);color:#fff;text-decoration:none;padding:10px 22px;border-radius:10px;font-weight:700;font-size:14px;border:1.5px solid rgba(255,255,255,.3)">📧 Email Support</a>
      <a href="https://docs.zipcheck.app" target="_blank" style="background:#fff;color:var(--green-xdk);text-decoration:none;padding:10px 22px;border-radius:10px;font-weight:700;font-size:14px">📖 Full Docs</a>
    </div>
  </div>
</div>

</main>

<!-- ═══ IMPORT MODAL ═══ -->
<div class="modal-ov" id="imp-modal">
  <div class="modal-box">
    <div style="padding:18px 22px;border-bottom:1px solid var(--g200);display:flex;align-items:center;gap:10px;background:linear-gradient(180deg,var(--white),var(--g50))">
      <span style="font-size:20px">📥</span><span style="font-size:15px;font-weight:800;flex:1">Bulk Import Zip Codes</span>
      <button onclick="closeImport()" style="border:none;background:none;font-size:24px;cursor:pointer;color:var(--g400);line-height:1;width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center" onmouseover="this.style.background='var(--g100)'" onmouseout="this.style.background='none'">&times;</button>
    </div>
    <div style="padding:20px 22px;overflow-y:auto;flex:1">
      <div id="imp-s1">
        <div style="font-size:11px;font-weight:700;color:var(--g500);text-transform:uppercase;letter-spacing:.07em;margin-bottom:14px">Step 1 — Choose File</div>
        <div id="drop-zone" onclick="document.getElementById('file-inp').click()" style="border:2px dashed var(--g300);border-radius:14px;padding:40px 20px;text-align:center;cursor:pointer;transition:all .2s;background:var(--g50)" ondragover="event.preventDefault();this.style.borderColor='var(--green)';this.style.background='var(--green-lt)'" ondragleave="this.style.borderColor='var(--g300)';this.style.background='var(--g50)'" ondrop="handleDrop(event)">
          <div style="font-size:36px;margin-bottom:10px">📄</div>
          <div style="font-size:15px;font-weight:700;margin-bottom:5px">Click to browse or drag &amp; drop</div>
          <div style="font-size:13px;color:var(--g500)">Supports .csv and .xlsx files</div>
          <input type="file" id="file-inp" accept=".csv,.xlsx,.xls" style="display:none" onchange="handleFile(this.files[0])"/>
        </div>
        <div style="margin-top:12px;font-size:13px;color:var(--g500)"><strong>Required:</strong> <code style="background:var(--g100);padding:1px 6px;border-radius:4px;font-family:var(--mono);font-size:12px">ZipCode</code> &nbsp;<strong>Optional:</strong> <code style="background:var(--g100);padding:1px 6px;border-radius:4px;font-family:var(--mono);font-size:12px">Type</code>, <code style="background:var(--g100);padding:1px 6px;border-radius:4px;font-family:var(--mono);font-size:12px">Message</code></div>
      </div>
      <div id="imp-s2" style="display:none">
        <div style="font-size:11px;font-weight:700;color:var(--g500);text-transform:uppercase;letter-spacing:.07em;margin-bottom:14px">Step 2 — Preview &amp; Confirm</div>
        <div id="imp-summary" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"></div>
        <div style="margin-bottom:14px;display:flex;gap:14px;align-items:center;font-size:13px"><strong>Import mode:</strong><label style="cursor:pointer;display:flex;align-items:center;gap:5px"><input type="radio" name="imp-mode" value="merge" checked/> Merge existing</label><label style="cursor:pointer;display:flex;align-items:center;gap:5px"><input type="radio" name="imp-mode" value="replace"/> Replace all</label></div>
        <div style="max-height:260px;overflow-y:auto;border:1px solid var(--g200);border-radius:10px"><table style="width:100%;border-collapse:collapse"><thead style="position:sticky;top:0;background:var(--g50)"><tr><th style="padding:8px 14px;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--g500);text-align:left">Zip</th><th style="padding:8px 14px;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--g500);text-align:left">Type</th><th style="padding:8px 14px;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--g500);text-align:left">Message</th><th style="padding:8px 14px;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--g500);text-align:left">Status</th></tr></thead><tbody id="imp-tbody"></tbody></table></div>
      </div>
    </div>
    <div style="padding:14px 22px;border-top:1px solid var(--g200);display:flex;gap:8px;justify-content:flex-end;background:var(--g50)">
      <button class="btn btn-ghost" onclick="closeImport()">Cancel</button>
      <button class="btn btn-ghost" id="imp-back" style="display:none" onclick="impBack()">← Back</button>
      <button class="btn btn-primary" id="imp-action" onclick="impAction()">Choose File</button>
    </div>
  </div>
</div>

<!-- ═══ UPGRADE MODAL ═══ -->
<div class="modal-ov" id="upgrade-modal">
  <div class="upgrade-modal-box">
    <div class="upgrade-modal-head">
      <div class="upgrade-modal-icon">🚀</div>
      <div class="upgrade-modal-title" id="um-title">Upgrade to Starter</div>
      <div class="upgrade-modal-sub" id="um-sub">3-day free trial · Cancel anytime</div>
    </div>
    <div class="upgrade-modal-body">
      <div class="trial-note">✅ 3-day free trial — you won't be charged until day 4</div>
      <div class="upgrade-plan-summary" id="um-summary">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:15px;font-weight:800;color:var(--g900)" id="um-plan-name">Starter Plan</span>
          <span style="font-size:22px;font-weight:900;color:var(--green)" id="um-price">$9.99/mo</span>
        </div>
        <div style="font-size:12px;color:var(--g500)" id="um-billing-note">Billed monthly · Cancel anytime</div>
      </div>
      <div class="upgrade-form" id="upgrade-form">
        <div class="upgrade-input-group">
          <label>Full Name</label>
          <input class="upgrade-input" id="um-name" placeholder="John Smith" autocomplete="name"/>
        </div>
        <div class="upgrade-input-group">
          <label>Email Address</label>
          <input class="upgrade-input" id="um-email" type="email" placeholder="john@example.com" autocomplete="email"/>
        </div>
        <div class="upgrade-input-group">
          <label>Card Details</label>
          <div id="stripe-card-element" class="stripe-element"></div>
          <div id="stripe-card-errors" style="font-size:12px;color:var(--red);margin-top:5px;min-height:16px"></div>
        </div>
        <button class="btn btn-primary" id="um-submit-btn" style="width:100%;padding:13px;font-size:14px;border-radius:10px;justify-content:center" onclick="submitUpgrade()">
          🔒 Start Free Trial
        </button>
        <div class="secure-badge">🔒 256-bit SSL · Secured by Stripe · Cancel anytime</div>
      </div>
      <button class="btn btn-ghost btn-sm" style="width:100%;justify-content:center;margin-top:10px" onclick="closeUpgradeModal()">Maybe later</button>
    </div>
  </div>
</div>

<!-- ═══ CANCEL SUBSCRIPTION MODAL ═══ -->
<div class="modal-ov" id="cancel-modal">
  <div style="background:#fff;border-radius:20px;width:min(420px,95vw);overflow:hidden;box-shadow:0 30px 60px rgba(0,0,0,.3)">
    <div style="background:linear-gradient(135deg,#7f1d1d,#dc2626);padding:24px 28px;text-align:center">
      <div style="font-size:42px;margin-bottom:10px">⚠️</div>
      <div style="font-size:20px;font-weight:900;color:#fff;margin-bottom:6px">Cancel Subscription?</div>
      <div style="font-size:13px;color:rgba(255,255,255,.75)">This action cannot be undone</div>
    </div>
    <div style="padding:24px 28px">
      <p style="font-size:14px;color:var(--g600);line-height:1.7;margin-bottom:20px">You will immediately lose access to all paid features and be downgraded to the <strong>Free plan</strong>. Your zip code rules and settings will be preserved.</p>
      <div style="background:var(--red-lt);border-radius:10px;padding:14px 16px;margin-bottom:20px;font-size:13px;color:var(--red-dk);font-weight:600">
        ❌ Popup/Header modes · Bulk CSV · Advanced features will be disabled
      </div>
      <div style="display:flex;gap:10px">
        <button onclick="closeCancelModal()" style="flex:1;padding:12px;border:1.5px solid var(--g200);background:#fff;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;color:var(--g700)">Keep My Plan</button>
        <button onclick="confirmCancel()" id="confirm-cancel-btn" style="flex:1;padding:12px;background:var(--red);color:#fff;border:none;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer">Yes, Cancel Now</button>
      </div>
    </div>
  </div>
</div>

<div id="toast"></div>

<script>
const API = window.location.origin;
const PLAN_LIMITS   = { free:50, basic:500, starter:5000, pro:Infinity };
const PLAN_FEATURES = {
  free:    { bulk:false, popup:false, header:false },
  basic:   { bulk:false, popup:true,  header:false },
  starter: { bulk:true,  popup:true,  header:true  },
  pro:     { bulk:true,  popup:true,  header:true  }
};
const PRICES = { monthly:{basic:4.99,starter:9.99,pro:14.99}, yearly:{basic:3.99,starter:7.99,pro:11.99} };
const YEARLY_TOTAL = { basic:47.88, starter:95.88, pro:143.88 };
let currentPlan  = 'free';
let billingMode  = 'monthly';
let selectedBlock = 'auto';
let _upgradeData  = {};


// ── NAV HELPERS ──────────────────────────────────────────────────────────────
function navToRules() {
  const btn = document.querySelector('[onclick*="nav(this,\'rules\')"]');
  nav(btn,'rules');
}
function navToPage(page) {
  const allBtns = document.querySelectorAll('.nav-btn');
  for(const b of allBtns){
    const oc = b.getAttribute('onclick')||'';
    if(oc.includes("'"+page+"'")){nav(b,page);return;}
  }
  // fallback: just show the page
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const el=document.getElementById('page-'+page);
  if(el){el.classList.add('active');}
}
// ── NAV ───────────────────────────────────────────────────────────────────────
function nav(btn, page) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const el = document.getElementById('page-' + page);
  if (el) el.classList.add('active');
  if (page === 'dashboard')     loadDashboard();
  if (page === 'rules')         loadRules();
  if (page === 'analytics')     loadAnalytics();
  if (page === 'settings')      { loadSettings(); }
  if (page === 'customcss')     loadCSS();
  if (page === 'appblock')      loadPlacement();
  if (page === 'appsettings')   { loadPlacement2(); loadCSS2(); }
  if (page === 'waitlist')      loadWaitlist();
  if (page === 'deliveryrules') loadDeliveryRules();
}
function navToPage(page) {
  const btn = document.querySelector('[onclick*="nav(this,\\''+page+'\\')"]') ||
              document.querySelector('[onclick*="nav(this,\\"'+page+'\\")"]');
  if (btn) nav(btn, page);
}

// ── APP TOGGLE ────────────────────────────────────────────────────────────────
async function toggleApp(active) {
  try {
    const r = await fetch(API+'/api/app-status', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({active})});
    const j = await r.json();
    document.getElementById('status-dot').className = 'status-indicator' + (j.active?'':' off');
    document.getElementById('status-text').textContent = j.active ? 'App Active' : 'App Inactive';
    document.getElementById('status-sub').textContent  = j.active ? 'Widget live on store' : 'Widget paused';
    toast(j.active ? '✅ App activated — widget is live' : '⏸️ App paused — widget hidden', j.active ? 's' : 'w');
  } catch(e) { toast('Failed to update app status','e'); }
}

// ── RULES ─────────────────────────────────────────────────────────────────────
async function loadRules() {
  try {
    const r = await fetch(API+'/api/rules');
    const j = await r.json();
    renderRules(j.data || j.rules || (Array.isArray(j)?j:[]));
  } catch(e) {
    document.getElementById('rules-tbody').innerHTML = '<tr><td colspan="5"><div class="empty"><div class="empty-icon">⚠️</div><p>Failed to load rules</p></div></td></tr>';
  }
}
function renderRules(rules) {
  const limit  = PLAN_LIMITS[currentPlan];
  const banner = document.getElementById('plan-limit-banner');
  document.getElementById('rules-cnt').textContent   = rules.length;
  document.getElementById('s-total').textContent     = rules.length;
  document.getElementById('s-allow').textContent     = rules.filter(r=>r.action==='allow'||r.type==='allow').length;
  document.getElementById('s-deny').textContent      = rules.filter(r=>r.action==='deny'||r.action==='block'||r.type==='deny').length;
  if (rules.length >= limit) {
    banner.style.display = 'flex';
    document.getElementById('plan-limit-msg').textContent = 'You\\'ve reached the '+limit+' zip code limit on the '+currentPlan+' plan.';
  } else { banner.style.display = 'none'; }
  const tbody = document.getElementById('rules-tbody');
  if (!rules.length) { tbody.innerHTML = '<tr><td colspan="5"><div class="empty"><div class="empty-icon">📭</div><p>No rules yet — add your first zip code above!</p></div></td></tr>'; return; }
  tbody.innerHTML = rules.map(r => {
    const id   = r.id || r._id;
    const zip  = r.zip || r.zipCode || (r.zipCodes && r.zipCodes[0]) || '—';
    const type = r.action || r.type || 'allow';
    const msg  = r.message || r.errorMessage || '—';
    const ena  = r.status === 'active' || r.enabled !== false;
    return \`<tr><td class="mono">\${zip}</td><td><span class="badge badge-\${type}">\${type==='allow'?'✅ Allow':'🚫 Deny'}</span></td><td style="color:var(--g600);font-size:13px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${msg}</td><td><label class="toggle"><input type="checkbox" \${ena?'checked':''} onchange="toggleRule('\${id}',this.checked)"/><span class="slider"></span></label></td><td><button class="btn btn-danger btn-xs" onclick="deleteRule('\${id}')">Delete</button></td></tr>\`;
  }).join('');
}
async function addRule() {
  const limit = PLAN_LIMITS[currentPlan];
  const cnt   = parseInt(document.getElementById('s-total').textContent) || 0;
  if (cnt >= limit) { toast('⚠️ Zip code limit reached — upgrade your plan to add more', 'w'); return; }
  const zip  = document.getElementById('f-zip').value.trim();
  const type = document.getElementById('f-type').value;
  const msg  = document.getElementById('f-msg').value.trim();
  if (!zip)          { toast('Please enter a zip / postal code', 'e'); return; }
  if (zip.length<4)  { toast('Must be at least 4 characters', 'e'); return; }
  try {
    const body = { name:zip+' Rule', action:type, status:'active', zipCodes:[zip.toUpperCase()], message:type==='allow'?msg:'', errorMessage:type==='deny'?msg:'' };
    const r = await fetch(API+'/api/rules', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j = await r.json();
    if (!r.ok) { toast(j.message || 'Failed to add rule', 'e'); return; }
    document.getElementById('f-zip').value = '';
    document.getElementById('f-msg').value = '';
    toast('✅ Rule added successfully!', 's');
    loadRules();
  } catch(e) { toast('Error: ' + e.message, 'e'); }
}
async function deleteRule(id) { if (!confirm('Delete this rule permanently?')) return; await fetch(API+'/api/rules/'+id, {method:'DELETE'}); toast('🗑️ Rule deleted', 'n'); loadRules(); }
async function toggleRule(id) { try { await fetch(API+'/api/rules/'+id+'/toggle', {method:'PATCH'}); toast('Updated', 's'); } catch(e) { toast('Failed','e'); } }
document.addEventListener('keydown', e => { if (e.target.id === 'f-zip' && e.key === 'Enter') addRule(); });
function checkImportPlan() {
  if (!PLAN_FEATURES[currentPlan].bulk) { toast('🔒 Bulk import requires Starter plan or above', 'w'); return; }
  openImport();
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────
function sc(c,h){document.getElementById(h).value=document.getElementById(c).value;}
function sh(h,c){const v=document.getElementById(h).value;if(/^#[0-9a-f]{6}$/i.test(v))document.getElementById(c).value=v;}
function upv() {
  const btn  = document.getElementById('s-btn-c').value;
  const btxt = document.getElementById('s-btxt-c').value;
  const ok   = document.getElementById('s-ok-c').value;
  const err  = document.getElementById('s-err-c').value;
  const title  = document.getElementById('s-title').value || 'Check Delivery Availability';
  const ph     = document.getElementById('s-ph').value || 'Enter zip / postal code';
  const lbl    = document.getElementById('s-btn-lbl').value || 'Check';
  const okMsg  = document.getElementById('s-ok-msg').value || 'Delivery available!';
  const errMsg = document.getElementById('s-err-msg').value || 'Delivery not available in your area.';
  // Desktop preview
  const pvBtn = document.getElementById('pv-btn');
  if(pvBtn){ pvBtn.style.background=btn; pvBtn.style.color=btxt; pvBtn.textContent=lbl; }
  const pvRes = document.getElementById('pv-result'); if(pvRes) pvRes.style.color=ok;
  const pvErr = document.getElementById('pv-err');    if(pvErr) pvErr.style.color=err;
  const pvInp = document.getElementById('pv-input');  if(pvInp) pvInp.placeholder=ph;
  const pvTit = document.getElementById('pv-title');  if(pvTit) pvTit.textContent='📍 '+title;
  const pvOkM = document.getElementById('pv-ok-msg'); if(pvOkM) pvOkM.textContent=okMsg;
  const pvErM = document.getElementById('pv-err-msg'); if(pvErM) pvErM.textContent=errMsg.length>28?errMsg.slice(0,28)+'…':errMsg;
  // Mobile preview
  const pvmBtn = document.getElementById('pvm-btn');
  if(pvmBtn){ pvmBtn.style.background=btn; pvmBtn.style.color=btxt; pvmBtn.textContent=lbl; }
  const pvmRes = document.getElementById('pvm-result'); if(pvmRes) pvmRes.style.color=ok;
  const pvmInp = document.getElementById('pvm-input');  if(pvmInp) pvmInp.placeholder=ph;
  const pvmTit = document.getElementById('pvm-title');  if(pvmTit) pvmTit.textContent=title;
  const pvmOkM = document.getElementById('pvm-ok-msg'); if(pvmOkM) pvmOkM.textContent=okMsg;
}
async function loadSettings() {
  try {
    const r = await fetch(API+'/api/settings');
    const j = await r.json();
    const s = j.data || j.settings || j || {};
    if(s.btnColor) { document.getElementById('s-btn-c').value=s.btnColor; document.getElementById('s-btn-ch').value=s.btnColor; }
    if(s.btnTxt)   { document.getElementById('s-btxt-c').value=s.btnTxt;  document.getElementById('s-btxt-ch').value=s.btnTxt; }
    if(s.okColor)  { document.getElementById('s-ok-c').value=s.okColor;   document.getElementById('s-ok-ch').value=s.okColor; }
    if(s.errColor) { document.getElementById('s-err-c').value=s.errColor; document.getElementById('s-err-ch').value=s.errColor; }
    if(s.widgetLabel)       document.getElementById('s-title').value    = s.widgetLabel;
    if(s.widgetPlaceholder) document.getElementById('s-ph').value       = s.widgetPlaceholder;
    if(s.okMsg)             document.getElementById('s-ok-msg').value   = s.okMsg;
    if(s.errMsg)            document.getElementById('s-err-msg').value  = s.errMsg;
    upv();
  } catch(e) {}
}
async function saveSettings() {
  const s = {
    btnColor: document.getElementById('s-btn-c').value,
    btnTxt:   document.getElementById('s-btxt-c').value,
    okColor:  document.getElementById('s-ok-c').value,
    errColor: document.getElementById('s-err-c').value,
    widgetLabel:       document.getElementById('s-title').value,
    widgetPlaceholder: document.getElementById('s-ph').value,
    okMsg:  document.getElementById('s-ok-msg').value,
    errMsg: document.getElementById('s-err-msg').value
  };
  try { await fetch(API+'/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)}); toast('💾 Settings saved! Widget updated on your store.','s'); }
  catch(e) { toast('Failed to save settings','e'); }
}

// ── APP BLOCK / PLACEMENT ─────────────────────────────────────────────────────
async function loadPlacement() {
  try {
    const r = await fetch(API+'/api/placement');
    const j = await r.json();
    selectedBlock = j.mode || 'auto';
    ['auto','manual','cart','popup'].forEach(m => document.getElementById('ab-'+m).classList.toggle('selected', m===selectedBlock));
    document.getElementById('hide-cart-toggle').checked  = j.hideCart !== false;
    document.getElementById('show-valid-toggle').checked = j.showOnValid !== false;
  } catch(e) {}
}
function selectBlock(mode) {
  if (mode==='popup' && !PLAN_FEATURES[currentPlan].popup) { toast('🔒 Popup mode requires Starter plan or above','w'); return; }
  selectedBlock = mode;
  ['auto','manual','cart','popup'].forEach(m => document.getElementById('ab-'+m).classList.toggle('selected', m===mode));
}
async function saveBlock() {
  const hideCart   = document.getElementById('hide-cart-toggle').checked;
  const showOnValid = document.getElementById('show-valid-toggle').checked;
  try {
    await fetch(API+'/api/placement',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:selectedBlock,hideCart,showOnValid})});
    toast('✅ Placement saved: '+selectedBlock+' mode','s');
  } catch(e) { toast('Failed to save placement','e'); }
}
async function saveCartBehavior() { await saveBlock(); }

// ── CUSTOM CSS ────────────────────────────────────────────────────────────────
async function loadCSS() {
  try { const r=await fetch(API+'/api/custom-css'); const j=await r.json(); if(j.css) document.getElementById('css-editor').value=j.css; } catch(e) {}
}
async function saveCSS() {
  const ed1 = document.getElementById('css-editor');
  const ed2 = document.getElementById('css-editor2');
  const css = (ed1 ? ed1.value : '') || (ed2 ? ed2.value : '');
  // sync both editors
  if(ed1 && ed2){ if(document.activeElement===ed2) ed1.value=ed2.value; else ed2.value=ed1.value; }
  try { await fetch(API+'/api/custom-css',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({css})}); toast('💾 CSS saved and applied to your store','s'); }
  catch(e) { toast('Failed to save CSS','e'); }
}

// ── ANALYTICS ─────────────────────────────────────────────────────────────────
async function loadAnalytics() {
  const el = document.getElementById('analytics-body');
  try {
    const r = await fetch(API+'/api/analytics/recent?limit=50');
    const j = await r.json();
    const rows = j.data || [];
    if (!rows.length) { el.innerHTML='<div class="empty"><div class="empty-icon">📊</div><p>No checks yet — place the widget on your store to start collecting data!</p></div>'; return; }
    el.innerHTML = '<table><thead><tr><th>Zip</th><th>Result</th><th>Rule</th><th>Time</th></tr></thead><tbody>' +
      rows.map(r=>\`<tr><td class="mono">\${r.zip}</td><td><span class="badge badge-\${r.result}">\${r.result}</span></td><td style="color:var(--g500);font-size:13px">\${r.ruleName||'—'}</td><td style="color:var(--g500);font-size:12px">\${new Date(r.timestamp).toLocaleString()}</td></tr>\`).join('') +
      '</tbody></table>';
  } catch(e) { el.innerHTML='<div class="empty"><div class="empty-icon">⚠️</div><p>Could not load analytics data</p></div>'; }
}

// ── PRICING ───────────────────────────────────────────────────────────────────
function switchBilling(isYearly) {
  billingMode = isYearly ? 'yearly' : 'monthly';
  document.getElementById('lbl-monthly').classList.toggle('active', !isYearly);
  document.getElementById('lbl-yearly').classList.toggle('active', isYearly);
  ['basic','starter','pro'].forEach(plan => {
    const p = PRICES[billingMode][plan];
    document.getElementById('p-'+plan).textContent = p.toFixed(2);
    document.getElementById('b-'+plan).innerHTML = isYearly ? 'Billed $'+YEARLY_TOTAL[plan].toFixed(2)+'/year · Save 20%' : '&nbsp;';
  });
}
function upgradePlan(plan) {
  currentPlan = plan;
  ['free','basic','starter','pro'].forEach(p => {
    const card = document.getElementById('pc-'+p);
    const btn  = document.getElementById('pb-'+p);
    const old  = card.querySelector('.current-badge');
    if (old) old.remove();
    card.classList.remove('current-plan');
    if (p === plan) {
      card.classList.add('current-plan');
      const badge = document.createElement('div');
      badge.className = 'current-badge';
      badge.textContent = '✓ Current Plan';
      card.insertBefore(badge, card.firstChild);
      btn.className = 'plan-btn plan-btn-current';
      btn.textContent = '✓ Current Plan';
      btn.onclick = null;
    } else {
      btn.textContent = p==='free' ? 'Get Started Free' : 'Start 3-Day Free Trial';
      btn.className = 'plan-btn plan-btn-'+p;
      btn.onclick = () => openUpgradeModal(p, p==='free'?0:PRICES[billingMode][p]);
    }
  });
  // Show/hide cancel card dynamically
  const cancelCard = document.getElementById('cancel-sub-card');
  if (plan !== 'free') {
    cancelCard.style.display = 'block';
    const names = {basic:'Basic',starter:'Starter',pro:'Pro'};
    document.getElementById('cancel-plan-name').textContent = (names[plan]||plan) + ' Plan';
  } else {
    cancelCard.style.display = 'none';
  }
}

// ── STRIPE SETUP ──────────────────────────────────────────────────────────────
const STRIPE_PK = 'pk_test_51TA5DoDJPxly7tLbHUCAYmVMByYHqVVNDNnYkYqhKea6SVdW2v1NVVDXJP8VrOsaePmgYTPvvEA0YVZtFEQPAKMx004C5e3rHf';
// Stripe Price IDs — add your real IDs from Stripe Dashboard below
// Dashboard → Products → Create product for each plan → copy Price ID
const STRIPE_PRICES = {
  monthly: {
    basic:   'price_1TA5K4DJPxly7tLbujDSddRS',
    starter: 'price_1TA5KaDJPxly7tLbVM7Vtt7X',
    pro:     'price_1TA5L6DJPxly7tLbEiY9HGtF'
  },
  yearly: {
    basic:   'price_1TA5KMDJPxly7tLbBCJoWsVy',
    starter: 'price_1TA5KpDJPxly7tLbHbcONdh0',
    pro:     'price_1TA5LNDJPxly7tLbb3hmH8vl'
  }
};
let stripe = null, cardElement = null;
function initStripe() {
  if (stripe) return;
  try {
    stripe = Stripe(STRIPE_PK);
    const elements = stripe.elements({
      fonts: [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap' }]
    });
    cardElement = elements.create('card', {
      style: {
        base: { fontFamily: 'Inter, sans-serif', fontSize: '14px', color: '#111827', '::placeholder': { color: '#9ca3af' } },
        invalid: { color: '#ef4444' }
      },
      hidePostalCode: false
    });
    cardElement.mount('#stripe-card-element');
    cardElement.on('change', e => {
      document.getElementById('stripe-card-errors').textContent = e.error ? e.error.message : '';
    });
  } catch(err) { console.log('Stripe init error:', err.message); }
}

// ── UPGRADE MODAL ─────────────────────────────────────────────────────────────
function openUpgradeModal(plan, price) {
  if (plan === 'free') { upgradePlan('free'); toast('✅ You are now on the Free plan','s'); return; }
  _upgradeData = { plan, price };
  const names = { basic:'Basic', starter:'Starter', pro:'Pro' };
  document.getElementById('um-title').textContent    = 'Upgrade to ' + names[plan];
  document.getElementById('um-plan-name').textContent = names[plan] + ' Plan';
  document.getElementById('um-price').textContent    = '$'+price.toFixed(2)+(billingMode==='monthly'?'/mo':'/mo (yearly)');
  document.getElementById('um-billing-note').textContent = billingMode==='monthly'
    ? 'Billed monthly · Cancel anytime'
    : 'Billed $'+YEARLY_TOTAL[plan].toFixed(2)+' yearly · Save 20% · Cancel anytime';
  document.getElementById('um-name').value  = '';
  document.getElementById('um-email').value = '';
  document.getElementById('stripe-card-errors').textContent = '';
  document.getElementById('upgrade-modal').classList.add('open');
  setTimeout(initStripe, 50);
}
function closeUpgradeModal() { document.getElementById('upgrade-modal').classList.remove('open'); }
function openCancelModal()  { document.getElementById('cancel-modal').classList.add('open'); }
function closeCancelModal() { document.getElementById('cancel-modal').classList.remove('open'); }
async function confirmCancel() {
  const btn = document.getElementById('confirm-cancel-btn');
  btn.textContent = '⏳ Cancelling...'; btn.disabled = true;
  try {
    const res  = await fetch(API + '/api/cancel-subscription', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    if (!res.ok || data.error) { toast(data.error || 'Failed to cancel. Please try again.', 'e'); btn.textContent = 'Yes, Cancel Now'; btn.disabled = false; return; }
    closeCancelModal();
    upgradePlan('free');
    toast('✅ Subscription cancelled. You are now on the Free plan.', 's');
  } catch(err) {
    toast('Network error. Please try again.', 'e');
    btn.textContent = 'Yes, Cancel Now'; btn.disabled = false;
  }
}

async function submitUpgrade() {
  const name  = document.getElementById('um-name').value.trim();
  const email = document.getElementById('um-email').value.trim();
  if (!name)  { toast('Please enter your full name','e'); return; }
  if (!email || !email.includes('@')) { toast('Please enter a valid email','e'); return; }
  if (!stripe || !cardElement) { toast('Payment not initialized. Please refresh.','e'); return; }
  const btn = document.getElementById('um-submit-btn');
  btn.innerHTML = '⏳ Processing...'; btn.disabled = true;
  try {
    // Step 1: Create payment method via Stripe.js
    const { paymentMethod, error } = await stripe.createPaymentMethod({
      type: 'card',
      card: cardElement,
      billing_details: { name, email }
    });
    if (error) {
      document.getElementById('stripe-card-errors').textContent = error.message;
      btn.innerHTML = '🔒 Start Free Trial'; btn.disabled = false;
      return;
    }
    // Step 2: Send to your backend to create subscription
    const priceId = STRIPE_PRICES[billingMode][_upgradeData.plan];
    const res = await fetch(API + '/api/create-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentMethodId: paymentMethod.id, email, name, priceId, plan: _upgradeData.plan, billing: billingMode })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      toast(data.error || 'Payment failed. Please try again.', 'e');
      btn.innerHTML = '🔒 Start Free Trial'; btn.disabled = false;
      return;
    }
    // Step 3: Handle 3D Secure if needed
    if (data.requiresAction && data.clientSecret) {
      const { error: confirmError } = await stripe.confirmCardPayment(data.clientSecret);
      if (confirmError) {
        toast(confirmError.message, 'e');
        btn.innerHTML = '🔒 Start Free Trial'; btn.disabled = false;
        return;
      }
    }
    btn.innerHTML = '🔒 Start Free Trial'; btn.disabled = false;
    closeUpgradeModal();
    upgradePlan(_upgradeData.plan);
    toast('🎉 Welcome to '+_upgradeData.plan.charAt(0).toUpperCase()+_upgradeData.plan.slice(1)+'! Your 3-day trial has started.','s');
  } catch(err) {
    toast('Network error. Please try again.','e');
    btn.innerHTML = '🔒 Start Free Trial'; btn.disabled = false;
  }
}

// ── FAQ ───────────────────────────────────────────────────────────────────────
function toggleFaq(btn) {
  const ans = btn.nextElementSibling;
  const isOpen = btn.classList.contains('open');
  document.querySelectorAll('.faq-q').forEach(b=>{b.classList.remove('open');b.nextElementSibling.classList.remove('open');});
  if (!isOpen) { btn.classList.add('open'); ans.classList.add('open'); }
}

// ── UTILS ─────────────────────────────────────────────────────────────────────
function cc(id){const el=document.getElementById(id);const t=el.innerText.replace(/^Copy/,'').trim();navigator.clipboard.writeText(t).then(()=>toast('📋 Copied to clipboard!','s'));}
function toast(msg,type='n'){const t=document.getElementById('toast');t.innerHTML=msg;t.className='on '+type;clearTimeout(t._t);t._t=setTimeout(()=>t.className='',3000);}
function exportRules(fmt){const a=document.createElement('a');a.href=API+'/api/rules/export/download?format='+fmt;a.download='zipcode-rules.'+fmt;document.body.appendChild(a);a.click();document.body.removeChild(a);toast('📥 Downloading '+fmt.toUpperCase()+'...','s');}
function dlTemplate(){const csv='ZipCode,Type,Message\\n10001,allow,Delivery in 2 days!\\n90210,deny,Sorry, no delivery to this area.';const b=new Blob([csv.replace(/\\\\n/g,'\\n')],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='import-template.csv';document.body.appendChild(a);a.click();document.body.removeChild(a);toast('📄 Template downloaded','s');}

// ── IMPORT ────────────────────────────────────────────────────────────────────
var _rows=[];
function openImport(){document.getElementById('imp-modal').classList.add('open');}
function closeImport(){document.getElementById('imp-modal').classList.remove('open');document.getElementById('imp-s1').style.display='block';document.getElementById('imp-s2').style.display='none';document.getElementById('imp-action').textContent='Choose File';document.getElementById('imp-back').style.display='none';document.getElementById('file-inp').value='';_rows=[];}
function impBack(){document.getElementById('imp-s1').style.display='block';document.getElementById('imp-s2').style.display='none';document.getElementById('imp-action').textContent='Choose File';document.getElementById('imp-back').style.display='none';_rows=[];}
function handleDrop(e){e.preventDefault();handleFile(e.dataTransfer.files[0]);}
function handleFile(f){if(!f)return;toast('🔍 Parsing file...','n');const fd=new FormData();fd.append('file',f);fetch(API+'/api/rules/import/preview',{method:'POST',body:fd}).then(r=>r.json()).then(j=>{if(!j.success){toast(j.message||'Parse failed','e');return;}_rows=j.data;showPreview(j);}).catch(e=>toast('Upload failed: '+e.message,'e'));}
function showPreview(j){document.getElementById('imp-s1').style.display='none';document.getElementById('imp-s2').style.display='block';document.getElementById('imp-action').textContent='✅ Import Now';document.getElementById('imp-back').style.display='inline-flex';const valid=j.data.filter(r=>r.valid).length,inv=j.data.filter(r=>!r.valid).length,dup=j.data.filter(r=>r.duplicate).length;document.getElementById('imp-summary').innerHTML='<span style="background:var(--green-lt);color:var(--green-xdk);padding:5px 12px;border-radius:8px;font-size:12px;font-weight:700">✅ '+valid+' valid</span>'+(inv?'<span style="background:var(--red-lt);color:var(--red);padding:5px 12px;border-radius:8px;font-size:12px;font-weight:700">⚠️ '+inv+' invalid</span>':'')+(dup?'<span style="background:#fffbeb;color:var(--amber-dk);padding:5px 12px;border-radius:8px;font-size:12px;font-weight:700">🔁 '+dup+' dupes</span>':'')+'<span style="background:var(--g100);color:var(--g700);padding:5px 12px;border-radius:8px;font-size:12px;font-weight:700">📋 '+j.total+' total</span>';let html='';j.data.slice(0,200).forEach(r=>{const bg=!r.valid?'background:#fff0ee':r.duplicate?'background:#fffde7':'';const st=!r.valid?'<span style="color:var(--red)">⚠ Invalid</span>':r.duplicate?'<span style="color:var(--amber-dk)">🔁 Dup</span>':'<span style="color:var(--green-dk)">✅ New</span>';html+=\`<tr style="border-bottom:1px solid var(--g100);\${bg}"><td style="padding:7px 14px;font-family:var(--mono);font-size:13px">\${r.zip||'—'}</td><td style="padding:7px 14px"><span class="badge badge-\${r.type||'allow'}">\${r.type||'allow'}</span></td><td style="padding:7px 14px;font-size:12px;color:var(--g500)">\${r.message||'—'}</td><td style="padding:7px 14px;font-size:12px">\${st}</td></tr>\`;});document.getElementById('imp-tbody').innerHTML=html;}
function impAction(){if(_rows.length===0){document.getElementById('file-inp').click();return;}const mode=document.querySelector('input[name="imp-mode"]:checked')?.value||'merge';const valid=_rows.filter(r=>r.valid);if(!valid.length){toast('No valid rows to import','e');return;}fetch(API+'/api/rules/import/commit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows:valid,mode})}).then(r=>r.json()).then(j=>{if(!j.success){toast(j.message||'Import failed','e');return;}toast('✅ Imported '+j.added+' rules'+(j.skipped?' ('+j.skipped+' skipped)':''),'s');closeImport();loadRules();}).catch(e=>toast('Error: '+e.message,'e'));}

// ── INIT ──────────────────────────────────────────────────────────────────────
// ── DASHBOARD ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const r = await fetch(API+'/api/rules');
    const j = await r.json();
    const rules = j.data || j.rules || (Array.isArray(j)?j:[]);
    document.getElementById('dash-total').textContent = rules.length;
    document.getElementById('dash-allow').textContent = rules.filter(r=>r.action==='allow'||r.type==='allow').length;
    document.getElementById('dash-deny').textContent  = rules.filter(r=>r.action==='deny'||r.action==='block'||r.type==='deny').length;
  } catch(e) {}
  try {
    const wr = await fetch(API+'/api/analytics/recent?limit=200');
    const wj = await wr.json();
    const noMatch = (wj.data||[]).filter(e=>e.result==='notfound'||e.result==='unknown');
    const uniqueWait = [...new Set(noMatch.map(e=>e.zip))];
    document.getElementById('dash-waitlist').textContent = uniqueWait.length;
    document.getElementById('waitlist-cnt').textContent  = uniqueWait.length;
  } catch(e) {}
}

// ── WAITLIST ──────────────────────────────────────────────────────────────────
async function loadWaitlist() {
  const el = document.getElementById('waitlist-body');
  try {
    const r = await fetch(API+'/api/analytics/recent?limit=500');
    const j = await r.json();
    const noMatch = (j.data||[]).filter(e=>e.result==='notfound'||e.result==='unknown'||e.result==='not_found');
    const zipMap = {};
    noMatch.forEach(e => { if(!zipMap[e.zip]) zipMap[e.zip]={zip:e.zip,count:0,last:e.timestamp}; zipMap[e.zip].count++; if(e.timestamp>zipMap[e.zip].last) zipMap[e.zip].last=e.timestamp; });
    const rows = Object.values(zipMap).sort((a,b)=>b.count-a.count);
    document.getElementById('waitlist-cnt').textContent = rows.length;
    if (!rows.length) { el.innerHTML='<div class="empty"><div class="empty-icon">📭</div><p>No waitlist entries yet. Entries appear when customers check an unserviced zip code.</p></div>'; return; }
    el.innerHTML = '<table><thead><tr><th>Zip / Postal Code</th><th>Requests</th><th>Last Checked</th><th>Action</th></tr></thead><tbody>' +
      rows.map(r=>\`<tr><td class="mono">\${r.zip}</td><td><span style="background:var(--amber-lt);color:var(--amber-dk);padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700">\${r.count} request\${r.count>1?'s':''}</span></td><td style="color:var(--g500);font-size:12px">\${new Date(r.last).toLocaleString()}</td><td><button class="btn btn-primary btn-xs" onclick="addFromWaitlist('\${r.zip}')">+ Add Zone</button></td></tr>\`).join('') +
      '</tbody></table>';
  } catch(e) { el.innerHTML='<div class="empty"><div class="empty-icon">⚠️</div><p>Could not load waitlist data</p></div>'; }
}
function addFromWaitlist(zip) {
  nav(document.querySelectorAll('.nav-btn')[1],'rules');
  setTimeout(()=>{document.getElementById('f-zip').value=zip;document.getElementById('f-zip').focus();toast('📍 Zip '+zip+' pre-filled — set type and save!','n');},200);
}
function exportWaitlist() {
  const rows = document.querySelectorAll('#waitlist-body tr');
  if(!rows.length){toast('No data to export','e');return;}
  let csv='Zip Code,Requests\n';
  rows.forEach(r=>{const cells=r.querySelectorAll('td');if(cells.length>=2)csv+=cells[0].textContent+','+cells[1].textContent.replace(/[^0-9]/g,'')+'\n';});
  const b=new Blob([csv],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='waitlist.csv';document.body.appendChild(a);a.click();document.body.removeChild(a);toast('📥 Waitlist exported','s');
}

// ── DELIVERY RULES ────────────────────────────────────────────────────────────
let deliveryRules = [];
async function loadDeliveryRules() {
  try {
    const r = await fetch(API+'/api/groups');
    const j = await r.json();
    deliveryRules = j.data || j.groups || (Array.isArray(j)?j:[]);
    document.getElementById('drules-cnt').textContent = deliveryRules.length;
    document.getElementById('dash-drules').textContent = deliveryRules.length;
    renderDeliveryRules();
  } catch(e) {}
}
function renderDeliveryRules() {
  const el = document.getElementById('drules-body');
  if (!deliveryRules.length) { el.innerHTML='<div class="empty"><div class="empty-icon">🚚</div><p>No delivery rules yet — click <strong>Add Rule</strong> to define fees and schedules by zone.</p></div>'; return; }
  el.innerHTML = '<table><thead><tr><th>Zone Name</th><th>Zip Codes</th><th>Fee</th><th>Status</th><th>Delete</th></tr></thead><tbody>' +
    deliveryRules.map(r=>{
      const id=r.id||r._id;
      const name=r.name||'Unnamed Zone';
      const zips=(r.zipCodes||[]).length;
      const fee=r.fee?'$'+r.fee:'—';
      const active=r.status==='active'||r.enabled!==false;
      return \`<tr><td style="font-weight:600">\${name}</td><td><span class="cnt">\${zips} zip\${zips!==1?'s':''}</span></td><td style="font-family:var(--mono);font-weight:600">\${fee}</td><td><span class="badge \${active?'badge-allow':'badge-deny'}">\${active?'Active':'Inactive'}</span></td><td><button class="btn btn-danger btn-xs" onclick="deleteDeliveryRule('\${id}')">Delete</button></td></tr>\`;
    }).join('') + '</tbody></table>';
}
async function addDeliveryRule() {
  const name = prompt('Zone name (e.g. "Downtown", "Zone A"):');
  if (!name) return;
  try {
    const r = await fetch(API+'/api/groups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,status:'active',zipCodes:[]})});
    const j = await r.json();
    if(!r.ok){toast(j.message||'Failed to add rule','e');return;}
    toast('✅ Delivery rule "'+name+'" created','s');
    loadDeliveryRules();
  } catch(e){toast('Error: '+e.message,'e');}
}
async function deleteDeliveryRule(id) {
  if(!confirm('Delete this delivery rule zone?'))return;
  await fetch(API+'/api/groups/'+id,{method:'DELETE'});
  toast('🗑️ Rule deleted','n');
  loadDeliveryRules();
}

// ── APP SETTINGS (mirrors appblock) ──────────────────────────────────────────
async function loadPlacement2() {
  try {
    const r = await fetch(API+'/api/placement');
    const j = await r.json();
    selectedBlock = j.mode || 'auto';
    ['auto','manual','cart','popup'].forEach(m => {
      const el = document.getElementById('ab2-'+m);
      if(el) el.classList.toggle('selected', m===selectedBlock);
    });
    const hct = document.getElementById('hide-cart-toggle2');
    const svt = document.getElementById('show-valid-toggle2');
    if(hct) hct.checked = j.hideCart !== false;
    if(svt) svt.checked = j.showOnValid !== false;
  } catch(e) {}
}
function selectBlock2(mode) {
  if (mode==='popup' && !PLAN_FEATURES[currentPlan].popup) { toast('🔒 Popup mode requires Starter plan or above','w'); return; }
  selectedBlock = mode;
  ['auto','manual','cart','popup'].forEach(m => {
    const el1 = document.getElementById('ab-'+m);
    const el2 = document.getElementById('ab2-'+m);
    if(el1) el1.classList.toggle('selected', m===mode);
    if(el2) el2.classList.toggle('selected', m===mode);
  });
}
async function loadCSS2() {
  try { const r=await fetch(API+'/api/custom-css'); const j=await r.json(); const ed=document.getElementById('css-editor2'); if(j.css&&ed) ed.value=j.css; } catch(e) {}
}

(async function initApp(){
  try {
    const r = await fetch(API+'/api/app-status');
    const j = await r.json();
    if (j.plan) { currentPlan = j.plan; }
    const planNames = {free:'Free Plan',basic:'Basic Plan',starter:'Starter Plan',pro:'Pro Plan'};
    const pLabel = document.getElementById('dash-plan-label');
    if(pLabel) pLabel.textContent = planNames[j.plan||'free'] || 'Free Plan';
    document.getElementById('app-chk').checked = j.active !== false;
    document.getElementById('status-dot').className = 'status-indicator' + (j.active!==false?'':' off');
    document.getElementById('status-text').textContent = j.active!==false ? 'App Active' : 'App Inactive';
    document.getElementById('status-sub').textContent  = j.active!==false ? 'Widget live on store' : 'Widget paused';
    const banner = document.getElementById('dash-live-banner');
    if(banner && j.active===false) banner.style.background = 'linear-gradient(135deg,#374151,#1f2937)';
  } catch(e) {}
  // Set dashboard as first active nav
  const dashBtn = document.querySelectorAll('.nav-btn')[0];
  if(dashBtn) dashBtn.classList.add('active');
  loadDashboard(); upv();
})();
</script></body></html>`;
}
