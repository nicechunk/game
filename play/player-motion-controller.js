import {
  createCollisionBox,
  isBlockingBlock,
  maxCollisionHorizontalExtent,
  prepareCollisionBoxes,
  preparedCollisionBoxIntersectsBlock,
  preparedCollisionFootprintIntersectsBlock,
  resolveCameraCollisionSegment,
} from "../chunk.js/play.js";

export function createPlayerMotionController({
  getPlayer,
  getCamera,
  getControls,
  getChunks,
  getAvatar,
  defaultCollisionBox,
  isMobileViewport = () => false,
  config = {},
} = {}) {
  const cfg = {
    blockSizeMeters: 0.4,
    avatarFootOffset: 0,
    avatarHeightBlocks: 4.375,
    playerRadius: 0.35,
    playerBodyHeight: 4,
    gravity: 24,
    jumpImpulse: 9.2,
    collisionStep: 0.14,
    collisionEpsilon: 0.0015,
    groundSnapUp: 0.22,
    stepHeightBlocks: 1.05,
    cameraDistance: 8.4,
    cameraFocusHeightDesktop: 3.75,
    cameraFocusHeightMobile: 4.125,
    cameraLiftDesktop: 2.1,
    cameraLiftMobile: 3.8,
    cameraCollisionRadius: 0.24,
    cameraCollisionSkin: 0.1,
    cameraCollisionMinimumDistance: 0.12,
    cameraPitchMin: -0.92,
    cameraPitchMax: 0.18,
    firstPersonEyeHeight: 3.8,
    firstPersonCameraBackDistance: 0.16,
    firstPersonPitchMin: -0.92,
    firstPersonPitchMax: 0.42,
    ...config,
  };
  let cameraFocusReady = false;
  let cameraFocusX = 0;
  let cameraFocusY = 0;
  let cameraFocusZ = 0;
  let flightVerticalIntent = 0;
  const cameraCollisionOptions = {
    radius: cfg.cameraCollisionRadius,
    skin: cfg.cameraCollisionSkin,
    minimumDistance: cfg.cameraCollisionMinimumDistance,
  };
  const cameraCenterCollisionOptions = {
    ...cameraCollisionOptions,
    radius: 0,
  };
  const desiredCameraCollision = {};
  const interpolatedCameraCollision = {};

  return {
    applyPlayerPhysics,
    isMotionActive,
    syncAvatarToPlayer,
    syncCameraToPlayer,
    playerWorldFloat,
    cameraWorldFloat,
    setPlayerWorldFloat,
    setCameraWorldFloat,
    setCameraLookTargetWorldFloat,
    resolvePlayerPenetration,
    liftPlayerOutOfCollision,
    groundYAt,
    playerCollidesAt,
    playerCollisionBoxes,
    playerCollisionYaw,
    collisionBlockAt,
    setPlayerCollisionBoxes,
    setFirstPersonCameraEnabled,
    toggleFirstPersonCamera,
    isFirstPersonCameraEnabled,
    setFlightVerticalIntent(direction) {
      flightVerticalIntent = clamp(Number(direction) || 0, -1, 1);
    },
    clearFlightVerticalIntent(direction = null) {
      if (direction == null || flightVerticalIntent === direction) flightVerticalIntent = 0;
    },
    resetFlightVerticalIntent() {
      flightVerticalIntent = 0;
    },
    flightVerticalInput,
    resetCameraFocus() {
      cameraFocusReady = false;
    },
  };

  function applyPlayerPhysics(dt) {
    const player = getPlayer?.();
    const controls = getControls?.();
    if (!player || !controls) return;
    if (player.flightEnabled) {
      applyPlayerFlight(dt);
      return;
    }
    const horizontalMoved = movePlayerHorizontally(controls.move.dx || 0, controls.move.dz || 0);
    controls.move.actualMoving = horizontalMoved;
    controls.move.moving = controls.move.moving && horizontalMoved;
    const movementYaw = player.firstPersonCamera ? player.controlYaw : controls.move.yaw;
    if (horizontalMoved && Number.isFinite(movementYaw)) {
      player.avatarYaw = movementYaw;
      player.yaw = player.avatarYaw;
    }

    const [x, y, z] = playerWorldFloat();
    const ground = groundYAt(x, z, { maxTopY: y + cfg.groundSnapUp });
    const canJump = player.grounded || (player.velocityY <= 0 && y <= ground + 0.065);
    const jumpRequested = controls.consumeJump();
    if (jumpRequested && canJump) {
      player.velocityY = cfg.jumpImpulse;
      player.grounded = false;
    } else if (player.velocityY <= 0 && y <= ground + 0.045) {
      setPlayerWorldFloat(x, ground, z);
      player.velocityY = 0;
      player.grounded = true;
      return;
    }

    player.velocityY -= cfg.gravity * dt;
    movePlayerVertically(player.velocityY * dt);
    resolvePlayerPenetration();
  }

  function applyPlayerFlight(dt) {
    const player = getPlayer?.();
    const controls = getControls?.();
    if (!player || !controls) return;
    controls.consumeJump();
    const horizontalMoved = movePlayerHorizontally(controls.move.dx || 0, controls.move.dz || 0);
    const vertical = flightVerticalInput();
    if (Math.abs(vertical) > 0.001) {
      const speed = controls.speed * ((controls.keys.has("ShiftLeft") || controls.keys.has("ShiftRight")) ? controls.sprintMultiplier : 1);
      movePlayerVertically(vertical * speed * dt);
    }
    controls.move.actualMoving = horizontalMoved || Math.abs(vertical) > 0.001;
    controls.move.moving = Boolean(controls.move.moving || Math.abs(vertical) > 0.001);
    const movementYaw = player.firstPersonCamera ? player.controlYaw : controls.move.yaw;
    if (horizontalMoved && Number.isFinite(movementYaw)) {
      player.avatarYaw = movementYaw;
      player.yaw = player.avatarYaw;
    }
    player.velocityY = 0;
    player.grounded = false;
  }

  function flightVerticalInput() {
    const controls = getControls?.();
    let vertical = flightVerticalIntent;
    if (controls?.keys?.has("Space")) vertical += 1;
    if (controls?.keys?.has("KeyC") || controls?.keys?.has("ControlLeft") || controls?.keys?.has("ControlRight")) vertical -= 1;
    return clamp(vertical, -1, 1);
  }

  function flightVerticalMotionActive() {
    const player = getPlayer?.();
    return Boolean(player?.flightEnabled && Math.abs(flightVerticalInput()) > 0.001);
  }

  function isMotionActive() {
    const controls = getControls?.();
    const player = getPlayer?.();
    return Boolean(controls?.move?.moving || flightVerticalMotionActive() || Math.abs(player?.velocityY || 0) > 0.01);
  }

  function syncAvatarToPlayer(now) {
    const avatar = getAvatar?.();
    const player = getPlayer?.();
    const controls = getControls?.();
    if (!avatar || !player || !controls) return;
    const bob = controls.move.moving ? Math.abs(Math.sin(now * 0.011 * 0.5)) * 0.035 : 0;
    const miningRemaining = Math.max(0, (player.miningSwingUntil || 0) - now);
    const miningDuration = Math.max(1, player.miningSwingDurationMs || 1);
    const miningProgress = miningRemaining > 0 ? 1 - miningRemaining / miningDuration : 0;
    if (miningRemaining > 0 && Number.isFinite(player.miningAimYaw)) {
      player.avatarYaw = player.miningAimYaw;
      player.yaw = player.miningAimYaw;
    } else {
      player.miningAimYaw = null;
      player.miningAimPitch = 0;
      if (player.firstPersonCamera && Number.isFinite(player.controlYaw)) {
        player.avatarYaw = player.controlYaw;
        player.yaw = player.controlYaw;
      }
    }
    const [px, py, pz] = playerWorldFloat();
    const shadowWorldY = groundYAt(px, pz, { maxTopY: py + cfg.groundSnapUp });
    avatar.worldX = player.worldX;
    avatar.worldY = player.worldY;
    avatar.worldZ = player.worldZ;
    avatar.localOffsetX = player.localOffsetX;
    avatar.localOffsetY = bob - cfg.avatarFootOffset;
    avatar.localOffsetZ = player.localOffsetZ;
    avatar.yaw = player.avatarYaw;
    avatar.animation = {
      moving: controls.move.actualMoving,
      timeMs: now,
      miningProgress,
      miningAimPitch: miningRemaining > 0 ? (Number(player.miningAimPitch) || 0) : 0,
    };
    avatar.shadowWorldY = shadowWorldY;
    avatar.shadowCasterHeight = cfg.avatarHeightBlocks;
    avatar.shadowRadiusX = Math.max(0.34, cfg.playerRadius * 0.92);
    avatar.shadowRadiusZ = Math.max(0.30, cfg.playerRadius * 0.78);
    avatar.shadowAlpha = 0.44;
  }

  function syncCameraToPlayer(dt = 1 / 60, { force = false } = {}) {
    const player = getPlayer?.();
    const camera = getCamera?.();
    if (!player || !camera) return;
    const [px, py, pz] = playerWorldFloat();
    const firstPerson = isFirstPersonCameraEnabled();
    const pitchMin = firstPerson ? cfg.firstPersonPitchMin : cfg.cameraPitchMin;
    const pitchMax = firstPerson ? cfg.firstPersonPitchMax : cfg.cameraPitchMax;
    const pitch = clamp(Number.isFinite(player.cameraPitch) ? player.cameraPitch : camera.pitch, pitchMin, pitchMax);
    const controlYaw = Number.isFinite(player.controlYaw) ? player.controlYaw : player.yaw;
    player.cameraPitch = pitch;
    camera.pitch = pitch;
    camera.yaw = controlYaw + Math.PI;
    if (firstPerson) {
      const eyeY = py + cfg.firstPersonEyeHeight;
      const horizontal = Math.cos(pitch);
      const forwardX = -Math.sin(controlYaw) * horizontal;
      const forwardY = Math.sin(pitch);
      const forwardZ = -Math.cos(controlYaw) * horizontal;
      const cameraX = px + Math.sin(controlYaw) * cfg.firstPersonCameraBackDistance;
      const cameraZ = pz + Math.cos(controlYaw) * cfg.firstPersonCameraBackDistance;
      cameraFocusX = px;
      cameraFocusY = eyeY;
      cameraFocusZ = pz;
      cameraFocusReady = true;
      player.avatarYaw = controlYaw;
      player.yaw = controlYaw;
      setCameraWorldFloat(cameraX, eyeY, cameraZ);
      setCameraLookTargetWorldFloat(
        cameraX + forwardX * 8,
        eyeY + forwardY * 8,
        cameraZ + forwardZ * 8,
      );
      return;
    }
    const mobileCamera = isMobileViewport();
    const targetY = py + (mobileCamera ? cfg.cameraFocusHeightMobile : cfg.cameraFocusHeightDesktop);
    if (force || !cameraFocusReady || distanceSquared(cameraFocusX, cameraFocusY, cameraFocusZ, px, targetY, pz) > 256) {
      cameraFocusX = px;
      cameraFocusY = targetY;
      cameraFocusZ = pz;
      cameraFocusReady = true;
    } else {
      const horizontalAlpha = 1 - Math.exp(-dt * 14);
      const verticalAlpha = 1 - Math.exp(-dt * 7);
      cameraFocusX = lerp(cameraFocusX, px, horizontalAlpha);
      cameraFocusZ = lerp(cameraFocusZ, pz, horizontalAlpha);
      cameraFocusY = lerp(cameraFocusY, targetY, verticalAlpha);
    }
    const horizontal = Math.cos(pitch) * cfg.cameraDistance;
    const desiredX = cameraFocusX + Math.sin(controlYaw) * horizontal;
    const desiredY = cameraFocusY + Math.sin(-pitch) * cfg.cameraDistance + (mobileCamera ? cfg.cameraLiftMobile : cfg.cameraLiftDesktop);
    const desiredZ = cameraFocusZ + Math.cos(controlYaw) * horizontal;
    setCameraLookTargetWorldFloat(cameraFocusX, cameraFocusY, cameraFocusZ);
    const safeDesired = resolveCameraPosition(desiredX, desiredY, desiredZ, desiredCameraCollision);
    if (force) {
      setCameraWorldFloat(safeDesired.x, safeDesired.y, safeDesired.z);
      setCameraLookTargetWorldFloat(cameraFocusX, cameraFocusY, cameraFocusZ);
      return;
    }
    if (safeDesired.collided) {
      // Moving inward immediately avoids exposing a terrain face for one frame.
      setCameraWorldFloat(safeDesired.x, safeDesired.y, safeDesired.z);
      return;
    }
    const [cx, cy, cz] = cameraWorldFloat();
    const positionAlpha = 1 - Math.exp(-dt * 9);
    const safeInterpolated = resolveCameraPosition(
      lerp(cx, desiredX, positionAlpha),
      lerp(cy, desiredY, positionAlpha),
      lerp(cz, desiredZ, positionAlpha),
      interpolatedCameraCollision,
      cameraCenterCollisionOptions,
    );
    setCameraWorldFloat(safeInterpolated.x, safeInterpolated.y, safeInterpolated.z);
  }

  function setFirstPersonCameraEnabled(enabled) {
    const player = getPlayer?.();
    if (!player) return false;
    player.firstPersonCamera = Boolean(enabled);
    if (!player.firstPersonCamera) {
      const camera = getCamera?.();
      const pitch = Number.isFinite(player.cameraPitch) ? player.cameraPitch : (Number(camera?.pitch) || 0);
      player.cameraPitch = clamp(pitch, cfg.cameraPitchMin, cfg.cameraPitchMax);
    }
    cameraFocusReady = false;
    return player.firstPersonCamera;
  }

  function toggleFirstPersonCamera() {
    return setFirstPersonCameraEnabled(!isFirstPersonCameraEnabled());
  }

  function isFirstPersonCameraEnabled() {
    return Boolean(getPlayer?.()?.firstPersonCamera);
  }

  function resolveCameraPosition(desiredX, desiredY, desiredZ, out, options = cameraCollisionOptions) {
    return resolveCameraCollisionSegment(
      cameraFocusX,
      cameraFocusY,
      cameraFocusZ,
      desiredX,
      desiredY,
      desiredZ,
      cameraBlockedAt,
      options,
      out,
    );
  }

  function cameraBlockedAt(worldX, worldY, worldZ) {
    const chunks = getChunks?.();
    if (chunks?.isCameraOccluderAtWorld) return chunks.isCameraOccluderAtWorld(worldX, worldY, worldZ);
    return isBlockingBlock(collisionBlockAt(worldX, worldY, worldZ));
  }

  function setCameraWorldFloat(x, y, z) {
    const camera = getCamera?.();
    if (!camera) return;
    camera.worldX = Math.floor(x);
    camera.worldY = Math.floor(y);
    camera.worldZ = Math.floor(z);
    camera.localOffsetX = x - camera.worldX;
    camera.localOffsetY = y - camera.worldY;
    camera.localOffsetZ = z - camera.worldZ;
  }

  function setCameraLookTargetWorldFloat(x, y, z) {
    const camera = getCamera?.();
    if (!camera) return;
    camera.targetWorldX = Math.floor(x);
    camera.targetWorldY = Math.floor(y);
    camera.targetWorldZ = Math.floor(z);
    camera.targetLocalOffsetX = x - camera.targetWorldX;
    camera.targetLocalOffsetY = y - camera.targetWorldY;
    camera.targetLocalOffsetZ = z - camera.targetWorldZ;
  }

  function playerWorldFloat() {
    const player = getPlayer?.();
    if (!player) return [0, 0, 0];
    return [
      Math.trunc(player.worldX || 0) + (player.localOffsetX || 0),
      Math.trunc(player.worldY || 0) + (player.localOffsetY || 0),
      Math.trunc(player.worldZ || 0) + (player.localOffsetZ || 0),
    ];
  }

  function cameraWorldFloat() {
    const camera = getCamera?.();
    if (!camera) return [0, 0, 0];
    return [
      Math.trunc(camera.worldX || 0) + (camera.localOffsetX || 0),
      Math.trunc(camera.worldY || 0) + (camera.localOffsetY || 0),
      Math.trunc(camera.worldZ || 0) + (camera.localOffsetZ || 0),
    ];
  }

  function setPlayerWorldFloat(x, y, z) {
    const player = getPlayer?.();
    if (!player) return;
    player.worldX = Math.floor(x);
    player.worldY = Math.floor(y);
    player.worldZ = Math.floor(z);
    player.localOffsetX = x - player.worldX;
    player.localOffsetY = y - player.worldY;
    player.localOffsetZ = z - player.worldZ;
  }

  function movePlayerHorizontally(dx, dz) {
    const maxDelta = Math.max(Math.abs(dx), Math.abs(dz));
    if (maxDelta <= 0.000001) return false;
    const steps = Math.max(1, Math.ceil(maxDelta / cfg.collisionStep));
    const stepX = dx / steps;
    const stepZ = dz / steps;
    let moved = false;
    for (let i = 0; i < steps; i += 1) {
      moved = tryMovePlayerAxis(stepX, 0) || moved;
      moved = tryMovePlayerAxis(0, stepZ) || moved;
    }
    return moved;
  }

  function tryMovePlayerAxis(dx, dz) {
    if (Math.abs(dx) <= 0.000001 && Math.abs(dz) <= 0.000001) return false;
    const [x, y, z] = playerWorldFloat();
    const nextX = x + dx;
    const nextZ = z + dz;
    if (playerCollidesAt(nextX, y, nextZ)) return tryStepPlayerAxis(nextX, y, nextZ);
    setPlayerWorldFloat(nextX, y, nextZ);
    return true;
  }

  function tryStepPlayerAxis(nextX, y, nextZ) {
    const player = getPlayer?.();
    if (!player?.grounded) return false;
    const stepGround = groundYAt(nextX, nextZ, { maxTopY: y + cfg.stepHeightBlocks + cfg.groundSnapUp });
    if (!Number.isFinite(stepGround)) return false;
    if (stepGround <= y + 0.03 || stepGround > y + cfg.stepHeightBlocks + 0.04) return false;
    if (playerCollidesAt(nextX, stepGround, nextZ)) return false;
    setPlayerWorldFloat(nextX, stepGround, nextZ);
    player.velocityY = 0;
    player.grounded = true;
    return true;
  }

  function movePlayerVertically(dy) {
    const player = getPlayer?.();
    if (!player) return;
    const maxDelta = Math.abs(dy);
    if (maxDelta <= 0.000001) return;
    const steps = Math.max(1, Math.ceil(maxDelta / cfg.collisionStep));
    const stepY = dy / steps;
    player.grounded = false;
    for (let i = 0; i < steps; i += 1) {
      const [x, y, z] = playerWorldFloat();
      const nextY = y + stepY;
      if (!playerCollidesAt(x, nextY, z)) {
        setPlayerWorldFloat(x, nextY, z);
        continue;
      }
      player.velocityY = 0;
      if (stepY < 0) {
        const ground = groundYAt(x, z, { maxTopY: y + cfg.groundSnapUp });
        setPlayerWorldFloat(x, ground, z);
        player.grounded = true;
      }
      return;
    }
  }

  function resolvePlayerPenetration() {
    const player = getPlayer?.();
    if (!player) return false;
    const [x, y, z] = playerWorldFloat();
    if (!playerCollidesAt(x, y, z)) return false;
    const escape = maxCollisionHorizontalExtent(playerCollisionBoxes(), playerCollisionYaw()) + metersToBlocks(0.04);
    const candidates = [
      [0, 0],
      [escape, 0],
      [-escape, 0],
      [0, escape],
      [0, -escape],
      [escape, escape],
      [-escape, escape],
      [escape, -escape],
      [-escape, -escape],
    ];
    for (const [ox, oz] of candidates) {
      const nx = x + ox;
      const nz = z + oz;
      const ny = Math.max(y, groundYAt(nx, nz, { maxTopY: y + cfg.groundSnapUp }));
      if (!playerCollidesAt(nx, ny, nz)) {
        setPlayerWorldFloat(nx, ny, nz);
        player.velocityY = 0;
        player.grounded = true;
        return true;
      }
    }
    return liftPlayerOutOfCollision().moved;
  }

  function liftPlayerOutOfCollision({ maxRise = 128 } = {}) {
    const player = getPlayer?.();
    if (!player) return { moved: false, reason: "player-unavailable" };
    const [x, startY, z] = playerWorldFloat();
    if (!playerCollidesAt(x, startY, z)) {
      return { moved: false, reason: "already-clear", fromY: startY, toY: startY };
    }

    const riseLimit = Math.max(1, Math.min(4096, Number(maxRise) || 128));
    const limitY = startY + riseLimit;
    let candidateY = startY;
    for (let iteration = 0; iteration < 512 && candidateY <= limitY; iteration += 1) {
      const escapeY = nextUpwardEscapeY(x, candidateY, z);
      if (escapeY == null) {
        const ground = groundYAt(x, z, { maxTopY: candidateY + cfg.groundSnapUp });
        const onSurface = Number.isFinite(ground)
          && Math.abs(candidateY - ground) <= Math.max(cfg.groundSnapUp, cfg.collisionEpsilon * 2)
          && !playerCollidesAt(x, ground, z);
        const settledY = onSurface ? ground : candidateY;
        setPlayerWorldFloat(x, settledY, z);
        player.velocityY = 0;
        player.grounded = !player.flightEnabled;
        cameraFocusReady = false;
        return {
          moved: true,
          reason: "lifted",
          fromY: startY,
          toY: settledY,
          rise: settledY - startY,
        };
      }
      if (!Number.isFinite(escapeY) || escapeY <= candidateY + cfg.collisionEpsilon * 0.5) break;
      candidateY = escapeY;
    }
    return { moved: false, reason: "no-upward-clearance", fromY: startY, toY: startY };
  }

  function nextUpwardEscapeY(x, y, z) {
    let colliding = false;
    let requiredY = y;
    for (const box of prepareCollisionBoxes(playerCollisionBoxes(), x, y, z, playerCollisionYaw())) {
      const minX = Math.floor(box.minX + cfg.collisionEpsilon);
      const maxX = Math.floor(box.maxX - cfg.collisionEpsilon);
      const minY = Math.floor(box.minY + cfg.collisionEpsilon);
      const maxY = Math.floor(box.maxY - cfg.collisionEpsilon);
      const minZ = Math.floor(box.minZ + cfg.collisionEpsilon);
      const maxZ = Math.floor(box.maxZ - cfg.collisionEpsilon);
      for (let by = minY; by <= maxY; by += 1) {
        for (let bz = minZ; bz <= maxZ; bz += 1) {
          for (let bx = minX; bx <= maxX; bx += 1) {
            if (!isBlockingBlock(collisionBlockAt(bx, by, bz))) continue;
            if (!preparedCollisionBoxIntersectsBlock(box, bx, by, bz, cfg.collisionEpsilon)) continue;
            colliding = true;
            requiredY = Math.max(requiredY, y + (by + 1 + cfg.collisionEpsilon - box.minY));
          }
        }
      }
    }
    return colliding ? requiredY : null;
  }

  function groundYAt(x, z, options = {}) {
    const chunks = getChunks?.();
    if (!chunks) return 0;
    const boxes = Number.isFinite(options.radius)
      ? [createCollisionBox({ halfWidth: options.radius, halfDepth: options.radius, height: cfg.playerBodyHeight })]
      : (options.collisionBoxes ?? playerCollisionBoxes());
    const preparedBoxes = prepareCollisionBoxes(boxes, x, 0, z, options.yaw ?? playerCollisionYaw());
    const maxTopY = Number.isFinite(options.maxTopY) ? options.maxTopY : Infinity;
    let ground = -Infinity;
    for (const box of preparedBoxes) {
      const minX = Math.floor(box.minX + cfg.collisionEpsilon);
      const maxX = Math.floor(box.maxX - cfg.collisionEpsilon);
      const minZ = Math.floor(box.minZ + cfg.collisionEpsilon);
      const maxZ = Math.floor(box.maxZ - cfg.collisionEpsilon);
      for (let bz = minZ; bz <= maxZ; bz += 1) {
        for (let bx = minX; bx <= maxX; bx += 1) {
          if (!preparedCollisionFootprintIntersectsBlock(box, bx, bz, cfg.collisionEpsilon)) continue;
          ground = Math.max(ground, columnGroundYAt(bx, bz, maxTopY));
        }
      }
    }
    return Number.isFinite(ground) ? ground : chunks.minY + 1;
  }

  function columnGroundYAt(bx, bz, maxTopY = Infinity) {
    const chunks = getChunks?.();
    if (!chunks) return -Infinity;
    const worldTop = chunks.minY + chunks.height - 1;
    const cappedTop = Number.isFinite(maxTopY)
      ? Math.min(worldTop, Math.floor(maxTopY - 1 + cfg.collisionEpsilon))
      : worldTop;
    const maxBlockY = Number.isFinite(maxTopY)
      ? Math.floor(maxTopY - 1 + cfg.collisionEpsilon)
      : Infinity;
    if (typeof chunks.getCollisionTopAtWorld === "function") {
      return chunks.getCollisionTopAtWorld(bx, bz, maxBlockY);
    }
    for (let by = cappedTop; by >= chunks.minY; by -= 1) {
      if (isBlockingBlock(collisionBlockAt(bx, by, bz))) return by + 1;
    }
    return -Infinity;
  }

  function playerCollidesAt(x, y, z) {
    for (const box of prepareCollisionBoxes(playerCollisionBoxes(), x, y, z, playerCollisionYaw())) {
      const minX = Math.floor(box.minX + cfg.collisionEpsilon);
      const maxX = Math.floor(box.maxX - cfg.collisionEpsilon);
      const minY = Math.floor(box.minY + cfg.collisionEpsilon);
      const maxY = Math.floor(box.maxY - cfg.collisionEpsilon);
      const minZ = Math.floor(box.minZ + cfg.collisionEpsilon);
      const maxZ = Math.floor(box.maxZ - cfg.collisionEpsilon);
      for (let by = minY; by <= maxY; by += 1) {
        for (let bz = minZ; bz <= maxZ; bz += 1) {
          for (let bx = minX; bx <= maxX; bx += 1) {
            if (!isBlockingBlock(collisionBlockAt(bx, by, bz))) continue;
            if (preparedCollisionBoxIntersectsBlock(box, bx, by, bz, cfg.collisionEpsilon)) return true;
          }
        }
      }
    }
    return false;
  }

  function playerCollisionBoxes() {
    const player = getPlayer?.();
    const body = player?.collisionBoxes?.length ? player.collisionBoxes : [defaultCollisionBox];
    const equipment = Array.isArray(player?.equipmentCollisionBoxes) ? player.equipmentCollisionBoxes : [];
    return equipment.length ? body.concat(equipment) : body;
  }

  function playerCollisionYaw() {
    // Keep collision stable while the visual avatar rotates. The body still uses
    // real model extents, but changing yaw must not push a stationary player into
    // nearby voxel corners and lock movement.
    return 0;
  }

  function collisionBlockAt(worldX, worldY, worldZ) {
    const chunks = getChunks?.();
    if (!chunks) return 0;
    return chunks.getCollisionBlockAtWorld
      ? chunks.getCollisionBlockAtWorld(worldX, worldY, worldZ)
      : chunks.getBlockAtWorld(worldX, worldY, worldZ);
  }

  function setPlayerCollisionBoxes(boxes) {
    const player = getPlayer?.();
    if (!player) return;
    const valid = (boxes ?? []).filter((box) => box && box.halfWidth > 0 && box.halfDepth > 0 && box.height > 0);
    player.collisionBoxes = valid.length ? valid : [defaultCollisionBox];
    player.radius = maxCollisionHorizontalExtent(playerCollisionBoxes(), playerCollisionYaw());
    player.bodyHeight = player.collisionBoxes.reduce((maxY, box) => Math.max(maxY, box.offsetY + box.height), 0);
  }

  function metersToBlocks(value) {
    return Number(value) / cfg.blockSizeMeters;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function distanceSquared(ax, ay, az, bx, by, bz) {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}
