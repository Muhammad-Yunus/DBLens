import type {
  SchemaGraph,
  SchemaTableNode,
  ComputedDiff,
  TableDiff,
  ColumnDiff,
  DiffLine,
  SqlPlanStep,
} from '../types/schema.ts';

function formatColSql(col: {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey?: boolean;
  defaultValue?: string;
}): string {
  const parts = [`"${col.name}"`, col.type.replace(/\s+/g, '')];
  if (!col.nullable) parts.push('NOT NULL');
  if (col.defaultValue !== undefined) parts.push(`DEFAULT ${col.defaultValue}`);
  if (col.isPrimaryKey) parts.push('PRIMARY KEY');
  return parts.join(' ');
}

function buildHclBlock(node: SchemaTableNode): string[] {
  if (node.kind === 'view') {
    const lines = [`view "${node.name}" {`, `  schema = schema.${node.schema}`];
    for (const col of node.columns) {
      lines.push(`  column "${col.name}" {`);
      lines.push(`    type = ${col.type.replace(/\s+/g, '')}`);
      lines.push(`    null = ${col.nullable ? 'true' : 'false'}`);
      lines.push('  }');
    }
    if (node.createStatement) {
      lines.push('  as = <<-SQL');
      for (const sqlLine of node.createStatement.split('\n')) {
        lines.push(`    ${sqlLine}`);
      }
      lines.push('  SQL');
    }
    lines.push('}');
    return lines;
  }

  const lines = [`table "${node.name}" {`, `  schema = schema.${node.schema}`];
  for (const col of node.columns) {
    lines.push(`  column "${col.name}" {`);
    lines.push(`    type = ${col.type.replace(/\s+/g, '')}`);
    lines.push(`    null = ${col.nullable ? 'true' : 'false'}`);
    if (col.defaultValue !== undefined) {
      lines.push(`    default = ${col.defaultValue}`);
    }
    lines.push('  }');
  }
  const pks = node.columns.filter((c) => c.isPrimaryKey).map((c) => `column.${c.name}`);
  if (pks.length > 0) {
    lines.push('  primary_key {');
    lines.push(`    columns = [${pks.join(', ')}]`);
    lines.push('  }');
  }
  for (const idx of node.indexes) {
    lines.push(`  index "${idx.name}" {`);
    lines.push(`    columns = [${idx.columns.map((c) => `column.${c}`).join(', ')}]`);
    lines.push('  }');
  }
  lines.push('}');
  return lines;
}

