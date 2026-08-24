# Arie's aftelling

Elke ochtend een pushbericht op jouw telefoon met het berichtje van vandaag voor Arie,
plus een knop **Openen in WhatsApp** waarmee WhatsApp opent met de tekst er al in.
Jij drukt op verzenden, dus het komt van jouw eigen nummer.

Aftellen naar **1 mei 2027** — Dag van de Arbeid, en een zaterdag. 251 berichten, van
dag 250 tot en met dag 0.

> **Privéproject.** Dit hoort niet in de Olympia-omgeving. De repo is
> `OsmanVardar/Arie-Pensioen` (privé) en het Vercel-project staat onder de persoonlijke
> scope `ovardar-5825`. De Vercel-connector die aan Claude hangt bereikt alléén het
> werkteam `olympia3` en wordt hier dus niet gebruikt.

## Status

| onderdeel | staat |
|---|---|
| 251 berichten | klaar, ruim 13.000 woorden |
| site (3 pagina's) | klaar en getest |
| dagelijkse push | klaar en drooggelopen |
| telefoonnummer | **nog niet ingevuld** |
| ploegenrooster | **nog niet ingevuld** |
| 103 berichten met kantoorritme | **moeten herschreven worden** |
| gepusht naar GitHub | **nog niet** |
| gedeployed | **nog niet** |

## Hoe het in elkaar zit

```
content/*.md        de 251 berichten - dit bewerk je het meest
content/_intro.md   introblok, alleen gebruikt als het aftellen later begint dan dag 250
config.json         naam, datum, telefoonnummer, startdatum, geheim pad, ntfy-topic
rooster.json        het ploegenrooster van Arie (mag leeg blijven)
site/               index.html, berichten.html, rooster.html, stijl.css, app.js
scripts/build.mjs   bouwt en controleert alles, vult public/ en api/_data.js
scripts/audit.mjs   zoekt berichten die van een kantoorritme uitgaan
scripts/testpush.mjs test de dagelijkse push zonder Vercel
api/cron.js         de dagelijkse push (cron -> ntfy -> jouw telefoon)
public/             wat Vercel serveert. Gegenereerd, niet met de hand bewerken
```

De site is puur statisch: alle berichten zitten in de pagina en de browser rekent zelf uit
welke dag het is. Geen database, geen server-rendering. De enige serverkant is de
dagelijkse push.

## Nog te doen

### 1. Telefoonnummer

In `config.json`, internationaal, zonder `+` en zonder streepjes:

```json
"telefoon": "31612345678"
```

Zolang hier `31600000000` staat waarschuwt de site erover en werkt de WhatsApp-knop niet.

### 2. Startdatum

Belangrijk, en makkelijk over het hoofd te zien. Het bericht van dag 250 stelt zichzelf
voor ("vanaf vandaag krijg je hier elke ochtend..."). Begin je later dan 24 augustus 2026,
dan zou die introductie nooit verstuurd worden en valt Arie midden in een reeks.

Zet daarom in `config.json` de dag waarop je het eerste bericht écht verstuurt:

```json
"startdatum": "2026-09-15"
```

Dan plakt de build het blok uit `content/_intro.md` boven dat eerste bericht, met de
dubbele aanhef eraf. Laat je het leeg, dan begint het gewoon op dag 250 en gebeurt er
niets bijzonders. De build waarschuwt als je het leeg laat terwijl die datum al voorbij is.

### 3. Ploegenrooster

Arie werkt in ploegen, dus "nog 250 dagen" is niet het interessantste getal — **"nog 118
diensten"** is dat wel. Vul `rooster.json` per datum in met `vroeg`, `middag`, `nacht` of
`vrij`. Datums die je niet invult gelden als onbekend, niet als vrij, zodat er nooit iets
op de site staat wat niet klopt.

Zodra er een rooster staat verschijnt automatisch:

- een teller "diensten te gaan" naast de dagenteller
- het aantal diensten in de titel van de pushmelding
- een dienstbadge op het bericht van die dag
- een roosterpagina met mijlpalen: laatste vroege dienst, laatste middagdienst,
  **laatste nachtdienst**, laatste weekenddienst en laatste dienst ooit

Blijft het rooster leeg, dan rekent alles gewoon in dagen en verdwijnen die onderdelen.
Er gaat dus niets stuk.

Heb je het rooster als PDF, Excel of foto? Stuur het door, dan maak ik er een omzetter voor.

### 4. De 103 berichten met een kantoorritme

De berichten zijn geschreven vanuit een negen-tot-vijf-ritme. Bij ploegendienst klopt dat
niet. Draai:

```bash
node scripts/audit.mjs --lijst
```

Dat laat per bericht zien wat er misstaat. De stand nu:

| categorie | berichten |
|---|---|
| weekdagritme ("het is vrijdag", "nog X maandagen") | 74 |
| kantoorbaan (printer, Excel, Postvak In, functioneringsgesprek) | 34 |
| wekker / uitslapen | 11 |
| raakt minstens één werkritme-aanname | 103 |
| ritme-neutraal, blijft staan | 148 |

Van die 103 zijn er 33 waar de weekdag de kern van de grap is; die moeten helemaal
opnieuw. Arie werkt in de productie, dus de kantoorgrappen worden ploegoverdracht,
kantine, gehoorbescherming en de lijn die blijft draaien.

## Naar GitHub en Vercel

Er staat een commit klaar op branch `main`. De repo-identiteit is lokaal op
`OsmanVardar@users.noreply.github.com` gezet, zodat je werkmailadres niet in de
commits belandt. Wil je je echte privé-adres gebruiken:

```bash
git config user.email "jouwadres@voorbeeld.nl"
```

### Pushen

Dit moet vanuit een gewone terminal, want er komt een inlogvenster van GitHub bij:

```bash
git push -u origin main
```

Kies in dat venster het account **OsmanVardar**, niet een werkaccount. Lukt inloggen niet,
maak dan op GitHub een Personal Access Token aan met `repo`-rechten en gebruik die als
wachtwoord.

### Vercel eraan hangen

Het project bestaat al: `vercel.com/ovardar-5825/arie-pensioen`. Ga daar naar
**Settings → Git** en verbind de repo `OsmanVardar/Arie-Pensioen`. Daarna deployt elke
push automatisch.

Liever zonder GitHub? Dan vanuit een gewone terminal:

```bash
npm run deploy
```

Dat bouwt eerst lokaal en doet dan `vercel --prod`. Let bij de vraag *"Which scope?"* op
dat je **ovardar-5825** kiest en niet `olympia3`.

Vercel draait zelf geen build: `buildCommand` staat op een echo en `outputDirectory` op
`public`. Wat je uploadt is dus precies wat je lokaal getest hebt. Daarom altijd
`npm run deploy` gebruiken en niet los `vercel --prod`, anders zet je een oude build online.

### Het geheim instellen

In Vercel bij **Settings → Environment Variables**:

| naam | waarde | omgeving |
|---|---|---|
| `CRON_SECRET` | de waarde uit `.secrets-eenmalig.txt` | Production |

Deploy daarna nog één keer, want een nieuwe env-variabele geldt pas vanaf de volgende
deploy. Zonder deze variabele werkt alles ook, maar dan kan iedereen die het adres kent
`/api/cron` aanroepen. Kwaad kan dat niet — je krijgt hoogstens een dubbele push.

## ntfy op je telefoon

`ntfy` is een gratis pushdienst zonder account.

1. Installeer de app **ntfy** (Android: Play Store of F-Droid, iOS: App Store).
2. Tik op **+** en voeg dit topic toe:

   ```
   arie-pensioen-p4rsuww60x0ievwv
   ```

Wie het topic kent kan berichten naar je sturen, dus hou hem voor jezelf. Dit is de enige
stap die niemand anders voor je kan doen — zonder dit komt de push nergens aan.

## Testen

Zonder iets te versturen:

```bash
npm test
```

Een specifieke dag bekijken:

```bash
node scripts/testpush.mjs --dag 42
```

Echt versturen naar je telefoon:

```bash
node scripts/testpush.mjs --echt
```

Na de deploy, met de hand:

```bash
curl "https://JOUW-PROJECT.vercel.app/api/cron?secret=HET_GEHEIM"
```

Of eerst kijken wat er zou gebeuren zonder te versturen, door `&droog=1` toe te voegen.

## De site

```
https://JOUW-PROJECT.vercel.app/cgj8eewjdc7j2w3dwdltk2/
```

Onraadbaar pad, `noindex`, en `robots.txt` staat op alles weigeren. Zet hem op je
beginscherm. Drie pagina's:

- **Vandaag** — de teller, het bericht van vandaag, de WhatsApp-knop, en met de pijltjes
  vooruit- en terugkijken
- **Berichten** — alle berichten, zoekbaar, om na te lezen en te controleren
- **Rooster** — de diensten en de mijlpalen, of een uitleg zolang het rooster leeg is

Lokaal bekijken zonder deployen:

```bash
python -m http.server 4173 --directory public
```

## Over het tijdstip

De cron staat in `vercel.json` op `0 6 * * *`, dus 06:00 UTC: 08:00 in de zomertijd en
07:00 in de wintertijd.

Op het gratis Hobby-plan is dat **ongeveer** op tijd — Vercel start de run binnen het uur
na het ingestelde tijdstip. Voor een ochtendberichtje prima. Wil je het op de minuut,
maak dan een gratis account op [cron-job.org](https://cron-job.org), laat die dagelijks
`https://JOUW-PROJECT.vercel.app/api/cron?secret=HET_GEHEIM` aanroepen, en haal het
`crons`-blok uit `vercel.json`.

## Berichten aanpassen

Open het bestand in `content/` waar de dag in zit — de bestandsnamen geven het bereik — en
pas de tekst aan. De kop `### 117 | 2027-01-04` moet blijven staan zoals hij is. Daarna:

```bash
npm run build
```

De build controleert of alle 251 berichten er zijn en of elke datum klopt met het aantal
dagen, en stopt met een uitleg als er iets misstaat. Op de tekst zelf let hij niet: als je
"nog 117 dagen" in het bericht van dag 116 laat staan, klaagt niemand behalve Arie.

## Andere pensioendatum?

Pas `pensioendatum` in `config.json` aan. De build controleert dan alle datums opnieuw en
zegt per bericht welke datum er hoort te staan. Die koppen moet je met de hand bijwerken,
en de feestdaggrappen (Sinterklaas, kerst, carnaval, Pasen, 1 april, Koningsdag) staan dan
op de verkeerde dag.
