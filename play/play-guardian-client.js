export const DEFAULT_NICECHUNK_GUARDIAN_URL = "";
const LEGACY_NICECHUNK_GUARDIAN_URLS = new Set([
  "wss://nicechunk.com/guardian-ws",
]);
const LEGACY_IPV4_GUARDIAN_URL_PATTERN = /^wss?:\/\/(?:guardian\.)?(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\.sslip\.io)?\/ws$/;

const MSG_HELLO = 0x01;
const MSG_HELLO_ACK = 0x02;
const MSG_ERROR = 0x03;
const MSG_PING = 0x04;
const MSG_PONG = 0x05;
const MSG_MOVE = 0x10;
const MSG_MOVE_BATCH = 0x11;
const MSG_DIG = 0x20;
const MSG_DIG_EVENT = 0x21;
const MSG_DIG_BATCH = 0x22;
const MSG_DIG_EVENT_BATCH = 0x23;
const MSG_PLAYER_JOIN = 0x30;
const MSG_PLAYER_LEAVE = 0x31;
const MSG_CHAT = 0x40;
const MSG_CHAT_EVENT = 0x41;
const MSG_EQUIPMENT = 0x42;
const MSG_EQUIPMENT_EVENT = 0x43;
const MSG_PLAYER_IDENTITY = 0x44;
const MSG_PLAYER_IDENTITY_EVENT = 0x45;
const MSG_BUILDING_REGION_DIGEST = 0x50;
const MSG_BUILDING_MANIFEST_REQUEST = 0x51;
const MSG_BUILDING_MANIFEST_PAGE = 0x52;
const MSG_BUILDING_ANNOUNCE = 0x53;

const PROTOCOL_VERSION = 1;
const SERVER_FLAG_EQUIPMENT_SYNC = 1 << 0;
const SERVER_FLAG_DIG_BATCH = 1 << 1;
const SERVER_FLAG_BUILDING_MANIFEST = 1 << 2;
const CHUNK_INDEX_MODE_U8 = 1;
const HELLO_SIZE = 52;
const HELLO_ACK_SIZE = 20;
const MOVE_SIZE = 13;
const MOVE_ITEM_SIZE = 12;
const DIG_SIZE = 11;
const DIG_EVENT_SIZE = 14;
const DIG_BATCH_HEADER_SIZE = 2;
const DIG_BATCH_ITEM_SIZE = 10;
const DIG_EVENT_BATCH_HEADER_SIZE = 6;
const DIG_EVENT_BATCH_ITEM_SIZE = 9;
const PLAYER_JOIN_SIZE = 57;
const PLAYER_JOIN_V2_SIZE = 25;
const PLAYER_JOIN_V1_SIZE = 17;
const LEGACY_PLAYER_JOIN_SIZE = 13;
const PLAYER_LEAVE_SIZE = 48;
const PLAYER_LEAVE_V2_SIZE = 16;
const PLAYER_LEAVE_V1_SIZE = 8;
const LEGACY_PLAYER_LEAVE_SIZE = 4;
const CHAT_HEADER_SIZE = 4;
const CHAT_EVENT_HEADER_SIZE = 6;
const MAX_CHAT_BYTES = 120;
const EQUIPMENT_HEADER_SIZE = 12;
const EQUIPMENT_EVENT_HEADER_SIZE = 14;
export const GUARDIAN_EQUIPMENT_MAX_PAYLOAD_BYTES = 2048;
const PLAYER_IDENTITY_HEADER_SIZE = 2;
const PLAYER_IDENTITY_EVENT_HEADER_SIZE = 36;
const MAX_PLAYER_IDENTITY_NAME_BYTES = 64;
const LEGACY_BUILDING_RECORD_SIZE = 48;
const BUILDING_RECORD_SIZE = 56;
const BUILDING_REGION_DIGEST_SIZE = 38;
const BUILDING_MANIFEST_REQUEST_SIZE = 9;
const BUILDING_MANIFEST_PAGE_HEADER_SIZE = 44;
const BUILDING_ANNOUNCE_SIZE = 1 + BUILDING_RECORD_SIZE;
const BUILDING_MANIFEST_MAX_PAGE_RECORDS = 128;
const DEFAULT_SERVICE_RADIUS_CHUNKS = 100;
const DEFAULT_GUARDIAN_CENTER_CHUNK_X = 0;
const DEFAULT_GUARDIAN_CENTER_CHUNK_Z = 0;
const DEFAULT_POSITION_PRECISION = 64;
const DEFAULT_MOVE_HZ = 20;
const DEFAULT_MAX_FAILED_RECONNECTS = 4;
const DEFAULT_RECONNECT_JITTER_MS = 350;
const guardianSessionSpawnStorageKey = "nicechunk.guardian.spawnedSession";
const guardianUrlStorageKey = "nicechunk.guardian.url";
const chatTextEncoder = new TextEncoder();
const chatTextDecoder = new TextDecoder();
const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const base58Lookup = new Map([...base58Alphabet].map((char, index) => [char, index]));

export function resolveNiceChunkGuardianUrl(defaultUrl = DEFAULT_NICECHUNK_GUARDIAN_URL) {
  const storedUrl = safeLocalStorageGet(guardianUrlStorageKey);
  if (storedUrl && isLegacyNiceChunkGuardianUrl(storedUrl)) safeLocalStorageSet(guardianUrlStorageKey, "");
  return String(defaultUrl || "").trim();
}

function isLegacyNiceChunkGuardianUrl(url) {
  return LEGACY_NICECHUNK_GUARDIAN_URLS.has(url) || LEGACY_IPV4_GUARDIAN_URL_PATTERN.test(url);
}

export function shouldUseGuardianSpawnForSession(session) {
  if (localStorage.getItem("nicechunk.guardian.spawn") === "0") return false;
  const sessionId = guardianSessionId(session);
  return Boolean(sessionId && localStorage.getItem(guardianSessionSpawnStorageKey) !== sessionId);
}

export function markGuardianSpawnForSession(session) {
  const sessionId = guardianSessionId(session);
  if (sessionId) localStorage.setItem(guardianSessionSpawnStorageKey, sessionId);
}

export function getNiceChunkGuardianSpawnState({
  chunkSize,
  surfaceHeight,
  centerChunkX = DEFAULT_GUARDIAN_CENTER_CHUNK_X,
  centerChunkZ = DEFAULT_GUARDIAN_CENTER_CHUNK_Z,
} = {}) {
  const x = centerChunkX * chunkSize;
  const z = centerChunkZ * chunkSize;
  const y = surfaceHeight(x, z) + 1.01;
  return {
    position: { x, y, z },
    yaw: Math.PI * 0.25,
    cameraPitch: -0.42,
  };
}

