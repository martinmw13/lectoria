"""Provider registry — maps provider names to adapter constructors.

Adapters are registered at import time. The factory functions instantiate
a provider from a name + API key, typically extracted from request headers.
"""

import logging
from typing import Callable

from lectoria.providers.base import ImageProvider, LLMProvider

logger = logging.getLogger(__name__)

# name -> callable(api_key) -> provider instance
_llm_registry: dict[str, Callable[[str], LLMProvider]] = {}
_image_registry: dict[str, Callable[[str], ImageProvider]] = {}


def register_llm_provider(name: str, factory: Callable[[str], LLMProvider]) -> None:
    _llm_registry[name] = factory


def register_image_provider(name: str, factory: Callable[[str], ImageProvider]) -> None:
    _image_registry[name] = factory


def get_llm_provider(name: str, api_key: str) -> LLMProvider:
    if name not in _llm_registry:
        available = ", ".join(sorted(_llm_registry)) or "(none)"
        raise ValueError(f"Unknown LLM provider '{name}'. Available: {available}")
    return _llm_registry[name](api_key)


def get_image_provider(name: str, api_key: str) -> ImageProvider:
    if name not in _image_registry:
        available = ", ".join(sorted(_image_registry)) or "(none)"
        raise ValueError(f"Unknown image provider '{name}'. Available: {available}")
    return _image_registry[name](api_key)


def available_llm_providers() -> list[str]:
    return sorted(_llm_registry)


def available_image_providers() -> list[str]:
    return sorted(_image_registry)
