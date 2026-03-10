// src/components/common/index.jsx

// ── Toast ─────────────────────────────────────────────────────────────────────
export function toast(msg, type = "success") {
  const el = document.createElement("div");
  const bg = type === "success" ? "#008060" : type === "error" ? "#d72c0d" : "#1a1a1a";
  const icon = type === "success" ? "✓" : type === "error" ? "✕" : "ℹ";
  el.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 18px;
    border-radius:10px;font-size:14px;font-weight:600;font-family:'DM Sans',sans-serif;
    background:${bg};color:#fff;box-shadow:0 4px 20px rgba(0,0,0,.2);
    display:flex;align-items:center;gap:8px;animation:fadeUp .2s ease;max-width:340px;`;
  el.innerHTML = `<span style="font-size:16px">${icon}</span><span>${msg}</span>`;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; setTimeout(() => el.remove(), 300); }, 2800);
}

// ── Spinner ───────────────────────────────────────────────────────────────────
export const Spinner = ({ size = 20, color = "var(--green)" }) => (
  <div style={{ width: size, height: size, border: `2px solid ${color}30`, borderTopColor: color, borderRadius: "50%" }} className="spin" />
);

// ── Badge ─────────────────────────────────────────────────────────────────────
export const Badge = ({ type = "default", children, dot }) => {
  const M = {
    active:  { bg: "var(--green-lt)", c: "var(--green)" },
    paused:  { bg: "var(--amber-lt)", c: "var(--amber)" },
    allow:   { bg: "var(--green-lt)", c: "var(--green)" },
    block:   { bg: "var(--red-lt)",   c: "var(--red)" },
    no_match:{ bg: "var(--g100)",     c: "var(--g500)" },
    default: { bg: "var(--g100)",     c: "var(--g500)" },
  };
  const s = M[type] || M.default;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:20, background:s.bg, color:s.c, fontSize:12, fontWeight:700, whiteSpace:"nowrap" }}>
      {dot && <span style={{ width:6, height:6, borderRadius:"50%", background:s.c }} />}
      {children}
    </span>
  );
};

// ── Toggle ────────────────────────────────────────────────────────────────────
export const Toggle = ({ checked, onChange, loading }) => (
  <div onClick={() => !loading && onChange(!checked)}
    style={{ width:42, height:24, borderRadius:12, cursor:loading?"wait":"pointer", position:"relative",
      background:checked?"var(--green)":"var(--g300)", transition:"background var(--t)", flexShrink:0, opacity:loading?.6:1 }}>
    <div style={{ position:"absolute", top:3, left:checked?21:3, width:18, height:18, borderRadius:"50%", background:"#fff",
      transition:"left var(--t)", boxShadow:"0 1px 4px rgba(0,0,0,.2)" }} />
  </div>
);

// ── Button ────────────────────────────────────────────────────────────────────
export const Btn = ({ children, variant="primary", size="md", onClick, disabled, loading, icon, style:sx={} }) => {
  const V = {
    primary:  { bg:"var(--green)",  c:"#fff",           b:"none" },
    secondary:{ bg:"#fff",          c:"var(--g700)",     b:"1px solid var(--g300)" },
    danger:   { bg:"var(--red-lt)", c:"var(--red)",      b:"1px solid #f5c2b8" },
    ghost:    { bg:"transparent",   c:"var(--g500)",     b:"none" },
  };
  const S = { sm:{p:"6px 12px",fs:12}, md:{p:"9px 18px",fs:14}, lg:{p:"11px 24px",fs:15} };
  const v = V[variant]; const s = S[size];
  return (
    <button onClick={onClick} disabled={disabled || loading}
      style={{ display:"inline-flex", alignItems:"center", gap:7, padding:s.p, fontSize:s.fs,
        fontWeight:700, background:v.bg, color:v.c, border:v.b, borderRadius:"var(--r)",
        cursor:(disabled||loading)?"not-allowed":"pointer", opacity:(disabled||loading)?.65:1,
        transition:"all var(--t)", whiteSpace:"nowrap", ...sx }}>
      {loading ? <Spinner size={14} color={variant==="primary"?"#fff":"var(--green)"} /> : icon}
      {children}
    </button>
  );
};

// ── Input ─────────────────────────────────────────────────────────────────────
export const Input = ({ label, error, hint, prefix, suffix, style:sx={}, ...props }) => (
  <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
    {label && <label style={{ fontSize:13, fontWeight:600, color:"var(--g700)" }}>{label}</label>}
    <div style={{ position:"relative", display:"flex", alignItems:"center" }}>
      {prefix && <span style={{ position:"absolute", left:10, color:"var(--g400)", fontSize:14, pointerEvents:"none" }}>{prefix}</span>}
      <input {...props} style={{ width:"100%", padding:`9px ${suffix?36:12}px 9px ${prefix?32:12}px`,
        border:`1px solid ${error?"var(--red)":"var(--g300)"}`, borderRadius:"var(--r)",
        fontSize:14, outline:"none", color:"var(--g900)", background:"#fff",
        transition:"border-color var(--t)", ...sx }} />
      {suffix && <span style={{ position:"absolute", right:10, color:"var(--g400)", fontSize:14, pointerEvents:"none" }}>{suffix}</span>}
    </div>
    {error && <span style={{ fontSize:12, color:"var(--red)" }}>{error}</span>}
    {hint && !error && <span style={{ fontSize:12, color:"var(--g400)" }}>{hint}</span>}
  </div>
);

// ── Select ────────────────────────────────────────────────────────────────────
export const Select = ({ label, options=[], style:sx={}, ...props }) => (
  <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
    {label && <label style={{ fontSize:13, fontWeight:600, color:"var(--g700)" }}>{label}</label>}
    <select {...props} style={{ width:"100%", padding:"9px 36px 9px 12px", border:"1px solid var(--g300)",
      borderRadius:"var(--r)", fontSize:14, outline:"none", color:"var(--g900)", background:"#fff",
      appearance:"none", backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2.5'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
      backgroundRepeat:"no-repeat", backgroundPosition:"right 12px center", ...sx }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

// ── Card ──────────────────────────────────────────────────────────────────────
export const Card = ({ children, style:sx={}, p=24 }) => (
  <div style={{ background:"#fff", borderRadius:"var(--r)", border:"1px solid var(--g200)", boxShadow:"var(--shadow)", padding:p, ...sx }}>
    {children}
  </div>
);

// ── Modal ─────────────────────────────────────────────────────────────────────
export const Modal = ({ open, onClose, title, children, size="md", footer }) => {
  if (!open) return null;
  const W = { sm:420, md:620, lg:840, xl:1000 };
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.55)", zIndex:1000,
      display:"flex", alignItems:"center", justifyContent:"center", padding:20, backdropFilter:"blur(3px)" }}>
      <div onClick={e=>e.stopPropagation()} className="scale-in"
        style={{ background:"#fff", borderRadius:14, width:"100%", maxWidth:W[size],
          maxHeight:"90vh", display:"flex", flexDirection:"column", boxShadow:"var(--shadow-lg)" }}>
        <div style={{ padding:"18px 24px", borderBottom:"1px solid var(--g200)", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
          <h3 style={{ margin:0, fontSize:17, fontWeight:800 }}>{title}</h3>
          <button onClick={onClose} style={{ background:"var(--g100)", border:"none", borderRadius:8, width:30, height:30, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:16, color:"var(--g500)" }}>✕</button>
        </div>
        <div style={{ padding:24, overflow:"auto", flex:1 }}>{children}</div>
        {footer && <div style={{ padding:"14px 24px", borderTop:"1px solid var(--g200)", display:"flex", justifyContent:"flex-end", gap:10, flexShrink:0 }}>{footer}</div>}
      </div>
    </div>
  );
};

// ── Empty State ───────────────────────────────────────────────────────────────
export const Empty = ({ emoji="📭", title, desc, action }) => (
  <div style={{ textAlign:"center", padding:"60px 20px" }}>
    <div style={{ fontSize:52, marginBottom:12 }}>{emoji}</div>
    <div style={{ fontSize:16, fontWeight:700, color:"var(--g700)", marginBottom:6 }}>{title}</div>
    {desc && <p style={{ fontSize:13, color:"var(--g400)", marginBottom:20, lineHeight:1.6 }}>{desc}</p>}
    {action}
  </div>
);

// ── Stat Card ─────────────────────────────────────────────────────────────────
export const StatCard = ({ label, value, sub, icon, color="var(--green)", trend, loading }) => (
  <Card>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
      <div style={{ width:40, height:40, borderRadius:10, background:color+"1a", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>{icon}</div>
      {trend !== undefined && <span style={{ fontSize:12, fontWeight:700, color:trend>=0?"var(--green)":"var(--red)" }}>{trend>=0?"↑":"↓"} {Math.abs(trend)}%</span>}
    </div>
    {loading ? <div style={{ height:32, width:80, background:"var(--g100)", borderRadius:6, animation:"pulse 1.5s infinite" }} /> : (
      <div style={{ fontSize:28, fontWeight:800, marginBottom:2 }}>{value}</div>
    )}
    <div style={{ fontSize:13, fontWeight:600, color:"var(--g700)" }}>{label}</div>
    {sub && <div style={{ fontSize:12, color:"var(--g400)", marginTop:3 }}>{sub}</div>}
  </Card>
);

// ── Zip Tag ───────────────────────────────────────────────────────────────────
export const ZipTag = ({ zip, onRemove }) => (
  <span style={{ display:"inline-flex", alignItems:"center", gap:4, background:"var(--g100)",
    border:"1px solid var(--g200)", borderRadius:6, padding:"3px 8px",
    fontSize:12, fontWeight:600, fontFamily:"var(--mono)", color:"var(--g700)" }}>
    {zip}
    {onRemove && <button onClick={()=>onRemove(zip)} style={{ background:"none", border:"none", cursor:"pointer", color:"var(--g400)", fontSize:14, lineHeight:1, padding:0, display:"flex" }}>×</button>}
  </span>
);

// ── Section Card ──────────────────────────────────────────────────────────────
export const Section = ({ title, desc, children, action }) => (
  <Card style={{ marginBottom:16 }}>
    <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:18 }}>
      <div>
        <h3 style={{ margin:0, fontSize:15, fontWeight:800 }}>{title}</h3>
        {desc && <p style={{ margin:"4px 0 0", fontSize:13, color:"var(--g400)" }}>{desc}</p>}
      </div>
      {action}
    </div>
    {children}
  </Card>
);
