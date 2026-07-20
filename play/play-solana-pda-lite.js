const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PDA_MARKER = new TextEncoder().encode("ProgramDerivedAddress");
const ED25519_P = (1n << 255n) - 19n;
const ED25519_D = BigInt("0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3");
const INT32_MIN = -0x80000000;
const INT32_MAX = 0x7fffffff;

export function createChunkBrokenPdaDeriver({ seed, globalConfig, programId } = {}) {
  const seedBytes = new TextEncoder().encode(String(seed || ""));
  if (!seedBytes.length || seedBytes.length > 32) throw new Error("Invalid chunk PDA seed.");
  const globalConfigBytes = decodeBase58PublicKey(globalConfig);
  const programIdBytes = decodeBase58PublicKey(programId);

  return async function deriveChunkBrokenPda(chunkX, chunkZ) {
    const x = checkedInt32(chunkX, "chunkX");
    const z = checkedInt32(chunkZ, "chunkZ");
    const input = new Uint8Array(seedBytes.length + 32 + 4 + 4 + 1 + 32 + PDA_MARKER.length);
    let offset = 0;
    input.set(seedBytes, offset);
    offset += seedBytes.length;
    input.set(globalConfigBytes, offset);
    offset += globalConfigBytes.length;
    new DataView(input.buffer).setInt32(offset, x, true);
    offset += 4;
    new DataView(input.buffer).setInt32(offset, z, true);
    offset += 4;
    const bumpOffset = offset;
    offset += 1;
    input.set(programIdBytes, offset);
    offset += programIdBytes.length;
    input.set(PDA_MARKER, offset);

    for (let bump = 255; bump > 0; bump -= 1) {
      input[bumpOffset] = bump;
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
      if (!isEd25519Point(digest)) return encodeBase58(digest);
    }
    throw new Error(`Unable to derive chunk PDA ${x},${z}.`);
  };
}

export function decodeBase58PublicKey(value) {
  const text = String(value || "");
  let number = 0n;
  for (let index = 0; index < text.length; index += 1) {
    const digit = BASE58_ALPHABET.indexOf(text[index]);
    if (digit < 0) throw new Error("Invalid base58 public key.");
    number = number * 58n + BigInt(digit);
  }

  const reversed = [];
  while (number > 0n) {
    reversed.push(Number(number & 0xffn));
    number >>= 8n;
  }
  let leadingZeros = 0;
  while (text[leadingZeros] === "1") leadingZeros += 1;
  const bytes = new Uint8Array(leadingZeros + reversed.length);
  for (let index = 0; index < reversed.length; index += 1) bytes[bytes.length - index - 1] = reversed[index];
  if (bytes.length !== 32) throw new Error("Invalid public key length.");
  return bytes;
}

export function encodeBase58(bytes) {
  let number = 0n;
  for (const byte of bytes) number = number * 256n + BigInt(byte);
  let encoded = "";
  while (number > 0n) {
    const digit = Number(number % 58n);
    number /= 58n;
    encoded = BASE58_ALPHABET[digit] + encoded;
  }
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros += 1;
  return "1".repeat(leadingZeros) + encoded;
}

function isEd25519Point(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) return false;
  const xSign = (bytes[31] & 0x80) !== 0;
  let y = BigInt(bytes[31] & 0x7f);
  for (let index = 30; index >= 0; index -= 1) y = (y << 8n) + BigInt(bytes[index]);
  if (y >= ED25519_P) return false;

  const ySquared = (y * y) % ED25519_P;
  const u = modP(ySquared - 1n);
  const v = modP(ED25519_D * ySquared + 1n);
  const v3 = modP(v * v * v);
  const v7 = modP(v3 * v3 * v);
  const x = modP(u * v3 * powP252Minus3(modP(u * v7)));
  const vxSquared = modP(v * x * x);
  if (vxSquared !== u && vxSquared !== modP(-u)) return false;
  return !(x === 0n && xSign);
}

// Addition chain for x^((p - 5) / 8), matching Ed25519 point decoding.
function powP252Minus3(x) {
  const x2 = (x * x) % ED25519_P;
  const b2 = (x2 * x) % ED25519_P;
  const b4 = (squareTimes(b2, 2) * b2) % ED25519_P;
  const b5 = (squareTimes(b4, 1) * x) % ED25519_P;
  const b10 = (squareTimes(b5, 5) * b5) % ED25519_P;
  const b20 = (squareTimes(b10, 10) * b10) % ED25519_P;
  const b40 = (squareTimes(b20, 20) * b20) % ED25519_P;
  const b80 = (squareTimes(b40, 40) * b40) % ED25519_P;
  const b160 = (squareTimes(b80, 80) * b80) % ED25519_P;
  const b240 = (squareTimes(b160, 80) * b80) % ED25519_P;
  const b250 = (squareTimes(b240, 10) * b10) % ED25519_P;
  return (squareTimes(b250, 2) * x) % ED25519_P;
}

function squareTimes(value, count) {
  let result = value;
  for (let index = 0; index < count; index += 1) result = (result * result) % ED25519_P;
  return result;
}

function modP(value) {
  const result = value % ED25519_P;
  return result < 0n ? result + ED25519_P : result;
}

function checkedInt32(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < INT32_MIN || number > INT32_MAX) throw new Error(`Invalid ${label}.`);
  return number;
}
