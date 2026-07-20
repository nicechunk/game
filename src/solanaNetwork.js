const defaultRequiredCluster = "devnet";

let requiredClusterPromise = null;
let cachedRequiredCluster = defaultRequiredCluster;

export function nicechunkRequiredSolanaClusterSync() {
  return cachedRequiredCluster;
}

export async function getNicechunkRequiredSolanaCluster() {
  if (!requiredClusterPromise) {
    requiredClusterPromise = Promise.resolve(defaultRequiredCluster);
  }
  cachedRequiredCluster = await requiredClusterPromise;
  return requiredClusterPromise;
}

export function solanaClusterLabel(cluster) {
  const normalized = normalizeSolanaCluster(cluster) || defaultRequiredCluster;
  if (normalized === "mainnet-beta") return "Mainnet";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function detectWalletSolanaCluster(provider) {
  const candidates = [
    provider?.network,
    provider?.cluster,
    provider?._network,
    provider?.wallet?.adapter?.network,
    provider?.wallet?.adapter?._network,
    provider?.connection?.rpcEndpoint,
    provider?.connection?._rpcEndpoint,
    provider?._connection?.rpcEndpoint,
    provider?._connection?._rpcEndpoint,
    provider?.solana?.network,
    provider?.solana?.cluster,
  ];

  for (const candidate of candidates) {
    const cluster = normalizeSolanaCluster(candidate);
    if (cluster) return cluster;
  }
  return "";
}

export async function assertNicechunkWalletNetwork(provider, options = {}) {
  const {
    requestSwitch = true,
    onStatus = null,
  } = options;
  const requiredCluster = await getNicechunkRequiredSolanaCluster();
  const detectedCluster = detectWalletSolanaCluster(provider);

  if (detectedCluster === requiredCluster) {
    onStatus?.({ type: "ready", requiredCluster, detectedCluster });
    return { requiredCluster, detectedCluster, switched: false };
  }

  if (!requestSwitch) {
    if (detectedCluster && detectedCluster !== requiredCluster) {
      throw createNetworkError("mismatch", requiredCluster, detectedCluster);
    }
    return { requiredCluster, detectedCluster, switched: false, unknown: true };
  }

  onStatus?.({ type: "switching", requiredCluster, detectedCluster });
  let switchResult = null;
  try {
    switchResult = await requestWalletSolanaClusterSwitch(provider, requiredCluster);
  } catch (error) {
    if (!detectedCluster && !isUserRejectedError(error)) {
      onStatus?.({ type: "ready", requiredCluster, detectedCluster: "" });
      return {
        requiredCluster,
        detectedCluster: "",
        switched: false,
        unknown: true,
        unverified: true,
        switchUnsupported: error?.code === "unsupported",
      };
    }
    const code = error?.code === "unsupported" ? "unsupported" : "switch_failed";
    throw createNetworkError(code, requiredCluster, detectedCluster, error);
  }

  const nextDetectedCluster = detectWalletSolanaCluster(provider);
  if (nextDetectedCluster && nextDetectedCluster !== requiredCluster) {
    throw createNetworkError("mismatch", requiredCluster, nextDetectedCluster);
  }

  onStatus?.({ type: "ready", requiredCluster, detectedCluster: nextDetectedCluster || requiredCluster });
  return {
    requiredCluster,
    detectedCluster: nextDetectedCluster,
    switched: Boolean(switchResult?.switched),
    method: switchResult?.method || "",
  };
}

export async function requestWalletSolanaClusterSwitch(provider, cluster) {
  if (!provider) throw createUnsupportedSwitchError();
  const normalized = normalizeSolanaCluster(cluster) || defaultRequiredCluster;
  const network = normalized === "mainnet-beta" ? "mainnet" : normalized;
  const chainIds = normalized === "mainnet-beta"
    ? ["solana:mainnet", "solana:mainnet-beta"]
    : [`solana:${normalized}`];

  const attempts = [];
  if (typeof provider.request === "function") {
    attempts.push(
      () => provider.request({ method: "wallet_switchSolanaNetwork", params: { network, cluster: normalized, chain: chainIds[0] } }),
      () => provider.request({ method: "wallet_switchSolanaNetwork", params: [{ network, cluster: normalized, chain: chainIds[0] }] }),
      () => provider.request({ method: "wallet_switchNetwork", params: { network, cluster: normalized } }),
      () => provider.request({ method: "wallet_switchNetwork", params: [{ network, cluster: normalized }] }),
      () => provider.request({ method: "solana_switchNetwork", params: { network, cluster: normalized } }),
      ...chainIds.map((chainId) => () => provider.request({ method: "wallet_switchChain", params: [{ chainId }] })),
    );
  }
  if (typeof provider.switchNetwork === "function") {
    attempts.push(
      () => provider.switchNetwork(normalized),
      () => provider.switchNetwork({ network, cluster: normalized, chain: chainIds[0] }),
    );
  }
  if (typeof provider.changeNetwork === "function") {
    attempts.push(
      () => provider.changeNetwork(normalized),
      () => provider.changeNetwork({ network, cluster: normalized, chain: chainIds[0] }),
    );
  }
  if (typeof provider.setNetwork === "function") {
    attempts.push(
      () => provider.setNetwork(normalized),
      () => provider.setNetwork({ network, cluster: normalized, chain: chainIds[0] }),
    );
  }

  if (!attempts.length) throw createUnsupportedSwitchError();

  let lastError = null;
  for (const attempt of attempts) {
    try {
      await attempt();
      return { switched: true, method: "wallet_network_switch" };
    } catch (error) {
      lastError = error;
      if (isUserRejectedError(error)) throw error;
    }
  }

  if (isUnsupportedSwitchError(lastError)) throw createUnsupportedSwitchError(lastError);
  throw lastError || createUnsupportedSwitchError();
}

export function normalizeSolanaCluster(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return "";
  if (text.includes("devnet")) return "devnet";
  if (text.includes("testnet")) return "testnet";
  if (text.includes("mainnet")) return "mainnet-beta";
  return "";
}

function createNetworkError(code, requiredCluster, detectedCluster = "", cause = null) {
  const error = new Error(`NiceChunk requires Solana ${solanaClusterLabel(requiredCluster)}.`);
  error.code = `nicechunk_network_${code}`;
  error.requiredCluster = requiredCluster;
  error.detectedCluster = detectedCluster;
  error.cause = cause;
  return error;
}

function createUnsupportedSwitchError(cause = null) {
  const error = new Error("Wallet does not expose automatic Solana network switching.");
  error.code = "unsupported";
  error.cause = cause;
  return error;
}

function isUnsupportedSwitchError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === -32601 ||
    error?.code === 4200 ||
    error?.code === "unsupported" ||
    message.includes("unsupported") ||
    message.includes("not supported") ||
    message.includes("method not found") ||
    message.includes("unknown method")
  );
}

function isUserRejectedError(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === 4001 || message.includes("reject") || message.includes("denied");
}
