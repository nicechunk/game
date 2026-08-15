import { loadPlayChainModule } from "./play-chain-adapter.js";
import {
  smeltingMaterialById,
  smeltingMaterialIdForItemCode,
} from "../src/data/smeltingRules.js";
import { marketCategoryForBackpackSlot } from "../src/market/marketCategories.js";
import { resourceIdForBlock } from "../src/world/blocks.js";
import { buildBackpackDisplayStacks } from "./backpack-display-stacks.js";
import { formatMassGrams, formatVolumeCm3 } from "./play-ui-format.js";
import { createLandContractIconElement } from "./play-land-contract-item.js";

const MARKET_RULE_SET = "nicechunk-play-market-v1";
const MARKET_CATEGORIES = Object.freeze(["all", "contracts", "raw", "building", "equipment", "clothing"]);
const MARKET_LISTING_CATEGORIES = Object.freeze(["raw", "building", "equipment", "clothing"]);
const MARKET_SORTS = Object.freeze(["newest", "oldest", "price-asc", "price-desc"]);
const MARKET_CURRENCIES = Object.freeze(["all", "NCK", "SOL"]);
const TREASURY_LAND_CONTRACT_ID = "treasury-blank-land-contract";
const LAND_CONTRACT_UNIT_PRICE_NCK = 1;
const LAND_CONTRACT_PURCHASE_MAX = 4_096;
const PAGE_SIZE = 8;
const CHAIN_REFRESH_COOLDOWN_MS = 12_000;
const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function createPlayMarket({
  elements,
  gameState,
  createVoxelItemIconCanvas,
  resourceName,
  voxelItemLabel,
  getChainSnapshot = () => null,
  refreshChainInventory = () => Promise.resolve(null),
  loadChainModule = loadPlayChainModule,
  translate = fallbackUi,
  onEnterMarket = () => {},
  onReturnToBackpack = () => {},
  onStatus = () => {},
  onChanged = () => {},
} = {}) {
  const ui = (key, fallback, params = {}) => translate(key, fallback, params);
  const state = {
    chainListings: [],
    chainLoading: false,
    chainError: "",
    lastChainRefreshAt: 0,
    activeTab: "browse",
    selectedCategory: "all",
    selectedSort: "newest",
    selectedCurrency: "all",
    selectedItemId: "",
    selectedListingId: "",
    contractQuantity: 1,
    returnToBackpack: false,
    mobileView: "listings",
    membershipStatus: "idle",
    membershipWallet: "",
    membership: null,
    membershipEstimate: null,
    membershipError: "",
    operation: null,
    page: { browse: 1, orders: 1 },
  };
  let tradeToastTimer = 0;
  let membershipRequestId = 0;
  let chainRequestId = 0;

  const api = {
    bind() {
      elements.marketButton?.addEventListener("click", api.togglePanel);
      elements.closeMarket?.addEventListener("click", () => api.closePanel({ restoreBackpack: true }));
      elements.marketMyListings?.addEventListener("click", () => selectTab("orders"));
      elements.marketViewOrders?.addEventListener("click", () => selectTab("orders"));
      elements.marketRefresh?.addEventListener("click", () => {
        api.refreshChainListings({ force: true, quiet: false });
        showMarketStatus(ui("main.market.chainListingsSyncing", "Syncing chain listings..."));
        render();
      });
      elements.marketSearch?.addEventListener("input", () => resetAndRender());
      elements.marketSort?.addEventListener("change", () => {
        state.selectedSort = MARKET_SORTS.includes(elements.marketSort.value) ? elements.marketSort.value : "newest";
        resetAndRender();
      });
      elements.marketCurrencyFilter?.addEventListener("change", () => {
        state.selectedCurrency = MARKET_CURRENCIES.includes(elements.marketCurrencyFilter.value) ? elements.marketCurrencyFilter.value : "all";
        resetAndRender();
      });
      elements.marketTabs?.forEach((button) => button.addEventListener("click", () => selectTab(button.dataset.marketTab || "browse")));
      elements.marketMobileViewTabs?.forEach((button) => button.addEventListener("click", () => {
        selectMobileView(button.dataset.marketMobileView || "listings");
      }));
      elements.marketCategoryButtons?.forEach((button) => button.addEventListener("click", () => {
        state.selectedCategory = MARKET_CATEGORIES.includes(button.dataset.marketCategory) ? button.dataset.marketCategory : "all";
        resetAndRender();
      }));
      elements.marketInventoryGrid?.addEventListener("click", handleInventoryClick);
      elements.marketListingGrid?.addEventListener("click", handleListingAction);
      elements.marketOrdersGrid?.addEventListener("click", handleListingAction);
      elements.marketActiveOrdersGrid?.addEventListener("click", handleListingAction);
      elements.marketListingDetail?.addEventListener("click", handleListingAction);
      elements.marketListingForm?.addEventListener("submit", createListing);
      elements.marketListingPrice?.addEventListener("input", renderDraft);
      elements.marketListingCategory?.addEventListener("change", renderDraft);
      elements.marketListingCurrency?.addEventListener("change", () => {
        syncListingPriceInput();
        renderDraft();
      });
      elements.marketMembershipSubmit?.addEventListener("click", handleMembershipSubmit);
    },
    render,
    refreshChainListings,
    refreshMarketMembership,
    refreshLandContracts,
    getLandContractSnapshot,
    openContracts,
    openPanel,
    closePanel,
    togglePanel,
    isOpen: () => Boolean(elements.marketPanel && !elements.marketPanel.hidden),
  };

  function togglePanel() {
    if (api.isOpen()) closePanel({ restoreBackpack: true });
    else openPanel();
  }

  function openPanel() {
    if (!elements.marketPanel) return;
    state.returnToBackpack = Boolean(elements.backpackPanel && !elements.backpackPanel.hidden);
    if (state.returnToBackpack) onEnterMarket();
    state.mobileView = "listings";
    elements.marketPanel.hidden = false;
    elements.marketPanel.dataset.activeMarketTab = state.activeTab;
    const wallet = currentWalletAddress();
    if (state.membershipStatus === "joined" && state.membershipWallet === wallet) {
      refreshChainListings({ quiet: true });
    } else {
      state.membershipStatus = "checking";
      state.membershipError = "";
      state.membershipEstimate = null;
      void refreshMarketMembership({ loadMarket: true });
    }
    render();
    onStatus(ui("main.market.opened", "Market opened. Chain listings use PDA state when wallet and RPC are available."));
  }

  function openContracts() {
    state.activeTab = "browse";
    state.selectedCategory = "contracts";
    state.selectedCurrency = "NCK";
    state.selectedListingId = TREASURY_LAND_CONTRACT_ID;
    state.page.browse = 1;
    openPanel();
    render();
  }

  function closePanel({ restoreBackpack = false } = {}) {
    const shouldRestore = restoreBackpack && state.returnToBackpack;
    if (elements.marketPanel) elements.marketPanel.hidden = true;
    state.returnToBackpack = false;
    if (shouldRestore) onReturnToBackpack();
  }

  function selectTab(tabName) {
    state.activeTab = ["browse", "sell", "orders"].includes(tabName) ? tabName : "browse";
    state.mobileView = state.activeTab === "sell" && !state.selectedItemId ? "inventory" : "listings";
    if (elements.marketPanel) elements.marketPanel.dataset.activeMarketTab = state.activeTab;
    render();
  }

  function selectMobileView(viewName) {
    state.mobileView = viewName === "inventory" ? "inventory" : "listings";
    render();
  }

  function resetAndRender() {
    state.page.browse = 1;
    state.page.orders = 1;
    render();
  }

  function render() {
    if (!elements.marketPanel) return;
    syncHeader();
    syncTabs();
    syncMobileView();
    syncFilters();
    renderMembership();
    renderBrowse();
    renderInventory();
    renderOrders();
    renderActiveOrders();
    renderDraft();
    renderListingDetail();
  }

  function syncHeader() {
    const chain = getChainSnapshot?.() || {};
    if (elements.marketWallet) elements.marketWallet.textContent = chain.walletShort || ui("main.market.localWallet", "Local wallet");
    const capacity = Math.max(1, Math.trunc(Number(gameState.backpackCapacity) || 50));
    const count = buildBackpackDisplayStacks(gameState.backpackSlots).length;
    if (elements.marketBackpack) elements.marketBackpack.textContent = ui("main.market.backpackCount", "{count}/{capacity}", { count, capacity });
    if (elements.marketInventoryCount) elements.marketInventoryCount.textContent = ui("main.market.backpackCount", "{count}/{capacity}", { count, capacity });
    if (elements.marketRefresh) {
      elements.marketRefresh.disabled = state.chainLoading
        || Boolean(state.operation)
        || state.membershipStatus !== "joined";
    }
    elements.marketPanel?.setAttribute("aria-busy", state.operation ? "true" : "false");
  }

  function syncTabs() {
    const membershipBlocked = state.membershipStatus !== "joined";
    elements.marketTabs?.forEach((button) => {
      const active = button.dataset.marketTab === state.activeTab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.disabled = membershipBlocked || Boolean(state.operation);
    });
    elements.marketTabPanels?.forEach((panel) => {
      const active = panel.dataset.marketTabPanel === state.activeTab;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    if (elements.marketPanel) elements.marketPanel.dataset.activeMarketTab = state.activeTab;
  }

  function syncMobileView() {
    if (elements.marketBody) elements.marketBody.dataset.mobileMarketView = state.mobileView;
    elements.marketMobileViewTabs?.forEach((button) => {
      const active = button.dataset.marketMobileView === state.mobileView;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function syncFilters() {
    if (elements.marketSort) elements.marketSort.value = state.selectedSort;
    if (elements.marketCurrencyFilter) elements.marketCurrencyFilter.value = state.selectedCurrency;
    elements.marketCategoryButtons?.forEach((button) => button.classList.toggle("active", button.dataset.marketCategory === state.selectedCategory));
  }

  function renderMembership() {
    if (!elements.marketMembership) return;
    const visible = state.membershipStatus !== "idle" && state.membershipStatus !== "joined";
    elements.marketMembership.hidden = !visible;
    elements.marketMembership.dataset.state = state.membershipStatus;
    if (elements.marketBody) elements.marketBody.inert = visible;
    if (!visible) return;

    if (elements.marketMembershipEyebrow) {
      elements.marketMembershipEyebrow.textContent = ui("main.market.membershipEyebrow", "On-chain access");
    }
    if (elements.marketMembershipTitle) {
      elements.marketMembershipTitle.textContent = ui("main.market.joinTitle", "Join the market");
    }
    if (elements.marketMembershipBody) {
      elements.marketMembershipBody.textContent = ui("main.market.joinBody", "Create your personal market membership PDA before trading.");
    }

    const estimate = state.membershipEstimate;
    setMembershipCost(elements.marketMembershipUserRent, formatEstimatedSol(estimate?.userStateRentSol));
    setMembershipCost(elements.marketMembershipNetworkFee, formatEstimatedSol(estimate?.networkFeeSol));
    setMembershipCost(elements.marketMembershipTotal, estimate?.totalSol == null && estimate
      ? ui("main.market.totalPlusNetworkFee", "{amount} SOL + network fee", { amount: formatSolNumber(estimate.storageRentSol) })
      : formatEstimatedSol(estimate?.totalSol));

    if (elements.marketMembershipCapacity) {
      elements.marketMembershipCapacity.textContent = ui("main.market.joinCapacity", "Each wallet may keep up to 50 active listings.");
    }
    if (elements.marketMembershipState) {
      elements.marketMembershipState.textContent = membershipStatusMessage();
    }
    if (elements.marketMembershipSubmit) {
      const pending = state.membershipStatus === "checking" || state.membershipStatus === "submitting";
      elements.marketMembershipSubmit.disabled = pending || Boolean(state.operation);
      elements.marketMembershipSubmit.classList.toggle("is-pending", state.membershipStatus === "submitting");
      elements.marketMembershipSubmit.setAttribute("aria-busy", pending ? "true" : "false");
      elements.marketMembershipSubmit.textContent = state.membershipStatus === "submitting"
        ? ui("main.market.membershipSubmitting", "Waiting for confirmation...")
        : state.membershipStatus === "error"
          ? ui("main.market.retryMembership", "Retry cost estimate")
          : ui("main.market.joinAction", "Join market");
    }
  }

  function membershipStatusMessage() {
    if (state.membershipStatus === "checking") {
      return ui("main.market.membershipChecking", "Reading market membership and live RPC costs...");
    }
    if (state.membershipStatus === "submitting") {
      return ui("main.market.membershipSubmitting", "Waiting for confirmation...");
    }
    if (state.membershipError) return state.membershipError;
    return ui("main.market.joinReady", "Review the live estimate, then approve market access in your wallet.");
  }

  function setMembershipCost(element, value) {
    if (element) element.textContent = value || ui("main.market.costPending", "Checking RPC...");
  }

  function formatEstimatedSol(value) {
    return Number.isFinite(Number(value))
      ? `${formatSolNumber(value)} SOL`
      : "";
  }

  function formatSolNumber(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "0";
    return amount.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 9 });
  }

  async function refreshMarketMembership({ loadMarket = false } = {}) {
    const wallet = currentWalletAddress();
    const requestId = ++membershipRequestId;
    state.membershipWallet = wallet;
    state.membershipStatus = "checking";
    state.membershipError = "";
    state.membershipEstimate = null;
    render();
    if (!wallet) {
      state.membership = null;
      state.membershipStatus = "error";
      state.membershipError = ui("main.market.membershipWalletRequired", "Connect your game wallet before joining the market.");
      render();
      onChanged();
      return { ok: false, reason: "wallet-unavailable" };
    }
    try {
      const module = await loadChainModule();
      if (typeof module.fetchMarketUserStateOnChain !== "function"
        || typeof module.estimateMarketJoinCostOnChain !== "function") {
        throw new Error(ui("main.market.membershipUnavailable", "Market membership is unavailable in this client."));
      }
      const membership = await module.fetchMarketUserStateOnChain(wallet);
      if (requestId !== membershipRequestId || wallet !== currentWalletAddress()) return { ok: false, reason: "stale" };
      if (membership) {
        state.membership = membership;
        state.membershipStatus = "joined";
        state.membershipEstimate = null;
        state.membershipError = "";
        render();
        onChanged();
        if (loadMarket && api.isOpen()) loadMarketForActiveTab();
        return { ok: true, joined: true, membership };
      }
      const estimate = await module.estimateMarketJoinCostOnChain({ owner: wallet });
      if (requestId !== membershipRequestId || wallet !== currentWalletAddress()) return { ok: false, reason: "stale" };
      if (!estimate?.available) throw new Error(marketSubmissionReason(estimate?.reason, ui));
      state.membership = null;
      state.membershipEstimate = estimate;
      state.membershipStatus = "required";
      render();
      onChanged();
      return { ok: true, joined: false, estimate };
    } catch (error) {
      if (requestId !== membershipRequestId || wallet !== currentWalletAddress()) {
        return { ok: false, reason: "stale" };
      }
      state.membershipStatus = "error";
      state.membership = null;
      state.membershipError = ui("main.market.membershipCheckFailed", "Could not check market access: {reason}", {
        reason: readableError(error),
      });
      render();
      onChanged();
      return { ok: false, reason: state.membershipError };
    }
  }

  async function handleMembershipSubmit() {
    if (state.membershipStatus === "checking" || state.membershipStatus === "submitting") return;
    if (state.membershipStatus === "error") {
      await refreshMarketMembership({ loadMarket: true });
      return;
    }
    if (!beginMarketOperation(
      "membership",
      "join",
      ui("main.market.joinPending", "Confirm market membership in your wallet."),
    )) return;
    state.membershipStatus = "submitting";
    render();
    try {
      const module = await loadChainModule();
      const submit = module.joinMarketOnChain;
      if (typeof submit !== "function") throw new Error(ui("main.market.membershipUnavailable", "Market membership is unavailable in this client."));
      const result = await submit();
      if (!result?.submitted && result?.reason !== "market-already-joined") {
        throw new Error(marketSubmissionReason(result?.reason, ui));
      }
      const success = result?.reason === "market-already-joined"
        ? ui("main.market.alreadyJoined", "This wallet has already joined the market.")
        : ui("main.market.joinCreated", "Market access created on-chain: {signature}", { signature: shortSignature(result?.signature) });
      showTradeToast(success, "success");
      state.membershipStatus = "checking";
      await refreshMarketMembership({ loadMarket: true });
    } catch (error) {
      state.membershipStatus = "required";
      state.membershipError = readableError(error);
      showTradeToast(state.membershipError, "error");
      render();
    } finally {
      finishMarketOperation("membership", "join");
    }
  }

  function loadMarketForActiveTab() {
    refreshChainListings({ force: true, quiet: true });
  }

  function currentWalletAddress() {
    return String(getChainSnapshot?.()?.walletAddress || "");
  }

  function getLandContractSnapshot() {
    const wallet = currentWalletAddress();
    const membership = state.membershipStatus === "joined" && state.membershipWallet === wallet
      ? state.membership
      : null;
    const balance = Number(membership?.blankLandContracts);
    const reserved = Number(membership?.reservedBlankLandContracts);
    return Object.freeze({
      status: state.membershipStatus,
      wallet,
      blankLandContracts: Number.isSafeInteger(balance) && balance >= 0 ? balance : null,
      reservedBlankLandContracts: Number.isSafeInteger(reserved) && reserved >= 0 ? reserved : null,
      marketUser: String(membership?.marketUser || ""),
    });
  }

  async function refreshLandContracts({ quiet = true } = {}) {
    const wallet = currentWalletAddress();
    const requestId = ++membershipRequestId;
    if (!wallet) return { ok: false, reason: "wallet-unavailable", ...getLandContractSnapshot() };
    try {
      const module = await loadChainModule();
      if (typeof module.fetchMarketUserStateOnChain !== "function") {
        return { ok: false, reason: "market-membership-unavailable", ...getLandContractSnapshot() };
      }
      const membership = await module.fetchMarketUserStateOnChain(wallet);
      if (requestId !== membershipRequestId || wallet !== currentWalletAddress()) {
        return { ok: false, reason: "stale" };
      }
      state.membershipWallet = wallet;
      state.membership = membership;
      state.membershipStatus = membership ? "joined" : "required";
      state.membershipError = "";
      render();
      const snapshot = getLandContractSnapshot();
      onChanged();
      return { ok: Boolean(membership), reason: membership ? "" : "market-membership-required", ...snapshot };
    } catch (error) {
      if (requestId !== membershipRequestId || wallet !== currentWalletAddress()) {
        return { ok: false, reason: "stale" };
      }
      const reason = readableError(error);
      if (!quiet) showTradeToast(ui("main.market.contractBalanceFailed", "Could not refresh land contracts: {reason}", { reason }), "error");
      return { ok: false, reason, ...getLandContractSnapshot() };
    }
  }

  function ensureMarketMembership() {
    const wallet = currentWalletAddress();
    if (state.membershipStatus === "joined" && state.membershipWallet === wallet && wallet) return true;
    showTradeToast(ui("main.market.joinRequired", "Join the market before creating or settling listings."), "warn");
    if (state.membershipStatus !== "checking" && state.membershipStatus !== "submitting") {
      void refreshMarketMembership({ loadMarket: false });
    }
    return false;
  }

  function handleMarketAccessReason(reason) {
    if (reason === "market-membership-required") {
      void refreshMarketMembership({ loadMarket: false });
      return true;
    }
    return false;
  }

  function renderBrowse() {
    if (!elements.marketListingGrid) return;
    const availableListings = browseListings();
    const listings = paginate(sortListings(filterListings(availableListings)), "browse");
    elements.marketSearchMeta && (elements.marketSearchMeta.textContent = marketSearchMeta(listings.total));
    const chainState = state.chainLoading
      ? marketLoadingState()
      : state.chainError
      ? marketErrorState(state.chainError)
      : null;
    if (!listings.items.length) {
      if (chainState) {
        elements.marketListingGrid.replaceChildren(chainState);
      } else {
        elements.marketListingGrid.replaceChildren(emptyState(
          ui("main.market.noListings", "No listings match"),
          ui("main.market.noListingsMeta", "Try another category or search term."),
        ));
      }
    } else {
      if (state.activeTab === "browse" && !listings.items.some((listing) => listing.id === state.selectedListingId)) {
        state.selectedListingId = listings.items[0]?.id || "";
      }
      const nodes = listings.items.map((listing) => listingCard(listing));
      if (chainState) nodes.push(chainState);
      elements.marketListingGrid.replaceChildren(...nodes);
    }
    renderPager(elements.marketListingPager, listings, "browse");
  }

  function renderOrders() {
    if (!elements.marketOrdersGrid) return;
    const own = paginate(sortListings(filterListings(chainOwnListings())), "orders");
    if (!own.items.length) {
      elements.marketOrdersGrid.replaceChildren(emptyState(
        ui("main.market.noOrders", "No active orders"),
        ui("main.market.noOrdersMeta", "Wallet orders will appear here."),
      ));
    } else {
      if (state.activeTab === "orders" && !own.items.some((listing) => listing.id === state.selectedListingId)) {
        state.selectedListingId = own.items[0]?.id || "";
      }
      elements.marketOrdersGrid.replaceChildren(...own.items.map((listing) => listingCard(listing, { order: true })));
    }
    renderPager(elements.marketOrdersPager, own, "orders");
  }

  function renderActiveOrders() {
    if (!elements.marketActiveOrdersGrid) return;
    const own = sortListings(chainOwnListings()).slice(0, 4);
    if (!own.length) {
      elements.marketActiveOrdersGrid.replaceChildren(emptyState(
        ui("main.market.noOrders", "No active orders"),
        ui("main.market.noOrdersMeta", "Wallet orders will appear here."),
      ));
      return;
    }
    elements.marketActiveOrdersGrid.replaceChildren(...own.map((listing) => compactOrderRow(listing)));
  }

  function renderInventory() {
    if (!elements.marketInventoryGrid) return;
    const items = marketInventoryItems();
    if (!items.length) {
      elements.marketInventoryGrid.replaceChildren(emptyState(
        ui("main.market.noInventoryItems", "No listable items"),
        ui("main.market.noInventoryItemsMeta", "Equip a backpack and keep items in it to create listings."),
      ));
      return;
    }
    elements.marketInventoryGrid.replaceChildren(...items.map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "market-inventory-item";
      button.classList.toggle("selected", item.id === state.selectedItemId);
      button.dataset.itemId = item.id;
      button.disabled = Boolean(state.operation);
      button.setAttribute("aria-label", `${item.name}, ${item.meta}`);
      button.append(createVoxelItemIconCanvas(item.slot, { size: 46 }));
      const copy = document.createElement("span");
      copy.innerHTML = `<strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(categoryLabel(item.category, ui))} · ${escapeHtml(item.meta)}</small>`;
      const quantity = document.createElement("b");
      quantity.className = "market-inventory-quantity";
      quantity.textContent = `x${Math.max(1, Math.trunc(Number(item.slot?.count) || 1))}`;
      button.append(copy, quantity);
      return button;
    }));
  }

  function renderDraft() {
    const item = selectedInventoryItem();
    if (elements.marketSelectedItem) elements.marketSelectedItem.textContent = item ? item.name : ui("main.market.noSelection", "No item selected");
    if (elements.marketListingCategory && item && !elements.marketListingCategory.value) elements.marketListingCategory.value = item.category;
    syncListingPriceInput();
    const currency = currencyValue(elements.marketListingCurrency?.value || "NCK", "NCK");
    const price = normalizeMarketPriceInput(elements.marketListingPrice?.value, currency);
    const validPrice = price !== null;
    if (elements.marketCreateListing) {
      const pending = state.operation?.type === "listing";
      elements.marketCreateListing.disabled = !item || !validPrice || Boolean(state.operation);
      elements.marketCreateListing.classList.toggle("is-pending", pending);
      elements.marketCreateListing.setAttribute("aria-busy", pending ? "true" : "false");
      elements.marketCreateListing.textContent = pending
        ? ui("main.market.listingSubmitting", "Creating...")
        : ui("main.market.createListing", "Create Listing");
    }
    if (elements.marketFormStatus) {
      elements.marketFormStatus.textContent = item
        ? validPrice
          ? ui("main.market.draftReady", "Ready to list {item}. The selected stack will move into market custody.", { item: item.name })
          : ui("main.market.priceRequired", "Set a positive price before creating the listing.")
        : ui("main.market.formHint", "Select an item, set category and price, then create an on-chain listing.");
    }
  }

  function syncListingPriceInput() {
    const input = elements.marketListingPrice;
    if (!input) return;
    const currency = currencyValue(elements.marketListingCurrency?.value || "NCK", "NCK");
    const decimals = currency === "SOL" ? 9 : 6;
    const minimum = `0.${"0".repeat(decimals - 1)}1`;
    input.min = minimum;
    input.step = minimum;
  }

  function handleInventoryClick(event) {
    const button = event.target.closest("button[data-item-id]");
    if (!button) return;
    state.selectedItemId = button.dataset.itemId || "";
    const item = selectedInventoryItem();
    if (item && elements.marketListingCategory) elements.marketListingCategory.value = item.category;
    state.mobileView = "listings";
    selectTab("sell");
  }

  function handleListingAction(event) {
    const target = event.target.closest("[data-listing-id]");
    const listingId = target?.dataset.listingId || "";
    if (listingId) state.selectedListingId = listingId;
    const button = event.target.closest("button[data-market-action]");
    if (!button) {
      render();
      revealSelectedListingDetail();
      return;
    }
    const action = button.dataset.marketAction || "";
    if (action === "cancel") cancelListing(listingId);
    if (action === "buy") buyListing(listingId);
    if (action === "sell") selectTab("sell");
    if (action === "select") {
      render();
      revealSelectedListingDetail();
    }
  }

  function revealSelectedListingDetail() {
    const detail = elements.marketListingDetail;
    if (!detail || typeof globalThis.requestAnimationFrame !== "function") return;
    globalThis.requestAnimationFrame(() => {
      if (!globalThis.matchMedia?.("(pointer: coarse), (max-width: 900px)").matches) return;
      const bounds = detail.getBoundingClientRect();
      const viewportHeight = Number(globalThis.innerHeight) || 0;
      const visibleHeight = Math.max(0, Math.min(bounds.bottom, viewportHeight) - Math.max(bounds.top, 0));
      if (visibleHeight >= Math.min(180, bounds.height)) return;
      const behavior = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      detail.scrollIntoView({ behavior, block: "start" });
    });
  }

  async function createListing(event) {
    event.preventDefault();
    if (state.operation) {
      showTradeToast(ui("main.market.transactionInProgress", "A market transaction is already in progress."), "warn");
      return;
    }
    if (!ensureMarketMembership()) return;
    const item = selectedInventoryItem();
    const currency = currencyValue(elements.marketListingCurrency?.value || "NCK", "NCK");
    const price = normalizeMarketPriceInput(elements.marketListingPrice?.value, currency);
    if (!item || price === null) {
      const message = ui("main.market.invalidListing", "Select an item and enter a valid price.");
      showMarketStatus(message, "warn");
      showTradeToast(message, "warn");
      return;
    }
    const category = categoryValue(elements.marketListingCategory?.value || item.category);
    if (isChainBackpackItem(item)) {
      await createChainListing(item, { category, currency, price });
      return;
    }
    const message = ui("main.market.listingUnavailable", "Listing unavailable");
    showMarketStatus(message, "warn");
    showTradeToast(message, "error");
    await refreshChainInventory().catch(() => null);
    render();
  }

  async function createChainListing(item, { category, currency, price }) {
    const operationId = item.id;
    if (!beginMarketOperation(
      "listing",
      operationId,
      ui("main.market.listingPending", "Confirm the transaction to create this listing on-chain."),
    )) return null;
    try {
      showMarketStatus(`Submitting ${item.name} listing to chain...`);
      const module = await loadChainModule();
      if (typeof module.createMarketListingOnChain !== "function") {
        const message = ui("main.market.listingFailed", "Listing transaction failed: {reason}", {
          reason: ui("main.market.listingUnavailable", "listing unavailable"),
        });
        showMarketStatus(message, "warn");
        showTradeToast(message, "error");
        return null;
      }
      const result = await module.createMarketListingOnChain({
        item: {
          source: marketSourceForSlot(item.slot),
          backpack: item.slot.chainBackpack,
          slotIndex: marketSourceIndexForSlot(item.slot),
          category,
        },
        currency,
        price,
        backpackAddress: item.slot.chainBackpack,
      });
      if (!result?.submitted) {
        handleMarketAccessReason(result?.reason);
        const message = ui("main.market.listingFailed", "Listing transaction failed: {reason}", {
          reason: marketSubmissionReason(result?.reason, ui, "listing"),
        });
        showMarketStatus(message, "warn");
        showTradeToast(message, "error");
        return result;
      }
      const signature = shortSignature(result.signature);
      const success = ui("main.market.listingCreated", "Listing created on-chain: {signature}", { signature });
      showMarketStatus(success);
      showTradeToast(success, "success");
      await refreshChainInventory().catch(() => null);
      await refreshChainListings({ force: true, quiet: true });
      onChanged();
      onStatus(`Market listing submitted on chain: ${item.name} for ${price} ${currency}.`);
      return result;
    } catch (error) {
      const message = ui("main.market.listingFailed", "Listing transaction failed: {reason}", { reason: readableError(error) });
      showMarketStatus(message, "warn");
      showTradeToast(message, "error");
      return null;
    } finally {
      finishMarketOperation("listing", operationId);
    }
  }

  async function cancelListing(listingId) {
    if (!ensureMarketMembership()) return null;
    const listing = state.chainListings.find((entry) => entry.id === listingId && entry.status === "active");
    return listing ? cancelChainListing(listing) : null;
  }

  async function cancelChainListing(listing) {
    const operationId = listing.id;
    if (!beginMarketOperation(
      "cancel",
      operationId,
      ui("main.market.cancelPending", "Canceling..."),
    )) return null;
    try {
      showMarketStatus(`Canceling chain listing ${listing.proof?.proofHash || listing.id}...`);
      const module = await loadChainModule();
      if (typeof module.cancelMarketListingOnChain !== "function") {
        const message = ui("main.market.cancelFailed", "Cancel transaction failed: {reason}", {
          reason: ui("main.market.listingUnavailable", "listing unavailable"),
        });
        showMarketStatus(message, "warn");
        showTradeToast(message, "error");
        return null;
      }
      const result = await module.cancelMarketListingOnChain({
        listing: listing.listing,
        listingId: listing.listingId,
      });
      if (!result?.submitted) {
        handleMarketAccessReason(result?.reason);
        const message = ui("main.market.cancelFailed", "Cancel transaction failed: {reason}", {
          reason: marketSubmissionReason(result?.reason, ui, "cancel"),
        });
        showMarketStatus(message, "warn");
        showTradeToast(message, "error");
        return result;
      }
      const success = ui("main.market.cancelCreated", "Listing canceled.");
      showMarketStatus(success);
      showTradeToast(success, "success");
      await refreshChainInventory().catch(() => null);
      await refreshChainListings({ force: true, quiet: true });
      onChanged();
      return result;
    } catch (error) {
      const message = ui("main.market.cancelFailed", "Cancel transaction failed: {reason}", { reason: readableError(error) });
      showMarketStatus(message, "warn");
      showTradeToast(message, "error");
      return null;
    } finally {
      finishMarketOperation("cancel", operationId);
    }
  }

  async function buyListing(listingId) {
    if (!ensureMarketMembership()) return null;
    const listing = state.chainListings.find((entry) => entry.id === listingId && entry.status === "active");
    if (!listing) {
      const message = ui("main.market.listingUnavailable", "Listing unavailable");
      showMarketStatus(message, "warn");
      showTradeToast(message, "warn");
      return null;
    }
    const buyerBackpackAddress = getChainSnapshot?.()?.chainBackpack?.backpackAddress || "";
    if (!buyerBackpackAddress) {
      const message = ui("main.market.buyNeedsBackpack", "Equip a backpack to buy this listing.");
      showMarketStatus(message, "warn");
      showTradeToast(message, "warn");
      return null;
    }
    const operationId = listing.id;
    if (!beginMarketOperation(
      "buy",
      operationId,
      ui("main.market.buyPending", "Buying..."),
    )) return null;
    try {
      showMarketStatus(`Buying ${listing.name} from chain market...`);
      const module = await loadChainModule();
      if (typeof module.buyMarketListingOnChain !== "function") {
        const message = ui("main.market.buyFailed", "Buy transaction failed: {reason}", {
          reason: ui("main.market.listingUnavailable", "listing unavailable"),
        });
        showMarketStatus(message, "warn");
        showTradeToast(message, "error");
        return null;
      }
      const result = await module.buyMarketListingOnChain({
        listing: listing.rawListing || listing,
        buyerBackpackAddress,
      });
      if (!result?.submitted) {
        handleMarketAccessReason(result?.reason);
        const message = ui("main.market.buyFailed", "Buy transaction failed: {reason}", {
          reason: marketSubmissionReason(result?.reason, ui, "buy"),
        });
        showMarketStatus(message, "warn");
        showTradeToast(message, "error");
        return result;
      }
      const signature = shortSignature(result.signature);
      const success = ui("main.market.buyCreated", "Purchase confirmed on-chain: {signature}", { signature });
      showMarketStatus(success);
      showTradeToast(success, "success");
      await refreshChainInventory().catch(() => null);
      await refreshChainListings({ force: true, quiet: true });
      onChanged();
      onStatus(`Bought ${listing.name} from chain market.`);
      return result;
    } catch (error) {
      const message = ui("main.market.buyFailed", "Buy transaction failed: {reason}", { reason: readableError(error) });
      showMarketStatus(message, "warn");
      showTradeToast(message, "error");
      return null;
    } finally {
      finishMarketOperation("buy", operationId);
    }
  }

  async function buyLandContracts(quantity) {
    if (!ensureMarketMembership()) return null;
    const normalizedQuantity = normalizeLandContractPurchaseQuantity(quantity);
    if (normalizedQuantity === null) {
      const message = ui("main.market.contractQuantityRange", "Choose between 1 and 4,096 contracts.");
      showTradeToast(message, "warn");
      return null;
    }
    if (!beginMarketOperation(
      "contract",
      TREASURY_LAND_CONTRACT_ID,
      ui("main.market.contractPurchasePending", "Confirm the treasury contract purchase in your wallet."),
    )) return null;
    try {
      showMarketStatus(ui("main.market.contractPurchaseSubmitting", "Buying {quantity} blank land contract(s) from the treasury...", {
        quantity: formatInteger(normalizedQuantity),
      }));
      const module = await loadChainModule();
      if (typeof module.buyLandContractsOnChain !== "function") {
        throw new Error(ui("main.market.contractPurchaseUnavailable", "Land contract purchases are unavailable in this client."));
      }
      const result = await module.buyLandContractsOnChain({ quantity: normalizedQuantity });
      if (!result?.submitted) {
        handleMarketAccessReason(result?.reason);
        const message = ui("main.market.contractPurchaseFailed", "Contract purchase failed: {reason}", {
          reason: marketSubmissionReason(result?.reason, ui, "contract"),
        });
        showMarketStatus(message, "warn");
        showTradeToast(message, "error");
        return result;
      }
      if (result.marketUserState) {
        state.membership = result.marketUserState;
        state.membershipStatus = "joined";
        state.membershipWallet = currentWalletAddress();
        // Project the confirmed balance immediately; a follow-up RPC read is only reconciliation.
        onChanged();
      }
      const success = ui("main.market.contractPurchaseConfirmed", "Purchased {quantity} land contract(s). Owned: {owned}.", {
        quantity: formatInteger(normalizedQuantity),
        owned: formatInteger(result.marketUserState?.blankLandContracts ?? getLandContractSnapshot().blankLandContracts ?? 0),
      });
      showMarketStatus(success);
      showTradeToast(success, "success");
      await refreshLandContracts({ quiet: true });
      onStatus(ui("main.market.contractPurchaseChainStatus", "Land contracts confirmed on chain: {signature}", {
        signature: shortSignature(result.signature),
      }));
      return result;
    } catch (error) {
      const message = ui("main.market.contractPurchaseFailed", "Contract purchase failed: {reason}", { reason: readableError(error) });
      showMarketStatus(message, "warn");
      showTradeToast(message, "error");
      return null;
    } finally {
      finishMarketOperation("contract", TREASURY_LAND_CONTRACT_ID);
    }
  }

  async function refreshChainListings({ force = false, quiet = true } = {}) {
    const now = performance.now();
    if (state.chainLoading && !force) return { ok: false, reason: "already-loading" };
    if (!force && state.lastChainRefreshAt > 0 && now - state.lastChainRefreshAt < CHAIN_REFRESH_COOLDOWN_MS) {
      return { ok: false, reason: "cooldown" };
    }
    const requestId = ++chainRequestId;
    const walletAddress = currentWalletAddress();
    state.chainLoading = true;
    render();
    try {
      const module = await loadChainModule();
      if (requestId !== chainRequestId || walletAddress !== currentWalletAddress()) {
        return { ok: false, reason: "stale" };
      }
      if (typeof module.fetchMarketListingsOnChain !== "function") {
        state.chainError = "market-listings-unavailable";
        if (!quiet) showMarketStatus(ui(
          "main.market.chainListingsQueryUnavailable",
          "The loaded client cannot query chain market listings.",
        ), "warn");
        return { ok: false, reason: state.chainError };
      }
      const result = await module.fetchMarketListingsOnChain({
        state: "active",
      });
      if (requestId !== chainRequestId || walletAddress !== currentWalletAddress()) {
        return { ok: false, reason: "stale" };
      }
      state.chainListings = (Array.isArray(result) ? result : [])
        .map((listing) => normalizeMarketChainListing(listing, {
          walletAddress,
          resourceName,
          voxelItemLabel,
          translate: ui,
        }))
        .filter(Boolean);
      state.chainError = "";
      state.lastChainRefreshAt = performance.now();
      if (!quiet) showMarketStatus(ui(
        "main.market.chainListingsLoaded",
        "Loaded {count} chain market listings.",
        { count: state.chainListings.length },
      ));
      render();
      return { ok: true, count: state.chainListings.length };
    } catch (error) {
      if (requestId !== chainRequestId || walletAddress !== currentWalletAddress()) {
        return { ok: false, reason: "stale" };
      }
      state.chainError = readableError(error);
      if (!quiet) showMarketStatus(ui(
        "main.market.chainListingsFailed",
        "Chain market refresh failed: {reason}.",
        { reason: state.chainError },
      ), "warn");
      return { ok: false, reason: state.chainError };
    } finally {
      if (requestId === chainRequestId) {
        state.chainLoading = false;
        render();
      }
    }
  }

  function marketInventoryItems() {
    const backpackItems = gameState.backpackSlots
      .filter((slot) => isMarketListableSlot(slot, {
        equipped: Boolean(gameState.isBackpackSlotEquipped?.(slot)),
      }))
      .map((slot) => ({
        id: slot.id,
        slot,
        name: itemName(slot, resourceName, voxelItemLabel, ui),
        category: categoryForSlot(slot),
        meta: itemMeta(slot),
      }));
    const equipmentItems = (gameState.hotbarSlots ?? [])
      .filter((slot) => isMarketListableSlot(slot))
      .map((slot) => ({
        id: `market-equipment-${slot.equipmentSlot}-${slot.chainItemId || slot.sourceItemId || slot.itemPda || "item"}`,
        slot,
        name: itemName(slot, resourceName, voxelItemLabel, ui),
        category: categoryForSlot(slot),
        meta: itemMeta(slot),
      }));
    return [...backpackItems, ...equipmentItems];
  }

  function selectedInventoryItem() {
    return marketInventoryItems().find((item) => item.id === state.selectedItemId) || null;
  }

  function browseListings() {
    return [treasuryLandContractListing(), ...state.chainListings];
  }

  function findSelectedListing() {
    const id = state.selectedListingId;
    if (!id) return null;
    return browseListings().find((entry) => entry.id === id) || null;
  }

  function chainOwnListings() {
    const wallet = String(getChainSnapshot?.()?.walletAddress || "");
    return wallet ? state.chainListings.filter((entry) => entry.owner === wallet) : [];
  }

  function filterListings(listings) {
    const query = searchQuery();
    return listings.filter((listing) => {
      if (state.selectedCategory !== "all" && listing.category !== state.selectedCategory) return false;
      if (state.selectedCurrency !== "all" && listing.currency !== state.selectedCurrency) return false;
      return marketListingMatchesQuery(listing, query);
    });
  }

  function sortListings(listings) {
    const sorted = [...listings];
    sorted.sort((a, b) => {
      if (a.id === TREASURY_LAND_CONTRACT_ID) return b.id === TREASURY_LAND_CONTRACT_ID ? 0 : -1;
      if (b.id === TREASURY_LAND_CONTRACT_ID) return 1;
      if (state.selectedSort === "oldest") return a.createdAt - b.createdAt;
      if (state.selectedSort === "price-asc") return compareMarketPriceValues(a.price, b.price);
      if (state.selectedSort === "price-desc") return compareMarketPriceValues(b.price, a.price);
      return b.createdAt - a.createdAt;
    });
    return sorted;
  }

  function treasuryLandContractListing() {
    return {
      id: TREASURY_LAND_CONTRACT_ID,
      listingId: "",
      listing: "",
      source: "treasury-contract",
      treasuryProduct: true,
      status: "active",
      name: ui("main.market.blankLandContract", "Blank Land Contract"),
      meta: ui("main.market.blankLandContractMeta", "Registers one complete 16×16 chunk"),
      category: "contracts",
      currency: "NCK",
      price: String(LAND_CONTRACT_UNIT_PRICE_NCK),
      quantity: 1,
      owner: ui("main.market.treasury", "NICECHUNK Treasury"),
      createdAt: Number.MAX_SAFE_INTEGER,
      itemSnapshot: {
        kind: "land_contract",
        itemId: "blank_land_contract",
        count: 1,
        label: ui("main.market.blankLandContract", "Blank Land Contract"),
      },
      rawListing: { treasuryProduct: true },
    };
  }

  function paginate(items, tabName) {
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const page = Math.max(1, Math.min(totalPages, state.page[tabName] || 1));
    state.page[tabName] = page;
    const start = (page - 1) * PAGE_SIZE;
    return { items: items.slice(start, start + PAGE_SIZE), page, totalPages, total: items.length };
  }

  function renderPager(container, page, tabName) {
    if (!container) return;
    container.replaceChildren();
    const pageSize = Math.max(1, Math.trunc(Number(page.pageSize) || PAGE_SIZE));
    const start = page.total
      ? Math.max(1, Math.trunc(Number(page.start) || ((page.page - 1) * pageSize) + 1))
      : 0;
    const end = page.total
      ? Math.min(page.total, Math.max(start, Math.trunc(Number(page.end) || page.page * pageSize)))
      : 0;
    const summary = document.createElement("span");
    summary.textContent = ui("main.market.pageSummary", "Showing {start}-{end} of {total}", {
      start,
      end,
      total: page.total,
    });
    const controls = document.createElement("div");
    controls.className = "market-pagination-controls";
    const prev = document.createElement("button");
    prev.type = "button";
    prev.textContent = "‹";
    prev.setAttribute("aria-label", ui("main.market.previousPage", "Previous page"));
    prev.disabled = page.page <= 1;
    prev.addEventListener("click", () => changeMarketPage(tabName, page.page - 1));
    const label = document.createElement("span");
    label.textContent = ui("main.market.pageIndicator", "Page {page} / {totalPages}", {
      page: page.page,
      totalPages: page.totalPages,
    });
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "›";
    next.setAttribute("aria-label", ui("main.market.nextPage", "Next page"));
    next.disabled = page.page >= page.totalPages;
    next.addEventListener("click", () => changeMarketPage(tabName, page.page + 1));
    controls.append(prev, label, next);
    container.append(summary, controls);
  }

  function changeMarketPage(tabName, nextPage) {
    state.page[tabName] = Math.max(1, Math.trunc(Number(nextPage) || 1));
    render();
  }

  function listingCard(listing, { order = false } = {}) {
    const wallet = String(getChainSnapshot?.()?.walletAddress || "");
    const own = Boolean(wallet && listing.owner === wallet);
    const name = listingDisplayName(listing, ui);
    const card = document.createElement("article");
    card.className = "market-listing-card";
    card.classList.toggle("own", own);
    card.classList.toggle("treasury-contract", Boolean(listing.treasuryProduct));
    card.classList.toggle("selected", listing.id === state.selectedListingId);
    card.dataset.listingId = listing.id;
    card.tabIndex = 0;
    card.setAttribute("aria-label", ui("main.market.cardAria", "{name}, {price} {currency}", {
      name,
      price: listing.price,
      currency: listing.currency,
    }));
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      state.selectedListingId = listing.id;
      render();
      revealSelectedListingDetail();
    });
    const icon = document.createElement("span");
    icon.className = "market-listing-icon";
    icon.append(marketListingIcon(listing, 44));
    const copy = document.createElement("div");
    copy.className = "market-listing-copy";
    copy.innerHTML = `<strong>${escapeHtml(name)}</strong><span>${escapeHtml(categoryLabel(listing.category, ui))}</span><small>${escapeHtml(listingDisplayMeta(listing, ui))}</small>`;
    const price = document.createElement("b");
    price.className = "market-listing-price";
    price.textContent = listing.treasuryProduct
      ? ui("main.market.contractUnitPrice", "1 NCK / chunk")
      : `${listing.price} ${listing.currency}`;
    const quantity = document.createElement("span");
    quantity.className = "market-listing-quantity";
    quantity.textContent = listing.treasuryProduct
      ? ui("main.market.oneChunk", "1 chunk")
      : `x${listingQuantity(listing)}`;
    const seller = document.createElement("span");
    seller.className = "market-listing-seller";
    seller.textContent = listing.treasuryProduct
      ? ui("main.market.treasury", "NICECHUNK Treasury")
      : own
      ? ui("main.market.ownListing", "Your listing")
      : shortAddress(listing.owner);
    const action = document.createElement("button");
    action.type = "button";
    action.dataset.listingId = listing.id;
    let actionType = "";
    if (listing.treasuryProduct) {
      action.dataset.marketAction = "select";
      action.textContent = ui("main.market.chooseQuantity", "Choose quantity");
    } else if (own || order) {
      action.dataset.marketAction = "cancel";
      actionType = "cancel";
      action.textContent = ui("main.market.cancelListing", "Cancel");
    } else if (listing.source === "chain") {
      action.dataset.marketAction = "buy";
      actionType = "buy";
      action.textContent = ui("main.market.buy", "Buy");
    } else {
      action.dataset.marketAction = "select";
      action.textContent = ui("main.market.expandDetails", "Details");
    }
    syncOperationButton(action, actionType, listing.id);
    card.append(icon, copy, price, quantity, seller, action);
    return card;
  }

  function compactOrderRow(listing) {
    const row = document.createElement("article");
    row.className = "market-active-order-row";
    row.dataset.listingId = listing.id;
    const icon = document.createElement("span");
    icon.className = "market-active-order-icon";
    icon.append(createVoxelItemIconCanvas(listing.itemSnapshot || {}, { size: 30 }));
    const name = document.createElement("strong");
    name.textContent = listingDisplayName(listing, ui);
    const side = document.createElement("span");
    side.textContent = ui("main.market.sellTab", "Sell");
    const price = document.createElement("b");
    price.textContent = `${listing.price} ${listing.currency}`;
    const quantity = document.createElement("span");
    quantity.textContent = `x${listingQuantity(listing)}`;
    const action = document.createElement("button");
    action.type = "button";
    action.dataset.listingId = listing.id;
    action.dataset.marketAction = "cancel";
    action.textContent = ui("main.market.cancelListing", "Cancel");
    syncOperationButton(action, "cancel", listing.id);
    row.append(icon, name, side, price, quantity, action);
    return row;
  }

  function renderListingDetail() {
    const detail = elements.marketListingDetail;
    if (!detail) return;
    if (state.activeTab === "sell") {
      renderInventoryDetail(detail, selectedInventoryItem());
      return;
    }
    const listing = findSelectedListing();
    if (!listing) {
      detail.replaceChildren(emptyState(
        ui("main.market.detailTitle", "Listing details"),
        ui("main.market.detailSelectHint", "Select a market row to inspect its item and price."),
      ));
      return;
    }
    if (listing.treasuryProduct) {
      renderTreasuryContractDetail(detail, listing);
      return;
    }
    const own = listing.owner === String(getChainSnapshot?.()?.walletAddress || "");
    const heading = document.createElement("div");
    heading.className = "market-inspector-heading";
    heading.innerHTML = `<small>${escapeHtml(ui("main.market.detailTitle", "Listing details"))}</small><strong>${escapeHtml(listingDisplayName(listing, ui))}</strong>`;

    const hero = document.createElement("div");
    hero.className = "market-inspector-hero";
    const icon = document.createElement("span");
    icon.className = "market-inspector-icon";
    icon.append(createVoxelItemIconCanvas(listing.itemSnapshot || {}, { size: 82 }));
    const facts = document.createElement("dl");
    facts.append(
      detailFact(ui("main.market.currentPrice", "Current Price"), `${listing.price} ${listing.currency}`),
      detailFact(ui("main.market.availableQuantity", "Available Quantity"), `x${listingQuantity(listing)}`),
      detailFact(ui("main.market.detailSeller", "Seller"), own ? ui("main.market.ownListing", "Your listing") : shortAddress(listing.owner)),
    );
    hero.append(icon, facts);

    const itemDetails = createMarketDetailSection(
      ui("main.market.itemDetailsTitle", "Item details"),
      marketItemDetailRows(listing.itemSnapshot, {
        category: listing.category,
        resourceName,
        voxelItemLabel,
        translate,
      }),
      "market-item-details",
    );
    const listingDetails = createMarketDetailSection(
      ui("main.market.listingDataTitle", "On-chain listing"),
      marketListingDetailRows(listing, { translate }),
      "market-listing-details",
    );
    const description = document.createElement("p");
    description.className = "market-inspector-description";
    description.textContent = listingDisplayMeta(listing, ui);

    const trade = document.createElement("div");
    trade.className = "market-inspector-trade";
    const total = document.createElement("span");
    total.innerHTML = `<small>${escapeHtml(ui("main.market.totalPrice", "Total Price"))}</small><strong>${escapeHtml(`${listing.price} ${listing.currency}`)}</strong>`;
    const action = document.createElement("button");
    action.type = "button";
    action.dataset.listingId = listing.id;
    if (own) {
      action.dataset.marketAction = "cancel";
      action.textContent = ui("main.market.cancelListing", "Cancel");
      syncOperationButton(action, "cancel", listing.id);
    } else if (listing.source === "chain") {
      action.dataset.marketAction = "buy";
      action.textContent = ui("main.market.buyNow", "Buy Now");
      syncOperationButton(action, "buy", listing.id);
    } else {
      action.disabled = true;
      action.textContent = ui("main.market.detailUnknown", "Unknown");
    }
    trade.append(total, action);

    const custody = document.createElement("p");
    custody.className = "market-inspector-custody";
    custody.textContent = ui("main.market.custodyNote", "On-chain settlement verifies listing custody and applies the 1% market fee.");
    detail.replaceChildren(heading, hero, itemDetails, listingDetails, description, trade, custody);
  }

  function renderTreasuryContractDetail(detail, listing) {
    const contractSnapshot = getLandContractSnapshot();
    const owned = contractSnapshot.blankLandContracts;
    const reserved = contractSnapshot.reservedBlankLandContracts;
    const quantity = normalizeLandContractPurchaseQuantity(state.contractQuantity) ?? 1;
    state.contractQuantity = quantity;

    const heading = document.createElement("div");
    heading.className = "market-inspector-heading market-contract-heading";
    heading.innerHTML = `<small>${escapeHtml(ui("main.market.contractsEyebrow", "TREASURY CONTRACT"))}</small><strong>${escapeHtml(listing.name)}</strong>`;

    const hero = document.createElement("div");
    hero.className = "market-inspector-hero market-contract-hero";
    const icon = document.createElement("span");
    icon.className = "market-inspector-icon market-contract-hero-icon";
    icon.append(marketListingIcon(listing, 82));
    const facts = document.createElement("dl");
    facts.append(
      detailFact(ui("main.market.unitPrice", "Unit Price"), ui("main.market.contractUnitPrice", "1 NCK / chunk")),
      detailFact(ui("main.market.contractCoverage", "Coverage"), ui("main.market.contractCoverageValue", "1 complete 16×16 chunk")),
      detailFact(ui("main.market.contractsOwned", "Contracts Owned"), owned == null ? ui("main.market.balanceLoading", "Loading...") : formatInteger(owned)),
      detailFact(ui("main.market.contractsReserved", "Registration Reserved"), reserved == null ? ui("main.market.balanceLoading", "Loading...") : formatInteger(reserved)),
    );
    hero.append(icon, facts);

    const description = document.createElement("p");
    description.className = "market-inspector-description";
    description.textContent = ui(
      "main.market.blankLandContractDescription",
      "The NICECHUNK Treasury issues blank land contracts at a fixed price. Registering land consumes one contract for every selected chunk.",
    );

    const rules = createMarketDetailSection(
      ui("main.market.contractRulesTitle", "Contract rules"),
      [
        marketDetailRow("issuer", ui("main.market.contractIssuer", "Issuer"), ui("main.market.treasury", "NICECHUNK Treasury")),
        marketDetailRow("storage", ui("main.market.contractStorage", "Storage"), ui("main.market.contractNoBackpack", "Market membership PDA, no backpack space")),
        marketDetailRow("transfer", ui("main.market.contractUse", "Use"), ui("main.market.contractUseValue", "Consumed atomically when land is registered")),
      ],
      "market-contract-rules",
    );

    const form = document.createElement("form");
    form.className = "market-contract-purchase";
    const quantityLabel = document.createElement("label");
    quantityLabel.htmlFor = "marketContractQuantity";
    const quantityCaption = document.createElement("span");
    quantityCaption.textContent = ui("main.market.contractQuantity", "Contracts");
    const quantityInput = document.createElement("input");
    quantityInput.id = "marketContractQuantity";
    quantityInput.type = "number";
    quantityInput.min = "1";
    quantityInput.max = String(LAND_CONTRACT_PURCHASE_MAX);
    quantityInput.step = "1";
    quantityInput.inputMode = "numeric";
    quantityInput.value = String(quantity);
    quantityInput.disabled = Boolean(state.operation);
    quantityInput.setAttribute("aria-describedby", "marketContractTotal");
    quantityLabel.append(quantityCaption, quantityInput);

    const total = document.createElement("span");
    total.id = "marketContractTotal";
    total.className = "market-contract-total";
    const totalCaption = document.createElement("small");
    totalCaption.textContent = ui("main.market.totalPrice", "Total Price");
    const totalValue = document.createElement("strong");
    total.append(totalCaption, totalValue);
    const updateQuantity = ({ commit = false } = {}) => {
      const normalized = normalizeLandContractPurchaseQuantity(quantityInput.value);
      if (normalized !== null) {
        state.contractQuantity = normalized;
        totalValue.textContent = `${formatInteger(normalized * LAND_CONTRACT_UNIT_PRICE_NCK)} NCK`;
        quantityInput.setCustomValidity("");
        return normalized;
      }
      quantityInput.setCustomValidity(ui("main.market.contractQuantityRange", "Choose between 1 and 4,096 contracts."));
      if (commit) quantityInput.reportValidity?.();
      totalValue.textContent = "-- NCK";
      return null;
    };
    quantityInput.addEventListener("input", () => updateQuantity());
    quantityInput.addEventListener("change", () => updateQuantity({ commit: true }));

    const buy = document.createElement("button");
    buy.type = "submit";
    buy.dataset.marketAction = "buy-contract";
    buy.dataset.listingId = TREASURY_LAND_CONTRACT_ID;
    buy.textContent = ui("main.market.buyContracts", "Buy land contracts");
    syncOperationButton(buy, "contract", TREASURY_LAND_CONTRACT_ID);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const nextQuantity = updateQuantity({ commit: true });
      if (nextQuantity !== null) void buyLandContracts(nextQuantity);
    });
    form.append(quantityLabel, total, buy);
    updateQuantity();

    const note = document.createElement("p");
    note.className = "market-inspector-custody";
    note.textContent = ui("main.market.contractTreasuryNote", "Payment goes directly to the on-chain treasury. This product does not create or use a market Listing PDA.");
    detail.replaceChildren(heading, hero, description, rules, form, note);
  }

  function renderInventoryDetail(detail, item) {
    if (!item) {
      detail.replaceChildren(emptyState(
        ui("main.market.noSelection", "No item selected"),
        ui("main.market.sellSelectHint", "Select an item from the inventory panel"),
      ));
      return;
    }
    const heading = document.createElement("div");
    heading.className = "market-inspector-heading";
    heading.innerHTML = `<small>${escapeHtml(ui("main.market.inventoryEyebrow", "Backpack"))}</small><strong>${escapeHtml(item.name)}</strong>`;
    const hero = document.createElement("div");
    hero.className = "market-inspector-hero is-inventory";
    const icon = document.createElement("span");
    icon.className = "market-inspector-icon";
    icon.append(createVoxelItemIconCanvas(item.slot || {}, { size: 82 }));
    const facts = document.createElement("dl");
    facts.append(
      detailFact(ui("main.market.categoryLabel", "Category"), categoryLabel(item.category, ui)),
      detailFact(ui("main.market.tableQuantity", "Quantity"), `x${Math.max(1, Math.trunc(Number(item.slot?.count) || 1))}`),
      detailFact(ui("main.market.detailSource", "Source"), ui("main.market.sourceBackpack", "Backpack")),
    );
    hero.append(icon, facts);
    const itemDetails = createMarketDetailSection(
      ui("main.market.itemDetailsTitle", "Item details"),
      marketItemDetailRows(item.slot, {
        category: item.category,
        resourceName,
        voxelItemLabel,
        translate,
      }),
      "market-item-details",
    );
    const note = document.createElement("p");
    note.className = "market-inspector-description";
    note.textContent = item.meta;
    detail.replaceChildren(heading, hero, itemDetails, note);
  }

  function createMarketDetailSection(title, rows, className) {
    const section = document.createElement("section");
    section.className = `market-detail-section ${className}`;
    const heading = document.createElement("h3");
    heading.textContent = title;
    const facts = document.createElement("dl");
    facts.className = "market-detail-facts";
    facts.replaceChildren(...rows.map((row) => {
      const fact = detailFact(row.label, marketDetailValue(row));
      fact.dataset.marketDetailKey = row.key;
      return fact;
    }));
    section.append(heading, facts);
    return section;
  }

  function marketDetailValue(row) {
    if (!row.address) return row.value;
    const address = String(row.address || "").trim();
    if (!SOLANA_ADDRESS_PATTERN.test(address)) return row.value;
    const link = document.createElement("a");
    link.className = "market-detail-proof";
    link.href = solanaExplorerAddressUrl(address, getChainSnapshot?.()?.rpcUrl);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = address;
    link.textContent = row.value || address;
    return link;
  }

  function detailFact(label, value) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    if (value?.nodeType) description.append(value);
    else description.textContent = value;
    row.append(term, description);
    return row;
  }

  function marketListingIcon(listing, size) {
    if (!listing?.treasuryProduct) return createVoxelItemIconCanvas(listing?.itemSnapshot || {}, { size });
    return createLandContractIconElement({ size });
  }

  function formatInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0
      ? number.toLocaleString("en-US", { maximumFractionDigits: 0 })
      : "--";
  }

  function emptyState(title, body) {
    const node = document.createElement("div");
    node.className = "market-empty";
    node.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span>`;
    return node;
  }

  function marketLoadingState() {
    const node = emptyState(
      ui("main.market.loadingListings", "Loading chain listings"),
      ui("main.market.loadingListingsMeta", "Reading active marketplace PDA accounts from the configured RPC."),
    );
    node.classList.add("market-loading");
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    const spinner = document.createElement("i");
    spinner.setAttribute("aria-hidden", "true");
    node.prepend(spinner);
    return node;
  }

  function marketErrorState(reason) {
    const node = emptyState(
      ui("main.market.listingLoadFailed", "Could not load chain listings"),
      ui("main.market.listingLoadFailedMeta", "{reason}. Check the RPC or network, then retry.", { reason }),
    );
    node.classList.add("market-load-error");
    node.setAttribute("role", "alert");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = ui("main.market.retryListings", "Retry loading");
    retry.addEventListener("click", () => refreshChainListings({ force: true, quiet: false }));
    node.append(retry);
    return node;
  }

  function showMarketStatus(message, tone = "info") {
    if (elements.marketStatus) {
      elements.marketStatus.hidden = !message;
      elements.marketStatus.textContent = message || "";
      elements.marketStatus.dataset.tone = tone;
    }
    if (message) onStatus(message);
  }

  function syncOperationButton(button, type, targetId) {
    if (!button || button.tagName !== "BUTTON") return;
    const pending = Boolean(type && state.operation?.type === type && state.operation?.targetId === String(targetId));
    button.disabled = Boolean(state.operation) || button.disabled;
    button.classList.toggle("is-pending", pending);
    button.setAttribute("aria-busy", pending ? "true" : "false");
    if (pending) button.textContent = operationButtonLabel(type);
  }

  function operationButtonLabel(type) {
    if (type === "contract") return ui("main.market.contractPurchasePendingShort", "Purchasing...");
    if (type === "buy") return ui("main.market.buyPending", "Buying...");
    if (type === "cancel") return ui("main.market.cancelPending", "Canceling...");
    return ui("main.market.listingSubmitting", "Creating...");
  }

  function beginMarketOperation(type, targetId, message) {
    if (state.operation) {
      showTradeToast(ui("main.market.transactionInProgress", "A market transaction is already in progress."), "warn");
      return false;
    }
    state.operation = { type, targetId: String(targetId || "") };
    showTradeToast(message, "pending", { persistent: true });
    render();
    return true;
  }

  function finishMarketOperation(type, targetId) {
    if (state.operation?.type !== type || state.operation?.targetId !== String(targetId || "")) return;
    state.operation = null;
    render();
  }

  function showTradeToast(message, tone = "info", { persistent = false } = {}) {
    const toast = elements.marketTradeToast;
    const text = String(message || "").trim();
    if (!toast || !text) return;
    globalThis.clearTimeout?.(tradeToastTimer);
    tradeToastTimer = 0;
    if (elements.marketTradeToastMessage) elements.marketTradeToastMessage.textContent = text;
    else toast.textContent = text;
    toast.dataset.tone = tone;
    toast.hidden = false;
    toast.classList.remove("is-visible");
    globalThis.requestAnimationFrame?.(() => toast.classList.add("is-visible"));
    if (persistent) return;
    tradeToastTimer = globalThis.setTimeout?.(() => {
      toast.classList.remove("is-visible");
      globalThis.setTimeout?.(() => {
        if (!toast.classList.contains("is-visible")) toast.hidden = true;
      }, 220);
    }, tone === "error" || tone === "warn" ? 7_500 : 5_500) ?? 0;
  }

  function marketSearchMeta(total) {
    const base = ui("main.market.resultSummary", "{total} listings · {category} · {currency}", {
      total,
      category: categoryLabel(state.selectedCategory, ui),
      currency: currencyLabel(state.selectedCurrency, ui),
    });
    const loading = state.chainLoading ? ` · ${ui("main.market.chainListingsSyncing", "Syncing chain listings...")}` : "";
    const error = state.chainError ? ` · ${ui("main.market.chainListingsUnavailable", "Chain sync unavailable")}` : "";
    return `${base}${loading}${error}`;
  }

  return api;
}

function listingDisplayName(listing, translate = fallbackUi) {
  return String(listing?.name || translate("main.market.detailUnknown", "Unknown"));
}

function listingDisplayMeta(listing) {
  return String(listing?.meta || "");
}

function listingQuantity(listing) {
  return Math.max(1, Math.trunc(Number(listing?.itemSnapshot?.count || listing?.rawListing?.quantity) || 1));
}

function normalizeListing(listing) {
  if (!listing || typeof listing !== "object") return null;
  const id = String(listing.id || "");
  const itemSnapshot = listing.itemSnapshot && typeof listing.itemSnapshot === "object" ? { ...listing.itemSnapshot } : null;
  if (!id || !itemSnapshot) return null;
  if (listing.status && listing.status !== "active") return null;
  return {
    id,
    source: "chain",
    owner: String(listing.owner || ""),
    status: "active",
    name: String(listing.name || "Listing"),
    meta: String(listing.meta || "Chain-ready item"),
    category: categoryValue(listing.category),
    currency: currencyValue(listing.currency, "NCK"),
    price: String(listing.price || "0"),
    itemSnapshot,
    createdAt: Number.isFinite(listing.createdAt) ? Math.trunc(listing.createdAt) : Date.now(),
    proof: listing.proof && typeof listing.proof === "object" ? listing.proof : createMarketProof({ item: itemSnapshot, category: listing.category, currency: listing.currency, price: listing.price }),
    listing: listing.listing || null,
    listingId: listing.listingId || null,
    rawListing: listing.rawListing || null,
  };
}

export function normalizeMarketChainListing(listing, {
  walletAddress = "",
  resourceName = resourceNameFallback,
  voxelItemLabel = null,
  translate = fallbackUi,
} = {}) {
  if (!listing || typeof listing !== "object") return null;
  const sourceSlot = listing.sourceSlot && typeof listing.sourceSlot === "object" ? listing.sourceSlot : null;
  if (sourceSlot?.category === 3 && sourceSlot?.itemCode === 9) return null;
  const itemSnapshot = marketItemSnapshotFromChainListing(listing);
  if (!itemSnapshot) return null;
  const ui = (key, fallback, params = {}) => translate(key, fallback, params);
  return normalizeListing({
    id: String(listing.listing || listing.listingId || ""),
    source: "chain",
    owner: String(listing.seller || ""),
    status: ["active", "canceled", "sold"].includes(listing.stateLabel) ? listing.stateLabel : "active",
    name: chainListingName(itemSnapshot, resourceName, voxelItemLabel, ui),
    meta: chainListingMeta(listing, itemSnapshot, walletAddress),
    category: marketCategoryForBackpackSlot(sourceSlot),
    currency: listing.currency,
    price: listing.price,
    itemSnapshot,
    createdAt: chainListingCreatedAt(listing),
    proof: {
      ruleSet: "nicechunk-market-pda-v1",
      proofHash: listing.listing ? shortSignature(listing.listing) : `listing:${listing.listingId || "unknown"}`,
      listing: listing.listing || "",
      seller: listing.seller || "",
    },
    listing: listing.listing,
    listingId: listing.listingId,
    rawListing: listing,
  });
}

export function marketItemSnapshotFromChainListing(listing) {
  const sourceSlot = listing?.sourceSlot && typeof listing.sourceSlot === "object" ? listing.sourceSlot : null;
  if (!sourceSlot) return null;
  const count = Math.max(1, Math.trunc(Number(listing.quantity || sourceSlot.quantity) || 1));
  const itemCode = Math.max(0, Math.trunc(Number(sourceSlot.itemCode) || 0));
  const itemCategory = Math.max(0, Math.trunc(Number(sourceSlot.category) || 0));
  const chainItemId = String(sourceSlot.itemId || "0");
  const common = {
    id: `market-${String(listing.listing || listing.listingId || "listing")}-${chainItemId}`,
    count,
    pending: false,
    source: "chain-market",
    chainItemId,
    itemCode,
    itemPda: String(sourceSlot.itemPda || ""),
    volumeMm3: Math.max(0, Math.trunc(Number(sourceSlot.volumeMm3) || 0)),
    massGrams: normalizeMarketMassGrams(sourceSlot.massGrams),
    metadata: Math.trunc(Number(sourceSlot.metadata) || 0) >>> 0,
  };

  if (sourceSlot.kind === "item" || Number(sourceSlot.kindCode) === 2) {
    if (itemCategory === 1) {
      const materialId = smeltingMaterialIdForItemCode(itemCode) || `material-${itemCode}`;
      const material = smeltingMaterialById(materialId);
      const qualityBps = Math.max(0, Math.trunc(Number(sourceSlot.qualityBps) || 0));
      return {
        ...common,
        kind: "smelted_material",
        itemId: "chain_material",
        materialId,
        label: material ? titleCase(material.id) : titleCase(materialId),
        className: material ? titleCase(material.class) : "Material",
        qualityBps,
        quality: Math.max(0, Math.min(100, Math.round(qualityBps / 100))),
        previewColor: marketMaterialPreviewColor(material),
      };
    }
    if (itemCategory === 2 || itemCode === 8) {
      return {
        ...common,
        kind: "forged",
        itemId: "forged_item",
        label: `Forged Item #${chainItemId}`,
        className: "Forged",
        bytes: Array.isArray(sourceSlot.modelBytes) ? [...sourceSlot.modelBytes] : null,
        designHash: Math.trunc(Number(sourceSlot.metadata) || 0) >>> 0,
        durability: Math.max(0, Math.trunc(Number(sourceSlot.durabilityCurrent) || 0)),
        maxDurability: Math.max(0, Math.trunc(Number(sourceSlot.durabilityMax) || 0)),
        durabilityCurrent: Math.max(0, Math.trunc(Number(sourceSlot.durabilityCurrent) || 0)),
        durabilityMax: Math.max(0, Math.trunc(Number(sourceSlot.durabilityMax) || 0)),
        grade: Math.max(0, Math.trunc(Number(sourceSlot.grade) || 0)),
        itemLevel: Math.max(0, Math.trunc(Number(sourceSlot.itemLevel) || 0)),
        qualityBps: Math.max(0, Math.trunc(Number(sourceSlot.qualityBps) || 0)),
        proofHash: String(sourceSlot.itemPda || ""),
      };
    }
    return {
      ...common,
      kind: "tool",
      itemId: "chain_item",
      durability: Math.max(0, Math.trunc(Number(sourceSlot.durabilityCurrent) || 0)),
      maxDurability: Math.max(0, Math.trunc(Number(sourceSlot.durabilityMax) || 0)),
    };
  }

  const sourceRecord = listing.sourceRecord && typeof listing.sourceRecord === "object"
    ? listing.sourceRecord
    : sourceSlot.resource;
  const blockId = Math.max(0, Math.trunc(Number(sourceRecord?.blockId) || 0));
  const resourceId = resourceIdForBlock(blockId);
  return {
    ...common,
    kind: "resource",
    ...(resourceId ? { resourceId } : {}),
    blockId,
    proof: sourceRecord ? {
      worldX: Math.trunc(Number(sourceRecord.worldX) || 0),
      worldY: Math.trunc(Number(sourceRecord.worldY) || 0),
      worldZ: Math.trunc(Number(sourceRecord.worldZ) || 0),
      blockId,
    } : null,
  };
}

