import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const ignoredDirectories = new Set([".git", "coverage", "dist", "node_modules"]);
const binaryExtensions = new Set([
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".ncm",
  ".png",
  ".wasm",
  ".webp",
  ".woff",
  ".woff2",
]);
const forbiddenDirectory = /(^|\/)(?:\.auth|\.gh-config|\.ssh)(\/|$)/i;
const forbiddenFile = /(^|\/)(?:\.env(?:\..*)?|hosts\.ya?ml|id_ed25519|id_rsa|rpc_key)$/i;
const forbiddenExtension = /\.(?:key|pem)$/i;
const keypairFile = /(^|\/)[^/]*keypair[^/]*\.json$/i;
const localeJson = /(^|\/)locales\/[^/]+\.json$/i;
const secretPatterns = [
  /-----BEGIN (?:EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/,
];

const files = await collectFiles(root);
const failures = [];

for (const file of files) {
  const path = relative(root, file).replaceAll("\\", "/");
  if (
    forbiddenDirectory.test(path)
    || forbiddenFile.test(path)
    || forbiddenExtension.test(path)
    || keypairFile.test(path)
  ) {
    failures.push(`${path}: forbidden credential path`);
    continue;
  }
  if (binaryExtensions.has(extname(path).toLowerCase())) continue;
  const source = await readFile(file, "utf8");
  if (/\p{Script=Han}/u.test(source) && !localeJson.test(path)) {
    failures.push(`${path}: Han text is only allowed in locale JSON files`);
  }
  if (secretPatterns.some((pattern) => pattern.test(source))) {
    failures.push(`${path}: probable secret content`);
  }
}

if (failures.length) {
  console.error(`Repository policy check failed:\n${failures.join("\n")}`);
  process.exit(1);
}

console.log(`Repository policy check passed for ${files.length} files.`);

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
