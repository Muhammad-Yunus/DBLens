import crypto from 'node:crypto';
import { eq, desc, and } from 'drizzle-orm';
import { getDb, getDbStatus } from '../src/db/index.ts';
import {
  users,
  sessions,
  workspaces,
  datasources,
  schemaSnapshots,
  migrations,
  ciRuns,
  webhooks,
  tags,
} from '../src/db/schema.ts';
import {
  BASELINE_INVENTORY_SCHEMA,
  TARGET_INVENTORY_SCHEMA,
  createSeedOperationalData,
} from './seedData.ts';
import {
  encryptSecret,
  decryptSecret,
  CredentialDecryptionError,
  hashPassword,
  verifyPassword,
  generateToken,
  hashToken,
} from './crypto.ts';
import type {
  AuthUserDTO,
  WorkspaceDTO,
  WorkspaceBundle,
  SchemaSnapshotDTO,
  SchemaGraph,
  DatasourceDTO,
  MigrationDTO,
  CiRunDTO,
  WebhookDTO,
  TagDTO,
} from '../src/types/schema.ts';

interface MemUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: 'admin' | 'member';
  createdAt: string;
}

interface MemSession {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: number;
}

interface MemDatasource extends DatasourceDTO {
  ownerId: string;
  encryptedPassword: string;
}

interface MemWorkspace extends WorkspaceDTO {
  ownerId: string;
}

const mem = {
  users: [] as MemUser[],
  sessions: [] as MemSession[],
  workspaces: [] as MemWorkspace[],
  datasources: [] as MemDatasource[],
  snapshots: [] as SchemaSnapshotDTO[],
  migrations: [] as MigrationDTO[],
  ciRuns: [] as CiRunDTO[],
  webhooks: [] as WebhookDTO[],
  tags: [] as TagDTO[],
};

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
}

export function getPublicDemoBundle(): WorkspaceBundle {
  const wsId = 'ws_demo_inventory';
  const baseId = 'snap_demo_20240112';
  const targetId = 'snap_demo_20240208';
  const ops = createSeedOperationalData(wsId);
  ops.tags[0].targetSnapshotId = targetId;
  ops.tags[1].targetSnapshotId = baseId;

  return {
    workspace: {
      id: wsId,
      orgSlug: 'never-before-seen',
      name: 'Inventory',
      baselineSnapshotId: baseId,
      activeSnapshotId: targetId,
      createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    },
    snapshots: [
      {
        id: baseId,
        workspaceId: wsId,
        datasourceId: null,
        versionTag: '20240112',
        label: 'From 20240112 (Baseline)',
        schemaJson: BASELINE_INVENTORY_SCHEMA,
        createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      },
      {
        id: targetId,
        workspaceId: wsId,
        datasourceId: null,
        versionTag: '20240208',
        label: 'To 20240208 (Current)',
        schemaJson: TARGET_INVENTORY_SCHEMA,
        createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
      },
    ],
    datasources: [],
    migrations: ops.migrations,
    ciRuns: ops.ciRuns,
    webhooks: ops.webhooks,
    tags: ops.tags,
    storageMode: getDbStatus().mode,
    isDemoMode: true,
  };
}

export async function getUserCount(): Promise<number> {
  const db = getDb();
  if (db) {
    const rows = await db.select({ id: users.id }).from(users);
    return rows.length;
  }
  return mem.users.length;
}

export async function registerUser(input: {
  email: string;
  name: string;
  password: string;
}): Promise<{ user: AuthUserDTO; token: string }> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const passwordHash = hashPassword(input.password);
  const existingCount = await getUserCount();
  const role: 'admin' | 'member' = existingCount === 0 ? 'admin' : 'member';
  const userId = newId('usr');
  const now = new Date();

  const db = getDb();
  if (db) {
    const existing = await db.select().from(users).where(eq(users.email, email));
    if (existing.length > 0) {
      throw new Error('An account with this email already exists');
    }
    await db.insert(users).values({
      id: userId,
      email,
      name,
      passwordHash,
      role,
      createdAt: now,
    });
  } else {
    if (mem.users.some((u) => u.email === email)) {
      throw new Error('An account with this email already exists');
    }
    mem.users.push({
      id: userId,
      email,
      name,
      passwordHash,
      role,
      createdAt: now.toISOString(),
    });
  }

  // Provision starter workspace for the new user matching the Inventory mockup
  await createWorkspaceForUser(userId, 'never-before-seen', 'Inventory', true);

  const token = await createSession(userId);
  return {
    user: { id: userId, email, name, role, createdAt: now.toISOString() },
    token,
  };
}

