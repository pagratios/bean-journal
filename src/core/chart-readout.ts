export type ChartReadoutRow = {
  label: string;
  colour: string;
  unit: string;
  value: string | null;
  other?: string | null;
  target?: string | null;
};

/** Self-contained so a plugin can serialize it into its browser client with toString(). */
export function createChartReadout(rows: readonly ChartReadoutRow[], comparison?: { current: string; other: string },
  target?: { current: string; target: string }) {
  const table = document.createElement("table");
  table.className = "chart-readout";
  const cell = (tag: "td" | "th", text: string, className = "") => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };
  if (comparison || target) {
    const head = document.createElement("thead"), row = document.createElement("tr");
    const heading = (text: string) => {
      const node = cell("th", text, "chart-readout-value");
      node.scope = "col";
      row.append(node);
    };
    row.append(cell("td", ""));
    if (comparison) heading(comparison.current);
    else if (target) heading(target.current);
    if (target) heading(target.target);
    if (comparison) heading(comparison.other);
    row.append(cell("td", ""));
    head.append(row);
    table.append(head);
  }
  const body = document.createElement("tbody");
  for (const data of rows) {
    if (data.value == null && (!comparison || data.other == null) && (!target || data.target == null)) continue;
    const row = document.createElement("tr");
    const label = cell("th", data.label, "chart-readout-label");
    label.scope = "row";
    const dot = document.createElement("i");
    dot.className = "chart-readout-dot";
    dot.style.background = data.colour;
    dot.setAttribute("aria-hidden", "true");
    label.prepend(dot);
    const value = cell("td", data.value ?? "\u2014", "chart-readout-value chart-readout-current");
    row.append(label, value);
    if (target) row.append(cell("td", data.target ?? "\u2014", "chart-readout-value"));
    if (comparison) row.append(cell("td", data.other ?? "\u2014", "chart-readout-value"));
    row.append(cell("td", data.unit, "chart-readout-unit"));
    body.append(row);
  }
  table.append(body);
  return table;
}

// One table shares column widths across headers and rows; units never move a number's right edge.
export const CHART_READOUT_CSS = `
.chart-readout{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;white-space:nowrap}
.chart-readout th,.chart-readout td{padding:0;font-weight:400}
.chart-readout .chart-readout-label{text-align:left}
.chart-readout .chart-readout-value{text-align:right;padding-left:0.667rem}
.chart-readout .chart-readout-current{font-weight:650}
.chart-readout thead{color:var(--muted)}
.chart-readout .chart-readout-unit{text-align:left;padding-left:0.333rem}
.chart-readout-dot{display:inline-block;width:0.533rem;height:0.533rem;border-radius:50%;margin-right:0.333rem;vertical-align:middle}
`;
