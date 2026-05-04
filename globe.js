// globe.js — 3D-Globus mit UFO-Sichtungs-Heatmap und umkreisenden Aliens.
// Three.js + WebXR (ARButton) für AR auf unterstützten Geräten,
// optional AR.js Marker-AR (A-Frame) als zusätzlicher Pfad für iOS / Mac / alte Androids.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ARButton } from "three/addons/webxr/ARButton.js";
import * as d3 from "https://esm.sh/d3@7";
import * as topojson from "https://esm.sh/topojson-client@3";

// ---------- AR.js Marker-AR (Lazy-Load, eigenes Overlay) ----------
const HIRO_MARKER_URL = "https://stemkoski.github.io/AR-Examples/markers/hiro.png";

let arjsAssetsPromise = null;
function loadArJsAssets() {
    if (arjsAssetsPromise) return arjsAssetsPromise;
    arjsAssetsPromise = new Promise((resolve, reject) => {
        const loadScript = (src) => new Promise((res, rej) => {
            const s = document.createElement("script");
            s.src = src;
            s.onload = () => res();
            s.onerror = () => rej(new Error(`Failed to load ${src}`));
            document.head.appendChild(s);
        });
        // A-Frame 1.3.0 ist die von AR.js 3.4.5 offiziell empfohlene Version
        loadScript("https://aframe.io/releases/1.3.0/aframe.min.js")
            .then(() => loadScript("https://raw.githack.com/AR-js-org/AR.js/3.4.5/aframe/build/aframe-ar.js"))
            .then(() => {
                registerArJsUfoComponent();
                resolve();
            })
            .catch(reject);
    });
    return arjsAssetsPromise;
}

function registerArJsUfoComponent() {
    if (!window.AFRAME || window.AFRAME.components["arjs-ufo"]) return;
    const T = window.AFRAME.THREE;

    window.AFRAME.registerComponent("arjs-ufo", {
        init() {
            const group = new T.Group();

            // Untertasse
            const saucer = new T.Mesh(
                new T.SphereGeometry(0.5, 32, 18),
                new T.MeshStandardMaterial({
                    color: 0xc0c8d4, metalness: 0.75, roughness: 0.28,
                }),
            );
            saucer.scale.set(1, 0.22, 1);
            group.add(saucer);

            // Saucer-Akzentstreifen
            const accent = new T.Mesh(
                new T.TorusGeometry(0.5, 0.03, 12, 64),
                new T.MeshStandardMaterial({
                    color: 0x1f2937, metalness: 0.9, roughness: 0.4,
                }),
            );
            accent.rotation.x = Math.PI / 2;
            group.add(accent);

            // Kuppel
            const dome = new T.Mesh(
                new T.SphereGeometry(0.22, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2),
                new T.MeshStandardMaterial({
                    color: 0x67e8f9, transparent: true, opacity: 0.85,
                    emissive: 0x22d3ee, emissiveIntensity: 0.55, roughness: 0.18,
                }),
            );
            dome.position.y = 0.05;
            group.add(dome);

            // Strahl (Kegel nach unten)
            const beam = new T.Mesh(
                new T.ConeGeometry(0.42, 1.1, 32, 1, true),
                new T.MeshBasicMaterial({
                    color: 0x22d3ee, transparent: true, opacity: 0.22,
                    side: T.DoubleSide, depthWrite: false,
                }),
            );
            beam.rotation.x = Math.PI;
            beam.position.y = -0.55;
            group.add(beam);

            // Blink-Lichter am Rand
            this.lights = [];
            const colors = [0xfbbf24, 0x22d3ee, 0xfb7185];
            const numLights = 8;
            for (let i = 0; i < numLights; i++) {
                const a = (i / numLights) * Math.PI * 2;
                const lm = new T.Mesh(
                    new T.SphereGeometry(0.05, 12, 10),
                    new T.MeshBasicMaterial({ color: colors[i % 3] }),
                );
                lm.position.set(Math.cos(a) * 0.48, 0.015, Math.sin(a) * 0.48);
                this.lights.push(lm);
                group.add(lm);
            }

            // Schwebt über Marker
            group.position.y = 0.6;
            this.group = group;
            this.el.setObject3D("ufo", group);

            // Lichter im Marker-Koord-System
            const ambient = new T.AmbientLight(0xffffff, 0.55);
            const dir = new T.DirectionalLight(0xffffff, 1.0);
            dir.position.set(2, 4, 3);
            this.el.setObject3D("ambient", ambient);
            this.el.setObject3D("dirLight", dir);
        },
        tick(time) {
            if (!this.group) return;
            const t = time / 1000;
            // sanftes Schweben + Spin
            this.group.position.y = 0.6 + Math.sin(t * 1.2) * 0.08;
            this.group.rotation.y = t * 0.55;
            // Blink-Lichter
            for (let i = 0; i < this.lights.length; i++) {
                const lm = this.lights[i];
                lm.material.opacity = 0.55 + 0.45 * Math.sin(t * 4 + i);
                lm.material.transparent = true;
            }
        },
        remove() {
            if (this.group) {
                this.group.traverse(obj => {
                    if (obj.geometry) obj.geometry.dispose?.();
                    if (obj.material) obj.material.dispose?.();
                });
            }
        },
    });
}

let arjsOverlay = null;
let arjsOnClose = null;

