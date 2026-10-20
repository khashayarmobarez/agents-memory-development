"use client";

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BloomGraph, BloomNode, BloomRelationship } from "@/lib/bloom";

// ---------------------------------------------------------------- palette

// The bureau palette, pushed bright enough to read against the dark chamber.
// Same families as the tokens: green = approved knowledge, red = proposals,
// blue = workspaces, amber = projects, violet = sources.
const CHAMBER_BG = "#120f0b";
const CHAMBER_GRID = "rgba(236, 229, 209, 0.06)";
const EDGE_COLOR = "rgba(176, 166, 140, 0.30)";
const EDGE_HOT = "rgba(236, 229, 209, 0.85)";
const EDGE_DIM = "rgba(176, 166, 140, 0.07)";
const TEXT_COLOR = "#ece5d1";
const TEXT_SOFT = "#b0a68c";
const RING_SELECTED = "#e06551";
const RING_MATCH = "#d9a441";

const LABEL_COLORS: Record<string, string> = {
  Decision: "#79d0a0",
  Project: "#d9a441",
  Workspace: "#7ba3d9",
  Source: "#a184d9",
  Proposal: "#e06551",
};

// Anything the archive grows later still gets a stable, deliberate color.
const FALLBACK_COLORS = ["#6ea8a0", "#c98f6f", "#8f9dc9", "#b3a15e", "#a97ba8"];

