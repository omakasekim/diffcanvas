import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Columns2,
  FileCode2,
  MessageSquarePlus,
  ShieldAlert,
  X,
} from 'lucide-react';
import type { DiffLine, ImpactEdge, ImpactNode } from '../core/types.ts';

interface Props {
  node: ImpactNode;
  edges: ImpactEdge[];
  nodesById: Map<string, ImpactNode>;
  note: string;
  onUpdateNote: (nodeId: string, note: string) => void;
  onSelectNode: (id: string) => void;
  onClose: () => void;
}

const IMPACT_STYLES = {
  high: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  low: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
};

const KW_RE = /\b(export|import|from|async|await|function|const|let|return|if|else|throw|new|class|interface|type|pub|fn|def|use)\b/g;

function highlightCode(text: string) {
  if (!text) return ' ';
  const parts = text.split(KW_RE);
  return parts.map((p, idx) =>
    idx % 2 === 1 ? (
      <span key={idx} className="font-semibold text-sky-300">
        {p}
      </span>
    ) : (
      <span key={idx}>{p}</span>
    ),
  );
}

function pairSplitLines(lines: DiffLine[]) {
  const rows: Array<{
    oldLn: number | null;
    oldText: string;
    oldType: 'del' | 'context' | 'empty';
    newLn: number | null;
    newText: string;
    newType: 'add' | 'context' | 'empty';
  }> = [];
  for (const l of lines) {
    if (l.type === 'context') {
      rows.push({ oldLn: l.oldLine, oldText: l.content, oldType: 'context', newLn: l.newLine, newText: l.content, newType: 'context' });
    } else if (l.type === 'del') {
      rows.push({ oldLn: l.oldLine, oldText: l.content, oldType: 'del', newLn: null, newText: '', newType: 'empty' });
    } else {
      const last = rows[rows.length - 1];
      if (last && last.oldType === 'del' && last.newType === 'empty') {
        last.newLn = l.newLine;
        last.newText = l.content;
        last.newType = 'add';
      } else {
        rows.push({ oldLn: null, oldText: '', oldType: 'empty', newLn: l.newLine, newText: l.content, newType: 'add' });
      }
    }
  }
  return rows;
}

export function DiffDrawer({ node, edges, nodesById, note, onUpdateNote, onSelectNode, onClose }: Props) {
  const [diffView, setDiffView] = useState<'unified' | 'split'>('unified');
  const incoming = edges.filter((e) => e.target === node.id);
  const outgoing = edges.filter((e) => e.source === node.id);

  const splitHunks = useMemo(
    () => node.hunks.map((h) => ({ header: h.header, rows: pairSplitLines(h.lines) })),
    [node.hunks],
  );

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
        <section className="rounded-xl border border-slate-800 bg-[#090D16] p-3.5">
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

        {/* Inline Reviewer Note (included in Markdown PR export) */}
        <section className="rounded-xl border border-slate-800 bg-[#090D16] p-3.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <MessageSquarePlus className="h-3.5 w-3.5 text-emerald-400" />
            <span>Inline Review Note (exported with `.md`)</span>
          </div>
          <textarea
            value={note}
            onChange={(e) => onUpdateNote(node.id, e.target.value)}
            placeholder={`Add review comment or follow-up question for ${node.name}...`}
            className="h-16 w-full resize-none rounded-lg border border-slate-800 bg-[#111827] p-2 text-xs text-slate-200 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
          />
        </section>

        {/* Semantic Diff (Unified / Split) */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Semantic Hunks ({node.hunks.length})
            </span>
            <button
              type="button"
              onClick={() => setDiffView((v) => (v === 'unified' ? 'split' : 'unified'))}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-[#090D16] px-2 py-0.5 text-[11px] text-sky-300 hover:border-sky-500"
            >
              <Columns2 className="h-3 w-3" />
              <span>{diffView === 'unified' ? 'Split View' : 'Unified View'}</span>
            </button>
          </div>

          {diffView === 'unified'
            ? node.hunks.map((h, idx) => (
                <div key={idx} className="overflow-hidden rounded-xl border border-slate-800 bg-[#090D16]">
                  <div className="border-b border-slate-800 bg-slate-900/70 px-3 py-1.5 font-mono text-[11px] text-sky-300">
                    {h.header}
                  </div>
                  <div className="divide-y divide-slate-800/35 font-mono text-[11.5px] leading-5">
                    {h.lines.map((line, lIdx) => {
                      const rowBg =
                        line.type === 'add'
                          ? 'bg-emerald-500/10 text-emerald-100'
                          : line.type === 'del'
                            ? 'bg-rose-500/10 text-rose-200'
                            : 'text-slate-400';
                      const gutter = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
                      return (
                        <div key={lIdx} className={`grid grid-cols-[40px_40px_18px_1fr] px-2 ${rowBg}`}>
                          <span className="select-none pr-2 text-right text-[10px] text-slate-600">{line.oldLine ?? ''}</span>
                          <span className="select-none pr-2 text-right text-[10px] text-slate-600">{line.newLine ?? ''}</span>
                          <span className="select-none text-center font-bold">{gutter}</span>
                          <pre className="overflow-x-auto whitespace-pre">{highlightCode(line.content)}</pre>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            : splitHunks.map((sh, idx) => (
                <div key={idx} className="overflow-hidden rounded-xl border border-slate-800 bg-[#090D16]">
                  <div className="border-b border-slate-800 bg-slate-900/70 px-3 py-1.5 font-mono text-[11px] text-sky-300">
                    {sh.header}
                  </div>
                  <div className="divide-y divide-slate-800/35 font-mono text-[11px] leading-5">
                    {sh.rows.map((row, rIdx) => (
                      <div key={rIdx} className="grid grid-cols-2 divide-x divide-slate-800">
                        <div className={`flex px-2 ${row.oldType === 'del' ? 'bg-rose-500/10 text-rose-200' : 'text-slate-400'}`}>
                          <span className="w-7 shrink-0 select-none pr-2 text-right text-[10px] text-slate-600">{row.oldLn ?? ''}</span>
                          <pre className="truncate whitespace-pre">{highlightCode(row.oldText)}</pre>
                        </div>
                        <div className={`flex px-2 ${row.newType === 'add' ? 'bg-emerald-500/10 text-emerald-100' : 'text-slate-400'}`}>
                          <span className="w-7 shrink-0 select-none pr-2 text-right text-[10px] text-slate-600">{row.newLn ?? ''}</span>
                          <pre className="truncate whitespace-pre">{highlightCode(row.newText)}</pre>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
        </section>
      </div>
    </aside>
  );
}
