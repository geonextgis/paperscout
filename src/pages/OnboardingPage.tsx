import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExamplePaperPicker } from '../components/ExamplePaperPicker';
import { JournalPicker } from '../components/JournalPicker';
import { AuthorEditor, TopicEditor } from '../components/ProfileEditors';
import { useProfile } from '../store/ProfileContext';

const STEPS = [
  {
    title: 'What do you work on?',
    help: 'Pick suggested topics or type your own. These are matched against titles, keywords and abstracts of new papers.',
    body: <TopicEditor />,
  },
  {
    title: 'Which journals do you read?',
    help: 'Papers in followed journals rank higher and get their own feed. Search for any journal — it does not have to be in the list.',
    body: <JournalPicker />,
  },
  {
    title: 'Show us papers you like',
    help: 'Optional but powerful: add a few papers that represent your interests (paste a DOI or search by title). New papers similar to them rank higher.',
    body: <ExamplePaperPicker />,
  },
  {
    title: 'Any authors to follow?',
    help: 'Optional. New papers by these authors are boosted and flagged.',
    body: <AuthorEditor />,
  },
];

export function OnboardingPage() {
  const { profile, update } = useProfile();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;

  const finish = () => {
    update((p) => ({ ...p, onboarded: true }));
    navigate('/');
  };

  return (
    <div className="onboarding">
      <p className="eyebrow">Welcome to PaperScout</p>
      <h1>{STEPS[step].title}</h1>
      <p className="muted">{STEPS[step].help}</p>

      <ol className="steps" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s.title} className={i === step ? 'step step-current' : i < step ? 'step step-done' : 'step'}>
            <button onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined} aria-label={`Step ${i + 1}: ${s.title}`} />
          </li>
        ))}
      </ol>

      <section className="panel">{STEPS[step].body}</section>

      <div className="action-row onboarding-actions">
        {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>Back</button>}
        <span className="spacer" />
        <button className="btn btn-ghost" onClick={finish}>{profile.topics.length || profile.journals.length ? 'Finish now' : 'Skip for now'}</button>
        <button className="btn btn-primary" onClick={() => (last ? finish() : setStep(step + 1))}>{last ? 'Show my papers' : 'Continue'}</button>
      </div>
    </div>
  );
}
