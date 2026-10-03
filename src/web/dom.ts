/** Tiny DOM helpers shared by the web UI. */

export type Props<E> = Partial<Omit<E, "style">> & { style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const { style, ...rest } = props;
  const el = Object.assign(document.createElement(tag), rest);
  if (style) el.setAttribute("style", style);
  for (const child of children) if (child !== null) el.append(child);
  return el;
}

export function button(label: string, onClick: () => void, props: Props<HTMLButtonElement> = {}): HTMLButtonElement {
  const b = h("button", { textContent: label, ...props });
  b.onclick = (e) => {
    e.stopPropagation();
    onClick();
  };
  return b;
}

export const turnsText = (n: number) => (!Number.isFinite(n) ? "never" : n === 1 ? "1 turn" : `${n} turns`);

export const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** A thin progress bar, 0-1. */
export function bar(fraction: number): HTMLElement {
  const clamped = Math.max(0, Math.min(1, fraction));
  return h("div", { className: "bar" }, h("div", { className: "bar-fill", style: `width:${(clamped * 100).toFixed(1)}%` }));
}
