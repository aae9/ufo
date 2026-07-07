# Visit our Website
[Projektwebpage](http://91.98.92.228)


## Test-Session mit EEG-Overlay — Interpretation

Zur explorativen Bewertung des Engagements wurde eine Test-Session als Screen-Capture
(1920×1080, 30 fps, ~5:39 min) mit Webcam-Feed und synchronem **EEG-Streifen** aufgezeichnet.
Im Streifen markiert jeder vertikale Balken ein detektiertes Band-Ereignis:
**rot = Alpha** (8–13 Hz, entspannte Wachheit) ·**blau = Beta** (13–30 Hz, aktive Konzentration).
Ein gelber Playhead zeigt die aktuelle Position, der Streifen scrollt darunter.

### Vorgehen
Da kein EEG-Rohsignal vorlag, wurde der eingeblendete Streifen quantitativ ausgewertet: Das Video
wurde im 2-s-Raster abgetastet und am (fix in der Bildmitte stehenden) Playhead der Anteil
rot- vs. blau-dominanter Pixel sowie die Gesamt-Balkendichte gemessen → Alpha-/Beta-Verhältnis und
Band-Aktivität über die Zeit. Auswertung erfolgt über die Video-Wanduhr; die Streifen-x-Achse läuft
mit ≈ 4× Echtzeit und wird daher nicht direkt verwendet.

### Ergebnis
Über die gesamte Session überwiegt Alpha (~60 %) gegenüber Beta (~40 %). Der Verlauf gliedert sich
in drei Phasen:

| Phase (Session-Zeit)        | Sichtbarer Inhalt                              | Alpha | Beta | Aktivität |
|-----------------------------|-----------------------------------------------|:-----:|:----:|:---------:|
| **1 · Browsing** (0–1:53)   | Einstieg Dashboard, Heatmap, Shape-Verteilung | 58 %  | 42 % | 35 %      |
| **2 · Exploration** (1:53–3:46) | ruhiges Betrachten, 3D-Skyline, Datum-Erkunden | 69 %  | 31 % | 39 %      |
| **3 · Deep-Dive** (3:46–5:39)   | UAP-Dokumentseiten, zoombare Treemap (USA→CA) | 53 %  | 47 % | 54 %      |

**Kernbeobachtung:** Die *geringste* Gesamt-Aktivität fällt mit dem *höchsten* Alpha-Anteil zusammen
(um Minute 2, Alpha-Spitze bis ~97 %). In der zweiten Sessionhälfte steigt die Band-Aktivität
kontinuierlich (~15 % → ~60 %) bei zunehmendem Beta-Anteil.

### Interpretation
- **Phase 1 (Browsing):** leicht erhöhtes Beta bei mittlerer Aktivität → Orientierung; Layout und
  Diagramme werden erfasst (visuelle Suche braucht aktive Aufmerksamkeit).
- **Phase 2 (Exploration):** Alpha-dominant bei niedriger Aktivität → entspanntes, eher passives
  Betrachten mit geringer kognitiver Last (wenig Interaktion).
- **Phase 3 (Deep-Dive):** Beta und Aktivität steigen gemeinsam auf das Maximum → anhaltende aktive
  Verarbeitung beim Durcharbeiten der Dokumentseiten und beim schrittweisen Hineinzoomen in die
  Treemap. Ab Min 3 beteiligt sich eine zweite Person, die höhere Last passt zum Anstieg.

**Fazit:** Die dichten, **interaktiv-zoombaren** Elemente (Treemap-Deep-Dive, Dokument-Recherche)
erzeugen messbar mehr aktive Verarbeitung als das initiale Überblicks-Browsing oder das ruhige
Betrachten der statischen Diagramme — aus Engagement-Sicht die Stärke des Entwurfs.

### Einschränkungen
Indirekte Messung über den gerenderten Streifen (Bandgrenzen/Schwellen vom erzeugenden Tool
vorgegeben); frontale Ableitung dämpft Alpha-Peaks; Lid-/Muskel-/Sprech-Artefakte möglich;
**n = 1** ohne Baseline → explorativ, nicht statistisch belastbar. Für belastbare Werte: kurze
Baseline (Augen zu/auf, Alpha-Blockade-Kontrolle) und Rohsignal-Export für direkte Bandleistung
via PSD (`mne ... compute_psd`).

> Vollständige Auswertung inkl. Diagramm und Frames: `Auswertung_Test-Session_EEG.pdf`
