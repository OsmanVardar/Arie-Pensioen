# De WhatsApp-bot

Verstuurt het berichtje van vandaag automatisch naar Arie, vanaf jouw eigen
WhatsApp-nummer. Jij hoeft er dan niets meer voor te doen.

## Lees dit eerst

Dit gebruikt **Baileys**, een onofficiële koppeling met WhatsApp. Het werkt zoals
WhatsApp Web: je koppelt één keer met een QR-code en daarna blijft de sessie leven.

WhatsApp staat dit niet officieel toe. De kans dat je nummer geblokkeerd wordt is klein
bij één berichtje per dag naar één vaste contactpersoon, maar hij is niet nul. Je hebt
die afweging gemaakt; ik noem hem hier nog één keer zodat het opgeschreven staat.

Wat de kans verder verkleint: één bericht per dag, altijd naar dezelfde persoon met wie
je toch al appt, en niets wat op massaverzending lijkt. Dat is precies wat deze bot doet.

## Waar draait dit

Op iets wat aan blijft staan. **Railway** is de bedoelde plek; de `Dockerfile` en
`railway.json` in de hoofdmap zijn daarvoor. Het kan ook op Fly.io, een VPS of een
Raspberry Pi thuis.

**Niet op Vercel.** Daar draaien functies die na hoogstens een minuut weer stoppen, en
deze bot moet een WhatsApp-sessie in leven houden. Meer betalen lost dat niet op, want
Vercel verkoopt geen blijvend proces. Daarom staat `bot/` ook in `.vercelignore`.

## Op Railway zetten

Zorg eerst dat het telefoonnummer erin staat, want de bot leest `api/_data.js`:

```bash
npm run build && git add -A && git commit -m "telefoonnummer" && git push
```

