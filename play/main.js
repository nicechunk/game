import {
  BLOCK_ID,
  ChunkManager,
  DEFAULT_MESH_BUDGET_MS,
  FrameStatsCounter,
  RESOURCE_ID,
  RenderLog,
  ThirdPersonPlayerControls,
  WebGL2VoxelRenderer,
  blockDef,
  createCameraState,
  cameraForward,
  createVoxelItemIconCanvas as createChunkVoxelItemIconCanvas,
  detectWebGl2Support,
  createCollisionBox,
  isBlockingBlock,
  isFluidBlock,
  isMineableBlock,
  maxCollisionHorizontalExtent,
  resourceName,
  voxelItemLabel as chunkVoxelItemLabel,
} from "/chunk.js/play.js";
import { createPlayGameState } from "./game-state.js";
import { createPlayGameUi } from "./game-ui.js";
import { createMiningController } from "./mining-controller.js";
import { createBulkMiningController } from "./bulk-mining-controller.js";
import { createPlacementController } from "./placement-controller.js";
import { createActionOverlayBuilder } from "./play-action-overlays.js";
import { createInventoryController } from "./inventory-controller.js";
import { createPositionPersistence, loadSavedPlayerPosition } from "./position-persistence.js";
import { createPlayerMotionController } from "./player-motion-controller.js";
import { createPlayChainBackpackSync } from "./play-chain-backpack.js";
import { createPlayBackpackCreation } from "./play-backpack-creation.js";
import {
  createPlayChainChunkDeltaSync,
  DEFAULT_CHAIN_CHUNK_CACHE_SCOPE_HINT,
  isChainChunkPdaReadEnabled,
  setChainChunkPdaReadEnabled,
} from "./play-chain-chunk-deltas.js";
import { createPlayChainPlayerSync } from "./play-chain-player.js";
import { loadPlayChainModule, mineShouldSavePlayerPosition } from "./play-chain-adapter.js";
import { createPlayChainSession, WALLET_SESSION_CHANGED_EVENT } from "./play-chain-session.js";
import { createPlayChainFrameSync } from "./play-chain-frame-sync.js";
import { createPlayMarket } from "./play-market.js";
import { createPlayMinimap } from "./play-minimap.js";
import { createPlaySmelting } from "./play-smelting.js";
import { createPlayGuardian } from "./play-guardian.js";
import { applyGuardianConnectionState } from "./play-guardian-connection.js";
import { createGuardianAppearanceMeshCache } from "./play-guardian-appearance.js";
import { createNameChatOverlay } from "./play-name-chat-overlay.js";
import { createProfileSkillEffects } from "./play-skill-effects.js";
import { hasSpawnParam, parsePoseText, spawnCoord, spawnCoordOrNull } from "./pose-utils.js";
import { createTreeMiningPlanner } from "./tree-mining-plan.js";
import { createSupportCollapseMiningPlanner } from "./support-collapse-plan.js";
import { createPlayEffects } from "./play-effects.js";
import { createPlayRenderBudget } from "./play-render-budget.js";
import { createPlayFrameProbe } from "./play-frame-probe.js";
import { createPlayHud } from "./play-hud.js";
import { createPlayInputActions } from "./play-input-actions.js";
import { createPlayPlayerSession } from "./play-player-session.js";
import { createPlayAvatarSession } from "./play-avatar-session.js";
import { createForgedItemPlacementController } from "./play-forged-item-placement.js";
import { createPlayActionHit } from "./play-action-hit.js";
import { createPlayProfileSession } from "./play-profile-session.js";
import { createPlayStartupLogger } from "./play-startup-logger.js";
import { createPlaySurfaceDecorationSync } from "./play-surface-decoration-sync.js";
import { createPlayItemName } from "./play-item-name.js";
import { createMobileChatController } from "./play-mobile-chat.js";
import { hydrateForgedPresentationSlot } from "./forged-hotbar-compat.js";
import { createFoundationSpatialIndex } from "./foundation-spatial-index.js";
import { createFoundationController } from "./foundation-controller.js";
import { createPlayChainFoundationSync } from "./play-chain-foundations.js";
import { createPlayBlueprintUi } from "./play-blueprint-ui.js";
import { createBuildingController } from "./building-controller.js";
import { createPlayChainBuildingSync } from "./play-chain-buildings.js";
import { createPlayBuildingCache } from "./play-building-cache.js";
import { initI18n, t } from "/src/i18n.js";
import {
  getWalletSession,
  hasBoundWallet,
  redirectToWalletLogin,
  walletSessionKeys,
} from "./play-auth-session.js";
import {
  enforcePlayCharacterAccess,
  hasVerifiedPlayCharacterAccess,
} from "./play-character-access-gate.js";

const params = new URLSearchParams(location.search);
const initialWalletSession = getWalletSession();
const initialWalletReady = hasBoundWallet(initialWalletSession);
if (!initialWalletReady) redirectToWalletLogin({ autoConnect: false });
const initialCharacterAccess = initialWalletReady
  ? hasVerifiedPlayCharacterAccess(initialWalletSession.walletAddress)
    ? { allowed: true }
    : await enforcePlayCharacterAccess({
        walletAddress: initialWalletSession.walletAddress,
        fetchAppearance: async (owner) => {
          const chain = await loadPlayChainModule();
          if (typeof chain?.fetchPlayerAppearanceForOwner !== "function") {
            throw new Error("character-verification-unavailable");
          }
          return chain.fetchPlayerAppearanceForOwner(owner);
        },
      })
  : { allowed: false };
