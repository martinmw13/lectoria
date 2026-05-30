"""Tests for image service — character identification, prompt building, and the
provider-backed generation paths (via the FakeImageProvider seam)."""

import pytest

from lectoria.models.ncm import Character, CharacterRole, Emotion, Scene
from lectoria.providers.base import ImageProvider
from lectoria.services.image import (
    build_on_demand_prompt,
    generate_on_demand,
    generate_scene_image,
    identify_characters,
)
from tests.fakes import FAKE_PNG, FakeImageProvider


def _char(name: str, char_id: str, aliases: list[str] | None = None, desc: str = "") -> Character:
    return Character(
        id=char_id,
        name=name,
        aliases=aliases or [],
        physical_description=desc,
        role=CharacterRole.SECONDARY,
    )


def _scene(characters: list[str]) -> Scene:
    return Scene(
        scene_index=1,
        start_paragraph=1,
        end_paragraph=10,
        emotion=Emotion.PEACE,
        characters_present=characters,
    )


HARRY = _char(
    "Harry Potter",
    "harry-potter",
    ["Harry", "Potter", "The Boy Who Lived"],
    "messy black hair, green eyes, lightning scar",
)
HERMIONE = _char(
    "Hermione Granger", "hermione-granger", ["Hermione"], "bushy brown hair, brown eyes"
)
RON = _char("Ron Weasley", "ron-weasley", ["Ron", "Weasley"], "red hair, tall, freckles")
CHARACTERS = [HARRY, HERMIONE, RON]


class TestIdentifyCharacters:
    def test_match_by_full_name(self):
        result = identify_characters("Harry Potter walked into the room.", CHARACTERS)
        assert HARRY in result

    def test_match_by_alias(self):
        result = identify_characters("The Boy Who Lived had arrived.", CHARACTERS)
        assert HARRY in result

    def test_match_multiple_characters(self):
        result = identify_characters("Harry and Hermione studied together.", CHARACTERS)
        assert HARRY in result
        assert HERMIONE in result

    def test_no_match_returns_empty(self):
        result = identify_characters("The stranger walked alone.", CHARACTERS)
        assert result == []

    def test_possessive_stripped(self):
        result = identify_characters("Harry's wand glowed brightly.", CHARACTERS)
        assert HARRY in result

    def test_case_insensitive(self):
        result = identify_characters("HARRY ran fast.", CHARACTERS)
        assert HARRY in result

    def test_fallback_to_scene_characters(self):
        scene_chars = ["harry-potter"]
        result = identify_characters("He ran away.", CHARACTERS, scene_chars)
        assert HARRY in result

    def test_no_fallback_when_name_matches(self):
        """When name matching succeeds, scene_characters fallback is not used."""
        scene_chars = ["hermione-granger"]
        result = identify_characters("Harry spoke.", CHARACTERS, scene_chars)
        assert HARRY in result
        assert HERMIONE not in result

    def test_unknown_scene_character_id_skipped(self):
        scene_chars = ["unknown-character"]
        result = identify_characters("He walked.", CHARACTERS, scene_chars)
        assert result == []

    def test_no_duplicate_on_alias_and_name_match(self):
        """If both name and alias match, character appears only once."""
        result = identify_characters("Harry Potter, also known as Harry.", CHARACTERS)
        assert result.count(HARRY) == 1


class TestBuildOnDemandPrompt:
    def test_includes_selected_text(self):
        prompt = build_on_demand_prompt("A dark corridor.", CHARACTERS)
        assert "A dark corridor." in prompt

    def test_injects_character_descriptions(self):
        prompt = build_on_demand_prompt("Harry raised his wand.", CHARACTERS)
        assert "messy black hair" in prompt
        assert "Harry Potter:" in prompt

    def test_no_descriptions_when_no_match(self):
        prompt = build_on_demand_prompt("The castle stood empty.", CHARACTERS)
        assert "Character appearances" not in prompt

    def test_scene_context_used_for_fallback(self):
        scene = _scene(["hermione-granger"])
        prompt = build_on_demand_prompt("She opened the book.", CHARACTERS, scene)
        assert "bushy brown hair" in prompt

    def test_character_without_description_excluded(self):
        no_desc = _char("Dobby", "dobby", desc="")
        prompt = build_on_demand_prompt("Dobby appeared.", [no_desc])
        assert "Character appearances" not in prompt