export function marketItemDetailRows(slot, {
  category = "",
  resourceName = resourceNameFallback,
  voxelItemLabel = null,
  translate = fallbackUi,
} = {}) {
  if (!slot || typeof slot !== "object") return [];
  const ui = (key, fallback, params = {}) => translate(key, fallback, params);
  const resolvedCategory = MARKET_CATEGORIES.includes(category) && category !== "all"
    ? category
    : marketCategoryForBackpackSlot(slot);
  const rows = [
    marketDetailRow("category", ui("main.market.categoryLabel", "Category"), categoryLabel(resolvedCategory, translate)),
    marketDetailRow("quantity", ui("main.market.tableQuantity", "Quantity"), `x${Math.max(1, Math.trunc(Number(slot.count) || 1))}`),
  ];

  if (slot.massGrams != null && Number.isFinite(Number(slot.massGrams))) {
    rows.push(marketDetailRow("mass", ui("main.market.massLabel", "Mass"), formatMassGrams(slot.massGrams)));
  }
  if (Number.isFinite(Number(slot.volumeMm3)) && Number(slot.volumeMm3) > 0) {
    rows.push(marketDetailRow("volume", ui("main.market.volumeLabel", "Volume"), formatVolumeCm3(slot.volumeMm3)));
  }

  if (slot.kind === "resource") {
    const resourceId = Number(slot.resourceId);
    if (Number.isFinite(resourceId) && resourceId > 0) {
      rows.push(marketDetailRow(
        "resource",
        ui("main.market.resourceLabel", "Resource"),
        `${resourceName(resourceId)} / R${resourceId}`,
      ));
    }
    if (Number.isFinite(Number(slot.blockId)) && Number(slot.blockId) > 0) {
      rows.push(marketDetailRow("block-id", ui("main.market.blockIdLabel", "Block ID"), String(Math.trunc(Number(slot.blockId)))));
    }
    const coordinates = marketResourceCoordinates(slot);
    if (coordinates) rows.push(marketDetailRow("coordinates", ui("main.market.coordinatesLabel", "Coordinates"), coordinates));
    if (Number.isFinite(Number(slot.yieldBps))) {
      rows.push(marketDetailRow("yield", ui("main.market.yieldLabel", "Gather yield"), formatBasisPoints(slot.yieldBps)));
    }
  }

  if (slot.kind === "smelted_material") {
    rows.push(marketDetailRow(
      "material",
      ui("main.market.materialLabel", "Material"),
      itemName(slot, resourceName, voxelItemLabel, translate),
    ));
  }

  if (slot.kind === "forged" || slot.kind === "tool" || slot.itemId === "forged_item") {
    const currentDurability = Number(slot.durabilityCurrent ?? slot.durability);
    const maximumDurability = Number(slot.durabilityMax ?? slot.maxDurability);
    if (Number.isFinite(currentDurability) || Number.isFinite(maximumDurability)) {
      rows.push(marketDetailRow(
        "durability",
        ui("main.market.durabilityLabel", "Durability"),
        `${Math.max(0, Math.trunc(currentDurability) || 0)} / ${Math.max(0, Math.trunc(maximumDurability) || 0)}`,
      ));
    }
    if (Number.isFinite(Number(slot.grade))) {
      rows.push(marketDetailRow("grade", ui("main.market.gradeLabel", "Grade"), String(Math.max(0, Math.trunc(Number(slot.grade))))));
    }
    if (Number.isFinite(Number(slot.itemLevel))) {
      rows.push(marketDetailRow("item-level", ui("main.market.itemLevelLabel", "Item level"), String(Math.max(0, Math.trunc(Number(slot.itemLevel))))));
    }
  }

  if (slot.qualityBps != null && Number.isFinite(Number(slot.qualityBps))) {
    rows.push(marketDetailRow("quality", ui("main.market.qualityLabel", "Quality"), formatBasisPoints(slot.qualityBps)));
  } else if (slot.quality != null && Number.isFinite(Number(slot.quality))) {
    rows.push(marketDetailRow("quality", ui("main.market.qualityLabel", "Quality"), `${formatDecimal(Number(slot.quality), 2)}%`));
  }

  if (Number.isFinite(Number(slot.itemCode)) && Number(slot.itemCode) > 0) {
    rows.push(marketDetailRow("item-code", ui("main.market.itemCodeLabel", "Item code"), String(Math.trunc(Number(slot.itemCode)))));
  }
  const chainItemId = String(slot.chainItemId ?? "").trim();
  if (chainItemId && chainItemId !== "0") {
    rows.push(marketDetailRow("item-id", ui("main.market.itemIdLabel", "Item ID"), chainItemId));
  }
  const itemPda = String(slot.itemPda || "").trim();
  if (itemPda && itemPda !== "11111111111111111111111111111111") {
    rows.push(marketDetailRow("item-pda", ui("main.market.itemPdaLabel", "Item PDA"), itemPda, itemPda));
  }
  const proofHash = String(slot.proofHash || "").trim();
  if (proofHash && proofHash !== itemPda) {
    rows.push(marketDetailRow("proof", ui("main.market.itemProofLabel", "Proof"), proofHash, proofHash));
  }
  return rows;
}