const playSessionReady = initialWalletReady && initialCharacterAccess.allowed;
const startupLogger = createPlayStartupLogger({ enabled: params.get("loadLog") !== "0" });
const PLAYABLE_MAX_VIEW_DISTANCE = 20;
const DEFAULT_PLAY_VIEW_DISTANCE = 7;
const PLAYABLE_PRELOAD_MARGIN = 2;
const GENESIS_GUARDIAN_REGION_SIZE_CHUNKS = 100;
const LOCAL_AVATAR_MESH_ID = "local-player";
const REMOTE_DEFAULT_AVATAR_MESH_ID = "peasant-guy";
const DEFAULT_AVATAR_MODEL_CODE = "NCM:peasant_guy:v1";
const queryPose = parsePoseText(params.get("pose") || "", { minViewDistance: 2, maxViewDistance: PLAYABLE_MAX_VIEW_DISTANCE });
const PLAYABLE_WORLD_SEED = "nicechunk-mainnet-001";
const PLAYABLE_TEXTURE_TILE_SIZE = 32;
const viewDistance = clampInt(Number(params.get("view")) || queryPose?.viewDistance || DEFAULT_PLAY_VIEW_DISTANCE, 2, PLAYABLE_MAX_VIEW_DISTANCE);
const meshBudgetMs = clampInt(Number(params.get("budget")) || DEFAULT_MESH_BUDGET_MS, 2, 14);
const POSITION_STORAGE_KEY = "nicechunk.chunkjs.playable.position.v2";
const POSITION_SAVE_INTERVAL_MS = 650;
const FRAME_MINIMAP_UPDATE_MS = 250;
const FRAME_ACTION_HIT_UPDATE_MS = 90;
const forceGuardianSpawn = params.get("guardianSpawn") === "1" || params.get("spawn") === "guardian";
const defaultGuardianSpawn = {
  worldX: (GENESIS_GUARDIAN_REGION_SIZE_CHUNKS / 2) * 16,
  worldY: undefined,
  worldZ: (GENESIS_GUARDIAN_REGION_SIZE_CHUNKS / 2) * 16,
  localOffsetX: 0.5,
  localOffsetY: 0,
  localOffsetZ: 0.5,
  controlYaw: Math.PI * 0.25,
  avatarYaw: Math.PI * 0.25,
  cameraPitch: -0.42,
};
const savedSpawn = (queryPose || hasSpawnParam(params) || forceGuardianSpawn) ? null : loadSavedPlayerPosition({ storageKey: POSITION_STORAGE_KEY, seed: PLAYABLE_WORLD_SEED });
const spawnState = queryPose ?? savedSpawn ?? defaultGuardianSpawn;
const spawnX = spawnCoord(params, "x", spawnState?.worldX ?? 0);
const spawnYOverride = spawnCoordOrNull(params, "y", spawnState?.worldY);
const spawnZ = spawnCoord(params, "z", spawnState?.worldZ ?? 0);
const spawnFlightEnabled = Boolean(spawnState?.flightEnabled || params.get("fly") === "1" || params.get("flight") === "1");
const BLOCK_SIZE_METERS = 0.4;
const AVATAR_HEIGHT_METERS = 1.75;
const AVATAR_HEIGHT_BLOCKS = AVATAR_HEIGHT_METERS / BLOCK_SIZE_METERS;
const PEASANT_GUY_SOURCE_HEIGHT_BLOCKS = 2.52;
const AVATAR_VISUAL_SCALE = AVATAR_HEIGHT_BLOCKS / PEASANT_GUY_SOURCE_HEIGHT_BLOCKS;
const PLAYER_CORE_WIDTH_METERS = 0.5;
const PLAYER_CORE_DEPTH_METERS = 0.38;
const PLAYER_COLLISION_SKIN_METERS = 0.01;
const PLAYER_FOOT_CLEARANCE_METERS = 0.008;
const PLAYER_COLLISION_SKIN_BLOCKS = metersToBlocks(PLAYER_COLLISION_SKIN_METERS);
const PLAYER_FOOT_CLEARANCE_BLOCKS = metersToBlocks(PLAYER_FOOT_CLEARANCE_METERS);
const DEFAULT_PLAYER_COLLISION_BOX = createCollisionBox({
  name: "player-body",
  halfWidth: metersToBlocks(PLAYER_CORE_WIDTH_METERS) * 0.5 + PLAYER_COLLISION_SKIN_BLOCKS,
  halfDepth: metersToBlocks(PLAYER_CORE_DEPTH_METERS) * 0.5 + PLAYER_COLLISION_SKIN_BLOCKS,
  height: AVATAR_HEIGHT_BLOCKS - PLAYER_FOOT_CLEARANCE_BLOCKS,
  offsetY: PLAYER_FOOT_CLEARANCE_BLOCKS,
});
const PLAYER_RADIUS = maxCollisionHorizontalExtent([DEFAULT_PLAYER_COLLISION_BOX]);
const PLAYER_BODY_HEIGHT = DEFAULT_PLAYER_COLLISION_BOX.offsetY + DEFAULT_PLAYER_COLLISION_BOX.height;
const PLAYER_GRAVITY = 24;
const PLAYER_JUMP_IMPULSE = 9.2;
const PLAYER_COLLISION_STEP = 0.14;
const PLAYER_COLLISION_EPSILON = 0.0015;
const PLAYER_GROUND_SNAP_UP = 0.22;
const PLAYER_STEP_HEIGHT_BLOCKS = 1.05;
const MINING_SWING_DURATION_MS = 260;
const ACTION_RAYCAST_DISTANCE = 48;
const ACTION_PLAYER_EYE_RAYCAST_DISTANCE = 14;
const ACTION_PLAYER_REACH_BLOCKS = metersToBlocks(3.8);
const ACTION_PLAYER_EYE_HEIGHT_BLOCKS = metersToBlocks(1.52);
const CAMERA_DISTANCE = metersToBlocks(3.36);
const CAMERA_FOCUS_HEIGHT_DESKTOP = metersToBlocks(1.5);
const CAMERA_FOCUS_HEIGHT_MOBILE = metersToBlocks(1.65);
const CAMERA_LIFT_DESKTOP = metersToBlocks(0.84);
const CAMERA_LIFT_MOBILE = metersToBlocks(1.52);
const CAMERA_PITCH_MIN = -0.92;
const CAMERA_PITCH_MAX = 0.18;
const FIRST_PERSON_CAMERA_PITCH_MAX = 0.42;
const FIRST_PERSON_EYE_HEIGHT_BLOCKS = metersToBlocks(1.52);
const FIRST_PERSON_CAMERA_BACK_DISTANCE = 0.16;
const DEFAULT_CAMERA_PITCH = -0.42;
const AVATAR_FOOT_OFFSET = 0;
const BASE_PLAYER_SPEED = 14.8;
const elements = {
  canvas: document.querySelector("#worldCanvas"),
  fps: document.querySelector("#fpsValue"),
  build: document.querySelector("#buildValue"),
  chunks: document.querySelector("#chunkValue"),
  visible: document.querySelector("#visibleValue"),
  triangles: document.querySelector("#triangleValue"),
  draw: document.querySelector("#drawValue"),
  gpu: document.querySelector("#gpuValue"),
  position: document.querySelector("#positionValue"),
  pose: document.querySelector("#poseValue"),
  poseInput: document.querySelector("#poseInput"),
  copyPose: document.querySelector("#copyPoseButton"),
  loadPose: document.querySelector("#loadPoseButton"),
  viewRangeInput: document.querySelector("#viewRangeInput"),
  viewRangeValue: document.querySelector("#viewRangeValue"),
  status: document.querySelector("#statusText"),
  joystick: document.querySelector("#joystick"),
  joystickKnob: document.querySelector("#joystickKnob"),
  mobileChatTrigger: document.querySelector("#mobileChatTrigger"),
  mobileChatOverlay: document.querySelector("#mobileChatOverlay"),
  mobileChatBackdrop: document.querySelector("#mobileChatBackdrop"),
  mobileChatPanel: document.querySelector(".mobile-chat-panel"),
  mobileChatClose: document.querySelector("#mobileChatClose"),
  mobileChatForm: document.querySelector("#mobileChatForm"),
  mobileChatInput: document.querySelector("#mobileChatInput"),
  mobileChatSend: document.querySelector("#mobileChatSend"),
  mobileChatStatus: document.querySelector("#mobileChatStatus"),
  hud: document.querySelector("#debugHud"),
  hudToggle: document.querySelector("#hudToggle"),
  mine: document.querySelector("#mineButton"),
  place: document.querySelector("#placeButton"),
  confirm: document.querySelector("#confirmButton"),
  rollback: document.querySelector("#rollbackButton"),
  gameStatus: document.querySelector("#gameStatus"),
  guardianConnectionIndicator: document.querySelector("#guardianConnectionIndicator"),
  hotbar: document.querySelector("#hotbar"),
  backpackPanel: document.querySelector("#backpackPanel"),
  backpackInventoryView: document.querySelector("#backpackInventoryView"),
  inventoryModeButton: document.querySelector("#inventoryModeButton"),
  smeltingModeButton: document.querySelector("#smeltingModeButton"),
  backpackButton: document.querySelector("#backpackButton"),
  closeBackpack: document.querySelector("#closeBackpackButton"),
  backpackGrid: document.querySelector("#backpackGrid"),
  backpackCategories: document.querySelector("#backpackCategories"),
  backpackCategoryButtons: document.querySelectorAll("[data-backpack-category]"),
  backpackMeta: document.querySelector("#backpackMeta"),
  backpackDetail: document.querySelector("#backpackDetail"),
  backpackActions: document.querySelector("#backpackActions"),
  selectAllBackpack: document.querySelector("#selectAllBackpackButton"),
  discardSelectedBackpack: document.querySelector("#discardSelectedBackpackButton"),
  cancelBackpackSelection: document.querySelector("#cancelBackpackSelectionButton"),
  profilePanel: document.querySelector("#profilePanel"),
  profileButton: document.querySelector("#profileButton"),
  closeProfile: document.querySelector("#closeProfileButton"),
  profileAvatarPreview: document.querySelector("#profileAvatarPreview"),
  profileAvatarPreviewName: document.querySelector("#profileAvatarPreviewName"),
  profileAvatarPreviewMeta: document.querySelector("#profileAvatarPreviewMeta"),
  profileIdentityBalance: document.querySelector("#profileIdentityBalance"),
  profileLevelValue: document.querySelector("#profileLevelValue"),
  profileReputationValue: document.querySelector("#profileReputationValue"),
  profileRegionValue: document.querySelector("#profileRegionValue"),
  profileBackpackValue: document.querySelector("#profileBackpackValue"),
  profileWalletValue: document.querySelector("#profileWalletValue"),
  profileWalletCopy: document.querySelector("#profileWalletCopy"),
  profileWalletHint: document.querySelector("#profileWalletHint"),
  profileLogoutButton: document.querySelector("#profileLogoutButton"),
  profileViewSkills: document.querySelector("#profileViewSkills"),
  profileTabs: document.querySelectorAll("[data-profile-tab]"),
  profileTabPanels: document.querySelectorAll("[data-profile-panel]"),
  profileGrid: document.querySelector("#profileGrid"),
  profileSkillsGrid: document.querySelector("#profileSkillsGrid"),
  profileSkillDetail: document.querySelector("#profileSkillDetail"),
  profileEquipmentList: document.querySelector("#profileEquipmentList"),
  profileEquipmentBrowserList: document.querySelector("#profileEquipmentBrowserList"),
  profileEquipmentBrowserDetail: document.querySelector("#profileEquipmentBrowserDetail"),
  equipmentPanel: document.querySelector("#equipmentPanel"),
  commandForm: document.querySelector("#commandForm"),
  commandInput: document.querySelector("#commandInput"),
  flightToggle: document.querySelector("#flightToggleButton"),
  flightUp: document.querySelector("#flightUpButton"),
  flightDown: document.querySelector("#flightDownButton"),
  renderLogToggle: document.querySelector("#renderLogToggleButton"),
  renderLogCopy: document.querySelector("#copyRenderLogButton"),
  renderLogClear: document.querySelector("#clearRenderLogButton"),
  renderLogPreview: document.querySelector("#renderLogPreview"),
  toolRangeToggle: document.querySelector("#toolRangeToggleButton"),
  toolRangeValue: document.querySelector("#toolRangeValue"),
  bulkMiningControl: document.querySelector("#bulkMiningControl"),
  bulkMiningToggle: document.querySelector("#bulkMiningToggleButton"),
  bulkMiningValue: document.querySelector("#bulkMiningValue"),
  bulkMiningConfirm: document.querySelector("#bulkMiningConfirmButton"),
  bulkMiningCancel: document.querySelector("#bulkMiningCancelButton"),
  accountHud: document.querySelector("#accountHud"),
  accountName: document.querySelector("#accountName"),
  accountLevel: document.querySelector("#accountLevel"),
  accountTitle: document.querySelector("#accountTitle"),
  accountBalance: document.querySelector("#accountBalance"),
  accountBalanceValue: document.querySelector("#accountBalanceValue"),
  accountSessionBalance: document.querySelector("#accountSessionBalance"),
  sessionButton: document.querySelector("#sessionButton"),
  rpcButton: document.querySelector("#rpcButton"),
  connectWalletButton: document.querySelector("#connectWalletButton"),
  walletPanel: document.querySelector("#walletPanel"),
  walletPanelClose: document.querySelector("#walletPanelClose"),
  walletConnectPlugin: document.querySelector("#walletConnectPlugin"),
  walletCreateLocal: document.querySelector("#walletCreateLocal"),
  walletContinueLocal: document.querySelector("#walletContinueLocal"),
  walletOpenLogin: document.querySelector("#walletOpenLogin"),
  walletDisconnect: document.querySelector("#walletDisconnect"),
  walletCurrent: document.querySelector("#walletCurrent"),
  walletAddressValue: document.querySelector("#walletAddressValue"),
  walletSecretRow: document.querySelector("#walletSecretRow"),
  walletSecretValue: document.querySelector("#walletSecretValue"),
  walletCopySecret: document.querySelector("#walletCopySecret"),
  walletStatus: document.querySelector("#walletStatus"),
  marketButton: document.querySelector("#marketButton"),
  marketPanel: document.querySelector("#marketPanel"),
  closeMarket: document.querySelector("#closeMarketButton"),
  marketTabs: document.querySelectorAll("[data-market-tab]"),
  marketTabPanels: document.querySelectorAll("[data-market-tab-panel]"),
  marketWallet: document.querySelector("#marketWallet"),
  marketBackpack: document.querySelector("#marketBackpack"),
  marketRefresh: document.querySelector("#marketRefreshButton"),
  marketSearch: document.querySelector("#marketSearch"),
  marketSort: document.querySelector("#marketSort"),
  marketCurrencyFilter: document.querySelector("#marketCurrencyFilter"),
  marketSearchMeta: document.querySelector("#marketSearchMeta"),
  marketStatus: document.querySelector("#marketStatus"),
  marketCategoryButtons: document.querySelectorAll("[data-market-category]"),
  marketListingGrid: document.querySelector("#marketListingGrid"),
  marketListingPager: document.querySelector("#marketListingPager"),
  marketInventoryGrid: document.querySelector("#marketInventoryGrid"),
  marketListingForm: document.querySelector("#marketListingForm"),
  marketListingCategory: document.querySelector("#marketListingCategory"),
  marketListingCurrency: document.querySelector("#marketListingCurrency"),
  marketListingPrice: document.querySelector("#marketListingPrice"),
  marketCreateListing: document.querySelector("#marketCreateListing"),
  marketSelectedItem: document.querySelector("#marketSelectedItem"),
  marketFormStatus: document.querySelector("#marketFormStatus"),
  marketOrdersGrid: document.querySelector("#marketOrdersGrid"),
  marketOrdersPager: document.querySelector("#marketOrdersPager"),
  smeltingButton: document.querySelector("#smeltingButton"),
  smeltingPanel: document.querySelector("#smeltingPanel"),
  closeSmelting: document.querySelector("#closeSmeltingButton"),
  smeltingResourceGrid: document.querySelector("#smeltingResourceGrid"),
  smeltingResourceMeta: document.querySelector("#smeltingResourceMeta"),
  smeltingRecipeList: document.querySelector("#smeltingRecipeList"),
  smeltingRecipeDetails: document.querySelector("#smeltingRecipeDetails"),
  smeltingInputSlot: document.querySelector("#smeltingInputSlot"),
  smeltingFuelSlot: document.querySelector("#smeltingFuelSlot"),
  smeltingOutput: document.querySelector("#smeltingOutput"),
  smeltingCoreVisual: document.querySelector("#smeltingCoreVisual"),
  smeltingCoreLabel: document.querySelector("#smeltingCoreLabel"),
  smeltingStatus: document.querySelector("#smeltingStatus"),
  smeltingStart: document.querySelector("#smeltingStart"),
  smeltingAutoFill: document.querySelector("#smeltingAutoFill"),
  smeltingClear: document.querySelector("#smeltingClear"),
  smeltingProgressValue: document.querySelector("#smeltingProgressValue"),
  smeltingProgressBar: document.querySelector("#smeltingProgressBar"),
  rpcConfigPanel: document.querySelector("#rpcConfigPanel"),
  rpcConfigForm: document.querySelector("#rpcConfigForm"),
  rpcConfigApiKey: document.querySelector("#rpcConfigApiKey"),
  rpcConfigDismiss: document.querySelector("#rpcConfigDismiss"),
  rpcConfigStatus: document.querySelector("#rpcConfigStatus"),
  sessionFundingOverlay: document.querySelector("#sessionFundingOverlay"),
  sessionFundingPanel: document.querySelector("#sessionFundingPanel"),
  sessionFundingForm: document.querySelector("#sessionFundingForm"),
  sessionFundingAmount: document.querySelector("#sessionFundingAmount"),
  sessionFundingMinimum: document.querySelector("#sessionFundingMinimum"),
  sessionFundingCurrent: document.querySelector("#sessionFundingCurrent"),
  sessionFundingCancel: document.querySelector("#sessionFundingCancel"),
  profileRpcValue: document.querySelector("#profileRpcValue"),
  profileRpcHint: document.querySelector("#profileRpcHint"),
  profileRpcAction: document.querySelector("#profileRpcAction"),
  chainEventLog: document.querySelector("#chainEventLog"),
  minimapPanel: document.querySelector("#minimapPanel"),
  minimap: document.querySelector("#minimap"),
  minimapWorldCoord: document.querySelector("#minimapWorldCoord"),
  minimapChunkCoord: document.querySelector("#minimapChunkCoord"),
  mapOverlay: document.querySelector("#mapOverlay"),
  mapStatus: document.querySelector("#mapStatus"),
  largeMinimap: document.querySelector("#largeMinimap"),
  mapTeleportForm: document.querySelector("#mapTeleportForm"),
  mapTeleportX: document.querySelector("#mapTeleportX"),
  mapTeleportZ: document.querySelector("#mapTeleportZ"),
  mapTeleportStatus: document.querySelector("#mapTeleportStatus"),
  backpackCreateOverlay: document.querySelector("#backpackCreateOverlay"),
  backpackCreatePanel: document.querySelector("#backpackCreatePanel"),
  backpackCreateHeaderIcon: document.querySelector("#backpackCreateHeaderIcon"),
  backpackCreateClose: document.querySelector("#backpackCreateClose"),
  backpackCreateHeroVisual: document.querySelector("#backpackCreateHeroVisual"),
  backpackCreateResourceIcon: document.querySelector("#backpackCreateResourceIcon"),
  backpackCreateMiningIcon: document.querySelector("#backpackCreateMiningIcon"),
  backpackCreateMaterialIcon: document.querySelector("#backpackCreateMaterialIcon"),
  backpackCreateSlotGrid: document.querySelector("#backpackCreateSlotGrid"),
  backpackCreateSubmit: document.querySelector("#backpackCreateSubmit"),
  backpackCreateSubmitLabel: document.querySelector("#backpackCreateSubmitLabel"),
  backpackCreateLearn: document.querySelector("#backpackCreateLearn"),
  backpackCreateStatus: document.querySelector("#backpackCreateStatus"),
  backpackCreateCallout: document.querySelector("#backpackCreateCallout"),
  blueprintGuide: document.querySelector("#blueprintGuide"),
  blueprintModeButtons: document.querySelectorAll("[data-blueprint-mode]"),
  foundationEditor: document.querySelector("#foundationEditor"),
  buildingEditor: document.querySelector("#buildingEditor"),
  blueprintWidth: document.querySelector("#blueprintWidth"),
  blueprintDepth: document.querySelector("#blueprintDepth"),
  blueprintDimensionButtons: document.querySelectorAll("[data-blueprint-dimension]"),
  blueprintSteps: document.querySelectorAll("[data-blueprint-step]"),
  blueprintStatus: document.querySelector("#blueprintStatus"),
  blueprintCancel: document.querySelector("#blueprintCancel"),
  blueprintConfirm: document.querySelector("#blueprintConfirm"),
  blueprintStepHint: document.querySelector("#blueprintStepHint"),
  blueprintStepNumber: document.querySelector("#blueprintStepNumber"),
  blueprintStepText: document.querySelector("#blueprintStepText"),
  blueprintIdentity: document.querySelector("#blueprintIdentity"),
  foundationMeasurements: document.querySelector("#foundationMeasurements"),
  foundationMeasureWidth: document.querySelector("#foundationMeasureWidth"),
  foundationMeasureDepth: document.querySelector("#foundationMeasureDepth"),
  buildingCode: document.querySelector("#buildingCode"),
  buildingRotateLeft: document.querySelector("#buildingRotateLeft"),
  buildingRotateRight: document.querySelector("#buildingRotateRight"),
  buildingRotation: document.querySelector("#buildingRotation"),
  buildingOffsetX: document.querySelector("#buildingOffsetX"),
  buildingOffsetZ: document.querySelector("#buildingOffsetZ"),
  buildingMetrics: document.querySelector("#buildingMetrics"),
  buildingStatus: document.querySelector("#buildingStatus"),
  buildingPreview: document.querySelector("#buildingPreview"),
  buildingConfirm: document.querySelector("#buildingConfirm"),
};

