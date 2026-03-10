// src/App.jsx
import { useState, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "./components/layout/Sidebar";
import TopBar from "./components/layout/TopBar";
import DashboardPage from "./pages/DashboardPage";
import RulesPage from "./pages/RulesPage";
import ZipGroupsPage from "./pages/ZipGroupsPage";
import CheckerPage from "./pages/CheckerPage";
import SettingsPage from "./pages/SettingsPage";
import { rulesApi } from "./utils/api";

export default function App() {
  const [ruleCount, setRuleCount] = useState(0);

  useEffect(() => {
    rulesApi.getAll().then(r => setRuleCount(r.total)).catch(() => {});
  }, []);

  return (
    <div style={{ display:"flex", height:"100vh", overflow:"hidden" }}>
      <Sidebar ruleCount={ruleCount} />
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <TopBar />
        <main style={{ flex:1, overflow:"auto", padding:28 }}>
          <Routes>
            <Route path="/"           element={<DashboardPage />} />
            <Route path="/rules"      element={<RulesPage />} />
            <Route path="/zip-groups" element={<ZipGroupsPage />} />
            <Route path="/checker"    element={<CheckerPage />} />
            <Route path="/settings"   element={<SettingsPage />} />
            <Route path="*"           element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
