const WATER_SPLASH_EMIT_MS = 88;
const WATER_SPLASH_MIN_MOVE = 0.10;

export function createPlayEffects({
  getRenderer = () => null,
  getChunks = () => null,
  getPlayerPosition = () => [0, 0, 0],
  isFluidBlock = () => false,
  isBlockingBlock = () => false,
} = {}) {
  const waterSplashState = {
    lastX: null,
    lastY: null,
    lastZ: null,
    lastEmitAt: 0,
  };
  const particleCollision = { groundHeightAt: particleGroundHeightAt };

  return {
    update,
    resetWaterSplash,
    emitConfirmedBlockFracture,
  };

  function update(now, dt) {
    updateWaterSplash(now);
    return getRenderer()?.updateVoxelParticles?.(dt, particleCollision) ?? 0;
  }

  function emitConfirmedBlockFracture(pending) {
    const source = Array.isArray(pending?.blocks) && pending.blocks.length ? pending.blocks : [pending];
    const blocks = source.map((block) => ({
      worldX: Math.trunc(Number(block?.worldX ?? block?.x)),
      worldY: Math.trunc(Number(block?.worldY ?? block?.y)),
      worldZ: Math.trunc(Number(block?.worldZ ?? block?.z)),
      blockId: Math.trunc(Number(block?.blockId)),
    })).filter((block) => [block.worldX, block.worldY, block.worldZ, block.blockId].every(Number.isFinite) && block.blockId > 0);
    if (!blocks.length) return false;
    return getRenderer()?.emitVoxelParticles?.("fracture", { blocks }) ?? false;
  }

  function updateWaterSplash(now) {
    const renderer = getRenderer();
    const chunks = getChunks();
    if (!renderer || !chunks) return;
    const [x, y, z] = getPlayerPosition();
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;

    const lastX = waterSplashState.lastX;
    const lastY = waterSplashState.lastY;
    const lastZ = waterSplashState.lastZ;
    waterSplashState.lastX = x;
    waterSplashState.lastY = y;
    waterSplashState.lastZ = z;
    if (lastX === null || lastY === null || lastZ === null) return;

    const dx = x - lastX;
    const dz = z - lastZ;
    const horizontalMove = Math.hypot(dx, dz);
    if (horizontalMove < WATER_SPLASH_MIN_MOVE || now - waterSplashState.lastEmitAt < WATER_SPLASH_EMIT_MS) return;

    const waterY = waterSurfaceBlockYAt(chunks, x, y, z);
    if (waterY === null) return;
    waterSplashState.lastEmitAt = now;
    const forwardScale = Math.min(0.42, horizontalMove * 0.7);
    renderer.emitVoxelParticles("splash", {
      worldX: Math.floor(x),
      worldY: waterY,
      worldZ: Math.floor(z),
      pointX: x + (dx / Math.max(0.0001, horizontalMove)) * forwardScale,
      pointY: waterY + 1.01,
      pointZ: z + (dz / Math.max(0.0001, horizontalMove)) * forwardScale,
      count: Math.max(2, Math.min(7, Math.ceil(horizontalMove * 10))),
    });
  }

  function waterSurfaceBlockYAt(chunks, x, y, z) {
    const worldX = Math.floor(x);
    const worldZ = Math.floor(z);
    const centerY = Math.floor(y);
    for (let offset = 1; offset >= -2; offset -= 1) {
      const worldY = centerY + offset;
      if (isFluidBlock(chunks.getBlockAtWorld(worldX, worldY, worldZ))) return worldY;
    }
    return null;
  }

  function particleGroundHeightAt(x, z, upperY, lowerY) {
    const chunks = getChunks();
    if (!chunks || ![x, z, upperY, lowerY].every(Number.isFinite)) return null;
    const worldX = Math.floor(x);
    const worldZ = Math.floor(z);
    const top = Math.floor(Math.max(upperY, lowerY) + 0.001);
    const bottom = Math.floor(Math.min(upperY, lowerY) - 0.001);
    const scanBottom = Math.max(bottom, top - 4);
    for (let worldY = top; worldY >= scanBottom; worldY -= 1) {
      if (isBlockingBlock(chunks.getBlockAtWorld(worldX, worldY, worldZ))) return worldY + 1;
    }
    return null;
  }

  function resetWaterSplash() {
    waterSplashState.lastX = null;
    waterSplashState.lastY = null;
    waterSplashState.lastZ = null;
    waterSplashState.lastEmitAt = 0;
  }
}
