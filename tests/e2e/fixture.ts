import type { Data, Subject, Session, Slice } from "../../src/models";
import { defaults } from "../../src/models";
import { dayKey } from "../../src/lib/analytics";
// Only loaded by isolated browser tests. Production never seeds user records.
export function fixture(): Data {
  const subjects: Subject[] = [
    "Differential Equations",
    "Circuits",
    "Java Programming",
    "Engineering Economics",
  ].map((name, i) => ({
    id: `subject-${i}`,
    name,
    description: "",
    icon: ["∑", "book", "⌘", "π"][i],
    color: ["#9298df", "#cb996e", "#b49cd5", "#c4ad70"][i],
    created_at: "2026-01-01T00:00:00.000Z",
    archived: 0,
  }));
  const sessions: Session[] = [],
    slices: Slice[] = [];
  for (let n = 170; n >= 0; n--) {
    if (n > 8 && n % 7 === 0) continue;
    const start = new Date();
    start.setDate(start.getDate() - n);
    start.setHours(1, 0, 0, 0);
    const seconds = (20 + ((n * 17) % 105)) * 60;
    const id = `session-${n}`;
    sessions.push({
      id,
      subject_id: subjects[n % 4].id,
      started_at: start.toISOString(),
      ended_at: new Date(start.getTime() + seconds * 1000).toISOString(),
      duration_seconds: seconds,
      session_title: [
        "Exact equations practice",
        "Kirchhoff’s laws",
        "Interfaces and inheritance",
        "Time value of money",
      ][n % 4],
      notes: n === 0 ? "Continue with integrating factors." : "",
      mode: "countdown",
      completed: 1,
    });
    slices.push({ session_id: id, day: dayKey(start), seconds });
  }
  return {
    subjects,
    sessions,
    slices,
    settings: { ...defaults, onboarded: true },
    running: null,
  };
}
