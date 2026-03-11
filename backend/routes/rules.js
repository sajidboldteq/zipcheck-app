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

// ── Export (MUST be before /:id) ──────────────────────────────────────────────
router.get("/export/download", (req, res) => {
  const rules = read("rules") || [];
  const format = req.query.format || "csv";

  const rows = [];
  rules.forEach(r => {
    const zips = r.zipCodes && r.zipCodes.length ? r.zipCodes : [r.zip || r.zipCode || ""];
    zips.forEach(z => {
      rows.push({ ZipCode: z, Type: r.action || "allow", Message: r.message || r.errorMessage || "" });
    });
  });

  if (format === "xlsx") {
    try {
      const XLSX = require("xlsx");
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Rules");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Disposition", "attachment; filename=zipcode-rules.xlsx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      return res.send(buf);
    } catch (e) {
      return res.status(500).json({ success: false, message: "xlsx package not available: " + e.message });
    }
  }

  const lines = ["ZipCode,Type,Message", ...rows.map(r => `${r.ZipCode},${r.Type},"${(r.Message||"").replace(/"/g,'""')}"`)];
  res.setHeader("Content-Disposition", "attachment; filename=zipcode-rules.csv");
  res.setHeader("Content-Type", "text/csv");
  res.send(lines.join("\n"));
});

// ── Import Preview (MUST be before /:id) ─────────────────────────────────────
router.post("/import/preview", (req, res) => {
  try {
    const multer = require("multer");
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
    upload.single("file")(req, res, (err) => {
      if (err) return res.status(400).json({ success: false, message: err.message });
      if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

      const existing = read("rules") || [];
      const existingZips = new Set();
      existing.forEach(r => {
        const zips = r.zipCodes && r.zipCodes.length ? r.zipCodes : [r.zip || r.zipCode || ""];
        zips.forEach(z => existingZips.add(String(z).trim().toUpperCase()));
      });

      let rows = [];
      const fname = req.file.originalname.toLowerCase();

      if (fname.endsWith(".csv")) {
        const text = req.file.buffer.toString("utf8");
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        const header = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/['"]/g, ""));
        const zipIdx  = header.findIndex(h => h.includes("zip") || h.includes("postal") || h.includes("code"));
        const typeIdx = header.findIndex(h => h === "type" || h === "action");
        const msgIdx  = header.findIndex(h => h.includes("message") || h.includes("msg"));
        if (zipIdx === -1) return res.status(400).json({ success: false, message: "No ZipCode column found. Required: ZipCode" });
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
          const zip  = (cols[zipIdx] || "").trim().toUpperCase();
          if (!zip) continue;
          const type = typeIdx >= 0 ? (cols[typeIdx] || "allow").trim().toLowerCase() : "allow";
          const msg  = msgIdx  >= 0 ? (cols[msgIdx]  || "").trim() : "";
          rows.push({ zip, type: type === "deny" || type === "block" ? "deny" : "allow", message: msg, valid: zip.length >= 5 && zip.length <= 10, duplicate: existingZips.has(zip) });
        }
      } else {
        try {
          const XLSX = require("xlsx");
          const wb   = XLSX.read(req.file.buffer, { type: "buffer" });
          const ws   = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json(ws, { defval: "" });
          data.forEach(row => {
            const zipKey  = Object.keys(row).find(k => k.toLowerCase().includes("zip") || k.toLowerCase().includes("postal"));
            const typeKey = Object.keys(row).find(k => k.toLowerCase() === "type" || k.toLowerCase() === "action");
            const msgKey  = Object.keys(row).find(k => k.toLowerCase().includes("message") || k.toLowerCase().includes("msg"));
            if (!zipKey) return;
            const zip  = String(row[zipKey] || "").trim().toUpperCase();
            if (!zip) return;
            const type = typeKey ? String(row[typeKey] || "allow").trim().toLowerCase() : "allow";
            const msg  = msgKey  ? String(row[msgKey]  || "").trim() : "";
            rows.push({ zip, type: type === "deny" || type === "block" ? "deny" : "allow", message: msg, valid: zip.length >= 5 && zip.length <= 10, duplicate: existingZips.has(zip) });
          });
        } catch (e) {
          return res.status(400).json({ success: false, message: "Could not parse Excel file: " + e.message });
        }
      }
      res.json({ success: true, data: rows, total: rows.length });
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── Import Commit (MUST be before /:id) ──────────────────────────────────────
router.post("/import/commit", (req, res) => {
  try {
    const { rows, mode } = req.body;
    if (!rows || !Array.isArray(rows)) return res.status(400).json({ success: false, message: "rows array required" });

    let rules = mode === "replace" ? [] : (read("rules") || []);

    const existingZips = new Set();
    rules.forEach(r => {
      const zips = r.zipCodes && r.zipCodes.length ? r.zipCodes : [r.zip || r.zipCode || ""];
      zips.forEach(z => existingZips.add(String(z).trim().toUpperCase()));
    });

    let added = 0, skipped = 0;
    rows.forEach(row => {
      const zip = String(row.zip || "").trim().toUpperCase();
      if (!zip || !row.valid) { skipped++; return; }
      if (existingZips.has(zip)) { skipped++; return; }
      rules.push({
        id: "rule_" + require("crypto").randomBytes(4).toString("hex"),
        name: zip + " Rule",
        action: row.type === "deny" ? "deny" : "allow",
        status: "active",
        zipCodes: [zip],
        products: ["All Products"],
        message:      row.type === "allow" ? (row.message || "") : "",
        errorMessage: row.type === "deny"  ? (row.message || "") : "",
        priority:  rules.length + 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      existingZips.add(zip);
      added++;
    });

    write("rules", rules);
    res.json({ success: true, added, skipped, total: rules.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET single rule (AFTER specific routes)
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
