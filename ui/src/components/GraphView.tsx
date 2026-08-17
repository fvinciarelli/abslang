import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Behavior } from '../types';
import { ACTOR_COLORS } from '../types';

const DEFAULT_COLOR = { dot: '#6b7280', bg: '#f9fafb', text: '#374151' };
const DECISION_COLOR = '#f59e0b';

function BehaviorNode({ data, selected }: any) {
  const color = ACTOR_COLORS[data.actor] ?? DEFAULT_COLOR;
  const isSelected = Boolean(selected);
  const isDecision = Boolean(data.optional);
  const accent = isDecision ? DECISION_COLOR : color.dot;
  const preview =
    typeof data.content === 'string' ? data.content : data.content != null ? JSON.stringify(data.content) : '';

  return (
    <div
      style={{
        padding: '10px 14px',
        borderRadius: 10,
        border: `1px solid ${isSelected ? accent : '#e5e7eb'}`,
        borderLeft: `4px solid ${accent}`,
        background: isSelected ? (isDecision ? '#fffbeb' : color.bg) : '#ffffff',
        minWidth: 170,
        maxWidth: 240,
        boxShadow: isSelected ? '0 6px 16px rgba(0,0,0,0.12)' : '0 1px 3px rgba(0,0,0,0.06)',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: isDecision ? DECISION_COLOR : color.text,
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
          }}
        >
          {isDecision ? '◆ ' : ''}{data.actor} · {data.action}
        </span>
        {isDecision && (
          <span style={{ fontSize: 9, color: '#b45309', border: '1px solid #fcd34d', borderRadius: 4, padding: '1px 4px', background: '#fef3c7' }}>
            decision
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
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { behavior: BehaviorNode };

interface Props {
  behaviors: Behavior[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function GraphView({ behaviors, selectedId, onSelect }: Props) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = behaviors.map((b, i) => ({
      id: b.id,
      type: 'behavior',
      position: { x: 40, y: i * 140 },
      data: { ...b, selected: b.id === selectedId },
    }));

    const byId = new Map(behaviors.map((b) => [b.id, b]));

    // Main flow: consecutive behaviors, solid line
    const edges: Edge[] = [];
    for (let i = 1; i < behaviors.length; i++) {
      edges.push({
        id: `e-${behaviors[i - 1].id}-${behaviors[i].id}`,
        source: behaviors[i - 1].id,
        target: behaviors[i].id,
        type: 'smoothstep',
        style: { stroke: '#d1d5db', strokeWidth: 1.5 },
      });
    }

    // Branch edges: behavior.requires -> behavior, dashed (decision branches)
    for (const b of behaviors) {
      if (b.requires && byId.has(b.requires)) {
        edges.push({
          id: `r-${b.requires}-${b.id}`,
          source: b.requires,
          target: b.id,
          type: 'smoothstep',
          style: { stroke: DECISION_COLOR, strokeWidth: 1.5, strokeDasharray: '5 5' },
        });
      }
    }

    return { nodes, edges };
  }, [behaviors, selectedId]);

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelect(node.id)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#f3f4f6" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <div
        style={{
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
        }}
      >
        ◆ <span style={{ color: '#b45309' }}>decision</span> = optional step (if/else) · dashed edge = <span style={{ color: '#b45309' }}>requires</span>
      </div>
    </div>
  );
}
