export function createPlayItemName({
  blockDef,
  voxelItemLabel,
  resourceName,
  translate,
} = {}) {
  return (item = {}) => {
    if (item.kind === "blueprint" || item.itemId === "blueprint_tool") {
      return safeTranslation(translate, "main.blueprint.toolName") || safeVoxelLabel(voxelItemLabel, item) || "Blueprint";
    }
    if (item.kind === "smelted_material" && item.materialId) {
      const translationKey = `resourceAtlas.material.item.${item.materialId}.name`;
      const translated = safeTranslation(translate, translationKey);
      if (translated) return translated;
      return humanizeIdentifier(item.materialId);
    }
    if (Number(item.decorationId) > 0) {
      const decorationBlockId = finitePositiveInteger(item.blockId);
      const decorationBlockKey = decorationBlockId === null
        ? ""
        : String(blockDef?.(decorationBlockId)?.name || "").trim();
      if (decorationBlockKey) {
        const translated = safeTranslation(translate, `main.block.${decorationBlockKey}`);
        if (translated) return translated;
      }
      return safeVoxelLabel(voxelItemLabel, item) || fallbackResourceLabel(resourceName, item.resourceId);
    }

    const blockId = finitePositiveInteger(item.blockId);
    if (blockId !== null) {
      const blockKey = String(blockDef?.(blockId)?.name || "").trim();
      if (blockKey) {
        const translationKey = `main.block.${blockKey}`;
        const translated = safeTranslation(translate, translationKey);
        if (translated) return translated;
        return humanizeIdentifier(blockKey);
      }
      const voxelLabel = safeVoxelLabel(voxelItemLabel, item);
      if (voxelLabel) return voxelLabel;
    }

    if (item.kind !== "resource") {
      const voxelLabel = safeVoxelLabel(voxelItemLabel, item);
      if (voxelLabel) return voxelLabel;
    }
    return fallbackResourceLabel(resourceName, item.resourceId);
  };
}

function safeVoxelLabel(formatter, item) {
  if (typeof formatter !== "function") return "";
  try {
    return String(formatter(item) || "").trim();
  } catch {
    return "";
  }
}

function safeTranslation(translate, key) {
  if (typeof translate !== "function") return "";
  try {
    const translated = String(translate(key) || "").trim();
    return translated && translated !== key ? translated : "";
  } catch {
    return "";
  }
}

function fallbackResourceLabel(formatter, resourceId) {
  if (typeof formatter === "function") {
    try {
      const label = String(formatter(resourceId) || "").trim();
      if (label) return label;
    } catch {
      // A formatter failure must not prevent inventory rendering.
    }
  }
  const id = Math.trunc(Number(resourceId) || 0);
  return id > 0 ? `Resource ${id}` : "Item";
}

function finitePositiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && Math.trunc(number) > 0 ? Math.trunc(number) : null;
}

function humanizeIdentifier(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
