const bonjour = require("bonjour")();
const WebSocket = require("ws");

const PORT = 5001;
const wss = new WebSocket.Server({ port: PORT });

// Advertise the pool via mDNS (so clients can discover it)
bonjour.publish({ name: "Compute Pool", type: "ws", port: PORT });

console.log(`🚀 WebSocket Compute Pool running on port ${PORT}`);

// Track connected agents and resources
const agents = new Map();
let totalResources = { cpu: 0, ram: 0, gpu: 0 };

wss.on("connection", (ws) => {
  console.log("🔗 New agent connected");

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "JOIN") {
        // Store agent's resources
        agents.set(ws, data.resources);
        
        // Update total resources
        totalResources.cpu += data.resources.cpu;
        totalResources.ram += data.resources.ram;
        totalResources.gpu += data.resources.gpu;

        console.log(`🖥 New Agent Joined! Resources:`, data.resources);
        console.log(`📊 Total Pool Resources:`, totalResources);
      }
    } catch (err) {
      console.error("❌ Error processing message:", err);
    }
  });

  ws.on("close", () => {
    const resources = agents.get(ws);
    if (resources) {
      // Remove agent and update resources
      totalResources.cpu -= resources.cpu;
      totalResources.ram -= resources.ram;
      totalResources.gpu -= resources.gpu;
      agents.delete(ws);

      console.log(`🚪 Agent disconnected. Updated Pool Resources:`, totalResources);
    }
  });
});
