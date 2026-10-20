import { Decompress } from "./vendor/fzstd.js";

// One bounded ordinary frame. Check headers before the decoder allocates its
// window; neither a claimed huge window nor concatenated frames can evade it.
export function decompressChunkAccount(bytes, limit = 18448) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8 || bytes.length > 30000
    || new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) !== 0xfd2fb528) throw new Error("Invalid Zstd frame.");
  const flag = bytes[4], single = flag >> 5 & 1, sizeFlag = flag >> 6, dictFlag = flag & 3;
  if (flag & 24 || dictFlag) throw new Error("Unsupported Zstd frame header.");
  let offset = single ? 5 : 6;
  const sizeBytes = sizeFlag ? 1 << sizeFlag : single;
  if (offset + sizeBytes > bytes.length) throw new Error("Truncated Zstd header.");
  let size = 0;
  for (let index = 0; index < sizeBytes; index++) size += bytes[offset + index] * 2 ** (index * 8);
  if (sizeFlag === 1) size += 256;
  offset += sizeBytes;
  const windowBase = single ? size : 2 ** (10 + (bytes[5] >> 3));
  const windowSize = single ? size : windowBase + windowBase / 8 * (bytes[5] & 7);
  if (size > limit || windowSize > 8 * 1024 * 1024) throw new Error("Zstd output/window exceeds account limit.");
  for (let blocks = 0; ; blocks++) {
    if (blocks > 4096 || offset + 3 > bytes.length) throw new Error("Truncated Zstd block.");
    const header = bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16;
    const last = header & 1, type = header >> 1 & 3, length = header >>> 3;
    if (type === 3 || length > 131072) throw new Error("Invalid Zstd block.");
    offset += 3 + (type === 1 ? 1 : length);
    if (offset > bytes.length) throw new Error("Truncated Zstd data.");
    if (last) break;
  }
  if (flag & 4) offset += 4;
  if (offset !== bytes.length) throw new Error("Trailing or truncated Zstd frame.");
  const output = new Uint8Array(limit); let written = 0;
  const decoder = new Decompress(chunk => {
    if (written + chunk.length > limit) throw new Error("Zstd decoded account exceeds limit.");
    output.set(chunk, written); written += chunk.length;
  });
  decoder.push(bytes, true);
  if (sizeBytes && written !== size) throw new Error("Zstd decoded size mismatch.");
  return output.slice(0, written);
}
