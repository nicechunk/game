const DEFAULT_MOUSE_ACTION_DRAG_PX = 8;
const DEFAULT_TOUCH_ACTION_DRAG_PX = 16;

export function createPlayInputActions({
  elements,
  gameState,
  getMining = () => null,
  getPlacement = () => null,
  getForgedPlacement = () => null,
  getBlueprint = () => null,
  getBlueprintHit = () => null,
  getBulkMining = () => null,
  getBulkMiningHit = () => null,
  getControls = () => null,
  getPlayer = () => null,
  getMotion = () => null,
  getDebugController = () => null,
  openDebugCommandLine = (initialValue) => getDebugController()?.openCommandLine?.(initialValue),
  getLastWorldDeltaKind = () => null,
  renderHotbar = () => {},
  closePanels = () => {},
  closeBackpackPanel = () => {},
  closeProfilePanel = () => {},
  toggleBackpackPanel = () => {},
  toggleProfilePanel = () => {},
  setFlightEnabled = () => {},
  toggleFirstPersonCamera = () => false,
  setViewDistance = () => {},
  clampViewDistance = (value) => value,
  onCanvasAction = () => {},
  mouseActionDragPx = DEFAULT_MOUSE_ACTION_DRAG_PX,
  touchActionDragPx = DEFAULT_TOUCH_ACTION_DRAG_PX,
} = {}) {
  let canvasActionPointer = null;
  let joystickPointerId = null;

  return {
    bind,
    useSelectedHotbarAction,
    confirmLastWorldDelta,
    rollbackLastWorldDelta,
  };

  function bind() {
    globalThis.addEventListener?.("keydown", onKeyDown);
    elements?.mine?.addEventListener("click", () => getMining()?.minePending?.());
    elements?.place?.addEventListener("click", () => getPlacement()?.placePending?.());
    elements?.confirm?.addEventListener("click", confirmLastWorldDelta);
    elements?.rollback?.addEventListener("click", rollbackLastWorldDelta);
    elements?.backpackButton?.addEventListener("click", toggleBackpackPanel);
    elements?.closeBackpack?.addEventListener("click", closeBackpackPanel);
    elements?.profileButton?.addEventListener("click", toggleProfilePanel);
    elements?.closeProfile?.addEventListener("click", closeProfilePanel);
    elements?.flightToggle?.addEventListener("click", () => {
      const player = getPlayer();
      setFlightEnabled(!player?.flightEnabled);
    });
    bindFlightHoldButton(elements?.flightUp, 1);
    bindFlightHoldButton(elements?.flightDown, -1);
    elements?.viewRangeInput?.addEventListener("input", () => {
      setViewDistance(clampViewDistance(Number(elements.viewRangeInput.value)));
    });
    bindCanvasActionPointer();
    bindJoystick();
  }

  function onKeyDown(event) {
    const debugController = getDebugController();
    if (event.code === "Slash" && !isTextInputActive()) {
      event.preventDefault();
      openDebugCommandLine("/");
      return;
    }
    if (event.code === "Escape") {
      if (debugController?.isCommandLineOpen?.()) {
        event.preventDefault();
        debugController.closeCommandLine();
        return;
      }
      const bulkMining = getBulkMining();
      if (bulkMining?.isEnabled?.() && bulkMining?.snapshot?.().phase !== "idle") {
        event.preventDefault();
        bulkMining.cancel?.();
        return;
      }
      closePanels();
      getBlueprint()?.cancel?.();
    }
    if (isTextInputActive()) return;
    if (event.code === "KeyE" && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      toggleFirstPersonCamera();
      return;
    }
    if (event.code.startsWith("Digit")) {
      const slot = Number(event.code.slice(5)) - 1;
      if (slot >= 0 && slot < (gameState?.hotbarSlots?.length ?? 0)) {
        if (!gameState?.isHotbarSlotSelectable?.(slot)) return;
        gameState.selectHotbarSlot(slot);
        renderHotbar();
      }
    }
    if (event.code === "KeyF") useSelectedHotbarAction();
    if (event.code === "Enter") confirmLastWorldDelta();
    if (event.code === "Backspace") {
      event.preventDefault();
      rollbackLastWorldDelta();
    }
  }

  function useSelectedHotbarAction() {
    const bulkMining = getBulkMining();
    if (bulkMining?.isEnabled?.()) return bulkMining.selectAtHit?.(getBulkMiningHit());
    if (gameState?.isBlueprintSelected?.()) return getBlueprint()?.selectAtHit?.(getBlueprintHit());
    const forged = gameState?.getSelectedForgedSlot?.();
    if (forged) {
      const interaction = gameState?.getForgedInteraction?.(forged.slot);
      if (interaction?.mode !== "tool") return getForgedPlacement()?.selectAtHit?.();
    }
    if (gameState?.getSelectedPlaceableSlot?.()) return getPlacement()?.placePending?.();
    return getMining()?.minePending?.();
  }

  function confirmLastWorldDelta() {
    const bulkMining = getBulkMining();
    if (bulkMining?.isEnabled?.()) return bulkMining.confirm?.();
    if (gameState?.isBlueprintSelected?.()) return getBlueprint()?.confirm?.();
    const placement = getPlacement();
    const mining = getMining();
    const lastWorldDeltaKind = getLastWorldDeltaKind();
    if (lastWorldDeltaKind === "place" && placement?.pendingCount?.() > 0) return placement.confirmLast();
    if (lastWorldDeltaKind === "mine" && mining?.pendingCount?.() > 0) return mining.confirmLast();
    if (placement?.pendingCount?.() > 0) return placement.confirmLast();
    return mining?.confirmLast?.();
  }

  function rollbackLastWorldDelta() {
    const bulkMining = getBulkMining();
    if (bulkMining?.isEnabled?.()) return bulkMining.cancel?.();
    if (gameState?.isBlueprintSelected?.()) return getBlueprint()?.cancel?.();
    const placement = getPlacement();
    const mining = getMining();
    const lastWorldDeltaKind = getLastWorldDeltaKind();
    if (lastWorldDeltaKind === "place" && placement?.pendingCount?.() > 0) return placement.rollbackLast();
    if (lastWorldDeltaKind === "mine" && mining?.pendingCount?.() > 0) return mining.rollbackLast();
    if (placement?.pendingCount?.() > 0) return placement.rollbackLast();
    return mining?.rollbackLast?.();
  }

  function bindCanvasActionPointer() {
    const canvas = elements?.canvas;
    if (!canvas) return;
    canvas.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      canvasActionPointer = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        pointerType: event.pointerType,
        dragged: false,
      };
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!canvasActionPointer || event.pointerId !== canvasActionPointer.pointerId) return;
      const dx = event.clientX - canvasActionPointer.x;
      const dy = event.clientY - canvasActionPointer.y;
      const dragLimit = canvasActionPointer.pointerType === "touch" ? touchActionDragPx : mouseActionDragPx;
      if (dx * dx + dy * dy > dragLimit * dragLimit) canvasActionPointer.dragged = true;
    });
    const finish = (event) => {
      if (!canvasActionPointer || event.pointerId !== canvasActionPointer.pointerId) return;
      const shouldAct = !canvasActionPointer.dragged && !isTextInputActive();
      canvasActionPointer = null;
      if (!shouldAct) return;
      event.preventDefault();
      onCanvasAction(event);
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", () => {
      canvasActionPointer = null;
    });
  }

  function bindFlightHoldButton(button, direction) {
    if (!button) return;
    const start = (event) => {
      event.preventDefault();
      if (!getPlayer()?.flightEnabled) setFlightEnabled(true);
      getMotion()?.setFlightVerticalIntent?.(direction);
      button.setPointerCapture?.(event.pointerId);
    };
    const stop = (event) => {
      if (event?.pointerId !== undefined) button.releasePointerCapture?.(event.pointerId);
      getMotion()?.clearFlightVerticalIntent?.(direction);
    };
    button.addEventListener("pointerdown", start);
    button.addEventListener("pointerup", stop);
    button.addEventListener("pointercancel", stop);
    button.addEventListener("pointerleave", stop);
  }

  function bindJoystick() {
    const base = elements?.joystick;
    const knob = elements?.joystickKnob;
    if (!base || !knob) return;
    const update = (event) => {
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const max = rect.width * 0.34;
      const dx = clamp(event.clientX - cx, -max, max);
      const dy = clamp(event.clientY - cy, -max, max);
      getControls()?.setJoystick?.(dx / max, dy / max, true);
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    };
    const release = (event) => {
      if (event.pointerId !== joystickPointerId) return;
      joystickPointerId = null;
      getControls()?.setJoystick?.(0, 0, false);
      knob.style.transform = "translate(-50%, -50%)";
    };
    base.addEventListener("pointerdown", (event) => {
      joystickPointerId = event.pointerId;
      base.setPointerCapture?.(event.pointerId);
      update(event);
    });
    base.addEventListener("pointermove", (event) => {
      if (event.pointerId === joystickPointerId) update(event);
    });
    base.addEventListener("pointerup", release);
    base.addEventListener("pointercancel", release);
  }
}

function isTextInputActive() {
  const tag = document.activeElement?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || document.activeElement?.isContentEditable;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