let renderer = null;
let chunks = null;
let camera = null;
let controls = null;
let player = null;
let lastFrame = performance.now();
let lastHit = null;
let lastMiningHit = null;
let lastMiningHitUntil = 0;
let positionPersistence = null;
let motion = null;
let avatarSession = null;
let mining = null;
let bulkMining = null;
let placement = null;
let forgedPlacement = null;
let chainBackpack = null;
let backpackCreation = null;
let chainChunkDeltas = null;
let chainPlayer = null;
let chainSession = null;
let chainFrameSync = null;
let minimap = null;
let smelting = null;
let market = null;
let inventory = null;
let guardian = null;
let guardianAppearanceMeshes = null;
let nameChatOverlay = null;
const fps = new FrameStatsCounter();
const renderLog = new RenderLog({ maxEntries: 2200 });
const frameProbeLogger = createPlayFrameProbe({ renderLog });
const gameState = createPlayGameState({
  resourceNone: RESOURCE_ID.none,
  ownerAddress: initialWalletSession.walletAddress,
  onEquipmentChange: (mutation) => chainPlayer?.queueEquipmentChanges?.(mutation),
});
const foundationIndex = createFoundationSpatialIndex({ chunkSize: 16 });
const buildingCache = createPlayBuildingCache({
  getScope: () => chainSession?.snapshot()?.rpcUrl || "default",
});
const voxelItemLabel = createPlayItemName({
  blockDef,
  voxelItemLabel: chunkVoxelItemLabel,
  resourceName,
  translate: t,
});
let profileSkillEffects = createProfileSkillEffects({ profile: gameState.playerProfile });
const frameAvatars = [];
let playUi = null;
let debugController = null;
let debugControllerOptions = null;
let debugControllerPromise = null;
let mobileChat = null;
let actionOverlayBuilder = null;
let effects = null;
let renderBudget = null;
let playHud = null;
let inputActions = null;
let playerSession = null;
let actionHit = null;
let profileSession = null;
let surfaceDecorationSync = null;
let foundationSync = null;
let foundationController = null;
let buildingSync = null;
let buildingController = null;
let blueprintActions = null;
let blueprintUi = null;
let lastWorldDeltaKind = null;
let statusQuietTimer = 0;
let lastFrameMinimapAt = 0;
let minimapUpdatePending = false;
let firstMinimapUpdatePending = true;
let onboardingHighlightedBlock = null;

const onboardingGameApi = Object.freeze({
  getPlayer: () => player,
  getPlayerPosition: () => player ? playerWorldFloat() : null,
  getCamera: () => camera,
  getCanvas: () => elements.canvas,
  getChunks: () => chunks,
  getMotion: () => motion,
  isBlockingBlock,
  setHighlightedBlock(block) {
    onboardingHighlightedBlock = normalizeOnboardingBlock(block);
  },
});

window.addEventListener("nicechunk:onboarding-game-api-request", (event) => {
  event?.detail?.accept?.(onboardingGameApi);
});
window.addEventListener("nicechunk:onboarding-open-rpc", () => chainSession?.openRpcPanel?.());

initI18n(document).then(({ dictionary }) => {
  globalThis.NiceChunkLoading?.setDictionary?.(dictionary);
  renderGameUi();
  chainSession?.render?.();
}).catch((error) => {
  console.warn("NiceChunk play translations unavailable:", error);
});
window.addEventListener("nicechunk:languagechange", () => {
  renderGameUi();
  chainSession?.render?.();
  blueprintUi?.render?.({ force: true });
  debugController?.updateBulkMiningHud?.();
  mobileChat?.refreshTranslations?.();
});
window.addEventListener(WALLET_SESSION_CHANGED_EVENT, (event) => {
  void handleWalletSessionChanged(event?.detail?.walletAddress);
});

if (playSessionReady) {
  globalThis.NiceChunkLoading?.taskStart?.("boot");
  boot().catch((error) => {
    startupLogger.fail(null, error, { phase: "boot" });
    globalThis.NiceChunkLoading?.fail?.(error);
    console.error(error);
    setStatus(`Failed: ${error?.message || error}`);
  }).finally(() => {
    globalThis.NiceChunkLoading?.taskDone?.("boot");
  });
}

window.addEventListener("storage", (event) => {
  if (!Object.values(walletSessionKeys).includes(event.key)) return;
  const session = getWalletSession();
  if (!hasBoundWallet(session)) {
    redirectToWalletLogin({ autoConnect: false });
    return;
  }
  if (session.walletAddress !== gameState.ownerAddress) window.location.reload();
});

let walletSwitchSerial = 0;

async function handleWalletSessionChanged(walletAddress) {
  const nextWallet = String(walletAddress || "").trim();
  if (!nextWallet) {
    redirectToWalletLogin({ autoConnect: false });
    return;
  }
  if (nextWallet === gameState.ownerAddress) return;
  const access = await enforcePlayCharacterAccess({
    walletAddress: nextWallet,
    fetchAppearance: async (owner) => {
      const chain = await loadPlayChainModule();
      if (typeof chain?.fetchPlayerAppearanceForOwner !== "function") {
        throw new Error("character-verification-unavailable");
      }
      return chain.fetchPlayerAppearanceForOwner(owner);
    },
  });
  if (!access.allowed) return;
  const switched = gameState.setOwnerAddress(nextWallet);
  if (!switched.changed) return;
  const serial = ++walletSwitchSerial;
  renderGameUi();
  await avatarSession?.syncModelFromProfile?.({ force: true, quiet: true });
  if (!nextWallet || serial !== walletSwitchSerial) return;
  await Promise.allSettled([
    chainBackpack?.refresh?.({ force: true, quiet: true }),
    chainPlayer?.refresh?.({ force: true, quiet: true }),
    foundationSync?.refresh?.({ force: true, quiet: true }),
  ].filter(Boolean));
  if (serial !== walletSwitchSerial || gameState.ownerAddress !== nextWallet) return;
  await avatarSession?.syncModelFromProfile?.({ force: true, quiet: true });
  renderGameUi();
  chainSession?.render?.();
}

function setStatus(message, { quiet = true } = {}) {
  const text = String(message || "");
  if (elements.status) elements.status.textContent = text;
  if (elements.gameStatus) {
    elements.gameStatus.textContent = text;
    elements.gameStatus.classList.remove("is-quiet", "is-hidden");
    clearTimeout(statusQuietTimer);
    if (quiet) {
      statusQuietTimer = setTimeout(() => elements.gameStatus?.classList.add("is-hidden"), 5000);
    }
  }
}