export function marketListingDetailRows(listing, { translate = fallbackUi } = {}) {
  if (!listing || typeof listing !== "object") return [];
  const ui = (key, fallback, params = {}) => translate(key, fallback, params);
  if (listing.treasuryProduct || listing.rawListing?.treasuryProduct) {
    return [
      marketDetailRow("issuer", ui("main.market.contractIssuer", "Issuer"), ui("main.market.treasury", "NICECHUNK Treasury")),
      marketDetailRow("price", ui("main.market.unitPrice", "Unit Price"), ui("main.market.contractUnitPrice", "1 NCK / chunk")),
      marketDetailRow("coverage", ui("main.market.contractCoverage", "Coverage"), ui("main.market.contractCoverageValue", "1 complete 16×16 chunk")),
    ];
  }
  const raw = listing.rawListing && typeof listing.rawListing === "object" ? listing.rawListing : listing;
  const rows = [];
  const state = String(listing.status || raw.stateLabel || "active");
  rows.push(marketDetailRow("listing-state", ui("main.market.listingStateLabel", "Listing state"), marketListingStateLabel(state, translate)));
  const listingId = String(listing.listingId ?? raw.listingId ?? "").trim();
  if (listingId) rows.push(marketDetailRow("listing-id", ui("main.market.listingIdLabel", "Listing ID"), listingId));
  const listingPda = String(listing.listing || raw.listing || "").trim();
  if (listingPda) rows.push(marketDetailRow("listing-pda", ui("main.market.listingPdaLabel", "Listing PDA"), listingPda, listingPda));
  const seller = String(listing.owner || raw.seller || "").trim();
  if (seller) rows.push(marketDetailRow("seller", ui("main.market.detailSeller", "Seller"), seller, seller));
  const source = String(raw.source || "").toLowerCase();
  if (source) {
    rows.push(marketDetailRow(
      "source",
      ui("main.market.detailSource", "Source"),
      source === "equipment"
        ? ui("main.market.sourceEquipment", "Equipment")
        : ui("main.market.sourceBackpack", "Backpack"),
    ));
  }
  if (raw.sourceIndex != null && Number.isInteger(Number(raw.sourceIndex)) && Number(raw.sourceIndex) >= 0) {
    rows.push(marketDetailRow("source-slot", ui("main.market.sourceSlotLabel", "Source slot"), String(Number(raw.sourceIndex))));
  }
  const created = formatMarketTimestamp(listing.createdAt);
  if (created) rows.push(marketDetailRow("created", ui("main.market.createdLabel", "Created"), created));
  return rows;
}

