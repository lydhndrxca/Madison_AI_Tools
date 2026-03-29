const { app, BrowserWindow, Menu, ipcMain, clipboard, dialog } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");

let mainWindow = null;
let pythonProcess = null;
let consoleWindow = null;
const consoleLogs = [];

const PYTHON_PORT = parseInt(process.env.MADISON_API_PORT || "8420", 10);
const VITE_DEV_URL = process.env.VITE_DEV_SERVER_URL || "";

function hasDist() {
  return fs.existsSync(path.join(__dirname, "..", "frontend", "dist", "index.html"));
}

async function isBackendRunning() {
  try {
    const res = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/system/health`);
    return res.ok;
  } catch {
    return false;
  }
}

function startPythonBackend() {
  const pythonCmd = process.platform === "win32" ? "python" : "python3";
  const serverPath = path.join(__dirname, "..", "src", "pubg_madison_ai_suite", "api", "server.py");

  const env = {
    ...process.env,
    MADISON_API_PORT: String(PYTHON_PORT),
    PYTHONPATH: path.join(__dirname, "..", "src"),
  };

  pythonProcess = spawn(pythonCmd, [serverPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env,
  });

  pythonProcess.stdout.on("data", (data) => {
    const line = data.toString().trim();
    console.log(`[Python] ${line}`);
    pushConsoleLog("info", line);
  });

  pythonProcess.stderr.on("data", (data) => {
    const line = data.toString().trim();
    console.error(`[Python] ${line}`);
    pushConsoleLog("error", line);
  });

  pythonProcess.on("close", (code) => {
    console.log(`[Python] exited with code ${code}`);
    pushConsoleLog("info", `[Python] Process exited with code ${code}`);
    pythonProcess = null;
  });
}

async function waitForBackend(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/system/health`);
      if (res.ok) return true;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function readClipboardImageDataUrl() {
  try {
    const img = clipboard.readImage();
    if (!img.isEmpty()) {
      const size = img.getSize();
      console.log(`[Clipboard] readImage() got ${size.width}x${size.height} image`);
      const png = img.toPNG();
      console.log(`[Clipboard] toPNG() produced ${png.length} bytes`);
      return { dataUrl: `data:image/png;base64,${png.toString("base64")}` };
    }
    console.log("[Clipboard] readImage() empty, checking for HTML/text...");
    const html = clipboard.readHTML();
    const imgMatch = html && html.match(/<img[^>]+src="([^"]+)"/i);
    if (imgMatch) {
      console.log("[Clipboard] Found image URL in HTML clipboard");
      return { imageUrl: imgMatch[1] };
    }
    const text = clipboard.readText();
    if (text && /^https?:\/\/.+\.(png|jpe?g|gif|webp|bmp|svg)/i.test(text.trim())) {
      console.log("[Clipboard] Found image URL in text clipboard");
      return { imageUrl: text.trim() };
    }
    console.log("[Clipboard] No image data found in clipboard");
    return null;
  } catch (err) {
    console.error("[Clipboard] readImage error:", err);
    return null;
  }
}

function pushConsoleLog(level, text) {
  const entry = { time: new Date().toLocaleTimeString(), level, text };
  consoleLogs.push(entry);
  if (consoleLogs.length > 5000) consoleLogs.splice(0, consoleLogs.length - 4000);
  if (consoleWindow && !consoleWindow.isDestroyed()) {
    consoleWindow.webContents.send("console:log", entry);
  }
}