async function boot() {
  globalThis.NiceChunkLoading?.stage?.("engine", 0.26);
  const bootToken = startupLogger.begin("game boot", {
    seed: PLAYABLE_WORLD_SEED,
    viewDistance,
    preloadMargin: PLAYABLE_PRELOAD_MARGIN,
  });
  startupLogger.logEnvironment({
    seed: PLAYABLE_WORLD_SEED,
    viewDistance,
    meshBudgetMs,
  });
  const support = startupLogger.step("WebGL2 capability check", () => detectWebGl2Support());
  if (!support.supported) {
    startupLogger.end(bootToken, { supported: false, reason: support.label || support.reason });
    globalThis.NiceChunkLoading?.fail?.(new Error(`WebGL2 unavailable: ${support.label || support.reason}`));
    setStatus(`WebGL2 unavailable: ${support.label || support.reason}`, { quiet: false });
    return;
  }
  renderBudget = startupLogger.step("render budget setup", () => createPlayRenderBudget({
    preloadMargin: PLAYABLE_PRELOAD_MARGIN,
    maxViewDistance: PLAYABLE_MAX_VIEW_DISTANCE,
    getFps: () => fps.fps || 60,
    getControls: () => controls,
    getChunks: () => chunks,
    getRenderer: () => renderer,
    isMotionActive,
    isMobileViewport,
  }));
  chunks = startupLogger.step("ChunkManager and workers", () => new ChunkManager({
    viewDistance,
    preloadMargin: PLAYABLE_PRELOAD_MARGIN,
    workerCount: renderBudget.preferredWorkerCount(),
    deferInitialBuilds: true,
    deferContinuousBuildDispatch: true,
    maxQueuedBuilds: renderBudget.maxBuildQueueForViewDistance(viewDistance),
  }), (manager) => ({ workers: manager?.workers?.length || 0, maxWorkers: manager?.workerCount || 0, workerMode: Boolean(manager?.useWorkers) }));
  chunks.setRenderLogger(renderLog);
  startupLogger.step("initial chunk range enqueue", () => chunks.updatePlayerPosition(spawnX, 112, spawnZ));
  startupLogger.setInitialChunkTarget(chunks.chunks.size);
  const spawnY = Number.isFinite(spawnYOverride)
    ? spawnYOverride
    : startupLogger.step("spawn terrain height query", () => chunks.surfaceYAt(spawnX, spawnZ));
  const localOffsetX = Number.isFinite(spawnState?.localOffsetX) && !hasSpawnParam(params, "x") ? clamp(spawnState.localOffsetX, 0, 0.999999) : 0.5;
  const localOffsetY = Number.isFinite(spawnState?.localOffsetY) && !hasSpawnParam(params, "y") ? clamp(spawnState.localOffsetY, 0, 0.999999) : 0;
  const localOffsetZ = Number.isFinite(spawnState?.localOffsetZ) && !hasSpawnParam(params, "z") ? clamp(spawnState.localOffsetZ, 0, 0.999999) : 0.5;
  const savedYaw = Number.isFinite(spawnState?.controlYaw) ? spawnState.controlYaw : Math.PI;
  const savedPitch = clamp(Number.isFinite(spawnState?.cameraPitch) ? spawnState.cameraPitch : DEFAULT_CAMERA_PITCH, CAMERA_PITCH_MIN, CAMERA_PITCH_MAX);
  player = {
    worldX: spawnX,
    worldY: spawnY,
    worldZ: spawnZ,
    localOffsetX,
    localOffsetY,
    localOffsetZ,
    controlYaw: savedYaw,
    avatarYaw: Number.isFinite(spawnState?.avatarYaw) ? spawnState.avatarYaw : savedYaw,
    yaw: Number.isFinite(spawnState?.avatarYaw) ? spawnState.avatarYaw : savedYaw,
    cameraPitch: savedPitch,
    firstPersonCamera: false,
    velocityY: 0,
    grounded: true,
    flightEnabled: spawnFlightEnabled,
    collisionBoxes: [DEFAULT_PLAYER_COLLISION_BOX],
    equipmentCollisionBoxes: [],
    miningSwingStartedAt: 0,
    miningSwingUntil: 0,
    miningSwingDurationMs: MINING_SWING_DURATION_MS,
    miningAimYaw: null,
    miningAimPitch: 0,
    radius: PLAYER_RADIUS,
    bodyHeight: PLAYER_BODY_HEIGHT,
  };
  camera = createCameraState({ worldX: spawnX, worldY: spawnY + 6, worldZ: spawnZ - 10, localOffsetX: 0.5, localOffsetY: 0.5, localOffsetZ: 0.5, yaw: player.controlYaw + Math.PI, pitch: savedPitch, far: viewFarPlane(viewDistance) });
  motion = createPlayerMotionController({
    getPlayer: () => player,
    getCamera: () => camera,
    getControls: () => controls,
    getChunks: () => chunks,
    getAvatar: () => avatarSession?.avatar() ?? null,
    defaultCollisionBox: DEFAULT_PLAYER_COLLISION_BOX,
    isMobileViewport,
    config: {
      blockSizeMeters: BLOCK_SIZE_METERS,
      avatarFootOffset: AVATAR_FOOT_OFFSET,
      avatarHeightBlocks: AVATAR_HEIGHT_BLOCKS,
      playerRadius: PLAYER_RADIUS,
      playerBodyHeight: PLAYER_BODY_HEIGHT,
      gravity: PLAYER_GRAVITY,
      jumpImpulse: PLAYER_JUMP_IMPULSE,
      collisionStep: PLAYER_COLLISION_STEP,
      collisionEpsilon: PLAYER_COLLISION_EPSILON,
      groundSnapUp: PLAYER_GROUND_SNAP_UP,
      stepHeightBlocks: PLAYER_STEP_HEIGHT_BLOCKS,
      cameraDistance: CAMERA_DISTANCE,
      cameraFocusHeightDesktop: CAMERA_FOCUS_HEIGHT_DESKTOP,
      cameraFocusHeightMobile: CAMERA_FOCUS_HEIGHT_MOBILE,
      cameraLiftDesktop: CAMERA_LIFT_DESKTOP,
      cameraLiftMobile: CAMERA_LIFT_MOBILE,
      cameraPitchMin: CAMERA_PITCH_MIN,
      cameraPitchMax: CAMERA_PITCH_MAX,
      firstPersonEyeHeight: FIRST_PERSON_EYE_HEIGHT_BLOCKS,
      firstPersonCameraBackDistance: FIRST_PERSON_CAMERA_BACK_DISTANCE,
      firstPersonPitchMin: CAMERA_PITCH_MIN,
      firstPersonPitchMax: FIRST_PERSON_CAMERA_PITCH_MAX,
    },
  });
  syncCameraToPlayer(1 / 60, { force: true });
  renderer = new WebGL2VoxelRenderer(elements.canvas, {
    viewDistance,
    textureTileSize: PLAYABLE_TEXTURE_TILE_SIZE,
    textureSeed: PLAYABLE_WORLD_SEED,
    onInitStage: startupLogger.rendererStage,
  });
  renderer.setRenderLogger(renderLog);
  startupLogger.step("WebGL2 renderer total", () => renderer.init());
  globalThis.NiceChunkLoading?.stage?.("engine", 0.56);
  const gameplaySetupToken = startupLogger.begin("gameplay session construction");
  effects = createPlayEffects({
    getRenderer: () => renderer,
    getChunks: () => chunks,
    getPlayerPosition: () => player ? playerWorldFloat() : [0, 0, 0],
    isFluidBlock,
    isBlockingBlock,
  });
  playHud = createPlayHud({
    elements,
    getChunks: () => chunks,
    getChainChunkDeltas: () => chainChunkDeltas,
    getPlayerPosition: playerWorldFloat,
    getPoseSnapshot: () => playerSession?.currentPoseSnapshot(),
    getDebugController: () => debugController,
    getLastHit: () => lastHit,
    getLastMiningHit: () => lastMiningHit,
    getLastMiningHitUntil: () => lastMiningHitUntil,
  });
  playerSession = createPlayPlayerSession({
    elements,
    getPlayer: () => player,
    getCamera: () => camera,
    getChunks: () => chunks,
    getRenderer: () => renderer,
    getMotion: () => motion,
    getPositionPersistence: () => positionPersistence,
    getPlayerWorldFloat: playerWorldFloat,
    setPlayerWorldFloat,
    syncCameraToPlayer,
    resolvePlayerPenetration,
    setViewDistance,
    cameraLoadDirection,
    setStatus,
    defaultViewDistance: viewDistance,
    pitchMin: CAMERA_PITCH_MIN,
    pitchMax: CAMERA_PITCH_MAX,
    maxViewDistance: PLAYABLE_MAX_VIEW_DISTANCE,
  });
  elements.viewRangeInput.value = String(viewDistance);
  playHud.updateViewRangeLabel(viewDistance);
  profileSession = createPlayProfileSession({
    gameState,
    getChainPlayer: () => chainPlayer,
    getChainSession: () => chainSession,
    getAvatarSession: () => avatarSession,
    renderGameUi,
    setStatus,
    defaultModelCode: DEFAULT_AVATAR_MODEL_CODE,
  });
  avatarSession = createPlayAvatarSession({
    elements,
    gameState,
    getPlayer: () => player,
    getRenderer: () => renderer,
    getMotion: () => motion,
    getPlayerWorldFloat: playerWorldFloat,
    getModelCode: () => profileSession?.currentAvatarModelCode() || DEFAULT_AVATAR_MODEL_CODE,
    setStatus,
    readableError,
    localMeshId: LOCAL_AVATAR_MESH_ID,
    remoteDefaultMeshId: REMOTE_DEFAULT_AVATAR_MESH_ID,
    defaultModelCode: DEFAULT_AVATAR_MODEL_CODE,
    visualScale: AVATAR_VISUAL_SCALE,
    defaultCollisionBox: DEFAULT_PLAYER_COLLISION_BOX,
    playerBodyHeight: PLAYER_BODY_HEIGHT,
    avatarHeightMeters: AVATAR_HEIGHT_METERS,
    blockSizeMeters: BLOCK_SIZE_METERS,
    collisionSkinBlocks: PLAYER_COLLISION_SKIN_BLOCKS,
    footClearanceBlocks: PLAYER_FOOT_CLEARANCE_BLOCKS,
    miningSwingDurationMs: MINING_SWING_DURATION_MS,
  });
  startupLogger.end(gameplaySetupToken);
  await startupLogger.track("avatar model and tool mesh", avatarSession.init());
  const interfaceSetupToken = startupLogger.begin("UI, chain and action systems construction");
  guardianAppearanceMeshes = createGuardianAppearanceMeshCache({
    renderer,
    scale: AVATAR_VISUAL_SCALE,
    defaultMeshId: REMOTE_DEFAULT_AVATAR_MESH_ID,
    defaultModelCode: DEFAULT_AVATAR_MODEL_CODE,
    attachIronPickaxe: true,
    onStatus: appendGuardianEvent,
    appendEvent: appendGuardianEvent,
  });
  resolvePlayerPenetration();
  controls = new ThirdPersonPlayerControls(elements.canvas, camera, player, {
    speed: BASE_PLAYER_SPEED,
    pitchMin: CAMERA_PITCH_MIN,
    pitchMax: CAMERA_PITCH_MAX,
    firstPersonPitchMin: CAMERA_PITCH_MIN,
    firstPersonPitchMax: FIRST_PERSON_CAMERA_PITCH_MAX,
  });
  refreshProfileSkillEffects();
  playUi = createPlayGameUi({
    elements,
    gameState,
    createVoxelItemIconCanvas,
    resourceName,
    voxelItemLabel,
    getPlayerPosition: () => player ? playerWorldFloat() : [0, 0, 0],
    getPendingCount: () => (mining?.pendingCount() ?? 0) + (placement?.pendingCount() ?? 0),
    getChainSnapshot: chainSnapshot,
    getAvatarEquipment: currentAvatarEquipment,
    onBackpackPanelOpened: () => smelting?.showInventory?.(),
    onBackpackPanelClosed: () => {
      smelting?.closePanel?.();
      inventory?.clearSelection?.({ silent: true });
    },
    onStatus: setStatus,
    translate: translateWithFallback,
  });
  inventory = createInventoryController({
    elements,
    gameState,
    renderGameUi,
    renderHotbar,
    renderBackpack: () => playUi?.renderBackpack(),
    createVoxelItemIconCanvas,
    onDiscardBackpackSlots: discardBackpackSlots,
    onStatus: setStatus,
    voxelItemLabel,
    resourceName,
    getRpcUrl: () => chainSession?.snapshot()?.rpcUrl || "",
    translate: translateWithFallback,
  });
  chainSession = createPlayChainSession({
    elements,
    gameState,
    getPlayerPosition: () => player ? playerWorldFloat() : [0, 0, 0],
    getBackpackSnapshot: () => chainBackpack?.snapshot?.() ?? null,
    getPlayerIdentity: () => profileSession?.identityForHud(),
    openProfilePanel,
    renderProfile,
    setStatus,
    createVoxelItemIconCanvas,
    resourceName,
    getBackpackTarget: chainBackpackAnimationTarget,
    onBackpackRequired: (detail) => backpackCreation?.open(detail),
  });
  chainPlayer = createPlayChainPlayerSync({
    getWalletAddress: () => chainSession?.snapshot()?.walletAddress || "",
    getGameState: () => gameState,
    refreshBackpack: (options) => chainBackpack?.refresh?.(options) ?? Promise.resolve(null),
    onChanged: () => {
      refreshProfileSkillEffects();
      avatarSession?.syncModelFromProfile();
      renderGameUi();
      chainSession?.render?.();
    },
    onStatus: setStatus,
    appendEvent: (message) => chainSession?.appendChainEvent?.(message),
    translate: translateWithFallback,
  });
  chainChunkDeltas = createPlayChainChunkDeltaSync({
    chunks,
    onChanged: () => {
      renderGameUi();
      updateActionHitForFrame(performance.now(), { force: true });
    },
    onStatus: setStatus,
    appendEvent: (message) => chainSession?.appendChainEvent?.(message),
    batchSize: 100,
    persistentScopeHint: DEFAULT_CHAIN_CHUNK_CACHE_SCOPE_HINT,
  });
  surfaceDecorationSync = createPlaySurfaceDecorationSync({
    chunks,
    worldSeed: PLAYABLE_WORLD_SEED,
    onRulesChanged: () => chainBackpack?.refreshDecorationIdentity?.(),
  });
  guardian = createPlayGuardian({
    chunks,
    getWalletAddress: () => chainSession?.snapshot()?.walletAddress || "",
    getRpcUrl: () => chainSession?.snapshot()?.rpcUrl || "",
    getPlayerName: () => profileSession?.displayName() || "Local Miner",
    getPlayerPose: () => playerSession?.currentGuardianPose(),
    getEquipment: currentAvatarEquipment,
    fetchRemoteEquipmentSnapshots: async (wallets) => {
      const module = await loadPlayChainModule();
      return typeof module.fetchPlayerEquipmentForOwners === "function"
        ? module.fetchPlayerEquipmentForOwners(wallets)
        : [];
    },
    resolveRemoteAvatarMeshId: (ownerWallet, options) => guardianAppearanceMeshes?.resolveMeshIdForWallet(ownerWallet, options),
    appendEvent: appendGuardianEvent,
    onWorldChanged: (event) => {
      if (event?.type === "guardian-dig") {
        chainChunkDeltas?.invalidateChunkForWorld(event.worldX, event.worldZ);
        chainChunkDeltas?.requestSync({ reason: "guardian-dig", quiet: true });
      }
      renderGameUi();
      updateActionHitForFrame(performance.now(), { force: true });
    },
    onBuildingRegionDigest: (digest) => {
      void foundationSync?.handleRegionDigest?.(digest);
    },
    onBuildingManifest: (manifest) => {
      void foundationSync?.handleRegionManifest?.(manifest);
    },
    onGuardianRegionsChanged: () => {
      void foundationSync?.refresh?.({ force: true, quiet: true });
    },
  });
  nameChatOverlay = createNameChatOverlay({
    root: document.body,
    canvas: elements.canvas,
    getCamera: () => camera,
    getLocalTarget: localOverlayTarget,
    appendRemoteTargets: (target, now) => guardian?.appendOverlayTargets?.(target, now),
  }).bind();
  chainBackpack = createPlayChainBackpackSync({
    gameState,
    getWalletAddress: () => chainSession?.snapshot()?.walletAddress || "",
    onChanged: () => {
      chainPlayer?.applyEquipmentSnapshot?.();
      chainPlayer?.migrateEquipmentIfNeeded?.();
      renderGameUi();
    },
    onStatus: setStatus,
    appendEvent: (message) => chainSession?.appendChainEvent?.(message),
    chunkSize: chunks.chunkSize || 16,
    resolveSurfaceDecoration: (resource) => surfaceDecorationSync?.resolveBackpackDecoration?.(resource),
  });
  backpackCreation = createPlayBackpackCreation({
    elements,
    gameState,
    getChainBackpack: () => chainBackpack,
    getChainSession: () => chainSession,
    createVoxelItemIconCanvas,
    closePanels: () => closePanels(),
    onChanged: renderGameUi,
    onCreated: () => renderGameUi(),
    onStatus: setStatus,
    appendEvent: (message) => chainSession?.appendChainEvent?.(message),
  });
  chainFrameSync = createPlayChainFrameSync({
    getChainBackpack: () => chainBackpack,
    getChainPlayer: () => chainPlayer,
    getChainChunkDeltas: () => chainChunkDeltas,
    getAvatarSession: () => avatarSession,
    renderGameUi,
  });
  minimap = createPlayMinimap({
    elements,
    worldSeed: PLAYABLE_WORLD_SEED,
    getPlayerPosition: () => player ? playerWorldFloat() : [0, 0, 0],
    getCameraHeading: minimapCameraHeading,
    getViewDistance: () => chunks?.viewDistance ?? viewDistance,
    getGuardianSnapshot: () => guardian?.snapshot?.() ?? null,
    onTeleport: (x, z) => playerSession?.teleportPlayerFromMap(x, z) ?? false,
    setStatus,
  });
  smelting = createPlaySmelting({
    elements,
    gameState,
    createVoxelItemIconCanvas,
    resourceName,
    voxelItemLabel,
    getSkillEffects: () => profileSkillEffects,
    getBackpackSnapshot: () => chainBackpack?.snapshot?.() ?? null,
    refreshBackpack: ({ previousUpdatedSlot = "", force = true } = {}) => {
      if (previousUpdatedSlot && chainBackpack?.refreshAfterMutation) {
        return chainBackpack.refreshAfterMutation({ previousUpdatedSlot });
      }
      return chainBackpack?.refresh?.({ force, quiet: true }) ?? Promise.resolve({ ok: false, reason: "backpack-sync-unavailable" });
    },
    onSharedPanelOpen: () => playUi?.closeProfilePanel(),
    onStatus: setStatus,
    onChanged: renderGameUi,
  });
  market = createPlayMarket({
    elements,
    gameState,
    createVoxelItemIconCanvas,
    resourceName,
    voxelItemLabel,
    getChainSnapshot: chainSnapshot,
    onStatus: setStatus,
    onChanged: renderGameUi,
  });
  actionHit = createPlayActionHit({
    canvas: elements.canvas,
    getCamera: () => camera,
    getChunks: () => chunks,
    getPlayer: () => player,
    getFirstPersonCamera: isFirstPersonCameraEnabled,
    getPlayerWorldFloat: playerWorldFloat,
    getPlayerBounds,
    raycastDistance: ACTION_RAYCAST_DISTANCE,
    playerEyeRaycastDistance: ACTION_PLAYER_EYE_RAYCAST_DISTANCE,
    playerReachBlocks: ACTION_PLAYER_REACH_BLOCKS,
    playerEyeHeightBlocks: ACTION_PLAYER_EYE_HEIGHT_BLOCKS,
    playerBodyHeight: PLAYER_BODY_HEIGHT,
    pitchMin: CAMERA_PITCH_MIN,
    pitchMax: CAMERA_PITCH_MAX,
    firstPersonPitchMin: CAMERA_PITCH_MIN,
    firstPersonPitchMax: FIRST_PERSON_CAMERA_PITCH_MAX,
    updateIntervalMs: FRAME_ACTION_HIT_UPDATE_MS,
  });
  foundationSync = createPlayChainFoundationSync({
    index: foundationIndex,
    cache: buildingCache,
    getWalletAddress: () => chainSession?.snapshot()?.walletAddress || "",
    getBlueprintIds: () => gameState.hotbarSlots
      .filter((slot) => slot?.itemId === "blueprint_tool")
      .map((slot) => slot.blueprintId)
      .filter(Boolean),
    getPlayerPosition: playerWorldFloat,
    getGuardianRegion: (regionX, regionZ) => guardian?.getBuildingRegion?.(regionX, regionZ) ?? null,
    ensureGuardianNeighborhood: () => guardian?.ensureBuildingNeighborhood?.() ?? Promise.resolve([]),
    refreshGuardianRegions: (regions) => guardian?.refreshBuildingRegions?.(regions) ?? Promise.resolve([]),
    ensureGuardianCoverage: (foundation) => guardian?.ensureBuildingCoverage?.(foundation)
      ?? Promise.resolve({ ok: false, missing: [] }),
    requestCurrentGuardianManifest: (revision) => guardian?.requestCurrentBuildingManifest?.(revision) === true,
    announceGuardianBuilding: (record, options) => guardian?.announceBuilding?.(record, options)
      ?? Promise.resolve({ ok: false }),
    chunkSize: chunks.chunkSize || 16,
    onChanged: () => blueprintUi?.render?.({ force: true }),
    onStatus: setStatus,
    translate: translateWithFallback,
  });
  foundationController = createFoundationController({
    index: foundationIndex,
    getChunks: () => chunks,
    getPlayerPosition: playerWorldFloat,
    getWalletAddress: () => chainSession?.snapshot()?.walletAddress || "",
    getSelectedBlueprint: () => buildingController?.mode?.() !== "building"
      ? gameState.getSelectedBlueprintSlot?.()
      : null,
    isBlueprintModeActive: () => gameState.isBlueprintSelected?.() === true,
    isBlockingBlock,
    isFluidBlock,
    blockAirId: BLOCK_ID.air,
    submitFoundation: (payload) => foundationSync?.create?.(payload),
    submitFoundationResize: (payload) => foundationSync?.resize?.(payload),
    refreshFoundations: (options) => foundationSync?.refresh?.(options),
    onChanged: () => blueprintUi?.render?.({ force: true }),
    onStatus: setStatus,
    translate: translateWithFallback,
  });
  buildingController = createBuildingController({
    index: foundationIndex,
    getWalletAddress: () => chainSession?.snapshot()?.walletAddress || "",
    getPlayerPosition: playerWorldFloat,
    getSelectedBlueprint: () => gameState.getSelectedBlueprintSlot?.(),
    submitBuilding: (payload) => buildingSync?.create?.(payload),
    onChanged: () => blueprintUi?.render?.({ force: true }),
    onCollisionGeometryChanged: reconcilePlayerAfterBuildingCollisionChange,
    onStatus: setStatus,
    translate: translateWithFallback,
    chunkSize: chunks.chunkSize || 16,
    chainMeshCacheEntries: isMobileViewport() ? 16 : 64,
    chainMeshCacheBytes: (isMobileViewport() ? 16 : 48) * 1024 * 1024,
  });
  chunks.setSupplementalCollisionProvider?.(buildingController);
  buildingSync = createPlayChainBuildingSync({
    cache: buildingCache,
    getWalletAddress: () => chainSession?.snapshot()?.walletAddress || "",
    getFoundations: () => foundationIndex.list(),
    getFoundationsNear: (worldX, worldZ, radius) => foundationIndex.listNear(worldX, worldZ, radius),
    getFoundationVersion: () => foundationIndex.version(),
    getPlayerPosition: playerWorldFloat,
    viewDistance,
    preloadMargin: PLAYABLE_PRELOAD_MARGIN,
    chunkSize: chunks.chunkSize || 16,
    refreshFoundations: (options) => foundationSync?.refresh?.(options) ?? Promise.resolve({ ok: false }),
    announceGuardianBuilding: (record, options) => guardian?.announceBuilding?.(record, options)
      ?? Promise.resolve({ ok: false }),
    applyBuildings: (buildings) => buildingController?.applyChainBuildings?.(buildings),
    onChanged: () => blueprintUi?.render?.({ force: true }),
    onStatus: setStatus,
    translate: translateWithFallback,
  });
  blueprintActions = {
    selectAtHit: (hit) => buildingController?.mode?.() === "building"
      ? buildingController?.selectAtHit?.(hit)
      : foundationController?.selectAtHit?.(hit),
    confirm: () => buildingController?.mode?.() === "building"
      ? buildingController?.confirm?.()
      : foundationController?.confirm?.(),
    cancel: () => buildingController?.mode?.() === "building"
      ? buildingController?.cancel?.()
      : foundationController?.cancel?.(),
  };
  blueprintUi = createPlayBlueprintUi({
    elements,
    getController: () => foundationController,
    getBuildingController: () => buildingController,
    getCamera: () => camera,
    canvas: elements.canvas,
    onBuildingModeOpen: () => buildingSync?.refresh?.({ force: true, quiet: true }),
    translate: translateWithFallback,
  });
  const treeMiningPlanner = createTreeMiningPlanner({ chunks, blockDef, blockAirId: BLOCK_ID.air });
  const supportCollapseMiningPlanner = createSupportCollapseMiningPlanner({
    chunks,
    blockDef,
    isFluidBlock,
    isMineableBlock,
    blockAirId: BLOCK_ID.air,
  });
  mining = createMiningController({
    gameState,
    chunks,
    getHit: getMiningActionHit,
    getPlayerBounds,
    getToolCollisionFrame: currentToolCollisionFrame,
    getToolTargetingSolution: currentToolTargetingSolution,
    getMiningPlan: combinedMiningPlan,
    blockDef,
    isFluidBlock,
    isMineableBlock,
    resourceName,
    getSkillEffects: () => profileSkillEffects,
    blockAirId: BLOCK_ID.air,
    canMine: () => gameState.isBackpackAvailable() || "no-backpack",
    onMiningBlocked: (detail) => backpackCreation?.open({ ...detail, source: "mining" }),
    isBlockProtected: (block) => foundationController?.isBlockProtected?.(block) === true,
    onStatus: setStatus,
    onChanged: renderGameUi,
    onSwingStart: (swing) => avatarSession?.startMiningSwing(swing),
    onDamage: () => renderHotbar(),
    onTargetSelected: (hit) => {
      if (hit?.hit) rememberMiningHit(hit);
    },
    onPending: (pending) => {
      lastWorldDeltaKind = "mine";
      pending.playerChainPosition = playerSession?.currentPlayerChainPosition();
      dispatchEvent(new CustomEvent("nicechunk:mining-submission-pending", {
        detail: {
          txId: pending.txId,
          worldX: pending.worldX,
          worldY: pending.worldY,
          worldZ: pending.worldZ,
          blockId: pending.blockId,
        },
      }));
      if (pending.blocks?.length > 1) guardian?.sendDigBatch?.(pending.blocks, 1);
      else guardian?.sendDig(pending, 1);
      chainSession?.handlePendingMine(pending, {
        confirmTx: (txId) => mining?.confirmTx?.(txId),
        rollbackTx: (txId) => mining?.rollbackTx?.(txId),
      });
    },
    onConfirm: (pending) => {
      forgetMiningHit(pending);
      effects?.emitConfirmedBlockFracture?.(pending);
      guardian?.sendConfirmedMine(pending);
      chainSession?.handleConfirmedMine(pending);
      invalidateMiningChunks(pending);
      chainChunkDeltas?.requestSync({ reason: "mine-confirm", quiet: true });
      refreshPdaBackpackAfterAction(pending);
      requestChainPlayerPositionSaveForResourceMine(pending);
    },
    onRollback: (pending) => {
      forgetMiningHit(pending);
      chainSession?.handleRollbackMine(pending);
    },
    swingDurationMs: MINING_SWING_DURATION_MS,
    miningReach: ACTION_PLAYER_REACH_BLOCKS,
    impactProgress: 0.64,
  });
  bulkMining = createBulkMiningController({
    chunks,
    blockDef,
    isFluidBlock,
    isMineableBlock,
    blockAirId: BLOCK_ID.air,
    isBlockProtected: (block) => foundationController?.isBlockProtected?.(block) === true,
    submitBlocks: (blocks, { authorization } = {}) => mining?.queueBatchMine?.(blocks, { authorization }),
    onStatus: setStatus,
    onChanged: (snapshot) => debugController?.updateBulkMiningHud?.(snapshot),
    translate: translateWithFallback,
  });

  function combinedMiningPlan(hit) {
    return treeMiningPlanner(hit) || supportCollapseMiningPlanner(hit);
  }
  placement = createPlacementController({
    gameState,
    chunks,
    getHit: getActionHit,
    getPlayerBounds,
    blockDef,
    isBlockingBlock,
    isFluidBlock,
    blockAirId: BLOCK_ID.air,
    onStatus: setStatus,
    onChanged: renderGameUi,
    onPending: (pending) => {
      lastWorldDeltaKind = "place";
      chainSession?.handlePendingPlace(pending, {
        confirmTx: (txId) => placement?.confirmTx?.(txId),
        rollbackTx: (txId) => placement?.rollbackTx?.(txId),
      });
    },
    onConfirm: (pending) => {
      chainSession?.handleConfirmedPlace(pending);
      refreshPdaBackpackAfterAction(pending);
    },
    onRollback: (pending) => chainSession?.handleRollbackPlace(pending),
  });
  forgedPlacement = createForgedItemPlacementController({
    gameState,
    chunks,
    getHit: getActionHit,
    getPlayerBounds,
    getPlayerYaw: () => player?.avatarYaw ?? player?.yaw ?? 0,
    getRenderer: () => renderer,
    ensureSelectedRuntime: () => avatarSession?.ensureSelectedForgedRuntime?.(),
    onStatus: setForgedPlacementStatus,
    onChanged: renderGameUi,
    placementReach: ACTION_PLAYER_REACH_BLOCKS,
  });
  debugControllerOptions = {
    elements,
    renderLog,
    canvas: elements.canvas,
    setStatus,
    parsePoseText,
    getPoseSnapshot: () => playerSession?.currentPoseSnapshot(),
    applyPoseSnapshot: (pose) => playerSession?.applyPoseSnapshot(pose),
    openBackpackPanel,
    openProfilePanel,
    openMarketPanel,
    openSmeltingPanel,
    openRpcPanel: () => chainSession?.openRpcPanel(),
    openSessionPanel: () => chainSession?.openSessionPanel(),
    onChainPdaCommand: handleChainPdaCommand,
    onChatMessage: sendGuardianChatMessage,
    getToolReachSphere: currentToolReachSphere,
    getBulkMining: () => bulkMining,
    translate: translateWithFallback,
    blockSizeMeters: BLOCK_SIZE_METERS,
    isMobileViewport,
    defaultViewDistance: viewDistance,
  };
  mobileChat = createMobileChatController({
    elements,
    submitText: submitMobileChatText,
    translate: translateWithFallback,
  });
  actionOverlayBuilder = createActionOverlayBuilder({
    getMining: () => mining,
    getPlacement: () => placement,
    getChunks: () => chunks,
    isDebugVisible: () => Boolean(debugController?.isDebugVisible?.()),
    isToolRangeVisible: () => Boolean(debugController?.isToolRangeVisible?.()),
    getLastHit: () => lastHit,
    getLastMiningHit: () => lastMiningHit,
    getLastMiningHitUntil: () => lastMiningHitUntil,
    getToolCollisionFrame: currentToolCollisionFrame,
    getToolReachSphere: currentToolReachSphere,
  });
  inputActions = createPlayInputActions({
    elements,
    gameState,
    getMining: () => mining,
    getPlacement: () => placement,
    getForgedPlacement: () => forgedPlacement,
    getBlueprint: () => blueprintActions,
    getBlueprintHit: () => lastHit,
    getBulkMining: () => bulkMining,
    getBulkMiningHit: () => lastHit,
    getControls: () => controls,
    getPlayer: () => player,
    getMotion: () => motion,
    getDebugController: () => debugController,
    openDebugCommandLine,
    getLastWorldDeltaKind: () => lastWorldDeltaKind,
    renderHotbar,
    closePanels,
    closeBackpackPanel,
    closeProfilePanel,
    toggleBackpackPanel,
    toggleProfilePanel,
    setFlightEnabled: (enabled) => playerSession?.setFlightEnabled(enabled),
    toggleFirstPersonCamera,
    setViewDistance,
    clampViewDistance: (value) => clampInt(value, 2, PLAYABLE_MAX_VIEW_DISTANCE),
    onCanvasAction: handleCanvasActionPointer,
  });
  positionPersistence = createPositionPersistence({
    storageKey: POSITION_STORAGE_KEY,
    seed: PLAYABLE_WORLD_SEED,
    saveIntervalMs: POSITION_SAVE_INTERVAL_MS,
    getSnapshot: () => playerSession?.currentPoseSnapshot(),
  });
  startupLogger.end(interfaceSetupToken);
  globalThis.NiceChunkLoading?.stage?.("engine", 0.68);
  startupLogger.step("UI and input event bindings", () => {
    inputActions.bind();
    blueprintUi.bind();
    inventory.bind();
    chainSession.bind();
    backpackCreation.bind();
    chainFrameSync.bind();
    minimap.bind();
    smelting.bind();
    market.bind();
    mobileChat.bind();
  });
  startupLogger.step("chain delta memory cache reset", () => chainChunkDeltas.clearLocalCache({ clearRenderDeltas: true }));
  startupLogger.track("chunk delta persistent cache warm", chainChunkDeltas.preloadPersistentCache({ reason: "startup-cache" }));
  startupLogger.track("player PDA initial refresh", chainPlayer.refresh({ force: true, quiet: true })).then((result) => {
    if (result?.ok) {
      avatarSession?.syncModelFromProfile();
      renderGameUi();
    }
  });
  startupLogger.track("backpack PDA initial refresh", chainBackpack.refresh({ force: true, quiet: true })).then((result) => {
    if (result?.ok) {
      chainPlayer?.applyEquipmentSnapshot?.();
      renderGameUi();
    }
  });
  startupLogger.step("initial game UI render", () => renderGameUi());
  if (params.get("debug") === "1") {
    const controller = await ensureDebugController();
    controller?.setDebugVisible?.(true);
  }
  playerSession?.updateFlightUi();
  playerSession?.bindPositionPersistence();
  playerSession?.savePlayerPosition(performance.now(), { force: true });
  fps.reset(performance.now());
  setStatus(`Running seed ${PLAYABLE_WORLD_SEED}. Canonical terrain + baked TextureArray + visual water/cloud/trees + low-cost 3D grass/flower detail layer. View distance ${viewDistance}, mesh budget ${meshBudgetMs}ms, workers ${chunks.workerCount}.`);
  globalThis.NiceChunkLoading?.taskStart?.("chunks");
  chainFrameSync.scheduleStartupChunkDeltaSync({
    onSync: (promise) => {
      if (promise) startupLogger.track("chunk PDA startup sync", promise);
      else globalThis.NiceChunkLoading?.taskDone?.("chunks");
    },
  });
  globalThis.NiceChunkLoading?.stage?.("chunks", 0.82);
  foundationSync.refresh({ force: true, quiet: true }).then(() => (
    buildingSync.refresh({ force: true, quiet: true })
  ));
  startupLogger.end(bootToken, {
    queuedChunks: chunks.chunks.size,
    workers: chunks.workerCount,
    note: "async chunk generation continues after boot",
  });
  startupLogger.mark("animation frame requested");
  requestAnimationFrame(frame);
}

