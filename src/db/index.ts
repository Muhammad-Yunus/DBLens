import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.ts';

export type DrizzleDB = NodePgDatabase<typeof schema>;

let activePool: pg.Pool | null = null;
let activeDb: DrizzleDB | null = null;
let activeConnectionLabel: string | null = null;
let lastDbError: string | null = null;

async function ensureSchemaTables(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "dblens_users" (
      "id" text PRIMARY KEY,
      "email" text NOT NULL UNIQUE,
      "name" text NOT NULL,
      "password_hash" text NOT NULL,
      "role" text NOT NULL DEFAULT 'member',
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS "dblens_sessions" (
      "id" text PRIMARY KEY,
      "user_id" text NOT NULL REFERENCES "dblens_users"("id") ON DELETE CASCADE,
      "token_hash" text NOT NULL UNIQUE,
      "expires_at" timestamptz NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS "dblens_workspaces" (
      "id" text PRIMARY KEY,
      "owner_id" text NOT NULL REFERENCES "dblens_users"("id") ON DELETE CASCADE,
      "org_slug" text NOT NULL DEFAULT 'never-before-seen',
      "name" text NOT NULL DEFAULT 'Inventory',
      "baseline_snapshot_id" text NOT NULL,
      "active_snapshot_id" text NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS "dblens_datasources" (
      "id" text PRIMARY KEY,
      "workspace_id" text NOT NULL REFERENCES "dblens_workspaces"("id") ON DELETE CASCADE,
      "owner_id" text NOT NULL REFERENCES "dblens_users"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "engine" text NOT NULL DEFAULT 'postgresql',
      "host" text NOT NULL,
      "port" integer NOT NULL DEFAULT 5432,
      "database_name" text NOT NULL,
      "username" text NOT NULL,
      "encrypted_password" text NOT NULL,
      "ssl_mode" text NOT NULL DEFAULT 'require',
      "status" text NOT NULL DEFAULT 'disconnected',
      "last_error" text,
      "last_tested_at" timestamptz,
      "last_introspected_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS "dblens_schema_snapshots" (
      "id" text PRIMARY KEY,
      "workspace_id" text NOT NULL REFERENCES "dblens_workspaces"("id") ON DELETE CASCADE,
      "datasource_id" text,
      "version_tag" text NOT NULL,
      "label" text NOT NULL,
      "schema_json" jsonb NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS "dblens_migrations" (
      "id" text PRIMARY KEY,
      "workspace_id" text NOT NULL REFERENCES "dblens_workspaces"("id") ON DELETE CASCADE,
      "datasource_id" text,
      "version" text NOT NULL,
      "name" text NOT NULL,
      "up_sql" text NOT NULL,
      "down_sql" text NOT NULL,
      "status" text NOT NULL DEFAULT 'pending',
      "applied_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS "dblens_ci_runs" (
      "id" text PRIMARY KEY,
      "workspace_id" text NOT NULL REFERENCES "dblens_workspaces"("id") ON DELETE CASCADE,
      "branch" text NOT NULL,
      "commit_sha" text NOT NULL,
      "author" text NOT NULL,
      "status" text NOT NULL,
      "summary" text NOT NULL,
      "diff_count" integer NOT NULL DEFAULT 0,
      "duration_ms" integer NOT NULL DEFAULT 0,
      "checks" jsonb NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS "dblens_webhooks" (
      "id" text PRIMARY KEY,
      "workspace_id" text NOT NULL REFERENCES "dblens_workspaces"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "url" text NOT NULL,
      "events" jsonb NOT NULL,
      "enabled" boolean NOT NULL DEFAULT true,
      "last_triggered_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS "dblens_tags" (
      "id" text PRIMARY KEY,
      "workspace_id" text NOT NULL REFERENCES "dblens_workspaces"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "color" text NOT NULL DEFAULT '#2563EB',
      "target_snapshot_id" text,
      "description" text NOT NULL DEFAULT '',
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export async function connectPrimaryDatabase(connectionConfig: {
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  sslMode?: 'require' | 'prefer' | 'disable';
}): Promise<{ ok: boolean; label: string; error?: string }> {
  const poolConfig: pg.PoolConfig = {
    host: connectionConfig.host,
    port: connectionConfig.port ?? 5432,
    database: connectionConfig.database,
    user: connectionConfig.user,
    password: connectionConfig.password,
    ssl:
      connectionConfig.sslMode === 'disable'
        ? false
        : { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
    max: 10,
  };

  const nextPool = new pg.Pool(poolConfig);
  try {
    await nextPool.query('SELECT 1');
    await ensureSchemaTables(nextPool);
    if (activePool) {
      await activePool.end().catch(() => undefined);
    }
    activePool = nextPool;
    activeDb = drizzle(nextPool, { schema });
    const hostLabel = `${connectionConfig.host}:${connectionConfig.port ?? 5432}/${connectionConfig.database}`;
    activeConnectionLabel = hostLabel;
    lastDbError = null;
    return { ok: true, label: hostLabel };
  } catch (err) {
    await nextPool.end().catch(() => undefined);
    const msg = err instanceof Error ? err.message : 'Failed to connect to PostgreSQL';
    lastDbError = msg;
    return { ok: false, label: '', error: msg };
  }
}

export async function initDatabaseFromEnv(): Promise<void> {
  const host = process.env.DB_HOST?.trim();
  const user = process.env.DB_USER?.trim();
  const password = process.env.DB_PASSWORD;
  const database = (process.env.DB_NAME || process.env.DB_DATABASE || 'postgres').trim();
  const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432;
  const sslModeRaw = process.env.DB_SSL_MODE?.trim();
  const sslMode: 'require' | 'prefer' | 'disable' =
    sslModeRaw === 'disable' || sslModeRaw === 'prefer' ? sslModeRaw : 'require';

  if (host && user && password && database) {
    const res = await connectPrimaryDatabase({
      host,
      port,
      user,
      password,
      database,
      sslMode,
    });
    if (!res.ok) {
      console.warn(`[DBLens] DB_* connection failed, falling back to memory store: ${res.error}`);
    } else {
      console.log(`[DBLens] Connected to PostgreSQL (${res.label}) via Drizzle ORM`);
    }
  }
}

export function getDb(): DrizzleDB | null {
  return activeDb;
}

export function getPool(): pg.Pool | null {
  return activePool;
}

export function getDbStatus(): {
  mode: 'postgresql' | 'memory';
  label: string | null;
  lastError: string | null;
} {
  return {
    mode: activeDb ? 'postgresql' : 'memory',
    label: activeConnectionLabel,
    lastError: lastDbError,
  };
}
