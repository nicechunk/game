import { createPlayChainAdapter } from "./play-chain-adapter.js";
import { createPlayChainEventFeed } from "./play-chain-event-feed.js";
import {
  hydrateChainTransactionFailure,
  logChainSubmissionFailure,
} from "./play-chain-submission-log.js";
import { reconcilePendingMineWithChainResult } from "./play-chain-mining-result.js";
import { t } from "/src/i18n.js";
import { buildWalletLoginUrl, clearWalletSession } from "./play-auth-session.js";

export const RPC_CONFIG_CHANGED_EVENT = "nicechunk:rpc-config-changed";
export const WALLET_SESSION_CHANGED_EVENT = "nicechunk:wallet-session-changed";

const PUBLIC_DEVNET_RPC_URL = "https://explorer-api.devnet.solana.com";
const HELIUS_API_KEY_STORAGE_KEY = "nicechunk.heliusApiKey";
const RPC_OVERRIDE_STORAGE_KEY = "nicechunk.devnetRpcUrl";
const WALLET_STORAGE_KEY = "nicechunk.walletAddress";
const WALLET_NAME_STORAGE_KEY = "nicechunk.walletName";
const WALLET_BOUND_AT_STORAGE_KEY = "nicechunk.walletBoundAt";
const SESSION_FUNDING_PREFIX = "nicechunk.sessionFundingLamports.v1.";
const SESSION_ACK_PREFIX = "nicechunk.sessionFundingAcknowledged.v1.";
const LOCAL_WALLET_MODULE_MANIFEST_URLS = Object.freeze([
  "/.vite/manifest.json",
  "/dist/.vite/manifest.json",
]);
const PLAY_RUNTIME_VERSION = String(globalThis.document?.documentElement?.dataset?.i18nBuildVersion || "").trim();
const PROD_LOCAL_WALLET_MODULE_URLS = Object.freeze(PLAY_RUNTIME_VERSION
  ? [`/assets/localGameWallet.js?v=${encodeURIComponent(PLAY_RUNTIME_VERSION)}`]
  : []);
const LAMPORTS_PER_SOL = 1_000_000_000;
const MINIMUM_SESSION_SOL = 0.1;
const BALANCE_CACHE_TTL_MS = 30_000;
const BALANCE_REFRESH_INTERVAL_MS = 30_000;
const BALANCE_REQUEST_TIMEOUT_MS = 12_000;
let localWalletModulePromise = null;
let localWalletModuleManifestPromise = null;
const walletBalanceCache = new Map();

