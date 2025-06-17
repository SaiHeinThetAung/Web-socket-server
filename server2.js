const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const winston = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file");
const AdmZip = require("adm-zip");

const WS_PORT = 4002;
const WS_URL = `ws://0.0.0.0:${WS_PORT}`;
const MAX_CLIENTS = 200;
const LOG_DIR = path.join(__dirname, "logs");

// Ensure the logs directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Configure Winston logger
const logger = winston.createLogger({
  level: "debug", // Debug to trace zipping issues
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
    new DailyRotateFile({
      filename: path.join(LOG_DIR, "ships_log-%DATE%.log"),
      datePattern: "YYYY-MM-DD-HH-mm",
      zippedArchive: false, // Disable built-in zipping
      maxSize: "20m",
      maxFiles: "3m", // Keep logs for 3 minutes
      auditFile: path.join(LOG_DIR, ".winston-audit.json"),
      frequency: "3m", // Force 3-minute rotation
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    }),
  ],
});

// Enhanced event handlers with manual zipping
logger.transports.forEach((transport) => {
  if (transport instanceof DailyRotateFile) {
    transport.on("rotate", (oldFilename, newFilename) => {
      console.log(`Log rotated from ${oldFilename} to ${newFilename}`);
      // Manually zip the old log file
      if (fs.existsSync(oldFilename)) {
        try {
          const zip = new AdmZip();
          zip.addLocalFile(oldFilename);
          const zipFile = oldFilename + ".zip";
          zip.writeZip(zipFile);
          console.log(`Zip file created: ${zipFile}`);
          // Delete the original log file after zipping
          fs.unlinkSync(oldFilename);
          console.log(`Original log file deleted: ${oldFilename}`);
        } catch (error) {
          console.log(`Failed to zip ${oldFilename}: ${error.message}`, {
            error,
          });
        }
      } else {
        logger.warn(`Old log file not found for zipping: ${oldFilename}`);
      }
    });
    transport.on("error", (error) => {
      console.log(`Log file error: ${error.message}`, { error });
    });
    transport.on("logRemoved", (removedFilename) => {
      console.log(`Old log file removed: ${removedFilename}`);
    });
  }
});

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
          // logger.info(`Received for ${msg.ship_id}`, {
          //   shipData: shipLocations[msg.ship_id],
          // });
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
    // logger.info(`Client error, removed. Total clients: ${clients.length}`);
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
  }).format(date)
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