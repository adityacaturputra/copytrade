// PM2 ecosystem config for CopyTrade backend.
// Usage:  pm2 start ecosystem.config.js   (after `source .env` in the shell,
//         or via scripts/deploy-vps-backend.sh which sources .env first)
//
// NOTE: we intentionally do NOT use pm2's `env_file` here — on pm2 7.x it does
// not reliably load a dotenv file. Instead the deploy script sources .env into
// the shell environment, and pm2 inherits it on start (do NOT pass --update-env,
// which would restore a stale saved env and drop the sourced vars).
//
// All paths are relative to THIS file's directory (the repo root), so it works
// regardless of where the repo is cloned.

module.exports = {
  apps: [
    {
      name: "copytrade-backend",
      cwd: ".",
      // tsconfig rootDir:".." puts the build output under server/dist/server/src
      script: "server/dist/server/src/index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
