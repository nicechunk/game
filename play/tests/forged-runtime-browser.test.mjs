import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  createForgeComponent,
  createForgeDesign,
  encodeNcf1,
  forgeChainDesignHash,
  forgeCodeToBytes,
} from "../../chunk.js/index.js";

const code = encodeNcf1(createForgeDesign({
  equipment: { mass5g: 36, volumeCm3: 72, attributes6: new Uint8Array(12).fill(30) },
  components: [createForgeComponent({
    resourceId: "copper",
    dimsQ: [52, 104, 40],
    grip: { offsetQ: [0, -34, 0], axis: 2, sign: 1, rotation: 1 },
  })],
}));
const designHash = forgeChainDesignHash(code);
const rawBytes = Array.from(forgeCodeToBytes(code));
const noGripCode = encodeNcf1(createForgeDesign({
  equipment: { mass5g: 20, volumeCm3: 48, attributes6: new Uint8Array(12).fill(24) },
  components: [createForgeComponent({
    resourceId: "cloth",
    dimsQ: [112, 32, 80],
  })],
}));
const noGripDesignHash = forgeChainDesignHash(noGripCode);
const noGripRawBytes = Array.from(forgeCodeToBytes(noGripCode));

const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  const requests = [];
  await page.route(`${origin}/play/tests/`, (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html lang=\"en\"><title>Forge runtime test</title><body></body></html>",
  }));
  page.on("pageerror", (error) => errors.push(String(error?.message || error)));
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(`${origin}/play/tests/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => Promise.all([
    import("/chunk.js/play.js"),
    import("/play/play-avatar-session.js"),
    import("/play/play-guardian-appearance.js"),
    import("/play/play-guardian.js"),
  ]));
  assert.equal(
    requests.filter((url) => url.includes("/chunk.js/forge/")).length,
    0,
    "ordinary play startup modules must not fetch forge restoration code before forged equipment is selected",
  );

  const result = await page.evaluate(async ({ designHash, rawBytes, noGripDesignHash, noGripRawBytes }) => {
    const avatarSessionModule = await import("/play/play-avatar-session.js");
    const localGameState = {
      hotbarSlots: [{
        itemId: "forged_item",
        designHash,
        bytes: rawBytes,
        durability: 10,
      }],
      selectedHotbarSlot: 0,
      isUsableMiningToolSlot(slot) { return Boolean(slot?.durability > 0); },
    };
    const localPlayer = {
      worldX: 0,
      worldY: 0,
      worldZ: 0,
      localOffsetX: 0,
      localOffsetZ: 0,
      avatarYaw: 0,
    };
    const localUploads = [];
    const avatarSession = avatarSessionModule.createPlayAvatarSession({
      gameState: localGameState,
      getPlayer: () => localPlayer,
      getRenderer: () => ({ uploadAvatarMesh(_id, mesh) { localUploads.push(mesh); } }),
      getMotion: () => ({
        setPlayerCollisionBoxes() {},
        resolvePlayerPenetration() {},
      }),
      defaultCollisionBox: { halfWidth: 0.4, halfDepth: 0.4, height: 1.8 },
    });
    const equippedLocalMesh = await avatarSession.init();
    const avatar = equippedLocalMesh;
    const payloadBytes = Uint8Array.from(rawBytes);
    const guardian = await import("/play/play-guardian.js");
    const equipmentPacket = guardian.guardianEquipmentFromAvatarEquipment({
      rightHand: "pickaxe",
      forged: true,
      designHash,
      payloadBytes,
    });
    const dedicatedKind = guardian.equipmentFromGuardianEvent({
      rightHandKind: 3,
      rightHandVariant: 2,
      flags: 1,
      designHash,
      payloadBytes,
    });
    const legacyKind = guardian.equipmentFromGuardianEvent({
      rightHandKind: 1,
      rightHandVariant: 2,
      flags: 1,
      designHash,
      payloadBytes,
    });
    const mismatchPacket = guardian.guardianEquipmentFromAvatarEquipment({
      rightHand: "pickaxe",
      forged: true,
      designHash: designHash ^ 1,
      payloadBytes,
    });
    const appearance = await import("/play/play-guardian-appearance.js");
    const uploadedMeshIds = [];
    const removedMeshIds = [];
    const appearanceCache = appearance.createGuardianAppearanceMeshCache({
      renderer: {
        uploadAvatarMesh(meshId) { uploadedMeshIds.push(meshId); },
        removeAvatarMesh(meshId) { removedMeshIds.push(meshId); },
      },
      maxWalletEntries: 2,
      maxModelMeshes: 1,
      fetchModelCode: async (wallet) => wallet === "wallet-b"
        ? "NCM:peasant_guy_blackhair:v1"
        : "NCM:peasant_guy:v1",
    });
    const remoteEquipment = {
      forged: true,
      designHash,
      payloadBytes,
    };
    const firstRemoteMeshId = await appearanceCache.resolveMeshIdForWallet("wallet-a", { equipment: remoteEquipment });
    const refusedRemoteMeshId = await appearanceCache.resolveMeshIdForWallet("wallet-b", { equipment: remoteEquipment });
    await appearanceCache.resolveMeshIdForWallet("wallet-c", { equipment: remoteEquipment });
    const appearanceCacheBeforeClear = appearanceCache.snapshot();
    appearanceCache.clear();
    const appearanceCacheAfterClear = appearanceCache.snapshot();
    const chunkRuntime = await import("/chunk.js/play.js");
    const rendererCanvas = document.createElement("canvas");
    rendererCanvas.width = 320;
    rendererCanvas.height = 180;
    const webglRenderer = new chunkRuntime.WebGL2VoxelRenderer(rendererCanvas, {
      viewDistance: 2,
      maxVoxelParticles: 8,
    });
    webglRenderer.init();
    const webglRendererInitialized = webglRenderer.initialized;
    webglRenderer.dispose();
    const fallbackIcon = chunkRuntime.createVoxelItemIconCanvas({
      kind: "forged",
      itemId: "forged_item",
      designHash,
    }, { size: 96 });
    const exactIcon = chunkRuntime.createVoxelItemIconCanvas({
      kind: "forged",
      itemId: "forged_item",
      designHash,
      bytes: rawBytes,
    }, { size: 96, yaw: 0.2 });
    document.body.append(fallbackIcon, exactIcon);
    await waitFor(() => exactIcon.dataset.forgePreviewState !== "loading");
    const fallbackIconHash = canvasHash(fallbackIcon);
    const exactIconHash = canvasHash(exactIcon);
    exactIcon.renderVoxelYaw?.(1.1);
    const rotatedExactIconHash = canvasHash(exactIcon);
    localGameState.hotbarSlots[0] = null;
    const unequippedLocalMesh = await avatarSession.syncModelFromProfile({ force: true });
    localGameState.hotbarSlots[0] = {
      itemId: "forged_item",
      designHash: noGripDesignHash,
      bytes: noGripRawBytes,
      durability: 10,
    };
    const noGripLocalMesh = await avatarSession.syncModelFromProfile({ force: true });
    const noGripEquipment = avatarSession.selectedEquipment();
    return {
      designHash,
      rawBytes: payloadBytes.length,
      vertices: avatar.vertexCount,
      triangles: avatar.triangleCount,
      restoredAvatarParts: avatar.parts.filter((part) => part.forgeDesignHash === designHash).length,
      restoredCollisionParts: avatar.collisionParts.filter((part) => part.equipmentId === "forged_pickaxe").length,
      equipmentKind: equipmentPacket.rightHandKind,
      payloadBytes: equipmentPacket.payloadBytes?.length ?? 0,
      dedicatedKindForged: dedicatedKind.forged,
      dedicatedKindPayloadBytes: dedicatedKind.payloadBytes?.length ?? 0,
      legacyKindForged: legacyKind.forged,
      mismatchPayloadDropped: mismatchPacket.payloadBytes === null,
      firstRemoteMeshId,
      refusedRemoteMeshId,
      uploadedRemoteMeshes: uploadedMeshIds.length,
      removedRemoteMeshes: removedMeshIds.length,
      appearanceCacheBeforeClear,
      appearanceCacheAfterClear,
      forgePreviewState: exactIcon.dataset.forgePreviewState,
      forgePreviewDesignHash: Number(exactIcon.dataset.forgeDesignHash),
      fallbackIconHash,
      exactIconHash,
      rotatedExactIconHash,
      equippedLocalVertices: equippedLocalMesh.vertexCount,
      unequippedLocalVertices: unequippedLocalMesh.vertexCount,
      equippedLocalForgeParts: equippedLocalMesh.parts.filter((part) => part.forgeDesignHash === designHash).length,
      unequippedLocalForgeParts: unequippedLocalMesh.parts.filter((part) => part.forgeDesignHash === designHash).length,
      noGripLocalForgeParts: noGripLocalMesh.parts.filter((part) => part.equipmentId === "forged_pickaxe").length,
      noGripEquipment: noGripEquipment.rightHand,
      noGripInteraction: avatarSession.selectedForgedInteraction()?.mode,
      localMeshUploads: localUploads.length,
      webglRendererInitialized,
    };

    function canvasHash(canvas) {
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 0x811c9dc5;
      for (const value of pixels) {
        hash ^= value;
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      return hash >>> 0;
    }

    async function waitFor(predicate) {
      const deadline = performance.now() + 3000;
      while (!predicate()) {
        if (performance.now() >= deadline) throw new Error("Timed out restoring forged item preview.");
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
    }
  }, { designHash, rawBytes, noGripDesignHash, noGripRawBytes });
  assert.equal(errors.length, 0);
  assert.ok(
    requests.some((url) => url.includes("/chunk.js/forge/forge-runtime-cache.js")),
    "selecting forged equipment must load the restoration module on demand",
  );
  assert.ok(result.vertices > 0 && result.triangles > 0);
  assert.equal(result.restoredAvatarParts, 1);
  assert.equal(result.restoredCollisionParts, 1);
  assert.equal(result.equipmentKind, 3);
  assert.equal(result.payloadBytes, result.rawBytes);
  assert.equal(result.dedicatedKindForged, true);
  assert.equal(result.dedicatedKindPayloadBytes, result.rawBytes);
  assert.equal(result.legacyKindForged, true);
  assert.equal(result.mismatchPayloadDropped, true);
  assert.notEqual(result.firstRemoteMeshId, "peasant-guy");
  assert.equal(result.refusedRemoteMeshId, "peasant-guy");
  assert.equal(result.uploadedRemoteMeshes, 1, "remote forged meshes must remain under the configured GPU cache cap");
  assert.equal(result.appearanceCacheBeforeClear.cachedWallets, 2);
  assert.equal(result.appearanceCacheBeforeClear.cachedModels, 1);
  assert.ok(result.appearanceCacheBeforeClear.refusedModelCount >= 1);
  assert.equal(result.removedRemoteMeshes, 1);
  assert.equal(result.appearanceCacheAfterClear.cachedModels, 0);
  assert.equal(result.forgePreviewState, "ready");
  assert.equal(result.forgePreviewDesignHash, designHash);
  assert.notEqual(result.exactIconHash, result.fallbackIconHash, "the exact forged mesh must replace the generic tool thumbnail");
  assert.notEqual(result.rotatedExactIconHash, result.exactIconHash, "thumbnail rotation must redraw the exact forged mesh");
  assert.equal(result.equippedLocalForgeParts, 1);
  assert.equal(result.unequippedLocalForgeParts, 0, "unequipping must remove custom forge vertices from the per-frame avatar buffer");
  assert.equal(result.noGripLocalForgeParts, 0, "a gripless forged item must not create a generic hammer on the avatar");
  assert.equal(result.noGripEquipment, "empty", "a gripless forged item must not bind to the hand action channel");
  assert.equal(result.noGripInteraction, "placeable");
  assert.equal(result.webglRendererInitialized, true, "the production WebGL2 shaders must compile before forged previews render");
  assert.ok(result.unequippedLocalVertices < result.equippedLocalVertices);
  assert.equal(result.localMeshUploads, 4, "default, equipped, unequipped, and gripless avatar buffers should each upload once");
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