export function createPlayChainSession({
  elements,
  gameState,
  getPlayerPosition = () => [0, 0, 0],
  getBackpackSnapshot = () => null,
  getPlayerIdentity = () => null,
  openProfilePanel = () => {},
  renderProfile = () => {},
  setStatus = () => {},
  createVoxelItemIconCanvas = null,
  resourceName = (resourceId) => `Resource ${resourceId}`,
  getBackpackTarget = () => null,
  onBackpackRequired = () => {},
} = {}) {
  const state = {
    walletAddress: loadString(WALLET_STORAGE_KEY),
    rpcUrl: getRpcUrl(),
    heliusApiKey: getStoredHeliusApiKey(),
    sessionLamports: 0,
    chainMode: "local-preview",
    lastProof: null,
    chainResults: new Map(),
    walletBalanceLamports: 0,
    walletBalanceStatus: loadString(WALLET_STORAGE_KEY) ? "loading" : "disconnected",
    walletBalanceUpdatedAt: 0,
    walletBalanceRequest: null,
    walletBalanceRequestKey: "",
    walletBalanceRequestSerial: 0,
    balanceRefreshTimer: 0,
  };
  state.sessionLamports = getStoredSessionLamports(state.walletAddress);
  const eventFeed = createPlayChainEventFeed({
    container: elements.chainEventLog,
    createVoxelItemIconCanvas,
    resourceName,
    getBackpackTarget,
  });
  const chainAdapter = createPlayChainAdapter({
    getWalletAddress: () => state.walletAddress,
    getPlayerPosition,
    getBackpackSnapshot,
    appendEvent: appendChainEvent,
  });

  const api = {
    bind,
    render,
    snapshot,
    openRpcPanel,
    closeRpcPanel,
    openWalletPanel,
    closeWalletPanel,
    openSessionPanel,
    closeSessionPanel,
    closeDialogs,
    handlePendingMine,
    handleConfirmedMine,
    handleRollbackMine,
    handlePendingPlace,
    handleConfirmedPlace,
    handleRollbackPlace,
    appendChainEvent,
    disconnectWallet,
  };
  return api;

  function bind() {
    elements.accountHud?.addEventListener("click", () => openProfilePanel());
    elements.rpcButton?.addEventListener("click", openRpcPanel);
    elements.profileRpcAction?.addEventListener("click", openRpcPanel);
    elements.sessionButton?.addEventListener("click", openSessionPanel);
    elements.connectWalletButton?.addEventListener("click", openWalletPanel);
    elements.walletPanelClose?.addEventListener("click", closeWalletPanel);
    elements.walletConnectPlugin?.addEventListener("click", connectPluginWallet);
    elements.walletCreateLocal?.addEventListener("click", createLocalWalletLogin);
    elements.walletContinueLocal?.addEventListener("click", continueLocalWalletLogin);
    elements.walletOpenLogin?.addEventListener("click", openFullWalletLogin);
    elements.walletDisconnect?.addEventListener("click", disconnectWallet);
    elements.profileLogoutButton?.addEventListener("click", disconnectWallet);
    elements.walletCopySecret?.addEventListener("click", copyLocalWalletSecret);
    elements.rpcConfigDismiss?.addEventListener("click", closeRpcPanel);
    elements.rpcConfigForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      saveHeliusApiKey(elements.rpcConfigApiKey?.value || "");
      state.heliusApiKey = getStoredHeliusApiKey();
      state.rpcUrl = getRpcUrl();
      closeRpcPanel();
      render();
      setStatus(state.heliusApiKey ? "RPC saved. Chain reads will use your Helius devnet endpoint." : "RPC reset to public devnet endpoint.");
    });
    elements.sessionFundingCancel?.addEventListener("click", () => closeSessionPanel(false));
    elements.sessionFundingOverlay?.addEventListener("pointerdown", () => closeSessionPanel(false));
    elements.sessionFundingPanel?.addEventListener("pointerdown", (event) => event.stopPropagation());
    elements.sessionFundingForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      const sol = Math.max(MINIMUM_SESSION_SOL, Number(elements.sessionFundingAmount?.value) || MINIMUM_SESSION_SOL);
      state.sessionLamports = Math.trunc(sol * LAMPORTS_PER_SOL);
      saveSessionLamports(state.walletAddress, state.sessionLamports);
      saveSessionAcknowledged(state.walletAddress);
      closeSessionPanel(true);
      render();
      appendChainEvent(`Session funding target set to ${formatSol(state.sessionLamports)} SOL for ${ownerLabel()}.`);
      setStatus(`Session funding target set to ${formatSol(state.sessionLamports)} SOL. It is a top-up target, not a spending cap or authorization limit.`);
    });
    globalThis.addEventListener?.(RPC_CONFIG_CHANGED_EVENT, () => {
      state.heliusApiKey = getStoredHeliusApiKey();
      state.rpcUrl = getRpcUrl();
      render();
      void refreshWalletBalance({ force: true });
    });
    render();
    void refreshWalletBalance({ force: true });
    if (!state.balanceRefreshTimer) {
      state.balanceRefreshTimer = globalThis.setInterval?.(() => {
        if (globalThis.document?.hidden) return;
        void refreshWalletBalance();
      }, BALANCE_REFRESH_INTERVAL_MS) ?? 0;
    }
  }

  async function connectPluginWallet() {
    const provider = detectWalletProvider();
    if (!provider?.connect) {
      setStatus("No Solana wallet provider detected. Open this page in Phantom, Solflare, or Backpack to connect.");
      appendChainEvent("Wallet connect skipped: no browser Solana provider.");
      renderWalletPanel("No browser wallet plugin detected.");
      return null;
    }
    try {
      const result = await provider.connect();
      const publicKey = result?.publicKey ?? provider.publicKey;
      const address = publicKey?.toBase58?.() ?? String(publicKey || "");
      if (!address) throw new Error("Wallet did not return a public key.");
      applyWalletSession(address, walletProviderName(provider));
      setStatus(`Wallet connected: ${shortAddress(address)}.`);
      appendChainEvent(`Wallet connected ${shortAddress(address)}. Mining still uses integer coordinate proof data.`);
      renderWalletPanel(`Plugin wallet connected: ${shortAddress(address)}.`);
      return address;
    } catch (error) {
      setStatus(`Wallet connect failed: ${error?.message || error}.`);
      appendChainEvent(`Wallet connect failed: ${error?.message || error}.`);
      renderWalletPanel(`Plugin wallet failed: ${readableError(error)}.`);
      return null;
    }
  }

  async function createLocalWalletLogin() {
    try {
      const module = await loadLocalWalletModule();
      if (typeof module.createLocalGameWallet !== "function") throw new Error("Local wallet module does not expose createLocalGameWallet.");
      const wallet = module.createLocalGameWallet();
      applyWalletSession(wallet.address, "NiceChunk Game Wallet");
      renderWalletPanel(`Created game wallet ${shortAddress(wallet.address)}. Save the private key before funding it.`, wallet);
      setStatus(`Created NiceChunk game wallet ${shortAddress(wallet.address)}. Fund it before real chain mining.`);
      appendChainEvent(`Created local game wallet ${shortAddress(wallet.address)}. Its private key is stored as unencrypted Base58 text for this browser origin.`);
      return wallet;
    } catch (error) {
      setStatus(`Create game wallet failed: ${readableError(error)}.`);
      appendChainEvent(`Create game wallet failed: ${readableError(error)}.`);
      renderWalletPanel(`Create game wallet failed: ${readableError(error)}.`);
      return null;
    }
  }

  async function continueLocalWalletLogin() {
    try {
      const module = await loadLocalWalletModule();
      const wallet = module.getLocalGameWalletRecord?.({ includeSecret: true });
      if (!wallet?.address) {
        renderWalletPanel("No local game wallet exists in this browser. Create one first.");
        setStatus("No local game wallet exists in this browser.");
        return null;
      }
      applyWalletSession(wallet.address, "NiceChunk Game Wallet");
      renderWalletPanel(`Using game wallet ${shortAddress(wallet.address)}.`, wallet);
      setStatus(`Using NiceChunk game wallet ${shortAddress(wallet.address)}.`);
      appendChainEvent(`Using local game wallet ${shortAddress(wallet.address)} for chain session signing.`);
      return wallet;
    } catch (error) {
      setStatus(`Continue game wallet failed: ${readableError(error)}.`);
      appendChainEvent(`Continue game wallet failed: ${readableError(error)}.`);
      renderWalletPanel(`Continue game wallet failed: ${readableError(error)}.`);
      return null;
    }
  }

  function openFullWalletLogin() {
    const url = new URL("/login/", location.origin);
    url.searchParams.set("redirect", `${location.pathname}${location.search}${location.hash}` || "/play/");
    location.href = url.toString();
  }

  function disconnectWallet() {
    const provider = detectWalletProvider();
    try {
      if (provider?.disconnect) {
        Promise.resolve(provider.disconnect()).catch(() => {
          // The local session is already cleared; plugin disconnect is best effort.
        });
      }
    } catch {
      // Some wallet plugins throw when already disconnected.
    }
    clearWalletSession();
    state.walletAddress = "";
    state.sessionLamports = getStoredSessionLamports("");
    resetWalletBalance();
    dispatchWalletChanged("");
    globalThis.location?.replace?.(buildWalletLoginUrl({
      redirectPath: `${globalThis.location?.pathname || "/play/"}${globalThis.location?.search || ""}${globalThis.location?.hash || ""}`,
      autoConnect: false,
    }));
  }

  function render() {
    const profile = gameState?.playerProfile || {};
    const identity = getPlayerIdentity?.() || {};
    const wallet = state.walletAddress || "";
    const sessionText = state.sessionLamports > 0 ? `Session: ${formatSol(state.sessionLamports)} SOL` : "Session: not funded";
    const rpcText = state.heliusApiKey
      ? ui("main.profile.rpcHelius", "Helius RPC")
      : ui("main.profile.rpcPublic", "Public RPC");
    if (elements.accountName) elements.accountName.textContent = identity.name || profile.name || "Local Miner";
    if (elements.accountLevel) elements.accountLevel.textContent = `Lv. ${levelFromProfile(profile)}`;
    if (elements.accountTitle) elements.accountTitle.textContent = identity.title || chainModeLabel(state.chainMode);
    renderWalletBalance();
    if (elements.accountSessionBalance) elements.accountSessionBalance.textContent = sessionText;
    if (elements.profileRpcValue) elements.profileRpcValue.textContent = rpcText;
    if (elements.profileRpcHint) {
      elements.profileRpcHint.textContent = state.heliusApiKey
        ? ui("main.profile.rpcHintPrivate", "Private RPC is active for chain calls.")
        : ui("main.profile.rpcHintPublic", "Set a Helius key for steadier mining.");
    }
    if (elements.profileRpcAction) {
      elements.profileRpcAction.textContent = state.heliusApiKey
        ? ui("main.profile.rpcUpdate", "Update")
        : ui("main.profile.rpcSet", "Set");
    }
    if (elements.profileLogoutButton) elements.profileLogoutButton.disabled = !wallet;
    if (elements.sessionFundingCurrent) elements.sessionFundingCurrent.textContent = state.sessionLamports > 0
      ? `Current session funding target: ${formatSol(state.sessionLamports)} SOL`
      : "Current session balance: unknown";
    if (elements.rpcConfigApiKey && document.activeElement !== elements.rpcConfigApiKey) {
      elements.rpcConfigApiKey.value = state.heliusApiKey;
    }
    renderProfile?.();
    renderWalletPanel();
  }

  function applyWalletSession(address, walletName = "") {
    const walletAddress = String(address || "").trim();
    if (!walletAddress) return;
    state.walletAddress = walletAddress;
    persistWalletSession(walletAddress, walletName);
    state.sessionLamports = getStoredSessionLamports(walletAddress);
    state.walletBalanceLamports = 0;
    state.walletBalanceStatus = "loading";
    state.walletBalanceUpdatedAt = 0;
    state.walletBalanceRequestSerial += 1;
    state.walletBalanceRequest = null;
    state.walletBalanceRequestKey = "";
    render();
    dispatchWalletChanged(walletAddress);
    void refreshWalletBalance({ force: true });
  }

  function renderWalletBalance() {
    if (!elements.accountBalanceValue) return;
    const status = state.walletAddress ? state.walletBalanceStatus : "disconnected";
    const hasBalance = status === "ready" || status === "stale";
    const label = !state.walletAddress
      ? "0 SOL"
      : hasBalance
        ? `${formatWalletSol(state.walletBalanceLamports)} SOL`
        : status === "loading"
          ? "Loading..."
          : "-- SOL";
    elements.accountBalanceValue.textContent = label;
    if (elements.accountBalance) {
      elements.accountBalance.dataset.state = status;
      elements.accountBalance.title = status === "stale"
        ? "Showing the last confirmed balance while RPC refresh is unavailable."
        : status === "error"
          ? "Unable to load the wallet balance from the configured RPC."
          : "Solana wallet balance";
    }
  }

  async function refreshWalletBalance({ force = false } = {}) {
    const walletAddress = String(state.walletAddress || "").trim();
    const rpcUrl = String(state.rpcUrl || "").trim();
    if (!walletAddress || !rpcUrl) {
      resetWalletBalance();
      renderWalletBalance();
      return { ok: false, reason: "wallet-or-rpc-unavailable" };
    }

    const requestKey = `${rpcUrl}\n${walletAddress}`;
    const now = Date.now();
    const cached = walletBalanceCache.get(requestKey);
    if (!force && cached && now - cached.updatedAt < BALANCE_CACHE_TTL_MS) {
      applyWalletBalance(cached.lamports, cached.updatedAt);
      renderWalletBalance();
      return { ok: true, cached: true, lamports: cached.lamports };
    }
    if (state.walletBalanceRequest && state.walletBalanceRequestKey === requestKey) {
      return state.walletBalanceRequest;
    }

    const hadBalance = state.walletBalanceStatus === "ready" || state.walletBalanceStatus === "stale";
    if (!hadBalance) state.walletBalanceStatus = "loading";
    renderWalletBalance();
    const requestSerial = ++state.walletBalanceRequestSerial;
    const request = fetchWalletBalance(rpcUrl, walletAddress)
      .then((lamports) => {
        if (requestSerial !== state.walletBalanceRequestSerial || walletAddress !== state.walletAddress || rpcUrl !== state.rpcUrl) {
          return { ok: false, reason: "stale-request" };
        }
        const updatedAt = Date.now();
        walletBalanceCache.set(requestKey, { lamports, updatedAt });
        applyWalletBalance(lamports, updatedAt);
        renderWalletBalance();
        return { ok: true, lamports };
      })
      .catch((error) => {
        if (requestSerial === state.walletBalanceRequestSerial) {
          state.walletBalanceStatus = hadBalance ? "stale" : "error";
          renderWalletBalance();
          console.warn("NiceChunk wallet balance refresh failed", error);
        }
        return { ok: false, reason: readableError(error) };
      })
      .finally(() => {
        if (state.walletBalanceRequest === request) {
          state.walletBalanceRequest = null;
          state.walletBalanceRequestKey = "";
        }
      });
    state.walletBalanceRequest = request;
    state.walletBalanceRequestKey = requestKey;
    return request;
  }

  function applyWalletBalance(lamports, updatedAt) {
    state.walletBalanceLamports = Math.max(0, Math.trunc(Number(lamports) || 0));
    state.walletBalanceStatus = "ready";
    state.walletBalanceUpdatedAt = updatedAt;
  }

  function resetWalletBalance() {
    state.walletBalanceRequestSerial += 1;
    state.walletBalanceLamports = 0;
    state.walletBalanceStatus = "disconnected";
    state.walletBalanceUpdatedAt = 0;
    state.walletBalanceRequest = null;
    state.walletBalanceRequestKey = "";
  }

  function renderWalletPanel(message = "", localWallet = null) {
    const wallet = state.walletAddress || loadString(WALLET_STORAGE_KEY);
    const walletName = loadString(WALLET_NAME_STORAGE_KEY) || (wallet ? "Wallet" : "Not connected");
    const localRecord = localWallet || null;
    if (elements.walletCurrent) {
      elements.walletCurrent.textContent = wallet
        ? `${walletName}: ${shortAddress(wallet)}`
        : "No wallet connected";
    }
    if (elements.walletAddressValue) elements.walletAddressValue.value = wallet || "";
    if (elements.walletSecretRow) elements.walletSecretRow.hidden = !localRecord?.secretKey;
    if (elements.walletSecretValue) elements.walletSecretValue.value = localRecord?.secretKey || "";
    if (elements.walletStatus) {
      elements.walletStatus.textContent = message || (wallet
        ? "Wallet session is ready. Chain mining will submit integer coordinate proofs when RPC is available."
        : "Choose a plugin wallet or create a local NiceChunk game wallet.");
    }
    if (elements.walletDisconnect) elements.walletDisconnect.disabled = !wallet;
  }

  async function copyLocalWalletSecret() {
    const secret = String(elements.walletSecretValue?.value || "");
    if (!secret) {
      renderWalletPanel("No local wallet private key is visible.");
      return;
    }
    try {
      await navigator.clipboard?.writeText(secret);
      renderWalletPanel("Private key copied. Keep it offline and do not share it.");
      setStatus("Local game wallet private key copied.");
    } catch {
      renderWalletPanel("Clipboard unavailable. Select the private key field manually.");
    }
  }

  function snapshot() {
    return {
      walletAddress: state.walletAddress,
      walletName: loadString(WALLET_NAME_STORAGE_KEY),
      walletShort: state.walletAddress ? shortAddress(state.walletAddress) : "Not connected",
      rpcLabel: state.heliusApiKey ? "Helius RPC" : "Public RPC",
      rpcUrl: state.rpcUrl,
      sessionLamports: state.sessionLamports,
      sessionSol: state.sessionLamports / LAMPORTS_PER_SOL,
      sessionLabel: state.sessionLamports > 0 ? `${formatSol(state.sessionLamports)} SOL` : "not funded",
      walletBalanceLamports: state.walletBalanceLamports,
      walletBalanceSol: state.walletBalanceLamports / LAMPORTS_PER_SOL,
      walletBalanceStatus: state.walletBalanceStatus,
      walletBalanceUpdatedAt: state.walletBalanceUpdatedAt,
      chainMode: state.chainMode,
      lastProof: state.lastProof,
      adapter: chainAdapter.snapshot(),
    };
  }

  function openRpcPanel() {
    if (elements.rpcConfigPanel) elements.rpcConfigPanel.hidden = false;
    if (elements.rpcConfigApiKey) {
      elements.rpcConfigApiKey.value = state.heliusApiKey;
      requestAnimationFrame(() => elements.rpcConfigApiKey?.focus?.());
    }
  }

  function openWalletPanel() {
    renderWalletPanel();
    if (elements.walletPanel) {
      elements.walletPanel.hidden = false;
      elements.walletPanel.setAttribute("aria-hidden", "false");
    }
  }

  function closeWalletPanel() {
    if (elements.walletPanel) {
      elements.walletPanel.hidden = true;
      elements.walletPanel.setAttribute("aria-hidden", "true");
    }
  }

  function closeRpcPanel() {
    if (elements.rpcConfigPanel) elements.rpcConfigPanel.hidden = true;
  }

  function openSessionPanel() {
    if (elements.sessionFundingAmount) {
      const configured = Math.max(MINIMUM_SESSION_SOL, state.sessionLamports / LAMPORTS_PER_SOL || MINIMUM_SESSION_SOL);
      elements.sessionFundingAmount.min = String(MINIMUM_SESSION_SOL);
      elements.sessionFundingAmount.value = configured.toFixed(2).replace(/\.?0+$/, "");
    }
    if (elements.sessionFundingMinimum) elements.sessionFundingMinimum.textContent = `Minimum: ${MINIMUM_SESSION_SOL} SOL`;
    render();
    if (elements.sessionFundingOverlay) {
      elements.sessionFundingOverlay.hidden = false;
      elements.sessionFundingOverlay.setAttribute("aria-hidden", "false");
    }
    if (elements.sessionFundingPanel) {
      elements.sessionFundingPanel.hidden = false;
      elements.sessionFundingPanel.setAttribute("aria-hidden", "false");
    }
  }

  function closeSessionPanel(accepted = false) {
    if (elements.sessionFundingOverlay) {
      elements.sessionFundingOverlay.hidden = true;
      elements.sessionFundingOverlay.setAttribute("aria-hidden", "true");
    }
    if (elements.sessionFundingPanel) {
      elements.sessionFundingPanel.hidden = true;
      elements.sessionFundingPanel.setAttribute("aria-hidden", "true");
    }
    if (!accepted) setStatus("Session funding unchanged.");
  }

  function closeDialogs() {
    closeRpcPanel();
    closeWalletPanel();
    closeSessionPanel(true);
  }

  function handlePendingMine(pending, controls = {}) {
    if (!pending) return;
    state.lastProof = proofFromPending(pending, "pending");
    appendChainEvent(
      `${miningProofLabel(pending)} pending x=${pending.worldX} y=${pending.worldY} z=${pending.worldZ} block=${pending.blockId} resource=${pending.resourceId}.`,
      miningEventOptions(pending, "pending"),
    );
    render();
    submitPendingToChain("mine", pending, controls);
  }

  function handleConfirmedMine(pending) {
    if (!pending) return;
    const chainResult = takeChainResult(pending.txId);
    if (chainResult?.signature) {
      state.lastProof = proofFromPending(pending, "confirmed");
      appendChainEvent(
        `${miningProofLabel(pending)} confirmed on chain ${shortSignature(chainResult.signature)} for ${pending.worldX},${pending.worldY},${pending.worldZ}.`,
        miningEventOptions(pending, "confirmed", { signature: chainResult.signature }),
      );
    } else {
      const reason = chainResult?.reason || "missing-chain-signature";
      state.lastProof = proofFromPending(pending, "rollback");
      appendChainEvent(
        `Rejected local confirmation ${pending.txId}; no confirmed chain signature was recorded.`,
        miningEventOptions(pending, "error", { phase: "missing-signature", reason }),
      );
    }
    render();
  }

  function handleRollbackMine(pending) {
    if (!pending) return;
    const chainResult = takeChainResult(pending.txId);
    state.lastProof = proofFromPending(pending, "rollback");
    appendChainEvent(
      chainResult?.reason
        ? `Rolled back ${pending.txId}; chain rejected proof: ${chainResult.reason}.`
        : `Rolled back ${pending.txId}; pending delta removed without touching base world data.`,
      miningEventOptions(pending, "error", { reason: chainResult?.reason }),
    );
    render();
  }

  function miningProofLabel(pending) {
    const count = Math.max(1, Math.trunc(Number(pending?.minedBlockCount) || 1));
    if (pending?.miningKind === "tree-fell" && count > 1) return `Tree-fell proof (${count} blocks)`;
    if (pending?.miningKind === "support-collapse" && count > 1) return `Support-collapse proof (${count} blocks)`;
    if (pending?.miningKind === "debug-bulk" && count > 1) return `Bulk-mining proof (${count} blocks)`;
    return "Mining proof";
  }

  function handlePendingPlace(pending, controls = {}) {
    if (!pending) return;
    state.lastProof = proofFromPending(pending, "placement-pending", "place");
    appendChainEvent(`Pending placement x=${pending.worldX} y=${pending.worldY} z=${pending.worldZ} block=${pending.blockId} from resource=${pending.resourceId}.`);
    render();
    submitPendingToChain("place", pending, controls);
  }

  function handleConfirmedPlace(pending) {
    if (!pending) return;
    const chainResult = takeChainResult(pending.txId);
    state.lastProof = proofFromPending(pending, "placement-confirmed", "place");
    if (chainResult?.signature) {
      appendChainEvent(`Placement confirmed on chain ${shortSignature(chainResult.signature)} for ${pending.worldX},${pending.worldY},${pending.worldZ}.`);
    } else {
      appendChainEvent(`Confirmed placement ${pending.txId}; integer placement tuple preserved for chain adapter.`);
    }
    render();
  }

  function handleRollbackPlace(pending) {
    if (!pending) return;
    const chainResult = takeChainResult(pending.txId);
    state.lastProof = proofFromPending(pending, "placement-rollback", "place");
    appendChainEvent(chainResult?.reason
      ? `Rolled back placement ${pending.txId}; chain rejected proof: ${chainResult.reason}.`
      : `Rolled back placement ${pending.txId}; block delta removed and backpack stack restored.`);
    render();
  }

  function appendChainEvent(message, options = {}) {
    return eventFeed.append(message, options);
  }

  function miningEventOptions(pending, eventState, { signature = "", reason = "", phase = eventState } = {}) {
    const lossyRewards = Boolean(pending?.lossyRewards || pending?.chainResult?.lossyRewards);
    const groups = Array.isArray(pending?.rewardGroups) && pending.rewardGroups.length
      ? pending.rewardGroups
      : lossyRewards
        ? []
        : [{ resourceId: pending?.resourceId, blockId: pending?.blockId, count: 1 }];
    const primary = groups[0] ?? {};
    const totalCount = groups.reduce((sum, group) => sum + Math.max(1, Math.trunc(Number(group?.count) || 1)), 0);
    const typeSuffix = groups.length > 1 ? ` +${groups.length - 1} types` : "";
    const primaryName = groups.length
      ? String(resourceName?.(primary.resourceId) || `Resource ${primary.resourceId}`)
      : "";
    const detail = miningEventDetail(eventState, phase, signature, reason, pending, totalCount);
    const eyebrow = phase === "submitting"
      ? "SUBMITTING"
      : phase === "local" || phase === "local-confirmed"
        ? "LOCAL ONLY"
        : eventState === "confirmed"
          ? "ON CHAIN"
          : eventState === "error"
            ? "MINING FAILED"
            : "MINING";
    const title = groups.length
      ? `${primaryName}${typeSuffix}${totalCount > 1 ? ` ×${totalCount}` : ""}`
      : bulkMiningEventTitle(pending, eventState, signature);
    return {
      kind: "mining",
      state: eventState,
      eventId: pending?.txId,
      eyebrow,
      title,
      detail,
      resource: groups.length
        ? {
            kind: "resource",
            itemId: "resource_block",
            resourceId: primary.resourceId,
            blockId: primary.blockId,
            count: totalCount,
          }
        : null,
      flyToBackpack: eventState === "confirmed" && Boolean(signature) && totalCount > 0,
      holdUntilResolved: eventState === "pending",
    };
  }

  function bulkMiningEventTitle(pending, eventState, signature) {
    const count = Math.max(1, Math.trunc(Number(pending?.minedBlockCount) || 1));
    if (eventState === "confirmed" && signature) {
      return ui("main.bulkMining.resultTitle", "Mining complete · {count} blocks", { count });
    }
    if (eventState === "error") {
      return ui("main.chainLog.mineFailed", "Mining transaction failed");
    }
    return ui("main.bulkMining.submitting", "Submitting {count} blocks in chunk batches.", { count });
  }

  function miningEventDetail(eventState, phase, signature, reason, pending, storedCount) {
    if (eventState === "confirmed" && signature && pending?.lossyRewards && storedCount === 0) {
      return ui("main.bulkMining.noDropsSaved", "No drops saved · backpack capacity and drop rolls applied");
    }
    if (eventState === "confirmed" && signature) return `Added to PDA backpack · ${shortSignature(signature)}`;
    if (phase === "local-confirmed") return "Confirmed locally · no chain transfer animation";
    if (phase === "submitting") return "Submitting integer coordinate proof";
    if (phase === "wallet-needed") return "Connect a wallet to submit this proof";
    if (phase === "local") return reason || "Chain sync disabled · kept as a local delta";
    if (eventState === "error") return `Chain proof rejected${reason ? ` · ${reason}` : ""}`;
    return "Awaiting chain confirmation";
  }

  function proofFromPending(pending, status, action = "mine") {
    const [px, py, pz] = getPlayerPosition();
    return {
      status,
      action,
      txId: pending.txId,
      worldX: pending.worldX,
      worldY: pending.worldY,
      worldZ: pending.worldZ,
      blockId: pending.blockId,
      resourceId: pending.resourceId,
      playerX: Math.floor(px),
      playerY: Math.floor(py),
      playerZ: Math.floor(pz),
    };
  }

  async function submitPendingToChain(action, pending, controls = {}) {
    if (!pending?.txId) return;
    if (!chainAdapter.isEnabled()) {
      state.chainMode = "local-preview";
      const reason = "chain-submission-disabled";
      logSubmissionFailure(action, pending, { stage: "preflight", reason });
      state.chainResults.set(pending.txId, { reason });
      const rolledBack = action === "mine" ? controls.rollbackTx?.(pending.txId) : null;
      if (!rolledBack) {
        appendSubmissionState(action, pending, `${pending.txId} not submitted: chain submission is disabled.`, "error", {
          reason,
        });
      }
      render();
      return;
    }
    if (!chainAdapter.isReady()) {
      state.chainMode = "wallet-needed";
      logSubmissionFailure(action, pending, {
        stage: "preflight",
        reason: "wallet-needed",
      });
      appendSubmissionState(action, pending, `${pending.txId} not submitted: connect wallet to submit chain proof.`, "error", {
        phase: "wallet-needed",
      });
      if (action === "mine") {
        state.chainResults.set(pending.txId, { reason: "wallet-needed" });
        controls.rollbackTx?.(pending.txId);
      }
      render();
      return;
    }
    state.chainMode = "submitting";
    appendSubmissionState(action, pending, `${pending.txId} submitting ${action} proof to NiceChunk chain adapter.`, "pending", {
      phase: "submitting",
    });
    render();
    try {
      const result = action === "place"
        ? await chainAdapter.submitPlace(pending)
        : await chainAdapter.submitMine(pending);
      if (result?.submitted) {
        state.chainMode = "chain-ready";
        const reconciliation = action === "mine"
          ? reconcilePendingMineWithChainResult(pending, result.result)
          : null;
        if (reconciliation?.droppedCount) {
          gameState.playerProfile.minedBlocks = Math.max(
            0,
            Math.trunc(Number(gameState.playerProfile.minedBlocks) || 0) - reconciliation.droppedCount,
          );
          gameState.savePlayerProfile();
        }
        if (action === "mine" && result.result?.partialCollapse) {
          logPartialCollapseFailure(pending, result);
        }
        if (action === "mine" && result.result?.partialBulkMine) {
          logPartialBulkMiningFailure(pending, result);
        }
        state.chainResults.set(pending.txId, { signature: result.signature, result: result.result });
        pending.chainSubmitted = true;
        pending.chainAction = action;
        pending.chainSignature = result.signature;
        pending.chainPlayerPositionSaved = Boolean(result.result?.playerPositionSaved);
        pending.chainResult = result.result ?? null;
        const confirmed = controls.confirmTx?.(pending.txId);
        if (!confirmed) {
          state.chainResults.delete(pending.txId);
          appendSubmissionState(
            action,
            pending,
            `${pending.txId} chain confirmed ${shortSignature(result.signature)}, but local pending was already resolved.`,
            "confirmed",
            { phase: "local-confirmed" },
          );
        }
        render();
        return;
      }
      state.chainMode = "chain-ready";
      const reason = result?.reason || "not-submitted";
      logSubmissionFailure(action, pending, {
        stage: "adapter-result",
        reason,
        result,
      });
      state.chainResults.set(pending.txId, { reason, result: result?.result });
      if (reason === "no-backpack") onBackpackRequired({ source: "chain", pending });
      if (action === "mine" || shouldRollbackRejectedSubmission(reason)) {
        const rolledBack = controls.rollbackTx?.(pending.txId);
        if (!rolledBack) {
          appendSubmissionState(action, pending, `${pending.txId} chain rejected (${reason}), but local pending was already resolved.`, "error", { reason });
        }
      } else {
        appendSubmissionState(action, pending, `${pending.txId} chain adapter skipped: ${reason}. Pending remains local.`, "error", { reason });
      }
      render();
    } catch (error) {
      state.chainMode = "adapter-error";
      const reason = readableError(error);
      logSubmissionFailure(action, pending, {
        stage: "exception",
        reason,
        error,
      });
      state.chainResults.set(pending.txId, { reason });
      const rolledBack = action === "mine" ? controls.rollbackTx?.(pending.txId) : null;
      if (!rolledBack) {
        appendSubmissionState(
          action,
          pending,
          `${pending.txId} chain adapter error: ${reason}.`,
          "error",
          { reason },
        );
      }
      render();
    }
  }

  function logSubmissionFailure(action, pending, { stage, reason, error = null, result = null } = {}) {
    const report = logChainSubmissionFailure({
      action,
      stage,
      pending,
      reason,
      error,
      result,
      walletAddress: state.walletAddress,
      adapter: chainAdapter.snapshot?.(),
    });
    if (error && report.signature && !report.programLogs.length) {
      void hydrateChainTransactionFailure(error, { rpcUrl: state.rpcUrl }).then(() => {
        logChainSubmissionFailure({
          action,
          stage: "rpc-transaction-details",
          pending,
          reason,
          error,
          result,
          walletAddress: state.walletAddress,
          adapter: chainAdapter.snapshot?.(),
        });
      });
    }
    return report;
  }

  function logPartialCollapseFailure(pending, result) {
    const failures = Array.isArray(result?.result?.failedCollapseBlocks)
      ? result.result.failedCollapseBlocks
      : [];
    const first = failures[0] ?? {};
    const block = first.block ?? {};
    const error = first.error || chainFailureError(first);
    logSubmissionFailure("mine", {
      ...pending,
      txId: `${pending.txId}:collapse`,
      worldX: block.x ?? block.worldX ?? pending.worldX,
      worldY: block.y ?? block.worldY ?? pending.worldY,
      worldZ: block.z ?? block.worldZ ?? pending.worldZ,
      blockId: block.blockId ?? pending.blockId,
      resourceId: block.resourceId ?? pending.resourceId,
    }, {
      stage: "partial-collapse",
      reason: `${failures.length} support-collapse block(s) were not committed`,
      error,
      result,
    });
  }

  function logPartialBulkMiningFailure(pending, result) {
    const failures = Array.isArray(result?.result?.failedBulkBlocks)
      ? result.result.failedBulkBlocks
      : [];
    const first = failures[0] ?? {};
    const block = first.block ?? {};
    const error = first.error || chainFailureError(first);
    logSubmissionFailure("mine", {
      ...pending,
      txId: `${pending.txId}:bulk`,
      worldX: block.x ?? block.worldX ?? pending.worldX,
      worldY: block.y ?? block.worldY ?? pending.worldY,
      worldZ: block.z ?? block.worldZ ?? pending.worldZ,
      blockId: block.blockId ?? pending.blockId,
      resourceId: block.resourceId ?? pending.resourceId,
    }, {
      stage: "partial-bulk-mine",
      reason: `${failures.length} bulk-mining block(s) were not committed`,
      error,
      result,
    });
  }

  function appendSubmissionState(action, pending, message, eventState, options = {}) {
    if (action === "mine") return appendChainEvent(message, miningEventOptions(pending, eventState, options));
    return appendChainEvent(message);
  }

  function takeChainResult(txId) {
    const result = state.chainResults.get(txId);
    if (result) state.chainResults.delete(txId);
    return result;
  }
}

