import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { sumItems, type MealItem, type MealItemInput } from "./items";

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
  items: MealItem[]; // empty for meals logged before ingredient breakdowns existed
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

  // Email was added after the first accounts; older users may have none.
  const userCols = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
  if (!userCols.some((c) => c.name === "email")) {
    db.exec(`ALTER TABLE users ADD COLUMN email TEXT COLLATE NOCASE`);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email) WHERE email IS NOT NULL`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS meal_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meal_id INTEGER NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      food TEXT NOT NULL,
      grams REAL NOT NULL,
      kcal_100 REAL NOT NULL,
      protein_100 REAL NOT NULL,
      fat_100 REAL NOT NULL,
      carbs_100 REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS meal_items_meal_idx ON meal_items(meal_id);
  `);
}

// Bump whenever migrate() changes. Stored in the DB file (PRAGMA user_version)
// so migrate() only runs - and only writes to the file - when the schema is
// actually out of date. Writing on every check made the dev server see the DB
// file change, recompile, reload the page and check again, in an endless loop.
const SCHEMA_VERSION = 4;

// Module-level, so it resets whenever this file is reloaded. The connection
// itself survives hot reloads (globalThis), and without this a dev server
// started on an older schema would never create newly added tables.
let schemaChecked = false;

export function getDb(): DatabaseSync {
  if (!globalForDb.__caltrackerDb) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new DatabaseSync(DB_PATH);
    db.exec("PRAGMA foreign_keys = ON"); // per connection, not stored in the file
    globalForDb.__caltrackerDb = db;
  }
  const db = globalForDb.__caltrackerDb;
  if (!schemaChecked) {
    const { user_version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
    if (user_version < SCHEMA_VERSION) {
      migrate(db); // idempotent
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
    schemaChecked = true;
  }
  return db;
}

// ---- meals ----

type MealRow = Omit<Meal, "items">;

const SELECT_MEAL = `SELECT id, date, description, name, kcal, protein, fat, carbs, created_at AS createdAt FROM meals`;
const SELECT_ITEMS = `SELECT id, meal_id AS mealId, food, grams, kcal_100 AS kcal100, protein_100 AS protein100,
  fat_100 AS fat100, carbs_100 AS carbs100 FROM meal_items`;

function withItems(rows: MealRow[]): Meal[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const items = getDb()
    .prepare(`${SELECT_ITEMS} WHERE meal_id IN (${ids.map(() => "?").join(",")}) ORDER BY meal_id, position`)
    .all(...ids) as unknown as (MealItem & { mealId: number })[];
  const byMeal = new Map<number, MealItem[]>();
  for (const { mealId, ...item } of items) {
    if (!byMeal.has(mealId)) byMeal.set(mealId, []);
    byMeal.get(mealId)!.push(item);
  }
  return rows.map((r) => ({ ...r, items: byMeal.get(r.id) ?? [] }));
}

function getMeal(userId: number, id: number): Meal | undefined {
  const row = getDb().prepare(`${SELECT_MEAL} WHERE id = ? AND user_id = ?`).get(id, userId) as unknown as
    | MealRow
    | undefined;
  return row ? withItems([row])[0] : undefined;
}

export function listMeals(userId: number, date: string): Meal[] {
  const rows = getDb()
    .prepare(`${SELECT_MEAL} WHERE user_id = ? AND date = ? ORDER BY id`)
    .all(userId, date) as unknown as MealRow[];
  return withItems(rows);
}

export function addMeal(
  userId: number,
  m: Omit<Meal, "id" | "createdAt" | "items"> & { items: MealItemInput[] }
): Meal {
  const db = getDb();
  db.exec("BEGIN");
  try {
    const res = db
      .prepare(
        `INSERT INTO meals (user_id, date, description, name, kcal, protein, fat, carbs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(userId, m.date, m.description, m.name, m.kcal, m.protein, m.fat, m.carbs);
    const mealId = Number(res.lastInsertRowid);
    const insertItem = db.prepare(
      `INSERT INTO meal_items (meal_id, position, food, grams, kcal_100, protein_100, fat_100, carbs_100)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    m.items.forEach((i, pos) =>
      insertItem.run(mealId, pos, i.food, i.grams, i.kcal100, i.protein100, i.fat100, i.carbs100)
    );
    db.exec("COMMIT");
    return getMeal(userId, mealId)!;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Changes ingredient weights and recomputes the meal totals.
 * Returns undefined if the meal isn't the user's or an item doesn't belong to it.
 */
export function updateMealItemGrams(
  userId: number,
  mealId: number,
  changes: { id: number; grams: number }[]
): Meal | undefined {
  const db = getDb();
  db.exec("BEGIN");
  try {
    const meal = getMeal(userId, mealId);
    if (!meal) {
      db.exec("ROLLBACK");
      return undefined;
    }
    const known = new Set(meal.items.map((i) => i.id));
    if (changes.some((c) => !known.has(c.id))) {
      db.exec("ROLLBACK");
      return undefined;
    }
    const upd = db.prepare(`UPDATE meal_items SET grams = ? WHERE id = ? AND meal_id = ?`);
    for (const c of changes) upd.run(c.grams, c.id, mealId);

    const items = meal.items.map((i) => ({ ...i, grams: changes.find((c) => c.id === i.id)?.grams ?? i.grams }));
    const t = sumItems(items);
    db.prepare(`UPDATE meals SET kcal = ?, protein = ?, fat = ?, carbs = ? WHERE id = ?`).run(
      t.kcal,
      t.protein,
      t.fat,
      t.carbs,
      mealId
    );
    db.exec("COMMIT");
    return getMeal(userId, mealId);
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
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
 */
export function createUser(
  username: string,
  email: string,
  passwordHash: string
): User | "username_taken" | "email_taken" {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (db.prepare(`SELECT 1 FROM users WHERE username = ?`).get(username)) {
      db.exec("ROLLBACK");
      return "username_taken";
    }
    if (db.prepare(`SELECT 1 FROM users WHERE email = ?`).get(email)) {
      db.exec("ROLLBACK");
      return "email_taken";
    }
    const res = db
      .prepare(`INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)`)
      .run(username, email, passwordHash);
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
