import * as d3 from 'https://esm.sh/d3@7';

const rawData = await d3.csv("nuforc_str_cleaned.csv");

console.log(`${rawData.length} Sichtungen geladen.`);
console.log("Beispiel-Eintrag:", rawData[0]);


// Zoomable Map Funktion

// Hilfsfunktion zum Parsen der Ortsangaben. Es gibt viele unbrauchbare Einträge, die wir rausfiltern müssen.
const JUNK_PATTERN = /^\(.*\)$|unspecified|unknown|deleted|hoax/i; // Filtert unbrauchbare Ortsangaben heraus

function parseLocation(locationStr) {
    if (!locationStr) return null;

    // Zerlegen + Whitespace trimmen + leere Teile wegwerfen
    const parts = locationStr
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

    // Wir brauchen mindestens "Stadt, Land" -> 2 Teile
    if (parts.length < 2) return null;

    const city = parts[0];
    const country = parts[parts.length - 1];
    // Nur wenn es einen Mittelteil gibt, ist das ein State/Bundesland
    const state = parts.length >= 3 ? parts[1] : null;

    // Junk-Filter
    if (JUNK_PATTERN.test(city)) return null;
    if (country === "Unspecified" || !country) return null;

    return { city, state, country };
}

const sightings = rawData
    .map(row => parseLocation(row.Location))
    .filter(Boolean);  // null-Einträge rauswerfen

console.log(`${sightings.length} Sichtungen nach dem Parsen übrig.`);

function buildHierarchy(sightings) {
    // Struktur: Map<Country, Map<State|null, Map<City, count>>>
    const tree = new Map();

    for (const { country, state, city } of sightings) {
        if (!tree.has(country)) {
            tree.set(country, new Map());
        }
        const countryMap = tree.get(country);

        // Wenn kein State da ist: spezieller Platzhalter, der später
        // erkannt und "weggebügelt" wird
        const stateKey = state ?? "__NO_STATE__";
        if (!countryMap.has(stateKey)) {
            countryMap.set(stateKey, new Map());
        }
        const stateMap = countryMap.get(stateKey);

        stateMap.set(city, (stateMap.get(city) || 0) + 1);
    }

    // Jetzt in die Form bringen, die d3.hierarchy erwartet:
    // { name, children: [...] } bzw. { name, value } am Blatt.
    return {
        name: "Alle Länder",
        children: Array.from(tree, ([countryName, stateMap]) => {
            const stateKeys = Array.from(stateMap.keys());
            const onlyNoState =
                stateKeys.length === 1 && stateKeys[0] === "__NO_STATE__";

            if (onlyNoState) {
                // Land hat keine Staat-Ebene -> Städte direkt unters Land
                return {
                    name: countryName,
                    children: Array.from(
                        stateMap.get("__NO_STATE__"),
                        ([cityName, count]) => ({ name: cityName, value: count })
                    ),
                };
            }

            // Normalfall: Land -> Staaten -> Städte
            return {
                name: countryName,
                children: Array.from(stateMap, ([stateName, cityMap]) => ({
                    name: stateName === "__NO_STATE__" ? "(ohne Angabe)" : stateName,
                    children: Array.from(cityMap, ([cityName, count]) => ({
                        name: cityName,
                        value: count,
                    })),
                })),
            };
        }),
    };
}

const hierarchyData = buildHierarchy(sightings);
console.log("Hierarchie gebaut:", hierarchyData);
console.log(`Anzahl Länder: ${hierarchyData.children.length}`);

