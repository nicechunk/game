import { cp, lstat, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startStaticServer } from "./serve-static-site.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(root, "public");
const runtimeRoot = path.join(root, ".play-runtime");
const runtimeAssetsRoot = path.join(runtimeRoot, "dist", "assets");
const previewRoot = path.join(root, ".play-preview");

await requireDirectory(runtimeRoot, "Run `npm run build` before `npm run preview`.");
await requireDirectory(runtimeAssetsRoot, "The packaged chain assets are missing. Run `npm run build` first.");

await rm(previewRoot, { recursive: true, force: true });
await mkdir(previewRoot, { recursive: true });
await cp(publicRoot, previewRoot, { recursive: true });
await cp(runtimeRoot, previewRoot, { recursive: true, force: true });
await cp(runtimeAssetsRoot, path.join(previewRoot, "assets"), { recursive: true, force: true });
await rm(path.join(previewRoot, "dist"), { recursive: true, force: true });

const host = process.env.HOST || "127.0.0.1";
const port = parsePort(process.env.PORT || "4173");
const server = await startPreviewServer({ host, port });
console.log(`NICECHUNK Game preview: ${server.baseUrl}/play/`);

const stop = async () => {
  await server.close();
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

async function requireDirectory(directory, message) {
  const entry = await lstat(directory).catch(() => null);
  if (!entry?.isDirectory() || entry.isSymbolicLink()) throw new Error(message);
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError("PORT must be an integer between 1 and 65535.");
  }
  return port;
}

async function startPreviewServer({ host, port }) {
  try {
    return await startStaticServer({ rootDirectory: previewRoot, host, port });
  } catch (error) {
    if (error?.code === "EADDRINUSE") {
      throw new Error(`Preview port ${port} is already in use. Retry with \`PORT=4175 npm run preview\`.`, {
        cause: error,
      });
    }
    throw error;
  }
}
