// Verstuurt het berichtje van vandaag automatisch naar Arie via WhatsApp.
//
// Draait op een machine die aan blijft staan: een Raspberry Pi, een kleine VPS,
// of desnoods een pc die je nooit uitzet. Niet op Vercel - dat kan niet, want er
// moet een WhatsApp-sessie in leven blijven.
//
//   npm start              normaal draaien, wacht tot het tijdstip en verstuurt dan
//   npm run koppel         alleen koppelen (QR scannen) en weer stoppen
//   npm run droog          doet alsof: verbindt en laat zien wat er verstuurd zou worden
//   npm run nu             verstuurt het bericht van vandaag meteen, ook buiten het tijdstip
//
// De berichten komen uit ../api/_data.js, precies hetzelfde bestand dat de site en
// de Vercel-cron gebruiken. Eén bron, geen tweede kopie die uit de pas kan lopen.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import pino from 'pino';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';

import { CONFIG, BERICHTEN } from '../api/_data.js';

const hier = dirname(fileURLToPath(import.meta.url));

// Op Railway of Fly.io hoort dit op een volume te staan dat een herbouw overleeft.
// Zet DATA_DIR=/data en koppel daar een volume aan. Lokaal is de map bot/ prima.
const DATA = process.env.DATA_DIR || hier;
const AUTH = join(DATA, 'auth');
const STAND = join(DATA, 'stand.json');

const args = process.argv.slice(2);
const DROOG = args.includes('--droog');
const NU = args.includes('--nu');
const ALLEEN_KOPPELEN = args.includes('--koppel');

// tijdstip van verzenden, standaard 08:00 Nederlandse tijd
const UUR = Number(process.env.STUURUUR ?? 8);
const MINUUT = Number(process.env.STUURMINUUT ?? 0);

const NUMMER = (process.env.ARIE_TELEFOON || CONFIG.telefoon || '').replace(/[^0-9]/g, '');
const NTFY = process.env.NTFY_TOPIC || CONFIG.ntfyTopic || '';
const TZ = CONFIG.tijdzone || 'Europe/Amsterdam';

// Statuspaneel. Op Railway kun je geen QR uit een terminal scannen, dus die tonen we
// op een webpagina. Draait alleen als er een PORT is (die zet Railway zelf).
const PORT = Number(process.env.PORT || 0);
const PANEL_TOKEN = process.env.PANEL_TOKEN || '';
const PANEL_AAN = PORT > 0;
const PANEL_URL = process.env.PANEL_URL || '';

// ---- hulpjes -------------------------------------------------------------

let laatsteQR = null;
let laatsteFout = null;

const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a);

function vandaagISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function nuInNL() {
  const f = new Intl.DateTimeFormat('nl-NL', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const h = Number(f.find((p) => p.type === 'hour').value);
  const m = Number(f.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}

function dagenTot(iso) {
  return Math.round(
    (Date.parse(CONFIG.pensioendatum + 'T12:00:00Z') - Date.parse(iso + 'T12:00:00Z')) / 86400000
  );
}

function stand() {
  if (!existsSync(STAND)) return { laatstVerstuurd: null, aantal: 0 };
  try { return JSON.parse(readFileSync(STAND, 'utf8')); }
  catch { return { laatstVerstuurd: null, aantal: 0 }; }
}

function bewaarStand(s) {
  writeFileSync(STAND, JSON.stringify(s, null, 2) + '\n', 'utf8');
}

// Welk bericht hoort er vandaag te gaan? Geeft null als er niets moet.
function berichtVoorVandaag() {
  const vandaag = vandaagISO();
  const dagen = dagenTot(vandaag);

  if (dagen > CONFIG.startDag) {
    return { reden: `aftellen begint pas op ${CONFIG.startdatum} (dag ${CONFIG.startDag})`, dagen };
  }
  if (dagen < 0) {
    return { reden: 'de pensioendatum is voorbij', dagen };
  }

  const b = BERICHTEN.find((x) => x.dag === dagen);
  if (!b) return { reden: 'geen bericht voor deze dag', dagen };

  const tekst = CONFIG.introTekst && b.dag === CONFIG.startDag ? CONFIG.introTekst : b.tekst;
  return { bericht: b, tekst, dagen, datum: vandaag };
}

async function meldAanJezelf(tekst) {
  if (!NTFY) return;
  try {
    await fetch('https://ntfy.sh/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: NTFY,
        title: 'Verstuurd naar ' + CONFIG.naam,
        message: tekst,
        tags: ['white_check_mark'],
        priority: 2,
      }),
    });
  } catch (e) {
    log('ntfy-melding mislukt (niet erg):', e.message);
  }
}

// ---- statuspaneel --------------------------------------------------------

