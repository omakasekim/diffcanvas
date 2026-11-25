import type {
  DiffHunk,
  DiffLine,
  ImpactEdge,
  ImpactLevel,
  ImpactNode,
  ParsedFileDiff,
  StoryboardGraph,
  SymbolKind,
} from './types.ts';

function detectLanguage(filePath: string): string {
  if (/\.(tsx?|mts|cts)$/.test(filePath)) return 'typescript';
  if (/\.(jsx?|mjs|cjs)$/.test(filePath)) return 'javascript';
  if (/\.py$/.test(filePath)) return 'python';
  if (/\.rs$/.test(filePath)) return 'rust';
  if (/\.go$/.test(filePath)) return 'go';
  if (/\.css$/.test(filePath)) return 'css';
  return 'text';
}

function moduleGroupFor(filePath: string): string {
  const parts = filePath.split('/');
  if (parts.length <= 1) return 'root';
  if (parts[0] === 'src' && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:\s*(.*))?$/;

export function parseUnifiedDiff(rawDiff: string): ParsedFileDiff[] {
  const lines = rawDiff.replace(/\r\n/g, '\n').split('\n');
  const files: ParsedFileDiff[] = [];
  let current: ParsedFileDiff | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLn = 0;
  let newLn = 0;

  const flushHunk = () => {
    if (current && currentHunk) {
      current.hunks.push(currentHunk);
      currentHunk = null;
    }
  };

  const flushFile = () => {
    flushHunk();
    if (current) {
      files.push(current);
      current = null;
    }
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flushFile();
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      const oldPath = m?.[1] ?? 'unknown';
      const newPath = m?.[2] ?? 'unknown';
      current = {
        path: newPath,
        oldPath,
        status: oldPath !== newPath ? 'renamed' : 'modified',
        language: detectLanguage(newPath),
        additions: 0,
        deletions: 0,
        imports: [],
        hunks: [],
      };
      continue;
    }

    if (!current) continue;

    if (line.startsWith('new file mode ')) {
      current.status = 'added';
      continue;
    }
    if (line.startsWith('deleted file mode ')) {
      current.status = 'deleted';
      continue;
    }
    if (line.startsWith('--- a/') || line.startsWith('+++ b/') || line.startsWith('--- /dev/null') || line.startsWith('+++ /dev/null') || line.startsWith('index ')) {
      if (line.startsWith('+++ b/')) {
        const p = line.slice(6);
        current.path = p;
        current.language = detectLanguage(p);
      }
      continue;
    }

    if (line.startsWith('@@ ')) {
      flushHunk();
      const hm = HUNK_RE.exec(line);
      if (hm) {
        oldLn = Number(hm[1]);
        newLn = Number(hm[3]);
        currentHunk = {
          header: line,
          oldStart: oldLn,
          oldLines: hm[2] !== undefined ? Number(hm[2]) : 1,
          newStart: newLn,
          newLines: hm[4] !== undefined ? Number(hm[4]) : 1,
          contextSymbol: hm[5]?.trim() || undefined,
          lines: [],
        };
      }
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith('+')) {
      const content = line.slice(1);
      current.additions += 1;
      currentHunk.lines.push({ type: 'add', oldLine: null, newLine: newLn, content });
      newLn += 1;
      extractImportSpec(content, current.imports);
    } else if (line.startsWith('-')) {
      const content = line.slice(1);
      current.deletions += 1;
      currentHunk.lines.push({ type: 'del', oldLine: oldLn, newLine: null, content });
      oldLn += 1;
    } else if (line.startsWith(' ') || line === '') {
      const content = line.startsWith(' ') ? line.slice(1) : '';
      currentHunk.lines.push({ type: 'context', oldLine: oldLn, newLine: newLn, content });
      oldLn += 1;
      newLn += 1;
      extractImportSpec(content, current.imports);
    }
  }

  flushFile();
  return files;
}

