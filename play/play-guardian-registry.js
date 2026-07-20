const NICECHUNK_GUARDIAN_PROGRAM_ID = "RQQZKA1fGELBxtxCQ6q7P26GJH4whWmPjH9XqmihVRK";
const GUARDIAN_GOVERNANCE_WALLET = "9XuoVVwqP2jipt3jpJVXCSS2N2jr9vDuV3d6K73FKVud";
const NICECHUNK_CORE_PROGRAM_ID = "9EhMCRYMJej1F21KzaA5Zao3khGGc5aJbDGbnxaogQHu";
const GLOBAL_CONFIG_SEED = "global-config";
const GUARDIAN_REGION_SEED = "guardian-region";
const GUARDIAN_REGION_SIZE_CHUNKS = 100;
const GUARDIAN_REGION_LEN = 288;
const GUARDIAN_STATUS_ACTIVE = 1;
const GUARDIAN_REGION_MAGIC = "NCKGRG01";
const GUARDIAN_PATH = "/ws";
const REGION_CACHE_MS = 5 * 60_000;
const REGION_RETRY_MS = 30_000;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PDA_MARKER = "ProgramDerivedAddress";
const ED25519_P = (1n << 255n) - 19n;
const ED25519_D = mod(-121665n * modInv(121666n, ED25519_P), ED25519_P);

