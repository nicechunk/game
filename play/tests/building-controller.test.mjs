import assert from "node:assert/strict";
import test from "node:test";

import { createBuildingController } from "../building-controller.js";

const OWNER = "wallet-owner";
const FOUNDATIONS = Object.freeze([
  foundation("101", 0),
  foundation("202", 20),
  foundation("999", 40),
]);

test("building editor exposes only the foundation bound to the selected blueprint", () => {
  let selected = blueprint("101", 1);
  const controller = controllerFor({ getSelected: () => selected });

  controller.activate();
  assert.equal(controller.snapshot().mode, "building");
  assert.deepEqual(controller.snapshot().foundations.map((entry) => entry.foundationId), ["101"]);
  controller.setMode("foundation");
  assert.equal(controller.snapshot().mode, "foundation");
  controller.setMode("building");
  assert.equal(controller.snapshot().mode, "building");

  selected = blueprint("202", 2);
  controller.activate();
  assert.deepEqual(controller.snapshot().foundations.map((entry) => entry.foundationId), ["202"]);

  selected = blueprint("303", 3);
  controller.activate();
  assert.equal(controller.snapshot().mode, "foundation");
  assert.equal(controller.snapshot().selectedFoundation, null);
  controller.setMode("building");
  assert.equal(controller.snapshot().mode, "foundation");
});

test("NCM3 editor state is isolated per blueprint instance", () => {
  let selected = blueprint("101", 1);
  const controller = controllerFor({ getSelected: () => selected });
  controller.activate();
  controller.setCode("NCM3:FIRST");
  controller.setQuarterTurns(1);
  controller.setOffsets(3, -2);

  selected = blueprint("202", 2);
  controller.activate();
  assert.equal(controller.snapshot().code, "");
  assert.equal(controller.snapshot().quarterTurns, 0);
  assert.equal(controller.snapshot().offsetX, 0);
  assert.equal(controller.snapshot().offsetZ, 0);
  controller.setCode("NCM3:SECOND");
  controller.setQuarterTurns(3);
  controller.setOffsets(-4, 5);

  selected = blueprint("101", 1);
  controller.activate();
  assert.equal(controller.snapshot().code, "NCM3:FIRST");
  assert.equal(controller.snapshot().quarterTurns, 1);
  assert.equal(controller.snapshot().offsetX, 3);
  assert.equal(controller.snapshot().offsetZ, -2);
});

test("building submission always uses the selected blueprint foundation ID", async () => {
  const submissions = [];
  const controller = controllerFor({
    getSelected: () => blueprint("202", 2),
    submitBuilding: async (payload) => {
      submissions.push(payload);
      return { submitted: true, guardianIndexed: false, signature: "test-signature" };
    },
  });
  controller.activate();
  controller.setCode("NCM3:TEST");
  controller.setOffsets(-2, 3);

  const preview = await controller.preview();
  assert.equal(preview.ok, true);
  const result = await controller.confirm();
  assert.equal(result.submitted, true);
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].foundationId, "202");
  assert.equal(submissions[0].foundation, `${OWNER}:202`);
  assert.equal(submissions[0].code, "NCM3:TEST");
  assert.equal(submissions[0].offsetX, -2);
  assert.equal(submissions[0].offsetZ, 3);
});

test("an oversized building remains previewable but cannot be submitted", async () => {
  const submissions = [];
  const controller = controllerFor({
    getSelected: () => blueprint("101", 1),
    submitBuilding: async (payload) => {
      submissions.push(payload);
      return { submitted: true };
    },
    createMeshClient: () => ({
      async build(input) {
        assert.equal(input.allowFoundationOverflow, true);
        return {
          building: {
            canonicalCode: input.code,
            codeId: input.code,
            size: { x: 20, y: 4, z: 20 },
            voxelCount: 1600,
            payloadBytes: input.code.length,
          },
          placement: {
            id: input.placementId,
            foundation: input.foundation,
            quarterTurns: input.quarterTurns,
            footprint: { width: 20, depth: 20 },
            fitsFoundation: false,
          },
          chunks: [{ id: "oversized-preview", chunkX: 0, chunkZ: 0 }],
        };
      },
    }),
  });
  controller.activate();
  controller.setCode("NCM3:OVERSIZED");

  const preview = await controller.preview();
  assert.equal(preview.ok, true);
  assert.equal(preview.fitsFoundation, false);
  assert.equal(controller.snapshot().preview.fitsFoundation, false);
  assert.equal(controller.snapshot().canBuild, false);
  assert.equal(controller.renderChunks()[0].buildingPreview, true);
  assert.equal(controller.renderChunks()[0].regionBatchEligible, false);

  const result = await controller.confirm();
  assert.equal(result.submitted, false);
  assert.equal(result.reason, "building-does-not-fit");
  assert.equal(submissions.length, 0, "foundation overflow must never reach chain submission");
  assert.equal(controller.renderChunks().length, 1, "the rejected preview must remain visible");
});

