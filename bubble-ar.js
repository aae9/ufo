// bubble-ar.js — 3D-Physik-Welt aus dem Bubble-Chart.
// Jedes Top-Wort wird zu einem Ball mit eigener Masse (Wortfrequenz),
// gegenseitiger Gravitation und Erd-Schwerkraft. WebXR-AR auf
// kompatiblen Geräten, sonst Webcam-AR oder Vollbild als Fallback.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ARButton } from "three/addons/webxr/ARButton.js";

// ---------- Konfiguration ----------
const MAX_BALLS = 60;          // Top-N Wörter — mehr wird visuell unruhig + langsam
const PHYS = {
    gravityY: 0,               // Keine Erd-Schwerkraft (Zero-G-Drift)
    G: 0,                      // Keine gegenseitige Anziehung
    minPairDist: 0.6,          // Untergrenze für 1/r² (verhindert Explosionen)
    damping: 0.992,            // sanftes Auslaufen, damit die Bälle länger leben
    restitution: 0.7,          // mehr Bounce, weil keine Schwerkraft mehr nachschiebt
    boxX: 4.4, boxY: 3.2, boxZ: 2.6,
    maxDt: 1 / 30,
};

// ---------- State ----------
let scene = null;
let camera = null;
let renderer = null;
let controls = null;
let ballGroup = null;
let balls = [];
let overlay = null;
let arHostInsideOverlay = null;
let webcamStream = null;
let webcamVideo = null;
let xrButtonElement = null;
let animFrame = null;
let lastTime = 0;
let resizeObs = null;
let onKeyHandler = null;
let isOpen = false;

// ---------- Hilfsfunktionen ----------
// Erzeugt ein Sprite mit dem Wort, dessen Breite garantiert in den Ball-Durchmesser passt.
// Lange Wörter werden automatisch kleiner skaliert, damit nichts über den Rand ragt.
const _measureCtx = document.createElement("canvas").getContext("2d");

