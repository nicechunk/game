export const LAND_CONTRACT_ITEM_ID = "blank_land_contract";
export const LAND_CONTRACT_INVENTORY_ID = "market-user-blank-land-contract";
export const REGISTERED_LAND_CONTRACT_ITEM_ID = "registered_land_contract";
export const REGISTERED_LAND_CONTRACT_INVENTORY_PREFIX = "registered-land-contract:";
const LAND_CHUNK_SIZE = 16;

export function normalizeLandContractBalance(snapshot = {}) {
  const status = String(snapshot?.status || "idle");
  const available = normalizeBalance(snapshot?.blankLandContracts);
  const reserved = normalizeBalance(snapshot?.reservedBlankLandContracts);
  const knownEmpty = status === "required";
  const known = knownEmpty || available !== null || reserved !== null;
  const normalizedAvailable = knownEmpty ? 0 : available;
  const normalizedReserved = knownEmpty ? 0 : reserved;
  return Object.freeze({
    known,
    status,
    available: normalizedAvailable,
    reserved: normalizedReserved,
    total: known
      ? Math.max(0, normalizedAvailable ?? 0) + Math.max(0, normalizedReserved ?? 0)
      : 0,
    marketUser: String(snapshot?.marketUser || ""),
  });
}

export function createLandContractInventoryItem(balance = {}) {
  const normalized = normalizeLandContractBalance({
    status: balance.status,
    blankLandContracts: balance.available,
    reservedBlankLandContracts: balance.reserved,
    marketUser: balance.marketUser,
  });
  if (!normalized.known || normalized.total <= 0) return null;
  return Object.freeze({
    id: LAND_CONTRACT_INVENTORY_ID,
    itemId: LAND_CONTRACT_ITEM_ID,
    kind: "contract",
    label: "Blank Land Contract",
    count: normalized.total,
    availableCount: Math.max(0, normalized.available ?? 0),
    reservedCount: Math.max(0, normalized.reserved ?? 0),
    source: "market-user",
    marketUser: normalized.marketUser,
    virtual: true,
    backpackSlotsUsed: 0,
    volumeMm3: 0,
    massGrams: 0,
  });
}

export function createLandContractPortfolio({
  balance = {},
  registeredContracts = [],
  owner = "",
  status = "",
  error = "",
} = {}) {
  const normalizedBalance = normalizeLandContractBalance({
    status: balance.status,
    blankLandContracts: balance.available ?? balance.blankLandContracts,
    reservedBlankLandContracts: balance.reserved ?? balance.reservedBlankLandContracts,
    marketUser: balance.marketUser,
  });
  const registered = (Array.isArray(registeredContracts) ? registeredContracts : [])
    .map(normalizeRegisteredLandContract)
    .filter(Boolean)
    .sort((left, right) => compareFoundationIds(left.foundationId, right.foundationId));
  const blankContract = createLandContractInventoryItem(normalizedBalance);
  const registeredContractUnits = registered.reduce((total, contract) => total + contract.landContractCount, 0);
  const indexingContractUnits = registered.reduce((total, contract) => (
    contract.status === "active" ? total : total + contract.landContractCount
  ), 0);
  const unmatchedReservedContracts = Math.max(
    0,
    Math.max(0, normalizedBalance.reserved ?? 0) - indexingContractUnits,
  );
  const portfolioStatus = String(status || normalizedBalance.status || "idle");
  const items = Object.freeze([
    ...(blankContract ? [blankContract] : []),
    ...registered,
  ]);
  return Object.freeze({
    owner: String(owner || ""),
    status: portfolioStatus,
    error: String(error || ""),
    known: normalizedBalance.known || portfolioStatus === "ready" || registered.length > 0,
    loading: portfolioStatus === "loading" || portfolioStatus === "checking",
    balance: normalizedBalance,
    blankContract,
    registeredContracts: Object.freeze(registered),
    registeredContractUnits,
    totalContractUnits: Math.max(0, normalizedBalance.available ?? 0)
      + registeredContractUnits
      + unmatchedReservedContracts,
    recordCount: items.length,
    items,
  });
}

