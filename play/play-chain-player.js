import { loadPlayChainModule } from "./play-chain-adapter.js";

const PLAYER_SYNC_INTERVAL_MS = 18_000;
const PLAYER_POSITION_SAVE_INTERVAL_MS = 30_000;
const PLAYER_POSITION_MIN_DISTANCE_BLOCKS = 4;
const PLAYER_POSITION_MIN_DISTANCE_SQ = PLAYER_POSITION_MIN_DISTANCE_BLOCKS * PLAYER_POSITION_MIN_DISTANCE_BLOCKS;
const PLAYER_POSITION_SAVE_REASON_RESOURCE_MINE = "resource-mine-confirm";
const EQUIPMENT_MIGRATION_RETRY_MS = 60_000;

export function createPlayChainPlayerSync({
  getWalletAddress = () => "",
  getGameState = () => null,
  refreshBackpack = () => Promise.resolve(null),
  onChanged = () => {},
  onStatus = () => {},
  appendEvent = () => {},
  translate = (_key, fallback, params = {}) => formatMessage(fallback, params),
} = {}) {
  const ui = (key, fallback, params = {}) => {
    try {
      const value = translate(key, fallback, params);
      if (value && value !== key) return String(value);
    } catch {
      // Equipment persistence remains available if a locale formatter fails.
    }
    return formatMessage(fallback, params);
  };
  const state = {
    loading: false,
    lastSyncAt: 0,
    lastError: "",
    owner: "",
    profile: null,
    equipment: null,
    equipmentReadKnown: false,
    appearance: null,
    progress: null,
    skillXp: null,
    nameMutation: {
      saving: false,
      lastAttemptAt: 0,
      lastSubmittedAt: 0,
      lastSignature: "",
      lastError: "",
      lastPlayerName: "",
      lastReason: "",
    },
    appearanceMutation: {
      saving: false,
      lastAttemptAt: 0,
      lastSubmittedAt: 0,
      lastSignature: "",
      lastError: "",
      lastPlayerName: "",
      lastTitle: "",
      lastGender: "",
      lastModelCode: "",
      lastReason: "",
    },
    positionSync: {
      saving: false,
      queued: null,
      lastAttemptAt: 0,
      lastSavedAt: 0,
      lastSubmittedAt: 0,
      lastSavedKey: "",
      lastSavedPosition: null,
      lastSignature: "",
      lastError: "",
      lastReason: "",
    },
    equipmentMutation: {
      saving: false,
      pending: 0,
      lastAttemptAt: 0,
      lastSubmittedAt: 0,
      lastSignature: "",
      lastError: "",
      lastReason: "",
      migrationSignature: "",
      migrationAttemptedAt: 0,
    },
  };
  const pendingEquipmentChanges = new Map();
  let equipmentFlushScheduled = false;

  return {
    refresh,
    upsertProfileName,
    upsertAppearance,
    requestPositionSave,
    queueEquipmentChanges,
    applyEquipmentSnapshot,
    migrateEquipmentIfNeeded,
    snapshot,
    displayIdentity,
  };

  function snapshot() {
    return {
      loading: state.loading,
      lastSyncAt: state.lastSyncAt,
      lastError: state.lastError,
      owner: state.owner,
      profile: state.profile,
      equipment: state.equipment,
      equipmentReadKnown: state.equipmentReadKnown,
      appearance: state.appearance,
      progress: state.progress,
      skillXp: state.skillXp,
      nameMutation: nameMutationSnapshot(),
      appearanceMutation: appearanceMutationSnapshot(),
      positionSync: positionSyncSnapshot(),
      equipmentMutation: equipmentMutationSnapshot(),
      identity: displayIdentity(),
    };
  }

  function displayIdentity() {
    const appearanceName = cleanText(state.appearance?.displayName);
    const profileName = cleanText(state.profile?.playerName);
    const title = cleanText(state.appearance?.title);
    return {
      name: appearanceName || profileName || "",
      title,
      position: state.profile?.position || null,
      initialized: Boolean(state.profile?.initialized || state.appearance?.initialized),
    };
  }

  async function refresh({ force = false, quiet = true } = {}) {
    const wallet = String(getWalletAddress() || "").trim();
    if (!wallet) {
      clearState("wallet-unavailable");
      return { ok: false, reason: "wallet-unavailable" };
    }
    const now = performance.now();
    if (state.loading) return { ok: false, reason: "already-loading" };
    if (!force && state.owner === wallet && now - state.lastSyncAt < PLAYER_SYNC_INTERVAL_MS) return { ok: false, reason: "cooldown" };

    state.loading = true;
    state.owner = wallet;
    try {
      const module = await loadPlayChainModule();
      const [profileResult, equipmentResult, appearanceResult, progressResult] = await Promise.allSettled([
        typeof module.fetchPlayerProfileForOwner === "function" ? module.fetchPlayerProfileForOwner(wallet) : Promise.resolve(null),
        typeof module.fetchPlayerEquipmentForOwner === "function" ? module.fetchPlayerEquipmentForOwner(wallet) : Promise.resolve(null),
        typeof module.fetchPlayerAppearanceForOwner === "function" ? module.fetchPlayerAppearanceForOwner(wallet) : Promise.resolve(null),
        typeof module.fetchPlayerProgress === "function" ? module.fetchPlayerProgress(wallet) : Promise.resolve(null),
      ]);
      const nextProfile = settledValue(profileResult);
      const nextEquipment = settledValue(equipmentResult);
      const nextAppearance = settledValue(appearanceResult);
      const nextProgress = settledValue(progressResult);
      const nextSkillXp = skillXpFromProgress(nextProgress, nextProfile);
      const previousSignature = stateSignature(state);
      state.profile = nextProfile?.initialized === false ? null : nextProfile;
      state.equipmentReadKnown = equipmentResult?.status === "fulfilled";
      state.equipment = nextEquipment?.initialized === false ? null : nextEquipment;
      state.appearance = nextAppearance?.initialized === false ? null : nextAppearance;
      state.progress = nextProgress;
      state.skillXp = nextSkillXp;
      state.lastError = firstRejectedReason(profileResult, equipmentResult, appearanceResult, progressResult);
      state.lastSyncAt = performance.now();
      applyEquipmentSnapshot();
      migrateEquipmentIfNeeded();
      const changed = previousSignature !== stateSignature(state);
      if (changed) onChanged(snapshot());
      if (!quiet) {
        const identity = displayIdentity();
        const label = identity.name || shortAddress(wallet);
        appendEvent(`Player PDA synced for ${label}.`);
        onStatus(`Player PDA synced: ${label}.`);
      }
      return { ok: true, changed, profile: state.profile, equipment: state.equipment, appearance: state.appearance, progress: state.progress, skillXp: state.skillXp };
    } catch (error) {
      const reason = readableError(error);
      state.lastError = reason;
      state.lastSyncAt = performance.now();
      if (!quiet) {
        appendEvent(`Player PDA sync failed: ${reason}.`);
        onStatus(`Player PDA sync failed: ${reason}.`);
      }
      return { ok: false, reason };
    } finally {
      state.loading = false;
    }
  }

  function clearState(reason = "") {
    const hadData = Boolean(state.owner || state.profile || state.equipment || state.appearance || state.progress || state.skillXp || state.lastError);
    state.owner = "";
    state.profile = null;
    state.equipment = null;
    state.equipmentReadKnown = false;
    state.appearance = null;
    state.progress = null;
    state.skillXp = null;
    state.nameMutation.lastReason = reason;
    state.nameMutation.lastError = "";
    state.nameMutation.lastSignature = "";
    state.nameMutation.lastPlayerName = "";
    state.appearanceMutation.lastReason = reason;
    state.appearanceMutation.lastError = "";
    state.appearanceMutation.lastSignature = "";
    state.appearanceMutation.lastPlayerName = "";
    state.appearanceMutation.lastTitle = "";
    state.appearanceMutation.lastGender = "";
    state.appearanceMutation.lastModelCode = "";
    state.positionSync.queued = null;
    state.positionSync.lastSavedKey = "";
    state.positionSync.lastSavedPosition = null;
    state.positionSync.lastSignature = "";
    state.positionSync.lastReason = reason;
    pendingEquipmentChanges.clear();
    state.equipmentMutation.pending = 0;
    state.equipmentMutation.lastReason = reason;
    state.equipmentMutation.lastError = "";
    state.equipmentMutation.migrationSignature = "";
    state.equipmentMutation.migrationAttemptedAt = 0;
    state.lastError = reason;
    state.lastSyncAt = performance.now();
    if (hadData) onChanged(snapshot());
  }

  async function upsertProfileName(playerName, { quiet = false } = {}) {
    const wallet = String(getWalletAddress() || "").trim();
    if (!wallet) return skippedNameMutation("wallet-unavailable");

    const normalized = normalizePlayerName(playerName);
    if (!normalized) return skippedNameMutation("empty-player-name");
    if (state.nameMutation.saving) return { ok: false, reason: "already-saving" };

    const mutation = state.nameMutation;
    mutation.saving = true;
    mutation.lastAttemptAt = performance.now();
    mutation.lastReason = "submit";
    mutation.lastError = "";
    mutation.lastPlayerName = normalized;
    onChanged(snapshot());
    try {
      const module = await loadPlayChainModule();
      if (typeof module.upsertPlayerProfileName !== "function") {
        mutation.lastError = "upsert-profile-unavailable";
        return { ok: false, reason: mutation.lastError };
      }
      const result = await module.upsertPlayerProfileName(normalized);
      if (!result?.submitted) {
        const reason = String(result?.reason || "not-submitted");
        mutation.lastReason = reason;
        mutation.lastError = reason === "unchanged" ? "" : reason;
        if (reason === "unchanged") {
          if (state.profile) state.profile = { ...state.profile, initialized: true, playerName: normalized };
          if (!quiet) {
            appendEvent(`Player name already set to ${normalized}.`);
            onStatus(`Player name already set: ${normalized}.`);
          }
          onChanged(snapshot());
          return { ok: true, unchanged: true, playerName: normalized, result };
        }
        if (!quiet) {
          appendEvent(`Player profile save skipped: ${reason}.`);
          onStatus(`Player profile save skipped: ${reason}.`);
        }
        onChanged(snapshot());
        return { ok: false, reason, result };
      }

      const savedName = normalizePlayerName(result.playerName || normalized) || normalized;
      mutation.lastSubmittedAt = Date.now();
      mutation.lastSignature = String(result.signature || "");
      mutation.lastPlayerName = savedName;
      mutation.lastReason = "saved";
      mutation.lastError = "";
      if (state.profile) {
        state.profile = { ...state.profile, initialized: true, playerName: savedName, publicKey: result.playerProfile || state.profile.publicKey };
      } else {
        state.profile = { initialized: true, playerName: savedName, publicKey: result.playerProfile || "", owner: wallet };
      }
      if (!quiet) {
        appendEvent(`Player profile saved ${savedName} (${shortSignature(mutation.lastSignature)}).`);
        onStatus(`Player profile saved on chain: ${savedName}.`);
      }
      onChanged(snapshot());
      await refresh({ force: true, quiet: true });
      return { ok: true, submitted: true, signature: mutation.lastSignature, playerName: savedName, result };
    } catch (error) {
      mutation.lastError = readableError(error);
      mutation.lastReason = "error";
      if (!quiet) {
        appendEvent(`Player profile save failed: ${mutation.lastError}.`);
        onStatus(`Player profile save failed: ${mutation.lastError}.`);
      }
      onChanged(snapshot());
      return { ok: false, reason: mutation.lastError };
    } finally {
      mutation.saving = false;
      onChanged(snapshot());
    }
  }

  async function upsertAppearance({
    playerName,
    title = "",
    gender = "male",
    ncmCode = "",
  } = {}, { quiet = false } = {}) {
    const wallet = String(getWalletAddress() || "").trim();
    if (!wallet) return skippedAppearanceMutation("wallet-unavailable");

    const normalizedName = normalizePlayerName(playerName || state.profile?.playerName || state.appearance?.displayName);
    if (!normalizedName) return skippedAppearanceMutation("empty-player-name");
    const normalizedTitle = normalizeTitle(title);
    const normalizedGender = normalizeGender(gender);
    const normalizedCode = normalizeModelCode(ncmCode);
    if (!normalizedCode) return skippedAppearanceMutation("invalid-character-code");
    if (state.appearanceMutation.saving) return { ok: false, reason: "already-saving" };

    const mutation = state.appearanceMutation;
    mutation.saving = true;
    mutation.lastAttemptAt = performance.now();
    mutation.lastReason = "submit";
    mutation.lastError = "";
    mutation.lastPlayerName = normalizedName;
    mutation.lastTitle = normalizedTitle;
    mutation.lastGender = normalizedGender;
    mutation.lastModelCode = normalizedCode;
    onChanged(snapshot());
    try {
      const module = await loadPlayChainModule();
      if (typeof module.createPlayerAppearanceOnChain !== "function") {
        mutation.lastError = "appearance-save-unavailable";
        return { ok: false, reason: mutation.lastError };
      }
      const result = await module.createPlayerAppearanceOnChain({
        playerName: normalizedName,
        title: normalizedTitle,
        gender: normalizedGender,
        ncmCode: normalizedCode,
      });
      if (!result?.submitted) {
        const reason = String(result?.reason || "not-submitted");
        mutation.lastReason = reason;
        mutation.lastError = reason;
        if (!quiet) {
          appendEvent(`Player appearance save skipped: ${reason}.`);
          onStatus(`Player appearance save skipped: ${reason}.`);
        }
        onChanged(snapshot());
        return { ok: false, reason, result };
      }

      mutation.lastSubmittedAt = Date.now();
      mutation.lastSignature = String(result.signature || "");
      mutation.lastReason = "saved";
      mutation.lastError = "";
      const savedGender = result.gender === "female" ? "female" : normalizedGender;
      if (state.profile) {
        state.profile = { ...state.profile, initialized: true, playerName: normalizedName, publicKey: result.playerProfile || state.profile.publicKey };
      } else {
        state.profile = { initialized: true, playerName: normalizedName, publicKey: result.playerProfile || "", owner: wallet };
      }
      state.appearance = {
        ...(state.appearance || {}),
        initialized: true,
        publicKey: result.appearance || state.appearance?.publicKey || "",
        owner: wallet,
        displayName: normalizedName,
        title: normalizedTitle,
        gender: savedGender,
        modelKind: savedGender === "female" ? 2 : 1,
        modelCode: normalizedCode,
      };
      if (!quiet) {
        appendEvent(`Player appearance saved ${normalizedName} (${shortSignature(mutation.lastSignature)}).`);
        onStatus(`Player appearance saved on chain: ${normalizedName}.`);
      }
      onChanged(snapshot());
      await refresh({ force: true, quiet: true });
      return { ok: true, submitted: true, signature: mutation.lastSignature, appearance: state.appearance, result };
    } catch (error) {
      mutation.lastError = readableError(error);
      mutation.lastReason = "error";
      if (!quiet) {
        appendEvent(`Player appearance save failed: ${mutation.lastError}.`);
        onStatus(`Player appearance save failed: ${mutation.lastError}.`);
      }
      onChanged(snapshot());
      return { ok: false, reason: mutation.lastError };
    } finally {
      mutation.saving = false;
      onChanged(snapshot());
    }
  }

  async function requestPositionSave(position, { force = false, quiet = true, reason = "frame", minedBlock = null } = {}) {
    const saveReason = String(reason || "");
    if (saveReason !== PLAYER_POSITION_SAVE_REASON_RESOURCE_MINE) {
      return skippedPositionSave("resource-mine-only");
    }
    if (!minedBlock) {
      return skippedPositionSave("resource-mine-block-required");
    }

    const wallet = String(getWalletAddress() || "").trim();
    if (!wallet) return skippedPositionSave("wallet-unavailable");
    if (!state.profile?.initialized) return skippedPositionSave("player-profile-uninitialized");

    const normalized = normalizeChainPosition(position);
    if (!normalized) return skippedPositionSave("invalid-position");

    const now = performance.now();
    const key = positionKey(normalized);
    const sync = state.positionSync;
    if (!force && key === sync.lastSavedKey) return skippedPositionSave("unchanged");
    if (!force && now - sync.lastAttemptAt < PLAYER_POSITION_SAVE_INTERVAL_MS) return skippedPositionSave("cooldown");

    const baseline = sync.lastSavedPosition || state.profile?.position || null;
    if (!force && baseline && positionDistanceSq(normalized, baseline) < PLAYER_POSITION_MIN_DISTANCE_SQ) {
      return skippedPositionSave("below-distance-threshold");
    }

    if (sync.saving) {
      sync.queued = { position: normalized, force, quiet, reason: saveReason, minedBlock };
      return { ok: false, queued: true, reason: "already-saving" };
    }

    sync.saving = true;
    sync.lastAttemptAt = now;
    sync.lastReason = saveReason;
    sync.lastError = "";
    try {
      const module = await loadPlayChainModule();
      if (typeof module.updatePlayerPositionOnChain !== "function") {
        sync.lastError = "update-position-unavailable";
        return { ok: false, reason: sync.lastError };
      }
      const result = await module.updatePlayerPositionOnChain(normalized, {
        prompt: false,
        reason: PLAYER_POSITION_SAVE_REASON_RESOURCE_MINE,
        minedBlock,
      });
      if (!result?.submitted) {
        sync.lastError = String(result?.reason || "not-submitted");
        if (!quiet && sync.lastError !== "wallet-unavailable") {
          appendEvent(`Player position not saved: ${sync.lastError}.`);
          onStatus(`Player position not saved: ${sync.lastError}.`);
        }
        onChanged(snapshot());
        return { ok: false, reason: sync.lastError, result };
      }

      const saved = normalizeChainPosition(result.position || normalized) || normalized;
      sync.lastSavedAt = performance.now();
      sync.lastSubmittedAt = Date.now();
      sync.lastSavedPosition = saved;
      sync.lastSavedKey = positionKey(saved);
      sync.lastSignature = String(result.signature || "");
      sync.lastError = "";
      if (state.profile) state.profile = { ...state.profile, position: saved };
      if (!quiet) {
        appendEvent(`Player position saved ${saved.x},${saved.y},${saved.z} (${shortSignature(sync.lastSignature)}).`);
        onStatus(`Player position saved on chain: ${saved.x},${saved.y},${saved.z}.`);
      }
      onChanged(snapshot());
      return { ok: true, submitted: true, signature: sync.lastSignature, position: saved, result };
    } catch (error) {
      sync.lastError = readableError(error);
      if (!quiet) {
        appendEvent(`Player position save failed: ${sync.lastError}.`);
        onStatus(`Player position save failed: ${sync.lastError}.`);
      }
      onChanged(snapshot());
      return { ok: false, reason: sync.lastError };
    } finally {
      sync.saving = false;
      const queued = sync.queued;
      sync.queued = null;
      if (queued) {
        setTimeout(() => {
          requestPositionSave(queued.position, {
            force: queued.force,
            quiet: queued.quiet,
            reason: queued.reason || "queued",
            minedBlock: queued.minedBlock,
          });
        }, 0);
      }
    }
  }

  function applyEquipmentSnapshot({ force = false } = {}) {
    if (!force && (state.equipmentMutation.saving || pendingEquipmentChanges.size)) {
      return { changed: false, reason: "equipment-mutation-pending" };
    }
    if (!state.equipment?.initialized) return { changed: false, reason: "equipment-uninitialized" };
    return getGameState()?.restoreChainEquipmentSlots?.(state.equipment, { authoritative: true })
      ?? { changed: false, reason: "game-state-unavailable" };
  }

  function migrateEquipmentIfNeeded() {
    if (!state.equipmentReadKnown) return { ok: false, reason: "equipment-read-pending" };
    const legacyRecords = state.equipment?.initialized
      ? (state.equipment.slots ?? []).filter((slot) => slot?.equipped && !slot.custodied)
      : [];
    if (state.equipment?.initialized && !legacyRecords.length) {
      return { ok: false, reason: "equipment-custody-current" };
    }
    if (state.equipmentMutation.saving || pendingEquipmentChanges.size) {
      return { ok: false, reason: "equipment-save-pending" };
    }
    const gameState = getGameState();
    if (!gameState?.backpackStatusKnown) return { ok: false, reason: "backpack-read-pending" };
    const changes = equipmentMigrationChanges(gameState, state.equipment);
    if (!changes.length) return { ok: false, reason: "no-equipment-to-migrate" };
    // Each successful transfer compacts Backpack indexes. Migrate one record,
    // refresh both PDAs, then resolve the next record from the fresh snapshot.
    const nextChanges = changes.slice(0, 1);
    const signature = equipmentMigrationSignature(nextChanges);
    const now = Date.now();
    if (
      state.equipmentMutation.migrationSignature === signature
      && now - state.equipmentMutation.migrationAttemptedAt < EQUIPMENT_MIGRATION_RETRY_MS
    ) {
      return { ok: false, reason: "equipment-migration-cooldown" };
    }
    state.equipmentMutation.migrationSignature = signature;
    state.equipmentMutation.migrationAttemptedAt = now;
    return queueEquipmentChanges({
      ownerAddress: state.owner,
      changes: nextChanges,
      reason: "equipment-pda-migration",
    });
  }

  function queueEquipmentChanges(mutation = {}) {
    const wallet = String(getWalletAddress() || "").trim();
    if (!wallet || (mutation.ownerAddress && mutation.ownerAddress !== wallet)) {
      return { ok: false, reason: "wallet-unavailable" };
    }
    let queued = 0;
    for (const change of mutation.changes ?? []) {
      const index = Number(change?.index);
      if (!Number.isInteger(index) || index < 0 || index >= 9) continue;
      const existing = pendingEquipmentChanges.get(index);
      pendingEquipmentChanges.set(index, {
        ...change,
        index,
        before: existing?.before ?? change.before ?? null,
      });
      queued += 1;
    }
    state.equipmentMutation.pending = pendingEquipmentChanges.size;
    if (!queued) return { ok: false, reason: "no-equipment-changes" };
    scheduleEquipmentFlush();
    onChanged(snapshot());
    return { ok: true, queued };
  }

  function scheduleEquipmentFlush() {
    if (equipmentFlushScheduled || state.equipmentMutation.saving) return;
    equipmentFlushScheduled = true;
    const schedule = typeof queueMicrotask === "function"
      ? queueMicrotask
      : (callback) => Promise.resolve().then(callback);
    schedule(() => {
      equipmentFlushScheduled = false;
      void flushEquipmentChanges();
    });
  }

  async function flushEquipmentChanges() {
    if (state.equipmentMutation.saving || !pendingEquipmentChanges.size) return;
    const batch = Array.from(pendingEquipmentChanges.values()).sort((left, right) => left.index - right.index);
    pendingEquipmentChanges.clear();
    const mutation = state.equipmentMutation;
    mutation.saving = true;
    mutation.pending = 0;
    mutation.lastAttemptAt = performance.now();
    mutation.lastReason = "submit";
    mutation.lastError = "";
    onChanged(snapshot());
    try {
      const module = await loadPlayChainModule();
      if (typeof module.setPlayerEquipmentSlotsOnChain !== "function") {
        throw new Error("equipment-save-unavailable");
      }
      const result = await module.setPlayerEquipmentSlotsOnChain(batch.map((change) => ({
        slot: change.index,
        beforeReference: change.beforeReference || null,
        reference: change.reference || null,
      })));
      if (!result?.submitted) throw new Error(String(result?.reason || "equipment-not-submitted"));
      mutation.lastSubmittedAt = Date.now();
      mutation.lastSignature = String(result.signature || "");
      mutation.lastReason = "saved";
      mutation.lastError = "";
      state.equipment = result.equipment?.initialized ? result.equipment : state.equipment;
      state.equipmentReadKnown = true;
      await refreshBackpack({ force: true, quiet: true });
      if (!pendingEquipmentChanges.size) applyEquipmentSnapshot({ force: true });
      appendEvent(ui("main.equipment.chainSaved", "Equipment saved on chain ({signature}).", {
        signature: shortSignature(mutation.lastSignature),
      }));
    } catch (error) {
      mutation.lastError = readableError(error);
      mutation.lastReason = "error";
      const rollback = batch.filter((change) => !pendingEquipmentChanges.has(change.index));
      getGameState()?.restoreEquipmentMutation?.(rollback);
      const failure = ui("main.equipment.chainSaveFailed", "Equipment chain save failed: {reason}.", {
        reason: mutation.lastError,
      });
      appendEvent(failure);
      onStatus(failure);
      try {
        const module = await loadPlayChainModule();
        const [equipment] = await Promise.all([
          typeof module.fetchPlayerEquipmentForOwner === "function"
            ? module.fetchPlayerEquipmentForOwner(String(getWalletAddress() || ""))
            : Promise.resolve(state.equipment),
          refreshBackpack({ force: true, quiet: true }),
        ]);
        state.equipment = equipment?.initialized ? equipment : null;
        state.equipmentReadKnown = true;
        if (!pendingEquipmentChanges.size) applyEquipmentSnapshot({ force: true });
      } catch {
        // Keep the explicit local rollback when the recovery read is unavailable.
      }
    } finally {
      mutation.saving = false;
      mutation.pending = pendingEquipmentChanges.size;
      onChanged(snapshot());
      if (pendingEquipmentChanges.size) scheduleEquipmentFlush();
      else setTimeout(() => migrateEquipmentIfNeeded(), 0);
    }
  }

  function skippedPositionSave(reason) {
    state.positionSync.lastReason = reason;
    return { ok: false, reason };
  }

  function positionSyncSnapshot() {
    const sync = state.positionSync;
    return {
      saving: sync.saving,
      queued: Boolean(sync.queued),
      lastAttemptAt: sync.lastAttemptAt,
      lastSavedAt: sync.lastSavedAt,
      lastSubmittedAt: sync.lastSubmittedAt,
      lastSavedPosition: sync.lastSavedPosition,
      lastSignature: sync.lastSignature,
      lastError: sync.lastError,
      lastReason: sync.lastReason,
    };
  }

  function equipmentMutationSnapshot() {
    return { ...state.equipmentMutation, pending: pendingEquipmentChanges.size };
  }

  function nameMutationSnapshot() {
    const mutation = state.nameMutation;
    return {
      saving: mutation.saving,
      lastAttemptAt: mutation.lastAttemptAt,
      lastSubmittedAt: mutation.lastSubmittedAt,
      lastSignature: mutation.lastSignature,
      lastError: mutation.lastError,
      lastPlayerName: mutation.lastPlayerName,
      lastReason: mutation.lastReason,
    };
  }

  function appearanceMutationSnapshot() {
    const mutation = state.appearanceMutation;
    return {
      saving: mutation.saving,
      lastAttemptAt: mutation.lastAttemptAt,
      lastSubmittedAt: mutation.lastSubmittedAt,
      lastSignature: mutation.lastSignature,
      lastError: mutation.lastError,
      lastPlayerName: mutation.lastPlayerName,
      lastTitle: mutation.lastTitle,
      lastGender: mutation.lastGender,
      lastModelCode: mutation.lastModelCode,
      lastReason: mutation.lastReason,
    };
  }

  function skippedNameMutation(reason) {
    state.nameMutation.lastReason = reason;
    state.nameMutation.lastError = reason;
    onChanged(snapshot());
    return { ok: false, reason };
  }

  function skippedAppearanceMutation(reason) {
    state.appearanceMutation.lastReason = reason;
    state.appearanceMutation.lastError = reason;
    onChanged(snapshot());
    return { ok: false, reason };
  }
}

