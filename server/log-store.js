const systemLogs = [];

function addSystemLog(level, message) {
  systemLogs.push({
    time: new Date().toISOString(),
    level,
    message: String(message).slice(0, 500)
  });
  if (systemLogs.length > 300) systemLogs.shift();
}

function getSystemLogs() {
  return [...systemLogs];
}

module.exports = { addSystemLog, getSystemLogs };
