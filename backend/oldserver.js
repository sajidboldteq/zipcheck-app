// backend/server.js
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");

const rulesRouter = require("./routes/rules");
const groupsRouter = require("./routes/groups");
const analyticsRouter = require("./routes/analytics");
const checkRouter = require("./routes/check");
const settingsRouter = require("./routes/settings");

const app = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: "http://localhost:3000", credentials: true }));
app.use(express.json());
app.use(morgan("dev"));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use("/api/rules",     rulesRouter);
app.use("/api/groups",    groupsRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/check",     checkRouter);
app.use("/api/settings",  settingsRouter);

// ── Health Check ──────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 ZipCheck API running on http://localhost:${PORT}`);
  console.log(`📋 Routes: /api/rules | /api/groups | /api/analytics | /api/check | /api/settings\n`);
});
