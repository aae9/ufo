// p5x.js — UFO p5.js Sketch
// Direct-Render-Variante (kein Offscreen-Buffer mehr):
//  - 3D-Form aus 2D-Primitiven, jedes Element direkt auf die Hauptcanvas
//  - Snap auf Zellraster → ASCII / Dots / Squares Look ohne Pixel-Readback
//  - Phasen-Maschine, Auto-Rotation, Maus-Tilt, Glitch-Overlay, Farbzyklen
//
// Steuerung:
//  - Maus bewegen: UFO neigt sich
//  - Klick / Taste G: Glitch
//  - Taste F: Fullscreen
//  - Taste M: Render-Modus wechseln

const FOCAL = 440;

// Render-Modi
const MODES = ["ascii", "dots", "squares"];
let modeIdx = 0;
let lastModeFlip = 0;

// Grid (Zellgröße der Rasterisierung)
let grid = 8;
let gridTarget = 8;

// Zeit
let tNow = 0;

// Phasen-Maschine
const PHASES = ["approach", "hover", "depart", "waiting"];
const PHASE_DURATION = { approach: 3.0, hover: 22.0, depart: 3.0, waiting: 1.5 };
let phaseIdx = 0;
let phaseStart = 0;

// Bloom (0 = oben außerhalb, 1 = voll sichtbar)
let bloom = 0;

// Rotation (auto + Maus-Anteil)
let mouseRotX = 0, mouseRotY = 0;
let mouseRotXT = 0, mouseRotYT = 0;

// Farbpaletten (zyklisch)
const PALETTES = [
    {
        name: "classic",
        bg: [8, 12, 26],
        saucer: [200, 215, 230],
        saucerDark: [60, 70, 95],
        dome: [120, 220, 240],
        domeEdge: [20, 100, 140],
        lights: [255, 220, 100],
        beam: [180, 230, 255],
        alien: [167, 139, 250],
    },
    {
        name: "neon",
        bg: [12, 6, 22],
        saucer: [220, 180, 240],
        saucerDark: [80, 30, 110],
        dome: [240, 100, 200],
        domeEdge: [120, 30, 100],
        lights: [120, 240, 140],
        beam: [240, 140, 220],
        alien: [255, 230, 100],
    },
    {
        name: "phantom",
        bg: [4, 8, 18],
        saucer: [220, 220, 230],
        saucerDark: [50, 60, 80],
        dome: [100, 160, 240],
        domeEdge: [30, 60, 130],
        lights: [255, 110, 110],
        beam: [180, 200, 255],
        alien: [180, 255, 220],
    },
];
let paletteIdx = 0;

// Glitch
let glitchT = 0;

// ASCII-Charset (von dunkel nach hell)
const ASCII_CHARS = " .:-=+*o#%@";

// ---------- Snippets aus dem CSV (links/rechts) ----------
let csvTable = null;
const snippetPool = [];
const activeSnippets = []; // max. 2 gleichzeitig
let lastSpawnEnd = 0;
let nextSpawnDelay = 1.5;

function preload() {
    // Wird automatisch von p5 vor setup() awaited
    csvTable = loadTable(
        "nuforc_str.csv", "csv", "header",
        () => buildSnippetPool(),
        (err) => console.warn("Snippet-CSV konnte nicht geladen werden:", err),
    );
}

function buildSnippetPool() {
    if (!csvTable || !csvTable.rows) return;
    const rows = csvTable.rows;
    const N = rows.length;
    const want = 240;
    for (let attempt = 0; attempt < want * 3 && snippetPool.length < want; attempt++) {
        const r = rows[Math.floor(Math.random() * N)];
        const o = r.obj || {};
        const summary = (o.Summary || "").toString();
        const shape = (o.Shape || "").toString().trim();
        const occurred = (o.Occurred || "").toString().trim();
        const location = (o.Location || "").toString().trim();

        const dice = Math.random();
        let text = "";
        if (dice < 0.55 && summary) {
            // Erster Satzschnipsel, weichgespült
            const clean = summary.replace(/\s+/g, " ").trim();
            const cap = 56 + Math.floor(Math.random() * 18); // 56–74 Zeichen
            const cut = clean.length > cap
                ? clean.slice(0, cap).replace(/\s\S*$/, "") + "…"
                : clean;
            if (cut.length >= 12) text = `"${cut}"`;
        } else if (dice < 0.75 && shape) {
            text = `◉ SHAPE · ${shape.toUpperCase()}`;
        } else if (dice < 0.9 && occurred) {
            // "MM/DD/YYYY HH:MM" oder ISO – auf das Datum kürzen
            const datePart = occurred.split(/[ T]/)[0];
            text = `▸ ${datePart}`;
        } else if (location) {
            // Erstes Komma-Element (Stadt) + Suffix
            const city = location.split(",")[0].trim();
            if (city && city.length < 40) text = `◬ ${city.toUpperCase()}`;
        }
        if (text) snippetPool.push(text);
    }
}

