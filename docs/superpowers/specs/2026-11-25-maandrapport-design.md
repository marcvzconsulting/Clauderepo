# Maandrapport met toelichting — ontwerp

Datum: 25 november 2026. Status: concept, ter goedkeuring door de eigenaar.

## Waarom

De eigenaar is zelfstandig Power BI-adviseur met een kleine klantenkring en wil niet koud bellen. Hij wil aanbieding 1 uit `reports/Shortlist en validatieplan AI producten.md` toetsen: een maandrapport met geschreven toelichting voor €125 per entiteit per maand. Daarvoor is een voorbeeld nodig dat zichzelf uitlegt en dat hij in een geschreven bericht kan meesturen, zodat het voorbeeld het verkoopwerk doet.

## Doelen

1. Een accountant of financieel verantwoordelijke begrijpt binnen een minuut wat hij maandelijks zou ontvangen en wat het kost.
2. Elke zin in de toelichting is terug te leiden tot een cijfer in het rapport; dat is het antwoord op het bezwaar "klopt de tekst?".
3. De eigenaar kan één link en één pdf versturen.
4. Dezelfde rapportlogica is later bruikbaar voor echte administraties (de importfase uit `CLAUDE.md`).

## Niet-doelen

- Geen koppeling met boekhoudpakketten en geen echte data in deze ronde.
- Geen live aanroep van een taalmodel op de openbare pagina (geen sleutel, geen kosten, geen data die de browser verlaat).
- Geen betaling, account of klantportaal.
- Geen wijziging van het rekenmodel (`engine.js`).

## Wat dit zou laten mislukken

- Een toelichting met een getal dat niet in de tabellen staat of er niet uit volgt.
- Een pagina die de indruk wekt dat de cijfers echt zijn. "Fictieve data" blijft zichtbaar in de kop van het voorbeeld en in de voetnoot.
- Een pagina die belooft wat de dienst niet levert. De pagina zegt hoe de toelichting van het voorbeeld tot stand kwam (automatisch uit de cijfers opgesteld) en wat de dienst toevoegt (een adviseur leest elk rapport na).

## Aanpakken

De eigenaar koos "alles": een tabblad in de cockpit, een openbare pagina, en een pagina waar een bezoeker een eigen export uploadt.

| Aanpak | Voordeel | Nadeel |
|---|---|---|
| 1. Tabblad in de cockpit | Weinig bouwwerk; sluit aan op de bestaande filters | Bezoeker moet door een cockpit met acht andere tabbladen |
| 2. Openbare pagina die voorbeeld en website is | Eén link die zichzelf uitlegt | Fictieve cijfers |
| 3. Uploadpagina met eigen cijfers | Sterkste aanleiding voor een gesprek | Importformaat per boekhoudpakket; echte bedrijfsgegevens |

Gekozen: alle drie, in deze volgorde, op één gedeelde rapportmotor. Deel 3 is een apart project met een eigen ontwerp zodra deel 1 en 2 er staan (keuze van de bouwer, zie "Volgorde").

## Ontwerp

### Rapportmotor — `cockpit/app/report.js` (nieuw)

Eén zuivere functie zonder DOM, bruikbaar in de browser (`window.HReport`) en in Node (`module.exports`), zoals `engine.js`.

```
HReport.build({ months, budget, period, events, config, fmt }) → rapport
```

- `months`: actuele maandobjecten uit het model; `budget`: `budget2026`; `period`: de rapportmaand (YYYY-MM).
- Het rapport bevat per onderdeel gestructureerde cijfers én zinnen:
  - `kerncijfers`: omzet, brutomarge, EBITDA en nettowinst, elk met maand, budget, vorig jaar en YTD; kas met de stand van de vorige maand en van een jaar eerder (het budget bevat geen balans, dus geen budgetvergelijking voor kas en nettoschuld).
  - `wv`: regels van de winst-en-verliesrekening met werkelijk, budget, verschil, vorig jaar, YTD werkelijk en YTD budget.
  - `omzetanalyse`: verschil met budget gesplitst in volume, prijs en mix op het niveau van de productlijn (eenheden en omzet per lijn; dat niveau heeft een echt budget meestal ook), en daarnaast het omzetverschil per kanaal en per land.
  - `margeanalyse`: verschil in brutomarge in procentpunten van de omzet, gesplitst naar materiaal, loon, vracht, garantie en eenmalige posten (elke kostensoort als percentage van de omzet, werkelijk min budget). Die vijf tellen exact op tot het verschil in brutomarge.
  - `kosten`: bedrijfskosten per categorie tegen budget, en FTE.
  - `balansEnKas`: werkkapitaaldagen, kasbrug van begin- naar eindstand, nettoschuld, convenanten.
  - `toelichting`: alinea's; elke alinea is een lijst zinnen, elke zin `{ tekst, bron: [paden naar cijfers in het rapport] }`.
  - `aandachtspunten`: maximaal drie, gerangschikt op omvang van het effect in euro's.
