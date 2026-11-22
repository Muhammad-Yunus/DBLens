import React, { useState, useEffect, useRef } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Search,
  Table2,
  Eye,
  Columns3,
  KeyRound,
  ListFilter,
  ArrowRight,
  X,
} from 'lucide-react';
import type {
  SchemaGraph,
  SchemaSnapshotDTO,
  ComputedDiff,
} from '../types/schema.ts';

interface SchemaSidebarProps {
  open: boolean;
  onCloseMobile: () => void;
  snapshots: SchemaSnapshotDTO[];
  fromSnapshotId: string;
  toSnapshotId: string;
  onChangeSnapshots: (fromId: string, toId: string) => void;
  diffEnabled: boolean;
  onToggleDiff: () => void;
  activeGraph: SchemaGraph;
  diff: ComputedDiff;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  availableSchemas: { schema: string; count: number }[];
  schemaFilter: string;
  onChangeSchemaFilter: (schema: string) => void;
}

export const SchemaSidebar: React.FC<SchemaSidebarProps> = ({
  open,
  onCloseMobile,
  snapshots,
  fromSnapshotId,
  toSnapshotId,
  onChangeSnapshots,
  diffEnabled,
  onToggleDiff,
  activeGraph,
  diff,
  selectedNodeId,
  onSelectNode,
  availableSchemas,
  schemaFilter,
  onChangeSchemaFilter,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [snapshotMenuOpen, setSnapshotMenuOpen] = useState(false);
  const [tablesOpen, setTablesOpen] = useState(true);
  const [viewsOpen, setViewsOpen] = useState(true);
  const [extraTablesOpen, setExtraTablesOpen] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({
    tbl_products: true,
    view_price_avgs: true,
  });
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    'tbl_products:cols': true,
    'tbl_products:idx': true,
    'view_price_avgs:cols': true,
  });

  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setSnapshotMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fromSnap = snapshots.find((s) => s.id === fromSnapshotId) ?? snapshots[0];
  const toSnap = snapshots.find((s) => s.id === toSnapshotId) ?? snapshots[snapshots.length - 1];

  const query = searchQuery.trim().toLowerCase();
  const tableNodes = activeGraph.nodes.filter((n) => n.kind === 'table');
  const viewNodes = activeGraph.nodes.filter((n) => n.kind === 'view');

  const filterNode = (name: string, colNames: string[]) => {
    if (!query) return true;
    return (
      name.toLowerCase().includes(query) ||
      colNames.some((c) => c.toLowerCase().includes(query))
    );
  };

  const isDemoInventory = tableNodes.some((n) => n.id === 'tbl_products');
  const primaryTables = tableNodes.filter((n) => {
    const matches = filterNode(
      n.name,
      n.columns.map((c) => c.name),
    );
    if (!matches) return false;
    if (isDemoInventory && !query) {
      return n.id === 'tbl_products';
    }
    return true;
  });

  const secondaryTables = tableNodes.filter(
    (n) =>
      !primaryTables.some((p) => p.id === n.id) &&
      filterNode(
        n.name,
        n.columns.map((c) => c.name),
      ),
  );

  const visibleViews = viewNodes.filter((n) =>
    filterNode(
      n.name,
      n.columns.map((c) => c.name),
    ),
  );

  const toggleNode = (id: string) => {
    setExpandedNodes((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleSubSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
  };

  const sidebarContent = (
    <aside className="w-[272px] h-full bg-white border-r border-[#E5E7EB] flex flex-col select-none">
      {/* Mobile Drawer Header */}
      <div className="lg:hidden px-3 py-2 border-b border-[#F3F4F6] flex items-center justify-between">
        <span className="text-[12px] font-semibold text-[#111827]">Schema Explorer</span>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close sidebar"
          className="p-1 rounded hover:bg-[#F3F4F6] text-[#6B7280]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Snapshot Range + Diff Toggle */}
      <div className="px-3 pt-3 pb-2 flex items-center gap-2">
        <div className="relative flex-1 min-w-0" ref={menuRef}>
          <button
            type="button"
            onClick={() => setSnapshotMenuOpen((v) => !v)}
            className="w-full h-8 px-2.5 rounded-[6px] border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] flex items-center justify-between gap-1 text-[12px] text-[#374151] transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-1 truncate min-w-0 tabular-nums">
              <span className="text-[#6B7280]">From</span>
              <span className="font-medium text-[#111827] truncate max-w-[42px]">
                {fromSnap?.versionTag || '202...'}
              </span>
              <ArrowRight className="w-3 h-3 text-[#6B7280] shrink-0" />
              <span className="text-[#6B7280]">To</span>
              <span className="font-medium text-[#111827] truncate max-w-[46px]">
                {toSnap?.versionTag || '20240...'}
              </span>
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-[#6B7280] shrink-0" />
          </button>

          {snapshotMenuOpen && (
            <div className="absolute left-0 mt-1.5 w-64 bg-white border border-[#E5E7EB] rounded-lg shadow-lg p-3 z-50 space-y-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-[#6B7280] mb-1">
                  Baseline (From)
                </label>
                <select
                  value={fromSnapshotId}
                  onChange={(e) => onChangeSnapshots(e.target.value, toSnapshotId)}
                  className="w-full h-8 px-2 text-[12px] border border-[#E5E7EB] rounded-md bg-white text-[#111827]"
                >
                  {snapshots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.versionTag} — {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#6B7280] mb-1">
                  Target (To)
                </label>
                <select
                  value={toSnapshotId}
                  onChange={(e) => onChangeSnapshots(fromSnapshotId, e.target.value)}
                  className="w-full h-8 px-2 text-[12px] border border-[#E5E7EB] rounded-md bg-white text-[#111827]"
                >
                  {snapshots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.versionTag} — {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Diff Switch */}
        <button
          type="button"
          role="switch"
          aria-checked={diffEnabled}
          onClick={onToggleDiff}
          className="flex items-center gap-1.5 shrink-0 cursor-pointer"
        >
          <span
            className={`w-8 h-[18px] rounded-full p-0.5 transition-colors flex items-center ${
              diffEnabled ? 'bg-[#1D4ED8]' : 'bg-[#D1D5DB]'
            }`}
          >
            <span
              className={`w-3.5 h-3.5 rounded-full bg-white shadow-xs transition-transform ${
                diffEnabled ? 'translate-x-[14px]' : 'translate-x-0'
              }`}
            />
          </span>
          <span className="text-[12.5px] font-medium text-[#111827]">Diff</span>
        </button>
      </div>

      {/* Search Input */}
      <div className="px-3 pb-2.5">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-[#9CA3AF] absolute left-2.5 pointer-events-none" />
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="w-full h-8 pl-8 pr-7 rounded-[6px] border border-[#E5E7EB] bg-white text-[12.5px] text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:border-[#9CA3AF] transition-colors"
          />
          <span className="absolute right-2 px-1.5 py-0.2 rounded border border-[#E5E7EB] bg-[#F9FAFB] text-[10.5px] text-[#9CA3AF] font-mono pointer-events-none">
            /
          </span>
        </div>

        {availableSchemas.length > 1 && (
          <div className="mt-2">
            <select
              value={schemaFilter}
              onChange={(e) => onChangeSchemaFilter(e.target.value)}
              aria-label="Filter by PostgreSQL schema"
              className="w-full h-7 px-2 text-[11.5px] font-medium border border-[#E5E7EB] rounded-[6px] bg-[#F9FAFB] text-[#374151]"
            >
              <option value="ALL">
                All Schemas ({availableSchemas.reduce((acc, s) => acc + s.count, 0)})
              </option>
              {availableSchemas.map((s) => (
                <option key={s.schema} value={s.schema}>
                  {s.schema} ({s.count})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Schema Tree */}
      <div className="flex-1 overflow-y-auto px-2 pb-4 text-[12.5px]">
        {/* Tables Section */}
        <div>
          <button
            type="button"
            onClick={() => setTablesOpen((v) => !v)}
            className="w-full flex items-center gap-1.5 px-1.5 py-1.5 rounded hover:bg-[#F9FAFB] text-[#374151] font-medium cursor-pointer"
          >
            {tablesOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-[#6B7280]" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-[#6B7280]" />
            )}
            <Table2 className="w-3.5 h-3.5 text-[#4B5563]" strokeWidth={1.75} />
            <span>Tables</span>
          </button>

          {tablesOpen && (
            <div className="mt-0.5 space-y-0.5">
              {primaryTables.map((node) => {
                const isExpanded = expandedNodes[node.id] ?? false;
                const nodeDiff = diff.tables[node.id];
                const isAddedNode = diffEnabled && nodeDiff?.change === 'added';
                const colsExpanded = expandedSections[`${node.id}:cols`] ?? true;
                const idxExpanded = expandedSections[`${node.id}:idx`] ?? true;

                return (
                  <div key={node.id}>
                    <div
                      className={`flex items-center gap-1.5 pl-4 pr-2 py-1 rounded cursor-pointer transition-colors ${
                        isAddedNode
                          ? 'bg-[#ECFDF5] text-[#15803D]'
                          : selectedNodeId === node.id
                            ? 'bg-[#F3F4F6] text-[#111827]'
                            : 'hover:bg-[#F9FAFB] text-[#111827]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleNode(node.id)}
                        className="p-0.5 text-[#6B7280] hover:text-[#111827] cursor-pointer"
                        aria-label={`Expand ${node.name}`}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectNode(node.id)}
                        className="flex-1 flex items-center gap-1.5 text-left min-w-0 cursor-pointer"
                      >
                        {isAddedNode && (
                          <span className="text-[#16A34A] font-semibold text-[13px] leading-none">
                            +
                          </span>
                        )}
                        <Table2
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isAddedNode ? 'text-[#16A34A]' : 'text-[#4B5563]'
                          }`}
                          strokeWidth={1.75}
                        />
                        <span className="font-medium truncate">{node.name}</span>
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="mt-0.5 space-y-0.5">
                        {/* Columns group */}
                        <button
                          type="button"
                          onClick={() => toggleSubSection(`${node.id}:cols`)}
                          className="w-full flex items-center gap-1.5 pl-8 pr-2 py-1 rounded hover:bg-[#F9FAFB] text-[#374151] cursor-pointer"
                        >
                          {colsExpanded ? (
                            <ChevronDown className="w-3 h-3 text-[#6B7280]" />
                          ) : (
                            <ChevronRight className="w-3 h-3 text-[#6B7280]" />
                          )}
                          <Columns3 className="w-3.5 h-3.5 text-[#6B7280]" strokeWidth={1.7} />
                          <span className="font-medium text-[12px]">Columns</span>
                        </button>

                        {colsExpanded && (
                          <div className="space-y-0.5">
                            {node.columns.map((col) => {
                              const colChange = diffEnabled
                                ? diff.columnsByTable[node.id]?.[col.name]
                                : undefined;
                              const isAdded = colChange === 'added';
                              return (
                                <div
                                  key={col.name}
                                  onClick={() => onSelectNode(node.id)}
                                  className={`flex items-center justify-between gap-2 pl-12 pr-2 py-1 rounded cursor-pointer ${
                                    isAdded
                                      ? 'bg-[#ECFDF5] text-[#15803D]'
                                      : 'hover:bg-[#F9FAFB] text-[#374151]'
                                  }`}
                                >
                                  <span className="flex items-center gap-1.5 min-w-0">
                                    {isAdded ? (
                                      <span className="text-[#16A34A] font-semibold w-3.5 text-center leading-none">
                                        +
                                      </span>
                                    ) : col.isPrimaryKey ? (
                                      <KeyRound
                                        className="w-3.5 h-3.5 text-[#1D4ED8] shrink-0"
                                        strokeWidth={1.9}
                                      />
                                    ) : col.isForeignKey ? (
                                      <KeyRound
                                        className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0"
                                        strokeWidth={1.75}
                                      />
                                    ) : (
                                      <Columns3
                                        className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0"
                                        strokeWidth={1.7}
                                      />
                                    )}
                                    <span
                                      className={`truncate ${
                                        isAdded
                                          ? 'text-[#15803D] font-medium'
                                          : col.isPrimaryKey
                                            ? 'text-[#111827] font-medium'
                                            : 'text-[#374151]'
                                      }`}
                                    >
                                      {col.name}
                                    </span>
                                  </span>
                                  <span
                                    className={`text-[11px] font-mono shrink-0 ${
                                      isAdded ? 'text-[#15803D]' : 'text-[#9CA3AF]'
                                    }`}
                                  >
                                    {col.type}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Indexes group */}
                        {node.indexes.length > 0 && (
                          <>
                            <button
                              type="button"
                              onClick={() => toggleSubSection(`${node.id}:idx`)}
                              className="w-full flex items-center gap-1.5 pl-8 pr-2 py-1 rounded hover:bg-[#F9FAFB] text-[#374151] cursor-pointer"
                            >
                              {idxExpanded ? (
                                <ChevronDown className="w-3 h-3 text-[#6B7280]" />
                              ) : (
                                <ChevronRight className="w-3 h-3 text-[#6B7280]" />
                              )}
                              <ListFilter className="w-3.5 h-3.5 text-[#6B7280]" strokeWidth={1.7} />
                              <span className="font-medium text-[12px]">Indexes</span>
                            </button>

                            {idxExpanded && (
                              <div className="space-y-0.5">
                                {node.indexes.map((idx) => (
                                  <div
                                    key={idx.name}
                                    onClick={() => onSelectNode(node.id)}
                                    className="flex items-center gap-1.5 pl-12 pr-2 py-1 rounded hover:bg-[#F9FAFB] text-[#4B5563] cursor-pointer"
                                  >
                                    <span className="w-3.5 h-3.5 rounded-full border border-[#D1D5DB] text-[9px] font-semibold flex items-center justify-center text-[#9CA3AF] shrink-0">
                                      i
                                    </span>
                                    <span className="truncate">{idx.name}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Views Section */}
        <div className="mt-1.5">
          <button
            type="button"
            onClick={() => setViewsOpen((v) => !v)}
            className="w-full flex items-center gap-1.5 px-1.5 py-1.5 rounded hover:bg-[#F9FAFB] text-[#374151] font-medium cursor-pointer"
          >
            {viewsOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-[#6B7280]" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-[#6B7280]" />
            )}
            <Eye className="w-3.5 h-3.5 text-[#4B5563]" strokeWidth={1.75} />
            <span>Views</span>
          </button>

          {viewsOpen && (
            <div className="mt-0.5 space-y-0.5">
              {visibleViews.map((node) => {
                const isExpanded = expandedNodes[node.id] ?? true;
                const nodeDiff = diff.tables[node.id];
                const isAddedView = diffEnabled && nodeDiff?.change === 'added';
                const colsExpanded = expandedSections[`${node.id}:cols`] ?? true;

                return (
                  <div key={node.id}>
                    <div
                      className={`flex items-center gap-1.5 pl-4 pr-2 py-1 rounded cursor-pointer transition-colors ${
                        isAddedView
                          ? 'bg-[#ECFDF5] text-[#15803D]'
                          : selectedNodeId === node.id
                            ? 'bg-[#F3F4F6] text-[#111827]'
                            : 'hover:bg-[#F9FAFB] text-[#111827]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleNode(node.id)}
                        className="p-0.5 text-[#6B7280] hover:text-[#111827] cursor-pointer"
                        aria-label={`Expand ${node.name}`}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectNode(node.id)}
                        className="flex-1 flex items-center gap-1.5 text-left min-w-0 cursor-pointer"
                      >
                        {isAddedView ? (
                          <span className="text-[#16A34A] font-semibold text-[13px] leading-none">
                            +
                          </span>
                        ) : (
                          <Eye className="w-3.5 h-3.5 text-[#4B5563] shrink-0" strokeWidth={1.75} />
                        )}
                        <span className="font-medium truncate">{node.name}</span>
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="mt-0.5 space-y-0.5">
                        <button
                          type="button"
                          onClick={() => toggleSubSection(`${node.id}:cols`)}
                          className="w-full flex items-center gap-1.5 pl-8 pr-2 py-1 rounded hover:bg-[#F9FAFB] text-[#374151] cursor-pointer"
                        >
                          {colsExpanded ? (
                            <ChevronDown className="w-3 h-3 text-[#6B7280]" />
                          ) : (
                            <ChevronRight className="w-3 h-3 text-[#6B7280]" />
                          )}
                          <Columns3 className="w-3.5 h-3.5 text-[#6B7280]" strokeWidth={1.7} />
                          <span className="font-medium text-[12px]">Columns</span>
                        </button>

                        {colsExpanded && (
                          <div className="space-y-0.5">
                            {node.columns.map((col, idx) => (
                              <div
                                key={col.name}
                                onClick={() => onSelectNode(node.id)}
                                className="flex items-center justify-between gap-2 pl-12 pr-2 py-1 rounded hover:bg-[#F9FAFB] text-[#374151] cursor-pointer"
                              >
                                <span className="flex items-center gap-1.5 min-w-0">
                                  {idx === 1 ? (
                                    <KeyRound
                                      className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0"
                                      strokeWidth={1.7}
                                    />
                                  ) : (
                                    <Columns3
                                      className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0"
                                      strokeWidth={1.7}
                                    />
                                  )}
                                  <span className="truncate">{col.name}</span>
                                </span>
                                <span className="text-[11px] font-mono text-[#9CA3AF] shrink-0">
                                  {col.type.replace(/\s+/g, '')}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Secondary / Reference Tables group (matches bottom "> Tables" in mockup) */}
        <div className="mt-1.5">
          <button
            type="button"
            onClick={() => setExtraTablesOpen((v) => !v)}
            className="w-full flex items-center gap-1.5 px-1.5 py-1.5 rounded hover:bg-[#F9FAFB] text-[#374151] font-medium cursor-pointer"
          >
            {extraTablesOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-[#6B7280]" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-[#6B7280]" />
            )}
            <Table2 className="w-3.5 h-3.5 text-[#4B5563]" strokeWidth={1.75} />
            <span>Tables</span>
          </button>

          {extraTablesOpen && (
            <div className="mt-0.5 space-y-0.5">
              {secondaryTables.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => onSelectNode(node.id)}
                  className="w-full flex items-center justify-between pl-6 pr-2 py-1 rounded hover:bg-[#F9FAFB] text-[#374151] cursor-pointer"
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <Table2 className="w-3.5 h-3.5 text-[#6B7280]" strokeWidth={1.75} />
                    <span className="font-medium truncate">{node.name}</span>
                  </span>
                  <span className="text-[11px] text-[#9CA3AF] font-mono tabular-nums">
                    {node.columns.length} cols
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop persistent sidebar */}
      {open && <div className="hidden lg:block h-full shrink-0">{sidebarContent}</div>}

      {/* Mobile / Tablet slide-over drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div
            className="fixed inset-0 bg-black/25 backdrop-blur-[1px]"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full shadow-xl">{sidebarContent}</div>
        </div>
      )}
    </>
  );
};
