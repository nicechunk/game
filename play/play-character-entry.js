import {
  getWalletSession,
  hasBoundWallet,
  redirectToWalletLogin,
} from "./play-auth-session.js";
import {
  characterAccessFailureCode,
  enforcePlayCharacterAccess,
  isRpcRecoveryFailureCode,
} from "./play-character-access-gate.js";

const session = getWalletSession();

if (!hasBoundWallet(session)) {
  redirectToWalletLogin({ autoConnect: false });
} else {
  await enterPlay(session.walletAddress);
}

async function enterPlay(walletAddress) {
  const loader = globalThis.NiceChunkLoading;
  loader?.taskStart?.("character-access");
  loader?.stage?.("characterAccess", 0.24);
  const access = await enforcePlayCharacterAccess({
    walletAddress,
    fetchAppearance: async (owner) => {
      const { loadPlayChainModule } = await import("./play-chain-adapter.js");
      const chain = await loadPlayChainModule();
      if (typeof chain?.fetchPlayerAppearanceForOwner !== "function") {
        throw new Error("character-verification-unavailable");
      }
      return chain.fetchPlayerAppearanceForOwner(owner);
    },
  });

  if (access.allowed) {
    loader?.taskDone?.("character-access");
    await import("./styles.css");
    await import("./main.js");
    return;
  }
  if (access.reason === "character-required") return;

  const error = access.error || new Error(access.reason || "character-verification-failed");
  const failureCode = characterAccessFailureCode(access);
  const failureOptions = {
    code: failureCode,
    stage: "characterAccess",
    onRetry: () => enterPlay(walletAddress),
  };
  if (isRpcRecoveryFailureCode(failureCode)) {
    failureOptions.rpc = { onOpen: openRpcSettingsFromLoader };
  }
  loader?.fail?.(error, failureOptions);
}

async function openRpcSettingsFromLoader({ code, stage, reason, onPresented } = {}) {
  const [, i18n, rpcSettings] = await Promise.all([
    import("./styles.css"),
    import("/src/i18n.js"),
    import("./play-rpc-settings.js"),
  ]);
  await i18n.initI18n(document);
  return rpcSettings.getPlayRpcSettings().open({
    context: { code, stage, reason },
    onPresented,
    restoreFocus: false,
  });
}
