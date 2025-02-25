const bonjour = require("bonjour")();
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid"); // For generating unique agent IDs

const PORT = 5001;
const wss = new WebSocket.Server({ port: PORT });

// Advertise the pool via mDNS for discovery
bonjour.publish({ name: "Compute Pool", type: "ws", port: PORT });

console.log(`🚀 WebSocket Compute Pool running on port ${PORT}`);

const agents = new Map(); // Store agents with their resources
const taskQueue = []; // Queue of pending tasks
let totalResources = { cpu: 0, ram: 0, gpu: 0 };

// Handle incoming connections
wss.on("connection", (ws) => {
  console.log("🔗 New agent connected");

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "JOIN") {
        const agentId = uuidv4(); // Assign unique ID
        ws.agentId = agentId;

        agents.set(agentId, {
          ws,
          resources: data.resources,
          status: "idle",
        });

        // Update total pool resources
        totalResources.cpu += data.resources.cpu;
        totalResources.ram += data.resources.ram;
        totalResources.gpu += data.resources.gpu;

        console.log(`🖥 Agent ${agentId} Joined! Resources:`, data.resources);
        console.log(`📊 Total Pool Resources:`, totalResources);

        // Assign tasks if available
        assignTasks();
      }

      if (data.type === "TASK_COMPLETE") {
        console.log(`✅ Agent ${ws.agentId} completed task: ${data.taskId}`);
        agents.get(ws.agentId).status = "idle";
        assignTasks(); // Assign new tasks if available
      }
    } catch (err) {
      console.error("❌ Error processing message:", err);
    }
  });

  ws.on("close", () => {
    const agentId = ws.agentId;
    if (agentId && agents.has(agentId)) {
      const resources = agents.get(agentId).resources;

      // Remove agent and update resources
      totalResources.cpu -= resources.cpu;
      totalResources.ram -= resources.ram;
      totalResources.gpu -= resources.gpu;
      agents.delete(agentId);

      console.log(`🚪 Agent ${agentId} disconnected. Updated Pool Resources:`, totalResources);
    }
  });
});

// Function to assign tasks to idle agents
function assignTasks() {
  for (const [taskId, task] of taskQueue.entries()) {
    for (const [agentId, agent] of agents.entries()) {
      if (agent.status === "idle" && hasSufficientResources(agent.resources, task.requirements)) {
        agent.status = "busy";
        agent.ws.send(JSON.stringify({ type: "TASK_ASSIGN", taskId, command: task.command }));
        console.log(`📤 Assigned Task ${taskId} to Agent ${agentId}`);

        // Remove task from queue
        taskQueue.splice(taskId, 1);
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

// Function to add a task to the queue
function addTask(command, requirements) {
  const taskId = uuidv4();
  taskQueue.push({ taskId, command, requirements });
  console.log(`📝 New Task Queued: ${taskId}, Command: ${command}`);
  assignTasks(); // Try assigning immediately
}

// Example: Add a sample task after 5 seconds
setTimeout(() => {
  addTask("docker run --cpus=2 -m 4g some-container", { cpu: 2, ram: 4, gpu: 0 });
}, 5000);
