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
import { setDefaultResultOrder } from 'node:dns';
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

// Node kiest sinds versie 17 vaak eerst een IPv6-adres. Heeft de omgeving geen
// werkende IPv6-route - op Railway staat Outbound IPv6 standaard uit - dan mislukt
// zo'n verbinding met een kale "fetch failed". Dat trof precies de ntfy-meldingen.
setDefaultResultOrder('ipv4first');

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

// Tijdstip van verzenden. Staat in config.json, zodat de site precies weet vanaf
// wanneer het bericht van vandaag getoond mag worden. Env-variabelen winnen.
const [CFG_UUR, CFG_MIN] = String(CONFIG.verstuurTijd || '08:00').split(':').map(Number);
const UUR = Number(process.env.STUURUUR ?? CFG_UUR);
const MINUUT = Number(process.env.STUURMINUUT ?? CFG_MIN);

const NUMMER = (process.env.ARIE_TELEFOON || CONFIG.telefoon || '').replace(/[^0-9]/g, '');

// Nummers die een kopie meekrijgen. Dit zijn NIET de hoofdontvanger: die staat in de
// stand en bepaalt of de reeks opnieuw begint. Een meelezer toevoegen of weghalen
// mag Arie zijn reeks niet opnieuw laten beginnen.
const MEELEZERS = (process.env.MEELEZERS
  ? process.env.MEELEZERS.split(',')
  : (CONFIG.meelezers || []))
  .map((n) => String(n).replace(/[^0-9]/g, ''))
  .filter((n) => /^[0-9]{8,15}$/.test(n) && n !== NUMMER);
const NTFY = process.env.NTFY_TOPIC || CONFIG.ntfyTopic || '';
const TZ = CONFIG.tijdzone || 'Europe/Amsterdam';

// Statuspaneel. Op Railway kun je geen QR uit een terminal scannen, dus die tonen we
// op een webpagina.
//
// Standaard 8080, want dat is de poort die je bij Railway opgeeft onder
// Networking > Generate Service Domain. Zet Railway zelf een PORT, dan wint die.
// Draai je dit thuis en wil je geen poort open, zet dan PANEL_UIT=1.
const PORT = process.env.PANEL_UIT ? 0 : Number(process.env.PORT || 8080);
const PANEL_TOKEN = process.env.PANEL_TOKEN || '';
const PANEL_AAN = PORT > 0;
const PANEL_URL = process.env.PANEL_URL || '';

// Seconden tussen twee ingehaalde berichten.
const PAUZE = Number(process.env.INHAAL_PAUZE ?? CONFIG.inhaalPauze ?? 45);

// Voorkomt dat een tweede tik van de klok midden in een inhaalslag begint.
let bezig = false;

// ---- hulpjes -------------------------------------------------------------

let laatsteQR = null;
let laatsteFout = null;

// De versleutelingslaag (libsignal) schrijft rechtstreeks naar console.log en
// braakt bij elke sessiewissel tientallen regels met sleutelmateriaal uit. Daardoor
// zijn de logs niet meer te lezen en verdwijnen de regels die je wel nodig hebt.
// Die ruis filteren we eruit; de meldingen die iets betekenen blijven staan.
const RUIS = [
  /^Closing session: SessionEntry/, /^\s*(_chains|indexInfo|currentRatchet|pendingPreKey|ephemeralKeyPair)\s*[:{]/,
  /^\s*(baseKey|baseKeyType|closed|used|created|remoteIdentityKey|registrationId|rootKey|privKey|pubKey|lastRemoteEphemeralKey|previousCounter|chainKey|signedKeyId|preKeyId|messageKeys)\s*:/,
  /^\s*'?B[A-Za-z0-9+/=]{20,}'?\s*:/, /^\s*[}\],]+,?\s*$/,
  /^\s*at (Object\.verifyMAC|SessionCipher|async |_asyncQueueExecutor)/,
];
let ruisTeller = 0;
for (const kanaal of ['log', 'error', 'warn']) {
  const echt = console[kanaal].bind(console);
  console[kanaal] = (...a) => {
    const eerste = typeof a[0] === 'string' ? a[0] : '';
    if (RUIS.some((r) => r.test(eerste))) { ruisTeller++; return; }
    echt(...a);
  };
}

