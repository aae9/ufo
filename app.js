import * as d3 from 'https://esm.sh/d3@7';

const rawData = await d3.csv("nuforc_str.csv");

console.log(`${rawData.length} Sichtungen geladen.`);
console.log("Beispiel-Eintrag:", rawData[0]);


// Spike Chart Funktion
function createSpikeChart(containerId, data, options = {}) {
    const config = {
        width: options.width || 800,
        height: options.height || 400,
        margin: { top: 20, right: 30, bottom: 80, left: 50 },
        spikeColor: options.spikeColor || "gray",
        spikeWidth: options.spikeWidth || 6,
        maxSpikeHeight: options.maxSpikeHeight || 250
    };

    const innerWidth = config.width - config.margin.left - config.margin.right;
    const innerHeight = config.height - config.margin.top - config.margin.bottom;

    d3.select(containerId).selectAll("*").remove();

    const svg = d3.select(containerId)
        .append("svg")
        .attr("width", config.width)
        .attr("height", config.height);

    const g = svg.append("g")
        .attr("transform", `translate(${config.margin.left},${config.margin.top})`);

    const xScale = d3.scaleBand()
        .domain(data.map(d => d.label))
        .range([0, innerWidth])
        .padding(0.2);

    const yScale = d3.scaleLinear()
        .domain([0, d3.max(data, d => d.value)])
        .range([0, config.maxSpikeHeight]);

    function spikePath(x, baseY, height, width) {
        const halfWidth = width / 2;
        return `M ${x - halfWidth},${baseY} L ${x},${baseY - height} L ${x + halfWidth},${baseY} Z`;
    }

    g.selectAll(".spike")
        .data(data)
        .enter()
        .append("path")
        .attr("class", "spike")
        .attr("d", d => {
            const x = xScale(d.label) + xScale.bandwidth() / 2;
            return spikePath(x, innerHeight, yScale(d.value), config.spikeWidth);
        })
        .attr("fill", config.spikeColor)
        .attr("fill-opacity", 0.7)
        .attr("stroke", config.spikeColor)
        .append("title")
        .text(d => `${d.label}: ${d.value}`);

    // X-Achse mit rotierten Labels (gut für viele Kategorien)
    g.append("g")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(xScale))
        .selectAll("text")
        .attr("transform", "rotate(-45)")
        .style("text-anchor", "end");

    // Y-Achse
    const yAxisScale = d3.scaleLinear()
        .domain([0, d3.max(data, d => d.value)])
        .range([innerHeight, innerHeight - config.maxSpikeHeight]);

    g.append("g").call(d3.axisLeft(yAxisScale).ticks(5));
}

function createShapeSpikeChart(containerId, sightings) {
    const shapeCounts = d3.rollups(
        sightings,
        v => v.length,
        d => d.Shape
    )
    .filter(([shape]) => shape && shape !== "")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20) // Top 20 Shapes
    .map(([shape, count]) => ({ label: shape, value: count }));

    createSpikeChart(containerId, shapeCounts, {
        spikeColor: "#457b9d",
        spikeWidth: 10,
        width: 900
    });
}
function createTimeSpikeChart(containerId, sightings) {
    const yearCounts = d3.rollups(
        sightings,
        v => v.length,
        d => {
            const match = d.Occurred?.match(/^(\d{4})/);
            return match ? match[1] : null;
        }
    )
    .filter(([year]) => year !== null)
    .sort((a, b) => d3.ascending(a[0], b[0]))
    .map(([year, count]) => ({ label: year, value: count }));

    createSpikeChart(containerId, yearCounts, {
        spikeColor: "#2a9d8f",
        spikeWidth: 6,
        width: 1000
    });
}
// Aufruf der Spike Charts
createShapeSpikeChart("#shape-chart", rawData);
createTimeSpikeChart("#time-chart", rawData);


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

    svg.on("dblclick", zoomOut); // Doppelklick zum zurück gehen

    return {
        zoomOut,
        getCurrentNode: () => currentNode,
    };
}

// Aufruf der Zoomable Map
const treemap = createTreemap(
    "#treemap-container",
    "treemap-title",
    hierarchyData
);


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

