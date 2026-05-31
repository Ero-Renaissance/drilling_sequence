from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

_is_sqlite = settings.database_url.startswith("sqlite")

engine = create_async_engine(
    settings.database_url,
    echo=False,
    # SQLite requires this when sharing a connection across threads/greenlets.
    connect_args={"check_same_thread": False} if _is_sqlite else {},
    # Server databases (PostgreSQL / MSSQL) sit behind corporate networks and
    # firewalls that silently drop idle connections; pre-ping recycles a dead
    # connection transparently instead of erroring on the next query. No effect
    # on the local SQLite file.
    pool_pre_ping=not _is_sqlite,
)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
