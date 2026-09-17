import { lookup } from 'node:dns/promises';
import { Agent, fetch } from 'undici';
import ipaddr from 'ipaddr.js';
import { getDomain } from 'tldts';
import { USER_AGENT } from './config.js';

const excludedDomains = new Set(['facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'google.com', 'google.be', 'youtube.com', 'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com']);
export function domainOf(url) { return getDomain(new URL(url).hostname, { allowPrivateDomains: true }); }
export function normalizeWebsite(value) {
  let raw = String(value || '').trim();
  if (!/^[a-z][a-z\d+.-]*:/i.test(raw)) raw = `https://${raw}`;
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error('Gebruik een publieke http(s)-bedrijfswebsite zonder aanmeldgegevens of afwijkende poort.');
  const domain = domainOf(url);
  if (!domain || ipaddr.isValid(url.hostname.replace(/^\[|\]$/g, '')) || excludedDomains.has(domain) || /(^|\.)(localhost|local|internal|home|lan)$/.test(url.hostname)) throw new Error('Gebruik de eigen publieke bedrijfswebsite.');
  url.hash = '';
  return url.href;
}
export function publicAddress(address) {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === 'unicast';
  } catch { return false; }
}
// Validate every resolved address, then pin that resolution to the actual socket.
// Redirects are handled by the crawler and rechecked independently.
export async function requestPage(input, { maxBytes = 2 * 1024 ** 2, timeout = 12000 } = {}) {
  const url = new URL(normalizeWebsite(input));
  let timer;
  const addresses = await Promise.race([
    lookup(url.hostname, { all: true }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DNS-opzoeking duurt te lang.')), timeout); timer.unref(); })
  ]).finally(() => clearTimeout(timer));
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('Privé- en lokale netwerkadressen zijn geblokkeerd.');
  const dispatcher = new Agent({ connect: { lookup: (_host, opts, callback) => {
    const available = opts.family ? addresses.filter(a => a.family === opts.family) : addresses;
    if (!available.length) return callback(new Error('Geen publiek adres beschikbaar.'));
    if (opts.all) callback(null, available); else callback(null, available[0].address, available[0].family);
  } } });
  try {
    const response = await fetch(url, { dispatcher, redirect: 'manual', signal: AbortSignal.timeout(timeout), headers: {
      'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8', 'Accept-Language': 'nl-BE,nl;q=0.9,fr;q=0.8,en;q=0.5'
    } });
    const contentType = response.headers.get('content-type') || '';
    if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('Pagina overschrijdt de downloadlimiet.'); }
    const chunks = []; let size = 0;
    if (response.body) for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) { throw new Error('Pagina overschrijdt de downloadlimiet.'); }
      chunks.push(chunk);
    }
    let decoder;
    try { decoder = new TextDecoder(contentType.match(/charset=["']?([^\s;"']+)/i)?.[1] || 'utf-8'); } catch { decoder = new TextDecoder(); }
    return { status: response.status, body: decoder.decode(Buffer.concat(chunks)), contentType, location: response.headers.get('location'), retryAfter: response.headers.get('retry-after') };
  } finally { await dispatcher.close(); }
}
