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
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';

import { CONFIG, BERICHTEN } from '../api/_data.js';

const hier = dirname(fileURLToPath(import.meta.url));
const AUTH = join(hier, 'auth');
const STAND = join(hier, 'stand.json');

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

// ---- hulpjes -------------------------------------------------------------

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

// ---- controles vooraf ----------------------------------------------------

if (!/^[0-9]{8,15}$/.test(NUMMER) || NUMMER === '31600000000') {
  console.error(`\nHet telefoonnummer klopt niet: "${NUMMER}"`);
  console.error('Zet het echte nummer in config.json (of in de omgevingsvariabele ARIE_TELEFOON)');
  console.error('en draai daarna in de hoofdmap: npm run build\n');
  process.exit(1);
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
      console.log('\nScan deze code met WhatsApp op je telefoon:');
      console.log('   WhatsApp > Instellingen > Gekoppelde apparaten > Apparaat koppelen\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      verbonden = true;
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
        console.error('\nWhatsApp heeft de koppeling verbroken.');
        console.error('Verwijder de map bot/auth en draai opnieuw: npm run koppel\n');
        process.exit(1);
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

await verbind();

if (!ALLEEN_KOPPELEN && !NU) {
  // elke minuut kijken of het tijd is. Goedkoop, en overleeft een herstart netjes.
  setInterval(() => { probeerTeVersturen().catch((e) => log('fout:', e.message)); }, 60000);
  log(`wachtend tot ${String(UUR).padStart(2, '0')}:${String(MINUUT).padStart(2, '0')}`);
}

process.on('SIGINT', () => { log('gestopt'); process.exit(0); });
process.on('SIGTERM', () => { log('gestopt'); process.exit(0); });
