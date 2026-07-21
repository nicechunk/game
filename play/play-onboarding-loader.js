(() => {
  "use strict";

  if (globalThis.NiceChunkOnboarding) return;

  const script = document.currentScript;
  const scope = document.documentElement.dataset.i18nScope === "forging" ? "forging" : "play";
  const autoFeatureOrder = scope === "forging"
    ? ["forging"]
    : ["equipment", "session", "foundation", "smelting", "market", "basics"];
  const supportedFeatures = scope === "forging"
    ? autoFeatureOrder
    : [...autoFeatureOrder, "mining"];
  const statePrefix = "nicechunk.onboarding.v1.";
  const forceReset = new URLSearchParams(location.search).get("onboarding") === "reset";
  const moduleUrl = script?.dataset.module || new URL("play-onboarding.js", script?.src || location.href).href;
  const styleUrl = script?.dataset.style || new URL("play-onboarding.css", script?.src || location.href).href;
  const dismissed = new Set();
  let walletAddress = readWalletAddress();
  let completed = readCompleted(walletAddress);
  let activeFeature = "";
  let loadPromise = null;
  let checkFrame = 0;
  let basicsReadyAt = 0;
  let observing = false;
  let pendingMiningContext = null;

  if (forceReset) {
    localStorage.removeItem(storageKey(walletAddress));
    completed = new Set();
  }

  const observer = new MutationObserver(scheduleCheck);
  const api = globalThis.NiceChunkOnboarding = Object.freeze({
    version: 1,
    trigger,
    complete,
    reset,
    snapshot: () => ({
      scope,
      walletAddress,
      activeFeature,
      completed: [...completed],
      dismissed: [...dismissed],
      fullModuleLoaded: Boolean(loadPromise),
      observing,
    }),
  });

  updateObservation();
  addEventListener("resize", scheduleCheck, { passive: true });
  addEventListener("nicechunk:wallet-session-changed", handleWalletChange);
  addEventListener("storage", (event) => {
    if (event.key === "nicechunk.walletAddress") handleWalletChange();
  });
  addEventListener("nicechunk:forging-ready", scheduleCheck);
  if (scope === "play") addEventListener("nicechunk:mining-submission-pending", handleMiningPending);
  scheduleCheck();

  function scheduleCheck() {
    if (checkFrame || activeFeature) return;
    checkFrame = requestAnimationFrame(() => {
      checkFrame = 0;
      const feature = autoFeatureOrder.find((candidate) => isEligible(candidate));
      if (feature) void trigger(feature);
    });
  }

  function updateObservation() {
    const shouldObserve = autoFeatureOrder.some((feature) => !completed.has(feature));
    if (shouldObserve && !observing) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["hidden", "aria-hidden", "aria-selected"],
      });
      observing = true;
    } else if (!shouldObserve && observing) {
      observer.disconnect();
      observing = false;
      cancelAnimationFrame(checkFrame);
      checkFrame = 0;
    }
  }

  function isEligible(feature) {
    if (completed.has(feature) || dismissed.has(feature)) return false;
    if (feature === "basics") {
      if (document.getElementById("nc-loader")) {
        basicsReadyAt = 0;
        return false;
      }
      if (!basicsReadyAt) {
        basicsReadyAt = performance.now();
        setTimeout(scheduleCheck, 650);
        return false;
      }
      return performance.now() - basicsReadyAt >= 600 && Boolean(document.getElementById("worldCanvas"));
    }
    if (feature === "equipment") {
      return isShown("#profilePanel") && selected('[data-profile-tab="equipment"]');
    }
    if (feature === "session") return isShown("#sessionFundingPanel");
    if (feature === "foundation") return isShown("#blueprintGuide") && isShown("#foundationEditor");
    if (feature === "smelting") return isShown("#smeltingPanel") && isShown("#backpackPanel");
    if (feature === "market") return isShown("#marketPanel") && selected('[data-market-tab="sell"]');
    if (feature === "forging") {
      const grid = document.getElementById("resourceGrid");
      const canvas = document.getElementById("forgeScene");
      return Boolean(grid?.children.length && canvas && !canvas.hidden);
    }
    return false;
  }

  function isShown(selector) {
    const element = document.querySelector(selector);
    if (!element || element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    return !element.closest("[hidden]");
  }

  function selected(selector) {
    return document.querySelector(selector)?.getAttribute("aria-selected") === "true";
  }

  async function trigger(feature, context = null) {
    if (!supportedFeatures.includes(feature) || completed.has(feature) || activeFeature) return false;
    activeFeature = feature;
    try {
      const runtime = await loadRuntime();
      const result = await runtime.openOnboarding({ feature, scope, walletAddress, context });
      if (result === "complete" || result === "skip") complete(feature);
      else dismissed.add(feature);
      return result;
    } catch (error) {
      dismissed.add(feature);
      console.warn("NiceChunk onboarding could not be opened:", error);
      return false;
    } finally {
      activeFeature = "";
      if (pendingMiningContext && !completed.has("mining") && !dismissed.has("mining")) {
        const queuedContext = pendingMiningContext;
        pendingMiningContext = null;
        queueMicrotask(() => void trigger("mining", queuedContext));
      }
      scheduleCheck();
    }
  }

  function complete(feature) {
    if (!supportedFeatures.includes(feature)) return false;
    completed.add(feature);
    dismissed.delete(feature);
    writeCompleted(walletAddress, completed);
    updateObservation();
    dispatchEvent(new CustomEvent("nicechunk:onboarding-completed", {
      detail: { feature, walletAddress },
    }));
    return true;
  }

  function reset(feature = "") {
    if (feature && supportedFeatures.includes(feature)) {
      completed.delete(feature);
      dismissed.delete(feature);
      writeCompleted(walletAddress, completed);
    } else {
      completed = new Set();
      dismissed.clear();
      localStorage.removeItem(storageKey(walletAddress));
    }
    updateObservation();
    scheduleCheck();
  }

  function handleWalletChange(event) {
    const nextWallet = String(event?.detail?.walletAddress || readWalletAddress()).trim() || "guest";
    if (nextWallet === walletAddress) return;
    walletAddress = nextWallet;
    if (forceReset) localStorage.removeItem(storageKey(walletAddress));
    completed = readCompleted(walletAddress);
    dismissed.clear();
    pendingMiningContext = null;
    basicsReadyAt = 0;
    updateObservation();
    scheduleCheck();
  }

  function handleMiningPending(event) {
    if (completed.has("mining") || dismissed.has("mining")) return;
    if (activeFeature) {
      if (activeFeature !== "mining") pendingMiningContext = event?.detail ?? null;
      return;
    }
    void trigger("mining", event?.detail ?? null);
  }

  function loadRuntime() {
    if (loadPromise) return loadPromise;
    loadPromise = Promise.all([loadStyle(styleUrl), import(/* @vite-ignore */ moduleUrl)])
      .then(([, runtime]) => runtime)
      .catch((error) => {
        loadPromise = null;
        throw error;
      });
    return loadPromise;
  }

  function loadStyle(url) {
    const existing = document.querySelector('link[data-nicechunk-onboarding-style]');
    if (existing?.sheet) return Promise.resolve();
    if (existing) {
      return new Promise((resolve, reject) => {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
      });
    }
    return new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.dataset.nicechunkOnboardingStyle = "";
      link.addEventListener("load", resolve, { once: true });
      link.addEventListener("error", () => reject(new Error("Onboarding stylesheet failed to load.")), { once: true });
      document.head.append(link);
    });
  }

  function readWalletAddress() {
    try {
      return String(localStorage.getItem("nicechunk.walletAddress") || "").trim() || "guest";
    } catch {
      return "guest";
    }
  }

  function storageKey(wallet) {
    return `${statePrefix}${wallet}`;
  }

  function readCompleted(wallet) {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey(wallet)) || "{}");
      return new Set(Array.isArray(parsed.completed) ? parsed.completed.filter((item) => supportedFeatures.includes(item)) : []);
    } catch {
      return new Set();
    }
  }

  function writeCompleted(wallet, values) {
    try {
      localStorage.setItem(storageKey(wallet), JSON.stringify({ completed: [...values], updatedAt: Date.now() }));
    } catch {
      // The guide still works for this page even when persistent storage is unavailable.
    }
  }
})();
