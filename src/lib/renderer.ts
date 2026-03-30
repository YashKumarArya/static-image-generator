    /**
 * Browser-native grid renderer.
 *
 * This is a direct port of the Node.js worker renderer
 * (`apps/worker/src/renderers/grid.ts`) to the browser Canvas API.
 * No server, no node-canvas, no sharp — everything runs client-side.
 */

import {
  IntegralImage,
  IntegralImageRGB,
  buildSigmoidLUT,
  hexToRgb,
  rgbToHsl,
  hslToRgb,
} from "./utils";

// ── Types ────────────────────────────────────────────────────────────

export interface PaletteEntry {
  color: string;
  count: number;
}

export interface GridRenderOptions {
  gridSize?: number;
  backgroundColor?: string;
  fillColor?: string;
  intensity?: number;
  colorMode?: boolean;
  lineWidth?: number;
  lineColor?: string;
  scale?: number;
  refined?: boolean;
}

export interface GridRenderResult {
  /** The rendered grid as a canvas element */
  canvas: HTMLCanvasElement;
  /** Paint-by-numbers companion canvas */
  pbnCanvas: HTMLCanvasElement;
  /** Palette entries sorted by frequency */
  palette: PaletteEntry[];
}

// ── Constants ────────────────────────────────────────────────────────

const MAX_PALETTE = 32;
const COLOR_DIST_SQ = 1200;
const PBN_GAP = 24;
const LEGEND_ROW_HEIGHT = 44;
const LEGEND_SWATCH = 28;
const LEGEND_PAD_X = 20;
const LEGEND_GAP = 28;
const LEGEND_COLS = 8;
const REFINED_MAX = 12;

// ── Depth LUT (pre-computed once) ────────────────────────────────────

interface DepthLUT {
  lightScale: Float64Array;
  satScale: Float64Array;
  coolR: Float64Array;
  coolG: Float64Array;
  coolB: Float64Array;
}

function buildDepthLUT(): DepthLUT {
  const lightScale = new Float64Array(256);
  const satScale = new Float64Array(256);
  const coolR = new Float64Array(256);
  const coolG = new Float64Array(256);
  const coolB = new Float64Array(256);

  for (let i = 0; i < 256; i++) {
    const d = i / 255;
    lightScale[i] = 1 - d * 0.85;
    let s = 1 + 0.2 * Math.sin(d * Math.PI * 0.9);
    if (d > 0.7) s *= 1 - ((d - 0.7) / 0.3) * 0.3;
    satScale[i] = s;

    if (d > 0.3) {
      const cool = (d - 0.3) * 0.07;
      coolR[i] = 1 - cool;
      coolG[i] = 1 - cool * 0.5;
      coolB[i] = cool * 25;
    } else {
      coolR[i] = 1;
      coolG[i] = 1;
      coolB[i] = 0;
    }
  }
  return { lightScale, satScale, coolR, coolG, coolB };
}

const DEPTH_LUT = buildDepthLUT();

// ── Palette extraction ───────────────────────────────────────────────

function extractPalette(
  pixels: Uint8ClampedArray,
  canvasWidth: number,
  canvasHeight: number,
  cellSize: number,
  maxColors: number,
): PaletteEntry[] {
  const cols = Math.ceil(canvasWidth / cellSize);
  const rows = Math.ceil(canvasHeight / cellSize);
  const exactCounts = new Map<number, number>();

  for (let row = 0; row < rows; row++) {
    const cy = Math.min(row * cellSize + (cellSize >> 1), canvasHeight - 1);
    for (let col = 0; col < cols; col++) {
      const cx = Math.min(col * cellSize + (cellSize >> 1), canvasWidth - 1);
      const idx = (cy * canvasWidth + cx) * 4;
      const key = (pixels[idx] << 16) | (pixels[idx + 1] << 8) | pixels[idx + 2];
      exactCounts.set(key, (exactCounts.get(key) ?? 0) + 1);
    }
  }

  const sorted = Array.from(exactCounts.entries())
    .map(([rgb, count]) => ({ r: (rgb >> 16) & 0xff, g: (rgb >> 8) & 0xff, b: rgb & 0xff, count }))
    .sort((a, b) => b.count - a.count);

  const accepted: { r: number; g: number; b: number; count: number }[] = [];
  for (const entry of sorted) {
    let merged = false;
    for (const rep of accepted) {
      const dr = entry.r - rep.r, dg = entry.g - rep.g, db = entry.b - rep.b;
      if (dr * dr + dg * dg + db * db < COLOR_DIST_SQ) {
        rep.count += entry.count;
        merged = true;
        break;
      }
    }
    if (!merged) {
      accepted.push({ ...entry });
      if (accepted.length >= maxColors) break;
    }
  }

  return accepted.map(({ r, g, b, count }) => ({
    color: `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`,
    count,
  }));
}

