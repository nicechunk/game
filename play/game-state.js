import {
  FORGED_ITEM_ID,
  consumeLegacyForgedHotbarItems,
  isForgedHotbarSlot,
  normalizeForgedHotbarSlot,
} from "./forged-hotbar-compat.js";
import {
  forgedItemInteraction,
  isForgedMiningToolReady,
  isForgedPlacementReady,
} from "./forged-item-interaction.js";
import { resourceIdForBlock } from "../src/world/blocks.js";

export const HOTBAR_STORAGE_KEY = "nicechunk.play.hotbar.v2";
export const BACKPACK_STORAGE_KEY = "nicechunk.play.backpack.v2";
export const PLAYER_PROFILE_STORAGE_KEY = "nicechunk.play.profile.v1";
export const BACKPACK_CAPACITY = 50;
export const BACKPACK_MAX_CAPACITY = 99;
export const HOTBAR_SLOT_COUNT = 9;
export const BACKPACK_HOTBAR_INDEX = HOTBAR_SLOT_COUNT - 1;
export const DEFAULT_PICKAXE_DURABILITY = 999;
export const RESOURCE_STACK_LIMIT = 999;
export const MATERIAL_STACK_LIMIT = 99;

const CHAIN_ITEM_CATEGORY_FORGED = 2;
const CHAIN_ITEM_CATEGORY_BLUEPRINT = 3;
const CHAIN_FORGED_ITEM_CODE = 8;
const CHAIN_BLUEPRINT_ITEM_CODE = 9;

