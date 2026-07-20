const CONNECTION_STATES = new Set(["connected", "connecting", "disconnected"]);

export function resolveGuardianConnectionState({
  enabled = true,
  walletAvailable = false,
  connected = false,
  connecting = false,
  offline = false,
} = {}) {
  if (!enabled || !walletAvailable || offline) return "disconnected";
  if (connected) return "connected";
  return connecting ? "connecting" : "disconnected";
}

export function applyGuardianConnectionState(element, state) {
  if (!element) return false;
  const next = CONNECTION_STATES.has(state) ? state : "disconnected";
  if (element.dataset.state === next) return false;
  element.dataset.state = next;
  return true;
}
