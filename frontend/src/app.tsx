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
import { PromptBuilderPage } from "./components/tools/prompt-builder/PromptBuilderPage";
import { CustomSectionsProvider } from "./hooks/CustomSectionsContext";
import { VoiceDirectorProvider } from "./hooks/useVoiceDirector";
import { useSettingsBackup } from "./hooks/useSettingsBackup";
import { ArtDirectorProvider } from "./hooks/ArtDirectorContext";
import { TranscriptsPage } from "./components/tools/transcripts/TranscriptsPage";

export type PageId = "style-library" | "prompt-builder" | "generated-images" | "favorites" | "history" | "gemini" | "multiview" | "character" | "weapon" | "prop" | "environment" | "uilab" | "3d" | "transcripts";

function AppInner() {
  const [activePage, setActivePage] = useState<PageId>("character");
  const { addToast } = useToastContext();
  const VALID_PAGES = new Set<string>(["style-library", "prompt-builder", "generated-images", "favorites", "history", "gemini", "multiview", "character", "weapon", "prop", "environment", "uilab", "3d", "transcripts"]);
  const setPage = useCallback((p: string) => { if (VALID_PAGES.has(p)) setActivePage(p as PageId); }, []);

  return (
    <VoiceDirectorProvider activePage={activePage}>
    <SessionProvider activePage={activePage} onSetActivePage={setPage} onToast={addToast}>
      <AppShell activePage={activePage} onNavigate={setActivePage}>
        <div className="h-full" style={{ display: activePage === "style-library" ? "contents" : "none" }}><StyleLibraryPage /></div>
        <div className="h-full" style={{ display: activePage === "prompt-builder" ? "contents" : "none" }}><PromptBuilderPage /></div>
        <div className="h-full" style={{ display: activePage === "generated-images" || activePage === "favorites" || activePage === "history" ? "contents" : "none" }}><GeneratedImagesPage defaultTab={activePage === "favorites" ? "favorites" : undefined} onNavigate={setPage} /></div>
        <div className="h-full" style={{ display: activePage === "gemini" ? "contents" : "none" }}><GeminiPage /></div>
        <div className="h-full" style={{ display: activePage === "multiview" ? "contents" : "none" }}><MultiviewPage /></div>
        <div className="h-full" style={{ display: activePage === "character" ? "contents" : "none" }}><CharacterLabWrapper /></div>
        <div className="h-full" style={{ display: activePage === "weapon" ? "contents" : "none" }}><WeaponPage active={activePage === "weapon"} /></div>
        <div className="h-full" style={{ display: activePage === "prop" ? "contents" : "none" }}><PropLabWrapper /></div>
        <div className="h-full" style={{ display: activePage === "environment" ? "contents" : "none" }}><EnvironmentLabWrapper /></div>
        <div className="h-full" style={{ display: activePage === "uilab" ? "contents" : "none" }}><UILabWrapper /></div>
        <div className="h-full" style={{ display: activePage === "transcripts" ? "contents" : "none" }}><TranscriptsPage /></div>
        {activePage === "3d" && (
          <div className="flex items-center justify-center h-full">
            <p style={{ color: "var(--color-text-muted)" }}>3D GEN AI — Coming Soon</p>
          </div>
        )}
      </AppShell>
    </SessionProvider>
    </VoiceDirectorProvider>
  );
}

function BackupInit() {
  useSettingsBackup();
  return null;
}

export function App() {
  return (
    <ToastProvider>
      <BackupInit />
      <ShortcutsProvider>
        <VoiceToTextProvider>
          <ArtboardProvider>
            <FavoritesProvider>
              <CustomSectionsProvider>
                <ArtDirectorProvider>
                  <AppInner />
                </ArtDirectorProvider>
              </CustomSectionsProvider>
            </FavoritesProvider>
          </ArtboardProvider>
        </VoiceToTextProvider>
      </ShortcutsProvider>
    </ToastProvider>
  );
}
