import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Paper } from '../types/paper';

interface SelectionApi {
  /** Selected papers in the order they were selected. */
  papers: Paper[];
  count: number;
  isSelected(id: string): boolean;
  toggle(paper: Paper): void;
  selectMany(papers: Paper[]): void;
  deselectMany(papers: Paper[]): void;
  clear(): void;
}

const SelectionContext = createContext<SelectionApi | null>(null);

/**
 * Selection is global (it follows the user across pages) and keeps the full
 * paper objects, so papers from live searches can be exported too.
 */
export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Map<string, Paper>>(new Map());

  const toggle = useCallback((paper: Paper) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (!next.delete(paper.id)) next.set(paper.id, paper);
      return next;
    });
  }, []);
  const selectMany = useCallback((papers: Paper[]) => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const p of papers) next.set(p.id, p);
      return next;
    });
  }, []);
  const deselectMany = useCallback((papers: Paper[]) => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const p of papers) next.delete(p.id);
      return next;
    });
  }, []);
  const clear = useCallback(() => setSelected(new Map()), []);

  const api = useMemo<SelectionApi>(
    () => ({
      papers: [...selected.values()],
      count: selected.size,
      isSelected: (id) => selected.has(id),
      toggle, selectMany, deselectMany, clear,
    }),
    [selected, toggle, selectMany, deselectMany, clear],
  );
  return <SelectionContext.Provider value={api}>{children}</SelectionContext.Provider>;
}

export function useSelection(): SelectionApi {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error('useSelection must be used inside <SelectionProvider>');
  return ctx;
}
