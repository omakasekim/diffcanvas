export type DriftSeverity = 'breaking' | 'warning' | 'additive';

export interface SchemaField {
  path: string;
  type: string;
  required: boolean;
  enumValues?: string[];
  description?: string;
}

export interface SchemaDriftItem {
  id: string;
  path: string;
  severity: DriftSeverity;
  kind: 'removed' | 'added' | 'type-changed' | 'required-changed' | 'enum-changed';
  before?: string;
  after?: string;
  reason: string;
  migrationAction: string;
}

export interface SchemaDriftReport {
  format: 'json-schema' | 'openapi' | 'typescript';
  beforeCount: number;
  afterCount: number;
  items: SchemaDriftItem[];
  counts: {
    breaking: number;
    warning: number;
    additive: number;
  };
  riskScore: number;
  checklist: Array<{ id: string; severity: DriftSeverity; text: string; path: string }>;
}

function flattenJsonSchemaProps(
  schema: Record<string, unknown>,
  prefix = '',
  out: Map<string, SchemaField> = new Map(),
): Map<string, SchemaField> {
  // Handle OpenAPI components.schemas or paths responses
  if (schema.components && typeof schema.components === 'object') {
    const comp = schema.components as Record<string, unknown>;
    if (comp.schemas && typeof comp.schemas === 'object') {
      for (const [name, sub] of Object.entries(comp.schemas as Record<string, unknown>)) {
        if (sub && typeof sub === 'object') {
          flattenJsonSchemaProps(sub as Record<string, unknown>, name, out);
        }
      }
      return out;
    }
  }

  const reqSet = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  const props =
    schema.properties && typeof schema.properties === 'object'
      ? (schema.properties as Record<string, unknown>)
      : null;

  if (props) {
    for (const [key, rawVal] of Object.entries(props)) {
      const val = (rawVal && typeof rawVal === 'object' ? rawVal : {}) as Record<string, unknown>;
      const fullPath = prefix ? `${prefix}.${key}` : key;
      const typeStr = Array.isArray(val.type)
        ? val.type.join(' | ')
        : typeof val.type === 'string'
          ? val.type
          : val.$ref
            ? String(val.$ref).split('/').pop() ?? 'ref'
            : 'object';

      out.set(fullPath, {
        path: fullPath,
        type: typeStr,
        required: reqSet.has(key),
        enumValues: Array.isArray(val.enum) ? val.enum.map(String) : undefined,
        description: typeof val.description === 'string' ? val.description : undefined,
      });

      if (val.properties && typeof val.properties === 'object') {
        flattenJsonSchemaProps(val, fullPath, out);
      } else if (val.items && typeof val.items === 'object' && (val.items as Record<string, unknown>).properties) {
        flattenJsonSchemaProps(val.items as Record<string, unknown>, `${fullPath}[]`, out);
      }
    }
    return out;
  }

  // Fallback for plain JSON example object
  for (const [key, val] of Object.entries(schema)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    const t = val === null ? 'null' : Array.isArray(val) ? 'array' : typeof val;
    out.set(fullPath, { path: fullPath, type: t, required: true });
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      flattenJsonSchemaProps(val as Record<string, unknown>, fullPath, out);
    }
  }
  return out;
}

export function parseTypeScriptSchema(source: string): Map<string, SchemaField> {
  const out = new Map<string, SchemaField>();
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let currentType = '';

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('*')) continue;
    const header = /^(?:export\s+)?(?:interface|type)\s+([A-Za-z_]\w*)/.exec(line);
    if (header) {
      currentType = header[1];
      continue;
    }
    if (line === '}' || line === '};') {
      currentType = '';
      continue;
    }
    const prop = /^([A-Za-z_]\w*)(\?)?\s*:\s*([^;]+);?$/.exec(line);
    if (prop) {
      const key = prop[1];
      const optional = Boolean(prop[2]);
      const typeStr = prop[3].trim();
      const fullPath = currentType ? `${currentType}.${key}` : key;
      const enumVals = typeStr.includes("'") || typeStr.includes('"')
        ? typeStr
            .split('|')
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean)
        : undefined;
      out.set(fullPath, {
        path: fullPath,
        type: typeStr,
        required: !optional,
        enumValues: enumVals,
      });
    }
  }
  return out;
}

