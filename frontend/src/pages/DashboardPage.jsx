// src/pages/DashboardPage.jsx
import { useEffect, useState, useCallback } from "react";
import { analyticsApi, rulesApi } from "../utils/api";
import { Card, StatCard, Badge, Spinner } from "../components/common";

function BarChart({ data, loading }) {
  if (loading) return <div style={{ height:140, display:"flex", alignItems:"center", justifyContent:"center" }}><Spinner size={28} /></div>;
  if (!data?.length) return <div style={{ height:140, display:"flex", alignItems:"center", justifyContent:"center", color:"var(--g400)", fontSize:13 }}>No data yet — checks will appear here</div>;
  const max = Math.max(...data.map(d => d.checks), 1);
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:8, height:140, padding:"0 4px" }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
          <div style={{ width:"100%", display:"flex", flexDirection:"column", justifyContent:"flex-end", height:120, gap:2 }}>
            <div title={`${d.allowed} allowed`} style={{ width:"100%", background:"var(--green)", borderRadius:"4px 4px 0 0", height:`${(d.allowed/max)*100}%`, minHeight:d.allowed?4:0, transition:"height .6s" }} />
            <div title={`${d.blocked} blocked`} style={{ width:"100%", background:"var(--red-lt)", borderRadius:0, height:`${(d.blocked/max)*100}%`, minHeight:d.blocked?4:0 }} />
          </div>
          <span style={{ fontSize:11, color:"var(--g400)", fontWeight:600 }}>{d.day}</span>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const [summary, setSummary]   = useState(null);
  const [weekly, setWeekly]     = useState(null);
  const [topZips, setTopZips]   = useState(null);
  const [byRule, setByRule]     = useState(null);
  const [recent, setRecent]     = useState(null);
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, w, t, r, rc] = await Promise.all([
        analyticsApi.summary(),
        analyticsApi.weekly(),
        analyticsApi.topZips(8),
        analyticsApi.byRule(),
        analyticsApi.recent(10),
      ]);
      setSummary(s.data);
      setWeekly(w.data);
      setTopZips(t.data);
      setByRule(r.data);
      setRecent(rc.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 15s
  useEffect(() => { const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const maxRuleChecks = Math.max(...(byRule?.map(r => r.checks) || [1]), 1);

  return (
    <div className="fade-up">
      {/* Stats */}
      <div className="stagger" style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:16, marginBottom:20 }}>
        <StatCard label="Total Checks" value={summary?.totalChecks?.toLocaleString() ?? "—"} sub="all time" icon="🔍" color="var(--blue)" loading={loading} />
        <StatCard label="Allowed" value={summary?.allowedChecks?.toLocaleString() ?? "—"} sub={`${summary?.allowRate ?? 0}% allow rate`} icon="✅" color="var(--green)" loading={loading} />
        <StatCard label="Blocked" value={summary?.blockedChecks?.toLocaleString() ?? "—"} sub="delivery blocked" icon="🚫" color="var(--red)" loading={loading} />
        <StatCard label="Unique Zips" value={summary?.uniqueZips?.toLocaleString() ?? "—"} sub="distinct zip codes" icon="📮" color="var(--amber)" loading={loading} />
      </div>

      {/* Charts Row */}
      <div style={{ display:"grid", gridTemplateColumns:"1.6fr 1fr", gap:16, marginBottom:16 }}>
        <Card>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
            <div>
              <h3 style={{ margin:0, fontSize:15, fontWeight:800 }}>Weekly Check Volume</h3>
              <p style={{ margin:0, fontSize:12, color:"var(--g400)" }}>Last 7 days — live from real checks</p>
            </div>
            <div style={{ display:"flex", gap:14, fontSize:12 }}>
              {[["var(--green)","Allowed"],["var(--red-lt)","Blocked"]].map(([c,l]) => (
                <span key={l} style={{ display:"flex", alignItems:"center", gap:5, color:"var(--g600)", fontWeight:600 }}>
                  <span style={{ width:10, height:10, borderRadius:2, background:c, display:"inline-block" }} />{l}
                </span>
              ))}
            </div>
          </div>
          <BarChart data={weekly} loading={loading} />
        </Card>

        {/* Donut */}
        <Card>
          <h3 style={{ margin:"0 0 16px", fontSize:15, fontWeight:800 }}>Allow Rate</h3>
          {loading ? <div style={{ display:"flex", justifyContent:"center", padding:40 }}><Spinner size={32} /></div> : (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16 }}>
              <div style={{ position:"relative", width:130, height:130 }}>
                <svg viewBox="0 0 36 36" style={{ transform:"rotate(-90deg)", width:130, height:130 }}>
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--red-lt)" strokeWidth="3" />
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--green)" strokeWidth="3"
                    strokeDasharray={`${summary?.allowRate||0} ${100-(summary?.allowRate||0)}`} strokeLinecap="round" />
                </svg>
                <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
                  <div style={{ fontSize:26, fontWeight:800 }}>{summary?.allowRate ?? 0}%</div>
                  <div style={{ fontSize:11, color:"var(--g400)", fontWeight:600 }}>allowed</div>
                </div>
              </div>
              {[["var(--green)","Allowed",summary?.allowedChecks],["var(--red)","Blocked",summary?.blockedChecks]].map(([c,l,v]) => (
                <div key={l} style={{ width:"100%", display:"flex", justifyContent:"space-between" }}>
                  <span style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, color:"var(--g600)", fontWeight:600 }}>
                    <span style={{ width:8, height:8, borderRadius:"50%", background:c }} />{l}
                  </span>
                  <span style={{ fontSize:13, fontWeight:700 }}>{v?.toLocaleString() ?? 0}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Bottom Row */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:16 }}>
        {/* Top zips */}
        <Card>
          <h3 style={{ margin:"0 0 16px", fontSize:15, fontWeight:800 }}>Top Checked Zips</h3>
          {loading ? <Spinner /> : !topZips?.length ? (
            <div style={{ textAlign:"center", padding:"24px 0", color:"var(--g400)", fontSize:13 }}>No checks yet. Use the Live Checker!</div>
          ) : topZips.map((z, i) => (
            <div key={z.zip} style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 0", borderBottom:"1px solid var(--g100)" }}>
              <span style={{ fontSize:11, fontWeight:700, color:"var(--g400)", width:18 }}>#{i+1}</span>
              <span style={{ fontFamily:"var(--mono)", fontSize:13, fontWeight:600, flex:1 }}>{z.zip}</span>
              <div style={{ flex:2, height:5, background:"var(--g100)", borderRadius:3, overflow:"hidden" }}>
                <div style={{ height:"100%", borderRadius:3, background:z.lastResult==="allow"?"var(--green)":"var(--red)", width:`${(z.checks/(topZips[0]?.checks||1))*100}%` }} />
              </div>
              <span style={{ fontSize:12, fontWeight:700, color:"var(--g600)", width:28, textAlign:"right" }}>{z.checks}</span>
              <Badge type={z.lastResult}>{z.lastResult}</Badge>
            </div>
          ))}
        </Card>

        {/* By rule */}
        <Card>
          <h3 style={{ margin:"0 0 16px", fontSize:15, fontWeight:800 }}>Checks by Rule</h3>
          {loading ? <Spinner /> : !byRule?.length ? (
            <div style={{ textAlign:"center", padding:"24px 0", color:"var(--g400)", fontSize:13 }}>Create rules to see stats</div>
          ) : byRule.map(r => (
            <div key={r.ruleId} style={{ marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                <span style={{ fontSize:12, color:"var(--g700)", fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:140 }}>{r.ruleName}</span>
                <span style={{ fontSize:12, fontWeight:700 }}>{r.checks}</span>
              </div>
              <div style={{ height:5, background:"var(--g100)", borderRadius:3, overflow:"hidden" }}>
                <div style={{ height:"100%", borderRadius:3, background:r.action==="allow"?"var(--green)":"var(--red)", width:`${(r.checks/maxRuleChecks)*100}%`, transition:"width .5s" }} />
              </div>
            </div>
          ))}
        </Card>

        {/* Recent activity */}
        <Card>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
            <h3 style={{ margin:0, fontSize:15, fontWeight:800 }}>Recent Checks</h3>
            <button onClick={load} style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, color:"var(--blue)", fontWeight:600 }}>↻ Refresh</button>
          </div>
          {loading ? <Spinner /> : !recent?.length ? (
            <div style={{ textAlign:"center", padding:"24px 0", color:"var(--g400)", fontSize:13 }}>No checks yet</div>
          ) : recent.map(e => (
            <div key={e.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 0", borderBottom:"1px solid var(--g100)" }}>
              <span style={{ fontFamily:"var(--mono)", fontSize:12, fontWeight:600, color:"var(--g900)", width:52 }}>{e.zip}</span>
              <Badge type={e.result}>{e.result}</Badge>
              <span style={{ fontSize:11, color:"var(--g400)", marginLeft:"auto" }}>
                {new Date(e.timestamp).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}
              </span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
