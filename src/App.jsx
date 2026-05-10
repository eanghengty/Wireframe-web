import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Circle,
  Download,
  History,
  Minus,
  MousePointer2,
  PenLine,
  Plus,
  Save,
  Square,
  StickyNote,
  Type
} from "lucide-react";
import {
  clearStoredDocument,
  fetchVersions,
  loadActiveDocument,
  restoreVersion,
  saveActiveDocument
} from "./db";

const CANVAS_WIDTH = 1400;
const CANVAS_HEIGHT = 900;
const MIN_RESIZE_SIZE = 20;
const DEFAULT_DOCUMENT_NAME = "Untitled";
const LEGACY_DEFAULT_DOCUMENT_NAME = "Untitled-Validation-Flow";

const TOOL_ITEMS = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "pen", label: "Pen", icon: PenLine },
  { id: "rect", label: "Rectangle", icon: Square },
  { id: "ellipse", label: "Ellipse", icon: Circle },
  { id: "arrow", label: "Arrow", icon: ArrowRight },
  { id: "text", label: "Text", icon: Type },
  { id: "sticky", label: "Sticky", icon: StickyNote }
];

const FILL_COLORS = ["#AFA9EC", "#5DCAA5", "#F0997B", "#85B7EB", "#B4B2A9", "#FAEEDA"];

const STENCIL_LIBRARY = [];
const RESIZE_HANDLES = ["nw", "ne", "sw", "se"];

const INITIAL_ELEMENTS = [];
const LEGACY_DEMO_TEXTS = new Set([
  "Equipment ID",
  "Cal records",
  "Test protocol",
  "Run challenge",
  "Final report",
  "Need vendor cert\nbefore PQ"
]);

function isLegacyDemoData(elements) {
  if (!Array.isArray(elements) || elements.length !== 10) {
    return false;
  }

  const texts = elements.filter((element) => typeof element.text === "string").map((element) => element.text);
  const arrowCount = elements.filter((element) => element.type === "arrow").length;

  if (texts.length !== LEGACY_DEMO_TEXTS.size || arrowCount !== 4) {
    return false;
  }

  return texts.every((text) => LEGACY_DEMO_TEXTS.has(text));
}

function makeId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatTimestamp(value) {
  if (!value) {
    return "never";
  }

  return new Date(value).toLocaleString();
}

function buildElementFromTool(toolId, point) {
  const base = {
    id: makeId(),
    strokeWidth: 1.5
  };

  if (toolId === "rect") {
    return {
      ...base,
      type: "rect",
      x: point.x - 70,
      y: point.y - 35,
      width: 140,
      height: 70,
      text: "Block",
      fill: "#E6F1FB",
      stroke: "#0C447C"
    };
  }

  if (toolId === "ellipse") {
    return {
      ...base,
      type: "ellipse",
      x: point.x - 70,
      y: point.y - 40,
      width: 140,
      height: 80,
      text: "Node",
      fill: "#EEEDFE",
      stroke: "#3C3489"
    };
  }

  if (toolId === "sticky") {
    return {
      ...base,
      type: "sticky",
      x: point.x - 80,
      y: point.y - 50,
      width: 160,
      height: 100,
      text: "Sticky note",
      fill: "#FAEEDA",
      stroke: "#BA7517",
      strokeWidth: 1.2
    };
  }

  if (toolId === "text") {
    return {
      ...base,
      type: "text",
      x: point.x,
      y: point.y,
      text: "Label",
      fill: "#2F2E2A",
      stroke: "transparent",
      strokeWidth: 0
    };
  }

  return null;
}

function getElementBounds(element) {
  if (element.type === "arrow") {
    return {
      x: Math.min(element.x1, element.x2),
      y: Math.min(element.y1, element.y2),
      width: Math.max(24, Math.abs(element.x2 - element.x1)),
      height: Math.max(24, Math.abs(element.y2 - element.y1))
    };
  }

  if (element.type === "pen") {
    const xs = [];
    const ys = [];

    for (let i = 0; i < element.points.length; i += 2) {
      xs.push(element.points[i]);
      ys.push(element.points[i + 1]);
    }

    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(20, Math.max(...xs) - Math.min(...xs)),
      height: Math.max(20, Math.max(...ys) - Math.min(...ys))
    };
  }

  if (element.type === "text") {
    const width = Math.max(90, (element.text?.length ?? 0) * 8.6);

    return {
      x: element.x - 4,
      y: element.y - 24,
      width,
      height: 30
    };
  }

  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height
  };
}

