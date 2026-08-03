/**
 * Generates every Read brand asset from the geometry in ./logo.mjs.
 *
 *   node scripts/brand/build.mjs
 *
 * Letterforms come from ./read-letters.path — the original Fraunces-based
 * "Read" outlines, kept so the typography stays continuous across the rebrand.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { PALETTE, markGeometry, markGroup, svgDocument } from "./logo.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const WEB_BRAND = path.join(root, "apps/web/public/brand");
const WEB_APP = path.join(root, "apps/web/src/app");
const MOBILE = path.join(root, "apps/mobile/assets");

const LETTERS = fs
  .readFileSync(path.join(here, "read-letters.path"), "utf8")
  .split("\n")
  .join(" ")
  .trim();

// Measured ink box of LETTERS in its original 823x354 user space.
const LETTERS_BOX = { x0: 49, x1: 657.8, y0: 49, y1: 305.5 };

const TONES = ["color", "ink", "white"];
const letterFill = (tone) =>
  tone === "white" ? PALETTE.white : PALETTE.ink;

/* ------------------------------------------------------------------ mark */

function markSvg(tone, { waves = 3, background = null, pad = 10 } = {}) {
  const geo = markGeometry({ waves, pad });
  return {
    geo,
    svg: svgDocument({
      width: geo.width,
      height: geo.height,
      body: markGroup(geo, tone),
      background,
    }),
  };
}

/** Mark centred in a square canvas, sized as a share of the canvas width. */
function markSquareSvg(tone, size, { background = null, fill = 0.62 } = {}) {
  const geo = markGeometry({ waves: 3, pad: 0 });
  const scale = (size * fill) / geo.ink.width;
  const w = geo.ink.width * scale;
  const h = geo.ink.height * scale;
  const tx = (size - w) / 2;
  const ty = (size - h) / 2;
  const body = markGroup(geo, tone, `translate(${tx} ${ty}) scale(${scale})`);
  return svgDocument({ width: size, height: size, body, background });
}

/* -------------------------------------------------------------- wordmark */

const LOCKUP = {
  /** Book height in wordmark units, against a 214 cap height. */
  bookHeight: 186,
  /** Gap between the "d" and the mark's leftmost ink. */
  gap: 40,
  /** Vertical centre of the mark, aligned to the lowercase optical centre. */
  centerY: 191,
  pad: 49,
  waves: 3,
};

function wordmarkGeometry() {
  const geo = markGeometry({ waves: LOCKUP.waves, pad: 10 });
  const scale = LOCKUP.bookHeight / geo.ink.height;
  const left = LETTERS_BOX.x1 + LOCKUP.gap;
  const top = LOCKUP.centerY - (geo.ink.height * scale) / 2;
  // markGroup's own offset places ink at exactly `pad`, so undo that here.
  const tx = left - scale * 10;
  const ty = top - scale * 10;
  const width = Math.round(left + geo.ink.width * scale + LOCKUP.pad);
  return { geo, scale, tx, ty, width, height: 354 };
}

function wordmarkSvg(tone, { background = null } = {}) {
  const { geo, scale, tx, ty, width, height } = wordmarkGeometry();
  const body = [
    `  <path d="${LETTERS}" fill="${letterFill(tone)}" fill-rule="evenodd"/>`,
    markGroup(geo, tone, `translate(${tx} ${ty}) scale(${scale})`),
  ].join("\n");
  return { svg: svgDocument({ width, height, body, background }), width, height };
}

/* ----------------------------------------------------------- backgrounds */

const GRADIENT = `  <defs>
    <linearGradient id="mist" x1="0" y1="0" x2="0.45" y2="1">
      <stop offset="0" stop-color="${PALETTE.mist}"/>
      <stop offset="0.48" stop-color="${PALETTE.mistDeep}"/>
      <stop offset="1" stop-color="#edf3f1"/>
    </linearGradient>
  </defs>`;

