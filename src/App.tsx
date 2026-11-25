import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Download,
  FileUp,
  Focus,
  GitBranch,
  Layers,
  LayoutGrid,
  ListChecks,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { buildStoryboardGraph } from './core/diffParser.ts';
import { DEMO_FEATURE_DIFF, DEMO_POLYGLOT_DIFF, DEMO_UNIFIED_DIFF } from './core/demoDataset.ts';
import type { ImpactLevel, ImpactNode, StoryboardGraph } from './core/types.ts';
import { DiffDrawer } from './components/DiffDrawer.tsx';

type LayoutMode = 'swimlanes' | 'impact' | 'radial';

const IMPACT_BORDER: Record<ImpactLevel, string> = {
  high: 'border-rose-500/75 shadow-[0_0_28px_-6px_rgba(244,63,94,0.45)]',
  medium: 'border-amber-500/65 shadow-[0_0_22px_-6px_rgba(245,158,11,0.35)]',
  low: 'border-emerald-500/55 shadow-[0_0_18px_-6px_rgba(16,185,129,0.28)]',
};

const IMPACT_DOT: Record<ImpactLevel, string> = {
  high: 'bg-rose-400',
  medium: 'bg-amber-400',
  low: 'bg-emerald-400',
};

function computeLayout(baseNodes: ImpactNode[], mode: LayoutMode): ImpactNode[] {
  if (mode === 'swimlanes') {
    const groups = Array.from(new Set(baseNodes.map((n) => n.moduleGroup)));
    const groupIdx = new Map(groups.map((g, i) => [g, i]));
    const rows = new Map<string, number>();
    return baseNodes.map((n) => {
      const col = groupIdx.get(n.moduleGroup) ?? 0;
      const row = rows.get(n.moduleGroup) ?? 0;
      rows.set(n.moduleGroup, row + 1);
      return {
        ...n,
        x: 70 + (col % 4) * 320,
        y: 110 + row * 145 + Math.floor(col / 4) * 430,
      };
    });
  }
  if (mode === 'impact') {
    const tiers: ImpactLevel[] = ['high', 'medium', 'low'];
    const counters: Record<ImpactLevel, number> = { high: 0, medium: 0, low: 0 };
    return baseNodes.map((n) => {
      const col = tiers.indexOf(n.impact);
      const row = counters[n.impact]++;
      return {
        ...n,
        x: 80 + col * 340,
        y: 110 + row * 140,
      };
    });
  }
  // radial hub layout: highest impact near center, lower impact on outer orbits
  const sorted = [...baseNodes].sort((a, b) => b.impactScore - a.impactScore);
  const posMap = new Map<string, { x: number; y: number }>();
  const cx = 560;
  const cy = 320;
  sorted.forEach((n, idx) => {
    if (idx === 0) {
      posMap.set(n.id, { x: cx - 125, y: cy - 44 });
      return;
    }
    const ring = idx <= 4 ? 1 : 2;
    const ringItems = ring === 1 ? Math.min(4, sorted.length - 1) : Math.max(1, sorted.length - 5);
    const localIdx = ring === 1 ? idx - 1 : idx - 5;
    const angle = (localIdx / ringItems) * Math.PI * 2 - Math.PI / 2;
    const rx = ring === 1 ? 320 : 520;
    const ry = ring === 1 ? 210 : 320;
    posMap.set(n.id, {
      x: cx + Math.cos(angle) * rx - 125,
      y: cy + Math.sin(angle) * ry - 44,
    });
  });
  return baseNodes.map((n) => ({ ...n, ...(posMap.get(n.id) ?? { x: n.x, y: n.y }) }));
}