export function createNiceChunkGuardianClient(options = {}) {
  return new NiceChunkGuardianClient(options);
}

class NiceChunkGuardianClient {
  constructor(options = {}) {
    this.url = options.url || resolveNiceChunkGuardianUrl();
    this.chunkSize = options.chunkSize || 16;
    this.positionPrecision = options.positionPrecision || DEFAULT_POSITION_PRECISION;
    this.moveIntervalMs = 1000 / (options.moveHz || DEFAULT_MOVE_HZ);
    this.centerChunkX = options.centerChunkX ?? DEFAULT_GUARDIAN_CENTER_CHUNK_X;
    this.centerChunkZ = options.centerChunkZ ?? DEFAULT_GUARDIAN_CENTER_CHUNK_Z;
    this.serviceRadiusChunks = options.serviceRadiusChunks ?? DEFAULT_SERVICE_RADIUS_CHUNKS;
    this.identityHint = options.walletAddress || "";
    this.onReady = options.onReady || (() => {});
    this.onClose = options.onClose || (() => {});
    this.onError = options.onError || (() => {});
    this.onPlayerJoin = options.onPlayerJoin || (() => {});
    this.onPlayerMove = options.onPlayerMove || (() => {});
    this.onPlayerLeave = options.onPlayerLeave || (() => {});
    this.onDig = options.onDig || (() => {});
    this.onChat = options.onChat || (() => {});
    this.onEquipment = options.onEquipment || (() => {});
    this.onPlayerIdentity = options.onPlayerIdentity || (() => {});
    this.onBuildingRegionDigest = options.onBuildingRegionDigest || (() => {});
    this.onBuildingManifest = options.onBuildingManifest || (() => {});
    this.onProtocolError = options.onProtocolError || (() => {});
    this.onOffline = options.onOffline || (() => {});
    this.onReconnectScheduled = options.onReconnectScheduled || (() => {});
    this.autoReconnect = options.autoReconnect !== false;
    this.reconnectDelayMs = 1000;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs || 12000;
    this.maxFailedReconnects = options.maxFailedReconnects ?? DEFAULT_MAX_FAILED_RECONNECTS;
    this.reconnectJitterMs = options.reconnectJitterMs ?? DEFAULT_RECONNECT_JITTER_MS;
    this.socket = null;
    this.ready = false;
    this.closedByClient = false;
    this.consecutiveFailedReconnects = 0;
    this.connectedOnceForCurrentSocket = false;
    this.localPlayerId = 0;
    this.serverTick = 0;
    this.clientTick = 0;
    this.digSeq = 0;
    this.chatSeq = 0;
    this.equipmentSeq = 0;
    this.identityName = options.playerName || "";
    this.lastMoveSentAt = 0;
    this.lastMovePoseKey = "";
    this.supportsEquipmentSync = false;
    this.supportsDigBatch = false;
    this.supportsBuildingManifest = false;
    this.buildingManifestPages = new Map();
    this.reconnectTimer = null;
  }

