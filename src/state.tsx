import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Data } from "./models";
import {
  getActiveDatabase,
  getActiveWorkspace,
  initialize,
  readData,
  subscribeWorkspace,
} from "./lib/storage";
import { liveQuery } from "dexie";
interface State {
  data: Data;
  now: number;
  busy: boolean;
  error: string;
  clearError: () => void;
  act: (work: () => Promise<void>) => Promise<boolean>;
}
const Context = createContext<State | null>(null);
export function Provider({ children }: { children: ReactNode }) {
  const workspace = useSyncExternalStore(
    subscribeWorkspace,
    getActiveWorkspace,
  );
  const [snapshot, setSnapshot] = useState<{
    generation: number;
    data: Data;
  }>();
  const [failure, setFailure] = useState<{
    generation: number;
    message: string;
  }>();
  const [busyGeneration, setBusyGeneration] = useState<number | null>(null);
  const writing = useRef<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const data =
    snapshot?.generation === workspace.generation ? snapshot.data : undefined;
  const error =
    failure?.generation === workspace.generation ? failure.message : "";
  const busy = busyGeneration === workspace.generation;
  useEffect(() => {
    let cancelled = false;
    let subscription: { unsubscribe: () => void } | undefined;
    const db = getActiveDatabase();
    const generation = workspace.generation;
    const current = () =>
      !cancelled && getActiveWorkspace().generation === generation;
    initialize(db)
      .then(() => {
        if (current())
          subscription = liveQuery(() => readData(db)).subscribe({
            next: (next) => {
              if (current()) setSnapshot({ generation, data: next });
            },
            error: (e) => {
              if (current()) setFailure({ generation, message: String(e) });
            },
          });
      })
      .catch((e) => {
        if (current()) setFailure({ generation, message: String(e) });
      });
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      subscription?.unsubscribe();
      clearInterval(tick);
    };
  }, [workspace.generation]);
  async function act(work: () => Promise<void>) {
    const generation = workspace.generation;
    if (
      getActiveWorkspace().generation !== generation ||
      writing.current === generation
    )
      return false;
    writing.current = generation;
    setBusyGeneration(generation);
    try {
      await work();
      if (getActiveWorkspace().generation !== generation) return false;
      const next = await readData(getActiveDatabase());
      if (getActiveWorkspace().generation !== generation) return false;
      setSnapshot({ generation, data: next });
      setFailure(undefined);
      return true;
    } catch (e) {
      if (getActiveWorkspace().generation === generation)
        setFailure({
          generation,
          message: e instanceof Error ? e.message : String(e),
        });
      return false;
    } finally {
      if (writing.current === generation) writing.current = null;
      if (getActiveWorkspace().generation === generation)
        setBusyGeneration(null);
    }
  }
  if (!data)
    return (
      <div className="boot">
        <div className="brand-mark">s</div>
        <h1>{error ? "Unable to open your data" : "Opening Stride"}</h1>
        <p>{error || "A little progress, every day."}</p>
        {error && <button onClick={() => location.reload()}>Try again</button>}
      </div>
    );
  return (
    <Context.Provider
      key={workspace.generation}
      value={{
        data,
        now,
        busy,
        error,
        clearError: () => setFailure(undefined),
        act,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useStride() {
  const state = useContext(Context);
  if (!state) throw new Error("Missing Stride provider");
  return state;
}
