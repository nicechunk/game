const DEFAULT_VISIBLE_MS = 5000;
const DEFAULT_FADE_MS = 220;
const DEFAULT_MAX_DESKTOP = 5;
const DEFAULT_MAX_MOBILE = 3;
const SUCCESS_REVEAL_MS = 420;
const SUCCESS_CARD_EXIT_MS = 520;
const RESOURCE_FLIGHT_MS = 880;
const RESOURCE_ROTATION_INTERVAL_MS = 72;
const RESOURCE_ROTATION_RADIANS_PER_MS = 0.00155;

export function createPlayChainEventFeed({
  container,
  createVoxelItemIconCanvas = null,
  resourceName = (resourceId) => `Resource ${resourceId}`,
  getBackpackTarget = () => null,
  visibleMs = DEFAULT_VISIBLE_MS,
  fadeMs = DEFAULT_FADE_MS,
  maxDesktop = DEFAULT_MAX_DESKTOP,
  maxMobile = DEFAULT_MAX_MOBILE,
} = {}) {
  const removalTimers = new WeakMap();
  const eventCards = new Map();
  const cardParts = new WeakMap();
  const rotatingVoxelPreviews = new Map();
  let rotationTimer = 0;

  return {
    append,
    clear,
  };

  function append(message, options = {}) {
    if (!container) return null;
    const event = normalizeEvent(message, options, resourceName);
    const existing = event.eventId ? eventCards.get(event.eventId) : null;
    if (existing?.isConnected) {
      updateCard(existing, event);
      return existing;
    }
    if (event.eventId) eventCards.delete(event.eventId);

    const card = document.createElement("article");
    card.className = "chain-event-card";
    card.dataset.kind = event.kind;
    if (event.eventId) card.dataset.eventId = event.eventId;

    const copy = document.createElement("span");
    copy.className = "chain-event-copy";
    const meta = document.createElement("span");
    meta.className = "chain-event-meta";
    const time = document.createElement("time");
    time.dateTime = new Date().toISOString();
    time.textContent = `[${clockTime()}]`;
    const eyebrow = document.createElement("span");
    eyebrow.textContent = event.eyebrow;
    meta.append(time, eyebrow);
    const title = document.createElement("strong");
    copy.append(meta, title);
    card.append(copy);
    cardParts.set(card, {
      copy,
      time,
      eyebrow,
      title,
      detail: null,
      marker: null,
      progress: null,
      resourceIcon: null,
      resourceKey: "",
    });
    applyCardEvent(card, event);

    container.prepend(card);
    if (event.eventId) eventCards.set(event.eventId, card);
    requestAnimationFrame(() => card.classList.add("is-visible"));
    scheduleEventLifecycle(card, event);
    trim();
    return card;
  }

  function updateCard(card, event) {
    cancelRemoval(card);
    card.classList.remove("is-leaving", "is-success-exit");
    applyCardEvent(card, event);
    card.classList.remove("is-state-changing");
    void card.offsetWidth;
    card.classList.add("is-state-changing", "is-visible");
    globalThis.setTimeout(() => card.classList.remove("is-state-changing"), 280);
    scheduleEventLifecycle(card, event);
  }

  function applyCardEvent(card, event) {
    const parts = cardParts.get(card);
    if (!parts) return;
    card.dataset.kind = event.kind;
    card.dataset.state = event.state;
    card.setAttribute("aria-label", event.message);
    card.classList.remove("is-pending", "is-confirmed", "is-error", "is-info", "has-resource");
    card.classList.add(`is-${event.state}`);
    parts.time.dateTime = new Date().toISOString();
    parts.time.textContent = `[${clockTime()}]`;
    parts.eyebrow.textContent = event.eyebrow;
    parts.title.textContent = event.title;
    if (event.detail) {
      if (!parts.detail) {
        parts.detail = document.createElement("small");
        parts.copy.append(parts.detail);
      }
      parts.detail.textContent = event.detail;
    } else if (parts.detail) {
      parts.detail.remove();
      parts.detail = null;
    }

    if (event.resource) {
      card.classList.add("has-resource");
      if (parts.marker) {
        parts.marker.remove();
        parts.marker = null;
      }
      const key = resourceKey(event.resource);
      if (!parts.resourceIcon || parts.resourceKey !== key) {
        stopVoxelCenterRotation(parts.resourceIcon);
        parts.resourceIcon?.remove();
        parts.resourceIcon = createResourceIcon(event.resource);
        parts.resourceKey = key;
        if (parts.resourceIcon) card.append(parts.resourceIcon);
      }
      if (!parts.progress) {
        parts.progress = document.createElement("span");
        parts.progress.className = "chain-event-progress";
        const fill = document.createElement("i");
        parts.progress.append(fill);
        card.append(parts.progress);
      }
      updateResourceProgress(parts.progress, event.state);
    } else {
      stopVoxelCenterRotation(parts.resourceIcon);
      parts.resourceIcon?.remove();
      parts.resourceIcon = null;
      parts.resourceKey = "";
      parts.progress?.remove();
      parts.progress = null;
      if (!parts.marker) {
        parts.marker = document.createElement("span");
        parts.marker.className = "chain-event-marker";
        parts.marker.setAttribute("aria-hidden", "true");
        card.prepend(parts.marker);
      }
      parts.marker.textContent = eventMarker(event.state);
    }
  }

  function createResourceIcon(resource) {
    const icon = document.createElement("span");
    icon.className = "chain-event-resource";
    icon.setAttribute("aria-hidden", "true");
    try {
      const canvas = createVoxelItemIconCanvas?.(resource, { size: 40 });
      if (canvas) {
        canvas.classList.add("chain-event-resource-canvas");
        icon.append(canvas);
        startVoxelCenterRotation(canvas, icon);
      }
    } catch (error) {
      console.warn("Unable to render chain event resource icon", error);
    }
    if (!icon.firstChild) {
      const fallback = document.createElement("span");
      fallback.className = "chain-event-resource-fallback";
      icon.append(fallback);
    }
    return icon;
  }

  function updateResourceProgress(progress, state) {
    if (!progress) return;
    progress.dataset.state = state;
    progress.setAttribute("aria-label", state === "confirmed"
      ? "Submission confirmed"
      : state === "error"
        ? "Submission failed"
        : "Submission in progress");
  }

  function scheduleEventLifecycle(card, event) {
    cancelRemoval(card);
    if (event.holdUntilResolved) return;
    if (event.flyToBackpack && event.resource && event.state === "confirmed") {
      const timer = globalThis.setTimeout(() => beginConfirmedExit(card, event.resource), SUCCESS_REVEAL_MS);
      removalTimers.set(card, timer);
      return;
    }
    scheduleRemoval(card);
  }

  function scheduleRemoval(card) {
    const timer = globalThis.setTimeout(() => {
      card.classList.add("is-leaving");
      const removeTimer = globalThis.setTimeout(() => removeCard(card), fadeMs);
      removalTimers.set(card, removeTimer);
    }, visibleMs);
    removalTimers.set(card, timer);
  }

  function cancelRemoval(card) {
    const timer = removalTimers.get(card);
    if (timer) globalThis.clearTimeout(timer);
    removalTimers.delete(card);
  }

  function beginConfirmedExit(card, resource) {
    if (!card?.isConnected) return;
    const source = cardParts.get(card)?.resourceIcon ?? null;
    if (source) flyResourceToBackpack(source, resource);
    if (prefersReducedMotion()) {
      removeCard(card);
      return;
    }
    card.classList.add("is-success-exit");
    const rect = card.getBoundingClientRect();
    const distance = Math.max(180, globalThis.innerWidth - rect.left + 42);
    const animation = card.animate([
      { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1 },
      { transform: "translate3d(8px, 0, 0) scale(1)", opacity: 1, offset: 0.18 },
      { transform: `translate3d(${distance}px, -3px, 0) scale(0.96)`, opacity: 0 },
    ], {
      duration: SUCCESS_CARD_EXIT_MS,
      easing: "cubic-bezier(.58,.02,.92,.36)",
      fill: "forwards",
    });
    animation.finished.catch(() => {}).finally(() => removeCard(card));
  }

  function trim() {
    const limit = usesMobileLayout() ? maxMobile : maxDesktop;
    while (container.children.length > limit) {
      const card = container.lastElementChild;
      if (!card) break;
      removeCard(card);
    }
  }

  function clear() {
    for (const card of container?.children ?? []) {
      cancelRemoval(card);
    }
    eventCards.clear();
    rotatingVoxelPreviews.clear();
    if (rotationTimer) globalThis.clearTimeout(rotationTimer);
    rotationTimer = 0;
    container?.replaceChildren();
  }

  function removeCard(card) {
    cancelRemoval(card);
    stopVoxelCenterRotation(cardParts.get(card)?.resourceIcon);
    const eventId = card?.dataset?.eventId || "";
    if (eventId && eventCards.get(eventId) === card) eventCards.delete(eventId);
    card?.remove();
  }

  function flyResourceToBackpack(source, resource) {
    const target = getBackpackTarget?.();
    if (!target?.isConnected || !source?.isConnected) return;
    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (!sourceRect.width || !targetRect.width) return;

    source.classList.add("is-departing");
    if (prefersReducedMotion()) {
      pulseBackpackTarget(target);
      return;
    }

    const size = Math.max(30, Math.min(44, sourceRect.width));
    const startX = sourceRect.left + sourceRect.width * 0.5 - size * 0.5;
    const startY = sourceRect.top + sourceRect.height * 0.5 - size * 0.5;
    const endX = targetRect.left + targetRect.width * 0.5 - size * 0.5;
    const endY = targetRect.top + targetRect.height * 0.5 - size * 0.5;
    const dx = endX - startX;
    const dy = endY - startY;
    const arc = Math.max(34, Math.min(92, Math.abs(dx) * 0.10 + Math.abs(dy) * 0.08));

    const flyer = document.createElement("span");
    flyer.className = "chain-event-resource-flyer";
    flyer.style.left = `${startX}px`;
    flyer.style.top = `${startY}px`;
    flyer.style.width = `${size}px`;
    flyer.style.height = `${size}px`;
    flyer.setAttribute("aria-hidden", "true");
    const sourceCanvas = source.querySelector("canvas");
    const canvas = copyCanvas(sourceCanvas, resource);
    if (canvas) flyer.append(canvas);
    document.body.append(flyer);
    if (canvas) startVoxelCenterRotation(canvas, flyer, Math.PI * 0.35);

    const animation = flyer.animate([
      { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1 },
      { transform: `translate3d(${dx * 0.12}px, ${dy * 0.08 - arc * 0.56}px, 0) scale(1.12)`, opacity: 1, offset: 0.20 },
      { transform: `translate3d(${dx * 0.55}px, ${dy * 0.43 - arc}px, 0) scale(0.88)`, opacity: 1, offset: 0.56 },
      { transform: `translate3d(${dx * 0.88}px, ${dy * 0.80 - arc * 0.32}px, 0) scale(0.48)`, opacity: 0.92, offset: 0.84 },
      { transform: `translate3d(${dx}px, ${dy}px, 0) scale(0.10)`, opacity: 0 },
    ], {
      duration: RESOURCE_FLIGHT_MS,
      easing: "cubic-bezier(.16,.76,.18,1)",
      fill: "forwards",
    });
    globalThis.setTimeout(() => {
      const latestTarget = getBackpackTarget?.();
      pulseBackpackTarget(latestTarget?.isConnected ? latestTarget : target);
    }, Math.round(RESOURCE_FLIGHT_MS * 0.76));
    animation.finished.catch(() => {}).finally(() => {
      stopVoxelCenterRotation(flyer);
      flyer.remove();
    });
  }

  function resourceKey(resource) {
    return `${resource.blockId}:${resource.resourceId}`;
  }

  function copyCanvas(sourceCanvas, resource) {
    try {
      const rendered = createVoxelItemIconCanvas?.(resource, { size: Math.max(24, sourceCanvas?.width || 40) });
      if (rendered) return rendered;
      if (sourceCanvas instanceof HTMLCanvasElement) {
        const canvas = document.createElement("canvas");
        canvas.width = sourceCanvas.width;
        canvas.height = sourceCanvas.height;
        canvas.getContext("2d")?.drawImage(sourceCanvas, 0, 0);
        return canvas;
      }
      return null;
    } catch {
      return null;
    }
  }

  function pulseBackpackTarget(target) {
    target.animate?.([
      { filter: "brightness(1)", transform: "scale(1)" },
      { filter: "brightness(1.34)", transform: "scale(1.08)", offset: 0.48 },
      { filter: "brightness(1)", transform: "scale(1)" },
    ], { duration: 560, easing: "ease-out" });
  }

  function startVoxelCenterRotation(canvas, owner, phase = 0) {
    if (prefersReducedMotion() || typeof canvas?.renderVoxelYaw !== "function" || !owner) return;
    rotatingVoxelPreviews.set(owner, { canvas, phase });
    scheduleVoxelRotation();
  }

  function stopVoxelCenterRotation(owner) {
    if (owner) rotatingVoxelPreviews.delete(owner);
  }

  function scheduleVoxelRotation() {
    if (rotationTimer || !rotatingVoxelPreviews.size) return;
    rotationTimer = globalThis.setTimeout(() => {
      rotationTimer = 0;
      requestAnimationFrame(renderRotatingVoxels);
    }, RESOURCE_ROTATION_INTERVAL_MS);
  }

  function renderRotatingVoxels(now) {
    for (const [owner, preview] of rotatingVoxelPreviews) {
      if (!owner?.isConnected) {
        rotatingVoxelPreviews.delete(owner);
        continue;
      }
      preview.canvas.renderVoxelYaw(now * RESOURCE_ROTATION_RADIANS_PER_MS + preview.phase);
    }
    scheduleVoxelRotation();
  }
}

