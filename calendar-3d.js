// calendar-3d.js — 3D-Jahres-Skyline der Sichtungs-Heatmap.
// Jeder Tag wird zu einer Säule, deren Höhe die Anzahl Sichtungen abbildet.
// Die Wochengrid-Struktur (7 × 53) bleibt erhalten, sodass Muster über
// Wochentage und Saisons dreidimensional sichtbar werden.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ---------- Konfiguration ----------
const CELL_SIZE = 0.18;             // Kantenlänge einer Säule in Welt-Einheiten
const CELL_GAP = 0.04;              // Abstand zwischen Säulen
const STRIDE = CELL_SIZE + CELL_GAP;
const HEIGHT_SCALE = 0.55;          // log(count+1) wird mit diesem Faktor skaliert
const MIN_HEIGHT = 0.02;            // Mindestens etwas Höhe, damit Null-Tage als Plättchen sichtbar sind
const BASE_COLOR = new THREE.Color("#0a1628");
const HEAT_COLOR = new THREE.Color("#22d3ee");
const ZERO_COLOR = new THREE.Color("#131828");

// ---------- State ----------
let scene = null;
let camera = null;
let renderer = null;
let controls = null;
let barsGroup = null;
let basePlate = null;
let monthLabelGroup = null;
let monthWallGroup = null;
let raycaster = null;
let pointer = null;
let highlightMesh = null;
let tooltipEl = null;
let yearSelectEl = null;
let titleEl = null;
let bars = [];                       // {mesh, date, count}
let overlay = null;
let currentYear = null;
let resizeObs = null;
let onKeyHandler = null;
let isOpen = false;

// ---------- Hilfsfunktionen ----------
function getCounts() { return window.__countsByDay || null; }
function getYears() { return window.__availableYears || null; }

const MONTH_NAMES_DE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

