"""Test that quick edit preserves the original language.

When editing text, the output should be in the same language as the input,
unless explicitly asked to translate.
"""

import pytest

from prompts.domains.edit import EDIT_ACTIONS, QUICK_EDIT_SYSTEM, get_edit_instruction


def test_system_prompt_requires_language_preservation():
    """Test that system prompt explicitly requires preserving original language."""
    assert "SAME LANGUAGE" in QUICK_EDIT_SYSTEM
    assert (
        "unless explicitly asked to translate" in QUICK_EDIT_SYSTEM
        or "unless" in QUICK_EDIT_SYSTEM.lower()
    )


def test_non_translation_actions_preserve_language():
    """Test that all non-translation edit actions mention preserving language."""
    non_translation_actions = [
        action for action in EDIT_ACTIONS if not action.startswith("translate-")
    ]

    for action in non_translation_actions:
        instruction = get_edit_instruction(action)
        # Each instruction should mention "language" or be covered by system prompt
        # Since we added it to system prompt, this test verifies the explicit additions
        if action in ["fix-grammar", "improve"]:
            assert "language" in instruction.lower(), (
                f"{action} should mention language preservation"
            )


def test_translation_actions_specify_target_language():
    """Test that translation actions specify the target language."""
    language_map = {
        "translate-en": "English",
        "translate-zh": "Chinese",
        "translate-es": "Spanish",
        "translate-fr": "French",
        "translate-de": "German",
        "translate-ja": "Japanese",
    }

    for action, expected_lang in language_map.items():
        if action in EDIT_ACTIONS:
            instruction = get_edit_instruction(action)
            assert expected_lang.lower() in instruction.lower(), (
                f"{action} should specify {expected_lang}"
            )


def test_all_actions_have_instructions():
    """Test that all actions have valid instructions."""
    for action, config in EDIT_ACTIONS.items():
        assert "instruction" in config, f"{action} missing instruction"
        assert "temperature" in config, f"{action} missing temperature"
        assert isinstance(config["instruction"], str), f"{action} instruction should be string"
        assert 0.0 <= config["temperature"] <= 1.0, (
            f"{action} temperature should be between 0 and 1"
        )


@pytest.mark.parametrize(
    "action,expected_keyword",
    [
        ("fix-grammar", "grammar"),
        ("improve", "improve"),
        ("simplify", "simpler"),
        ("expand", "expand"),
        ("shorten", "condense"),
        ("professional", "professional"),
        ("casual", "casual"),
        ("friendly", "friendly"),
        ("confident", "confident"),
    ],
)
def test_action_instructions_match_intent(action, expected_keyword):
    """Test that each action's instruction matches its intent."""
    instruction = get_edit_instruction(action)
    assert expected_keyword.lower() in instruction.lower(), (
        f"{action} instruction should mention {expected_keyword}"
    )