export function createPlayGameState({
  resourceNone = 0,
  ownerAddress = "",
  onEquipmentChange = () => {},
} = {}) {
  clearLegacyBackpackCache();
  const initialOwnerAddress = normalizeOwnerAddress(ownerAddress);
  const state = {
    ownerAddress: initialOwnerAddress,
    resourceNone,
    hotbarItems: createPlayHotbarItems(),
    selectedHotbarSlot: 0,
    hotbarSlots: loadHotbarSlots(initialOwnerAddress),
    backpackSlots: [],
    backpackCapacity: BACKPACK_CAPACITY,
    backpackMassInitialized: false,
    backpackTotalMassGrams: "0",
    backpackAvailable: false,
    backpackStatusKnown: false,
    playerProfile: loadPlayerProfile(initialOwnerAddress),
    setOwnerAddress(nextOwnerAddress) {
      const nextOwner = normalizeOwnerAddress(nextOwnerAddress);
      const previousOwner = this.ownerAddress;
      if (nextOwner === previousOwner) {
        return { changed: false, previousOwner, ownerAddress: nextOwner };
      }
      this.saveHotbarSlots();
      this.savePlayerProfile();
      this.ownerAddress = nextOwner;
      this.hotbarSlots = loadHotbarSlots(nextOwner);
      this.playerProfile = loadPlayerProfile(nextOwner);
      this.backpackSlots = [];
      this.backpackCapacity = BACKPACK_CAPACITY;
      this.backpackMassInitialized = false;
      this.backpackTotalMassGrams = "0";
      this.backpackAvailable = false;
      this.backpackStatusKnown = false;
      this.selectedHotbarSlot = preferredHotbarIndex(this.hotbarSlots);
      return { changed: true, previousOwner, ownerAddress: nextOwner };
    },
    isBackpackAvailable() {
      return this.backpackAvailable === true;
    },
    setBackpackAvailability(available, { known = true } = {}) {
      const nextAvailable = available === true;
      const nextKnown = known === true;
      const changed = this.backpackAvailable !== nextAvailable || this.backpackStatusKnown !== nextKnown;
      this.backpackAvailable = nextAvailable;
      this.backpackStatusKnown = nextKnown;
      return { changed, available: nextAvailable, known: nextKnown };
    },
    isHotbarSlotSelectable(index) {
      const next = clampInt(index, 0, this.hotbarSlots.length - 1);
      return this.hotbarSlots[next]?.itemId !== "backpack";
    },
    selectHotbarSlot(index) {
      const next = clampInt(index, 0, this.hotbarSlots.length - 1);
      if (!this.isHotbarSlotSelectable(next)) return this.selectedHotbarSlot;
      this.selectedHotbarSlot = next;
      this.saveHotbarSlots();
      return next;
    },
    saveHotbarSlots() {
      saveJson(walletScopedPlayStorageKey(HOTBAR_STORAGE_KEY, this.ownerAddress), this.hotbarSlots);
    },
    saveBackpackSlots() {
      clearLegacyBackpackCache();
    },
    savePlayerProfile() {
      saveJson(walletScopedPlayStorageKey(PLAYER_PROFILE_STORAGE_KEY, this.ownerAddress), this.playerProfile);
    },
    totalBackpackItems() {
      return this.backpackSlots.reduce((sum, slot) => sum + slot.count, 0);
    },
    syncHotbarResourceSlots({ authoritative = this.backpackStatusKnown } = {}) {
      if (!authoritative) return false;
      let changed = false;
      for (let index = 0; index < this.hotbarSlots.length; index += 1) {
        const slot = this.hotbarSlots[index];
        if (slot?.itemId !== "resource_block") continue;
        if (isCustodiedEquipmentSlot(slot)) continue;
        const backpackSlot = this.backpackSlots.find((entry) => entry.id === slot.backpackSlotId);
        if (!backpackSlot || backpackSlot.pending || backpackSlot.kind !== "resource" || backpackSlot.blockId !== slot.blockId || backpackSlot.count <= 0) {
          this.hotbarSlots[index] = null;
          changed = true;
          continue;
        }
        if (
          slot.count !== backpackSlot.count
          || slot.resourceId !== backpackSlot.resourceId
          || slot.decorationId !== backpackSlot.decorationId
          || slot.decorationRuleId !== backpackSlot.decorationRuleId
          || slot.decorationVariantHash !== backpackSlot.decorationVariantHash
        ) {
          slot.count = backpackSlot.count;
          slot.resourceId = backpackSlot.resourceId;
          Object.assign(slot, surfaceDecorationFields(backpackSlot));
          changed = true;
        }
      }
      if (changed) this.saveHotbarSlots();
      return changed;
    },
    syncHotbarBackpackSlots({ authoritative = this.backpackStatusKnown, clearAll = false } = {}) {
      if (!authoritative) return false;
      let changed = this.syncHotbarResourceSlots({ authoritative: true });
      const backpackSlotsByIdentity = new Map(this.backpackSlots
        .map((slot) => [backpackShortcutIdentity(slot), slot])
        .filter(([identity]) => identity));
      for (let index = 0; index < this.hotbarSlots.length; index += 1) {
        const slot = this.hotbarSlots[index];
        const chainForged = slot?.itemId === FORGED_ITEM_ID && isChainBackedForgedSlot(slot);
        const chainBlueprint = slot?.itemId === "blueprint_tool" && isChainBackedBlueprintSlot(slot);
        if (!chainForged && !chainBlueprint) continue;
        if (isCustodiedEquipmentSlot(slot)) continue;
        const identity = hotbarShortcutIdentity(slot);
        const backpackSlot = clearAll ? null : backpackSlotsByIdentity.get(identity);
        if (!backpackSlot || (chainForged && backpackSlot.kind !== "forged") || (chainBlueprint && backpackSlot.kind !== "blueprint")) {
          this.hotbarSlots[index] = null;
          changed = true;
          continue;
        }
        if (chainBlueprint) {
          const normalized = blueprintHotbarSlotFromBackpack(backpackSlot, this.ownerAddress);
          if (!normalized || JSON.stringify(normalized) !== JSON.stringify(slot)) {
            this.hotbarSlots[index] = normalized;
            changed = true;
          }
          continue;
        }
        const designUnchanged = normalizeDesignHashValue(slot.designHash) === normalizeDesignHashValue(backpackSlot.designHash);
        const normalized = normalizeForgedHotbarSlot({
          ...backpackSlot,
          ...slot,
          bytes: designUnchanged ? slot.bytes : [],
          code: designUnchanged ? slot.code : "",
          designHash: backpackSlot.designHash,
          chainBackpack: backpackSlot.chainBackpack,
          chainIndex: backpackSlot.chainIndex,
          chainItemId: backpackSlot.chainItemId,
          itemPda: backpackSlot.itemPda,
          sourceItemId: backpackSlot.id,
          source: "chain",
          owner: this.ownerAddress || slot.owner || null,
          durability: backpackSlot.durabilityCurrent,
          maxDurability: backpackSlot.durabilityMax,
        }, {
          defaultDurability: DEFAULT_PICKAXE_DURABILITY,
          ownerAddress: this.ownerAddress,
        });
        if (!normalized || JSON.stringify(normalized) !== JSON.stringify(slot)) {
          this.hotbarSlots[index] = normalized;
          changed = true;
        }
      }
      if (!this.isHotbarSlotSelectable(this.selectedHotbarSlot) || !this.hotbarSlots[this.selectedHotbarSlot]) {
        this.selectedHotbarSlot = preferredHotbarIndex(this.hotbarSlots);
      }
      if (changed) this.saveHotbarSlots();
      return changed;
    },
    canModifyHotbarSlot(index) {
      const safeIndex = clampInt(index, 0, this.hotbarSlots.length - 1);
      const slot = this.hotbarSlots[safeIndex];
      return safeIndex >= 0 && safeIndex < this.hotbarSlots.length && slot?.itemId !== "backpack" && !slot?.locked;
    },
    canSwapHotbarSlots(fromIndex, toIndex) {
      const from = clampInt(fromIndex, 0, this.hotbarSlots.length - 1);
      const to = clampInt(toIndex, 0, this.hotbarSlots.length - 1);
      if (from === to) return false;
      const source = this.hotbarSlots[from] ?? null;
      const target = this.hotbarSlots[to] ?? null;
      const sourceIsBackpack = source?.itemId === "backpack";
      const targetIsBackpack = target?.itemId === "backpack";
      if (sourceIsBackpack && targetIsBackpack) return false;
      if (!this.isBackpackAvailable() && (sourceIsBackpack || targetIsBackpack)) return false;
      if (sourceIsBackpack) return !target?.locked;
      if (targetIsBackpack) return Boolean(source && !source.locked);
      return this.canModifyHotbarSlot(from) && this.canModifyHotbarSlot(to);
    },
    swapHotbarSlots(fromIndex, toIndex) {
      const from = clampInt(fromIndex, 0, this.hotbarSlots.length - 1);
      const to = clampInt(toIndex, 0, this.hotbarSlots.length - 1);
      if (from === to) return { ok: false, reason: "Drop onto a different hotbar slot to swap." };
      if (!this.canSwapHotbarSlots(from, to)) return { ok: false, reason: "That hotbar slot is locked." };
      const beforeFrom = cloneHotbarSlot(this.hotbarSlots[from]);
      const beforeTo = cloneHotbarSlot(this.hotbarSlots[to]);
      const source = this.hotbarSlots[from] ?? null;
      this.hotbarSlots[from] = this.hotbarSlots[to] ?? null;
      this.hotbarSlots[to] = source;
      if (this.selectedHotbarSlot === from) this.selectedHotbarSlot = to;
      else if (this.selectedHotbarSlot === to) this.selectedHotbarSlot = from;
      if (!this.isHotbarSlotSelectable(this.selectedHotbarSlot)) {
        this.selectedHotbarSlot = firstSelectableHotbarIndex(this.hotbarSlots);
      }
      this.saveHotbarSlots();
      notifyEquipmentChanges([
        equipmentMutationChange(from, beforeFrom, this.hotbarSlots[from]),
        equipmentMutationChange(to, beforeTo, this.hotbarSlots[to]),
      ]);
      return { ok: true, from, to };
    },
    clearHotbarSlot(index) {
      const safeIndex = clampInt(index, 0, this.hotbarSlots.length - 1);
      if (!this.canModifyHotbarSlot(safeIndex)) return { ok: false, reason: "That hotbar slot is locked." };
      if (!this.hotbarSlots[safeIndex]) return { ok: false, reason: "That hotbar slot is already empty." };
      const before = cloneHotbarSlot(this.hotbarSlots[safeIndex]);
      this.hotbarSlots[safeIndex] = null;
      if (this.selectedHotbarSlot === safeIndex) this.selectHotbarSlot(0);
      this.saveHotbarSlots();
      notifyEquipmentChanges([equipmentMutationChange(safeIndex, before, null)]);
      return { ok: true, index: safeIndex };
    },
    getBackpackSlotEquipment(slotOrId) {
      const backpackSlot = resolveBackpackSlot(this.backpackSlots, slotOrId);
      const identity = backpackShortcutIdentity(backpackSlot);
      if (!identity) return null;
      const index = this.hotbarSlots.findIndex((slot) => hotbarShortcutIdentity(slot) === identity);
      return index >= 0 ? { index, slot: this.hotbarSlots[index], backpackSlot } : null;
    },
    isBackpackSlotEquipped(slotOrId) {
      return Boolean(this.getBackpackSlotEquipment(slotOrId));
    },
    getHotbarEquipmentChainReference(index) {
      const safeIndex = clampInt(index, 0, this.hotbarSlots.length - 1);
      return equipmentChainReference(this.hotbarSlots[safeIndex], this.backpackSlots, safeIndex);
    },
    restoreChainEquipmentSlots(equipment, { authoritative = true } = {}) {
      const records = Array.isArray(equipment?.slots) ? equipment.slots : [];
      if (!authoritative || !equipment?.initialized || records.length !== HOTBAR_SLOT_COUNT) {
        return { changed: false, resolved: 0, unresolved: 0, reason: "equipment-not-authoritative" };
      }
      const next = this.hotbarSlots.map(cloneHotbarSlot);
      let resolved = 0;
      let unresolved = 0;
      for (let index = 0; index < HOTBAR_SLOT_COUNT; index += 1) {
        const record = records.find((entry) => Number(entry?.slot) === index) ?? records[index];
        if (!record?.equipped) {
          if (equipmentChainReference(next[index], this.backpackSlots, index) || isCustodiedEquipmentSlot(next[index])) {
            next[index] = null;
          }
          continue;
        }
        if (record.custodied) {
          const restored = hotbarSlotFromEquipmentRecord(record, this.ownerAddress, index);
          if (!restored) {
            unresolved += 1;
            continue;
          }
          next[index] = restored;
          resolved += 1;
          continue;
        }
        const backpackSlot = this.backpackSlots.find((slot) => equipmentRecordMatchesBackpackSlot(record, slot));
        if (!backpackSlot) {
          unresolved += 1;
          continue;
        }
        const restored = hotbarSlotFromBackpack(backpackSlot, this.ownerAddress, record.modelBytes);
        if (!restored) {
          unresolved += 1;
          continue;
        }
        next[index] = withEquipmentSource(restored, {
          custodySource: "backpack",
          equipmentSlot: index,
          sourceBackpackIndex: record.backpackIndex,
          chainBackpack: record.backpack,
        });
        resolved += 1;
      }
      removeDuplicateBackpackShortcuts(next);
      const changed = JSON.stringify(next) !== JSON.stringify(this.hotbarSlots);
      if (changed) {
        this.hotbarSlots = next;
        if (!this.isHotbarSlotSelectable(this.selectedHotbarSlot) || !this.hotbarSlots[this.selectedHotbarSlot]) {
          this.selectedHotbarSlot = preferredHotbarIndex(this.hotbarSlots);
        }
        this.saveHotbarSlots();
      }
      return { changed, resolved, unresolved };
    },
    restoreEquipmentMutation(changes = []) {
      let changed = false;
      for (const change of changes ?? []) {
        const index = Number(change?.index);
        if (!Number.isInteger(index) || index < 0 || index >= this.hotbarSlots.length) continue;
        const previous = normalizeHotbarSlot(change.before, { ownerAddress: this.ownerAddress });
        if (JSON.stringify(previous) === JSON.stringify(this.hotbarSlots[index])) continue;
        this.hotbarSlots[index] = previous;
        changed = true;
      }
      if (changed) {
        this.selectedHotbarSlot = preferredHotbarIndex(this.hotbarSlots);
        this.saveHotbarSlots();
      }
      return { changed };
    },
    canUnequipHotbarSlot(index) {
      const safeIndex = clampInt(index, 0, this.hotbarSlots.length - 1);
      return this.canModifyHotbarSlot(safeIndex)
        && Boolean(hotbarShortcutIdentity(this.hotbarSlots[safeIndex]));
    },
    unequipHotbarSlot(index) {
      const safeIndex = clampInt(index, 0, this.hotbarSlots.length - 1);
      if (!this.canUnequipHotbarSlot(safeIndex)) {
        return { ok: false, reason: "not-backpack-equipment" };
      }
      const slot = this.hotbarSlots[safeIndex];
      const before = cloneHotbarSlot(slot);
      this.hotbarSlots[safeIndex] = null;
      if (this.selectedHotbarSlot === safeIndex) {
        this.selectedHotbarSlot = firstSelectableHotbarIndex(this.hotbarSlots);
      }
      this.saveHotbarSlots();
      notifyEquipmentChanges([equipmentMutationChange(safeIndex, before, null)]);
      return { ok: true, index: safeIndex, slot };
    },
    moveBackpackSlotToHotbar(backpackIndex, hotbarIndex) {
      const sourceIndex = clampInt(backpackIndex, 0, this.backpackCapacity - 1);
      const targetIndex = clampInt(hotbarIndex, 0, this.hotbarSlots.length - 1);
      const source = this.backpackSlots[sourceIndex] ?? null;
      if (!source) return { ok: false, reason: "That backpack slot is empty." };
      if (!this.canModifyHotbarSlot(targetIndex)) return { ok: false, reason: "That hotbar slot is locked." };
      return this.equipBackpackSlotToHotbar(source.id, targetIndex);
    },
    moveBackpackSlot(fromIndex, toIndex) {
      const from = clampInt(fromIndex, 0, this.backpackCapacity - 1);
      const to = clampInt(toIndex, 0, this.backpackCapacity - 1);
      if (from === to) return { ok: false, reason: "Drop onto a different backpack slot to reorder." };
      return { ok: false, reason: "PDA backpack slot order cannot be changed locally." };
    },
    discardBackpackSlots(indexes = []) {
      return { ok: false, reason: indexes.length ? "PDA backpack items must be discarded on chain." : "No backpack item selected." };
    },
    getSelectedToolSlot() {
      const slot = this.hotbarSlots[this.selectedHotbarSlot];
      return isUsableMiningToolSlot(slot) ? { slot, index: this.selectedHotbarSlot } : null;
    },
    getSelectedForgedSlot() {
      const slot = this.hotbarSlots[this.selectedHotbarSlot];
      return isForgedHotbarSlot(slot) ? { slot, index: this.selectedHotbarSlot } : null;
    },
    getSelectedForgedPlaceableSlot() {
      const selected = this.getSelectedForgedSlot();
      return selected && isForgedPlacementReady(selected.slot) ? selected : null;
    },
    getForgedInteraction(slot) {
      return forgedItemInteraction(slot);
    },
    getSelectedBlueprintSlot() {
      const slot = this.hotbarSlots[this.selectedHotbarSlot];
      return slot?.itemId === "blueprint_tool" && normalizeU64String(slot.blueprintId)
        ? { slot, index: this.selectedHotbarSlot }
        : null;
    },
    getSelectedBlueprintId() {
      return this.getSelectedBlueprintSlot()?.slot?.blueprintId ?? "";
    },
    isBlueprintSelected() {
      return Boolean(this.getSelectedBlueprintSlot());
    },
    getSelectedPlaceableSlot() {
      this.syncHotbarResourceSlots();
      if (!this.isBackpackAvailable()) return null;
      const slot = this.hotbarSlots[this.selectedHotbarSlot];
      return isPlaceableHotbarSlot(slot) ? { slot, index: this.selectedHotbarSlot } : null;
    },
    equipBackpackSlotToHotbar(backpackSlotId, targetIndex = this.selectedHotbarSlot) {
      const backpackSlot = this.backpackSlots.find((entry) => entry.id === backpackSlotId);
      if (!isPlaceableBackpackSlot(backpackSlot)) return { ok: false, reason: "Only confirmed mined block resources can be equipped for placement." };
      const shortcutIdentity = backpackShortcutIdentity(backpackSlot);
      const existingIndexes = shortcutIdentity
        ? this.hotbarSlots
          .map((slot, index) => hotbarShortcutIdentity(slot) === shortcutIdentity ? index : -1)
          .filter((index) => index >= 0)
        : [];
      if (existingIndexes.length) {
        const requestedIndex = clampInt(targetIndex, 0, this.hotbarSlots.length - 1);
        const index = existingIndexes.includes(requestedIndex) ? requestedIndex : existingIndexes[0];
        let deduplicated = 0;
        const changes = [];
        for (const duplicateIndex of existingIndexes) {
          if (duplicateIndex === index) continue;
          const before = cloneHotbarSlot(this.hotbarSlots[duplicateIndex]);
          this.hotbarSlots[duplicateIndex] = null;
          changes.push(equipmentMutationChange(duplicateIndex, before, null));
          deduplicated += 1;
        }
        this.selectedHotbarSlot = index;
        this.saveHotbarSlots();
        notifyEquipmentChanges(changes);
        return { ok: true, index, slot: this.hotbarSlots[index], alreadyEquipped: true, deduplicated };
      }
      const index = this.hotbarTargetIndex(targetIndex);
      if (index < 0) return { ok: false, reason: "No available hotbar slot for this resource." };
      const before = cloneHotbarSlot(this.hotbarSlots[index]);
      const equipped = hotbarSlotFromBackpack(backpackSlot, this.ownerAddress);
      if (!equipped) return { ok: false, reason: "Only confirmed mined block resources can be equipped for placement." };
      this.hotbarSlots[index] = equipped;
      this.selectedHotbarSlot = index;
      this.saveHotbarSlots();
      notifyEquipmentChanges([equipmentMutationChange(index, before, equipped)]);
      return { ok: true, index, slot: this.hotbarSlots[index] };
    },
    hotbarTargetIndex(preferredIndex = this.selectedHotbarSlot) {
      const preferred = clampInt(preferredIndex, 0, this.hotbarSlots.length - 1);
      if (this.canModifyHotbarSlot(preferred) && !isMiningToolSlot(this.hotbarSlots[preferred])) return preferred;
      const empty = this.hotbarSlots.findIndex((slot, index) => index > 0 && this.canModifyHotbarSlot(index) && !slot);
      if (empty >= 0) return empty;
      const resource = this.hotbarSlots.findIndex((slot, index) => index > 0 && this.canModifyHotbarSlot(index) && slot?.itemId === "resource_block");
      if (resource >= 0) return resource;
      return this.hotbarSlots.findIndex((slot, index) => index > 0 && this.canModifyHotbarSlot(index) && !isMiningToolSlot(slot));
    },
    consumeSelectedPlaceable(amount = 1) {
      const selected = this.getSelectedPlaceableSlot();
      if (!selected) return { ok: false, reason: "Select a confirmed resource block in the hotbar first." };
      const count = clampInt(amount, 1, RESOURCE_STACK_LIMIT);
      const { slot, index } = selected;
      if (isCustodiedEquipmentSlot(slot) && slot.count >= count) {
        return {
          ok: true,
          slotIndex: index,
          pdaSnapshot: true,
          consumed: { ...slot, count },
          sourceType: "equipment",
          equipmentSlot: slot.equipmentSlot,
        };
      }
      const backpackSlot = this.backpackSlots.find((entry) => entry.id === slot.backpackSlotId);
      if (!backpackSlot || backpackSlot.source !== "chain" || backpackSlot.pending || backpackSlot.kind !== "resource" || backpackSlot.count < count) {
        return { ok: false, reason: "The selected PDA backpack stack is not available." };
      }
      return {
        ok: true,
        slotIndex: index,
        pdaSnapshot: true,
        consumed: { ...backpackSlot, count },
      };
    },
    getPrimaryToolSlot() {
      return this.hotbarSlots.find((slot) => isUsableMiningToolSlot(slot) || isMiningToolSlot(slot)) ?? null;
    },
    isMiningToolSlot(slot) {
      return isMiningToolSlot(slot);
    },
    isUsableMiningToolSlot(slot) {
      return isUsableMiningToolSlot(slot);
    },
    damageSelectedTool(amount) {
      const selected = this.getSelectedToolSlot();
      if (!selected) return null;
      selected.slot.durability = Math.max(0, Math.trunc(selected.slot.durability || 0) - Math.max(1, Math.trunc(amount || 1)));
      this.saveHotbarSlots();
      return selected;
    },
    restoreToolDamage(slotIndex, amount) {
      const slot = this.hotbarSlots[slotIndex];
      if (!isMiningToolSlot(slot)) return;
      slot.durability = Math.min(slot.maxDurability || DEFAULT_PICKAXE_DURABILITY, Math.trunc(slot.durability || 0) + Math.max(1, Math.trunc(amount || 1)));
      this.saveHotbarSlots();
    },
    addBackpackResource({ resourceId, blockId, count = 1, pendingTxId = null, yieldBps = 10000, volumeMilliLiters = 1000 }) {
      return null;
    },
    consumeBackpackItems(consumptions = []) {
      return { ok: false, reason: consumptions.length ? "PDA backpack items require an on-chain transaction." : "No input resources were selected." };
    },
    addSmeltedItem({ materialId, recipeId, count = 1, quality = 0, label = "", className = "", previewColor = null, sourceProof = null }) {
      return null;
    },
    addBackpackSlotSnapshot(slotSnapshot) {
      return null;
    },
    restoreBackpackSlotSnapshot(slotSnapshot) {
      return this.addBackpackSlotSnapshot(slotSnapshot);
    },
    removeBackpackResourceForTx(txId) {
      return 0;
    },
    confirmBackpackResourceForTx(txId) {
      return 0;
    },
    mergeChainBackpackSlots(chainSlots = [], {
      source = "chain",
      capacity = BACKPACK_CAPACITY,
      massInitialized = false,
      totalMassGrams = "0",
    } = {}) {
      const nextCapacity = clampInt(capacity, 1, BACKPACK_MAX_CAPACITY);
      const nextMassInitialized = massInitialized === true;
      const nextTotalMassGrams = normalizeMassGramsString(totalMassGrams);
      const nextSlots = chainSlots
        .map(normalizeBackpackSlot)
        .filter((slot) => slot && !slot.pending && slot.source === source)
        .slice(0, nextCapacity);
      const previousSignature = backpackSlotsSignature(this.backpackSlots);
      const nextSignature = backpackSlotsSignature(nextSlots);
      const capacityChanged = this.backpackCapacity !== nextCapacity;
      const massChanged = this.backpackMassInitialized !== nextMassInitialized
        || this.backpackTotalMassGrams !== nextTotalMassGrams;
      this.backpackCapacity = nextCapacity;
      this.backpackMassInitialized = nextMassInitialized;
      this.backpackTotalMassGrams = nextTotalMassGrams;
      this.backpackSlots = nextSlots;
      const hotbarChanged = this.syncHotbarBackpackSlots({ authoritative: true });
      if (previousSignature === nextSignature && !hotbarChanged && !capacityChanged && !massChanged) {
        return { changed: false, count: nextSlots.length };
      }
      this.saveBackpackSlots();
      this.saveHotbarSlots();
      return { changed: true, count: nextSlots.length };
    },
    clearBackpackSlots() {
      const backpackChanged = this.backpackSlots.length > 0;
      const backpackMetadataChanged = this.backpackCapacity !== BACKPACK_CAPACITY
        || this.backpackMassInitialized
        || this.backpackTotalMassGrams !== "0";
      this.backpackSlots = [];
      this.backpackCapacity = BACKPACK_CAPACITY;
      this.backpackMassInitialized = false;
      this.backpackTotalMassGrams = "0";
      const hotbarChanged = this.syncHotbarBackpackSlots({ authoritative: true, clearAll: true });
      this.saveBackpackSlots();
      this.saveHotbarSlots();
      return { changed: backpackChanged || backpackMetadataChanged || hotbarChanged, count: 0 };
    },
  };
  function equipmentMutationChange(index, before, after) {
    const beforeReference = equipmentChainReference(before, state.backpackSlots, index);
    const reference = equipmentChainReference(after, state.backpackSlots, index);
    if (!beforeReference && !reference) return null;
    return {
      index,
      before: cloneHotbarSlot(before),
      after: cloneHotbarSlot(after),
      beforeReference,
      reference,
    };
  }

  function notifyEquipmentChanges(changes) {
    const filtered = (changes ?? []).filter(Boolean);
    if (!filtered.length) return;
    try {
      onEquipmentChange({ ownerAddress: state.ownerAddress, changes: filtered });
    } catch {
      // The local hotbar remains usable while the chain sync reports its own error.
    }
  }
  state.selectedHotbarSlot = preferredHotbarIndex(state.hotbarSlots);
  return state;
}

