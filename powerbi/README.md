# Helder — Power BI-project (PBIP)

Dit is het Power BI-project van **Helder E-Bikes B.V.**, een volledig fictieve e-bikefabrikant uit Eindhoven. Het project bevat een
semantisch model in TMDL (sterschema, 107 DAX-maten, een calculation group voor tijdintelligentie) en een eenvoudig rapport met drie
pagina's. **Alle cijfers, namen en gebeurtenissen zijn verzonnen** door `generator/generate.mjs`; het model is het eigenlijke
deliverable, het rapport is een minimale startpagina.

```
powerbi/
├── Helder.pbip                         projectbestand (open dit in Power BI Desktop)
├── Helder.SemanticModel/               semantisch model (TMDL, compatibilityLevel 1604)
│   ├── .platform, definition.pbism
│   └── definition/
│       ├── database.tmdl, model.tmdl, expressions.tmdl, relationships.tmdl
│       ├── cultures/nl-NL.tmdl
│       └── tables/*.tmdl               één bestand per tabel (incl. _Maten en Tijdintelligentie)
├── Helder.Report/                      rapport (klassieke report.json-indeling)
│   ├── .platform, definition.pbir, report.json
│   └── StaticResources/SharedResources/BaseThemes/CY24SU06.json
├── data/*.csv                          de feiten en dimensies uit de generator; DimBalanspost.csv is statisch (handmatig onderhouden)
├── build-tmdl.mjs                      bouwt alle projectbestanden uit de CSV-koppen + measures-def.mjs
├── measures-def.mjs                    de DAX-maten en calculation items (één plek)
├── measures.json                       catalogus van de maten (gebruikt door het Power BI-tabblad van de cockpit)
├── lineage.json                        vaste lineageTag-GUID's zodat herbouwen geen diff oplevert
└── validate.mjs                        structurele en inhoudelijke validatie van het hele project
```

## Openen in Power BI Desktop

