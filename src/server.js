import Fastify from 'fastify';
import { readFileSync, createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { Worker } from 'node:worker_threads';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DATA_DIR, ROOT, REGIONS } from './config.js';
import { LeadService, toCsv } from './service.js';

export function createApp({ dir = DATA_DIR, demo = false } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024, requestTimeout: 0 });
  const service = new LeadService(dir), token = randomBytes(32).toString('hex');
  let active = null, closing = false;
  service.db.prepare("UPDATE jobs SET status='interrupted',finished_at=?,message='App werd afgesloten; start de taak opnieuw.' WHERE status IN ('running','uploading')").run(new Date().toISOString());
  service.db.exec("UPDATE scans SET status='interrupted',detail='Scan onderbroken; scan dit bedrijf opnieuw.' WHERE status IN ('running','queued')");
  const finishJob = (id, status, message) => service.db.prepare('UPDATE jobs SET status=?,finished_at=?,message=? WHERE id=?').run(status, new Date().toISOString(), message, id);
  const newJob = (type, config, status = 'running') => {
    const id = randomUUID();
    service.db.prepare('INSERT INTO jobs(id,type,status,created_at,config,message) VALUES (?,?,?,?,?,?)').run(id, type, status, new Date().toISOString(), JSON.stringify(config), type === 'import' ? 'KBO-bestand ontvangen' : 'Scan voorbereiden');
    return id;
  };
  function launch(type, id, config) {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { workerData: { type, dir, jobId: id, config } });
    active = { id, worker, type };
    let finished = false;
    function settle(status, message, result) {
      if (finished || closing) return;
      finished = true;
      try {
        if (result?.catalog) service.activate(result.catalog);
        finishJob(id, status, message);
        service.db.prepare("UPDATE scans SET status='interrupted',detail='Niet afgewerkt; scan opnieuw.' WHERE job_id=? AND status IN ('queued','running')").run(id);
      } catch (error) { finishJob(id, 'failed', error.message); }
      finally { if (active?.id === id) active = null; }
    }
    worker.on('message', message => {
      if (message.event === 'done') settle('completed', type === 'import' ? `${message.info.companies.toLocaleString('nl-BE')} rechtspersonen geïmporteerd` : 'Scan afgerond', message);
      if (message.event === 'failed') settle(message.cancelled ? 'cancelled' : 'failed', message.message);
    });
    worker.on('error', error => settle('failed', error.message));
    worker.on('exit', code => { if (!finished) settle('failed', `Achtergrondtaak onverwacht gestopt (${code}).`); });
    return id;
  }
  app.addHook('onRequest', async (req, reply) => {
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return reply.code(403).send({ error: 'Deze app is alleen lokaal bereikbaar.' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}`) return reply.code(403).send({ error: 'Verzoek van een andere website geweigerd.' });
    if (!['GET', 'HEAD'].includes(req.method)) {
      const received = Buffer.from(String(req.headers['x-vindbaar-token'] || ''));
      const expected = Buffer.from(token);
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) return reply.code(403).send({ error: 'Herlaad de app om deze actie uit te voeren.' });
    }
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  });
  app.setErrorHandler((error, _req, reply) => reply.code(error.statusCode && error.statusCode >= 400 ? error.statusCode : 400).send({ error: error.message }));
  const failBusy = () => { if (active) { const e = new Error('Wacht tot de actieve taak klaar is of stop de scan eerst.'); e.statusCode = 409; throw e; } };
  const publicFiles = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'application/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
  for (const [route, [file, mime]] of Object.entries(publicFiles)) app.get(route, async (_req, reply) => reply.type(mime).send(readFileSync(path.join(ROOT, 'public', file))));
  app.get('/api/bootstrap', async () => ({ token, regions: REGIONS, settings: service.settings(), summary: service.summary(), demo }));
  app.get('/api/status', async () => ({ ...service.summary(), busy: Boolean(active) }));
  app.get('/api/sectors', async req => service.searchCodes(String(req.query.q || '').slice(0, 200)));
  function queryOptions(req) {
    const view = ['companies', 'results', 'review', 'excluded'].includes(req.query.view) ? req.query.view : 'companies';
    return { view, q: String(req.query.q || '').slice(0, 200), page: Math.max(1, Math.floor(Number(req.query.page) || 1)) };
  }
  app.get('/api/companies', async req => service.list(queryOptions(req)));
  app.post('/api/settings', async req => { failBusy(); return service.saveSettings(req.body); });
  app.get('/api/companies/:id', async (req, reply) => service.company(req.params.id) || reply.code(404).send({ error: 'Bedrijf niet gevonden.' }));
  app.post('/api/companies/:id', async req => { failBusy(); return service.updateCompany(req.params.id, req.body); });
  app.get('/api/export', async (req, reply) => {
    const rows = service.exportRows(queryOptions(req));
    return reply.header('Content-Disposition', `attachment; filename="vindbaar${demo ? '-DEMO' : ''}-${new Date().toISOString().slice(0, 10)}.csv"`).type('text/csv; charset=utf-8').send(toCsv(rows));
  });
  app.post('/api/scans', async req => {
    failBusy();
    if (!service.catalogId) throw new Error('Importeer eerst een volledig KBO-bestand.');
    const automatic = req.body?.automatic === true;
    const ids = automatic ? service.automaticCandidates(String(req.body.q || '').slice(0, 200)) : req.body?.ids;
    if (automatic && !ids.length) throw new Error('Geen nieuwe bedrijven met een website binnen deze filters. Pas je doelgroep aan of scan een bestaand resultaat handmatig opnieuw.');
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(x => typeof x !== 'string')) throw new Error('Selecteer 1 tot 100 bedrijven.');
    const settings = service.settings();
    const companies = [...new Set(ids)].map(id => service.company(id));
    for (const c of companies) {
      if (!c || c.excluded || !c.activities.length || (!c.matchedLocations.length && !settings.regions.includes(c.regionOverride) && !(settings.includeUnknown && c.locations.some(l => !l.region)))) throw new Error('Een geselecteerd bedrijf valt buiten de huidige filters. Vernieuw de lijst.');
    }
    const config = { companies: companies.map(({ id, name, website }) => ({ id, name, website })), roles: settings.roles, catalog: service.catalogId, demo };
    const id = newJob('scan', config);
    service.db.exec('BEGIN');
    try {
      const insert = service.db.prepare("INSERT INTO scans(company_id,job_id,catalog_id,status,detail) VALUES (?,?,?,'queued','Wacht op scan') ON CONFLICT(company_id) DO UPDATE SET job_id=excluded.job_id,catalog_id=excluded.catalog_id,status='queued',detail='Wacht op scan'");
      for (const c of companies) insert.run(c.id, id, service.catalogId);
      service.db.exec('COMMIT');
    } catch (error) { service.db.exec('ROLLBACK'); throw error; }
    launch('scan', id, config);
    return { id, count: companies.length };
  });
  app.post('/api/jobs/:id/cancel', async req => {
    if (!active || active.id !== req.params.id || !active.worker) throw new Error('Geen lopende achtergrondtaak gevonden.');
    active.worker.postMessage('cancel');
    service.db.prepare("UPDATE jobs SET message='Taak wordt gestopt…' WHERE id=?").run(active.id);
    return { ok: true };
  });
  app.addContentTypeParser('application/zip', (_req, stream, done) => done(null, stream));
  app.post('/api/import', { bodyLimit: 4 * 1024 ** 3 }, async req => {
    failBusy();
    if (demo) throw new Error('Open de gewone app om je eigen KBO-bestand te importeren.');
    if (!req.body?.pipe) throw new Error('Upload een ZIP-bestand.');
    const id = newJob('import', {}, 'uploading');
    active = { id, type: 'import' };
    const uploadDir = path.join(dir, 'uploads'); mkdirSync(uploadDir, { recursive: true });
    const zip = path.join(uploadDir, `${id}.zip`), catalog = `catalog-${id}.sqlite`;
    let size = 0, last = 0;
    try {
      const limit = new Transform({ transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > 4 * 1024 ** 3) return callback(new Error('Het ZIP-bestand is groter dan 4 GB.'));
        if (Date.now() - last > 1000) { last = Date.now(); service.db.prepare('UPDATE jobs SET message=? WHERE id=?').run(`${Math.round(size / 1024 ** 2)} MB ontvangen`, id); }
        callback(null, chunk);
      } });
      await pipeline(req.body, limit, createWriteStream(zip, { flags: 'wx' }));
      service.db.prepare("UPDATE jobs SET status='running',config=? WHERE id=?").run(JSON.stringify({ zip, catalog }), id);
      launch('import', id, { zip, catalog });
      return { id };
    } catch (error) { active = null; rmSync(zip, { force: true }); finishJob(id, 'failed', error.message); throw error; }
  });
  app.addHook('onClose', async () => {
    closing = true;
    if (active?.worker) { active.worker.postMessage('cancel'); await active.worker.terminate(); }
    service.close();
  });
  return { app, service, get busy() { return Boolean(active); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { app } = createApp();
  const port = Number(process.env.PORT || 3210);
  await app.listen({ port, host: '127.0.0.1' });
  console.log(`Vindbaar is gestart: http://127.0.0.1:${port}`);
  const stop = async () => { await app.close(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