function extractImportSpec(line: string, out: string[]): void {
  const esm = /^\s*import\s+(?:.+?\s+from\s+)?['"]([^'"]+)['"]/.exec(line);
  if (esm && !out.includes(esm[1])) out.push(esm[1]);
  const cjs = /require\(\s*['"]([^'"]+)['"]\s*\)/.exec(line);
  if (cjs && !out.includes(cjs[1])) out.push(cjs[1]);
  const py = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/.exec(line);
  const pyMod = py?.[1] || py?.[2];
  if (pyMod && !out.includes(pyMod)) out.push(pyMod);
  const rust = /^\s*use\s+([\w:]+)/.exec(line);
  if (rust && !out.includes(rust[1])) out.push(rust[1]);
}

interface ExtractedSymbol {
  name: string;
  kind: SymbolKind;
  exported: boolean;
  signature: string;
}

const IGNORE_NAMES = new Set([
  'if', 'else', 'for', 'while', 'switch', 'case', 'return', 'catch', 'try',
  'await', 'async', 'new', 'typeof', 'const', 'let', 'var', 'function', 'constructor',
]);

function detectSymbolInLine(rawLine: string): ExtractedSymbol | null {
  const line = rawLine.trim();
  if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('#')) return null;

  const exported = /^(?:export\s+(?:default\s+)?|pub\s+(?:\(crate\)\s+)?)/.test(line);

  // TypeScript / JS functions & arrow components/handlers
  let m = /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(line);
  if (m && !IGNORE_NAMES.has(m[1])) {
    return { name: m[1], kind: 'function', exported, signature: line.slice(0, 96) };
  }

  m = /^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>/.exec(line);
  if (m && !IGNORE_NAMES.has(m[1])) {
    return { name: m[1], kind: 'function', exported, signature: line.slice(0, 96) };
  }

  m = /^(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(line);
  if (m) {
    return { name: m[1], kind: 'class', exported, signature: line.slice(0, 96) };
  }

  m = /^(?:export\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)/.exec(line);
  if (m) {
    return { name: m[1], kind: 'type', exported, signature: line.slice(0, 96) };
  }

  // Python / Rust / Go
  m = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(line);
  if (m) return { name: m[1], kind: 'function', exported: !m[1].startsWith('_'), signature: line.slice(0, 96) };

  m = /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/.exec(line);
  if (m) return { name: m[1], kind: 'function', exported, signature: line.slice(0, 96) };

  m = /^func\s+(?:\([^)]+\)\s*)?([A-Za-z_]\w*)\s*\(/.exec(line);
  if (m) return { name: m[1], kind: 'function', exported: /^[A-Z]/.test(m[1]), signature: line.slice(0, 96) };

  // Class method inside hunk
  m = /^(?:public|private|protected|static|async|\s)*([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?::\s*[\w<>[\]|&\s]+)?\s*\{$/.exec(line);
  if (m && !IGNORE_NAMES.has(m[1])) {
    return { name: m[1], kind: 'method', exported: false, signature: line.slice(0, 96) };
  }

  return null;
}

function symbolFromHunkHeader(headerCtx: string | undefined): ExtractedSymbol | null {
  if (!headerCtx) return null;
  return detectSymbolInLine(headerCtx) ?? {
    name: headerCtx.replace(/[{(:].*$/, '').trim().slice(0, 40) || 'block',
    kind: 'function',
    exported: false,
    signature: headerCtx.slice(0, 96),
  };
}

function resolveImportMatch(sourcePath: string, importSpec: string, allFiles: ParsedFileDiff[]): ParsedFileDiff | undefined {
  const cleanSpec = importSpec.replace(/^\.\//, '').replace(/\.(ts|tsx|js|jsx|mjs)$/, '');
  const baseSpec = cleanSpec.split('/').pop() ?? cleanSpec;
  const srcDir = sourcePath.split('/').slice(0, -1).join('/');

  return allFiles.find((f) => {
    if (f.path === sourcePath) return false;
    const noExt = f.path.replace(/\.(ts|tsx|js|jsx|mjs|py|rs|go)$/, '');
    if (importSpec.startsWith('.') && srcDir) {
      const normalized = `${srcDir}/${importSpec}`.replace(/\/[^/]+\/\.\.\//g, '/').replace('/./', '/').replace(/\.(ts|tsx|js|jsx|mjs)$/, '');
      if (noExt === normalized || noExt === `${normalized}/index`) return true;
    }
    return noExt.endsWith(`/${baseSpec}`) || noExt === baseSpec;
  });
}

function countIdentifierCalls(lines: DiffLine[], symbolName: string): number {
  if (symbolName.length < 3) return 0;
  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b(?:\\s*\\(|\\s*[,)])`);
  let hits = 0;
  for (const l of lines) {
    if (l.type === 'del') continue;
    if (re.test(l.content)) hits += 1;
  }
  return hits;
}

export function buildStoryboardGraph(
  rawDiff: string,
  opts: { title?: string; rangeLabel?: string; isDemo?: boolean } = {},
): StoryboardGraph {
  const files = parseUnifiedDiff(rawDiff);
  const draftNodes: Array<{
    id: string;
    name: string;
    filePath: string;
    moduleGroup: string;
    kind: SymbolKind;
    status: 'added' | 'modified' | 'deleted';
    additions: number;
    deletions: number;
    exported: boolean;
    signature: string;
    hunks: DiffHunk[];
  }> = [];

  for (const f of files) {
    const symbolMap = new Map<string, { sym: ExtractedSymbol; hunks: DiffHunk[]; adds: number; dels: number }>();

    for (const h of f.hunks) {
      let active: ExtractedSymbol | null = symbolFromHunkHeader(h.contextSymbol);
      for (const l of h.lines) {
        if (l.type !== 'context') {
          const found = detectSymbolInLine(l.content);
          if (found) {
            active = found;
            break;
          }
        }
      }
      if (!active) {
        for (const l of h.lines) {
          const found = detectSymbolInLine(l.content);
          if (found) {
            active = found;
            break;
          }
        }
      }

      const fileStem = f.path.split('/').pop() ?? f.path;
      const sym: ExtractedSymbol = active ?? {
        name: fileStem,
        kind: 'module',
        exported: true,
        signature: f.path,
      };

      const adds = h.lines.filter((l) => l.type === 'add').length;
      const dels = h.lines.filter((l) => l.type === 'del').length;
      const key = `${f.path}::${sym.name}`;
      const existing = symbolMap.get(key);
      if (existing) {
        existing.hunks.push(h);
        existing.adds += adds;
        existing.dels += dels;
      } else {
        symbolMap.set(key, { sym, hunks: [h], adds, dels });
      }
    }

    if (symbolMap.size === 0) {
      const fileStem = f.path.split('/').pop() ?? f.path;
      draftNodes.push({
        id: `${f.path}::${fileStem}`,
        name: fileStem,
        filePath: f.path,
        moduleGroup: moduleGroupFor(f.path),
        kind: 'module',
        status: f.status === 'added' ? 'added' : f.status === 'deleted' ? 'deleted' : 'modified',
        additions: f.additions,
        deletions: f.deletions,
        exported: true,
        signature: f.path,
        hunks: f.hunks,
      });
      continue;
    }

    for (const [id, entry] of symbolMap) {
      draftNodes.push({
        id,
        name: entry.sym.name,
        filePath: f.path,
        moduleGroup: moduleGroupFor(f.path),
        kind: entry.sym.kind,
        status: f.status === 'added' ? 'added' : f.status === 'deleted' ? 'deleted' : 'modified',
        additions: entry.adds,
        deletions: entry.dels,
        exported: entry.sym.exported,
        signature: entry.sym.signature,
        hunks: entry.hunks,
      });
    }
  }

  // Link caller/callee + import edges across symbols
  const edges: ImpactEdge[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (source: string, target: string, kind: ImpactEdge['kind'], label: string) => {
    if (source === target) return;
    const key = `${source}->${target}:${kind}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ id: key, source, target, kind, label });
  };

  for (const src of draftNodes) {
    const srcLines = src.hunks.flatMap((h) => h.lines);
    for (const dst of draftNodes) {
      if (src.id === dst.id) continue;
      if (dst.kind !== 'module' && countIdentifierCalls(srcLines, dst.name) > 0) {
        addEdge(src.id, dst.id, 'calls', `calls ${dst.name}()`);
      }
    }
  }

  for (const f of files) {
    const srcNodes = draftNodes.filter((n) => n.filePath === f.path);
    const primarySrc = srcNodes[0];
    if (!primarySrc) continue;
    for (const spec of f.imports) {
      const targetFile = resolveImportMatch(f.path, spec, files);
      if (!targetFile) continue;
      const dstNodes = draftNodes.filter((n) => n.filePath === targetFile.path);
      for (const dst of dstNodes) {
        const alreadyLinked = edges.some((e) => e.source === primarySrc.id && e.target === dst.id);
        if (!alreadyLinked && dst.exported) {
          addEdge(primarySrc.id, dst.id, 'imports', `imports ${targetFile.path.split('/').pop()}`);
        }
      }
    }
  }

  // Compute fan-in, fan-out, and transitive impact radius
  const fanInMap = new Map<string, number>();
  const fanOutMap = new Map<string, number>();
  const reverseAdj = new Map<string, string[]>();

  for (const e of edges) {
    fanOutMap.set(e.source, (fanOutMap.get(e.source) ?? 0) + 1);
    fanInMap.set(e.target, (fanInMap.get(e.target) ?? 0) + 1);
    const arr = reverseAdj.get(e.target) ?? [];
    arr.push(e.source);
    reverseAdj.set(e.target, arr);
  }

  const upstreamCount = (startId: string): number => {
    const seen = new Set<string>([startId]);
    const queue = [startId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const prev of reverseAdj.get(cur) ?? []) {
        if (!seen.has(prev)) {
          seen.add(prev);
          queue.push(prev);
        }
      }
    }
    return seen.size - 1;
  };

  // Group nodes cleanly into columns by moduleGroup/topological tier
  const groupNames = Array.from(new Set(draftNodes.map((n) => n.moduleGroup)));
  const groupOffsets = new Map<string, number>();
  groupNames.forEach((g, idx) => groupOffsets.set(g, idx));
  const rowCounts = new Map<string, number>();

  const nodes: ImpactNode[] = draftNodes.map((d) => {
    const fanIn = fanInMap.get(d.id) ?? 0;
    const fanOut = fanOutMap.get(d.id) ?? 0;
    const upstream = upstreamCount(d.id);
    const churn = d.additions + d.deletions;
    const reasons: string[] = [];

    let score = 0;
    if (d.exported) {
      score += 18;
      reasons.push('Exported public symbol');
    }
    if (d.kind === 'type') {
      score += 12;
      reasons.push('Shared type/contract change');
    }
    if (fanIn > 0) {
      score += fanIn * 22 + upstream * 8;
      reasons.push(`Called/imported by ${fanIn} changed symbol(s) (${upstream} transitive)`);
    }
    if (churn >= 25) {
      score += 20;
      reasons.push(`High hunk churn (${d.additions}+ / ${d.deletions}-)`);
    } else if (churn >= 10) {
      score += 10;
      reasons.push(`Moderate diff size (${d.additions}+ / ${d.deletions}-)`);
    }
    if (d.deletions > d.additions) {
      score += 8;
      reasons.push('Net deletion / signature refactor');
    }
    if (reasons.length === 0) {
      reasons.push('Localized internal change');
    }

    const impact: ImpactLevel = score >= 52 ? 'high' : score >= 28 ? 'medium' : 'low';
    const col = groupOffsets.get(d.moduleGroup) ?? 0;
    const row = rowCounts.get(d.moduleGroup) ?? 0;
    rowCounts.set(d.moduleGroup, row + 1);

    return {
      ...d,
      impact,
      impactScore: Math.min(100, score),
      impactReasons: reasons,
      fanIn,
      fanOut,
      x: 90 + (col % 4) * 320 + (row % 2) * 28,
      y: 80 + row * 145 + Math.floor(col / 4) * 420,
    };
  });

  // Sort tour priority cleanly: exported contracts / high impact first
  const totalAdds = files.reduce((s, f) => s + f.additions, 0);
  const totalDels = files.reduce((s, f) => s + f.deletions, 0);

  return {
    title: opts.title ?? 'PR Spatial Storyboard',
    rangeLabel: opts.rangeLabel ?? 'working tree',
    isDemo: Boolean(opts.isDemo),
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
    files,
    stats: {
      filesChanged: files.length,
      symbolsChanged: nodes.length,
      additions: totalAdds,
      deletions: totalDels,
      highImpactCount: nodes.filter((n) => n.impact === 'high').length,
      mediumImpactCount: nodes.filter((n) => n.impact === 'medium').length,
      lowImpactCount: nodes.filter((n) => n.impact === 'low').length,
    },
  };
}