function colorFor(label: string): string {
  const known = LABEL_COLORS[label];
  if (known) return known;

  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

// ---------------------------------------------------------------- types

interface SceneNode extends SimulationNodeDatum {
  id: string;
  label: string;
  caption: string;
  properties: Record<string, string>;
  degree: number;
}

interface SceneLink extends SimulationLinkDatum<SceneNode> {
  id: string;
  type: string;
  from: string;
  to: string;
  source: string | SceneNode;
  target: string | SceneNode;
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

const LINK_DISTANCE: Record<string, number> = {
  HAS_DECISION: 90,
  CONTAINS: 150,
  SUPPORTED_BY: 62,
};

// Everything draw() reads lives in this ref, so the tick handler and the
// pointer handlers never capture stale closures.
interface ViewRef {
  transform: Transform;
  width: number;
  height: number;
  visibleIds: Set<string>;
  dimmedIds: Set<string>;
  selectedId: string | null;
  hoverId: string | null;
  focusId: string | null;
  matchIds: Set<string>;
}

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3.5;

function hashSeed(id: string): [number, number] {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const angle = ((hash % 360) / 360) * Math.PI * 2;
  const radius = 60 + (hash % 240);
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

function nodeRadius(degree: number): number {
  return 6 + Math.min(5, Math.sqrt(Math.max(degree, 1)) * 1.4);
}

// ---------------------------------------------------------------- component

export default function BloomScene({ initial }: { initial: BloomGraph }) {
  const [graph, setGraph] = useState<BloomGraph>(initial);
  const [hiddenLabels, setHiddenLabels] = useState<Set<string>>(() => new Set());
  const [hiddenNodes, setHiddenNodes] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [matchIds, setMatchIds] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const chamberRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<SceneNode, SceneLink> | null>(null);
  // The exact link objects the simulation holds — d3 resolves their endpoints
  // in place, so draw() can read them without rummaging through forces.
  const linksRef = useRef<SceneLink[]>([]);
  const positionsRef = useRef(new Map<string, { x: number; y: number }>());
  const viewRef = useRef<ViewRef>({
    transform: { x: 0, y: 0, k: 1 },
    width: 0,
    height: 0,
    visibleIds: new Set(),
    dimmedIds: new Set(),
    selectedId: null,
    hoverId: null,
    focusId: null,
    matchIds: new Set(),
  });
  const fittedRef = useRef(false);
  const tweenRef = useRef<number | null>(null);
  // A fit asked for while nodes were hidden can only run once the rebuilt
  // simulation actually contains them — the rebuild effect picks this up.
  const pendingFitRef = useRef<string[] | null>(null);

  const nodeById = useMemo(() => {
    const map = new Map<string, BloomNode>();
    for (const node of graph.nodes) map.set(node.id, node);
    return map;
  }, [graph]);

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const relationship of graph.relationships) {
      if (!map.has(relationship.from)) map.set(relationship.from, new Set());
      if (!map.has(relationship.to)) map.set(relationship.to, new Set());
      map.get(relationship.from)!.add(relationship.to);
      map.get(relationship.to)!.add(relationship.from);
    }
    return map;
  }, [graph]);

  // The set of node ids currently on the canvas. Hiding removes labels or
  // single nodes outright; focus keeps the world intact but dims the far side.
  const visibleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const node of graph.nodes) {
      if (hiddenLabels.has(node.label)) continue;
      if (hiddenNodes.has(node.id)) continue;
      ids.add(node.id);
    }
    return ids;
  }, [graph, hiddenLabels, hiddenNodes]);

  const dimmedIds = useMemo(() => {
    if (focusId === null) return new Set<string>();
    const lit = new Set<string>([focusId, ...(adjacency.get(focusId) ?? [])]);
    return new Set([...visibleIds].filter((id) => !lit.has(id)));
  }, [focusId, adjacency, visibleIds]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length === 0) return [];
    return graph.nodes.filter((node) =>
      `${node.caption} ${node.label} ${node.id} ${Object.values(node.properties).join(" ")}`
        .toLowerCase()
        .includes(q),
    );
  }, [search, graph]);

  const selectedNode = selectedId !== null ? (nodeById.get(selectedId) ?? null) : null;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const sim = simRef.current;
    const view = viewRef.current;
    if (!canvas || !sim || view.width === 0 || view.height === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { width, height } = view;
    const { x: tx, y: ty, k } = view.transform;

    const toScreen = (px: number, py: number) => ({
      x: (px + tx) * k,
      y: (py + ty) * k,
    });

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = CHAMBER_BG;
    ctx.fillRect(0, 0, width, height);

    // The chamber floor: a faint grid that scrolls with the world.
    const spacing = 44;
    const ox = ((tx * k) % spacing + spacing) % spacing;
    const oy = ((ty * k) % spacing + spacing) % spacing;
    ctx.fillStyle = CHAMBER_GRID;
    for (let gx = ox; gx < width; gx += spacing) {
      for (let gy = oy; gy < height; gy += spacing) {
        ctx.fillRect(gx, gy, 1.5, 1.5);
      }
    }

    const nodes = sim.nodes() as SceneNode[];
    const nodeAt = new Map<string, SceneNode>();
    for (const node of nodes) nodeAt.set(node.id, node);

    const focused = view.focusId !== null;
    const litNeighbors = new Set<string>();
    if (view.focusId !== null) {
      for (const other of adjacency.get(view.focusId) ?? []) litNeighbors.add(other);
    }

    const showEdgeLabel =
      k >= 0.9 || linksRef.current.length <= 24;

    // Relationships under everything, so nodes sit on top of their threads.
    const links = linksRef.current;
    for (const link of links) {
      const source = nodeAt.get(typeof link.source === "string" ? link.source : link.source.id);
      const target = nodeAt.get(typeof link.target === "string" ? link.target : link.target.id);
      if (!source || !target || !view.visibleIds.has(source.id) || !view.visibleIds.has(target.id)) {
        continue;
      }

      const hot =
        source.id === view.hoverId ||
        target.id === view.hoverId ||
        source.id === view.selectedId ||
        target.id === view.selectedId ||
        source.id === view.focusId ||
        target.id === view.focusId;

      const dim =
        focused &&
        !(
          source.id === view.focusId ||
          target.id === view.focusId ||
          (litNeighbors.has(source.id) && litNeighbors.has(target.id))
        );

      const alpha = dim ? EDGE_DIM : hot ? EDGE_HOT : EDGE_COLOR;
      if (dim && !hot) {
        ctx.strokeStyle = alpha;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(...toScreenLine(source.x!, source.y!));
        ctx.lineTo(...toScreenLine(target.x!, target.y!));
        ctx.stroke();
        continue;
      }

      const s = toScreen(source.x!, source.y!);
      const t = toScreen(target.x!, target.y!);
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;
      const ux = dx / len;
      const uy = dy / len;

      const tr = nodeRadius(target.degree) * k + 2;
      const tipX = t.x - ux * tr;
      const tipY = t.y - uy * tr;

      ctx.strokeStyle = alpha;
      ctx.lineWidth = hot ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();

      // A small chevron at the target end: direction is part of the record.
      const arrow = hot ? 7 : 5.5;
      const bx = tipX - ux * arrow;
      const by = tipY - uy * arrow;
      const px = -uy * (arrow * 0.6);
      const py = ux * (arrow * 0.6);
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(bx + px, by + py);
      ctx.lineTo(bx - px, by - py);
      ctx.closePath();
      ctx.fillStyle = alpha;
      ctx.fill();

      if ((hot || showEdgeLabel) && !dim) {
        const mx = (s.x + t.x) / 2 - uy * 9;
        const my = (s.y + t.y) / 2 + ux * 9;
        ctx.font = "500 9px 'IBM Plex Mono', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const textWidth = ctx.measureText(link.type).width + 8;
        ctx.fillStyle = "rgba(18, 15, 11, 0.9)";
        ctx.fillRect(mx - textWidth / 2, my - 8, textWidth, 13);
        ctx.fillStyle = TEXT_SOFT;
        ctx.fillText(link.type, mx, my - 0.5);
      }
    }

    // Nodes last: the record is people, threads are just how they touch.
    for (const node of nodes) {
      if (!view.visibleIds.has(node.id)) continue;

      const dimmed = view.dimmedIds.has(node.id);
      const isSelected = node.id === view.selectedId;
      const isHovered = node.id === view.hoverId;
      const isFocused = node.id === view.focusId;
      const isMatch = view.matchIds.has(node.id);
      const emphasized = isSelected || isHovered || isFocused;

      const { x, y } = toScreen(node.x!, node.y!);
      const r = (nodeRadius(node.degree) + (emphasized ? 1 : 0)) * k;

      if (x + r < 0 || x - r > width || y + r < 0 || y - r > height) {
        continue;
      }

      ctx.globalAlpha = dimmed ? 0.13 : 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = colorFor(node.label);
      ctx.fill();

      ctx.lineWidth = isSelected ? 2.2 : 1.4;
      ctx.strokeStyle = isSelected
        ? RING_SELECTED
        : isMatch
          ? RING_MATCH
          : "rgba(18, 15, 11, 0.85)";
      if (isSelected || isMatch || isHovered) ctx.stroke();
      ctx.globalAlpha = 1;

      const showCaption =
        !dimmed &&
        (k >= 0.5 || emphasized || litNeighbors.has(node.id));
      if (showCaption) {
        ctx.font = emphasized ? "600 10px 'IBM Plex Mono', monospace" : "400 10px 'IBM Plex Mono', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        let caption = node.caption || node.id;
        if (caption.length > 26) caption = `${caption.slice(0, 25)}\u2026`;
        const capWidth = ctx.measureText(caption).width;
        const capY = y + r + 5;
        if (emphasized) {
          ctx.fillStyle = "rgba(18, 15, 11, 0.92)";
          ctx.fillRect(x - capWidth / 2 - 4, capY - 1.5, capWidth + 8, 14);
        }
        ctx.fillStyle = emphasized ? TEXT_COLOR : TEXT_SOFT;
        ctx.fillText(caption, x, capY);
      }
    }
  }, [adjacency]);

  function toScreenLine(px: number, py: number): [number, number] {
    const { x, y, k } = viewRef.current.transform;
    return [(px + x) * k, (py + y) * k];
  }

  const fitTo = useCallback(
    (ids: Iterable<string>, animate = true) => {
      const sim = simRef.current;
      if (!sim) return;
      const view = viewRef.current;
      if (view.width === 0 || view.height === 0) return;

      const nodes = (sim.nodes() as SceneNode[]).filter((node) => {
        for (const id of ids) if (id === node.id) return true;
        return false;
      });
      if (nodes.length === 0) return;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const node of nodes) {
        minX = Math.min(minX, node.x!);
        minY = Math.min(minY, node.y!);
        maxX = Math.max(maxX, node.x!);
        maxY = Math.max(maxY, node.y!);
      }

      const pad = 90;
      const boundsW = maxX - minX + pad * 2;
      const boundsH = maxY - minY + pad * 2;
      const k = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, Math.min(view.width / boundsW, view.height / boundsH)),
      );
      const target: Transform = {
        k,
        x: view.width / (2 * k) - (minX + maxX) / 2,
        y: view.height / (2 * k) - (minY + maxY) / 2,
      };

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!animate || reduced || nodes.length > 200) {
        view.transform = target;
        draw();
        return;
      }

      if (tweenRef.current !== null) cancelAnimationFrame(tweenRef.current);
      const from = { ...view.transform };
      const start = performance.now();
      const duration = 320;
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const ease = 1 - Math.pow(1 - t, 3);
        view.transform = {
          x: from.x + (target.x - from.x) * ease,
          y: from.y + (target.y - from.y) * ease,
          k: from.k + (target.k - from.k) * ease,
        };
        draw();
        if (t < 1) tweenRef.current = requestAnimationFrame(step);
        else tweenRef.current = null;
      };
      tweenRef.current = requestAnimationFrame(step);
    },
    [draw],
  );

  const rebuildSimulation = useCallback(() => {
    const sim = simRef.current;
    if (sim) {
      for (const node of sim.nodes() as SceneNode[]) {
        positionsRef.current.set(node.id, { x: node.x!, y: node.y! });
      }
      sim.stop();
    }

    const degrees = new Map<string, number>();
    for (const relationship of graph.relationships) {
      degrees.set(relationship.from, (degrees.get(relationship.from) ?? 0) + 1);
      degrees.set(relationship.to, (degrees.get(relationship.to) ?? 0) + 1);
    }

    const nodes: SceneNode[] = graph.nodes
      .filter((node) => viewRef.current.visibleIds.has(node.id))
      .map((node) => {
        const remembered = positionsRef.current.get(node.id);
        const [seedX, seedY] = hashSeed(node.id);
        return {
          id: node.id,
          label: node.label,
          caption: node.caption,
          properties: node.properties,
          degree: degrees.get(node.id) ?? 0,
          x: remembered?.x ?? seedX,
          y: remembered?.y ?? seedY,
        };
      });

    const nodeIds = new Set(nodes.map((node) => node.id));
    const links: SceneLink[] = graph.relationships
      .filter((relationship) => nodeIds.has(relationship.from) && nodeIds.has(relationship.to))
      .map((relationship) => ({
        id: relationship.id,
        type: relationship.type,
        from: relationship.from,
        to: relationship.to,
        source: relationship.from,
        target: relationship.to,
        properties: relationship.properties,
      }));
    linksRef.current = links;

    const next = forceSimulation<SceneNode>(nodes)
      .force(
        "link",
        forceLink<SceneNode, SceneLink>(links)
          .id((node) => node.id)
          .distance((link) => LINK_DISTANCE[link.type] ?? 100)
          .strength(0.5),
      )
      .force("charge", forceManyBody().strength(-170).theta(0.9))
      .force("collide", forceCollide<SceneNode>().radius((node) => nodeRadius(node.degree) + 10))
      .force("center", forceCenter(0, 0))
      .force("x", forceX(0).strength(0.04))
      .force("y", forceY(0).strength(0.06))
      .alphaDecay(0.03)
      .velocityDecay(0.4)
      .on("tick", draw)
      .on("end", () => {
        if (!fittedRef.current && nodes.length > 0) {
          fittedRef.current = true;
          fitTo(viewRef.current.visibleIds);
        }
      });

    simRef.current = next;
  }, [graph, draw, fitTo]);

  // Cheap state (selection, hover, search glow) only needs a redraw.
  useEffect(() => {
    viewRef.current.selectedId = selectedId;
    viewRef.current.hoverId = hoverId;
    viewRef.current.focusId = focusId;
    viewRef.current.matchIds = matchIds;
    draw();
  });

  // The visible set changed: rebuild the simulation around the new world.
  useEffect(() => {
    viewRef.current.visibleIds = visibleIds;
    viewRef.current.dimmedIds = dimmedIds;
    rebuildSimulation();
    draw();
  }, [visibleIds, dimmedIds, rebuildSimulation, draw]);

  // Fits asked for before the target nodes were on canvas. Runs after the
  // rebuild effect in the same commit, so the simulation already has them.
  useEffect(() => {
    if (pendingFitRef.current !== null) {
      const ids = pendingFitRef.current;
      pendingFitRef.current = null;
      fitTo(ids);
    }
  });

  // The canvas follows its chamber, at device resolution.
  useEffect(() => {
    const chamber = chamberRef.current;
    const canvas = canvasRef.current;
    if (!chamber || !canvas) return;

    const resize = () => {
      const rect = chamber.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      viewRef.current.width = rect.width;
      viewRef.current.height = rect.height;
      draw();
      // The first fit can land before the chamber has real dimensions; retry.
      if (!fittedRef.current && simRef.current !== null) {
        fitTo(viewRef.current.visibleIds, false);
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(chamber);
    return () => {
      observer.disconnect();
      simRef.current?.stop();
      if (tweenRef.current !== null) cancelAnimationFrame(tweenRef.current);
    };
  }, [draw, fitTo]);

  // Zoom is a wheel concern, and it must be non-passive to eat the scroll.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const view = viewRef.current;
      const rect = canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;

      const factor = Math.exp(-event.deltaY * 0.0028);
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.transform.k * factor));
      const wx = sx / view.transform.k - view.transform.x;
      const wy = sy / view.transform.k - view.transform.y;
      view.transform.k = k;
      view.transform.x = sx / k - wx;
      view.transform.y = sy / k - wy;
      draw();
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [draw]);

  // Refit once whenever a new snapshot lands; fresh positions need a fresh frame.
  useEffect(() => {
    fittedRef.current = false;
  }, [graph]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setRefreshError(null);
    try {
      const response = await fetch("/api/memory/bloom");
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      } & Partial<BloomGraph>;
      if (!response.ok || !body.nodes || !body.relationships) {
        throw new Error(body.error ?? `${response.status} ${response.statusText}`);
      }
      setGraph({
        nodes: body.nodes,
        relationships: body.relationships,
        labelCounts: body.labelCounts ?? {},
        truncated: body.truncated ?? false,
      });
      setSelectedId(null);
      setFocusId(null);
      setMatchIds(new Set());
      setSearch("");
    } catch (cause) {
      setRefreshError(cause instanceof Error ? cause.message : "refresh failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const reheat = useCallback(() => {
    simRef.current?.alpha(0.6).restart();
  }, []);

  const showAll = useCallback(() => {
    setHiddenLabels(new Set());
    setHiddenNodes(new Set());
    setFocusId(null);
    setMatchIds(new Set());
    setSearch("");
    setSelectedId(null);
  }, []);

  const select = useCallback(
    (id: string) => {
      // Selecting a hidden record drags it back into the light.
      const node = nodeById.get(id);
      if (node) {
        const wasHidden = hiddenLabels.has(node.label) || hiddenNodes.has(id);
        setHiddenLabels((current) => {
          if (!current.has(node.label)) return current;
          const next = new Set(current);
          next.delete(node.label);
          return next;
        });
        setHiddenNodes((current) => {
          if (!current.has(id)) return current;
          const next = new Set(current);
          next.delete(id);
          return next;
        });
        if (wasHidden) pendingFitRef.current = [id];
      }
      setSelectedId(id);
    },
    [nodeById, hiddenLabels, hiddenNodes],
  );

  const focusOn = useCallback(
    (id: string) => {
      select(id);
      setFocusId((current) => {
        if (current === id) return null;
        const neighborhood = [id, ...(adjacency.get(id) ?? [])];
        requestAnimationFrame(() => fitTo(neighborhood));
        return id;
      });
    },
    [select, adjacency, fitTo],
  );

  const clearFocus = useCallback(() => {
    setFocusId(null);
    requestAnimationFrame(() => fitTo(viewRef.current.visibleIds));
  }, [fitTo]);

  // ---- pointer interaction ------------------------------------------------

  const dragRef = useRef<{
    mode: "node" | "pan";
    pointerId: number;
    originX: number;
    originY: number;
    startTransformX: number;
    startTransformY: number;
    offsetX: number;
    offsetY: number;
    node: SceneNode | null;
    moved: number;
  } | null>(null);

  const hitTest = useCallback((screenX: number, screenY: number): SceneNode | null => {
    const sim = simRef.current;
    const view = viewRef.current;
    if (!sim) return null;

    let best: SceneNode | null = null;
    let bestDistance = Infinity;
    for (const node of sim.nodes() as SceneNode[]) {
      if (!view.visibleIds.has(node.id)) continue;
      const [x, y] = toScreenLine(node.x!, node.y!);
      const r = nodeRadius(node.degree) * view.transform.k + 6;
      const distance = Math.hypot(x - screenX, y - screenY);
      if (distance < r && distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
    return best;
  }, []);

  const canvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = canvasPoint(event);
    const view = viewRef.current;
    const node = hitTest(point.x, point.y);

    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.style.cursor = "grabbing";

    if (node) {
      const sim = simRef.current;
      if (sim) {
        sim.alphaTarget(0.25).restart();
        const worldX = point.x / view.transform.k - view.transform.x;
        const worldY = point.y / view.transform.k - view.transform.y;
        node.fx = node.x;
        node.fy = node.y;
        dragRef.current = {
          mode: "node",
          pointerId: event.pointerId,
          originX: point.x,
          originY: point.y,
          startTransformX: view.transform.x,
          startTransformY: view.transform.y,
          offsetX: worldX - node.x!,
          offsetY: worldY - node.y!,
          node,
          moved: 0,
        };
      }
    } else {
      dragRef.current = {
        mode: "pan",
        pointerId: event.pointerId,
        originX: point.x,
        originY: point.y,
        startTransformX: view.transform.x,
        startTransformY: view.transform.y,
        offsetX: 0,
        offsetY: 0,
        node: null,
        moved: 0,
      };
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = canvasPoint(event);
    const drag = dragRef.current;
    const view = viewRef.current;

    if (drag && drag.pointerId === event.pointerId) {
      drag.moved = Math.hypot(point.x - drag.originX, point.y - drag.originY);

      if (drag.mode === "pan") {
        view.transform.x = drag.startTransformX + (point.x - drag.originX) / view.transform.k;
        view.transform.y = drag.startTransformY + (point.y - drag.originY) / view.transform.k;
      } else if (drag.node) {
        drag.node.fx = point.x / view.transform.k - view.transform.x + drag.offsetX;
        drag.node.fy = point.y / view.transform.k - view.transform.y + drag.offsetY;
      }
      draw();
      return;
    }

    const hovered = hitTest(point.x, point.y);
    const id = hovered?.id ?? null;
    if (id !== viewRef.current.hoverId) {
      viewRef.current.hoverId = id;
      setHoverId(id);
      event.currentTarget.style.cursor = hovered ? "pointer" : "grab";
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const wasClick = drag.moved < 6;

    if (drag.mode === "node" && drag.node) {
      drag.node.fx = null;
      drag.node.fy = null;
      simRef.current?.alphaTarget(0);
      if (wasClick) select(drag.node.id);
    }

    dragRef.current = null;
    event.currentTarget.style.cursor = "grab";
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const node = hitTest(event.clientX - rect.left, event.clientY - rect.top);
    if (node) focusOn(node.id);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      setSelectedId(null);
      setFocusId(null);
    }
  };

  const searchAndCenter = () => {
    const ids = matches.map((node) => node.id);
    setMatchIds(new Set(ids));
    if (ids.length > 0) {
      setHiddenLabels(new Set());
      setHiddenNodes(new Set());
      pendingFitRef.current = ids;
    }
  };

  const visibleCount = visibleIds.size;
  const labelCounts = graph.labelCounts;
  const allLabels = useMemo(() => {
    const set = new Set<string>();
    for (const node of graph.nodes) set.add(node.label);
    for (const label of Object.keys(labelCounts)) set.add(label);
    return [...set].sort((a, b) => (labelCounts[b] ?? 0) - (labelCounts[a] ?? 0));
  }, [graph, labelCounts]);

  const toggleLabel = (label: string) => {
    setHiddenLabels((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const selectedRelationships = useMemo(() => {
    if (selectedId === null) return [];
    return graph.relationships
      .filter((relationship) => relationship.from === selectedId || relationship.to === selectedId)
      .map((relationship) => {
        const otherId = relationship.from === selectedId ? relationship.to : relationship.from;
        const other = nodeById.get(otherId);
        return {
          relationship,
          outgoing: relationship.from === selectedId,
          other,
        };
      });
  }, [selectedId, graph, nodeById]);

  const centerOnSelected = () => {
    if (selectedId !== null) {
      requestAnimationFrame(() => fitTo([selectedId]));
    }
  };

  return (
    <div className="mt-7 flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <input
            value={search}
            onChange={(event) => {
              const q = event.target.value;
              setSearch(q);
              if (q.trim().length === 0) {
                setMatchIds(new Set());
              } else {
                const ids = new Set(
                  graph.nodes
                    .filter((node) =>
                      `${node.caption} ${node.label} ${node.id} ${Object.values(node.properties).join(" ")}`
                        .toLowerCase()
                        .includes(q.trim().toLowerCase()),
                    )
                    .map((node) => node.id),
                );
                setMatchIds(ids);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") searchAndCenter();
            }}
            placeholder="Search the record — titles, content, ids\u2026"
            aria-label="Search nodes"
            className="w-full border border-ink/25 bg-paper-raised px-3.5 py-2 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none"
          />
          {search.trim().length > 0 && (
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-ink-faint">
              {matches.length} hit{matches.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        <SceneButton onClick={searchAndCenter} disabled={matches.length === 0} title="Center the search hits">
          Locate
        </SceneButton>
        <SceneButton
          onClick={() => fitTo(viewRef.current.visibleIds)}
          title="Frame every visible node"
        >
          Fit view
        </SceneButton>
        <SceneButton onClick={reheat} title="Re-run the layout forces">
          Reheat
        </SceneButton>
        <SceneButton onClick={refresh} disabled={loading} title="Re-read the database">
          {loading ? "Reading\u2026" : "Refresh"}
        </SceneButton>
        <SceneButton
          onClick={showAll}
          title="Clear focus, filters and hidden nodes"
        >
          Show all
        </SceneButton>
      </div>

      {refreshError !== null && (
        <p
          role="alert"
          className="border-2 border-stamp-red bg-paper-raised px-4 py-2 font-mono text-xs text-stamp-red"
        >
          {refreshError}
        </p>
      )}

      {search.trim().length > 0 && matches.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {matches.slice(0, 12).map((node) => (
            <button
              key={node.id}
              type="button"
              onClick={() => select(node.id)}
              className="border border-ink/25 bg-paper-raised px-2.5 py-1 font-mono text-[10px] text-ink-soft transition-colors hover:border-ink hover:text-ink"
            >
              <span
                aria-hidden
                className="mr-1.5 inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: colorFor(node.label) }}
              />
              {node.caption || node.id}
            </button>
          ))}
          {matches.length > 12 && (
            <span className="px-1 py-1 font-mono text-[10px] text-ink-faint">
              +{matches.length - 12} more — narrow the search
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {allLabels.map((label) => {
          const hidden = hiddenLabels.has(label);
          return (
            <button
              key={label}
              type="button"
              onClick={() => toggleLabel(label)}
              aria-pressed={!hidden}
              title={`${hidden ? "Show" : "Hide"} ${label} nodes`}
              className={`flex items-center gap-1.5 border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors ${
                hidden
                  ? "border-rule bg-transparent text-ink-faint opacity-60"
                  : "border-ink/25 bg-paper-raised text-ink-soft hover:border-ink hover:text-ink"
              }`}
            >
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: hidden ? "transparent" : colorFor(label), boxShadow: hidden ? `inset 0 0 0 1px ${"var(--rule)"}` : undefined }}
              />
              {label}
              <span className={hidden ? "line-through" : ""}>{labelCounts[label] ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-stretch">
        <div
          ref={chamberRef}
          role="application"
          aria-label="Database graph — drag to pan, roll to zoom, click a node to inspect it"
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="relative h-[68vh] min-h-[440px] flex-1 overflow-hidden border-2 border-ink bg-paper-deep shadow-[8px_8px_0_0_var(--rule)] outline-none focus-visible:ring-2 focus-visible:ring-stamp-red"
        >
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onDoubleClick}
            className="absolute inset-0 h-full w-full cursor-grab touch-none"
            style={{ backgroundColor: CHAMBER_BG }}
          />

          {graph.nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
              <p className="font-display text-2xl italic text-ink-faint">
                The archive is empty.
              </p>
              <p className="font-mono text-[11px] text-ink-faint">
                Approve a memory and its Decision will bloom here.
              </p>
            </div>
          )}

          {focusId !== null && (
            <button
              type="button"
              onClick={clearFocus}
              className="absolute left-3 top-3 flex items-center gap-2 border border-ink/40 bg-paper-raised/95 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink transition-colors hover:border-ink"
            >
              Focused: {nodeById.get(focusId)?.caption ?? focusId}
              <span aria-hidden className="text-stamp-red">&times;</span>
            </button>
          )}

          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-2">
            <span className="border border-ink/40 bg-paper-raised/95 px-2.5 py-1 font-mono text-[10px] text-ink-soft">
              {visibleCount} / {graph.nodes.length} nodes
            </span>
            <span className="border border-ink/40 bg-paper-raised/95 px-2.5 py-1 font-mono text-[10px] text-ink-soft">
              {graph.relationships.length} relationships
            </span>
            {graph.truncated && (
              <span className="border border-stamp-red/60 bg-paper-raised/95 px-2.5 py-1 font-mono text-[10px] text-stamp-red">
                snapshot truncated — search to find what is off-screen
              </span>
            )}
          </div>

          <p className="pointer-events-none absolute bottom-3 right-3 hidden font-mono text-[10px] text-ink-faint/70 md:block">
            drag &middot; pan&ensp;roll &middot; zoom&ensp;click &middot; inspect&ensp;double-click &middot; focus
          </p>
        </div>

        {selectedNode !== null && (
          <Inspector
            node={selectedNode}
            relationships={selectedRelationships}
            onClose={() => setSelectedId(null)}
            onFocus={() => focusOn(selectedNode.id)}
            onHide={() => {
              setHiddenNodes((current) => new Set(current).add(selectedNode.id));
              setSelectedId(null);
            }}
            onCenter={centerOnSelected}
            onSelectOther={select}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function SceneButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="border border-ink/25 bg-paper-raised px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-soft transition-colors hover:enabled:border-ink hover:enabled:text-ink disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  );
}

function Inspector({
  node,
  relationships,
  onClose,
  onFocus,
  onHide,
  onCenter,
  onSelectOther,
}: {
  node: BloomNode;
  relationships: {
    relationship: BloomRelationship;
    outgoing: boolean;
    other: BloomNode | undefined;
  }[];
  onClose: () => void;
  onFocus: () => void;
  onHide: () => void;
  onCenter: () => void;
  onSelectOther: (id: string) => void;
}) {
  const entries = Object.entries(node.properties);

  return (
    <aside
      aria-label={`Record of ${node.caption || node.id}`}
      className="reveal flex w-full shrink-0 flex-col border border-ink/20 bg-paper-raised shadow-[6px_6px_0_0_var(--rule)] lg:w-[340px]"
    >
      <div className="border-b border-rule p-4">
        <div className="flex items-start justify-between gap-3">
          <span
            className="border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em]"
            style={{
              color: colorFor(node.label),
              borderColor: `color-mix(in srgb, ${colorFor(node.label)} 55%, transparent)`,
            }}
          >
            {node.label}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className="font-mono text-sm leading-none text-ink-faint transition-colors hover:text-stamp-red"
          >
            &times;
          </button>
        </div>

        <h2 className="mt-3 font-display text-xl font-semibold leading-snug wrap-break-word">
          {node.caption || "—"}
        </h2>

        <p className="mt-2 break-all font-mono text-[10px] leading-relaxed text-ink-faint">
          elementId: {node.id}
        </p>

        <div className="mt-3.5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onFocus}
            className="border border-ink bg-ink px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-raised transition-all hover:-translate-y-px hover:shadow-[3px_3px_0_0_var(--ink)]"
          >
            Focus
          </button>
          <button
            type="button"
            onClick={onCenter}
            className="border border-ink/30 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
          >
            Center
          </button>
          <button
            type="button"
            onClick={onHide}
            className="border border-ink/30 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
          >
            Hide
          </button>
        </div>
      </div>

      <div className="border-b border-rule p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-faint">
          Relationships ({relationships.length})
        </p>
        {relationships.length === 0 ? (
          <p className="mt-2 font-display text-sm italic text-ink-faint">
            No threads touch this record.
          </p>
        ) : (
          <ul className="mt-2.5 space-y-1.5">
            {relationships.map(({ relationship, outgoing, other }) => (
              <li key={relationship.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (other) onSelectOther(other.id);
                  }}
                  disabled={!other}
                  className="w-full border border-rule bg-paper-deep/60 px-2.5 py-1.5 text-left font-mono text-[10px] leading-relaxed text-ink-soft transition-colors hover:enabled:border-ink hover:enabled:text-ink disabled:opacity-50"
                >
                  {outgoing ? "out " : "in\u2003"}
                  <span className="text-ink-faint">[{relationship.type}]</span>
                  {"\u2192 "}
                  <span className="break-words">
                    {other ? (other.caption || other.id) : "record missing from snapshot"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-faint">
          Stored properties ({entries.length})
        </p>
        {entries.length === 0 ? (
          <p className="mt-2 font-display text-sm italic text-ink-faint">
            Bare node — nothing stored.
          </p>
        ) : (
          <dl className="mt-2.5 space-y-2.5">
            {entries.map(([key, value]) => (
              <div key={key}>
                <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                  {key}
                </dt>
                <dd className="mt-1 border-l-2 border-rule bg-paper-deep/60 px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap wrap-break-word text-ink-soft">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </aside>
  );
}
