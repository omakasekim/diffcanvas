import { describe, expect, it } from 'vitest';
import { buildStoryboardGraph } from '../src/core/diffParser.ts';
import { DEMO_UNIFIED_DIFF } from '../src/core/demoDataset.ts';
import { computePrMetrics } from '../src/core/prMetrics.ts';
import { compareSchemas, generateMigrationAdapter, SCHEMA_DRIFT_PRESETS } from '../src/core/schemaDrift.ts';

describe('diffcanvas PR Health & Migration Adapter', () => {
  it('computes PR size grade, complexity delta, breaking signature changes, and health score', () => {
    const graph = buildStoryboardGraph(DEMO_UNIFIED_DIFF, { isDemo: true });
    const metrics = computePrMetrics(graph);
    expect(['S', 'M', 'L', 'XL']).toContain(metrics.sizeGrade);
    expect(metrics.healthScore).toBeGreaterThanOrEqual(20);
    expect(metrics.healthScore).toBeLessThanOrEqual(100);
    expect(metrics.summaryBadges.length).toBe(4);
  });

  it('generates executable TypeScript migration adapter code and parses GraphQL SDL', () => {
    const report = compareSchemas(SCHEMA_DRIFT_PRESETS[0].before, SCHEMA_DRIFT_PRESETS[0].after);
    const code = generateMigrationAdapter(report);
    expect(code).toContain('export function migratePayloadV1ToV2');
    expect(code).toContain('delete out["legacyPlanCode"]');

    const gqlDrift = compareSchemas(
      'type User {\n  id: ID!\n  email: String!\n}',
      'type User {\n  id: ID!\n  email: String\n  orgId: ID!\n}',
    );
    expect(gqlDrift.counts.breaking).toBe(1);
    expect(gqlDrift.counts.warning).toBe(1);
  });
});
