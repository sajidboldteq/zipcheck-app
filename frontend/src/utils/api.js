// src/utils/api.js
// Centralized API client — all HTTP calls go through here

const BASE = "/api";

async function request(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || "Request failed");
  return json;
}

const get  = (path)        => request("GET",    path);
const post = (path, body)  => request("POST",   path, body);
const put  = (path, body)  => request("PUT",    path, body);
const patch= (path, body)  => request("PATCH",  path, body);
const del  = (path)        => request("DELETE", path);

// ── Rules ─────────────────────────────────────────────────────────────────────
export const rulesApi = {
  getAll:    (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return get(`/rules${q ? "?" + q : ""}`);
  },
  getOne:    (id)          => get(`/rules/${id}`),
  create:    (data)        => post("/rules", data),
  update:    (id, data)    => put(`/rules/${id}`, data),
  toggle:    (id)          => patch(`/rules/${id}/toggle`),
  duplicate: (id)          => post(`/rules/${id}/duplicate`),
  delete:    (id)          => del(`/rules/${id}`),
};

// ── Groups ────────────────────────────────────────────────────────────────────
export const groupsApi = {
  getAll:  ()          => get("/groups"),
  create:  (data)      => post("/groups", data),
  update:  (id, data)  => put(`/groups/${id}`, data),
  delete:  (id)        => del(`/groups/${id}`),
};

// ── Check ─────────────────────────────────────────────────────────────────────
export const checkApi = {
  check:  (zip)  => post("/check", { zip }),
  lookup: (zip)  => get(`/check/lookup/${zip}`),
};

// ── Analytics ─────────────────────────────────────────────────────────────────
export const analyticsApi = {
  summary:   ()             => get("/analytics/summary"),
  weekly:    ()             => get("/analytics/weekly"),
  topZips:   (limit = 10)  => get(`/analytics/top-zips?limit=${limit}`),
  byRule:    ()             => get("/analytics/by-rule"),
  recent:    (limit = 20)  => get(`/analytics/recent?limit=${limit}`),
  clear:     ()             => del("/analytics/clear"),
};

// ── Settings ──────────────────────────────────────────────────────────────────
export const settingsApi = {
  get:    ()      => get("/settings"),
  update: (data)  => put("/settings", data),
};

export default { rulesApi, groupsApi, checkApi, analyticsApi, settingsApi };
