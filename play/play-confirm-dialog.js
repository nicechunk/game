const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function createPlayConfirmDialog({ documentRef = globalThis.document } = {}) {
  if (!documentRef?.body?.append) {
    throw new Error("Play confirmation dialogs require a document body.");
  }

  const overlay = documentRef.createElement("section");
  overlay.className = "play-confirm-overlay";
  overlay.hidden = true;
  overlay.setAttribute("role", "presentation");
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <article class="play-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="playConfirmTitle" aria-describedby="playConfirmMessage playConfirmDetail">
      <header class="play-confirm-header">
        <span class="play-confirm-icon" aria-hidden="true"><i></i></span>
        <div class="play-confirm-heading">
          <span class="play-confirm-eyebrow"></span>
          <h2 id="playConfirmTitle"></h2>
        </div>
        <button class="play-confirm-close" type="button" aria-label="Cancel">&times;</button>
      </header>
      <div class="play-confirm-content">
        <p id="playConfirmMessage" class="play-confirm-message"></p>
        <p id="playConfirmDetail" class="play-confirm-detail"></p>
      </div>
      <footer class="play-confirm-actions">
        <button class="play-confirm-cancel" type="button"></button>
        <button class="play-confirm-accept" type="button"></button>
      </footer>
    </article>
  `;
  documentRef.body.append(overlay);

  const dialog = overlay.querySelector(".play-confirm-dialog");
  const eyebrow = overlay.querySelector(".play-confirm-eyebrow");
  const title = overlay.querySelector("#playConfirmTitle");
  const message = overlay.querySelector("#playConfirmMessage");
  const detail = overlay.querySelector("#playConfirmDetail");
  const closeButton = overlay.querySelector(".play-confirm-close");
  const cancelButton = overlay.querySelector(".play-confirm-cancel");
  const acceptButton = overlay.querySelector(".play-confirm-accept");
  const queue = [];
  let active = null;
  let previousFocus = null;

  closeButton.addEventListener("click", () => settle(false));
  cancelButton.addEventListener("click", () => settle(false));
  acceptButton.addEventListener("click", () => settle(true));
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) settle(false);
  });
  overlay.addEventListener("keydown", handleKeyDown);

  return {
    confirm,
    cancel: () => settle(false),
    destroy,
    isOpen: () => Boolean(active),
  };

  function confirm(options = {}) {
    return new Promise((resolve) => {
      queue.push({ options: normalizeOptions(options), resolve });
      showNext();
    });
  }

  function showNext() {
    if (active || !queue.length) return;
    active = queue.shift();
    previousFocus = documentRef.activeElement;
    const options = active.options;
    overlay.dataset.tone = options.tone;
    eyebrow.textContent = options.eyebrow;
    title.textContent = options.title;
    message.textContent = options.message;
    detail.textContent = options.detail;
    detail.hidden = !options.detail;
    cancelButton.textContent = options.cancelLabel;
    acceptButton.textContent = options.confirmLabel;
    closeButton.setAttribute("aria-label", options.cancelLabel);
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    documentRef.body.classList.add("play-confirm-open");
    if (documentRef.pointerLockElement) documentRef.exitPointerLock?.();
    (globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0)))(() => acceptButton.focus());
  }

  function settle(confirmed) {
    if (!active) return;
    const completed = active;
    active = null;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    delete overlay.dataset.tone;
    documentRef.body.classList.remove("play-confirm-open");
    completed.resolve(Boolean(confirmed));
    if (previousFocus?.isConnected && typeof previousFocus.focus === "function") previousFocus.focus();
    previousFocus = null;
    showNext();
  }

  function handleKeyDown(event) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      settle(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && documentRef.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && documentRef.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function destroy() {
    if (active) active.resolve(false);
    queue.splice(0).forEach((request) => request.resolve(false));
    active = null;
    documentRef.body.classList.remove("play-confirm-open");
    overlay.remove();
  }
}

function normalizeOptions(options) {
  return {
    tone: options?.tone === "danger" ? "danger" : "neutral",
    eyebrow: cleanText(options?.eyebrow, "Confirmation Required"),
    title: cleanText(options?.title, "Confirm action"),
    message: cleanText(options?.message, "Continue with this action?"),
    detail: cleanText(options?.detail, ""),
    confirmLabel: cleanText(options?.confirmLabel, "Confirm"),
    cancelLabel: cleanText(options?.cancelLabel, "Cancel"),
  };
}

function cleanText(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}