export function createPlayHotbarItems() {
  return Object.freeze({
    iron_pickaxe: { kind: "tool", itemId: "iron_pickaxe", label: "Pickaxe", maxDurability: DEFAULT_PICKAXE_DURABILITY },
    forged_item: { kind: "forged", itemId: FORGED_ITEM_ID, label: "Forged Tool", maxDurability: DEFAULT_PICKAXE_DURABILITY },
    resource_block: { kind: "resource", itemId: "resource_block", label: "Block", action: "placeBlock" },
    backpack: { kind: "backpack", itemId: "backpack", label: "Backpack" },
    blueprint_tool: { kind: "blueprint", itemId: "blueprint_tool", label: "Blueprint" },
  });
}

export function createDefaultHotbarSlots() {
  const slots = Array.from({ length: HOTBAR_SLOT_COUNT }, () => null);
  slots[0] = { itemId: "iron_pickaxe", durability: DEFAULT_PICKAXE_DURABILITY, maxDurability: DEFAULT_PICKAXE_DURABILITY };
  slots[BACKPACK_HOTBAR_INDEX] = { itemId: "backpack", locked: true };
  return slots;
}

export function walletScopedPlayStorageKey(baseKey, ownerAddress = "") {
  const owner = normalizeOwnerAddress(ownerAddress);
  return `${String(baseKey || "")}.${owner ? encodeURIComponent(owner) : "guest"}`;
}

