import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const languageOrder = ["en", "es", "fr", "de", "ja", "ru", "ko", "zh-Hant", "zh-Hans"];
const languageNativeKeys = ["en", "es", "fr", "de", "ja", "ru", "ko", "zhHant", "zhHans"];
const requiredProfileKeys = [
  "settingsTab",
  "settings",
  "settingsIntro",
  "accountSettings",
  "accountSettingsHint",
  "walletAddress",
  "walletConnectedHint",
  "walletDisconnectedHint",
  "logOut",
  "rpcSettings",
  "rpcSettingsHint",
  "rpcHelius",
  "rpcPublic",
  "rpcHintPrivate",
  "rpcHintPublic",
  "rpcUpdate",
  "rpcSet",
  "languageSettings",
  "language",
  "languageHint",
  "rotateAvatar",
];

export async function checkPlayI18n({ root = resolve(dirname(fileURLToPath(import.meta.url)), "..") } = {}) {
  const localeDir = resolve(root, "public/play/locales");
  const dictionaries = {};
  const errors = [];

  for (const language of languageOrder) {
    const file = resolve(localeDir, `${language}.json`);
    try {
      dictionaries[language] = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      errors.push(`${language}: ${error?.message || error}`);
    }
  }
  if (errors.length) throw new Error(`Play locale files are invalid:\n${errors.join("\n")}`);

  const files = (await readdir(localeDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && extname(entry.name) === ".json")
    .map((entry) => entry.name)
    .sort();
  const expectedFiles = languageOrder.map((language) => `${language}.json`).sort();
  if (files.join("\n") !== expectedFiles.join("\n")) {
    errors.push(`expected exactly ${expectedFiles.join(", ")}; found ${files.join(", ")}`);
  }

  const englishKeys = flattenLeafKeys(dictionaries.en);
  const referencedKeys = await collectReferencedKeys(resolve(root, "play"));
  for (const key of referencedKeys) {
    if (!englishKeys.has(key)) errors.push(`en: missing referenced key ${key}`);
  }

  for (const language of languageOrder) {
    const dictionary = dictionaries[language];
    if (dictionary?._meta?.language !== language) {
      errors.push(`${language}: _meta.language is ${JSON.stringify(dictionary?._meta?.language)}`);
    }
    const keys = flattenLeafKeys(dictionary);
    for (const key of englishKeys) {
      if (!keys.has(key)) errors.push(`${language}: missing English fallback key ${key}`);
    }
    for (const key of referencedKeys) {
      if (!keys.has(key)) errors.push(`${language}: missing referenced key ${key}`);
    }
    for (const key of requiredProfileKeys) {
      const value = dictionary?.main?.profile?.[key];
      if (typeof value !== "string" || !value.trim()) errors.push(`${language}: missing main.profile.${key}`);
    }
    for (const key of languageNativeKeys) {
      const value = dictionary?.common?.languageNative?.[key];
      if (typeof value !== "string" || !value.trim()) errors.push(`${language}: missing common.languageNative.${key}`);
    }
  }

  if (errors.length) throw new Error(`Play i18n check failed:\n${errors.join("\n")}`);
  const result = { languages: languageOrder.length, englishKeys: englishKeys.size, referencedKeys: referencedKeys.size };
  console.log(`Play i18n check passed: ${result.languages} languages, ${result.englishKeys} base keys, ${result.referencedKeys} runtime references.`);
  return result;
}

function flattenLeafKeys(source, prefix = "", output = new Set()) {
  for (const [key, value] of Object.entries(source || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) flattenLeafKeys(value, path, output);
    else output.add(path);
  }
  return output;
}

async function collectReferencedKeys(directory) {
  const keys = new Set();
  for (const file of await collectSourceFiles(directory)) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/data-i18n(?:-(?:title|placeholder|aria-label|label|value|content))?="([^"]+)"/g)) {
      keys.add(match[1]);
    }
    for (const match of source.matchAll(/\b(?:t|ui)\(\s*["']([^"']+)["']/g)) {
      keys.add(match[1]);
    }
  }
  return keys;
}

async function collectSourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectSourceFiles(path));
    else if (entry.isFile() && [".html", ".js"].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await checkPlayI18n();
}