export function solanaExplorerAddressUrl(address, rpcUrl = "") {
  const value = String(address || "").trim();
  if (!SOLANA_ADDRESS_PATTERN.test(value)) return "";
  const base = `https://explorer.solana.com/address/${value}`;
  const rpc = String(rpcUrl || "").toLowerCase();
  if (rpc.includes("mainnet")) return base;
  return `${base}?cluster=${rpc.includes("testnet") ? "testnet" : "devnet"}`;
}

function marketDetailRow(key, label, value, address = "") {
  return { key, label, value: String(value ?? "-"), address: String(address || "") };
}

function marketResourceCoordinates(slot) {
  const proof = slot?.proof && typeof slot.proof === "object" ? slot.proof : null;
  if (!proof) return "";
  const coordinates = [proof.worldX, proof.worldY, proof.worldZ].map(Number);
  return coordinates.every(Number.isFinite) ? coordinates.map(Math.trunc).join(", ") : "";
}

function marketListingStateLabel(state, translate) {
  if (state === "sold") return translate("main.market.sold", "Sold");
  if (state === "canceled") return translate("main.market.canceled", "Canceled");
  return translate("main.market.stateActive", "Active");
}

function formatBasisPoints(value) {
  const basisPoints = Math.max(0, Math.trunc(Number(value) || 0));
  return `${formatDecimal(basisPoints / 100, 2)}%`;
}

