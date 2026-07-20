import { cameraOrigin, cameraViewProjection } from "/chunk.js/renderer/camera.js";

const LOCAL_CHAT_DURATION_MS = 30_000;
const MAX_NAME_CHARS = 22;

export function createNameChatOverlay({
  root = document.body,
  canvas,
  getCamera = () => null,
  getLocalTarget = () => null,
  appendRemoteTargets = () => {},
} = {}) {
  const container = document.createElement("div");
  container.className = "name-chat-overlay";
  container.setAttribute("aria-hidden", "true");
  const nodes = new Map();
  const remoteTargets = [];
  let localChatMessage = "";
  let localChatUntil = 0;
  let mounted = false;

  const api = {
    bind,
    update,
    showLocalChat,
    dispose,
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

    const local = getLocalTarget?.();
    if (local && localChatMessage && now < localChatUntil) {
      renderTarget({
        id: "local",
        name: "",
        chatMessage: localChatMessage,
        chatUntil: localChatUntil,
        x: local.x,
        y: local.y,
        z: local.z,
        heightBlocks: local.heightBlocks,
        local: true,
      }, now, viewProjection, origin, rect, live);
    } else if (now >= localChatUntil) {
      localChatMessage = "";
    }

    remoteTargets.length = 0;
    appendRemoteTargets?.(remoteTargets, now);
    for (const target of remoteTargets) {
      renderTarget(target, now, viewProjection, origin, rect, live);
    }

    for (const [id, node] of nodes) {
      if (live.has(id)) continue;
      detachNode(node);
      nodes.delete(id);
    }
  }

  function renderTarget(target, now, viewProjection, origin, rect, live) {
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.z)) return;
    const height = Number.isFinite(target.heightBlocks) ? target.heightBlocks : 4.38;
    const projected = projectWorldToScreen(
      viewProjection,
      origin,
      target.x,
      target.y + height + (target.local ? 0.72 : 0.52),
      target.z,
      rect,
    );
    if (!projected.visible) return;

    const id = String(target.id || "unknown");
    live.add(id);
    const node = ensureNode(id);
    const name = formatName(target.name || "");
    const hasName = Boolean(name && !target.local);
    const hasChat = Boolean(target.chatMessage && now < (target.chatUntil || 0));
    node.name.hidden = !hasName;
    node.bubble.hidden = !hasChat;
    if (hasName && node.name.textContent !== name) node.name.textContent = name;
    if (hasChat) {
      const text = formatChat(target.chatMessage);
      if (node.bubble.textContent !== text) node.bubble.textContent = text;
    }
    if (!hasName && !hasChat) {
      node.root.hidden = true;
      return;
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
