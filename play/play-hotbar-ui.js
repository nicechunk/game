export function createPlayHotbarUi({
  elements,
  gameState,
  createVoxelItemIconCanvas,
  voxelItemLabel,
  onOpenBackpack = () => {},
  onRenderHotbar = () => {},
} = {}) {
  const renderKeys = new WeakMap();

  return {
    render,
  };

  function render() {
    if (!elements.hotbar) return;
    gameState.syncHotbarResourceSlots?.();
    const slots = Array.isArray(gameState.hotbarSlots) ? gameState.hotbarSlots : [];
    for (let index = 0; index < slots.length; index += 1) {
      const view = hotbarSlotView(slots[index], index);
      let button = elements.hotbar.children[index] ?? null;
      if (!button || renderKeys.get(button) !== view.renderKey) {
        const replacement = hotbarButton(view, index);
        if (button) button.replaceWith(replacement);
        else elements.hotbar.append(replacement);
        button = replacement;
      }
      updateHotbarButton(button, view, index);
    }
    while (elements.hotbar.children.length > slots.length) {
      elements.hotbar.lastElementChild?.remove();
    }
  }

  function hotbarSlotView(slot, index) {
    const isBackpackSlot = slot?.itemId === "backpack";
    const backpackAvailable = gameState.isBackpackAvailable?.() === true;
    const visibleSlot = isBackpackSlot && !backpackAvailable ? null : slot;
    const item = visibleSlot ? gameState.hotbarItems[visibleSlot.itemId] : null;
    const renderedItem = visibleSlot ? { ...item, ...visibleSlot } : null;
    const isBlueprint = visibleSlot?.itemId === "blueprint_tool";
    const opensBackpack = isBackpackSlot && backpackAvailable;
    const label = visibleSlot
      ? `${voxelItemLabel(renderedItem)}${isBlueprint ? ` #${visibleSlot.blueprintOrdinal || "-"}` : ""}`
      : "Empty";
    return {
      slot,
      visibleSlot,
      renderedItem,
      isBackpackSlot,
      isBlueprint,
      opensBackpack,
      label,
      amount: hotbarSlotAmount(visibleSlot),
      renderKey: hotbarRenderKey({ renderedItem, isBackpackSlot, isBlueprint, opensBackpack, label }),
      selected: !isBackpackSlot && index === gameState.selectedHotbarSlot,
    };
  }

  function hotbarButton(view, index) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hotbar-slot";
    renderKeys.set(button, view.renderKey);

    const number = document.createElement("span");
    number.className = "hotbar-number";
    number.textContent = String(index + 1);

    const icon = document.createElement("span");
    icon.className = "hotbar-icon";
    if (view.renderedItem) {
      icon.append(createVoxelItemIconCanvas(view.renderedItem, { size: 42 }));
    } else {
      icon.textContent = "·";
    }

    const label = document.createElement("span");
    label.className = "hotbar-label";
    label.textContent = view.label;
    button.append(number, icon, label);

    button.addEventListener("click", () => {
      const currentSlot = gameState.hotbarSlots[index] ?? null;
      const currentBackpack = currentSlot?.itemId === "backpack";
      if (currentBackpack && gameState.isBackpackAvailable?.() === true) {
        onOpenBackpack();
        return;
      }
      if (currentBackpack) return;
      gameState.selectHotbarSlot(index);
      onRenderHotbar();
    });
    return button;
  }

  function updateHotbarButton(button, view, index) {
    if (!button) return;
    button.classList.toggle("selected", view.selected);
    button.classList.toggle("hotbar-action", view.opensBackpack);
    button.classList.toggle("backpack-unavailable", view.isBackpackSlot && !view.opensBackpack);
    button.dataset.slot = String(index);
    syncOptionalDataset(button, "blueprintId", view.isBlueprint ? String(view.visibleSlot.blueprintId || "") : "");
    syncOptionalDataset(button, "backpackTarget", view.isBackpackSlot ? "true" : "");
    syncOptionalDataset(button, "action", view.opensBackpack ? "open-backpack" : "");
    button.title = view.isBlueprint ? String(view.visibleSlot.blueprintId || "") : "";
    if (view.opensBackpack) {
      button.setAttribute("aria-label", "Open backpack");
      button.removeAttribute("aria-disabled");
    } else if (view.isBackpackSlot) {
      button.setAttribute("aria-label", "Backpack not created");
      button.setAttribute("aria-disabled", "true");
    } else {
      button.removeAttribute("aria-label");
      button.removeAttribute("aria-disabled");
    }
    syncAmount(button, view.amount);
  }

  function syncAmount(button, amount) {
    let count = button.querySelector(".hotbar-amount");
    if (!amount) {
      count?.remove();
      return;
    }
    if (!count) {
      count = document.createElement("span");
      count.className = "hotbar-amount";
      button.append(count);
    }
    if (count.textContent !== amount) count.textContent = amount;
  }

  function hotbarSlotAmount(slot) {
    if (!slot) return "";
    if (slot.itemId === "blueprint_tool") return `#${slot.blueprintOrdinal || "-"}`;
    if (Number.isFinite(slot.durability)) return String(Math.max(0, Math.trunc(slot.durability || 0)));
    if (slot.itemId === "backpack") return `${gameState.totalBackpackItems()}`;
    return Number.isFinite(slot.count) ? String(slot.count) : "";
  }
}

function hotbarRenderKey({ renderedItem, isBackpackSlot, isBlueprint, opensBackpack, label }) {
  return JSON.stringify([
    isBackpackSlot,
    isBlueprint,
    opensBackpack,
    label,
    renderedItem ? hotbarVisualFields(renderedItem) : null,
  ]);
}

function hotbarVisualFields(item) {
  return [
    item.itemId ?? "",
    item.kind ?? "",
    item.blockId ?? null,
    item.resourceId ?? null,
    item.decorationId ?? null,
    item.decorationRuleId ?? null,
    item.decorationVariantHash ?? null,
    item.decorationSurfaceBlockId ?? null,
    item.decorationVariant ?? null,
    item.decorationFlags ?? null,
    item.materialId ?? "",
    item.designHash ?? null,
    item.code ?? "",
    ArrayBuffer.isView(item.bytes) ? Array.from(item.bytes) : item.bytes ?? null,
    item.previewColor ?? null,
  ];
}

function syncOptionalDataset(element, key, value) {
  if (value) element.dataset[key] = value;
  else delete element.dataset[key];
}
