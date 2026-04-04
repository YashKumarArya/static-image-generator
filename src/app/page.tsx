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
  MousePointerClick,
  Grid3X3,
} from "lucide-react";
import {
  preprocessImage,
  renderGrid,
  renderDrawCanvas,
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

  // Draw section state
  const [drawNumberMap, setDrawNumberMap] = useState<number[][] | null>(null);
  const [drawCols, setDrawCols] = useState(0);
  const [drawRows, setDrawRows] = useState(0);
  const [drawCellPx, setDrawCellPx] = useState(28);
  const [filledNumbers, setFilledNumbers] = useState<Record<number, string>>({});
  const [cellOverrides, setCellOverrides] = useState<Record<string, string>>({});
  const [selectedPaletteIdx, setSelectedPaletteIdx] = useState<number>(0);
  const [drawMode, setDrawMode] = useState<"group" | "single">("group");
  const [activeTab, setActiveTab] = useState<"result" | "draw">("result");
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);

  // Refine color count
  const [refineColorCount, setRefineColorCount] = useState<number>(8);

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
    _maxDim: number;
  } | null>(null);

  const resultRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const generateIdRef = useRef(0);

  // Safely mount result canvas into the container
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;
    // Remove all existing children safely
    while (container.firstChild) container.removeChild(container.firstChild);
    if (!resultCanvas) return;
    resultCanvas.style.maxWidth = "100%";
    resultCanvas.style.maxHeight = "70vh";
    resultCanvas.style.height = "auto";
    resultCanvas.style.width = "auto";
    resultCanvas.style.display = "block";
    resultCanvas.style.margin = "0 auto";
    resultCanvas.style.transform = `scale(${zoom})`;
    resultCanvas.style.transformOrigin = "center center";
    resultCanvas.style.transition = "transform 0.2s ease";
    container.appendChild(resultCanvas);
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
      const genId = ++generateIdRef.current;

      // Clear previous result immediately so UI shows loading state
      setResultCanvas(null);
      setPbnCanvas(null);
      setProcessing(true);
      setProgress("Preprocessing image…");
      setActiveTab("result");

      // Detect mobile/tablet — use lower scale & dimension to avoid canvas memory limits
      const isMobileDevice = window.innerWidth < 1024 || navigator.maxTouchPoints > 1;
      const scale = isMobileDevice ? 1 : 2;
      const maxDim = isMobileDevice ? 1000 : 1400;

      try {
        // Always re-preprocess if contrast/brightness may have changed
        if (!preprocessedRef.current || preprocessedRef.current._maxDim !== maxDim) {
          const result = await preprocessImage(
            file,
            maxDim,
            localParams.contrast,
            localParams.brightness,
          );
          // Abort if a newer generate was triggered
          if (genId !== generateIdRef.current) return;
          preprocessedRef.current = { ...result, _maxDim: maxDim };
        }

        const { grayscale, rgb, width, height } = preprocessedRef.current;

        setProgress(refined ? "Rendering refined grid…" : "Rendering grid…");
        // Yield to let React commit the progress UI update before heavy sync work
        await new Promise((r) => setTimeout(r, 50));
        if (genId !== generateIdRef.current) return;

        const opts: GridRenderOptions = {
          gridSize: localParams.gridSize,
          backgroundColor: localParams.backgroundColor,
          fillColor: localParams.fillColor,
          intensity: localParams.intensity,
          colorMode: localParams.colorMode,
          lineWidth: localParams.lineWidth,
          lineColor: localParams.lineColor,
          scale,
          refined,
          renderMode: localParams.renderMode,
          colorVariation: localParams.colorVariation,
          cellShape: localParams.cellShape,
          saturation: localParams.saturation,
          edgeEnhance: localParams.edgeEnhance,
          blur: localParams.blur,
          paletteHarmony: localParams.paletteHarmony,
          customPalette: localParams.customPalette,
          maxRefineColors: refineColorCount,
        };

        const result = renderGrid(grayscale, width, height, opts, rgb);
        if (genId !== generateIdRef.current) return;

        setResultCanvas(result.canvas);
        setPbnCanvas(result.pbnCanvas);
        setPalette(result.palette);
        setIsRefined(refined);
        setProgress("");

        // Store draw data
        setDrawNumberMap(result.numberMap);
        setDrawCols(result.drawCols);
        setDrawRows(result.drawRows);
        setDrawCellPx(result.drawCellPx);
        setFilledNumbers({});
        setCellOverrides({});
        setSelectedPaletteIdx(0);

        pushHistory(localParams, refined ? "Refined" : "Generated");

        setTimeout(
          () => resultRef.current?.scrollIntoView({ behavior: "smooth" }),
          100,
        );
      } catch (err) {
        console.error(err);
        if (genId === generateIdRef.current) {
          setProgress(`Error: ${(err as Error).message}`);
        }
      } finally {
        if (genId === generateIdRef.current) {
          setProcessing(false);
        }
      }
    },
    [file, localParams, pushHistory, refineColorCount],
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
    setDrawNumberMap(null);
    setFilledNumbers({});
    setCellOverrides({});
    setActiveTab("result");
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

  // Re-render draw canvas whenever filled state, data, or active tab changes
  useEffect(() => {
    if (activeTab !== "draw") return;
    // requestAnimationFrame ensures the canvas element is mounted in the DOM
    const raf = requestAnimationFrame(() => {
      const canvas = drawCanvasRef.current;
      if (!canvas || !drawNumberMap || palette.length === 0) return;
      canvas.width = drawCols * drawCellPx;
      canvas.height = drawRows * drawCellPx;
      renderDrawCanvas(
        canvas,
        drawNumberMap,
        drawCols,
        drawRows,
        drawCellPx,
        palette,
        filledNumbers,
        localParams.backgroundColor,
        localParams.lineColor,
        cellOverrides,
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [activeTab, drawNumberMap, drawCols, drawRows, drawCellPx, palette, filledNumbers, cellOverrides, localParams.backgroundColor, localParams.lineColor]);

  const handleDrawClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!drawNumberMap || palette.length === 0) return;
      const canvas = drawCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      const col = Math.floor(x / drawCellPx);
      const row = Math.floor(y / drawCellPx);
      if (row < 0 || row >= drawRows || col < 0 || col >= drawCols) return;
      const num = drawNumberMap[row][col];
      const pickedColor = palette[selectedPaletteIdx]?.color;
      if (!pickedColor) return;

      if (drawMode === "single") {
        // Paint only this single cell
        const key = `${row},${col}`;
        setCellOverrides((prev) => ({ ...prev, [key]: pickedColor }));
      } else {
        // Fill all cells with this number
        setFilledNumbers((prev) => ({ ...prev, [num]: pickedColor }));
      }
    },
    [drawNumberMap, drawCols, drawRows, drawCellPx, palette, selectedPaletteIdx, drawMode],
  );

  const handleDrawClear = useCallback(() => {
    setFilledNumbers({});
    setCellOverrides({});
  }, []);

  const handleUnfillNumber = useCallback((num: number) => {
    setFilledNumbers((prev) => {
      const next = { ...prev };
      delete next[num];
      return next;
    });
    // Also remove any single-cell overrides for cells with this number
    if (drawNumberMap) {
      setCellOverrides((prev) => {
        const next = { ...prev };
        for (let row = 0; row < drawRows; row++) {
          for (let col = 0; col < drawCols; col++) {
            if (drawNumberMap[row][col] === num) {
              delete next[`${row},${col}`];
            }
          }
        }
        return next;
      });
    }
  }, [drawNumberMap, drawRows, drawCols]);

  const totalCells = drawCols * drawRows;
  const filledCells = useMemo(() => {
    if (!drawNumberMap) return 0;
    let count = 0;
    for (let r = 0; r < drawRows; r++) {
      for (let c = 0; c < drawCols; c++) {
        if (cellOverrides[`${r},${c}`] !== undefined || filledNumbers[drawNumberMap[r][c]] !== undefined) {
          count++;
        }
      }
    }
    return count;
  }, [drawNumberMap, drawRows, drawCols, cellOverrides, filledNumbers]);
  const fillProgress = totalCells > 0 ? Math.round((filledCells / totalCells) * 100) : 0;

  // basePath for images
  const bp = process.env.NODE_ENV === "production" ? "/static-image-generator" : "";

  return (
    <>
      {/* ════════════════════════════════════════════════════════════════
          HERO SECTION
      ════════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden min-h-screen flex flex-col bg-purple-950">
        {/* Horizontally scrolling image marquee */}
        <div className="flex-1 relative overflow-hidden flex items-center">
          <div className="animate-marquee flex gap-4 w-max">
            {/* Duplicate the set for seamless loop */}
            {[...Array(2)].map((_, setIdx) => (
              ["dithered2.png", "grid-art-2.png", "grid-art-8.png", "grid-girl.png", "grid-art-8.png", "dithered2.png", "grid-art-2.png"].map((img, i) => (
                <div key={`${setIdx}-${i}`} className="flex-shrink-0 h-[45vh] sm:h-[55vh] lg:h-[60vh] overflow-hidden rounded-xl sm:rounded-2xl">
                  <img
                    src={`${bp}/pngs/background/${img}`}
                    alt="Grid art showcase"
                    loading="lazy"
                    decoding="async"
                    className="h-full w-auto object-cover"
                  />
                </div>
              ))
            ))}
          </div>
          {/* Edge fades */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-purple-950 to-transparent z-10" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-purple-950 to-transparent z-10" />
        </div>

        {/* Content overlay at bottom */}
        <div className="relative z-20 pb-16 pt-8">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 text-center">
            {/* Logo from logo folder */}
            <div className="mb-6 flex justify-center">
              <img
                src={`${bp}/pngs/logo/logo.png`}
                alt="Grido Logo"
                className="h-20 sm:h-24 object-contain drop-shadow-lg"
              />
            </div>

            <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-7xl">
              Grid Art <span className="bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text text-transparent">Generator</span>
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-purple-200/80 sm:text-lg lg:text-xl">
              Transform any photo into stunning grid art — 8 render modes, smart color refinement,
              interactive paint-by-numbers drawing. 100&nbsp;% in your browser.
            </p>

            {/* Stats chips */}
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {["8 Render Modes", "5 Cell Shapes", "Paint-by-Numbers", "SVG · PNG · JPEG"].map((s) => (
                <span key={s} className="rounded-full border border-purple-400/30 bg-purple-900/50 px-3 sm:px-4 py-1.5 text-xs font-medium text-purple-200">
                  {s}
                </span>
              ))}
            </div>

            {/* CTA */}
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
              <a href="#tool" className="btn-primary text-base px-8 py-3 shadow-lg shadow-purple-900/40 hover:shadow-purple-500/30">
                <Sparkles className="h-5 w-5" />
                Start Creating
              </a>
              <a href="#features" className="btn-ghost text-base border border-purple-400/30 bg-purple-900/30">
                See Features ↓
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════
          FEATURE SHOWCASE
      ════════════════════════════════════════════════════════════════ */}
      {/* ════════════════════════════════════════════════════════════════
          FEATURE SECTIONS — each is full-screen
      ════════════════════════════════════════════════════════════════ */}

      {/* ── 1. Flexible Grid Sizes ── */}
      <section id="features" className="min-h-[80vh] sm:min-h-screen flex flex-col justify-center bg-purple-900 py-12 sm:py-20">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* Text on top */}
          <div className="text-center mb-12">
            <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-800">
              <Grid3X3 className="h-7 w-7 text-purple-300" />
            </div>
            <h2 className="text-3xl font-bold text-white sm:text-4xl">Flexible Grid Sizes</h2>
            <p className="mt-3 max-w-2xl mx-auto text-purple-200/70 leading-relaxed">
              From tiny pixel art to detailed mosaics — adjust grid size from 3 to 50 cells.
              See how the same image transforms at different resolutions.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              {["Small (3–8)", "Medium (10–20)", "Large (25–50)"].map((label) => (
                <span key={label} className="rounded-full bg-purple-800/60 border border-purple-500/30 px-4 py-1.5 text-xs font-semibold text-purple-200">{label}</span>
              ))}
            </div>
          </div>
          {/* Big images side-by-side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
            {["small-grid-size.png", "mid-grid-size.png", "large-grid-size.png"].map((img) => (
              <div key={img} className="overflow-hidden rounded-2xl sm:rounded-3xl border border-purple-500/20 shadow-lg shadow-purple-950/40 transition-transform hover:scale-[1.02]">
                <img
                  src={`${bp}/pngs/size/${img}`}
                  alt="Grid size example"
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 2. 8 Render Modes ── */}
      <section className="min-h-[80vh] sm:min-h-screen flex flex-col justify-center bg-purple-950 py-12 sm:py-20">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-800">
              <Wand2 className="h-7 w-7 text-purple-300" />
            </div>
            <h2 className="text-3xl font-bold text-white sm:text-4xl">8 Render Modes</h2>
            <p className="mt-3 max-w-2xl mx-auto text-purple-200/70 leading-relaxed">
              From clean vector grids to expressive artistic styles — every mode produces a unique look.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {["Standard", "Dithered", "Artistic", "Halftone", "Mosaic", "Watercolor", "Crosshatch", "Pointillist"].map((m) => (
                <span key={m} className="rounded-full bg-purple-800/60 border border-purple-500/30 px-4 py-1.5 text-xs font-semibold text-purple-200">{m}</span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
            {["dithered1.png", "dithered2.png", "dithered3.png"].map((img) => (
              <div key={img} className="overflow-hidden rounded-2xl sm:rounded-3xl border border-purple-500/20 shadow-lg shadow-purple-950/40 transition-transform hover:scale-[1.02]">
                <img
                  src={`${bp}/pngs/dithered/${img}`}
                  alt="Render mode example"
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 3. Interactive Drawing ── */}
      <section className="min-h-[80vh] sm:min-h-screen flex flex-col justify-center bg-purple-900 py-12 sm:py-20">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-800">
              <Paintbrush className="h-7 w-7 text-purple-300" />
            </div>
            <h2 className="text-3xl font-bold text-white sm:text-4xl">Interactive Drawing</h2>
            <p className="mt-3 max-w-2xl mx-auto text-purple-200/70 leading-relaxed">
              Paint-by-numbers with group fill or single-cell precision. See your reference side-by-side.
            </p>
          </div>
          <div className="mx-auto max-w-4xl overflow-hidden rounded-2xl sm:rounded-3xl border border-purple-500/20 shadow-lg shadow-purple-950/40">
            <img
              src={`${bp}/pngs/drawing/drawFeature.png`}
              alt="Drawing feature"
              loading="lazy"
              decoding="async"
              className="w-full object-cover"
            />
          </div>
        </div>
      </section>

      {/* ── 4. Smart Refine  ·  Export  ·  Privacy ── */}
      <section className="min-h-[60vh] sm:min-h-[70vh] flex flex-col justify-center bg-purple-950 py-12 sm:py-20">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <span className="inline-block rounded-full bg-purple-800/60 border border-purple-500/30 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-purple-200 mb-4">And more</span>
            <h2 className="text-3xl font-bold text-white sm:text-4xl">Powerful Extras</h2>
          </div>
          <div className="grid gap-4 sm:gap-6 sm:grid-cols-2 md:grid-cols-3">
            {/* Smart Refine */}
            <div className="feature-card">
              <div className="mb-4 inline-flex items-center justify-center rounded-xl bg-purple-800 p-3">
                <Palette className="h-6 w-6 text-purple-300" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Smart Color Refinement</h3>
              <p className="text-sm text-purple-200/60 mb-4">
                Auto-refine or choose exactly how many colors. Reduce a 32-color palette down to 2–12.
              </p>
              <div className="flex items-center gap-3 rounded-lg bg-purple-900/50 p-3">
                <div className="flex gap-1">
                  {["#7e22ce", "#c084fc", "#f3e8ff", "#581c87"].map((c) => (
                    <span key={c} className="h-7 w-7 rounded-full border-2 border-purple-800 shadow" style={{ backgroundColor: c }} />
                  ))}
                </div>
                <span className="text-xs text-purple-300 font-medium">→ Your pick</span>
              </div>
            </div>

            {/* Export */}
            <div className="feature-card">
              <div className="mb-4 inline-flex items-center justify-center rounded-xl bg-purple-800 p-3">
                <Download className="h-6 w-6 text-purple-300" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Multi-Format Export</h3>
              <p className="text-sm text-purple-200/60 mb-4">
                Download as PNG, JPEG, or SVG vector. Plus paint-by-numbers companion sheets.
              </p>
              <div className="flex gap-2">
                {["PNG", "JPEG", "SVG"].map((fmt) => (
                  <span key={fmt} className="rounded-lg bg-purple-800/60 px-4 py-2 text-sm font-bold text-purple-200">{fmt}</span>
                ))}
              </div>
            </div>

            {/* Privacy */}
            <div className="feature-card">
              <div className="mb-4 inline-flex items-center justify-center rounded-xl bg-purple-800 p-3">
                <Upload className="h-6 w-6 text-purple-300" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">100% Private</h3>
              <p className="text-sm text-purple-200/60 mb-4">
                Everything runs in your browser. No server uploads, no data collection.
              </p>
              <div className="rounded-lg bg-emerald-900/40 border border-emerald-500/30 px-4 py-3 text-sm text-emerald-300 font-medium text-center">
                🔒 Zero data sent to any server
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════
          TOOL SECTION
      ════════════════════════════════════════════════════════════════ */}
      <section id="tool" className="py-12 bg-purple-50/50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-6">

          {/* Section heading */}
          <div className="text-center">
            <h2 className="text-2xl font-bold text-purple-900">Create Your Grid Art</h2>
            <p className="mt-1 text-sm text-purple-500">Upload → Customize → Download</p>
          </div>

      {/* ── Toolbar ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 justify-center">
        <button onClick={undo} disabled={!canUndo} className="btn-icon" title="Undo (⌘Z)">
          <Undo2 className="h-4 w-4" />
        </button>
        <button onClick={redo} disabled={!canRedo} className="btn-icon" title="Redo (⌘⇧Z)">
          <Redo2 className="h-4 w-4" />
        </button>
        <div className="mx-1 h-5 w-px bg-purple-200" />
        <button onClick={() => setZoom((z) => Math.min(z + 0.25, 4))} disabled={!resultCanvas} className="btn-icon" title="Zoom In (⌘+)">
          <ZoomIn className="h-4 w-4" />
        </button>
        <span className="text-xs font-mono text-purple-500 min-w-[3rem] text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.max(z - 0.25, 0.25))} disabled={!resultCanvas} className="btn-icon" title="Zoom Out (⌘-)">
          <ZoomOut className="h-4 w-4" />
        </button>
        <button onClick={() => setZoom(1)} disabled={!resultCanvas} className="btn-icon" title="Reset Zoom">
          <Maximize2 className="h-4 w-4" />
        </button>
        <div className="mx-1 h-5 w-px bg-purple-200" />
        <button
          onClick={() => setShowCompare((v) => !v)}
          disabled={!resultCanvas || !previewUrl}
          className={`btn-icon ${showCompare ? "bg-purple-100 text-purple-700 border-purple-300" : ""}`}
          title="Side-by-side Compare"
        >
          <Columns className="h-4 w-4" />
        </button>
      </div>

      {/* ── Result ──────────────────────────────────────────────── */}
      {resultCanvas && (
        <div ref={resultRef} className="card space-y-4">
          {/* Tab switcher */}
          <div className="flex items-center gap-1 border-b border-purple-100 pb-3">
            <button
              onClick={() => setActiveTab("result")}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
                activeTab === "result"
                  ? "bg-purple-600 text-white"
                  : "text-purple-400 hover:bg-purple-50"
              }`}
            >
              Result
            </button>
            {drawNumberMap && (
              <button
                onClick={() => setActiveTab("draw")}
                className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
                  activeTab === "draw"
                    ? "bg-purple-600 text-white"
                    : "text-purple-400 hover:bg-purple-50"
                }`}
              >
                <Palette className="h-3.5 w-3.5" />
                Draw
                {fillProgress > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    activeTab === "draw" ? "bg-white/20 text-white" : "bg-purple-100 text-purple-600"
                  }`}>
                    {fillProgress}%
                  </span>
                )}
              </button>
            )}
          </div>

          {/* ── Result tab ── */}
          {activeTab === "result" && (
            <>
          {showCompare && previewUrl ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="overflow-hidden rounded-xl bg-purple-50">
                <div className="p-1 text-center text-xs text-purple-400 font-medium">Original</div>
                <img src={previewUrl} alt="Original" className="max-h-[50vh] w-full object-contain" />
              </div>
              <div className="overflow-hidden rounded-xl bg-purple-50">
                <div className="p-1 text-center text-xs text-purple-400 font-medium">Grid Art</div>
                <div className="flex items-center justify-center p-2">
                  <canvas
                    ref={(el) => {
                      if (el && resultCanvas) {
                        const parent = el.parentElement;
                        if (parent && !parent.querySelector("canvas[data-compare]")) {
                          const clone = document.createElement("canvas");
                          clone.width = resultCanvas.width;
                          clone.height = resultCanvas.height;
                          const cloneCtx = clone.getContext("2d");
                          if (cloneCtx) cloneCtx.drawImage(resultCanvas, 0, 0);
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
            <div className="overflow-auto rounded-xl bg-purple-50/50" style={{ maxHeight: `${Math.max(70, zoom * 70)}vh` }}>
              <div ref={canvasContainerRef} className="flex items-center justify-center p-4" />
            </div>
          )}

          {/* Palette */}
          {palette.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-purple-500">
                Colours ({palette.length})
              </h4>
              <div className="flex flex-wrap gap-2">
                {palette.map((entry) => (
                  <button
                    key={entry.color}
                    type="button"
                    title={`${entry.color} — ${entry.count} cells`}
                    onClick={() => handleCopyColor(entry.color)}
                    className="group flex items-center gap-1.5 rounded-lg border border-purple-100 bg-white px-2 py-1.5 text-xs transition-all hover:border-purple-300 hover:shadow-sm"
                  >
                    <span className="inline-block h-5 w-5 flex-shrink-0 rounded border border-purple-100" style={{ backgroundColor: entry.color }} />
                    <span className="font-mono text-gray-600 group-hover:text-purple-700">{entry.color}</span>
                    {copiedColor === entry.color ? (
                      <Check className="h-3 w-3 text-green-500" />
                    ) : (
                      <Copy className="h-3 w-3 text-purple-200 opacity-0 group-hover:opacity-100" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Export & Refine */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-purple-500">Format:</label>
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                className="rounded border border-purple-200 bg-white px-2 py-1 text-xs text-purple-700"
              >
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
                <option value="svg">SVG (vector)</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              {/* Refine controls — Auto + Custom */}
              {!isRefined && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-purple-100 bg-purple-50/50 px-3 py-2">
                  <button
                    onClick={() => {
                      setRefineColorCount(12);
                      handleGenerate(true);
                    }}
                    disabled={processing}
                    className="btn-secondary text-xs py-1 px-3"
                    title="Auto-refine to optimal colors"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    Auto
                  </button>
                  <div className="h-5 w-px bg-purple-200 hidden sm:block" />
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] font-medium text-purple-500 whitespace-nowrap">
                      Custom:
                    </label>
                    <input
                    type="range"
                    min={2}
                    max={Math.max(2, palette.length)}
                    value={Math.min(refineColorCount, palette.length)}
                    onChange={(e) => setRefineColorCount(parseInt(e.target.value))}
                    className="w-16"
                    title={`Reduce palette to ${refineColorCount} colors`}
                  />
                  <span className="text-xs font-mono text-purple-600 min-w-[1.5rem] text-center">
                    {Math.min(refineColorCount, palette.length)}
                  </span>
                  </div>
                  <button
                    onClick={() => handleGenerate(true)}
                    disabled={processing}
                    className="btn-primary text-xs py-1 px-3"
                  >
                    Refine
                  </button>
                </div>
              )}
              {pbnCanvas && (
                <button onClick={() => downloadCanvas(pbnCanvas, "paint-by-numbers.png")} className="btn-secondary">
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
            </>
          )}

          {/* ── Draw tab ── */}
          {activeTab === "draw" && drawNumberMap && (
            <div className="space-y-4">
              {/* Progress bar */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-purple-500">{filledCells} / {totalCells} cells filled</span>
                  <span className="text-xs font-semibold text-purple-700">{fillProgress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-purple-100">
                  <div className="h-full rounded-full bg-purple-600 transition-all duration-300" style={{ width: `${fillProgress}%` }} />
                </div>
                {fillProgress === 100 && (
                  <p className="text-xs font-medium text-green-600 text-center mt-1">Complete — nice work!</p>
                )}
              </div>

              {/* Color picker */}
              <div className="rounded-xl border border-purple-100 bg-purple-50/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-purple-700">Palette — pick a color to paint</span>
                  <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-mono text-purple-500">
                    selected: {selectedPaletteIdx + 1}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {palette.map((entry, i) => {
                    const num = i + 1;
                    const isFilled = filledNumbers[num] !== undefined;
                    return (
                      <button
                        key={entry.color}
                        type="button"
                        title={`Color ${num}: ${entry.color}${isFilled ? " (filled)" : ""}`}
                        onClick={() => setSelectedPaletteIdx(i)}
                        className={`relative flex flex-col items-center gap-0.5 rounded-lg border p-1.5 text-[10px] transition-all w-12 ${
                          selectedPaletteIdx === i
                            ? "border-purple-600 ring-2 ring-purple-400/40 bg-white shadow-sm"
                            : isFilled
                              ? "border-green-200 bg-green-50/50"
                              : "border-purple-100 bg-white hover:border-purple-300"
                        }`}
                      >
                        <span className="block h-6 w-6 rounded border border-purple-100 shadow-inner" style={{ backgroundColor: entry.color }} />
                        <span className="font-mono text-purple-500 font-semibold">{num}</span>
                        {isFilled && (
                          <button
                            type="button"
                            title="Unfill this number"
                            onClick={(e) => { e.stopPropagation(); handleUnfillNumber(num); }}
                            className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-purple-400 text-white hover:bg-red-500 transition-colors"
                          >
                            <X className="h-2 w-2" />
                          </button>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Paint mode toggle */}
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <span className="text-xs font-semibold text-purple-600">Paint mode:</span>
                <div className="inline-flex rounded-lg border border-purple-200 bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => setDrawMode("group")}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                      drawMode === "group" ? "bg-purple-600 text-white shadow-sm" : "text-purple-400 hover:text-purple-600"
                    }`}
                  >
                    <Grid3X3 className="h-3.5 w-3.5" />
                    Fill Group
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawMode("single")}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                      drawMode === "single" ? "bg-purple-600 text-white shadow-sm" : "text-purple-400 hover:text-purple-600"
                    }`}
                  >
                    <MousePointerClick className="h-3.5 w-3.5" />
                    Single Cell
                  </button>
                </div>
                <p className="text-[11px] text-purple-400">
                  {drawMode === "group"
                    ? "Click a cell to fill all cells with the same number."
                    : "Click a cell to paint only that one cell."}
                </p>
              </div>

              {/* Side-by-side: Reference image + Drawing canvas */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-purple-400" />
                    <span className="text-xs font-semibold text-purple-600">Reference</span>
                  </div>
                  <div className="overflow-auto rounded-xl border border-purple-100 bg-purple-50/30 p-2">
                    <canvas
                      ref={(el) => {
                        if (el && resultCanvas) {
                          if (!el.getAttribute("data-drawn")) {
                            el.width = resultCanvas.width;
                            el.height = resultCanvas.height;
                            el.getContext("2d")!.drawImage(resultCanvas, 0, 0);
                            el.setAttribute("data-drawn", "true");
                          }
                        }
                      }}
                      className="rounded"
                      style={{ maxWidth: "100%", height: "auto", display: "block" }}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
                    <span className="text-xs font-semibold text-purple-600">Your Drawing</span>
                  </div>
                  <div className="overflow-auto rounded-xl border border-emerald-100 bg-emerald-50/30 p-2">
                    <canvas ref={drawCanvasRef} onClick={handleDrawClick} className="cursor-crosshair rounded" style={{ maxWidth: "100%", display: "block" }} />
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[11px] text-purple-400">
                  {Object.keys(filledNumbers).length} of {palette.length} colors used
                  {Object.keys(cellOverrides).length > 0 && (
                    <span> · {Object.keys(cellOverrides).length} cell override{Object.keys(cellOverrides).length !== 1 ? "s" : ""}</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleDrawClear}
                    disabled={Object.keys(filledNumbers).length === 0 && Object.keys(cellOverrides).length === 0}
                    className="btn-secondary"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Clear
                  </button>
                  <button
                    onClick={() => { const c = drawCanvasRef.current; if (c) downloadCanvas(c, "my-drawing.png"); }}
                    disabled={Object.keys(filledNumbers).length === 0 && Object.keys(cellOverrides).length === 0}
                    className="btn-primary"
                  >
                    <Download className="h-4 w-4" />
                    Download Drawing
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Progress */}
      {processing && progress && (
        <div className="card text-center">
          <div className="flex items-center justify-center gap-3 text-sm text-purple-600">
            <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" className="opacity-75" />
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
            <h3 className="mb-3 text-sm font-semibold text-purple-900">1. Upload Image</h3>
            <div
              {...getRootProps()}
              className={`card flex min-h-[200px] cursor-pointer items-center justify-center transition-colors ${
                isDragActive ? "border-purple-400 bg-purple-50" : "hover:border-purple-300"
              }`}
            >
              <input {...getInputProps()} />
              {previewUrl ? (
                <img src={previewUrl} alt="Preview" className="max-h-[300px] rounded-lg object-contain" />
              ) : (
                <div className="text-center">
                  <Upload className="mx-auto h-8 w-8 text-purple-300" />
                  <p className="mt-2 text-sm text-purple-500">Drop an image here, or click to select</p>
                  <p className="mt-1 text-xs text-purple-300">PNG, JPG, WebP</p>
                </div>
              )}
            </div>
          </div>

          {/* Presets */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-purple-900">Presets</h3>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((preset, i) => (
                <button
                  key={preset.name}
                  onClick={() => handleApplyPreset(i)}
                  className="rounded-lg border border-purple-100 bg-white px-3 py-2 text-left transition-all hover:border-purple-300 hover:shadow-sm"
                >
                  <span className="block text-xs font-semibold text-purple-800">{preset.name}</span>
                  <span className="block text-[10px] text-purple-400 leading-tight">{preset.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Middle: Core Controls */}
        <div className="space-y-6">
          <div>
            <h3 className="mb-3 text-sm font-semibold text-purple-900">2. Adjust Settings</h3>
            <div className="card space-y-4">
              <label className="block">
                <span className="text-xs font-medium text-purple-600">Grid Size: {localParams.gridSize}</span>
                <input type="range" min={3} max={50} value={localParams.gridSize} onChange={(e) => handleParamChange("gridSize", parseInt(e.target.value))} className="mt-1 w-full" />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-purple-600">Render Mode</span>
                <select value={localParams.renderMode} onChange={(e) => handleParamChange("renderMode", e.target.value)} className="mt-1 w-full rounded border border-purple-200 bg-white px-2 py-1.5 text-sm text-purple-700">
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

              <label className="block">
                <span className="text-xs font-medium text-purple-600">Cell Shape</span>
                <select value={localParams.cellShape} onChange={(e) => handleParamChange("cellShape", e.target.value)} className="mt-1 w-full rounded border border-purple-200 bg-white px-2 py-1.5 text-sm text-purple-700">
                  <option value="square">Square</option>
                  <option value="circle">Circle</option>
                  <option value="diamond">Diamond</option>
                  <option value="triangle">Triangle</option>
                  <option value="hexagon">Hexagon</option>
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-medium text-purple-600">Contrast: {localParams.contrast.toFixed(1)}</span>
                <input type="range" min={50} max={250} value={localParams.contrast * 100} onChange={(e) => handleParamChange("contrast", parseInt(e.target.value) / 100)} className="mt-1 w-full" />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-purple-600">Brightness: {localParams.brightness.toFixed(1)}</span>
                <input type="range" min={50} max={200} value={localParams.brightness * 100} onChange={(e) => handleParamChange("brightness", parseInt(e.target.value) / 100)} className="mt-1 w-full" />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-purple-600">Intensity: {localParams.intensity}</span>
                <input type="range" min={1} max={10} value={localParams.intensity} onChange={(e) => handleParamChange("intensity", parseInt(e.target.value))} className="mt-1 w-full" />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-purple-600">Saturation: {localParams.saturation.toFixed(1)}</span>
                <input type="range" min={0} max={200} value={localParams.saturation * 100} onChange={(e) => handleParamChange("saturation", parseInt(e.target.value) / 100)} className="mt-1 w-full" />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-purple-600">Line Width: {localParams.lineWidth}</span>
                <input type="range" min={0} max={5} value={localParams.lineWidth} onChange={(e) => handleParamChange("lineWidth", parseInt(e.target.value))} className="mt-1 w-full" />
              </label>

              <label className="flex items-center gap-2">
                <input type="checkbox" checked={localParams.colorMode} onChange={(e) => handleParamChange("colorMode", e.target.checked)} className="rounded accent-purple-600" />
                <span className="text-xs font-medium text-purple-600">Use original colors</span>
              </label>

              {localParams.colorMode && (
                <label className="block">
                  <span className="text-xs font-medium text-purple-600">Color Variation: {(localParams.colorVariation * 100).toFixed(0)}%</span>
                  <input type="range" min={0} max={50} value={localParams.colorVariation * 100} onChange={(e) => handleParamChange("colorVariation", parseInt(e.target.value) / 100)} className="mt-1 w-full" />
                </label>
              )}

              <div className="flex gap-4">
                <label className="block">
                  <span className="text-xs font-medium text-purple-600">Background</span>
                  <input type="color" value={localParams.backgroundColor} onChange={(e) => handleParamChange("backgroundColor", e.target.value)} className="mt-1 block h-8 w-12 cursor-pointer rounded border border-purple-200" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-purple-600">Fill</span>
                  <input type="color" value={localParams.fillColor} onChange={(e) => handleParamChange("fillColor", e.target.value)} className="mt-1 block h-8 w-12 cursor-pointer rounded border border-purple-200" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-purple-600">Lines</span>
                  <input type="color" value={localParams.lineColor} onChange={(e) => handleParamChange("lineColor", e.target.value)} className="mt-1 block h-8 w-12 cursor-pointer rounded border border-purple-200" />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Advanced + Actions */}
        <div className="space-y-6">
          <div>
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="mb-3 flex items-center gap-1 text-sm font-semibold text-purple-900"
            >
              {showAdvanced ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              3. Advanced Options
            </button>
            {showAdvanced && (
              <div className="card space-y-4">
                <label className="block">
                  <span className="text-xs font-medium text-purple-600">Edge Enhancement: {localParams.edgeEnhance.toFixed(1)}</span>
                  <input type="range" min={0} max={100} value={localParams.edgeEnhance * 100} onChange={(e) => handleParamChange("edgeEnhance", parseInt(e.target.value) / 100)} className="mt-1 w-full" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-purple-600">Softness/Blur: {localParams.blur.toFixed(1)}</span>
                  <input type="range" min={0} max={100} value={localParams.blur * 100} onChange={(e) => handleParamChange("blur", parseInt(e.target.value) / 100)} className="mt-1 w-full" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-purple-600">Palette Harmony</span>
                  <select value={localParams.paletteHarmony} onChange={(e) => handleParamChange("paletteHarmony", e.target.value)} className="mt-1 w-full rounded border border-purple-200 bg-white px-2 py-1.5 text-sm text-purple-700">
                    <option value="auto">Auto (natural)</option>
                    <option value="complementary">Complementary</option>
                    <option value="analogous">Analogous</option>
                    <option value="triadic">Triadic</option>
                    <option value="monochromatic">Monochromatic</option>
                  </select>
                </label>
                <div className="space-y-2">
                  <button onClick={() => setShowPalettePanel((v) => !v)} className="flex items-center gap-1 text-xs font-medium text-purple-600">
                    <Import className="h-3 w-3" />
                    Import Custom Palette
                  </button>
                  {showPalettePanel && (
                    <div className="space-y-2">
                      <input
                        type="text"
                        placeholder="#ff0000, #00ff00, #0000ff"
                        value={customPaletteInput}
                        onChange={(e) => setCustomPaletteInput(e.target.value)}
                        className="w-full rounded border border-purple-200 px-2 py-1.5 text-xs"
                      />
                      <div className="flex gap-2">
                        <button onClick={handleImportPalette} className="btn-secondary text-xs">
                          <Paintbrush className="h-3 w-3" />
                          Apply
                        </button>
                        {localParams.customPalette.length > 0 && (
                          <button onClick={() => handleParamChange("customPalette", [])} className="btn-secondary text-xs">
                            <X className="h-3 w-3" />
                            Clear
                          </button>
                        )}
                      </div>
                      {localParams.customPalette.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {localParams.customPalette.map((c) => (
                            <span key={c} className="inline-block h-5 w-5 rounded border border-purple-300" style={{ backgroundColor: c }} title={c} />
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
          <button className="btn-primary w-full" disabled={!file || processing} onClick={() => handleGenerate(false)}>
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

          <div className="rounded-lg bg-purple-50 p-3 text-[10px] text-purple-400 space-y-0.5">
            <p className="font-semibold text-purple-500 text-xs mb-1">Shortcuts</p>
            <p>⌘Z — Undo &nbsp; ⌘⇧Z — Redo</p>
            <p>⌘+ — Zoom In &nbsp; ⌘- — Zoom Out</p>
          </div>
        </div>
      </div>

        </div>
      </section>

      {/* ═══ Footer ═══ */}
      <footer className="bg-hero py-8 text-center">
        <p className="text-sm text-purple-200/60">Grid Art Generator — 100% client-side, forever free</p>
      </footer>
    </>
  );
}
