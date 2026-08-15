export const LAND_CONTRACT_ITEM_ID = "blank_land_contract";
export const LAND_CONTRACT_INVENTORY_ID = "market-user-blank-land-contract";

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

export function isLandContractItem(item) {
  return item?.itemId === LAND_CONTRACT_ITEM_ID || item?.id === LAND_CONTRACT_INVENTORY_ID;
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
