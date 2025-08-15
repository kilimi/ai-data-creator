from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv
import os

load_dotenv()

# Use the environment variable or default to the Docker service URL
SQLALCHEMY_DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@db/ai_data_creator"
)

# Create engine with increased pool size and better connection management
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_size=20,          # Increased from default 5
    max_overflow=30,       # Increased from default 10
    pool_timeout=60,       # Increased timeout
    pool_recycle=3600,     # Recycle connections every hour
    pool_pre_ping=True     # Verify connections before use
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()