function detectWalletProvider() {
  const candidates = [
    globalThis.solana,
    globalThis.phantom?.solana,
    globalThis.backpack?.solana,
    globalThis.solflare,
  ];
  return candidates.find((provider) => provider?.connect && provider?.publicKey !== null) ?? candidates.find((provider) => provider?.connect) ?? null;
}

async function loadLocalWalletModule() {
  if (localWalletModulePromise) return localWalletModulePromise;
  localWalletModulePromise = importFirstLocalWalletModule().catch((error) => {
    localWalletModulePromise = null;
    throw error;
  });
  return localWalletModulePromise;
}

async function importFirstLocalWalletModule() {
  const urls = [];
  pushUrl(urls, globalThis.NICECHUNK_LOCAL_WALLET_MODULE_URL);
  for (const url of PROD_LOCAL_WALLET_MODULE_URLS) pushUrl(urls, url);
  if (!PLAY_RUNTIME_VERSION) {
    for (const url of await discoverBuiltLocalWalletModuleUrls()) pushUrl(urls, url);
  }
  const failures = [];
  for (const url of urls) {
    try {
      const module = await import(/* @vite-ignore */ url);
      if (typeof module.createLocalGameWallet === "function" || typeof module.getLocalGameWalletRecord === "function") return module;
      failures.push(`${url}: missing local wallet exports`);
    } catch (error) {
      failures.push(`${url}: ${error?.message || String(error)}`);
    }
  }
  throw new Error(`Unable to load local wallet module. Tried ${failures.join("; ")}`);
}

