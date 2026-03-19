"""Generate a benchmark EPUB for testing the Lectoria pipeline.

The story is structured so each scene has a clearly dominant emotion,
long enough paragraphs for the LLM to assign cleanly, and covers all
9 emotions across 3 chapters.

Usage:
    uv run python scripts/create_benchmark_epub.py
    uv run python scripts/create_benchmark_epub.py --output my_test.epub
"""

import argparse
from pathlib import Path

from ebooklib import epub


# ---------------------------------------------------------------------------
# Story content
# ---------------------------------------------------------------------------

TITLE = "The Cartographer of Lost Worlds"
AUTHOR = "Lectoria Benchmark"
LANGUAGE = "en"

# Each chapter: list of (scene_label, emotion_hint, paragraphs[])
# Emotions targeted: joy, tension, sorrow, peace, mystery, excitement, anger, wonder, romance

CHAPTERS = [
    {
        "title": "Chapter One: The Discovery",
        "scenes": [
            {
                "label": "Morning of the expedition",
                "paragraphs": [
                    "The morning broke with the kind of gold that only exists in memories of childhood summers. "
                    "Elena stood at the threshold of the archive, her leather satchel heavy with notebooks, "
                    "and felt a laugh escape her before she could stop it. After seven years of dead ends and "
                    "polite rejections, the letter had come. She had been granted access.",
                    "She took the stone steps two at a time. The archivist, a small man with spectacles perched "
                    "permanently at the end of his nose, shook her hand and smiled as if he too understood the "
                    "rarity of the moment. 'You are the first outside researcher in eleven years,' he said. "
                    "Elena pressed the letter to her chest like a child clutching a birthday card.",
                    "The archive smelled of cedar and old paper and something faintly sweet she could not name. "
                    "She walked the rows slowly, trailing her fingers just above the spines without touching, "
                    "savoring the approach. This was the room. This was the collection that contained, if the "
                    "rumors were true, the original survey maps of Aldenmoor — the continent cartographers "
                    "had argued about for two centuries. Somewhere in here, among ten thousand folios, was proof.",
                    "She found the first map in the third cabinet, tucked between tax ledgers from 1743. "
                    "Her hands trembled as she unrolled it. The coastline was wrong in the way she had predicted, "
                    "wrong in the precise, beautiful way that meant it was right. She sat down on the floor "
                    "because there were no chairs nearby and her legs had simply decided they were done. "
                    "She stayed there for a long time, smiling at the ceiling.",
                ],
            },
            {
                "label": "The locked cabinet",
                "paragraphs": [
                    "The archivist had been helpful until she reached the far end of the eastern wing. "
                    "There, a single iron cabinet stood apart from the others, its lock a different type — "
                    "older, heavier, the keyhole plugged with a wax seal she did not recognize. "
                    "He appeared beside her so quietly that she startled.",
                    "'That one is not part of your access,' he said. His tone had not changed, but something "
                    "behind his eyes had. He did not look at the cabinet. He looked at her, which was worse. "
                    "'Restricted since 1891. The terms of the bequest.' He recited the words like a man "
                    "who has recited them many times, to many people, in this exact spot.",
                    "Elena noted the cabinet in her field journal with a small asterisk, the symbol she used "
                    "for things that did not fit. It had been moved recently — the floor beneath it was "
                    "lighter than the surrounding stone, a rectangle of less-faded grey. It had been here "
                    "for a long time, and then it had been moved a short distance, and then it had been "
                    "put back. Someone had wanted to see what was beneath it.",
                    "She returned to her assigned section and worked until the light through the high windows "
                    "turned amber. But every time the silence stretched too long, she found herself listening "
                    "for sounds from the eastern wing. There were none. That was not, in her experience, "
                    "the same as nothing happening.",
                ],
            },
            {
                "label": "The hidden atlas",
                "paragraphs": [
                    "On the fourth day she found it by accident, the way most important things are found. "
                    "She had been photographing the margins of a survey folio when she noticed the texture "
                    "of the backing board was different — not aged paper but stretched vellum, painted over "
                    "in a flat ochre that matched the cabinet interior precisely.",
                    "She called the archivist. He looked at what she was showing him for a very long time. "
                    "Then he sat down on the floor too, and they sat there together, two professionals "
                    "momentarily stripped of their professional distance, looking at a hidden atlas "
                    "that someone had gone to extraordinary effort to make invisible.",
                    "The maps inside were not of any coastline she knew. The scale was wrong — or rather "
                    "the scale implied distances impossible on the known globe. The compass rose had "
                    "seventeen points. The legend was in a script that used the Latin alphabet but "
                    "arranged into words she could not parse, as if someone had written in a language "
                    "that borrowed letters from a tongue it was not built for.",
                    "She photographed every page. Her camera battery died and she kept going with her "
                    "field phone. The phone died and she sat in the growing dark with a pencil, drawing "
                    "what she could from memory, knowing full well she could not hold it all. "
                    "The world had just become larger. She did not yet understand by how much.",
                ],
            },
        ],
    },
    {
        "title": "Chapter Two: The Weight of It",
        "scenes": [
            {
                "label": "The confrontation in the hotel",
                "paragraphs": [
                    "The man was waiting in her hotel room. She knew something was wrong before she opened "
                    "the door — the light was different, the gap at the bottom darker than it should be "
                    "for late afternoon. She thought about the lobby, the stairs, the distance to the "
                    "desk. Then she opened the door because she needed her photographs.",
                    "He was sitting in the chair by the window, which meant he had waited long enough "
                    "to feel comfortable. He was perhaps fifty, with the careful posture of a man "
                    "who had trained himself not to move unnecessarily. He did not reach for anything "
                    "when she entered. That was the part that frightened her most.",
                    "'Dr. Vasquez,' he said. 'The photographs, please.' He said it the way a person "
                    "says a thing when they have already decided what comes next regardless of the answer. "
                    "Elena's hand was on the strap of her bag. She calculated angles, distances, "
                    "the weight of the camera body as an object. She had never hit anyone. "
                    "She thought about it with a clarity that surprised her.",
                    "She put the bag on the bed between them. 'There are no photographs,' she said. "
                    "He looked at the bag and then at her and she held very still, the way she had "
                    "learned to hold still as a child during thunderstorms, as if stillness were "
                    "a form of invisibility. The air in the room felt thick. Outside, a bus passed. "
                    "The sound of it was absurdly normal.",
                    "He took the bag. He went through it with the efficiency of someone who has done this "
                    "before. The memory card was in her shoe. She stood and felt it there, a small hard "
                    "rectangle against her arch, and breathed carefully through her nose and did not look "
                    "at her feet. He found nothing. He left without a word, which was worse than if he "
                    "had said something threatening. Threats were a negotiation. Silence was a conclusion.",
                ],
            },
            {
                "label": "The phone call home",
                "paragraphs": [
                    "She called her mother from the bathroom of the hotel bar, sitting on the closed "
                    "lid of the toilet with the taps running. Her mother answered on the second ring "
                    "as she always did, as if she had been waiting, as if the thirty years between "
                    "Elena's childhood and now had not altered the fundamental frequency of that connection.",
                    "'You sound tired,' her mother said. This was not a question. Her mother had never "
                    "needed questions to understand a thing. Elena pressed her palm flat against the "
                    "cold tile of the wall and thought about how much she was not going to say. "
                    "The photograph of her father was still in her wallet, the one from the summer "
                    "before his diagnosis, his hand on the railing of a boat, squinting at the sun.",
                    "He had been a cartographer too. He had told her, three weeks before he died, "
                    "that the best maps were the ones that were honest about what they did not know. "
                    "'The blank spaces are not failures,' he had said. 'They are invitations.' "
                    "She had written it down at the time and then had not been able to read it again "
                    "for a year.",
                    "She told her mother she was fine, that the research was going well, that she would "
                    "call again Sunday. She did not tell her about the man in the hotel room or the "
                    "maps that should not exist. After she hung up she sat there a while longer "
                    "with the taps running, letting the ordinary sound of water fill the space "
                    "where the conversation had been. Then she dried her face and went back to work.",
                ],
            },
            {
                "label": "The university blocks her",
                "paragraphs": [
                    "The email from the department chair arrived at eleven minutes past midnight. "
                    "Elena read it three times, each reading making it neither better nor clearer, "
                    "only more real. Her research grant had been suspended, pending an internal review "
                    "of her methodology. The phrasing was careful in a way that careful phrasing "
                    "always is when someone has been advised by a lawyer.",
                    "She typed a reply and deleted it. She typed another and deleted that too. "
                    "The third draft she sent, though she would regret the last paragraph "
                    "and not regret it, depending on the day. She had been at this university "
                    "for nine years. She had published eleven papers and sat on three committees "
                    "and attended every retirement dinner she had been invited to, and she had "
                    "found the maps of a continent that was not supposed to exist, and they were "
                    "suspending her grant.",
                    "She stood at the window for a long time. The city below did not care. "
                    "Cars moved. A man walked a dog. The indifference of the world in these moments "
                    "was either comforting or infuriating, and tonight it was infuriating. "
                    "She thought about who had been in her hotel room and who might have made "
                    "a phone call and to whom, and the shape of it became clearer and uglier "
                    "the longer she looked at it.",
                    "She booked a flight under her maiden name, which she had not used in six years. "
                    "She transferred the photographs to three different servers in three different "
                    "countries. She worked with the focused fury of someone who has understood "
                    "that they are now the only person standing between something true and the "
                    "people who want it buried. She had not chosen this. She was choosing it now.",
                ],
            },
        ],
    },
    {
        "title": "Chapter Three: The New Map",
        "scenes": [
            {
                "label": "The fight at the harbor",
                "paragraphs": [
                    "They came for her at the harbor, two of them, moving with the practiced "
                    "casualness of people who do not want to be noticed doing what they are doing. "
                    "Elena saw them before they saw her — she had spent the last four days learning "
                    "to look at doorways before she walked through them. She did not run. "
                    "Running meant dropping the bag, and the bag had the memory card.",
                    "The first one caught her at the top of the gangway. He grabbed her arm and "
                    "she let him, then turned into it the way the self-defense instructor at the "
                    "university had shown her once, eleven years ago, in a class she had attended "
                    "mostly because it met on Friday afternoons and she had nowhere else to be. "
                    "She had not thought about that class in eleven years. Her body remembered "
                    "it better than she did. He went sideways into the railing and the noise he "
                    "made was undignified and brief.",
                    "The second one was faster and larger and had clearly done this before. "
                    "He caught her properly, both arms, and lifted her off the gangway, "
                    "and for a moment there was nothing she could do about it except think "
                    "very quickly. She thought about the atlas. She thought about her father "
                    "on the boat in the photograph. She drove her heel down onto his instep "
                    "with everything she had, and when his grip loosened she drove her elbow "
                    "back into his ribs, and she ran.",
                    "Okafor was already starting the engine. Elena did not know how she had known, "
                    "only that she had, the same way she had known to cut the engine near the island. "
                    "Elena landed in the boat more than she stepped into it, and Okafor pulled "
                    "away from the dock without any of the usual procedure and neither of them "
                    "spoke for several minutes. The two men stood at the end of the dock getting "
                    "smaller. One of them was on a phone. Elena sat in the stern with her bag "
                    "in her lap and her hands shaking and her heart slamming, feeling "
                    "more alive than she had in years.",
                    "She checked the bag. The memory card was there. She started to laugh "
                    "and then stopped because the shaking was still happening. Okafor looked "
                    "at her once, assessed the situation with the economy of a person who does "
                    "not waste assessments, and handed her a flask without comment. "
                    "It tasted like bad whiskey and Elena thought it was possibly the best "
                    "thing she had ever had in her life.",
                ],
            },
            {
                "label": "The journey begins",
                "paragraphs": [
                    "The boat was smaller than she had imagined. Everything about the next stage of this "
                    "was smaller, faster, more improvised than the seven careful years that had preceded it. "
                    "The captain, a woman named Okafor who had navigated three ocean crossings and spoke "
                    "in complete sentences only when the information required it, handed Elena a life "
                    "jacket and told her where the flares were. This felt correct.",
                    "They left before dawn. The harbor lights fell behind them and the sea ahead was "
                    "black and the stars were extraordinary. Elena stood at the bow for an hour, "
                    "watching the horizon the way she had watched the maps, looking for the thing "
                    "at the edge of what was known. The cold was sharp and alive and she did not go below.",
                    "Her field journal had forty empty pages. She was going to fill them. "
                    "She did not know yet what with — that was the point, had always been the point. "
                    "The coordinates she had derived from the hidden atlas pointed to open ocean "
                    "on every chart published since 1900. But the older charts, the ones that "
                    "predated the standardization, the ones with their seventeen-point compass roses "
                    "and their impossible scales — those told a different story.",
                    "She had printed the best translation she could manage of the legend. "
                    "The phrase she kept returning to, the one the atlas repeated in its margins "
                    "like a watermark repeated in paper, translated roughly as: 'Here is what "
                    "we could not bring ourselves to forget.' She thought about that as the boat "
                    "pushed into open water and the last lights of the coast disappeared "
                    "and everything ahead was new.",
                ],
            },
            {
                "label": "An unexpected alliance",
                "paragraphs": [
                    "Marco had been on the boat for two days before Elena noticed he was not "
                    "part of the crew. He had worked efficiently enough that she had assumed, "
                    "and the assumption had been comfortable and so she had not questioned it. "
                    "He introduced himself over dinner on the third night as a historian of "
                    "cartographic provenance, which was such a specific phrase that she laughed "
                    "before she could stop herself, and then he laughed too, and the distance "
                    "across the table became different.",
                    "He knew the atlas. Not the original — he had seen photographs, circulated "
                    "in certain academic corners for years as an unsolved puzzle, attributed to "
                    "forgery by everyone except the people who had looked most closely. "
                    "He had been looking for the original for four years. She had found it. "
                    "They sat across from each other in the galley with the boat rolling gently "
                    "beneath them and shared what they knew with the particular intensity "
                    "of two people who have each been carrying something alone for a long time.",
                    "Later, on deck, the sea was silver under the moon. He stood near her "
                    "but not too near, respecting some boundary she had not consciously set "
                    "but which he seemed to feel anyway. They talked about her father. "
                    "She did not know why she talked about her father. She did not usually. "
                    "He listened without filling in the silences, which was rarer than it should be.",
                    "When she went below to sleep she lay awake for a while in the narrow bunk, "
                    "listening to the water against the hull. The night felt different from the "
                    "previous nights — warmer, more inhabited. She thought about blank spaces "
                    "on maps and the difference between empty and unknown. Then she slept, "
                    "and her sleep was dreamless in the way of the genuinely tired, "
                    "which is the best kind.",
                ],
            },
            {
                "label": "Arrival",
                "paragraphs": [
                    "The island emerged from the morning mist slowly, the way things emerge "
                    "when they have been waiting to be seen rather than hiding. The cliffs were "
                    "the color the atlas had described in its legend — a word that translated "
                    "as 'the grey of sky before the last storm of winter.' Elena stood at the bow "
                    "again and let the mist touch her face and did not hurry any of it.",
                    "Okafor cut the engine when they were close enough to hear waves. "
                    "The three of them drifted for a while, which was impractical and which "
                    "Okafor allowed without being asked. Some moments required the engine off. "
                    "The birds above the cliffs were ones Elena did not recognize. "
                    "She was going to learn their names. She was going to learn everything.",
                    "She thought about the man in her hotel room and the email from the department "
                    "chair and the seventeen-point compass rose and her father on the boat "
                    "in the old photograph, and she thought about how a thing can be true "
                    "even when every institution with an interest in the matter is arguing "
                    "the opposite. The island was here. It was here before she had found it "
                    "and it would be here after, patient and indifferent to the argument "
                    "about whether it existed.",
                    "Marco came to stand beside her. Their shoulders were almost touching. "
                    "He did not say anything, which was right. The island did not need narration. "
                    "The water was very still in the lee of the cliffs. A seal appeared on a rock "
                    "and regarded them without alarm, and Elena understood in that moment "
                    "that they were the visitors here, which was exactly as it should be. "
                    "She opened her journal to the first blank page. She wrote the date, "
                    "the coordinates, the quality of the light. She began the new map.",
                ],
            },
        ],
    },
]


