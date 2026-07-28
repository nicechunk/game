import { createReadStream } from "node:fs";
import { lstat, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function startStaticServer({
  rootDirectory = path.join(projectRoot, "dist"),
  host = "127.0.0.1",
  port = 0,
} = {}) {
  const documentRoot = path.resolve(rootDirectory);
  const rootEntry = await lstat(documentRoot).catch(() => null);
  if (!rootEntry?.isDirectory() || rootEntry.isSymbolicLink()) {
    throw new Error(`Static document root is unavailable: ${documentRoot}`);
  }

  const server = http.createServer(async (request, response) => {
    try {
      if (!request.url || !["GET", "HEAD"].includes(request.method || "")) {
        response.writeHead(405, { "content-type": "text/plain; charset=utf-8", allow: "GET, HEAD" });
        response.end("Method not allowed");
        return;
      }
      const url = new URL(request.url, "http://127.0.0.1");
      const file = await resolvePhysicalFile(documentRoot, url.pathname);
      if (!file) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }
      const fileStat = await stat(file);
      response.writeHead(200, {
        "content-type": contentType(file),
        "content-length": fileStat.size,
        "cache-control": cacheControl(file, documentRoot),
        "x-content-type-options": "nosniff",
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      createReadStream(file).pipe(response);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(String(error?.message || error));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Static server did not expose a TCP address.");
  }
  return {
    mode: "physical-static",
    rootDirectory: documentRoot,
    baseUrl: `http://${host}:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

async function resolvePhysicalFile(documentRoot, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const normalized = path.posix.normalize(decoded).replace(/^\/+/, "");
  const candidate = path.resolve(documentRoot, normalized || ".");
  const relative = path.relative(documentRoot, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const candidateEntry = await lstat(candidate).catch(() => null);
  if (candidateEntry?.isSymbolicLink()) return null;
  if (candidateEntry?.isFile()) return candidate;
  if (!candidateEntry?.isDirectory()) return null;
  const indexFile = path.join(candidate, "index.html");
  const indexEntry = await lstat(indexFile).catch(() => null);
  return indexEntry?.isFile() && !indexEntry.isSymbolicLink() ? indexFile : null;
}

function contentType(file) {
  switch (path.extname(file).toLowerCase()) {
    case ".avif": return "image/avif";
    case ".css": return "text/css; charset=utf-8";
    case ".gif": return "image/gif";
    case ".html": return "text/html; charset=utf-8";
    case ".ico": return "image/x-icon";
    case ".jpeg":
    case ".jpg": return "image/jpeg";
    case ".js":
    case ".mjs": return "text/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".ncm": return "application/octet-stream";
    case ".png": return "image/png";
    case ".svg": return "image/svg+xml";
    case ".wasm": return "application/wasm";
    case ".webm": return "video/webm";
    case ".webmanifest": return "application/manifest+json; charset=utf-8";
    case ".webp": return "image/webp";
    case ".woff": return "font/woff";
    case ".woff2": return "font/woff2";
    default: return "application/octet-stream";
  }
}

function cacheControl(file, documentRoot) {
  const relative = toWebPath(path.relative(documentRoot, file));
  if (relative.endsWith(".html") || relative === "static-site.json" || relative === "mainnet.json") {
    return "no-store";
  }
  if (relative.startsWith("assets/media/") || /^assets\/[A-Za-z0-9_]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/u.test(relative)) {
    return "public, max-age=31536000, immutable";
  }
  if (relative.startsWith("assets/")) return "no-cache";
  return "public, max-age=3600";
}

function toWebPath(value) {
  return String(value).split(path.sep).join("/");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseCliArguments(process.argv.slice(2));
  const handle = await startStaticServer(options);
  console.log(`Static site: ${handle.baseUrl}`);
  const stop = async () => {
    await handle.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

function parseCliArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--root") options.rootDirectory = path.resolve(projectRoot, args[++index] || "");
    else if (argument === "--host") options.host = args[++index] || "";
    else if (argument === "--port") options.port = Number(args[++index]);
    else throw new Error(`Unsupported static server argument: ${argument}`);
  }
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)) {
    throw new Error("Static server port is invalid.");
  }
  if (options.host !== undefined && !options.host) throw new Error("Static server host is invalid.");
  return options;
}
