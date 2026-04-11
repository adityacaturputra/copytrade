import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export function loadClientEnv() {
  const scriptFile = fileURLToPath(import.meta.url);
  const scriptDir = path.dirname(scriptFile);
  const clientDir = path.resolve(scriptDir, "..");
  const repoRootDir = path.resolve(clientDir, "..");

  const envCandidates = [
    path.join(repoRootDir, ".env"),
    path.join(clientDir, ".env"),
    path.resolve(process.cwd(), ".env"),
  ];

  const seen = new Set<string>();
  for (const envFile of envCandidates) {
    const resolved = path.resolve(envFile);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);

    if (fs.existsSync(resolved)) {
      dotenv.config({ path: resolved, override: false });
    }
  }
}
