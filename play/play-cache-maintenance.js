const ONBOARDING_STATE_PREFIX = "nicechunk.onboarding.v1.";
const CONFIRMATION_WINDOW_MS = 6000;
const RELOAD_DELAY_MS = 520;

export function createPlayCacheMaintenance({
  elements = {},
  clearChunkCache = () => undefined,
  getWalletAddress = () => "guest",
  getOnboardingApi = () => globalThis.NiceChunkOnboarding,
  storage = globalThis.localStorage,
  reload = () => globalThis.location?.reload?.(),
  translate = (_key, fallback) => fallback,
  setTimer = globalThis.setTimeout?.bind(globalThis) ?? setTimeout,
  clearTimer = globalThis.clearTimeout?.bind(globalThis) ?? clearTimeout,
  confirmationWindowMs = CONFIRMATION_WINDOW_MS,
  reloadDelayMs = RELOAD_DELAY_MS,
} = {}) {
  const button = elements.profileClearCacheButton;
  const status = elements.profileClearCacheStatus;
  let bound = false;
  let clearing = false;
  let confirmationTimer = 0;
  let confirmationArmed = false;

  return Object.freeze({
    bind,
    clear: clearCaches,
    resetConfirmation,
  });

  function bind() {
    if (bound || !button) return false;
    bound = true;
    button.addEventListener("click", handleClick);
    globalThis.addEventListener?.("nicechunk:languagechange", resetConfirmation);
    return true;
  }

  async function handleClick() {
    if (clearing) return;
    if (!confirmationArmed) {
      armConfirmation();
      return;
    }
    await clearCaches();
  }

  function armConfirmation() {
    confirmationArmed = true;
    button.dataset.confirming = "true";
    button.textContent = text("main.profile.cacheConfirm", "Confirm clear");
    setStatus(text("main.profile.cacheConfirmHint", "Click again to clear temporary data and reload."), "confirm");
    clearTimer(confirmationTimer);
    confirmationTimer = setTimer(resetConfirmation, Math.max(1000, Number(confirmationWindowMs) || CONFIRMATION_WINDOW_MS));
  }

  function resetConfirmation() {
    if (clearing) return;
    confirmationArmed = false;
    clearTimer(confirmationTimer);
    confirmationTimer = 0;
    if (button) {
      delete button.dataset.confirming;
      button.textContent = text("main.profile.cacheClear", "Clear cache");
    }
    if (status?.dataset.state === "confirm") clearStatus();
  }

  async function clearCaches({ reloadPage = true } = {}) {
    if (clearing) return { ok: false, reason: "cache-clear-in-progress" };
    clearing = true;
    confirmationArmed = false;
    clearTimer(confirmationTimer);
    confirmationTimer = 0;
    if (button) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      delete button.dataset.confirming;
      button.textContent = text("main.profile.cacheClearing", "Clearing...");
    }
    setStatus(text("main.profile.cacheClearing", "Clearing..."), "working");

    try {
      await Promise.resolve(clearChunkCache({ clearRenderDeltas: true, clearPersistent: true }));
      const walletAddress = normalizeWalletAddress(getWalletAddress?.());
      clearWalletOnboardingState({ storage, walletAddress, onboardingApi: getOnboardingApi?.() });
      setStatus(text("main.profile.cacheCleared", "Cache cleared. Reloading..."), "success");
      if (button) button.textContent = text("main.profile.cacheClearedButton", "Cleared");
      globalThis.dispatchEvent?.(new CustomEvent("nicechunk:local-caches-cleared", {
        detail: { walletAddress },
      }));
      if (reloadPage) {
        await delay(Math.max(0, Number(reloadDelayMs) || 0), setTimer);
        reload();
      } else {
        clearing = false;
        if (button) {
          button.disabled = false;
          button.removeAttribute("aria-busy");
        }
      }
      return { ok: true, walletAddress };
    } catch (error) {
      const reason = readableError(error);
      setStatus(text("main.profile.cacheClearFailed", "Cache could not be cleared: {reason}", { reason }), "error");
      if (button) {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.textContent = text("main.profile.cacheClear", "Clear cache");
      }
      clearing = false;
      return { ok: false, reason };
    }
  }

  function setStatus(message, state) {
    if (!status) return;
    status.hidden = false;
    status.dataset.state = state;
    status.textContent = message;
  }

  function clearStatus() {
    if (!status) return;
    status.hidden = true;
    status.textContent = "";
    delete status.dataset.state;
  }

  function text(key, fallback, params = {}) {
    return translate(key, fallback, params) || fallback;
  }
}

export function clearWalletOnboardingState({ storage, walletAddress, onboardingApi } = {}) {
  const normalizedWallet = normalizeWalletAddress(walletAddress);
  storage?.removeItem?.(`${ONBOARDING_STATE_PREFIX}${normalizedWallet}`);
  try {
    const onboardingWallet = normalizeWalletAddress(onboardingApi?.snapshot?.()?.walletAddress);
    if (!onboardingApi?.snapshot || onboardingWallet === normalizedWallet) {
      onboardingApi?.reset?.("", { deferUntilReload: true });
    }
  } catch {
    // Reloading reconstructs guide state from the exact wallet-scoped key removed above.
  }
  return `${ONBOARDING_STATE_PREFIX}${normalizedWallet}`;
}

function normalizeWalletAddress(value) {
  return String(value || "").trim() || "guest";
}

function readableError(error) {
  const message = String(error?.message || error || "unknown error").trim();
  return message.length > 140 ? `${message.slice(0, 137)}...` : message;
}

function delay(milliseconds, setTimer) {
  if (!milliseconds) return Promise.resolve();
  return new Promise((resolve) => setTimer(resolve, milliseconds));
}
