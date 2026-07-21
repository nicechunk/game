const LEGACY_CHAIN_SYNC_STORAGE_KEY = "nicechunk.chainSync";
const CHAIN_MODULE_URL_STORAGE_KEY = "nicechunk.chainModuleUrl";
const CHAIN_MODULE_MANIFEST_URLS = Object.freeze([
  "/.vite/manifest.json",
  "/dist/.vite/manifest.json",
]);
const LOCAL_CHAIN_MODULE_URLS = Object.freeze([]);
const PLAY_RUNTIME_VERSION = String(globalThis.document?.documentElement?.dataset?.i18nBuildVersion || "").trim();
const PROD_CHAIN_MODULE_URLS = Object.freeze([
  PLAY_RUNTIME_VERSION
    ? `/assets/nicechunkChain.${encodeURIComponent(PLAY_RUNTIME_VERSION)}.js`
    : "/assets/nicechunkChain.js",
]);
const PROD_BULK_MINING_MODULE_URLS = Object.freeze(PLAY_RUNTIME_VERSION
  ? [`/assets/nicechunkBulkMining.${encodeURIComponent(PLAY_RUNTIME_VERSION)}.js`]
  : []);
const RESOURCE_ID_NONE = 0;

let chainModulePromise = null;
let chainModuleUrl = "";
let resolvedChainModuleUrl = "";
let chainModuleManifestPromise = null;
let bulkMiningModulePromise = null;
let bulkMiningModuleUrl = "";
let resolvedBulkMiningModuleUrl = "";

