import type { StoryboardGraph } from './types.ts';

export interface PrHealthReport {
  sizeGrade: 'S' | 'M' | 'L' | 'XL';
  complexityDelta: number;
  breakingSignatureNodes: string[];
  untestedFiles: string[];
  healthScore: number;
  summaryBadges: Array<{ label: string; tone: 'good' | 'warn' | 'bad' }>;
}

const BRANCH_RE = /\b(if|else\s+if|for|while|switch|case|catch|\?\?|&&|\|\|)\b|\?/g;

export function computePrMetrics(graph: StoryboardGraph): PrHealthReport {
  const totalChurn = graph.stats.additions + graph.stats.deletions;
  const sizeGrade: PrHealthReport['sizeGrade'] =
    totalChurn <= 50 ? 'S' : totalChurn <= 180 ? 'M' : totalChurn <= 450 ? 'L' : 'XL';

  let complexityDelta = 0;
  const breakingSignatureNodes: string[] = [];

  for (const node of graph.nodes) {
    let addedSig = false;
    let removedSig = false;
    for (const h of node.hunks) {
      for (const line of h.lines) {
        const matches = line.content.match(BRANCH_RE)?.length ?? 0;
        if (line.type === 'add') {
          complexityDelta += matches;
          if (/export\s+(?:async\s+)?(?:function|class|interface|type)|pub\s+(?:async\s+)?fn/.test(line.content)) {
            addedSig = true;
          }
        } else if (line.type === 'del') {
          complexityDelta -= matches;
          if (/export\s+(?:async\s+)?(?:function|class|interface|type)|pub\s+(?:async\s+)?fn/.test(line.content)) {
            removedSig = true;
          }
        }
      }
    }
    if (removedSig && (addedSig || node.fanIn > 0)) {
      breakingSignatureNodes.push(node.name);
    }
  }

  const testFiles = graph.files.filter((f) => /(?:test|spec)\./i.test(f.path) || f.path.includes('tests/'));
  const sourceFiles = graph.files.filter(
    (f) => !/(?:test|spec)\./i.test(f.path) && !f.path.includes('tests/') && /\.(ts|tsx|js|jsx|py|rs|go)$/.test(f.path),
  );
  const untestedFiles = sourceFiles
    .filter((sf) => {
      const stem = (sf.path.split('/').pop() ?? '').replace(/\.[^.]+$/, '').toLowerCase();
      return !testFiles.some((tf) => tf.path.toLowerCase().includes(stem) || tf.hunks.some((h) => h.lines.some((l) => l.content.toLowerCase().includes(stem))));
    })
    .map((f) => f.path);

  let score = 100;
  if (sizeGrade === 'XL') score -= 18;
  else if (sizeGrade === 'L') score -= 8;
  if (breakingSignatureNodes.length > 0) score -= Math.min(24, breakingSignatureNodes.length * 8);
  if (untestedFiles.length > 0) score -= Math.min(20, untestedFiles.length * 4);
  if (complexityDelta > 8) score -= 10;

  const summaryBadges: PrHealthReport['summaryBadges'] = [
    { label: `Size ${sizeGrade} (${totalChurn} lines)`, tone: sizeGrade === 'S' || sizeGrade === 'M' ? 'good' : 'warn' },
    { label: `Complexity ${complexityDelta >= 0 ? '+' : ''}${complexityDelta}`, tone: complexityDelta <= 4 ? 'good' : complexityDelta <= 10 ? 'warn' : 'bad' },
    {
      label: breakingSignatureNodes.length ? `${breakingSignatureNodes.length} sig change(s)` : '0 sig breaks',
      tone: breakingSignatureNodes.length ? 'bad' : 'good',
    },
    {
      label: untestedFiles.length ? `${untestedFiles.length} untested file(s)` : 'Tests touched',
      tone: untestedFiles.length ? 'warn' : 'good',
    },
  ];

  return {
    sizeGrade,
    complexityDelta,
    breakingSignatureNodes,
    untestedFiles,
    healthScore: Math.max(20, Math.min(100, score)),
    summaryBadges,
  };
}
