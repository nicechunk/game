const DEFAULT_MAX_MESSAGE_LENGTH = 80;

export function createMobileChatController({
  elements = {},
  submitText = () => false,
  translate = (_, fallback) => fallback,
  documentRoot = globalThis.document,
  windowTarget = globalThis,
  maxMessageLength = DEFAULT_MAX_MESSAGE_LENGTH,
} = {}) {
  const trigger = elements.mobileChatTrigger;
  const overlay = elements.mobileChatOverlay;
  const backdrop = elements.mobileChatBackdrop;
  const panel = elements.mobileChatPanel ?? overlay?.querySelector?.(".mobile-chat-panel");
  const closeButton = elements.mobileChatClose;
  const form = elements.mobileChatForm;
  const input = elements.mobileChatInput;
  const sendButton = elements.mobileChatSend;
  const status = elements.mobileChatStatus;
  let bound = false;
  let submitting = false;
  let restoreFocusTarget = null;
  let statusTranslation = null;

  const api = {
    bind,
    dispose,
    open,
    close,
    isOpen,
    submit: submitCurrentText,
    refreshTranslations,
  };

  function bind() {
    if (bound) return api;
    bound = true;
    trigger?.addEventListener?.("click", open);
    closeButton?.addEventListener?.("click", close);
    backdrop?.addEventListener?.("click", close);
    form?.addEventListener?.("submit", submitCurrentText);
    input?.addEventListener?.("input", updateSubmitState);
    panel?.addEventListener?.("pointerdown", stopPropagation);
    windowTarget?.addEventListener?.("keydown", onWindowKeyDown, true);
    windowTarget?.visualViewport?.addEventListener?.("resize", syncVisualViewport);
    windowTarget?.visualViewport?.addEventListener?.("scroll", syncVisualViewport);
    updateSubmitState();
    syncVisualViewport();
    return api;
  }

  function dispose() {
    if (!bound) return;
    close({ restoreFocus: false });
    bound = false;
    trigger?.removeEventListener?.("click", open);
    closeButton?.removeEventListener?.("click", close);
    backdrop?.removeEventListener?.("click", close);
    form?.removeEventListener?.("submit", submitCurrentText);
    input?.removeEventListener?.("input", updateSubmitState);
    panel?.removeEventListener?.("pointerdown", stopPropagation);
    windowTarget?.removeEventListener?.("keydown", onWindowKeyDown, true);
    windowTarget?.visualViewport?.removeEventListener?.("resize", syncVisualViewport);
    windowTarget?.visualViewport?.removeEventListener?.("scroll", syncVisualViewport);
  }

  function open(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!overlay || !input || isOpen()) return;
    restoreFocusTarget = documentRoot?.activeElement ?? trigger ?? null;
    overlay.hidden = false;
    overlay.setAttribute?.("aria-hidden", "false");
    trigger?.setAttribute?.("aria-expanded", "true");
    documentRoot?.body?.classList?.add?.("mobile-chat-open");
    clearStatus();
    syncVisualViewport();
    updateSubmitState();
    try {
      input.focus?.({ preventScroll: true });
    } catch {
      input.focus?.();
    }
  }

  function close(eventOrOptions) {
    const options = eventOrOptions && !eventOrOptions.preventDefault ? eventOrOptions : {};
    eventOrOptions?.preventDefault?.();
    eventOrOptions?.stopPropagation?.();
    if (!overlay || !isOpen()) return;
    overlay.hidden = true;
    overlay.setAttribute?.("aria-hidden", "true");
    trigger?.setAttribute?.("aria-expanded", "false");
    documentRoot?.body?.classList?.remove?.("mobile-chat-open");
    input?.blur?.();
    clearStatus();
    if (options.restoreFocus !== false) (restoreFocusTarget ?? trigger)?.focus?.({ preventScroll: true });
    restoreFocusTarget = null;
  }

  function isOpen() {
    return Boolean(overlay && !overlay.hidden);
  }

  async function submitCurrentText(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (submitting || !input) return false;
    const text = normalizeInput(input.value, maxMessageLength);
    if (!text) {
      updateSubmitState();
      return false;
    }

    submitting = true;
    setBusy(true);
    clearStatus();
    try {
      const result = await submitText(text);
      if (!submissionAccepted(result)) {
        showSubmissionError(result);
        return false;
      }
      input.value = "";
      close({ restoreFocus: true });
      return true;
    } catch (error) {
      console.warn("NiceChunk mobile chat submission failed:", error);
      showStatus("main.chat.submitFailed", "Message or command could not be submitted.");
      return false;
    } finally {
      submitting = false;
      setBusy(false);
      updateSubmitState();
    }
  }

  function showSubmissionError(result) {
    if (result && typeof result === "object") {
      if (result.message) {
        showStatus(null, String(result.message));
        return;
      }
      if (result.errorKey) {
        showStatus(result.errorKey, result.fallback || "Message or command could not be submitted.");
        return;
      }
    }
    showStatus("main.chat.guardianRequired", "Connect to a Guardian before sending chat.");
  }

  function showStatus(key, fallback) {
    if (!status) return;
    statusTranslation = key ? { key, fallback } : null;
    status.textContent = key ? text(key, fallback) : fallback;
    status.hidden = false;
  }

  function clearStatus() {
    statusTranslation = null;
    if (!status) return;
    status.textContent = "";
    status.hidden = true;
  }

  function refreshTranslations() {
    if (!statusTranslation || !status || status.hidden) return;
    status.textContent = text(statusTranslation.key, statusTranslation.fallback);
  }

  function updateSubmitState() {
    if (!sendButton) return;
    sendButton.disabled = submitting || !normalizeInput(input?.value, maxMessageLength);
  }

  function setBusy(busy) {
    overlay?.classList?.toggle?.("is-submitting", Boolean(busy));
    input?.toggleAttribute?.("readonly", Boolean(busy));
    if (sendButton) sendButton.disabled = Boolean(busy);
  }

  function onWindowKeyDown(event) {
    if (!isOpen() || event.key !== "Escape") return;
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    close({ restoreFocus: true });
  }

  function syncVisualViewport() {
    if (!overlay?.style) return;
    const viewport = windowTarget?.visualViewport;
    const layoutHeight = Math.max(0, Number(windowTarget?.innerHeight) || 0);
    const top = Math.min(layoutHeight || Infinity, Math.max(0, Number(viewport?.offsetTop) || 0));
    const visualHeight = Math.max(0, Number(viewport?.height) || layoutHeight);
    // Some mobile engines briefly report a visual viewport larger than the
    // layout viewport. Capping it keeps the bottom sheet inside the screen.
    const layoutSpace = layoutHeight > 0 ? Math.max(0, layoutHeight - top) : visualHeight;
    const height = layoutHeight > 0 ? Math.min(visualHeight, layoutSpace) : visualHeight;
    overlay.style.setProperty?.("--mobile-chat-viewport-top", `${top}px`);
    if (height > 0) overlay.style.setProperty?.("--mobile-chat-viewport-height", `${height}px`);
  }

  function text(key, fallback) {
    return translate(key, fallback) || fallback;
  }

  return api;
}

function submissionAccepted(result) {
  if (result && typeof result === "object" && "ok" in result) return result.ok === true;
  return result === true;
}

function normalizeInput(value, maxLength) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, Math.max(1, Number(maxLength) || DEFAULT_MAX_MESSAGE_LENGTH));
}

function stopPropagation(event) {
  event.stopPropagation?.();
}