function settledValue(result) {
  return result?.status === "fulfilled" ? result.value || null : null;
}

function firstRejectedReason(...results) {
  const rejected = results.find((result) => result?.status === "rejected");
  return rejected ? readableError(rejected.reason) : "";
}

function skillXpFromProgress(progress, profile) {
  const result = {};
  const precision = positiveInt(progress?.precisionGatheringXp);
  const smelting = positiveInt(progress?.smeltingXp);
  const exploration = positiveInt(progress?.explorationXp);
  const forging = positiveInt(profile?.forgingXp);
  if (precision) result.precisionGathering = precision;
  if (smelting) result.smelting = smelting;
  if (exploration) result.exploration = exploration;
  if (forging) result.forging = forging;
  return Object.keys(result).length ? result : null;
}

function stateSignature(state) {
  return JSON.stringify({
    owner: state.owner,
    profile: state.profile ? {
      publicKey: state.profile.publicKey,
      playerName: state.profile.playerName,
      position: state.profile.position,
      equippedBackpack: state.profile.equippedBackpack,
      forgingXp: state.profile.forgingXp,
    } : null,
    equipment: state.equipment ? {
      publicKey: state.equipment.publicKey,
      updatedSlot: state.equipment.updatedSlot,
      slots: (state.equipment.slots ?? []).map((slot) => ({
        slot: slot.slot,
        equipped: slot.equipped,
        custodied: slot.custodied,
        backpack: slot.backpack,
        backpackIndex: slot.backpackIndex,
        itemId: slot.backpackSlot?.itemId,
        itemCode: slot.backpackSlot?.itemCode,
        metadata: slot.backpackSlot?.metadata,
        modelByteLength: slot.modelBytes?.length || 0,
      })),
    } : null,
    appearance: state.appearance ? {
      publicKey: state.appearance.publicKey,
      displayName: state.appearance.displayName,
      title: state.appearance.title,
      gender: state.appearance.gender,
      modelKind: state.appearance.modelKind,
      modelCode: state.appearance.modelCode,
      updatedSlot: state.appearance.updatedSlot,
    } : null,
    progress: state.progress ? {
      publicKey: state.progress.publicKey,
      precisionGatheringXp: state.progress.precisionGatheringXp,
      smeltingXp: state.progress.smeltingXp,
      explorationXp: state.progress.explorationXp,
    } : null,
    skillXp: state.skillXp,
    equipmentMutation: equipmentMutationSignature(state.equipmentMutation),
    lastError: state.lastError,
  });
}