function loadHotbarSlots(ownerAddress = "") {
  const owner = normalizeOwnerAddress(ownerAddress);
  const storageKey = walletScopedPlayStorageKey(HOTBAR_STORAGE_KEY, owner);
  let parsed = loadJson(storageKey, null);
  let migratedGlobal = false;
  if (!Array.isArray(parsed) && owner) {
    parsed = legacyGlobalHotbarForOwner(owner);
    migratedGlobal = Array.isArray(parsed);
  }
  const slots = Array.isArray(parsed)
    ? normalizeHotbarSlots(parsed, { ownerAddress: owner })
    : createDefaultHotbarSlots();
  const migration = consumeLegacyForgedHotbarItems(slots, {
    defaultDurability: DEFAULT_PICKAXE_DURABILITY,
    ownerAddress: owner,
  });
  const slotCountChanged = Array.isArray(parsed) && parsed.length !== HOTBAR_SLOT_COUNT;
  const normalizedChanged = Array.isArray(parsed) && JSON.stringify(parsed) !== JSON.stringify(slots);
  if (migratedGlobal || slotCountChanged || normalizedChanged || migration.changed) saveJson(storageKey, slots);
  return slots;
}

function legacyGlobalHotbarForOwner(ownerAddress) {
  const owner = normalizeOwnerAddress(ownerAddress);
  const legacy = loadJson(HOTBAR_STORAGE_KEY, null);
  if (!owner || !Array.isArray(legacy)) return null;
  const hasOwnedShortcut = legacy.some((slot) => (
    slot?.itemId === FORGED_ITEM_ID && normalizeOwnerAddress(slot.owner) === owner
    || slot?.itemId === "blueprint_tool" && normalizeOwnerAddress(slot.blueprintOwner) === owner
  ));
  if (!hasOwnedShortcut) return null;
  return legacy.map((slot) => {
    if (slot?.itemId === "iron_pickaxe" || slot?.itemId === "backpack") return slot;
    if (slot?.itemId === FORGED_ITEM_ID && normalizeOwnerAddress(slot.owner) === owner) return slot;
    if (slot?.itemId === "blueprint_tool" && normalizeOwnerAddress(slot.blueprintOwner) === owner) return slot;
    return null;
  });
}

export function normalizeHotbarSlots(slots, { ownerAddress = "" } = {}) {
  const owner = normalizeOwnerAddress(ownerAddress);
  const normalized = Array.from(
    { length: HOTBAR_SLOT_COUNT },
    (_, index) => normalizeHotbarSlot(slots[index], { ownerAddress: owner }),
  );
  const backpackIndexes = normalized
    .map((slot, index) => slot?.itemId === "backpack" ? index : -1)
    .filter((index) => index >= 0);
  if (backpackIndexes.length) {
    const backpackIndex = backpackIndexes[0];
    normalized[backpackIndex] = { itemId: "backpack", locked: true };
    for (const duplicateIndex of backpackIndexes.slice(1)) normalized[duplicateIndex] = null;
  } else {
    const displaced = normalized[BACKPACK_HOTBAR_INDEX];
    normalized[BACKPACK_HOTBAR_INDEX] = { itemId: "backpack", locked: true };
    if (displaced) {
      const target = normalized.findIndex((slot, index) => index > 0 && index !== BACKPACK_HOTBAR_INDEX && !slot);
      if (target >= 0) normalized[target] = displaced;
    }
  }
  removeDuplicateBackpackShortcuts(normalized);
  if (!normalized.some((slot) => slot?.itemId === "iron_pickaxe")) {
    const pickaxeIndex = !normalized[0] ? 0 : normalized.findIndex((slot) => !slot);
    if (pickaxeIndex >= 0) {
      normalized[pickaxeIndex] = { itemId: "iron_pickaxe", durability: DEFAULT_PICKAXE_DURABILITY, maxDurability: DEFAULT_PICKAXE_DURABILITY };
    }
  }
  removeLegacyTestBlueprintSlots(normalized);
  return normalized;
}

