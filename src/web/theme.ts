import "@fontsource/silkscreen/400.css";
import "@fontsource/silkscreen/700.css";
import type { ContentPack } from "../core";

/** Push the content pack's presentation (colors, display font) into CSS variables. */
export function applyTheme(pack: ContentPack): void {
  const p = pack.presentation;
  const root = document.documentElement.style;
  const c = p.colors;
  root.setProperty("--bg", c.background);
  root.setProperty("--panel", `${c.panel}f0`);
  root.setProperty("--panel-solid", c.panel);
  root.setProperty("--line", c.panelEdge);
  root.setProperty("--text", c.text);
  root.setProperty("--muted", c.muted);
  root.setProperty("--accent", c.accent);
  root.setProperty("--warn", c.warn);
  root.setProperty("--danger", c.danger);
  root.setProperty("--display-font", `"${p.displayFont}", ui-monospace, monospace`);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", c.background);
}
