const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { MongoClient } = require("mongodb");

const app = express();
app.use(express.json({ limit: "1mb" }));

function loadConfig() {
  const configPath = path.join(__dirname, "config.json");
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

const config = loadConfig();
const corsAllowed = Array.isArray(config.corsAllowedOrigins)
  ? config.corsAllowedOrigins
  : String(process.env.CORS_ALLOWED_ORIGINS || "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean);

if (corsAllowed.length === 0 || corsAllowed.includes("*")) {
  app.use(cors());
} else {
  app.use(
    cors({
      origin: corsAllowed,
      credentials: true
    })
  );
}

const mongoConnectionString =
  process.env.MONGO_CONNECTION_STRING ||
  process.env.MONGO_URI ||
  (config.mongo && config.mongo.connectionString) ||
  "";
const mongoDatabase =
  process.env.MONGO_DATABASE ||
  (config.mongo && config.mongo.database) ||
  "ttoys";

let mongoClient;

async function getMongoDatabase() {
  if (!mongoConnectionString) return null;
  if (!mongoClient) {
    mongoClient = new MongoClient(mongoConnectionString);
    await mongoClient.connect();
  }
  return mongoClient.db(mongoDatabase);
}

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    time: new Date().toISOString()
  });
});

app.get("/api/info", (req, res) => {
  res.json({
    name: "T-Toys API",
    environment: process.env.NODE_ENV || "development"
  });
});

app.post("/app-logs/:appId/log-user-in-app/:pageName", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(204).send();
});

app.get("/api/mongo/health", async (req, res) => {
  if (!mongoConnectionString) {
    res.status(503).json({
      status: "error",
      message: "Mongo is not configured."
    });
    return;
  }

  try {
    const db = await getMongoDatabase();
    if (!db) {
      res.status(503).json({
        status: "error",
        message: "Mongo is not configured."
      });
      return;
    }

    await db.command({ ping: 1 });
    res.json({
      status: "ok",
      database: db.databaseName
    });
  } catch (error) {
    res.status(503).json({
      status: "error",
      message: error && error.message ? error.message : "Mongo health check failed."
    });
  }
});

const frontendPath = path.join(__dirname, "..", "frontend");
const frontendIndex = path.join(frontendPath, "index.html");
const devIndex = path.join(frontendPath, "dev", "index.html");
const hasFrontend = fs.existsSync(frontendIndex);

if (!hasFrontend) {
  app.get("/", (req, res) => {
    res.json({
      name: "T-Toys API",
      status: "ok"
    });
  });
}

if (hasFrontend) {
  app.use(express.static(frontendPath));
  app.use("/frontend", express.static(frontendPath));

  if (fs.existsSync(devIndex)) {
    app.get("/dev", (req, res) => {
      res.sendFile(devIndex);
    });

    app.get("/dev/*", (req, res) => {
      res.sendFile(devIndex);
    });
  }

  app.get("*", (req, res, next) => {
    if (
      req.path.startsWith("/api") ||
      req.path.startsWith("/app-logs") ||
      req.path.startsWith("/health")
    ) {
      next();
      return;
    }

    if (path.extname(req.path)) {
      next();
      return;
    }

    res.sendFile(frontendIndex);
  });
}

const port = Number(process.env.PORT || config.port || 5099);
app.listen(port, () => {
  console.log(`T-Toys API listening on port ${port}`);
});

process.on("SIGINT", async () => {
  if (mongoClient) {
    await mongoClient.close();
  }
  process.exit(0);
});
