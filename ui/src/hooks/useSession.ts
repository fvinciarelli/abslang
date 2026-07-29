import { useState, useCallback, useEffect } from 'react';
import type { Behavior, ABSSession, Evaluation } from '../types';
import { newBehavior, newId } from '../types';

export function useSession() {
  const [session, setSession] = useState<ABSSession>({
    session: 'My Session',
    description: '',
    abs_version: '0.1',
    behaviors: [
      { id: newId(), actor: 'user', action: 'says', content: 'Hi' },
      { id: newId(), actor: 'assistant', action: 'greets', content: 'Hello! How can I help?' },
    ],
    evaluations: [],
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = selectedId
    ? session.behaviors.find((b) => b.id === selectedId) ?? null
    : null;

  useEffect(() => {
    if (session.behaviors.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }

    const exists = selectedId ? session.behaviors.some((b) => b.id === selectedId) : false;
    if (!exists) {
      setSelectedId(session.behaviors[0].id);
    }
  }, [session.behaviors, selectedId]);

  const select = useCallback((id: string) => setSelectedId(id), []);

  const updateBehavior = useCallback((id: string, updates: Partial<Behavior>) => {
    setSession((prev) => ({
      ...prev,
      behaviors: prev.behaviors.map((b) =>
        b.id === id ? { ...b, ...updates } : b
      ),
    }));
  }, []);

  const addBehavior = useCallback((afterId?: string, initial?: Partial<Behavior>) => {
    setSession((prev) => {
      const nb = { ...newBehavior(), ...initial };
      const idx = afterId
        ? prev.behaviors.findIndex((b) => b.id === afterId)
        : prev.behaviors.length - 1;
      const updated = [...prev.behaviors];
      updated.splice(idx + 1, 0, nb);
      setSelectedId(nb.id);
      return { ...prev, behaviors: updated };
    });
  }, []);

  const removeBehavior = useCallback((id: string) => {
    setSession((prev) => {
      const index = prev.behaviors.findIndex((b) => b.id === id);
      const nextBehaviors = prev.behaviors.filter((b) => b.id !== id);

      if (selectedId === id) {
        const replacement = nextBehaviors[index] ?? nextBehaviors[index - 1] ?? null;
        setSelectedId(replacement?.id ?? null);
      }

      return {
        ...prev,
        behaviors: nextBehaviors,
      };
    });
  }, [selectedId]);

  const moveBehavior = useCallback((fromIdx: number, toIdx: number) => {
    setSession((prev) => {
      const updated = [...prev.behaviors];
      const [moved] = updated.splice(fromIdx, 1);
      updated.splice(toIdx, 0, moved);
      return { ...prev, behaviors: updated };
    });
  }, []);

  const addEvaluation = useCallback((behaviorId: string, eval_: Evaluation) => {
    setSession((prev) => ({
      ...prev,
      behaviors: prev.behaviors.map((b) =>
        b.id === behaviorId
          ? { ...b, evaluations: [...(b.evaluations || []), eval_] }
          : b
      ),
    }));
  }, []);

  const removeEvaluation = useCallback((behaviorId: string, evalIdx: number) => {
    setSession((prev) => ({
      ...prev,
      behaviors: prev.behaviors.map((b) =>
        b.id === behaviorId
          ? { ...b, evaluations: (b.evaluations || []).filter((_, i) => i !== evalIdx) }
          : b
      ),
    }));
  }, []);

  const updateSessionMeta = useCallback((updates: Partial<ABSSession>) => {
    setSession((prev) => ({ ...prev, ...updates }));
  }, []);

  return {
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
  };
}
