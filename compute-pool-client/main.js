const { app, BrowserWindow, ipcMain } = require("electron");
const si = require("systeminformation");
const bonjour = require("bonjour")();
const WebSocket = require("ws");

let mainWindow;

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile("index.html");
});

// Fetch system info
ipcMain.handle("get-system-info", async () => {
  const cpu = await si.cpu();
  const mem = await si.mem();
  const gpu = await si.graphics();

  return {
    cpuModel: cpu.manufacturer + " " + cpu.brand,
    cpuCores: cpu.cores,
    cpuThreads: cpu.physicalCores,
    totalRAM: (mem.total / (1024 ** 3)).toFixed(2),
    freeRAM: (mem.available / (1024 ** 3)).toFixed(2),
    usedRAM: ((mem.total - mem.available) / (1024 ** 3)).toFixed(2),
    gpus: gpu.controllers.map(gpu => ({
      model: gpu.model,
      vram: gpu.vram ? gpu.vram + " MB" : "N/A"
    }))
  };
});

// Discover Compute Pools
ipcMain.handle("discover-pools", async () => {
  return new Promise((resolve) => {
    let pools = [];
    bonjour.find({ type: "ws" }, (service) => {
      pools.push({ name: service.name, host: service.host, port: service.port });
      resolve(pools);  // Send discovered pools back to the frontend
    });
  });
});

// Connect to Pool
ipcMain.handle("join-pool", async (event, { host, port, resources }) => {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}:${port}`);

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "JOIN", resources }));
      resolve(`Connected to ${host}:${port}`);
    });

    ws.on("error", (err) => reject(err.message));
  });
});