function normalizeEvent(message, options, resourceName) {
  const text = String(message || "").trim() || "Chain event";
  const resource = normalizeResource(options.resource);
  const state = normalizeState(options.state, text);
  const kind = String(options.kind || (resource ? "mining" : "system"));
  const name = resource ? safeResourceName(resourceName, resource.resourceId) : "";
  const count = resource?.count > 1 ? ` ×${resource.count}` : "";
  return {
    message: text,
    title: String(options.title || (resource ? `${name}${count}` : text)),
    detail: String(options.detail || ""),
    eyebrow: String(options.eyebrow || eventEyebrow(kind, state)),
    eventId: String(options.eventId || ""),
    state,
    kind,
    resource,
    flyToBackpack: Boolean(options.flyToBackpack),
    holdUntilResolved: options.holdUntilResolved ?? (kind === "mining" && state === "pending"),
  };
}

function normalizeResource(resource) {
  if (!resource) return null;
  const blockId = Math.trunc(Number(resource.blockId));
  const resourceId = Math.trunc(Number(resource.resourceId));
  if (!Number.isFinite(blockId) || blockId <= 0 || !Number.isFinite(resourceId)) return null;
  return {
    kind: "resource",
    itemId: "resource_block",
    blockId,
    resourceId,
    count: Math.max(1, Math.trunc(Number(resource.count) || 1)),
  };
}

