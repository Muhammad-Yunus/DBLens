import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Upload } from 'lucide-react';
import { TopHeader } from './components/TopHeader.tsx';
import { PrimaryNav, type PrimaryTabId } from './components/PrimaryNav.tsx';
import { SchemaSidebar } from './components/SchemaSidebar.tsx';
import { ErdCanvas } from './components/ErdCanvas.tsx';
import { SqlPlanView, CodeDiffView } from './components/DiffViews.tsx';
import {
  DocsView,
  CiRunsView,
  MigrationsView,
  WebhooksView,
  TagsView,
  SettingsView,
} from './components/SecondaryTabs.tsx';
import { AuthModal } from './components/AuthModal.tsx';
import {
  NodeEditorModal,
  RelationModal,
  ExportModal,
} from './components/ErdBuilderModals.tsx';
import { computeClientSchemaDiff } from './utils/clientDiff.ts';
import type {
  AuthUserDTO,
  WorkspaceDTO,
  WorkspaceBundle,
  SchemaGraph,
  SchemaTableNode,
  NodeKind,
} from './types/schema.ts';

type OverviewSubTab = 'erd' | 'sql-plan' | 'hcl-diff' | 'sql-diff';

export default function App() {
  // Responsive sidebar default: open on desktop (>= 1024px), drawer on mobile/tablet
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
  );
  const [primaryTab, setPrimaryTab] = useState<PrimaryTabId>('overview');
  const [overviewSubTab, setOverviewSubTab] = useState<OverviewSubTab>('erd');

  // Auth & Storage Status (token strictly in React memory)
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUserDTO | null>(null);
  const [hasUsers, setHasUsers] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  // Workspace Data
  const [workspaces, setWorkspaces] = useState<WorkspaceDTO[]>([]);
  const [bundle, setBundle] = useState<WorkspaceBundle | null>(null);
  const [fromSnapshotId, setFromSnapshotId] = useState<string>('');
  const [toSnapshotId, setToSnapshotId] = useState<string>('');
  const [diffEnabled, setDiffEnabled] = useState<boolean>(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [schemaFilter, setSchemaFilter] = useState<string>('ALL');

  // Local editable graph overlay for instant ERD Builder feedback
  const [draftGraph, setDraftGraph] = useState<SchemaGraph | null>(null);
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false);

  // Modals
  const [nodeEditorOpen, setNodeEditorOpen] = useState(false);
  const [nodeEditorKind, setNodeEditorKind] = useState<NodeKind>('table');
  const [editingNode, setEditingNode] = useState<SchemaTableNode | null>(null);
  const [relationModalOpen, setRelationModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);

  // Toast & Notifications
  const [toast, setToast] = useState<{ text: string; isError?: boolean } | null>(null);
  const [notifications, setNotifications] = useState<
    { id: string; title: string; time: string }[]
  >([
    {
      id: 'n1',
      title: 'Schema diff detected: +price on Products, +price_avgs view',
      time: 'Just now',
    },
    {
      id: 'n2',
      title: 'CI check passed on feat/pricing-analytics-view',
      time: '18h ago',
    },
  ]);

  const showToast = useCallback((text: string, isError = false) => {
    setToast({ text, isError });
    setTimeout(() => {
      setToast((curr) => (curr?.text === text ? null : curr));
    }, 3400);
  }, []);

  const pushNotification = useCallback((title: string) => {
    setNotifications((prev) => [
      { id: `n_${Date.now()}`, title, time: 'Just now' },
      ...prev.slice(0, 12),
    ]);
  }, []);

  const apiFetch = useCallback(
    async <T,>(url: string, options: RequestInit = {}, overrideToken?: string): Promise<T> => {
      const headers = new Headers(options.headers);
      if (!headers.has('Content-Type') && options.body) {
        headers.set('Content-Type', 'application/json');
      }
      const activeToken = overrideToken ?? token;
      if (activeToken) {
        headers.set('Authorization', `Bearer ${activeToken}`);
      }
      const res = await fetch(url, { ...options, headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
      }
      return data as T;
    },
    [token],
  );

  const loadWorkspaceBundle = useCallback(
    async (workspaceId: string, overrideToken?: string) => {
      const data = await apiFetch<WorkspaceBundle>(
        `/api/workspaces/${workspaceId}/bundle`,
        {},
        overrideToken,
      );
      setBundle(data);
      setFromSnapshotId(data.workspace.baselineSnapshotId);
      setToSnapshotId(data.workspace.activeSnapshotId);
      setDraftGraph(null);
      setHasUnsavedEdits(false);
      setSchemaFilter('ALL');
    },
    [apiFetch],
  );

  // Initial Boot: load auth status + public preview matching mockup
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [statusRes, previewRes] = await Promise.all([
          fetch('/api/auth/status').then((r) => r.json()),
          fetch('/api/preview').then((r) => r.json()),
        ]);
        if (cancelled) return;
        setHasUsers(Boolean(statusRes.hasUsers));
        const previewBundle = previewRes as WorkspaceBundle;
        setBundle(previewBundle);
        setWorkspaces([previewBundle.workspace]);
        setFromSnapshotId(previewBundle.workspace.baselineSnapshotId);
        setToSnapshotId(previewBundle.workspace.activeSnapshotId);
      } catch {
        if (!cancelled) showToast('Failed to initialize DBLens workspace', true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  const handleLogin = async (email: string, password: string) => {
    const res = await apiFetch<{ user: AuthUserDTO; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setToken(res.token);
    setUser(res.user);
    setHasUsers(true);
    const wsList = await apiFetch<{ workspaces: WorkspaceDTO[] }>(
      '/api/workspaces',
      {},
      res.token,
    );
    setWorkspaces(wsList.workspaces);
    if (wsList.workspaces[0]) {
      await loadWorkspaceBundle(wsList.workspaces[0].id, res.token);
    }
    showToast(`Signed in as ${res.user.name}`);
  };

  const handleRegister = async (name: string, email: string, password: string) => {
    const res = await apiFetch<{ user: AuthUserDTO; token: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    });
    setToken(res.token);
    setUser(res.user);
    setHasUsers(true);
    const wsList = await apiFetch<{ workspaces: WorkspaceDTO[] }>(
      '/api/workspaces',
      {},
      res.token,
    );
    setWorkspaces(wsList.workspaces);
    if (wsList.workspaces[0]) {
      await loadWorkspaceBundle(wsList.workspaces[0].id, res.token);
    }
    showToast(`Welcome, ${res.user.name} (${res.user.role})`);
  };

  const handleLogout = async () => {
    try {
      if (token) {
        await apiFetch('/api/auth/logout', { method: 'POST' });
      }
    } catch {
      // Ignore logout network error
    }
    setToken(null);
    setUser(null);
    const preview = await fetch('/api/preview').then((r) => r.json());
    setBundle(preview);
    setWorkspaces([preview.workspace]);
    setFromSnapshotId(preview.workspace.baselineSnapshotId);
    setToSnapshotId(preview.workspace.activeSnapshotId);
    setDraftGraph(null);
    setHasUnsavedEdits(false);
    setSchemaFilter('ALL');
    showToast('Signed out');
  };

  const requireAuthenticated = (): boolean => {
    if (!token || !user) {
      setAuthModalOpen(true);
      return false;
    }
    return true;
  };

  const activeSnapshots = bundle?.snapshots ?? [];
  const fromSnap =
    activeSnapshots.find((s) => s.id === fromSnapshotId) ?? activeSnapshots[0];
  const toSnap =
    activeSnapshots.find((s) => s.id === toSnapshotId) ??
    activeSnapshots[activeSnapshots.length - 1];

  const activeGraph: SchemaGraph = useMemo(() => {
    if (draftGraph) return draftGraph;
    return toSnap?.schemaJson ?? { dialect: 'postgresql', nodes: [], relations: [] };
  }, [draftGraph, toSnap]);

  const baselineGraph: SchemaGraph = useMemo(() => {
    return fromSnap?.schemaJson ?? { dialect: 'postgresql', nodes: [], relations: [] };
  }, [fromSnap]);

  const availableSchemas = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of activeGraph.nodes) {
      const s = node.schema || 'public';
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([schema, count]) => ({ schema, count }))
      .sort((a, b) => a.schema.localeCompare(b.schema));
  }, [activeGraph.nodes]);

  const activeSchemaFilter =
    schemaFilter !== 'ALL' && availableSchemas.some((s) => s.schema === schemaFilter)
      ? schemaFilter
      : 'ALL';

  const filteredGraph: SchemaGraph = useMemo(() => {
    if (activeSchemaFilter === 'ALL' || availableSchemas.length <= 1) {
      return activeGraph;
    }
    const nodes = activeGraph.nodes.filter(
      (n) => (n.schema || 'public') === activeSchemaFilter,
    );
    const nodeIds = new Set(nodes.map((n) => n.id));
    const relations = activeGraph.relations.filter(
      (r) => nodeIds.has(r.sourceId) && nodeIds.has(r.targetId),
    );
    return { ...activeGraph, nodes, relations };
  }, [activeGraph, activeSchemaFilter, availableSchemas.length]);

  const computedDiff = useMemo(() => {
    return computeClientSchemaDiff(baselineGraph, activeGraph);
  }, [baselineGraph, activeGraph]);

  const handleUpdateGraph = (nextGraph: SchemaGraph) => {
    if (activeSchemaFilter === 'ALL' || availableSchemas.length <= 1) {
      setDraftGraph(nextGraph);
    } else {
      const otherNodes = activeGraph.nodes.filter(
        (n) => (n.schema || 'public') !== activeSchemaFilter,
      );
      const filteredNodeIds = new Set(
        activeGraph.nodes
          .filter((n) => (n.schema || 'public') === activeSchemaFilter)
          .map((n) => n.id),
      );
      const externalRelations = activeGraph.relations.filter(
        (r) => !filteredNodeIds.has(r.sourceId) || !filteredNodeIds.has(r.targetId),
      );
      setDraftGraph({
        ...activeGraph,
        nodes: [...otherNodes, ...nextGraph.nodes],
        relations: [...externalRelations, ...nextGraph.relations],
      });
    }
    setHasUnsavedEdits(true);
  };

  const handleSaveSnapshot = async () => {
    if (!bundle || !toSnap) return;
    if (!requireAuthenticated()) return;
    try {
      await apiFetch(`/api/workspaces/${bundle.workspace.id}/snapshots/${toSnap.id}`, {
        method: 'PUT',
        body: JSON.stringify({ schemaJson: activeGraph }),
      });
      await loadWorkspaceBundle(bundle.workspace.id);
      showToast('Schema snapshot saved');
      pushNotification(`Saved ERD layout & schema changes to ${toSnap.versionTag}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save snapshot', true);
    }
  };

  const handleSaveNodeFromModal = (node: SchemaTableNode, isNew: boolean) => {
    const nextNodes = isNew
      ? [...activeGraph.nodes, node]
      : activeGraph.nodes.map((n) => (n.id === node.id ? node : n));
    handleUpdateGraph({ ...activeGraph, nodes: nextNodes });
    setSelectedNodeId(node.id);
  };

  const handleDeleteNode = (nodeId: string) => {
    handleUpdateGraph({
      ...activeGraph,
      nodes: activeGraph.nodes.filter((n) => n.id !== nodeId),
      relations: activeGraph.relations.filter(
        (r) => r.sourceId !== nodeId && r.targetId !== nodeId,
      ),
    });
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  };

  const handleAddRelation = (
    sourceId: string,
    targetId: string,
    sourceCol: string,
    targetCol: string,
    kind: 'fk' | 'view_dep',
  ) => {
    const srcName = activeGraph.nodes.find((n) => n.id === sourceId)?.name || 'src';
    const tgtName = activeGraph.nodes.find((n) => n.id === targetId)?.name || 'tgt';
    const newRel = {
      id: `rel_${Date.now().toString(36)}`,
      sourceId,
      targetId,
      sourceColumn: sourceCol,
      targetColumn: targetCol,
      kind,
      label: `${srcName}.${sourceCol} -> ${tgtName}.${targetCol}`,
    };
    handleUpdateGraph({
      ...activeGraph,
      relations: [...activeGraph.relations, newRel],
    });
  };

  const handleCreateMigration = async (
    name: string,
    upSql: string,
    downSql: string,
    datasourceId?: string,
  ) => {
    if (!bundle) return;
    if (!requireAuthenticated()) return;
    try {
      await apiFetch(`/api/workspaces/${bundle.workspace.id}/migrations`, {
        method: 'POST',
        body: JSON.stringify({ name, upSql, downSql, datasourceId }),
      });
      await loadWorkspaceBundle(bundle.workspace.id);
      setPrimaryTab('migrations');
      showToast(`Migration "${name}" created`);
      pushNotification(`Created migration ${name}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create migration', true);
    }
  };

  const handleCreateWorkspace = async () => {
    if (!requireAuthenticated()) return;
    const name = `Schema_${workspaces.length + 1}`;
    try {
      const res = await apiFetch<{ workspace: WorkspaceDTO }>('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({ orgSlug: user?.name.toLowerCase().replace(/\s+/g, '-') || 'dblens', name, seedDemo: false }),
      });
      setWorkspaces((prev) => [...prev, res.workspace]);
      await loadWorkspaceBundle(res.workspace.id);
      setPrimaryTab('settings');
      showToast(`Created workspace ${name}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create workspace', true);
    }
  };

  if (!bundle) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-white text-[#6B7280] text-[13px]">
        Loading DBLens workspace...
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-white overflow-hidden">
      {/* Top Bar */}
      <TopHeader
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        workspace={bundle.workspace}
        workspaces={workspaces}
        onSelectWorkspace={async (id) => {
          if (!token) return;
          try {
            await loadWorkspaceBundle(id);
          } catch (err) {
            showToast(
              err instanceof Error ? err.message : 'Failed to switch workspace',
              true,
            );
          }
        }}
        onCreateWorkspace={handleCreateWorkspace}
        user={user}
        storageMode={bundle.storageMode}
        onOpenAuth={() => setAuthModalOpen(true)}
        onLogout={handleLogout}
        notifications={notifications}
        onOpenSettings={() => setPrimaryTab('settings')}
      />

      {/* Primary 7-Tab Nav */}
      <PrimaryNav activeTab={primaryTab} onChangeTab={setPrimaryTab} />

      {/* Main Content Area */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {primaryTab === 'overview' && (
          <>
            <SchemaSidebar
              open={sidebarOpen}
              onCloseMobile={() => setSidebarOpen(false)}
              snapshots={bundle.snapshots}
              fromSnapshotId={fromSnapshotId}
              toSnapshotId={toSnapshotId}
              onChangeSnapshots={(f, t) => {
                setFromSnapshotId(f);
                setToSnapshotId(t);
                setDraftGraph(null);
                setHasUnsavedEdits(false);
                setSchemaFilter('ALL');
              }}
              diffEnabled={diffEnabled}
              onToggleDiff={() => setDiffEnabled((v) => !v)}
              activeGraph={filteredGraph}
              diff={computedDiff}
              selectedNodeId={selectedNodeId}
              availableSchemas={availableSchemas}
              schemaFilter={activeSchemaFilter}
              onChangeSchemaFilter={(s) => {
                setSchemaFilter(s);
                setSelectedNodeId(null);
              }}
              onSelectNode={(id) => {
                setSelectedNodeId(id);
                const clicked = activeGraph.nodes.find((n) => n.id === id);
                if (clicked && clicked.visibleOnCanvas === false) {
                  setDraftGraph({
                    ...activeGraph,
                    nodes: activeGraph.nodes.map((n) =>
                      n.id === id ? { ...n, visibleOnCanvas: true } : n,
                    ),
                  });
                }
                if (window.innerWidth < 1024) setSidebarOpen(false);
              }}
            />

            <div className="flex-1 flex flex-col min-w-0 min-h-0">
              {/* Overview Sub-tabs + Export Bar */}
              <div className="h-11 bg-white border-b border-[#E5E7EB] px-4 sm:px-5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-5 sm:gap-6 h-full overflow-x-auto no-scrollbar">
                  {(
                    [
                      { id: 'erd', label: 'ERD' },
                      { id: 'sql-plan', label: 'SQL Plan' },
                      { id: 'hcl-diff', label: 'HCL Diff' },
                      { id: 'sql-diff', label: 'SQL Diff' },
                    ] as const
                  ).map((tab) => {
                    const active = overviewSubTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setOverviewSubTab(tab.id)}
                        className={`h-full text-[13px] whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
                          active
                            ? 'border-[#111827] text-[#111827] font-semibold'
                            : 'border-transparent text-[#4B5563] hover:text-[#111827] font-medium'
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => setExportModalOpen(true)}
                  className="flex items-center gap-1.5 text-[13px] font-medium text-[#374151] hover:text-[#111827] whitespace-nowrap shrink-0 pl-3 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-[#4B5563]" strokeWidth={1.8} />
                  <span>Export</span>
                </button>
              </div>

              {overviewSubTab === 'erd' && (
                <ErdCanvas
                  graph={filteredGraph}
                  diff={computedDiff}
                  diffEnabled={diffEnabled}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={setSelectedNodeId}
                  onUpdateGraph={handleUpdateGraph}
                  onOpenAddTable={(kind) => {
                    setNodeEditorKind(kind);
                    setEditingNode(null);
                    setNodeEditorOpen(true);
                  }}
                  onOpenEditNode={(node) => {
                    setNodeEditorKind(node.kind);
                    setEditingNode(node);
                    setNodeEditorOpen(true);
                  }}
                  onOpenAddRelation={() => setRelationModalOpen(true)}
                  onSaveSnapshot={handleSaveSnapshot}
                  hasUnsavedEdits={hasUnsavedEdits}
                />
              )}

              {overviewSubTab === 'sql-plan' && (
                <SqlPlanView
                  diff={computedDiff}
                  onCreateMigration={handleCreateMigration}
                />
              )}

              {overviewSubTab === 'hcl-diff' && (
                <CodeDiffView
                  mode="hcl"
                  lines={computedDiff.hclDiff}
                  rawText={computedDiff.hclDiff.map((l) => l.content).join('\n')}
                />
              )}

              {overviewSubTab === 'sql-diff' && (
                <CodeDiffView
                  mode="sql"
                  lines={computedDiff.sqlDiff}
                  rawText={computedDiff.upSql}
                  onCreateMigration={() =>
                    handleCreateMigration(
                      'diff_migration',
                      computedDiff.upSql,
                      computedDiff.downSql,
                    )
                  }
                />
              )}
            </div>
          </>
        )}

        {primaryTab === 'docs' && (
          <DocsView
            graph={activeGraph}
            workspace={bundle.workspace}
            onOpenInErd={(nodeId) => {
              setSelectedNodeId(nodeId);
              setSchemaFilter('ALL');
              setPrimaryTab('overview');
              setOverviewSubTab('erd');
            }}
          />
        )}

        {primaryTab === 'ci-runs' && (
          <CiRunsView
            ciRuns={bundle.ciRuns}
            snapshots={bundle.snapshots}
            defaultFromSnapshotId={fromSnapshotId || bundle.workspace.baselineSnapshotId}
            defaultToSnapshotId={toSnapshotId || bundle.workspace.activeSnapshotId}
            onTriggerRun={async (branch, fromSnapId, toSnapId) => {
              if (!requireAuthenticated()) return;
              try {
                await apiFetch(`/api/workspaces/${bundle.workspace.id}/ci-runs`, {
                  method: 'POST',
                  body: JSON.stringify({
                    branch,
                    fromSnapshotId: fromSnapId,
                    toSnapshotId: toSnapId,
                  }),
                });
                await loadWorkspaceBundle(bundle.workspace.id);
                showToast('Schema CI lint run completed');
              } catch (err) {
                showToast(
                  err instanceof Error ? err.message : 'Failed to run CI check',
                  true,
                );
              }
            }}
          />
        )}

        {primaryTab === 'migrations' && (
          <MigrationsView
            migrations={bundle.migrations}
            datasources={bundle.datasources}
            onCreateMigration={handleCreateMigration}
            onDryRunMigration={async (migId, datasourceId) => {
              if (!requireAuthenticated()) {
                return { ok: false, error: 'Sign in required to run live SQL dry-run.' };
              }
              try {
                return await apiFetch<{ ok: boolean; latencyMs?: number; error?: string }>(
                  `/api/workspaces/${bundle.workspace.id}/migrations/${migId}/dry-run`,
                  {
                    method: 'POST',
                    body: JSON.stringify({ datasourceId }),
                  },
                );
              } catch (err) {
                return {
                  ok: false,
                  error: err instanceof Error ? err.message : 'Dry-run validation failed',
                };
              }
            }}
            onApplyMigration={async (migId, datasourceId) => {
              if (!requireAuthenticated()) return;
              try {
                await apiFetch(
                  `/api/workspaces/${bundle.workspace.id}/migrations/${migId}/apply`,
                  {
                    method: 'POST',
                    body: JSON.stringify({ datasourceId }),
                  },
                );
                await loadWorkspaceBundle(bundle.workspace.id);
                showToast('Migration applied successfully');
                pushNotification('Applied migration to target');
              } catch (err) {
                showToast(
                  err instanceof Error ? err.message : 'Migration failed',
                  true,
                );
              }
            }}
            onRollbackMigration={async (migId, datasourceId) => {
              if (!requireAuthenticated()) return;
              try {
                await apiFetch(
                  `/api/workspaces/${bundle.workspace.id}/migrations/${migId}/rollback`,
                  {
                    method: 'POST',
                    body: JSON.stringify({ datasourceId }),
                  },
                );
                await loadWorkspaceBundle(bundle.workspace.id);
                showToast('Migration rolled back');
                pushNotification('Rolled back migration');
              } catch (err) {
                showToast(
                  err instanceof Error ? err.message : 'Rollback failed',
                  true,
                );
              }
            }}
            onDeleteMigration={async (migId) => {
              if (!requireAuthenticated()) return;
              try {
                await apiFetch(
                  `/api/workspaces/${bundle.workspace.id}/migrations/${migId}`,
                  { method: 'DELETE' },
                );
                await loadWorkspaceBundle(bundle.workspace.id);
                showToast('Migration deleted');
              } catch (err) {
                showToast(
                  err instanceof Error ? err.message : 'Failed to delete migration',
                  true,
                );
              }
            }}
          />
        )}

        {primaryTab === 'webhooks' && (
          <WebhooksView
            webhooks={bundle.webhooks}
            onCreateWebhook={async (name, url, events) => {
              if (!requireAuthenticated()) {
                throw new Error('Authentication required');
              }
              try {
                await apiFetch(`/api/workspaces/${bundle.workspace.id}/webhooks`, {
                  method: 'POST',
                  body: JSON.stringify({ name, url, events }),
                });
                await loadWorkspaceBundle(bundle.workspace.id);
                showToast('Webhook added');
              } catch (err) {
                showToast(
                  err instanceof Error ? err.message : 'Failed to add webhook',
                  true,
                );
                throw err;
              }
            }}
            onToggleWebhook={async (whId, enabled) => {
              if (!requireAuthenticated()) return;
              try {
                await apiFetch(
                  `/api/workspaces/${bundle.workspace.id}/webhooks/${whId}`,
                  {
                    method: 'PATCH',
                    body: JSON.stringify({ enabled }),
                  },
                );
                await loadWorkspaceBundle(bundle.workspace.id);
              } catch (err) {
                showToast(
                  err instanceof Error ? err.message : 'Failed to toggle webhook',
                  true,
                );
              }
            }}
            onTestWebhook={async (whId) => {
              if (!requireAuthenticated()) {
                return { ok: false, error: 'Sign in required' };
              }
              try {
                const res = await apiFetch<{
                  ok: boolean;
                  status?: number;
                  statusText?: string;
                  latencyMs?: number;
                  error?: string;
                }>(`/api/workspaces/${bundle.workspace.id}/webhooks/${whId}/test`, {
                  method: 'POST',
                });
                if (res.ok) {
                  await loadWorkspaceBundle(bundle.workspace.id);
                }
                return res;
              } catch (err) {
                return {
                  ok: false,
                  error: err instanceof Error ? err.message : 'Test request failed',
                };
              }
            }}
            onDeleteWebhook={async (whId) => {
              if (!requireAuthenticated()) return;
              try {
                await apiFetch(
                  `/api/workspaces/${bundle.workspace.id}/webhooks/${whId}`,
                  { method: 'DELETE' },
                );
                await loadWorkspaceBundle(bundle.workspace.id);
                showToast('Webhook removed');
              } catch (err) {
                showToast(
                  err instanceof Error ? err.message : 'Failed to remove webhook',
                  true,
                );
              }
            }}
          />
        )}

        {primaryTab === 'tags' && (
          <TagsView
            tags={bundle.tags}
            snapshots={bundle.snapshots}
            onCreateTag={async (name, color, targetSnapshotId, description) => {
              if (!requireAuthenticated()) {
                throw new Error('Authentication required');
              }
              try {
                await apiFetch(`/api/workspaces/${bundle.workspace.id}/tags`, {
                  method: 'POST',
                  body: JSON.stringify({ name, color, targetSnapshotId, description }),
                });
                await loadWorkspaceBundle(bundle.workspace.id);
                showToast(`Tag ${name} created`);
              } catch (err) {
                showToast(
                  err instanceof Error ? err.message : 'Failed to create tag',
                  true,
                );
                throw err;
              }
            }}
            onDeleteTag={async (tagId) => {
              if (!requireAuthenticated()) return;
              try {
                await apiFetch(`/api/workspaces/${bundle.workspace.id}/tags/${tagId}`, {
                  method: 'DELETE',
                });
                await loadWorkspaceBundle(bundle.workspace.id);
                showToast('Tag removed');
              } catch (err) {
                showToast(
                  err instanceof Error ? err.message : 'Failed to remove tag',
                  true,
                );
              }
            }}
            onSelectSnapshot={(snapId) => {
              setToSnapshotId(snapId);
              setDraftGraph(null);
              setHasUnsavedEdits(false);
              setSchemaFilter('ALL');
              setSelectedNodeId(null);
              setPrimaryTab('overview');
              setOverviewSubTab('erd');
            }}
          />
        )}

        {primaryTab === 'settings' && (
          <SettingsView
            workspace={bundle.workspace}
            datasources={bundle.datasources}
            storageMode={bundle.storageMode}
            isAuthenticated={Boolean(token && user)}
            onRequireAuth={() => setAuthModalOpen(true)}
            onConnectPrimaryDb={async (params) => {
              await apiFetch('/api/system/connect-db', {
                method: 'POST',
                body: JSON.stringify(params),
              });
              showToast('Connected Drizzle ORM to PostgreSQL!');
              if (token) {
                const wsList = await apiFetch<{ workspaces: WorkspaceDTO[] }>('/api/workspaces');
                setWorkspaces(wsList.workspaces);
                if (wsList.workspaces[0]) await loadWorkspaceBundle(wsList.workspaces[0].id);
              } else {
                const preview = await fetch('/api/preview').then((r) => r.json());
                setBundle(preview);
              }
            }}
            onTestDatasourceDraft={async (params) => {
              try {
                return await apiFetch<{ ok: boolean; version?: string; latencyMs?: number }>(
                  `/api/workspaces/${bundle.workspace.id}/datasources/test`,
                  { method: 'POST', body: JSON.stringify(params) },
                );
              } catch (err) {
                return {
                  ok: false,
                  error: err instanceof Error ? err.message : 'Connection failed',
                };
              }
            }}
            onCreateDatasource={async (params) => {
              await apiFetch(`/api/workspaces/${bundle.workspace.id}/datasources`, {
                method: 'POST',
                body: JSON.stringify(params),
              });
              await loadWorkspaceBundle(bundle.workspace.id);
              pushNotification(`Added PostgreSQL datasource ${params.name}`);
            }}
            onTestSavedDatasource={async (dsId) => {
              try {
                const res = await apiFetch<{
                  ok: boolean;
                  version?: string;
                  latencyMs?: number;
                }>(`/api/workspaces/${bundle.workspace.id}/datasources/${dsId}/test`, {
                  method: 'POST',
                });
                await loadWorkspaceBundle(bundle.workspace.id);
                return res;
              } catch (err) {
                await loadWorkspaceBundle(bundle.workspace.id);
                return {
                  ok: false,
                  error: err instanceof Error ? err.message : 'Connection failed',
                };
              }
            }}
            onUpdateDatasourcePassword={async (dsId, newPassword) => {
              try {
                await apiFetch(`/api/workspaces/${bundle.workspace.id}/datasources/${dsId}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ password: newPassword }),
                });
                await loadWorkspaceBundle(bundle.workspace.id);
                return { ok: true };
              } catch (err) {
                await loadWorkspaceBundle(bundle.workspace.id);
                return {
                  ok: false,
                  error: err instanceof Error ? err.message : 'Failed to update password',
                };
              }
            }}
            onListDatasourceSchemas={async (dsId) => {
              const res = await apiFetch<{
                schemas: { schema: string; tableCount: number }[];
              }>(`/api/workspaces/${bundle.workspace.id}/datasources/${dsId}/schemas`);
              return res.schemas;
            }}
            onIntrospectDatasource={async (dsId, schemas) => {
              try {
                const res = await apiFetch<{ objectCount: number; schemas?: string[] }>(
                  `/api/workspaces/${bundle.workspace.id}/datasources/${dsId}/introspect`,
                  {
                    method: 'POST',
                    body: JSON.stringify(
                      schemas && schemas.length > 0 ? { schemas } : {},
                    ),
                  },
                );
                await loadWorkspaceBundle(bundle.workspace.id);
                setPrimaryTab('overview');
                setOverviewSubTab('erd');
                const scopeLabel =
                  schemas && schemas.length > 0 ? ` (${schemas.join(', ')})` : '';
                showToast(
                  `Introspected ${res.objectCount} database objects${scopeLabel} into ERD!`,
                );
                pushNotification(
                  `Introspected ${res.objectCount} objects from PostgreSQL${scopeLabel}`,
                );
              } catch (err) {
                await loadWorkspaceBundle(bundle.workspace.id).catch(() => undefined);
                showToast(
                  err instanceof Error ? err.message : 'Introspection failed',
                  true,
                );
              }
            }}
            onDeleteDatasource={async (dsId) => {
              try {
                await apiFetch(
                  `/api/workspaces/${bundle.workspace.id}/datasources/${dsId}`,
                  { method: 'DELETE' },
                );
                await loadWorkspaceBundle(bundle.workspace.id);
                showToast('Datasource removed');
              } catch (err) {
                showToast(
                  err instanceof Error ? err.message : 'Failed to remove datasource',
                  true,
                );
              }
            }}
            onRenameWorkspace={async (orgSlug, name) => {
              if (!requireAuthenticated()) return;
              try {
                await apiFetch(`/api/workspaces/${bundle.workspace.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ orgSlug, name }),
                });
                await loadWorkspaceBundle(bundle.workspace.id);
                showToast('Workspace updated');
              } catch (err) {
                showToast(
                  err instanceof Error ? err.message : 'Failed to update workspace',
                  true,
                );
              }
            }}
          />
        )}
      </div>

      {/* Modals */}
      <AuthModal
        open={authModalOpen}
        hasUsers={hasUsers}
        storageMode={bundle.storageMode}
        onClose={() => setAuthModalOpen(false)}
        onLogin={handleLogin}
        onRegister={handleRegister}
      />

      <NodeEditorModal
        open={nodeEditorOpen}
        initialKind={nodeEditorKind}
        editingNode={editingNode}
        onClose={() => setNodeEditorOpen(false)}
        onSave={handleSaveNodeFromModal}
        onDelete={handleDeleteNode}
      />

      <RelationModal
        open={relationModalOpen}
        nodes={activeGraph.nodes}
        onClose={() => setRelationModalOpen(false)}
        onAdd={handleAddRelation}
      />

      <ExportModal
        open={exportModalOpen}
        graph={activeGraph}
        diff={computedDiff}
        workspaceName={bundle.workspace.name}
        onClose={() => setExportModalOpen(false)}
      />

      {/* Non-intrusive Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-4 right-4 z-50 px-3.5 py-2 rounded-lg border shadow-md text-[12.5px] font-medium ${
            toast.isError
              ? 'bg-[#FEF2F2] border-[#FECACA] text-[#DC2626]'
              : 'bg-[#111827] border-[#1F2937] text-white'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