function startPaneel() {
  createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');

    // Railway pingt de service; dat mag zonder sleutel een 200 opleveren.
    if (url.pathname === '/gezond') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(verbonden ? 'verbonden' : 'niet verbonden');
      return;
    }

    if (PANEL_TOKEN && url.searchParams.get('k') !== PANEL_TOKEN) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Niets te zien hier.');
      return;
    }

    const s = stand();
    const u = berichtVoorVandaag();
    let qrSvg = '';
    if (laatsteQR) {
      try { qrSvg = await QRCode.toString(laatsteQR, { type: 'svg', margin: 1, width: 280 }); }
      catch { qrSvg = '<p>QR kon niet getekend worden, kijk in de logs.</p>'; }
    }

    const status = verbonden ? ['verbonden', '#0e6b4f']
      : laatsteQR ? ['koppelen nodig', '#d99a1f']
      : ['niet verbonden', '#d4573d'];

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' });
    res.end(`<!doctype html><html lang="nl"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bot ${CONFIG.naam}</title>
<style>
body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  max-width:32rem;margin:0 auto;padding:2rem 1.25rem;background:#fdf8f0;color:#22201c}
@media(prefers-color-scheme:dark){body{background:#14171b;color:#ece8e1}}
.kaart{background:#fff;border:1px solid #e8dcc8;border-radius:16px;padding:1.25rem;margin:1rem 0}
@media(prefers-color-scheme:dark){.kaart{background:#1e2329;border-color:#2f363e}}
.bal{display:inline-block;width:.6rem;height:.6rem;border-radius:99px;background:${status[1]};margin-right:.4rem}
h1{font-size:1.2rem} dt{font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;opacity:.6;margin-top:.75rem}
dd{margin:0;font-weight:600} pre{white-space:pre-wrap;font:inherit;opacity:.85}
svg{max-width:100%;height:auto;background:#fff;border-radius:12px;padding:.5rem}
</style>
<h1><span class="bal"></span>Bot voor ${CONFIG.naam} &mdash; ${status[0]}</h1>
${laatsteFout ? `<div class="kaart" style="border-color:#d4573d"><b>${laatsteFout}</b></div>` : ''}
${qrSvg ? `<div class="kaart"><b>Scan met WhatsApp</b><p style="opacity:.7;font-size:.9rem">
  Instellingen &rarr; Gekoppelde apparaten &rarr; Apparaat koppelen</p>${qrSvg}</div>` : ''}
<div class="kaart"><dl>
  <dt>vandaag</dt><dd>${u.dagen} dagen${u.bericht && typeof u.bericht.dienstenTeGaan === 'number' ? `, ${u.bericht.dienstenTeGaan} diensten` : ''}${u.bericht?.dienst ? ` &middot; ${u.bericht.dienst}` : ''}</dd>
  <dt>laatst verstuurd</dt><dd>${s.laatstVerstuurd || 'nog niets'}</dd>
  <dt>totaal verstuurd</dt><dd>${s.aantal || 0}</dd>
  <dt>verstuurt om</dt><dd>${String(UUR).padStart(2, '0')}:${String(MINUUT).padStart(2, '0')} (${TZ})</dd>
  <dt>ontvanger</dt><dd>+${NUMMER.slice(0, 4)}&hellip;${NUMMER.slice(-3)}</dd>
</dl></div>
<div class="kaart"><dt>bericht van vandaag</dt>
<pre>${(u.tekst || u.reden || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre></div>
</html>`);
  }).listen(PORT, () => log(`statuspaneel op poort ${PORT}`));
}

// ---- controles vooraf ----------------------------------------------------

const NUMMER_OK = /^[0-9]{8,15}$/.test(NUMMER) && NUMMER !== '31600000000';

if (!NUMMER_OK) {
  laatsteFout = `Het telefoonnummer klopt niet: "${NUMMER || 'leeg'}". ` +
    `Zet ARIE_TELEFOON bij de omgevingsvariabelen (internationaal, zonder + en zonder 0, ` +
    `dus 06-12345678 wordt 31612345678). Of zet het in config.json en draai npm run build.`;
  console.error('\n' + laatsteFout + '\n');

  // Draait er een statuspaneel, dan blijven we leven en tonen we de fout daar.
  // Afsluiten zou op een gehoste omgeving alleen een herstartlus opleveren waarin
  // niemand kan zien wat er mis is.
  if (!PANEL_AAN) process.exit(1);
}

mkdirSync(AUTH, { recursive: true });

// ---- verbinden -----------------------------------------------------------

let sok = null;
let verbonden = false;

