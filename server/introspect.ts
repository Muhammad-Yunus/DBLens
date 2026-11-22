import pg from 'pg';
import net from 'node:net';
import { computeAutoLayout } from '../src/utils/autoLayout.ts';
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

// Built-in PostgreSQL & Supabase platform schemas excluded from user-schema introspection by default
const INTERNAL_SYSTEM_SCHEMAS = [
  'pg_catalog',
  'information_schema',
  'pg_toast',
  'auth',
  'storage',
  'realtime',
  'vault',
  'pgsodium',
  'pgsodium_masks',
  'pgbouncer',
  'supabase_functions',
  'supabase_migrations',
  'cron',
  'net',
  'graphql',
  'graphql_public',
  'extensions',
  '_realtime',
  '_analytics',
  '_supavisor',
  'pgtle',
  'repack',
  'topology',
];

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

export async function listPostgresSchemas(
  params: PostgresConnectionParams,
): Promise<{ schema: string; tableCount: number }[]> {
  const client = new pg.Client(buildClientConfig(params));
  try {
    await client.connect();
    const res = await client.query<{ schema_name: string; table_count: string }>(
      `
      SELECT
        n.nspname AS schema_name,
        COUNT(c.oid)::text AS table_count
      FROM pg_catalog.pg_namespace n
      LEFT JOIN pg_catalog.pg_class c
        ON c.relnamespace = n.oid
       AND c.relkind IN ('r', 'p', 'v', 'm')
      WHERE n.nspname <> ALL($1::text[])
        AND n.nspname NOT LIKE 'pg_temp_%'
        AND n.nspname NOT LIKE 'pg_toast_temp_%'
      GROUP BY n.nspname
      HAVING COUNT(c.oid) > 0 OR n.nspname = 'public'
      ORDER BY COUNT(c.oid) DESC, n.nspname ASC
      `,
      [INTERNAL_SYSTEM_SCHEMAS],
    );
    return res.rows.map((r) => ({
      schema: r.schema_name,
      tableCount: Number(r.table_count) || 0,
    }));
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function introspectPostgresSchema(
  params: PostgresConnectionParams,
  options?: { schemas?: string[] },
): Promise<SchemaGraph> {
  const client = new pg.Client(buildClientConfig(params));
  const selectedSchemas =
    options?.schemas
      ?.map((s) => s.trim())
      .filter((s) => s.length > 0) ?? [];
  const hasFilter = selectedSchemas.length > 0;

  try {
    await client.connect();

    const tablesRes = await client.query<{
      table_schema: string;
      table_name: string;
      table_type: string;
    }>(
      hasFilter
        ? `
          SELECT
            n.nspname AS table_schema,
            c.relname AS table_name,
            CASE WHEN c.relkind IN ('v', 'm') THEN 'VIEW' ELSE 'BASE TABLE' END AS table_type
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r', 'p', 'v', 'm')
            AND n.nspname = ANY($1::text[])
          ORDER BY n.nspname, c.relname
          LIMIT 200
        `
        : `
          SELECT
            n.nspname AS table_schema,
            c.relname AS table_name,
            CASE WHEN c.relkind IN ('v', 'm') THEN 'VIEW' ELSE 'BASE TABLE' END AS table_type
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r', 'p', 'v', 'm')
            AND n.nspname <> ALL($1::text[])
            AND n.nspname NOT LIKE 'pg_temp_%'
            AND n.nspname NOT LIKE 'pg_toast_temp_%'
          ORDER BY n.nspname, c.relname
          LIMIT 200
        `,
      [hasFilter ? selectedSchemas : INTERNAL_SYSTEM_SCHEMAS],
    );

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
    }>(
      hasFilter
        ? `
          SELECT
            table_schema, table_name, column_name, data_type, udt_name,
            character_maximum_length, numeric_precision, numeric_scale,
            is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = ANY($1::text[])
          ORDER BY table_schema, table_name, ordinal_position
        `
        : `
          SELECT
            table_schema, table_name, column_name, data_type, udt_name,
            character_maximum_length, numeric_precision, numeric_scale,
            is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema <> ALL($1::text[])
            AND table_schema NOT LIKE 'pg_temp_%'
          ORDER BY table_schema, table_name, ordinal_position
        `,
      [hasFilter ? selectedSchemas : INTERNAL_SYSTEM_SCHEMAS],
    );

    const pkRes = await client.query<{
      table_schema: string;
      table_name: string;
      column_name: string;
    }>(
      hasFilter
        ? `
          SELECT
            ns.nspname AS table_schema,
            cl.relname AS table_name,
            att.attname AS column_name
          FROM pg_catalog.pg_constraint con
          JOIN pg_catalog.pg_class cl ON cl.oid = con.conrelid
          JOIN pg_catalog.pg_namespace ns ON ns.oid = cl.relnamespace
          JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
          JOIN pg_catalog.pg_attribute att
            ON att.attrelid = con.conrelid
           AND att.attnum = k.attnum
          WHERE con.contype = 'p'
            AND ns.nspname = ANY($1::text[])
        `
        : `
          SELECT
            ns.nspname AS table_schema,
            cl.relname AS table_name,
            att.attname AS column_name
          FROM pg_catalog.pg_constraint con
          JOIN pg_catalog.pg_class cl ON cl.oid = con.conrelid
          JOIN pg_catalog.pg_namespace ns ON ns.oid = cl.relnamespace
          JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
          JOIN pg_catalog.pg_attribute att
            ON att.attrelid = con.conrelid
           AND att.attnum = k.attnum
          WHERE con.contype = 'p'
            AND ns.nspname <> ALL($1::text[])
        `,
      [hasFilter ? selectedSchemas : INTERNAL_SYSTEM_SCHEMAS],
    );

    const fkRes = await client.query<{
      constraint_name: string;
      source_schema: string;
      source_table: string;
      source_column: string;
      target_schema: string;
      target_table: string;
      target_column: string;
    }>(
      hasFilter
        ? `
          SELECT
            con.conname AS constraint_name,
            src_ns.nspname AS source_schema,
            src_cl.relname AS source_table,
            src_att.attname AS source_column,
            tgt_ns.nspname AS target_schema,
            tgt_cl.relname AS target_table,
            tgt_att.attname AS target_column
          FROM pg_catalog.pg_constraint con
          JOIN pg_catalog.pg_class src_cl ON src_cl.oid = con.conrelid
          JOIN pg_catalog.pg_namespace src_ns ON src_ns.oid = src_cl.relnamespace
          JOIN pg_catalog.pg_class tgt_cl ON tgt_cl.oid = con.confrelid
          JOIN pg_catalog.pg_namespace tgt_ns ON tgt_ns.oid = tgt_cl.relnamespace
          JOIN unnest(con.conkey, con.confkey) WITH ORDINALITY AS cols(src_attnum, tgt_attnum, ord) ON true
          JOIN pg_catalog.pg_attribute src_att
            ON src_att.attrelid = con.conrelid
           AND src_att.attnum = cols.src_attnum
          JOIN pg_catalog.pg_attribute tgt_att
            ON tgt_att.attrelid = con.confrelid
           AND tgt_att.attnum = cols.tgt_attnum
          WHERE con.contype = 'f'
            AND src_ns.nspname = ANY($1::text[])
        `
        : `
          SELECT
            con.conname AS constraint_name,
            src_ns.nspname AS source_schema,
            src_cl.relname AS source_table,
            src_att.attname AS source_column,
            tgt_ns.nspname AS target_schema,
            tgt_cl.relname AS target_table,
            tgt_att.attname AS target_column
          FROM pg_catalog.pg_constraint con
          JOIN pg_catalog.pg_class src_cl ON src_cl.oid = con.conrelid
          JOIN pg_catalog.pg_namespace src_ns ON src_ns.oid = src_cl.relnamespace
          JOIN pg_catalog.pg_class tgt_cl ON tgt_cl.oid = con.confrelid
          JOIN pg_catalog.pg_namespace tgt_ns ON tgt_ns.oid = tgt_cl.relnamespace
          JOIN unnest(con.conkey, con.confkey) WITH ORDINALITY AS cols(src_attnum, tgt_attnum, ord) ON true
          JOIN pg_catalog.pg_attribute src_att
            ON src_att.attrelid = con.conrelid
           AND src_att.attnum = cols.src_attnum
          JOIN pg_catalog.pg_attribute tgt_att
            ON tgt_att.attrelid = con.confrelid
           AND tgt_att.attnum = cols.tgt_attnum
          WHERE con.contype = 'f'
            AND src_ns.nspname <> ALL($1::text[])
        `,
      [hasFilter ? selectedSchemas : INTERNAL_SYSTEM_SCHEMAS],
    );

    const viewDepsRes = await client
      .query<{
        view_schema: string;
        view_name: string;
        ref_schema: string;
        ref_name: string;
      }>(
        hasFilter
          ? `
            SELECT DISTINCT
              vns.nspname AS view_schema,
              vc.relname AS view_name,
              tns.nspname AS ref_schema,
              tc.relname AS ref_name
            FROM pg_catalog.pg_depend d
            JOIN pg_catalog.pg_rewrite rw ON rw.oid = d.objid
            JOIN pg_catalog.pg_class vc ON vc.oid = rw.ev_class
            JOIN pg_catalog.pg_namespace vns ON vns.oid = vc.relnamespace
            JOIN pg_catalog.pg_class tc ON tc.oid = d.refobjid
            JOIN pg_catalog.pg_namespace tns ON tns.oid = tc.relnamespace
            WHERE vc.relkind IN ('v', 'm')
              AND tc.relkind IN ('r', 'p', 'v', 'm')
              AND vc.oid <> tc.oid
              AND vns.nspname = ANY($1::text[])
          `
          : `
            SELECT DISTINCT
              vns.nspname AS view_schema,
              vc.relname AS view_name,
              tns.nspname AS ref_schema,
              tc.relname AS ref_name
            FROM pg_catalog.pg_depend d
            JOIN pg_catalog.pg_rewrite rw ON rw.oid = d.objid
            JOIN pg_catalog.pg_class vc ON vc.oid = rw.ev_class
            JOIN pg_catalog.pg_namespace vns ON vns.oid = vc.relnamespace
            JOIN pg_catalog.pg_class tc ON tc.oid = d.refobjid
            JOIN pg_catalog.pg_namespace tns ON tns.oid = tc.relnamespace
            WHERE vc.relkind IN ('v', 'm')
              AND tc.relkind IN ('r', 'p', 'v', 'm')
              AND vc.oid <> tc.oid
              AND vns.nspname <> ALL($1::text[])
              AND tns.nspname <> ALL($1::text[])
          `,
        [hasFilter ? selectedSchemas : INTERNAL_SYSTEM_SCHEMAS],
      )
      .catch(() => ({ rows: [] }));

    const idxRes = await client.query<{
      schemaname: string;
      tablename: string;
      indexname: string;
      indexdef: string;
    }>(
      hasFilter
        ? `SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = ANY($1::text[])`
        : `SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes WHERE schemaname <> ALL($1::text[])`,
      [hasFilter ? selectedSchemas : INTERNAL_SYSTEM_SCHEMAS],
    );

    const viewRes = await client.query<{
      schemaname: string;
      viewname: string;
      definition: string;
    }>(
      hasFilter
        ? `SELECT schemaname, viewname, definition FROM pg_views WHERE schemaname = ANY($1::text[])`
        : `SELECT schemaname, viewname, definition FROM pg_views WHERE schemaname <> ALL($1::text[])`,
      [hasFilter ? selectedSchemas : INTERNAL_SYSTEM_SCHEMAS],
    );

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

    const viewDepsByKey = new Map<string, string[]>();
    for (const vd of viewDepsRes.rows) {
      const vKey = `${vd.view_schema}.${vd.view_name}`;
      const list = viewDepsByKey.get(vKey) ?? [];
      list.push(`${vd.ref_schema}.${vd.ref_name}`);
      viewDepsByKey.set(vKey, list);
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
        formattedType =
          c.numeric_scale !== null
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

    const nodes: SchemaTableNode[] = tablesRes.rows.map((t) => {
      const key = `${t.table_schema}.${t.table_name}`;
      const kind = t.table_type === 'VIEW' ? 'view' : 'table';
      return {
        id: `pg_${t.table_schema}_${t.table_name}`,
        name: t.table_name,
        schema: t.table_schema,
        kind,
        visibleOnCanvas: true,
        position: { x: 80, y: 80 },
        columns: colsByTable.get(key) ?? [],
        indexes: idxByTable.get(key) ?? [],
        createStatement: kind === 'view' ? viewDefMap.get(key) : undefined,
        dependencies: viewDepsByKey.get(key) ?? [],
      };
    });

    const nodeIdByKey = new Map(nodes.map((n) => [`${n.schema}.${n.name}`, n.id]));
    const relations: SchemaRelation[] = [];
    const seenRel = new Set<string>();

    for (const fk of fkRes.rows) {
      const sourceId = nodeIdByKey.get(`${fk.source_schema}.${fk.source_table}`);
      const targetId = nodeIdByKey.get(`${fk.target_schema}.${fk.target_table}`);
      const dedupeKey = `${fk.constraint_name}:${fk.source_column}:${fk.target_column}`;
      if (sourceId && targetId && !seenRel.has(dedupeKey)) {
        seenRel.add(dedupeKey);
        relations.push({
          id: `fk_${fk.constraint_name}_${fk.source_column}`,
          sourceId,
          targetId,
          sourceColumn: fk.source_column,
          targetColumn: fk.target_column,
          kind: 'fk',
          label: `${fk.source_table}.${fk.source_column} → ${fk.target_table}.${fk.target_column}`,
        });
      }
    }

    for (const vd of viewDepsRes.rows) {
      const sourceId = nodeIdByKey.get(`${vd.view_schema}.${vd.view_name}`);
      const targetId = nodeIdByKey.get(`${vd.ref_schema}.${vd.ref_name}`);
      const dedupeKey = `vdep:${vd.view_schema}.${vd.view_name}->${vd.ref_schema}.${vd.ref_name}`;
      if (sourceId && targetId && !seenRel.has(dedupeKey)) {
        seenRel.add(dedupeKey);
        relations.push({
          id: `vdep_${vd.view_name}_${vd.ref_name}`,
          sourceId,
          targetId,
          kind: 'view_dep',
          label: `View ${vd.view_name} references ${vd.ref_schema}.${vd.ref_name}`,
        });
      }
    }

    return computeAutoLayout({
      dialect: 'postgresql',
      nodes,
      relations,
    });
  } finally {
    await client.end().catch(() => undefined);
  }
}
