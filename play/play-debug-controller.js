export function createPlayDebugController({
  elements,
  renderLog,
  canvas,
  setStatus,
  parsePoseText,
  getPoseSnapshot,
  applyPoseSnapshot,
  openBackpackPanel,
  openProfilePanel,
  openMarketPanel,
  openSmeltingPanel,
  openRpcPanel,
  openSessionPanel,
  onChainPdaCommand,
  onChatMessage,
  getToolReachSphere,
  getBulkMining = () => null,
  translate = (_, fallback) => fallback,
  blockSizeMeters = 1,
  isMobileViewport,
  defaultViewDistance,
} = {}) {
  let toolRangeVisible = false;
  const api = {
    bind() {
      elements.commandForm?.addEventListener("submit", submitCommand);
      elements.renderLogToggle?.addEventListener("click", toggleRenderLog);
      elements.renderLogCopy?.addEventListener("click", copyRenderLog);
      elements.renderLogClear?.addEventListener("click", clearRenderLog);
      elements.toolRangeToggle?.addEventListener("click", toggleToolRange);
      elements.bulkMiningToggle?.addEventListener("click", toggleBulkMining);
      elements.bulkMiningConfirm?.addEventListener("click", () => getBulkMining()?.confirm?.());
      elements.bulkMiningCancel?.addEventListener("click", () => getBulkMining()?.cancel?.());
      elements.copyPose?.addEventListener("click", copyPoseSnapshot);
      elements.loadPose?.addEventListener("click", loadPoseSnapshot);
      elements.poseInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") loadPoseSnapshot();
      });
      bindHudToggle();
      updateToolRangeHud();
      updateBulkMiningHud();
    },
    openCommandLine,
    closeCommandLine,
    isCommandLineOpen,
    runCommand,
    setDebugVisible,
    isDebugVisible,
    isToolRangeVisible: () => toolRangeVisible,
    isBulkMiningEnabled: () => Boolean(getBulkMining()?.isEnabled?.()),
    updateToolRangeHud,
    updateBulkMiningHud,
    updatePoseHud,
    updateRenderLogPreview,
    poseSnapshotText,
    poseSummaryText,
  };

  function openCommandLine(initialValue = "") {
    if (!elements.commandForm || !elements.commandInput) return;
    elements.commandForm.hidden = false;
    elements.commandInput.value = initialValue;
    elements.commandInput.focus();
    elements.commandInput.setSelectionRange(elements.commandInput.value.length, elements.commandInput.value.length);
  }

  function closeCommandLine() {
    if (elements.commandForm) elements.commandForm.hidden = true;
    if (elements.commandInput) elements.commandInput.value = "";
    canvas?.focus?.();
  }

  function isCommandLineOpen() {
    return Boolean(elements.commandForm && !elements.commandForm.hidden);
  }

  function submitCommand(event) {
    event.preventDefault();
    const command = String(elements.commandInput?.value || "").trim();
    closeCommandLine();
    runCommand(command);
  }

  function runCommand(command) {
    if (command && !command.startsWith("/")) {
      const sent = onChatMessage?.(command);
      setStatus(sent ? `Chat sent: ${normalizeChatPreview(command)}` : "Chat requires a connected Guardian session. Connect wallet first.");
      return;
    }
    const normalized = command.startsWith("/") ? command.slice(1).trim() : command.trim();
    const [name, ...args] = normalized.split(/\s+/).filter(Boolean);
    switch ((name || "").toLowerCase()) {
      case "debugon":
        setDebugVisible(true);
        setStatus("Debug panel opened. Use /debug off to hide it.");
        break;
      case "debugoff":
        setDebugVisible(false);
        setStatus("Debug panel hidden.");
        break;
      case "debug":
        setDebugVisible(args[0] === "off" ? false : args[0] === "toggle" ? !isDebugVisible() : true);
        setStatus(isDebugVisible() ? "Debug panel opened. Use /debug off to hide it." : "Debug panel hidden.");
        break;
      case "backpack":
        openBackpackPanel?.();
        setStatus("Backpack opened.");
        break;
      case "profile":
      case "player":
        openProfilePanel?.();
        setStatus("Player panel opened.");
        break;
      case "market":
      case "trade":
        openMarketPanel?.();
        setStatus("Market opened.");
        break;
      case "smelt":
      case "smelting":
      case "forge":
        openSmeltingPanel?.();
        setStatus("Smelting station opened.");
        break;
      case "rpc":
        openRpcPanel?.();
        setStatus("RPC panel opened.");
        break;
      case "session":
      case "fund":
        openSessionPanel?.();
        setStatus("Mining session panel opened.");
        break;
      case "pda":
      case "chainpda": {
        const result = onChainPdaCommand?.(args[0] || "toggle");
        setStatus(result?.message || "Chunk PDA command is unavailable.");
        break;
      }
      case "help":
        setStatus("Commands: /debug, /debug off, /backpack, /profile, /market, /smelt, /rpc, /session, /pda on|off|toggle|clear. Type normal text to chat.");
        break;
      default:
        if (command) setStatus(`Unknown command: ${command}. Try /help.`);
        break;
    }
  }

  function setDebugVisible(visible) {
    const next = Boolean(visible);
    if (!next) getBulkMining()?.setEnabled?.(false, { quiet: true });
    elements.hud?.classList.toggle("is-debug-visible", next);
    if (elements.hud) elements.hud.hidden = !next;
    if (next) {
      updateToolRangeHud();
      updateBulkMiningHud();
    }
  }

  function isDebugVisible() {
    return Boolean(elements.hud?.classList.contains("is-debug-visible"));
  }

  function bindHudToggle() {
    if (!elements.hud || !elements.hudToggle) return;
    const setExpanded = (expanded) => {
      elements.hud.classList.toggle("is-expanded", expanded);
      elements.hudToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      const label = elements.hudToggle.querySelector("b");
      if (label) label.textContent = expanded ? "Hide" : "Details";
    };
    setExpanded(!isMobileViewport?.());
    elements.hudToggle.addEventListener("click", () => {
      setExpanded(!elements.hud.classList.contains("is-expanded"));
    });
  }

  function updatePoseHud(snapshot = getPoseSnapshot?.()) {
    if (elements.pose) elements.pose.textContent = poseSummaryText(snapshot);
    if (elements.poseInput && document.activeElement !== elements.poseInput) elements.poseInput.value = poseSnapshotText(snapshot);
  }

  function poseSnapshotText(snapshot = getPoseSnapshot?.()) {
    if (!snapshot) return "";
    return [
      `x=${fixed3(snapshot.fullX ?? (snapshot.worldX + snapshot.localOffsetX))}`,
      `y=${fixed3(snapshot.fullY ?? (snapshot.worldY + snapshot.localOffsetY))}`,
      `z=${fixed3(snapshot.fullZ ?? (snapshot.worldZ + snapshot.localOffsetZ))}`,
      `ay=${fixed3(snapshot.avatarYaw)}`,
      `cy=${fixed3(snapshot.controlYaw)}`,
      `cp=${fixed3(snapshot.cameraPitch)}`,
      `view=${Math.trunc(snapshot.viewDistance || defaultViewDistance || 0)}`,
      `fly=${snapshot.flightEnabled ? 1 : 0}`,
    ].join(" ");
  }

  function poseSummaryText(snapshot = getPoseSnapshot?.()) {
    if (!snapshot) return "-";
    const x = snapshot.fullX ?? (snapshot.worldX + snapshot.localOffsetX);
    const y = snapshot.fullY ?? (snapshot.worldY + snapshot.localOffsetY);
    const z = snapshot.fullZ ?? (snapshot.worldZ + snapshot.localOffsetZ);
    return `pos ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)} · avatar ${radToDeg(snapshot.avatarYaw).toFixed(0)}° · camera ${radToDeg(snapshot.controlYaw).toFixed(0)}°/${radToDeg(snapshot.cameraPitch).toFixed(0)}°`;
  }

  async function copyPoseSnapshot() {
    const text = poseSnapshotText();
    if (!text) return;
    if (elements.poseInput) {
      elements.poseInput.value = text;
      elements.poseInput.select?.();
    }
    try {
      await navigator.clipboard?.writeText(text);
      setStatus("Pose copied. Paste this line later to restore the exact debug view.");
    } catch {
      setStatus("Pose copied into the input field. Clipboard API was unavailable.");
    }
  }

  function loadPoseSnapshot() {
    const pose = parsePoseText?.(elements.poseInput?.value || "");
    if (!pose) {
      setStatus("Pose load failed: paste a line like x=0.5 y=98 z=0.5 ay=3.14 cy=3.14 cp=-0.42.");
      return;
    }
    applyPoseSnapshot?.(pose);
    setStatus(`Pose loaded: ${poseSummaryText(pose)}.`);
  }

  function toggleRenderLog() {
    const enabled = renderLog.toggle();
    if (elements.renderLogToggle) elements.renderLogToggle.textContent = enabled ? "On" : "Off";
    updateRenderLogPreview();
    setStatus(enabled
      ? "Render log enabled. It records chunk build, upload, and CPU draw timings."
      : "Render log disabled. Normal runtime overhead is back to near zero.");
  }

  async function copyRenderLog() {
    const text = renderLog.toText();
    if (elements.renderLogPreview) elements.renderLogPreview.textContent = renderLog.summary();
    try {
      await navigator.clipboard?.writeText(text);
      setStatus(`Render log copied (${renderLog.count()} entries).`);
    } catch {
      setStatus("Render log copy failed: Clipboard API was unavailable.");
    }
  }

  function clearRenderLog() {
    renderLog.clear();
    updateRenderLogPreview();
    setStatus("Render log cleared.");
  }

  function updateRenderLogPreview() {
    if (!elements.renderLogPreview) return;
    elements.renderLogPreview.textContent = renderLog.summary();
    if (elements.renderLogToggle) elements.renderLogToggle.textContent = renderLog.enabled ? "On" : "Off";
  }

  function toggleToolRange() {
    toolRangeVisible = !toolRangeVisible;
    updateToolRangeHud();
    setStatus(toolRangeVisible
      ? "Tool activity range enabled. Wire sphere is derived from the equipped tool's physical volume."
      : "Tool activity range hidden.");
  }

  function updateToolRangeHud() {
    const sphere = getToolReachSphere?.() ?? null;
    if (elements.toolRangeToggle) {
      elements.toolRangeToggle.textContent = toolRangeVisible ? "On" : "Off";
      elements.toolRangeToggle.setAttribute("aria-pressed", toolRangeVisible ? "true" : "false");
    }
    if (!elements.toolRangeValue) return;
    if (!sphere || !(sphere.radius > 0)) {
      elements.toolRangeValue.textContent = "Select a mining tool";
      return;
    }
    const equipment = String(sphere.equipmentId || "tool").replace(/_/g, " ");
    const meters = sphere.radius * Math.max(0.0001, Number(blockSizeMeters) || 1);
    elements.toolRangeValue.textContent = `${equipment} · ${sphere.radius.toFixed(2)} blocks / ${meters.toFixed(2)} m`;
  }

  function toggleBulkMining() {
    const controller = getBulkMining();
    if (!controller) return;
    controller.setEnabled?.(!controller.isEnabled?.());
    updateBulkMiningHud();
  }

  function updateBulkMiningHud(snapshot = getBulkMining()?.snapshot?.()) {
    const state = snapshot ?? { enabled: false, phase: "idle", count: 0, maxBlocks: 64, canConfirm: false };
    if (elements.bulkMiningToggle) {
      elements.bulkMiningToggle.textContent = state.enabled
        ? text("main.bulkMining.on", "On")
        : text("main.bulkMining.off", "Off");
      elements.bulkMiningToggle.setAttribute("aria-pressed", state.enabled ? "true" : "false");
    }
    if (elements.bulkMiningControl) elements.bulkMiningControl.classList.toggle("is-enabled", Boolean(state.enabled));
    if (elements.bulkMiningConfirm) elements.bulkMiningConfirm.disabled = !state.canConfirm;
    if (elements.bulkMiningCancel) elements.bulkMiningCancel.disabled = !state.enabled || state.phase === "idle";
    if (!elements.bulkMiningValue) return;
    if (!state.enabled) {
      elements.bulkMiningValue.textContent = text("main.bulkMining.inactive", "Off · debug only");
      return;
    }
    if (state.overflow) {
      elements.bulkMiningValue.textContent = text("main.bulkMining.limit", "Selection exceeds {max} blocks", {
        max: state.maxBlocks,
      });
      return;
    }
    if (state.phase === "anchored") {
      elements.bulkMiningValue.textContent = text("main.bulkMining.chooseEnd", "Start selected · choose the opposite corner");
      return;
    }
    if (state.phase === "ready") {
      elements.bulkMiningValue.textContent = text("main.bulkMining.selection", "{count} / {max} blocks selected", {
        count: state.count,
        max: state.maxBlocks,
      });
      return;
    }
    elements.bulkMiningValue.textContent = text("main.bulkMining.chooseStart", "Click a block to set the first corner");
  }

  function text(key, fallback, params = {}) {
    return translate(key, fallback, params) || fallback;
  }

  return api;
}

function fixed3(value) {
  return Number.isFinite(value) ? Number(value).toFixed(3) : "0.000";
}

function radToDeg(value) {
  return Number.isFinite(value) ? value * 180 / Math.PI : 0;
}

function normalizeChatPreview(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > 42 ? `${text.slice(0, 39)}...` : text;
}
