/*
 * DAX-maten en calculation items van het Helder-model. Wordt gebruikt door build-tmdl.mjs
 * (TMDL + measures.json). Tekenconventie: opbrengsten en resultaten positief; kostenmaten
 * (Kostprijs omzet, Personeelskosten, ...) positief als bedrag; schulden positief als bedrag.
 */

const LTM = 'DATESINPERIOD(DimDatum[Datum], MAX(DimDatum[Datum]), -12, MONTH)';
const SCEN = s => `DimScenario[Scenario] = "${s}"`;
// bedrag van een W&V-selectie, los van eventuele rekeningfilters uit een visual
const WV = filter => `CALCULATE([W&V bedrag], REMOVEFILTERS(DimRekening), ${filter})`;
const KOSTEN = filter => `CALCULATE(SUM(FactWinstVerlies[Bedrag]), REMOVEFILTERS(DimRekening), ${filter})`;
const BALANS = post => `CALCULATE([Balans laatste stand], REMOVEFILTERS(FactBalans[Balanspost]), FactBalans[Balanspost] = "${post}")`;
const KAS = posts => `CALCULATE(SUM(FactKasstroom[Bedrag]), REMOVEFILTERS(FactKasstroom[Kasstroompost]), FactKasstroom[Kasstroompost] IN {${posts.map(p => `"${p}"`).join(', ')}})`;
const KPI_LAATST = column => [
  `VAR LaatsteKey = MAX(FactKPI[DatumKey])`,
  `RETURN`,
  `    CALCULATE(MAX(FactKPI[${column}]), FactKPI[DatumKey] = LaatsteKey)`
].join('\n');

const EUR = '#,0';
const PCT = '0.0%';
const RATIO = '0.00';
const DAYS = '0.0';

