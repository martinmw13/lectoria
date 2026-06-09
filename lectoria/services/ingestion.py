"""EPUB ingestion service — extract structured text from EPUB documents.

Produces ChaptersData: a list of chapters, each with numbered paragraphs
and a narrative/non-narrative flag. This output feeds into the LLM pipeline.
"""

import logging
import re
import warnings
from pathlib import Path

import ebooklib
from bs4 import BeautifulSoup, Tag, XMLParsedAsHTMLWarning
from ebooklib import epub

warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

from lectoria.models.ncm import Chapter, ChaptersData, Paragraph

logger = logging.getLogger(__name__)

# Heuristics for non-narrative chapters (matched against lowercased title)
_NON_NARRATIVE_PATTERNS = [
    r"^table of contents$",
    r"^contents$",
    r"^copyright",
    r"^title page$",
    r"^cover$",
    r"^dedication$",
    r"^acknowledgement",
    r"^about the author",
    r"^also by",
    r"^epigraph$",
    r"^appendix",
    r"^glossary$",
    r"^index$",
    r"^notes$",
    r"^bibliography$",
    r"^colophon$",
    r"^foreword",
    r"^preface$",
    r"project gutenberg",
    r"^license$",
]
_NON_NARRATIVE_RE = [re.compile(p, re.IGNORECASE) for p in _NON_NARRATIVE_PATTERNS]

# Minimum paragraph length (chars) to keep — filters out artifacts
_MIN_PARAGRAPH_LENGTH = 10

# Maximum paragraph count to consider a chapter "non-narrative" when title is ambiguous
_SPARSE_CHAPTER_THRESHOLD = 3


def _is_non_narrative_title(title: str) -> bool:
    title_stripped = title.strip()
    return any(pat.search(title_stripped) for pat in _NON_NARRATIVE_RE)


def _extract_text_paragraphs(soup: BeautifulSoup) -> list[str]:
    """Extract paragraph texts from HTML, stripping tags and normalizing whitespace."""
    body = soup.find("body")
    if body is None:
        body = soup

    paragraphs: list[str] = []
    for element in body.find_all(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6"]):
        if not isinstance(element, Tag):
            continue
        text = element.get_text(separator=" ", strip=True)
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) >= _MIN_PARAGRAPH_LENGTH:
            paragraphs.append(text)

    return paragraphs


def _extract_chapter_title(soup: BeautifulSoup) -> str:
    """Try to extract a chapter title from the first heading in the HTML."""
    for tag_name in ["h1", "h2", "h3"]:
        heading = soup.find(tag_name)
        if heading:
            return heading.get_text(strip=True)
    return ""


def ingest_epub(epub_path: Path) -> ChaptersData:
    """Parse an EPUB file and produce structured chapter/paragraph data.

    Args:
        epub_path: Path to the .epub file.

    Returns:
        ChaptersData with chapters containing numbered paragraphs.
    """
    book = epub.read_epub(str(epub_path), options={"ignore_ncx": True})

    chapters: list[Chapter] = []
    chapter_index = 0

    spine_ids = [item_id for item_id, _ in book.spine]
    spine_items: list[epub.EpubItem] = []
    for item_id in spine_ids:
        item = book.get_item_with_id(item_id)
        if item is not None:
            spine_items.append(item)

    for item in spine_items:
        if item.get_type() != ebooklib.ITEM_DOCUMENT:
            continue

        # Parse the chapter HTML once; both extractors read from the same soup.
        soup = BeautifulSoup(item.get_content(), "lxml")
        paragraphs_text = _extract_text_paragraphs(soup)

        if not paragraphs_text:
            continue

        title = _extract_chapter_title(soup)
        chapter_index += 1

        is_narrative = True
        if title and _is_non_narrative_title(title):
            is_narrative = False
        elif len(paragraphs_text) <= _SPARSE_CHAPTER_THRESHOLD and not title:
            is_narrative = False

        numbered_paragraphs = [
            Paragraph(index=i + 1, text=text) for i, text in enumerate(paragraphs_text)
        ]

        chapters.append(
            Chapter(
                chapter_index=chapter_index,
                title=title,
                paragraphs=numbered_paragraphs,
                is_narrative=is_narrative,
            )
        )

    logger.info(
        "Ingested %d chapters (%d narrative) from %s",
        len(chapters),
        sum(1 for c in chapters if c.is_narrative),
        epub_path.name,
    )
    return ChaptersData(chapters=chapters)