function formatDecimal(value, maximumFractionDigits) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(maximumFractionDigits).replace(/(?:\.0+|(\.\d*?[1-9])0+)$/u, "$1");
}

function formatMarketTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp < 1_000_000_000_000) return "";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function isChainBackpackItem(item) {
  if (isCustodiedMarketEquipment(item?.slot)) return true;
  return isChainBackpackSlot(item?.slot);
}

export function isMarketListableSlot(slot, { equipped = false } = {}) {
  return Boolean(slot
    && !slot.pending
    && !equipped
    && slot.kind !== "blueprint"
    && slot.itemId !== "blueprint_tool"
    && (isChainBackpackSlot(slot) || isCustodiedMarketEquipment(slot)));
}

function isChainBackpackSlot(slot) {
  const source = String(slot?.source || "");
  return Boolean(
    slot
      && (source === "chain" || source === "chain-backpack")
      && slot.chainBackpack
      && Number.isInteger(slot.chainIndex)
      && slot.chainIndex >= 0,
  );
}

function isCustodiedMarketEquipment(slot) {
  return Boolean(
    slot
      && slot.custodySource === "equipment"
      && Number.isInteger(slot.equipmentSlot)
      && slot.equipmentSlot >= 0
      && slot.equipmentSlot < 9
      && slot.chainBackpack,
  );
}

