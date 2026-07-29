import type { ABSSession } from '../types';

interface Props {
  session: ABSSession;
  onUpdate: (updates: Partial<ABSSession>) => void;
}

export function SessionHeader({ session, onUpdate }: Props) {
  return (
    <div className="mb-6">
      <input
        type="text"
        value={session.session}
        onChange={(e) => onUpdate({ session: e.target.value })}
        className="w-full text-2xl font-bold bg-transparent border-none outline-none text-slate-800 placeholder-slate-300"
        placeholder="Session name"
      />
      <input
        type="text"
        value={session.description || ''}
        onChange={(e) => onUpdate({ description: e.target.value })}
        className="w-full mt-1 text-sm bg-transparent border-none outline-none text-slate-400 placeholder-slate-300"
        placeholder="Add a description..."
      />
    </div>
  );
}
