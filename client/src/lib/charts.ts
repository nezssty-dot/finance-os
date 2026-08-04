/**
 * Gráficos en SVG para los reportes en PDF. PURO: devuelven un string, sin DOM ni red.
 *
 * Se hacen en SVG a mano y no con una librería de gráficos por dos razones concretas:
 * imprimen nítido a cualquier resolución (son vectores) y no agregan ninguna dependencia
 * al bundle. Un PDF que va a un contador tiene que verse impecable impreso.
 */

export interface Slice {
  label: string;
  value: number;
  color: string;
}

const TAU = Math.PI * 2;

/** Escapa texto para que un nombre con "&" o "<" no rompa el SVG. */
export function escapeSvg(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Gráfico de dona. Usa stroke-dasharray sobre círculos: cada porción es un arco.
 * Es la técnica más robusta para imprimir (no depende de paths calculados a mano).
 *
 * Devuelve "" si no hay datos con valor: un gráfico vacío es peor que ninguno.
 */
export function donutChart(
  slices: Slice[],
  opts: { size?: number; thickness?: number; centerLabel?: string } = {}
): string {
  const size = opts.size ?? 180;
  const thickness = opts.thickness ?? 26;
  const valid = slices.filter((s) => Number.isFinite(s.value) && s.value > 0);
  const total = valid.reduce((sum, s) => sum + s.value, 0);
  if (!valid.length || total <= 0) return "";

  const r = (size - thickness) / 2;
  const c = size / 2;
  const circumference = TAU * r;

  let offset = 0;
  const arcs = valid
    .map((s) => {
      const fraction = s.value / total;
      const len = fraction * circumference;
      const arc = `<circle cx="${c}" cy="${c}" r="${r}" fill="none"
        stroke="${s.color}" stroke-width="${thickness}"
        stroke-dasharray="${len.toFixed(2)} ${(circumference - len).toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}"
        transform="rotate(-90 ${c} ${c})" />`;
      offset += len;
      return arc;
    })
    .join("\n");

  const center = opts.centerLabel
    ? `<text x="${c}" y="${c + 4}" text-anchor="middle"
        font-size="13" font-weight="700" fill="#14141a"
        font-family="system-ui, sans-serif">${escapeSvg(opts.centerLabel)}</text>`
    : "";

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
${arcs}
${center}
</svg>`;
}

/**
 * Gráfico de barras horizontales con etiqueta y monto. Cada barra se escala contra el
 * valor más grande, así la más alta siempre llena el ancho y se comparan de un vistazo.
 */
export function barChart(
  items: Slice[],
  opts: { width?: number; rowHeight?: number; formatValue?: (n: number) => string } = {}
): string {
  const width = opts.width ?? 480;
  const rowHeight = opts.rowHeight ?? 30;
  const fmt = opts.formatValue ?? ((n: number) => String(n));
  const valid = items.filter((s) => Number.isFinite(s.value) && s.value > 0);
  if (!valid.length) return "";

  const max = Math.max(...valid.map((s) => s.value));
  const labelW = 108;
  const valueW = 92;
  const trackW = width - labelW - valueW - 16;
  const height = valid.length * rowHeight;

  const rows = valid
    .map((s, i) => {
      const y = i * rowHeight;
      const barW = max > 0 ? Math.max(2, (s.value / max) * trackW) : 0;
      return `<g transform="translate(0 ${y})">
  <text x="0" y="15" font-size="10.5" font-weight="600" fill="#3f3f46"
        font-family="system-ui, sans-serif">${escapeSvg(s.label)}</text>
  <rect x="${labelW}" y="5" width="${trackW}" height="11" rx="5.5" fill="#f1f1f3" />
  <rect x="${labelW}" y="5" width="${barW.toFixed(1)}" height="11" rx="5.5" fill="${s.color}" />
  <text x="${width}" y="15" text-anchor="end" font-size="10.5" font-weight="700" fill="#14141a"
        font-family="ui-monospace, monospace">${escapeSvg(fmt(s.value))}</text>
</g>`;
    })
    .join("\n");

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
${rows}
</svg>`;
}

/**
 * Barra comparativa ingresos vs gastos. Muestra de un vistazo si el mes cerró en verde
 * o en rojo, que es la primera pregunta que se hace cualquiera al abrir el reporte.
 */
export function incomeVsExpenseBar(
  income: number,
  expense: number,
  opts: { width?: number; format?: (n: number) => string } = {}
): string {
  const width = opts.width ?? 480;
  const fmt = opts.format ?? ((n: number) => String(n));
  const max = Math.max(income, expense, 1);
  const trackW = width - 120;

  const row = (label: string, value: number, color: string, y: number) => {
    const w = Math.max(2, (value / max) * trackW);
    return `<g transform="translate(0 ${y})">
  <text x="0" y="14" font-size="10.5" font-weight="600" fill="#3f3f46"
        font-family="system-ui, sans-serif">${label}</text>
  <rect x="72" y="4" width="${trackW}" height="13" rx="6.5" fill="#f1f1f3" />
  <rect x="72" y="4" width="${w.toFixed(1)}" height="13" rx="6.5" fill="${color}" />
  <text x="${width}" y="14" text-anchor="end" font-size="10.5" font-weight="700"
        fill="${color}" font-family="ui-monospace, monospace">${escapeSvg(fmt(value))}</text>
</g>`;
  };

  return `<svg width="${width}" height="46" viewBox="0 0 ${width} 46" xmlns="http://www.w3.org/2000/svg">
${row("Ingresos", income, "#157347", 0)}
${row("Gastos", expense, "#b02a26", 24)}
</svg>`;
}
