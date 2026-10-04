import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Home,
  BookOpen,
  Timer,
  History as HistoryIcon,
  ChartNoAxesCombined,
  Settings as SettingsIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Plus,
  Play,
  X,
  ArrowUpRight,
} from "lucide-react";
import { useStride } from "./state";
import { useAuth } from "./auth/AuthProvider";
import { dayKey, formatTime, parseDay } from "./lib/analytics";
import { elapsed, activeSegments } from "./lib/timer";
import { saveRunning } from "./lib/storage";
import { notifySessionComplete } from "./lib/platform";
import { Mountains } from "./components/Artwork";
import Dashboard from "./pages/Dashboard";
import SubjectEditor from "./components/SubjectEditor";
import Onboarding from "./components/Onboarding";
import { AccountPanel } from "./components/AccountPanel";
import { LegacyImport } from "./components/HistoryImport";
import { syncLabel, useSync } from "./sync/SyncProvider";
import { Modal } from "./components/UI";
import { SessionList } from "./components/Sessions";
import { PwaUpdateNotice } from "./components/Pwa";
const Subjects = lazy(() =>
  import("./pages/Subjects").then((module) => ({ default: module.Subjects })),
);
const SubjectDetail = lazy(() =>
  import("./pages/Subjects").then((module) => ({
    default: module.SubjectDetail,
  })),
);
const Focus = lazy(() => import("./pages/Focus"));
const History = lazy(() => import("./pages/History"));
const Insights = lazy(() => import("./pages/Insights"));
const Settings = lazy(() => import("./pages/Settings"));
type Page = "Home" | "Subjects" | "Focus" | "History" | "Insights" | "Settings";
const links = [
  { name: "Home", icon: Home },
  { name: "Subjects", icon: BookOpen },
  { name: "Focus", icon: Timer },
  { name: "History", icon: HistoryIcon },
  { name: "Insights", icon: ChartNoAxesCombined },
  { name: "Settings", icon: SettingsIcon },
] as const;
export default function App() {
  const { data, now, act, busy, error, clearError } = useStride();
  const auth = useAuth();
  const sync = useSync();
  const syncStatus = syncLabel(sync.phase, sync.pending, sync.conflicts);
  const [accountOpen, setAccountOpen] = useState(false);
  const [page, setPage] = useState<Page>("Home");
  const [subject, setSubject] = useState<string>();
  const [focusSubject, setFocusSubject] = useState<string>();
  const [add, setAdd] = useState(false);
  const [day, setDay] = useState<string>();
  const [quick, setQuick] = useState(false);
  const [quickQuery, setQuickQuery] = useState("");
  useEffect(() => {
    if (!quick) setQuickQuery("");
  }, [quick]);
  const [collapsed, setCollapsed] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const today = dayKey(new Date(now));
  const timer = data.running;
  const notificationAttempt = useRef<string | null>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = data.settings.theme;
  }, [data.settings.theme]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setQuick((q) => !q);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (
      !timer ||
      timer.notified ||
      notificationAttempt.current === timer.id ||
      timer.mode !== "countdown" ||
      elapsed(timer, now) < timer.target ||
      busy
    )
      return;
    notificationAttempt.current = timer.id;
    void act(async () => {
      await saveRunning({
        ...timer,
        segments: activeSegments(timer, now),
        runningSince: null,
        notified: true,
      });
      if (data.settings.notifications) {
        try {
          await notifySessionComplete();
        } catch (e) {
          setNotificationError(String(e));
        }
      }
    });
  }, [timer, now, busy, data.settings.notifications]);
  function navigate(p: Page) {
    setPage(p);
    setSubject(undefined);
    setQuick(false);
  }
  function focus(id?: string) {
    setFocusSubject(id);
    navigate("Focus");
  }
  function openSubject(id: string) {
    setSubject(id);
    setPage("Subjects");
  }
  const daySessions = useMemo(() => {
    if (!day) return [];
    const ids = new Set(
      data.slices
        .filter((slice) => slice.day === day)
        .map((slice) => slice.session_id),
    );
    const activeSubjects = new Set(
      data.subjects.filter((item) => !item.archived).map((item) => item.id),
    );
    return data.sessions.filter(
      (session) =>
        ids.has(session.id) &&
        (subject
          ? session.subject_id === subject
          : activeSubjects.has(session.subject_id)),
    );
  }, [data.sessions, data.slices, data.subjects, day, subject]);
  const showAuthError = Boolean(
    auth.error && page !== "Settings" && !accountOpen,
  );
  return (
    <>
      <PwaUpdateNotice busy={busy} timer={!!data.running} />
      <LegacyImport />
      {!data.settings.onboarded ? (
        <Onboarding onAccount={() => setAccountOpen(true)} />
      ) : (
        <div
          className={`app ${collapsed ? "collapsed" : ""} ${page === "Focus" && timer ? "focused-layout" : ""}`}
        >
          <aside className="sidebar">
            <div className="brand">
              <span className="brand-mark">S</span>
              <strong>Stride</strong>
              <button
                className="icon-button sidebar-toggle"
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                onClick={() => setCollapsed(!collapsed)}
              >
                {collapsed ? (
                  <PanelLeftOpen size={17} />
                ) : (
                  <PanelLeftClose size={17} />
                )}
              </button>
            </div>
            <button
              className="search-button"
              aria-label="Quick actions"
              onClick={() => setQuick(true)}
            >
              <Search size={16} />
              <span>Search or command...</span>
              <kbd>Ctrl K</kbd>
            </button>

            <nav>
              {links.map(({ name, icon: Icon }) => (
                <button
                  title={name}
                  aria-current={page === name ? "page" : undefined}
                  key={name}
                  className={`nav-link ${page === name ? "active" : ""}`}
                  onClick={() => navigate(name)}
                >
                  <Icon size={18} />
                  <span>{name}</span>
                  {name === "Focus" && timer && <i className="status-dot" />}
                </button>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <div className="sidebar-inspiration">
                <Mountains />
                <blockquote>
                  “Small steps
                  <br />
                  compound into
                  <br />
                  extraordinary results.”
                </blockquote>
              </div>
              <button
                className="workspace-profile"
                onClick={() => navigate("Settings")}
                aria-label="Account and workspace settings"
              >
                <span className="profile-avatar">S</span>
                <span>
                  {auth.user?.email ?? "Account workspace"}
                  <small>{syncStatus}</small>
                </span>
              </button>
            </div>
          </aside>
          <main>
            <header className="topbar">
              {page === "Focus" && timer && (
                <button
                  className="subtle focus-exit"
                  onClick={() => navigate("Home")}
                >
                  ← Back to workspace
                </button>
              )}
              <span>
                {subject
                  ? data.subjects.find((s) => s.id === subject)?.name
                  : page === "Home"
                    ? "Home"
                    : page}
              </span>
              <button
                className="topbar-note sync-status"
                onClick={() => navigate("Settings")}
                aria-label={`Synchronization: ${syncStatus}`}
              >
                {timer ? "● Focus session in progress" : syncStatus}
              </button>
            </header>
            <div className="page-content" key={subject ?? page}>
              <Suspense
                fallback={<p role="status">Opening {page.toLowerCase()}…</p>}
              >
                {page === "Home" && (
                  <Dashboard
                    onAdd={() => setAdd(true)}
                    onSubject={openSubject}
                    onFocus={focus}
                    onDay={setDay}
                    onHistory={() => navigate("History")}
                  />
                )}{" "}
                {page === "Subjects" &&
                  (subject ? (
                    <SubjectDetail
                      id={subject}
                      onBack={() => setSubject(undefined)}
                      onFocus={focus}
                      onDay={setDay}
                    />
                  ) : (
                    <Subjects
                      onAdd={() => setAdd(true)}
                      onSubject={openSubject}
                    />
                  ))}
                {page === "Focus" && (
                  <Focus
                    initialSubject={focusSubject}
                    onAdd={() => setAdd(true)}
                  />
                )}{" "}
                {page === "History" && <History />}
                {page === "Insights" && <Insights />}
                {page === "Settings" && <Settings />}
              </Suspense>
              <footer className="page-footer">
                <span>STRIDE</span> Build consistency, one session at a time.
              </footer>
            </div>
          </main>
          {timer && page !== "Focus" && (
            <button
              className="floating-timer"
              onClick={() => focus(timer.subjectId)}
            >
              <span className="status-dot" />
              <Timer size={18} />
              {formatTime(elapsed(timer, now))} ·{" "}
              {timer.runningSince ? "In focus" : "Paused"}
              <ArrowUpRight size={18} />
            </button>
          )}
        </div>
      )}
      {accountOpen && (
        <Modal title="Account" onClose={() => setAccountOpen(false)}>
          <AccountPanel />
        </Modal>
      )}
      {(error || notificationError || showAuthError) && (
        <div className="error-toast" role="alert">
          <strong>
            {error
              ? "Could not save or load data"
              : showAuthError
                ? "Account connection issue"
                : "Notification unavailable"}
          </strong>
          <span>
            {error || (showAuthError ? auth.error : null) || notificationError}
          </span>
          <button
            aria-label="Dismiss error"
            className="icon-button"
            onClick={() => {
              clearError();
              auth.clearError();
              setNotificationError("");
            }}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {add && <SubjectEditor onClose={() => setAdd(false)} />}{" "}
      {day && (
        <Modal
          title={parseDay(day).toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
          onClose={() => setDay(undefined)}
        >
          <p>
            {formatTime(
              data.slices
                .filter(
                  (x) =>
                    x.day === day &&
                    daySessions.some((s) => s.id === x.session_id),
                )
                .reduce((n, x) => n + x.seconds, 0),
            )}{" "}
            studied on this day · {daySessions.length} sessions
          </p>
          <SessionList sessions={daySessions} />
        </Modal>
      )}
      {quick && (
        <Modal title="Where to next?" onClose={() => setQuick(false)}>
          <input
            autoFocus
            aria-label="Search commands and subjects"
            placeholder="Search commands or subjects..."
            value={quickQuery}
            onChange={(e) => setQuickQuery(e.target.value)}
          />
          <div className="quick-actions">
            {!quickQuery && (
              <>
                <button onClick={() => focus()}>
                  <Play size={18} />{" "}
                  {timer ? "Return to focus session" : "Start study session"}
                </button>
                <button
                  onClick={() => {
                    setQuick(false);
                    setAdd(true);
                  }}
                >
                  <Plus size={18} /> Add subject
                </button>
                <button
                  onClick={() => {
                    setQuick(false);
                    setSubject(undefined);
                    setDay(today);
                  }}
                >
                  <HistoryIcon size={18} /> View today’s activity
                </button>
              </>
            )}
            {links
              .filter(({ name }) =>
                name.toLowerCase().includes(quickQuery.toLowerCase()),
              )
              .map(({ name, icon: Icon }) => (
                <button key={name} onClick={() => navigate(name)}>
                  <Icon size={18} />
                  {name}
                </button>
              ))}
            {data.subjects
              .filter(
                (s) =>
                  !s.archived &&
                  s.name.toLowerCase().includes(quickQuery.toLowerCase()),
              )
              .map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    openSubject(s.id);
                    setQuick(false);
                  }}
                >
                  <BookOpen size={18} />
                  {s.name}
                </button>
              ))}
            {quickQuery &&
              !links.some(({ name }) =>
                name.toLowerCase().includes(quickQuery.toLowerCase()),
              ) &&
              !data.subjects.some(
                (s) =>
                  !s.archived &&
                  s.name.toLowerCase().includes(quickQuery.toLowerCase()),
              ) && <p className="hint">No matching commands or subjects.</p>}
          </div>
        </Modal>
      )}
    </>
  );
}
