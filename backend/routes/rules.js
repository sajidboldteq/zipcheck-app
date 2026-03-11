// backend/routes/rules.js
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { read, write } = require("../utils/store");
const multer = require("multer");
const XLSX   = require("xlsx");

const router  = express.Router();
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── GET all rules ─────────────────────────────────────────────────────────────
router.get("/", (req, res) => {
  const rules = read("rules") || [];
  const { status, action, search } = req.query;
  let filtered = rules;
  if (status && status !== "all") filtered = filtered.filter(r => r.status === status);
  if (action && action !== "all") filtered = filtered.filter(r => r.action === action);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(r =>
      (r.name||"").toLowerCase().includes(q) ||
      (r.zipCodes||[]).some(z => z.includes(q))
    );
  }
  res.json({ success: true, data: filtered, total: rules.length });
});

// ── GET single rule ───────────────────────────────────────────────────────────
router.get("/:id", (req, res) => {
  if (req.params.id === "export") return; // handled below
  const rules = read("rules") || [];
  const rule = rules.find(r => r.id === req.params.id);
  if (!rule) return res.status(404).json({ success: false, message: "Rule not found" });
  res.json({ success: true, data: rule });
});

// ── EXPORT CSV or XLSX ────────────────────────────────────────────────────────
router.get("/export/download", (req, res) => {
  const rules  = read("rules") || [];
  const format = (req.query.format || "csv").toLowerCase();

  // Flatten: one row per zip code
  const rows = [];
  rules.forEach(r => {
    (r.zipCodes || []).forEach(zip => {
      rows.push({
        ZipCode:       zip,
        Type:          r.action === "allow" ? "allow" : "deny",
        Message:       r.message       || "",
        Status:        r.status        || "active",
        RuleName:      r.name          || "",
        CreatedAt:     r.createdAt     || "",
      });
    });
  });

  if (format === "xlsx") {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ ZipCode:"", Type:"allow", Message:"", Status:"active", RuleName:"", CreatedAt:"" }]);
    // Style header row width
    ws["!cols"] = [{ wch:12 },{ wch:8 },{ wch:35 },{ wch:10 },{ wch:25 },{ wch:22 }];
    XLSX.utils.book_append_sheet(wb, ws, "ZipCodes");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="zipcode-rules-${Date.now()}.xlsx"`);
    return res.send(buf);
  }

  // Default: CSV
  const header = "ZipCode,Type,Message,Status,RuleName,CreatedAt";
  const csvRows = rows.map(r =>
    [r.ZipCode, r.Type, `"${r.Message.replace(/"/g,'""')}"`, r.Status, `"${r.RuleName.replace(/"/g,'""')}"`, r.CreatedAt].join(",")
  );
  const csv = [header, ...csvRows].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="zipcode-rules-${Date.now()}.csv"`);
  res.send(csv);
});

// ── IMPORT preview (parse file, return rows without saving) ──────────────────
router.post("/import/preview", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
  try {
    const rows = parseUploadedFile(req.file);
    const existing = read("rules") || [];
    const existingZips = new Set(existing.flatMap(r => r.zipCodes || []));
    const result = rows.map(row => ({
      ...row,
      duplicate: existingZips.has(row.zip),
    }));
    res.json({ success: true, data: result, total: result.length,
      duplicates: result.filter(r => r.duplicate).length,
      invalid: result.filter(r => !r.valid).length,
    });
  } catch (e) {
    res.status(400).json({ success: false, message: "Parse error: " + e.message });
  }
});