function makeLabelSprite(word, ballRadius) {
    const refSize = 96;            // Referenz-Schriftgröße auf dem Canvas
    const padding = 14;
    const fontDecl = `bold ${refSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;

    // 1) Echte Textbreite messen, damit der Canvas das exakte Verhältnis bekommt
    _measureCtx.font = fontDecl;
    const textWidth = _measureCtx.measureText(word).width;

    const canvasW = Math.max(64, Math.ceil(textWidth + padding * 2));
    const canvasH = refSize + padding * 2;

    const c = document.createElement("canvas");
    c.width = canvasW;
    c.height = canvasH;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.font = fontDecl;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(word, canvasW / 2, canvasH / 2);

    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;

    // 2) Sprite-Größe so wählen, dass es in den Ball passt.
    //    Ball-Durchmesser = 2*r. Wir erlauben max 90% davon als Sprite-Breite.
    //    Bei aspect = w/h skaliert die Höhe entsprechend mit.
    const aspect = canvasW / canvasH;
    const maxWidth = ballRadius * 1.8;          // 90% des Durchmessers
    const maxHeight = ballRadius * 1.4;         // 70% des Durchmessers (etwas Luft oben/unten)
    let spriteW = maxWidth;
    let spriteH = spriteW / aspect;
    if (spriteH > maxHeight) {
        spriteH = maxHeight;
        spriteW = spriteH * aspect;
    }

    const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(spriteW, spriteH, 1);
    sprite.renderOrder = 2;
    return sprite;
}

const PALETTE = [
    0x22d3ee, 0x6b8cff, 0xa78bfa, 0xfb7185,
    0xfbbf24, 0x67e8f9, 0xf472b6, 0x4ade80,
];

function getWordData() {
    const data = window.__wordData;
    if (!data || !Array.isArray(data) || data.length === 0) return null;
    return data.slice(0, MAX_BALLS);
}

// ---------- Szene + Bälle erzeugen ----------
function buildScene(words) {
    scene = new THREE.Scene();
    scene.background = null;

    camera = new THREE.PerspectiveCamera(60, 1, 0.05, 100);
    camera.position.set(0, 0.4, 6.5);

    // Lichter
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(4, 6, 4);
    scene.add(sun);
    const accent = new THREE.PointLight(0x6b8cff, 0.9, 22);
    accent.position.set(-3, -1, 2);
    scene.add(accent);
    const accent2 = new THREE.PointLight(0xa78bfa, 0.6, 18);
    accent2.position.set(3, 2, -2);
    scene.add(accent2);

    // Subtile Boden-Glow-Scheibe
    const floorMat = new THREE.MeshBasicMaterial({
        color: 0x6b8cff, transparent: true, opacity: 0.07, side: THREE.DoubleSide,
        depthWrite: false,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(3.5, 64), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -PHYS.boxY / 2 + 0.001;
    scene.add(floor);

    // Bälle
    ballGroup = new THREE.Group();
    scene.add(ballGroup);

    const maxCount = words[0].count;
    balls = words.map((w, i) => {
        const norm = Math.sqrt(w.count / maxCount);
        const r = 0.13 + norm * 0.55;
        const baseColor = new THREE.Color(PALETTE[i % PALETTE.length]);
        const hsl = {};
        baseColor.getHSL(hsl);
        baseColor.setHSL(hsl.h, 0.7, 0.45 + norm * 0.18);

        const mat = new THREE.MeshStandardMaterial({
            color: baseColor,
            metalness: 0.42,
            roughness: 0.38,
            emissive: baseColor.clone().multiplyScalar(0.32),
            emissiveIntensity: 0.55,
        });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 18), mat);
        mesh.position.set(
            (Math.random() - 0.5) * PHYS.boxX * 0.7,
            Math.random() * PHYS.boxY * 0.4 + 0.4,
            (Math.random() - 0.5) * PHYS.boxZ * 0.6,
        );
        ballGroup.add(mesh);

        // Wort-Label als Sprite — passt sich automatisch an Ball-Größe + Wortlänge an
        const label = makeLabelSprite(w.word, r);
        label.position.set(0, 0, 0);
        mesh.add(label);

        return {
            mesh,
            radius: r,
            mass: Math.max(0.06, norm * norm * 1.6 + 0.06),
            velocity: new THREE.Vector3(
                (Math.random() - 0.5) * 0.7,
                Math.random() * 0.4,
                (Math.random() - 0.5) * 0.4,
            ),
            word: w.word,
            count: w.count,
        };
    });
}

// ---------- Physik-Schritt ----------
const _diff = new THREE.Vector3();

function step(dt) {
    dt = Math.min(dt, PHYS.maxDt);
    if (dt <= 0) return;

    // 1) Kräfte: Erd-Schwerkraft + gegenseitige Anziehung (n²)
    //    Wird komplett übersprungen, wenn beide Konstanten 0 sind (Zero-G-Modus)
    if (PHYS.gravityY !== 0 || PHYS.G !== 0) {
        for (let i = 0; i < balls.length; i++) {
            const a = balls[i];
            let fx = 0;
            let fy = PHYS.gravityY * a.mass;
            let fz = 0;

            if (PHYS.G !== 0) {
                for (let j = 0; j < balls.length; j++) {
                    if (j === i) continue;
                    const b = balls[j];
                    _diff.copy(b.mesh.position).sub(a.mesh.position);
                    const r2raw = _diff.lengthSq();
                    const r2 = Math.max(r2raw, PHYS.minPairDist * PHYS.minPairDist);
                    const dist = Math.sqrt(r2);
                    if (dist < 1e-4) continue;
                    const f = (PHYS.G * a.mass * b.mass) / r2;
                    const inv = 1 / dist;
                    fx += _diff.x * inv * f;
                    fy += _diff.y * inv * f;
                    fz += _diff.z * inv * f;
                }
            }

            a.velocity.x += (fx / a.mass) * dt;
            a.velocity.y += (fy / a.mass) * dt;
            a.velocity.z += (fz / a.mass) * dt;
        }
    }

    // 2) Position aktualisieren + leichte Reibung
    for (const a of balls) {
        a.mesh.position.x += a.velocity.x * dt;
        a.mesh.position.y += a.velocity.y * dt;
        a.mesh.position.z += a.velocity.z * dt;
        a.velocity.multiplyScalar(PHYS.damping);
    }

    // 3) Pair-Kollisionen mit elastischer Antwort
    for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
            const a = balls[i];
            const b = balls[j];
            _diff.copy(b.mesh.position).sub(a.mesh.position);
            const dist = _diff.length();
            const minDist = a.radius + b.radius;
            if (dist >= minDist || dist < 1e-4) continue;

            const overlap = minDist - dist;
            _diff.multiplyScalar(1 / dist); // jetzt = Normal-Vektor a→b
            const totalMass = a.mass + b.mass;

            // Auseinanderdrücken proportional zur Gegen-Masse
            const aShare = b.mass / totalMass;
            const bShare = a.mass / totalMass;
            a.mesh.position.x -= _diff.x * overlap * aShare;
            a.mesh.position.y -= _diff.y * overlap * aShare;
            a.mesh.position.z -= _diff.z * overlap * aShare;
            b.mesh.position.x += _diff.x * overlap * bShare;
            b.mesh.position.y += _diff.y * overlap * bShare;
            b.mesh.position.z += _diff.z * overlap * bShare;

            // Normal-Geschwindigkeitskomponenten austauschen (1D-Stoß)
            const va = a.velocity.dot(_diff);
            const vb = b.velocity.dot(_diff);
            if (va - vb <= 0) continue; // bewegen sich schon weg

            const e = PHYS.restitution;
            const newVa = (a.mass * va + b.mass * vb - b.mass * (va - vb) * e) / totalMass;
            const newVb = (a.mass * va + b.mass * vb + a.mass * (va - vb) * e) / totalMass;
            a.velocity.addScaledVector(_diff, newVa - va);
            b.velocity.addScaledVector(_diff, newVb - vb);
        }
    }

    // 4) Begrenzungsbox
    const halfX = PHYS.boxX / 2;
    const halfY = PHYS.boxY / 2;
    const halfZ = PHYS.boxZ / 2;
    for (const a of balls) {
        if (a.mesh.position.y - a.radius < -halfY) {
            a.mesh.position.y = -halfY + a.radius;
            if (a.velocity.y < 0) a.velocity.y = -a.velocity.y * PHYS.restitution;
        } else if (a.mesh.position.y + a.radius > halfY) {
            a.mesh.position.y = halfY - a.radius;
            if (a.velocity.y > 0) a.velocity.y = -a.velocity.y * PHYS.restitution;
        }
        if (a.mesh.position.x - a.radius < -halfX) {
            a.mesh.position.x = -halfX + a.radius;
            a.velocity.x = Math.abs(a.velocity.x) * PHYS.restitution;
        } else if (a.mesh.position.x + a.radius > halfX) {
            a.mesh.position.x = halfX - a.radius;
            a.velocity.x = -Math.abs(a.velocity.x) * PHYS.restitution;
        }
        if (a.mesh.position.z - a.radius < -halfZ) {
            a.mesh.position.z = -halfZ + a.radius;
            a.velocity.z = Math.abs(a.velocity.z) * PHYS.restitution;
        } else if (a.mesh.position.z + a.radius > halfZ) {
            a.mesh.position.z = halfZ - a.radius;
            a.velocity.z = -Math.abs(a.velocity.z) * PHYS.restitution;
        }
    }
}

// ---------- Renderer / Animation ----------
function setupRenderer(stage) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    renderer.xr.enabled = true;
    stage.appendChild(renderer.domElement);

    // Kamera-Steuerung: Drehen + Zoomen aktiv, Schwenken aus
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 2.5;
    controls.maxDistance = 14;
    controls.enableRotate = true;
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.target.set(0, 0, 0);

    // Resize über ResizeObserver — robust auch bei Vollbild-Wechsel
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

    // In WebXR-Sessions die Bälle auf Tisch-Maßstab schrumpfen + vor User
    renderer.xr.addEventListener("sessionstart", () => {
        controls.enabled = false;
        ballGroup.scale.setScalar(0.18);
        ballGroup.position.set(0, 0, -0.6);
    });
    renderer.xr.addEventListener("sessionend", () => {
        controls.enabled = true;
        ballGroup.scale.setScalar(1);
        ballGroup.position.set(0, 0, 0);
    });

    // Animation-Loop (renderer.setAnimationLoop ist XR-kompatibel)
    renderer.setAnimationLoop((time) => {
        const t = time / 1000;
        const dt = lastTime === 0 ? 1 / 60 : Math.min(t - lastTime, PHYS.maxDt);
        lastTime = t;
        step(dt);
        controls.update();
        renderer.render(scene, camera);
    });
}

// ---------- Webcam-AR (Fallback) ----------
async function startWebcamBackground(stage) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Kein Kamerazugriff");
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } }, audio: false,
        });
    } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    webcamStream = stream;
    webcamVideo = document.createElement("video");
    webcamVideo.className = "bubble-ar-overlay__webcam";
    webcamVideo.autoplay = true;
    webcamVideo.muted = true;
    webcamVideo.playsInline = true;
    webcamVideo.srcObject = stream;
    stage.insertBefore(webcamVideo, stage.firstChild);
    await webcamVideo.play().catch(() => {});
    stage.classList.add("is-webcam-ar");
}

function stopWebcamBackground() {
    if (webcamStream) {
        for (const t of webcamStream.getTracks()) t.stop();
        webcamStream = null;
    }
    if (webcamVideo) {
        webcamVideo.srcObject = null;
        webcamVideo.remove();
        webcamVideo = null;
    }
}

// ---------- Overlay öffnen/schließen ----------
async function openOverlay() {
    if (isOpen) return;
    const words = getWordData();
    if (!words) {
        alert("Wortdaten noch nicht bereit. Versuche es in einem Moment erneut.");
        return;
    }
    isOpen = true;
    lastTime = 0;

    // Overlay-DOM
    overlay = document.createElement("div");
    overlay.className = "bubble-ar-overlay";
    overlay.innerHTML = `
        <div class="bubble-ar-overlay__stage" id="bubble-ar-stage"></div>
        <div class="bubble-ar-overlay__hud">
            <p class="bubble-ar-overlay__title">3D · Schwerkraft · ${words.length} Wörter</p>
            <p class="bubble-ar-overlay__hint">
                Ziehen zum Drehen · Scroll zum Zoom · AR-Button rechts unten · ESC schließt
            </p>
        </div>
        <button type="button" class="bubble-ar-overlay__close" aria-label="Schließen">×</button>
        <div class="bubble-ar-overlay__ar-host"></div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add("bubble-ar-active");

    const stage = overlay.querySelector(".bubble-ar-overlay__stage");
    arHostInsideOverlay = overlay.querySelector(".bubble-ar-overlay__ar-host");

    // Szene + Renderer
    if (!scene) buildScene(words);
    setupRenderer(stage);

    // AR-Pfad: WebXR vs. Webcam-Fallback
    let arSupported = false;
    if (navigator.xr?.isSessionSupported) {
        try { arSupported = await navigator.xr.isSessionSupported("immersive-ar"); }
        catch { arSupported = false; }
    }
    const cameraAvailable = !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;

    if (arSupported) {
        xrButtonElement = ARButton.createButton(renderer, {
            requiredFeatures: [],
            optionalFeatures: ["dom-overlay", "local-floor"],
            domOverlay: { root: overlay },
        });
        xrButtonElement.classList.add("bubble-ar-overlay__xr-button");
        arHostInsideOverlay.appendChild(xrButtonElement);
    } else if (cameraAvailable) {
        // Webcam-AR Knopf — startet Kamera-Hintergrund
        const wcBtn = document.createElement("button");
        wcBtn.type = "button";
        wcBtn.className = "bubble-ar-overlay__xr-button";
        wcBtn.innerHTML = `<span aria-hidden="true">📷</span> Kamera-AR starten`;
        let webcamOn = false;
        wcBtn.addEventListener("click", async () => {
            if (webcamOn) {
                stopWebcamBackground();
                wcBtn.innerHTML = `<span aria-hidden="true">📷</span> Kamera-AR starten`;
                webcamOn = false;
                return;
            }
            try {
                wcBtn.disabled = true;
                wcBtn.textContent = "Starte Kamera…";
                await startWebcamBackground(stage);
                wcBtn.innerHTML = `<span aria-hidden="true">⏹</span> Kamera-AR stoppen`;
                webcamOn = true;
            } catch (err) {
                console.error("Webcam-AR fehlgeschlagen:", err);
                wcBtn.textContent = "Kamera nicht verfügbar";
            } finally {
                wcBtn.disabled = false;
            }
        });
        arHostInsideOverlay.appendChild(wcBtn);
    } else {
        const note = document.createElement("p");
        note.className = "bubble-ar-overlay__no-ar";
        note.textContent = "Kein AR — Vollbild-3D-Modus aktiv";
        arHostInsideOverlay.appendChild(note);
    }

    // Schließ-Button + ESC
    overlay.querySelector(".bubble-ar-overlay__close").addEventListener("click", closeOverlay);
    onKeyHandler = (e) => { if (e.key === "Escape") closeOverlay(); };
    document.addEventListener("keydown", onKeyHandler);

    // Vollbild — beim Click-Trigger noch im User-Gesture-Kontext
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

    // ESC-Handler weg
    if (onKeyHandler) {
        document.removeEventListener("keydown", onKeyHandler);
        onKeyHandler = null;
    }

    // WebXR-Session beenden, falls aktiv
    if (renderer?.xr?.isPresenting) {
        try { renderer.xr.getSession()?.end(); } catch {}
    }

    // Animation stoppen
    if (renderer) {
        renderer.setAnimationLoop(null);
    }

    // Webcam beenden
    stopWebcamBackground();

    // Resize-Observer abkoppeln
    if (resizeObs) {
        resizeObs.disconnect();
        resizeObs = null;
    }

    // Renderer-Resourcen freigeben
    if (renderer) {
        renderer.dispose?.();
        renderer.domElement?.remove();
        renderer = null;
    }

    // Controls aufräumen
    if (controls) {
        controls.dispose?.();
        controls = null;
    }

    // Szene + Bälle behalten wir im Speicher (Wiederöffnen ist instant);
    // aber Position/Velocity sollen frisch starten.
    if (balls.length) {
        for (const b of balls) {
            b.mesh.position.set(
                (Math.random() - 0.5) * PHYS.boxX * 0.7,
                Math.random() * PHYS.boxY * 0.4 + 0.4,
                (Math.random() - 0.5) * PHYS.boxZ * 0.6,
            );
            b.velocity.set(
                (Math.random() - 0.5) * 0.7,
                Math.random() * 0.4,
                (Math.random() - 0.5) * 0.4,
            );
        }
    }

    // XR-Button entfernen
    if (xrButtonElement) {
        xrButtonElement.remove();
        xrButtonElement = null;
    }

    // Vollbild verlassen
    if (document.fullscreenElement || document.webkitFullscreenElement) {
        const fn = document.exitFullscreen || document.webkitExitFullscreen;
        if (fn) fn.call(document).catch(() => {});
    }

    // Overlay weg
    overlay?.remove();
    overlay = null;
    arHostInsideOverlay = null;
    document.body.classList.remove("bubble-ar-active");

    lastTime = 0;
}

// ---------- Button verdrahten ----------
function wireButton() {
    const btn = document.getElementById("bubble-ar-button");
    if (!btn) return;
    btn.addEventListener("click", async (e) => {
        // Klick auf den Button soll nicht den Collapse-Trigger des Headers auslösen
        e.stopPropagation();
        try {
            btn.disabled = true;
            await openOverlay();
        } catch (err) {
            console.error("Bubble-AR fehlgeschlagen:", err);
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
