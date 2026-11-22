import pg from 'pg';
import net from 'node:net';
import type {
  SchemaGraph,
  SchemaTableNode,
  SchemaColumn,
  SchemaIndex,
  SchemaRelation,
} from '../src/types/schema.ts';

const BLOCKED_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.goog',
]);

export function validateDatasourceHost(host: string): void {
  const trimmed = host.trim().toLowerCase();
  if (!trimmed || trimmed.length > 253) {
    throw new Error('Invalid database host');
  }
  if (BLOCKED_HOSTS.has(trimmed)) {
    throw new Error('Metadata service hosts are not permitted');
  }
  if (net.isIPv4(trimmed)) {
    const parts = trimmed.split('.').map(Number);
    // Block link-local 169.254.0.0/16
    if (parts[0] === 169 && parts[1] === 254) {
      throw new Error('Link-local addresses are not permitted');
    }
  }
  if (!/^[a-z0-9.-]+$/.test(trimmed) && !net.isIPv6(trimmed)) {
    throw new Error('Host contains invalid characters');
  }
}

export interface PostgresConnectionParams {
  host: string;
  port: number;
  databaseName: string;
  username: string;
  password: string;
  sslMode: 'require' | 'prefer' | 'disable';
}

function buildClientConfig(params: PostgresConnectionParams): pg.ClientConfig {
  validateDatasourceHost(params.host);
  return {
    host: params.host.trim(),
    port: Number(params.port) || 5432,
    database: params.databaseName.trim(),
    user: params.username.trim(),
    password: params.password,
    connectionTimeoutMillis: 8000,
    ssl:
      params.sslMode === 'disable'
        ? false
        : {
            rejectUnauthorized: false,
          },
  };
}

