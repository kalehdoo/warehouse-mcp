const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const currentLevel = LEVELS[(process.env.LOG_LEVEL || "info").toLowerCase()] ?? LEVELS.info;

function emit(level, msg, fields) {
  if (LEVELS[level] < currentLevel) return;
  const record = { ts: new Date().toISOString(), level, msg, ...fields };
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  stream.write(JSON.stringify(record) + "\n");
}

export const logger = {
  debug: (msg, fields = {}) => emit("debug", msg, fields),
  info: (msg, fields = {}) => emit("info", msg, fields),
  warn: (msg, fields = {}) => emit("warn", msg, fields),
  error: (msg, fields = {}) => emit("error", msg, fields),
};
