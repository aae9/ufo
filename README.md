# Informationsvisualisierung: UFO-Sichtungen

Projektwebseite: [http://91.98.92.228](http://91.98.92.228)

Das Projekt visualisiert dokumentierte UFO- bzw. UAP-Sichtungen aus zwei
komplementären Quellen und macht sie über mehrere aufeinander abgestimmte,
interaktive Darstellungen explorierbar (Kalender Heatmap, Zeitreihe, 3D Globus,
zoombares Treemap und eine Dokumentenrecherche der freigegebenen Akten).

## Datensatz

Es wurden zwei Datensätze visualisiert und ausgewertet.

1. **NUFORC**: Der [Datensatz](https://huggingface.co/datasets/kcimc/NUFORC)
   des *National UFO Reporting Center* umfasst Sichtungsmeldungen von *1400*
   bis *2023* mit strukturierten Attributen (Datum und Uhrzeit, Ort, Land,
   gemeldete Form, Dauer, Freitextbeschreibung sowie geografische Koordinaten).
2. **Release 1**: Der vom `Department of War` freigegebene
   [Datensatz](https://www.war.gov/ufo/) enthält Sichtungen in Form von
   PDF-Dokumenten, Bildern und Videos (Missionsberichte, Depeschen,
   Fotomaterial und Aufzeichnungen).

### Warum wurden die Datensätze gewählt

Die beiden Quellen wurden als Ergänzung zueinander ausgewählt. Der
NUFORC Datensatz liefert eine große, konsistent strukturierte Zeitreihe über
mehrere Jahrhunderte und eignet sich damit für quantitative, aggregierte
Darstellungen (zeitliche Verläufe, räumliche Verteilung, Formhäufigkeiten).
Der Release-1 Datensatz ergänzt diese statistische Perspektive um
offiziell freigegebenes Primärmaterial und stellt einen qualitativen,
dokumentzentrierten Zugang bereit. Die Kombination erlaubt es, von der
aggregierten Übersicht bis zum einzelnen Originaldokument zu navigieren und
so sowohl das Gesamtbild als auch belegbare Einzelfälle abzubilden. Beide
Datensätze sind öffentlich zugänglich, thematisch klar umrissen und
inhaltlich unbedenklich.

### Wie wurden die Daten aufbereitet und abgebildet

Der NUFORC Rohdatensatz wurde bereinigt (`nuforc_str_cleaned.csv`).
Datumsangaben wurden normalisiert, unplausible oder unvollständige Datensätze
entfernt und die Attribute für Ort, Land, Form und Koordinaten
vereinheitlicht. Für die aggregierten Darstellungen werden die Sichtungen zur
Laufzeit im Browser mit `d3.csv` geladen und in eine dreistufige Hierarchie
(Land, Bundesstaat/Region, Stadt) überführt, die als Grundlage für Treemap
und Globus dient. Zeitbasierte Ansichten aggregieren die Sichtungen nach Tag
bzw. Jahr. Die Formverteilung wird über die dokumentierten Shapekategorien
ausgezählt.

Die Dokumente aus Release 1 werden über ein Pythonskript
(`build_manifest.py`) indexiert. Das Skript durchsucht die Ablage der
Original PDFs, Bilder und Videos, extrahiert Metadaten und erzeugt daraus ein
Manifest (`uap_files_manifest.json`). Dieses Manifest steuert die
Dokumentenansicht (`uap_files.html`), sodass die Akten strukturiert
durchsucht und im Original geöffnet werden können.

### Wie erfolgt die Interaktion mit den Visualisierungen

Die Startseite bündelt mehrere miteinander verknüpfte Ansichten:

- **Kalender Heatmap** ("Sichtungen über die Zeit pro Tag"). Die Sichtungen
  eines Jahres werden tagesgenau als Farbintensität dargestellt. Über ein
  Auswahlfeld lässt sich das Jahr wechseln. Eine 3D Skyline stellt dieselben
  Tageswerte alternativ als räumliches Höhenprofil dar.
- **Persönliches Datum erkunden**: Über die Eingabe eines Datums (Jahr, Monat,
  Tag) wird der betreffende Tag im Kalender markiert und alle zugehörigen
  Sichtungen werden aufgelistet. Eine begleitende Shapeverteilung zeigt alle
  dokumentierten Formen mit ihrer jeweiligen Anzahl.
- **Zeitreihe** ("Sichtungen über die Jahre"): Der langfristige Verlauf lässt
  sich über eine Von/Bis Auswahl auf einen Zeitraum eingrenzen. Ein 3D Modus
  bietet eine alternative Darstellung.
- **3D Globus**: Die geografische Verteilung wird auf einer interaktiven
  Weltkugel abgebildet. Ein Zeitschieberegler mit Wiedergabefunktion animiert
  den zeitlichen Verlauf, ein Klick auf ein Land öffnet ein Detailpanel mit
  Jahres- und Formverteilung, und optionale Flugbahnen sowie ein
  AR-Modus stehen für unterstützte Geräte bereit.
- **Zoombares Treemap**: Ausgehend von der Länderebene kann schrittweise bis
  auf Bundesstaat- und Stadtebene hineingezoomt werden. Die Rückkehr erfolgt
  über die Navigationsleiste. Das Treemap ist mit dem Globus verknüpft, sodass
  ein ausgewähltes Land direkt im Treemap weiter erkundet werden kann.
- **UAP Akten des Department of War**: Über einen eigenen Bereich
  (`uap_files.html`) sind die freigegebenen Originaldokumente strukturiert
  einsehbar und im Original abrufbar.

## UX Design Test-Session mit EEG Interpretation

Zur explorativen Bewertung der Fokusierung auf das UX wurde eine Test-Session als
Screencapture (1920×1080, 30 fps, ca. 5:39 min) mit Webcamfeed und synchronem
EEG Streifen aufgezeichnet. Im Streifen markiert jeder vertikale Balken ein
detektiertes Band Ereignis. Dabei steht Rot für Alpha (8 - 13 Hz, entspannte
Wachheit) und Blau für Beta (13 - 30 Hz, aktive Konzentration). Ein gelber
Playhead zeigt die aktuelle Position an, der Streifen scrollt darunter durch.

### Vorgehen

Das Video wurde in einem 2 Sekunden Raster abgetastet und am fix in der
Bildmitte stehenden Playhead der Anteil rot- gegenüber blau-dominanter Pixel
sowie die Gesamt Balkendichte gemessen. Daraus ergeben sich das
Alpha-Beta-Verhältnis und die Band Aktivität über die Zeit. Die Auswertung
erfolgt über die im Video eingeblendete Wanduhr. Die x-Achse des Streifens
läuft mit etwa vierfacher Echtzeit und wird daher nicht direkt herangezogen.

### Ergebnis

Über die gesamte Session überwiegt Alpha (ca. 60 %) gegenüber Beta (ca. 40 %).
Der Verlauf gliedert sich in drei Phasen:

| Phase (Session-Zeit)            | Sichtbarer Inhalt                              | Alpha | Beta | Aktivität |
|---------------------------------|------------------------------------------------|:-----:|:----:|:---------:|
| **1 · Browsing** (0 - 1:53)       | Einstieg Dashboard, Heatmap, Shapeverteilung  | 58 %  | 42 % | 35 %      |
| **2 · Exploration** (1:53 - 3:46) | ruhiges Betrachten, 3D Skyline, Datumerkunden | 69 %  | 31 % | 39 %      |
| **3 · Deep-Dive** (3:46 - 5:39)   | UAP Dokumentseiten, zoombares Treemap (USA/CA) | 53 %  | 47 % | 54 %      |

**Kernbeobachtung:** Die geringste Gesamtaktivität fällt mit dem höchsten
Alphaanteil zusammen (um Minute 2, Alphaspitze bis ca. 97 %). In der zweiten
Sessionhälfte steigt die Bandaktivität kontinuierlich (von ca. 15 % auf
ca. 60 %) bei zunehmendem Betaanteil.

### Interpretation

In **Phase 1 (Browsing)** zeigt sich ein leicht erhöhtes Beta bei mittlerer
Aktivität, was auf eine Orientierungsphase hindeutet. Layout und Diagramme
werden erfasst, wobei die visuelle Suche aktive Aufmerksamkeit erfordert.

In **Phase 2 (Exploration)** ist die Ableitung Alpha dominant bei niedriger
Aktivität. Dies entspricht einem entspannten, eher passiven Betrachten mit
geringer kognitiver Last und wenig Interaktion.

In **Phase 3 (Deep Dive)** steigen Betaanteil und Aktivität gemeinsam auf ihr
Maximum. Dies deutet auf eine anhaltende aktive Verarbeitung beim Durcharbeiten
der Dokumentseiten und beim schrittweisen Hineinzoomen in das Treemap hin. Ab
Minute 3 beteiligt sich eine zweite Person. Die höhere Last ist mit dem
beobachteten Anstieg konsistent.

**Fazit:** Die dichten, interaktiv zoombaren Elemente (Treemap Deep Dive,
Dokumentenrecherche) erzeugen messbar mehr aktive Verarbeitung als das
initiale Überblicksbrowsing oder das ruhige Betrachten der statischen
Diagramme. Aus UX Sicht liegt darin die Stärke des Entwurfs, da dort der User am fokusiertesten ist.

### Einschränkungen

Es handelt sich um eine indirekte Messung über den gerenderten Streifen, dessen
Bandgrenzen und Schwellenwerte vom erzeugenden Tool vorgegeben sind. Die
frontale Ableitung dämpft Alphaspitzen, und Artefakte durch Lidbewegungen,
Muskelaktivität oder Sprechen sind möglich. Mit **n = 1** und ohne Baseline ist
die Auswertung explorativ und nicht statistisch belastbar. Für belastbare Werte
wären eine kurze Baseline (Augen zu und auf, Kontrolle der Alpha Blockade)
sowie ein Rohsignal Export für die direkte Bandleistung via PSD
(`mne ... compute_psd`) erforderlich.

Die vollständige Auswertung inklusive Diagramm und Frames findet sich in
`EEG_Output.pdf`.

# Gruppe
- Joshua MC Laughlin
- Jonas Luca Wolter