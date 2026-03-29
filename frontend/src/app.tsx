import { useState, useCallback } from "react";
import { AppShell } from "./components/shell/AppShell";
import { GeminiPage } from "./components/tools/gemini/GeminiPage";
import { MultiviewPage } from "./components/tools/multiview/MultiviewPage";
import { CharacterPage } from "./components/tools/character/CharacterPage";
import { WeaponPage } from "./components/tools/weapon/WeaponPage";
import { StyleLibraryPage } from "./components/tools/style-library/StyleLibraryPage";
import { GeneratedImagesPage } from "./components/tools/generated-images/GeneratedImagesPage";
import { ToastProvider, useToastContext } from "./hooks/ToastContext";
import { SessionProvider } from "./hooks/SessionContext";
import { ShortcutsProvider } from "./hooks/useShortcuts";
import { VoiceToTextProvider } from "./hooks/useVoiceToText";

export type PageId = "style-library" | "generated-images" | "gemini" | "multiview" | "character" | "weapon" | "3d";

function AppInner() {
  const [activePage, setActivePage] = useState<PageId>("character");
  const { addToast } = useToastContext();
  const setPage = useCallback((p: string) => setActivePage(p as PageId), []);

  return (
    <SessionProvider activePage={activePage} onSetActivePage={setPage} onToast={addToast}>
      <AppShell activePage={activePage} onNavigate={setActivePage}>
        <div className="h-full" style={{ display: activePage === "style-library" ? "contents" : "none" }}><StyleLibraryPage /></div>
        <div className="h-full" style={{ display: activePage === "generated-images" ? "contents" : "none" }}><GeneratedImagesPage /></div>
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
    </SessionProvider>
  );
}

export function App() {
  return (
    <ToastProvider>
      <ShortcutsProvider>
        <VoiceToTextProvider>
          <AppInner />
        </VoiceToTextProvider>
      </ShortcutsProvider>
    </ToastProvider>
  );
}