export async function loginUser(input: {
  email: string;
  password: string;
}): Promise<{ user: AuthUserDTO; token: string }> {
  const email = input.email.trim().toLowerCase();
  const db = getDb();
  if (db) {
    const rows = await db.select().from(users).where(eq(users.email, email));
    const found = rows[0];
    if (!found || !verifyPassword(input.password, found.passwordHash)) {
      throw new Error('Invalid email or password');
    }
    const token = await createSession(found.id);
    return {
      user: {
        id: found.id,
        email: found.email,
        name: found.name,
        role: found.role === 'admin' ? 'admin' : 'member',
        createdAt: found.createdAt.toISOString(),
      },
      token,
    };
  }

  const found = mem.users.find((u) => u.email === email);
  if (!found || !verifyPassword(input.password, found.passwordHash)) {
    throw new Error('Invalid email or password');
  }
  const token = await createSession(found.id);
  return {
    user: {
      id: found.id,
      email: found.email,
      name: found.name,
      role: found.role,
      createdAt: found.createdAt,
    },
    token,
  };
}

async function createSession(userId: string): Promise<string> {
  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const sessId = newId('sess');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

  const db = getDb();
  if (db) {
    await db.insert(sessions).values({
      id: sessId,
      userId,
      tokenHash,
      expiresAt,
    });
  } else {
    mem.sessions.push({
      id: sessId,
      userId,
      tokenHash,
      expiresAt: expiresAt.getTime(),
    });
  }
  return rawToken;
}

export async function verifySessionToken(rawToken: string): Promise<AuthUserDTO | null> {
  const tokenHash = hashToken(rawToken);
  const db = getDb();
  if (db) {
    const rows = await db
      .select({
        user: users,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.tokenHash, tokenHash));
    const row = rows[0];
    if (!row || row.expiresAt.getTime() < Date.now()) {
      return null;
    }
    return {
      id: row.user.id,
      email: row.user.email,
      name: row.user.name,
      role: row.user.role === 'admin' ? 'admin' : 'member',
      createdAt: row.user.createdAt.toISOString(),
    };
  }

  const sess = mem.sessions.find((s) => s.tokenHash === tokenHash);
  if (!sess || sess.expiresAt < Date.now()) return null;
  const user = mem.users.find((u) => u.id === sess.userId);
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
  };
}

export async function revokeSessionToken(rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  const db = getDb();
  if (db) {
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  } else {
    mem.sessions = mem.sessions.filter((s) => s.tokenHash !== tokenHash);
  }
}

