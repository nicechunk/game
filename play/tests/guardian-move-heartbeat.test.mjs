import assert from "node:assert/strict";
import test from "node:test";

import { createNiceChunkGuardianClient } from "../play-guardian-client.js";

test("a stationary Guardian player sends a low-frequency movement heartbeat", () => {
  const previousWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = { OPEN: 1 };
  try {
    const sent = [];
    const client = createNiceChunkGuardianClient({
      url: "wss://guardian.example/ws",
      walletAddress: "11111111111111111111111111111111",
      moveHeartbeatMs: 5_000,
    });
    client.ready = true;
    client.socket = {
      readyState: WebSocket.OPEN,
      send(packet) { sent.push(new Uint8Array(packet)); },
    };
    const pose = { x: 3, y: 80, z: -4, yaw: 0.5, pitch: -0.2 };

    client.updateLocalPlayer(pose, 100);
    client.updateLocalPlayer(pose, 5_099);
    assert.equal(sent.length, 1, "an unchanged pose should remain quiet before the heartbeat deadline");

    client.updateLocalPlayer(pose, 5_100);
    assert.equal(sent.length, 2, "an unchanged pose should be resent at the heartbeat deadline");
    assert.equal(sent[1].byteLength, 13);

    client.updateLocalPlayer({ ...pose, x: 4 }, 5_151);
    assert.equal(sent.length, 3, "real movement should still use the normal movement interval");
  } finally {
    globalThis.WebSocket = previousWebSocket;
  }
});
