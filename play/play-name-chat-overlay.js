import { cameraOrigin, cameraViewProjection } from "/chunk.js/renderer/camera.js";

const LOCAL_CHAT_DURATION_MS = 30_000;
const MAX_NAME_CHARS = 22;

export function createNameChatOverlay({
  root = document.body,
  canvas,
  getCamera = () => null,
  getLocalTarget = () => null,
  appendRemoteTargets = () => {},
  isBlockedAt = null,
  getMaxDistance = () => 128,
  occlusion = {},
} = {}) {
  const container = document.createElement("div");
  container.className = "name-chat-overlay";
  container.setAttribute("aria-hidden", "true");
  const nodes = new Map();
  const visibility = createOverlayOcclusion({ isBlockedAt, ...occlusion });
  const remoteTargets = [];
  let localChatMessage = "";
  let localChatUntil = 0;
  let mounted = false;

  const api = {
    bind,
    update,
    showLocalChat,
    dispose,
    visibilityStats: () => visibility.stats(),
  };
  return api;

  function bind() {
    if (mounted) return api;
    (root || document.body).appendChild(container);
    mounted = true;
    return api;
  }

  function update(now = performance.now()) {
    if (!mounted) bind();
    const camera = getCamera?.();
    if (!camera || !canvas) return;
    const rect = canvas.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) return;
    const viewProjection = cameraViewProjection(camera);
    const origin = cameraOrigin(camera);
    const live = new Set();
    const plans = [];
    const eye = { x: origin.worldX + (camera.localOffsetX || 0),
      y: origin.worldY + (camera.localOffsetY || 0), z: origin.worldZ + (camera.localOffsetZ || 0) };
    const maxDistance = Math.max(1, Number(getMaxDistance?.()) || 128);
    const local = getLocalTarget?.();
    if (local && localChatMessage && now < localChatUntil) {
      prepareTarget({ ...local, id: "local", name: "", chatMessage: localChatMessage, chatUntil: localChatUntil, local: true });
    } else if (now >= localChatUntil) localChatMessage = "";
    remoteTargets.length = 0;
    appendRemoteTargets?.(remoteTargets, now);
    for (const target of remoteTargets) prepareTarget(target);
    // Projection and bounded terrain queries precede all DOM writes. One canvas
    // rect read serves the whole frame; raycasts are time cached and budgeted.
    visibility.evaluate(plans, eye, now);
    for (const plan of plans) {
      if (plan.occluded) continue;
      live.add(plan.id);
      renderPlan(plan);
    }
    for (const [id, node] of nodes) {
      if (live.has(id)) continue;
      detachNode(node);
      nodes.delete(id);
    }

    function prepareTarget(target) {
      if (!target || ![target.x, target.y, target.z].every(Number.isFinite)) return;
      const height = Number.isFinite(target.heightBlocks) ? target.heightBlocks : 4.38;
      if (Math.hypot(target.x - eye.x, target.y + height * 0.75 - eye.y, target.z - eye.z) > maxDistance) return;
      const projected = projectWorldToScreen(viewProjection, origin,
        target.x, target.y + height + (target.local ? 0.72 : 0.52), target.z, rect);
      if (!projected.visible) return;
      const name = formatName(target.name || "");
      const hasName = Boolean(name && !target.local);
      const hasChat = Boolean(target.chatMessage && now < (target.chatUntil || 0));
      if (!hasName && !hasChat) return;
      plans.push({ id: String(target.id || "unknown"), target, name, hasName, hasChat, projected,
        x: target.x, y: target.y + Math.max(0, height - 0.3), z: target.z });
    }
  }

  function renderPlan({ id, target, name, hasName, hasChat, projected }) {
    const node = ensureNode(id);
    node.name.hidden = !hasName;
    node.bubble.hidden = !hasChat;
    if (hasName && node.name.textContent !== name) node.name.textContent = name;
    if (hasChat) {
      const text = formatChat(target.chatMessage);
      if (node.bubble.textContent !== text) node.bubble.textContent = text;
    }
    const scale = Math.max(0.68, Math.min(1.08, 21 / Math.max(14, projected.depth)));
    node.root.hidden = false;
    node.root.style.transform = `translate3d(${projected.x}px, ${projected.y}px, 0) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
    node.root.style.opacity = String(projected.opacity.toFixed(3));
  }

  function ensureNode(id) {
    let node = nodes.get(id);
    if (node) return node;
    const rootNode = document.createElement("div");
    rootNode.className = "name-chat-target";
    const bubble = document.createElement("div");
    bubble.className = "name-chat-bubble";
    bubble.hidden = true;
    const name = document.createElement("div");
    name.className = "name-chat-name";
    name.hidden = true;
    rootNode.append(bubble, name);
    container.appendChild(rootNode);
    node = { root: rootNode, bubble, name };
    nodes.set(id, node);
    return node;
  }

  function showLocalChat(message, now = performance.now()) {
    const text = normalizeMessage(message);
    if (!text) return false;
    localChatMessage = text;
    localChatUntil = now + LOCAL_CHAT_DURATION_MS;
    return true;
  }

  function dispose() {
    for (const node of nodes.values()) detachNode(node);
    nodes.clear();
    visibility.clear();
    container.remove();
    mounted = false;
  }

  function detachNode(node) {
    const rootNode = node?.root;
    if (!rootNode) return;
    if (typeof rootNode.remove === "function") {
      rootNode.remove();
      return;
    }
    rootNode.parentNode?.removeChild?.(rootNode);
  }
}

export function projectWorldToScreen(viewProjection, origin, worldX, worldY, worldZ, rect) {
  const x = worldX - origin.worldX;
  const y = worldY - origin.worldY;
  const z = worldZ - origin.worldZ;
  const clipX = viewProjection[0] * x + viewProjection[4] * y + viewProjection[8] * z + viewProjection[12];
  const clipY = viewProjection[1] * x + viewProjection[5] * y + viewProjection[9] * z + viewProjection[13];
  const clipZ = viewProjection[2] * x + viewProjection[6] * y + viewProjection[10] * z + viewProjection[14];
  const clipW = viewProjection[3] * x + viewProjection[7] * y + viewProjection[11] * z + viewProjection[15];
  if (clipW <= 0.0001) return { visible: false, x: 0, y: 0, depth: 0, opacity: 0 };
  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;
  const ndcZ = clipZ / clipW;
  const margin = 0.12;
  if (ndcZ < -1 || ndcZ > 1 || ndcX < -1 - margin || ndcX > 1 + margin || ndcY < -1 - margin || ndcY > 1 + margin) {
    return { visible: false, x: 0, y: 0, depth: clipW, opacity: 0 };
  }
  const edgeFade = Math.max(Math.abs(ndcX), Math.abs(ndcY));
  const opacity = 1 - Math.max(0, edgeFade - 0.86) / 0.26;
  return {
    visible: true,
    x: (ndcX * 0.5 + 0.5) * rect.width,
    y: (1 - (ndcY * 0.5 + 0.5)) * rect.height,
    depth: clipW,
    opacity: Math.max(0.18, Math.min(1, opacity)),
  };
}

function normalizeMessage(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function formatChat(value) {
  return normalizeMessage(value);
}

function formatName(value) {
  const raw = String(value || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const chars = Array.from(raw);
  if (chars.length <= MAX_NAME_CHARS) return chars.join("");
  const headLength = Math.max(6, Math.floor((MAX_NAME_CHARS - 3) / 2));
  const tailLength = Math.max(4, MAX_NAME_CHARS - 3 - headLength);
  return `${chars.slice(0, headLength).join("")}...${chars.slice(-tailLength).join("")}`;
}

/** Explicit product policy: 'solid' hides both labels; 'none' permits through walls. */
export function createOverlayOcclusion({
  isBlockedAt = null, mode = "solid", intervalMs = 150, maxChecksPerUpdate = 8,
} = {}) {
  const cache = new Map();
  const interval = Math.max(16, Number(intervalMs) || 150);
  const budget = Math.max(1, Math.trunc(Number(maxChecksPerUpdate) || 8));
  const snapshot = { mode, checks: 0, totalChecks: 0, deferred: 0, targets: 0 };
  return {
    evaluate(targets, eye, now) {
      snapshot.checks = 0; snapshot.deferred = 0; snapshot.targets = targets.length;
      const live = new Set(targets.map((target) => target.id));
      for (const id of cache.keys()) if (!live.has(id)) cache.delete(id);
      if (mode === "none" || typeof isBlockedAt !== "function") {
        for (const target of targets) target.occluded = false;
        return;
      }
      const due = [];
      for (const target of targets) {
        let prior = cache.get(target.id);
        if (!prior) {
          prior = { checkedAt: -Infinity, occluded: true };
          cache.set(target.id, prior);
        }
        const distance = Math.hypot(target.x - eye.x, target.y - eye.y, target.z - eye.z);
        if (now - prior.checkedAt >= interval) due.push({ target, prior, distance });
        target.occluded = prior.occluded || now - prior.checkedAt > interval * 4;
      }
      // Oldest first prevents a crowd of nearby players starving distant labels.
      // Equal-age/new targets use distance so the near field becomes visible first.
      due.sort((a, b) => a.prior.checkedAt - b.prior.checkedAt || a.distance - b.distance);
      for (const { target, prior } of due) {
        if (snapshot.checks >= budget) { snapshot.deferred += 1; continue; }
        prior.occluded = traceOverlayOcclusion(eye.x, eye.y, eye.z, target.x, target.y, target.z, isBlockedAt);
        prior.checkedAt = now;
        target.occluded = prior.occluded;
        snapshot.checks += 1; snapshot.totalChecks += 1;
      }
    },
    stats: () => ({ ...snapshot, cached: cache.size }),
    clear: () => cache.clear(),
  };
}

export function traceOverlayOcclusion(x, y, z, tx, ty, tz, blocked) {
  const dx = tx - x, dy = ty - y, dz = tz - z;
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-6) return false;
  const ux = dx / length, uy = dy / length, uz = dz / length;
  let bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  const sx = Math.sign(ux), sy = Math.sign(uy), sz = Math.sign(uz);
  const ddx = sx ? Math.abs(1 / ux) : Infinity, ddy = sy ? Math.abs(1 / uy) : Infinity, ddz = sz ? Math.abs(1 / uz) : Infinity;
  let nx = sx > 0 ? (bx + 1 - x) / ux : sx < 0 ? (bx - x) / ux : Infinity;
  let ny = sy > 0 ? (by + 1 - y) / uy : sy < 0 ? (by - y) / uy : Infinity;
  let nz = sz > 0 ? (bz + 1 - z) / uz : sz < 0 ? (bz - z) / uz : Infinity;
  let travelled = 0;
  const limit = Math.ceil(length * (Math.abs(ux) + Math.abs(uy) + Math.abs(uz))) + 4;
  for (let step = 0; step < limit && travelled < length - 0.001; step += 1) {
    if (blocked(bx, by, bz)) return true;
    if (nx <= ny && nx <= nz) { bx += sx; travelled = nx; nx += ddx; }
    else if (ny <= nz) { by += sy; travelled = ny; ny += ddy; }
    else { bz += sz; travelled = nz; nz += ddz; }
  }
  return false;
}
