const LAMPORTS_PER_SOL = 1_000_000_000;

export function formatAccountBalanceValue({ connected = false, status = "disconnected", lamports = 0 } = {}) {
  if (!connected) return "0.000000";
  if (status === "ready" || status === "stale") {
    const sol = Math.max(0, Number(lamports) || 0) / LAMPORTS_PER_SOL;
    return sol.toFixed(6);
  }
  return status === "loading" ? "Loading..." : "--";
}
