/// <reference types="vite/client" />

interface ClipboardResult {
  dataUrl?: string;
  imageUrl?: string;
}

interface Window {
  electronAPI?: {
    platform: string;
    /** Pull: read image from system clipboard (context-menu Paste). */
    readClipboardImage: () => Promise<ClipboardResult | null>;
    /** Push: main process sends pasted image data on every Ctrl+V. Returns unsubscribe fn. */
    onPasteImage: (callback: (result: ClipboardResult) => void) => () => void;
    /** Session: Save As — native dialog, returns filePath or null. */
    saveSession: (data: string) => Promise<string | null>;
    /** Session: Save to known path (no dialog). Returns true on success. */
    saveSessionToPath: (filePath: string, data: string) => Promise<boolean>;
    /** Session: get list of recent session file paths. */
    getRecentSessionFiles: () => Promise<string[]>;
    /** Session: open a specific session file by path. */
    openSessionFile: (filePath: string) => Promise<boolean>;
    /** Session: main requests renderer to collect state and save. */
    onRequestSave: (callback: () => void) => () => void;
    /** Session: main sends loaded session JSON to renderer (with optional filePath). */
    onSessionLoaded: (callback: (data: string, filePath?: string) => void) => () => void;
    /** Menu: open external console window. */
    menuShowConsole: () => Promise<void>;
    /** Menu: trigger open session dialog from renderer. */
    menuOpenSession: () => Promise<void>;
    /** Menu: trigger set save folder dialog from renderer. */
    menuSetSaveFolder: () => Promise<void>;
    /** Menu: reset save folder to default. */
    menuResetSaveFolder: () => Promise<void>;
    /** Menu: reset app (clear cache + reload). */
    menuResetApp: () => Promise<void>;
    /** Profile: save ZIP bytes to disk via native dialog. Returns true if saved. */
    saveProfileFile: (data: number[], defaultName: string) => Promise<boolean>;
    /** Profile: open ZIP from disk via native dialog. Returns byte array or null. */
    openProfileFile: () => Promise<number[] | null>;
  };
}
