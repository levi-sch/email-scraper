# Overdracht — Vindbaar

Bijgewerkt: 17 september 2026.

## Gereed

- Lokale app met KBO Full.zip-import, SQLite, instelbare regio's en sectoren.
- Automatisch zoeken & scannen selecteert maximaal 100 passende bedrijven met website.
  Afgewerkte scans binnen dezelfde import worden overgeslagen; onderbroken scans,
  gewijzigde websites en bedrijven uit een nieuwe import kunnen opnieuw mee.
- Rolmailboxen, bronpagina's, controles, uitsluiten, opnieuw scannen en Excel-CSV.
- Apart gemarkeerde demo met fictieve .example-adressen.
- Functionele queryparameters in contactlinks blijven behouden.
- Laatste functionele controle: 14 tests geslaagd; syntaxiscontrole geslaagd.

## Nog te verifiëren

- Er is nog geen echt KBO Full.zip-bestand geïmporteerd. Test importduur, omvang
  en echte bedrijfsselectie zodra de gebruiker dat bestand beschikbaar heeft.
- Automatische ontdekking gebruikt uitsluitend KBO-websiteadressen en handmatige
  aanvullingen. Open-webzoeken naar ontbrekende websites is niet geïmplementeerd.

## Werklocatie en samenwerken

- De gebruiker koos een zelfstandig project: Documents/code/werk/email-scraper.
- Open deze projectmap zelf in Codex of Claude om context tot deze app te beperken.
- Dit project heeft een lokale Git-map; er is nog geen remote ingesteld en er zijn
  nog geen commits. Een bestaande Claude-verbinding met een ander project koppelt
  deze repository niet automatisch.
- data/ bevat lokale instellingen en de aparte demo; deze map hoort niet in Git.
- Gebruik AGENTS.md als gedeelde instructies en README.md als gebruikershandleiding.

## Verplaatsing gecontroleerd

- Code, Git-map, afhankelijkheden en lokale data verplaatst; 3.548 bestanden op SHA-256 gecontroleerd.
- Op de nieuwe locatie: alle 14 tests en npm run check geslaagd.
- npm start en de lokale bootstraproute op poort 3210 gecontroleerd; testserver daarna afgesloten.
- De oude map bevat alleen VERPLAATST.md en een Start.cmd-doorverwijzing.