// ── IMPORT commit (actually save after preview confirmed) ────────────────────
router.post("/import/commit", (req, res) => {
  const { rows, mode = "merge" } = req.body; // mode: "merge" | "replace"
  if (!rows?.length) return res.status(400).json({ success: false, message: "No rows to import" });

  const rules    = mode === "replace" ? [] : (read("rules") || []);
  const existing = new Set(rules.flatMap(r => r.zipCodes || []));
  let added = 0, skipped = 0;

  // Group rows by action+message for efficiency
  const groups = {};
  rows.filter(r => r.valid !== false).forEach(row => {
    const key = `${row.type||"allow"}__${row.message||""}`;
    if (!groups[key]) groups[key] = { action: row.type||"allow", message: row.message||"", zips: [] };
    if (!existing.has(row.zip)) { groups[key].zips.push(row.zip); added++; }
    else skipped++;
  });

  Object.entries(groups).forEach(([key, g]) => {
    if (!g.zips.length) return;
    rules.push({
      id:        "rule_" + uuidv4().slice(0, 8),
      name:      `Imported ${g.action} (${g.zips.length} codes)`,
      action:    g.action,
      status:    "active",
      zipCodes:  g.zips,
      products:  ["All Products"],
      message:   g.message,
      errorMessage: "",
      priority:  rules.length + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  write("rules", rules);
  res.json({ success: true, added, skipped, total: rules.length });
});

// ── POST create rule ──────────────────────────────────────────────────────────
router.post("/", (req, res) => {
  const rules = read("rules") || [];
  const { name, action, status, zipCodes, products, message, errorMessage } = req.body;
  if (!name || !action || !zipCodes?.length)
    return res.status(400).json({ success: false, message: "name, action, and zipCodes are required" });
  const invalid = zipCodes.find(z => String(z).trim().length < 5 || String(z).trim().length > 10);
  if (invalid) return res.status(400).json({ success: false, message: `Invalid zip/postal code: ${invalid}` });
  const newRule = {
    id: "rule_" + uuidv4().slice(0, 8),
    name, action,
    status:       status || "active",
    zipCodes,
    products:     products || ["All Products"],
    message:      message || "",
    errorMessage: errorMessage || "",
    priority:     rules.length + 1,
    createdAt:    new Date().toISOString(),
    updatedAt:    new Date().toISOString(),
  };
  rules.push(newRule);
  write("rules", rules);
  res.status(201).json({ success: true, data: newRule });
});

// ── PUT update rule ───────────────────────────────────────────────────────────
router.put("/:id", (req, res) => {
  const rules = read("rules") || [];
  const idx   = rules.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Rule not found" });
  if (req.body.zipCodes) {
    const invalid = req.body.zipCodes.find(z => String(z).trim().length < 5 || String(z).trim().length > 10);
    if (invalid) return res.status(400).json({ success: false, message: `Invalid zip/postal code: ${invalid}` });
  }
  rules[idx] = { ...rules[idx], ...req.body, id: rules[idx].id, updatedAt: new Date().toISOString() };
  write("rules", rules);
  res.json({ success: true, data: rules[idx] });
});

// ── PATCH toggle status ───────────────────────────────────────────────────────
router.patch("/:id/toggle", (req, res) => {
  const rules = read("rules") || [];
  const idx   = rules.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Rule not found" });
  rules[idx].status    = rules[idx].status === "active" ? "paused" : "active";
  rules[idx].updatedAt = new Date().toISOString();
  write("rules", rules);
  res.json({ success: true, data: rules[idx] });
});

// ── DELETE rule ───────────────────────────────────────────────────────────────
router.delete("/:id", (req, res) => {
  const rules    = read("rules") || [];
  const filtered = rules.filter(r => r.id !== req.params.id);
  if (filtered.length === rules.length)
    return res.status(404).json({ success: false, message: "Rule not found" });
  write("rules", filtered);
  res.json({ success: true, message: "Rule deleted" });
});

// ── DELETE all rules ──────────────────────────────────────────────────────────
router.delete("/", (req, res) => {
  write("rules", []);
  res.json({ success: true, message: "All rules deleted" });
});

// ── POST duplicate ────────────────────────────────────────────────────────────
router.post("/:id/duplicate", (req, res) => {
  const rules    = read("rules") || [];
  const original = rules.find(r => r.id === req.params.id);
  if (!original) return res.status(404).json({ success: false, message: "Rule not found" });
  const copy = {
    ...original,
    id:        "rule_" + uuidv4().slice(0, 8),
    name:      `${original.name} (Copy)`,
    priority:  rules.length + 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  rules.push(copy);
  write("rules", rules);
  res.status(201).json({ success: true, data: copy });
});

// ── Helper: parse uploaded CSV or XLSX buffer ─────────────────────────────────
function parseUploadedFile(file) {
  const name = (file.originalname || "").toLowerCase();
  let rawRows = [];

  if (name.endsWith(".csv") || file.mimetype === "text/csv") {
    const text = file.buffer.toString("utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    const headers = lines[0].split(",").map(h => h.replace(/"/g,"").trim().toLowerCase());
    rawRows = lines.slice(1).map(line => {
      const cols = parseCsvLine(line);
      const obj  = {};
      headers.forEach((h, i) => obj[h] = (cols[i]||"").trim());
      return obj;
    });
  } else {
    // Excel
    const wb   = XLSX.read(file.buffer, { type: "buffer" });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    rawRows    = XLSX.utils.sheet_to_json(ws, { defval: "" });
    // Normalize keys to lowercase
    rawRows = rawRows.map(r => {
      const n = {};
      Object.keys(r).forEach(k => n[k.toLowerCase().trim()] = String(r[k]).trim());
      return n;
    });
  }

  return rawRows.map(row => {
    const zip  = String(row.zipcode || row.zip || row["zip code"] || row["postal code"] || "").trim().toUpperCase();
    const type = String(row.type || row.action || "allow").trim().toLowerCase();
    const msg  = String(row.message || row.custommessage || row["custom message"] || "").trim();
    return {
      zip,
      type: (type === "deny" || type === "block") ? "deny" : "allow",
      message: msg,
      valid: zip.length >= 5 && zip.length <= 10,
    };
  }).filter(r => r.zip); // remove empty rows
}

function parseCsvLine(line) {
  const result = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQ = !inQ; }
    else if (line[i] === ',' && !inQ) { result.push(cur); cur = ""; }
    else cur += line[i];
  }
  result.push(cur);
  return result;
}

module.exports = router;
