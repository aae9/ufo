// timeline-3d.js — 3D Ribbon-Chart der Sichtungen.
// Zwei Modi der dritten Dimension (in der Overlay-Leiste umschaltbar):
//   "shape"    → Top-Shapes als gestaffelte Bergrücken
//   "location" → Top-Länder als gestaffelte Bergrücken
//
// Jeder Bergrücken läuft entlang der X-Achse (Jahre),
// Höhe = Sichtungen, Tiefe (Z) = Kategorie-Index.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ---------- Konfiguration ----------
const TOP_N = 14;               // Top-N Kategorien pro Dimension (mehr = glattere Surface)
const SURFACE_WIDTH = 12;       // X-Welt-Breite (Jahre)
const SURFACE_DEPTH = 7;        // Z-Welt-Tiefe (Kategorien)
const HEIGHT_SCALE = 3.4;       // Max-Höhe der Surface

// Plasma-Colormap (matplotlib) — Stops von dunkel-lila bis hell-gelb
const PLASMA_STOPS = [
    { t: 0.0,  c: [0.050, 0.030, 0.527] },
    { t: 0.15, c: [0.231, 0.011, 0.638] },
    { t: 0.30, c: [0.451, 0.000, 0.658] },
    { t: 0.45, c: [0.641, 0.108, 0.589] },
    { t: 0.60, c: [0.799, 0.286, 0.466] },
    { t: 0.75, c: [0.929, 0.475, 0.327] },
    { t: 0.88, c: [0.984, 0.694, 0.180] },
    { t: 1.0,  c: [0.940, 0.975, 0.131] },
];

function plasmaColor(t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 0; i < PLASMA_STOPS.length - 1; i++) {
        const a = PLASMA_STOPS[i], b = PLASMA_STOPS[i + 1];
        if (t <= b.t) {
            const k = (t - a.t) / (b.t - a.t);
            return [
                a.c[0] + (b.c[0] - a.c[0]) * k,
                a.c[1] + (b.c[1] - a.c[1]) * k,
                a.c[2] + (b.c[2] - a.c[2]) * k,
            ];
        }
    }
    return PLASMA_STOPS[PLASMA_STOPS.length - 1].c;
}

// ---------- State ----------
let scene = null;
let camera = null;
let renderer = null;
let controls = null;
let surfaceGroup = null;     // Surface-Mesh + Achsen-Grids
let labelGroup = null;
let overlay = null;
let isOpen = false;
let resizeObs = null;
let onKeyHandler = null;
let currentDimension = "shape"; // "shape" | "location"

