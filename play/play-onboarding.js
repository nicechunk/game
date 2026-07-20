import { initI18n, t } from "/src/i18n.js";

const NETWORK_FEE_SOL = 0.000005;
const SESSION_TOP_UP_SOL = 0.1;
const RENT_ACCOUNT_BYTES = Object.freeze({
  equipment: 7040,
  session: 184,
  foundation: 160,
  smelting: 128,
  market: 216,
});
const RPC_OVERRIDE_KEY = "nicechunk.devnetRpcUrl";
const HELIUS_KEY = "nicechunk.heliusApiKey";
const DEFAULT_RPC_URL = "https://explorer-api.devnet.solana.com";
const rentCache = new Map();
let activeSession = null;

export async function openOnboarding({ feature, scope = "play", walletAddress = "guest" } = {}) {
  if (!guideFeatures().includes(feature)) return false;
  if (activeSession) activeSession.finish("later");
  await initI18n(document);

  return new Promise((resolve) => {
    const session = createSession({ feature, scope, walletAddress, resolve });
    activeSession = session;
    session.mount();
  });
}

function createSession({ feature, scope, walletAddress, resolve }) {
  const mobile = matchMedia("(pointer: coarse), (max-width: 760px)").matches;
  const definition = guideDefinition(feature, mobile);
  const previousFocus = document.activeElement;
  let root = null;
  let stepIndex = 0;
  let completed = false;
  let resizeFrame = 0;
  let rentValue = null;
  let rentState = RENT_ACCOUNT_BYTES[feature] ? "loading" : "none";
  const layoutObserver = new MutationObserver((mutations) => {
    if (root && mutations.every((mutation) => root.contains(mutation.target))) return;
    schedulePosition();
  });

  return { mount, finish };

  function mount() {
    root = document.createElement("div");
    root.className = "nc-onboarding";
    root.dataset.feature = feature;
    root.dataset.scope = scope;
    root.dataset.mobile = String(mobile);
    root.innerHTML = shellMarkup();
    document.body.append(root);
    root.querySelector("[data-onboarding-later]").addEventListener("click", handleLater);
    root.querySelector("[data-onboarding-skip]").addEventListener("click", () => finish("skip"));
    root.querySelector("[data-onboarding-primary]").addEventListener("click", handlePrimary);
    root.querySelector("[data-onboarding-close]").addEventListener("click", handleLater);
    root.addEventListener("keydown", handleKeyDown);
    layoutObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "aria-selected", "class", "style"] });
    addEventListener("resize", schedulePosition, { passive: true });
    addEventListener("scroll", schedulePosition, { passive: true, capture: true });
    addEventListener("nicechunk:languagechange", render);
    render();
    requestAnimationFrame(() => {
      root?.classList.add("is-visible");
      root?.querySelector("[data-onboarding-primary]")?.focus({ preventScroll: true });
    });
    if (RENT_ACCOUNT_BYTES[feature]) void loadRent();
  }

  function shellMarkup() {
    return `
      <div class="nc-onboarding-curtains" aria-hidden="true">
        <i data-curtain="top"></i><i data-curtain="right"></i><i data-curtain="bottom"></i><i data-curtain="left"></i>
      </div>
      <div class="nc-onboarding-focus-layer" aria-hidden="true"></div>
      <svg class="nc-onboarding-connector" aria-hidden="true"><path></path><circle r="3"></circle></svg>
      <section class="nc-onboarding-card" role="dialog" aria-modal="true" tabindex="-1">
        <span class="nc-onboarding-glass-glow" aria-hidden="true"></span>
        <header class="nc-onboarding-header">
          <div><span data-onboarding-eyebrow></span><strong data-onboarding-title></strong></div>
          <button type="button" data-onboarding-close><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10m0-10L5 15"/></svg></button>
        </header>
        <div class="nc-onboarding-step-rail" data-onboarding-step-rail></div>
        <div class="nc-onboarding-content">
          <div class="nc-onboarding-step-icon" data-onboarding-step-icon aria-hidden="true"></div>
          <div class="nc-onboarding-copy"><h2 data-onboarding-step-title></h2><p data-onboarding-step-body></p></div>
        </div>
        <div class="nc-onboarding-flow" data-onboarding-flow hidden></div>
        <div class="nc-onboarding-warning" data-onboarding-warning hidden><span aria-hidden="true">!</span><p></p></div>
        <div class="nc-onboarding-cost" data-onboarding-cost hidden></div>
        <p class="nc-onboarding-live-note" data-onboarding-live-note hidden></p>
        <footer class="nc-onboarding-footer">
          <label class="nc-onboarding-never"><input type="checkbox" data-onboarding-never /><span data-onboarding-never-label></span></label>
          <span class="nc-onboarding-count" data-onboarding-count></span>
          <div class="nc-onboarding-actions">
            <button class="nc-onboarding-skip" type="button" data-onboarding-skip></button>
            <button class="nc-onboarding-later" type="button" data-onboarding-later></button>
            <button class="nc-onboarding-primary" type="button" data-onboarding-primary></button>
          </div>
        </footer>
      </section>`;
  }

  function render() {
    if (!root) return;
    const step = definition.steps[stepIndex];
    root.querySelector(".nc-onboarding-card").setAttribute("aria-label", tr("dialogAria", { feature: tr(`features.${feature}.title`) }));
    root.querySelector("[data-onboarding-close]").setAttribute("aria-label", tr("close"));
    setText("[data-onboarding-eyebrow]", tr(`features.${feature}.eyebrow`));
    setText("[data-onboarding-title]", tr(`features.${feature}.title`));
    setText("[data-onboarding-step-title]", tr(step.title));
    setText("[data-onboarding-step-body]", tr(step.body));
    setText("[data-onboarding-count]", tr("stepCount", { current: stepIndex + 1, total: definition.steps.length }));
    setText("[data-onboarding-never-label]", tr("dontShowAgain"));
    setText("[data-onboarding-skip]", tr("skip"));
    setText("[data-onboarding-later]", tr("later"));
    setText("[data-onboarding-primary]", tr(stepIndex === definition.steps.length - 1 ? "finish" : "next"));
    renderStepIcon(step);
    renderRail();
    renderFlow(step);
    renderWarning(step);
    renderCosts();
    schedulePosition();
  }

  function renderRail() {
    const rail = root.querySelector("[data-onboarding-step-rail]");
    rail.replaceChildren(...definition.steps.map((step, index) => {
      const item = document.createElement("span");
      item.className = index === stepIndex ? "is-active" : index < stepIndex ? "is-complete" : "";
      item.innerHTML = `<b>${index + 1}</b><i></i>`;
      item.setAttribute("aria-label", tr("stepLabel", { current: index + 1, label: tr(step.short) }));
      item.title = tr(step.short);
      return item;
    }));
  }

  function renderStepIcon(step) {
    const icon = root.querySelector("[data-onboarding-step-icon]");
    const glyph = tr(step.glyph);
    icon.dataset.kind = step.icon || "guide";
    icon.textContent = glyph;
  }

  function renderFlow(step) {
    const flow = root.querySelector("[data-onboarding-flow]");
    const flowKeys = step.flow || definition.flow;
    flow.hidden = !flowKeys?.length;
    if (flow.hidden) {
      flow.replaceChildren();
      return;
    }
    flow.replaceChildren(...flowKeys.flatMap((key, index) => {
      const chip = document.createElement("span");
      chip.textContent = tr(key);
      if (index === flowKeys.length - 1) return [chip];
      const arrow = document.createElement("i");
      arrow.textContent = "→";
      arrow.setAttribute("aria-hidden", "true");
      return [chip, arrow];
    }));
  }

  function renderWarning(step) {
    const warning = root.querySelector("[data-onboarding-warning]");
    const key = step.warning || definition.warning;
    warning.hidden = !key;
    if (key) warning.querySelector("p").textContent = tr(key);
  }

  function renderCosts() {
    if (!root) return;
    const rows = costRows(feature);
    const panel = root.querySelector("[data-onboarding-cost]");
    const note = root.querySelector("[data-onboarding-live-note]");
    panel.hidden = rows.length === 0;
    note.hidden = rows.length === 0;
    if (!rows.length) return;
    const title = document.createElement("strong");
    title.textContent = tr("costEstimate");
    const list = document.createElement("dl");
    rows.forEach((row) => {
      const line = document.createElement("div");
      const label = document.createElement("dt");
      const value = document.createElement("dd");
      label.textContent = tr(row.label);
      value.textContent = costValue(row);
      line.append(label, value);
      list.append(line);
    });
    panel.replaceChildren(title, list);
    note.textContent = tr("liveValuesNote");
  }

  function costValue(row) {
    if (row.kind === "rent") {
      if (rentState === "loading") return tr("checkingFee");
      if (rentState === "error" || rentValue === null) return tr("feeUnavailable");
      return tr("solValue", { value: formatSol(rentValue) });
    }
    if (row.kind === "network") return tr("approxSolValue", { value: formatSol(NETWORK_FEE_SOL) });
    if (row.kind === "session") return tr("solValue", { value: formatSol(SESSION_TOP_UP_SOL) });
    if (row.kind === "percent") return tr("percentValue", { value: row.value });
    return tr(row.value);
  }

  async function loadRent() {
    try {
      rentValue = await minimumRent(RENT_ACCOUNT_BYTES[feature]);
      rentState = "ready";
    } catch (error) {
      rentState = "error";
      console.warn("NiceChunk onboarding fee estimate unavailable:", error);
    }
    renderCosts();
  }

  function handlePrimary() {
    if (stepIndex < definition.steps.length - 1) {
      stepIndex += 1;
      render();
      return;
    }
    finish("complete");
  }

  function handleLater() {
    const never = root?.querySelector("[data-onboarding-never]")?.checked;
    finish(never ? "complete" : "later");
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      handleLater();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...root.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex="0"]')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function schedulePosition() {
    if (resizeFrame || !root) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      positionFocus();
    });
  }

  function positionFocus() {
    if (!root) return;
    const step = definition.steps[stepIndex];
    const rects = targetRects(step, mobile);
    const layer = root.querySelector(".nc-onboarding-focus-layer");
    layer.replaceChildren(...rects.map((rect) => focusFrame(rect, step)));
    const union = unionRect(rects);
    positionCurtains(union);
    positionConnector(union);
  }

  function focusFrame(rect, step) {
    const frame = document.createElement("span");
    frame.className = "nc-onboarding-focus";
    if (rect.top < 42) frame.classList.add("is-edge-top");
    frame.style.left = `${rect.left}px`;
    frame.style.top = `${rect.top}px`;
    frame.style.width = `${rect.width}px`;
    frame.style.height = `${rect.height}px`;
    if (step.callout) {
      const label = document.createElement("b");
      label.textContent = tr(step.callout);
      frame.append(label);
    }
    return frame;
  }

  function positionCurtains(rect) {
    const width = innerWidth;
    const height = innerHeight;
    const top = clamp(rect.top, 0, height);
    const left = clamp(rect.left, 0, width);
    const right = clamp(rect.right, 0, width);
    const bottom = clamp(rect.bottom, 0, height);
    setCurtain("top", 0, 0, width, top);
    setCurtain("right", right, top, Math.max(0, width - right), Math.max(0, bottom - top));
    setCurtain("bottom", 0, bottom, width, Math.max(0, height - bottom));
    setCurtain("left", 0, top, left, Math.max(0, bottom - top));
  }

  function setCurtain(name, left, top, width, height) {
    const curtain = root.querySelector(`[data-curtain="${name}"]`);
    curtain.style.left = `${left}px`;
    curtain.style.top = `${top}px`;
    curtain.style.width = `${width}px`;
    curtain.style.height = `${height}px`;
  }

  function positionConnector(target) {
    const svg = root.querySelector(".nc-onboarding-connector");
    const card = root.querySelector(".nc-onboarding-card").getBoundingClientRect();
    const startX = target.left + target.width / 2;
    const startY = target.top + target.height / 2;
    const endX = clamp(startX, card.left + 12, card.right - 12);
    const endY = startY < card.top ? card.top : startY > card.bottom ? card.bottom : clamp(startY, card.top + 12, card.bottom - 12);
    const midX = startX + (endX - startX) * 0.52;
    svg.querySelector("path").setAttribute("d", `M ${startX} ${startY} L ${midX} ${startY} L ${endX} ${endY}`);
    svg.querySelector("circle").setAttribute("cx", String(startX));
    svg.querySelector("circle").setAttribute("cy", String(startY));
  }

  function setText(selector, value) {
    const element = root.querySelector(selector);
    if (element) element.textContent = value;
  }

  function finish(result) {
    if (completed) return;
    completed = true;
    cancelAnimationFrame(resizeFrame);
    layoutObserver.disconnect();
    removeEventListener("resize", schedulePosition);
    removeEventListener("scroll", schedulePosition, { capture: true });
    removeEventListener("nicechunk:languagechange", render);
    root?.classList.remove("is-visible");
    const finishedRoot = root;
    root = null;
    setTimeout(() => finishedRoot?.remove(), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180);
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    if (activeSession?.finish === finish) activeSession = null;
    resolve(result);
  }
}

