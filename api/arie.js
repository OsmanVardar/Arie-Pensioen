import { CONFIG, BERICHTEN } from './_data.js';

// De pagina voor Arie zelf.
//
// Deze wordt bij elk bezoek op de server gemaakt, en niet als statisch bestand
// meegestuurd. Dat is met opzet: in een statische pagina zouden alle toekomstige
// berichten in de broncode staan, en dan is verbergen niet hetzelfde als weglaten.
// Wat hier niet in de HTML komt, heeft de bezoeker ook nooit gehad.

const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const WEEKDAGEN = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];

const esc = (s) => String(s).replace(/[<>&"]/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

function langeDatum(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  return `${WEEKDAGEN[d.getUTCDay()]} ${d.getUTCDate()} ${MAANDEN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export default function handler(req, res) {
  const tijdzone = CONFIG.tijdzone || 'Europe/Amsterdam';
  const vandaag = new Intl.DateTimeFormat('en-CA', {
    timeZone: tijdzone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  const dagenNu = Math.round(
    (Date.parse(CONFIG.pensioendatum + 'T12:00:00Z') - Date.parse(vandaag + 'T12:00:00Z')) / 86400000
  );

  // Het bericht van vandaag mag hier pas verschijnen nadat het via WhatsApp is
  // gegaan. Anders leest hij het hier eerder dan dat hij het krijgt, en dat haalt
  // de aardigheid eraf. We rekenen met de verzendtijd plus een kwartier speling,
  // zodat een trage verzending niet voor kan komen op de site.
  const [vu, vm] = String(CONFIG.verstuurTijd || '08:00').split(':').map(Number);
  const klok = new Intl.DateTimeFormat('nl-NL', {
    timeZone: tijdzone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const minutenNu = Number(klok.find((p) => p.type === 'hour').value) * 60
    + Number(klok.find((p) => p.type === 'minute').value);
  const alGeweest = minutenNu >= vu * 60 + vm + 15;

  // Nooit verder vooruit dan wat er echt verstuurd is, hoe vaak er ook ververst wordt.
  const grens = Math.min(Math.max(dagenNu, 0) + (alGeweest ? 0 : 1), CONFIG.startDag + 1);
  const gehad = BERICHTEN
    .filter((b) => b.dag <= CONFIG.startDag && b.dag >= grens)
    .sort((a, b) => a.dag - b.dag);

  const vandaagBericht = alGeweest ? gehad[0] : null;
  const eerder = alGeweest ? gehad.slice(1) : gehad;

  const tekstVan = (b) =>
    CONFIG.introTekst && b.dag === CONFIG.startDag ? CONFIG.introTekst : b.tekst;

  const gedaan = CONFIG.startDag - grens;
  const deel = gedaan / Math.max(CONFIG.startDag, 1);
  const omtrek = 2 * Math.PI * 88;

  const klaar = dagenNu <= 0;
  const diensten = vandaagBericht?.dienstenTeGaan;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  // Kort cachen. Een uur zou betekenen dat de versie van voor de verzendtijd
  // blijft hangen tot na het moment waarop het bericht zichtbaar had moeten zijn.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');

  res.status(200).send(`<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0e6b4f">
<title>${klaar ? 'Met pensioen' : `Nog ${dagenNu} dagen`}</title>
<link rel="icon" href="/arie-icoon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/arie.css">
</head>
<body${klaar ? ' class="feest"' : ''}>
<div class="wrap">

  <header class="hero">
    <div class="ring-wrap">
      <svg class="ring" viewBox="0 0 200 200" aria-hidden="true">
        <circle class="ring-bg" cx="100" cy="100" r="88"></circle>
        <circle class="ring-fg" cx="100" cy="100" r="88"
          style="stroke-dasharray:${omtrek};stroke-dashoffset:${(omtrek * (1 - deel)).toFixed(1)}"></circle>
      </svg>
      <div class="ring-inhoud">
        <div class="getal">${Math.max(dagenNu, 0)}</div>
        <div class="getal-label">${klaar ? 'klaar' : dagenNu === 1 ? 'dag' : 'dagen'}</div>
      </div>
    </div>
    <div class="subtitel">${klaar
      ? `<b>${esc(CONFIG.naam)} is met pensioen</b>`
      : `tot 1 mei 2027 &middot; <b>${gedaan}</b> van ${CONFIG.startDag} achter de rug`}</div>

    <div class="cijfers">
      ${typeof diensten === 'number' ? `<div class="cijfer"><b>${diensten}</b><span>${diensten === 1 ? 'dienst' : 'diensten'}</span></div>` : ''}
      <div class="cijfer"><b>${Math.ceil(Math.max(dagenNu, 0) / 7)}</b><span>${dagenNu <= 7 ? 'week' : 'weken'}</span></div>
      <div class="cijfer"><b>${gehad.length}</b><span>berichten</span></div>
    </div>
  </header>

  ${!alGeweest && dagenNu <= CONFIG.startDag && dagenNu >= 0 ? `
  <div class="leeg">Het berichtje van vandaag komt om ${esc(CONFIG.verstuurTijd || '08:00')}.</div>` : ''}

  ${vandaagBericht ? `
  <div class="kaart">
    <div class="kop">
      <span>${langeDatum(vandaagBericht.datum)} &middot; vandaag</span>
      ${vandaagBericht.dienst ? `<span class="dienst ${vandaagBericht.dienst}">${vandaagBericht.dienst === 'vroeg' ? 'ochtend' : vandaagBericht.dienst}</span>` : ''}
    </div>
    <div class="bericht">${esc(tekstVan(vandaagBericht))}</div>
  </div>` : ''}

  ${dagenNu > CONFIG.startDag ? `
  <div class="leeg">Het aftellen begint op ${langeDatum(CONFIG.startdatum)}.</div>` : ''}

  ${eerder.length ? `
  <h2>Eerder</h2>
  <div class="lijst">
    ${eerder.map((b) => `
    <details class="kaart" style="padding:.75rem 1rem;margin:0 0 .5rem">
      <summary><b class="n">${b.dag}</b> <span class="d">${langeDatum(b.datum)}</span></summary>
      <div class="bericht" style="margin-top:.9rem">${esc(tekstVan(b))}</div>
    </details>`).join('')}
  </div>` : ''}

  <p class="uitleg" style="text-align:center;margin-top:2.5rem">
    ${klaar ? 'Geniet ervan.' : 'Morgen weer eentje minder.'}
  </p>

</div>
</body>
</html>`);
}
