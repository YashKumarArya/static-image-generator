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

export type RenderMode =
  | "standard"
  | "dithered"
  | "artistic"
  | "halftone"
  | "mosaic"
  | "watercolor"
  | "crosshatch"
  | "pointillist";

export type CellShape = "square" | "circle" | "diamond" | "triangle" | "hexagon";
export type ExportFormat = "png" | "jpeg" | "svg";
export type PaletteHarmony = "auto" | "complementary" | "analogous" | "triadic" | "monochromatic";

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
  renderMode?: RenderMode;
  colorVariation?: number;
  // New options
  cellShape?: CellShape;
  saturation?: number;
  edgeEnhance?: number;
  blur?: number;
  paletteHarmony?: PaletteHarmony;
  customPalette?: string[];
}

export interface GridRenderResult {
  /** The rendered grid as a canvas element */
  canvas: HTMLCanvasElement;
  /** Paint-by-numbers companion canvas */
  pbnCanvas: HTMLCanvasElement;
  /** Palette entries sorted by frequency */
  palette: PaletteEntry[];
}

// ── Presets ──────────────────────────────────────────────────────────

export interface Preset {
  name: string;
  description: string;
  options: Partial<GridRenderOptions> & { contrast?: number; brightness?: number };
}

export const PRESETS: Preset[] = [
  {
    name: "Classic Grid",
    description: "Clean grid with original colors",
    options: { gridSize: 10, renderMode: "standard", colorMode: true, lineWidth: 1, intensity: 5, colorVariation: 0.1, cellShape: "square" },
  },
  {
    name: "Pixel Art",
    description: "Chunky retro pixel look",
    options: { gridSize: 16, renderMode: "standard", colorMode: true, lineWidth: 0, intensity: 7, colorVariation: 0, cellShape: "square", saturation: 1.3 },
  },
  {
    name: "Halftone Print",
    description: "Newspaper-style dot pattern",
    options: { gridSize: 8, renderMode: "halftone", colorMode: true, lineWidth: 0, intensity: 6, cellShape: "circle", backgroundColor: "#ffffff" },
  },
  {
    name: "Watercolor Dream",
    description: "Soft, painterly effect",
    options: { gridSize: 14, renderMode: "watercolor", colorMode: true, lineWidth: 0, intensity: 4, colorVariation: 0.25, blur: 0.4, saturation: 0.85 },
  },
  {
    name: "Mosaic Tile",
    description: "Stone mosaic with grouted gaps",
    options: { gridSize: 12, renderMode: "mosaic", colorMode: true, lineWidth: 2, lineColor: "#8b7355", intensity: 5, cellShape: "square", colorVariation: 0.2 },
  },
  {
    name: "Crosshatch Sketch",
    description: "Pen sketch style crosshatching",
    options: { gridSize: 10, renderMode: "crosshatch", colorMode: false, lineWidth: 0, intensity: 6, fillColor: "#1a1a1a", backgroundColor: "#f5f0e8" },
  },
  {
    name: "Pointillist",
    description: "Seurat-style painted dots",
    options: { gridSize: 6, renderMode: "pointillist", colorMode: true, lineWidth: 0, intensity: 5, colorVariation: 0.3, saturation: 1.4, cellShape: "circle" },
  },
  {
    name: "High Contrast BW",
    description: "Bold black & white grid",
    options: { gridSize: 8, renderMode: "dithered", colorMode: false, lineWidth: 1, intensity: 8, fillColor: "#000000", backgroundColor: "#ffffff", contrast: 1.6 },
  },
  {
    name: "Neon Glow",
    description: "Vibrant colors with dark background",
    options: { gridSize: 10, renderMode: "artistic", colorMode: true, lineWidth: 1, lineColor: "#111111", intensity: 6, colorVariation: 0.35, saturation: 1.6, backgroundColor: "#0a0a0a" },
  },
  {
    name: "Diamond Tiles",
    description: "Diamond-shaped tile pattern",
    options: { gridSize: 12, renderMode: "standard", colorMode: true, lineWidth: 0, intensity: 5, cellShape: "diamond", colorVariation: 0.1 },
  },
  {
    name: "Honeycomb",
    description: "Hexagonal cell pattern",
    options: { gridSize: 14, renderMode: "standard", colorMode: true, lineWidth: 1, lineColor: "#666666", intensity: 5, cellShape: "hexagon", colorVariation: 0.1 },
  },
  {
    name: "Soft Pastel",
    description: "Light pastel tones",
    options: { gridSize: 12, renderMode: "standard", colorMode: true, lineWidth: 1, intensity: 3, saturation: 0.5, colorVariation: 0.15, brightness: 1.3 },
  },
];

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
    lightScale[i] = 0.15 + d * 0.85; // Wider range, less floor darkening
    let s = 1 + 0.2 * Math.sin(d * Math.PI);
    if (d > 0.7) s *= 1 - ((d - 0.7) / 0.3) * 0.15;
    satScale[i] = s;

    // Heavily reduced cool shift — was killing brightness in mid-tones
    if (d > 0.6) {
      const cool = (d - 0.6) * 0.05;
      coolR[i] = 1 - cool * 0.3;
      coolG[i] = 1 - cool * 0.15;
      coolB[i] = cool * 10;
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

  // Pre-compute palette as packed ABGR pixels for Uint32Array
  const palPixels = palRGB.map(([r, g, b]) => (255 << 24) | (b << 16) | (g << 8) | r);
  const refineBuffer = ctx.createImageData(canvasWidth, canvasHeight);
  const data32 = new Uint32Array(refineBuffer.data.buffer);

  for (let row = 0; row < rows; row++) {
    const cy = Math.min(row * cellPx + (cellPx >> 1), canvasHeight - 1);
    const pyStart = row * cellPx;
    const pyEnd = Math.min(pyStart + cellPx, canvasHeight);

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

      const pixel = palPixels[bestIdx];
      const pxStart = col * cellPx;
      const pxEnd = Math.min(pxStart + cellPx, canvasWidth);
      
      // Optimized fill - single operation per row segment
      const rowOffset = pyStart * canvasWidth;
      for (let py = pyStart; py < pyEnd; py++) {
        const offset = py * canvasWidth + pxStart;
        data32.fill(pixel, offset, offset + (pxEnd - pxStart));
      }
    }
  }

  ctx.putImageData(refineBuffer, 0, 0);

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

  // Extract grayscale and RGB arrays (single-pass with pointer increments)
  const totalPixels = width * height;
  const grayscale = new Uint8Array(totalPixels);
  const rgb = new Uint8Array(totalPixels * 3);

  for (let i = 0, rgbaIdx = 0, rgbIdx = 0; i < totalPixels; i++, rgbaIdx += 4, rgbIdx += 3) {
    const r = pixels[rgbaIdx];
    const g = pixels[rgbaIdx + 1];
    const b = pixels[rgbaIdx + 2];
    grayscale[i] = (r * 77 + g * 150 + b * 29 + 128) >> 8; // integer BT.601 luma
    rgb[rgbIdx] = r;
    rgb[rgbIdx + 1] = g;
    rgb[rgbIdx + 2] = b;
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
    renderMode = "standard",
    colorVariation = 0.15,
    cellShape = "square",
    saturation = 1.0,
    edgeEnhance = 0,
    blur = 0,
    paletteHarmony = "auto",
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
  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.imageSmoothingEnabled = false;

  // Compute edges if edge enhancement is enabled
  let edges: Float64Array | null = null;
  if (edgeEnhance > 0) {
    edges = computeEdges(pixelData, width, height);
  }

  // Dispatch to specialized renderers for specific modes
  if (renderMode === "halftone") {
    renderHalftone(ctx, canvasWidth, canvasHeight, cellPx, cols, rows, sat, satRGB, gridSize, width, height, toneLUT, backgroundColor);
  } else if (renderMode === "crosshatch") {
    renderCrosshatch(ctx, canvasWidth, canvasHeight, cellPx, cols, rows, sat, gridSize, width, height, toneLUT, backgroundColor, fillColor);
  } else if (renderMode === "pointillist") {
    renderPointillist(ctx, canvasWidth, canvasHeight, cellPx, cols, rows, sat, satRGB, gridSize, width, height, toneLUT, backgroundColor, colorVariation, saturation);
  } else if (renderMode === "watercolor") {
    renderWatercolor(ctx, canvasWidth, canvasHeight, cellPx, cols, rows, sat, satRGB, gridSize, width, height, toneLUT, backgroundColor, colorVariation, saturation, blur);
  } else {
    // Standard, dithered, artistic, mosaic — use pixel buffer approach for shapes that fill cells
    const useShapes = cellShape !== "square";

    if (useShapes) {
      // Shape-based rendering with canvas drawing API
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }

    const fillBuffer = !useShapes ? ctx.createImageData(canvasWidth, canvasHeight) : null;
    const data32 = fillBuffer ? new Uint32Array(fillBuffer.data.buffer) : null;

    if (data32) {
      const bgPixel = (255 << 24) | (bgB << 16) | (bgG << 8) | bgR;
      data32.fill(bgPixel);
    }

    const { lightScale, satScale, coolR, coolG, coolB } = DEPTH_LUT;

    // Dithering matrix (Bayer 4x4)
    const bayerMatrix = new Uint8Array([
      0, 8, 2, 10,
      12, 4, 14, 6,
      3, 11, 1, 9,
      15, 7, 13, 5
    ]);

    for (let row = 0; row < rows; row++) {
      const srcY = row * gridSize;
      const cellH = Math.min(gridSize, height - srcY);
      const pyStart = row * cellPx;
      const pyEnd = Math.min(pyStart + cellPx, canvasHeight);

      for (let col = 0; col < cols; col++) {
        const srcX = col * gridSize;
        const cellW = Math.min(gridSize, width - srcX);

        const brightness = sat.average(srcX, srcY, cellW, cellH);
        const brightIdx = (brightness + 0.5) | 0;
        const darkF = toneLUT[brightIdx];

        // Edge enhancement
        let edgeFactor = 0;
        if (edges && edgeEnhance > 0) {
          const eCenterX = Math.min(width - 1, srcX + (cellW >> 1));
          const eCenterY = Math.min(height - 1, srcY + (cellH >> 1));
          edgeFactor = edges[eCenterY * width + eCenterX] * edgeEnhance;
        }

        let r: number, g: number, b: number;

        if (satRGB) {
          const [cr, cg, cb] = satRGB.average(srcX, srcY, cellW, cellH);
          let [h, s, l] = rgbToHsl(cr, cg, cb);

          const gammaCorrected = Math.pow(darkF, 0.8);
          l = l * (0.2 + gammaCorrected * 0.8);

          const depthIdx = Math.min(255, Math.max(0, brightIdx));
          s = Math.min(1, s * satScale[depthIdx] * saturation);

          if (renderMode === "artistic" && colorVariation > 0) {
            const hueShift = Math.sin(row * 0.3 + col * 0.2) * colorVariation * 60;
            h = (h + hueShift + 360) % 360;
            s = Math.min(1, s * (1 + Math.cos(row * 0.2) * colorVariation * 0.5));
          }

          // Mosaic: add random tile-like texture
          if (renderMode === "mosaic") {
            const hash = ((row * 73856093) ^ (col * 19349663)) >>> 0;
            const tileVar = ((hash & 0xFF) / 255 - 0.5) * 0.15;
            l = Math.max(0.05, Math.min(0.95, l + tileVar));
            const hueVar = ((hash >> 8) & 0xFF) / 255 * colorVariation * 10;
            h = (h + hueVar + 360) % 360;
          }

          const [outR, outG, outB] = hslToRgb(h, s, l);
          r = outR * coolR[depthIdx];
          g = outG * coolG[depthIdx];
          b = Math.min(255, outB + coolB[depthIdx]);

          if (colorVariation > 0 && renderMode !== "dithered") {
            const vary = colorVariation * 15;
            const hash = ((row * 73856093) ^ (col * 19349663)) & 0xFFFF;
            const rand = (hash / 0xFFFF - 0.5) * 2;
            r = Math.max(0, Math.min(255, r + rand * vary));
            g = Math.max(0, Math.min(255, g + rand * vary * 0.8));
            b = Math.max(0, Math.min(255, b + rand * vary * 0.6));
          }

          // Edge darkening
          if (edgeFactor > 0) {
            const darken = 1 - edgeFactor * 0.5;
            r *= darken;
            g *= darken;
            b *= darken;
          }
        } else {
          const lightF = darkF;
          r = bgR + (fR - bgR) * lightF;
          g = bgG + (fG - bgG) * lightF;
          b = bgB + (fB - bgB) * lightF;

          if (edgeFactor > 0) {
            r = Math.max(0, r - edgeFactor * 80);
            g = Math.max(0, g - edgeFactor * 80);
            b = Math.max(0, b - edgeFactor * 80);
          }
        }

        let rr = (r + 0.5) | 0, gg = (g + 0.5) | 0, bb = (b + 0.5) | 0;

        if (renderMode === "dithered") {
          const ditherIdx = ((row & 3) << 2) | (col & 3);
          const ditherVal = (bayerMatrix[ditherIdx] - 7.5) * 3;
          rr = Math.max(0, Math.min(255, rr + ditherVal));
          gg = Math.max(0, Math.min(255, gg + ditherVal));
          bb = Math.max(0, Math.min(255, bb + ditherVal));
        }

        if (useShapes) {
          const color = `rgb(${rr},${gg},${bb})`;
          const cx = col * cellPx + cellPx / 2;
          const cy = row * cellPx + cellPx / 2;
          drawCellShape(ctx, cellShape, cx, cy, cellPx, cellPx, color);
        } else if (data32) {
          const pixel = (255 << 24) | (bb << 16) | (gg << 8) | rr;
          const pxStart = col * cellPx;
          const pxEnd = Math.min(pxStart + cellPx, canvasWidth);
          for (let py = pyStart; py < pyEnd; py++) {
            const offset = py * canvasWidth + pxStart;
            data32.fill(pixel, offset, offset + (pxEnd - pxStart));
          }
        }
      }
    }

    if (fillBuffer) {
      ctx.putImageData(fillBuffer, 0, 0);
    }
  }

  // Grid lines (for applicable modes)
  const scaledLineWidth = lineWidth * scale;
  if (scaledLineWidth > 0 && renderMode !== "halftone" && renderMode !== "crosshatch" && renderMode !== "pointillist" && renderMode !== "watercolor") {
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = scaledLineWidth;
    ctx.beginPath();
    const halfPx = scaledLineWidth % 2 === 1 ? 0.5 : 0;
    for (let c = 0; c <= cols; c++) { const x = c * cellPx + halfPx; ctx.moveTo(x, 0); ctx.lineTo(x, canvasHeight); }
    for (let r = 0; r <= rows; r++) { const y = r * cellPx + halfPx; ctx.moveTo(0, y); ctx.lineTo(canvasWidth, y); }
    ctx.stroke();
  }

  // Apply blur post-processing if requested (for non-watercolor modes)
  if (blur > 0 && renderMode !== "watercolor") {
    ctx.filter = `blur(${blur * cellPx * 0.1}px)`;
    ctx.drawImage(canvas, 0, 0);
    ctx.filter = "none";
  }

  // Palette
  let imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  let palette = extractPalette(imageData.data, canvasWidth, canvasHeight, cellPx, MAX_PALETTE);

  // Apply palette harmony
  if (paletteHarmony !== "auto") {
    palette = applyPaletteHarmony(palette, paletteHarmony);
  }

  // Optional refine
  if (refined) {
    palette = refinePalette(palette);
    rerenderWithRefinedPalette(ctx, imageData.data, canvasWidth, canvasHeight, cellPx, palette, scaledLineWidth, lineColor);
    imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
    palette = extractPalette(imageData.data, canvasWidth, canvasHeight, cellPx, REFINED_MAX);
  }

  // Paint-by-numbers
  const pbnCanvas = renderPaintByNumbers(imageData, canvasWidth, canvasHeight, cellPx, palette, scaledLineWidth, lineColor, backgroundColor);

  return { canvas, pbnCanvas, palette };
}

