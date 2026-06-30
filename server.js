// server.js
// MizbanYar backend — zero-dependency Node.js server.
// Uses only Node built-ins: node:http, node:sqlite, node:crypto, node:url.

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { init } = require('./db');
const { Router } = require('./lib/micro-router');

const PORT = process.env.PORT || 3001;
const RESEED = process.argv.includes('--reseed');

const db = init({ reseed: RESEED });

const app = new Router();

// mount feature routers
app.use('', require('./routes/properties')(db));
app.use('', require('./routes/bookings')(db));
app.use('', require('./routes/alerts')(db));
app.use('', require('./routes/pricing')(db));
app.use('', require('./routes/dashboard')(db));

// health + bootstrap info (handy for the frontend to discover the demo workspace_id)
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'mizbanyar-backend', time: new Date().toISOString() });
});

app.get('/api/bootstrap', (req, res) => {
  const workspace = db.prepare(`SELECT * FROM workspaces LIMIT 1`).get();
  const user = workspace
    ? db.prepare(`SELECT id, full_name, email, phone FROM users WHERE id = ?`).get(workspace.owner_id)
    : null;
  res.json({ workspace, user });
});

const server = http.createServer((req, res) => {
  app.handle(req, res).catch((err) => {
    console.error('[server] unhandled error:', err);
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'خطای داخلی سرور' }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n🏠 MizbanYar backend running on http://localhost:${PORT}`);
  console.log(`   GET  /api/health`);
  console.log(`   GET  /api/bootstrap            → demo workspace_id + user`);
  console.log(`   GET  /api/properties?workspace_id=...`);
  console.log(`   GET  /api/bookings?workspace_id=...`);
  console.log(`   GET  /api/alerts?workspace_id=...`);
  console.log(`   GET  /api/pricing-recommendations?workspace_id=...`);
  console.log(`   GET  /api/dashboard/summary?workspace_id=...`);
  console.log(`   GET  /api/dashboard/revenue-by-channel?workspace_id=...`);
  console.log(`   GET  /api/dashboard/revenue-by-month?workspace_id=...`);
  console.log(`   GET  /api/dashboard/calendar?workspace_id=...&month=YYYY-MM\n`);
});
