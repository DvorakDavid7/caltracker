import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type Meal = {
  id: number;
  date: string; // YYYY-MM-DD in the user's local time
  description: string;
  name: string;
  kcal: number;
  protein: number; // grams
  fat: number; // grams
  carbs: number; // grams
  createdAt: string;
};

export type User = { id: number; username: string };

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "caltracker.db");

// Reuse one connection across hot reloads in dev.
const globalForDb = globalThis as unknown as { __caltrackerDb?: DatabaseSync };

function migrate(db: DatabaseSync) {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS meals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      name TEXT NOT NULL,
      kcal REAL NOT NULL,
      protein REAL NOT NULL,
      fat REAL NOT NULL,
      carbs REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Meals created before accounts existed have no owner (user_id NULL).
  const cols = db.prepare(`PRAGMA table_info(meals)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "user_id")) {
    db.exec(`ALTER TABLE meals ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);
  }
  db.exec(`
    DROP INDEX IF EXISTS meals_date_idx;
    CREATE INDEX IF NOT EXISTS meals_user_date_idx ON meals(user_id, date);
  `);
}

export function getDb(): DatabaseSync {
  if (!globalForDb.__caltrackerDb) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new DatabaseSync(DB_PATH);
    migrate(db);
    globalForDb.__caltrackerDb = db;
  }
  return globalForDb.__caltrackerDb;
}

// ---- meals ----

const SELECT_MEAL = `SELECT id, date, description, name, kcal, protein, fat, carbs, created_at AS createdAt FROM meals`;

export function listMeals(userId: number, date: string): Meal[] {
  return getDb()
    .prepare(`${SELECT_MEAL} WHERE user_id = ? AND date = ? ORDER BY id`)
    .all(userId, date) as unknown as Meal[];
}

export function addMeal(userId: number, m: Omit<Meal, "id" | "createdAt">): Meal {
  const db = getDb();
  const res = db
    .prepare(
      `INSERT INTO meals (user_id, date, description, name, kcal, protein, fat, carbs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(userId, m.date, m.description, m.name, m.kcal, m.protein, m.fat, m.carbs);
  return db.prepare(`${SELECT_MEAL} WHERE id = ?`).get(res.lastInsertRowid) as unknown as Meal;
}

/** Deletes only if the meal belongs to the user. */
export function deleteMeal(userId: number, id: number): boolean {
  return getDb().prepare(`DELETE FROM meals WHERE id = ? AND user_id = ?`).run(id, userId).changes > 0;
}

// ---- users ----

export function findUserByUsername(username: string): (User & { passwordHash: string }) | undefined {
  return getDb()
    .prepare(`SELECT id, username, password_hash AS passwordHash FROM users WHERE username = ?`)
    .get(username) as unknown as (User & { passwordHash: string }) | undefined;
}

/**
 * Creates a user. The very first account also takes over meals logged
 * before accounts existed, so earlier data isn't lost.
 * Returns undefined if the username is taken.
 */
export function createUser(username: string, passwordHash: string): User | undefined {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (db.prepare(`SELECT 1 FROM users WHERE username = ?`).get(username)) {
      db.exec("ROLLBACK");
      return undefined;
    }
    const res = db
      .prepare(`INSERT INTO users (username, password_hash) VALUES (?, ?)`)
      .run(username, passwordHash);
    const id = Number(res.lastInsertRowid);
    const { n } = db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };
    if (n === 1) db.prepare(`UPDATE meals SET user_id = ? WHERE user_id IS NULL`).run(id);
    db.exec("COMMIT");
    return { id, username };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// ---- sessions ----

export function insertSession(tokenHash: string, userId: number, expiresAt: number) {
  const db = getDb();
  db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(Date.now());
  db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`).run(
    tokenHash,
    userId,
    expiresAt
  );
}

export function findSessionUser(tokenHash: string): User | undefined {
  return getDb()
    .prepare(
      `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`
    )
    .get(tokenHash, Date.now()) as unknown as User | undefined;
}

export function deleteSession(tokenHash: string) {
  getDb().prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash);
}
