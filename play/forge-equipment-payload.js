export const NCF1_EQUIPMENT_VERSION = 14;
export const NCF1_EQUIPMENT_MIN_RAW_BYTES = 14;
export const NCF1_EQUIPMENT_MAX_RAW_BYTES = 640;

export function equipmentPayloadBytes(value) {
  if (value instanceof Uint8Array) return value.length ? value : null;
  if (Array.isArray(value)) return value.length ? Uint8Array.from(value) : null;
  if (value instanceof ArrayBuffer) return value.byteLength ? new Uint8Array(value) : null;
  if (ArrayBuffer.isView(value)) {
    return value.byteLength
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : null;
  }
  return null;
}

export function validatedNcf1EquipmentPayload(value, expectedDesignHash) {
  const bytes = equipmentPayloadBytes(value);
  const designHash = Math.trunc(Number(expectedDesignHash) || 0) >>> 0;
  if (!bytes
    || !designHash
    || bytes.length < NCF1_EQUIPMENT_MIN_RAW_BYTES
    || bytes.length > NCF1_EQUIPMENT_MAX_RAW_BYTES
    || (bytes[0] >> 4) !== NCF1_EQUIPMENT_VERSION
    || forgePayloadHash(bytes) !== designHash) return null;
  return bytes;
}

export function forgePayloadHash(value) {
  const bytes = equipmentPayloadBytes(value);
  if (!bytes) return 0;
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= Number(byte) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function forgePayloadIdentity(value) {
  const bytes = equipmentPayloadBytes(value);
  if (!bytes) return "0";
  let secondary = 0x9e3779b9;
  for (const byte of bytes) {
    secondary ^= Number(byte) & 0xff;
    secondary = Math.imul(secondary, 0x85ebca6b) >>> 0;
    secondary ^= secondary >>> 13;
  }
  return `${bytes.length}:${forgePayloadHash(bytes).toString(16).padStart(8, "0")}:${secondary.toString(16).padStart(8, "0")}`;
}

export function forgePayloadSourceIdentity(source) {
  if (typeof source === "string") return `text:${source}`;
  return forgePayloadIdentity(source);
}
