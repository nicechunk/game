import { BACKPACK_CAPACITY } from "./game-state.js";
import { backpackSlotMeta } from "./play-ui-format.js";

const DEFAULT_CATEGORY = "all";
const NATURAL_RESOURCE_WORDS = Object.freeze([
  "fiber",
  "wood",
  "leaves",
  "organic",
  "cactus",
  "reed",
  "moss",
  "mushroom",
  "plant",
  "flower",
  "coral",
  "shell",
]);

export function createPlayBackpackUi({
  elements,
  gameState,
  createVoxelItemIconCanvas,
  resourceName = null,
  voxelItemLabel,
  translate = (_key, fallback, params = {}) => formatMessage(fallback, params),
} = {}) {
  let activeCategory = DEFAULT_CATEGORY;
  let categoriesBound = false;
  const ui = (key, fallback, params = {}) => {
    try {
      const translated = translate(key, fallback, params);
      if (translated && translated !== key) return String(translated);
    } catch {
      // A locale failure must not prevent the backpack from opening.
    }
    return formatMessage(fallback, params);
  };

  bindCategories();

  return {
    render,
    openPanel,
    closePanel,
    togglePanel,
    activeCategory: () => activeCategory,
  };

  function bindCategories() {
    if (categoriesBound) return;
    categoriesBound = true;
    elements.backpackCategoryButtons?.forEach((button) => {
      button.addEventListener("click", () => {
        const nextCategory = String(button.dataset.backpackCategory || DEFAULT_CATEGORY);
        if (nextCategory === activeCategory) return;
        activeCategory = nextCategory;
        render();
        elements.backpackGrid?.dispatchEvent(new CustomEvent("backpackfilterchange", {
          detail: { category: activeCategory },
        }));
      });
    });
  }

  function render({ force = false } = {}) {
    if (!elements.backpackGrid) return;
    if (!force && elements.backpackPanel?.hidden) return;
    const slots = gameState.backpackSlots;
    const capacity = Math.max(1, Math.trunc(Number(gameState.backpackCapacity) || BACKPACK_CAPACITY));
    const totalItems = gameState.totalBackpackItems();
    if (elements.backpackMeta) {
      const stackMeta = document.createElement("span");
      stackMeta.className = "backpack-meta-stacks";
      stackMeta.textContent = `${slots.length} / ${capacity}`;
      const itemMeta = document.createElement("span");
      itemMeta.className = "backpack-meta-items";
      itemMeta.textContent = `${totalItems} items`;
      const weightMeta = document.createElement("span");
      weightMeta.className = "backpack-meta-weight";
      weightMeta.textContent = gameState.backpackMassInitialized
        ? ui("main.backpack.totalWeight", "Weight {weight}", {
            weight: formatBackpackMass(gameState.backpackTotalMassGrams),
          })
        : ui("main.backpack.weightPending", "Weight pending");
      elements.backpackMeta.replaceChildren(stackMeta, itemMeta, weightMeta);
    }
    updateCategoryButtons(slots);

    const entries = slots.map((slot, index) => ({ slot, index }));
    const visible = activeCategory === DEFAULT_CATEGORY
      ? entries
      : entries.filter(({ slot }) => backpackCategory(slot) === activeCategory);
    const cells = visible.map(({ slot, index }, displayIndex) => backpackCell(slot, index, displayIndex));
    for (let displayIndex = cells.length; displayIndex < capacity; displayIndex += 1) {
      cells.push(emptyBackpackCell(displayIndex));
    }
    elements.backpackGrid.replaceChildren(...cells);
  }

  function updateCategoryButtons(slots) {
    const counts = new Map([[DEFAULT_CATEGORY, slots.length]]);
    for (const slot of slots) {
      const category = backpackCategory(slot);
      counts.set(category, (counts.get(category) || 0) + 1);
    }
    elements.backpackCategoryButtons?.forEach((button) => {
      const category = String(button.dataset.backpackCategory || DEFAULT_CATEGORY);
      const selected = category === activeCategory;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      const count = button.querySelector("b");
      if (count) count.textContent = String(counts.get(category) || 0);
    });
  }

  function backpackCell(slot, index, displayIndex) {
    const cell = document.createElement("div");
    cell.className = "backpack-slot";
    const equipment = gameState.getBackpackSlotEquipment?.(slot) ?? null;
    const equipped = Boolean(equipment);
    if (equipped) cell.classList.add("equipped");
    cell.dataset.backpackSlot = String(index);
    cell.dataset.backpackItemCategory = backpackCategory(slot);
    cell.dataset.backpackItemId = String(slot.id || "");
    cell.dataset.equipped = equipped ? "true" : "false";
    cell.tabIndex = 0;
    cell.setAttribute("role", "button");
    cell.setAttribute("aria-disabled", equipped ? "true" : "false");

    const titleText = safeItemName(slot);
    const equipmentText = equipped ? ui(
      "main.backpack.equippedSlot",
      "Equipped in hotbar slot {slot}",
      { slot: equipment.index + 1 },
    ) : "";
    cell.title = [titleText, backpackSlotMeta(slot), equipmentText].filter(Boolean).join(" · ");
    cell.setAttribute("aria-label", [
      `${titleText}, slot ${index + 1}, count ${slot.count || 0}`,
      equipmentText,
    ].filter(Boolean).join(", "));

    const slotNumber = document.createElement("span");
    slotNumber.className = "backpack-slot-number";
    slotNumber.textContent = String(displayIndex + 1);
    const icon = createVoxelItemIconCanvas(slot, { size: 48 });
    icon.classList.add("backpack-slot-icon");
    const title = document.createElement("strong");
    title.className = "backpack-slot-name";
    title.textContent = titleText;
    const count = document.createElement("span");
    count.className = "backpack-slot-count";
    count.textContent = String(slot.count || 0);
    cell.append(slotNumber, icon, title, count);

    if (equipped) {
      const badge = document.createElement("span");
      badge.className = "backpack-slot-equipped";
      badge.textContent = ui("main.backpack.equipped", "Equipped");
      badge.title = ui(
        "main.backpack.equippedLocked",
        "Equipped in hotbar slot {slot}. Unequip it before selecting, moving, or discarding it.",
        { slot: equipment.index + 1 },
      );
      cell.append(badge);
    }

    if (slot.pending) {
      const pending = document.createElement("i");
      pending.className = "backpack-slot-pending";
      pending.textContent = "Pending";
      cell.append(pending);
    }
    return cell;
  }

  function emptyBackpackCell(displayIndex) {
    const cell = document.createElement("div");
    cell.className = "backpack-slot empty";
    cell.setAttribute("aria-hidden", "true");
    const slotNumber = document.createElement("span");
    slotNumber.className = "backpack-slot-number";
    slotNumber.textContent = String(displayIndex + 1);
    cell.append(slotNumber);
    return cell;
  }

  function togglePanel() {
    if (elements.backpackPanel?.hidden) openPanel();
    else closePanel();
  }

  function openPanel() {
    if (elements.backpackPanel) elements.backpackPanel.hidden = false;
    render({ force: true });
  }

  function closePanel() {
    if (elements.backpackPanel) elements.backpackPanel.hidden = true;
  }

  function backpackCategory(slot) {
    const label = String(slot?.kind === "resource" && Number(slot.decorationId) <= 0
      ? safeResourceName(slot.resourceId)
      : "").toLowerCase();
    return backpackCategoryForSlot(slot, label);
  }

  function safeResourceName(resourceId) {
    if (typeof resourceName === "function") {
      try {
        const label = resourceName(resourceId);
        if (label) return String(label);
      } catch {
        // A formatter failure must not prevent the inventory from opening.
      }
    }
    return `Resource ${Math.trunc(Number(resourceId) || 0)}`;
  }

  function safeItemName(slot) {
    if (typeof voxelItemLabel === "function") {
      try {
        const label = voxelItemLabel(slot);
        if (label) return String(label);
      } catch {
        // Fall back to the broad resource class when item identity formatting fails.
      }
    }
    return slot?.label ? String(slot.label) : safeResourceName(slot?.resourceId);
  }
}

