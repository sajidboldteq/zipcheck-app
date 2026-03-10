// src/pages/CheckerPage.jsx
import { useState } from "react";
import { checkApi } from "../utils/api";
import { Card, Btn, Spinner } from "../components/common";

export default function CheckerPage() {
  const [zip, setZip] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);

  const handleCheck = async () => {
    const clean = zip.trim();
    if (!clean) return;
    if (!/^\d{5}(-\d{4})?$/.test(clean)) { setError("Enter a valid 5-digit US zip code"); return; }
    setError(""); setLoading(true); setResult(null);
    try {
      const res = await checkApi.check(clean);
      setResult(res.data);
      setHistory(prev => [{ ...res.data, ts: new Date() }, ...prev.slice(0, 19)]);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const isAllow = result?.result === "allow";
  const isBlock = result?.result === "block";
  const isNoMatch = result?.result === "no_match";

  return (
    <div className="fade-up" style={{ maxWidth: 720, margin: "0 auto" }}>
      {/* Hero Check Widget */}
      <Card style={{ marginBottom: 24, textAlign: "center", padding: "40px 32px" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📍</div>
        <h2 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 800 }}>Live Zip Code Checker</h2>
        <p style={{ margin: "0 0 28px", color: "var(--g500)", fontSize: 14 }}>
          Test any zip code against your active rules in real time. Every check is logged to analytics.
        </p>

        <div style={{ display: "flex", gap: 10, maxWidth: 400, margin: "0 auto" }}>
          <input
            value={zip}
            onChange={e => { setZip(e.target.value); setError(""); setResult(null); }}
            onKeyDown={e => e.key === "Enter" && handleCheck()}
            placeholder="Enter zip code (e.g. 10001)"
            maxLength={10}
            style={{
              flex: 1, padding: "12px 16px", border: `2px solid ${error ? "var(--red)" : result ? (isAllow ? "var(--green)" : isBlock ? "var(--red)" : "var(--amber)") : "var(--g300)"}`,
              borderRadius: "var(--r)", fontSize: 18, fontFamily: "var(--mono)",
              fontWeight: 700, outline: "none", textAlign: "center", letterSpacing: "0.1em",
              transition: "border-color .2s",
            }}
          />
          <Btn onClick={handleCheck} loading={loading} size="lg" icon={!loading && <span>🔍</span>}>
            {loading ? "Checking..." : "Check"}
          </Btn>
        </div>
        {error && <div style={{ marginTop: 10, fontSize: 13, color: "var(--red)", fontWeight: 600 }}>{error}</div>}

        {/* Result */}
        {result && (
          <div className="scale-in" style={{
            marginTop: 28, padding: "20px 24px", borderRadius: 12,
            background: isAllow ? "var(--green-lt)" : isBlock ? "var(--red-lt)" : "var(--amber-lt)",
            border: `1px solid ${isAllow ? "#a3d9c8" : isBlock ? "#f5c2b8" : "#f5dfa3"}`,
          }}>
            <div style={{ fontSize: 42, marginBottom: 8 }}>
              {isAllow ? "✅" : isBlock ? "🚫" : "❓"}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6, color: isAllow ? "var(--green-dk)" : isBlock ? "var(--red)" : "var(--amber)" }}>
              {isAllow ? "Delivery Available!" : isBlock ? "Delivery Blocked" : "No Rule Matched"}
            </div>
            <div style={{ fontSize: 14, color: "var(--g700)", lineHeight: 1.6, marginBottom: result.rule ? 12 : 0 }}>
              {result.message || (isNoMatch ? "This zip code has no matching rule. Default behavior applies." : "")}
            </div>
            {result.rule && (
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--g500)", background: "rgba(255,255,255,.6)", padding: "6px 12px", borderRadius: 8, display: "inline-block" }}>
                Matched rule: <b>{result.rule.name}</b>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Quick test buttons */}
      <Card style={{ marginBottom: 24 }}>
        <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 800, color: "var(--g700)" }}>Quick Test Zip Codes</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {["10001","10005","90210","90401","73301","75001","33101","94102","30301","60601"].map(z => (
            <button key={z} onClick={() => { setZip(z); setResult(null); setError(""); }}
              style={{ padding: "6px 14px", background: zip === z ? "var(--g900)" : "var(--g100)", color: zip === z ? "#fff" : "var(--g700)",
                border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontFamily: "var(--mono)", fontWeight: 600, transition: "all .15s" }}>
              {z}
            </button>
          ))}
        </div>
      </Card>

      {/* History */}
      {history.length > 0 && (
        <Card>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Check History</h3>
            <button onClick={() => setHistory([])} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--g400)", fontWeight: 600 }}>Clear</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {history.map((h, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px",
                background: "var(--g50)", borderRadius: 8, fontSize: 13 }}>
                <span style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 14 }}>{h.zip}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 18 }}>{h.result === "allow" ? "✅" : h.result === "block" ? "🚫" : "❓"}</span>
                <span style={{ fontWeight: 700, color: h.result === "allow" ? "var(--green)" : h.result === "block" ? "var(--red)" : "var(--amber)", width: 72 }}>{h.result}</span>
                {h.rule && <span style={{ fontSize: 11, color: "var(--g400)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.rule.name}</span>}
                <span style={{ fontSize: 11, color: "var(--g400)", marginLeft: "auto" }}>{h.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