function createVoxelItemIconCanvas(item, options = {}) {
  return createChunkVoxelItemIconCanvas(hydrateForgedPresentationSlot(item), {
    ...options,
    textureSeed: PLAYABLE_WORLD_SEED,
    textureTileSize: PLAYABLE_TEXTURE_TILE_SIZE,
  });
}

function appendGuardianEvent(message) {
  const text = String(message || "").trim();
  if (!text) return null;
  if (/^(guardian\b|remote appearance\b|remote avatar\b)/i.test(text)) {
    console.info("[NiceChunk Guardian]", text);
    return null;
  }
  return chainSession?.appendChainEvent?.(text) ?? null;
}

function beginFrameProbe(now) {
  return frameProbeLogger.begin(now);
}

function markFrameProbe(probe, label) {
  frameProbeLogger.mark(probe, label);
}

function endFrameProbe(probe) {
  frameProbeLogger.end(probe);
}

function frame(now) {
  const frameProbe = beginFrameProbe(now);
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0.016);
  frameProbe.dtMs = dt * 1000;
  lastFrame = now;
  if (elements.profilePanel && !elements.profilePanel.hidden) {
    chunks?.setBuildConcurrencyLimit?.(0);
    endFrameProbe(frameProbe);
    return;
  }
  controls.update(dt);
  markFrameProbe(frameProbe, "controls");
  chunks.setBuildConcurrencyLimit(renderBudget?.frameBuildConcurrencyLimit?.() ?? 0);
  markFrameProbe(frameProbe, "build-limit");
  applyPlayerPhysics(dt);
  markFrameProbe(frameProbe, "physics");
  mining?.update(now);
  playerSession?.savePlayerPosition(now);
  syncCameraToPlayer(dt);
  avatarSession?.syncAvatarToPlayer(now);
  markFrameProbe(frameProbe, "player-sync");
  const movingNow = isMotionActive();
  guardian?.update(now, dt);
  applyGuardianConnectionState(elements.guardianConnectionIndicator, guardian?.connectionState?.());
  markFrameProbe(frameProbe, "guardian");
  updateNameChatOverlayForFrame(now);
  markFrameProbe(frameProbe, "name-chat");
  chainFrameSync?.updateBackpackForFrame(now);
  markFrameProbe(frameProbe, "chain-backpack");
  chainFrameSync?.updatePlayerForFrame(now);
  markFrameProbe(frameProbe, "chain-player");
  chainFrameSync?.updateChunkDeltasForFrame(now, { moving: movingNow });
  markFrameProbe(frameProbe, "chain-deltas");
  foundationSync?.updateForFrame(now);
  markFrameProbe(frameProbe, "foundation-sync");
  buildingSync?.updateForFrame(now);
  markFrameProbe(frameProbe, "building-sync");
  updateChunkLoadingForFrame(now);
  markFrameProbe(frameProbe, "chunk-load");
  chunks.rebuildDirtyChunks(meshBudgetMs);
  markFrameProbe(frameProbe, "chunk-rebuild");
  pruneGpuChunksForFrame(now);
  markFrameProbe(frameProbe, "gpu-prune");
  const terrainVisibleChunks = chunks.getVisibleChunks(camera);
  const visibleBuildingChunks = buildingChunksInView();
  const visibleChunks = terrainVisibleChunks.concat(visibleBuildingChunks);
  renderBudget?.noteWorldVisible?.(terrainVisibleChunks.length > 0);
  if (terrainVisibleChunks.length) chunks.setContinuousBuildDispatch?.(true);
  if (terrainVisibleChunks.length) {
    const decorationSyncPromise = surfaceDecorationSync?.scheduleAfterWorldVisible?.();
    if (decorationSyncPromise) startupLogger.track("surface decoration PDA sync", decorationSyncPromise);
  }
  markFrameProbe(frameProbe, "visibility");
  const uploadChunks = renderBudget?.uploadCandidatesForFrame?.(now, visibleChunks, movingNow) ?? visibleChunks;
  // Region batching must only use the current render set. Merging the preload
  // ring can overwrite edge-region buffers and makes out-of-radius chunks flash.
  const uploadStats = renderer.prepareChunksForRender(uploadChunks, {
    maxUploads: renderBudget?.frameUploadBudget?.() ?? 1,
    deferRegionUploads: renderBudget?.shouldDeferRegionUploads?.(movingNow) ?? movingNow,
    cameraState: camera,
  });
  markFrameProbe(frameProbe, "gpu-upload");
  updateActionHitForFrame(now);
  markFrameProbe(frameProbe, "action-hit");
  buildingController?.activate?.();
  foundationController?.setHoverHit?.(lastHit);
  effects?.update(now, dt);
  markFrameProbe(frameProbe, "particles");
  frameAvatars.length = 0;
  const localAvatar = avatarSession?.avatar();
  if (localAvatar && !isFirstPersonCameraEnabled()) frameAvatars.push(localAvatar);
  guardian?.appendRemoteAvatars(frameAvatars);
  const forgedPlacementPreview = forgedPlacement?.previewEntity?.(lastHit);
  if (forgedPlacementPreview) frameAvatars.push(forgedPlacementPreview);
  const renderStats = renderer.render(camera, visibleChunks, frameAvatars, buildActionOverlays(lastHit, now));
  markFrameProbe(frameProbe, "render");
  blueprintUi?.update?.();
  markFrameProbe(frameProbe, "blueprint-ui");
  const sample = fps.frame(now, renderStats);
  if (sample) playHud?.update(sample, renderStats, uploadStats);
  markFrameProbe(frameProbe, "hud");
  minimap?.updateHeading?.();
  markFrameProbe(frameProbe, "minimap-heading");
  updateMinimapForFrame(now, { worldVisible: visibleChunks.length > 0 });
  markFrameProbe(frameProbe, "minimap-scheduled");
  startupLogger.noteFrame(now, { getWorldStats: () => chunks.stats(), renderStats, uploadStats });
  endFrameProbe(frameProbe);
}