function equipmentMutationSignature(mutation = {}) {
  return {
    saving: Boolean(mutation.saving),
    pending: Number(mutation.pending) || 0,
    lastSubmittedAt: Number(mutation.lastSubmittedAt) || 0,
    lastSignature: String(mutation.lastSignature || ""),
    lastError: String(mutation.lastError || ""),
    lastReason: String(mutation.lastReason || ""),
  };
}

function equipmentMigrationSignature(changes = []) {
  return JSON.stringify(changes.map((change) => ({
    slot: Number(change.index),
    sourceType: String(change.reference?.sourceType || ""),
    equipmentSlot: Number(change.reference?.equipmentSlot),
    backpack: String(change.reference?.backpackAddress || ""),
    backpackIndex: Number(change.reference?.backpackIndex),
    modelBytes: Array.from(change.reference?.modelBytes ?? []),
  })));
}

export function equipmentMigrationChanges(gameState, equipment = null) {
  const legacySlots = equipment?.initialized
    ? new Set((equipment.slots ?? [])
      .filter((slot) => slot?.equipped && !slot.custodied)
      .map((slot) => Number(slot.slot)))
    : null;
  const changes = [];
  for (let index = 0; index < 9; index += 1) {
    if (legacySlots && !legacySlots.has(index)) continue;
    const reference = gameState?.getHotbarEquipmentChainReference?.(index);
    if (!reference || reference.sourceType !== "backpack") continue;
    changes.push({
      index,
      before: gameState.hotbarSlots?.[index] ?? null,
      after: gameState.hotbarSlots?.[index] ?? null,
      reference,
      migration: true,
    });
  }
  return changes;
}

