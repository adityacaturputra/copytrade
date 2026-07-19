// PM2 ecosystem config for CopyTrade backend.
// Usage:  pm2 start ecosystem.config.js
// pm2 reads .env via `env_file` so all vars (incl. MONGODB_URI with & in it)
// are loaded automatically on start/restart/reboot — no manual `source` needed.

module.exports = {
  apps: [
    {
      name: "copytrade-backend",
      cwd: "/home/ubuntu/copytrade/server",
      // tsconfig rootDir:".." puts the build output under dist/server/src
      script: "/home/ubuntu/copytrade/server/dist/server/src/index.js",
      instances: 1,
      autorestart: true,
      watch: false,
      env_file: "/home/ubuntu/copytrade/.env",
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