// ── Perceptual palette refinement ────────────────────────────────────

type ColorGroup = "dark" | "light" | "skin" | "accent";

function classifyColor(r: number, g: number, b: number): ColorGroup {
  const [h, s, l] = rgbToHsl(r, g, b);
  const hDeg = h * 360;
  if (l < 0.18) return "dark";
  if (l > 0.82) return "light";
  if (hDeg >= 5 && hDeg <= 45 && s >= 0.15 && s <= 0.75 && l >= 0.2 && l <= 0.8) return "skin";
  if (hDeg >= 20 && hDeg <= 50 && s >= 0.1 && l >= 0.55 && l <= 0.85) return "skin";
  return "accent";
}

const GROUP_BUDGET: Record<ColorGroup, number> = { skin: 3, dark: 2, light: 2, accent: 3 };

function refinePalette(rawPalette: PaletteEntry[]): PaletteEntry[] {
  const entries = rawPalette.map(p => {
    const [r, g, b] = hexToRgb(p.color);
    return { r, g, b, count: p.count, group: classifyColor(r, g, b) };
  });

  const groups: Record<ColorGroup, typeof entries> = { dark: [], light: [], skin: [], accent: [] };
  for (const e of entries) groups[e.group].push(e);
  for (const g of Object.values(groups)) g.sort((a, b) => b.count - a.count);

  const refined: PaletteEntry[] = [];

  for (const [group, budget] of Object.entries(GROUP_BUDGET) as [ColorGroup, number][]) {
    const members = groups[group];
    if (!members.length) continue;
    const distSq = group === "dark" ? 4000 : group === "light" ? 3000 : 2000;
    const accepted: { r: number; g: number; b: number; count: number }[] = [];

    for (const entry of members) {
      let merged = false;
      for (const rep of accepted) {
        const dr = entry.r - rep.r, dg = entry.g - rep.g, db = entry.b - rep.b;
        if (dr * dr + dg * dg + db * db < distSq) { rep.count += entry.count; merged = true; break; }
      }
      if (!merged) { accepted.push({ ...entry }); if (accepted.length >= budget) break; }
    }

    for (const { r, g, b, count } of accepted) {
      refined.push({ color: `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`, count });
    }
  }

  refined.sort((a, b) => b.count - a.count);
  return refined.length > REFINED_MAX ? refined.slice(0, REFINED_MAX) : refined;
}