# ---------------------------------------------------------------------------
# EPUB builder
# ---------------------------------------------------------------------------


def build_epub(output_path: Path) -> None:
    book = epub.EpubBook()
    book.set_identifier("lectoria-benchmark-001")
    book.set_title(TITLE)
    book.set_language(LANGUAGE)
    book.add_author(AUTHOR)
    book.add_metadata(
        "DC",
        "description",
        "Benchmark EPUB for Lectoria pipeline testing. "
        "3 chapters, 9 scenes covering all 9 emotion categories.",
    )

    # Minimal CSS
    css = epub.EpubItem(
        uid="style",
        file_name="style.css",
        media_type="text/css",
        content=b"""
body { font-family: Georgia, serif; line-height: 1.7; margin: 2em; }
h1 { font-size: 1.8em; margin-bottom: 0.5em; }
h2 { font-size: 1.3em; margin: 1.5em 0 0.5em; color: #555; }
p { margin-bottom: 0.9em; text-indent: 1.4em; }
p:first-of-type { text-indent: 0; }
""",
    )
    book.add_item(css)

    chapters_epub = []
    spine = ["nav"]

    for ch_idx, chapter in enumerate(CHAPTERS):
        paragraphs_html = []
        for scene in chapter["scenes"]:
            paragraphs_html.append(f"<h2>{scene['label']}</h2>")
            for para in scene["paragraphs"]:
                paragraphs_html.append(f"<p>{para}</p>")

        content = f"""<?xml version='1.0' encoding='utf-8'?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>{chapter["title"]}</title>
  <link rel="stylesheet" href="style.css"/>
</head>
<body>
  <h1>{chapter["title"]}</h1>
  {"".join(paragraphs_html)}
</body>
</html>"""

        file_name = f"chapter{ch_idx + 1}.xhtml"
        uid = f"chapter{ch_idx + 1}"

        ch = epub.EpubHtml(
            title=chapter["title"],
            file_name=file_name,
            uid=uid,
            lang=LANGUAGE,
        )
        ch.content = content.encode("utf-8")
        ch.add_item(css)
        book.add_item(ch)
        chapters_epub.append(ch)
        spine.append(ch)

    book.toc = [epub.Section(ch.title, [ch]) for ch in chapters_epub]
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    book.spine = spine

    output_path.parent.mkdir(parents=True, exist_ok=True)
    epub.write_epub(str(output_path), book)
    print(f"Written: {output_path}")
    print(f"  {len(CHAPTERS)} chapters")
    total_scenes = sum(len(ch["scenes"]) for ch in CHAPTERS)
    total_paras = sum(len(s["paragraphs"]) for ch in CHAPTERS for s in ch["scenes"])
    print(f"  {total_scenes} scenes ({total_paras} paragraphs)")
    emotions = [s["label"].split(" — ")[0] for ch in CHAPTERS for s in ch["scenes"]]
    print(f"  Emotions: {', '.join(emotions)}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate benchmark EPUB for Lectoria")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("benchmark.epub"),
        help="Output path (default: benchmark.epub)",
    )
    args = parser.parse_args()
    build_epub(args.output)


if __name__ == "__main__":
    main()
