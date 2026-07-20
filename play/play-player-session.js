export function createPlayPlayerSession({
  elements,
  getPlayer = () => null,
  getCamera = () => null,
  getChunks = () => null,
  getRenderer = () => null,
  getMotion = () => null,
  getPositionPersistence = () => null,
  getPlayerWorldFloat = () => [0, 0, 0],
  setPlayerWorldFloat = () => {},
  syncCameraToPlayer = () => {},
  resolvePlayerPenetration = () => false,
  setViewDistance = () => {},
  cameraLoadDirection = () => null,
  setStatus = () => {},
  defaultViewDistance = 7,
  pitchMin = -1,
  pitchMax = 1,
  maxViewDistance = 20,
} = {}) {
  let persistenceBound = false;

  return {
    bindPositionPersistence,
    savePlayerPosition,
    currentPoseSnapshot,
    currentGuardianPose,
    currentPlayerChainPosition,
    normalizePlayerChainPosition,
    applyPoseSnapshot,
    teleportPlayerFromMap,
    setFlightEnabled,
    updateFlightUi,
  };

  function bindPositionPersistence() {
    if (persistenceBound) return;
    persistenceBound = true;
    addEventListener("pagehide", () => {
      savePlayerPosition(performance.now(), { force: true });
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        savePlayerPosition(performance.now(), { force: true });
      }
    });
  }

  function savePlayerPosition(now = performance.now(), options = {}) {
    return getPositionPersistence()?.save(now, options) ?? false;
  }

  function currentPoseSnapshot() {
    const player = getPlayer();
    if (!player) return null;
    const [px, py, pz] = getPlayerWorldFloat();
    const worldX = Math.floor(px);
    const worldY = Math.floor(py);
    const worldZ = Math.floor(pz);
    return {
      worldX,
      worldY,
      worldZ,
      localOffsetX: px - worldX,
      localOffsetY: py - worldY,
      localOffsetZ: pz - worldZ,
      fullX: px,
      fullY: py,
      fullZ: pz,
      avatarYaw: Number.isFinite(player.avatarYaw) ? player.avatarYaw : player.yaw,
      controlYaw: Number.isFinite(player.controlYaw) ? player.controlYaw : player.yaw,
      cameraPitch: Number.isFinite(player.cameraPitch) ? player.cameraPitch : getCamera()?.pitch,
      viewDistance: Number(elements?.viewRangeInput?.value) || getRenderer()?.options?.viewDistance || defaultViewDistance,
      flightEnabled: Boolean(player.flightEnabled),
    };
  }

  function currentGuardianPose() {
    const player = getPlayer();
    if (!player) return null;
    const [x, y, z] = getPlayerWorldFloat();
    return {
      x,
      y,
      z,
      yaw: Number.isFinite(player.avatarYaw) ? player.avatarYaw : player.yaw,
      pitch: Number.isFinite(player.cameraPitch) ? player.cameraPitch : getCamera()?.pitch,
    };
  }

  function currentPlayerChainPosition() {
    const [x, y, z] = getPlayerWorldFloat();
    return normalizePlayerChainPosition({ x, y, z });
  }

  function normalizePlayerChainPosition(position) {
    if (!position) return null;
    const rounded = {
      x: Math.round(Number(position.x)),
      y: Math.round(Number(position.y)),
      z: Math.round(Number(position.z)),
    };
    return [rounded.x, rounded.y, rounded.z].every(Number.isFinite) ? rounded : null;
  }

  function applyPoseSnapshot(pose) {
    const player = getPlayer();
    const camera = getCamera();
    const chunks = getChunks();
    if (!pose || !player || !camera || !chunks) return false;
    const x = pose.fullX ?? (pose.worldX + (pose.localOffsetX || 0));
    const y = pose.fullY ?? (pose.worldY + (pose.localOffsetY || 0));
    const z = pose.fullZ ?? (pose.worldZ + (pose.localOffsetZ || 0));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;

    setPlayerWorldFloat(x, y, z);
    if (Number.isFinite(pose.controlYaw)) player.controlYaw = pose.controlYaw;
    if (Number.isFinite(pose.avatarYaw)) {
      player.avatarYaw = pose.avatarYaw;
      player.yaw = pose.avatarYaw;
    }
    if (Number.isFinite(pose.cameraPitch)) player.cameraPitch = clamp(pose.cameraPitch, pitchMin, pitchMax);
    if (typeof pose.flightEnabled === "boolean") applyFlightState(pose.flightEnabled);
    if (Number.isFinite(pose.viewDistance)) setViewDistance(clampInt(pose.viewDistance, 2, maxViewDistance));

    getMotion()?.resetCameraFocus?.();
    syncCameraToPlayer(1 / 60, { force: true });
    chunks.updatePlayerPosition(player.worldX, player.worldY, player.worldZ, cameraLoadDirection(camera));
    savePlayerPosition(performance.now(), { force: true });
    return true;
  }

  function teleportPlayerFromMap(x, z) {
    const player = getPlayer();
    const chunks = getChunks();
    const camera = getCamera();
    if (!player || !chunks || !camera) return false;
    const surfaceY = chunks.surfaceYAt(x, z);
    setPlayerWorldFloat(x, surfaceY, z);
    player.velocityY = 0;
    player.grounded = !player.flightEnabled;
    chunks.updatePlayerPosition(player.worldX, player.worldY, player.worldZ, cameraLoadDirection(camera));
    getMotion()?.resetCameraFocus?.();
    syncCameraToPlayer(1 / 60, { force: true });
    resolvePlayerPenetration();
    savePlayerPosition(performance.now(), { force: true });
    return true;
  }

  function setFlightEnabled(enabled) {
    const player = getPlayer();
    if (!player) return;
    applyFlightState(Boolean(enabled));
    savePlayerPosition(performance.now(), { force: true });
    setStatus(player.flightEnabled
      ? "Flight enabled. Space rises, C/Ctrl descends, Shift keeps 5x speed."
      : "Flight disabled. Gravity and terrain collision restored.");
  }

  function applyFlightState(enabled) {
    const player = getPlayer();
    if (!player) return;
    player.flightEnabled = Boolean(enabled);
    player.velocityY = 0;
    player.grounded = !player.flightEnabled;
    getMotion()?.resetFlightVerticalIntent?.();
    updateFlightUi();
  }

  function updateFlightUi() {
    const player = getPlayer();
    if (!elements?.flightToggle || !player) return;
    elements.flightToggle.textContent = player.flightEnabled ? "Flight On" : "Flight Off";
    elements.flightToggle.setAttribute("aria-pressed", player.flightEnabled ? "true" : "false");
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.trunc(Number(value) || min)));
}
