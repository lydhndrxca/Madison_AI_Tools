import { useState, useCallback, useEffect, lazy, Suspense, Component, type ReactNode, type ErrorInfo } from "react";
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

import { useSettingsBackup } from "./hooks/useSettingsBackup";
import { ArtDirectorProvider } from "./hooks/ArtDirectorContext";
import { ModelsProvider } from "./hooks/ModelsContext";
import { ActivePageProvider } from "./hooks/ActivePageContext";
import { TranscriptsPage } from "./components/tools/transcripts/TranscriptsPage";
const ThreeDGenWrapper = lazy(() => import("./components/tools/threedgen/ThreeDGenWrapper").then(m => ({ default: m.ThreeDGenWrapper })));
import { BrainstormPage } from "./components/tools/brainstorm/BrainstormPage";
import { WritingRoomPage } from "./components/tools/writingroom/WritingRoomPage";
import { HelpPage } from "./components/tools/help/HelpPage";

export type PageId = "style-library" | "prompt-builder" | "generated-images" | "favorites" | "gemini" | "multiview" | "character" | "weapon" | "prop" | "environment" | "uilab" | "3d" | "transcripts" | "brainstorm" | "writingroom" | "help";

function AppInner() {
  const [activePage, setActivePage] = useState<PageId>("character");
  const { addToast } = useToastContext();
  const VALID_PAGES = new Set<string>(["style-library", "prompt-builder", "generated-images", "favorites", "gemini", "multiview", "character", "weapon", "prop", "environment", "uilab", "3d", "transcripts", "brainstorm", "writingroom", "help"]);
  const setPage = useCallback((p: string) => { if (VALID_PAGES.has(p)) setActivePage(p as PageId); }, []);

  useEffect(() => {
    const onCopy = () => addToast("Copied to Clipboard!", "success");
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, [addToast]);

  return (
    <ActivePageProvider value={activePage}>
    <SessionProvider activePage={activePage} onSetActivePage={setPage} onToast={addToast}>
      <AppShell activePage={activePage} onNavigate={setActivePage}>
        <div className="h-full" style={{ display: activePage === "style-library" ? "contents" : "none" }}><StyleLibraryPage /></div>
        <div className="h-full" style={{ display: activePage === "prompt-builder" ? "contents" : "none" }}><PromptBuilderPage /></div>
        <div className="h-full" style={{ display: activePage === "generated-images" || activePage === "favorites" ? "contents" : "none" }}><GeneratedImagesPage defaultTab={activePage === "favorites" ? "favorites" : "browse"} onNavigate={setPage} /></div>
        <div className="h-full" style={{ display: activePage === "gemini" ? "contents" : "none" }}><GeminiPage /></div>
        <div className="h-full" style={{ display: activePage === "multiview" ? "contents" : "none" }}><MultiviewPage /></div>
        <div className="h-full" style={{ display: activePage === "character" ? "contents" : "none" }}><CharacterLabWrapper /></div>
        <div className="h-full" style={{ display: activePage === "weapon" ? "contents" : "none" }}><WeaponLabWrapper /></div>
        <div className="h-full" style={{ display: activePage === "prop" ? "contents" : "none" }}><PropLabWrapper /></div>
        <div className="h-full" style={{ display: activePage === "environment" ? "contents" : "none" }}><EnvironmentLabWrapper /></div>
        <div className="h-full" style={{ display: activePage === "uilab" ? "contents" : "none" }}><UILabWrapper /></div>
        <div className="h-full" style={{ display: activePage === "transcripts" ? "contents" : "none" }}><TranscriptsPage /></div>
        <div className="h-full" style={{ display: activePage === "3d" ? "contents" : "none" }}><Suspense fallback={<div className="flex items-center justify-center h-full text-neutral-500">Loading 3D tools...</div>}><ThreeDGenWrapper visible={activePage === "3d"} /></Suspense></div>
        <div className="h-full" style={{ display: activePage === "brainstorm" ? "contents" : "none" }}><BrainstormPage /></div>
        <div className="h-full" style={{ display: activePage === "writingroom" ? "contents" : "none" }}><WritingRoomPage /></div>
        <div className="h-full" style={{ display: activePage === "help" ? "contents" : "none" }}><HelpPage /></div>
      </AppShell>
    </SessionProvider>
    </ActivePageProvider>
  );
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("[AppErrorBoundary]", error, info.componentStack); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "#1a1a1c", color: "#e0e0e0", fontFamily: "system-ui", gap: 16, padding: 32, textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 600 }}>Something went wrong</div>
          <div style={{ fontSize: 13, color: "#999", maxWidth: 480 }}>{this.state.error.message}</div>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 8, padding: "8px 20px", background: "#333", color: "#fff", border: "1px solid #555", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
            Try Again
          </button>
          <button onClick={() => window.location.reload()} style={{ padding: "8px 20px", background: "transparent", color: "#888", border: "1px solid #444", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
            Reload Application
          </button>
        </div>
      );
    }
    return this.props.children;
  }
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
                    <AppErrorBoundary>
                      <AppInner />
                    </AppErrorBoundary>
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
