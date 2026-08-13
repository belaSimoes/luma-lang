/**
 * A dependency-free static server for the playground.
 *
 * It mirrors the layout published to GitHub Pages exactly: `web/index.html` is
 * served at `/`, and the compiled interpreter is served under `/dist/`.
 *
 *   npm run playground        # builds, then serves on http://localhost:8080
 */

import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB = join(ROOT, "web");
const DIST = join(ROOT, "dist");
const PORT = Number(process.env["PORT"] ?? 8080);

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/** Map a URL path to a file, refusing anything that escapes the served roots. */
function locate(urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const clean = normalize(decoded).replace(/^(\.\.[/\\])+/, "");

  const candidate = clean === "/" || clean === "\\"
    ? join(WEB, "index.html")
    : clean.startsWith("/dist") || clean.startsWith("\\dist")
      ? join(DIST, clean.slice(5))
      : join(WEB, clean);

  const target = resolve(candidate);
  if (!target.startsWith(resolve(WEB)) && !target.startsWith(resolve(DIST))) return null;
  if (!existsSync(target) || !statSync(target).isFile()) return null;
  return target;
}

if (!existsSync(join(DIST, "index.js"))) {
  process.stderr.write(
    "dist/ is missing — run `npm run build` first (or just `npm run playground`).\n",
  );
  process.exit(1);
}

const server = createServer((request, response) => {
  const file = locate(request.url ?? "/");

  if (file === null) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("404 Not Found\n");
    return;
  }

  response.writeHead(200, {
    "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-cache",
  });
  createReadStream(file).pipe(response);
});

server.listen(PORT, () => {
  process.stdout.write(`Luma playground running at http://localhost:${PORT}\n`);
});
