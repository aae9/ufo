// lunar.js — Lunar Reconnaissance
// Drei Theater in einer Bühne:
//   01 Orbit         — 3D-Mond mit Apollo-Landeplätzen als Pins
//   02 Constellation — schwebende Polaroids im Raum, verbunden durch rote Linien
//   03 Surface       — erste Person auf Apollo 12, holografische Beweise um dich

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// =========================================================
// DATEN
// =========================================================
// Reale Apollo-Landekoordinaten (lat, lng in Grad)
const APOLLO_SITES = {
    11: { lat:  0.6741, lng:  23.4730, name: "Mare Tranquillitatis", year: 1969 },
    12: { lat: -3.0125, lng: -23.4216, name: "Ocean of Storms",      year: 1969 },
    14: { lat: -3.6453, lng: -17.4714, name: "Fra Mauro",            year: 1971 },
    15: { lat: 26.1322, lng:   3.6339, name: "Hadley-Apennine",      year: 1971 },
    16: { lat: -8.9913, lng:  15.5144, name: "Descartes Highlands",  year: 1972 },
    17: { lat: 20.1908, lng:  30.7717, name: "Taurus-Littrow",       year: 1972 },
};

// NASA Visual Material aus dem Release_1-Manifest
const NASA_IMAGES = [
    { file: "NASA-UAP-VM1-Apollo-12-1969.jpg", mission: 12, year: 1969, label: "VM1" },
    { file: "NASA-UAP-VM2-Apollo-12-1969.jpg", mission: 12, year: 1969, label: "VM2" },
    { file: "NASA-UAP-VM3-Apollo-12-1969.jpg", mission: 12, year: 1969, label: "VM3" },
    { file: "NASA-UAP-VM4-Apollo-12-1969.jpg", mission: 12, year: 1969, label: "VM4" },
    { file: "NASA-UAP-VM5-Apollo-12-1969.jpg", mission: 12, year: 1969, label: "VM5" },
    { file: "NASA-UAP-VM6-Apollo-17-1972.jpg", mission: 17, year: 1972, label: "VM6" },
];

// FBI A-Serie (PNGs, direkt darstellbar)
const FBI_IMAGES = Array.from({ length: 8 }, (_, i) => ({
    file: `FBI-Photo-A${i + 1}.png`,
    label: `A${i + 1}`,
    year: null,
}));

// =========================================================
// HELPERS
// =========================================================
function latLngToVec3(lat, lng, radius) {
    const phi = (90 - lat) * Math.PI / 180;
    const theta = (lng + 180) * Math.PI / 180;
    return new THREE.Vector3(
        -radius * Math.sin(phi) * Math.cos(theta),
         radius * Math.cos(phi),
         radius * Math.sin(phi) * Math.sin(theta),
    );
}

