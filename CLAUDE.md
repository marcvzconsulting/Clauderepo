# Helder CFO Cockpit — instructies voor Claude Code

Dit project is een financiële cockpit (drie-statement model, dashboard, Monte Carlo, DCF, Claude-analist, Power BI-project), gebouwd rond een **fictief** bedrijf, Helder E-Bikes B.V. Lees eerst `README.md` (wat het is) en `DEVELOPING.md` (API's, conventies, canon). De eigenaar is een Power BI-gebruiker; het doel van de volgende fase is de cockpit laten draaien op zijn **echte** Power BI-model.

## Werkwijze

- Verificatie is verplicht na elke wijziging: `node tests/engine.test.mjs 3000`, `node powerbi/validate.mjs` (als `powerbi/` is geraakt) en `node scripts/shot.mjs <tab> --out <map>` (Playwright-screenshots desktop/mobiel, licht/donker; bekijk de PNG's).
- Gedeelde bestanden (`cockpit/app/engine.js`, `core.js`, `charts.js`, `index.html`) wijzig je alleen met een reden die in meer dan één tabblad speelt; tabbladen staan in `cockpit/app/tabs/`.
- Alle UI-tekst in het Nederlands, u-vorm; getallen via `HC.fmt`; geen `innerHTML` met data; elke grafiek via `ui.figure` (tabelweergave). De canon in `DEVELOPING.md` geldt letterlijk.
- Na `generator/generate.mjs` altijd `node powerbi/build-tmdl.mjs`, `node powerbi/validate.mjs` en `node scripts/build-pbip-bundle.mjs` draaien, en voor publicatie op claude.ai `node scripts/build-artifact.mjs`.
- Commit-berichten in het Nederlands; niets pushen naar andere branches zonder dat de eigenaar dat vraagt.

## Volgende fase: koppeling met het echte Power BI-model

De cockpit rekent nu alles uit **drivers** (`dataset.actualDrivers`); echte cijfers zijn **uitkomsten**. Plan:

1. **Importschema.** Definieer `cockpit/data/import/` met per maand: W&V-regels (volgens `DimRekening`), balansposten (volgens `DimBalanspost`), kasstroomposten, omzet en aantallen per dimensie (productlijn/kanaal/land of wat het model biedt), FTE. Schrijf per tabel de DAX-query (`EVALUATE SUMMARIZECOLUMNS(...)`) in `powerbi/queries/*.dax`, zodat Claude Code in VS Code ze op het open model kan draaien en de CSV's kan wegschrijven.
2. **Actuals als data.** Voeg in `engine.js` een pad toe waarin de actuele maanden niet berekend maar ingelezen worden (`run()` met `opts.actualMonths`), en bouw daaruit de `state` (balansstanden, histories van 3 en 12 maanden) waarmee de forecast hervat. De invarianten in `tests/engine.test.mjs` moeten ook voor ingelezen maanden gelden (balans sluit, kas uit kasstroom = kas op balans; log afwijkingen in de bron in plaats van ze te maskeren).
3. **Forecastdrivers afleiden.** Uit de laatste twaalf ingelezen maanden: volumes en prijsniveau per cel, materiaal- en loonkosten per eenheid, marketing-%, DSO/DIO/DPO, FTE. Scenario's, Monte Carlo, waardering en de analist werken daarna ongewijzigd.
4. **Dimensies.** Als het echte model andere dimensies heeft dan productlijn/kanaal/land, maak `E.LINES/CHANNELS/COUNTRIES` configureerbaar vanuit de dataset (`dims`) en laat `H.util.dimKeys` die volgen.
5. **Power BI-project.** Hergebruik de maten en de calculation group uit `powerbi/` in het echte model waar ze passen; `powerbi/build-tmdl.mjs` leest kolomnamen uit de CSV's en is daarmee herbruikbaar.

Vraag de eigenaar eerst om de structuur van zijn model (`EVALUATE INFO.VIEW.TABLES()` en `EVALUATE INFO.VIEW.MEASURES()`), en of er een balans en kasstroom in zitten; zonder balans blijven de kas- en convenantdelen fictief en zeg dat dan expliciet in de UI.

## Wat fictief moet blijven

Zolang er geen echte data is, blijft overal zichtbaar dat de cijfers verzonnen zijn (chip "Fictieve data", voetnoten). Verwijder die markering pas als een tabblad daadwerkelijk op echte data draait, en nooit gedeeltelijk.