export function parseGraphqlSchema(source: string): Map<string, SchemaField> {
  const out = new Map<string, SchemaField>();
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let curType = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const th = /^(?:type|input)\s+([A-Za-z_]\w*)/.exec(line);
    if (th) {
      curType = th[1];
      continue;
    }
    if (line === '}') {
      curType = '';
      continue;
    }
    const fm = /^([A-Za-z_]\w*)\s*:\s*([A-Za-z0-9_[\]!]+)/.exec(line);
    if (fm && curType) {
      const required = fm[2].endsWith('!');
      out.set(`${curType}.${fm[1]}`, {
        path: `${curType}.${fm[1]}`,
        type: fm[2].replace(/!$/, ''),
        required,
      });
    }
  }
  return out;
}

export function parseSchemaInput(raw: string): {
  format: 'json-schema' | 'openapi' | 'typescript';
  fields: Map<string, SchemaField>;
} {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const format = parsed.openapi || parsed.components ? 'openapi' : 'json-schema';
      return { format, fields: flattenJsonSchemaProps(parsed) };
    } catch {
      /* fallback */
    }
  }
  if (/^\s*(?:type|input)\s+[A-Z]\w*\s*\{/m.test(trimmed) && !/interface\s+/.test(trimmed)) {
    return { format: 'typescript', fields: parseGraphqlSchema(trimmed) };
  }
  return { format: 'typescript', fields: parseTypeScriptSchema(trimmed) };
}

export function generateMigrationAdapter(report: SchemaDriftReport): string {
  const lines: string[] = [
    '// Auto-generated compatibility adapter from diffcanvas Schema Drift Studio',
    'export function migratePayloadV1ToV2(input: Record<string, unknown>): Record<string, unknown> {',
    '  const out: Record<string, unknown> = { ...input };',
  ];
  for (const item of report.items) {
    const leaf = item.path.split('.').pop() ?? item.path;
    if (item.kind === 'removed') {
      lines.push(`  delete out[${JSON.stringify(leaf)}]; // removed in v2`);
    } else if (item.kind === 'added' && item.severity === 'breaking') {
      lines.push(`  if (out[${JSON.stringify(leaf)}] === undefined) out[${JSON.stringify(leaf)}] = ""; // TODO: backfill required field`);
    } else if (item.kind === 'type-changed' && item.after?.includes('string')) {
      lines.push(`  if (out[${JSON.stringify(leaf)}] !== undefined) out[${JSON.stringify(leaf)}] = String(out[${JSON.stringify(leaf)}]);`);
    } else if (item.kind === 'type-changed' && (item.after?.includes('number') || item.after?.includes('integer'))) {
      lines.push(`  if (out[${JSON.stringify(leaf)}] !== undefined) out[${JSON.stringify(leaf)}] = Number(out[${JSON.stringify(leaf)}]);`);
    } else if (item.kind === 'required-changed' && item.after === 'required') {
      lines.push(`  out[${JSON.stringify(leaf)}] = out[${JSON.stringify(leaf)}] ?? "default"; // now required`);
    }
  }
  lines.push('  return out;', '}');
  return lines.join('\n');
}

