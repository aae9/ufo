// globe.js — 3D-Globus mit UFO-Sichtungs-Heatmap und umkreisenden Aliens.
// Three.js + WebXR (ARButton) für AR auf unterstützten Geräten,
// Webcam-AR als Pseudo-AR-Fallback für Geräte ohne WebXR.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ARButton } from "three/addons/webxr/ARButton.js";
import * as d3 from "https://esm.sh/d3@7";
import * as topojson from "https://esm.sh/topojson-client@3";

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

    const bucket = new Map();      // key -> location-Object
    const dayLocs = new Map();     // YYYY-MM-DD -> Set<locKey>
    let yearMin = Infinity, yearMax = -Infinity;

    for (const r of raw) {
        const s = parseLocation(r.Location);
        if (!s) continue;

        let key, lat, lng, label, country;
        if ((s.country === "USA" || s.country === "United States") && s.state && US_STATES[s.state]) {
            key = `US:${s.state}`;
            [lat, lng] = US_STATES[s.state];
            label = `${s.state}, USA`;
            country = s.country;
        } else if (COUNTRIES[s.country]) {
            key = `C:${s.country}`;
            [lat, lng] = COUNTRIES[s.country];
            label = s.country;
            country = s.country;
        } else continue;

        // Datum + Shape extrahieren (für Filter & Flugbahnen)
        const dm = r.Occurred?.match(/^(\d{4})-(\d{2})-(\d{2})/);
        const year = dm ? parseInt(dm[1], 10) : null;
        const dayKey = dm ? `${dm[1]}-${dm[2]}-${dm[3]}` : null;
        if (year) {
            if (year < yearMin) yearMin = year;
            if (year > yearMax) yearMax = year;
        }
        const shape = (r.Shape || "").trim().toLowerCase() || null;

        if (!bucket.has(key)) {
            bucket.set(key, {
                key, lat, lng, label, country,
                count: 0,
                byYear: new Map(),         // year → count
                byShape: new Map(),        // shape → count
                byYearShape: new Map(),    // year → Map<shape, count>
            });
        }
        const b = bucket.get(key);
        b.count++;
        if (year) b.byYear.set(year, (b.byYear.get(year) || 0) + 1);
        if (shape) b.byShape.set(shape, (b.byShape.get(shape) || 0) + 1);
        if (year && shape) {
            if (!b.byYearShape.has(year)) b.byYearShape.set(year, new Map());
            const ys = b.byYearShape.get(year);
            ys.set(shape, (ys.get(shape) || 0) + 1);
        }

        if (dayKey) {
            if (!dayLocs.has(dayKey)) dayLocs.set(dayKey, new Set());
            dayLocs.get(dayKey).add(key);
        }
    }

    const locations = Array.from(bucket.values());
    const locByKey = new Map(locations.map(l => [l.key, l]));

    // Top-Tage mit den meisten unterschiedlichen Sichtungs-Orten → Flugbahn-Paare
    const topDays = [...dayLocs.entries()]
        .filter(([, s]) => s.size >= 2)
        .sort((a, b) => b[1].size - a[1].size)
        .slice(0, 40);

    const flightPairs = [];
    for (const [dayKey, keySet] of topDays) {
        const keys = [...keySet];
        const maxPairs = Math.min(6, keys.length);
        const used = new Set();
        for (let i = 0; i < maxPairs; i++) {
            const a = keys[Math.floor(Math.random() * keys.length)];
            let b = keys[Math.floor(Math.random() * keys.length)];
            let tries = 0;
            while ((b === a || used.has(`${a}|${b}`) || used.has(`${b}|${a}`)) && tries++ < 8) {
                b = keys[Math.floor(Math.random() * keys.length)];
            }
            if (a !== b && !used.has(`${a}|${b}`)) {
                used.add(`${a}|${b}`);
                const A = locByKey.get(a), B = locByKey.get(b);
                if (A && B) flightPairs.push({ dayKey, A, B });
            }
        }
    }

    if (!Number.isFinite(yearMin)) yearMin = 1947;
    if (!Number.isFinite(yearMax)) yearMax = 2024;

    return { locations, yearMin, yearMax, flightPairs };
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

    const [aggregated, countries] = await Promise.all([
        loadAggregated(),
        loadCountries().catch(err => {
            console.warn("Countries TopoJSON konnte nicht geladen werden:", err);
            return null;
        }),
    ]);
    const { locations: data, yearMin: dataYearMin, yearMax: dataYearMax, flightPairs } = aggregated;

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

    // ---------- Heatmap-Dots mit Update-Hooks ----------
    // Geteilte Geometrien für Performance — Dots werden über scale + color animiert.
    const sharedDotGeo = new THREE.SphereGeometry(1, 14, 12);
    const sharedGlowGeo = new THREE.SphereGeometry(1, 14, 12);

    const colorScaleFull = d3.scaleSequential().interpolator(d3.interpolateInferno);
    const clickableDots = [];   // alle dot/glow-Meshes für Raycasting
    const dotEntries = [];      // {loc, dot, glow, spike, baseRadius (visuell)}

    for (const p of data) {
        const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const dot = new THREE.Mesh(sharedDotGeo, dotMat);
        const pos = latLngToVec3(p.lat, p.lng, 1.0);
        dot.position.copy(pos);
        dot.userData = { locKey: p.key, country: p.country, label: p.label };
        globeGroup.add(dot);
        clickableDots.push(dot);

        const glowMat = new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false,
        });
        const glow = new THREE.Mesh(sharedGlowGeo, glowMat);
        glow.position.copy(pos);
        glow.userData = { locKey: p.key, country: p.country, label: p.label };
        globeGroup.add(glow);
        clickableDots.push(glow);

        // Spike: nur als Linie auf radial outward — wird per scale.y verändert
        const spikeMat = new THREE.LineBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0.7,
        });
        const spikeGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            pos.clone().multiplyScalar(0.4),  // 0.4-Einheiten outward in lokalem Frame, später skaliert
        ]);
        // Wir verschieben die Spike-Linie ins globeGroup und nutzen position+lookAt
        const spike = new THREE.Line(spikeGeo, spikeMat);
        spike.position.copy(pos);
        // Lokale Y-Achse zeigt radial nach außen → lookAt(2*pos) tut's:
        const upward = pos.clone().multiplyScalar(2);
        spike.lookAt(upward);
        globeGroup.add(spike);

        dotEntries.push({ loc: p, dot, glow, spike, dotMat, glowMat, spikeMat, pos });
    }

    // ---------- Filter + Update-Logik ----------
    // currentFilter: yearMin/yearMax (inkl.), shape (lowercase) oder null
    let currentFilter = { yearMin: dataYearMin, yearMax: dataYearMax, shape: null };

    function getFilteredCount(loc, filter) {
        const { yearMin, yearMax, shape } = filter;
        // Schnellpfad: keine Filter → totalCount
        if (yearMin === dataYearMin && yearMax === dataYearMax && !shape) {
            return loc.count;
        }
        let sum = 0;
        if (shape) {
            const sLower = shape.toLowerCase();
            // Iteriere Jahre im Range
            for (let y = yearMin; y <= yearMax; y++) {
                const ys = loc.byYearShape.get(y);
                if (!ys) continue;
                sum += ys.get(sLower) || 0;
            }
        } else {
            for (let y = yearMin; y <= yearMax; y++) {
                sum += loc.byYear.get(y) || 0;
            }
        }
        return sum;
    }

    function updateGlobeView(filterUpdate = {}) {
        currentFilter = { ...currentFilter, ...filterUpdate };
        // Erst max für aktuelle Filterung ermitteln, damit die Farb-/Größen-Skalen
        // sich an die sichtbare Verteilung anpassen.
        const visible = [];
        let maxC = 0;
        for (const e of dotEntries) {
            const c = getFilteredCount(e.loc, currentFilter);
            e.currentCount = c;
            if (c > maxC) maxC = c;
            if (c > 0) visible.push(e);
        }
        const logMax = Math.log(maxC + 1);
        colorScaleFull.domain([0, logMax || 1]);

        for (const e of dotEntries) {
            if (e.currentCount <= 0) {
                e.dot.visible = false;
                e.glow.visible = false;
                e.spike.visible = false;
                continue;
            }
            const heat = logMax > 0 ? Math.log(e.currentCount + 1) / logMax : 0;
            const r = 0.012 + heat * 0.04;
            const color = new THREE.Color(colorScaleFull(Math.log(e.currentCount + 1)));

            e.dot.visible = true;
            e.dot.scale.setScalar(r);
            e.dot.position.copy(e.pos).multiplyScalar(1.0 + r * 0.6);
            e.dotMat.color.copy(color);

            e.glow.visible = true;
            e.glow.scale.setScalar(r * 2.4);
            e.glow.position.copy(e.dot.position);
            e.glowMat.color.copy(color);

            if (heat > 0.3) {
                const len = 0.05 + heat * 0.35;
                e.spike.visible = true;
                e.spike.scale.set(1, 1, len / 0.4);
                e.spike.position.copy(e.pos);
                e.spikeMat.color.copy(color);
            } else {
                e.spike.visible = false;
            }
        }

        updateKPIs(visible, maxC);
        // Flugbahnen, falls aktiv, neu zeichnen (Filter beeinflusst sichtbare Pairs)
        if (flightPathsOn) rebuildFlightPaths();
    }

    // ---------- KPI-Banner über dem Globus ----------
    function updateKPIs(visibleEntries, maxC) {
        const totalEl = document.getElementById("globe-kpi-total");
        const countriesEl = document.getElementById("globe-kpi-countries");
        const yearsEl = document.getElementById("globe-kpi-years");
        const shapeEl = document.getElementById("globe-kpi-shape");
        if (!totalEl) return;

        const total = visibleEntries.reduce((s, e) => s + e.currentCount, 0);
        const countries = new Set(visibleEntries.map(e => e.loc.country)).size;
        totalEl.textContent = total.toLocaleString("de-DE");
        countriesEl.textContent = countries.toString();
        yearsEl.textContent = `${currentFilter.yearMin}–${currentFilter.yearMax}`;
        if (shapeEl) {
            shapeEl.textContent = currentFilter.shape
                ? currentFilter.shape.charAt(0).toUpperCase() + currentFilter.shape.slice(1)
                : "Alle";
        }
    }

    // ---------- Flugbahnen (Beta) ----------
    const flightGroup = new THREE.Group();
    globeGroup.add(flightGroup);
    let flightPathsOn = false;
    const ARC_RAISE = 0.45; // wie hoch über Globusoberfläche

    function buildArcPoints(A, B, steps = 60) {
        const v1 = latLngToVec3(A.lat, A.lng, 1.01);
        const v2 = latLngToVec3(B.lat, B.lng, 1.01);
        // Mittelpunkt nach oben anheben, je nach Distanz
        const dist = v1.distanceTo(v2);
        const mid = v1.clone().add(v2).multiplyScalar(0.5).normalize().multiplyScalar(1.0 + ARC_RAISE * Math.min(1, dist * 0.7));
        const curve = new THREE.QuadraticBezierCurve3(v1, mid, v2);
        return curve.getPoints(steps);
    }

    function rebuildFlightPaths() {
        // Clear
        while (flightGroup.children.length) {
            const m = flightGroup.children.pop();
            m.geometry?.dispose?.();
            m.material?.dispose?.();
        }
        if (!flightPathsOn) return;

        for (const pair of flightPairs) {
            // Filter: beide Locations müssen aktuell sichtbar sein (count > 0)
            const aEntry = dotEntries.find(e => e.loc.key === pair.A.key);
            const bEntry = dotEntries.find(e => e.loc.key === pair.B.key);
            if (!aEntry || !bEntry) continue;
            if ((aEntry.currentCount || 0) === 0 || (bEntry.currentCount || 0) === 0) continue;

            const pts = buildArcPoints(pair.A, pair.B, 48);
            const geo = new THREE.BufferGeometry().setFromPoints(pts);
            const mat = new THREE.LineBasicMaterial({
                color: 0xfb7185, transparent: true, opacity: 0.55, depthWrite: false,
            });
            const line = new THREE.Line(geo, mat);
            line.userData = { phase: Math.random() * Math.PI * 2 };
            flightGroup.add(line);
        }
    }

    // Initial-Render mit Defaults
    updateGlobeView();

    // ---------- Globale API für Linked-Views ----------
    window.__globeFilter = (yearMin, yearMax, shape) => {
        updateGlobeView({
            yearMin: yearMin ?? currentFilter.yearMin,
            yearMax: yearMax ?? currentFilter.yearMax,
            shape: shape === undefined ? currentFilter.shape : shape,
        });
    };
    window.__globeYearRange = { min: dataYearMin, max: dataYearMax };
    window.__globeSetFlightPaths = (on) => {
        flightPathsOn = !!on;
        rebuildFlightPaths();
    };

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

    // ---------- Klick auf Land → Treemap öffnen, Doppelklick → schließen ----------
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDownPos = null;
    const DRAG_THRESHOLD_PX = 6; // bei mehr als 6px Bewegung gilt es als Drag, nicht als Klick

    function setPointerFromEvent(event) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    renderer.domElement.addEventListener("pointerdown", (e) => {
        pointerDownPos = { x: e.clientX, y: e.clientY };
    });

    renderer.domElement.addEventListener("pointerup", (e) => {
        if (!pointerDownPos) return;
        const dx = e.clientX - pointerDownPos.x;
        const dy = e.clientY - pointerDownPos.y;
        pointerDownPos = null;
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) return; // war ein Drag

        setPointerFromEvent(e);
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(clickableDots, false);
        for (const hit of hits) {
            const locKey = hit.object.userData?.locKey;
            if (!locKey) continue;
            const entry = dotEntries.find(e => e.loc.key === locKey);
            if (entry) {
                showSidePanel(entry);
                return;
            }
        }
    });

    // ---------- Hover-Tooltip ----------
    const tooltipEl = document.getElementById("globe-tooltip");
    let lastHoverKey = null;
    renderer.domElement.addEventListener("pointermove", (e) => {
        if (!tooltipEl) return;
        setPointerFromEvent(e);
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(clickableDots, false);
        if (hits.length === 0) {
            tooltipEl.classList.remove("is-visible");
            lastHoverKey = null;
            return;
        }
        const locKey = hits[0].object.userData?.locKey;
        if (!locKey) {
            tooltipEl.classList.remove("is-visible");
            return;
        }
        const entry = dotEntries.find(e => e.loc.key === locKey);
        if (!entry || entry.currentCount === 0) {
            tooltipEl.classList.remove("is-visible");
            return;
        }

        if (locKey !== lastHoverKey) {
            // Top-3 Shapes berechnen (filter-aware)
            const shapeMap = new Map();
            for (let y = currentFilter.yearMin; y <= currentFilter.yearMax; y++) {
                const ys = entry.loc.byYearShape.get(y);
                if (!ys) continue;
                for (const [sh, c] of ys) {
                    if (currentFilter.shape && sh !== currentFilter.shape) continue;
                    shapeMap.set(sh, (shapeMap.get(sh) || 0) + c);
                }
            }
            const top3 = [...shapeMap.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([sh, c]) => `<span class="globe-tooltip__chip">${sh.charAt(0).toUpperCase() + sh.slice(1)} <em>${c.toLocaleString("de-DE")}</em></span>`)
                .join(" ");
            tooltipEl.innerHTML = `
                <p class="globe-tooltip__label">${escapeHtmlSimple(entry.loc.label)}</p>
                <p class="globe-tooltip__count"><strong>${entry.currentCount.toLocaleString("de-DE")}</strong> Sichtungen</p>
                ${top3 ? `<div class="globe-tooltip__shapes">${top3}</div>` : ""}
            `;
            lastHoverKey = locKey;
        }
        // Position folgt Maus
        tooltipEl.style.left = (e.clientX + 14) + "px";
        tooltipEl.style.top = (e.clientY + 14) + "px";
        tooltipEl.classList.add("is-visible");
    });
    renderer.domElement.addEventListener("pointerleave", () => {
        tooltipEl?.classList.remove("is-visible");
        lastHoverKey = null;
    });

    function escapeHtmlSimple(s) {
        const d = document.createElement("div");
        d.textContent = s ?? "";
        return d.innerHTML;
    }

    // ---------- Side-Panel mit Detail-Stats ----------
    function showSidePanel(entry) {
        const panel = document.getElementById("globe-side-panel");
        if (!panel) return;
        const titleEl = panel.querySelector(".globe-side-panel__title");
        const subEl = panel.querySelector(".globe-side-panel__sub");
        const yearsEl = panel.querySelector(".globe-side-panel__years");
        const shapesEl = panel.querySelector(".globe-side-panel__shapes");
        const treemapBtn = panel.querySelector(".globe-side-panel__treemap-btn");

        titleEl.textContent = entry.loc.label;
        subEl.innerHTML = `<strong>${entry.currentCount.toLocaleString("de-DE")}</strong> Sichtungen ` +
            `· gesamt <strong>${entry.loc.count.toLocaleString("de-DE")}</strong>`;

        // Jahres-Sparkline (canvas)
        const yearList = [...entry.loc.byYear.entries()].sort((a, b) => a[0] - b[0]);
        if (yearList.length > 0) {
            const c = document.createElement("canvas");
            c.width = 280; c.height = 60;
            const ctx = c.getContext("2d");
            const xmin = yearList[0][0], xmax = yearList[yearList.length - 1][0];
            const ymax = Math.max(...yearList.map(([, v]) => v));
            ctx.strokeStyle = "#22d3ee";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            yearList.forEach(([y, v], i) => {
                const px = (y - xmin) / (xmax - xmin || 1) * (c.width - 4) + 2;
                const py = c.height - 4 - (v / ymax) * (c.height - 8);
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            });
            ctx.stroke();
            // Fläche darunter
            ctx.lineTo(c.width - 2, c.height - 2);
            ctx.lineTo(2, c.height - 2);
            ctx.closePath();
            ctx.fillStyle = "rgba(34, 211, 238, 0.18)";
            ctx.fill();
            yearsEl.innerHTML = "";
            yearsEl.appendChild(c);
            const label = document.createElement("p");
            label.className = "globe-side-panel__years-label";
            label.textContent = `${xmin} – ${xmax}`;
            yearsEl.appendChild(label);
        } else {
            yearsEl.innerHTML = `<p class="globe-side-panel__empty">Keine datierten Sichtungen</p>`;
        }

        // Top-Shapes
        const topShapes = [...entry.loc.byShape.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8);
        shapesEl.innerHTML = topShapes.length === 0
            ? `<p class="globe-side-panel__empty">Keine Shape-Angabe</p>`
            : topShapes.map(([sh, c]) =>
                `<div class="globe-side-panel__shape-row">
                    <span class="globe-side-panel__shape-name">${escapeHtmlSimple(sh.charAt(0).toUpperCase() + sh.slice(1))}</span>
                    <span class="globe-side-panel__shape-bar" style="width: ${Math.max(4, c / topShapes[0][1] * 100)}%"></span>
                    <span class="globe-side-panel__shape-count">${c.toLocaleString("de-DE")}</span>
                </div>`
            ).join("");

        // Treemap-Button verdrahten
        treemapBtn.onclick = () => {
            if (typeof window.__showCountryTreemap === "function") {
                window.__showCountryTreemap(entry.loc.country);
            }
        };

        panel.classList.add("is-open");
    }

    document.getElementById("globe-side-panel-close")?.addEventListener("click", () => {
        document.getElementById("globe-side-panel")?.classList.remove("is-open");
    });

    renderer.domElement.addEventListener("dblclick", (e) => {
        e.preventDefault();
        if (typeof window.__hideTreemap === "function") {
            window.__hideTreemap();
        }
    });

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

        // Flugbahnen pulsen leicht in der Opazität
        if (flightPathsOn && flightGroup.children.length) {
            for (const line of flightGroup.children) {
                const phase = (line.userData.phase || 0) + t * 1.4;
                line.material.opacity = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(phase));
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
