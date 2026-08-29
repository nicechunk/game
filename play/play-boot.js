(() => {
  try {
    const wallet = localStorage.getItem("nicechunk.walletAddress");
    const boundAt = localStorage.getItem("nicechunk.walletBoundAt");
    if (wallet && boundAt) return;
  } catch {
    // A game session cannot be maintained when browser storage is unavailable.
  }
  document.documentElement.hidden = true;
  const loginUrl = new URL("/login/", location.origin);
  loginUrl.searchParams.set("redirect", `${location.pathname}${location.search}${location.hash}` || "/play/");
  location.replace(loginUrl);
})();
