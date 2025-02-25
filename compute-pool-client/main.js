const { app, BrowserWindow, ipcMain } = require("electron");
const si = require("systeminformation");
const bonjour = require("bonjour")();
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");
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
    cpuModel: `${cpu.manufacturer} ${cpu.brand}`,
    cpuCores: cpu.cores,
    cpuThreads: cpu.physicalCores,
    totalRAM: (mem.total / (1024 ** 3)).toFixed(2),
    freeRAM: (mem.available / (1024 ** 3)).toFixed(2),
    usedRAM: ((mem.total - mem.available) / (1024 ** 3)).toFixed(2),
    gpus: gpu.controllers.map(gpu => ({
      model: gpu.model,
      vram: gpu.vram ? `${gpu.vram} MB` : "N/A"
    }))
  };
});

// Improved Pool Discovery
ipcMain.handle("discover-pools", async () => {
  return new Promise((resolve) => {
    let pools = [];
    const browser = bonjour.find({ type: "ws" }, (service) => {
      pools.push({ name: service.name, host: service.host, port: service.port });
    });

    setTimeout(() => {
      browser.stop(); // Stop discovery after 3 seconds
      resolve(pools);
    }, 3000);
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

    ws.on("error", (err) => {
      ws.close();
      reject(err.message);
    });

    ws.on("close", () => {
      console.log(`Disconnected from ${host}:${port}`);
    });
  });
});

let wss = null;
const agents = new Map();
const taskQueue = [];
let totalResources = { cpu: 0, ram: 0, gpu: 0 };
let poolConfig = null;

// Handle creating a new compute pool
ipcMain.handle("create-pool", async (event, poolData) => {
  const { port, poolTemplate, taskTemplate, approach, maxParticipants, cpuLimit, ramLimit, gpuLimit } = poolData;

  if (wss) {
    return "❌ A compute pool is already running!";
  }

  wss = new WebSocket.Server({ port });
  bonjour.publish({ name: "Compute Pool", type: "ws", port });

  poolConfig = { cpuLimit, ramLimit, gpuLimit, approach };

  console.log(`🚀 Compute Pool Created | Port: ${port}, Type: ${poolTemplate}, Task: ${taskTemplate}, Approach: ${approach}`);

  wss.on("connection", (ws) => {
    console.log("🔗 New agent connected");

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message);

        if (data.type === "JOIN") {
          const newTotalCPU = totalResources.cpu + data.resources.cpu;
          const newTotalRAM = totalResources.ram + data.resources.ram;
          const newTotalGPU = totalResources.gpu + data.resources.gpu;

          if (newTotalCPU > poolConfig.cpuLimit || newTotalRAM > poolConfig.ramLimit || newTotalGPU > poolConfig.gpuLimit) {
            ws.send(JSON.stringify({ type: "ERROR", message: "❌ Resource limit exceeded!" }));
            ws.close();
            return;
          }

          const agentId = uuidv4();
          ws.agentId = agentId;

          agents.set(agentId, {
            ws,
            resources: data.resources,
            status: "idle",
          });

          totalResources.cpu = newTotalCPU;
          totalResources.ram = newTotalRAM;
          totalResources.gpu = newTotalGPU;

          console.log(`🖥 Agent ${agentId} Joined! Resources:`, data.resources);
          console.log(`📊 Total Pool Resources:`, totalResources);

          if (poolConfig.approach === "dynamic") {
            assignTasks();
          }
        }

        if (data.type === "TASK_COMPLETE") {
          console.log(`✅ Agent ${ws.agentId} completed task: ${data.taskId}`);
          agents.get(ws.agentId).status = "idle";

          if (poolConfig.approach === "dynamic") {
            assignTasks();
          }
        }
      } catch (err) {
        console.error("❌ Error processing message:", err);
      }
    });

    ws.on("error", (err) => {
      console.error(`⚠️ WebSocket error: ${err.message}`);
    });

    ws.on("close", () => {
      const agentId = ws.agentId;
      if (agentId && agents.has(agentId)) {
        const resources = agents.get(agentId).resources;

        totalResources.cpu -= resources.cpu;
        totalResources.ram -= resources.ram;
        totalResources.gpu -= resources.gpu;
        agents.delete(agentId);

        console.log(`🚪 Agent ${agentId} disconnected. Updated Pool Resources:`, totalResources);
      }
    });
  });

  return `✅ Compute Pool created successfully on port ${port}`;
});

// Handle fetching connected agents
ipcMain.handle("get-connected-agents", () => {
  return Array.from(agents.values()).map(agent => ({
    id: agent.ws.agentId,
    cpu: agent.resources.cpu,
    ram: agent.resources.ram,
    gpu: agent.resources.gpu || "N/A",
    status: agent.status,
  }));
});

// Function to assign tasks to idle agents
function assignTasks() {
  for (const [index, task] of taskQueue.entries()) {
    for (const [agentId, agent] of agents.entries()) {
      if (agent.status === "idle" && hasSufficientResources(agent.resources, task.requirements)) {
        agent.status = "busy";
        agent.ws.send(JSON.stringify({ type: "TASK_ASSIGN", taskId: task.taskId, command: task.command }));
        console.log(`📤 Assigned Task ${task.taskId} to Agent ${agentId}`);

        taskQueue.splice(index, 1); // Remove the task from queue after assigning
        break;
      }
    }
  }
}

// Utility function to check if agent has enough resources for a task
function hasSufficientResources(agentResources, taskRequirements) {
  return (
    agentResources.cpu >= taskRequirements.cpu &&
    agentResources.ram >= taskRequirements.ram &&
    agentResources.gpu >= taskRequirements.gpu
  );
}

// Function to manually add a task
ipcMain.handle("add-task", async (event, taskCommand, cpu, ram, gpu) => {
  const taskId = uuidv4();
  taskQueue.push({ taskId, command: taskCommand, requirements: { cpu, ram, gpu } });

  console.log(`📝 New Task Queued: ${taskId}, Command: ${taskCommand}`);
  assignTasks();

  return `✅ Task ${taskId} added!`;
});

// Handle app shutdown
app.on("quit", () => {
  if (wss) {
    wss.close();
    bonjour.unpublishAll();
  }
});
