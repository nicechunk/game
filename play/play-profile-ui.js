import { DEFAULT_PICKAXE_DURABILITY } from "./game-state.js";
import { escapeHtml, shortAddress } from "./play-ui-format.js";
import { createAvatarPreviewRenderer } from "/chunk.js/play.js";
import { t } from "/src/i18n.js";
import {
  PLAYER_SKILL_DEFINITIONS,
  PROFILE_SKILL_MAX_LEVEL,
  buildProfileSkillState,
  formatProfileSkillXp,
  profileSkillEffectiveLevel,
  profileSkillExperienceProgress,
  profileSkillExperienceRequirement,
} from "./play-profile-skills.js";

export function createPlayProfileUi({
  elements,
  gameState,
  createVoxelItemIconCanvas,
  resourceName = (id) => `R${id}`,
  voxelItemLabel = (slot) => slot?.label || slot?.itemId || "Item",
  getPlayerPosition,
  getPendingCount,
  getChainSnapshot = () => null,
  getAvatarEquipment = () => ({ rightHand: "pickaxe" }),
} = {}) {
  let selectedProfileTab = "attributes";
  let selectedSkillId = PLAYER_SKILL_DEFINITIONS[0]?.id ?? "";
  let selectedEquipmentId = "mainHand";
  let bound = false;
  let supportingActionsBound = false;
  let avatarRotationBound = false;
  let avatarPreview = null;
  let avatarPreviewFrame = 0;
  let pendingAvatarPreview = null;
  let avatarPreviewResizeObserver = null;
  let avatarPreviewYaw = Math.PI;
  let avatarDrag = null;
  let walletCopyResetTimer = 0;

  bindTabs();
  bindSupportingActions();
  bindAvatarPreviewRotation();

  return {
    render,
    openPanel,
    closePanel,
    togglePanel,
  };

  function render() {
    if (elements.profilePanel?.hidden) return;
    bindTabs();
    bindSupportingActions();
    bindAvatarPreviewRotation();
    const profile = gameState.playerProfile || {};
    const chain = getChainSnapshot?.() ?? {};
    const owner = chain.walletAddress || profile.name || "guest";
    const skillState = buildProfileSkillState({ owner, profile, chainXp: chain.playerSkillXp || chain.skillXp || null });
    renderAvatarPreview(profile, chain);
    renderOverview(profile, chain, skillState);
    renderSettings(chain);
    renderSkills(skillState);
    renderEquipment(chain);
    setProfileTab(selectedProfileTab, { renderPanel: false });
  }

  function bindSupportingActions() {
    if (supportingActionsBound) return;
    if (!elements.profileViewSkills && !elements.profileWalletCopy) return;
    supportingActionsBound = true;
    elements.profileViewSkills?.addEventListener("click", () => setProfileTab("skills"));
    elements.profileWalletCopy?.addEventListener("click", async () => {
      const address = elements.profileWalletCopy?.dataset.walletAddress || "";
      if (!address) return;
      try {
        await navigator.clipboard.writeText(address);
        elements.profileWalletCopy.textContent = ui("main.profile.copied", "Copied");
        clearTimeout(walletCopyResetTimer);
        walletCopyResetTimer = window.setTimeout(() => {
          if (elements.profileWalletCopy) elements.profileWalletCopy.textContent = ui("main.profile.copy", "Copy");
        }, 1600);
      } catch {
        elements.profileWalletCopy.textContent = ui("main.profile.copyFailed", "Copy failed");
      }
    });
  }

  function bindAvatarPreviewRotation() {
    const target = elements.profileAvatarPreview;
    if (avatarRotationBound || !target) return;
    avatarRotationBound = true;
    target.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest?.("button")) return;
      avatarDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startYaw: avatarPreviewYaw,
      };
      target.classList.add("is-rotating");
      target.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    target.addEventListener("pointermove", (event) => {
      if (!avatarDrag || avatarDrag.pointerId !== event.pointerId) return;
      avatarPreviewYaw = normalizeYaw(avatarDrag.startYaw + (event.clientX - avatarDrag.startX) * 0.012);
      startAvatarPreview();
      event.preventDefault();
    });
    const finishRotation = (event) => {
      if (!avatarDrag || avatarDrag.pointerId !== event.pointerId) return;
      avatarDrag = null;
      target.classList.remove("is-rotating");
      if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId);
    };
    target.addEventListener("pointerup", finishRotation);
    target.addEventListener("pointercancel", finishRotation);
    target.addEventListener("lostpointercapture", () => {
      avatarDrag = null;
      target.classList.remove("is-rotating");
    });
  }

  function renderAvatarPreview(profile, chain) {
    if (!elements.profileAvatarPreview) return;
    const identity = chain.chainPlayer?.identity || {};
    const appearance = chain.chainPlayer?.appearance || {};
    const name = identity.name || profile.name || "Local Miner";
    const title = identity.title || appearance.title || profile.title || "Explorer";
    const code = appearance.modelCode || profile.modelCode || "NCM:peasant_guy:v1";
    if (elements.profileAvatarPreviewName) elements.profileAvatarPreviewName.textContent = name;
    if (elements.profileAvatarPreviewMeta) elements.profileAvatarPreviewMeta.textContent = title;
    if (!elements.profilePanel || elements.profilePanel.hidden || selectedProfileTab !== "attributes") return;
    scheduleAvatarPreview({
      modelCode: code,
      equipment: getAvatarEquipment?.() ?? { rightHand: "pickaxe" },
    });
  }

  function renderOverview(profile, chain, skillState) {
    const [px, , pz] = getPlayerPosition?.() ?? [0, 0, 0];
    const chainBackpack = chain.chainBackpack || {};
    const levels = effectiveSkillLevels(skillState);
    const totalSkillLevels = Object.values(levels).reduce((sum, value) => sum + value, 0);
    const level = Math.max(1, 1 + Math.floor(totalSkillLevels / Math.max(1, PLAYER_SKILL_DEFINITIONS.length)));
    const reputation = Math.max(0,
      Number(profile.confirmedMines || 0) * 5
      + Number(profile.confirmedPlacements || 0) * 3
      + Number(profile.materialsSmelted || 0) * 4,
    );
    const chunkX = Math.floor(px / 16);
    const chunkZ = Math.floor(pz / 16);
    const regionX = Math.floor(chunkX / 100);
    const regionZ = Math.floor(chunkZ / 100);
    const backpackValue = chainBackpack.backpackAddress
      ? `${chainBackpack.syncedSlots || 0} / ${chainBackpack.capacity || 0}`
      : ui("main.profile.noBackpack", "No backpack");
    const balance = chain.walletAddress && Number.isFinite(Number(chain.walletBalanceSol))
      ? `${formatSol(chain.walletBalanceSol)} SOL`
      : ui("main.profile.balanceUnavailable", "0 SOL");

    setText(elements.profileIdentityBalance, balance);
    setText(elements.profileLevelValue, String(level));
    setText(elements.profileReputationValue, reputation.toLocaleString());
    setText(elements.profileRegionValue, `NiceChunk / ${regionX}, ${regionZ}`);
    setText(elements.profileBackpackValue, backpackValue);
    renderStats(skillState);
  }

  function renderSettings(chain) {
    const walletAddress = String(chain.walletAddress || "");
    setText(elements.profileWalletValue, walletAddress || ui("main.profile.notConnected", "Not connected"));
    if (elements.profileWalletCopy) {
      elements.profileWalletCopy.disabled = !walletAddress;
      elements.profileWalletCopy.dataset.walletAddress = walletAddress;
    }
    if (elements.profileWalletHint) {
      elements.profileWalletHint.textContent = walletAddress
        ? ui("main.profile.walletConnectedHint", "This wallet is active for on-chain game actions.")
        : ui("main.profile.walletDisconnectedHint", "Connect a wallet to use on-chain game features.");
    }
    if (elements.profileLogoutButton) elements.profileLogoutButton.disabled = !walletAddress;
  }

  function renderStats(skillState) {
    const levels = effectiveSkillLevels(skillState);
    const stats = [
      { id: "gathering", label: ui("main.profile.statGathering", "Gathering"), value: `${Math.min(100, 10 + levels.precisionGathering * 10)}%` },
      { id: "carry", label: ui("main.profile.statCarry", "Carry"), value: `${30 + levels.burden * 10} kg` },
      { id: "smelting", label: ui("main.profile.statSmelting", "Smelting"), value: `${Math.min(100, 70 + levels.smelting * 3)}%` },
      { id: "speed", label: ui("main.profile.statSpeed", "Speed"), value: `${100 + levels.swiftness * 3}%` },
      { id: "strength", label: ui("main.profile.statStrength", "Strength"), value: `${8 + levels.strength * 4} kg` },
      { id: "crafting", label: ui("main.profile.statCrafting", "Crafting"), value: `T${1 + Math.floor(levels.craftsmanship / 2)}` },
    ];
    if (elements.profileGrid) {
      elements.profileGrid.replaceChildren(...stats.map(profileStatItem));
    }
  }

  function effectiveSkillLevels(skillState = {}) {
    const result = {};
    for (const skill of PLAYER_SKILL_DEFINITIONS) {
      result[skill.id] = profileSkillEffectiveLevel(skillState.levels || {}, skill, skillState.xpBySkill || {});
    }
    return result;
  }

  function positionSyncLabel(sync = {}) {
    if (sync.saving) return "saving";
    if (sync.queued) return "queued";
    if (sync.lastSignature) {
      const saved = sync.lastSavedPosition;
      const coord = saved ? ` @ ${saved.x},${saved.y},${saved.z}` : "";
      return `${shortAddress(sync.lastSignature)}${coord}`;
    }
    if (sync.lastError) return sync.lastError;
    if (sync.lastReason === "player-profile-uninitialized") return "profile not created";
    if (sync.lastReason === "wallet-unavailable") return "wallet needed";
    return "idle";
  }

  function profileStatItem({ id, label, value }) {
    const item = document.createElement("div");
    item.className = "profile-item";
    item.dataset.profileStat = id;
    item.innerHTML = `${profileStatSvg(id)}<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`;
    return item;
  }

  function renderSkills(skillState) {
    if (!elements.profileSkillsGrid) return;
    const previousScrollTop = elements.profileSkillsGrid.scrollTop;
    const previousScrollLeft = elements.profileSkillsGrid.scrollLeft;
    if (!PLAYER_SKILL_DEFINITIONS.some((skill) => skill.id === selectedSkillId)) {
      selectedSkillId = PLAYER_SKILL_DEFINITIONS[0]?.id ?? "";
    }
    const { levels, xpBySkill } = skillState;
    const cards = [];
    for (const skill of PLAYER_SKILL_DEFINITIONS) {
      const level = profileSkillEffectiveLevel(levels, skill, xpBySkill);
      const xpProgress = profileSkillExperienceProgress(skill, level, xpBySkill);
      const copy = profileSkillCopy(skill, level);
      const selected = skill.id === selectedSkillId;
      cards.push(skillCard(skill, copy, level, xpProgress, selected, () => selectSkill(skill, skillState)));
      if (selected) renderSkillDetail(skill, copy, level, copy.metrics, xpProgress);
    }
    elements.profileSkillsGrid.replaceChildren(...cards);
    elements.profileSkillsGrid.scrollTop = previousScrollTop;
    elements.profileSkillsGrid.scrollLeft = previousScrollLeft;
  }

  function selectSkill(skill, skillState) {
    if (!skill || selectedSkillId === skill.id) return;
    selectedSkillId = skill.id;
    for (const card of elements.profileSkillsGrid?.querySelectorAll("[data-profile-skill]") || []) {
      const selected = card.dataset.profileSkill === selectedSkillId;
      card.classList.toggle("active", selected);
      card.setAttribute("aria-pressed", String(selected));
    }
    const level = profileSkillEffectiveLevel(skillState.levels, skill, skillState.xpBySkill);
    const xpProgress = profileSkillExperienceProgress(skill, level, skillState.xpBySkill);
    const copy = profileSkillCopy(skill, level);
    renderSkillDetail(skill, copy, level, copy.metrics, xpProgress);
  }

  function skillCard(skill, copy, level, xpProgress, selected, onSelect) {
    const card = document.createElement("button");
    card.className = "profile-skill-card";
    card.type = "button";
    card.dataset.profileSkill = skill.id;
    card.dataset.skillTone = skill.tone;
    card.classList.toggle("active", selected);
    card.setAttribute("aria-pressed", String(selected));
    card.addEventListener("click", onSelect);

    const head = document.createElement("div");
    head.className = "profile-skill-card-head";
    head.append(createProfileSkillIcon(skill));

    const title = document.createElement("div");
    title.className = "profile-skill-title";
    const name = document.createElement("h3");
    name.textContent = copy.name;
    const levelLabel = document.createElement("span");
    levelLabel.textContent = `${ui("main.profile.skillLevel", "Lv. {level}/{max}", { level, max: PROFILE_SKILL_MAX_LEVEL })} · ${profileXpLabel(level, xpProgress)}`;
    title.append(name, levelLabel);
    head.append(title);

    const progress = document.createElement("div");
    progress.className = "profile-skill-progress";
    const fill = document.createElement("span");
    fill.style.width = `${Math.max(4, Math.min(100, (level / PROFILE_SKILL_MAX_LEVEL) * 100))}%`;
    progress.append(fill);

    card.append(head, progress);
    return card;
  }

  function renderSkillDetail(skill, copy, level, metrics, xpProgress) {
    if (!elements.profileSkillDetail) return;
    elements.profileSkillDetail.hidden = false;
    elements.profileSkillDetail.dataset.skillTone = skill.tone;
    elements.profileSkillDetail.replaceChildren();

    const header = document.createElement("header");
    header.className = "profile-skill-detail-header";
    header.append(createProfileSkillIcon(skill));
    const titleWrap = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = copy.name;
    const levelLabel = document.createElement("span");
    levelLabel.textContent = ui("main.profile.skillLevel", "Lv. {level}/{max}", { level, max: PROFILE_SKILL_MAX_LEVEL });
    const xpLabel = document.createElement("small");
    xpLabel.textContent = profileXpLabel(level, xpProgress);
    titleWrap.append(title, levelLabel, xpLabel);
    header.append(titleWrap);

    const description = document.createElement("p");
    description.className = "profile-skill-detail-description";
    description.textContent = copy.description;

    const progress = document.createElement("div");
    progress.className = "profile-skill-progress profile-skill-detail-progress";
    const progressFill = document.createElement("span");
    progressFill.style.width = `${Math.round(xpProgress.ratio * 100)}%`;
    progress.append(progressFill);

    const metricsGrid = document.createElement("div");
    metricsGrid.className = "profile-skill-detail-metrics";
    appendSkillMetric(metricsGrid, ui("main.profile.skillCurrent", "Current"), metrics.current, "profile-skill-current");
    appendSkillMetric(
      metricsGrid,
      level >= PROFILE_SKILL_MAX_LEVEL ? ui("main.profile.skillMaxed", "Max level") : ui("main.profile.skillNext", "Next"),
      level >= PROFILE_SKILL_MAX_LEVEL ? ui("main.profile.skillMaxed", "Max level") : metrics.next,
    );
    appendSkillMetric(metricsGrid, ui("main.profile.skillCap", "Cap"), metrics.max);
    appendSkillMetric(metricsGrid, ui("main.profile.skillFormula", "Rule"), metrics.formula, "profile-skill-formula");

    const xpPanel = document.createElement("section");
    xpPanel.className = "profile-skill-xp-panel";
    const xpTitle = document.createElement("h4");
    xpTitle.textContent = ui("main.profile.skillXpTitle", "Experience");
    const xpSource = document.createElement("p");
    xpSource.textContent = copy.xpSource;
    const xpTierTitle = document.createElement("strong");
    xpTierTitle.textContent = ui("main.profile.skillXpTiers", "Upgrade XP tiers");
    const tiers = document.createElement("div");
    tiers.className = "profile-skill-xp-tiers";
    for (let targetLevel = 1; targetLevel <= PROFILE_SKILL_MAX_LEVEL; targetLevel += 1) {
      const previousLevel = Math.max(0, Math.min(PROFILE_SKILL_MAX_LEVEL - 1, targetLevel - 1));
      const tier = document.createElement("span");
      tier.textContent = ui("main.profile.skillXpTier", "Lv.{level}: {xp} XP", {
        level: targetLevel,
        xp: formatProfileSkillXp(profileSkillExperienceRequirement(skill, previousLevel)),
      });
      tiers.append(tier);
    }
    xpPanel.append(xpTitle, xpSource, xpTierTitle, tiers);

    elements.profileSkillDetail.append(header, description, progress, metricsGrid, xpPanel);
  }

  function appendSkillMetric(parent, labelText, valueText, className = "") {
    const item = document.createElement("div");
    item.className = `profile-skill-metric ${className}`.trim();
    const label = document.createElement("span");
    label.textContent = labelText;
    const value = document.createElement("strong");
    value.textContent = valueText;
    item.append(label, value);
    parent.append(item);
  }

  function profileSkillCopy(skill, level) {
    const base = `main.profile.skills.${skill.id}`;
    const fallbackMetrics = skill.metrics(level);
    const currentParams = skillMetricParams(skill.id, level);
    const nextParams = skillMetricParams(skill.id, Math.min(PROFILE_SKILL_MAX_LEVEL, level + 1));
    return {
      name: ui(`${base}.name`, skill.name),
      description: ui(`${base}.description`, skill.description),
      xpSource: ui(`${base}.xpSource`, skill.xpSource),
      metrics: {
        current: ui(`${base}.current`, fallbackMetrics.current, currentParams),
        next: ui(`${base}.next`, fallbackMetrics.next, nextParams),
        max: ui(`${base}.max`, fallbackMetrics.max),
        formula: ui(`${base}.formula`, fallbackMetrics.formula),
      },
    };
  }

  function skillMetricParams(skillId, level) {
    if (skillId === "precisionGathering") {
      const percent = Math.min(100, 10 + level * 10);
      return { percent, liters: formatDecimal(percent / 100, 2) };
    }
    if (skillId === "burden") return { kg: 30 + level * 10 };
    if (skillId === "smelting") return { yieldPercent: Math.min(100, 70 + level * 3), lossPercent: Math.max(0, 30 - level * 3) };
    if (skillId === "forging") return { bonus: level * 5 };
    if (skillId === "craftsmanship") return { tier: 1 + Math.floor(level / 2) };
    if (skillId === "swiftness") return { speed: 100 + level * 3 };
    if (skillId === "exploration") return { chance: level * 10 };
    if (skillId === "stamina") return { reduction: level * 4 };
    if (skillId === "strength") return { kg: 8 + level * 4 };
    if (skillId === "appraisal") return { traits: 2 + level };
    return {};
  }

  function profileXpLabel(level, xpProgress) {
    return level >= PROFILE_SKILL_MAX_LEVEL
      ? ui("main.profile.skillXpMax", "Total XP {xp}", { xp: formatProfileSkillXp(xpProgress.total) })
      : ui("main.profile.skillXpProgress", "XP {current}/{required}", {
        current: formatProfileSkillXp(xpProgress.current),
        required: formatProfileSkillXp(xpProgress.required),
      });
  }

  function renderEquipment(chain) {
    const entries = profileEquipmentEntries(chain);
    if (!entries.some((entry) => entry.id === selectedEquipmentId)) selectedEquipmentId = "mainHand";
    const selected = entries.find((entry) => entry.id === selectedEquipmentId) || entries[0];
    if (elements.profileEquipmentList) {
      elements.profileEquipmentList.replaceChildren(...entries.map(equipmentSlotButton));
    }
    if (elements.profileEquipmentBrowserList) {
      elements.profileEquipmentBrowserList.replaceChildren(...entries.map(equipmentBrowserItem));
    }
    renderEquipmentDetail(elements.equipmentPanel, selected, chain);
    renderEquipmentDetail(elements.profileEquipmentBrowserDetail, selected, chain);
  }

  function profileEquipmentEntries(chain) {
    const empty = (id, key, fallback, { locked = false } = {}) => ({
      id,
      name: ui(`main.profile.equipment.${key}`, fallback),
      value: locked ? ui("main.profile.equipment.locked", "Locked") : ui("main.profile.equipment.emptySlot", "Empty"),
      detail: locked
        ? ui("main.profile.equipment.lockedDetail", "This equipment slot has not been unlocked.")
        : ui("main.profile.equipment.emptySlotDetail", "No equipment assigned to this slot."),
      slot: null,
      locked,
      rarity: locked ? ui("main.profile.equipment.locked", "Locked") : ui("main.profile.equipment.emptySlot", "Empty"),
      stats: [],
    });
    const selectedSlot = gameState.hotbarSlots?.[gameState.selectedHotbarSlot] ?? null;
    const selectedItem = selectedSlot ? { ...(gameState.hotbarItems?.[selectedSlot.itemId] || {}), ...selectedSlot } : null;
    const chainBackpack = chain.chainBackpack || {};
    const backpackValue = chainBackpack.backpackAddress
      ? `${shortAddress(chainBackpack.backpackAddress)} · ${chainBackpack.syncedSlots || 0}/${chainBackpack.capacity || 0}`
      : ui("main.profile.noBackpack", "No backpack");
    const mainHand = {
      id: "mainHand",
      name: ui("main.profile.equipment.mainHand", "Main Hand"),
      value: selectedItem ? voxelItemLabel(selectedItem) : ui("main.profile.equipment.emptySlot", "Empty"),
      detail: selectedItem ? rightHandDetail(selectedItem) : ui("main.profile.equipment.mainHandEmpty", "No item is currently held."),
      slot: selectedItem,
      rarity: selectedItem ? equipmentRarity(selectedItem) : ui("main.profile.equipment.emptySlot", "Empty"),
      stats: equipmentStats(selectedItem),
      durability: equipmentDurability(selectedItem),
    };
    const backpack = chainBackpack.backpackAddress ? {
      id: "back",
      name: ui("main.profile.equipment.back", "Back / Pack"),
      value: backpackValue,
      detail: ui("main.profile.equipment.backpackDetail", "Equipped chain-backed inventory container."),
      slot: { itemId: "backpack", kind: "container", count: chainBackpack.syncedSlots || 0 },
      rarity: ui("main.profile.equipment.chainBacked", "Chain-backed"),
      stats: [
        [ui("main.profile.equipment.capacity", "Capacity"), `${chainBackpack.syncedSlots || 0}/${chainBackpack.capacity || 0}`],
        [ui("main.profile.equipment.source", "Source"), "PDA"],
      ],
    } : empty("back", "back", "Back / Pack");
    return [
      empty("head", "head", "Head"),
      empty("chest", "chest", "Chest"),
      empty("gloves", "gloves", "Gloves"),
      empty("legs", "legs", "Legs"),
      empty("boots", "boots", "Boots"),
      empty("belt", "belt", "Belt / Charm"),
      mainHand,
      empty("offHand", "offHand", "Off Hand"),
      backpack,
      empty("necklace", "necklace", "Necklace"),
      empty("ring1", "ring1", "Ring 1"),
      empty("ring2", "ring2", "Ring 2", { locked: true }),
    ];
  }

  function rightHandDetail(slot) {
    if (slot.itemId === "iron_pickaxe") return ui("main.profile.equipment.pickaxeDetail", "A reliable mining tool. Hits are validated by the physical tool sweep in chunk.js.");
    if (slot.itemId === "forged_item") return ui("main.profile.equipment.forgedDetail", "A forged tool using the same physical collision and coordinate proof path.");
    if (slot.itemId === "resource_block") {
      const resource = Number.isFinite(slot.resourceId) ? resourceName(slot.resourceId) : ui("main.profile.equipment.resource", "Resource");
      return ui("main.profile.equipment.resourceDetail", "Verified placeable stack · {resource} x{count}", { resource, count: slot.count || 0 });
    }
    if (slot.itemId === "backpack") return ui("main.profile.equipment.backpackOpenDetail", "Opens inventory and resource proof data.");
    return ui("main.profile.equipment.hotbarDetail", "Equipped from hotbar slot {slot}.", { slot: gameState.selectedHotbarSlot + 1 });
  }

  function equipmentSlotButton(entry) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "profile-equipment-slot";
    item.dataset.equipment = entry.id;
    item.dataset.slotState = entry.locked ? "locked" : entry.slot ? "equipped" : "empty";
    item.classList.toggle("active", entry.id === selectedEquipmentId);
    item.setAttribute("aria-pressed", String(entry.id === selectedEquipmentId));
    const label = document.createElement("span");
    label.className = "profile-equipment-slot-label";
    label.textContent = entry.name;
    item.append(label, createProfileEquipmentIcon(entry));
    item.addEventListener("click", () => selectEquipment(entry.id));
    return item;
  }

  function equipmentBrowserItem(entry) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "profile-equipment-item";
    item.dataset.equipment = entry.id;
    item.dataset.slotState = entry.locked ? "locked" : entry.slot ? "equipped" : "empty";
    item.classList.toggle("active", entry.id === selectedEquipmentId);
    item.setAttribute("aria-pressed", String(entry.id === selectedEquipmentId));
    const icon = createProfileEquipmentIcon(entry);
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = entry.name;
    const value = document.createElement("span");
    value.textContent = entry.value;
    const detail = document.createElement("small");
    detail.textContent = entry.detail;
    copy.append(title, value, detail);
    item.append(icon, copy);
    item.addEventListener("click", () => selectEquipment(entry.id));
    return item;
  }

  function selectEquipment(id) {
    selectedEquipmentId = id;
    renderEquipment(getChainSnapshot?.() ?? {});
  }

  function renderEquipmentDetail(target, entry, chain) {
    if (!target || !entry) return;
    target.replaceChildren();
    target.dataset.slotState = entry.locked ? "locked" : entry.slot ? "equipped" : "empty";

    const header = document.createElement("header");
    header.className = "profile-equipment-detail-header";
    const titleWrap = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = entry.slot ? entry.value : entry.name;
    const slotLabel = document.createElement("span");
    slotLabel.textContent = entry.name;
    titleWrap.append(slotLabel, title);
    const rarity = document.createElement("b");
    rarity.textContent = entry.rarity;
    header.append(titleWrap, rarity);

    const preview = document.createElement("div");
    preview.className = "profile-equipment-detail-preview";
    preview.append(createProfileEquipmentIcon(entry, 118));
    const description = document.createElement("p");
    description.className = "profile-equipment-detail-description";
    description.textContent = entry.detail;
    target.append(header, preview, description);

    if (entry.durability) {
      const durability = document.createElement("section");
      durability.className = "profile-equipment-durability";
      durability.innerHTML = `
        <div><span>${escapeHtml(ui("main.profile.equipment.durability", "Durability"))}</span><strong>${entry.durability.current} / ${entry.durability.max}</strong></div>
        <div class="equipment-meter ${entry.durability.ratio < 0.18 ? "low" : ""}"><i style="width:${Math.round(entry.durability.ratio * 100)}%"></i></div>
      `;
      target.append(durability);
    }

    const stats = document.createElement("section");
    stats.className = "profile-equipment-stats";
    const statsTitle = document.createElement("strong");
    statsTitle.textContent = ui("main.profile.equipment.parameters", "PARAMETERS");
    stats.append(statsTitle);
    const rows = entry.stats.length ? entry.stats : [
      [ui("main.profile.equipment.status", "Status"), entry.locked ? ui("main.profile.equipment.locked", "Locked") : ui("main.profile.equipment.notEquipped", "Not equipped")],
    ];
    for (const [labelText, valueText] of rows) {
      const row = document.createElement("div");
      const label = document.createElement("span");
      label.textContent = labelText;
      const value = document.createElement("b");
      value.textContent = valueText;
      row.append(label, value);
      stats.append(row);
    }
    target.append(stats);

    if (entry.slot && chain.lastProof) {
      const proof = document.createElement("small");
      proof.className = "profile-equipment-proof";
      proof.textContent = ui("main.profile.equipment.lastProof", "Last block proof · {status} · {x}, {y}, {z}", {
        status: chain.lastProof.status,
        x: chain.lastProof.worldX,
        y: chain.lastProof.worldY,
        z: chain.lastProof.worldZ,
      });
      target.append(proof);
    }
  }

  function equipmentDurability(slot) {
    if (!slot || !Number.isFinite(Number(slot.durability))) return null;
    const max = Math.max(1, Math.trunc(Number(slot.maxDurability) || DEFAULT_PICKAXE_DURABILITY));
    const current = Math.max(0, Math.min(max, Math.trunc(Number(slot.durability) || 0)));
    return { current, max, ratio: current / max };
  }

  function equipmentRarity(slot) {
    if (slot?.itemId === "forged_item") return ui("main.profile.equipment.forged", "Forged");
    if (slot?.source === "chain") return ui("main.profile.equipment.chainBacked", "Chain-backed");
    return ui("main.profile.equipment.basic", "Basic");
  }

  function equipmentStats(slot) {
    if (!slot) return [];
    if (slot.itemId === "iron_pickaxe" || slot.itemId === "forged_item") {
      return [
        [ui("main.profile.equipment.collision", "Collision"), ui("main.profile.equipment.physicalSweep", "Physical sweep")],
        [ui("main.profile.equipment.miningHits", "Mining hits"), "3"],
        [ui("main.profile.equipment.proof", "Proof"), ui("main.profile.equipment.coordinateProof", "Coordinate")],
      ];
    }
    if (slot.itemId === "resource_block") {
      return [
        [ui("main.profile.equipment.stack", "Stack"), String(slot.count || 0)],
        [ui("main.profile.equipment.resourceId", "Resource ID"), String(slot.resourceId ?? "-")],
        [ui("main.profile.equipment.source", "Source"), slot.source === "chain" ? "PDA" : ui("main.profile.equipment.local", "Local")],
      ];
    }
    return [[ui("main.profile.equipment.hotbarSlot", "Hotbar slot"), String(gameState.selectedHotbarSlot + 1)]];
  }

  function createProfileSkillIcon(skill) {
    const icon = document.createElement("span");
    icon.className = "profile-skill-icon";
    icon.dataset.skillTone = skill.tone;
    icon.innerHTML = profileSkillSvg(skill.id);
    return icon;
  }

  function createProfileEquipmentIcon(entry, size = 54) {
    const icon = document.createElement("span");
    icon.className = "profile-equipment-icon";
    if (entry.slot && typeof createVoxelItemIconCanvas === "function") {
      icon.classList.add("rendered");
      icon.append(createVoxelItemIconCanvas(entry.slot, { size }));
      return icon;
    }
    icon.innerHTML = profileEquipmentSvg(entry.id);
    return icon;
  }

  function bindTabs() {
    if (bound) return;
    const tabs = profileTabs();
    if (!tabs.length) return;
    bound = true;
    for (const tab of tabs) {
      tab.addEventListener("click", () => setProfileTab(tab.dataset.profileTab || "attributes"));
    }
  }

  function setProfileTab(tabName, { renderPanel = true } = {}) {
    const next = ["attributes", "skills", "equipment", "settings"].includes(tabName) ? tabName : "attributes";
    selectedProfileTab = next;
    if (elements.profilePanel) elements.profilePanel.dataset.activeProfileTab = next;
    for (const tab of profileTabs()) {
      const active = tab.dataset.profileTab === next;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    }
    for (const panel of profilePanels()) {
      panel.hidden = panel.dataset.profilePanel !== next;
    }
    if (renderPanel) render();
    if (!elements.profilePanel?.hidden && next === "attributes") startAvatarPreview();
    else if (next !== "attributes") stopAvatarPreview();
  }

  function profileTabs() {
    return Array.from(elements.profileTabs || elements.profilePanel?.querySelectorAll("[data-profile-tab]") || []);
  }

  function profilePanels() {
    return Array.from(elements.profileTabPanels || elements.profilePanel?.querySelectorAll("[data-profile-panel]") || []);
  }

  function togglePanel() {
    if (elements.profilePanel?.hidden) openPanel();
    else closePanel();
  }

  function openPanel() {
    if (elements.profilePanel) elements.profilePanel.hidden = false;
    render();
    if (selectedProfileTab === "attributes") startAvatarPreview();
  }

  function closePanel() {
    if (elements.profilePanel) elements.profilePanel.hidden = true;
    stopAvatarPreview();
  }

  function ensureAvatarPreview() {
    if (avatarPreview) return avatarPreview;
    if (!elements.profileAvatarPreview || typeof document === "undefined") return null;
    try {
      avatarPreview = createAvatarPreviewRenderer(elements.profileAvatarPreview, {
        className: "profile-avatar-preview-canvas",
        maxPixelRatio: 1,
      });
      if (avatarPreview && typeof ResizeObserver === "function" && !avatarPreviewResizeObserver) {
        avatarPreviewResizeObserver = new ResizeObserver(() => {
          if (!elements.profilePanel?.hidden && selectedProfileTab === "attributes") startAvatarPreview();
        });
        avatarPreviewResizeObserver.observe(elements.profileAvatarPreview);
      }
    } catch (error) {
      console.warn("NiceChunk profile avatar preview unavailable:", error);
      avatarPreview = null;
    }
    return avatarPreview;
  }

  function scheduleAvatarPreview(params = {}) {
    pendingAvatarPreview = params;
    if (avatarPreviewFrame || typeof window === "undefined") return;
    avatarPreviewFrame = window.requestAnimationFrame((timeMs = 0) => {
      avatarPreviewFrame = 0;
      if (!elements.profilePanel || elements.profilePanel.hidden) {
        pendingAvatarPreview = null;
        return;
      }
      if (selectedProfileTab !== "attributes") {
        pendingAvatarPreview = null;
        return;
      }
      const next = pendingAvatarPreview || {};
      pendingAvatarPreview = null;
      elements.profileAvatarPreview.dataset.previewYaw = avatarPreviewYaw.toFixed(4);
      ensureAvatarPreview()?.render({
        ...next,
        timeMs,
        moving: false,
        yaw: avatarPreviewYaw,
      });
    });
  }

  function startAvatarPreview() {
    const profile = gameState.playerProfile || {};
    const chain = getChainSnapshot?.() ?? {};
    const appearance = chain.chainPlayer?.appearance || {};
    scheduleAvatarPreview({
      modelCode: appearance.modelCode || profile.modelCode || "NCM:peasant_guy:v1",
      equipment: getAvatarEquipment?.() ?? { rightHand: "pickaxe" },
    });
  }

  function stopAvatarPreview() {
    pendingAvatarPreview = null;
    if (!avatarPreviewFrame || typeof window === "undefined") return;
    window.cancelAnimationFrame(avatarPreviewFrame);
    avatarPreviewFrame = 0;
  }
}

