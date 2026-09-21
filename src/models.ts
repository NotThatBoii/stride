export interface Subject {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  created_at: string;
  archived: number;
}
export interface Session {
  id: string;
  subject_id: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  session_title: string;
  notes: string;
  mode: "stopwatch" | "countdown";
  completed: number;
}
export interface Slice {
  session_id: string;
  day: string;
  seconds: number;
}
export interface Settings {
  minimum: number;
  goal: number;
  presets: string;
  weekStart: number;
  theme: string;
  notifications: boolean;
  onboarded: boolean;
}
export interface Segment {
  start: number;
  end: number;
}
export interface Running {
  id: string;
  subjectId: string;
  startedAt: string;
  title: string;
  mode: "stopwatch" | "countdown";
  target: number;
  segments: Segment[];
  runningSince: number | null;
  notified: boolean;
}
export interface Data {
  subjects: Subject[];
  sessions: Session[];
  slices: Slice[];
  settings: Settings;
  running: Running | null;
}
export const defaults: Settings = {
  minimum: 20,
  goal: 60,
  presets: "25,45,60",
  weekStart: 1,
  theme: "dark",
  notifications: false,
  onboarded: false,
};
