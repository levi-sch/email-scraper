import { promisify } from 'node:util';
import { basename } from 'node:path';
import { rmSync } from 'node:fs';
import yauzl from 'yauzl';
import { parse } from 'csv-parse';
import { makeCatalog } from './database.js';
import { resolveRegion } from './geography.js';
import { normalizeWebsite } from './web.js';

const required = {
  'meta.csv': ['Variable', 'Value'], 'code.csv': ['Category', 'Code', 'Language', 'Description'],
  'enterprise.csv': ['EnterpriseNumber', 'Status', 'TypeOfEnterprise', 'JuridicalForm'],
  'establishment.csv': ['EstablishmentNumber', 'EnterpriseNumber', 'StartDate'],
  'denomination.csv': ['EntityNumber', 'Language', 'TypeOfDenomination', 'Denomination'],
  'address.csv': ['EntityNumber', 'MunicipalityNL', 'MunicipalityFR', 'Zipcode', 'CountryNL', 'CountryFR', 'DateStrikingOff'],
  'activity.csv': ['EntityNumber', 'NaceVersion', 'NaceCode', 'Classification'],
  'contact.csv': ['EntityNumber', 'ContactType', 'Value'],
};
const id = s => String(s || '').replace(/\./g, '').trim();

export async function importKbo(zipPath, catalogPath, { onProgress = () => {}, signal } = {}) {
  let zip, db;
  try {
    zip = await promisify(yauzl.open)(zipPath, { lazyEntries: true, autoClose: false });
    const entries = await new Promise((resolve, reject) => {
      const map = new Map();
      zip.on('error', reject);
      zip.on('entry', entry => {
        const name = basename(entry.fileName).toLowerCase();
        if (required[name]) {
          if (map.has(name)) return reject(new Error(`Dubbel bestand in ZIP: ${name}`));
          if (entry.uncompressedSize > 20 * 1024 ** 3) return reject(new Error('CSV-bestand is te groot.'));
          map.set(name, entry);
        }
        zip.readEntry();
      });
      zip.on('end', () => resolve(map));
      zip.readEntry();
    });
    for (const name of Object.keys(required)) if (!entries.has(name)) throw new Error(`Volledig KBO-bestand vereist: ${name} ontbreekt.`);
    db = makeCatalog(catalogPath);
    let totalBytes = 0;
    async function rows(name, handler) {
      signal?.throwIfAborted();
      onProgress({ message: `Verwerken: ${name}`, progress: 0, total: 0 });
      const stream = await promisify(zip.openReadStream.bind(zip))(entries.get(name));
      let headerSeen = false;
      const parser = parse({ bom: true, columns: header => {
        headerSeen = true;
        for (const column of required[name]) if (!header.includes(column)) throw new Error(`${name}: kolom ${column} ontbreekt.`);
        return header;
      }, skip_empty_lines: true, max_record_size: 1024 * 1024 });
      stream.on('data', chunk => {
        totalBytes += chunk.length;
        if (totalBytes > 30 * 1024 ** 3) stream.destroy(new Error('Uitgepakte KBO-data overschrijdt 30 GB.'));
      });
      stream.on('error', error => parser.destroy(error));
      stream.pipe(parser);
      let count = 0;
      db.exec('BEGIN');
      try {
        for await (const row of parser) {
          signal?.throwIfAborted();
          handler(row);
          if (++count % 5000 === 0) {
            db.exec('COMMIT; BEGIN');
            onProgress({ message: `${name}: ${count.toLocaleString('nl-BE')} rijen gelezen`, progress: count, total: 0 });
          }
        }
        if (!headerSeen && count === 0) throw new Error(`${name} is leeg.`);
        db.exec('COMMIT');
      } catch (error) { try { db.exec('ROLLBACK'); } catch {} stream.destroy(); parser.destroy(); throw error; }
    }
    const meta = {};
    await rows('meta.csv', r => { meta[r.Variable] = r.Value; });
    if (String(meta.ExtractType).toLowerCase() !== 'full') throw new Error('Importeer het volledige Full.zip-bestand, geen updatebestand.');
    if (!meta.SnapshotDate) throw new Error('SnapshotDate ontbreekt in meta.csv.');
    const insertCode = db.prepare('INSERT OR REPLACE INTO codes VALUES (?,?,?,?)');
    await rows('code.csv', r => insertCode.run(r.Category.toLowerCase(), r.Code, r.Language.toUpperCase(), r.Description));
    const codeDescription = db.prepare("SELECT description FROM codes WHERE category=? AND code=? AND language IN ('NL','FR')");
    const companyInsert = db.prepare('INSERT INTO companies(id,form) VALUES (?,?)');
    let skippedNatural = 0;
    await rows('enterprise.csv', r => {
      if (r.TypeOfEnterprise !== '2' || r.Status !== 'AC') { skippedNatural++; return; }
      const form = r.JuridicalFormCAC || r.JuridicalForm;
      const descriptions = codeDescription.all('juridicalform', form).map(x => x.description).join(' ');
      if (!form || /zonder rechtspersoonlijkheid|sans personnalit[eé] juridique|feitelijke vereniging|\bmaatschap\b/i.test(descriptions)) return;
      companyInsert.run(id(r.EnterpriseNumber), form);
    });
    const exists = db.prepare('SELECT 1 FROM companies WHERE id=?');
    const establishmentInsert = db.prepare('INSERT INTO establishments(id,company_id) VALUES (?,?)');
    await rows('establishment.csv', r => {
      if (exists.get(id(r.EnterpriseNumber))) establishmentInsert.run(id(r.EstablishmentNumber), id(r.EnterpriseNumber));
    });
    const owner = db.prepare('SELECT company_id FROM establishments WHERE id=?');
    function companyFor(entity) { return exists.get(entity) ? entity : owner.get(entity)?.company_id; }
    const names = new Map();
    const updateName = db.prepare('UPDATE companies SET name=? WHERE id=?');
    await rows('denomination.csv', r => {
      const entity = id(r.EntityNumber);
      if (!exists.get(entity)) return;
      const rank = (r.TypeOfDenomination === '001' ? 10 : 0) + (r.Language === '2' || r.Language === 'NL' ? 3 : r.Language === '1' || r.Language === 'FR' ? 2 : 1);
      if (!names.has(entity) || rank > names.get(entity)) { updateName.run(r.Denomination, entity); names.set(entity, rank); }
    });
    names.clear();
    const updateAddress = db.prepare('UPDATE establishments SET city=?,postcode=?,country=?,region=?,nis=? WHERE id=?');
    const addressSeen = new Map();
    await rows('address.csv', r => {
      const entity = id(r.EntityNumber);
      if (!owner.get(entity) || r.DateStrikingOff) return;
      const resolved = resolveRegion(r);
      const region = addressSeen.has(entity) && addressSeen.get(entity) !== resolved.region ? null : resolved.region;
      addressSeen.set(entity, region);
      updateAddress.run(r.MunicipalityNL || r.MunicipalityFR, r.Zipcode, resolved.country, region, resolved.nis, entity);
    });
    addressSeen.clear();
    const insertActivity = db.prepare('INSERT OR IGNORE INTO activities VALUES (?,?,?)');
    await rows('activity.csv', r => {
      if (r.NaceVersion !== '2025' || r.Classification !== 'MAIN') return;
      const entity = id(r.EntityNumber), company = companyFor(entity);
      const code = r.NaceCode.replace(/\./g, '');
      if (company && /^\d{2,7}$/.test(code)) insertActivity.run(company, entity, code);
    });
    const insertWebsite = db.prepare('INSERT OR IGNORE INTO websites VALUES (?,?,?)');
    await rows('contact.csv', r => {
      if (r.ContactType !== 'WEB') return;
      const entity = id(r.EntityNumber), company = companyFor(entity);
      if (!company) return;
      try { insertWebsite.run(company, entity, normalizeWebsite(r.Value)); } catch {}
    });
    const counts = {
      companies: db.prepare('SELECT count(*) n FROM companies').get().n,
      establishments: db.prepare('SELECT count(*) n FROM establishments').get().n,
      websites: db.prepare('SELECT count(DISTINCT company_id) n FROM websites').get().n,
      skippedNatural,
    };
    if (!counts.companies) throw new Error('Geen actieve rechtspersonen gevonden. De vorige dataset blijft behouden.');
    if (!db.prepare('SELECT 1 FROM activities LIMIT 1').get()) throw new Error('Geen hoofdactiviteiten met NACE-BEL 2025 gevonden.');
    const metaInsert = db.prepare('INSERT INTO meta VALUES (?,?)');
    for (const [key, value] of Object.entries({ ...meta, counts: JSON.stringify(counts) })) metaInsert.run(key, value);
    db.exec('ANALYZE');
    db.close(); db = null;
    return { ...meta, ...counts };
  } catch (error) {
    db?.close();
    for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(catalogPath + suffix, { force: true });
    throw error;
  } finally { zip?.close(); }
}