async function verbind() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH);
  const { version } = await fetchLatestBaileysVersion();

  sok = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ['Arie aftelling', 'Chrome', '1.0.0'],
    markOnlineOnConnect: false,
  });

  sok.ev.on('creds.update', saveCreds);

  sok.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      laatsteQR = qr;
      console.log('\nScan deze code met WhatsApp op je telefoon:');
      console.log('   WhatsApp > Instellingen > Gekoppelde apparaten > Apparaat koppelen');
      if (PANEL_URL) console.log(`   Lukt scannen uit de logs niet? Open ${PANEL_URL}\n`);
      else console.log('');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      verbonden = true;
      laatsteQR = null;
      laatsteFout = null;
      log('verbonden met WhatsApp als', sok.user?.id?.split(':')[0] || 'onbekend');
      if (ALLEEN_KOPPELEN) {
        log('koppelen gelukt. De sessie staat in bot/auth/ en blijft geldig.');
        setTimeout(() => process.exit(0), 1500);
        return;
      }
      if (NU) await probeerTeVersturen(true);
    }

    if (connection === 'close') {
      verbonden = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      const uitgelogd = code === DisconnectReason.loggedOut;

      if (uitgelogd) {
        laatsteFout = 'WhatsApp heeft de koppeling verbroken. Verwijder de auth-map en koppel opnieuw.';
        console.error('\n' + laatsteFout + '\n');
        // niet afsluiten als het statuspaneel draait: dan kun je opnieuw koppelen
        // zonder eerst bij de server te moeten komen.
        if (!PANEL_AAN) process.exit(1);
        return;
      }
      log('verbinding weg (code ' + code + '), opnieuw proberen over 10 seconden');
      setTimeout(verbind, 10000);
    }
  });
}

// ---- versturen -----------------------------------------------------------

async function probeerTeVersturen(negeerTijd = false) {
  const s = stand();
  const vandaag = vandaagISO();

  // een droogloop mag altijd, ook als er vandaag al iets verstuurd is
  if (!DROOG && s.laatstVerstuurd === vandaag) {
    if (negeerTijd) log('vandaag is er al een bericht verstuurd, ik doe niets');
    return;
  }

  if (!DROOG && !negeerTijd && nuInNL() < UUR * 60 + MINUUT) return;

  const uitkomst = berichtVoorVandaag();
  if (!uitkomst.tekst) {
    log('niets te versturen:', uitkomst.reden);
    // toch vastleggen, anders blijft hij het de hele dag proberen
    bewaarStand({ ...s, laatstVerstuurd: vandaag, laatsteReden: uitkomst.reden });
    return;
  }

  const kop = `dag ${uitkomst.dagen}` +
    (typeof uitkomst.bericht.dienstenTeGaan === 'number'
      ? `, nog ${uitkomst.bericht.dienstenTeGaan} diensten` : '');

  if (DROOG) {
    console.log(`\n--- DROOGLOOP: dit zou nu naar +${NUMMER} gaan (${kop}) ---\n`);
    console.log(uitkomst.tekst);
    console.log('\n--- er is niets verstuurd ---\n');
    setTimeout(() => process.exit(0), 500);
    return;
  }

  if (!verbonden) { log('nog niet verbonden, ik wacht'); return; }

  try {
    await sok.sendMessage(NUMMER + '@s.whatsapp.net', { text: uitkomst.tekst });
    log(`verstuurd naar ${CONFIG.naam} (${kop})`);
    bewaarStand({
      laatstVerstuurd: vandaag,
      laatsteDag: uitkomst.dagen,
      aantal: (s.aantal || 0) + 1,
    });
    await meldAanJezelf(`${kop}\n\n${uitkomst.tekst.split('\n').slice(0, 4).join('\n')}...`);
  } catch (e) {
    log('VERSTUREN MISLUKT:', e.message);
    log('ik probeer het over een uur opnieuw, de stand blijft onaangeroerd');
  }
}

// ---- starten -------------------------------------------------------------

console.log(`\nArie's aftelling - WhatsApp-bot`);
console.log(`  ontvanger   +${NUMMER}`);
console.log(`  tijdstip    ${String(UUR).padStart(2, '0')}:${String(MINUUT).padStart(2, '0')} (${TZ})`);
console.log(`  vandaag     dag ${dagenTot(vandaagISO())}`);
console.log(`  stand       ${stand().laatstVerstuurd ? 'laatst verstuurd op ' + stand().laatstVerstuurd : 'nog niets verstuurd'}`);
if (DROOG) console.log(`  MODUS       droogloop, er wordt niets verstuurd`);
console.log('');

// Een droogloop verbindt niet met WhatsApp: hij rekent alleen uit wat er zou gaan.
// Zo kun je de tekst controleren zonder je telefoon erbij te pakken.
if (DROOG) {
  await probeerTeVersturen(true);
  process.exit(0);
}

if (PANEL_AAN) startPaneel();

if (NUMMER_OK) {
  await verbind();
} else {
  log('geen geldig telefoonnummer, ik verbind niet met WhatsApp');
  log('zet ARIE_TELEFOON goed en herstart; de fout staat ook op het statuspaneel');
}

if (NUMMER_OK && !ALLEEN_KOPPELEN && !NU) {
  // elke minuut kijken of het tijd is. Goedkoop, en overleeft een herstart netjes.
  setInterval(() => { probeerTeVersturen().catch((e) => log('fout:', e.message)); }, 60000);
  log(`wachtend tot ${String(UUR).padStart(2, '0')}:${String(MINUUT).padStart(2, '0')}`);
}

process.on('SIGINT', () => { log('gestopt'); process.exit(0); });
process.on('SIGTERM', () => { log('gestopt'); process.exit(0); });
