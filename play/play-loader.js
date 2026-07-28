(() => {
  "use strict";

  const script = document.currentScript;
  if (!script || globalThis.NiceChunkLoading) return;

  const supportedLanguages = ["en", "es", "fr", "de", "ja", "ru", "ko", "zh-Hant", "zh-Hans"];
  const manifestUrl = script.dataset.manifest || "";
  const startedAt = performance.now();
  const files = new Map();
  const holds = new Set();
  let dictionary = {};
  let renderQueued = false;
  let assetsSettled = !manifestUrl;
  let worldVisible = false;
  let finished = false;
  let failed = false;
  let stageProgress = 0.02;
  let worldProgress = 0;
  let displayedProgress = 0;
  let finishTimer = 0;

  const style = document.createElement("style");
  style.dataset.nicechunkLoader = "true";
  style.textContent = `
    html,body{width:100%;max-width:100%;height:100%;margin:0;overflow:hidden}
    #nc-loader{--nc-p:0;position:fixed;inset:0;width:100%;height:100%;z-index:2147483647;display:grid;grid-template-rows:auto 1fr auto;box-sizing:border-box;overflow:hidden;color:#15434a;background:linear-gradient(180deg,#cfedf6 0%,#eef8fb 48%,#fff7e9 100%);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;letter-spacing:.04em;opacity:1;transition:opacity .42s ease,visibility .42s ease}
    #nc-loader::before{content:"";position:absolute;inset:auto 0 0;height:13vh;min-height:70px;background:rgba(185,205,194,.2);clip-path:polygon(0 100%,0 82%,7% 58%,14% 76%,22% 51%,31% 69%,39% 43%,48% 67%,57% 38%,66% 62%,76% 34%,85% 56%,94% 31%,100% 45%,100% 100%)}
    #nc-loader.is-ready{opacity:0;visibility:hidden;pointer-events:none}
    #nc-loader.is-dialog-open{opacity:0;visibility:hidden;pointer-events:none}
    #nc-loader.is-failed{--nc-accent:#d34b43}
    .nc-load-head,.nc-load-foot{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;padding:clamp(20px,4vw,48px) clamp(20px,5vw,64px);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.14em}
    .nc-load-brand{color:#006d78;letter-spacing:.18em}
    .nc-load-main{position:relative;z-index:2;align-self:center;justify-self:center;width:min(520px,calc(100vw - 40px));transform:translateY(-2vh);text-align:center}
    .nc-load-voxels{display:grid;grid-template-columns:repeat(3,11px);gap:4px;width:max-content;margin:0 auto 29px}
    .nc-load-voxels i{width:11px;height:11px;background:#00717b;animation:nc-voxel 1.8s ease-in-out infinite;will-change:transform}.nc-load-voxels i:nth-child(2n){background:#00cfe2}.nc-load-voxels i:nth-child(3n+2){animation-delay:.16s}.nc-load-voxels i:nth-child(3n){animation-delay:.32s}.nc-load-voxels i:nth-child(3n+1){animation-delay:.48s}
    .nc-load-title{min-height:14px;margin:0 0 8px;color:rgba(41,62,66,.74);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.24em}
    .nc-load-percent{color:#00717b;font-family:ui-sans-serif,system-ui,sans-serif;font-size:clamp(42px,5vw,60px);font-weight:800;line-height:1}
    .nc-load-rail{position:relative;width:min(440px,80vw);height:4px;margin:35px auto 42px;overflow:hidden;border-radius:10px;background:rgba(255,255,255,.42);box-shadow:inset 0 1px 1px rgba(21,109,120,.08)}
    .nc-load-bar{position:absolute;inset:0 auto 0 0;width:calc(var(--nc-p)*1%);overflow:hidden;border-radius:inherit;background:var(--nc-accent,#00d5e8);transition:width .28s ease-out}
    .nc-load-bar::after{content:"";position:absolute;inset:0;width:90px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.8),transparent);transform:translateX(-100%);animation:nc-shimmer 1.65s linear infinite;will-change:transform}
    .nc-load-card{box-sizing:border-box;width:100%;min-height:150px;padding:20px 22px 18px;overflow:hidden;border-radius:10px;background:linear-gradient(135deg,rgba(255,255,255,.22),rgba(255,255,255,.08));backdrop-filter:blur(18px) saturate(1.08);-webkit-backdrop-filter:blur(18px) saturate(1.08);text-align:left}
    .nc-load-files{display:grid;gap:0}.nc-load-row{display:grid;grid-template-columns:12px minmax(0,1fr) auto auto;align-items:center;gap:11px;min-height:31px;color:rgba(42,64,68,.64);font-size:11px}.nc-load-row+.nc-load-row{border-top:1px solid rgba(255,255,255,.14)}
    .nc-load-row.is-active{min-height:42px;color:#006d78;font-weight:700}.nc-load-row.is-failed{color:#b63d36}.nc-load-dot{width:7px;height:7px;box-sizing:border-box;border:1px solid currentColor}.is-active .nc-load-dot{border:0;border-radius:50%;background:#00d5e8;animation:nc-pulse 1.25s ease-in-out infinite}.is-done .nc-load-dot::after{content:"";display:block;width:3px;height:1px;margin:1px 0 0 1px;border:solid currentColor;border-width:0 0 1px 1px;transform:rotate(-45deg)}
    .nc-load-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nc-load-size,.nc-load-state{white-space:nowrap}.nc-load-state{min-width:64px;text-align:right;text-transform:uppercase;letter-spacing:.12em}
    .nc-load-error{display:none;margin-top:4px;color:#7c302d;font:600 11px/1.45 ui-sans-serif,system-ui,sans-serif;letter-spacing:0}.is-failed .nc-load-error{display:grid;gap:6px}.is-failed .nc-load-files{display:none}.nc-load-error strong{color:#8d2c28;font-size:13px}.nc-load-error code{color:#51686a;white-space:pre-line;overflow-wrap:anywhere}.nc-load-actions{display:none;flex-wrap:wrap;gap:7px;margin-top:12px}.is-failed .nc-load-actions{display:flex}.nc-load-actions button{min-height:32px;padding:8px 13px;border:1px solid rgba(120,62,58,.2);border-radius:5px;color:#fff;background:#b7443e;font:700 10px/1 ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em;cursor:pointer}.nc-load-actions button+button{color:#744844;background:rgba(255,255,255,.48)}.nc-load-actions button:disabled{opacity:.55;cursor:wait}.nc-load-rpc-action[hidden]{display:none}
    .nc-load-foot{padding-top:16px;padding-bottom:max(16px,env(safe-area-inset-bottom));color:rgba(45,63,65,.58);font-weight:600}.nc-load-metrics,.nc-load-stage{display:flex;align-items:center;gap:12px}.nc-load-stage::before{content:"";width:6px;height:6px;border-radius:50%;background:#91765d}.nc-load-version{text-align:right}
    @keyframes nc-voxel{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}@keyframes nc-pulse{50%{opacity:.35;transform:scale(.72)}}@keyframes nc-shimmer{to{transform:translateX(520%)}}
    @media(max-width:600px){.nc-load-head{padding:calc(17px + env(safe-area-inset-top)) 18px 14px;font-size:9px}.nc-load-main{width:calc(100vw - 28px);transform:translateY(-1vh)}.nc-load-voxels{grid-template-columns:repeat(3,9px);gap:3px;margin-bottom:21px}.nc-load-voxels i{width:9px;height:9px}.nc-load-title{font-size:9px}.nc-load-percent{font-size:42px}.nc-load-rail{width:72vw;margin:25px auto 28px}.nc-load-card{min-height:122px;padding:13px 14px 11px;border-radius:8px}.is-failed .nc-load-card{max-height:52vh;overflow:auto}.nc-load-row{grid-template-columns:10px minmax(0,1fr) auto;gap:8px;min-height:29px;font-size:9px}.nc-load-row:nth-child(n+4){display:none}.nc-load-row .nc-load-size{display:none}.nc-load-row.is-active{min-height:38px}.nc-load-state{min-width:48px}.nc-load-actions button{flex:1 1 auto}.nc-load-foot{padding:12px 17px max(13px,env(safe-area-inset-bottom));font-size:8px}.nc-load-version{display:none}.nc-load-metrics{gap:7px}.nc-load-stage{max-width:48vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
    @media(max-height:520px){.nc-load-head{padding-top:12px;padding-bottom:8px}.nc-load-main{transform:none}.nc-load-voxels{margin-bottom:12px}.nc-load-title{margin-bottom:4px}.nc-load-percent{font-size:32px}.nc-load-rail{margin:14px auto 16px}.nc-load-card{min-height:78px;padding:8px 12px}.is-failed .nc-load-card{max-height:48vh}.nc-load-row{min-height:24px}.nc-load-row:nth-child(n+3){display:none}.nc-load-foot{padding-top:7px;padding-bottom:7px}}
    @media(prefers-reduced-motion:reduce){#nc-loader,.nc-load-bar{transition:none}.nc-load-voxels i,.nc-load-bar::after,.is-active .nc-load-dot{animation:none}}
  `;
  document.head.append(style);

  const overlay = document.createElement("div");
  overlay.id = "nc-loader";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.innerHTML = `<header class="nc-load-head"><span class="nc-load-brand">NICECHUNK</span></header><main class="nc-load-main"><span class="nc-load-voxels" aria-hidden="true">${"<i></i>".repeat(9)}</span><p class="nc-load-title"></p><div class="nc-load-percent">0%</div><div class="nc-load-rail"><i class="nc-load-bar"></i></div><section class="nc-load-card"><div class="nc-load-files"></div><div class="nc-load-error"><strong></strong><code></code></div><div class="nc-load-actions"><button class="nc-load-retry" type="button"></button><button class="nc-load-refresh" type="button"></button><button class="nc-load-rpc-action" type="button" hidden></button></div></section></main><footer class="nc-load-foot"><span class="nc-load-metrics"></span><span class="nc-load-stage"></span><span class="nc-load-version"></span></footer>`;
  document.documentElement.append(overlay);

  const select = (selector) => overlay.querySelector(selector);
  const titleElement = select(".nc-load-title");
  const percentElement = select(".nc-load-percent");
  const filesElement = select(".nc-load-files");
  const errorTitleElement = select(".nc-load-error strong");
  const errorBodyElement = select(".nc-load-error code");
  const retryButton = select(".nc-load-retry");
  const refreshButton = select(".nc-load-refresh");
  const rpcButton = select(".nc-load-rpc-action");
  const metricsElement = select(".nc-load-metrics");
  const stageElement = select(".nc-load-stage");
  const versionElement = select(".nc-load-version");

  const state = {
    stage: "boot",
    version: "",
    error: "",
    failureCode: "",
    failureOptions: null,
    retrying: false,
    rpcOpening: false,
    rpcDialogOpen: false,
    booting: false,
    manifest: null,
  };

  const api = globalThis.NiceChunkLoading = {
    setDictionary,
    stage: setStage,
    taskStart,
    taskDone,
    worldProgress: setWorldProgress,
    worldReady,
    ready: worldReady,
    fail,
    snapshot,
  };

  retryButton.addEventListener("click", retryFailure);
  refreshButton.addEventListener("click", () => location.reload());
  rpcButton.addEventListener("click", openRpcSettings);
  registerSelf();
  observeResources();
  renderNow();
  if (manifestUrl) void boot();

  async function boot() {
    if (state.booting || finished) return;
    state.booting = true;
    holds.add("client-entry");
    try {
      const manifestResponse = await fetchTracked({ url: manifestUrl, type: "manifest", phase: "critical" }, { cache: "no-cache" });
      const manifest = await manifestResponse.json();
      validateManifest(manifest);
      state.manifest = manifest;
      state.version = String(manifest.version || "");
      setDictionary(manifest.dictionary);
      registerManifestFiles(manifest);

      const localePromise = loadLocale(manifest);
      const critical = manifest.files.filter((file) => file.phase === "critical");
      const criticalResponses = await Promise.all(critical.map((file) => fetchTracked(file, { cache: "force-cache" })));
      await localePromise;
      await Promise.all(critical.map((file, index) => file.type === "style" ? applyStyle(file.url, criticalResponses[index]) : null));

      const startupFiles = manifest.files.filter((file) => file.phase === "startup");
      const startupLoads = Promise.allSettled(startupFiles.map((file) => fetchTracked(file, { cache: "force-cache" }))).then(() => {
        assetsSettled = true;
        queueRender();
        maybeFinish();
      });

      setStage("engine", 0.34);
      await import(manifest.entry.url);
      holds.delete("client-entry");
      await startupLoads;
      maybeFinish();
    } catch (error) {
      holds.delete("client-entry");
      fail(error);
    } finally {
      state.booting = false;
    }
  }

  function validateManifest(manifest) {
    if (!manifest || manifest.schemaVersion !== 1 || !manifest.entry?.url || !Array.isArray(manifest.files)) {
      throw new Error("Invalid Play loading manifest.");
    }
  }

  function registerManifestFiles(manifest) {
    for (const file of manifest.files) ensureFile(file);
    const language = selectedLanguage();
    const locale = manifest.locales?.[language] || manifest.locales?.en;
    if (locale) ensureFile({ ...locale, type: "locale", phase: "critical" });
    queueRender();
  }

  async function loadLocale(manifest) {
    const language = selectedLanguage();
    const locale = manifest.locales?.[language] || manifest.locales?.en;
    if (!locale?.url) return;
    const cached = cachedDictionary(language, manifest.version);
    if (cached) {
      markCached(locale);
      setDictionary(cached);
      return;
    }
    setStage("language", 0.18);
    const response = await fetchTracked({ ...locale, type: "locale", phase: "critical" }, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const localeBase = locale.url.slice(0, locale.url.lastIndexOf("/"));
    globalThis.__nicechunkLocalePreload = {
      language,
      localeBase,
      promise: Promise.resolve(response),
    };
    setDictionary(await response.clone().json());
  }

  async function fetchTracked(descriptor, options = {}) {
    const item = ensureFile(descriptor);
    if (item.promise) return item.promise;
    item.status = "loading";
    item.startedAt = performance.now();
    item.loaded = 0;
    queueRender();
    item.promise = fetch(item.url, { credentials: "same-origin", ...options }).then(async (response) => {
      if (!response.ok) throw new Error(`${safeName(item.url)}: HTTP ${response.status}`);
      if (!item.total) item.total = positiveNumber(response.headers.get("content-length"));
      await readProgress(response.clone(), item);
      item.status = "done";
      item.loaded = item.total || item.loaded;
      item.doneAt = performance.now();
      queueRender();
      return response;
    }).catch((error) => {
      item.status = "failed";
      item.doneAt = performance.now();
      item.error = cleanError(error);
      queueRender();
      throw error;
    });
    return item.promise;
  }

  async function readProgress(response, item) {
    if (!response.body?.getReader) return;
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      item.loaded += value?.byteLength || 0;
      if (item.total) item.loaded = Math.min(item.loaded, item.total);
      queueRender();
    }
  }

  function applyStyle(url) {
    if (document.querySelector(`link[data-nc-loaded-style="${cssEscape(url)}"]`)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.crossOrigin = "anonymous";
      link.dataset.ncLoadedStyle = url;
      link.addEventListener("load", resolve, { once: true });
      link.addEventListener("error", () => reject(new Error(`${safeName(url)}: stylesheet failed`)), { once: true });
      document.head.append(link);
    });
  }

  function ensureFile(descriptor) {
    const url = absoluteUrl(descriptor.url);
    let item = files.get(url);
    if (!item) {
      item = {
        url,
        name: descriptor.name || safeName(url),
        type: descriptor.type || "asset",
        phase: descriptor.phase || "observed",
        total: positiveNumber(descriptor.bytes),
        loaded: 0,
        status: "queued",
        startedAt: 0,
        doneAt: 0,
        cached: false,
        promise: null,
      };
      files.set(url, item);
    } else if (!item.total) {
      item.total = positiveNumber(descriptor.bytes);
    }
    return item;
  }

  function registerSelf() {
    const url = absoluteUrl(script.src);
    const timing = performance.getEntriesByName(url).at(-1);
    const item = ensureFile({ url, type: "loader", phase: "critical", bytes: timing?.decodedBodySize || timing?.transferSize || 0 });
    item.status = "done";
    item.loaded = item.total;
    item.doneAt = performance.now();
    item.cached = Boolean(timing && timing.transferSize === 0);
  }

  function observeResources() {
    if (!("PerformanceObserver" in globalThis)) return;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!isDisplayResource(entry.name)) continue;
        const item = ensureFile({
          url: entry.name,
          type: entry.initiatorType || "asset",
          bytes: entry.decodedBodySize || entry.encodedBodySize || entry.transferSize || 0,
        });
        if (item.status === "queued") {
          item.status = "done";
          item.loaded = item.total;
          item.doneAt = performance.now();
        }
        if (entry.initiatorType === "fetch" || !item.startedAt) item.cached ||= entry.transferSize === 0;
      }
      queueRender();
    });
    try {
      observer.observe({ type: "resource", buffered: true });
    } catch {
      observer.observe({ entryTypes: ["resource"] });
    }
  }

  function isDisplayResource(value) {
    try {
      const url = new URL(value, location.href);
      if (url.origin !== location.origin) return false;
      return url.pathname.startsWith("/runtime/")
        || url.pathname.startsWith("/assets/")
        || url.pathname.startsWith("/play/locales/")
        || /\.(?:js|css|json|wasm|webmanifest|png|ico)$/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function markCached(descriptor) {
    const item = ensureFile(descriptor);
    item.status = "done";
    item.loaded = item.total;
    item.doneAt = performance.now();
    item.cached = true;
    queueRender();
  }

  function setDictionary(value) {
    dictionary = value && typeof value === "object" ? value : {};
    queueRender();
  }

  function setStage(id, progress = null) {
    if (finished || failed) return;
    state.stage = String(id || "boot");
    if (Number.isFinite(Number(progress))) stageProgress = Math.max(stageProgress, Math.min(1, Number(progress)));
    queueRender();
  }

  function taskStart(id) {
    if (finished || failed || !id) return;
    holds.add(String(id));
    if (["player", "backpack", "chunks"].includes(String(id))) setStage("chainSync", 0.72);
  }

  function taskDone(id) {
    holds.delete(String(id || ""));
    queueRender();
    maybeFinish();
  }

  function setWorldProgress(value) {
    if (finished || failed) return;
    worldProgress = Math.max(worldProgress, Math.min(1, Number(value) || 0));
    if (worldProgress > 0) setStage("chunks", 0.84);
    queueRender();
  }

  function worldReady() {
    if (finished || failed) return;
    worldVisible = true;
    worldProgress = 1;
    setStage("ready", 1);
    clearTimeout(finishTimer);
    finishTimer = setTimeout(forceFinish, 12000);
    maybeFinish();
  }

  function maybeFinish() {
    if (!worldVisible || !assetsSettled || holds.size || failed || finished) return;
    state.stage = "ready";
    forceFinish();
  }

  function forceFinish() {
    if (!worldVisible || failed || finished) return;
    finished = true;
    displayedProgress = 100;
    renderNow();
    const minimumDelay = Math.max(180, 620 - (performance.now() - startedAt));
    setTimeout(() => {
      overlay.classList.add("is-ready");
      setTimeout(() => overlay.remove(), 460);
    }, minimumDelay);
  }

  function fail(error, options = {}) {
    if (finished) return;
    failed = true;
    state.error = cleanError(error);
    state.failureCode = String(options?.code || "");
    state.failureOptions = options && typeof options === "object" ? options : {};
    state.retrying = false;
    state.rpcOpening = false;
    resumeFromRpcDialog();
    if (options?.stage) state.stage = String(options.stage);
    console.error("[NiceChunk Loader]", error);
    overlay.classList.add("is-failed");
    overlay.setAttribute("role", "alert");
    queueRender();
  }

  async function retryFailure() {
    if (state.retrying || state.rpcOpening || state.rpcDialogOpen) return;
    const retry = state.failureOptions?.onRetry;
    if (typeof retry !== "function") {
      location.reload();
      return;
    }
    state.retrying = true;
    failed = false;
    state.error = "";
    state.failureCode = "";
    overlay.classList.remove("is-failed");
    overlay.setAttribute("role", "status");
    queueRender();
    try {
      await retry();
    } catch (error) {
      fail(error);
    } finally {
      state.retrying = false;
      queueRender();
    }
  }

  async function openRpcSettings() {
    const open = state.failureOptions?.rpc?.onOpen;
    if (typeof open !== "function" || state.retrying || state.rpcOpening || state.rpcDialogOpen) return;
    state.rpcOpening = true;
    queueRender();
    try {
      const result = await open({
        code: state.failureCode,
        stage: state.stage,
        reason: state.error,
        onPresented: suspendForRpcDialog,
      });
      if (result?.action === "saved") {
        state.rpcOpening = false;
        resumeFromRpcDialog();
        await retryFailure();
      }
    } catch (error) {
      state.error = cleanError(error);
    } finally {
      state.rpcOpening = false;
      resumeFromRpcDialog();
      queueRender();
    }
  }

  function suspendForRpcDialog() {
    state.rpcDialogOpen = true;
    overlay.classList.add("is-dialog-open");
    overlay.setAttribute("aria-hidden", "true");
    overlay.inert = true;
  }

  function resumeFromRpcDialog() {
    state.rpcDialogOpen = false;
    overlay.classList.remove("is-dialog-open");
    overlay.removeAttribute("aria-hidden");
    overlay.inert = false;
    overlay.setAttribute("role", failed ? "alert" : "status");
  }

  function snapshot() {
    return {
      visible: overlay.isConnected
        && !overlay.classList.contains("is-ready")
        && !overlay.classList.contains("is-dialog-open"),
      progress: Math.round(displayedProgress),
      stage: state.stage,
      assetsSettled,
      worldVisible,
      error: state.error,
      failureCode: state.failureCode,
      rpcDialogOpen: state.rpcDialogOpen,
      pendingTasks: Array.from(holds),
      files: Array.from(files.values(), (file) => ({ name: file.name, status: file.status, loaded: file.loaded, total: file.total, cached: file.cached })),
    };
  }

  function queueRender() {
    if (renderQueued || finished && !overlay.isConnected) return;
    renderQueued = true;
    requestAnimationFrame(renderNow);
  }

  function renderNow() {
    renderQueued = false;
    const labels = dictionary?.main?.loading?.loader || {};
    const stageLabels = dictionary?.main?.loading?.stages || {};
    const progress = finished ? 100 : calculateProgress();
    displayedProgress = Math.max(displayedProgress, progress);
    overlay.style.setProperty("--nc-p", displayedProgress.toFixed(2));
    percentElement.textContent = `${Math.floor(displayedProgress)}%`;
    titleElement.textContent = labels.generatingWorld || dictionary?.main?.loading?.title || "";
    versionElement.textContent = state.version ? `NICECHUNK ${shortVersion(state.version)}` : "NICECHUNK";
    stageElement.textContent = stageLabels[state.stage]?.title || "";
    const failureCopy = labels.failures?.[state.failureCode] || {};
    errorTitleElement.textContent = failureCopy.title || labels.failureMessage || labels.failed || "";
    errorBodyElement.textContent = [
      failureCopy.message,
      failureCopy.help,
      state.error ? formatTemplate(labels.errorDetail || "{reason}", { reason: state.error }) : "",
    ].filter(Boolean).join("\n");
    retryButton.textContent = state.retrying ? labels.retrying || labels.loading || "" : labels.retry || "";
    retryButton.disabled = state.retrying || state.rpcOpening;
    refreshButton.textContent = labels.refresh || "";
    refreshButton.disabled = state.retrying || state.rpcOpening;
    rpcButton.textContent = labels.rpcSettings || "";
    rpcButton.hidden = !state.failureOptions?.rpc;
    rpcButton.disabled = state.retrying || state.rpcOpening;
    renderFiles(labels);
    renderMetrics(labels);
  }

  function calculateProgress() {
    const list = Array.from(files.values()).filter((file) => file.status !== "queued" || file.total);
    if (manifestUrl && !state.manifest) {
      const manifest = list.find((file) => file.type === "manifest");
      const ratio = manifest?.total
        ? Math.min(1, manifest.loaded / manifest.total)
        : manifest?.status === "done" ? 1 : 0;
      return 2 + ratio * 6;
    }
    const known = list.filter((file) => file.total > 0);
    const total = known.reduce((sum, file) => sum + file.total, 0);
    const loaded = known.reduce((sum, file) => sum + (file.status === "done" ? file.total : Math.min(file.loaded, file.total)), 0);
    const byteRatio = total ? loaded / total : 0;
    const value = byteRatio * 72 + stageProgress * 18 + worldProgress * 10;
    return Math.min(99, Math.max(0, value));
  }

  function renderFiles(labels) {
    const all = Array.from(files.values());
    const active = all.filter((file) => file.status === "loading" || file.status === "failed").sort((a, b) => b.startedAt - a.startedAt);
    const completed = all.filter((file) => file.status === "done").sort((a, b) => b.doneAt - a.doneAt);
    const visible = [...active, ...completed].slice(0, 5);
    filesElement.replaceChildren(...visible.map((file) => fileRow(file, labels)));
  }

  function fileRow(file, labels) {
    const row = document.createElement("div");
    const statusClass = file.status === "done" ? "is-done" : file.status === "failed" ? "is-failed" : "is-active";
    row.className = `nc-load-row ${statusClass}`;
    const dot = document.createElement("i");
    dot.className = "nc-load-dot";
    dot.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "nc-load-name";
    name.textContent = file.name;
    name.title = file.name;
    const size = document.createElement("span");
    size.className = "nc-load-size";
    size.textContent = file.total ? `${Math.round(file.loaded / file.total * 100)}%` : "";
    const status = document.createElement("span");
    status.className = "nc-load-state";
    status.textContent = file.status === "failed"
      ? labels.failed || ""
      : file.status === "done"
        ? file.cached ? labels.cached || labels.complete || "" : labels.complete || ""
        : labels.loading || "";
    row.append(dot, name, size, status);
    return row;
  }

  function renderMetrics(labels) {
    const all = Array.from(files.values());
    const completed = all.filter((file) => file.status === "done").length;
    metricsElement.textContent = formatTemplate(labels.files || "{loaded} / {total}", { loaded: completed, total: all.length });
  }

  function cachedDictionary(language, version) {
    if (!version) return null;
    try {
      if (localStorage.getItem(`nicechunk.play.locale.version.${language}`) !== version) return null;
      const raw = localStorage.getItem(`nicechunk.play.locale.data.${language}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function selectedLanguage() {
    let stored = "";
    try {
      stored = String(localStorage.getItem("nicechunk.language") || "").trim();
    } catch {
      return "en";
    }
    if (supportedLanguages.includes(stored)) return stored;
    const lower = stored.toLowerCase();
    if (["zh-tw", "zh-hk", "zh-mo", "zh-hant"].includes(lower)) return "zh-Hant";
    if (["zh", "zh-cn", "zh-sg", "zh-hans"].includes(lower)) return "zh-Hans";
    return supportedLanguages.find((code) => code.toLowerCase() === lower.split("-")[0]) || "en";
  }

  function formatTemplate(template, values) {
    return String(template).replace(/\{(\w+)\}/g, (_match, key) => key in values ? String(values[key]) : `{${key}}`);
  }

  function safeName(value) {
    try {
      const pathname = new URL(value, location.href).pathname;
      return decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1)) || "resource";
    } catch {
      return "resource";
    }
  }

  function absoluteUrl(value) {
    return new URL(String(value || ""), location.href).href;
  }

  function positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function cleanError(error) {
    return String(error?.message || error || "Loading failed").replace(/https?:\/\/\S+/g, (url) => safeName(url)).slice(0, 240);
  }

  function shortVersion(value) {
    return String(value).replace(/^play-bundle-/, "v").slice(0, 18);
  }

  function cssEscape(value) {
    return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
  }
})();
