// backend/routes/groups.js
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { read, write } = require("../utils/store");

const router = express.Router();

router.get("/", (req, res) => {
  res.json({ success: true, data: read("groups") || [] });
});

router.get("/:id", (req, res) => {
  const groups = read("groups") || [];
  const g = groups.find(g => g.id === req.params.id);
  if (!g) return res.status(404).json({ success: false, message: "Group not found" });
  res.json({ success: true, data: g });
});

router.post("/", (req, res) => {
  const groups = read("groups") || [];
  const { name, description, zipCodes, color } = req.body;
  if (!name || !zipCodes?.length) return res.status(400).json({ success: false, message: "name and zipCodes are required" });
  const invalid = zipCodes.find(z => !/^\d{5}(-\d{4})?$/.test(z));
  if (invalid) return res.status(400).json({ success: false, message: `Invalid zip: ${invalid}` });

  const newGroup = {
    id: "grp_" + uuidv4().slice(0, 8),
    name, description: description || "",
    zipCodes: [...new Set(zipCodes)],
    color: color || "#008060",
    createdAt: new Date().toISOString(),
  };
  groups.push(newGroup);
  write("groups", groups);
  res.status(201).json({ success: true, data: newGroup });
});

router.put("/:id", (req, res) => {
  const groups = read("groups") || [];
  const idx = groups.findIndex(g => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Group not found" });
  if (req.body.zipCodes) {
    const invalid = req.body.zipCodes.find(z => !/^\d{5}(-\d{4})?$/.test(z));
    if (invalid) return res.status(400).json({ success: false, message: `Invalid zip: ${invalid}` });
  }
  groups[idx] = { ...groups[idx], ...req.body, id: groups[idx].id };
  write("groups", groups);
  res.json({ success: true, data: groups[idx] });
});

router.delete("/:id", (req, res) => {
  const groups = read("groups") || [];
  const filtered = groups.filter(g => g.id !== req.params.id);
  if (filtered.length === groups.length) return res.status(404).json({ success: false, message: "Group not found" });
  write("groups", filtered);
  res.json({ success: true, message: "Group deleted" });
});

module.exports = router;
