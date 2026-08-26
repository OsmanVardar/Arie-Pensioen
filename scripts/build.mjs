import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));

const DIENSTEN = ['vroeg', 'middag', 'nacht', 'vrij'];
const fouten = [];
const waarschuwingen = [];

// ---- 1. berichten inlezen ------------------------------------------------

const KOP = /^###\s+(\d+)\s*\|\s*(\d{4}-\d{2}-\d{2})\s*$/;

const berichten = [];
const bronnen = readdirSync(join(root, 'content'))
  .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
  .sort();

for (const bestand of bronnen) {
  const regels = readFileSync(join(root, 'content', bestand), 'utf8').split(/\r?\n/);
  let huidig = null;

  const sluit = () => {
    if (!huidig) return;
    const tekst = huidig.regels.join('\n').trim();
    if (!tekst) fouten.push(`${bestand}: bericht ${huidig.dag} is leeg`);
    berichten.push({ dag: huidig.dag, datum: huidig.datum, tekst, bron: bestand });
    huidig = null;
  };

  for (const regel of regels) {
    const kop = regel.match(KOP);
    if (kop) {
      sluit();
      huidig = { dag: Number(kop[1]), datum: kop[2], regels: [] };
    } else if (huidig) {
      huidig.regels.push(regel);
    }
  }
  sluit();
}

if (!berichten.length) {
  console.error('Geen berichten gevonden in content/.');
  process.exit(1);
}

// ---- 2. berichten controleren -------------------------------------------

const gezien = new Map();
for (const b of berichten) {
  if (gezien.has(b.dag)) fouten.push(`dag ${b.dag} staat dubbel (${gezien.get(b.dag)} en ${b.bron})`);
  gezien.set(b.dag, b.bron);

  const verwacht = datumVoorDag(b.dag);
  if (verwacht !== b.datum) fouten.push(`dag ${b.dag} in ${b.bron}: datum ${b.datum} hoort ${verwacht} te zijn`);
}

const hoogsteDag = Math.max(...berichten.map((b) => b.dag));
for (let d = hoogsteDag; d >= 0; d--) if (!gezien.has(d)) fouten.push(`dag ${d} ontbreekt`);

berichten.sort((a, b) => b.dag - a.dag);

// ---- 3. startdatum -------------------------------------------------------

const eersteDatum = datumVoorDag(hoogsteDag);
let startdatum = (config.startdatum || '').trim() || eersteDatum;

if (!/^\d{4}-\d{2}-\d{2}$/.test(startdatum)) {
  fouten.push(`startdatum "${startdatum}" is geen geldige datum (jjjj-mm-dd)`);
  startdatum = eersteDatum;
} else {
  const startDag = dagenTot(startdatum);
  if (startDag > hoogsteDag) fouten.push(`startdatum ${startdatum} ligt vóór het eerste bericht (${eersteDatum})`);
  if (startDag < 0) fouten.push(`startdatum ${startdatum} ligt na de pensioendatum`);
}

const startDag = dagenTot(startdatum);

// Val: startdatum leeg laten terwijl de eerste datum al voorbij is. Dan begint Arie
// middenin de reeks zonder introductie, want die zit in het bericht van dag 250.
if (!(config.startdatum || '').trim()) {
  const nu = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.tijdzone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  if (nu > eersteDatum) {
    waarschuwingen.push(
      `startdatum is leeg, dus het aftellen begint op ${eersteDatum} - maar het is al ${nu}. ` +
      `Arie valt dan midden in de reeks zonder introductie. Zet "startdatum" in config.json ` +
      `op de dag dat je het eerste bericht echt verstuurt; dan komt het introblok erbij.`
    );
  }
}

// Het introblok wordt verderop samengesteld, ná het rooster: het wil het aantal
// diensten kunnen noemen en dat staat pas na stap 4 op de berichten.

// ---- 4. rooster ----------------------------------------------------------

