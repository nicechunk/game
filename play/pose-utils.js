export function parsePoseText(text, { minViewDistance = 2, maxViewDistance = 20, pitchMin = -0.92, pitchMax = 0.42 } = {}) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  let object = null;
  if (raw.startsWith("{")) {
    try {
      object = JSON.parse(raw);
    } catch {
      object = null;
    }
  }
  const values = object ? { ...object } : {};
  if (!object) {
    const pattern = /([a-zA-Z][a-zA-Z0-9_]*)\s*[:=]\s*(-?\d+(?:\.\d+)?)/g;
    let match;
    while ((match = pattern.exec(raw))) values[match[1]] = Number(match[2]);
  }
  const x = numberFrom(values.x ?? values.px ?? values.worldX);
  const y = numberFrom(values.y ?? values.py ?? values.worldY);
  const z = numberFrom(values.z ?? values.pz ?? values.worldZ);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  const splitX = splitWorldCoordinate(x);
  const splitY = splitWorldCoordinate(y);
  const splitZ = splitWorldCoordinate(z);
  const controlYaw = angleFrom(values.cy ?? values.cameraYaw ?? values.yaw ?? values.controlYaw);
  const avatarYaw = angleFrom(values.ay ?? values.avatarYaw ?? values.playerYaw ?? controlYaw);
  const cameraPitch = angleFrom(values.cp ?? values.cameraPitch ?? values.pitch);
  const flightEnabled = booleanFrom(values.fly ?? values.flight ?? values.flightEnabled);
  return {
    worldX: splitX.world,
    worldY: splitY.world,
    worldZ: splitZ.world,
    localOffsetX: splitX.local,
    localOffsetY: splitY.local,
    localOffsetZ: splitZ.local,
    fullX: x,
    fullY: y,
    fullZ: z,
    avatarYaw: Number.isFinite(avatarYaw) ? avatarYaw : undefined,
    controlYaw: Number.isFinite(controlYaw) ? controlYaw : undefined,
    cameraPitch: Number.isFinite(cameraPitch) ? clamp(cameraPitch, pitchMin, pitchMax) : undefined,
    viewDistance: Number.isFinite(values.view) ? clampInt(values.view, minViewDistance, maxViewDistance) : undefined,
    flightEnabled,
  };
}

export function hasSpawnParam(params, axis = null) {
  if (axis) return params.has(axis);
  return params.has("x") || params.has("y") || params.has("z");
}

export function spawnCoord(params, axis, fallback) {
  if (params.has(axis)) return Math.trunc(Number(params.get(axis)) || 0);
  return Math.trunc(Number(fallback) || 0);
}

export function spawnCoordOrNull(params, axis, fallback = null) {
  if (params.has(axis)) return Math.trunc(Number(params.get(axis)) || 0);
  return Number.isFinite(fallback) ? Math.trunc(fallback) : null;
}

export function fixed3(value) {
  return Number.isFinite(value) ? Number(value).toFixed(3) : "0.000";
}

function splitWorldCoordinate(value) {
  const world = Math.floor(Number(value) || 0);
  return { world, local: clamp((Number(value) || 0) - world, 0, 0.999999) };
}

function angleFrom(value) {
  const angle = numberFrom(value);
  if (!Number.isFinite(angle)) return NaN;
  return Math.abs(angle) > Math.PI * 2.5 ? angle * Math.PI / 180 : angle;
}

function numberFrom(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function booleanFrom(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "on") return true;
    if (normalized === "false" || normalized === "off") return false;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number !== 0 : undefined;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.trunc(Number(value) || min)));
}
