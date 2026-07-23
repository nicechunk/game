import { BLOCK_ID } from "/chunk.js/play.js";
import { loadPlayChainModule } from "./play-chain-adapter.js";
import {
  resolveBackpackReadState,
  verifyBackpackCreationEligibility,
} from "./backpack-read-state.js";

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
  purchaseBackpack = defaultPurchaseBackpack,
  translate = (_key, fallback, params = {}) => formatMessage(fallback, params),
} = {}) {
  const state = {
    open: false,
    creating: false,
    phase: "idle",
    learning: false,
    lastNoticeAt: 0,
    messageMode: "read",
  };
  const ui = (key, fallback, params = {}) => {
    try {
      const translated = translate(key, fallback, params);
      if (translated && translated !== key) return String(translated);
    } catch {
      // A locale failure must not weaken the backpack creation guard.
    }
    return formatMessage(fallback, params);
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
    if (currentReadState().available) {
      onStatus(ui("main.backpackCreate.alreadyExists", "This wallet already has a backpack. A second backpack cannot be created."));
      return false;
    }
    closePanels();
    state.open = true;
    state.phase = "idle";
    state.learning = false;
    state.messageMode = "read";
    if (elements.backpackCreateOverlay) {
      elements.backpackCreateOverlay.hidden = false;
      elements.backpackCreateOverlay.setAttribute("aria-hidden", "false");
    }
    document.body.classList.add("backpack-create-open");
    setReadMessage(currentReadState());
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
    state.phase = "idle";
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
    const readState = currentReadState();
    const available = readState.available;
    if (available && state.open && !state.creating) close({ created: true });
    if (state.open && !state.creating && state.messageMode === "read") setReadMessage(readState);
    if (elements.backpackCreateSubmit) {
      const checking = readState.loading || readState.pending;
      elements.backpackCreateSubmit.disabled = state.creating || available || checking;
      elements.backpackCreateSubmit.classList.toggle("is-loading", state.creating || checking);
      if (elements.backpackCreateSubmitLabel) {
        elements.backpackCreateSubmitLabel.textContent = state.creating && state.phase === "checking"
          ? ui("main.backpackCreate.checking", "CHECKING BACKPACK...")
          : state.creating
            ? ui("main.backpackCreate.creating", "CREATING ON CHAIN...")
          : available
            ? ui("main.backpackCreate.alreadyExistsLabel", "BACKPACK ALREADY EXISTS")
            : checking
              ? ui("main.backpackCreate.checking", "CHECKING BACKPACK...")
              : readState.error
                ? ui("main.backpackCreate.retryCheck", "RETRY BACKPACK CHECK")
                : ui("main.backpackCreate.submit", "CREATE BACKPACK");
      }
    }
    elements.backpackCreatePanel?.classList.toggle("is-learning", state.learning);
    if (state.open) requestAnimationFrame(positionHotbarCallout);
  }

  async function createBackpack() {
    if (state.creating) return { ok: false, reason: "backpack-creation-pending" };
    if (currentReadState().available) {
      const message = ui("main.backpackCreate.alreadyExists", "This wallet already has a backpack. A second backpack cannot be created.");
      setMessage(message, "warn");
      onStatus(message);
      return { ok: false, reason: "backpack-already-exists" };
    }
    if (!walletAvailable()) {
      setMessage("A wallet is required to own the backpack PDA. Connect a plugin wallet or create a game wallet.", "warn");
      getChainSession()?.openWalletPanel?.();
      return { ok: false, reason: "wallet-unavailable" };
    }
    state.creating = true;
    state.phase = "checking";
    state.messageMode = "transaction";
    setMessage(ui("main.backpackCreate.checkingDetail", "Checking the chain for an existing backpack before creating one."), "pending");
    render();
    try {
      const eligibility = await verifyBackpackCreationEligibility({
        gameState,
        chainBackpack: getChainBackpack(),
      });
      if (!eligibility.ok) return handleIneligibleCreation(eligibility);

      state.phase = "submitting";
      setMessage("Preparing the backpack PDA transaction. Confirm it in your wallet.", "pending");
      render();
      const result = await purchaseBackpack();
      if (result?.reason === "backpack-already-bound") {
        const message = ui("main.backpackCreate.alreadyExists", "This wallet already has a backpack. A second backpack cannot be created.");
        setMessage(message, "warn");
        await refreshBackpackPda();
        onStatus(message);
        return { ok: false, reason: "backpack-already-exists", result };
      }
      if (!result?.purchased) {
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
        return { ok: true, result, sync };
      }
      throw new Error(readableReason(sync?.reason || "backpack-sync-failed"));
    } catch (error) {
      setMessage(`Backpack creation failed: ${readableError(error)}`, "error");
      onStatus(`Backpack creation failed: ${readableError(error)}`, "error");
      return { ok: false, reason: "backpack-creation-failed", error };
    } finally {
      state.creating = false;
      state.phase = "idle";
      onChanged();
      render();
    }
  }

  function handleIneligibleCreation(eligibility) {
    if (eligibility.reason === "backpack-already-exists") {
      const message = ui("main.backpackCreate.alreadyExists", "This wallet already has a backpack. A second backpack cannot be created.");
      setMessage(message, "warn");
      onStatus(message);
    } else if (eligibility.reason === "backpack-read-pending") {
      state.messageMode = "read";
      setMessage(ui("main.backpackCreate.readPending", "Backpack data is still loading. Creation was not submitted."), "pending");
    } else {
      const message = ui(
        "main.backpackCreate.readFailed",
        "Backpack verification failed. Creation was not submitted: {reason}",
        { reason: readableReason(eligibility.detail || eligibility.reason) },
      );
      setMessage(message, "error");
      onStatus(message, "error");
    }
    return { ok: false, ...eligibility };
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

  function currentReadState() {
    return resolveBackpackReadState({
      gameState,
      snapshot: getChainBackpack()?.snapshot?.(),
    });
  }

  function setReadMessage(readState) {
    if (!walletAvailable()) {
      setMessage("Connect or create a wallet first, then create your backpack on chain.", "info");
    } else if (readState.loading || readState.pending) {
      setMessage(ui("main.backpackCreate.checkingDetail", "Checking the chain for an existing backpack before creating one."), "pending");
    } else if (readState.error) {
      setMessage(ui(
        "main.backpackCreate.readFailed",
        "Backpack verification failed. Creation was not submitted: {reason}",
        { reason: readableReason(readState.error) },
      ), "error");
    } else {
      setMessage("Your wallet is ready. Create the 50-slot backpack on chain to unlock mining.", "info");
    }
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

async function defaultPurchaseBackpack() {
  const module = await loadPlayChainModule();
  if (typeof module.purchaseDefaultBackpack !== "function") {
    throw new Error("Backpack creation is unavailable in the loaded chain module.");
  }
  return module.purchaseDefaultBackpack();
}

function readableReason(reason) {
  return String(reason || "unknown-error").replaceAll("-", " ");
}

function readableError(error) {
  const message = String(error?.message || error || "unknown error");
  return message.length > 150 ? `${message.slice(0, 147)}...` : message;
}

function formatMessage(template, params = {}) {
  return String(template || "").replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
  ));
}

function delay(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