export function createPlayGuardianRegistryResolver({
  getRpcUrl = () => "",
  appendEvent = () => {},
  onRegionsChanged = () => {},
} = {}) {
  const regionCache = new Map();
  const inFlightRegions = new Map();
  let lastRpcUrl = "";
  let lastCenterKey = "";
  let lastRequestAt = 0;
  let lastError = "";

  return {
    getCachedForChunk,
    getCachedRegion,
    getCachedNeighborhoodForChunk,
    ensureNeighborhoodForChunk,
    loadNeighborhoodForChunk,
    ensureRegions,
    refreshRegions,
    resolveForChunk,
    snapshot,
    reset,
  };

  function getCachedForChunk(chunkX, chunkZ) {
    const rpcUrl = currentRpcUrl();
    if (!rpcUrl) return null;
    resetIfRpcChanged(rpcUrl);
    const region = chunkToGuardianRegion(chunkX, chunkZ);
    return getCachedRegion(region.x, region.z);
  }

  function getCachedRegion(regionX, regionZ) {
    const cached = regionCache.get(regionKey(regionX, regionZ));
    if (!cached || cached.status !== "active" || !cached.guardian?.host) return null;
    return {
      ok: true,
      url: guardianEndpoint(cached.guardian),
      buildingsUrl: guardianBuildingsEndpoint(cached.guardian),
      guardian: cached.guardian,
      source: "registry-cache",
      region: { x: Math.trunc(regionX), z: Math.trunc(regionZ) },
    };
  }

  function getCachedNeighborhoodForChunk(chunkX, chunkZ) {
    const center = chunkToGuardianRegion(chunkX, chunkZ);
    return neighborRegions(center.x, center.z).map((region) => getCachedRegion(region.x, region.z) ?? {
      ok: false,
      region,
      status: regionCache.get(regionKey(region.x, region.z))?.status || "unknown",
    });
  }

  function ensureNeighborhoodForChunk(chunkX, chunkZ) {
    const rpcUrl = currentRpcUrl();
    if (!rpcUrl) return false;
    resetIfRpcChanged(rpcUrl);
    const center = chunkToGuardianRegion(chunkX, chunkZ);
    const centerKey = regionKey(center.x, center.z);
    lastCenterKey = centerKey;
    const regions = neighborRegions(center.x, center.z);
    const missing = regions.filter((region) => shouldFetchRegion(region) && !inFlightRegions.has(regionRequestKey(rpcUrl, region)));
    if (!missing.length) return false;
    lastRequestAt = performance.now();
    setTimeout(() => {
      ensureRegions(missing).catch(() => {});
    }, 0);
    return true;
  }

  async function loadNeighborhoodForChunk(chunkX, chunkZ) {
    const rpcUrl = currentRpcUrl();
    if (!rpcUrl) return [];
    resetIfRpcChanged(rpcUrl);
    const center = chunkToGuardianRegion(chunkX, chunkZ);
    lastCenterKey = regionKey(center.x, center.z);
    return ensureRegions(neighborRegions(center.x, center.z));
  }

  async function ensureRegions(regions = [], { force = false } = {}) {
    const rpcUrl = currentRpcUrl();
    if (!rpcUrl) return [];
    resetIfRpcChanged(rpcUrl);
    const unique = uniqueRegions(regions);
    const pending = [];
    const missing = [];
    for (const region of unique) {
      if (!force && !shouldFetchRegion(region)) continue;
      const requestKey = regionRequestKey(rpcUrl, region);
      const existing = inFlightRegions.get(requestKey);
      if (existing) pending.push(existing);
      else missing.push(region);
    }
    if (missing.length) {
      lastRequestAt = performance.now();
      const request = fetchGuardianRegions(rpcUrl, missing)
        .then((entries) => {
          for (const entry of entries) regionCache.set(regionKey(entry.regionX, entry.regionY), entry);
          lastError = "";
          onRegionsChanged(entries);
          return entries;
        })
        .catch((error) => {
          lastError = readableError(error);
          const now = performance.now();
          for (const region of missing) {
            const key = regionKey(region.x, region.z);
            if (!regionCache.has(key)) {
              regionCache.set(key, { status: "error", regionX: region.x, regionY: region.z, loadedAt: now, error: lastError });
            }
          }
          appendEvent(`Guardian region RPC preload failed: ${lastError}`);
          throw error;
        })
        .finally(() => {
          for (const region of missing) inFlightRegions.delete(regionRequestKey(rpcUrl, region));
        });
      for (const region of missing) inFlightRegions.set(regionRequestKey(rpcUrl, region), request);
      pending.push(request);
    }
    if (pending.length) await Promise.all(pending);
    return unique.map((region) => getCachedRegion(region.x, region.z) ?? {
      ok: false,
      region,
      status: regionCache.get(regionKey(region.x, region.z))?.status || "unknown",
    });
  }

  function refreshRegions(regions = []) {
    return ensureRegions(regions, { force: true });
  }

  async function resolveForChunk(chunkX, chunkZ) {
    ensureNeighborhoodForChunk(chunkX, chunkZ);
    const cached = getCachedForChunk(chunkX, chunkZ);
    return cached ?? { ok: false, reason: "guardian-region-cache-miss" };
  }

  function snapshot() {
    return {
      rpcUrl: lastRpcUrl,
      centerRegion: lastCenterKey,
      cachedRegions: regionCache.size,
      regions: cachedRegionSummaries(),
      inFlight: inFlightRegions.size,
      lastRequestAt,
      lastError,
      mode: "nine-region-cache",
    };
  }

  function reset() {
    regionCache.clear();
    inFlightRegions.clear();
    lastCenterKey = "";
    lastRequestAt = 0;
    lastError = "";
  }

  function currentRpcUrl() {
    return String(getRpcUrl?.() || "").trim();
  }

  function resetIfRpcChanged(rpcUrl) {
    if (rpcUrl === lastRpcUrl) return;
    lastRpcUrl = rpcUrl;
    reset();
  }

  function shouldFetchRegion(region) {
    const cached = regionCache.get(regionKey(region.x, region.z));
    if (!cached) return true;
    const age = performance.now() - (cached.loadedAt || 0);
    return age > (cached.status === "error" ? REGION_RETRY_MS : REGION_CACHE_MS);
  }

  function cachedRegionSummaries() {
    return Array.from(regionCache.values()).map((entry) => {
      const guardian = entry.guardian || null;
      return {
        status: String(entry.status || "unknown"),
        regionX: Math.trunc(Number(entry.regionX) || 0),
        regionY: Math.trunc(Number(entry.regionY) || 0),
        loadedAt: Number(entry.loadedAt) || 0,
        error: String(entry.error || ""),
        guardian: guardian ? {
          host: String(guardian.host || ""),
          port: Math.trunc(Number(guardian.port) || 0),
          useTls: Boolean(guardian.useTls),
          minChunkX: Math.trunc(Number(guardian.minChunkX) || 0),
          minChunkY: Math.trunc(Number(guardian.minChunkY) || 0),
          maxChunkX: Math.trunc(Number(guardian.maxChunkX) || 0),
          maxChunkY: Math.trunc(Number(guardian.maxChunkY) || 0),
          blueprintHash: String(guardian.blueprintHash || ""),
          blueprintRevision: String(guardian.blueprintRevision || "0"),
          blueprintRecordCount: Math.trunc(Number(guardian.blueprintRecordCount) || 0),
        } : null,
      };
    });
  }
}