- Zinnen ontstaan uit regels: een bevinding wordt genoemd als het verschil boven een drempel uitkomt (standaard 2% van het budget van die regel én €25.000; beide instelbaar via `opts`). Per onderdeel worden de grootste twee oorzaken genoemd. Gebeurtenissen uit `dataset.events` die in de rapportmaand of de twee maanden ervoor vallen, worden als context aangehaald.
- Alleen maanden in 2026 hebben een budget. Voor eerdere maanden vervalt de budgetkolom en vergelijkt de toelichting met vorig jaar.
- Terminologie en notatie volgen de canon in `DEVELOPING.md` letterlijk; getallen lopen via `fmt`.

### Tabblad — `cockpit/app/tabs/maandrapport.js` (nieuw)

- `id: 'maandrapport'`, label "Maandrapport", `order` tussen Balans & kasstroom en Scenario's, bestaand icoon `table`.
- Eigen maandkeuze (`ui.select`) over de actuele maanden, standaard de laatste actuele maand. Het rapport volgt de globale periode- en korrelfilter niet, omdat een maandrapport altijd één maand is; het tabblad zegt dat in de subtitel.
- Opbouw: kerncijfers (`ui.kpi`), toelichting, winst-en-verliesrekening (`ui.table`, klasse `statement`), omzetanalyse (waterval via `ui.figure`), kosten, balans en kas, aandachtspunten.
- Herleidbaarheid is zichtbaar maar licht: onder elke alinea van de toelichting staat in kleine tekst waar de cijfers vandaan komen (bijvoorbeeld "Bron: winst-en-verliesrekening, regels Netto-omzet en Kostprijs van de omzet"). Geen klikgedrag.
- Knoppen: "Afdrukken of opslaan als pdf" (`window.print()`), "Toelichting kopiëren" (`H.copyText`).
- Tekst gaat via `h()` als tekstknopen, nooit via `innerHTML`.

### Gedeelde bestanden (reden: nieuw tabblad en afdrukweergave)

- `cockpit/index.html`: twee scriptregels (`app/report.js`, `app/tabs/maandrapport.js`) en een `@media print`-blok dat navigatie en filterbalk verbergt en kaarten niet over pagina's breekt.
- `scripts/shot.mjs`: `maandrapport` toevoegen aan de lijst van `--all`.
- `core.js`, `charts.js` en `engine.js` blijven ongewijzigd.

### Openbare pagina — `site/` (nieuw)

- `site/index.html`: één statisch bestand zonder afhankelijkheden, gebouwd door `scripts/build-site.mjs` uit een sjabloon (`site/template.html`), `site/config.json` en het rapport van de laatste actuele maand, dat tijdens de bouw in Node wordt berekend en als HTML wordt weggeschreven. De pagina bevat geen rekenmodel en geen dataset; alleen het resultaat. Het bouwscript heeft een eigen, kleine weergave in HTML-tekst: kerncijfers, toelichting met bronregels, tabellen en aandachtspunten, zonder grafieken (de waterval staat alleen in het tabblad). Een test vergelijkt dat de zinnen en tabelwaarden op de pagina gelijk zijn aan die van de rapportmotor, zodat tabblad en pagina niet uit elkaar lopen.
- Hetzelfde script schrijft met Playwright `site/voorbeeld-maandrapport.pdf`, zodat de eigenaar een bestand heeft om mee te sturen.
- Indeling:
  1. Kop: wat het is, prijs, knop "Vraag een proef aan".
  2. Voorbeeldrapport met de kop "Voorbeeld: Helder E-Bikes B.V., september 2026 — fictieve data".
  3. Hoe het werkt (drie stappen) en voor wie.
  4. Veelgestelde vragen: waar staat mijn data, klopt de tekst, doet mijn boekhoudpakket dit zelf, kan ik opzeggen.
  5. Herhaling van de knop en contactgegevens.