async function discoverBuiltLocalWalletModuleUrls() {
  if (localWalletModuleManifestPromise) return localWalletModuleManifestPromise;
  localWalletModuleManifestPromise = firstManifestUrls(LOCAL_WALLET_MODULE_MANIFEST_URLS, fetchLocalWalletModuleUrlsFromManifest);
  return localWalletModuleManifestPromise;
}

async function firstManifestUrls(manifestUrls, fetcher) {
  for (const manifestUrl of manifestUrls) {
    try {
      const urls = await fetcher(manifestUrl);
      if (urls.length) return urls;
    } catch {
      // Try the next manifest path. /play is usually served outside the dist root.
    }
  }
  return [];
}

async function fetchLocalWalletModuleUrlsFromManifest(manifestUrl) {
  if (typeof fetch !== "function") return [];
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) return [];
  const manifest = await response.json();
  if (!manifest || typeof manifest !== "object") return [];
  const entryUrls = [];
  const fallbackUrls = [];
  for (const [key, entry] of Object.entries(manifest)) {
    const kind = localWalletManifestEntryKind(key, entry);
    if (kind === "entry") pushUrl(entryUrls, manifestFileToUrl(entry.file, manifestUrl));
    else if (kind === "chunk") pushUrl(fallbackUrls, manifestFileToUrl(entry.file, manifestUrl));
  }
  return [...entryUrls, ...fallbackUrls];
}

