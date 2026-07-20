import {
  BLOCK_ID,
  DEFAULT_CHUNK_SIZE,
  blockDef,
  createWorldGeneratorConfig,
  surfaceBlockAt,
  terrainSurfaceHeight,
  waterLevelAt,
} from "/chunk.js/play.js";

const MAP_CACHE_LIMIT = 900;
const SMALL_UPDATE_MS = 180;
const SMALL_MAP_RECENTER_BLOCKS = 4;
const LARGE_UPDATE_MS = 120;
const SMALL_MAP_TEXTURE_SIZE = 240;
const MAP_TILE_PIXELS = 32;
const MAP_SMALL_TILE_SAMPLES = 16;
const MAP_MIN_SCREEN_CELL_PX = 3;
const MAP_SMALL_MIN_SCREEN_CELL_PX = 2;
const MAP_LARGE_NEW_TILE_BUDGET_MS = 4.5;
const MAP_LARGE_DRAG_TILE_BUDGET_MS = 2.5;
const MAP_SMALL_NEW_TILE_BUDGET_MS = 2.2;
const MAP_FALLBACK_CACHE_LIMIT = 1800;
const MAP_WORKER_PENDING_LIMIT = 48;
const LARGE_INTERACTIVE_PREVIEW_MS = 110;
const MAP_MAX_WORLD_STEP = 131072;
const LARGE_MIN_SCALE = 1 / 4096;
const LARGE_MAX_SCALE = 1024;
const GUARDIAN_REGION_SIZE_CHUNKS = 100;

