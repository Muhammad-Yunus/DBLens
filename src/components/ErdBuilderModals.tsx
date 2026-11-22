import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Download, Copy, Check } from 'lucide-react';
import type {
  SchemaGraph,
  SchemaTableNode,
  SchemaColumn,
  NodeKind,
  ComputedDiff,
} from '../types/schema.ts';

/* ---------------------------- NODE EDITOR MODAL ---------------------------- */
interface NodeEditorModalProps {
  open: boolean;
  initialKind: NodeKind;
  editingNode: SchemaTableNode | null;
  onClose: () => void;
  onSave: (node: SchemaTableNode, isNew: boolean) => void;
  onDelete?: (nodeId: string) => void;
}

export const NodeEditorModal: React.FC<NodeEditorModalProps> = ({
  open,
  initialKind,
  editingNode,
  onClose,
  onSave,
  onDelete,
}) => {
  const [name, setName] = useState('');
  const [schema, setSchema] = useState('public');
  const [kind, setKind] = useState<NodeKind>(initialKind);
  const [createStatement, setCreateStatement] = useState('');
  const [columns, setColumns] = useState<SchemaColumn[]>([]);

  useEffect(() => {
    if (!open) return;
    if (editingNode) {
      setName(editingNode.name);
      setSchema(editingNode.schema);
      setKind(editingNode.kind);
      setCreateStatement(editingNode.createStatement || '');
      setColumns(editingNode.columns.map((c) => ({ ...c })));
    } else {
      setName('');
      setSchema('public');
      setKind(initialKind);
      setCreateStatement('');
      setColumns([
        { name: 'id', type: 'int', nullable: false, isPrimaryKey: initialKind === 'table' },
        { name: 'created_at', type: 'timestamptz', nullable: false },
      ]);
    }
  }, [open, editingNode, initialKind]);

  if (!open) return null;

  const addColumn = () => {
    setColumns((prev) => [...prev, { name: '', type: 'varchar (255)', nullable: true }]);
  };

  const updateCol = (idx: number, patch: Partial<SchemaColumn>) => {
    setColumns((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const removeCol = (idx: number) => {
    setColumns((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    const cleanCols = columns.filter((c) => c.name.trim().length > 0);
    const node: SchemaTableNode = {
      id: editingNode?.id || `${kind === 'view' ? 'view' : 'tbl'}_${cleanName.toLowerCase().replace(/[^a-z0-9_]/g, '_')}_${Date.now().toString(36).slice(-4)}`,
      name: cleanName,
      schema: schema.trim() || 'public',
      kind,
      visibleOnCanvas: true,
      position: editingNode?.position || { x: 240, y: 180 },
      columns: cleanCols,
      indexes: editingNode?.indexes || [],
      createStatement: kind === 'view' ? createStatement : undefined,
      dependencies: editingNode?.dependencies || [],
    };
    onSave(node, !editingNode);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4">
      <div className="w-full max-w-2xl bg-white border border-[#E5E7EB] rounded-xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-5 py-3.5 border-b border-[#E5E7EB] flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-[#111827]">
            {editingNode ? `Edit ${editingNode.name}` : `New ${kind === 'view' ? 'View' : 'Table'}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-[#F3F4F6] text-[#6B7280] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11.5px] font-medium text-[#374151] mb-1">
                Object Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={kind === 'view' ? 'order_totals' : 'orders'}
                className="w-full h-9 px-3 text-[12.5px] font-mono border border-[#E5E7EB] rounded-md"
              />
            </div>
            <div>
              <label className="block text-[11.5px] font-medium text-[#374151] mb-1">
                Schema
              </label>
              <input
                type="text"
                value={schema}
                onChange={(e) => setSchema(e.target.value)}
                className="w-full h-9 px-3 text-[12.5px] font-mono border border-[#E5E7EB] rounded-md"
              />
            </div>
            <div>
              <label className="block text-[11.5px] font-medium text-[#374151] mb-1">
                Kind
              </label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as NodeKind)}
                className="w-full h-9 px-2.5 text-[12.5px] border border-[#E5E7EB] rounded-md bg-white"
              >
                <option value="table">Table</option>
                <option value="view">View</option>
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] font-semibold text-[#111827]">Columns</span>
              <button
                type="button"
                onClick={addColumn}
                className="text-[12px] font-medium text-[#1D4ED8] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Column
              </button>
            </div>
            <div className="space-y-2">
              {columns.map((col, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-2 items-center">
                  <input
                    type="text"
                    value={col.name}
                    onChange={(e) => updateCol(idx, { name: e.target.value })}
                    placeholder="column_name"
                    className="h-8 px-2.5 text-[12px] font-mono border border-[#E5E7EB] rounded"
                  />
                  <input
                    type="text"
                    value={col.type}
                    onChange={(e) => updateCol(idx, { type: e.target.value })}
                    placeholder="varchar (255)"
                    className="h-8 px-2.5 text-[12px] font-mono border border-[#E5E7EB] rounded"
                  />
                  <label className="flex items-center gap-1 text-[11.5px] text-[#4B5563] whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={!col.nullable}
                      onChange={(e) => updateCol(idx, { nullable: !e.target.checked })}
                    />
                    Not Null
                  </label>
                  <label className="flex items-center gap-1 text-[11.5px] text-[#4B5563] whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={Boolean(col.isPrimaryKey)}
                      onChange={(e) => updateCol(idx, { isPrimaryKey: e.target.checked })}
                    />
                    PK
                  </label>
                  <button
                    type="button"
                    onClick={() => removeCol(idx)}
                    className="p-1 text-[#9CA3AF] hover:text-[#DC2626] cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {kind === 'view' && (
            <div>
              <label className="block text-[11.5px] font-medium text-[#374151] mb-1">
                SQL Create Statement
              </label>
              <textarea
                rows={4}
                value={createStatement}
                onChange={(e) => setCreateStatement(e.target.value)}
                placeholder="CREATE OR REPLACE VIEW public.my_view AS SELECT ..."
                className="w-full p-2.5 text-[12px] font-mono border border-[#E5E7EB] rounded-md"
              />
            </div>
          )}

          <div className="pt-3 border-t border-[#E5E7EB] flex items-center justify-between">
            {editingNode && onDelete ? (
              <button
                type="button"
                onClick={() => {
                  onDelete(editingNode.id);
                  onClose();
                }}
                className="h-8 px-3 rounded border border-[#FECACA] text-[#DC2626] hover:bg-[#FEF2F2] text-[12px] font-medium cursor-pointer"
              >
                Delete Object
              </button>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-8 px-3 rounded border border-[#E5E7EB] text-[12.5px] text-[#374151] hover:bg-[#F9FAFB] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-8 px-4 rounded bg-[#111827] hover:bg-[#1F2937] text-white text-[12.5px] font-medium cursor-pointer"
              >
                Apply to Canvas
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

/* ---------------------------- ADD RELATION MODAL ---------------------------- */
export const RelationModal: React.FC<{
  open: boolean;
  nodes: SchemaTableNode[];
  onClose: () => void;
  onAdd: (sourceId: string, targetId: string, sourceCol: string, targetCol: string, kind: 'fk' | 'view_dep') => void;
}> = ({ open, nodes, onClose, onAdd }) => {
  const [sourceId, setSourceId] = useState(nodes[0]?.id || '');
  const [targetId, setTargetId] = useState(nodes[1]?.id || nodes[0]?.id || '');
  const [sourceCol, setSourceCol] = useState('');
  const [targetCol, setTargetCol] = useState('');
  const [kind, setKind] = useState<'fk' | 'view_dep'>('fk');

  useEffect(() => {
    if (open && nodes.length >= 1) {
      setSourceId(nodes[0].id);
      setTargetId((nodes[1] || nodes[0]).id);
    }
  }, [open, nodes]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceId || !targetId || sourceId === targetId) return;
    onAdd(sourceId, targetId, sourceCol || 'id', targetCol || 'id', kind);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4">
      <div className="w-full max-w-md bg-white border border-[#E5E7EB] rounded-xl shadow-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E5E7EB] flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-[#111827]">Link Relationship</h2>
          <button type="button" onClick={onClose} className="p-1 text-[#6B7280] cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3.5">
          <div>
            <label className="block text-[11.5px] font-medium text-[#374151] mb-1">Source Node</label>
            <select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              className="w-full h-9 px-2.5 text-[12.5px] border border-[#E5E7EB] rounded-md bg-white"
            >
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.kind})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-[#374151] mb-1">Source Column</label>
            <input
              type="text"
              value={sourceCol}
              onChange={(e) => setSourceCol(e.target.value)}
              placeholder="category_id"
              className="w-full h-9 px-3 text-[12.5px] font-mono border border-[#E5E7EB] rounded-md"
            />
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-[#374151] mb-1">Target Node</label>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="w-full h-9 px-2.5 text-[12.5px] border border-[#E5E7EB] rounded-md bg-white"
            >
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.kind})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-[#374151] mb-1">Target Column</label>
            <input
              type="text"
              value={targetCol}
              onChange={(e) => setTargetCol(e.target.value)}
              placeholder="region_id"
              className="w-full h-9 px-3 text-[12.5px] font-mono border border-[#E5E7EB] rounded-md"
            />
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-[#374151] mb-1">Relation Type</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as 'fk' | 'view_dep')}
              className="w-full h-9 px-2.5 text-[12.5px] border border-[#E5E7EB] rounded-md bg-white"
            >
              <option value="fk">Foreign Key Constraint</option>
              <option value="view_dep">View Dependency</option>
            </select>
          </div>
          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3 rounded border border-[#E5E7EB] text-[12.5px] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="h-8 px-4 rounded bg-[#111827] text-white text-[12.5px] font-medium cursor-pointer"
            >
              Add Edge
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/* ---------------------------- EXPORT MODAL ---------------------------- */
export const ExportModal: React.FC<{
  open: boolean;
  graph: SchemaGraph;
  diff: ComputedDiff;
  workspaceName: string;
  onClose: () => void;
}> = ({ open, graph, diff, workspaceName, onClose }) => {
  const [format, setFormat] = useState<'sql' | 'hcl' | 'json'>('sql');
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const fullSql = graph.nodes
    .map((n) => {
      if (n.kind === 'view') {
        return (
          n.createStatement ||
          `CREATE OR REPLACE VIEW "${n.schema}"."${n.name}" AS SELECT ${n.columns
            .map((c) => `"${c.name}"`)
            .join(', ')};`
        );
      }
      const cols = n.columns
        .map(
          (c) =>
            `  "${c.name}" ${c.type.replace(/\s+/g, '')}${c.nullable ? '' : ' NOT NULL'}${
              c.isPrimaryKey ? ' PRIMARY KEY' : ''
            }`,
        )
        .join(',\n');
      return `CREATE TABLE "${n.schema}"."${n.name}" (\n${cols}\n);`;
    })
    .join('\n\n');

  const hclText = diff.hclDiff.map((l) => l.content).join('\n') || '// No diff HCL lines';
  const jsonText = JSON.stringify(graph, null, 2);
  const output = format === 'sql' ? fullSql : format === 'hcl' ? hclText : jsonText;

  const download = () => {
    const ext = format === 'sql' ? 'sql' : format === 'hcl' ? 'hcl' : 'json';
    const blob = new Blob([output], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${workspaceName.toLowerCase()}-schema.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4">
      <div className="w-full max-w-2xl bg-white border border-[#E5E7EB] rounded-xl shadow-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E5E7EB] flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-[#111827]">Export Schema</h2>
          <button type="button" onClick={onClose} className="p-1 text-[#6B7280] cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-1 p-1 bg-[#F3F4F6] rounded-lg w-fit">
            {(['sql', 'hcl', 'json'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFormat(f)}
                className={`px-3 py-1 text-[12px] font-medium rounded-md uppercase cursor-pointer ${
                  format === f ? 'bg-white text-[#111827] shadow-xs' : 'text-[#6B7280]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <pre className="h-72 overflow-auto p-3.5 rounded-md bg-[#FAFAFA] border border-[#E5E7EB] font-mono text-[11.5px] text-[#111827]">
            {output}
          </pre>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(output);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="h-8 px-3 rounded border border-[#E5E7EB] text-[12.5px] font-medium flex items-center gap-1.5 cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-[#16A34A]" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={download}
              className="h-8 px-3.5 rounded bg-[#111827] text-white text-[12.5px] font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Download .{format}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