function rerenderWithRefinedPalette(
  ctx: CanvasRenderingContext2D,
  pixels: Uint8ClampedArray,
  canvasWidth: number,
  canvasHeight: number,
  cellPx: number,
  palette: PaletteEntry[],
  lineWidth: number,
  lineColor: string,
): void {
  const cols = Math.ceil(canvasWidth / cellPx);
  const rows = Math.ceil(canvasHeight / cellPx);
  const palRGB = palette.map(p => hexToRgb(p.color));

  for (let row = 0; row < rows; row++) {
    const cy = Math.min(row * cellPx + (cellPx >> 1), canvasHeight - 1);
    for (let col = 0; col < cols; col++) {
      const cx = Math.min(col * cellPx + (cellPx >> 1), canvasWidth - 1);
      const idx = (cy * canvasWidth + cx) * 4;
      const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];
      let bestDist = Infinity, bestIdx = 0;
      for (let i = 0; i < palRGB.length; i++) {
        const [pr, pg, pb] = palRGB[i];
        const dr = r - pr, dg = g - pg, db = b - pb;
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      ctx.fillStyle = palette[bestIdx].color;
      ctx.fillRect(col * cellPx, row * cellPx, cellPx, cellPx);
    }
  }

  if (lineWidth > 0) {
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    const halfPx = lineWidth % 2 === 1 ? 0.5 : 0;
    for (let c = 0; c <= cols; c++) { const x = c * cellPx + halfPx; ctx.moveTo(x, 0); ctx.lineTo(x, canvasHeight); }
    for (let r = 0; r <= rows; r++) { const y = r * cellPx + halfPx; ctx.moveTo(0, y); ctx.lineTo(canvasWidth, y); }
    ctx.stroke();
  }
}

// ── Paint-by-numbers ─────────────────────────────────────────────────

function buildNumberMap(
  pixels: Uint8ClampedArray,
  canvasWidth: number,
  canvasHeight: number,
  cellSize: number,
  palette: PaletteEntry[],
): number[][] {
  const cols = Math.ceil(canvasWidth / cellSize);
  const rows = Math.ceil(canvasHeight / cellSize);
  const palRGB = palette.map(p => hexToRgb(p.color));
  const map: number[][] = [];

  for (let row = 0; row < rows; row++) {
    const cy = Math.min(row * cellSize + (cellSize >> 1), canvasHeight - 1);
    const rowMap: number[] = [];
    for (let col = 0; col < cols; col++) {
      const cx = Math.min(col * cellSize + (cellSize >> 1), canvasWidth - 1);
      const idx = (cy * canvasWidth + cx) * 4;
      const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];
      let bestDist = Infinity, bestIdx = 0;
      for (let i = 0; i < palRGB.length; i++) {
        const [pr, pg, pb] = palRGB[i];
        const dr = r - pr, dg = g - pg, db = b - pb;
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      rowMap.push(bestIdx + 1);
    }
    map.push(rowMap);
  }
  return map;
}

