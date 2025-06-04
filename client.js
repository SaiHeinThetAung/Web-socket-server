const WebSocket = require("ws");

const WS_URL = "ws://localhost:4001";
const NUM_SHIPS = 3;
const clients = [];

const prns = [
  "5",
  "15",
  "18",
  "23",
  "24",
  "195",
  "196",
  "67",
  "81",
  "82",
  "83",
];

// Ships move at 10 miles per hour
const milesPerHour = 10;
const updatesPerMinute = 30; // 60s / 2s
const milesPerMinute = milesPerHour / 60; // 10 / 60 = 0.1667 miles/min
const milesPerStep = milesPerMinute / updatesPerMinute; // 0.1667 / 30 ≈ 0.00556 miles/step
const kmPerStep = milesPerStep * 1.60934; // Convert to km: ~0.00895 km/step
const degPerStep = kmPerStep / 111; // ~0.0000806 degrees per step

const routes = [
  {
    shipId: "SHIP1",
    start: { lat: 16.8167, lon: 96.1927 }, // Yangon
    end: { lat: 35.6764, lon: 139.6503 }, // Tokyo
    currentStep: 0,
    totalSteps: null,
  },
  {
    shipId: "SHIP2",
    start: { lat: 16.8167, lon: 96.1927 }, // Yangon
    end: { lat: 34.0522, lon: -118.2437 }, // Los Angeles, USA
    currentStep: 0,
    totalSteps: null,
  },
  {
    shipId: "SHIP3",
    start: { lat: 16.8167, lon: 96.1927 }, // Yangon
    end: { lat: 3.139, lon: 101.6869 }, // Kuala Lumpur
    currentStep: 0,
    totalSteps: null,
  },
];

// Haversine formula to calculate km distance between two points
function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371; // Earth radius in km

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Calculate total steps for each ship based on distance and km per step
routes.forEach((route) => {
  const distance = haversineDistance(
    route.start.lat,
    route.start.lon,
    route.end.lat,
    route.end.lon
  );
  route.totalSteps = Math.floor(distance / kmPerStep);
  console.log(
    `${route.shipId} total steps: ${
      route.totalSteps
    } (distance: ${distance.toFixed(2)} km)`
  );
});

function interpolate(start, end, step, total) {
  return start + (end - start) * (step / total);
}

function generateShipData(route, index) {
  let latitude = route.start.lat;
  let longitude = route.start.lon;

  if (route.currentStep <= route.totalSteps) {
    latitude = interpolate(
      route.start.lat,
      route.end.lat,
      route.currentStep,
      route.totalSteps
    );
    longitude = interpolate(
      route.start.lon,
      route.end.lon,
      route.currentStep,
      route.totalSteps
    );
    route.currentStep++;
  }

  const topGps = {
    gps: "top_gps",
    latitude: parseFloat(latitude.toFixed(7)),
    longitude: parseFloat(longitude.toFixed(7)),
    altitude: parseFloat((Math.random() * 10 + 5).toFixed(3)),
    speed: parseFloat((Math.random() * 1).toFixed(2)),
    satellites: Math.floor(Math.random() * 5) + 10,
    satellite_prns: prns.slice(0, Math.floor(Math.random() * 3) + 8),
  };

  const bottomGps = {
    gps: "bottom_gps",
    latitude: parseFloat(
      (latitude + (Math.random() - 0.5) * 0.0005).toFixed(7)
    ),
    longitude: parseFloat(
      (longitude + (Math.random() - 0.5) * 0.0005).toFixed(7)
    ),
    altitude: parseFloat((Math.random() * 10 + 5).toFixed(3)),
    speed: parseFloat((Math.random() * 1).toFixed(2)),
    satellites: Math.floor(Math.random() * 5) + 8,
    satellite_prns: prns.slice(0, Math.floor(Math.random() * 3) + 7),
  };

  return {
    timestamp: new Date().toISOString(),
    ship_id: route.shipId,
    device_id: `DEVICE${index + 1}`,
    heading: parseFloat((Math.random() * 360).toFixed(1)),
    gps_data: [topGps, bottomGps],
  };
}

routes.forEach((route, i) => {
  const ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    console.log(`Client ${i + 1} connected: ${route.shipId}`);
    clients.push(ws);

    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const data = generateShipData(route, i);
        ws.send(JSON.stringify(data));
        console.log(`${route.shipId} sent:`, data);
      }
    }, 2000);
  });

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data);
      console.log(`Received for ${route.shipId}:`, message);
    } catch (err) {
      console.error(`Error parsing for ${route.shipId}:`, err);
    }
  });

  ws.on("close", () => {
    console.log(`Client ${i + 1} (${route.shipId}) disconnected`);
  });

  ws.on("error", (err) => {
    console.error(`Client ${i + 1} (${route.shipId}) error:`, err);
  });
});
