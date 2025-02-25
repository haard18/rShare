const bonjour = require("bonjour")();
const WebSocket = require("ws");

// Sample system specs (Replace this with actual Electron UI detection)
const systemSpecs = {
  cpu: 4, // Number of cores
  ram: 8, // GB of RAM
  gpu: 2, // GB of VRAM
};

// Discover WebSocket pools via mDNS
const serviceBrowser = bonjour.find({ type: "ws" }, (service) => {
  console.log(`✅ Found Compute Pool: ${service.name} at ${service.host}:${service.port}`);

  // Connect to the discovered WebSocket server
  const ws = new WebSocket(`ws://${service.host}:${service.port}`);

  ws.on("open", () => {
    console.log("🔗 Connected to Compute Pool!");

    // Send system specs to the pool
    const joinMessage = JSON.stringify({ type: "JOIN", resources: systemSpecs });
    ws.send(joinMessage);
    console.log("📤 Sent system specs:", systemSpecs);
  });

  ws.on("message", (data) => {
    console.log(`📩 Pool Message: ${data}`);
  });

  ws.on("close", () => {
    console.log("❌ Disconnected from Compute Pool");
  });

  ws.on("error", (err) => {
    console.error("⚠️ WebSocket error:", err.message);
  });
});
