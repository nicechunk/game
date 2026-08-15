import { createFoundationController } from "./foundation-controller.js";
import { createPlayLandUi } from "./play-land-ui.js";

export function createPlayLandConstruction({
  index,
  elements,
  canvas = null,
  getChunks = () => null,
  getPlayerPosition = () => [0, 0, 0],
  getWalletAddress = () => "",
  isConstructionModeActive = () => false,
  setConstructionModeActive = () => {},
  getLandContractBalance = () => null,
  submitFoundation = async () => ({ submitted: false, reason: "chain-unavailable" }),
  refreshFoundations = async () => ({ ok: false }),
  refreshLandContracts = async () => null,
  buildingController = null,
  refreshBuildings = async () => ({ ok: false }),
  getCamera = () => null,
  openContractsMarket = () => {},
  onStatus = () => {},
  translate = (_key, fallback) => fallback,
} = {}) {
  let landUi = null;
  const render = (options) => landUi?.render?.(options);
  const foundationController = createFoundationController({
    index,
    getChunks,
    getPlayerPosition,
    getWalletAddress,
    isConstructionModeActive: () => isConstructionModeActive()
      && buildingController?.mode?.() !== "building",
    getLandContractBalance,
    submitFoundation,
    refreshFoundations,
    refreshLandContracts,
    onChanged: () => render({ force: true }),
    onStatus,
    translate,
  });

  const setActive = (nextActive) => {
    const next = Boolean(nextActive);
    if (next === Boolean(isConstructionModeActive())) {
      render({ force: true });
      return next;
    }
    setConstructionModeActive(next);
    buildingController?.activate?.(next);
    if (!next) {
      foundationController.clearSelection?.();
      buildingController?.cancel?.();
    }
    render({ force: true });
    onStatus(next
      ? text("main.land.modeOpened", "Land mode opened. Select two Chunk corners with F or by tapping terrain.")
      : text("main.land.modeClosed", "Land construction mode closed."));
    return next;
  };

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
    close: () => setActive(false),
    open: () => setActive(true),
    toggle: () => setActive(!isConstructionModeActive()),
  };

  landUi = createPlayLandUi({
    elements,
    getController: () => foundationController,
    getBuildingController: () => buildingController,
    isConstructionModeActive,
    setConstructionModeActive: setActive,
    getCamera,
    canvas,
    onBuildingModeOpen: () => refreshBuildings({ force: true, quiet: true }),
    onBuyContracts: openContractsMarket,
    translate,
  });
  landUi.bind();

  return Object.freeze({
    actions,
    foundationController,
    landUi,
    render,
    update: () => landUi.update(),
    setHoverHit: (hit) => foundationController.setHoverHit(hit),
    overlays: () => foundationController.overlays(),
    isActive: () => Boolean(isConstructionModeActive()),
    open: actions.open,
    close: actions.close,
    toggle: actions.toggle,
  });

  function text(key, fallback) {
    const value = translate?.(key, fallback);
    return typeof value === "string" && value !== key ? value : fallback;
  }
}