export function backpackCategoryForSlot(slot, resourceLabel = "") {
  const kind = String(slot?.kind || "").toLowerCase();
  const itemId = String(slot?.itemId || "").toLowerCase();
  if (kind === "smelted_material" || kind === "material") return "materials";
  if (kind === "tool" || kind === "forged" || kind === "blueprint" || itemId.includes("pickaxe") || itemId.includes("tool")) return "tools";
  if (kind === "combat" || itemId.includes("sword") || itemId.includes("bow") || itemId.includes("shield")) return "combat";
  if (kind === "food" || itemId.includes("food")) return "food";
  if (kind === "resource") {
    if (Number(slot?.decorationId) > 0) return "resources";
    const label = String(resourceLabel || "").toLowerCase();
    return NATURAL_RESOURCE_WORDS.some((word) => label.includes(word)) ? "resources" : "blocks";
  }
  return "misc";
}

function formatMessage(template, params = {}) {
  return String(template || "").replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
  ));
}

function formatBackpackMass(value) {
  let grams = 0;
  try {
    grams = Number(BigInt(value ?? 0));
  } catch {
    grams = 0;
  }
  if (!Number.isFinite(grams) || grams <= 0) return "0 kg";
  if (grams < 1_000) return `${Math.round(grams)} g`;
  if (grams < 1_000_000) return `${formatMassNumber(grams / 1_000, grams < 10_000 ? 2 : 1)} kg`;
  return `${formatMassNumber(grams / 1_000_000, 2)} t`;
}

function formatMassNumber(value, maximumFractionDigits) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value);
}
