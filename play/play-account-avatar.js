import { createAvatarPreviewRenderer } from "/chunk.js/play.js";

const SNAPSHOT_SIZE = 128;
const EMPTY_EQUIPMENT = Object.freeze({ rightHand: "empty" });

export function createAccountAvatarSnapshot({
  element,
  getModelCode = () => "NCM:peasant_guy:v1",
  createPreviewRenderer = createAvatarPreviewRenderer,
  scheduleTask = scheduleIdleTask,
} = {}) {
  let destination = null;
  let source = null;
  let preview = null;
  let currentModelCode = "";
  let queuedModelCode = "";
  let pendingTask = null;
  let disposed = false;

  const resizeObserver = typeof ResizeObserver === "function" && element
    ? new ResizeObserver(() => {
        if (queuedModelCode && isVisible()) schedule();
      })
    : null;
  resizeObserver?.observe(element);

  return { render, dispose };

  function render({ force = false } = {}) {
    if (disposed || !element) return false;
    const modelCode = String(getModelCode() || "NCM:peasant_guy:v1").trim();
    if (!modelCode) return false;
    if (!force && (modelCode === currentModelCode || modelCode === queuedModelCode)) return false;
    queuedModelCode = modelCode;
    if (!isVisible()) return false;
    schedule();
    return true;
  }

  function schedule() {
    if (pendingTask || disposed) return;
    const task = {};
    pendingTask = task;
    task.cancel = scheduleTask(() => {
      if (pendingTask !== task || disposed) return;
      pendingTask = null;
      const modelCode = queuedModelCode;
      queuedModelCode = "";
      capture(modelCode);
    });
  }

  function capture(modelCode) {
    try {
      ensureCanvases();
      element.dataset.avatarState = "loading";
      const rendered = preview?.render({
        modelCode,
        moving: false,
        yaw: Math.PI,
        equipment: EMPTY_EQUIPMENT,
      });
      const context = destination?.getContext("2d");
      if (!rendered || !context || !source) throw new Error("Account avatar renderer is unavailable.");
      context.clearRect(0, 0, destination.width, destination.height);
      context.drawImage(source, 0, 0, destination.width, destination.height);
      currentModelCode = modelCode;
      element.dataset.avatarState = "ready";
    } catch (error) {
      element.dataset.avatarState = "error";
      console.warn("NiceChunk account avatar snapshot unavailable:", error);
    }
    if (queuedModelCode && queuedModelCode !== currentModelCode) schedule();
  }

  function ensureCanvases() {
    if (!destination) {
      destination = document.createElement("canvas");
      destination.width = SNAPSHOT_SIZE;
      destination.height = SNAPSHOT_SIZE;
      destination.className = "account-avatar-canvas";
      destination.dataset.accountAvatarSnapshot = "true";
      element.replaceChildren(destination);
    }
    if (preview) return;
    source = document.createElement("canvas");
    source.width = SNAPSHOT_SIZE;
    source.height = SNAPSHOT_SIZE;
    source.setAttribute("aria-hidden", "true");
    Object.assign(source.style, {
      position: "fixed",
      left: "-10000px",
      top: "0",
      width: `${SNAPSHOT_SIZE}px`,
      height: `${SNAPSHOT_SIZE}px`,
      pointerEvents: "none",
    });
    document.body.append(source);
    preview = createPreviewRenderer(source, {
      maxPixelRatio: 1,
      antialias: true,
      attachIronPickaxe: false,
      equipment: EMPTY_EQUIPMENT,
      projection: "orthographic",
      orthographicPadding: 0.04,
      orthographicZoom: 2.15,
      targetHeightRatio: 0.84,
      eyeHeightRatio: 0.88,
    });
  }

  function isVisible() {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    pendingTask?.cancel?.();
    pendingTask = null;
    resizeObserver?.disconnect();
    preview?.dispose?.();
    preview = null;
    source?.remove();
    source = null;
  }
}

function scheduleIdleTask(callback) {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(callback, { timeout: 750 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(callback, 0);
  return () => clearTimeout(id);
}
