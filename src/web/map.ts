import type { ContentPack, EmpireView, FleetId, SystemId } from "../core";

const SVG_NS = "http://www.w3.org/2000/svg";
/** Screen pixels within which a tap hits a star or fleet. Keeps touch targets ~44pt. */
const TAP_RADIUS_PX = 26;
/** Movement before a press counts as a drag rather than a tap. */
const TAP_SLOP_PX = 10;
const LONG_PRESS_MS = 500;

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoutePreview {
  fleetId: FleetId;
  /** Systems the fleet will pass through, ending at the destination. */
  route: SystemId[];
  turns: number;
}

export interface MapScene {
  view: EmpireView;
  selectedSystem: SystemId | null;
  selectedFleet: FleetId | null;
  preview: RoutePreview | null;
}

export type MapTarget = { kind: "system"; id: SystemId } | { kind: "fleet"; id: FleetId };

export interface MapHandlers {
  onTap(target: MapTarget | null): void;
  onLongPress(target: MapTarget, clientX: number, clientY: number): void;
  /** Dragging from one of the player's fleets; `final` on release. */
  onDragOrder(fleetId: FleetId, systemId: SystemId | null, final: boolean): void;
}

interface FleetMarker {
  id: FleetId;
  x: number;
  y: number;
  own: boolean;
}

type Gesture = {
  startX: number;
  startY: number;
  moved: boolean;
  pinchDist: number;
  /** Set when the press began on one of the player's fleets. */
  dragFleet: FleetId | null;
  longPressTimer: number;
  longPressed: boolean;
};

/**
 * The galaxy map: an SVG with touch pan, pinch zoom, wheel zoom, tap and
 * long-press, and drag-to-order from a fleet. It renders an EmpireView only,
 * so it can never show what the player isn't allowed to know.
 */
export class GalaxyMap {
  readonly svg: SVGSVGElement;
  private view: View = { x: 0, y: 0, w: 1000, h: 1000 };
  private bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  private scene: MapScene | null = null;
  private galaxyKey = "";
  private markers: FleetMarker[] = [];
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: Gesture | null = null;
  private frame = 0;
  /** Set when a new galaxy arrives; the fit waits until the element has a real size. */
  private needsFit = false;
  /** A centerOn() request that arrived before the first fit. */
  private pendingCenter: { x: number; y: number } | null = null;

  constructor(
    parent: HTMLElement,
    private readonly pack: ContentPack,
    private readonly handlers: MapHandlers,
  ) {
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.classList.add("map");
    parent.appendChild(this.svg);
    this.bindInput();
    new ResizeObserver(() => this.fitAspect()).observe(this.svg);
  }

  setScene(scene: MapScene): void {
    const key = scene.view.systems.map((s) => `${s.x},${s.y}`).join(";");
    if (key !== this.galaxyKey) {
      this.galaxyKey = key;
      this.needsFit = true;
    }
    this.scene = scene;
    this.requestRender();
  }

  /** Frame the whole galaxy in the space the HUD leaves free. */
  fitGalaxy(): void {
    if (!this.scene) return;
    const xs = this.scene.view.systems.map((s) => s.x);
    const ys = this.scene.view.systems.map((s) => s.y);
    const pad = 80;
    this.bounds = { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad };
    const { width, height } = this.size();
    const bw = this.bounds.maxX - this.bounds.minX;
    const bh = this.bounds.maxY - this.bounds.minY;
    const landscape = width > height;
    const top = 70;
    const bottom = landscape ? 90 : Math.min(height * 0.3, 260);
    const right = landscape ? Math.min(width * 0.45, 440) : 0;
    const usableW = width - right;
    const usableH = Math.max(height - top - bottom, height * 0.35);
    const scale = Math.max(bw / usableW, bh / usableH);
    const cx = this.bounds.minX + bw / 2;
    const cy = this.bounds.minY + bh / 2;
    this.view = { x: cx - (usableW / 2) * scale, y: cy - (top + usableH / 2) * scale, w: width * scale, h: height * scale };
    this.requestRender();
  }

