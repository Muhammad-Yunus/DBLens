export type NodeKind = 'table' | 'view';

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  defaultValue?: string;
  references?: {
    table: string;
    column: string;
  };
}

export interface SchemaIndex {
  name: string;
  columns: string[];
  unique?: boolean;
}

export interface SchemaTableNode {
  id: string;
  name: string;
  schema: string;
  kind: NodeKind;
  columns: SchemaColumn[];
  indexes: SchemaIndex[];
  createStatement?: string;
  dependencies?: string[];
  position: { x: number; y: number };
  visibleOnCanvas?: boolean;
}

export interface SchemaRelation {
  id: string;
  sourceId: string;
  targetId: string;
  sourceColumn?: string;
  targetColumn?: string;
  kind: 'fk' | 'view_dep';
  label?: string;
}

export interface SchemaGraph {
  dialect: 'postgresql';
  nodes: SchemaTableNode[];
  relations: SchemaRelation[];
}

export interface SchemaSnapshotDTO {
  id: string;
  workspaceId: string;
  datasourceId: string | null;
  versionTag: string;
  label: string;
  schemaJson: SchemaGraph;
  createdAt: string;
}

export interface ColumnDiff {
  tableId: string;
  tableName: string;
  columnName: string;
  change: 'added' | 'removed' | 'modified';
  oldType?: string;
  newType?: string;
  oldNullable?: boolean;
  newNullable?: boolean;
}

export interface TableDiff {
  tableId: string;
  tableName: string;
  kind: NodeKind;
  change: 'added' | 'removed' | 'modified' | 'unchanged';
  columnDiffs: ColumnDiff[];
  indexDiffs: { name: string; change: 'added' | 'removed' }[];
}

export interface DiffLine {
  lineNumber: number;
  type: 'context' | 'added' | 'removed';
  content: string;
}

export interface SqlPlanStep {
  step: number;
  action: 'ADD COLUMN' | 'DROP COLUMN' | 'ALTER COLUMN' | 'CREATE TABLE' | 'DROP TABLE' | 'CREATE VIEW' | 'DROP VIEW' | 'CREATE INDEX';
  target: string;
  statement: string;
  lockLevel: 'NONE' | 'SHARE UPDATE EXCLUSIVE' | 'ACCESS EXCLUSIVE';
  reversible: boolean;
  notes: string;
}

export interface ComputedDiff {
  hasChanges: boolean;
  summary: {
    addedTables: number;
    addedViews: number;
    addedColumns: number;
    removedItems: number;
    modifiedColumns: number;
  };
  tables: Record<string, TableDiff>;
  columnsByTable: Record<string, Record<string, 'added' | 'removed' | 'modified'>>;
  sqlPlan: SqlPlanStep[];
  hclDiff: DiffLine[];
  sqlDiff: DiffLine[];
  upSql: string;
  downSql: string;
}

export interface AuthUserDTO {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  createdAt: string;
}

export interface DatasourceDTO {
  id: string;
  workspaceId: string;
  name: string;
  engine: 'postgresql';
  host: string;
  port: number;
  databaseName: string;
  username: string;
  sslMode: 'require' | 'prefer' | 'disable';
  status: 'connected' | 'disconnected' | 'error';
  lastError?: string | null;
  lastTestedAt?: string | null;
  lastIntrospectedAt?: string | null;
  createdAt: string;
}

export interface MigrationDTO {
  id: string;
  workspaceId: string;
  datasourceId: string | null;
  version: string;
  name: string;
  upSql: string;
  downSql: string;
  status: 'pending' | 'applied' | 'failed';
  appliedAt: string | null;
  createdAt: string;
}

export interface CiRunDTO {
  id: string;
  workspaceId: string;
  branch: string;
  commitSha: string;
  author: string;
  status: 'passed' | 'warning' | 'failed';
  summary: string;
  diffCount: number;
  durationMs: number;
  checks: { name: string; status: 'passed' | 'warning' | 'failed'; detail: string }[];
  createdAt: string;
}

export interface WebhookDTO {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
}

export interface TagDTO {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
  targetSnapshotId: string | null;
  description: string;
  createdAt: string;
}

export interface WorkspaceDTO {
  id: string;
  orgSlug: string;
  name: string;
  baselineSnapshotId: string;
  activeSnapshotId: string;
  createdAt: string;
}

export interface WorkspaceBundle {
  workspace: WorkspaceDTO;
  snapshots: SchemaSnapshotDTO[];
  datasources: DatasourceDTO[];
  migrations: MigrationDTO[];
  ciRuns: CiRunDTO[];
  webhooks: WebhookDTO[];
  tags: TagDTO[];
  storageMode: 'postgresql' | 'memory';
  isDemoMode: boolean;
}