  connect({ position } = {}) {
    if (!this.url) {
      this.onProtocolError({ code: 4, reason: "guardian-url-unavailable" });
      return;
    }
    if (!this.identityHint) {
      this.onProtocolError({ code: 2 });
      return;
    }
    this.closedByClient = false;
    window.clearTimeout(this.reconnectTimer);
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;

    const socket = new WebSocket(this.url);
    this.socket = socket;
    this.connectedOnceForCurrentSocket = false;
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => {
      this.reconnectDelayMs = 1000;
      this.consecutiveFailedReconnects = 0;
      this.connectedOnceForCurrentSocket = true;
      socket.send(this.encodeHello(position));
    });
    socket.addEventListener("message", (event) => this.handleSocketMessage(event.data));
    socket.addEventListener("error", (event) => this.onError(event));
    socket.addEventListener("close", (event) => {
      if (socket !== this.socket) return;
      this.ready = false;
      this.socket = null;
      this.localPlayerId = 0;
      this.lastMovePoseKey = "";
      this.supportsEquipmentSync = false;
      this.supportsDigBatch = false;
      this.supportsBuildingManifest = false;
      this.buildingManifestPages.clear();
      this.onClose(event);
      if (!this.closedByClient && !this.connectedOnceForCurrentSocket) this.consecutiveFailedReconnects += 1;
      if (this.autoReconnect && !this.closedByClient) this.scheduleReconnect(position, event);
    });
  }

  reconnectTo(url, { position } = {}) {
    if (!url || url === this.url) {
      this.connect({ position });
      return false;
    }
    const previousSocket = this.socket;
    this.closedByClient = true;
    this.socket = null;
    this.ready = false;
    this.localPlayerId = 0;
    this.lastMovePoseKey = "";
    this.supportsEquipmentSync = false;
    this.supportsDigBatch = false;
    this.supportsBuildingManifest = false;
    this.buildingManifestPages.clear();
    this.consecutiveFailedReconnects = 0;
    this.connectedOnceForCurrentSocket = false;
    if (previousSocket && previousSocket.readyState <= WebSocket.OPEN) previousSocket.close();
    this.url = url;
    this.closedByClient = false;
    this.connect({ position });
    return true;
  }

  getUrl() {
    return this.url;
  }

  disconnect() {
    this.closedByClient = true;
    window.clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
    this.ready = false;
    this.lastMovePoseKey = "";
    this.supportsEquipmentSync = false;
    this.supportsDigBatch = false;
    this.supportsBuildingManifest = false;
    this.buildingManifestPages.clear();
  }

  updateLocalPlayer({ x, y, z, yaw = 0, pitch = 0 }, now = performance.now()) {
    if (!this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (now - this.lastMoveSentAt < this.moveIntervalMs) return;

    const poseKey = this.encodeMovePoseKey({ x, y, z, yaw, pitch });
    if (poseKey === this.lastMovePoseKey) return;

    const move = this.encodeMove({ x, y, z, yaw, pitch });
    this.lastMovePoseKey = poseKey;
    this.lastMoveSentAt = now;
    this.socket.send(move.buffer);
  }

  sendDig({ x, y, z, action = 1, toolHint = 0 }) {
    if (!this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    const packet = this.encodeDig({ x, y, z, action, toolHint });
    this.socket.send(packet.buffer);
    return true;
  }

  sendDigBatch(blocks, { action = 1, toolHint = 0 } = {}) {
    const normalized = Array.isArray(blocks) ? blocks.filter(Boolean) : [];
    if (!normalized.length || !this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    if (!this.supportsDigBatch) {
      normalized.forEach((block) => this.sendDig({ ...block, action, toolHint }));
      return true;
    }
    for (let offset = 0; offset < normalized.length; offset += 255) {
      const packet = this.encodeDigBatch(normalized.slice(offset, offset + 255), { action, toolHint });
      if (packet) this.socket.send(packet.buffer);
    }
    return true;
  }

  sendChat(message) {
    if (!this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    const packet = this.encodeChat(message);
    if (!packet) return false;
    this.socket.send(packet.buffer);
    return true;
  }

  sendEquipment(equipment = {}) {
    if (!this.ready || !this.supportsEquipmentSync || !this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    const packet = this.encodeEquipment(equipment);
    if (!packet) return false;
    this.socket.send(packet.buffer);
    return true;
  }

  sendPlayerIdentity(name = this.identityName) {
    if (!this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.identityName = name || "";
    const packet = this.encodePlayerIdentity(this.identityName);
    if (!packet) return false;
    this.socket.send(packet.buffer);
    return true;
  }

  requestBuildingManifest(knownRevision = 0) {
    if (!this.ready || !this.supportsBuildingManifest || !this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    const bytes = new Uint8Array(BUILDING_MANIFEST_REQUEST_SIZE);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, MSG_BUILDING_MANIFEST_REQUEST);
    writeU64(view, 1, knownRevision);
    this.socket.send(bytes.buffer);
    return true;
  }

  announceBuilding(record = {}) {
    if (!this.ready || !this.supportsBuildingManifest || !this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    const bytes = new Uint8Array(BUILDING_ANNOUNCE_SIZE);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, MSG_BUILDING_ANNOUNCE);
    writeBuildingRecord(bytes, view, 1, record);
    this.socket.send(bytes.buffer);
    return true;
  }

  getLocalPlayerId() {
    return this.localPlayerId;
  }

  isReady() {
    return this.ready;
  }

  scheduleReconnect(position, closeEvent = null) {
    if (this.maxFailedReconnects > 0 && this.consecutiveFailedReconnects >= this.maxFailedReconnects) {
      this.onOffline({
        url: this.url,
        attempts: this.consecutiveFailedReconnects,
        code: closeEvent?.code ?? 0,
        reason: closeEvent?.reason || "",
      });
      return;
    }
    const jitter = this.reconnectJitterMs > 0 ? Math.floor(Math.random() * this.reconnectJitterMs) : 0;
    const delay = this.reconnectDelayMs + jitter;
    this.reconnectDelayMs = Math.min(this.maxReconnectDelayMs, Math.round(this.reconnectDelayMs * 1.75));
    this.onReconnectScheduled({
      url: this.url,
      delayMs: delay,
      attempts: this.consecutiveFailedReconnects,
      nextDelayMs: this.reconnectDelayMs,
    });
    this.reconnectTimer = window.setTimeout(() => this.connect({ position }), delay);
  }

  async handleSocketMessage(data) {
    const buffer = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
    const view = new DataView(buffer);
    if (view.byteLength < 1) return;

    switch (view.getUint8(0)) {
      case MSG_HELLO_ACK:
        this.decodeHelloAck(view);
        break;
      case MSG_PING:
        this.sendPong();
        break;
      case MSG_ERROR:
        this.onProtocolError(this.decodeError(view));
        break;
      case MSG_MOVE_BATCH:
        this.decodeMoveBatch(view);
        break;
      case MSG_DIG_EVENT:
        this.decodeDigEvent(view);
        break;
      case MSG_DIG_EVENT_BATCH:
        this.decodeDigEventBatch(view);
        break;
      case MSG_PLAYER_JOIN:
        this.decodePlayerJoin(view);
        break;
      case MSG_PLAYER_LEAVE:
        this.decodePlayerLeave(view);
        break;
      case MSG_CHAT_EVENT:
        this.decodeChatEvent(view);
        break;
      case MSG_EQUIPMENT_EVENT:
        this.decodeEquipmentEvent(view);
        break;
      case MSG_PLAYER_IDENTITY_EVENT:
        this.decodePlayerIdentityEvent(view);
        break;
      case MSG_BUILDING_REGION_DIGEST:
        this.decodeBuildingRegionDigest(view);
        break;
      case MSG_BUILDING_MANIFEST_PAGE:
        await this.decodeBuildingManifestPage(view);
        break;
      default:
        this.onProtocolError({ code: 1 });
        break;
    }
  }

  encodeHello(position) {
    const chunk = this.worldToChunk(position?.x ?? 0, position?.z ?? 0);
    const bytes = new Uint8Array(HELLO_SIZE);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, MSG_HELLO);
    view.setUint8(1, PROTOCOL_VERSION);
    view.setUint16(2, 0, true);
    this.writeWalletHint(bytes, 4);
    view.setInt32(36, chunk.x, true);
    view.setInt32(40, chunk.z, true);
    const nonce = randomNonceWords();
    view.setUint32(44, nonce.low, true);
    view.setUint32(48, nonce.high, true);
    return bytes.buffer;
  }

  encodeMove({ x, y, z, yaw, pitch }) {
    const chunk = this.worldToChunk(x, z);
    const local = this.globalToLocalChunk(chunk.x, chunk.z);
    const offsetX = x - chunk.x * this.chunkSize;
    const offsetZ = z - chunk.z * this.chunkSize;
    const bytes = new Uint8Array(MOVE_SIZE);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, MSG_MOVE);
    view.setUint8(1, clampByte(local.x));
    view.setUint8(2, clampByte(local.z));
    view.setUint16(3, clampU16(Math.round(offsetX * this.positionPrecision)), true);
    view.setUint16(5, clampU16(Math.round(y * this.positionPrecision)), true);
    view.setUint16(7, clampU16(Math.round(offsetZ * this.positionPrecision)), true);
    view.setUint8(9, encodeYaw(yaw));
    view.setInt8(10, encodePitch(pitch));
    view.setUint16(11, ++this.clientTick & 0xffff, true);
    return bytes;
  }

  encodeMovePoseKey({ x, y, z, yaw, pitch }) {
    const chunk = this.worldToChunk(x, z);
    const local = this.globalToLocalChunk(chunk.x, chunk.z);
    const offsetX = x - chunk.x * this.chunkSize;
    const offsetZ = z - chunk.z * this.chunkSize;
    return [
      clampByte(local.x),
      clampByte(local.z),
      clampU16(Math.round(offsetX * this.positionPrecision)),
      clampU16(Math.round(y * this.positionPrecision)),
      clampU16(Math.round(offsetZ * this.positionPrecision)),
      encodeYaw(yaw),
      encodePitch(pitch),
    ].join(":");
  }

  encodeDig({ x, y, z, action, toolHint }) {
    const chunk = this.worldToChunk(x, z);
    const local = this.globalToLocalChunk(chunk.x, chunk.z);
    const blockX = Math.floor(x - chunk.x * this.chunkSize);
    const blockZ = Math.floor(z - chunk.z * this.chunkSize);
    const bytes = new Uint8Array(DIG_SIZE);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, MSG_DIG);
    view.setUint16(1, ++this.digSeq & 0xffff, true);
    view.setUint8(3, clampByte(local.x));
    view.setUint8(4, clampByte(local.z));
    view.setUint8(5, clampByte(blockX));
    view.setUint16(6, clampU16(Math.floor(y)), true);
    view.setUint8(8, clampByte(blockZ));
    view.setUint8(9, clampByte(action));
    view.setUint8(10, clampByte(toolHint));
    return bytes;
  }

  encodeDigBatch(blocks, { action, toolHint }) {
    const normalized = Array.isArray(blocks) ? blocks.filter(Boolean).slice(0, 255) : [];
    if (!normalized.length) return null;
    const bytes = new Uint8Array(DIG_BATCH_HEADER_SIZE + normalized.length * DIG_BATCH_ITEM_SIZE);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, MSG_DIG_BATCH);
    view.setUint8(1, normalized.length);
    let offset = DIG_BATCH_HEADER_SIZE;
    for (const block of normalized) {
      const chunk = this.worldToChunk(block.x, block.z);
      const local = this.globalToLocalChunk(chunk.x, chunk.z);
      const blockX = Math.floor(block.x - chunk.x * this.chunkSize);
      const blockZ = Math.floor(block.z - chunk.z * this.chunkSize);
      view.setUint16(offset, ++this.digSeq & 0xffff, true);
      view.setUint8(offset + 2, clampByte(local.x));
      view.setUint8(offset + 3, clampByte(local.z));
      view.setUint8(offset + 4, clampByte(blockX));
      view.setUint16(offset + 5, clampU16(Math.floor(block.y)), true);
      view.setUint8(offset + 7, clampByte(blockZ));
      view.setUint8(offset + 8, clampByte(action));
      view.setUint8(offset + 9, clampByte(toolHint));
      offset += DIG_BATCH_ITEM_SIZE;
    }
    return bytes;
  }

  encodeChat(message) {
    const textBytes = chatTextBytes(message);
    if (!textBytes.length) return null;
    const bytes = new Uint8Array(CHAT_HEADER_SIZE + textBytes.length);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, MSG_CHAT);
    view.setUint16(1, ++this.chatSeq & 0xffff, true);
    view.setUint8(3, textBytes.length);
    bytes.set(textBytes, CHAT_HEADER_SIZE);
    return bytes;
  }

  encodeEquipment(equipment) {
    const payload = equipmentPayloadBytes(equipment.payloadBytes ?? equipment.payload);
    if (payload.length > GUARDIAN_EQUIPMENT_MAX_PAYLOAD_BYTES) return null;
    const bytes = new Uint8Array(EQUIPMENT_HEADER_SIZE + payload.length);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, MSG_EQUIPMENT);
    view.setUint16(1, ++this.equipmentSeq & 0xffff, true);
    view.setUint8(3, clampByte(equipment.rightHandKind));
    view.setUint8(4, clampByte(equipment.rightHandVariant));
    view.setUint8(5, clampByte(equipment.flags));
    view.setUint16(6, payload.length, true);
    view.setUint32(8, Number(equipment.designHash || 0) >>> 0, true);
    bytes.set(payload, EQUIPMENT_HEADER_SIZE);
    return bytes;
  }

  encodePlayerIdentity(name) {
    const nameBytes = playerIdentityNameBytes(name);
    const bytes = new Uint8Array(PLAYER_IDENTITY_HEADER_SIZE + nameBytes.length);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, MSG_PLAYER_IDENTITY);
    view.setUint8(1, nameBytes.length);
    bytes.set(nameBytes, PLAYER_IDENTITY_HEADER_SIZE);
    return bytes;
  }

  decodeHelloAck(view) {
    if (view.byteLength !== HELLO_ACK_SIZE) {
      this.onProtocolError({ code: 4 });
      return;
    }
    const protocolVersion = view.getUint8(1);
    const chunkIndexMode = view.getUint8(17);
    if (protocolVersion !== PROTOCOL_VERSION || chunkIndexMode !== CHUNK_INDEX_MODE_U8) {
      this.onProtocolError({ code: 8 });
      this.socket?.close();
      return;
    }
    this.localPlayerId = view.getUint16(2, true);
    const serverFlags = view.getUint16(4, true);
    this.centerChunkX = view.getInt32(6, true);
    this.centerChunkZ = view.getInt32(10, true);
    this.serviceRadiusChunks = view.getUint16(14, true);
    this.serverTick = view.getUint16(18, true);
    this.ready = true;
    this.supportsEquipmentSync = Boolean(serverFlags & SERVER_FLAG_EQUIPMENT_SYNC);
    this.supportsDigBatch = Boolean(serverFlags & SERVER_FLAG_DIG_BATCH);
    this.supportsBuildingManifest = Boolean(serverFlags & SERVER_FLAG_BUILDING_MANIFEST);
    this.lastMovePoseKey = "";
    this.onReady({
      localPlayerId: this.localPlayerId,
      serverFlags,
      supportsEquipmentSync: this.supportsEquipmentSync,
      supportsDigBatch: this.supportsDigBatch,
      supportsBuildingManifest: this.supportsBuildingManifest,
      centerChunkX: this.centerChunkX,
      centerChunkZ: this.centerChunkZ,
      serviceRadiusChunks: this.serviceRadiusChunks,
      aoiRadiusChunks: view.getUint8(16),
    });
  }

  decodeBuildingRegionDigest(view) {
    if (view.byteLength !== BUILDING_REGION_DIGEST_SIZE || !isBuildingManifestVersion(view.getUint8(1))) {
      this.onProtocolError({ code: 4 });
      return;
    }
    this.onBuildingRegionDigest({
      regionX: view.getInt32(2, true),
      regionZ: view.getInt32(6, true),
      revision: readU64(view, 10),
      recordCount: view.getUint32(18, true),
      hash: readHex(view, 22, 16),
      endpoint: this.url,
      source: "ws",
    });
  }

  async decodeBuildingManifestPage(view) {
    const version = view.byteLength >= 2 ? view.getUint8(1) : 0;
    if (view.byteLength < BUILDING_MANIFEST_PAGE_HEADER_SIZE || !isBuildingManifestVersion(version)) {
      this.onProtocolError({ code: 4 });
      return;
    }
    const pageIndex = view.getUint16(2, true);
    const pageCount = view.getUint16(4, true);
    const pageRecordCount = view.getUint16(6, true);
    const totalRecordCount = view.getUint32(8, true);
    const recordSize = version === 1 ? LEGACY_BUILDING_RECORD_SIZE : BUILDING_RECORD_SIZE;
    if (!pageCount || pageIndex >= pageCount || pageRecordCount > BUILDING_MANIFEST_MAX_PAGE_RECORDS
      || view.byteLength !== BUILDING_MANIFEST_PAGE_HEADER_SIZE + pageRecordCount * recordSize) {
      this.onProtocolError({ code: 4 });
      return;
    }
    const regionX = view.getInt32(12, true);
    const regionZ = view.getInt32(16, true);
    const revision = readU64(view, 20);
    const hash = readHex(view, 28, 16);
    const key = `${regionX},${regionZ}:${revision}:${hash}`;
    let assembly = this.buildingManifestPages.get(key);
    if (!assembly) {
      assembly = {
        version,
        recordSize,
        regionX,
        regionZ,
        revision,
        hash,
        totalRecordCount,
        pageCount,
        received: 0,
        pages: new Array(pageCount),
      };
      this.buildingManifestPages.set(key, assembly);
    }
    if (assembly.version !== version || assembly.recordSize !== recordSize
      || assembly.pageCount !== pageCount || assembly.totalRecordCount !== totalRecordCount) {
      this.buildingManifestPages.delete(key);
      this.onProtocolError({ code: 4 });
      return;
    }
    if (!assembly.pages[pageIndex]) {
      const records = [];
      for (let index = 0; index < pageRecordCount; index += 1) {
        records.push(readBuildingRecord(view, BUILDING_MANIFEST_PAGE_HEADER_SIZE + index * recordSize, recordSize));
      }
      assembly.pages[pageIndex] = records;
      assembly.received += 1;
    }
    if (assembly.received !== pageCount) return;
    const records = assembly.pages.flat();
    this.buildingManifestPages.delete(key);
    if (records.length !== totalRecordCount) {
      this.onProtocolError({ code: 4 });
      return;
    }
    if (await computeGuardianBuildingManifestHash(records, { recordSize, version }) !== hash) {
      this.onProtocolError({ code: 4, reason: "building-manifest-hash-mismatch" });
      return;
    }
    this.onBuildingManifest({
      regionX,
      regionZ,
      revision,
      hash,
      records,
      endpoint: this.url,
      source: "ws",
    });
  }

  decodeError(view) {
    return {
      code: view.byteLength >= 3 ? view.getUint16(1, true) : 1,
    };
  }

  decodeMoveBatch(view) {
    if (view.byteLength < 4) return;
    this.serverTick = view.getUint16(1, true);
    const count = view.getUint8(3);
    const expectedLength = 4 + count * MOVE_ITEM_SIZE;
    if (view.byteLength !== expectedLength) {
      this.onProtocolError({ code: 4 });
      return;
    }
    let offset = 4;
    for (let i = 0; i < count; i++) {
      const player = this.decodeMoveItem(view, offset);
      offset += MOVE_ITEM_SIZE;
      if (player.localPlayerId === this.localPlayerId) continue;
      this.onPlayerMove(player);
    }
  }

  decodeMoveItem(view, offset) {
    return this.decodePlayerPose({
      localPlayerId: view.getUint16(offset, true),
      localChunkX: view.getUint8(offset + 2),
      localChunkZ: view.getUint8(offset + 3),
      posX: view.getUint16(offset + 4, true),
      posY: view.getUint16(offset + 6, true),
      posZ: view.getUint16(offset + 8, true),
      yaw: view.getUint8(offset + 10),
      pitch: view.getInt8(offset + 11),
    });
  }

  decodeDigEvent(view) {
    if (view.byteLength !== DIG_EVENT_SIZE) {
      this.onProtocolError({ code: 4 });
      return;
    }
    const localPlayerId = view.getUint16(1, true);
    if (localPlayerId === this.localPlayerId) return;
    const localChunkX = view.getUint8(5);
    const localChunkZ = view.getUint8(6);
    const chunkX = this.localToGlobalChunkX(localChunkX);
    const chunkZ = this.localToGlobalChunkZ(localChunkZ);
    this.onDig({
      localPlayerId,
      seq: view.getUint16(3, true),
      chunkX,
      chunkZ,
      x: chunkX * this.chunkSize + view.getUint8(7),
      y: view.getUint16(8, true),
      z: chunkZ * this.chunkSize + view.getUint8(10),
      action: view.getUint8(11),
      serverTick: view.getUint16(12, true),
    });
  }

  decodeDigEventBatch(view) {
    if (view.byteLength < DIG_EVENT_BATCH_HEADER_SIZE) {
      this.onProtocolError({ code: 4 });
      return;
    }
    const localPlayerId = view.getUint16(1, true);
    this.serverTick = view.getUint16(3, true);
    const count = view.getUint8(5);
    const expectedLength = DIG_EVENT_BATCH_HEADER_SIZE + count * DIG_EVENT_BATCH_ITEM_SIZE;
    if (count === 0 || view.byteLength !== expectedLength) {
      this.onProtocolError({ code: 4 });
      return;
    }
    if (localPlayerId === this.localPlayerId) return;
    let offset = DIG_EVENT_BATCH_HEADER_SIZE;
    for (let index = 0; index < count; index += 1) {
      const localChunkX = view.getUint8(offset + 2);
      const localChunkZ = view.getUint8(offset + 3);
      const chunkX = this.localToGlobalChunkX(localChunkX);
      const chunkZ = this.localToGlobalChunkZ(localChunkZ);
      this.onDig({
        localPlayerId,
        seq: view.getUint16(offset, true),
        chunkX,
        chunkZ,
        x: chunkX * this.chunkSize + view.getUint8(offset + 4),
        y: view.getUint16(offset + 5, true),
        z: chunkZ * this.chunkSize + view.getUint8(offset + 7),
        action: view.getUint8(offset + 8),
        serverTick: this.serverTick,
        batchIndex: index,
        batchCount: count,
      });
      offset += DIG_EVENT_BATCH_ITEM_SIZE;
    }
  }

  decodePlayerJoin(view) {
    if (
      view.byteLength !== PLAYER_JOIN_SIZE &&
      view.byteLength !== PLAYER_JOIN_V2_SIZE &&
      view.byteLength !== PLAYER_JOIN_V1_SIZE &&
      view.byteLength !== LEGACY_PLAYER_JOIN_SIZE
    ) {
      this.onProtocolError({ code: 4 });
      return;
    }
    const hasOwnerWallet = view.byteLength === PLAYER_JOIN_SIZE;
    const hasOwnerKey = view.byteLength === PLAYER_JOIN_SIZE || view.byteLength === PLAYER_JOIN_V2_SIZE;
    const hasOwnerHash = hasOwnerKey || view.byteLength === PLAYER_JOIN_V1_SIZE;
    const ownerWallet = hasOwnerWallet ? readPublicKey(view, 15) : "";
    const poseOffset = hasOwnerWallet ? 47 : hasOwnerKey ? 15 : hasOwnerHash ? 7 : 3;
    const player = this.decodePlayerPose({
      localPlayerId: view.getUint16(1, true),
      ownerHash: hasOwnerHash ? view.getUint32(3, true) : 0,
      ownerKey: hasOwnerKey ? readU64Key(view, 7) : "",
      ownerWallet,
      localChunkX: view.getUint8(poseOffset),
      localChunkZ: view.getUint8(poseOffset + 1),
      posX: view.getUint16(poseOffset + 2, true),
      posY: view.getUint16(poseOffset + 4, true),
      posZ: view.getUint16(poseOffset + 6, true),
      yaw: view.getUint8(poseOffset + 8),
      pitch: view.getInt8(poseOffset + 9),
    });
    if (player.localPlayerId === this.localPlayerId) return;
    this.onPlayerJoin(player);
  }

  decodePlayerLeave(view) {
    if (
      view.byteLength !== PLAYER_LEAVE_SIZE &&
      view.byteLength !== PLAYER_LEAVE_V2_SIZE &&
      view.byteLength !== PLAYER_LEAVE_V1_SIZE &&
      view.byteLength !== LEGACY_PLAYER_LEAVE_SIZE
    ) {
      this.onProtocolError({ code: 4 });
      return;
    }
    const localPlayerId = view.getUint16(1, true);
    if (localPlayerId === this.localPlayerId) return;
    this.onPlayerLeave({
      localPlayerId,
      reason: view.getUint8(3),
      ownerHash: view.byteLength === PLAYER_LEAVE_SIZE || view.byteLength === PLAYER_LEAVE_V2_SIZE || view.byteLength === PLAYER_LEAVE_V1_SIZE ? view.getUint32(4, true) : 0,
      ownerKey: view.byteLength === PLAYER_LEAVE_SIZE || view.byteLength === PLAYER_LEAVE_V2_SIZE ? readU64Key(view, 8) : "",
      ownerWallet: view.byteLength === PLAYER_LEAVE_SIZE ? readPublicKey(view, 16) : "",
    });
  }

  decodeChatEvent(view) {
    if (view.byteLength < CHAT_EVENT_HEADER_SIZE) {
      this.onProtocolError({ code: 4 });
      return;
    }
    const localPlayerId = view.getUint16(1, true);
    const length = view.getUint8(5);
    if (length === 0 || length > MAX_CHAT_BYTES || view.byteLength !== CHAT_EVENT_HEADER_SIZE + length) {
      this.onProtocolError({ code: 4 });
      return;
    }
    if (localPlayerId === this.localPlayerId) return;
    const bytes = new Uint8Array(view.buffer, view.byteOffset + CHAT_EVENT_HEADER_SIZE, length);
    this.onChat({
      localPlayerId,
      seq: view.getUint16(3, true),
      message: chatTextDecoder.decode(bytes),
    });
  }

  decodeEquipmentEvent(view) {
    if (view.byteLength < EQUIPMENT_EVENT_HEADER_SIZE) {
      this.onProtocolError({ code: 4 });
      return;
    }
    const payloadLength = view.getUint16(8, true);
    if (payloadLength > GUARDIAN_EQUIPMENT_MAX_PAYLOAD_BYTES || view.byteLength !== EQUIPMENT_EVENT_HEADER_SIZE + payloadLength) {
      this.onProtocolError({ code: 4 });
      return;
    }
    const localPlayerId = view.getUint16(1, true);
    if (localPlayerId === this.localPlayerId) return;
    const payloadBytes = new Uint8Array(payloadLength);
    if (payloadLength) {
      payloadBytes.set(new Uint8Array(view.buffer, view.byteOffset + EQUIPMENT_EVENT_HEADER_SIZE, payloadLength));
    }
    this.onEquipment({
      localPlayerId,
      seq: view.getUint16(3, true),
      rightHandKind: view.getUint8(5),
      rightHandVariant: view.getUint8(6),
      flags: view.getUint8(7),
      designHash: view.getUint32(10, true),
      payloadBytes,
    });
  }

  decodePlayerIdentityEvent(view) {
    if (view.byteLength < PLAYER_IDENTITY_EVENT_HEADER_SIZE) {
      this.onProtocolError({ code: 4 });
      return;
    }
    const localPlayerId = view.getUint16(1, true);
    const ownerWallet = readPublicKey(view, 3);
    const nameLength = view.getUint8(35);
    if (nameLength > MAX_PLAYER_IDENTITY_NAME_BYTES || view.byteLength !== PLAYER_IDENTITY_EVENT_HEADER_SIZE + nameLength) {
      this.onProtocolError({ code: 4 });
      return;
    }
    if (localPlayerId === this.localPlayerId) return;
    const nameBytes = new Uint8Array(view.buffer, view.byteOffset + PLAYER_IDENTITY_EVENT_HEADER_SIZE, nameLength);
    this.onPlayerIdentity({
      localPlayerId,
      ownerWallet,
      displayName: chatTextDecoder.decode(nameBytes),
    });
  }

  decodePlayerPose(packet) {
    const chunkX = this.localToGlobalChunkX(packet.localChunkX);
    const chunkZ = this.localToGlobalChunkZ(packet.localChunkZ);
    return {
      localPlayerId: packet.localPlayerId,
      ownerHash: packet.ownerHash || 0,
      ownerKey: packet.ownerKey || "",
      ownerWallet: packet.ownerWallet || "",
      chunkX,
      chunkZ,
      x: chunkX * this.chunkSize + packet.posX / this.positionPrecision,
      y: packet.posY / this.positionPrecision,
      z: chunkZ * this.chunkSize + packet.posZ / this.positionPrecision,
      yaw: decodeYaw(packet.yaw),
      pitch: decodePitch(packet.pitch),
    };
  }

  sendPong() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(new Uint8Array([MSG_PONG]).buffer);
  }

  writeWalletHint(bytes, offset) {
    if (!this.identityHint) return;
    const walletBytes = decodeBase58PublicKey(this.identityHint);
    if (walletBytes) {
      bytes.set(walletBytes, offset);
      return;
    }
    const seed = hashString32(this.identityHint);
    let value = seed || 0x9e3779b9;
    for (let i = 0; i < 32; i++) {
      value ^= value << 13;
      value ^= value >>> 17;
      value ^= value << 5;
      bytes[offset + i] = (value >>> ((i & 3) * 8)) & 0xff;
    }
  }

  worldToChunk(x, z) {
    return {
      x: Math.floor(x / this.chunkSize),
      z: Math.floor(z / this.chunkSize),
    };
  }

  globalToLocalChunk(chunkX, chunkZ) {
    return {
      x: chunkX - (this.centerChunkX - this.serviceRadiusChunks),
      z: chunkZ - (this.centerChunkZ - this.serviceRadiusChunks),
    };
  }

  localToGlobalChunkX(localChunkX) {
    return this.centerChunkX - this.serviceRadiusChunks + localChunkX;
  }

  localToGlobalChunkZ(localChunkZ) {
    return this.centerChunkZ - this.serviceRadiusChunks + localChunkZ;
  }
}

