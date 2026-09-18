import { useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  applyNodeChanges,
  applyEdgeChanges,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type NodeMouseHandler,
  type EdgeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Box from '@mui/material/Box';
import type { Behavior } from '../types';
import { ACTOR_COLORS } from '../types';
import { AddBehaviorBar } from './AddBehaviorBar';

const DEFAULT_COLOR = { dot: '#6b7280', bg: '#f9fafb', text: '#374151' };
const BRANCH_COLOR = '#f59e0b';
const FLOW_EDGE = '#d1d5db';

function BehaviorNode({ data, selected }: any) {
  const color = ACTOR_COLORS[data.actor] ?? DEFAULT_COLOR;
  const isSelected = Boolean(selected) || Boolean(data.selected);
  const isOptional = Boolean(data.optional);
  const accent = isOptional ? BRANCH_COLOR : color.dot;
  const preview =
    typeof data.content === 'string' ? data.content : data.content != null ? JSON.stringify(data.content) : '';

  const handleStyle = {
    width: 10,
    height: 10,
    background: '#ffffff',
    border: `2px solid ${accent}`,
  };

  return (
    <div
      style={{
        padding: '10px 14px',
        borderRadius: 10,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: isSelected ? accent : '#e5e7eb',
        borderLeftWidth: 4,
        borderLeftColor: accent,
        background: isSelected ? (isOptional ? '#fffbeb' : color.bg) : '#ffffff',
        minWidth: 170,
        maxWidth: 240,
        boxShadow: isSelected ? '0 6px 16px rgba(0,0,0,0.12)' : '0 1px 3px rgba(0,0,0,0.06)',
      }}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: isOptional ? BRANCH_COLOR : color.text,
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
          }}
        >
          {data.actor} · {data.action}
        </span>
        {isOptional && (
          <span style={{ fontSize: 9, color: '#b45309', border: '1px solid #fcd34d', borderRadius: 4, padding: '1px 4px', background: '#fef3c7' }}>
            optional
          </span>
        )}
      </div>
      {preview && (
        <div style={{ fontSize: 12, color: '#374151', marginTop: 4, wordBreak: 'break-word', maxHeight: 48, overflow: 'hidden' }}>
          {preview.slice(0, 70)}
        </div>
      )}
      {(data.evaluations?.length ?? 0) > 0 && (
        <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {data.evaluations.map((e: any, i: number) => (
            <span key={i} style={{ fontSize: 9, color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: 4, padding: '1px 4px' }}>
              {e.type}
            </span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </div>
  );
}

function RequiresEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, data } = props;
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: BRANCH_COLOR,
          strokeWidth: selected ? 2.5 : 2,
          strokeDasharray: '6 4',
        }}
      />
      <EdgeLabelRenderer>
        <button
          className="nodrag nopan"
          title="Remove link"
          onClick={(e) => {
            e.stopPropagation();
            (data as any)?.onDelete?.();
          }}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
            width: 24,
            height: 24,
            borderRadius: '50%',
            border: `1px solid ${BRANCH_COLOR}`,
            background: '#ffffff',
            color: '#b45309',
            fontSize: 15,
            lineHeight: 1,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
        >
          ×
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { behavior: BehaviorNode };
const edgeTypes = { requires: RequiresEdge };

function buildEdges(behaviors: Behavior[], onDelete: (target: string) => void): Edge[] {
  const byId = new Map(behaviors.map((b) => [b.id, b]));
  const edges: Edge[] = [];

  // Main flow: consecutive behaviors, solid line (not user-editable)
  for (let i = 1; i < behaviors.length; i++) {
    edges.push({
      id: `e-${behaviors[i - 1].id}-${behaviors[i].id}`,
      source: behaviors[i - 1].id,
      target: behaviors[i].id,
      type: 'smoothstep',
      style: { stroke: FLOW_EDGE, strokeWidth: 1.5 },
      selectable: false,
      focusable: false,
    });
  }

  // Branch edges: behavior.requires -> behavior, dashed
  for (const b of behaviors) {
    if (b.requires && byId.has(b.requires)) {
      edges.push({
        id: `r-${b.requires}-${b.id}`,
        source: b.requires,
        target: b.id,
        type: 'requires',
        data: { onDelete: () => onDelete(b.id) },
      });
    }
  }

  return edges;
}

interface Props {
  behaviors: Behavior[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (actor: string, action: string) => string;
  onConnect: (source: string, target: string) => void;
  onDisconnect: (target: string) => void;
  onRemove: (id: string) => void;
}

export function GraphView({
  behaviors,
  selectedId,
  onSelect,
  onAdd,
  onConnect,
  onDisconnect,
  onRemove,
}: Props) {
  const [nodes, setNodes] = useNodesState<Node>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);
  const positionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const rfInstance = useRef<any>(null);

  // Rebuild the graph whenever the underlying behaviors change. Node positions
  // are preserved in positionsRef so dragging survives re-renders.
  useEffect(() => {
    const ids = new Set(behaviors.map((b) => b.id));
    for (const id of Object.keys(positionsRef.current)) {
      if (!ids.has(id)) delete positionsRef.current[id];
    }

    setNodes(
      behaviors.map((b, i) => ({
        id: b.id,
        type: 'behavior',
        position: positionsRef.current[b.id] ?? { x: 40, y: i * 140 },
        selected: b.id === selectedId,
        data: { ...b, selected: b.id === selectedId },
      })),
    );
    setEdges(buildEdges(behaviors, onDisconnect));
  }, [behaviors, selectedId, onDisconnect, setNodes, setEdges]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
      for (const c of changes) {
        if (c.type === 'position' && c.position) {
          positionsRef.current[c.id] = { x: c.position.x, y: c.position.y };
        }
      }
    },
    [setNodes],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [setEdges],
  );

  const handleConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || conn.source === conn.target) return;

      const targetBehavior = behaviors.find((b) => b.id === conn.target);
      if (targetBehavior?.requires) return; // already linked; remove the link first

      // Simple cycle guard: adding S -> T (T requires S) must not close a loop.
      let cur: string | undefined = conn.source;
      const seen = new Set<string>();
      while (cur && !seen.has(cur)) {
        if (cur === conn.target) return;
        seen.add(cur);
        cur = behaviors.find((b) => b.id === cur)?.requires;
      }

      onConnect(conn.source, conn.target);
    },
    [behaviors, onConnect],
  );

  const handleNodesDelete = useCallback(
    (deleted: Node[]) => {
      for (const n of deleted) onRemove(n.id);
    },
    [onRemove],
  );

  const handleEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const e of deleted) {
        if (e.id.startsWith('r-')) onDisconnect(e.target);
      }
    },
    [onDisconnect],
  );

  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => onSelect(node.id),
    [onSelect],
  );

  const handleToolbarAdd = useCallback(
    (actor: string, action: string) => {
      onAdd(actor, action);
      setTimeout(() => rfInstance.current?.fitView({ padding: 0.2 }), 80);
    },
    [onAdd],
  );

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData('application/abs-node');
      if (!raw) return;
      let payload: { actor: string; action: string };
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      const position = rfInstance.current?.screenToFlowPosition?.({
        x: event.clientX,
        y: event.clientY,
      });
      const id = onAdd(payload.actor, payload.action);
      if (position && id) {
        positionsRef.current[id] = { x: position.x, y: position.y };
      }
    },
    [onAdd],
  );

  return (
    <Box sx={{ height: '100%', width: '100%', position: 'relative' }}>
      <Box sx={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 10 }}>
        <AddBehaviorBar onAdd={handleToolbarAdd} />
      </Box>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeClick={handleNodeClick}
        onNodesDelete={handleNodesDelete}
        onEdgesDelete={handleEdgesDelete}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onInit={(inst) => {
          rfInstance.current = inst;
        }}
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#f3f4f6" gap={20} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>

      <Box
        sx={{
          position: 'absolute',
          bottom: 12,
          left: 12,
          background: '#ffffff',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: '6px 10px',
          fontSize: 11,
          color: '#6b7280',
          pointerEvents: 'none',
          maxWidth: 'calc(100% - 24px)',
        }}
      >
        <span style={{ color: '#b45309' }}>optional</span> step · dashed edge ={' '}
        <span style={{ color: '#b45309' }}>requires</span> · drag a step from the bar onto the canvas, or drag from a
        node's bottom dot to another node to link them · click <span style={{ color: '#b45309' }}>×</span> on a dashed
        edge to remove the link
      </Box>
    </Box>
  );
}
