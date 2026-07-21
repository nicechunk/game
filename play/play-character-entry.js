import {
  getWalletSession,
  hasBoundWallet,
  redirectToWalletLogin,
} from "./play-auth-session.js";
import { enforcePlayCharacterAccess } from "./play-character-access-gate.js";

const session = getWalletSession();

if (!hasBoundWallet(session)) {
  redirectToWalletLogin({ autoConnect: false });
} else {
  globalThis.NiceChunkLoading?.taskStart?.("character-access");
  const access = await enforcePlayCharacterAccess({
    walletAddress: session.walletAddress,
    fetchAppearance: async (walletAddress) => {
      const { loadPlayChainModule } = await import("./play-chain-adapter.js");
      const chain = await loadPlayChainModule();
      if (typeof chain?.fetchPlayerAppearanceForOwner !== "function") {
        throw new Error("character-verification-unavailable");
      }
      return chain.fetchPlayerAppearanceForOwner(walletAddress);
    },
  });
  globalThis.NiceChunkLoading?.taskDone?.("character-access");
  if (access.allowed) {
    await import("./styles.css");
    await import("./main.js");
  }
}