export function normalizeRegisteredLandContract(input = {}) {
  const foundationId = normalizeFoundationId(input.foundationId);
  const minX = safeInteger(input.minX);
  const minZ = safeInteger(input.minZ);
  const width = positiveSafeInteger(input.width);
  const depth = positiveSafeInteger(input.depth);
  if (!foundationId || minX === null || minZ === null || !width || !depth) return null;
  const maxX = safeInteger(input.maxX) ?? minX + width - 1;
  const maxZ = safeInteger(input.maxZ) ?? minZ + depth - 1;
  if (!Number.isSafeInteger(maxX) || !Number.isSafeInteger(maxZ)) return null;
  const calculatedChunks = Math.ceil(width / LAND_CHUNK_SIZE) * Math.ceil(depth / LAND_CHUNK_SIZE);
  const landContractCount = positiveSafeInteger(input.landContractCount) || calculatedChunks;
  const status = String(input.status || "active");
  return Object.freeze({
    id: `${REGISTERED_LAND_CONTRACT_INVENTORY_PREFIX}${foundationId}`,
    itemId: REGISTERED_LAND_CONTRACT_ITEM_ID,
    kind: "registered_land_contract",
    label: "Registered Land Contract",
    count: 1,
    contractUnits: landContractCount,
    landContractCount,
    owner: String(input.owner || ""),
    foundationId,
    minX,
    minZ,
    maxX,
    maxZ,
    width,
    depth,
    minChunkX: Math.floor(minX / LAND_CHUNK_SIZE),
    minChunkZ: Math.floor(minZ / LAND_CHUNK_SIZE),
    maxChunkX: Math.floor(maxX / LAND_CHUNK_SIZE),
    maxChunkZ: Math.floor(maxZ / LAND_CHUNK_SIZE),
    areaBlocks: width * depth,
    surfaceY: safeInteger(input.surfaceY) ?? 0,
    status,
    registeredChunks: String(input.registeredChunks ?? "0"),
    totalChunks: String(input.totalChunks ?? landContractCount),
    sourcePda: String(input.sourcePda || input.address || ""),
    programId: String(input.programId || ""),
    createdSlot: String(input.createdSlot || "0"),
    updatedSlot: String(input.updatedSlot || "0"),
    source: "build-site",
    virtual: true,
    backpackSlotsUsed: 0,
    volumeMm3: 0,
    massGrams: 0,
    transferableIdentity: foundationId,
  });
}

export function findLandContractPortfolioItem(portfolio, id) {
  const expected = String(id || "");
  return portfolio?.items?.find?.((item) => item.id === expected) ?? null;
}

export function isLandContractItem(item) {
  return item?.itemId === LAND_CONTRACT_ITEM_ID
    || item?.id === LAND_CONTRACT_INVENTORY_ID
    || item?.itemId === REGISTERED_LAND_CONTRACT_ITEM_ID
    || String(item?.id || "").startsWith(REGISTERED_LAND_CONTRACT_INVENTORY_PREFIX);
}

export function createLandContractIconElement({ size = 44, className = "" } = {}) {
  const root = document.createElement("span");
  root.className = ["land-contract-icon", className].filter(Boolean).join(" ");
  root.setAttribute("aria-hidden", "true");
  root.style?.setProperty?.("--land-contract-icon-size", `${Math.max(24, Math.trunc(Number(size) || 44))}px`);

  if (typeof document.createElementNS !== "function") return root;
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("aria-hidden", "true");
  appendPath(svg, "M17 10h31v37H22a7 7 0 0 0-7 7V16a6 6 0 0 1 2-6Z", "land-contract-scroll");
  appendPath(svg, "M22 47h27v7H22a4 4 0 1 1 0-7Z", "land-contract-curl");
  appendPath(svg, "M24 20h17M24 27h17M24 34h8m6 0h3", "land-contract-lines");
  appendPath(svg, "m42 38 5 3-2 6-6-1-1-6 4-2Z", "land-contract-seal");
  root.append(svg);
  return root;
}

function appendPath(svg, data, className) {
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", data);
  path.setAttribute("class", className);
  svg.append(path);
}

function normalizeBalance(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function normalizeFoundationId(value) {
  try {
    const normalized = BigInt(value ?? 0);
    return normalized > 0n && normalized <= 0xffffffffffffffffn ? normalized.toString() : "";
  } catch {
    return "";
  }
}

function compareFoundationIds(left, right) {
  const leftId = BigInt(left ?? 0);
  const rightId = BigInt(right ?? 0);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function safeInteger(value) {
  const number = Math.trunc(Number(value));
  return Number.isSafeInteger(number) ? number : null;
}

function positiveSafeInteger(value) {
  const number = safeInteger(value);
  return number !== null && number > 0 ? number : 0;
}
