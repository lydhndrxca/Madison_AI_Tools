const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");

const DEV_URL = "http://127.0.0.1:5173";
const API_PORT = 8420;
const API_URL = `http://127.0.0.1:${API_PORT}`;

let mainWindow = null;
let backendProcess = null;

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

function startBackend() {
  const root = path.resolve(__dirname, "..");
  const env = {
    ...process.env,
    PYTHONPATH: path.join(root, "src"),
    PUBG_SUITE_SAVE_ROOT: path.join(root, "ALL GENERATED IMAGES"),
    PUBG_SUITE_ROOT: root,
  };

  backendProcess = spawn("python", [
    "-m", "uvicorn",
    "pubg_madison_ai_suite.api.server:app",
    "--host", "127.0.0.1",
    "--port", String(API_PORT),
  ], { cwd: root, env, stdio: "pipe", windowsHide: true });

  backendProcess.stdout.on("data", (d) => process.stdout.write(`[backend] ${d}`));
  backendProcess.stderr.on("data", (d) => process.stderr.write(`[backend] ${d}`));
  backendProcess.on("exit", (code) => {
    console.log(`[backend] exited with code ${code}`);
    backendProcess = null;
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

app.on("ready", async () => {
  createWindow();
  mainWindow.loadURL("data:text/html,<html style='background:#1a1a2e;color:#ccc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'><div style='text-align:center'><h2>Madison AI Suite</h2><p>Starting servers...</p></div></html>");

  startBackend();

  try {
    await waitForServer(`${API_URL}/api/system/health`, 30000);
    console.log("[main] Backend ready");
  } catch (e) {
    console.error("[main] Backend failed to start:", e.message);
  }

  try {
    await waitForServer(DEV_URL, 15000);
    console.log("[main] Frontend ready");
  } catch {
    console.log("[main] Vite not detected — trying production build");
    const distIndex = path.join(__dirname, "..", "frontend", "dist", "index.html");
    mainWindow.loadFile(distIndex);
    return;
  }

  mainWindow.loadURL(DEV_URL);
});

app.on("window-all-closed", () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  app.quit();
});

app.on("before-quit", () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
});

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});
