import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route(`${origin}/building-fracture-fixture`, route => route.fulfill({
    contentType: "text/html", body: '<!doctype html><body style="margin:0"><canvas style="width:640px;height:360px"></canvas>',
  }));
  await page.goto(`${origin}/building-fracture-fixture`);
  const result = await page.evaluate(async () => {
    Object.defineProperty(performance, "now", { value: () => 10000 });
    const { WebGL2VoxelRenderer } = await import("/chunk.js/renderer/webgl2-renderer.js");
    const { createCameraState } = await import("/chunk.js/renderer/camera.js");
    const { createPlayEffects } = await import("/play/play-effects.js");
    const { PLAY_RENDER_OPTIONS } = await import("/play/play-render-options.js");
    const renderer = new WebGL2VoxelRenderer(document.querySelector("canvas"), { ...PLAY_RENDER_OPTIONS, dpr: 1 });
    renderer.init();
    const effects = createPlayEffects({ getRenderer: () => renderer });
    const camera = createCameraState({ worldX: 4, worldY: 5, worldZ: 5, targetWorldX: 0, targetLocalOffsetX: 0.5,
      targetWorldY: 2, targetLocalOffsetY: 0.5, targetWorldZ: 0, targetLocalOffsetZ: 0.5, fov: 42, aspect: 16 / 9, far: 256 });
    const draw = () => {
      renderer.render(camera, []); const gl = renderer.gl; gl.finish();
      if (gl.getError() !== gl.NO_ERROR) throw Error("Fracture render produced a WebGL error");
      const pixels = new Uint8Array(640 * 360 * 4);
      gl.readPixels(0, 0, 640, 360, gl.RGBA, gl.UNSIGNED_BYTE, pixels); return pixels;
    };
    const baseline = draw(), frames = [];
    for (const materialId of [55, 58, 64]) {
      effects.emitConfirmedBlockFracture({ miningKind: "building-demolition", blocks: [
        { worldX: 0, worldY: 2, worldZ: 0, blockId: materialId, materialId },
      ] });
      effects.update(10000, 0.12);
      const pixels = draw(); let changedPixels = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if ([0, 1, 2].some(channel => pixels[offset + channel] !== baseline[offset + channel])) changedPixels++;
      }
      const image = document.createElement("canvas"); image.width = 640; image.height = 360;
      const ctx = image.getContext("2d"), data = ctx.createImageData(640, 360);
      for (let y = 0; y < 360; y++) data.data.set(pixels.subarray((359 - y) * 640 * 4, (360 - y) * 640 * 4), y * 640 * 4);
      ctx.putImageData(data, 0, 0);
      frames.push({ materialId, changedPixels, particles: renderer.voxelParticles.particles.length, image: image.toDataURL() });
      for (let frame = 0; frame < 360; frame++) effects.update(10000, 1 / 60);
      if (renderer.voxelParticles.particles.length) throw Error("Fracture particles were not released");
    }
    renderer.dispose(); return { frames };
  });
  assert.deepEqual(errors, []);
  assert.ok(result.frames.every(frame => frame.changedPixels > 100 && frame.particles > 0 && frame.particles <= 28));
  if (process.env.NICECHUNK_FRACTURE_EVIDENCE) {
    const directory = process.env.NICECHUNK_FRACTURE_EVIDENCE; await mkdir(directory, { recursive: true });
    for (const frame of result.frames) {
      await writeFile(`${directory}/material-${frame.materialId}.png`, Buffer.from(frame.image.split(",")[1], "base64"));
      delete frame.image;
    }
    await writeFile(`${directory}/results.json`, JSON.stringify({ passed: true, softwareGpu: true, ...result }, null, 2) + "\n");
  }
} finally {
  await browser.close();
}
