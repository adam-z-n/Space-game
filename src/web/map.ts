import { laneLength, type FleetId, type GameState, type SystemId } from "../core";
import type { ContentPack } from "../core";

const SVG_NS = "http://www.w3.org/2000/svg";
/** Screen pixels within which a tap selects a star. Keeps touch targets ~44pt+. */
const TAP_RADIUS_PX = 28;
const TAP_SLOP_PX = 10;

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapSelection {
  systemId: SystemId | null;
  fleetId: FleetId | null;
}

/**
 * The galaxy map: an SVG with touch pan, pinch zoom, wheel zoom, and tap-to-select.
 * It only reads GameState; taps are reported to the caller.
 */
export class GalaxyMap {
  readonly svg: SVGSVGElement;
  private view: View = { x: 0, y: 0, w: 1000, h: 1000 };
  private bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  private state: GameState | null = null;
  private selection: MapSelection = { systemId: null, fleetId: null };
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: { startX: number; startY: number; moved: boolean; pinchDist: number } | null = null;
  private frame = 0;
  /** Set when a new galaxy arrives; the fit waits until the element has a real size. */
  private needsFit = false;

  constructor(
    parent: HTMLElement,
    private readonly pack: ContentPack,
    private readonly onTap: (systemId: SystemId | null) => void,
  ) {
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.classList.add("map");
    parent.appendChild(this.svg);
    this.bindInput();
    new ResizeObserver(() => this.fitAspect()).observe(this.svg);
  }

  setState(state: GameState, selection: MapSelection): void {
    const first = this.state === null || this.state.settings.seed !== state.settings.seed;
    this.state = state;
    this.selection = selection;
    if (first) this.needsFit = true;
    this.requestRender();
  }

  /** Frame the whole galaxy. */
  fitGalaxy(): void {
    if (!this.state) return;
    const xs = this.state.galaxy.systems.map((s) => s.x);
    const ys = this.state.galaxy.systems.map((s) => s.y);
    const pad = 80;
    this.bounds = { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad };
    const { width, height } = this.size();
    const bw = this.bounds.maxX - this.bounds.minX;
    const bh = this.bounds.maxY - this.bounds.minY;
    // Frame the galaxy in the strip between the top bar and the bottom panel.
    const landscape = width > height;
    const top = 70;
    const bottom = landscape ? 90 : Math.min(height * 0.45, 380);
    const right = landscape ? Math.min(width * 0.45, 440) : 0;
    const usableW = width - right;
    const usableH = Math.max(height - top - bottom, height * 0.35);
    const scale = Math.max(bw / usableW, bh / usableH);
    const w = width * scale;
    const h = height * scale;
    const cx = this.bounds.minX + bw / 2;
    const cy = this.bounds.minY + bh / 2;
    this.view = { x: cx - (usableW / 2) * scale, y: cy - (top + usableH / 2) * scale, w, h };
    this.requestRender();
  }

  centerOn(systemId: SystemId): void {
    const system = this.state?.galaxy.systems[systemId];
    if (!system) return;
    this.view.x = system.x - this.view.w / 2;
    this.view.y = system.y - this.view.h / 2;
    this.requestRender();
  }