// AR.js erzeugt sein <video> direkt am <body> mit inline z-index:-2 — wir wollen
// es im Overlay haben (sichtbar + sauber aufräumbar) und müssen das z-index
// permanent überschreiben, da AR.js den Style nachzieht.
function forceVideoStyle(v) {
    const set = (k, val) => v.style.setProperty(k, val, "important");
    set("position", "absolute");
    set("top", "0");
    set("left", "0");
    set("width", "100%");
    set("height", "100%");
    set("object-fit", "cover");
    set("z-index", "0");
    set("display", "block");
    set("visibility", "visible");
    set("opacity", "1");
}

function adoptArJsVideoInto(overlay) {
    const seen = new WeakSet();

    const adopt = (v) => {
        if (!v || seen.has(v)) return;
        if (v.classList.contains("webcam-ar-feed")) return; // unser Webcam-AR
        if (!overlay.contains(v)) overlay.insertBefore(v, overlay.firstChild);
        v.classList.add("arjs-video-feed");
        forceVideoStyle(v);
        // Falls AR.js den Style später nochmal setzt, beobachten + erneut erzwingen
        const styleObs = new MutationObserver(() => forceVideoStyle(v));
        styleObs.observe(v, { attributes: true, attributeFilter: ["style", "class"] });
        seen.add(v);
        if (!overlay._styleObservers) overlay._styleObservers = [];
        overlay._styleObservers.push(styleObs);
    };

    const scan = () => {
        // Alle Videos im Document, die zu AR.js gehören könnten
        document.querySelectorAll("video").forEach(v => {
            if (overlay.contains(v) && seen.has(v)) return;
            if (v.classList.contains("webcam-ar-feed")) return;
            // Heuristik: AR.js-Video hat id="arjs-video" oder srcObject + autoplay + nicht in unserer Webcam-Klasse
            if (v.id === "arjs-video" || v.srcObject || v.autoplay) {
                adopt(v);
            }
        });
    };

    scan();
    const obs = new MutationObserver(() => scan());
    obs.observe(document.body, { childList: true, subtree: true });
    return obs;
}

function purgeArJsArtifacts() {
    // Alle Streams stoppen, die AR.js erzeugt haben könnte — dabei
    // unsere eigenen Webcam-AR-Feeds in Ruhe lassen.
    const videos = document.querySelectorAll("video.arjs-video-feed, #arjs-video, video:not(.webcam-ar-feed)");
    videos.forEach(v => {
        // Nur Videos mit Stream stoppen + entfernen, sonst könnten wir
        // unbeabsichtigt fremde Videos auf der Seite killen.
        if (v.srcObject) {
            for (const t of v.srcObject.getTracks()) t.stop();
            v.srcObject = null;
            v.remove();
        }
    });

    // AR.js / A-Frame können auch Hilfs-DOM am Body lassen
    document.querySelectorAll("body > .a-canvas, body > .a-loader-title, body > .a-modal").forEach(el => {
        if (!arjsOverlay || !arjsOverlay.contains(el)) el.remove();
    });
}

