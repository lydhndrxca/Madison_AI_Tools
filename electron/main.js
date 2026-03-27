const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");

let mainWindow = null;
let pythonProcess = null;

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
    console.log(`[Python] ${data.toString().trim()}`);
  });

  pythonProcess.stderr.on("data", (data) => {
    console.error(`[Python] ${data.toString().trim()}`);
  });

  pythonProcess.on("close", (code) => {
    console.log(`[Python] exited with code ${code}`);
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: "#3C3C3C",
    title: "PUBG Madison AI Suite v2.0",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  Menu.setApplicationMenu(null);

  if (VITE_DEV_URL) {
    mainWindow.loadURL(VITE_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else if (hasDist()) {
    mainWindow.loadFile(path.join(__dirname, "..", "frontend", "dist", "index.html"));
  } else {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

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