1. Pak het zip-bestand uit (of kloon de repository) op een vaste plek, bijvoorbeeld `C:\Helder\`.
2. Staat het opslaan als Power BI-project (.pbip) in jouw Desktop-versie nog onder **Bestand > Opties > Preview-functies**, zet het
   dan aan; in recente versies staat het standaard aan. Open daarna `powerbi\Helder.pbip`.
3. Het model leest de CSV-bestanden via de parameter **CsvMap** (standaard `C:\Helder\powerbi\data\`). Staan de bestanden ergens
   anders, pas de parameter aan: **Start > Gegevens transformeren > Parameters bewerken**, vul de map in (eindigend op een backslash)
   en klik op **OK**.
4. Klik op **Vernieuwen**. Alle tabellen worden geladen (ca. 9.000 rijen); de CSV's zijn UTF-8 met komma
   als scheidingsteken en punt als decimaalteken (de M-query's typeren met cultuur `en-US`).

Herbouwen van de projectbestanden na een wijziging in de CSV's of in `measures-def.mjs`:

```
node powerbi/build-tmdl.mjs     # schrijft TMDL, report.json, measures.json
node powerbi/validate.mjs       # moet eindigen met "OK: geen fouten gevonden."
```

`validate.mjs` controleert naast de TMDL-structuur, lineageTags, relaties, M-typeringen en report.json ook dat elke letterlijke
waarde in een DAX-filter (`DimRekening[Rekeninggroep] = "Omzet"`, `DimBalanspost[Balanspost] = "Voorraden"`, …) in de CSV-data
voorkomt, dat elke sleutel in een feit een rij in de dimensie heeft (referentiële integriteit, na de datumfilter), dat de
datumfilter in de M-query's gelijk is aan het bereik van `DimDatum`, dat hiërarchieniveaus en berekende kolommen kloppen en dat de
standaardselecties van de slicers bestaande waarden zijn.

## Sterschema

| Tabel | Korrel | Sleutels naar |
|---|---|---|
| `DimDatum` | dag (2023-01-01 .. 2028-12-31), gemarkeerd als datumtabel (`Datum` is sleutel), hiërarchie **Kalender** (Jaar > Kwartaal > Maand) | — |
| `DimScenario` | Actual / Budget / Forecast (gesorteerd op `Volgorde`) | — |
| `DimProductlijn`, `DimKanaal`, `DimLand`, `DimAfdeling` | productlijn, kanaal, land (met `dataCategory: Country` voor kaarten), afdeling | — |
| `DimRekening` | W&V-rekening met `Rekeninggroep`, `Niveau1`, `Teken` (+1 opbrengst, −1 kosten) en `Volgorde`; de groepsniveaus sorteren op de berekende kolommen `RekeninggroepVolgorde` / `Niveau1Volgorde` | — |
| `DimBalanspost` | balanspost met `Zijde` (Activa/Passiva), `Volgorde` (balansvolgorde) en `Teken` (+1 activa, −1 passiva); statische CSV | — |
| `FactVerkoop` | maand × scenario × productlijn × kanaal × land: `Aantal`, `Omzet`, `Kostprijs` | DimDatum, DimScenario, DimProductlijn, DimKanaal, DimLand |
| `FactWinstVerlies` | maand × scenario × rekening: `Bedrag` (kosten positief opgeslagen) | DimDatum, DimScenario, DimRekening |
| `FactBalans` | maand × scenario × balanspost: standen, passiva en eigen vermogen negatief | DimDatum, DimScenario, DimBalanspost (op `Balanspost`) |
| `FactKasstroom` | maand × scenario × `Kasstroompost`: mutaties (indirecte methode) | DimDatum, DimScenario |
| `FactKPI` | maand × scenario: DSO, DIO, DPO, netto schuld, LTM EBITDA, leverage, ICR, RCF-headroom, eenmalige post | DimDatum, DimScenario |
| `FactFTE` | maand × scenario × afdeling: `FTE` | DimDatum, DimScenario, DimAfdeling |
| `Gebeurtenissen` | storyline-gebeurtenissen met toelichting; `Soort` wordt in de M-query vertaald naar Marge / Financiering / Eenmalig / Groei | DimDatum |
| `_Maten` | maattabel (één verborgen kolom) | — |
| `Tijdintelligentie` | calculation group | — |

Alle relaties zijn één-op-veel, enkelvoudig filterend, vanuit de dimensie naar het feit, op `DatumKey` (int64, `yyyymmdd`;
feiten staan op de eerste dag van de maand) en de overige integer-sleutels; alleen `FactBalans` → `DimBalanspost` loopt op de
tekstkolom `Balanspost` (de generator schrijft geen sleutel voor balansposten). Scenario 1 (Actual) loopt t/m 2026-09, scenario 3
(Forecast) vanaf 2026-10; scenario 2 (Budget) bestaat alleen voor 2026 en alleen in `FactVerkoop`, `FactWinstVerlies` en `FactFTE`.
Sleutel-, sorteer-, teken- en vlagkolommen zijn verborgen (`isHidden`, sleutels ook `isAvailableInMdx: false`); elke kolom heeft
een beschrijving.

**Datumbereik.** De datumtabel loopt op dagniveau van 2023-01-01 t/m 2029-12-31 en dekt alle feitmaanden. Elke query met een `DatumKey`
heeft als veiligheidsstap `Binnen = Table.SelectRows(…, each [DatumKey] >= 20230101 and [DatumKey] <= 20291231)`, zodat een feitrij
nooit op de lege rij van de datumtabel kan landen; `build-tmdl.mjs` leest die grenzen uit `DimDatum.csv`.

## Maten (catalogus)

Alle maten staan in `_Maten`, gegroepeerd in weergavemappen; de volledige lijst met DAX en beschrijving staat in `measures.json`.

| Map | Maten |
|---|---|
| Verkoop | Omzet, Aantal, Gemiddelde prijs, Kostprijs, Brutowinst, Brutomarge %, Omzet Actual / Budget / Forecast, Omzet per e-bike Actual |
| Winst & verlies | W&V bedrag (met teken, geeft in een matrix op `DimRekening` de volledige W&V), Netto-omzet, Kostprijs omzet, Brutowinst (W&V), Brutomarge % (W&V), Personeelskosten, Marketing, Operationele kosten, Eenmalige posten, EBITDA, EBITDA %, EBITDA genormaliseerd, Afschrijvingen, EBIT, Rentelasten, Financieel resultaat, Belastingen, Nettowinst, Nettomarge % |
| Actual + Forecast | Omzet A+F, EBITDA A+F, Rentelasten Actual / Forecast / A+F: Actual tot en met de laatste gerealiseerde maand (`DimDatum[IsActual] = 1`), daarna Forecast |
| Budget | W&V bedrag Budget (+ t/m realisatie), Netto-omzet / EBITDA / Operationele kosten Actual, Budget, Budget (t/m realisatie) en Actual (budgetmaanden), EBITDA Forecast, Afwijking omzet / EBITDA / opex vs budget (€ en %), gunstig = positief. **De afwijkingen vergelijken over de gerealiseerde maanden van het budgetjaar**: Actual januari t/m september 2026 tegen Budget januari t/m september 2026, niet negen maanden tegen twaalf; buiten het budgetjaar zijn ze leeg |
| Balans | Balans laatste stand, Balansstand (gepresenteerd), Liquide middelen, Debiteuren, Voorraden, Materiële vaste activa, Crediteuren, Belastingschuld, Termijnlening, Rekening-courantkrediet, Eigen vermogen, Nettoschuld, Totaal activa, Totaal passiva, Balanscontrole (= 0), Werkkapitaal, Solvabiliteit % |
| Kasstroom | Kasstroom bedrag, Operationele kasstroom, Investeringen, Vrije kasstroom, Financieringskasstroom, Netto kasmutatie, Dividend, Kasconversie % |
| Werkkapitaal | DSO, DIO, DPO, CCC (gemiddelde van de maandwaarden in de periode) |
| Covenants | LTM EBITDA, LTM rentelasten, Leverage, ICR, Covenant leverage max (3,0x), Covenant ICR min (4,0x), Covenantstatus ("OK"/"Overschrijding"), Leverage / ICR / LTM EBITDA (gerapporteerd), RCF headroom |
| Tijd | Omzet vorig jaar, Omzet groei %, Omzet YTD, Netto-omzet vorig jaar, Netto-omzet groei %, EBITDA vorig jaar, EBITDA YTD, Omzet LTM |
| FTE | FTE (gemiddelde over de maanden in de periode), Omzet per FTE, Personeelskosten per FTE |
| Gebeurtenissen | Aantal gebeurtenissen, Gebeurtenis (titels, chronologisch) |

Conventies:

- **Basismaten volgen het scenariofilter.** `[Omzet]`, `[EBITDA]` enz. tellen zonder scenariofilter Actual, Budget en Forecast op.
  In het rapport staat daarom op elke pagina een scenarioslicer met één keuze tegelijk en standaard **Actual**; in eigen rapporten:
  zet altijd een slicer op `DimScenario[Scenario]` of gebruik de expliciete varianten (`[Omzet Actual]`, `[EBITDA Budget]`, …) en de
  A+F-maten voor doorlopende reeksen.
- **Kostenmaten zijn positieve bedragen**, resultaten (EBITDA, Nettowinst) zijn met teken. `[W&V bedrag]` past het teken uit
  `DimRekening[Teken]` toe (`SUMX(VALUES(DimRekening[Teken]), …)`, geen rij-voor-rij `RELATED`) en telt op tot de nettowinst.
  Euromaten hebben de notatie `"€ "#,0;"€ "-#,0;"€ "0`.