export async function testPostgresConnection(
  params: PostgresConnectionParams,
): Promise<{ version: string; latencyMs: number }> {
  const started = Date.now();
  const client = new pg.Client(buildClientConfig(params));
  try {
    await client.connect();
    const res = await client.query<{ version: string }>('SELECT version() AS version');
    const latencyMs = Date.now() - started;
    return {
      version: res.rows[0]?.version?.split(',')[0] || 'PostgreSQL',
      latencyMs,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function introspectPostgresSchema(
  params: PostgresConnectionParams,
): Promise<SchemaGraph> {
  const client = new pg.Client(buildClientConfig(params));
  try {
    await client.connect();

    const tablesRes = await client.query<{
      table_schema: string;
      table_name: string;
      table_type: string;
    }>(`
      SELECT table_schema, table_name, table_type
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        AND table_schema NOT LIKE 'pg_temp_%'
        AND table_schema NOT LIKE 'pg_toast_temp_%'
      ORDER BY table_schema, table_name
      LIMIT 60
    `);

    const colsRes = await client.query<{
      table_schema: string;
      table_name: string;
      column_name: string;
      data_type: string;
      udt_name: string;
      character_maximum_length: number | null;
      numeric_precision: number | null;
      numeric_scale: number | null;
      is_nullable: string;
      column_default: string | null;
    }>(`
      SELECT
        table_schema,
        table_name,
        column_name,
        data_type,
        udt_name,
        character_maximum_length,
        numeric_precision,
        numeric_scale,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name, ordinal_position
    `);

    const pkRes = await client.query<{
      table_schema: string;
      table_name: string;
      column_name: string;
    }>(`
      SELECT tc.table_schema, tc.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
    `);

    const fkRes = await client.query<{
      constraint_name: string;
      source_schema: string;
      source_table: string;
      source_column: string;
      target_schema: string;
      target_table: string;
      target_column: string;
    }>(`
      SELECT
        tc.constraint_name,
        tc.table_schema AS source_schema,
        tc.table_name AS source_table,
        kcu.column_name AS source_column,
        ccu.table_schema AS target_schema,
        ccu.table_name AS target_table,
        ccu.column_name AS target_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
    `);

    const idxRes = await client.query<{
      schemaname: string;
      tablename: string;
      indexname: string;
      indexdef: string;
    }>(`
      SELECT schemaname, tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    `);

    const viewRes = await client.query<{
      schemaname: string;
      viewname: string;
      definition: string;
    }>(`
      SELECT schemaname, viewname, definition
      FROM pg_views
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    `);

    const pkSet = new Set(
      pkRes.rows.map((r) => `${r.table_schema}.${r.table_name}.${r.column_name}`),
    );
    const fkMap = new Map<string, { targetTable: string; targetColumn: string }>();
    for (const r of fkRes.rows) {
      fkMap.set(`${r.source_schema}.${r.source_table}.${r.source_column}`, {
        targetTable: `${r.target_schema}.${r.target_table}`,
        targetColumn: r.target_column,
      });
    }

    const viewDefMap = new Map<string, string>();
    for (const v of viewRes.rows) {
      viewDefMap.set(
        `${v.schemaname}.${v.viewname}`,
        `CREATE OR REPLACE VIEW "${v.schemaname}"."${v.viewname}" AS\n${v.definition}`,
      );
    }

    const colsByTable = new Map<string, SchemaColumn[]>();
    for (const c of colsRes.rows) {
      const key = `${c.table_schema}.${c.table_name}`;
      if (!colsByTable.has(key)) colsByTable.set(key, []);
      let formattedType = c.udt_name === 'int4' ? 'int' : c.udt_name;
      if (c.data_type === 'character varying') {
        formattedType = c.character_maximum_length
          ? `varchar (${c.character_maximum_length})`
          : 'varchar';
      } else if (c.data_type === 'numeric' && c.numeric_precision) {
        formattedType = c.numeric_scale !== null
          ? `decimal (${c.numeric_precision}, ${c.numeric_scale})`
          : `decimal (${c.numeric_precision})`;
      } else if (c.data_type === 'timestamp with time zone') {
        formattedType = 'timestamptz';
      }

      const fullColKey = `${key}.${c.column_name}`;
      const fk = fkMap.get(fullColKey);
      colsByTable.get(key)!.push({
        name: c.column_name,
        type: formattedType,
        nullable: c.is_nullable === 'YES',
        isPrimaryKey: pkSet.has(fullColKey),
        isForeignKey: Boolean(fk),
        defaultValue: c.column_default ?? undefined,
        references: fk
          ? { table: fk.targetTable, column: fk.targetColumn }
          : undefined,
      });
    }

    const idxByTable = new Map<string, SchemaIndex[]>();
    for (const idx of idxRes.rows) {
      const key = `${idx.schemaname}.${idx.tablename}`;
      if (!idxByTable.has(key)) idxByTable.set(key, []);
      const match = idx.indexdef.match(/\(([^)]+)\)/);
      const cols = match
        ? match[1].split(',').map((s) => s.trim().replace(/"/g, ''))
        : [];
      idxByTable.get(key)!.push({
        name: idx.indexname,
        columns: cols,
        unique: idx.indexdef.toUpperCase().includes('CREATE UNIQUE INDEX'),
      });
    }

    const nodes: SchemaTableNode[] = [];
    tablesRes.rows.forEach((t, i) => {
      const key = `${t.table_schema}.${t.table_name}`;
      const kind = t.table_type === 'VIEW' ? 'view' : 'table';
      const colIndex = i % 3;
      const rowIndex = Math.floor(i / 3);
      nodes.push({
        id: `pg_${t.table_schema}_${t.table_name}`,
        name: t.table_name,
        schema: t.table_schema,
        kind,
        visibleOnCanvas: i < 8,
        position: {
          x: 80 + colIndex * 390,
          y: 90 + rowIndex * 290,
        },
        columns: colsByTable.get(key) ?? [],
        indexes: idxByTable.get(key) ?? [],
        createStatement: kind === 'view' ? viewDefMap.get(key) : undefined,
        dependencies: [],
      });
    });

    const nodeIdByKey = new Map(nodes.map((n) => [`${n.schema}.${n.name}`, n.id]));
    const relations: SchemaRelation[] = [];
    const seenRel = new Set<string>();

    for (const fk of fkRes.rows) {
      const sourceId = nodeIdByKey.get(`${fk.source_schema}.${fk.source_table}`);
      const targetId = nodeIdByKey.get(`${fk.target_schema}.${fk.target_table}`);
      if (sourceId && targetId && !seenRel.has(fk.constraint_name)) {
        seenRel.add(fk.constraint_name);
        relations.push({
          id: `fk_${fk.constraint_name}`,
          sourceId,
          targetId,
          sourceColumn: fk.source_column,
          targetColumn: fk.target_column,
          kind: 'fk',
          label: `${fk.source_column} -> ${fk.target_table}.${fk.target_column}`,
        });
      }
    }

    return {
      dialect: 'postgresql',
      nodes,
      relations,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}
