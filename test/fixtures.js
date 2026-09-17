import { zipSync, strToU8 } from 'fflate';
import { writeFileSync } from 'node:fs';

const csv = rows => rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';
export const examples = [
  { id: '0200000001', name: 'Atlas Bouw', city: 'Antwerpen', fr: 'Anvers', post: '2000', web: 'https://atlasbouw.example', code: '41001' },
  { id: '0200000002', name: 'Brik & Mortel', city: 'Gent', fr: 'Gand', post: '9000', web: 'https://brikmortel.example', code: '43999' },
  { id: '0200000003', name: 'Delta Renovatie', city: 'Leuven', fr: 'Louvain', post: '3000', web: '', code: '41001' },
  { id: '0200000004', name: 'Kade Construct', city: 'Brussel', fr: 'Bruxelles', post: '1000', web: 'https://kadeconstruct.example', code: '41001' },
  { id: '0200000005', name: 'Kempen Bouw', city: 'Hasselt', fr: 'Hasselt', post: '3500', web: 'https://kempenbouw.example', code: '41001' },
  { id: '0200000006', name: 'Zelfstandige Testpersoon', city: 'Antwerpen', fr: 'Anvers', post: '2000', web: 'https://zelfstandige.example', code: '41001', type: '1' },
  { id: '0200000007', name: 'Nevenactiviteit Winkel', city: 'Antwerpen', fr: 'Anvers', post: '2000', web: 'https://winkel.example', code: '47111' },
  { id: '0200000008', name: 'Onbekende Locatie Bouw', city: 'Nog te controleren', fr: '', post: '0000', web: 'https://locatiebouw.example', code: '41001' },
  { id: '0200000009', name: 'Buitenregio Bouw', city: 'Luik', fr: 'Liège', post: '4000', web: 'https://buitenbouw.example', code: '41001' },
  { id: '0200000010', name: 'Westhaven Dakwerken', city: 'Brugge', fr: 'Bruges', post: '8000', web: 'https://westhaven.example', code: '43410' },
  { id: '0200000011', name: 'Noord Constructiegroep', city: 'Mechelen', fr: 'Malines', post: '2800', web: 'https://noordgroep.example', code: '42110' },
  { id: '0200000012', name: 'Bouw Zonder Rechtspersoonlijkheid', city: 'Antwerpen', fr: 'Anvers', post: '2000', web: 'https://maatschap.example', code: '41001', form: 'M' },
];
export function fixtureFiles({ demo = false } = {}) {
  const files = {};
  files['meta.csv'] = csv([['Variable', 'Value'], ['SnapshotDate', '16-09-2026'], ['ExtractTimestamp', '16-09-2026 00:00:00'], ['ExtractType', 'FULL'], ['Version', 'R018'], ['Demo', demo ? '1' : '0']]);
  files['code.csv'] = csv([['Category', 'Code', 'Language', 'Description'], ['TypeOfEnterprise', '1', 'NL', 'Natuurlijk persoon'], ['TypeOfEnterprise', '2', 'NL', 'Rechtspersoon'], ['JuridicalForm', '610', 'NL', 'Besloten vennootschap'], ['JuridicalForm', 'M', 'NL', 'Maatschap zonder rechtspersoonlijkheid'], ['Nace2025', '41001', 'NL', 'Bouw van woongebouwen'], ['Nace2025', '43410', 'NL', 'Dakwerkzaamheden'], ['Nace2025', '43999', 'NL', 'Overige gespecialiseerde bouwwerkzaamheden'], ['Nace2025', '42110', 'NL', 'Bouw van wegen'], ['Nace2025', '47111', 'NL', 'Detailhandel in winkels'], ['Nace2025', '43410', 'FR', 'Travaux de couverture']]);
  files['enterprise.csv'] = csv([['EnterpriseNumber', 'Status', 'JuridicalSituation', 'TypeOfEnterprise', 'JuridicalForm', 'StartDate'], ...examples.map(c => [c.id, 'AC', '000', c.type || '2', c.form || '610', '01-01-2020'])]);
  files['establishment.csv'] = csv([['EstablishmentNumber', 'StartDate', 'EnterpriseNumber'], ...examples.map(c => [`2${c.id.slice(1)}`, '01-01-2020', c.id])]);
  files['denomination.csv'] = csv([['EntityNumber', 'Language', 'TypeOfDenomination', 'Denomination'], ...examples.map(c => [c.id, '2', '001', c.name])]);
  const addressHeader = ['EntityNumber', 'TypeOfAddress', 'CountryNL', 'CountryFR', 'Zipcode', 'MunicipalityNL', 'MunicipalityFR', 'StreetNL', 'StreetFR', 'HouseNumber', 'Box', 'ExtraAddressInfo', 'DateStrikingOff'];
  files['address.csv'] = csv([addressHeader, ...examples.map(c => [`2${c.id.slice(1)}`, 'BAET', '', '', c.post, c.city, c.fr, 'Voorbeeldstraat', '', '1', '', '', '']), ['0200000011', 'REGO', '', '', '3500', 'Hasselt', 'Hasselt', '', '', '', '', '', '']]);
  files['activity.csv'] = csv([['EntityNumber', 'ActivityGroup', 'NaceVersion', 'NaceCode', 'Classification'], ...examples.map(c => [`2${c.id.slice(1)}`, '006', '2025', c.code, 'MAIN']), ['2200000007', '006', '2025', '41001', 'SECO'], ['2200000007', '006', '2008', '41001', 'MAIN']]);
  files['contact.csv'] = csv([['EntityNumber', 'EntityContact', 'ContactType', 'Value'], ...examples.filter(c => c.web).map(c => [c.id, 'ENT', 'WEB', c.web]), ['0200000001', 'ENT', 'EMAIL', 'verboden-kbo-adres@atlasbouw.example'], ['0200000001', 'ENT', 'TEL', '030000000']]);
  return files;
}
export function writeFixture(file, options = {}, modify = x => x) {
  const files = modify(fixtureFiles(options));
  const archive = zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8('\uFEFF' + text)])));
  writeFileSync(file, archive); return file;
}
export async function demoRequest(input) {
  const url = new URL(input);
  const host = url.hostname;
  if (!examples.some(c => c.web && new URL(c.web).hostname === host)) return { status: 404, body: '', contentType: 'text/plain' };
  if (url.pathname === '/robots.txt') return { status: 200, body: `User-agent: *\nDisallow: ${host === 'kadeconstruct.example' ? '/' : '/prive'}\n`, contentType: 'text/plain' };
  if (host === 'brikmortel.example') return { status: 200, body: '<html><body><h1>Brik &amp; Mortel</h1><p>Contacteer ons via het contactformulier.</p></body></html>', contentType: 'text/html' };
  return { status: 200, contentType: 'text/html; charset=utf-8', body: url.pathname === '/contact' ? `<html><body><h1>Contact</h1><a href="mailto:INFO@${host}">Stuur een bericht</a><p>offerte@${host}</p><p>pieter@${host}</p><p>info@anderdomein.example</p><a href="/prive">Privé</a></body></html>` : `<html><body><h1>${examples.find(c => c.web.includes(host))?.name}</h1><a href="/contact">Contact</a><a href="/contact#adres">Ons adres</a></body></html>` };
}