function localWalletManifestEntryKind(key, entry) {
  const source = String(entry?.src || key || "").replaceAll("\\", "/");
  const file = String(entry?.file || "").replaceAll("\\", "/");
  if (source.endsWith("src/localGameWallet.js")) return "entry";
  if (/assets\/localGameWallet-[^/]+\.js$/.test(file)) return "chunk";
  return "";
}

function manifestFileToUrl(file, manifestUrl = "") {
  const normalized = String(file || "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized) return "";
  const manifestPath = String(manifestUrl || "").replaceAll("\\", "/");
  const prefix = manifestPath.startsWith("/dist/") ? "/dist/" : "/";
  return `${prefix}${normalized}`;
}

function persistWalletSession(address, walletName = "") {
  const walletAddress = String(address || "").trim();
  if (!walletAddress) return;
  saveString(WALLET_STORAGE_KEY, walletAddress);
  saveString(WALLET_BOUND_AT_STORAGE_KEY, String(Date.now()));
  if (walletName) saveString(WALLET_NAME_STORAGE_KEY, walletName);
}

function walletProviderName(provider) {
  if (provider?.isPhantom || globalThis.phantom?.solana === provider) return "Phantom";
  if (provider?.isSolflare || globalThis.solflare === provider) return "Solflare";
  if (provider?.isBackpack || globalThis.backpack?.solana === provider) return "Backpack";
  return "Solana Wallet";
}

function dispatchWalletChanged(walletAddress) {
  globalThis.dispatchEvent?.(new CustomEvent(WALLET_SESSION_CHANGED_EVENT, { detail: { walletAddress } }));
}

function pushUrl(urls, value) {
  const url = String(value || "").trim();
  if (url && !urls.includes(url)) urls.push(url);
}

function getRpcUrl() {
  const override = cleanRpcUrl(loadString(RPC_OVERRIDE_STORAGE_KEY));
  if (override) return override;
  const apiKey = getStoredHeliusApiKey();
  return apiKey ? `https://devnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}` : PUBLIC_DEVNET_RPC_URL;
}

async function fetchWalletBalance(rpcUrl, walletAddress) {
  if (typeof fetch !== "function") throw new Error("Fetch API unavailable");
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = globalThis.setTimeout?.(() => controller?.abort(), BALANCE_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "nicechunk-wallet-balance",
        method: "getBalance",
        params: [walletAddress, { commitment: "confirmed" }],
      }),
      signal: controller?.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.error) throw new Error(payload.error.message || `RPC error ${payload.error.code || "unknown"}`);
    const lamports = Number(payload?.result?.value);
    if (!Number.isFinite(lamports) || lamports < 0) throw new Error("RPC returned an invalid balance");
    return Math.trunc(lamports);
  } finally {
    if (timeout) globalThis.clearTimeout?.(timeout);
  }
}

