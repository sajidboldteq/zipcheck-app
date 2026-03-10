// src/pages/ZipGroupsPage.jsx
import { useState, useEffect } from "react";
import { groupsApi } from "../utils/api";
import { Card, Btn, Modal, Input, Empty, ZipTag, Spinner, toast } from "../components/common";

const COLORS = ["#008060","#005bd3","#b98900","#d72c0d","#7c3aed","#0891b2","#db2777","#ea580c"];

function GroupForm({ group, onSave, onCancel }) {
  const [form, setForm] = useState(group || { name:"", description:"", zipCodes:[], color:"#008060" });
  const [zipInput, setZipInput] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const addZips = () => {
    const zips = zipInput.split(",").map(z=>z.trim()).filter(z=>z&&/^\d{5}(-\d{4})?$/.test(z));
    if (!zips.length) return;
    set("zipCodes", [...new Set([...form.zipCodes, ...zips])]);
    setZipInput("");
  };
  const handleSave = async () => {
    setSaving(true);
    try { await onSave(form); }
    catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
      <Input label="Group Name *" value={form.name} onChange={e=>set("name",e.target.value)} placeholder="e.g. Northeast Corridor" />
      <Input label="Description" value={form.description} onChange={e=>set("description",e.target.value)} placeholder="Optional description..." />
      <div>
        <label style={{ fontSize:13, fontWeight:600, color:"var(--g700)", display:"block", marginBottom:8 }}>Color</label>
        <div style={{ display:"flex", gap:8 }}>
          {COLORS.map(c=>(
            <div key={c} onClick={()=>set("color",c)} style={{ width:28, height:28, borderRadius:"50%", background:c, cursor:"pointer",
              border:form.color===c?"3px solid var(--g900)":"3px solid transparent",
              boxShadow:form.color===c?`0 0 0 2px #fff, 0 0 0 4px ${c}`:"none", transition:"all .15s" }} />
          ))}
        </div>
      </div>
      <div>
        <label style={{ fontSize:13, fontWeight:600, color:"var(--g700)", display:"block", marginBottom:6 }}>Zip Codes * ({form.zipCodes.length})</label>
        <div style={{ display:"flex", gap:8, marginBottom:8 }}>
          <input value={zipInput} onChange={e=>setZipInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addZips()}
            placeholder="10001, 10002, 10003..."
            style={{ flex:1, padding:"9px 12px", border:"1px solid var(--g300)", borderRadius:"var(--r)", fontSize:14, outline:"none", fontFamily:"var(--mono)" }} />
          <Btn variant="secondary" onClick={addZips}>Add</Btn>
        </div>
        {form.zipCodes.length>0&&(
          <div style={{ display:"flex", flexWrap:"wrap", gap:5, background:"var(--g50)", borderRadius:8, padding:10, border:"1px solid var(--g200)", maxHeight:120, overflow:"auto" }}>
            {form.zipCodes.map(z=><ZipTag key={z} zip={z} onRemove={zip=>set("zipCodes",form.zipCodes.filter(x=>x!==zip))} />)}
          </div>
        )}
      </div>
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end", paddingTop:8, borderTop:"1px solid var(--g200)" }}>
        <Btn variant="secondary" onClick={onCancel}>Cancel</Btn>
        <Btn onClick={handleSave} loading={saving} disabled={!form.name||!form.zipCodes.length}>{group?"Save Changes":"Create Group"}</Btn>
      </div>
    </div>
  );
}

