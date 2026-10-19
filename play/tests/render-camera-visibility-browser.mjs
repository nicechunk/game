import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = process.env.CAMERA_EVIDENCE_DIR || join(tmpdir(), "nicechunk-camera-visibility");
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/fixture") {
    res.setHeader("content-type", "text/html");
    return res.end('<!doctype html><link rel="stylesheet" href="/play/styles.css"><canvas id="worldCanvas"></canvas>');
  }
  const file = resolve(root, `.${pathname}`);
  if (!file.startsWith(root + "/")) { res.statusCode = 403; return res.end(); }
  try {
    res.setHeader("content-type", { ".js":"text/javascript", ".css":"text/css", ".json":"application/json" }[extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
let browser;
const results = { type: "browser CPU camera / projection and real DOM fixture", gameBooted: false, realGpuScene: false, views: [], errors: [] };
try {
  browser = await chromium.launch({ headless: true, args:["--no-sandbox", "--disable-gpu-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  for (const viewport of [{ width:1280,height:720 }, { width:390,height:844 }]) {
    const page = await browser.newPage({ viewport });
    page.on("pageerror", (error) => results.errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
    const result = await page.evaluate(async ({ viewport }) => {
      const { createCameraState, cameraForward } = await import("/chunk.js/renderer/camera.js");
      const { createPlayerMotionController } = await import("/play/player-motion-controller.js");
      const { createNameChatOverlay } = await import("/play/play-name-chat-overlay.js");
      const { computeViewEnvironment } = await import("/play/play-view-distance.js");
      const canvas = document.querySelector("canvas");
      canvas.width = viewport.width; canvas.height = viewport.height;
      const gl = canvas.getContext("webgl2");
      const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
      const renderer = gl && (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      if (gl) { gl.clearColor(0.07,0.13,0.2,1); gl.clear(gl.COLOR_BUFFER_BIT); }
      const blocked = (x,y,z) => y < 1 || y >= 5 || !((x>=-2&&x<=12&&z>=0&&z<=2)||(x>=10&&x<=12&&z>=0&&z<=14)||(x>=10&&x<=25&&z>=12&&z<=14));
      const camera = createCameraState({ aspect: viewport.width/viewport.height });
      const player = { worldX:0,worldY:1,worldZ:1,localOffsetX:0.5,localOffsetY:0,localOffsetZ:0.5,controlYaw:-Math.PI/2,cameraPitch:-0.5 };
      const motion = createPlayerMotionController({getPlayer:()=>player,getCamera:()=>camera,getChunks:()=>({isCameraOccluderAtWorld:blocked}),isMobileViewport:()=>viewport.width<500});
      let frames=0;
      for (const fps of [15,30,60,120]) {
        motion.resetCameraFocus();
        for(let frame=0;frame<fps*3;frame++) {
          const distance=Math.min(35,29.6*frame/fps);
          let x,z;
          if(distance<=11){x=.5+distance;z=1.5;player.controlYaw=-Math.PI/2;}
          else if(distance<=23){x=11.5;z=1.5+distance-11;player.controlYaw=Math.PI;}
          else{x=11.5+distance-23;z=13.5;player.controlYaw=-Math.PI/2;}
          motion.setPlayerWorldFloat(x,1,z);
          if(frame%37===0)motion.toggleFirstPersonCamera();
          motion.syncCameraToPlayer((frame%7===0?1.7:.88)/fps,{force:frame===0});
          if(!camera.cameraSafety.safe)throw Error("unsafe camera frame");
          const eye=motion.cameraWorldFloat(), f=cameraForward(camera), h=Math.hypot(f[0],f[2]);
          const r=h>1e-6?[f[2]/h,0,-f[0]/h]:[1,0,0];
          const u=[-f[1]*r[2],f[2]*r[0]-f[0]*r[2],f[1]*r[0]];
          const hh=camera.near*Math.tan(camera.fov*Math.PI/360),hw=hh*camera.aspect;
          const points=[eye,...[-1,1].flatMap(sx=>[-1,1].map(sy=>eye.map((v,i)=>v+f[i]*camera.near+r[i]*hw*sx+u[i]*hh*sy)))];
          for(const point of points)if(blocked(...point.map(Math.floor)))throw Error("eye/near plane in solid");
          frames++;
        }
      }
      const labelCamera=createCameraState({worldX:0,worldY:2,worldZ:0,localOffsetX:.5,localOffsetZ:.5,yaw:0,pitch:0,aspect:viewport.width/viewport.height,far:64});
      let doorway=false;
      const overlay=createNameChatOverlay({canvas,getCamera:()=>labelCamera,
        isBlockedAt:(x,y,z)=>z===4&&x>=-1&&x<=1&&y>=0&&y<=3&&!(doorway&&x===0&&(y===1||y===2)),
        occlusion:{intervalMs:100,maxChecksPerUpdate:8},
        appendRemoteTargets:targets=>targets.push({id:"remote",name:"Remote miner",chatMessage:"Doorway visibility",chatUntil:10000,x:.5,y:0,z:8,heightBlocks:1.5})}).bind();
      overlay.update(1000);
      const wallCount=document.querySelectorAll(".name-chat-target").length;
      if(wallCount!==0)throw Error("labels penetrated wall");
      doorway=true;
      overlay.update(1100);
      const doorCount=document.querySelectorAll(".name-chat-target").length;
      if(doorCount!==1)throw Error("doorway labels not visible");
      const target=document.querySelector(".name-chat-target");
      const rect=target.getBoundingClientRect();
      if(rect.right<0||rect.left>viewport.width||rect.bottom<0||rect.top>viewport.height)throw Error("visible label outside screen");
      window.__fixtureOverlay=overlay;
      const fog=[2,7,20].map(viewDistance=>computeViewEnvironment({viewDistance,cameraOffsetBlocks:8,aspect:viewport.width/viewport.height}));
      if(!fog.every(e=>e.fogNearFar[1]+8<e.renderRadiusBlocks))throw Error("fog beyond render radius");
      return { viewport, renderer, frames, wallCount, doorCount, labelRect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}, fog };
    }, { viewport });
    results.views.push(result);
    await page.screenshot({ path:join(output, `camera-overlay-${viewport.width}.png`) });
    await page.close();
  }
  assert.equal(results.errors.length,0);
  assert.equal(results.views.reduce((sum,view)=>sum+view.frames,0),1350);
  await writeFile(join(output,"camera-browser-results.json"),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
} finally {
  await browser?.close();
  await new Promise((done)=>server.close(done));
}