async function openArJsOverlay({ onClose } = {}) {
    if (arjsOverlay) return;

    // Loading-Indicator
    const loading = document.createElement("div");
    loading.className = "arjs-loading";
    loading.innerHTML = `<span>Lade AR.js…</span>`;
    document.body.appendChild(loading);

    try {
        await loadArJsAssets();
    } catch (err) {
        loading.remove();
        console.error("AR.js Load fehlgeschlagen:", err);
        alert("AR.js konnte nicht geladen werden. Prüfe deine Verbindung.");
        return;
    }
    loading.remove();

    arjsOnClose = onClose ?? null;

    const overlay = document.createElement("div");
    overlay.className = "arjs-overlay";
    // QR-Code, der direkt zum Hiro-Marker-Bild führt (auf Phone öffnen → Phone vor Kamera halten)
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&color=000000&bgcolor=FFFFFF&data=${encodeURIComponent(HIRO_MARKER_URL)}`;

    overlay.innerHTML = `
        <a-scene
            class="arjs-scene"
            embedded
            vr-mode-ui="enabled: false"
            renderer="antialias: true; alpha: true; logarithmicDepthBuffer: true;"
            arjs="sourceType: webcam; debugUIEnabled: false; detectionMode: mono_and_matrix; matrixCodeType: 3x3; trackingMethod: best;"
        >
            <a-marker preset="hiro" smooth="true" smoothCount="5" smoothTolerance="0.01" smoothThreshold="2">
                <a-entity arjs-ufo></a-entity>
            </a-marker>
            <a-entity camera></a-entity>
        </a-scene>
        <button type="button" class="arjs-close" aria-label="AR schließen">×</button>

        <aside class="arjs-marker-card" aria-label="Hiro-Marker">
            <p class="arjs-marker-card__label">Marker scannen ↓</p>
            <img class="arjs-marker-card__img" src="${HIRO_MARKER_URL}" alt="Hiro Marker" />
            <div class="arjs-marker-card__qr-wrap">
                <img class="arjs-marker-card__qr" src="${qrUrl}" alt="QR-Code zum Hiro-Marker" />
                <p class="arjs-marker-card__qr-text">QR mit dem Phone scannen<br/>→ Phone vor Kamera halten</p>
            </div>
            <a class="arjs-marker-card__link" href="${HIRO_MARKER_URL}" target="_blank" rel="noopener">Marker im neuen Tab öffnen</a>
        </aside>

        <div class="arjs-overlay__hud">
            <p class="arjs-overlay__title">AR.js · Hiro Marker</p>
            <p class="arjs-overlay__hint">
                Zeig der Kamera den Marker rechts — das UFO landet darauf
            </p>
        </div>
    `;
    document.body.appendChild(overlay);
    arjsOverlay = overlay;
    document.body.classList.add("arjs-active");

    // Vorab Kamera-Permission anstoßen, damit AR.js gleich Zugriff hat (und
    // wir sehen, ob die Erlaubnis verweigert wurde).
    try {
        const probe = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } }, audio: false,
        });
        // Stream sofort wieder freigeben — AR.js wird gleich seinen eigenen anfordern
        for (const t of probe.getTracks()) t.stop();
    } catch (err) {
        console.error("Kamera-Permission abgelehnt oder nicht verfügbar:", err);
        const hud = overlay.querySelector(".arjs-overlay__hint");
        if (hud) {
            hud.innerHTML = `⚠️ Kamerazugriff verweigert. Erlaube die Kamera in den Browser-Einstellungen und versuch's erneut.`;
        }
    }

    // Video von AR.js ins Overlay holen + dort behalten
    overlay._videoObserver = adoptArJsVideoInto(overlay);

    // Diagnose: nach 6 s ohne Video-Feed → Hinweis
    overlay._diagTimeout = setTimeout(() => {
        if (!overlay.querySelector("video.arjs-video-feed")) {
            console.warn("AR.js: nach 6 s kein Video-Feed adoptiert. Kamera-Permission prüfen.");
            const hud = overlay.querySelector(".arjs-overlay__hint");
            if (hud && !hud.dataset.warned) {
                hud.innerHTML = `⚠️ Keine Kamera erkannt. Erlaube den Browser-Zugriff auf die Kamera und lade die Seite neu.`;
                hud.dataset.warned = "1";
            }
        }
    }, 6000);

    overlay.querySelector(".arjs-close").addEventListener("click", closeArJsOverlay);

    // Esc / Browser-Back
    const onKey = (e) => { if (e.key === "Escape") closeArJsOverlay(); };
    document.addEventListener("keydown", onKey);
    arjsOverlay._onKey = onKey;

    // Vollbild starten (innerhalb des Click-Kontexts)
    try {
        const fn = overlay.requestFullscreen
                 || overlay.webkitRequestFullscreen
                 || overlay.mozRequestFullScreen;
        if (fn) await fn.call(overlay);
    } catch (err) {
        console.info("AR.js Fullscreen nicht möglich:", err?.message ?? err);
    }
}

function closeArJsOverlay() {
    if (!arjsOverlay) return;

    // Observer stoppen, sonst rangelt er um neu erscheinende Videos
    if (arjsOverlay._videoObserver) {
        arjsOverlay._videoObserver.disconnect();
        arjsOverlay._videoObserver = null;
    }
    if (arjsOverlay._styleObservers) {
        arjsOverlay._styleObservers.forEach(o => o.disconnect());
        arjsOverlay._styleObservers = null;
    }
    if (arjsOverlay._diagTimeout) {
        clearTimeout(arjsOverlay._diagTimeout);
        arjsOverlay._diagTimeout = null;
    }

    // A-Frame sauber pausieren, damit Render-Loop endet
    const scene = arjsOverlay.querySelector("a-scene");
    if (scene) {
        try { scene.pause?.(); } catch {}
        try { scene.renderer?.dispose?.(); } catch {}
    }

    // Esc-Listener weg
    if (arjsOverlay._onKey) {
        document.removeEventListener("keydown", arjsOverlay._onKey);
    }

    // Overlay weg (samt verschobenem AR.js-Video)
    arjsOverlay.remove();
    arjsOverlay = null;
    document.body.classList.remove("arjs-active");

    // Reste am Body sauber wegräumen + alle Tracks stoppen
    purgeArJsArtifacts();

    // Fullscreen verlassen, falls noch aktiv
    if (document.fullscreenElement || document.webkitFullscreenElement) {
        const fn = document.exitFullscreen || document.webkitExitFullscreen;
        if (fn) fn.call(document).catch(() => {});
    }

    if (arjsOnClose) {
        try { arjsOnClose(); } catch {}
        arjsOnClose = null;
    }
}

