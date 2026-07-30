export type UserRole = "reader" | "publisher";

export type BookStatus = "draft" | "published";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  password_hash: string;
  created_at: string;
}

export interface Book {
  id: string;
  publisher_id: string;
  title: string;
  description: string;
  price_cents: number;
  status: BookStatus;
  source_filename: string | null;
  source_path: string | null;
  raw_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface Chapter {
  id: string;
  book_id: string;
  position: number;
  title: string;
  content: string;
  word_count: number;
  /** Logical source chapter (1 = free preview group for paid books). */
  group_index: number;
}

export interface Purchase {
  id: string;
  user_id: string;
  book_id: string;
  amount_cents: number;
  created_at: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface BookListItem {
  id: string;
  title: string;
  description: string;
  price_cents: number;
  status: BookStatus;
  publisher_name: string;
  chapter_count: number;
  created_at: string;
}
