import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Eye,
  Table2,
  KeyRound,
  Move,
  Minus,
  Plus,
  Scan,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pencil,
  Link2,
  Layers,
  Save,
  Trash2,
  X,
  LayoutGrid,
} from 'lucide-react';
import { computeAutoLayout, ERD_CARD_WIDTH, estimateCardHeight } from '../utils/autoLayout.ts';
import type {
  SchemaGraph,
  SchemaTableNode,
  SchemaRelation,
  ComputedDiff,
} from '../types/schema.ts';

interface ErdCanvasProps {
  graph: SchemaGraph;
  diff: ComputedDiff;
  diffEnabled: boolean;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onUpdateGraph: (next: SchemaGraph) => void;
  onOpenAddTable: (kind: 'table' | 'view') => void;
  onOpenEditNode: (node: SchemaTableNode) => void;
  onOpenAddRelation: () => void;
  onSaveSnapshot: () => void;
  hasUnsavedEdits: boolean;
}

type CardSubTab = 'columns' | 'create' | 'dependencies' | 'indexes';

interface ComputedEdge {
  rel: SchemaRelation;
  source: SchemaTableNode;
  target: SchemaTableNode;
  pathD: string;
  midX: number;
  midY: number;
  isHighlighted: boolean;
}

function getColumnAnchorY(
  node: SchemaTableNode,
  colName: string | undefined,
  subTab: CardSubTab,
): number {
  if (subTab !== 'columns' || !colName) {
    return node.position.y + 132;
  }
  const idx = node.columns.findIndex(
    (c) => c.name.toLowerCase() === colName.toLowerCase(),
  );
  if (idx === -1) {
    return node.position.y + 132;
  }
  // Top accent (2) + header (~46) + tab bar (~31) + col-header (~32) = 111px, row height ~33px
  return node.position.y + 111 + idx * 33 + 16;
}

function cubicPointAtMid(
  x1: number,
  y1: number,
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  x2: number,
  y2: number,
): { x: number; y: number } {
  const t = 0.5;
  const mt = 1 - t;
  return {
    x:
      mt * mt * mt * x1 +
      3 * mt * mt * t * cx1 +
      3 * mt * t * t * cx2 +
      t * t * t * x2,
    y:
      mt * mt * mt * y1 +
      3 * mt * mt * t * cy1 +
      3 * mt * t * t * cy2 +
      t * t * t * y2,
  };
}