// Procedural Moon-Textur (kein externer Asset-Load nötig)
function makeMoonTexture(size = 1024) {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size / 2;
    const ctx = c.getContext("2d");

    // Basisgrau
    ctx.fillStyle = "#8c8a85";
    ctx.fillRect(0, 0, c.width, c.height);

    // Mare-Patches (dunkle Tiefebenen)
    for (let i = 0; i < 28; i++) {
        const x = Math.random() * c.width;
        const y = Math.random() * c.height;
        const r = 40 + Math.random() * 130;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, "rgba(40, 38, 42, 0.55)");
        grad.addColorStop(0.7, "rgba(60, 58, 60, 0.25)");
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, c.width, c.height);
    }

    // Krater (helle + dunkle Punkte)
    for (let i = 0; i < 480; i++) {
        const x = Math.random() * c.width;
        const y = Math.random() * c.height;
        const r = 0.8 + Math.random() * 5;
        const dark = Math.random() < 0.55;
        ctx.fillStyle = dark
            ? `rgba(40, 38, 40, ${0.25 + Math.random() * 0.45})`
            : `rgba(210, 210, 200, ${0.18 + Math.random() * 0.4})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // Großer dunkler Patch (Mare Imbrium-Anmutung) als Stilakzent
    const grad = ctx.createRadialGradient(c.width * 0.32, c.height * 0.35, 0,
                                          c.width * 0.32, c.height * 0.35, 180);
    grad.addColorStop(0, "rgba(35, 33, 38, 0.7)");
    grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, c.width, c.height);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
}

function makeStarfield(count = 1800, radius = 60) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        // gleichmäßig auf Kugel verteilt
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        const r = radius * (0.85 + Math.random() * 0.3);
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.cos(phi);
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
        // leichte Farbvariation
        const tint = 0.7 + Math.random() * 0.3;
        const warm = Math.random() < 0.15;
        colors[i * 3]     = warm ? tint : tint * 0.95;
        colors[i * 3 + 1] = tint;
        colors[i * 3 + 2] = warm ? tint * 0.78 : tint;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
        size: 0.18, sizeAttenuation: true,
        vertexColors: true, transparent: true, opacity: 0.85,
        depthWrite: false,
    });
    return new THREE.Points(geo, mat);
}

// =========================================================
// SCENE / RENDERER
// =========================================================
const container = document.getElementById("lunar-canvas");
const loaderEl = document.getElementById("lunar-loader");
const loaderDetail = document.getElementById("loader-detail");

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 1000);
camera.position.set(0, 0.4, 3.2);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const sun = new THREE.DirectionalLight(0xfff4e6, 1.4);
sun.position.set(5, 3, 4);
scene.add(sun);
const rim = new THREE.PointLight(0xc4302b, 0.6, 30);
rim.position.set(-6, 2, -5);
scene.add(rim);
const fill = new THREE.PointLight(0x6b8cff, 0.35, 25);
fill.position.set(4, -2, -3);
scene.add(fill);

scene.add(makeStarfield());

// =========================================================
// MOON
// =========================================================
const MOON_RADIUS = 1;
const moonGroup = new THREE.Group();
scene.add(moonGroup);

const moonTex = makeMoonTexture(1024);
const moonMat = new THREE.MeshStandardMaterial({
    map: moonTex,
    roughness: 0.9,
    metalness: 0.05,
    color: 0xeeeae0,
});
const moon = new THREE.Mesh(
    new THREE.SphereGeometry(MOON_RADIUS, 96, 64),
    moonMat,
);
moon.rotation.y = Math.PI;       // damit die "Vorderseite" zur Kamera zeigt
moonGroup.add(moon);

// dezenter Atmosphären-Glow
const halo = new THREE.Mesh(
    new THREE.SphereGeometry(MOON_RADIUS * 1.06, 48, 32),
    new THREE.ShaderMaterial({
        transparent: true, side: THREE.BackSide, depthWrite: false,
        uniforms: { glowColor: { value: new THREE.Color(0xc4302b) } },
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
                float i = pow(0.75 - dot(vNormal, vec3(0, 0, 1.0)), 2.0);
                gl_FragColor = vec4(glowColor, i * 0.45);
            }`,
    }),
);
moonGroup.add(halo);

// =========================================================
// PINS
// =========================================================
const pinGroup = new THREE.Group();
moonGroup.add(pinGroup);
const pinMeshes = []; // klickbare Pins

function makePin(mission, hasImages) {
    const site = APOLLO_SITES[mission];
    if (!site) return null;
    const pos = latLngToVec3(site.lat, site.lng, MOON_RADIUS * 1.005);
    const outwards = pos.clone().normalize();

    const g = new THREE.Group();
    g.position.copy(pos);
    // Pin so ausrichten, dass +Y nach außen zeigt
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(up, outwards);
    g.quaternion.copy(q);

    // Pin selbst (Kegel)
    const color = hasImages ? 0xc4302b : 0x5a5a55;
    const pin = new THREE.Mesh(
        new THREE.ConeGeometry(0.022, 0.08, 16),
        new THREE.MeshStandardMaterial({
            color, emissive: color,
            emissiveIntensity: hasImages ? 0.9 : 0.2,
            metalness: 0.3, roughness: 0.4,
        }),
    );
    pin.position.y = 0.04;
    g.add(pin);

    // Glow-Ring auf der Oberfläche
    if (hasImages) {
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.025, 0.05, 32),
            new THREE.MeshBasicMaterial({
                color: 0xc4302b, transparent: true, opacity: 0.6,
                side: THREE.DoubleSide, depthWrite: false,
            }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.002;
        g.add(ring);
        g.userData.glowRing = ring;
    }

    g.userData = { ...g.userData, mission, hasImages };
    pinGroup.add(g);
    if (hasImages) pinMeshes.push(pin); // klickbar nur das Kegel-Mesh
    pin.userData.mission = mission;
    return g;
}