function normalizeState(state, message) {
  const requested = String(state || "").toLowerCase();
  if (["pending", "confirmed", "error", "info"].includes(requested)) return requested;
  const text = String(message || "").toLowerCase();
  if (/failed|error|rejected|rollback|rolled back/.test(text)) return "error";
  if (/confirmed|connected|saved|created/.test(text)) return "confirmed";
  if (/pending|submitting|queued|awaiting/.test(text)) return "pending";
  return "info";
}

function eventEyebrow(kind, state) {
  if (kind === "mining") return state === "confirmed" ? "ON CHAIN" : state === "error" ? "MINING FAILED" : "MINING";
  if (state === "confirmed") return "CONFIRMED";
  if (state === "pending") return "PENDING";
  if (state === "error") return "ACTION FAILED";
  return "SYSTEM";
}

function eventMarker(state) {
  if (state === "confirmed") return "✓";
  if (state === "pending") return "↗";
  if (state === "error") return "!";
  return "✦";
}

function safeResourceName(resourceName, resourceId) {
  try {
    return String(resourceName?.(resourceId) || `Resource ${resourceId}`);
  } catch {
    return `Resource ${resourceId}`;
  }
}

function clockTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function usesMobileLayout() {
  return Boolean(globalThis.matchMedia?.("(pointer: coarse), (max-width: 760px)")?.matches);
}

function prefersReducedMotion() {
  return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}