function openConsoleWindow() {
  if (consoleWindow && !consoleWindow.isDestroyed()) {
    consoleWindow.focus();
    return;
  }
  consoleWindow = new BrowserWindow({
    width: 900,
    height: 600,
    title: "Madison AI Suite — Console",
    backgroundColor: "#1e1e1e",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: false, nodeIntegration: true },
  });

  const html = `<!DOCTYPE html>
<html><head><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#1e1e1e; color:#d4d4d4; font-family:'Consolas','Courier New',monospace; font-size:12px; display:flex; flex-direction:column; height:100vh; }
  #toolbar { display:flex; align-items:center; gap:8px; padding:6px 12px; background:#2d2d2d; border-bottom:1px solid #444; flex-shrink:0; }
  #toolbar button { background:#3c3c3c; color:#ccc; border:1px solid #555; padding:4px 12px; border-radius:3px; cursor:pointer; font-size:11px; }
  #toolbar button:hover { background:#4a4a4a; }
  #toolbar span { color:#888; font-size:11px; margin-left:auto; }
  #logs { flex:1; overflow-y:auto; padding:8px 12px; white-space:pre-wrap; word-break:break-all; }
  .log-line { line-height:1.6; }
  .time { color:#666; margin-right:8px; }
  .error { color:#f48771; }
  .info { color:#d4d4d4; }
</style></head><body>
  <div id="toolbar">
    <button id="copyBtn">Copy All Text</button>
    <button id="clearBtn">Clear</button>
    <span id="count">0 lines</span>
  </div>
  <div id="logs"></div>
  <script>
    const {ipcRenderer} = require('electron');
    const logsEl = document.getElementById('logs');
    const countEl = document.getElementById('count');
    let lineCount = 0;

    function addLine(entry) {
      const div = document.createElement('div');
      div.className = 'log-line';
      div.innerHTML = '<span class="time">[' + entry.time + ']</span><span class="' + entry.level + '">' +
        entry.text.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</span>';
      logsEl.appendChild(div);
      lineCount++;
      countEl.textContent = lineCount + ' lines';
      logsEl.scrollTop = logsEl.scrollHeight;
    }

    ipcRenderer.on('console:log', (_e, entry) => addLine(entry));
    ipcRenderer.on('console:init', (_e, entries) => { entries.forEach(addLine); });

    document.getElementById('copyBtn').addEventListener('click', () => {
      const lines = [];
      logsEl.querySelectorAll('.log-line').forEach(el => lines.push(el.textContent));
      navigator.clipboard.writeText(lines.join('\\n')).then(() => {
        document.getElementById('copyBtn').textContent = 'Copied!';
        setTimeout(() => { document.getElementById('copyBtn').textContent = 'Copy All Text'; }, 1500);
      });
    });

    document.getElementById('clearBtn').addEventListener('click', () => {
      logsEl.innerHTML = '';
      lineCount = 0;
      countEl.textContent = '0 lines';
    });
  </script>
</body></html>`;

  consoleWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));

  consoleWindow.webContents.on("did-finish-load", () => {
    consoleWindow.webContents.send("console:init", consoleLogs);
  });

  consoleWindow.on("closed", () => { consoleWindow = null; });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: "#3C3C3C",
    title: "PUBG Madison AI Suite v2.0",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const menu = Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [
        {
          label: "Save Session",
          accelerator: "CmdOrCtrl+S",
          click: () => {
            if (mainWindow) mainWindow.webContents.send("session:request-save");
          },
        },
        {
          label: "Open Session",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            if (!mainWindow) return;
            const result = await dialog.showOpenDialog(mainWindow, {
              title: "Open Session",
              filters: [{ name: "Madison Session", extensions: ["madison"] }],
              properties: ["openFile"],
            });
            if (result.canceled || !result.filePaths[0]) return;
            try {
              const data = fs.readFileSync(result.filePaths[0], "utf-8");
              mainWindow.webContents.send("session:loaded", data);
            } catch (err) {
              console.error("[Session] Failed to read file:", err);
            }
          },
        },
        { type: "separator" },
        {
          label: "Set Save Folder…",
          click: async () => {
            if (!mainWindow) return;
            // Fetch current save folder from backend to show as default
            let defaultPath;
            try {
              const res = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/system/save-folder`);
              if (res.ok) {
                const data = await res.json();
                defaultPath = data.path;
              }
            } catch {}
            const result = await dialog.showOpenDialog(mainWindow, {
              title: "Choose Save Folder for Generated Images",
              defaultPath,
              properties: ["openDirectory", "createDirectory"],
            });
            if (result.canceled || !result.filePaths[0]) return;
            try {
              const res = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/system/save-folder`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: result.filePaths[0] }),
              });
              if (res.ok) {
                console.log(`[SaveFolder] Set to ${result.filePaths[0]}`);
              }
            } catch (err) {
              console.error("[SaveFolder] Failed to set:", err);
            }
          },
        },
        {
          label: "Reset Save Folder to Default",
          click: async () => {
            try {
              const res = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/system/reset-save-folder`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
              });
              if (res.ok) {
                const data = await res.json();
                console.log(`[SaveFolder] Reset to default: ${data.path}`);
              }
            } catch (err) {
              console.error("[SaveFolder] Failed to reset:", err);
            }
          },
        },
        { type: "separator" },
        {
          label: "Reset App",
          click: () => {
            if (!mainWindow) return;
            mainWindow.webContents.session.clearCache();
            mainWindow.webContents.session.clearStorageData();
            mainWindow.webContents.reloadIgnoringCache();
            console.log("[Reset] App cache cleared and reloaded");
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        {
          label: "Paste",
          accelerator: "CmdOrCtrl+V",
          click: () => {
            if (!mainWindow) return;
            const result = readClipboardImageDataUrl();
            if (result) {
              mainWindow.webContents.send("clipboard:paste-image", result);
            }
            mainWindow.webContents.paste();
          },
        },
        { role: "selectAll" },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  if (VITE_DEV_URL) {
    mainWindow.loadURL(VITE_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else if (hasDist()) {
    mainWindow.loadFile(path.join(__dirname, "..", "frontend", "dist", "index.html"));
  } else {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.webContents.on("console-message", (_e, level, message) => {
    const lvl = level >= 2 ? "error" : "info";
    pushConsoleLog(lvl, `[Renderer] ${message}`);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("clipboard:readImage", () => {
  console.log("[IPC] clipboard:readImage invoked");
  return readClipboardImageDataUrl();
});

ipcMain.handle("menu:open-session", async () => {
  if (!mainWindow) return;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open Session",
    filters: [{ name: "Madison Session", extensions: ["madison"] }],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths[0]) return;
  try {
    const data = fs.readFileSync(result.filePaths[0], "utf-8");
    mainWindow.webContents.send("session:loaded", data);
  } catch (err) {
    console.error("[Session] Failed to read file:", err);
  }
});

ipcMain.handle("menu:set-save-folder", async () => {
  if (!mainWindow) return;
  let defaultPath;
  try {
    const res = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/system/save-folder`);
    if (res.ok) { const data = await res.json(); defaultPath = data.path; }
  } catch {}
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose Save Folder for Generated Images",
    defaultPath,
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return;
  try {
    await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/system/save-folder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: result.filePaths[0] }),
    });
    console.log(`[SaveFolder] Set to ${result.filePaths[0]}`);
  } catch (err) {
    console.error("[SaveFolder] Failed to set:", err);
  }
});

