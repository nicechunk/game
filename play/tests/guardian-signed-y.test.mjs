import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createNiceChunkGuardianClient } from "../play-guardian-client.js";
import { GUARDIAN_Y_OFFSET32_V1, encodeGuardianY, decodeGuardianY } from "../../sdk/guardian-wire.js";
const heights = [-32, -31, -17, -1, 0, 1, 319, 320];
function ack(flags) { const packet = new Uint8Array(20), view = new DataView(packet.buffer); packet[0] = 2; packet[1] = 1; packet[17] = 1; view.setUint16(2, 1, true); view.setUint16(4, flags, true); view.setUint16(14, 100, true); return view; }
function client(options = {}) { return createNiceChunkGuardianClient({ walletAddress: "11111111111111111111111111111111", ...options }); }

test("HELLO/ACK explicitly negotiate offset32-v1; packet length cannot enable it", () => {
  const c = client();
  assert.equal(new DataView(c.encodeHello({ x: -17, z: -33 })).getUint16(2, true), GUARDIAN_Y_OFFSET32_V1);
  assert.equal(c.encodeDig({ x: -17, y: -17, z: -33 }), null);
  c.decodeHelloAck(ack(0));
  assert.equal(c.supportsOffsetY, false);
  assert.equal(c.compatibilityState, "legacy-positive-y-only");
  c.decodeHelloAck(ack(GUARDIAN_Y_OFFSET32_V1));
  assert.equal(c.supportsOffsetY, true);
  for (const y of heights) {
    assert.equal(new DataView(c.encodeDig({ x: -17, y, z: -33 }).buffer).getUint16(6, true), y + 32);
    assert.equal(new DataView(c.encodeDigBatch([{ x: -17, y, z: -33 }]).buffer).getUint16(7, true), y + 32);
  }
});

test("legacy nodes suppress negative move/single/batch, preserve positive wire bytes, and do not reconnect", () => {
  const states = [], sent = [];
  const previous = globalThis.WebSocket; globalThis.WebSocket = { OPEN: 1 };
  try {
    const c = client({ onCompatibility: (state) => states.push(state) });
    c.decodeHelloAck(ack(0)); c.socket = { readyState: 1, send: (packet) => sent.push(packet) };
    for (const y of heights.filter((value) => value < 0)) {
      assert.equal(c.sendDig({ x: -17, y, z: -33 }), false);
      assert.equal(c.sendDigBatch([{ x: -17, y, z: -33 }]), false);
      c.updateLocalPlayer({ x: -17, y: y + 0.25, z: -33 }, 100 + states.length * 100);
    }
    assert.equal(sent.length, 0);
    assert.equal(c.reconnectTimer, null);
    assert.equal(c.encodeDig({ x: 1, y: 1, z: 2 }).at(6), 1);
    assert.ok(states.some((state) => state.mode === "legacy-negative-y-suppressed"));
  } finally { globalThis.WebSocket = previous; }
});

test("SDK quantization, bounds, fractional positions, and malformed packets have unambiguous behavior", () => {
  for (const y of [-32, -31.75, -17.5, -0.015625, 0, 1.25, 319.984375, 320]) {
    const encoded = encodeGuardianY(y, { fractional: true, offset32: true });
    assert.equal(decodeGuardianY(encoded, { fractional: true, offset32: true }), y);
  }
  for (const y of [-33, 320.01, NaN, Infinity]) assert.equal(encodeGuardianY(y, { offset32: true }), null);
  const errors = [], c = client({ onProtocolError: (error) => errors.push(error) });
  c.decodeHelloAck(ack(GUARDIAN_Y_OFFSET32_V1));
  assert.equal(c.encodeMove({ x: 1e8, y: 1, z: 0 }), null);
  assert.equal(c.encodeDig({ x: 0, y: -33, z: 0 }), null);
  assert.equal(c.encodeDigBatch([{ x: 0, y: -32, z: 0 }, { x: 0, y: 321, z: 0 }]), null);
  for (const length of [0, 1, 12, 13, 15]) c.decodeDigEvent(new DataView(new ArrayBuffer(length)));
  c.decodeDigEventBatch(new DataView(new ArrayBuffer(6)));
  assert.equal(errors.length, 6);
});