function renderPaintByNumbers(
  coloredImageData: ImageData,
  canvasWidth: number,
  canvasHeight: number,
  cellPx: number,
  palette: PaletteEntry[],
  scaledLineWidth: number,
  lineColor: string,
  backgroundColor: string,
): HTMLCanvasElement {
  const cols = Math.ceil(canvasWidth / cellPx);
  const rows = Math.ceil(canvasHeight / cellPx);
  const numberMap = buildNumberMap(coloredImageData.data, canvasWidth, canvasHeight, cellPx, palette);

  const legendCols = Math.min(palette.length, LEGEND_COLS);
  const legendRows = Math.ceil(palette.length / LEGEND_COLS);
  const legendHeight = LEGEND_GAP + 24 + legendRows * LEGEND_ROW_HEIGHT + 16;

  const totalWidth = canvasWidth + PBN_GAP + canvasWidth;
  const totalHeight = canvasHeight + legendHeight;

  const pbnCanvas = document.createElement("canvas");
  pbnCanvas.width = totalWidth;
  pbnCanvas.height = totalHeight;
  const pbnCtx = pbnCanvas.getContext("2d")!;
  pbnCtx.imageSmoothingEnabled = false;

  // White background
  pbnCtx.fillStyle = "#ffffff";
  pbnCtx.fillRect(0, 0, totalWidth, totalHeight);

  // Left: colored grid
  pbnCtx.putImageData(coloredImageData, 0, 0);

  // Right: empty numbered grid
  const ox = canvasWidth + PBN_GAP;
  pbnCtx.fillStyle = backgroundColor;
  pbnCtx.fillRect(ox, 0, canvasWidth, canvasHeight);

  if (scaledLineWidth > 0) {
    pbnCtx.strokeStyle = lineColor;
    pbnCtx.lineWidth = scaledLineWidth;
    pbnCtx.beginPath();
    const halfPx = scaledLineWidth % 2 === 1 ? 0.5 : 0;
    for (let c = 0; c <= cols; c++) { const x = ox + c * cellPx + halfPx; pbnCtx.moveTo(x, 0); pbnCtx.lineTo(x, canvasHeight); }
    for (let r = 0; r <= rows; r++) { const y = r * cellPx + halfPx; pbnCtx.moveTo(ox, y); pbnCtx.lineTo(ox + canvasWidth, y); }
    pbnCtx.stroke();
  }

  // Numbers
  const fontSize = Math.max(7, Math.min(cellPx * 0.5, 22));
  pbnCtx.fillStyle = "#444444";
  pbnCtx.font = `bold ${fontSize}px monospace`;
  pbnCtx.textAlign = "center";
  pbnCtx.textBaseline = "middle";

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const num = numberMap[row][col];
      const cx = ox + col * cellPx + cellPx / 2;
      const cy = row * cellPx + cellPx / 2;
      pbnCtx.fillText(String(num), cx, cy);
    }
  }

  // Legend
  const legendY = canvasHeight + LEGEND_GAP;
  pbnCtx.fillStyle = "#111111";
  pbnCtx.font = "bold 18px sans-serif";
  pbnCtx.textAlign = "left";
  pbnCtx.textBaseline = "top";
  pbnCtx.fillText("Color Key", LEGEND_PAD_X, legendY);

  const itemStartY = legendY + 28;
  const itemWidth = Math.floor((totalWidth - LEGEND_PAD_X * 2) / legendCols);

  for (let i = 0; i < palette.length; i++) {
    const lCol = i % LEGEND_COLS;
    const lRow = Math.floor(i / LEGEND_COLS);
    const x = LEGEND_PAD_X + lCol * itemWidth;
    const y = itemStartY + lRow * LEGEND_ROW_HEIGHT;

    pbnCtx.fillStyle = palette[i].color;
    pbnCtx.fillRect(x, y + 4, LEGEND_SWATCH, LEGEND_SWATCH);
    pbnCtx.strokeStyle = "#999999";
    pbnCtx.lineWidth = 1;
    pbnCtx.strokeRect(x, y + 4, LEGEND_SWATCH, LEGEND_SWATCH);

    pbnCtx.fillStyle = "#222222";
    pbnCtx.font = "bold 14px monospace";
    pbnCtx.textAlign = "left";
    pbnCtx.textBaseline = "middle";
    pbnCtx.fillText(`${i + 1}  ${palette[i].color}`, x + LEGEND_SWATCH + 8, y + 4 + LEGEND_SWATCH / 2);
  }

  return pbnCanvas;
}

// ── Image preprocessing (replaces sharp) ─────────────────────────────

/**
 * Load an image file, optionally resize to maxDimension, and extract
 * raw pixel data (grayscale + RGB).  All done in-browser.
 */
