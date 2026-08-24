# Arie's aftelling

Elke ochtend een pushbericht op jouw telefoon met het berichtje van vandaag voor Arie,
plus een knop **Openen in WhatsApp** waarmee WhatsApp opent met de tekst er al in.
Jij drukt op verzenden. Het komt dus van jouw eigen nummer.

Aftellen naar **1 mei 2027**. 251 berichten, van dag 250 tot en met dag 0.

## Hoe het in elkaar zit

```
content/*.md      de 251 berichten - dit is het enige bestand dat je echt bewerkt
config.json       naam, datum, telefoonnummer, geheim pad, ntfy-topic
site/index.html   het sjabloon van de site
scripts/build.mjs bouwt content + config om naar public/ en api/_data.js
api/cron.js       de dagelijkse push (Vercel Cron -> ntfy -> jouw telefoon)
public/           wat Vercel serveert. Wordt gegenereerd, niet met de hand bewerken
```

De site is puur statisch: alle 251 berichten zitten in de pagina en de browser rekent
zelf uit welke dag het is. Er is dus geen database en geen server nodig.

## Eenmalig instellen

### 1. Telefoonnummer invullen

Zet in `config.json` het nummer van Arie in internationaal formaat, zonder `+` en zonder streepjes:

```json
"telefoon": "31612345678"
```

Daarna opnieuw bouwen:

```bash
npm run build
```

De build controleert ook meteen of alle 251 berichten aanwezig zijn en of elke datum
klopt met het aantal dagen. Bij een fout stopt hij en zegt hij precies wat er mis is.

### 2. ntfy op je telefoon

`ntfy` is een gratis pushdienst zonder account.

1. Installeer de app **ntfy** (Android: Play Store of F-Droid, iOS: App Store).
2. Tik op **+** om een topic toe te voegen.
3. Vul precies dit topic in (staat ook in `config.json`):

   ```
   arie-pensioen-p4rsuww60x0ievwv
   ```

Dat is het. Wie het topic kent kan berichten sturen, dus houd hem voor jezelf.

### 3. Op je eigen Vercel-account zetten

> **Dit is een privéproject. Het hoort niet in de Olympia-omgeving.**
>
> Het Vercel-account dat aan Claude gekoppeld is, kan maar één plek bereiken: het team
> `Olympia` (slug `olympia3`, Pro, met SAML). Daar hoort dit niet. Onderstaande stappen
> doe je daarom zelf, ingelogd met je **persoonlijke** mailadres. Er is geen GitHub bij
> nodig: de Vercel CLI uploadt rechtstreeks vanuit deze map.