  /** Pan so a point sits in the visible middle, zooming in if very far out. */
  centerOn(x: number, y: number): void {
    if (this.needsFit) {
      this.pendingCenter = { x, y };
      return;
    }
    const { width } = this.size();
    const comfortable = width * 1.6;
    if (this.view.w > comfortable * 1.5) {
      this.view.h *= comfortable / this.view.w;
      this.view.w = comfortable;
    }
    this.view.x = x - this.view.w / 2;
    this.view.y = y - this.view.h * 0.35;
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

  // ---------- hit testing ----------

  private nearestSystem(clientX: number, clientY: number, radiusPx: number): SystemId | null {
    if (!this.scene) return null;
    const p = this.toWorld(clientX, clientY);
    let best: SystemId | null = null;
    let bestDist = Math.max(radiusPx * this.scale(), 20);
    for (const system of this.scene.view.systems) {
      const d = Math.hypot(system.x - p.x, system.y - p.y);
      if (d <= bestDist) {
        bestDist = d;
        best = system.id;
      }
    }
    return best;
  }

  private nearestFleet(clientX: number, clientY: number, ownOnly: boolean): FleetMarker | null {
    const p = this.toWorld(clientX, clientY);
    let best: FleetMarker | null = null;
    let bestDist = TAP_RADIUS_PX * this.scale();
    for (const marker of this.markers) {
      if (ownOnly && !marker.own) continue;
      const d = Math.hypot(marker.x - p.x, marker.y - p.y);
      if (d <= bestDist) {
        bestDist = d;
        best = marker;
      }
    }
    return best;
  }

  /** Fleets win over stars when both are under the finger: their icons sit beside the star. */
  private targetAt(clientX: number, clientY: number): MapTarget | null {
    const fleet = this.nearestFleet(clientX, clientY, false);
    if (fleet) return { kind: "fleet", id: fleet.id };
    const system = this.nearestSystem(clientX, clientY, TAP_RADIUS_PX);
    return system === null ? null : { kind: "system", id: system };
  }

  // ---------- input ----------

  private bindInput(): void {
    const svg = this.svg;

    svg.addEventListener("pointerdown", (e) => {
      svg.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        const own = this.nearestFleet(e.clientX, e.clientY, true);
        const gesture: Gesture = {
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
          pinchDist: 0,
          dragFleet: own?.id ?? null,
          longPressTimer: 0,
          longPressed: false,
        };
        gesture.longPressTimer = window.setTimeout(() => {
          if (this.gesture !== gesture || gesture.moved) return;
          const target = this.targetAt(gesture.startX, gesture.startY);
          if (!target) return;
          gesture.longPressed = true;
          navigator.vibrate?.(10);
          this.handlers.onLongPress(target, gesture.startX, gesture.startY);
        }, LONG_PRESS_MS);
        this.gesture = gesture;
      } else if (this.pointers.size === 2 && this.gesture) {
        // A second finger always means pinch, even if the first was on a fleet.
        const [a, b] = [...this.pointers.values()];
        this.cancelDrag();
        this.gesture.pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        this.gesture.moved = true;
        this.gesture.dragFleet = null;
        clearTimeout(this.gesture.longPressTimer);
      }
    });

    svg.addEventListener("pointermove", (e) => {
      const prev = this.pointers.get(e.pointerId);
      const gesture = this.gesture;
      if (!prev || !gesture || gesture.longPressed) return;
      const next = { x: e.clientX, y: e.clientY };
      this.pointers.set(e.pointerId, next);

      if (this.pointers.size === 1) {
        if (!gesture.moved && Math.hypot(next.x - gesture.startX, next.y - gesture.startY) > TAP_SLOP_PX) {
          gesture.moved = true;
          clearTimeout(gesture.longPressTimer);
        }
        if (!gesture.moved) return;
        if (gesture.dragFleet !== null) {
          this.handlers.onDragOrder(gesture.dragFleet, this.nearestSystem(next.x, next.y, 44), false);
          return;
        }
        const s = this.scale();
        this.view.x -= (next.x - prev.x) * s;
        this.view.y -= (next.y - prev.y) * s;
        this.requestRender();
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (gesture.pinchDist > 0 && dist > 0) this.zoomAt((a!.x + b!.x) / 2, (a!.y + b!.y) / 2, gesture.pinchDist / dist);
        gesture.pinchDist = dist;
      }
    });

    const end = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      const gesture = this.gesture;
      if (this.pointers.size > 0 || !gesture) return;
      clearTimeout(gesture.longPressTimer);
      this.gesture = null;
      if (gesture.longPressed) return;
      if (gesture.moved && gesture.dragFleet !== null) {
        const target = e.type === "pointerup" ? this.nearestSystem(e.clientX, e.clientY, 44) : null;
        this.handlers.onDragOrder(gesture.dragFleet, target, true);
      } else if (!gesture.moved && e.type === "pointerup") {
        this.handlers.onTap(this.targetAt(e.clientX, e.clientY));
      }
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    svg.addEventListener("contextmenu", (e) => e.preventDefault());

    svg.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * 0.0015));
      },
      { passive: false },
    );
  }

  private cancelDrag(): void {
    if (this.gesture?.dragFleet != null && this.gesture.moved) this.handlers.onDragOrder(this.gesture.dragFleet, null, true);
  }

  // ---------- rendering ----------

  private requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render(): void {
    const scene = this.scene;
    if (this.needsFit && scene && this.svg.getBoundingClientRect().width > 1) {
      this.needsFit = false;
      this.fitGalaxy();
      if (this.pendingCenter) {
        this.centerOn(this.pendingCenter.x, this.pendingCenter.y);
        this.pendingCenter = null;
      }
    }
    this.svg.setAttribute("viewBox", `${this.view.x} ${this.view.y} ${this.view.w} ${this.view.h}`);
    if (!scene) return;

    const { view } = scene;
    const s = this.scale();
    const px = (n: number) => n * s;
    const systems = view.systems;
    const color = (empireId: number) => view.empires[empireId]!.color;
    const parts: string[] = [];

    // Sensor coverage, drawn as one faint layer so overlaps don't stack up.
    parts.push(`<g class="sensors">`);
    for (const sensor of view.sensors) {
      if (sensor.range > 0) parts.push(`<circle cx="${sensor.x}" cy="${sensor.y}" r="${sensor.range}"/>`);
    }
    parts.push(`</g>`);

    for (const lane of view.lanes) {
      const a = systems[lane.a]!;
      const b = systems[lane.b]!;
      parts.push(`<line class="lane" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke-width="${px(1.5)}"/>`);
    }

    // Standing orders of the player's fleets.
    const fleetById = new Map(view.fleets.map((f) => [f.id, f]));
    for (const fleet of view.fleets) {
      if (!fleet.own || !fleet.route || fleet.route.length === 0 || fleet.id === scene.preview?.fleetId) continue;
      const points = [`${fleet.x},${fleet.y}`, ...fleet.route.map((id) => `${systems[id]!.x},${systems[id]!.y}`)];
      const width = fleet.id === scene.selectedFleet ? 2.5 : 1.5;
      parts.push(`<polyline class="route" points="${points.join(" ")}" stroke="${color(fleet.empireId)}" stroke-width="${px(width)}" stroke-dasharray="${px(6)} ${px(6)}"/>`);
    }

    // The order being set up right now.
    const preview = scene.preview;
    if (preview) {
      const fleet = fleetById.get(preview.fleetId);
      if (fleet) {
        const points = [`${fleet.x},${fleet.y}`, ...preview.route.map((id) => `${systems[id]!.x},${systems[id]!.y}`)];
        parts.push(`<polyline class="route preview" points="${points.join(" ")}" stroke-width="${px(3)}" stroke-dasharray="${px(8)} ${px(5)}"/>`);
        const dest = systems[preview.route[preview.route.length - 1] ?? fleet.position.systemId]!;
        parts.push(`<circle class="preview-dest" cx="${dest.x}" cy="${dest.y}" r="${px(18)}" stroke-width="${px(2.5)}"/>`);
        const label = preview.turns === 0 ? "here" : preview.turns === 1 ? "1 turn" : `${preview.turns} turns`;
        parts.push(`<text class="preview-label" x="${dest.x}" y="${dest.y - px(26)}" font-size="${px(14)}">${label}</text>`);
      }
    }

    const starRadius = Math.max(8, px(6));
    for (const system of systems) {
      const starType = this.pack.starTypes.find((t) => t.id === system.starType);
      const opacity = system.explored ? 1 : 0.45;
      if (system.homeOf !== null) {
        parts.push(`<circle cx="${system.x}" cy="${system.y}" r="${starRadius + px(5)}" fill="none" stroke="${color(system.homeOf)}" stroke-width="${px(2.5)}"/>`);
      }
      parts.push(`<circle cx="${system.x}" cy="${system.y}" r="${starRadius}" fill="${starType?.color ?? "#fff"}" opacity="${opacity}"/>`);
      if (system.id === scene.selectedSystem) {
        parts.push(`<circle class="selected-ring" cx="${system.x}" cy="${system.y}" r="${starRadius + px(11)}" stroke-width="${px(1.5)}" stroke-dasharray="${px(4)} ${px(4)}"/>`);
      }
    }

    // Fleets: chevrons beside their star (or on their lane), stacked when several share a spot.
    this.markers = [];
    const stacks = new Map<string, number>();
    const ordered = [...view.fleets].sort((a, b) => Number(b.own) - Number(a.own) || a.id - b.id);
    for (const fleet of ordered) {
      const key = `${Math.round(fleet.x)},${Math.round(fleet.y)}`;
      const index = stacks.get(key) ?? 0;
      stacks.set(key, index + 1);
      const inSystem = fleet.position.progress === 0;
      const fx = fleet.x + (inSystem ? starRadius + px(9) : 0) + index * px(14);
      const fy = fleet.y - (inSystem ? starRadius + px(4) : 0);
      this.markers.push({ id: fleet.id, x: fx, y: fy, own: fleet.own });
      const selected = fleet.id === scene.selectedFleet;
      const size = px(selected ? 10 : 8);
      const stale = fleet.seenTurn < view.turn;
      const fill = stale ? "none" : color(fleet.empireId);
      const stroke = stale ? color(fleet.empireId) : "#05070d";
      if (selected) parts.push(`<circle class="selected-ring" cx="${fx}" cy="${fy}" r="${px(15)}" stroke-width="${px(1.5)}" stroke-dasharray="${px(3)} ${px(3)}"/>`);
      parts.push(
        `<path d="M${fx} ${fy - size} L${fx + size * 0.8} ${fy + size * 0.7} L${fx} ${fy + size * 0.2} L${fx - size * 0.8} ${fy + size * 0.7} Z" fill="${fill}" stroke="${stroke}" stroke-width="${px(stale ? 1.5 : 1)}" ${stale ? 'opacity="0.7"' : ""}/>`,
      );
      if (fleet.own && fleet.holding) parts.push(`<circle cx="${fx}" cy="${fy + size + px(4)}" r="${px(2)}" fill="${color(fleet.empireId)}"/>`);
    }

    parts.push(this.renderLabels(scene, starRadius));
    this.svg.innerHTML = parts.join("");
  }

  /**
   * Star names, placed greedily by importance and skipped where they would
   * overlap a name already placed. Zooming in makes room for more.
   */
  private renderLabels(scene: MapScene, starRadius: number): string {
    const s = this.scale();
    const fontSize = 12 * s;
    const { view } = scene;
    const fleetSystems = new Set(view.fleets.filter((f) => f.own).map((f) => f.position.systemId));
    const destinations = new Set(scene.preview?.route.slice(-1) ?? []);
    const priority = (id: SystemId) => {
      const system = view.systems[id]!;
      if (id === scene.selectedSystem || destinations.has(id)) return 0;
      if (system.homeOf !== null) return 1;
      if (fleetSystems.has(id)) return 2;
      if (system.explored) return 3;
      return 4;
    };
    const order = view.systems.map((sys) => sys.id).sort((a, b) => priority(a) - priority(b) || a - b);
    const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const out: string[] = [];
    for (const id of order) {
      const system = view.systems[id]!;
      const width = system.name.length * fontSize * 0.58;
      const top = system.y + starRadius + 3 * s;
      const box = { x1: system.x - width / 2, y1: top, x2: system.x + width / 2, y2: top + fontSize * 1.1 };
      const forced = priority(id) === 0;
      if (!forced && placed.some((b) => box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1)) continue;
      placed.push(box);
      const opacity = system.explored ? 1 : 0.55;
      out.push(`<text class="star-label" x="${system.x}" y="${top + fontSize * 0.9}" font-size="${fontSize}" opacity="${opacity}">${escapeXml(system.name)}</text>`);
    }
    return out.join("");
  }
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
}
