import { createHash } from "node:crypto";
import { chmod, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild, minify as minifyJs } from "vite";
import { checkPlayI18n } from "./check-play-i18n.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeFormatVersion = "play-bundle-v1";
const outputRoot = resolve(process.env.NICECHUNK_PLAY_RUNTIME_OUTPUT || resolve(root, ".play-runtime"));
const playSource = resolve(root, "play");
const playLoaderSource = resolve(playSource, "play-loader.js");
const playOnboardingLoaderSource = resolve(playSource, "play-onboarding-loader.js");
const chunkSource = resolve(root, "chunk.js");
const playLocaleSource = resolve(root, "public/play/locales");
const chainBundleSource = resolve(root, "dist/assets/nicechunkChain.js");
const sharedRuntimeFiles = [
  resolve(root, "src/i18n.js"),
  resolve(root, "src/data/smeltingRules.js"),
];
const chainVersionFiles = await collectFiles(resolve(root, "src/chain"));
const chunkRuntimeEntries = [
  "play.js",
  "core",
  "world",
  "chunk",
  "ncm",
  "construction",
  "renderer",
  "input",
  "physics",
  "debug",
  "forge/forge-core.js",
  "forge/forge-mesher.js",
  "forge/forge-runtime-cache.js",
];
const chunkRuntimeExcludedFiles = new Set([
  "renderer/forge-tool-visuals.js",
  "renderer/forge-workbench-renderer.js",
]);
const playRuntimeExcludedPrefixes = ["tests/"];

await checkPlayI18n({ root });

const chunkRuntimeFiles = ((await Promise.all(chunkRuntimeEntries.map((entry) => collectFiles(resolve(chunkSource, entry))))).flat())
  .filter((file) => !chunkRuntimeExcludedFiles.has(relative(chunkSource, file)));
const playRuntimeFiles = (await collectFiles(playSource))
  .filter((file) => !playRuntimeExcludedPrefixes.some((prefix) => relative(playSource, file).startsWith(prefix)));
const sourceFiles = [
  ...playRuntimeFiles,
  ...(await collectFiles(playLocaleSource)),
  ...chunkRuntimeFiles,
  ...sharedRuntimeFiles,
  ...chainVersionFiles,
  chainBundleSource,
].sort();
const version = await contentVersion(sourceFiles);
const runtimeRoot = resolve(outputRoot, "runtime", version);
// Mirror the production document root: /assets/* is served from dist/assets.
const runtimeAssets = resolve(outputRoot, "dist/assets");
const runtimePrefix = `/runtime/${version}`;

