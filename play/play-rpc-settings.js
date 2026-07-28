import {
  getRpcConfigMode,
  getStoredHeliusApiKey,
  getStoredRpcOverride,
  heliusDevnetRpcUrl,
  normalizeHttpsRpcUrl,
  resetRpcConfig,
  saveCustomRpcUrl,
  saveHeliusApiKey,
  solanaDevnetGenesisHash,
} from "/src/rpcConfig.js";
import { initI18n, t } from "/src/i18n.js";

const RPC_VALIDATION_TIMEOUT_MS = 10_000;
let sharedSettings = null;

export function getPlayRpcSettings({ root = globalThis.document } = {}) {
  if (!sharedSettings) sharedSettings = createPlayRpcSettings(root);
  return sharedSettings;
}

export async function validateSolanaDevnetRpc(rpcUrl, {
  fetchImpl = globalThis.fetch,
  timeoutMs = RPC_VALIDATION_TIMEOUT_MS,
} = {}) {
  const endpoint = normalizeHttpsRpcUrl(rpcUrl);
  if (!endpoint) return { ok: false, code: "invalidUrl" };
  if (typeof fetchImpl !== "function") return { ok: false, code: "network" };

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = globalThis.setTimeout?.(() => controller?.abort(), Math.max(1, Number(timeoutMs) || RPC_VALIDATION_TIMEOUT_MS));
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "nicechunk-rpc-check",
        method: "getGenesisHash",
      }),
      signal: controller?.signal,
    });
    if (!response?.ok) {
      if ([401, 403].includes(response?.status)) return { ok: false, code: "unauthorized", status: response.status };
      if (response?.status === 429) return { ok: false, code: "rateLimited", status: response.status };
      return { ok: false, code: "http", status: Number(response?.status) || 0 };
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, code: "invalidResponse" };
    }
    if (payload?.error) {
      const message = String(payload.error.message || "").toLowerCase();
      if (/unauthorized|forbidden|api[ -]?key/.test(message)) return { ok: false, code: "unauthorized" };
      if (/rate[ -]?limit|too many requests/.test(message)) return { ok: false, code: "rateLimited" };
      return { ok: false, code: "rejected" };
    }
    if (String(payload?.result || "") !== solanaDevnetGenesisHash) {
      return { ok: false, code: "wrongNetwork" };
    }
    return { ok: true, code: "ok" };
  } catch (error) {
    const aborted = error?.name === "AbortError" || controller?.signal?.aborted;
    return { ok: false, code: aborted ? "timeout" : "network" };
  } finally {
    if (timeout) globalThis.clearTimeout?.(timeout);
  }
}

