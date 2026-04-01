const { app, BrowserWindow, shell, ipcMain, dialog, clipboard, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, execSync } = require("child_process");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const DEV_URL = "http://127.0.0.1:5173";
const API_PORT = 8420;
const API_URL = `http://127.0.0.1:${API_PORT}`;

let mainWindow = null;
let backendProcess = null;
let viteProcess = null;

function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Server at ${url} did not start within ${timeoutMs}ms`));
        } else {
          setTimeout(check, 500);
        }
      });
      req.setTimeout(2000, () => { req.destroy(); });
    };
    check();
  });
}

function killPortProcess(port) {
  try {
    const out = execSync(
      `netstat -ano | findstr ":${port} " | findstr "LISTENING"`,
      { encoding: "utf8", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
    );
    const pids = new Set(
      out.split("\n").map((l) => l.trim().split(/\s+/).pop()).filter(Boolean)
    );
    for (const pid of pids) {
      try { execSync(`taskkill /F /PID ${pid}`, { windowsHide: true, stdio: "pipe" }); }
      catch { /* already dead */ }
    }
  } catch { /* nothing listening */ }
}

function startBackend() {
  const env = {
    ...process.env,
    PYTHONPATH: path.join(ROOT, "src"),
    PUBG_SUITE_SAVE_ROOT: path.join(ROOT, "ALL GENERATED IMAGES"),
    PUBG_SUITE_ROOT: ROOT,
  };

  backendProcess = spawn("python", [
    "-m", "uvicorn",
    "pubg_madison_ai_suite.api.server:app",
    "--host", "0.0.0.0",
    "--port", String(API_PORT),
  ], { cwd: ROOT, env, stdio: "pipe", windowsHide: true });

  backendProcess.stdout.on("data", (d) => process.stdout.write(`[backend] ${d}`));
  backendProcess.stderr.on("data", (d) => process.stderr.write(`[backend] ${d}`));
  backendProcess.on("exit", (code) => {
    console.log(`[backend] exited with code ${code}`);
    backendProcess = null;
  });
}

function startVite() {
  viteProcess = spawn("npx", ["vite", "--host", "127.0.0.1"], {
    cwd: path.join(ROOT, "frontend"),
    env: process.env,
    stdio: "pipe",
    shell: true,
    windowsHide: true,
  });

  viteProcess.stdout.on("data", (d) => process.stdout.write(`[vite] ${d}`));
  viteProcess.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
  viteProcess.on("exit", (code) => {
    console.log(`[vite] exited with code ${code}`);
    viteProcess = null;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 700,
    title: "Madison AI Suite",
    icon: path.join(__dirname, "..", "frontend", "public", "favicon.ico"),
    backgroundColor: "#1a1a2e",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.removeMenu();

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle("clipboard:readImage", () => {
  const img = clipboard.readImage();
  if (img.isEmpty()) return null;
  return { dataUrl: img.toDataURL() };
});

ipcMain.handle("session:save", async (_event, jsonStr) => {
  if (!mainWindow) return false;
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: "Save Session",
    defaultPath: path.join(app.getPath("documents"), "madison-session.json"),
    filters: [{ name: "Madison Session", extensions: ["json"] }],
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, jsonStr, "utf8");
  return true;
});

ipcMain.handle("menu:open-session", async () => {
  if (!mainWindow) return;
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: "Open Session",
    filters: [{ name: "Madison Session", extensions: ["json"] }],
    properties: ["openFile"],
  });
  if (canceled || filePaths.length === 0) return;
  try {
    const data = fs.readFileSync(filePaths[0], "utf8");
    JSON.parse(data);
    mainWindow.webContents.send("session:loaded", data);
  } catch (err) {
    console.error("[main] Failed to read session file:", err.message);
  }
});

ipcMain.handle("menu:show-console", () => {
  if (mainWindow) mainWindow.webContents.openDevTools();
});

ipcMain.handle("menu:set-save-folder", async () => {
  if (!mainWindow) return;
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: "Set Save Folder",
    properties: ["openDirectory"],
  });
  if (canceled || filePaths.length === 0) return;
  return filePaths[0];
});

ipcMain.handle("menu:reset-save-folder", () => {
  return true;
});

ipcMain.handle("menu:reset-app", () => {
  if (mainWindow) {
    mainWindow.webContents.session.clearStorageData();
    mainWindow.reload();
  }
});

// Forward Ctrl+V clipboard images to renderer
function setupClipboardPaste() {
  if (!mainWindow) return;
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (input.type === "keyDown" && input.key === "v" && input.control && !input.alt && !input.shift) {
      const img = clipboard.readImage();
      if (!img.isEmpty()) {
        mainWindow.webContents.send("clipboard:paste-image", { dataUrl: img.toDataURL() });
      }
    }
  });
}

app.on("ready", async () => {
  createWindow();
  setupClipboardPaste();
  mainWindow.loadURL("data:text/html,<html style='background:#1a1a2e;color:#ccc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'><div style='text-align:center'><h2>Madison AI Suite</h2><p>Starting servers\u2026</p></div></html>");

  killPortProcess(API_PORT);
  killPortProcess(5173);

  startBackend();
  startVite();

  try {
    await waitForServer(`${API_URL}/api/system/health`, 60000);
    console.log("[main] Backend ready");
  } catch (e) {
    console.error("[main] Backend failed to start:", e.message);
    console.error("[main] This usually means Python dependencies are missing.");
    console.error("[main] Try running: python -m pip install -r requirements.txt");
  }

  try {
    await waitForServer(DEV_URL, 30000);
    console.log("[main] Frontend ready");
  } catch {
    console.log("[main] Vite not detected — trying production build");
    const distIndex = path.join(ROOT, "frontend", "dist", "index.html");
    mainWindow.loadFile(distIndex);
    return;
  }

  mainWindow.loadURL(DEV_URL);
});

function cleanupChildren() {
  if (viteProcess) { viteProcess.kill(); viteProcess = null; }
  if (backendProcess) { backendProcess.kill(); backendProcess = null; }
}

app.on("window-all-closed", () => {
  cleanupChildren();
  app.quit();
});

app.on("before-quit", cleanupChildren);

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});
