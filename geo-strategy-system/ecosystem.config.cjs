/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("path");

/** PM2 进程配置 — 在 geo-strategy-system 目录内执行: pm2 start ecosystem.config.cjs */
module.exports = {
  apps: [
    {
      name: "geo",
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
      // 环境变量文件放在仓库根（geo-strategy-system 的上一级）
      // 例：/var/www/geo-strategy-system/.env.production
      env_file: path.join(__dirname, "..", ".env.production"),
    },
  ],
};
