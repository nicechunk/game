const NO_BACKPACK_REASON = "no-equipped-backpack";

export function resolveBackpackReadState({ gameState = null, snapshot = null } = {}) {
  const sync = snapshot && typeof snapshot === "object" ? snapshot : {};
  const available = gameState?.isBackpackAvailable?.() === true
    || sync.available === true
    || Boolean(String(sync.backpackAddress || ""));
  const known = available
    || gameState?.backpackStatusKnown === true
    || sync.statusKnown === true;
  const loading = sync.loading === true;
  const rawError = String(sync.lastError || "");
  const error = !known && rawError && rawError !== NO_BACKPACK_REASON ? rawError : "";
  return {
    available,
    known,
    loading,
    error,
    pending: loading || (!known && !error),
    canCreate: known && !available && !loading,
  };
}

export async function verifyBackpackCreationEligibility({ gameState = null, chainBackpack = null } = {}) {
  let readState = resolveBackpackReadState({
    gameState,
    snapshot: chainBackpack?.snapshot?.(),
  });
  if (readState.available) return { ok: false, reason: "backpack-already-exists", readState };
  if (readState.loading) return { ok: false, reason: "backpack-read-pending", readState };
  if (typeof chainBackpack?.refresh !== "function") {
    return { ok: false, reason: "backpack-sync-unavailable", readState };
  }

  let refreshResult = null;
  try {
    refreshResult = await chainBackpack.refresh({ force: true, quiet: false });
  } catch (error) {
    return {
      ok: false,
      reason: "backpack-read-failed",
      detail: String(error?.message || error || "backpack-sync-failed"),
      readState,
      refreshResult,
    };
  }
  readState = resolveBackpackReadState({
    gameState,
    snapshot: chainBackpack?.snapshot?.(),
  });
  if (readState.available) {
    return { ok: false, reason: "backpack-already-exists", readState, refreshResult };
  }
  if (readState.loading || refreshResult?.reason === "already-loading") {
    return { ok: false, reason: "backpack-read-pending", readState, refreshResult };
  }
  if (!readState.known) {
    return {
      ok: false,
      reason: "backpack-read-failed",
      detail: readState.error || String(refreshResult?.reason || "backpack-sync-failed"),
      readState,
      refreshResult,
    };
  }
  const absenceConfirmed = readState.canCreate
    && (refreshResult?.ok === true || refreshResult?.reason === NO_BACKPACK_REASON);
  if (!absenceConfirmed) {
    return {
      ok: false,
      reason: "backpack-read-failed",
      detail: readState.error || String(refreshResult?.reason || "backpack-sync-failed"),
      readState,
      refreshResult,
    };
  }
  return { ok: true, reason: "backpack-absent", readState, refreshResult };
}
