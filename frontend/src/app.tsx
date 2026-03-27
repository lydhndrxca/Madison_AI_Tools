import { useState } from "react";
import { AppShell } from "./components/shell/AppShell";
import { GeminiPage } from "./components/tools/gemini/GeminiPage";
import { MultiviewPage } from "./components/tools/multiview/MultiviewPage";
import { CharacterPage } from "./components/tools/character/CharacterPage";
import { WeaponPage } from "./components/tools/weapon/WeaponPage";
import { ToastProvider } from "./hooks/ToastContext";

export type PageId = "gemini" | "multiview" | "character" | "weapon" | "3d";

export function App() {
  const [activePage, setActivePage] = useState<PageId>("character");

  return (
    <ToastProvider>
      <AppShell activePage={activePage} onNavigate={setActivePage}>
        {/* All pages stay mounted so async API calls complete even when
            the user switches tabs. CSS hides inactive pages. */}
        <div className="h-full" style={{ display: activePage === "gemini" ? "contents" : "none" }}><GeminiPage /></div>
        <div className="h-full" style={{ display: activePage === "multiview" ? "contents" : "none" }}><MultiviewPage /></div>
        <div className="h-full" style={{ display: activePage === "character" ? "contents" : "none" }}><CharacterPage /></div>
        <div className="h-full" style={{ display: activePage === "weapon" ? "contents" : "none" }}><WeaponPage /></div>
        {activePage === "3d" && (
          <div className="flex items-center justify-center h-full">
            <p style={{ color: "var(--color-text-muted)" }}>3D GEN AI — Coming Soon</p>
          </div>
        )}
      </AppShell>
    </ToastProvider>
  );
}
