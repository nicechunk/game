import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startStaticServer } from "./serve-static-site.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDirectory = path.join(projectRoot, "play", "tests");
const tests = (await readdir(testDirectory))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => path.join(testDirectory, name));

if (!tests.length) throw new Error("No play tests were found.");

const server = await startStaticServer({ rootDirectory: projectRoot });
try {
  const exitCode = await runTests(tests, server.baseUrl);
  process.exitCode = exitCode;
} finally {
  await server.close();
}

function runTests(files, origin) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", "--test-concurrency=4", ...files], {
      cwd: projectRoot,
      env: { ...process.env, NICECHUNK_TEST_ORIGIN: origin },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Play tests terminated by ${signal}.`));
      else resolve(code ?? 1);
    });
  });
}
