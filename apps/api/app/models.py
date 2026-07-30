from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    firebase_uid: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    books: Mapped[list["Book"]] = relationship(
        back_populates="publisher",
        foreign_keys="Book.publisher_id",
    )
    purchases: Mapped[list["Purchase"]] = relationship(back_populates="user")

    __table_args__ = (
        CheckConstraint("role IN ('reader', 'publisher', 'admin')", name="ck_users_role"),
    )


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    books: Mapped[list["Book"]] = relationship(back_populates="category")


class Book(Base):
    __tablename__ = "books"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    publisher_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    category_id: Mapped[str | None] = mapped_column(
        ForeignKey("categories.id", ondelete="RESTRICT"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    price_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    source_filename: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    publisher: Mapped[User] = relationship(back_populates="books", foreign_keys=[publisher_id])
    reviewer: Mapped[User | None] = relationship(foreign_keys=[reviewed_by])
    category: Mapped[Category | None] = relationship(back_populates="books")
    chapters: Mapped[list["Chapter"]] = relationship(back_populates="book", cascade="all, delete-orphan")
    purchases: Mapped[list["Purchase"]] = relationship(back_populates="book")

    __table_args__ = (
        CheckConstraint(
            "status IN ('draft', 'pending_review', 'published', 'rejected')",
            name="ck_books_status",
        ),
    )


class Chapter(Base):
    __tablename__ = "chapters"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    book_id: Mapped[str] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    group_index: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    book: Mapped[Book] = relationship(back_populates="chapters")


class Purchase(Base):
    __tablename__ = "purchases"
    __table_args__ = (UniqueConstraint("user_id", "book_id", name="uq_purchases_user_book"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    book_id: Mapped[str] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), nullable=False)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped[User] = relationship(back_populates="purchases")
    book: Mapped[Book] = relationship(back_populates="purchases")


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