function getStoredHeliusApiKey() {
  return String(loadString(HELIUS_API_KEY_STORAGE_KEY)).trim();
}

function saveHeliusApiKey(apiKey) {
  const cleaned = String(apiKey || "").trim();
  if (cleaned) saveString(HELIUS_API_KEY_STORAGE_KEY, cleaned);
  else removeString(HELIUS_API_KEY_STORAGE_KEY);
  removeString(RPC_OVERRIDE_STORAGE_KEY);
  globalThis.dispatchEvent?.(new CustomEvent(RPC_CONFIG_CHANGED_EVENT, { detail: { rpcUrl: getRpcUrl() } }));
}

function getStoredSessionLamports(owner) {
  const ownerValue = Number(loadString(sessionFundingStorageKey(owner)));
  const defaultValue = Number(loadString(sessionFundingStorageKey(null)));
  const value = Number.isFinite(ownerValue) && ownerValue > 0 ? ownerValue : defaultValue;
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function saveSessionLamports(owner, lamports) {
  saveString(sessionFundingStorageKey(owner), String(Math.max(0, Math.trunc(lamports || 0))));
}

function saveSessionAcknowledged(owner) {
  saveString(sessionFundingAcknowledgedKey(owner), "1");
}

function sessionFundingStorageKey(owner = null) {
  return `${SESSION_FUNDING_PREFIX}${owner || "default"}`;
}

function sessionFundingAcknowledgedKey(owner = null) {
  return `${SESSION_ACK_PREFIX}${owner || "default"}`;
}

function levelFromProfile(profile = {}) {
  return Math.max(1, 1 + Math.floor((Number(profile.confirmedMines) || 0) / 25));
}

function chainModeLabel(mode) {
  switch (mode) {
    case "chain-ready":
      return "On-chain miner";
    case "submitting":
      return "Submitting proof";
    case "wallet-needed":
      return "Wallet needed";
    case "adapter-error":
      return "Chain adapter error";
    default:
      return "Local preview";
  }
}

function ownerLabel() {
  const address = loadString(WALLET_STORAGE_KEY);
  return address ? shortAddress(address) : "local session";
}

function ui(key, fallback, params = {}) {
  const translated = t(key, params);
  return translated === key ? fallback : translated;
}

function shortAddress(address) {
  const value = String(address || "");
  return value.length > 12 ? `${value.slice(0, 4)}...${value.slice(-4)}` : value || "Not connected";
}

function formatSol(lamports) {
  return (Math.trunc(lamports || 0) / LAMPORTS_PER_SOL).toFixed(3).replace(/\.?0+$/, "");
}

function formatWalletSol(lamports) {
  const sol = Math.max(0, Number(lamports) || 0) / LAMPORTS_PER_SOL;
  const decimals = sol >= 100 ? 2 : sol >= 1 ? 3 : sol >= 0.01 ? 4 : 6;
  return sol.toFixed(decimals).replace(/\.?0+$/, "") || "0";
}

function shortSignature(signature) {
  const value = String(signature || "");
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-6)}` : value || "no-signature";
}

function shouldRollbackRejectedSubmission(reason) {
  return [
    "already-mined",
    "backpack-full",
    "invalid-backpack-index",
    "no-backpack",
    "not-tree-trunk",
    "record-support-collapse-unavailable",
    "record-tree-fell-unavailable",
    "unmineable-block",
  ].includes(String(reason || ""));
}

function chainFailureError(failure) {
  const error = new Error(String(failure?.reason || "support-collapse submission failed"));
  error.name = String(failure?.errorName || "SupportCollapseSubmissionError");
  if (failure?.code !== undefined && failure?.code !== null) error.code = failure.code;
  if (failure?.signature) error.signature = failure.signature;
  if (failure?.transactionError !== undefined && failure?.transactionError !== null) {
    error.transactionError = failure.transactionError;
  }
  if (Array.isArray(failure?.logs)) error.nicechunkLogs = failure.logs;
  return error;
}

function readableError(error) {
  const message = String(error?.message || error || "unknown error");
  return message.length > 180 ? `${message.slice(0, 177)}...` : message;
}

function cleanRpcUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function loadString(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function saveString(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage may be unavailable in private browsing.
  }
}

function removeString(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable in private browsing.
  }
}
