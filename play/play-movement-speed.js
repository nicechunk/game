export const PLAYER_MOVEMENT_CONFIG = Object.freeze({
  baseSpeed: 14.8,
  sprintMultiplier: 2,
});

export function playerMovementSpeeds(movementSpeedMultiplier = 1) {
  const parsed = Number(movementSpeedMultiplier);
  const skillMultiplier = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const walking = PLAYER_MOVEMENT_CONFIG.baseSpeed * skillMultiplier;
  return {
    walking,
    running: walking * PLAYER_MOVEMENT_CONFIG.sprintMultiplier,
  };
}

export function applyPlayerMovementSpeeds(controls, skillEffects = {}) {
  const speeds = playerMovementSpeeds(skillEffects.movementSpeedMultiplier);
  if (controls) {
    controls.speed = speeds.walking;
    controls.sprintMultiplier = PLAYER_MOVEMENT_CONFIG.sprintMultiplier;
  }
  return speeds;
}
