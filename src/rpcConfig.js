export const publicDevnetRpcUrl = "https://explorer-api.devnet.solana.com";
export const heliusApiKeyStorageKey = "nicechunk.heliusApiKey";
export const rpcOverrideStorageKey = "nicechunk.devnetRpcUrl";
export const rpcConfigChangedEventName = "nicechunk:rpc-config-changed";
export const rpcErrorEventName = "nicechunk:rpc-error";

export function getNicechunkRpcUrl() {
  const override = cleanRpcUrl(localStorage.getItem(rpcOverrideStorageKey));
  if (override) return override;
  const apiKey = cleanApiKey(localStorage.getItem(heliusApiKeyStorageKey));
  if (apiKey) return heliusDevnetRpcUrl(apiKey);
  return publicDevnetRpcUrl;
}

export function getStoredHeliusApiKey() {
  return cleanApiKey(localStorage.getItem(heliusApiKeyStorageKey));
}

export function saveHeliusApiKey(apiKey) {
  const cleaned = cleanApiKey(apiKey);
  if (!cleaned) {
    localStorage.removeItem(heliusApiKeyStorageKey);
  } else {
    localStorage.setItem(heliusApiKeyStorageKey, cleaned);
  }
  localStorage.removeItem(rpcOverrideStorageKey);
  window.dispatchEvent(new CustomEvent(rpcConfigChangedEventName, { detail: { rpcUrl: getNicechunkRpcUrl() } }));
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

function heliusDevnetRpcUrl(apiKey) {
  return `https://devnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`;
}

function cleanApiKey(value) {
  return String(value ?? "").trim();
}

function cleanRpcUrl(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}