test("unchanged chain buildings reuse uploaded meshes and only changed revisions rebuild", async () => {
  const meshCalls = [];
  const controller = controllerFor({
    getSelected: () => blueprint("101", 1),
    createMeshClient: () => ({
      async build(input) {
        const token = meshCalls.length + 1;
        meshCalls.push(input);
        return {
          building: { canonicalCode: input.code },
          placement: { id: input.placementId, foundation: input.foundation },
          chunks: [{
            id: input.buildingId,
            chunkX: Math.floor(input.foundation.minX / 16),
            chunkZ: Math.floor(input.foundation.minZ / 16),
            gpuUploaded: true,
            token,
          }],
        };
      },
    }),
  });
  const firstRecords = [
    buildingRecord("101", 1, "11".repeat(32)),
    buildingRecord("202", 1, "22".repeat(32)),
  ];

  const first = await controller.applyChainBuildings(firstRecords);
  const firstChunks = new Map(controller.renderChunks().map((chunk) => [chunk.id, chunk]));
  assert.deepEqual(first, { count: 2, rebuilt: 2, reused: 0, removed: 0 });
  assert.equal(meshCalls.length, 2);
  assert.equal(controller.renderChunks(), controller.renderChunks());
  assert.deepEqual(controller.renderChunksInRange(0, 0, 0).map((chunk) => chunk.id), ["building-101"]);

  const unchanged = await controller.applyChainBuildings(firstRecords.map((record) => ({ ...record })));
  const unchangedChunks = new Map(controller.renderChunks().map((chunk) => [chunk.id, chunk]));
  assert.deepEqual(unchanged, { count: 2, rebuilt: 0, reused: 2, removed: 0 });
  assert.equal(meshCalls.length, 2);
  assert.equal(unchangedChunks.get("building-101"), firstChunks.get("building-101"));
  assert.equal(unchangedChunks.get("building-202"), firstChunks.get("building-202"));

  const latestRecords = [
    firstRecords[0],
    buildingRecord("202", 2, "33".repeat(32)),
  ];
  const changed = await controller.applyChainBuildings(latestRecords);
  const changedChunks = new Map(controller.renderChunks().map((chunk) => [chunk.id, chunk]));
  assert.deepEqual(changed, { count: 2, rebuilt: 1, reused: 1, removed: 0 });
  assert.equal(meshCalls.length, 3);
  assert.equal(changedChunks.get("building-101"), firstChunks.get("building-101"));
  assert.notEqual(changedChunks.get("building-202"), firstChunks.get("building-202"));

  const removed = await controller.applyChainBuildings([firstRecords[0]]);
  assert.deepEqual(removed, { count: 1, rebuilt: 0, reused: 1, removed: 1 });
  assert.equal(meshCalls.length, 3);
  assert.deepEqual(controller.renderChunks().map((chunk) => chunk.id), ["building-101"]);

  const returned = await controller.applyChainBuildings(latestRecords);
  assert.deepEqual(returned, { count: 2, rebuilt: 0, reused: 2, removed: 0 });
  assert.equal(meshCalls.length, 3, "returning to a cached building must not rebuild its NCM3 mesh");
  assert.equal(controller.snapshot().cachedBuildingCount, 0);
});

test("changing a chain building offset invalidates its cached mesh", async () => {
  const meshCalls = [];
  const controller = controllerFor({
    getSelected: () => blueprint("101", 1),
    createMeshClient: () => ({
      async build(input) {
        meshCalls.push(input);
        return meshResult(input, meshCalls.length);
      },
    }),
  });
  const record = buildingRecord("101", 1, "11".repeat(32));

  await controller.applyChainBuildings([record]);
  await controller.applyChainBuildings([{ ...record, offsetX: 2, offsetZ: -1 }]);

  assert.equal(meshCalls.length, 2);
  assert.equal(meshCalls[1].offsetX, 2);
  assert.equal(meshCalls[1].offsetZ, -1);
});

