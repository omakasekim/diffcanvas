import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  GitBranch,
  Layers,
  Pause,
  Play,
  RotateCcw,
  Search,
  Sparkles,
} from 'lucide-react';
import { buildStoryboardGraph } from './core/diffParser.ts';
import { DEMO_FEATURE_DIFF, DEMO_UNIFIED_DIFF } from './core/demoDataset.ts';
import type { ImpactLevel, ImpactNode, StoryboardGraph } from './core/types.ts';
import { DiffDrawer } from './components/DiffDrawer.tsx';

const IMPACT_BORDER: Record<ImpactLevel, string> = {
  high: 'border-rose-500/70 shadow-[0_0_24px_-6px_rgba(244,63,94,0.45)]',
  medium: 'border-amber-500/60 shadow-[0_0_20px_-6px_rgba(245,158,11,0.35)]',
  low: 'border-emerald-500/50 shadow-[0_0_16px_-6px_rgba(16,185,129,0.28)]',
};

const IMPACT_DOT: Record<ImpactLevel, string> = {
  high: 'bg-rose-400',
  medium: 'bg-amber-400',
  low: 'bg-emerald-400',
};

export function App() {
  const [graph, setGraph] = useState<StoryboardGraph>(() =>
    buildStoryboardGraph(DEMO_UNIFIED_DIFF, {
      title: 'Keyring Auth & Revocation Refactor',
      rangeLabel: 'demo:keyring-auth',
      isDemo: true,
    }),
  );
  const [rangeMode, setRangeMode] = useState<string>('auto');
  const [nodes, setNodes] = useState<ImpactNode[]>(graph.nodes);
  const [selectedId, setSelectedId] = useState<string | null>(graph.nodes[0]?.id ?? null);
  const [search, setSearch] = useState('');
  const [impactFilter, setImpactFilter] = useState<'all' | ImpactLevel>('all');
  const [tourActive, setTourActive] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);

  // Camera transform for pan & zoom
  const [cam, setCam] = useState({ x: 32, y: 24, zoom: 0.92 });
  const dragRef = useRef<{
    type: 'canvas' | 'node';
    nodeId?: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const applyGraph = useCallback((next: StoryboardGraph) => {
    setGraph(next);
    setNodes(next.nodes);
    setSelectedId(next.nodes[0]?.id ?? null);
    setTourIndex(0);
    setTourActive(false);
    setCam({ x: 32, y: 24, zoom: 0.92 });
  }, []);

  // Attempt loading live server graph when served via `npx diffcanvas`
  useEffect(() => {
    let active = true;
    fetch('/api/graph')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: StoryboardGraph | null) => {
        if (active && data && Array.isArray(data.nodes)) {
          applyGraph(data);
        }
      })
      .catch(() => {
        /* static demo fallback already active */
      });
    return () => {
      active = false;
    };
  }, [applyGraph]);

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

  const tourOrder = useMemo(
    () =>
      [...filteredNodes].sort((a, b) => {
        const rank = { high: 3, medium: 2, low: 1 };
        return rank[b.impact] - rank[a.impact] || b.impactScore - a.impactScore;
      }),
    [filteredNodes],
  );

  const focusNode = useCallback(
    (node: ImpactNode) => {
      setSelectedId(node.id);
      const box = viewportRef.current?.getBoundingClientRect();
      const vw = box?.width ?? 900;
      const vh = box?.height ?? 620;
      const targetZoom = 1.05;
      setCam({
        x: vw * 0.42 - (node.x + 125) * targetZoom,
        y: vh * 0.46 - (node.y + 48) * targetZoom,
        zoom: targetZoom,
      });
    },
    [],
  );

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
        const x1 = s.x + 125;
        const y1 = s.y + 44;
        const x2 = t.x + 125;
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
          <rect width="250" height="88" rx="12" fill="#111827" stroke="${stroke}" stroke-width="2" />
          <text x="14" y="26" fill="#f8fafc" font-family="monospace" font-size="13" font-weight="700">${n.name}</text>
          <text x="14" y="48" fill="#94a3b8" font-family="monospace" font-size="11">${n.filePath}</text>
          <text x="14" y="70" fill="${stroke}" font-family="sans-serif" font-size="11">${n.impact.toUpperCase()} (${n.impactScore}) · +${n.additions} -${n.deletions}</text>
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

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0B0F17] text-slate-100">
      {/* Top Toolbar */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-[#111827] px-4 py-2.5">
        <div className="flex items-center gap-3">
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
                    DEMO DATASET
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                {graph.stats.filesChanged} files · {graph.stats.symbolsChanged} symbols ·{' '}
                <span className="text-emerald-400">+{graph.stats.additions}</span>{' '}
                <span className="text-rose-400">-{graph.stats.deletions}</span>
              </p>
            </div>
          </div>

          <div className="hidden items-center gap-1.5 md:flex">
            <GitBranch className="h-3.5 w-3.5 text-slate-500" />
            <select
              value={rangeMode}
              onChange={(e) => handleRangeChange(e.target.value)}
              className="rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              <option value="working">Working Tree (staged + unstaged)</option>
              <option value="HEAD~1..HEAD">HEAD~1..HEAD</option>
              <option value="HEAD~3..HEAD">HEAD~3..HEAD</option>
              <option value="demo-auth">Demo: Keyring Auth Refactor</option>
              <option value="demo-batch">Demo: Worker Concurrency PR</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter symbol or file..."
              className="w-44 rounded-lg border border-slate-700 bg-[#0B0F17] py-1 pl-8 pr-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
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

          <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0B0F17] px-1.5 py-0.5">
            <button
              type="button"
              onClick={() => {
                if (tourOrder.length === 0) return;
                const prev = (tourIndex - 1 + tourOrder.length) % tourOrder.length;
                setTourIndex(prev);
                focusNode(tourOrder[prev]);
              }}
              className="rounded p-1 text-slate-400 hover:text-slate-100"
              title="Previous symbol"
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
              title="Next symbol"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setCam({ x: 32, y: 24, zoom: 0.92 })}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500"
            title="Reset camera"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={exportSvg}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1 text-xs text-slate-200 hover:border-sky-500"
          >
            <Download className="h-3.5 w-3.5 text-sky-400" />
            <span>SVG</span>
          </button>
          <button
            type="button"
            onClick={exportPng}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1 text-xs text-slate-200 hover:border-emerald-500"
          >
            <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
            <span>PNG</span>
          </button>
        </div>
      </header>

      {/* Main Spatial Canvas + Inspector Drawer */}
      <div className="relative flex flex-1 overflow-hidden">
        <div
          ref={viewportRef}
          onPointerDown={onPointerDownCanvas}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={(e) => {
            const delta = e.deltaY < 0 ? 0.08 : -0.08;
            setCam((c) => ({ ...c, zoom: Math.max(0.45, Math.min(1.8, c.zoom + delta)) }));
          }}
          className="relative flex-1 cursor-grab overflow-hidden bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:22px_22px] active:cursor-grabbing"
        >
          {/* Floating Legend */}
          <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-[#111827]/90 px-3 py-2 text-[11px] backdrop-blur">
            <span className="flex items-center gap-1.5 text-rose-300">
              <span className="h-2 w-2 rounded-full bg-rose-400" /> High Impact ({graph.stats.highImpactCount})
            </span>
            <span className="flex items-center gap-1.5 text-amber-300">
              <span className="h-2 w-2 rounded-full bg-amber-400" /> Medium ({graph.stats.mediumImpactCount})
            </span>
            <span className="flex items-center gap-1.5 text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> Low ({graph.stats.lowImpactCount})
            </span>
            <span className="text-slate-500">· Drag nodes or pan/zoom canvas</span>
          </div>

          <div
            style={{
              transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`,
              transformOrigin: '0 0',
            }}
            className="absolute inset-0"
          >
            {/* Directional Edges SVG */}
            <svg className="pointer-events-none h-[2400px] w-[2600px] overflow-visible">
              <defs>
                <marker id="arrow-call" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,1 L7,4 L0,7 Z" fill="#38bdf8" />
                </marker>
                <marker id="arrow-imp" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,1 L7,4 L0,7 Z" fill="#a78bfa" />
                </marker>
              </defs>
              {graph.edges.map((edge) => {
                if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) return null;
                const s = nodesById.get(edge.source);
                const t = nodesById.get(edge.target);
                if (!s || !t) return null;
                const x1 = s.x + 245;
                const y1 = s.y + 44;
                const x2 = t.x - 4;
                const y2 = t.y + 44;
                const dx = Math.max(50, Math.abs(x2 - x1) * 0.45);
                const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
                const highlighted = selectedId === s.id || selectedId === t.id;
                const stroke = edge.kind === 'calls' ? '#38bdf8' : '#a78bfa';
                return (
                  <g key={edge.id}>
                    <path
                      d={d}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={highlighted ? 2.5 : 1.5}
                      strokeOpacity={highlighted ? 0.95 : 0.45}
                      className="edge-flow"
                      markerEnd={edge.kind === 'calls' ? 'url(#arrow-call)' : 'url(#arrow-imp)'}
                    />
                  </g>
                );
              })}
            </svg>

            {/* Draggable Symbol Nodes */}
            {filteredNodes.map((node) => {
              const selected = selectedId === node.id;
              return (
                <div
                  key={node.id}
                  data-node-card
                  onPointerDown={(e) => onPointerDownNode(e, node)}
                  style={{ left: node.x, top: node.y, width: 250 }}
                  className={`absolute select-none rounded-xl border bg-[#111827]/95 p-3 transition-shadow ${
                    IMPACT_BORDER[node.impact]
                  } ${selected ? 'ring-2 ring-sky-400' : 'hover:border-slate-500'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      <span className={`h-2 w-2 rounded-full ${IMPACT_DOT[node.impact]}`} />
                      {node.kind}
                    </span>
                    <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                      score {node.impactScore}
                    </span>
                  </div>
                  <div className="mt-1 truncate font-mono text-sm font-bold text-slate-50">{node.name}</div>
                  <div className="truncate font-mono text-[11px] text-slate-400">{node.filePath}</div>
                  <div className="mt-2.5 flex items-center justify-between border-t border-slate-800/80 pt-2 font-mono text-[11px]">
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
