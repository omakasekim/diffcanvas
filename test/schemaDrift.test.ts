import { describe, expect, it } from 'vitest';
import { compareSchemas, formatDriftMarkdown, SCHEMA_DRIFT_PRESETS } from '../src/core/schemaDrift.ts';

describe('diffcanvas Schema Drift Studio', () => {
  it('detects breaking removals, type changes, new required fields, and enum removals in OpenAPI JSON', () => {
    const p = SCHEMA_DRIFT_PRESETS[0];
    const report = compareSchemas(p.before, p.after);
    expect(report.format).toBe('openapi');
    expect(report.counts.breaking).toBeGreaterThanOrEqual(3);
    expect(report.counts.additive).toBeGreaterThanOrEqual(1);
    expect(report.checklist.length).toBe(report.items.length);
  });

  it('compares TypeScript interfaces and generates a Markdown migration report', () => {
    const p = SCHEMA_DRIFT_PRESETS[1];
    const report = compareSchemas(p.before, p.after);
    expect(report.format).toBe('typescript');
    expect(report.items.some((i) => i.path === 'SessionClaims.deviceId' && i.kind === 'required-changed')).toBe(true);
    const md = formatDriftMarkdown(report, p.name);
    expect(md).toContain('## Migration Checklist');
  });
});
