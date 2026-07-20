const DEFAULT_PROFILE_NAME = "Local Miner";
const DEFAULT_PROFILE_TITLE = "Explorer";
const DEFAULT_PROFILE_GENDER = "male";
const DEFAULT_PROFILE_MODEL_CODE = "NCM:peasant_guy:v1";

export function createPlayProfileSession({
  gameState,
  getChainPlayer = () => null,
  getChainSession = () => null,
  getAvatarSession = () => null,
  renderGameUi = () => {},
  setStatus = () => {},
  defaultModelCode = DEFAULT_PROFILE_MODEL_CODE,
} = {}) {
  return {
    savePlayerName,
    savePlayerAppearance,
    displayName,
    identityForHud,
    currentAvatarModelCode,
  };

  function savePlayerName(value) {
    const name = normalizeProfileName(value);
    if (!name) {
      setStatus("Enter a player name before saving.");
      return { ok: false, reason: "empty-player-name" };
    }

    gameState.playerProfile.name = name;
    gameState.savePlayerProfile();
    renderGameUi();
    getChainSession()?.render?.();

    const wallet = getChainSession()?.snapshot?.()?.walletAddress || "";
    const chainPlayer = getChainPlayer();
    if (!wallet || !chainPlayer?.upsertProfileName) {
      setStatus("Local player name saved. Connect a wallet to create or update the Player PDA.");
      return { ok: true, localOnly: true, playerName: name };
    }

    setStatus(`Saving player profile: ${name}...`);
    const request = chainPlayer.upsertProfileName(name, { quiet: false });
    request?.then?.((result) => {
      if (result?.ok) {
        renderGameUi();
        getChainSession()?.render?.();
        return;
      }
      setStatus(`Player profile save skipped: ${result?.reason || "not-submitted"}.`);
      renderGameUi();
    });
    return request;
  }

  function savePlayerAppearance(value = {}) {
    const profile = gameState.playerProfile || {};
    const name = normalizeProfileName(value.playerName || profile.name);
    if (!name) {
      setStatus("Enter a player name before saving appearance.");
      return { ok: false, reason: "empty-player-name" };
    }
    const title = normalizeProfileTitle(value.title || profile.title || DEFAULT_PROFILE_TITLE);
    const gender = normalizeProfileGender(value.gender || profile.gender || DEFAULT_PROFILE_GENDER);
    const modelCode = normalizeProfileModelCode(value.ncmCode || profile.modelCode || defaultModelCode);
    if (!modelCode) {
      setStatus("NCM model code must start with NCM.");
      return { ok: false, reason: "invalid-character-code" };
    }

    profile.name = name;
    profile.title = title;
    profile.gender = gender;
    profile.modelCode = modelCode;
    gameState.savePlayerProfile();
    getAvatarSession()?.syncModelFromProfile({ quiet: false });
    renderGameUi();
    getChainSession()?.render?.();

    const wallet = getChainSession()?.snapshot?.()?.walletAddress || "";
    const chainPlayer = getChainPlayer();
    if (!wallet || !chainPlayer?.upsertAppearance) {
      setStatus("Local appearance saved. Connect a wallet to create or update the Appearance PDA.");
      return { ok: true, localOnly: true, playerName: name, title, gender, modelCode };
    }

    setStatus(`Saving player appearance: ${name}...`);
    const request = chainPlayer.upsertAppearance({
      playerName: name,
      title,
      gender,
      ncmCode: modelCode,
    }, { quiet: false });
    request?.then?.((result) => {
      if (result?.ok) {
        renderGameUi();
        getChainSession()?.render?.();
        return;
      }
      setStatus(`Player appearance save skipped: ${result?.reason || "not-submitted"}.`);
      renderGameUi();
    });
    return request;
  }

  function displayName() {
    return getChainPlayer()?.snapshot?.()?.identity?.name || gameState.playerProfile?.name || DEFAULT_PROFILE_NAME;
  }

  function identityForHud() {
    const identity = getChainPlayer()?.snapshot?.()?.identity || {};
    return {
      ...identity,
      name: identity.name || gameState.playerProfile?.name || DEFAULT_PROFILE_NAME,
    };
  }

  function currentAvatarModelCode() {
    const chainAppearance = getChainPlayer()?.snapshot?.()?.appearance || null;
    return normalizeProfileModelCode(chainAppearance?.modelCode)
      || normalizeProfileModelCode(gameState.playerProfile?.modelCode)
      || defaultModelCode;
  }
}

function normalizeProfileName(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return Array.from(normalized).slice(0, 32).join("");
}

function normalizeProfileTitle(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return Array.from(normalized).slice(0, 64).join("");
}

function normalizeProfileGender(value) {
  return String(value || "").toLowerCase() === "female" ? "female" : "male";
}

function normalizeProfileModelCode(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.startsWith("NCM") ? normalized.slice(0, 2048) : "";
}