// Top 5 Länder nach Anzahl Sichtungen (für's Gefühl)
const countryCounts = hierarchyData.children
    .map(c => ({
        name: c.name,
        total: d3.sum(c.children, s =>
            s.value !== undefined
                ? s.value
                : d3.sum(s.children, city => city.value)
        ),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
console.log("Top 5 Länder:", countryCounts);

// Parameter:
//   containerId     - CSS-Selektor des SVG-Containers, z.B. "#treemap-container"
//   titleElementId  - ID des Titel-Elements für Breadcrumb, z.B. "treemap-title"
//   hierarchyData   - Daten im Format { name, children: [...] }
//   options         - optional: { width, height }
//
function createTreemap(containerId, titleElementId, hierarchyData, options = {}) {
    // Breiteres Verhältnis: füllt den Container besser, große Kacheln dominieren weniger
    const width = options.width || 1200;
    const height = options.height || 700;

     const hierarchy = d3.hierarchy(hierarchyData)
        .sum(d => d.value || 0)
        .sort((a, b) => b.value - a.value);

    function tile(node, x0, y0, x1, y1) {
        d3.treemapBinary(node, 0, 0, width, height);
        for (const child of node.children) {
            child.x0 = x0 + child.x0 / width * (x1 - x0);
            child.x1 = x0 + child.x1 / width * (x1 - x0);
            child.y0 = y0 + child.y0 / height * (y1 - y0);
            child.y1 = y0 + child.y1 / height * (y1 - y0);
        }
    }
    const treemapRoot = d3.treemap().tile(tile)(hierarchy);

    const countryNames = hierarchyData.children.map(c => c.name);
    const countryColors = new Map();
    // Goldener Schnitt für gleichmäßig verteilte, ästhetische Farbwahl
    const goldenAngle = 137.508;
    countryNames.forEach((name, i) => {
        const hue = (i * goldenAngle + 210) % 360; // Start bei Blau-Bereich
        countryColors.set(name, d3.hsl(hue, 0.5, 0.55));
    });

    function colorFor(node) {
        if (node.depth === 0) return "#1a1f33";

        let ancestor = node;
        while (ancestor.depth > 1) ancestor = ancestor.parent;

        const baseColor = d3.hsl(countryColors.get(ancestor.data.name));
        // Sanftere Helligkeitsabstufung pro Tiefe für weniger harte Kontraste
        baseColor.l = 0.50 + (node.depth - 1) * 0.08;
        baseColor.s = 0.45 + (node.depth - 1) * 0.05;
        return baseColor.toString();
    }

    const x = d3.scaleLinear().rangeRound([0, width]);
    const y = d3.scaleLinear().rangeRound([0, height]);

    const formatNumber = d3.format(",d");
    const grandTotal = treemapRoot.value;

    function formatPercent(value) {
        const pct = (value / grandTotal) * 100;
        if (pct >= 1) return `${pct.toFixed(1)}%`;
        if (pct >= 0.1) return `${pct.toFixed(2)}%`;
        return "<0.1%";
    }

    let uidCounter = 0;
    function uid(prefix) {
        const id = `${prefix}-${++uidCounter}`;
        return { id, href: `#${id}` };
    }

    const titleElement = document.getElementById(titleElementId);
    function updateTitle(node) {
        titleElement.textContent = node
            .ancestors()
            .reverse()
            .map(n => n.data.name)
            .join(" > ");
    }
    d3.select(containerId).selectAll("*").remove();
    const svg = d3.select(containerId)
        .append("svg")
        .attr("viewBox", [0, 0, width, height])
        .attr("preserveAspectRatio", "xMidYMid meet")
        .attr("width", "100%")
        .style("height", "auto")
        .style("font", "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif")
        .style("display", "block");

    let currentNode = treemapRoot;
    let group = svg.append("g").call(render, treemapRoot);
    updateTitle(treemapRoot);

    function render(group, parentNode) {
        const node = group
            .selectAll("g")
            .data(parentNode.children || [parentNode])
            .join("g");

        node.filter(d => d.children)
            .attr("cursor", "pointer")
            .on("click", (event, d) => zoomInto(d));

        node.append("title")
            .text(d => {
                const path = d.ancestors().reverse()
                    .map(n => n.data.name).join(" › ");
                return `${path}\n${formatNumber(d.value)} Sichtungen (${formatPercent(d.value)})`;
            });
        node.append("rect")
            .attr("id", d => (d.leafUid = uid("leaf")).id)
            .attr("fill", d => colorFor(d))
            .attr("fill-opacity", 0.92)
            .attr("stroke", "#0a0e1a")
            .attr("stroke-width", 1)
            .attr("rx", 3)
            .attr("ry", 3)
            .style("transition", "fill-opacity 0.15s ease");

        // Hover-Effekt: Kachel hellt leicht auf
        node.on("mouseenter", function() {
            d3.select(this).select("rect").attr("fill-opacity", 1);
        }).on("mouseleave", function() {
            d3.select(this).select("rect").attr("fill-opacity", 0.92);
        });

        node.append("clipPath")
            .attr("id", d => (d.clipUid = uid("clip")).id)
            .append("use")
            .attr("xlink:href", d => "#" + d.leafUid.id);

        const text = node.append("text")
            .attr("clip-path", d => `url(#${d.clipUid.id})`)
            .attr("fill", "#fff")
            .attr("font-size", 12)
            .style("pointer-events", "none")
            .style("text-shadow", "0 1px 2px rgba(0, 0, 0, 0.4)");

        text.append("tspan")
            .attr("x", 8)
            .attr("y", "1.3em")
            .attr("font-weight", "600")
            .attr("letter-spacing", "-0.01em")
            .text(d => d.data.name);

        text.append("tspan")
            .attr("x", 8)
            .attr("y", "2.6em")
            .attr("fill-opacity", 0.8)
            .attr("font-size", 10.5)
            .text(d => `${formatNumber(d.value)} · ${formatPercent(d.value)}`);

        group.call(position, parentNode);
    }

    function position(group, parentNode) {
        group.selectAll("g")
            .attr("transform", d => `translate(${x(d.x0)},${y(d.y0)})`)
            .select("rect")
            .attr("width", d => x(d.x1) - x(d.x0))
            .attr("height", d => y(d.y1) - y(d.y0));
    }

    function zoomInto(d) {
        if (!d.children) return;
        currentNode = d;

        const group0 = group.attr("pointer-events", "none");
        const group1 = group = svg.append("g").call(render, d);

        x.domain([d.x0, d.x1]);
        y.domain([d.y0, d.y1]);

        updateTitle(d);

        svg.transition()
            .duration(750)
            .call(t => group0.transition(t).remove()
                .call(position, d.parent))
            .call(t => group1.transition(t)
                .attrTween("opacity", () => d3.interpolate(0, 1))
                .call(position, d));
    }

    function zoomOut() {
        if (!currentNode.parent) return;
        const leaving = currentNode;
        currentNode = currentNode.parent;

        const group0 = group.attr("pointer-events", "none");
        const group1 = group = svg.insert("g", "*").call(render, currentNode);

        x.domain([currentNode.x0, currentNode.x1]);
        y.domain([currentNode.y0, currentNode.y1]);

        updateTitle(currentNode);

        svg.transition()
            .duration(750)
            .call(t => group0.transition(t).remove()
                .attrTween("opacity", () => d3.interpolate(1, 0))
                .call(position, leaving))
            .call(t => group1.transition(t)
                .call(position, currentNode));
    }

    // Sprung direkt zu einem beliebigen Knoten (ohne Animation),
    // damit der Globe schnell zwischen Ländern hin- und herwechseln kann.
    function jumpTo(targetNode) {
        if (!targetNode) return;
        svg.selectAll("g").interrupt();
        svg.selectAll("g").remove();
        currentNode = targetNode;
        x.domain([targetNode.x0, targetNode.x1]);
        y.domain([targetNode.y0, targetNode.y1]);
        group = svg.append("g").call(render, targetNode);
        updateTitle(targetNode);
    }

    function zoomToName(name) {
        if (!name) return false;
        const target = treemapRoot.children?.find(c => c.data.name === name);
        if (!target) return false;
        jumpTo(target);
        return true;
    }

    function zoomToRoot() {
        jumpTo(treemapRoot);
    }

    svg.on("dblclick", zoomOut); // Doppelklick zum zurück gehen

    return {
        zoomOut,
        zoomToName,
        zoomToRoot,
        getCurrentNode: () => currentNode,
    };
}

// Aufruf der Zoomable Map
const treemap = createTreemap(
    "#treemap-container",
    "treemap-title",
    hierarchyData
);

// Bridge zum Globus: Klick auf ein Land öffnet die Treemap, Doppelklick schließt sie.
const globeTreemapSection = document.getElementById("globe-treemap-section");

// Mehrere mögliche Schreibweisen pro Land aus dem Globus-Code → Treemap-Knoten,
// weil der Treemap die Rohdaten 1:1 nutzt (z.B. "USA" statt "United States").
function findCountryNode(name) {
    if (!name) return null;
    const direct = hierarchyData.children.find(c => c.name === name);
    if (direct) return direct.name;
    // Loose match: case-insensitive
    const ci = hierarchyData.children.find(
        c => c.name.toLowerCase() === name.toLowerCase()
    );
    return ci ? ci.name : null;
}

window.__showCountryTreemap = (countryName) => {
    if (!globeTreemapSection) return;
    const matched = findCountryNode(countryName);
    globeTreemapSection.hidden = false;
    if (matched && treemap.zoomToName(matched)) {
        // sanftes Scroll, damit die Treemap direkt im Blick ist
        requestAnimationFrame(() => {
            globeTreemapSection.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    } else {
        // Kein passender Knoten → wenigstens die Wurzel zeigen
        treemap.zoomToRoot();
    }
};

window.__hideTreemap = () => {
    if (!globeTreemapSection) return;
    treemap.zoomToRoot();
    globeTreemapSection.hidden = true;
};


// Kalender d3 Funktion

const parseDate = d3.utcParse("%Y-%m-%d");

function extractDate(occurredStr) {
    if (!occurredStr) return null;

    const match = occurredStr.match(/^(\d{4}-\d{2}-\d{2})/); // e.g. 2024-04-13 ...(everything after space is vain)
    return match ? parseDate(match[1]) : null;
}

// collect all dates
const datedSightings = rawData
    .map(row => extractDate(row.Occurred))
    .filter(Boolean); // only true dates not null

console.log(`${datedSightings.length} Sichtungen mit gültigem Datum.`); // ok spooky was copilot vorschlägt, aber kaufe ich

// counts by day
const countsByDay = d3.rollup(
    datedSightings,
    v => v.length,
    d => d.toISOString().slice(0, 10) // "YYYY-MM-DD"
);

const availableYears = Array.from(
    new Set(datedSightings.map(d => d.getUTCFullYear()))
).sort();

console.log("Verfügbare Jahre:", availableYears);

// Für calendar-3d.js verfügbar machen
window.__countsByDay = countsByDay;
window.__availableYears = availableYears;

// Index aller Reports nach Datum (YYYY-MM-DD) — für die Datums-Suche
const reportsByDate = new Map();
for (const row of rawData) {
    const match = row.Occurred?.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!match) continue;
    const key = match[1];
    if (!reportsByDate.has(key)) reportsByDate.set(key, []);
    reportsByDate.get(key).push(row);
}

// function: create Heatmap Calendar
function createCalendar(containerId, countsByDay, year, options = {}) {
    const cellSize = options.cellSize || 17;
    const colorRange = options.colorRange || ["#0a1628", "#22d3ee"]
    const selectedDateKey = options.selectedDateKey || null;

    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
    const days = d3.utcDays(yearStart, yearEnd); // utcDays returns all days between start and end, even if they are leap years

    const values = days.map(d => {
        const key = d.toISOString().slice(0, 10); // "YYYY-MM-DD"
        return countsByDay.get(key) || 0;
    });

    const maxValue = d3.max(values) || 1; // avoid division by zero

    const colorScale = d3.scaleLinear()
        .domain([0, maxValue])
        .range(colorRange);
    
    const weeksInYear = d3.utcSunday.count(yearStart, yearEnd);

    const padLeft = 32;
    const padTop = 20;

    const width = padLeft + weeksInYear * cellSize + cellSize;
    const height = padTop + 7 * cellSize + 10;
    
    // svg — nur das alte SVG entfernen, damit der 3D-Button im Container bleibt
    d3.select(containerId).selectAll("svg").remove();

    const svg = d3.select(containerId)
        .append("svg")
        .attr("viewBox", [0, 0, width, height])
        .attr("width", width)
        .attr("height", height)
        .style("font", "10px sans-serif")
        .style("color", "#e8ecf4");
        
    const g = svg.append("g")
        .attr("transform", `translate(${padLeft},${padTop})`);

    const weekdayNames = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
    g.append("g")
        .attr("text-anchor", "end")
        .selectAll("text")
        .data([1, 3, 5]) // only Mo, Mi, Fr
        .join("text")
        .attr("x", -5)
        .attr("y", d => (d + 0.5) * cellSize)
        .attr("dy", "0.51em")
        .attr("fill", "currentColor")
        .text(d => weekdayNames[d]);

    const cells = g.append("g")
        .selectAll("rect")
        .data(days)
        .join("rect")
        .attr("width", cellSize - 1.5)
        .attr("height", cellSize - 1.5)
        .attr("x", d => d3.utcSunday.count(yearStart, d) * cellSize)
        .attr("y", d => d.getUTCDay() * cellSize)
        .attr("rx", 2)
        .attr("fill", d => {
            const key = d.toISOString().slice(0, 10);
            if (key === selectedDateKey) return "#fbbf24"; // amber-Highlight
            const count = countsByDay.get(key) || 0;
            return count === 0 ? "#131828" : colorScale(count);
        })
        .attr("stroke", d => d.toISOString().slice(0, 10) === selectedDateKey ? "#fde68a" : "none")
        .attr("stroke-width", d => d.toISOString().slice(0, 10) === selectedDateKey ? 1.6 : 0)
        .style("filter", d => d.toISOString().slice(0, 10) === selectedDateKey
            ? "drop-shadow(0 0 6px rgba(251, 191, 36, 0.85))" : null);
    // Tooltips for each cell
    cells.append("title")
        .text(d => {
            const key = d.toISOString().slice(0, 10);
            const count = countsByDay.get(key) || 0;
            const dateStr = d.toLocaleDateString("de-DE", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
                timeZone: "UTC",
            });
            return `${dateStr}\n${count} Sichtung${count === 1 ? "" : "en"}`;
        });
    const month = d3.utcMonths(yearStart, yearEnd);

    function pathMonth(t) {
        const d = t.getUTCDay() // weekday at start of month (0=So, 6=Sa)
        const w = d3.utcSunday.count(yearStart, t) // week collumn
        return `M${(w + 1) * cellSize},${d * cellSize}
                V${0}
                H${w * cellSize}`;
    }
    // first month has no top border, want it to look like in github
    g.append("g")
        .attr("fill", "none")
        .attr("stroke", "#3e5085") // dark border color
        .attr("stroke-width", 2)
        .selectAll("path")
        .data(month.slice(1)) // skip first month, because it has no top border
        .join("path")
        .attr("d", pathMonth);

    const monthNames = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

    g.append("g")
        .selectAll("text")
        .data(month)
        .join("text")
        .attr("x", d => d3.utcSunday.count(yearStart, d) * cellSize + 2) // +2 for a little padding
        .attr("y", -5)
        .attr("fill", "currentColor")
        .text(d => monthNames[d.getUTCMonth()])

    // legend on the right side
    const legendX = weeksInYear * cellSize - 120;
    const legendY = 7 * cellSize + 20;

    const legend = g.append("g")
        .attr("transform", `translate(${legendX},${legendY})`);

    legend.append("text")
        .attr("y", cellSize * 0.7)
        .attr("fill", "currentColor")
        .text("Weniger");

    // work in progess
    const legendStep = 5;
    legend.selectAll("rect")
        .data(d3.range(legendStep))
        .join("rect")
        .attr("x", (d, i) => 55 + i * (cellSize - 1))
        .attr("y", 0)
        .attr("width", cellSize - 1.5)
        .attr("height", cellSize - 1.5)
        .attr("rx", 2)
        .attr("fill", (d, i) => i === 0 ? "#131828" : colorScale(maxValue * (i / (legendStep - 1))));

    legend.append("text")
        .attr("x", 55 + legendStep * cellSize + 4)
        .attr("y", cellSize * 0.7)
        .attr("fill", "currentColor")
        .text("Mehr");
    
    return { maxValue, totalSightings: d3.sum(values) };
}

// fill dropdown and render
const yearSelect = document.getElementById("year-select");
const calendarTitle = document.getElementById("calendar-title");

// dropdown
availableYears.forEach(year => {
    const option = document.createElement("option");
    option.value = year;
    option.textContent = year;
    yearSelect.appendChild(option);
});

yearSelect.value = availableYears[0];

let selectedDateKey = null;

function renderCalendar(year) {
    const stats = createCalendar("#calendar-container", countsByDay, year, {
        selectedDateKey,
    });
    calendarTitle.textContent = `Sichtungen pro Tag in ${year} ` +
        `(${stats.totalSightings.toLocaleString("de-DE")} insgesamt, ` +
        `Max: ${stats.maxValue} an einem Tag)`;
}

renderCalendar(+yearSelect.value);

yearSelect.addEventListener("change", () => {
    renderCalendar(+yearSelect.value);
});

// =========================================
// DATUM-EXPLORER
// =========================================
// Drei Inputs (JJJJ-MM-TT) → Highlight im Heatmap-Kalender + Reports-Liste
function setupDateExplorer() {
    const yInput = document.getElementById("date-year-input");
    const mInput = document.getElementById("date-month-input");
    const dInput = document.getElementById("date-day-input");
    const clearBtn = document.getElementById("date-clear-btn");
    const statusEl = document.getElementById("date-explorer-status");
    const reportsEl = document.getElementById("date-reports");
    if (!yInput || !mInput || !dInput) return;

    function escapeHtml(str) {
        if (str == null) return "";
        const div = document.createElement("div");
        div.textContent = String(str);
        return div.innerHTML;
    }

    function notify3D() {
        // Falls die 3D-Skyline-Szene existiert: dort gleichermaßen markieren
        if (typeof window.__updateCalendar3DSelection === "function") {
            window.__updateCalendar3DSelection();
        }
    }

    function clearSelection() {
        if (selectedDateKey === null) return;
        selectedDateKey = null;
        window.__selectedDateKey = null;
        renderCalendar(+yearSelect.value);
        reportsEl.hidden = true;
        reportsEl.innerHTML = "";
        clearBtn.hidden = true;
        renderShapeChips(rawData); // zurück zu Gesamt-Verteilung
        notify3D();
    }

    function showStatus(msg, kind = "info") {
        statusEl.textContent = msg || "";
        statusEl.dataset.kind = kind;
    }

    function renderReports(date, reports) {
        const dateStr = date.toLocaleDateString("de-DE", {
            weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
        });

        if (!reports || reports.length === 0) {
            reportsEl.innerHTML = `
                <div class="date-reports__header">
                    <h3 class="date-reports__title">${escapeHtml(dateStr)}</h3>
                    <p class="date-reports__count">Keine Sichtungen an diesem Tag</p>
                </div>
            `;
            reportsEl.hidden = false;
            return;
        }

        // Pro Report: Shape, Location, Time, Summary
        const items = reports.map(r => {
            const shape = r.Shape || "—";
            const location = r.Location || "Unbekannt";
            const occurredParts = (r.Occurred || "").trim().split(/\s+/);
            const timePart = occurredParts.length > 1 ? occurredParts.slice(1).join(" ") : "";
            const summary = r.Summary || "";
            return `
                <li class="date-reports__item">
                    <div class="date-reports__item-header">
                        <span class="date-reports__shape">${escapeHtml(shape)}</span>
                        <span class="date-reports__location">${escapeHtml(location)}</span>
                        ${timePart ? `<span class="date-reports__time">${escapeHtml(timePart)}</span>` : ""}
                    </div>
                    ${summary ? `<p class="date-reports__summary">${escapeHtml(summary)}</p>` : ""}
                </li>
            `;
        }).join("");

        reportsEl.innerHTML = `
            <div class="date-reports__header">
                <h3 class="date-reports__title">${escapeHtml(dateStr)}</h3>
                <p class="date-reports__count">${reports.length.toLocaleString("de-DE")} Sichtung${reports.length === 1 ? "" : "en"}</p>
            </div>
            <ul class="date-reports__list">
                ${items}
            </ul>
        `;
        reportsEl.hidden = false;
    }

    function tryUpdate() {
        const yStr = yInput.value;
        const mStr = mInput.value;
        const dStr = dInput.value;

        // Falls noch nicht alle Felder gefüllt sind: still bleiben
        if (yStr.length < 4 || mStr.length === 0 || dStr.length === 0) {
            showStatus("");
            clearSelection();
            return;
        }

        const y = parseInt(yStr, 10);
        const m = parseInt(mStr, 10);
        const d = parseInt(dStr, 10);
        if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
            showStatus("Ungültige Eingabe", "error");
            clearSelection();
            return;
        }

        // Datum auf Gültigkeit prüfen (Roll-Over erkennen, z.B. 31. Februar)
        const date = new Date(Date.UTC(y, m - 1, d));
        if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
            showStatus(`Ungültiges Datum: ${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, "error");
            clearSelection();
            return;
        }

        if (!availableYears.includes(y)) {
            showStatus(`Keine Sichtungen für das Jahr ${y} im Datensatz vorhanden`, "warn");
            clearSelection();
            return;
        }

        const key = date.toISOString().slice(0, 10);
        selectedDateKey = key;
        window.__selectedDateKey = key;

        // Jahr im Dropdown sync, dann Kalender neu rendern (mit Highlight)
        if (+yearSelect.value !== y) {
            yearSelect.value = y;
        }
        renderCalendar(y);

        const reports = reportsByDate.get(key) || [];
        renderReports(date, reports);
        renderShapeChips(reports); // Chips zeigen jetzt nur noch Sichtungen dieses Tages
        showStatus(`Markiert: ${date.toLocaleDateString("de-DE", { timeZone: "UTC" })}`, "ok");
        clearBtn.hidden = false;

        // Wenn die 3D-Skyline gerade offen ist, dort den Bar ebenfalls markieren
        notify3D();
    }

    // Auto-Advance bei voller Feldlänge + Backspace springt rückwärts wenn leer
    function bindInput(el, maxLen, nextEl, prevEl) {
        el.addEventListener("input", () => {
            // Nur Ziffern, Maxlänge erzwingen
            const cleaned = el.value.replace(/\D/g, "").slice(0, maxLen);
            if (cleaned !== el.value) el.value = cleaned;
            if (el.value.length >= maxLen && nextEl) nextEl.focus();
            tryUpdate();
        });
        el.addEventListener("keydown", e => {
            if (e.key === "Backspace" && el.value === "" && prevEl) {
                prevEl.focus();
            }
        });
        // Beim Verlassen mit Tab/Enter trotzdem versuchen
        el.addEventListener("blur", tryUpdate);
    }

    bindInput(yInput, 4, mInput, null);
    bindInput(mInput, 2, dInput, yInput);
    bindInput(dInput, 2, null, mInput);

    clearBtn.addEventListener("click", () => {
        yInput.value = "";
        mInput.value = "";
        dInput.value = "";
        showStatus("");
        clearSelection();
        yInput.focus();
    });

    // Wenn der User selbst das Jahr-Dropdown wechselt, die Auswahl aufräumen
    yearSelect.addEventListener("change", () => {
        if (selectedDateKey && +selectedDateKey.slice(0, 4) !== +yearSelect.value) {
            // Highlight existiert nicht mehr im sichtbaren Jahr — Auswahl entfernen
            yInput.value = "";
            mInput.value = "";
            dInput.value = "";
            showStatus("");
            clearSelection();
        }
    });
}

setupDateExplorer();

// Datum-Explorer einklappen — analog zu setupCollapsibleCharts:
// Klick auf Intro togglet das Chevron am Heading (über is-collapsed) + den Body
function setupDateExplorerCollapse() {
    const intro = document.querySelector(".date-explorer__intro");
    const heading = document.querySelector(".date-explorer__heading");
    const body = document.querySelector(".date-explorer__body");
    if (!intro || !heading || !body) return;

    intro.setAttribute("role", "button");
    intro.setAttribute("aria-expanded", "true");
    intro.setAttribute("tabindex", "0");

    const toggle = () => {
        const collapsed = body.classList.toggle("is-collapsed");
        heading.classList.toggle("is-collapsed", collapsed);
        intro.setAttribute("aria-expanded", String(!collapsed));
    };

    intro.addEventListener("click", toggle);
    intro.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
        }
    });
}

setupDateExplorerCollapse();


// =========================================
// SHAPE-VERTEILUNG (informative Chips)
// =========================================
// Reagiert auf das ausgewählte Datum: ohne Datum = alle Sichtungen,
// mit Datum = nur Sichtungen dieses Tages. Shapes ohne Treffer verschwinden.
function renderShapeChips(dataset) {
    const host = document.getElementById("shape-chips");
    if (!host) return;

    // Case-insensitive zählen: "Egg" und "egg" werden zusammengeführt.
    const counts = new Map();
    for (const row of dataset) {
        const raw = (row.Shape || "").trim();
        if (!raw) continue;
        const key = raw.toLowerCase();
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    const shapes = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([s, c]) => ({
            shape: s.charAt(0).toUpperCase() + s.slice(1),
            count: c,
        }));

    if (shapes.length === 0) {
        host.innerHTML = `<p class="shape-chips__empty">Keine Shapes an diesem Tag dokumentiert.</p>`;
        return;
    }

    const chips = shapes.map(t =>
        `<button type="button" class="shape-chip" data-shape="${t.shape}">${t.shape} <span class="shape-chip__count">${t.count.toLocaleString("de-DE")}</span></button>`
    );
    host.innerHTML = chips.join("");

    host.querySelectorAll(".shape-chip").forEach(btn => {
        btn.addEventListener("click", () => {
            const wasActive = btn.classList.contains("is-active");
            host.querySelectorAll(".shape-chip").forEach(b => b.classList.remove("is-active"));
            const shape = wasActive ? null : btn.dataset.shape;
            if (!wasActive) btn.classList.add("is-active");
            // Linked-View: Globus filtert ebenfalls
            if (typeof window.__globeFilter === "function") {
                window.__globeFilter(undefined, undefined, shape ? shape.toLowerCase() : null);
            }
        });
    });
}

renderShapeChips(rawData);


// =========================================
// TIMELINE — Linienplot der Sichtungen über die Jahre + Brush-Slider
// =========================================
function setupTimeline() {
    const container = document.getElementById("timeline-container");
    if (!container) return;

    // Aggregation pro Jahr (aus dem bereits geparsten datedSightings-Array)
    const yearCounts = d3.rollups(
        datedSightings,
        v => v.length,
        d => d.getUTCFullYear(),
    )
    .sort((a, b) => d3.ascending(a[0], b[0]))
    .map(([year, count]) => ({ year, count }));

    if (yearCounts.length === 0) return;

    // Daten für 3D-Timeline global verfügbar machen
    window.__yearCounts = yearCounts;
    window.__rawDataRef = rawData;

    const width = 1200;
    const height = 380;
    const margin = { top: 20, right: 30, bottom: 60, left: 60 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    d3.select(container).selectAll("svg").remove();

    const svg = d3.select(container)
        .append("svg")
        .attr("viewBox", [0, 0, width, height])
        .attr("preserveAspectRatio", "xMidYMid meet")
        .attr("width", "100%")
        .style("height", "auto")
        .style("display", "block")
        .style("font-family", "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif");

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const yearMinAll = d3.min(yearCounts, d => d.year);
    const yearMaxAll = d3.max(yearCounts, d => d.year);

    const xScale = d3.scaleLinear().range([0, innerW]);
    const yScale = d3.scaleLinear().range([innerH, 0]);

    // Cyan-Gradient unter der Linie
    const defs = svg.append("defs");
    const areaGrad = defs.append("linearGradient")
        .attr("id", "timeline-area-grad")
        .attr("x1", 0).attr("x2", 0).attr("y1", 0).attr("y2", 1);
    areaGrad.append("stop").attr("offset", "0%").attr("stop-color", "#22d3ee").attr("stop-opacity", 0.5);
    areaGrad.append("stop").attr("offset", "100%").attr("stop-color", "#22d3ee").attr("stop-opacity", 0);

    // Clip-Path, damit die Linie/Fläche beim Zoom nicht über die Achse hinausragt
    defs.append("clipPath").attr("id", "timeline-clip")
        .append("rect").attr("width", innerW).attr("height", innerH);

    const plotG = g.append("g").attr("clip-path", "url(#timeline-clip)");

    const areaPath = plotG.append("path")
        .attr("class", "timeline-area")
        .attr("fill", "url(#timeline-area-grad)");

    const linePath = plotG.append("path")
        .attr("class", "timeline-line")
        .attr("fill", "none")
        .attr("stroke", "#67e8f9")
        .attr("stroke-width", 2.2);

    const dotsG = plotG.append("g").attr("class", "timeline-dots");

    const xAxisG = g.append("g")
        .attr("transform", `translate(0,${innerH})`)
        .attr("class", "timeline-axis");

    const yAxisG = g.append("g").attr("class", "timeline-axis");

    const areaGen = d3.area()
        .x(d => xScale(d.year))
        .y0(innerH)
        .y1(d => yScale(d.count))
        .curve(d3.curveMonotoneX);

    const lineGen = d3.line()
        .x(d => xScale(d.year))
        .y(d => yScale(d.count))
        .curve(d3.curveMonotoneX);

    const statsEl = document.getElementById("timeline-stats");
    function updateStats(d0, d1) {
        if (!statsEl) return;
        const isFull = d0 === yearMinAll && d1 === yearMaxAll;
        const sel = yearCounts.filter(d => d.year >= d0 && d.year <= d1);
        const sum = d3.sum(sel, d => d.count);
        if (isFull) {
            statsEl.innerHTML = `Gesamt · <strong>${sum.toLocaleString("de-DE")}</strong> Sichtungen über alle Jahre`;
        } else {
            statsEl.innerHTML = `<strong>${d0}–${d1}</strong> · <strong>${sum.toLocaleString("de-DE")}</strong> Sichtungen (${sel.length} Jahre)`;
        }
    }

    // ---- Hauptzeichnung: redraw skaliert beide Achsen + animiert beim Zoom ----
    let currentDomain = [yearMinAll, yearMaxAll];

    function redraw(domain, animate = true) {
        let [d0, d1] = domain;
        d0 = Math.max(yearMinAll, Math.min(yearMaxAll, d0));
        d1 = Math.max(yearMinAll, Math.min(yearMaxAll, d1));
        if (d0 > d1) [d0, d1] = [d1, d0];
        if (d0 === d1) d1 = Math.min(yearMaxAll, d0 + 1);

        const filtered = yearCounts.filter(d => d.year >= d0 && d.year <= d1);
        if (filtered.length === 0) return;

        xScale.domain([d0, d1]);
        const ymax = d3.max(filtered, d => d.count) || 1;
        yScale.domain([0, ymax * 1.08]);

        const trans = animate ? d3.transition().duration(620).ease(d3.easeCubicInOut) : null;

        const xAxis = d3.axisBottom(xScale).tickFormat(d3.format("d")).ticks(Math.min(10, filtered.length));
        const yAxis = d3.axisLeft(yScale).ticks(6).tickFormat(d => d.toLocaleString("de-DE"));

        if (animate) {
            areaPath.datum(filtered).transition(trans).attr("d", areaGen);
            linePath.datum(filtered).transition(trans).attr("d", lineGen);
            xAxisG.transition(trans).call(xAxis);
            yAxisG.transition(trans).call(yAxis);
        } else {
            areaPath.datum(filtered).attr("d", areaGen);
            linePath.datum(filtered).attr("d", lineGen);
            xAxisG.call(xAxis);
            yAxisG.call(yAxis);
        }

        // Datenpunkte
        const dotSel = dotsG.selectAll("circle").data(filtered, d => d.year);
        dotSel.exit().remove();
        const dotEnter = dotSel.enter().append("circle")
            .attr("r", 2.5)
            .attr("fill", "#22d3ee")
            .attr("cx", d => xScale(d.year))
            .attr("cy", d => yScale(d.count));
        dotEnter.append("title")
            .text(d => `${d.year}: ${d.count.toLocaleString("de-DE")} Sichtungen`);

        const dotMerge = dotEnter.merge(dotSel);
        if (animate) {
            dotMerge.transition(trans)
                .attr("cx", d => xScale(d.year))
                .attr("cy", d => yScale(d.count));
        } else {
            dotMerge
                .attr("cx", d => xScale(d.year))
                .attr("cy", d => yScale(d.count));
        }
        dotMerge.select("title")
            .text(d => `${d.year}: ${d.count.toLocaleString("de-DE")} Sichtungen`);

        currentDomain = [d0, d1];
        updateStats(d0, d1);
        if (startInput) startInput.value = d0;
        if (endInput)   endInput.value   = d1;
    }

    // ---- Inputs ----
    const startInput = document.getElementById("timeline-year-start");
    const endInput = document.getElementById("timeline-year-end");
    const resetBtn = document.getElementById("timeline-year-reset");

    if (startInput) { startInput.min = yearMinAll; startInput.max = yearMaxAll; startInput.value = yearMinAll; }
    if (endInput)   { endInput.min   = yearMinAll; endInput.max   = yearMaxAll; endInput.value   = yearMaxAll; }

    function onYearInputChange() {
        const s = parseInt(startInput.value, 10);
        const e = parseInt(endInput.value, 10);
        if (!Number.isFinite(s) || !Number.isFinite(e)) return;
        redraw([s, e]);
    }
    startInput?.addEventListener("change", onYearInputChange);
    endInput?.addEventListener("change", onYearInputChange);

    resetBtn?.addEventListener("click", () => {
        redraw([yearMinAll, yearMaxAll]);
    });

    // ---- Brush: am Ende des Drags zoomen + Selection clearen ----
    const brushGroup = g.append("g").attr("class", "timeline-brush");
    const brush = d3.brushX()
        .extent([[0, 0], [innerW, innerH]])
        .on("end", ({ selection, sourceEvent }) => {
            if (!sourceEvent) return;     // programmatischer Move → ignorieren
            if (!selection) return;       // Klick außerhalb → nichts tun
            const [x0, x1] = selection;
            const yMin = Math.round(xScale.invert(x0));
            const yMax = Math.round(xScale.invert(x1));
            // Brush-Selection wegblenden — der gezoomte View IST die Selection
            brushGroup.call(brush.move, null);
            redraw([yMin, yMax]);
        });
    brushGroup.call(brush);

    // Doppelklick auf den Plot → Voll-Zoom (klassischer Pan/Zoom-Reset)
    svg.on("dblclick", () => redraw([yearMinAll, yearMaxAll]));

    // Initial-Render
    redraw([yearMinAll, yearMaxAll], false);
}

setupTimeline();


// =========================================
// GLOBUS-CONTROLS — Zeit-Slider + Auto-Play + Flugbahnen-Beta
// =========================================
function setupGlobeControls() {
    const startSlider = document.getElementById("globe-time-start");
    const endSlider = document.getElementById("globe-time-end");
    const display = document.getElementById("globe-time-display");
    const playBtn = document.getElementById("globe-play-btn");
    const flightBtn = document.getElementById("globe-flight-btn");
    if (!startSlider || !endSlider) return;

    // Wartet bis Globus initialisiert ist (window.__globeYearRange existiert)
    function tryInit() {
        if (!window.__globeYearRange || !window.__globeFilter) {
            setTimeout(tryInit, 200);
            return;
        }
        const { min, max } = window.__globeYearRange;
        startSlider.min = min;  startSlider.max = max;  startSlider.value = min;
        endSlider.min   = min;  endSlider.max   = max;  endSlider.value   = max;
        updateDisplay();
    }

    function updateDisplay() {
        const a = parseInt(startSlider.value, 10);
        const b = parseInt(endSlider.value, 10);
        display.textContent = `${a} – ${b}`;
    }

    function applyFilter() {
        let a = parseInt(startSlider.value, 10);
        let b = parseInt(endSlider.value, 10);
        if (a > b) [a, b] = [b, a]; // tauschen, falls überschritten
        if (a !== parseInt(startSlider.value, 10)) startSlider.value = a;
        if (b !== parseInt(endSlider.value, 10))   endSlider.value   = b;
        updateDisplay();
        window.__globeFilter?.(a, b, undefined);
    }

    startSlider.addEventListener("input", applyFilter);
    endSlider.addEventListener("input", applyFilter);

    // --- Auto-Play: Endjahr fährt von Start bis Max in 14 Sekunden ---
    let playing = false;
    let playTimer = null;
    const PLAY_DURATION_MS = 14000;

    function startPlay() {
        if (playing) return;
        playing = true;
        playBtn.textContent = "⏸";
        playBtn.classList.add("is-playing");

        const min = parseInt(startSlider.min, 10);
        const max = parseInt(startSlider.max, 10);
        const a = parseInt(startSlider.value, 10);
        const startTime = performance.now();

        function step(now) {
            if (!playing) return;
            const t = Math.min(1, (now - startTime) / PLAY_DURATION_MS);
            const target = Math.round(a + (max - a) * t);
            endSlider.value = target;
            applyFilter();
            if (t >= 1) {
                stopPlay();
                return;
            }
            playTimer = requestAnimationFrame(step);
        }
        playTimer = requestAnimationFrame(step);
    }

    function stopPlay() {
        playing = false;
        playBtn.textContent = "▶";
        playBtn.classList.remove("is-playing");
        if (playTimer) cancelAnimationFrame(playTimer);
        playTimer = null;
    }

    playBtn?.addEventListener("click", () => {
        if (playing) stopPlay();
        else startPlay();
    });

    // --- Flugbahnen-Beta-Toggle ---
    flightBtn?.addEventListener("click", () => {
        const isOn = flightBtn.getAttribute("aria-pressed") === "true";
        const next = !isOn;
        flightBtn.setAttribute("aria-pressed", String(next));
        window.__globeSetFlightPaths?.(next);
    });

    tryInit();
}

setupGlobeControls();


// =========================================
// COLLAPSIBLE CHARTS
// =========================================
// Klick auf Titel/Header klappt den jeweiligen Chart ein bzw. wieder aus.
// Klicks auf .chart-controls (z.B. Jahr-Dropdown) werden ignoriert.
function setupCollapsibleCharts() {
    document.querySelectorAll(".chart-title").forEach(title => {
        const parent = title.parentElement;
        const inHeader = parent.classList.contains("chart-header");
        // Klickbarer Bereich: ganze Header-Zeile, sonst nur der Titel
        const trigger = inHeader ? parent : title;
        // Zugehöriger Chart-Container: nächstes Geschwister-Element
        const container = inHeader
            ? parent.nextElementSibling
            : title.nextElementSibling;

        if (!container || !container.classList.contains("chart-container")) return;

        trigger.setAttribute("role", "button");
        trigger.setAttribute("aria-expanded", "true");
        trigger.setAttribute("tabindex", "0");

        const toggle = () => {
            const collapsed = container.classList.toggle("is-collapsed");
            title.classList.toggle("is-collapsed", collapsed);
            trigger.setAttribute("aria-expanded", String(!collapsed));
        };

        trigger.addEventListener("click", e => {
            // Klicks auf das Dropdown o.ä. NICHT als Toggle interpretieren
            if (e.target.closest(".chart-controls")) return;
            toggle();
        });

        // Tastatur-Bedienung: Enter / Space klappt ebenfalls
        trigger.addEventListener("keydown", e => {
            if (e.target.closest(".chart-controls")) return;
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle();
            }
        });
    });
}

setupCollapsibleCharts();


// =========================================
// UFO-LOADER & SCROLL-MASKOTTCHEN
// =========================================
function hideLoader() {
    const loader = document.getElementById("ufo-loader");
    if (!loader) return;
    // Mindestens kurz sichtbar lassen, damit es nicht "blitzt", wenn Daten
    // schon im Browser-Cache liegen
    setTimeout(() => loader.classList.add("is-hidden"), 400);
}

function setupScrollMascot() {
    const mascot = document.querySelector(".ufo-mascot");
    if (!mascot) return;

    // Wenn der User Reduced-Motion bevorzugt, blenden wir das Maskottchen aus
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    mascot.classList.add("is-visible");

    // Modus: "scroll" -> folgt dem Scrollen | "random" -> fliegt frei umher
    let mode = "scroll";
    let ticking = false;

    function updateFromScroll() {
        if (mode !== "scroll") return;
        const scrollY = window.scrollY;
        const maxScroll = Math.max(
            1,
            document.documentElement.scrollHeight - window.innerHeight
        );
        const progress = Math.min(1, Math.max(0, scrollY / maxScroll));

        // Horizontaler Flug: links nach rechts über die Seite
        const margin = 40;
        const travelWidth = window.innerWidth - mascot.offsetWidth - margin * 2;
        const x = margin + progress * travelWidth;

        // Sanfte Wellen-Bewegung in der Vertikalen
        const yWave = Math.sin(progress * Math.PI * 3) * 30;

        // Leichte Neigung in Flugrichtung
        const tilt = Math.cos(progress * Math.PI * 3) * 6;

        mascot.style.transform = `translate(${x}px, ${yWave}px) rotate(${tilt}deg)`;
        ticking = false;
    }

    window.addEventListener("scroll", () => {
        if (!ticking && mode === "scroll") {
            requestAnimationFrame(updateFromScroll);
            ticking = true;
        }
    }, { passive: true });

    window.addEventListener("resize", () => {
        if (mode === "scroll") updateFromScroll();
    }, { passive: true });

    updateFromScroll();

    // Nach 1.5 Minuten: UFO macht sich selbstständig und fliegt zufällig
    // zwischen freien Punkten auf dem Bildschirm umher.
    const RANDOM_DELAY_MS = 90 * 1000; // 1.5 Minuten
    const HOP_INTERVAL_MS = 4500;       // Zeit zwischen neuen Zielen

    setTimeout(() => {
        mode = "random";

        // Sanfte CSS-Transition für die freie Flugphase
        mascot.style.transition =
            "transform 4s cubic-bezier(0.45, 0.05, 0.55, 0.95)";

        function flyToRandomSpot() {
            if (mode !== "random") return;

            const w = mascot.offsetWidth || 80;
            const h = mascot.offsetHeight || 50;
            const margin = 30;

            // Erlaubte X-Strecke (translate ist relativ zu left:0)
            const maxX = Math.max(margin, window.innerWidth - w - margin);
            const x = margin + Math.random() * (maxX - margin);

            // Erlaubte Y-Strecke (translate ist relativ zu top:100px aus dem CSS)
            const minY = -80; // darf etwas in den Header fliegen
            const maxY = Math.max(minY + 50, window.innerHeight - 100 - h - margin);
            const y = minY + Math.random() * (maxY - minY);

            // Leichte zufällige Neigung
            const tilt = (Math.random() - 0.5) * 24;

            mascot.style.transform = `translate(${x}px, ${y}px) rotate(${tilt}deg)`;
        }

        flyToRandomSpot();
        setInterval(flyToRandomSpot, HOP_INTERVAL_MS);
    }, RANDOM_DELAY_MS);
}

setupScrollMascot();
hideLoader();