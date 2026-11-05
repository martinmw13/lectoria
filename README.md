# Lectoria (Meta hackathon)

[![Built with Meta Muse](https://img.shields.io/badge/Built_with-Meta_Muse-0866FF)](#built-with-meta-muse)

Lectoria is an e-reader that plays orchestral music matched to the emotion of each scene of a public-domain book. Readers can also illustrate a passage or a scene and talk with a spoiler-free companion about the book.

Status: live at https://lectoria-meta.vercel.app with ten public-domain books on the shelf (Oz, Alice, Frankenstein, Pride and Prejudice, Sherlock Holmes, Dracula, Peter Pan, Treasure Island, The Jungle Book and A Christmas Carol). Every book has music matched to each scene's emotion, rain ambience, Picture this images, chapter panels and a spoiler-free "Ask the book" companion. Oz also has a read-aloud narrator with two voices that highlights each word as it speaks (the music ducks under the voice). Readers can upload their own EPUB, free for short books or with their own Meta key.

### Try it in two minutes

1. Open the site and pick a style under "Pick your style": Engraving, Watercolor, Ink doodle, Pencil, Comic book or Lantern dusk.
2. Open The Wonderful Wizard of Oz. The music follows the emotion of each scene as you turn pages.
3. Press Read aloud, then try Picture this on a passage or Relive this chapter in panels.
4. Press Ask the book and ask what happens next: it answers only from the pages you have read.

## Setup

`npm install` installs the git hooks (or run `npm run prepare` directly). The hooks check staged file size and secrets and add the co-author trailer.

## Run it

```sh
npm ci
npm run dev     # local server at http://localhost:3000
npm test        # vitest suite
npm run typecheck
npm run build
```

## Checks

Opt-in scroll e2e (Python Playwright, not in CI): `python3 scripts/e2e-scroll.py [base_url]`.

## Deploys

Automatic Vercel git deploys are off (`vercel.json`: `git.deploymentEnabled: false`), for both PR Previews and `main`. This keeps us under the Hobby limit of about 100 deploys a day. Production goes out manually, in batches, a few times a day, from an up-to-date `main`:

```bash
npm run deploy:prod   # = vercel deploy --prod --yes (needs `vercel login` or VERCEL_TOKEN, and `vercel link` to team lectoria1)
```

## Built with Meta Muse

Meta's Muse built this repo and runs inside it.

**Muse Code wrote the code.** Nearly every commit carries the `Co-authored-by: Muse Code (Meta)` trailer. Each task has a design in [docs/tasks/](docs/tasks/), a review in [docs/reviews/](docs/reviews/) and a Muse Code session transcript in [agent-logs/](agent-logs/). The few changes made by other tools are listed in [RESCUE_LOG.md](RESCUE_LOG.md). [docs/MUSE.md](docs/MUSE.md) has the commit and line counts and the list of PRs, regenerated from git history on every push to main. PRs with Muse commits carry the `Muse Code` label.

**The book pipeline runs on Meta models** (`npm run build:book`, [pipeline/](pipeline/)):

- Cleaning: when the pipeline ingests an EPUB, sections the deterministic rules can't settle go to Muse Spark Open (`Muse-Spark-Open-816B-A42B`, open weights on a Modal endpoint), with the Meta API as fallback ([pipeline/clean-providers.ts](pipeline/clean-providers.ts)).
- Scenes: Muse Spark splits each chapter into scenes, one call per chapter with a JSON schema ([pipeline/segment.ts](pipeline/segment.ts)).
- Emotions: Jev classifies each scene. When Jev returns `unknown` or its confidence is under 0.6, Muse Spark overrides the emotion vector and the scene records the override ([pipeline/classify.ts](pipeline/classify.ts), [core/emotion.ts](core/emotion.ts)). In Oz that happened for 43 of 151 scenes.
- Re-splits: where the emotion shift inside a scene is borderline, Muse Spark decides whether to split it and records why ([pipeline/resplit.ts](pipeline/resplit.ts)).
- Images: every picture the app draws, in all six visual styles, is generated with Meta's Muse Image (`muse-image-1.0`): "Picture this", scene pictures and "Relive this chapter in panels" ([server/images/meta.ts](server/images/meta.ts)).

**Art in the repo made with Meta.** These committed images were also generated with Muse Image (`muse-image-1.0`):

- The Wonderful Wizard of Oz character portraits (Dorothy, Uncle Henry, Aunt Em and Toto, in every style) in [public/portraits/](public/portraits/).
- The watercolor "Just Chopin!" button icon, [public/art/skins/watercolor/chopin.png](public/art/skins/watercolor/chopin.png).
- The styled shelf covers in [public/covers/v1/](public/covers/v1/), made with [scripts/pregen-covers.ts](scripts/pregen-covers.ts).

[public/art/SOURCES.md](public/art/SOURCES.md) lists the source of every piece of skin art, including the other images made with Meta's image model.

**Dev and production models.** Development, tests and the pipeline default use `muse-spark-1.3-contributor`, the cheaper development model. The public "Ask the book" chat also runs on Contributor ([core/chat.ts](core/chat.ts), [server/chat/](server/chat/)), the same Muse Spark 1.3 model at a fraction of the Standard price; Muse Spark 1.3 Standard (`muse-spark-1.3`) is reserved for final passes. The chat only sees the text up to the reader's page unless spoiler mode is on (see [AGENTS.md](AGENTS.md)).

## Docs

- [AGENTS.md](AGENTS.md): agent instructions
- [SECURITY.md](SECURITY.md): how secrets and quotas work
- [PRIOR_WORK.md](PRIOR_WORK.md): relation to the March prototype
- [BUILT_DURING_HACKATHON.md](BUILT_DURING_HACKATHON.md): dated build log
- [docs/MUSE.md](docs/MUSE.md): what Muse Code wrote, from git history (`npm run muse:stats`)

License: MIT ([LICENSE](LICENSE)).