export async function createWorkspaceForUser(
  ownerId: string,
  orgSlug: string,
  name: string,
  seedDemo: boolean,
): Promise<WorkspaceDTO> {
  const wsId = newId('ws');
  const baseSnapId = newId('snap');
  const targetSnapId = newId('snap');
  const now = new Date();
  const baseDate = new Date(now.getTime() - 86400000);
  const ops = createSeedOperationalData(wsId);
  ops.tags[0].targetSnapshotId = targetSnapId;
  ops.tags[1].targetSnapshotId = baseSnapId;

  const emptySchema: SchemaGraph = { dialect: 'postgresql', nodes: [], relations: [] };

  const db = getDb();
  if (db) {
    await db.insert(workspaces).values({
      id: wsId,
      ownerId,
      orgSlug,
      name,
      baselineSnapshotId: baseSnapId,
      activeSnapshotId: targetSnapId,
      createdAt: now,
    });
    await db.insert(schemaSnapshots).values([
      {
        id: baseSnapId,
        workspaceId: wsId,
        datasourceId: null,
        versionTag: '20240112',
        label: seedDemo ? 'From 20240112 (Baseline)' : 'Initial Baseline',
        schemaJson: seedDemo ? BASELINE_INVENTORY_SCHEMA : emptySchema,
        createdAt: baseDate,
      },
      {
        id: targetSnapId,
        workspaceId: wsId,
        datasourceId: null,
        versionTag: '20240208',
        label: seedDemo ? 'To 20240208 (Current)' : 'Current Schema',
        schemaJson: seedDemo ? TARGET_INVENTORY_SCHEMA : emptySchema,
        createdAt: now,
      },
    ]);
    if (seedDemo) {
      for (const m of ops.migrations) {
        await db.insert(migrations).values({
          id: newId('mig'),
          workspaceId: wsId,
          datasourceId: null,
          version: m.version,
          name: m.name,
          upSql: m.upSql,
          downSql: m.downSql,
          status: m.status,
          appliedAt: m.appliedAt ? new Date(m.appliedAt) : null,
          createdAt: new Date(m.createdAt),
        });
      }
      for (const ci of ops.ciRuns) {
        await db.insert(ciRuns).values({
          id: newId('ci'),
          workspaceId: wsId,
          branch: ci.branch,
          commitSha: ci.commitSha,
          author: ci.author,
          status: ci.status,
          summary: ci.summary,
          diffCount: ci.diffCount,
          durationMs: ci.durationMs,
          checks: ci.checks,
          createdAt: new Date(ci.createdAt),
        });
      }
      for (const wh of ops.webhooks) {
        await db.insert(webhooks).values({
          id: newId('wh'),
          workspaceId: wsId,
          name: wh.name,
          url: wh.url,
          events: wh.events,
          enabled: wh.enabled,
          lastTriggeredAt: wh.lastTriggeredAt ? new Date(wh.lastTriggeredAt) : null,
          createdAt: new Date(wh.createdAt),
        });
      }
      for (const tg of ops.tags) {
        await db.insert(tags).values({
          id: newId('tag'),
          workspaceId: wsId,
          name: tg.name,
          color: tg.color,
          targetSnapshotId: tg.targetSnapshotId,
          description: tg.description,
          createdAt: new Date(tg.createdAt),
        });
      }
    }
  } else {
    mem.workspaces.push({
      id: wsId,
      ownerId,
      orgSlug,
      name,
      baselineSnapshotId: baseSnapId,
      activeSnapshotId: targetSnapId,
      createdAt: now.toISOString(),
    });
    mem.snapshots.push(
      {
        id: baseSnapId,
        workspaceId: wsId,
        datasourceId: null,
        versionTag: '20240112',
        label: seedDemo ? 'From 20240112 (Baseline)' : 'Initial Baseline',
        schemaJson: seedDemo ? BASELINE_INVENTORY_SCHEMA : emptySchema,
        createdAt: baseDate.toISOString(),
      },
      {
        id: targetSnapId,
        workspaceId: wsId,
        datasourceId: null,
        versionTag: '20240208',
        label: seedDemo ? 'To 20240208 (Current)' : 'Current Schema',
        schemaJson: seedDemo ? TARGET_INVENTORY_SCHEMA : emptySchema,
        createdAt: now.toISOString(),
      },
    );
    if (seedDemo) {
      mem.migrations.push(...ops.migrations);
      mem.ciRuns.push(...ops.ciRuns);
      mem.webhooks.push(...ops.webhooks);
      mem.tags.push(...ops.tags);
    }
  }

  return {
    id: wsId,
    orgSlug,
    name,
    baselineSnapshotId: baseSnapId,
    activeSnapshotId: targetSnapId,
    createdAt: now.toISOString(),
  };
}

export async function listWorkspacesForUser(userId: string): Promise<WorkspaceDTO[]> {
  const db = getDb();
  if (db) {
    const rows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.ownerId, userId))
      .orderBy(workspaces.createdAt);
    return rows.map((w) => ({
      id: w.id,
      orgSlug: w.orgSlug,
      name: w.name,
      baselineSnapshotId: w.baselineSnapshotId,
      activeSnapshotId: w.activeSnapshotId,
      createdAt: w.createdAt.toISOString(),
    }));
  }
  return mem.workspaces
    .filter((w) => w.ownerId === userId)
    .map(({ ownerId: _o, ...rest }) => rest);
}

export async function verifyWorkspaceOwnership(
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const db = getDb();
  if (db) {
    const rows = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.ownerId, userId)));
    return rows.length > 0;
  }
  return mem.workspaces.some((w) => w.id === workspaceId && w.ownerId === userId);
}

