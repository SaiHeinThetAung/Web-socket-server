const fs = require("fs");
const path = require("path");
const winston = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file");
const AdmZip = require("adm-zip");

const LOG_DIR = path.join(__dirname, "logs");

// Ensure the logs directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Configure Winston logger
const logger = winston.createLogger({
  level: "debug",
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
      zippedArchive: false,
      maxSize: "20m",
      maxFiles: "3m",
      auditFile: path.join(LOG_DIR, ".winston-audit.json"),
      frequency: "3m",
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
      if (fs.existsSync(oldFilename)) {
        try {
          const zip = new AdmZip();
          zip.addLocalFile(oldFilename);
          const zipFile = oldFilename + ".zip";
          zip.writeZip(zipFile);
          console.log(`Zip file created: ${zipFile}`);
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

module.exports = logger;