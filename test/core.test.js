import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT, DEFAULT_SETTINGS } from '../src/config.js';
import { resolveRegion } from '../src/geography.js';
import { importKbo } from '../src/importer.js';
import { LeadService, toCsv, validateSettings } from '../src/service.js';
import { createApp } from '../src/server.js';
import { extractPage, createCrawler } from '../src/crawler.js';
import { normalizeWebsite, publicAddress } from '../src/web.js';
import { writeFixture } from './fixtures.js';
import { setTimeout as sleep } from 'node:timers/promises';

function temporary(t) {
  const root = path.join(ROOT, 'test-output'); mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(path.join(root, 'case-'));
  return dir;
}
function clean(dir) {
  if (!path.resolve(dir).startsWith(path.join(ROOT, 'test-output') + path.sep)) throw new Error('Unsafe cleanup path');
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
async function catalog(t) {
  const dir = temporary(t), name = `catalog-${randomUUID()}.sqlite`;
  const zip = writeFixture(path.join(dir, 'fixture.zip'));
  const info = await importKbo(zip, path.join(dir, name));
  const service = new LeadService(dir); service.activate(name);
  t.after(() => { service.close(); clean(dir); });
  return { dir, service, info };
}
test('Statbel: provincies, Brussel, fusiegemeenten, onbekende en buitenlandse locaties', () => {
  assert.equal(resolveRegion({ MunicipalityNL: 'Antwerpen', MunicipalityFR: 'Anvers' }).region, 'antwerpen');
  assert.equal(resolveRegion({ MunicipalityFR: 'Bruxelles' }).region, 'brussel');
  assert.equal(resolveRegion({ MunicipalityNL: 'Hasselt' }).region, 'limburg');
  assert.equal(resolveRegion({ MunicipalityNL: 'Beveren-Kruibeke-Zwijndrecht' }).region, 'oost-vlaanderen');
  assert.equal(resolveRegion({ MunicipalityNL: 'Zwijndrecht' }).region, null, 'Een oude gemeentenaam mag niet de oude provincie toekennen');
  assert.equal(resolveRegion({ MunicipalityNL: 'Bestaat niet' }).region, null);
  assert.equal(resolveRegion({ MunicipalityNL: 'Gent', CountryNL: 'Nederland' }).region, 'outside');
  assert.equal(resolveRegion({ MunicipalityNL: 'Gent', MunicipalityFR: 'Anvers' }).region, null);
});
test('KBO import en selectie: rechtspersonen, hoofdactiviteit, vestiging en ontbrekende website', async t => {
  const { service, info } = await catalog(t);
  assert.equal(info.companies, 10);
  const rows = service.list().rows, ids = rows.map(c => c.id);
  assert.equal(rows.length, 7);
  assert(ids.includes('0200000011'), 'Vestiging Mechelen telt ondanks zetel in Limburg');
  assert(!ids.includes('0200000005'), 'Limburg standaard uitgesloten');
  assert(!ids.includes('0200000007'), 'Nevenactiviteit en NACE 2008 tellen niet');
  assert(!service.company('0200000006'), 'Natuurlijk persoon niet opgeslagen');
  assert(!service.company('0200000012'), 'Maatschap zonder rechtspersoonlijkheid niet opgenomen');
  assert.equal(service.company('0200000003').status, 'no_website');
  assert(service.company('0200000008').regionUnknown);
  assert(service.list({ view: 'review' }).rows.some(c => c.id === '0200000008'));
  assert.equal(service.db.prepare('SELECT count(*) n FROM emails').get().n, 0, 'KBO-e-mails zijn nooit geïmporteerd');
  assert(service.searchCodes('dak').some(c => c.code === '43410'));
  assert(service.searchCodes('dakwerken').some(c => c.code === '43410'));
  assert(service.searchCodes('couverture').some(c => c.code === '43410'));
  assert.equal(service.list({ regions: ['limburg'], includeUnknown: false }).rows.length, 1);
});
test('Mislukte, onvolledige en update-imports laten vorige dataset intact', async t => {
  const { service, dir } = await catalog(t);
  const previous = service.catalogId;
  for (const mutate of [files => { delete files['activity.csv']; return files; }, files => { files['meta.csv'] = files['meta.csv'].replace('FULL', 'UPDATE'); return files; }, files => { files['activity.csv'] = files['activity.csv'].replace('NaceVersion', 'BrokenHeader'); return files; }]) {
    const zip = writeFixture(path.join(dir, 'invalid.zip'), {}, mutate), failed = path.join(dir, `catalog-${randomUUID()}.sqlite`);
    await assert.rejects(importKbo(zip, failed));
    assert(!existsSync(failed)); assert.equal(service.catalogId, previous); assert.equal(service.list().rows.length, 7);
  }
});

test('Automatische selectie respecteert filters, websites, uitsluitingen, voortgang en limiet 100', async t => {
  const { service } = await catalog(t);
  assert.equal(service.automaticCandidates().length, 6);
  assert.deepEqual(service.automaticCandidates('Atlas'), ['0200000001']);
  service.updateCompany('0200000001', { excluded: true });
  service.db.prepare('INSERT INTO scans(company_id,catalog_id,status) VALUES (?,?,?)').run('0200000002', service.catalogId, 'no_email');
  service.db.prepare('INSERT INTO scans(company_id,catalog_id,status) VALUES (?,?,?)').run('0200000004', service.catalogId, 'blocked');
  assert.equal(service.automaticCandidates().length, 3);
  service.updateCompany('0200000002', { website: 'https://brik.example' });
  assert(service.automaticCandidates().includes('0200000002'), 'Gewijzigde website mag opnieuw worden gescand');
  service.db.prepare("UPDATE scans SET status='interrupted' WHERE company_id=?").run('0200000004');
  assert(service.automaticCandidates().includes('0200000004'), 'Onderbroken scan mag opnieuw mee');
  service.saveSettings({ ...service.settings(), regions: ['limburg'], includeUnknown: false });
  assert.deepEqual(service.automaticCandidates(), ['0200000005']);
  service.saveSettings(DEFAULT_SETTINGS);
  service.db.exec('BEGIN');
  for (let i = 0; i < 110; i++) {
    const id = `test-${i}`;
    service.db.prepare('INSERT INTO catalog.companies(id,name,form) VALUES (?,?,?)').run(id, `Extra ${i}`, '610');
    service.db.prepare('INSERT INTO catalog.establishments(id,company_id,region) VALUES (?,?,?)').run(id, id, 'antwerpen');
    service.db.prepare('INSERT INTO catalog.activities VALUES (?,?,?)').run(id, id, '41000');
    service.db.prepare('INSERT INTO catalog.websites VALUES (?,?,?)').run(id, id, `https://bedrijf${i}.be/`);
  }
  service.db.exec('COMMIT');
  assert.equal(service.automaticCandidates().length, 100);
});
test('HTML-extractie: rolmailboxen, domeingrens, mailto, verborgen tekst en obfuscatie', () => {
  const html = `<html><head><script>info@voorbeeld.be</script></head><body><p>Info [at] voorbeeld [dot] be</p><a href="mailto:CONTACT@voorbeeld.be?subject=Hallo">Mail</a><span>offerte@voorbeeld.be</span><span>Nu aanvragen</span><p>jan@voorbeeld.be info@gmail.com info@vreemd.be info@voorbeeld.be.evil.com</p><div hidden>sales@voorbeeld.be</div><style>office@voorbeeld.be</style></body></html>`;
  const result = extractPage(html, 'https://www.voorbeeld.be/contact', DEFAULT_SETTINGS.roles);
  assert.deepEqual(result.emails.sort(), ['contact@voorbeeld.be', 'info@voorbeeld.be', 'offerte@voorbeeld.be']);
});
test('Crawler respecteert robots, Crawl-delay, domein en deduplicatie', async () => {
  let now = 1000; const calls = [];
  const request = async url => {
    calls.push({ url, at: now });
    const p = new URL(url).pathname;
    if (p === '/robots.txt') return { status: 200, contentType: 'text/plain', body: 'User-agent: VindbaarBot\nDisallow: /prive\nCrawl-delay: 2' };
    return { status: 200, contentType: 'text/html', body: `<a href="/contact">Contact</a><a href="/prive">Prive</a><a href="https://ander.be">Contact</a><p>info@voorbeeld.be</p>` };
  };
  const crawl = createCrawler({ request, delayMs: 0, now: () => now, wait: async ms => { now += ms; } });
  const result = await crawl('https://voorbeeld.be', ['info']);
  assert.equal(result.status, 'found'); assert.equal(result.emails.length, 1);
  assert(!calls.some(c => c.url.includes('/prive') || c.url.includes('ander.be')));
  assert(calls[1].at - calls[0].at >= 2000);
  assert(calls[2].at - calls[1].at >= 2000);
});
test('Crawler stopt bij robots-blokkade, quotum, ontoegankelijke robots en externe redirects', async () => {
  const cases = [
    [{ status: 200, contentType: 'text/plain', body: 'User-agent: *\nDisallow: /' }, null, 'blocked'],
    [{ status: 503, body: '', contentType: 'text/plain' }, null, 'blocked'],
    [{ status: 404, body: '', contentType: 'text/plain' }, { status: 429, body: '', contentType: 'text/html' }, 'blocked'],
    [{ status: 404, body: '', contentType: 'text/plain' }, { status: 301, location: 'https://ander.be', body: '', contentType: 'text/html' }, 'error'],
  ];
  for (const [robots, page, status] of cases) {
    const calls = [];
    const crawl = createCrawler({ delayMs: 0, request: async url => { calls.push(url); return new URL(url).pathname === '/robots.txt' ? robots : page; } });
    const result = await crawl('https://voorbeeld.be', ['info']); assert.equal(result.status, status); assert.equal(result.emails.length, 0);
    assert(!calls.some(url => url.includes('ander.be')));
    if (!page) assert.equal(calls.length, 1);
  }
});
test('Crawler blijft binnen homepage plus tien HTML-pagina’s', async () => {
  const crawl = createCrawler({ delayMs: 0, request: async url => new URL(url).pathname === '/robots.txt' ? { status: 404, body: '', contentType: 'text/plain' } : { status: 200, contentType: 'text/html', body: Array.from({ length: 30 }, (_, i) => `<a href="/contact-${i}">Contact</a>`).join('') } });
  assert.equal((await crawl('https://voorbeeld.be', ['info'])).pages, 11);
});
test('Lokale netwerkadressen, onveilige URL’s en ongeldige instellingen worden geweigerd', () => {
  for (const addr of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1', '100.64.0.1']) assert.equal(publicAddress(addr), false);
  assert.equal(publicAddress('1.1.1.1'), true);
  for (const url of ['file:///C:/windows', 'http://127.0.0.1', 'http://localhost', 'http://company.local', 'http://user:pass@company.be', 'https://company.be:3000', 'https://facebook.com/company']) assert.throws(() => normalizeWebsite(url));
  assert.equal(normalizeWebsite('www.voorbeeld.be'), 'https://www.voorbeeld.be/');
  assert.throws(() => validateSettings({ ...DEFAULT_SETTINGS, regions: [] }));
  assert.throws(() => validateSettings({ ...DEFAULT_SETTINGS, sectors: ['41;DROP'] }));
  assert.throws(() => validateSettings({ ...DEFAULT_SETTINGS, roles: ['person@company.be'] }));
});
test('CSV bevat BOM, puntkomma, correcte quotes en bescherming tegen formules', () => {
  const csv = toCsv([{ company: '=HYPERLINK("x")', email: 'info@company.be' }]);
  assert(csv.startsWith('\uFEFF')); assert(csv.includes('"\'=HYPERLINK(""x"")"')); assert(csv.includes(';')); assert(csv.endsWith('\r\n'));
});
test('Volledige app: upload, achtergrondscan, regiocontrole, export, uitsluiten en herimport', async t => {
  const dir = temporary(t), state = createApp({ dir, demo: true });
  t.after(async () => { await state.app.close(); clean(dir); });
  const file = `catalog-${randomUUID()}.sqlite`;
  await importKbo(writeFixture(path.join(dir, 'fixture.zip'), { demo: true }), path.join(dir, file)); state.service.activate(file);
  const bootstrap = (await state.app.inject({ url: '/api/bootstrap' })).json();
  const headers = { 'x-vindbaar-token': bootstrap.token };
  const post = (url, payload) => state.app.inject({ method: 'POST', url, payload, headers });
  assert.equal((await state.app.inject({ method: 'POST', url: '/api/scans', payload: { ids: ['0200000001'] } })).statusCode, 403);
  assert.equal((await state.app.inject({ url: '/api/bootstrap', headers: { host: 'evil.example' } })).statusCode, 403);
  assert.equal((await post('/api/scans', { ids: Array(101).fill('0200000001') })).statusCode, 400);
  assert.equal((await post('/api/scans', { ids: ['0200000006'] })).statusCode, 400);
  const start = await post('/api/scans', { ids: ['0200000001', '0200000002', '0200000004', '0200000008'] }); assert.equal(start.statusCode, 200, start.body);
  for (let i = 0; i < 200 && state.busy; i++) await sleep(30);
  assert.equal(state.busy, false);
  assert.equal(state.service.company('0200000001').status, 'found');
  assert.equal(state.service.company('0200000002').status, 'no_email');
  assert.equal(state.service.company('0200000004').status, 'blocked');
  assert.equal(state.service.company('0200000008').status, 'review');
  assert.equal(state.service.exportRows().length, 2, 'Alleen bevestigde Atlas-adressen, geen onbekende regio');
  await post('/api/companies/0200000008', { region: 'antwerpen' });
  assert.equal(state.service.exportRows().length, 4);
  // Repeated scan replaces observations rather than appending duplicate mailboxes.
  await post('/api/scans', { ids: ['0200000001'] });
  for (let i = 0; i < 200 && state.busy; i++) await sleep(30);
  assert.equal(state.service.exportRows().length, 4);
  await post('/api/companies/0200000001', { excluded: true });
  assert.equal(state.service.exportRows().length, 2);
  const csv = await state.app.inject({ url: '/api/export' }); assert.equal(csv.statusCode, 200); assert(!csv.body.includes('atlasbouw')); assert(csv.body.includes('locatiebouw'));
  await post('/api/companies/0200000008', { website: 'https://nieuwewebsite.be' });
  assert.equal(state.service.exportRows().length, 0, 'Websitewijziging vereist nieuwe scan');
  const next = `catalog-${randomUUID()}.sqlite`; await importKbo(path.join(dir, 'fixture.zip'), path.join(dir, next)); state.service.activate(next);
  assert.equal(state.service.company('0200000008').regionOverride, null, 'Nieuwe dataset vraagt herbevestiging van onbekende regio');
  const auto = await post('/api/scans', { automatic: true, q: 'Westhaven' });
  assert.equal(auto.statusCode, 200, auto.body); assert.equal(auto.json().count, 1);
  for (let i = 0; i < 200 && state.busy; i++) await sleep(30);
  assert.equal(state.service.company('0200000010').status, 'found');
  const again = await post('/api/scans', { automatic: true, q: 'Westhaven' });
  assert.equal(again.statusCode, 400, 'Automatische actie slaat reeds afgewerkte bedrijven over');
});
test('Echte uploadroute activeert alleen succesvolle KBO-imports', async t => {
  const dir = temporary(t), state = createApp({ dir });
  t.after(async () => { await state.app.close(); clean(dir); });
  const token = (await state.app.inject({ url: '/api/bootstrap' })).json().token;
  const upload = async file => state.app.inject({ method: 'POST', url: '/api/import', headers: { 'content-type': 'application/zip', 'x-vindbaar-token': token }, payload: readFileSync(file) });
  const response = await upload(writeFixture(path.join(dir, 'valid.zip')));
  assert.equal(response.statusCode, 200, response.body);
  for (let i = 0; i < 200 && state.busy; i++) await sleep(30);
  assert(state.service.catalogId);
  const prior = state.service.catalogId;
  const invalid = writeFixture(path.join(dir, 'invalid.zip'), {}, files => { delete files['address.csv']; return files; });
  assert.equal((await upload(invalid)).statusCode, 200);
  for (let i = 0; i < 200 && state.busy; i++) await sleep(30);
  assert.equal(state.service.catalogId, prior);
  assert.equal(state.service.summary().jobs[0].status, 'failed');
});
test('Export dedupliceert gedeelde mailboxen tussen bedrijven', async t => {
  const { service } = await catalog(t);
  const now = new Date().toISOString();
  service.updateCompany('0200000010', { website: 'https://atlasbouw.example' });
  for (const id of ['0200000001', '0200000010']) {
    service.db.prepare('INSERT INTO scans(company_id,catalog_id,status) VALUES (?,?,?)').run(id, service.catalogId, 'found');
    service.db.prepare('INSERT INTO emails VALUES (?,?,?,?)').run(id, 'info@atlasbouw.example', 'https://atlasbouw.example/contact', now);
  }
  assert.equal(service.exportRows().length, 1);
});