// ---------- Centroids ----------
// Approximate US state centroids [lat, lng]
const US_STATES = {
    "Alabama": [32.78, -86.83], "Alaska": [64.07, -152.28], "Arizona": [34.27, -111.66],
    "Arkansas": [34.90, -92.44], "California": [37.18, -119.47], "Colorado": [38.99, -105.55],
    "Connecticut": [41.62, -72.73], "Delaware": [38.99, -75.51], "Florida": [28.63, -82.45],
    "Georgia": [32.65, -83.44], "Hawaii": [20.29, -156.37], "Idaho": [44.35, -114.61],
    "Illinois": [40.04, -89.20], "Indiana": [39.89, -86.28], "Iowa": [42.07, -93.50],
    "Kansas": [38.49, -98.38], "Kentucky": [37.53, -85.30], "Louisiana": [31.07, -91.99],
    "Maine": [45.37, -69.24], "Maryland": [39.05, -76.79], "Massachusetts": [42.26, -71.81],
    "Michigan": [44.35, -85.41], "Minnesota": [46.28, -94.31], "Mississippi": [32.74, -89.68],
    "Missouri": [38.36, -92.46], "Montana": [47.05, -109.63], "Nebraska": [41.53, -99.81],
    "Nevada": [39.33, -116.63], "New Hampshire": [43.69, -71.58], "New Jersey": [40.19, -74.67],
    "New Mexico": [34.42, -106.11], "New York": [42.95, -75.53], "North Carolina": [35.55, -79.39],
    "North Dakota": [47.45, -100.47], "Ohio": [40.29, -82.79], "Oklahoma": [35.59, -97.49],
    "Oregon": [43.94, -120.55], "Pennsylvania": [40.88, -77.80], "Rhode Island": [41.68, -71.56],
    "South Carolina": [33.92, -80.90], "South Dakota": [44.44, -100.23], "Tennessee": [35.86, -86.35],
    "Texas": [31.48, -99.33], "Utah": [39.31, -111.67], "Vermont": [44.07, -72.67],
    "Virginia": [37.52, -78.85], "Washington": [47.38, -120.45], "West Virginia": [38.64, -80.62],
    "Wisconsin": [44.62, -89.99], "Wyoming": [42.99, -107.55],
    // DC + territories
    "DC": [38.90, -77.04], "District of Columbia": [38.90, -77.04],
    "Puerto Rico": [18.22, -66.59],
};

const COUNTRIES = {
    "USA": [39.5, -98.35], "United States": [39.5, -98.35], "US": [39.5, -98.35],
    "Canada": [56.13, -106.35], "Mexico": [23.63, -102.55],
    "United Kingdom": [54.0, -2.5], "UK": [54.0, -2.5], "England": [52.36, -1.17],
    "Scotland": [56.49, -4.20], "Wales": [52.13, -3.78], "Ireland": [53.41, -8.24],
    "Germany": [51.17, 10.45], "France": [46.23, 2.21], "Spain": [40.46, -3.75],
    "Italy": [41.87, 12.57], "Portugal": [39.40, -8.22], "Netherlands": [52.13, 5.29],
    "Belgium": [50.50, 4.47], "Austria": [47.52, 14.55], "Switzerland": [46.82, 8.23],
    "Poland": [51.92, 19.15], "Czech Republic": [49.82, 15.47], "Denmark": [56.26, 9.50],
    "Sweden": [60.13, 18.64], "Norway": [60.47, 8.47], "Finland": [61.92, 25.75],
    "Russia": [61.52, 105.32], "Ukraine": [48.38, 31.17],
    "Greece": [39.07, 21.82], "Turkey": [38.96, 35.24], "Israel": [31.05, 34.85],
    "Saudi Arabia": [23.89, 45.08], "United Arab Emirates": [23.42, 53.85],
    "India": [20.59, 78.96], "China": [35.86, 104.20], "Japan": [36.20, 138.25],
    "South Korea": [35.91, 127.77], "Korea": [35.91, 127.77],
    "Thailand": [15.87, 100.99], "Vietnam": [14.06, 108.28], "Indonesia": [-0.79, 113.92],
    "Philippines": [12.88, 121.77], "Malaysia": [4.21, 101.98], "Singapore": [1.35, 103.82],
    "Australia": [-25.27, 133.78], "New Zealand": [-40.90, 174.89],
    "Brazil": [-14.24, -51.93], "Argentina": [-38.42, -63.62], "Chile": [-35.68, -71.54],
    "Colombia": [4.57, -74.30], "Peru": [-9.19, -75.02], "Venezuela": [6.42, -66.59],
    "South Africa": [-30.56, 22.94], "Egypt": [26.82, 30.80], "Nigeria": [9.08, 8.68],
    "Kenya": [-0.02, 37.91], "Morocco": [31.79, -7.09],
};

const JUNK = /^\(.*\)$|unspecified|unknown|deleted|hoax/i;

