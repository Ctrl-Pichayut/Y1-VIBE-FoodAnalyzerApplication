/**
 * Offline SQLite Cache Service (Part 2.5)
 * Uses expo-sqlite to persist API responses (profile, daily summary, weekly report,
 * meal history, and food catalog) for instant offline access and cold-start resilience.
 * Falls back gracefully to an in-memory Map if SQLite is unavailable (e.g. web).
 */
import * as SQLite from 'expo-sqlite';

const memoryFallback = new Map<string, string>();
let dbInstance: SQLite.SQLiteDatabase | null = null;
let dbInitialized = false;

function getDb(): SQLite.SQLiteDatabase | null {
  if (dbInitialized) return dbInstance;
  dbInitialized = true;
  try {
    dbInstance = SQLite.openDatabaseSync('foodanalyzer_cache.db');
    dbInstance.execSync(`
      CREATE TABLE IF NOT EXISTS kv_cache (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pending_meals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  } catch {
    dbInstance = null;
  }
  return dbInstance;
}

export function setCache<T>(key: string, data: T): void {
  const serialized = JSON.stringify(data);
  memoryFallback.set(key, serialized);
  const db = getDb();
  if (!db) return;
  try {
    db.runSync(
      'INSERT OR REPLACE INTO kv_cache (key, value, updated_at) VALUES (?, ?, ?)',
      [key, serialized, Date.now()]
    );
  } catch {
    // Ignore SQLite write errors
  }
}

export function getCache<T>(key: string): T | null {
  const db = getDb();
  if (db) {
    try {
      const row = db.getFirstSync<{ value: string }>(
        'SELECT value FROM kv_cache WHERE key = ?',
        [key]
      );
      if (row && row.value) {
        return JSON.parse(row.value) as T;
      }
    } catch {
      // Fall through to memory cache
    }
  }
  const mem = memoryFallback.get(key);
  if (mem) {
    try {
      return JSON.parse(mem) as T;
    } catch {
      return null;
    }
  }
  return null;
}

export function clearUserCache(): void {
  const userKeys = ['profile', 'daily_summary', 'weekly_report', 'history_page_1'];
  userKeys.forEach((k) => memoryFallback.delete(k));
  const db = getDb();
  if (!db) return;
  try {
    db.runSync(
      "DELETE FROM kv_cache WHERE key IN ('profile', 'daily_summary', 'weekly_report', 'history_page_1')"
    );
    db.runSync('DELETE FROM pending_meals');
  } catch {
    // Ignore
  }
}
