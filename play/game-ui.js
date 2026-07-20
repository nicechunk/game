import { createPlayBackpackUi } from "./play-backpack-ui.js";
import { createPlayHotbarUi } from "./play-hotbar-ui.js";
import { createPlayProfileUi } from "./play-profile-ui.js";

export function createPlayGameUi(options = {}) {
  const api = {};
  const hotbar = createPlayHotbarUi({
    ...options,
    onOpenBackpack: () => api.openBackpackPanel(),
    onRenderHotbar: () => api.renderHotbar(),
  });
  const backpack = createPlayBackpackUi({
    ...options,
    onRenderGameUi: () => api.renderGameUi(),
  });
  const profile = createPlayProfileUi(options);

  Object.assign(api, {
    renderGameUi() {
      api.renderHotbar();
      api.renderBackpack();
      api.renderProfile();
    },
    renderHotbar() {
      hotbar.render();
    },
    renderBackpack() {
      backpack.render();
    },
    renderProfile() {
      profile.render();
    },
    toggleBackpackPanel() {
      if (options.elements?.backpackPanel?.hidden) api.openBackpackPanel();
      else api.closeBackpackPanel();
    },
    openBackpackPanel() {
      api.closeProfilePanel();
      options.onBackpackPanelOpened?.();
      backpack.openPanel();
    },
    closeBackpackPanel() {
      options.onBackpackPanelClosed?.();
      backpack.closePanel();
    },
    toggleProfilePanel() {
      if (options.elements?.profilePanel?.hidden) api.openProfilePanel();
      else api.closeProfilePanel();
    },
    openProfilePanel() {
      api.closeBackpackPanel();
      profile.openPanel();
    },
    closeProfilePanel() {
      profile.closePanel();
    },
    closePanels() {
      api.closeBackpackPanel();
      api.closeProfilePanel();
    },
  });

  return api;
}