export function App() {
  const [graph, setGraph] = useState<StoryboardGraph>(() =>
    buildStoryboardGraph(DEMO_UNIFIED_DIFF, {
      title: 'Keyring Auth & Revocation Refactor',
      rangeLabel: 'demo:keyring-auth',
      isDemo: true,
    }),
  );
  const [rangeMode, setRangeMode] = useState<string>('demo-auth');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('swimlanes');
  const [nodes, setNodes] = useState<ImpactNode[]>(() => computeLayout(graph.nodes, 'swimlanes'));
  const [selectedId, setSelectedId] = useState<string | null>(graph.nodes[0]?.id ?? null);
  const [search, setSearch] = useState('');
  const [impactFilter, setImpactFilter] = useState<'all' | ImpactLevel>('all');
  const [tourActive, setTourActive] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);
  const [focusBlast, setFocusBlast] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(() => new Set());
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  const [cam, setCam] = useState({ x: 32, y: 24, zoom: 0.88 });
  const dragRef = useRef<{
    type: 'canvas' | 'node';
    nodeId?: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isLocalServer =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  const applyGraph = useCallback(
    (next: StoryboardGraph, mode: LayoutMode = layoutMode) => {
      const laid = computeLayout(next.nodes, mode);
      setGraph(next);
      setNodes(laid);
      setSelectedId(laid[0]?.id ?? null);
      setTourIndex(0);
      setTourActive(false);
      setReviewedIds(new Set());
      setCam({ x: 32, y: 24, zoom: 0.88 });
    },
    [layoutMode],
  );

  // Only poll local CLI server when running on localhost/127.0.0.1 (0 network 404s on GitHub Pages)
  useEffect(() => {
    if (!isLocalServer) return;
    let active = true;
    fetch('/api/graph')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: StoryboardGraph | null) => {
        if (active && data && Array.isArray(data.nodes)) {
          setRangeMode('working');
          applyGraph(data, 'swimlanes');
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isLocalServer]);

  const handleLayoutChange = (mode: LayoutMode) => {
    setLayoutMode(mode);
    setNodes((prev) => computeLayout(prev, mode));
  };

  const fitToView = useCallback(() => {
    const box = viewportRef.current?.getBoundingClientRect();
    if (!box || nodes.length === 0) {
      setCam({ x: 32, y: 24, zoom: 0.88 });
      return;
    }
    const minX = Math.min(...nodes.map((n) => n.x)) - 40;
    const minY = Math.min(...nodes.map((n) => n.y)) - 60;
    const maxX = Math.max(...nodes.map((n) => n.x + 260)) + 40;
    const maxY = Math.max(...nodes.map((n) => n.y + 110)) + 40;
    const w = Math.max(200, maxX - minX);
    const h = Math.max(200, maxY - minY);
    const zoom = Math.max(0.45, Math.min(1.12, Math.min(box.width / w, box.height / h) * 0.9));
    setCam({
      x: (box.width - w * zoom) / 2 - minX * zoom,
      y: (box.height - h * zoom) / 2 - minY * zoom,
      zoom,
    });
  }, [nodes]);

  const loadRawDiffText = (raw: string, label: string) => {
    const built = buildStoryboardGraph(raw, {
      title: `Custom Diff: ${label}`,
      rangeLabel: label,
      isDemo: false,
    });
    if (built.nodes.length > 0) {
      setRangeMode('custom');
      applyGraph(built, layoutMode);
    }
  };

  const handleRangeChange = async (mode: string) => {
    setRangeMode(mode);
    if (mode === 'demo-auth') {
      applyGraph(
        buildStoryboardGraph(DEMO_UNIFIED_DIFF, {
          title: 'Keyring Auth & Revocation Refactor',
          rangeLabel: 'demo:keyring-auth',
          isDemo: true,
        }),
      );
      return;
    }
    if (mode === 'demo-batch') {
      applyGraph(
        buildStoryboardGraph(DEMO_FEATURE_DIFF, {
          title: 'Worker Concurrency Refactor',
          rangeLabel: 'demo:worker-pool',
          isDemo: true,
        }),
      );
      return;
    }
    if (mode === 'demo-polyglot') {
      applyGraph(
        buildStoryboardGraph(DEMO_POLYGLOT_DIFF, {
          title: 'Rust Scheduler + Python/TS Bridge',
          rangeLabel: 'demo:polyglot-engine',
          isDemo: true,
        }),
      );
      return;
    }
    if (!isLocalServer) return;
    try {
      const r = await fetch(`/api/graph?range=${encodeURIComponent(mode)}`);
      if (r.ok) {
        const data = (await r.json()) as StoryboardGraph;
        applyGraph(data);
      }
    } catch {
      /* ignore */
    }
  };

  const filteredNodes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return nodes.filter((n) => {
      if (impactFilter !== 'all' && n.impact !== impactFilter) return false;
      if (!q) return true;
      return (
        n.name.toLowerCase().includes(q) ||
        n.filePath.toLowerCase().includes(q) ||
        n.moduleGroup.toLowerCase().includes(q)
      );
    });
  }, [nodes, search, impactFilter]);

  const visibleIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selectedNode = selectedId ? nodesById.get(selectedId) ?? null : null;

  // Connected blast-radius neighborhood of selected node
  const connectedIds = useMemo(() => {
    const set = new Set<string>();
    if (!selectedId) return set;
    set.add(selectedId);
    for (const e of graph.edges) {
      if (e.source === selectedId) set.add(e.target);
      if (e.target === selectedId) set.add(e.source);
    }
    return set;
  }, [selectedId, graph.edges]);

  // Swimlane group boxes (only when in swimlanes layout)
  const swimlanes = useMemo(() => {
    if (layoutMode !== 'swimlanes') return [];
    const byGroup = new Map<string, ImpactNode[]>();
    for (const n of filteredNodes) {
      const arr = byGroup.get(n.moduleGroup) ?? [];
      arr.push(n);
      byGroup.set(n.moduleGroup, arr);
    }
    return Array.from(byGroup.entries()).map(([group, list]) => {
      const minX = Math.min(...list.map((n) => n.x)) - 18;
      const minY = Math.min(...list.map((n) => n.y)) - 38;
      const maxX = Math.max(...list.map((n) => n.x + 250)) + 18;
      const maxY = Math.max(...list.map((n) => n.y + 104)) + 18;
      return { group, x: minX, y: minY, w: maxX - minX, h: maxY - minY, count: list.length };
    });
  }, [filteredNodes, layoutMode]);

  const tourOrder = useMemo(
    () =>
      [...filteredNodes].sort((a, b) => {
        const rank = { high: 3, medium: 2, low: 1 };
        return rank[b.impact] - rank[a.impact] || b.impactScore - a.impactScore;
      }),
    [filteredNodes],
  );

  const focusNode = useCallback((node: ImpactNode) => {
    setSelectedId(node.id);
    const box = viewportRef.current?.getBoundingClientRect();
    const vw = box?.width ?? 900;
    const vh = box?.height ?? 620;
    const targetZoom = 1.02;
    setCam({
      x: vw * 0.42 - (node.x + 125) * targetZoom,
      y: vh * 0.46 - (node.y + 48) * targetZoom,
      zoom: targetZoom,
    });
  }, []);

  useEffect(() => {
    if (!tourActive || tourOrder.length === 0) return;
    const clamped = tourIndex % tourOrder.length;
    focusNode(tourOrder[clamped]);
    const timer = setInterval(() => {
      setTourIndex((prev) => {
        const nextIdx = (prev + 1) % tourOrder.length;
        focusNode(tourOrder[nextIdx]);
        return nextIdx;
      });
    }, 3200);
    return () => clearInterval(timer);
  }, [tourActive, tourIndex, tourOrder, focusNode]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'f' || e.key === 'F') {
        fitToView();
      } else if (e.key === 'ArrowRight' && tourOrder.length > 0) {
        const next = (tourIndex + 1) % tourOrder.length;
        setTourIndex(next);
        focusNode(tourOrder[next]);
      } else if (e.key === 'ArrowLeft' && tourOrder.length > 0) {
        const prev = (tourIndex - 1 + tourOrder.length) % tourOrder.length;
        setTourIndex(prev);
        focusNode(tourOrder[prev]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitToView, tourOrder, tourIndex, focusNode]);

  const onPointerDownCanvas = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-node-card]')) return;
    dragRef.current = {
      type: 'canvas',
      startX: e.clientX,
      startY: e.clientY,
      origX: cam.x,
      origY: cam.y,
    };
  };

  const onPointerDownNode = (e: React.PointerEvent, node: ImpactNode) => {
    e.stopPropagation();
    setSelectedId(node.id);
    dragRef.current = {
      type: 'node',
      nodeId: node.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: node.x,
      origY: node.y,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.type === 'canvas') {
      setCam((c) => ({ ...c, x: d.origX + dx, y: d.origY + dy }));
    } else if (d.nodeId) {
      setNodes((prev) =>
        prev.map((n) => (n.id === d.nodeId ? { ...n, x: d.origX + dx / cam.zoom, y: d.origY + dy / cam.zoom } : n)),
      );
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const buildSvgExport = () => {
    const pad = 80;
    const maxX = Math.max(1000, ...nodes.map((n) => n.x + 280)) + pad;
    const maxY = Math.max(680, ...nodes.map((n) => n.y + 140)) + pad;
    const edgePaths = graph.edges
      .map((edge) => {
        const s = nodesById.get(edge.source);
        const t = nodesById.get(edge.target);
        if (!s || !t) return '';
        const x1 = s.x + 250;
        const y1 = s.y + 44;
        const x2 = t.x;
        const y2 = t.y + 44;
        const cx = (x1 + x2) / 2;
        const color = edge.kind === 'calls' ? '#38bdf8' : '#a78bfa';
        return `<path d="M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="2" stroke-opacity="0.7" />`;
      })
      .join('\n');

    const nodeBoxes = nodes
      .map((n) => {
        const stroke = n.impact === 'high' ? '#f43f5e' : n.impact === 'medium' ? '#f59e0b' : '#10b981';
        return `<g transform="translate(${n.x},${n.y})">
          <rect width="250" height="96" rx="12" fill="#111827" stroke="${stroke}" stroke-width="2" />
          <text x="14" y="26" fill="#f8fafc" font-family="monospace" font-size="13" font-weight="700">${n.name}</text>
          <text x="14" y="48" fill="#94a3b8" font-family="monospace" font-size="11">${n.filePath}</text>
          <text x="14" y="72" fill="${stroke}" font-family="sans-serif" font-size="11">${n.impact.toUpperCase()} (${n.impactScore}) · +${n.additions} -${n.deletions}</text>
        </g>`;
      })
      .join('\n');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${maxX}" height="${maxY}" viewBox="0 0 ${maxX} ${maxY}">
      <rect width="100%" height="100%" fill="#0B0F17" />
      ${edgePaths}
      ${nodeBoxes}
    </svg>`;
  };

  const exportSvg = () => {
    const svg = buildSvgExport();
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `diffcanvas-${graph.rangeLabel.replace(/[^a-z0-9-_]/gi, '_')}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  const exportPng = () => {
    const svg = buildSvgExport();
    const img = new Image();
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((png) => {
          if (!png) return;
          const a = document.createElement('a');
          a.href = URL.createObjectURL(png);
          a.download = `diffcanvas-${graph.rangeLabel.replace(/[^a-z0-9-_]/gi, '_')}.png`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        });
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  // Minimap coordinate bounds
  const minimapBounds = useMemo(() => {
    if (nodes.length === 0) return { minX: 0, minY: 0, w: 1200, h: 700 };
    const minX = Math.min(0, ...nodes.map((n) => n.x)) - 40;
    const minY = Math.min(0, ...nodes.map((n) => n.y)) - 40;
    const maxX = Math.max(1100, ...nodes.map((n) => n.x + 260)) + 40;
    const maxY = Math.max(660, ...nodes.map((n) => n.y + 110)) + 40;
    return { minX, minY, w: maxX - minX, h: maxY - minY };
  }, [nodes]);

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-[#0B0F17] text-slate-100"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) loadRawDiffText(await f.text(), f.name);
      }}
    >
      {/* Top Toolbar */}
      <header className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-800 bg-[#111827] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-sky-500/40 bg-sky-500/15 text-sky-400">
              <Layers className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-tight text-slate-50">diffcanvas</h1>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-sky-300">
                  {graph.rangeLabel}
                </span>
                {graph.isDemo && (
                  <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">
                    INTERACTIVE DEMO
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                {graph.stats.filesChanged} files · {graph.stats.symbolsChanged} symbols ·{' '}
                <span className="text-emerald-400">+{graph.stats.additions}</span>{' '}
                <span className="text-rose-400">-{graph.stats.deletions}</span> · {graph.edges.length} links
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <GitBranch className="h-3.5 w-3.5 text-slate-500" />
            <select
              value={rangeMode}
              onChange={(e) => handleRangeChange(e.target.value)}
              className="rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              {isLocalServer && <option value="working">Working Tree (staged + unstaged)</option>}
              {isLocalServer && <option value="HEAD~1..HEAD">HEAD~1..HEAD</option>}
              {isLocalServer && <option value="HEAD~3..HEAD">HEAD~3..HEAD</option>}
              <option value="demo-auth">Preset: Keyring Auth Refactor (TS)</option>
              <option value="demo-batch">Preset: Worker Concurrency PR (TS)</option>
              <option value="demo-polyglot">Preset: Rust + Python + TS Engine</option>
              {rangeMode === 'custom' && <option value="custom">Custom Uploaded / Pasted Diff</option>}
            </select>
          </div>

          <button
            type="button"
            onClick={() => setPasteOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-200 hover:bg-sky-500/20"
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
            <span>Paste Diff</span>
          </button>

          <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1 text-xs text-slate-200 hover:border-sky-500">
            <FileUp className="h-3.5 w-3.5 text-sky-400" />
            <span>.patch</span>
            <input
              type="file"
              accept=".diff,.patch,.txt"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) loadRawDiffText(await f.text(), f.name);
              }}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter symbol (/)..."
              className="w-40 rounded-lg border border-slate-700 bg-[#0B0F17] py-1 pl-8 pr-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center rounded-lg border border-slate-800 bg-[#0B0F17] p-0.5 text-[11px]">
            {(['all', 'high', 'medium', 'low'] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => setImpactFilter(tier)}
                className={`rounded-md px-2 py-1 capitalize transition ${
                  impactFilter === tier
                    ? 'bg-slate-800 font-semibold text-slate-50'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tier}
              </button>
            ))}
          </div>

          {/* Layout Mode */}
          <div className="flex items-center rounded-lg border border-slate-800 bg-[#0B0F17] p-0.5 text-[11px]">
            {(
              [
                { id: 'swimlanes', label: 'Lanes' },
                { id: 'impact', label: 'Tiers' },
                { id: 'radial', label: 'Radial' },
              ] as const
            ).map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => handleLayoutChange(l.id)}
                className={`rounded-md px-2 py-1 transition ${
                  layoutMode === l.id ? 'bg-sky-500/20 font-semibold text-sky-200' : 'text-slate-400 hover:text-slate-200'
                }`}
                title={`Switch to ${l.label} auto-layout`}
              >
                {l.label}
              </button>
            ))}
          </div>

          {/* Tour Controls */}
          <div className="flex items-center gap-0.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-1 py-0.5">
            <button
              type="button"
              onClick={() => {
                if (tourOrder.length === 0) return;
                const prev = (tourIndex - 1 + tourOrder.length) % tourOrder.length;
                setTourIndex(prev);
                focusNode(tourOrder[prev]);
              }}
              className="rounded p-1 text-slate-400 hover:text-slate-100"
              title="Previous symbol (←)"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setTourActive((v) => !v)}
              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${
                tourActive ? 'bg-sky-500/20 text-sky-300' : 'text-slate-200 hover:bg-slate-800'
              }`}
            >
              {tourActive ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              <span>Tour {tourOrder.length > 0 ? `${(tourIndex % tourOrder.length) + 1}/${tourOrder.length}` : ''}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (tourOrder.length === 0) return;
                const next = (tourIndex + 1) % tourOrder.length;
                setTourIndex(next);
                focusNode(tourOrder[next]);
              }}
              className="rounded p-1 text-slate-400 hover:text-slate-100"
              title="Next symbol (→)"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setFocusBlast((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${
              focusBlast
                ? 'border-rose-500/60 bg-rose-500/15 text-rose-200'
                : 'border-slate-700 bg-[#0B0F17] text-slate-300 hover:border-slate-500'
            }`}
            title="Isolate selected symbol's blast neighborhood"
          >
            <Focus className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Isolate</span>
          </button>

          <button
            type="button"
            onClick={() => setShowChecklist((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${
              showChecklist
                ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200'
                : 'border-slate-700 bg-[#0B0F17] text-slate-300 hover:border-slate-500'
            }`}
            title="Toggle PR Review Priority Queue"
          >
            <ListChecks className="h-3.5 w-3.5" />
            <span className="font-mono text-[11px]">{reviewedIds.size}/{nodes.length}</span>
          </button>

          <button
            type="button"
            onClick={fitToView}
            className="inline-flex items-center rounded-lg border border-slate-700 bg-[#0B0F17] p-1.5 text-slate-300 hover:border-slate-500"
            title="Fit all nodes to view (F)"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={exportSvg}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0B0F17] px-2 py-1 text-xs text-slate-200 hover:border-sky-500"
          >
            <Download className="h-3.5 w-3.5 text-sky-400" />
            <span>SVG</span>
          </button>
          <button
            type="button"
            onClick={exportPng}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0B0F17] px-2 py-1 text-xs text-slate-200 hover:border-emerald-500"
          >
            <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
            <span>PNG</span>
          </button>
        </div>
      </header>

      {/* Paste Unified Diff Drawer */}
      {pasteOpen && (
        <div className="border-b border-slate-800 bg-[#0F172A] px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-semibold text-sky-300">
              Paste raw `git diff` output (runs 100% locally in your browser)
            </span>
            <button type="button" onClick={() => setPasteOpen(false)} className="text-slate-400 hover:text-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="diff --git a/src/foo.ts b/src/foo.ts&#10;--- a/src/foo.ts&#10;+++ b/src/foo.ts&#10;@@ -1,4 +1,6 @@..."
            className="h-28 w-full rounded-lg border border-slate-700 bg-[#0B0F17] p-2.5 font-mono text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-slate-400">Tip: run `git diff HEAD~2..HEAD | pbcopy` and paste here, or drag-and-drop a `.patch` file.</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPasteText(DEMO_POLYGLOT_DIFF)}
                className="rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500"
              >
                Load Sample Diff
              </button>
              <button
                type="button"
                onClick={() => {
                  if (pasteText.trim()) {
                    loadRawDiffText(pasteText, 'pasted-diff');
                    setPasteOpen(false);
                  }
                }}
                className="rounded bg-sky-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-sky-400"
              >
                Render Storyboard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Spatial Canvas + Optional Checklist + Inspector Drawer */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* PR Review Priority Checklist Sidebar */}
        {showChecklist && (
          <aside className="flex w-72 flex-col border-r border-slate-800 bg-[#111827]">
            <div className="flex items-center justify-between border-b border-slate-800 px-3.5 py-2.5">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-200">
                <LayoutGrid className="h-3.5 w-3.5 text-emerald-400" />
                <span>PR Review Order</span>
              </div>
              <span className="font-mono text-[11px] text-emerald-400">
                {Math.round((reviewedIds.size / Math.max(1, nodes.length)) * 100)}%
              </span>
            </div>
            <div className="h-1 w-full bg-slate-800">
              <div
                className="h-full bg-emerald-400 transition-all"
                style={{ width: `${(reviewedIds.size / Math.max(1, nodes.length)) * 100}%` }}
              />
            </div>
            <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
              {tourOrder.map((n, idx) => {
                const done = reviewedIds.has(n.id);
                const active = selectedId === n.id;
                return (
                  <div
                    key={n.id}
                    className={`flex items-start gap-2 rounded-lg border p-2 text-xs transition ${
                      active ? 'border-sky-500/60 bg-sky-500/10' : 'border-slate-800 bg-[#0B0F17] hover:border-slate-600'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setReviewedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(n.id)) next.delete(n.id);
                          else next.add(n.id);
                          return next;
                        });
                      }}
                      className={`mt-0.5 shrink-0 ${done ? 'text-emerald-400' : 'text-slate-600 hover:text-slate-300'}`}
                      title="Mark symbol reviewed"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => focusNode(n)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-center justify-between gap-1">
                        <span className={`truncate font-mono font-semibold ${done ? 'line-through text-slate-500' : 'text-slate-100'}`}>
                          {idx + 1}. {n.name}
                        </span>
                        <span className={`h-2 w-2 shrink-0 rounded-full ${IMPACT_DOT[n.impact]}`} />
                      </div>
                      <div className="truncate font-mono text-[10px] text-slate-400">{n.filePath}</div>
                    </button>
                  </div>
                );
              })}
            </div>
          </aside>
        )}

        <div
          ref={viewportRef}
          onPointerDown={onPointerDownCanvas}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={(e) => {
            const delta = e.deltaY < 0 ? 0.08 : -0.08;
            setCam((c) => ({ ...c, zoom: Math.max(0.42, Math.min(1.85, c.zoom + delta)) }));
          }}
          className={`relative flex-1 cursor-grab overflow-hidden bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:22px_22px] active:cursor-grabbing ${
            dragOver ? 'ring-2 ring-inset ring-sky-400' : ''
          }`}
        >
          {/* Drop Overlay */}
          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-sky-950/60 backdrop-blur-sm">
              <div className="rounded-2xl border-2 border-dashed border-sky-400 bg-[#0B0F17]/90 px-8 py-6 text-center">
                <FileUp className="mx-auto mb-2 h-8 w-8 text-sky-400" />
                <div className="text-sm font-bold text-slate-100">Drop `.diff` or `.patch` file to map PR graph</div>
              </div>
            </div>
          )}

          {/* Floating Legend & Impact Bar */}
          <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-[#111827]/90 px-3 py-2 text-[11px] backdrop-blur">
            <span className="flex items-center gap-1.5 text-rose-300">
              <span className="h-2 w-2 rounded-full bg-rose-400" /> High ({graph.stats.highImpactCount})
            </span>
            <span className="flex items-center gap-1.5 text-amber-300">
              <span className="h-2 w-2 rounded-full bg-amber-400" /> Medium ({graph.stats.mediumImpactCount})
            </span>
            <span className="flex items-center gap-1.5 text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> Low ({graph.stats.lowImpactCount})
            </span>
            <span className="h-3 w-px bg-slate-700" />
            <span className="flex items-center gap-1.5 text-sky-300">
              <span className="h-0.5 w-3 bg-sky-400" /> calls
            </span>
            <span className="flex items-center gap-1.5 text-violet-300">
              <span className="h-0.5 w-3 bg-violet-400" /> imports
            </span>
            <span className="hidden text-slate-500 sm:inline">· Keys: ←/→ tour · F fit · / search</span>
          </div>

          <div
            style={{
              transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`,
              transformOrigin: '0 0',
            }}
            className="absolute inset-0"
          >
            {/* Module Swimlane Backdrops */}
            {swimlanes.map((lane) => (
              <div
                key={lane.group}
                style={{ left: lane.x, top: lane.y, width: lane.w, height: lane.h }}
                className="pointer-events-none absolute rounded-2xl border border-slate-800/80 bg-slate-900/25"
              >
                <div className="flex items-center justify-between px-3.5 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <span>{lane.group}</span>
                  <span className="rounded bg-slate-800/80 px-1.5 py-0.5 text-[9px] text-slate-300">{lane.count}</span>
                </div>
              </div>
            ))}

            {/* Directional Edges SVG with Animated Signal Pulses */}
            <svg className="pointer-events-none h-[2400px] w-[2600px] overflow-visible">
              <defs>
                <marker id="arrow-call" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,1 L7,4 L0,7 Z" fill="#38bdf8" />
                </marker>
                <marker id="arrow-imp" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,1 L7,4 L0,7 Z" fill="#a78bfa" />
                </marker>
                <filter id="glow-edge">
                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              {graph.edges.map((edge) => {
                if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) return null;
                const s = nodesById.get(edge.source);
                const t = nodesById.get(edge.target);
                if (!s || !t) return null;
                const x1 = s.x + 250;
                const y1 = s.y + 48;
                const x2 = t.x - 4;
                const y2 = t.y + 48;
                const dx = Math.max(55, Math.abs(x2 - x1) * 0.45);
                const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
                const highlighted = selectedId === s.id || selectedId === t.id || hoveredEdgeId === edge.id;
                const dimmed = focusBlast && selectedId && !highlighted;
                const stroke = edge.kind === 'calls' ? '#38bdf8' : '#a78bfa';
                const mx = (x1 + x2) / 2;
                const my = (y1 + y2) / 2;
                return (
                  <g
                    key={edge.id}
                    className="pointer-events-auto"
                    onMouseEnter={() => setHoveredEdgeId(edge.id)}
                    onMouseLeave={() => setHoveredEdgeId(null)}
                  >
                    <path
                      d={d}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={highlighted ? 2.6 : 1.5}
                      strokeOpacity={dimmed ? 0.1 : highlighted ? 0.95 : 0.42}
                      className="edge-flow"
                      filter={highlighted ? 'url(#glow-edge)' : undefined}
                      markerEnd={edge.kind === 'calls' ? 'url(#arrow-call)' : 'url(#arrow-imp)'}
                    />
                    {highlighted && (
                      <circle r="3.5" fill={stroke} filter="url(#glow-edge)">
                        <animateMotion dur="2.1s" repeatCount="indefinite" path={d} />
                      </circle>
                    )}
                    {hoveredEdgeId === edge.id && (
                      <g transform={`translate(${mx},${my - 10})`}>
                        <rect x="-58" y="-10" width="116" height="20" rx="5" fill="#0B0F17" stroke={stroke} strokeWidth="1" />
                        <text textAnchor="middle" y="4" fill="#e2e8f0" fontFamily="monospace" fontSize="10">
                          {edge.label.slice(0, 18)}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>

            {/* Draggable Symbol Nodes */}
            {filteredNodes.map((node) => {
              const selected = selectedId === node.id;
              const reviewed = reviewedIds.has(node.id);
              const dimmed = focusBlast && selectedId && !connectedIds.has(node.id);
              const totalChurn = Math.max(1, node.additions + node.deletions);
              const addPct = Math.round((node.additions / totalChurn) * 100);
              return (
                <div
                  key={node.id}
                  data-node-card
                  onPointerDown={(e) => onPointerDownNode(e, node)}
                  style={{ left: node.x, top: node.y, width: 250 }}
                  className={`absolute select-none rounded-xl border bg-[#111827]/95 p-3 transition-all ${
                    IMPACT_BORDER[node.impact]
                  } ${selected ? 'ring-2 ring-sky-400 scale-[1.02]' : 'hover:border-slate-500'} ${
                    dimmed ? 'opacity-20' : 'opacity-100'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      <span className={`h-2 w-2 rounded-full ${IMPACT_DOT[node.impact]}`} />
                      {node.kind}
                      {reviewed && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
                    </span>
                    <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                      risk {node.impactScore}
                    </span>
                  </div>
                  <div className="mt-1 truncate font-mono text-sm font-bold text-slate-50">{node.name}</div>
                  <div className="truncate font-mono text-[11px] text-slate-400">{node.filePath}</div>

                  {/* Mini visual churn bar */}
                  <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div className="bg-emerald-400" style={{ width: `${addPct}%` }} />
                    <div className="bg-rose-400" style={{ width: `${100 - addPct}%` }} />
                  </div>

                  <div className="mt-2 flex items-center justify-between font-mono text-[11px]">
                    <div className="flex gap-2">
                      <span className="text-emerald-400">+{node.additions}</span>
                      <span className="text-rose-400">-{node.deletions}</span>
                    </div>
                    <span className="text-slate-400">
                      in:{node.fanIn} out:{node.fanOut}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Interactive Bottom-Left Minimap */}
          <div className="absolute bottom-4 left-4 z-10 hidden overflow-hidden rounded-xl border border-slate-700/80 bg-[#0B0F17]/90 p-2 shadow-xl backdrop-blur sm:block">
            <div className="mb-1 flex items-center justify-between text-[9px] font-semibold uppercase tracking-wider text-slate-400">
              <span>Minimap</span>
              <span className="font-mono text-slate-500">{Math.round(cam.zoom * 100)}%</span>
            </div>
            <svg
              width={168}
              height={96}
              viewBox={`${minimapBounds.minX} ${minimapBounds.minY} ${minimapBounds.w} ${minimapBounds.h}`}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const wx = minimapBounds.minX + ((e.clientX - r.left) / r.width) * minimapBounds.w;
                const wy = minimapBounds.minY + ((e.clientY - r.top) / r.height) * minimapBounds.h;
                const box = viewportRef.current?.getBoundingClientRect();
                setCam((c) => ({
                  ...c,
                  x: (box?.width ?? 900) / 2 - wx * c.zoom,
                  y: (box?.height ?? 600) / 2 - wy * c.zoom,
                }));
              }}
              className="cursor-pointer rounded bg-[#111827]"
            >
              {graph.edges.map((e) => {
                const s = nodesById.get(e.source);
                const t = nodesById.get(e.target);
                if (!s || !t) return null;
                return (
                  <line
                    key={e.id}
                    x1={s.x + 125}
                    y1={s.y + 44}
                    x2={t.x + 125}
                    y2={t.y + 44}
                    stroke="#334155"
                    strokeWidth={8}
                  />
                );
              })}
              {nodes.map((n) => (
                <rect
                  key={n.id}
                  x={n.x}
                  y={n.y}
                  width={250}
                  height={94}
                  rx={16}
                  fill={n.impact === 'high' ? '#f43f5e' : n.impact === 'medium' ? '#f59e0b' : '#10b981'}
                  fillOpacity={selectedId === n.id ? 1 : 0.65}
                  stroke={selectedId === n.id ? '#ffffff' : 'none'}
                  strokeWidth={18}
                />
              ))}
            </svg>
          </div>

          <button
            type="button"
            onClick={() => setCam({ x: 32, y: 24, zoom: 0.88 })}
            className="absolute bottom-4 right-4 z-10 inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#111827]/90 px-2.5 py-1.5 text-[11px] text-slate-300 backdrop-blur hover:border-sky-500"
          >
            <RotateCcw className="h-3 w-3" /> Reset Camera
          </button>
        </div>

        {selectedNode && (
          <DiffDrawer
            node={selectedNode}
            edges={graph.edges}
            nodesById={nodesById}
            onSelectNode={(id) => {
              const target = nodesById.get(id);
              if (target) focusNode(target);
            }}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
}

export default App;
