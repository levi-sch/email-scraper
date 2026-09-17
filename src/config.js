import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.resolve(process.env.LEADS_DATA_DIR || path.join(ROOT, 'data'));
export const REGIONS = [
  ['antwerpen', 'Antwerpen'], ['oost-vlaanderen', 'Oost-Vlaanderen'],
  ['west-vlaanderen', 'West-Vlaanderen'], ['vlaams-brabant', 'Vlaams-Brabant'],
  ['brussel', 'Brussel'], ['limburg', 'Limburg'], ['waals-brabant', 'Waals-Brabant'],
  ['henegouwen', 'Henegouwen'], ['luik', 'Luik'], ['luxemburg', 'Luxemburg'], ['namen', 'Namen']
].map(([id, name]) => ({ id, name }));
export const DEFAULT_SETTINGS = {
  regions: REGIONS.slice(0, 5).map(r => r.id),
  sectors: ['41', '42', '43'],
  roles: ['info', 'contact', 'offerte', 'offertes', 'sales', 'office', 'administratie', 'algemeen', 'hello', 'bonjour', 'devis', 'commercial'],
  includeUnknown: true,
};
export const REGION_IDS = new Set(REGIONS.map(r => r.id));
export const USER_AGENT = 'VindbaarBot/1.0 (local business website contact research)';
