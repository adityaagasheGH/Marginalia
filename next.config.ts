import type { NextConfig } from "next";

/**
 * Bundler / cache notes — both of these fixed real, reproducible failures:
 *
 * 1. `npm run dev` uses Turbopack (see package.json). pdfjs-dist 5.x, which
 *    react-pdf wraps, ships native ESM that Next's *webpack dev* build
 *    mangles: evaluating pdf.mjs throws "Object.defineProperty called on
 *    non-object" and the reader page dies. Turbopack handles it correctly.
 *    (`transpilePackages` was tried first and did not fix it.)
 *
 * 2. Dev and production therefore use different bundlers, and they cannot
 *    share a build directory: `next build` (webpack) followed by `next dev`
 *    (Turbopack) leaves the dev server reading webpack artifacts, so every
 *    route 500s with `ENOENT ... app-paths-manifest.json`. That cascades into
 *    symptoms that look unrelated — logout silently failing, the PDF route
 *    returning 500, Auth.js throwing "Unexpected token '<'" because it got an
 *    HTML error page instead of JSON. Separate distDirs make the collision
 *    impossible.
 */
const nextConfig: NextConfig = {
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
};

export default nextConfig;
