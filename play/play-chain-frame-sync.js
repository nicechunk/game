import {
  RPC_CONFIG_CHANGED_EVENT,
  WALLET_SESSION_CHANGED_EVENT,
} from "./play-chain-session.js";
import { getChunkSnapshotApplyBudget } from "./play-chain-apply-budget.js";

const FRAME_CHAIN_BACKPACK_SYNC_MS = 15_000;
const FRAME_CHAIN_PLAYER_SYNC_MS = 18_000;
const FRAME_CHAIN_CHUNK_DELTA_SYNC_MS = 1_200;
const FRAME_CHAIN_CHUNK_DELTA_MOVING_SYNC_MS = 1_800;
const STARTUP_CHAIN_DELTA_SYNC_DELAY_MS = 0;

export function createPlayChainFrameSync({
  getChainBackpack = () => null,
  getChainPlayer = () => null,
  getChainChunkDeltas = () => null,
  getAvatarSession = () => null,
  renderGameUi = () => {},
} = {}) {
  let bound = false;
  let lastBackpackAt = 0;
  let lastPlayerAt = 0;
  let lastChunkDeltaAt = performance.now();
  let lastChunkApplyAt = null;

  return {
    bind,
    scheduleStartupChunkDeltaSync,
    updateBackpackForFrame,
    updatePlayerForFrame,
    updateChunkDeltasForFrame,
    resetTimers,
  };

  function bind() {
    if (bound) return;
    bound = true;
    globalThis.addEventListener?.(WALLET_SESSION_CHANGED_EVENT, handleWalletSessionChanged);
    globalThis.addEventListener?.(RPC_CONFIG_CHANGED_EVENT, handleRpcConfigChanged);
    globalThis.addEventListener?.("pageshow", handleWorldResume);
    globalThis.addEventListener?.("online", handleWorldResume);
    globalThis.addEventListener?.("pagehide", () => getChainChunkDeltas()?.cancelActiveSync?.("pagehide"));
    globalThis.document?.addEventListener?.("visibilitychange", () => { if (globalThis.document.visibilityState === "visible") handleWorldResume(); });
  }

  function scheduleStartupChunkDeltaSync({ onSync = null } = {}) {
    globalThis.setTimeout(() => {
      lastChunkDeltaAt = performance.now();
      const promise = getChainChunkDeltas()?.requestSync({ force: true, reason: "startup", quiet: false });
      if (typeof onSync === "function") onSync(promise || null);
    }, STARTUP_CHAIN_DELTA_SYNC_DELAY_MS);
  }

  function updateBackpackForFrame(now) {
    const chainBackpack = getChainBackpack();
    if (!chainBackpack || now - lastBackpackAt < FRAME_CHAIN_BACKPACK_SYNC_MS) return;
    lastBackpackAt = now;
    chainBackpack.refresh({ quiet: true }).then((result) => {
      if (result?.ok && result.changed) renderGameUi();
    });
  }

  function updatePlayerForFrame(now) {
    const chainPlayer = getChainPlayer();
    if (!chainPlayer || now - lastPlayerAt < FRAME_CHAIN_PLAYER_SYNC_MS) return;
    lastPlayerAt = now;
    chainPlayer.refresh({ quiet: true }).then((result) => {
      if (result?.ok && result.changed) {
        getAvatarSession()?.syncModelFromProfile();
        renderGameUi();
      }
    });
  }

  function updateChunkDeltasForFrame(now, { moving = false, frameIntervalMs = null, deadline = Infinity } = {}) {
    const chainChunkDeltas = getChainChunkDeltas();
    if (!chainChunkDeltas) return;
    const observedInterval = frameIntervalMs ?? (lastChunkApplyAt === null ? undefined : now - lastChunkApplyAt);
    lastChunkApplyAt = now;
    const budget = getChunkSnapshotApplyBudget({ moving, frameIntervalMs: observedInterval });
    budget.budgetMs = Math.max(0, Math.min(budget.budgetMs, deadline - performance.now()));
    budget.deadline = deadline;
    chainChunkDeltas.applyQueuedDeltas?.(budget);
    const syncInterval = moving ? FRAME_CHAIN_CHUNK_DELTA_MOVING_SYNC_MS : FRAME_CHAIN_CHUNK_DELTA_SYNC_MS;
    if (now - lastChunkDeltaAt < syncInterval) return;
    lastChunkDeltaAt = now;
    chainChunkDeltas.requestSync({ reason: "frame", quiet: true });
  }

  function handleWalletSessionChanged() {
    resetTimers({ backpack: true, player: true });
    getChainPlayer()?.refresh({ force: true, quiet: false }).then((result) => {
      if (result?.ok) renderGameUi();
    });
    getChainBackpack()?.refresh({ force: true, quiet: false }).then((result) => {
      if (result?.ok) renderGameUi();
    });
    getChainChunkDeltas()?.requestSync({ force: true, reason: "wallet-change", quiet: false });
    renderGameUi();
  }

  function handleRpcConfigChanged() {
    resetTimers({ player: true });
    getChainPlayer()?.refresh({ force: true, quiet: false }).then((result) => {
      if (result?.ok) renderGameUi();
    });
    // Keep the last verified snapshot visible until the new RPC endpoint has
    // returned and validated its replacement.
    getChainChunkDeltas()?.clearLocalCache({ clearRenderDeltas: false });
    getChainChunkDeltas()?.requestSync({ force: true, reason: "rpc-change", quiet: false });
  }

  function handleWorldResume() {
    lastChunkDeltaAt = 0;
    lastChunkApplyAt = null;
    getChainChunkDeltas()?.invalidateFreshness?.({ reason: "page-resume" });
    getChainChunkDeltas()?.requestSync({ reason: "page-resume", quiet: true });
  }

  function resetTimers({ backpack = false, player = false, chunkDeltas = false } = {}) {
    if (backpack) lastBackpackAt = 0;
    if (player) lastPlayerAt = 0;
    if (chunkDeltas) { lastChunkDeltaAt = 0; lastChunkApplyAt = null; }
  }
}
