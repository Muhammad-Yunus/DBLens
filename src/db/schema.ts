import { pgTable, text, integer, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';
import type { SchemaGraph } from '../types/schema.ts';

export const users = pgTable('dblens_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('member'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('dblens_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workspaces = pgTable('dblens_workspaces', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  orgSlug: text('org_slug').notNull().default('never-before-seen'),
  name: text('name').notNull().default('Inventory'),
  baselineSnapshotId: text('baseline_snapshot_id').notNull(),
  activeSnapshotId: text('active_snapshot_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const datasources = pgTable('dblens_datasources', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  engine: text('engine').notNull().default('postgresql'),
  host: text('host').notNull(),
  port: integer('port').notNull().default(5432),
  databaseName: text('database_name').notNull(),
  username: text('username').notNull(),
  encryptedPassword: text('encrypted_password').notNull(),
  sslMode: text('ssl_mode').notNull().default('require'),
  status: text('status').notNull().default('disconnected'),
  lastError: text('last_error'),
  lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
  lastIntrospectedAt: timestamp('last_introspected_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const schemaSnapshots = pgTable('dblens_schema_snapshots', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  datasourceId: text('datasource_id'),
  versionTag: text('version_tag').notNull(),
  label: text('label').notNull(),
  schemaJson: jsonb('schema_json').$type<SchemaGraph>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const migrations = pgTable('dblens_migrations', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  datasourceId: text('datasource_id'),
  version: text('version').notNull(),
  name: text('name').notNull(),
  upSql: text('up_sql').notNull(),
  downSql: text('down_sql').notNull(),
  status: text('status').notNull().default('pending'),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ciRuns = pgTable('dblens_ci_runs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  branch: text('branch').notNull(),
  commitSha: text('commit_sha').notNull(),
  author: text('author').notNull(),
  status: text('status').notNull(),
  summary: text('summary').notNull(),
  diffCount: integer('diff_count').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  checks: jsonb('checks').$type<{ name: string; status: 'passed' | 'warning' | 'failed'; detail: string }[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const webhooks = pgTable('dblens_webhooks', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  events: jsonb('events').$type<string[]>().notNull(),
  enabled: boolean('enabled').notNull().default(true),
  lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tags = pgTable('dblens_tags', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull().default('#2563EB'),
  targetSnapshotId: text('target_snapshot_id'),
  description: text('description').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
