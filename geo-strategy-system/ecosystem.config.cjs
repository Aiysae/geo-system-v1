/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");

const parentDir = path.dirname(__dirname);
const envFileCandidates = [
  process.env.GEO_ENV_FILE,
  path.join(parentDir, ".env.production"),
  path.join(__dirname, ".env.production"),
  path.basename(parentDir) === "geo-system-v1"
    ? path.join(parentDir, "..", ".env.production")
    : undefined,
].filter(Boolean);
const envFile = envFileCandidates.find((candidate) => fs.existsSync(candidate)) ?? envFileCandidates[0];

function loadEnvFile(file) {
  if (!file || !fs.existsSync(file)) return {};

  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .reduce((env, rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) return env;

      const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) return env;

      const [, key, rawValue] = match;
      let value = rawValue.trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
      return env;
    }, {});
}

const fileEnv = loadEnvFile(envFile);
const publisherDataDir = fileEnv.LOCAL_PUBLISHER_DATA_DIR || path.join(__dirname, ".data/local-publishing");
const publisherSocket = fileEnv.GEO_LOCAL_PUBLISHING === "1"
  ? fileEnv.LOCAL_PUBLISHER_SOCKET || path.join(publisherDataDir, "publisher.sock")
  : undefined;
const taskQueueBackend = fileEnv.TASK_QUEUE_BACKEND
  || (fileEnv.REDIS_URL ? "bullmq" : "local");


/** PM2 进程配置 — 在 geo-strategy-system 目录内执行: pm2 start ecosystem.config.cjs */
module.exports = {
  apps: [
    ...(publisherSocket ? [{
      name: "geo-publisher",
      cwd: __dirname,
      script: "integrations/local-publisher/daemon.cjs",
      interpreter: fileEnv.LOCAL_PUBLISHER_NODE || process.execPath,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      restart_delay: 3000,
      kill_timeout: 180000,
      env: {
        NODE_ENV: "production",
        LOCAL_PUBLISHER_DATA_DIR: publisherDataDir,
        LOCAL_PUBLISHER_BROWSER: fileEnv.LOCAL_PUBLISHER_BROWSER,
        LOCAL_PUBLISHER_SOCKET: publisherSocket,
      },
    }] : []),
    {
      name: "geo-system",
      cwd: __dirname,
      script: "npm",
      args: "start",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        ...fileEnv,
        NODE_ENV: "production",
        PORT: "3000",
        LOCAL_PUBLISHER_SOCKET: publisherSocket,
        TASK_QUEUE_BACKEND: taskQueueBackend,
      },
    },
    {
      name: "geo-worker",
      cwd: __dirname,
      script: "npm",
      args: "run worker",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "768M",
      kill_timeout: 30000,
      env: {
        ...fileEnv,
        NODE_ENV: "production",
        TASK_QUEUE_BACKEND: taskQueueBackend,
        TASK_WORKER_CONCURRENCY: fileEnv.TASK_WORKER_CONCURRENCY || "4",
        TASK_WORKER_GENERATION_CONCURRENCY: fileEnv.TASK_WORKER_GENERATION_CONCURRENCY || "4",
      },
    },
  ],
};
