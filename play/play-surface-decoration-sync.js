import { loadPlayChainModule } from "./play-chain-adapter.js";
import {
  compileSurfaceDecorationRules,
  resolveSurfaceDecoration,
  surfaceDecorationVariantHash,
} from "/chunk.js/play.js";

export function createPlaySurfaceDecorationSync({
  chunks,
  worldSeed = "",
  onRulesChanged = () => {},
} = {}) {
  const state = {
    started: false,
    loading: false,
    loaded: false,
    found: false,
    applied: false,
    revision: 0,
    ruleCount: 0,
    error: "",
  };
  let compiledRules = compileSurfaceDecorationRules([]);

  return {
    scheduleAfterWorldVisible,
    snapshot: () => ({ ...state }),
    resolveBackpackDecoration,
  };

  function scheduleAfterWorldVisible() {
    if (state.started) return null;
    state.started = true;
    return new Promise((resolve) => {
      globalThis.setTimeout(() => resolve(sync()), 0);
    });
  }

  async function sync() {
    state.loading = true;
    state.error = "";
    try {
      const module = await loadPlayChainModule();
      if (typeof module.fetchSurfaceDecorationTableOnChain !== "function") {
        state.loaded = true;
        return { ok: false, reason: "surface-decoration-reader-unavailable" };
      }
      const table = await module.fetchSurfaceDecorationTableOnChain();
      state.loaded = true;
      state.found = Boolean(table?.found);
      state.revision = Math.max(0, Math.trunc(Number(table?.revision) || 0));
      state.ruleCount = Array.isArray(table?.rules) ? table.rules.length : 0;
      if (!state.found || !state.ruleCount) {
        compiledRules = compileSurfaceDecorationRules([]);
        state.applied = Boolean(chunks?.setSurfaceDecorationRules?.([], { revision: 0 }));
        onRulesChanged({ rules: [], revision: 0 });
        return { ok: true, found: false, applied: false, ruleCount: 0 };
      }
      compiledRules = compileSurfaceDecorationRules(table.rules);
      state.applied = Boolean(chunks?.setSurfaceDecorationRules?.(table.rules, {
        revision: state.revision,
      }));
      onRulesChanged({ rules: compiledRules.rules, revision: state.revision });
      return {
        ok: true,
        found: true,
        applied: state.applied,
        revision: state.revision,
        ruleCount: state.ruleCount,
      };
    } catch (error) {
      state.error = error?.message || String(error);
      console.warn("[NiceChunk Decorations] PDA sync failed; non-tree decorations remain disabled until verified rules are available.", error);
      return { ok: false, reason: state.error };
    } finally {
      state.loading = false;
    }
  }

  function resolveBackpackDecoration(resource = {}) {
    const worldX = Math.trunc(Number(resource.worldX) || 0);
    const worldY = Math.trunc(Number(resource.worldY) || 0);
    const worldZ = Math.trunc(Number(resource.worldZ) || 0);
    const blockId = Math.max(0, Math.trunc(Number(resource.blockId) || 0));
    const metadata = Math.trunc(Number(resource.metadata) || 0) >>> 0;
    const decorationId = metadata & 0xffff;
    const ruleId = metadata >>> 16;
    const surfaceY = worldY - 1;
    if (decorationId && ruleId) {
      const rule = compiledRules.rules.find((entry) => (
        entry.ruleId === ruleId && entry.decorationId === decorationId
      ));
      return decorationResult({
        decorationId,
        ruleId,
        surfaceBlockId: rule?.surfaceBlockId,
        variant: rule?.variant,
        flags: rule?.flags,
        worldX,
        surfaceY,
        worldZ,
      });
    }
    if (!compiledRules.rules.length || !blockId) return null;
    const surfaceBlockIds = new Set(compiledRules.rules.map((entry) => entry.surfaceBlockId));
    for (const surfaceBlockId of surfaceBlockIds) {
      const match = resolveSurfaceDecoration({
        worldSeed,
        worldX,
        surfaceY,
        worldZ,
        surfaceBlockId,
        rules: compiledRules,
      });
      if (!match || match.dropBlockId !== blockId) continue;
      return decorationResult({ ...match, worldX, surfaceY, worldZ });
    }
    return null;
  }

  function decorationResult({ decorationId, ruleId, surfaceBlockId, variant, flags, worldX, surfaceY, worldZ }) {
    return {
      decorationId: Math.max(0, Math.trunc(Number(decorationId) || 0)),
      decorationRuleId: Math.max(0, Math.trunc(Number(ruleId) || 0)),
      decorationSurfaceBlockId: Math.max(0, Math.trunc(Number(surfaceBlockId) || 0)),
      decorationVariant: Math.max(0, Math.trunc(Number(variant) || 0)),
      decorationFlags: Math.max(0, Math.trunc(Number(flags) || 0)),
      decorationVariantHash: surfaceDecorationVariantHash({
        worldSeed,
        worldX,
        surfaceY,
        worldZ,
        ruleId,
      }),
    };
  }
}
