import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";

test("clear-air renderer keeps original detail, water, picking and context restoration", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 3 });
    const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/performance-render-fixture", route => route.fulfill({
      contentType: "text/html", body: '<!doctype html><body style="margin:0"><canvas></canvas>',
    }));
    await page.goto(origin + "/performance-render-fixture");
    const result = await page.evaluate(async () => {
      Object.defineProperty(performance, 'now', {value:()=>10000});
      const { PLAY_RENDER_OPTIONS } = await import("/play/play-render-options.js");
      const { WebGL2VoxelRenderer } = await import("/chunk.js/renderer/webgl2-renderer.js");
      const { createCameraState } = await import("/chunk.js/renderer/camera.js");
      const { screenRayDirection } = await import("/chunk.js/input/raycast.js");
      const check = (ok, message) => { if (!ok) throw Error(message); };
      const canvas = document.querySelector("canvas");
      canvas.style.cssText = "width:1920px;height:1080px";
      const renderer = new WebGL2VoxelRenderer(canvas, { ...PLAY_RENDER_OPTIONS, viewDistance: 20, useRegionBatching: false });
      renderer.init();
      check(PLAY_RENDER_OPTIONS.shadows === false, "gameplay must disable cast shadows");
      const renderPass = renderer.renderMeshPass.bind(renderer);
      renderer.renderMeshPass = (chunks, origin, categories, ...rest) => {
        check(!categories.includes("shadow"), "disabled shadow pass must not be submitted");
        return renderPass(chunks, origin, categories, ...rest);
      };
      const camera = createCameraState({ worldX: 8, worldY: 1, worldZ: 0,
        targetWorldX: 8, targetWorldY: 1, targetWorldZ: 40, far: 512 });
      const sizes = [];
      for (const [width, height] of [[1920, 1080], [3840, 2160], [390, 844], [844, 390]]) {
        canvas.style.width = width + "px"; canvas.style.height = height + "px";
        renderer.resize(); camera.aspect = canvas.width / canvas.height;
        check(canvas.width === Math.floor(width * 1.75) && canvas.height === Math.floor(height * 1.75), "original desktop DPR was not restored");
        const ray = screenRayDirection(camera, width * .72, height * .41, canvas);
        const oldSize = [canvas.width, canvas.height];
        // Changing only backing resolution must not move the world-space input ray.
        canvas.width = Math.floor(width / 2); canvas.height = Math.floor(height / 2);
        const scaledRay = screenRayDirection(camera, width * .72, height * .41, canvas);
        check(ray.every((value, i) => Math.abs(value - scaledRay[i]) < 1e-10), "picking changed with backing size");
        renderer.resize(); sizes.push({ css: [width, height], backing: oldSize });
      }
      canvas.style.cssText = "width:320px;height:180px"; renderer.resize();
      function quad(layer, z) {
        const vertices = new Uint8Array(80), data = new DataView(vertices.buffer);
        const points = [[0, -4, z], [16, -4, z], [16, 6, z], [0, 6, z]];
        points.forEach((point, i) => {
          const offset = i * 20;
          point.forEach((value, axis) => data.setInt16(offset + axis * 2, value * 64, true));
          data.setInt16(offset + 6, 64, true); data.setInt8(offset + 10, -127); data.setUint8(offset + 11, 230);
          data.setUint16(offset + 12, i === 1 || i === 2 ? 1 : 0, true);
          data.setUint16(offset + 14, i >= 2 ? 1 : 0, true); data.setUint16(offset + 16, layer, true);
        });
        return { vertices, indices: new Uint16Array([0, 2, 1, 0, 3, 2]), indexCount: 6, vertexCount: 4, triangleCount: 2 };
      }
      const chunks = [{ id: "stone", chunkX: 0, chunkZ: 2, chunkSize: 16, mesh: quad(3, 10), meshVersion: 1, version: 1 },
        { id: "water", chunkX: 0, chunkZ: 2, chunkSize: 16, visualMesh: quad(17, 8), visualMeshVersion: 1, version: 1 }];
      const draw = async (drawChunks=chunks) => {
        for(let attempt=0;attempt<120;attempt++) {
          const upload=renderer.prepareChunksForRender(drawChunks);
          const stats=renderer.render(camera,drawChunks);
          if(!stats.renderDeferred && !renderer.uploadValidationFence && !upload.pendingUploads && stats.visibleChunks>0)return stats;
          await new Promise(requestAnimationFrame);
        }
        throw new Error('asynchronous terrain upload did not complete');
      };
      function pixel() {
        const gl = renderer.gl, bytes = new Uint8Array(4);
        gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes); return Array.from(bytes);
      }
      await draw(); const waterPixel = pixel();
      await draw([chunks[0]]); const stonePixel = pixel();
      check(JSON.stringify(waterPixel) !== JSON.stringify(stonePixel), "transparent water must still contribute color");
      async function stoneWithLight(flags, ao) {
        const data=new DataView(chunks[0].mesh.vertices.buffer);
        for(let v=0;v<4;v++){data.setUint16(v*20+18,flags,true);data.setUint8(v*20+11,ao);}
        chunks[0].version++;chunks[0].meshVersion++;
        await draw([chunks[0]]);return pixel();
      }
      const occluded=await stoneWithLight(128,0),open=await stoneWithLight(0xff80,255);
      check(JSON.stringify(occluded)===JSON.stringify(open),"stale sky/sun/AO masks still cast a dark area");
      const sunDirection=renderer.lighting.sunDirection;
      renderer.lighting.sunDirection=[0,0,-1];const lit=await stoneWithLight(128,0);
      renderer.lighting.sunDirection=[0,0,1];const unlit=await stoneWithLight(128,0);
      check(lit.slice(0,3).reduce((a,b)=>a+b)>unlit.slice(0,3).reduce((a,b)=>a+b),"normal-based sunlight direction was removed: "+JSON.stringify({lit,unlit}));
      renderer.lighting.sunDirection=sunDirection;
      renderer.lighting.fogNearFar = [1, 2]; renderer.lighting.fogColor = [1, 1, 1]; await draw(); const near = pixel();
      renderer.lighting.fogNearFar = [10000, 20000]; renderer.lighting.fogColor = [1, 0, 1]; await draw(); const far = pixel();
      check(JSON.stringify(near) === JSON.stringify(far), "legacy fog inputs still affect pixels");
      check(far.slice(0, 3).some(value => value < 180), "distant terrain must not be white");
      const checkPrograms = () => {
        for (const program of [renderer.program, renderer.solidProgram, renderer.avatarProgram, renderer.voxelParticles.program]) {
          const gl = renderer.gl;
          for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
            const name = gl.getActiveUniform(program, i).name;
            check(!/fog/i.test(name), "fog uniform survived compilation: " + name);
          }
        }
        check(renderer.cloudLayer && renderer.skyGradient && renderer.sunDisc,
          "cloud and sky effects must remain available");
        check(renderer.projectedShadowLayer === null, "disabled shadows must not allocate GPU resources");
        for(const program of [renderer.program,renderer.solidProgram])check(
          renderer.gl.getUniformLocation(program,"uCaveAmbientFloor")===null,
          "sky occlusion remains in compiled no-shadow programs");
        check(renderer.renderProjectedShadows([{id:"test-caster"}], null, null).drawCalls === 0,
          "disabled avatar shadows must not draw");
        check(renderer.textureArray.quality === "balanced" && renderer.textureArray.mipLevels > 1, "filtered textures were not restored");
        check(renderer.options.waterEffects && renderer.gl.getUniformLocation(renderer.program, "uTime") !== null, "detailed animated water was not restored");
        check(renderer.gpuTimer === null, "GPU timer must be opt-in during gameplay");
      };
      checkPrograms();
      const extension = renderer.gl.getExtension("WEBGL_lose_context"); check(extension, "context loss extension unavailable");
      const lost = new Promise(resolve => canvas.addEventListener("webglcontextlost", resolve, { once: true }));
      extension.loseContext(); await lost;
      await new Promise(resolve => setTimeout(resolve, 50));
      const restored = new Promise(resolve => canvas.addEventListener("webglcontextrestored", resolve, { once: true }));
      extension.restoreContext(); await restored;
      await draw();
      check(renderer.initialized && !renderer.lastInitError, "performance context restoration failed");
      checkPrograms(); check(renderer.gl.getError() === renderer.gl.NO_ERROR, "WebGL error");
      const stats = { ...renderer.stats }; renderer.dispose();
      check(renderer.resourceLedger.snapshot().bufferBytes === 0, "buffers leaked");
      return { sizes, waterPixel, stonePixel, near, far, stats };
    });
    assert.equal(result.sizes[0].backing[0], 3360);
    assert.equal(result.sizes[0].backing[1], 1890);
    assert.ok(result.stats.terrainDrawCalls > 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
