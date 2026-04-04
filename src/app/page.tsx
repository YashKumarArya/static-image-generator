"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
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
  ZoomIn,
  ZoomOut,
  Maximize2,
  Columns,
  Undo2,
  Redo2,
  ChevronDown,
  ChevronRight,
  X,
  Import,
  Paintbrush,
} from "lucide-react";
import {
  preprocessImage,
  renderGrid,
  downloadCanvas,
  downloadSVG,
  exportSVG,
  PRESETS,
  type PaletteEntry,
  type GridRenderOptions,
  type RenderMode,
  type CellShape,
  type ExportFormat,
  type PaletteHarmony,
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
  renderMode: RenderMode;
  colorVariation: number;
  cellShape: CellShape;
  saturation: number;
  edgeEnhance: number;
  blur: number;
  paletteHarmony: PaletteHarmony;
  customPalette: string[];
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
  renderMode: "standard",
  colorVariation: 0.15,
  cellShape: "square",
  saturation: 1.0,
  edgeEnhance: 0,
  blur: 0,
  paletteHarmony: "auto",
  customPalette: [],
};

// ── History management ──────────────────────────────────────────────

interface HistoryEntry {
  params: Params;
  label: string;
}

function useHistory(initialParams: Params) {
  const [history, setHistory] = useState<HistoryEntry[]>([
    { params: { ...initialParams }, label: "Initial" },
  ]);
  const [index, setIndex] = useState(0);

  const push = useCallback(
    (params: Params, label: string) => {
      setHistory((prev) => {
        const next = prev.slice(0, index + 1);
        next.push({ params: { ...params }, label });
        if (next.length > 50) next.shift();
        return next;
      });
      setIndex((prev) => Math.min(prev + 1, 50));
    },
    [index],
  );

  const undo = useCallback(() => {
    if (index > 0) setIndex((i) => i - 1);
  }, [index]);

  const redo = useCallback(() => {
    setIndex((i) => Math.min(i + 1, history.length - 1));
  }, [history.length]);

  const current = history[index]?.params ?? initialParams;
  const canUndo = index > 0;
  const canRedo = index < history.length - 1;

  return { current, push, undo, redo, canUndo, canRedo };
}

