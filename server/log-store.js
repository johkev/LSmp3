const fs = require('node:fs');
const path = require('node:path');

const logFile = path.resolve(process.env.LOG_FILE || path.join(__dirname, '..', 'logs', 'system.log'));
const systemLogs = [];

function loadLogs() {
  try {
    const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const line of lines.slice(-300)) {
      try { systemLogs.push(JSON.parse(line)); } catch { /* Ignore malformed old lines. */ }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('[ERROR] Kunne ikke lese systemlogg', error);
  }
}

function addSystemLog(level, message, source = 'app') {
  const entry = { time: new Date().toISOString(), level, source, message: String(message).slice(0, 500) };
  systemLogs.push(entry);
  if (systemLogs.length > 300) systemLogs.shift();
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (error) {
    console.error('[ERROR] Kunne ikke skrive systemlogg', error.message);
  }
}

function getSystemLogs({ source, limit = 80 } = {}) {
  const filtered = source ? systemLogs.filter((entry) => entry.source === source) : systemLogs;
  return filtered.slice(-limit);
}

loadLogs();

module.exports = { addSystemLog, getSystemLogs };