function getElementAnchor(element) {
  if (element.type === "arrow") {
    return { x: element.x1, y: element.y1 };
  }

  if (element.type === "pen") {
    const bounds = getElementBounds(element);
    return { x: bounds.x, y: bounds.y };
  }

  if (element.type === "text") {
    return { x: element.x, y: element.y };
  }

  return { x: element.x, y: element.y };
}

function shiftElement(element, dx, dy) {
  if (element.type === "arrow") {
    return {
      ...element,
      x1: element.x1 + dx,
      y1: element.y1 + dy,
      x2: element.x2 + dx,
      y2: element.y2 + dy
    };
  }

  if (element.type === "pen") {
    return {
      ...element,
      points: element.points.map((value, index) => value + (index % 2 === 0 ? dx : dy))
    };
  }

  return {
    ...element,
    x: element.x + dx,
    y: element.y + dy
  };
}

function moveElementTo(element, nextX, nextY) {
  if (element.type === "arrow") {
    const dx = nextX - element.x1;
    const dy = nextY - element.y1;
    return shiftElement(element, dx, dy);
  }

  if (element.type === "pen") {
    const anchor = getElementAnchor(element);
    return shiftElement(element, nextX - anchor.x, nextY - anchor.y);
  }

  if (element.type === "text") {
    return {
      ...element,
      x: nextX,
      y: nextY
    };
  }

  return {
    ...element,
    x: nextX,
    y: nextY
  };
}

