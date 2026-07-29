import { useState } from 'react';
import { useSession } from './hooks/useSession';
import { BehaviorList } from './components/BehaviorList';
import { BehaviorEditor } from './components/BehaviorEditor';
import { YAMLPreview } from './components/YAMLPreview';
import { SessionHeader } from './components/SessionHeader';
import { FiCode, FiPlus, FiDownload, FiUpload, FiChevronRight } from 'react-icons/fi';
import { newId } from './types';
import type { ABSSession } from './types';
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
  const [sidebarTab, setSidebarTab] = useState<'behaviors' | 'fragments'>('behaviors');

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
    const yamlStr = sessionToYAML(session);
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
    <div className="h-screen flex flex-col bg-slate-100">
      {/* Top bar */}
      <header className="h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-4 shrink-0 z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-white font-bold text-sm">
            A
          </div>
          <span className="font-semibold text-slate-800">ABS Editor</span>
        </div>

        <div className="flex-1" />

        <button onClick={handleNew} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg flex items-center gap-1.5 transition-colors">
          <FiPlus size={14} /> New
        </button>
        <button onClick={handleImport} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg flex items-center gap-1.5 transition-colors">
          <FiUpload size={14} /> Import
        </button>
        <button onClick={handleExport} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg flex items-center gap-1.5 transition-colors">
          <FiDownload size={14} /> Export
        </button>
        <button
          onClick={() => setShowPreview(!showPreview)}
          className={`px-3 py-1.5 text-sm rounded-lg flex items-center gap-1.5 transition-colors ${
            showPreview ? 'bg-accent text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FiCode size={14} /> YAML
        </button>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar */}
        <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0">
          <div className="flex border-b border-slate-200">
            <button
              onClick={() => setSidebarTab('behaviors')}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                sidebarTab === 'behaviors'
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Behaviors
            </button>
            <button
              onClick={() => setSidebarTab('fragments')}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                sidebarTab === 'fragments'
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Fragments
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {sidebarTab === 'behaviors' && (
              <BehaviorList
                behaviors={session.behaviors}
                selectedId={selectedId}
                onSelect={select}
                onRemove={removeBehavior}
                onMove={moveBehavior}
                onAdd={addBehavior}
              />
            )}
            {sidebarTab === 'fragments' && (
              <div className="p-4 text-sm text-slate-400 text-center mt-8">
                Fragments coming soon
              </div>
            )}
          </div>
        </aside>

        {/* Center editor */}
        <main className="flex-1 overflow-y-auto p-6">
          <SessionHeader
            session={session}
            onUpdate={updateSessionMeta}
          />

          {selected ? (
            <BehaviorEditor
              behavior={selected}
              onUpdate={(updates) => updateBehavior(selected.id, updates)}
              onAddEvaluation={(e) => addEvaluation(selected.id, e)}
              onRemoveEvaluation={(idx) => removeEvaluation(selected.id, idx)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <FiChevronRight size={48} className="mb-4 opacity-30" />
              <p className="text-lg font-medium">Select a behavior to edit</p>
              <p className="text-sm mt-1">Click any step in the sidebar to configure it</p>
            </div>
          )}
        </main>

        {/* Right preview panel */}
        {showPreview && (
          <aside className="w-80 bg-slate-900 border-l border-slate-700 flex flex-col shrink-0">
            <div className="px-4 py-3 border-b border-slate-700 text-slate-300 text-sm font-medium flex items-center gap-2">
              <FiCode size={14} /> YAML Preview
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

function sessionToYAML(session: ABSSession): string {
  const doc: any = {
    session: session.session,
  };
  if (session.description) doc.description = session.description;
  if (session.abs_version) doc.abs_version = session.abs_version;
  doc.behaviors = session.behaviors.map(behaviorToYAML);
  if (session.evaluations && session.evaluations.length > 0) {
    doc.evaluations = session.evaluations;
  }

  return yaml.dump(doc, { indent: 2, lineWidth: -1, noRefs: true });
}