function parseLocation(s) {
    if (!s) return null;
    const parts = s.split(",").map(x => x.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const city = parts[0];
    const country = parts[parts.length - 1];
    const state = parts.length >= 3 ? parts[1] : null;
    if (JUNK.test(city)) return null;
    if (!country || country === "Unspecified") return null;
    return { city, state, country };
}

// Lat/lng → 3D-Vektor auf Kugel mit Radius r
function latLngToVec3(lat, lng, r) {
    const phi = (90 - lat) * Math.PI / 180;
    const theta = (lng + 180) * Math.PI / 180;
    return new THREE.Vector3(
        -r * Math.sin(phi) * Math.cos(theta),
         r * Math.cos(phi),
         r * Math.sin(phi) * Math.sin(theta),
    );
}

// ---------- Länder-Umrisse aus TopoJSON ----------
async function loadCountries() {
    const url = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
    const world = await fetch(url).then(r => r.json());
    return topojson.feature(world, world.objects.countries);
}

// Großkreis-Interpolation zwischen zwei Lat/Lng-Punkten für saubere Bögen
function buildCountryLines(featureCollection, radius = 1.003, color = 0x6b8cff) {
    const positions = [];
    const STEPS = 4; // pro Segment so viele Zwischenpunkte → Kurve folgt der Kugel

    function addArc(lng1, lat1, lng2, lat2) {
        let prev = latLngToVec3(lat1, lng1, radius);
        for (let s = 1; s <= STEPS; s++) {
            const t = s / STEPS;
            const lng = lng1 + (lng2 - lng1) * t;
            const lat = lat1 + (lat2 - lat1) * t;
            const next = latLngToVec3(lat, lng, radius);
            positions.push(prev.x, prev.y, prev.z, next.x, next.y, next.z);
            prev = next;
        }
    }

    for (const feature of featureCollection.features) {
        const geom = feature.geometry;
        if (!geom) continue;
        const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
        for (const poly of polys) {
            for (const ring of poly) {
                for (let i = 0; i < ring.length - 1; i++) {
                    addArc(ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]);
                }
            }
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({
            color, transparent: true, opacity: 0.85, depthWrite: false,
        }),
    );
}

// Optional: Kontinentmasse als leicht eingefärbte Flächen (gefüllte Polygone via Sphere-Sampling)
function buildCountryFills(featureCollection, radius = 1.0015, color = 0x1a2845) {
    // Wir rendern Polygone als Triangulationen auf der Kugeloberfläche.
    // Schnelle Annäherung: Fan-Triangulation pro Ring, dann auf Kugel projiziert.
    const positions = [];
    function pushTri(a, b, c) {
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    }
    for (const feature of featureCollection.features) {
        const geom = feature.geometry;
        if (!geom) continue;
        const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
        for (const poly of polys) {
            const outer = poly[0]; // nur Außenring (Holes ignoriert für Performance)
            if (!outer || outer.length < 3) continue;
            const v0 = latLngToVec3(outer[0][1], outer[0][0], radius);
            for (let i = 1; i < outer.length - 1; i++) {
                const v1 = latLngToVec3(outer[i][1], outer[i][0], radius);
                const v2 = latLngToVec3(outer[i + 1][1], outer[i + 1][0], radius);
                pushTri(v0, v1, v2);
            }
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
            color, metalness: 0.1, roughness: 0.95,
            emissive: 0x0d1b35, emissiveIntensity: 0.35,
            side: THREE.DoubleSide,
        }),
    );
}

// ---------- Datenladen + Aggregation ----------
async function loadAggregated() {
    const raw = await d3.csv("nuforc_str.csv");
    const sightings = raw.map(r => parseLocation(r.Location)).filter(Boolean);

    const bucket = new Map(); // key -> { lat, lng, count, label }
    for (const s of sightings) {
        let key, lat, lng, label;
        if ((s.country === "USA" || s.country === "United States") && s.state && US_STATES[s.state]) {
            key = `US:${s.state}`;
            [lat, lng] = US_STATES[s.state];
            label = `${s.state}, USA`;
        } else if (COUNTRIES[s.country]) {
            key = `C:${s.country}`;
            [lat, lng] = COUNTRIES[s.country];
            label = s.country;
        } else continue;

        if (!bucket.has(key)) bucket.set(key, { lat, lng, count: 0, label });
        bucket.get(key).count++;
    }
    return Array.from(bucket.values());
}

// ---------- UFO-Mesh ----------
function makeUFO() {
    const g = new THREE.Group();

    const saucer = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 18, 10),
        new THREE.MeshStandardMaterial({ color: 0xc0c8d4, metalness: 0.7, roughness: 0.3 }),
    );
    saucer.scale.set(1, 0.22, 1);
    g.add(saucer);

    const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.028, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({
            color: 0x67e8f9, transparent: true, opacity: 0.75,
            emissive: 0x22d3ee, emissiveIntensity: 0.5, roughness: 0.2,
        }),
    );
    dome.position.y = 0.005;
    g.add(dome);

    // Strahl
    const beam = new THREE.Mesh(
        new THREE.ConeGeometry(0.05, 0.12, 18, 1, true),
        new THREE.MeshBasicMaterial({
            color: 0x22d3ee, transparent: true, opacity: 0.18,
            side: THREE.DoubleSide, depthWrite: false,
        }),
    );
    beam.position.y = -0.06;
    g.add(beam);

    // Blink-Lichter
    const lightColors = [0xfbbf24, 0x22d3ee, 0xfb7185];
    g.userData.lights = [];
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const lm = new THREE.Mesh(
            new THREE.SphereGeometry(0.006, 8, 8),
            new THREE.MeshBasicMaterial({ color: lightColors[i % 3] }),
        );
        lm.position.set(Math.cos(a) * 0.058, 0.002, Math.sin(a) * 0.058);
        g.userData.lights.push(lm);
        g.add(lm);
    }
    return g;
}