def test_fake_provider_satisfies_protocol():
    assert isinstance(FakeImageProvider(), ImageProvider)


class TestGenerateSceneImage:
    @pytest.mark.asyncio
    async def test_writes_image_to_scenes_dir(self, book_on_disk):
        scene = book_on_disk.ncm.chapters[0].scenes[0]
        provider = FakeImageProvider([FAKE_PNG])
        out = await generate_scene_image(
            provider, book_on_disk.store, book_on_disk.book_id, scene, 1
        )
        assert out is not None
        assert out == book_on_disk.book_dir / "images" / "scenes" / "ch1_sc1.png"
        assert out.read_bytes() == FAKE_PNG
        assert provider.calls == 1
        assert provider.prompts == [scene.image_prompt]

    @pytest.mark.asyncio
    async def test_skips_when_no_image_prompt(self, book_on_disk):
        scene = Scene(
            scene_index=2,
            start_paragraph=1,
            end_paragraph=1,
            emotion=Emotion.PEACE,
            image_prompt="",
        )
        provider = FakeImageProvider([FAKE_PNG])
        out = await generate_scene_image(
            provider, book_on_disk.store, book_on_disk.book_id, scene, 1
        )
        assert out is None
        assert provider.calls == 0

    @pytest.mark.asyncio
    async def test_returns_existing_without_regenerating(self, book_on_disk):
        scene = book_on_disk.ncm.chapters[0].scenes[0]
        existing = book_on_disk.book_dir / "images" / "scenes" / "ch1_sc1.png"
        existing.write_bytes(b"already-here")
        provider = FakeImageProvider([FAKE_PNG])
        out = await generate_scene_image(
            provider, book_on_disk.store, book_on_disk.book_id, scene, 1
        )
        assert out is not None
        assert out == existing
        assert out.read_bytes() == b"already-here"
        assert provider.calls == 0

    @pytest.mark.asyncio
    async def test_provider_failure_returns_none(self, book_on_disk):
        scene = book_on_disk.ncm.chapters[0].scenes[0]
        provider = FakeImageProvider([RuntimeError("image API down")])
        out = await generate_scene_image(
            provider, book_on_disk.store, book_on_disk.book_id, scene, 1
        )
        assert out is None
        assert provider.calls == 1


class TestGenerateOnDemand:
    @pytest.mark.asyncio
    async def test_returns_bytes_and_stores_character_memory(self, book_on_disk):
        provider = FakeImageProvider([FAKE_PNG])
        image = await generate_on_demand(
            provider,
            book_on_disk.store,
            book_on_disk.book_id,
            "Hero draws a sword.",
            book_on_disk.ncm.book_map,
        )
        assert image == FAKE_PNG
        # A single identified character is persisted as character memory (Decision 8).
        char_path = book_on_disk.book_dir / "images" / "characters" / "hero.png"
        assert char_path.exists()
        assert char_path.read_bytes() == FAKE_PNG

    @pytest.mark.asyncio
    async def test_no_character_memory_when_none_identified(self, book_on_disk):
        provider = FakeImageProvider([FAKE_PNG])
        await generate_on_demand(
            provider,
            book_on_disk.store,
            book_on_disk.book_id,
            "An empty corridor stretched into darkness.",
            book_on_disk.ncm.book_map,
        )
        chars_dir = book_on_disk.book_dir / "images" / "characters"
        assert list(chars_dir.iterdir()) == []
