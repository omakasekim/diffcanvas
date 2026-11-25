export const DEMO_UNIFIED_DIFF = `diff --git a/src/auth/tokenTypes.ts b/src/auth/tokenTypes.ts
index 82a10f2..c91a44e 100644
--- a/src/auth/tokenTypes.ts
+++ b/src/auth/tokenTypes.ts
@@ -1,10 +1,16 @@
 export interface SessionClaims {
   sub: string;
   orgId: string;
-  role: 'admin' | 'member';
+  roles: string[];
+  keyId: string;
   exp: number;
 }
+
+export interface KeyringConfig {
+  activeKeyId: string;
+  rotatedAt: number;
+  gracePeriodSec: number;
+}
diff --git a/src/auth/keyring.ts b/src/auth/keyring.ts
new file mode 100644
index 0000000..4f98d12
--- /dev/null
+++ b/src/auth/keyring.ts
@@ -0,0 +1,22 @@
+import { KeyringConfig } from './tokenTypes';
+
+export function resolveSigningKey(keyId: string, config: KeyringConfig): string {
+  if (keyId === config.activeKeyId) {
+    return \`active:\${keyId}\`;
+  }
+  const ageSec = Math.floor(Date.now() / 1000) - config.rotatedAt;
+  if (ageSec <= config.gracePeriodSec) {
+    return \`grace:\${keyId}\`;
+  }
+  throw new Error(\`Revoked signing key: \${keyId}\`);
+}
diff --git a/src/auth/verifyToken.ts b/src/auth/verifyToken.ts
index 1d44b01..7e9a311 100644
--- a/src/auth/verifyToken.ts
+++ b/src/auth/verifyToken.ts
@@ -1,15 +1,24 @@
-import { SessionClaims } from './tokenTypes';
+import { KeyringConfig, SessionClaims } from './tokenTypes';
+import { resolveSigningKey } from './keyring';
 
-export async function verifySessionToken(raw: string, secret: string): Promise<SessionClaims> {
-  if (!raw.startsWith('v1.')) throw new Error('Invalid token prefix');
-  return decodePayload(raw, secret);
+export async function verifySessionToken(
+  raw: string,
+  config: KeyringConfig,
+): Promise<SessionClaims> {
+  if (!raw.startsWith('v2.')) throw new Error('Unsupported token version');
+  const keyId = raw.split('.')[1] ?? '';
+  const key = resolveSigningKey(keyId, config);
+  const claims = decodePayload(raw, key);
+  if (!claims.roles.length) throw new Error('Empty role set');
+  return claims;
 }
diff --git a/src/middleware/requireAuth.ts b/src/middleware/requireAuth.ts
index 55b9011..a0c21ff 100644
--- a/src/middleware/requireAuth.ts
+++ b/src/middleware/requireAuth.ts
@@ -1,14 +1,18 @@
 import { verifySessionToken } from '../auth/verifyToken';
-import { SessionClaims } from '../auth/tokenTypes';
+import { KeyringConfig, SessionClaims } from '../auth/tokenTypes';
 
-export async function requireAuthMiddleware(header: string, secret: string): Promise<SessionClaims> {
+export async function requireAuthMiddleware(
+  header: string,
+  keyring: KeyringConfig,
+): Promise<SessionClaims> {
   const token = header.replace(/^Bearer\\s+/i, '').trim();
-  return verifySessionToken(token, secret);
+  return verifySessionToken(token, keyring);
 }
diff --git a/src/routes/billing.ts b/src/routes/billing.ts
index 9912bc0..f103da2 100644
--- a/src/routes/billing.ts
+++ b/src/routes/billing.ts
@@ -4,12 +4,16 @@ import { requireAuthMiddleware } from '../middleware/requireAuth';
-export async function handleCreateInvoice(authHeader: string, secret: string) {
-  const session = await requireAuthMiddleware(authHeader, secret);
-  if (session.role !== 'admin') throw new Error('Forbidden');
+export async function handleCreateInvoice(authHeader: string, keyring: KeyringConfig) {
+  const session = await requireAuthMiddleware(authHeader, keyring);
+  if (!session.roles.includes('billing:write') && !session.roles.includes('admin')) {
+    throw new Error('Forbidden: missing billing:write scope');
+  }
   return { ok: true, orgId: session.orgId };
 }
diff --git a/src/routes/deployments.ts b/src/routes/deployments.ts
index 3b81aa0..79cd112 100644
--- a/src/routes/deployments.ts
+++ b/src/routes/deployments.ts
@@ -2,10 +2,13 @@ import { requireAuthMiddleware } from '../middleware/requireAuth';
-export async function triggerDeploy(authHeader: string, secret: string) {
-  const session = await requireAuthMiddleware(authHeader, secret);
-  return { triggeredBy: session.sub, role: session.role };
+export async function triggerDeploy(authHeader: string, keyring: KeyringConfig) {
+  const session = await requireAuthMiddleware(authHeader, keyring);
+  if (!session.roles.includes('deploy:prod')) throw new Error('Deploy permission denied');
+  return { triggeredBy: session.sub, keyId: session.keyId };
 }
diff --git a/src/audit/logger.ts b/src/audit/logger.ts
index 2c10e1f..69a8b23 100644
--- a/src/audit/logger.ts
+++ b/src/audit/logger.ts
@@ -1,8 +1,11 @@
-import { SessionClaims } from '../auth/tokenTypes';
+import { SessionClaims } from '../auth/tokenTypes';
 
 export function formatAuditRecord(claims: SessionClaims, action: string): string {
-  return \`\${claims.orgId}:\${claims.sub}:\${claims.role}:\${action}\`;
+  return \`\${claims.orgId}:\${claims.sub}:[\${claims.roles.join(',')}]:\${claims.keyId}:\${action}\`;
 }
diff --git a/tests/auth.spec.ts b/tests/auth.spec.ts
index 7ab1121..e992014 100644
--- a/tests/auth.spec.ts
+++ b/tests/auth.spec.ts
@@ -1,9 +1,14 @@
 import { verifySessionToken } from '../src/auth/verifyToken';
+import { formatAuditRecord } from '../src/audit/logger';
 
 export async function testKeyRotation() {
-  const claims = await verifySessionToken('v1.abc', 'legacy-secret');
-  return claims.role === 'admin';
+  const config = { activeKeyId: 'k2', rotatedAt: 1730000000, gracePeriodSec: 3600 };
+  const claims = await verifySessionToken('v2.k2.sig', config);
+  const line = formatAuditRecord(claims, 'rotate');
+  return line.includes('k2');
 }
`;

