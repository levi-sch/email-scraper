import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT } from '../src/config.js';
import { importKbo } from '../src/importer.js';
import { writeFixture } from '../test/fixtures.js';
import { createApp } from '../src/server.js';

const dir = path.join(ROOT, 'data', 'demo');
mkdirSync(dir, { recursive: true });
const appState = createApp({ dir, demo: true });
if (!appState.service.catalogId) {
  const zip = path.join(dir, 'example.zip'), catalog = `catalog-${randomUUID()}.sqlite`;
  writeFixture(zip, { demo: true });
  await importKbo(zip, path.join(dir, catalog));
  appState.service.activate(catalog); rmSync(zip);
}
await appState.app.listen({ port: 3211, host: '127.0.0.1' });
console.log('DEMO met fictieve bedrijven en gesimuleerde websites: http://127.0.0.1:3211');
process.once('SIGINT', async () => { await appState.app.close(); process.exit(0); });
process.once('SIGTERM', async () => { await appState.app.close(); process.exit(0); });
