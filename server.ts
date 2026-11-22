import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';
import {
  initDatabaseFromEnv,
  connectPrimaryDatabase,
  closePrimaryDatabase,
  getDbStatus,
  getPool,
} from './src/db/index.ts';
import {
  getPublicDemoBundle,
  getUserCount,
  registerUser,
  loginUser,
  verifySessionToken,
  revokeSessionToken,
  listWorkspacesForUser,
  createWorkspaceForUser,
  getWorkspaceBundle,
  verifyWorkspaceOwnership,
  updateWorkspaceMeta,
  createSnapshot,
  updateSnapshotSchema,
  createDatasource,
  getDatasourceWithSecret,
  getDatasourceMeta,
  updateDatasourcePassword,
  updateDatasourceStatus,
  deleteDatasource,
  createMigrationRecord,
  updateMigrationStatus,
  deleteMigrationRecord,
  createCiRunRecord,
  createWebhookRecord,
  getWebhookById,
  toggleWebhookRecord,
  deleteWebhookRecord,
  listEnabledWebhooksForEvent,
  markWebhookTriggered,
  createTagRecord,
  deleteTagRecord,
} from './server/store.ts';
import { CredentialDecryptionError } from './server/crypto.ts';
import {
  connectPostgresClient,
  testPostgresConnection,
  listPostgresSchemas,
  introspectPostgresSchema,
  validateDatasourceHost,
} from './server/introspect.ts';
import { computeSchemaDiff } from './server/diffEngine.ts';
import type { AuthUserDTO, SchemaGraph } from './src/types/schema.ts';

interface AuthenticatedRequest extends Request {
  user?: AuthUserDTO;
  authToken?: string;
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const user = await verifySessionToken(token);
    if (!user) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }
    req.user = user;
    req.authToken = token;
    next();
  } catch (err) {
    next(err);
  }
}

async function requireWorkspaceOwner(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const workspaceId = String(req.params.id || '');
    const owns = await verifyWorkspaceOwnership(workspaceId, req.user.id);
    if (!owns) {
      res.status(403).json({ error: 'Workspace access denied' });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}

function validateWebhookUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Webhook URL must use http or https');
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '0.0.0.0' ||
    host === '::' ||
    host === '::1' ||
    host === 'metadata.google.internal' ||
    host === 'metadata.goog'
  ) {
    throw new Error('Private or loopback webhook hosts are not permitted');
  }
  if (net.isIPv4(host)) {
    const parts = host.split('.').map(Number);
    const [a, b] = parts;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      throw new Error('Private or loopback webhook IP addresses are not permitted');
    }
  }
  if (net.isIPv6(host)) {
    if (
      host.startsWith('fe80:') ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('::ffff:')
    ) {
      throw new Error('Private or link-local IPv6 webhook addresses are not permitted');
    }
  }
  return parsed.toString();
}

async function dispatchWorkspaceWebhooks(
  workspaceId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const hooks = await listEnabledWebhooksForEvent(workspaceId, event);
    if (hooks.length === 0) return;
    await Promise.allSettled(
      hooks.map(async (wh) => {
        const safeUrl = validateWebhookUrl(wh.url);
        const res = await fetch(safeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-DBLens-Event': event,
          },
          body: JSON.stringify({
            event,
            workspaceId,
            timestamp: new Date().toISOString(),
            ...payload,
          }),
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          await markWebhookTriggered(wh.id);
        }
      }),
    );
  } catch (err) {
    console.warn('[DBLens Webhook Dispatch Warning]', err);
  }
}

const authRateBuckets = new Map<string, { count: number; resetAt: number }>();
function checkAuthRateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maxAttempts = 25;
  const current = authRateBuckets.get(ip);
  if (!current || current.resetAt <= now) {
    authRateBuckets.set(ip, { count: 1, resetAt: now + windowMs });
    next();
    return;
  }
  if (current.count >= maxAttempts) {
    res.status(429).json({ error: 'Too many authentication attempts. Please try again later.' });
    return;
  }
  current.count += 1;
  next();
}