function positiveInt(value) {
  if (typeof value === "bigint") return Number(value > 0n ? value : 0n);
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : 0;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizePlayerName(value) {
  const normalized = cleanText(value);
  return normalized ? normalized.slice(0, 32) : "";
}

function normalizeTitle(value) {
  return cleanText(value).slice(0, 64);
}

function normalizeGender(value) {
  return String(value || "").toLowerCase() === "female" ? "female" : "male";
}

function normalizeModelCode(value) {
  const code = cleanText(value);
  return code.startsWith("NCM") ? code.slice(0, 2048) : "";
}

function readableError(error) {
  const message = String(error?.message || error || "unknown error");
  return message.length > 160 ? `${message.slice(0, 157)}...` : message;
}

function shortAddress(address) {
  const text = String(address || "");
  return text.length > 12 ? `${text.slice(0, 4)}...${text.slice(-4)}` : text;
}

function shortSignature(signature) {
  const text = String(signature || "");
  return text.length > 12 ? `${text.slice(0, 6)}...${text.slice(-6)}` : text || "no-sig";
}

function normalizeChainPosition(position) {
  const source = Array.isArray(position)
    ? { x: position[0], y: position[1], z: position[2] }
    : (position || {});
  const x = Math.round(Number(source.x));
  const y = Math.round(Number(source.y));
  const z = Math.round(Number(source.z));
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}

function positionKey(position) {
  return `${Math.round(Number(position?.x) || 0)},${Math.round(Number(position?.y) || 0)},${Math.round(Number(position?.z) || 0)}`;
}

function positionDistanceSq(a, b) {
  const ax = Math.round(Number(a?.x) || 0);
  const ay = Math.round(Number(a?.y) || 0);
  const az = Math.round(Number(a?.z) || 0);
  const bx = Math.round(Number(b?.x) || 0);
  const by = Math.round(Number(b?.y) || 0);
  const bz = Math.round(Number(b?.z) || 0);
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}

function formatMessage(template, params = {}) {
  return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => String(params[key] ?? ""));
}
