import { useCallback, useEffect, useRef, useState } from 'react';
import { generateImage, generateSceneImage, type NCM } from '../api/client';

type Scene = NCM['chapters'][0]['scenes'][0];

export interface PopupPos {
  x: number;
  y: number;
  text: string;
}

export interface UseSceneImage {
  /**
   * Attach to the `.page-view` root. The hook owns this ref because the popup is
   * `position: absolute` inside that (inline `position: relative`) container, so
   * coordinates are container-relative, and the selection is scoped to the
   * container's `.scene-text`. The hook's signature is fixed at three args, so
   * returning the ref — rather than taking it as a fourth — is the wiring.
   */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Popup over the current text selection, or null when there is none. */
  popup: PopupPos | null;
  /** Image shown for this scene (on-demand or scene image); null = none. */
  image: string | null;
  clearImage: () => void;
  loading: boolean;
  error: string | null;
  /** On-demand image, from the popup's selected text. */
  pictureThis: () => Promise<void>;
  /** Scene image, from `scene.image_prompt` (D5). */
  pictureScene: () => Promise<void>;
  /** A scene image already exists; gates the "Picture scene" button. */
  hasSceneImage: boolean;
}

/**
 * Private helper: derive a popup position from the current DOM selection, scoped
 * to the container's `.scene-text`. Returns null when there is no usable
 * selection (too short, no range, or outside the scene text). Coordinates are
 * relative to the container, which the popup is absolutely positioned within.
 */
function computeSelectionPopup(container: HTMLElement): PopupPos | null {
  const sel = window.getSelection();
  const text = sel?.toString().trim() || '';

  if (text.length < 3) return null;

  const range = sel?.getRangeAt(0);
  if (!range) return null;

  const textEl = container.querySelector('.scene-text');
  if (!textEl || !textEl.contains(range.commonAncestorContainer)) return null;

  const rect = range.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  return {
    x: rect.left + rect.width / 2 - containerRect.left,
    y: rect.top - containerRect.top - 8,
    text,
  };
}

/**
 * Owns the entire scene-image flow: text-selection popup, on-demand image
 * (`pictureThis`, from selected text), and scene image (`pictureScene`, from
 * `scene.image_prompt` per D5). `PageView` consumes this and keeps only
 * paragraph layout plus the "Picture scene" confirm dialog.
 *
 * This hook does NOT self-reset on scene change: `ReaderPage` remounts
 * `PageView` per page via its keyed wrapper (`${chapterIdx}-${pageIdx}`), which
 * resets this `useState` for free. That per-page remount is load-bearing for the
 * forward-only paginated reader (D19).
 */
export function useSceneImage(
  bookId: string,
  chapterIndex: number,
  scene: Scene,
): UseSceneImage {
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [popup, setPopup] = useState<PopupPos | null>(null);
  const [hasSceneImage, setHasSceneImage] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const sceneImageUrl = `/api/data/books/${bookId}/images/scenes/ch${chapterIndex}_sc${scene.scene_index}.png`;
  const cachedOnDemandUrl = `/api/data/books/${bookId}/images/on_demand/ch${chapterIndex}_sc${scene.scene_index}.png`;

  // Preload any pre-generated scene/on-demand image for this scene. See the hook
  // doc comment for why state is not reset here (per-page remount, D19).
  useEffect(() => {
    const sceneImg = new window.Image();
    sceneImg.onload = () => setHasSceneImage(true);
    sceneImg.src = sceneImageUrl;

    const img = new window.Image();
    img.onload = () => setImage(cachedOnDemandUrl);
    img.src = cachedOnDemandUrl;
  }, [cachedOnDemandUrl, sceneImageUrl]);

  useEffect(() => {
    function handleMouseUp() {
      requestAnimationFrame(() => {
        const container = containerRef.current;
        if (!container) {
          setPopup(null);
          return;
        }
        setPopup(computeSelectionPopup(container));
      });
    }

    function handleMouseDown(e: MouseEvent) {
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

  const clearImage = useCallback(() => setImage(null), []);

  const pictureThis = useCallback(async () => {
    if (!popup) return;
    const selectedText = popup.text;
    setPopup(null);

    setLoading(true);
    setError(null);
    try {
      const result = await generateImage(bookId, selectedText, chapterIndex, scene.scene_index);
      if (result.cache_url) {
        setImage(`${result.cache_url}?t=${Date.now()}`);
      } else {
        setImage(`data:${result.content_type};base64,${result.image_base64}`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [popup, bookId, chapterIndex, scene.scene_index]);

  const pictureScene = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await generateSceneImage(bookId, chapterIndex, scene.scene_index);
      setHasSceneImage(true);
      if (result.cache_url) {
        setImage(`${result.cache_url}?t=${Date.now()}`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [bookId, chapterIndex, scene.scene_index]);

  return {
    containerRef,
    popup,
    image,
    clearImage,
    loading,
    error,
    pictureThis,
    pictureScene,
    hasSceneImage,
  };
}