// ---------- Hilfen ----------
function makeTextSprite(text, opts = {}) {
    const fontSize = opts.fontSize ?? 56;
    const color = opts.color ?? "#cbd5e1";
    const padding = 12;
    const fontDecl = `${opts.weight ?? 600} ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;

    const mctx = document.createElement("canvas").getContext("2d");
    mctx.font = fontDecl;
    const tw = mctx.measureText(text).width;

    const cw = Math.max(64, Math.ceil(tw + padding * 2));
    const ch = fontSize + padding * 2;
    const c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    const ctx = c.getContext("2d");
    ctx.font = fontDecl;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 10;
    ctx.fillStyle = color;
    ctx.fillText(text, cw / 2, ch / 2);

    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    const aspect = cw / ch;
    const worldH = opts.worldHeight ?? 0.22;
    sprite.scale.set(worldH * aspect, worldH, 1);
    return sprite;
}

// ---------- Daten-Aggregation ----------
function aggregateByDimension(rawData, dimension) {
    // Liefert: { categories: [name1, name2, ...], years: [y0..yN], series: {name: [count_y0, count_y1, ...]} }
    const counts = new Map();      // name -> Map<year, count>
    const totals = new Map();      // name -> total

    for (const row of rawData) {
        let key = null;
        if (dimension === "shape") {
            const s = (row.Shape || "").trim();
            if (!s) continue;
            key = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
        } else {
            // location: letzten Komma-Eintrag (Land) nehmen
            const loc = (row.Location || "").trim();
            if (!loc) continue;
            const parts = loc.split(",").map(s => s.trim()).filter(Boolean);
            if (parts.length < 2) continue;
            const country = parts[parts.length - 1];
            if (!country || country.toLowerCase() === "unspecified") continue;
            key = country;
        }
        if (!key) continue;

        const m = row.Occurred?.match(/^(\d{4})/);
        if (!m) continue;
        const year = parseInt(m[1], 10);
        if (!Number.isFinite(year)) continue;

        if (!counts.has(key)) counts.set(key, new Map());
        const ym = counts.get(key);
        ym.set(year, (ym.get(year) || 0) + 1);
        totals.set(key, (totals.get(key) || 0) + 1);
    }

    // Top-N Kategorien nach Gesamtsumme
    const top = [...totals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_N)
        .map(([n]) => n);

    // Jahresbereich aus den gefilterten Kategorien
    let yMin = Infinity, yMax = -Infinity;
    for (const cat of top) {
        for (const y of counts.get(cat).keys()) {
            if (y < yMin) yMin = y;
            if (y > yMax) yMax = y;
        }
    }
    if (!Number.isFinite(yMin)) return null;
    const years = [];
    for (let y = yMin; y <= yMax; y++) years.push(y);

    const series = {};
    let max = 0;
    for (const cat of top) {
        const ym = counts.get(cat);
        const arr = years.map(y => ym.get(y) || 0);
        series[cat] = arr;
        const m = Math.max(...arr);
        if (m > max) max = m;
    }

    return { categories: top, years, series, maxCount: max };
}

// ---------- Szene ----------
function setupBaseScene() {
    scene = new THREE.Scene();
    scene.background = null;

    camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
    // Surface-Plot von schräg oben (klassische 3D-Plot-Perspektive)
    camera.position.set(9, 7.5, 9);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(5, 12, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xaab6ff, 0.55);
    fill.position.set(-6, 4, -4);
    scene.add(fill);
    const rim = new THREE.PointLight(0xfbbf24, 0.4, 25);
    rim.position.set(-4, 6, 6);
    scene.add(rim);

    // Sterne im Hintergrund
    const starGeo = new THREE.BufferGeometry();
    const stars = 600;
    const starPos = new Float32Array(stars * 3);
    for (let i = 0; i < stars; i++) {
        const r = 60 + Math.random() * 40;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(Math.random() * 0.9 + 0.05);
        starPos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
        starPos[i*3+1] = r * Math.cos(phi);
        starPos[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
        color: 0xffffff, size: 0.16, sizeAttenuation: true,
        transparent: true, opacity: 0.6, depthWrite: false,
    })));

    surfaceGroup = new THREE.Group();
    scene.add(surfaceGroup);
    labelGroup = new THREE.Group();
    scene.add(labelGroup);
}

function clearSurface() {
    while (surfaceGroup.children.length) {
        const m = surfaceGroup.children.pop();
        m.geometry?.dispose?.();
        if (Array.isArray(m.material)) m.material.forEach(mt => mt.dispose?.());
        else m.material?.dispose?.();
    }
    while (labelGroup.children.length) {
        const m = labelGroup.children.pop();
        m.material?.map?.dispose?.();
        m.material?.dispose?.();
    }
}

// Erzeugt eine glatte 3D-Surface aus (Jahr × Kategorie) → Höhe (count).
// Färbung pro Vertex via Plasma-Colormap, Phong-Shading für den Wachs-Look.
function buildSurface(dimension) {
    if (!scene) return;
    clearSurface();
    currentDimension = dimension;

    const data = aggregateByDimension(window.__rawDataRef || [], dimension);
    if (!data) return;

    const { categories, years, series, maxCount } = data;
    const Nx = years.length;
    const Ny = categories.length;
    if (Nx < 2 || Ny < 2) return;

    const logMax = Math.log(maxCount + 1);
    const xStride = SURFACE_WIDTH / (Nx - 1);
    const zStride = SURFACE_DEPTH / (Ny - 1);
    const xOffset = -SURFACE_WIDTH / 2;
    const zOffset = -SURFACE_DEPTH / 2;

    // Vertices, Farben und Indices aufbauen
    const positions = new Float32Array(Nx * Ny * 3);
    const colors = new Float32Array(Nx * Ny * 3);
    const indices = [];

    for (let yi = 0; yi < Ny; yi++) {
        const row = series[categories[yi]];
        for (let xi = 0; xi < Nx; xi++) {
            const count = row[xi] || 0;
            const norm = count > 0 ? Math.log(count + 1) / logMax : 0;
            const h = norm * HEIGHT_SCALE;
            const vi = (yi * Nx + xi) * 3;
            positions[vi]     = xOffset + xi * xStride;
            positions[vi + 1] = h;
            positions[vi + 2] = zOffset + yi * zStride;
            const c = plasmaColor(norm);
            colors[vi]     = c[0];
            colors[vi + 1] = c[1];
            colors[vi + 2] = c[2];
        }
    }
    for (let yi = 0; yi < Ny - 1; yi++) {
        for (let xi = 0; xi < Nx - 1; xi++) {
            const a = yi * Nx + xi;
            const b = yi * Nx + xi + 1;
            const c = (yi + 1) * Nx + xi;
            const d = (yi + 1) * Nx + xi + 1;
            indices.push(a, c, b, b, c, d);
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshPhongMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        shininess: 36,
        specular: 0x222222,
        flatShading: false,
    });
    const surface = new THREE.Mesh(geo, mat);
    surfaceGroup.add(surface);

    // Drahtgitter-Layer darüber für die Plot-Optik
    const wireMat = new THREE.LineBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false,
    });
    const wire = new THREE.Mesh(geo, wireMat);
    wire.material = wireMat;
    surfaceGroup.add(new THREE.LineSegments(
        new THREE.WireframeGeometry(geo),
        wireMat,
    ));

    // Subtiler Boden-Grid auf y=0 — heller als beim alten Ribbon-Look
    const gridHelper = new THREE.GridHelper(
        Math.max(SURFACE_WIDTH, SURFACE_DEPTH) * 1.2, 24,
        0x2a3148, 0x2a3148,
    );
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.45;
    gridHelper.position.y = -0.01;
    surfaceGroup.add(gridHelper);

    // Achsen-Linien (X = Jahre, Z = Kategorien, Y = Counts)
    const axisMat = new THREE.LineBasicMaterial({ color: 0x6b8cff, transparent: true, opacity: 0.55 });
    const axisGeo = new THREE.BufferGeometry();
    axisGeo.setFromPoints([
        new THREE.Vector3(xOffset, 0, zOffset),
        new THREE.Vector3(xOffset + SURFACE_WIDTH, 0, zOffset),
        new THREE.Vector3(xOffset, 0, zOffset),
        new THREE.Vector3(xOffset, 0, zOffset + SURFACE_DEPTH),
        new THREE.Vector3(xOffset, 0, zOffset),
        new THREE.Vector3(xOffset, HEIGHT_SCALE, zOffset),
    ]);
    surfaceGroup.add(new THREE.LineSegments(axisGeo, axisMat));

    // Achsenbeschriftung
    // X (Jahre): ein paar Ticks am Rand
    const tickStep = Math.max(5, Math.ceil(Nx / 8));
    years.forEach((y, i) => {
        if (i % tickStep !== 0 && i !== Nx - 1) return;
        const sprite = makeTextSprite(String(y), {
            fontSize: 52, color: "#cbd5e1", weight: 600, worldHeight: 0.22,
        });
        sprite.position.set(xOffset + i * xStride, -0.08, zOffset - 0.45);
        labelGroup.add(sprite);
    });
    // Z (Kategorien): Label pro Reihe
    categories.forEach((cat, yi) => {
        const sprite = makeTextSprite(cat, {
            fontSize: 52, color: "#f1f5f9", weight: 700, worldHeight: 0.24,
        });
        sprite.position.set(xOffset - 0.6, -0.08, zOffset + yi * zStride);
        labelGroup.add(sprite);
    });
    // Y (Counts): ein paar Höhenmarker
    const ySteps = 4;
    for (let i = 1; i <= ySteps; i++) {
        const norm = i / ySteps;
        const value = Math.round(Math.exp(norm * logMax) - 1);
        const sprite = makeTextSprite(value.toLocaleString("de-DE"), {
            fontSize: 48, color: "#94a3b8", weight: 600, worldHeight: 0.2,
        });
        sprite.position.set(xOffset - 0.35, norm * HEIGHT_SCALE, zOffset - 0.05);
        labelGroup.add(sprite);
    }
}

// ---------- Renderer / Animation ----------
function setupRenderer(stage) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    stage.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 5;
    controls.maxDistance = 30;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.target.set(0, 1.2, 0);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.3;

    const onResize = () => {
        const w = stage.clientWidth;
        const h = stage.clientHeight;
        if (w === 0 || h === 0) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    };
    resizeObs = new ResizeObserver(onResize);
    resizeObs.observe(stage);
    onResize();

    renderer.domElement.addEventListener("pointerdown", () => {
        controls.autoRotate = false;
    });

    renderer.setAnimationLoop(() => {
        controls.update();
        renderer.render(scene, camera);
    });
}

// ---------- Overlay ----------
async function openOverlay() {
    if (isOpen) return;
    if (!window.__rawDataRef || window.__rawDataRef.length === 0) {
        alert("Timeline-Daten sind noch nicht bereit.");
        return;
    }
    isOpen = true;

    overlay = document.createElement("div");
    overlay.className = "timeline-3d-overlay";
    overlay.innerHTML = `
        <div class="timeline-3d-overlay__stage" id="timeline-3d-stage"></div>
        <div class="timeline-3d-overlay__hud">
            <p class="timeline-3d-overlay__eyebrow">Sichtungen über die Jahre · 3D</p>
            <p class="timeline-3d-overlay__title" id="t3d-title">Sichtungen über Jahre × Shapes (Surface)</p>
        </div>
        <div class="timeline-3d-overlay__controls">
            <label class="timeline-3d-overlay__dim-label" for="t3d-dim">Dimension</label>
            <select id="t3d-dim" class="timeline-3d-overlay__dim-select">
                <option value="shape">Shapes</option>
                <option value="location">Länder</option>
            </select>
        </div>
        <button type="button" class="timeline-3d-overlay__close" aria-label="Schließen">×</button>
        <div class="timeline-3d-overlay__hint">
            Ziehen zum Drehen · Scroll zum Zoom · Dropdown wechselt 3. Achse · ESC schließt
        </div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add("timeline-3d-active");

    const stage = overlay.querySelector(".timeline-3d-overlay__stage");
    const titleEl = overlay.querySelector("#t3d-title");
    const dimSelect = overlay.querySelector("#t3d-dim");

    if (!scene) setupBaseScene();
    buildSurface("shape");
    setupRenderer(stage);

    dimSelect.addEventListener("change", () => {
        const dim = dimSelect.value;
        titleEl.textContent = dim === "shape"
            ? "Sichtungen über Jahre × Shapes (Surface)"
            : "Sichtungen über Jahre × Länder (Surface)";
        buildSurface(dim);
    });

    overlay.querySelector(".timeline-3d-overlay__close").addEventListener("click", closeOverlay);
    onKeyHandler = (e) => { if (e.key === "Escape") closeOverlay(); };
    document.addEventListener("keydown", onKeyHandler);

    try {
        const fn = overlay.requestFullscreen || overlay.webkitRequestFullscreen;
        if (fn) await fn.call(overlay);
    } catch (err) {
        console.info("Vollbild nicht möglich:", err?.message ?? err);
    }
}

function closeOverlay() {
    if (!isOpen) return;
    isOpen = false;

    if (onKeyHandler) {
        document.removeEventListener("keydown", onKeyHandler);
        onKeyHandler = null;
    }

    if (renderer) {
        renderer.setAnimationLoop(null);
        renderer.dispose?.();
        renderer.domElement?.remove();
        renderer = null;
    }
    if (controls) {
        controls.dispose?.();
        controls = null;
    }
    if (resizeObs) {
        resizeObs.disconnect();
        resizeObs = null;
    }

    if (document.fullscreenElement || document.webkitFullscreenElement) {
        const fn = document.exitFullscreen || document.webkitExitFullscreen;
        if (fn) fn.call(document).catch(() => {});
    }

    overlay?.remove();
    overlay = null;
    document.body.classList.remove("timeline-3d-active");
}

// ---------- Button verdrahten ----------
function wireButton() {
    const btn = document.getElementById("timeline-3d-button");
    if (!btn) return;
    btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
            btn.disabled = true;
            await openOverlay();
        } catch (err) {
            console.error("Timeline-3D fehlgeschlagen:", err);
        } finally {
            btn.disabled = false;
        }
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireButton);
} else {
    wireButton();
}
