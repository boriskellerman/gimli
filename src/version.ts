import { createRequire } from "node:module";

declare const __GIMLI_VERSION__: string | undefined;

function readVersionFromPackageJson(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

// Single source of truth for the current gimli version.
// - Embedded/bundled builds: injected define or env var.
// - Dev/npm builds: package.json.
export const VERSION =
  (typeof __GIMLI_VERSION__ === "string" && __GIMLI_VERSION__) ||
  process.env.GIMLI_BUNDLED_VERSION ||
  readVersionFromPackageJson() ||
  "0.0.0";