function makeTextSprite(text, opts = {}) {
    const fontSize = opts.fontSize ?? 64;
    const color = opts.color ?? "#cbd5e1";
    const padding = 12;
    const fontDecl = `${opts.weight ?? 600} ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;

    const measureCanvas = document.createElement("canvas");
    const measureCtx = measureCanvas.getContext("2d");
    measureCtx.font = fontDecl;
    const tw = measureCtx.measureText(text).width;

    const cw = Math.max(64, Math.ceil(tw + padding * 2));
    const ch = fontSize + padding * 2;

    const c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
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

// ISO-Wochenstart (Sonntag) für Spaltenposition
function utcSundayCount(yearStart, date) {
    // Anzahl Sonntage zwischen yearStart (1. Jan) und date
    // Trick: shift, sodass 1. Jan auf Sonntag fällt → einfach (days / 7) ausrechnen
    const start = new Date(Date.UTC(yearStart.getUTCFullYear(), 0, 1));
    const startDow = start.getUTCDay();             // 0..6, mit 0 = Sonntag
    const daysSinceStart = Math.floor((date - start) / 86400000);
    return Math.floor((daysSinceStart + startDow) / 7);
}

// ---------- Szene ----------
function setupBaseScene() {
    scene = new THREE.Scene();
    scene.background = null;

    camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
    camera.position.set(0, 4.5, 9);

    // Lichter
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(6, 12, 8);
    scene.add(sun);
    const fill = new THREE.PointLight(0x6b8cff, 0.6, 30);
    fill.position.set(-6, 5, -3);
    scene.add(fill);
    const accent = new THREE.PointLight(0x22d3ee, 0.5, 20);
    accent.position.set(4, 3, 6);
    scene.add(accent);

    // Sterne — sanfter Hintergrund
    const starGeo = new THREE.BufferGeometry();
    const starCount = 800;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
        // Im Halbraum oben um die Szene verteilen
        const r = 50 + Math.random() * 30;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(Math.random() * 0.8 + 0.1);  // nicht zu tief unter den Boden
        starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        starPos[i * 3 + 1] = r * Math.cos(phi);
        starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
        color: 0xffffff, size: 0.18, sizeAttenuation: true, transparent: true, opacity: 0.65,
    });
    scene.add(new THREE.Points(starGeo, starMat));

    barsGroup = new THREE.Group();
    scene.add(barsGroup);
    monthLabelGroup = new THREE.Group();
    scene.add(monthLabelGroup);
    monthWallGroup = new THREE.Group();
    scene.add(monthWallGroup);

    // Highlight-Box, die beim Hover aktiviert wird
    const hlMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false,
    });
    highlightMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), hlMat);
    highlightMesh.visible = false;
    scene.add(highlightMesh);

    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();
}

function clearYear() {
    while (barsGroup.children.length) {
        const m = barsGroup.children.pop();
        m.geometry?.dispose?.();
        m.material?.dispose?.();
    }
    while (monthLabelGroup.children.length) {
        const m = monthLabelGroup.children.pop();
        m.material?.map?.dispose?.();
        m.material?.dispose?.();
    }
    while (monthWallGroup.children.length) {
        const m = monthWallGroup.children.pop();
        m.geometry?.dispose?.();
        m.material?.dispose?.();
    }
    if (basePlate) {
        scene.remove(basePlate);
        basePlate.geometry.dispose();
        basePlate.material.dispose();
        basePlate = null;
    }
    bars = [];
}

function buildYear(year) {
    if (!scene) return;
    clearYear();
    currentYear = year;

    const counts = getCounts();
    if (!counts) return;

    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

    // Alle Tage einsammeln und max bestimmen
    let maxCount = 0;
    const days = [];
    for (let d = new Date(yearStart); d < yearEnd; d.setUTCDate(d.getUTCDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        const c = counts.get(key) || 0;
        if (c > maxCount) maxCount = c;
        days.push({ date: new Date(d), count: c });
    }
    if (maxCount === 0) maxCount = 1;
    const logMax = Math.log(maxCount + 1);

    // Wochenraster ausrechnen (für zentrierte Platzierung)
    const weeksInYear = utcSundayCount(yearStart, yearEnd) + 1;
    const totalWidth = weeksInYear * STRIDE;
    const totalDepth = 7 * STRIDE;
    const offsetX = -totalWidth / 2 + STRIDE / 2;
    const offsetZ = -totalDepth / 2 + STRIDE / 2;

    // Boden-Plate
    const baseGeo = new THREE.BoxGeometry(totalWidth + 0.6, 0.05, totalDepth + 0.6);
    const baseMat = new THREE.MeshStandardMaterial({
        color: 0x0a0e1a, metalness: 0.5, roughness: 0.5,
        emissive: 0x0d1b35, emissiveIntensity: 0.35,
    });
    basePlate = new THREE.Mesh(baseGeo, baseMat);
    basePlate.position.y = -0.025;
    scene.add(basePlate);

    // Boden-Glow-Ring
    const glow = new THREE.Mesh(
        new THREE.RingGeometry(Math.max(totalWidth, totalDepth) * 0.55, Math.max(totalWidth, totalDepth) * 0.85, 64),
        new THREE.MeshBasicMaterial({
            color: 0x6b8cff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false,
        }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -0.04;
    scene.add(glow);
    basePlate.userData.glow = glow; // damit clearYear es auch rauswirft
    basePlate.add(glow);

    // Säulen erzeugen (geteilte Geometrie für Performance)
    const sharedGeo = new THREE.BoxGeometry(CELL_SIZE, 1, CELL_SIZE);
    const tmpColor = new THREE.Color();

    for (const { date, count } of days) {
        const week = utcSundayCount(yearStart, date);
        const dow = date.getUTCDay();             // 0=So .. 6=Sa
        const x = offsetX + week * STRIDE;
        const z = offsetZ + dow * STRIDE;

        const heat = count > 0 ? Math.log(count + 1) / logMax : 0;
        const h = count > 0 ? Math.max(MIN_HEIGHT, heat * HEIGHT_SCALE * 6) : MIN_HEIGHT;

        if (count > 0) {
            tmpColor.copy(BASE_COLOR).lerp(HEAT_COLOR, heat);
        } else {
            tmpColor.copy(ZERO_COLOR);
        }

        const mat = new THREE.MeshStandardMaterial({
            color: tmpColor.clone(),
            metalness: 0.45,
            roughness: 0.4,
            emissive: count > 0 ? tmpColor.clone().multiplyScalar(heat * 0.55) : new THREE.Color(0),
            emissiveIntensity: count > 0 ? 0.6 : 0,
        });

        const mesh = new THREE.Mesh(sharedGeo, mat);
        mesh.position.set(x, h / 2, z);
        mesh.scale.set(1, h, 1);
        mesh.userData = { date, count };
        barsGroup.add(mesh);
        bars.push({ mesh, date, count });
    }

    // Grüne Trennwände zwischen den Monaten — gestuft analog zur 2D-Heatmap.
    // Pro Monatsgrenze werden bis zu drei Segmente erzeugt:
    //   1) vertikal links der Wochenspalte, in der der 1. liegt (Reihen ab dow bis 6)
    //   2) horizontal innerhalb dieser Wochenspalte (zwischen Reihe dow-1 und dow)
    //   3) vertikal rechts der Wochenspalte (Reihen 0 bis dow-1)
    const wallHeight = 1.6;
    const wallThickness = 0.05;

    function addWallSegment(width, depth, x, z) {
        const wallMat = new THREE.MeshStandardMaterial({
            color: 0x10b981,                  // Emerald-Grün
            emissive: 0x10b981,
            emissiveIntensity: 0.55,
            metalness: 0.35,
            roughness: 0.32,
            transparent: true,
            opacity: 0.55,
            depthWrite: false,                // damit Bars dahinter sichtbar bleiben
        });
        const wall = new THREE.Mesh(
            new THREE.BoxGeometry(width, wallHeight, depth),
            wallMat,
        );
        wall.position.set(x, wallHeight / 2, z);
        monthWallGroup.add(wall);

        // Heller Glow-Streifen oben drauf — gleiche Footprint, etwas größer
        const stripMat = new THREE.MeshBasicMaterial({
            color: 0x6ee7b7,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
        });
        const strip = new THREE.Mesh(
            new THREE.BoxGeometry(width + 0.03, 0.04, depth + 0.03),
            stripMat,
        );
        strip.position.set(x, wallHeight + 0.02, z);
        monthWallGroup.add(strip);
    }

    for (let m = 1; m < 12; m++) {
        const monthStart = new Date(Date.UTC(year, m, 1));
        const week = utcSundayCount(yearStart, monthStart);
        const dow = monthStart.getUTCDay();   // 0 = So, 6 = Sa

        // Genau wie der 2D-Pfad:  M (w+1)*cs, dow*cs   V 0   H w*cs
        //   → Vertikale am rechten Rand der Wochenspalte, von der Top-Kante
        //     genau dow Zellen weit nach unten (in 2D-Richtung "nach unten",
        //     in 3D entspricht das +z von der Sonntag-Reihe weg).
        //   → Horizontale entlang der Top-Kante, eine Zelle breit.

        // Vertikale "Stufe" — länge entspricht 2D exakt: dow Zellen
        if (dow > 0) {
            const lengthZ = dow * STRIDE;
            // Vom hinteren Grid-Rand (vor Reihe 0) bis zur Grenze zw. Reihe dow-1 und dow
            const startZ = offsetZ - STRIDE / 2;
            const endZ = offsetZ + (dow - 0.5) * STRIDE;
            const centerZ = (startZ + endZ) / 2;
            addWallSegment(
                wallThickness, lengthZ,
                offsetX + (week + 0.5) * STRIDE,
                centerZ,
            );
        }

        // Horizontale "Stufe" am oberen Grid-Rand — eine Spalte breit
        addWallSegment(
            STRIDE, wallThickness,
            offsetX + week * STRIDE,
            offsetZ - STRIDE / 2,
        );
    }

    // Monatslabels entlang der Vorderkante
    for (let m = 0; m < 12; m++) {
        const monthStart = new Date(Date.UTC(year, m, 1));
        const week = utcSundayCount(yearStart, monthStart);
        const sprite = makeTextSprite(MONTH_NAMES_DE[m], {
            fontSize: 80, color: "#94a3b8", weight: 700, worldHeight: 0.22,
        });
        sprite.position.set(
            offsetX + week * STRIDE,
            0.18,
            offsetZ + 7 * STRIDE + 0.35,
        );
        monthLabelGroup.add(sprite);
    }

    // Titel + Statistik aktualisieren
    if (titleEl) {
        const totalSightings = days.reduce((s, d) => s + d.count, 0);
        titleEl.textContent = `${year} · ${totalSightings.toLocaleString("de-DE")} Sichtungen · Max ${maxCount} an einem Tag`;
    }
}

// ---------- Renderer ----------
function setupRenderer(stage) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    stage.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3;
    controls.maxDistance = 25;
    controls.maxPolarAngle = Math.PI / 2.05;        // nicht unter den Boden schauen
    controls.target.set(0, 0.5, 0);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.55;

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

    // Hover-Tracking
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    // Bei jeder User-Interaktion AutoRotate stoppen
    renderer.domElement.addEventListener("pointerdown", () => {
        controls.autoRotate = false;
    });

    renderer.setAnimationLoop(() => {
        controls.update();
        renderer.render(scene, camera);
    });
}

function onPointerMove(e) {
    if (!renderer || !raycaster) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(barsGroup.children, false);
    if (hits.length > 0) {
        const hit = hits[0].object;
        const { date, count } = hit.userData;

        // Highlight-Box auf den Balken setzen
        highlightMesh.scale.set(CELL_SIZE * 1.25, hit.scale.y * 1.05, CELL_SIZE * 1.25);
        highlightMesh.position.copy(hit.position);
        highlightMesh.visible = true;

        // Tooltip aktualisieren
        if (tooltipEl) {
            const dateStr = date.toLocaleDateString("de-DE", {
                weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
            });
            tooltipEl.innerHTML = `
                <strong>${dateStr}</strong><br/>
                ${count} Sichtung${count === 1 ? "" : "en"}
            `;
            tooltipEl.style.left = `${e.clientX + 14}px`;
            tooltipEl.style.top = `${e.clientY + 14}px`;
            tooltipEl.classList.add("is-visible");
        }
    } else {
        highlightMesh.visible = false;
        if (tooltipEl) tooltipEl.classList.remove("is-visible");
    }
}

function onPointerLeave() {
    highlightMesh.visible = false;
    if (tooltipEl) tooltipEl.classList.remove("is-visible");
}

// ---------- Overlay ----------
async function openOverlay() {
    if (isOpen) return;
    const counts = getCounts();
    const years = getYears();
    if (!counts || !years || years.length === 0) {
        alert("Kalender-Daten sind noch nicht bereit.");
        return;
    }
    isOpen = true;

    // Aktuell im Dropdown ausgewähltes Jahr übernehmen, falls vorhanden
    const pageSelect = document.getElementById("year-select");
    const startYear = pageSelect ? +pageSelect.value : years[0];

    overlay = document.createElement("div");
    overlay.className = "calendar-3d-overlay";
    overlay.innerHTML = `
        <div class="calendar-3d-overlay__stage" id="calendar-3d-stage"></div>
        <div class="calendar-3d-overlay__hud">
            <p class="calendar-3d-overlay__eyebrow">Jahres-Skyline · UFO-Sichtungen</p>
            <p class="calendar-3d-overlay__title" id="calendar-3d-title"></p>
            <div class="calendar-3d-overlay__legend">
                <span class="calendar-3d-overlay__legend-label">Weniger</span>
                <span class="calendar-3d-overlay__legend-bar"></span>
                <span class="calendar-3d-overlay__legend-label">Mehr</span>
            </div>
        </div>
        <div class="calendar-3d-overlay__controls">
            <label class="calendar-3d-overlay__year-label" for="calendar-3d-year">Jahr</label>
            <select id="calendar-3d-year" class="calendar-3d-overlay__year-select"></select>
        </div>
        <button type="button" class="calendar-3d-overlay__close" aria-label="Schließen">×</button>
        <div class="calendar-3d-overlay__hint">
            Ziehen zum Drehen · Scroll zum Zoom · Hover für Detail · ESC schließt
        </div>
        <div class="calendar-3d-overlay__tooltip" id="calendar-3d-tooltip"></div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add("calendar-3d-active");

    const stage = overlay.querySelector(".calendar-3d-overlay__stage");
    titleEl = overlay.querySelector("#calendar-3d-title");
    tooltipEl = overlay.querySelector("#calendar-3d-tooltip");
    yearSelectEl = overlay.querySelector("#calendar-3d-year");

    // Year-Select befüllen
    years.forEach(y => {
        const opt = document.createElement("option");
        opt.value = y;
        opt.textContent = y;
        yearSelectEl.appendChild(opt);
    });
    yearSelectEl.value = startYear;
    yearSelectEl.addEventListener("change", () => {
        buildYear(+yearSelectEl.value);
    });

    if (!scene) setupBaseScene();
    buildYear(startYear);
    setupRenderer(stage);

    // Schließ-Button + ESC
    overlay.querySelector(".calendar-3d-overlay__close").addEventListener("click", closeOverlay);
    onKeyHandler = (e) => { if (e.key === "Escape") closeOverlay(); };
    document.addEventListener("keydown", onKeyHandler);

    // Vollbild
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
        renderer.domElement.removeEventListener("pointermove", onPointerMove);
        renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
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

    // Vollbild verlassen
    if (document.fullscreenElement || document.webkitFullscreenElement) {
        const fn = document.exitFullscreen || document.webkitExitFullscreen;
        if (fn) fn.call(document).catch(() => {});
    }

    overlay?.remove();
    overlay = null;
    tooltipEl = null;
    titleEl = null;
    yearSelectEl = null;
    document.body.classList.remove("calendar-3d-active");
}

// ---------- Button verdrahten ----------
function wireButton() {
    const btn = document.getElementById("calendar-3d-button");
    if (!btn) return;
    btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
            btn.disabled = true;
            await openOverlay();
        } catch (err) {
            console.error("Calendar-3D fehlgeschlagen:", err);
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
