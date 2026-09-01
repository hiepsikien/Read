/**
 * Read brand mark geometry — single source of truth.
 *
 * "The Arch" — an upright open book whose left page carries reading lines
 * and whose right edge radiates equalizer bars for listen/TTS. Replaces the
 * previous horizontal book + sound-wave arcs.
 */

export const PALETTE = {
  ink: "#14221c",
  sage: "#3f6f5c",
  sageDeep: "#2c5344",
  mist: "#e7eef0",
  mistDeep: "#d5e2dd",
  paper: "#f3f7f5",
  white: "#ffffff",
};

const SPINE_X = 58;
const SPINE_BOTTOM = 102;
const SPINE_TOP = 26;
const LEFT_X = 10;
const RIGHT_X = 106;
const TOP_Y = 10;
const STROKE = 8;
const HALF = STROKE / 2;
const DETAIL_STROKE = 5;

const bookPaths = [
  `M ${LEFT_X} ${TOP_Y + 8} C ${LEFT_X + 2} ${TOP_Y} ${SPINE_X - 10} ${SPINE_TOP - 6} ${SPINE_X} ${SPINE_TOP} L ${SPINE_X} ${SPINE_BOTTOM} C ${SPINE_X - 10} ${SPINE_BOTTOM - 10} ${LEFT_X + 8} ${SPINE_BOTTOM - 6} ${LEFT_X} ${SPINE_BOTTOM - 16}`,
  `M ${RIGHT_X} ${TOP_Y + 8} C ${RIGHT_X - 2} ${TOP_Y} ${SPINE_X + 10} ${SPINE_TOP - 6} ${SPINE_X} ${SPINE_TOP} L ${SPINE_X} ${SPINE_BOTTOM} C ${SPINE_X + 10} ${SPINE_BOTTOM - 10} ${RIGHT_X - 8} ${SPINE_BOTTOM - 6} ${RIGHT_X} ${SPINE_BOTTOM - 16}`,
];

const readingLines = [
  [LEFT_X + 16, 50, LEFT_X + 42, 50],
  [LEFT_X + 16, 62, LEFT_X + 38, 62],
  [LEFT_X + 16, 74, LEFT_X + 32, 74],
].map(([x1, y1, x2, y2]) => `M ${x1} ${y1} L ${x2} ${y2}`);

const equalizerBars = [
  { x: RIGHT_X + 8, y0: 54, y1: 66, opacity: 0.45 },
  { x: RIGHT_X + 16, y0: 46, y1: 74, opacity: 0.72 },
  { x: RIGHT_X + 24, y0: 40, y1: 80, opacity: 1 },
];

const bookmark = `M ${SPINE_X - 5} ${SPINE_TOP - 2} L ${SPINE_X} ${SPINE_TOP - 14} L ${SPINE_X + 5} ${SPINE_TOP - 2} Z`;

function round(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {{ waves?: number, pad?: number }} [opts] waves: how many equalizer
 * bars to draw. Kept for lockup API compatibility with build.mjs.
 */
export function markGeometry({ waves = equalizerBars.length, pad = 10 } = {}) {
  const barCount = Math.min(waves, equalizerBars.length);
  const bars = equalizerBars.slice(0, barCount).map(({ x, y0, y1, opacity }) => ({
    d: `M ${x} ${y0} L ${x} ${y1}`,
    opacity,
  }));
  const outerX =
    barCount > 0
      ? equalizerBars[barCount - 1].x + DETAIL_STROKE / 2
      : RIGHT_X;

  const inkLeft = LEFT_X - HALF;
  const inkRight = outerX + HALF + 2;
  const inkTop = TOP_Y - HALF - 14;
  const inkBottom = SPINE_BOTTOM + HALF;

  const ox = pad - inkLeft;
  const oy = pad - inkTop;

  return {
    width: round(inkRight - inkLeft + pad * 2),
    height: round(inkBottom - inkTop + pad * 2),
    offset: { x: round(ox), y: round(oy) },
    ink: {
      width: round(inkRight - inkLeft),
      height: round(inkBottom - inkTop),
    },
    stroke: STROKE,
    detailStroke: DETAIL_STROKE,
    book: bookPaths,
    reading: readingLines,
    equalizer: bars,
    bookmark,
  };
}

/** Strokes for the mark, in one of the three brand tones. */
export function markColors(tone) {
  const main =
    tone === "ink"
      ? PALETTE.ink
      : tone === "white"
        ? PALETTE.white
        : PALETTE.sage;
  const accent = tone === "color" ? PALETTE.sageDeep : main;
  return { main, accent };
}

/** Inner `<g>` of the mark, ready to drop into any canvas. */
export function markGroup(geo, tone, extraTransform = "") {
  const { main, accent } = markColors(tone);
  const transform =
    `${extraTransform} translate(${geo.offset.x} ${geo.offset.y})`.trim();
  const common = `fill="none" stroke-width="${geo.stroke}" stroke-linecap="round" stroke-linejoin="round"`;
  const detail = `fill="none" stroke-width="${geo.detailStroke}" stroke-linecap="round"`;
  const book = geo.book
    .map((d) => `    <path d="${d}" stroke="${main}" ${common}/>`)
    .join("\n");
  const lines = geo.reading
    .map(
      (d) =>
        `    <path d="${d}" stroke="${accent}" stroke-opacity="0.85" ${detail}/>`
    )
    .join("\n");
  const bars = geo.equalizer
    .map(
      (a) =>
        `    <path d="${a.d}" stroke="${main}" stroke-opacity="${a.opacity}" ${detail}/>`
    )
    .join("\n");
  const bm = `    <path d="${geo.bookmark}" fill="${accent}" stroke="none"/>`;
  return `  <g transform="${transform}">\n${book}\n${lines}\n${bars}\n${bm}\n  </g>`;
}

export function svgDocument({ width, height, body, background }) {
  const bg = background
    ? `  <rect width="${width}" height="${height}" fill="${background}"/>\n`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">\n${bg}${body}\n</svg>\n`;
}
