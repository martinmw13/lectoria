import type { Paragraph, Scene } from '../api/types';

// Paragraphs flow in from ChaptersData.chapters[].paragraphs (schema `Paragraph`);
// re-export the projected type so page consumers keep their single import surface.
export type { Paragraph };

export interface Page {
  sceneIdx: number;
  scene: Scene;
  paragraphs: Paragraph[];
  isFirstPage: boolean;
  isLastPage: boolean;
  pageInScene: number;
  totalPagesInScene: number;
}

const MAX_WORDS_PER_PAGE = 250;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function paginateScene(
  sceneIdx: number,
  scene: Scene,
  allParagraphs: Paragraph[],
): Page[] {
  const sceneParagraphs = allParagraphs.filter(
    (p) => p.index >= scene.start_paragraph && p.index <= scene.end_paragraph,
  );

  if (sceneParagraphs.length === 0) {
    return [{
      sceneIdx,
      scene,
      paragraphs: [],
      isFirstPage: true,
      isLastPage: true,
      pageInScene: 0,
      totalPagesInScene: 1,
    }];
  }

  const pages: Paragraph[][] = [];
  let current: Paragraph[] = [];
  let currentWords = 0;

  for (const para of sceneParagraphs) {
    const pw = wordCount(para.text);

    // If adding this paragraph exceeds limit and page isn't empty, start a new page
    if (current.length > 0 && currentWords + pw > MAX_WORDS_PER_PAGE) {
      pages.push(current);
      current = [para];
      currentWords = pw;
    } else {
      current.push(para);
      currentWords += pw;
    }
  }

  if (current.length > 0) {
    pages.push(current);
  }

  return pages.map((paras, i) => ({
    sceneIdx,
    scene,
    paragraphs: paras,
    isFirstPage: i === 0,
    isLastPage: i === pages.length - 1,
    pageInScene: i,
    totalPagesInScene: pages.length,
  }));
}

export function paginateChapter(
  scenes: Scene[],
  allParagraphs: Paragraph[],
): Page[] {
  return scenes.flatMap((scene, i) => paginateScene(i, scene, allParagraphs));
}