// alle 6 Sites anzeigen — aktive (mit Bildern) leuchten rot, andere dezent
const missionsWithImages = new Set(NASA_IMAGES.map(i => i.mission));
for (const missionKey of Object.keys(APOLLO_SITES)) {
    const m = parseInt(missionKey, 10);
    makePin(m, missionsWithImages.has(m));
}

// =========================================================
// IMAGE TEXTURE LOADING (preload)
// =========================================================
const texLoader = new THREE.TextureLoader();
const imageTextures = new Map(); // file -> THREE.Texture

function loadImageTexture(folder, file) {
    return new Promise((resolve) => {
        const url = `${encodeURIComponent(folder)}/${encodeURIComponent(file)}`;
        texLoader.load(
            url,
            (tex) => {
                tex.colorSpace = THREE.SRGBColorSpace;
                imageTextures.set(file, tex);
                resolve(tex);
            },
            undefined,
            (err) => {
                console.warn(`Bild fehlgeschlagen: ${file}`, err);
                resolve(null);
            },
        );
    });
}

async function preloadAllImages() {
    const tasks = [
        ...NASA_IMAGES.map(i => loadImageTexture("Release_1", i.file)),
        ...FBI_IMAGES.map(i => loadImageTexture("Release_1", i.file)),
    ];
    let done = 0;
    const total = tasks.length;
    for (const p of tasks) {
        p.then(() => {
            done++;
            loaderDetail.textContent = `Lade Beweismaterial · ${done}/${total}`;
        });
    }
    await Promise.all(tasks);
}

// Polaroid-Plane mit Bildtextur (für Constellation + Surface)
function makePolaroid(tex, width = 0.55) {
    const aspect = (tex.image?.width || 4) / (tex.image?.height || 3);
    const height = width / aspect;
    const frame = new THREE.Group();
    // Papierrand
    const paper = new THREE.Mesh(
        new THREE.PlaneGeometry(width + 0.06, height + 0.12),
        new THREE.MeshBasicMaterial({ color: 0xf1ebde, side: THREE.DoubleSide }),
    );
    frame.add(paper);
    // Bildfläche
    const img = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }),
    );
    img.position.set(0, 0.02, 0.001);
    frame.add(img);
    // Roter Akzentstreifen unten
    const tape = new THREE.Mesh(
        new THREE.PlaneGeometry(width * 0.4, 0.018),
        new THREE.MeshBasicMaterial({ color: 0xc4302b, transparent: true, opacity: 0.85 }),
    );
    tape.position.set(0, -height / 2 - 0.025, 0.002);
    frame.add(tape);
    return frame;
}

// =========================================================
// THEATER 01 · ORBIT
// =========================================================
const orbitState = {
    autoRotate: true,
};

// =========================================================
// THEATER 02 · CONSTELLATION
// =========================================================
const constellationGroup = new THREE.Group();
constellationGroup.visible = false;
scene.add(constellationGroup);
const constellationItems = []; // {polaroid, info}
let constellationLines = null;

