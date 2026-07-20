import { loadPlayChainModule } from "./play-chain-adapter.js";

export const MARKET_LISTING_STORAGE_KEY = "nicechunk.play.marketListings.v1";
const MARKET_RULE_SET = "nicechunk-play-market-v1";
const MARKET_CATEGORIES = Object.freeze(["all", "raw", "equipment", "building", "clothing"]);
const MARKET_SORTS = Object.freeze(["newest", "oldest", "price-asc", "price-desc"]);
const MARKET_CURRENCIES = Object.freeze(["all", "NCK", "SOL"]);
const PAGE_SIZE = 12;
const CHAIN_REFRESH_COOLDOWN_MS = 12_000;

const SAMPLE_LISTINGS = Object.freeze([
  sampleListing("sample-stone", "Stone reserve", "Raw stone stack from public terrain", "raw", "NCK", "18.50", { kind: "resource", resourceId: 3, blockId: 3, count: 24 }),
  sampleListing("sample-pickaxe", "Workshop pickaxe", "Equipment preview listing", "equipment", "NCK", "42.00", { kind: "tool", itemId: "iron_pickaxe", durability: 740, maxDurability: 999 }),
  sampleListing("sample-brick", "Ceramic brick lot", "Smelted building material preview", "building", "NCK", "6.25", { kind: "smelted_material", materialId: "ceramic_brick", label: "Ceramic Brick", className: "Ceramic", count: 8, quality: 72, previewColor: [191, 111, 72] }),
  sampleListing("sample-fiber", "Travel cloak fiber", "Clothing material preview", "clothing", "NCK", "3.20", { kind: "resource", resourceId: 1, blockId: 28, count: 16 }),
]);

