import { describe, expect, it } from 'vitest';
import { buildStoryboardGraph, parseUnifiedDiff } from '../src/core/diffParser.ts';
import { DEMO_FEATURE_DIFF, DEMO_UNIFIED_DIFF } from '../src/core/demoDataset.ts';

describe('diffcanvas parser & impact graph', () => {
  it('parses unified diff files, additions, deletions, and imports accurately', () => {
    const files = parseUnifiedDiff(DEMO_UNIFIED_DIFF);
    expect(files.length).toBe(8);
    const cacheFile = files.find((f) => f.path === 'src/auth/revocationCache.ts');
    expect(cacheFile?.status).toBe('added');
    expect(cacheFile?.additions).toBe(11);

    const verifyFile = files.find((f) => f.path === 'src/auth/verifyToken.ts');
    expect(verifyFile?.imports).toContain('../crypto/hmac');
    expect(verifyFile?.imports).toContain('./revocationCache');
  });

  it('links cross-file callers/callees and ranks high-impact shared symbols higher than leaf tests', () => {
    const graph = buildStoryboardGraph(DEMO_UNIFIED_DIFF, { isDemo: true });
    expect(graph.nodes.length).toBeGreaterThanOrEqual(7);
    expect(graph.edges.some((e) => e.kind === 'calls')).toBe(true);

    const verifyNode = graph.nodes.find((n) => n.name === 'verifyToken');
    const hmacNode = graph.nodes.find((n) => n.name === 'verifyHmacSignature');
    const testNode = graph.nodes.find((n) => n.filePath === 'test/auth.test.ts');

    expect(verifyNode).toBeDefined();
    expect(hmacNode).toBeDefined();
    expect(testNode).toBeDefined();
    expect(verifyNode!.fanIn).toBeGreaterThan(0);
    expect(verifyNode!.impactScore).toBeGreaterThan(testNode!.impactScore);
    expect(graph.stats.highImpactCount + graph.stats.mediumImpactCount).toBeGreaterThan(0);
  });

  it('parses worker batch demo diff cleanly with non-empty nodes and stats', () => {
    const graph = buildStoryboardGraph(DEMO_FEATURE_DIFF, { isDemo: true });
    expect(graph.stats.filesChanged).toBe(3);
    expect(graph.edges.some((e) => e.label.includes('executeBatch') || e.label.includes('runTask'))).toBe(true);
  });
});
