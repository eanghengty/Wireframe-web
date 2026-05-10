const DB_NAME = "qe-wireframe-tool";
const DB_VERSION = 1;
const DOCUMENT_STORE = "documents";
const VERSION_STORE = "versions";
const ACTIVE_DOCUMENT_ID = "active-document";

let dbPromise;

function openDb() {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
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
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

export async function loadActiveDocument() {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOCUMENT_STORE, "readonly");
    const request = tx.objectStore(DOCUMENT_STORE).get(ACTIVE_DOCUMENT_ID);

    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveActiveDocument(document, options = {}) {
  const { trackVersion = true } = options;
  const db = await openDb();
  const updatedAt = Date.now();

  const payload = {
    id: ACTIVE_DOCUMENT_ID,
    name: document.name,
    elements: document.elements,
    zoom: document.zoom,
    updatedAt
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction([DOCUMENT_STORE, VERSION_STORE], "readwrite");
    tx.objectStore(DOCUMENT_STORE).put(payload);

    if (trackVersion) {
      tx.objectStore(VERSION_STORE).add({
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

export async function fetchVersions(limit = 12) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(VERSION_STORE, "readonly");
    const store = tx.objectStore(VERSION_STORE);
    const request = store.openCursor(null, "prev");
    const versions = [];

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || versions.length >= limit) {
        resolve(versions);
        return;
      }

      versions.push(cursor.value);
      cursor.continue();
    };

    request.onerror = () => reject(request.error);
  });
}

export async function restoreVersion(versionId) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(VERSION_STORE, "readonly");
    const request = tx.objectStore(VERSION_STORE).get(versionId);

    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function clearStoredDocument() {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([DOCUMENT_STORE, VERSION_STORE], "readwrite");
    tx.objectStore(DOCUMENT_STORE).delete(ACTIVE_DOCUMENT_ID);
    tx.objectStore(VERSION_STORE).clear();

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