export function createPlayChainAdapter({
  getWalletAddress = () => "",
  getPlayerPosition = () => [0, 0, 0],
  getBackpackSnapshot = () => null,
  appendEvent = () => {},
} = {}) {
  migrateLegacyChainSyncPreference();
  const state = {
    lastError: "",
    lastSignature: "",
    lastSubmittedAt: 0,
  };

  return {
    isEnabled,
    isReady,
    snapshot,
    submitMine,
    submitPlace,
  };

  function isEnabled() {
    return true;
  }

  function isReady() {
    return Boolean(isEnabled() && getWalletAddress());
  }

  function snapshot() {
    return {
      enabled: isEnabled(),
      ready: isReady(),
      moduleUrl: resolvedChainModuleUrl || configuredFallbackChainModuleUrls()[0] || "",
      bulkMiningModuleUrl: resolvedBulkMiningModuleUrl || PROD_BULK_MINING_MODULE_URLS[0] || "",
      lastError: state.lastError,
      lastSignature: state.lastSignature,
      lastSubmittedAt: state.lastSubmittedAt,
    };
  }

  async function submitMine(pending) {
    if (!pending) return skipped("missing-pending");
    if (!isEnabled()) return skipped("chain-sync-disabled");
    if (!getWalletAddress()) return skipped("wallet-unavailable");
    const block = blockFromPending(pending);
    const backpack = getBackpackSnapshot?.() ?? {};
    const backpackOptions = backpack.backpackAddress
      ? {
          backpackAddress: backpack.backpackAddress,
          backpackItemCount: backpack.itemCount,
          backpackCapacity: backpack.capacity,
          backpackUpdatedSlot: backpack.updatedSlot,
        }
      : {};
    const mineOptions = mineShouldSavePlayerPosition(block)
      ? { ...backpackOptions, playerPosition: playerPositionProof(getPlayerPosition) }
      : backpackOptions;
    const isTreeFell = pending.miningKind === "tree-fell" && Array.isArray(pending.blocks) && pending.blocks.length > 1;
    const isSupportCollapse = pending.miningKind === "support-collapse" && Array.isArray(pending.collapseBlocks) && pending.collapseBlocks.length > 0;
    const isDebugBulkMine = pending.miningKind === "debug-bulk"
      && pending.batchAuthorization === "debug"
      && Array.isArray(pending.blocks)
      && pending.blocks.length > 0;
    if (isDebugBulkMine) {
      const module = await loadPlayBulkMiningModule();
      if (typeof module.recordBulkMineOnChain !== "function") return skipped("record-bulk-mine-unavailable");
      const result = await module.recordBulkMineOnChain(pending.blocks.map(blockFromPending), {
        ...backpackOptions,
        mode: "debug",
      });
      return normalizeChainResult(result);
    }
    const module = await loadPlayChainModule();
    if (isSupportCollapse) {
      if (typeof module.recordSupportCollapseOnChain !== "function") return skipped("record-support-collapse-unavailable");
      const result = await module.recordSupportCollapseOnChain(block, {
        collapseBlocks: pending.collapseBlocks.map(blockFromPending),
        rewardBlocks: (pending.rewardBlocks ?? []).map(blockFromPending),
        expectedRewardCount: Math.max(1, (pending.rewardBlocks?.length ?? 0) + 1),
        toolSlot: pending.toolSlotIndex ?? 0,
        ...mineOptions,
      });
      return normalizeChainResult(result);
    }
    const method = isTreeFell ? "recordTreeFellOnChain" : "recordBlockBreakOnChain";
    if (typeof module[method] !== "function") return skipped(isTreeFell ? "record-tree-fell-unavailable" : "record-mine-unavailable");
    const result = await module[method](block, pending.toolSlotIndex ?? 0, {
      ...mineOptions,
      expectedRewardCount: isTreeFell ? Math.max(1, pending.rewardBlocks?.length ?? 1) : 1,
    });
    return normalizeChainResult(result);
  }

  async function submitPlace(pending) {
    if (!pending) return skipped("missing-pending");
    if (!isEnabled()) return skipped("chain-sync-disabled");
    if (!getWalletAddress()) return skipped("wallet-unavailable");
    const module = await loadPlayChainModule();
    if (typeof module.recordBlockPlacementOnChain !== "function") return skipped("record-placement-unavailable");
    const renderType = module.renderTypeForBlockId?.(pending.blockId) ?? null;
    const result = await module.recordBlockPlacementOnChain(blockFromPending(pending), renderType, pending.hotbarSlotIndex ?? 0);
    return normalizeChainResult(result);
  }

  function normalizeChainResult(result) {
    if (!result?.submitted) {
      const reason = String(result?.reason || "not-submitted");
      state.lastError = reason;
      return { submitted: false, reason, result };
    }
    const signature = String(result.signature || "");
    if (!signature) {
      const reason = "missing-chain-signature";
      state.lastError = reason;
      return { submitted: false, reason, result };
    }
    state.lastError = "";
    state.lastSignature = signature;
    state.lastSubmittedAt = Date.now();
    return { submitted: true, signature, result };
  }

  function skipped(reason) {
    return { submitted: false, reason };
  }
}