function guideDefinition(feature, mobile) {
  const basics = mobile ? [
    step("basics.steps.move", "controlMove", "move", ["#joystick"]),
    step("basics.steps.lookMobile", "controlSwipe", "look", ["#worldCanvas"]),
    step("basics.steps.toolMobile", "controlTap", "tool", ["#hotbar"]),
  ] : [
    step("basics.steps.move", "controlMove", "move", []),
    step("basics.steps.look", "controlLook", "look", ["#worldCanvas"]),
    step("basics.steps.select", "controlSelect", "select", ["#worldCanvas"]),
    step("basics.steps.firstPerson", "controlFirstPerson", "camera", ["#worldCanvas"]),
  ];
  const definitions = {
    basics: { steps: basics },
    equipment: {
      flow: ["features.equipment.flow.backpack", "features.equipment.flow.pda", "features.equipment.flow.avatar"],
      steps: [
        step("equipment.steps.choose", "controlChoose", "inventory", ['#profileEquipmentBrowserList .profile-equipment-item[data-slot-state="equipped"]']),
        step("equipment.steps.equip", "controlEquip", "equipment", ["#profileEquipmentBrowserDetail"]),
        step("equipment.steps.visible", "controlChain", "chain", ["#profileEquipmentBrowserList", "#profileEquipmentBrowserDetail"]),
      ],
    },
    session: {
      warning: "features.session.warning",
      steps: [
        step("session.steps.amount", "controlSol", "wallet", ["#sessionFundingAmount"]),
        step("session.steps.permission", "controlEightHours", "permission", ["#sessionFundingForm"]),
        step("session.steps.confirm", "controlSign", "chain", ["#sessionFundingForm .session-funding-actions"]),
      ],
    },
    foundation: {
      warning: "features.foundation.warning",
      steps: [
        step("foundation.steps.tool", "controlBlueprint", "blueprint", ["#blueprintGuide header"]),
        step("foundation.steps.size", "controlDimensions", "dimensions", [".blueprint-dimensions"]),
        step("foundation.steps.place", "controlPlace", "place", ["#worldCanvas"]),
        step("foundation.steps.review", "controlReview", "review", ["#blueprintStatus"]),
        step("foundation.steps.bind", "controlBind", "chain", ["#blueprintConfirm"]),
      ],
    },
    smelting: {
      flow: ["features.smelting.flow.inputs", "features.smelting.flow.fuel", "features.smelting.flow.chain", "features.smelting.flow.output"],
      steps: [
        step("smelting.steps.recipe", "controlRecipe", "recipe", ['[data-smelting-section="recipes"]', "#smeltingRecipeList"]),
        step("smelting.steps.inputs", "controlInput", "inventory", ['[data-smelting-section="backpack"]', "#smeltingResourceGrid", "#smeltingInputSlot"]),
        step("smelting.steps.fuel", "controlFuel", "fuel", ['[data-smelting-section="furnace"]', "#smeltingFuelSlot"]),
        step("smelting.steps.review", "controlReview", "review", ['[data-smelting-section="furnace"]', "#smeltingRecipeDetails", "#smeltingStart"]),
      ],
    },
    market: {
      warning: "features.market.warning",
      steps: [
        step("market.steps.choose", "controlChoose", "inventory", ["#marketInventoryGrid"]),
        step("market.steps.price", "controlPrice", "price", ["#marketListingForm"]),
        step("market.steps.sign", "controlSign", "chain", ["#marketCreateListing"]),
      ],
    },
    forging: {
      warning: "features.forging.warning",
      steps: [
        step("forging.steps.materials", "controlMaterials", "inventory", ["#resourceGrid"]),
        step("forging.steps.shape", "controlShape", "shape", ["#forgeScene"]),
        step("forging.steps.handle", "controlGrip", "grip", ["#forgeScene"]),
        step("forging.steps.fit", "controlFit", "avatar", ["#forgeScene"]),
        step("forging.steps.cast", "controlCast", "chain", ["#castPieceFooter", "#castPiece"]),
      ],
    },
  };
  return definitions[feature];
}

