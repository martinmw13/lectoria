import { useState, useEffect } from 'react';
import { getSceneTrack, type DetailedMatch, type NCM } from '../api/client';

type Scene = NCM['chapters'][0]['scenes'][0];
type ChapterAnalysis = NCM['chapters'][0];

interface Props {
  scene: Scene;
  chapter: ChapterAnalysis;
  bookId: string;
  onClose?: () => void;
}

export default function DevPanel({ scene, chapter, bookId, onClose }: Props) {
  const [musicMatch, setMusicMatch] = useState<DetailedMatch | null>(null);
  const [musicError, setMusicError] = useState('');

  useEffect(() => {
    setMusicMatch(null);
    setMusicError('');

    getSceneTrack(bookId, chapter.chapter_index, scene.scene_index, undefined, true)
      .then((data) => setMusicMatch(data as DetailedMatch))
      .catch((e) => setMusicError(String(e)));
  }, [bookId, chapter.chapter_index, scene.scene_index]);

  const coercions = [
    scene.raw_emotion && { field: 'emotion', from: scene.raw_emotion, to: scene.emotion },
    scene.raw_pacing && { field: 'pacing', from: scene.raw_pacing, to: scene.pacing },
    scene.raw_scene_type && { field: 'scene_type', from: scene.raw_scene_type, to: scene.scene_type },
    scene.raw_transition_type && { field: 'transition_type', from: scene.raw_transition_type, to: scene.transition_type },
  ].filter(Boolean) as { field: string; from: string; to: string }[];

  return (
    <aside className="dev-panel">
      <div className="dev-panel-header">
        <h3>Developer View</h3>
        {onClose && (
          <button className="dev-panel-close" onClick={onClose} title="Close (Ctrl+D)">
            &times;
          </button>
        )}
      </div>

      {/* Scene attributes */}
      <section className="dev-section">
        <h4>Scene {scene.scene_index}: {scene.title}</h4>
        <table className="dev-table">
          <tbody>
            <tr><td>Paragraphs</td><td>{scene.start_paragraph} - {scene.end_paragraph}</td></tr>
            <tr><td>Emotion</td><td>{scene.emotion}</td></tr>
            <tr><td>Pacing</td><td>{scene.pacing}</td></tr>
            <tr><td>Scene type</td><td>{scene.scene_type}</td></tr>
            <tr><td>Transition</td><td>{scene.transition_type}</td></tr>
            <tr><td>Characters</td><td>{scene.characters_present.join(', ') || '(none)'}</td></tr>
            <tr><td>Location</td><td>{scene.setting.location || '(unspecified)'}</td></tr>
            <tr><td>Time of day</td><td>{scene.setting.time_of_day || '(unknown)'}</td></tr>
          </tbody>
        </table>
      </section>

      {/* Coercions */}
      {coercions.length > 0 && (
        <section className="dev-section">
          <h4>Coerced Values</h4>
          <table className="dev-table coercion-table">
            <thead>
              <tr><th>Field</th><th>LLM said</th><th>Mapped to</th></tr>
            </thead>
            <tbody>
              {coercions.map((c) => (
                <tr key={c.field}>
                  <td>{c.field}</td>
                  <td className="raw-value">{c.from}</td>
                  <td>{c.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Chapter metadata */}
      <section className="dev-section">
        <h4>Chapter Analysis Metadata</h4>
        <table className="dev-table">
          <tbody>
            <tr><td>LLM model</td><td>{chapter.llm_model || '(unknown)'}</td></tr>
            <tr><td>Attempts</td><td>{chapter.attempt_count}</td></tr>
            <tr><td>Fallback</td><td>{chapter.is_fallback ? 'Yes' : 'No'}</td></tr>
            <tr><td>Total scenes</td><td>{chapter.scenes.length}</td></tr>
          </tbody>
        </table>
      </section>

      {/* Music matching */}
      <section className="dev-section">
        <h4>Music Match</h4>
        {musicError && <div className="dev-error">{musicError}</div>}
        {musicMatch && (
          <>
            <table className="dev-table">
              <tbody>
                <tr><td>Selected</td><td>{musicMatch.selected_track}</td></tr>
                <tr><td>Score</td><td>{musicMatch.score.toFixed(3)}</td></tr>
                <tr>
                  <td>Fallback</td>
                  <td>{musicMatch.fallback !== 'none' ? `Yes (${musicMatch.fallback})` : 'No'}</td>
                </tr>
                {musicMatch.style_applied && (
                  <tr><td>Style</td><td>{musicMatch.style_applied}</td></tr>
                )}
              </tbody>
            </table>
            {musicMatch.candidates.length > 0 && (
              <>
                <h5>Top Candidates</h5>
                <table className="dev-table candidates-table">
                  <thead>
                    <tr><th>Track</th><th>Score</th><th>Tags</th></tr>
                  </thead>
                  <tbody>
                    {musicMatch.candidates.map((c) => (
                      <tr
                        key={c.track_id}
                        className={c.track_id === musicMatch.selected_track ? 'selected' : ''}
                      >
                        <td>{c.track_id}</td>
                        <td>{c.score.toFixed(3)}</td>
                        <td>{c.tags.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
        {!musicMatch && !musicError && <p>Loading...</p>}
      </section>

      {/* Image prompt */}
      <section className="dev-section">
        <h4>Image Prompt</h4>
        <pre className="dev-pre">{scene.image_prompt || '(none)'}</pre>
      </section>

      {/* Key phrases / objects */}
      {(scene.key_phrases.length > 0 || scene.key_objects.length > 0) && (
        <section className="dev-section">
          {scene.key_phrases.length > 0 && (
            <>
              <h4>Key Phrases</h4>
              <ul className="dev-list">
                {scene.key_phrases.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </>
          )}
          {scene.key_objects.length > 0 && (
            <>
              <h4>Key Objects</h4>
              <ul className="dev-list">
                {scene.key_objects.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            </>
          )}
        </section>
      )}
    </aside>
  );
}