function ui(key, fallback, params = {}) {
  const translated = t(key, params);
  if (translated !== key) return translated;
  return String(fallback).replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? `{${name}}`));
}

function setText(element, value) {
  if (element) element.textContent = String(value);
}

function normalizeYaw(value) {
  const turn = Math.PI * 2;
  return ((Number(value) + Math.PI) % turn + turn) % turn - Math.PI;
}

function formatSol(value) {
  const numeric = Math.max(0, Number(value) || 0);
  return numeric.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function formatDecimal(value, decimals = 0) {
  return Number(value || 0).toFixed(decimals).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function profileStatSvg(statId) {
  const svg = {
    gathering: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20 15 9M12 6l6 6M7 17l-3-3 4-4 3 3M15 9l3-5 2 2-2 5"/></svg>',
    carry: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9h12l2 4v8H4v-8l2-4zM9 9V7a3 3 0 0 1 6 0v2M8 15h8"/></svg>',
    smelting: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8l2-6H6l2 6zM12 3c3 3-1 5 2 8 0-2 3-3 3-5 4 5 1 10-5 10-5 0-7-4-4-8 1 2 2 3 4 3-2-3-1-5 0-8z"/></svg>',
    speed: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16h8l5 4H7c-3 0-4-1-4-3 0-1 0-1 1-1zM11 16l-1-7 5 2 3-3M3 7h5M2 11h6"/></svg>',
    strength: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15h18M5 11v8M19 11v8M8 10c1-4 7-4 8 0v4H8v-4zM12 14v6"/></svg>',
    crafting: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19h14M7 16h10l2 3H5l2-3zM13 4l6 6-3 3-6-6 3-3zM10 7l-6 6"/></svg>',
  };
  return svg[statId] ?? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>';
}

function profileSkillSvg(skillId) {
  const svg = {
    precisionGathering: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 18l9-5 9 5-9 5-9-5z"/><path d="M7 18v6l9 5 9-5v-6"/><path d="M16 13v10"/><circle cx="21.5" cy="10.5" r="4.5"/><path d="M25 14l4 4"/></svg>',
    burden: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M10 11h12l3 5v11H7V16l3-5z"/><path d="M12 11V9a4 4 0 0 1 8 0v2"/><path d="M11 18h10"/><path d="M16 18v7"/></svg>',
    smelting: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M11 27h10l3-8H8l3 8z"/><path d="M16 4c4 4-2 6 2 10 1-3 4-4 5-7 5 7 1 13-7 13-6 0-9-5-5-11 1 3 3 4 5 5-2-4-1-7 0-10z"/></svg>',
    forging: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 24h22"/><path d="M10 20h12l3 4H7l3-4z"/><path d="M18 5l7 7-3 3-7-7 3-3z"/><path d="M15 8L7 16"/></svg>',
    craftsmanship: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 5v4"/><path d="M16 23v4"/><path d="M5 16h4"/><path d="M23 16h4"/><path d="M8.5 8.5l2.8 2.8"/><path d="M20.7 20.7l2.8 2.8"/><path d="M23.5 8.5l-2.8 2.8"/><path d="M11.3 20.7l-2.8 2.8"/><circle cx="16" cy="16" r="7"/><circle cx="16" cy="16" r="2.7"/></svg>',
    swiftness: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 22h11l5 4H10c-3 0-5-1-5-3 0-1 1-1 3-1z"/><path d="M17 22l-2-9 6 3 3-4"/><path d="M4 10h8"/><path d="M3 15h7"/><path d="M5 20h5"/></svg>',
    exploration: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11"/><path d="M20 8l-2 10-6 6 2-10 6-6z"/><circle cx="16" cy="16" r="2"/><path d="M16 2v4"/><path d="M16 26v4"/><path d="M2 16h4"/><path d="M26 16h4"/></svg>',
    stamina: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 27S5 20 5 12a6 6 0 0 1 11-3 6 6 0 0 1 11 3c0 8-11 15-11 15z"/><path d="M15 9l-3 7h5l-2 7 6-10h-5l2-4z"/></svg>',
    strength: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 20h20"/><path d="M8 16v8"/><path d="M24 16v8"/><path d="M12 14c1-5 7-5 8 0"/><path d="M12 14v5h8v-5"/><path d="M16 19v6"/></svg>',
    appraisal: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M9 13l5-6h4l5 6-7 10-7-10z"/><path d="M9 13h14"/><path d="M14 7l2 6 2-6"/><circle cx="12" cy="21" r="5"/><path d="M15.5 24.5l5 5"/></svg>',
  };
  return svg[skillId] ?? '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="10"/><path d="M16 9v14"/><path d="M9 16h14"/></svg>';
}

function profileEquipmentSvg(slotId) {
  const svg = {
    head: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M9 14c0-5 3-9 7-9s7 4 7 9v6l-3 5h-8l-3-5v-6z"/><path d="M10 16h12"/><path d="M12 21h8"/></svg>',
    face: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 12c3-2 5-3 8-3s5 1 8 3l-2 9c-2 3-4 5-6 5s-4-2-6-5l-2-9z"/><path d="M11 16h4"/><path d="M17 16h4"/><path d="M13 22h6"/></svg>',
    shoulder: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 18c2-6 5-9 10-9s8 3 10 9"/><path d="M8 18l-3 6h8l3-6"/><path d="M24 18l3 6h-8l-3-6"/><path d="M13 12h6"/></svg>',
    wrist: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M11 6l10 3-2 8-10-3 2-8z"/><path d="M9 14l10 3-2 9-10-3 2-9z"/><path d="M12 19l5 1.5"/></svg>',
    gloves: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M18 5v10M14 6v10M10 9v8M22 9v9M9 17c0 7 3 10 8 10 4 0 7-3 7-8v-4"/><path d="M11 22h12"/></svg>',
    chest: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M9 8l7-3 7 3 3 17-10 4-10-4 3-17z"/><path d="M16 5v24"/><path d="M10 15h12"/></svg>',
    back: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M11 5h10l4 6v14l-5 3h-8l-5-3V11l4-6z"/><path d="M11 5v8"/><path d="M21 5v8"/><path d="M10 17h12"/></svg>',
    leftHand: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M18 6v10"/><path d="M14 7v10"/><path d="M10 10v8"/><path d="M22 10v9"/><path d="M9 18c0 6 3 10 8 10 4 0 7-3 7-8v-4"/></svg>',
    rightHand: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M14 6v10"/><path d="M18 7v10"/><path d="M22 10v8"/><path d="M10 10v9"/><path d="M23 18c0 6-3 10-8 10-4 0-7-3-7-8v-4"/></svg>',
    mainHand: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 25 23 9M18 5l9 9M7 20l5 5M11 20l2 2M20 11l2 2"/></svg>',
    offHand: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4 25 8v8c0 6-4 10-9 13-5-3-9-7-9-13V8l9-4zM16 8v16M10 13h12"/></svg>',
    legs: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M11 5h10l2 8-3 14h-6l-3-14 0-8z"/><path d="M16 13v14"/><path d="M11 13h10"/></svg>',
    feet: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M9 18h7l2 5v3H5v-3l4-5z"/><path d="M20 18h5l3 5v3H17v-3l3-5z"/><path d="M6 26h22"/></svg>',
    boots: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M10 6h8v12l7 4v5H6v-5l4-5V6zM10 14h8M7 23h18"/></svg>',
    belt: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 11h24v10H4zM12 9h8v14h-8zM15 13h5v6h-5zM4 14h8M20 14h8"/></svg>',
    necklace: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 5c0 8 3 14 9 18 6-4 9-10 9-18M12 21l4 7 4-7M14 23h4"/></svg>',
    ring1: '<svg viewBox="0 0 32 32" aria-hidden="true"><ellipse cx="16" cy="18" rx="9" ry="10"/><path d="m11 8 2-4h6l2 4M12 9h8"/></svg>',
    ring2: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="8" y="14" width="16" height="13" rx="3"/><path d="M11 14v-3a5 5 0 0 1 10 0v3M16 19v4"/></svg>',
    backpack: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M10 10h12l3 5v12H7V15l3-5z"/><path d="M12 10V8a4 4 0 0 1 8 0v2"/><path d="M11 18h10"/><path d="M16 18v7"/></svg>',
  };
  return svg[slotId] ?? '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 8h16v16H8z"/><path d="M8 16h16"/><path d="M16 8v16"/></svg>';
}

function skillXpSummary(skillXp = {}) {
  const entries = [
    ["PG", skillXp.precisionGathering],
    ["SM", skillXp.smelting],
    ["EX", skillXp.exploration],
    ["FG", skillXp.forging],
  ].filter(([, value]) => Number(value) > 0);
  if (!entries.length) return "0";
  return entries.map(([label, value]) => `${label} ${Math.round(Number(value) || 0).toLocaleString()}`).join(" · ");
}
