import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import net from "node:net";
import { createNiceChunkGuardianClient } from "../play-guardian-client.js";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Opt-in local executable, never a production Guardian endpoint.
test("actual loopback Guardian exchanges signed underground poses and digs between new/legacy clients", { skip: !process.env.NICECHUNK_GUARDIAN_TEST_BIN, timeout: 30_000 }, async () => {
  const reservation = net.createServer(); await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port; await new Promise((resolve) => reservation.close(resolve));
  const server = spawn(process.env.NICECHUNK_GUARDIAN_TEST_BIN, ["--host", "127.0.0.1", "--port", String(port), "--no-tui"], { stdio: ["ignore", "pipe", "pipe"] });
  let serverLog = ""; server.stdout.on("data", (data) => { serverLog += data; }); server.stderr.on("data", (data) => { serverLog += data; });
  const previousWindow = globalThis.window; globalThis.window = globalThis;
  const peers = [];
  const waitFor = async (condition, label) => { for (let attempt = 0; attempt < 2000; attempt++) { if (condition()) return; if (server.exitCode !== null) throw new Error(`Guardian exited: ${serverLog}`); await sleep(1); } throw new Error(`Guardian integration timed out: ${label}; ${serverLog}`); };
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const reachable = await new Promise((resolve) => { const socket = net.connect(port, "127.0.0.1"); socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", () => resolve(false)); });
      if (reachable) break;
      if (attempt === 99) throw new Error(`Guardian did not bind loopback: ${serverLog}`);
      await sleep(10);
    }
    const wallets = ["6CurnvneezBuHwPUnrCiFg1QMWeUF67ufQxYebyr2UP7", "CHZHsBCGn58ih2WrPfKSYhvCEjMPGhArTiYCH7AWWBkB", "GnVKn442KDTDgCyjVG7SEtCQQLjaCiLvrEZDWSU13wbj"];
    wallets.forEach((walletAddress, index) => {
      const events = { ready: [], move: [], join: [], dig: [], errors: [] };
      const client = createNiceChunkGuardianClient({ walletAddress, url: `ws://127.0.0.1:${port}/ws`, advertiseOffsetY: index !== 2, autoReconnect: false,
        onReady: (event) => events.ready.push(event), onPlayerMove: (event) => events.move.push(event), onPlayerJoin: (event) => events.join.push(event), onDig: (event) => events.dig.push(event), onProtocolError: (error) => events.errors.push(error),
      });
      peers.push({ client, events }); client.connect({ position: { x: 1 + index, y: index === 2 ? 80 : -17.5, z: 1 } });
    });
    await waitFor(() => peers.every(({ client }) => client.isReady()), "three HELLO/ACKs");
    assert.deepEqual(peers.map(({ client }) => client.supportsOffsetY), [true, true, false]);
    for (let index = 0; index < 3; index++) peers[index].client.updateLocalPlayer({ x: 1 + index, y: index === 2 ? 80 : -17.5, z: 1, yaw: 0, pitch: 0 }, 1000);
    const sourceId = peers[0].client.localPlayerId, legacyId = peers[2].client.localPlayerId;
    await waitFor(() => [...peers[1].events.join, ...peers[1].events.move].some((pose) => pose.localPlayerId === sourceId && pose.y === -17.5), "new peer underground move");
    await waitFor(() => [...peers[1].events.join, ...peers[1].events.move].some((pose) => pose.localPlayerId === legacyId && pose.y === 80), "legacy sender canonicalized for a new receiver");
    assert.ok(![...peers[2].events.join, ...peers[2].events.move].some((pose) => pose.localPlayerId === sourceId), "legacy receiver never receives underground Y0 aliases");
    assert.equal(peers[0].client.sendDig({ x: 1, y: -17, z: 1, action: 3 }), true);
    await waitFor(() => peers[1].events.dig.some((event) => event.y === -17), "negative single dig");
    assert.equal(peers[2].events.dig.length, 0);
    assert.equal(peers[0].client.sendDigBatch([{ x: 1, y: -32, z: 1 }, { x: 1, y: 1, z: 1 }], { action: 3 }), true);
    await waitFor(() => peers[1].events.dig.some((event) => event.y === -32) && peers[2].events.dig.some((event) => event.y === 1), "mixed-height batch filtering");
    assert.deepEqual(peers[2].events.dig.map((event) => event.y), [1]);
    peers[0].client.updateLocalPlayer({ x: 1, y: 1.25, z: 1, yaw: 0, pitch: 0 }, 1100);
    await waitFor(() => peers[2].events.move.some((pose) => pose.localPlayerId === sourceId && pose.y === 1.25), "new sender positive move transcoded for legacy receiver");
    // Rejoining while model/state are unchanged exercises real initial PLAYER_JOIN
    // history packets with the negotiated Y encoding.
    peers[1].client.disconnect();
    peers[1].client.connect({ position: { x: 2, y: -17.5, z: 1 } });
    await waitFor(() => peers[1].events.ready.length === 2, "reconnect ACK and current snapshot");
    assert.ok(peers.every(({ events }) => events.errors.length === 0));
  } finally {
    peers.forEach(({ client }) => client.disconnect()); globalThis.window = previousWindow;
    server.kill("SIGTERM"); await new Promise((resolve) => { if (server.exitCode !== null) resolve(); else server.once("exit", resolve); });
  }
});