export async function decodeGuardianBuildingManifestBinary(input) {
  const bytes = input instanceof Uint8Array
    ? input
    : input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : ArrayBuffer.isView(input)
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : new Uint8Array();
  const magic = bytes.byteLength >= 8 ? readAscii(bytes, 0, 8) : "";
  if (bytes.byteLength < 48 || (magic !== "NCKBRG01" && magic !== "NCKBRG02" && magic !== "NCKBRG03")) {
    throw new Error("Invalid Guardian building manifest header.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(8, true);
  const recordSize = view.getUint16(10, true);
  const recordCount = view.getUint32(28, true);
  const expectedRecordSize = version === 1 && magic === "NCKBRG01"
    ? LEGACY_BUILDING_RECORD_SIZE
    : version === 2 && magic === "NCKBRG02"
      ? BUILDING_RECORD_SIZE
      : version === 3 && magic === "NCKBRG03"
        ? BUILDING_RECORD_SIZE
      : 0;
  if (!expectedRecordSize || recordSize !== expectedRecordSize
    || bytes.byteLength !== 48 + recordCount * expectedRecordSize) {
    throw new Error("Invalid Guardian building manifest layout.");
  }
  const hash = readHex(view, 32, 16);
  const computedHash = await computeGuardianBuildingRecordBytesHash(
    bytes.subarray(48),
    recordCount,
    expectedRecordSize,
    version,
  );
  if (computedHash !== hash) throw new Error("Guardian building manifest hash mismatch.");
  const records = [];
  for (let index = 0; index < recordCount; index += 1) {
    records.push(readBuildingRecord(view, 48 + index * expectedRecordSize, expectedRecordSize));
  }
  return {
    regionX: view.getInt32(12, true),
    regionZ: view.getInt32(16, true),
    revision: readU64(view, 20),
    recordCount,
    hash,
    records,
    source: "http",
  };
}

export async function computeGuardianBuildingManifestHash(
  records = [],
  { recordSize = BUILDING_RECORD_SIZE, version = 3 } = {},
) {
  if (recordSize !== LEGACY_BUILDING_RECORD_SIZE && recordSize !== BUILDING_RECORD_SIZE) {
    throw new Error("Invalid Guardian building record size.");
  }
  const normalized = Array.isArray(records) ? records : [];
  const bytes = new Uint8Array(normalized.length * recordSize);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < normalized.length; index += 1) {
    writeBuildingRecord(bytes, view, index * recordSize, normalized[index], recordSize);
  }
  return computeGuardianBuildingRecordBytesHash(bytes, normalized.length, recordSize, version);
}

async function computeGuardianBuildingRecordBytesHash(bytes, recordCount, recordSize, version) {
  if (bytes.byteLength !== recordCount * recordSize) {
    throw new Error("Invalid Guardian building record bytes.");
  }
  if (version === 3) {
    if (!globalThis.crypto?.subtle) throw new Error("Web Crypto SHA-256 is unavailable.");
    const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", source));
    return Array.from(digest.subarray(0, 16), (value) => value.toString(16).padStart(2, "0")).join("");
  }
  if (version !== 1 && version !== 2) throw new Error("Invalid Guardian building manifest version.");
  let leftLo = 0x84222325;
  let leftHi = 0xcbf29ce4;
  let rightLo = 0x07bb0142;
  let rightHi = 0x6c62272e;
  for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
    const start = recordIndex * recordSize;
    const end = start + recordSize;
    for (let offset = start; offset < end; offset += 1) {
      const byte = bytes[offset];
      leftLo = (leftLo ^ byte) >>> 0;
      let product = leftLo * 435;
      const nextLeftLo = product >>> 0;
      leftHi = (leftHi * 435 + Math.floor(product / 0x1_0000_0000) + leftLo * 256) >>> 0;
      leftLo = nextLeftLo;

      rightLo = (rightLo ^ byte) >>> 0;
      product = rightLo * 435;
      const nextRightLo = product >>> 0;
      rightHi = (rightHi * 435 + Math.floor(product / 0x1_0000_0000) + rightLo * 256) >>> 0;
      rightLo = nextRightLo;
    }
    const shiftLeftLo = (rightLo << 6) >>> 0;
    const shiftLeftHi = ((rightHi << 6) | (rightLo >>> 26)) >>> 0;
    const shiftRightLo = ((rightLo >>> 2) | (rightHi << 30)) >>> 0;
    const shiftRightHi = rightHi >>> 2;
    const lowSum = leftLo + 0x7f4a7c15 + shiftLeftLo + shiftRightLo;
    const highSum = leftHi + 0x9e3779b9 + shiftLeftHi + shiftRightHi
      + Math.floor(lowSum / 0x1_0000_0000);
    rightLo = (rightLo ^ (lowSum >>> 0)) >>> 0;
    rightHi = (rightHi ^ (highSum >>> 0)) >>> 0;
  }
  const hash = new Uint8Array(16);
  const hashView = new DataView(hash.buffer);
  hashView.setUint32(0, leftLo, true);
  hashView.setUint32(4, leftHi, true);
  hashView.setUint32(8, rightLo, true);
  hashView.setUint32(12, rightHi, true);
  return Array.from(hash, (value) => value.toString(16).padStart(2, "0")).join("");
}

