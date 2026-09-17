import { existsSync } from 'node:fs';
import path from 'node:path';
import { openState, getMeta, setMeta } from './database.js';
import { DEFAULT_SETTINGS, REGIONS, REGION_IDS } from './config.js';
import { normalize } from './geography.js';
import { normalizeWebsite, domainOf } from './web.js';

export function validateSettings(input) {
  if (!input || !Array.isArray(input.regions) || !input.regions.length || input.regions.some(r => !REGION_IDS.has(r))) throw new Error('Kies minstens één geldige regio.');
  if (!Array.isArray(input.sectors) || !input.sectors.length || input.sectors.length > 100 || input.sectors.some(s => !/^\d{2,7}$/.test(s))) throw new Error('Kies minstens één sectorcode.');
  if (!Array.isArray(input.roles) || !input.roles.length || input.roles.length > 100 || input.roles.some(r => !/^[a-z][a-z0-9._-]{0,40}$/.test(r))) throw new Error('Gebruik mailboxnamen zonder @ of domein, bijvoorbeeld info en contact.');
  return { regions: [...new Set(input.regions)], sectors: [...new Set(input.sectors)], roles: [...new Set(input.roles)], includeUnknown: Boolean(input.includeUnknown) };
}
export class LeadService {
  constructor(dir) {
    this.dir = dir; this.db = openState(dir); this.catalogId = null;
    const current = getMeta(this.db, 'catalog');
    if (current && existsSync(path.join(dir, path.basename(current)))) this.activate(current, false);
  }
  activate(filename, save = true) {
    if (filename !== path.basename(filename) || !/^catalog-[\w-]+\.sqlite$/.test(filename)) throw new Error('Ongeldige catalogus.');
    if (this.catalogId) this.db.exec('DETACH DATABASE catalog');
    this.db.prepare('ATTACH DATABASE ? AS catalog').run(path.join(this.dir, filename));
    this.catalogId = filename;
    if (save) setMeta(this.db, 'catalog', filename);
    this.codes = this.db.prepare("SELECT code, language, description FROM catalog.codes WHERE category='nace2025' AND language IN ('NL','FR') ORDER BY code,language DESC").all();
  }
  settings() { return JSON.parse(getMeta(this.db, 'settings') || JSON.stringify(DEFAULT_SETTINGS)); }
  saveSettings(input) { const settings = validateSettings(input); setMeta(this.db, 'settings', JSON.stringify(settings)); return settings; }
  summary() {
    const jobs = this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 8').all().map(j => ({ ...j, config: undefined }));
    if (!this.catalogId) return { catalog: null, companies: 0, scanned: 0, emails: 0, jobs };
    const meta = Object.fromEntries(this.db.prepare('SELECT * FROM catalog.meta').all().map(r => [r.key, r.value]));
    return {
      catalog: { id: this.catalogId, date: meta.SnapshotDate, imported: meta.ExtractTimestamp, demo: meta.Demo === '1' },
      companies: this.db.prepare('SELECT count(*) n FROM catalog.companies').get().n,
      scanned: this.db.prepare("SELECT count(*) n FROM scans s JOIN catalog.companies c ON c.id=s.company_id WHERE catalog_id=? AND s.status NOT IN ('queued','running')").get(this.catalogId).n,
      emails: this.db.prepare("SELECT count(DISTINCT e.email) n FROM emails e JOIN scans s ON s.company_id=e.company_id JOIN catalog.companies c ON c.id=e.company_id LEFT JOIN overrides o ON o.company_id=e.company_id WHERE s.catalog_id=? AND s.status='found' AND coalesce(o.excluded,0)=0").get(this.catalogId).n,
      jobs,
    };
  }
  searchCodes(term = '') {
    const query = normalize(term);
    const aliases = [
      [/^dak(werk|dekker)/, ['dak', 'couverture']], [/^elektricien/, ['elektrotechn', 'elektrischeinstallatie']],
      [/^(loodgieter|sanitair)/, ['loodgieter', 'sanitaire', 'sanitair']], [/^schilder/, ['schilder']],
      [/^aannemer/, ['bouwvan', 'algemenebouw']], [/^boekhoud/, ['boekhoud']], [/^horeca/, ['restaurant', 'hotel', 'cafe', 'drinkgelegen']],
    ];
    const terms = [query, ...(aliases.find(([pattern]) => pattern.test(query))?.[1] || [])];
    const defaults = [{ code: '41', description: 'Bouw van gebouwen' }, { code: '42', description: 'Weg- en waterbouw' }, { code: '43', description: 'Gespecialiseerde bouwwerkzaamheden' }];
    const map = new Map(defaults.map(c => [c.code, { ...c, search: normalize(`${c.code} ${c.description} bouw bouwnijverheid construction`) }]));
    for (const c of this.codes || []) {
      const existing = map.get(c.code);
      if (!existing) map.set(c.code, { code: c.code, description: c.description, search: normalize(`${c.code} ${c.description}`) });
      else { existing.search += normalize(c.description); if (c.language === 'NL') existing.description = c.description; }
    }
    return [...map.values()].filter(c => !query || terms.some(t => c.search.includes(t))).slice(0, 80).map(({ search, ...c }) => c);
  }
  filters(options = {}) {
    const settings = validateSettings({ ...this.settings(), ...options });
    const params = [], where = [];
    where.push(`c.id IN (SELECT company_id FROM catalog.activities WHERE ${settings.sectors.map(() => 'code GLOB ?').join(' OR ')})`);
    params.push(...settings.sectors.map(s => `${s}*`));
    const marks = settings.regions.map(() => '?').join(',');
    const geo = [`EXISTS (SELECT 1 FROM catalog.establishments e WHERE e.company_id=c.id AND e.region IN (${marks}))`, `(o.region_catalog=? AND o.region IN (${marks}))`];
    params.push(...settings.regions, this.catalogId, ...settings.regions);
    if (settings.includeUnknown) geo.push('EXISTS (SELECT 1 FROM catalog.establishments e WHERE e.company_id=c.id AND e.region IS NULL)');
    where.push(`(${geo.join(' OR ')})`);
    if (options.view === 'excluded') where.push('coalesce(o.excluded,0)=1'); else where.push('coalesce(o.excluded,0)=0');
    if (options.view === 'results') where.push('s.company_id IS NOT NULL');
    if (options.view === 'review') {
      where.push(`(NOT (EXISTS (SELECT 1 FROM catalog.establishments e WHERE e.company_id=c.id AND e.region IN (${marks})) OR coalesce((o.region_catalog=? AND o.region IN (${marks})),0)) OR coalesce(o.website,(SELECT url FROM catalog.websites w WHERE w.company_id=c.id ORDER BY url LIMIT 1)) IS NULL OR s.status IN ('error','blocked'))`);
      params.push(...settings.regions, this.catalogId, ...settings.regions);
    }
    if (options.q) { where.push("(c.name LIKE ? ESCAPE '\\' OR c.id LIKE ? ESCAPE '\\')"); const q = `%${String(options.q).replace(/[\\%_]/g, '\\$&')}%`; params.push(q, q); }
    return { settings, params, where: where.join(' AND ') };
  }
  list(options = {}) {
    if (!this.catalogId) return { rows: [], total: 0, page: 1, pages: 0 };
    const { settings, params, where } = this.filters(options);
    const joins = 'FROM catalog.companies c LEFT JOIN overrides o ON o.company_id=c.id LEFT JOIN scans s ON s.company_id=c.id';
    const total = this.db.prepare(`SELECT count(*) n ${joins} WHERE ${where}`).get(...params).n;
    const pages = Math.ceil(total / 100), page = Math.max(1, Math.min(Number(options.page) || 1, pages || 1));
    const rows = this.db.prepare(`SELECT c.*,o.website AS custom_website,o.excluded,o.region AS custom_region,o.region_catalog,s.status AS scan_status,s.detail,s.checked_at,s.pages,s.catalog_id ${joins} WHERE ${where} ORDER BY c.name COLLATE NOCASE,c.id LIMIT 100 OFFSET ?`).all(...params, (page - 1) * 100);
    return { rows: rows.map(row => this.decorate(row, settings)), total, page, pages };
  }
  company(companyId, settings = this.settings()) {
    if (!this.catalogId) return null;
    const row = this.db.prepare('SELECT c.*,o.website AS custom_website,o.excluded,o.region AS custom_region,o.region_catalog,s.status AS scan_status,s.detail,s.checked_at,s.pages,s.catalog_id FROM catalog.companies c LEFT JOIN overrides o ON o.company_id=c.id LEFT JOIN scans s ON s.company_id=c.id WHERE c.id=?').get(companyId);
    return row ? this.decorate(row, settings) : null;
  }
  automaticCandidates(q = '') {
    if (!this.catalogId) return [];
    const { params, where } = this.filters({ q, view: 'companies' });
    // Limit in SQLite: a full KBO snapshot can contain millions of entities.
    const rows = this.db.prepare(`SELECT c.id FROM catalog.companies c
      LEFT JOIN overrides o ON o.company_id=c.id LEFT JOIN scans s ON s.company_id=c.id
      WHERE ${where}
      AND (o.website IS NOT NULL OR EXISTS (SELECT 1 FROM catalog.websites w WHERE w.company_id=c.id))
      AND (s.company_id IS NULL OR s.catalog_id IS NULL OR s.catalog_id<>? OR s.status IN ('stale','interrupted'))
      ORDER BY c.name COLLATE NOCASE,c.id LIMIT 100`).all(...params, this.catalogId);
    return rows.map(row => row.id);
  }
  decorate(row, settings) {
    const locations = this.db.prepare('SELECT id,city,postcode,region,nis FROM catalog.establishments WHERE company_id=? ORDER BY city').all(row.id);
    const websites = this.db.prepare('SELECT DISTINCT url FROM catalog.websites WHERE company_id=? ORDER BY url').all(row.id).map(r => r.url);
    const website = row.custom_website || websites[0] || null;
    const regionOverride = row.region_catalog === this.catalogId ? row.custom_region : null;
    const matchedLocations = locations.filter(l => settings.regions.includes(l.region));
    const regionUnknown = !matchedLocations.length && !settings.regions.includes(regionOverride);
    const activities = this.db.prepare("SELECT DISTINCT a.code,coalesce(n.description,f.description,a.code) description FROM catalog.activities a LEFT JOIN catalog.codes n ON n.category='nace2025' AND n.code=a.code AND n.language='NL' LEFT JOIN catalog.codes f ON f.category='nace2025' AND f.code=a.code AND f.language='FR' WHERE a.company_id=? ORDER BY a.code").all(row.id).filter(a => settings.sectors.some(s => a.code.startsWith(s)));
    const emails = this.db.prepare('SELECT email,source_url,checked_at FROM emails WHERE company_id=? ORDER BY email').all(row.id).filter(e => settings.roles.includes(e.email.split('@')[0]));
    let status = row.scan_status || 'new';
    if (row.catalog_id && row.catalog_id !== this.catalogId) status = 'stale';
    if (status === 'found' && !emails.length) status = 'stale';
    if (status === 'found' && regionUnknown) status = 'review';
    if (!website) status = 'no_website';
    if (row.excluded) status = 'excluded';
    const confirmed = status === 'found' && !regionUnknown && emails.length > 0;
    return { id: row.id, name: row.name || row.id, form: row.form, website, websites, locations, matchedLocations, regionOverride, regionUnknown, activities, emails, status, confirmed, excluded: Boolean(row.excluded), detail: row.detail || '', checked_at: row.checked_at, pages: row.pages || 0 };
  }
  updateCompany(id, change) {
    const company = this.company(id);
    if (!company) throw new Error('Bedrijf niet gevonden in de huidige dataset.');
    this.db.prepare('INSERT OR IGNORE INTO overrides(company_id) VALUES (?)').run(id);
    if (Object.hasOwn(change, 'excluded')) {
      if (typeof change.excluded !== 'boolean') throw new Error('Ongeldige uitsluiting.');
      this.db.prepare('UPDATE overrides SET excluded=? WHERE company_id=?').run(Number(change.excluded), id);
    }
    if (Object.hasOwn(change, 'website')) {
      const url = change.website ? normalizeWebsite(change.website) : null;
      this.db.prepare('UPDATE overrides SET website=? WHERE company_id=?').run(url, id);
      this.db.prepare("UPDATE scans SET status='stale',detail='Website gewijzigd; scan opnieuw.' WHERE company_id=?").run(id);
    }
    if (Object.hasOwn(change, 'region')) {
      if (change.region !== null && (!REGION_IDS.has(change.region) || !company.locations.some(l => !l.region))) throw new Error('Een regio kan alleen bevestigd worden voor een onbekende vestigingslocatie.');
      this.db.prepare('UPDATE overrides SET region=?,region_catalog=? WHERE company_id=?').run(change.region, this.catalogId, id);
    }
    return this.company(id);
  }
  exportRows(options = {}) {
    const rows = [], seen = new Set();
    let page = 1, pages = 1;
    do {
      const result = this.list({ ...options, page, view: 'results', includeUnknown: false }); pages = result.pages;
      for (const c of result.rows.filter(c => c.confirmed)) for (const email of c.emails) {
        if (seen.has(email.email) || !c.website || domainOf(email.source_url) !== domainOf(c.website)) continue;
        seen.add(email.email);
        rows.push({ company: c.name, enterprise: c.id, city: c.matchedLocations.map(l => l.city).join(' | '), region: [...new Set([...c.matchedLocations.map(l => l.region), c.regionOverride].filter(Boolean))].map(r => REGIONS.find(x => x.id === r)?.name || r).join(' | '), activity: c.activities.map(a => `${a.code} ${a.description}`).join(' | '), website: c.website, email: email.email, source: email.source_url, checked: email.checked_at, dataset: this.db.prepare("SELECT value FROM catalog.meta WHERE key='SnapshotDate'").get()?.value || '' });
      }
    } while (++page <= pages);
    return rows;
  }
  close() { this.db.close(); }
}

export function toCsv(rows) {
  const headers = ['Bedrijf', 'Ondernemingsnummer', 'Gemeente', 'Regio', 'Hoofdactiviteit (NACE-BEL 2025)', 'Website', 'E-mail', 'Bronpagina', 'Gecontroleerd op', 'KBO snapshotdatum'];
  const keys = ['company', 'enterprise', 'city', 'region', 'activity', 'website', 'email', 'source', 'checked', 'dataset'];
  const cell = value => { let text = String(value ?? ''); if (/^[\s]*[=+@-]|^[\t\r\n]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g, '""')}"`; };
  return '\uFEFF' + [headers, ...rows.map(r => keys.map(k => r[k]))].map(row => row.map(cell).join(';')).join('\r\n') + '\r\n';
}
