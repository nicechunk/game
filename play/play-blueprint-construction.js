import { createFoundationController } from "./foundation-controller.js";
import { createPlayBlueprintUi } from "./play-blueprint-ui.js";

export function createPlayBlueprintConstruction({
  index,
  elements,
  canvas = null,
  getChunks = () => null,
  getPlayerPosition = () => [0, 0, 0],
  getWalletAddress = () => "",
  getSelectedBlueprint = () => null,
  isBlueprintModeActive = () => false,
  isBlockingBlock = () => false,
  isFluidBlock = () => false,
  blockAirId = 0,
  submitFoundation = async () => ({ submitted: false, reason: "chain-unavailable" }),
  submitFoundationResize = async () => ({ submitted: false, reason: "chain-unavailable" }),
  refreshFoundations = async () => ({ ok: false }),
  buildingController = null,
  refreshBuildings = async () => ({ ok: false }),
  getCamera = () => null,
  onStatus = () => {},
  translate = (_key, fallback) => fallback,
} = {}) {
  let blueprintUi = null;
  const render = (options) => blueprintUi?.render?.(options);
  const foundationController = createFoundationController({
    index,
    getChunks,
    getPlayerPosition,
    getWalletAddress,
    getSelectedBlueprint: () => buildingController?.mode?.() !== "building"
      ? getSelectedBlueprint()
      : null,
    isBlueprintModeActive,
    isBlockingBlock,
    isFluidBlock,
    blockAirId,
    submitFoundation,
    submitFoundationResize,
    refreshFoundations,
    onChanged: () => render({ force: true }),
    onStatus,
    translate,
  });
  const actions = {
    selectAtHit: (hit) => buildingController?.mode?.() === "building"
      ? buildingController?.selectAtHit?.(hit)
      : foundationController.selectAtHit(hit),
    confirm: () => buildingController?.mode?.() === "building"
      ? buildingController?.confirm?.()
      : foundationController.confirm(),
    cancel: () => buildingController?.mode?.() === "building"
      ? buildingController?.cancel?.()
      : foundationController.cancel(),
  };
  blueprintUi = createPlayBlueprintUi({
    elements,
    getController: () => foundationController,
    getBuildingController: () => buildingController,
    getCamera,
    canvas,
    onBuildingModeOpen: () => refreshBuildings({ force: true, quiet: true }),
    translate,
  });
  blueprintUi.bind();

  return Object.freeze({
    actions,
    foundationController,
    blueprintUi,
    render,
    update: () => blueprintUi.update(),
    setHoverHit: (hit) => foundationController.setHoverHit(hit),
    overlays: () => foundationController.overlays(),
  });
}