const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a);

// Alles wat uit config of berichten komt gaat door het statuspaneel heen, dus ontsnappen.
const esc = (s) => String(s).replace(/[<>&"]/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// Elk uur even melden hoeveel ruis er onderdrukt is, zodat je weet dat het leeft
// en niet denkt dat de bot stil is gevallen.
setInterval(() => {
  if (ruisTeller) { log(`(${ruisTeller} regels versleutelingsruis onderdrukt in het afgelopen uur)`); ruisTeller = 0; }
}, 3600000);

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

const LEEG = { ontvanger: null, verstuurd: [], laatstVerstuurd: null, aantal: 0 };
let wisselGemeld = false;

// De stand houdt bij welke dagen er al de deur uit zijn. Niet alleen "laatst
// verstuurd op datum X", want dan kan een inhaalslag niet en zou een dag die
// gemist is nooit meer goedgemaakt worden.
//
// De ontvanger staat erbij. Verandert die - bijvoorbeeld van een testnummer naar
// het echte nummer van Arie - dan begint de reeks voor die nieuwe ontvanger
// gewoon weer bij het begin. Anders zou Arie de eerste berichten nooit krijgen
// omdat ze "al verstuurd" zijn naar iemand anders.
function stand() {
  if (!existsSync(STAND)) return { ...LEEG, ontvanger: NUMMER };
  let s;
  try { s = JSON.parse(readFileSync(STAND, 'utf8')); }
  catch { return { ...LEEG, ontvanger: NUMMER }; }

  if (!Array.isArray(s.verstuurd)) s.verstuurd = [];

  if (s.ontvanger && s.ontvanger !== NUMMER) {
    if (!wisselGemeld) {
      wisselGemeld = true;
      log(`ontvanger is gewijzigd van ${s.ontvanger} naar ${NUMMER}`);
      log(`de reeks begint voor dit nummer opnieuw; ${s.verstuurd.length} eerdere berichten worden niet meegerekend`);
    }
    return { ...LEEG, ontvanger: NUMMER, vorigeOntvanger: s.ontvanger };
  }
  return { ...s, ontvanger: NUMMER };
}

function bewaarStand(s) {
  writeFileSync(STAND, JSON.stringify(s, null, 2) + '\n', 'utf8');
}

// Alle dagen die verstuurd hadden moeten zijn en dat nog niet zijn, oudste eerst.
// Het bericht van vandaag zit er alleen bij als de verzendtijd geweest is.
function wachtrij(negeerTijd = false) {
  const s = stand();
  const gedaan = new Set(s.verstuurd);
  const dagenNu = dagenTot(vandaagISO());
  const opTijd = negeerTijd || nuInNL() >= UUR * 60 + MINUUT;

  const rij = [];
  for (let d = CONFIG.startDag; d >= Math.max(dagenNu, 0); d--) {
    if (gedaan.has(d)) continue;
    if (d === dagenNu && !opTijd) continue;   // vandaag mag pas na de verzendtijd
    if (d < dagenNu) continue;                // nooit vooruit
    rij.push(d);
  }
  return rij;
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

  const payload = JSON.stringify({
    topic: NTFY,
    title: 'Verstuurd naar ' + CONFIG.naam,
    message: tekst,
    tags: ['white_check_mark'],
    priority: 2,
  });

  // Drie pogingen. Dit is de enige manier waarop jij ziet dat het gelukt is, dus
  // een enkele hik mag hem niet stilletjes laten vallen.
  for (let poging = 1; poging <= 3; poging++) {
    try {
      const r = await fetch('https://ntfy.sh/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) { if (poging > 1) log(`ntfy-melding gelukt bij poging ${poging}`); return; }
      log(`ntfy-melding gaf status ${r.status} (poging ${poging}/3)`);
    } catch (e) {
      // e.message is bij fetch vaak alleen "fetch failed"; de echte reden zit in cause
      const reden = [e.message, e.cause?.code, e.cause?.message].filter(Boolean).join(' | ');
      log(`ntfy-melding mislukt (poging ${poging}/3): ${reden}`);
    }
    if (poging < 3) await new Promise((r) => setTimeout(r, poging * 3000));
  }
  log('ntfy-melding definitief niet gelukt; het bericht naar ' + CONFIG.naam + ' is wel verstuurd');
}

// Stuurt dezelfde tekst naar de meelezers en zet er een ntfy-melding bij.
//
// Dit gebeurt altijd ná het wegschrijven van de stand: mislukt een kopie, dan mag dat
// er nooit voor zorgen dat het bericht naar de hoofdontvanger opnieuw wordt verstuurd.
async function stuurKopieen(tekst, kop) {
  for (const mee of MEELEZERS) {
    if (!verbonden) { log(`geen verbinding, kopie naar ${mee} overgeslagen`); continue; }
    try {
      await new Promise((r) => setTimeout(r, 2000));
      await sok.sendMessage(mee + '@s.whatsapp.net', { text: tekst });
      log(`kopie verstuurd naar ${mee}`);
    } catch (e) {
      log(`kopie naar ${mee} mislukt (${CONFIG.naam} heeft het bericht wel): ${e.message}`);
    }
  }
  await meldAanJezelf(`${kop}\n\n${tekst}`);
}

// ---- statuspaneel --------------------------------------------------------

// Alle verstuurde dagen als tabelrijen, meest recent eerst. We gaan uit van de lijst
// verstuurde dagen en niet van het logboek: berichten die door een oudere versie zijn
// verstuurd staan niet in dat logboek, en juist die wil je opnieuw kunnen sturen.
function rijenVerstuurd(s) {
  const perDag = new Map((s.historie || []).map((h) => [h.dag, h]));
  return [...(s.verstuurd || [])]
    .sort((a, b) => a - b)          // laagste dagnummer is het meest recente bericht
    .map((dag) => {
      const h = perDag.get(dag);
      const b = BERICHTEN.find((x) => x.dag === dag);
      return {
        dag,
        wanneer: h?.wanneer || null,
        eersteRegel: h?.eersteRegel || (b ? b.tekst.split(/\r?\n/).filter(Boolean)[1] : ''),
      };
    });
}

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

    // Een dag opnieuw versturen. Handig als WhatsApp een bericht heeft laten
    // vallen: haal hem uit de lijst met verstuurde dagen en de wachtrij pakt hem op.
    if (url.pathname === '/opnieuw' && req.method === 'POST') {
      const dag = Number(url.searchParams.get('dag'));
      const st = stand();
      if (Number.isInteger(dag) && st.verstuurd.includes(dag)) {
        bewaarStand({ ...st, verstuurd: st.verstuurd.filter((d) => d !== dag) });
        log(`dag ${dag} weer in de wachtrij gezet op verzoek via het paneel`);
        probeerTeVersturen(true).catch((e) => log('opnieuw versturen mislukt:', e.message));
      }
      res.writeHead(302, { Location: '/?k=' + encodeURIComponent(PANEL_TOKEN) });
      res.end();
      return;
    }

    // Alleen een kopie naar de meelezers, zonder de hoofdontvanger en zonder de
    // stand aan te raken. Voor als je wil zien wat er verstuurd is zonder dat
    // Arie hetzelfde bericht een tweede keer krijgt.
    if (url.pathname === '/kopie' && req.method === 'POST') {
      const dag = Number(url.searchParams.get('dag'));
      const b = BERICHTEN.find((x) => x.dag === dag);
      if (b) {
        const tekst = CONFIG.introTekst && b.dag === CONFIG.startDag ? CONFIG.introTekst : b.tekst;
        const kop = `dag ${dag}` + (typeof b.dienstenTeGaan === 'number'
          ? `, nog ${b.dienstenTeGaan} diensten` : '') + ' (kopie, niet opnieuw naar ' + CONFIG.naam + ')';
        log(`kopie van dag ${dag} gevraagd via het paneel`);
        stuurKopieen(tekst, kop).catch((e) => log('kopie mislukt:', e.message));
      }
      res.writeHead(302, { Location: '/?k=' + encodeURIComponent(PANEL_TOKEN) });
      res.end();
      return;
    }

    const s = stand();
    const u = berichtVoorVandaag();
    const rij = wachtrij();
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
  <dt>klaar om te versturen</dt><dd>${rij.length
    ? `${rij.length} bericht${rij.length === 1 ? '' : 'en'} &mdash; dag ${rij.join(', ')}` : 'niets, alles is bij'}</dd>
  <dt>laatst verstuurd</dt><dd>${s.laatstVerstuurd || 'nog niets'}</dd>
  <dt>totaal verstuurd</dt><dd>${s.aantal || 0}</dd>
  <dt>verstuurt om</dt><dd>${String(UUR).padStart(2, '0')}:${String(MINUUT).padStart(2, '0')} (${TZ})</dd>
  <dt>ontvanger</dt><dd>+${NUMMER.slice(0, 4)}&hellip;${NUMMER.slice(-3)}</dd>
  ${MEELEZERS.length ? `<dt>kopie ook naar</dt><dd>${MEELEZERS.map((n) => '+' + n.slice(0, 4) + '&hellip;' + n.slice(-3)).join(', ')}</dd>` : ''}
</dl></div>
${(s.verstuurd || []).length ? `<div class="kaart"><dt>werkelijk verstuurd</dt>
<p style="font-size:.8rem;opacity:.6;margin:.3rem 0 0">Kwam een bericht niet aan? Dan zet de knop hem terug in de wachtrij.</p>
<table style="width:100%;border-collapse:collapse;font-size:.9rem;margin-top:.5rem">
${rijenVerstuurd(s).map((h) => `<tr>
  <td style="padding:.3rem .5rem .3rem 0;font-weight:700;white-space:nowrap">dag ${h.dag}</td>
  <td style="padding:.3rem .5rem;opacity:.6;white-space:nowrap;font-size:.8rem">${h.wanneer ? h.wanneer + ' UTC' : 'tijdstip niet vastgelegd'}</td>
  <td style="padding:.3rem 0;opacity:.85">${String(h.eersteRegel).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</td>
  <td style="padding:.3rem 0 .3rem .5rem;text-align:right;white-space:nowrap">
    ${MEELEZERS.length ? `<form method="post" action="/kopie?k=${encodeURIComponent(PANEL_TOKEN)}&amp;dag=${h.dag}" style="display:inline;margin:0"><button type="submit" title="Alleen naar de meelezers, ${esc(CONFIG.naam)} krijgt niets" style="font:inherit;font-size:.75rem;padding:.2rem .5rem;border:1px solid currentColor;border-radius:6px;background:none;color:inherit;opacity:.6;cursor:pointer">alleen ik</button></form>` : ''}
    <form method="post" action="/opnieuw?k=${encodeURIComponent(PANEL_TOKEN)}&amp;dag=${h.dag}" style="display:inline;margin:0 0 0 .3rem"><button type="submit" title="Opnieuw naar ${esc(CONFIG.naam)} en de meelezers" style="font:inherit;font-size:.75rem;padding:.2rem .5rem;border:1px solid currentColor;border-radius:6px;background:none;color:inherit;opacity:.6;cursor:pointer">opnieuw</button></form>
  </td>
</tr>`).join('')}
</table></div>` : ''}
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

// Voor een bericht dat te laat komt: benoemen wanneer het had moeten gaan.
// Anders krijgt hij twee appjes achter elkaar die allebei over "vandaag" gaan.
function wanneerLabel(dag, dagenNu, datum) {
  const verschil = dag - dagenNu;
  if (verschil <= 0) return null;
  if (verschil === 1) return 'Gisteren';
  if (verschil === 2) return 'Eergisteren';
  const d = new Date(datum + 'T12:00:00Z');
  const wd = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  const mn = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  return `${wd[d.getUTCDay()]} ${d.getUTCDate()} ${mn[d.getUTCMonth()]}`;
}

function tekstVoorDag(dag, dagenNu, eersteOoit) {
  const b = BERICHTEN.find((x) => x.dag === dag);
  if (!b) return null;

  let tekst = CONFIG.introTekst && b.dag === CONFIG.startDag ? CONFIG.introTekst : b.tekst;

  const label = wanneerLabel(dag, dagenNu, b.datum);
  if (label) tekst = `_${label}:_\n\n` + tekst;

  // De link naar de site komt alleen onder het allereerste bericht. Bij elk
  // bericht zou WhatsApp er ook elke dag een linkvoorbeeld bij zetten.
  if (eersteOoit && CONFIG.arieUrl) {
    tekst += `\n\nAlles teruglezen kan hier: ${CONFIG.arieUrl}`;
  }
  return { bericht: b, tekst };
}

async function probeerTeVersturen(negeerTijd = false) {
  const dagenNu = dagenTot(vandaagISO());
  const rij = wachtrij(negeerTijd || DROOG);

  if (DROOG) {
    const s = stand();
    console.log(`\n--- DROOGLOOP: ${rij.length} bericht(en) zouden naar +${NUMMER} gaan ---`);
    for (const dag of rij) {
      const o = tekstVoorDag(dag, dagenNu, s.verstuurd.length === 0 && dag === rij[0]);
      console.log(`\n=== dag ${dag} ===\n`);
      console.log(o.tekst);
    }
    console.log('\n--- er is niets verstuurd ---\n');
    setTimeout(() => process.exit(0), 500);
    return;
  }

  if (!rij.length) return;
  if (!verbonden) { log('nog niet verbonden, ik wacht'); return; }
  if (bezig) return;
  bezig = true;

  log(`${rij.length} bericht(en) te versturen: dag ${rij.join(', ')}`);

  try {
    for (let i = 0; i < rij.length; i++) {
      const dag = rij[i];
      const s = stand();
      if (s.verstuurd.includes(dag)) continue;

      const o = tekstVoorDag(dag, dagenNu, s.verstuurd.length === 0);
      if (!o) { log(`geen bericht voor dag ${dag}, overgeslagen`); continue; }

      await sok.sendMessage(NUMMER + '@s.whatsapp.net', { text: o.tekst });

      const kop = `dag ${dag}` + (typeof o.bericht.dienstenTeGaan === 'number'
        ? `, nog ${o.bericht.dienstenTeGaan} diensten` : '');
      log(`verstuurd (${kop})`);

      // Direct wegschrijven, per bericht. Valt de verbinding halverwege een
      // inhaalslag weg, dan gaat er niets dubbel als hij terugkomt.
      // Eigen logboek van wat er echt de deur uit is. WhatsApp kan op je telefoon
      // "Wachten op dit bericht" laten zien als het gekoppelde apparaat zijn eigen
      // kopie niet kan ontsleutelen; dan is dit de enige betrouwbare bron.
      const regel = {
        dag,
        wanneer: new Date().toISOString().slice(0, 19).replace('T', ' '),
        eersteRegel: o.tekst.split(/\r?\n/).filter(Boolean)[1] || '',
      };

      bewaarStand({
        ontvanger: NUMMER,
        verstuurd: [...s.verstuurd, dag],
        laatstVerstuurd: vandaagISO(),
        laatsteDag: dag,
        aantal: (s.aantal || 0) + 1,
        historie: [regel, ...(s.historie || [])].slice(0, 10),
      });

      await stuurKopieen(o.tekst, kop);

      // Even wachten tussen inhaalberichten. Een reeks in één seconde ziet er
      // voor WhatsApp uit als een bot, en dat is precies wat we niet willen.
      if (i < rij.length - 1) {
        log(`wacht ${PAUZE} seconden voor het volgende`);
        await new Promise((r) => setTimeout(r, PAUZE * 1000));
      }
    }
  } catch (e) {
    log('VERSTUREN MISLUKT:', e.message);
    log('de stand blijft staan op wat wel gelukt is; de rest volgt bij de volgende poging');
  } finally {
    bezig = false;
  }
}

// ---- starten -------------------------------------------------------------

console.log(`\nArie's aftelling - WhatsApp-bot`);
console.log(`  ontvanger   +${NUMMER}`);
if (MEELEZERS.length) console.log(`  meelezers   ${MEELEZERS.map((n) => '+' + n).join(', ')}`);
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
