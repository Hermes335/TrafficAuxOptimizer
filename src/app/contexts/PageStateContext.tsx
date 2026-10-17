import { createContext, useCallback, useContext, useLayoutEffect, useRef, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from "react";

class PageStateStore {
  private values = new Map<string, unknown>();
  private listeners = new Map<string, Set<() => void>>();

  read<T>(key: string, initial: T): T {
    return this.values.has(key) ? this.values.get(key) as T : initial;
  }

  write<T>(key: string, value: T) {
    if (Object.is(this.values.get(key), value)) return;
    this.values.set(key, value);
    this.listeners.get(key)?.forEach(listener => listener());
  }

  subscribe(key: string, listener: () => void) {
    const listeners = this.listeners.get(key) ?? new Set();
    this.listeners.set(key, listeners);
    listeners.add(listener);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(key); };
  }

  reset(prefix: string) {
    const keys = [...this.values.keys()].filter(key => key.startsWith(prefix));
    keys.forEach(key => this.values.delete(key));
    keys.forEach(key => this.listeners.get(key)?.forEach(listener => listener()));
  }
}

const StoreContext = createContext<PageStateStore | null>(null);
const ScopeContext = createContext("");

// Owned by the mounted app session: never written to browser storage.
export function PageStateProvider({ children }: { children: ReactNode }) {
  const store = useRef<PageStateStore>();
  if (!store.current) store.current = new PageStateStore();
  return <StoreContext.Provider value={store.current}>{children}</StoreContext.Provider>;
}

export function PageStateScope({ name, children }: { name: string; children: ReactNode }) {
  return <ScopeContext.Provider value={name}>{children}</ScopeContext.Provider>;
}

export function usePageState<T>(name: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const shared = useContext(StoreContext);
  const fallback = useRef<PageStateStore>();
  if (!fallback.current) fallback.current = new PageStateStore();
  const store = shared ?? fallback.current;
  const scope = useContext(ScopeContext);
  const key = `${scope}\0${name}`;
  const defaults = useRef<{key: string; value: T}>();
  if (!defaults.current || defaults.current.key !== key) {
    defaults.current = {key, value: typeof initial === "function" ? (initial as () => T)() : initial};
  }
  const read = useCallback(() => store.read(key, defaults.current!.value), [store, key]);
  const subscribe = useCallback((listener: () => void) => store.subscribe(key, listener), [store, key]);
  const value = useSyncExternalStore(subscribe, read, read);
  // Seed once per mount/key, including reference values used by pending forms.
  // Snapshot reads stay pure, so clearing a mounted form cannot cache stale defaults.
  useLayoutEffect(() => { store.write(key, value); }, [store, key]);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    const previous = store.read(key, defaults.current!.value);
    store.write(key, typeof action === "function" ? (action as (value: T) => T)(previous) : action);
  }, [store, key]);
  return [value, setValue];
}

export function useResetPageState(prefix: string) {
  const store = useContext(StoreContext);
  const scope = useContext(ScopeContext);
  return useCallback(() => store?.reset(`${scope}\0${prefix}`), [store, scope, prefix]);
}