export async function getWorkspaceBundle(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceBundle | null> {
  const owns = await verifyWorkspaceOwnership(workspaceId, userId);
  if (!owns) return null;

  const db = getDb();
  if (db) {
    const [wsRow] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    if (!wsRow) return null;
    const snapRows = await db
      .select()
      .from(schemaSnapshots)
      .where(eq(schemaSnapshots.workspaceId, workspaceId))
      .orderBy(schemaSnapshots.createdAt);
    const dsRows = await db
      .select()
      .from(datasources)
      .where(eq(datasources.workspaceId, workspaceId))
      .orderBy(desc(datasources.createdAt));
    const migRows = await db
      .select()
      .from(migrations)
      .where(eq(migrations.workspaceId, workspaceId))
      .orderBy(desc(migrations.createdAt));
    const ciRows = await db
      .select()
      .from(ciRuns)
      .where(eq(ciRuns.workspaceId, workspaceId))
      .orderBy(desc(ciRuns.createdAt));
    const whRows = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.workspaceId, workspaceId))
      .orderBy(desc(webhooks.createdAt));
    const tagRows = await db
      .select()
      .from(tags)
      .where(eq(tags.workspaceId, workspaceId))
      .orderBy(desc(tags.createdAt));

    return {
      workspace: {
        id: wsRow.id,
        orgSlug: wsRow.orgSlug,
        name: wsRow.name,
        baselineSnapshotId: wsRow.baselineSnapshotId,
        activeSnapshotId: wsRow.activeSnapshotId,
        createdAt: wsRow.createdAt.toISOString(),
      },
      snapshots: snapRows.map((s) => ({
        id: s.id,
        workspaceId: s.workspaceId,
        datasourceId: s.datasourceId,
        versionTag: s.versionTag,
        label: s.label,
        schemaJson: s.schemaJson,
        createdAt: s.createdAt.toISOString(),
      })),
      datasources: dsRows.map((d) => ({
        id: d.id,
        workspaceId: d.workspaceId,
        name: d.name,
        engine: 'postgresql',
        host: d.host,
        port: d.port,
        databaseName: d.databaseName,
        username: d.username,
        sslMode: (d.sslMode as 'require' | 'prefer' | 'disable') || 'require',
        status: (d.status as 'connected' | 'disconnected' | 'error') || 'disconnected',
        lastError: d.lastError,
        lastTestedAt: d.lastTestedAt?.toISOString() ?? null,
        lastIntrospectedAt: d.lastIntrospectedAt?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
      })),
      migrations: migRows.map((m) => ({
        id: m.id,
        workspaceId: m.workspaceId,
        datasourceId: m.datasourceId,
        version: m.version,
        name: m.name,
        upSql: m.upSql,
        downSql: m.downSql,
        status: (m.status as 'pending' | 'applied' | 'failed') || 'pending',
        appliedAt: m.appliedAt?.toISOString() ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
      ciRuns: ciRows.map((c) => ({
        id: c.id,
        workspaceId: c.workspaceId,
        branch: c.branch,
        commitSha: c.commitSha,
        author: c.author,
        status: (c.status as 'passed' | 'warning' | 'failed') || 'passed',
        summary: c.summary,
        diffCount: c.diffCount,
        durationMs: c.durationMs,
        checks: c.checks,
        createdAt: c.createdAt.toISOString(),
      })),
      webhooks: whRows.map((w) => ({
        id: w.id,
        workspaceId: w.workspaceId,
        name: w.name,
        url: w.url,
        events: w.events,
        enabled: w.enabled,
        lastTriggeredAt: w.lastTriggeredAt?.toISOString() ?? null,
        createdAt: w.createdAt.toISOString(),
      })),
      tags: tagRows.map((t) => ({
        id: t.id,
        workspaceId: t.workspaceId,
        name: t.name,
        color: t.color,
        targetSnapshotId: t.targetSnapshotId,
        description: t.description,
        createdAt: t.createdAt.toISOString(),
      })),
      storageMode: 'postgresql',
      isDemoMode: false,
    };
  }

  const ws = mem.workspaces.find((w) => w.id === workspaceId);
  if (!ws) return null;
  const { ownerId: _o, ...wsDto } = ws;
  return {
    workspace: wsDto,
    snapshots: mem.snapshots.filter((s) => s.workspaceId === workspaceId),
    datasources: mem.datasources
      .filter((d) => d.workspaceId === workspaceId)
      .map(({ ownerId: _do, encryptedPassword: _ep, ...ds }) => ds),
    migrations: mem.migrations.filter((m) => m.workspaceId === workspaceId),
    ciRuns: mem.ciRuns.filter((c) => c.workspaceId === workspaceId),
    webhooks: mem.webhooks.filter((w) => w.workspaceId === workspaceId),
    tags: mem.tags.filter((t) => t.workspaceId === workspaceId),
    storageMode: 'memory',
    isDemoMode: false,
  };
}

export async function updateWorkspaceMeta(
  workspaceId: string,
  patch: { orgSlug?: string; name?: string; baselineSnapshotId?: string; activeSnapshotId?: string },
): Promise<void> {
  const db = getDb();
  if (db) {
    await db
      .update(workspaces)
      .set({
        ...(patch.orgSlug !== undefined ? { orgSlug: patch.orgSlug } : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.baselineSnapshotId !== undefined ? { baselineSnapshotId: patch.baselineSnapshotId } : {}),
        ...(patch.activeSnapshotId !== undefined ? { activeSnapshotId: patch.activeSnapshotId } : {}),
      })
      .where(eq(workspaces.id, workspaceId));
    return;
  }
  const ws = mem.workspaces.find((w) => w.id === workspaceId);
  if (ws) Object.assign(ws, patch);
}

export async function createSnapshot(input: {
  workspaceId: string;
  datasourceId?: string | null;
  versionTag: string;
  label: string;
  schemaJson: SchemaGraph;
}): Promise<SchemaSnapshotDTO> {
  const id = newId('snap');
  const now = new Date();
  const db = getDb();
  if (db) {
    await db.insert(schemaSnapshots).values({
      id,
      workspaceId: input.workspaceId,
      datasourceId: input.datasourceId ?? null,
      versionTag: input.versionTag,
      label: input.label,
      schemaJson: input.schemaJson,
      createdAt: now,
    });
  } else {
    mem.snapshots.push({
      id,
      workspaceId: input.workspaceId,
      datasourceId: input.datasourceId ?? null,
      versionTag: input.versionTag,
      label: input.label,
      schemaJson: input.schemaJson,
      createdAt: now.toISOString(),
    });
  }
  return {
    id,
    workspaceId: input.workspaceId,
    datasourceId: input.datasourceId ?? null,
    versionTag: input.versionTag,
    label: input.label,
    schemaJson: input.schemaJson,
    createdAt: now.toISOString(),
  };
}

export async function updateSnapshotSchema(
  workspaceId: string,
  snapshotId: string,
  schemaJson: SchemaGraph,
): Promise<boolean> {
  const db = getDb();
  if (db) {
    const updated = await db
      .update(schemaSnapshots)
      .set({ schemaJson })
      .where(
        and(
          eq(schemaSnapshots.id, snapshotId),
          eq(schemaSnapshots.workspaceId, workspaceId),
        ),
      )
      .returning({ id: schemaSnapshots.id });
    return updated.length > 0;
  }
  const snap = mem.snapshots.find(
    (s) => s.id === snapshotId && s.workspaceId === workspaceId,
  );
  if (!snap) return false;
  snap.schemaJson = schemaJson;
  return true;
}

export async function createDatasource(input: {
  workspaceId: string;
  ownerId: string;
  name: string;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  password: string;
  sslMode: 'require' | 'prefer' | 'disable';
  status: 'connected' | 'disconnected' | 'error';
  lastError?: string | null;
}): Promise<DatasourceDTO> {
  const id = newId('ds');
  const now = new Date();
  const encryptedPassword = encryptSecret(input.password);
  const db = getDb();
  if (db) {
    await db.insert(datasources).values({
      id,
      workspaceId: input.workspaceId,
      ownerId: input.ownerId,
      name: input.name,
      engine: 'postgresql',
      host: input.host,
      port: input.port,
      databaseName: input.databaseName,
      username: input.username,
      encryptedPassword,
      sslMode: input.sslMode,
      status: input.status,
      lastError: input.lastError ?? null,
      lastTestedAt: input.status === 'connected' ? now : null,
      createdAt: now,
    });
  } else {
    mem.datasources.unshift({
      id,
      workspaceId: input.workspaceId,
      ownerId: input.ownerId,
      name: input.name,
      engine: 'postgresql',
      host: input.host,
      port: input.port,
      databaseName: input.databaseName,
      username: input.username,
      encryptedPassword,
      sslMode: input.sslMode,
      status: input.status,
      lastError: input.lastError ?? null,
      lastTestedAt: input.status === 'connected' ? now.toISOString() : null,
      lastIntrospectedAt: null,
      createdAt: now.toISOString(),
    });
  }
  return {
    id,
    workspaceId: input.workspaceId,
    name: input.name,
    engine: 'postgresql',
    host: input.host,
    port: input.port,
    databaseName: input.databaseName,
    username: input.username,
    sslMode: input.sslMode,
    status: input.status,
    lastError: input.lastError ?? null,
    lastTestedAt: input.status === 'connected' ? now.toISOString() : null,
    lastIntrospectedAt: null,
    createdAt: now.toISOString(),
  };
}

export async function getDatasourceWithSecret(
  datasourceId: string,
  ownerId: string,
  workspaceId?: string,
): Promise<{
  id: string;
  workspaceId: string;
  name: string;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  password: string;
  sslMode: 'require' | 'prefer' | 'disable';
} | null> {
  const db = getDb();
  if (db) {
    const cond = workspaceId
      ? and(
          eq(datasources.id, datasourceId),
          eq(datasources.ownerId, ownerId),
          eq(datasources.workspaceId, workspaceId),
        )
      : and(eq(datasources.id, datasourceId), eq(datasources.ownerId, ownerId));
    const rows = await db.select().from(datasources).where(cond);
    const row = rows[0];
    if (!row) return null;
    try {
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        name: row.name,
        host: row.host,
        port: row.port,
        databaseName: row.databaseName,
        username: row.username,
        password: decryptSecret(row.encryptedPassword),
        sslMode: (row.sslMode as 'require' | 'prefer' | 'disable') || 'require',
      };
    } catch (err) {
      if (err instanceof CredentialDecryptionError) {
        await updateDatasourceStatus(datasourceId, {
          status: 'error',
          lastError: err.message,
        });
      }
      throw err;
    }
  }
  const found = mem.datasources.find(
    (d) =>
      d.id === datasourceId &&
      d.ownerId === ownerId &&
      (!workspaceId || d.workspaceId === workspaceId),
  );
  if (!found) return null;
  try {
    return {
      id: found.id,
      workspaceId: found.workspaceId,
      name: found.name,
      host: found.host,
      port: found.port,
      databaseName: found.databaseName,
      username: found.username,
      password: decryptSecret(found.encryptedPassword),
      sslMode: found.sslMode,
    };
  } catch (err) {
    if (err instanceof CredentialDecryptionError) {
      await updateDatasourceStatus(datasourceId, {
        status: 'error',
        lastError: err.message,
      });
    }
    throw err;
  }
}

export async function getDatasourceMeta(
  datasourceId: string,
  ownerId: string,
): Promise<DatasourceDTO | null> {
  const db = getDb();
  if (db) {
    const rows = await db
      .select()
      .from(datasources)
      .where(and(eq(datasources.id, datasourceId), eq(datasources.ownerId, ownerId)));
    const d = rows[0];
    if (!d) return null;
    return {
      id: d.id,
      workspaceId: d.workspaceId,
      name: d.name,
      engine: 'postgresql',
      host: d.host,
      port: d.port,
      databaseName: d.databaseName,
      username: d.username,
      sslMode: (d.sslMode as 'require' | 'prefer' | 'disable') || 'require',
      status: (d.status as 'connected' | 'disconnected' | 'error') || 'disconnected',
      lastError: d.lastError,
      lastTestedAt: d.lastTestedAt?.toISOString() ?? null,
      lastIntrospectedAt: d.lastIntrospectedAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(),
    };
  }
  const found = mem.datasources.find((d) => d.id === datasourceId && d.ownerId === ownerId);
  if (!found) return null;
  const { ownerId: _o, encryptedPassword: _ep, ...dto } = found;
  return dto;
}

export async function updateDatasourcePassword(
  datasourceId: string,
  ownerId: string,
  newPassword: string,
  status: 'connected' | 'error',
  lastError: string | null,
): Promise<void> {
  const encryptedPassword = encryptSecret(newPassword);
  const now = new Date();
  const db = getDb();
  if (db) {
    await db
      .update(datasources)
      .set({
        encryptedPassword,
        status,
        lastError,
        lastTestedAt: now,
      })
      .where(and(eq(datasources.id, datasourceId), eq(datasources.ownerId, ownerId)));
    return;
  }
  const ds = mem.datasources.find((d) => d.id === datasourceId && d.ownerId === ownerId);
  if (ds) {
    ds.encryptedPassword = encryptedPassword;
    ds.status = status;
    ds.lastError = lastError;
    ds.lastTestedAt = now.toISOString();
  }
}

export async function updateDatasourceStatus(
  datasourceId: string,
  patch: {
    status: 'connected' | 'disconnected' | 'error';
    lastError?: string | null;
    lastTestedAt?: Date;
    lastIntrospectedAt?: Date;
  },
): Promise<void> {
  const db = getDb();
  if (db) {
    await db
      .update(datasources)
      .set({
        status: patch.status,
        lastError: patch.lastError ?? null,
        ...(patch.lastTestedAt ? { lastTestedAt: patch.lastTestedAt } : {}),
        ...(patch.lastIntrospectedAt ? { lastIntrospectedAt: patch.lastIntrospectedAt } : {}),
      })
      .where(eq(datasources.id, datasourceId));
    return;
  }
  const ds = mem.datasources.find((d) => d.id === datasourceId);
  if (ds) {
    ds.status = patch.status;
    ds.lastError = patch.lastError ?? null;
    if (patch.lastTestedAt) ds.lastTestedAt = patch.lastTestedAt.toISOString();
    if (patch.lastIntrospectedAt) ds.lastIntrospectedAt = patch.lastIntrospectedAt.toISOString();
  }
}

export async function deleteDatasource(datasourceId: string, ownerId: string): Promise<boolean> {
  const db = getDb();
  if (db) {
    const existing = await db
      .select({ id: datasources.id })
      .from(datasources)
      .where(and(eq(datasources.id, datasourceId), eq(datasources.ownerId, ownerId)));
    if (existing.length === 0) return false;
    await db.delete(datasources).where(eq(datasources.id, datasourceId));
    return true;
  }
  const idx = mem.datasources.findIndex((d) => d.id === datasourceId && d.ownerId === ownerId);
  if (idx === -1) return false;
  mem.datasources.splice(idx, 1);
  return true;
}

export async function createMigrationRecord(input: {
  workspaceId: string;
  datasourceId?: string | null;
  version: string;
  name: string;
  upSql: string;
  downSql: string;
  status?: 'pending' | 'applied' | 'failed';
}): Promise<MigrationDTO> {
  const id = newId('mig');
  const now = new Date();
  const status = input.status ?? 'pending';
  const db = getDb();
  if (db) {
    await db.insert(migrations).values({
      id,
      workspaceId: input.workspaceId,
      datasourceId: input.datasourceId ?? null,
      version: input.version,
      name: input.name,
      upSql: input.upSql,
      downSql: input.downSql,
      status,
      appliedAt: status === 'applied' ? now : null,
      createdAt: now,
    });
  } else {
    mem.migrations.unshift({
      id,
      workspaceId: input.workspaceId,
      datasourceId: input.datasourceId ?? null,
      version: input.version,
      name: input.name,
      upSql: input.upSql,
      downSql: input.downSql,
      status,
      appliedAt: status === 'applied' ? now.toISOString() : null,
      createdAt: now.toISOString(),
    });
  }
  return {
    id,
    workspaceId: input.workspaceId,
    datasourceId: input.datasourceId ?? null,
    version: input.version,
    name: input.name,
    upSql: input.upSql,
    downSql: input.downSql,
    status,
    appliedAt: status === 'applied' ? now.toISOString() : null,
    createdAt: now.toISOString(),
  };
}

export async function updateMigrationStatus(
  workspaceId: string,
  migrationId: string,
  status: 'pending' | 'applied' | 'failed',
): Promise<void> {
  const now = new Date();
  const db = getDb();
  if (db) {
    await db
      .update(migrations)
      .set({
        status,
        appliedAt: status === 'applied' ? now : null,
      })
      .where(
        and(eq(migrations.id, migrationId), eq(migrations.workspaceId, workspaceId)),
      );
    return;
  }
  const m = mem.migrations.find(
    (x) => x.id === migrationId && x.workspaceId === workspaceId,
  );
  if (m) {
    m.status = status;
    m.appliedAt = status === 'applied' ? now.toISOString() : null;
  }
}

export async function deleteMigrationRecord(
  workspaceId: string,
  migrationId: string,
): Promise<boolean> {
  const db = getDb();
  if (db) {
    const deleted = await db
      .delete(migrations)
      .where(
        and(eq(migrations.id, migrationId), eq(migrations.workspaceId, workspaceId)),
      )
      .returning({ id: migrations.id });
    return deleted.length > 0;
  }
  const idx = mem.migrations.findIndex(
    (m) => m.id === migrationId && m.workspaceId === workspaceId,
  );
  if (idx === -1) return false;
  mem.migrations.splice(idx, 1);
  return true;
}

export async function createCiRunRecord(input: Omit<CiRunDTO, 'id' | 'createdAt'>): Promise<CiRunDTO> {
  const id = newId('ci');
  const now = new Date();
  const db = getDb();
  if (db) {
    await db.insert(ciRuns).values({
      id,
      workspaceId: input.workspaceId,
      branch: input.branch,
      commitSha: input.commitSha,
      author: input.author,
      status: input.status,
      summary: input.summary,
      diffCount: input.diffCount,
      durationMs: input.durationMs,
      checks: input.checks,
      createdAt: now,
    });
  } else {
    mem.ciRuns.unshift({ ...input, id, createdAt: now.toISOString() });
  }
  return { ...input, id, createdAt: now.toISOString() };
}

export async function createWebhookRecord(input: {
  workspaceId: string;
  name: string;
  url: string;
  events: string[];
}): Promise<WebhookDTO> {
  const id = newId('wh');
  const now = new Date();
  const db = getDb();
  if (db) {
    await db.insert(webhooks).values({
      id,
      workspaceId: input.workspaceId,
      name: input.name,
      url: input.url,
      events: input.events,
      enabled: true,
      createdAt: now,
    });
  } else {
    mem.webhooks.unshift({
      id,
      workspaceId: input.workspaceId,
      name: input.name,
      url: input.url,
      events: input.events,
      enabled: true,
      lastTriggeredAt: null,
      createdAt: now.toISOString(),
    });
  }
  return {
    id,
    workspaceId: input.workspaceId,
    name: input.name,
    url: input.url,
    events: input.events,
    enabled: true,
    lastTriggeredAt: null,
    createdAt: now.toISOString(),
  };
}

export async function getWebhookById(
  workspaceId: string,
  webhookId: string,
): Promise<WebhookDTO | null> {
  const db = getDb();
  if (db) {
    const rows = await db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.id, webhookId), eq(webhooks.workspaceId, workspaceId)));
    const w = rows[0];
    if (!w) return null;
    return {
      id: w.id,
      workspaceId: w.workspaceId,
      name: w.name,
      url: w.url,
      events: w.events,
      enabled: w.enabled,
      lastTriggeredAt: w.lastTriggeredAt?.toISOString() ?? null,
      createdAt: w.createdAt.toISOString(),
    };
  }
  return (
    mem.webhooks.find(
      (w) => w.id === webhookId && w.workspaceId === workspaceId,
    ) ?? null
  );
}