function updateNameChatOverlayForFrame(now) {
  if (!nameChatOverlay) return;
  try {
    nameChatOverlay.update(now);
  } catch (error) {
    console.error("[NiceChunk Name Chat Overlay] Disabled after an update failure.", error);
    try {
      nameChatOverlay.dispose?.();
    } catch (disposeError) {
      console.error("[NiceChunk Name Chat Overlay] Cleanup failed.", disposeError);
    }
    nameChatOverlay = null;
  }
}

function handleCanvasActionPointer(event) {
  lastHit = actionHit?.handleCanvasPointer(event) ?? { hit: false };
  if (lastHit.hit) {
    dispatchEvent(new CustomEvent("nicechunk:onboarding-real-block-click", {
      detail: {
        hit: true,
        worldX: lastHit.worldX,
        worldY: lastHit.worldY,
        worldZ: lastHit.worldZ,
        blockId: lastHit.blockId,
      },
    }));
  }
  inputActions?.useSelectedHotbarAction();
}

function updateMinimapForFrame(now, { worldVisible = false } = {}) {
  if (firstMinimapUpdatePending && !worldVisible) return;
  if (!minimap || minimapUpdatePending || now - lastFrameMinimapAt < FRAME_MINIMAP_UPDATE_MS) return;
  lastFrameMinimapAt = now;
  minimapUpdatePending = true;
  globalThis.setTimeout(() => {
    minimapUpdatePending = false;
    const token = firstMinimapUpdatePending ? startupLogger.begin("first minimap render") : null;
    try {
      minimap?.update();
    } finally {
      if (token) {
        firstMinimapUpdatePending = false;
        startupLogger.end(token);
      }
    }
  }, 0);
}

