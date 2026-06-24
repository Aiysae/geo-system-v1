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

/** PM2 进程配置 — 在 geo-strategy-system 目录内执行: pm2 start ecosystem.config.cjs */
module.exports = {
  apps: [
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
      },
    },
  ],
};
