const DB_NAME = "qe-wireframe-tool";
const DB_VERSION = 2;
const DOCUMENT_STORE = "documents";
const VERSION_STORE = "versions";
const META_STORE = "meta";

const LEGACY_ACTIVE_DOCUMENT_ID = "active-document";
const ACTIVE_WORKSPACE_META_ID = "active-workspace";

let dbPromise;

function makeWorkspaceId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `ws-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeDocument(document) {
  return {
    name: document?.name || "Untitled",
    elements: Array.isArray(document?.elements) ? document.elements : [],
    zoom: typeof document?.zoom === "number" ? document.zoom : 1
  };
}

function createWorkspaceRecord(workspaceId, document, updatedAt = Date.now()) {
  const normalized = normalizeDocument(document);

  return {
    id: workspaceId,
    name: normalized.name,
    elements: normalized.elements,
    zoom: normalized.zoom,
    updatedAt
  };
}

function isWorkspaceRecord(record) {
  return Boolean(record && typeof record.id === "string" && record.id !== LEGACY_ACTIVE_DOCUMENT_ID);
}

function migrateLegacyRecords(transaction) {
  const documents = transaction.objectStore(DOCUMENT_STORE);
  const versions = transaction.objectStore(VERSION_STORE);
  const meta = transaction.objectStore(META_STORE);

  function assignWorkspaceIdToLegacyVersions(workspaceId) {
    if (!workspaceId) {
      return;
    }

    const cursorRequest = versions.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        return;
      }

      const value = cursor.value;
      if (!value.workspaceId) {
        cursor.update({
          ...value,
          workspaceId
        });
      }

      cursor.continue();
    };
  }

  function setMetaFromLatestWorkspace() {
    const workspaceCursorRequest = documents.openCursor();
    let latestWorkspace = null;

    workspaceCursorRequest.onsuccess = () => {
      const cursor = workspaceCursorRequest.result;
      if (!cursor) {
        if (latestWorkspace) {
          meta.put({
            id: ACTIVE_WORKSPACE_META_ID,
            workspaceId: latestWorkspace.id
          });
          assignWorkspaceIdToLegacyVersions(latestWorkspace.id);
        }
        return;
      }

      const current = cursor.value;
      if (isWorkspaceRecord(current)) {
        if (!latestWorkspace || (current.updatedAt || 0) > (latestWorkspace.updatedAt || 0)) {
          latestWorkspace = current;
        }
      }

      cursor.continue();
    };
  }

  const legacyRequest = documents.get(LEGACY_ACTIVE_DOCUMENT_ID);
  legacyRequest.onsuccess = () => {
    const legacy = legacyRequest.result;

    if (legacy) {
      const workspaceId = makeWorkspaceId();
      const migrated = createWorkspaceRecord(workspaceId, legacy, legacy.updatedAt || Date.now());
      documents.put(migrated);
      documents.delete(LEGACY_ACTIVE_DOCUMENT_ID);
      meta.put({
        id: ACTIVE_WORKSPACE_META_ID,
        workspaceId
      });
      assignWorkspaceIdToLegacyVersions(workspaceId);
      return;
    }

    const activeMetaRequest = meta.get(ACTIVE_WORKSPACE_META_ID);
    activeMetaRequest.onsuccess = () => {
      const workspaceId = activeMetaRequest.result?.workspaceId;
      if (workspaceId) {
        assignWorkspaceIdToLegacyVersions(workspaceId);
        return;
      }

      setMetaFromLatestWorkspace();
    };
  };
}

function openDb() {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;

      if (!db.objectStoreNames.contains(DOCUMENT_STORE)) {
        db.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(VERSION_STORE)) {
        const versions = db.createObjectStore(VERSION_STORE, {
          keyPath: "versionId",
          autoIncrement: true
        });
        versions.createIndex("updatedAt", "updatedAt");
      }

      const versionsStore = request.transaction.objectStore(VERSION_STORE);
      if (!versionsStore.indexNames.contains("workspaceId")) {
        versionsStore.createIndex("workspaceId", "workspaceId");
      }
      if (!versionsStore.indexNames.contains("workspaceUpdatedAt")) {
        versionsStore.createIndex("workspaceUpdatedAt", ["workspaceId", "updatedAt"]);
      }

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "id" });
      }

      if (event.oldVersion < 2 && request.transaction) {
        migrateLegacyRecords(request.transaction);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

export async function getActiveWorkspaceId() {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readonly");
    const request = tx.objectStore(META_STORE).get(ACTIVE_WORKSPACE_META_ID);

    request.onsuccess = () => resolve(request.result?.workspaceId ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function setActiveWorkspaceId(workspaceId) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readwrite");
    tx.objectStore(META_STORE).put({
      id: ACTIVE_WORKSPACE_META_ID,
      workspaceId
    });

    tx.oncomplete = () => resolve(workspaceId);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function listWorkspaces() {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOCUMENT_STORE, "readonly");
    const request = tx.objectStore(DOCUMENT_STORE).getAll();

    request.onsuccess = () => {
      const items = (request.result ?? [])
        .filter((record) => isWorkspaceRecord(record))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      resolve(items);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function loadWorkspace(workspaceId) {
  if (!workspaceId) {
    return null;
  }

  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOCUMENT_STORE, "readonly");
    const request = tx.objectStore(DOCUMENT_STORE).get(workspaceId);

    request.onsuccess = () => {
      const workspace = request.result ?? null;
      resolve(isWorkspaceRecord(workspace) ? workspace : null);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function loadActiveWorkspace() {
  const activeWorkspaceId = await getActiveWorkspaceId();
  if (activeWorkspaceId) {
    const activeWorkspace = await loadWorkspace(activeWorkspaceId);
    if (activeWorkspace) {
      return activeWorkspace;
    }
  }

  const workspaces = await listWorkspaces();
  if (workspaces.length === 0) {
    return null;
  }

  await setActiveWorkspaceId(workspaces[0].id);
  return workspaces[0];
}

export async function createWorkspace(document) {
  const db = await openDb();
  const workspaceId = makeWorkspaceId();
  const payload = createWorkspaceRecord(workspaceId, document, Date.now());

  return new Promise((resolve, reject) => {
    const tx = db.transaction([DOCUMENT_STORE, META_STORE], "readwrite");
    tx.objectStore(DOCUMENT_STORE).put(payload);
    tx.objectStore(META_STORE).put({
      id: ACTIVE_WORKSPACE_META_ID,
      workspaceId
    });

    tx.oncomplete = () => resolve(payload);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveWorkspace(workspaceId, document, options = {}) {
  const { trackVersion = false } = options;
  const db = await openDb();
  const updatedAt = Date.now();
  const payload = createWorkspaceRecord(workspaceId, document, updatedAt);

  return new Promise((resolve, reject) => {
    const storeNames = trackVersion
      ? [DOCUMENT_STORE, META_STORE, VERSION_STORE]
      : [DOCUMENT_STORE, META_STORE];
    const tx = db.transaction(storeNames, "readwrite");
    tx.objectStore(DOCUMENT_STORE).put(payload);
    tx.objectStore(META_STORE).put({
      id: ACTIVE_WORKSPACE_META_ID,
      workspaceId
    });

    if (trackVersion) {
      tx.objectStore(VERSION_STORE).add({
        workspaceId,
        name: payload.name,
        elements: payload.elements,
        zoom: payload.zoom,
        updatedAt
      });
    }

    tx.oncomplete = () => resolve(payload);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function fetchVersions(workspaceId, limit = 12) {
  if (!workspaceId) {
    return [];
  }

  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(VERSION_STORE, "readonly");
    const store = tx.objectStore(VERSION_STORE);
    const versions = [];

    let request;
    if (store.indexNames.contains("workspaceUpdatedAt")) {
      const workspaceRange = window.IDBKeyRange.bound(
        [workspaceId, 0],
        [workspaceId, Number.MAX_SAFE_INTEGER]
      );
      request = store.index("workspaceUpdatedAt").openCursor(workspaceRange, "prev");
    } else {
      request = store.openCursor(null, "prev");
    }

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || versions.length >= limit) {
        resolve(versions);
        return;
      }

      const version = cursor.value;
      if (!version.workspaceId || version.workspaceId === workspaceId) {
        versions.push(version);
      }
      cursor.continue();
    };

    request.onerror = () => reject(request.error);
  });
}

export async function restoreVersion(versionId, workspaceId) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(VERSION_STORE, "readonly");
    const request = tx.objectStore(VERSION_STORE).get(versionId);

    request.onsuccess = () => {
      const version = request.result ?? null;
      if (!version) {
        resolve(null);
        return;
      }

      if (workspaceId && version.workspaceId && version.workspaceId !== workspaceId) {
        resolve(null);
        return;
      }

      resolve(version);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteWorkspace(workspaceId) {
  if (!workspaceId) {
    return;
  }

  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([DOCUMENT_STORE, VERSION_STORE], "readwrite");
    tx.objectStore(DOCUMENT_STORE).delete(workspaceId);

    const versionsStore = tx.objectStore(VERSION_STORE);
    const useWorkspaceIndex = versionsStore.indexNames.contains("workspaceId");
    const request = useWorkspaceIndex
      ? versionsStore.index("workspaceId").openCursor(workspaceId)
      : versionsStore.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        return;
      }

      const version = cursor.value;
      if (useWorkspaceIndex || version?.workspaceId === workspaceId) {
        cursor.delete();
      }
      cursor.continue();
    };

    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function clearStoredDocument() {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([DOCUMENT_STORE, VERSION_STORE, META_STORE], "readwrite");
    tx.objectStore(DOCUMENT_STORE).clear();
    tx.objectStore(VERSION_STORE).clear();
    tx.objectStore(META_STORE).clear();

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