function resizeElementFromHandle(element, handle, dx, dy) {
  if (element.type !== "rect" && element.type !== "ellipse") {
    return element;
  }

  let left = element.x;
  let top = element.y;
  let right = element.x + element.width;
  let bottom = element.y + element.height;

  if (handle.includes("w")) {
    left += dx;
  }
  if (handle.includes("e")) {
    right += dx;
  }
  if (handle.includes("n")) {
    top += dy;
  }
  if (handle.includes("s")) {
    bottom += dy;
  }

  if (right - left < MIN_RESIZE_SIZE) {
    if (handle.includes("w")) {
      left = right - MIN_RESIZE_SIZE;
    } else {
      right = left + MIN_RESIZE_SIZE;
    }
  }

  if (bottom - top < MIN_RESIZE_SIZE) {
    if (handle.includes("n")) {
      top = bottom - MIN_RESIZE_SIZE;
    } else {
      bottom = top + MIN_RESIZE_SIZE;
    }
  }

  return {
    ...element,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function splitText(text) {
  return (text || "").split("\n");
}

function filenameFromDocument(name) {
  const cleaned = (name || "wireframe")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "");

  return cleaned || "wireframe";
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const svgRef = useRef(null);

  const [activeTab, setActiveTab] = useState("app");
  const [activeTool, setActiveTool] = useState("select");
  const [documentName, setDocumentName] = useState(DEFAULT_DOCUMENT_NAME);
  const [elements, setElements] = useState(INITIAL_ELEMENTS);
  const [selectedId, setSelectedId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState("Loading from IndexedDB...");
  const [hydrated, setHydrated] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [versions, setVersions] = useState([]);
  const [showVersions, setShowVersions] = useState(false);
  const [exportFormat, setExportFormat] = useState("png");

  const [arrowStart, setArrowStart] = useState(null);
  const [penDraft, setPenDraft] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [resizeState, setResizeState] = useState(null);

  const selectedElement = useMemo(
    () => elements.find((element) => element.id === selectedId) ?? null,
    [elements, selectedId]
  );

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const saved = await loadActiveDocument();
        if (cancelled) {
          return;
        }

        if (saved) {
          const nextName =
            saved.name && saved.name !== LEGACY_DEFAULT_DOCUMENT_NAME ? saved.name : DEFAULT_DOCUMENT_NAME;
          const nextElements = Array.isArray(saved.elements) ? saved.elements : INITIAL_ELEMENTS;
          const legacyDemoLoaded = isLegacyDemoData(nextElements);

          setDocumentName(nextName);
          setElements(legacyDemoLoaded ? INITIAL_ELEMENTS : nextElements);
          setZoom(saved.zoom || 1);
          setLastSavedAt(saved.updatedAt || Date.now());
          if (legacyDemoLoaded) {
            setStatus("Legacy demo data removed. New draft ready.");
          } else {
            setStatus(`Loaded saved draft (${formatTimestamp(saved.updatedAt)})`);
          }
        } else {
          setStatus("New draft ready. Start sketching.");
        }
      } catch (error) {
        console.error(error);
        setStatus("IndexedDB unavailable. Working in memory only.");
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    }

    hydrate();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return undefined;
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        const result = await saveActiveDocument(
          {
            name: documentName,
            elements,
            zoom
          },
          { trackVersion: false }
        );

        setLastSavedAt(result.updatedAt);
      } catch (error) {
        console.error(error);
      }
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [hydrated, documentName, elements, zoom]);

  useEffect(() => {
    if (!dragState && !resizeState && !penDraft) {
      return undefined;
    }

    function getCanvasPoint(clientX, clientY) {
      const svg = svgRef.current;
      if (!svg) {
        return null;
      }

      const matrix = svg.getScreenCTM();
      if (!matrix) {
        return null;
      }

      const point = svg.createSVGPoint();
      point.x = clientX;
      point.y = clientY;

      const transformed = point.matrixTransform(matrix.inverse());
      return {
        x: transformed.x / zoom,
        y: transformed.y / zoom
      };
    }

    function onPointerMove(event) {
      const point = getCanvasPoint(event.clientX, event.clientY);
      if (!point) {
        return;
      }

      if (resizeState) {
        const dx = point.x - resizeState.start.x;
        const dy = point.y - resizeState.start.y;

        setElements((previous) =>
          previous.map((element) => {
            if (element.id !== resizeState.id) {
              return element;
            }

            return resizeElementFromHandle(resizeState.origin, resizeState.handle, dx, dy);
          })
        );
        return;
      }

      if (dragState) {
        const dx = point.x - dragState.start.x;
        const dy = point.y - dragState.start.y;

        setElements((previous) =>
          previous.map((element) => {
            if (element.id !== dragState.id) {
              return element;
            }

            return shiftElement(dragState.origin, dx, dy);
          })
        );
      }

      if (penDraft) {
        setPenDraft((previous) => {
          if (!previous) {
            return previous;
          }

          const lastX = previous.points[previous.points.length - 2];
          const lastY = previous.points[previous.points.length - 1];

          if (Math.hypot(lastX - point.x, lastY - point.y) < 3) {
            return previous;
          }

          return {
            ...previous,
            points: [...previous.points, point.x, point.y]
          };
        });
      }
    }

    function onPointerUp() {
      setDragState(null);
      setResizeState(null);

      if (penDraft?.points?.length >= 4) {
        const newPenElement = {
          id: penDraft.id,
          type: "pen",
          points: penDraft.points,
          stroke: "#5F5E5A",
          strokeWidth: 2,
          fill: "none"
        };

        setElements((previous) => [...previous, newPenElement]);
        setSelectedId(newPenElement.id);
      }

      setPenDraft(null);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [dragState, resizeState, penDraft, zoom]);

  function getCanvasPointFromEvent(event) {
    const svg = svgRef.current;
    if (!svg) {
      return null;
    }

    const matrix = svg.getScreenCTM();
    if (!matrix) {
      return null;
    }

    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;

    const transformed = point.matrixTransform(matrix.inverse());
    return {
      x: transformed.x / zoom,
      y: transformed.y / zoom
    };
  }

  function updateSelected(updater) {
    if (!selectedId) {
      return;
    }

    setElements((previous) =>
      previous.map((element) => {
        if (element.id !== selectedId) {
          return element;
        }

        return updater(element);
      })
    );
  }

  function handleCanvasPointerDown(event) {
    if (event.button !== 0) {
      return;
    }

    const point = getCanvasPointFromEvent(event);
    if (!point) {
      return;
    }

    if (activeTool === "select") {
      setSelectedId(null);
      return;
    }

    if (activeTool === "pen") {
      setSelectedId(null);
      setPenDraft({ id: makeId(), points: [point.x, point.y] });
      return;
    }

    if (activeTool === "arrow") {
      if (!arrowStart) {
        setArrowStart(point);
        setStatus("Arrow start set. Click again to place the end point.");
      } else {
        const arrow = {
          id: makeId(),
          type: "arrow",
          x1: arrowStart.x,
          y1: arrowStart.y,
          x2: point.x,
          y2: point.y,
          stroke: "#5F5E5A",
          strokeWidth: 2
        };

        setElements((previous) => [...previous, arrow]);
        setSelectedId(arrow.id);
        setArrowStart(null);
        setStatus("Arrow added.");
      }

      return;
    }

    const newElement = buildElementFromTool(activeTool, point);
    if (!newElement) {
      return;
    }

    setElements((previous) => [...previous, newElement]);
    setSelectedId(newElement.id);
    setStatus(`${newElement.type} added.`);
  }

  function handleElementPointerDown(event, element) {
    event.stopPropagation();
    setSelectedId(element.id);

    if (activeTool !== "select") {
      return;
    }

    const point = getCanvasPointFromEvent(event);
    if (!point) {
      return;
    }

    setDragState({
      id: element.id,
      origin: element,
      start: point
    });
  }

  function handleResizePointerDown(event, element, handle) {
    event.stopPropagation();
    if (activeTool !== "select") {
      return;
    }

    const point = getCanvasPointFromEvent(event);
    if (!point) {
      return;
    }

    setSelectedId(element.id);
    setDragState(null);
    setResizeState({
      id: element.id,
      origin: element,
      handle,
      start: point
    });
  }

  function getResizeHandlePosition(element, handle) {
    const x = handle.includes("e") ? element.x + element.width : element.x;
    const y = handle.includes("s") ? element.y + element.height : element.y;
    return { x, y };
  }

  async function handleSave() {
    try {
      const result = await saveActiveDocument(
        {
          name: documentName,
          elements,
          zoom
        },
        { trackVersion: true }
      );

      setLastSavedAt(result.updatedAt);
      setStatus(`Saved to IndexedDB (${formatTimestamp(result.updatedAt)}).`);
    } catch (error) {
      console.error(error);
      setStatus("Save failed. Please retry.");
    }
  }

  async function handleVersionsToggle() {
    if (showVersions) {
      setShowVersions(false);
      return;
    }

    try {
      const items = await fetchVersions(10);
      setVersions(items);
      setShowVersions(true);
    } catch (error) {
      console.error(error);
      setStatus("Could not load versions.");
    }
  }

  async function handleRestoreVersion(versionId) {
    try {
      const version = await restoreVersion(versionId);
      if (!version) {
        return;
      }

      setElements(version.elements || []);
      setZoom(version.zoom || 1);
      setShowVersions(false);
      setStatus(`Version restored from ${formatTimestamp(version.updatedAt)}.`);
    } catch (error) {
      console.error(error);
      setStatus("Restore failed.");
    }
  }

  async function handleResetWorkspace() {
    if (!window.confirm("Reset canvas and clear saved IndexedDB data?")) {
      return;
    }

    try {
      await clearStoredDocument();
      setDocumentName(DEFAULT_DOCUMENT_NAME);
      setElements(INITIAL_ELEMENTS);
      setSelectedId(null);
      setArrowStart(null);
      setPenDraft(null);
      setZoom(1);
      setStatus("Workspace reset. IndexedDB cleared.");
      setLastSavedAt(null);
    } catch (error) {
      console.error(error);
      setStatus("Reset failed.");
    }
  }

  async function handleExport() {
    const fileBase = filenameFromDocument(documentName);

    if (exportFormat === "json") {
      const blob = new Blob(
        [
          JSON.stringify(
            {
              name: documentName,
              elements,
              exportedAt: new Date().toISOString()
            },
            null,
            2
          )
        ],
        { type: "application/json" }
      );

      downloadBlob(`${fileBase}.json`, blob);
      setStatus("Exported JSON.");
      return;
    }

    const svgNode = svgRef.current;
    if (!svgNode) {
      return;
    }

    const clonedSvg = svgNode.cloneNode(true);
    clonedSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clonedSvg.setAttribute("width", `${CANVAS_WIDTH}`);
    clonedSvg.setAttribute("height", `${CANVAS_HEIGHT}`);

    const serializedSvg = new XMLSerializer().serializeToString(clonedSvg);

    if (exportFormat === "svg") {
      const blob = new Blob([serializedSvg], { type: "image/svg+xml;charset=utf-8" });
      downloadBlob(`${fileBase}.svg`, blob);
      setStatus("Exported SVG.");
      return;
    }

    if (exportFormat === "png") {
      const blob = new Blob([serializedSvg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);

      try {
        await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = CANVAS_WIDTH;
            canvas.height = CANVAS_HEIGHT;

            const context = canvas.getContext("2d");
            if (!context) {
              reject(new Error("Canvas context unavailable"));
              return;
            }

            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
            context.drawImage(image, 0, 0);

            canvas.toBlob((pngBlob) => {
              if (!pngBlob) {
                reject(new Error("Failed to create PNG"));
                return;
              }

              downloadBlob(`${fileBase}.png`, pngBlob);
              resolve();
            }, "image/png");
          };

          image.onerror = reject;
          image.src = url;
        });

        setStatus("Exported PNG.");
      } catch (error) {
        console.error(error);
        setStatus("PNG export failed.");
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }

  function handleAddStencil(stencil) {
    const index = elements.length;
    const offsetX = 140 + (index % 4) * 120;
    const offsetY = 120 + ((index + 1) % 3) * 90;
    const newElement = stencil.create(offsetX, offsetY);

    setElements((previous) => [...previous, newElement]);
    setActiveTab("app");
    setSelectedId(newElement.id);
    setStatus(`${stencil.title} added from stencil library.`);
  }

  const selectedAnchor = selectedElement ? getElementAnchor(selectedElement) : null;
  const resizeHandleRadius = 6 / zoom;
  const resizeHandleStrokeWidth = 1.4 / zoom;

  return (
    <div className="app-shell">
      <h1 className="sr-only">QE Wireframe Tool</h1>

      <div className="tab-row">
        <button
          className={`tab-btn ${activeTab === "app" ? "active" : ""}`}
          onClick={() => setActiveTab("app")}
          type="button"
        >
          App layout
        </button>
        <button
          className={`tab-btn ${activeTab === "stencils" ? "active" : ""}`}
          onClick={() => setActiveTab("stencils")}
          type="button"
        >
          Stencil library
        </button>
        <button
          className={`tab-btn ${activeTab === "export" ? "active" : ""}`}
          onClick={() => setActiveTab("export")}
          type="button"
        >
          Export panel
        </button>
        <span className="tab-hint">click tabs to switch</span>
      </div>

      {activeTab === "app" && (
        <section className="panel card-view">
          <header className="topbar">
            <div className="topbar-title-wrap">
              <span className="topbar-dot">QE</span>
              <input
                aria-label="Document name"
                className="doc-name-input"
                value={documentName}
                onChange={(event) => setDocumentName(event.target.value)}
              />
            </div>

            <div className="topbar-actions">
              <button className="ghost-btn" onClick={handleSave} type="button">
                <Save size={14} /> Save
              </button>
              <button className="ghost-btn" onClick={handleVersionsToggle} type="button">
                <History size={14} /> Versions
              </button>
              <button className="primary-btn" onClick={() => setActiveTab("export")} type="button">
                <Download size={14} /> Export
              </button>
            </div>
          </header>

          {showVersions && (
            <div className="versions-popover" role="dialog" aria-label="Saved versions">
              <div className="versions-title">Recent versions</div>
              {versions.length === 0 && <p className="versions-empty">No manual saves yet.</p>}
              {versions.map((version) => (
                <button
                  key={version.versionId}
                  className="version-item"
                  type="button"
                  onClick={() => handleRestoreVersion(version.versionId)}
                >
                  {formatTimestamp(version.updatedAt)}
                </button>
              ))}
            </div>
          )}

          <div className="workspace-grid">
            <aside className="toolbar">
              {TOOL_ITEMS.map((tool) => {
                const Icon = tool.icon;
                const isActive = activeTool === tool.id;

                return (
                  <button
                    key={tool.id}
                    className={`tool-btn ${isActive ? "active" : ""}`}
                    type="button"
                    title={tool.label}
                    onClick={() => {
                      setActiveTool(tool.id);
                      setArrowStart(null);
                    }}
                  >
                    <Icon size={18} />
                  </button>
                );
              })}
            </aside>

            <section className="canvas-panel" onPointerDown={handleCanvasPointerDown}>
              <svg
                ref={svgRef}
                className="wireframe-canvas"
                viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
                role="img"
                aria-label="Draft canvas"
              >
                <defs>
                  <pattern id="dotGrid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <circle cx="1" cy="1" r="1" fill="#d5d3c6" />
                  </pattern>
                  <marker
                    id="arrowHead"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#5F5E5A" />
                  </marker>
                </defs>

                <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="#ffffff" />
                <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="url(#dotGrid)" opacity="0.55" />

                <g transform={`scale(${zoom})`}>
                  {elements.map((element) => {
                    const isSelected = selectedId === element.id;
                    const bounds = isSelected ? getElementBounds(element) : null;

                    if (element.type === "rect" || element.type === "sticky") {
                      return (
                        <g
                          key={element.id}
                          className="canvas-element"
                          onPointerDown={(event) => handleElementPointerDown(event, element)}
                        >
                          <rect
                            x={element.x}
                            y={element.y}
                            width={element.width}
                            height={element.height}
                            rx={8}
                            fill={element.fill}
                            stroke={element.stroke}
                            strokeWidth={element.strokeWidth || 1.2}
                          />

                          {splitText(element.text).map((line, index) => (
                            <text
                              key={`${element.id}-line-${index}`}
                              x={element.x + element.width / 2}
                              y={element.y + 30 + index * 16}
                              textAnchor="middle"
                              className="shape-label"
                            >
                              {line}
                            </text>
                          ))}

                          {isSelected && (
                            <>
                              <rect
                                className="selection-outline"
                                x={element.x - 4}
                                y={element.y - 4}
                                width={element.width + 8}
                                height={element.height + 8}
                                rx={10}
                              />
                              {activeTool === "select" &&
                                element.type === "rect" &&
                                RESIZE_HANDLES.map((handle) => {
                                  const position = getResizeHandlePosition(element, handle);
                                  return (
                                    <circle
                                      key={`${element.id}-${handle}`}
                                      className={`resize-handle ${handle}`}
                                      cx={position.x}
                                      cy={position.y}
                                      r={resizeHandleRadius}
                                      strokeWidth={resizeHandleStrokeWidth}
                                      onPointerDown={(event) => handleResizePointerDown(event, element, handle)}
                                    />
                                  );
                                })}
                            </>
                          )}
                        </g>
                      );
                    }

                    if (element.type === "ellipse") {
                      return (
                        <g
                          key={element.id}
                          className="canvas-element"
                          onPointerDown={(event) => handleElementPointerDown(event, element)}
                        >
                          <ellipse
                            cx={element.x + element.width / 2}
                            cy={element.y + element.height / 2}
                            rx={element.width / 2}
                            ry={element.height / 2}
                            fill={element.fill}
                            stroke={element.stroke}
                            strokeWidth={element.strokeWidth || 1.2}
                          />
                          <text
                            x={element.x + element.width / 2}
                            y={element.y + element.height / 2 + 4}
                            textAnchor="middle"
                            className="shape-label"
                          >
                            {element.text}
                          </text>

                          {isSelected && (
                            <>
                              <rect
                                className="selection-outline"
                                x={element.x - 4}
                                y={element.y - 4}
                                width={element.width + 8}
                                height={element.height + 8}
                                rx={Math.floor((element.width + element.height) / 12)}
                              />
                              {activeTool === "select" &&
                                RESIZE_HANDLES.map((handle) => {
                                  const position = getResizeHandlePosition(element, handle);
                                  return (
                                    <circle
                                      key={`${element.id}-${handle}`}
                                      className={`resize-handle ${handle}`}
                                      cx={position.x}
                                      cy={position.y}
                                      r={resizeHandleRadius}
                                      strokeWidth={resizeHandleStrokeWidth}
                                      onPointerDown={(event) => handleResizePointerDown(event, element, handle)}
                                    />
                                  );
                                })}
                            </>
                          )}
                        </g>
                      );
                    }

                    if (element.type === "text") {
                      return (
                        <g
                          key={element.id}
                          className="canvas-element"
                          onPointerDown={(event) => handleElementPointerDown(event, element)}
                        >
                          <text x={element.x} y={element.y} className="text-node" fill={element.fill}>
                            {element.text}
                          </text>

                          {isSelected && bounds && (
                            <rect
                              className="selection-outline"
                              x={bounds.x - 2}
                              y={bounds.y - 2}
                              width={bounds.width + 4}
                              height={bounds.height + 4}
                              rx={4}
                            />
                          )}
                        </g>
                      );
                    }

                    if (element.type === "arrow") {
                      return (
                        <g
                          key={element.id}
                          className="canvas-element"
                          onPointerDown={(event) => handleElementPointerDown(event, element)}
                        >
                          <line
                            x1={element.x1}
                            y1={element.y1}
                            x2={element.x2}
                            y2={element.y2}
                            stroke={element.stroke}
                            strokeWidth={element.strokeWidth || 2}
                            markerEnd="url(#arrowHead)"
                          />

                          {isSelected && bounds && (
                            <rect
                              className="selection-outline"
                              x={bounds.x - 8}
                              y={bounds.y - 8}
                              width={bounds.width + 16}
                              height={bounds.height + 16}
                              rx={4}
                            />
                          )}
                        </g>
                      );
                    }

                    if (element.type === "pen") {
                      return (
                        <g
                          key={element.id}
                          className="canvas-element"
                          onPointerDown={(event) => handleElementPointerDown(event, element)}
                        >
                          <polyline
                            points={element.points.join(" ")}
                            fill="none"
                            stroke={element.stroke || "#5F5E5A"}
                            strokeWidth={element.strokeWidth || 2}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                          />

                          {isSelected && bounds && (
                            <rect
                              className="selection-outline"
                              x={bounds.x - 8}
                              y={bounds.y - 8}
                              width={bounds.width + 16}
                              height={bounds.height + 16}
                              rx={4}
                            />
                          )}
                        </g>
                      );
                    }

                    return null;
                  })}

                  {penDraft?.points?.length >= 4 && (
                    <polyline
                      points={penDraft.points.join(" ")}
                      fill="none"
                      stroke="#5F5E5A"
                      strokeWidth="2"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  )}

                  {arrowStart && <circle cx={arrowStart.x} cy={arrowStart.y} r="6" fill="#0C447C" opacity="0.55" />}
                </g>
              </svg>

              <div className="zoom-controls">
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => setZoom((current) => clamp(Number((current - 0.1).toFixed(2)), 0.5, 2.4))}
                >
                  <Minus size={14} />
                </button>
                <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => setZoom((current) => clamp(Number((current + 0.1).toFixed(2)), 0.5, 2.4))}
                >
                  <Plus size={14} />
                </button>
              </div>
            </section>

            <aside className="properties-panel">
              <div className="properties-title">Properties</div>

              {!selectedElement && <p className="muted">Select an element to edit fill, position, text, and stroke.</p>}

              {selectedElement && (
                <>
                  <div className="property-card">
                    <div className="property-label">Selected type</div>
                    <div className="property-value">{selectedElement.type}</div>
                  </div>

                  {typeof selectedElement.text === "string" && (
                    <label className="property-group" htmlFor="element-text">
                      <span className="property-label">Text</span>
                      <textarea
                        id="element-text"
                        className="input"
                        value={selectedElement.text}
                        rows={3}
                        onChange={(event) =>
                          updateSelected((element) => ({
                            ...element,
                            text: event.target.value
                          }))
                        }
                      />
                    </label>
                  )}

                  {selectedElement.type !== "arrow" && selectedElement.type !== "pen" && (
                    <div className="property-group">
                      <span className="property-label">Fill</span>
                      <div className="palette">
                        {FILL_COLORS.map((color) => (
                          <button
                            key={color}
                            className={`swatch ${selectedElement.fill === color ? "active" : ""}`}
                            style={{ backgroundColor: color }}
                            onClick={() =>
                              updateSelected((element) => ({
                                ...element,
                                fill: color
                              }))
                            }
                            type="button"
                            aria-label={`Set fill ${color}`}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {(selectedElement.type === "rect" || selectedElement.type === "ellipse") && (
                    <div className="property-group">
                      <span className="property-label">Size</span>
                      <div className="position-grid">
                        <label>
                          W
                          <input
                            className="input"
                            type="number"
                            min={MIN_RESIZE_SIZE}
                            value={Math.round(selectedElement.width)}
                            onChange={(event) => {
                              const nextWidth = Number(event.target.value);
                              if (Number.isNaN(nextWidth)) {
                                return;
                              }

                              updateSelected((element) => ({
                                ...element,
                                width: Math.max(MIN_RESIZE_SIZE, nextWidth)
                              }));
                            }}
                          />
                        </label>
                        <label>
                          H
                          <input
                            className="input"
                            type="number"
                            min={MIN_RESIZE_SIZE}
                            value={Math.round(selectedElement.height)}
                            onChange={(event) => {
                              const nextHeight = Number(event.target.value);
                              if (Number.isNaN(nextHeight)) {
                                return;
                              }

                              updateSelected((element) => ({
                                ...element,
                                height: Math.max(MIN_RESIZE_SIZE, nextHeight)
                              }));
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  )}

                  <div className="property-group">
                    <span className="property-label">Stroke width</span>
                    <div className="stroke-grid">
                      {[1, 2, 3].map((width) => (
                        <button
                          key={width}
                          className={`stroke-btn ${(selectedElement.strokeWidth || 1) === width ? "active" : ""}`}
                          type="button"
                          onClick={() =>
                            updateSelected((element) => ({
                              ...element,
                              strokeWidth: width
                            }))
                          }
                        >
                          <span style={{ height: width }} />
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectedAnchor && (
                    <div className="property-group">
                      <span className="property-label">Position</span>
                      <div className="position-grid">
                        <label>
                          X
                          <input
                            className="input"
                            type="number"
                            value={Math.round(selectedAnchor.x)}
                            onChange={(event) => {
                              const nextX = Number(event.target.value);
                              if (Number.isNaN(nextX)) {
                                return;
                              }

                              updateSelected((element) => moveElementTo(element, nextX, getElementAnchor(element).y));
                            }}
                          />
                        </label>
                        <label>
                          Y
                          <input
                            className="input"
                            type="number"
                            value={Math.round(selectedAnchor.y)}
                            onChange={(event) => {
                              const nextY = Number(event.target.value);
                              if (Number.isNaN(nextY)) {
                                return;
                              }

                              updateSelected((element) => moveElementTo(element, getElementAnchor(element).x, nextY));
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="layer-section">
                <div className="property-label">Layers</div>
                <div className="layers-list">
                  {[...elements].reverse().map((element) => (
                    <button
                      key={`layer-${element.id}`}
                      type="button"
                      className={`layer-row ${selectedId === element.id ? "active" : ""}`}
                      onClick={() => {
                        setSelectedId(element.id);
                        setActiveTab("app");
                      }}
                    >
                      {element.type} {typeof element.text === "string" ? `- ${element.text.slice(0, 22)}` : ""}
                    </button>
                  ))}
                </div>
              </div>

              <button type="button" className="warn-btn" onClick={handleResetWorkspace}>
                Reset workspace
              </button>
            </aside>
          </div>
        </section>
      )}

      {activeTab === "stencils" && (
        <section className="panel stencil-view">
          <div className="stencil-grid">
            {STENCIL_LIBRARY.length === 0 && (
              <article className="stencil-card">
                <h3>No stencils configured</h3>
                <p>Stencil library is empty. Use drawing tools to create your own components.</p>
              </article>
            )}
            {STENCIL_LIBRARY.map((stencil) => (
              <article key={stencil.id} className="stencil-card">
                <h3>{stencil.title}</h3>
                <p>{stencil.description}</p>
                <button type="button" className="ghost-btn" onClick={() => handleAddStencil(stencil)}>
                  Add to canvas
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      {activeTab === "export" && (
        <section className="panel export-view">
          <div className="export-card">
            <h2>Export drawing</h2>
            <p>Choose format and export the current draft.</p>

            <div className="format-grid">
              {["png", "svg", "json"].map((format) => (
                <button
                  key={format}
                  type="button"
                  className={`format-option ${exportFormat === format ? "active" : ""}`}
                  onClick={() => setExportFormat(format)}
                >
                  <span className="format-title">{format.toUpperCase()}</span>
                  <span className="format-copy">
                    {format === "png" && "Share-ready bitmap"}
                    {format === "svg" && "Vector format"}
                    {format === "json" && "Re-importable source"}
                  </span>
                </button>
              ))}
            </div>

            <div className="meta-block">
              <div>Document: {documentName}</div>
              <div>Elements: {elements.length}</div>
              <div>Last save: {formatTimestamp(lastSavedAt)}</div>
            </div>

            <button type="button" className="primary-btn wide" onClick={handleExport}>
              Export {exportFormat.toUpperCase()}
            </button>
          </div>
        </section>
      )}

      <footer className="status-row">
        <span>{status}</span>
        <span>Autosave: IndexedDB</span>
      </footer>
    </div>
  );
}
