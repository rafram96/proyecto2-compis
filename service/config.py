from dataclasses import dataclass
import os
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    storage: Path = Path('data/cauce-service')
    datasets: Path = Path('data/cauce-datasets')
    static: Path = Path('web/dist')
    timeout_seconds: float = 30
    active: int = 1
    queue: int = 4
    ttl_seconds: float = 3600
    memory_bytes: int = 512 * 1024**2
    input_bytes: int = 16 * 1024**2
    file_bytes: int = 16 * 1024**2
    work_bytes: int = 32 * 1024**2
    storage_bytes: int = 256 * 1024**2
    max_jobs: int = 128
    max_rows: int = 1_000_000
    max_columns: int = 128
    preview_rows: int = 100
    source_bytes: int = 128 * 1024

    @classmethod
    def environment(cls):
        return cls(storage=Path(os.getenv('CAUCE_STORAGE', 'data/cauce-service')),
                   datasets=Path(os.getenv('CAUCE_DATASETS', 'data/cauce-datasets')),
                   static=Path(os.getenv('CAUCE_STATIC', 'web/dist')),
                   timeout_seconds=float(os.getenv('CAUCE_TIMEOUT', '30')))