test("C++ companion and browser client agree byte-for-byte for negotiated/legacy dig, batch, move and joins", { skip: !process.env.NICECHUNK_GUARDIAN_VECTOR_BIN }, () => {
  const lines = [], assertions = [];
  for (const offset of [false, true]) {
    const mode = offset ? "offset" : "legacy", c = client();
    lines.push(`${mode} hello ${Buffer.from(c.encodeHello({ x: -17, z: -33 })).toString("hex")}`);
    assertions.push((bytes) => { c.decodeHelloAck(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)); assert.equal(c.supportsOffsetY, offset); });
    // The shared client is configured for vector construction before responses
    // return; ACK assertions independently re-check the negotiated bits.
    c.decodeHelloAck(ack(offset ? GUARDIAN_Y_OFFSET32_V1 : 0));
    for (const y of heights.filter((value) => offset || value >= 0)) {
      const dig = c.encodeDig({ x: -17, y, z: -33, action: 3 });
      lines.push(`${mode} dig ${Buffer.from(dig).toString("hex")}`);
      assertions.push((bytes) => { const events = []; c.onDig = (event) => events.push(event); c.decodeDigEvent(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)); assert.equal(events[0].y, y); assert.equal(events[0].x, -17); assert.equal(events[0].z, -33); });
      const batch = c.encodeDigBatch([{ x: -17, y, z: -33 }, { x: -18, y, z: -34 }], { action: 3 });
      lines.push(`${mode} batch ${Buffer.from(batch).toString("hex")}`);
      assertions.push((bytes) => { const events = []; c.onDig = (event) => events.push(event); c.decodeDigEventBatch(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)); assert.equal(events.length, 2); assert.ok(events.every((event) => event.y === y)); });
      for (const command of ["move", "join"]) {
        const fractionalY = y === 320 ? y : y + 0.25;
        const move = c.encodeMove({ x: -17.5, y: fractionalY, z: -33.25, yaw: 0.5, pitch: -0.2 });
        lines.push(`${mode} ${command} ${Buffer.from(move).toString("hex")}`);
        assertions.push((bytes) => { const players = []; c.onPlayerMove = c.onPlayerJoin = (pose) => players.push(pose); const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); if (command === "move") c.decodeMoveBatch(view); else c.decodePlayerJoin(view); assert.equal(players[0].y, fractionalY); assert.equal(players[0].x, -17.5); assert.equal(players[0].z, -33.25); });
      }
    }
  }
  const result = spawnSync(process.env.NICECHUNK_GUARDIAN_VECTOR_BIN, [], { input: lines.join("\n") + "\n", encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const output = result.stdout.trim().split("\n");
  assert.equal(output.length, assertions.length);
  output.forEach((hex, index) => { assert.notEqual(hex, "rejected", lines[index]); assertions[index](Buffer.from(hex, "hex")); });
});

test("every historical PLAYER_JOIN length uses the negotiated Y mode and validates truncated move batches", () => {
  for (const offset32 of [false, true]) for (const length of [13, 17, 25, 57]) {
    const poses = [], errors = [], c = client({ onPlayerJoin: (pose) => poses.push(pose), onProtocolError: (error) => errors.push(error) });
    c.decodeHelloAck(ack(offset32 ? GUARDIAN_Y_OFFSET32_V1 : 0));
    for (const y of heights.filter((value) => offset32 || value >= 0)) {
      const bytes = new Uint8Array(length), view = new DataView(bytes.buffer), poseOffset = length - 10;
      bytes[0] = 0x30; view.setUint16(1, 2, true); bytes[poseOffset] = 98; bytes[poseOffset + 1] = 97;
      view.setUint16(poseOffset + 2, 928, true); view.setUint16(poseOffset + 4, encodeGuardianY(y, { offset32, fractional: true }), true); view.setUint16(poseOffset + 6, 944, true);
      c.decodePlayerJoin(view);
      assert.equal(poses.at(-1).y, y); assert.equal(poses.at(-1).x, -17.5); assert.equal(poses.at(-1).z, -33.25);
    }
    for (const length of [0, 1, 2, 3]) c.decodeMoveBatch(new DataView(new ArrayBuffer(length)));
    assert.equal(errors.length, 4);
  }
});