export function computeClientSchemaDiff(fromGraph: SchemaGraph, toGraph: SchemaGraph): ComputedDiff {
  const fromMap = new Map(fromGraph.nodes.map((n) => [n.id, n]));
  const toMap = new Map(toGraph.nodes.map((n) => [n.id, n]));

  const tables: Record<string, TableDiff> = {};
  const columnsByTable: Record<string, Record<string, 'added' | 'removed' | 'modified'>> = {};
  const sqlPlan: SqlPlanStep[] = [];
  const hclDiff: DiffLine[] = [];
  const sqlDiff: DiffLine[] = [];
  const upStatements: string[] = [];
  const downStatements: string[] = [];

  let addedTables = 0;
  let addedViews = 0;
  let addedColumns = 0;
  let removedItems = 0;
  let modifiedColumns = 0;

  let hclLine = 1;
  let sqlLine = 1;
  const pushHcl = (type: DiffLine['type'], content: string) => {
    hclDiff.push({ lineNumber: hclLine++, type, content });
  };
  const pushSql = (type: DiffLine['type'], content: string) => {
    sqlDiff.push({ lineNumber: sqlLine++, type, content });
  };

  for (const toNode of toGraph.nodes) {
    const fromNode = fromMap.get(toNode.id);
    if (!fromNode) {
      if (toNode.kind === 'view') addedViews++;
      else addedTables++;

      tables[toNode.id] = {
        tableId: toNode.id,
        tableName: toNode.name,
        kind: toNode.kind,
        change: 'added',
        columnDiffs: toNode.columns.map((c) => ({
          tableId: toNode.id,
          tableName: toNode.name,
          columnName: c.name,
          change: 'added',
          newType: c.type,
          newNullable: c.nullable,
        })),
        indexDiffs: toNode.indexes.map((i) => ({ name: i.name, change: 'added' })),
      };

      const colMap: Record<string, 'added' | 'removed' | 'modified'> = {};
      for (const c of toNode.columns) colMap[c.name] = 'added';
      columnsByTable[toNode.id] = colMap;

      for (const line of buildHclBlock(toNode)) {
        pushHcl('added', line);
      }
      pushHcl('context', '');

      if (toNode.kind === 'view') {
        const stmt =
          toNode.createStatement ||
          `CREATE OR REPLACE VIEW "${toNode.schema}"."${toNode.name}" AS SELECT ${toNode.columns
            .map((c) => `"${c.name}"`)
            .join(', ')};`;
        upStatements.push(stmt);
        downStatements.push(`DROP VIEW IF EXISTS "${toNode.schema}"."${toNode.name}";`);
        for (const s of stmt.split('\n')) pushSql('added', s);
        pushSql('context', '');
        sqlPlan.push({
          step: sqlPlan.length + 1,
          action: 'CREATE VIEW',
          target: `${toNode.schema}.${toNode.name}`,
          statement: stmt,
          lockLevel: 'NONE',
          reversible: true,
          notes: `Creates view ${toNode.name} with ${toNode.columns.length} projected columns.`,
        });
      } else {
        const colsSql = toNode.columns.map((c) => `  ${formatColSql(c)}`).join(',\n');
        const stmt = `CREATE TABLE "${toNode.schema}"."${toNode.name}" (\n${colsSql}\n);`;
        upStatements.push(stmt);
        downStatements.push(`DROP TABLE IF EXISTS "${toNode.schema}"."${toNode.name}";`);
        for (const s of stmt.split('\n')) pushSql('added', s);
        pushSql('context', '');
        sqlPlan.push({
          step: sqlPlan.length + 1,
          action: 'CREATE TABLE',
          target: `${toNode.schema}.${toNode.name}`,
          statement: stmt,
          lockLevel: 'NONE',
          reversible: true,
          notes: `Creates table ${toNode.name}.`,
        });
      }
      continue;
    }

    const fromCols = new Map(fromNode.columns.map((c) => [c.name, c]));
    const toCols = new Map(toNode.columns.map((c) => [c.name, c]));
    const columnDiffs: ColumnDiff[] = [];
    const colMap: Record<string, 'added' | 'removed' | 'modified'> = {};

    for (const col of toNode.columns) {
      const prev = fromCols.get(col.name);
      if (!prev) {
        addedColumns++;
        columnDiffs.push({
          tableId: toNode.id,
          tableName: toNode.name,
          columnName: col.name,
          change: 'added',
          newType: col.type,
          newNullable: col.nullable,
        });
        colMap[col.name] = 'added';
      } else if (
        prev.type.replace(/\s+/g, '') !== col.type.replace(/\s+/g, '') ||
        prev.nullable !== col.nullable
      ) {
        modifiedColumns++;
        columnDiffs.push({
          tableId: toNode.id,
          tableName: toNode.name,
          columnName: col.name,
          change: 'modified',
          oldType: prev.type,
          newType: col.type,
          oldNullable: prev.nullable,
          newNullable: col.nullable,
        });
        colMap[col.name] = 'modified';
      }
    }

    for (const prev of fromNode.columns) {
      if (!toCols.has(prev.name)) {
        removedItems++;
        columnDiffs.push({
          tableId: toNode.id,
          tableName: toNode.name,
          columnName: prev.name,
          change: 'removed',
          oldType: prev.type,
          oldNullable: prev.nullable,
        });
        colMap[prev.name] = 'removed';
      }
    }

    const fromIdx = new Set(fromNode.indexes.map((i) => i.name));
    const toIdx = new Set(toNode.indexes.map((i) => i.name));
    const indexDiffs: { name: string; change: 'added' | 'removed' }[] = [];
    for (const idx of toNode.indexes) {
      if (!fromIdx.has(idx.name)) indexDiffs.push({ name: idx.name, change: 'added' });
    }
    for (const idx of fromNode.indexes) {
      if (!toIdx.has(idx.name)) indexDiffs.push({ name: idx.name, change: 'removed' });
    }

    const hasNodeChanges = columnDiffs.length > 0 || indexDiffs.length > 0;
    tables[toNode.id] = {
      tableId: toNode.id,
      tableName: toNode.name,
      kind: toNode.kind,
      change: hasNodeChanges ? 'modified' : 'unchanged',
      columnDiffs,
      indexDiffs,
    };
    columnsByTable[toNode.id] = colMap;

    if (hasNodeChanges) {
      pushHcl('context', `${toNode.kind} "${toNode.name}" {`);
      pushHcl('context', `  schema = schema.${toNode.schema}`);
      for (const col of toNode.columns) {
        const status = colMap[col.name];
        if (status === 'added') {
          pushHcl('added', `  column "${col.name}" {`);
          pushHcl('added', `    type = ${col.type.replace(/\s+/g, '')}`);
          pushHcl('added', `    null = ${col.nullable ? 'true' : 'false'}`);
          if (col.defaultValue !== undefined) {
            pushHcl('added', `    default = ${col.defaultValue}`);
          }
          pushHcl('added', '  }');
        } else if (status === 'modified') {
          const prev = fromCols.get(col.name)!;
          pushHcl('context', `  column "${col.name}" {`);
          if (prev.type !== col.type) {
            pushHcl('removed', `    type = ${prev.type.replace(/\s+/g, '')}`);
            pushHcl('added', `    type = ${col.type.replace(/\s+/g, '')}`);
          } else {
            pushHcl('context', `    type = ${col.type.replace(/\s+/g, '')}`);
          }
          if (prev.nullable !== col.nullable) {
            pushHcl('removed', `    null = ${prev.nullable ? 'true' : 'false'}`);
            pushHcl('added', `    null = ${col.nullable ? 'true' : 'false'}`);
          }
          pushHcl('context', '  }');
        } else {
          pushHcl('context', `  column "${col.name}" { ... }`);
        }
      }
      for (const diff of columnDiffs.filter((d) => d.change === 'removed')) {
        pushHcl('removed', `  column "${diff.columnName}" {`);
        pushHcl('removed', `    type = ${diff.oldType?.replace(/\s+/g, '') || 'unknown'}`);
        pushHcl('removed', '  }');
      }
      pushHcl('context', '}');
      pushHcl('context', '');

      for (const diff of columnDiffs) {
        if (diff.change === 'added') {
          const col = toCols.get(diff.columnName)!;
          const stmt = `ALTER TABLE "${toNode.schema}"."${toNode.name}" ADD COLUMN ${formatColSql(col)};`;
          upStatements.push(stmt);
          downStatements.push(
            `ALTER TABLE "${toNode.schema}"."${toNode.name}" DROP COLUMN IF EXISTS "${col.name}";`,
          );
          pushSql('added', stmt);
          sqlPlan.push({
            step: sqlPlan.length + 1,
            action: 'ADD COLUMN',
            target: `${toNode.schema}.${toNode.name}.${col.name}`,
            statement: stmt,
            lockLevel: col.defaultValue !== undefined || col.nullable ? 'SHARE UPDATE EXCLUSIVE' : 'ACCESS EXCLUSIVE',
            reversible: true,
            notes: `Instant metadata addition in PostgreSQL 11+ when default is constant.`,
          });
        } else if (diff.change === 'removed') {
          const stmt = `ALTER TABLE "${toNode.schema}"."${toNode.name}" DROP COLUMN "${diff.columnName}";`;
          upStatements.push(stmt);
          pushSql('removed', stmt);
          sqlPlan.push({
            step: sqlPlan.length + 1,
            action: 'DROP COLUMN',
            target: `${toNode.schema}.${toNode.name}.${diff.columnName}`,
            statement: stmt,
            lockLevel: 'ACCESS EXCLUSIVE',
            reversible: false,
            notes: `Destructive column drop; verify zero active queries depend on it.`,
          });
        } else if (diff.change === 'modified') {
          const stmt = `ALTER TABLE "${toNode.schema}"."${toNode.name}" ALTER COLUMN "${diff.columnName}" TYPE ${diff.newType?.replace(/\s+/g, '')};`;
          upStatements.push(stmt);
          pushSql('added', stmt);
          sqlPlan.push({
            step: sqlPlan.length + 1,
            action: 'ALTER COLUMN',
            target: `${toNode.schema}.${toNode.name}.${diff.columnName}`,
            statement: stmt,
            lockLevel: 'ACCESS EXCLUSIVE',
            reversible: true,
            notes: `Changes column type from ${diff.oldType} to ${diff.newType}.`,
          });
        }
      }
      pushSql('context', '');
    }
  }

  for (const fromNode of fromGraph.nodes) {
    if (!toMap.has(fromNode.id)) {
      removedItems++;
      tables[fromNode.id] = {
        tableId: fromNode.id,
        tableName: fromNode.name,
        kind: fromNode.kind,
        change: 'removed',
        columnDiffs: [],
        indexDiffs: [],
      };
      for (const line of buildHclBlock(fromNode)) pushHcl('removed', line);
      const stmt =
        fromNode.kind === 'view'
          ? `DROP VIEW IF EXISTS "${fromNode.schema}"."${fromNode.name}";`
          : `DROP TABLE IF EXISTS "${fromNode.schema}"."${fromNode.name}";`;
      upStatements.push(stmt);
      pushSql('removed', stmt);
      sqlPlan.push({
        step: sqlPlan.length + 1,
        action: fromNode.kind === 'view' ? 'DROP VIEW' : 'DROP TABLE',
        target: `${fromNode.schema}.${fromNode.name}`,
        statement: stmt,
        lockLevel: 'ACCESS EXCLUSIVE',
        reversible: false,
        notes: `Drops ${fromNode.kind} ${fromNode.name}.`,
      });
    }
  }

  return {
    hasChanges: addedTables + addedViews + addedColumns + removedItems + modifiedColumns > 0,
    summary: {
      addedTables,
      addedViews,
      addedColumns,
      removedItems,
      modifiedColumns,
    },
    tables,
    columnsByTable,
    sqlPlan,
    hclDiff,
    sqlDiff,
    upSql: upStatements.join('\n\n'),
    downSql: downStatements.join('\n'),
  };
}
