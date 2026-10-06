// Registers the service worker (public/sw.js). Production builds only, unless
// ?sw=1 is in the address: under the Vite dev server a cached shell would
// fight hot reload.
export function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const wanted = import.meta.env?.PROD || new URLSearchParams(location.search).get("sw") === "1";
  if (!wanted) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => console.warn("[nex-camp] service worker not registered:", error.message));
  });
}
