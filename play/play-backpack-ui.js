import { BACKPACK_CAPACITY } from "./game-state.js";
import { buildBackpackDisplayStacks } from "./backpack-display-stacks.js";
import { backpackSlotMeta, formatMassGrams } from "./play-ui-format.js";
import {
  createLandContractIconElement,
  isLandContractItem,
} from "./play-land-contract-item.js";

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
  onRefreshLandContracts = () => Promise.resolve(null),
  onOpenContractsMarket = () => {},
  translate = (_key, fallback, params = {}) => formatMessage(fallback, params),
} = {}) {
  let activeCategory = DEFAULT_CATEGORY;
  let categoriesBound = false;
  let contractsBound = false;
  let contractsExpanded = false;
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
  bindContracts();

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

  function bindContracts() {
    if (contractsBound || !elements.backpackContracts) return;
    contractsBound = true;
    elements.backpackContracts.addEventListener("click", (event) => {
      const action = event.target.closest?.("[data-contract-action]")?.dataset?.contractAction;
      if (action === "toggle") {
        contractsExpanded = !contractsExpanded;
        render({ force: true });
      } else if (action === "refresh") {
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
    updateCategoryButtons(displayStacks.map((stack) => stack.slot));

    const entries = displayStacks;
    const visible = activeCategory === DEFAULT_CATEGORY
      ? entries
      : entries.filter(({ slot }) => backpackCategory(slot) === activeCategory);
    const cells = visible.map((stack, displayIndex) => backpackCell(stack, displayIndex));
    const emptyDisplaySlots = Math.max(0, capacity - visible.length);
    for (let offset = 0; offset < emptyDisplaySlots; offset += 1) {
      cells.push(emptyBackpackCell(cells.length));
    }
    elements.backpackGrid.replaceChildren(...cells);
    renderContractPortfolio();
  }

  function renderContractPortfolio() {
    const root = elements.backpackContracts;
    if (!root) return;
    const portfolio = gameState.getLandContractPortfolio?.() ?? null;
    const total = Math.max(0, Math.trunc(Number(portfolio?.totalContractUnits) || 0));
    const summary = document.createElement("button");
    summary.type = "button";
    summary.className = "backpack-contract-summary";
    summary.dataset.contractAction = "toggle";
    summary.setAttribute("aria-expanded", contractsExpanded ? "true" : "false");
    summary.setAttribute("aria-controls", "backpackContractList");
    summary.setAttribute("aria-label", ui(
      "main.backpack.contractPortfolioAria",
      "Land contracts, {count} contract units. {action}",
      {
        count: total,
        action: contractsExpanded
          ? ui("main.backpack.collapseContracts", "Collapse contract list")
          : ui("main.backpack.expandContracts", "Expand contract list"),
      },
    ));
    const summaryIcon = createLandContractIconElement({ size: 36, className: "backpack-contract-summary-icon" });
    const summaryCopy = document.createElement("span");
    const summaryTitle = document.createElement("strong");
    summaryTitle.textContent = ui("main.backpack.contractPortfolio", "Land Contracts");
    const summaryMeta = document.createElement("small");
    summaryMeta.textContent = ui(
      "main.backpack.contractPortfolioMeta",
      "{records} records · no backpack slots",
      { records: Math.max(0, Math.trunc(Number(portfolio?.recordCount) || 0)) },
    );
    summaryCopy.append(summaryTitle, summaryMeta);
    const summaryCount = document.createElement("b");
    summaryCount.textContent = String(total);
    const chevron = document.createElement("i");
    chevron.className = "backpack-contract-chevron";
    chevron.setAttribute("aria-hidden", "true");
    summary.append(summaryIcon, summaryCopy, summaryCount, chevron);

    if (!contractsExpanded) {
      root.dataset.contractState = portfolio?.loading ? "loading" : "collapsed";
      root.replaceChildren(summary);
      return;
    }

    const list = document.createElement("div");
    list.className = "backpack-contract-list";
    list.id = "backpackContractList";
    if (portfolio?.loading || contractRefreshPromise) {
      list.setAttribute("aria-busy", "true");
      list.append(contractLoadingRow(), contractLoadingRow());
      root.dataset.contractState = "loading";
    } else {
      if (portfolio?.error) list.append(contractErrorRow(portfolio.error));
      for (const contract of portfolio?.items ?? []) list.append(contractAssetRow(contract));
      if (!portfolio?.items?.length) list.append(contractEmptyRow());
      root.dataset.contractState = portfolio?.error ? "error" : portfolio?.items?.length ? "ready" : "empty";
    }
    root.replaceChildren(summary, list);
  }

  function contractAssetRow(contract) {
    const registered = contract.kind === "registered_land_contract";
    const equipment = !registered ? gameState.getLandContractEquipment?.() ?? null : null;
    const row = document.createElement("button");
    row.type = "button";
    row.className = `backpack-contract-row${registered ? " registered" : " blank"}`;
    if (equipment) row.classList.add("equipped");
    row.dataset.inventoryVirtualItem = String(contract.id);
    row.dataset.backpackItemId = String(contract.id);
    row.dataset.equipped = equipment ? "true" : "false";
    const titleText = registered
      ? ui("main.backpack.registeredContractTitle", "Land Contract #{id}", { id: contract.foundationId })
      : ui("main.market.blankLandContract", "Blank Land Contract");
    const units = registered ? contract.landContractCount : contract.count;
    row.setAttribute("aria-label", registered
      ? ui("main.backpack.registeredContractAria", "{title}, {count} chunks, from Chunk {minX}, {minZ} to {maxX}, {maxZ}", {
        title: titleText,
        count: units,
        minX: contract.minChunkX,
        minZ: contract.minChunkZ,
        maxX: contract.maxChunkX,
        maxZ: contract.maxChunkZ,
      })
      : ui("main.backpack.contractAria", "{item}, contract balance {count}", { item: titleText, count: units }));
    row.append(createLandContractIconElement({
      size: 38,
      className: registered ? "registered-contract-icon" : "blank-contract-icon",
    }));
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = titleText;
    const meta = document.createElement("small");
    meta.textContent = registered
      ? ui("main.backpack.registeredContractRange", "Chunks ({minX}, {minZ}) → ({maxX}, {maxZ})", {
        minX: contract.minChunkX,
        minZ: contract.minChunkZ,
        maxX: contract.maxChunkX,
        maxZ: contract.maxChunkZ,
      })
      : ui("main.backpack.blankContractBalance", "{available} available · {reserved} registering", {
        available: contract.availableCount,
        reserved: contract.reservedCount,
      });
    copy.append(title, meta);
    const count = document.createElement("b");
    count.textContent = registered
      ? ui("main.backpack.contractChunkCount", "{count} chunks", { count: units })
      : `×${units}`;
    row.append(copy, count);
    return row;
  }

  function contractLoadingRow() {
    const row = document.createElement("span");
    row.className = "backpack-contract-skeleton";
    row.setAttribute("aria-hidden", "true");
    return row;
  }

  function contractErrorRow(reason) {
    const row = document.createElement("div");
    row.className = "backpack-contract-state error";
    const copy = document.createElement("span");
    copy.textContent = ui("main.backpack.contractLoadFailed", "Contracts could not be refreshed: {reason}", { reason });
    const retry = document.createElement("button");
    retry.type = "button";
    retry.dataset.contractAction = "refresh";
    retry.textContent = ui("main.backpack.retryContracts", "Retry");
    row.append(copy, retry);
    return row;
  }

  function contractEmptyRow() {
    const row = document.createElement("div");
    row.className = "backpack-contract-state empty";
    const copy = document.createElement("span");
    copy.textContent = ui("main.backpack.noContracts", "No land contracts yet. Buy a blank contract to register your first Chunk.");
    const market = document.createElement("button");
    market.type = "button";
    market.dataset.contractAction = "market";
    market.textContent = ui("main.backpack.openContractMarket", "Open contract market");
    row.append(copy, market);
    return row;
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
    if (isLandContractItem(slot)) return "misc";
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
  if (isLandContractItem(slot)) return "misc";
  if (kind === "smelted_material" || kind === "material") return "materials";
  if (kind === "tool" || kind === "forged" || itemId.includes("pickaxe") || itemId.includes("tool")) return "tools";
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
