import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import {
  createBuildSiteInstruction,
  deriveGlobalConfigPda,
} from "../../src/chain/nicechunkChain.js";

const gameProgram = new PublicKey("6CurnvneezBuHwPUnrCiFg1QMWeUF67ufQxYebyr2UP7");

test("foundation creation proves ownership of its unique Blueprint PDA", () => {
  const authority = Keypair.generate().publicKey;
  const owner = Keypair.generate().publicKey;
  const foundationId = 1_871_540_354_255_386_112n;
  const idBytes = Buffer.alloc(8);
  idBytes.writeBigUInt64LE(foundationId);
  const [blueprintItem] = PublicKey.findProgramAddressSync(
    [Buffer.from("blueprint-item"), idBytes],
    gameProgram,
  );
  const globalConfig = deriveGlobalConfigPda();
  const [buildSite] = PublicKey.findProgramAddressSync(
    [Buffer.from("build-site-v2"), globalConfig.toBuffer(), idBytes],
    new PublicKey("39UMTUWXQkuomkFNbDPF5NGZnJmG6pDkJHVSkZyqVwWx"),
  );

  const instruction = createBuildSiteInstruction({
    authority,
    owner,
    foundationId,
    foundation: { minX: 128, surfaceY: 100, minZ: 128, width: 4, depth: 4 },
  });

  assert.equal(instruction.keys.length, 7);
  assert.equal(instruction.keys[3].pubkey.toBase58(), buildSite.toBase58());
  assert.equal(instruction.keys[4].pubkey.toBase58(), globalConfig.toBase58());
  assert.equal(instruction.keys[5].pubkey.toBase58(), SystemProgram.programId.toBase58());
  assert.equal(instruction.keys[6].pubkey.toBase58(), blueprintItem.toBase58());
  assert.equal(instruction.keys[6].isSigner, false);
  assert.equal(instruction.keys[6].isWritable, false);
});