// function: create Heatmap Calendar
function createCalendar(containerId, countsByDay, year, options = {}) {
    const cellSize = options.cellSize || 17;
    const colorRange = options.colorRange || ["#0a1628", "#22d3ee"]

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
    
    // svg
    d3.select(containerId).selectAll("*").remove(); // clear previous content

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
            const count = countsByDay.get(key) || 0;
            // days without any count getting this color else colorScale(count)
            return count === 0 ? "#131828" : colorScale(count);
        });
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

function renderCalendar(year) {
    const stats = createCalendar("#calendar-container", countsByDay, year);
    calendarTitle.textContent = `Sichtungen pro Tag in ${year} ` +
        `(${stats.totalSightings.toLocaleString("de-DE")} insgesamt, ` +
        `Max: ${stats.maxValue} an einem Tag)`;
}

renderCalendar(+yearSelect.value);

yearSelect.addEventListener("change", () => {
    renderCalendar(+yearSelect.value);
});


// Marimekko chart
function createMarimekkoChart(containerId, data, options = {}) {
    const config = {
        width: options.width || 800,
        height: options.height || 400,
        margin: { top: 20, right: 30, bottom: 80, left: 50 },
        spikeColor: options.spikeColor || "red",
        spikeWidth: options.spikeWidth || 6,
        maxSpikeHeight: options.maxSpikeHeight || 250
    };

}


// Bubble chart
// =========================================
// WORT-DATEN VORBEREITEN
// =========================================

// Englische Stoppwörter — die häufigsten "Füllwörter", die in fast jedem
// Text vorkommen und keine Aussage haben. Wenn wir die nicht rauswerfen,
// wären "the", "and", "was" die größten Bubbles -- nicht spannend.
//
// Quelle: angelehnt an die Standard-NLTK-Stopword-Liste, leicht erweitert
// um typische Bericht-Sprache ("said", "got", ...).
const STOPWORDS = new Set([
    "a", "an", "the", "and", "or", "but", "if", "then", "else", "when",
    "at", "by", "for", "with", "about", "against", "between", "into",
    "through", "during", "before", "after", "above", "below", "to", "from",
    "up", "down", "in", "out", "on", "off", "over", "under", "again",
    "further", "once", "here", "there", "all", "any", "both", "each",
    "few", "more", "most", "other", "some", "such", "no", "nor", "not",
    "only", "own", "same", "so", "than", "too", "very", "can", "will",
    "just", "should", "now", "i", "me", "my", "myself", "we", "our",
    "ours", "ourselves", "you", "your", "yours", "yourself", "yourselves",
    "he", "him", "his", "himself", "she", "her", "hers", "herself", "it",
    "its", "itself", "they", "them", "their", "theirs", "themselves",
    "what", "which", "who", "whom", "this", "that", "these", "those",
    "am", "is", "are", "was", "were", "be", "been", "being", "have",
    "has", "had", "having", "do", "does", "did", "doing", "would", "could",
    "should", "may", "might", "must", "shall", "as", "of", "because",
    "while", "until", "since", "also", "got", "get", "said", "saw",
    "see", "seen", "looked", "looking", "look", "went", "go", "going",
    "came", "come", "coming", "back", "made", "make", "making", "still",
    "even", "around", "like", "way", "two", "one"
]);

// Tokenizer: zerlegt einen Text in einzelne Wörter
// - alles auf Kleinbuchstaben
// - alle Nicht-Buchstaben werden zu Trennern
// - leere Strings rausfiltern
function normalize(word) {
    // Plural-s entfernen, aber nicht für Wörter die auf "ss" enden
    // ("class" soll "class" bleiben, nicht "clas")
    if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) {
        return word.slice(0, -1);
    }
    return word;
}

function tokenize(text) {
    if (!text) return [];
    return text
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter(Boolean)
        .map(normalize);   // ← neu: nach dem Splitten normalisieren
}