export function createPlayMarket({
  elements,
  gameState,
  createVoxelItemIconCanvas,
  resourceName,
  voxelItemLabel,
  getChainSnapshot = () => null,
  onStatus = () => {},
  onChanged = () => {},
} = {}) {
  const state = {
    listings: loadListings(),
    chainListings: [],
    chainLoading: false,
    chainError: "",
    lastChainRefreshAt: 0,
    activeTab: "browse",
    selectedCategory: "all",
    selectedSort: "newest",
    selectedCurrency: "all",
    selectedItemId: "",
    page: { browse: 1, orders: 1 },
  };

  const api = {
    bind() {
      elements.marketButton?.addEventListener("click", api.togglePanel);
      elements.closeMarket?.addEventListener("click", api.closePanel);
      elements.marketRefresh?.addEventListener("click", () => {
        state.listings = loadListings();
        api.refreshChainListings({ force: true, quiet: false });
        showMarketStatus("Listings refreshed from local storage. Chain listings are loading in the background.");
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
      elements.marketCategoryButtons?.forEach((button) => button.addEventListener("click", () => {
        state.selectedCategory = MARKET_CATEGORIES.includes(button.dataset.marketCategory) ? button.dataset.marketCategory : "all";
        resetAndRender();
      }));
      elements.marketInventoryGrid?.addEventListener("click", handleInventoryClick);
      elements.marketListingGrid?.addEventListener("click", handleListingAction);
      elements.marketOrdersGrid?.addEventListener("click", handleListingAction);
      elements.marketListingForm?.addEventListener("submit", createListing);
      elements.marketListingPrice?.addEventListener("input", renderDraft);
      elements.marketListingCategory?.addEventListener("change", renderDraft);
      elements.marketListingCurrency?.addEventListener("change", renderDraft);
    },
    render,
    refreshChainListings,
    openPanel,
    closePanel,
    togglePanel,
    isOpen: () => Boolean(elements.marketPanel && !elements.marketPanel.hidden),
  };

  function togglePanel() {
    if (api.isOpen()) closePanel();
    else openPanel();
  }

  function openPanel() {
    if (!elements.marketPanel) return;
    elements.marketPanel.hidden = false;
    state.listings = loadListings();
    render();
    refreshChainListings({ quiet: true });
    onStatus("Market opened. Chain listings use PDA state when wallet/RPC are available.");
  }

  function closePanel() {
    if (elements.marketPanel) elements.marketPanel.hidden = true;
  }

  function selectTab(tabName) {
    state.activeTab = ["browse", "sell", "orders"].includes(tabName) ? tabName : "browse";
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
    syncFilters();
    renderBrowse();
    renderInventory();
    renderOrders();
    renderDraft();
  }

  function syncHeader() {
    const chain = getChainSnapshot?.() || {};
    if (elements.marketWallet) elements.marketWallet.textContent = chain.walletShort || "Local wallet";
    if (elements.marketBackpack) elements.marketBackpack.textContent = `${gameState.backpackSlots.length} / 50`;
  }

  function syncTabs() {
    elements.marketTabs?.forEach((button) => {
      const active = button.dataset.marketTab === state.activeTab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    elements.marketTabPanels?.forEach((panel) => {
      const active = panel.dataset.marketTabPanel === state.activeTab;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
  }

  function syncFilters() {
    if (elements.marketSort) elements.marketSort.value = state.selectedSort;
    if (elements.marketCurrencyFilter) elements.marketCurrencyFilter.value = state.selectedCurrency;
    elements.marketCategoryButtons?.forEach((button) => button.classList.toggle("active", button.dataset.marketCategory === state.selectedCategory));
  }

  function renderBrowse() {
    if (!elements.marketListingGrid) return;
    const listings = paginate(sortListings(filterListings(browseListings())), "browse");
    elements.marketSearchMeta && (elements.marketSearchMeta.textContent = marketSearchMeta(listings.total));
    if (!listings.items.length) {
      elements.marketListingGrid.replaceChildren(emptyState("No listings", "Try another category, currency, or search term."));
    } else {
      elements.marketListingGrid.replaceChildren(...listings.items.map((listing) => listingCard(listing, false)));
    }
    renderPager(elements.marketListingPager, listings, "browse");
  }

  function renderOrders() {
    if (!elements.marketOrdersGrid) return;
    const own = paginate(sortListings(filterListings([...chainOwnListings(), ...activeListings()])), "orders");
    if (!own.items.length) {
      elements.marketOrdersGrid.replaceChildren(emptyState("No active orders", "Create a listing from backpack items in the Sell tab."));
    } else {
      elements.marketOrdersGrid.replaceChildren(...own.items.map((listing) => listingCard(listing, true)));
    }
    renderPager(elements.marketOrdersPager, own, "orders");
  }

  function renderInventory() {
    if (!elements.marketInventoryGrid) return;
    const items = marketInventoryItems();
    if (!items.length) {
      elements.marketInventoryGrid.replaceChildren(emptyState("No listable items", "Confirmed backpack resources and smelted materials can be listed."));
      return;
    }
    elements.marketInventoryGrid.replaceChildren(...items.map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "market-inventory-item";
      button.classList.toggle("selected", item.id === state.selectedItemId);
      button.dataset.itemId = item.id;
      button.append(createVoxelItemIconCanvas(item.slot, { size: 40 }));
      const copy = document.createElement("span");
      copy.innerHTML = `<strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(categoryLabel(item.category))} · ${escapeHtml(item.meta)}</small>`;
      button.append(copy);
      return button;
    }));
  }

  function renderDraft() {
    const item = selectedInventoryItem();
    if (elements.marketSelectedItem) elements.marketSelectedItem.textContent = item ? item.name : "No item selected";
    if (elements.marketListingCategory && item && !elements.marketListingCategory.value) elements.marketListingCategory.value = item.category;
    const price = Number(elements.marketListingPrice?.value);
    const validPrice = Number.isFinite(price) && price > 0;
    if (elements.marketCreateListing) elements.marketCreateListing.disabled = !item || !validPrice;
    if (elements.marketFormStatus) {
      elements.marketFormStatus.textContent = item
        ? validPrice
          ? `Ready to list ${item.name}. The listing will lock one stack locally and store proof data.`
          : "Set a positive price before creating the listing."
        : "Select an item, set category and price, then create a chain-ready listing.";
    }
  }

  function handleInventoryClick(event) {
    const button = event.target.closest("button[data-item-id]");
    if (!button) return;
    state.selectedItemId = button.dataset.itemId || "";
    const item = selectedInventoryItem();
    if (item && elements.marketListingCategory) elements.marketListingCategory.value = item.category;
    render();
  }

  function handleListingAction(event) {
    const button = event.target.closest("button[data-market-action]");
    if (!button) return;
    const listingId = button.dataset.listingId || "";
    const action = button.dataset.marketAction || "";
    if (action === "cancel") cancelListing(listingId);
    if (action === "buy") buyListing(listingId);
  }

  async function createListing(event) {
    event.preventDefault();
    const item = selectedInventoryItem();
    const price = Number(elements.marketListingPrice?.value);
    if (!item || !Number.isFinite(price) || price <= 0) {
      showMarketStatus("Select an item and a positive price first.", "warn");
      return;
    }
    const category = categoryValue(elements.marketListingCategory?.value || item.category);
    const currency = currencyValue(elements.marketListingCurrency?.value || "NCK", "NCK");
    if (isChainBackpackItem(item)) {
      await createChainListing(item, { category, currency, price });
      return;
    }

    const consumed = gameState.consumeBackpackItems([{ id: item.slot.id, count: item.slot.count }]);
    if (!consumed.ok) {
      showMarketStatus(consumed.reason || "Could not lock selected item.", "warn");
      return;
    }
    const listing = normalizeListing({
      id: createListingId(item.slot.id),
      source: "local",
      owner: "local-session",
      status: "active",
      name: item.name,
      meta: item.meta,
      category,
      currency,
      price: price.toFixed(currency === "SOL" ? 6 : 2),
      itemSnapshot: consumed.consumed[0],
      createdAt: Date.now(),
      proof: createMarketProof({ item: consumed.consumed[0], category, currency, price }),
    });
    state.listings.unshift(listing);
    saveListings(state.listings);
    state.selectedItemId = "";
    if (elements.marketListingPrice) elements.marketListingPrice.value = "";
    selectTab("orders");
    showMarketStatus(`Created local listing ${listing.proof.proofHash}. Item is locked until cancellation or chain settlement.`);
    onChanged();
    onStatus(`Market listing created: ${listing.name} for ${listing.price} ${listing.currency}.`);
  }

  async function createChainListing(item, { category, currency, price }) {
    try {
      showMarketStatus(`Submitting ${item.name} listing to chain...`);
      const module = await loadPlayChainModule();
      if (typeof module.createMarketListingOnChain !== "function") {
        showMarketStatus("Chain market listing is unavailable in the loaded chain module.", "warn");
        return null;
      }
      const result = await module.createMarketListingOnChain({
        item: {
          source: "backpack",
          backpack: item.slot.chainBackpack,
          slotIndex: item.slot.chainIndex,
          category,
        },
        currency,
        price,
        backpackAddress: item.slot.chainBackpack,
      });
      if (!result?.submitted) {
        showMarketStatus(`Chain listing skipped: ${result?.reason || "not-submitted"}.`, "warn");
        return result;
      }
      showMarketStatus(`Chain listing submitted ${shortSignature(result.signature)}.`);
      await refreshChainListings({ force: true, quiet: true });
      onChanged();
      onStatus(`Market listing submitted on chain: ${item.name} for ${price} ${currency}.`);
      return result;
    } catch (error) {
      showMarketStatus(`Chain listing failed: ${readableError(error)}.`, "warn");
      return null;
    }
  }

  async function cancelListing(listingId) {
    const listing = state.listings.find((entry) => entry.id === listingId && entry.status === "active");
    if (!listing) {
      const chainListing = state.chainListings.find((entry) => entry.id === listingId && entry.status === "active");
      return chainListing ? cancelChainListing(chainListing) : null;
    }
    const returned = gameState.addBackpackSlotSnapshot(listing.itemSnapshot);
    if (!returned) {
      showMarketStatus("Backpack is full. Cannot cancel until there is free space.", "warn");
      return;
    }
    listing.status = "canceled";
    listing.canceledAt = Date.now();
    saveListings(state.listings);
    showMarketStatus(`Canceled listing ${listing.proof?.proofHash || listing.id}. Item returned to backpack.`);
    onChanged();
    render();
  }

  async function cancelChainListing(listing) {
    try {
      showMarketStatus(`Canceling chain listing ${listing.proof?.proofHash || listing.id}...`);
      const module = await loadPlayChainModule();
      if (typeof module.cancelMarketListingOnChain !== "function") {
        showMarketStatus("Chain market cancellation is unavailable in the loaded chain module.", "warn");
        return null;
      }
      const result = await module.cancelMarketListingOnChain({
        listing: listing.listing,
        listingId: listing.listingId,
      });
      if (!result?.submitted) {
        showMarketStatus(`Cancel skipped: ${result?.reason || "not-submitted"}.`, "warn");
        return result;
      }
      showMarketStatus(`Chain listing canceled ${shortSignature(result.signature)}.`);
      await refreshChainListings({ force: true, quiet: true });
      onChanged();
      return result;
    } catch (error) {
      showMarketStatus(`Cancel failed: ${readableError(error)}.`, "warn");
      return null;
    }
  }

  async function buyListing(listingId) {
    const listing = state.chainListings.find((entry) => entry.id === listingId && entry.status === "active");
    if (!listing) {
      showMarketStatus("Sample listings are previews only. Refresh chain listings to buy real PDA orders.", "warn");
      return null;
    }
    const buyerBackpackAddress = getChainSnapshot?.()?.chainBackpack?.backpackAddress || "";
    if (!buyerBackpackAddress) {
      showMarketStatus("Equip or create a chain backpack before buying from the market.", "warn");
      return null;
    }
    try {
      showMarketStatus(`Buying ${listing.name} from chain market...`);
      const module = await loadPlayChainModule();
      if (typeof module.buyMarketListingOnChain !== "function") {
        showMarketStatus("Chain market buying is unavailable in the loaded chain module.", "warn");
        return null;
      }
      const result = await module.buyMarketListingOnChain({
        listing: listing.rawListing || listing,
        buyerBackpackAddress,
      });
      if (!result?.submitted) {
        showMarketStatus(`Buy skipped: ${result?.reason || "not-submitted"}.`, "warn");
        return result;
      }
      showMarketStatus(`Buy submitted ${shortSignature(result.signature)}.`);
      await refreshChainListings({ force: true, quiet: true });
      onChanged();
      onStatus(`Bought ${listing.name} from chain market.`);
      return result;
    } catch (error) {
      showMarketStatus(`Buy failed: ${readableError(error)}.`, "warn");
      return null;
    }
  }

  async function refreshChainListings({ force = false, quiet = true } = {}) {
    const now = performance.now();
    if (state.chainLoading) return { ok: false, reason: "already-loading" };
    if (!force && now - state.lastChainRefreshAt < CHAIN_REFRESH_COOLDOWN_MS) return { ok: false, reason: "cooldown" };
    state.chainLoading = true;
    render();
    try {
      const module = await loadPlayChainModule();
      if (typeof module.fetchMarketListingsPageOnChain !== "function") {
        state.chainError = "market-listings-unavailable";
        if (!quiet) showMarketStatus("Chain market listing query is unavailable in the loaded chain module.", "warn");
        return { ok: false, reason: state.chainError };
      }
      const result = await module.fetchMarketListingsPageOnChain({
        page: 1,
        pageSize: 100,
        state: "active",
        category: state.selectedCategory,
        currency: state.selectedCurrency,
        query: searchQuery(),
        sort: state.selectedSort,
      });
      state.chainListings = (Array.isArray(result?.items) ? result.items : [])
        .map((listing) => normalizeChainListing(listing, getChainSnapshot?.()?.walletAddress || ""))
        .filter(Boolean);
      state.chainError = "";
      state.lastChainRefreshAt = performance.now();
      if (!quiet) showMarketStatus(`Loaded ${state.chainListings.length} chain market listings.`);
      render();
      return { ok: true, count: state.chainListings.length };
    } catch (error) {
      state.chainError = readableError(error);
      if (!quiet) showMarketStatus(`Chain market refresh failed: ${state.chainError}.`, "warn");
      return { ok: false, reason: state.chainError };
    } finally {
      state.chainLoading = false;
      render();
    }
  }

  function marketInventoryItems() {
    return gameState.backpackSlots
      .filter((slot) => slot && !slot.pending)
      .map((slot) => ({
        id: slot.id,
        slot,
        name: itemName(slot),
        category: categoryForSlot(slot),
        meta: itemMeta(slot),
      }))
      .filter((item) => filterInventoryItem(item));
  }

  function selectedInventoryItem() {
    return marketInventoryItems().find((item) => item.id === state.selectedItemId) || null;
  }

  function activeListings() {
    return state.listings.filter((entry) => entry.status === "active");
  }

  function browseListings() {
    const realListings = [...state.chainListings, ...activeListings()];
    return realListings.length ? realListings : [...SAMPLE_LISTINGS, ...activeListings()];
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
      if (!query) return true;
      return [listing.name, listing.meta, listing.category, listing.currency, listing.price, listing.proof?.proofHash].join(" ").toLowerCase().includes(query);
    });
  }

  function filterInventoryItem(item) {
    const query = searchQuery();
    if (state.selectedCategory !== "all" && item.category !== state.selectedCategory) return false;
    if (!query) return true;
    return [item.name, item.meta, item.category].join(" ").toLowerCase().includes(query);
  }

  function sortListings(listings) {
    const sorted = [...listings];
    sorted.sort((a, b) => {
      if (state.selectedSort === "oldest") return a.createdAt - b.createdAt;
      if (state.selectedSort === "price-asc") return Number(a.price) - Number(b.price);
      if (state.selectedSort === "price-desc") return Number(b.price) - Number(a.price);
      return b.createdAt - a.createdAt;
    });
    return sorted;
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
    const prev = document.createElement("button");
    prev.type = "button";
    prev.textContent = "Prev";
    prev.disabled = page.page <= 1;
    prev.addEventListener("click", () => { state.page[tabName] -= 1; render(); });
    const label = document.createElement("span");
    label.textContent = `${page.page} / ${page.totalPages}`;
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "Next";
    next.disabled = page.page >= page.totalPages;
    next.addEventListener("click", () => { state.page[tabName] += 1; render(); });
    container.append(prev, label, next);
  }

  function listingCard(listing, orderTab) {
    const wallet = String(getChainSnapshot?.()?.walletAddress || "");
    const card = document.createElement("article");
    card.className = "market-listing-card";
    card.classList.toggle("own", listing.source === "local" || (wallet && listing.owner === wallet));
    card.append(createVoxelItemIconCanvas(listing.itemSnapshot || {}, { size: 46 }));
    const copy = document.createElement("div");
    copy.className = "market-listing-copy";
    copy.innerHTML = `<strong>${escapeHtml(listing.name)}</strong><span>${escapeHtml(categoryLabel(listing.category))} · ${escapeHtml(listing.meta)}</span><small>${escapeHtml(listing.proof?.proofHash || "sample")}</small>`;
    const price = document.createElement("b");
    price.className = "market-listing-price";
    price.textContent = `${listing.price} ${listing.currency}`;
    const action = document.createElement("button");
    action.type = "button";
    action.dataset.listingId = listing.id;
    if (listing.source === "local" || orderTab || (wallet && listing.owner === wallet)) {
      action.dataset.marketAction = "cancel";
      action.textContent = "Cancel";
    } else if (listing.source === "chain") {
      action.dataset.marketAction = "buy";
      action.textContent = "Buy";
    } else {
      action.dataset.marketAction = "buy";
      action.textContent = "Preview";
    }
    card.append(copy, price, action);
    return card;
  }

  function emptyState(title, body) {
    const node = document.createElement("div");
    node.className = "market-empty";
    node.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span>`;
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

  function marketSearchMeta(total) {
    const loading = state.chainLoading ? " · chain loading" : "";
    const error = state.chainError ? ` · chain: ${state.chainError}` : "";
    return `${total} listings · ${categoryLabel(state.selectedCategory)} · ${currencyLabel(state.selectedCurrency)}${loading}${error}`;
  }

  return api;
}

function sampleListing(id, name, meta, category, currency, price, itemSnapshot) {
  return Object.freeze({
    id,
    source: "sample",
    owner: "sample",
    status: "active",
    name,
    meta,
    category,
    currency,
    price,
    itemSnapshot,
    createdAt: 1700000000000,
    proof: { ruleSet: MARKET_RULE_SET, proofHash: `sample:${id}` },
  });
}

function loadListings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MARKET_LISTING_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeListing).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveListings(listings) {
  try {
    localStorage.setItem(MARKET_LISTING_STORAGE_KEY, JSON.stringify(listings.map(normalizeListing).filter(Boolean)));
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

function normalizeListing(listing) {
  if (!listing || typeof listing !== "object") return null;
  const id = String(listing.id || "");
  const itemSnapshot = listing.itemSnapshot && typeof listing.itemSnapshot === "object" ? { ...listing.itemSnapshot } : null;
  if (!id || !itemSnapshot) return null;
  return {
    id,
    source: listing.source === "chain" ? "chain" : listing.source === "local" ? "local" : "sample",
    owner: String(listing.owner || "local-session"),
    status: listing.status === "canceled" ? "canceled" : "active",
    name: String(listing.name || "Listing"),
    meta: String(listing.meta || "Chain-ready item"),
    category: categoryValue(listing.category),
    currency: currencyValue(listing.currency, "NCK"),
    price: String(listing.price || "0"),
    itemSnapshot,
    createdAt: Number.isFinite(listing.createdAt) ? Math.trunc(listing.createdAt) : Date.now(),
    canceledAt: Number.isFinite(listing.canceledAt) ? Math.trunc(listing.canceledAt) : null,
    proof: listing.proof && typeof listing.proof === "object" ? listing.proof : createMarketProof({ item: itemSnapshot, category: listing.category, currency: listing.currency, price: listing.price }),
    listing: listing.listing || null,
    listingId: listing.listingId || null,
    rawListing: listing.rawListing || null,
  };
}

function normalizeChainListing(listing, walletAddress = "") {
  if (!listing || typeof listing !== "object") return null;
  const sourceSlot = listing.sourceSlot && typeof listing.sourceSlot === "object" ? listing.sourceSlot : null;
  const sourceRecord = listing.sourceRecord && typeof listing.sourceRecord === "object" ? listing.sourceRecord : sourceSlot?.resource;
  const blockId = Math.trunc(Number(sourceRecord?.blockId) || 0);
  const count = Math.max(1, Math.trunc(Number(listing.quantity || sourceSlot?.quantity) || 1));
  const itemSnapshot = sourceSlot?.kind === "item"
    ? {
        kind: "tool",
        itemId: sourceSlot.itemId || "chain_item",
        count,
        durability: Math.trunc(Number(sourceSlot.durabilityCurrent) || 0),
        maxDurability: Math.trunc(Number(sourceSlot.durabilityMax) || 0),
        quality: Math.trunc(Number(sourceSlot.qualityBps) || 0),
      }
    : {
        kind: "resource",
        resourceId: Math.trunc(Number(listing.resourceId) || blockId || 0),
        blockId,
        count,
        pending: false,
        proof: sourceRecord ? {
          worldX: Math.trunc(Number(sourceRecord.worldX) || 0),
          worldY: Math.trunc(Number(sourceRecord.worldY) || 0),
          worldZ: Math.trunc(Number(sourceRecord.worldZ) || 0),
          blockId,
        } : null,
      };
  return normalizeListing({
    id: String(listing.listing || listing.listingId || ""),
    source: "chain",
    owner: String(listing.seller || ""),
    status: listing.stateLabel === "active" ? "active" : "canceled",
    name: chainListingName(listing, itemSnapshot),
    meta: chainListingMeta(listing, itemSnapshot, walletAddress),
    category: listing.category,
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

function isChainBackpackItem(item) {
  const source = String(item?.slot?.source || "");
  return Boolean(
    item?.slot
      && (source === "chain" || source === "chain-backpack")
      && item.slot.chainBackpack
      && Number.isInteger(item.slot.chainIndex),
  );
}

function chainListingName(listing, itemSnapshot) {
  if (listing?.sourceSlot?.kind === "item") {
    return titleCase(listing.sourceSlot.itemId || "Equipment");
  }
  if (Number.isFinite(itemSnapshot?.blockId) && itemSnapshot.blockId > 0) {
    return `Block #${itemSnapshot.blockId}`;
  }
  if (Number.isFinite(itemSnapshot?.resourceId) && itemSnapshot.resourceId > 0) {
    return resourceNameFallback(itemSnapshot.resourceId);
  }
  return "Chain listing";
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

function createListingId(slotId) {
  return `listing-${Date.now().toString(36)}-${hash32(slotId).toString(36)}`;
}

function categoryForSlot(slot) {
  if (slot?.kind === "smelted_material") return "building";
  if (slot?.kind === "tool" || slot?.itemId) return "equipment";
  return "raw";
}

function itemName(slot) {
  if (slot?.kind === "smelted_material") return slot.label || titleCase(slot.materialId || "Material");
  if (slot?.kind === "forged" || slot?.itemId === "forged_item") return "Forged Tool";
  if (slot?.kind === "tool" || slot?.itemId === "iron_pickaxe") return "Pickaxe";
  if (Number.isFinite(slot?.resourceId)) return resourceNameFallback(slot.resourceId);
  if (Number.isFinite(slot?.blockId)) return `Block #${slot.blockId}`;
  return "Item";
}

function itemMeta(slot) {
  if (slot?.kind === "smelted_material") return `${slot.count} items · Q${slot.quality || 0}`;
  if (slot?.kind === "forged" || slot?.itemId === "forged_item") return `Durability ${Math.max(0, Math.trunc(slot.durability || 0))}/${Math.max(1, Math.trunc(slot.maxDurability || 1))}`;
  if (Number.isFinite(slot?.resourceId)) return `${slot.count} items · resource ${slot.resourceId}`;
  return `${slot?.count || 1} item`;
}

function categoryLabel(category) {
  return ({ all: "All", raw: "Raw Materials", equipment: "Equipment", building: "Building Materials", clothing: "Clothing" })[category] || "All";
}

function currencyLabel(currency) {
  return currency === "all" ? "All currencies" : currencyValue(currency, "NCK");
}

function categoryValue(value) {
  return MARKET_CATEGORIES.includes(value) && value !== "all" ? value : "raw";
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