function buildConstellation() {
    if (constellationGroup.children.length > 0) return;

    const items = [
        ...NASA_IMAGES.map(i => ({ ...i, agency: "NASA" })),
        ...FBI_IMAGES.map(i => ({ ...i, agency: "FBI" })),
    ];

    // Fibonacci-Sphere-Verteilung auf radius 3.4
    const N = items.length;
    const RADIUS = 3.4;
    const positions = [];
    for (let i = 0; i < N; i++) {
        const phi = Math.acos(1 - 2 * (i + 0.5) / N);
        const theta = Math.PI * (1 + Math.sqrt(5)) * i;
        const x = RADIUS * Math.sin(phi) * Math.cos(theta);
        const y = RADIUS * Math.cos(phi);
        const z = RADIUS * Math.sin(phi) * Math.sin(theta);
        positions.push(new THREE.Vector3(x, y, z));
    }

    items.forEach((info, idx) => {
        const tex = imageTextures.get(info.file);
        if (!tex) return;
        const pol = makePolaroid(tex, 0.55);
        pol.position.copy(positions[idx]);
        // Polaroid soll zum Mond schauen
        pol.lookAt(0, 0, 0);
        // Sanfte Eigenrotation um Mittelachse für Lebendigkeit
        pol.userData = { info, phase: Math.random() * Math.PI * 2, basePos: positions[idx].clone() };
        constellationGroup.add(pol);
        constellationItems.push({ polaroid: pol, info });
    });

    // Rote Linien zwischen Bildern derselben Behörde (oder Mission bei NASA)
    const linePositions = [];
    for (let i = 0; i < constellationItems.length; i++) {
        for (let j = i + 1; j < constellationItems.length; j++) {
            const a = constellationItems[i].info;
            const b = constellationItems[j].info;
            const sameMission = a.agency === "NASA" && b.agency === "NASA" && a.mission === b.mission;
            const sameAgency = a.agency === b.agency && a.agency === "FBI";
            // FBI: nur Nachbarn verbinden, nicht alle Paare
            const fbiAdjacent = sameAgency
                && Math.abs(parseInt(a.label.slice(1), 10) - parseInt(b.label.slice(1), 10)) === 1;
            if (sameMission || fbiAdjacent) {
                const pa = constellationItems[i].polaroid.position;
                const pb = constellationItems[j].polaroid.position;
                linePositions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
            }
        }
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    constellationLines = new THREE.LineSegments(
        lineGeo,
        new THREE.LineBasicMaterial({
            color: 0xc4302b, transparent: true, opacity: 0.55, depthWrite: false,
        }),
    );
    constellationGroup.add(constellationLines);
}

// =========================================================
// THEATER 03 · SURFACE
// =========================================================
const surfaceGroup = new THREE.Group();
surfaceGroup.visible = false;
scene.add(surfaceGroup);

let surfaceCamPos = null;
let surfaceCamUp = null;
let surfaceYaw = 0;
let surfacePitch = 0;
const surfaceHolograms = [];

function buildSurface() {
    if (surfaceGroup.children.length > 0) return;

    const site = APOLLO_SITES[12]; // Ocean of Storms
    surfaceCamPos = latLngToVec3(site.lat, site.lng, MOON_RADIUS * 1.008);
    surfaceCamUp = surfaceCamPos.clone().normalize();

    // Tangential-Basis am Standort (für Hologramm-Platzierung um die Kamera)
    const up = surfaceCamUp;
    // Welt-Norden als Hilfsreferenz; falls parallel, alternativ
    const ref = Math.abs(up.dot(new THREE.Vector3(0, 1, 0))) > 0.99
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 1, 0);
    const east = new THREE.Vector3().crossVectors(ref, up).normalize();
    const north = new THREE.Vector3().crossVectors(up, east).normalize();

    // Apollo 12 + Apollo 17 + FBI-A1..A4 als Hologramme im Halbkreis vor der Kamera
    const items = [
        ...NASA_IMAGES,
        ...FBI_IMAGES.slice(0, 4),
    ];

    items.forEach((info, idx) => {
        const tex = imageTextures.get(info.file);
        if (!tex) return;
        const pol = makePolaroid(tex, 0.34);

        // Hemi-Halbkreis um die Kamera in Tangentialebene + leichte Höhe
        const angle = (idx / items.length) * Math.PI * 1.6 - Math.PI * 0.8;
        const dist = 1.6 + (idx % 2) * 0.3;       // unterschiedliche Tiefen
        const height = 0.25 + ((idx * 0.37) % 1) * 0.3; // vertikaler Jitter
        const dir = east.clone().multiplyScalar(Math.sin(angle))
                       .add(north.clone().multiplyScalar(-Math.cos(angle)));
        const pos = surfaceCamPos.clone()
            .addScaledVector(dir, dist)
            .addScaledVector(up, height);
        pol.position.copy(pos);

        // zur Kamera ausrichten
        pol.lookAt(surfaceCamPos);

        // leichter Glow-Halo dahinter
        const glow = new THREE.Mesh(
            new THREE.PlaneGeometry(0.55, 0.45),
            new THREE.MeshBasicMaterial({
                color: 0xc4302b, transparent: true, opacity: 0.18, depthWrite: false,
            }),
        );
        glow.position.copy(pos);
        glow.lookAt(surfaceCamPos);
        glow.translateZ(-0.01);
        surfaceGroup.add(glow);

        pol.userData = { info, basePos: pos.clone(), phase: Math.random() * Math.PI * 2 };
        surfaceGroup.add(pol);
        surfaceHolograms.push(pol);
    });
}

// =========================================================
// CONTROLS
// =========================================================
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.4;
controls.maxDistance = 12;
controls.enablePan = false;
controls.target.set(0, 0, 0);

// Surface-Mode: eigener Look-Around-Mechanismus
let surfaceDrag = false;
let surfaceLastX = 0;
let surfaceLastY = 0;

