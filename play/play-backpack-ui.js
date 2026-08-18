import { BACKPACK_CAPACITY } from "./game-state.js";
import { buildBackpackDisplayStacks } from "./backpack-display-stacks.js";
import { backpackSlotMeta, formatMassGrams } from "./play-ui-format.js";
import {
  createLandContractIconElement,
  isLandContractItem,
} from "./play-land-contract-item.js";

const DEFAULT_CATEGORY = "backpack";

export function createPlayBackpackUi({
  elements,
  gameState,
  createVoxelItemIconCanvas,
  resourceName = null,
  voxelItemLabel,
  onRefreshLandContracts = () => Promise.resolve(null),
  onOpenContractsMarket = () => {},
  translate = (_key, fallback, params = {}) => formatMessage(fallback, params),
} = {}) {
  let activeCategory = DEFAULT_CATEGORY;
  let categoriesBound = false;
  let gridActionsBound = false;
  let contractRefreshPromise = null;
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
  bindGridActions();

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

  function bindGridActions() {
    if (gridActionsBound || !elements.backpackGrid) return;
    gridActionsBound = true;
    elements.backpackGrid.addEventListener("click", (event) => {
      const action = event.target.closest?.("[data-contract-action]")?.dataset?.contractAction;
      if (action === "refresh") {
        void refreshContracts();
      } else if (action === "market") {
        onOpenContractsMarket();
      }
    });
  }

  function render({ force = false } = {}) {
    if (!elements.backpackGrid) return;
    if (!force && elements.backpackPanel?.hidden) return;
    const slots = gameState.backpackSlots;
    const capacity = Math.max(1, Math.trunc(Number(gameState.backpackCapacity) || BACKPACK_CAPACITY));
    const totalItems = gameState.totalBackpackItems();
    const displayStacks = buildBackpackDisplayStacks(slots, {
      isStackable: (slot) => !gameState.isBackpackSlotEquipped?.(slot),
    });
    const portfolio = gameState.getLandContractPortfolio?.() ?? null;
    const blankContract = portfolio?.blankContract
      ?? portfolio?.items?.find?.((item) => item?.kind === "contract")
      ?? null;
    const registeredLand = Array.isArray(portfolio?.registeredContracts)
      ? portfolio.registeredContracts
      : (portfolio?.items ?? []).filter((item) => item?.kind === "registered_land_contract");
    const inventoryEntryCount = displayStacks.length;
    if (elements.backpackMeta) {
      const stackMeta = document.createElement("span");
      stackMeta.className = "backpack-meta-stacks";
      stackMeta.textContent = ui(
        inventoryEntryCount === 1 ? "main.backpack.displayStack" : "main.backpack.displayStacks",
        inventoryEntryCount === 1 ? "{count} stack" : "{count} stacks",
        {
          count: inventoryEntryCount,
        },
      );
      const itemMeta = document.createElement("span");
      itemMeta.className = "backpack-meta-items";
      itemMeta.textContent = ui("main.backpack.slotUsage", "{used} / {capacity} slots · {items} items", {
        used: displayStacks.length,
        capacity,
        items: totalItems,
      });
      const weightMeta = document.createElement("span");
      weightMeta.className = "backpack-meta-weight";
      weightMeta.textContent = ui("main.backpack.totalWeight", "Weight: {weight}", {
        weight: formatMassGrams(gameState.totalBackpackMassGrams?.() ?? gameState.backpackTotalMassGrams ?? 0),
      });
      elements.backpackMeta.replaceChildren(stackMeta, itemMeta, weightMeta);
    }
    updateCategoryButtons(displayStacks, blankContract, registeredLand);

    const physicalEntries = activeCategory === DEFAULT_CATEGORY
      ? displayStacks
      : displayStacks.filter(({ slot }) => backpackCategory(slot) === activeCategory);
    const cells = physicalEntries.map((stack, displayIndex) => backpackCell(stack, displayIndex));
    if ((activeCategory === DEFAULT_CATEGORY || activeCategory === "contracts") && blankContract) {
      cells.push(virtualBackpackCell(blankContract));
    }
    if (activeCategory === "land") {
      cells.push(...registeredLand.map((contract) => virtualBackpackCell(contract)));
    }

    const physicalCategory = [DEFAULT_CATEGORY, "resources", "items"].includes(activeCategory);
    if (physicalCategory) {
      const emptyDisplaySlots = Math.max(0, capacity - physicalEntries.length);
      for (let offset = 0; offset < emptyDisplaySlots; offset += 1) {
        cells.push(emptyBackpackCell(physicalEntries.length + offset));
      }
    } else if (portfolio?.loading || contractRefreshPromise) {
      cells.push(contractLoadingCell(), contractLoadingCell());
    } else {
      if (portfolio?.error) cells.push(contractStateCell({ error: portfolio.error }));
      if (!cells.length) cells.push(contractStateCell({ emptyCategory: activeCategory }));
    }

    elements.backpackGrid.dataset.backpackCategory = activeCategory;
    elements.backpackGrid.setAttribute(
      "aria-busy",
      !physicalCategory && (portfolio?.loading || contractRefreshPromise) ? "true" : "false",
    );
    elements.backpackGrid.replaceChildren(...cells);
  }

  function virtualBackpackCell(contract) {
    const registered = contract.kind === "registered_land_contract";
    const equipment = !registered ? gameState.getLandContractEquipment?.() ?? null : null;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `backpack-slot backpack-virtual-slot ${registered ? "registered-land-slot" : "blank-contract-slot"}`;
    if (equipment) cell.classList.add("equipped");
    cell.dataset.inventoryVirtualItem = String(contract.id);
    cell.dataset.backpackItemId = String(contract.id);
    cell.dataset.backpackItemCategory = registered ? "land" : "contracts";
    cell.dataset.equipped = equipment ? "true" : "false";
    const titleText = registered
      ? ui("main.backpack.registeredContractTitle", "Land Contract #{id}", { id: contract.foundationId })
      : ui("main.market.blankLandContract", "Blank Land Contract");
    cell.setAttribute("aria-label", registered
      ? ui("main.backpack.registeredContractAria", "{title}, {count} chunks, from Chunk {minX}, {minZ} to {maxX}, {maxZ}", {
        title: titleText,
        count: contract.landContractCount,
        minX: contract.minChunkX,
        minZ: contract.minChunkZ,
        maxX: contract.maxChunkX,
        maxZ: contract.maxChunkZ,
      })
      : ui("main.backpack.contractAria", "{item}, contract balance {count}", { item: titleText, count: contract.count }));
    cell.title = registered
      ? `${titleText} · (${contract.minChunkX}, ${contract.minChunkZ}) → (${contract.maxChunkX}, ${contract.maxChunkZ})`
      : `${titleText} · ×${contract.count}`;
    const icon = createLandContractIconElement({
      size: 48,
      className: registered ? "registered-contract-icon" : "blank-contract-icon",
      variant: registered ? "registered" : "blank",
    });
    icon.classList.add("backpack-virtual-icon");
    const title = document.createElement("strong");
    title.className = "backpack-slot-name";
    title.textContent = titleText;
    cell.append(icon, title);
    if (!registered) {
      const count = document.createElement("span");
      count.className = "backpack-slot-count";
      count.textContent = String(contract.count || 0);
      cell.append(count);
    }
    if (equipment) {
      const badge = document.createElement("span");
      badge.className = "backpack-slot-equipped";
      badge.textContent = ui("main.backpack.equipped", "Equipped");
      cell.append(badge);
    }
    return cell;
  }

  function contractLoadingCell() {
    const cell = document.createElement("span");
    cell.className = "backpack-slot backpack-virtual-slot backpack-contract-loading";
    cell.setAttribute("aria-label", ui("main.backpack.contractLoading", "Loading contracts and land"));
    return cell;
  }

  function contractStateCell({ error = "", emptyCategory = "" } = {}) {
    const state = document.createElement("div");
    state.className = `backpack-grid-state${error ? " error" : " empty"}`;
    const copy = document.createElement("span");
    if (error) {
      copy.textContent = ui("main.backpack.contractLoadFailed", "Contracts could not be refreshed: {reason}", { reason: error });
      const retry = document.createElement("button");
      retry.type = "button";
      retry.dataset.contractAction = "refresh";
      retry.textContent = ui("main.backpack.retryContracts", "Retry");
      state.append(copy, retry);
      return state;
    }
    copy.textContent = emptyCategory === "land"
      ? ui("main.backpack.noRegisteredLand", "No registered land yet. Equip a blank contract to register Chunk territory.")
      : ui("main.backpack.noBlankContracts", "No blank contracts. Buy one in the Contract market.");
    const market = document.createElement("button");
    market.type = "button";
    market.dataset.contractAction = "market";
    market.textContent = ui("main.backpack.openContractMarket", "Open contract market");
    state.append(copy, market);
    return state;
  }

  async function refreshContracts() {
    if (contractRefreshPromise) return contractRefreshPromise;
    contractRefreshPromise = Promise.resolve(onRefreshLandContracts())
      .catch(() => null)
      .finally(() => {
        contractRefreshPromise = null;
        render({ force: true });
      });
    render({ force: true });
    return contractRefreshPromise;
  }

  function updateCategoryButtons(displayStacks, blankContract, registeredLand) {
    const counts = new Map([
      [DEFAULT_CATEGORY, displayStacks.length + (blankContract ? 1 : 0)],
      ["resources", 0],
      ["items", 0],
      ["contracts", blankContract ? 1 : 0],
      ["land", registeredLand.length],
    ]);
    for (const { slot } of displayStacks) {
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

  function backpackCell(stack, displayIndex) {
    const { slot, indexes, primaryIndex: index } = stack;
    const cell = document.createElement("div");
    cell.className = "backpack-slot";
    const equipment = gameState.getBackpackSlotEquipment?.(stack.members[0]) ?? null;
    const equipped = Boolean(equipment);
    if (equipped) cell.classList.add("equipped");
    cell.dataset.backpackSlot = String(index);
    cell.dataset.backpackIndexes = indexes.join(",");
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
      ui("main.backpack.stackAria", "{item}, display slot {slot}, count {count}", {
        item: titleText,
        slot: displayIndex + 1,
        count: slot.count || 0,
      }),
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
    const portfolio = gameState.getLandContractPortfolio?.();
    if (!portfolio?.known && !portfolio?.loading) void refreshContracts();
  }

  function closePanel() {
    if (elements.backpackPanel) elements.backpackPanel.hidden = true;
  }

  function backpackCategory(slot) {
    return backpackCategoryForSlot(slot);
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

export function backpackCategoryForSlot(slot) {
  const kind = String(slot?.kind || "").toLowerCase();
  if (kind === "registered_land_contract") return "land";
  if (isLandContractItem(slot)) return "contracts";
  if (["resource", "smelted_material", "material"].includes(kind)) return "resources";
  return "items";
}

function formatMessage(template, params = {}) {
  return String(template || "").replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
  ));
}