function pickSnippetY() {
    // Nicht direkt am Rand und mind. 60 px Abstand zu vorhandenem Snippet
    for (let attempt = 0; attempt < 12; attempt++) {
        const y = random(90, height - 70);
        let ok = true;
        for (const s of activeSnippets) {
            if (Math.abs(y - s.y) < 70) { ok = false; break; }
        }
        if (ok) return y;
    }
    return random(90, height - 70);
}

function spawnSnippet() {
    if (snippetPool.length === 0) return;
    const text = random(snippetPool);
    // Seite bevorzugen, die nicht schon belegt ist
    let side;
    const sides = activeSnippets.map(s => s.side);
    if (sides.includes("left") && !sides.includes("right")) side = "right";
    else if (sides.includes("right") && !sides.includes("left")) side = "left";
    else side = random(["left", "right"]);

    activeSnippets.push({
        text, side,
        y: pickSnippetY(),
        state: "entering",
        phaseT: 0,
        enterDur: 0.9 + random(0.5),
        visibleDur: 2.6 + random(2.6),
        leaveDur: 0.9 + random(0.4),
    });
}

function updateSnippets() {
    const dt = 1 / 30;

    // Phasen-Zeit erhöhen + entering→visible
    for (const s of activeSnippets) {
        s.phaseT += dt;
        if (s.state === "entering" && s.phaseT >= s.enterDur) {
            s.state = "visible";
            s.phaseT = 0;
        }
    }

    // visible → leaving: nur einer gleichzeitig
    if (!activeSnippets.some(s => s.state === "leaving")) {
        for (const s of activeSnippets) {
            if (s.state === "visible" && s.phaseT >= s.visibleDur) {
                s.state = "leaving";
                s.phaseT = 0;
                break;
            }
        }
    }

    // Fertige rauswerfen
    for (let i = activeSnippets.length - 1; i >= 0; i--) {
        const s = activeSnippets[i];
        if (s.state === "leaving" && s.phaseT >= s.leaveDur) {
            activeSnippets.splice(i, 1);
            lastSpawnEnd = tNow;
            nextSpawnDelay = 0.6 + Math.random() * 2.2;
        }
    }

    // Neuen Snippet spawnen, wenn:
    //   - weniger als 2 aktiv UND
    //   - keiner gerade beim Hereinkommen UND
    //   - genug Zeit vergangen seit dem letzten Abgang
    const anyEntering = activeSnippets.some(s => s.state === "entering");
    if (
        activeSnippets.length < 2 &&
        !anyEntering &&
        tNow - lastSpawnEnd > nextSpawnDelay
    ) {
        spawnSnippet();
        // direkt nächste Verzögerung setzen (falls noch Platz für #2)
        lastSpawnEnd = tNow;
        nextSpawnDelay = 1.0 + Math.random() * 2.5;
    }
}

function easeOutQuart(x) { return 1 - Math.pow(1 - x, 4); }
function easeInQuart(x) { return x * x * x * x; }

