import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createForgeComponent, createForgeDesign, encodeNcf1, forgeCodeToBytes } from "../../chunk.js/index.js";

const code = encodeNcf1(createForgeDesign({
  equipment: { mass5g: 36, volumeCm3: 72, attributes6: new Uint8Array(12).fill(30) },
  components: [createForgeComponent({ resourceId: "copper", dimsQ: [52, 104, 40],
    grip: { offsetQ: [0, -34, 0], axis: 2, sign: 1, rotation: 1 } })],
}));
const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route(`${origin}/play/tests/no-default`, (route) => route.fulfill({
    contentType: "text/html", body: "<!doctype html><title>No default tool</title>",
  }));
  await page.goto(`${origin}/play/tests/no-default`);
  const result = await page.evaluate(async (bytes) => {
    const { createPlayGameState } = await import("/play/game-state.js");
    const { createPlayAvatarSession } = await import("/play/play-avatar-session.js");
    const guardian = await import("/play/play-guardian.js");
    const state = createPlayGameState({ ownerAddress: "no-starter-browser" });
    const avatar = createPlayAvatarSession({ gameState: state,
      getPlayer: () => ({ worldX: 0, worldY: 0, worldZ: 0, localOffsetX: 0, localOffsetZ: 0, avatarYaw: 0 }),
      getRenderer: () => ({ uploadAvatarMesh() {} }),
      getMotion: () => ({ setPlayerCollisionBoxes() {}, resolvePlayerPenetration() {} }),
    });
    await avatar.init();
    const initial = avatar.selectedEquipment().rightHand;
    const noTool = state.getSelectedToolSlot() === null;
    // Even an injected legacy shortcut cannot select or render a default pickaxe.
    state.hotbarSlots[0] = { itemId: "iron_pickaxe", durability: 999 };
    const legacy = avatar.selectedEquipment().rightHand;
    const legacyCanMine = state.getSelectedToolSlot() !== null;
    state.hotbarSlots[0] = { itemId: "forged_item", bytes, custodySource: "equipment", equipmentSlot: 0,
      itemPda: "11111111111111111111111111111112", durability: 20, maxDurability: 20 };
    await avatar.syncModelFromProfile({ force: true });
    const crafted = avatar.selectedEquipment();
    const craftedCanMine = state.getSelectedToolSlot() !== null;
    return {
      initial, noTool, legacy, legacyCanMine,
      crafted: { rightHand: crafted.rightHand, forged: crafted.forged, payload: crafted.payloadBytes?.length },
      craftedCanMine,
      transmittedDefault: guardian.guardianEquipmentFromAvatarEquipment({ rightHand: "pickaxe" }).rightHandKind,
      receivedDefault: guardian.equipmentFromGuardianEvent({ rightHandKind: 1, rightHandVariant: 1 }).rightHand,
    };
  }, Array.from(forgeCodeToBytes(code)));
  assert.equal(result.initial, "empty");
  assert.equal(result.noTool, true);
  assert.equal(result.legacy, "empty");
  assert.equal(result.legacyCanMine, false);
  assert.equal(result.crafted.rightHand, "pickaxe");
  assert.equal(result.crafted.forged, true);
  assert.ok(result.crafted.payload > 0);
  assert.equal(result.craftedCanMine, true);
  assert.equal(result.transmittedDefault, 0);
  assert.equal(result.receivedDefault, "empty");
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
