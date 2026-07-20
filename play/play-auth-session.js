export const walletSessionKeys = Object.freeze({
  walletAddress: "nicechunk.walletAddress",
  username: "nicechunk.username",
  walletName: "nicechunk.walletName",
  walletBoundAt: "nicechunk.walletBoundAt",
});

const runtimeCachePrefixes = Object.freeze([
  "nicechunk.session.v1.",
  "nicechunk.equippedBackpack.v1.",
  "nicechunk.sessionFundingLamports.v1.",
  "nicechunk.sessionFundingAcknowledged.v1.",
]);

export function getWalletSession(storage = globalThis.localStorage) {
  return {
    walletAddress: read(storage, walletSessionKeys.walletAddress),
    username: read(storage, walletSessionKeys.username),
    walletName: read(storage, walletSessionKeys.walletName),
    walletBoundAt: read(storage, walletSessionKeys.walletBoundAt),
  };
}

export function hasBoundWallet(session = getWalletSession()) {
  return Boolean(session?.walletAddress && session?.walletBoundAt);
}

export function clearWalletSession(storage = globalThis.localStorage) {
  for (const key of Object.values(walletSessionKeys)) remove(storage, key);
  const keys = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) keys.push(key);
    }
  } catch {
    return;
  }
  for (const key of keys) {
    if (runtimeCachePrefixes.some((prefix) => key.startsWith(prefix))) remove(storage, key);
  }
}

export function buildWalletLoginUrl({ redirectPath = currentRedirectPath(), autoConnect = false } = {}) {
  const loginUrl = new URL("/login/", globalThis.location?.origin || "http://localhost");
  loginUrl.searchParams.set("redirect", safeRedirectTarget(redirectPath) || "/play/");
  if (autoConnect) loginUrl.searchParams.set("autoConnect", "1");
  return loginUrl;
}

export function redirectToWalletLogin(options = {}) {
  globalThis.location?.replace?.(buildWalletLoginUrl(options));
}

function currentRedirectPath() {
  return `${globalThis.location?.pathname || "/play/"}${globalThis.location?.search || ""}${globalThis.location?.hash || ""}`;
}

function safeRedirectTarget(value) {
  if (!value || typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

function read(storage, key) {
  try {
    return storage?.getItem?.(key) || "";
  } catch {
    return "";
  }
}

function remove(storage, key) {
  try {
    storage?.removeItem?.(key);
  } catch {
    // Logout still redirects even when browser storage is unavailable.
  }
}