renderer.domElement.addEventListener("pointerdown", (e) => {
    if (currentMode !== "surface") return;
    surfaceDrag = true;
    surfaceLastX = e.clientX;
    surfaceLastY = e.clientY;
});
renderer.domElement.addEventListener("pointerup", () => surfaceDrag = false);
renderer.domElement.addEventListener("pointerleave", () => surfaceDrag = false);
renderer.domElement.addEventListener("pointermove", (e) => {
    if (currentMode !== "surface" || !surfaceDrag) return;
    const dx = e.clientX - surfaceLastX;
    const dy = e.clientY - surfaceLastY;
    surfaceLastX = e.clientX;
    surfaceLastY = e.clientY;
    surfaceYaw -= dx * 0.0035;
    surfacePitch -= dy * 0.0035;
    surfacePitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, surfacePitch));
    updateSurfaceCamera();
});

function updateSurfaceCamera() {
    if (!surfaceCamPos) return;
    camera.position.copy(surfaceCamPos);
    camera.up.copy(surfaceCamUp);

    // Basis-Vektoren wie bei buildSurface
    const up = surfaceCamUp;
    const ref = Math.abs(up.dot(new THREE.Vector3(0, 1, 0))) > 0.99
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 1, 0);
    const east = new THREE.Vector3().crossVectors(ref, up).normalize();
    const north = new THREE.Vector3().crossVectors(up, east).normalize();

    // Blickrichtung aus yaw/pitch
    const forward = east.clone().multiplyScalar(Math.sin(surfaceYaw))
        .add(north.clone().multiplyScalar(-Math.cos(surfaceYaw)));
    const tilted = forward.clone().multiplyScalar(Math.cos(surfacePitch))
        .add(up.clone().multiplyScalar(Math.sin(surfacePitch)));

    const target = surfaceCamPos.clone().add(tilted);
    camera.lookAt(target);
}

// =========================================================
// PICKING (Klick auf Pin oder Polaroid)
// =========================================================
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerDownPos = null;

