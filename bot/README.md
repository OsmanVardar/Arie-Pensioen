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

Op iets wat aan blijft staan:

- **Raspberry Pi** thuis. Gratis, en een Pi 3 of nieuwer is ruim voldoende.
- **Kleine VPS**, bijvoorbeeld Hetzner CX22 voor een paar euro per maand.
- **Een pc die je nooit uitzet.** Kan ook, maar als hij 's nachts uit gaat mist Arie
  zijn berichtje.

**Niet op Vercel.** Daar draaien functies die na een paar seconden weer stoppen, en
deze bot moet een WhatsApp-sessie in leven houden. Daarom staat `bot/` ook in
`.vercelignore`.

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
