// src/pages/SettingsPage.jsx
import { useState, useEffect } from "react";
import { settingsApi } from "../utils/api";
import { Card, Btn, Input, Select, Toggle, Spinner, Section, toast } from "../components/common";

const Row = ({ label, desc, children }) => (
  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"13px 0", borderBottom:"1px solid var(--g100)" }}>
    <div style={{ flex:1, paddingRight:24 }}>
      <div style={{ fontSize:14, fontWeight:600 }}>{label}</div>
      {desc && <div style={{ fontSize:12, color:"var(--g400)", marginTop:2 }}>{desc}</div>}
    </div>
    {children}
  </div>
);

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    settingsApi.get().then(r => setSettings(r.data)).catch(e => toast(e.message,"error")).finally(()=>setLoading(false));
  }, []);

  const set = (k, v) => setSettings(s => ({ ...s, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await settingsApi.update(settings);
      setSettings(res.data);
      toast("Settings saved successfully");
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  if (loading) return <div style={{ display:"flex", justifyContent:"center", padding:60 }}><Spinner size={32} /></div>;
  if (!settings) return null;

  return (
    <div className="fade-up">
      <Section title="Widget Settings" desc="Configure how the zip code checker appears in your storefront">
        <Row label="Enable Widget" desc="Show the zip code checker on your store"><Toggle checked={settings.widgetEnabled} onChange={v=>set("widgetEnabled",v)} /></Row>
        <Row label="Widget Placement">
          <Select value={settings.widgetPlacement} onChange={e=>set("widgetPlacement",e.target.value)}
            options={[{value:"product_page",label:"Product Page"},{value:"cart_page",label:"Cart Page"},{value:"checkout",label:"Checkout"},{value:"all",label:"All Pages"}]}
            style={{ width:200 }} />
        </Row>
        <Row label="Widget Label" desc="Label shown above the zip input">
          <Input value={settings.widgetLabel} onChange={e=>set("widgetLabel",e.target.value)} style={{ width:260 }} />
        </Row>
        <Row label="Input Placeholder">
          <Input value={settings.widgetPlaceholder} onChange={e=>set("widgetPlaceholder",e.target.value)} style={{ width:260 }} />
        </Row>
      </Section>

      <Section title="Checkout Behavior" desc="Control how rules affect the checkout flow">
        <Row label="Check on Cart Page" desc="Validate zip before checkout"><Toggle checked={settings.checkOnCart} onChange={v=>set("checkOnCart",v)} /></Row>
        <Row label="Block Checkout on Invalid Zip" desc="Prevent checkout if zip is blocked"><Toggle checked={settings.blockCheckout} onChange={v=>set("blockCheckout",v)} /></Row>
        <Row label="Show Rule Message" desc="Display custom message from matching rule"><Toggle checked={settings.showMessage} onChange={v=>set("showMessage",v)} /></Row>
      </Section>

      <Section title="Notifications">
        <Row label="Email Notifications" desc="Alerts for high blocked-zip activity"><Toggle checked={settings.emailNotify} onChange={v=>set("emailNotify",v)} /></Row>
        {settings.emailNotify && (
          <Row label="Notification Email">
            <Input type="email" value={settings.notifyEmail} onChange={e=>set("notifyEmail",e.target.value)} style={{ width:260 }} />
          </Row>
        )}
      </Section>

      <Section title="API & Integration">
        <Row label="API Key" desc="Use this to integrate with external systems">
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <code style={{ fontFamily:"var(--mono)", fontSize:12, color:"var(--g600)", background:"var(--g100)", padding:"6px 10px", borderRadius:6 }}>
              {settings.apiKey}
            </code>
            <button onClick={()=>{navigator.clipboard?.writeText(settings.apiKey);toast("API key copied");}}
              style={{ background:"var(--g100)", border:"none", borderRadius:7, padding:"7px 10px", cursor:"pointer", fontSize:13 }}>⧉</button>
          </div>
        </Row>
        <Row label="Store URL">
          <Input value={settings.storeUrl} onChange={e=>set("storeUrl",e.target.value)} style={{ width:260 }} />
        </Row>
      </Section>

      <div style={{ display:"flex", justifyContent:"flex-end", gap:10 }}>
        <Btn variant="secondary" onClick={()=>window.location.reload()}>Discard Changes</Btn>
        <Btn onClick={save} loading={saving}>Save All Settings</Btn>
      </div>
    </div>
  );
}