test("chain building meshing is submitted nearest-first", async () => {
  const meshCalls = [];
  const controller = controllerFor({
    getSelected: () => blueprint("101", 1),
    getPlayerPosition: () => [41, 0, 0],
    createMeshClient: () => ({
      async build(input, options) {
        meshCalls.push({ input, options });
        return meshResult(input, meshCalls.length);
      },
    }),
  });

  await controller.applyChainBuildings([
    buildingRecord("101", 1, "11".repeat(32)),
    buildingRecord("202", 1, "22".repeat(32)),
    buildingRecord("999", 1, "99".repeat(32)),
  ]);

  assert.deepEqual(meshCalls.map((call) => call.input.foundation.foundationId), ["999", "202", "101"]);
  assert.ok(meshCalls[0].options.priority > meshCalls[1].options.priority);
  assert.ok(meshCalls[1].options.priority > meshCalls[2].options.priority);
});

test("a nearby building becomes renderable before distant mesh work completes", async () => {
  const meshCalls = [];
  const controller = controllerFor({
    getSelected: () => blueprint("101", 1),
    getPlayerPosition: () => [0, 0, 0],
    createMeshClient: () => ({
      build(input) {
        return new Promise((resolve) => meshCalls.push({ input, resolve }));
      },
    }),
  });

  const applying = controller.applyChainBuildings([
    buildingRecord("101", 1, "11".repeat(32)),
    buildingRecord("999", 1, "99".repeat(32)),
  ]);
  assert.deepEqual(meshCalls.map((call) => call.input.foundation.foundationId), ["101", "999"]);
  meshCalls[0].resolve(meshResult(meshCalls[0].input, 1));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(controller.renderChunks().map((chunk) => chunk.id), ["building-101"]);

  meshCalls[1].resolve(meshResult(meshCalls[1].input, 2));
  assert.deepEqual(await applying, { count: 2, rebuilt: 2, reused: 0, removed: 0 });
  assert.deepEqual(controller.renderChunks().map((chunk) => chunk.id), ["building-101", "building-999"]);
});

test("a failed replacement removes its stale previously verified mesh", async () => {
  let fail = false;
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const controller = controllerFor({
      getSelected: () => blueprint("101", 1),
      createMeshClient: () => ({
        async build(input) {
          if (fail) throw new Error("invalid replacement");
          return meshResult(input, 1);
        },
      }),
    });
    await controller.applyChainBuildings([buildingRecord("101", 1, "11".repeat(32))]);
    assert.deepEqual(controller.renderChunks().map((chunk) => chunk.id), ["building-101"]);

    fail = true;
    const result = await controller.applyChainBuildings([buildingRecord("101", 2, "22".repeat(32))]);
    assert.deepEqual(result, { count: 0, rebuilt: 1, reused: 0, removed: 0 });
    assert.deepEqual(controller.renderChunks(), []);
  } finally {
    console.warn = originalWarn;
  }
});

test("a newer chain snapshot cancels stale building mesh work", async () => {
  const meshCalls = [];
  const controller = controllerFor({
    getSelected: () => blueprint("101", 1),
    createMeshClient: () => ({
      build(input, options) {
        return new Promise((resolve, reject) => {
          const call = { input, options, resolve, reject };
          meshCalls.push(call);
          options.signal.addEventListener("abort", () => {
            const error = new Error("canceled");
            error.code = "building-mesh-aborted";
            reject(error);
          }, { once: true });
        });
      },
    }),
  });

  const stale = controller.applyChainBuildings([buildingRecord("101", 1, "11".repeat(32))]);
  const current = controller.applyChainBuildings([buildingRecord("202", 1, "22".repeat(32))]);
  assert.equal(meshCalls[0].options.signal.aborted, true);
  meshCalls[1].resolve(meshResult(meshCalls[1].input, 2));

  assert.equal((await stale).stale, true);
  assert.deepEqual(await current, { count: 1, rebuilt: 1, reused: 0, removed: 0 });
  assert.deepEqual(controller.renderChunks().map((chunk) => chunk.id), ["building-202"]);
});

