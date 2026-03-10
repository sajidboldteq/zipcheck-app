// src/components/layout/TopBar.jsx
import { useLocation } from "react-router-dom";

const META = {
  "/":           { title:"Dashboard",    desc:"Live analytics from real zip code checks" },
  "/rules":      { title:"Rules",        desc:"Create and manage your zip code allow/block rules" },
  "/zip-groups": { title:"Zip Groups",   desc:"Organize zip codes into reusable named groups" },
  "/checker":    { title:"Live Checker", desc:"Test any zip code against your active rules" },
  "/settings":   { title:"Settings",     desc:"Configure widget, checkout & notification preferences" },
};

export default function TopBar() {
  const { pathname } = useLocation();
  const m = META[pathname] || META["/"];
  return (
    <header style={{ height:"var(--topbar)", background:"#fff", borderBottom:"1px solid var(--g200)",
      display:"flex", alignItems:"center", justifyContent:"space-between",
      padding:"0 28px", flexShrink:0, boxShadow:"var(--shadow)", position:"sticky", top:0, zIndex:10 }}>
      <div>
        <div style={{ fontSize:16, fontWeight:800, color:"var(--g900)" }}>{m.title}</div>
        <div style={{ fontSize:11, color:"var(--g400)", marginTop:1 }}>{m.desc}</div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <button style={{ position:"relative", background:"var(--g100)", border:"none", borderRadius:9, width:36, height:36, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:15 }}>
          🔔
          <span style={{ position:"absolute", top:7, right:7, width:7, height:7, background:"var(--red)", borderRadius:"50%", border:"2px solid #fff" }} />
        </button>
        <div style={{ width:36, height:36, borderRadius:"50%", background:"var(--blue)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:800, color:"#fff", cursor:"pointer" }}>A</div>
      </div>
    </header>
  );
}
