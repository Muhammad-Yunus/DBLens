import React, { useState, useEffect, useMemo } from 'react';
import {
  Database,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Play,
  Download,
  Globe,
  Tag as TagIcon,
  GitBranch,
  KeyRound,
  Eye,
  Table2,
  Lock,
  Loader2,
  Server,
  Search,
  Copy,
  Check,
  ExternalLink,
  RotateCcw,
  FlaskConical,
  Send,
  AlertTriangle,
} from 'lucide-react';
import type {
  SchemaGraph,
  SchemaTableNode,
  DatasourceDTO,
  MigrationDTO,
  CiRunDTO,
  WebhookDTO,
  TagDTO,
  SchemaSnapshotDTO,
  WorkspaceDTO,
} from '../types/schema.ts';

function buildNodeSql(node: SchemaTableNode): string {
  if (node.kind === 'view' && node.createStatement?.trim()) {
    return node.createStatement.trim();
  }
  const qSchema = `"${node.schema || 'public'}"`;
  const qName = `"${node.name}"`;
  const lines = node.columns.map((c) => {
    const parts = [`  "${c.name}" ${c.type}`];
    if (!c.nullable) parts.push('NOT NULL');
    if (c.defaultValue) parts.push(`DEFAULT ${c.defaultValue}`);
    return parts.join(' ');
  });
  const pkCols = node.columns.filter((c) => c.isPrimaryKey).map((c) => `"${c.name}"`);
  if (pkCols.length > 0) {
    lines.push(`  PRIMARY KEY (${pkCols.join(', ')})`);
  }
  const fkCols = node.columns.filter((c) => c.isForeignKey && c.references?.table);
  for (const fk of fkCols) {
    lines.push(
      `  FOREIGN KEY ("${fk.name}") REFERENCES ${fk.references!.table} ("${fk.references!.column || 'id'}")`,
    );
  }
  const createTable = `CREATE TABLE ${qSchema}.${qName} (\n${lines.join(',\n')}\n);`;
  const idxSql = (node.indexes ?? [])
    .map(
      (idx) =>
        `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX "${idx.name}" ON ${qSchema}.${qName} (${idx.columns
          .map((c) => `"${c}"`)
          .join(', ')});`,
    )
    .join('\n');
  return idxSql ? `${createTable}\n\n${idxSql}` : createTable;
}