// ---------- Three.js-Setup ----------
async function init() {
    const container = document.getElementById("globe-container");
    if (!container) return;

    const [data, countries] = await Promise.all([
        loadAggregated(),
        loadCountries().catch(err => {
            console.warn("Countries TopoJSON konnte nicht geladen werden:", err);
            return null;
        }),
    ]);

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(
        50, container.clientWidth / container.clientHeight, 0.05, 100,
    );
    camera.position.set(0, 0.4, 3.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);

    // Globus-Gruppe (für AR-Skalierung)
    const globeGroup = new THREE.Group();
    scene.add(globeGroup);

    // Kugel (Ozeane)
    const globe = new THREE.Mesh(
        new THREE.SphereGeometry(1, 96, 72),
        new THREE.MeshStandardMaterial({
            color: 0x0a1428, metalness: 0.4, roughness: 0.6,
            emissive: 0x081024, emissiveIntensity: 0.45,
        }),
    );
    globeGroup.add(globe);

    // Lat/Lng-Gitter (sehr dezent, nur als Subtext-Schicht)
    const gridGeo = new THREE.SphereGeometry(1.0008, 24, 12);
    const grid = new THREE.LineSegments(
        new THREE.WireframeGeometry(gridGeo),
        new THREE.LineBasicMaterial({ color: 0x4860a8, transparent: true, opacity: 0.06 }),
    );
    globeGroup.add(grid);

    // Kontinente / Länder
    if (countries) {
        const fills = buildCountryFills(countries, 1.0015, 0x1c2a4a);
        globeGroup.add(fills);
        const lines = buildCountryLines(countries, 1.004, 0x6b8cff);
        globeGroup.add(lines);
    }

    // Atmosphäre
    const atmo = new THREE.Mesh(
        new THREE.SphereGeometry(1.07, 48, 32),
        new THREE.ShaderMaterial({
            transparent: true, side: THREE.BackSide, depthWrite: false,
            uniforms: { glowColor: { value: new THREE.Color(0x6b8cff) } },
            vertexShader: `
                varying vec3 vNormal;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }`,
            fragmentShader: `
                varying vec3 vNormal;
                uniform vec3 glowColor;
                void main() {
                    float intensity = pow(0.7 - dot(vNormal, vec3(0, 0, 1.0)), 2.5);
                    gl_FragColor = vec4(glowColor, intensity * 0.65);
                }`,
        }),
    );
    globeGroup.add(atmo);

    // Heatmap-Punkte
    const maxCount = d3.max(data, d => d.count) || 1;
    const minCount = d3.min(data, d => d.count) || 1;
    const colorScale = d3.scaleSequential()
        .domain([Math.log(minCount + 1), Math.log(maxCount + 1)])
        .interpolator(d3.interpolateInferno);

    for (const p of data) {
        const heat = (Math.log(p.count + 1) - Math.log(minCount + 1))
                   / (Math.log(maxCount + 1) - Math.log(minCount + 1) || 1);
        const r = 0.012 + heat * 0.04;
        const c = new THREE.Color(colorScale(Math.log(p.count + 1)));

        const dot = new THREE.Mesh(
            new THREE.SphereGeometry(r, 14, 12),
            new THREE.MeshBasicMaterial({ color: c }),
        );
        const pos = latLngToVec3(p.lat, p.lng, 1.0 + r * 0.6);
        dot.position.copy(pos);
        globeGroup.add(dot);

        // Glühen
        const glow = new THREE.Mesh(
            new THREE.SphereGeometry(r * 2.4, 14, 12),
            new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.25, depthWrite: false }),
        );
        glow.position.copy(pos);
        globeGroup.add(glow);

        // Senkrechte Spike als Höhen-Indikator für viele Sichtungen
        if (heat > 0.3) {
            const len = 0.05 + heat * 0.35;
            const top = latLngToVec3(p.lat, p.lng, 1.0 + len);
            const points = [pos.clone(), top];
            const line = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(points),
                new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.7 }),
            );
            globeGroup.add(line);
        }
    }

    // Aliens (UFO-Schwarm) — kreisen um Globus
    const aliens = [];
    const NUM_ALIENS = 6;
    for (let i = 0; i < NUM_ALIENS; i++) {
        const ufo = makeUFO();
        scene.add(ufo);
        aliens.push({
            mesh: ufo,
            radius: 1.45 + Math.random() * 0.7,
            speed: 0.25 + Math.random() * 0.45,
            tiltAxis: new THREE.Vector3(
                Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5,
            ).normalize(),
            phase: Math.random() * Math.PI * 2,
            wobble: 0.1 + Math.random() * 0.2,
        });
    }

    // Licht
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(5, 4, 5);
    scene.add(sun);
    const fill = new THREE.PointLight(0x6b8cff, 0.7, 12);
    fill.position.set(-4, -2, -3);
    scene.add(fill);

    // Steuerung
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.5;
    controls.maxDistance = 6;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.4;
    controls.enablePan = false;

    // AR / Webcam-AR / Fullscreen-Fallback
    const arHost = document.getElementById("ar-button-host");

    // ---------- Webcam-AR ----------
    let webcamStream = null;
    let webcamVideo = null;
    let webcamActive = false;

    function requestFullscreenOn(el) {
        const fn = el.requestFullscreen
                 || el.webkitRequestFullscreen
                 || el.mozRequestFullScreen
                 || el.msRequestFullscreen;
        return fn ? fn.call(el) : Promise.reject(new Error("Fullscreen API nicht verfügbar"));
    }

    function exitFullscreenIfActive() {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) return;
        const fn = document.exitFullscreen
                 || document.webkitExitFullscreen
                 || document.mozCancelFullScreen
                 || document.msExitFullscreen;
        if (fn) fn.call(document);
    }

    async function startWebcamAR() {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error("Kein Kamerazugriff verfügbar");
        }
        // Bevorzugt Rückkamera (Handy), fällt sonst auf jede Kamera (MacBook) zurück
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: "environment" } }, audio: false,
            });
        } catch {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        webcamVideo = document.createElement("video");
        webcamVideo.className = "webcam-ar-feed";
        webcamVideo.autoplay = true;
        webcamVideo.muted = true;
        webcamVideo.playsInline = true;
        webcamVideo.srcObject = stream;
        container.insertBefore(webcamVideo, container.firstChild);
        await webcamVideo.play().catch(() => {});

        webcamStream = stream;
        webcamActive = true;
        container.classList.add("webcam-ar-active");

        // Globus etwas verkleinern und nach hinten schieben, damit er
        // wie ein schwebendes Hologramm vor der Kamera wirkt
        globeGroup.scale.setScalar(0.55);
        globeGroup.position.set(0, 0, 0);
        for (const a of aliens) a.mesh.scale.setScalar(0.55);

        // Auto-rotate aus, damit der User selbst dreht
        controls.autoRotate = false;

        // Direkt in Vollbild wechseln – Webcam wirkt erst dort wirklich wie AR
        try {
            await requestFullscreenOn(container);
        } catch (err) {
            // Manche Browser blockieren Fullscreen ohne direkten Klick-Trigger;
            // kein Fehler nach außen – AR-Modus läuft trotzdem.
            console.info("Fullscreen nicht verfügbar:", err?.message ?? err);
        }
    }

    function stopWebcamAR() {
        if (webcamStream) {
            for (const t of webcamStream.getTracks()) t.stop();
            webcamStream = null;
        }
        if (webcamVideo) {
            webcamVideo.srcObject = null;
            webcamVideo.remove();
            webcamVideo = null;
        }
        webcamActive = false;
        container.classList.remove("webcam-ar-active");
        globeGroup.scale.setScalar(1);
        for (const a of aliens) a.mesh.scale.setScalar(1);
        controls.autoRotate = true;
        exitFullscreenIfActive();
    }

    // Wenn der User mit Esc aus dem Vollbild geht, Webcam-AR sauber beenden
    document.addEventListener("fullscreenchange", () => {
        if (!document.fullscreenElement && webcamActive) {
            stopWebcamAR();
            // Button-Label zurücksetzen, falls vorhanden
            const activeBtn = arHost?.querySelector(".ar-launch-button.is-active");
            if (activeBtn) {
                activeBtn.classList.remove("is-active");
                const lbl = activeBtn.querySelector(".ar-launch-button__label");
                if (lbl) lbl.textContent = "Kamera-AR starten";
            }
        }
    });

    function makeWebcamARButton() {
        const wrap = document.createElement("div");
        wrap.className = "ar-fallback";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ar-launch-button";
        btn.innerHTML = `<span class="ar-launch-button__icon" aria-hidden="true">📷</span><span class="ar-launch-button__label">Kamera-AR starten</span>`;
        const labelSpan = btn.querySelector(".ar-launch-button__label");

        btn.addEventListener("click", async () => {
            if (webcamActive) {
                stopWebcamAR();
                labelSpan.textContent = "Kamera-AR starten";
                btn.classList.remove("is-active");
            } else {
                try {
                    btn.disabled = true;
                    labelSpan.textContent = "Starte…";
                    await startWebcamAR();
                    labelSpan.textContent = "AR beenden";
                    btn.classList.add("is-active");
                } catch (err) {
                    console.error("Webcam-AR fehlgeschlagen:", err);
                    labelSpan.textContent = "Kamera nicht verfügbar";
                    setTimeout(() => labelSpan.textContent = "Kamera-AR starten", 2500);
                } finally {
                    btn.disabled = false;
                }
            }
        });
        wrap.appendChild(btn);

        const note = document.createElement("p");
        note.className = "ar-hint";
        note.textContent = "Nutzt deine Webcam als Hintergrund – der Globus schwebt vor deiner Realität";
        wrap.appendChild(note);

        return wrap;
    }

    function makeFullscreenButton(label, hint) {
        const wrap = document.createElement("div");
        wrap.className = "ar-fallback";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ar-launch-button";
        btn.innerHTML = `<span class="ar-launch-button__icon" aria-hidden="true">⛶</span><span>${label}</span>`;
        btn.addEventListener("click", () => {
            if (!document.fullscreenElement) {
                (container.requestFullscreen || container.webkitRequestFullscreen)?.call(container);
            } else {
                (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
            }
        });
        wrap.appendChild(btn);

        if (hint) {
            const note = document.createElement("p");
            note.className = "ar-hint";
            note.textContent = hint;
            wrap.appendChild(note);
        }
        return wrap;
    }

    function makeArJsButton() {
        const wrap = document.createElement("div");
        wrap.className = "ar-fallback ar-fallback--arjs";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ar-launch-button arjs-launch-button";
        btn.innerHTML = `<span class="ar-launch-button__icon" aria-hidden="true">🛸</span><span class="ar-launch-button__label">AR.js Marker</span>`;
        const labelSpan = btn.querySelector(".ar-launch-button__label");

        btn.addEventListener("click", async () => {
            // Falls Webcam-AR aktiv ist, vorher sauber beenden – sonst fightet der
            // Stream mit dem AR.js-Webcam-Zugriff.
            if (webcamActive) stopWebcamAR();

            try {
                btn.disabled = true;
                labelSpan.textContent = "Lade…";
                await openArJsOverlay({
                    onClose: () => {
                        btn.classList.remove("is-active");
                        labelSpan.textContent = "AR.js Marker";
                    },
                });
                btn.classList.add("is-active");
                labelSpan.textContent = "AR.js läuft";
            } catch (err) {
                console.error("AR.js fehlgeschlagen:", err);
                labelSpan.textContent = "Nicht verfügbar";
                setTimeout(() => labelSpan.textContent = "AR.js Marker", 2500);
            } finally {
                btn.disabled = false;
            }
        });
        wrap.appendChild(btn);

        const note = document.createElement("p");
        note.className = "ar-hint";
        note.innerHTML = `Hiro-Marker scannen — UFO erscheint darauf · <a href="${HIRO_MARKER_URL}" target="_blank" rel="noopener">Marker öffnen</a>`;
        wrap.appendChild(note);

        return wrap;
    }

    async function setupAR() {
        if (!arHost) return;
        let arSupported = false;
        if (navigator.xr && typeof navigator.xr.isSessionSupported === "function") {
            try {
                arSupported = await navigator.xr.isSessionSupported("immersive-ar");
            } catch { arSupported = false; }
        }

        const cameraAvailable = !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;

        if (arSupported) {
            // Echtes WebXR-AR (Android-Chrome, Meta Quest)
            const arBtn = ARButton.createButton(renderer, {
                requiredFeatures: [],
                optionalFeatures: ["dom-overlay", "local-floor"],
                domOverlay: { root: container },
            });
            arBtn.classList.add("ar-launch-button");
            arBtn.textContent = "AR starten";
            arHost.appendChild(arBtn);
        } else if (cameraAvailable) {
            // Kein WebXR-AR: Webcam-AR als Pseudo-AR-Fallback (Mac/Windows/iOS)
            arHost.appendChild(makeWebcamARButton());
        } else {
            // Letzter Fallback: Vollbild
            arHost.appendChild(makeFullscreenButton(
                "Vollbild-Modus",
                "Kein AR und keine Kamera verfügbar – startet Cinematic-Vollbild",
            ));
        }

        // AR.js Marker: zusätzlicher Pfad — funktioniert überall, wo Kamera verfügbar
        // (auch iOS Safari, wo WebXR nicht geht). Wird nur gezeigt, wenn Kamera nutzbar.
        if (cameraAvailable) {
            arHost.appendChild(makeArJsButton());
        }
    }
    setupAR();

    // Fullscreen → Canvas neu dimensionieren
    document.addEventListener("fullscreenchange", () => {
        // Nach dem Wechsel ist clientWidth/Height aktualisiert
        requestAnimationFrame(onResize);
    });

    // In AR: Globus verkleinern und vor User platzieren
    renderer.xr.addEventListener("sessionstart", () => {
        globeGroup.scale.setScalar(0.25);
        globeGroup.position.set(0, 0, -0.6);
        for (const a of aliens) a.mesh.scale.setScalar(0.25);
        controls.enabled = false;
    });
    renderer.xr.addEventListener("sessionend", () => {
        globeGroup.scale.setScalar(1);
        globeGroup.position.set(0, 0, 0);
        for (const a of aliens) a.mesh.scale.setScalar(1);
        controls.enabled = true;
    });

    // Resize
    function onResize() {
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }
    window.addEventListener("resize", onResize);

    // Animation
    const clock = new THREE.Clock();
    const tmpAxis = new THREE.Vector3();
    const tmpPos = new THREE.Vector3();
    const outward = new THREE.Vector3();
    const localUp = new THREE.Vector3(0, 1, 0);
    const orientQ = new THREE.Quaternion();

    const animate = () => {
        const t = clock.getElapsedTime();
        controls.update();

        // Aliens auf geneigten Bahnen
        for (const a of aliens) {
            const ang = t * a.speed + a.phase;
            // Bahnpunkt auf Standard-XZ-Kreis, dann um tiltAxis rotieren
            tmpPos.set(
                Math.cos(ang) * a.radius,
                Math.sin(ang * 0.6) * a.wobble,
                Math.sin(ang) * a.radius,
            );
            tmpAxis.copy(a.tiltAxis);
            tmpPos.applyAxisAngle(tmpAxis, t * 0.05);

            a.mesh.position.copy(tmpPos);

            // Lokale +Y-Achse (Kuppel) zeigt immer radial nach außen,
            // egal wie die Bahn geneigt ist – damit nie kopfüber.
            outward.copy(tmpPos).normalize();
            orientQ.setFromUnitVectors(localUp, outward);
            a.mesh.quaternion.copy(orientQ);

            // Eigenrotation der Untertasse + leichtes Banking
            a.mesh.rotateY(t * 0.6 + a.phase);
            a.mesh.rotateZ(Math.sin(t * a.speed * 2 + a.phase) * 0.12);

            // Blink-Lichter
            for (let i = 0; i < a.mesh.userData.lights.length; i++) {
                const lm = a.mesh.userData.lights[i];
                const phase = t * 4 + i;
                lm.material.opacity = 0.5 + 0.5 * Math.sin(phase);
                lm.material.transparent = true;
            }
        }

        renderer.render(scene, camera);
    };

    renderer.setAnimationLoop(animate);

    // Sichtbarkeits-Optimierung: nur rendern, wenn im Viewport oder in AR-Session
    const io = new IntersectionObserver(entries => {
        const visible = entries[0].isIntersecting;
        if (renderer.xr.isPresenting) return; // in AR immer rendern
        renderer.setAnimationLoop(visible ? animate : null);
    }, { threshold: 0.05 });
    io.observe(container);
}

init().catch(err => {
    console.error("Globe init failed:", err);
    const host = document.getElementById("globe-container");
    if (host) {
        host.innerHTML =
            `<p style="color:var(--text-muted);padding:2rem;text-align:center;">
                Globus konnte nicht geladen werden: ${err.message}
             </p>`;
    }
});