- De knop is een `mailto:`-link met vooringevuld onderwerp en bericht. Geen formulier en geen server.
- `site/config.json`: naam van de aanbieder, e-mailadres, prijs, inrichtingskosten, proefvoorwaarden, optioneel KvK-nummer. De pagina wordt niet gepubliceerd zolang naam en e-mailadres ontbreken.
- Eigen stijl in het sjabloon met dezelfde ontwerptokens als de cockpit (licht en donker, telefoonbreedte), plus een afdrukweergave die alleen het voorbeeldrapport toont, zodat de eigenaar een pdf kan meesturen.
- Publicatie (Vercel of een andere host) gebeurt pas na uitdrukkelijk akkoord van de eigenaar en valt buiten deze bouwronde.

### Volgorde

1. Rapportmotor met tests.
2. Tabblad.
3. Openbare pagina.
4. Later, apart ontwerp: uploadpagina. Uitgangspunt van de bouwer: het bestand wordt in de browser verwerkt en verlaat de computer van de bezoeker niet; de bezoeker krijgt de cijfers en automatisch gevonden afwijkingen, en de geschreven, nagelezen toelichting is de betaalde proef. Importformaat (kolommenbalans, auditfile) wordt dan bepaald.

## Verificatie

- `tests/report.test.mjs` (nieuw), over alle actuele maanden:
  - elke verschilkolom is werkelijk min vergelijking;
  - volume + prijs + mix telt op tot het omzetverschil (tolerantie €1), en de vijf margeoorzaken tot het verschil in brutomarge (tolerantie 0,001 procentpunt);
  - de kasbrug sluit op de eindstand van de balans;
  - elk getal dat in een zin voorkomt, is gelijk aan de geformatteerde waarde op een van de `bron`-paden van die zin;
  - geen zin bevat "NaN", "undefined" of een lege waarde; maanden zonder budget geven geen budgetzinnen.
- Bestaande controles: `node tests/engine.test.mjs 3000`, `node scripts/shot.mjs maandrapport --out <map>` (desktop en mobiel, licht en donker; de PNG's bekijken), `node scripts/build-artifact.mjs`.
- `scripts/shot-site.mjs` (nieuw): dezelfde vier schermafbeeldingen van `site/index.html`, plus controle op consolefouten en horizontale overloop.

## Beslissingen

Van de eigenaar:
- Alle drie de vormen bouwen.
- Aanbieding en prijs zoals in het validatieplan: €125 per entiteit per maand, €500 inrichting, proef van drie maanden zonder inrichtingskosten.
- Geen koud bellen; het voorbeeld moet schriftelijk te versturen zijn.

Van de bouwer (te corrigeren):
- De toelichting in het voorbeeld wordt met regels uit de cijfers opgesteld, niet door een taalmodel. Reden: controleerbaar, gratis, en bruikbaar zonder server. De pagina zegt dit eerlijk.
- De openbare pagina is een los statisch bestand in `site/`, niet de cockpit zelf.
- Contact via `mailto:`, zonder formulier.
- De uploadpagina wordt een apart project na deze ronde.
- Kas en nettoschuld worden niet met budget vergeleken; volume, prijs en mix op productlijnniveau; marge-analyse in procentpunten.
- De herleidbaarheid wordt getoond als bronregel per alinea.
- Het voorbeeld op de pagina heeft tabellen en geen grafieken; de pdf wordt door het bouwscript gemaakt.

Nog te bevestigen door de eigenaar (de pagina wordt niet gepubliceerd voordat dit vaststaat):
- Naam en e-mailadres op de pagina.
- De feiten over de dienst die op de pagina komen: aanlevering via een export of leestoegang tot het boekhoudpakket; rapport vóór de vijfde werkdag; de toelichting in de dienst wordt met een taalmodel opgesteld en door de adviseur nagelezen; maandelijks opzegbaar.

## Aan de bouwer overgelaten

Exacte formulering van de zinnen, drempelwaarden binnen de genoemde orde, de visuele uitwerking van de pagina binnen de bestaande ontwerptokens, en de teksten van "Hoe het werkt" en de veelgestelde vragen (u-vorm).
