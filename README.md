# 📍 ZipCheck — Fully Dynamic Shopify Zip Code Checker App

A production-ready, fully dynamic Shopify app with a **real Node.js backend**, **JSON file-based persistence**, **live analytics computed from actual checks**, and a complete React frontend.

---

## 🗂 Full Project Structure

```
zipcheck-full/
│
├── package.json                    ← Root monorepo (runs both servers)
│
├── backend/                        ← Node.js + Express API Server
│   ├── package.json
│   ├── server.js                   ← Express app, middleware, route mounting
│   ├── data/                       ← JSON files (auto-created on first run)
│   │   ├── rules.json              ← Persisted rules data
│   │   ├── groups.json             ← Persisted zip groups
│   │   ├── settings.json           ← Persisted app settings
│   │   └── analytics_log.json      ← Real check log (grows with each check)
│   ├── routes/
│   │   ├── rules.js                ← GET/POST/PUT/PATCH/DELETE /api/rules
│   │   ├── check.js                ← POST /api/check (core zip engine)
│   │   ├── analytics.js            ← GET /api/analytics/* (live computed)
│   │   ├── groups.js               ← CRUD /api/groups
│   │   └── settings.js             ← GET/PUT /api/settings
│   └── utils/
│       └── store.js                ← JSON file read/write + data seeding
│
└── frontend/                       ← React + Vite Frontend
    ├── package.json
    ├── vite.config.js              ← Vite + /api proxy to :5000
    ├── index.html
    └── src/
        ├── main.jsx                ← React root
        ├── App.jsx                 ← Router shell
        ├── styles/
        │   └── global.css          ← CSS variables, animations
        ├── utils/
        │   └── api.js              ← All fetch calls (rulesApi, checkApi, etc.)
        ├── hooks/
        │   └── useApi.js           ← useFetch, useRules hooks
        ├── components/
        │   ├── common/
        │   │   └── index.jsx       ← Badge, Toggle, Btn, Input, Select,
        │   │                          Card, Modal, Empty, StatCard, ZipTag,
        │   │                          Section, Spinner, toast()
        │   └── layout/
        │       ├── Sidebar.jsx     ← Left nav with active rule count
        │       └── TopBar.jsx      ← Top header
        └── pages/
            ├── DashboardPage.jsx   ← LIVE analytics (auto-refreshes every 15s)
            ├── RulesPage.jsx       ← Full CRUD: create/edit/delete/toggle/duplicate
            ├── ZipGroupsPage.jsx   ← Reusable zip groups CRUD
            ├── CheckerPage.jsx     ← Live zip checker with history (logs to analytics)
            └── SettingsPage.jsx    ← Widget/checkout/API settings (persisted)
```

---

## 🚀 Quick Start

### Prerequisites
- **Node.js 18+**
- **npm 9+**

### 1. Install all dependencies
```bash
cd zipcheck-full
npm run install:all
```

### 2. Start both servers
```bash
npm run dev
```

This runs:
- **Backend** on `http://localhost:5000`
- **Frontend** on `http://localhost:3000`

The frontend proxies all `/api/*` calls to the backend automatically.

---

## ✅ What's Truly Dynamic

| Feature | How it works |
|---------|-------------|
| **Rules CRUD** | Full Create/Read/Update/Delete via REST API, persisted to `rules.json` |
| **Toggle active/paused** | PATCH `/api/rules/:id/toggle` — updates file immediately |
| **Duplicate rule** | POST `/api/rules/:id/duplicate` — creates real copy in backend |
| **Zip validation** | Server validates every zip code format on create/update |
| **Live Checker** | POST `/api/check` — matches zip against active rules by priority, logs every check |
| **Analytics** | All stats computed live from `analytics_log.json` — no mock data |
| **Weekly chart** | Real data from last 7 days of actual checks |
| **Top zip codes** | Sorted by real check frequency |
| **Settings persistence** | PUT `/api/settings` — saved to `settings.json` |
| **Zip groups CRUD** | Full CRUD persisted to `groups.json` |
| **Data survives refresh** | JSON files persist between server restarts |
| **Auto-refresh** | Dashboard polls analytics every 15 seconds |

---

## 🔌 API Reference

### Rules
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/rules` | Get all rules (supports `?status=active&action=allow&search=`) |
| POST | `/api/rules` | Create rule |
| PUT | `/api/rules/:id` | Update rule |
| PATCH | `/api/rules/:id/toggle` | Toggle active/paused |
| POST | `/api/rules/:id/duplicate` | Duplicate rule |
| DELETE | `/api/rules/:id` | Delete rule |

### Zip Check (Core Engine)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/check` | `{ zip: "10001" }` → check result + logs to analytics |
| GET | `/api/check/lookup/:zip` | Quick GET check (for widgets/embeds) |

### Analytics (All Live)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/analytics/summary` | Total checks, allowed, blocked, unique zips |
| GET | `/api/analytics/weekly` | Last 7 days data |
| GET | `/api/analytics/top-zips` | Most checked zip codes |
| GET | `/api/analytics/by-rule` | Checks per rule |
| GET | `/api/analytics/recent` | Last N check events |
| DELETE | `/api/analytics/clear` | Reset analytics log |

### Groups & Settings
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/groups` | List / create groups |
| PUT/DELETE | `/api/groups/:id` | Update / delete group |
| GET | `/api/settings` | Get all settings |
| PUT | `/api/settings` | Update all settings |

---

## 📦 npm Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both backend + frontend |
| `npm run dev:backend` | Backend only (port 5000) |
| `npm run dev:frontend` | Frontend only (port 3000) |
| `npm run build` | Build frontend for production |
| `npm start` | Start backend in production mode |

---

## 🧪 Test the App

1. Go to **Live Checker** page
2. Enter any zip code (try `10001`, `90210`, `73301`)
3. See real-time allow/block result
4. Go to **Dashboard** — see your check logged instantly in analytics
5. Create a new Rule in **Rules** page
6. Check a zip from that rule — it matches your new rule!
