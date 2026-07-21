import { initI18n, t } from "/src/i18n.js";
import { cameraForward, cameraOrigin, cameraViewProjection } from "/chunk.js/renderer/camera.js";

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
const GAME_API_REQUEST_EVENT = "nicechunk:onboarding-game-api-request";
const REAL_BLOCK_CLICK_EVENT = "nicechunk:onboarding-real-block-click";
const OPEN_RPC_EVENT = "nicechunk:onboarding-open-rpc";
const rentCache = new Map();
let activeSession = null;

export async function openOnboarding({ feature, scope = "play", walletAddress = "guest", context = null } = {}) {
  if (!guideFeatures().includes(feature)) return false;
  if (activeSession) activeSession.finish("later");
  await initI18n(document);

  return new Promise((resolve) => {
    const session = createSession({ feature, scope, walletAddress, context, resolve });
    activeSession = session;
    session.mount();
  });
}

function createSession({ feature, scope, walletAddress, context, resolve }) {
  const mobile = matchMedia("(pointer: coarse), (max-width: 760px)").matches;
  const definition = guideDefinition(feature, mobile);
  const previousFocus = document.activeElement;
  let root = null;
  let stepIndex = 0;
  let completed = false;
  let resizeFrame = 0;
  let rentValue = null;
  let rentState = RENT_ACCOUNT_BYTES[feature] ? "loading" : "none";
  let activeStep = null;
  let sceneFrame = 0;
  let sceneLastPaintAt = 0;
  let sceneTarget = null;
  let sceneTargetSearchAt = 0;
  let sceneCameraState = null;
  let gameApi = null;
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
    root.querySelector("[data-onboarding-feature-action]").addEventListener("click", handleFeatureAction);
    root.querySelector("[data-onboarding-close]").addEventListener("click", handleLater);
    root.addEventListener("keydown", handleKeyDown);
    layoutObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "aria-selected", "class", "style"] });
    addEventListener("resize", schedulePosition, { passive: true });
    addEventListener("scroll", schedulePosition, { passive: true, capture: true });
    addEventListener("nicechunk:languagechange", render);
    addEventListener(REAL_BLOCK_CLICK_EVENT, handleRealBlockClick);
    render();
    requestAnimationFrame(() => {
      root?.classList.add("is-visible");
      const primary = root?.querySelector("[data-onboarding-primary]");
      (primary?.hidden ? root?.querySelector(".nc-onboarding-card") : primary)?.focus({ preventScroll: true });
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
      <div class="nc-onboarding-scene-cues" aria-hidden="true">
        <span class="nc-onboarding-tile-arrow" data-onboarding-tile-arrow hidden><i></i></span>
        <svg class="nc-onboarding-orbit-cue" data-onboarding-orbit-cue viewBox="0 0 240 150" hidden>
          <path d="M35 88 C54 28 177 13 211 68"/><path d="M205 51 L214 69 L194 74"/>
          <path d="M205 101 C171 143 67 140 31 96"/><path d="M35 113 L27 95 L47 91"/>
        </svg>
      </div>
      <section class="nc-onboarding-card" role="dialog" aria-modal="true" tabindex="-1">
        <span class="nc-onboarding-glass-glow" aria-hidden="true"></span>
        <header class="nc-onboarding-header">
          <div><span data-onboarding-eyebrow></span><strong data-onboarding-title></strong></div>
          <button type="button" data-onboarding-close><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10m0-10L5 15"/></svg></button>
        </header>
        <div class="nc-onboarding-scroll">
          <div class="nc-onboarding-step-rail" data-onboarding-step-rail></div>
          <div class="nc-onboarding-content" aria-live="polite">
            <div class="nc-onboarding-step-icon" data-onboarding-step-icon aria-hidden="true"></div>
            <div class="nc-onboarding-copy"><h2 data-onboarding-step-title></h2><p data-onboarding-step-body></p></div>
          </div>
          <div class="nc-onboarding-flow" data-onboarding-flow hidden></div>
          <div class="nc-onboarding-warning" data-onboarding-warning hidden><span aria-hidden="true">!</span><p></p></div>
          <div class="nc-onboarding-cost" data-onboarding-cost aria-live="polite" hidden></div>
          <p class="nc-onboarding-live-note" data-onboarding-live-note hidden></p>
          <section class="nc-onboarding-formula" data-onboarding-formula hidden>
            <strong data-onboarding-formula-title></strong>
            <code data-onboarding-formula-code></code>
            <p data-onboarding-formula-note></p>
          </section>
          <div class="nc-onboarding-feature-action" data-onboarding-feature-action-wrap hidden>
            <p data-onboarding-feature-action-note></p>
            <a data-onboarding-feature-link href="https://www.helius.dev" target="_blank" rel="noreferrer"></a>
            <button type="button" data-onboarding-feature-action></button>
          </div>
        </div>
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
    const card = root.querySelector(".nc-onboarding-card");
    card.setAttribute("aria-label", tr("dialogAria", { feature: tr(`features.${feature}.title`) }));
    card.setAttribute("aria-modal", String(!step.noCurtains));
    root.classList.toggle("is-scene-step", Boolean(step.scene));
    root.classList.toggle("is-modal-step", Boolean(step.modal));
    root.dataset.stepKind = step.scene || step.icon || "guide";
    root.querySelector("[data-onboarding-close]").setAttribute("aria-label", tr("close"));
    setText("[data-onboarding-eyebrow]", tr(`features.${feature}.eyebrow`));
    setText("[data-onboarding-title]", tr(`features.${feature}.title`));
    setText("[data-onboarding-step-title]", tr(step.title));
    setText("[data-onboarding-step-body]", tr(step.body));
    setText("[data-onboarding-count]", tr("stepCount", { current: stepIndex + 1, total: definition.steps.length }));
    setText("[data-onboarding-never-label]", tr("dontShowAgain"));
    setText("[data-onboarding-skip]", tr("skip"));
    setText("[data-onboarding-later]", tr("later"));
    const primary = root.querySelector("[data-onboarding-primary]");
    primary.hidden = Boolean(step.autoComplete);
    primary.textContent = tr(stepIndex === definition.steps.length - 1 ? "finish" : "next");
    renderStepIcon(step);
    renderRail();
    renderFlow(step);
    renderWarning(step);
    renderCosts();
    renderFormula(step);
    renderFeatureAction(step);
    activateStep(step);
    schedulePosition();
  }

  function renderFormula(step) {
    const panel = root.querySelector("[data-onboarding-formula]");
    panel.hidden = !step.formula;
    if (!step.formula) return;
    setText("[data-onboarding-formula-title]", tr(step.formula.title));
    setText("[data-onboarding-formula-code]", tr(step.formula.code));
    setText("[data-onboarding-formula-note]", tr(step.formula.note));
  }

  function renderFeatureAction(step) {
    const wrap = root.querySelector("[data-onboarding-feature-action-wrap]");
    wrap.hidden = !step.action;
    if (!step.action) return;
    setText("[data-onboarding-feature-action-note]", tr(step.action.note));
    setText("[data-onboarding-feature-link]", tr(step.action.link));
    setText("[data-onboarding-feature-action]", tr(step.action.label));
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
    advanceStep();
  }

  function handleFeatureAction() {
    const step = definition.steps[stepIndex];
    if (!step.action) return;
    finish("complete");
    dispatchEvent(new CustomEvent(step.action.event));
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

  function advanceStep() {
    if (stepIndex >= definition.steps.length - 1) {
      finish("complete");
      return;
    }
    stepIndex += 1;
    render();
  }

  function activateStep(step) {
    if (activeStep === step) return;
    stopSceneStep();
    activeStep = step;
    activateSmeltingSection(step);
    if (!step.scene) return;
    const tileArrow = root.querySelector("[data-onboarding-tile-arrow]");
    const orbitCue = root.querySelector("[data-onboarding-orbit-cue]");
    tileArrow.setAttribute("hidden", "");
    orbitCue.toggleAttribute("hidden", step.scene !== "camera-orbit");
    gameApi ||= requestGameApi();
    if (step.scene === "camera-orbit") sceneCameraState = initialCameraGuideState(gameApi);
    if (sceneRequiresFrame(step)) sceneFrame = requestAnimationFrame(updateSceneStep);
  }

  function activateSmeltingSection(step) {
    if (feature !== "smelting" || !step.smeltingSection) return;
    requestAnimationFrame(() => {
      document.querySelector(`[data-smelting-section="${step.smeltingSection}"]`)?.click?.();
      schedulePosition();
    });
  }

  function stopSceneStep() {
    cancelAnimationFrame(sceneFrame);
    sceneFrame = 0;
    sceneLastPaintAt = 0;
    sceneTargetSearchAt = 0;
    sceneCameraState = null;
    if (sceneTarget) gameApi?.setHighlightedBlock?.(null);
    sceneTarget = null;
    root?.querySelector("[data-onboarding-tile-arrow]")?.setAttribute("hidden", "");
    root?.querySelector("[data-onboarding-orbit-cue]")?.setAttribute("hidden", "");
  }

  function updateSceneStep(now) {
    sceneFrame = 0;
    if (!root || completed || !activeStep?.scene) return;
    if (activeStep.scene === "move-target") updateMoveTargetStep(now);
    else if (activeStep.scene === "camera-orbit") updateCameraOrbitStep();
    if (root && !completed && sceneRequiresFrame(activeStep) && !sceneFrame) {
      sceneFrame = requestAnimationFrame(updateSceneStep);
    }
  }

  function updateMoveTargetStep(now) {
    if (!gameApi) gameApi = requestGameApi();
    if (!sceneTarget && now >= sceneTargetSearchAt) {
      sceneTargetSearchAt = now + 300;
      sceneTarget = findReachableTile(gameApi);
      if (sceneTarget) {
        gameApi?.setHighlightedBlock?.(sceneTarget);
        schedulePosition();
      }
    }
    if (!sceneTarget) return;
    if (!isTileStillValid(gameApi, sceneTarget)) {
      gameApi?.setHighlightedBlock?.(null);
      sceneTarget = null;
      root?.querySelector("[data-onboarding-tile-arrow]")?.setAttribute("hidden", "");
      return;
    }
    if (hasReachedTile(gameApi, sceneTarget)) {
      gameApi?.setHighlightedBlock?.(null);
      sceneTarget = null;
      advanceStep();
      return;
    }
    if (now - sceneLastPaintAt < 32) return;
    sceneLastPaintAt = now;
    positionTileArrow(projectTileToScreen(gameApi, sceneTarget));
  }

  function updateCameraOrbitStep() {
    const current = cameraGuideAngles(gameApi);
    if (!current) return;
    if (!sceneCameraState) {
      sceneCameraState = { ...current, yawTravel: 0, pitchTravel: 0 };
      return;
    }
    sceneCameraState.yawTravel += Math.abs(shortestAngle(current.yaw - sceneCameraState.yaw));
    sceneCameraState.pitchTravel += Math.abs(current.pitch - sceneCameraState.pitch);
    sceneCameraState.yaw = current.yaw;
    sceneCameraState.pitch = current.pitch;
    if (sceneCameraState.yawTravel >= 0.24
      || sceneCameraState.pitchTravel >= 0.15
      || sceneCameraState.yawTravel + sceneCameraState.pitchTravel >= 0.28) {
      advanceStep();
    }
  }

  function positionTileArrow(projected) {
    const arrow = root?.querySelector("[data-onboarding-tile-arrow]");
    if (!arrow) return;
    if (!projected) {
      arrow.setAttribute("hidden", "");
      return;
    }
    arrow.removeAttribute("hidden");
    arrow.classList.toggle("is-offscreen", !projected.onScreen);
    arrow.style.setProperty("--nc-guide-arrow-x", `${projected.x}px`);
    arrow.style.setProperty("--nc-guide-arrow-y", `${projected.y}px`);
    arrow.style.setProperty("--nc-guide-arrow-rotation", `${projected.rotation}rad`);
  }

  function handleRealBlockClick(event) {
    if (!root || activeStep?.scene !== "block-click" || !event?.detail?.hit) return;
    finish("complete");
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
    const targetRectangles = sceneTargetRect(step) || targetRects(step, mobile);
    const targetUnion = unionRect(targetRectangles);
    const cardRect = positionCard(targetRectangles, targetUnion);
    if (step.noCurtains || step.modal) {
      root.querySelector(".nc-onboarding-focus-layer").replaceChildren();
      clearCurtains();
      clearConnector();
      return;
    }
    const rects = targetRectangles.map((rect) => unobscuredRect(rect, cardRect, mobile ? 8 : 12));
    const layer = root.querySelector(".nc-onboarding-focus-layer");
    layer.replaceChildren(...rects.map((rect, index) => focusFrame(rect, step, index === 0)));
    const union = unionRect(rects);
    positionCurtains(union);
    positionConnector(union);
  }

  function sceneTargetRect(step) {
    if (!step.scene) return null;
    if (step.scene === "move-target" && sceneTarget) {
      const projected = projectTileToScreen(gameApi, sceneTarget);
      if (projected) return [makeRect(projected.x - 36, projected.y - 54, projected.x + 36, projected.y + 18)];
    }
    const shape = fallbackShape(step.fallback, mobile);
    const centerX = innerWidth * shape.x;
    const centerY = innerHeight * shape.y;
    return [makeRect(centerX - shape.width / 2, centerY - shape.height / 2, centerX + shape.width / 2, centerY + shape.height / 2)];
  }

  function focusFrame(rect, step, showLabel) {
    const frame = document.createElement("span");
    frame.className = "nc-onboarding-focus";
    frame.dataset.kind = step.icon || "guide";
    if (rect.top < 42) frame.classList.add("is-edge-top");
    if (rect.left < 105) frame.classList.add("is-edge-left");
    if (rect.right > innerWidth - 105) frame.classList.add("is-edge-right");
    frame.style.left = `${rect.left}px`;
    frame.style.top = `${rect.top}px`;
    frame.style.width = `${rect.width}px`;
    frame.style.height = `${rect.height}px`;
    if (showLabel && step.callout) {
      const label = document.createElement("b");
      label.textContent = tr(step.callout);
      frame.append(label);
    }
    return frame;
  }

  function positionCard(rects, union) {
    const card = root.querySelector(".nc-onboarding-card");
    const cardWidth = card.offsetWidth;
    const cardHeight = card.offsetHeight;
    const portrait = innerHeight >= innerWidth;
    const margin = mobile ? 9 : 20;
    const gap = mobile ? 16 : 28;
    const maxX = Math.max(margin, innerWidth - cardWidth - margin);
    const maxY = Math.max(margin, innerHeight - cardHeight - margin);
    const centerX = union.left + union.width / 2;
    const centerY = union.top + union.height / 2;
    const candidates = [
      candidate("right", union.right + gap, centerY - cardHeight / 2),
      candidate("left", union.left - cardWidth - gap, centerY - cardHeight / 2),
      candidate("below", centerX - cardWidth / 2, union.bottom + gap),
      candidate("above", centerX - cardWidth / 2, union.top - cardHeight - gap),
      candidate("top-left", margin, margin),
      candidate("top-right", maxX, margin),
      candidate("bottom-left", margin, maxY),
      candidate("bottom-right", maxX, maxY),
      ...rects.flatMap((rect, index) => [
        candidate(`target-${index}-right`, rect.right + gap, rect.top + rect.height / 2 - cardHeight / 2),
        candidate(`target-${index}-left`, rect.left - cardWidth - gap, rect.top + rect.height / 2 - cardHeight / 2),
        candidate(`target-${index}-below`, rect.left + rect.width / 2 - cardWidth / 2, rect.bottom + gap),
        candidate(`target-${index}-above`, rect.left + rect.width / 2 - cardWidth / 2, rect.top - cardHeight - gap),
      ]),
    ];
    const preference = mobile
      ? (portrait ? ["above", "below", "top-left", "bottom-left", "left", "right"] : ["left", "right", "above", "below"])
      : ["right", "left", "below", "above"];
    const obstacles = cardObstacles(feature);
    const best = uniqueCandidates(candidates)
      .map((item) => {
        const overlap = rects.reduce((total, rect) => total + intersectionArea(item, rect), 0);
        const obstacleOverlap = obstacles.reduce((total, rect) => total + intersectionArea(item, rect), 0);
        const distance = Math.hypot(item.x + cardWidth / 2 - centerX, item.y + cardHeight / 2 - centerY);
        const rank = preference.indexOf(item.name);
        return { ...item, score: overlap * 1_000_000 + obstacleOverlap * 20_000 + distance + (rank < 0 ? preference.length : rank) * 18 };
      })
      .sort((a, b) => a.score - b.score)[0];
    root.dataset.cardPositioned = "true";
    root.dataset.cardPlacement = best.name;
    card.style.setProperty("--nc-guide-card-left", `${best.x}px`);
    card.style.setProperty("--nc-guide-card-top", `${best.y}px`);
    card.style.setProperty("--nc-guide-card-width", `${cardWidth}px`);
    return {
      left: best.x,
      top: best.y,
      right: best.x + cardWidth,
      bottom: best.y + cardHeight,
      width: cardWidth,
      height: cardHeight,
    };

    function candidate(name, x, y) {
      return {
        name,
        x: clamp(x, margin, maxX),
        y: clamp(y, margin, maxY),
        width: cardWidth,
        height: cardHeight,
      };
    }
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

  function clearCurtains() {
    for (const curtain of root.querySelectorAll("[data-curtain]")) {
      curtain.style.width = "0px";
      curtain.style.height = "0px";
    }
  }

  function positionConnector(target) {
    const svg = root.querySelector(".nc-onboarding-connector");
    const card = root.querySelector(".nc-onboarding-card").getBoundingClientRect();
    const targetCenter = { x: target.left + target.width / 2, y: target.top + target.height / 2 };
    const cardCenter = { x: card.left + card.width / 2, y: card.top + card.height / 2 };
    const start = edgePoint(target, cardCenter);
    const end = edgePoint(card, targetCenter, 12);
    const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
    const bend = horizontal
      ? { x: start.x + (end.x - start.x) * 0.52, y: start.y }
      : { x: start.x, y: start.y + (end.y - start.y) * 0.52 };
    const second = horizontal ? { x: bend.x, y: end.y } : { x: end.x, y: bend.y };
    svg.querySelector("path").setAttribute("d", `M ${start.x} ${start.y} L ${bend.x} ${bend.y} L ${second.x} ${second.y} L ${end.x} ${end.y}`);
    svg.querySelector("circle").setAttribute("r", "3");
    svg.querySelector("circle").setAttribute("cx", String(start.x));
    svg.querySelector("circle").setAttribute("cy", String(start.y));
  }

  function clearConnector() {
    const svg = root.querySelector(".nc-onboarding-connector");
    svg.querySelector("path").setAttribute("d", "");
    svg.querySelector("circle").setAttribute("r", "0");
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
    stopSceneStep();
    removeEventListener("resize", schedulePosition);
    removeEventListener("scroll", schedulePosition, { capture: true });
    removeEventListener("nicechunk:languagechange", render);
    removeEventListener(REAL_BLOCK_CLICK_EVENT, handleRealBlockClick);
    root?.classList.remove("is-visible");
    const finishedRoot = root;
    root = null;
    setTimeout(() => finishedRoot?.remove(), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180);
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    if (activeSession?.finish === finish) activeSession = null;
    resolve(result);
  }
}

function sceneRequiresFrame(step) {
  return step?.scene === "move-target" || step?.scene === "camera-orbit";
}

function guideDefinition(feature, mobile) {
  const basics = mobile ? [
    sceneStep("basics.steps.move", "controlMove", "move", "move-target", "move"),
    sceneStep("basics.steps.lookMobile", "controlSwipe", "look", "camera-orbit", "look"),
    sceneStep("basics.steps.selectMobile", "controlTap", "select", "block-click", "select"),
  ] : [
    sceneStep("basics.steps.move", "controlMove", "move", "move-target", "move"),
    sceneStep("basics.steps.look", "controlLook", "look", "camera-orbit", "look"),
    sceneStep("basics.steps.select", "controlSelect", "select", "block-click", "select"),
  ];
  const definitions = {
    basics: { steps: basics },
    equipment: {
      flow: ["features.equipment.flow.backpack", "features.equipment.flow.pda", "features.equipment.flow.avatar"],
      steps: [
        step("equipment.steps.choose", "controlChoose", "inventory", ["#profileEquipmentBrowserList"]),
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
        focusStep("smelting.steps.recipe", "controlRecipe", "recipe", ["#smeltingRecipeList .nice-smelting-recipe-card.selected", "#smeltingRecipeList .nice-smelting-recipe-card", "#smeltingRecipeList"], "recipes"),
        focusStep("smelting.steps.inputs", "controlInput", "inventory", ["#smeltingResourceGrid .nice-smelting-resource-card.selected-input", "#smeltingResourceGrid .nice-smelting-resource-card:not(.disabled)", "#smeltingResourceGrid"], "backpack"),
        focusStep("smelting.steps.fuel", "controlFuel", "fuel", ["#smeltingFuelSlot"], "furnace"),
        focusStep("smelting.steps.review", "controlReview", "review", ["#smeltingStart", "#smeltingRecipeDetails"], "furnace"),
      ],
    },
    mining: {
      steps: [{
        ...step("mining.steps.pending", "controlChain", "chain", [], "chain"),
        modal: true,
        formula: {
          title: "features.mining.formulaTitle",
          code: "features.mining.formula",
          note: "features.mining.formulaNote",
        },
        action: {
          note: "features.mining.rpcRecommendation",
          link: "features.mining.heliusLink",
          label: "features.mining.rpcAction",
          event: OPEN_RPC_EVENT,
        },
      }],
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

function step(path, glyph, icon, targets, fallback = icon) {
  return {
    title: `features.${path}.title`,
    body: `features.${path}.body`,
    short: `features.${path}.title`,
    callout: `features.${path}.title`,
    glyph,
    icon,
    targets,
    fallback,
  };
}

function sceneStep(path, glyph, icon, scene, fallback) {
  return {
    ...step(path, glyph, icon, [], fallback),
    scene,
    noCurtains: true,
    autoComplete: true,
  };
}

function focusStep(path, glyph, icon, targets, smeltingSection) {
  return {
    ...step(path, glyph, icon, targets),
    targetMode: "first",
    targetLimit: 1,
    smeltingSection,
  };
}

function targetRects(stepDefinition, mobile) {
  const targetGroups = (stepDefinition.targets || []).map((selector) => [...document.querySelectorAll(selector)]
    .filter((element) => element.id !== "worldCanvas")
    .filter(isVisibleTarget)
    .map((element) => element.getBoundingClientRect())
    .map(clipToViewport)
    .filter((rect) => rect.width > 1 && rect.height > 1)
    .map((rect) => paddedRect(rect, mobile ? 5 : 8)));
  const selectedGroups = stepDefinition.targetMode === "first"
    ? targetGroups.filter((group) => group.length).slice(0, 1)
    : targetGroups;
  const rects = selectedGroups.flat().slice(0, stepDefinition.targetLimit || Infinity);
  if (rects.length) return rects;
  const shape = fallbackShape(stepDefinition.fallback, mobile);
  const width = shape.width;
  const height = shape.height;
  const centerX = innerWidth * shape.x;
  const centerY = innerHeight * shape.y;
  return [{
    left: centerX - width / 2,
    top: centerY - height / 2,
    width,
    height,
    right: centerX + width / 2,
    bottom: centerY + height / 2,
  }];
}

function isVisibleTarget(element) {
  if (!(element instanceof HTMLElement) || element.hidden || element.closest("[hidden]")) return false;
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
}

function clipToViewport(rect) {
  const left = clamp(rect.left, 0, innerWidth);
  const top = clamp(rect.top, 0, innerHeight);
  const right = clamp(rect.right, 0, innerWidth);
  const bottom = clamp(rect.bottom, 0, innerHeight);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function fallbackShape(kind, mobile) {
  const shapes = {
    move: { width: mobile ? 96 : 132, height: mobile ? 62 : 58, x: mobile ? 0.50 : 0.55, y: mobile ? 0.45 : 0.48 },
    look: { width: mobile ? 190 : 250, height: mobile ? 118 : 150, x: 0.53, y: 0.46 },
    select: { width: mobile ? 108 : 132, height: mobile ? 92 : 108, x: 0.56, y: 0.48 },
    camera: { width: mobile ? 78 : 96, height: mobile ? 78 : 96, x: 0.50, y: 0.50 },
    chain: { width: mobile ? 118 : 150, height: mobile ? 86 : 104, x: 0.50, y: 0.48 },
  };
  return shapes[kind] || { width: mobile ? 96 : 132, height: mobile ? 82 : 96, x: 0.53, y: 0.49 };
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

function unobscuredRect(rect, blocker, gap) {
  const blocked = {
    left: blocker.left - gap,
    top: blocker.top - gap,
    right: blocker.right + gap,
    bottom: blocker.bottom + gap,
  };
  if (intersectionArea(rect, blocked) === 0) return rect;
  const candidates = [
    makeRect(rect.left, rect.top, rect.right, Math.min(rect.bottom, blocked.top)),
    makeRect(rect.left, Math.max(rect.top, blocked.bottom), rect.right, rect.bottom),
    makeRect(rect.left, Math.max(rect.top, blocked.top), Math.min(rect.right, blocked.left), Math.min(rect.bottom, blocked.bottom)),
    makeRect(Math.max(rect.left, blocked.right), Math.max(rect.top, blocked.top), rect.right, Math.min(rect.bottom, blocked.bottom)),
  ].filter((candidate) => candidate.width >= 18 && candidate.height >= 18);
  return candidates.sort((a, b) => b.width * b.height - a.width * a.height)[0] || rect;
}

function makeRect(left, top, right, bottom) {
  return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function requestGameApi() {
  let gameApi = null;
  dispatchEvent(new CustomEvent(GAME_API_REQUEST_EVENT, {
    detail: {
      accept(candidate) {
        if (candidate && typeof candidate === "object") gameApi = candidate;
      },
    },
  }));
  return gameApi;
}

function findReachableTile(gameApi) {
  const chunks = gameApi?.getChunks?.();
  const motion = gameApi?.getMotion?.();
  const camera = gameApi?.getCamera?.();
  const position = gameApi?.getPlayerPosition?.();
  if (!chunks || !motion || !camera || !validPosition(position)) return null;
  const [playerX, playerY, playerZ] = position;
  const startX = Math.floor(playerX);
  const startZ = Math.floor(playerZ);
  const startGround = terrainGroundAt(chunks, startX, startZ, gameApi);
  if (!Number.isFinite(startGround) || Math.abs(playerY - startGround) > 1.25) return null;
  const forward = cameraForward(camera);
  const candidates = reachableTiles(gameApi, startX, startZ, startGround)
    .map((candidate) => {
      const dx = candidate.x - startX;
      const dz = candidate.z - startZ;
      const distance = Math.hypot(dx, dz);
      const facing = dx * forward[0] + dz * forward[2];
      return {
        ...candidate,
        distance,
        score: facing * 8 - Math.abs(distance - 4) - Math.abs(dx) * 0.001 - Math.abs(dz) * 0.0001,
      };
    })
    .filter((candidate) => candidate.distance >= 3 && candidate.distance <= 5.01)
    .filter((candidate) => Math.abs(candidate.ground - startGround) <= 1.001);
  candidates.sort((a, b) => b.score - a.score);
  for (const candidate of candidates) {
    const worldY = candidate.ground - 1;
    const blockId = Math.trunc(Number(chunks.getBlockAtWorld?.(candidate.x, worldY, candidate.z)) || 0);
    if (!isBlockingTerrain(gameApi, blockId)) continue;
    return { worldX: candidate.x, worldY, worldZ: candidate.z, blockId };
  }
  return null;
}

function reachableTiles(gameApi, startX, startZ, startGround) {
  const chunks = gameApi?.getChunks?.();
  const motion = gameApi?.getMotion?.();
  if (!chunks || !motion) return [];
  const queue = [{ x: startX, z: startZ, ground: startGround }];
  const reachable = [];
  const visited = new Set([`${startX},${startZ}`]);
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (const [dx, dz] of directions) {
      const x = current.x + dx;
      const z = current.z + dz;
      if (Math.abs(x - startX) > 5 || Math.abs(z - startZ) > 5) continue;
      const key = `${x},${z}`;
      if (visited.has(key)) continue;
      const ground = terrainGroundAt(chunks, x, z, gameApi);
      if (!Number.isFinite(ground) || Math.abs(ground - current.ground) > 1.001) continue;
      if (motion.playerCollidesAt?.(x + 0.5, ground, z + 0.5)) continue;
      visited.add(key);
      const tile = { x, z, ground };
      reachable.push(tile);
      queue.push(tile);
    }
  }
  return reachable;
}

function terrainGroundAt(chunks, worldX, worldZ, gameApi) {
  const ground = Number(chunks?.surfaceYAt?.(worldX, worldZ));
  if (!Number.isFinite(ground)) return null;
  const blockId = Math.trunc(Number(chunks.getBlockAtWorld?.(worldX, ground - 1, worldZ)) || 0);
  return isBlockingTerrain(gameApi, blockId) ? ground : null;
}

function isBlockingTerrain(gameApi, blockId) {
  return typeof gameApi?.isBlockingBlock === "function"
    ? gameApi.isBlockingBlock(blockId)
    : Number(blockId) > 0;
}

function isTileStillValid(gameApi, target) {
  const chunks = gameApi?.getChunks?.();
  if (!chunks || !target) return false;
  const blockId = Math.trunc(Number(chunks.getBlockAtWorld?.(target.worldX, target.worldY, target.worldZ)) || 0);
  return blockId === target.blockId
    && Number(chunks.surfaceYAt?.(target.worldX, target.worldZ)) === target.worldY + 1;
}

function hasReachedTile(gameApi, target) {
  const position = gameApi?.getPlayerPosition?.();
  if (!validPosition(position) || !target) return false;
  return Math.hypot(position[0] - (target.worldX + 0.5), position[2] - (target.worldZ + 0.5)) <= 0.62
    && Math.abs(position[1] - (target.worldY + 1)) <= 0.55;
}

function projectTileToScreen(gameApi, target) {
  const camera = gameApi?.getCamera?.();
  const canvas = gameApi?.getCanvas?.();
  const rect = canvas?.getBoundingClientRect?.();
  if (!camera || !target || !rect?.width || !rect?.height) return null;
  const matrix = cameraViewProjection(camera);
  const origin = cameraOrigin(camera);
  const x = target.worldX + 0.5 - origin.worldX;
  const y = target.worldY + 1.2 - origin.worldY;
  const z = target.worldZ + 0.5 - origin.worldZ;
  const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  const clipZ = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  const divisor = Math.max(0.0001, Math.abs(clipW));
  const facing = clipW > 0;
  const ndcX = (clipX / divisor) * (facing ? 1 : -1);
  const ndcY = (clipY / divisor) * (facing ? 1 : -1);
  const ndcZ = clipZ / divisor;
  const rawX = rect.left + (ndcX * 0.5 + 0.5) * rect.width;
  const rawY = rect.top + (1 - (ndcY * 0.5 + 0.5)) * rect.height;
  const onScreen = facing && ndcZ >= -1 && ndcZ <= 1 && Math.abs(ndcX) <= 0.92 && Math.abs(ndcY) <= 0.88;
  if (onScreen) return { x: rawX, y: rawY, rotation: 0, onScreen: true };
  const centerX = rect.left + rect.width * 0.5;
  const centerY = rect.top + rect.height * 0.5;
  let dx = rawX - centerX;
  let dy = rawY - centerY;
  if (Math.hypot(dx, dy) < 0.001) dy = -1;
  const edgeX = Math.max(24, rect.width * 0.5 - 38);
  const edgeY = Math.max(24, rect.height * 0.5 - 58);
  const scale = Math.min(edgeX / Math.max(0.001, Math.abs(dx)), edgeY / Math.max(0.001, Math.abs(dy)));
  return {
    x: centerX + dx * scale,
    y: centerY + dy * scale,
    rotation: Math.atan2(dy, dx) - Math.PI * 0.5,
    onScreen: false,
  };
}

function initialCameraGuideState(gameApi) {
  const angles = cameraGuideAngles(gameApi);
  return angles ? { ...angles, yawTravel: 0, pitchTravel: 0 } : null;
}

function cameraGuideAngles(gameApi) {
  const player = gameApi?.getPlayer?.();
  const camera = gameApi?.getCamera?.();
  const yaw = Number.isFinite(player?.controlYaw) ? player.controlYaw : camera?.yaw;
  const pitch = Number.isFinite(player?.cameraPitch) ? player.cameraPitch : camera?.pitch;
  return Number.isFinite(yaw) && Number.isFinite(pitch) ? { yaw, pitch } : null;
}

function shortestAngle(value) {
  let angle = Number(value) || 0;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function validPosition(value) {
  return Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite);
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
  return ["basics", "equipment", "session", "foundation", "smelting", "market", "forging", "mining"];
}

function cardObstacles(feature) {
  if (feature !== "basics") return [];
  return ["#joystick", "#hotbar", ".account-hud", ".minimap-panel"]
    .flatMap((selector) => [...document.querySelectorAll(selector)])
    .filter(isVisibleTarget)
    .map((element) => paddedRect(clipToViewport(element.getBoundingClientRect()), 6));
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${Math.round(candidate.x)},${Math.round(candidate.y)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function intersectionArea(a, b) {
  const aLeft = a.left ?? a.x;
  const aTop = a.top ?? a.y;
  const aRight = a.right ?? aLeft + a.width;
  const aBottom = a.bottom ?? aTop + a.height;
  return Math.max(0, Math.min(aRight, b.right) - Math.max(aLeft, b.left))
    * Math.max(0, Math.min(aBottom, b.bottom) - Math.max(aTop, b.top));
}

function edgePoint(rect, toward, inset = 0) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = toward.x - centerX;
  const dy = toward.y - centerY;
  const horizontal = Math.abs(dx) / Math.max(1, rect.width) >= Math.abs(dy) / Math.max(1, rect.height);
  if (horizontal) {
    return {
      x: dx < 0 ? rect.left + inset : rect.right - inset,
      y: clamp(toward.y, rect.top + inset, rect.bottom - inset),
    };
  }
  return {
    x: clamp(toward.x, rect.left + inset, rect.right - inset),
    y: dy < 0 ? rect.top + inset : rect.bottom - inset,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
