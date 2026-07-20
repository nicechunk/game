import assert from "node:assert/strict";
import { chromium } from "playwright";

import {
  createForgeComponent,
  createForgeDesign,
  encodeNcf1,
  forgeChainDesignHash,
} from "../../chunk.js/index.js";

const firstCode = forgedToolCode("copper", [46, 96, 38], [0, -31, 0]);
const secondCode = forgedToolCode("iron", [32, 118, 54], [0, -42, 0]);
const firstHash = forgeChainDesignHash(firstCode);
const secondHash = forgeChainDesignHash(secondCode);
const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route(`${origin}/play/tests/equipment-switch`, (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html lang=\"en\"><title>Equipment switch test</title><body></body></html>",
  }));
  await page.goto(`${origin}/play/tests/equipment-switch`, { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async ({ firstCode, secondCode, firstHash, secondHash }) => {
    localStorage.clear();
    localStorage.setItem("nicechunk.forging.savedCodes.v2", JSON.stringify([firstCode, secondCode]));
    const { createPlayGameState } = await import("/play/game-state.js");
    const { createPlayAvatarSession } = await import("/play/play-avatar-session.js");
    const gameState = createPlayGameState();
    const sharedItemPda = "Fg3uciieVCdbUxd48teicxedirwo4sZwuzwwLDTA7tF9";
    gameState.mergeChainBackpackSlots([
      chainTool({ id: "switch-a", chainItemId: "9101", chainIndex: 4, designHash: firstHash, itemPda: sharedItemPda }),
      chainTool({ id: "switch-b", chainItemId: "9102", chainIndex: 5, designHash: secondHash, itemPda: sharedItemPda }),
    ]);
    const firstEquip = gameState.equipBackpackSlotToHotbar(gameState.backpackSlots[0].id, 1);
    const secondEquip = gameState.equipBackpackSlotToHotbar(gameState.backpackSlots[1].id, 2);
    gameState.selectHotbarSlot(1);

    const player = { worldX: 0, worldY: 0, worldZ: 0, localOffsetX: 0, localOffsetZ: 0, avatarYaw: 0 };
    const uploads = [];
    const session = createPlayAvatarSession({
      gameState,
      getPlayer: () => player,
      getRenderer: () => ({ uploadAvatarMesh(_id, mesh) { uploads.push(mesh); } }),
      getMotion: () => ({ setPlayerCollisionBoxes() {}, resolvePlayerPenetration() {} }),
      defaultCollisionBox: { halfWidth: 0.4, halfDepth: 0.4, height: 1.8 },
    });
    const firstMesh = await session.init();
    gameState.selectHotbarSlot(2);
    const secondMesh = await session.syncModelFromProfile({ force: true });
    const secondEquipment = session.selectedEquipment();
    const unequip = gameState.unequipHotbarSlot(2);
    const unequippedMesh = await session.syncModelFromProfile({ force: true });

    return {
      firstEquip,
      secondEquip,
      firstPartHashes: firstMesh.parts.filter((part) => part.forgeDesignHash).map((part) => part.forgeDesignHash),
      secondPartHashes: secondMesh.parts.filter((part) => part.forgeDesignHash).map((part) => part.forgeDesignHash),
      secondEquipmentHash: secondEquipment.designHash,
      unequip,
      unequippedForgeParts: unequippedMesh.parts.filter((part) => part.forgeDesignHash).length,
      backpackItemIds: gameState.backpackSlots.map((slot) => slot.chainItemId),
      uploadCount: uploads.length,
    };

    function chainTool(overrides) {
      return {
        kind: "forged",
        itemId: "forged_item",
        label: "Forged Tool",
        count: 1,
        source: "chain",
        chainBackpack: "Backpack1111111111111111111111111111111",
        itemCode: 1,
        durabilityCurrent: 80,
        durabilityMax: 100,
        ...overrides,
      };
    }
  }, { firstCode, secondCode, firstHash, secondHash });

  assert.equal(result.firstEquip.ok, true);
  assert.equal(result.secondEquip.ok, true);
  assert.equal(result.secondEquip.alreadyEquipped, undefined);
  assert.deepEqual(result.firstPartHashes, [firstHash]);
  assert.deepEqual(result.secondPartHashes, [secondHash]);
  assert.equal(result.secondEquipmentHash, secondHash);
  assert.equal(result.unequip.ok, true);
  assert.equal(result.unequippedForgeParts, 0);
  assert.deepEqual(result.backpackItemIds, ["9101", "9102"]);
  assert.ok(result.uploadCount >= 3 && result.uploadCount <= 4);
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}

function forgedToolCode(resourceId, dimsQ, gripOffsetQ) {
  return encodeNcf1(createForgeDesign({
    equipment: { mass5g: 30, volumeCm3: 70, attributes6: new Uint8Array(12).fill(28) },
    components: [createForgeComponent({
      resourceId,
      dimsQ,
      grip: { offsetQ: gripOffsetQ, axis: 2, sign: 1, rotation: 1 },
    })],
  }));
}
