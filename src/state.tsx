import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Data } from "./models";
import { initialize, readData } from "./lib/storage";
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
  const [data, setData] = useState<Data>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let cancelled = false;
    let subscription: { unsubscribe: () => void } | undefined;
    initialize()
      .then(() => {
        if (!cancelled)
          subscription = liveQuery(() => readData()).subscribe({
            next: setData,
            error: (e) => setError(String(e)),
          });
      })
      .catch((e) => setError(String(e)));
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      subscription?.unsubscribe();
      clearInterval(tick);
    };
  }, []);
  async function act(work: () => Promise<void>) {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    try {
      await work();
      setData(await readData());
      setError("");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
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
      value={{ data, now, busy, error, clearError: () => setError(""), act }}
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
