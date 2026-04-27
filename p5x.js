// p5x.js — UFO p5.js Sketch
// Inspired by peoniap5 (jesusemans/peoniap5):
//  - 3D-Form gebaut aus 2D-Primitiven, projiziert in einen Offscreen-Buffer
//  - Buffer wird als ASCII / Dots / Squares neu rasterisiert
//  - Phasen-Maschine, Auto-Rotation, Maus-Tilt, Glitch-Overlay, Farbzyklen
//
// Steuerung:
//  - Maus bewegen: UFO neigt sich
//  - Klick / Taste G: Glitch
//  - Taste F: Fullscreen
//  - Taste M: Render-Modus wechseln

const BUF_SIZE = 680;
const FOCAL = 420;

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

let buf;

function setup() {
    createCanvas(windowWidth, windowHeight);
    pixelDensity(1);
    buf = createGraphics(BUF_SIZE, BUF_SIZE);
    buf.pixelDensity(1);
    buf.noStroke();
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

    // Render-Modus alle 0.8s wechseln, Grid pingponged
    if (tNow - lastModeFlip > 0.8) {
        modeIdx = (modeIdx + 1) % MODES.length;
        gridTarget = random([5, 7, 9, 12, 16]);
        lastModeFlip = tNow;
        if (random() < 0.45) glitchT = 0.35;
    }
    grid = lerp(grid, gridTarget, 0.08);

    // UFO in den Buffer zeichnen
    drawUFOToBuffer(pal);
    buf.loadPixels();

    // Buffer auf den Bildschirm rastern
    renderBufferToScreen(pal);

    // Glitch
    if (glitchT > 0) {
        drawGlitch(pal);
        glitchT -= 1 / 30;
    }

    // Subtile Vignette
    drawVignette();
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
            glitchT = 0.5;
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

// ---------- UFO in Buffer ----------
function drawUFOToBuffer(pal) {
    buf.background(pal.bg[0], pal.bg[1], pal.bg[2]);
    buf.push();

    // Vertikalposition: aus dem Bildrand "schwebt" sie rein
    const yPhase = (1 - bloom) * -260;
    buf.translate(BUF_SIZE / 2, BUF_SIZE / 2 + 60 + yPhase);

    drawLightBeam(pal);
    drawUFOBody(pal);
    buf.pop();
}

function drawLightBeam(pal) {
    const layers = 28;
    const beamH = 230;
    const topR = 38;
    const botR = 95;
    const a0 = 90 * bloom;

    for (let i = layers - 1; i >= 0; i--) {
        const lr = i / (layers - 1);
        const r = lerp(topR, botR, lr);
        const y = lerp(28, beamH, lr);
        const a = a0 * (1 - lr * 0.85) * 0.7;
        buf.noStroke();
        buf.fill(pal.beam[0], pal.beam[1], pal.beam[2], a);
        buf.ellipse(0, y, r * 2, r * 0.45);
    }

    // Bodenglow
    buf.fill(pal.beam[0], pal.beam[1], pal.beam[2], 50 * bloom);
    buf.ellipse(0, beamH + 8, botR * 2.4, botR * 0.55);
}

function drawUFOBody(pal) {
    // Sammle alle Punkte, sortiere per z, zeichne
    const elements = [];

    // ----- Untertasse: oblate Ellipse als Schalen-Punkte -----
    const saucerR = 145;
    const saucerH = 24;
    const rings = 7;
    const perRing = 44;

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

            // Beleuchtung: Punkte weiter "vorne" (negativer z) heller
            const lightT = constrain(map(rz, -saucerR, saucerR, 1, 0.35), 0.35, 1);
            const top = (v + 1) * 0.5; // 0 oben → 1 unten
            // Oberseite heller, Unterseite dunkler
            const shade = lerp(1, 0.45, top);
            const col = mixColor(pal.saucerDark, pal.saucer, shade * lightT);

            elements.push({
                rx, ry, rz, ps,
                size: 9 * ps,
                color: [col[0], col[1], col[2], 240],
            });
        }
    }

    // ----- Kuppel (Halbkugel) -----
    const domeR = 60;
    const domeH = 56;
    const domeRings = 6;
    const perDomeRing = 28;

    for (let ring = 0; ring < domeRings; ring++) {
        const k = ring / (domeRings - 1); // 0 oben, 1 Basis
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
            const alpha = 200 - k * 60;

            elements.push({
                rx, ry, rz, ps,
                size: 7 * ps,
                color: [col[0], col[1], col[2], alpha],
            });
        }
    }

    // ----- Alien-Köpfchen in der Kuppel -----
    const headR = 14;
    const headRings = 4;
    const perHeadRing = 16;
    for (let ring = 0; ring < headRings; ring++) {
        const v = (ring / (headRings - 1)) * 2 - 1;
        const ringY = -saucerH * 0.5 - 18 + v * headR * 0.85;
        const ringR = headR * Math.sqrt(Math.max(0, 1 - v * v));
        for (let i = 0; i < perHeadRing; i++) {
            const a = (i / perHeadRing) * TWO_PI;
            const x = cos(a) * ringR;
            const z = sin(a) * ringR;
            const [rx, ry, rz] = rot3D(x, ringY, z);
            const ps = FOCAL / (FOCAL + rz);
            elements.push({
                rx, ry, rz, ps,
                size: 5 * ps,
                color: [pal.alien[0], pal.alien[1], pal.alien[2], 230],
            });
        }
    }

    // ----- Bullaugen / Rim-Lichter -----
    const numLights = 14;
    const rimR = saucerR + 4;
    for (let i = 0; i < numLights; i++) {
        const a = (i / numLights) * TWO_PI;
        const x = cos(a) * rimR;
        const z = sin(a) * rimR;
        const y = -saucerH * 0.05 + 4;
        const blink = 0.55 + 0.45 * sin(a * 3 + tNow * 4.5);
        const [rx, ry, rz] = rot3D(x, y, z);
        const ps = FOCAL / (FOCAL + rz);
        elements.push({
            rx, ry, rz, ps,
            size: 11 * ps,
            color: [pal.lights[0], pal.lights[1], pal.lights[2], 255 * blink],
            isLight: true,
        });
    }

    // Z-Sort (hinten zuerst)
    elements.sort((a, b) => b.rz - a.rz);

    buf.noStroke();
    for (const e of elements) {
        buf.fill(e.color[0], e.color[1], e.color[2], e.color[3]);
        buf.ellipse(e.rx * e.ps, e.ry * e.ps, e.size, e.size);
    }
}

