<!--
  Dit blok wordt alleen gebruikt als het aftellen NIET op de eerste dag begint.

  Waarom: het bericht van dag 250 stelt zichzelf voor ("vanaf vandaag krijg je hier elke
  ochtend een berichtje"). Begin je later, dan zou die introductie nooit verstuurd worden
  en valt Arie midden in een reeks. Dit blok komt dan boven het eerste bericht te staan,
  en de aanhef van dat bericht wordt eraf gehaald zodat er niet twee keer "Beste Arie"
  boven staat.

  Zet de startdag in config.json bij "startdatum". Begin je wel op de eerste dag, dan
  wordt dit bestand overgeslagen.

  Vervangingen: {naam}  {dagen}  {diensten}
  Staat er geen rooster, dan wordt {diensten} gewoon leeg gelaten.
-->

Beste {naam},

Dit is de eerste van een lange reeks. Vanaf vandaag krijg je elke ochtend een berichtje, eentje minder elke dag, tot 1 mei 2027. Niemand heeft erom gevraagd en afmelden kan niet.

We beginnen bij {dagen}. Of, in de eenheid die er voor jou echt toe doet: {diensten}.