function readBuildingRecord(view, offset, recordSize = BUILDING_RECORD_SIZE) {
  const foundationId = readU64(view, offset);
  const minX = view.getInt32(offset + 8, true);
  const minZ = view.getInt32(offset + 12, true);
  const width = view.getUint32(offset + 20, true);
  const depth = view.getUint32(offset + 24, true);
  return {
    foundationId,
    minX,
    minZ,
    maxX: minX + width - 1,
    maxZ: minZ + depth - 1,
    surfaceY: view.getInt16(offset + 16, true),
    flags: view.getUint16(offset + 18, true),
    width,
    depth,
    activeRevision: view.getUint32(offset + 28, true),
    contentHash: readHex(view, offset + 32, 16),
    updatedSlot: recordSize >= BUILDING_RECORD_SIZE ? readU64(view, offset + 48) : "0",
  };
}

function writeBuildingRecord(bytes, view, offset, record, recordSize = BUILDING_RECORD_SIZE) {
  writeU64(view, offset, record.foundationId);
  view.setInt32(offset + 8, requireInteger(record.minX, -0x80000000, 0x7fffffff, "minX"), true);
  view.setInt32(offset + 12, requireInteger(record.minZ, -0x80000000, 0x7fffffff, "minZ"), true);
  view.setInt16(offset + 16, requireInteger(record.surfaceY, -0x8000, 0x7fff, "surfaceY"), true);
  view.setUint16(offset + 18, requireInteger(record.flags ?? 1, 0, 0xffff, "flags"), true);
  view.setUint32(offset + 20, requireInteger(record.width, 0, 0xffffffff, "width"), true);
  view.setUint32(offset + 24, requireInteger(record.depth, 0, 0xffffffff, "depth"), true);
  view.setUint32(offset + 28, requireInteger(record.activeRevision ?? record.revision ?? 0, 0, 0xffffffff, "activeRevision"), true);
  bytes.set(hexBytes(record.contentHash, 16), offset + 32);
  if (recordSize >= BUILDING_RECORD_SIZE) writeU64(view, offset + 48, record.updatedSlot ?? 0);
}