async function startServer(): Promise<void> {
  await initDatabaseFromEnv();

  if (
    process.env.NODE_ENV === 'production' &&
    !process.env.DATASOURCE_ENCRYPTION_KEY?.trim()
  ) {
    console.warn(
      '[DBLens] Warning: DATASOURCE_ENCRYPTION_KEY is not set in production. Set a static key so encrypted datasource credentials remain consistent across restarts.',
    );
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    next();
  });
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', async (_req, res) => {
    const db = getDbStatus();
    if (db.mode === 'postgresql') {
      const pool = getPool();
      try {
        await pool?.query('SELECT 1');
        res.json({ ok: true, storageMode: db.mode, label: db.label });
        return;
      } catch {
        res.status(503).json({
          ok: false,
          storageMode: db.mode,
          error: 'PostgreSQL health check failed',
        });
        return;
      }
    }
    res.json({ ok: true, storageMode: db.mode, label: db.label });
  });

  app.get('/api/preview', (_req, res) => {
    res.json(getPublicDemoBundle());
  });

  app.get('/api/auth/status', async (_req, res, next) => {
    try {
      const count = await getUserCount();
      const db = getDbStatus();
      res.json({
        hasUsers: count > 0,
        storageMode: db.mode,
        dbLabel: db.label,
        dbError: db.lastError,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/register', checkAuthRateLimit, async (req, res) => {
    try {
      const existingUsers = await getUserCount();
      if (existingUsers > 0 && process.env.DISABLE_SIGNUP === 'true') {
        res.status(403).json({ error: 'Public registration is disabled by administrator.' });
        return;
      }
      const email = typeof req.body?.email === 'string' ? req.body.email : '';
      const name = typeof req.body?.name === 'string' ? req.body.name : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!email.includes('@') || name.trim().length < 2 || password.length < 8) {
        res.status(400).json({
          error: 'Valid email, name (min 2 chars), and password (min 8 chars) are required.',
        });
        return;
      }
      const result = await registerUser({ email, name, password });
      res.status(201).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Registration failed';
      res.status(400).json({ error: msg });
    }
  });

  app.post('/api/auth/login', checkAuthRateLimit, async (req, res) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
      }
      const result = await loginUser({ email, password });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid credentials';
      res.status(401).json({ error: msg });
    }
  });

  app.post('/api/auth/logout', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (req.authToken) {
        await revokeSessionToken(req.authToken);
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    res.json({ user: req.user });
  });

  // Connect or switch primary PostgreSQL storage backend via Drizzle ORM
  app.post('/api/system/connect-db', async (req: AuthenticatedRequest, res) => {
    try {
      const userCount = await getUserCount();
      const token = extractBearerToken(req);
      const user = token ? await verifySessionToken(token) : null;
      const requireAdminAlways = process.env.NODE_ENV === 'production' || userCount > 0;

      if (requireAdminAlways && (!user || user.role !== 'admin')) {
        res.status(403).json({
          error:
            userCount === 0
              ? 'Please register the initial Admin account before configuring system PostgreSQL storage.'
              : 'Admin authentication required to configure system storage.',
        });
        return;
      }

      const host = typeof req.body?.host === 'string' ? req.body.host.trim() : '';
      const port = Number(req.body?.port || 5432);
      const database = typeof req.body?.database === 'string' ? req.body.database.trim() : '';
      const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const sslMode =
        req.body?.sslMode === 'disable' || req.body?.sslMode === 'prefer'
          ? req.body.sslMode
          : 'require';

      if (!host || !database || !username || !password) {
        res.status(400).json({ error: 'Host, database, username, and password are required.' });
        return;
      }

      validateDatasourceHost(host);
      const result = await connectPrimaryDatabase({
        host,
        port,
        database,
        user: username,
        password,
        sslMode,
      });
      if (!result.ok) {
        res.status(400).json({ error: result.error || 'PostgreSQL connection failed' });
        return;
      }
      res.json({ ok: true, storageMode: 'postgresql', label: result.label });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid PostgreSQL configuration';
      res.status(400).json({ error: msg });
    }
  });

  app.get('/api/workspaces', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const list = await listWorkspacesForUser(req.user!.id);
      res.json({ workspaces: list });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/workspaces', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const orgSlug =
        typeof req.body?.orgSlug === 'string' && req.body.orgSlug.trim()
          ? req.body.orgSlug.trim()
          : 'never-before-seen';
      const name =
        typeof req.body?.name === 'string' && req.body.name.trim()
          ? req.body.name.trim()
          : 'New Schema';
      const seedDemo = Boolean(req.body?.seedDemo);
      const ws = await createWorkspaceForUser(req.user!.id, orgSlug, name, seedDemo);
      res.status(201).json({ workspace: ws });
    } catch (err) {
      next(err);
    }
  });

  app.get(
    '/api/workspaces/:id/bundle',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const bundle = await getWorkspaceBundle(String(req.params.id), req.user!.id);
        if (!bundle) {
          res.status(404).json({ error: 'Workspace not found' });
          return;
        }
        res.json(bundle);
      } catch (err) {
        next(err);
      }
    },
  );

  app.patch(
    '/api/workspaces/:id',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const patch: {
          orgSlug?: string;
          name?: string;
          baselineSnapshotId?: string;
          activeSnapshotId?: string;
        } = {};
        if (typeof req.body?.orgSlug === 'string') patch.orgSlug = req.body.orgSlug.trim();
        if (typeof req.body?.name === 'string') patch.name = req.body.name.trim();
        if (typeof req.body?.baselineSnapshotId === 'string') {
          patch.baselineSnapshotId = req.body.baselineSnapshotId;
        }
        if (typeof req.body?.activeSnapshotId === 'string') {
          patch.activeSnapshotId = req.body.activeSnapshotId;
        }
        await updateWorkspaceMeta(String(req.params.id), patch);
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    '/api/workspaces/:id/snapshots',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const versionTag =
          typeof req.body?.versionTag === 'string' && req.body.versionTag.trim()
            ? req.body.versionTag.trim()
            : new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const label =
          typeof req.body?.label === 'string' && req.body.label.trim()
            ? req.body.label.trim()
            : `Snapshot ${versionTag}`;
        const schemaJson = req.body?.schemaJson as SchemaGraph;
        if (!schemaJson || !Array.isArray(schemaJson.nodes)) {
          res.status(400).json({ error: 'Valid schemaJson is required' });
          return;
        }
        const snap = await createSnapshot({
          workspaceId: String(req.params.id),
          datasourceId:
            typeof req.body?.datasourceId === 'string' ? req.body.datasourceId : null,
          versionTag,
          label,
          schemaJson,
        });
        if (req.body?.setActive !== false) {
          await updateWorkspaceMeta(String(req.params.id), { activeSnapshotId: snap.id });
        }
        res.status(201).json({ snapshot: snap });
      } catch (err) {
        next(err);
      }
    },
  );

  app.put(
    '/api/workspaces/:id/snapshots/:snapshotId',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const schemaJson = req.body?.schemaJson as SchemaGraph;
        if (!schemaJson || !Array.isArray(schemaJson.nodes)) {
          res.status(400).json({ error: 'Valid schemaJson is required' });
          return;
        }
        const workspaceId = String(req.params.id);
        const updated = await updateSnapshotSchema(
          workspaceId,
          String(req.params.snapshotId),
          schemaJson,
        );
        if (!updated) {
          res.status(404).json({ error: 'Snapshot not found in this workspace' });
          return;
        }
        void dispatchWorkspaceWebhooks(workspaceId, 'schema.diff.detected', {
          snapshotId: String(req.params.snapshotId),
          nodeCount: schemaJson.nodes.length,
        });
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },
  );

  // Test arbitrary PostgreSQL datasource credentials without saving
  app.post(
    '/api/workspaces/:id/datasources/test',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res) => {
      try {
        const host = String(req.body?.host || '').trim();
        const port = Number(req.body?.port || 5432);
        const databaseName = String(req.body?.databaseName || '').trim();
        const username = String(req.body?.username || '').trim();
        const password = String(req.body?.password || '');
        const sslMode =
          req.body?.sslMode === 'disable' || req.body?.sslMode === 'prefer'
            ? req.body.sslMode
            : 'require';
        if (!host || !databaseName || !username || !password) {
          res.status(400).json({ error: 'Host, database name, username, and password are required.' });
          return;
        }
        const result = await testPostgresConnection({
          host,
          port,
          databaseName,
          username,
          password,
          sslMode,
        });
        res.json({ ok: true, ...result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Connection failed';
        res.status(400).json({ ok: false, error: msg });
      }
    },
  );

  app.post(
    '/api/workspaces/:id/datasources',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res) => {
      try {
        const name = String(req.body?.name || '').trim();
        const host = String(req.body?.host || '').trim();
        const port = Number(req.body?.port || 5432);
        const databaseName = String(req.body?.databaseName || '').trim();
        const username = String(req.body?.username || '').trim();
        const password = String(req.body?.password || '');
        const sslMode =
          req.body?.sslMode === 'disable' || req.body?.sslMode === 'prefer'
            ? req.body.sslMode
            : 'require';

        if (!name || !host || !databaseName || !username || !password) {
          res.status(400).json({ error: 'All datasource fields are required.' });
          return;
        }

        validateDatasourceHost(host);

        let status: 'connected' | 'error' = 'connected';
        let lastError: string | null = null;
        try {
          await testPostgresConnection({
            host,
            port,
            databaseName,
            username,
            password,
            sslMode,
          });
        } catch (err) {
          status = 'error';
          lastError = err instanceof Error ? err.message : 'Connection failed';
        }

        const ds = await createDatasource({
          workspaceId: String(req.params.id),
          ownerId: req.user!.id,
          name,
          host,
          port,
          databaseName,
          username,
          password,
          sslMode,
          status,
          lastError,
        });

        res.status(201).json({ datasource: ds });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to create datasource';
        res.status(400).json({ error: msg });
      }
    },
  );

  app.patch(
    '/api/workspaces/:id/datasources/:dsId',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res) => {
      try {
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        if (!password) {
          res.status(400).json({ error: 'Password is required to update credentials.' });
          return;
        }
        const meta = await getDatasourceMeta(String(req.params.dsId), req.user!.id);
        if (!meta) {
          res.status(404).json({ error: 'Datasource not found' });
          return;
        }
        try {
          const info = await testPostgresConnection({
            host: meta.host,
            port: meta.port,
            databaseName: meta.databaseName,
            username: meta.username,
            password,
            sslMode: meta.sslMode,
          });
          await updateDatasourcePassword(meta.id, req.user!.id, password, 'connected', null);
          res.json({ ok: true, ...info });
        } catch (connErr) {
          const msg = connErr instanceof Error ? connErr.message : 'Connection failed';
          await updateDatasourcePassword(meta.id, req.user!.id, password, 'error', msg);
          res.status(400).json({ ok: false, error: msg });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to update datasource';
        res.status(400).json({ error: msg });
      }
    },
  );

  app.post(
    '/api/workspaces/:id/datasources/:dsId/test',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res) => {
      try {
        const ds = await getDatasourceWithSecret(String(req.params.dsId), req.user!.id);
        if (!ds) {
          res.status(404).json({ error: 'Datasource not found' });
          return;
        }
        try {
          const result = await testPostgresConnection(ds);
          await updateDatasourceStatus(ds.id, {
            status: 'connected',
            lastError: null,
            lastTestedAt: new Date(),
          });
          res.json({ ok: true, ...result });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Connection failed';
          await updateDatasourceStatus(ds.id, {
            status: 'error',
            lastError: msg,
            lastTestedAt: new Date(),
          });
          res.status(400).json({ ok: false, error: msg });
        }
      } catch (err) {
        if (err instanceof CredentialDecryptionError) {
          res.status(409).json({ ok: false, code: 'CREDENTIALS_NEED_UPDATE', error: err.message });
          return;
        }
        const msg = err instanceof Error ? err.message : 'Test failed';
        res.status(400).json({ error: msg });
      }
    },
  );

  app.get(
    '/api/workspaces/:id/datasources/:dsId/schemas',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res) => {
      try {
        const ds = await getDatasourceWithSecret(String(req.params.dsId), req.user!.id);
        if (!ds) {
          res.status(404).json({ error: 'Datasource not found' });
          return;
        }
        const schemas = await listPostgresSchemas(ds);
        res.json({ schemas });
      } catch (err) {
        if (err instanceof CredentialDecryptionError) {
          res.status(409).json({ ok: false, code: 'CREDENTIALS_NEED_UPDATE', error: err.message });
          return;
        }
        const msg = err instanceof Error ? err.message : 'Failed to list schemas';
        res.status(400).json({ error: msg });
      }
    },
  );

  app.post(
    '/api/workspaces/:id/datasources/:dsId/introspect',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res) => {
      try {
        const workspaceId = String(req.params.id);
        const ds = await getDatasourceWithSecret(
          String(req.params.dsId),
          req.user!.id,
          workspaceId,
        );
        if (!ds) {
          res.status(404).json({ error: 'Datasource not found' });
          return;
        }
        const schemas = Array.isArray(req.body?.schemas)
          ? req.body.schemas.map(String).filter((s: string) => s.trim().length > 0)
          : undefined;
        const graph = await introspectPostgresSchema(ds, { schemas });
        await updateDatasourceStatus(ds.id, {
          status: 'connected',
          lastError: null,
          lastIntrospectedAt: new Date(),
        });

        const versionTag = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
        const schemaSuffix = schemas && schemas.length > 0 ? ` [${schemas.join(', ')}]` : '';
        const snap = await createSnapshot({
          workspaceId,
          datasourceId: ds.id,
          versionTag,
          label: `${ds.name}${schemaSuffix} (${versionTag})`,
          schemaJson: graph,
        });
        await updateWorkspaceMeta(workspaceId, { activeSnapshotId: snap.id });

        await createCiRunRecord({
          workspaceId,
          branch: 'introspection',
          commitSha: versionTag.slice(-7),
          author: req.user!.name,
          status: 'passed',
          summary: `Introspected ${graph.nodes.length} tables/views from ${ds.name}${schemaSuffix}`,
          diffCount: graph.nodes.length,
          durationMs: 420,
          checks: [
            {
              name: 'PostgreSQL Catalog Scan',
              status: 'passed',
              detail: `Discovered ${graph.nodes.length} objects and ${graph.relations.length} relations.`,
            },
          ],
        });

        void dispatchWorkspaceWebhooks(workspaceId, 'schema.diff.detected', {
          datasourceId: ds.id,
          datasourceName: ds.name,
          snapshotId: snap.id,
          objectCount: graph.nodes.length,
        });

        res.json({ snapshot: snap, objectCount: graph.nodes.length });
      } catch (err) {
        if (err instanceof CredentialDecryptionError) {
          res.status(409).json({ ok: false, code: 'CREDENTIALS_NEED_UPDATE', error: err.message });
          return;
        }
        const msg = err instanceof Error ? err.message : 'Introspection failed';
        res.status(400).json({ error: msg });
      }
    },
  );

  app.delete(
    '/api/workspaces/:id/datasources/:dsId',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const removed = await deleteDatasource(String(req.params.dsId), req.user!.id);
        if (!removed) {
          res.status(404).json({ error: 'Datasource not found' });
          return;
        }
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    '/api/workspaces/:id/migrations',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const name = String(req.body?.name || 'schema_migration').trim();
        const upSql = String(req.body?.upSql || '').trim();
        const downSql = String(req.body?.downSql || '').trim();
        if (!upSql) {
          res.status(400).json({ error: 'Migration upSql is required.' });
          return;
        }
        const version = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        const mig = await createMigrationRecord({
          workspaceId: String(req.params.id),
          datasourceId:
            typeof req.body?.datasourceId === 'string' ? req.body.datasourceId : null,
          version,
          name,
          upSql,
          downSql,
          status: 'pending',
        });
        res.status(201).json({ migration: mig });
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    '/api/workspaces/:id/migrations/:migId/apply',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const bundle = await getWorkspaceBundle(String(req.params.id), req.user!.id);
        const mig = bundle?.migrations.find((m) => m.id === String(req.params.migId));
        if (!mig) {
          res.status(404).json({ error: 'Migration not found' });
          return;
        }

        const workspaceId = String(req.params.id);
        const targetDsId =
          typeof req.body?.datasourceId === 'string' ? req.body.datasourceId : mig.datasourceId;

        if (targetDsId) {
          const ds = await getDatasourceWithSecret(targetDsId, req.user!.id, workspaceId);
          if (!ds) {
            res.status(404).json({ error: 'Target datasource not found' });
            return;
          }
          const client = await connectPostgresClient(ds);
          try {
            await client.query('BEGIN');
            await client.query(mig.upSql);
            await client.query('COMMIT');
          } catch (sqlErr) {
            await client.query('ROLLBACK').catch(() => undefined);
            await updateMigrationStatus(workspaceId, mig.id, 'failed');
            const msg = sqlErr instanceof Error ? sqlErr.message : 'SQL execution failed';
            res.status(400).json({ error: msg });
            return;
          } finally {
            await client.end().catch(() => undefined);
          }
        }

        await updateMigrationStatus(workspaceId, mig.id, 'applied');
        void dispatchWorkspaceWebhooks(workspaceId, 'migration.applied', {
          migrationId: mig.id,
          migrationName: mig.name,
          version: mig.version,
          datasourceId: targetDsId ?? null,
        });
        res.json({ ok: true, status: 'applied' });
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    '/api/workspaces/:id/migrations/:migId/dry-run',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const workspaceId = String(req.params.id);
        const bundle = await getWorkspaceBundle(workspaceId, req.user!.id);
        const mig = bundle?.migrations.find((m) => m.id === String(req.params.migId));
        if (!mig) {
          res.status(404).json({ error: 'Migration not found' });
          return;
        }
        const targetDsId =
          typeof req.body?.datasourceId === 'string' ? req.body.datasourceId : mig.datasourceId;
        if (!targetDsId) {
          res.status(400).json({ error: 'Select a target PostgreSQL datasource to run a live SQL dry-run.' });
          return;
        }
        const ds = await getDatasourceWithSecret(targetDsId, req.user!.id, workspaceId);
        if (!ds) {
          res.status(404).json({ error: 'Target datasource not found' });
          return;
        }
        const started = Date.now();
        const client = await connectPostgresClient(ds);
        try {
          await client.query('BEGIN');
          await client.query(mig.upSql);
          await client.query('ROLLBACK');
          res.json({ ok: true, latencyMs: Date.now() - started });
        } catch (sqlErr) {
          await client.query('ROLLBACK').catch(() => undefined);
          const msg = sqlErr instanceof Error ? sqlErr.message : 'Dry-run validation failed';
          res.status(400).json({ ok: false, error: msg });
        } finally {
          await client.end().catch(() => undefined);
        }
      } catch (err) {
        if (err instanceof CredentialDecryptionError) {
          res.status(409).json({ ok: false, code: 'CREDENTIALS_NEED_UPDATE', error: err.message });
          return;
        }
        next(err);
      }
    },
  );

  app.post(
    '/api/workspaces/:id/migrations/:migId/rollback',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const workspaceId = String(req.params.id);
        const bundle = await getWorkspaceBundle(workspaceId, req.user!.id);
        const mig = bundle?.migrations.find((m) => m.id === String(req.params.migId));
        if (!mig) {
          res.status(404).json({ error: 'Migration not found' });
          return;
        }
        if (!mig.downSql.trim()) {
          res.status(400).json({ error: 'This migration has no reversible Down SQL.' });
          return;
        }
        const targetDsId =
          typeof req.body?.datasourceId === 'string' ? req.body.datasourceId : mig.datasourceId;

        if (targetDsId) {
          const ds = await getDatasourceWithSecret(targetDsId, req.user!.id, workspaceId);
          if (!ds) {
            res.status(404).json({ error: 'Target datasource not found' });
            return;
          }
          const client = await connectPostgresClient(ds);
          try {
            await client.query('BEGIN');
            await client.query(mig.downSql);
            await client.query('COMMIT');
          } catch (sqlErr) {
            await client.query('ROLLBACK').catch(() => undefined);
            const msg = sqlErr instanceof Error ? sqlErr.message : 'Rollback SQL failed';
            res.status(400).json({ error: msg });
            return;
          } finally {
            await client.end().catch(() => undefined);
          }
        }

        await updateMigrationStatus(workspaceId, mig.id, 'pending');
        void dispatchWorkspaceWebhooks(workspaceId, 'migration.rolled_back', {
          migrationId: mig.id,
          migrationName: mig.name,
          version: mig.version,
          datasourceId: targetDsId ?? null,
        });
        res.json({ ok: true, status: 'pending' });
      } catch (err) {
        if (err instanceof CredentialDecryptionError) {
          res.status(409).json({ ok: false, code: 'CREDENTIALS_NEED_UPDATE', error: err.message });
          return;
        }
        next(err);
      }
    },
  );

  app.delete(
    '/api/workspaces/:id/migrations/:migId',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const deleted = await deleteMigrationRecord(
          String(req.params.id),
          String(req.params.migId),
        );
        if (!deleted) {
          res.status(404).json({ error: 'Migration not found' });
          return;
        }
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    '/api/workspaces/:id/ci-runs',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const started = Date.now();
        const bundle = await getWorkspaceBundle(String(req.params.id), req.user!.id);
        if (!bundle) {
          res.status(404).json({ error: 'Workspace not found' });
          return;
        }
        const fromId =
          typeof req.body?.fromSnapshotId === 'string' && req.body.fromSnapshotId
            ? req.body.fromSnapshotId
            : bundle.workspace.baselineSnapshotId;
        const toId =
          typeof req.body?.toSnapshotId === 'string' && req.body.toSnapshotId
            ? req.body.toSnapshotId
            : bundle.workspace.activeSnapshotId;

        const fromSnap = bundle.snapshots.find((s) => s.id === fromId);
        const toSnap = bundle.snapshots.find((s) => s.id === toId);
        const diff =
          fromSnap && toSnap
            ? computeSchemaDiff(fromSnap.schemaJson, toSnap.schemaJson)
            : null;
        const targetGraph = toSnap?.schemaJson ?? { dialect: 'postgresql', nodes: [], relations: [] };

        // 1. Destructive Change Guard
        const dropSteps =
          diff?.sqlPlan.filter(
            (s) => s.action === 'DROP COLUMN' || s.action === 'DROP TABLE' || s.action === 'DROP VIEW',
          ) ?? [];
        const destructive = dropSteps.length > 0;

        // 2. Lock & Backfill Safety (NOT NULL ADD COLUMN without DEFAULT, or ACCESS EXCLUSIVE)
        const unsafeNotNull =
          diff?.sqlPlan.filter(
            (s) =>
              s.action === 'ADD COLUMN' &&
              s.statement.includes('NOT NULL') &&
              !s.statement.includes('DEFAULT'),
          ) ?? [];
        const exclusiveLocks =
          diff?.sqlPlan.filter((s) => s.lockLevel === 'ACCESS EXCLUSIVE') ?? [];

        // 3. Primary Key & Relation Integrity across target schema
        const tablesMissingPk = targetGraph.nodes.filter(
          (n) => n.kind === 'table' && !n.columns.some((c) => c.isPrimaryKey),
        );
        const nodeIds = new Set(targetGraph.nodes.map((n) => n.id));
        const brokenRelations = targetGraph.relations.filter(
          (r) => !nodeIds.has(r.sourceId) || !nodeIds.has(r.targetId),
        );

        // 4. View Dependency Check
        const existingKeys = new Set(
          targetGraph.nodes.map((n) => `${n.schema || 'public'}.${n.name}`),
        );
        const viewNodes = targetGraph.nodes.filter((n) => n.kind === 'view');
        const brokenViewDeps = viewNodes.filter((v) =>
          (v.dependencies ?? []).some((dep) => {
            const cleanDep = dep.includes('.') ? dep : `public.${dep}`;
            return !existingKeys.has(cleanDep) && !existingKeys.has(dep);
          }),
        );

        const checks: { name: string; status: 'passed' | 'warning' | 'failed'; detail: string }[] = [
          {
            name: 'Destructive Change Guard',
            status: destructive ? 'warning' : 'passed',
            detail: destructive
              ? `${dropSteps.length} drop statement(s): ${dropSteps.map((s) => s.target).join(', ')}`
              : 'No DROP TABLE, DROP VIEW, or DROP COLUMN statements found.',
          },
          {
            name: 'PostgreSQL Lock & Backfill Safety',
            status: unsafeNotNull.length > 0 ? 'failed' : exclusiveLocks.length > 0 ? 'warning' : 'passed',
            detail:
              unsafeNotNull.length > 0
                ? `${unsafeNotNull.length} ADD COLUMN NOT NULL without DEFAULT (will fail on non-empty tables): ${unsafeNotNull.map((s) => s.target).join(', ')}`
                : exclusiveLocks.length > 0
                  ? `${exclusiveLocks.length} statement(s) require ACCESS EXCLUSIVE lock.`
                  : 'All DDL changes avoid blocking table rewrites.',
          },
          {
            name: 'Primary Key & FK Integrity',
            status: brokenRelations.length > 0 ? 'failed' : tablesMissingPk.length > 0 ? 'warning' : 'passed',
            detail:
              brokenRelations.length > 0
                ? `${brokenRelations.length} dangling relation(s) reference missing tables.`
                : tablesMissingPk.length > 0
                  ? `${tablesMissingPk.length} table(s) have no Primary Key: ${tablesMissingPk.map((t) => t.name).join(', ')}`
                  : `All ${targetGraph.nodes.filter((n) => n.kind === 'table').length} tables and ${targetGraph.relations.length} relations verified.`,
          },
          {
            name: 'View Dependency Check',
            status: brokenViewDeps.length > 0 ? 'warning' : 'passed',
            detail:
              brokenViewDeps.length > 0
                ? `Unresolved dependencies in view(s): ${brokenViewDeps.map((v) => v.name).join(', ')}`
                : `${viewNodes.length} view(s) verified against active schema objects.`,
          },
        ];

        const hasFailed = checks.some((c) => c.status === 'failed');
        const hasWarning = checks.some((c) => c.status === 'warning');
        const overallStatus: 'passed' | 'warning' | 'failed' = hasFailed
          ? 'failed'
          : hasWarning
            ? 'warning'
            : 'passed';

        const commitSha = crypto
          .createHash('sha256')
          .update(`${fromId}:${toId}:${diff?.upSql || ''}`)
          .digest('hex')
          .slice(0, 7);

        const summary = hasFailed
          ? `${checks.filter((c) => c.status === 'failed').length} blocking schema lint error(s) detected`
          : hasWarning
            ? `${diff?.sqlPlan.length ?? 0} plan step(s) validated with warnings`
            : `${diff?.sqlPlan.length ?? 0} schema plan step(s) passed all 4 lint checks`;

        const run = await createCiRunRecord({
          workspaceId: bundle.workspace.id,
          branch: typeof req.body?.branch === 'string' && req.body.branch.trim() ? req.body.branch.trim() : 'main',
          commitSha,
          author: req.user!.name,
          status: overallStatus,
          summary,
          diffCount: diff?.sqlPlan.length ?? 0,
          durationMs: Math.max(1, Date.now() - started),
          checks,
        });

        void dispatchWorkspaceWebhooks(bundle.workspace.id, 'ci.run.completed', {
          ciRunId: run.id,
          branch: run.branch,
          status: run.status,
          summary: run.summary,
          diffCount: run.diffCount,
        });

        res.status(201).json({ ciRun: run });
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    '/api/workspaces/:id/webhooks',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res) => {
      try {
        const name = String(req.body?.name || '').trim();
        const url = validateWebhookUrl(String(req.body?.url || '').trim());
        const events = Array.isArray(req.body?.events) && req.body.events.length > 0
          ? req.body.events.map(String)
          : ['schema.diff.detected', 'migration.applied'];
        if (!name) {
          res.status(400).json({ error: 'Webhook name is required' });
          return;
        }
        const webhook = await createWebhookRecord({
          workspaceId: String(req.params.id),
          name,
          url,
          events,
        });
        res.status(201).json({ webhook });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Invalid webhook configuration';
        res.status(400).json({ error: msg });
      }
    },
  );

  app.post(
    '/api/workspaces/:id/webhooks/:whId/test',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res) => {
      try {
        const workspaceId = String(req.params.id);
        const wh = await getWebhookById(workspaceId, String(req.params.whId));
        if (!wh) {
          res.status(404).json({ error: 'Webhook not found' });
          return;
        }
        const safeUrl = validateWebhookUrl(wh.url);
        const started = Date.now();
        const response = await fetch(safeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-DBLens-Event': 'webhook.test',
          },
          body: JSON.stringify({
            event: 'webhook.test',
            workspaceId,
            webhookName: wh.name,
            timestamp: new Date().toISOString(),
            message: 'DBLens test delivery ping',
          }),
          signal: AbortSignal.timeout(6000),
        });
        const latencyMs = Date.now() - started;
        if (response.ok) {
          await markWebhookTriggered(wh.id);
        }
        res.json({
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          latencyMs,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Webhook test delivery failed';
        res.status(400).json({ ok: false, error: msg });
      }
    },
  );

  app.patch(
    '/api/workspaces/:id/webhooks/:whId',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const updated = await toggleWebhookRecord(
          String(req.params.id),
          String(req.params.whId),
          Boolean(req.body?.enabled),
        );
        if (!updated) {
          res.status(404).json({ error: 'Webhook not found' });
          return;
        }
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },
  );

  app.delete(
    '/api/workspaces/:id/webhooks/:whId',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const deleted = await deleteWebhookRecord(
          String(req.params.id),
          String(req.params.whId),
        );
        if (!deleted) {
          res.status(404).json({ error: 'Webhook not found' });
          return;
        }
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    '/api/workspaces/:id/tags',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const workspaceId = String(req.params.id);
        const name = String(req.body?.name || '').trim();
        if (!name) {
          res.status(400).json({ error: 'Tag name is required' });
          return;
        }
        const tag = await createTagRecord({
          workspaceId,
          name,
          color: typeof req.body?.color === 'string' ? req.body.color : '#2563EB',
          targetSnapshotId:
            typeof req.body?.targetSnapshotId === 'string' ? req.body.targetSnapshotId : null,
          description: typeof req.body?.description === 'string' ? req.body.description : '',
        });
        void dispatchWorkspaceWebhooks(workspaceId, 'tag.created', {
          tagId: tag.id,
          name: tag.name,
          targetSnapshotId: tag.targetSnapshotId,
        });
        res.status(201).json({ tag });
      } catch (err) {
        next(err);
      }
    },
  );

  app.delete(
    '/api/workspaces/:id/tags/:tagId',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const deleted = await deleteTagRecord(
          String(req.params.id),
          String(req.params.tagId),
        );
        if (!deleted) {
          res.status(404).json({ error: 'Tag not found' });
          return;
        }
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },
  );

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[DBLens API Error]', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build not found');
      }
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`[DBLens] Server running on http://0.0.0.0:${port}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[DBLens] Received ${signal}, shutting down gracefully...`);
    server.close(async () => {
      await closePrimaryDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 8000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('[DBLens] Fatal startup error:', err);
  process.exit(1);
});
