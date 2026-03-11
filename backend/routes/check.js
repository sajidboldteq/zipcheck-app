// backend/routes/check.js
// Core zip code checking engine — matches a zip against active rules
const express = require("express");
const { read, write } = require("../utils/store");

const router = express.Router();

function findMatchingRule(zip, rules) {
  // Sort by priority, check active rules only
  const active = rules
    .filter(r => r.status === "active")
    .sort((a, b) => a.priority - b.priority);

  for (const rule of active) {
    if (rule.zipCodes.includes(zip)) return rule;
  }
  return null;
}

function logCheck(zip, result, ruleId, ruleName) {
  const log = read("analytics_log") || [];
  log.push({
    id: Date.now().toString(),
    zip,
    result,        // "allow" | "block" | "no_match"
    ruleId: ruleId || null,
    ruleName: ruleName || null,
    timestamp: new Date().toISOString(),
  });
  // Keep last 10,000 entries
  if (log.length > 10000) log.splice(0, log.length - 10000);
  write("analytics_log", log);
}

// POST /api/check — check a single zip code
router.post("/", (req, res) => {
  const { zip, productId } = req.body;

  if (!zip) return res.status(400).json({ success: false, message: "zip is required" });

  const cleanZip = String(zip).trim().toUpperCase();
  // Support US 5-digit, US ZIP+4, Canadian/Indian 6-char postal codes
  if (cleanZip.length < 5 || cleanZip.length > 7) {
    return res.status(400).json({ success: false, message: "Invalid zip / postal code format" });
  }

  const rules = read("rules") || [];
  const match = findMatchingRule(cleanZip, rules);

  let response;
  if (!match) {
    logCheck(cleanZip, "no_match", null, null);
    response = {
      zip: cleanZip,
      result: "no_match",
      allowed: true,  // default allow if no rule matches
      message: "No specific rule found for this area. Delivery may be available.",
      rule: null,
    };
  } else {
    logCheck(cleanZip, match.action, match.id, match.name);
    response = {
      zip: cleanZip,
      result: match.action,
      allowed: match.action === "allow",
      message: match.action === "allow" ? match.message : match.errorMessage,
      rule: { id: match.id, name: match.name },
    };
  }

  res.json({ success: true, data: response });
});

// GET /api/check/lookup/:zip — quick GET version for widgets
router.get("/lookup/:zip", (req, res) => {
  const cleanZip = String(req.params.zip).trim().toUpperCase();
  if (cleanZip.length < 5 || cleanZip.length > 7) {
    return res.status(400).json({ success: false, message: "Invalid zip / postal code format" });
  }

  const rules = read("rules") || [];
  const match = findMatchingRule(cleanZip, rules);

  if (!match) {
    logCheck(cleanZip, "no_match", null, null);
    return res.json({ success: true, data: { zip: cleanZip, result: "no_match", allowed: true, message: "Delivery may be available.", rule: null } });
  }

  logCheck(cleanZip, match.action, match.id, match.name);
  res.json({
    success: true,
    data: {
      zip: cleanZip,
      result: match.action,
      allowed: match.action === "allow",
      message: match.action === "allow" ? match.message : match.errorMessage,
      rule: { id: match.id, name: match.name },
    },
  });
});

module.exports = router;