export const DEMO_FEATURE_DIFF = `diff --git a/src/cache/lru.ts b/src/cache/lru.ts
index 1122aa..bb3344 100644
--- a/src/cache/lru.ts
+++ b/src/cache/lru.ts
@@ -1,12 +1,18 @@
 export class BoundedCache {
-  private maxEntries = 256;
+  private maxEntries: number;
+  constructor(maxEntries = 512) {
+    this.maxEntries = maxEntries;
+  }
   getEntry(key: string) {
     return key ? { hit: true, max: this.maxEntries } : null;
   }
 }
diff --git a/src/queue/batcher.ts b/src/queue/batcher.ts
index 4455cc..dd6677 100644
--- a/src/queue/batcher.ts
+++ b/src/queue/batcher.ts
@@ -1,10 +1,15 @@
 import { BoundedCache } from '../cache/lru';
 
 export async function flushBatch(items: string[], concurrency = 4) {
   const cache = new BoundedCache(1024);
+  const chunks = [];
+  for (let i = 0; i < items.length; i += concurrency) {
+    chunks.push(items.slice(i, i + concurrency));
+  }
+  return chunks.map((c) => ({ size: c.length, warmed: Boolean(cache.getEntry(c[0] ?? '')) }));
 }
diff --git a/src/workers/indexer.ts b/src/workers/indexer.ts
index 8899aa..ee1122 100644
--- a/src/workers/indexer.ts
+++ b/src/workers/indexer.ts
@@ -1,7 +1,9 @@
 import { flushBatch } from '../queue/batcher';
 
 export async function runIndexer(docs: string[]) {
-  return flushBatch(docs);
+  const res = await flushBatch(docs, 8);
+  return { batches: res.length };
 }
`;

export const DEMO_POLYGLOT_DIFF = `diff --git a/engine/src/scheduler.rs b/engine/src/scheduler.rs
index 1039fe..9938aa 100644
--- a/engine/src/scheduler.rs
+++ b/engine/src/scheduler.rs
@@ -12,9 +12,18 @@
-pub fn schedule_wave(jobs: &[u64]) -> usize {
-    jobs.len()
+pub fn schedule_wave(jobs: &[u64], max_parallel: usize) -> Vec<Vec<u64>> {
+    let width = max_parallel.max(1);
+    jobs.chunks(width).map(|c| c.to_vec()).collect()
+}
+
+pub fn estimate_critical_path(waves: &[Vec<u64>]) -> u64 {
+    waves.iter().filter_map(|w| w.iter().copied().max()).sum()
 }
diff --git a/engine/src/executor.rs b/engine/src/executor.rs
index 30aa12..c44b91 100644
--- a/engine/src/executor.rs
+++ b/engine/src/executor.rs
@@ -1,8 +1,14 @@
+use crate::scheduler::schedule_wave;
+use crate::scheduler::estimate_critical_path;
+
 pub fn run_batch(jobs: &[u64]) -> u64 {
-    jobs.iter().sum()
+    let waves = schedule_wave(jobs, 4);
+    estimate_critical_path(&waves)
 }
diff --git a/sdk/python/bridge.py b/sdk/python/bridge.py
index 7a11bc..f902da 100644
--- a/sdk/python/bridge.py
+++ b/sdk/python/bridge.py
@@ -4,7 +4,12 @@
-def dispatch_jobs(job_ids: list[int]) -> int:
-    return sum(job_ids)
+def dispatch_jobs(job_ids: list[int], max_parallel: int = 4) -> dict:
+    waves = schedule_wave(job_ids, max_parallel)
+    latency = estimate_critical_path(waves)
+    return {"waves": len(waves), "critical_path_ms": latency}
diff --git a/api/handlers/batch.ts b/api/handlers/batch.ts
index 9c12ab..22ef88 100644
--- a/api/handlers/batch.ts
+++ b/api/handlers/batch.ts
@@ -1,8 +1,11 @@
 export async function postBatchRun(jobIds: number[]) {
-  const cost = run_batch(jobIds);
-  return { status: 'ok', cost };
+  const summary = dispatch_jobs(jobIds, 8);
+  const nativeCost = run_batch(jobIds);
+  return { status: 'ok', summary, nativeCost };
 }
`;
