import { cameraOrigin, cameraViewProjection } from "/chunk.js/renderer/camera.js";
import { projectWorldToScreen } from "./play-name-chat-overlay.js";

export function createPlayLandUi({
  elements,
  getController = () => null,
  getBuildingController = () => null,
  isConstructionModeActive = () => false,
  setConstructionModeActive = () => {},
  getCamera = () => null,
  canvas = null,
  onBuildingModeOpen = () => {},
  onBuyContracts = () => {},
  translate = (_key, fallback) => fallback,
} = {}) {
  let bound = false;
  let lastSignature = "";

  return { bind, render, update };

  function bind() {
    if (bound) return;
    bound = true;
    elements?.landModeButton?.addEventListener("click", () => {
      setConstructionModeActive(!isConstructionModeActive());
    });
    elements?.landClose?.addEventListener("click", () => setConstructionModeActive(false));
    elements?.landChunksX?.addEventListener("change", applyDimensions);
    elements?.landChunksZ?.addEventListener("change", applyDimensions);
    elements?.landChunksX?.addEventListener("input", applyDimensions);
    elements?.landChunksZ?.addEventListener("input", applyDimensions);
    for (const button of elements?.landDimensionButtons ?? []) {
      button.addEventListener("click", () => {
        const field = button.dataset.landDimension;
        const delta = Number(button.dataset.landDelta) || 0;
        const dimensions = getController()?.dimensions?.() ?? { chunksX: 1, chunksZ: 1 };
        const chunksX = field === "chunksX" ? dimensions.chunksX + delta : dimensions.chunksX;
        const chunksZ = field === "chunksZ" ? dimensions.chunksZ + delta : dimensions.chunksZ;
        getController()?.setDimensions?.(chunksX, chunksZ);
        render({ force: true });
      });
    }
    for (const button of elements?.landModeButtons ?? []) {
      button.addEventListener("click", () => {
        const mode = button.dataset.landMode === "building" ? "building" : "foundation";
        getBuildingController()?.setMode?.(mode);
        if (mode === "building") {
          getController()?.cancel?.();
          onBuildingModeOpen();
        }
        render({ force: true });
      });
    }
    elements?.landConfirm?.addEventListener("click", () => getController()?.confirm?.());
    elements?.landCancel?.addEventListener("click", () => getController()?.cancel?.());
    elements?.landBuyContracts?.addEventListener("click", onBuyContracts);
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
      Number(elements?.landChunksX?.value),
      Number(elements?.landChunksZ?.value),
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
    const active = Boolean(isConstructionModeActive());
    const buildingController = getBuildingController();
    buildingController?.activate?.(active);
    const foundation = getController()?.snapshot?.() ?? { active: false };
    const building = buildingController?.snapshot?.() ?? { active, mode: "foundation", foundations: [] };
    const mode = building.mode === "building" ? "building" : "foundation";
    const foundationBound = Boolean(foundation.foundationBound || building.foundationBound);
    const signature = JSON.stringify([
      active,
      mode,
      foundationBound,
      foundation.chunksX,
      foundation.chunksZ,
      foundation.requiredContracts,
      foundation.availableLandContracts,
      foundation.anchored,
      foundation.submitting,
      foundation.preview?.valid,
      foundation.preview?.reason,
      foundation.preview?.message,
      foundation.step,
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

    if (elements?.landModeButton) {
      elements.landModeButton.classList.toggle("active", active);
      elements.landModeButton.setAttribute("aria-pressed", active ? "true" : "false");
    }
    if (elements?.landGuide) {
      elements.landGuide.hidden = !active;
      elements.landGuide.classList.toggle("is-building", mode === "building");
    }
    if (elements?.foundationEditor) elements.foundationEditor.hidden = mode !== "foundation";
    if (elements?.buildingEditor) elements.buildingEditor.hidden = mode !== "building";
    if (elements?.landStepHint) elements.landStepHint.hidden = !active;
    if (elements?.foundationMeasurements) {
      elements.foundationMeasurements.hidden = !active || mode !== "foundation" || !foundation.preview;
    }
    for (const button of elements?.landModeButtons ?? []) {
      const selected = button.dataset.landMode === mode;
      const buildingTab = button.dataset.landMode === "building";
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
    if (elements?.landChunksX && document.activeElement !== elements.landChunksX) {
      elements.landChunksX.value = String(snapshot.chunksX || 1);
    }
    if (elements?.landChunksZ && document.activeElement !== elements.landChunksZ) {
      elements.landChunksZ.value = String(snapshot.chunksZ || 1);
    }
    const required = Math.max(1, Math.trunc(Number(snapshot.requiredContracts) || 1));
    const available = normalizedBalance(snapshot.availableLandContracts);
    const insufficient = available !== null && available < required;
    if (elements?.landFootprint) elements.landFootprint.textContent = `${snapshot.width || 16}×${snapshot.depth || 16}`;
    if (elements?.landRequiredContracts) elements.landRequiredContracts.textContent = String(required);
    if (elements?.landAvailableContracts) {
      elements.landAvailableContracts.textContent = available === null
        ? text("main.land.balanceLoading", "Loading...")
        : String(available);
      elements.landAvailableContracts.dataset.state = insufficient ? "insufficient" : "ready";
    }
    if (elements?.landConfirm) {
      elements.landConfirm.disabled = snapshot.submitting || !snapshot.preview?.valid || insufficient;
      elements.landConfirm.classList.toggle("is-loading", snapshot.submitting);
      elements.landConfirm.setAttribute("aria-busy", snapshot.submitting ? "true" : "false");
      const label = elements.landConfirm.querySelector("span");
      if (label) label.textContent = snapshot.submitting
        ? text("main.land.submitting", "Registering...")
        : text("main.land.confirm", "Register Land");
    }
    if (elements?.landChunksX) elements.landChunksX.disabled = snapshot.submitting;
    if (elements?.landChunksZ) elements.landChunksZ.disabled = snapshot.submitting;
    for (const button of elements?.landDimensionButtons ?? []) button.disabled = snapshot.submitting;
    if (elements?.landBuyContracts) elements.landBuyContracts.disabled = snapshot.submitting;
    if (elements?.landStatus) {
      elements.landStatus.dataset.state = insufficient
        ? "invalid"
        : snapshot.preview?.valid
          ? "valid"
          : snapshot.preview
            ? "invalid"
            : "idle";
      elements.landStatus.textContent = insufficient
        ? text("main.land.insufficientContracts", "You need {required} contracts but own {available}.", { required, available })
        : snapshot.lastError
          || snapshot.preview?.message
          || text("main.land.chooseGround", "Select the top of a flat chunk with F.");
    }
    const activeStep = Math.max(1, Math.min(4, Number(snapshot.step) || 1));
    for (const item of elements?.landSteps ?? []) {
      const step = Number(item.dataset.landStep) || 1;
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
        appendMetric(elements.buildingMetrics, text("main.land.sizeMetric", "SIZE"), `${footprint?.width ?? parsed.size.x}×${parsed.size.y}×${footprint?.depth ?? parsed.size.z}`);
        appendMetric(elements.buildingMetrics, text("main.land.voxelsMetric", "VOXELS"), formatInteger(parsed.voxelCount));
        appendMetric(elements.buildingMetrics, text("main.land.bytesMetric", "BYTES"), formatInteger(parsed.payloadBytes));
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
          ? text("main.land.processingBuilding", "Processing the NCM3 building off the render thread...")
          : snapshot.preview
            ? text("main.land.buildingReady", "NCM3 building fits this land at exact 1:1 scale.")
            : hasFoundation
              ? text("main.land.enterCode", "Paste an NCM3 building code first.")
              : text("main.land.noFoundation", "Register land before importing a building."));
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
      elements.buildingConfirm.setAttribute("aria-busy", snapshot.submitting || snapshot.meshing ? "true" : "false");
      const label = elements.buildingConfirm.querySelector("span");
      if (label) label.textContent = snapshot.meshing
        ? text("main.land.processing", "Processing...")
        : snapshot.submitting
          ? text("main.land.submittingBuilding", "Creating...")
          : text("main.land.createBuilding", "Create Building");
    }
    for (const item of elements?.landSteps ?? []) {
      item.classList.toggle("active", Number(item.dataset.landStep) === 4);
      item.classList.toggle("done", Number(item.dataset.landStep) < 4);
    }
  }

  function renderStepHint(mode, foundation, building) {
    const step = mode === "building" ? 4 : Math.max(1, Math.min(4, Number(foundation.step) || 1));
    if (elements?.landStepNumber) elements.landStepNumber.textContent = String(step);
    if (elements?.landStepText) elements.landStepText.textContent = mode === "building"
      ? building.selectedFoundation
        ? text("main.land.stepBuildCodeDetail", "Paste NCM3 code, preview it at 1:1 scale, then create the building.")
        : text("main.land.noFoundation", "Register land before importing a building.")
      : stepLabel(step, foundation);
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
    if (step === 1) return text("main.land.stepContractsDetail", "Buy one blank land contract for every chunk you want to register.");
    if (step === 2) return text("main.land.stepSizeDetail", "Set the chunk footprint, then select flat ground with F.");
    if (step === 3) return snapshot.preview?.message || text("main.land.stepPlaceDetail", "Place the chunk-aligned hologram on clear, level ground.");
    return text("main.land.stepConfirmDetail", "Review the outline and register the land on chain.");
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

  function normalizedBalance(value) {
    const balance = Number(value);
    return Number.isSafeInteger(balance) && balance >= 0 ? balance : null;
  }

  function text(key, fallback, params = {}) {
    const value = translate?.(key, fallback, params);
    return typeof value === "string" && value !== key
      ? value
      : fallback.replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? ""));
  }
}