export async function toggleWebhookRecord(
  workspaceId: string,
  webhookId: string,
  enabled: boolean,
): Promise<boolean> {
  const db = getDb();
  if (db) {
    const updated = await db
      .update(webhooks)
      .set({ enabled })
      .where(and(eq(webhooks.id, webhookId), eq(webhooks.workspaceId, workspaceId)))
      .returning({ id: webhooks.id });
    return updated.length > 0;
  }
  const w = mem.webhooks.find(
    (x) => x.id === webhookId && x.workspaceId === workspaceId,
  );
  if (!w) return false;
  w.enabled = enabled;
  return true;
}

export async function deleteWebhookRecord(
  workspaceId: string,
  webhookId: string,
): Promise<boolean> {
  const db = getDb();
  if (db) {
    const deleted = await db
      .delete(webhooks)
      .where(and(eq(webhooks.id, webhookId), eq(webhooks.workspaceId, workspaceId)))
      .returning({ id: webhooks.id });
    return deleted.length > 0;
  }
  const idx = mem.webhooks.findIndex(
    (w) => w.id === webhookId && w.workspaceId === workspaceId,
  );
  if (idx === -1) return false;
  mem.webhooks.splice(idx, 1);
  return true;
}

export async function listEnabledWebhooksForEvent(
  workspaceId: string,
  event: string,
): Promise<WebhookDTO[]> {
  const db = getDb();
  if (db) {
    const rows = await db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.workspaceId, workspaceId), eq(webhooks.enabled, true)));
    return rows
      .filter((w) => Array.isArray(w.events) && w.events.includes(event))
      .map((w) => ({
        id: w.id,
        workspaceId: w.workspaceId,
        name: w.name,
        url: w.url,
        events: w.events,
        enabled: w.enabled,
        lastTriggeredAt: w.lastTriggeredAt?.toISOString() ?? null,
        createdAt: w.createdAt.toISOString(),
      }));
  }
  return mem.webhooks.filter(
    (w) => w.workspaceId === workspaceId && w.enabled && w.events.includes(event),
  );
}