await rm(outputRoot, { recursive: true, force: true });
await viteBuild({
  configFile: false,
  root,
  publicDir: false,
  base: `${runtimePrefix}/`,
  logLevel: "warn",
  plugins: [{
    name: "nicechunk-play-loader-placeholder",
    enforce: "pre",
    transformIndexHtml(html) {
      return html
        .replace(
          /<script\b[^>]*\bsrc="\/play\/play-loader\.js"[^>]*><\/script>/,
          "<!-- nicechunk-play-loader -->",
        )
        .replace(
          /<script\b[^>]*\bsrc="\/play\/play-onboarding-loader\.js"[^>]*><\/script>/,
          "<!-- nicechunk-play-onboarding-loader -->",
        );
    },
  }],
  resolve: {
    alias: [
      { find: /^\/chunk\.js\//, replacement: `${chunkSource}/` },
      { find: /^\/src\//, replacement: `${resolve(root, "src")}/` },
    ],
  },
  build: {
    target: "es2022",
    outDir: runtimeRoot,
    emptyOutDir: true,
    manifest: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      input: {
        play: resolve(playSource, "index.html"),
        character: resolve(playSource, "play-character-entry.js"),
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});

await mkdir(runtimeAssets, { recursive: true });
await cp(chainBundleSource, resolve(runtimeAssets, `nicechunkChain.${version}.js`));

const viteManifest = JSON.parse(await readFile(resolve(runtimeRoot, ".vite/manifest.json"), "utf8"));
const playEntryRecord = viteManifest["play/index.html"];
const characterEntryRecord = viteManifest["play/play-character-entry.js"];
if (!playEntryRecord?.file || !characterEntryRecord?.file) {
  throw new Error("Play runtime manifest is missing the game entry.");
}
const loaderSource = await readFile(playLoaderSource, "utf8");
const loaderBuild = await minifyJs("play-loader.js", loaderSource);
if (loaderBuild.errors?.length || !loaderBuild.code) {
  throw new Error(`Play Loader minification failed: ${loaderBuild.errors?.[0]?.message || "empty output"}`);
}
// This parser-blocking classic script must execute before every application asset.
new Function(loaderBuild.code);
if (/^\s*import\s/m.test(loaderBuild.code) || Buffer.byteLength(loaderBuild.code) > 20_000) {
  throw new Error("Play Loader must remain a small dependency-free classic script.");
}
const loaderHash = createHash("sha256").update(loaderBuild.code).digest("hex").slice(0, 8);
const loaderFile = `assets/play-loader-${loaderHash}.js`;
await writeFile(resolve(runtimeRoot, loaderFile), loaderBuild.code);
const onboardingLoaderSource = await readFile(playOnboardingLoaderSource, "utf8");
const onboardingLoaderBuild = await minifyJs("play-onboarding-loader.js", onboardingLoaderSource);
if (onboardingLoaderBuild.errors?.length || !onboardingLoaderBuild.code) {
  throw new Error(`Play onboarding Loader minification failed: ${onboardingLoaderBuild.errors?.[0]?.message || "empty output"}`);
}
new Function(onboardingLoaderBuild.code);
if (/^\s*import\s/m.test(onboardingLoaderBuild.code) || Buffer.byteLength(onboardingLoaderBuild.code) > 12_000) {
  throw new Error("Play onboarding Loader must remain a small dependency-free classic script.");
}
const onboardingLoaderHash = createHash("sha256").update(onboardingLoaderBuild.code).digest("hex").slice(0, 8);
const onboardingLoaderFile = `assets/play-onboarding-loader-${onboardingLoaderHash}.js`;
await writeFile(resolve(runtimeRoot, onboardingLoaderFile), onboardingLoaderBuild.code);
const gameEntry = await runtimeDescriptor(playEntryRecord.file, "module", "game");
const entry = await runtimeDescriptor(characterEntryRecord.file, "module", "critical");
if (entry.bytes > 20_000 || gameEntry.url === entry.url || !characterEntryRecord.dynamicImports?.length) {
  throw new Error("Play character verification must remain a small deferred-game entry.");
}
const styles = await Promise.all((playEntryRecord.css || []).map((file) => runtimeDescriptor(file, "style", "game")));
const startupWorkers = (await readdir(resolve(runtimeRoot, "assets")))
  .filter((file) => /^(?:chunk-build-worker|play-chain-pda-worker|play-minimap-worker)-.+\.js$/.test(file))
  .sort();
const startupFiles = [
  {
    url: `/assets/nicechunkChain.${version}.js`,
    bytes: (await stat(chainBundleSource)).size,
    type: "module",
    phase: "game",
  },
  ...await Promise.all(startupWorkers.map((file) => runtimeDescriptor(`assets/${file}`, "worker", "game"))),
];
const locales = Object.fromEntries(await Promise.all((await readdir(playLocaleSource))
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map(async (file) => {
    const language = file.slice(0, -".json".length);
    return [language, {
      url: `/play/locales/${file}`,
      bytes: (await stat(resolve(playLocaleSource, file))).size,
    }];
  })));
const englishDictionary = JSON.parse(await readFile(resolve(playLocaleSource, "en.json"), "utf8"));
const loaderDictionary = {
  main: {
    loading: {
      loader: englishDictionary.main?.loading?.loader || {},
      stages: Object.fromEntries(Object.entries(englishDictionary.main?.loading?.stages || {})
        .map(([key, stage]) => [key, { title: stage?.title || "" }])),
    },
  },
};
const loadingManifestPath = resolve(runtimeRoot, "play-load-manifest.json");
const loadingManifestUrl = `${runtimePrefix}/play-load-manifest.json`;
const loadingManifest = {
  schemaVersion: 1,
  version,
  entry,
  files: [...styles, entry, ...startupFiles],
  locales,
  dictionary: loaderDictionary,
};
await writeFile(loadingManifestPath, `${JSON.stringify(loadingManifest, null, 2)}\n`);

const runtimeIndexPath = resolve(runtimeRoot, "play", "index.html");
const bundledIndex = await readFile(runtimeIndexPath, "utf8");
const loaderUrl = `${runtimePrefix}/${loaderFile}`;
const onboardingLoaderUrl = `${runtimePrefix}/${onboardingLoaderFile}`;
const deployedIndex = removeBootAssetTags(bundledIndex, gameEntry, styles)
  .replace(
    "<!-- nicechunk-play-loader -->",
    `<script src="${loaderUrl}" fetchpriority="high" data-nicechunk-loader data-manifest="${loadingManifestUrl}"></script>`,
  )
  .replace(
    "<!-- nicechunk-play-onboarding-loader -->",
    `<script src="${onboardingLoaderUrl}" defer data-nicechunk-onboarding data-module="/play/play-onboarding.js" data-style="/play/play-onboarding.css"></script>`,
  )
  .replace(
    '<html lang="en" data-i18n-scope="play">',
    `<html lang="en" data-i18n-scope="play" data-i18n-build-version="${version}">`,
  )
  .replace("<title>NiceChunk Play</title>", `<title>NiceChunk Play</title>\n    <meta name="nicechunk-runtime-version" content="${version}" />`);

if (
  deployedIndex === bundledIndex ||
  !deployedIndex.includes(`data-i18n-build-version="${version}"`) ||
  !deployedIndex.includes(`<meta name="nicechunk-runtime-version" content="${version}" />`) ||
  !deployedIndex.includes(`data-manifest="${loadingManifestUrl}"`) ||
  !deployedIndex.includes(`src="${loaderUrl}"`) ||
  !deployedIndex.includes(`src="${onboardingLoaderUrl}"`) ||
  deployedIndex.includes("nicechunk-play-loader -->") ||
  deployedIndex.includes("nicechunk-play-onboarding-loader -->") ||
  deployedIndex.includes(`src="${gameEntry.url}"`) ||
  deployedIndex.includes('rel="modulepreload"') ||
  styles.some((file) => deployedIndex.includes(`href="${file.url}"`))
) {
  throw new Error("Bundled Play index Loader references were not stamped.");
}
await writeFile(runtimeIndexPath, deployedIndex);
await mkdir(resolve(outputRoot, "play"), { recursive: true });
await writeFile(resolve(outputRoot, "play", "index.html"), deployedIndex);
await cp(playLocaleSource, resolve(outputRoot, "play", "locales"), { recursive: true });
await writeFile(resolve(outputRoot, "play-runtime.json"), `${JSON.stringify({
  version,
  runtimePrefix,
  chainModulePath: `/assets/nicechunkChain.${version}.js`,
  loadingManifestPath: loadingManifestUrl,
  loaderPath: loaderUrl,
  onboardingLoaderPath: onboardingLoaderUrl,
  bundled: true,
}, null, 2)}\n`);
await normalizePermissions(outputRoot);

const runtimeFiles = await collectFiles(runtimeRoot);
console.log(JSON.stringify({
  version,
  runtimePrefix,
  sourceFiles: sourceFiles.length,
  outputFiles: runtimeFiles.length,
  outputRoot,
}, null, 2));

async function collectFiles(path) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  if (!entries.length) return [path];
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

async function contentVersion(files) {
  const hash = createHash("sha256");
  hash.update(runtimeFormatVersion);
  hash.update("\0");
  for (const file of files) {
    hash.update(relative(root, file));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return `play-bundle-${hash.digest("hex").slice(0, 16)}`;
}

async function normalizePermissions(path) {
  const entries = await readdir(path, { withFileTypes: true });
  await chmod(path, 0o755);
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await normalizePermissions(child);
    else if (entry.isFile()) await chmod(child, 0o644);
  }
}

async function runtimeDescriptor(file, type, phase) {
  return {
    url: `${runtimePrefix}/${file}`,
    bytes: (await stat(resolve(runtimeRoot, file))).size,
    type,
    phase,
  };
}

function removeBootAssetTags(html, entry, styles) {
  let output = html.replace(
    new RegExp(`<script\\b[^>]*\\bsrc="${escapeRegExp(entry.url)}"[^>]*><\\/script>\\s*`),
    "",
  );
  output = output.replace(/<link\b[^>]*\brel="modulepreload"[^>]*>\s*/g, "");
  for (const style of styles) {
    output = output.replace(
      new RegExp(`<link\\b[^>]*\\bhref="${escapeRegExp(style.url)}"[^>]*>\\s*`),
      "",
    );
  }
  return output;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
