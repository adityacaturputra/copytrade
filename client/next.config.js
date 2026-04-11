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
