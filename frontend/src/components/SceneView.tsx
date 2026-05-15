import { useState, useCallback, useEffect, useRef } from 'react';
import { generateImage, type NCM } from '../api/client';

type Scene = NCM['chapters'][0]['scenes'][0];
type Character = NCM['book_map']['characters'][0];
type ChapterAnalysis = NCM['chapters'][0];

interface Paragraph {
  index: number;
  text: string;
}

interface Props {
  scene: Scene;
  paragraphs: Paragraph[];
  isActive: boolean;
  bookId: string;
  chapterIndex: number;
  characters: Character[];
  devMode: boolean;
  chapterAnalysis: ChapterAnalysis;
}

interface PopupPos {
  x: number;
  y: number;
  text: string;
}

export default function SceneView({
  scene,
  paragraphs,
  isActive,
  bookId,
  chapterIndex,
  devMode,
}: Props) {
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState('');
  const [popup, setPopup] = useState<PopupPos | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const sceneImageUrl = `/api/data/books/${bookId}/images/scenes/ch${chapterIndex}_sc${scene.scene_index}.png`;

  useEffect(() => {
    function handleMouseUp() {
      // Small delay so the selection is finalized
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim() || '';

        if (text.length < 3 || !containerRef.current) {
          setPopup(null);
          return;
        }

        // Only show if selection is within this scene's text area
        const range = sel?.getRangeAt(0);
        if (!range) { setPopup(null); return; }

        const textEl = containerRef.current.querySelector('.scene-text');
        if (!textEl || !textEl.contains(range.commonAncestorContainer)) {
          setPopup(null);
          return;
        }

        const rect = range.getBoundingClientRect();
        const containerRect = containerRef.current.getBoundingClientRect();

        setPopup({
          x: rect.left + rect.width / 2 - containerRect.left,
          y: rect.top - containerRect.top - 8,
          text,
        });
      });
    }

    function handleMouseDown(e: MouseEvent) {
      // Dismiss popup if clicking outside it
      const target = e.target as HTMLElement;
      if (!target.closest('.picture-this-popup')) {
        setPopup(null);
      }
    }

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  const handlePictureThis = useCallback(async () => {
    if (!popup) return;
    const selectedText = popup.text;
    setPopup(null);

    setImageLoading(true);
    setImageError('');
    try {
      const result = await generateImage(bookId, selectedText, chapterIndex, scene.scene_index);
      setGeneratedImage(`data:${result.content_type};base64,${result.image_base64}`);
    } catch (e) {
      setImageError(String(e));
    } finally {
      setImageLoading(false);
    }
  }, [popup, bookId, chapterIndex, scene.scene_index]);

  return (
    <div
      ref={containerRef}
      className={`scene-view ${isActive ? 'active' : 'revealed'}`}
      style={{ position: 'relative' }}
    >
      <div className="scene-header">
        <span className="scene-title">{scene.title}</span>
        <div className="scene-header-right">
          {imageLoading && <span className="image-loading-indicator">Generating...</span>}
          <span className="scene-emotion" data-emotion={scene.emotion}>
            {scene.emotion}
          </span>
        </div>
      </div>

      <div className="scene-text">
        {paragraphs.length > 0 ? (
          paragraphs.map((p) => (
            <p key={p.index} className="paragraph">
              {p.text}
            </p>
          ))
        ) : (
          <p className="scene-placeholder">
            [Paragraphs {scene.start_paragraph}&#8211;{scene.end_paragraph}]
          </p>
        )}
      </div>

      {/* Floating "Picture this" popup */}
      {popup && !imageLoading && (
        <div
          className="picture-this-popup"
          style={{
            left: `${popup.x}px`,
            top: `${popup.y}px`,
          }}
        >
          <button onClick={handlePictureThis}>Picture this</button>
        </div>
      )}

      {generatedImage && (
        <div className="scene-generated-image">
          <img src={generatedImage} alt="Generated from selected text" />
          <button className="close-img" onClick={() => setGeneratedImage(null)}>x</button>
        </div>
      )}
      {imageError && <div className="error-msg" style={{ fontSize: '0.8rem' }}>{imageError}</div>}

      <img
        src={sceneImageUrl}
        alt=""
        className="scene-auto-image"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        onLoad={(e) => { (e.target as HTMLImageElement).style.display = 'block'; }}
        style={{ display: 'none' }}
      />

      {devMode && (
        <div className="scene-dev-inline">
          <span>p{scene.start_paragraph}-{scene.end_paragraph}</span>
          <span>type={scene.scene_type}</span>
          <span>pacing={scene.pacing}</span>
          <span>transition={scene.transition_type}</span>
          {scene.raw_emotion && (
            <span className="coerced">
              emotion: {scene.raw_emotion} &rarr; {scene.emotion}
            </span>
          )}
          {scene.raw_scene_type && (
            <span className="coerced">
              type: {scene.raw_scene_type} &rarr; {scene.scene_type}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