function drawSnippets(pal) {
    if (activeSnippets.length === 0) return;
    push();
    textFont("ui-monospace, SFMono-Regular, Menlo, monospace");
    textSize(13);
    textAlign(LEFT, BASELINE);
    noStroke();

    const margin = 28;

    for (const s of activeSnippets) {
        const tw = textWidth(s.text);
        const targetXLeft = margin;
        const targetXRight = width - margin - tw;
        const offXLeft = -tw - 40;
        const offXRight = width + 40;

        let x, alpha;
        if (s.state === "entering") {
            const k = easeOutQuart(constrain(s.phaseT / s.enterDur, 0, 1));
            x = s.side === "left"
                ? lerp(offXLeft, targetXLeft, k)
                : lerp(offXRight, targetXRight, k);
            alpha = k * 220;
        } else if (s.state === "visible") {
            x = s.side === "left" ? targetXLeft : targetXRight;
            // sanftes Atmen
            alpha = 200 + 25 * Math.sin((tNow + s.y) * 1.6);
        } else { // leaving
            const k = easeInQuart(constrain(s.phaseT / s.leaveDur, 0, 1));
            x = s.side === "left"
                ? lerp(targetXLeft, offXLeft, k)
                : lerp(targetXRight, offXRight, k);
            alpha = (1 - k) * 220;
        }

        // Akzent-Strich vor dem Text (Side-Marker)
        const markX = s.side === "left" ? x - 14 : x + tw + 6;
        stroke(pal.lights[0], pal.lights[1], pal.lights[2], alpha * 0.7);
        strokeWeight(1.2);
        line(markX, s.y - 8, markX, s.y + 2);
        noStroke();

        // Schatten/Glow (1 Pixel Versatz, dunkel)
        fill(0, 0, 0, alpha * 0.55);
        text(s.text, x + 1, s.y + 1);

        // Eigentlicher Text in Palette-Akzent
        fill(pal.dome[0], pal.dome[1], pal.dome[2], alpha);
        text(s.text, x, s.y);
    }
    pop();
}

function setup() {
    createCanvas(windowWidth, windowHeight);
    pixelDensity(1);
    frameRate(30);
    textFont("ui-monospace, SFMono-Regular, Menlo, monospace");
    noStroke();
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}

function draw() {
    const pal = PALETTES[paletteIdx];
    background(pal.bg[0], pal.bg[1], pal.bg[2]);

    tNow += 1 / 30;

    // Maus-Ziel weich annähern
    mouseRotXT = (mouseY / height - 0.5) * 0.7;
    mouseRotYT = (mouseX / width - 0.5) * 0.9;
    mouseRotX = lerp(mouseRotX, mouseRotXT, 0.06);
    mouseRotY = lerp(mouseRotY, mouseRotYT, 0.06);

    updatePhase();

    // Render-Modus seltener wechseln, Grid pingponged
    if (tNow - lastModeFlip > 1.8) {
        modeIdx = (modeIdx + 1) % MODES.length;
        gridTarget = random([8, 10, 12, 14]);
        lastModeFlip = tNow;
        if (random() < 0.1) glitchT = 0.18;
    }
    grid = lerp(grid, gridTarget, 0.06);

    // UFO direkt auf die Hauptcanvas zeichnen — nur wenn überhaupt sichtbar
    if (bloom > 0.03) {
        renderUFODirect(pal);
    }

    // Glitch
    if (glitchT > 0) {
        drawGlitch(pal);
        glitchT -= 1 / 30;
    }

    // Subtile Vignette
    drawVignette();

    // Snippets aus dem CSV (links/rechts)
    updateSnippets();
    drawSnippets(pal);
}

// ---------- Phase ----------
function updatePhase() {
    const phase = PHASES[phaseIdx];
    const dur = PHASE_DURATION[phase];
    const elapsed = tNow - phaseStart;
    const k = constrain(elapsed / dur, 0, 1);

    if (phase === "approach") bloom = easeInOutCubic(k);
    else if (phase === "hover") bloom = 1;
    else if (phase === "depart") bloom = 1 - easeInOutCubic(k);
    else bloom = 0;

    if (elapsed >= dur) {
        phaseIdx = (phaseIdx + 1) % PHASES.length;
        phaseStart = tNow;
        // Beim Übergang zu "approach": neue Palette
        if (PHASES[phaseIdx] === "approach") {
            paletteIdx = (paletteIdx + 1) % PALETTES.length;
            glitchT = 0.2;
        }
    }
}

