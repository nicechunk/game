const DEFAULT_VERIFICATION_TIMEOUT_MS = 12_000;
let verifiedCharacterWallet = "";

export function isCompletePlayerAppearance(appearance, walletAddress) {
  const expectedOwner = String(walletAddress || "").trim();
  return Boolean(
    expectedOwner
    && appearance?.magic === "NCKAPP01"
    && appearance?.initialized === true
    && String(appearance?.owner || "").trim() === expectedOwner
    && String(appearance?.modelCode || "").trim(),
  );
}

export function hasVerifiedPlayCharacterAccess(walletAddress) {
  return Boolean(verifiedCharacterWallet && verifiedCharacterWallet === String(walletAddress || "").trim());
}

export async function verifyPlayCharacterAccess({
  walletAddress,
  fetchAppearance,
  timeoutMs = DEFAULT_VERIFICATION_TIMEOUT_MS,
} = {}) {
  const owner = String(walletAddress || "").trim();
  if (!owner) return { allowed: false, reason: "wallet-required", appearance: null };
  if (typeof fetchAppearance !== "function") {
    return { allowed: false, reason: "verification-unavailable", appearance: null };
  }

  try {
    const appearance = await withTimeout(
      Promise.resolve().then(() => fetchAppearance(owner)),
      timeoutMs,
    );
    if (!isCompletePlayerAppearance(appearance, owner)) {
      return { allowed: false, reason: "character-required", appearance: appearance || null };
    }
    return { allowed: true, reason: "verified", appearance };
  } catch (error) {
    return { allowed: false, reason: "verification-failed", appearance: null, error };
  }
}

export function buildPlayerCreationUrl(locationLike = globalThis.location) {
  const current = new URL(locationLike?.href || "http://localhost/play/");
  const target = new URL("/player_creat/", current.origin);
  const explicitRedirect = safeRedirectTarget(current.searchParams.get("redirect"));
  const currentTarget = `${current.pathname}${current.search}${current.hash}`;
  target.searchParams.set("redirect", explicitRedirect || currentTarget || "/play/");

  const redirectUrl = explicitRedirect ? new URL(explicitRedirect, current.origin) : null;
  for (const key of ["guardian", "guardianRegion"]) {
    const value = current.searchParams.get(key) || redirectUrl?.searchParams.get(key) || "";
    if (value) target.searchParams.set(key, value);
  }
  return target;
}

export async function enforcePlayCharacterAccess({
  walletAddress,
  fetchAppearance,
  locationLike = globalThis.location,
  timeoutMs = DEFAULT_VERIFICATION_TIMEOUT_MS,
} = {}) {
  const result = await verifyPlayCharacterAccess({ walletAddress, fetchAppearance, timeoutMs });
  if (result.allowed) {
    verifiedCharacterWallet = String(walletAddress || "").trim();
  } else {
    if (verifiedCharacterWallet === String(walletAddress || "").trim()) verifiedCharacterWallet = "";
    locationLike?.replace?.(buildPlayerCreationUrl(locationLike));
  }
  return result;
}

function safeRedirectTarget(value) {
  const target = String(value || "").trim();
  return target.startsWith("/") && !target.startsWith("//") ? target : "";
}

function withTimeout(promise, timeoutMs) {
  const delay = Math.max(1, Number(timeoutMs) || DEFAULT_VERIFICATION_TIMEOUT_MS);
  let timer = 0;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = globalThis.setTimeout(() => reject(new Error("character-verification-timeout")), delay);
    }),
  ]).finally(() => globalThis.clearTimeout(timer));
}