function marketSourceForSlot(slot) {
  return isCustodiedMarketEquipment(slot) ? "equipment" : "backpack";
}

function marketSourceIndexForSlot(slot) {
  return isCustodiedMarketEquipment(slot) ? slot.equipmentSlot : slot.chainIndex;
}

function chainListingName(itemSnapshot, resourceName, voxelItemLabel, translate) {
  return itemName(itemSnapshot, resourceName, voxelItemLabel, translate);
}

function chainListingMeta(listing, itemSnapshot, walletAddress = "") {
  const parts = [];
  const count = Math.max(1, Math.trunc(Number(itemSnapshot?.count || listing?.quantity) || 1));
  parts.push(`${count} item${count === 1 ? "" : "s"}`);
  if (listing?.source) parts.push(String(listing.source));
  if (listing?.seller) {
    const mine = walletAddress && String(listing.seller) === String(walletAddress);
    parts.push(mine ? "your listing" : `seller ${shortAddress(listing.seller)}`);
  }
  if (listing?.programId) parts.push(`PDA ${shortAddress(listing.listing || listing.programId)}`);
  return parts.join(" · ");
}

function chainListingCreatedAt(listing) {
  const value = Number(listing?.createdAt);
  if (Number.isFinite(value) && value > 0) return Math.trunc(value * 1000);
  const slot = Number(listing?.createdSlot);
  return Number.isFinite(slot) && slot > 0 ? Math.trunc(slot) : Date.now();
}

