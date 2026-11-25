export type ImpactLevel = 'low' | 'medium' | 'high';
export type SymbolKind = 'function' | 'class' | 'method' | 'module' | 'type';
export type EdgeKind = 'calls' | 'imports' | 'exports';

export interface DiffLine {
  type: 'context' | 'add' | 'del';
  oldLine: number | null;
  newLine: number | null;
  content: string;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  contextSymbol?: string;
  lines: DiffLine[];
}

export interface ParsedFileDiff {
  path: string;
  oldPath: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  language: string;
  additions: number;
  deletions: number;
  imports: string[];
  hunks: DiffHunk[];
}

export interface ImpactNode {
  id: string;
  name: string;
  filePath: string;
  moduleGroup: string;
  kind: SymbolKind;
  status: 'added' | 'modified' | 'deleted';
  impact: ImpactLevel;
  impactScore: number;
  impactReasons: string[];
  additions: number;
  deletions: number;
  fanIn: number;
  fanOut: number;
  exported: boolean;
  signature: string;
  hunks: DiffHunk[];
  x: number;
  y: number;
}

export interface ImpactEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label: string;
}

export interface StoryboardGraph {
  title: string;
  rangeLabel: string;
  isDemo: boolean;
  generatedAt: string;
  nodes: ImpactNode[];
  edges: ImpactEdge[];
  files: ParsedFileDiff[];
  stats: {
    filesChanged: number;
    symbolsChanged: number;
    additions: number;
    deletions: number;
    highImpactCount: number;
    mediumImpactCount: number;
    lowImpactCount: number;
  };
}
