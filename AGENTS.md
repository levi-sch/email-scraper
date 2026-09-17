# Vindbaar — gedeelde projectcontext

Dit bestand is het startpunt voor Codex en Claude. Lees ook `PROJECT_STATUS.md`
voor de actuele overdracht; raadpleeg `README.md` voor gebruik en achtergrond.

## Doel en productgrenzen

- Lokale Nederlandstalige webapp voor Belgische bedrijfsleads, zonder betaalde API.
- KBO Full.zip is de bedrijfsindex; gebruiker downloadt en importeert die zelf.
- Automatisch regio en hoofdactiviteit filteren, maximaal 100 bedrijven per scan.
- Alleen actieve rechtspersonen; natuurlijke personen worden uitgesloten.
- Website-URL's komen uit KBO of een handmatige aanvulling. KBO-e-mails tellen nooit mee.
- Alleen ingestelde rolmailboxen op het eigen bedrijfsdomein, met bronpagina en datum.
- Robots.txt, wachttijd, domeingrens en blokkades respecteren. Geen login omzeilen.
- Onbekende vestigingsregio's vragen controle; alleen bevestigde vondsten naar CSV.
- Geen e-mailverzending, sociale platformen of algemene webzoekmachine in deze versie.
- Standaard: Antwerpen, Oost- en West-Vlaanderen, Vlaams-Brabant en Brussel;
  bouwbedrijven met NACE-BEL 2025-hoofdactiviteiten 41–43. Filters zijn instelbaar.

## Techniek en ingangen

- Node.js >=24.15, ESM, Fastify, ingebouwde SQLite, worker threads, gewone HTML/CSS/JS.
- `src/server.js`: lokale API, taakwachtrij, sessietoken en upload.
- `src/service.js` / `database.js`: filters, automatische selectie, opslag en export.
- `src/importer.js` / `geography.js`: streaming KBO-import en Statbel-regiokoppeling.
- `src/crawler.js` / `web.js`: HTML, e-mails, robots, verzoeken en netwerkgrenzen.
- `src/worker.js`: achtergrondimport en scans. `src/config.js`: defaults en paden.
- `public/`: interface. `resources/`: meegeleverde Statbel REFNIS-bron.
- `test/`: synthetische KBO-fixture, gesimuleerde websites en regressietests.

## Werkafspraken

- Controleer eerst `git status`; behoud wijzigingen van de gebruiker en andere agents.
- Lees gericht relevante bestanden; scan niet standaard data/ of node_modules/.
- Laat lokale gegevens in `data/` buiten Git, evenals node_modules/ en test-output/.
- Sluit draaiende app-processen voordat je SQLite-bestanden verplaatst of back-upt.
- Mislukte imports moeten de actieve catalogus intact laten. Eerdere snapshots blijven bewaard.
- Gebruik projectrelatieve paden; bind de webapp alleen aan 127.0.0.1.
- Werk `PROJECT_STATUS.md` kort bij na materiële wijzigingen; bewaar daar geen chatlog.
- Houd gedeelde instructies hier; `CLAUDE.md` verwijst naar dit bestand.

## Commando's vanuit deze projectmap

- Installeren: `npm ci`.
- Productie lokaal: `npm start`, http://127.0.0.1:3210, of dubbelklik `Start.cmd`.
- Aparte fictieve demo: `npm run demo`, http://127.0.0.1:3211.
- Controle: `npm test` en `npm run check`.

Een echte KBO-import is nog nodig om de volledige productiedataset te valideren.