function createMarketProof({ item, category, currency, price }) {
  const text = [item?.kind || "resource", item?.resourceId ?? "", item?.blockId ?? "", item?.materialId ?? "", item?.count ?? 0, categoryValue(category), currencyValue(currency, "NCK"), String(price || "0")].join("|");
  return {
    ruleSet: MARKET_RULE_SET,
    itemKind: item?.kind || "resource",
    category: categoryValue(category),
    currency: currencyValue(currency, "NCK"),
    price: String(price || "0"),
    proofHash: `0x${hash32(text).toString(16).padStart(8, "0")}`,
  };
}

function categoryForSlot(slot) {
  return marketCategoryForBackpackSlot(slot);
}

function itemName(slot, resourceName = resourceNameFallback, voxelItemLabel = null, translate = fallbackUi) {
  if (slot?.kind === "smelted_material") {
    const materialId = String(slot.materialId || "").trim();
    const fallback = slot.label || titleCase(materialId || "Material");
    return materialId ? translate(`resourceAtlas.material.item.${materialId}.name`, fallback) : fallback;
  }
  if (typeof voxelItemLabel === "function" && (slot?.kind === "forged" || slot?.kind === "tool" || slot?.itemId)) {
    const label = String(voxelItemLabel(slot) || "").trim();
    if (label) return label;
  }
  if (slot?.kind === "forged" || slot?.itemId === "forged_item") return translate("main.item.forged_item", "Forged Tool");
  if (slot?.kind === "tool" || slot?.itemId === "iron_pickaxe") return translate("main.item.iron_pickaxe", "Pickaxe");
  if (Number.isFinite(slot?.resourceId)) return resourceName(slot.resourceId);
  if (Number.isFinite(slot?.blockId)) return `Block #${slot.blockId}`;
  return translate("main.market.detailItem", "Item");
}

