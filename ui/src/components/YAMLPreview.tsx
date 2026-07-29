import { useMemo } from 'react';
import type { ABSSession } from '../types';
import { behaviorToYAML } from '../types';

interface Props {
  session: ABSSession;
}

export function YAMLPreview({ session }: Props) {
  const yaml = useMemo(() => {
    const doc: any = {
      session: session.session,
    };
    if (session.description) doc.description = session.description;
    if (session.abs_version) doc.abs_version = session.abs_version;
    doc.behaviors = session.behaviors.map(behaviorToYAML);
    if (session.evaluations && session.evaluations.length > 0) {
      doc.evaluations = session.evaluations;
    }

    return toYAML(doc, 0);
  }, [session]);

  return (
    <pre className="text-xs text-slate-300 font-mono leading-relaxed whitespace-pre-wrap break-all">
      {yaml || '# No behaviors defined yet'}
    </pre>
  );
}

function toYAML(obj: any, indent: number): string {
  const pad = '  '.repeat(indent);

  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'string') {
    if (obj.includes('\n') || obj.includes('"') || obj.includes("'") || obj.includes(':')) {
      return `"${obj.replace(/"/g, '\\"')}"`;
    }
    return obj.includes(' ') || obj.length === 0 ? `"${obj}"` : obj;
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  if (typeof obj !== 'object') return String(obj);

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj.map((item) => {
      const val = toYAML(item, indent + 1);
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        return `${pad}- ${val.trimStart()}`;
      }
      return `${pad}- ${val}`;
    }).join('\n');
  }

  const keys = Object.keys(obj);
  if (keys.length === 0) return '{}';

  return keys.map((key) => {
    const val = obj[key];
    if (typeof val === 'object' && val !== null && !Array.isArray(val) && Object.keys(val).length > 0) {
      return `${pad}${key}:\n${toYAML(val, indent + 1)}`;
    }
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
      return `${pad}${key}:\n${toYAML(val, indent + 1)}`;
    }
    return `${pad}${key}: ${toYAML(val, indent)}`;
  }).join('\n');
}
