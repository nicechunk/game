import { createSmeltingCoreRenderer } from "/chunk.js/play.js";
import { t } from "/src/i18n.js";
import { loadPlayChainModule } from "./play-chain-adapter.js";
import { resolveSelectedSmeltingRecipe } from "./smelting-recipe-selection.js";
import {
  SMELTING_FUELS,
  SMELTING_MATERIAL_ATTRIBUTE_KEYS,
  SMELTING_RECIPES,
  bestSmeltingFuelSlot,
  deriveSmeltingMaterialProperties,
  isSmeltingFuelSlot,
  isSmeltingInputSlot,
  maxSmeltingRecipeServings,
  recipeRequirements,
  smeltingFuelForSlot,
  smeltingHeatTierByTier,
  smeltingInputKeyForSlot,
  smeltingMaterialForSlot,
  smeltingMaterialIdForInputKey,
  smeltingMaterialPreviewItem,
  smeltingRawKeyBlockId,
  smeltingRecipeChainIdentity,
  smeltingRecipeForSelectedSlots,
  smeltingRecipePlan,
  smeltingRecipeRequiresFuel,
  smeltingRecipeYieldBps,
  smeltingSkillOutputBpsForLevel,
} from "./smelting-rules-lite.js";

const INPUT_GROUP_LIMIT = 5;
const INPUT_RECORD_LIMIT = 8;
const COMPLETE_HOLD_MS = 1600;
const CORE_FRAME_INTERVAL_MS = 32;