export function migrateLegacyChainSyncPreference(storage = globalThis.localStorage) {
  try {
    if (storage?.getItem?.(LEGACY_CHAIN_SYNC_STORAGE_KEY) !== "0") return false;
    storage.removeItem?.(LEGACY_CHAIN_SYNC_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export async function loadPlayChainModule() {
  const urls = await configuredChainModuleUrls();
  const cacheKey = urls.join("|");
  if (chainModulePromise && chainModuleUrl === cacheKey) return chainModulePromise;
  chainModuleUrl = cacheKey;
  chainModulePromise = importFirstChainModule(urls).catch((error) => {
    chainModulePromise = null;
    resolvedChainModuleUrl = "";
    throw error;
  });
  return chainModulePromise;
}

export async function loadPlayBulkMiningModule() {
  const urls = await configuredBulkMiningModuleUrls();
  const cacheKey = urls.join("|");
  if (bulkMiningModulePromise && bulkMiningModuleUrl === cacheKey) return bulkMiningModulePromise;
  bulkMiningModuleUrl = cacheKey;
  bulkMiningModulePromise = importFirstBulkMiningModule(urls).catch((error) => {
    bulkMiningModulePromise = null;
    resolvedBulkMiningModuleUrl = "";
    throw error;
  });
  return bulkMiningModulePromise;
}

export function getResolvedPlayChainModuleUrl() {
  return resolvedChainModuleUrl;
}

export function getResolvedPlayBulkMiningModuleUrl() {
  return resolvedBulkMiningModuleUrl;
}

async function configuredChainModuleUrls() {
  const urls = [];
  pushUrl(urls, globalThis.NICECHUNK_CHAIN_MODULE_URL);
  pushUrl(urls, loadString(CHAIN_MODULE_URL_STORAGE_KEY));
  for (const url of defaultChainModuleUrls()) pushUrl(urls, url);
  if (!PLAY_RUNTIME_VERSION) {
    for (const url of await discoverBuiltChainModuleUrls()) pushUrl(urls, url);
  }
  return urls;
}

async function configuredBulkMiningModuleUrls() {
  const urls = [];
  pushUrl(urls, globalThis.NICECHUNK_BULK_MINING_MODULE_URL);
  for (const url of PROD_BULK_MINING_MODULE_URLS) pushUrl(urls, url);
  for (const url of await configuredChainModuleUrls()) pushUrl(urls, url);
  return urls;
}

function configuredFallbackChainModuleUrls() {
  const urls = [];
  pushUrl(urls, globalThis.NICECHUNK_CHAIN_MODULE_URL);
  pushUrl(urls, loadString(CHAIN_MODULE_URL_STORAGE_KEY));
  for (const url of defaultChainModuleUrls()) pushUrl(urls, url);
  return urls;
}

function defaultChainModuleUrls() {
  const host = String(globalThis.location?.hostname || "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1"
    ? LOCAL_CHAIN_MODULE_URLS
    : PROD_CHAIN_MODULE_URLS;
}

async function importFirstChainModule(urls) {
  const failures = [];
  for (const url of urls) {
    try {
      const module = await import(/* @vite-ignore */ url);
      if (!isUsableChainModule(module)) {
        failures.push(`${url}: missing chain exports`);
        continue;
      }
      resolvedChainModuleUrl = url;
      return module;
    } catch (error) {
      failures.push(`${url}: ${error?.message || String(error)}`);
    }
  }
  throw new Error(`Unable to load NiceChunk chain module. Tried ${failures.join("; ")}`);
}

async function importFirstBulkMiningModule(urls) {
  const failures = [];
  for (const url of urls) {
    try {
      const module = await import(/* @vite-ignore */ url);
      if (typeof module.recordBulkMineOnChain !== "function") {
        failures.push(`${url}: missing bulk mining export`);
        continue;
      }
      resolvedBulkMiningModuleUrl = url;
      return module;
    } catch (error) {
      failures.push(`${url}: ${error?.message || String(error)}`);
    }
  }
  throw new Error(`Unable to load NiceChunk bulk mining module. Tried ${failures.join("; ")}`);
}

function isUsableChainModule(module) {
  return Boolean(module && (
    typeof module.recordBlockBreakOnChain === "function" ||
    typeof module.recordBulkMineOnChain === "function" ||
    typeof module.recordTreeFellOnChain === "function" ||
    typeof module.recordSupportCollapseOnChain === "function" ||
    typeof module.recordBlockPlacementOnChain === "function" ||
    typeof module.getEquippedBackpackStatus === "function" ||
    typeof module.fetchBackpack === "function" ||
    typeof module.fetchPlayerProfileForOwner === "function" ||
    typeof module.fetchPlayerEquipmentForOwner === "function" ||
    typeof module.setPlayerEquipmentSlotsOnChain === "function" ||
    typeof module.fetchPlayerAppearanceForOwner === "function" ||
    typeof module.fetchPlayerProgress === "function" ||
    typeof module.fetchSurfaceDecorationTableOnChain === "function" ||
    typeof module.upsertPlayerProfileName === "function" ||
    typeof module.createPlayerAppearanceOnChain === "function" ||
    typeof module.updatePlayerPositionOnChain === "function" ||
    typeof module.fetchMarketListingsPageOnChain === "function" ||
    typeof module.createMarketListingOnChain === "function"
  ));
}

async function discoverBuiltChainModuleUrls() {
  if (chainModuleManifestPromise) return chainModuleManifestPromise;
  chainModuleManifestPromise = firstManifestUrls(CHAIN_MODULE_MANIFEST_URLS, fetchChainModuleUrlsFromManifest);
  return chainModuleManifestPromise;
}

async function firstManifestUrls(manifestUrls, fetcher) {
  for (const manifestUrl of manifestUrls) {
    try {
      const urls = await fetcher(manifestUrl);
      if (urls.length) return urls;
    } catch {
      // Try the next manifest path. Different routes serve source and dist roots.
    }
  }
  return [];
}

async function fetchChainModuleUrlsFromManifest(manifestUrl) {
  if (typeof fetch !== "function") return [];
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) return [];
  const manifest = await response.json();
  if (!manifest || typeof manifest !== "object") return [];
  const entryUrls = [];
  const fallbackUrls = [];
  const entries = Object.entries(manifest);
  for (const [key, entry] of entries) {
    const kind = nicechunkChainManifestEntryKind(key, entry);
    if (kind === "entry") pushUrl(entryUrls, manifestFileToUrl(entry.file, manifestUrl));
    else if (kind === "chunk") pushUrl(fallbackUrls, manifestFileToUrl(entry.file, manifestUrl));
  }
  return [...entryUrls, ...fallbackUrls];
}

function nicechunkChainManifestEntryKind(key, entry) {
  const source = String(entry?.src || key || "").replaceAll("\\", "/");
  const file = String(entry?.file || "").replaceAll("\\", "/");
  if (source.endsWith("src/chain/nicechunkChain.js")) return "entry";
  if (/assets\/nicechunkChain-[^/]+\.js$/.test(file)) return "chunk";
  return "";
}

function manifestFileToUrl(file, manifestUrl = "") {
  const normalized = String(file || "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized) return "";
  const manifestPath = String(manifestUrl || "").replaceAll("\\", "/");
  const prefix = manifestPath.startsWith("/dist/") ? "/dist/" : "/";
  return `${prefix}${normalized}`;
}

function pushUrl(urls, value) {
  const url = String(value || "").trim();
  if (url && !urls.includes(url)) urls.push(url);
}

function blockFromPending(pending) {
  return {
    x: Math.trunc(pending.worldX),
    y: Math.trunc(pending.worldY),
    z: Math.trunc(pending.worldZ),
    blockId: Math.trunc(pending.blockId),
    resourceId: Math.trunc(pending.resourceId ?? 0),
    key: `${Math.trunc(pending.worldX)},${Math.trunc(pending.worldY)},${Math.trunc(pending.worldZ)}`,
  };
}

function playerPositionProof(getPlayerPosition) {
  const [x, y, z] = getSafePlayerPosition(getPlayerPosition);
  return {
    x: Math.trunc(x),
    y: Math.trunc(y),
    z: Math.trunc(z),
  };
}

export function mineShouldSavePlayerPosition(pendingOrBlock) {
  const resourceId = Math.trunc(Number(pendingOrBlock?.resourceId));
  return Number.isFinite(resourceId) && resourceId > RESOURCE_ID_NONE;
}

function getSafePlayerPosition(getPlayerPosition) {
  try {
    return Array.isArray(getPlayerPosition?.())
      ? getPlayerPosition()
      : [0, 0, 0];
  } catch {
    return [0, 0, 0];
  }
}

function loadString(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}
