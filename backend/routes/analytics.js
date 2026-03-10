// backend/routes/analytics.js
// All analytics computed LIVE from real check logs
const express = require("express");
const { read } = require("../utils/store");

const router = express.Router();

function getDayName(dateStr) {
  return new Date(dateStr).toLocaleDateString("en-US", { weekday: "short" });
}

// GET /api/analytics/summary
router.get("/summary", (req, res) => {
  const log = read("analytics_log") || [];
  const rules = read("rules") || [];

  const total = log.length;
  const allowed = log.filter(e => e.result === "allow").length;
  const blocked = log.filter(e => e.result === "block").length;
  const noMatch = log.filter(e => e.result === "no_match").length;
  const uniqueZips = new Set(log.map(e => e.zip)).size;
  const activeRules = rules.filter(r => r.status === "active").length;

  res.json({
    success: true,
    data: {
      totalChecks: total,
      allowedChecks: allowed,
      blockedChecks: blocked,
      noMatchChecks: noMatch,
      uniqueZips,
      activeRules,
      totalRules: rules.length,
      allowRate: total > 0 ? Math.round((allowed / total) * 100) : 0,
    },
  });
});

// GET /api/analytics/weekly
router.get("/weekly", (req, res) => {
  const log = read("analytics_log") || [];
  const days = {};

  // Build last 7 days
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0];
    const label = d.toLocaleDateString("en-US", { weekday: "short" });
    days[key] = { day: label, date: key, checks: 0, allowed: 0, blocked: 0, noMatch: 0 };
  }

  log.forEach(entry => {
    const date = entry.timestamp.split("T")[0];
    if (days[date]) {
      days[date].checks++;
      if (entry.result === "allow") days[date].allowed++;
      else if (entry.result === "block") days[date].blocked++;
      else days[date].noMatch++;
    }
  });

  res.json({ success: true, data: Object.values(days) });
});

// GET /api/analytics/top-zips
router.get("/top-zips", (req, res) => {
  const log = read("analytics_log") || [];
  const limit = parseInt(req.query.limit) || 10;

  const zipMap = {};
  log.forEach(entry => {
    if (!zipMap[entry.zip]) zipMap[entry.zip] = { zip: entry.zip, checks: 0, allowed: 0, blocked: 0, lastResult: entry.result };
    zipMap[entry.zip].checks++;
    if (entry.result === "allow") zipMap[entry.zip].allowed++;
    if (entry.result === "block") zipMap[entry.zip].blocked++;
    zipMap[entry.zip].lastResult = entry.result;
  });

  const sorted = Object.values(zipMap)
    .sort((a, b) => b.checks - a.checks)
    .slice(0, limit);

  res.json({ success: true, data: sorted });
});

// GET /api/analytics/by-rule
router.get("/by-rule", (req, res) => {
  const log = read("analytics_log") || [];
  const rules = read("rules") || [];

  const ruleMap = {};
  log.forEach(entry => {
    if (!entry.ruleId) return;
    if (!ruleMap[entry.ruleId]) ruleMap[entry.ruleId] = { ruleId: entry.ruleId, ruleName: entry.ruleName, checks: 0 };
    ruleMap[entry.ruleId].checks++;
  });

  const data = rules.map(r => ({
    ruleId: r.id,
    ruleName: r.name,
    action: r.action,
    status: r.status,
    checks: ruleMap[r.id]?.checks || 0,
  })).sort((a, b) => b.checks - a.checks);

  res.json({ success: true, data });
});

// GET /api/analytics/recent
router.get("/recent", (req, res) => {
  const log = read("analytics_log") || [];
  const limit = parseInt(req.query.limit) || 20;
  const recent = [...log].reverse().slice(0, limit);
  res.json({ success: true, data: recent });
});

// DELETE /api/analytics/clear — reset all logs
router.delete("/clear", (req, res) => {
  const { write } = require("../utils/store");
  write("analytics_log", []);
  res.json({ success: true, message: "Analytics log cleared" });
});

module.exports = router;
