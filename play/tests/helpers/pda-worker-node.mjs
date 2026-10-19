import { parentPort, workerData } from "node:worker_threads";
globalThis.self = { postMessage: (message, transfer = []) => parentPort.postMessage(message, transfer) };
await import(workerData.entryUrl);
parentPort.on("message", (message) => self.onmessage({ data: message }));
parentPort.postMessage({ type: "test-ready" });
