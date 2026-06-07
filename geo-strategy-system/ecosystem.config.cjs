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
        NODE_ENV: "production",
        PORT: "3000",
      },
      // 兼容 ECS 的嵌套目录和本地仓库目录。
      env_file: envFile,
    },
  ],
};