/* ---------------------------- DOCS VIEW ---------------------------- */
export const DocsView: React.FC<{
  graph: SchemaGraph;
  workspace: WorkspaceDTO;
  onOpenInErd?: (nodeId: string) => void;
}> = ({ graph, workspace, onOpenInErd }) => {
  const [search, setSearch] = useState('');
  const [schemaFilter, setSchemaFilter] = useState('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const schemas = useMemo(() => {
    const set = new Set<string>();
    for (const n of graph.nodes) set.add(n.schema || 'public');
    return Array.from(set).sort();
  }, [graph.nodes]);

  const filteredNodes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return graph.nodes.filter((n) => {
      if (schemaFilter !== 'ALL' && (n.schema || 'public') !== schemaFilter) {
        return false;
      }
      if (!q) return true;
      return (
        n.name.toLowerCase().includes(q) ||
        (n.schema || 'public').toLowerCase().includes(q) ||
        n.columns.some((c) => c.name.toLowerCase().includes(q) || c.type.toLowerCase().includes(q))
      );
    });
  }, [graph.nodes, search, schemaFilter]);

  const handleCopySql = async (node: SchemaTableNode) => {
    try {
      await navigator.clipboard.writeText(buildNodeSql(node));
      setCopiedId(node.id);
      setTimeout(() => setCopiedId((prev) => (prev === node.id ? null : prev)), 1500);
    } catch {
      // Clipboard blocked in non-HTTPS contexts
    }
  };

  const downloadMarkdown = () => {
    const md = [
      `# ${workspace.orgSlug} / ${workspace.name} Schema Reference`,
      '',
      `> ${graph.nodes.filter((n) => n.kind === 'table').length} tables · ${
        graph.nodes.filter((n) => n.kind === 'view').length
      } views · ${graph.relations.length} relationships`,
      '',
      ...filteredNodes.map((n) => {
        const header = `## ${n.schema}.${n.name} (${n.kind.toUpperCase()})`;
        const rows = n.columns
          .map((c) => {
            const flags = [
              c.isPrimaryKey ? 'PK' : '',
              c.isForeignKey ? `FK -> ${c.references?.table || 'ref'}.${c.references?.column || 'id'}` : '',
              c.defaultValue ? `DEFAULT ${c.defaultValue}` : '',
            ]
              .filter(Boolean)
              .join(', ');
            return `- \`${c.name}\` \`${c.type}\` ${c.nullable ? 'NULL' : 'NOT NULL'}${
              flags ? ` — ${flags}` : ''
            }`;
          })
          .join('\n');
        const idxBlock =
          n.indexes && n.indexes.length > 0
            ? `\n\n### Indexes\n${n.indexes
                .map((idx) => `- \`${idx.name}\`${idx.unique ? ' (UNIQUE)' : ''}: (${idx.columns.join(', ')})`)
                .join('\n')}`
            : '';
        const viewSql =
          n.kind === 'view' && n.createStatement
            ? `\n\n### View Definition\n\`\`\`sql\n${n.createStatement.trim()}\n\`\`\``
            : '';
        return `${header}\n\n${rows}${idxBlock}${viewSql}\n`;
      }),
    ].join('\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${workspace.name.toLowerCase()}-schema-docs.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 bg-[#FCFCFD] overflow-y-auto p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="bg-white border border-[#E5E7EB] rounded-lg p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-[17px] font-semibold text-[#111827]">
                {workspace.name} Schema Documentation
              </h1>
              <p className="text-[12.5px] text-[#6B7280] mt-0.5 tabular-nums">
                {graph.nodes.filter((n) => n.kind === 'table').length} tables ·{' '}
                {graph.nodes.filter((n) => n.kind === 'view').length} views ·{' '}
                {graph.relations.length} relationships
              </p>
            </div>
            <button
              type="button"
              onClick={downloadMarkdown}
              className="h-8 px-3 rounded-md border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] text-[12.5px] font-medium text-[#111827] flex items-center gap-1.5 self-start cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Export Markdown
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5 pt-2 border-t border-[#F3F4F6]">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tables, views, or columns..."
                className="w-full h-8 pl-8 pr-3 text-[12.5px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#1D4ED8]"
              />
            </div>
            {schemas.length > 1 && (
              <select
                value={schemaFilter}
                onChange={(e) => setSchemaFilter(e.target.value)}
                className="h-8 px-2.5 text-[12.5px] border border-[#E5E7EB] rounded-md bg-white text-[#111827]"
              >
                <option value="ALL">All schemas ({graph.nodes.length})</option>
                {schemas.map((s) => (
                  <option key={s} value={s}>
                    {s} ({graph.nodes.filter((n) => (n.schema || 'public') === s).length})
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {filteredNodes.length === 0 ? (
          <div className="bg-white border border-[#E5E7EB] rounded-lg p-8 text-center text-[13px] text-[#6B7280]">
            No tables or views match your filter.
          </div>
        ) : (
          <div className="space-y-4">
            {filteredNodes.map((node) => (
              <div
                key={node.id}
                className="bg-white border border-[#E5E7EB] rounded-lg overflow-hidden"
              >
                <div className="px-5 py-3 border-b border-[#E5E7EB] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {node.kind === 'view' ? (
                      <Eye className="w-4 h-4 text-[#4B5563]" />
                    ) : (
                      <Table2 className="w-4 h-4 text-[#4B5563]" />
                    )}
                    <span className="font-semibold text-[14px] text-[#111827]">
                      {node.schema}.{node.name}
                    </span>
                    <span className="text-[11px] font-mono uppercase text-[#6B7280]">
                      {node.kind}
                    </span>
                    <span className="text-[12px] text-[#9CA3AF] tabular-nums">
                      · {node.columns.length} columns
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopySql(node)}
                      className="h-7 px-2.5 rounded border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] text-[11.5px] font-medium text-[#374151] flex items-center gap-1 cursor-pointer"
                    >
                      {copiedId === node.id ? (
                        <>
                          <Check className="w-3 h-3 text-[#16A34A]" />
                          Copied SQL
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          Copy DDL
                        </>
                      )}
                    </button>
                    {onOpenInErd && (
                      <button
                        type="button"
                        onClick={() => onOpenInErd(node.id)}
                        className="h-7 px-2.5 rounded border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] text-[11.5px] font-medium text-[#1D4ED8] flex items-center gap-1 cursor-pointer"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View in ERD
                      </button>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[12.5px]">
                    <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB] text-[11px] uppercase tracking-wider text-[#6B7280]">
                      <tr>
                        <th className="px-5 py-2 font-semibold">Column</th>
                        <th className="px-5 py-2 font-semibold">Type</th>
                        <th className="px-5 py-2 font-semibold">Nullable</th>
                        <th className="px-5 py-2 font-semibold">Key / Default</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]">
                      {node.columns.map((col) => (
                        <tr key={col.name} className="hover:bg-[#FAFAFA]">
                          <td className="px-5 py-2.5 font-medium text-[#111827] flex items-center gap-1.5">
                            {col.isPrimaryKey && (
                              <KeyRound className="w-3.5 h-3.5 text-[#1D4ED8]" />
                            )}
                            <span>{col.name}</span>
                          </td>
                          <td className="px-5 py-2.5 font-mono text-[11.5px] text-[#374151]">
                            {col.type}
                          </td>
                          <td className="px-5 py-2.5 text-[#4B5563]">
                            {col.nullable ? 'Yes' : 'No'}
                          </td>
                          <td className="px-5 py-2.5 font-mono text-[11.5px] text-[#6B7280]">
                            {col.isPrimaryKey
                              ? 'PRIMARY KEY'
                              : col.isForeignKey
                                ? `FK → ${col.references?.table || 'ref'}.${col.references?.column || 'id'}`
                                : col.defaultValue || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {((node.indexes && node.indexes.length > 0) ||
                  (node.kind === 'view' && node.createStatement) ||
                  (node.dependencies && node.dependencies.length > 0)) && (
                  <div className="px-5 py-3 bg-[#FAFAFA] border-t border-[#E5E7EB] space-y-2.5">
                    {node.indexes && node.indexes.length > 0 && (
                      <div>
                        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[#6B7280] mb-1.5">
                          Indexes ({node.indexes.length})
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {node.indexes.map((idx) => (
                            <span
                              key={idx.name}
                              className="px-2 py-1 rounded bg-white border border-[#E5E7EB] text-[11.5px] font-mono text-[#374151]"
                            >
                              {idx.name} ({idx.columns.join(', ')})
                              {idx.unique ? ' · UNIQUE' : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {node.dependencies && node.dependencies.length > 0 && (
                      <div>
                        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[#6B7280] mb-1">
                          Dependencies
                        </p>
                        <p className="text-[12px] font-mono text-[#4B5563]">
                          {node.dependencies.join(', ')}
                        </p>
                      </div>
                    )}

                    {node.kind === 'view' && node.createStatement && (
                      <div>
                        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[#6B7280] mb-1">
                          View SQL Definition
                        </p>
                        <pre className="p-2.5 rounded bg-white border border-[#E5E7EB] font-mono text-[11.5px] text-[#111827] overflow-x-auto whitespace-pre-wrap">
                          {node.createStatement}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* ---------------------------- CI RUNS VIEW ---------------------------- */
export const CiRunsView: React.FC<{
  ciRuns: CiRunDTO[];
  snapshots: SchemaSnapshotDTO[];
  defaultFromSnapshotId: string;
  defaultToSnapshotId: string;
  onTriggerRun: (
    branch: string,
    fromSnapshotId?: string,
    toSnapshotId?: string,
  ) => Promise<void>;
}> = ({ ciRuns, snapshots, defaultFromSnapshotId, defaultToSnapshotId, onTriggerRun }) => {
  const [branch, setBranch] = useState('main');
  const [fromSnapId, setFromSnapId] = useState(defaultFromSnapshotId);
  const [toSnapId, setToSnapId] = useState(defaultToSnapshotId);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setFromSnapId(defaultFromSnapshotId);
  }, [defaultFromSnapshotId]);

  useEffect(() => {
    setToSnapId(defaultToSnapshotId);
  }, [defaultToSnapshotId]);

  const handleRun = async () => {
    setRunning(true);
    try {
      await onTriggerRun(branch.trim() || 'main', fromSnapId || undefined, toSnapId || undefined);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex-1 bg-[#FCFCFD] overflow-y-auto p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="bg-white border border-[#E5E7EB] rounded-lg p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-[16px] font-semibold text-[#111827]">Schema CI Runs</h1>
              <p className="text-[12.5px] text-[#6B7280] mt-0.5">
                Automated lint across snapshot transitions: destructive guards, lock/backfill safety, PK/FK integrity, and view dependencies.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRun}
              disabled={running}
              className="h-8 px-3.5 rounded-md bg-[#111827] hover:bg-[#1F2937] text-white text-[12.5px] font-medium flex items-center gap-1.5 self-start sm:self-auto shrink-0 cursor-pointer disabled:opacity-60"
            >
              {running ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              Run Lint Check
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-[#F3F4F6]">
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="branch"
              aria-label="Branch name"
              className="h-8 px-2.5 text-[12.5px] font-mono border border-[#E5E7EB] rounded-md bg-white w-40"
            />
            {snapshots.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 text-[12px] text-[#6B7280]">
                  <span>From:</span>
                  <select
                    value={fromSnapId}
                    onChange={(e) => setFromSnapId(e.target.value)}
                    className="h-8 px-2 text-[12px] border border-[#E5E7EB] rounded-md bg-white text-[#111827] max-w-[200px]"
                  >
                    {snapshots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.versionTag} ({s.label})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1.5 text-[12px] text-[#6B7280]">
                  <span>To:</span>
                  <select
                    value={toSnapId}
                    onChange={(e) => setToSnapId(e.target.value)}
                    className="h-8 px-2 text-[12px] border border-[#E5E7EB] rounded-md bg-white text-[#111827] max-w-[200px]"
                  >
                    {snapshots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.versionTag} ({s.label})
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>
        </div>

        {ciRuns.length === 0 ? (
          <div className="bg-white border border-[#E5E7EB] rounded-lg p-8 text-center text-[13px] text-[#6B7280]">
            No CI runs recorded yet. Click &ldquo;Run Lint Check&rdquo; to evaluate your schema.
          </div>
        ) : (
          <div className="space-y-3">
            {ciRuns.map((run) => (
              <div key={run.id} className="bg-white border border-[#E5E7EB] rounded-lg p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    {run.status === 'passed' ? (
                      <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" />
                    ) : run.status === 'failed' ? (
                      <XCircle className="w-4 h-4 text-[#DC2626] shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0" />
                    )}
                    <span className="text-[13.5px] font-semibold text-[#111827]">
                      {run.summary}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[12px] text-[#6B7280] font-mono tabular-nums">
                    <span className="flex items-center gap-1">
                      <GitBranch className="w-3.5 h-3.5" />
                      {run.branch}
                    </span>
                    <span>#{run.commitSha}</span>
                    <span>{run.durationMs}ms</span>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-[#F3F4F6] grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {run.checks.map((c) => (
                    <div
                      key={c.name}
                      className="p-2.5 rounded-md bg-[#FAFAFA] border border-[#E5E7EB] text-[12px]"
                    >
                      <p className="font-medium text-[#111827] flex items-center justify-between gap-2">
                        <span>{c.name}</span>
                        <span
                          className={`text-[11px] font-mono ${
                            c.status === 'passed'
                              ? 'text-[#16A34A]'
                              : c.status === 'failed'
                                ? 'text-[#DC2626]'
                                : 'text-[#D97706]'
                          }`}
                        >
                          {c.status}
                        </span>
                      </p>
                      <p className="text-[#6B7280] mt-1 text-[11.5px]">{c.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* ---------------------------- MIGRATIONS VIEW ---------------------------- */
export const MigrationsView: React.FC<{
  migrations: MigrationDTO[];
  datasources: DatasourceDTO[];
  onCreateMigration: (
    name: string,
    upSql: string,
    downSql: string,
    datasourceId?: string,
  ) => Promise<void>;
  onDryRunMigration: (
    migId: string,
    datasourceId?: string,
  ) => Promise<{ ok: boolean; latencyMs?: number; error?: string }>;
  onApplyMigration: (migId: string, datasourceId?: string) => Promise<void>;
  onRollbackMigration: (migId: string, datasourceId?: string) => Promise<void>;
  onDeleteMigration: (migId: string) => Promise<void>;
}> = ({
  migrations,
  datasources,
  onCreateMigration,
  onDryRunMigration,
  onApplyMigration,
  onRollbackMigration,
  onDeleteMigration,
}) => {
  const [selectedDs, setSelectedDs] = useState<string>('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'apply' | 'dry-run' | 'rollback' | null>(null);
  const [dryRunResult, setDryRunResult] = useState<
    Record<string, { ok: boolean; message: string }>
  >({});

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUpSql, setNewUpSql] = useState('');
  const [newDownSql, setNewDownSql] = useState('');
  const [creating, setCreating] = useState(false);

  const handleApply = async (id: string) => {
    setBusyId(id);
    setBusyAction('apply');
    try {
      await onApplyMigration(id, selectedDs || undefined);
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  };

  const handleDryRun = async (mig: MigrationDTO) => {
    const target = selectedDs || mig.datasourceId || undefined;
    if (!target) {
      setDryRunResult((prev) => ({
        ...prev,
        [mig.id]: {
          ok: false,
          message: 'Select a PostgreSQL datasource above to run a live rolled-back SQL dry-run.',
        },
      }));
      return;
    }
    setBusyId(mig.id);
    setBusyAction('dry-run');
    try {
      const res = await onDryRunMigration(mig.id, target);
      setDryRunResult((prev) => ({
        ...prev,
        [mig.id]: res.ok
          ? {
              ok: true,
              message: `Dry-run succeeded in ${res.latencyMs ?? 0}ms (rolled back cleanly).`,
            }
          : { ok: false, message: res.error || 'Dry-run failed' },
      }));
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  };

  const handleRollback = async (id: string) => {
    setBusyId(id);
    setBusyAction('rollback');
    try {
      await onRollbackMigration(id, selectedDs || undefined);
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newUpSql.trim()) return;
    setCreating(true);
    try {
      await onCreateMigration(
        newName.trim(),
        newUpSql.trim(),
        newDownSql.trim(),
        selectedDs || undefined,
      );
      setNewName('');
      setNewUpSql('');
      setNewDownSql('');
      setShowCreateForm(false);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex-1 bg-[#FCFCFD] overflow-y-auto p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="bg-white border border-[#E5E7EB] rounded-lg p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-[16px] font-semibold text-[#111827]">Migrations Ledger</h1>
              <p className="text-[12.5px] text-[#6B7280] mt-0.5">
                Versioned PostgreSQL up/down migrations. Dry-run inside a rolled-back transaction or execute live on a connected datasource.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedDs}
                onChange={(e) => setSelectedDs(e.target.value)}
                className="h-8 px-2.5 text-[12.5px] border border-[#E5E7EB] rounded-md bg-white text-[#111827]"
              >
                <option value="">Workspace Ledger Only (No Live DB)</option>
                {datasources.map((ds) => (
                  <option key={ds.id} value={ds.id}>
                    Target DB: {ds.name} ({ds.databaseName})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowCreateForm((v) => !v)}
                className="h-8 px-3 rounded-md bg-[#111827] hover:bg-[#1F2937] text-white text-[12.5px] font-medium flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                New Migration
              </button>
            </div>
          </div>

          {showCreateForm && (
            <form
              onSubmit={handleCreateSubmit}
              className="pt-4 border-t border-[#E5E7EB] space-y-3"
            >
              <div>
                <label className="block text-[11.5px] font-medium text-[#374151] mb-1">
                  Migration Name
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. add_shipment_tracking_index"
                  className="w-full h-8 px-3 text-[12.5px] font-mono border border-[#E5E7EB] rounded-md bg-white"
                />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11.5px] font-medium text-[#374151] mb-1">
                    Up SQL (required)
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={newUpSql}
                    onChange={(e) => setNewUpSql(e.target.value)}
                    placeholder="ALTER TABLE public.shipments ADD COLUMN tracking_code text;"
                    className="w-full p-2.5 text-[12px] font-mono border border-[#E5E7EB] rounded-md bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11.5px] font-medium text-[#374151] mb-1">
                    Down SQL (for rollback)
                  </label>
                  <textarea
                    rows={4}
                    value={newDownSql}
                    onChange={(e) => setNewDownSql(e.target.value)}
                    placeholder="ALTER TABLE public.shipments DROP COLUMN IF EXISTS tracking_code;"
                    className="w-full p-2.5 text-[12px] font-mono border border-[#E5E7EB] rounded-md bg-white"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="h-8 px-3 rounded-md border border-[#E5E7EB] bg-white text-[12px] text-[#4B5563] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="h-8 px-3.5 rounded-md bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-[12px] font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save Migration
                </button>
              </div>
            </form>
          )}
        </div>

        {migrations.length === 0 ? (
          <div className="bg-white border border-[#E5E7EB] rounded-lg p-8 text-center text-[13px] text-[#6B7280]">
            No migrations in this workspace yet. Generate one from SQL Plan / Diff or create one manually above.
          </div>
        ) : (
          <div className="space-y-3">
            {migrations.map((mig) => {
              const dryRes = dryRunResult[mig.id];
              const isBusy = busyId === mig.id;
              return (
                <div
                  key={mig.id}
                  className="bg-white border border-[#E5E7EB] rounded-lg overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-[#F3F4F6] flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="font-mono text-[12px] text-[#6B7280] tabular-nums">
                        {mig.version}
                      </span>
                      <span className="text-[13.5px] font-semibold text-[#111827]">
                        {mig.name}
                      </span>
                      <span
                        className={`text-[11.5px] font-medium ${
                          mig.status === 'applied'
                            ? 'text-[#16A34A]'
                            : mig.status === 'failed'
                              ? 'text-[#DC2626]'
                              : 'text-[#D97706]'
                        }`}
                      >
                        · {mig.status}
                      </span>
                      {mig.appliedAt && mig.status === 'applied' && (
                        <span className="text-[11px] text-[#9CA3AF]">
                          ({new Date(mig.appliedAt).toLocaleString()})
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {mig.status !== 'applied' && (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleDryRun(mig)}
                            title={
                              selectedDs || mig.datasourceId
                                ? 'Validate SQL inside BEGIN ... ROLLBACK on target PostgreSQL'
                                : 'Select a target PostgreSQL datasource above first'
                            }
                            className="h-7 px-2.5 rounded border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] text-[#374151] text-[12px] font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                          >
                            {isBusy && busyAction === 'dry-run' ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <FlaskConical className="w-3 h-3" />
                            )}
                            Dry Run
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleApply(mig.id)}
                            className="h-7 px-3 rounded bg-[#111827] hover:bg-[#1F2937] text-white text-[12px] font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                          >
                            {isBusy && busyAction === 'apply' ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Play className="w-3 h-3" />
                            )}
                            Apply Migration
                          </button>
                        </>
                      )}

                      {mig.status === 'applied' && mig.downSql.trim().length > 0 && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleRollback(mig.id)}
                          className="h-7 px-2.5 rounded border border-[#E5E7EB] bg-white hover:bg-[#FEF2F2] hover:text-[#DC2626] hover:border-[#FECACA] text-[#374151] text-[12px] font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                        >
                          {isBusy && busyAction === 'rollback' ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RotateCcw className="w-3 h-3" />
                          )}
                          Rollback
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onDeleteMigration(mig.id)}
                        title="Delete migration from ledger"
                        className="p-1.5 rounded hover:bg-[#FEF2F2] text-[#6B7280] hover:text-[#DC2626] cursor-pointer disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {dryRes && (
                    <div
                      className={`px-4 py-2 text-[12px] border-b border-[#E5E7EB] flex items-center gap-2 ${
                        dryRes.ok
                          ? 'bg-[#F0FDF4] text-[#15803D]'
                          : 'bg-[#FEF2F2] text-[#B91C1C]'
                      }`}
                    >
                      {dryRes.ok ? (
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <span>{dryRes.message}</span>
                    </div>
                  )}

                  <div className="p-3.5 bg-[#FAFAFA] grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[#6B7280] mb-1">
                        Up SQL
                      </p>
                      <pre className="p-2.5 rounded bg-white border border-[#E5E7EB] font-mono text-[11.5px] text-[#111827] overflow-x-auto whitespace-pre-wrap">
                        {mig.upSql}
                      </pre>
                    </div>
                    <div>
                      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[#6B7280] mb-1">
                        Down SQL
                      </p>
                      <pre className="p-2.5 rounded bg-white border border-[#E5E7EB] font-mono text-[11.5px] text-[#6B7280] overflow-x-auto whitespace-pre-wrap">
                        {mig.downSql || '-- Irreversible'}
                      </pre>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

/* ---------------------------- WEBHOOKS VIEW ---------------------------- */
const AVAILABLE_WEBHOOK_EVENTS = [
  'schema.diff.detected',
  'migration.applied',
  'migration.rolled_back',
  'ci.run.completed',
  'tag.created',
] as const;

export const WebhooksView: React.FC<{
  webhooks: WebhookDTO[];
  onCreateWebhook: (name: string, url: string, events: string[]) => Promise<void>;
  onToggleWebhook: (id: string, enabled: boolean) => Promise<void>;
  onTestWebhook: (
    id: string,
  ) => Promise<{
    ok: boolean;
    status?: number;
    statusText?: string;
    latencyMs?: number;
    error?: string;
  }>;
  onDeleteWebhook: (id: string) => Promise<void>;
}> = ({ webhooks, onCreateWebhook, onToggleWebhook, onTestWebhook, onDeleteWebhook }) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([
    'schema.diff.detected',
    'migration.applied',
  ]);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; label: string }>
  >({});

  const toggleEvent = (evt: string) => {
    setSelectedEvents((prev) => {
      if (prev.includes(evt)) {
        return prev.length > 1 ? prev.filter((e) => e !== evt) : prev;
      }
      return [...prev, evt];
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;
    try {
      await onCreateWebhook(name.trim(), url.trim(), selectedEvents);
      setName('');
      setUrl('');
    } catch {
      // Error toast is handled by parent
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const res = await onTestWebhook(id);
      setTestResults((prev) => ({
        ...prev,
        [id]: res.ok
          ? {
              ok: true,
              label: `HTTP ${res.status ?? 200} ${res.statusText || 'OK'} · ${res.latencyMs ?? 0}ms`,
            }
          : {
              ok: false,
              label: res.error
                ? res.error
                : `HTTP ${res.status ?? 'ERR'} ${res.statusText || 'Failed'}`,
            },
      }));
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="flex-1 bg-[#FCFCFD] overflow-y-auto p-4 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="bg-white border border-[#E5E7EB] rounded-lg p-5">
          <h1 className="text-[16px] font-semibold text-[#111827]">Webhooks</h1>
          <p className="text-[12.5px] text-[#6B7280] mt-0.5">
            Receive real HTTP POST notifications when schema changes, CI runs, migrations, or tags occur.
          </p>

          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Webhook label (e.g. Discord Alerts)"
                className="h-9 px-3 text-[12.5px] border border-[#E5E7EB] rounded-md flex-1"
              />
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://hooks.example.com/..."
                className="h-9 px-3 text-[12.5px] font-mono border border-[#E5E7EB] rounded-md flex-1"
              />
              <button
                type="submit"
                className="h-9 px-4 bg-[#111827] hover:bg-[#1F2937] text-white text-[12.5px] font-medium rounded-md flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Webhook
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
              <span className="text-[11.5px] font-medium text-[#6B7280]">Events:</span>
              {AVAILABLE_WEBHOOK_EVENTS.map((evt) => (
                <label
                  key={evt}
                  className="inline-flex items-center gap-1.5 text-[12px] font-mono text-[#374151] cursor-pointer select-none"
                >
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(evt)}
                    onChange={() => toggleEvent(evt)}
                    className="rounded border-[#D1D5DB] text-[#1D4ED8]"
                  />
                  <span>{evt}</span>
                </label>
              ))}
            </div>
          </form>
        </div>

        {webhooks.length === 0 ? (
          <div className="bg-white border border-[#E5E7EB] rounded-lg p-8 text-center text-[13px] text-[#6B7280]">
            No webhooks configured yet. Add an HTTPS endpoint above to receive event payloads.
          </div>
        ) : (
          <div className="bg-white border border-[#E5E7EB] rounded-lg divide-y divide-[#F3F4F6]">
            {webhooks.map((wh) => {
              const testRes = testResults[wh.id];
              return (
                <div key={wh.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-[#4B5563]" />
                      <span className="text-[13.5px] font-semibold text-[#111827]">{wh.name}</span>
                      {wh.lastTriggeredAt && (
                        <span className="text-[11px] text-[#9CA3AF]">
                          · Last triggered {new Date(wh.lastTriggeredAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] font-mono text-[#6B7280] truncate mt-0.5">{wh.url}</p>
                    <p className="text-[11.5px] text-[#9CA3AF] mt-1">{wh.events.join(' · ')}</p>
                    {testRes && (
                      <p
                        className={`text-[11.5px] font-mono mt-1 ${
                          testRes.ok ? 'text-[#16A34A]' : 'text-[#DC2626]'
                        }`}
                      >
                        Test ping: {testRes.label}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      disabled={testingId === wh.id}
                      onClick={() => handleTest(wh.id)}
                      className="h-7 px-2.5 rounded border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] text-[12px] font-medium text-[#374151] flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                    >
                      {testingId === wh.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Send className="w-3 h-3" />
                      )}
                      Test
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleWebhook(wh.id, !wh.enabled)}
                      aria-label={wh.enabled ? 'Disable webhook' : 'Enable webhook'}
                      className={`w-9 h-5 rounded-full p-0.5 transition-colors flex items-center cursor-pointer ${
                        wh.enabled ? 'bg-[#1D4ED8]' : 'bg-[#D1D5DB]'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded-full bg-white transition-transform ${
                          wh.enabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteWebhook(wh.id)}
                      className="p-1.5 rounded hover:bg-[#FEF2F2] text-[#6B7280] hover:text-[#DC2626] cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

/* ---------------------------- TAGS VIEW ---------------------------- */
const TAG_COLORS = ['#1D4ED8', '#16A34A', '#7C3AED', '#D97706', '#DC2626'] as const;

export const TagsView: React.FC<{
  tags: TagDTO[];
  snapshots: SchemaSnapshotDTO[];
  onCreateTag: (name: string, color: string, snapshotId: string | null, description: string) => Promise<void>;
  onDeleteTag: (id: string) => Promise<void>;
  onSelectSnapshot?: (snapshotId: string) => void;
}> = ({ tags, snapshots, onCreateTag, onDeleteTag, onSelectSnapshot }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<string>(TAG_COLORS[0]);
  const [snapshotId, setSnapshotId] = useState(snapshots[snapshots.length - 1]?.id || '');

  useEffect(() => {
    if (snapshots.length === 0) {
      setSnapshotId('');
    } else if (!snapshots.some((s) => s.id === snapshotId)) {
      setSnapshotId(snapshots[snapshots.length - 1].id);
    }
  }, [snapshots, snapshotId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await onCreateTag(name.trim(), color, snapshotId || null, description.trim());
      setName('');
      setDescription('');
    } catch {
      // Error toast is handled by parent
    }
  };

  return (
    <div className="flex-1 bg-[#FCFCFD] overflow-y-auto p-4 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="bg-white border border-[#E5E7EB] rounded-lg p-5">
          <h1 className="text-[16px] font-semibold text-[#111827]">Schema Release Tags</h1>
          <p className="text-[12.5px] text-[#6B7280] mt-0.5">
            Pin human-readable release tags to immutable schema snapshots and jump straight to any release in the ERD.
          </p>

          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="v2024.03-release"
                className="h-9 px-3 text-[12.5px] font-mono border border-[#E5E7EB] rounded-md"
              />
              <select
                value={snapshotId}
                onChange={(e) => setSnapshotId(e.target.value)}
                className="h-9 px-2.5 text-[12.5px] border border-[#E5E7EB] rounded-md bg-white"
              >
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.versionTag} ({s.label})
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Release notes..."
                className="h-9 px-3 text-[12.5px] border border-[#E5E7EB] rounded-md"
              />
              <button
                type="submit"
                className="h-9 px-4 bg-[#111827] hover:bg-[#1F2937] text-white text-[12.5px] font-medium rounded-md flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Create Tag
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11.5px] font-medium text-[#6B7280]">Tag color:</span>
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Select color ${c}`}
                  className={`w-5 h-5 rounded-full cursor-pointer transition-transform ${
                    color === c ? 'ring-2 ring-offset-2 ring-[#111827] scale-110' : 'opacity-80 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </form>
        </div>

        {tags.length === 0 ? (
          <div className="bg-white border border-[#E5E7EB] rounded-lg p-8 text-center text-[13px] text-[#6B7280]">
            No release tags created yet.
          </div>
        ) : (
          <div className="bg-white border border-[#E5E7EB] rounded-lg divide-y divide-[#F3F4F6]">
            {tags.map((t) => {
              const snap = snapshots.find((s) => s.id === t.targetSnapshotId);
              return (
                <div key={t.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <TagIcon className="w-3.5 h-3.5" style={{ color: t.color }} />
                      <span className="font-mono text-[13px] font-semibold text-[#111827]">
                        {t.name}
                      </span>
                      {snap && (
                        <span className="text-[11.5px] font-mono text-[#6B7280]">
                          → {snap.versionTag} ({snap.schemaJson.nodes.length} objects)
                        </span>
                      )}
                    </div>
                    {t.description && (
                      <p className="text-[12px] text-[#6B7280] mt-0.5">{t.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {snap && onSelectSnapshot && (
                      <button
                        type="button"
                        onClick={() => onSelectSnapshot(snap.id)}
                        className="h-7 px-2.5 rounded border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] text-[12px] font-medium text-[#1D4ED8] flex items-center gap-1.5 cursor-pointer"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Open in ERD
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDeleteTag(t.id)}
                      className="p-1.5 rounded hover:bg-[#FEF2F2] text-[#6B7280] hover:text-[#DC2626] cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

/* ---------------------------- SETTINGS & DATASOURCES VIEW ---------------------------- */
interface SettingsViewProps {
  workspace: WorkspaceDTO;
  datasources: DatasourceDTO[];
  storageMode: 'postgresql' | 'memory';
  isAuthenticated: boolean;
  onRequireAuth: () => void;
  onConnectPrimaryDb: (params: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    sslMode: 'require' | 'prefer' | 'disable';
  }) => Promise<void>;
  onTestDatasourceDraft: (params: {
    host: string;
    port: number;
    databaseName: string;
    username: string;
    password: string;
    sslMode: 'require' | 'prefer' | 'disable';
  }) => Promise<{ ok: boolean; version?: string; latencyMs?: number; error?: string }>;
  onCreateDatasource: (params: {
    name: string;
    host: string;
    port: number;
    databaseName: string;
    username: string;
    password: string;
    sslMode: 'require' | 'prefer' | 'disable';
  }) => Promise<void>;
  onTestSavedDatasource: (dsId: string) => Promise<{ ok: boolean; version?: string; latencyMs?: number; error?: string }>;
  onUpdateDatasourcePassword: (dsId: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  onListDatasourceSchemas: (dsId: string) => Promise<{ schema: string; tableCount: number }[]>;
  onIntrospectDatasource: (dsId: string, schemas?: string[]) => Promise<void>;
  onDeleteDatasource: (dsId: string) => Promise<void>;
  onRenameWorkspace: (orgSlug: string, name: string) => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  workspace,
  datasources,
  storageMode,
  isAuthenticated,
  onRequireAuth,
  onConnectPrimaryDb,
  onTestDatasourceDraft,
  onCreateDatasource,
  onTestSavedDatasource,
  onUpdateDatasourcePassword,
  onListDatasourceSchemas,
  onIntrospectDatasource,
  onDeleteDatasource,
  onRenameWorkspace,
}) => {
  const [dsName, setDsName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5432');
  const [databaseName, setDatabaseName] = useState('postgres');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [sslMode, setSslMode] = useState<'require' | 'prefer' | 'disable'>('require');

  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bindingPrimary, setBindingPrimary] = useState(false);
  const [introspectingId, setIntrospectingId] = useState<string | null>(null);
  const [loadingSchemasId, setLoadingSchemasId] = useState<string | null>(null);
  const [schemasByDs, setSchemasByDs] = useState<
    Record<string, { schema: string; tableCount: number }[]>
  >({});
  const [selectedSchemaByDs, setSelectedSchemaByDs] = useState<Record<string, string>>({});
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const [orgSlug, setOrgSlug] = useState(workspace.orgSlug);
  const [wsName, setWsName] = useState(workspace.name);

  useEffect(() => {
    setOrgSlug(workspace.orgSlug);
    setWsName(workspace.name);
  }, [workspace.id, workspace.orgSlug, workspace.name]);

  const handleTest = async () => {
    if (!isAuthenticated) {
      onRequireAuth();
      return;
    }
    setTesting(true);
    setFeedback(null);
    try {
      const res = await onTestDatasourceDraft({
        host,
        port: Number(port) || 5432,
        databaseName,
        username,
        password,
        sslMode,
      });
      if (res.ok) {
        setFeedback({
          ok: true,
          text: `Connected successfully (${res.version}, ${res.latencyMs}ms)`,
        });
      } else {
        setFeedback({ ok: false, text: res.error || 'Connection failed' });
      }
    } finally {
      setTesting(false);
    }
  };

  const handleSaveDatasource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      onRequireAuth();
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await onCreateDatasource({
        name: dsName || `${host}/${databaseName}`,
        host,
        port: Number(port) || 5432,
        databaseName,
        username,
        password,
        sslMode,
      });
      setDsName('');
      setPassword('');
      setFeedback({ ok: true, text: 'Datasource saved with AES-256-GCM encrypted credentials.' });
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to save datasource',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleBindPrimaryStorage = async () => {
    setBindingPrimary(true);
    setFeedback(null);
    try {
      await onConnectPrimaryDb({
        host,
        port: Number(port) || 5432,
        database: databaseName,
        username,
        password,
        sslMode,
      });
      setFeedback({
        ok: true,
        text: 'Primary Drizzle ORM storage is now bound to PostgreSQL.',
      });
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to bind PostgreSQL storage',
      });
    } finally {
      setBindingPrimary(false);
    }
  };

  return (
    <div className="flex-1 bg-[#FCFCFD] overflow-y-auto p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Storage & Drizzle ORM Status Banner */}
        <div className="bg-white border border-[#E5E7EB] rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Server className="w-5 h-5 text-[#374151] mt-0.5 shrink-0" />
            <div>
              <h2 className="text-[14.5px] font-semibold text-[#111827]">
                Drizzle ORM Persistence Backend
              </h2>
              <p className="text-[12.5px] text-[#6B7280] mt-0.5">
                {storageMode === 'postgresql'
                  ? 'Connected to PostgreSQL via Drizzle ORM. All workspaces, snapshots, datasources, and migrations persist in PostgreSQL.'
                  : 'Running in preview memory mode. Connect a PostgreSQL instance below (or set DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD in Secrets) to persist data with Drizzle ORM.'}
              </p>
            </div>
          </div>
          <span
            className={`text-[12px] font-mono font-semibold whitespace-nowrap shrink-0 ${
              storageMode === 'postgresql' ? 'text-[#16A34A]' : 'text-[#D97706]'
            }`}
          >
            {storageMode === 'postgresql' ? 'PostgreSQL Active' : 'Memory Fallback'}
          </span>
        </div>

        {/* Add PostgreSQL Datasource Connection */}
        <div className="bg-white border border-[#E5E7EB] rounded-lg p-5">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#F3F4F6]">
            <div>
              <h1 className="text-[15.5px] font-semibold text-[#111827]">
                PostgreSQL Datasource Connections
              </h1>
              <p className="text-[12.5px] text-[#6B7280] mt-0.5">
                Add external PostgreSQL databases (Supabase, Neon, RDS, self-hosted) to introspect live schemas into the ERD or run migrations.
              </p>
            </div>
            {!isAuthenticated && (
              <button
                type="button"
                onClick={onRequireAuth}
                className="h-8 px-3 rounded-md bg-[#111827] text-white text-[12px] font-medium flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                Sign In to Save
              </button>
            )}
          </div>

          <form onSubmit={handleSaveDatasource} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11.5px] font-medium text-[#374151] mb-1">
                  Connection Label
                </label>
                <input
                  type="text"
                  value={dsName}
                  onChange={(e) => setDsName(e.target.value)}
                  placeholder="Production Supabase"
                  className="w-full h-9 px-3 text-[12.5px] border border-[#E5E7EB] rounded-md"
                />
              </div>

              <div>
                <label className="block text-[11.5px] font-medium text-[#374151] mb-1">
                  Host
                </label>
                <input
                  type="text"
                  required
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="aws-1-ap-northeast-2.pooler.supabase.com"
                  className="w-full h-9 px-3 text-[12.5px] font-mono border border-[#E5E7EB] rounded-md"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11.5px] font-medium text-[#374151] mb-1">
                    Port
                  </label>
                  <input
                    type="number"
                    required
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    className="w-full h-9 px-3 text-[12.5px] font-mono border border-[#E5E7EB] rounded-md tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[11.5px] font-medium text-[#374151] mb-1">
                    SSL Mode
                  </label>
                  <select
                    value={sslMode}
                    onChange={(e) =>
                      setSslMode(e.target.value as 'require' | 'prefer' | 'disable')
                    }
                    className="w-full h-9 px-2.5 text-[12.5px] border border-[#E5E7EB] rounded-md bg-white"
                  >
                    <option value="require">require</option>
                    <option value="prefer">prefer</option>
                    <option value="disable">disable</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11.5px] font-medium text-[#374151] mb-1">
                  Database Name
                </label>
                <input
                  type="text"
                  required
                  value={databaseName}
                  onChange={(e) => setDatabaseName(e.target.value)}
                  placeholder="postgres"
                  className="w-full h-9 px-3 text-[12.5px] font-mono border border-[#E5E7EB] rounded-md"
                />
              </div>

              <div>
                <label className="block text-[11.5px] font-medium text-[#374151] mb-1">
                  Username
                </label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="postgres.projectref"
                  className="w-full h-9 px-3 text-[12.5px] font-mono border border-[#E5E7EB] rounded-md"
                />
              </div>

              <div>
                <label className="block text-[11.5px] font-medium text-[#374151] mb-1">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full h-9 px-3 text-[12.5px] font-mono border border-[#E5E7EB] rounded-md"
                />
              </div>
            </div>

            {feedback && (
              <div
                className={`px-3 py-2 rounded-md border text-[12.5px] flex items-center gap-2 ${
                  feedback.ok
                    ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#15803D]'
                    : 'bg-[#FEF2F2] border-[#FECACA] text-[#DC2626]'
                }`}
              >
                {feedback.ok ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{feedback.text}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleTest}
                disabled={testing || !host || !username || !password}
                className="h-9 px-3.5 rounded-md border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] text-[12.5px] font-medium text-[#111827] flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {testing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                Test Connection
              </button>

              <button
                type="submit"
                disabled={saving || !host || !username || !password}
                className="h-9 px-4 rounded-md bg-[#111827] hover:bg-[#1F2937] text-white text-[12.5px] font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
                Save Datasource
              </button>

              <button
                type="button"
                onClick={handleBindPrimaryStorage}
                disabled={bindingPrimary || !host || !username || !password}
                className="h-9 px-3.5 rounded-md border border-[#BFDBFE] bg-[#EFF6FF] hover:bg-[#DBEAFE] text-[#1D4ED8] text-[12.5px] font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {bindingPrimary ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Database className="w-3.5 h-3.5" />
                )}
                Use as Drizzle App DB
              </button>
            </div>
          </form>

          {/* Saved Datasources Table */}
          <div className="mt-6 border-t border-[#E5E7EB] pt-4">
            <h3 className="text-[13px] font-semibold text-[#111827] mb-3">
              Configured Datasources ({datasources.length})
            </h3>
            {datasources.length === 0 ? (
              <p className="text-[12.5px] text-[#6B7280] py-4 text-center border border-dashed border-[#E5E7EB] rounded-md">
                No external datasources saved yet. Add a PostgreSQL connection above to introspect live tables into your ERD.
              </p>
            ) : (
              <div className="divide-y divide-[#F3F4F6] border border-[#E5E7EB] rounded-md">
                {datasources.map((ds) => (
                  <div key={ds.id} className="p-3.5 space-y-2.5">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Database className="w-4 h-4 text-[#374151] shrink-0" />
                          <span className="text-[13.5px] font-semibold text-[#111827]">
                            {ds.name}
                          </span>
                          <span
                            className={`text-[11.5px] font-medium ${
                              ds.status === 'connected'
                                ? 'text-[#16A34A]'
                                : ds.status === 'error'
                                  ? 'text-[#DC2626]'
                                  : 'text-[#6B7280]'
                            }`}
                          >
                            · {ds.status}
                          </span>
                        </div>
                        <p className="text-[12px] font-mono text-[#6B7280] truncate mt-0.5">
                          {ds.username}@{ds.host}:{ds.port}/{ds.databaseName} (ssl={ds.sslMode})
                        </p>
                        {ds.lastError && (
                          <p className="text-[11.5px] text-[#DC2626] mt-1">{ds.lastError}</p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {schemasByDs[ds.id] ? (
                          <select
                            value={selectedSchemaByDs[ds.id] ?? ''}
                            onChange={(e) =>
                              setSelectedSchemaByDs((prev) => ({
                                ...prev,
                                [ds.id]: e.target.value,
                              }))
                            }
                            className="h-8 px-2 text-[12px] border border-[#E5E7EB] rounded bg-white text-[#111827] max-w-[190px]"
                            title="Target PostgreSQL schema"
                          >
                            <option value="">All User Schemas</option>
                            {schemasByDs[ds.id].map((s) => (
                              <option key={s.schema} value={s.schema}>
                                {s.schema} ({s.tableCount})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <button
                            type="button"
                            disabled={loadingSchemasId === ds.id}
                            onClick={async () => {
                              setLoadingSchemasId(ds.id);
                              try {
                                const list = await onListDatasourceSchemas(ds.id);
                                setSchemasByDs((prev) => ({ ...prev, [ds.id]: list }));
                                if (list.length === 1) {
                                  setSelectedSchemaByDs((prev) => ({
                                    ...prev,
                                    [ds.id]: list[0].schema,
                                  }));
                                }
                              } catch (err) {
                                setFeedback({
                                  ok: false,
                                  text:
                                    err instanceof Error
                                      ? err.message
                                      : 'Failed to load schemas',
                                });
                              } finally {
                                setLoadingSchemasId(null);
                              }
                            }}
                            className="h-8 px-2.5 rounded border border-[#E5E7EB] hover:bg-[#F9FAFB] text-[12px] font-medium text-[#374151] cursor-pointer disabled:opacity-60"
                            title="List schemas in this database"
                          >
                            {loadingSchemasId === ds.id ? 'Loading...' : 'Schemas'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setUnlockingId(unlockingId === ds.id ? null : ds.id);
                            setUnlockPassword('');
                          }}
                          className="h-8 px-2.5 rounded border border-[#E5E7EB] hover:bg-[#F9FAFB] text-[12px] font-medium text-[#374151] flex items-center gap-1 cursor-pointer"
                          title="Update stored password"
                        >
                          <KeyRound className="w-3.5 h-3.5 text-[#6B7280]" />
                          <span>Password</span>
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await onTestSavedDatasource(ds.id);
                            setFeedback({
                              ok: res.ok,
                              text: res.ok
                                ? `${ds.name}: ${res.version} (${res.latencyMs}ms)`
                                : res.error || 'Connection test failed',
                            });
                            if (!res.ok && res.error?.toLowerCase().includes('re-enter')) {
                              setUnlockingId(ds.id);
                            }
                          }}
                          className="h-8 px-2.5 rounded border border-[#E5E7EB] hover:bg-[#F9FAFB] text-[12px] font-medium text-[#374151] cursor-pointer"
                        >
                          Test
                        </button>
                        <button
                          type="button"
                          disabled={introspectingId === ds.id}
                          onClick={async () => {
                            setIntrospectingId(ds.id);
                            try {
                              const chosen = selectedSchemaByDs[ds.id];
                              await onIntrospectDatasource(
                                ds.id,
                                chosen ? [chosen] : undefined,
                              );
                            } finally {
                              setIntrospectingId(null);
                            }
                          }}
                          className="h-8 px-3 rounded bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-[12px] font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                        >
                          {introspectingId === ds.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3.5 h-3.5" />
                          )}
                          Introspect Schema
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteDatasource(ds.id)}
                          className="p-1.5 rounded hover:bg-[#FEF2F2] text-[#6B7280] hover:text-[#DC2626] cursor-pointer"
                          title="Delete datasource"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {unlockingId === ds.id && (
                      <div className="pt-2 border-t border-[#F3F4F6] flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        <input
                          type="password"
                          value={unlockPassword}
                          onChange={(e) => setUnlockPassword(e.target.value)}
                          placeholder={`Enter password for ${ds.username}@${ds.host}`}
                          className="flex-1 h-8 px-2.5 text-[12px] font-mono border border-[#E5E7EB] rounded bg-white"
                        />
                        <button
                          type="button"
                          disabled={unlockLoading || !unlockPassword}
                          onClick={async () => {
                            setUnlockLoading(true);
                            try {
                              const res = await onUpdateDatasourcePassword(ds.id, unlockPassword);
                              if (res.ok) {
                                setUnlockingId(null);
                                setUnlockPassword('');
                                setFeedback({
                                  ok: true,
                                  text: `${ds.name} credentials updated and verified.`,
                                });
                              } else {
                                setFeedback({
                                  ok: false,
                                  text: res.error || 'Failed to verify password',
                                });
                              }
                            } finally {
                              setUnlockLoading(false);
                            }
                          }}
                          className="h-8 px-3 rounded bg-[#111827] hover:bg-[#1F2937] text-white text-[12px] font-medium cursor-pointer disabled:opacity-50"
                        >
                          {unlockLoading ? 'Verifying...' : 'Save & Verify Password'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Workspace Identity Settings */}
        <div className="bg-white border border-[#E5E7EB] rounded-lg p-5">
          <h2 className="text-[14.5px] font-semibold text-[#111827]">Workspace Identity</h2>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div>
              <label className="block text-[11.5px] font-medium text-[#374151] mb-1">
                Organization Slug
              </label>
              <input
                type="text"
                value={orgSlug}
                onChange={(e) => setOrgSlug(e.target.value)}
                className="w-full h-9 px-3 text-[12.5px] border border-[#E5E7EB] rounded-md"
              />
            </div>
            <div>
              <label className="block text-[11.5px] font-medium text-[#374151] mb-1">
                Schema Workspace Name
              </label>
              <input
                type="text"
                value={wsName}
                onChange={(e) => setWsName(e.target.value)}
                className="w-full h-9 px-3 text-[12.5px] border border-[#E5E7EB] rounded-md"
              />
            </div>
            <button
              type="button"
              onClick={() => onRenameWorkspace(orgSlug, wsName)}
              className="h-9 px-4 rounded-md border border-[#E5E7EB] hover:bg-[#F9FAFB] text-[12.5px] font-medium text-[#111827] cursor-pointer"
            >
              Update Workspace
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