function updateChunkLoadingForFrame(now, { force = false } = {}) {
  if (!chunks || !player || !camera) return;
  const [px, py, pz] = playerWorldFloat();
  const chunkSize = chunks.chunkSize || 16;
  const chunkX = Math.floor(px / chunkSize);
  const chunkZ = Math.floor(pz / chunkSize);
  const key = `${chunkX},${chunkZ}`;
  if (!renderBudget?.shouldUpdateChunkLoad?.(now, key, { force })) return;
  chunks.updatePlayerPosition(player.worldX, player.worldY, player.worldZ, cameraLoadDirection(camera));
}

function pruneGpuChunksForFrame(now, { force = false } = {}) {
  if (!renderBudget?.shouldPruneGpu?.(now, { force })) return;
  removeUnloadedGpuChunks();
}

function updateActionHitForFrame(now, { force = false } = {}) {
  const needsContinuousHit = Boolean(
    gameState.getSelectedPlaceableSlot?.()
    || gameState.isBlueprintSelected?.()
    || bulkMining?.isEnabled?.()
    || debugController?.isDebugVisible?.(),
  );
  if (!force && !needsContinuousHit) {
    lastHit = { hit: false };
    return lastHit;
  }
  lastHit = actionHit?.updateForFrame(now, { force }) ?? lastHit;
  return lastHit;
}

function getMiningActionHit() {
  const hit = actionHit?.getPointerActionHit?.() ?? { hit: false };
  lastHit = actionHit?.currentHit() ?? lastHit;
  return hit;
}

function getActionHit() {
  const hit = actionHit?.getActionHit() ?? { hit: false };
  lastHit = actionHit?.currentHit() ?? lastHit;
  return hit;
}

function renderGameUi() {
  refreshProfileSkillEffects();
  playUi?.renderGameUi();
  backpackCreation?.render();
  inventory?.refresh();
  if (smelting?.isOpen()) smelting.render();
  if (market?.isOpen()) market.render();
  avatarSession?.syncEquipment();
  blueprintUi?.render?.();
}

function refreshProfileSkillEffects() {
  const snapshot = chainSnapshot?.() ?? {};
  profileSkillEffects = createProfileSkillEffects({
    owner: snapshot.walletAddress || gameState.playerProfile?.name || "guest",
    profile: gameState.playerProfile,
    chainXp: snapshot.playerSkillXp || snapshot.skillXp || null,
  });
  if (controls) controls.speed = BASE_PLAYER_SPEED * (profileSkillEffects.movementSpeedMultiplier || 1);
  return profileSkillEffects;
}

