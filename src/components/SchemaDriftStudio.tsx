import { useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson,
  GitCompare,
  PlusCircle,
} from 'lucide-react';
import {
  compareSchemas,
  formatDriftMarkdown,
  SCHEMA_DRIFT_PRESETS,
  type DriftSeverity,
} from '../core/schemaDrift.ts';

const SEV_BADGE: Record<DriftSeverity, string> = {
  breaking: 'border-rose-500/50 bg-rose-500/15 text-rose-300',
  warning: 'border-amber-500/50 bg-amber-500/15 text-amber-300',
  additive: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300',
};

export function SchemaDriftStudio() {
  const [presetId, setPresetId] = useState<string>(SCHEMA_DRIFT_PRESETS[0].id);
  const [beforeText, setBeforeText] = useState<string>(SCHEMA_DRIFT_PRESETS[0].before);
  const [afterText, setAfterText] = useState<string>(SCHEMA_DRIFT_PRESETS[0].after);
  const [sevFilter, setSevFilter] = useState<'all' | DriftSeverity>('all');
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());

  const report = useMemo(() => compareSchemas(beforeText, afterText), [beforeText, afterText]);
  const presetName = SCHEMA_DRIFT_PRESETS.find((p) => p.id === presetId)?.name ?? 'Custom Schema';

  const visibleItems = useMemo(
    () => (sevFilter === 'all' ? report.items : report.items.filter((i) => i.severity === sevFilter)),
    [report.items, sevFilter],
  );

  const loadPreset = (id: string) => {
    const found = SCHEMA_DRIFT_PRESETS.find((p) => p.id === id);
    if (!found) return;
    setPresetId(found.id);
    setBeforeText(found.before);
    setAfterText(found.after);
    setCheckedIds(new Set());
  };

  const downloadFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  const totalItems = Math.max(1, report.items.length);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#090D16] text-slate-100">
      {/* Studio Sub-Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-[#0F172A] px-4 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <GitCompare className="h-3.5 w-3.5 text-sky-400" />
          {SCHEMA_DRIFT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => loadPreset(p.id)}
              className={`rounded-md border px-2.5 py-1 transition ${
                presetId === p.id
                  ? 'border-sky-500/60 bg-sky-500/15 font-semibold text-sky-200'
                  : 'border-slate-700 bg-[#111827] text-slate-300 hover:border-slate-500'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] uppercase text-sky-300">
            {report.format}
          </span>
          <button
            type="button"
            onClick={() => downloadFile(formatDriftMarkdown(report, presetName), `schema-drift-${presetId}.md`, 'text/markdown')}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#111827] px-2.5 py-1 text-xs text-slate-200 hover:border-emerald-500"
          >
            <Download className="h-3.5 w-3.5 text-emerald-400" /> Export .md
          </button>
          <button
            type="button"
            onClick={() => downloadFile(JSON.stringify(report, null, 2), `schema-drift-${presetId}.json`, 'application/json')}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#111827] px-2.5 py-1 text-xs text-slate-200 hover:border-sky-500"
          >
            <FileJson className="h-3.5 w-3.5 text-sky-400" /> JSON
          </button>
        </div>
      </div>

      {/* Main Grid: Left Editors (Before/After), Right Drift Visuals + Migration Checklist */}
      <div className="grid flex-1 overflow-hidden lg:grid-cols-[1.05fr_1.15fr]">
        {/* Before & After Editors */}
        <section className="grid grid-rows-2 divide-y divide-slate-800 overflow-hidden border-r border-slate-800">
          <div className="flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800 bg-[#111827] px-3.5 py-1.5 text-xs font-semibold text-rose-300">
              <span>Before Schema ({report.beforeCount} fields)</span>
              <span className="font-mono text-[10px] text-slate-500">OpenAPI · JSON Schema · TS Interface</span>
            </div>
            <textarea
              value={beforeText}
              onChange={(e) => {
                setPresetId('custom');
                setBeforeText(e.target.value);
              }}
              spellCheck={false}
              className="flex-1 resize-none bg-[#090D16] p-3.5 font-mono text-[11.5px] leading-5 text-slate-200 focus:outline-none"
            />
          </div>

          <div className="flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800 bg-[#111827] px-3.5 py-1.5 text-xs font-semibold text-emerald-300">
              <span>After Schema ({report.afterCount} fields)</span>
              <span className="font-mono text-[10px] text-slate-500">Live diff computes on edit</span>
            </div>
            <textarea
              value={afterText}
              onChange={(e) => {
                setPresetId('custom');
                setAfterText(e.target.value);
              }}
              spellCheck={false}
              className="flex-1 resize-none bg-[#090D16] p-3.5 font-mono text-[11.5px] leading-5 text-sky-100 focus:outline-none"
            />
          </div>
        </section>

        {/* Right: Visual Risk Breakdown, Drift Matrix & Migration Checklist */}
        <section className="flex flex-col space-y-4 overflow-y-auto bg-[#111827] p-5">
          {/* KPI Cards + Stacked Severity Bar */}
          <div className="rounded-xl border border-slate-800 bg-[#090D16] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Contract Compatibility Score</div>
                <div className="mt-0.5 flex items-baseline gap-2">
                  <span className={`font-mono text-2xl font-extrabold ${report.counts.breaking > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {report.riskScore}/100
                  </span>
                  <span className="text-xs text-slate-400">
                    {report.counts.breaking > 0 ? 'MAJOR / BREAKING BUMP REQUIRED' : 'BACKWARD COMPATIBLE'}
                  </span>
                </div>
              </div>
              <div className="flex gap-2 font-mono text-xs">
                <span className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-rose-300">
                  <AlertOctagon className="h-3.5 w-3.5" /> {report.counts.breaking} Breaking
                </span>
                <span className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" /> {report.counts.warning} Warn
                </span>
                <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-emerald-300">
                  <PlusCircle className="h-3.5 w-3.5" /> {report.counts.additive} Additive
                </span>
              </div>
            </div>

            <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div className="bg-rose-500 transition-all" style={{ width: `${(report.counts.breaking / totalItems) * 100}%` }} />
              <div className="bg-amber-400 transition-all" style={{ width: `${(report.counts.warning / totalItems) * 100}%` }} />
              <div className="bg-emerald-400 transition-all" style={{ width: `${(report.counts.additive / totalItems) * 100}%` }} />
            </div>
          </div>

          {/* Drift Diff List */}
          <div className="space-y-2.5 rounded-xl border border-slate-800 bg-[#090D16] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Detected Contract Changes ({visibleItems.length})
              </h2>
              <div className="flex rounded-lg border border-slate-800 bg-[#111827] p-0.5 text-[11px]">
                {(['all', 'breaking', 'warning', 'additive'] as const).map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => setSevFilter(tier)}
                    className={`rounded px-2 py-0.5 capitalize ${
                      sevFilter === tier ? 'bg-slate-800 font-semibold text-slate-100' : 'text-slate-400'
                    }`}
                  >
                    {tier}
                  </button>
                ))}
              </div>
            </div>

            {visibleItems.length === 0 ? (
              <p className="text-xs text-emerald-400">No changes matching this filter.</p>
            ) : (
              <div className="space-y-2">
                {visibleItems.map((item) => (
                  <div key={item.id} className="rounded-lg border border-slate-800 bg-[#111827] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-slate-100">{item.path}</span>
                      <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${SEV_BADGE[item.severity]}`}>
                        {item.severity} · {item.kind}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-300">{item.reason}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px]">
                      <span className="rounded bg-rose-500/10 px-2 py-0.5 text-rose-300">- {item.before}</span>
                      <span className="text-slate-500">→</span>
                      <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-emerald-300">+ {item.after}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Interactive Migration Checklist */}
          <div className="space-y-2.5 rounded-xl border border-slate-800 bg-[#090D16] p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Generated Migration Checklist
              </h2>
              <span className="font-mono text-xs text-emerald-400">
                {checkedIds.size}/{report.checklist.length} ready
              </span>
            </div>
            <div className="space-y-1.5">
              {report.checklist.map((c) => {
                const done = checkedIds.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setCheckedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.id)) next.delete(c.id);
                        else next.add(c.id);
                        return next;
                      });
                    }}
                    className="flex w-full items-start gap-2.5 rounded-lg border border-slate-800 bg-[#111827] px-3 py-2 text-left text-xs hover:border-slate-600"
                  >
                    <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${done ? 'text-emerald-400' : 'text-slate-600'}`} />
                    <div className={done ? 'line-through text-slate-500' : 'text-slate-200'}>
                      <span className="mr-1.5 font-mono text-[10px] font-bold uppercase text-sky-300">{c.path}</span>
                      {c.text}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
