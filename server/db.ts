import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
export function openDatabase(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS profiles(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,username TEXT UNIQUE NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS foods(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS analyses(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,original TEXT NOT NULL,corrected TEXT,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS food_logs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,date TEXT NOT NULL,meal TEXT NOT NULL,analysis_id TEXT REFERENCES analyses(id) ON DELETE SET NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS weights(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,date TEXT NOT NULL,weight REAL NOT NULL,UNIQUE(user_id,date));
 CREATE TABLE IF NOT EXISTS workouts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,date TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS workout_exercises(id INTEGER PRIMARY KEY,workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS workout_sets(id INTEGER PRIMARY KEY,exercise_id INTEGER NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,weight REAL NOT NULL,reps INTEGER NOT NULL,rpe REAL);
 CREATE TABLE IF NOT EXISTS activity(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,date TEXT NOT NULL,steps INTEGER NOT NULL,water REAL NOT NULL,activeCalories REAL NOT NULL,PRIMARY KEY(user_id,date));
 CREATE TABLE IF NOT EXISTS saved_meals(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS favourites(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,food_id TEXT NOT NULL,PRIMARY KEY(user_id,food_id));
 CREATE INDEX IF NOT EXISTS food_logs_user_date ON food_logs(user_id,date);
 CREATE INDEX IF NOT EXISTS workouts_user_date ON workouts(user_id,date);
 CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);`);
  return db;
}
export type DB = ReturnType<typeof openDatabase>;
