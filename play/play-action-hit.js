import {
  cameraForward,
  createCameraState,
  raycastBlock,
  raycastBlockFromScreen,
} from "/chunk.js/play.js";

export function createPlayActionHit({
  canvas,
  getCamera = () => null,
  getChunks = () => null,
  getPlayer = () => null,
  getFirstPersonCamera = () => false,
  getPlayerWorldFloat = () => [0, 0, 0],
  getPlayerBounds = () => null,
  raycastDistance = 48,
  playerEyeRaycastDistance = 14,
  playerReachBlocks = 9.5,
  playerEyeHeightBlocks = 3.8,
  playerBodyHeight = 4,
  pitchMin = -0.92,
  pitchMax = 0.42,
  firstPersonPitchMin = pitchMin,
  firstPersonPitchMax = pitchMax,
  updateIntervalMs = 90,
  raycastFromCamera = raycastBlock,
  raycastFromScreen = raycastBlockFromScreen,
} = {}) {
  const actionRayCamera = createCameraState({ worldX: 0, worldY: 0, worldZ: 0 });
  let actionHitOverride = null;
  let pointerScreenPoint = null;
  let pointerDirty = false;
  let lastHit = null;
  let lastUpdateAt = 0;

  return {
    currentHit: () => lastHit,
    handleCanvasPointer,
    handleCanvasPointerMove,
    handleCanvasPointerLeave,
    updateForFrame,
    getPointerActionHit,
    getActionHit,
    resolve,
    isWithinReach,
  };

  function handleCanvasPointer(event) {
    const camera = getCamera();
    const chunks = getChunks();
    if (!camera || !chunks || !canvas) {
      lastHit = { hit: false };
      return lastHit;
    }
    const point = actionScreenPoint(event);
    if (!getFirstPersonCamera()) rememberPointerScreenPoint(point);
    actionHitOverride = raycastFromScreen(camera, point.x, point.y, canvas, raycastDistance, chunks);
    lastHit = isWithinReach(actionHitOverride) ? actionHitOverride : { hit: false };
    return lastHit;
  }

  function handleCanvasPointerMove(event) {
    if (!event || getFirstPersonCamera()) return lastHit;
    rememberPointerScreenPoint({ x: event.clientX, y: event.clientY });
    return lastHit;
  }

  function handleCanvasPointerLeave() {
    pointerScreenPoint = null;
    pointerDirty = false;
    if (!getFirstPersonCamera()) lastHit = { hit: false };
    return lastHit;
  }

  function actionScreenPoint(event) {
    if (!getFirstPersonCamera()) return { x: event.clientX, y: event.clientY };
    const rect = canvas?.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) {
      return { x: (canvas?.clientWidth || 0) * 0.5, y: (canvas?.clientHeight || 0) * 0.5 };
    }
    return { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
  }

  function updateForFrame(now = performance.now(), { force = false } = {}) {
    if (!force && !pointerDirty && now - lastUpdateAt < updateIntervalMs) return lastHit;
    lastUpdateAt = now;
    pointerDirty = false;
    if (!getFirstPersonCamera()) {
      const hit = raycastPointerScreenPoint();
      lastHit = isWithinReach(hit) ? hit : { hit: false };
      return lastHit;
    }
    lastHit = resolve({ allowOutOfReach: false });
    return lastHit;
  }

  function getActionHit(now = performance.now()) {
    const screenHit = actionHitOverride ?? (!getFirstPersonCamera() ? raycastPointerScreenPoint() : null);
    actionHitOverride = null;
    const hit = !getFirstPersonCamera()
      ? (screenHit?.hit ? screenHit : { hit: false })
      : resolve({ screenHit, allowOutOfReach: true });
    lastUpdateAt = now;
    lastHit = isWithinReach(hit) ? hit : { hit: false };
    return hit;
  }

  function getPointerActionHit(now = performance.now()) {
    if (actionHitOverride === null) return { hit: false };
    const hit = actionHitOverride?.hit ? actionHitOverride : { hit: false };
    actionHitOverride = null;
    lastUpdateAt = now;
    lastHit = isWithinReach(hit) ? hit : { hit: false };
    return hit;
  }

  function resolve({ screenHit = null, allowOutOfReach = false } = {}) {
    const camera = getCamera();
    const chunks = getChunks();
    if (!camera || !chunks) return { hit: false };
    if (isWithinReach(screenHit)) return screenHit;

    const eyeHit = raycastFromPlayerEye(playerActionDirection(), playerEyeRaycastDistance);
    if (isWithinReach(eyeHit)) return eyeHit;

    const cameraHit = raycastFromCamera(camera, null, raycastDistance, chunks);
    if (isWithinReach(cameraHit)) return cameraHit;

    const cameraEyeHit = raycastFromPlayerEye(cameraForward(camera), playerEyeRaycastDistance);
    if (isWithinReach(cameraEyeHit)) return cameraEyeHit;

    if (!allowOutOfReach) return { hit: false };
    if (screenHit?.hit) return screenHit;
    if (eyeHit?.hit) return eyeHit;
    if (cameraHit?.hit) return cameraHit;
    if (cameraEyeHit?.hit) return cameraEyeHit;
    return { hit: false };
  }

  function raycastFromPlayerEye(direction, maxDistance) {
    const chunks = getChunks();
    if (!getPlayer() || !chunks) return { hit: false };
    const [px, py, pz] = getPlayerWorldFloat();
    const eyeY = py + Math.min(playerBodyHeight * 0.82, playerEyeHeightBlocks);
    setActionRayCameraWorldFloat(px, eyeY, pz);
    return raycastFromCamera(actionRayCamera, direction, maxDistance, chunks);
  }

  function rememberPointerScreenPoint(point) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    pointerScreenPoint = { x, y };
    pointerDirty = true;
  }

  function raycastPointerScreenPoint() {
    const camera = getCamera();
    const chunks = getChunks();
    if (!pointerScreenPoint || !camera || !chunks || !canvas) return { hit: false };
    return raycastFromScreen(
      camera,
      pointerScreenPoint.x,
      pointerScreenPoint.y,
      canvas,
      raycastDistance,
      chunks,
    );
  }

  function setActionRayCameraWorldFloat(x, y, z) {
    actionRayCamera.worldX = Math.floor(x);
    actionRayCamera.worldY = Math.floor(y);
    actionRayCamera.worldZ = Math.floor(z);
    actionRayCamera.localOffsetX = x - actionRayCamera.worldX;
    actionRayCamera.localOffsetY = y - actionRayCamera.worldY;
    actionRayCamera.localOffsetZ = z - actionRayCamera.worldZ;
    actionRayCamera.targetWorldX = null;
    actionRayCamera.targetWorldY = null;
    actionRayCamera.targetWorldZ = null;
  }

  function playerActionDirection() {
    const player = getPlayer();
    const camera = getCamera();
    if (!player) return camera ? cameraForward(camera) : [0, 0, -1];
    const yaw = Number.isFinite(player.controlYaw)
      ? player.controlYaw
      : (Number.isFinite(player.avatarYaw) ? player.avatarYaw : ((Number(camera?.yaw) || 0) - Math.PI));
    const pitch = clamp(
      Number.isFinite(player.cameraPitch) ? player.cameraPitch : (Number(camera?.pitch) || 0),
      getFirstPersonCamera() ? firstPersonPitchMin : pitchMin,
      getFirstPersonCamera() ? firstPersonPitchMax : pitchMax,
    );
    const cp = Math.cos(pitch);
    return normalizeVec3([
      -Math.sin(yaw) * cp,
      Math.sin(pitch),
      -Math.cos(yaw) * cp,
    ]);
  }

  function isWithinReach(hit, reach = playerReachBlocks) {
    if (!hit?.hit) return false;
    const playerBounds = getPlayerBounds();
    if (!playerBounds) return true;
    const cx = hit.worldX + 0.5;
    const cy = hit.worldY + 0.5;
    const cz = hit.worldZ + 0.5;
    const py = playerBounds.y + Math.min(playerBounds.height * 0.72, playerEyeHeightBlocks);
    const dx = cx - playerBounds.x;
    const dy = cy - py;
    const dz = cz - playerBounds.z;
    return dx * dx + dy * dy + dz * dz <= reach * reach;
  }
}

function normalizeVec3(value) {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