// ── Cell shape drawing helpers ───────────────────────────────────────

function drawCellShape(
  ctx: CanvasRenderingContext2D,
  shape: CellShape,
  cx: number,
  cy: number,
  cellW: number,
  cellH: number,
  color: string,
  _sizeFactor: number = 1.0,
): void {
  const hw = (cellW / 2) * _sizeFactor;
  const hh = (cellH / 2) * _sizeFactor;

  ctx.fillStyle = color;
  ctx.beginPath();

  switch (shape) {
    case "circle":
      ctx.ellipse(cx, cy, hw, hh, 0, 0, Math.PI * 2);
      break;
    case "diamond":
      ctx.moveTo(cx, cy - hh);
      ctx.lineTo(cx + hw, cy);
      ctx.lineTo(cx, cy + hh);
      ctx.lineTo(cx - hw, cy);
      break;
    case "triangle":
      ctx.moveTo(cx, cy - hh);
      ctx.lineTo(cx + hw, cy + hh);
      ctx.lineTo(cx - hw, cy + hh);
      break;
    case "hexagon": {
      const r = Math.min(hw, hh);
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const px = cx + r * Math.cos(angle);
        const py = cy + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      break;
    }
    case "square":
    default:
      ctx.rect(cx - hw, cy - hh, hw * 2, hh * 2);
      break;
  }

  ctx.closePath();
  ctx.fill();
}