export function sanitizeRpcFailureReason(value, secrets = []) {
  let reason = String(value?.message || value || "").trim();
  for (const secret of secrets) {
    const token = String(secret || "").trim();
    if (token) reason = reason.replaceAll(token, "[redacted]");
  }
  reason = reason
    .replace(/https:\/\/[^\s)\]}]+/giu, (candidate) => redactRpcUrl(candidate))
    .replace(/([?&](?:api[-_]?key|token|key)=)[^&#\s]+/giu, "$1[redacted]");
  return reason.slice(0, 240);
}

function createPlayRpcSettings(root) {
  const elements = collectElements(root);
  const state = {
    bound: false,
    busy: false,
    context: null,
    mode: "helius",
    openPromise: null,
    resolveOpen: null,
    requestId: 0,
    restoreFocus: true,
    returnFocus: null,
  };

  const api = {
    open,
    close,
    render,
    snapshot,
  };
  return api;

  async function open({ context = null, onPresented = null, restoreFocus = true } = {}) {
    await initI18n(root);
    assertPanelAvailable();
    bind();
    state.context = normalizeFailureContext(context);
    state.mode = getRpcConfigMode() === "custom" ? "custom" : "helius";
    state.restoreFocus = restoreFocus !== false;
    state.returnFocus = state.restoreFocus ? root.activeElement : null;
    populateInputs();
    render();

    if (!state.openPromise) {
      state.openPromise = new Promise((resolve) => {
        state.resolveOpen = resolve;
      });
    }
    elements.panel.hidden = false;
    elements.panel.setAttribute("aria-hidden", "false");
    root.body?.classList?.add("rpc-config-open");
    globalThis.requestAnimationFrame?.(() => {
      focusActiveField();
      onPresented?.();
    });
    return state.openPromise;
  }

  function close(action = "dismissed", detail = {}) {
    if (!elements.panel || elements.panel.hidden) return;
    state.requestId += 1;
    state.busy = false;
    setBusy(false);
    elements.panel.hidden = true;
    elements.panel.setAttribute("aria-hidden", "true");
    root.body?.classList?.remove("rpc-config-open");
    const resolve = state.resolveOpen;
    state.resolveOpen = null;
    state.openPromise = null;
    state.context = null;
    clearStatus();
    resolve?.({ action, ...detail });
    if (state.restoreFocus && state.returnFocus?.isConnected) {
      globalThis.requestAnimationFrame?.(() => state.returnFocus?.focus?.());
    }
    state.returnFocus = null;
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    elements.form?.addEventListener("submit", submit);
    elements.mode?.addEventListener("change", () => {
      state.mode = elements.mode.value === "custom" ? "custom" : "helius";
      clearStatus();
      render();
      focusActiveField();
    });
    elements.usePublic?.addEventListener("click", usePublicRpc);
    elements.dismiss?.addEventListener("click", () => close("dismissed"));
    elements.panel?.addEventListener("pointerdown", (event) => {
      if (event.target === elements.panel) close("dismissed");
    });
    elements.panel?.addEventListener("keydown", handleDialogKeydown);
    globalThis.addEventListener?.("nicechunk:languagechange", render);
  }

  async function submit(event) {
    event.preventDefault();
    if (state.busy) return;
    const candidate = selectedCandidate();
    if (!candidate.ok) {
      showStatus(candidate.code, "error");
      focusActiveField();
      return;
    }

    const requestId = ++state.requestId;
    state.busy = true;
    setBusy(true);
    showStatus("testing", "progress");
    const validation = await validateSolanaDevnetRpc(candidate.rpcUrl);
    if (requestId !== state.requestId) return;
    if (!validation.ok) {
      state.busy = false;
      setBusy(false);
      showStatus(validation.code, "error", { status: validation.status || "" });
      return;
    }

    try {
      if (candidate.mode === "custom") saveCustomRpcUrl(candidate.value);
      else saveHeliusApiKey(candidate.value);
    } catch {
      state.busy = false;
      setBusy(false);
      showStatus("storage", "error");
      return;
    }
    showStatus("saved", "success");
    await delay(140);
    if (requestId === state.requestId) close("saved", { mode: candidate.mode });
  }

  async function usePublicRpc() {
    if (state.busy) return;
    state.busy = true;
    setBusy(true);
    try {
      resetRpcConfig();
      showStatus("publicSaved", "success");
      await delay(140);
      close("saved", { mode: "public" });
    } catch {
      state.busy = false;
      setBusy(false);
      showStatus("storage", "error");
    }
  }

  function render() {
    if (!elements.panel) return;
    const hasFailure = Boolean(state.context);
    if (elements.title) elements.title.textContent = t(hasFailure ? "main.rpcConfig.failureTitle" : "main.rpcConfig.title");
    if (elements.body) elements.body.textContent = t(hasFailure ? "main.rpcConfig.failureBody" : "main.rpcConfig.body");
    if (elements.context) elements.context.hidden = !hasFailure;
    if (hasFailure) renderFailureContext();

    const mode = state.mode === "custom" ? "custom" : "helius";
    if (elements.mode) elements.mode.value = mode;
    if (elements.heliusFields) elements.heliusFields.hidden = mode !== "helius";
    if (elements.customFields) elements.customFields.hidden = mode !== "custom";
    const currentMode = getRpcConfigMode();
    if (elements.current) {
      elements.current.dataset.mode = currentMode;
      elements.current.textContent = t(`main.rpcConfig.current.${currentMode}`);
    }
  }

  function renderFailureContext() {
    const code = state.context.code;
    const failureKey = `main.loading.loader.failures.${code}.title`;
    const translatedFailure = t(failureKey);
    if (elements.contextTitle) {
      elements.contextTitle.textContent = translatedFailure === failureKey
        ? t("main.rpcConfig.failureUnknown")
        : translatedFailure;
    }
    if (elements.contextStage) {
      const stageKey = `main.loading.stages.${state.context.stage}.title`;
      const translatedStage = t(stageKey);
      elements.contextStage.textContent = t("main.rpcConfig.failureStage", {
        stage: translatedStage === stageKey ? state.context.stage : translatedStage,
      });
    }
    if (elements.contextReason) {
      elements.contextReason.textContent = t("main.rpcConfig.failureReason", {
        reason: state.context.reason || t("main.rpcConfig.failureUnknown"),
      });
    }
  }

  function populateInputs() {
    if (elements.apiKey) elements.apiKey.value = getStoredHeliusApiKey();
    if (elements.endpoint) elements.endpoint.value = getStoredRpcOverride();
  }

  function selectedCandidate() {
    if (state.mode === "custom") {
      const value = String(elements.endpoint?.value || "").trim();
      const rpcUrl = normalizeHttpsRpcUrl(value);
      return rpcUrl
        ? { ok: true, mode: "custom", value, rpcUrl }
        : { ok: false, code: "invalidUrl" };
    }
    const value = String(elements.apiKey?.value || "").trim();
    return value
      ? { ok: true, mode: "helius", value, rpcUrl: heliusDevnetRpcUrl(value) }
      : { ok: false, code: "invalidKey" };
  }

  function showStatus(code, status, params = {}) {
    if (!elements.status) return;
    elements.status.hidden = false;
    elements.status.dataset.state = status;
    elements.status.textContent = t(`main.rpcConfig.validation.${code}`, params);
  }

  function clearStatus() {
    if (!elements.status) return;
    elements.status.hidden = true;
    elements.status.dataset.state = "";
    elements.status.textContent = "";
  }

  function setBusy(busy) {
    elements.form?.setAttribute("aria-busy", String(busy));
    for (const element of [elements.mode, elements.apiKey, elements.endpoint, elements.submit, elements.usePublic, elements.dismiss]) {
      if (element) element.disabled = busy;
    }
    if (elements.submit) elements.submit.textContent = t(busy ? "main.rpcConfig.testing" : "main.rpcConfig.save");
  }

  function handleDialogKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close("dismissed");
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = dialogFocusableElements();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && root.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && root.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function focusActiveField() {
    const target = state.mode === "custom" ? elements.endpoint : elements.apiKey;
    target?.focus?.();
  }

  function dialogFocusableElements() {
    return [...elements.panel.querySelectorAll("a[href],button:not([disabled]),input:not([disabled]),select:not([disabled])")]
      .filter((element) => !element.closest("[hidden]"));
  }

  function snapshot() {
    return {
      open: Boolean(elements.panel && !elements.panel.hidden),
      busy: state.busy,
      mode: state.mode,
      currentMode: getRpcConfigMode(),
      context: state.context ? { ...state.context } : null,
    };
  }

  function assertPanelAvailable() {
    if (!elements.panel || !elements.form || !elements.mode || !elements.submit) {
      throw new Error("rpc-settings-panel-unavailable");
    }
  }
}

function collectElements(root) {
  const byId = (id) => root?.querySelector?.(`#${id}`) || null;
  return {
    panel: byId("rpcConfigPanel"),
    title: byId("rpcConfigTitle"),
    body: byId("rpcConfigBody"),
    context: byId("rpcConfigContext"),
    contextTitle: byId("rpcConfigContextTitle"),
    contextStage: byId("rpcConfigContextStage"),
    contextReason: byId("rpcConfigContextReason"),
    current: byId("rpcConfigCurrent"),
    form: byId("rpcConfigForm"),
    mode: byId("rpcConfigMode"),
    heliusFields: byId("rpcConfigHeliusFields"),
    customFields: byId("rpcConfigCustomFields"),
    apiKey: byId("rpcConfigApiKey"),
    endpoint: byId("rpcConfigEndpoint"),
    submit: byId("rpcConfigSubmit"),
    usePublic: byId("rpcConfigUsePublic"),
    dismiss: byId("rpcConfigDismiss"),
    status: byId("rpcConfigStatus"),
  };
}

function normalizeFailureContext(context) {
  if (!context || typeof context !== "object") return null;
  return {
    code: String(context.code || "character-verification-failed"),
    stage: String(context.stage || "characterAccess"),
    reason: sanitizeRpcFailureReason(context.reason, [getStoredHeliusApiKey(), getStoredRpcOverride()]),
  };
}

function redactRpcUrl(candidate) {
  try {
    const url = new URL(candidate);
    return `${url.origin}/[endpoint-redacted]`;
  } catch {
    return "[rpc-endpoint-redacted]";
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}