renderer.domElement.addEventListener("pointerdown", (e) => {
    pointerDownPos = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener("pointerup", (e) => {
    if (!pointerDownPos) return;
    const dx = e.clientX - pointerDownPos.x;
    const dy = e.clientY - pointerDownPos.y;
    pointerDownPos = null;
    if (Math.hypot(dx, dy) > 5) return; // war ein Drag

    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    if (currentMode === "orbit") {
        const hits = raycaster.intersectObjects(pinMeshes, false);
        if (hits.length > 0) {
            const mission = hits[0].object.userData.mission;
            showMissionPopup(mission);
        }
    } else if (currentMode === "constellation") {
        const meshes = constellationItems.map(c => c.polaroid).flatMap(p => p.children);
        const hits = raycaster.intersectObjects(meshes, false);
        if (hits.length > 0) {
            // Wandere zum übergeordneten Polaroid (Group)
            let obj = hits[0].object;
            while (obj.parent && !obj.userData.info) obj = obj.parent;
            if (obj.userData.info) showImagePopup(obj.userData.info, obj.userData.info.agency);
        }
    } else if (currentMode === "surface") {
        const meshes = surfaceHolograms.flatMap(p => p.children);
        const hits = raycaster.intersectObjects(meshes, false);
        if (hits.length > 0) {
            let obj = hits[0].object;
            while (obj.parent && !obj.userData.info) obj = obj.parent;
            if (obj.userData.info) {
                const info = obj.userData.info;
                const agency = NASA_IMAGES.some(n => n.file === info.file) ? "NASA" : "FBI";
                showImagePopup(info, agency);
            }
        }
    }
});

// =========================================================
// POPUP
// =========================================================
const popup = document.getElementById("image-popup");
const popupImg = document.getElementById("popup-image");
const popupAgency = document.getElementById("popup-agency");
const popupTitle = document.getElementById("popup-title");
const popupDate = document.getElementById("popup-date");
const popupOpen = document.getElementById("popup-open");
document.getElementById("popup-close").addEventListener("click", () => popup.hidden = true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") popup.hidden = true; });

function showImagePopup(info, agency) {
    const url = `Release_1/${encodeURIComponent(info.file)}`;
    popupImg.src = url;
    popupAgency.textContent = agency || "—";
    const dateStr = info.year ? String(info.year) : "Ohne Datum";
    popupDate.textContent = dateStr;
    if (agency === "NASA" && info.mission) {
        popupTitle.textContent = `Apollo ${info.mission} · ${info.label}`;
    } else {
        popupTitle.textContent = `${agency} ${info.label}`;
    }
    popupOpen.href = url;
    popup.hidden = false;
}

function showMissionPopup(mission) {
    const photos = NASA_IMAGES.filter(i => i.mission === mission);
    if (photos.length === 0) return;
    // Erstes Bild der Mission anzeigen, mit kleinem Cycler unten? Halten wir einfach.
    showImagePopup(photos[0], "NASA");
}

// =========================================================
// MODE SWITCHER
// =========================================================
let currentMode = "orbit";

function setMode(mode) {
    if (currentMode === mode) return;
    currentMode = mode;
    document.querySelectorAll(".mode-button").forEach(b => {
        b.classList.toggle("is-active", b.dataset.mode === mode);
    });
    document.querySelectorAll(".mode-caption").forEach(c => {
        c.hidden = c.dataset.mode !== mode;
    });
    popup.hidden = true;

    if (mode === "orbit") {
        moonGroup.scale.setScalar(1);
        moonGroup.position.set(0, 0, 0);
        moonGroup.visible = true;
        constellationGroup.visible = false;
        surfaceGroup.visible = false;
        controls.enabled = true;
        controls.minDistance = 1.4;
        controls.maxDistance = 12;
        camera.position.set(0, 0.4, 3.2);
        controls.target.set(0, 0, 0);
        orbitState.autoRotate = true;
    } else if (mode === "constellation") {
        buildConstellation();
        moonGroup.scale.setScalar(0.55);
        moonGroup.position.set(0, 0, 0);
        moonGroup.visible = true;
        constellationGroup.visible = true;
        surfaceGroup.visible = false;
        controls.enabled = true;
        controls.minDistance = 2;
        controls.maxDistance = 18;
        camera.position.set(0, 1, 6);
        controls.target.set(0, 0, 0);
        orbitState.autoRotate = false;
    } else if (mode === "surface") {
        buildSurface();
        moonGroup.scale.setScalar(1);
        constellationGroup.visible = false;
        surfaceGroup.visible = true;
        moonGroup.visible = true;
        controls.enabled = false;
        // Initial: leicht nach unten geneigt, geradeaus
        surfaceYaw = 0;
        surfacePitch = -0.12;
        updateSurfaceCamera();
    }
}

document.querySelectorAll(".mode-button").forEach(btn => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

// =========================================================
// RESIZE
// =========================================================
window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// =========================================================
// ANIMATION
// =========================================================
const clock = new THREE.Clock();

function animate() {
    const t = clock.getElapsedTime();

    // Auto-Rotation im Orbit-Modus
    if (currentMode === "orbit" && orbitState.autoRotate) {
        moonGroup.rotation.y += 0.0015;
    }

    // Pins: aktive Glow-Ringe pulsieren
    for (const pin of pinGroup.children) {
        if (pin.userData.glowRing) {
            const s = 1 + 0.18 * Math.sin(t * 2.2 + pin.userData.mission);
            pin.userData.glowRing.scale.set(s, s, s);
            pin.userData.glowRing.material.opacity = 0.4 + 0.2 * Math.sin(t * 2.2 + pin.userData.mission);
        }
    }

    // Constellation: leichte Bewegung + zur Kamera halten
    if (currentMode === "constellation") {
        for (const item of constellationItems) {
            const pol = item.polaroid;
            const off = Math.sin(t * 0.6 + pol.userData.phase) * 0.04;
            const dir = pol.userData.basePos.clone().normalize();
            pol.position.copy(pol.userData.basePos).addScaledVector(dir, off);
            pol.lookAt(camera.position);
        }
    }

    // Surface: Hologramme schweben leicht und schauen zur Kamera
    if (currentMode === "surface") {
        for (const pol of surfaceHolograms) {
            const off = Math.sin(t * 0.9 + pol.userData.phase) * 0.015;
            pol.position.copy(pol.userData.basePos).addScaledVector(surfaceCamUp, off);
            pol.lookAt(camera.position);
        }
    }

    if (controls.enabled) controls.update();
    renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

// =========================================================
// INIT
// =========================================================
(async () => {
    loaderDetail.textContent = "Lade Beweismaterial …";
    await preloadAllImages();
    loaderDetail.textContent = "Stelle Szene zusammen …";
    // Kurze Pause, damit der Loader-Text gelesen werden kann
    await new Promise(r => setTimeout(r, 250));
    loaderEl.classList.add("is-hidden");
})();
