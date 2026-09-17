import test from 'node:test';
import assert from 'node:assert/strict';
import { createCrawler } from '../src/crawler.js';

test('Crawler vindt contactpagina’s die via queryparameters worden gerouteerd', async () => {
  for (const contactPath of ['/?page=contact', '/index.php?p=contact&lang=nl']) {
    const calls = [];
    const contactUrl = new URL(contactPath, 'https://voorbeeld.be').href;
    const crawl = createCrawler({
      delayMs: 0,
      request: async url => {
        calls.push(url);
        if (new URL(url).pathname === '/robots.txt') return { status: 404, body: '', contentType: 'text/plain' };
        return {
          status: 200,
          contentType: 'text/html',
          body: url === contactUrl
            ? '<p>info@voorbeeld.be</p>'
            : `<a href="${contactPath}">Contact</a><a href="${contactPath}#adres">Contactadres</a>`,
        };
      },
    });

    const result = await crawl('https://voorbeeld.be/', ['info']);

    assert.equal(result.status, 'found', contactPath);
    assert.deepEqual(result.emails, [{ email: 'info@voorbeeld.be', source_url: contactUrl }]);
    assert.equal(result.pages, 2);
    assert.equal(calls.filter(url => url === contactUrl).length, 1, 'Fragmentvarianten blijven gededupliceerd');
  }
});
