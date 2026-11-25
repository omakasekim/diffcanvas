export const DEMO_UNIFIED_DIFF = `diff --git a/src/auth/types.ts b/src/auth/types.ts
index 82a91cf..d4e119b 100644
--- a/src/auth/types.ts
+++ b/src/auth/types.ts
@@ -1,10 +1,16 @@
 export interface SessionClaims {
   sub: string;
-  role: 'user' | 'admin';
+  role: 'user' | 'admin' | 'service';
+  tenantId: string;
+  keyVersion: number;
   exp: number;
 }
 
 export interface VerifyResult {
   ok: boolean;
   claims?: SessionClaims;
+  reason?: 'expired' | 'revoked' | 'invalid_signature' | 'key_rotated';
 }
diff --git a/src/auth/verifyToken.ts b/src/auth/verifyToken.ts
index 1f39a01..9c42e88 100644
--- a/src/auth/verifyToken.ts
+++ b/src/auth/verifyToken.ts
@@ -1,22 +1,34 @@
 import { verifyHmacSignature } from '../crypto/hmac';
+import { isTokenRevoked } from './revocationCache';
 import type { SessionClaims, VerifyResult } from './types';
 
-export function verifyToken(token: string, secret: string): VerifyResult {
-  const parsed = verifyHmacSignature(token, secret);
-  if (!parsed) {
-    return { ok: false };
+export async function verifyToken(
+  token: string,
+  keyring: Record<number, string>,
+): Promise<VerifyResult> {
+  const parsed = verifyHmacSignature(token, keyring);
+  if (!parsed.valid) {
+    return { ok: false, reason: 'invalid_signature' };
   }
   const claims = parsed.payload as SessionClaims;
-  if (claims.exp < Date.now() / 1000) {
-    return { ok: false };
+  if (claims.exp <= Math.floor(Date.now() / 1000)) {
+    return { ok: false, reason: 'expired' };
+  }
+  if (await isTokenRevoked(claims.sub, claims.keyVersion)) {
+    return { ok: false, reason: 'revoked' };
   }
   return { ok: true, claims };
 }
diff --git a/src/crypto/hmac.ts b/src/crypto/hmac.ts
index 42b8103..e98a712 100644
--- a/src/crypto/hmac.ts
+++ b/src/crypto/hmac.ts
@@ -1,14 +1,24 @@
 import { createHmac, timingSafeEqual } from 'node:crypto';
 
-export function verifyHmacSignature(token: string, secret: string): { payload: unknown } | null {
-  const [body, sig] = token.split('.');
-  if (!body || !sig) return null;
-  const expected = createHmac('sha256', secret).update(body).digest('base64url');
-  if (sig.length !== expected.length) return null;
-  const valid = timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
-  return valid ? { payload: JSON.parse(Buffer.from(body, 'base64url').toString()) } : null;
+export function verifyHmacSignature(
+  token: string,
+  keyring: Record<number, string>,
+): { valid: boolean; payload?: unknown } {
+  const [verRaw, body, sig] = token.split('.');
+  const key = keyring[Number(verRaw)];
+  if (!key || !body || !sig) return { valid: false };
+  const expected = createHmac('sha256', key).update(body).digest('base64url');
+  if (sig.length !== expected.length) return { valid: false };
+  const valid = timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
+  if (!valid) return { valid: false };
+  return { valid: true, payload: JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) };
 }
diff --git a/src/auth/revocationCache.ts b/src/auth/revocationCache.ts
new file mode 100644
index 0000000..7ab4c10
--- /dev/null
+++ b/src/auth/revocationCache.ts
@@ -0,0 +1,18 @@
+const revokedBefore = new Map<string, number>();
+
+export function markUserKeyRevoked(userId: string, minValidVersion: number): void {
+  revokedBefore.set(userId, minValidVersion);
+}
+
+export async function isTokenRevoked(userId: string, keyVersion: number): Promise<boolean> {
+  const floor = revokedBefore.get(userId);
+  if (floor === undefined) return false;
+  return keyVersion < floor;
+}
diff --git a/src/api/authMiddleware.ts b/src/api/authMiddleware.ts
index c9912a2..740f2bc 100644
--- a/src/api/authMiddleware.ts
+++ b/src/api/authMiddleware.ts
@@ -1,14 +1,22 @@
 import { verifyToken } from '../auth/verifyToken';
 import { emitAuditLog } from '../telemetry/audit';
 
-export function requireAuth(req: Request, secret: string) {
+export async function requireAuth(req: Request, keyring: Record<number, string>) {
   const header = req.headers.get('authorization') ?? '';
   const token = header.replace(/^Bearer\\s+/i, '');
-  const res = verifyToken(token, secret);
+  const res = await verifyToken(token, keyring);
   if (!res.ok) {
-    emitAuditLog('auth.rejected', { ip: req.headers.get('x-forwarded-for') });
-    throw new Response('Unauthorized', { status: 401 });
+    emitAuditLog('auth.rejected', {
+      reason: res.reason ?? 'unknown',
+      ip: req.headers.get('x-forwarded-for'),
+    });
+    throw new Response(JSON.stringify({ error: res.reason }), { status: 401 });
   }
   return res.claims;
 }
diff --git a/src/api/billingHandler.ts b/src/api/billingHandler.ts
index a034d11..402e233 100644
--- a/src/api/billingHandler.ts
+++ b/src/api/billingHandler.ts
@@ -1,10 +1,12 @@
 import { requireAuth } from './authMiddleware';
+import { emitAuditLog } from '../telemetry/audit';
 
-export async function handleCharge(req: Request, secret: string) {
-  const claims = requireAuth(req, secret);
+export async function handleCharge(req: Request, keyring: Record<number, string>) {
+  const claims = await requireAuth(req, keyring);
   if (!claims) throw new Error('missing claims');
+  emitAuditLog('billing.charge.authorized', { sub: claims.sub, tenantId: claims.tenantId });
   return { charged: true, tenant: claims.sub };
 }
diff --git a/src/telemetry/audit.ts b/src/telemetry/audit.ts
index 558a001..91f3229 100644
--- a/src/telemetry/audit.ts
+++ b/src/telemetry/audit.ts
@@ -1,6 +1,10 @@
-export function emitAuditLog(event: string, meta: Record<string, unknown>): void {
-  console.info(JSON.stringify({ event, meta, ts: Date.now() }));
+export function emitAuditLog(
+  event: string,
+  meta: Record<string, string | number | null | undefined>,
+): void {
+  const entry = { event, meta, ts: new Date().toISOString() };
+  console.info(JSON.stringify(entry));
 }
diff --git a/test/auth.test.ts b/test/auth.test.ts
index 2190aa2..3b71981 100644
--- a/test/auth.test.ts
+++ b/test/auth.test.ts
@@ -1,7 +1,14 @@
 import { verifyToken } from '../src/auth/verifyToken';
+import { markUserKeyRevoked } from '../src/auth/revocationCache';
 
-test('rejects invalid signature', () => {
-  expect(verifyToken('bad.token', 'secret').ok).toBe(false);
+test('rejects invalid or revoked key versions', async () => {
+  const keyring = { 1: 'old-key', 2: 'active-key' };
+  const invalid = await verifyToken('2.bad.sig', keyring);
+  expect(invalid.reason).toBe('invalid_signature');
+  markUserKeyRevoked('usr_1', 2);
+  const revoked = await verifyToken('1.payload.sig', keyring);
+  expect(revoked.ok).toBe(false);
 });
`;

