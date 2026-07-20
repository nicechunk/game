/* global __BUILD_VERSION__ */

export const languageOrder = ["en", "es", "fr", "de", "ja", "ru", "ko", "zh-Hant", "zh-Hans"];

export const languages = [
  { code: "en", key: "en", englishName: "English" },
  { code: "es", key: "es", englishName: "Spanish" },
  { code: "fr", key: "fr", englishName: "French" },
  { code: "de", key: "de", englishName: "German" },
  { code: "ja", key: "ja", englishName: "Japanese" },
  { code: "ru", key: "ru", englishName: "Russian" },
  { code: "ko", key: "ko", englishName: "Korean" },
  { code: "zh-Hant", key: "zhHant", englishName: "Traditional Chinese" },
  { code: "zh-Hans", key: "zhHans", englishName: "Simplified Chinese" },
];

const languageCodes = new Set(languageOrder);
const defaultI18nConfig = {
  localeBase: "/home/locales",
  storageKeys: {
    language: "nicechunk.language",
    localeVersionPrefix: "nicechunk.home.locale.version.",
    localeDataPrefix: "nicechunk.home.locale.data.",
  },
};
const scopedI18nConfig = {
  home: {
    localeBase: "/home/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.home.locale.version.",
      localeDataPrefix: "nicechunk.home.locale.data.",
    },
  },
  login: {
    localeBase: "/login/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.login.locale.version.",
      localeDataPrefix: "nicechunk.login.locale.data.",
    },
  },
  docs: {
    localeBase: "/docs/locales",
    cacheDictionaries: false,
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.docs.locale.version.",
      localeDataPrefix: "nicechunk.docs.locale.data.",
    },
  },
  roadmap: {
    localeBase: "/roadmap/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.roadmap.locale.version.",
      localeDataPrefix: "nicechunk.roadmap.locale.data.",
    },
  },
  fairness: {
    localeBase: "/fairness/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.fairness.locale.version.",
      localeDataPrefix: "nicechunk.fairness.locale.data.",
    },
  },
  play: {
    localeBase: "/play/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.play.locale.version.",
      localeDataPrefix: "nicechunk.play.locale.data.",
    },
  },
  ncm: {
    localeBase: "/ncm/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.ncm.locale.version.",
      localeDataPrefix: "nicechunk.ncm.locale.data.",
    },
  },
  ncm4: {
    localeBase: "/ncm4/locales",
    cacheDictionaries: false,
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.ncm4.locale.version.",
      localeDataPrefix: "nicechunk.ncm4.locale.data.",
    },
  },
  ncfm: {
    localeBase: "/ncfm/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.ncfm.locale.version.",
      localeDataPrefix: "nicechunk.ncfm.locale.data.",
    },
  },
  ncmDna: {
    localeBase: "/ncm_dna/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.ncmDna.locale.version.",
      localeDataPrefix: "nicechunk.ncmDna.locale.data.",
    },
  },
  fourierPickaxe: {
    localeBase: "/fourier-pickaxe/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.fourierPickaxe.locale.version.",
      localeDataPrefix: "nicechunk.fourierPickaxe.locale.data.",
    },
  },
  fourierVoxel: {
    localeBase: "/fourier-voxel/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.fourierVoxel.locale.version.",
      localeDataPrefix: "nicechunk.fourierVoxel.locale.data.",
    },
  },
  trust: {
    localeBase: "/trust/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.trust.locale.version.",
      localeDataPrefix: "nicechunk.trust.locale.data.",
    },
  },
  elements: {
    localeBase: "/elements/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.elements.locale.version.",
      localeDataPrefix: "nicechunk.elements.locale.data.",
    },
  },
  resourceRule: {
    localeBase: "/resource_rule/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.resourceRule.locale.version.",
      localeDataPrefix: "nicechunk.resourceRule.locale.data.",
    },
  },
  proofOfFrontier: {
    localeBase: "/proof-of-frontier/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.proofOfFrontier.locale.version.",
      localeDataPrefix: "nicechunk.proofOfFrontier.locale.data.",
    },
  },
  forging: {
    localeBase: "/forging/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.forging.locale.version.",
      localeDataPrefix: "nicechunk.forging.locale.data.",
    },
  },
  contracts: {
    localeBase: "/contracts/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.contracts.locale.version.",
      localeDataPrefix: "nicechunk.contracts.locale.data.",
    },
  },
  seed: {
    localeBase: "/seed/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.seed.locale.version.",
      localeDataPrefix: "nicechunk.seed.locale.data.",
    },
  },
  chip: {
    localeBase: "/chip/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.chip.locale.version.",
      localeDataPrefix: "nicechunk.chip.locale.data.",
    },
  },
  playerSet: {
    localeBase: "/player_set/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.playerSet.locale.version.",
      localeDataPrefix: "nicechunk.playerSet.locale.data.",
    },
  },
  playerCreat: {
    localeBase: "/player_creat/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.playerCreat.locale.version.",
      localeDataPrefix: "nicechunk.playerCreat.locale.data.",
    },
  },
  worldRule: {
    localeBase: "/world_rule/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.worldRule.locale.version.",
      localeDataPrefix: "nicechunk.worldRule.locale.data.",
    },
  },
  mining: {
    localeBase: "/mining/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.mining.locale.version.",
      localeDataPrefix: "nicechunk.mining.locale.data.",
    },
  },
  guardian: {
    localeBase: "/guardian/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.guardian.locale.version.",
      localeDataPrefix: "nicechunk.guardian.locale.data.",
    },
  },
  civilization: {
    localeBase: "/civilization/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.civilization.locale.version.",
      localeDataPrefix: "nicechunk.civilization.locale.data.",
    },
  },
  civilizationValue: {
    localeBase: "/civilization/value/locales",
    storageKeys: {
      language: "nicechunk.language",
      localeVersionPrefix: "nicechunk.civilizationValue.locale.version.",
      localeDataPrefix: "nicechunk.civilizationValue.locale.data.",
    },
  },
};
const pageI18nScope = detectPageI18nScope();
const activeI18nConfig = scopedI18nConfig[pageI18nScope] ?? defaultI18nConfig;
const languageStorageKey = activeI18nConfig.storageKeys.language;
const localeVersionPrefix = activeI18nConfig.storageKeys.localeVersionPrefix;
const localeDataPrefix = activeI18nConfig.storageKeys.localeDataPrefix;
const defaultLanguage = "en";
const standaloneBuildVersion = typeof document === "undefined"
  ? ""
  : String(document.documentElement?.dataset?.i18nBuildVersion || "");
