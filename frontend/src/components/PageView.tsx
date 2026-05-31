import { useState } from 'react';
import type { NCM } from '../api/client';
import { useSceneImage } from '../hooks/useSceneImage';
import type { Page, Paragraph } from '../utils/paginate';

type Character = NCM['book_map']['characters'][0];
type ChapterAnalysis = NCM['chapters'][0];

interface Props {
  page: Page;
  bookId: string;
  chapterIndex: number;
  characters: Character[];
  devMode: boolean;
  chapterAnalysis: ChapterAnalysis;
}

export default function PageView({
  page,
  bookId,
  chapterIndex,
  devMode,
}: Props) {
  const { scene, paragraphs, isFirstPage, isLastPage } = page;

  const {
    containerRef,
    popup,
    image,
    clearImage,
    loading,
    error,
    pictureThis,
    pictureScene,
    hasSceneImage,
  } = useSceneImage(bookId, chapterIndex, scene);
  const [confirmPictureScene, setConfirmPictureScene] = useState(false);

  const sceneImageUrl = `/api/data/books/${bookId}/images/scenes/ch${chapterIndex}_sc${scene.scene_index}.png`;

  return (
    <div ref={containerRef} className="page-view" style={{ position: 'relative' }}>
      {isFirstPage && (
        <div className="scene-header">
          <span className="scene-title">{scene.title}</span>
          <div className="scene-header-right">
            {loading && <span className="image-loading-indicator">Generating...</span>}
            {scene.image_prompt && !hasSceneImage && !loading && (
              <button
                className="picture-scene-btn"
                onClick={() => setConfirmPictureScene(true)}
                title="Generate an image for this scene"
              >
                Picture scene
              </button>
            )}
            <span className="scene-emotion" data-emotion={scene.emotion}>
              {scene.emotion}
            </span>
          </div>
        </div>
      )}

      {confirmPictureScene && (
        <div className="confirm-picture-scene">
          <p>Generate an image for this scene? This will call the image generation API.</p>
          <div className="confirm-actions">
            <button
              className="primary"
              onClick={() => {
                setConfirmPictureScene(false);
                pictureScene();
              }}
            >
              Generate
            </button>
            <button onClick={() => setConfirmPictureScene(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="scene-text">
        {paragraphs.length > 0 ? (
          paragraphs.map((p: Paragraph) => (
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

      {popup && !loading && (
        <div
          className="picture-this-popup"
          style={{ left: `${popup.x}px`, top: `${popup.y}px` }}
        >
          <button onClick={pictureThis}>Picture this</button>
        </div>
      )}

      {image && (
        <div className="scene-generated-image">
          <img src={image} alt="Generated from selected text" />
          <button className="close-img" onClick={clearImage}>x</button>
        </div>
      )}
      {error && <div className="error-msg" style={{ fontSize: '0.8rem' }}>{error}</div>}

      {isLastPage && (
        <img
          src={sceneImageUrl}
          alt=""
          className="scene-auto-image"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          onLoad={(e) => { (e.target as HTMLImageElement).style.display = 'block'; }}
          style={{ display: 'none' }}
        />
      )}

      {devMode && isLastPage && (
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
