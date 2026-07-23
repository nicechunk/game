const DRAG_START_PX = 8;
const LONG_PRESS_MS = 560;

export function createInventoryController({
  elements,
  gameState,
  renderGameUi = () => {},
  renderHotbar = () => {},
  renderBackpack = () => {},
  createVoxelItemIconCanvas = null,
  onDiscardBackpackSlots = null,
  onStatus = () => {},
  voxelItemLabel = (slot) => slot?.label || slot?.materialId || "Item",
  resourceName = (id) => `R${id}`,
  getRpcUrl = () => "",
  translate = (_key, fallback, params = {}) => formatMessage(fallback, params),
} = {}) {
  let drag = null;
  let selectionSweep = null;
  let ghost = null;
  let suppressClick = false;
  let suppressClickTimer = 0;
  let contextMenu = null;
  let longPressTimer = 0;
  let focusedBackpackIndex = null;
  const selectedBackpackIndexes = new Set();
  const discardingBackpackIndexes = new Set();
  const ui = (key, fallback, params = {}) => {
    try {
      const translated = translate(key, fallback, params);
      if (translated && translated !== key) return String(translated);
    } catch {
      // Inventory interactions remain available if a locale formatter fails.
    }
    return formatMessage(fallback, params);
  };

  return {
    bind,
    closeContextMenu,
    refresh,
    clearSelection,
  };

  function bind() {
    elements.hotbar?.addEventListener("pointerdown", handleHotbarPointerDown);
    elements.hotbar?.addEventListener("pointermove", handlePointerMove);
    elements.hotbar?.addEventListener("pointerup", handlePointerUp);
    elements.hotbar?.addEventListener("pointercancel", handlePointerCancel);
    elements.hotbar?.addEventListener("contextmenu", handleHotbarContextMenu);
    elements.hotbar?.addEventListener("click", suppressNextClick, true);

    elements.backpackGrid?.addEventListener("pointerdown", handleBackpackPointerDown);
    elements.backpackGrid?.addEventListener("pointermove", handlePointerMove);
    elements.backpackGrid?.addEventListener("pointerup", handlePointerUp);
    elements.backpackGrid?.addEventListener("pointercancel", handlePointerCancel);
    elements.backpackGrid?.addEventListener("contextmenu", handleBackpackContextMenu);
    elements.backpackGrid?.addEventListener("click", suppressNextClick, true);
    elements.backpackGrid?.addEventListener("click", handleBackpackClick);
    elements.backpackGrid?.addEventListener("keydown", handleBackpackKeyDown);
    elements.backpackGrid?.addEventListener("backpackfilterchange", handleBackpackFilterChange);

    elements.selectAllBackpack?.addEventListener("click", selectAllBackpack);
    elements.discardSelectedBackpack?.addEventListener("click", discardSelectedBackpack);
    elements.cancelBackpackSelection?.addEventListener("click", clearSelection);

    document.addEventListener("pointerdown", (event) => {
      if (contextMenu && !contextMenu.hidden && !contextMenu.contains(event.target)) closeContextMenu();
    });
    refresh();
  }

  function handleHotbarPointerDown(event) {
    if (event.button !== 0) return;
    const index = hotbarSlotIndexFromEvent(event);
    if (index === null || !gameState.hotbarSlots[index]) return;
    drag = {
      type: "hotbar",
      pointerId: event.pointerId,
      from: index,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      overHotbar: index,
      overBackpack: null,
    };
    event.target.closest(".hotbar-slot")?.setPointerCapture?.(event.pointerId);
    clearTimeout(longPressTimer);
    if (gameState.canUnequipHotbarSlot?.(index)) {
      longPressTimer = setTimeout(() => {
        if (!drag || drag.pointerId !== event.pointerId || drag.active) return;
        drag.longPressed = true;
      }, LONG_PRESS_MS);
    }
  }

  function handleHotbarContextMenu(event) {
    const index = hotbarSlotIndexFromEvent(event);
    if (index === null || !gameState.canUnequipHotbarSlot?.(index)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.pointerType && event.pointerType !== "mouse") return;
    const result = gameState.unequipHotbarSlot?.(index);
    if (!result?.ok) return;
    renderGameUi();
    refresh();
  }

  function handleBackpackPointerDown(event) {
    if (event.button !== 0 || event.target.closest(".backpack-equip")) return;
    const index = backpackSlotIndexFromEvent(event);
    if (index === null || !gameState.backpackSlots[index]) return;
    closeContextMenu();
    if (isEquippedBackpackIndex(index)) return;
    const captureTarget = event.target.closest(".backpack-slot");
    if (selectedBackpackIndexes.size > 0 || event.metaKey || event.ctrlKey || event.shiftKey) {
      selectionSweep = {
        pointerId: event.pointerId,
        from: index,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        active: false,
        candidates: null,
        captureTarget,
      };
      captureTarget?.setPointerCapture?.(event.pointerId);
      return;
    }
    drag = {
      type: "backpack",
      pointerId: event.pointerId,
      from: index,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      overHotbar: null,
      overBackpack: index,
    };
    captureTarget?.setPointerCapture?.(event.pointerId);
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      if (!drag || drag.pointerId !== event.pointerId || drag.active) return;
      openContextMenu(index, event.clientX, event.clientY);
      clearDragState({ suppress: true });
    }, LONG_PRESS_MS);
  }

  function handlePointerMove(event) {
    if (selectionSweep && event.pointerId === selectionSweep.pointerId) {
      handleSelectionSweepMove(event);
      return;
    }
    if (!drag || event.pointerId !== drag.pointerId) return;
    const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (moved > DRAG_START_PX) clearTimeout(longPressTimer);
    if (!drag.active && moved > DRAG_START_PX) {
      drag.active = true;
      beginDragGhost(sourceElementForDrag(), event.clientX, event.clientY);
    }
    if (!drag.active) return;
    event.preventDefault();
    event.stopPropagation();
    moveDragGhost(event.clientX, event.clientY);
    drag.overHotbar = hotbarSlotIndexFromPoint(event.clientX, event.clientY);
    drag.overBackpack = backpackSlotIndexFromPoint(event.clientX, event.clientY);
    updateDragClasses();
  }

  function handlePointerUp(event) {
    if (selectionSweep && event.pointerId === selectionSweep.pointerId) {
      finishSelectionSweep(event);
      return;
    }
    if (!drag || event.pointerId !== drag.pointerId) return;
    clearTimeout(longPressTimer);
    if (drag.longPressed) {
      const index = drag.from;
      clearDragState({ suppress: true });
      const result = gameState.unequipHotbarSlot?.(index);
      if (result?.ok) {
        renderGameUi();
        refresh();
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const wasActive = drag.active;
    const operation = wasActive ? resolveDrop(event.clientX, event.clientY) : null;
    clearDragState({ suppress: wasActive });
    if (!operation) return;
    event.preventDefault();
    event.stopPropagation();
    applyDropOperation(operation);
  }

  function handlePointerCancel(event) {
    if (selectionSweep && event.pointerId === selectionSweep.pointerId) {
      clearSelectionSweep({ renderDetail: selectionSweep.active });
      return;
    }
    if (!drag || event.pointerId !== drag.pointerId) return;
    clearTimeout(longPressTimer);
    clearDragState({ suppress: false });
  }

  function handleSelectionSweepMove(event) {
    clearTimeout(longPressTimer);
    let changed = false;
    const moved = Math.hypot(event.clientX - selectionSweep.startX, event.clientY - selectionSweep.startY);
    if (!selectionSweep.active && moved > DRAG_START_PX) {
      selectionSweep.active = true;
      selectionSweep.candidates = selectableSweepCandidates();
      elements.backpackGrid?.classList.add("selection-sweeping");
      changed = addSelectionSweepIndex(selectionSweep.from);
    }
    if (!selectionSweep.active) return;
    event.preventDefault();
    event.stopPropagation();
    const points = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
    const samples = points.length ? points : [event];
    for (const sample of samples) {
      changed = selectAlongSweepSegment(
        selectionSweep.lastX,
        selectionSweep.lastY,
        sample.clientX,
        sample.clientY,
      ) || changed;
      selectionSweep.lastX = sample.clientX;
      selectionSweep.lastY = sample.clientY;
    }
    if (changed) {
      updateSelectionClasses();
      updateSelectionControls();
    }
  }

  function finishSelectionSweep(event) {
    const wasActive = selectionSweep.active;
    if (wasActive) {
      selectAlongSweepSegment(selectionSweep.lastX, selectionSweep.lastY, event.clientX, event.clientY);
      event.preventDefault();
      event.stopPropagation();
    }
    clearSelectionSweep({ suppress: wasActive, renderDetail: wasActive });
  }

  function clearSelectionSweep({ suppress = false, renderDetail = false } = {}) {
    const sweep = selectionSweep;
    selectionSweep = null;
    elements.backpackGrid?.classList.remove("selection-sweeping");
    if (sweep?.captureTarget?.hasPointerCapture?.(sweep.pointerId)) {
      sweep.captureTarget.releasePointerCapture?.(sweep.pointerId);
    }
    if (suppress) armClickSuppression();
    if (renderDetail) refresh();
  }

  function selectableSweepCandidates() {
    return Array.from(elements.backpackGrid?.querySelectorAll(".backpack-slot[data-backpack-slot]") || [])
      .map((element) => ({
        element,
        index: Number(element.dataset.backpackSlot),
        rect: element.getBoundingClientRect(),
      }))
      .filter(({ index }) => canSweepSelectIndex(index));
  }

  function selectAlongSweepSegment(fromX, fromY, toX, toY) {
    let changed = false;
    let focusedIndex = null;
    for (const candidate of selectionSweep.candidates || []) {
      if (!segmentIntersectsRect(fromX, fromY, toX, toY, candidate.rect)) continue;
      changed = addSelectionSweepIndex(candidate.index) || changed;
      focusedIndex = candidate.index;
    }
    const pointIndex = backpackSlotIndexFromPoint(toX, toY);
    if (canSweepSelectIndex(pointIndex)) {
      changed = addSelectionSweepIndex(pointIndex) || changed;
      focusedIndex = pointIndex;
    }
    if (focusedIndex !== null && focusedBackpackIndex !== focusedIndex) {
      focusedBackpackIndex = focusedIndex;
      changed = true;
    }
    return changed;
  }

  function addSelectionSweepIndex(index) {
    if (!canSweepSelectIndex(index) || selectedBackpackIndexes.has(index)) return false;
    selectedBackpackIndexes.add(index);
    return true;
  }

  function canSweepSelectIndex(index) {
    if (!Number.isInteger(index)) return false;
    const slot = gameState.backpackSlots[index];
    return Boolean(slot && !slot.pending && !isEquippedBackpackSlot(slot) && !discardingBackpackIndexes.has(index));
  }

  function resolveDrop(x, y) {
    const overHotbar = hotbarSlotIndexFromPoint(x, y) ?? drag.overHotbar;
    const overBackpack = backpackSlotIndexFromPoint(x, y) ?? drag.overBackpack;
    if (drag.type === "backpack" && overHotbar !== null) return { kind: "backpack-to-hotbar", from: drag.from, to: overHotbar };
    if (drag.type === "backpack" && overBackpack !== null && overBackpack !== drag.from) return { kind: "backpack-reorder", from: drag.from, to: overBackpack };
    if (drag.type === "hotbar" && overHotbar !== null && overHotbar !== drag.from) return { kind: "hotbar-swap", from: drag.from, to: overHotbar };
    if (drag.type === "hotbar" && overBackpack !== null) return { kind: "hotbar-clear", from: drag.from };
    return null;
  }

  function applyDropOperation(operation) {
    let result = null;
    if (operation.kind === "backpack-to-hotbar") {
      result = gameState.moveBackpackSlotToHotbar(operation.from, operation.to);
      onStatus(result.ok ? `Equipped ${backpackSlotLabel(gameState.backpackSlots[operation.from])} to hotbar slot ${result.index + 1}.` : result.reason);
    } else if (operation.kind === "backpack-reorder") {
      result = gameState.moveBackpackSlot(operation.from, operation.to);
      onStatus(result.ok ? "Backpack slot reordered." : result.reason);
      if (result.ok) {
        clearSelection({ silent: true });
        focusedBackpackIndex = result.to;
      }
    } else if (operation.kind === "hotbar-swap") {
      result = gameState.swapHotbarSlots(operation.from, operation.to);
      onStatus(result.ok ? `Swapped hotbar slots ${operation.from + 1} and ${operation.to + 1}.` : result.reason);
    } else if (operation.kind === "hotbar-clear") {
      const backpackEquipment = gameState.canUnequipHotbarSlot?.(operation.from);
      result = backpackEquipment
        ? gameState.unequipHotbarSlot(operation.from)
        : { ok: false, reason: "Only backpack-backed equipment can be cleared by dropping onto the backpack." };
      if (!result.ok) onStatus(result.reason);
    }
    renderGameUi();
    refresh();
  }

  function handleBackpackClick(event) {
    if (event.target.closest(".backpack-equip")) return;
    const index = backpackSlotIndexFromEvent(event);
    if (index === null || !gameState.backpackSlots[index]) {
      focusedBackpackIndex = null;
      if (!selectedBackpackIndexes.size) refresh();
      return;
    }
    const shouldToggle = selectedBackpackIndexes.size > 0 || event.metaKey || event.ctrlKey || event.shiftKey;
    if (shouldToggle && isEquippedBackpackIndex(index)) {
      focusedBackpackIndex = index;
      refresh();
      onStatus(equippedLockedMessage(gameState.backpackSlots[index]));
    } else if (shouldToggle) toggleBackpackSelection(index);
    else {
      focusedBackpackIndex = index;
      refresh();
    }
  }

  function handleBackpackKeyDown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const index = backpackSlotIndexFromEvent(event);
    if (index === null || !gameState.backpackSlots[index]) return;
    event.preventDefault();
    focusedBackpackIndex = index;
    refresh();
  }

  function handleBackpackFilterChange() {
    selectedBackpackIndexes.clear();
    focusedBackpackIndex = null;
    closeContextMenu();
    refresh();
  }

  function handleBackpackContextMenu(event) {
    const index = backpackSlotIndexFromEvent(event);
    if (index === null || !gameState.backpackSlots[index]) return;
    event.preventDefault();
    event.stopPropagation();
    openContextMenu(index, event.clientX, event.clientY);
  }

  function openContextMenu(index, x, y) {
    const slot = gameState.backpackSlots[index];
    if (!slot) return;
    const menu = ensureContextMenu();
    menu.dataset.backpackSlot = String(index);
    menu.querySelector("strong").textContent = backpackSlotLabel(slot);
    const equip = menu.querySelector("[data-action='equip']");
    const discard = menu.querySelector("[data-action='discard']");
    const select = menu.querySelector("[data-action='select']");
    const discardSelected = menu.querySelector("[data-action='discard-selected']");
    const cancelSelection = menu.querySelector("[data-action='cancel-selection']");
    const equipment = gameState.getBackpackSlotEquipment?.(slot) ?? null;
    const equipped = Boolean(equipment);
    equip.disabled = equipped || !isPlaceableBackpackSlot(slot);
    equip.textContent = equipped ? ui("main.backpack.equipped", "Equipped") : "Equip to hotbar";
    discard.disabled = Boolean(equipped || slot.pending || slot.kind === "blueprint" || discardingBackpackIndexes.has(index));
    select.disabled = equipped;
    select.textContent = selectedBackpackIndexes.has(index) ? "Unselect item" : "Select item";
    menu.dataset.equipped = equipped ? "true" : "false";
    menu.title = equipped ? equippedLockedMessage(slot) : "";
    discardSelected.hidden = selectedBackpackIndexes.size === 0;
    discardSelected.textContent = `Discard selected (${selectedBackpackIndexes.size})`;
    cancelSelection.hidden = selectedBackpackIndexes.size === 0;
    menu.hidden = false;
    const width = menu.offsetWidth || 190;
    const height = menu.offsetHeight || 120;
    menu.style.left = `${Math.min(Math.max(8, x), window.innerWidth - width - 8)}px`;
    menu.style.top = `${Math.min(Math.max(8, y), window.innerHeight - height - 8)}px`;
  }

  function ensureContextMenu() {
    if (contextMenu) return contextMenu;
    const menu = document.createElement("div");
    menu.className = "inventory-context-menu";
    menu.hidden = true;
    menu.innerHTML = `
      <strong></strong>
      <button type="button" data-action="equip">Equip to hotbar</button>
      <button type="button" data-action="select">Select item</button>
      <button type="button" data-action="discard">Discard item</button>
      <button type="button" data-action="discard-selected">Discard selected</button>
      <button type="button" data-action="cancel-selection">Cancel selection</button>
      <button type="button" data-action="close">Close</button>
    `;
    menu.addEventListener("pointerdown", (event) => event.stopPropagation());
    menu.querySelector("[data-action='equip']")?.addEventListener("click", () => {
      const index = Number(menu.dataset.backpackSlot);
      if (isEquippedBackpackIndex(index)) {
        onStatus(equippedLockedMessage(gameState.backpackSlots[index]));
        closeContextMenu();
        return;
      }
      const result = gameState.moveBackpackSlotToHotbar(index, gameState.selectedHotbarSlot);
      closeContextMenu();
      renderGameUi();
      refresh();
      onStatus(result.ok ? `Equipped ${backpackSlotLabel(result.slot)} to hotbar slot ${result.index + 1}.` : result.reason);
    });
    menu.querySelector("[data-action='select']")?.addEventListener("click", () => {
      const index = Number(menu.dataset.backpackSlot);
      if (isEquippedBackpackIndex(index)) {
        onStatus(equippedLockedMessage(gameState.backpackSlots[index]));
        closeContextMenu();
        return;
      }
      toggleBackpackSelection(index);
      closeContextMenu();
    });
    menu.querySelector("[data-action='discard']")?.addEventListener("click", () => {
      const index = Number(menu.dataset.backpackSlot);
      const slot = gameState.backpackSlots[index];
      if (!slot || slot.pending || isEquippedBackpackSlot(slot)) {
        if (isEquippedBackpackSlot(slot)) onStatus(equippedLockedMessage(slot));
        else onStatus("Pending resources cannot be discarded before confirmation or rollback.");
        closeContextMenu();
        return;
      }
      const confirmed = globalThis.confirm?.(`Discard ${backpackSlotLabel(slot)} from backpack? This cannot be undone.`) ?? true;
      if (!confirmed) return;
      const result = discardBackpackIndexes([index]);
      if (result?.then) return;
      closeContextMenu();
      renderGameUi();
      selectedBackpackIndexes.delete(index);
      focusedBackpackIndex = null;
      refresh();
      onStatus(result.ok ? `Discarded ${backpackSlotLabel(result.discarded?.[0])}.` : result.reason);
    });
    menu.querySelector("[data-action='discard-selected']")?.addEventListener("click", () => {
      closeContextMenu();
      discardSelectedBackpack();
    });
    menu.querySelector("[data-action='cancel-selection']")?.addEventListener("click", () => {
      closeContextMenu();
      clearSelection();
    });
    menu.querySelector("[data-action='close']")?.addEventListener("click", closeContextMenu);
    document.body.append(menu);
    contextMenu = menu;
    return menu;
  }

  function closeContextMenu() {
    if (!contextMenu) return;
    contextMenu.hidden = true;
    contextMenu.dataset.backpackSlot = "";
  }

  function refresh() {
    pruneSelection();
    updateSelectionClasses();
    updateSelectionControls();
    renderBackpackDetail();
  }

  function clearSelection(options = {}) {
    if (selectionSweep) clearSelectionSweep();
    selectedBackpackIndexes.clear();
    if (!options.keepFocus) focusedBackpackIndex = null;
    closeContextMenu();
    refresh();
    if (!options.silent) onStatus("Backpack selection cleared.");
  }

  function selectAllBackpack() {
    selectedBackpackIndexes.clear();
    const visibleIndexes = renderedBackpackIndexes();
    for (const index of visibleIndexes) {
      const slot = gameState.backpackSlots[index];
      if (slot && !slot.pending && !isEquippedBackpackSlot(slot) && !discardingBackpackIndexes.has(index)) selectedBackpackIndexes.add(index);
    }
    focusedBackpackIndex = selectedBackpackIndexes.values().next().value ?? null;
    refresh();
    onStatus(selectedBackpackIndexes.size
      ? `Selected ${selectedBackpackIndexes.size} confirmed backpack item${selectedBackpackIndexes.size === 1 ? "" : "s"}.`
      : "No confirmed backpack items to select.");
  }

  function toggleBackpackSelection(index) {
    if (!Number.isInteger(index) || !gameState.backpackSlots[index]) return;
    const slot = gameState.backpackSlots[index];
    if (isEquippedBackpackSlot(slot)) {
      focusedBackpackIndex = index;
      refresh();
      onStatus(equippedLockedMessage(slot));
      return;
    }
    if (slot.pending) {
      focusedBackpackIndex = index;
      refresh();
      onStatus("Pending resources cannot be batch-discarded before confirmation or rollback.");
      return;
    }
    if (selectedBackpackIndexes.has(index)) selectedBackpackIndexes.delete(index);
    else selectedBackpackIndexes.add(index);
    focusedBackpackIndex = index;
    refresh();
  }

  function discardSelectedBackpack() {
    pruneSelection();
    const indexes = Array.from(selectedBackpackIndexes).sort((a, b) => a - b);
    if (!indexes.length) {
      onStatus("No confirmed backpack items selected.");
      refresh();
      return;
    }
    const totalCount = indexes.reduce((sum, index) => sum + (gameState.backpackSlots[index]?.count || 0), 0);
    const confirmed = globalThis.confirm?.(`Discard ${indexes.length} stack${indexes.length === 1 ? "" : "s"} / ${totalCount} item${totalCount === 1 ? "" : "s"} from backpack? This cannot be undone.`) ?? true;
    if (!confirmed) return;
    const result = discardBackpackIndexes(indexes);
    if (result?.then) return;
    selectedBackpackIndexes.clear();
    focusedBackpackIndex = null;
    renderGameUi();
    refresh();
    onStatus(result.ok
      ? `Discarded ${result.discarded.length} backpack stack${result.discarded.length === 1 ? "" : "s"}.`
      : result.reason);
  }

  function pruneSelection() {
    for (const index of Array.from(selectedBackpackIndexes)) {
      const slot = gameState.backpackSlots[index];
      if (!slot || slot.pending || isEquippedBackpackSlot(slot) || discardingBackpackIndexes.has(index)) selectedBackpackIndexes.delete(index);
    }
    if (focusedBackpackIndex !== null && !gameState.backpackSlots[focusedBackpackIndex]) focusedBackpackIndex = null;
  }

  function updateSelectionClasses() {
    elements.backpackGrid?.querySelectorAll(".backpack-slot[data-backpack-slot]").forEach((slot) => {
      const index = Number(slot.dataset.backpackSlot);
      if (!Number.isInteger(index)) return;
      const equipped = isEquippedBackpackIndex(index);
      slot.classList.toggle("selected-for-discard", selectedBackpackIndexes.has(index));
      slot.classList.toggle("focused", index === focusedBackpackIndex);
      slot.classList.toggle("discarding", discardingBackpackIndexes.has(index));
      slot.classList.toggle("equipped", equipped);
      slot.dataset.equipped = equipped ? "true" : "false";
      slot.setAttribute("aria-disabled", equipped || discardingBackpackIndexes.has(index) ? "true" : "false");
    });
  }

  function updateSelectionControls() {
    const selected = selectedBackpackIndexes.size;
    if (elements.backpackActions) elements.backpackActions.classList.toggle("has-selection", selected > 0);
    if (elements.selectAllBackpack) {
      elements.selectAllBackpack.disabled = !renderedBackpackIndexes()
        .some((index) => gameState.backpackSlots[index]
          && !gameState.backpackSlots[index].pending
          && !isEquippedBackpackIndex(index)
          && !discardingBackpackIndexes.has(index));
    }
    if (elements.discardSelectedBackpack) {
      elements.discardSelectedBackpack.disabled = selected <= 0;
      elements.discardSelectedBackpack.textContent = selected > 0 ? `Discard selected (${selected})` : "Discard selected";
    }
    if (elements.cancelBackpackSelection) elements.cancelBackpackSelection.disabled = selected <= 0;
  }

  function renderBackpackDetail() {
    const detail = elements.backpackDetail;
    if (!detail) return;
    const index = focusedBackpackIndex ?? selectedBackpackIndexes.values().next().value ?? null;
    const slot = Number.isInteger(index) ? gameState.backpackSlots[index] : null;
    if (!slot) {
      detail.classList.remove("has-item");
      detail.innerHTML = "<i class=\"backpack-detail-empty-icon\" aria-hidden=\"true\"></i><strong>No item selected</strong><span>Choose a slot to inspect its item and proof data.</span>";
      return;
    }
    detail.classList.add("has-item");
    const equipment = gameState.getBackpackSlotEquipment?.(slot) ?? null;
    const equipped = Boolean(equipment);

    const kicker = document.createElement("div");
    kicker.className = "backpack-detail-kicker";
    const rarity = document.createElement("span");
    rarity.textContent = slot.pending ? "Pending" : slot.source === "chain" ? "Chain verified" : slot.kind === "smelted_material" ? "Refined" : "Common";
    const stack = document.createElement("span");
    stack.textContent = `Stack ${slot.count || 0}`;
    kicker.append(rarity, stack);

    const preview = document.createElement("div");
    preview.className = "backpack-detail-preview";
    if (typeof createVoxelItemIconCanvas === "function") {
      preview.append(createVoxelItemIconCanvas(slot, { size: 112 }));
    }
    const title = detailTitle(backpackItemName(slot), `x${slot.count || 0} · Slot ${index + 1}`);
    const tags = document.createElement("div");
    tags.className = "backpack-detail-tags";
    tags.append(detailTag(slot.kind === "resource"
      ? (Number(slot.decorationId) > 0 ? "Decoration" : "Block")
      : slot.kind === "forged" ? "Forged" : slot.kind === "blueprint" ? "Blueprint" : "Material"));
    tags.append(detailTag(slot.source === "chain" ? "On-chain" : "Local"));
    if (equipped) tags.append(detailTag(ui("main.backpack.equipped", "Equipped"), "equipped"));
    const description = document.createElement("p");
    description.className = "backpack-detail-description";
    description.textContent = equipped
      ? `${backpackDescription(slot)} ${equippedLockedMessage(slot)}`
      : backpackDescription(slot);
    const rows = [
      ["Kind", slot.kind || "resource"],
      ["Count", String(slot.count || 0)],
      ["Source", slot.source === "chain" ? "chain backpack" : "local"],
    ];
    if (slot.source === "chain") {
      rows.push(["Chain Slot", Number.isInteger(slot.chainIndex) ? String(slot.chainIndex) : "-"]);
      rows.push(["Backpack PDA", shortAddress(slot.chainBackpack)]);
    }
    if (equipment) {
      rows.push([ui("main.backpack.equipped", "Equipped"), ui(
        "main.backpack.equippedSlot",
        "Equipped in hotbar slot {slot}",
        { slot: equipment.index + 1 },
      )]);
    }
    if (slot.kind === "resource") {
      rows.push(["Resource", `${resourceName(slot.resourceId)} / R${slot.resourceId}`]);
      rows.push(["Block ID", String(slot.blockId ?? "-")]);
      if (Number(slot.decorationId) > 0) {
        rows.push(["Decoration ID", String(slot.decorationId)]);
        rows.push(["PDA Rule", String(slot.decorationRuleId || "-")]);
      }
      rows.push(["Gather Yield", Number.isFinite(slot.yieldBps) ? `${Math.round(slot.yieldBps / 100)}%` : "-"]);
      rows.push(["Volume", formatVolumeCm3(slot.volumeMm3)]);
      rows.push(["Mass", formatMassGrams(slot.massGrams)]);
    } else if (slot.kind === "smelted_material") {
      rows.push(["Material", slot.materialId || "-"]);
      rows.push(["Quality", Number.isFinite(slot.quality) ? String(slot.quality) : "-"]);
      rows.push(["Volume", formatVolumeCm3(slot.volumeMm3)]);
      rows.push(["Mass", formatMassGrams(slot.massGrams)]);
      rows.push(["Proof", proofDetailValue(slot.proofHash)]);
    } else if (slot.kind === "forged") {
      rows.push(["Item Code", String(slot.itemCode ?? "-")]);
      rows.push(["Item ID", slot.chainItemId || "-"]);
      rows.push(["Durability", `${slot.durabilityCurrent ?? 0} / ${slot.durabilityMax ?? 0}`]);
      rows.push(["Grade", String(slot.grade ?? "-")]);
      rows.push(["Item Level", String(slot.itemLevel ?? "-")]);
      rows.push(["Quality", Number.isFinite(slot.qualityBps) ? `${Math.round(slot.qualityBps / 100)}%` : "-"]);
      rows.push(["Volume", formatVolumeCm3(slot.volumeMm3)]);
      rows.push(["Mass", formatMassGrams(slot.massGrams)]);
    } else if (slot.kind === "blueprint") {
      rows.push(["Blueprint ID", slot.blueprintId || slot.chainItemId || "-"]);
      rows.push(["Blueprint PDA", proofDetailValue(slot.itemPda)]);
      rows.push(["Owner", shortAddress(slot.blueprintOwner)]);
    }
    const rowWrap = document.createElement("div");
    rowWrap.className = "backpack-detail-rows";
    rowWrap.replaceChildren(...rows.map(([label, value]) => detailRow(label, value)));

    const actions = document.createElement("div");
    actions.className = "backpack-detail-actions";
    const equip = detailAction(equipped ? ui("main.backpack.equipped", "Equipped") : "Equip", "primary", () => {
      if (isEquippedBackpackSlot(slot)) {
        onStatus(equippedLockedMessage(slot));
        refresh();
        return;
      }
      const result = gameState.equipBackpackSlotToHotbar(slot.id);
      renderGameUi();
      refresh();
      onStatus(result.ok
        ? `Equipped ${backpackSlotLabel(slot)} to hotbar slot ${result.index + 1}.`
        : result.reason);
    });
    equip.disabled = equipped || !isPlaceableBackpackSlot(slot);
    const select = detailAction(selectedBackpackIndexes.has(index) ? "Unselect" : "Select", "secondary", () => {
      toggleBackpackSelection(index);
    });
    select.disabled = Boolean(equipped || slot.pending);
    const discard = detailAction("Discard", "danger", () => {
      const confirmed = globalThis.confirm?.(`Discard ${backpackSlotLabel(slot)} from backpack? This cannot be undone.`) ?? true;
      if (!confirmed) return;
      const result = discardBackpackIndexes([index]);
      if (result?.then) return;
      selectedBackpackIndexes.delete(index);
      focusedBackpackIndex = null;
      renderGameUi();
      refresh();
      onStatus(result.ok ? `Discarded ${backpackSlotLabel(slot)}.` : result.reason);
    });
    discard.disabled = Boolean(equipped || slot.pending || slot.kind === "blueprint" || discardingBackpackIndexes.has(index));
    actions.append(equip, select, discard);
    detail.replaceChildren(kicker, preview, title, tags, description, rowWrap, actions);
  }

  function discardBackpackIndexes(indexes) {
    const safeIndexes = Array.from(new Set((indexes ?? [])
      .map((index) => Number(index))
      .filter((index) => Number.isInteger(index) && index >= 0 && index < gameState.backpackSlots.length)))
      .sort((a, b) => a - b);
    const slots = safeIndexes.map((index) => ({ index, slot: gameState.backpackSlots[index] })).filter((entry) => entry.slot);
    if (!slots.length) {
      onStatus("No backpack item selected.");
      refresh();
      return { ok: false, reason: "No backpack item selected." };
    }
    if (slots.some((entry) => entry.slot.pending)) {
      onStatus("Pending resources cannot be discarded before confirmation or rollback.");
      refresh();
      return { ok: false, reason: "pending-resource" };
    }
    const equippedEntry = slots.find((entry) => isEquippedBackpackSlot(entry.slot));
    if (equippedEntry) {
      const reason = equippedLockedMessage(equippedEntry.slot);
      onStatus(reason);
      refresh();
      return { ok: false, reason: "equipped-backpack-item" };
    }
    const run = typeof onDiscardBackpackSlots === "function"
      ? onDiscardBackpackSlots(safeIndexes, { slots: slots.map((entry) => entry.slot) })
      : gameState.discardBackpackSlots(safeIndexes);
    if (!run?.then) return run;
    setDiscardingIndexes(safeIndexes, true);
    closeContextMenu();
    onStatus(safeIndexes.length === 1 ? "Discarding backpack item..." : `Discarding ${safeIndexes.length} backpack stacks...`);
    run.then((result) => {
      selectedBackpackIndexes.clear();
      focusedBackpackIndex = null;
      renderGameUi();
      refresh();
      onStatus(result?.ok
        ? `Discarded ${result.count || safeIndexes.length} backpack stack${(result.count || safeIndexes.length) === 1 ? "" : "s"}.`
        : `Discard skipped: ${result?.reason || "not-submitted"}.`);
    }).catch((error) => {
      refresh();
      onStatus(`Discard failed: ${readableError(error)}.`);
    }).finally(() => {
      setDiscardingIndexes(safeIndexes, false);
      renderGameUi();
      refresh();
    });
    return run;
  }

  function setDiscardingIndexes(indexes, discarding) {
    for (const index of indexes ?? []) {
      if (discarding) discardingBackpackIndexes.add(index);
      else discardingBackpackIndexes.delete(index);
    }
    refresh();
  }

  function detailTitle(title, subtitle) {
    const wrap = document.createElement("div");
    wrap.className = "backpack-detail-title";
    const strong = document.createElement("strong");
    strong.textContent = title;
    const small = document.createElement("span");
    small.textContent = subtitle;
    wrap.append(strong, small);
    return wrap;
  }

  function detailRow(label, value) {
    const row = document.createElement("div");
    row.className = "backpack-detail-row";
    const key = document.createElement("span");
    key.textContent = label;
    if (value?.nodeType) {
      row.append(key, value);
      return row;
    }
    const val = document.createElement("strong");
    val.textContent = value;
    row.append(key, val);
    return row;
  }

  function proofDetailValue(proof) {
    const text = String(proof || "").trim();
    const href = solanaExplorerAddressUrl(text, getRpcUrl());
    if (!href) return text || "-";
    const link = document.createElement("a");
    link.className = "backpack-detail-proof";
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = text;
    link.textContent = text;
    return link;
  }

  function detailTag(label, variant = "") {
    const tag = document.createElement("span");
    if (variant) tag.classList.add(variant);
    tag.textContent = label;
    return tag;
  }

  function detailAction(label, variant, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `backpack-detail-action ${variant}`;
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }

  function backpackDescription(slot) {
    if (slot.pending) return "This mined stack is waiting for confirmation before it can be equipped or discarded.";
    if (slot.kind === "forged") return "A forged item read directly from the equipped on-chain backpack PDA.";
    if (slot.kind === "blueprint") return "A unique Blueprint item verified by its on-chain item PDA.";
    if (slot.kind === "smelted_material") return "A refined material stack prepared for crafting and advanced production.";
    if (slot.source === "chain" && Number(slot.decorationId) > 0) return "A verified surface decoration stored with its PDA rule identity in the on-chain backpack.";
    if (slot.source === "chain") return "A verified voxel resource stored in the connected on-chain backpack account.";
    return "A gathered voxel resource that can be inspected, reordered, equipped, or discarded.";
  }

  function isEquippedBackpackIndex(index) {
    return Number.isInteger(index) && isEquippedBackpackSlot(gameState.backpackSlots[index]);
  }

  function isEquippedBackpackSlot(slot) {
    return Boolean(slot && gameState.isBackpackSlotEquipped?.(slot));
  }

  function equippedLockedMessage(slot) {
    const equipment = gameState.getBackpackSlotEquipment?.(slot);
    return ui(
      "main.backpack.equippedLocked",
      "Equipped in hotbar slot {slot}. Unequip it before selecting, moving, or discarding it.",
      { slot: (equipment?.index ?? 0) + 1 },
    );
  }

  function renderedBackpackIndexes() {
    return Array.from(elements.backpackGrid?.querySelectorAll(".backpack-slot[data-backpack-slot]") || [])
      .map((element) => Number(element.dataset.backpackSlot))
      .filter(Number.isInteger);
  }

  function sourceElementForDrag() {
    if (!drag) return null;
    if (drag.type === "hotbar") return elements.hotbar?.querySelector(`.hotbar-slot[data-slot="${drag.from}"]`);
    return elements.backpackGrid?.querySelector(`.backpack-slot[data-backpack-slot="${drag.from}"]`);
  }

  function beginDragGhost(sourceElement, x, y) {
    if (!sourceElement) return;
    clearDragGhost();
    const rect = sourceElement.getBoundingClientRect();
    ghost = sourceElement.cloneNode(true);
    ghost.classList.remove("selected", "drag-source", "drag-over", "drop-blocked");
    ghost.classList.add("drag-ghost");
    ghost.removeAttribute("id");
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    copyCanvasPixels(sourceElement, ghost);
    document.body.append(ghost);
    moveDragGhost(x, y);
  }

  function moveDragGhost(x, y) {
    if (!ghost) return;
    ghost.style.left = `${x}px`;
    ghost.style.top = `${y}px`;
  }

  function clearDragGhost() {
    ghost?.remove();
    ghost = null;
  }

  function updateDragClasses() {
    elements.backpackGrid?.querySelectorAll(".backpack-slot").forEach((slot, index) => {
      slot.classList.toggle("drag-source", drag?.type === "backpack" && index === drag.from);
      slot.classList.toggle("drag-over", index === drag?.overBackpack && !(drag.type === "backpack" && index === drag.from));
    });
    elements.hotbar?.querySelectorAll(".hotbar-slot").forEach((slot, index) => {
      const blocked = drag?.type === "backpack" && !gameState.canModifyHotbarSlot(index);
      slot.classList.toggle("drag-source", drag?.type === "hotbar" && index === drag.from);
      slot.classList.toggle("drag-over", index === drag?.overHotbar && !blocked && !(drag.type === "hotbar" && index === drag.from));
      slot.classList.toggle("drop-blocked", index === drag?.overHotbar && blocked);
    });
  }

  function clearDragState({ suppress = false } = {}) {
    drag = null;
    clearTimeout(longPressTimer);
    clearDragGhost();
    clearDragClasses();
    if (suppress) armClickSuppression();
  }

  function clearDragClasses() {
    elements.backpackGrid?.querySelectorAll(".backpack-slot").forEach((slot) => slot.classList.remove("drag-source", "drag-over"));
    elements.hotbar?.querySelectorAll(".hotbar-slot").forEach((slot) => slot.classList.remove("drag-source", "drag-over", "drop-blocked"));
  }

  function suppressNextClick(event) {
    if (!suppressClick) return;
    clearTimeout(suppressClickTimer);
    suppressClickTimer = 0;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function armClickSuppression() {
    clearTimeout(suppressClickTimer);
    suppressClick = true;
    suppressClickTimer = setTimeout(() => {
      suppressClick = false;
      suppressClickTimer = 0;
    }, 0);
  }

  function backpackSlotLabel(slot) {
    if (!slot) return "Item";
    if (slot.kind !== "resource") return voxelItemLabel(slot);
    return `${backpackItemName(slot)} x${slot.count}`;
  }

  function backpackItemName(slot) {
    if (!slot) return "Item";
    if (slot.kind !== "resource") return voxelItemLabel(slot);
    if (Number(slot.decorationId) > 0 || Number(slot.blockId) > 0) {
      const itemName = voxelItemLabel(slot);
      if (itemName) return itemName;
    }
    return resourceName(slot.resourceId);
  }
}

function hotbarSlotIndexFromEvent(event) {
  const slot = event.target.closest(".hotbar-slot");
  if (!slot) return null;
  const index = Number(slot.dataset.slot);
  return Number.isInteger(index) ? index : null;
}

function hotbarSlotIndexFromPoint(x, y) {
  const element = document.elementFromPoint(x, y);
  const slot = element?.closest?.(".hotbar-slot");
  if (!slot) return null;
  const index = Number(slot.dataset.slot);
  return Number.isInteger(index) ? index : null;
}

function backpackSlotIndexFromEvent(event) {
  const slot = event.target.closest(".backpack-slot");
  if (!slot) return null;
  const index = Number(slot.dataset.backpackSlot);
  return Number.isInteger(index) ? index : null;
}

function backpackSlotIndexFromPoint(x, y) {
  const element = document.elementFromPoint(x, y);
  const slot = element?.closest?.(".backpack-slot");
  if (!slot) return null;
  const index = Number(slot.dataset.backpackSlot);
  return Number.isInteger(index) ? index : null;
}

function segmentIntersectsRect(fromX, fromY, toX, toY, rect) {
  const left = rect.left - 1;
  const right = rect.right + 1;
  const top = rect.top - 1;
  const bottom = rect.bottom + 1;
  const dx = toX - fromX;
  const dy = toY - fromY;
  let near = 0;
  let far = 1;
  for (const [direction, distance] of [
    [-dx, fromX - left],
    [dx, right - fromX],
    [-dy, fromY - top],
    [dy, bottom - fromY],
  ]) {
    if (direction === 0) {
      if (distance < 0) return false;
      continue;
    }
    const ratio = distance / direction;
    if (direction < 0) {
      if (ratio > far) return false;
      near = Math.max(near, ratio);
    } else {
      if (ratio < near) return false;
      far = Math.min(far, ratio);
    }
  }
  return near <= far;
}

function copyCanvasPixels(sourceElement, targetElement) {
  const sourceCanvases = sourceElement.querySelectorAll("canvas");
  const targetCanvases = targetElement.querySelectorAll("canvas");
  sourceCanvases.forEach((sourceCanvas, index) => {
    const targetCanvas = targetCanvases[index];
    if (!targetCanvas) return;
    targetCanvas.width = sourceCanvas.width;
    targetCanvas.height = sourceCanvas.height;
    targetCanvas.getContext("2d")?.drawImage(sourceCanvas, 0, 0);
  });
}

function isPlaceableBackpackSlot(slot) {
  return Boolean(slot && !slot.pending && slot.count > 0 && (
    slot.kind === "forged" && Number.isFinite(Number(slot.designHash)) && (Math.trunc(Number(slot.designHash)) >>> 0) !== 0
    || slot.kind === "resource" && Number.isFinite(slot.blockId) && slot.blockId > 0
    || slot.kind === "blueprint" && /^\d+$/.test(String(slot.blueprintId || "")) && BigInt(slot.blueprintId) > 0n
  ));
}

function shortAddress(value) {
  const text = String(value || "");
  if (!text) return "-";
  return text.length <= 12 ? text : `${text.slice(0, 4)}...${text.slice(-4)}`;
}

export function formatVolumeCm3(volumeMm3) {
  const value = Number(volumeMm3);
  if (!Number.isFinite(value) || value < 0) return "-";
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(value / 1000)} cm³`;
}

export function formatMassGrams(massGrams) {
  const value = Number(massGrams);
  if (!Number.isFinite(value) || value < 0) return "-";
  if (value >= 1000) {
    return `${new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(value / 1000)} kg`;
  }
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(value)} g`;
}

const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function solanaExplorerAddressUrl(proof, rpcUrl = "") {
  const address = String(proof || "").trim();
  if (!SOLANA_ADDRESS_PATTERN.test(address)) return "";
  const explorerUrl = `https://explorer.solana.com/address/${address}`;
  const rpc = String(rpcUrl || "").toLowerCase();
  if (rpc.includes("mainnet")) return explorerUrl;
  const cluster = rpc.includes("testnet") ? "testnet" : "devnet";
  return `${explorerUrl}?cluster=${cluster}`;
}

function readableError(error) {
  const message = String(error?.message || error || "unknown error");
  return message.length > 140 ? `${message.slice(0, 137)}...` : message;
}

function formatMessage(template, params = {}) {
  return String(template || "").replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
  ));
}
