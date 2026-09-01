/**
 * Read brand mark geometry — single source of truth.
 *
 * Open book with two soft listening arcs — refined from the original mark
 * with thinner strokes and fewer arcs. Used for favicon / login / app icon;
 * the header wordmark is typography-only (Fraunces "Read").
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

const SPINE_X = 52;
const PAGE_W = 36;
const OUTER_TOP = 18;
const OUTER_BOTTOM = 88;
const SPINE_TOP = 38;
const SPINE_BOTTOM = 108;
const STROKE = 7;
const HALF = STROKE / 2;

const LEFT_X = SPINE_X - PAGE_W;
const RIGHT_X = SPINE_X + PAGE_W;

const ARC_CX = RIGHT_X;
const ARC_CY = 56;
const ARC_RADII = [20, 36];
const ARC_HALF_ANGLE = (44 * Math.PI) / 180;
const ARC_OPACITY = [0.75, 0.4];

const bookPaths = [
  `M ${LEFT_X} ${OUTER_TOP} C ${LEFT_X + 16} ${OUTER_TOP} ${SPINE_X - 6} ${OUTER_TOP + 6} ${SPINE_X} ${SPINE_TOP} L ${SPINE_X} ${SPINE_BOTTOM} C ${SPINE_X - 6} ${SPINE_BOTTOM - 12} ${LEFT_X + 16} ${OUTER_BOTTOM} ${LEFT_X} ${OUTER_BOTTOM}`,
  `M ${RIGHT_X} ${OUTER_TOP} C ${RIGHT_X - 16} ${OUTER_TOP} ${SPINE_X + 6} ${OUTER_TOP + 6} ${SPINE_X} ${SPINE_TOP} L ${SPINE_X} ${SPINE_BOTTOM} C ${SPINE_X + 6} ${SPINE_BOTTOM - 12} ${RIGHT_X - 16} ${OUTER_BOTTOM} ${RIGHT_X} ${OUTER_BOTTOM}`,
];

function arcPath(r) {
  const dx = Math.cos(ARC_HALF_ANGLE) * r;
  const dy = Math.sin(ARC_HALF_ANGLE) * r;
  const x = round(ARC_CX + dx);
  return `M ${x} ${round(ARC_CY - dy)} A ${r} ${r} 0 0 1 ${x} ${round(ARC_CY + dy)}`;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {{ waves?: number, pad?: number }} [opts] waves: listening arcs (1–2).
 */
export function markGeometry({ waves = ARC_RADII.length, pad = 14 } = {}) {
  const radii = ARC_RADII.slice(0, waves);
  const outerR = radii.length ? radii[radii.length - 1] : 0;

  const inkLeft = LEFT_X - HALF;
  const inkRight = Math.max(RIGHT_X, ARC_CX + outerR) + HALF;
  const inkTop = OUTER_TOP - HALF;
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
    book: bookPaths,
    arcs: radii.map((r, i) => ({ d: arcPath(r), opacity: ARC_OPACITY[i] })),
  };
}

/** Strokes for the mark, in one of the three brand tones. */
export function markColors(tone) {
  const book =
    tone === "ink"
      ? PALETTE.ink
      : tone === "white"
        ? PALETTE.white
        : PALETTE.sage;
  const arc = tone === "color" ? PALETTE.sageDeep : book;
  return { book, arc };
}

/** Inner `<g>` of the mark, ready to drop into any canvas. */
export function markGroup(geo, tone, extraTransform = "") {
  const { book, arc } = markColors(tone);
  const transform =
    `${extraTransform} translate(${geo.offset.x} ${geo.offset.y})`.trim();
  const common = `fill="none" stroke-width="${geo.stroke}" stroke-linecap="round" stroke-linejoin="round"`;
  const pages = geo.book
    .map((d) => `    <path d="${d}" stroke="${book}" ${common}/>`)
    .join("\n");
  const arcs = geo.arcs
    .map(
      (a) =>
        `    <path d="${a.d}" stroke="${arc}" stroke-opacity="${a.opacity}" ${common}/>`
    )
    .join("\n");
  return `  <g transform="${transform}">\n${pages}\n${arcs}\n  </g>`;
}

export function svgDocument({ width, height, body, background }) {
  const bg = background
    ? `  <rect width="${width}" height="${height}" fill="${background}"/>\n`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">\n${bg}${body}\n</svg>\n`;
}