export async function markWebhookTriggered(webhookId: string): Promise<void> {
  const now = new Date();
  const db = getDb();
  if (db) {
    await db
      .update(webhooks)
      .set({ lastTriggeredAt: now })
      .where(eq(webhooks.id, webhookId));
    return;
  }
  const w = mem.webhooks.find((x) => x.id === webhookId);
  if (w) w.lastTriggeredAt = now.toISOString();
}

export async function createTagRecord(input: {
  workspaceId: string;
  name: string;
  color: string;
  targetSnapshotId: string | null;
  description: string;
}): Promise<TagDTO> {
  const id = newId('tag');
  const now = new Date();
  const db = getDb();
  if (db) {
    await db.insert(tags).values({
      id,
      workspaceId: input.workspaceId,
      name: input.name,
      color: input.color,
      targetSnapshotId: input.targetSnapshotId,
      description: input.description,
      createdAt: now,
    });
  } else {
    mem.tags.unshift({ ...input, id, createdAt: now.toISOString() });
  }
  return { ...input, id, createdAt: now.toISOString() };
}

export async function deleteTagRecord(
  workspaceId: string,
  tagId: string,
): Promise<boolean> {
  const db = getDb();
  if (db) {
    const deleted = await db
      .delete(tags)
      .where(and(eq(tags.id, tagId), eq(tags.workspaceId, workspaceId)))
      .returning({ id: tags.id });
    return deleted.length > 0;
  }
  const idx = mem.tags.findIndex(
    (t) => t.id === tagId && t.workspaceId === workspaceId,
  );
  if (idx === -1) return false;
  mem.tags.splice(idx, 1);
  return true;
}
