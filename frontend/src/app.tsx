import { useState, useCallback } from "react";
import { AppShell } from "./components/shell/AppShell";
import { GeminiPage } from "./components/tools/gemini/GeminiPage";
import { MultiviewPage } from "./components/tools/multiview/MultiviewPage";
import { CharacterLabWrapper } from "./components/tools/character/CharacterLabWrapper";
import { WeaponPage } from "./components/tools/weapon/WeaponPage";
import { PropLabWrapper } from "./components/tools/prop/PropLabWrapper";
import { EnvironmentLabWrapper } from "./components/tools/environment/EnvironmentLabWrapper";
import { UILabWrapper } from "./components/tools/uilab/UILabWrapper";
import { StyleLibraryPage } from "./components/tools/style-library/StyleLibraryPage";
import { GeneratedImagesPage } from "./components/tools/generated-images/GeneratedImagesPage";
import { ToastProvider, useToastContext } from "./hooks/ToastContext";
import { SessionProvider } from "./hooks/SessionContext";
import { ShortcutsProvider } from "./hooks/useShortcuts";
import { VoiceToTextProvider } from "./hooks/useVoiceToText";
import { ArtboardProvider } from "./hooks/ArtboardContext";
import { FavoritesProvider } from "./hooks/FavoritesContext";
import { PromptOverridesProvider } from "./hooks/PromptOverridesContext";
import { FavoritesPage } from "./components/tools/favorites/FavoritesPage";
import { PromptLibraryPage } from "./components/tools/prompt-library/PromptLibraryPage";
import { HistoryTimeline } from "./components/tools/history/HistoryTimeline";
import { PromptBuilderPage } from "./components/tools/prompt-builder/PromptBuilderPage";
import { CustomSectionsProvider } from "./hooks/CustomSectionsContext";

export type PageId = "style-library" | "prompt-builder" | "generated-images" | "favorites" | "prompt-library" | "history" | "gemini" | "multiview" | "character" | "weapon" | "prop" | "environment" | "uilab" | "3d";

function AppInner() {
  const [activePage, setActivePage] = useState<PageId>("character");
  const { addToast } = useToastContext();
  const setPage = useCallback((p: string) => setActivePage(p as PageId), []);

  return (
    <SessionProvider activePage={activePage} onSetActivePage={setPage} onToast={addToast}>
      <AppShell activePage={activePage} onNavigate={setActivePage}>
        <div className="h-full" style={{ display: activePage === "style-library" ? "contents" : "none" }}><StyleLibraryPage /></div>
        <div className="h-full" style={{ display: activePage === "prompt-builder" ? "contents" : "none" }}><PromptBuilderPage /></div>
        <div className="h-full" style={{ display: activePage === "generated-images" ? "contents" : "none" }}><GeneratedImagesPage /></div>
        <div className="h-full" style={{ display: activePage === "favorites" ? "contents" : "none" }}><FavoritesPage /></div>
        <div className="h-full" style={{ display: activePage === "prompt-library" ? "contents" : "none" }}><PromptLibraryPage /></div>
        <div className="h-full" style={{ display: activePage === "history" ? "contents" : "none" }}><HistoryTimeline /></div>
        <div className="h-full" style={{ display: activePage === "gemini" ? "contents" : "none" }}><GeminiPage /></div>
        <div className="h-full" style={{ display: activePage === "multiview" ? "contents" : "none" }}><MultiviewPage /></div>
        <div className="h-full" style={{ display: activePage === "character" ? "contents" : "none" }}><CharacterLabWrapper /></div>
        <div className="h-full" style={{ display: activePage === "weapon" ? "contents" : "none" }}><WeaponPage /></div>
        <div className="h-full" style={{ display: activePage === "prop" ? "contents" : "none" }}><PropLabWrapper /></div>
        <div className="h-full" style={{ display: activePage === "environment" ? "contents" : "none" }}><EnvironmentLabWrapper /></div>
        <div className="h-full" style={{ display: activePage === "uilab" ? "contents" : "none" }}><UILabWrapper /></div>
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
          <ArtboardProvider>
            <FavoritesProvider>
              <PromptOverridesProvider>
                <CustomSectionsProvider>
                  <AppInner />
                </CustomSectionsProvider>
              </PromptOverridesProvider>
            </FavoritesProvider>
          </ArtboardProvider>
        </VoiceToTextProvider>
      </ShortcutsProvider>
    </ToastProvider>
  );
}