**a. Account.** Maak op [vercel.com/signup](https://vercel.com/signup) een account aan met
je privé-mailadres. Kies het gratis **Hobby**-plan. Gebruik hier niet je Olympia-adres en
niet "Continue with GitHub" als dat je werk-GitHub is.

**b. CLI installeren en inloggen.**

```bash
npm install -g vercel
```

Was je hier al eens ingelogd met je werkaccount? Dan eerst uitloggen:

```bash
vercel logout
```

Daarna inloggen met je privé-adres, en controleren wie je bent:

```bash
vercel login
```

```bash
vercel whoami
```

Er moet nu je **persoonlijke** accountnaam staan. Staat er `olympia3`, dan ben je nog
met het verkeerde account bezig — dan opnieuw `vercel logout`.

**c. Deployen.**

```bash
npm run deploy
```

Dat draait eerst de lokale build en dan `vercel --prod`. De eerste keer stelt de CLI een
paar vragen:

| vraag | antwoord |
|---|---|
| Set up and deploy? | `yes` |
| Which scope do you want to deploy to? | **je persoonlijke account — níet Olympia** |
| Link to existing project? | `no` |
| What's your project's name? | bijv. `aftellen` (staat straks in de URL) |
| In which directory is your code located? | `./` |
| Want to modify these settings? | `no` — `vercel.json` regelt het al |

Die scope-vraag is de enige plek waar het mis kan gaan. Kies daar je eigen naam.

**d. Het geheim instellen.** Ga naar je project op vercel.com → **Settings → Environment
Variables** en voeg toe:

| naam | waarde | omgeving |
|---|---|---|
| `CRON_SECRET` | de waarde uit `.secrets-eenmalig.txt` | Production |

Vercel stuurt die automatisch mee bij elke cron-run. Deploy daarna nog één keer
(`npm run deploy`), want een nieuwe env-variabele geldt pas vanaf de volgende deploy.

Zonder deze variabele werkt alles ook, maar dan kan iedereen die het adres kent
`/api/cron` aanroepen. Kwaad kan dat niet — je krijgt dan alleen een dubbele push — maar
netter is netter.

**e. Optioneel: de URL vastzetten.** Vul na de eerste deploy `siteUrl` in `config.json` in
met de definitieve URL inclusief het geheime pad, en draai `npm run deploy` opnieuw.
Laat je het leeg, dan leidt de functie de URL zelf af uit het verzoek — dat werkt ook,
maar dan verwijst de melding naar de deploy-URL van dat moment.

**Later iets wijzigen?** Altijd via `npm run deploy`. Dat bouwt de content opnieuw én
deployt, zodat je nooit een oude versie online zet omdat je de build vergeten was.

**Wil je toch versiebeheer?** `git init` in deze map is genoeg voor een lokale historie
van je 13.000 woorden; een remote heb je niet nodig. `.gitignore` staat al goed.

### 4. Testen

Roep de functie één keer met de hand aan (vervang het geheim):

```bash
curl "https://JOUW-PROJECT.vercel.app/api/cron?secret=HET_GEHEIM"
```

Er hoort binnen een paar seconden een pushbericht op je telefoon te staan met twee
knoppen. Lokaal, zonder iets te versturen:

```bash
node scripts/testpush.mjs
```

En om te zien hoe een specifieke dag eruitkomt:

```bash
node scripts/testpush.mjs --dag 42
```

### 5. De site op je telefoon

De site staat op een onraadbaar pad en wordt niet geïndexeerd:

```
https://JOUW-PROJECT.vercel.app/cgj8eewjdc7j2w3dwdltk2/
```

Zet die op je beginscherm. Handig voor als je de push mist: je ziet het bericht van
vandaag, kunt vooruitkijken, en alle 251 berichten nalezen.

## Over het tijdstip

De cron staat in `vercel.json` op `0 6 * * *`, oftewel 06:00 UTC. Dat is 08:00 in de
zomertijd en 07:00 in de wintertijd.

Op het gratis Hobby-plan van Vercel is de cron **ongeveer** op tijd: de run wordt
binnen het uur na het ingestelde tijdstip gestart. Wil je het op de minuut precies,
maak dan een gratis account op [cron-job.org](https://cron-job.org), laat die elke dag
`https://JOUW-PROJECT.vercel.app/api/cron?secret=HET_GEHEIM` aanroepen, en haal het
`crons`-blok uit `vercel.json`.

## Berichten aanpassen

Open het bestand in `content/` waar de dag in zit (de bestandsnamen zeggen welk bereik)
en pas de tekst aan. De koptekst `### 117 | 2027-01-04` moet blijven staan zoals hij is.
Daarna:

```bash
npm run build
```

en opnieuw deployen. Verander je de aanhef of het aantal dagen in de tekst, dan let de
build daar niet op: dat is jouw tekst, dus lees het zelf even na.

## Als je een andere pensioendatum wilt

Pas `pensioendatum` in `config.json` aan. De build controleert dan alle 251 datums
opnieuw en zegt per bericht welke datum er hoort te staan. Je moet die koppen dan met de
hand bijwerken, en de feestdaggrappen (Sinterklaas, kerst, Koningsdag, 1 april) staan
dan op de verkeerde dag.
