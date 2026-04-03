const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,

  // Pull: renderer asks main for clipboard image (used by context-menu Paste button)
  readClipboardImage: () => ipcRenderer.invoke("clipboard:readImage"),

  // Push: main tells renderer an image was pasted via Ctrl+V
  onPasteImage: (callback) => {
    const handler = (_event, dataUrl) => callback(dataUrl);
    ipcRenderer.on("clipboard:paste-image", handler);
    return () => ipcRenderer.removeListener("clipboard:paste-image", handler);
  },

  // Session: Save As — native dialog, returns filePath or null
  saveSession: (data) => ipcRenderer.invoke("session:save", data),

  // Session: Save to known path (no dialog)
  saveSessionToPath: (filePath, data) => ipcRenderer.invoke("session:save-to-path", filePath, data),

  // Session: recent files list
  getRecentSessionFiles: () => ipcRenderer.invoke("session:recent-files"),

  // Session: open a specific file by path
  openSessionFile: (filePath) => ipcRenderer.invoke("session:open-file", filePath),

  // Session: main requests renderer to collect & save state
  onRequestSave: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("session:request-save", handler);
    return () => ipcRenderer.removeListener("session:request-save", handler);
  },

  // Session: main sends loaded session data to renderer (with optional filePath)
  onSessionLoaded: (callback) => {
    const handler = (_event, data, filePath) => callback(data, filePath);
    ipcRenderer.on("session:loaded", handler);
    return () => ipcRenderer.removeListener("session:loaded", handler);
  },

  // Menu actions triggered from renderer
  menuShowConsole: () => ipcRenderer.invoke("menu:show-console"),
  menuOpenSession: () => ipcRenderer.invoke("menu:open-session"),
  menuSetSaveFolder: () => ipcRenderer.invoke("menu:set-save-folder"),
  menuResetSaveFolder: () => ipcRenderer.invoke("menu:reset-save-folder"),
  menuResetApp: () => ipcRenderer.invoke("menu:reset-app"),

  // Profile: save ZIP to disk via native dialog, returns true if saved
  saveProfileFile: (data, defaultName) =>
    ipcRenderer.invoke("profile:save", data, defaultName),

  // Profile: open ZIP from disk via native dialog, returns Uint8Array or null
  openProfileFile: () => ipcRenderer.invoke("profile:open"),
});