export function compareSchemas(beforeRaw: string, afterRaw: string): SchemaDriftReport {
  const before = parseSchemaInput(beforeRaw);
  const after = parseSchemaInput(afterRaw);
  const items: SchemaDriftItem[] = [];
  let seq = 0;

  for (const [path, bf] of before.fields) {
    const af = after.fields.get(path);
    if (!af) {
      items.push({
        id: `d_${seq++}`,
        path,
        severity: 'breaking',
        kind: 'removed',
        before: `${bf.type}${bf.required ? ' (required)' : ' (optional)'}`,
        after: 'removed',
        reason: `Field "${path}" was deleted from contract`,
        migrationAction: `Deprecate and dual-read "${path}" or bump major API version before removal.`,
      });
      continue;
    }

    if (bf.type !== af.type) {
      const widened = af.type.includes(bf.type) && af.type.includes('|');
      items.push({
        id: `d_${seq++}`,
        path,
        severity: widened ? 'warning' : 'breaking',
        kind: 'type-changed',
        before: bf.type,
        after: af.type,
        reason: widened
          ? `Field "${path}" type widened from ${bf.type} to ${af.type}`
          : `Incompatible type change on "${path}": ${bf.type} → ${af.type}`,
        migrationAction: widened
          ? `Verify downstream consumers handle union branches of "${path}" (${af.type}).`
          : `Add coercion adapter or versioned field for "${path}" (${bf.type} → ${af.type}).`,
      });
    }

    if (!bf.required && af.required) {
      items.push({
        id: `d_${seq++}`,
        path,
        severity: 'breaking',
        kind: 'required-changed',
        before: 'optional',
        after: 'required',
        reason: `Optional field "${path}" became required`,
        migrationAction: `Backfill default value for "${path}" on existing clients before enforcing required validation.`,
      });
    } else if (bf.required && !af.required) {
      items.push({
        id: `d_${seq++}`,
        path,
        severity: 'warning',
        kind: 'required-changed',
        before: 'required',
        after: 'optional',
        reason: `Required field "${path}" relaxed to optional`,
        migrationAction: `Add null/undefined guard when reading "${path}" in response consumers.`,
      });
    }

    if (bf.enumValues && af.enumValues) {
      const removedVals = bf.enumValues.filter((v) => !af.enumValues!.includes(v));
      const addedVals = af.enumValues.filter((v) => !bf.enumValues!.includes(v));
      if (removedVals.length > 0) {
        items.push({
          id: `d_${seq++}`,
          path,
          severity: 'breaking',
          kind: 'enum-changed',
          before: bf.enumValues.join(' | '),
          after: af.enumValues.join(' | '),
          reason: `Removed enum value(s) on "${path}": ${removedVals.join(', ')}`,
          migrationAction: `Migrate stored records using [${removedVals.join(', ')}] before removing enum members.`,
        });
      } else if (addedVals.length > 0) {
        items.push({
          id: `d_${seq++}`,
          path,
          severity: 'additive',
          kind: 'enum-changed',
          before: bf.enumValues.join(' | '),
          after: af.enumValues.join(' | '),
          reason: `Added enum value(s) on "${path}": ${addedVals.join(', ')}`,
          migrationAction: `Ensure exhaustive switch statements handle new enum value(s): ${addedVals.join(', ')}.`,
        });
      }
    }
  }

  for (const [path, af] of after.fields) {
    if (!before.fields.has(path)) {
      const breaking = af.required;
      items.push({
        id: `d_${seq++}`,
        path,
        severity: breaking ? 'breaking' : 'additive',
        kind: 'added',
        before: 'absent',
        after: `${af.type}${af.required ? ' (required)' : ' (optional)'}`,
        reason: breaking
          ? `New required field "${path}" breaks older producers`
          : `Backward-compatible optional field "${path}" added`,
        migrationAction: breaking
          ? `Make "${path}" optional with server default until all clients upgrade.`
          : `Document optional field "${path}" in SDK changelog.`,
      });
    }
  }

  const order = { breaking: 0, warning: 1, additive: 2 };
  items.sort((a, b) => order[a.severity] - order[b.severity] || a.path.localeCompare(b.path));

  const counts = {
    breaking: items.filter((i) => i.severity === 'breaking').length,
    warning: items.filter((i) => i.severity === 'warning').length,
    additive: items.filter((i) => i.severity === 'additive').length,
  };
  const riskScore = Math.min(100, counts.breaking * 28 + counts.warning * 10 + counts.additive * 2);

  return {
    format: after.format,
    beforeCount: before.fields.size,
    afterCount: after.fields.size,
    items,
    counts,
    riskScore,
    checklist: items.map((i) => ({
      id: i.id,
      severity: i.severity,
      text: i.migrationAction,
      path: i.path,
    })),
  };
}

