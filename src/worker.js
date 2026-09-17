import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import { rmSync } from 'node:fs';
import { openState } from './database.js';
import { importKbo } from './importer.js';
import { createCrawler } from './crawler.js';

const { type, dir, jobId, config } = workerData;
const abort = new AbortController();
parentPort.on('message', message => { if (message === 'cancel') abort.abort(new Error('Taak gestopt.')); });
const db = openState(dir);
const progress = db.prepare('UPDATE jobs SET progress=?,total=?,message=? WHERE id=?');
try {
  if (type === 'import') {
    const info = await importKbo(config.zip, path.join(dir, config.catalog), { signal: abort.signal, onProgress: p => progress.run(p.progress, p.total, p.message, jobId) });
    parentPort.postMessage({ event: 'done', catalog: config.catalog, info });
  } else {
    // Demo transport exists only for explicitly launched demo instances.
    let request;
    if (config.demo) request = (await import('../test/fixtures.js')).demoRequest;
    const crawl = createCrawler(request ? { request, delayMs: 30 } : {});
    let completed = 0;
    for (const company of config.companies) {
      abort.signal.throwIfAborted();
      if (db.prepare('SELECT excluded FROM overrides WHERE company_id=?').get(company.id)?.excluded) { completed++; continue; }
      db.prepare("UPDATE scans SET status='running' WHERE company_id=?").run(company.id);
      progress.run(completed, config.companies.length, `Website lezen: ${company.name}`, jobId);
      let result;
      try {
        result = company.website ? await crawl(company.website, config.roles, { signal: abort.signal, onPage: p => progress.run(completed, config.companies.length, `${company.name} · ${p.pages} pagina’s gelezen`, jobId) }) : { status: 'no_website', emails: [], pages: 0, checked_at: new Date().toISOString(), detail: 'Voeg een eigen bedrijfswebsite toe.' };
      } catch (error) {
        if (abort.signal.aborted) throw error;
        result = { status: 'error', emails: [], pages: 0, checked_at: new Date().toISOString(), detail: error.message };
      }
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM emails WHERE company_id=?').run(company.id);
        const insert = db.prepare('INSERT OR IGNORE INTO emails VALUES (?,?,?,?)');
        for (const email of result.emails) insert.run(company.id, email.email, email.source_url, result.checked_at);
        db.prepare('UPDATE scans SET status=?,detail=?,checked_at=?,pages=? WHERE company_id=?').run(result.status, result.detail, result.checked_at, result.pages, company.id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      progress.run(++completed, config.companies.length, `${completed} van ${config.companies.length} bedrijven verwerkt`, jobId);
    }
    parentPort.postMessage({ event: 'done' });
  }
} catch (error) {
  parentPort.postMessage({ event: 'failed', cancelled: abort.signal.aborted, message: error.message });
} finally {
  if (type === 'import') rmSync(config.zip, { force: true });
  db.close(); parentPort.close();
}
