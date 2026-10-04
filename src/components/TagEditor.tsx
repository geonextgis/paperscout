import { useState, type FormEvent } from 'react';

interface Props {
  label: string;
  values: string[];
  onAdd(value: string): void;
  onRemove(value: string): void;
  placeholder: string;
  suggestions?: string[];
  suggestionsLabel?: string;
}

/** Chips + free-text input + one-click suggestions. Used for topics and authors. */
export function TagEditor({ label, values, onAdd, onRemove, placeholder, suggestions = [], suggestionsLabel = 'Suggestions' }: Props) {
  const [draft, setDraft] = useState('');
  const have = new Set(values.map((v) => v.toLowerCase()));
  const open = suggestions.filter((s) => !have.has(s.toLowerCase()));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Allow pasting several at once: "crop modelling, remote sensing; yield"
    draft.split(/[,;\n]/).forEach(onAdd);
    setDraft('');
  };

  return (
    <div className="editor">
      {values.length > 0 && (
        <div className="chips" aria-label={label}>
          {values.map((v) => (
            <span key={v} className="chip chip-on">
              {v}
              <button className="chip-x" onClick={() => onRemove(v)} aria-label={`Remove ${v}`}>×</button>
            </span>
          ))}
        </div>
      )}
      <form className="input-row" onSubmit={submit}>
        <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} aria-label={label} />
        <button className="btn" type="submit" disabled={!draft.trim()}>Add</button>
      </form>
      {open.length > 0 && (
        <div className="suggestions">
          <span className="muted">{suggestionsLabel}:</span>
          {open.map((s) => (
            <button key={s} className="chip chip-toggle" onClick={() => onAdd(s)}>+ {s}</button>
          ))}
        </div>
      )}
    </div>
  );
}
