import { useState, useCallback } from "react";
import { AppShell } from "./components/shell/AppShell";
import { GeminiPage } from "./components/tools/gemini/GeminiPage";
import { MultiviewPage } from "./components/tools/multiview/MultiviewPage";
import { CharacterLabWrapper } from "./components/tools/character/CharacterLabWrapper";
import { WeaponLabWrapper } from "./components/tools/weapon/WeaponLabWrapper";
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
import { ModelsProvider } from "./hooks/ModelsContext";
import { TranscriptsPage } from "./components/tools/transcripts/TranscriptsPage";
import { ThreeDGenPage } from "./components/tools/threedgen/ThreeDGenPage";
import { BrainstormPage } from "./components/tools/brainstorm/BrainstormPage";
import { WritingRoomPage } from "./components/tools/writingroom/WritingRoomPage";

export type PageId = "style-library" | "prompt-builder" | "generated-images" | "favorites" | "gemini" | "multiview" | "character" | "weapon" | "prop" | "environment" | "uilab" | "3d" | "transcripts" | "brainstorm" | "writingroom";

function AppInner() {
  const [activePage, setActivePage] = useState<PageId>("character");
  const { addToast } = useToastContext();
  const VALID_PAGES = new Set<string>(["style-library", "prompt-builder", "generated-images", "favorites", "gemini", "multiview", "character", "weapon", "prop", "environment", "uilab", "3d", "transcripts", "brainstorm", "writingroom"]);
  const setPage = useCallback((p: string) => { if (VALID_PAGES.has(p)) setActivePage(p as PageId); }, []);

  return (
    <VoiceDirectorProvider activePage={activePage}>
    <SessionProvider activePage={activePage} onSetActivePage={setPage} onToast={addToast}>
      <AppShell activePage={activePage} onNavigate={setActivePage}>
        <div className="h-full" style={{ display: activePage === "style-library" ? "contents" : "none" }}><StyleLibraryPage /></div>
        <div className="h-full" style={{ display: activePage === "prompt-builder" ? "contents" : "none" }}><PromptBuilderPage /></div>
        <div className="h-full" style={{ display: activePage === "generated-images" || activePage === "favorites" ? "contents" : "none" }}><GeneratedImagesPage defaultTab={activePage === "favorites" ? "favorites" : undefined} onNavigate={setPage} /></div>
        <div className="h-full" style={{ display: activePage === "gemini" ? "contents" : "none" }}><GeminiPage /></div>
        <div className="h-full" style={{ display: activePage === "multiview" ? "contents" : "none" }}><MultiviewPage /></div>
        <div className="h-full" style={{ display: activePage === "character" ? "contents" : "none" }}><CharacterLabWrapper /></div>
        <div className="h-full" style={{ display: activePage === "weapon" ? "contents" : "none" }}><WeaponLabWrapper /></div>
        <div className="h-full" style={{ display: activePage === "prop" ? "contents" : "none" }}><PropLabWrapper /></div>
        <div className="h-full" style={{ display: activePage === "environment" ? "contents" : "none" }}><EnvironmentLabWrapper /></div>
        <div className="h-full" style={{ display: activePage === "uilab" ? "contents" : "none" }}><UILabWrapper /></div>
        <div className="h-full" style={{ display: activePage === "transcripts" ? "contents" : "none" }}><TranscriptsPage /></div>
        <div className="h-full" style={{ display: activePage === "3d" ? "contents" : "none" }}><ThreeDGenPage visible={activePage === "3d"} /></div>
        <div className="h-full" style={{ display: activePage === "brainstorm" ? "contents" : "none" }}><BrainstormPage /></div>
        <div className="h-full" style={{ display: activePage === "writingroom" ? "contents" : "none" }}><WritingRoomPage /></div>
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
                <ModelsProvider>
                  <ArtDirectorProvider>
                    <AppInner />
                  </ArtDirectorProvider>
                </ModelsProvider>
              </CustomSectionsProvider>
            </FavoritesProvider>
          </ArtboardProvider>
        </VoiceToTextProvider>
      </ShortcutsProvider>
    </ToastProvider>
  );
}
