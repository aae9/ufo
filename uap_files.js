// uap_files.js — Department of War / UAP Files
// Lädt das Manifest, baut Filter (Datum + Behörde) und Karten-Grid.

const AGENCY_LABELS = {
    DOW: "Department of War",
    DOS: "State Department",
    NASA: "NASA",
    FBI: "FBI",
    ARMY: "U.S. Army",
    DOD: "DOD Video",
    OTHER: "Other",
};

const AGENCY_ORDER = ["DOW", "DOS", "NASA", "FBI", "ARMY", "DOD", "OTHER"];

// ---------- State ----------
const state = {
    all: [],
    activeAgency: null,
    selected: { year: null, month: null, day: null },
};

// ---------- DOM ----------
const els = {
    releaseCount: document.getElementById("release-count"),
    yInput: document.getElementById("uap-year"),
    mInput: document.getElementById("uap-month"),
    dInput: document.getElementById("uap-day"),
    clearBtn: document.getElementById("uap-clear"),
    status: document.getElementById("uap-status"),
    agencyChips: document.getElementById("agency-chips"),
    grid: document.getElementById("case-grid"),
    empty: document.getElementById("empty-state"),
    count: document.getElementById("result-count"),
};

// ---------- Hilfen ----------
function escapeHtml(str) {
    if (str == null) return "";
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
}

function formatDate(item) {
    if (!item.year) return "ohne Datum";
    const monthNames = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
                        "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
    let s = String(item.year);
    if (item.month) {
        s = `${monthNames[item.month - 1]} ${item.year}`;
    }
    if (item.day) {
        s = `${String(item.day).padStart(2, "0")}. ${s}`;
    }
    return s;
}

function fileHref(item) {
    // Pfad zur Originaldatei (relativ zur Seite) — Sonderzeichen sauber kodieren
    return `${encodeURIComponent(item.folder)}/${encodeURIComponent(item.filename)}`;
}

function showStatus(msg, kind = "info") {
    els.status.textContent = msg || "";
    els.status.dataset.kind = kind;
}

// ---------- Filter-Logik ----------
function passesAgency(item) {
    return !state.activeAgency || item.agency === state.activeAgency;
}

function passesDate(item) {
    const { year, month, day } = state.selected;
    if (year == null && month == null && day == null) return true;
    // Wenn das Item kein Jahr hat, darf es nur passen wenn ÜBERHAUPT nichts angefragt wurde
    if (!item.year) return false;
    if (year != null && item.year !== year) return false;
    if (month != null && item.month !== month) return false;
    if (day != null && item.day !== day) return false;
    return true;
}

function applyFilters() {
    const filtered = state.all.filter(it => passesAgency(it) && passesDate(it));
    render(filtered);
}

// ---------- Rendering ----------
function render(items) {
    els.count.textContent = items.length;
    els.empty.hidden = items.length > 0;
    els.grid.innerHTML = items.map(renderCard).join("");
}

function renderCard(item) {
    const date = formatDate(item);
    const title = escapeHtml(item.title || item.filename);
    const id = item.id ? `<span class="case-card__id">${escapeHtml(item.id)}</span>` : "";
    const loc = item.location
        ? `<span class="case-card__location">${escapeHtml(item.location)}</span>`
        : "";
    const ext = (item.extension || "").toLowerCase();
    return `
        <a class="case-card" href="${escapeHtml(fileHref(item))}" target="_blank" rel="noopener" title="${escapeHtml(item.filename)}">
            <div class="case-card__row">
                <span class="case-card__agency" data-agency="${escapeHtml(item.agency)}">${escapeHtml(item.agency)}</span>
                ${id}
            </div>
            <h3 class="case-card__title">${title}</h3>
            <p class="case-card__meta">
                <span class="case-card__date">${escapeHtml(date)}</span>
                ${loc}
            </p>
            <p class="case-card__file">
                <span class="case-card__file-ext" data-ext="${escapeHtml(ext)}">${escapeHtml(ext || "?")}</span>
                <span class="case-card__open">Akte öffnen</span>
            </p>
        </a>
    `;
}