function invalidateMiningChunks(pending) {
  const blocks = Array.isArray(pending?.blocks) && pending.blocks.length ? pending.blocks : [pending];
  const seen = new Set();
  const chunkSize = chunks?.chunkSize || 16;
  for (const block of blocks) {
    const x = Math.trunc(Number(block?.worldX ?? block?.x));
    const z = Math.trunc(Number(block?.worldZ ?? block?.z));
    if (![x, z].every(Number.isFinite)) continue;
    const key = `${Math.floor(x / chunkSize)},${Math.floor(z / chunkSize)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chainChunkDeltas?.invalidateChunkForWorld(x, z);
  }
}

function buildActionOverlays(hit, now = performance.now()) {
  return [
    ...(actionOverlayBuilder?.build(hit, now) ?? []),
    ...buildOnboardingWorldOverlays(now),
    ...(bulkMining?.overlays?.() ?? []),
    ...(forgedPlacement?.overlays?.(hit) ?? []),
    ...(foundationController?.overlays?.() ?? []),
  ];
}

function buildOnboardingWorldOverlays(now = performance.now()) {
  const target = onboardingHighlightedBlock;
  if (!target) return [];
  const wave = 0.5 + Math.sin(now * 0.0065) * 0.5;
  return [{
    worldX: target.worldX,
    worldY: target.worldY,
    worldZ: target.worldZ,
    expand: 0.016 + wave * 0.009,
    fillColor: [0.63, 1.0, 0.12, 0.09 + wave * 0.08],
    lineColor: [0.84, 1.0, 0.28, 0.62 + wave * 0.34],
  }];
}

function normalizeOnboardingBlock(block) {
  if (!block) return null;
  const worldX = Math.trunc(Number(block.worldX));
  const worldY = Math.trunc(Number(block.worldY));
  const worldZ = Math.trunc(Number(block.worldZ));
  const blockId = Math.trunc(Number(block.blockId));
  if (![worldX, worldY, worldZ, blockId].every(Number.isFinite) || blockId === BLOCK_ID.air) return null;
  return { worldX, worldY, worldZ, blockId };
}

function setForgedPlacementStatus(reason, preview = null) {
  const keyByReason = {
    loading: "main.forgedPlacement.loading",
    unavailable: "main.forgedPlacement.unavailable",
    "runtime-unavailable": "main.forgedPlacement.unavailable",
    "top-face-required": "main.forgedPlacement.topFaceRequired",
    "out-of-range": "main.forgedPlacement.outOfRange",
    "player-overlap": "main.forgedPlacement.playerOverlap",
    occupied: "main.forgedPlacement.occupied",
    selected: "main.forgedPlacement.selected",
  };
  setStatus(t(keyByReason[reason] ?? keyByReason.unavailable, {
    x: preview?.target?.worldX ?? 0,
    y: preview?.target?.worldY ?? 0,
    z: preview?.target?.worldZ ?? 0,
  }));
}

function renderHotbar() {
  playUi?.renderHotbar();
  avatarSession?.syncEquipment();
  debugController?.updateToolRangeHud?.();
  blueprintUi?.render?.({ force: true });
}

function renderProfile() {
  playUi?.renderProfile();
}

function discardBackpackSlots(indexes = [], { slots = [] } = {}) {
  const safeIndexes = Array.from(new Set((indexes ?? [])
    .map((index) => Number(index))
    .filter((index) => Number.isInteger(index) && index >= 0 && index < gameState.backpackSlots.length)))
    .sort((a, b) => a - b);
  if (!safeIndexes.length) return { ok: false, reason: "No backpack item selected." };
  const entries = safeIndexes.map((index, offset) => ({
    index,
    slot: slots[offset] || gameState.backpackSlots[index],
  })).filter((entry) => entry.slot);
  const equippedEntry = entries.find((entry) => gameState.isBackpackSlotEquipped?.(entry.slot));
  if (equippedEntry) {
    const equipment = gameState.getBackpackSlotEquipment?.(equippedEntry.slot);
    return {
      ok: false,
      reason: translateWithFallback(
        "main.backpack.equippedLocked",
        "Equipped in hotbar slot {slot}. Unequip it before selecting, moving, or discarding it.",
        { slot: (equipment?.index ?? 0) + 1 },
      ),
      code: "equipped-backpack-item",
    };
  }
  const chainEntries = entries.filter((entry) => isChainBackpackSlot(entry.slot));
  const localEntries = entries.filter((entry) => !isChainBackpackSlot(entry.slot));
  if (chainEntries.length && localEntries.length) {
    return { ok: false, reason: "Select chain and local backpack items separately before discarding." };
  }
  if (chainEntries.length) {
    if (!chainBackpack?.discardSlots) return { ok: false, reason: "chain-backpack-discard-unavailable" };
    return chainBackpack.discardSlots(chainEntries.map((entry) => entry.slot), { quiet: false }).then((result) => {
      if (result?.ok) {
        renderGameUi();
        chainSession?.render?.();
      }
      return result;
    });
  }
  const result = gameState.discardBackpackSlots(safeIndexes);
  if (result.ok) {
    renderGameUi();
    chainSession?.appendChainEvent?.(`Discarded ${result.discarded.length} local backpack stack${result.discarded.length === 1 ? "" : "s"}.`);
  }
  return { ...result, count: result.discarded?.length || 0 };
}

function isChainBackpackSlot(slot) {
  return Boolean(slot?.source === "chain" && slot.chainBackpack && Number.isInteger(slot.chainIndex));
}

function chainSnapshot() {
  const session = chainSession?.snapshot() ?? null;
  if (!session) return null;
  const playerSnapshot = chainPlayer?.snapshot?.() ?? null;
  return {
    ...session,
    chainBackpack: chainBackpack?.snapshot?.() ?? null,
    chainChunkDeltas: chainChunkDeltas?.snapshot?.() ?? null,
    chainPlayer: playerSnapshot,
    playerSkillXp: playerSnapshot?.skillXp ?? null,
    guardian: guardian?.snapshot?.() ?? null,
  };
}

function readableError(error) {
  const message = String(error?.message || error || "unknown error");
  return message.length > 160 ? `${message.slice(0, 157)}...` : message;
}

function handleChainPdaCommand(mode = "toggle") {
  const normalized = String(mode || "toggle").trim().toLowerCase();
  if (normalized === "clear") {
    chainChunkDeltas?.clearLocalCache({ clearRenderDeltas: true, clearPersistent: true });
    chainChunkDeltas?.requestSync({ force: true, reason: "pda-clear", quiet: false });
    return { enabled: isChainChunkPdaReadEnabled(), message: "Chunk PDA cache cleared. Async chain delta sync restarted." };
  }
  const current = isChainChunkPdaReadEnabled();
  const next = normalized === "on" || normalized === "enable" || normalized === "enabled"
    ? true
    : normalized === "off" || normalized === "disable" || normalized === "disabled"
      ? false
      : !current;
  const enabled = setChainChunkPdaReadEnabled(next);
  chainChunkDeltas?.clearLocalCache({ clearRenderDeltas: !enabled });
  if (enabled) chainChunkDeltas?.requestSync({ force: true, reason: "pda-enabled", quiet: false });
  renderGameUi();
  return {
    enabled,
    message: enabled
      ? "Chunk PDA reads enabled. Loaded chunks will sync broken-block deltas asynchronously."
      : "Chunk PDA reads disabled. Chain broken-block deltas are hidden until /pda on.",
  };
}

function sendGuardianChatMessage(message) {
  const text = normalizeChatMessage(message);
  if (!text) return false;
  const sent = guardian?.sendChat?.(text) ?? false;
  if (sent) {
    chainSession?.appendChainEvent?.(`You: ${text}`);
    nameChatOverlay?.showLocalChat?.(text);
  }
  return sent;
}

async function submitMobileChatText(message) {
  const text = normalizeChatMessage(message);
  if (!text) return false;
  if (!text.startsWith("/")) return sendGuardianChatMessage(text);
  const controller = await ensureDebugController();
  if (!controller) {
    return {
      ok: false,
      errorKey: "main.chat.debugUnavailable",
      fallback: "Debug commands are unavailable in this client.",
    };
  }
  controller.runCommand?.(text);
  return true;
}

function openDebugCommandLine(initialValue = "/") {
  ensureDebugController().then((controller) => controller?.openCommandLine?.(initialValue));
}

async function ensureDebugController() {
  if (debugController) return debugController;
  if (!debugControllerOptions) return null;
  if (!debugControllerPromise) {
    debugControllerPromise = import("./play-debug-controller.js")
      .then((module) => {
        if (typeof module.createPlayDebugController !== "function") return null;
        debugController = module.createPlayDebugController(debugControllerOptions);
        debugController.bind?.();
        return debugController;
      })
      .catch((error) => {
        console.warn("NiceChunk optional debug module is unavailable:", error);
        return null;
      });
  }
  return debugControllerPromise;
}

function localOverlayTarget() {
  if (!player || isFirstPersonCameraEnabled()) return null;
  const [x, y, z] = playerWorldFloat();
  return { id: "local", x, y, z, heightBlocks: AVATAR_HEIGHT_BLOCKS };
}

function toggleBackpackPanel() {
  if (!gameState.isBackpackAvailable()) {
    backpackCreation?.open({ source: "backpack" });
    return;
  }
  playUi?.toggleBackpackPanel();
}

function openBackpackPanel() {
  if (!gameState.isBackpackAvailable()) {
    backpackCreation?.open({ source: "backpack" });
    return;
  }
  playUi?.openBackpackPanel();
  inventory?.refresh();
  chainBackpack?.refresh({ quiet: false }).then((result) => {
    if (result?.ok) renderGameUi();
  });
}

function chainBackpackAnimationTarget() {
  if (!gameState.isBackpackAvailable()) return null;
  if (elements.backpackPanel && !elements.backpackPanel.hidden) {
    const headingTarget = elements.backpackPanel.querySelector(".backpack-heading-icon");
    if (headingTarget) return headingTarget;
  }
  const backpackIndex = gameState.hotbarSlots.findIndex((slot) => slot?.itemId === "backpack");
  return backpackIndex >= 0
    ? elements.hotbar?.querySelector(`[data-slot="${backpackIndex}"]`) ?? null
    : null;
}

function refreshPdaBackpackAfterAction(pending) {
  if (!pending?.chainSubmitted) return;
  const chainResult = pending.chainResult ?? {};
  const previousCount = Number(chainResult.backpackPreviousItemCount);
  const storedRewardCount = Number(chainResult.storedRewardCount);
  const lossyRewards = Boolean(chainResult.lossyRewards);
  const minimumItemCount = pending.miningKind && Number.isFinite(previousCount)
    ? previousCount + (lossyRewards && Number.isFinite(storedRewardCount) ? Math.max(0, storedRewardCount) : 1)
    : null;
  const expectsBackpackMutation = !lossyRewards || !Number.isFinite(storedRewardCount) || storedRewardCount > 0;
  const refresh = pending.miningKind && expectsBackpackMutation
    && chainResult.backpackPreviousUpdatedSlot !== undefined && chainBackpack?.refreshAfterMutation
    ? chainBackpack.refreshAfterMutation({
        previousUpdatedSlot: chainResult.backpackPreviousUpdatedSlot,
        minimumItemCount,
      })
    : chainBackpack?.refresh({ force: true, quiet: true });
  refresh?.then((result) => {
    if (result?.ok) renderGameUi();
  });
}

function closeBackpackPanel() {
  playUi?.closeBackpackPanel();
}

function toggleProfilePanel() {
  playUi?.toggleProfilePanel();
}

function openProfilePanel() {
  playUi?.openProfilePanel();
}

function closeProfilePanel() {
  playUi?.closeProfilePanel();
}

function closePanels() {
  inventory?.closeContextMenu();
  playUi?.closePanels();
  smelting?.closePanel();
  market?.closePanel();
  chainSession?.closeDialogs();
  minimap?.closeLargeMap();
}

function openMarketPanel() {
  market?.openPanel();
}

function openSmeltingPanel() {
  smelting?.openPanel();
}

function requestChainPlayerPositionSaveForResourceMine(pending) {
  if (!mineShouldSavePlayerPosition(pending)) return null;
  if (pending.chainAction !== "mine" || !pending.chainSubmitted) return null;
  if (pending.chainPlayerPositionSaved) return null;
  const savedAtImpact = playerSession?.normalizePlayerChainPosition(pending.playerChainPosition);
  return requestChainPlayerPositionSave({
    force: true,
    quiet: true,
    reason: "resource-mine-confirm",
    minedBlock: minedBlockProofFromPending(pending),
  }, savedAtImpact);
}

function minedBlockProofFromPending(pending) {
  if (!pending) return null;
  return {
    x: Math.trunc(Number(pending.worldX)),
    y: Math.trunc(Number(pending.worldY)),
    z: Math.trunc(Number(pending.worldZ)),
    blockId: Math.trunc(Number(pending.blockId)),
    resourceId: Math.trunc(Number(pending.resourceId ?? 0)),
  };
}

function requestChainPlayerPositionSave(options = {}, positionOverride = null) {
  if (!chainPlayer || !player) return null;
  const position = playerSession?.normalizePlayerChainPosition(positionOverride) || playerSession?.currentPlayerChainPosition();
  if (!position) return null;
  const result = chainPlayer.requestPositionSave(position, options);
  if (result?.then) {
    result.then((saveResult) => {
      if (saveResult?.submitted || saveResult?.ok) renderGameUi();
    });
  }
  return result;
}

function currentAvatarEquipment() {
  return avatarSession?.selectedEquipment() ?? { rightHand: "empty" };
}

function currentToolCollisionFrame(args = {}) {
  return avatarSession?.toolCollisionFrame(args) ?? { boxes: [] };
}

function currentToolReachSphere(args = {}) {
  return avatarSession?.toolReachSphere(args) ?? null;
}

function currentToolTargetingSolution(args = {}) {
  return avatarSession?.toolTargetingSolution(args) ?? { reachable: false, reason: "tool-collision-unavailable" };
}

function setViewDistance(nextValue) {
  const next = clampInt(nextValue, 2, PLAYABLE_MAX_VIEW_DISTANCE);
  chunks.maxQueuedBuilds = renderBudget?.maxBuildQueueForViewDistance?.(next) ?? chunks.maxQueuedBuilds;
  chunks.setViewDistance(next, { preloadMargin: PLAYABLE_PRELOAD_MARGIN });
  renderer.options.viewDistance = next;
  camera.far = viewFarPlane(next);
  minimap?.invalidate?.();
  chunks.unloadFarChunks(chunks.centerChunkX, chunks.centerChunkZ);
  removeUnloadedGpuChunks();
  chainChunkDeltas?.requestSync({ force: true, reason: "view-distance", quiet: false });
  if (elements.viewRangeInput) elements.viewRangeInput.value = String(next);
  playHud?.updateViewRangeLabel(next);
  setStatus(`Render range set to ${next} chunks. Dirty chunks rebuild within ${meshBudgetMs}ms/frame.`);
}

function isMotionActive() {
  return motion?.isMotionActive() ?? false;
}

function applyPlayerPhysics(dt) {
  motion?.applyPlayerPhysics(dt);
}

function syncCameraToPlayer(dt = 1 / 60, options = {}) {
  motion?.syncCameraToPlayer(dt, options);
}

function toggleFirstPersonCamera() {
  const enabled = motion?.toggleFirstPersonCamera?.() ?? false;
  controls?.setFirstPersonEnabled?.(enabled, { requestPointerLock: enabled });
  document.body.classList.toggle("first-person-camera", enabled);
  syncCameraToPlayer(1 / 60, { force: true });
  updateActionHitForFrame(performance.now(), { force: true });
  return enabled;
}

function isFirstPersonCameraEnabled() {
  return motion?.isFirstPersonCameraEnabled?.() ?? false;
}

function playerWorldFloat() {
  return motion?.playerWorldFloat() ?? [0, 0, 0];
}

function getPlayerBounds() {
  const [x, y, z] = playerWorldFloat();
  return { x, y, z, radius: PLAYER_RADIUS, height: PLAYER_BODY_HEIGHT };
}

function setPlayerWorldFloat(x, y, z) {
  motion?.setPlayerWorldFloat(x, y, z);
}

function resolvePlayerPenetration() {
  return motion?.resolvePlayerPenetration() ?? false;
}

function reconcilePlayerAfterBuildingCollisionChange() {
  const result = motion?.liftPlayerOutOfCollision?.({
    maxRise: Math.max(64, Number(chunks?.height) || 0),
  });
  if (!result?.moved) return result;
  const now = performance.now();
  syncCameraToPlayer(1 / 60, { force: true });
  avatarSession?.syncAvatarToPlayer?.(now);
  playerSession?.savePlayerPosition?.(now, { force: true });
  console.info("[NiceChunk Building Collision] Lifted player onto loaded building surface.", {
    fromY: result.fromY,
    toY: result.toY,
    rise: result.rise,
  });
  return result;
}

function viewFarPlane(distance) {
  return Math.max(460, Math.trunc(distance) * 48 + 160);
}

function removeUnloadedGpuChunks() {
  const buildingIds = buildingController?.liveChunkIds?.() ?? new Set();
  const liveIds = new Set(chunks.chunks.keys());
  for (const id of buildingIds) liveIds.add(id);
  renderer.pruneChunks(liveIds);
  const ids = new Set([...renderer.chunkBuffers.keys(), ...renderer.visualChunkBuffers.keys()]);
  for (const id of ids) {
    if (!liveIds.has(id)) renderer.removeChunk(id);
  }
}

function buildingChunksInView() {
  const [worldX, , worldZ] = playerWorldFloat();
  const size = Math.max(1, Math.trunc(chunks?.chunkSize || 16));
  const centerX = Math.floor(worldX / size);
  const centerZ = Math.floor(worldZ / size);
  if (typeof buildingController?.renderChunksInRange === "function") {
    return buildingController.renderChunksInRange(centerX, centerZ, viewDistance);
  }
  const buildingChunks = buildingController?.renderChunks?.() ?? [];
  if (!buildingChunks.length) return buildingChunks;
  return buildingChunks.filter((chunk) => Math.max(
    Math.abs(chunk.chunkX - centerX),
    Math.abs(chunk.chunkZ - centerZ),
  ) <= viewDistance);
}

function rememberMiningHit(hit, ttlMs = 1600) {
  lastMiningHit = { ...hit };
  lastMiningHitUntil = performance.now() + Math.max(200, Number(ttlMs) || 1600);
}

function forgetMiningHit(block = null) {
  if (block && lastMiningHit) {
    if (Math.trunc(Number(block.worldX)) !== Math.trunc(Number(lastMiningHit.worldX))
      || Math.trunc(Number(block.worldY)) !== Math.trunc(Number(lastMiningHit.worldY))
      || Math.trunc(Number(block.worldZ)) !== Math.trunc(Number(lastMiningHit.worldZ))) return;
  }
  lastMiningHit = null;
  lastMiningHitUntil = 0;
}

function normalizeChatMessage(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function isMobileViewport() {
  return globalThis.matchMedia?.("(pointer: coarse)")?.matches || Math.min(globalThis.innerWidth || 0, globalThis.innerHeight || 0) <= 720;
}

function translateWithFallback(key, fallback, params = {}) {
  const translated = t(key, params);
  return translated && translated !== key ? translated : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.trunc(Number(value) || min)));
}

function metersToBlocks(value) {
  return Number(value) / BLOCK_SIZE_METERS;
}

function cameraLoadDirection(cameraState) {
  const forward = cameraForward(cameraState);
  return {
    directionX: forward[0],
    directionZ: forward[2],
  };
}

function minimapCameraHeading() {
  if (!camera) return 0;
  const forward = cameraForward(camera);
  if (!Array.isArray(forward) || Math.hypot(forward[0], forward[2]) < 0.000001) return 0;
  // The map marker starts toward -Z, matching the avatar/model yaw convention.
  return Math.atan2(-forward[0], -forward[2]);
}