// ── Halftone renderer ────────────────────────────────────────────────

function renderHalftone(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  cellPx: number,
  cols: number,
  rows: number,
  sat: IntegralImage,
  satRGB: IntegralImageRGB | null,
  gridSize: number,
  width: number,
  height: number,
  toneLUT: Float64Array,
  bgColor: string,
): void {
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  for (let row = 0; row < rows; row++) {
    const srcY = row * gridSize;
    const cellH = Math.min(gridSize, height - srcY);
    for (let col = 0; col < cols; col++) {
      const srcX = col * gridSize;
      const cellW = Math.min(gridSize, width - srcX);
      const brightness = sat.average(srcX, srcY, cellW, cellH);
      const brightIdx = (brightness + 0.5) | 0;
      const darkF = toneLUT[brightIdx];
      // Dot size proportional to darkness (inverted for halftone)
      const dotSize = 1.0 - darkF;
      if (dotSize < 0.03) continue;

      const cx = col * cellPx + cellPx / 2;
      const cy = row * cellPx + cellPx / 2;

      let color: string;
      if (satRGB) {
        const [cr, cg, cb] = satRGB.average(srcX, srcY, cellW, cellH);
        const rr = Math.round(Math.max(0, Math.min(255, cr)));
        const gg = Math.round(Math.max(0, Math.min(255, cg)));
        const bb = Math.round(Math.max(0, Math.min(255, cb)));
        color = `rgb(${rr},${gg},${bb})`;
      } else {
        const gray = Math.round(255 * (1 - dotSize));
        color = `rgb(${gray},${gray},${gray})`;
      }

      ctx.fillStyle = color;
      ctx.beginPath();
      const radius = (cellPx / 2) * dotSize;
      ctx.ellipse(cx, cy, radius, radius, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ── Crosshatch renderer ─────────────────────────────────────────────

function renderCrosshatch(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  cellPx: number,
  cols: number,
  rows: number,
  sat: IntegralImage,
  gridSize: number,
  width: number,
  height: number,
  toneLUT: Float64Array,
  bgColor: string,
  strokeColor: string,
): void {
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.strokeStyle = strokeColor;

  for (let row = 0; row < rows; row++) {
    const srcY = row * gridSize;
    const cellH = Math.min(gridSize, height - srcY);
    for (let col = 0; col < cols; col++) {
      const srcX = col * gridSize;
      const cellW = Math.min(gridSize, width - srcX);
      const brightness = sat.average(srcX, srcY, cellW, cellH);
      const brightIdx = (brightness + 0.5) | 0;
      const darkF = toneLUT[brightIdx];
      const density = 1 - darkF; // darker = more hatching

      const x0 = col * cellPx;
      const y0 = row * cellPx;
      const x1 = x0 + cellPx;
      const y1 = y0 + cellPx;

      if (density < 0.05) continue;

      ctx.lineWidth = Math.max(0.5, density * 2);

      // Horizontal lines
      if (density > 0.15) {
        const count = Math.ceil(density * 4);
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
          const y = y0 + ((i + 0.5) / count) * cellPx;
          ctx.moveTo(x0, y);
          ctx.lineTo(x1, y);
        }
        ctx.stroke();
      }

      // Diagonal lines (/)
      if (density > 0.35) {
        ctx.beginPath();
        const count = Math.ceil((density - 0.3) * 5);
        for (let i = 0; i < count; i++) {
          const offset = ((i + 0.5) / count) * cellPx;
          ctx.moveTo(x0, y0 + offset);
          ctx.lineTo(x0 + offset, y0);
        }
        ctx.stroke();
      }

      // Diagonal lines (\)
      if (density > 0.55) {
        ctx.beginPath();
        const count = Math.ceil((density - 0.5) * 4);
        for (let i = 0; i < count; i++) {
          const offset = ((i + 0.5) / count) * cellPx;
          ctx.moveTo(x1, y0 + offset);
          ctx.lineTo(x1 - offset, y0);
        }
        ctx.stroke();
      }

      // Cross for very dark areas
      if (density > 0.75) {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.moveTo(x1, y0);
        ctx.lineTo(x0, y1);
        ctx.stroke();
      }
    }
  }
}

// ── Pointillist renderer (Seurat-style) ──────────────────────────────

function renderPointillist(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  cellPx: number,
  cols: number,
  rows: number,
  sat: IntegralImage,
  satRGB: IntegralImageRGB | null,
  gridSize: number,
  width: number,
  height: number,
  toneLUT: Float64Array,
  bgColor: string,
  variation: number,
  saturationMod: number,
): void {
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  for (let row = 0; row < rows; row++) {
    const srcY = row * gridSize;
    const cellH = Math.min(gridSize, height - srcY);
    for (let col = 0; col < cols; col++) {
      const srcX = col * gridSize;
      const cellW = Math.min(gridSize, width - srcX);
      const brightness = sat.average(srcX, srcY, cellW, cellH);
      const brightIdx = (brightness + 0.5) | 0;
      const darkF = toneLUT[brightIdx];

      const cx = col * cellPx + cellPx / 2;
      const cy = row * cellPx + cellPx / 2;

      // Multiple small dots per cell for pointillist effect
      const dotCount = Math.ceil(3 + (1 - darkF) * 5);
      const baseRadius = cellPx * 0.15;

      for (let d = 0; d < dotCount; d++) {
        const hash = ((row * 73856093) ^ (col * 19349663) ^ (d * 83492791)) >>> 0;
        const rx = ((hash & 0xFFF) / 0xFFF - 0.5) * cellPx * 0.7;
        const ry = (((hash >> 12) & 0xFFF) / 0xFFF - 0.5) * cellPx * 0.7;
        const rSize = baseRadius * (0.6 + ((hash >> 24) & 0xFF) / 255 * 0.8);

        let r: number, g: number, b: number;
        if (satRGB) {
          const [cr, cg, cb] = satRGB.average(srcX, srcY, cellW, cellH);
          let [h, s, l] = rgbToHsl(cr, cg, cb);
          // Add variation
          const hueShift = ((hash >> 8) & 0xFF) / 255 * variation * 30 - variation * 15;
          h = (h + hueShift + 360) % 360;
          s = Math.min(1, s * saturationMod);
          l = Math.max(0.1, Math.min(0.9, l * (0.3 + darkF * 0.7)));
          [r, g, b] = hslToRgb(h, s, l);
        } else {
          const gray = Math.round(255 * darkF);
          r = g = b = gray;
        }

        ctx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
        ctx.beginPath();
        ctx.ellipse(cx + rx, cy + ry, rSize, rSize, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// ── Watercolor renderer ──────────────────────────────────────────────

function renderWatercolor(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  cellPx: number,
  cols: number,
  rows: number,
  sat: IntegralImage,
  satRGB: IntegralImageRGB | null,
  gridSize: number,
  width: number,
  height: number,
  toneLUT: Float64Array,
  bgColor: string,
  variation: number,
  saturationMod: number,
  blurAmount: number,
): void {
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // First pass: fill cells with slight overflow for bleeding effect
  for (let row = 0; row < rows; row++) {
    const srcY = row * gridSize;
    const cellH = Math.min(gridSize, height - srcY);
    for (let col = 0; col < cols; col++) {
      const srcX = col * gridSize;
      const cellW = Math.min(gridSize, width - srcX);
      const brightness = sat.average(srcX, srcY, cellW, cellH);
      const brightIdx = (brightness + 0.5) | 0;
      const darkF = toneLUT[brightIdx];

      let r: number, g: number, b: number;
      if (satRGB) {
        const [cr, cg, cb] = satRGB.average(srcX, srcY, cellW, cellH);
        let [h, s, l] = rgbToHsl(cr, cg, cb);
        s = Math.min(1, s * saturationMod * 0.75); // desaturate slightly for watercolor
        l = Math.max(0.2, Math.min(0.95, l * (0.3 + darkF * 0.7)));
        // Slight hue variance
        const hash = ((row * 73856093) ^ (col * 19349663)) >>> 0;
        h = (h + ((hash & 0xFF) / 255 - 0.5) * variation * 20 + 360) % 360;
        [r, g, b] = hslToRgb(h, s, l);
      } else {
        const gray = Math.round(255 * (0.3 + darkF * 0.65));
        r = g = b = gray;
      }

      // Semi-transparent overlapping strokes
      const alpha = 0.5 + darkF * 0.3;
      ctx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`;

      const x0 = col * cellPx;
      const y0 = row * cellPx;
      const overflow = cellPx * blurAmount * 0.3;

      // Irregular blob shape
      ctx.beginPath();
      const points = 8;
      for (let i = 0; i <= points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const hash2 = ((row * 31 + col * 17 + i * 71) * 2654435761) >>> 0;
        const radiusVar = 0.8 + ((hash2 & 0xFF) / 255) * 0.4;
        const px = x0 + cellPx / 2 + Math.cos(angle) * (cellPx / 2 + overflow) * radiusVar;
        const py = y0 + cellPx / 2 + Math.sin(angle) * (cellPx / 2 + overflow) * radiusVar;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
}

// ── Palette harmony helpers ──────────────────────────────────────────

function applyPaletteHarmony(
  palette: PaletteEntry[],
  harmony: PaletteHarmony,
): PaletteEntry[] {
  if (harmony === "auto" || palette.length === 0) return palette;

  // Get the dominant hue
  const [dr, dg, db] = hexToRgb(palette[0].color);
  const [baseH, baseS, baseL] = rgbToHsl(dr, dg, db);

  return palette.map((entry, i) => {
    const [r, g, b] = hexToRgb(entry.color);
    let [h, s, l] = rgbToHsl(r, g, b);

    switch (harmony) {
      case "monochromatic":
        h = baseH;
        s = baseS * (0.3 + (i / palette.length) * 0.7);
        break;
      case "complementary":
        if (i % 2 === 1) h = (baseH + 180) % 360;
        else h = baseH;
        break;
      case "analogous":
        h = baseH + ((i / palette.length) - 0.5) * 60;
        if (h < 0) h += 360;
        break;
      case "triadic":
        h = baseH + (i % 3) * 120;
        if (h >= 360) h -= 360;
        break;
    }

    const [nr, ng, nb] = hslToRgb(h, s, l);
    return {
      color: `#${((1 << 24) | (nr << 16) | (ng << 8) | nb).toString(16).slice(1)}`,
      count: entry.count,
    };
  });
}

// ── Edge detection (Sobel) ───────────────────────────────────────────

function computeEdges(grayscale: Uint8Array, width: number, height: number): Float64Array {
  const edges = new Float64Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const gx =
        -grayscale[(y - 1) * width + (x - 1)] + grayscale[(y - 1) * width + (x + 1)]
        - 2 * grayscale[y * width + (x - 1)] + 2 * grayscale[y * width + (x + 1)]
        - grayscale[(y + 1) * width + (x - 1)] + grayscale[(y + 1) * width + (x + 1)];
      const gy =
        -grayscale[(y - 1) * width + (x - 1)] - 2 * grayscale[(y - 1) * width + x] - grayscale[(y - 1) * width + (x + 1)]
        + grayscale[(y + 1) * width + (x - 1)] + 2 * grayscale[(y + 1) * width + x] + grayscale[(y + 1) * width + (x + 1)];
      edges[idx] = Math.sqrt(gx * gx + gy * gy) / 255;
    }
  }
  return edges;
}

// ── SVG export ───────────────────────────────────────────────────────

export function exportSVG(
  pixelData: Uint8Array,
  width: number,
  height: number,
  options: GridRenderOptions,
  rgbData?: Uint8Array,
): string {
  const {
    gridSize = 10,
    backgroundColor = "#ffffff",
    fillColor = "#000000",
    intensity = 5,
    colorMode = true,
    lineWidth = 1,
    lineColor = "#2a2a2a",
    scale = 2,
    cellShape = "square",
    saturation = 1.0,
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

  const lines: string[] = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">`);
  lines.push(`<rect width="100%" height="100%" fill="${backgroundColor}"/>`);

  for (let row = 0; row < rows; row++) {
    const srcY = row * gridSize;
    const cellH = Math.min(gridSize, height - srcY);
    for (let col = 0; col < cols; col++) {
      const srcX = col * gridSize;
      const cellW = Math.min(gridSize, width - srcX);
      const brightness = sat.average(srcX, srcY, cellW, cellH);
      const brightIdx = (brightness + 0.5) | 0;
      const darkF = toneLUT[brightIdx];

      let r: number, g: number, b: number;
      if (satRGB) {
        const [cr, cg, cb] = satRGB.average(srcX, srcY, cellW, cellH);
        let [h, s, l] = rgbToHsl(cr, cg, cb);
        l = l * (0.2 + Math.pow(darkF, 0.8) * 0.8);
        s = Math.min(1, s * saturation);
        [r, g, b] = hslToRgb(h, s, l);
      } else {
        r = bgR + (fR - bgR) * darkF;
        g = bgG + (fG - bgG) * darkF;
        b = bgB + (fB - bgB) * darkF;
      }

      const rr = Math.round(Math.max(0, Math.min(255, r)));
      const gg = Math.round(Math.max(0, Math.min(255, g)));
      const bb = Math.round(Math.max(0, Math.min(255, b)));
      const hex = `#${((1 << 24) | (rr << 16) | (gg << 8) | bb).toString(16).slice(1)}`;

      const cx = col * cellPx + cellPx / 2;
      const cy = row * cellPx + cellPx / 2;
      const x0 = col * cellPx;
      const y0 = row * cellPx;

      switch (cellShape) {
        case "circle":
          lines.push(`<ellipse cx="${cx}" cy="${cy}" rx="${cellPx / 2}" ry="${cellPx / 2}" fill="${hex}"/>`);
          break;
        case "diamond":
          lines.push(`<polygon points="${cx},${y0} ${x0 + cellPx},${cy} ${cx},${y0 + cellPx} ${x0},${cy}" fill="${hex}"/>`);
          break;
        case "triangle":
          lines.push(`<polygon points="${cx},${y0} ${x0 + cellPx},${y0 + cellPx} ${x0},${y0 + cellPx}" fill="${hex}"/>`);
          break;
        case "hexagon": {
          const hr = cellPx / 2;
          const pts = Array.from({ length: 6 }, (_, i) => {
            const a = (Math.PI / 3) * i - Math.PI / 6;
            return `${cx + hr * Math.cos(a)},${cy + hr * Math.sin(a)}`;
          }).join(" ");
          lines.push(`<polygon points="${pts}" fill="${hex}"/>`);
          break;
        }
        default:
          lines.push(`<rect x="${x0}" y="${y0}" width="${cellPx}" height="${cellPx}" fill="${hex}"/>`);
      }
    }
  }

  // Grid lines
  if (lineWidth > 0) {
    const slw = lineWidth * scale;
    for (let c = 0; c <= cols; c++) {
      lines.push(`<line x1="${c * cellPx}" y1="0" x2="${c * cellPx}" y2="${canvasHeight}" stroke="${lineColor}" stroke-width="${slw}"/>`);
    }
    for (let r = 0; r <= rows; r++) {
      lines.push(`<line x1="0" y1="${r * cellPx}" x2="${canvasWidth}" y2="${r * cellPx}" stroke="${lineColor}" stroke-width="${slw}"/>`);
    }
  }

  lines.push("</svg>");
  return lines.join("\n");
}

// ── Download helper ──────────────────────────────────────────────────

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string, format: ExportFormat = "png", quality: number = 0.92): void {
  if (format === "svg") return; // handled separately

  const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, mimeType, quality);
}

export function downloadSVG(svgContent: string, filename: string): void {
  const blob = new Blob([svgContent], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