export function createPlayMinimap({
  elements,
  worldSeed,
  getPlayerPosition = () => [0, 0, 0],
  getCameraHeading = () => 0,
  getViewDistance = () => 7,
  getGuardianSnapshot = () => null,
  onTeleport = () => {},
  setStatus = () => {},
} = {}) {
  const config = createWorldGeneratorConfig({ worldSeed });
  const chunkSize = config.chunkSize || DEFAULT_CHUNK_SIZE;
  const tileCache = new Map();
  const fallbackCache = new Map();
  const state = {
    lastSmallAt: 0,
    smallDirty: true,
    smallCssWidth: 0,
    smallCssHeight: 0,
    lastLargeAt: 0,
    expanded: false,
    largeScale: 1,
    viewX: 0,
    viewZ: 0,
    dragging: false,
    dragX: 0,
    dragY: 0,
    dragViewX: 0,
    dragViewZ: 0,
    activePointers: new Map(),
    pinchStartDistance: 0,
    pinchStartScale: 1,
    pinchWorldX: 0,
    pinchWorldZ: 0,
    largeDrawPending: false,
    previewTilesUntil: 0,
    largeDetailTimer: 0,
    smallTerrainCanvas: null,
    smallTerrainContext: null,
    smallSoftCanvas: null,
    smallSoftContext: null,
    smallBaseCanvas: null,
    smallBaseContext: null,
    smallViewX: 0,
    smallViewZ: 0,
    smallScale: 1,
    smallViewDistance: 0,
    smallBaseVersion: 0,
    smallMarkerBaseVersion: -1,
    smallMarkerX: Number.NaN,
    smallMarkerZ: Number.NaN,
    smallMarkerHeading: Number.NaN,
    mapWorker: null,
    mapWorkerFailed: false,
    tileRequests: new Map(),
  };

  return {
    bind,
    update,
    updateHeading,
    invalidate,
    openLargeMap,
    closeLargeMap,
    teleportTo,
  };

  function bind() {
    startMapWorker();
    elements.minimapPanel?.addEventListener("pointerdown", (event) => event.stopPropagation());
    elements.minimapPanel?.addEventListener("pointerup", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openLargeMap();
    });
    elements.mapOverlay?.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.target === elements.mapOverlay) closeLargeMap();
    });
    elements.largeMinimap?.addEventListener("pointerdown", pointerDownLarge);
    elements.largeMinimap?.addEventListener("pointermove", pointerMoveLarge);
    elements.largeMinimap?.addEventListener("pointerup", pointerUpLarge);
    elements.largeMinimap?.addEventListener("pointercancel", pointerUpLarge);
    elements.largeMinimap?.addEventListener("pointerleave", pointerUpLarge);
    elements.largeMinimap?.addEventListener("wheel", wheelLarge, { passive: false });
    elements.mapTeleportForm?.addEventListener("submit", submitTeleport);
    elements.mapTeleportForm?.addEventListener("pointerdown", (event) => event.stopPropagation());
    elements.mapTeleportForm?.addEventListener("pointerup", (event) => event.stopPropagation());
  }

  function startMapWorker() {
    if (state.mapWorker || state.mapWorkerFailed || typeof Worker !== "function") return;
    try {
      const worker = new Worker(new URL("./play-minimap-worker.js", import.meta.url), {
        type: "module",
        name: "nicechunk-minimap",
      });
      state.mapWorker = worker;
      worker.addEventListener("message", handleMapWorkerMessage);
      worker.addEventListener("error", (event) => {
        console.warn("NiceChunk minimap worker unavailable; using bounded main-thread fallback.", event?.message || event);
        stopMapWorker();
      });
      worker.postMessage({ type: "init", worldSeed });
    } catch (error) {
      console.warn("NiceChunk minimap worker could not start; using bounded main-thread fallback.", error);
      stopMapWorker();
    }
  }

  function stopMapWorker() {
    state.mapWorker?.terminate?.();
    state.mapWorker = null;
    state.mapWorkerFailed = true;
    state.tileRequests.clear();
  }

  function handleMapWorkerMessage(event) {
    const message = event.data;
    if (!message?.key) return;
    const request = state.tileRequests.get(message.key);
    state.tileRequests.delete(message.key);
    if (!request) return;
    if (message.type === "error") {
      console.warn("NiceChunk minimap tile worker failed; switching to fallback.", message.error || message.key);
      stopMapWorker();
      return;
    }
    if (message.type !== "tile" || !message.pixels) return;
    const samples = Math.max(1, Math.trunc(Number(message.samples) || request.samples));
    const canvas = document.createElement("canvas");
    canvas.width = samples;
    canvas.height = samples;
    const tileContext = canvas.getContext("2d", { alpha: false });
    const image = tileContext.createImageData(samples, samples);
    image.data.set(message.pixels);
    tileContext.putImageData(image, 0, 0);
    tileCache.set(message.key, { canvas });
    pruneTileCache();
    if (request.small) state.smallDirty = true;
    else state.lastLargeAt = 0;
  }

  function update(force = false) {
    const now = performance.now();
    const [px, py, pz] = getPlayerPosition();
    updateCoordinateLabels(px, py, pz);
    if (state.expanded) updateMapStatus(px, pz);
    const smallCanvas = elements.minimap;
    const smallCssWidth = Math.max(1, smallCanvas?.clientWidth || 1);
    const smallCssHeight = Math.max(1, smallCanvas?.clientHeight || smallCssWidth);
    const smallMoved = Math.abs(px - state.smallViewX) >= SMALL_MAP_RECENTER_BLOCKS
      || Math.abs(pz - state.smallViewZ) >= SMALL_MAP_RECENTER_BLOCKS;
    const smallResized = smallCssWidth !== state.smallCssWidth || smallCssHeight !== state.smallCssHeight;
    const smallViewDistance = normalizedViewDistance();
    const smallRangeChanged = smallViewDistance !== state.smallViewDistance;
    if (force || ((state.smallDirty || smallMoved || smallResized || smallRangeChanged) && now - state.lastSmallAt >= SMALL_UPDATE_MS)) {
      state.lastSmallAt = now;
      syncSmallCanvasResolution(smallCanvas);
      const smallScale = smallMapScale(smallCanvas?.width, smallViewDistance);
      drawMap(smallCanvas, smallCanvas?.getContext("2d"), smallScale, px, pz, { small: true });
      state.smallViewDistance = smallViewDistance;
      state.smallDirty = false;
    }
    if (state.expanded && (force || now - state.lastLargeAt >= LARGE_UPDATE_MS)) {
      state.lastLargeAt = now;
      drawMap(elements.largeMinimap, elements.largeMinimap?.getContext("2d"), state.largeScale, state.viewX, state.viewZ, { small: false });
    }
  }

  function syncSmallCanvasResolution(canvas) {
    if (!canvas) return;
    const cssWidth = Math.max(1, canvas.clientWidth || 1);
    const cssHeight = Math.max(1, canvas.clientHeight || cssWidth);
    state.smallCssWidth = cssWidth;
    state.smallCssHeight = cssHeight;
    const width = SMALL_MAP_TEXTURE_SIZE;
    const height = SMALL_MAP_TEXTURE_SIZE;
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    state.smallBaseVersion += 1;
    state.smallMarkerBaseVersion = -1;
  }

  function invalidate() {
    state.smallDirty = true;
    state.lastSmallAt = 0;
  }

  function normalizedViewDistance() {
    return Math.max(1, Math.trunc(Number(getViewDistance?.()) || 1));
  }

  function smallMapScale(canvasWidth, viewDistance) {
    const visibleWorldBlocks = Math.max(chunkSize, (viewDistance * 2 + 1) * chunkSize);
    return Math.max(0.000001, Number(canvasWidth) || SMALL_MAP_TEXTURE_SIZE) / visibleWorldBlocks;
  }

  function updateHeading() {
    const canvas = elements.minimap;
    const base = state.smallBaseCanvas;
    if (!canvas || !base || base.width !== canvas.width || base.height !== canvas.height) return;
    const [px, , pz] = getPlayerPosition();
    const playerX = canvas.width * 0.5 + (px - state.smallViewX) * state.smallScale;
    const playerZ = canvas.height * 0.5 + (pz - state.smallViewZ) * state.smallScale;
    const rawHeading = Number(getCameraHeading());
    const heading = Number.isFinite(rawHeading) ? rawHeading : 0;
    const markerUnchanged = state.smallMarkerBaseVersion === state.smallBaseVersion
      && Math.abs(playerX - state.smallMarkerX) < 0.01
      && Math.abs(playerZ - state.smallMarkerZ) < 0.01
      && Math.abs(Math.atan2(Math.sin(heading - state.smallMarkerHeading), Math.cos(heading - state.smallMarkerHeading))) < 0.0001;
    if (markerUnchanged) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    restoreSmallMarkerRegion(ctx, base, playerX, playerZ);
    if (playerX > -24 && playerX < canvas.width + 24 && playerZ > -24 && playerZ < canvas.height + 24) {
      drawPlayer(ctx, playerX, playerZ, heading, 1);
    }
    rememberSmallMarker(playerX, playerZ, heading);
  }

  function restoreSmallMarkerRegion(ctx, base, nextX, nextZ) {
    if (state.smallMarkerBaseVersion !== state.smallBaseVersion
      || !Number.isFinite(state.smallMarkerX)
      || !Number.isFinite(state.smallMarkerZ)) {
      ctx.drawImage(base, 0, 0, base.width, base.height);
      return;
    }
    const radius = 18;
    const left = Math.max(0, Math.floor(Math.min(state.smallMarkerX, nextX) - radius));
    const top = Math.max(0, Math.floor(Math.min(state.smallMarkerZ, nextZ) - radius));
    const right = Math.min(base.width, Math.ceil(Math.max(state.smallMarkerX, nextX) + radius));
    const bottom = Math.min(base.height, Math.ceil(Math.max(state.smallMarkerZ, nextZ) + radius));
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    if (width && height) ctx.drawImage(base, left, top, width, height, left, top, width, height);
  }

  function openLargeMap() {
    const [px, , pz] = getPlayerPosition();
    state.expanded = true;
    state.viewX = Number.isFinite(state.viewX) ? state.viewX || px : px;
    state.viewZ = Number.isFinite(state.viewZ) ? state.viewZ || pz : pz;
    if (elements.mapTeleportX) elements.mapTeleportX.value = Math.round(px * 10) / 10;
    if (elements.mapTeleportZ) elements.mapTeleportZ.value = Math.round(pz * 10) / 10;
    elements.mapOverlay?.classList.add("open");
    elements.mapOverlay?.setAttribute("aria-hidden", "false");
    previewLargeTiles();
    scheduleLargeDraw(true);
  }

  function closeLargeMap() {
    state.expanded = false;
    state.dragging = false;
    state.activePointers.clear();
    state.largeDrawPending = false;
    clearLargeDetailTimer();
    elements.mapOverlay?.classList.remove("open");
    elements.mapOverlay?.setAttribute("aria-hidden", "true");
  }

  function teleportTo(x, z) {
    const nextX = Number(x);
    const nextZ = Number(z);
    if (!Number.isFinite(nextX) || !Number.isFinite(nextZ)) return false;
    onTeleport(nextX, nextZ);
    state.viewX = nextX;
    state.viewZ = nextZ;
    if (elements.mapTeleportStatus) elements.mapTeleportStatus.textContent = `Loaded map target ${nextX.toFixed(1)}, ${nextZ.toFixed(1)}.`;
    setStatus(`Map loaded position ${nextX.toFixed(1)}, ${nextZ.toFixed(1)}.`);
    previewLargeTiles();
    scheduleLargeDraw(true);
    return true;
  }

  function submitTeleport(event) {
    event.preventDefault();
    const ok = teleportTo(elements.mapTeleportX?.value, elements.mapTeleportZ?.value);
    if (!ok && elements.mapTeleportStatus) elements.mapTeleportStatus.textContent = "Enter valid X and Z coordinates.";
  }

  function pointerDownLarge(event) {
    event.preventDefault();
    event.stopPropagation();
    state.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    state.dragging = true;
    state.dragX = event.clientX;
    state.dragY = event.clientY;
    state.dragViewX = state.viewX;
    state.dragViewZ = state.viewZ;
    if (state.activePointers.size >= 2) startPinchGesture();
    safeSetPointerCapture(elements.largeMinimap, event.pointerId);
    elements.mapOverlay?.querySelector(".map-modal")?.classList.add("dragging");
    previewLargeTiles();
  }

  function pointerMoveLarge(event) {
    if (!state.dragging && !state.activePointers.has(event.pointerId)) return;
    event.preventDefault();
    event.stopPropagation();
    if (state.activePointers.has(event.pointerId)) state.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.activePointers.size >= 2) {
      updatePinchGesture();
      scheduleLargeDraw();
      return;
    }
    if (!state.dragging) return;
    const dx = event.clientX - state.dragX;
    const dz = event.clientY - state.dragY;
    state.viewX = state.dragViewX - dx / state.largeScale;
    state.viewZ = state.dragViewZ - dz / state.largeScale;
    previewLargeTiles();
    scheduleLargeDraw();
  }

  function pointerUpLarge(event) {
    state.activePointers.delete(event.pointerId);
    if (state.activePointers.size >= 2) {
      startPinchGesture();
      return;
    }
    if (state.activePointers.size === 1) {
      const pointer = Array.from(state.activePointers.values())[0];
      state.dragX = pointer.x;
      state.dragY = pointer.y;
      state.dragViewX = state.viewX;
      state.dragViewZ = state.viewZ;
      state.dragging = true;
      return;
    }
    state.dragging = false;
    safeReleasePointerCapture(elements.largeMinimap, event.pointerId);
    elements.mapOverlay?.querySelector(".map-modal")?.classList.remove("dragging");
    state.previewTilesUntil = 0;
    scheduleLargeDraw(true);
  }

  function wheelLarge(event) {
    event.preventDefault();
    const oldScale = state.largeScale;
    const factor = event.deltaY < 0 ? 1.18 : 1 / 1.18;
    const nextScale = clamp(state.largeScale * factor, LARGE_MIN_SCALE, LARGE_MAX_SCALE);
    if (oldScale === nextScale) return;
    zoomLargeMapAt(event.clientX, event.clientY, oldScale, nextScale);
    previewLargeTiles();
    scheduleLargeDraw(true);
  }

  function startPinchGesture() {
    const points = Array.from(state.activePointers.values());
    if (points.length < 2) return;
    const a = points[0];
    const b = points[1];
    const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
    state.pinchStartDistance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    state.pinchStartScale = state.largeScale;
    const world = screenToLargeMapWorld(mid.x, mid.y, state.largeScale);
    state.pinchWorldX = world.x;
    state.pinchWorldZ = world.z;
  }

  function updatePinchGesture() {
    const points = Array.from(state.activePointers.values());
    if (points.length < 2) return;
    const a = points[0];
    const b = points[1];
    const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const oldScale = state.largeScale;
    const nextScale = clamp(state.pinchStartScale * (distance / Math.max(1, state.pinchStartDistance)), LARGE_MIN_SCALE, LARGE_MAX_SCALE);
    if (oldScale === nextScale) return;
    state.largeScale = nextScale;
    centerLargeMapOnWorldAtScreen(state.pinchWorldX, state.pinchWorldZ, mid.x, mid.y, nextScale);
    previewLargeTiles();
  }

  function zoomLargeMapAt(clientX, clientY, oldScale, nextScale) {
    const world = screenToLargeMapWorld(clientX, clientY, oldScale);
    state.largeScale = nextScale;
    centerLargeMapOnWorldAtScreen(world.x, world.z, clientX, clientY, nextScale);
  }

  function screenToLargeMapWorld(clientX, clientY, scale) {
    const canvas = elements.largeMinimap;
    const rect = canvas?.getBoundingClientRect();
    if (!canvas || !rect) return { x: state.viewX, z: state.viewZ };
    const sx = (clientX - rect.left) * (canvas.width / Math.max(1, rect.width));
    const sz = (clientY - rect.top) * (canvas.height / Math.max(1, rect.height));
    return {
      x: state.viewX + (sx - canvas.width * 0.5) / Math.max(LARGE_MIN_SCALE, scale),
      z: state.viewZ + (sz - canvas.height * 0.5) / Math.max(LARGE_MIN_SCALE, scale),
    };
  }

  function centerLargeMapOnWorldAtScreen(worldX, worldZ, clientX, clientY, scale) {
    const canvas = elements.largeMinimap;
    const rect = canvas?.getBoundingClientRect();
    if (!canvas || !rect) return;
    const sx = (clientX - rect.left) * (canvas.width / Math.max(1, rect.width));
    const sz = (clientY - rect.top) * (canvas.height / Math.max(1, rect.height));
    state.viewX = worldX - (sx - canvas.width * 0.5) / Math.max(LARGE_MIN_SCALE, scale);
    state.viewZ = worldZ - (sz - canvas.height * 0.5) / Math.max(LARGE_MIN_SCALE, scale);
  }

  function scheduleLargeDraw(force = false) {
    if (!state.expanded || state.largeDrawPending) return;
    state.largeDrawPending = true;
    requestAnimationFrame(() => {
      state.largeDrawPending = false;
      if (!state.expanded) return;
      state.lastLargeAt = performance.now();
      drawMap(elements.largeMinimap, elements.largeMinimap?.getContext("2d"), state.largeScale, state.viewX, state.viewZ, { small: false, force });
    });
  }

  function previewLargeTiles() {
    state.previewTilesUntil = performance.now() + LARGE_INTERACTIVE_PREVIEW_MS;
    scheduleLargeDetailDraw();
  }

  function scheduleLargeDetailDraw() {
    clearLargeDetailTimer();
    state.largeDetailTimer = globalThis.setTimeout(() => {
      state.largeDetailTimer = 0;
      state.previewTilesUntil = 0;
      scheduleLargeDraw(true);
    }, LARGE_INTERACTIVE_PREVIEW_MS + 20);
  }

  function clearLargeDetailTimer() {
    if (!state.largeDetailTimer) return;
    globalThis.clearTimeout(state.largeDetailTimer);
    state.largeDetailTimer = 0;
  }

  function drawMap(canvas, ctx, scale, viewX, viewZ, { small } = {}) {
    if (!canvas || !ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    const terrainSurface = small ? smallMapTerrainSurface(width, height) : { canvas, ctx };
    const terrainCanvas = terrainSurface.canvas;
    const terrainCtx = terrainSurface.ctx;
    const centerX = width * 0.5;
    const centerZ = height * 0.5;
    const worldStep = mapWorldStepForScale(scale, small);
    const tileWorldSize = MAP_TILE_PIXELS * worldStep;
    const startedAt = performance.now();
    const tileBudgetMs = small
      ? MAP_SMALL_NEW_TILE_BUDGET_MS
      : state.dragging ? MAP_LARGE_DRAG_TILE_BUDGET_MS : MAP_LARGE_NEW_TILE_BUDGET_MS;
    terrainCtx.clearRect(0, 0, width, height);
    terrainCtx.fillStyle = "#11222a";
    terrainCtx.fillRect(0, 0, width, height);
    terrainCtx.imageSmoothingEnabled = Boolean(small);
    if (small) terrainCtx.imageSmoothingQuality = "high";

    const minWorldX = viewX - centerX / scale;
    const maxWorldX = viewX + centerX / scale;
    const minWorldZ = viewZ - centerZ / scale;
    const maxWorldZ = viewZ + centerZ / scale;
    const minTileX = Math.floor(minWorldX / tileWorldSize);
    const maxTileX = Math.floor(maxWorldX / tileWorldSize);
    const minTileZ = Math.floor(minWorldZ / tileWorldSize);
    const maxTileZ = Math.floor(maxWorldZ / tileWorldSize);

    for (let tileZ = minTileZ; tileZ <= maxTileZ; tileZ += 1) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
        const overBudget = performance.now() - startedAt > tileBudgetMs;
        const previewOnly = !small && performance.now() < state.previewTilesUntil;
        const tile = getMapTile(tileX, tileZ, worldStep, { allowBuild: !overBudget && !previewOnly, small });
        const worldX1 = tileX * tileWorldSize;
        const worldZ1 = tileZ * tileWorldSize;
        const drawX1 = Math.floor(centerX + (worldX1 - viewX) * scale);
        const drawZ1 = Math.floor(centerZ + (worldZ1 - viewZ) * scale);
        const drawX2 = Math.ceil(centerX + (worldX1 + tileWorldSize - viewX) * scale);
        const drawZ2 = Math.ceil(centerZ + (worldZ1 + tileWorldSize - viewZ) * scale);
        if (tile) terrainCtx.drawImage(tile, drawX1, drawZ1, drawX2 - drawX1, drawZ2 - drawZ1);
        else {
          const fallback = fallbackTileSurface(tileX, tileZ, worldStep, { soft: small });
          terrainCtx.drawImage(fallback, drawX1, drawZ1, drawX2 - drawX1, drawZ2 - drawZ1);
        }
      }
    }

    const minChunkX = Math.floor(minWorldX / chunkSize);
    const maxChunkX = Math.floor(maxWorldX / chunkSize);
    const minChunkZ = Math.floor(minWorldZ / chunkSize);
    const maxChunkZ = Math.floor(maxWorldZ / chunkSize);
    if (small) {
      state.smallViewX = viewX;
      state.smallViewZ = viewZ;
      state.smallScale = scale;
      paintSoftenedSmallMap(ctx, terrainCanvas, width, height);
    } else {
      drawChunkGrid(ctx, width, height, scale, viewX, viewZ, minChunkX, maxChunkX, minChunkZ, maxChunkZ, false);
    }
    const [px, , pz] = getPlayerPosition();
    const playerX = centerX + (px - viewX) * scale;
    const playerZ = centerZ + (pz - viewZ) * scale;
    if (!small) drawGuardianRegions(ctx, width, height, scale, viewX, viewZ);
    if (playerX > -24 && playerX < width + 24 && playerZ > -24 && playerZ < height + 24) {
      const rawHeading = Number(getCameraHeading());
      const heading = Number.isFinite(rawHeading) ? rawHeading : 0;
      drawPlayer(ctx, playerX, playerZ, heading, small ? 1 : 1.7);
      if (small) rememberSmallMarker(playerX, playerZ, heading);
    }
  }

  function smallMapTerrainSurface(width, height) {
    if (!state.smallTerrainCanvas) {
      state.smallTerrainCanvas = document.createElement("canvas");
      state.smallTerrainContext = state.smallTerrainCanvas.getContext("2d", { alpha: false });
    }
    if (state.smallTerrainCanvas.width !== width || state.smallTerrainCanvas.height !== height) {
      state.smallTerrainCanvas.width = width;
      state.smallTerrainCanvas.height = height;
    }
    return { canvas: state.smallTerrainCanvas, ctx: state.smallTerrainContext };
  }

  function paintSoftenedSmallMap(ctx, terrainCanvas, width, height) {
    const softWidth = Math.max(1, Math.round(width * 0.58));
    const softHeight = Math.max(1, Math.round(height * 0.58));
    if (!state.smallSoftCanvas) {
      state.smallSoftCanvas = document.createElement("canvas");
      state.smallSoftContext = state.smallSoftCanvas.getContext("2d", { alpha: false });
    }
    if (state.smallSoftCanvas.width !== softWidth || state.smallSoftCanvas.height !== softHeight) {
      state.smallSoftCanvas.width = softWidth;
      state.smallSoftCanvas.height = softHeight;
    }
    const softCtx = state.smallSoftContext;
    softCtx.imageSmoothingEnabled = true;
    softCtx.imageSmoothingQuality = "high";
    softCtx.clearRect(0, 0, softWidth, softHeight);
    softCtx.drawImage(terrainCanvas, 0, 0, softWidth, softHeight);

    if (!state.smallBaseCanvas) {
      state.smallBaseCanvas = document.createElement("canvas");
      state.smallBaseContext = state.smallBaseCanvas.getContext("2d", { alpha: false });
    }
    if (state.smallBaseCanvas.width !== width || state.smallBaseCanvas.height !== height) {
      state.smallBaseCanvas.width = width;
      state.smallBaseCanvas.height = height;
    }
    const baseCtx = state.smallBaseContext;
    baseCtx.save();
    baseCtx.clearRect(0, 0, width, height);
    baseCtx.imageSmoothingEnabled = true;
    baseCtx.imageSmoothingQuality = "high";
    baseCtx.drawImage(state.smallSoftCanvas, 0, 0, width, height);
    baseCtx.globalAlpha = 0.16;
    baseCtx.drawImage(terrainCanvas, 0, 0, width, height);
    baseCtx.restore();
    state.smallBaseVersion += 1;
    ctx.drawImage(state.smallBaseCanvas, 0, 0, width, height);
  }

  function rememberSmallMarker(x, z, heading) {
    state.smallMarkerBaseVersion = state.smallBaseVersion;
    state.smallMarkerX = x;
    state.smallMarkerZ = z;
    state.smallMarkerHeading = heading;
  }

  function getMapTile(tileX, tileZ, worldStep, { allowBuild = true, small = false } = {}) {
    const step = Math.max(1, Math.trunc(worldStep) || 1);
    const samples = small ? MAP_SMALL_TILE_SAMPLES : MAP_TILE_PIXELS;
    const key = `${step}:${samples}:${tileX},${tileZ}`;
    const cached = tileCache.get(key);
    if (cached) {
      touchCacheEntry(tileCache, key, cached);
      return cached.canvas;
    }
    if (!allowBuild) return null;
    if (state.mapWorker) {
      requestMapTile(key, tileX, tileZ, step, samples, small);
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = samples;
    canvas.height = samples;
    const ctx = canvas.getContext("2d", { willReadFrequently: false });
    const image = ctx.createImageData(samples, samples);
    const originX = tileX * MAP_TILE_PIXELS * step;
    const originZ = tileZ * MAP_TILE_PIXELS * step;
    const sampleScale = MAP_TILE_PIXELS / samples;
    for (let localZ = 0; localZ < samples; localZ += 1) {
      for (let localX = 0; localX < samples; localX += 1) {
        const worldX = originX + Math.floor((localX + 0.5) * sampleScale * step);
        const worldZ = originZ + Math.floor((localZ + 0.5) * sampleScale * step);
        const [r, g, b] = mapColorAt(worldX, worldZ, { soft: small });
        const offset = (localZ * samples + localX) * 4;
        image.data[offset] = r;
        image.data[offset + 1] = g;
        image.data[offset + 2] = b;
        image.data[offset + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    tileCache.set(key, { canvas });
    pruneTileCache();
    return canvas;
  }

  function requestMapTile(key, tileX, tileZ, worldStep, samples, small) {
    if (!state.mapWorker || state.tileRequests.has(key) || state.tileRequests.size >= MAP_WORKER_PENDING_LIMIT) return;
    state.tileRequests.set(key, { samples, small });
    state.mapWorker.postMessage({
      type: "tile",
      key,
      tileX,
      tileZ,
      worldStep,
      tilePixels: MAP_TILE_PIXELS,
      samples,
    });
  }

  function fallbackTileSurface(tileX, tileZ, worldStep, { soft = false } = {}) {
    const step = Math.max(1, Math.trunc(worldStep) || 1);
    const key = `${step}:${soft ? 1 : 0}:${tileX},${tileZ}`;
    const cached = fallbackCache.get(key);
    if (cached) {
      touchCacheEntry(fallbackCache, key, cached);
      return cached.canvas;
    }
    const tileWorldSize = MAP_TILE_PIXELS * step;
    const originX = tileX * tileWorldSize;
    const originZ = tileZ * tileWorldSize;
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const tileContext = canvas.getContext("2d", { alpha: false });
    const image = tileContext.createImageData(2, 2);
    for (let localZ = 0; localZ < 2; localZ += 1) {
      for (let localX = 0; localX < 2; localX += 1) {
        const color = mapColorAt(
          originX + localX * tileWorldSize,
          originZ + localZ * tileWorldSize,
          { soft },
        );
        const offset = (localZ * 2 + localX) * 4;
        image.data[offset] = color[0];
        image.data[offset + 1] = color[1];
        image.data[offset + 2] = color[2];
        image.data[offset + 3] = 255;
      }
    }
    tileContext.putImageData(image, 0, 0);
    fallbackCache.set(key, { canvas });
    pruneFallbackCache();
    return canvas;
  }

  function mapColorAt(worldX, worldZ, { soft = false } = {}) {
    const surface = terrainSurfaceHeight(config, worldX, worldZ);
    const water = waterLevelAt(config, worldX, worldZ, surface);
    const blockId = water !== null && water > surface ? BLOCK_ID.water : surfaceBlockAt(config, worldX, worldZ, surface);
    const base = baseColor(blockId);
    const relativeHeight = surface - config.seaLevel;
    const shade = clamp(Math.round(relativeHeight * 2.15), -48, 66);
    const waterShade = blockId === BLOCK_ID.water ? clamp(Math.round((config.seaLevel - surface) * 5.2), 0, 92) : 0;
    const detail = terrainDetail(worldX, worldZ) * (soft ? 0.36 : 1);
    const contour = contourShade(surface, blockId === BLOCK_ID.water) * (soft ? 0.24 : 1);
    const biomeBoost = biomeContrast(blockId, relativeHeight);
    return [
      clampInt(base[0] + shade * 0.36 - waterShade * 0.18 + detail + contour + biomeBoost[0], 0, 255),
      clampInt(base[1] + shade * 0.36 - waterShade * 0.02 + detail + contour + biomeBoost[1], 0, 255),
      clampInt(base[2] + shade * 0.36 + waterShade * 0.46 + detail + contour + biomeBoost[2], 0, 255),
    ];
  }

  function baseColor(blockId) {
    switch (blockId) {
      case BLOCK_ID.water:
      case BLOCK_ID.swampWater:
      case BLOCK_ID.toxicWater:
        return [32, 145, 214];
      case BLOCK_ID.sand:
      case BLOCK_ID.saltFlat:
      case BLOCK_ID.shellBed:
        return [226, 197, 109];
      case BLOCK_ID.snow:
      case BLOCK_ID.ice:
      case BLOCK_ID.frozenSoil:
        return [232, 240, 232];
      case BLOCK_ID.stone:
      case BLOCK_ID.deepStone:
      case BLOCK_ID.gravel:
        return [126, 134, 126];
      case BLOCK_ID.basalt:
      case BLOCK_ID.ash:
        return [90, 88, 84];
      case BLOCK_ID.mud:
      case BLOCK_ID.clay:
        return [142, 103, 64];
      case BLOCK_ID.dryDirt:
      case BLOCK_ID.dirt:
        return [148, 96, 53];
      case BLOCK_ID.trunk:
      case BLOCK_ID.pineTrunk:
      case BLOCK_ID.deadWood:
      case BLOCK_ID.giantRoot:
        return [116, 73, 42];
      case BLOCK_ID.leaves:
      case BLOCK_ID.pineLeaves:
      case BLOCK_ID.bush:
      case BLOCK_ID.grassPlant:
      case BLOCK_ID.swampGrass:
        return [47, 128, 59];
      default: {
        const def = blockDef(blockId);
        return def.resourceId === 0 ? [94, 153, 78] : [84, 170, 70];
      }
    }
  }

  function drawChunkGrid(ctx, width, height, scale, viewX, viewZ, minChunkX, maxChunkX, minChunkZ, maxChunkZ, small) {
    if (scale < 0.8 && small) return;
    if (scale * chunkSize < 6) return;
    if ((maxChunkX - minChunkX + 1) + (maxChunkZ - minChunkZ + 1) > 180) return;
    ctx.strokeStyle = small ? "rgba(4, 18, 28, 0.16)" : "rgba(235, 250, 255, 0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let chunkX = minChunkX; chunkX <= maxChunkX + 1; chunkX += 1) {
      const x = Math.round(width * 0.5 + (chunkX * chunkSize - viewX) * scale) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ + 1; chunkZ += 1) {
      const z = Math.round(height * 0.5 + (chunkZ * chunkSize - viewZ) * scale) + 0.5;
      ctx.moveTo(0, z);
      ctx.lineTo(width, z);
    }
    ctx.stroke();
  }

  function drawPlayer(ctx, x, z, yaw, scale = 1) {
    const size = 8 * scale;
    ctx.save();
    ctx.translate(x, z);
    ctx.rotate(-yaw);
    ctx.beginPath();
    ctx.arc(0, 0, size * 1.62, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 247, 183, 0.20)";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -size * 1.25);
    ctx.lineTo(size * 0.78, size * 0.85);
    ctx.lineTo(0, size * 0.42);
    ctx.lineTo(-size * 0.78, size * 0.85);
    ctx.closePath();
    ctx.fillStyle = "#f8fbff";
    ctx.strokeStyle = "rgba(2, 18, 30, 0.7)";
    ctx.lineWidth = Math.max(1, 1.4 * scale);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawGuardianRegions(ctx, width, height, scale, viewX, viewZ) {
    const snapshot = getGuardianSnapshot?.();
    const registry = snapshot?.registry || null;
    const regions = Array.isArray(registry?.regions) ? registry.regions : [];
    if (!regions.length) return;
    const activeRegion = currentGuardianRegionKey(snapshot);
    for (const region of regions) {
      const rect = guardianRegionWorldRect(region);
      if (!rect) continue;
      const x1 = width * 0.5 + (rect.minX - viewX) * scale;
      const z1 = height * 0.5 + (rect.minZ - viewZ) * scale;
      const x2 = width * 0.5 + (rect.maxX - viewX) * scale;
      const z2 = height * 0.5 + (rect.maxZ - viewZ) * scale;
      if (x2 < -32 || x1 > width + 32 || z2 < -32 || z1 > height + 32) continue;
      const status = String(region.status || "unknown");
      const isActive = activeRegion && activeRegion === `${region.regionX},${region.regionY}`;
      ctx.save();
      ctx.lineWidth = isActive ? 3 : 1.5;
      ctx.setLineDash(status === "missing" ? [8, 6] : status === "error" ? [3, 5] : []);
      ctx.strokeStyle = isActive
        ? "rgba(255, 245, 160, 0.92)"
        : status === "active" ? "rgba(92, 225, 170, 0.64)" : status === "error" ? "rgba(255, 114, 114, 0.58)" : "rgba(210, 230, 238, 0.30)";
      ctx.fillStyle = isActive
        ? "rgba(255, 236, 128, 0.075)"
        : status === "active" ? "rgba(70, 210, 160, 0.050)" : status === "error" ? "rgba(255, 80, 80, 0.045)" : "rgba(220, 238, 245, 0.028)";
      ctx.fillRect(Math.floor(x1), Math.floor(z1), Math.ceil(x2 - x1), Math.ceil(z2 - z1));
      ctx.strokeRect(Math.floor(x1) + 0.5, Math.floor(z1) + 0.5, Math.ceil(x2 - x1), Math.ceil(z2 - z1));
      if ((x2 - x1) > 86 && (z2 - z1) > 38) {
        ctx.font = "800 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        ctx.fillStyle = isActive ? "rgba(255, 250, 207, 0.92)" : "rgba(220, 248, 255, 0.72)";
        ctx.fillText(`${status} guardian ${region.regionX},${region.regionY}`, Math.max(8, x1 + 9), Math.max(18, z1 + 17));
      }
      ctx.restore();
    }
  }

  function updateMapStatus(px, pz) {
    if (!elements.mapStatus) return;
    const chunkX = Math.floor(px / chunkSize);
    const chunkZ = Math.floor(pz / chunkSize);
    const snapshot = getGuardianSnapshot?.();
    const registry = snapshot?.registry || null;
    const current = cachedGuardianRegionForChunk(registry, chunkX, chunkZ);
    const remoteCount = Math.max(0, Math.trunc(Number(snapshot?.remotePlayers) || 0));
    const cacheText = registry ? `${Math.trunc(Number(registry.cachedRegions) || 0)} cached · ${Math.trunc(Number(registry.inFlight) || 0)} loading` : "registry idle";
    let text = "";
    if (current?.status === "active" && current.guardian?.host) {
      text = `Guardian ${endpointLabel(current.guardian)} · region ${current.regionX},${current.regionY} · chunk ${chunkX},${chunkZ} · ${remoteCount} remote · ${cacheText}`;
    } else if (registry?.lastError) {
      text = `Guardian registry error: ${registry.lastError} · chunk ${chunkX},${chunkZ} · ${cacheText}`;
    } else {
      text = `Deterministic NiceChunk world map · visual only · chunk ${chunkX},${chunkZ} · guardian ${current?.status || "not cached"} · ${cacheText}`;
    }
    if (elements.mapStatus.textContent !== text) elements.mapStatus.textContent = text;
  }

  function cachedGuardianRegionForChunk(registry, chunkX, chunkZ) {
    const regions = Array.isArray(registry?.regions) ? registry.regions : [];
    if (!regions.length) return null;
    const regionX = Math.floor(Math.trunc(chunkX) / GUARDIAN_REGION_SIZE_CHUNKS);
    const regionY = Math.floor(Math.trunc(chunkZ) / GUARDIAN_REGION_SIZE_CHUNKS);
    return regions.find((region) => Math.trunc(Number(region.regionX) || 0) === regionX && Math.trunc(Number(region.regionY) || 0) === regionY) || null;
  }

  function guardianRegionWorldRect(region) {
    const guardian = region?.guardian || null;
    const minChunkX = Number.isFinite(guardian?.minChunkX) ? guardian.minChunkX : Math.trunc(Number(region?.regionX) || 0) * GUARDIAN_REGION_SIZE_CHUNKS;
    const minChunkZ = Number.isFinite(guardian?.minChunkY) ? guardian.minChunkY : Math.trunc(Number(region?.regionY) || 0) * GUARDIAN_REGION_SIZE_CHUNKS;
    const maxChunkX = Number.isFinite(guardian?.maxChunkX) ? guardian.maxChunkX : minChunkX + GUARDIAN_REGION_SIZE_CHUNKS - 1;
    const maxChunkZ = Number.isFinite(guardian?.maxChunkY) ? guardian.maxChunkY : minChunkZ + GUARDIAN_REGION_SIZE_CHUNKS - 1;
    if (![minChunkX, minChunkZ, maxChunkX, maxChunkZ].every(Number.isFinite)) return null;
    return {
      minX: minChunkX * chunkSize,
      minZ: minChunkZ * chunkSize,
      maxX: (maxChunkX + 1) * chunkSize,
      maxZ: (maxChunkZ + 1) * chunkSize,
    };
  }

  function currentGuardianRegionKey(snapshot) {
    const raw = String(snapshot?.registryRegion || "");
    const match = raw.match(/\|(-?\d+),(-?\d+)$/);
    return match ? `${match[1]},${match[2]}` : "";
  }

  function endpointLabel(guardian) {
    const scheme = guardian.useTls ? "wss" : "ws";
    return `${scheme}://${guardian.host}${guardian.port ? `:${guardian.port}` : ""}`;
  }

  function updateCoordinateLabels(px, py, pz) {
    const worldText = `XYZ: ${Math.floor(px)}, ${Math.floor(py)}, ${Math.floor(pz)}`;
    const chunkText = `Chunk: ${Math.floor(px / chunkSize)}, ${Math.floor(py / chunkSize)}, ${Math.floor(pz / chunkSize)}`;
    if (elements.minimapWorldCoord && elements.minimapWorldCoord.textContent !== worldText) elements.minimapWorldCoord.textContent = worldText;
    if (elements.minimapChunkCoord && elements.minimapChunkCoord.textContent !== chunkText) elements.minimapChunkCoord.textContent = chunkText;
  }

  function pruneTileCache() {
    pruneLruCache(tileCache, MAP_CACHE_LIMIT);
  }

  function pruneFallbackCache() {
    pruneLruCache(fallbackCache, MAP_FALLBACK_CACHE_LIMIT);
  }
}

function touchCacheEntry(cache, key, entry) {
  cache.delete(key);
  cache.set(key, entry);
}

function pruneLruCache(cache, limit) {
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

function terrainDetail(worldX, worldZ) {
  const n = Math.imul(Math.trunc(worldX), 374761393) ^ Math.imul(Math.trunc(worldZ), 668265263);
  const mixed = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((mixed >>> 28) - 7) * 2;
}

function contourShade(surface, underwater) {
  if (underwater) return 0;
  const fine = positiveModulo(surface, 8);
  const major = positiveModulo(surface, 24);
  if (major === 0) return -22;
  if (fine === 0) return -12;
  if (fine === 1) return 7;
  return 0;
}

function biomeContrast(blockId, relativeHeight) {
  switch (blockId) {
    case BLOCK_ID.water:
    case BLOCK_ID.swampWater:
    case BLOCK_ID.toxicWater:
      return [0, 4, 14];
    case BLOCK_ID.sand:
    case BLOCK_ID.saltFlat:
    case BLOCK_ID.shellBed:
      return [12, 6, -10];
    case BLOCK_ID.snow:
    case BLOCK_ID.ice:
    case BLOCK_ID.frozenSoil:
      return [10, 10, 8];
    case BLOCK_ID.stone:
    case BLOCK_ID.deepStone:
    case BLOCK_ID.gravel:
      return relativeHeight > 34 ? [4, 4, 0] : [-4, -2, -5];
    case BLOCK_ID.mud:
    case BLOCK_ID.clay:
      return [5, -2, -12];
    default:
      return relativeHeight < 4 ? [-2, 7, -7] : [-8, 14, -10];
  }
}

function mapWorldStepForScale(scale, small) {
  const target = small ? MAP_SMALL_MIN_SCREEN_CELL_PX : MAP_MIN_SCREEN_CELL_PX;
  const raw = Math.max(1, Math.ceil(target / Math.max(LARGE_MIN_SCALE, Number(scale) || 1)));
  return nextPowerOfTwo(raw);
}

function nextPowerOfTwo(value) {
  let out = 1;
  const target = Math.max(1, Math.trunc(value) || 1);
  while (out < target && out < MAP_MAX_WORLD_STEP) out *= 2;
  return out;
}

function positiveModulo(value, divisor) {
  return ((Math.trunc(value) % divisor) + divisor) % divisor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function safeSetPointerCapture(element, pointerId) {
  try {
    element?.setPointerCapture?.(pointerId);
  } catch {
    // Synthetic pointer events and some mobile browser edge cases can fail here.
  }
}

function safeReleasePointerCapture(element, pointerId) {
  try {
    element?.releasePointerCapture?.(pointerId);
  } catch {
    // Release is best-effort; dragging state is tracked separately.
  }
}
