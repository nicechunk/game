import { readFile } from "node:fs/promises";

// Node does not resolve browser /chunk.js URLs; resolve those exact imports to
// the same checked-out production modules without replacing their behavior.
export async function importHostChunkSync() {
  const url = new URL("../play-chain-chunk-deltas.js", import.meta.url);
  let source = await readFile(url, "utf8");
  source = source.replaceAll('"/chunk.js/play.js"', JSON.stringify(new URL("../../chunk.js/play.js", import.meta.url).href));
  source = source.replaceAll('new URL("./play-chain-pda-worker.js", import.meta.url)', JSON.stringify(new URL("../play-chain-pda-worker.js", import.meta.url).href));
  source = source.replace(/from "(\.\/[^"\n]+)"/g, (_, relative) => `from ${JSON.stringify(new URL(relative, url).href)}`);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}
