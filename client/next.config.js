const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const envCandidates = [
  path.resolve(__dirname, "../.env"),
  path.resolve(__dirname, ".env"),
];
for (const envFile of envCandidates) {
  if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile, override: false });
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@copytrade/shared"],
  serverExternalPackages: [
    "discord.js",
    "@discordjs/ws",
    "@discordjs/voice",
    "mongoose",
    "crypto-js",
  ],
  turbopack: {},
};

module.exports = nextConfig;
