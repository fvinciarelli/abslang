import { useState } from 'react';
import { useSession } from './hooks/useSession';
import { BehaviorList } from './components/BehaviorList';
import { BehaviorEditor } from './components/BehaviorEditor';
import { YAMLPreview } from './components/YAMLPreview';
import { SessionHeader } from './components/SessionHeader';
import { Code2, Plus, Download, Upload, ChevronRight } from 'lucide-react';
import { newId } from './types';

import { behaviorToYAML } from './types';
import * as yaml from 'js-yaml';

export default function App() {
  const {
    session,
    selected,
    selectedId,
    select,
    updateBehavior,
    addBehavior,
    removeBehavior,
    moveBehavior,
    addEvaluation,
    removeEvaluation,
    updateSessionMeta,
    setSession,
  } = useSession();

  const [showPreview, setShowPreview] = useState(true);

  const handleNew = () => {
    setSession({
      session: 'New Session',
      description: '',
      abs_version: '0.1',
      behaviors: [],
      evaluations: [],
    });
  };

  const handleExport = () => {
    const doc: any = { session: session.session };
    if (session.description) doc.description = session.description;
    if (session.abs_version) doc.abs_version = session.abs_version;
    doc.behaviors = session.behaviors.map(behaviorToYAML);
    if (session.evaluations?.length) doc.evaluations = session.evaluations;

    const yamlStr = yaml.dump(doc, { indent: 2, lineWidth: -1, noRefs: true });
    const blob = new Blob([yamlStr], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.session.toLowerCase().replace(/\s+/g, '-')}.abs.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.yaml,.yml,.abs.yaml';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const { parseYaml, expandFragments } = await import('./yaml-parser');
        const docs = parseYaml(text);
        if (docs.length > 0) {
          const doc = docs[0];
          const expanded = expandFragments(doc);
          setSession({
            ...expanded,
            behaviors: expanded.behaviors.map((b: any) => ({ ...b, id: newId() })),
          });
        }
      } catch (err) {
        alert('Invalid ABS file: ' + (err as Error).message);
      }
    };
    input.click();
  };

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Top bar */}
      <header className="h-12 bg-white border-b border-slate-200 flex items-center px-4 gap-3 shrink-0 z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-indigo-600 flex items-center justify-center text-white font-bold text-xs">
            ABS
          </div>
          <span className="font-semibold text-sm text-slate-800">Editor</span>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          <button onClick={handleNew} className="h-8 px-3 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md flex items-center gap-1.5 transition-colors">
            <Plus size={13} /> New
          </button>
          <button onClick={handleImport} className="h-8 px-3 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md flex items-center gap-1.5 transition-colors">
            <Upload size={13} /> Import
          </button>
          <button onClick={handleExport} className="h-8 px-3 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md flex items-center gap-1.5 transition-colors">
            <Download size={13} /> Export
          </button>
          <div className="w-px h-5 bg-slate-200 mx-1" />
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={`h-8 px-3 text-xs rounded-md flex items-center gap-1.5 transition-colors ${
              showPreview ? 'bg-slate-900 text-white hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            <Code2 size={13} /> YAML
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar */}
        <aside className="w-60 bg-white border-r border-slate-200 flex flex-col shrink-0">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Behaviors</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            <BehaviorList
              behaviors={session.behaviors}
              selectedId={selectedId}
              onSelect={select}
              onRemove={removeBehavior}
              onMove={moveBehavior}
              onAdd={addBehavior}
            />
          </div>
        </aside>

        {/* Center editor */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto p-8">
            <SessionHeader session={session} onUpdate={updateSessionMeta} />

            {selected ? (
              <BehaviorEditor
                behavior={selected}
                onUpdate={(updates) => updateBehavior(selected.id, updates)}
                onAddEvaluation={(e) => addEvaluation(selected.id, e)}
                onRemoveEvaluation={(idx) => removeEvaluation(selected.id, idx)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-24 text-slate-300">
                <ChevronRight size={40} className="mb-4 opacity-20" />
                <p className="text-sm font-medium text-slate-400">Select a behavior to edit</p>
                <p className="text-xs text-slate-350 mt-1">Click any step in the sidebar</p>
              </div>
            )}
          </div>
        </main>

        {/* Right preview panel */}
        {showPreview && (
          <aside className="w-80 bg-slate-950 border-l border-slate-800 flex flex-col shrink-0">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
              <Code2 size={13} className="text-slate-500" />
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">YAML Preview</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <YAMLPreview session={session} />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
