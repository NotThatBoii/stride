import { useState } from "react";
import { ArrowRight, Check, Plus } from "lucide-react";
import { useStride } from "../state";
import { saveSettings, saveSubject } from "../lib/storage";
export default function Onboarding({ onAccount }: { onAccount: () => void }) {
  const { data, act, busy } = useStride();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [minimum, setMinimum] = useState(20);
  return (
    <div className="onboarding">
      <div className="onboarding-brand">
        <span className="brand-mark">s</span> stride
        <span className="eyebrow">STRIDE / GET STARTED</span>
        <button className="subtle onboarding-account" onClick={onAccount}>
          Account
        </button>
      </div>
      <div className="onboarding-content">
        <div className="step-dots">
          {[0, 1, 2].map((i) => (
            <i className={i <= step ? "selected" : ""} key={i} />
          ))}
        </div>
        {step === 0 ? (
          <>
            <span className="eyebrow">LOCAL-FIRST STUDY TRACKING</span>
            <h1>
              Welcome to Stride.
              <br />
              Your study workspace.
            </h1>
            <p>
              Turn your study sessions into a picture of progress.
              <br />
              One subject, one session, one square at a time.
            </p>
            <button className="large" onClick={() => setStep(1)}>
              Find your stride <ArrowRight size={17} />
            </button>
            <small>Local by default. No account needed.</small>
          </>
        ) : step === 1 ? (
          <>
            <span className="eyebrow">01 / YOUR SUBJECTS</span>
            <h1>What are you learning?</h1>
            <p>Add a few subjects. You can always change them later.</p>
            <form
              className="onboarding-add"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await act(() =>
                    saveSubject({
                      id: crypto.randomUUID(),
                      name: name.trim(),
                      description: "",
                      icon: "book",
                      color: ["#8b91e8", "#ca9472", "#b49cd5", "#c7ad66"][
                        data.subjects.length % 4
                      ],
                      created_at: new Date().toISOString(),
                      archived: 0,
                    }),
                  )
                )
                  setName("");
              }}
            >
              <input
                required
                autoFocus
                aria-label="Subject name"
                maxLength={80}
                placeholder="e.g. Java Programming"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button disabled={busy || !name.trim()} aria-label="Add subject">
                <Plus size={19} />
              </button>
            </form>
            <div className="onboarding-subjects">
              {data.subjects.map((s) => (
                <span className="pill" key={s.id}>
                  <i className="subject-dot" style={{ background: s.color }} />
                  {s.name}
                  <Check size={13} />
                </span>
              ))}
            </div>
            <button className="large" onClick={() => setStep(2)}>
              Continue <ArrowRight size={17} />
            </button>
            <button className="subtle" onClick={() => setStep(0)}>
              Back
            </button>
          </>
        ) : (
          <>
            <span className="eyebrow">02 / YOUR MINIMUM DAY</span>
            <h1>Consistency starts small.</h1>
            <p>
              How many minutes make a meaningful day?
              <br />
              Reach this minimum to keep your streak going.
            </p>
            <label className="minimum-input">
              <input
                aria-label="Minimum Day minutes"
                type="number"
                min={1}
                max={1440}
                value={minimum}
                onChange={(e) => setMinimum(Number(e.target.value))}
              />
              <span>minutes a day</span>
            </label>
            <p className="hint">
              Miss a day? Start fresh. Your progress stays with you.
            </p>
            <button
              className="large"
              disabled={busy || minimum < 1 || minimum > 1440}
              onClick={() =>
                void act(() =>
                  saveSettings({ ...data.settings, minimum, onboarded: true }),
                )
              }
            >
              Let’s begin <ArrowRight size={17} />
            </button>
            <button className="subtle" onClick={() => setStep(1)}>
              Back
            </button>
          </>
        )}
      </div>
      <footer>Build consistency, one session at a time.</footer>
    </div>
  );
}
