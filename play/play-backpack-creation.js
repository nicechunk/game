import { BLOCK_ID } from "/chunk.js/play.js";
import { loadPlayChainModule } from "./play-chain-adapter.js";

const BACKPACK_CAPACITY = 50;
const BACKPACK_PREVIEW_SLOT_COUNT = 30;
const NOTICE_COOLDOWN_MS = 1200;

export function createPlayBackpackCreation({
  elements,
  gameState,
  getChainBackpack = () => null,
  getChainSession = () => null,
  createVoxelItemIconCanvas,
  closePanels = () => {},
  onChanged = () => {},
  onCreated = () => {},
  onStatus = () => {},
  appendEvent = () => {},
} = {}) {
  const state = {
    open: false,
    creating: false,
    learning: false,
    lastNoticeAt: 0,
  };

  return {
    bind,
    open,
    close,
    render,
    createBackpack,
    isOpen: () => state.open,
  };

  function bind() {
    elements.backpackCreateClose?.addEventListener("click", () => close());
    elements.backpackCreateSubmit?.addEventListener("click", createBackpack);
    elements.backpackCreateLearn?.addEventListener("click", toggleLearnMore);
    elements.backpackCreateOverlay?.addEventListener("pointerdown", (event) => {
      if (event.target === elements.backpackCreateOverlay) close();
    });
    elements.backpackCreatePanel?.addEventListener("pointerdown", (event) => event.stopPropagation());
    globalThis.addEventListener?.("keydown", (event) => {
      if (event.code !== "Escape" || !state.open) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    }, true);
    globalThis.addEventListener?.("resize", positionHotbarCallout, { passive: true });
    renderStaticVisuals();
    render();
  }

  function open({ source = "mining" } = {}) {
    if (gameState?.isBackpackAvailable?.()) return false;
    closePanels();
    state.open = true;
    state.learning = false;
    if (elements.backpackCreateOverlay) {
      elements.backpackCreateOverlay.hidden = false;
      elements.backpackCreateOverlay.setAttribute("aria-hidden", "false");
    }
    document.body.classList.add("backpack-create-open");
    setMessage(walletAvailable()
      ? "Your wallet is ready. Create the 50-slot backpack on chain to unlock mining."
      : "Connect or create a wallet first, then create your backpack on chain.", "info");
    render();
    requestAnimationFrame(() => {
      positionHotbarCallout();
      elements.backpackCreateSubmit?.focus?.({ preventScroll: true });
    });
    const now = performance.now();
    if (source === "mining" && now - state.lastNoticeAt >= NOTICE_COOLDOWN_MS) {
      state.lastNoticeAt = now;
      appendEvent("Mining is locked until you create a backpack.");
      onStatus("Mining is locked until you create a backpack.");
    }
    return true;
  }

  function close({ created = false } = {}) {
    state.open = false;
    state.learning = false;
    if (elements.backpackCreateOverlay) {
      elements.backpackCreateOverlay.hidden = true;
      elements.backpackCreateOverlay.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("backpack-create-open");
    elements.backpackCreatePanel?.classList.remove("is-learning");
    if (elements.backpackCreateCallout) elements.backpackCreateCallout.hidden = true;
    if (!created) onStatus("Backpack creation closed. Mining remains locked until a backpack is created.");
  }

  function render() {
    const available = gameState?.isBackpackAvailable?.() === true;
    if (available && state.open && !state.creating) close({ created: true });
    if (elements.backpackCreateSubmit) {
      elements.backpackCreateSubmit.disabled = state.creating || available;
      elements.backpackCreateSubmit.classList.toggle("is-loading", state.creating);
      if (elements.backpackCreateSubmitLabel) {
        elements.backpackCreateSubmitLabel.textContent = state.creating
          ? "CREATING ON CHAIN..."
          : available
            ? "BACKPACK CREATED"
            : "CREATE BACKPACK";
      }
    }
    elements.backpackCreatePanel?.classList.toggle("is-learning", state.learning);
    if (state.open) requestAnimationFrame(positionHotbarCallout);
  }

  async function createBackpack() {
    if (state.creating || gameState?.isBackpackAvailable?.()) return;
    if (!walletAvailable()) {
      setMessage("A wallet is required to own the backpack PDA. Connect a plugin wallet or create a game wallet.", "warn");
      getChainSession()?.openWalletPanel?.();
      return;
    }
    state.creating = true;
    setMessage("Preparing the backpack PDA transaction. Confirm it in your wallet.", "pending");
    render();
    try {
      const module = await loadPlayChainModule();
      if (typeof module.purchaseDefaultBackpack !== "function") throw new Error("Backpack creation is unavailable in the loaded chain module.");
      const result = await module.purchaseDefaultBackpack();
      if (!result?.purchased && result?.reason !== "backpack-already-bound") {
        throw new Error(readableReason(result?.reason || "transaction-not-submitted"));
      }

      setMessage("Backpack created. Synchronizing the equipped PDA and 50 storage slots.", "success");
      const sync = await refreshBackpackPda();
      if (sync?.ok && gameState?.isBackpackAvailable?.()) {
        appendEvent("Backpack created and equipped. Mining is now unlocked.");
        onStatus("Backpack created and equipped. Mining is now unlocked.");
        onCreated({ result, sync });
        state.creating = false;
        render();
        globalThis.setTimeout?.(() => close({ created: true }), 420);
        return;
      }
      throw new Error(readableReason(sync?.reason || "backpack-sync-failed"));
    } catch (error) {
      setMessage(`Backpack creation failed: ${readableError(error)}`, "error");
      onStatus(`Backpack creation failed: ${readableError(error)}`);
    } finally {
      state.creating = false;
      onChanged();
      render();
    }
  }

  function toggleLearnMore() {
    state.learning = !state.learning;
    elements.backpackCreatePanel?.classList.toggle("is-learning", state.learning);
    if (elements.backpackCreateLearn) elements.backpackCreateLearn.setAttribute("aria-expanded", String(state.learning));
  }

  function renderStaticVisuals() {
    if (typeof createVoxelItemIconCanvas !== "function") return;
    appendIcon(elements.backpackCreateHeaderIcon, { kind: "backpack", itemId: "backpack" }, 48, "backpack-create-header-canvas");
    appendIcon(elements.backpackCreateHeroVisual, { kind: "backpack", itemId: "backpack" }, 280, "backpack-create-hero-canvas");
    appendIcon(elements.backpackCreateResourceIcon, { kind: "resource", itemId: "resource_block", blockId: BLOCK_ID.grass }, 76);
    appendIcon(elements.backpackCreateResourceIcon, { kind: "resource", itemId: "resource_block", blockId: BLOCK_ID.stone }, 66);
    appendIcon(elements.backpackCreateMiningIcon, { kind: "tool", itemId: "iron_pickaxe" }, 92);
    appendIcon(elements.backpackCreateMaterialIcon, { kind: "resource", itemId: "resource_block", blockId: BLOCK_ID.trunk }, 76);
    if (elements.backpackCreateSlotGrid && !elements.backpackCreateSlotGrid.childElementCount) {
      elements.backpackCreateSlotGrid.replaceChildren(...Array.from({ length: BACKPACK_PREVIEW_SLOT_COUNT }, (_, index) => {
        const slot = document.createElement("span");
        slot.className = "backpack-create-preview-slot";
        const hasMore = index === BACKPACK_PREVIEW_SLOT_COUNT - 1 && BACKPACK_PREVIEW_SLOT_COUNT < BACKPACK_CAPACITY;
        if (hasMore) {
          slot.classList.add("has-more");
          slot.textContent = "...";
          slot.setAttribute("aria-label", `${BACKPACK_CAPACITY - BACKPACK_PREVIEW_SLOT_COUNT + 1} additional backpack slots`);
        } else {
          slot.setAttribute("aria-label", `Backpack slot ${index + 1}`);
        }
        return slot;
      }));
    }
  }

  function appendIcon(container, item, size, className = "") {
    if (!container) return;
    const canvas = createVoxelItemIconCanvas(item, { size, className });
    container.append(canvas);
  }

  function setMessage(message, stateName = "info") {
    if (!elements.backpackCreateStatus) return;
    elements.backpackCreateStatus.textContent = message;
    elements.backpackCreateStatus.dataset.state = stateName;
  }

  function walletAvailable() {
    return Boolean(getChainSession()?.snapshot?.()?.walletAddress);
  }

  async function refreshBackpackPda() {
    const chainBackpack = getChainBackpack();
    if (!chainBackpack?.refresh) return { ok: false, reason: "backpack-sync-unavailable" };
    let result = null;
    for (const delayMs of [0, 350, 850]) {
      if (delayMs) await delay(delayMs);
      result = await chainBackpack.refresh({ force: true, quiet: true });
      if (result?.ok && gameState?.isBackpackAvailable?.()) return result;
    }
    return result || { ok: false, reason: "backpack-sync-failed" };
  }

  function positionHotbarCallout() {
    if (!elements.backpackCreateCallout) return;
    if (!state.open) {
      elements.backpackCreateCallout.hidden = true;
      return;
    }
    const target = elements.hotbar?.querySelector?.('[data-backpack-target="true"]');
    const rect = target?.getBoundingClientRect?.();
    if (!rect?.width) {
      elements.backpackCreateCallout.hidden = true;
      return;
    }
    elements.backpackCreateCallout.hidden = false;
    elements.backpackCreateCallout.style.left = `${rect.left + rect.width * 0.5}px`;
    elements.backpackCreateCallout.style.top = `${rect.top - 14}px`;
  }
}

function readableReason(reason) {
  return String(reason || "unknown-error").replaceAll("-", " ");
}

function readableError(error) {
  const message = String(error?.message || error || "unknown error");
  return message.length > 150 ? `${message.slice(0, 147)}...` : message;
}

function delay(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