ipcMain.handle("menu:reset-save-folder", async () => {
  try {
    await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/system/reset-save-folder`, {
      method: "POST", headers: { "Content-Type": "application/json" },
    });
    console.log("[SaveFolder] Reset to default");
  } catch (err) {
    console.error("[SaveFolder] Failed to reset:", err);
  }
});

ipcMain.handle("menu:show-console", () => {
  openConsoleWindow();
});

ipcMain.handle("menu:reset-app", () => {
  if (!mainWindow) return;
  mainWindow.webContents.session.clearCache();
  mainWindow.webContents.session.clearStorageData();
  mainWindow.webContents.reloadIgnoringCache();
  console.log("[Reset] App cache cleared and reloaded");
});

ipcMain.handle("session:save", async (_event, jsonData) => {
  if (!mainWindow) return false;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Save Session",
    filters: [{ name: "Madison Session", extensions: ["madison"] }],
    defaultPath: `session_${new Date().toISOString().slice(0, 10)}.madison`,
  });
  if (result.canceled || !result.filePath) return false;
  try {
    fs.writeFileSync(result.filePath, jsonData, "utf-8");
    console.log(`[Session] Saved to ${result.filePath}`);
    return true;
  } catch (err) {
    console.error("[Session] Failed to write file:", err);
    return false;
  }
});

app.whenReady().then(async () => {
  const alreadyRunning = await isBackendRunning();
  if (!alreadyRunning) {
    console.log("[Electron] Starting Python backend...");
    startPythonBackend();
    const ready = await waitForBackend();
    if (!ready) {
      console.warn("[Electron] Python backend did not start in time, proceeding anyway");
    }
  } else {
    console.log("[Electron] Python backend already running.");
  }
  createWindow();
});

app.on("window-all-closed", () => {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
  app.quit();
});

app.on("activate", () => {
  if (!mainWindow) createWindow();
});