export function createPlaySmelting({
  elements,
  gameState,
  createVoxelItemIconCanvas,
  resourceName,
  voxelItemLabel,
  getSkillEffects = () => null,
  getBackpackSnapshot = () => null,
  refreshBackpack = async () => null,
  onSharedPanelOpen = () => {},
  onStatus = () => {},
  onChanged = () => {},
} = {}) {
  const state = {
    inputSlotIds: [],
    fuelSlotId: "",
    recipeId: SMELTING_RECIPES[0]?.id || "",
    servings: 1,
    resourceFilter: "all",
    recipeFilter: "all",
    mobileSection: "backpack",
    running: false,
    complete: false,
    progress: 0,
    startedAt: 0,
    visualFrame: 0,
    lastVisualAt: 0,
    resetTimer: 0,
    result: null,
  };
  const signatures = { resources: "", recipes: "", slots: "", details: "" };
  const iconCache = new Map();
  const coreVisualState = { heatTier: 0, ready: false };
  let smeltingCore = null;
  let bound = false;

  const api = {
    bind,
    render,
    openPanel: showSmelting,
    closePanel,
    togglePanel,
    showInventory,
    showSmelting,
    isOpen,
  };

  function bind() {
    if (bound) return;
    bound = true;
    elements.inventoryModeButton?.addEventListener("click", showInventory);
    elements.smeltingModeButton?.addEventListener("click", showSmelting);
    elements.smeltingButton?.addEventListener("click", togglePanel);
    elements.smeltingStart?.addEventListener("click", startSmelting);
    elements.smeltingAutoFill?.addEventListener("click", autoFillSelectedRecipe);
    elements.smeltingClear?.addEventListener("click", clearSelection);
    elements.smeltingResourceGrid?.addEventListener("click", handleResourceClick);
    elements.smeltingRecipeList?.addEventListener("click", handleRecipeClick);
    elements.smeltingInputSlot?.addEventListener("click", handleInputSlotClick);
    elements.smeltingFuelSlot?.addEventListener("click", handleFuelSlotClick);
    elements.smeltingRecipeDetails?.addEventListener("click", handleDetailsClick);
    elements.smeltingPanel?.querySelectorAll("[data-smelting-resource-filter]").forEach((button) => {
      button.addEventListener("click", () => setResourceFilter(button.dataset.smeltingResourceFilter));
    });
    elements.smeltingPanel?.querySelectorAll("[data-smelting-recipe-filter]").forEach((button) => {
      button.addEventListener("click", () => setRecipeFilter(button.dataset.smeltingRecipeFilter));
    });
    elements.smeltingPanel?.querySelectorAll("[data-smelting-section]").forEach((button) => {
      button.addEventListener("click", () => setMobileSection(button.dataset.smeltingSection));
    });
  }

  function togglePanel() {
    if (isOpen()) showInventory();
    else showSmelting();
  }

  function showInventory() {
    setSharedMode("inventory");
  }

  function showSmelting() {
    if (!elements.backpackPanel || !elements.smeltingPanel) return;
    onSharedPanelOpen();
    elements.backpackPanel.hidden = false;
    setSharedMode("smelting");
    render({ force: true });
    startSmeltingVisuals();
  }

  function closePanel() {
    clearTimeout(state.resetTimer);
    setSharedMode("inventory");
    stopSmeltingVisuals();
  }

  function setSharedMode(mode) {
    const smeltingMode = mode === "smelting";
    if (elements.backpackPanel) elements.backpackPanel.dataset.inventoryMode = smeltingMode ? "smelting" : "inventory";
    if (elements.backpackInventoryView) elements.backpackInventoryView.hidden = smeltingMode;
    if (elements.smeltingPanel) elements.smeltingPanel.hidden = !smeltingMode;
    updateModeButton(elements.inventoryModeButton, !smeltingMode);
    updateModeButton(elements.smeltingModeButton, smeltingMode);
    if (smeltingMode) startSmeltingVisuals();
    else {
      stopSmeltingVisuals();
      releaseDynamicViews();
    }
  }

  function updateModeButton(button, selected) {
    if (!button) return;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
    button.tabIndex = selected ? 0 : -1;
  }

  function isOpen() {
    return Boolean(elements.backpackPanel && !elements.backpackPanel.hidden && elements.smeltingPanel && !elements.smeltingPanel.hidden);
  }

  function render({ force = false } = {}) {
    // Async submissions may finish after the player has returned to the
    // backpack. Do not remount the large hidden recipe tree in that state.
    if (!elements.smeltingPanel || !isOpen()) return;
    syncSelections();
    renderResources(force);
    renderRecipes(force);
    renderWorkbench(force);
    renderRecipeDetails(force);
    renderProgress();
    renderFilterState();
    renderMobileSectionState();
  }

  function authoritativeSlots() {
    return (gameState?.backpackSlots || []).filter((slot) => (
      slot
      && !slot.pending
      && slot.source === "chain"
      && Number.isInteger(slot.chainIndex)
    ));
  }

  function syncSelections() {
    const slots = authoritativeSlots();
    const ids = new Set(slots.map((slot) => slot.id));
    state.inputSlotIds = state.inputSlotIds.filter((id) => ids.has(id));
    if (!ids.has(state.fuelSlotId) || !isSmeltingFuelSlot(slotById(state.fuelSlotId, slots))) state.fuelSlotId = "";
    const recipe = recipeById(state.recipeId) || SMELTING_RECIPES[0] || null;
    state.recipeId = recipe?.id || "";
    state.servings = Math.max(1, Math.floor(Number(state.servings) || 1));

    const selectedMatch = smeltingRecipeForSelectedSlots(selectedInputSlots(slots));
    if (selectedMatch?.recipe) {
      state.recipeId = selectedMatch.recipe.id;
      state.servings = Math.max(1, selectedMatch.multiplier || 1);
    }
  }

  function renderResources(force) {
    if (!elements.smeltingResourceGrid) return;
    const slots = authoritativeSlots();
    const selected = new Set(state.inputSlotIds);
    const signature = [
      document.documentElement.lang,
      state.resourceFilter,
      state.fuelSlotId,
      state.inputSlotIds.join(","),
      ...slots.map(slotSignature),
    ].join("|");
    if (!force && signatures.resources === signature) return;
    signatures.resources = signature;

    const visible = slots.filter((slot) => {
      if (state.resourceFilter === "fuel") return isSmeltingFuelSlot(slot);
      if (state.resourceFilter === "raw") return slot.kind === "resource" && isSmeltingInputSlot(slot);
      return true;
    });
    const cards = visible.map((slot, displayIndex) => {
      const inputReady = isSmeltingInputSlot(slot);
      const fuel = smeltingFuelForSlot(slot);
      const card = document.createElement("article");
      card.className = "nice-smelting-resource-card";
      card.classList.toggle("selected-input", selected.has(slot.id));
      card.classList.toggle("selected-fuel", state.fuelSlotId === slot.id);
      card.classList.toggle("disabled", !inputReady && !fuel);
      card.dataset.smeltingSlotId = slot.id;

      const slotNumber = document.createElement("span");
      slotNumber.className = "nice-smelting-resource-number";
      slotNumber.textContent = String(displayIndex + 1);
      const iconWrap = document.createElement("span");
      iconWrap.className = "nice-smelting-resource-icon";
      iconWrap.append(itemIcon(slot, 48));
      const count = document.createElement("b");
      count.className = "nice-smelting-resource-count";
      count.textContent = String(Math.max(1, Number(slot.count) || 1));
      const name = document.createElement("strong");
      name.textContent = slotLabel(slot);
      const meta = document.createElement("small");
      meta.textContent = fuel
        ? ui("main.smelting.fuelHeat", "Heat tier {tier}", { tier: fuel.heatTier })
        : inputKeyLabel(smeltingInputKeyForSlot(slot));
      const actions = document.createElement("span");
      actions.className = "nice-smelting-resource-actions";
      if (inputReady) actions.append(resourceActionButton(slot.id, "input", selected.has(slot.id)));
      if (fuel) actions.append(resourceActionButton(slot.id, "fuel", state.fuelSlotId === slot.id));
      card.append(slotNumber, iconWrap, count, name, meta, actions);
      return card;
    });
    if (!cards.length) cards.push(emptyState("main.smelting.noResources", "No mined resources in this backpack."));
    elements.smeltingResourceGrid.replaceChildren(...cards);
    if (elements.smeltingResourceMeta) {
      const snapshot = getBackpackSnapshot?.() || {};
      const capacity = Math.max(slots.length, Number(snapshot.capacity) || 50);
      elements.smeltingResourceMeta.textContent = `${slots.length} / ${capacity}`;
    }
  }

  function resourceActionButton(slotId, role, selected) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.smeltingUse = role;
    button.dataset.smeltingSlotId = slotId;
    button.classList.toggle("active", selected);
    button.textContent = role === "fuel"
      ? ui("main.smelting.addFuel", "Fuel")
      : ui("main.smelting.addInput", "Input");
    return button;
  }

  function renderRecipes(force) {
    if (!elements.smeltingRecipeList) return;
    const slots = authoritativeSlots();
    const summaries = SMELTING_RECIPES
      .map((recipe) => recipeSummary(recipe, slots))
      .filter((summary) => {
        if (state.recipeFilter === "ready") return summary.ready;
        if (state.recipeFilter === "missing") return !summary.ready;
        if (state.recipeFilter === "fuel") return summary.recipe.forgeUse === "fuel" || summary.recipe.class === "carbon";
        if (state.recipeFilter === "building") return summary.recipe.forgeUse === "construction";
        return true;
      })
      .sort((a, b) => Number(b.selected) - Number(a.selected) || Number(b.ready) - Number(a.ready) || b.ratio - a.ratio);
    const signature = [
      document.documentElement.lang,
      state.recipeFilter,
      state.recipeId,
      state.servings,
      ...slots.map(slotSignature),
    ].join("|");
    if (!force && signatures.recipes === signature) return;
    signatures.recipes = signature;
    const previousScroll = elements.smeltingRecipeList.scrollTop;
    const cards = summaries.map((summary) => recipeCard(summary, slots));
    if (!cards.length) cards.push(emptyState("main.smelting.noRecipeMatch", "No public recipe match for this filter."));
    elements.smeltingRecipeList.replaceChildren(...cards);
    elements.smeltingRecipeList.scrollTop = previousScroll;
  }

  function recipeSummary(recipe, slots) {
    const servings = recipe.id === state.recipeId ? state.servings : 1;
    const plan = smeltingRecipePlan(recipe, slots, servings);
    const requiresFuel = smeltingRecipeRequiresFuel(recipe);
    const fuel = bestSmeltingFuelSlot(slots, recipe.requiredHeatTier, plan.used);
    const required = Math.max(1, plan.requiredCount);
    return {
      recipe,
      plan,
      fuel,
      requiresFuel,
      ready: plan.complete && (!requiresFuel || Boolean(fuel)),
      selected: recipe.id === state.recipeId,
      ratio: plan.selectedCount / required,
      maxServings: maxSmeltingRecipeServings(recipe, slots),
    };
  }

  function recipeCard(summary, slots) {
    const { recipe, plan } = summary;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nice-smelting-recipe-card";
    button.classList.toggle("selected", summary.selected);
    button.classList.toggle("ready", summary.ready);
    button.dataset.recipeId = recipe.id;

    const formula = document.createElement("span");
    formula.className = "nice-smelting-recipe-formula";
    const allRequirements = recipeRequirements(recipe);
    const requirements = allRequirements.slice(0, 3);
    formula.title = allRequirements
      .map((input) => `${Math.max(1, Number(input.amount) || 1)}x ${inputKeyLabel(input.key)}`)
      .join(" + ");
    requirements.forEach((input, index) => {
      if (index) formula.append(symbol("+"));
      const available = slots.find((slot) => smeltingInputKeyForSlot(slot) === input.key);
      const icon = itemIcon(available || previewItemForInputKey(input.key), 34);
      icon.title = inputKeyLabel(input.key);
      formula.append(icon);
      if (input.amount > 1) {
        const amount = document.createElement("b");
        amount.textContent = `x${input.amount}`;
        formula.append(amount);
      }
    });
    if (allRequirements.length > requirements.length) {
      const remaining = symbol(`+${allRequirements.length - requirements.length}`);
      remaining.classList.add("nice-smelting-recipe-overflow");
      formula.append(remaining);
    }
    formula.append(symbol("›"), itemIcon(outputPreviewItem(recipe), 38));

    const copy = document.createElement("span");
    copy.className = "nice-smelting-recipe-copy";
    const name = document.createElement("strong");
    name.textContent = materialName(recipe.id);
    const detail = document.createElement("small");
    if (summary.requiresFuel) {
      const heat = smeltingHeatTierByTier(recipe.requiredHeatTier);
      detail.textContent = `${ui("main.smelting.fuelHeat", "Heat tier {tier}", { tier: recipe.requiredHeatTier })} · ${heat?.temperatureC || 0}°C`;
    } else {
      detail.textContent = ui("main.smelting.ambientProcess", "Ambient process · {station}", {
        station: humanize(recipe.station || recipe.processType || "workbench"),
      });
    }
    copy.append(name, detail);

    const status = document.createElement("span");
    status.className = "nice-smelting-recipe-status";
    status.textContent = summary.ready
      ? ui("main.smelting.recipeReady", "Ready")
      : plan.complete
        ? summary.requiresFuel
          ? ui("main.smelting.recipeFuelMissing", "Missing fuel")
          : ui("main.smelting.recipeReady", "Ready")
        : ui("main.smelting.recipeMissingInputs", "Missing {count} input slots", {
            count: plan.requirements.reduce((sum, input) => sum + input.missing, 0),
          });
    button.append(formula, copy, status);
    return button;
  }

  function renderWorkbench(force) {
    const view = selectedRecipeView();
    coreVisualState.heatTier = Math.max(0, view.fuel?.heatTier || 0);
    coreVisualState.ready = view.ready;
    const grouped = groupSelectedInputs(view.inputSlots, view.recipe);
    const signature = [
      document.documentElement.lang,
      state.recipeId,
      state.servings,
      state.fuelSlotId,
      state.inputSlotIds.join(","),
      state.running,
      state.complete,
    ].join("|");
    if (!force && signatures.slots === signature) return;
    signatures.slots = signature;
    renderInputGroups(grouped, view.recipe);
    renderFuelSlot(view.fuelSlot, view.fuel, view.recipe);
    renderOutput(view);
    renderCoreLabel(view);
  }

  function renderInputGroups(groups, recipe) {
    if (!elements.smeltingInputSlot) return;
    const bays = groups.slice(0, INPUT_GROUP_LIMIT).map((group, index) => {
      const bay = document.createElement("article");
      bay.className = "nice-smelting-input-bay filled";
      bay.dataset.inputKey = group.key;
      const number = document.createElement("span");
      number.textContent = String(index + 1);
      const icon = itemIcon(group.slots[0], 58);
      const name = document.createElement("strong");
      name.textContent = inputKeyLabel(group.key);
      const count = document.createElement("b");
      const requirement = recipeRequirements(recipe).find((entry) => entry.key === group.key);
      const needed = Math.max(1, Number(requirement?.amount) || group.slots.length) * state.servings;
      count.textContent = `x${group.slots.length}/${needed}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.removeInputKey = group.key;
      remove.setAttribute("aria-label", ui("main.smelting.removeInput", "Remove Input"));
      remove.textContent = "×";
      bay.append(number, icon, name, count, remove);
      return bay;
    });
    while (bays.length < INPUT_GROUP_LIMIT) {
      const bay = document.createElement("article");
      bay.className = "nice-smelting-input-bay empty";
      const number = document.createElement("span");
      number.textContent = String(bays.length + 1);
      const plus = document.createElement("i");
      plus.textContent = "+";
      bay.append(number, plus);
      bays.push(bay);
    }
    elements.smeltingInputSlot.replaceChildren(...bays);
  }

  function renderFuelSlot(slot, fuel, recipe) {
    if (!elements.smeltingFuelSlot) return;
    elements.smeltingFuelSlot.replaceChildren();
    const requiresFuel = smeltingRecipeRequiresFuel(recipe);
    elements.smeltingFuelSlot.classList.toggle("ambient", !requiresFuel);
    elements.smeltingFuelSlot.classList.toggle("filled", Boolean(slot));
    if (!requiresFuel) {
      const ambient = document.createElement("i");
      ambient.className = "nice-smelting-ambient-process";
      const label = document.createElement("small");
      label.textContent = ui("main.smelting.noFuelRequired", "No fuel required");
      elements.smeltingFuelSlot.append(ambient, label);
      return;
    }
    if (!slot || !fuel) {
      const flame = document.createElement("i");
      flame.className = "nice-smelting-empty-flame";
      const label = document.createElement("small");
      label.textContent = ui("main.smelting.statusNoFuel", "Add compatible fuel.");
      elements.smeltingFuelSlot.append(flame, label);
      return;
    }
    const icon = itemIcon(slot, 52);
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = slotLabel(slot);
    const detail = document.createElement("small");
    detail.textContent = fuelMeta(fuel);
    copy.append(name, detail);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.removeFuel = "true";
    remove.setAttribute("aria-label", ui("main.smelting.removeFuel", "Remove Fuel"));
    remove.textContent = "×";
    elements.smeltingFuelSlot.append(icon, copy, remove);
  }

  function renderOutput(view) {
    if (!elements.smeltingOutput) return;
    elements.smeltingOutput.replaceChildren();
    const label = document.createElement("span");
    label.className = "nice-smelting-output-label";
    label.textContent = ui("main.smelting.output", "Output");
    if (!view.recipe) {
      const empty = document.createElement("i");
      empty.textContent = "?";
      elements.smeltingOutput.append(label, empty);
      return;
    }
    const icon = itemIcon(outputPreviewItem(view.recipe), 68);
    const name = document.createElement("strong");
    name.textContent = materialName(view.recipe.id);
    const count = document.createElement("b");
    count.textContent = `x${Math.max(1, Number(view.recipe.yieldCount) || 1) * state.servings}`;
    const grade = document.createElement("small");
    grade.textContent = `${gradeLabel(view.properties.grade)} · ${view.properties.purity}/100`;
    elements.smeltingOutput.append(label, icon, name, grade, count);
  }

  function renderCoreLabel(view) {
    if (!elements.smeltingCoreLabel) return;
    if (state.running) {
      elements.smeltingCoreLabel.textContent = ui("main.smelting.submitting", "Submitting on-chain...");
      return;
    }
    if (state.complete) {
      elements.smeltingCoreLabel.textContent = ui("main.smelting.submitCompleteShort", "Confirmed on-chain");
      return;
    }
    if (view.ready) {
      elements.smeltingCoreLabel.textContent = smeltingRecipeRequiresFuel(view.recipe)
        ? ui("main.smelting.heatMet", "Tier {tier} met", { tier: view.recipe.requiredHeatTier })
        : ui("main.smelting.processReady", "Process ready");
      return;
    }
    elements.smeltingCoreLabel.textContent = ui("main.smelting.statusIdle", "Select input and fuel.");
  }

  function renderRecipeDetails(force) {
    if (!elements.smeltingRecipeDetails) return;
    const view = selectedRecipeView();
    const recipe = view.recipe;
    if (!recipe) {
      elements.smeltingRecipeDetails.replaceChildren(emptyState("main.smelting.noRecipeMatch", "No public recipe match."));
      return;
    }
    const signature = [
      document.documentElement.lang,
      recipe.id,
      state.servings,
      state.inputSlotIds.join(","),
      state.fuelSlotId,
    ].join("|");
    if (!force && signatures.details === signature) return;
    signatures.details = signature;
    const head = document.createElement("header");
    head.className = "nice-smelting-details-head";
    const titleWrap = document.createElement("span");
    const eyebrow = document.createElement("small");
    eyebrow.textContent = ui("main.smelting.recipeDetails", "Recipe Details");
    const title = document.createElement("strong");
    title.textContent = materialName(recipe.id);
    titleWrap.append(eyebrow, title);
    const grade = document.createElement("b");
    grade.textContent = gradeLabel(view.properties.grade);
    head.append(titleWrap, grade);

    const body = document.createElement("div");
    body.className = "nice-smelting-details-body";
    const recipeGrid = document.createElement("div");
    recipeGrid.className = "nice-smelting-details-recipe";
    const inputs = document.createElement("section");
    const inputsTitle = document.createElement("strong");
    inputsTitle.textContent = ui("main.smelting.requiredInputs", "Required Inputs");
    inputs.append(inputsTitle);
    recipeRequirements(recipe).forEach((requirement) => {
      const row = document.createElement("span");
      row.append(itemIcon(previewItemForInputKey(requirement.key), 30));
      const name = document.createElement("em");
      name.textContent = inputKeyLabel(requirement.key);
      const amount = document.createElement("b");
      amount.textContent = `x${requirement.amount * state.servings}`;
      row.append(name, amount);
      inputs.append(row);
    });
    const output = document.createElement("section");
    const outputTitle = document.createElement("strong");
    outputTitle.textContent = ui("main.smelting.output", "Output");
    const outputIcon = itemIcon(outputPreviewItem(recipe), 54);
    const outputName = document.createElement("span");
    outputName.textContent = materialName(recipe.id);
    const outputCount = document.createElement("b");
    outputCount.textContent = `x${Math.max(1, Number(recipe.yieldCount) || 1) * state.servings}`;
    output.append(outputTitle, outputIcon, outputName, outputCount);
    recipeGrid.append(inputs, output);

    const stepper = document.createElement("div");
    stepper.className = "nice-smelting-serving-stepper";
    const stepLabel = document.createElement("span");
    stepLabel.textContent = ui("main.smelting.recipeServings", "Servings");
    const minus = servingButton(-1, view.maxServings);
    const value = document.createElement("output");
    value.textContent = ui("main.smelting.recipeServingsValue", "{count}x", { count: state.servings });
    const plus = servingButton(1, view.maxServings);
    stepper.append(stepLabel, minus, value, plus);

    const heat = smeltingHeatTierByTier(recipe.requiredHeatTier);
    const processValue = smeltingRecipeRequiresFuel(recipe)
      ? `T${recipe.requiredHeatTier} · ${heat?.temperatureC || 0}°C`
      : ui("main.smelting.ambientProcess", "Ambient process · {station}", {
          station: humanize(recipe.station || recipe.processType || "workbench"),
        });
    const stats = document.createElement("div");
    stats.className = "nice-smelting-detail-stats";
    stats.append(
      detailStat(ui("main.smelting.requiredHeat", "Required heat"), processValue),
      detailStat(ui("main.smelting.outputRate", "Output rate"), `${Math.round(view.recipeYieldBps / 100)}%`),
      detailStat(ui("main.smelting.qualityScore", "Quality"), `${view.properties.qualityScore}/100`),
      detailStat(ui("main.smelting.purity", "Purity"), `${view.properties.purity}/100`),
    );

    const composition = document.createElement("section");
    composition.className = "nice-smelting-composition";
    const compositionTitle = document.createElement("strong");
    compositionTitle.textContent = ui("main.smelting.composition", "Composition");
    const chips = document.createElement("div");
    recipe.composition.forEach(([element, range]) => {
      const chip = document.createElement("span");
      const symbolNode = document.createElement("b");
      symbolNode.textContent = element;
      const rangeNode = document.createElement("small");
      rangeNode.textContent = range;
      chip.append(symbolNode, rangeNode);
      chips.append(chip);
    });
    composition.append(compositionTitle, chips);

    const attributes = document.createElement("section");
    attributes.className = "nice-smelting-attributes";
    const attributesTitle = document.createElement("strong");
    attributesTitle.textContent = ui("main.smelting.attributes", "Material Attributes");
    const bars = document.createElement("div");
    for (const key of SMELTING_MATERIAL_ATTRIBUTE_KEYS) {
      const value = Math.max(0, Math.min(100, Number(view.properties.attributes[key]) || 0));
      const row = document.createElement("span");
      const label = document.createElement("em");
      label.textContent = attributeLabel(key);
      const track = document.createElement("i");
      const fill = document.createElement("b");
      fill.style.width = `${value}%`;
      track.append(fill);
      const score = document.createElement("strong");
      score.textContent = String(value);
      row.append(label, track, score);
      bars.append(row);
    }
    attributes.append(attributesTitle, bars);

    const description = document.createElement("p");
    description.textContent = materialDescription(recipe);
    body.append(recipeGrid, stepper, stats, composition, attributes, description);
    elements.smeltingRecipeDetails.replaceChildren(head, body);
  }

  function servingButton(delta, maxServings) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.servingDelta = String(delta);
    button.textContent = delta > 0 ? "+" : "−";
    button.disabled = state.running
      || state.servings + delta < 1
      || state.servings + delta > Math.max(1, maxServings);
    button.setAttribute("aria-label", delta > 0
      ? ui("main.smelting.increaseServings", "Increase servings")
      : ui("main.smelting.decreaseServings", "Decrease servings"));
    return button;
  }

  function detailStat(label, value) {
    const stat = document.createElement("span");
    const name = document.createElement("small");
    name.textContent = label;
    const result = document.createElement("strong");
    result.textContent = value;
    stat.append(name, result);
    return stat;
  }

  function selectedRecipeView() {
    const slots = authoritativeSlots();
    const primaryRecipe = recipeById(state.recipeId) || null;
    const inputSlots = selectedInputSlots(slots);
    const fuelSlot = slotById(state.fuelSlotId, slots);
    const fuel = smeltingFuelForSlot(fuelSlot);
    const match = smeltingRecipeForSelectedSlots(inputSlots);
    const recipe = resolveSelectedSmeltingRecipe(primaryRecipe, match, state.servings);
    const selectedRecipeMatches = Boolean(recipe
      && match?.recipe === recipe
      && match.multiplier === state.servings);
    const requiresFuel = smeltingRecipeRequiresFuel(recipe);
    const heatReady = Boolean(recipe && (!requiresFuel || (fuel && fuel.heatTier >= recipe.requiredHeatTier)));
    const skillEffects = getSkillEffects?.() || {};
    const skillLevel = Math.max(0, Math.min(10, Math.floor(Number(skillEffects.levels?.smelting) || 0)));
    const skillOutputBps = Math.max(1, Math.min(10000, Math.floor(Number(skillEffects.smeltingOutputBps) || smeltingSkillOutputBpsForLevel(skillLevel))));
    const recipeYieldBps = recipe ? smeltingRecipeYieldBps(recipe) : 0;
    const propertyInputs = inputSlots.map((slot) => ({ ...slot, category: resourceCategory(slot) }));
    const properties = recipe
      ? deriveSmeltingMaterialProperties({
          material: recipe,
          inputSlots: propertyInputs,
          fuelSlots: fuel ? [{ ...fuelSlot, fuelTier: fuel.heatTier }] : [],
          itemId: smeltingRecipeChainIdentity(recipe).recipeId,
          sourceSeed: inputSlots.map((slot) => slot.id).join("|"),
        })
      : emptyMaterialProperties();
    return {
      slots,
      recipe,
      inputSlots,
      fuelSlot,
      fuel,
      match,
      properties,
      skillLevel,
      skillOutputBps,
      recipeYieldBps,
      requiresFuel,
      heatReady,
      ready: selectedRecipeMatches && heatReady && inputSlots.length > 0 && (!requiresFuel || Boolean(fuelSlot)),
      maxServings: recipe ? maxSmeltingRecipeServings(recipe, slots) : 0,
    };
  }

  function renderProgress() {
    const view = selectedRecipeView();
    if (elements.smeltingProgressBar) elements.smeltingProgressBar.style.width = `${Math.max(0, Math.min(100, state.progress))}%`;
    if (elements.smeltingProgressValue) elements.smeltingProgressValue.textContent = `${Math.round(state.progress)}%`;
    if (elements.smeltingStart) {
      elements.smeltingStart.disabled = state.running || !view.ready;
      elements.smeltingStart.setAttribute("aria-busy", state.running ? "true" : "false");
      const text = elements.smeltingStart.querySelector("span") || elements.smeltingStart;
      text.textContent = state.running
        ? ui("main.smelting.running", "Smelting...")
        : ui("main.smelting.start", "Start Smelting");
    }
    if (elements.smeltingStatus) elements.smeltingStatus.textContent = statusText(view);
    elements.smeltingPanel?.classList.toggle("is-running", state.running);
    elements.smeltingPanel?.classList.toggle("is-complete", state.complete);
  }

  function statusText(view) {
    if (state.result?.kind === "error") {
      return ui("main.smelting.submitFailed", "Smelting transaction failed: {reason}", { reason: state.result.reason });
    }
    if (state.complete && state.result?.signature) {
      return ui("main.smelting.submitComplete", "Smelting confirmed on-chain: {signature}", { signature: shortSignature(state.result.signature) });
    }
    if (state.running) return ui("main.smelting.submitting", "Submitting on-chain...");
    if (!view.inputSlots.length) return ui("main.smelting.statusNoInput", "Select a mined resource.");
    if (!view.match?.recipe || view.match.recipe.id !== view.recipe?.id || view.match.multiplier !== state.servings) {
      return ui("main.smelting.statusRecipeIncomplete", "Recipe candidate {recipe}: missing or extra inputs.", {
        recipe: view.recipe ? materialName(view.recipe.id) : ui("main.smelting.noRecipeName", "Unmatched batch"),
        missing: missingInputText(view.recipe, view.inputSlots),
      });
    }
    if (view.requiresFuel && !view.fuelSlot) return ui("main.smelting.statusNoFuel", "Add compatible fuel.");
    if (!view.heatReady) {
      return ui("main.smelting.statusHeatMissingMulti", "Fuel heat tier {fuel} is below required tier {required}.", {
        fuel: view.fuel?.heatTier || 0,
        required: view.recipe.requiredHeatTier,
      });
    }
    return view.requiresFuel
      ? ui("main.smelting.statusReady", "Ready to smelt on-chain.")
      : ui("main.smelting.statusReadyCold", "Ready to process on-chain without fuel.");
  }

  function missingInputText(recipe, selectedSlots) {
    if (!recipe) return ui("main.smelting.noRecipeMatch", "No public recipe match");
    const selectedCounts = new Map();
    selectedSlots.forEach((slot) => {
      const key = smeltingInputKeyForSlot(slot);
      selectedCounts.set(key, (selectedCounts.get(key) || 0) + 1);
    });
    const missing = recipeRequirements(recipe)
      .map((input) => ({ ...input, count: Math.max(0, input.amount * state.servings - (selectedCounts.get(input.key) || 0)) }))
      .filter((input) => input.count > 0)
      .map((input) => ui("main.smelting.missingInputLabel", "{amount}x {resource}", {
        amount: input.count,
        resource: inputKeyLabel(input.key),
      }));
    return missing.join(", ") || ui("main.smelting.recipePartial", "Partial match");
  }

  function handleResourceClick(event) {
    if (state.running) return;
    const action = event.target.closest("button[data-smelting-use]");
    const card = event.target.closest("[data-smelting-slot-id]");
    const slotId = action?.dataset.smeltingSlotId || card?.dataset.smeltingSlotId || "";
    const slot = slotById(slotId, authoritativeSlots());
    if (!slot) return;
    const role = action?.dataset.smeltingUse || (isSmeltingInputSlot(slot) ? "input" : isSmeltingFuelSlot(slot) ? "fuel" : "");
    if (role === "fuel" && isSmeltingFuelSlot(slot)) toggleFuel(slot.id);
    if (role === "input" && isSmeltingInputSlot(slot)) toggleInput(slot.id);
  }

  function toggleInput(slotId) {
    const index = state.inputSlotIds.indexOf(slotId);
    if (index >= 0) state.inputSlotIds.splice(index, 1);
    else if (state.inputSlotIds.length < INPUT_RECORD_LIMIT) {
      state.inputSlotIds.push(slotId);
      if (state.fuelSlotId === slotId) state.fuelSlotId = "";
    }
    state.result = null;
    state.complete = false;
    state.progress = 0;
    syncRecipeFromInputs();
    invalidateRender();
    render();
  }

  function toggleFuel(slotId) {
    state.fuelSlotId = state.fuelSlotId === slotId ? "" : slotId;
    state.inputSlotIds = state.inputSlotIds.filter((id) => id !== slotId);
    state.result = null;
    state.complete = false;
    state.progress = 0;
    invalidateRender();
    render();
  }

  function syncRecipeFromInputs() {
    const match = smeltingRecipeForSelectedSlots(selectedInputSlots(authoritativeSlots()));
    if (!match?.recipe) return;
    state.recipeId = match.recipe.id;
    state.servings = Math.max(1, match.multiplier || 1);
  }

  function handleRecipeClick(event) {
    if (state.running) return;
    const button = event.target.closest("button[data-recipe-id]");
    if (!button) return;
    const recipe = recipeById(button.dataset.recipeId);
    if (!recipe) return;
    state.recipeId = recipe.id;
    state.servings = 1;
    fillRecipe(recipe);
    setMobileSection("furnace");
  }

  function handleInputSlotClick(event) {
    if (state.running) return;
    const button = event.target.closest("button[data-remove-input-key]");
    if (!button) return;
    const key = button.dataset.removeInputKey;
    state.inputSlotIds = state.inputSlotIds.filter((id) => smeltingInputKeyForSlot(slotById(id, authoritativeSlots())) !== key);
    state.result = null;
    invalidateRender();
    render();
  }

  function handleFuelSlotClick(event) {
    if (state.running || !event.target.closest("[data-remove-fuel]")) return;
    state.fuelSlotId = "";
    state.result = null;
    invalidateRender();
    render();
  }

  function handleDetailsClick(event) {
    if (state.running) return;
    const button = event.target.closest("button[data-serving-delta]");
    if (!button) return;
    const recipe = selectedRecipeView().recipe;
    if (!recipe) return;
    const max = Math.max(1, maxSmeltingRecipeServings(recipe, authoritativeSlots()));
    state.servings = Math.max(1, Math.min(max, state.servings + Number(button.dataset.servingDelta)));
    fillRecipe(recipe);
  }

  function autoFillSelectedRecipe() {
    if (state.running) return;
    const recipe = selectedRecipeView().recipe;
    if (recipe) fillRecipe(recipe);
  }

  function fillRecipe(recipe) {
    const slots = authoritativeSlots();
    const max = Math.max(1, maxSmeltingRecipeServings(recipe, slots));
    state.servings = Math.max(1, Math.min(max, state.servings));
    const plan = smeltingRecipePlan(recipe, slots, state.servings);
    state.inputSlotIds = plan.slots.map((slot) => slot.id).slice(0, INPUT_RECORD_LIMIT);
    state.fuelSlotId = bestSmeltingFuelSlot(slots, recipe.requiredHeatTier, plan.used)?.id || "";
    state.result = null;
    state.complete = false;
    state.progress = 0;
    invalidateRender();
    render();
  }

  function clearSelection() {
    if (state.running) return;
    state.inputSlotIds = [];
    state.fuelSlotId = "";
    state.servings = 1;
    state.result = null;
    state.complete = false;
    state.progress = 0;
    invalidateRender();
    render();
  }

  function setResourceFilter(filter) {
    state.resourceFilter = ["all", "raw", "fuel"].includes(filter) ? filter : "all";
    signatures.resources = "";
    render();
  }

  function setRecipeFilter(filter) {
    state.recipeFilter = ["all", "ready", "missing", "fuel", "building"].includes(filter) ? filter : "all";
    signatures.recipes = "";
    render();
  }

  function setMobileSection(section) {
    state.mobileSection = ["backpack", "furnace", "recipes"].includes(section) ? section : "backpack";
    renderMobileSectionState();
  }

  function renderFilterState() {
    elements.smeltingPanel?.querySelectorAll("[data-smelting-resource-filter]").forEach((button) => {
      const active = button.dataset.smeltingResourceFilter === state.resourceFilter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    elements.smeltingPanel?.querySelectorAll("[data-smelting-recipe-filter]").forEach((button) => {
      const active = button.dataset.smeltingRecipeFilter === state.recipeFilter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function renderMobileSectionState() {
    if (!elements.smeltingPanel) return;
    elements.smeltingPanel.dataset.mobileSection = state.mobileSection;
    elements.smeltingPanel.querySelectorAll("[data-smelting-section]").forEach((button) => {
      const active = button.dataset.smeltingSection === state.mobileSection;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  async function startSmelting() {
    if (state.running) return;
    syncSelections();
    const view = selectedRecipeView();
    if (!view.ready) {
      render();
      return;
    }
    const snapshot = getBackpackSnapshot?.() || {};
    const chainIdentity = smeltingRecipeChainIdentity(view.recipe);
    const inputIndexes = view.inputSlots.map((slot) => slot.chainIndex);
    const fuelIndexes = view.requiresFuel ? [view.fuelSlot.chainIndex] : [];
    if (!chainIdentity.recipeId || !chainIdentity.recipeTableId || new Set([...inputIndexes, ...fuelIndexes]).size !== inputIndexes.length + fuelIndexes.length) {
      failSubmission("invalid-smelting-inputs");
      return;
    }

    clearTimeout(state.resetTimer);
    state.running = true;
    state.complete = false;
    state.progress = 2;
    state.startedAt = performance.now();
    state.result = null;
    invalidateRender();
    render();
    startSmeltingVisuals();

    try {
      const chainModule = await loadPlayChainModule();
      if (typeof chainModule.executeSmeltingOnChain !== "function") throw new Error("smelting-submit-unavailable");
      const result = await chainModule.executeSmeltingOnChain({
        recipeId: chainIdentity.recipeId,
        recipeTableId: chainIdentity.recipeTableId,
        inputIndexes,
        fuelIndexes,
        batchMultiplier: state.servings,
        backpackAddress: snapshot.backpackAddress || null,
      });
      if (!result?.submitted) {
        const error = new Error(String(result?.reason || "smelting-not-submitted"));
        error.result = result;
        throw error;
      }
      state.running = false;
      state.complete = true;
      state.progress = 100;
      state.result = { kind: "success", signature: String(result.signature || ""), result };
      const refreshResult = await refreshBackpack({
        previousUpdatedSlot: snapshot.updatedSlot,
        force: true,
      });
      if (!refreshResult?.ok) {
        console.warn("[NiceChunk Smelting] Transaction confirmed but PDA refresh is pending.", refreshResult);
      }
      state.inputSlotIds = [];
      state.fuelSlotId = "";
      state.servings = 1;
      invalidateRender();
      onChanged();
      onStatus(ui("main.smelting.submitComplete", "Smelting confirmed on-chain: {signature}", {
        signature: shortSignature(result.signature),
      }));
      render({ force: true });
      state.resetTimer = setTimeout(() => {
        state.complete = false;
        state.progress = 0;
        state.result = null;
        invalidateRender();
        render();
      }, COMPLETE_HOLD_MS);
    } catch (error) {
      const reason = readableError(error);
      console.error("[NiceChunk Smelting Submission Failed]", {
        recipeId: chainIdentity.recipeId,
        recipeTableId: chainIdentity.recipeTableId,
        inputIndexes,
        fuelIndexes,
        batchMultiplier: state.servings,
        reason,
        result: error?.result || null,
        logs: error?.logs || error?.transactionLogs || null,
        error,
      });
      failSubmission(reason);
    }
  }

  function failSubmission(reason) {
    state.running = false;
    state.complete = false;
    state.progress = 0;
    state.result = { kind: "error", reason: String(reason || "smelting-failed") };
    invalidateRender();
    render({ force: true });
    onStatus(ui("main.smelting.submitFailed", "Smelting transaction failed: {reason}", { reason: state.result.reason }));
  }

  function ensureSmeltingCore() {
    if (smeltingCore) return smeltingCore;
    if (!elements.smeltingCoreVisual || typeof document === "undefined") return null;
    try {
      smeltingCore = createSmeltingCoreRenderer(elements.smeltingCoreVisual, {
        className: "nice-smelting-core-canvas",
        maxPixelRatio: 1,
      });
    } catch (error) {
      console.warn("NiceChunk smelting core unavailable:", error);
      smeltingCore = null;
    }
    return smeltingCore;
  }

  function startSmeltingVisuals() {
    if (state.visualFrame || typeof window === "undefined" || !isOpen()) return;
    const frame = (timeMs) => {
      if (!isOpen()) {
        state.visualFrame = 0;
        return;
      }
      if (state.running) {
        const elapsed = Math.max(0, timeMs - state.startedAt);
        state.progress = Math.min(92, 2 + 90 * (1 - Math.exp(-elapsed / 5200)));
        if (elements.smeltingProgressBar) elements.smeltingProgressBar.style.width = `${state.progress}%`;
        if (elements.smeltingProgressValue) elements.smeltingProgressValue.textContent = `${Math.round(state.progress)}%`;
      }
      if (timeMs - state.lastVisualAt >= CORE_FRAME_INTERVAL_MS) {
        state.lastVisualAt = timeMs;
        renderSmeltingCoreFrame(timeMs);
      }
      state.visualFrame = window.requestAnimationFrame(frame);
    };
    state.visualFrame = window.requestAnimationFrame(frame);
  }

  function stopSmeltingVisuals() {
    if (!state.visualFrame || typeof window === "undefined") return;
    window.cancelAnimationFrame(state.visualFrame);
    state.visualFrame = 0;
    state.lastVisualAt = 0;
  }

  function releaseDynamicViews() {
    const containers = [
      elements.smeltingResourceGrid,
      elements.smeltingRecipeList,
      elements.smeltingInputSlot,
      elements.smeltingFuelSlot,
      elements.smeltingOutput,
      elements.smeltingRecipeDetails,
    ];
    for (const container of containers) container?.replaceChildren();
    iconCache.clear();
    invalidateRender();
  }

  function renderSmeltingCoreFrame(timeMs) {
    const renderer = ensureSmeltingCore();
    if (!renderer) return;
    const heatTier = coreVisualState.heatTier;
    renderer.render({
      timeMs,
      intensity: state.running ? Math.min(1.15, 0.45 + heatTier * 0.13 + state.progress * 0.003) : coreVisualState.ready ? 0.34 + heatTier * 0.1 : 0.08,
      heatTier,
      progress: state.progress / 100,
      running: state.running,
    });
  }

  function itemIcon(item, size) {
    const key = iconKey(item, size);
    let source = iconCache.get(key);
    if (!source) {
      source = createVoxelItemIconCanvas(item || {}, { size });
      iconCache.set(key, source);
    }
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    canvas.className = "nice-smelting-item-icon";
    canvas.getContext("2d")?.drawImage(source, 0, 0, size, size);
    return canvas;
  }

  function iconKey(item, size) {
    return [
      size,
      item?.kind || "",
      item?.blockId ?? "",
      item?.resourceId ?? "",
      item?.materialId || "",
      item?.itemCode ?? "",
      item?.decorationId ?? "",
      item?.decorationVariantHash ?? "",
      Array.isArray(item?.previewColor) ? item.previewColor.join(",") : "",
    ].join(":");
  }

  function previewItemForInputKey(key) {
    const materialId = smeltingMaterialIdForInputKey(key);
    if (materialId) return smeltingMaterialPreviewItem(materialId);
    return { kind: "resource", blockId: smeltingRawKeyBlockId(key) };
  }

  function outputPreviewItem(recipe) {
    return smeltingMaterialPreviewItem(recipe, { label: materialName(recipe.id) });
  }

  function groupSelectedInputs(slots, recipe) {
    const groups = new Map();
    const order = recipeRequirements(recipe).map((input) => input.key);
    slots.forEach((slot) => {
      const key = smeltingInputKeyForSlot(slot);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(slot);
    });
    return [...groups.entries()]
      .map(([key, selected]) => ({ key, slots: selected }))
      .sort((a, b) => {
        const aIndex = order.indexOf(a.key);
        const bIndex = order.indexOf(b.key);
        return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex);
      });
  }

  function selectedInputSlots(slots = authoritativeSlots()) {
    const byId = new Map(slots.map((slot) => [slot.id, slot]));
    return state.inputSlotIds.map((id) => byId.get(id)).filter(Boolean);
  }

  function slotById(id, slots = authoritativeSlots()) {
    return slots.find((slot) => slot.id === id) || null;
  }

  function recipeById(id) {
    return SMELTING_RECIPES.find((recipe) => recipe.id === id) || null;
  }

  function slotLabel(slot) {
    const material = smeltingMaterialForSlot(slot);
    if (material) return materialName(material.id);
    try {
      return voxelItemLabel?.(slot) || resourceName?.(slot?.resourceId) || inputKeyLabel(smeltingInputKeyForSlot(slot));
    } catch {
      return inputKeyLabel(smeltingInputKeyForSlot(slot));
    }
  }

  function inputKeyLabel(key) {
    const materialId = smeltingMaterialIdForInputKey(key);
    if (materialId) return materialName(materialId);
    const translationKey = `main.block.${key}`;
    const translated = t(translationKey);
    return translated === translationKey ? humanize(key || "resource") : translated;
  }

  function materialName(materialId) {
    const key = `resourceAtlas.material.item.${materialId}.name`;
    const translated = t(key);
    return translated === key ? humanize(materialId) : translated;
  }

  function materialDescription(recipe) {
    const key = `resourceAtlas.material.item.${recipe.id}.description`;
    const translated = t(key);
    if (translated !== key) return translated;
    return ui("main.smelting.outputDescription", "A forge-ready material produced through the public NiceChunk recipe table.", {
      resource: materialName(recipe.id),
    });
  }

  function attributeLabel(key) {
    const translationKey = `main.materialAttributes.${key}`;
    const translated = t(translationKey);
    return translated === translationKey ? humanize(key) : translated;
  }

  function gradeLabel(grade) {
    const key = `main.materialGrade.${grade}`;
    const translated = t(key);
    return translated === key ? humanize(grade) : translated;
  }

  function fuelMeta(fuel) {
    const tier = smeltingHeatTierByTier(fuel.heatTier);
    return `${ui("main.smelting.fuelHeat", "Heat tier {tier}", { tier: fuel.heatTier })} · ${tier?.temperatureC || 0}°C · ${fuel.burnSeconds || 0}s`;
  }

  function resourceCategory(slot) {
    const key = smeltingInputKeyForSlot(slot);
    if (["trunk", "dryGrass", "leaves", "moss", "reed", "vine", "pineTrunk"].includes(key)) return "organic";
    if (["toxicWater", "lava"].includes(key)) return "fluids";
    return "minerals";
  }

  function emptyMaterialProperties() {
    return {
      attributes: Object.fromEntries(SMELTING_MATERIAL_ATTRIBUTE_KEYS.map((key) => [key, 0])),
      purity: 0,
      grade: "crude",
      qualityScore: 0,
    };
  }

  function emptyState(key, fallback) {
    const stateNode = document.createElement("p");
    stateNode.className = "nice-smelting-empty";
    stateNode.textContent = ui(key, fallback);
    return stateNode;
  }

  function symbol(value) {
    const node = document.createElement("i");
    node.textContent = value;
    return node;
  }

  function slotSignature(slot) {
    return [
      slot.id,
      slot.chainIndex,
      slot.kind,
      slot.blockId,
      slot.resourceId,
      slot.materialId,
      slot.itemCode,
      slot.count,
      slot.volumeMm3,
    ].join(":");
  }

  function invalidateRender() {
    signatures.resources = "";
    signatures.recipes = "";
    signatures.slots = "";
    signatures.details = "";
  }

  return api;
}

function ui(key, fallback, params = {}) {
  const translated = t(key, params);
  if (translated !== key) return translated;
  return String(fallback || key).replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? `{${name}}`));
}

function humanize(value) {
  return String(value || "material")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function shortSignature(signature) {
  const value = String(signature || "");
  return value.length <= 14 ? value : `${value.slice(0, 6)}...${value.slice(-6)}`;
}

function readableError(error) {
  const message = String(error?.message || error?.reason || error || "unknown error");
  return message.length > 220 ? `${message.slice(0, 217)}...` : message;
}
