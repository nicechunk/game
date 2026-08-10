import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";

import { createChunkPdaDeriver } from "../play-solana-pda-lite.js";

const [globalConfigKey] = PublicKey.findProgramAddressSync(
  [Buffer.from("global-config")],
  new PublicKey("9EhMCRYMJej1F21KzaA5Zao3khGGc5aJbDGbnxaogQHu"),
);
const globalConfig = globalConfigKey.toBase58();
const programId = "GnVKn442KDTDgCyjVG7SEtCQQLjaCiLvrEZDWSU13wbj";

test("the worker PDA deriver matches web3 for broken and placed chunk seeds", async () => {
  for (const seed of ["chunk-broken", "chunk-placed"]) {
    const derive = createChunkPdaDeriver({ seed, globalConfig, programId });
    const actual = await derive(-7, 11);
    const x = Buffer.alloc(4);
    const z = Buffer.alloc(4);
    x.writeInt32LE(-7);
    z.writeInt32LE(11);
    const [expected] = PublicKey.findProgramAddressSync([
      Buffer.from(seed),
      new PublicKey(globalConfig).toBuffer(),
      x,
      z,
    ], new PublicKey(programId));
    assert.equal(actual, expected.toBase58());
  }
});
