const WebSocket = require("ws");
const logger = require("./logger");

const WS_PORT = 4002;
const WS_URL = `ws://0.0.0.0:${WS_PORT}`;
const MAX_CLIENTS = 200;

const wss = new WebSocket.Server({ host: "0.0.0.0", port: WS_PORT });
let clients = [];
let shipLocations = {};
let newDataReceived = false;

wss.on("connection", function connection(ws) {
  if (clients.length >= MAX_CLIENTS) {
    logger.warn("Max clients (200) reached, rejecting new connection");
    ws.close(1000, "Maximum clients reached");
    return;
  }

  clients.push(ws);
  console.log(`Client connected. Total clients: ${clients.length}`);

  ws.send(
    JSON.stringify({
      type: "welcome",
      message: `Connected to WebSocket server at ${WS_URL}`,
      clientCount: clients.length,
    })
  );

  ws.on("message", function incoming(data) {
    try {
      const msg = JSON.parse(data);
      if (
        msg.ship_id &&
        Array.isArray(msg.gps_data) &&
        msg.gps_data.length > 0
      ) {
        const validGpsData = msg.gps_data
          .filter((gpsEntry) => gpsEntry.gps)
          .map((gpsEntry) => ({
            gps: gpsEntry.gps,
            latitude: gpsEntry.latitude,
            longitude: gpsEntry.longitude,
            altitude: gpsEntry.altitude ?? null,
            speed: gpsEntry.speed ?? null,
            satellites: gpsEntry.satellites ?? null,
            satellite_prns: Array.isArray(gpsEntry.satellite_prns)
              ? gpsEntry.satellite_prns
              : [],
          }));

        if (validGpsData.length > 0) {
          shipLocations[msg.ship_id] = {
            timestamp: msg.timestamp || new Date().toISOString(),
            ship_id: msg.ship_id,
            device_id: msg.device_id || null,
            heading: msg.heading ?? null,
            gps_data: validGpsData,
          };
          newDataReceived = true;
        } else {
          logger.warn(`No valid GPS entries in message from ${msg.ship_id}`, {
            gpsData: msg.gps_data,
          });
        }
      } else {
        logger.warn("Invalid message structure", { message: msg });
      }
    } catch (error) {
      console.log(`Error parsing message: ${error.message}`, { error });
    }
  });

  ws.on("close", () => {
    clients = clients.filter((client) => client !== ws);
    console.log(`Client disconnected. Total clients: ${clients.length}`);
  });

  ws.on("error", (error) => {
    console.log(`WebSocket error: ${error.message}`, { error });
    clients = clients.filter((client) => client !== ws);
  });
});

function formatLocalTime(timestamp) {
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(date);
}

setInterval(() => {
  let shipsArray = Object.values(shipLocations);
  if (shipsArray.length === 0) {
    console.log("No ship data available, skipping broadcast and log.");
    return;
  }

  const packet = {
    type: "shipsUpdate",
    ships: shipsArray,
    timestamp: formatLocalTime(Date.now()),
  };

  const packetString = JSON.stringify(packet);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(packetString);
    }
  });

  if (newDataReceived) {
    logger.info("Logging ship data", {
      ships: shipsArray,
      timestamp: packet.timestamp,
    });
    newDataReceived = false;
  } else {
    console.log("No new ship data received, skipping log.");
  }
}, 1000);

console.log(`WebSocket server running at ${WS_URL}`);