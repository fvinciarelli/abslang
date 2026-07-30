'use client';

import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

// Initialize mermaid once
let initialized = false;
function initMermaid() {
  if (initialized) return;
  initialized = true;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'neutral',
    securityLevel: 'loose',
    fontFamily: 'Inter, sans-serif',
    sequence: {
      diagramMarginX: 50,
      diagramMarginY: 10,
      actorMargin: 50,
      width: 150,
      height: 65,
      boxMargin: 10,
      boxTextMargin: 5,
      noteMargin: 10,
      messageMargin: 35,
      mirrorActors: true,
      useMaxWidth: true
    }
  });
}

interface MermaidProps {
  chart: string;
  className?: string;
}

export default function Mermaid({ chart, className = '' }: MermaidProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const idRef = useRef(`mermaid-${Math.random().toString(36).substring(2, 9)}`);

  useEffect(() => {
    initMermaid();
    const renderChart = async () => {
      try {
        const { svg } = await mermaid.render(idRef.current, chart);
        setSvg(svg);
        setError('');
      } catch (e: any) {
        setError(e.message || 'Failed to render diagram');
        setSvg('');
      }
    };
    renderChart();
  }, [chart]);

  if (error) {
    return (
      <div className={`my-6 p-4 border border-red-200 bg-red-50 rounded-lg ${className}`}>
        <p className="text-sm text-red-600 font-medium mb-2">Diagram error</p>
        <pre className="text-xs text-red-500 whitespace-pre-wrap">{error}</pre>
        <details className="mt-2">
          <summary className="text-xs text-red-400 cursor-pointer">Source</summary>
          <pre className="mt-1 text-xs text-gray-500 whitespace-pre-wrap">{chart}</pre>
        </details>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className={`my-6 flex items-center justify-center p-8 bg-gray-50 rounded-lg ${className}`}>
        <div className="animate-pulse text-sm text-gray-400">Rendering diagram…</div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={`my-6 flex justify-center overflow-x-auto ${className}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
