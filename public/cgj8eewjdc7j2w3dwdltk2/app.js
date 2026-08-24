// Gedeelde logica voor alle pagina's. Alles rekent in de Nederlandse tijdzone,
// ongeacht waar de telefoon of laptop staat.

window.Aftellen = (function () {
  var cfg = window.CONFIG;
  var alles = window.BERICHTEN;

  var perDag = {};
  alles.forEach(function (b) { perDag[b.dag] = b; });

  var maanden = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];
  var weekdagen = ['zondag','maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag'];

  function vandaagISO() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: cfg.tijdzone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
  }

  function dagenTot(iso) {
    return Math.round((Date.parse(cfg.pensioendatum + 'T12:00:00Z') - Date.parse(iso + 'T12:00:00Z')) / 86400000);
  }

  function langeDatum(iso) {
    var d = new Date(iso + 'T12:00:00Z');
    return weekdagen[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + maanden[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  function korteDatum(iso) {
    var d = new Date(iso + 'T12:00:00Z');
    return d.getUTCDate() + ' ' + maanden[d.getUTCMonth()].slice(0, 3);
  }

  var dagVandaag = dagenTot(vandaagISO());

  // welk bericht is vandaag aan de beurt
  function actueleDag() {
    if (dagVandaag > cfg.startDag) return cfg.startDag;   // aftellen begint nog niet
    if (dagVandaag > cfg.hoogsteDag) return cfg.hoogsteDag;
    if (dagVandaag < 0) return 0;
    return dagVandaag;
  }

  // het introblok hoort alleen bij het allereerste bericht dat verstuurd wordt
  function tekstVoor(dag) {
    var b = perDag[dag];
    if (!b) return '';
    if (cfg.intro && dag === cfg.startDag) return cfg.intro + '\n\n' + b.tekst;
    return b.tekst;
  }

  function waLink(dag) {
    var nummer = (cfg.telefoon || '').replace(/[^0-9]/g, '');
    return 'https://wa.me/' + nummer + '?text=' + encodeURIComponent(tekstVoor(dag));
  }

  function nummerOk() {
    var n = (cfg.telefoon || '').replace(/[^0-9]/g, '');
    return /^[0-9]{8,15}$/.test(n) && n !== '31600000000';
  }

  function verstuurd(dag, zetten) {
    var sleutel = 'verstuurd:' + dag;
    try {
      if (zetten === undefined) return localStorage.getItem(sleutel) === '1';
      if (zetten) localStorage.setItem(sleutel, '1'); else localStorage.removeItem(sleutel);
    } catch (e) { return false; }
  }

  function aantalVerstuurd() {
    var n = 0;
    for (var d = cfg.startDag; d >= 0; d--) if (verstuurd(d)) n++;
    return n;
  }

  var MIJLPAALNAMEN = {
    'laatste-vroeg': 'laatste vroege dienst',
    'laatste-middag': 'laatste middagdienst',
    'laatste-nacht': 'laatste nachtdienst',
    'laatste-weekenddienst': 'laatste weekenddienst',
    'laatste-dienst': 'laatste dienst ooit'
  };

  function navTekenen(huidig) {
    var links = [
      ['index.html', 'Vandaag'],
      ['berichten.html', 'Berichten'],
      ['rooster.html', 'Rooster']
    ];
    var nav = document.createElement('nav');
    links.forEach(function (l) {
      var a = document.createElement('a');
      a.href = l[0];
      a.textContent = l[1];
      if (l[0] === huidig) a.setAttribute('aria-current', 'page');
      nav.appendChild(a);
    });
    var wrap = document.querySelector('.wrap');
    wrap.insertBefore(nav, wrap.firstChild);
  }

  function waarschuwingen() {
    var w = [];
    if (!nummerOk()) {
      w.push('Het telefoonnummer staat nog op de standaardwaarde. Zet het echte nummer in config.json en draai npm run build.');
    }
    if (dagVandaag > cfg.startDag) {
      w.push('Het aftellen begint op ' + langeDatum(cfg.startdatum) + '. Je ziet nu het eerste bericht.');
    }
    if (dagVandaag < 0) {
      w.push(cfg.naam + ' is al met pensioen. Je ziet het laatste bericht.');
    }
    return w;
  }

  return {
    cfg: cfg, alles: alles, perDag: perDag,
    dagVandaag: dagVandaag, actueleDag: actueleDag,
    tekstVoor: tekstVoor, waLink: waLink, nummerOk: nummerOk,
    verstuurd: verstuurd, aantalVerstuurd: aantalVerstuurd,
    langeDatum: langeDatum, korteDatum: korteDatum,
    MIJLPAALNAMEN: MIJLPAALNAMEN,
    navTekenen: navTekenen, waarschuwingen: waarschuwingen
  };
})();
