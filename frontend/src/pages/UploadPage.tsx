import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { hasLlmKey } from '../api/byok';
import { uploadBook, listBooks, type BookSummary, type CostEstimate } from '../api/client';
import { useBookProcessing } from '../hooks/useBookProcessing';

export default function UploadPage() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const { status, progress, error: processingError, finalBookId, start, reset } =
    useBookProcessing();

  const [books, setBooks] = useState<BookSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [error, setError] = useState(''); // client-side validation / upload errors
  const [maxChapters, setMaxChapters] = useState<number>(5);

  const processing = status === 'running';

  // The 409 "already processed" arrives as a pre-stream HTTP error carrying a
  // status (replaces the old err.includes('409')). Derived from the error, so it
  // clears automatically whenever the error does — via start() or reset() — which
  // is what keeps the dialog from rendering alongside the progress panel.
  const confirmOverwrite = processingError?.kind === 'http' && processingError.status === 409;

  // Route to the reader on completion — from the page, while mounted, so an
  // aborted/unmounted stream can never force-redirect (the #64 regression).
  useEffect(() => {
    if (status === 'done' && finalBookId) navigate(`/reader/${finalBookId}`);
  }, [status, finalBookId, navigate]);

  async function loadBooks() {
    if (loaded) return;
    try {
      const b = await listBooks();
      setBooks(b);
    } catch { /* ignore */ }
    setLoaded(true);
  }

  if (!loaded) loadBooks();

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setError('');
    setEstimate(null);
    reset(); // clear any prior run's processing state (incl. a stale 409 dialog)
    try {
      const est = await uploadBook(file);
      setEstimate(est);
    } catch (e) {
      setError(String(e));
    }
  }

  function startProcessing(force: boolean) {
    if (!estimate) return;

    if (!hasLlmKey()) {
      setError('No LLM API key configured. Go to Settings to enter your API key before processing.');
      return;
    }

    // Clear the local validation error; start() resets the hook's state
    // (progress/error/status), which also clears the derived overwrite dialog,
    // so Reprocess transitions cleanly into the progress panel.
    setError('');

    start(estimate.book_id, {
      maxChapters: maxChapters > 0 ? maxChapters : undefined,
      force,
    });
  }

  function handleProcess() {
    startProcessing(false);
  }

  function handleForceProcess() {
    startProcessing(true);
  }

  // Show validation/upload errors, else the processing error — but not the 409
  // overwrite case, which drives the dialog above rather than an error banner.
  const displayError = error
    ? error
    : processingError && !(processingError.kind === 'http' && processingError.status === 409)
      ? processingError.message
      : null;

  return (
    <div className="page upload-page">
      <h1>Lectoria</h1>
      <p className="subtitle">Multimodal EPUB Reader</p>

      <section className="upload-section">
        <h2>Upload a Book</h2>
        <div className="upload-controls">
          <input ref={fileRef} type="file" accept=".epub" />
          <button onClick={handleUpload} disabled={processing}>
            Analyze
          </button>
        </div>

        {displayError && (
          <div className="error-msg">
            {displayError}
            {displayError.includes('Settings') && (
              <button
                className="inline-link"
                onClick={() => navigate('/settings')}
                style={{ marginLeft: '0.5rem' }}
              >
                Open Settings
              </button>
            )}
          </div>
        )}

        {confirmOverwrite && (
          <div className="confirm-overwrite">
            <p>This book has already been processed. Reprocessing will overwrite the existing analysis.</p>
            <div className="confirm-actions">
              <button className="primary" onClick={handleForceProcess}>
                Reprocess
              </button>
              <button onClick={() => {
                if (estimate) navigate(`/reader/${estimate.book_id}`);
              }}>
                Read existing
              </button>
            </div>
          </div>
        )}

        {estimate && !processing && !confirmOverwrite && (
          <div className="estimate-card">
            <h3>Cost Estimate</h3>
            <p>{estimate.message}</p>
            <table>
              <tbody>
                <tr><td>Chapters (narrative)</td><td>{estimate.narrative_chapters}</td></tr>
                <tr><td>Total paragraphs</td><td>{estimate.total_paragraphs.toLocaleString()}</td></tr>
                <tr><td>Estimated tokens</td><td>{estimate.estimated_tokens.toLocaleString()}</td></tr>
              </tbody>
            </table>
            <div className="setting-row" style={{ marginTop: '0.75rem' }}>
              <label>Max chapters</label>
              <input
                type="number"
                min={0}
                max={estimate.narrative_chapters}
                value={maxChapters}
                onChange={(e) => setMaxChapters(Number(e.target.value))}
                style={{ width: '80px' }}
              />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {maxChapters > 0
                  ? `Process first ${maxChapters} chapters`
                  : 'Process all chapters'}
              </span>
            </div>
            <button className="primary" onClick={handleProcess}>
              Process Book
            </button>
          </div>
        )}

        {processing && (
          <div className="progress-panel">
            <h3>Processing...</h3>
            <div className="progress-log">
              {progress.map((msg, i) => (
                <div key={i} className="progress-line">{msg}</div>
              ))}
            </div>
          </div>
        )}
      </section>

      {books.length > 0 && (
        <section className="books-section">
          <h2>Your Books</h2>
          <div className="book-grid">
            {books.map((book) => (
              <div
                key={book.book_id}
                className={`book-card ${book.has_ncm ? 'ready' : 'pending'}`}
                onClick={() => book.has_ncm && navigate(`/reader/${book.book_id}`)}
              >
                <h3>{book.title}</h3>
                <span className="status">
                  {book.has_ncm ? 'Ready to read' : 'Not processed'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
