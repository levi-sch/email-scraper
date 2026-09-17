import { readFileSync } from 'node:fs';

const rows = JSON.parse(readFileSync(new URL('../resources/refnis-2025.json', import.meta.url)));
export const normalize = value => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const provinceCodes = { '10000': 'antwerpen', '20001': 'vlaams-brabant', '20002': 'waals-brabant', '30000': 'west-vlaanderen', '40000': 'oost-vlaanderen', '50000': 'henegouwen', '60000': 'luik', '70000': 'limburg', '80000': 'luxemburg', '90000': 'namen', '04000': 'brussel' };
const byCode = new Map();
for (const row of rows) {
  const existing = byCode.get(row.CD_REFNIS);
  if (!existing || row.DT_VLDT_END === '31/12/9999') byCode.set(row.CD_REFNIS, row);
}
function province(row) {
  let current = row;
  const seen = new Set();
  while (current && !seen.has(current.CD_REFNIS)) {
    seen.add(current.CD_REFNIS);
    if (provinceCodes[current.CD_REFNIS]) return provinceCodes[current.CD_REFNIS];
    current = byCode.get(current.CD_SUP_REFNIS);
  }
  return null;
}
const names = new Map();
// Historical names can belong to a different province after a merger.
// Without an authoritative successor match, route those names to review.
for (const row of rows.filter(r => r.LVL_REFNIS === '4' && r.DT_VLDT_END === '31/12/9999')) {
  const region = province(row);
  if (!region) continue;
  for (const field of ['TX_REFNIS_NL', 'TX_REFNIS_FR', 'TX_REFNIS_DE']) {
    const name = normalize(row[field]);
    if (!name) continue;
    const values = names.get(name) || [];
    values.push({ region, nis: row.CD_REFNIS, current: row.DT_VLDT_END === '31/12/9999' });
    names.set(name, values);
  }
}
export function resolveRegion(address) {
  const countries = [address.CountryNL, address.CountryFR].filter(Boolean).map(normalize);
  if (countries.some(c => !['be', 'belgie', 'belgique', 'belgien', 'belgium'].includes(c))) return { region: 'outside', nis: null, country: countries[0] };
  const matches = [address.MunicipalityNL, address.MunicipalityFR].filter(Boolean).map(n => names.get(normalize(n)) || []).filter(a => a.length);
  if (!matches.length) return { region: null, nis: null, country: 'BE' };
  let regions = new Set(matches[0].map(r => r.region));
  for (const list of matches.slice(1)) regions = new Set([...regions].filter(r => list.some(x => x.region === r)));
  if (regions.size !== 1) return { region: null, nis: null, country: 'BE' };
  const region = [...regions][0];
  const candidates = matches.flat().filter(r => r.region === region).sort((a, b) => Number(b.current) - Number(a.current));
  return { region, nis: candidates[0].nis, country: 'BE' };
}