function itemMeta(slot) {
  if (slot?.kind === "smelted_material") return `${slot.count} items · Q${slot.quality || 0}`;
  if (slot?.kind === "forged" || slot?.itemId === "forged_item") return `Durability ${Math.max(0, Math.trunc(slot.durability || 0))}/${Math.max(1, Math.trunc(slot.maxDurability || 1))}`;
  if (Number.isFinite(slot?.resourceId)) return `${slot.count} items · resource ${slot.resourceId}`;
  return `${slot?.count || 1} item`;
}

function categoryLabel(category, translate = fallbackUi) {
  const [key, fallback] = ({
    all: ["main.market.categoryAll", "All"],
    contracts: ["main.market.categoryContracts", "Contracts"],
    raw: ["main.market.categoryRaw", "Raw Materials"],
    building: ["main.market.categoryBuilding", "Building Materials"],
    equipment: ["main.market.categoryEquipment", "Equipment"],
    clothing: ["main.market.categoryClothing", "Clothing"],
  })[category] || ["main.market.categoryAll", "All"];
  return translate(key, fallback);
}

function currencyLabel(currency, translate = fallbackUi) {
  return currency === "all" ? translate("main.market.currencyAll", "All currencies") : currencyValue(currency, "NCK");
}

function categoryValue(value) {
  return MARKET_LISTING_CATEGORIES.includes(value) ? value : "raw";
}

function currencyValue(value, fallback = "all") {
  const text = String(value || fallback).toUpperCase();
  return MARKET_CURRENCIES.includes(text) ? text : fallback;
}

function searchQuery() {
  return String(document.querySelector("#marketSearch")?.value || "").trim().toLowerCase();
}

function resourceNameFallback(resourceId) {
  const names = {
    1: "Grass Fiber", 2: "Soil", 3: "Stone", 4: "Sand", 5: "Clay", 6: "Snow", 7: "Basalt", 8: "Water", 9: "Wood", 10: "Leaves", 11: "Coal", 12: "Salt", 13: "Ice", 14: "Lava", 15: "Organic", 16: "Cactus", 17: "Reed", 18: "Moss", 19: "Mushroom", 20: "Aquatic Plant", 21: "Coral", 22: "Shell",
  };
  return names[resourceId] || `Resource ${resourceId}`;
}

function shortAddress(address) {
  const value = String(address || "");
  return value.length > 12 ? `${value.slice(0, 4)}...${value.slice(-4)}` : value;
}

function shortSignature(signature) {
  const value = String(signature || "");
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-6)}` : value || "no-signature";
}

function readableError(error) {
  const message = String(error?.message || error || "unknown error");
  return message.length > 180 ? `${message.slice(0, 177)}...` : message;
}

function marketSubmissionReason(reason, translate = fallbackUi, action = "listing") {
  if (reason === "active-listing-limit") {
    return translate("main.market.activeListingLimit", "Each wallet may have at most 50 active listings.");
  }
  if (reason === "market-membership-required") {
    return translate("main.market.joinRequired", "Join the market before creating or settling listings.");
  }
  if (reason === "market-already-joined") {
    return translate("main.market.alreadyJoined", "This wallet has already joined the market.");
  }
  if (reason === "wallet-unavailable") {
    return translate("main.market.membershipWalletRequired", "Connect your game wallet before joining the market.");
  }
  if (reason === "no-backpack") {
    if (action === "cancel") {
      return translate("main.market.cancelNeedsBackpackSpace", "Free one backpack slot before canceling this listing.");
    }
    return action === "buy"
      ? translate("main.market.buyNeedsBackpack", "Equip a backpack to buy this listing.")
      : translate("main.market.listingUnavailable", "Listing unavailable");
  }
  if (reason === "backpack-full") {
    if (action === "cancel") {
      return translate("main.market.cancelNeedsBackpackSpace", "Free one backpack slot before canceling this listing.");
    }
    return action === "buy"
      ? translate("main.market.buyBackpackFull", "Your backpack is full.")
      : translate("main.market.listingUnavailable", "Listing unavailable");
  }
  if (reason === "nck-token-missing") {
    return translate("main.market.nckTokenMissing", "Wallet has no NCK token account.");
  }
  if (reason === "self-purchase") {
    return translate("main.market.selfPurchase", "Cannot buy your own listing.");
  }
  if (reason === "listing-unavailable" || reason === "non-transferable-item" || reason === "equipment-not-custodied") {
    return translate("main.market.listingUnavailable", "Listing unavailable");
  }
  return String(reason || "not-submitted");
}

export function normalizeLandContractPurchaseQuantity(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,4}$/u.test(text)) return null;
  const quantity = Number(text);
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= LAND_CONTRACT_PURCHASE_MAX
    ? quantity
    : null;
}

export function normalizeMarketPriceInput(value, currency = "NCK") {
  const normalizedCurrency = currencyValue(currency, "NCK");
  const decimals = normalizedCurrency === "SOL" ? 9 : 6;
  const text = String(value ?? "").trim();
  if (text.length > 30) return null;
  if (!/^\d+(?:\.\d+)?$/u.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) return null;
  const scale = 10n ** BigInt(decimals);
  const amount = BigInt(whole) * scale + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (amount <= 0n || amount > 2n ** 64n - 1n) return null;
  return text;
}

export function compareMarketPriceValues(left, right) {
  const leftParts = marketDecimalParts(left);
  const rightParts = marketDecimalParts(right);
  if (!leftParts || !rightParts) return String(left ?? "").localeCompare(String(right ?? ""));
  const scale = Math.max(leftParts.scale, rightParts.scale);
  const leftAmount = leftParts.amount * 10n ** BigInt(scale - leftParts.scale);
  const rightAmount = rightParts.amount * 10n ** BigInt(scale - rightParts.scale);
  return leftAmount < rightAmount ? -1 : leftAmount > rightAmount ? 1 : 0;
}

export function marketListingMatchesQuery(listing, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return true;
  const item = listing?.itemSnapshot && typeof listing.itemSnapshot === "object" ? listing.itemSnapshot : {};
  const raw = listing?.rawListing && typeof listing.rawListing === "object" ? listing.rawListing : {};
  const sourceSlot = raw.sourceSlot && typeof raw.sourceSlot === "object" ? raw.sourceSlot : {};
  const resource = raw.sourceRecord || sourceSlot.resource || item.proof;
  const coordinates = resource && [resource.worldX, resource.worldY, resource.worldZ].every((value) => Number.isFinite(Number(value)))
    ? [resource.worldX, resource.worldY, resource.worldZ].map((value) => Math.trunc(Number(value)))
    : [];
  return [
    listing?.name,
    listing?.meta,
    listing?.category,
    listing?.currency,
    listing?.price,
    listing?.owner,
    listing?.listing,
    listing?.listingId,
    listing?.proof?.proofHash,
    item.resourceId,
    item.blockId,
    item.materialId,
    item.itemCode,
    item.chainItemId,
    item.itemPda,
    sourceSlot.itemCode,
    sourceSlot.itemId,
    coordinates.join(","),
    coordinates.join(", "),
    coordinates.join(" "),
  ]
    .filter((value) => value !== null && value !== undefined && value !== "")
    .some((value) => String(value).toLowerCase().includes(normalizedQuery));
}

function marketDecimalParts(value) {
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(String(value ?? "").trim());
  if (!match) return null;
  const fraction = match[2] || "";
  return {
    amount: BigInt(`${match[1]}${fraction}`),
    scale: fraction.length,
  };
}

function normalizeMarketMassGrams(value) {
  const mass = Number(value);
  return Number.isInteger(mass) && mass >= 0 && mass <= 0xffffffff ? mass : null;
}

function marketMaterialPreviewColor(material) {
  return ({
    carbon: [53, 50, 43],
    fiber: [171, 150, 82],
    polymer: [194, 130, 71],
    ceramic: [195, 136, 83],
    chemical: [191, 217, 183],
    glass: [104, 213, 239],
    crystal: [105, 235, 255],
    metal: [184, 199, 210],
    alloy: [153, 174, 190],
    composite: [82, 166, 151],
    wood: [169, 117, 70],
    stone: [141, 151, 160],
  })[material?.class] || [150, 170, 180];
}

function hash32(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function titleCase(value) {
  return String(value).replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);
}

function fallbackUi(_key, fallback, params = {}) {
  return formatMessage(fallback, params);
}

function formatMessage(template, params = {}) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) => Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match);
}
