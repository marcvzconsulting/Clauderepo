# Helder CFO Cockpit

Een complete financiële cockpit voor **Helder E-Bikes B.V.**, een verzonnen Nederlands e-bikemerk uit Eindhoven. Alles in deze map is fictief en in één sessie door Claude gebouwd: de data, het model, de pagina en het Power BI-project.

## Wat erin zit

| Onderdeel | Waar | Wat het doet |
|---|---|---|
| Drie-statement model | `cockpit/app/engine.js` | Maandelijkse winst-en-verliesrekening, balans en kasstroom, driver-based, met automatisch rekening-courantkrediet, verliescompensatie, kwartaalbetaling VPB, convenanten en DCF. De balans sluit per constructie; `tests/engine.test.mjs` controleert dat met miljoenen checks over duizenden willekeurige scenario's. |
| Synthetische dataset | `generator/generate.mjs` → `cockpit/data/` en `powerbi/data/` | 45 maanden actuals (jan 2023 t/m sep 2026) met geplante gebeurtenissen (voorraadoverhang, terugroepactie, celprijsspike, Duitse uitrol), budget 2026 en vier scenario's. Deterministisch: dezelfde cijfers in de browser en in Power BI. |
| Cockpit | `cockpit/index.html` + `cockpit/app/` | Acht tabbladen: Overzicht, Winst & verlies, Balans & kasstroom, Scenario's (live sliders), Risico (Monte Carlo in een Web Worker), Waardering (DCF met gevoeligheidstabel), Analist (Claude met tools die het engine aanroepen) en Power BI (projectdownload). Licht en donker, desktop en telefoon, elke grafiek met tabelweergave. |
| Power BI-project | `powerbi/` | PBIP met semantisch model in TMDL (sterrenschema, datumtabel, calculation group voor tijdintelligentie, 45+ DAX-maten), rapportdefinitie, CSV-data, Power Query-parameter voor het datapad en een validatiescript. |

## Zelf draaien

```bash
cd showcase/helder-cfo-cockpit
node generator/generate.mjs        # dataset en CSV's opnieuw genereren
node tests/engine.test.mjs 3000    # invarianten en fuzz-tests
node powerbi/validate.mjs          # Power BI-project valideren
node scripts/build-pbip-bundle.mjs # Power BI-bestanden in de pagina bundelen
node scripts/build-artifact.mjs    # artifact-fragment maken voor claude.ai
npx serve cockpit                  # pagina lokaal bekijken
```

De pagina heeft geen build-stap en geen afhankelijkheden: open `cockpit/index.html` via een eenvoudige webserver (de Web Worker en `fetch` werken niet vanaf `file://`).

## Power BI openen

1. Download het project vanuit het tabblad **Power BI** in de cockpit, of pak `powerbi/` uit.
2. Open `Helder.pbip` in Power BI Desktop (PBIP-ondersteuning ingeschakeld).
3. Zet de parameter **CsvMap** op de map met de CSV-bestanden (Transformeren > Parameters bewerken) en klik op **Vernieuwen**.

Het semantisch model is het hoofdproduct; de rapportpagina's zijn bewust minimaal gehouden zodat ze zonder waarschuwingen openen.

## Conventies

Zie `DEVELOPING.md` voor de tab-API, de dataviz-regels en het verificatieproces (Playwright-screenshots in licht/donker en desktop/mobiel, getallen gecontroleerd tegen het engine).