async function fetchGuardianRegions(rpcUrl, regions) {
  const unique = uniqueRegions(regions);
  const entries = [];
  for (let offset = 0; offset < unique.length; offset += 25) {
    entries.push(...await fetchGuardianRegionBatch(rpcUrl, unique.slice(offset, offset + 25)));
  }
  return entries;
}

async function fetchGuardianRegionBatch(rpcUrl, regions) {
  const unique = uniqueRegions(regions);
  const accounts = await deriveGuardianRegionAccounts(unique);
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getMultipleAccounts",
      params: [
        accounts.map((account) => account.publicKey),
        {
          commitment: "confirmed",
          encoding: "base64",
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.error) throw new Error(payload.error?.message || "guardian-region-rpc-error");
  const values = Array.isArray(payload?.result?.value) ? payload.result.value : [];
  const now = performance.now();
  return unique.map((region, index) => {
    const account = accounts[index];
    const item = values[index]
      ? { pubkey: account.publicKey, account: values[index] }
      : null;
    const guardian = item ? decodeGuardianAccount(item) : null;
    if (!guardian || guardian.status !== GUARDIAN_STATUS_ACTIVE || !guardian.host) {
      return { status: "missing", regionX: region.x, regionY: region.z, loadedAt: now, publicKey: account.publicKey };
    }
    return { status: "active", regionX: region.x, regionY: region.z, guardian, loadedAt: now, publicKey: account.publicKey };
  });
}

async function deriveGuardianRegionAccounts(regions) {
  const coreProgram = base58DecodePublicKey(NICECHUNK_CORE_PROGRAM_ID);
  const guardianProgram = base58DecodePublicKey(NICECHUNK_GUARDIAN_PROGRAM_ID);
  const globalConfig = await findProgramAddressBytes([utf8Bytes(GLOBAL_CONFIG_SEED)], coreProgram);
  const accounts = [];
  for (const region of regions) {
    const publicKeyBytes = await findProgramAddressBytes([
      utf8Bytes(GUARDIAN_REGION_SEED),
      globalConfig,
      int32Le(region.x),
      int32Le(region.z),
    ], guardianProgram);
    accounts.push({
      regionX: region.x,
      regionY: region.z,
      publicKey: base58Encode(publicKeyBytes),
    });
  }
  return accounts;
}

function decodeGuardianAccount(item) {
  try {
    if (String(item?.account?.owner || "") !== NICECHUNK_GUARDIAN_PROGRAM_ID) return null;
    const data = item?.account?.data;
    const base64 = Array.isArray(data) ? data[0] : data;
    const bytes = base64ToBytes(base64);
    if (bytes.length !== GUARDIAN_REGION_LEN) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = ascii(bytes, 0, 8);
    if (magic !== GUARDIAN_REGION_MAGIC) return null;
    if (base58Encode(bytes.subarray(36, 68)) !== GUARDIAN_GOVERNANCE_WALLET) return null;
    const hostLen = bytes[132] || 0;
    const host = ascii(bytes, 133, Math.min(64, hostLen));
    const version = view.getUint16(8, true);
    if (version !== 2) return null;
    return {
      publicKey: item?.pubkey || "",
      magic,
      version,
      bump: bytes[10],
      status: bytes[11],
      regionX: view.getInt32(12, true),
      regionY: view.getInt32(16, true),
      minChunkX: view.getInt32(20, true),
      minChunkY: view.getInt32(24, true),
      maxChunkX: view.getInt32(28, true),
      maxChunkY: view.getInt32(32, true),
      host,
      port: view.getUint16(197, true),
      useTls: bytes[199] === 1,
      updatedSlot: view.getUint32(252, true),
      blueprintHash: bytesToHex(bytes, 256, 16),
      blueprintRevision: readU64String(view, 272),
      blueprintRecordCount: view.getUint32(280, true),
      accountLength: bytes.length,
    };
  } catch {
    return null;
  }
}

export function chunkToGuardianRegion(chunkX, chunkZ) {
  return {
    x: Math.floor(Math.trunc(chunkX) / GUARDIAN_REGION_SIZE_CHUNKS),
    z: Math.floor(Math.trunc(chunkZ) / GUARDIAN_REGION_SIZE_CHUNKS),
  };
}

export function neighborRegions(regionX, regionZ) {
  const regions = [];
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      regions.push({ x: regionX + dx, z: regionZ + dz });
    }
  }
  return regions;
}

