// backend/routes/settings.js
const express = require("express");
const { read, write } = require("../utils/store");
const router = express.Router();

router.get("/", (req, res) => {
  res.json({ success: true, data: read("settings") || {} });
});

router.put("/", (req, res) => {
  const current = read("settings") || {};
  const updated = { ...current, ...req.body, updatedAt: new Date().toISOString() };
  write("settings", updated);
  res.json({ success: true, data: updated });
});

module.exports = router;