function easeInOutCubic(x) {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

// ---------- 3D-Rotation ----------
function rot3D(x, y, z) {
    // Auto-Rotation + Maus-Anteil
    const ay = sin(tNow * 0.42) * 0.32 + mouseRotY;
    const ax = sin(tNow * 0.28) * 0.18 + mouseRotX;
    const az = sin(tNow * 0.17) * 0.06;

    // Y-Rotation
    let c = cos(ay), s = sin(ay);
    let x1 = x * c + z * s;
    let z1 = -x * s + z * c;

    // X-Rotation
    c = cos(ax); s = sin(ax);
    let y1 = y * c - z1 * s;
    let z2 = y * s + z1 * c;

    // Z-Rotation
    c = cos(az); s = sin(az);
    let x2 = x1 * c - y1 * s;
    let y2 = x1 * s + y1 * c;

    return [x2, y2, z2];
}

// ---------- UFO direkt auf die Hauptcanvas ----------
function buildUFOElements(pal) {
    const elements = [];

    // ----- Untertasse: oblate Ellipse als Schalen-Punkte -----
    const saucerR = 180;
    const saucerH = 30;
    const rings = 6;
    const perRing = 38;

    for (let ring = 0; ring < rings; ring++) {
        const v = (ring / (rings - 1)) * 2 - 1; // -1 .. 1 (oben .. unten)
        const ringY = v * saucerH;
        const ringR = saucerR * Math.sqrt(Math.max(0, 1 - v * v));

        for (let i = 0; i < perRing; i++) {
            const a = (i / perRing) * TWO_PI;
            const x = cos(a) * ringR;
            const z = sin(a) * ringR;
            const [rx, ry, rz] = rot3D(x, ringY, z);
            const ps = FOCAL / (FOCAL + rz);

            const lightT = constrain(map(rz, -saucerR, saucerR, 1, 0.35), 0.35, 1);
            const top = (v + 1) * 0.5;
            const shade = lerp(1, 0.45, top);
            const col = mixColor(pal.saucerDark, pal.saucer, shade * lightT);
            elements.push({ rx, ry, rz, ps, intensity: 0.9 * lightT, color: col });
        }
    }

    // ----- Kuppel (Halbkugel) -----
    const domeR = 76;
    const domeH = 70;
    const domeRings = 5;
    const perDomeRing = 24;

    for (let ring = 0; ring < domeRings; ring++) {
        const k = ring / (domeRings - 1);
        const theta = (1 - k) * HALF_PI;
        const ry0 = -saucerH * 0.3 - sin(theta) * domeH;
        const rRing = cos(theta) * domeR;

        for (let i = 0; i < perDomeRing; i++) {
            const a = (i / perDomeRing) * TWO_PI;
            const x = cos(a) * rRing;
            const z = sin(a) * rRing;
            const [rx, ry, rz] = rot3D(x, ry0, z);
            const ps = FOCAL / (FOCAL + rz);

            const lightT = constrain(map(rz, -domeR, domeR, 1, 0.4), 0.4, 1);
            const col = mixColor(pal.domeEdge, pal.dome, lightT);
            elements.push({ rx, ry, rz, ps, intensity: 0.8 - k * 0.2, color: col });
        }
    }

    // ----- Alien-Köpfchen -----
    const headR = 16;
    const headPoints = 12;
    for (let i = 0; i < headPoints; i++) {
        const a = (i / headPoints) * TWO_PI;
        const x = cos(a) * headR;
        const z = sin(a) * headR;
        const [rx, ry, rz] = rot3D(x, -saucerH * 0.5 - 26, z);
        const ps = FOCAL / (FOCAL + rz);
        elements.push({ rx, ry, rz, ps, intensity: 0.92, color: pal.alien });
    }

    // ----- Bullaugen / Rim-Lichter -----
    const numLights = 14;
    const rimR = saucerR + 6;
    for (let i = 0; i < numLights; i++) {
        const a = (i / numLights) * TWO_PI;
        const x = cos(a) * rimR;
        const z = sin(a) * rimR;
        const y = -saucerH * 0.05 + 6;
        const blink = 0.55 + 0.45 * sin(a * 3 + tNow * 4.5);
        const [rx, ry, rz] = rot3D(x, y, z);
        const ps = FOCAL / (FOCAL + rz);
        elements.push({ rx, ry, rz, ps, intensity: blink, color: pal.lights, isLight: true });
    }

    // Z-Sort (hinten zuerst → vorne überschreibt)
    elements.sort((a, b) => b.rz - a.rz);
    return elements;
}

function drawBeamDirect(pal, cx, cy) {
    const ctx = drawingContext;
    const layers = 18;
    const beamH = 310;
    const topR = 52;
    const botR = 130;
    const a0 = 90 * bloom;

    ctx.save();
    ctx.translate(cx, cy);

    // Strahl-Layer
    let lastA = -1;
    for (let i = layers - 1; i >= 0; i--) {
        const lr = i / (layers - 1);
        const r = lerp(topR, botR, lr);
        const y = lerp(38, beamH, lr);
        const aRaw = a0 * (1 - lr * 0.85) * 0.7;
        const a = Math.round(aRaw / 4) * 4; // quantisieren → fillStyle bleibt stabil
        if (a !== lastA) {
            ctx.fillStyle = `rgba(${pal.beam[0]},${pal.beam[1]},${pal.beam[2]},${(a / 255).toFixed(3)})`;
            lastA = a;
        }
        ctx.beginPath();
        ctx.ellipse(0, y, r, r * 0.225, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // Bodenglow
    const aGlow = (50 * bloom) / 255;
    ctx.fillStyle = `rgba(${pal.beam[0]},${pal.beam[1]},${pal.beam[2]},${aGlow.toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(0, beamH + 10, botR * 1.2, botR * 0.275, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

function renderUFODirect(pal) {
    const cell = Math.max(6, Math.round(grid));
    const yPhase = (1 - bloom) * -340;
    const mx = (mouseX - width / 2) * 0.04;
    const my = (mouseY - height / 2) * 0.04;
    const cx0 = width / 2 + mx;
    const cy0 = height / 2 + 30 + yPhase + my;

    // Zuerst der Lichtstrahl (transparent, hinter dem Body)
    drawBeamDirect(pal, cx0, cy0);

    // Body-Elemente direkt rendern, auf Zellraster gesnappt
    const elements = buildUFOElements(pal);
    const ctx = drawingContext;
    ctx.save();
    ctx.translate(cx0, cy0);

    const mode = MODES[modeIdx];
    if (mode === "ascii") {
        ctx.font = `${(cell * 1.1).toFixed(1)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
    }

    const half = cell * 0.5;
    const ASC_LEN = ASCII_CHARS.length;
    let lastFillKey = -1;

    for (const e of elements) {
        const sx = e.rx * e.ps;
        const sy = e.ry * e.ps;
        // Snap auf Zellraster (Mitte der Zelle)
        const gx = Math.round(sx / cell) * cell;
        const gy = Math.round(sy / cell) * cell;

        const c = e.color;
        const r = c[0] | 0, g = c[1] | 0, b = c[2] | 0;
        const qr = r & 0xF8, qg = g & 0xF8, qb = b & 0xF8;
        const key = (qr << 16) | (qg << 8) | qb;
        if (key !== lastFillKey) {
            ctx.fillStyle = `rgb(${qr},${qg},${qb})`;
            lastFillKey = key;
        }

        const norm = e.intensity < 0 ? 0 : (e.intensity > 1 ? 1 : e.intensity);

        if (mode === "ascii") {
            const ci = norm >= 1 ? ASC_LEN - 1 : (norm * ASC_LEN) | 0;
            ctx.fillText(ASCII_CHARS[ci], gx + half, gy + half);
        } else if (mode === "dots") {
            const rad = cell * (0.32 + norm * 0.9) * 0.5;
            ctx.beginPath();
            ctx.arc(gx + half, gy + half, rad, 0, Math.PI * 2);
            ctx.fill();
        } else { // squares
            const sz = cell * (0.42 + norm * 0.85);
            ctx.fillRect(gx + half - sz * 0.5, gy + half - sz * 0.5, sz, sz);
        }
    }

    ctx.restore();
}

function mixColor(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// ---------- Glitch ----------
function drawGlitch(pal) {
    push();
    blendMode(ADD);
    const slices = 2 + Math.floor(random(4)); // 2–5 statt 6–12
    for (let i = 0; i < slices; i++) {
        const sliceY = random(height);
        const sliceH = random(4, 14);
        const offset = random(-25, 25);
        const channel = floor(random(3));
        const cVec = [0, 0, 0];
        cVec[channel] = 180;
        noStroke();
        fill(cVec[0], cVec[1], cVec[2], random(20, 60));
        rect(offset, sliceY, width, sliceH);
    }
    blendMode(BLEND);
    pop();
}

function drawVignette() {
    noFill();
    const layers = 6;
    for (let i = 0; i < layers; i++) {
        const k = i / layers;
        stroke(0, 0, 0, k * 22);
        strokeWeight(110 * (1 - k));
        rect(0, 0, width, height);
    }
    noStroke();
}

// ---------- Eingaben ----------
function keyPressed() {
    if (key === 'g' || key === 'G') glitchT = 0.25;
    if (key === 'm' || key === 'M') {
        modeIdx = (modeIdx + 1) % MODES.length;
        lastModeFlip = tNow;
    }
    if (key === 'f' || key === 'F') {
        const fs = fullscreen();
        fullscreen(!fs);
    }
}

function mousePressed() {
    glitchT = 0.2;
}
