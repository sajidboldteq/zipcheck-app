// src/components/layout/Sidebar.jsx
import { useLocation, useNavigate } from "react-router-dom";

const NAV = [
  { path: "/",           label: "Dashboard",      icon: "▦" },
  { path: "/rules",      label: "Rules",          icon: "⊟", badge: true },
  { path: "/zip-groups", label: "Zip Groups",     icon: "⊞" },
  { path: "/checker",    label: "Live Checker",   icon: "🔍" },
  { path: "/settings",   label: "Settings",       icon: "⊙" },
];

export default function Sidebar({ ruleCount = 0 }) {
  const { pathname } = useLocation();
  const nav = useNavigate();

  return (
    <aside style={{ width:"var(--sidebar)", background:"#1a1a1a", display:"flex", flexDirection:"column",
      flexShrink:0, boxShadow:"2px 0 16px rgba(0,0,0,.2)", zIndex:20 }}>
      {/* Logo */}
      <div style={{ padding:"20px 18px 16px", borderBottom:"1px solid #2a2a2a" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:"var(--green)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>📍</div>
          <div>
            <div style={{ fontSize:15, fontWeight:800, color:"#fff", letterSpacing:"-0.3px" }}>ZipCheck</div>
            <div style={{ fontSize:11, color:"#555" }}>Zip Code Checker</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex:1, padding:"12px 8px" }}>
        <div style={{ fontSize:10, fontWeight:700, color:"#444", letterSpacing:"0.1em", padding:"0 10px 8px", textTransform:"uppercase" }}>Navigation</div>
        {NAV.map(item => {
          const active = item.path === "/" ? pathname === "/" : pathname.startsWith(item.path);
          return (
            <button key={item.path} onClick={() => nav(item.path)}
              style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"10px 12px",
                border:"none", borderRadius:9, cursor:"pointer", marginBottom:2, textAlign:"left",
                background:active?"var(--green)":"transparent",
                color:active?"#fff":"#888", transition:"all var(--t)",
                fontFamily:"var(--font)", fontSize:14, fontWeight:active?700:500 }}>
              <span style={{ fontSize:16, width:20, textAlign:"center" }}>{item.icon}</span>
              <span style={{ flex:1 }}>{item.label}</span>
              {item.badge && (
                <span style={{ background:active?"rgba(255,255,255,.2)":"#2a2a2a", color:active?"#fff":"#888",
                  fontSize:11, fontWeight:700, padding:"1px 7px", borderRadius:20 }}>
                  {ruleCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Store badge */}
      <div style={{ padding:"12px 16px", borderTop:"1px solid #2a2a2a" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:32, height:32, borderRadius:"50%", background:"var(--blue)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:800, color:"#fff", flexShrink:0 }}>S</div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:12, fontWeight:700, color:"#e5e7eb", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>My Shopify Store</div>
            <div style={{ fontSize:11, color:"#555" }}>mystore.myshopify.com</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
