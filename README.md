# Stemmeapparat

Web-app til strengeinstrumenter med fem værktøjer: stemmeapparat (med stemtone/drone), metronom (med tempotræner), akkordbibliotek, gehørtræning og øvelog. Den kan installeres som app og virker uden internet. Den kører helt i browseren, har ingen afhængigheder og kræver ikke noget build-trin.

**Instrumenter:** guitar, 12-strenget guitar, bas (4, 5 og 6 strenge), ukulele, violin, bratsch, cello og kontrabas, hver med flere stemninger.

## Stemmeapparat
- Finder automatisk den nærmeste streng, eller du kan låse til én streng ved at trykke på den
- Viser afvigelsen i cent på en viser, og om strengen skal strammes eller løsnes
- Giver strengen et flueben, når den har været stemt et øjeblik
- Capo på guitar, 12-strenget og ukulele: vælg båndet på en lille guitarhals, og alle måltoner og referencetoner flyttes op
- Afspiller en referencetone for hver streng
- Kammertonen A4 kan justeres fra 415 til 466 Hz (standard 440)
- På 12-strenget guitar vises begge strenge i hvert kor (oktav- og unisonstrenge)
- **Stemtone og drone:** vedvarende tone på alle 12 toner i oktav 1–6 med fire klange og valgfri ren kvint. Bruges til at stemme efter øret eller øve skalaer over

## Metronom
- 20–300 BPM med knapper (hold nede for at skrue hurtigt), skyder og tap tempo
- Taktarterne 2/4, 3/4, 4/4, 5/4, 6/8, 7/8, 9/8 og 12/8, eller vælg selv 1–16 slag pr. takt
- Tryk på et slag for at skifte betoning: stærk, middel, svag eller stille
- Underdeling i 2, 3 (trioler) eller 4 klik pr. slag
- Fire lyde: træblok, klik, bip og koklokke, plus lydstyrke
- Pendul og lysende slag følger lyden. Klikkene planlægges i Web Audio, så tempoet er præcist
- Tastatur: mellemrum starter og stopper, T tapper, pil op/ned ændrer tempoet
- Skærmen holdes tændt, mens metronomen eller stemmeapparatet kører
- **Tempotræner:** øger (eller sænker) tempoet med et valgfrit antal BPM hver N. takt op til et mål og går tilbage til starttempoet ved stop

## Akkorder
- Guitar og ukulele i alle stemninger fra stemmeapparatet (også DADGAD, Open G, lav G osv.)
- 15 akkordtyper: dur, mol, 7, maj7, m7, sus2, sus4, add9, 6, 9, dim, m7♭5, dim7, aug og powerchords
- Grebene beregnes ud fra stemningen; i standardstemning vises de kendte standardgreb først. Bladr mellem op til 8 greb
- Diagrammet viser grundtonen i grønt, tonetrin (1, 3, 5 …) på hver prik og den klingende tone under hver streng
- Capo: vælg den akkord, der skal lyde, og se hvilket greb du skal tage over capoen
- "Spil" anslår akkorden med syntetiske strenge

## Gehørtræning
- **Intervaller:** vælg selv hvilke, og om de spilles op, ned, samtidig eller blandet
- **Akkorder:** genkend dur, mol, formindsket, forstørret, sus4, 7, maj7 og m7
- **Ram tonen:** appen spiller en tone, og du synger eller spiller den, mens mikrofonen viser hvor tæt du er
- Point, stime og rekord for hver øvelse

## Øvelog
- Tidtager der fortsætter, selvom du skifter fane eller genindlæser siden
- Registrerer automatisk det højeste metronomtempo i passet
- Dagligt mål med fremskridtsring, statistik (i dag, uge, stime, i alt) og en kalender over de seneste 16 uger
- Eksport til CSV (åbner i Excel/Numbers)

## Installér som app
- **Android/Chrome/Edge:** tryk "Installér" øverst, eller brug browserens menu
- **iPhone/iPad:** åbn siden i Safari → Del → "Føj til hjemmeskærm"
- Efter første besøg virker appen også uden internet

## Kør lokalt
Browsere giver kun adgang til mikrofonen på `https://` eller `localhost`. Start en lille server fra projektmappen:

```bash
python3 -m http.server 8000
```

Åbn derefter http://localhost:8000.

## Brug på telefonen
Læg mappen på en gratis statisk host med HTTPS, for eksempel GitHub Pages eller Netlify, og åbn adressen på telefonen. Installér den derefter som beskrevet ovenfor.

## Filer
- `index.html`: sidens opbygning
- `styles.css`: design med mørkt og lyst tema
- `js/tunings.js`: instrumenter og stemninger. Nye stemninger tilføjes her
- `js/pitch.js`: tonehøjde-detektion med YIN-algoritmen
- `js/app.js`: stemmeapparatets brugerflade, mikrofon og referencetone
- `js/metronome.js`: metronomens lyde, planlægning og brugerflade
- `js/audio.js`: fælles lydkontekst og hold-skærmen-tændt
- `js/drone.js`: stemtone og drone
- `js/chords.js`: akkordbibliotek og greb-generator
- `js/ear.js`: gehørtræning
- `js/practice.js`: øvelog
- `js/nav.js`: fanebjælken
- `js/pwa.js`, `sw.js`, `manifest.webmanifest`, `icons/`: installérbar app og offline-cache. Hæv `CACHE`-versionen i `sw.js`, når du udgiver ændringer