function removeDuplicateBackpackShortcuts(slots) {
  const seen = new Set();
  for (let index = 0; index < slots.length; index += 1) {
    const identity = hotbarShortcutIdentity(slots[index]);
    if (!identity) continue;
    if (seen.has(identity)) {
      slots[index] = null;
      continue;
    }
    seen.add(identity);
  }
}

function backpackShortcutIdentity(slot) {
  if (slot?.kind === "resource") {
    const sourceId = String(slot.id || "").trim();
    return sourceId ? `resource:${sourceId}` : "";
  }
  if (slot?.kind === "forged") return forgedShortcutIdentity(slot, slot.id);
  return slot?.kind === "blueprint" ? blueprintShortcutIdentity(slot) : "";
}

function resolveBackpackSlot(slots, slotOrId) {
  if (slotOrId && typeof slotOrId === "object") return slotOrId;
  const id = String(slotOrId ?? "").trim();
  return id ? slots.find((slot) => String(slot?.id || "") === id) ?? null : null;
}

function hotbarShortcutIdentity(slot) {
  if (slot?.itemId === "resource_block") {
    const sourceId = String(slot.backpackSlotId || "").trim();
    return sourceId ? `resource:${sourceId}` : "";
  }
  if (slot?.itemId === FORGED_ITEM_ID) return forgedShortcutIdentity(slot, slot.sourceItemId);
  return slot?.itemId === "blueprint_tool" ? blueprintShortcutIdentity(slot) : "";
}

function blueprintShortcutIdentity(slot) {
  const blueprintId = normalizeU64String(slot?.blueprintId || slot?.chainItemId);
  return blueprintId ? `blueprint:${blueprintId}` : "";
}

function forgedShortcutIdentity(slot, fallbackSourceId = "") {
  const chainBackpack = String(slot?.chainBackpack || slot?.backpack || "").trim();
  const chainItemId = normalizeU64String(slot?.chainItemId);
  if (chainBackpack && chainItemId) return `forged:item:${chainBackpack}:${chainItemId}`;
  if (chainBackpack && Number.isInteger(slot?.chainIndex) && slot.chainIndex >= 0) {
    return `forged:slot:${chainBackpack}:${slot.chainIndex}`;
  }
  const sourceId = String(slot?.sourceItemId || slot?.id || fallbackSourceId || "").trim();
  return sourceId ? `forged:source:${sourceId}` : "";
}

function equipmentSourceFields(slot = {}) {
  const custodySource = slot.custodySource === "equipment"
    ? "equipment"
    : slot.custodySource === "backpack"
      ? "backpack"
      : "";
  if (!custodySource) return {};
  const equipmentSlot = Number.isInteger(slot.equipmentSlot) ? slot.equipmentSlot : null;
  const sourceBackpackIndex = Number.isInteger(slot.sourceBackpackIndex) ? slot.sourceBackpackIndex : null;
  const chainIndex = Number.isInteger(slot.chainIndex) ? slot.chainIndex : null;
  const fields = {
    custodySource,
    equipmentSlot: equipmentSlot !== null && equipmentSlot >= 0 && equipmentSlot < HOTBAR_SLOT_COUNT
      ? equipmentSlot
      : null,
    sourceBackpackIndex: sourceBackpackIndex !== null && sourceBackpackIndex >= 0
      ? sourceBackpackIndex
      : null,
    chainBackpack: String(slot.chainBackpack || slot.backpack || ""),
    chainIndex: chainIndex !== null && chainIndex >= 0 ? chainIndex : null,
  };
  if (slot.chainItemId !== undefined && slot.chainItemId !== null && String(slot.chainItemId)) {
    fields.chainItemId = String(slot.chainItemId);
  }
  if (Number.isFinite(slot.itemCode)) fields.itemCode = Math.max(0, Math.trunc(slot.itemCode));
  if (slot.itemPda) fields.itemPda = String(slot.itemPda);
  if (Number.isFinite(slot.metadata)) fields.metadata = Math.trunc(slot.metadata) >>> 0;
  const sourceItemId = String(slot.sourceItemId || slot.id || "");
  if (sourceItemId) fields.sourceItemId = sourceItemId;
  return fields;
}

function withEquipmentSource(slot, source = {}) {
  return slot ? { ...slot, ...equipmentSourceFields(source) } : null;
}

function isCustodiedEquipmentSlot(slot) {
  return Boolean(slot?.custodySource === "equipment"
    && Number.isInteger(slot.equipmentSlot)
    && slot.equipmentSlot >= 0
    && slot.equipmentSlot < HOTBAR_SLOT_COUNT);
}

function isChainBackedForgedSlot(slot) {
  return Boolean(slot?.itemId === FORGED_ITEM_ID && (
    slot.source === "chain"
    || slot.chainBackpack
    || slot.itemPda
    || Number.isInteger(slot.chainIndex)
  ));
}

function isChainBackedBlueprintSlot(slot) {
  return Boolean(slot?.itemId === "blueprint_tool" && (
    slot.source === "chain"
    || slot.chainBackpack
    || slot.itemPda
    || Number.isInteger(slot.chainIndex)
  ));
}

function removeLegacyTestBlueprintSlots(slots) {
  const seen = new Set();
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (slot?.itemId !== "blueprint_tool") continue;
    const blueprintId = normalizeU64String(slot.blueprintId);
    const legacyTestBlueprint = slot.source.trim().toLowerCase() === "test"
      || slot.blueprintInstanceId.startsWith("test-blueprint:");
    if (!blueprintId || legacyTestBlueprint || seen.has(blueprintId)) {
      slots[index] = null;
      continue;
    }
    seen.add(blueprintId);
  }
}

function firstSelectableHotbarIndex(slots) {
  const index = slots.findIndex((slot) => slot?.itemId !== "backpack");
  return index >= 0 ? index : 0;
}

function preferredHotbarIndex(slots) {
  const toolIndex = slots.findIndex((slot) => isMiningToolSlot(slot));
  return toolIndex >= 0 ? toolIndex : firstSelectableHotbarIndex(slots);
}

function normalizeHotbarSlot(slot, { ownerAddress = "" } = {}) {
  if (!slot || typeof slot !== "object") return null;
  if (slot.itemId === "iron_pickaxe") {
    const maxDurability = clampInt(slot.maxDurability ?? DEFAULT_PICKAXE_DURABILITY, 1, 9999);
    return {
      itemId: "iron_pickaxe",
      durability: clampInt(slot.durability ?? maxDurability, 0, maxDurability),
      maxDurability,
    };
  }
  if (slot.itemId === FORGED_ITEM_ID) {
    const normalized = normalizeForgedHotbarSlot(slot, {
      defaultDurability: DEFAULT_PICKAXE_DURABILITY,
      ownerAddress,
    });
    if (ownerAddress && normalized?.owner && normalizeOwnerAddress(normalized.owner) !== ownerAddress) return null;
    return withEquipmentSource(normalized, slot);
  }
  if (slot.itemId === "resource_block") {
    const blockId = Number.isFinite(slot.blockId) ? Math.trunc(slot.blockId) : null;
    const resourceId = clampInt(slot.resourceId, 0, 999);
    const count = clampInt(slot.count, 1, RESOURCE_STACK_LIMIT);
    if (!Number.isFinite(blockId) || count <= 0) return null;
    return {
      itemId: "resource_block",
      kind: "resource",
      backpackSlotId: slot.backpackSlotId ? String(slot.backpackSlotId) : "",
      resourceId,
      blockId,
      count,
      ...equipmentSourceFields(slot),
      proof: slot.proof && typeof slot.proof === "object" ? normalizeProof(slot.proof) : null,
      metadata: clampInt(slot.metadata, 0, 0xffffffff),
      ...surfaceDecorationFields(slot),
    };
  }
  if (slot.itemId === "backpack") return { itemId: "backpack", locked: true };
  if (slot.itemId === "blueprint_tool") {
    const blueprintId = normalizeU64String(slot.blueprintId);
    const blueprintOwner = normalizeOwnerAddress(slot.blueprintOwner);
    if (ownerAddress && blueprintOwner && blueprintOwner !== ownerAddress) return null;
    const chainBacked = Boolean(slot.chainBackpack || slot.itemPda || Number.isInteger(slot.chainIndex));
    return {
      itemId: "blueprint_tool",
      kind: "blueprint",
      blueprintId,
      blueprintInstanceId: String(slot.blueprintInstanceId || (blueprintId ? `blueprint:${blueprintId}` : "")),
      blueprintOrdinal: clampInt(slot.blueprintOrdinal, 0, 0xffff),
      blueprintOwner,
      source: String(slot.source || ""),
      locked: slot.source === "test" || slot.locked === true,
      ...(chainBacked ? {
        sourceItemId: String(slot.sourceItemId || slot.id || ""),
        chainBackpack: String(slot.chainBackpack || ""),
        chainIndex: Number.isFinite(slot.chainIndex) ? Math.trunc(slot.chainIndex) : null,
        chainItemId: normalizeU64String(slot.chainItemId || blueprintId),
        itemCode: clampInt(slot.itemCode, 0, 65535),
        itemPda: String(slot.itemPda || ""),
      } : {}),
      ...equipmentSourceFields(slot),
    };
  }
  return null;
}

