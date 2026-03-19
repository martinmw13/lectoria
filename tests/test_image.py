"""Tests for image service — character identification and prompt building."""

from lectoria.models.ncm import Character, CharacterRole, Emotion, Scene
from lectoria.services.image import build_on_demand_prompt, identify_characters


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
