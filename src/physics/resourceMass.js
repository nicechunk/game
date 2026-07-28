export const DEFAULT_RESOURCE_DIMENSIONS_M = Object.freeze({
  width: 0.1,
  height: 0.1,
  depth: 0.1,
});

export function volumeM3FromDimensions(dimensionsM = DEFAULT_RESOURCE_DIMENSIONS_M) {
  const dimensions = normalizeDimensions(dimensionsM);
  const width = positiveNumber(dimensions.width);
  const height = positiveNumber(dimensions.height);
  const depth = positiveNumber(dimensions.depth);
  if (width == null || height == null || depth == null) return null;
  return roundMeasurement(width * height * depth, 6);
}

export function massKgFromDensity(densityKgM3, dimensionsM = DEFAULT_RESOURCE_DIMENSIONS_M) {
  const density = positiveNumber(densityKgM3);
  const volume = volumeM3FromDimensions(dimensionsM);
  if (density == null || volume == null) return null;
  return roundMeasurement(density * volume, 6);
}

export function physicalProfileFromDensity(densityKgM3, dimensionsM = DEFAULT_RESOURCE_DIMENSIONS_M) {
  const dimensions = normalizeDimensions(dimensionsM);
  return {
    densityKgM3,
    dimensionsM: dimensions,
    volumeM3: volumeM3FromDimensions(dimensions),
    massKg: massKgFromDensity(densityKgM3, dimensions),
  };
}

function normalizeDimensions(dimensionsM) {
  const dimensions = dimensionsM ?? DEFAULT_RESOURCE_DIMENSIONS_M;
  return {
    width: positiveNumber(dimensions.width) ?? DEFAULT_RESOURCE_DIMENSIONS_M.width,
    height: positiveNumber(dimensions.height) ?? DEFAULT_RESOURCE_DIMENSIONS_M.height,
    depth: positiveNumber(dimensions.depth) ?? DEFAULT_RESOURCE_DIMENSIONS_M.depth,
  };
}

function positiveNumber(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function roundMeasurement(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
