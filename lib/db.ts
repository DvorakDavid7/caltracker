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

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "caltracker.db");

// Reuse one connection across hot reloads in dev.
const globalForDb = globalThis as unknown as { __caltrackerDb?: DatabaseSync };

function getDb(): DatabaseSync {
  if (!globalForDb.__caltrackerDb) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new DatabaseSync(DB_PATH);
    db.exec(`
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
      CREATE INDEX IF NOT EXISTS meals_date_idx ON meals(date);
    `);
    globalForDb.__caltrackerDb = db;
  }
  return globalForDb.__caltrackerDb;
}

const SELECT = `SELECT id, date, description, name, kcal, protein, fat, carbs, created_at AS createdAt FROM meals`;

export function listMeals(date: string): Meal[] {
  return getDb().prepare(`${SELECT} WHERE date = ? ORDER BY id`).all(date) as unknown as Meal[];
}

export function addMeal(m: Omit<Meal, "id" | "createdAt">): Meal {
  const db = getDb();
  const res = db
    .prepare(
      `INSERT INTO meals (date, description, name, kcal, protein, fat, carbs) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(m.date, m.description, m.name, m.kcal, m.protein, m.fat, m.carbs);
  return db.prepare(`${SELECT} WHERE id = ?`).get(res.lastInsertRowid) as unknown as Meal;
}

export function deleteMeal(id: number): boolean {
  return getDb().prepare(`DELETE FROM meals WHERE id = ?`).run(id).changes > 0;
}
