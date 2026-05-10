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
  Redo2,
  Save,
  Square,
  StickyNote,
  Type,
  Undo2
} from "lucide-react";
import {
  createWorkspace,
  deleteWorkspace,
  fetchVersions,
  listWorkspaces,
  loadActiveWorkspace,
  loadWorkspace,
  restoreVersion,
  saveWorkspace,
  setActiveWorkspaceId as persistActiveWorkspaceId
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
const CONNECTOR_HANDLES = ["n", "e", "s", "w"];
const MAX_HISTORY = 100;

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

function getConnectorDirection(handle) {
  if (handle === "n") {
    return { x: 0, y: -1 };
  }
  if (handle === "e") {
    return { x: 1, y: 0 };
  }
  if (handle === "s") {
    return { x: 0, y: 1 };
  }
  if (handle === "w") {
    return { x: -1, y: 0 };
  }

  return null;
}

function getFallbackArrowDirection(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: dx === 0 ? 1 : Math.sign(dx), y: 0 };
  }

  return { x: 0, y: dy === 0 ? 1 : Math.sign(dy) };
}

function getArrowCurveControls(start, end, sourceHandle, targetHandle) {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const sourceDirection = getConnectorDirection(sourceHandle) || getFallbackArrowDirection(start, end);
  const targetHandleDirection = getConnectorDirection(targetHandle);
  const targetDirection = targetHandleDirection
    ? { x: -targetHandleDirection.x, y: -targetHandleDirection.y }
    : getFallbackArrowDirection(start, end);

  const offset = clamp(distance * 0.42, 20, 170);
  const cappedOffset = Math.max(12, Math.min(offset, distance * 0.75 || 12));

  return {
    startControl: {
      x: start.x + sourceDirection.x * cappedOffset,
      y: start.y + sourceDirection.y * cappedOffset
    },
    endControl: {
      x: end.x - targetDirection.x * cappedOffset,
      y: end.y - targetDirection.y * cappedOffset
    }
  };
}

function getArrowPathData(start, end, sourceHandle, targetHandle) {
  const { startControl, endControl } = getArrowCurveControls(start, end, sourceHandle, targetHandle);
  return [
    "M",
    start.x,
    start.y,
    "C",
    startControl.x,
    startControl.y,
    endControl.x,
    endControl.y,
    end.x,
    end.y
  ].join(" ");
}

function getArrowBounds(start, end, sourceHandle, targetHandle) {
  const { startControl, endControl } = getArrowCurveControls(start, end, sourceHandle, targetHandle);
  const xs = [start.x, end.x, startControl.x, endControl.x];
  const ys = [start.y, end.y, startControl.y, endControl.y];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: Math.max(24, maxX - minX),
    height: Math.max(24, maxY - minY)
  };
}