export function guardianRegionsForFoundation(foundation = {}, chunkSize = 16) {
  const size = Math.max(1, Math.trunc(Number(chunkSize) || 16));
  const minX = Math.trunc(Number(foundation.minX));
  const minZ = Math.trunc(Number(foundation.minZ));
  const width = Math.trunc(Number(foundation.width));
  const depth = Math.trunc(Number(foundation.depth));
  if (![minX, minZ, width, depth].every(Number.isInteger) || width < 1 || depth < 1) return [];
  const maxX = minX + width - 1;
  const maxZ = minZ + depth - 1;
  if (!Number.isSafeInteger(maxX) || !Number.isSafeInteger(maxZ)) return [];
  const minRegionX = Math.floor(Math.floor(minX / size) / GUARDIAN_REGION_SIZE_CHUNKS);
  const maxRegionX = Math.floor(Math.floor(maxX / size) / GUARDIAN_REGION_SIZE_CHUNKS);
  const minRegionZ = Math.floor(Math.floor(minZ / size) / GUARDIAN_REGION_SIZE_CHUNKS);
  const maxRegionZ = Math.floor(Math.floor(maxZ / size) / GUARDIAN_REGION_SIZE_CHUNKS);
  const regions = [];
  for (let z = minRegionZ; z <= maxRegionZ; z += 1) {
    for (let x = minRegionX; x <= maxRegionX; x += 1) regions.push({ x, z });
  }
  return regions;
}

export function guardianBuildingAnnouncementPlan(record, { previousRecord = null, chunkSize = 16 } = {}) {
  const plan = new Map();
  if (previousRecord) {
    const removal = {
      ...previousRecord,
      flags: 0,
      activeRevision: record?.activeRevision ?? previousRecord.activeRevision ?? 0,
      contentHash: record?.contentHash ?? previousRecord.contentHash ?? "",
      updatedSlot: record?.updatedSlot ?? previousRecord.updatedSlot ?? "0",
    };
    for (const region of guardianRegionsForFoundation(previousRecord, chunkSize)) {
      plan.set(regionKey(region.x, region.z), { region, record: removal });
    }
  }
  for (const region of guardianRegionsForFoundation(record, chunkSize)) {
    plan.set(regionKey(region.x, region.z), { region, record });
  }
  return [...plan.values()];
}

export function guardianCoverageForRegions(regions = [], entries = []) {
  const normalizedRegions = uniqueRegions(regions);
  const byRegion = new Map((entries ?? []).map((entry) => [
    regionKey(entry?.region?.x, entry?.region?.z),
    entry,
  ]));
  const normalizedEntries = normalizedRegions.map((region) => byRegion.get(regionKey(region.x, region.z)) ?? {
    ok: false,
    region,
    status: "unknown",
  });
  // `ok` is produced only for an active on-chain GuardianRegion. Blueprint
  // hashes and Guardian server capabilities are separate discovery concerns.
  const missing = normalizedEntries.filter((entry) => entry?.ok !== true);
  return {
    ok: normalizedRegions.length > 0 && missing.length === 0,
    regions: normalizedRegions,
    entries: normalizedEntries,
    missing,
    reason: missing.length ? "guardian-coverage-required" : "",
  };
}

function regionKey(regionX, regionZ) {
  return `${Math.trunc(regionX)},${Math.trunc(regionZ)}`;
}

function regionRequestKey(rpcUrl, region) {
  return `${rpcUrl}|${regionKey(region.x, region.z)}`;
}

function uniqueRegions(regions) {
  return Array.from(new Map((regions ?? []).map((region) => {
    const normalized = { x: Math.trunc(Number(region?.x)), z: Math.trunc(Number(region?.z)) };
    return [regionKey(normalized.x, normalized.z), normalized];
  }).filter((entry) => Number.isInteger(entry[1].x) && Number.isInteger(entry[1].z))).values());
}

function guardianEndpoint(guardian) {
  const scheme = guardian.useTls ? "wss" : "ws";
  const url = new URL(`${scheme}://${guardian.host}:${guardian.port}`);
  if (url.pathname === "/" || !url.pathname) url.pathname = GUARDIAN_PATH;
  return url.toString();
}

function guardianBuildingsEndpoint(guardian) {
  const scheme = guardian.useTls ? "https" : "http";
  const url = new URL(`${scheme}://${guardian.host}:${guardian.port}`);
  url.pathname = "/buildings";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function int32Le(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, Math.trunc(value), true);
  return bytes;
}