// ── Main component ──────────────────────────────────────────────────

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState("");

  const {
    current: params,
    push: pushHistory,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useHistory(DEFAULT_PARAMS);

  const [localParams, setLocalParams] = useState<Params>({ ...DEFAULT_PARAMS });

  useEffect(() => {
    setLocalParams({ ...params });
  }, [params]);

  const [resultCanvas, setResultCanvas] = useState<HTMLCanvasElement | null>(null);
  const [pbnCanvas, setPbnCanvas] = useState<HTMLCanvasElement | null>(null);
  const [palette, setPalette] = useState<PaletteEntry[]>([]);
  const [isRefined, setIsRefined] = useState(false);
  const [copiedColor, setCopiedColor] = useState<string | null>(null);

  const [zoom, setZoom] = useState(1);
  const [showCompare, setShowCompare] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPalettePanel, setShowPalettePanel] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("png");
  const [customPaletteInput, setCustomPaletteInput] = useState("");

  const preprocessedRef = useRef<{
    grayscale: Uint8Array;
    rgb: Uint8Array;
    width: number;
    height: number;
  } | null>(null);

  const resultRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (resultCanvas && canvasContainerRef.current) {
      canvasContainerRef.current.innerHTML = "";
      resultCanvas.style.maxWidth = "100%";
      resultCanvas.style.maxHeight = "70vh";
      resultCanvas.style.height = "auto";
      resultCanvas.style.width = "auto";
      resultCanvas.style.display = "block";
      resultCanvas.style.margin = "0 auto";
      resultCanvas.style.transform = `scale(${zoom})`;
      resultCanvas.style.transformOrigin = "center center";
      resultCanvas.style.transition = "transform 0.2s ease";
      canvasContainerRef.current.appendChild(resultCanvas);
    }
  }, [resultCanvas, zoom]);

  useEffect(() => {
    if (resultCanvas) {
      resultCanvas.style.transform = `scale(${zoom})`;
    }
  }, [zoom, resultCanvas]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const f = acceptedFiles[0];
    if (!f) return;
    setFile(f);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
    setResultCanvas(null);
    setPbnCanvas(null);
    setPalette([]);
    setIsRefined(false);
    preprocessedRef.current = null;
    setZoom(1);
    setShowCompare(false);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp"] },
    maxFiles: 1,
    multiple: false,
  });

  const handleGenerate = useCallback(
    async (refined = false) => {
      if (!file) return;
      setProcessing(true);
      setProgress("Preprocessing image…");

      try {
        if (!preprocessedRef.current) {
          const result = await preprocessImage(
            file,
            2000,
            localParams.contrast,
            localParams.brightness,
          );
          preprocessedRef.current = result;
        }

        const { grayscale, rgb, width, height } = preprocessedRef.current;

        setProgress(refined ? "Rendering refined grid…" : "Rendering grid…");
        await new Promise((r) => requestAnimationFrame(r));

        const opts: GridRenderOptions = {
          gridSize: localParams.gridSize,
          backgroundColor: localParams.backgroundColor,
          fillColor: localParams.fillColor,
          intensity: localParams.intensity,
          colorMode: localParams.colorMode,
          lineWidth: localParams.lineWidth,
          lineColor: localParams.lineColor,
          scale: 2,
          refined,
          renderMode: localParams.renderMode,
          colorVariation: localParams.colorVariation,
          cellShape: localParams.cellShape,
          saturation: localParams.saturation,
          edgeEnhance: localParams.edgeEnhance,
          blur: localParams.blur,
          paletteHarmony: localParams.paletteHarmony,
          customPalette: localParams.customPalette,
        };

        const result = renderGrid(grayscale, width, height, opts, rgb);

        setResultCanvas(result.canvas);
        setPbnCanvas(result.pbnCanvas);
        setPalette(result.palette);
        setIsRefined(refined);
        setProgress("");

        pushHistory(localParams, refined ? "Refined" : "Generated");

        setTimeout(
          () => resultRef.current?.scrollIntoView({ behavior: "smooth" }),
          100,
        );
      } catch (err) {
        console.error(err);
        setProgress(`Error: ${(err as Error).message}`);
      } finally {
        setProcessing(false);
      }
    },
    [file, localParams, pushHistory],
  );

  const handleReset = useCallback(() => {
    setFile(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setResultCanvas(null);
    setPbnCanvas(null);
    setPalette([]);
    setIsRefined(false);
    preprocessedRef.current = null;
    setLocalParams({ ...DEFAULT_PARAMS });
    setZoom(1);
    setShowCompare(false);
  }, []);

  const handleParamChange = useCallback(
    (key: keyof Params, value: number | string | boolean | string[]) => {
      setLocalParams((prev) => ({ ...prev, [key]: value }));
      if (key === "contrast" || key === "brightness") {
        preprocessedRef.current = null;
      }
    },
    [],
  );

  const handleApplyPreset = useCallback(
    (presetIdx: number) => {
      const preset = PRESETS[presetIdx];
      if (!preset) return;
      const newParams = { ...DEFAULT_PARAMS, ...localParams };
      const opts = preset.options;
      if (opts.gridSize !== undefined) newParams.gridSize = opts.gridSize;
      if (opts.renderMode !== undefined) newParams.renderMode = opts.renderMode as RenderMode;
      if (opts.colorMode !== undefined) newParams.colorMode = opts.colorMode;
      if (opts.lineWidth !== undefined) newParams.lineWidth = opts.lineWidth;
      if (opts.lineColor !== undefined) newParams.lineColor = opts.lineColor;
      if (opts.intensity !== undefined) newParams.intensity = opts.intensity;
      if (opts.colorVariation !== undefined) newParams.colorVariation = opts.colorVariation;
      if (opts.cellShape !== undefined) newParams.cellShape = opts.cellShape as CellShape;
      if (opts.saturation !== undefined) newParams.saturation = opts.saturation;
      if (opts.blur !== undefined) newParams.blur = opts.blur;
      if (opts.backgroundColor !== undefined) newParams.backgroundColor = opts.backgroundColor;
      if (opts.fillColor !== undefined) newParams.fillColor = opts.fillColor;
      if (opts.contrast !== undefined) {
        newParams.contrast = opts.contrast;
        preprocessedRef.current = null;
      }
      if (opts.brightness !== undefined) {
        newParams.brightness = opts.brightness;
        preprocessedRef.current = null;
      }
      setLocalParams(newParams);
    },
    [localParams],
  );

  const handleCopyColor = useCallback(async (hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopiedColor(hex);
      setTimeout(() => setCopiedColor(null), 1500);
    } catch {
      /* noop */
    }
  }, []);

  const handleExport = useCallback(() => {
    if (!resultCanvas) return;

    if (exportFormat === "svg" && preprocessedRef.current) {
      const { grayscale, rgb, width, height } = preprocessedRef.current;
      const svg = exportSVG(
        grayscale,
        width,
        height,
        {
          gridSize: localParams.gridSize,
          backgroundColor: localParams.backgroundColor,
          fillColor: localParams.fillColor,
          intensity: localParams.intensity,
          colorMode: localParams.colorMode,
          lineWidth: localParams.lineWidth,
          lineColor: localParams.lineColor,
          scale: 2,
          cellShape: localParams.cellShape,
          saturation: localParams.saturation,
        },
        rgb,
      );
      downloadSVG(svg, "grid-art.svg");
    } else {
      const ext = exportFormat === "jpeg" ? "jpg" : "png";
      downloadCanvas(resultCanvas, `grid-art.${ext}`, exportFormat);
    }
  }, [resultCanvas, exportFormat, localParams]);

  const handleImportPalette = useCallback(() => {
    const colors = customPaletteInput
      .split(/[,\s]+/)
      .map((c) => c.trim())
      .filter((c) => /^#[0-9a-fA-F]{6}$/.test(c));
    if (colors.length > 0) {
      handleParamChange("customPalette", colors);
    }
  }, [customPaletteInput, handleParamChange]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "=") {
        e.preventDefault();
        setZoom((z) => Math.min(z + 0.25, 4));
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "-") {
        e.preventDefault();
        setZoom((z) => Math.max(z - 0.25, 0.25));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  return (
    <div className="space-y-6">
      {/* ── Toolbar ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={undo}
          disabled={!canUndo}
          className="btn-icon"
          title="Undo (⌘Z)"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className="btn-icon"
          title="Redo (⌘⇧Z)"
        >
          <Redo2 className="h-4 w-4" />
        </button>
        <div className="mx-1 h-5 w-px bg-gray-200" />
        <button
          onClick={() => setZoom((z) => Math.min(z + 0.25, 4))}
          disabled={!resultCanvas}
          className="btn-icon"
          title="Zoom In (⌘+)"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <span className="text-xs font-mono text-gray-500 min-w-[3rem] text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom((z) => Math.max(z - 0.25, 0.25))}
          disabled={!resultCanvas}
          className="btn-icon"
          title="Zoom Out (⌘-)"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          onClick={() => setZoom(1)}
          disabled={!resultCanvas}
          className="btn-icon"
          title="Reset Zoom"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
        <div className="mx-1 h-5 w-px bg-gray-200" />
        <button
          onClick={() => setShowCompare((v) => !v)}
          disabled={!resultCanvas || !previewUrl}
          className={`btn-icon ${showCompare ? "bg-blue-50 text-blue-600 border-blue-200" : ""}`}
          title="Side-by-side Compare"
        >
          <Columns className="h-4 w-4" />
        </button>
      </div>

      {/* ── Result ──────────────────────────────────────────────── */}
      {resultCanvas && (
        <div ref={resultRef} className="card space-y-4">
          <h3 className="text-sm font-semibold text-gray-900">Result</h3>

          {showCompare && previewUrl ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="overflow-hidden rounded-xl bg-gray-100">
                <div className="p-1 text-center text-xs text-gray-400 font-medium">Original</div>
                <img
                  src={previewUrl}
                  alt="Original"
                  className="max-h-[50vh] w-full object-contain"
                />
              </div>
              <div className="overflow-hidden rounded-xl bg-gray-100">
                <div className="p-1 text-center text-xs text-gray-400 font-medium">Grid Art</div>
                <div className="flex items-center justify-center p-2">
                  <canvas
                    ref={(el) => {
                      if (el && resultCanvas) {
                        const parent = el.parentElement;
                        if (parent && !parent.querySelector("canvas[data-compare]")) {
                          const clone = document.createElement("canvas");
                          clone.width = resultCanvas.width;
                          clone.height = resultCanvas.height;
                          clone.getContext("2d")!.drawImage(resultCanvas, 0, 0);
                          clone.style.maxWidth = "100%";
                          clone.style.maxHeight = "50vh";
                          clone.style.height = "auto";
                          clone.style.width = "auto";
                          clone.style.display = "block";
                          clone.style.margin = "0 auto";
                          clone.setAttribute("data-compare", "true");
                          parent.appendChild(clone);
                        }
                      }
                    }}
                    style={{ display: "none" }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="overflow-auto rounded-xl bg-gray-100" style={{ maxHeight: `${Math.max(70, zoom * 70)}vh` }}>
              <div
                ref={canvasContainerRef}
                className="flex items-center justify-center p-4"
              />
            </div>
          )}

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

          {/* Export & action buttons */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-500">Format:</label>
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                className="rounded border border-gray-200 px-2 py-1 text-xs"
              >
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
                <option value="svg">SVG (vector)</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-3">
              {!isRefined && (
                <button
                  onClick={() => handleGenerate(true)}
                  disabled={processing}
                  className="btn-secondary"
                >
                  <Wand2 className="h-4 w-4" />
                  Refine
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
              <button onClick={handleExport} className="btn-primary">
                <Download className="h-4 w-4" />
                Download {exportFormat.toUpperCase()}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Progress */}
      {processing && progress && (
        <div className="card text-center">
          <div className="flex items-center justify-center gap-3 text-sm text-gray-600">
            <svg
              className="h-5 w-5 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                className="opacity-25"
              />
              <path
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                fill="currentColor"
                className="opacity-75"
              />
            </svg>
            {progress}
          </div>
        </div>
      )}

      {/* ── Upload + Controls ────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-3 md:grid-cols-2">
        {/* Left: Upload */}
        <div className="space-y-6">
          <div>
            <h3 className="mb-3 text-sm font-semibold text-gray-900">
              1. Upload Image
            </h3>
            <div
              {...getRootProps()}
              className={`card flex min-h-[200px] cursor-pointer items-center justify-center transition-colors ${
                isDragActive
                  ? "border-blue-400 bg-blue-50"
                  : "hover:border-gray-300"
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

          {/* Presets */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-gray-900">
              Presets
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((preset, i) => (
                <button
                  key={preset.name}
                  onClick={() => handleApplyPreset(i)}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-left transition-all hover:border-gray-300 hover:shadow-sm"
                >
                  <span className="block text-xs font-semibold text-gray-800">
                    {preset.name}
                  </span>
                  <span className="block text-[10px] text-gray-400 leading-tight">
                    {preset.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Middle: Core Controls */}
        <div className="space-y-6">
          <div>
            <h3 className="mb-3 text-sm font-semibold text-gray-900">
              2. Adjust Settings
            </h3>
            <div className="card space-y-4">
              {/* Grid Size */}
              <label className="block">
                <span className="text-xs font-medium text-gray-600">
                  Grid Size: {localParams.gridSize}
                </span>
                <input
                  type="range"
                  min={3}
                  max={50}
                  value={localParams.gridSize}
                  onChange={(e) =>
                    handleParamChange("gridSize", parseInt(e.target.value))
                  }
                  className="mt-1 w-full"
                />
              </label>

              {/* Render Mode */}
              <label className="block">
                <span className="text-xs font-medium text-gray-600">
                  Render Mode
                </span>
                <select
                  value={localParams.renderMode}
                  onChange={(e) =>
                    handleParamChange("renderMode", e.target.value)
                  }
                  className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm"
                >
                  <option value="standard">Standard</option>
                  <option value="dithered">Dithered</option>
                  <option value="artistic">Artistic Colors</option>
                  <option value="halftone">Halftone Print</option>
                  <option value="mosaic">Mosaic Tile</option>
                  <option value="watercolor">Watercolor</option>
                  <option value="crosshatch">Crosshatch Sketch</option>
                  <option value="pointillist">Pointillist</option>
                </select>
              </label>

              {/* Cell Shape */}
              <label className="block">
                <span className="text-xs font-medium text-gray-600">
                  Cell Shape
                </span>
                <select
                  value={localParams.cellShape}
                  onChange={(e) =>
                    handleParamChange("cellShape", e.target.value)
                  }
                  className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm"
                >
                  <option value="square">Square</option>
                  <option value="circle">Circle</option>
                  <option value="diamond">Diamond</option>
                  <option value="triangle">Triangle</option>
                  <option value="hexagon">Hexagon</option>
                </select>
              </label>

              {/* Contrast */}
              <label className="block">
                <span className="text-xs font-medium text-gray-600">
                  Contrast: {localParams.contrast.toFixed(1)}
                </span>
                <input
                  type="range"
                  min={50}
                  max={250}
                  value={localParams.contrast * 100}
                  onChange={(e) =>
                    handleParamChange(
                      "contrast",
                      parseInt(e.target.value) / 100,
                    )
                  }
                  className="mt-1 w-full"
                />
              </label>

              {/* Brightness */}
              <label className="block">
                <span className="text-xs font-medium text-gray-600">
                  Brightness: {localParams.brightness.toFixed(1)}
                </span>
                <input
                  type="range"
                  min={50}
                  max={200}
                  value={localParams.brightness * 100}
                  onChange={(e) =>
                    handleParamChange(
                      "brightness",
                      parseInt(e.target.value) / 100,
                    )
                  }
                  className="mt-1 w-full"
                />
              </label>

              {/* Intensity */}
              <label className="block">
                <span className="text-xs font-medium text-gray-600">
                  Intensity: {localParams.intensity}
                </span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={localParams.intensity}
                  onChange={(e) =>
                    handleParamChange("intensity", parseInt(e.target.value))
                  }
                  className="mt-1 w-full"
                />
              </label>

              {/* Saturation */}
              <label className="block">
                <span className="text-xs font-medium text-gray-600">
                  Saturation: {localParams.saturation.toFixed(1)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={localParams.saturation * 100}
                  onChange={(e) =>
                    handleParamChange(
                      "saturation",
                      parseInt(e.target.value) / 100,
                    )
                  }
                  className="mt-1 w-full"
                />
              </label>

              {/* Line Width */}
              <label className="block">
                <span className="text-xs font-medium text-gray-600">
                  Line Width: {localParams.lineWidth}
                </span>
                <input
                  type="range"
                  min={0}
                  max={5}
                  value={localParams.lineWidth}
                  onChange={(e) =>
                    handleParamChange("lineWidth", parseInt(e.target.value))
                  }
                  className="mt-1 w-full"
                />
              </label>

              {/* Color Mode */}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={localParams.colorMode}
                  onChange={(e) =>
                    handleParamChange("colorMode", e.target.checked)
                  }
                  className="rounded"
                />
                <span className="text-xs font-medium text-gray-600">
                  Use original colors
                </span>
              </label>

              {/* Color Variation */}
              {localParams.colorMode && (
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">
                    Color Variation:{" "}
                    {(localParams.colorVariation * 100).toFixed(0)}%
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={50}
                    value={localParams.colorVariation * 100}
                    onChange={(e) =>
                      handleParamChange(
                        "colorVariation",
                        parseInt(e.target.value) / 100,
                      )
                    }
                    className="mt-1 w-full"
                  />
                </label>
              )}

              {/* Color pickers */}
              <div className="flex gap-4">
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">
                    Background
                  </span>
                  <input
                    type="color"
                    value={localParams.backgroundColor}
                    onChange={(e) =>
                      handleParamChange("backgroundColor", e.target.value)
                    }
                    className="mt-1 block h-8 w-12 cursor-pointer rounded border border-gray-200"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">
                    Fill
                  </span>
                  <input
                    type="color"
                    value={localParams.fillColor}
                    onChange={(e) =>
                      handleParamChange("fillColor", e.target.value)
                    }
                    className="mt-1 block h-8 w-12 cursor-pointer rounded border border-gray-200"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">
                    Lines
                  </span>
                  <input
                    type="color"
                    value={localParams.lineColor}
                    onChange={(e) =>
                      handleParamChange("lineColor", e.target.value)
                    }
                    className="mt-1 block h-8 w-12 cursor-pointer rounded border border-gray-200"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Advanced + Actions */}
        <div className="space-y-6">
          {/* Advanced controls */}
          <div>
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="mb-3 flex items-center gap-1 text-sm font-semibold text-gray-900"
            >
              {showAdvanced ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              3. Advanced Options
            </button>
            {showAdvanced && (
              <div className="card space-y-4">
                {/* Edge Enhance */}
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">
                    Edge Enhancement: {localParams.edgeEnhance.toFixed(1)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={localParams.edgeEnhance * 100}
                    onChange={(e) =>
                      handleParamChange(
                        "edgeEnhance",
                        parseInt(e.target.value) / 100,
                      )
                    }
                    className="mt-1 w-full"
                  />
                </label>

                {/* Blur */}
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">
                    Softness/Blur: {localParams.blur.toFixed(1)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={localParams.blur * 100}
                    onChange={(e) =>
                      handleParamChange(
                        "blur",
                        parseInt(e.target.value) / 100,
                      )
                    }
                    className="mt-1 w-full"
                  />
                </label>

                {/* Palette Harmony */}
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">
                    Palette Harmony
                  </span>
                  <select
                    value={localParams.paletteHarmony}
                    onChange={(e) =>
                      handleParamChange("paletteHarmony", e.target.value)
                    }
                    className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm"
                  >
                    <option value="auto">Auto (natural)</option>
                    <option value="complementary">Complementary</option>
                    <option value="analogous">Analogous</option>
                    <option value="triadic">Triadic</option>
                    <option value="monochromatic">Monochromatic</option>
                  </select>
                </label>

                {/* Custom Palette Import */}
                <div className="space-y-2">
                  <button
                    onClick={() => setShowPalettePanel((v) => !v)}
                    className="flex items-center gap-1 text-xs font-medium text-gray-600"
                  >
                    <Import className="h-3 w-3" />
                    Import Custom Palette
                  </button>
                  {showPalettePanel && (
                    <div className="space-y-2">
                      <input
                        type="text"
                        placeholder="#ff0000, #00ff00, #0000ff"
                        value={customPaletteInput}
                        onChange={(e) =>
                          setCustomPaletteInput(e.target.value)
                        }
                        className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleImportPalette}
                          className="btn-secondary text-xs"
                        >
                          <Paintbrush className="h-3 w-3" />
                          Apply
                        </button>
                        {localParams.customPalette.length > 0 && (
                          <button
                            onClick={() =>
                              handleParamChange("customPalette", [])
                            }
                            className="btn-secondary text-xs"
                          >
                            <X className="h-3 w-3" />
                            Clear
                          </button>
                        )}
                      </div>
                      {localParams.customPalette.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {localParams.customPalette.map((c) => (
                            <span
                              key={c}
                              className="inline-block h-5 w-5 rounded border border-gray-300"
                              style={{ backgroundColor: c }}
                              title={c}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Generate buttons */}
          <button
            className="btn-primary w-full"
            disabled={!file || processing}
            onClick={() => handleGenerate(false)}
          >
            {processing ? (
              <>
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    className="opacity-25"
                  />
                  <path
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    fill="currentColor"
                    className="opacity-75"
                  />
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

          {/* Keyboard shortcuts help */}
          <div className="rounded-lg bg-gray-50 p-3 text-[10px] text-gray-400 space-y-0.5">
            <p className="font-semibold text-gray-500 text-xs mb-1">Shortcuts</p>
            <p>⌘Z — Undo &nbsp; ⌘⇧Z — Redo</p>
            <p>⌘+ — Zoom In &nbsp; ⌘- — Zoom Out</p>
          </div>
        </div>
      </div>
    </div>
  );
}
