/** @type {import('next').NextConfig} */
const nextConfig = {
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