- **Balansmaten tonen de stand op de laatste maand in de periode** (geen optelling over maanden): `VAR LaatsteKey = MAX(FactBalans[DatumKey])`.
  Schulden en eigen vermogen worden als positieve bedragen getoond; `[Balanscontrole]` telt alle opgeslagen posten op en moet nul zijn.
  `[Balansstand (gepresenteerd)]` draait het teken via `DimBalanspost[Teken]` en is bedoeld voor een matrix met rijen `Zijde` > `Balanspost`
  (balansvolgorde, eindtotaal leeg).
- **LTM-maten zijn verankerd op de laatste maand mét gegevens in de filtercontext**, niet op het kalendereinde van het filter:
  `EOMONTH(LOOKUPVALUE(DimDatum[Datum], DimDatum[DatumKey], MAX(FactWinstVerlies[DatumKey])), 0)` en daarna `DATESINPERIOD(…, -12, MONTH)`
  op de A+F-reeks. Daardoor delen `[Nettoschuld]` en `[LTM EBITDA]` dezelfde maand bij een jaar-, kwartaal- of maandfilter (bij
  Jaar = 2026 en Actual: beide september 2026). Minder dan twaalf beschikbare maanden (begin 2023) worden geannualiseerd, zoals in
  `FactKPI`; `[Leverage]`, `[ICR]` en `[LTM EBITDA]` zijn daarmee in alle 72 maanden gelijk aan de gerapporteerde varianten.