function getElementBounds(element) {
  if (element.type === "arrow") {
    return getArrowBounds(
      { x: element.x1, y: element.y1 },
      { x: element.x2, y: element.y2 },
      element.sourceHandle,
      element.targetHandle
    );
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

function isArrowConnectableElement(element) {
  return element.type === "rect" || element.type === "ellipse" || element.type === "sticky";
}

function getConnectorPoint(element, handle) {
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;

  if (handle === "n") {
    return { x: centerX, y: element.y };
  }
  if (handle === "e") {
    return { x: element.x + element.width, y: centerY };
  }
  if (handle === "s") {
    return { x: centerX, y: element.y + element.height };
  }

  return { x: element.x, y: centerY };
}

function findNearestConnector(point, elements, maxDistance, ignoredConnector) {
  let nearest = null;
  let nearestDistance = maxDistance;

  for (const element of elements) {
    if (!isArrowConnectableElement(element)) {
      continue;
    }

    for (const handle of CONNECTOR_HANDLES) {
      if (
        ignoredConnector &&
        ignoredConnector.elementId === element.id &&
        ignoredConnector.handle === handle
      ) {
        continue;
      }

      const connectorPoint = getConnectorPoint(element, handle);
      const distance = Math.hypot(point.x - connectorPoint.x, point.y - connectorPoint.y);

      if (distance <= nearestDistance) {
        nearest = {
          elementId: element.id,
          handle,
          point: connectorPoint
        };
        nearestDistance = distance;
      }
    }
  }

  return nearest;
}

function getSelectionBox(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

function doBoundsIntersect(bounds, box) {
  return (
    bounds.x < box.x + box.width &&
    bounds.x + bounds.width > box.x &&
    bounds.y < box.y + box.height &&
    bounds.y + bounds.height > box.y
  );
}

function splitText(text) {
  return (text || "").split("\n");
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName;
  return (
    target.isContentEditable ||
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT"
  );
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
  const workspaceNameInputRef = useRef(null);
  const interactionHistoryStartRef = useRef(null);
  const elementsRef = useRef(INITIAL_ELEMENTS);
  const saveVersionNoticeTimeoutRef = useRef(null);

  const [activeTab, setActiveTab] = useState("app");
  const [activeTool, setActiveTool] = useState("select");
  const [documentName, setDocumentName] = useState(DEFAULT_DOCUMENT_NAME);
  const [elements, setElements] = useState(INITIAL_ELEMENTS);
  const [selectedIds, setSelectedIds] = useState([]);
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState("Loading from IndexedDB...");
  const [hydrated, setHydrated] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [versions, setVersions] = useState([]);
  const [showVersions, setShowVersions] = useState(false);
  const [exportFormat, setExportFormat] = useState("png");
  const [activeDialog, setActiveDialog] = useState(null);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const [deleteWorkspaceTarget, setDeleteWorkspaceTarget] = useState(null);
  const [historyByWorkspaceId, setHistoryByWorkspaceId] = useState({});
  const [dialogBusy, setDialogBusy] = useState(false);
  const [isSavingVersion, setIsSavingVersion] = useState(false);
  const [saveVersionNotice, setSaveVersionNotice] = useState(null);

  const [arrowDraft, setArrowDraft] = useState(null);
  const [penDraft, setPenDraft] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [resizeState, setResizeState] = useState(null);
  const [selectionBox, setSelectionBox] = useState(null);

  const selectedId = selectedIds[selectedIds.length - 1] ?? null;
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const hasMultiSelection = selectedIds.length > 1;
  const isCreateWorkspaceDialogOpen = activeDialog === "create-workspace";
  const isResetWorkspaceDialogOpen = activeDialog === "reset-workspace";
  const isDeleteWorkspaceDialogOpen = activeDialog === "delete-workspace";
  const isDialogOpen = isCreateWorkspaceDialogOpen || isResetWorkspaceDialogOpen || isDeleteWorkspaceDialogOpen;

  function showSaveVersionNotice(message, tone = "success") {
    setSaveVersionNotice({ message, tone });

    if (saveVersionNoticeTimeoutRef.current) {
      window.clearTimeout(saveVersionNoticeTimeoutRef.current);
    }

    saveVersionNoticeTimeoutRef.current = window.setTimeout(() => {
      setSaveVersionNotice(null);
      saveVersionNoticeTimeoutRef.current = null;
    }, 5200);
  }

  function setSelectedId(nextId) {
    setSelectedIds(nextId ? [nextId] : []);
  }

  const selectedElement = useMemo(
    () => {
      if (selectedIds.length !== 1) {
        return null;
      }

      return elements.find((element) => element.id === selectedIds[0]) ?? null;
    },
    [elements, selectedIds]
  );

  function inferArrowBinding(point, connectableElements, preferredHandle, maxDistance = 10) {
    let nearest = null;
    let nearestDistance = maxDistance;

    for (const element of connectableElements) {
      const handles = preferredHandle ? [preferredHandle] : CONNECTOR_HANDLES;

      for (const handle of handles) {
        const connectorPoint = getConnectorPoint(element, handle);
        const distance = Math.hypot(point.x - connectorPoint.x, point.y - connectorPoint.y);
        if (distance > nearestDistance) {
          continue;
        }

        nearest = {
          elementId: element.id,
          handle
        };
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  function syncConnectedArrows(nextElements) {
    const connectableElements = nextElements.filter((element) => isArrowConnectableElement(element));
    if (connectableElements.length === 0) {
      return nextElements;
    }

    const connectableById = new Map(connectableElements.map((element) => [element.id, element]));
    let changed = false;

    const synced = nextElements.map((element) => {
      if (element.type !== "arrow") {
        return element;
      }

      let nextArrow = element;

      const inferredSource = !element.source
        ? inferArrowBinding(
            { x: element.x1, y: element.y1 },
            connectableElements,
            element.sourceHandle || null
          )
        : null;
      const sourceBinding = element.source || inferredSource;
      if (
        sourceBinding &&
        (!element.source ||
          element.source.elementId !== sourceBinding.elementId ||
          element.source.handle !== sourceBinding.handle)
      ) {
        nextArrow = {
          ...nextArrow,
          source: sourceBinding
        };
        changed = true;
      }

      if (sourceBinding && sourceBinding.handle !== nextArrow.sourceHandle) {
        nextArrow = {
          ...nextArrow,
          sourceHandle: sourceBinding.handle
        };
        changed = true;
      }

      const sourceElement = sourceBinding ? connectableById.get(sourceBinding.elementId) : null;
      if (sourceElement) {
        const sourcePoint = getConnectorPoint(sourceElement, sourceBinding.handle);
        if (sourcePoint.x !== nextArrow.x1 || sourcePoint.y !== nextArrow.y1) {
          nextArrow = {
            ...nextArrow,
            x1: sourcePoint.x,
            y1: sourcePoint.y
          };
          changed = true;
        }
      }

      const inferredTarget =
        !element.target && element.targetHandle
          ? inferArrowBinding(
              { x: element.x2, y: element.y2 },
              connectableElements,
              element.targetHandle
            )
          : null;
      const targetBinding = element.target || inferredTarget;
      if (
        targetBinding &&
        (!element.target ||
          element.target.elementId !== targetBinding.elementId ||
          element.target.handle !== targetBinding.handle)
      ) {
        nextArrow = {
          ...nextArrow,
          target: targetBinding
        };
        changed = true;
      }

      if (targetBinding && targetBinding.handle !== nextArrow.targetHandle) {
        nextArrow = {
          ...nextArrow,
          targetHandle: targetBinding.handle
        };
        changed = true;
      }

      const targetElement = targetBinding ? connectableById.get(targetBinding.elementId) : null;
      if (targetElement) {
        const targetPoint = getConnectorPoint(targetElement, targetBinding.handle);
        if (targetPoint.x !== nextArrow.x2 || targetPoint.y !== nextArrow.y2) {
          nextArrow = {
            ...nextArrow,
            x2: targetPoint.x,
            y2: targetPoint.y
          };
          changed = true;
        }
      }

      return nextArrow;
    });

    return changed ? synced : nextElements;
  }

  function setElementsWithArrowSync(next) {
    const previousElements = elementsRef.current;
    const nextElements = typeof next === "function" ? next(previousElements) : next;
    const syncedElements = syncConnectedArrows(nextElements);

    if (previousElements === syncedElements) {
      return previousElements;
    }

    elementsRef.current = syncedElements;
    setElements(syncedElements);
    return syncedElements;
  }

  function cloneElementsSnapshot(items) {
    return JSON.parse(JSON.stringify(Array.isArray(items) ? items : []));
  }

  function areElementSnapshotsEqual(left, right) {
    if (left === right) {
      return true;
    }

    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    return JSON.stringify(left) === JSON.stringify(right);
  }

  function getWorkspaceHistory(workspaceId, source = historyByWorkspaceId) {
    if (!workspaceId) {
      return { past: [], future: [] };
    }

    return source[workspaceId] || { past: [], future: [] };
  }

  function setWorkspaceHistory(workspaceId, updater) {
    if (!workspaceId) {
      return;
    }

    setHistoryByWorkspaceId((previous) => {
      const current = getWorkspaceHistory(workspaceId, previous);
      const next = updater(current);
      if (next === current) {
        return previous;
      }

      return {
        ...previous,
        [workspaceId]: next
      };
    });
  }

  function pushUndoSnapshot(workspaceId, previousElements) {
    if (!workspaceId) {
      return;
    }

    const snapshot = cloneElementsSnapshot(previousElements);
    setWorkspaceHistory(workspaceId, (current) => {
      const nextPast = [...current.past, snapshot];
      if (nextPast.length > MAX_HISTORY) {
        nextPast.splice(0, nextPast.length - MAX_HISTORY);
      }

      return {
        past: nextPast,
        future: []
      };
    });
  }

  function applyElementsWithoutHistory(next) {
    return setElementsWithArrowSync(next);
  }

  function setElementsWithHistory(next, options = {}) {
    const { trackHistory = true, workspaceId = activeWorkspaceId } = options;
    const previousElements = elementsRef.current;
    const rawNext = typeof next === "function" ? next(previousElements) : next;
    const syncedNext = syncConnectedArrows(rawNext);

    if (areElementSnapshotsEqual(previousElements, syncedNext)) {
      return previousElements;
    }

    if (trackHistory) {
      pushUndoSnapshot(workspaceId, previousElements);
    }

    elementsRef.current = syncedNext;
    setElements(syncedNext);
    return syncedNext;
  }

  function commitInteractionHistoryIfChanged() {
    if (!activeWorkspaceId) {
      interactionHistoryStartRef.current = null;
      return;
    }

    const startSnapshot = interactionHistoryStartRef.current;
    interactionHistoryStartRef.current = null;

    if (!startSnapshot) {
      return;
    }

    const currentSnapshot = elementsRef.current;
    if (!areElementSnapshotsEqual(startSnapshot, currentSnapshot)) {
      pushUndoSnapshot(activeWorkspaceId, startSnapshot);
    }
  }

  function undoCanvasChange() {
    if (!activeWorkspaceId) {
      setStatus("No active workspace.");
      return;
    }

    const history = getWorkspaceHistory(activeWorkspaceId);
    if (history.past.length === 0) {
      setStatus("Nothing to undo.");
      return;
    }

    const previousSnapshot = history.past[history.past.length - 1];
    const currentSnapshot = cloneElementsSnapshot(elementsRef.current);
    setHistoryByWorkspaceId((previous) => ({
      ...previous,
      [activeWorkspaceId]: {
        past: history.past.slice(0, -1),
        future: [currentSnapshot, ...history.future].slice(0, MAX_HISTORY)
      }
    }));

    applyElementsWithoutHistory(cloneElementsSnapshot(previousSnapshot));
    setSelectedIds([]);
    setStatus("Undo applied.");
  }

  function redoCanvasChange() {
    if (!activeWorkspaceId) {
      setStatus("No active workspace.");
      return;
    }

    const history = getWorkspaceHistory(activeWorkspaceId);
    if (history.future.length === 0) {
      setStatus("Nothing to redo.");
      return;
    }

    const nextSnapshot = history.future[0];
    const currentSnapshot = cloneElementsSnapshot(elementsRef.current);
    const nextPast = [...history.past, currentSnapshot];
    if (nextPast.length > MAX_HISTORY) {
      nextPast.splice(0, nextPast.length - MAX_HISTORY);
    }

    setHistoryByWorkspaceId((previous) => ({
      ...previous,
      [activeWorkspaceId]: {
        past: nextPast,
        future: history.future.slice(1)
      }
    }));

    applyElementsWithoutHistory(cloneElementsSnapshot(nextSnapshot));
    setSelectedIds([]);
    setStatus("Redo applied.");
  }

  function workspaceNameFromValue(name) {
    if (name && name !== LEGACY_DEFAULT_DOCUMENT_NAME) {
      return name;
    }

    return DEFAULT_DOCUMENT_NAME;
  }

  function normalizeWorkspaceName(name) {
    return (name || "").trim().toLowerCase();
  }

  function parseWorkspaceSuffix(name) {
    const trimmed = (name || "").trim();
    const matched = trimmed.match(/^(.*?)(?:\s*\((\d+)\))?$/);
    if (!matched) {
      return {
        baseName: trimmed,
        explicitNumber: null
      };
    }

    const baseName = (matched[1] || "").trim();
    const explicitNumber = matched[2] ? Number(matched[2]) : null;
    if (!Number.isFinite(explicitNumber) || explicitNumber < 2) {
      return {
        baseName: trimmed,
        explicitNumber: null
      };
    }

    return {
      baseName: baseName || trimmed,
      explicitNumber
    };
  }

  function buildUniqueWorkspaceName(desiredName, existingWorkspaces) {
    const parsed = parseWorkspaceSuffix(desiredName);
    const baseName = parsed.baseName || desiredName;
    const normalizedBaseName = normalizeWorkspaceName(baseName);
    const takenNumbers = new Set();

    for (const workspace of existingWorkspaces || []) {
      const candidateName = workspaceNameFromValue(workspace?.name);
      const parsedCandidate = parseWorkspaceSuffix(candidateName);
      const candidateBaseName = parsedCandidate.baseName || candidateName;
      if (normalizeWorkspaceName(candidateBaseName) !== normalizedBaseName) {
        continue;
      }

      if (parsedCandidate.explicitNumber && parsedCandidate.explicitNumber >= 2) {
        takenNumbers.add(parsedCandidate.explicitNumber);
      } else {
        takenNumbers.add(1);
      }
    }

    if (!takenNumbers.has(1) && parsed.explicitNumber === null) {
      return baseName;
    }

    let nextNumber = parsed.explicitNumber && parsed.explicitNumber >= 2 ? parsed.explicitNumber : 2;
    while (takenNumbers.has(nextNumber)) {
      nextNumber += 1;
    }

    return `${baseName} (${nextNumber})`;
  }

  function sortWorkspaces(items) {
    return [...items].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function upsertWorkspaceCache(workspace) {
    if (!workspace?.id) {
      return;
    }

    setWorkspaces((previous) =>
      sortWorkspaces([
        workspace,
        ...previous.filter((item) => item.id !== workspace.id)
      ])
    );
  }

  function clearInteractionState() {
    setSelectedId(null);
    setSelectionBox(null);
    setArrowDraft(null);
    setPenDraft(null);
    setDragState(null);
    setResizeState(null);
    setShowVersions(false);
    interactionHistoryStartRef.current = null;
  }

  function applyWorkspaceState(workspace) {
    const nextName = workspaceNameFromValue(workspace?.name);
    const nextElements = Array.isArray(workspace?.elements) ? workspace.elements : INITIAL_ELEMENTS;
    const legacyDemoLoaded = isLegacyDemoData(nextElements);

    setDocumentName(nextName);
    applyElementsWithoutHistory(legacyDemoLoaded ? INITIAL_ELEMENTS : nextElements);
    setZoom(workspace?.zoom || 1);
    setLastSavedAt(workspace?.updatedAt || null);
    clearInteractionState();

    return legacyDemoLoaded;
  }

  async function refreshWorkspaceList() {
    const items = await listWorkspaces();
    setWorkspaces(items);
    return items;
  }

  useEffect(() => {
    elementsRef.current = elements;
  }, [elements]);

  useEffect(
    () => () => {
      if (saveVersionNoticeTimeoutRef.current) {
        window.clearTimeout(saveVersionNoticeTimeoutRef.current);
      }
    },
    []
  );

  function closeActiveDialog() {
    if (dialogBusy) {
      return;
    }

    setActiveDialog(null);
    setWorkspaceNameDraft("");
    setDeleteWorkspaceTarget(null);
  }

  function handleDialogCancel() {
    closeActiveDialog();
  }

  function handleDialogBackdropClick(event) {
    if (event.target !== event.currentTarget) {
      return;
    }

    closeActiveDialog();
  }

  useEffect(() => {
    if (!isDialogOpen) {
      return undefined;
    }

    function onDialogEscape(event) {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      closeActiveDialog();
    }

    window.addEventListener("keydown", onDialogEscape);
    return () => window.removeEventListener("keydown", onDialogEscape);
  }, [isDialogOpen, dialogBusy]);

  useEffect(() => {
    if (!isCreateWorkspaceDialogOpen) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      if (workspaceNameInputRef.current) {
        workspaceNameInputRef.current.focus();
        workspaceNameInputRef.current.select();
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isCreateWorkspaceDialogOpen]);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const savedWorkspace = await loadActiveWorkspace();
        if (cancelled) {
          return;
        }

        if (savedWorkspace) {
          setActiveWorkspaceId(savedWorkspace.id);
          const legacyDemoLoaded = applyWorkspaceState(savedWorkspace);
          const items = await listWorkspaces();
          if (cancelled) {
            return;
          }
          setWorkspaces(items);

          if (legacyDemoLoaded) {
            setStatus("Legacy demo data removed. Active workspace is ready.");
          } else {
            setStatus(`Loaded workspace (${formatTimestamp(savedWorkspace.updatedAt)}).`);
          }
        } else {
          const createdWorkspace = await createWorkspace({
            name: DEFAULT_DOCUMENT_NAME,
            elements: INITIAL_ELEMENTS,
            zoom: 1
          });

          if (cancelled) {
            return;
          }

          setActiveWorkspaceId(createdWorkspace.id);
          applyWorkspaceState(createdWorkspace);
          setWorkspaces([createdWorkspace]);
          setStatus("New workspace created. Start sketching.");
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
    if (!hydrated || !activeWorkspaceId) {
      return undefined;
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        const result = await saveWorkspace(
          activeWorkspaceId,
          {
            name: documentName,
            elements,
            zoom
          },
          { trackVersion: false }
        );

        setLastSavedAt(result.updatedAt);
        upsertWorkspaceCache(result);
      } catch (error) {
        console.error(error);
      }
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeWorkspaceId, hydrated, documentName, elements, zoom]);

  useEffect(() => {
    if (!hydrated || activeTab !== "workspaces") {
      return;
    }

    refreshWorkspaceList().catch((error) => {
      console.error(error);
      setStatus("Could not refresh workspace list.");
    });
  }, [activeTab, hydrated, activeWorkspaceId]);

  useEffect(() => {
    if (!dragState && !resizeState && !penDraft && !arrowDraft && !selectionBox) {
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

      if (selectionBox) {
        setSelectionBox((previous) => (previous ? { ...previous, end: point } : previous));
        return;
      }

      if (arrowDraft) {
        const snapTarget = findNearestConnector(point, elements, 18 / zoom, arrowDraft.source);
        const nextEnd = snapTarget ? snapTarget.point : point;
        setArrowDraft((previous) =>
          previous
            ? {
                ...previous,
                end: nextEnd,
                target: snapTarget
                  ? {
                      elementId: snapTarget.elementId,
                      handle: snapTarget.handle
                    }
                  : null
              }
            : previous
        );
        return;
      }

      if (resizeState) {
        const dx = point.x - resizeState.start.x;
        const dy = point.y - resizeState.start.y;

        setElementsWithHistory((previous) =>
          previous.map((element) => {
            if (element.id !== resizeState.id) {
              return element;
            }

            return resizeElementFromHandle(resizeState.origin, resizeState.handle, dx, dy);
          }),
          { trackHistory: false }
        );
        return;
      }

      if (dragState) {
        const dx = point.x - dragState.start.x;
        const dy = point.y - dragState.start.y;

        setElementsWithHistory((previous) =>
          previous.map((element) => {
            const origin = dragState.origins[element.id];
            if (!origin) {
              return element;
            }

            return shiftElement(origin, dx, dy);
          }),
          { trackHistory: false }
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

    function onPointerUp(event) {
      setDragState(null);
      setResizeState(null);

      if (selectionBox) {
        const box = getSelectionBox(selectionBox.start, selectionBox.end);
        const isClickOnly = box.width < 3 && box.height < 3;

        if (isClickOnly) {
          setSelectedIds([]);
          setStatus("Selection cleared.");
        } else {
          const nextSelectedIds = elements
            .filter((element) => doBoundsIntersect(getElementBounds(element), box))
            .map((element) => element.id);

          setSelectedIds(nextSelectedIds);
          if (nextSelectedIds.length === 0) {
            setStatus("No elements inside selection.");
          } else if (nextSelectedIds.length === 1) {
            setStatus("1 element selected.");
          } else {
            setStatus(`${nextSelectedIds.length} elements selected.`);
          }
        }

        setSelectionBox(null);
        commitInteractionHistoryIfChanged();
        return;
      }

      if (arrowDraft) {
        const releasedPoint = getCanvasPoint(event.clientX, event.clientY) ?? arrowDraft.end;
        const snapTarget = findNearestConnector(releasedPoint, elements, 18 / zoom, arrowDraft.source);
        const endPoint = snapTarget ? snapTarget.point : releasedPoint;
        const distance = Math.hypot(endPoint.x - arrowDraft.start.x, endPoint.y - arrowDraft.start.y);

        if (distance >= 12) {
          const arrow = {
            id: makeId(),
            type: "arrow",
            x1: arrowDraft.start.x,
            y1: arrowDraft.start.y,
            x2: endPoint.x,
            y2: endPoint.y,
            source: {
              elementId: arrowDraft.source.elementId,
              handle: arrowDraft.source.handle
            },
            target: snapTarget
              ? {
                  elementId: snapTarget.elementId,
                  handle: snapTarget.handle
                }
              : null,
            sourceHandle: arrowDraft.source.handle,
            targetHandle: snapTarget ? snapTarget.handle : null,
            stroke: "#5F5E5A",
            strokeWidth: 2
          };
          setElementsWithHistory((previous) => [...previous, arrow], { trackHistory: false });
          setSelectedId(arrow.id);
          setStatus("Arrow connected.");
        } else {
          setStatus("Arrow cancelled. Drag farther to create a connector.");
        }

        setArrowDraft(null);
        commitInteractionHistoryIfChanged();
        return;
      }

      if (penDraft?.points?.length >= 4) {
        const newPenElement = {
          id: penDraft.id,
          type: "pen",
          points: penDraft.points,
          stroke: "#5F5E5A",
          strokeWidth: 2,
          fill: "none"
        };

        setElementsWithHistory((previous) => [...previous, newPenElement], { trackHistory: false });
        setSelectedId(newPenElement.id);
      }

      setPenDraft(null);
      commitInteractionHistoryIfChanged();
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [dragState, resizeState, penDraft, arrowDraft, selectionBox, zoom, elements, activeWorkspaceId]);

  useEffect(() => {
    function onKeyDown(event) {
      if (isDialogOpen) {
        return;
      }

      if (event.defaultPrevented || isEditableTarget(event.target)) {
        return;
      }

      if (dragState || resizeState || penDraft || arrowDraft || selectionBox) {
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === "z" && !event.shiftKey) {
          event.preventDefault();
          undoCanvasChange();
          return;
        }

        if ((key === "z" && event.shiftKey) || key === "y") {
          event.preventDefault();
          redoCanvasChange();
          return;
        }
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        const allIds = elements.map((element) => element.id);
        setSelectedIds(allIds);
        setStatus(allIds.length === 0 ? "No elements to select." : `${allIds.length} elements selected.`);
        return;
      }

      if ((event.key !== "Delete" && event.key !== "Backspace") || selectedIds.length === 0) {
        return;
      }

      event.preventDefault();
      const idsToDelete = new Set(selectedIds);
      setElementsWithHistory((previous) => previous.filter((element) => !idsToDelete.has(element.id)));
      setSelectedIds([]);
      setArrowDraft(null);
      setPenDraft(null);
      setDragState(null);
      setResizeState(null);
      setSelectionBox(null);
      setStatus(idsToDelete.size === 1 ? "Selected element deleted." : `${idsToDelete.size} elements deleted.`);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    elements,
    selectedIds,
    isDialogOpen,
    activeWorkspaceId,
    historyByWorkspaceId,
    dragState,
    resizeState,
    penDraft,
    arrowDraft,
    selectionBox
  ]);

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
    if (!selectedId || selectedIds.length !== 1) {
      return;
    }

    setElementsWithHistory((previous) =>
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
      setSelectionBox({
        start: point,
        end: point
      });
      return;
    }

    if (activeTool === "pen") {
      setSelectedId(null);
      setSelectionBox(null);
      interactionHistoryStartRef.current = cloneElementsSnapshot(elementsRef.current);
      setPenDraft({ id: makeId(), points: [point.x, point.y] });
      return;
    }

    if (activeTool === "arrow") {
      setSelectedId(null);
      setSelectionBox(null);
      setArrowDraft(null);
      setStatus("Arrow mode: drag from one connector dot to another.");
      return;
    }

    const newElement = buildElementFromTool(activeTool, point);
    if (!newElement) {
      return;
    }

    setElementsWithHistory((previous) => [...previous, newElement]);
    setSelectedId(newElement.id);
    setSelectionBox(null);
    setStatus(`${newElement.type} added.`);
  }

  function handleElementPointerDown(event, element) {
    event.stopPropagation();

    if (activeTool !== "select") {
      setSelectedId(element.id);
      setSelectionBox(null);
      return;
    }

    const point = getCanvasPointFromEvent(event);
    if (!point) {
      return;
    }

    const nextSelectedIds = selectedIdSet.has(element.id) ? selectedIds : [element.id];
    if (!selectedIdSet.has(element.id)) {
      setSelectedIds([element.id]);
    }

    const selectedLookup = new Set(nextSelectedIds);
    const origins = {};
    for (const item of elements) {
      if (selectedLookup.has(item.id)) {
        origins[item.id] = item;
      }
    }

    setSelectionBox(null);
    setResizeState(null);
    interactionHistoryStartRef.current = cloneElementsSnapshot(elementsRef.current);
    setDragState({
      ids: nextSelectedIds,
      origins,
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
    setSelectionBox(null);
    setDragState(null);
    interactionHistoryStartRef.current = cloneElementsSnapshot(elementsRef.current);
    setResizeState({
      id: element.id,
      origin: element,
      handle,
      start: point
    });
  }

  function handleConnectorPointerDown(event, element, handle) {
    event.stopPropagation();
    if (event.button !== 0 || activeTool !== "arrow" || !isArrowConnectableElement(element)) {
      return;
    }

    const startPoint = getConnectorPoint(element, handle);
    setSelectedId(element.id);
    setSelectionBox(null);
    interactionHistoryStartRef.current = cloneElementsSnapshot(elementsRef.current);
    setArrowDraft({
      source: {
        elementId: element.id,
        handle
      },
      target: null,
      start: startPoint,
      end: startPoint
    });
    setStatus("Drag to another connector and release.");
  }

  function getResizeHandlePosition(element, handle) {
    const x = handle.includes("e") ? element.x + element.width : element.x;
    const y = handle.includes("s") ? element.y + element.height : element.y;
    return { x, y };
  }

  function handleCreateNewWorkspace() {
    const defaultName = workspaceNameFromValue(documentName).trim() || DEFAULT_DOCUMENT_NAME;
    setWorkspaceNameDraft(defaultName);
    setActiveDialog("create-workspace");
  }

  async function handleCreateWorkspaceDialogConfirm(event) {
    event.preventDefault();
    if (dialogBusy) {
      return;
    }

    const defaultName = workspaceNameFromValue(documentName).trim() || DEFAULT_DOCUMENT_NAME;
    const desiredName = workspaceNameDraft.trim() || defaultName;
    setDialogBusy(true);

    try {
      const existingWorkspaces = await listWorkspaces();
      const nextName = buildUniqueWorkspaceName(desiredName, existingWorkspaces);
      const createdWorkspace = await createWorkspace({
        name: nextName,
        elements,
        zoom
      });

      setActiveWorkspaceId(createdWorkspace.id);
      applyWorkspaceState(createdWorkspace);
      upsertWorkspaceCache(createdWorkspace);
      setActiveTab("app");
      setActiveDialog(null);
      setWorkspaceNameDraft("");
      setStatus(`New workspace "${createdWorkspace.name}" created and opened.`);
    } catch (error) {
      console.error(error);
      setStatus("Create new workspace failed.");
    } finally {
      setDialogBusy(false);
    }
  }

  async function handleSaveVersion() {
    if (isSavingVersion) {
      return;
    }

    if (!activeWorkspaceId) {
      setStatus("No active workspace to version.");
      showSaveVersionNotice("No active workspace to save.", "error");
      return;
    }

    setIsSavingVersion(true);

    try {
      const result = await saveWorkspace(
        activeWorkspaceId,
        {
          name: documentName,
          elements,
          zoom
        },
        { trackVersion: true }
      );

      setLastSavedAt(result.updatedAt);
      upsertWorkspaceCache(result);

      let items = [];
      try {
        items = await fetchVersions(activeWorkspaceId, 10);
        setVersions(items);
      } catch (fetchError) {
        console.error(fetchError);
      }

      const savedAtLabel = formatTimestamp(result.updatedAt);
      const workspaceLabel = workspaceNameFromValue(result.name || documentName);
      const elementCount = Array.isArray(result.elements) ? result.elements.length : elements.length;
      const elementLabel = `${elementCount} element${elementCount === 1 ? "" : "s"}`;
      const versionLabel =
        items.length >= 10
          ? "10+ recent versions now available."
          : `${items.length} saved version${items.length === 1 ? "" : "s"} in this workspace.`;

      showSaveVersionNotice(`Saved "${workspaceLabel}" at ${savedAtLabel}. Snapshot captured ${elementLabel}. ${versionLabel}`);
      setStatus(`Version saved (${savedAtLabel}). Snapshot captured ${elementLabel}.`);
    } catch (error) {
      console.error(error);
      showSaveVersionNotice("Save version failed. Please retry.", "error");
      setStatus("Save version failed.");
    } finally {
      setIsSavingVersion(false);
    }
  }

  async function handleVersionsToggle() {
    if (showVersions) {
      setShowVersions(false);
      return;
    }

    if (!activeWorkspaceId) {
      setStatus("No active workspace.");
      return;
    }

    try {
      const items = await fetchVersions(activeWorkspaceId, 10);
      setVersions(items);
      setShowVersions(true);
    } catch (error) {
      console.error(error);
      setStatus("Could not load versions.");
    }
  }

  async function handleRestoreVersion(versionId) {
    if (!activeWorkspaceId) {
      setStatus("No active workspace.");
      return;
    }

    try {
      const version = await restoreVersion(versionId, activeWorkspaceId);
      if (!version) {
        setStatus("Version not found for the active workspace.");
        return;
      }

      setDocumentName(workspaceNameFromValue(version.name));
      applyElementsWithoutHistory(version.elements || []);
      setZoom(version.zoom || 1);
      clearInteractionState();
      setStatus(`Version restored from ${formatTimestamp(version.updatedAt)}.`);
    } catch (error) {
      console.error(error);
      setStatus("Restore failed.");
    }
  }

  async function handleLoadWorkspace(workspaceId) {
    if (!workspaceId) {
      return;
    }

    if (workspaceId === activeWorkspaceId) {
      setStatus("That workspace is already active.");
      setActiveTab("app");
      return;
    }

    try {
      if (activeWorkspaceId) {
        const autosaved = await saveWorkspace(
          activeWorkspaceId,
          {
            name: documentName,
            elements,
            zoom
          },
          { trackVersion: false }
        );
        setLastSavedAt(autosaved.updatedAt);
        upsertWorkspaceCache(autosaved);
      }

      const nextWorkspace = await loadWorkspace(workspaceId);
      if (!nextWorkspace) {
        await refreshWorkspaceList();
        setStatus("Workspace no longer exists.");
        return;
      }

      await persistActiveWorkspaceId(nextWorkspace.id);
      setActiveWorkspaceId(nextWorkspace.id);
      const legacyDemoLoaded = applyWorkspaceState(nextWorkspace);
      upsertWorkspaceCache(nextWorkspace);
      setActiveTab("app");

      if (legacyDemoLoaded) {
        setStatus(`Loaded "${workspaceNameFromValue(nextWorkspace.name)}". Legacy demo data removed.`);
      } else {
        setStatus(`Loaded "${workspaceNameFromValue(nextWorkspace.name)}". Previous workspace autosaved.`);
      }
    } catch (error) {
      console.error(error);
      setStatus("Workspace load failed.");
    }
  }

  function handleRequestDeleteWorkspace(workspace) {
    if (!workspace?.id || dialogBusy) {
      return;
    }

    setDeleteWorkspaceTarget({
      id: workspace.id,
      name: workspaceNameFromValue(workspace.name),
      isActive: workspace.id === activeWorkspaceId
    });
    setActiveDialog("delete-workspace");
  }

  async function handleDeleteWorkspaceDialogConfirm() {
    if (!deleteWorkspaceTarget?.id || dialogBusy) {
      return;
    }

    setDialogBusy(true);

    try {
      const deletingId = deleteWorkspaceTarget.id;
      const deletingName = workspaceNameFromValue(deleteWorkspaceTarget.name);
      const wasActive = deletingId === activeWorkspaceId;

      await deleteWorkspace(deletingId);
      setHistoryByWorkspaceId((previous) => {
        if (!Object.prototype.hasOwnProperty.call(previous, deletingId)) {
          return previous;
        }

        const next = { ...previous };
        delete next[deletingId];
        return next;
      });
      const remainingWorkspaces = await listWorkspaces();
      setWorkspaces(remainingWorkspaces);

      if (wasActive) {
        setVersions([]);
        if (remainingWorkspaces.length > 0) {
          const fallbackWorkspace = remainingWorkspaces[0];
          await persistActiveWorkspaceId(fallbackWorkspace.id);
          setActiveWorkspaceId(fallbackWorkspace.id);
          applyWorkspaceState(fallbackWorkspace);
          setActiveTab("app");
          setStatus(`Workspace "${deletingName}" deleted. Loaded "${workspaceNameFromValue(fallbackWorkspace.name)}".`);
        } else {
          const createdWorkspace = await createWorkspace({
            name: DEFAULT_DOCUMENT_NAME,
            elements: INITIAL_ELEMENTS,
            zoom: 1
          });

          setActiveWorkspaceId(createdWorkspace.id);
          applyWorkspaceState(createdWorkspace);
          setWorkspaces([createdWorkspace]);
          setActiveTab("app");
          setStatus(`Workspace "${deletingName}" deleted. New blank workspace created.`);
        }
      } else {
        setStatus(`Workspace "${deletingName}" deleted.`);
      }

      setActiveDialog(null);
      setDeleteWorkspaceTarget(null);
    } catch (error) {
      console.error(error);
      setStatus("Delete workspace failed.");
    } finally {
      setDialogBusy(false);
    }
  }

  function handleResetWorkspace() {
    if (!activeWorkspaceId) {
      setStatus("No active workspace.");
      return;
    }

    setActiveDialog("reset-workspace");
  }

  async function handleResetWorkspaceDialogConfirm() {
    if (!activeWorkspaceId || dialogBusy) {
      return;
    }
    setDialogBusy(true);

    try {
      const resetWorkspace = await saveWorkspace(
        activeWorkspaceId,
        {
          name: workspaceNameFromValue(documentName),
          elements: INITIAL_ELEMENTS,
          zoom: 1
        },
        { trackVersion: false }
      );

      setActiveWorkspaceId(resetWorkspace.id);
      applyWorkspaceState(resetWorkspace);
      upsertWorkspaceCache(resetWorkspace);
      setVersions([]);
      setActiveTab("app");
      setActiveDialog(null);
      setWorkspaceNameDraft("");
      setStatus(`Workspace "${workspaceNameFromValue(resetWorkspace.name)}" reset. Other workspaces were kept.`);
    } catch (error) {
      console.error(error);
      setStatus("Reset failed.");
    } finally {
      setDialogBusy(false);
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

    setElementsWithHistory((previous) => [...previous, newElement]);
    setActiveTab("app");
    setSelectedId(newElement.id);
    setSelectionBox(null);
    setStatus(`${stencil.title} added from stencil library.`);
  }

  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) || null;
  const activeWorkspaceName = workspaceNameFromValue(activeWorkspace?.name || documentName);
  const activeWorkspaceHistory = getWorkspaceHistory(activeWorkspaceId);
  const canUndo = activeWorkspaceHistory.past.length > 0;
  const canRedo = activeWorkspaceHistory.future.length > 0;

  const selectedAnchor = selectedElement ? getElementAnchor(selectedElement) : null;
  const resizeHandleRadius = 6 / zoom;
  const resizeHandleStrokeWidth = 1.4 / zoom;
  const connectorHandleRadius = 5 / zoom;
  const connectorHandleStrokeWidth = 1.2 / zoom;

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
          className={`tab-btn ${activeTab === "workspaces" ? "active" : ""}`}
          onClick={() => setActiveTab("workspaces")}
          type="button"
        >
          Save & Load
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
              <button className="ghost-btn history-action-btn" onClick={undoCanvasChange} type="button" disabled={!canUndo}>
                <Undo2 size={14} /> Undo
              </button>
              <button className="ghost-btn history-action-btn" onClick={redoCanvasChange} type="button" disabled={!canRedo}>
                <Redo2 size={14} /> Redo
              </button>
              <button className="ghost-btn" onClick={handleCreateNewWorkspace} type="button">
                <Save size={14} /> Create New Workspace
              </button>
              <button className="ghost-btn" onClick={handleSaveVersion} type="button" disabled={isSavingVersion}>
                <History size={14} /> {isSavingVersion ? "Saving..." : "Save Version"}
              </button>
              {saveVersionNotice && (
                <span className={`save-version-feedback ${saveVersionNotice.tone}`} role="status" aria-live="polite">
                  {saveVersionNotice.message}
                </span>
              )}
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
              <div className="versions-title">Recent versions - {activeWorkspaceName}</div>
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
                      setArrowDraft(null);
                      setSelectionBox(null);
                      if (tool.id === "arrow") {
                        setStatus("Arrow mode: drag from one connector dot to another.");
                      }
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
                    const isSelected = selectedIdSet.has(element.id);
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
                                !hasMultiSelection &&
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

                          {activeTool === "arrow" &&
                            CONNECTOR_HANDLES.map((handle) => {
                              const position = getConnectorPoint(element, handle);
                              return (
                                <circle
                                  key={`connector-${element.id}-${handle}`}
                                  className="connector-handle"
                                  cx={position.x}
                                  cy={position.y}
                                  r={connectorHandleRadius}
                                  strokeWidth={connectorHandleStrokeWidth}
                                  onPointerDown={(event) => handleConnectorPointerDown(event, element, handle)}
                                />
                              );
                            })}
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
                                !hasMultiSelection &&
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

                          {activeTool === "arrow" &&
                            CONNECTOR_HANDLES.map((handle) => {
                              const position = getConnectorPoint(element, handle);
                              return (
                                <circle
                                  key={`connector-${element.id}-${handle}`}
                                  className="connector-handle"
                                  cx={position.x}
                                  cy={position.y}
                                  r={connectorHandleRadius}
                                  strokeWidth={connectorHandleStrokeWidth}
                                  onPointerDown={(event) => handleConnectorPointerDown(event, element, handle)}
                                />
                              );
                            })}
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
                      const arrowPathData = getArrowPathData(
                        { x: element.x1, y: element.y1 },
                        { x: element.x2, y: element.y2 },
                        element.sourceHandle,
                        element.targetHandle
                      );

                      return (
                        <g
                          key={element.id}
                          className="canvas-element"
                          onPointerDown={(event) => handleElementPointerDown(event, element)}
                        >
                          <path
                            d={arrowPathData}
                            stroke={element.stroke}
                            strokeWidth={element.strokeWidth || 2}
                            fill="none"
                            strokeLinecap="round"
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

                  {selectionBox && (
                    <rect
                      className="selection-marquee"
                      {...getSelectionBox(selectionBox.start, selectionBox.end)}
                    />
                  )}

                  {arrowDraft && (
                    <path
                      d={getArrowPathData(
                        arrowDraft.start,
                        arrowDraft.end,
                        arrowDraft.source.handle,
                        arrowDraft.target?.handle
                      )}
                      stroke="#5F5E5A"
                      strokeWidth="2"
                      fill="none"
                      strokeLinecap="round"
                      strokeDasharray="6 4"
                      markerEnd="url(#arrowHead)"
                      opacity="0.78"
                    />
                  )}
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

              {selectedIds.length === 0 && (
                <p className="muted">Select an element to edit fill, position, text, and stroke.</p>
              )}
              {hasMultiSelection && (
                <p className="muted">{selectedIds.length} elements selected. Drag any selected element to move all.</p>
              )}

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
                      className={`layer-row ${selectedIdSet.has(element.id) ? "active" : ""}`}
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

      {activeTab === "workspaces" && (
        <section className="panel workspace-save-load-view">
          <div className="workspace-manager-card">
            <div className="workspace-manager-head">
              <div>
                <h2>Save and load workspaces</h2>
                <p>Create a new workspace from this draft, then load any workspace when needed.</p>
              </div>
              <div className="workspace-manager-actions">
                <button type="button" className="ghost-btn" onClick={handleCreateNewWorkspace}>
                  <Save size={14} /> Create New Workspace
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    refreshWorkspaceList().catch((error) => {
                      console.error(error);
                      setStatus("Could not refresh workspace list.");
                    });
                  }}
                >
                  Refresh list
                </button>
              </div>
            </div>

            <div className="workspace-list">
              {workspaces.length === 0 && (
                <p className="workspace-empty">No workspaces yet. Click Create New Workspace to make one.</p>
              )}

              {workspaces.map((workspace) => {
                const isActive = workspace.id === activeWorkspaceId;
                const workspaceName = workspaceNameFromValue(workspace.name);

                return (
                  <article key={workspace.id} className={`workspace-item ${isActive ? "active" : ""}`}>
                    <div className="workspace-item-main">
                      <div className="workspace-item-title-row">
                        <h3>{workspaceName}</h3>
                        {isActive && <span className="workspace-active-tag">Active</span>}
                      </div>
                      <div className="workspace-item-meta">
                        Last save: {formatTimestamp(workspace.updatedAt)} | Elements:{" "}
                        {Array.isArray(workspace.elements) ? workspace.elements.length : 0}
                      </div>
                    </div>

                    <div className="workspace-item-actions">
                      <button
                        type="button"
                        className={`ghost-btn ${isActive ? "workspace-load-btn-active" : ""}`}
                        onClick={() => handleLoadWorkspace(workspace.id)}
                        disabled={isActive}
                      >
                        {isActive ? "Loaded" : "Load"}
                      </button>
                      <button
                        type="button"
                        className="warn-btn workspace-delete-btn"
                        onClick={() => handleRequestDeleteWorkspace(workspace)}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
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

      {isDialogOpen && (
        <div className="dialog-backdrop" role="presentation" onClick={handleDialogBackdropClick}>
          {isCreateWorkspaceDialogOpen && (
            <div
              className="dialog-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-workspace-dialog-title"
              aria-describedby="create-workspace-dialog-copy"
              onClick={(event) => event.stopPropagation()}
            >
              <form className="dialog-form" onSubmit={handleCreateWorkspaceDialogConfirm}>
                <h2 id="create-workspace-dialog-title" className="dialog-title">
                  Create new workspace
                </h2>
                <p id="create-workspace-dialog-copy" className="dialog-copy">
                  Name your new workspace. If left blank, it will use the default workspace name.
                </p>
                <label className="dialog-field" htmlFor="workspace-name-input">
                  Workspace name
                </label>
                <input
                  ref={workspaceNameInputRef}
                  id="workspace-name-input"
                  className="dialog-input"
                  type="text"
                  value={workspaceNameDraft}
                  onChange={(event) => setWorkspaceNameDraft(event.target.value)}
                  disabled={dialogBusy}
                />
                <div className="dialog-actions">
                  <button type="button" className="ghost-btn" onClick={handleDialogCancel} disabled={dialogBusy}>
                    Cancel
                  </button>
                  <button type="submit" className="primary-btn" disabled={dialogBusy}>
                    {dialogBusy ? "Creating..." : "Create Workspace"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {isResetWorkspaceDialogOpen && (
            <div
              className="dialog-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="reset-workspace-dialog-title"
              aria-describedby="reset-workspace-dialog-copy"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 id="reset-workspace-dialog-title" className="dialog-title">
                Reset this workspace?
              </h2>
              <p id="reset-workspace-dialog-copy" className="dialog-copy">
                This resets only the active workspace to a blank canvas. Other saved workspaces and version history
                are kept.
              </p>
              <div className="dialog-actions">
                <button type="button" className="ghost-btn" onClick={handleDialogCancel} disabled={dialogBusy}>
                  Cancel
                </button>
                <button type="button" className="warn-btn" onClick={handleResetWorkspaceDialogConfirm} disabled={dialogBusy}>
                  {dialogBusy ? "Resetting..." : "Reset Workspace"}
                </button>
              </div>
            </div>
          )}

          {isDeleteWorkspaceDialogOpen && (
            <div
              className="dialog-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-workspace-dialog-title"
              aria-describedby="delete-workspace-dialog-copy"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 id="delete-workspace-dialog-title" className="dialog-title">
                Delete workspace?
              </h2>
              <p id="delete-workspace-dialog-copy" className="dialog-copy">
                Delete "{workspaceNameFromValue(deleteWorkspaceTarget?.name || DEFAULT_DOCUMENT_NAME)}" permanently?
                This will also remove its saved versions.
              </p>
              <div className="dialog-actions">
                <button type="button" className="ghost-btn" onClick={handleDialogCancel} disabled={dialogBusy}>
                  Cancel
                </button>
                <button type="button" className="warn-btn" onClick={handleDeleteWorkspaceDialogConfirm} disabled={dialogBusy}>
                  {dialogBusy ? "Deleting..." : "Delete Workspace"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <footer className="status-row">
        <span>{status}</span>
        <span>
          Workspace: {activeWorkspaceName} | Autosave: IndexedDB
        </span>
      </footer>
    </div>
  );
}