const buildVersion = typeof __BUILD_VERSION__ === "string"
  ? __BUILD_VERSION__
  : standaloneBuildVersion || "source";

let activeLanguage = normalizeLanguage(localStorage.getItem(languageStorageKey)) || defaultLanguage;
let activeDictionary = {};
let fallbackDictionary = {};
let fallbackDictionaryPromise = null;
let readyPromise = null;
let languageLoadSequence = 0;

function detectPageI18nScope() {
  if (typeof document === "undefined") return "";
  return document.documentElement?.dataset?.i18nScope || document.body?.dataset?.i18nScope || "";
}

export async function initI18n(root = document) {
  if (!readyPromise) readyPromise = loadLanguage(activeLanguage);
  await readyPromise;
  setupLanguageControls(root);
  applyTranslations(root);
  return { language: activeLanguage, dictionary: activeDictionary };
}

export function currentLanguage() {
  return activeLanguage;
}

export async function setLanguage(language, root = document) {
  const nextLanguage = normalizeLanguage(language) || defaultLanguage;
  localStorage.setItem(languageStorageKey, nextLanguage);
  if (nextLanguage === activeLanguage && Object.keys(activeDictionary).length) {
    languageLoadSequence += 1;
    readyPromise = Promise.resolve(true);
    applyTranslations(root);
    return activeLanguage;
  }

  readyPromise = loadLanguage(nextLanguage);
  const applied = await readyPromise;
  if (!applied) return activeLanguage;
  applyTranslations(root);
  window.dispatchEvent(new CustomEvent("nicechunk:languagechange", { detail: { language: activeLanguage } }));
  return activeLanguage;
}

export function t(key, params = {}) {
  const template = getByPath(activeDictionary, key) ?? getByPath(fallbackDictionary, key) ?? key;
  return interpolate(String(template), params);
}

