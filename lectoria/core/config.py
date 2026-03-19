import logging
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = PROJECT_ROOT / "data"
BOOKS_DIR = DATA_DIR / "books"
MUSIC_DIR = DATA_DIR / "music"


class Settings(BaseSettings):
    data_dir: Path = Field(default=DATA_DIR)
    books_dir: Path = Field(default=BOOKS_DIR)
    music_dir: Path = Field(default=MUSIC_DIR)
    log_level: str = Field(default="INFO")

    model_config = {"env_prefix": "LECTORIA_"}


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