function readU64String(view, offset) {
  return ((BigInt(view.getUint32(offset + 4, true)) << 32n) | BigInt(view.getUint32(offset, true))).toString();
}

function bytesToHex(bytes, offset, length) {
  let value = "";
  for (let index = offset; index < offset + length; index += 1) {
    value += bytes[index].toString(16).padStart(2, "0");
  }
  return value;
}

function base58Encode(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const digits = [];
  for (let index = zeros; index < bytes.length; index += 1) {
    let carry = bytes[index];
    for (let digitIndex = 0; digitIndex < digits.length; digitIndex += 1) {
      carry += digits[digitIndex] << 8;
      digits[digitIndex] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  return "1".repeat(zeros) + digits.reverse().map((digit) => BASE58_ALPHABET[digit]).join("");
}

function base58DecodePublicKey(value) {
  const bytes = base58Decode(value);
  if (bytes.length !== 32) throw new Error(`Invalid public key: ${String(value).slice(0, 8)}...`);
  return bytes;
}

function base58Decode(value) {
  const text = String(value || "").trim();
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros += 1;
  const bytes = [];
  for (let index = zeros; index < text.length; index += 1) {
    const digit = BASE58_ALPHABET.indexOf(text[index]);
    if (digit < 0) throw new Error(`Invalid base58 character: ${text[index]}`);
    let carry = digit;
    for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
      carry += bytes[byteIndex] * 58;
      bytes[byteIndex] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const result = new Uint8Array(zeros + bytes.length);
  for (let index = 0; index < zeros; index += 1) result[index] = 0;
  for (let index = 0; index < bytes.length; index += 1) result[result.length - 1 - index] = bytes[index];
  return result;
}

async function findProgramAddressBytes(seeds, programIdBytes) {
  for (let bump = 255; bump >= 0; bump -= 1) {
    const bumpSeed = new Uint8Array([bump]);
    const address = await createProgramAddressBytes([...seeds, bumpSeed], programIdBytes);
    if (address) return address;
  }
  throw new Error("Unable to find PDA");
}

async function createProgramAddressBytes(seeds, programIdBytes) {
  const chunks = [...seeds, programIdBytes, utf8Bytes(PDA_MARKER)];
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const preimage = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    preimage.set(chunk, offset);
    offset += chunk.length;
  }
  const hash = await sha256Bytes(preimage);
  return isEd25519Point(hash) ? null : hash;
}

async function sha256Bytes(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto SHA-256 unavailable for Guardian PDA derivation");
  return new Uint8Array(await subtle.digest("SHA-256", bytes));
}

function utf8Bytes(value) {
  return new TextEncoder().encode(String(value));
}

function isEd25519Point(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) return false;
  const copy = new Uint8Array(bytes);
  const sign = (copy[31] & 0x80) !== 0;
  copy[31] &= 0x7f;
  const y = littleEndianToBigInt(copy);
  if (y >= ED25519_P) return false;
  const y2 = mod(y * y, ED25519_P);
  const numerator = mod(y2 - 1n, ED25519_P);
  const denominator = mod(ED25519_D * y2 + 1n, ED25519_P);
  if (denominator === 0n) return false;
  const x2 = mod(numerator * modInv(denominator, ED25519_P), ED25519_P);
  if (x2 === 0n) return !sign;
  return modPow(x2, (ED25519_P - 1n) / 2n, ED25519_P) === 1n;
}

function littleEndianToBigInt(bytes) {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = (value << 8n) + BigInt(bytes[index]);
  }
  return value;
}

function mod(value, modulo) {
  const result = value % modulo;
  return result >= 0n ? result : result + modulo;
}

function modInv(value, modulo) {
  return modPow(mod(value, modulo), modulo - 2n, modulo);
}

function modPow(base, exponent, modulo) {
  let result = 1n;
  let value = mod(base, modulo);
  let power = exponent;
  while (power > 0n) {
    if (power & 1n) result = mod(result * value, modulo);
    value = mod(value * value, modulo);
    power >>= 1n;
  }
  return result;
}

function base64ToBytes(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function ascii(bytes, offset, length) {
  let text = "";
  for (let index = 0; index < length; index += 1) {
    const code = bytes[offset + index] || 0;
    if (code === 0) break;
    text += String.fromCharCode(code);
  }
  return text;
}

function readableError(error) {
  return String(error?.message || error || "unknown error");
}
