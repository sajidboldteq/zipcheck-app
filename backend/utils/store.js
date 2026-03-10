// backend/utils/store.js
// Simple JSON file-based persistent store — no database needed
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../data");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function read(name) {
  const fp = filePath(name);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function write(name, data) {
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), "utf8");
}

// ── Seed defaults if not already present ─────────────────────────────────────
function seedIfEmpty(name, defaultData) {
  if (!read(name)) write(name, defaultData);
}

// Seed rules
seedIfEmpty("rules", [
  {
    id: "rule_1",
    name: "New York City Delivery",
    status: "active",
    action: "allow",
    zipCodes: ["10001","10002","10003","10004","10005","10006","10007","10008","10009","10010"],
    products: ["All Products"],
    message: "We deliver to your area! Same-day delivery available.",
    errorMessage: "",
    priority: 1,
    createdAt: "2026-01-10T00:00:00.000Z",
    updatedAt: "2026-01-10T00:00:00.000Z",
  },
  {
    id: "rule_2",
    name: "California Block Zone",
    status: "active",
    action: "block",
    zipCodes: ["90210","90211","90212","90213","90401","90402","90403"],
    products: ["All Products"],
    message: "",
    errorMessage: "Sorry, we don't deliver to your area due to local regulations.",
    priority: 2,
    createdAt: "2026-01-15T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
  },
  {
    id: "rule_3",
    name: "Texas Metro Allow",
    status: "active",
    action: "allow",
    zipCodes: ["73301","73344","75001","75002","75003","75007","75010"],
    products: ["All Products"],
    message: "Great news! We deliver to Texas. Express options available.",
    errorMessage: "",
    priority: 3,
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  },
]);

// Seed groups
seedIfEmpty("groups", [
  {
    id: "grp_1",
    name: "NYC Metro Area",
    description: "All New York City boroughs and surrounding areas",
    zipCodes: ["10001","10002","10003","10004","10005","10006","10007","10008","10009","10010","11201","11202","11203"],
    color: "#005bd3",
    createdAt: "2026-01-10T00:00:00.000Z",
  },
  {
    id: "grp_2",
    name: "Los Angeles Basin",
    description: "Greater LA area zip codes",
    zipCodes: ["90001","90002","90003","90210","90211","90401","90402"],
    color: "#008060",
    createdAt: "2026-01-15T00:00:00.000Z",
  },
]);

// Seed settings
seedIfEmpty("settings", {
  widgetEnabled: true,
  widgetPlacement: "product_page",
  widgetLabel: "Check delivery availability",
  widgetPlaceholder: "Enter your zip code",
  checkOnCart: true,
  blockCheckout: false,
  showMessage: true,
  emailNotify: true,
  notifyEmail: "admin@mystore.com",
  apiKey: "zc_live_" + Math.random().toString(36).slice(2, 26),
  storeName: "My Shopify Store",
  storeUrl: "mystore.myshopify.com",
  updatedAt: new Date().toISOString(),
});

// Seed analytics log (empty to start — filled by real checks)
seedIfEmpty("analytics_log", []);

module.exports = { read, write };
