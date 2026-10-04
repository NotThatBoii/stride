// Deterministic, synthetic study data. Never use a user's workspace or credentials.
export const sizes = [100, 1_000, 10_000];
export const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const sharedSettings = {
  minimum: 20,
  goal: 60,
  presets: "25,45,60",
  weekStart: 1,
};
export const settings = {
  ...sharedSettings,
  theme: "dark",
  notifications: false,
  onboarded: true,
};

export function workload(count, noteCharacters = 100) {
  if (!Number.isInteger(count) || count < 1 || count > 10_000)
    throw new Error("The isolated workload must contain 1–10,000 sessions.");
  const subjects = Array.from({ length: 20 }, (_, index) => ({
    id: `perf-subject-${String(index + 1).padStart(2, "0")}`,
    name: `Study subject ${index + 1}`,
    description: "A synthetic subject for repeatable release measurements.",
    icon: "book",
    color: "#8b91e8",
    created_at: "2023-10-01T00:00:00.000Z",
    archived: index >= 18 ? 1 : 0,
  }));
  const sessions = [];
  const slices = [];
  const base = Date.parse("2023-10-01T00:00:00.000Z");
  for (let index = 0; index < count; index++) {
    const id = `perf-session-${String(index + 1).padStart(5, "0")}`;
    const dayStart = base + (index % 1_095) * 86_400_000;
    const crossing = index % 5 === 0;
    // Asia/Manila: 23:50–00:20 for crossing sessions, 09:00–09:30 otherwise.
    const from = dayStart + (crossing ? 15 * 60 + 50 : 60) * 60_000;
    sessions.push({
      id,
      subject_id: subjects[index % subjects.length].id,
      started_at: new Date(from).toISOString(),
      ended_at: new Date(from + 1_800_000).toISOString(),
      duration_seconds: 1_800,
      session_title: `Review ${String(index + 1).padStart(5, "0")}`,
      notes: "Reviewed examples; next time practice the difficult questions. "
        .padEnd(noteCharacters, "x")
        .slice(0, noteCharacters),
      mode: index % 2 ? "countdown" : "stopwatch",
      completed: 1,
    });
    const day = new Date(dayStart).toISOString().slice(0, 10);
    slices.push({ session_id: id, day, seconds: crossing ? 600 : 1_800 });
    if (crossing)
      slices.push({
        session_id: id,
        day: new Date(dayStart + 86_400_000).toISOString().slice(0, 10),
        seconds: 1_200,
      });
  }
  return {
    subjects,
    sessions,
    slices,
    settings: { ...settings },
    running: null,
  };
}

export function operationId(index) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

export function operations(data) {
  const allocations = new Map();
  for (const slice of data.slices) {
    const values = allocations.get(slice.session_id) ?? [];
    values.push(slice);
    allocations.set(slice.session_id, values);
  }
  const records = [
    ...data.subjects.map((payload) => ({
      entity: "subject",
      record_id: payload.id,
      payload,
    })),
    { entity: "settings", record_id: "settings", payload: sharedSettings },
    ...data.sessions.map((session) => ({
      entity: "session",
      record_id: session.id,
      payload: { session, slices: allocations.get(session.id) },
    })),
  ];
  return records.map((record, index) => ({
    id: operationId(index + 1),
    ...record,
    action: "upsert",
    base_revision: null,
  }));
}

export function rpcBody(operation) {
  return {
    p_operation_id: operation.id,
    p_entity: operation.entity,
    p_record_id: operation.record_id,
    p_action: operation.action,
    p_payload: operation.payload,
    p_expected_revision: operation.base_revision,
  };
}

export const jsonBytes = (value) =>
  Buffer.byteLength(JSON.stringify(value), "utf8");
