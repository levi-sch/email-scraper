import { load } from 'cheerio';
import robotsParser from 'robots-parser';
import { setTimeout as sleep } from 'node:timers/promises';
import { domainOf, normalizeWebsite, requestPage } from './web.js';

const BOT = 'VindbaarBot';
export function extractPage(html, pageUrl, roles) {
  const $ = load(html);
  const emails = new Set();
  const domain = domainOf(pageUrl);
  const accepted = new Set(roles.map(r => r.toLowerCase()));
  $('script, style, head, template, noscript, [hidden], [aria-hidden="true"]').remove();
  $('[style]').each((_, el) => { if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(el).attr('style'))) $(el).remove(); });
  const mailtos = $('a[href^="mailto:" i]').map((_, el) => {
    try { return decodeURIComponent($(el).attr('href').slice(7).split('?')[0]); } catch { return ''; }
  }).get();
  $('br').replaceWith('\n');
  $('p,div,li,span,td,section,a').append(' ');
  const text = $('body').text().replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, '@').replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, '.');
  for (const part of [...mailtos, text]) for (const match of part.matchAll(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}/gi)) {
    const email = match[0].toLowerCase();
    const [local, host] = email.split('@');
    if (accepted.has(local) && domainOf(`https://${host}`) === domain && email.length <= 254) emails.add(email);
  }
  const links = [];
  $('a[href]').each((_, el) => {
    try {
      const url = new URL($(el).attr('href'), pageUrl);
      const label = `${url.pathname} ${$(el).text()}`;
      if (domainOf(url) !== domain || !['http:', 'https:'].includes(url.protocol) || /\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|mp4|docx?|xlsx?)$/i.test(url.pathname)) return;
      if (/logout|signout|winkelwagen|cart|checkout|wp-admin|wp-login/i.test(url.pathname)) return;
      // Query parameters can identify a distinct page (for example ?page=contact).
      // Only fragments are safe to remove without changing the requested resource.
      url.hash = '';
      const priority = /contact|kontakt|offerte|devis|bereikbaarheid/i.test(label) ? 100 : /over[- ]?ons|about|qui[- ]?sommes|a[- ]?propos|bedrijf/i.test(label) ? 70 : /dienst|service|bouw|construction|renov/i.test(label) ? 40 : 1;
      links.push({ url: url.href, priority });
    } catch {}
  });
  return { emails: [...emails], links };
}

export function createCrawler({ request = requestPage, delayMs = 1200, wait = sleep, now = Date.now } = {}) {
  const nextAt = new Map(), robotsCache = new Map();
  async function limited(url, options) {
    const key = domainOf(url);
    const prior = nextAt.get(key), interval = Math.max(delayMs, options?.delay || 0);
    const start = Math.max(now(), prior ? prior.start + Math.max(interval, prior.interval) : 0);
    nextAt.set(key, { start, interval });
    if (start > now()) await wait(start - now());
    return request(url, options);
  }
  async function robotsFor(origin) {
    if (robotsCache.has(origin)) return robotsCache.get(origin);
    const promise = (async () => {
      let url = `${origin}/robots.txt`;
      for (let i = 0; i < 4; i++) {
        const response = await limited(url, { maxBytes: 512 * 1024 });
        if (response.status >= 300 && response.status < 400 && response.location) {
          const next = normalizeWebsite(new URL(response.location, url).href);
          if (domainOf(next) !== domainOf(origin)) throw new Error('robots.txt verwijst naar een ander domein.');
          url = next; continue;
        }
        if ([404, 410].includes(response.status)) return robotsParser(`${origin}/robots.txt`, '');
        if (response.status !== 200) throw new Error(`robots.txt niet toegankelijk (HTTP ${response.status}).`);
        if (/text\/html/i.test(response.contentType) || /^\s*<!doctype html/i.test(response.body)) throw new Error('robots.txt geeft een HTML-pagina terug; handmatige controle nodig.');
        return robotsParser(`${origin}/robots.txt`, response.body);
      }
      throw new Error('Te veel verwijzingen bij robots.txt.');
    })();
    robotsCache.set(origin, promise);
    return promise;
  }
  return async function crawl(website, roles, { signal, onPage = () => {} } = {}) {
    const initial = normalizeWebsite(website), domain = domainOf(initial);
    const queue = [{ url: initial, depth: 0, priority: 1000 }], visited = new Set(), found = new Map();
    const warnings = [];
    let pages = 0, attempts = 0, wasBlocked = false;
    while (queue.length && pages < 11 && attempts < 25) {
      signal?.throwIfAborted();
      queue.sort((a, b) => b.priority - a.priority);
      const item = queue.shift();
      if (visited.has(item.url)) continue;
      let current = item.url;
      try {
        for (let redirects = 0; redirects < 5; redirects++) {
          signal?.throwIfAborted();
          current = normalizeWebsite(current);
          if (domainOf(current) !== domain) throw new Error('Website verwijst naar een ander domein. Controleer en wijzig de website handmatig.');
          if (visited.has(current)) break;
          visited.add(current); attempts++;
          let robots;
          try { robots = await robotsFor(new URL(current).origin); } catch (error) { wasBlocked = true; throw error; }
          if (robots.isAllowed(current, BOT) === false) { wasBlocked = true; warnings.push('Pagina uitgesloten door robots.txt.'); break; }
          const crawlDelay = (robots.getCrawlDelay(BOT) || 0) * 1000;
          if (crawlDelay > 60000) { wasBlocked = true; warnings.push('De website vraagt een wachttijd van meer dan een minuut.'); break; }
          const response = await limited(current, { delay: crawlDelay });
          if (response.status >= 300 && response.status < 400 && response.location) { current = new URL(response.location, current).href; if (redirects === 4) throw new Error('Te veel doorverwijzingen.'); continue; }
          if ([401, 403, 429, 503].includes(response.status)) { wasBlocked = true; warnings.push(`Website niet toegankelijk (HTTP ${response.status}).`); queue.length = 0; break; }
          if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
          if (!/text\/html|application\/xhtml\+xml/i.test(response.contentType)) { warnings.push('Geen HTML-pagina.'); break; }
          if (/cf-chl-|<title>\s*(just a moment|access denied|attention required)/i.test(response.body)) { wasBlocked = true; queue.length = 0; warnings.push('Website vraagt een browsercontrole.'); break; }
          pages++; onPage({ pages, url: current });
          const extracted = extractPage(response.body, current, roles);
          for (const email of extracted.emails) if (!found.has(email)) found.set(email, { email, source_url: current });
          if (item.depth < 2) for (const link of extracted.links) if (!visited.has(link.url) && queue.length < 150) queue.push({ ...link, depth: item.depth + 1 });
          break;
        }
      } catch (error) { if (signal?.aborted) throw error; warnings.push(error.message); }
    }
    return {
      status: found.size ? 'found' : wasBlocked ? 'blocked' : pages ? 'no_email' : 'error',
      emails: [...found.values()], pages, checked_at: new Date().toISOString(),
      detail: [...new Set(warnings)].slice(0, 4).join(' ') || (found.size ? 'Rolmailbox op bedrijfswebsite aangetroffen.' : 'Geen passende rolmailbox in de gelezen HTML gevonden.'),
    };
  };
}
