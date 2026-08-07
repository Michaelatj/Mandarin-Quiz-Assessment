// db.js
//
// A tiny file-backed database. There is no external database server -
// everything lives in one JSON file on disk (data/db.json). That keeps
// setup to "npm install, npm start" and makes the whole app easy to
// move around in a zip file.
//
// Trade-off worth knowing: some free hosts (e.g. Render's free web
// service tier) wipe the filesystem on every restart/redeploy, which
// would erase data/db.json. If you deploy somewhere like that, either
// pick a plan/host with a persistent disk, or just run the app on your
// own always-on machine. See README.md for details.

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

function emptyState() {
  return { quizzes: [], attempts: [] };
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    save(emptyState());
  }
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error('data/db.json is corrupted, starting fresh. Backing up the old file.');
    fs.renameSync(DB_PATH, DB_PATH + `.corrupted-${Date.now()}`);
    const fresh = emptyState();
    save(fresh);
    return fresh;
  }
}

function save(state) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

// Basic read-modify-write helper. Fine for a single-teacher personal
// tool with light traffic - not built for high concurrency.
function update(mutator) {
  const state = load();
  const result = mutator(state);
  save(state);
  return result;
}

module.exports = { load, save, update };
