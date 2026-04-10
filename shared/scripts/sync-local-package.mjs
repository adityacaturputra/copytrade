import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sharedRoot = path.resolve(__dirname, "..");

const targets = [
  path.resolve(sharedRoot, "../server/node_modules/@copytrade/shared"),
  path.resolve(sharedRoot, "../client/node_modules/@copytrade/shared"),
];

for (const target of targets) {
  mkdirSync(path.dirname(target), { recursive: true });
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
  }
  mkdirSync(target, { recursive: true });

  cpSync(path.join(sharedRoot, "dist"), path.join(target, "dist"), {
    recursive: true,
  });
  cpSync(path.join(sharedRoot, "package.json"), path.join(target, "package.json"));
}

console.log("Synced @copytrade/shared into client/server node_modules");
