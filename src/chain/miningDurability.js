import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";

export const MINING_TOOL_REFERENCE_BYTES = 1;
const ZERO_ITEM = new PublicKey(new Uint8Array(32)).toBase58();

// The request identifies a tool. It has no durability or damage amount field.
export function encodeMiningToolReference(tool) {
  const bytes = Buffer.alloc(MINING_TOOL_REFERENCE_BYTES);
  if (tool?.kind !== "equipment" || !Number.isInteger(tool.equipmentSlot)
      || tool.equipmentSlot < 0 || tool.equipmentSlot >= 9) {
    throw new Error("Mining requires an equipped on-chain tool.");
  }
  if (!tool.itemPda) throw new Error("Mining tool identity is missing.");
  const item = new PublicKey(tool.itemPda);
  if (item.toBase58() === ZERO_ITEM) throw new Error("Mining tool identity is missing.");
  bytes[0] = tool.equipmentSlot;
  return bytes;
}

export function decodeMiningDurabilityReceipt(bytes) {
  let data = Buffer.from(bytes);
  if (data.length === 85 && data.subarray(0, 8).toString("ascii") === "NCKWAT01") data = data.subarray(28);
  if (data.length !== 57 || data.subarray(0, 8).toString("ascii") !== "NCKDUR01") return null;
  const tool = data[8];
  const durabilityCurrent = data.readUInt32LE(9);
  const durabilityMax = data.readUInt32LE(13);
  const itemPda = new PublicKey(data.subarray(25, 57)).toBase58();
  if (tool >= 9 || !durabilityMax || durabilityCurrent > durabilityMax || itemPda === ZERO_ITEM) return null;
  return {
    kind: "equipment",
    equipmentSlot: tool,
    itemPda,
    durabilityCurrent,
    durabilityMax,
    updatedSlot: data.readBigUInt64LE(17).toString(),
  };
}

export function waterCollectionFromTransaction(transaction, programId, tool, actionId) {
  if (!transaction?.meta || transaction.meta.err) return null;
  for (const encoded of returnCandidates(transaction, programId).reverse()) {
    if (typeof encoded !== "string") continue;
    const data = Buffer.from(encoded, "base64");
    if (data.length !== 85 || data.subarray(0, 8).toString("ascii") !== "NCKWAT01") continue;
    const durability = decodeMiningDurabilityReceipt(data);
    if (!durability || durability.equipmentSlot !== tool?.equipmentSlot || durability.itemPda !== tool?.itemPda
        || data.readBigUInt64LE(8) !== BigInt(actionId)) continue;
    const waterRemainderMl = data.readUInt32LE(16), waterCapacityMl = data.readUInt32LE(20), waterUnits = data.readUInt32LE(24);
    if (!waterCapacityMl || waterRemainderMl >= 1000 || waterUnits > 1 || waterUnits && waterRemainderMl !== 0) continue;
    return { waterRemainderMl, waterCapacityMl, waterRequiredHits: Math.ceil((1000 - waterRemainderMl) / waterCapacityMl), waterUnits, miningDurability: durability };
  }
  return null;
}

function returnCandidates(transaction, programId) {
  const issuer = String(programId), candidates = [];
  if (String(transaction.meta.returnData?.programId) === issuer) candidates.push(transaction.meta.returnData.data?.[0]);
  const prefix = `Program return: ${issuer} `;
  for (const line of transaction.meta.logMessages ?? []) {
    if (line.startsWith(prefix)) candidates.push(line.slice(prefix.length));
  }
  return candidates;
}

export function miningDurabilityFromTransaction(transaction, programId, tool) {
  if (!transaction?.meta || transaction.meta.err || !tool) return null;
  const issuer = String(programId);
  const expected = encodeMiningToolReference(tool);
  const candidates = [];
  if (transaction.meta.returnData?.programId === issuer) {
    candidates.push(transaction.meta.returnData.data?.[0]);
  }
  // Later skills/position instructions may overwrite transaction returnData.
  // These exact lines are emitted by the runtime, unlike "Program log:" text.
  const prefix = `Program return: ${issuer} `;
  for (const line of transaction.meta.logMessages ?? []) {
    if (line.startsWith(prefix)) candidates.push(line.slice(prefix.length));
  }
  for (const encoded of candidates.reverse()) {
    if (typeof encoded !== "string") continue;
    const data = Buffer.from(encoded, "base64");
    const receipt = decodeMiningDurabilityReceipt(data);
    if (receipt && receipt.equipmentSlot === expected[0] && receipt.itemPda === new PublicKey(tool.itemPda).toBase58()) {
      return receipt;
    }
  }
  return null;
}
