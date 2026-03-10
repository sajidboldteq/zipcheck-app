// src/pages/RulesPage.jsx
import { useState, useEffect, useCallback } from "react";
import { rulesApi } from "../utils/api";
import { Badge, Btn, Card, Modal, Input, Select, Empty, Toggle, ZipTag, Spinner, toast } from "../components/common";

function RuleForm({ rule, onSave, onCancel }) {
  const [form, setForm] = useState(rule || { name:"", action:"allow", status:"active", zipCodes:[], products:["All Products"], message:"", errorMessage:"" });
  const [zipInput, setZipInput] = useState("");
  const [zipError, setZipError] = useState("");
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addZips = () => {
    const zips = zipInput.split(",").map(z => z.trim()).filter(Boolean);
    const bad = zips.find(z => !/^\d{5}(-\d{4})?$/.test(z));
    if (bad) { setZipError(`"${bad}" is not a valid US zip code`); return; }
    const newZips = [...new Set([...form.zipCodes, ...zips.filter(z => !form.zipCodes.includes(z))])];
    set("zipCodes", newZips); setZipInput(""); setZipError("");
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    if (!form.zipCodes.length) { setZipError("Add at least one zip code"); return; }
    setSaving(true);
    try { await onSave(form); }
    catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
      <Input label="Rule Name *" value={form.name} onChange={e=>set("name",e.target.value)} placeholder="e.g. NYC Delivery Zone" />

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
        <Select label="Action *" value={form.action} onChange={e=>set("action",e.target.value)}
          options={[{ value:"allow", label:"✓ Allow Delivery" }, { value:"block", label:"✕ Block Delivery" }]} />
        <Select label="Status" value={form.status} onChange={e=>set("status",e.target.value)}
          options={[{ value:"active", label:"Active" }, { value:"paused", label:"Paused" }]} />
      </div>

      {/* Zip codes */}
      <div>
        <label style={{ fontSize:13, fontWeight:600, color:"var(--g700)", display:"block", marginBottom:6 }}>
          Zip Codes * <span style={{ fontWeight:400, color:"var(--g400)" }}>({form.zipCodes.length} added)</span>
        </label>
        <div style={{ display:"flex", gap:8, marginBottom:8 }}>
          <input value={zipInput} onChange={e=>{setZipInput(e.target.value);setZipError("");}} onKeyDown={e=>e.key==="Enter"&&(e.preventDefault(),addZips())}
            placeholder="10001, 10002, 10003... (comma-separated)"
            style={{ flex:1, padding:"9px 12px", border:`1px solid ${zipError?"var(--red)":"var(--g300)"}`, borderRadius:"var(--r)", fontSize:14, outline:"none", fontFamily:"var(--mono)" }} />
          <Btn variant="secondary" onClick={addZips}>Add</Btn>
        </div>
        {zipError && <div style={{ fontSize:12, color:"var(--red)", marginBottom:6 }}>{zipError}</div>}
        {form.zipCodes.length > 0 && (
          <div style={{ display:"flex", flexWrap:"wrap", gap:5, background:"var(--g50)", borderRadius:8, padding:10, border:"1px solid var(--g200)", maxHeight:130, overflow:"auto" }}>
            {form.zipCodes.map(z => <ZipTag key={z} zip={z} onRemove={zip=>set("zipCodes",form.zipCodes.filter(x=>x!==zip))} />)}
          </div>
        )}
        <div style={{ fontSize:11, color:"var(--g400)", marginTop:5 }}>Tip: Paste a list of comma-separated zip codes, then click Add</div>
      </div>

      {form.action === "allow" && (
        <Input label="Success Message" value={form.message} onChange={e=>set("message",e.target.value)} placeholder="Great! We deliver to your area." hint="Shown to customers when their zip is allowed" />
      )}
      {form.action === "block" && (
        <Input label="Block Message" value={form.errorMessage} onChange={e=>set("errorMessage",e.target.value)} placeholder="Sorry, we don't deliver to your area." hint="Shown to customers when their zip is blocked" />
      )}

      <Select label="Apply To" value={form.products?.[0]||"All Products"} onChange={e=>set("products",[e.target.value])}
        options={[{ value:"All Products",label:"All Products" },{ value:"Specific Products",label:"Specific Products" },{ value:"Specific Collections",label:"Specific Collections" }]} />

      <div style={{ display:"flex", gap:10, justifyContent:"flex-end", paddingTop:8, borderTop:"1px solid var(--g200)" }}>
        <Btn variant="secondary" onClick={onCancel}>Cancel</Btn>
        <Btn onClick={handleSubmit} loading={saving} disabled={!form.name||!form.zipCodes.length}>
          {rule ? "Save Changes" : "Create Rule"}
        </Btn>
      </div>
    </div>
  );
}

