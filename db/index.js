// db/index.js
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { seed } = require('./seed');

const DB_PATH = path.join(__dirname, 'mizbanyar.sqlite');

function init({ reseed = false } = {}) {
  const isNew = !fs.existsSync(DB_PATH) || reseed;
  if (reseed && fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

  const db = new DatabaseSync(DB_PATH);
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  if (isNew) {
    console.log('[db] seeding demo data...');
    const ids = seed(db);
    console.log('[db] seeded. workspace_id =', ids.workspaceId);
  }

  return db;
}

module.exports = { init, DB_PATH };
