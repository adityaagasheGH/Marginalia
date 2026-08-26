/**
 * Delete the Next.js build cache.
 *
 * Turbopack's incremental cache in .next can be left in a corrupt state if the
 * dev server is killed mid-write (e.g. a hard taskkill rather than Ctrl+C).
 * The symptom is every route suddenly returning 500 with
 *   ENOENT ... app-paths-manifest.json
 * which cascades into "logout doesn't work", "PDF won't load", and Auth.js
 * throwing "Unexpected token '<'" because it received an HTML error page
 * instead of JSON. Deleting .next fixes all of it.
 *
 *   npm run clean       — just remove the cache
 *   npm run dev:clean   — remove it and start the dev server
 */
import { rmSync } from "node:fs";

for (const dir of [".next", ".next-dev", "node_modules/.cache"]) {
  rmSync(dir, { recursive: true, force: true });
  console.log("removed", dir);
}
