import React, { useState, useCallback, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { SettingsPanel } from "./SettingsPanel";
import { ConsolePanel } from "@/components/shared/ConsolePanel";
import { useWebSocket } from "@/hooks/useApi";
import type { PageId } from "@/app";

interface AppShellProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  children: React.ReactNode;
}

export function AppShell({ activePage, onNavigate, children }: AppShellProps) {
  const [statusMessage, setStatusMessage] = useState("Ready");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);

  const onWsMessage = useCallback(
    (msg: { type: string; data: Record<string, unknown> }) => {
      if (msg.type === "status" && typeof msg.data.message === "string") {
        setStatusMessage(msg.data.message);
      }
    },
    [],
  );

  useWebSocket(onWsMessage);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        setConsoleOpen((prev) => !prev);
      }
      if (e.ctrlKey && e.key === ",") {
        e.preventDefault();
        setSettingsOpen((prev) => !prev);
      }
      if (e.ctrlKey && e.key === "1") { e.preventDefault(); onNavigate("gemini"); }
      if (e.ctrlKey && e.key === "2") { e.preventDefault(); onNavigate("multiview"); }
      if (e.ctrlKey && e.key === "3") { e.preventDefault(); onNavigate("character"); }
      if (e.ctrlKey && e.key === "4") { e.preventDefault(); onNavigate("weapon"); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onNavigate]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        activePage={activePage}
        onNavigate={onNavigate}
        onSettingsClick={() => setSettingsOpen(true)}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <main
          className="flex-1 overflow-hidden relative"
          style={{
            background: "var(--color-background)",
            marginBottom: consoleOpen ? "280px" : 0,
            transition: "margin-bottom 0.2s ease",
          }}
        >
          {children}
        </main>
        <StatusBar
          message={statusMessage}
          onConsoleToggle={() => setConsoleOpen((prev) => !prev)}
          consoleOpen={consoleOpen}
        />
      </div>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ConsolePanel open={consoleOpen} onClose={() => setConsoleOpen(false)} />
    </div>
  );
}
