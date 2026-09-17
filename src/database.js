import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS } from './config.js';

export function openState(dir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'state.sqlite'), { timeout: 10000 });
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS overrides(company_id TEXT PRIMARY KEY, website TEXT, excluded INTEGER NOT NULL DEFAULT 0, region TEXT, region_catalog TEXT);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT, progress INTEGER DEFAULT 0, total INTEGER DEFAULT 0, message TEXT, config TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS scans(company_id TEXT PRIMARY KEY, job_id TEXT, catalog_id TEXT, status TEXT NOT NULL, detail TEXT, checked_at TEXT, pages INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS emails(company_id TEXT NOT NULL, email TEXT NOT NULL, source_url TEXT NOT NULL, checked_at TEXT NOT NULL, PRIMARY KEY(company_id,email));
  `);
  db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('settings', JSON.stringify(DEFAULT_SETTINGS));
  return db;
}
export function getMeta(db, key) { return db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value; }
export function setMeta(db, key, value) { db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value)); }
export function makeCatalog(file) {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=NORMAL;
    CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE companies(id TEXT PRIMARY KEY,name TEXT NOT NULL DEFAULT '',form TEXT);
    CREATE TABLE establishments(id TEXT PRIMARY KEY,company_id TEXT NOT NULL,city TEXT DEFAULT '',postcode TEXT DEFAULT '',country TEXT DEFAULT 'BE',region TEXT,nis TEXT);
    CREATE INDEX establishment_company ON establishments(company_id);
    CREATE INDEX establishment_region ON establishments(region,company_id);
    CREATE TABLE activities(company_id TEXT NOT NULL,entity_id TEXT NOT NULL,code TEXT NOT NULL,PRIMARY KEY(entity_id,code));
    CREATE INDEX activity_company ON activities(company_id,code);
    CREATE INDEX activity_code ON activities(code,company_id);
    CREATE TABLE websites(company_id TEXT NOT NULL,entity_id TEXT NOT NULL,url TEXT NOT NULL,PRIMARY KEY(entity_id,url));
    CREATE INDEX website_company ON websites(company_id);
    CREATE TABLE codes(category TEXT NOT NULL,code TEXT NOT NULL,language TEXT NOT NULL,description TEXT NOT NULL,PRIMARY KEY(category,code,language));
  `);
  return db;
}
