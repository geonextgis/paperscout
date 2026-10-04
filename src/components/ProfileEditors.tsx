import { useLibrary } from '../store/LibraryContext';
import { useProfile } from '../store/ProfileContext';
import { TagEditor } from './TagEditor';

const SUGGESTED_TOPICS = [
  'crop modelling', 'remote sensing', 'differentiable models', 'agricultural foundation models',
  'crop classification', 'yield forecasting', 'AI agents', 'process-based modelling',
];

export function TopicEditor() {
  const { profile, addTopic, removeTopic } = useProfile();
  const { meta } = useLibrary();
  // Topics the pipeline actively queries are the ones guaranteed to have papers.
  const suggestions = [...new Set([...(meta?.topics ?? []), ...SUGGESTED_TOPICS])];
  return (
    <TagEditor
      label="Research topics" values={profile.topics} onAdd={addTopic} onRemove={removeTopic}
      placeholder="e.g. data assimilation, phenology, soil moisture…" suggestions={suggestions} suggestionsLabel="Suggested"
    />
  );
}

export function AuthorEditor() {
  const { profile, addAuthor, removeAuthor } = useProfile();
  return (
    <TagEditor
      label="Followed authors" values={profile.authors} onAdd={addAuthor} onRemove={removeAuthor}
      placeholder="e.g. Jane Doe  (given name first, or “Doe, Jane”)"
    />
  );
}