export default function RulesPage() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterAction, setFilterAction] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [editRule, setEditRule] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await rulesApi.getAll({ status: filterStatus, action: filterAction, search });
      setRules(res.data);
    } catch (e) { toast(e.message, "error"); }
    finally { setLoading(false); }
  }, [filterStatus, filterAction, search]);

  useEffect(() => { const t = setTimeout(load, search ? 300 : 0); return () => clearTimeout(t); }, [load]);

  const handleCreate = async (form) => {
    const res = await rulesApi.create(form);
    setRules(prev => [...prev, res.data]);
    setShowCreate(false);
    toast("Rule created successfully");
  };

  const handleUpdate = async (form) => {
    const res = await rulesApi.update(editRule.id, form);
    setRules(prev => prev.map(r => r.id === editRule.id ? res.data : r));
    setEditRule(null);
    toast("Rule updated");
  };

  const handleToggle = async (id) => {
    setToggling(id);
    try {
      const res = await rulesApi.toggle(id);
      setRules(prev => prev.map(r => r.id === id ? res.data : r));
      toast(res.data.status === "active" ? "Rule activated" : "Rule paused");
    } catch (e) { toast(e.message, "error"); }
    finally { setToggling(null); }
  };

  const handleDuplicate = async (id) => {
    try {
      const res = await rulesApi.duplicate(id);
      setRules(prev => [...prev, res.data]);
      toast("Rule duplicated");
    } catch (e) { toast(e.message, "error"); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await rulesApi.delete(deleteId);
      setRules(prev => prev.filter(r => r.id !== deleteId));
      toast("Rule deleted");
      setDeleteId(null);
    } catch (e) { toast(e.message, "error"); }
    finally { setDeleting(false); }
  };

  const tabBtn = (label, val, active, setter) => (
    <button key={val} onClick={() => setter(val)}
      style={{ padding:"10px 14px", border:"none", background:"none", cursor:"pointer", fontSize:13,
        fontWeight:active===val?700:500, color:active===val?"var(--green)":"var(--g500)",
        borderBottom:active===val?"2px solid var(--green)":"2px solid transparent",
        marginBottom:-1, fontFamily:"var(--font)", transition:"all var(--t)" }}>
      {label}
    </button>
  );

  return (
    <div className="fade-up">
      {/* Toolbar */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
        <div style={{ position:"relative" }}>
          <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:"var(--g400)" }}>🔍</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search rules or zip codes..."
            style={{ padding:"9px 12px 9px 32px", border:"1px solid var(--g300)", borderRadius:"var(--r)",
              fontSize:14, outline:"none", width:280, fontFamily:"var(--font)", background:"#fff" }} />
        </div>
        <Btn icon={<span style={{ fontSize:16 }}>+</span>} onClick={()=>setShowCreate(true)}>Create Rule</Btn>
      </div>

      {/* Filter tabs */}
      <Card p={0} style={{ marginBottom:14, overflow:"hidden" }}>
        <div style={{ display:"flex", padding:"0 12px", borderBottom:"1px solid var(--g100)", gap:2 }}>
          {tabBtn("All", "all", filterStatus, setFilterStatus)}
          {tabBtn("Active", "active", filterStatus, setFilterStatus)}
          {tabBtn("Paused", "paused", filterStatus, setFilterStatus)}
          <div style={{ width:1, background:"var(--g200)", margin:"8px 8px", height:24 }} />
          {tabBtn("All Actions", "all", filterAction, setFilterAction)}
          {tabBtn("Allow Only", "allow", filterAction, setFilterAction)}
          {tabBtn("Block Only", "block", filterAction, setFilterAction)}
        </div>
      </Card>

      {/* List */}
      {loading ? (
        <div style={{ display:"flex", justifyContent:"center", padding:60 }}><Spinner size={32} /></div>
      ) : rules.length === 0 ? (
        <Card><Empty emoji="📋" title="No rules found" desc="Create your first rule to start checking zip codes." action={<Btn onClick={()=>setShowCreate(true)}>Create First Rule</Btn>} /></Card>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {rules.map((rule, idx) => {
            const expanded = expandedId === rule.id;
            return (
              <Card key={rule.id} p={0} style={{ overflow:"hidden" }}>
                <div style={{ display:"flex", alignItems:"center", gap:14, padding:"15px 18px", cursor:"pointer" }}
                  onClick={()=>setExpandedId(expanded?null:rule.id)}>
                  <div style={{ width:28, height:28, borderRadius:7, background:"var(--g100)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800, color:"var(--g500)", flexShrink:0 }}>#{idx+1}</div>
                  <div style={{ width:36, height:36, borderRadius:9, flexShrink:0, background:rule.action==="allow"?"var(--green-lt)":"var(--red-lt)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>
                    {rule.action==="allow"?"✓":"✕"}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, flexWrap:"wrap" }}>
                      <span style={{ fontSize:15, fontWeight:700 }}>{rule.name}</span>
                      <Badge type={rule.status} dot>{rule.status}</Badge>
                      <Badge type={rule.action}>{rule.action}</Badge>
                    </div>
                    <div style={{ display:"flex", gap:14, fontSize:12, color:"var(--g400)", flexWrap:"wrap" }}>
                      <span>📮 {rule.zipCodes.length} zip codes</span>
                      <span>📦 {rule.products?.join(", ")}</span>
                      <span>📅 {new Date(rule.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:5, flexWrap:"wrap", maxWidth:200 }}>
                    {rule.zipCodes.slice(0,3).map(z=><ZipTag key={z} zip={z} />)}
                    {rule.zipCodes.length>3&&<span style={{ fontSize:11, color:"var(--g400)", padding:"3px 6px", fontWeight:600 }}>+{rule.zipCodes.length-3}</span>}
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }} onClick={e=>e.stopPropagation()}>
                    <Toggle checked={rule.status==="active"} onChange={()=>handleToggle(rule.id)} loading={toggling===rule.id} />
                    <button onClick={()=>handleDuplicate(rule.id)} title="Duplicate" style={{ background:"var(--g100)", border:"none", borderRadius:7, padding:"6px 9px", cursor:"pointer", fontSize:13 }}>⧉</button>
                    <button onClick={()=>setEditRule(rule)} title="Edit" style={{ background:"var(--g100)", border:"none", borderRadius:7, padding:"6px 9px", cursor:"pointer", fontSize:13 }}>✎</button>
                    <button onClick={()=>setDeleteId(rule.id)} title="Delete" style={{ background:"var(--red-lt)", border:"none", borderRadius:7, padding:"6px 9px", cursor:"pointer", fontSize:13 }}>🗑</button>
                  </div>
                  <span style={{ color:"var(--g300)", fontSize:16, transition:"transform .2s", transform:expanded?"rotate(90deg)":"rotate(0deg)", flexShrink:0 }}>›</span>
                </div>

                {/* Expanded */}
                {expanded && (
                  <div style={{ borderTop:"1px solid var(--g100)", padding:"16px 18px", background:"var(--g50)" }}>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
                      <div>
                        <div style={{ fontSize:11, fontWeight:700, color:"var(--g400)", textTransform:"uppercase", letterSpacing:".06em", marginBottom:8 }}>All Zip Codes ({rule.zipCodes.length})</div>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                          {rule.zipCodes.map(z=><ZipTag key={z} zip={z} />)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize:11, fontWeight:700, color:"var(--g400)", textTransform:"uppercase", letterSpacing:".06em", marginBottom:8 }}>Customer Message</div>
                        <div style={{ background:"#fff", border:"1px solid var(--g200)", borderRadius:8, padding:"10px 14px", fontSize:13, color:"var(--g700)", lineHeight:1.6, fontStyle:"italic" }}>
                          "{rule.action==="allow" ? rule.message||"Delivery available!" : rule.errorMessage||"Delivery not available."}"
                        </div>
                        <div style={{ marginTop:10, fontSize:12, color:"var(--g500)" }}>
                          <b>Updated:</b> {new Date(rule.updatedAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Modals */}
      <Modal open={showCreate} onClose={()=>setShowCreate(false)} title="Create New Rule" size="lg">
        <RuleForm onSave={handleCreate} onCancel={()=>setShowCreate(false)} />
      </Modal>
      <Modal open={!!editRule} onClose={()=>setEditRule(null)} title="Edit Rule" size="lg">
        <RuleForm rule={editRule} onSave={handleUpdate} onCancel={()=>setEditRule(null)} />
      </Modal>
      <Modal open={!!deleteId} onClose={()=>setDeleteId(null)} title="Delete Rule" size="sm"
        footer={<><Btn variant="secondary" onClick={()=>setDeleteId(null)}>Cancel</Btn><Btn variant="danger" onClick={handleDelete} loading={deleting}>Delete Rule</Btn></>}>
        <p style={{ color:"var(--g600)", lineHeight:1.7, fontSize:14 }}>Are you sure? This rule and all its zip code configurations will be permanently removed.</p>
      </Modal>
    </div>
  );
}
