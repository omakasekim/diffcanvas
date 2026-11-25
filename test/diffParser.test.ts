import { describe, expect, it } from 'vitest';
import { buildStoryboardGraph, parseUnifiedDiff } from '../src/core/diffParser.ts';
import { DEMO_FEATURE_DIFF, DEMO_POLYGLOT_DIFF, DEMO_UNIFIED_DIFF } from '../src/core/demoDataset.ts';

describe('diffcanvas parser & impact graph', () => {
  it('parses unified diff files, hunks, and imports', () => {
    const files = parseUnifiedDiff(DEMO_UNIFIED_DIFF);
    expect(files.length).toBe(8);
    expect(files.find((f) => f.path === 'src/auth/keyring.ts')?.status).toBe('added');
    expect(files.find((f) => f.path === 'src/auth/verifyToken.ts')?.imports).toContain('./keyring');
  });

  it('links cross-file caller/callee edges and computes high impact on shared auth symbols', () => {
    const graph = buildStoryboardGraph(DEMO_UNIFIED_DIFF, { isDemo: true });
    expect(graph.nodes.length).toBeGreaterThanOrEqual(7);
    expect(graph.edges.length).toBeGreaterThanOrEqual(5);

    const verifyNode = graph.nodes.find((n) => n.name === 'verifySessionToken');
    expect(verifyNode).toBeDefined();
    expect(verifyNode!.fanIn).toBeGreaterThanOrEqual(1);
    expect(verifyNode!.impact).toBe('high');
  });

  it('supports worker concurrency refactor diff preset', () => {
    const graph = buildStoryboardGraph(DEMO_FEATURE_DIFF, { isDemo: true });
    expect(graph.stats.filesChanged).toBe(3);
    expect(graph.nodes.some((n) => n.name === 'BoundedCache')).toBe(true);
    expect(graph.edges.some((e) => e.kind === 'calls' || e.kind === 'imports')).toBe(true);
  });

  it('extracts Rust, Python, and TypeScript symbols and cross-language calls', () => {
    const graph = buildStoryboardGraph(DEMO_POLYGLOT_DIFF, { isDemo: true });
    expect(graph.stats.filesChanged).toBe(4);
    expect(graph.nodes.some((n) => n.name === 'schedule_wave')).toBe(true);
    expect(graph.nodes.some((n) => n.name === 'dispatch_jobs')).toBe(true);
    expect(graph.nodes.some((n) => n.name === 'postBatchRun')).toBe(true);
    expect(graph.edges.length).toBeGreaterThanOrEqual(3);
  });

  it('handles empty diffs safely without throwing', () => {
    const graph = buildStoryboardGraph('', { rangeLabel: 'empty' });
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
    expect(graph.stats.filesChanged).toBe(0);
  });
});
