import React, { useState } from 'react';
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
} from 'lucide-react';
import type {
  SchemaGraph,
  DatasourceDTO,
  MigrationDTO,
  CiRunDTO,
  WebhookDTO,
  TagDTO,
  SchemaSnapshotDTO,
  WorkspaceDTO,
} from '../types/schema.ts';

/* ---------------------------- DOCS VIEW ---------------------------- */
export const DocsView: React.FC<{ graph: SchemaGraph; workspace: WorkspaceDTO }> = ({
  graph,
  workspace,
}) => {
  const downloadMarkdown = () => {
    const md = [
      `# ${workspace.orgSlug} / ${workspace.name} Schema Reference`,
      '',
      ...graph.nodes.map((n) => {
        const header = `## ${n.schema}.${n.name} (${n.kind.toUpperCase()})`;
        const rows = n.columns
          .map(
            (c) =>
              `- \`${c.name}\` \`${c.type}\` ${c.nullable ? 'NULL' : 'NOT NULL'}${
                c.isPrimaryKey ? ' [PK]' : ''
              }`,
          )
          .join('\n');
        return `${header}\n\n${rows}\n`;
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
        <div className="bg-white border border-[#E5E7EB] rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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

        <div className="space-y-4">
          {graph.nodes.map((node) => (
            <div
              key={node.id}
              className="bg-white border border-[#E5E7EB] rounded-lg overflow-hidden"
            >
              <div className="px-5 py-3 border-b border-[#E5E7EB] flex items-center justify-between">
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
                </div>
                <span className="text-[12px] text-[#6B7280] tabular-nums">
                  {node.columns.length} columns
                </span>
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
                              ? `FK → ${col.references?.table || 'ref'}`
                              : col.defaultValue || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ---------------------------- CI RUNS VIEW ---------------------------- */
export const CiRunsView: React.FC<{
  ciRuns: CiRunDTO[];
  onTriggerRun: (branch: string) => Promise<void>;
}> = ({ ciRuns, onTriggerRun }) => {
  const [branch, setBranch] = useState('main');
  const [running, setRunning] = useState(false);

  const handleRun = async () => {
    setRunning(true);
    try {
      await onTriggerRun(branch);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex-1 bg-[#FCFCFD] overflow-y-auto p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="bg-white border border-[#E5E7EB] rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-[16px] font-semibold text-[#111827]">Schema CI Runs</h1>
            <p className="text-[12.5px] text-[#6B7280] mt-0.5">
              Automated lint, destructive-change detection, and migration dry-runs.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="branch"
              className="h-8 px-2.5 text-[12.5px] font-mono border border-[#E5E7EB] rounded-md bg-white w-36"
            />
            <button
              type="button"
              onClick={handleRun}
              disabled={running}
              className="h-8 px-3 rounded-md bg-[#111827] hover:bg-[#1F2937] text-white text-[12.5px] font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              {running ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              Run Lint Check
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {ciRuns.map((run) => (
            <div key={run.id} className="bg-white border border-[#E5E7EB] rounded-lg p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  {run.status === 'passed' ? (
                    <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />
                  ) : (
                    <XCircle className="w-4 h-4 text-[#D97706]" />
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

              <div className="mt-3 pt-3 border-t border-[#F3F4F6] grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {run.checks.map((c) => (
                  <div
                    key={c.name}
                    className="p-2.5 rounded-md bg-[#FAFAFA] border border-[#E5E7EB] text-[12px]"
                  >
                    <p className="font-medium text-[#111827] flex items-center justify-between">
                      <span>{c.name}</span>
                      <span
                        className={`text-[11px] font-mono ${
                          c.status === 'passed' ? 'text-[#16A34A]' : 'text-[#D97706]'
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
      </div>
    </div>
  );
};

/* ---------------------------- MIGRATIONS VIEW ---------------------------- */
export const MigrationsView: React.FC<{
  migrations: MigrationDTO[];
  datasources: DatasourceDTO[];
  onApplyMigration: (migId: string, datasourceId?: string) => Promise<void>;
}> = ({ migrations, datasources, onApplyMigration }) => {
  const [selectedDs, setSelectedDs] = useState<string>('');
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const handleApply = async (id: string) => {
    setApplyingId(id);
    try {
      await onApplyMigration(id, selectedDs || undefined);
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <div className="flex-1 bg-[#FCFCFD] overflow-y-auto p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="bg-white border border-[#E5E7EB] rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-[16px] font-semibold text-[#111827]">Migrations Ledger</h1>
            <p className="text-[12.5px] text-[#6B7280] mt-0.5">
              Versioned PostgreSQL up/down migrations. Select a connected datasource to execute transactions live.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedDs}
              onChange={(e) => setSelectedDs(e.target.value)}
              className="h-8 px-2.5 text-[12.5px] border border-[#E5E7EB] rounded-md bg-white text-[#111827]"
            >
              <option value="">Workspace Ledger Only (Dry Run)</option>
              {datasources.map((ds) => (
                <option key={ds.id} value={ds.id}>
                  Execute on: {ds.name} ({ds.databaseName})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-3">
          {migrations.map((mig) => (
            <div
              key={mig.id}
              className="bg-white border border-[#E5E7EB] rounded-lg overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-[#F3F4F6] flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
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
                </div>

                {mig.status !== 'applied' && (
                  <button
                    type="button"
                    disabled={applyingId === mig.id}
                    onClick={() => handleApply(mig.id)}
                    className="h-7 px-3 rounded bg-[#111827] hover:bg-[#1F2937] text-white text-[12px] font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    {applyingId === mig.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Play className="w-3 h-3" />
                    )}
                    Apply Migration
                  </button>
                )}
              </div>
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
          ))}
        </div>
      </div>
    </div>
  );
};

/* ---------------------------- WEBHOOKS VIEW ---------------------------- */
export const WebhooksView: React.FC<{
  webhooks: WebhookDTO[];
  onCreateWebhook: (name: string, url: string, events: string[]) => Promise<void>;
  onToggleWebhook: (id: string, enabled: boolean) => Promise<void>;
  onDeleteWebhook: (id: string) => Promise<void>;
}> = ({ webhooks, onCreateWebhook, onToggleWebhook, onDeleteWebhook }) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;
    await onCreateWebhook(name.trim(), url.trim(), ['schema.diff.detected', 'migration.applied']);
    setName('');
    setUrl('');
  };

  return (
    <div className="flex-1 bg-[#FCFCFD] overflow-y-auto p-4 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="bg-white border border-[#E5E7EB] rounded-lg p-5">
          <h1 className="text-[16px] font-semibold text-[#111827]">Webhooks</h1>
          <p className="text-[12.5px] text-[#6B7280] mt-0.5">
            Receive HTTP POST notifications when schema diffs or PostgreSQL migrations occur.
          </p>

          <form onSubmit={handleSubmit} className="mt-4 flex flex-col sm:flex-row gap-2.5">
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
          </form>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-lg divide-y divide-[#F3F4F6]">
          {webhooks.map((wh) => (
            <div key={wh.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-[#4B5563]" />
                  <span className="text-[13.5px] font-semibold text-[#111827]">{wh.name}</span>
                </div>
                <p className="text-[12px] font-mono text-[#6B7280] truncate mt-0.5">{wh.url}</p>
                <p className="text-[11.5px] text-[#9CA3AF] mt-1">{wh.events.join(' · ')}</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onToggleWebhook(wh.id, !wh.enabled)}
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
          ))}
        </div>
      </div>
    </div>
  );
};

/* ---------------------------- TAGS VIEW ---------------------------- */
export const TagsView: React.FC<{
  tags: TagDTO[];
  snapshots: SchemaSnapshotDTO[];
  onCreateTag: (name: string, color: string, snapshotId: string | null, description: string) => Promise<void>;
  onDeleteTag: (id: string) => Promise<void>;
}> = ({ tags, snapshots, onCreateTag, onDeleteTag }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [snapshotId, setSnapshotId] = useState(snapshots[snapshots.length - 1]?.id || '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await onCreateTag(name.trim(), '#1D4ED8', snapshotId || null, description.trim());
    setName('');
    setDescription('');
  };

  return (
    <div className="flex-1 bg-[#FCFCFD] overflow-y-auto p-4 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="bg-white border border-[#E5E7EB] rounded-lg p-5">
          <h1 className="text-[16px] font-semibold text-[#111827]">Schema Release Tags</h1>
          <p className="text-[12.5px] text-[#6B7280] mt-0.5">
            Pin human-readable release tags to immutable schema snapshots.
          </p>

          <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-2.5">
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
          </form>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-lg divide-y divide-[#F3F4F6]">
          {tags.map((t) => {
            const snap = snapshots.find((s) => s.id === t.targetSnapshotId);
            return (
              <div key={t.id} className="p-4 flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <TagIcon className="w-3.5 h-3.5" style={{ color: t.color }} />
                    <span className="font-mono text-[13px] font-semibold text-[#111827]">
                      {t.name}
                    </span>
                    {snap && (
                      <span className="text-[11.5px] font-mono text-[#6B7280]">
                        → {snap.versionTag}
                      </span>
                    )}
                  </div>
                  {t.description && (
                    <p className="text-[12px] text-[#6B7280] mt-0.5">{t.description}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteTag(t.id)}
                  className="p-1.5 rounded hover:bg-[#FEF2F2] text-[#6B7280] hover:text-[#DC2626] cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
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