export function applyTranslations(root = document) {
  document.documentElement.lang = activeLanguage;
  setupLanguageControls(root);

  root.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });

  root.querySelectorAll("[data-home-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.homeI18n);
  });

  translateAttribute(root, "data-i18n-title", "title");
  translateAttribute(root, "data-i18n-placeholder", "placeholder");
  translateAttribute(root, "data-i18n-aria-label", "aria-label");
  translateAttribute(root, "data-i18n-label", "label");
  translateAttribute(root, "data-i18n-value", "value");
  translateAttribute(root, "data-i18n-content", "content");
  translateAttribute(root, "data-home-i18n-aria-label", "aria-label");
}

export function setupLanguageControls(root = document) {
  root.querySelectorAll("select[data-i18n-language-select]").forEach((select) => {
    if (!select.dataset.i18nReady) {
      select.replaceChildren(
        ...languages.map((language) => {
          const option = document.createElement("option");
          option.value = language.code;
          option.textContent = languageOptionLabel(language);
          option.disabled = !isLanguageAvailable(language.code);
          return option;
        }),
      );
      select.addEventListener("change", () => setLanguage(select.value));
      select.dataset.i18nReady = "true";
    }
    select.value = activeLanguage;
    select.setAttribute("aria-label", t("common.language"));
    select.title = t("common.language");
  });

  root.querySelectorAll("[data-i18n-language-menu]").forEach((menu) => {
    setupLanguageMenu(menu);
  });
}

function translateAttribute(root, dataName, attributeName) {
  root.querySelectorAll(`[${dataName}]`).forEach((element) => {
    element.setAttribute(attributeName, t(element.getAttribute(dataName)));
  });
}

function setupLanguageMenu(menu) {
  if (!menu.dataset.i18nReady) {
    const trigger = document.createElement("button");
    trigger.className = "language-trigger";
    trigger.type = "button";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.innerHTML = `
      <span class="language-current"></span>
      <span class="language-caret" aria-hidden="true"></span>
    `;

    const list = document.createElement("div");
    list.className = "language-menu";
    list.setAttribute("role", "listbox");

    languages.forEach((language) => {
      const option = document.createElement("button");
      option.className = "language-option";
      option.type = "button";
      option.dataset.language = language.code;
      option.setAttribute("role", "option");
      option.innerHTML = `
        <span class="language-option-name"></span>
        <span class="language-option-native"></span>
        <span class="language-option-status"></span>
      `;
      option.addEventListener("click", async () => {
        if (!isLanguageAvailable(language.code)) return;
        closeLanguageMenu(menu);
        await setLanguage(language.code);
      });
      list.append(option);
    });

    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      const open = menu.classList.toggle("open");
      trigger.setAttribute("aria-expanded", String(open));
    });

    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeLanguageMenu(menu);
    });

    document.addEventListener("click", (event) => {
      if (!menu.contains(event.target)) closeLanguageMenu(menu);
    });

    menu.classList.add("language-picker");
    menu.replaceChildren(trigger, list);
    menu.dataset.i18nReady = "true";
  }

  updateLanguageMenu(menu);
}

function updateLanguageMenu(menu) {
  const trigger = menu.querySelector(".language-trigger");
  const list = menu.querySelector(".language-menu");
  const current = menu.querySelector(".language-current");
  const active = languages.find((language) => language.code === activeLanguage) ?? languages[0];

  if (trigger) {
    trigger.setAttribute("aria-label", t("common.language"));
    trigger.title = t("common.language");
  }
  if (list) list.setAttribute("aria-label", t("common.language"));
  if (current) current.textContent = languageOptionLabel(active);

  menu.querySelectorAll(".language-option").forEach((option) => {
    const language = languages.find((item) => item.code === option.dataset.language);
    if (!language) return;
    option.querySelector(".language-option-name").textContent = language.englishName;
    option.querySelector(".language-option-native").textContent = `(${languageNativeName(language)})`;
    option.querySelector(".language-option-status").textContent = isLanguageAvailable(language.code) ? "" : comingSoonLabel();
    option.disabled = !isLanguageAvailable(language.code);
    option.classList.toggle("active", language.code === activeLanguage);
    option.setAttribute("aria-selected", String(language.code === activeLanguage));
  });
}

function closeLanguageMenu(menu) {
  menu.classList.remove("open");
  menu.querySelector(".language-trigger")?.setAttribute("aria-expanded", "false");
}

