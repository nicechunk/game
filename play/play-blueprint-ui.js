import { cameraOrigin, cameraViewProjection } from "/chunk.js/renderer/camera.js";
import { projectWorldToScreen } from "./play-name-chat-overlay.js";

export function createPlayBlueprintUi({
  elements,
  getController = () => null,
  getBuildingController = () => null,
  getCamera = () => null,
  canvas = null,
  onBuildingModeOpen = () => {},
  translate = (_key, fallback) => fallback,
} = {}) {
  let bound = false;
  let lastSignature = "";

  return {
    bind,
    render,
    update,
  };

  function bind() {
    if (bound) return;
    bound = true;
    elements?.blueprintWidth?.addEventListener("change", applyDimensions);
    elements?.blueprintDepth?.addEventListener("change", applyDimensions);
    elements?.blueprintWidth?.addEventListener("input", applyDimensions);
    elements?.blueprintDepth?.addEventListener("input", applyDimensions);
    for (const button of elements?.blueprintDimensionButtons ?? []) {
      button.addEventListener("click", () => {
        const field = button.dataset.blueprintDimension;
        const delta = Number(button.dataset.blueprintDelta) || 0;
        const controller = getController();
        const dimensions = controller?.dimensions?.() ?? { width: 12, depth: 8 };
        const width = field === "width" ? dimensions.width + delta : dimensions.width;
        const depth = field === "depth" ? dimensions.depth + delta : dimensions.depth;
        controller?.setDimensions?.(width, depth);
        render({ force: true });
      });
    }
    for (const button of elements?.blueprintModeButtons ?? []) {
      button.addEventListener("click", () => {
        const mode = button.dataset.blueprintMode === "building" ? "building" : "foundation";
        getBuildingController()?.setMode?.(mode);
        if (mode === "building") {
          getController()?.cancel?.();
          onBuildingModeOpen();
        }
        render({ force: true });
      });
    }
    elements?.blueprintConfirm?.addEventListener("click", () => getController()?.confirm?.());
    elements?.blueprintCancel?.addEventListener("click", () => getController()?.cancel?.());
    elements?.buildingCode?.addEventListener("input", () => {
      getBuildingController()?.setCode?.(elements.buildingCode.value);
    });
    elements?.buildingRotateLeft?.addEventListener("click", () => getBuildingController()?.rotate?.(-1));
    elements?.buildingRotateRight?.addEventListener("click", () => getBuildingController()?.rotate?.(1));
    elements?.buildingOffsetX?.addEventListener("change", applyBuildingOffsets);
    elements?.buildingOffsetZ?.addEventListener("change", applyBuildingOffsets);
    elements?.buildingPreview?.addEventListener("click", () => getBuildingController()?.preview?.());
    elements?.buildingConfirm?.addEventListener("click", () => getBuildingController()?.confirm?.());
  }

  function applyDimensions() {
    getController()?.setDimensions?.(
      Number(elements?.blueprintWidth?.value),
      Number(elements?.blueprintDepth?.value),
    );
    render({ force: true });
  }

  function applyBuildingOffsets() {
    getBuildingController()?.setOffsets?.(
      Number(elements?.buildingOffsetX?.value),
      Number(elements?.buildingOffsetZ?.value),
    );
    render({ force: true });
  }

  function render({ force = false } = {}) {
    const buildingController = getBuildingController();
    buildingController?.activate?.();
    const foundation = getController()?.snapshot?.() ?? { active: false };
    const building = buildingController?.snapshot?.() ?? { active: foundation.active, mode: "foundation", foundations: [] };
    const active = Boolean(building.active || foundation.active);
    const mode = building.mode === "building" ? "building" : "foundation";
    const foundationBound = Boolean(foundation.foundationBound || building.foundationBound);
    const signature = JSON.stringify([
      active,
      mode,
      foundation.blueprintId,
      foundation.blueprintOrdinal,
      foundationBound,
      foundation.width,
      foundation.depth,
      foundation.anchored,
      foundation.submitting,
      foundation.preview?.valid,
      foundation.preview?.reason,
      foundation.preview?.message,
      foundation.step,
      foundation.editing,
      foundation.dimensionsDirty,
      building.selectedFoundationId,
      building.code?.length,
      building.parsed?.codeId,
      building.quarterTurns,
      building.offsetX,
      building.offsetZ,
      building.preview?.id,
      building.preview?.fitsFoundation,
      building.meshing,
      building.submitting,
      building.lastError,
    ]);
    if (!force && signature === lastSignature) return;
    lastSignature = signature;

    if (elements?.blueprintGuide) {
      elements.blueprintGuide.hidden = !active;
      elements.blueprintGuide.classList.toggle("is-building", mode === "building");
      elements.blueprintGuide.dataset.blueprintId = foundation.blueprintId || building.blueprintId || "";
    }
    renderBlueprintIdentity(foundation.blueprint || building.blueprint);
    if (elements?.foundationEditor) elements.foundationEditor.hidden = mode !== "foundation";
    if (elements?.buildingEditor) elements.buildingEditor.hidden = mode !== "building";
    if (elements?.blueprintStepHint) elements.blueprintStepHint.hidden = !active;
    if (elements?.foundationMeasurements) elements.foundationMeasurements.hidden = !active || mode !== "foundation" || !foundation.preview;
    for (const button of elements?.blueprintModeButtons ?? []) {
      const selected = button.dataset.blueprintMode === mode;
      const buildingTab = button.dataset.blueprintMode === "building";
      button.disabled = buildingTab && !foundationBound;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
    }
    if (!active) return;

    if (mode === "foundation") renderFoundation(foundation);
    else renderBuilding(building);
    renderStepHint(mode, foundation, building);
  }

  function renderFoundation(snapshot) {
    if (elements?.blueprintWidth && document.activeElement !== elements.blueprintWidth) {
      elements.blueprintWidth.value = String(snapshot.width);
    }
    if (elements?.blueprintDepth && document.activeElement !== elements.blueprintDepth) {
      elements.blueprintDepth.value = String(snapshot.depth);
    }
    if (elements?.blueprintConfirm) {
      elements.blueprintConfirm.disabled = snapshot.submitting
        || !snapshot.preview?.valid
        || (snapshot.editing && !snapshot.dimensionsDirty);
      elements.blueprintConfirm.classList.toggle("is-loading", snapshot.submitting);
      const label = elements.blueprintConfirm.querySelector("span");
      if (label) label.textContent = snapshot.submitting
        ? snapshot.editing
          ? text("main.blueprint.resizing", "Updating...")
          : text("main.blueprint.submitting", "Securing...")
        : snapshot.editing
          ? text("main.blueprint.saveSize", "Save Foundation Size")
          : text("main.blueprint.confirm", "Create Foundation");
    }
    if (elements?.blueprintWidth) elements.blueprintWidth.disabled = snapshot.submitting;
    if (elements?.blueprintDepth) elements.blueprintDepth.disabled = snapshot.submitting;
    for (const button of elements?.blueprintDimensionButtons ?? []) button.disabled = snapshot.submitting;
    if (elements?.blueprintStatus) {
      elements.blueprintStatus.dataset.state = snapshot.preview?.valid ? "valid" : snapshot.preview ? "invalid" : "idle";
      elements.blueprintStatus.textContent = snapshot.lastError
        || snapshot.preview?.message
        || text("main.blueprint.chooseGround", "Click a flat area to place the blueprint.");
    }
    const activeStep = Math.max(1, Math.min(5, Number(snapshot.step) || 1));
    for (const item of elements?.blueprintSteps ?? []) {
      const step = Number(item.dataset.blueprintStep) || 1;
      item.classList.toggle("active", step === activeStep);
      item.classList.toggle("done", step < activeStep);
    }
  }

  function renderBuilding(snapshot) {
    if (elements?.buildingCode && document.activeElement !== elements.buildingCode && elements.buildingCode.value !== snapshot.code) {
      elements.buildingCode.value = snapshot.code || "";
    }
    if (elements?.buildingRotation) elements.buildingRotation.textContent = `${(snapshot.quarterTurns || 0) * 90}°`;
    if (elements?.buildingOffsetX && document.activeElement !== elements.buildingOffsetX) {
      elements.buildingOffsetX.value = String(snapshot.offsetX || 0);
    }
    if (elements?.buildingOffsetZ && document.activeElement !== elements.buildingOffsetZ) {
      elements.buildingOffsetZ.value = String(snapshot.offsetZ || 0);
    }
    if (elements?.buildingMetrics) {
      const parsed = snapshot.parsed;
      const footprint = snapshot.preview?.footprint;
      elements.buildingMetrics.hidden = !parsed;
      elements.buildingMetrics.replaceChildren();
      if (parsed) {
        appendMetric(elements.buildingMetrics, text("main.blueprint.sizeMetric", "SIZE"), `${footprint?.width ?? parsed.size.x}×${parsed.size.y}×${footprint?.depth ?? parsed.size.z}`);
        appendMetric(elements.buildingMetrics, text("main.blueprint.voxelsMetric", "VOXELS"), formatInteger(parsed.voxelCount));
        appendMetric(elements.buildingMetrics, text("main.blueprint.bytesMetric", "BYTES"), formatInteger(parsed.payloadBytes));
      }
    }
    if (elements?.buildingStatus) {
      const hasFoundation = Boolean(snapshot.selectedFoundation);
      const previewFits = snapshot.preview?.fitsFoundation !== false;
      elements.buildingStatus.dataset.state = snapshot.preview
        ? previewFits ? "valid" : "invalid"
        : snapshot.lastError ? "invalid" : "idle";
      elements.buildingStatus.textContent = snapshot.lastError
        || (snapshot.meshing
          ? text("main.blueprint.processingBuilding", "Processing the NCM3 building off the render thread...")
          : snapshot.preview
          ? text("main.blueprint.buildingReady", "NCM3 building fits this foundation at exact 1:1 scale.")
          : hasFoundation
            ? text("main.blueprint.enterCode", "Paste an NCM3 building code first.")
            : text("main.blueprint.noFoundation", "Create a foundation before importing a building."));
    }
    if (elements?.buildingPreview) elements.buildingPreview.disabled = !snapshot.selectedFoundation || !snapshot.code || snapshot.submitting || snapshot.meshing;
    if (elements?.buildingOffsetX) elements.buildingOffsetX.disabled = snapshot.submitting || snapshot.meshing;
    if (elements?.buildingOffsetZ) elements.buildingOffsetZ.disabled = snapshot.submitting || snapshot.meshing;
    if (elements?.buildingConfirm) {
      elements.buildingConfirm.disabled = !snapshot.selectedFoundation
        || !snapshot.code
        || snapshot.preview?.fitsFoundation === false
        || snapshot.submitting
        || snapshot.meshing;
      elements.buildingConfirm.classList.toggle("is-loading", snapshot.submitting || snapshot.meshing);
      const label = elements.buildingConfirm.querySelector("span");
      if (label) label.textContent = snapshot.meshing
        ? text("main.blueprint.processing", "Processing...")
        : snapshot.submitting
          ? text("main.blueprint.submittingBuilding", "Creating...")
          : text("main.blueprint.createBuilding", "Create Building");
    }
    for (const item of elements?.blueprintSteps ?? []) {
      item.classList.toggle("active", Number(item.dataset.blueprintStep) === 5);
      item.classList.toggle("done", Number(item.dataset.blueprintStep) < 5);
    }
  }

  function renderStepHint(mode, foundation, building) {
    const step = mode === "building" ? 5 : Math.max(1, Math.min(5, Number(foundation.step) || 1));
    if (elements?.blueprintStepNumber) elements.blueprintStepNumber.textContent = String(step);
    if (elements?.blueprintStepText) elements.blueprintStepText.textContent = mode === "building"
      ? building.selectedFoundation
        ? text("main.blueprint.stepBuildCodeDetail", "Paste NCM3 code for this blueprint, then preview the exact 1:1 building.")
        : text("main.blueprint.noFoundation", "Create a foundation before importing a building.")
      : foundation.editing
        ? text("main.blueprint.stepEditDetail", "Adjust the selected foundation size, then save its protected area.")
        : stepLabel(step, foundation);
  }

  function renderBlueprintIdentity(blueprint) {
    if (!elements?.blueprintIdentity) return;
    if (!blueprint?.blueprintId) {
      elements.blueprintIdentity.textContent = "";
      return;
    }
    const id = String(blueprint.blueprintId);
    const shortId = id.length > 12 ? `${id.slice(0, 6)}...${id.slice(-4)}` : id;
    elements.blueprintIdentity.textContent = text(
      "main.blueprint.instanceLabel",
      "BLUEPRINT #{number} · ID {id}",
      { number: blueprint.blueprintOrdinal || "-", id: shortId },
    );
    elements.blueprintIdentity.title = id;
  }

  function update() {
    render();
    updateMeasurementLabels();
  }

  function updateMeasurementLabels() {
    const building = getBuildingController()?.snapshot?.();
    const snapshot = getController()?.snapshot?.();
    const preview = snapshot?.active && building?.mode !== "building" ? snapshot.preview : null;
    const root = elements?.foundationMeasurements;
    if (!preview || !root || !canvas) {
      if (root) root.hidden = true;
      return;
    }
    const camera = getCamera();
    const rect = canvas.getBoundingClientRect?.();
    if (!camera || !rect?.width || !rect?.height) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    const matrix = cameraViewProjection(camera);
    const origin = cameraOrigin(camera);
    const widthPoint = projectWorldToScreen(
      matrix,
      origin,
      preview.minX + preview.width * 0.5,
      preview.surfaceY + 0.22,
      preview.minZ + preview.depth + 0.42,
      rect,
    );
    const depthPoint = projectWorldToScreen(
      matrix,
      origin,
      preview.minX + preview.width + 0.42,
      preview.surfaceY + 0.22,
      preview.minZ + preview.depth * 0.5,
      rect,
    );
    positionLabel(elements?.foundationMeasureWidth, widthPoint, rect, String(preview.width));
    positionLabel(elements?.foundationMeasureDepth, depthPoint, rect, String(preview.depth));
  }

  function positionLabel(label, projected, rect, value) {
    if (!label) return;
    label.hidden = !projected?.visible;
    if (!projected?.visible) return;
    label.textContent = value;
    label.style.transform = `translate3d(${(rect.left + projected.x).toFixed(1)}px, ${(rect.top + projected.y).toFixed(1)}px, 0) translate(-50%, -50%)`;
  }

  function stepLabel(step, snapshot) {
    if (step === 1) return text("main.blueprint.stepEquipDetail", "Select the blueprint tool from the toolbar.");
    if (step === 2) return text("main.blueprint.stepSizeDetail", "Set the foundation size, then click flat ground.");
    if (step === 3) return snapshot.preview?.message || text("main.blueprint.stepPlaceDetail", "Place the hologram on a clear, level area.");
    if (step === 4) return text("main.blueprint.stepConfirmDetail", "Review the outline and create the protected foundation.");
    return text("main.blueprint.stepBuildDetail", "The foundation is ready for construction.");
  }

  function appendMetric(root, label, value) {
    const item = document.createElement("span");
    const caption = document.createElement("small");
    const amount = document.createElement("b");
    caption.textContent = label;
    amount.textContent = value;
    item.append(caption, amount);
    root.append(item);
  }

  function formatInteger(value) {
    return Math.max(0, Math.trunc(Number(value) || 0)).toLocaleString();
  }

  function text(key, fallback, params = {}) {
    const value = translate?.(key, fallback, params);
    return typeof value === "string" && value !== key
      ? value
      : fallback.replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? ""));
  }
}