function normalizeU64String(value) {
  try {
    const normalized = BigInt(value ?? 0);
    return normalized > 0n && normalized <= 0xffffffffffffffffn ? normalized.toString() : "";
  } catch {
    return "";
  }
}

function normalizeMassGramsString(value) {
  try {
    const normalized = BigInt(value ?? 0);
    return (normalized >= 0n ? normalized : 0n).toString();
  } catch {
    return "0";
  }
}

function clearLegacyBackpackCache() {
  try {
    localStorage.removeItem(BACKPACK_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

function normalizeBackpackSlot(slot) {
  if (!slot || typeof slot !== "object") return null;
  if (slot.kind === "smelted_material") return normalizeSmeltedSlot(slot);
  if (slot.kind === "forged") return normalizeForgedBackpackSlot(slot);
  if (slot.kind === "blueprint") return normalizeBlueprintBackpackSlot(slot);
  const resourceId = clampInt(slot.resourceId, 0, 999);
  const count = pdaAwareSlotCount(slot, RESOURCE_STACK_LIMIT);
  return {
    id: String(slot.id || createLocalInventoryId(resourceId, slot.pendingTxId)),
    kind: "resource",
    resourceId,
    blockId: Number.isFinite(slot.blockId) ? Math.trunc(slot.blockId) : null,
    count,
    pendingTxId: null,
    pending: false,
    source: slot.source ? String(slot.source) : "",
    chainBackpack: slot.chainBackpack ? String(slot.chainBackpack) : "",
    chainIndex: Number.isFinite(slot.chainIndex) ? Math.trunc(slot.chainIndex) : null,
    proof: slot.proof && typeof slot.proof === "object" ? normalizeProof(slot.proof) : null,
    yieldBps: Number.isFinite(slot.yieldBps) ? clampInt(slot.yieldBps, 1, 10000) : null,
    volumeMm3: Number.isFinite(slot.volumeMm3) ? clampInt(slot.volumeMm3, 0, 0xffffffff) : null,
    volumeMilliLiters: Number.isFinite(slot.volumeMilliLiters) ? clampInt(slot.volumeMilliLiters, 0, 1000000) : null,
    massGrams: Number.isFinite(slot.massGrams) ? clampInt(slot.massGrams, 0, 0xffffffff) : null,
    metadata: clampInt(slot.metadata, 0, 0xffffffff),
    ...surfaceDecorationFields(slot),
  };
}

function surfaceDecorationFields(slot = {}) {
  return {
    decorationId: clampInt(slot.decorationId, 0, 0xffff),
    decorationRuleId: clampInt(slot.decorationRuleId, 0, 0xffff),
    decorationSurfaceBlockId: clampInt(slot.decorationSurfaceBlockId, 0, 0xffff),
    decorationVariant: clampInt(slot.decorationVariant, 0, 0xff),
    decorationFlags: clampInt(slot.decorationFlags, 0, 0xff),
    decorationVariantHash: clampInt(slot.decorationVariantHash, 0, 0xffffffff),
  };
}

function normalizeSmeltedSlot(slot) {
  const materialId = String(slot.materialId || "");
  if (!materialId) return null;
  return {
    id: String(slot.id || createLocalInventoryId(`mat-${materialId}`, slot.proofHash || slot.recipeId)),
    kind: "smelted_material",
    materialId,
    recipeId: String(slot.recipeId || ""),
    count: pdaAwareSlotCount(slot, MATERIAL_STACK_LIMIT),
    quality: clampInt(slot.quality, 0, 100),
    label: String(slot.label || materialId),
    className: String(slot.className || "Material"),
    previewColor: normalizeColor(slot.previewColor),
    materialProperties: slot.materialProperties && typeof slot.materialProperties === "object" ? slot.materialProperties : null,
    sourceProof: slot.sourceProof && typeof slot.sourceProof === "object" ? slot.sourceProof : null,
    proofHash: String(slot.proofHash || slot.sourceProof?.proofHash || ""),
    pendingTxId: null,
    pending: false,
    ...normalizePdaItemFields(slot),
  };
}

function normalizeForgedBackpackSlot(slot) {
  return {
    id: String(slot.id || `chain-forged-${slot.chainIndex ?? 0}-${slot.chainItemId || slot.itemCode || 0}`),
    kind: "forged",
    itemId: "forged_item",
    label: String(slot.label || `Forged Item #${slot.chainItemId || slot.itemCode || 0}`),
    className: String(slot.className || "Forged"),
    count: pdaAwareSlotCount(slot, MATERIAL_STACK_LIMIT),
    designHash: clampInt(slot.designHash, 0, 0xffffffff),
    pendingTxId: null,
    pending: false,
    ...normalizePdaItemFields(slot),
  };
}

function normalizeBlueprintBackpackSlot(slot) {
  const blueprintId = normalizeU64String(slot.blueprintId || slot.chainItemId);
  if (!blueprintId) return null;
  return {
    id: String(slot.id || `chain-blueprint-${slot.chainIndex ?? 0}-${blueprintId}`),
    kind: "blueprint",
    itemId: "blueprint_tool",
    label: String(slot.label || `Blueprint #${blueprintId}`),
    className: String(slot.className || "Blueprint"),
    count: 1,
    blueprintId,
    blueprintInstanceId: String(slot.blueprintInstanceId || (slot.itemPda ? `blueprint-pda:${slot.itemPda}` : `blueprint:${blueprintId}`)),
    blueprintOrdinal: clampInt(slot.blueprintOrdinal, 0, 0xffff),
    blueprintOwner: normalizeOwnerAddress(slot.blueprintOwner),
    locked: false,
    pendingTxId: null,
    pending: false,
    ...normalizePdaItemFields(slot),
  };
}

function blueprintHotbarSlotFromBackpack(slot, ownerAddress) {
  return normalizeHotbarSlot({
    ...slot,
    itemId: "blueprint_tool",
    kind: "blueprint",
    sourceItemId: slot.id,
    blueprintOwner: slot.blueprintOwner || ownerAddress,
    locked: false,
    custodySource: slot.custodySource || "backpack",
    sourceBackpackIndex: Number.isInteger(slot.sourceBackpackIndex) ? slot.sourceBackpackIndex : slot.chainIndex,
  }, { ownerAddress });
}

function hotbarSlotFromBackpack(slot, ownerAddress, modelBytes = null) {
  if (!slot) return null;
  if (slot.kind === "blueprint") return blueprintHotbarSlotFromBackpack(slot, ownerAddress);
  if (slot.kind === "forged") {
    const bytes = Array.isArray(modelBytes) || modelBytes instanceof Uint8Array
      ? Array.from(modelBytes)
      : slot.bytes;
    const normalized = normalizeForgedHotbarSlot({
      ...slot,
      itemId: FORGED_ITEM_ID,
      backpack: slot.chainBackpack,
      owner: ownerAddress || null,
      durability: slot.durabilityCurrent,
      maxDurability: slot.durabilityMax,
      ...(bytes?.length ? { bytes, code: "" } : {}),
    }, {
      defaultDurability: DEFAULT_PICKAXE_DURABILITY,
      ownerAddress,
    });
    return withEquipmentSource(normalized, {
      ...slot,
      custodySource: slot.custodySource || "backpack",
      sourceBackpackIndex: Number.isInteger(slot.sourceBackpackIndex) ? slot.sourceBackpackIndex : slot.chainIndex,
    });
  }
  if (slot.kind !== "resource") return null;
  return {
    itemId: "resource_block",
    kind: "resource",
    backpackSlotId: slot.id,
    resourceId: slot.resourceId,
    blockId: slot.blockId,
    count: slot.count,
    custodySource: slot.custodySource || "backpack",
    equipmentSlot: Number.isInteger(slot.equipmentSlot) ? slot.equipmentSlot : null,
    sourceBackpackIndex: Number.isInteger(slot.sourceBackpackIndex) ? slot.sourceBackpackIndex : slot.chainIndex,
    chainBackpack: String(slot.chainBackpack || ""),
    chainIndex: Number.isInteger(slot.chainIndex) ? slot.chainIndex : null,
    sourceItemId: String(slot.id || ""),
    proof: slot.proof && typeof slot.proof === "object" ? normalizeProof(slot.proof) : null,
    metadata: clampInt(slot.metadata, 0, 0xffffffff),
    ...surfaceDecorationFields(slot),
  };
}

function hotbarSlotFromEquipmentRecord(record, ownerAddress, equipmentSlot) {
  const raw = record?.backpackSlot;
  if (!record?.equipped || !record.custodied || !raw) return null;
  const backpack = String(record.backpack || "");
  const sourceBackpackIndex = Number.isInteger(Number(record.backpackIndex))
    ? Math.trunc(Number(record.backpackIndex))
    : null;
  const sourceId = equipmentRecordSourceId(raw, backpack, equipmentSlot);
  let backpackSlot = null;
  if (raw.kind === "block" || Number(raw.kindCode) === 1) {
    const resource = raw.resource || {};
    const blockId = Math.trunc(Number(resource.blockId) || 0);
    const metadata = Math.trunc(Number(raw.metadata) || 0) >>> 0;
    backpackSlot = normalizeBackpackSlot({
      id: sourceId,
      kind: "resource",
      resourceId: resourceIdForBlock(blockId),
      blockId,
      count: Math.max(1, Math.trunc(Number(raw.quantity) || 1)),
      source: "chain",
      chainBackpack: backpack,
      chainIndex: null,
      sourceBackpackIndex,
      custodySource: "equipment",
      equipmentSlot,
      volumeMm3: Math.max(0, Math.trunc(Number(raw.volumeMm3) || 0)),
      volumeMilliLiters: Math.max(0, Math.trunc((Number(raw.volumeMm3) || 0) / 1000)),
      metadata,
      decorationId: metadata & 0xffff,
      decorationRuleId: metadata >>> 16,
      proof: {
        worldX: Math.trunc(Number(resource.worldX) || 0),
        worldY: Math.trunc(Number(resource.worldY) || 0),
        worldZ: Math.trunc(Number(resource.worldZ) || 0),
        blockId,
      },
    });
  } else if (raw.kind === "item" || Number(raw.kindCode) === 2) {
    const category = Math.trunc(Number(raw.category) || 0);
    const itemCode = Math.trunc(Number(raw.itemCode) || 0);
    const chainItemId = normalizeU64String(raw.itemId);
    const common = {
      id: sourceId,
      count: Math.max(1, Math.trunc(Number(raw.quantity) || 1)),
      source: "chain",
      chainBackpack: backpack,
      chainIndex: null,
      sourceBackpackIndex,
      custodySource: "equipment",
      equipmentSlot,
      chainItemId,
      itemCode,
      itemPda: String(raw.itemPda || ""),
      volumeMm3: Math.max(0, Math.trunc(Number(raw.volumeMm3) || 0)),
      durabilityCurrent: Math.max(0, Math.trunc(Number(raw.durabilityCurrent) || 0)),
      durabilityMax: Math.max(0, Math.trunc(Number(raw.durabilityMax) || 0)),
      grade: Math.max(0, Math.trunc(Number(raw.grade) || 0)),
      itemLevel: Math.max(0, Math.trunc(Number(raw.itemLevel) || 0)),
      qualityBps: Math.max(0, Math.trunc(Number(raw.qualityBps) || 0)),
      metadata: Math.trunc(Number(raw.metadata) || 0) >>> 0,
    };
    if (category === CHAIN_ITEM_CATEGORY_BLUEPRINT && itemCode === CHAIN_BLUEPRINT_ITEM_CODE) {
      backpackSlot = normalizeBackpackSlot({
        ...common,
        kind: "blueprint",
        itemId: "blueprint_tool",
        blueprintId: chainItemId,
        blueprintOwner: ownerAddress,
        blueprintOrdinal: equipmentSlot + 1,
      });
    } else if (category === CHAIN_ITEM_CATEGORY_FORGED || itemCode === CHAIN_FORGED_ITEM_CODE) {
      backpackSlot = normalizeBackpackSlot({
        ...common,
        kind: "forged",
        itemId: FORGED_ITEM_ID,
        designHash: Math.trunc(Number(raw.metadata) || 0) >>> 0,
      });
    }
  }
  if (!backpackSlot) return null;
  const restored = hotbarSlotFromBackpack(backpackSlot, ownerAddress, record.modelBytes);
  return withEquipmentSource(restored, {
    ...backpackSlot,
    custodySource: "equipment",
    equipmentSlot,
    sourceBackpackIndex,
    chainBackpack: backpack,
    sourceItemId: sourceId,
  });
}

function equipmentRecordSourceId(record, backpack, equipmentSlot) {
  const itemId = normalizeU64String(record?.itemId);
  if (itemId) return `equipment-${backpack}-${equipmentSlot}-item-${itemId}`;
  const resource = record?.resource || {};
  return `equipment-${backpack}-${equipmentSlot}-block-${Math.trunc(Number(resource.worldX) || 0)},${Math.trunc(Number(resource.worldY) || 0)},${Math.trunc(Number(resource.worldZ) || 0)}`;
}

function equipmentChainReference(hotbarSlot, backpackSlots, slotIndex) {
  const identity = hotbarShortcutIdentity(hotbarSlot);
  if (!identity) return null;
  const directSource = String(hotbarSlot?.custodySource || "");
  const directBackpack = String(hotbarSlot?.chainBackpack || hotbarSlot?.backpack || "").trim();
  const directIndex = Number(
    directSource === "equipment" ? hotbarSlot?.sourceBackpackIndex : hotbarSlot?.chainIndex,
  );
  if (directBackpack && (directSource === "equipment" || directSource === "backpack")) {
    const equipmentSlot = Number(hotbarSlot?.equipmentSlot);
    if (directSource !== "equipment" || Number.isInteger(equipmentSlot) && equipmentSlot >= 0 && equipmentSlot < HOTBAR_SLOT_COUNT) {
      return equipmentReferenceFromHotbar(hotbarSlot, {
        slotIndex,
        sourceType: directSource,
        equipmentSlot: directSource === "equipment" ? equipmentSlot : null,
        backpackAddress: directBackpack,
        backpackIndex: Number.isInteger(directIndex) && directIndex >= 0 ? directIndex : 255,
      });
    }
  }
  const backpackSlot = (backpackSlots ?? []).find((slot) => backpackShortcutIdentity(slot) === identity);
  if (!backpackSlot || backpackSlot.source !== "chain") return null;
  const backpackAddress = String(backpackSlot.chainBackpack || "").trim();
  const backpackIndex = Number(backpackSlot.chainIndex);
  if (!backpackAddress || !Number.isInteger(backpackIndex) || backpackIndex < 0 || backpackIndex > 98) return null;
  return equipmentReferenceFromHotbar(hotbarSlot, {
    slotIndex,
    sourceType: "backpack",
    equipmentSlot: null,
    backpackAddress,
    backpackIndex,
    sourceSlot: backpackSlot,
  });
}

function equipmentReferenceFromHotbar(hotbarSlot, {
  slotIndex,
  sourceType,
  equipmentSlot,
  backpackAddress,
  backpackIndex,
  sourceSlot = hotbarSlot,
}) {
  const proof = sourceSlot?.proof || hotbarSlot?.proof || null;
  const isResource = hotbarSlot?.itemId === "resource_block";
  return {
    slot: slotIndex,
    sourceType,
    equipmentSlot,
    backpackAddress,
    backpackIndex,
    modelBytes: hotbarSlot?.itemId === FORGED_ITEM_ID ? Array.from(hotbarSlot.bytes ?? []) : [],
    kind: isResource ? "block" : "item",
    kindCode: isResource ? 1 : 2,
    chainItemId: String(sourceSlot?.chainItemId || hotbarSlot?.chainItemId || ""),
    itemCode: Number(sourceSlot?.itemCode ?? hotbarSlot?.itemCode) || 0,
    itemPda: String(sourceSlot?.itemPda || hotbarSlot?.itemPda || ""),
    sourceItemId: String(sourceSlot?.id || hotbarSlot?.sourceItemId || ""),
    blockId: Math.trunc(Number(sourceSlot?.blockId ?? hotbarSlot?.blockId) || 0),
    proof: proof ? normalizeProof(proof) : null,
    metadata: Math.trunc(Number(sourceSlot?.metadata ?? hotbarSlot?.metadata) || 0) >>> 0,
  };
}

function equipmentRecordMatchesBackpackSlot(record, slot) {
  if (!record?.equipped || !slot || slot.source !== "chain") return false;
  if (String(record.backpack || "") !== String(slot.chainBackpack || "")) return false;
  const source = record.backpackSlot;
  if (!source) return false;
  const itemId = normalizeU64String(source.itemId);
  if (source.kind === "item" || itemId) {
    return Boolean(itemId)
      && itemId === normalizeU64String(slot.chainItemId)
      && Number(source.itemCode) === Number(slot.itemCode)
      && (!source.itemPda || String(source.itemPda) === String(slot.itemPda || ""));
  }
  const proof = slot.proof || {};
  const resource = source.resource || {};
  const coordinateMatch = Number(resource.worldX) === Number(proof.worldX)
    && Number(resource.worldY) === Number(proof.worldY)
    && Number(resource.worldZ) === Number(proof.worldZ)
    && Number(resource.blockId) === Number(slot.blockId);
  return coordinateMatch || Number(record.backpackIndex) === Number(slot.chainIndex);
}

function cloneHotbarSlot(slot) {
  if (!slot || typeof slot !== "object") return null;
  return {
    ...slot,
    ...(Array.isArray(slot.bytes) || slot.bytes instanceof Uint8Array
      ? { bytes: Array.from(slot.bytes) }
      : {}),
  };
}

function normalizePdaItemFields(slot) {
  return {
    source: slot.source ? String(slot.source) : "",
    chainBackpack: slot.chainBackpack ? String(slot.chainBackpack) : "",
    chainIndex: Number.isFinite(slot.chainIndex) ? Math.trunc(slot.chainIndex) : null,
    chainItemId: String(slot.chainItemId || ""),
    itemCode: clampInt(slot.itemCode, 0, 65535),
    itemPda: String(slot.itemPda || ""),
    volumeMm3: clampInt(slot.volumeMm3, 0, 0xffffffff),
    massGrams: clampInt(slot.massGrams, 0, 0xffffffff),
    durabilityCurrent: clampInt(slot.durabilityCurrent, 0, 0xffffffff),
    durabilityMax: clampInt(slot.durabilityMax, 0, 0xffffffff),
    grade: clampInt(slot.grade, 0, 255),
    itemLevel: clampInt(slot.itemLevel, 0, 255),
    qualityBps: clampInt(slot.qualityBps, 0, 10000),
    metadata: clampInt(slot.metadata, 0, 0xffffffff),
  };
}

function pdaAwareSlotCount(slot, localLimit) {
  return clampInt(slot.count, 1, slot.source === "chain" ? 0xffffffff : localLimit);
}

function isPlaceableBackpackSlot(slot) {
  return Boolean(slot && !slot.pending && slot.count > 0 && (
    slot.kind === "forged" && normalizeDesignHashValue(slot.designHash) !== 0
    || slot.kind === "resource" && Number.isFinite(slot.blockId) && slot.blockId > 0
    || slot.kind === "blueprint" && Boolean(normalizeU64String(slot.blueprintId))
  ));
}

function normalizeDesignHashValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) >>> 0 : 0;
}

function isPlaceableHotbarSlot(slot) {
  return Boolean(slot && slot.itemId === "resource_block" && Number.isFinite(slot.blockId) && slot.blockId > 0 && Number.isFinite(slot.count) && slot.count > 0);
}

function isMiningToolSlot(slot) {
  return Boolean(slot && (slot.itemId === "iron_pickaxe" || isForgedHotbarSlot(slot)));
}

function isUsableMiningToolSlot(slot) {
  if (!isMiningToolSlot(slot) || Math.trunc(slot.durability || 0) <= 0) return false;
  return slot.itemId === "iron_pickaxe" || isForgedMiningToolReady(slot);
}

function loadPlayerProfile(ownerAddress = "") {
  const parsed = loadJson(walletScopedPlayStorageKey(PLAYER_PROFILE_STORAGE_KEY, ownerAddress), null);
  if (parsed && typeof parsed === "object") return normalizePlayerProfile(parsed);
  return normalizePlayerProfile({});
}

function normalizePlayerProfile(profile) {
  return {
    name: String(profile.name || "Sora"),
    title: String(profile.title || "Explorer"),
    gender: String(profile.gender || "male").toLowerCase() === "female" ? "female" : "male",
    modelCode: String(profile.modelCode || "NCM:peasant_guy:v1"),
    minedBlocks: clampInt(profile.minedBlocks, 0, 999999999),
    confirmedMines: clampInt(profile.confirmedMines, 0, 999999999),
    rolledBackMines: clampInt(profile.rolledBackMines, 0, 999999999),
    resourcesCollected: clampInt(profile.resourcesCollected, 0, 999999999),
    placedBlocks: clampInt(profile.placedBlocks, 0, 999999999),
    confirmedPlacements: clampInt(profile.confirmedPlacements, 0, 999999999),
    rolledBackPlacements: clampInt(profile.rolledBackPlacements, 0, 999999999),
    smeltingRuns: clampInt(profile.smeltingRuns, 0, 999999999),
    materialsSmelted: clampInt(profile.materialsSmelted, 0, 999999999),
  };
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

function normalizeOwnerAddress(value) {
  return String(value ?? "").trim();
}

function createLocalInventoryId(resourceId, pendingTxId) {
  const suffix = pendingTxId ? String(pendingTxId) : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `bp-${resourceId}-${suffix}`;
}

function normalizeColor(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  return value.slice(0, 3).map((entry) => clampInt(entry, 0, 255));
}

function normalizeProof(proof) {
  return {
    worldX: clampInt(proof.worldX, -2147483648, 2147483647),
    worldY: clampInt(proof.worldY, -32768, 32767),
    worldZ: clampInt(proof.worldZ, -2147483648, 2147483647),
    blockId: clampInt(proof.blockId, 0, 65535),
    chunkX: clampInt(proof.chunkX, -2147483648, 2147483647),
    chunkZ: clampInt(proof.chunkZ, -2147483648, 2147483647),
  };
}

function backpackSlotsSignature(slots) {
  return (slots || []).map((slot) => [
    slot?.id || "",
    slot?.kind || "",
    slot?.resourceId ?? "",
    slot?.blockId ?? "",
    slot?.count ?? "",
    slot?.pending ? 1 : 0,
    slot?.pendingTxId || "",
    slot?.yieldBps ?? "",
    slot?.volumeMilliLiters ?? "",
    slot?.volumeMm3 ?? "",
    slot?.massGrams ?? "",
    slot?.source || "",
    slot?.chainBackpack || "",
    slot?.chainIndex ?? "",
    slot?.chainItemId || "",
    slot?.itemCode ?? "",
    slot?.durabilityCurrent ?? "",
    slot?.durabilityMax ?? "",
    slot?.grade ?? "",
    slot?.itemLevel ?? "",
    slot?.qualityBps ?? "",
    slot?.metadata ?? "",
    slot?.blueprintId ?? "",
    slot?.blueprintInstanceId ?? "",
    slot?.blueprintOwner ?? "",
    slot?.decorationId ?? "",
    slot?.decorationRuleId ?? "",
    slot?.decorationSurfaceBlockId ?? "",
    slot?.decorationVariant ?? "",
    slot?.decorationFlags ?? "",
    slot?.decorationVariantHash ?? "",
  ].join(":")).join("|");
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.trunc(Number.isFinite(value) ? value : min)));
}
