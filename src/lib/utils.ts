// ── Summed Area Table (Integral Image) ──────────────────────────────
// Allows O(1) average-brightness lookups for any rectangular region.

export class IntegralImage {
  private sat: Float64Array;
  private w: number;
  private h: number;

  constructor(pixelData: Uint8Array, width: number, height: number) {
    this.w = width;
    this.h = height;
    const sat = new Float64Array((width + 1) * (height + 1));
    const stride = width + 1;

    for (let y = 1; y <= height; y++) {
      let rowSum = 0;
      for (let x = 1; x <= width; x++) {
        rowSum += pixelData[(y - 1) * width + (x - 1)];
        sat[y * stride + x] = rowSum + sat[(y - 1) * stride + x];
      }
    }
    this.sat = sat;
  }

  average(startX: number, startY: number, cellW: number, cellH: number): number {
    const x1 = Math.max(0, startX);
    const y1 = Math.max(0, startY);
    const x2 = Math.min(this.w, startX + cellW);
    const y2 = Math.min(this.h, startY + cellH);
    const area = (x2 - x1) * (y2 - y1);
    if (area <= 0) return 0;

    const stride = this.w + 1;
    const sum =
      this.sat[y2 * stride + x2] -
      this.sat[y1 * stride + x2] -
      this.sat[y2 * stride + x1] +
      this.sat[y1 * stride + x1];

    return sum / area;
  }
}

// ── RGB Integral Image (for color mode) ─────────────────────────────
export class IntegralImageRGB {
  private satR: Float64Array;
  private satG: Float64Array;
  private satB: Float64Array;
  private w: number;
  private h: number;

  constructor(rgbData: Uint8Array, width: number, height: number) {
    this.w = width;
    this.h = height;
    const size = (width + 1) * (height + 1);
    this.satR = new Float64Array(size);
    this.satG = new Float64Array(size);
    this.satB = new Float64Array(size);
    const stride = width + 1;

    for (let y = 1; y <= height; y++) {
      let rowR = 0, rowG = 0, rowB = 0;
      for (let x = 1; x <= width; x++) {
        const idx = ((y - 1) * width + (x - 1)) * 3;
        rowR += rgbData[idx];
        rowG += rgbData[idx + 1];
        rowB += rgbData[idx + 2];
        const pos = y * stride + x;
        const above = (y - 1) * stride + x;
        this.satR[pos] = rowR + this.satR[above];
        this.satG[pos] = rowG + this.satG[above];
        this.satB[pos] = rowB + this.satB[above];
      }
    }
  }

  average(startX: number, startY: number, cellW: number, cellH: number): [number, number, number] {
    const x1 = Math.max(0, startX);
    const y1 = Math.max(0, startY);
    const x2 = Math.min(this.w, startX + cellW);
    const y2 = Math.min(this.h, startY + cellH);
    const area = (x2 - x1) * (y2 - y1);
    if (area <= 0) return [0, 0, 0];

    const stride = this.w + 1;
    const a = y2 * stride + x2;
    const b = y1 * stride + x2;
    const c = y2 * stride + x1;
    const d = y1 * stride + x1;

    return [
      (this.satR[a] - this.satR[b] - this.satR[c] + this.satR[d]) / area,
      (this.satG[a] - this.satG[b] - this.satG[c] + this.satG[d]) / area,
      (this.satB[a] - this.satB[b] - this.satB[c] + this.satB[d]) / area,
    ];
  }
}

// ── Sigmoid tone LUT ────────────────────────────────────────────────
export function buildSigmoidLUT(intensity: number): Float64Array {
  const lut = new Float64Array(256);
  const k = intensity * 1.5; // Reduced multiplier for smoother curve
  const sigMin = 1 / (1 + Math.exp(-k * -0.5));
  const sigMax = 1 / (1 + Math.exp(-k * 0.5));
  const sigRange = sigMax - sigMin;

  for (let i = 0; i < 256; i++) {
    const x = i / 255; // Correct: bright input (255) -> x=1 -> high sigmoid output
    const sig = 1 / (1 + Math.exp(-k * (x - 0.5)));
    const normalized = (sig - sigMin) / sigRange;
    // Apply gamma < 1 to lift midtones — 0.75 gives ~+15% perceived brightness
    lut[i] = Math.pow(normalized, 0.75);
  }
  return lut;
}

// ── Hex / RGB / HSL conversions ─────────────────────────────────────
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

export function rgbToHsl(
  r: number, g: number, b: number,
): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return [h * 360, s, l];
}

export function hslToRgb(
  h: number, s: number, l: number,
): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  h /= 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(h + 1 / 3) * 255),
    Math.round(hue2rgb(h) * 255),
    Math.round(hue2rgb(h - 1 / 3) * 255),
  ];
}
