"use client";

import { useState, useCallback, useRef } from "react";
import { useDropzone } from "react-dropzone";
import {
  Upload,
  Sparkles,
  Download,
  Palette,
  Wand2,
  RotateCcw,
  Copy,
  Check,
} from "lucide-react";
import {
  preprocessImage,
  renderGrid,
  downloadCanvas,
  type PaletteEntry,
  type GridRenderOptions,
} from "@/lib/renderer";

interface Params {
  gridSize: number;
  contrast: number;
  brightness: number;
  backgroundColor: string;
  fillColor: string;
  intensity: number;
  colorMode: boolean;
  lineWidth: number;
  lineColor: string;
}

const DEFAULT_PARAMS: Params = {
  gridSize: 10,
  contrast: 1.2,
  brightness: 1.0,
  backgroundColor: "#ffffff",
  fillColor: "#000000",
  intensity: 5,
  colorMode: true,
  lineWidth: 1,
  lineColor: "#2a2a2a",
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [params, setParams] = useState<Params>({ ...DEFAULT_PARAMS });
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState("");

  // Result state
  const [resultCanvas, setResultCanvas] = useState<HTMLCanvasElement | null>(null);
  const [pbnCanvas, setPbnCanvas] = useState<HTMLCanvasElement | null>(null);
  const [palette, setPalette] = useState<PaletteEntry[]>([]);
  const [isRefined, setIsRefined] = useState(false);
  const [copiedColor, setCopiedColor] = useState<string | null>(null);

  // Keep preprocessing result for re-render
  const preprocessedRef = useRef<{
    grayscale: Uint8Array;
    rgb: Uint8Array;
    width: number;
    height: number;
  } | null>(null);

  const resultRef = useRef<HTMLDivElement>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const f = acceptedFiles[0];
    if (!f) return;
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    // Clear previous result
    setResultCanvas(null);
    setPbnCanvas(null);
    setPalette([]);
    setIsRefined(false);
    preprocessedRef.current = null;
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp"] },
    maxFiles: 1,
    multiple: false,
  });

  const handleGenerate = useCallback(async (refined = false) => {
    if (!file) return;
    setProcessing(true);
    setProgress("Preprocessing image…");

    try {
      // Preprocess (only if not cached or params changed)
      if (!preprocessedRef.current) {
        const result = await preprocessImage(file, 2000, params.contrast, params.brightness);
        preprocessedRef.current = result;
      }

      const { grayscale, rgb, width, height } = preprocessedRef.current;

      setProgress(refined ? "Rendering refined grid…" : "Rendering grid…");

      // Use requestAnimationFrame to let the UI update
      await new Promise((r) => requestAnimationFrame(r));

      const opts: GridRenderOptions = {
        gridSize: params.gridSize,
        backgroundColor: params.backgroundColor,
        fillColor: params.fillColor,
        intensity: params.intensity,
        colorMode: params.colorMode,
        lineWidth: params.lineWidth,
        lineColor: params.lineColor,
        scale: 2,
        refined,
      };

      const result = renderGrid(grayscale, width, height, opts, rgb);

      setResultCanvas(result.canvas);
      setPbnCanvas(result.pbnCanvas);
      setPalette(result.palette);
      setIsRefined(refined);
      setProgress("");

      // Scroll to result
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (err) {
      console.error(err);
      setProgress(`Error: ${(err as Error).message}`);
    } finally {
      setProcessing(false);
    }
  }, [file, params]);

  const handleReset = useCallback(() => {
    setFile(null);
    setPreviewUrl(null);
    setResultCanvas(null);
    setPbnCanvas(null);
    setPalette([]);
    setIsRefined(false);
    preprocessedRef.current = null;
    setParams({ ...DEFAULT_PARAMS });
  }, []);

  const handleParamChange = useCallback((key: keyof Params, value: number | string | boolean) => {
    setParams((prev) => ({ ...prev, [key]: value }));
    // Invalidate preprocessing cache if contrast/brightness change
    if (key === "contrast" || key === "brightness") {
      preprocessedRef.current = null;
    }
  }, []);

  const handleCopyColor = useCallback(async (hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopiedColor(hex);
      setTimeout(() => setCopiedColor(null), 1500);
    } catch { /* noop */ }
  }, []);

  // Convert canvas to data URL for display
  const resultDataUrl = resultCanvas?.toDataURL("image/png") ?? null;

  return (
    <div className="space-y-8">
      {/* ── Result ──────────────────────────────────────────────── */}
      {resultDataUrl && (
        <div ref={resultRef} className="card space-y-4">
          <h3 className="text-sm font-semibold text-gray-900">Result</h3>
          <div className="overflow-hidden rounded-xl bg-gray-100">
            <img
              src={resultDataUrl}
              alt="Grid art result"
              className="mx-auto max-h-[70vh] w-auto object-contain"
            />
          </div>

          {/* Palette */}
          {palette.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Colours ({palette.length})
              </h4>
              <div className="flex flex-wrap gap-2">
                {palette.map((entry) => (
                  <button
                    key={entry.color}
                    type="button"
                    title={`${entry.color} — ${entry.count} cells`}
                    onClick={() => handleCopyColor(entry.color)}
                    className="group flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs transition-all hover:border-gray-300 hover:shadow-sm"
                  >
                    <span
                      className="inline-block h-5 w-5 flex-shrink-0 rounded border border-gray-200"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span className="font-mono text-gray-600 group-hover:text-gray-900">
                      {entry.color}
                    </span>
                    {copiedColor === entry.color ? (
                      <Check className="h-3 w-3 text-green-500" />
                    ) : (
                      <Copy className="h-3 w-3 text-gray-300 opacity-0 group-hover:opacity-100" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap justify-end gap-3">
            {!isRefined && (
              <button
                onClick={() => handleGenerate(true)}
                disabled={processing}
                className="btn-secondary"
              >
                <Wand2 className="h-4 w-4" />
                Refine (fewer colors)
              </button>
            )}
            {pbnCanvas && (
              <button
                onClick={() => downloadCanvas(pbnCanvas, "paint-by-numbers.png")}
                className="btn-secondary"
              >
                <Palette className="h-4 w-4" />
                Paint by Numbers
              </button>
            )}
            {resultCanvas && (
              <button
                onClick={() => downloadCanvas(resultCanvas, "grid-art.png")}
                className="btn-primary"
              >
                <Download className="h-4 w-4" />
                Download
              </button>
            )}
          </div>
        </div>
      )}

      {/* Progress */}
      {processing && progress && (
        <div className="card text-center">
          <div className="flex items-center justify-center gap-3 text-sm text-gray-600">
            <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" className="opacity-75" />
            </svg>
            {progress}
          </div>
        </div>
      )}

      {/* ── Upload + Controls ────────────────────────────────────── */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Left: Upload */}
        <div className="space-y-6">
          <div>
            <h3 className="mb-3 text-sm font-semibold text-gray-900">
              1. Upload Image
            </h3>
            <div
              {...getRootProps()}
              className={`card flex min-h-[200px] cursor-pointer items-center justify-center transition-colors ${
                isDragActive ? "border-blue-400 bg-blue-50" : "hover:border-gray-300"
              }`}
            >
              <input {...getInputProps()} />
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="max-h-[300px] rounded-lg object-contain"
                />
              ) : (
                <div className="text-center">
                  <Upload className="mx-auto h-8 w-8 text-gray-400" />
                  <p className="mt-2 text-sm text-gray-500">
                    Drop an image here, or click to select
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    PNG, JPG, WebP
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Controls */}
        <div className="space-y-6">
          <div>
            <h3 className="mb-3 text-sm font-semibold text-gray-900">
              2. Adjust Settings
            </h3>
            <div className="card space-y-4">
              {/* Grid Size */}
              <label className="block">
                <span className="text-xs font-medium text-gray-600">
                  Grid Size: {params.gridSize}
                </span>
                <input
                  type="range"
                  min={3}
                  max={50}
                  value={params.gridSize}
                  onChange={(e) => handleParamChange("gridSize", parseInt(e.target.value))}
                  className="mt-1 w-full"
                />
              </label>

              {/* Contrast */}
              <label className="block">
                <span className="text-xs font-medium text-gray-600">
                  Contrast: {params.contrast.toFixed(1)}
                </span>
                <input
                  type="range"
                  min={50}
                  max={250}
                  value={params.contrast * 100}
                  onChange={(e) => handleParamChange("contrast", parseInt(e.target.value) / 100)}
                  className="mt-1 w-full"
                />
              </label>

              {/* Brightness */}
              <label className="block">
                <span className="text-xs font-medium text-gray-600">
                  Brightness: {params.brightness.toFixed(1)}
                </span>
                <input
                  type="range"
                  min={50}
                  max={200}
                  value={params.brightness * 100}
                  onChange={(e) => handleParamChange("brightness", parseInt(e.target.value) / 100)}
                  className="mt-1 w-full"
                />
              </label>

              {/* Intensity */}
              <label className="block">
                <span className="text-xs font-medium text-gray-600">
                  Intensity: {params.intensity}
                </span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={params.intensity}
                  onChange={(e) => handleParamChange("intensity", parseInt(e.target.value))}
                  className="mt-1 w-full"
                />
              </label>

              {/* Line Width */}
              <label className="block">
                <span className="text-xs font-medium text-gray-600">
                  Line Width: {params.lineWidth}
                </span>
                <input
                  type="range"
                  min={0}
                  max={5}
                  value={params.lineWidth}
                  onChange={(e) => handleParamChange("lineWidth", parseInt(e.target.value))}
                  className="mt-1 w-full"
                />
              </label>

              {/* Color Mode */}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={params.colorMode}
                  onChange={(e) => handleParamChange("colorMode", e.target.checked)}
                  className="rounded"
                />
                <span className="text-xs font-medium text-gray-600">
                  Use original colors
                </span>
              </label>

              {/* Color pickers row */}
              <div className="flex gap-4">
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">Background</span>
                  <input
                    type="color"
                    value={params.backgroundColor}
                    onChange={(e) => handleParamChange("backgroundColor", e.target.value)}
                    className="mt-1 block h-8 w-12 cursor-pointer rounded border border-gray-200"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">Fill</span>
                  <input
                    type="color"
                    value={params.fillColor}
                    onChange={(e) => handleParamChange("fillColor", e.target.value)}
                    className="mt-1 block h-8 w-12 cursor-pointer rounded border border-gray-200"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">Lines</span>
                  <input
                    type="color"
                    value={params.lineColor}
                    onChange={(e) => handleParamChange("lineColor", e.target.value)}
                    className="mt-1 block h-8 w-12 cursor-pointer rounded border border-gray-200"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Generate button */}
          <button
            className="btn-primary w-full"
            disabled={!file || processing}
            onClick={() => handleGenerate(false)}
          >
            {processing ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" className="opacity-75" />
                </svg>
                Processing…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate Grid Art
              </>
            )}
          </button>

          {resultCanvas && (
            <button className="btn-secondary w-full" onClick={handleReset}>
              <RotateCcw className="h-4 w-4" />
              Start Fresh
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