/** Wordmark centred on the mist gradient — hero and social cards. */
function bannerSvg(width, height, { fill = 0.66 } = {}) {
  const { geo, scale: baseScale, tx, ty, width: wmW, height: wmH } =
    wordmarkGeometry();
  const s = (width * fill) / wmW;
  const inner = [
    `    <path d="${LETTERS}" fill="${PALETTE.ink}" fill-rule="evenodd"/>`,
    markGroup(geo, "color", `translate(${tx} ${ty}) scale(${baseScale})`),
  ].join("\n");
  const ox = (width - wmW * s) / 2;
  const oy = (height - wmH * s) / 2;
  const body = `${GRADIENT}
  <rect width="${width}" height="${height}" fill="url(#mist)"/>
  <g transform="translate(${ox} ${oy}) scale(${s})">
${inner}
  </g>`;
  return svgDocument({ width, height, body });
}

/* ------------------------------------------------------------------ emit */

async function writeSvg(file, svg) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, svg);
  log(file);
}

async function writePng(file, svg, resize, { flatten = null } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Rasterise straight at the target size: librsvg is resolution-independent,
  // so scaling via density keeps edges crisp and avoids a huge intermediate.
  const declared = {
    width: Number(svg.match(/ width="([\d.]+)"/)[1]),
    height: Number(svg.match(/ height="([\d.]+)"/)[1]),
  };
  const ratio = resize.width
    ? resize.width / declared.width
    : resize.height / declared.height;
  let pipe = sharp(Buffer.from(svg), { density: 96 * ratio }).resize({
    ...resize,
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  // iOS rejects icons with an alpha channel.
  if (flatten) pipe = pipe.flatten({ background: flatten });
  await pipe.png({ compressionLevel: 9 }).toFile(file);
  log(file);
}

function log(file) {
  console.log("  " + path.relative(root, file));
}

async function main() {
  console.log("mark + wordmark");
  for (const tone of TONES) {
    const suffix = tone === "color" ? "" : `-${tone}`;

    const { svg: mark } = markSvg(tone);
    await writeSvg(path.join(WEB_BRAND, `read-mark${suffix}.svg`), mark);
    await writePng(path.join(WEB_BRAND, `read-mark${suffix}.png`), mark, {
      height: 512,
    });
    await writePng(path.join(MOBILE, `mark${suffix}.png`), mark, { height: 512 });

    const { svg: word } = wordmarkSvg(tone);
    await writeSvg(path.join(WEB_BRAND, `read-wordmark${suffix}.svg`), word);
    await writePng(path.join(WEB_BRAND, `read-wordmark${suffix}.png`), word, {
      height: 708,
    });
    await writePng(path.join(MOBILE, `wordmark${suffix}.png`), word, {
      height: 708,
    });
  }

  console.log("app icons");
  const iconSvg = (size) =>
    markSquareSvg("color", size, { background: PALETTE.mist, fill: 0.6 });
  await writePng(path.join(WEB_APP, "icon.png"), iconSvg(512), { width: 512 });
  await writePng(path.join(WEB_APP, "apple-icon.png"), iconSvg(180), {
    width: 180,
  });
  await writePng(
    path.join(MOBILE, "icon.png"),
    iconSvg(1024),
    { width: 1024 },
    { flatten: PALETTE.mist }
  );
  // Android trims the outer ~25%, so the foreground sits inside the safe zone.
  await writePng(
    path.join(MOBILE, "adaptive-icon.png"),
    markSquareSvg("color", 1024, { fill: 0.42 }),
    { width: 1024 }
  );

  console.log("hero / splash / social");
  await writePng(
    path.join(WEB_BRAND, "read-wordmark-hero.png"),
    bannerSvg(2000, 760, { fill: 0.7 }),
    { width: 2000 }
  );
  await writePng(
    path.join(WEB_BRAND, "og-image.png"),
    bannerSvg(1200, 630, { fill: 0.62 }),
    { width: 1200 }
  );
  const { svg: splashWord } = wordmarkSvg("color");
  await writePng(path.join(MOBILE, "splash.png"), splashWord, { width: 1200 });

  const { width, height } = wordmarkGeometry();
  console.log(`\nwordmark aspect ${width}/${height} = ${(width / height).toFixed(4)}`);
  const mg = markGeometry({ waves: 3 });
  console.log(`mark aspect     ${mg.width}/${mg.height} = ${(mg.width / mg.height).toFixed(4)}`);
}

main();