Dan op [railway.com](https://railway.com):

**1.** New Project → **Deploy from GitHub repo** → kies `OsmanVardar/Arie-Pensioen`.
Railway ziet de `Dockerfile` vanzelf; je hoeft niets te kiezen.

**2. Voeg een Volume toe.** Dit is de stap die je niet mag overslaan. In de service:
**Settings → Volumes → Add Volume**, mount path:

```
/data
```

Zonder dit staat de WhatsApp-sessie in het geheugen van de container, en die is weg bij
elke nieuwe deploy. Dan moet je elke keer opnieuw koppelen.

**3. Zet de omgevingsvariabelen.** Onder **Variables**:

| naam | waarde |
|---|---|
| `PANEL_TOKEN` | de waarde uit `.secrets-eenmalig.txt` |
| `STUURUUR` | optioneel, standaard `8` |
| `STUURMINUUT` | optioneel, standaard `0` |

`DATA_DIR` staat al op `/data` in de Dockerfile, en `PORT` zet Railway zelf.

**4. Maak een adres aan.** **Settings → Networking → Generate Domain**. Je krijgt iets als
`arie-pensioen-production.up.railway.app`.

**5. Koppelen.** Open in je browser:

```
https://JOUW-ADRES.up.railway.app/?k=HET_PANEL_TOKEN
```

Daar staat een QR-code. Scan die met **WhatsApp → Instellingen → Gekoppelde apparaten →
Apparaat koppelen**. De pagina slaat daarna om naar "verbonden" en de sessie staat op het
volume.

Dat is alles. Vanaf dan verstuurt hij elke ochtend om 08:00 vanzelf.

## Inhalen, en nooit dubbel

De bot werkt niet met "vandaag al iets verstuurd, ja of nee". Hij houdt in `stand.json`
bij **welke dagen** er de deur uit zijn, en verstuurt bij elke controle alles wat had
moeten gaan en nog niet weg is.

Daarmee zijn drie dingen in één regel geregeld:

- **Te laat begonnen.** Start je op dag 245, dan gaan 250 tot en met 245 er alsnog uit.
- **Bot lag eruit.** Drie dagen storing betekent drie berichten die alsnog volgen.
- **Gewone dag.** Dan is de wachtrij precies één bericht lang.

Berichten die te laat komen krijgen een regeltje erboven: _Gisteren:_, _Eergisteren:_ of
de datum. Anders krijgt hij twee appjes achter elkaar die allebei over "vandaag" gaan.

Tussen ingehaalde berichten zit standaard **45 seconden**. Een reeks in één seconde ziet
er voor WhatsApp uit als een bot, en dat is precies wat je niet wil. Aanpassen via
`inhaalPauze` in `config.json` of `INHAAL_PAUZE` als omgevingsvariabele.

De stand wordt **per bericht** weggeschreven. Valt de verbinding halverwege een
inhaalslag weg, dan gaat er niets dubbel als hij terugkomt.

### Van testnummer naar Arie

In `stand.json` staat naar wie er verstuurd is. Verandert dat nummer, dan begint de reeks
voor de nieuwe ontvanger **weer bij het begin**. Je kunt dus eerst rustig naar je eigen
nummer testen, en zodra je Arie's nummer invult krijgt hij netjes dag 250, 249 en zo
verder — ook al heb je die zelf al gezien.

In de logs zie je dat terug:

```
ontvanger is gewijzigd van 316... naar 316...
de reeks begint voor dit nummer opnieuw; 2 eerdere berichten worden niet meegerekend
```

Onder het allereerste bericht dat naar een nieuwe ontvanger gaat komt eenmalig de link
naar de website. Niet bij elk bericht, want dan zet WhatsApp er elke dag een linkvoorbeeld
onder.

## Het statuspaneel

Datzelfde adres is ook je controlepaneel. Je ziet er:

- of de bot verbonden is
- welke dag en hoeveel diensten het vandaag is
- wanneer er voor het laatst iets verstuurd is, en hoeveel in totaal
- de volledige tekst die vandaag de deur uit gaat

Zonder `?k=` krijg je een 404, dus deel dat adres niet. Er is één uitzondering:
`/gezond` is altijd bereikbaar zonder sleutel, want Railway gebruikt dat om te kijken of
de service nog leeft.

Raakt de koppeling ooit kwijt, dan verschijnt daar vanzelf weer een QR-code. Je hoeft dan
niet bij de server te kunnen: gewoon de pagina openen en opnieuw scannen.

## Installeren

Zet de repo op de machine, en dan:

```bash
cd bot && npm install
```

Controleer eerst of de tekst klopt, zonder verbinding en zonder iets te versturen:

```bash
npm run droog
```

Je ziet dan precies wat er vandaag verstuurd zou worden. Klopt het nummer nog niet, dan
zegt hij dat en stopt hij.

## Koppelen met WhatsApp

```bash
npm run koppel
```

Er verschijnt een QR-code in je terminal. Op je telefoon:

**WhatsApp → Instellingen → Gekoppelde apparaten → Apparaat koppelen**

Scan de code. De sessie komt in `bot/auth/` te staan en blijft geldig; dit hoef je maar
één keer te doen. Die map staat in `.gitignore` en hoort daar ook te blijven — wie hem
heeft kan namens jou appen.

## Draaien

```bash
npm start
```

Hij kijkt elke minuut of het al 08:00 Nederlandse tijd is en verstuurt dan het berichtje
van die dag. Daarna schrijft hij de datum weg in `stand.json`, zodat er nooit twee keer
op één dag iets uitgaat, ook niet na een herstart.

Een ander tijdstip:

```bash
STUURUUR=7 STUURMINUUT=30 npm start
```

De tijdzone van de machine maakt niet uit: er wordt altijd in Nederlandse tijd gerekend.

Meteen versturen, om te testen dat het echt aankomt:

```bash
npm run nu
```

## Automatisch opstarten met systemd

Op een Pi of VPS. Maak `/etc/systemd/system/arie.service`:

```ini
[Unit]
Description=Arie aftelling WhatsApp-bot
After=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/Arie-Pensioen/bot
ExecStart=/usr/bin/node bot.mjs
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
```

Pas `User` en `WorkingDirectory` aan, en dan:

```bash
sudo systemctl enable --now arie
```

Meekijken:

```bash
journalctl -u arie -f
```

## Zet de Vercel-cron uit

Zodra de bot draait, krijgt Arie zijn berichtje van de bot. De Vercel-cron stuurt
daarnaast nog steeds een push naar jouw telefoon met een WhatsApp-knop eronder — en dan
is de verleiding groot om hem nóg een keer te sturen.

De bot stuurt zelf al een korte bevestiging naar hetzelfde ntfy-topic ("Verstuurd naar
Arie"), dus je blijft zien dat het goed gegaan is.

Haal daarom het `crons`-blok uit `vercel.json` en deploy opnieuw, of zet de cron uit in
Vercel bij **Settings → Cron Jobs**.

## "Wachten op dit bericht" op je eigen telefoon

Dit is **geen storing** en je hoeft er niets aan te doen. Vastgesteld op 26 augustus 2026.

In je eigen WhatsApp blijven de verstuurde berichten staan als een grijs blok met
*"Wachten op dit bericht. Dit kan even duren."* De tekst zie je niet, wel een vinkje.

De bot is een gekoppeld apparaat van jouw account. Jouw telefoon krijgt van elk bericht
dat dat apparaat verstuurt een eigen versleutelde kopie, en die kan hij niet openmaken.
Daarom een placeholder in plaats van tekst. In de logs staat dezelfde storing de andere
kant op: `Bad MAC` en `Failed to decrypt message with any known session`, na tientallen
herverbindingen per dag met code 428. Dat is inherent aan een onofficiële koppeling en er
is van buitenaf niets aan te doen. Baileys 6.7.24 is al de nieuwste stabiele versie.

**Het versturen zelf gaat goed.** Bewezen op twee manieren: Arie heeft dag 250 en 249
gelezen en erop geantwoord, en een kopie naar een ander nummer kwam leesbaar aan.

Om diezelfde reden heeft een meelezer op het nummer waaraan de bot gekoppeld is geen zin:
dat loopt tegen precies dezelfde fout aan. Zet er een ánder nummer in.

Wil je zien wat er verstuurd is, gebruik dan een van deze drie, die allemaal niet van
WhatsApp-synchronisatie afhangen:

- de tabel **werkelijk verstuurd** op het statuspaneel
- de **ntfy-melding**, met de volledige tekst
- de pagina voor Arie zelf op `/arie`

## Als het misgaat

**Verbinding valt weg.** Dat gebeurt; hij probeert vanzelf elke tien seconden opnieuw.
Zolang de dag nog niet is weggeschreven in `stand.json` verstuurt hij alsnog zodra hij
terug is.

**"WhatsApp heeft de koppeling verbroken."** Je hebt het apparaat op je telefoon
losgekoppeld, of WhatsApp heeft de sessie ongeldig gemaakt. Verwijder `bot/auth/` en
draai `npm run koppel` opnieuw.

**Versturen mislukt.** Dan blijft `stand.json` onaangeroerd en probeert hij het de
volgende minuut weer. Er gaat dus niets verloren.

**Bericht niet aangekomen en je wilt hem alsnog.** Verwijder de regel `laatstVerstuurd`
uit `stand.json`, of draai `npm run nu`.

## Berichten aanpassen

De bot leest `../api/_data.js` — precies hetzelfde bestand dat de site en de
Vercel-functie gebruiken. Eén bron dus. Pas je iets aan in `content/`, draai dan in de
hoofdmap `npm run build`, haal de wijziging op de Pi binnen met `git pull`, en herstart
de bot.
