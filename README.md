# Vindbaar

Een lokale webapp voor het vinden van Belgische bedrijven via KBO Open Data en het verzamelen van gepubliceerde zakelijke rolmailboxen op hun eigen website. Geen betaalde API, cloudabonnement of verzendfunctie.

## Projectcontext voor Codex en Claude

Open de map **email-scraper** zelf als project. [AGENTS.md](AGENTS.md) bevat de gedeelde projectinstructies; Claude leest die via [CLAUDE.md](CLAUDE.md). De korte actuele overdracht staat in [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Starten op Windows

Dubbelklik op **Start.cmd** en open **http://127.0.0.1:3210**. Laat het terminalvenster open terwijl je de app gebruikt. De eerste start downloadt de gratis npm-pakketten. Node.js 24.15 of nieuwer is nodig.

Via een terminal in deze projectmap:

```powershell
npm ci
npm start
```

## Eerste echte import

1. Registreer gratis op [KBO Open Data](https://kbopub.economie.fgov.be/kbo-open-data/) en accepteer zelf de gebruiksvoorwaarden. Download het volledige **Full.zip**-bestand. Een updatebestand wordt niet aanvaard.
2. Klik **KBO importeren**, kies het ZIP-bestand en start de import. Niet zelf uitpakken. De import loopt op de achtergrond; het aantal gelezen rijen is zichtbaar.
3. Kies je regio’s en zoek sectoromschrijvingen of NACE-codes. Klik op een sector om die toe te voegen en vervolgens op **Filters toepassen**. De bouwvoorinstelling gebruikt hoofdactiviteiten uit de afdelingen 41, 42 en 43 van NACE-BEL 2025.
4. Klik **Automatisch zoeken & scannen**: je filters worden opgeslagen, de app kiest zelf maximaal 100 passende bedrijven met een website en doorzoekt die meteen. Eerder afgewerkte scans uit dezelfde import worden overgeslagen; onderbroken scans en gewijzigde websites mogen opnieuw mee. Met een volgende klik pak je de volgende groep. Je hoeft geen URL’s of bedrijven handmatig te kiezen. **Scan selectie** blijft beschikbaar om zelf bedrijven te kiezen of opnieuw te scannen. Ondernemingen zonder website blijven zichtbaar: open hun details om een eigen bedrijfswebsite toe te voegen.
5. Bekijk **Ter controle** voor onbekende regio’s en geblokkeerde websites. Bevestig een regio alleen op basis van het adres van een actieve vestiging. Open een bronpagina om een gevonden mailbox zelf te controleren.
6. **Exporteren** geeft een UTF-8-CSV met BOM en puntkomma’s voor Excel. Alleen actuele resultaten met een bekende, geselecteerde regio en toegestane rolmailbox gaan mee. Dubbele e-mailadressen worden over bedrijven heen samengevoegd. De huidige regio-, sector- en bedrijfsnaamfilters gelden ook voor de export.

De startregio bevat Antwerpen, Oost-Vlaanderen, West-Vlaanderen, Vlaams-Brabant en Brussel. Limburg staat uit. Je kunt alle Belgische provincies aan- of uitzetten. Minstens één actieve vestiging binnen de selectie volstaat; de maatschappelijke zetel bepaalt de selectie niet.

## Wat wordt opgeslagen?

- De app neemt actieve KBO-entiteiten van type 2 op, met een rechtsvorm. Natuurlijke personen en expliciet herkende vormen zonder rechtspersoonlijkheid worden uitgesloten. De indeling volgt de KBO-gegevens.
- Alleen hoofdactiviteiten met NACE-versie 2025 worden geïndexeerd. Sectoromschrijvingen komen uit `code.csv`; er wordt geen AI-model of externe zoekmachine gebruikt.
- Van KBO-contactgegevens worden alleen website-URL’s bewaard. KBO-e-mails en telefoonnummers worden niet geïmporteerd.
- De crawler leest de startpagina en maximaal tien aanvullende HTML-pagina’s, tot twee linkniveaus diep. Hij controleert `robots.txt` per oorsprong, houdt minimaal 1,2 seconden afstand tussen verzoeken op hetzelfde bedrijfsdomein en respecteert een langere Crawl-delay. Blokkades worden niet omzeild.
- E-mails komen uit zichtbare HTML-tekst of `mailto`-links. Eenvoudige `[at]`/`[dot]`-notatie wordt herkend. Alleen ingestelde mailboxnamen op het eigen domein tellen mee. Er worden geen adressen geraden of afleverbaarheidstests uitgevoerd.
- Een doorverwijzing naar een ander bedrijfsdomein vereist een handmatig aangepaste website en een nieuwe scan. Privé-IP’s, lokale netwerkadressen, URL’s met wachtwoorden en afwijkende poorten zijn geblokkeerd.
- De app bewaart gevonden e-mails, bron-URL’s, scantijd, status, handmatige keuzes en taakvoortgang lokaal. Hij bewaart geen volledige gekopieerde websites.

**Gevonden** betekent: het adres staat op een gelezen website en past bij de ingestelde mailboxnamen. Dit is geen bevestiging van afleverbaarheid of toestemming voor een mailing. De bronkeuze en uitsluiting van natuurlijke personen volgen de gekozen productgrenzen en de [KBO-voorwaarden](https://economie.fgov.be/sites/default/files/Files/Entreprises/BCE/Licence-BCE-Open-Data-Conditions-d-utilisation.pdf).

## Grenzen van versie 1

De ontdekking is beperkt tot geïmporteerde KBO-bedrijven en hun geregistreerde of handmatig aangevulde website. Niet ieder bedrijf heeft een website of een gepubliceerd passend adres. JavaScript wordt niet uitgevoerd; PDF’s, afbeeldingen, ingelogde pagina’s en sociale platforms worden niet doorzocht. Een scan van 100 bedrijven levert dus niet noodzakelijk 100 adressen op. Andere landen vereisen later een andere bedrijfsbron en regiobestand; de onderdelen daarvoor zijn afzonderlijk opgezet.

## Lokale bestanden en herstel

`data/state.sqlite` bevat instellingen, laatste scanresultaten en taakgeschiedenis. `data/catalog-*.sqlite` zijn geïmporteerde KBO-snapshots. De nieuwe snapshot wordt pas actief na een succesvolle import; de voorgaande catalogus blijft als reservebestand bestaan. Een tijdelijk geüpload ZIP-bestand wordt na verwerking verwijderd. Bij veel imports moet je dus rekening houden met schijfruimte voor meerdere catalogussen.

Een nieuwe import bewaart je eerdere vondsten maar maakt die niet meteen exporteerbaar: scan opnieuw voor de huidige bron. Handmatige regioverificatie geldt alleen voor de snapshot waarin ze werd gegeven. Een onderbroken scan wordt bij herstart als onderbroken getoond; kies dezelfde bedrijven om opnieuw te scannen.

Maak een back-up van de volledige `data`-map terwijl de app gesloten is. Om een andere datamap te gebruiken, stel `LEADS_DATA_DIR` in. Met `PORT` kun je de poort aanpassen. De server luistert uitsluitend op `127.0.0.1` en is bedoeld voor één lokale gebruiker. Er zijn geen externe scripts, lettertypen, analytics of API-sleutels nodig.

## Demonstratie en tests

```powershell
npm run demo
```

Open **http://127.0.0.1:3211**. De demo gebruikt een aparte map `data/demo`, fictieve bedrijven en gesimuleerde websites met `.example`-adressen. Deze gegevens zijn duidelijk gemarkeerd en onbruikbaar voor mailings. De demo is bedoeld om de volledige workflow zonder KBO-account te bekijken. De gewone app blijft apart beschikbaar via `npm start`.

```powershell
npm test
npm run check
```

De tests gebruiken een kleine ZIP-fixture met de officiële KBO-kolommen. Ze controleren import via de uploadroute, behoud van de vorige dataset bij fouten, regio’s, hoofdactiviteiten, uitsluitingen, robots.txt, Crawl-delay, e-mailfiltering, herhaalde scans, handmatige controle en export. De tests zijn geen vervanging voor een eerste import met een echt KBO Full.zip-bestand; zo’n bestand is nog niet beschikbaar in dit project.

## Technische opzet

Node.js 24, Fastify, ingebouwde SQLite, worker threads, streaming ZIP/CSV-import en Cheerio voor HTML. De interface gebruikt gewone HTML/CSS/JavaScript. Afhankelijkheden zijn vastgelegd in `package-lock.json`.

De belangrijkste lokale routes zijn `GET /api/bootstrap`, `GET /api/companies`, `GET /api/sectors`, `POST /api/settings`, `POST /api/import` (ZIP-body), `POST /api/scans` (`{ids: [...]}` of `{automatic: true, q: ""}`), `POST /api/companies/:id`, `GET /api/status` en `GET /api/export`. Schrijfacties vereisen het sessietoken uit bootstrap in `X-Vindbaar-Token`; verzoeken vanaf andere origins worden geweigerd.

## Bronnen

- [KBO Open Data en toegang](https://economie.fgov.be/en/themes/enterprises/crossroads-bank-enterprises/services-everyone/public-data-available-reuse/cbe-open-data)
- [Officiële KBO Open Data bestandsbeschrijving](https://economie.fgov.be/sites/default/files/Files/Entreprises/BCE/Cookbook-BCE-Open-Data.pdf)
- [Statbel REFNIS 2025](https://statbel.fgov.be/nl/open-data/refnis-code-0): de officiële tabel is meegeleverd als `resources/refnis-2025.xlsx`. `node scripts/refnis.js` maakt hiervan het JSON-bestand voor de app. De tabel bevat de meertalige gemeentenamen, historie en administratieve hiërarchie. Niet eenduidig te koppelen namen worden als onbekend behandeld.

Statbel-bron: Algemene Directie Statistiek – Statistics Belgium, REFNIS vanaf 1 januari 2025, gedownload op 16 september 2026. Bedrijfsgegevens: FOD Economie, KBO Open Data, met de snapshotdatum zichtbaar in de app en CSV.

