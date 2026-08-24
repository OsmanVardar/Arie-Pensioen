// Leest het ploegenrooster van arie.juliep.de en zet het om naar rooster.json.
//
//   node scripts/rooster-import.mjs                  haalt de pagina zelf op
//   node scripts/rooster-import.mjs pad/naar.html    leest een opgeslagen kopie
//
// De site zet per dag een rij neer met weekdag, dagnummer, maand, jaar en een
// dienstcode. De codes:
//
//   od = ochtenddienst   (groen)  -> vroeg
//   md = middagdienst    (geel)   -> middag
//   nd = nachtdienst     (rood)   -> nacht
//   rv = roostervrij     (zwart)  -> vrij
//
// Het cijfer erachter is de hoeveelste dag van dat blok het is; dat gebruiken we niet.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
const BRON = config.roosterUrl || 'https://www.arie.juliep.de/index.php?a';

const MAANDEN = {
  jan: 1, feb: 2, maart: 3, mrt: 3, apr: 4, mei: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12,
};

const CODES = { od: 'vroeg', md: 'middag', nd: 'nacht', rv: 'vrij' };

const WEEKDAGEN = ['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za'];

const RIJ = new RegExp(
  "<span style='color:[^']*;'>(?:&nbsp;)*([A-Za-z]{2})&nbsp;</span></td>\\s*" +
  "<td align='right'><span style='color:[^']*;'>(\\d{1,2})&nbsp;</span></td>\\s*" +
  "<td align='right'><span style='color:[^']*;'>([A-Za-z]{3,5})&nbsp;</span></td>\\s*" +
  "<td align='right'><span style='color:[^']*;'>(\\d{4})&nbsp;</span></td>\\s*" +
  "<td align='right'><span style='color:[^']*;'>([a-z]{2})\\s*\\d*&nbsp;</span></td>",
  'g'
);

// ---- html ophalen --------------------------------------------------------

const bestand = process.argv[2];
let html;

if (bestand) {
  html = readFileSync(bestand, 'utf8');
  console.log(`\nGelezen uit ${bestand} (${(html.length / 1024 / 1024).toFixed(1)} MB)`);
} else {
  console.log(`\nOphalen van ${BRON} ...`);
  const antwoord = await fetch(BRON);
  if (!antwoord.ok) {
    console.error(`Dat lukte niet: HTTP ${antwoord.status}`);
    process.exit(1);
  }
  html = await antwoord.text();
  console.log(`Binnen: ${(html.length / 1024 / 1024).toFixed(1)} MB`);
}

// ---- parsen --------------------------------------------------------------

const alle = [];
const fouten = [];
let match;

while ((match = RIJ.exec(html)) !== null) {
  const [, weekdag, dag, maandNaam, jaar, code] = match;
  const maand = MAANDEN[maandNaam.toLowerCase()];

  if (!maand) { fouten.push(`onbekende maand "${maandNaam}" bij ${dag} ${jaar}`); continue; }
  if (!CODES[code]) { fouten.push(`onbekende dienstcode "${code}" op ${dag}-${maand}-${jaar}`); continue; }

  const datum = `${jaar}-${String(maand).padStart(2, '0')}-${String(Number(dag)).padStart(2, '0')}`;

  // controle: klopt de weekdag die de site noemt met de datum?
  const echteWeekdag = WEEKDAGEN[new Date(datum + 'T12:00:00Z').getUTCDay()];
  if (echteWeekdag !== weekdag) {
    fouten.push(`${datum}: site zegt ${weekdag}, maar die datum is een ${echteWeekdag}`);
    continue;
  }

  alle.push({ datum, dienst: CODES[code], code });
}

console.log(`${alle.length} dagen gevonden, van ${alle[0]?.datum} tot ${alle.at(-1)?.datum}`);

if (fouten.length) {
  console.error(`\n${fouten.length} regels overgeslagen:`);
  for (const f of fouten.slice(0, 10)) console.error('  x ' + f);
  if (fouten.length > 10) console.error(`  ... en nog ${fouten.length - 10}`);
}

if (!alle.length) {
  console.error('\nNiets kunnen parsen. Waarschijnlijk is de opmaak van de site veranderd.');
  process.exit(1);
}

// ---- beperken tot het aftelvenster --------------------------------------

const pensioen = config.pensioendatum;
const dagenTot = (d) => Math.round((Date.parse(pensioen + 'T12:00:00Z') - Date.parse(d + 'T12:00:00Z')) / 86400000);

const venster = alle.filter((r) => dagenTot(r.datum) >= 0 && dagenTot(r.datum) <= 250);
venster.sort((a, b) => a.datum.localeCompare(b.datum));

// gaten opsporen
const gaten = [];
for (let n = 250; n >= 0; n--) {
  const d = new Date(Date.parse(pensioen + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10);
  if (!venster.find((r) => r.datum === d)) gaten.push(d);
}

// ---- wegschrijven --------------------------------------------------------

const diensten = {};
for (const r of venster) {
  // op de pensioendag werkt hij niet meer, wat er ook in het rooster staat
  diensten[r.datum] = dagenTot(r.datum) === 0 ? 'vrij' : r.dienst;
}

const uit = {
  bron: bestand ? `bestand: ${bestand}` : BRON,
  opgehaald: venster.length + ' dagen uit het aftelvenster',
  diensten,
};

writeFileSync(join(root, 'rooster.json'), JSON.stringify(uit, null, 1) + '\n', 'utf8');

// ---- verslag -------------------------------------------------------------

const telling = {};
for (const d of Object.values(diensten)) telling[d] = (telling[d] || 0) + 1;

console.log(`\nIn het aftelvenster (${venster.length} dagen):`);
for (const [soort, n] of Object.entries(telling).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${soort}`);
}
const werk = venster.length - (telling.vrij || 0);
console.log(`  ---`);
console.log(`  ${String(werk).padStart(3)}  diensten in totaal`);

if (gaten.length) {
  console.log(`\n! ${gaten.length} dagen ontbreken in de bron, o.a.: ${gaten.slice(0, 5).join(', ')}`);
} else {
  console.log(`\nGeen gaten: alle 251 dagen zitten erin.`);
}

if (diensten[pensioen] === 'vrij' && venster.find((r) => r.datum === pensioen && r.dienst !== 'vrij')) {
  console.log(`De bron zette een dienst op ${pensioen}; op zijn pensioendag gezet naar "vrij".`);
}

console.log(`\nrooster.json bijgewerkt. Draai nu: npm run build\n`);