function isBuildingManifestVersion(value) {
  return value === 1 || value === 2 || value === 3;
}

function writeU64(view, offset, value) {
  const normalized = BigInt(value || 0);
  if (normalized < 0n || normalized > 0xffffffffffffffffn) throw new Error("Invalid uint64 value.");
  view.setUint32(offset, Number(normalized & 0xffffffffn), true);
  view.setUint32(offset + 4, Number(normalized >> 32n), true);
}

function readU64(view, offset) {
  return ((BigInt(view.getUint32(offset + 4, true)) << 32n) | BigInt(view.getUint32(offset, true))).toString();
}

function readHex(view, offset, length) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

function hexBytes(value, length) {
  const normalized = String(value || "").trim().toLowerCase().replace(/^0x/, "");
  if (!normalized) return new Uint8Array(length);
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length < length * 2) {
    throw new Error("Invalid building content hash.");
  }
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function requireInteger(value, min, max, name) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    throw new Error(`Invalid ${name}.`);
  }
  return normalized;
}

function readAscii(bytes, offset, length) {
  let result = "";
  for (let index = 0; index < length; index += 1) result += String.fromCharCode(bytes[offset + index]);
  return result;
}

function safeLocalStorageGet(key) {
  try {
    return globalThis.localStorage?.getItem(key) || "";
  } catch {
    return "";
  }
}

