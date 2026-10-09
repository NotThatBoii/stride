import { useEffect, useState } from "react";
import { captureEditSnapshot, type EditSnapshot } from "../lib/storage";

export function useEditSnapshot(
  entity: EditSnapshot["entity"],
  id: string | undefined,
  payload: EditSnapshot["payload"] | undefined,
) {
  const [snapshot, setSnapshot] = useState<EditSnapshot>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!id || !payload) return;
    let cancelled = false;
    void captureEditSnapshot(entity, id, payload).then(
      (value) => {
        if (!cancelled) setSnapshot(value);
      },
      (reason: unknown) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to open this record. Close the editor and try again.",
          );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [entity, id, payload]);
  return { snapshot, error, ready: !id || !!snapshot };
}