// Alle Summaries zusammen tokenisieren und Wörter zählen
function buildWordCounts(rawData, field, topN) {
    const counts = new Map();

    for (const row of rawData) {
        const tokens = tokenize(row[field]);
        for (const word of tokens) {
            if (STOPWORDS.has(word)) continue;
            counts.set(word, (counts.get(word) || 0) + 1);
        }
    }

    // Map zu Array, sortieren, Top N nehmen
    return Array.from(counts, ([word, count]) => ({ word, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, topN);
}

const wordData = buildWordCounts(rawData, "Summary", 200);

console.log(`Top 10 Wörter:`, wordData.slice(0, 10));
console.log(`Häufigstes Wort: "${wordData[0].word}" mit ${wordData[0].count} Vorkommen`);
console.log(`Seltenstes (Platz 200): "${wordData[199]?.word}" mit ${wordData[199]?.count} Vorkommen`);


// =========================================
// BUBBLE-CHART-FUNKTION
// =========================================
//
// Zeichnet einen Force-Simulation-Bubble-Chart.
//
// Parameter:
//   containerId  - CSS-Selektor des SVG-Containers
//   data         - Array von { word, count }
//   options      - optional: { width, height, colorRange }
//
function createBubbleChart(containerId, data, options = {}) {
    // Größere viewBox füllt den Container voll aus
    const width = options.width || 1200;
    const height = options.height || 720;
    const colorRange = options.colorRange || ["#1e3a5f", "#22d3ee"];
    // dunkles Blau (selten) -> helles Cyan (häufig)

    // ----- BAUSTEIN 1: Skalen für Größe und Farbe -----
    // scaleSqrt: Quadratwurzel-Skala. Wichtig für Bubble-Größen, weil
    // das Auge Flächen wahrnimmt, nicht Radien. Bei linearer Skala
    // würden häufige Wörter "zu krass" rausstechen.
    const minCount = d3.min(data, d => d.count);
    const maxCount = d3.max(data, d => d.count);

    // Größere Bubbles, weil mehr Platz zur Verfügung steht
    const radiusScale = d3.scaleSqrt()
        .domain([0, maxCount])
        .range([4, 80]);  // min 4px (lesbar), max 80px

    // Farbskala: lineare Interpolation zwischen den beiden Range-Farben.
    // log-Skala wäre auch möglich, aber bei Wörtern reicht linear.
    const colorScale = d3.scaleSequential()
    .domain([minCount, maxCount])
    .interpolator(d3.interpolateTurbo);

    // Schriftgröße proportional zum Radius.
    // Min 8px (sonst unlesbar), Max scaliert mit Bubble-Größe.
    function fontSizeFor(d) {
        const r = radiusScale(d.count);
        return Math.max(8, Math.min(r / 2.4, 28));
    }

    // ----- BAUSTEIN 2: SVG aufsetzen -----
    d3.select(containerId).selectAll("*").remove();

    const svg = d3.select(containerId)
        .append("svg")
        .attr("viewBox", [0, 0, width, height])
        .attr("preserveAspectRatio", "xMidYMid meet")
        .attr("width", "100%")
        .style("height", "auto")
        .style("display", "block")
        .style("font-family", "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif")
        // cursor: grab signalisiert "draggable"
        .style("cursor", "grab");

    // ----- BAUSTEIN 3: Bubble-Gruppen erstellen -----
    // Jede Bubble ist eine <g>, die einen Kreis und Text enthält --
    // so können wir beides zusammen verschieben.
    const bubbles = svg.append("g")
        .selectAll("g")
        .data(data)
        .join("g");

    // Der Kreis selbst
    bubbles.append("circle")
        .attr("r", d => radiusScale(d.count))
        .attr("fill", d => colorScale(d.count))
        .attr("fill-opacity", 0.88)
        .attr("stroke", "#0a0e1a")
        .attr("stroke-width", 1.5)
        .style("transition", "fill-opacity 0.15s ease, stroke-width 0.15s ease");

    // Tooltip
    bubbles.append("title")
        .text(d => `${d.word}: ${d.count} Vorkommen`);

    // Wort-Label in der Mitte
    bubbles.append("text")
        .attr("text-anchor", "middle")     // horizontal zentriert
        .attr("dy", "0.35em")              // vertikal grob zentriert
        .attr("fill", d => {
            // d3.hsl().l gibt die Helligkeit (0 dunkel - 1 hell)
            const lightness = d3.hsl(colorScale(d.count)).l;
            return lightness > 0.55 ? "#0a0e1a" : "#fff";
        })
        .attr("font-weight", "600")
        .attr("letter-spacing", "-0.01em")
        .attr("font-size", d => fontSizeFor(d))
        .attr("pointer-events", "none")    // klick geht "durch" zum Kreis
        .text(d => d.word)
        // Verstecke Text, der nicht in die Bubble passt
        .style("display", function(d) {
            const r = radiusScale(d.count);
            const textWidth = this.getComputedTextLength();
            return textWidth > r * 1.8 ? "none" : null;
        });

    // Sanfter Hover-Effekt
    bubbles
        .on("mouseenter", function() {
            d3.select(this).select("circle")
                .attr("fill-opacity", 1)
                .attr("stroke-width", 2.5);
        })
        .on("mouseleave", function() {
            d3.select(this).select("circle")
                .attr("fill-opacity", 0.88)
                .attr("stroke-width", 1.5);
        });

    // ----- BAUSTEIN 4: Force-Simulation -----
    // Eine Simulation kombiniert mehrere Kräfte, die auf die Knoten wirken.
    // Bei jedem "tick" werden die Positionen neu berechnet.
    const simulation = d3.forceSimulation(data)
        // Stärkere Zentrierungskräfte: Bubbles füllen den verfügbaren Raum besser aus
        .force("x", d3.forceX(width / 2).strength(0.08))
        .force("y", d3.forceY(height / 2).strength(0.10))
        // Bubbles dürfen sich nicht überlappen.
        // +1.5 als Puffer für eine luftigere Optik.
        .force("collide", d3.forceCollide(d => radiusScale(d.count) + 1.5)
            .strength(0.92))
        // Bei jedem Tick: Positionen aller Bubbles aktualisieren.
        .on("tick", ticked);

    function ticked() {
        bubbles.attr("transform", d => `translate(${d.x},${d.y})`);
    }

    // ----- BAUSTEIN 5: Drag-Verhalten -----
    // d3.drag() handhabt Maus/Touch-Events automatisch.
    // Wir binden 3 Events: start, drag, end -- jeweils mit eigenem Verhalten.
    function dragstarted(event, d) {
        // alphaTarget: wie "warm" die Simulation läuft.
        // 0.3 reicht, damit Bewegung sichtbar ist, ohne dass alles fliegt.
        if (!event.active) simulation.alphaTarget(0.3).restart();
        // fx/fy: gefixte Position. Solange gesetzt, bleibt das Element dort.
        d.fx = d.x;
        d.fy = d.y;
        d3.select(this).select("circle")
            .attr("stroke", "#fff")
            .attr("stroke-width", 2);
        svg.style("cursor", "grabbing");
    }

    function dragged(event, d) {
        // Position folgt dem Mauszeiger
        d.fx = event.x;
        d.fy = event.y;
    }

    function dragended(event, d) {
        // Simulation wieder abkühlen lassen
        if (!event.active) simulation.alphaTarget(0);
        // fx/fy entfernen -> Element wird wieder von Kräften beeinflusst
        d.fx = null;
        d.fy = null;
        d3.select(this).select("circle")
            .attr("stroke", "#0a0e1a")
            .attr("stroke-width", 1.5)
            .attr("fill-opacity", 0.88);
        svg.style("cursor", "grab");
    }

    bubbles.call(d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended));

    // ----- BAUSTEIN 6: Klick-Highlight -----
    // Klick auf Bubble: kurze visuelle Hervorhebung
    bubbles.on("click", function(event, d) {
        // verhindern, dass der Klick auch als drag-end interpretiert wird
        const circle = d3.select(this).select("circle");
        circle.transition().duration(200)
            .attr("r", radiusScale(d.count) * 1.2)
            .transition().duration(200)
            .attr("r", radiusScale(d.count));
    });

    return { simulation };
}

// =========================================
// AUFRUF
// =========================================
createBubbleChart("#bubble-container", wordData);


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