// ---------- Behörde-Chips ----------
function renderAgencyChips() {
    const counts = new Map();
    for (const item of state.all) {
        counts.set(item.agency, (counts.get(item.agency) || 0) + 1);
    }
    const chips = AGENCY_ORDER.filter(a => counts.has(a)).map(a => {
        const isActive = state.activeAgency === a;
        return `
            <button type="button"
                    class="agency-chip${isActive ? " is-active" : ""}"
                    data-agency="${escapeHtml(a)}">
                ${escapeHtml(a)} <span class="agency-chip__count">${counts.get(a)}</span>
            </button>
        `;
    });
    // "ALLE" Chip
    chips.unshift(`
        <button type="button"
                class="agency-chip${state.activeAgency === null ? " is-active" : ""}"
                data-agency="">
            ALLE <span class="agency-chip__count">${state.all.length}</span>
        </button>
    `);
    els.agencyChips.innerHTML = chips.join("");

    els.agencyChips.querySelectorAll(".agency-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            const a = chip.dataset.agency || null;
            state.activeAgency = a;
            renderAgencyChips();
            applyFilters();
        });
    });
}

// ---------- Datums-Inputs ----------
function tryDateUpdate() {
    const yStr = els.yInput.value.trim();
    const mStr = els.mInput.value.trim();
    const dStr = els.dInput.value.trim();

    const y = yStr.length === 4 ? parseInt(yStr, 10) : null;
    const m = mStr.length > 0 ? parseInt(mStr, 10) : null;
    const d = dStr.length > 0 ? parseInt(dStr, 10) : null;

    // Validierung
    if (y !== null && (!Number.isFinite(y) || y < 1900 || y > 2100)) {
        showStatus("Ungültiges Jahr", "error");
        state.selected = { year: null, month: null, day: null };
        applyFilters();
        return;
    }
    if (m !== null && (!Number.isFinite(m) || m < 1 || m > 12)) {
        showStatus("Ungültiger Monat", "error");
        state.selected = { year: null, month: null, day: null };
        applyFilters();
        return;
    }
    if (d !== null && (!Number.isFinite(d) || d < 1 || d > 31)) {
        showStatus("Ungültiger Tag", "error");
        state.selected = { year: null, month: null, day: null };
        applyFilters();
        return;
    }
    // Wenn Tag + Monat + Jahr da sind: echtes Datum prüfen
    if (y !== null && m !== null && d !== null) {
        const probe = new Date(Date.UTC(y, m - 1, d));
        if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
            showStatus(`Ungültiges Datum: ${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, "error");
            state.selected = { year: null, month: null, day: null };
            applyFilters();
            return;
        }
    }

    state.selected = { year: y, month: m, day: d };

    // Statusmeldung
    if (y === null && m === null && d === null) {
        showStatus("");
    } else {
        const parts = [];
        if (d != null) parts.push(`Tag ${d}`);
        if (m != null) parts.push(`Monat ${m}`);
        if (y != null) parts.push(`Jahr ${y}`);
        showStatus(`Filter aktiv · ${parts.join(", ")}`, "ok");
    }

    applyFilters();
}

function bindDateInput(el, maxLen, nextEl, prevEl) {
    el.addEventListener("input", () => {
        const cleaned = el.value.replace(/\D/g, "").slice(0, maxLen);
        if (cleaned !== el.value) el.value = cleaned;
        if (el.value.length >= maxLen && nextEl) nextEl.focus();
        tryDateUpdate();
    });
    el.addEventListener("keydown", e => {
        if (e.key === "Backspace" && el.value === "" && prevEl) prevEl.focus();
    });
    el.addEventListener("blur", tryDateUpdate);
}

// ---------- Init ----------
async function init() {
    try {
        const res = await fetch("uap_files_manifest.json", { cache: "no-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        state.all = await res.json();
    } catch (err) {
        console.error("Manifest konnte nicht geladen werden:", err);
        els.grid.innerHTML = `
            <p class="empty-state" style="grid-column: 1 / -1">
                Manifest konnte nicht geladen werden.<br>
                Stelle sicher, dass die Seite über einen lokalen Server läuft (z.B. python -m http.server).
            </p>
        `;
        return;
    }

    els.releaseCount.textContent = state.all.length;

    // .DS_Store rausfiltern, falls vorhanden
    state.all = state.all.filter(it => it.filename && !it.filename.startsWith("."));

    bindDateInput(els.yInput, 4, els.mInput, null);
    bindDateInput(els.mInput, 2, els.dInput, els.yInput);
    bindDateInput(els.dInput, 2, null, els.mInput);

    els.clearBtn.addEventListener("click", () => {
        els.yInput.value = "";
        els.mInput.value = "";
        els.dInput.value = "";
        state.selected = { year: null, month: null, day: null };
        showStatus("");
        applyFilters();
        els.yInput.focus();
    });

    renderAgencyChips();
    applyFilters();
}

init();