function languageOptionLabel(language) {
  return `${language.englishName} (${languageNativeName(language)})`;
}

function languageNativeName(language) {
  return t(`common.languageNative.${language.key}`);
}

function comingSoonLabel() {
  const value = t("common.comingSoon");
  return value === "common.comingSoon" ? "Coming Soon" : value;
}

function isLanguageAvailable(language) {
  return languageCodes.has(language);
}

async function loadLanguage(language) {
  const sequence = ++languageLoadSequence;
  let resolvedLanguage = language;
  let dictionary;
  try {
    dictionary = await loadDictionary(language);
  } catch (error) {
    if (language === defaultLanguage) throw error;
    resolvedLanguage = defaultLanguage;
    dictionary = await loadDictionary(defaultLanguage);
  }
  if (sequence !== languageLoadSequence) return false;

  activeLanguage = resolvedLanguage;
  activeDictionary = dictionary;
  if (resolvedLanguage === defaultLanguage) {
    fallbackDictionary = dictionary;
    fallbackDictionaryPromise = Promise.resolve(fallbackDictionary);
  } else {
    fallbackDictionary = {};
    fallbackDictionaryPromise = null;
  }
  if (resolvedLanguage !== language) localStorage.setItem(languageStorageKey, resolvedLanguage);
  document.documentElement.lang = activeLanguage;
  return true;
}

async function loadDictionary(language) {
  const version = buildVersion;
  const cacheDictionaries = activeI18nConfig.cacheDictionaries !== false;
  if (cacheDictionaries) {
    const cached = readCachedDictionary(language, version);
    if (cached) return cached;
  }

  const dictionary = await fetchDictionary(language, version);
  if (cacheDictionaries) writeCachedDictionary(language, dictionary, version);
  return dictionary;
}

async function fetchDictionary(language, version = buildVersion) {
  const url = `${activeI18nConfig.localeBase}/${language}.json`;
  const preload = globalThis.__nicechunkLocalePreload;
  const canUsePreload = preload
    && preload.language === language
    && preload.localeBase === activeI18nConfig.localeBase
    && preload.promise instanceof Promise;
  if (canUsePreload) delete globalThis.__nicechunkLocalePreload;
  const response = canUsePreload
    ? await preload.promise
    : await fetch(`${url}?v=${encodeURIComponent(version)}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  if (!response.ok) throw new Error(`Failed to load locale ${language}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) throw new Error(`Locale ${language} did not return JSON`);
  return response.json();
}

function readCachedDictionary(language, expectedVersion) {
  if (!expectedVersion) return null;
  const cachedVersion = localStorage.getItem(localeVersionKey(language));
  if (cachedVersion !== expectedVersion) return null;
  const raw = localStorage.getItem(localeDataKey(language));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    localStorage.removeItem(localeVersionKey(language));
    localStorage.removeItem(localeDataKey(language));
    return null;
  }
}

function writeCachedDictionary(language, dictionary, version) {
  if (!version || !dictionary) return;
  try {
    localStorage.setItem(localeVersionKey(language), version);
    localStorage.setItem(localeDataKey(language), JSON.stringify(dictionary));
  } catch (_error) {
    localStorage.removeItem(localeDataKey(language));
  }
}

function localeVersionKey(language) {
  return `${localeVersionPrefix}${language}`;
}

function localeDataKey(language) {
  return `${localeDataPrefix}${language}`;
}

function normalizeLanguage(language) {
  if (!language) return "";
  const normalized = String(language).trim();
  if (languageCodes.has(normalized)) return normalized;
  const lower = normalized.toLowerCase();
  if (lower === "zh-tw" || lower === "zh-hk" || lower === "zh-mo" || lower === "zh-hant") return "zh-Hant";
  if (lower === "zh" || lower === "zh-cn" || lower === "zh-sg" || lower === "zh-hans") return "zh-Hans";
  const prefix = lower.split("-")[0];
  return languageOrder.find((code) => code.toLowerCase() === prefix) || "";
}

function getByPath(source, path) {
  return path.split(".").reduce((value, part) => (value && Object.hasOwn(value, part) ? value[part] : undefined), source);
}

function interpolate(template, params) {
  return template.replace(/\{(\w+)\}/g, (_match, key) => (Object.hasOwn(params, key) ? String(params[key]) : `{${key}}`));
}