function safeLocalStorageSet(key, value) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Non-critical browser preference migration.
  }
}

function guardianSessionId(session) {
  if (!session?.walletAddress || !session.walletBoundAt) return "";
  return `${session.walletAddress}:${session.walletBoundAt}`;
}

function hashString32(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function decodeBase58PublicKey(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const decoded = [];
  for (const char of text) {
    const digit = base58Lookup.get(char);
    if (digit === undefined) return null;
    let carry = digit;
    for (let i = 0; i < decoded.length; i++) {
      const next = decoded[i] * 58 + carry;
      decoded[i] = next & 0xff;
      carry = next >> 8;
    }
    while (carry > 0) {
      decoded.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of text) {
    if (char !== "1") break;
    decoded.push(0);
  }
  if (decoded.length !== 32) return null;
  return Uint8Array.from(decoded.reverse());
}

function readPublicKey(view, offset) {
  if (view.byteLength < offset + 32) return "";
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, 32);
  if (!bytes.some(Boolean)) return "";
  return encodeBase58PublicKey(bytes);
}

function encodeBase58PublicKey(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (source.length !== 32) return "";
  let leadingZeros = 0;
  while (leadingZeros < source.length && source[leadingZeros] === 0) leadingZeros++;
  if (leadingZeros === source.length) return "";

  const digits = [0];
  for (const byte of source) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      const next = (digits[i] << 8) + carry;
      digits[i] = next % 58;
      carry = Math.floor(next / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let encoded = "1".repeat(leadingZeros);
  for (let i = digits.length - 1; i >= 0; i--) encoded += base58Alphabet[digits[i]];
  return encoded;
}

function readU64Key(view, offset) {
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  return `${high.toString(16).padStart(8, "0")}${low.toString(16).padStart(8, "0")}`;
}

function chatTextBytes(message) {
  const normalized = String(message ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return new Uint8Array();
  const encoded = chatTextEncoder.encode(normalized);
  if (encoded.length <= MAX_CHAT_BYTES) return encoded;
  let end = MAX_CHAT_BYTES;
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end--;
  return encoded.slice(0, Math.max(0, end));
}

function playerIdentityNameBytes(name) {
  const normalized = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return new Uint8Array();
  const encoded = chatTextEncoder.encode(normalized);
  if (encoded.length <= MAX_PLAYER_IDENTITY_NAME_BYTES) return encoded;
  let end = MAX_PLAYER_IDENTITY_NAME_BYTES;
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end--;
  return encoded.slice(0, Math.max(0, end));
}

function equipmentPayloadBytes(payload) {
  if (!payload) return new Uint8Array();
  if (payload instanceof Uint8Array) return payload;
  if (Array.isArray(payload)) return Uint8Array.from(payload);
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  return new Uint8Array();
}

function randomNonceWords() {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return { low: words[0], high: words[1] };
}

function clampByte(value) {
  return Math.max(0, Math.min(255, value));
}

function clampU16(value) {
  return Math.max(0, Math.min(65535, value));
}

function encodeYaw(radians) {
  const normalized = ((radians % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.round((normalized / (Math.PI * 2)) * 255) & 0xff;
}

function decodeYaw(value) {
  return (value / 256) * Math.PI * 2;
}

function encodePitch(radians) {
  return Math.max(-128, Math.min(127, Math.round((radians / (Math.PI / 2)) * 127)));
}

function decodePitch(value) {
  return (value / 127) * (Math.PI / 2);
}
