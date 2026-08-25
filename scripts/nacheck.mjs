// Controleert de getallen die IN de berichttekst staan tegen de werkelijkheid.
//
//   node scripts/nacheck.mjs
//
// De build controleert of elke datum bij het juiste dagnummer hoort. Wat hij niet
// controleert is de tekst zelf: als er in het bericht van dag 116 "nog 117 dagen"
// staat, merkt niemand het tot Arie het leest.
//
// Dit script haalt uit elke tekst de genoemde aantallen dagen en diensten en legt
// die naast de echte waarden. Draai eerst `npm run build`.

import { CONFIG, BERICHTEN } from '../api/_data.js';

const DAGEN = /\bnog\s+(\d+)\s+dag(?:en)?\b/gi;
const DIENSTEN = /\bnog\s+(\d+)\s+dienst(?:en)?\b/gi;

const fouten = [];
const zonderDiensten = [];

for (const b of BERICHTEN) {
  const tekst = b.tekst;

  for (const m of tekst.matchAll(DAGEN)) {
    const genoemd = Number(m[1]);
    if (genoemd !== b.dag) {
      fouten.push({ dag: b.dag, soort: 'dagen', genoemd, echt: b.dag, zin: zin(tekst, m.index) });
    }
  }

  const dienstTreffers = [...tekst.matchAll(DIENSTEN)];

  if (CONFIG.heeftRooster && typeof b.dienstenTeGaan === 'number') {
    for (const m of dienstTreffers) {
      const genoemd = Number(m[1]);
      if (genoemd !== b.dienstenTeGaan) {
        fouten.push({ dag: b.dag, soort: 'diensten', genoemd, echt: b.dienstenTeGaan, zin: zin(tekst, m.index) });
      }
    }
    if (!dienstTreffers.length) zonderDiensten.push(b.dag);
  }
}

// dienstsoort die in de tekst genoemd wordt vergelijken met het rooster
const SOORTEN = {
  nachtdienst: 'nacht', nachtblok: 'nacht', ochtenddienst: 'vroeg',
  middagdienst: 'middag', roostervrij: 'vrij',
};

const soortFouten = [];
for (const b of BERICHTEN) {
  if (!b.dienst) continue;
  const t = b.tekst.toLowerCase();
  for (const [woord, soort] of Object.entries(SOORTEN)) {
    if (t.includes(woord) && b.dienst !== soort) {
      soortFouten.push({ dag: b.dag, woord, echt: b.dienst });
    }
  }
}

// ---- verslag -------------------------------------------------------------

console.log(`\n${BERICHTEN.length} berichten nagerekend.\n`);

if (fouten.length) {
  console.log(`FOUTE AANTALLEN (${fouten.length}):\n`);
  for (const f of fouten) {
    console.log(`  dag ${String(f.dag).padStart(3)}  zegt "${f.genoemd} ${f.soort}", moet ${f.echt} zijn`);
    console.log(`           ${f.zin}`);
  }
  console.log('');
} else {
  console.log('  Alle genoemde aantallen dagen en diensten kloppen.\n');
}

if (soortFouten.length) {
  console.log(`MOGELIJK VERKEERDE DIENSTSOORT (${soortFouten.length}):`);
  console.log('  (kan loos alarm zijn: "je laatste nachtdienst" mag op een vrije dag genoemd worden)\n');
  for (const f of soortFouten) {
    console.log(`  dag ${String(f.dag).padStart(3)}  noemt "${f.woord}", maar het rooster zegt ${f.echt}`);
  }
  console.log('');
}

if (zonderDiensten.length) {
  console.log(`Berichten zonder aantal diensten erin (${zonderDiensten.length}):`);
  console.log('  ' + zonderDiensten.join(', ') + '\n');
}

process.exit(fouten.length ? 1 : 0);

function zin(tekst, index) {
  const start = tekst.lastIndexOf('\n', index) + 1;
  let eind = tekst.indexOf('\n', index);
  if (eind === -1) eind = tekst.length;
  const r = tekst.slice(start, eind).trim();
  return r.length > 100 ? r.slice(0, 100) + '...' : r;
}