export default function ZipGroupsPage() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editGroup, setEditGroup] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const load = async () => {
    setLoading(true);
    try { const res = await groupsApi.getAll(); setGroups(res.data); }
    catch (e) { toast(e.message, "error"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const handleCreate = async (form) => {
    const res = await groupsApi.create(form);
    setGroups(prev => [...prev, res.data]);
    setShowCreate(false);
    toast("Group created");
  };
  const handleUpdate = async (form) => {
    const res = await groupsApi.update(editGroup.id, form);
    setGroups(prev => prev.map(g => g.id === editGroup.id ? res.data : g));
    setEditGroup(null);
    toast("Group updated");
  };
  const handleDelete = async () => {
    try {
      await groupsApi.delete(deleteId);
      setGroups(prev => prev.filter(g => g.id !== deleteId));
      toast("Group deleted");
      setDeleteId(null);
    } catch (e) { toast(e.message, "error"); }
  };

  return (
    <div className="fade-up">
      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:16 }}>
        <Btn icon={<span>+</span>} onClick={()=>setShowCreate(true)}>Create Group</Btn>
      </div>
      {loading ? <div style={{ display:"flex", justifyContent:"center", padding:60 }}><Spinner size={32} /></div> :
       groups.length === 0 ? <Card><Empty emoji="📦" title="No zip groups yet" desc="Create reusable groups of zip codes to use across multiple rules." action={<Btn onClick={()=>setShowCreate(true)}>Create First Group</Btn>} /></Card> : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))", gap:14 }}>
          {groups.map(g => {
            const expanded = expandedId === g.id;
            return (
              <Card key={g.id} p={0} style={{ overflow:"hidden" }}>
                <div style={{ height:5, background:g.color }} />
                <div style={{ padding:"16px 18px" }}>
                  <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:8 }}>
                    <div>
                      <div style={{ fontSize:15, fontWeight:800 }}>{g.name}</div>
                      {g.description && <div style={{ fontSize:12, color:"var(--g400)", marginTop:2 }}>{g.description}</div>}
                    </div>
                    <div style={{ display:"flex", gap:6 }}>
                      <button onClick={()=>setEditGroup(g)} style={{ background:"var(--g100)", border:"none", borderRadius:6, padding:"5px 8px", cursor:"pointer" }}>✎</button>
                      <button onClick={()=>setDeleteId(g.id)} style={{ background:"var(--red-lt)", border:"none", borderRadius:6, padding:"5px 8px", cursor:"pointer" }}>🗑</button>
                    </div>
                  </div>
                  <div style={{ marginBottom:10 }}>
                    <span style={{ fontSize:12, fontWeight:700, color:g.color, background:g.color+"18", padding:"2px 8px", borderRadius:20 }}>📮 {g.zipCodes.length} zip codes</span>
                  </div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                    {g.zipCodes.slice(0, expanded?undefined:6).map(z=><ZipTag key={z} zip={z} />)}
                    {g.zipCodes.length>6 && !expanded && (
                      <button onClick={()=>setExpandedId(g.id)} style={{ background:"none", border:"1px dashed var(--g300)", borderRadius:6, padding:"3px 8px", fontSize:12, cursor:"pointer", color:"var(--g500)", fontWeight:600 }}>
                        +{g.zipCodes.length-6} more
                      </button>
                    )}
                    {expanded && <button onClick={()=>setExpandedId(null)} style={{ background:"none", border:"1px solid var(--g200)", borderRadius:6, padding:"3px 8px", fontSize:12, cursor:"pointer", color:"var(--g500)", fontWeight:600 }}>Show less</button>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Modal open={showCreate} onClose={()=>setShowCreate(false)} title="Create Zip Group" size="md"><GroupForm onSave={handleCreate} onCancel={()=>setShowCreate(false)} /></Modal>
      <Modal open={!!editGroup} onClose={()=>setEditGroup(null)} title="Edit Zip Group" size="md"><GroupForm group={editGroup} onSave={handleUpdate} onCancel={()=>setEditGroup(null)} /></Modal>
      <Modal open={!!deleteId} onClose={()=>setDeleteId(null)} title="Delete Group" size="sm"
        footer={<><Btn variant="secondary" onClick={()=>setDeleteId(null)}>Cancel</Btn><Btn variant="danger" onClick={handleDelete}>Delete</Btn></>}>
        <p style={{ color:"var(--g600)", fontSize:14, lineHeight:1.7 }}>This group will be permanently deleted. Rules using this group will not be affected.</p>
      </Modal>
    </div>
  );
}