let rooster = { bron: '', diensten: {} };
const roosterPad = join(root, 'rooster.json');
if (existsSync(roosterPad)) {
  try {
    const ruw = JSON.parse(readFileSync(roosterPad, 'utf8'));
    rooster.bron = ruw.bron || '';
    for (const [datum, dienst] of Object.entries(ruw.diensten || {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) { fouten.push(`rooster: "${datum}" is geen geldige datum`); continue; }
      const d = String(dienst).toLowerCase().trim();
      if (!DIENSTEN.includes(d)) { fouten.push(`rooster ${datum}: "${dienst}" is geen geldige dienst (${DIENSTEN.join(', ')})`); continue; }
      rooster.diensten[datum] = d;
    }
  } catch (e) {
    fouten.push('rooster.json is geen geldige JSON: ' + e.message);
  }
}

const heeftRooster = Object.keys(rooster.diensten).length > 0;

// werkdiensten binnen het aftelvenster, op datum gesorteerd
const werkdagen = Object.entries(rooster.diensten)
  .filter(([datum, dienst]) => dienst !== 'vrij' && dagenTot(datum) >= 0 && dagenTot(datum) <= hoogsteDag)
  .map(([datum, dienst]) => ({ datum, dienst, dag: dagenTot(datum) }))
  .sort((a, b) => b.dag - a.dag);

// mijlpalen: de laatste keer dat een bepaalde dienstsoort voorkomt
const mijlpalen = {};
for (const soort of ['vroeg', 'middag', 'nacht']) {
  const laatste = werkdagen.filter((w) => w.dienst === soort).at(-1);
  if (laatste) mijlpalen['laatste-' + soort] = laatste.dag;
}
const laatsteDienst = werkdagen.at(-1);
if (laatsteDienst) mijlpalen['laatste-dienst'] = laatsteDienst.dag;

const weekend = werkdagen.filter((w) => [0, 6].includes(new Date(w.datum + 'T12:00:00Z').getUTCDay())).at(-1);
if (weekend) mijlpalen['laatste-weekenddienst'] = weekend.dag;

// per bericht de dienstinfo aanhangen
for (const b of berichten) {
  if (!heeftRooster) continue;
  const dienst = rooster.diensten[b.datum] ?? null;
  const teGaan = werkdagen.filter((w) => w.dag < b.dag).length;
  b.dienst = dienst;
  b.dienstenTeGaan = teGaan;
  const gehaald = Object.entries(mijlpalen).filter(([, dag]) => dag === b.dag).map(([k]) => k);
  if (gehaald.length) b.mijlpalen = gehaald;
}

if (heeftRooster) {
  const opPensioendag = werkdagen.filter((w) => w.dag === 0);
  if (opPensioendag.length) {
    waarschuwingen.push(
      `rooster: er staat een dienst (${opPensioendag[0].dienst}) op de pensioendatum ${config.pensioendatum}. ` +
      `Dat kan niet kloppen - zet die op "vrij" of haal de datum weg, anders wordt 1 mei zijn "laatste dienst ooit".`
    );
  }
  const buiten = Object.keys(rooster.diensten).filter((d) => dagenTot(d) < 0 || dagenTot(d) > hoogsteDag).length;
  if (buiten) waarschuwingen.push(`${buiten} roosterdatums vallen buiten het aftelvenster en worden niet meegerekend`);
  const zonder = berichten.filter((b) => !rooster.diensten[b.datum]).length;
  if (zonder) waarschuwingen.push(`${zonder} van de ${berichten.length} aftelddagen hebben nog geen dienst in het rooster`);
}

// ---- 4b. introblok -------------------------------------------------------
// Moet ná het rooster, want {diensten} leest dienstenTeGaan van het startbericht.

let introTekst = null;
if (startDag < hoogsteDag) {
  const eerste = berichten.find((b) => b.dag === startDag);
  const pad = join(root, 'content', '_intro.md');
  let intro = null;

  if (existsSync(pad)) {
    const ruw = readFileSync(pad, 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();
    if (ruw) {
      const teGaan = eerste?.dienstenTeGaan;
      intro = ruw
        .replace(/\{naam\}/g, config.naam)
        .replace(/\{dagen\}/g, startDag === 1 ? 'één dag' : `${startDag} dagen`)
        .replace(/\{diensten\}/g, teGaan === undefined
          ? 'geen idee, er staat nog geen rooster'
          : (teGaan === 1 ? 'één dienst' : `${teGaan} diensten`));
    }
  }

  if (!intro) {
    waarschuwingen.push('startdatum ligt na het eerste bericht, maar content/_intro.md is leeg of ontbreekt');
  } else if (!eerste) {
    fouten.push(`er is geen bericht voor dag ${startDag}, dus de startdatum kan niet kloppen`);
  } else {
    // het introblok heeft zelf al een aanhef; die van het bericht eronder moet eraf
    introTekst = intro + '\n\n' + eerste.tekst.replace(/^\s*Beste[^\n,]*,\s*\n+/, '');
  }
}

// ---- 5. stoppen bij fouten ----------------------------------------------

if (fouten.length) {
  console.error('\nBuild gestopt. Er zitten fouten in de content of het rooster:\n');
  for (const f of fouten) console.error('  x ' + f);
  console.error('');
  process.exit(1);
}

// ---- 6. wegschrijven ----------------------------------------------------

const schoon = berichten.map((b) => {
  const o = { dag: b.dag, datum: b.datum, tekst: b.tekst };
  if (b.dienst !== undefined) o.dienst = b.dienst;
  if (b.dienstenTeGaan !== undefined) o.dienstenTeGaan = b.dienstenTeGaan;
  if (b.mijlpalen) o.mijlpalen = b.mijlpalen;
  return o;
});

const gedeeld = {
  naam: config.naam,
  pensioendatum: config.pensioendatum,
  tijdzone: config.tijdzone,
  verstuurTijd: config.verstuurTijd || '08:00',
  inhaalPauze: Number(config.inhaalPauze ?? 45),
  arieUrl: config.arieUrl || '',
  telefoon: config.telefoon,
  meelezers: Array.isArray(config.meelezers) ? config.meelezers : [],
  startdatum,
  startDag,
  hoogsteDag,
  heeftRooster,
  roosterBron: rooster.bron,
  dienstenTotaal: werkdagen.length,
  mijlpalen,
  introTekst,
};

const siteMap = join(root, 'public', config.slug);
mkdirSync(siteMap, { recursive: true });

schrijf(join(siteMap, 'data.js'),
  `window.CONFIG = ${JSON.stringify(gedeeld, null, 2)};\nwindow.BERICHTEN = ${JSON.stringify(schoon)};\n`);

schrijf(join(root, 'api', '_data.js'),
  `export const CONFIG = ${JSON.stringify({ ...gedeeld, ntfyTopic: config.ntfyTopic, slug: config.slug, siteUrl: config.siteUrl }, null, 2)};\n` +
  `export const BERICHTEN = ${JSON.stringify(schoon)};\n`);

// alle pagina's en de stijl uit site/ overzetten
let paginas = 0;
for (const bestand of readdirSync(join(root, 'site'))) {
  if (!statSync(join(root, 'site', bestand)).isFile()) continue;
  schrijf(join(siteMap, bestand), readFileSync(join(root, 'site', bestand), 'utf8'));
  paginas++;
}

for (const map of readdirSync(join(root, 'public'), { withFileTypes: true })) {
  if (map.isDirectory() && map.name !== config.slug) {
    rmSync(join(root, 'public', map.name), { recursive: true, force: true });
    console.log(`  oude map public/${map.name} verwijderd`);
  }
}

schrijf(join(root, 'public', 'index.html'),
  '<!doctype html><meta charset="utf-8"><title>404</title><p style="font:16px system-ui;padding:2rem">Niets te zien hier.</p>\n');
schrijf(join(root, 'public', 'robots.txt'), 'User-agent: *\nDisallow: /\n');

// Arie's eigen pagina wordt door api/arie.js op de server gemaakt. Die heeft stijl en
// icoon nodig op een vast, openbaar pad: het geheime pad van jouw site mag daar niet
// in voorkomen, want dan kan hij vanaf zijn pagina bij alle 251 berichten.
schrijf(join(root, 'public', 'arie.css'), readFileSync(join(root, 'site', 'stijl.css'), 'utf8'));
schrijf(join(root, 'public', 'arie-icoon.svg'), readFileSync(join(root, 'site', 'icoon.svg'), 'utf8'));

// ---- 7. verslag ---------------------------------------------------------

console.log(`\n  ${schoon.length} berichten (dag ${hoogsteDag} t/m 0)`);
console.log(`  ${paginas} pagina's naar public/${config.slug}/`);
console.log(`  start op ${startdatum} bij dag ${startDag}${introTekst ? ' (met introblok)' : ''}`);
console.log(heeftRooster
  ? `  rooster: ${werkdagen.length} diensten, mijlpalen: ${Object.keys(mijlpalen).join(', ') || 'geen'}`
  : `  rooster: nog leeg, alles rekent in dagen`);

for (const w of waarschuwingen) console.log(`  ! ${w}`);
console.log(`\n  /${config.slug}/\n`);

// ---- hulpjes ------------------------------------------------------------

function schrijf(pad, inhoud) {
  mkdirSync(dirname(pad), { recursive: true });
  writeFileSync(pad, inhoud, 'utf8');
}

function datumVoorDag(dag) {
  const d = new Date(config.pensioendatum + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - dag);
  return d.toISOString().slice(0, 10);
}

function dagenTot(datum) {
  return Math.round((Date.parse(config.pensioendatum + 'T12:00:00Z') - Date.parse(datum + 'T12:00:00Z')) / 86400000);
}