  private size() {
    const rect = this.svg.getBoundingClientRect();
    return { width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) };
  }

  /** World units per screen pixel. */
  private scale(): number {
    return this.view.w / this.size().width;
  }

  /** Keep the view's aspect ratio equal to the element's so scaling stays uniform. */
  private fitAspect(): void {
    const { width, height } = this.size();
    const cx = this.view.x + this.view.w / 2;
    const cy = this.view.y + this.view.h / 2;
    this.view.h = (this.view.w * height) / width;
    this.view.x = cx - this.view.w / 2;
    this.view.y = cy - this.view.h / 2;
    this.requestRender();
  }

  private toWorld(clientX: number, clientY: number) {
    const rect = this.svg.getBoundingClientRect();
    const s = this.scale();
    return { x: this.view.x + (clientX - rect.left) * s, y: this.view.y + (clientY - rect.top) * s };
  }

  private zoomAt(clientX: number, clientY: number, factor: number): void {
    const bw = this.bounds.maxX - this.bounds.minX;
    const newW = Math.min(Math.max(this.view.w * factor, 250), bw * 2.5);
    const actual = newW / this.view.w;
    const p = this.toWorld(clientX, clientY);
    this.view.x = p.x - (p.x - this.view.x) * actual;
    this.view.y = p.y - (p.y - this.view.y) * actual;
    this.view.w *= actual;
    this.view.h *= actual;
    this.requestRender();
  }

  private bindInput(): void {
    const svg = this.svg;
    svg.addEventListener("pointerdown", (e) => {
      svg.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.gesture = { startX: e.clientX, startY: e.clientY, moved: false, pinchDist: 0 };
      } else if (this.pointers.size === 2 && this.gesture) {
        const [a, b] = [...this.pointers.values()];
        this.gesture.pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        this.gesture.moved = true;
      }
    });

    svg.addEventListener("pointermove", (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev || !this.gesture) return;
      const next = { x: e.clientX, y: e.clientY };
      this.pointers.set(e.pointerId, next);

      if (this.pointers.size === 1) {
        if (Math.hypot(next.x - this.gesture.startX, next.y - this.gesture.startY) > TAP_SLOP_PX) this.gesture.moved = true;
        if (!this.gesture.moved) return;
        const s = this.scale();
        this.view.x -= (next.x - prev.x) * s;
        this.view.y -= (next.y - prev.y) * s;
        this.requestRender();
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (this.gesture.pinchDist > 0 && dist > 0) {
          this.zoomAt((a!.x + b!.x) / 2, (a!.y + b!.y) / 2, this.gesture.pinchDist / dist);
        }
        this.gesture.pinchDist = dist;
      }
    });

    const end = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0 && this.gesture) {
        if (!this.gesture.moved && e.type === "pointerup") this.handleTap(e.clientX, e.clientY);
        this.gesture = null;
      }
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);

    svg.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * 0.0015));
      },
      { passive: false },
    );
  }

  private handleTap(clientX: number, clientY: number): void {
    if (!this.state) return;
    const p = this.toWorld(clientX, clientY);
    const limit = TAP_RADIUS_PX * this.scale();
    let best: SystemId | null = null;
    let bestDist = Infinity;
    for (const system of this.state.galaxy.systems) {
      const d = Math.hypot(system.x - p.x, system.y - p.y);
      if (d < bestDist) {
        bestDist = d;
        best = system.id;
      }
    }
    this.onTap(bestDist <= Math.max(limit, 20) ? best : null);
  }

  private requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render(): void {
    const state = this.state;
    const svg = this.svg;
    if (this.needsFit && state && this.svg.getBoundingClientRect().width > 1) {
      this.needsFit = false;
      this.fitGalaxy();
    }
    svg.setAttribute("viewBox", `${this.view.x} ${this.view.y} ${this.view.w} ${this.view.h}`);
    if (!state) return;

    const s = this.scale();
    const px = (n: number) => n * s;
    const parts: string[] = [];
    const systems = state.galaxy.systems;

    for (const lane of state.galaxy.lanes) {
      const a = systems[lane.a]!;
      const b = systems[lane.b]!;
      parts.push(`<line class="lane" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke-width="${px(1.5)}"/>`);
    }

    // Routes of moving fleets.
    for (const fleet of state.fleets) {
      if (fleet.route.length === 0) continue;
      const color = state.empires[fleet.empireId]!.color;
      const pos = this.fleetPosition(state, fleet.id);
      const points = [`${pos.x},${pos.y}`, ...fleet.route.map((id) => `${systems[id]!.x},${systems[id]!.y}`)];
      const width = fleet.id === this.selection.fleetId ? 3 : 1.5;
      parts.push(`<polyline class="route" points="${points.join(" ")}" stroke="${color}" stroke-width="${px(width)}"/>`);
    }

    const starRadius = Math.max(9, px(6));
    const homes = new Map(state.empires.map((e) => [e.homeSystemId, e.color]));
    const player = state.empires[0]!;
    const explored = new Set(player.explored);
    for (const system of systems) {
      const starType = this.pack.starTypes.find((t) => t.id === system.starType);
      const opacity = explored.has(system.id) ? 1 : 0.55;
      const home = homes.get(system.id);
      if (home) {
        parts.push(`<circle cx="${system.x}" cy="${system.y}" r="${starRadius + px(5)}" fill="none" stroke="${home}" stroke-width="${px(2.5)}"/>`);
      }
      parts.push(`<circle cx="${system.x}" cy="${system.y}" r="${starRadius}" fill="${starType?.color ?? "#fff"}" opacity="${opacity}"/>`);
      if (system.id === this.selection.systemId) {
        parts.push(`<circle class="selected-ring" cx="${system.x}" cy="${system.y}" r="${starRadius + px(11)}" stroke-width="${px(1.5)}"/>`);
      }
      parts.push(
        `<text class="star-label" x="${system.x}" y="${system.y + starRadius + px(16)}" font-size="${px(12)}" opacity="${opacity}">${escapeXml(system.name)}</text>`,
      );
    }

    // Fleets: small chevrons offset around their position, in empire color.
    const stackCount = new Map<string, number>();
    for (const fleet of state.fleets) {
      const pos = this.fleetPosition(state, fleet.id);
      const key = `${Math.round(pos.x)},${Math.round(pos.y)}`;
      const index = stackCount.get(key) ?? 0;
      stackCount.set(key, index + 1);
      const fx = pos.x + starRadius + px(6) + index * px(11);
      const fy = pos.y - starRadius - px(4);
      const size = px(fleet.id === this.selection.fleetId ? 9 : 7);
      const color = state.empires[fleet.empireId]!.color;
      parts.push(
        `<path d="M${fx} ${fy - size} L${fx + size * 0.8} ${fy + size * 0.7} L${fx} ${fy + size * 0.2} L${fx - size * 0.8} ${fy + size * 0.7} Z" fill="${color}" stroke="#05070d" stroke-width="${px(1)}"/>`,
      );
    }

    svg.innerHTML = parts.join("");
  }

  private fleetPosition(state: GameState, fleetId: FleetId): { x: number; y: number } {
    const fleet = state.fleets.find((f) => f.id === fleetId)!;
    const from = state.galaxy.systems[fleet.systemId]!;
    if (fleet.progress === 0 || fleet.route.length === 0) return from;
    const to = state.galaxy.systems[fleet.route[0]!]!;
    const t = fleet.progress / laneLength(state.galaxy, from.id, to.id)!;
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  }
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
}