function mixColor(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// ---------- Buffer → Bildschirm ----------
function renderBufferToScreen(pal) {
    const cell = Math.max(3, Math.round(grid));
    const dx = (width - BUF_SIZE) / 2;
    const dy = (height - BUF_SIZE) / 2;

    push();
    translate(dx, dy);

    // Subtiler Maus-Parallax
    const mx = (mouseX - width / 2) * 0.04;
    const my = (mouseY - height / 2) * 0.04;
    translate(mx, my);

    const mode = MODES[modeIdx];
    if (mode === "ascii") {
        textSize(cell * 1.1);
        textAlign(CENTER, CENTER);
    }
    noStroke();

    for (let y = 0; y < BUF_SIZE; y += cell) {
        for (let x = 0; x < BUF_SIZE; x += cell) {
            const idx = ((y | 0) * BUF_SIZE + (x | 0)) * 4;
            const r = buf.pixels[idx];
            const g = buf.pixels[idx + 1];
            const b = buf.pixels[idx + 2];
            // Differenz zur Hintergrundfarbe = "Helligkeit der Form"
            const d = Math.abs(r - pal.bg[0]) + Math.abs(g - pal.bg[1]) + Math.abs(b - pal.bg[2]);
            if (d < 10) continue;
            const norm = constrain(d / 360, 0, 1);

            if (mode === "ascii") {
                const ci = Math.min(ASCII_CHARS.length - 1, Math.floor(norm * ASCII_CHARS.length));
                fill(r, g, b);
                text(ASCII_CHARS[ci], x + cell / 2, y + cell / 2);
            } else if (mode === "dots") {
                fill(r, g, b);
                ellipse(x + cell / 2, y + cell / 2, cell * (0.3 + norm * 0.9), cell * (0.3 + norm * 0.9));
            } else { // squares
                fill(r, g, b);
                const sz = cell * (0.4 + norm * 0.85);
                rect(x + cell / 2 - sz / 2, y + cell / 2 - sz / 2, sz, sz);
            }
        }
    }

    pop();
}

// ---------- Glitch ----------
function drawGlitch(pal) {
    push();
    blendMode(ADD);
    const slices = 6 + Math.floor(random(6));
    for (let i = 0; i < slices; i++) {
        const sliceY = random(height);
        const sliceH = random(6, 26);
        const offset = random(-50, 50);
        const channel = floor(random(3));
        const cVec = [0, 0, 0];
        cVec[channel] = 220;
        noStroke();
        fill(cVec[0], cVec[1], cVec[2], random(40, 120));
        rect(offset, sliceY, width, sliceH);
    }
    blendMode(BLEND);
    pop();
}

function drawVignette() {
    noFill();
    const layers = 18;
    for (let i = 0; i < layers; i++) {
        const k = i / layers;
        stroke(0, 0, 0, k * 14);
        strokeWeight(80 * (1 - k));
        noFill();
        rect(0, 0, width, height);
    }
    noStroke();
}

// ---------- Eingaben ----------
function keyPressed() {
    if (key === 'g' || key === 'G') glitchT = 0.5;
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
    glitchT = 0.4;
}