export const MEASURES = [
  // ---------- Verkoop ----------
  { group: 'Verkoop', name: 'Omzet', formatString: EUR, dax: 'SUM(FactVerkoop[Omzet])',
    description: 'Omzet uit FactVerkoop (productlijn × kanaal × land). Volgt het scenariofilter; zonder scenariofilter worden Actual, Budget en Forecast opgeteld.' },
  { group: 'Verkoop', name: 'Aantal', formatString: EUR, dax: 'SUM(FactVerkoop[Aantal])', description: 'Aantal verkochte fietsen.' },
  { group: 'Verkoop', name: 'Gemiddelde prijs', formatString: EUR, dax: 'DIVIDE([Omzet], [Aantal])', description: 'Gemiddelde verkoopprijs per fiets (omzet / aantal).' },
  { group: 'Verkoop', name: 'Kostprijs', formatString: EUR, dax: 'SUM(FactVerkoop[Kostprijs])', description: 'Directe kostprijs van de verkochte fietsen (materiaal, arbeid, vracht).' },
  { group: 'Verkoop', name: 'Brutowinst', formatString: EUR, dax: '[Omzet] - [Kostprijs]', description: 'Omzet minus kostprijs uit de verkoopfeiten.' },
  { group: 'Verkoop', name: 'Brutomarge %', formatString: PCT, dax: 'DIVIDE([Brutowinst], [Omzet])', description: 'Brutowinst als percentage van de omzet (verkoopfeiten).' },
  { group: 'Verkoop', name: 'Omzet Actual', formatString: EUR, dax: `CALCULATE([Omzet], ${SCEN('Actual')})`, description: 'Omzet in het scenario Actual, ongeacht het scenariofilter.' },
  { group: 'Verkoop', name: 'Omzet Budget', formatString: EUR, dax: `CALCULATE([Omzet], ${SCEN('Budget')})`, description: 'Omzet in het scenario Budget (alleen 2026).' },
  { group: 'Verkoop', name: 'Omzet Forecast', formatString: EUR, dax: `CALCULATE([Omzet], ${SCEN('Forecast')})`, description: 'Omzet in het scenario Forecast (vanaf 2026-10).' },
  { group: 'Verkoop', name: 'Omzet A+F', formatString: EUR,
    dax: 'CALCULATE([Omzet Actual], DimDatum[IsActual] = 1) + CALCULATE([Omzet Forecast], DimDatum[IsActual] = 0)',
    description: 'Actual tot en met de laatste gerealiseerde maand (DimDatum[IsActual] = 1), daarna Forecast. Handig voor doorlopende tijdreeksen.' },
  { group: 'Verkoop', name: 'Omzet per fiets Actual', formatString: EUR, dax: `CALCULATE([Gemiddelde prijs], ${SCEN('Actual')})`, description: 'Gerealiseerde gemiddelde verkoopprijs per fiets.' },

  // ---------- Winst & verlies ----------
  { group: 'Winst & verlies', name: 'W&V bedrag', formatString: EUR,
    dax: 'SUMX(FactWinstVerlies, FactWinstVerlies[Bedrag] * RELATED(DimRekening[Teken]))',
    description: 'Bedrag per rekening met teken (opbrengst +, kosten −). In een matrix op DimRekening[Rekening] levert dit de volledige winst- en verliesrekening; het totaal is de nettowinst.' },
  { group: 'Winst & verlies', name: 'Netto-omzet', formatString: EUR, dax: WV('DimRekening[Rekeninggroep] = "Omzet"'), description: 'Netto-omzet volgens de W&V (rekening 4000). Gelijk aan [Omzet] uit de verkoopfeiten.' },
  { group: 'Winst & verlies', name: 'Kostprijs omzet', formatString: EUR, dax: KOSTEN('DimRekening[Rekeninggroep] = "Kostprijs omzet"'), description: 'Kostprijs van de omzet (materiaal, directe arbeid, vracht, garantie, eenmalige posten) als positief bedrag.' },
  { group: 'Winst & verlies', name: 'Brutowinst (W&V)', formatString: EUR, dax: WV('DimRekening[Niveau1] IN {"Omzet", "Brutomarge"}'), description: 'Netto-omzet minus kostprijs omzet.' },
  { group: 'Winst & verlies', name: 'Brutomarge % (W&V)', formatString: PCT, dax: 'DIVIDE([Brutowinst (W&V)], [Netto-omzet])', description: 'Brutowinst (W&V) als percentage van de netto-omzet.' },
  { group: 'Winst & verlies', name: 'Personeelskosten', formatString: EUR, dax: KOSTEN('DimRekening[Rekeninggroep] = "Personeelskosten"'), description: 'Personeelskosten van alle afdelingen (R&D, Sales & Marketing, Operations, G&A) als positief bedrag.' },
  { group: 'Winst & verlies', name: 'Marketing', formatString: EUR, dax: KOSTEN('DimRekening[Rekening] = "Marketing"'), description: 'Marketingkosten als positief bedrag.' },
  { group: 'Winst & verlies', name: 'Operationele kosten', formatString: EUR, dax: KOSTEN('DimRekening[Niveau1] = "Operationele kosten"'), description: 'Alle operationele kosten (personeel en overige bedrijfskosten) als positief bedrag.' },
  { group: 'Winst & verlies', name: 'Eenmalige posten', formatString: EUR, dax: KOSTEN('DimRekening[Rekening] IN {"Eenmalige kostprijsposten", "Eenmalige bedrijfskosten"}'), description: 'Eenmalige kosten (terugroepactie, ERP-migratie) als positief bedrag.' },
  { group: 'Winst & verlies', name: 'EBITDA', formatString: EUR, dax: WV('DimRekening[Niveau1] IN {"Omzet", "Brutomarge", "Operationele kosten"}'), description: 'Resultaat vóór rente, belasting en afschrijvingen: netto-omzet − kostprijs omzet − operationele kosten.' },
  { group: 'Winst & verlies', name: 'EBITDA %', formatString: PCT, dax: 'DIVIDE([EBITDA], [Netto-omzet])', description: 'EBITDA als percentage van de netto-omzet.' },
  { group: 'Winst & verlies', name: 'EBITDA genormaliseerd', formatString: EUR, dax: '[EBITDA] + [Eenmalige posten]', description: 'EBITDA gecorrigeerd voor eenmalige posten.' },
  { group: 'Winst & verlies', name: 'Afschrijvingen', formatString: EUR, dax: KOSTEN('DimRekening[Rekeninggroep] = "Afschrijvingen"'), description: 'Afschrijvingen op materiële vaste activa als positief bedrag.' },
  { group: 'Winst & verlies', name: 'EBIT', formatString: EUR, dax: '[EBITDA] - [Afschrijvingen]', description: 'Bedrijfsresultaat: EBITDA minus afschrijvingen.' },
  { group: 'Winst & verlies', name: 'Rentelasten', formatString: EUR, dax: KOSTEN('DimRekening[Rekening] = "Rentelasten"'), description: 'Rentelasten op termijnlening en rekening-courantkrediet als positief bedrag.' },
  { group: 'Winst & verlies', name: 'Financieel resultaat', formatString: EUR, dax: WV('DimRekening[Niveau1] = "Financieel"'), description: 'Rentebaten minus rentelasten (met teken).' },
  { group: 'Winst & verlies', name: 'Belastingen', formatString: EUR, dax: KOSTEN('DimRekening[Rekeninggroep] = "Belastingen"'), description: 'Vennootschapsbelasting als positief bedrag.' },
  { group: 'Winst & verlies', name: 'Nettowinst', formatString: EUR, dax: 'CALCULATE([W&V bedrag], REMOVEFILTERS(DimRekening))', description: 'Nettowinst: som van alle rekeningen met teken.' },
  { group: 'Winst & verlies', name: 'Nettomarge %', formatString: PCT, dax: 'DIVIDE([Nettowinst], [Netto-omzet])', description: 'Nettowinst als percentage van de netto-omzet.' },

  // ---------- Budget ----------
  { group: 'Budget', name: 'W&V bedrag Budget', formatString: EUR, dax: `CALCULATE([W&V bedrag], ${SCEN('Budget')})`, description: 'W&V bedrag in het scenario Budget (alleen 2026).' },
  { group: 'Budget', name: 'Netto-omzet Actual', formatString: EUR, dax: `CALCULATE([Netto-omzet], ${SCEN('Actual')})`, description: 'Netto-omzet in het scenario Actual.' },
  { group: 'Budget', name: 'Netto-omzet Budget', formatString: EUR, dax: `CALCULATE([Netto-omzet], ${SCEN('Budget')})`, description: 'Netto-omzet in het scenario Budget.' },
  { group: 'Budget', name: 'EBITDA Actual', formatString: EUR, dax: `CALCULATE([EBITDA], ${SCEN('Actual')})`, description: 'EBITDA in het scenario Actual.' },
  { group: 'Budget', name: 'EBITDA Budget', formatString: EUR, dax: `CALCULATE([EBITDA], ${SCEN('Budget')})`, description: 'EBITDA in het scenario Budget.' },
  { group: 'Budget', name: 'EBITDA Forecast', formatString: EUR, dax: `CALCULATE([EBITDA], ${SCEN('Forecast')})`, description: 'EBITDA in het scenario Forecast.' },
  { group: 'Budget', name: 'EBITDA A+F', formatString: EUR,
    dax: 'CALCULATE([EBITDA Actual], DimDatum[IsActual] = 1) + CALCULATE([EBITDA Forecast], DimDatum[IsActual] = 0)',
    description: 'EBITDA: Actual tot en met de laatste gerealiseerde maand, daarna Forecast.' },
  { group: 'Budget', name: 'Operationele kosten Budget', formatString: EUR, dax: `CALCULATE([Operationele kosten], ${SCEN('Budget')})`, description: 'Operationele kosten in het scenario Budget.' },
  { group: 'Budget', name: 'Operationele kosten Actual', formatString: EUR, dax: `CALCULATE([Operationele kosten], ${SCEN('Actual')})`, description: 'Operationele kosten in het scenario Actual.' },
  { group: 'Budget', name: 'Afwijking omzet vs budget (€)', formatString: EUR, dax: '[Netto-omzet Actual] - [Netto-omzet Budget]', description: 'Netto-omzet Actual minus Budget; positief = gunstig.' },
  { group: 'Budget', name: 'Afwijking omzet vs budget (%)', formatString: PCT, dax: 'DIVIDE([Afwijking omzet vs budget (€)], [Netto-omzet Budget])', description: 'Omzetafwijking als percentage van het budget; positief = gunstig.' },
  { group: 'Budget', name: 'Afwijking EBITDA vs budget (€)', formatString: EUR, dax: '[EBITDA Actual] - [EBITDA Budget]', description: 'EBITDA Actual minus Budget; positief = gunstig.' },
  { group: 'Budget', name: 'Afwijking EBITDA vs budget (%)', formatString: PCT, dax: 'DIVIDE([Afwijking EBITDA vs budget (€)], ABS([EBITDA Budget]))', description: 'EBITDA-afwijking als percentage van het budget (noemer absoluut); positief = gunstig.' },
  { group: 'Budget', name: 'Afwijking opex vs budget (€)', formatString: EUR, dax: '[Operationele kosten Budget] - [Operationele kosten Actual]', description: 'Budget minus Actual voor de operationele kosten; positief = onder budget = gunstig.' },

  // ---------- Balans ----------
  { group: 'Balans', name: 'Balans laatste stand', formatString: EUR,
    dax: [
      'VAR LaatsteKey = MAX(FactBalans[DatumKey])',
      'RETURN',
      '    CALCULATE(SUM(FactBalans[Bedrag]), FactBalans[DatumKey] = LaatsteKey)'
    ].join('\n'),
    description: 'Balansbedrag op de laatste maand binnen de huidige periode (standen worden niet opgeteld over maanden). Passiva en eigen vermogen zijn negatief opgeslagen; in een matrix op FactBalans[Balanspost] telt alles op tot nul.' },
  { group: 'Balans', name: 'Liquide middelen', formatString: EUR, dax: BALANS('Liquide middelen'), description: 'Kas en banktegoeden op de laatste balansdatum in de periode.' },
  { group: 'Balans', name: 'Debiteuren', formatString: EUR, dax: BALANS('Debiteuren'), description: 'Openstaande handelsvorderingen op de laatste balansdatum.' },
  { group: 'Balans', name: 'Voorraden', formatString: EUR, dax: BALANS('Voorraden'), description: 'Voorraad (fietsen en onderdelen) op de laatste balansdatum.' },
  { group: 'Balans', name: 'Materiële vaste activa', formatString: EUR, dax: BALANS('Materiële vaste activa'), description: 'Materiële vaste activa (netto, na afschrijvingen) op de laatste balansdatum.' },
  { group: 'Balans', name: 'Crediteuren', formatString: EUR, dax: `-${BALANS('Crediteuren')}`, description: 'Handelscrediteuren als positief bedrag.' },
  { group: 'Balans', name: 'Belastingschuld', formatString: EUR, dax: `-${BALANS('Belastingschuld')}`, description: 'Te betalen vennootschapsbelasting als positief bedrag.' },
  { group: 'Balans', name: 'Termijnlening', formatString: EUR, dax: `-${BALANS('Termijnlening')}`, description: 'Uitstaande termijnlening als positief bedrag.' },
  { group: 'Balans', name: 'Rekening-courantkrediet', formatString: EUR, dax: `-${BALANS('Rekening-courantkrediet')}`, description: 'Opgenomen rekening-courantkrediet (RCF) als positief bedrag.' },
  { group: 'Balans', name: 'Eigen vermogen', formatString: EUR, dax: `-${BALANS('Eigen vermogen')}`, description: 'Eigen vermogen als positief bedrag.' },
  { group: 'Balans', name: 'Netto schuld', formatString: EUR, dax: '[Termijnlening] + [Rekening-courantkrediet] - [Liquide middelen]', description: 'Rentedragende schuld minus liquide middelen; negatief betekent netto kaspositie.' },
  { group: 'Balans', name: 'Totaal activa', formatString: EUR, dax: '[Liquide middelen] + [Debiteuren] + [Voorraden] + [Materiële vaste activa]', description: 'Som van alle activa op de laatste balansdatum.' },
  { group: 'Balans', name: 'Totaal passiva', formatString: EUR, dax: '[Crediteuren] + [Belastingschuld] + [Termijnlening] + [Rekening-courantkrediet] + [Eigen vermogen]', description: 'Som van schulden en eigen vermogen op de laatste balansdatum.' },
  { group: 'Balans', name: 'Balanscontrole', formatString: '#,0.00', dax: 'CALCULATE([Balans laatste stand], REMOVEFILTERS(FactBalans[Balanspost]))', description: 'Som van alle balansposten (activa positief, passiva negatief); moet nul zijn.' },
  { group: 'Balans', name: 'Werkkapitaal', formatString: EUR, dax: '[Debiteuren] + [Voorraden] - [Crediteuren]', description: 'Operationeel werkkapitaal: debiteuren + voorraden − crediteuren.' },
  { group: 'Balans', name: 'Solvabiliteit %', formatString: PCT, dax: 'DIVIDE([Eigen vermogen], [Totaal activa])', description: 'Eigen vermogen als percentage van het balanstotaal.' },

  // ---------- Kasstroom ----------
  { group: 'Kasstroom', name: 'Kasstroom bedrag', formatString: EUR, dax: 'SUM(FactKasstroom[Bedrag])', description: 'Bedrag per kasstroompost (instroom +, uitstroom −).' },
  { group: 'Kasstroom', name: 'Operationele kasstroom', formatString: EUR, dax: KAS(['Nettowinst', 'Afschrijvingen', 'Mutatie debiteuren', 'Mutatie voorraden', 'Mutatie crediteuren', 'Mutatie belastingschuld']), description: 'Kasstroom uit operationele activiteiten (CFO): nettowinst + afschrijvingen + mutaties werkkapitaal.' },
  { group: 'Kasstroom', name: 'Investeringen', formatString: EUR, dax: KAS(['Investeringen']), description: 'Investeringskasstroom (capex), negatief.' },
  { group: 'Kasstroom', name: 'Vrije kasstroom', formatString: EUR, dax: '[Operationele kasstroom] + [Investeringen]', description: 'Vrije kasstroom (FCF): operationele kasstroom plus investeringen.' },
  { group: 'Kasstroom', name: 'Financieringskasstroom', formatString: EUR, dax: KAS(['Opname termijnlening', 'Aflossing termijnlening', 'Mutatie RCF', 'Dividend', 'Kapitaalstorting']), description: 'Kasstroom uit financieringsactiviteiten (CFF).' },
  { group: 'Kasstroom', name: 'Netto kasmutatie', formatString: EUR, dax: '[Vrije kasstroom] + [Financieringskasstroom]', description: 'Totale mutatie van de liquide middelen in de periode.' },
  { group: 'Kasstroom', name: 'Dividend', formatString: EUR, dax: `-${KAS(['Dividend'])}`, description: 'Uitgekeerd dividend als positief bedrag.' },
  { group: 'Kasstroom', name: 'Kasconversie %', formatString: PCT, dax: 'DIVIDE([Vrije kasstroom], [EBITDA])', description: 'Vrije kasstroom als percentage van EBITDA.' },

  // ---------- Werkkapitaal ----------
  { group: 'Werkkapitaal', name: 'DSO', formatString: DAYS, dax: 'AVERAGE(FactKPI[DSO])', description: 'Debiteurendagen (days sales outstanding), gemiddelde van de maandwaarden in de periode.' },
  { group: 'Werkkapitaal', name: 'DIO', formatString: DAYS, dax: 'AVERAGE(FactKPI[DIO])', description: 'Voorraaddagen (days inventory outstanding), gemiddelde van de maandwaarden in de periode.' },
  { group: 'Werkkapitaal', name: 'DPO', formatString: DAYS, dax: 'AVERAGE(FactKPI[DPO])', description: 'Crediteurendagen (days payables outstanding), gemiddelde van de maandwaarden in de periode.' },
  { group: 'Werkkapitaal', name: 'CCC', formatString: DAYS, dax: '[DSO] + [DIO] - [DPO]', description: 'Cash conversion cycle: DSO + DIO − DPO (dagen).' },

  // ---------- Covenants ----------
  { group: 'Covenants', name: 'LTM EBITDA', formatString: EUR, dax: `CALCULATE([EBITDA A+F], ${LTM})`, description: 'EBITDA over de laatste twaalf maanden tot en met de laatste datum in de periode (Actual + Forecast).' },
  { group: 'Covenants', name: 'LTM rentelasten', formatString: EUR,
    dax: `CALCULATE(CALCULATE([Rentelasten], ${SCEN('Actual')}, DimDatum[IsActual] = 1) + CALCULATE([Rentelasten], ${SCEN('Forecast')}, DimDatum[IsActual] = 0), ${LTM})`,
    description: 'Rentelasten over de laatste twaalf maanden (Actual + Forecast).' },
  { group: 'Covenants', name: 'Leverage', formatString: RATIO, dax: 'DIVIDE([Netto schuld], [LTM EBITDA])', description: 'Netto schuld / LTM EBITDA. Covenant: maximaal 3,0x.' },
  { group: 'Covenants', name: 'ICR', formatString: RATIO,
    dax: [
      'VAR Rente = [LTM rentelasten]',
      'RETURN',
      '    IF(ISBLANK(Rente) || Rente = 0, 99, MIN(99, DIVIDE([LTM EBITDA], Rente)))'
    ].join('\n'),
    description: 'Interest coverage ratio: LTM EBITDA / LTM rentelasten, afgetopt op 99. Covenant: minimaal 4,0x.' },
  { group: 'Covenants', name: 'Covenant leverage max', formatString: RATIO, dax: '3', description: 'Covenantgrens leverage (3,0x), voor referentielijnen.' },
  { group: 'Covenants', name: 'Covenant ICR min', formatString: RATIO, dax: '4', description: 'Covenantgrens ICR (4,0x), voor referentielijnen.' },
  { group: 'Covenants', name: 'Covenantstatus', formatString: null,
    dax: [
      'VAR Lev = [Leverage]',
      'VAR Icr = [ICR]',
      'RETURN',
      '    IF(',
      '        ISBLANK(Lev) || ISBLANK(Icr),',
      '        BLANK(),',
      '        IF(Lev <= [Covenant leverage max] && Icr >= [Covenant ICR min], "OK", "Breuk")',
      '    )'
    ].join('\n'),
    description: 'Tekst "OK" of "Breuk": leverage ≤ 3,0x én ICR ≥ 4,0x op de laatste datum in de periode.' },
  { group: 'Covenants', name: 'Leverage (gerapporteerd)', formatString: RATIO, dax: KPI_LAATST('Leverage'), description: 'Leverage zoals door het model gerapporteerd in FactKPI, laatste maand in de periode.' },
  { group: 'Covenants', name: 'ICR (gerapporteerd)', formatString: RATIO, dax: KPI_LAATST('ICR'), description: 'ICR zoals gerapporteerd in FactKPI (afgetopt op 99), laatste maand in de periode.' },
  { group: 'Covenants', name: 'LTM EBITDA (gerapporteerd)', formatString: EUR, dax: KPI_LAATST('LTMEBITDA'), description: 'LTM EBITDA zoals gerapporteerd in FactKPI, laatste maand in de periode.' },
  { group: 'Covenants', name: 'RCF headroom', formatString: EUR, dax: KPI_LAATST('RCFHeadroom'), description: 'Onbenutte ruimte onder de rekening-courantfaciliteit (limiet € 15 mln), laatste maand in de periode.' },

  // ---------- Tijd ----------
  { group: 'Tijd', name: 'Omzet vorig jaar', formatString: EUR, dax: 'CALCULATE([Omzet], SAMEPERIODLASTYEAR(DimDatum[Datum]))', description: 'Omzet in dezelfde periode een jaar eerder.' },
  { group: 'Tijd', name: 'Omzet groei %', formatString: PCT, dax: 'DIVIDE([Omzet] - [Omzet vorig jaar], [Omzet vorig jaar])', description: 'Omzetgroei ten opzichte van dezelfde periode vorig jaar.' },
  { group: 'Tijd', name: 'Omzet YTD', formatString: EUR, dax: 'TOTALYTD([Omzet], DimDatum[Datum])', description: 'Omzet cumulatief vanaf 1 januari tot en met de periode.' },
  { group: 'Tijd', name: 'Netto-omzet vorig jaar', formatString: EUR, dax: 'CALCULATE([Netto-omzet], SAMEPERIODLASTYEAR(DimDatum[Datum]))', description: 'Netto-omzet (W&V) in dezelfde periode een jaar eerder.' },
  { group: 'Tijd', name: 'Netto-omzet groei %', formatString: PCT, dax: 'DIVIDE([Netto-omzet] - [Netto-omzet vorig jaar], [Netto-omzet vorig jaar])', description: 'Groei van de netto-omzet ten opzichte van vorig jaar.' },
  { group: 'Tijd', name: 'EBITDA vorig jaar', formatString: EUR, dax: 'CALCULATE([EBITDA], SAMEPERIODLASTYEAR(DimDatum[Datum]))', description: 'EBITDA in dezelfde periode een jaar eerder.' },
  { group: 'Tijd', name: 'EBITDA YTD', formatString: EUR, dax: 'TOTALYTD([EBITDA], DimDatum[Datum])', description: 'EBITDA cumulatief vanaf 1 januari tot en met de periode.' },
  { group: 'Tijd', name: 'Omzet LTM', formatString: EUR, dax: `CALCULATE([Omzet A+F], ${LTM})`, description: 'Omzet over de laatste twaalf maanden (Actual + Forecast).' },

  // ---------- FTE ----------
  { group: 'FTE', name: 'FTE', formatString: '#,0.0', dax: 'AVERAGEX(VALUES(DimDatum[JaarMaand]), CALCULATE(SUM(FactFTE[FTE])))', description: 'Gemiddeld aantal FTE over de maanden in de periode (som over afdelingen per maand).' },
  { group: 'FTE', name: 'Omzet per FTE', formatString: EUR, dax: 'DIVIDE([Netto-omzet], [FTE])', description: 'Netto-omzet per gemiddelde FTE in de periode.' },
  { group: 'FTE', name: 'Personeelskosten per FTE', formatString: EUR, dax: 'DIVIDE([Personeelskosten], [FTE])', description: 'Personeelskosten per gemiddelde FTE in de periode.' },

  // ---------- Gebeurtenissen ----------
  { group: 'Gebeurtenissen', name: 'Aantal gebeurtenissen', formatString: '0', dax: 'COUNTROWS(Gebeurtenissen)', description: 'Aantal verklarende gebeurtenissen in de periode.' },
  { group: 'Gebeurtenissen', name: 'Gebeurtenis', formatString: null, dax: 'CONCATENATEX(Gebeurtenissen, Gebeurtenissen[Titel], "; ")', description: 'Titels van de gebeurtenissen in de periode, gescheiden door puntkomma.' }
];

export const CALC_ITEMS = [
  { name: 'Actueel', dax: 'SELECTEDMEASURE()', description: 'De maat zoals hij is.' },
  { name: 'YTD', dax: 'CALCULATE(SELECTEDMEASURE(), DATESYTD(DimDatum[Datum]))', description: 'Cumulatief vanaf 1 januari.' },
  { name: 'Vorig jaar', dax: 'CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR(DimDatum[Datum]))', description: 'Dezelfde periode een jaar eerder.' },
  { name: 'Verschil vs vorig jaar', dax: 'SELECTEDMEASURE() - CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR(DimDatum[Datum]))', description: 'Absoluut verschil met dezelfde periode vorig jaar.' },
  { name: 'Verschil % vs vorig jaar', dax: 'DIVIDE(SELECTEDMEASURE() - CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR(DimDatum[Datum])), CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR(DimDatum[Datum])))', description: 'Procentueel verschil met dezelfde periode vorig jaar.', formatStringDefinition: '"0.0%"' }
];