- **Leverage volgt de conventie van het model**: `IF(E > 0, Schuld / E, IF(Schuld > 0, 99, 0))`; een nettokaspositie geeft een
  negatieve ratio. `[Covenantstatus]` vergelijkt leverage (≤ 3,0x) en ICR (≥ 4,0x) en geeft "OK" of "Overschrijding".

## Calculation group `Tijdintelligentie`

Kolom `Tijdberekening` met de items **Actueel**, **YTD**, **Vorig jaar**, **Verschil vs vorig jaar** en **Verschil % vs vorig jaar**
(het verschil houdt via `SELECTEDMEASUREFORMATSTRING()` de notatie van de maat, het percentage krijgt `0.0%`). De twee
rekenkundige items laten tekstmaten (`[Covenantstatus]`, `[Gebeurtenis]`) ongemoeid via `ISSELECTEDMEASURE`. Zet de kolom in een
slicer of op de kolommen van een matrix om elke maat in één keer als YTD of jaar-op-jaar te tonen. Het model heeft
`discourageImplicitMeasures` aan (vereist voor calculation groups): gebruik altijd maten, geen impliciete sommen van kolommen.

## Rapport

Drie pagina's van 1280 × 720 met bewust eenvoudige visuals. Elke pagina heeft een slicer op `DimScenario[Scenario]` (één keuze,
standaard **Actual**) en op `DimDatum[Jaar]` (standaard **2026**, het laatste jaar met gerealiseerde maanden), zodat de kaarten bij
het openen Actual 2026 tonen in plaats van drie scenario's bij elkaar opgeteld.

1. **Overzicht** — Netto-omzet, EBITDA, EBITDA %, Nettowinst, Liquide middelen; netto-omzet per maand; slicer op
   `Tijdintelligentie[Tijdberekening]` (standaard **Actueel**) om alle kaarten in één klik YTD of jaar-op-jaar te zetten.
2. **Winst & verlies** — matrix `DimRekening[Rekeninggroep]` > `[Rekening]` × `[W&V bedrag]` / `[W&V bedrag Budget (t/m realisatie)]`
   (opent ingeklapt op rekeninggroep in W&V-volgorde; **Alles uitvouwen** in de visualkop toont de rekeningen); EBITDA per maand;
   kaart `Afwijking EBITDA vs budget (€)` (like-for-like).
3. **Balans** — Totaal activa, Eigen vermogen, Nettoschuld, Leverage, Covenantstatus; matrix `DimBalanspost[Zijde]` > `[Balanspost]`
   × `[Balansstand (gepresenteerd)]`; lijngrafiek **Leverage vs covenant** met `[Leverage]` en de referentielijn
   `[Covenant leverage max]`; vrije kasstroom per maand.

## Bekende beperkingen

- Het project is gebouwd en gevalideerd zonder Power BI Desktop (`validate.mjs` controleert structuur, verwijzingen, data en JSON,
  niet de TMDL-deserializer zelf). De visuals in `report.json` zijn minimaal gehouden; het semantische model is het deliverable.
  Opent een visual met een waarschuwing, verwijder hem en sleep de maten opnieuw in.
- `DimBalanspost.csv` komt niet uit de generator; voeg je in `generator/generate.mjs` een balanspost toe, voeg hem dan ook hier toe
  (`validate.mjs` meldt anders een balanspost zonder dimensierij).
- DSO/DIO/DPO zijn gemiddelden van maandwaarden uit `FactKPI`, geen herberekening uit balans en omzet.
- Het thema (`CY24SU06.json`) is een compacte eigen themadefinitie, geen kopie van het ingebouwde Desktop-thema.
- Alles is fictief; het model is bedoeld als demonstratie van een CFO-cockpit, niet als weergave van een bestaand bedrijf.