function step(path, glyph, icon, targets) {
  return {
    title: `features.${path}.title`,
    body: `features.${path}.body`,
    short: `features.${path}.title`,
    callout: `features.${path}.title`,
    glyph,
    icon,
    targets,
  };
}

function targetRects(stepDefinition, mobile) {
  const rects = (stepDefinition.targets || [])
    .flatMap((selector) => [...document.querySelectorAll(selector)])
    .filter((element) => element.id !== "worldCanvas")
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 1 && rect.height > 1)
    .map((rect) => paddedRect(rect, mobile ? 5 : 8));
  if (rects.length) return rects;
  const width = mobile ? Math.min(110, innerWidth * 0.28) : Math.min(150, innerWidth * 0.13);
  const height = mobile ? width : Math.min(110, innerHeight * 0.16);
  return [{
    left: innerWidth * (mobile ? 0.48 : 0.55) - width / 2,
    top: innerHeight * (mobile ? 0.44 : 0.52) - height / 2,
    width,
    height,
    right: innerWidth * (mobile ? 0.48 : 0.55) + width / 2,
    bottom: innerHeight * (mobile ? 0.44 : 0.52) + height / 2,
  }];
}

function paddedRect(rect, padding) {
  const left = Math.max(4, rect.left - padding);
  const top = Math.max(4, rect.top - padding);
  const right = Math.min(innerWidth - 4, rect.right + padding);
  const bottom = Math.min(innerHeight - 4, rect.bottom + padding);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function unionRect(rects) {
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function costRows(feature) {
  const rows = {
    equipment: [
      { label: "cost.accountDeposit", kind: "rent" },
      { label: "cost.networkFee", kind: "network" },
    ],
    session: [
      { label: "cost.sessionTopUp", kind: "session" },
      { label: "cost.accountDeposit", kind: "rent" },
      { label: "cost.networkFee", kind: "network" },
    ],
    foundation: [
      { label: "cost.buildSiteDeposit", kind: "rent" },
      { label: "cost.networkFee", kind: "network" },
    ],
    smelting: [
      { label: "cost.progressDeposit", kind: "rent" },
      { label: "cost.networkFee", kind: "network" },
    ],
    market: [
      { label: "cost.listingDeposit", kind: "rent" },
      { label: "cost.marketFee", kind: "percent", value: 1 },
      { label: "cost.networkFee", kind: "network" },
    ],
    forging: [
      { label: "cost.selectedMaterials", kind: "text", value: "cost.consumedOnChain" },
      { label: "cost.networkFee", kind: "network" },
    ],
  };
  return rows[feature] || [];
}

async function minimumRent(bytes) {
  const rpcUrl = currentRpcUrl();
  const key = `${rpcUrl}:${bytes}`;
  if (rentCache.has(key)) return rentCache.get(key);
  const promise = fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getMinimumBalanceForRentExemption",
      params: [bytes, { commitment: "processed" }],
    }),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.error || !Number.isFinite(Number(payload.result))) throw new Error(payload.error?.message || "Invalid rent response");
    return Number(payload.result) / 1_000_000_000;
  });
  rentCache.set(key, promise);
  try {
    return await promise;
  } catch (error) {
    rentCache.delete(key);
    throw error;
  }
}

function currentRpcUrl() {
  const override = cleanHttpsUrl(localStorage.getItem(RPC_OVERRIDE_KEY));
  if (override) return override;
  const apiKey = String(localStorage.getItem(HELIUS_KEY) || "").trim();
  return apiKey ? `https://devnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}` : DEFAULT_RPC_URL;
}

function cleanHttpsUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function tr(key, params) {
  const prefix = document.documentElement.dataset.i18nScope === "forging" ? "forging" : "main";
  return t(`${prefix}.onboarding.${key}`, params);
}

function formatSol(value) {
  return Number(value).toFixed(9).replace(/0+$/, "").replace(/\.$/, "");
}

function guideFeatures() {
  return ["basics", "equipment", "session", "foundation", "smelting", "market", "forging"];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