export const DEMO_FEATURE_DIFF = `diff --git a/src/pipeline/workerPool.ts b/src/pipeline/workerPool.ts
index 3a9c101..7c82b12 100644
--- a/src/pipeline/workerPool.ts
+++ b/src/pipeline/workerPool.ts
@@ -1,14 +1,22 @@
 import { runTask } from './taskRunner';
 
-export async function executeBatch(items: string[]) {
-  return Promise.all(items.map((item) => runTask(item)));
+export async function executeBatch(items: string[], concurrency = 4) {
+  const results: string[] = [];
+  for (let i = 0; i < items.length; i += concurrency) {
+    const chunk = items.slice(i, i + concurrency);
+    results.push(...(await Promise.all(chunk.map((item) => runTask(item)))));
+  }
+  return results;
 }
diff --git a/src/pipeline/taskRunner.ts b/src/pipeline/taskRunner.ts
index 8e12aa0..51b3d02 100644
--- a/src/pipeline/taskRunner.ts
+++ b/src/pipeline/taskRunner.ts
@@ -1,6 +1,10 @@
-export async function runTask(id: string): Promise<string> {
-  return \`done:\${id}\`;
+export async function runTask(id: string, signal?: AbortSignal): Promise<string> {
+  if (signal?.aborted) throw new Error('Task aborted');
+  return \`processed:\${id}\`;
 }
diff --git a/src/api/batchEndpoint.ts b/src/api/batchEndpoint.ts
index 1190df2..9d24a0c 100644
--- a/src/api/batchEndpoint.ts
+++ b/src/api/batchEndpoint.ts
@@ -1,7 +1,9 @@
 import { executeBatch } from '../pipeline/workerPool';
 
 export async function postBatch(ids: string[]) {
-  return executeBatch(ids);
+  const safeIds = ids.slice(0, 200);
+  return executeBatch(safeIds, 6);
 }
`;
