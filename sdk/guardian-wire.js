// Guardian protocol 1 capability negotiated in HELLO.clientFlags and
// HELLO_ACK.serverFlags. Length variants do not negotiate this capability.
export const GUARDIAN_Y_OFFSET32_V1 = 1 << 3;
export const GUARDIAN_MIN_Y = -32;
export const GUARDIAN_MAX_Y = 320;
export const GUARDIAN_POSITION_PRECISION = 64;

export function encodeGuardianY(value, { offset32 = false, fractional = false, precision = GUARDIAN_POSITION_PRECISION } = {}) {
  if (precision !== GUARDIAN_POSITION_PRECISION) return null;
  if (!Number.isFinite(value) || value < GUARDIAN_MIN_Y || value > GUARDIAN_MAX_Y) return null;
  if (!offset32 && value < 0) return null;
  return fractional ? Math.round((value + (offset32 ? 32 : 0)) * precision) : Math.floor(value) + (offset32 ? 32 : 0);
}

export function decodeGuardianY(value, { offset32 = false, fractional = false, precision = GUARDIAN_POSITION_PRECISION } = {}) {
  if (precision !== GUARDIAN_POSITION_PRECISION) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) return null;
  const y = (fractional ? value / precision : value) - (offset32 ? 32 : 0);
  return y >= GUARDIAN_MIN_Y && y <= GUARDIAN_MAX_Y ? y : null;
}