export async function preprocessImage(
  file: File,
  maxDimension: number = 2000,
  contrast: number = 1.0,
  brightness: number = 1.0,
): Promise<{
  grayscale: Uint8Array;
  rgb: Uint8Array;
  width: number;
  height: number;
}> {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;

  // Resize if needed
  const ratio = Math.min(maxDimension / width, maxDimension / height, 1);
  if (ratio < 1) {
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  // Apply contrast + brightness via CSS filter
  ctx.filter = `contrast(${contrast}) brightness(${brightness})`;
  ctx.drawImage(bitmap, 0, 0, width, height);
  ctx.filter = "none";

  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data; // RGBA

  // Extract grayscale and RGB arrays
  const grayscale = new Uint8Array(width * height);
  const rgb = new Uint8Array(width * height * 3);

  for (let i = 0; i < width * height; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    grayscale[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
  }

  return { grayscale, rgb, width, height };
}

// ── Main grid renderer ───────────────────────────────────────────────

export function renderGrid(
  pixelData: Uint8Array,
  width: number,
  height: number,
  options: GridRenderOptions = {},
  rgbData?: Uint8Array,
): GridRenderResult {
  const {
    gridSize = 10,
    backgroundColor = "#ffffff",
    fillColor = "#000000",
    intensity = 5,
    colorMode = true,
    lineWidth = 1,
    lineColor = "#2a2a2a",
    scale = 2,
    refined = false,
  } = options;

  const cols = Math.ceil(width / gridSize);
  const rows = Math.ceil(height / gridSize);
  const cellPx = gridSize * scale;
  const canvasWidth = cols * cellPx;
  const canvasHeight = rows * cellPx;

  const sat = new IntegralImage(pixelData, width, height);
  const satRGB = colorMode && rgbData ? new IntegralImageRGB(rgbData, width, height) : null;
  const toneLUT = buildSigmoidLUT(intensity);

  const [bgR, bgG, bgB] = hexToRgb(backgroundColor);
  const [fR, fG, fB] = hexToRgb(fillColor);

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  // Fill background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const { lightScale, satScale, coolR, coolG, coolB } = DEPTH_LUT;

  // Step 1: Fill each cell
  for (let row = 0; row < rows; row++) {
    const srcY = row * gridSize;
    const cellH = Math.min(gridSize, height - srcY);

    for (let col = 0; col < cols; col++) {
      const srcX = col * gridSize;
      const cellW = Math.min(gridSize, width - srcX);

      const brightness = sat.average(srcX, srcY, cellW, cellH);
      const darkF = toneLUT[(brightness + 0.5) | 0];
      const darkIdx = (darkF * 255 + 0.5) | 0;

      let r: number, g: number, b: number;

      if (satRGB) {
        const [cr, cg, cb] = satRGB.average(srcX, srcY, cellW, cellH);
        let [h, s, l] = rgbToHsl(cr, cg, cb);
        l *= lightScale[darkIdx];
        s = Math.min(1, s * satScale[darkIdx]);
        const [outR, outG, outB] = hslToRgb(h, s, l);
        r = outR * coolR[darkIdx];
        g = outG * coolG[darkIdx];
        b = Math.min(255, outB + coolB[darkIdx]);
      } else {
        r = bgR + (fR - bgR) * darkF;
        g = bgG + (fG - bgG) * darkF;
        b = bgB + (fB - bgB) * darkF;
      }

      const rr = (r + 0.5) | 0, gg = (g + 0.5) | 0, bb = (b + 0.5) | 0;
      ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
      ctx.fillRect(col * cellPx, row * cellPx, cellPx, cellPx);
    }
  }

  // Step 2: Grid lines
  const scaledLineWidth = lineWidth * scale;
  if (scaledLineWidth > 0) {
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = scaledLineWidth;
    ctx.beginPath();
    const halfPx = scaledLineWidth % 2 === 1 ? 0.5 : 0;
    for (let c = 0; c <= cols; c++) { const x = c * cellPx + halfPx; ctx.moveTo(x, 0); ctx.lineTo(x, canvasHeight); }
    for (let r = 0; r <= rows; r++) { const y = r * cellPx + halfPx; ctx.moveTo(0, y); ctx.lineTo(canvasWidth, y); }
    ctx.stroke();
  }

  // Step 3: Palette
  let imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  let palette = extractPalette(imageData.data, canvasWidth, canvasHeight, cellPx, MAX_PALETTE);

  // Step 4: Optional refine
  if (refined) {
    palette = refinePalette(palette);
    rerenderWithRefinedPalette(ctx, imageData.data, canvasWidth, canvasHeight, cellPx, palette, scaledLineWidth, lineColor);
    imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
    palette = extractPalette(imageData.data, canvasWidth, canvasHeight, cellPx, REFINED_MAX);
  }

  // Step 5: Paint-by-numbers
  const pbnCanvas = renderPaintByNumbers(imageData, canvasWidth, canvasHeight, cellPx, palette, scaledLineWidth, lineColor, backgroundColor);

  return { canvas, pbnCanvas, palette };
}

// ── Download helper ──────────────────────────────────────────────────

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}
