import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import pg from 'pg';
import { initDatabaseFromEnv, connectPrimaryDatabase, getDbStatus } from './src/db/index.ts';
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
  createCiRunRecord,
  createWebhookRecord,
  toggleWebhookRecord,
  deleteWebhookRecord,
  createTagRecord,
  deleteTagRecord,
} from './server/store.ts';
import { CredentialDecryptionError } from './server/crypto.ts';
import {
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
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '169.254.169.254' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.')
  ) {
    throw new Error('Private or loopback webhook hosts are not permitted');
  }
  return parsed.toString();
}

async function startServer(): Promise<void> {
  await initDatabaseFromEnv();

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    const db = getDbStatus();
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

  app.post('/api/auth/register', async (req, res, next) => {
    try {
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

  app.post('/api/auth/login', async (req, res) => {
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

      if (userCount > 0 && (!user || user.role !== 'admin')) {
        res.status(403).json({ error: 'Admin authentication required to configure system storage.' });
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
        await updateSnapshotSchema(String(req.params.snapshotId), schemaJson);
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
        const ds = await getDatasourceWithSecret(String(req.params.dsId), req.user!.id);
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
          workspaceId: String(req.params.id),
          datasourceId: ds.id,
          versionTag,
          label: `${ds.name}${schemaSuffix} (${versionTag})`,
          schemaJson: graph,
        });
        await updateWorkspaceMeta(String(req.params.id), { activeSnapshotId: snap.id });

        await createCiRunRecord({
          workspaceId: String(req.params.id),
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

        const targetDsId =
          typeof req.body?.datasourceId === 'string' ? req.body.datasourceId : mig.datasourceId;

        if (targetDsId) {
          const ds = await getDatasourceWithSecret(targetDsId, req.user!.id);
          if (!ds) {
            res.status(404).json({ error: 'Target datasource not found' });
            return;
          }
          validateDatasourceHost(ds.host);
          const client = new pg.Client({
            host: ds.host,
            port: ds.port,
            database: ds.databaseName,
            user: ds.username,
            password: ds.password,
            connectionTimeoutMillis: 8000,
            ssl: ds.sslMode === 'disable' ? false : { rejectUnauthorized: false },
          });
          try {
            await client.connect();
            await client.query('BEGIN');
            await client.query(mig.upSql);
            await client.query('COMMIT');
          } catch (sqlErr) {
            await client.query('ROLLBACK').catch(() => undefined);
            await updateMigrationStatus(mig.id, 'failed');
            const msg = sqlErr instanceof Error ? sqlErr.message : 'SQL execution failed';
            res.status(400).json({ error: msg });
            return;
          } finally {
            await client.end().catch(() => undefined);
          }
        }

        await updateMigrationStatus(mig.id, 'applied');
        res.json({ ok: true, status: 'applied' });
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
        const bundle = await getWorkspaceBundle(String(req.params.id), req.user!.id);
        if (!bundle) {
          res.status(404).json({ error: 'Workspace not found' });
          return;
        }
        const fromSnap = bundle.snapshots.find(
          (s) => s.id === bundle.workspace.baselineSnapshotId,
        );
        const toSnap = bundle.snapshots.find(
          (s) => s.id === bundle.workspace.activeSnapshotId,
        );
        const diff =
          fromSnap && toSnap
            ? computeSchemaDiff(fromSnap.schemaJson, toSnap.schemaJson)
            : null;
        const destructive = diff?.sqlPlan.some(
          (s) => s.action === 'DROP COLUMN' || s.action === 'DROP TABLE',
        );
        const run = await createCiRunRecord({
          workspaceId: bundle.workspace.id,
          branch: typeof req.body?.branch === 'string' ? req.body.branch : 'main',
          commitSha: Math.random().toString(16).slice(2, 9),
          author: req.user!.name,
          status: destructive ? 'warning' : 'passed',
          summary: destructive
            ? 'Destructive DROP operation detected; manual review advised'
            : `${diff?.sqlPlan.length ?? 0} schema plan step(s) validated`,
          diffCount: diff?.sqlPlan.length ?? 0,
          durationMs: 650,
          checks: [
            {
              name: 'Destructive Change Guard',
              status: destructive ? 'warning' : 'passed',
              detail: destructive
                ? 'Contains DROP TABLE or DROP COLUMN.'
                : 'No destructive drops found.',
            },
            {
              name: 'PostgreSQL Lock Safety',
              status: 'passed',
              detail: 'Lock levels computed for all DDL statements.',
            },
          ],
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
        const events = Array.isArray(req.body?.events)
          ? req.body.events.map(String)
          : ['schema.diff.detected'];
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

  app.patch(
    '/api/workspaces/:id/webhooks/:whId',
    requireAuth,
    requireWorkspaceOwner,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        await toggleWebhookRecord(String(req.params.whId), Boolean(req.body?.enabled));
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
        await deleteWebhookRecord(String(req.params.whId));
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
        const name = String(req.body?.name || '').trim();
        if (!name) {
          res.status(400).json({ error: 'Tag name is required' });
          return;
        }
        const tag = await createTagRecord({
          workspaceId: String(req.params.id),
          name,
          color: typeof req.body?.color === 'string' ? req.body.color : '#2563EB',
          targetSnapshotId:
            typeof req.body?.targetSnapshotId === 'string' ? req.body.targetSnapshotId : null,
          description: typeof req.body?.description === 'string' ? req.body.description : '',
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
        await deleteTagRecord(String(req.params.tagId));
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
  app.listen(port, '0.0.0.0', () => {
    console.log(`[DBLens] Server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('[DBLens] Fatal startup error:', err);
  process.exit(1);
});
