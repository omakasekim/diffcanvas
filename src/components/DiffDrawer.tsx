import { X, ArrowUpRight, ArrowDownLeft, FileCode2, ShieldAlert } from 'lucide-react';
import type { ImpactEdge, ImpactNode } from '../core/types.ts';

interface Props {
  node: ImpactNode;
  edges: ImpactEdge[];
  nodesById: Map<string, ImpactNode>;
  onSelectNode: (id: string) => void;
  onClose: () => void;
}

const IMPACT_STYLES = {
  high: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  low: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
};

export function DiffDrawer({ node, edges, nodesById, onSelectNode, onClose }: Props) {
  const incoming = edges.filter((e) => e.target === node.id);
  const outgoing = edges.filter((e) => e.source === node.id);

  return (
    <aside className="flex h-full w-full max-w-2xl flex-col border-l border-slate-800 bg-[#111827] shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${IMPACT_STYLES[node.impact]}`}>
              {node.impact} impact · {node.impactScore}/100
            </span>
            <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-slate-300">
              {node.kind}
            </span>
            <span className="font-mono text-xs text-emerald-400">+{node.additions}</span>
            <span className="font-mono text-xs text-rose-400">-{node.deletions}</span>
          </div>
          <h2 className="mt-1.5 truncate font-mono text-lg font-bold text-slate-50">{node.name}</h2>
          <p className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-xs text-slate-400">
            <FileCode2 className="h-3.5 w-3.5 shrink-0 text-sky-400" />
            <span>{node.filePath}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-slate-400 hover:border-slate-500 hover:text-slate-100"
          aria-label="Close diff drawer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        {/* Impact Rationale */}
        <section className="rounded-xl border border-slate-800 bg-[#0B0F17] p-3.5">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
            <span>Impact Radius Breakdown</span>
          </div>
          <ul className="space-y-1 text-xs text-slate-300">
            {node.impactReasons.map((reason, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>

          {(incoming.length > 0 || outgoing.length > 0) && (
            <div className="mt-3 grid gap-2 border-t border-slate-800/80 pt-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-[11px] font-medium text-slate-400">Callers / Importers ({incoming.length})</div>
                <div className="flex flex-wrap gap-1.5">
                  {incoming.length === 0 && <span className="text-[11px] text-slate-500">None in diff</span>}
                  {incoming.map((e) => {
                    const src = nodesById.get(e.source);
                    if (!src) return null;
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => onSelectNode(src.id)}
                        className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-[11px] text-sky-300 hover:border-sky-500"
                      >
                        <ArrowDownLeft className="h-3 w-3" />
                        {src.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-medium text-slate-400">Callees / Dependencies ({outgoing.length})</div>
                <div className="flex flex-wrap gap-1.5">
                  {outgoing.length === 0 && <span className="text-[11px] text-slate-500">Leaf symbol</span>}
                  {outgoing.map((e) => {
                    const dst = nodesById.get(e.target);
                    if (!dst) return null;
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => onSelectNode(dst.id)}
                        className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-[11px] text-violet-300 hover:border-violet-500"
                      >
                        <ArrowUpRight className="h-3 w-3" />
                        {dst.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Side-by-Side Semantic Diff */}
        <section className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Semantic Hunks ({node.hunks.length})
          </div>
          {node.hunks.map((h, idx) => (
            <div key={idx} className="overflow-hidden rounded-xl border border-slate-800 bg-[#0B0F17]">
              <div className="border-b border-slate-800 bg-slate-900/70 px-3 py-1.5 font-mono text-[11px] text-sky-300">
                {h.header}
              </div>
              <div className="divide-y divide-slate-800/40 font-mono text-[11.5px] leading-5">
                {h.lines.map((line, lIdx) => {
                  const rowBg =
                    line.type === 'add'
                      ? 'bg-emerald-500/10 text-emerald-200'
                      : line.type === 'del'
                        ? 'bg-rose-500/10 text-rose-200'
                        : 'text-slate-400';
                  const gutter = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
                  return (
                    <div key={lIdx} className={`grid grid-cols-[44px_44px_18px_1fr] px-2 ${rowBg}`}>
                      <span className="select-none pr-2 text-right text-[10px] text-slate-600">
                        {line.oldLine ?? ''}
                      </span>
                      <span className="select-none pr-2 text-right text-[10px] text-slate-600">
                        {line.newLine ?? ''}
                      </span>
                      <span className="select-none text-center font-bold">{gutter}</span>
                      <pre className="overflow-x-auto whitespace-pre">{line.content || ' '}</pre>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      </div>
    </aside>
  );
}
