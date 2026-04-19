import fs from "fs";
import path from "path";
import dotenv from "dotenv";

process.env.NODE_ENV = "test";
process.env.TZ = process.env.TZ || "UTC";

const repoRoot = path.resolve(__dirname, "..", "..");
const envCandidates = [
  path.join(repoRoot, ".env.test.local"),
  path.join(repoRoot, ".env.test"),
  path.join(repoRoot, ".env"),
];

for (const envFile of envCandidates) {
  if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile, override: false });
  }
}
