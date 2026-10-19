import { cameraForward } from "../chunk.js/renderer/camera.js";

// Track rendering activity independently of player locomotion. In particular,
// mouse/touch orbit, first-person look and camera recovery do not move a player.
export function createCameraActivityTracker({ settleMs = 160 } = {}) {
  let pose = null, lastMotionAt = -Infinity, lastObservedAt = -Infinity;
  const holdMs = Math.max(0, Number(settleMs) || 0);
  return { update, active, reset };

  function update(camera, now = performance.now()) {
    if (!camera || !Number.isFinite(now) || now < lastObservedAt) { reset(); return false; }
    lastObservedAt = now;
    const forward = cameraForward(camera);
    const x = camera.worldX || 0, y = camera.worldY || 0, z = camera.worldZ || 0;
    const lx = camera.localOffsetX || 0, ly = camera.localOffsetY || 0, lz = camera.localOffsetZ || 0;
    const moved = pose && (Math.abs((x-pose.x)+(lx-pose.lx)) > .0001
      || Math.abs((y-pose.y)+(ly-pose.ly)) > .0001 || Math.abs((z-pose.z)+(lz-pose.lz)) > .0001
      || (forward[0]-pose.fx)**2+(forward[1]-pose.fy)**2+(forward[2]-pose.fz)**2 > 1e-8
      || camera.fov !== pose.fov || camera.aspect !== pose.aspect || camera.near !== pose.near || camera.far !== pose.far);
    if (!pose || moved) {
      // Keep the last significant pose so a slow continuous turn accumulates
      // past the threshold. Sub-threshold floating-point jitter stays idle.
      pose ??= {};
      Object.assign(pose, { x,y,z,lx,ly,lz,fx:forward[0],fy:forward[1],fz:forward[2],
        fov:camera.fov,aspect:camera.aspect,near:camera.near,far:camera.far });
      if (moved) lastMotionAt = now;
    }
    return active(now);
  }

  function active(now = performance.now()) {
    return Number.isFinite(now) && now >= lastMotionAt && now-lastMotionAt < holdMs;
  }

  function reset() { pose = null; lastMotionAt = lastObservedAt = -Infinity; }
}