export const ErdCanvas: React.FC<ErdCanvasProps> = ({
  graph,
  diff,
  diffEnabled,
  selectedNodeId,
  onSelectNode,
  onUpdateGraph,
  onOpenAddTable,
  onOpenEditNode,
  onOpenAddRelation,
  onSaveSnapshot,
  hasUnsavedEdits,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showAllNodes, setShowAllNodes] = useState(false);
  const [cardTabs, setCardTabs] = useState<Record<string, CardSubTab>>({});
  const [activeRelationId, setActiveRelationId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Dragging state & stable refs to avoid listener teardown on every frame
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const onUpdateGraphRef = useRef(onUpdateGraph);
  onUpdateGraphRef.current = onUpdateGraph;

  const dragStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    origX: number;
    origY: number;
    hasMoved: boolean;
  }>({ mouseX: 0, mouseY: 0, origX: 0, origY: 0, hasMoved: false });

  const visibleNodes = graph.nodes.filter(
    (n) => showAllNodes || n.visibleOnCanvas !== false || n.id === selectedNodeId,
  );

  const fitToView = useCallback(() => {
    const container = containerRef.current;
    if (!container || visibleNodes.length === 0) return;
    const rect = container.getBoundingClientRect();
    const minX = Math.min(...visibleNodes.map((n) => n.position.x));
    const minY = Math.min(...visibleNodes.map((n) => n.position.y));
    const maxX = Math.max(...visibleNodes.map((n) => n.position.x + ERD_CARD_WIDTH));
    const maxY = Math.max(...visibleNodes.map((n) => n.position.y + estimateCardHeight(n)));
    const contentW = Math.max(360, maxX - minX);
    const contentH = Math.max(240, maxY - minY);

    const padding = rect.width < 640 ? 40 : 100;
    const nextZoom = Math.min(
      1.05,
      Math.max(
        0.35,
        Math.min((rect.width - padding) / contentW, (rect.height - padding) / contentH),
      ),
    );
    const centeredX = (rect.width - contentW * nextZoom) / 2 - minX * nextZoom;
    const centeredY = (rect.height - contentH * nextZoom) / 2 - minY * nextZoom;
    setZoom(Number(nextZoom.toFixed(2)));
    setPan({ x: Math.round(centeredX), y: Math.round(centeredY) });
  }, [visibleNodes]);

  const nodeSignature = graph.nodes.map((n) => n.id).join('|');
  useEffect(() => {
    const timer = setTimeout(() => {
      fitToView();
    }, 40);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAllNodes, nodeSignature]);

  useEffect(() => {
    const onResize = () => fitToView();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fitToView]);

  const handleBackgroundPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.canvasBg) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    setActiveRelationId(null);
    onSelectNode(null);
    setPanning(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      origX: pan.x,
      origY: pan.y,
      hasMoved: false,
    };
  };

  const handleNodeDragStart = (
    e: React.PointerEvent,
    node: SchemaTableNode,
    allowInteractiveBypass = false,
  ) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (!allowInteractiveBypass) {
      const interactive = (e.target as HTMLElement).closest(
        'button, a, input, select, textarea, pre',
      );
      if (interactive) {
        e.stopPropagation();
        onSelectNode(node.id);
        return;
      }
    }
    e.stopPropagation();
    setActiveRelationId(null);
    onSelectNode(node.id);
    setDraggingNodeId(node.id);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      origX: node.position.x,
      origY: node.position.y,
      hasMoved: false,
    };
  };

  useEffect(() => {
    if (!draggingNodeId && !panning) return;

    const handleMove = (e: PointerEvent) => {
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;

      if (!dragStartRef.current.hasMoved && Math.abs(dx) < 3 && Math.abs(dy) < 3) {
        return;
      }
      dragStartRef.current.hasMoved = true;

      if (panning) {
        setPan({
          x: dragStartRef.current.origX + dx,
          y: dragStartRef.current.origY + dy,
        });
      } else if (draggingNodeId) {
        const currentGraph = graphRef.current;
        const currentZoom = zoomRef.current || 1;
        const nextX = Math.round(dragStartRef.current.origX + dx / currentZoom);
        const nextY = Math.round(dragStartRef.current.origY + dy / currentZoom);
        const nextNodes = currentGraph.nodes.map((n) =>
          n.id === draggingNodeId
            ? {
                ...n,
                position: { x: nextX, y: nextY },
              }
            : n,
        );
        onUpdateGraphRef.current({ ...currentGraph, nodes: nextNodes });
      }
    };

    const handleUp = () => {
      setDraggingNodeId(null);
      setPanning(false);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [draggingNodeId, panning]);

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      setZoom((z) => Math.min(1.8, Math.max(0.3, Number((z + delta).toFixed(2)))));
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement && containerRef.current) {
      containerRef.current.requestFullscreen?.().catch(() => undefined);
      setIsFullscreen(true);
    } else if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => undefined);
      setIsFullscreen(false);
    } else {
      setIsFullscreen((v) => !v);
    }
  };

  const handleAutoLayout = () => {
    const arranged = computeAutoLayout(graph);
    onUpdateGraph(arranged);
    setTimeout(() => fitToView(), 50);
  };

  const deleteRelation = (relId: string) => {
    onUpdateGraph({
      ...graph,
      relations: graph.relations.filter((r) => r.id !== relId),
    });
    setActiveRelationId(null);
  };

  const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
  const visibleRelations = graph.relations.filter(
    (r) => visibleNodeIds.has(r.sourceId) && visibleNodeIds.has(r.targetId),
  );

  const focusNodeId = hoveredNodeId || selectedNodeId;

  const computedEdges: ComputedEdge[] = visibleRelations
    .map((rel): ComputedEdge | null => {
      const source = visibleNodes.find((n) => n.id === rel.sourceId);
      const target = visibleNodes.find((n) => n.id === rel.targetId);
      if (!source || !target) return null;

      const srcTab: CardSubTab = cardTabs[source.id] || 'columns';
      const tgtTab: CardSubTab = cardTabs[target.id] || 'columns';
      const y1 = getColumnAnchorY(source, rel.sourceColumn, srcTab);
      const y2 = getColumnAnchorY(target, rel.targetColumn, tgtTab);

      let x1: number;
      let x2: number;
      let cx1: number;
      let cx2: number;

      if (source.id === target.id) {
        // Self-referential FK loop on right edge
        x1 = source.position.x + ERD_CARD_WIDTH;
        x2 = source.position.x + ERD_CARD_WIDTH + 3;
        cx1 = x1 + 78;
        cx2 = x2 + 78;
      } else if (target.position.x >= source.position.x + ERD_CARD_WIDTH + 24) {
        // Target is cleanly to the right
        x1 = source.position.x + ERD_CARD_WIDTH;
        x2 = target.position.x - 3;
        const dx = Math.max(48, (x2 - x1) * 0.45);
        cx1 = x1 + dx;
        cx2 = x2 - dx;
      } else if (source.position.x >= target.position.x + ERD_CARD_WIDTH + 24) {
        // Target is cleanly to the left
        x1 = source.position.x;
        x2 = target.position.x + ERD_CARD_WIDTH + 3;
        const dx = Math.max(48, (x1 - x2) * 0.45);
        cx1 = x1 - dx;
        cx2 = x2 + dx;
      } else {
        // Stacked vertically / overlapping X: route cleanly along the right corridor
        x1 = source.position.x + ERD_CARD_WIDTH;
        x2 = target.position.x + ERD_CARD_WIDTH + 3;
        const rightEdge = Math.max(x1, x2) + 84;
        cx1 = rightEdge;
        cx2 = rightEdge;
      }

      const pathD = `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`;
      const mid = cubicPointAtMid(x1, y1, cx1, y1, cx2, y2, x2, y2);
      const isHighlighted =
        activeRelationId === rel.id ||
        focusNodeId === source.id ||
        focusNodeId === target.id;

      return {
        rel,
        source,
        target,
        pathD,
        midX: mid.x,
        midY: mid.y,
        isHighlighted,
      };
    })
    .filter((e): e is ComputedEdge => e !== null);

  return (
    <div
      ref={containerRef}
      onPointerDown={handleBackgroundPointerDown}
      onWheel={handleWheel}
      data-canvas-bg="true"
      className={`relative flex-1 overflow-hidden erd-dot-grid select-none touch-none ${
        draggingNodeId ? 'cursor-grabbing' : panning ? 'cursor-grabbing' : 'cursor-grab'
      } ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}
    >
      {/* Top-Right Zoom & Canvas Controls */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute top-4 right-4 sm:right-5 z-20 bg-white border border-[#E5E7EB] rounded-[7px] shadow-[0_1px_2px_rgba(0,0,0,0.04)] flex items-center divide-x divide-[#E5E7EB]"
      >
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.3, Number((z - 0.1).toFixed(2))))}
          title="Zoom out"
          aria-label="Zoom out"
          className="w-8 h-8 flex items-center justify-center text-[#374151] hover:bg-[#F9FAFB] rounded-l-[7px] transition-colors cursor-pointer"
        >
          <Minus className="w-3.5 h-3.5" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(1.8, Number((z + 0.1).toFixed(2))))}
          title="Zoom in"
          aria-label="Zoom in"
          className="w-8 h-8 flex items-center justify-center text-[#374151] hover:bg-[#F9FAFB] transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={fitToView}
          title="Fit diagram to screen"
          aria-label="Fit diagram to screen"
          className="w-8 h-8 flex items-center justify-center text-[#374151] hover:bg-[#F9FAFB] transition-colors cursor-pointer"
        >
          <Scan className="w-3.5 h-3.5" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={toggleFullscreen}
          title="Toggle fullscreen"
          aria-label="Toggle fullscreen"
          className="w-8 h-8 flex items-center justify-center text-[#374151] hover:bg-[#F9FAFB] rounded-r-[7px] transition-colors cursor-pointer"
        >
          {isFullscreen ? (
            <Minimize2 className="w-3.5 h-3.5" strokeWidth={1.8} />
          ) : (
            <Maximize2 className="w-3.5 h-3.5" strokeWidth={1.8} />
          )}
        </button>
      </div>

      {/* Bottom-Left ERD Builder Bar */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute bottom-4 left-4 z-20 bg-white border border-[#E5E7EB] rounded-[7px] shadow-[0_1px_2px_rgba(0,0,0,0.04)] flex items-center divide-x divide-[#E5E7EB] text-[12px] font-medium text-[#374151] max-w-[calc(100vw-2rem)] overflow-x-auto no-scrollbar"
      >
        <button
          type="button"
          onClick={() => onOpenAddTable('table')}
          className="px-2.5 h-8 flex items-center gap-1.5 hover:bg-[#F9FAFB] whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-[#6B7280]" />
          <span>Table</span>
        </button>
        <button
          type="button"
          onClick={() => onOpenAddTable('view')}
          className="px-2.5 h-8 flex items-center gap-1.5 hover:bg-[#F9FAFB] whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Eye className="w-3.5 h-3.5 text-[#6B7280]" />
          <span>View</span>
        </button>
        <button
          type="button"
          onClick={onOpenAddRelation}
          className="px-2.5 h-8 flex items-center gap-1.5 hover:bg-[#F9FAFB] whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Link2 className="w-3.5 h-3.5 text-[#6B7280]" />
          <span>Relation</span>
        </button>
        <button
          type="button"
          onClick={handleAutoLayout}
          title="Arrange tables cleanly without overlap"
          className="px-2.5 h-8 flex items-center gap-1.5 hover:bg-[#F9FAFB] whitespace-nowrap shrink-0 cursor-pointer"
        >
          <LayoutGrid className="w-3.5 h-3.5 text-[#6B7280]" />
          <span>Auto Layout</span>
        </button>
        <button
          type="button"
          onClick={() => setShowAllNodes((v) => !v)}
          className={`px-2.5 h-8 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
            showAllNodes ? 'bg-[#F3F4F6] text-[#111827]' : 'hover:bg-[#F9FAFB]'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-[#6B7280]" />
          <span>
            {showAllNodes ? `Focus (${visibleNodes.length})` : `All (${graph.nodes.length})`}
          </span>
        </button>
        {hasUnsavedEdits && (
          <button
            type="button"
            onClick={onSaveSnapshot}
            className="px-3 h-8 flex items-center gap-1.5 bg-[#111827] text-white hover:bg-[#1F2937] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Snapshot</span>
          </button>
        )}
      </div>

      {/* Transform Stage */}
      <div
        data-canvas-bg="true"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
        className="absolute inset-0 pointer-events-none"
      >
        {/* SVG Edges Layer */}
        <svg
          className="overflow-visible absolute top-0 left-0 w-[1px] h-[1px] pointer-events-none"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="erd-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 1 1.5 L 8.5 5 L 1 8.5 z" fill="#9CA3AF" />
            </marker>
            <marker
              id="erd-arrow-active"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 1 1.5 L 8.5 5 L 1 8.5 z" fill="#2563EB" />
            </marker>
          </defs>

          {computedEdges.map((edge) => (
            <path
              key={edge.rel.id}
              d={edge.pathD}
              fill="none"
              stroke={edge.isHighlighted ? '#2563EB' : '#9CA3AF'}
              strokeWidth={edge.isHighlighted ? 1.85 : 1.3}
              strokeDasharray={edge.rel.kind === 'view_dep' && edge.isHighlighted ? '5 3' : undefined}
              markerEnd={edge.isHighlighted ? 'url(#erd-arrow-active)' : 'url(#erd-arrow)'}
            />
          ))}
        </svg>

        {/* Midpoint (...) Edge Pills */}
        {computedEdges.map((edge) => {
          const isOpen = activeRelationId === edge.rel.id;

          return (
            <div
              key={`pill_${edge.rel.id}`}
              style={{ left: edge.midX, top: edge.midY }}
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto z-10"
            >
              <button
                type="button"
                onClick={() => setActiveRelationId(isOpen ? null : edge.rel.id)}
                title={edge.rel.label || 'View relationship'}
                className={`w-6 h-6 rounded-full bg-white border shadow-xs flex items-center justify-center transition-colors cursor-pointer ${
                  edge.isHighlighted
                    ? 'border-[#2563EB] text-[#2563EB]'
                    : 'border-[#D1D5DB] hover:border-[#6B7280] text-[#6B7280] hover:text-[#111827]'
                }`}
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>

              {isOpen && (
                <div className="absolute left-1/2 -translate-x-1/2 top-8 w-64 bg-white border border-[#E5E7EB] rounded-lg shadow-lg p-3 z-30 text-left">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
                      {edge.rel.kind === 'view_dep' ? 'View Dependency' : 'Foreign Key'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveRelationId(null)}
                      className="text-[#9CA3AF] hover:text-[#111827]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-[12px] text-[#111827] font-mono break-all">
                    {edge.source.name}.{edge.rel.sourceColumn || '*'} → {edge.target.name}.
                    {edge.rel.targetColumn || '*'}
                  </p>
                  {edge.rel.label && (
                    <p className="text-[11.5px] text-[#6B7280] mt-1">{edge.rel.label}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteRelation(edge.rel.id)}
                    className="mt-2.5 w-full py-1 px-2 rounded border border-[#FECACA] text-[#DC2626] hover:bg-[#FEF2F2] text-[11.5px] font-medium flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    Remove Relation
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* ERD Table & View Node Cards */}
        {visibleNodes.map((node) => {
          const activeSubTab: CardSubTab = cardTabs[node.id] || 'columns';
          const isSelected = selectedNodeId === node.id;
          const nodeDiff = diff.tables[node.id];
          const isAddedNode = diffEnabled && nodeDiff?.change === 'added';
          const topBorderColor =
            node.kind === 'view' ? 'border-t-[#1F2937]' : 'border-t-[#1D4ED8]';

          const isDraggingThis = draggingNodeId === node.id;

          return (
            <div
              key={node.id}
              style={{ left: node.position.x, top: node.position.y, width: ERD_CARD_WIDTH }}
              onMouseEnter={() => setHoveredNodeId(node.id)}
              onMouseLeave={() => setHoveredNodeId((prev) => (prev === node.id ? null : prev))}
              onPointerDown={(e) => handleNodeDragStart(e, node)}
              className={`absolute pointer-events-auto touch-none bg-white rounded-[10px] border border-[#E2E8F0] border-t-2 ${topBorderColor} ${
                isDraggingThis
                  ? 'shadow-[0_14px_30px_-4px_rgba(15,23,42,0.16)] ring-2 ring-[#2563EB]/30 z-30 cursor-grabbing'
                  : isSelected
                    ? 'shadow-[0_4px_16px_-2px_rgba(15,23,42,0.06)] ring-2 ring-[#2563EB]/25 z-10'
                    : 'shadow-[0_4px_16px_-2px_rgba(15,23,42,0.06)]'
              }`}
            >
              {/* Node Header (full header is draggable) */}
              <div
                className={`px-4 pt-3.5 pb-2.5 flex items-center justify-between gap-2 ${
                  isDraggingThis ? 'cursor-grabbing' : 'cursor-grab'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {node.kind === 'view' ? (
                    <Eye className="w-4 h-4 text-[#374151] shrink-0" strokeWidth={1.75} />
                  ) : (
                    <Table2 className="w-4 h-4 text-[#374151] shrink-0" strokeWidth={1.75} />
                  )}
                  <span className="text-[13.5px] font-semibold text-[#111827] truncate">
                    {node.schema && node.schema !== 'public'
                      ? `${node.schema}.${node.name}`
                      : node.name}
                  </span>
                  {node.kind === 'view' && (
                    <span className="px-1.5 py-0.5 rounded-[4px] bg-[#F3F4F6] text-[#4B5563] text-[10px] font-semibold tracking-wider uppercase shrink-0">
                      VIEW
                    </span>
                  )}
                  {isAddedNode && (
                    <span className="text-[11px] font-semibold text-[#16A34A] shrink-0">
                      + new
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenEditNode(node);
                    }}
                    title={`Edit ${node.name}`}
                    className="p-1 rounded hover:bg-[#F3F4F6] text-[#9CA3AF] hover:text-[#111827] transition-colors cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onPointerDown={(e) => handleNodeDragStart(e, node, true)}
                    title="Drag card"
                    aria-label={`Drag ${node.name}`}
                    className="p-1 rounded hover:bg-[#F3F4F6] text-[#6B7280] hover:text-[#111827] cursor-grab active:cursor-grabbing"
                  >
                    <Move className="w-3.5 h-3.5" strokeWidth={1.8} />
                  </button>
                </div>
              </div>

              {/* Card Internal Tabs */}
              <div className="px-4 border-b border-[#E5E7EB] flex items-center gap-4 text-[12px]">
                <button
                  type="button"
                  onClick={() => setCardTabs((p) => ({ ...p, [node.id]: 'columns' }))}
                  className={`pb-2 -mb-[1px] border-b-2 transition-colors cursor-pointer ${
                    activeSubTab === 'columns'
                      ? 'border-[#111827] text-[#111827] font-medium'
                      : 'border-transparent text-[#6B7280] hover:text-[#111827]'
                  }`}
                >
                  Columns
                </button>

                {node.kind === 'view' && (
                  <>
                    <button
                      type="button"
                      onClick={() => setCardTabs((p) => ({ ...p, [node.id]: 'create' }))}
                      className={`pb-2 -mb-[1px] border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                        activeSubTab === 'create'
                          ? 'border-[#111827] text-[#111827] font-medium'
                          : 'border-transparent text-[#6B7280] hover:text-[#111827]'
                      }`}
                    >
                      Create Statement
                    </button>
                    <button
                      type="button"
                      onClick={() => setCardTabs((p) => ({ ...p, [node.id]: 'dependencies' }))}
                      className={`pb-2 -mb-[1px] border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                        activeSubTab === 'dependencies'
                          ? 'border-[#111827] text-[#111827] font-medium'
                          : 'border-transparent text-[#6B7280] hover:text-[#111827]'
                      }`}
                    >
                      Dependencies
                    </button>
                  </>
                )}

                {node.kind === 'table' && node.indexes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCardTabs((p) => ({ ...p, [node.id]: 'indexes' }))}
                    className={`pb-2 -mb-[1px] border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                      activeSubTab === 'indexes'
                        ? 'border-[#111827] text-[#111827] font-medium'
                        : 'border-transparent text-[#6B7280] hover:text-[#111827]'
                    }`}
                  >
                    Indexes
                  </button>
                )}
              </div>

              {/* Card Body */}
              {activeSubTab === 'columns' && (
                <div className="px-4 py-3">
                  <div className="grid grid-cols-[1.25fr_1.15fr_36px] gap-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                    <span>NAME</span>
                    <span>TYPE</span>
                    <span className="text-right">NULL</span>
                  </div>
                  <div className="divide-y divide-[#F9FAFB]">
                    {node.columns.map((col) => {
                      const colChange = diffEnabled
                        ? diff.columnsByTable[node.id]?.[col.name]
                        : undefined;
                      const isColAdded = colChange === 'added' && nodeDiff?.change !== 'added';
                      const fkTooltip = col.references
                        ? `FK → ${col.references.table}.${col.references.column}`
                        : undefined;

                      return (
                        <div
                          key={col.name}
                          title={fkTooltip}
                          className={`grid grid-cols-[1.25fr_1.15fr_36px] gap-2 items-center py-1.5 text-[12px] rounded px-1 -mx-1 ${
                            isColAdded ? 'bg-[#ECFDF5]' : ''
                          }`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            {isColAdded && (
                              <span className="text-[#16A34A] font-semibold leading-none">+</span>
                            )}
                            <span
                              className={`truncate font-medium ${
                                isColAdded ? 'text-[#15803D]' : 'text-[#111827]'
                              }`}
                            >
                              {col.name}
                            </span>
                            {col.isPrimaryKey && (
                              <KeyRound
                                className="w-3.5 h-3.5 text-[#1D4ED8] shrink-0"
                                strokeWidth={2}
                              />
                            )}
                            {!col.isPrimaryKey && col.isForeignKey && (
                              <KeyRound
                                className="w-3.5 h-3.5 text-[#6B7280] shrink-0"
                                strokeWidth={1.8}
                              />
                            )}
                          </div>
                          <div>
                            <span className="inline-block px-2 py-0.5 rounded-[5px] bg-[#F3F4F6] text-[#374151] font-mono text-[11px] whitespace-nowrap">
                              {col.type}
                            </span>
                          </div>
                          <span className="text-right text-[12px] text-[#374151] tabular-nums">
                            {col.nullable ? 'Yes' : 'No'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeSubTab === 'create' && (
                <div className="p-3">
                  <pre className="p-2.5 rounded-md bg-[#F9FAFB] border border-[#E5E7EB] font-mono text-[11px] text-[#1F2937] overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-56">
                    {node.createStatement ||
                      `CREATE OR REPLACE VIEW "${node.schema}"."${node.name}" AS ...`}
                  </pre>
                </div>
              )}

              {activeSubTab === 'dependencies' && (
                <div className="px-4 py-3 space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                    Referenced Objects
                  </p>
                  {(node.dependencies && node.dependencies.length > 0
                    ? node.dependencies
                    : ['No external dependencies']
                  ).map((dep) => (
                    <div
                      key={dep}
                      className="px-2.5 py-1.5 rounded bg-[#F9FAFB] border border-[#E5E7EB] font-mono text-[11.5px] text-[#374151]"
                    >
                      {dep}
                    </div>
                  ))}
                </div>
              )}

              {activeSubTab === 'indexes' && (
                <div className="px-4 py-3 space-y-1.5">
                  {node.indexes.map((idx) => (
                    <div
                      key={idx.name}
                      className="flex items-center justify-between text-[12px] py-1 border-b border-[#F3F4F6] last:border-0"
                    >
                      <span className="font-medium text-[#111827] truncate">{idx.name}</span>
                      <span className="font-mono text-[11px] text-[#6B7280] shrink-0">
                        ({idx.columns.join(', ')})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
