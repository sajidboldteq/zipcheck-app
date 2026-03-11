// backend/routes/rules.js
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { read, write } = require("../utils/store");

const router = express.Router();

// GET all rules
router.get("/", (req, res) => {
  const rules = read("rules") || [];
  const { status, action, search } = req.query;
  let filtered = rules;
  if (status && status !== "all") filtered = filtered.filter(r => r.status === status);
  if (action && action !== "all") filtered = filtered.filter(r => r.action === action);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.zipCodes.some(z => z.includes(q))
    );
  }
  res.json({ success: true, data: filtered, total: rules.length });
});

// GET single rule
router.get("/:id", (req, res) => {
  const rules = read("rules") || [];
  const rule = rules.find(r => r.id === req.params.id);
  if (!rule) return res.status(404).json({ success: false, message: "Rule not found" });
  res.json({ success: true, data: rule });
});

// POST create rule
router.post("/", (req, res) => {
  const rules = read("rules") || [];
  const { name, action, status, zipCodes, products, message, errorMessage } = req.body;

  if (!name || !action || !zipCodes?.length) {
    return res.status(400).json({ success: false, message: "name, action, and zipCodes are required" });
  }

  // Validate zip codes — support 5-digit US, 6-char Indian/Canadian postal codes
  const invalid = zipCodes.find(z => String(z).trim().length < 5 || String(z).trim().length > 7);
  if (invalid) return res.status(400).json({ success: false, message: `Invalid zip/postal code: ${invalid}` });

  const newRule = {
    id: "rule_" + uuidv4().slice(0, 8),
    name,
    action,
    status: status || "active",
    zipCodes,
    products: products || ["All Products"],
    message: message || "",
    errorMessage: errorMessage || "",
    priority: rules.length + 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  rules.push(newRule);
  write("rules", rules);
  res.status(201).json({ success: true, data: newRule });
});

// PUT update rule
router.put("/:id", (req, res) => {
  const rules = read("rules") || [];
  const idx = rules.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Rule not found" });

  // Validate zip codes if provided
  if (req.body.zipCodes) {
    const invalid = req.body.zipCodes.find(z => String(z).trim().length < 5 || String(z).trim().length > 7);
    if (invalid) return res.status(400).json({ success: false, message: `Invalid zip/postal code: ${invalid}` });
  }

  rules[idx] = { ...rules[idx], ...req.body, id: rules[idx].id, updatedAt: new Date().toISOString() };
  write("rules", rules);
  res.json({ success: true, data: rules[idx] });
});

// PATCH toggle status
router.patch("/:id/toggle", (req, res) => {
  const rules = read("rules") || [];
  const idx = rules.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Rule not found" });

  rules[idx].status = rules[idx].status === "active" ? "paused" : "active";
  rules[idx].updatedAt = new Date().toISOString();
  write("rules", rules);
  res.json({ success: true, data: rules[idx] });
});

// POST duplicate rule
router.post("/:id/duplicate", (req, res) => {
  const rules = read("rules") || [];
  const original = rules.find(r => r.id === req.params.id);
  if (!original) return res.status(404).json({ success: false, message: "Rule not found" });

  const copy = {
    ...original,
    id: "rule_" + uuidv4().slice(0, 8),
    name: `${original.name} (Copy)`,
    priority: rules.length + 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  rules.push(copy);
  write("rules", rules);
  res.status(201).json({ success: true, data: copy });
});

// PATCH reorder priorities
router.patch("/reorder", (req, res) => {
  const { orderedIds } = req.body;
  const rules = read("rules") || [];
  const reordered = orderedIds.map((id, i) => {
    const rule = rules.find(r => r.id === id);
    return rule ? { ...rule, priority: i + 1 } : null;
  }).filter(Boolean);
  write("rules", reordered);
  res.json({ success: true, data: reordered });
});

// DELETE rule
router.delete("/:id", (req, res) => {
  const rules = read("rules") || [];
  const filtered = rules.filter(r => r.id !== req.params.id);
  if (filtered.length === rules.length) return res.status(404).json({ success: false, message: "Rule not found" });
  write("rules", filtered);
  res.json({ success: true, message: "Rule deleted" });
});

module.exports = router;