test("only finalized chain buildings collide and cached removal updates immediately", async () => {
  let meshCalls = 0;
  let collisionChanges = 0;
  const controller = controllerFor({
    getSelected: () => blueprint("101", 1),
    createMeshClient: () => ({
      async build(input) {
        meshCalls += 1;
        return {
          building: { canonicalCode: input.code },
          placement: { id: input.placementId, foundation: input.foundation },
          chunks: [singleCollisionChunk(input.placementId || "collision")],
        };
      },
    }),
    onCollisionGeometryChanged: () => {
      collisionChanges += 1;
    },
  });
  controller.activate();
  controller.setCode("NCM3:PREVIEW");
  await controller.preview();
  assert.equal(controller.renderChunks()[0].buildingPreview, true);
  assert.equal(controller.hasCollisionAtWorld(0, 10, 0), false, "a holographic preview must remain non-colliding");

  const record = buildingRecord("101", 1, "11".repeat(32));
  await controller.applyChainBuildings([record]);
  assert.equal(collisionChanges, 1);
  assert.equal(controller.hasCollisionAtWorld(0.5, 10.5, 0.5), true);
  assert.equal(controller.collisionTopAtWorld(0, 0, 10), 11);
  assert.equal(controller.collisionTopAtWorld(0, 0, 9), -Infinity);

  await controller.applyChainBuildings([]);
  assert.equal(collisionChanges, 2);
  assert.equal(controller.hasCollisionAtWorld(0, 10, 0), false, "removing a chain building must clear collision");
  await controller.applyChainBuildings([record]);
  assert.equal(collisionChanges, 3);
  assert.equal(controller.hasCollisionAtWorld(0, 10, 0), true, "a cached chain mesh must retain collision data");
  assert.equal(meshCalls, 2, "the restored chain building should reuse its cached mesh after one preview and one chain build");
});

function controllerFor({ getSelected, getPlayerPosition, submitBuilding, createMeshClient, onCollisionGeometryChanged } = {}) {
  return createBuildingController({
    index: {
      list: () => FOUNDATIONS.map((entry) => ({ ...entry })),
      foundationsAt: () => FOUNDATIONS.map((entry) => ({ ...entry })),
    },
    getWalletAddress: () => OWNER,
    getPlayerPosition,
    getSelectedBlueprint: getSelected,
    submitBuilding,
    onCollisionGeometryChanged,
    createMeshClient: createMeshClient ?? (() => ({
      async build({ code, foundation: selectedFoundation, quarterTurns, offsetX, offsetZ }) {
        return {
          building: {
            canonicalCode: code,
            codeId: code,
            size: { x: 1, y: 1, z: 1 },
            voxelCount: 1,
            payloadBytes: code.length,
          },
          placement: {
            id: `preview:${selectedFoundation.id}`,
            foundation: selectedFoundation,
            quarterTurns,
            offsetX,
            offsetZ,
            footprint: { width: 1, depth: 1 },
          },
          chunks: [],
        };
      },
    })),
  });
}

function meshResult(input, token) {
  return {
    building: { canonicalCode: input.code },
    placement: { id: input.placementId, foundation: input.foundation },
    chunks: [{
      id: input.buildingId,
      chunkX: Math.floor(input.foundation.minX / 16),
      chunkZ: Math.floor(input.foundation.minZ / 16),
      gpuUploaded: true,
      token,
    }],
  };
}

function singleCollisionChunk(id) {
  const collisionMask = new Uint32Array(8);
  collisionMask[0] = 1;
  return {
    id,
    chunkX: 0,
    chunkZ: 0,
    chunkSize: 16,
    minY: 10,
    height: 1,
    collisionMask,
    collisionBlockCount: 1,
  };
}

function buildingRecord(foundationId, revision, contentHash) {
  return {
    id: `building-${foundationId}`,
    owner: OWNER,
    foundationId,
    revision,
    quarterTurns: 0,
    contentHash,
    code: `NCM3:${foundationId}:${revision}`,
  };
}

function blueprint(blueprintId, blueprintOrdinal) {
  return {
    slot: { itemId: "blueprint_tool", kind: "blueprint", blueprintId, blueprintOrdinal },
    index: blueprintOrdinal,
  };
}

function foundation(foundationId, minX) {
  return {
    id: `${OWNER}:${foundationId}`,
    owner: OWNER,
    foundationId,
    minX,
    minZ: 0,
    surfaceY: 10,
    width: 10,
    depth: 10,
    status: "active",
  };
}
