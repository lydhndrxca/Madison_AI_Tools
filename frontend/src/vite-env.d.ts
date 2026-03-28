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
    /** Session: send collected state JSON to main for saving to disk. */
    saveSession: (data: string) => Promise<boolean>;
    /** Session: main requests renderer to collect state and save. */
    onRequestSave: (callback: () => void) => () => void;
    /** Session: main sends loaded session JSON to renderer. */
    onSessionLoaded: (callback: (data: string) => void) => () => void;
    /** Menu: trigger open session dialog from renderer. */
    menuOpenSession: () => Promise<void>;
    /** Menu: trigger set save folder dialog from renderer. */
    menuSetSaveFolder: () => Promise<void>;
    /** Menu: reset save folder to default. */
    menuResetSaveFolder: () => Promise<void>;
    /** Menu: reset app (clear cache + reload). */
    menuResetApp: () => Promise<void>;
  };
}
