// Suppress deprecation warnings for better compatibility
process.env.NODE_NO_WARNINGS = '1';

const { spawn } = require('child_process');
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

// Auto-check and install missing packages
function ensureDependencies() {
  const required = ['express', 'cors', 'sqlite3'];
  const missing = [];

  for (const pkg of required) {
    try {
      require.resolve(pkg);
    } catch (e) {
      missing.push(pkg);
    }
  }

  if (missing.length === 0) {
    console.log('✅ All dependencies present');
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    console.log(`📦 Installing missing packages: ${missing.join(', ')}`);
    
    const npm = spawn('npm', ['install'], {
      cwd: __dirname,
      stdio: 'inherit',
      shell: true,
      detached: false
    });

    npm.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Dependencies installed successfully');
      } else {
        console.warn('⚠️  npm install returned code', code, '(continuing anyway)');
      }
      resolve();
    });

    npm.on('error', (err) => {
      console.warn('⚠️  Could not install packages:', err.message, '(continuing anyway)');
      resolve();
    });
  });
}

// Start the app after ensuring dependencies
ensureDependencies().then(() => {
  startApp();
});

function startApp() {
  const app = express();
  app.use(express.json());

const PORT = parseInt(process.env.PORT, 10) || 5099;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'ttoys.db');
const CORS_ALLOWED = process.env.CORS_ALLOWED_ORIGINS || '*';

// CORS
const corsOptions = {
  origin: function (origin, callback) {
    if (!CORS_ALLOWED || CORS_ALLOWED === '*') return callback(null, true);
    const allowed = CORS_ALLOWED.split(',').map(s => s.trim());
    if (!origin) return callback(null, true);
    if (allowed.indexOf(origin) !== -1) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET','POST','OPTIONS']
};
app.use(cors(corsOptions));

// Ensure data dir exists
const dataDir = path.dirname(DB_FILE);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Initialize DB
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error('❌ Failed to open DB:', err.message);
    process.exit(1);
  } else {
    console.log('✅ Database initialized:', DB_FILE);
  }
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);`);
  db.run(`CREATE TABLE IF NOT EXISTS app_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id TEXT,
    page_name TEXT,
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/info', (req, res) => {
  res.json({ name: 'T-Toys Backend (Node)', env: process.env.NODE_ENV || 'development' });
});

app.get(['/api/db/health','/api/mongo/health'], (req, res) => {
  db.get('SELECT 1 as ok', [], (err, row) => {
    if (err) return res.status(500).json({ status: 'error', error: err.message });
    res.json({ status: 'ok', database: DB_FILE });
  });
});

app.post('/app-logs/:appId/log-user-in-app/:pageName', (req, res) => {
  const { appId, pageName } = req.params;
  const message = req.body && req.body.message ? String(req.body.message) : null;
  db.run('INSERT INTO app_logs (app_id, page_name, message) VALUES (?,?,?)', [appId, pageName, message], function(err){
    if (err) return res.status(500).json({ status: 'error', error: err.message });
    res.json({ status: 'ok', insertedId: this.lastID });
  });
});

// Serve frontend static files if available
const frontendPath = path.resolve(__dirname, '..', 'frontend');
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
  // SPA fallback
  app.get('*', (req, res, next) => {
    const file = path.join(frontendPath, 'index.html');
    if (fs.existsSync(file)) return res.sendFile(file);
    next();
  });
}

app.options('*', (req, res) => {
  res.sendStatus(204);
});

const server = app.listen(PORT, () => {
  console.log(`🚀 T-Toys backend (node) listening on ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('⏹️  Shutting down...');
  if (db) db.close();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
} // End of startApp function

