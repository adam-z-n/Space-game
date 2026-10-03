/**
 * App lifecycle. On the web, "backgrounded" means the tab is hidden or the page
 * is being unloaded; a native build would hook Capacitor's App pause event here.
 * Returns an unsubscribe function.
 */
export function onAppBackground(callback: () => void): () => void {
  const onVisibility = () => {
    if (document.visibilityState === "hidden") callback();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", callback);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", callback);
  };
}
