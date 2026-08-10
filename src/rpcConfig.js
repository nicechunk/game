export const publicDevnetRpcUrl = "https://explorer-api.devnet.solana.com";
export const solanaDevnetGenesisHash = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const heliusApiKeyStorageKey = "nicechunk.heliusApiKey";
export const rpcOverrideStorageKey = "nicechunk.devnetRpcUrl";
export const rpcConfigChangedEventName = "nicechunk:rpc-config-changed";
export const rpcErrorEventName = "nicechunk:rpc-error";

export function getNicechunkRpcUrl() {
  const override = getStoredRpcOverride();
  if (override) return override;
  const apiKey = cleanApiKey(sessionStorage.getItem(heliusApiKeyStorageKey));
  if (apiKey) return heliusDevnetRpcUrl(apiKey);
  return publicDevnetRpcUrl;
}

export function getStoredHeliusApiKey() {
  return cleanApiKey(sessionStorage.getItem(heliusApiKeyStorageKey));
}

export function getStoredRpcOverride() {
  return normalizeHttpsRpcUrl(localStorage.getItem(rpcOverrideStorageKey));
}

export function getRpcConfigMode() {
  if (getStoredRpcOverride()) return "custom";
  if (getStoredHeliusApiKey()) return "helius";
  return "public";
}

export function saveHeliusApiKey(apiKey) {
  const cleaned = cleanApiKey(apiKey);
  if (!cleaned) {
    sessionStorage.removeItem(heliusApiKeyStorageKey);
  } else {
    sessionStorage.setItem(heliusApiKeyStorageKey, cleaned);
  }
  localStorage.removeItem(rpcOverrideStorageKey);
  dispatchRpcConfigChanged();
}

export function saveCustomRpcUrl(rpcUrl) {
  const cleaned = normalizeHttpsRpcUrl(rpcUrl);
  if (!cleaned) throw new TypeError("invalid-https-rpc-url");
  localStorage.setItem(rpcOverrideStorageKey, cleaned);
  sessionStorage.removeItem(heliusApiKeyStorageKey);
  dispatchRpcConfigChanged();
  return cleaned;
}

export function resetRpcConfig() {
  sessionStorage.removeItem(heliusApiKeyStorageKey);
  localStorage.removeItem(rpcOverrideStorageKey);
  dispatchRpcConfigChanged();
}

export function isUsingPublicRpc() {
  return getNicechunkRpcUrl() === publicDevnetRpcUrl;
}

export function isLikelyPublicRpcError(error) {
  const message = `${error?.message ?? ""} ${error?.stack ?? ""}`.toLowerCase();
  return (
    message.includes("429") ||
    message.includes("too many requests") ||
    message.includes("rate limit") ||
    message.includes("rate-limit") ||
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("503") ||
    message.includes("504")
  );
}

export function reportRpcError(error, context = "") {
  if (!isUsingPublicRpc() || !isLikelyPublicRpcError(error)) return;
  window.dispatchEvent(new CustomEvent(rpcErrorEventName, {
    detail: {
      context,
      message: error?.message ? String(error.message) : String(error),
    },
  }));
}

export function createNicechunkRpcFetch(context = "rpc") {
  return async (input, init) => {
    try {
      const response = await fetch(input, init);
      if (isUsingPublicRpc() && [429, 503, 504].includes(response.status)) {
        reportRpcError(new Error(`RPC HTTP ${response.status}`), context);
      }
      return response;
    } catch (error) {
      reportRpcError(error, context);
      throw error;
    }
  };
}

export function heliusDevnetRpcUrl(apiKey) {
  return `https://devnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`;
}

function cleanApiKey(value) {
  return String(value ?? "").trim();
}

export function normalizeHttpsRpcUrl(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function dispatchRpcConfigChanged() {
  globalThis.dispatchEvent?.(new CustomEvent(rpcConfigChangedEventName, {
    detail: {
      mode: getRpcConfigMode(),
      rpcUrl: getNicechunkRpcUrl(),
    },
  }));
}
