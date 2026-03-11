import fs from "node:fs";
import path from "node:path";
import { resolveDefaultConfigPath } from "./home-paths.js";

const SUMMUN_CONFIG_BASENAME = "config.json";
const SUMMUN_ENV_FILENAME = ".env";

function findConfigFileFromAncestors(startDir: string): string | null {
  const absoluteStartDir = path.resolve(startDir);
  let currentDir = absoluteStartDir;

  while (true) {
    const candidate = path.resolve(currentDir, ".summun", SUMMUN_CONFIG_BASENAME);
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const nextDir = path.resolve(currentDir, "..");
    if (nextDir === currentDir) break;
    currentDir = nextDir;
  }

  return null;
}

// get from root
function findEnvFileFromAncestors(startDir: string): string | null {
  let currentDir = path.resolve(startDir);

  while (true) {
    const candidate = path.resolve(currentDir, SUMMUN_ENV_FILENAME);
    if (fs.existsSync(candidate)) return candidate;

    const nextDir = path.resolve(currentDir, "..");
    if (nextDir === currentDir) return null;
    currentDir = nextDir;
  }
}

export function resolvePaperclipConfigPath(overridePath?: string): string {
  if (overridePath) return path.resolve(overridePath);
  if (process.env.SUMMUN_CONFIG) return path.resolve(process.env.SUMMUN_CONFIG);
  return findConfigFileFromAncestors(process.cwd()) ?? resolveDefaultConfigPath();
}

export function resolvePaperclipEnvPath(overrideConfigPath?: string): string {
  // If an explicit config path is given (or SUMMUN_CONFIG is set), place .env next to the config.
  // Otherwise walk up from cwd to find .env (handles cases where the server process
  // starts from a subdirectory like server/ rather than the project root).
  if (overrideConfigPath || process.env.SUMMUN_CONFIG) {
    return path.resolve(path.dirname(resolvePaperclipConfigPath(overrideConfigPath)), SUMMUN_ENV_FILENAME);
  }
  return findEnvFileFromAncestors(process.cwd()) ?? path.resolve(process.cwd(), SUMMUN_ENV_FILENAME);
}