export function formatDriftMarkdown(report: SchemaDriftReport, presetName: string): string {
  const lines = [
    `# Schema Drift Report — ${presetName}`,
    `- Format: \`${report.format}\` | Risk Score: **${report.riskScore}/100**`,
    `- Summary: **${report.counts.breaking} breaking**, **${report.counts.warning} warning**, **${report.counts.additive} additive**`,
    '',
    '## Detected Drift',
    ...report.items.map(
      (i) => `- **[${i.severity.toUpperCase()}]** \`${i.path}\`: ${i.reason} (\`${i.before ?? ''}\` → \`${i.after ?? ''}\`)`,
    ),
    '',
    '## Migration Checklist',
    ...report.checklist.map((c) => `- [ ] (${c.severity.toUpperCase()}) \`${c.path}\`: ${c.text}`),
  ];
  return lines.join('\n') + '\n';
}

export const SCHEMA_DRIFT_PRESETS = [
  {
    id: 'openapi-billing',
    name: 'Billing API OpenAPI Drift',
    before: JSON.stringify(
      {
        openapi: '3.1.0',
        components: {
          schemas: {
            CreateInvoiceRequest: {
              type: 'object',
              required: ['customerId', 'amountCents', 'currency'],
              properties: {
                customerId: { type: 'string' },
                amountCents: { type: 'integer' },
                currency: { type: 'string', enum: ['USD', 'EUR', 'KRW'] },
                legacyPlanCode: { type: 'string' },
                taxExempt: { type: 'boolean' },
              },
            },
          },
        },
      },
      null,
      2,
    ),
    after: JSON.stringify(
      {
        openapi: '3.1.0',
        components: {
          schemas: {
            CreateInvoiceRequest: {
              type: 'object',
              required: ['customerId', 'amountCents', 'currency', 'idempotencyKey'],
              properties: {
                customerId: { type: 'string' },
                amountCents: { type: 'string' },
                currency: { type: 'string', enum: ['USD', 'EUR', 'JPY'] },
                idempotencyKey: { type: 'string' },
                taxExempt: { type: 'boolean' },
                metadata: { type: 'object' },
              },
            },
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'ts-session',
    name: 'Auth Session TS Contract',
    before: `export interface SessionClaims {
  sub: string;
  orgId: string;
  role: 'admin' | 'member';
  exp: number;
  deviceId?: string;
}`,
    after: `export interface SessionClaims {
  sub: string;
  orgId: string;
  roles: string[];
  keyId: string;
  exp: number;
  deviceId: string;
  amr?: string[];
}`,
  },
  {
    id: 'json-webhook',
    name: 'Webhook Payload JSON Schema',
    before: JSON.stringify(
      {
        type: 'object',
        required: ['eventId', 'type', 'createdAt'],
        properties: {
          eventId: { type: 'string' },
          type: { type: 'string', enum: ['payment.succeeded', 'payment.failed'] },
          createdAt: { type: 'integer' },
          retryCount: { type: 'integer' },
        },
      },
      null,
      2,
    ),
    after: JSON.stringify(
      {
        type: 'object',
        required: ['eventId', 'type', 'createdAt'],
        properties: {
          eventId: { type: 'string' },
          type: { type: 'string', enum: ['payment.succeeded', 'payment.failed', 'payment.refunded'] },
          createdAt: { type: 'string' },
          retryCount: { type: 'integer' },
          signatureVersion: { type: 'string' },
        },
      },
      null,
      2,
    ),
  },
] as const;
