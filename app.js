const STORAGE_KEY = "fuwaDataV1";
const PREFERENCES_KEY = "fuwaPreferencesV1";
const DATABASE_NAME = "FuwaDB";
const DATABASE_VERSION = 7;
const MAX_PHOTOS_PER_ENTRY = 8;
const MAX_PHOTO_DIMENSION = 1800;
const PHOTO_JPEG_QUALITY = 0.82;
const CONTENT_STORES = ["entries", "tinyJoys", "letters"];
const ALL_STORES = [...CONTENT_STORES, "media", "chapters", "threads", "moodCheckins", "bookmarks", "nightlyReflections", "thenNow", "comfortItems", "unsentLetters", "thoughtBubbles", "dreams", "settings"];
const LEGACY_MIGRATION_KEY = "legacy-fuwaDataV1-imported";

const defaultState = {
  entries: [],
  tinyJoys: [],
  letters: [],
  moodCheckins: [],
  threads: [],
  bookmarks: [],
  nightlyReflections: [],
  thenNow: [],
  comfortItems: [],
  unsentLetters: [],
  thoughtBubbles: [],
  dreams: [],
  selectedMood: "good",
  theme: "pink",
  wallpaperEnabled: false,
  wallpaperOverlay: "medium",
  sleepSound: "rain",
  sleepMinutes: 30,
  sleepVolume: 45
};

let state = structuredClone(defaultState);
let currentView = "home";
let editorMedia = [];
let removedMediaIds = new Set();
let moodJarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let editingThreadId = null;
let activeThreadId = null;
let activeBookmarkId = null;
let bookmarkEditorEntryId = null;

// Diary content belongs in IndexedDB. Only these two tiny UI preferences remain
// in localStorage so the content database and display preferences stay separate.
function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "{}");
    return {
      selectedMood: typeof saved.selectedMood === "string" ? saved.selectedMood : defaultState.selectedMood,
      theme: typeof saved.theme === "string" ? saved.theme : defaultState.theme,
      wallpaperEnabled: typeof saved.wallpaperEnabled === "boolean" ? saved.wallpaperEnabled : defaultState.wallpaperEnabled,
      wallpaperOverlay: ["light", "medium", "strong"].includes(saved.wallpaperOverlay) ? saved.wallpaperOverlay : defaultState.wallpaperOverlay,
      sleepSound: typeof saved.sleepSound === "string" ? saved.sleepSound : defaultState.sleepSound,
      sleepMinutes: Number.isFinite(saved.sleepMinutes) ? saved.sleepMinutes : defaultState.sleepMinutes,
      sleepVolume: Number.isFinite(saved.sleepVolume) ? saved.sleepVolume : defaultState.sleepVolume
    };
  } catch (error) {
    console.error("Could not read Fuwa preferences.", error);
    return { selectedMood: defaultState.selectedMood, theme: defaultState.theme };
  }
}

function savePreferences() {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({
      selectedMood: state.selectedMood,
      theme: state.theme,
      wallpaperEnabled: state.wallpaperEnabled,
      wallpaperOverlay: state.wallpaperOverlay,
      sleepSound: state.sleepSound,
      sleepMinutes: state.sleepMinutes,
      sleepVolume: state.sleepVolume
    }));
  } catch (error) {
    console.error("Could not save Fuwa preferences.", error);
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction was aborted"));
  });
}

const diaryRepository = {
  db: null,

  async initialize() {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onblocked = () => console.error("FuwaDB upgrade is blocked by another open Fuwa tab.");
    request.onupgradeneeded = () => {
      const db = request.result;
      ALL_STORES.forEach(storeName => {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, storeName === "settings" ? { keyPath: "key" } : { keyPath: "id" });
        }
      });

      const mediaStore = request.transaction.objectStore("media");
      if (!mediaStore.indexNames.contains("entryId")) {
        mediaStore.createIndex("entryId", "entryId", { unique: false });
      }

      const bookmarkStore = request.transaction.objectStore("bookmarks");
      if (!bookmarkStore.indexNames.contains("entryId")) {
        bookmarkStore.createIndex("entryId", "entryId", { unique: false });
      }
      if (!bookmarkStore.indexNames.contains("revisitDate")) {
        bookmarkStore.createIndex("revisitDate", "revisitDate", { unique: false });
      }
    };
    this.db = await requestResult(request);
  },

  async getAll(storeName) {
    return requestResult(this.db.transaction(storeName, "readonly").objectStore(storeName).getAll());
  },

  async get(storeName, id) {
    return requestResult(this.db.transaction(storeName, "readonly").objectStore(storeName).get(id));
  },

  async save(storeName, record) {
    const transaction = this.db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(record);
    await transactionDone(transaction);
  },

  async remove(storeName, id) {
    const transaction = this.db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(id);
    await transactionDone(transaction);
  },

  async getMediaForEntry(entryId) {
    const transaction = this.db.transaction("media", "readonly");
    const store = transaction.objectStore("media");
    if (store.indexNames.contains("entryId")) {
      return requestResult(store.index("entryId").getAll(entryId));
    }
    const all = await requestResult(store.getAll());
    return all.filter(record => record.entryId === entryId);
  },

  async readAllMedia() {
    return this.getAll("media");
  },

  async getBookmarksForEntry(entryId) {
    const transaction = this.db.transaction("bookmarks", "readonly");
    const store = transaction.objectStore("bookmarks");
    if (store.indexNames.contains("entryId")) {
      return requestResult(store.index("entryId").getAll(entryId));
    }
    const all = await requestResult(store.getAll());
    return all.filter(record => record.entryId === entryId);
  },

  async saveEntryWithMedia(entry, newMediaRecords, removedIds) {
    const transaction = this.db.transaction(["entries", "media"], "readwrite");
    transaction.objectStore("entries").put(entry);
    const mediaStore = transaction.objectStore("media");
    newMediaRecords.forEach(record => mediaStore.put(record));
    removedIds.forEach(id => mediaStore.delete(id));
    await transactionDone(transaction);
  },

  async deleteEntryWithMedia(entryId) {
    const [mediaRecords, bookmarkRecords] = await Promise.all([
      this.getMediaForEntry(entryId),
      this.getBookmarksForEntry(entryId)
    ]);
    const transaction = this.db.transaction(["entries", "media", "bookmarks"], "readwrite");
    transaction.objectStore("entries").delete(entryId);
    const mediaStore = transaction.objectStore("media");
    mediaRecords.forEach(record => mediaStore.delete(record.id));
    const bookmarkStore = transaction.objectStore("bookmarks");
    bookmarkRecords.forEach(record => bookmarkStore.delete(record.id));
    await transactionDone(transaction);
  },

  async readCurrentData() {
    const [entries, tinyJoys, letters, moodCheckins, threads, bookmarks, nightlyReflections, thenNow, comfortItems, unsentLetters, thoughtBubbles, dreams] = await Promise.all([
      ...CONTENT_STORES.map(store => this.getAll(store)),
      this.getAll("moodCheckins"),
      this.getAll("threads"),
      this.getAll("bookmarks"),
      this.getAll("nightlyReflections"),
      this.getAll("thenNow"),
      this.getAll("comfortItems"),
      this.getAll("unsentLetters"),
      this.getAll("thoughtBubbles"),
      this.getAll("dreams")
    ]);
    return { entries, tinyJoys, letters, moodCheckins, threads, bookmarks, nightlyReflections, thenNow, comfortItems, unsentLetters, thoughtBubbles, dreams };
  },

  async replaceContent(data, mediaRecords = []) {
    const stores = [...CONTENT_STORES, "media", "moodCheckins", "threads", "bookmarks", "nightlyReflections", "thenNow", "comfortItems", "unsentLetters", "thoughtBubbles", "dreams"];
    const transaction = this.db.transaction(stores, "readwrite");
    CONTENT_STORES.forEach(storeName => {
      const store = transaction.objectStore(storeName);
      store.clear();
      data[storeName].forEach(record => store.put(record));
    });
    const mediaStore = transaction.objectStore("media");
    mediaStore.clear();
    mediaRecords.forEach(record => mediaStore.put(record));
    const moodStore = transaction.objectStore("moodCheckins");
    moodStore.clear();
    (data.moodCheckins || []).forEach(record => moodStore.put(record));
    const threadStore = transaction.objectStore("threads");
    threadStore.clear();
    (data.threads || []).forEach(record => threadStore.put(record));
    const bookmarkStore = transaction.objectStore("bookmarks");
    bookmarkStore.clear();
    (data.bookmarks || []).forEach(record => bookmarkStore.put(record));
    const nightlyStore = transaction.objectStore("nightlyReflections");
    nightlyStore.clear();
    (data.nightlyReflections || []).forEach(record => nightlyStore.put(record));

    ["thenNow", "comfortItems", "unsentLetters", "thoughtBubbles", "dreams"].forEach(storeName => {
      const store = transaction.objectStore(storeName);
      store.clear();
      (data[storeName] || []).forEach(record => store.put(record));
    });

    await transactionDone(transaction);
  },

  async deleteThreadAndUnlink(threadId) {
    const transaction = this.db.transaction(["threads", "entries"], "readwrite");
    transaction.objectStore("threads").delete(threadId);
    const entryStore = transaction.objectStore("entries");
    const entries = await requestResult(entryStore.getAll());
    entries.forEach(entry => {
      if (Array.isArray(entry.threadIds) && entry.threadIds.includes(threadId)) {
        entry.threadIds = entry.threadIds.filter(id => id !== threadId);
        entry.updatedAt = Date.now();
        entryStore.put(entry);
      }
    });
    await transactionDone(transaction);
  },

  async clearDiaryData() {
    const stores = [...CONTENT_STORES, "media", "moodCheckins", "threads", "bookmarks", "nightlyReflections", "thenNow", "comfortItems", "unsentLetters", "thoughtBubbles", "dreams"];
    const transaction = this.db.transaction(stores, "readwrite");
    stores.forEach(storeName => transaction.objectStore(storeName).clear());
    await transactionDone(transaction);
  },

  async getSetting(key) {
    return requestResult(this.db.transaction("settings", "readonly").objectStore("settings").get(key));
  },

  async saveSetting(record) {
    const transaction = this.db.transaction("settings", "readwrite");
    transaction.objectStore("settings").put(record);
    await transactionDone(transaction);
  },

  async removeSetting(key) {
    const transaction = this.db.transaction("settings", "readwrite");
    transaction.objectStore("settings").delete(key);
    await transactionDone(transaction);
  },

  async migrateLegacyData() {
    const settings = this.db.transaction("settings", "readonly").objectStore("settings");
    if (await requestResult(settings.get(LEGACY_MIGRATION_KEY))) return;

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    let legacy;
    try {
      legacy = JSON.parse(raw);
      validateContentData(legacy);
    } catch (error) {
      console.error("Fuwa legacy data is malformed; migration was not attempted.", error);
      return;
    }

    // Content writes and the completion marker share one atomic transaction.
    // A failed write leaves the legacy backup untouched and permits a later retry.
    const stores = [...CONTENT_STORES, "settings"];
    const transaction = this.db.transaction(stores, "readwrite");
    CONTENT_STORES.forEach(storeName => {
      const store = transaction.objectStore(storeName);
      legacy[storeName].forEach(record => store.put(record));
    });
    transaction.objectStore("settings").put({ key: LEGACY_MIGRATION_KEY, completedAt: Date.now() });
    await transactionDone(transaction);

    state.selectedMood = typeof legacy.selectedMood === "string" ? legacy.selectedMood : state.selectedMood;
    state.theme = typeof legacy.theme === "string" ? legacy.theme : state.theme;
    savePreferences();
  }
};

function validateContentData(data) {
  if (!data || typeof data !== "object") throw new Error("Data must be an object");
  CONTENT_STORES.forEach(storeName => {
    if (!Array.isArray(data[storeName])) throw new Error(`${storeName} must be an array`);
    const ids = new Set();
    data[storeName].forEach(record => {
      if (!record || typeof record !== "object" || typeof record.id !== "string" || !record.id) {
        throw new Error(`${storeName} contains a record without a stable string ID`);
      }
      if (ids.has(record.id)) throw new Error(`${storeName} contains duplicate IDs`);
      ids.add(record.id);
    });
  });
  return data;
}

async function loadState() {
  const preferences = loadPreferences();
  const content = await diaryRepository.readCurrentData();
  state = { ...structuredClone(defaultState), ...content, ...preferences };
}


function moodIconMarkup(mood, extraClass = "") {
  const safeMood = moodLabels[mood] ? mood : "good";
  return `<span class="fuwa-mood-icon mood-${safeMood} ${extraClass}" aria-hidden="true"><i></i></span>`;
}

const moodEmoji = {
  amazing: "🥰",
  good: "🙂",
  neutral: "😐",
  tired: "😮‍💨",
  sad: "😔",
  angry: "😤"
};

function $(id) {
  return document.getElementById(id);
}

function saveState() {
  savePreferences();
  renderAll();
}

function formatDate(dateString, options = { month: "short", day: "numeric", year: "numeric" }) {
  if (!dateString) return "";
  const date = new Date(`${dateString}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", options).format(date);
}

function isoToday() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function uid(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value = "") {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function cleanupEditorMediaPreviews() {
  editorMedia.forEach(item => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  });
  editorMedia = [];
  removedMediaIds = new Set();
}

function imageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Fuwa could not read that image."));
    };
    image.src = url;
  });
}

async function compressPhoto(file) {
  if (!file || !file.type.startsWith("image/")) throw new Error("That file is not an image.");

  const image = await imageFromBlob(file);
  const scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error("Image compression failed.")), "image/jpeg", PHOTO_JPEG_QUALITY);
  });

  return { blob, width, height, type: "image/jpeg" };
}

function renderEditorMedia() {
  const grid = $("entryPhotoGrid");
  if (!grid) return;

  grid.innerHTML = editorMedia.map(item => `
    <div class="photo-thumb">
      <button type="button" class="photo-thumb-open" data-photo-open="${item.id}" aria-label="Open photo">
        <img src="${item.previewUrl}" alt="Diary photo" />
      </button>
      <button type="button" class="photo-remove-btn" data-photo-remove="${item.id}" aria-label="Remove photo">×</button>
      ${item.isNew ? '<span class="photo-new-badge">New</span>' : ''}
    </div>
  `).join("");

  grid.querySelectorAll("[data-photo-open]").forEach(button => {
    button.addEventListener("click", () => openPhotoViewer(button.dataset.photoOpen));
  });
  grid.querySelectorAll("[data-photo-remove]").forEach(button => {
    button.addEventListener("click", () => removeEditorPhoto(button.dataset.photoRemove));
  });

  const addButton = $("addPhotosButton");
  if (addButton) {
    addButton.disabled = editorMedia.length >= MAX_PHOTOS_PER_ENTRY;
    addButton.textContent = editorMedia.length >= MAX_PHOTOS_PER_ENTRY ? "Photo limit reached" : "＋ Add photos";
  }
}

function removeEditorPhoto(id) {
  const item = editorMedia.find(photo => photo.id === id);
  if (!item) return;
  if (!item.isNew) removedMediaIds.add(id);
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  editorMedia = editorMedia.filter(photo => photo.id !== id);
  renderEditorMedia();
}

async function addEntryPhotos(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  if (!files.length) return;

  const remaining = MAX_PHOTOS_PER_ENTRY - editorMedia.length;
  if (remaining <= 0) {
    toast(`Fuwa allows up to ${MAX_PHOTOS_PER_ENTRY} photos per entry.`);
    return;
  }

  const selected = files.slice(0, remaining);
  if (files.length > remaining) toast(`Only ${remaining} more photo${remaining === 1 ? "" : "s"} can be added.`);

  $("addPhotosButton").disabled = true;
  $("addPhotosButton").textContent = "Preparing…";

  try {
    for (const file of selected) {
      const compressed = await compressPhoto(file);
      const id = uid("media");
      editorMedia.push({
        id,
        entryId: null,
        blob: compressed.blob,
        type: compressed.type,
        width: compressed.width,
        height: compressed.height,
        originalName: file.name || "photo",
        createdAt: Date.now(),
        isNew: true,
        previewUrl: URL.createObjectURL(compressed.blob)
      });
    }
    renderEditorMedia();
  } catch (error) {
    console.error("Could not prepare selected photo.", error);
    toast("Fuwa couldn't prepare one of those photos.");
    renderEditorMedia();
  }
}

function openPhotoViewer(id) {
  const item = editorMedia.find(photo => photo.id === id);
  if (!item) return;
  $("photoViewerImage").src = item.previewUrl;
  $("photoViewer").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closePhotoViewer() {
  $("photoViewer").classList.add("hidden");
  $("photoViewerImage").removeAttribute("src");
  document.body.style.overflow = "";
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not encode photo."));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) throw new Error("Invalid photo backup data");
  const parts = dataUrl.split(",");
  const header = parts[0];
  const encoded = parts[1] || "";
  const mimeMatch = header.match(/^data:([^;]+);base64$/);
  if (!mimeMatch) throw new Error("Unsupported photo backup encoding");
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeMatch[1] });
}






function validateSimpleStore(items, name) {
  if (items === undefined) return [];
  if (!Array.isArray(items)) throw new Error(`${name} must be an array`);
  const ids = new Set();
  items.forEach(record => {
    if (!record || typeof record.id !== "string" || !record.id) throw new Error(`${name} contains an invalid record`);
    if (ids.has(record.id)) throw new Error(`${name} contains duplicate IDs`);
    ids.add(record.id);
  });
  return items;
}

function validateNightlyReflections(items) {
  if (items === undefined) return [];
  if (!Array.isArray(items)) throw new Error("nightlyReflections must be an array");
  const ids = new Set();
  items.forEach(record => {
    if (!record || typeof record.id !== "string" || !record.id || typeof record.date !== "string") {
      throw new Error("nightlyReflections contains an invalid record");
    }
    if (ids.has(record.id)) throw new Error("nightlyReflections contains duplicate IDs");
    ids.add(record.id);
  });
  return items;
}

function validateBookmarks(bookmarks) {
  if (bookmarks === undefined) return [];
  if (!Array.isArray(bookmarks)) throw new Error("bookmarks must be an array");
  const ids = new Set();
  bookmarks.forEach(record => {
    if (!record || typeof record.id !== "string" || !record.id || typeof record.entryId !== "string" || !record.entryId ||
        typeof record.quote !== "string" || !record.quote.trim() || typeof record.revisitDate !== "string") {
      throw new Error("bookmarks contains an invalid record");
    }
    if (ids.has(record.id)) throw new Error("bookmarks contains duplicate IDs");
    ids.add(record.id);
  });
  return bookmarks;
}

function validateThreads(threads) {
  if (threads === undefined) return [];
  if (!Array.isArray(threads)) throw new Error("threads must be an array");
  const ids = new Set();
  threads.forEach(record => {
    if (!record || typeof record.id !== "string" || !record.id || typeof record.title !== "string" || !record.title.trim()) {
      throw new Error("threads contains an invalid record");
    }
    if (ids.has(record.id)) throw new Error("threads contains duplicate IDs");
    ids.add(record.id);
  });
  return threads;
}

function validateMoodCheckins(checkins) {
  if (checkins === undefined) return [];
  if (!Array.isArray(checkins)) throw new Error("moodCheckins must be an array");
  const ids = new Set();
  checkins.forEach(record => {
    if (!record || typeof record.id !== "string" || !record.id || typeof record.date !== "string" || !moodEmoji[record.mood]) {
      throw new Error("moodCheckins contains an invalid record");
    }
    if (ids.has(record.id)) throw new Error("moodCheckins contains duplicate IDs");
    ids.add(record.id);
  });
  return checkins;
}

function validateMediaBackup(media) {
  if (media === undefined) return [];
  if (!Array.isArray(media)) throw new Error("media must be an array");
  const ids = new Set();
  media.forEach(record => {
    if (!record || typeof record.id !== "string" || !record.id || typeof record.entryId !== "string" || !record.entryId) {
      throw new Error("media contains an invalid record");
    }
    if (ids.has(record.id)) throw new Error("media contains duplicate IDs");
    ids.add(record.id);
    if (typeof record.dataUrl !== "string") throw new Error("media record is missing photo data");
  });
  return media;
}



function normalizeThreadIds(entry) {
  return Array.isArray(entry.threadIds) ? entry.threadIds.filter(id => state.threads.some(thread => thread.id === id)) : [];
}

function threadEntryCount(threadId) {
  return state.entries.filter(entry => normalizeThreadIds(entry).includes(threadId)).length;
}

function threadEntries(threadId) {
  return state.entries
    .filter(entry => normalizeThreadIds(entry).includes(threadId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
}

function renderHomeThreads() {
  const host = $("homeThreadPreview");
  if (!host) return;
  const threads = [...state.threads]
    .sort((a, b) => threadEntryCount(b.id) - threadEntryCount(a.id) || b.updatedAt - a.updatedAt)
    .slice(0, 3);
  if (!threads.length) {
    host.innerHTML = `<button class="thread-empty-preview" type="button" id="homeCreateThread">🧵 Start a thread for a story that keeps returning.</button>`;
    $("homeCreateThread")?.addEventListener("click", () => openThreadModal());
    return;
  }
  host.innerHTML = threads.map(thread => `
    <button class="thread-preview-card" type="button" data-thread-open="${escapeHtml(thread.id)}">
      <span>${escapeHtml(thread.emoji || "🧵")}</span>
      <strong>${escapeHtml(thread.title)}</strong>
      <small>${threadEntryCount(thread.id)} ${threadEntryCount(thread.id) === 1 ? "memory" : "memories"}</small>
    </button>
  `).join("");
  host.querySelectorAll("[data-thread-open]").forEach(button => {
    button.addEventListener("click", () => openThreadDetail(button.dataset.threadOpen));
  });
}

function renderThreads() {
  const grid = $("threadGrid");
  if (!grid) return;
  const threads = [...state.threads].sort((a, b) => b.updatedAt - a.updatedAt);
  if (!threads.length) {
    grid.innerHTML = `<div class="empty-state"><div class="thread-empty-icon">🧵</div><strong>No threads yet</strong><p>Threads connect memories that belong to the same ongoing story.</p><button class="secondary-btn" id="emptyNewThread" type="button">Create your first thread</button></div>`;
    $("emptyNewThread")?.addEventListener("click", () => openThreadModal());
    return;
  }
  grid.innerHTML = threads.map(thread => {
    const entries = threadEntries(thread.id);
    const range = entries.length ? `${formatDate(entries[0].date)}${entries.length > 1 ? ` → ${formatDate(entries[entries.length - 1].date)}` : ""}` : "Waiting for its first memory";
    return `
      <article class="thread-card">
        <button class="thread-card-main" type="button" data-thread-open="${escapeHtml(thread.id)}">
          <span class="thread-card-emoji">${escapeHtml(thread.emoji || "🧵")}</span>
          <div>
            <h3>${escapeHtml(thread.title)}</h3>
            <p>${escapeHtml(thread.description || "An ongoing story in your life.")}</p>
            <small>${entries.length} ${entries.length === 1 ? "memory" : "memories"} · ${escapeHtml(range)}</small>
          </div>
        </button>
        <button class="thread-card-edit" type="button" data-thread-edit="${escapeHtml(thread.id)}" aria-label="Edit ${escapeHtml(thread.title)}">•••</button>
      </article>`;
  }).join("");
  grid.querySelectorAll("[data-thread-open]").forEach(button => button.addEventListener("click", () => openThreadDetail(button.dataset.threadOpen)));
  grid.querySelectorAll("[data-thread-edit]").forEach(button => button.addEventListener("click", () => openThreadModal(button.dataset.threadEdit)));
}

function renderEntryThreadPicker(selectedIds = null) {
  const host = $("entryThreadPicker");
  if (!host) return;
  const current = selectedIds || (editingEntryId ? normalizeThreadIds(state.entries.find(entry => entry.id === editingEntryId) || {}) : []);
  if (!state.threads.length) {
    host.innerHTML = `<span class="muted thread-picker-empty">No threads yet.</span>`;
    return;
  }
  host.innerHTML = state.threads.map(thread => `
    <label class="thread-choice">
      <input type="checkbox" value="${escapeHtml(thread.id)}" ${current.includes(thread.id) ? "checked" : ""}>
      <span>${escapeHtml(thread.emoji || "🧵")} ${escapeHtml(thread.title)}</span>
    </label>
  `).join("");
}

function selectedEditorThreadIds() {
  return [...document.querySelectorAll("#entryThreadPicker input:checked")].map(input => input.value);
}

function openThreadModal(threadId = null) {
  editingThreadId = threadId;
  const thread = state.threads.find(item => item.id === threadId);
  $("threadModalTitle").textContent = thread ? "Edit Memory Thread" : "New Memory Thread";
  $("threadEmojiInput").value = thread?.emoji || "🧵";
  $("threadEmojiPreview").textContent = thread?.emoji || "🧵";
  $("threadTitleInput").value = thread?.title || "";
  $("threadDescriptionInput").value = thread?.description || "";
  $("deleteThreadButton").classList.toggle("hidden", !thread);
  $("threadModal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  setTimeout(() => $("threadTitleInput").focus(), 80);
}

function closeThreadModal() {
  $("threadModal").classList.add("hidden");
  document.body.style.overflow = "";
  editingThreadId = null;
}

async function saveThreadFromForm(event) {
  event.preventDefault();
  const title = $("threadTitleInput").value.trim();
  if (!title) return toast("Give this thread a name first.");
  const existing = state.threads.find(item => item.id === editingThreadId);
  const record = {
    id: existing?.id || crypto.randomUUID(),
    title,
    emoji: $("threadEmojiInput").value.trim() || "🧵",
    description: $("threadDescriptionInput").value.trim(),
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  try {
    await diaryRepository.save("threads", record);
    const index = state.threads.findIndex(item => item.id === record.id);
    if (index >= 0) state.threads[index] = record;
    else state.threads.push(record);
    closeThreadModal();
    renderAll();
    if (!$("editorView").classList.contains("active")) navigate("threads");
    toast(existing ? "Memory Thread updated 🧵" : "Memory Thread created 🧵");
  } catch (error) {
    console.error("Could not save thread.", error);
    toast("Fuwa couldn't save that thread.");
  }
}

async function deleteCurrentThread() {
  const thread = state.threads.find(item => item.id === editingThreadId);
  if (!thread) return;
  if (!confirm(`Delete "${thread.title}"? Your diary entries will stay safe.`)) return;
  try {
    await diaryRepository.deleteThreadAndUnlink(thread.id);
    state.threads = state.threads.filter(item => item.id !== thread.id);
    state.entries = state.entries.map(entry => ({
      ...entry,
      threadIds: Array.isArray(entry.threadIds) ? entry.threadIds.filter(id => id !== thread.id) : []
    }));
    if (activeThreadId === thread.id) activeThreadId = null;
    closeThreadModal();
    renderAll();
    navigate("threads");
    toast("Thread removed. Your memories are still here.");
  } catch (error) {
    console.error("Could not delete thread.", error);
    toast("Fuwa couldn't delete that thread.");
  }
}

function openThreadDetail(threadId) {
  activeThreadId = threadId;
  renderThreadDetail();
  navigate("threadDetail");
}

function renderThreadDetail() {
  const thread = state.threads.find(item => item.id === activeThreadId);
  if (!thread) return;
  const entries = threadEntries(thread.id);
  const first = entries[0];
  const latest = entries[entries.length - 1];
  $("threadDetailHero").innerHTML = `
    <div class="thread-detail-icon">${escapeHtml(thread.emoji || "🧵")}</div>
    <div class="thread-detail-copy">
      <p class="eyebrow">Memory Thread</p>
      <h2>${escapeHtml(thread.title)}</h2>
      <p>${escapeHtml(thread.description || "An ongoing story in your life.")}</p>
      <div class="thread-detail-stats">
        <span><strong>${entries.length}</strong> ${entries.length === 1 ? "memory" : "memories"}</span>
        <span>${first ? `${escapeHtml(formatDate(first.date))}${latest && latest.id !== first.id ? ` → ${escapeHtml(formatDate(latest.date))}` : ""}` : "No dates yet"}</span>
      </div>
      <button class="text-btn" id="editActiveThread" type="button">Edit thread</button>
    </div>`;
  $("editActiveThread").addEventListener("click", () => openThreadModal(thread.id));

  const timeline = $("threadTimeline");
  if (!entries.length) {
    timeline.innerHTML = `<div class="empty-state">This thread is waiting for its first memory. Add it from any diary entry.</div>`;
    return;
  }
  timeline.innerHTML = entries.map(entry => `
    <article class="thread-timeline-item">
      <div class="thread-timeline-dot">${moodIconMarkup(entry.mood)}</div>
      <div class="thread-timeline-line"></div>
      <button class="thread-timeline-card" type="button" data-entry="${escapeHtml(entry.id)}">
        <time>${escapeHtml(formatDate(entry.date))}</time>
        <strong>${escapeHtml(entry.title || "Untitled memory")}</strong>
        <p>${escapeHtml((entry.body || "").slice(0, 120))}${(entry.body || "").length > 120 ? "…" : ""}</p>
      </button>
    </article>
  `).join("");
  timeline.querySelectorAll("[data-entry]").forEach(button => button.addEventListener("click", () => openEditor(button.dataset.entry)));
}

function threadChipsForEntry(entry) {
  const ids = normalizeThreadIds(entry);
  return ids.map(id => {
    const thread = state.threads.find(item => item.id === id);
    return thread ? `<span class="tag thread-tag">${escapeHtml(thread.emoji || "🧵")} ${escapeHtml(thread.title)}</span>` : "";
  }).join("");
}






const renderCache = { monthly: "", weather: "", sanctuary: "" };

function collectionSignature(items, extra = "") {
  if (!Array.isArray(items) || !items.length) return `0:${extra}`;
  let newest = 0;
  for (const item of items) newest = Math.max(newest, Number(item.updatedAt || item.createdAt || 0));
  return `${items.length}:${newest}:${extra}`;
}

function monthlySignature(date) {
  return [
    monthKey(date),
    collectionSignature(state.entries),
    collectionSignature(state.moodCheckins),
    collectionSignature(state.tinyJoys),
    collectionSignature(state.nightlyReflections),
    collectionSignature(state.dreams),
    collectionSignature(state.thoughtBubbles)
  ].join("|");
}

function sanctuarySignature() {
  return [state.entries.length, state.moodCheckins.length, state.nightlyReflections.length, state.dreams.length, state.thoughtBubbles.length].join(":");
}

let featureModalMode = null;
let featureEditingId = null;
let monthlyCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let weatherCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
}

function itemsForMonth(items, date, dateField="date") {
  const prefix = `${monthKey(date)}-`;
  return items.filter(item => typeof item[dateField] === "string" && item[dateField].startsWith(prefix));
}

function openFeatureModal(mode, id=null) {
  featureModalMode = mode;
  featureEditingId = id;
  const title = $("featureModalTitle");
  const fields = $("featureModalFields");
  let item = null;

  if (mode === "comfort") item = state.comfortItems.find(x => x.id === id);
  if (mode === "unsent") item = state.unsentLetters.find(x => x.id === id);
  if (mode === "dream") item = state.dreams.find(x => x.id === id);
  if (mode === "thenNow") item = state.thenNow.find(x => x.id === id);

  if (mode === "comfort") {
    title.textContent = item ? "Edit Comfort Item" : "Add Comfort Item";
    fields.innerHTML = `
      <label>Type
        <select id="featureType"><option value="reminder">Reminder</option><option value="quote">Quote</option><option value="place">Place</option><option value="person">Person</option><option value="memory">Memory</option></select>
      </label>
      <label>Title<input id="featureTitle" maxlength="80" value="${escapeHtml(item?.title || "")}" required></label>
      <label>What makes this comforting?<textarea id="featureBody" rows="5" maxlength="700">${escapeHtml(item?.body || "")}</textarea></label>`;
    setTimeout(() => { if (item) $("featureType").value = item.type || "reminder"; }, 0);
  }

  if (mode === "unsent") {
    title.textContent = item ? "Edit Unsent Letter" : "New Unsent Letter";
    fields.innerHTML = `
      <label>To<input id="featureTitle" maxlength="100" value="${escapeHtml(item?.to || "")}" placeholder="A person, place, younger me…" required></label>
      <label>Letter<textarea id="featureBody" rows="10" maxlength="5000" required>${escapeHtml(item?.body || "")}</textarea></label>`;
  }

  if (mode === "dream") {
    title.textContent = item ? "Edit Dream" : "Catch a Dream";
    fields.innerHTML = `
      <label>Dream title<input id="featureTitle" maxlength="100" value="${escapeHtml(item?.title || "")}" placeholder="The train that went nowhere"></label>
      <label>Fragments<textarea id="featureBody" rows="7" maxlength="3000" placeholder="Anything you remember…">${escapeHtml(item?.body || "")}</textarea></label>
      <label>Feeling
        <select id="dreamFeeling">
          <option value="peaceful">Peaceful</option><option value="strange">Strange</option><option value="happy">Happy</option><option value="scary">Scary</option><option value="sad">Sad</option><option value="confusing">Confusing</option>
        </select>
      </label>
      <label class="feature-check"><input id="dreamRecurring" type="checkbox"> Recurring dream</label>`;
    setTimeout(() => {
      if (item) {
        $("dreamFeeling").value = item.feeling || "strange";
        $("dreamRecurring").checked = !!item.recurring;
      }
    }, 0);
  }

  if (mode === "thenNow") {
    const source = state.entries.find(e => e.id === (item?.entryId || id));
    title.textContent = "Then & Now";
    fields.innerHTML = `
      <div class="then-now-source">
        <span>${escapeHtml(source ? formatDate(source.date) : "")}</span>
        <blockquote>“${escapeHtml(source ? memoryDriftPreviewText(source, 250) : "")}”</blockquote>
      </div>
      <label>How does this feel now?
        <select id="thenNowFeeling">
          <option value="still">Still true</option>
          <option value="different">A little different</option>
          <option value="changed">Completely different</option>
          <option value="unsure">I don't know</option>
        </select>
      </label>
      <label>Write back to Past You<textarea id="featureBody" rows="6" maxlength="1500">${escapeHtml(item?.response || "")}</textarea></label>
      <input id="thenNowEntryId" type="hidden" value="${escapeHtml(source?.id || item?.entryId || "")}">`;
    setTimeout(() => { if (item) $("thenNowFeeling").value = item.feeling || "different"; }, 0);
  }

  $("featureModal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeFeatureModal() {
  $("featureModal").classList.add("hidden");
  document.body.style.overflow = "";
  featureModalMode = null;
  featureEditingId = null;
}

async function saveFeatureModal(event) {
  event.preventDefault();
  const now = Date.now();

  try {
    if (featureModalMode === "comfort") {
      const existing = state.comfortItems.find(x => x.id === featureEditingId);
      const record = {
        id: existing?.id || uid("comfort"),
        type: $("featureType").value,
        title: $("featureTitle").value.trim(),
        body: $("featureBody").value.trim(),
        createdAt: existing?.createdAt || now,
        updatedAt: now
      };
      await diaryRepository.save("comfortItems", record);
      state.comfortItems = existing ? state.comfortItems.map(x => x.id === record.id ? record : x) : [...state.comfortItems, record];
    }

    if (featureModalMode === "unsent") {
      const existing = state.unsentLetters.find(x => x.id === featureEditingId);
      const record = {
        id: existing?.id || uid("unsent"),
        to: $("featureTitle").value.trim(),
        body: $("featureBody").value.trim(),
        date: isoToday(),
        createdAt: existing?.createdAt || now,
        updatedAt: now
      };
      await diaryRepository.save("unsentLetters", record);
      state.unsentLetters = existing ? state.unsentLetters.map(x => x.id === record.id ? record : x) : [...state.unsentLetters, record];
    }

    if (featureModalMode === "dream") {
      const existing = state.dreams.find(x => x.id === featureEditingId);
      const record = {
        id: existing?.id || uid("dream"),
        title: $("featureTitle").value.trim() || "Untitled dream",
        body: $("featureBody").value.trim(),
        feeling: $("dreamFeeling").value,
        recurring: $("dreamRecurring").checked,
        date: existing?.date || isoToday(),
        createdAt: existing?.createdAt || now,
        updatedAt: now
      };
      await diaryRepository.save("dreams", record);
      state.dreams = existing ? state.dreams.map(x => x.id === record.id ? record : x) : [...state.dreams, record];
    }

    if (featureModalMode === "thenNow") {
      const entryId = $("thenNowEntryId").value;
      const existing = state.thenNow.find(x => x.id === featureEditingId);
      const record = {
        id: existing?.id || uid("thennow"),
        entryId,
        feeling: $("thenNowFeeling").value,
        response: $("featureBody").value.trim(),
        date: isoToday(),
        createdAt: existing?.createdAt || now,
        updatedAt: now
      };
      await diaryRepository.save("thenNow", record);
      state.thenNow = existing ? state.thenNow.map(x => x.id === record.id ? record : x) : [...state.thenNow, record];
    }

    closeFeatureModal();
    renderAll();
    toast("Saved softly ☁️");
  } catch (error) {
    console.error("Could not save Fuwa feature item.", error);
    toast("Fuwa couldn't save that.");
  }
}

function chooseThenNowSource() {
  const eligible = state.entries
    .filter(entry => dayDistance(entry.date, isoToday()) >= 30)
    .sort((a,b) => a.date.localeCompare(b.date));

  if (!eligible.length) return null;

  const already = new Set(state.thenNow.map(x => x.entryId));
  const fresh = eligible.filter(e => !already.has(e.id));
  const pool = fresh.length ? fresh : eligible;
  const seed = Number(isoToday().replaceAll("-","")) % pool.length;
  return pool[seed];
}

function renderThenNow() {
  const host = $("thenNowPrompt");
  const history = $("thenNowHistory");
  if (!host || !history) return;

  const source = chooseThenNowSource();
  if (!source) {
    host.innerHTML = `<div class="empty-state">Then & Now will wake up once Fuwa has a memory at least a month old.</div>`;
  } else {
    host.innerHTML = `
      <div class="then-now-card">
        <p class="eyebrow">You wrote this on ${escapeHtml(formatDate(source.date))}</p>
        <blockquote>“${escapeHtml(memoryDriftPreviewText(source, 280))}”</blockquote>
        <button class="primary-btn compact" id="respondThenNow" type="button">How does this feel now?</button>
      </div>`;
    $("respondThenNow").addEventListener("click", () => openFeatureModal("thenNow", source.id));
  }

  const items = [...state.thenNow].sort((a,b) => b.date.localeCompare(a.date));
  history.innerHTML = items.length ? items.map(item => {
    const entry = state.entries.find(e => e.id === item.entryId);
    const label = { still:"Still true", different:"A little different", changed:"Completely different", unsure:"I don't know" }[item.feeling] || "Reflection";
    return `<article class="feature-card"><span>${escapeHtml(formatDate(item.date))} · ${escapeHtml(label)}</span><strong>${escapeHtml(entry?.title || "Past memory")}</strong><p>${escapeHtml(item.response || "")}</p><button data-edit-thennow="${item.id}" type="button">Edit</button></article>`;
  }).join("") : "";
  history.querySelectorAll("[data-edit-thennow]").forEach(b => b.addEventListener("click", () => openFeatureModal("thenNow", b.dataset.editThennow)));
}

function renderComfort() {
  const list = $("comfortList");
  if (!list) return;
  const items = [...state.comfortItems].sort((a,b) => b.updatedAt - a.updatedAt);
  list.innerHTML = items.length ? items.map(item => `
    <article class="feature-card comfort-item-card">
      <span>${escapeHtml(item.type || "comfort")}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.body || "")}</p>
      <button data-edit-comfort="${item.id}" type="button">Edit</button>
    </article>`).join("") : `<div class="empty-state">Add little things that make life feel softer.</div>`;
  list.querySelectorAll("[data-edit-comfort]").forEach(b => b.addEventListener("click", () => openFeatureModal("comfort", b.dataset.editComfort)));
}

function randomComfort() {
  const host = $("comfortSpotlight");
  if (!state.comfortItems.length) {
    host.innerHTML = `<div class="empty-state compact">Add something comforting first.</div>`;
    return;
  }
  const item = state.comfortItems[Math.floor(Math.random()*state.comfortItems.length)];
  host.innerHTML = `<div class="comfort-spotlight"><span>${escapeHtml(item.type)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body || "")}</p></div>`;
}

function renderUnsent() {
  const host = $("unsentList");
  if (!host) return;
  const items = [...state.unsentLetters].sort((a,b)=>b.updatedAt-a.updatedAt);
  host.innerHTML = items.length ? items.map(item => `
    <article class="feature-card unsent-card"><span>${escapeHtml(formatDate(item.date))}</span><strong>To ${escapeHtml(item.to)}</strong><p>${escapeHtml(item.body.slice(0,220))}${item.body.length>220?"…":""}</p><button data-edit-unsent="${item.id}" type="button">Open</button></article>
  `).join("") : `<div class="empty-state">Some words are meant to be written, not sent.</div>`;
  host.querySelectorAll("[data-edit-unsent]").forEach(b => b.addEventListener("click",()=>openFeatureModal("unsent",b.dataset.editUnsent)));
}

async function saveThoughtBubble(event) {
  event.preventDefault();
  const input = $("bubbleInput");
  const text = input.value.trim();
  if (!text) return;
  const record = { id:uid("bubble"), text, date:isoToday(), createdAt:Date.now() };
  await diaryRepository.save("thoughtBubbles", record);
  state.thoughtBubbles.push(record);
  input.value = "";
  renderAll();
}

function renderBubbles() {
  const host = $("bubbleList");
  if (!host) return;
  const items = [...state.thoughtBubbles].sort((a,b)=>b.createdAt-a.createdAt).slice(0,50);
  host.innerHTML = items.length ? items.map(item => `<div class="thought-bubble"><span>${escapeHtml(formatDate(item.date))}</span><p>${escapeHtml(item.text)}</p></div>`).join("") : `<div class="empty-state">Tiny thoughts can live here without becoming diary entries.</div>`;
}

function randomBubble() {
  const host = $("bubbleSpotlight");
  if (!state.thoughtBubbles.length) {
    host.innerHTML = `<div class="empty-state compact">No bubbles to float back yet.</div>`;
    return;
  }
  const item = state.thoughtBubbles[Math.floor(Math.random()*state.thoughtBubbles.length)];
  host.innerHTML = `<div class="bubble-spotlight"><span>A thought floated back · ${escapeHtml(formatDate(item.date))}</span><p>“${escapeHtml(item.text)}”</p></div>`;
}

function renderDreams() {
  const host = $("dreamList");
  if (!host) return;
  const items = [...state.dreams].sort((a,b)=>b.date.localeCompare(a.date));
  host.innerHTML = items.length ? items.map(item => `<article class="feature-card dream-card"><span>${escapeHtml(formatDate(item.date))} · ${escapeHtml(item.feeling)}${item.recurring?" · recurring":""}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.body.slice(0,220))}${item.body.length>220?"…":""}</p><button data-edit-dream="${item.id}" type="button">Open</button></article>`).join("") : `<div class="empty-state">Catch your next dream here before morning steals it.</div>`;
  host.querySelectorAll("[data-edit-dream]").forEach(b => b.addEventListener("click",()=>openFeatureModal("dream",b.dataset.editDream)));
}

function monthSummary(date) {
  const entries = itemsForMonth(state.entries, date);
  const moods = itemsForMonth(state.moodCheckins, date);
  const joys = state.tinyJoys.filter(j => new Date(j.createdAt).getFullYear() === date.getFullYear() && new Date(j.createdAt).getMonth() === date.getMonth());
  const nights = itemsForMonth(state.nightlyReflections, date);
  const dreams = itemsForMonth(state.dreams, date);
  const bubbles = itemsForMonth(state.thoughtBubbles, date);

  const tagCounts = {};
  entries.forEach(e => (e.tags||[]).forEach(t => tagCounts[t]=(tagCounts[t]||0)+1));
  const topTags = Object.entries(tagCounts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([t])=>t);

  return { entries, moods, joys, nights, dreams, bubbles, topTags };
}

function renderMonthlyStory(force = false) {
  const host = $("monthlyStory");
  if (!host) return;
  const signature = monthlySignature(monthlyCursor);
  if (!force && renderCache.monthly === signature) return;
  renderCache.monthly = signature;
  const summary = monthSummary(monthlyCursor);
  $("monthlyTitle").textContent = new Intl.DateTimeFormat("en-US",{month:"long",year:"numeric"}).format(monthlyCursor);

  const first = summary.entries[0];
  const last = summary.entries[summary.entries.length-1];

  host.innerHTML = `
    <div class="monthly-story-card">
      <p class="eyebrow">Your ${escapeHtml(new Intl.DateTimeFormat("en-US",{month:"long"}).format(monthlyCursor))}</p>
      <h3>${summary.entries.length ? `${summary.entries.length} memories, gathered gently.` : "A quiet month in Fuwa."}</h3>
      <div class="monthly-story-stats">
        <span><strong>${summary.entries.length}</strong> entries</span>
        <span><strong>${summary.moods.length}</strong> mood check-ins</span>
        <span><strong>${summary.joys.length}</strong> tiny joys</span>
        <span><strong>${summary.nights.length}</strong> wind-downs</span>
        <span><strong>${summary.dreams.length}</strong> dreams</span>
        <span><strong>${summary.bubbles.length}</strong> thought bubbles</span>
      </div>
      ${summary.topTags.length ? `<div class="monthly-tags">${summary.topTags.map(t=>`<span>#${escapeHtml(t)}</span>`).join("")}</div>`:""}
      ${first ? `<div class="monthly-bookends"><div><small>Month began with</small><strong>${escapeHtml(first.title)}</strong></div>${last && last.id!==first.id?`<div><small>Month closed with</small><strong>${escapeHtml(last.title)}</strong></div>`:""}</div>`:""}
    </div>`;
}

function renderEmotionalWeather(force = false) {
  const host = $("emotionalWeather");
  if (!host) return;
  const signature = `${monthKey(weatherCursor)}|${collectionSignature(state.moodCheckins)}`;
  if (!force && renderCache.weather === signature) return;
  renderCache.weather = signature;
  const moods = itemsForMonth(state.moodCheckins, weatherCursor);
  $("weatherTitle").textContent = new Intl.DateTimeFormat("en-US",{month:"long",year:"numeric"}).format(weatherCursor);

  const scoreMap = { amazing:5, good:4, neutral:3, tired:2.5, sad:2, angry:1.5 };
  const avg = moods.length ? moods.reduce((s,m)=>s+(scoreMap[m.mood]||3),0)/moods.length : 0;
  let weather = "quiet";
  if (avg >= 4.3) weather="sunny";
  else if (avg >= 3.6) weather="soft";
  else if (avg >= 2.8) weather="cloudy";
  else if (avg > 0) weather="rainy";

  const copy = {
    sunny:"Warm skies. There were a lot of lighter days here.",
    soft:"Soft skies. A gentle mix of good and ordinary days.",
    cloudy:"Cloudy skies. This month carried a little more weight.",
    rainy:"Rainy skies. Some days asked more of you.",
    quiet:"No weather yet. This sky is still waiting."
  }[weather];

  host.innerHTML = `
    <div class="weather-sky weather-${weather}">
      <div class="weather-sun"></div>
      <div class="weather-cloud cloud-a"></div>
      <div class="weather-cloud cloud-b"></div>
      <div class="weather-rain"></div>
      <div class="weather-caption"><strong>${moods.length} check-ins</strong><p>${copy}</p></div>
    </div>
    <div class="weather-legend">${Object.keys(moodLabels).map(m=>`<span>${moodIconMarkup(m,"mini")} ${moods.filter(x=>x.mood===m).length}</span>`).join("")}</div>`;
}

function sanctuaryLevel() {
  const total = state.entries.length + state.moodCheckins.length + state.nightlyReflections.length + state.dreams.length + state.thoughtBubbles.length;
  if (total >= 120) return 5;
  if (total >= 60) return 4;
  if (total >= 25) return 3;
  if (total >= 8) return 2;
  return 1;
}

function renderSanctuary(force = false) {
  const host = $("sanctuaryRoom");
  const unlocks = $("sanctuaryUnlocks");
  if (!host || !unlocks) return;
  const signature = sanctuarySignature();
  if (!force && renderCache.sanctuary === signature) return;
  renderCache.sanctuary = signature;
  const level = sanctuaryLevel();

  host.innerHTML = `
    <div class="room-scene level-${level}">
      <div class="room-window"><div class="room-sky"></div></div>
      <div class="room-rug"></div>
      <div class="room-bed"><span></span></div>
      <div class="room-cloud-pet"><span></span></div>
      ${level>=2?'<div class="room-lamp"></div>':""}
      ${level>=3?'<div class="room-plant"></div>':""}
      ${level>=4?'<div class="room-books"></div>':""}
      ${level>=5?'<div class="room-stars"></div>':""}
    </div>`;

  const labels = ["Soft bed","Warm lamp","Little plant","Bookshelf","Star lights"];
  unlocks.innerHTML = labels.map((label,i)=>`<div class="sanctuary-unlock ${level>=i+1?"unlocked":""}"><span>${level>=i+1?"♡":"○"}</span><strong>${label}</strong></div>`).join("");
}

function renderExpansionFeatures() {
  renderThenNow();
  renderComfort();
  renderUnsent();
  renderBubbles();
  renderDreams();
  renderMonthlyStory();
  renderEmotionalWeather();
  renderSanctuary();
}


const sleepSoundNames = {
  rain: "Soft Rain",
  waves: "Night Waves",
  fireplace: "Fireplace",
  wind: "Gentle Wind",
  forest: "Forest Night",
  cafe: "Cozy Café",
  brown: "Brown Noise",
  white: "White Noise"
};

function ensureSleepAudioContext() {
  if (!sleepAudioContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error("Web Audio is not supported on this device.");

    sleepAudioContext = new AudioCtx({ latencyHint: "playback" });
    sleepMasterGain = sleepAudioContext.createGain();
    sleepMasterGain.gain.value = Math.max(0, Math.min(1, state.sleepVolume / 100));
    sleepMasterGain.connect(sleepAudioContext.destination);
  }
  return sleepAudioContext;
}

function getSleepNoiseBuffer() {
  const ctx = ensureSleepAudioContext();
  if (sleepNoiseBuffer && sleepNoiseBuffer.sampleRate === ctx.sampleRate) return sleepNoiseBuffer;

  // 4 seconds is long enough to avoid an obvious tiny loop while staying lightweight.
  const length = ctx.sampleRate * 4;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

  sleepNoiseBuffer = buffer;
  return buffer;
}

function createNoiseSource() {
  const ctx = ensureSleepAudioContext();
  const source = ctx.createBufferSource();
  source.buffer = getSleepNoiseBuffer();
  source.loop = true;
  return source;
}

function trackSleepNode(node) {
  sleepNodes.push(node);
  return node;
}

function connectSleepNode(source, destination = sleepMasterGain) {
  source.connect(destination);
  trackSleepNode(source);
  return source;
}

function createFilteredNoise({ type = "lowpass", frequency = 1000, q = 0.7, gain = 0.3 } = {}) {
  const ctx = ensureSleepAudioContext();
  const source = createNoiseSource();
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;

  const localGain = ctx.createGain();
  localGain.gain.value = gain;

  source.connect(filter);
  filter.connect(localGain);
  localGain.connect(sleepMasterGain);

  trackSleepNode(source);
  trackSleepNode(filter);
  trackSleepNode(localGain);
  source.start();

  return { source, filter, gain: localGain };
}

function createLfo(targetParam, frequency, depth, center) {
  const ctx = ensureSleepAudioContext();
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = frequency;
  lfoGain.gain.value = depth;
  targetParam.value = center;
  lfo.connect(lfoGain);
  lfoGain.connect(targetParam);
  lfo.start();

  trackSleepNode(lfo);
  trackSleepNode(lfoGain);
  return { lfo, lfoGain };
}

function createSoftTone(frequency, gain = 0.02, type = "sine") {
  const ctx = ensureSleepAudioContext();
  const osc = ctx.createOscillator();
  const localGain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  localGain.gain.value = gain;
  osc.connect(localGain);
  localGain.connect(sleepMasterGain);
  trackSleepNode(osc);
  trackSleepNode(localGain);
  osc.start();
  return { osc, gain: localGain };
}

function buildRainSound() {
  const rain = createFilteredNoise({ type: "highpass", frequency: 900, q: 0.4, gain: 0.21 });
  const body = createFilteredNoise({ type: "bandpass", frequency: 1800, q: 0.6, gain: 0.08 });
  createLfo(rain.gain.gain, 0.12, 0.035, 0.19);
  createLfo(body.gain.gain, 0.19, 0.02, 0.07);
}

function buildWaveSound() {
  const sea = createFilteredNoise({ type: "lowpass", frequency: 650, q: 0.8, gain: 0.18 });
  const foam = createFilteredNoise({ type: "bandpass", frequency: 1400, q: 0.8, gain: 0.055 });
  createLfo(sea.gain.gain, 0.085, 0.12, 0.13);
  createLfo(foam.gain.gain, 0.09, 0.04, 0.035);
}

function buildFireplaceSound() {
  const fire = createFilteredNoise({ type: "bandpass", frequency: 950, q: 0.9, gain: 0.12 });
  const warmth = createFilteredNoise({ type: "lowpass", frequency: 260, q: 0.5, gain: 0.055 });
  createLfo(fire.gain.gain, 1.7, 0.035, 0.10);
  createLfo(warmth.gain.gain, 0.18, 0.015, 0.05);
}

function buildWindSound() {
  const wind = createFilteredNoise({ type: "lowpass", frequency: 950, q: 0.9, gain: 0.12 });
  createLfo(wind.filter.frequency, 0.07, 380, 760);
  createLfo(wind.gain.gain, 0.095, 0.07, 0.10);
}

function buildForestSound() {
  const air = createFilteredNoise({ type: "lowpass", frequency: 1200, q: 0.6, gain: 0.085 });
  const insects = createFilteredNoise({ type: "bandpass", frequency: 3900, q: 2.2, gain: 0.018 });
  createLfo(air.gain.gain, 0.06, 0.025, 0.075);
  createLfo(insects.gain.gain, 0.45, 0.008, 0.015);
  createSoftTone(2400, 0.0035, "sine");
}

function buildCafeSound() {
  const room = createFilteredNoise({ type: "bandpass", frequency: 650, q: 0.5, gain: 0.08 });
  const softHiss = createFilteredNoise({ type: "highpass", frequency: 2200, q: 0.4, gain: 0.018 });
  createLfo(room.gain.gain, 0.11, 0.025, 0.07);
  createSoftTone(110, 0.008, "sine");
  createSoftTone(165, 0.004, "sine");
}

function buildBrownNoise() {
  // Low-pass filtered white noise approximates the deep spectrum of brown noise
  // with far less CPU than per-sample realtime processing.
  const brown = createFilteredNoise({ type: "lowpass", frequency: 380, q: 0.35, gain: 0.30 });
  createLfo(brown.gain.gain, 0.025, 0.012, 0.285);
}

function buildWhiteNoise() {
  createFilteredNoise({ type: "allpass", frequency: 1000, q: 0.5, gain: 0.16 });
}

function buildSelectedSleepSound() {
  stopSleepNodesOnly();
  switch (state.sleepSound) {
    case "waves": buildWaveSound(); break;
    case "fireplace": buildFireplaceSound(); break;
    case "wind": buildWindSound(); break;
    case "forest": buildForestSound(); break;
    case "cafe": buildCafeSound(); break;
    case "brown": buildBrownNoise(); break;
    case "white": buildWhiteNoise(); break;
    default: buildRainSound();
  }
}

function stopSleepNodesOnly() {
  sleepNodes.forEach(node => {
    try {
      if (typeof node.stop === "function") node.stop();
    } catch (_) {}
    try {
      node.disconnect();
    } catch (_) {}
  });
  sleepNodes = [];
}

function selectedSleepMinutes() {
  const custom = Number($("sleepCustomMinutes")?.value || 0);
  if (custom >= 5 && custom <= 480) return custom;
  return Math.max(5, Number(state.sleepMinutes) || 30);
}

function formatSleepCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function renderSleepControls() {
  document.querySelectorAll("[data-sleep-sound]").forEach(button => {
    button.classList.toggle("selected", button.dataset.sleepSound === state.sleepSound);
  });

  document.querySelectorAll("[data-sleep-minutes]").forEach(button => {
    button.classList.toggle("selected", Number(button.dataset.sleepMinutes) === Number(state.sleepMinutes) && !$("sleepCustomMinutes")?.value);
  });

  if ($("sleepVolumeSlider")) $("sleepVolumeSlider").value = String(state.sleepVolume);
  if ($("sleepVolumeLabel")) $("sleepVolumeLabel").textContent = `${state.sleepVolume}%`;

  if ($("sleepNowPlaying")) $("sleepNowPlaying").textContent = sleepSoundNames[state.sleepSound] || sleepSoundNames.rain;

  const remaining = sleepIsPlaying || sleepIsPaused
    ? sleepRemainingMs
    : (Number(state.sleepMinutes) || 30) * 60000;

  if ($("sleepCountdown")) $("sleepCountdown").textContent = `${formatSleepCountdown(remaining)} remaining`;

  const icon = $("sleepPlayPauseIcon");
  const text = $("sleepPlayPauseText");
  if (icon && text) {
    icon.textContent = sleepIsPlaying ? "Ⅱ" : "▶";
    text.textContent = sleepIsPlaying ? "Pause" : sleepIsPaused ? "Resume" : "Play";
  }

  renderSleepProgress();
  renderExpansionFeatures();
  renderSleepHome();
}

function renderSleepHome() {
  if (!$("sleepHomeTitle")) return;
  if (sleepIsPlaying) {
    $("sleepHomeTitle").textContent = sleepSoundNames[state.sleepSound] || "Sleep sound";
    $("sleepHomeText").textContent = `${formatSleepCountdown(sleepRemainingMs)} remaining · ${state.sleepVolume}% volume`;
    $("sleepHomeAction").textContent = "Open player →";
  } else if (sleepIsPaused) {
    $("sleepHomeTitle").textContent = `${sleepSoundNames[state.sleepSound]} is paused.`;
    $("sleepHomeText").textContent = `${formatSleepCountdown(sleepRemainingMs)} left on your timer.`;
    $("sleepHomeAction").textContent = "Resume →";
  } else {
    $("sleepHomeTitle").textContent = "Something soft to fall asleep to.";
    $("sleepHomeText").textContent = "Rain, waves, fireplace, wind, forest night, café, brown noise, and white noise.";
    $("sleepHomeAction").textContent = "Choose a sound →";
  }
}

function renderSleepProgress() {
  const bar = $("sleepProgressBar");
  if (!bar) return;

  if (!sleepTimerDurationMs || (!sleepIsPlaying && !sleepIsPaused)) {
    bar.style.width = "0%";
    return;
  }

  const elapsed = sleepTimerDurationMs - sleepRemainingMs;
  const percent = Math.max(0, Math.min(100, elapsed / sleepTimerDurationMs * 100));
  bar.style.width = `${percent}%`;
}

function updateSleepCountdown() {
  if (!sleepIsPlaying) return;
  sleepRemainingMs = Math.max(0, sleepTimerEndAt - Date.now());

  if (sleepRemainingMs <= 20000 && sleepMasterGain && sleepRemainingMs > 0) {
    const ctx = sleepAudioContext;
    const now = ctx.currentTime;
    sleepMasterGain.gain.cancelScheduledValues(now);
    sleepMasterGain.gain.setValueAtTime(sleepMasterGain.gain.value, now);
    sleepMasterGain.gain.linearRampToValueAtTime(0.0001, now + Math.max(0.5, sleepRemainingMs / 1000));
  }

  if (sleepRemainingMs <= 0) {
    stopSleepSound(true);
    return;
  }

  renderSleepControls();
}

function startSleepTimer(minutes) {
  sleepTimerDurationMs = minutes * 60000;
  sleepRemainingMs = sleepTimerDurationMs;
  sleepTimerStartedAt = Date.now();
  sleepTimerEndAt = sleepTimerStartedAt + sleepTimerDurationMs;

  clearInterval(sleepTimerInterval);
  sleepTimerInterval = setInterval(updateSleepCountdown, 1000);
}

async function startSleepSound() {
  try {
    const ctx = ensureSleepAudioContext();
    if (ctx.state === "suspended") await ctx.resume();

    if (sleepFadeTimeout) {
      clearTimeout(sleepFadeTimeout);
      sleepFadeTimeout = null;
    }

    sleepMasterGain.gain.cancelScheduledValues(ctx.currentTime);
    sleepMasterGain.gain.setValueAtTime(Math.max(0.0001, state.sleepVolume / 100), ctx.currentTime);

    buildSelectedSleepSound();

    const minutes = selectedSleepMinutes();
    state.sleepMinutes = minutes;
    savePreferences();

    sleepIsPlaying = true;
    sleepIsPaused = false;
    startSleepTimer(minutes);
    renderSleepControls();
  } catch (error) {
    console.error("Could not start Fuwa sleep sound.", error);
    toast("Fuwa couldn't start audio on this device.");
  }
}

async function pauseSleepSound() {
  if (!sleepAudioContext || !sleepIsPlaying) return;

  sleepRemainingMs = Math.max(0, sleepTimerEndAt - Date.now());
  sleepIsPlaying = false;
  sleepIsPaused = true;
  clearInterval(sleepTimerInterval);
  sleepTimerInterval = null;

  try {
    await sleepAudioContext.suspend();
  } catch (_) {}

  renderSleepControls();
}

async function resumeSleepSound() {
  if (!sleepAudioContext || !sleepIsPaused) {
    await startSleepSound();
    return;
  }

  try {
    await sleepAudioContext.resume();
  } catch (_) {}

  sleepMasterGain.gain.cancelScheduledValues(sleepAudioContext.currentTime);
  sleepMasterGain.gain.setValueAtTime(Math.max(0.0001, state.sleepVolume / 100), sleepAudioContext.currentTime);

  sleepIsPaused = false;
  sleepIsPlaying = true;
  sleepTimerEndAt = Date.now() + sleepRemainingMs;

  clearInterval(sleepTimerInterval);
  sleepTimerInterval = setInterval(updateSleepCountdown, 1000);
  renderSleepControls();
}

async function stopSleepSound(fromTimer = false) {
  clearInterval(sleepTimerInterval);
  sleepTimerInterval = null;

  stopSleepNodesOnly();

  if (sleepAudioContext && sleepAudioContext.state === "running") {
    try {
      sleepMasterGain.gain.cancelScheduledValues(sleepAudioContext.currentTime);
      sleepMasterGain.gain.value = Math.max(0.0001, state.sleepVolume / 100);
    } catch (_) {}
  }

  sleepIsPlaying = false;
  sleepIsPaused = false;
  sleepRemainingMs = 0;
  sleepTimerDurationMs = 0;
  sleepTimerEndAt = 0;

  renderSleepControls();

  if (fromTimer) toast("Sleep timer finished. Good night ☁️");
}

async function toggleSleepPlayback() {
  if (sleepIsPlaying) {
    await pauseSleepSound();
  } else if (sleepIsPaused) {
    await resumeSleepSound();
  } else {
    await startSleepSound();
  }
}

async function selectSleepSound(sound) {
  if (!sleepSoundNames[sound]) return;
  state.sleepSound = sound;
  savePreferences();

  if (sleepIsPlaying) {
    const ctx = ensureSleepAudioContext();
    const currentGain = sleepMasterGain.gain.value;
    sleepMasterGain.gain.cancelScheduledValues(ctx.currentTime);
    sleepMasterGain.gain.setValueAtTime(currentGain, ctx.currentTime);
    sleepMasterGain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.20);

    setTimeout(() => {
      if (!sleepIsPlaying) return;
      stopSleepNodesOnly();
      buildSelectedSleepSound();
      sleepMasterGain.gain.cancelScheduledValues(ctx.currentTime);
      sleepMasterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      sleepMasterGain.gain.linearRampToValueAtTime(Math.max(0.0001, state.sleepVolume / 100), ctx.currentTime + 0.35);
    }, 220);
  }

  renderSleepControls();
}

function setSleepTimerPreset(minutes) {
  state.sleepMinutes = minutes;
  $("sleepCustomMinutes").value = "";
  savePreferences();

  if (sleepIsPlaying) startSleepTimer(minutes);
  else {
    sleepRemainingMs = minutes * 60000;
    sleepTimerDurationMs = 0;
  }

  renderSleepControls();
}

function setSleepCustomTimer() {
  const minutes = Number($("sleepCustomMinutes").value);
  if (!minutes || minutes < 5 || minutes > 480) return;
  state.sleepMinutes = minutes;
  savePreferences();

  if (sleepIsPlaying) startSleepTimer(minutes);
  else {
    sleepRemainingMs = minutes * 60000;
    sleepTimerDurationMs = 0;
  }

  renderSleepControls();
}

function setSleepVolume(value) {
  state.sleepVolume = Math.max(0, Math.min(100, Number(value) || 0));
  savePreferences();

  if (sleepMasterGain && sleepAudioContext) {
    const now = sleepAudioContext.currentTime;
    sleepMasterGain.gain.cancelScheduledValues(now);
    sleepMasterGain.gain.setTargetAtTime(Math.max(0.0001, state.sleepVolume / 100), now, 0.04);
  }

  renderSleepControls();
}

function openSleepCorner() {
  renderSleepControls();
  navigate("sleep");
}


function isEveningTime() {
  const hour = new Date().getHours();
  return hour >= 18 || hour < 3;
}

function todaysNightlyReflection() {
  return state.nightlyReflections.find(item => item.date === isoToday()) || null;
}

function renderNightlyHome() {
  const section = $("nightlyHomeSection");
  if (!section) return;

  const today = todaysNightlyReflection();
  const evening = isEveningTime();

  // Keep it available during the day, but make it visually quieter.
  section.classList.toggle("nightly-not-evening", !evening);

  if (today) {
    $("nightlyStatusTitle").textContent = "Tonight is tucked away.";
    $("nightlyStatusText").textContent = today.tomorrow
      ? `A note is waiting for tomorrow: “${today.tomorrow.slice(0, 72)}${today.tomorrow.length > 72 ? "…" : ""}”`
      : "You gave today somewhere soft to land.";
    $("nightlyStatusAction").textContent = "Read tonight's wind-down →";
  } else if (evening) {
    $("nightlyStatusTitle").textContent = "A tiny place to put today down.";
    $("nightlyStatusText").textContent = "One grateful thing, one thing to leave here, and a note to tomorrow.";
    $("nightlyStatusAction").textContent = "Wind down tonight →";
  } else {
    $("nightlyStatusTitle").textContent = "Tonight, when you're ready.";
    $("nightlyStatusText").textContent = "This little space will be here later. No reminders, no streaks.";
    $("nightlyStatusAction").textContent = "Open anyway →";
  }
}

function openNightlyView() {
  const today = todaysNightlyReflection();
  $("nightlyGrateful").value = today?.grateful || "";
  $("nightlyRelease").value = today?.release || "";
  $("nightlyTomorrow").value = today?.tomorrow || "";
  renderNightlyHistory();
  navigate("nightly");
}

function renderNightlyHistory() {
  const host = $("nightlyHistory");
  if (!host) return;

  const items = [...state.nightlyReflections]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 14);

  if (!items.length) {
    host.innerHTML = `<div class="empty-state">Your first quiet night will appear here. 🌙</div>`;
    return;
  }

  host.innerHTML = items.map(item => `
    <article class="nightly-history-card">
      <time>${escapeHtml(formatDate(item.date))}</time>
      ${item.grateful ? `<div><span>♡ Grateful</span><p>${escapeHtml(item.grateful)}</p></div>` : ""}
      ${item.release ? `<div><span>⌁ Left here</span><p>${escapeHtml(item.release)}</p></div>` : ""}
      ${item.tomorrow ? `<div><span>☾ Tomorrow</span><p>${escapeHtml(item.tomorrow)}</p></div>` : ""}
    </article>
  `).join("");
}

async function saveNightlyReflection(event) {
  event.preventDefault();

  const grateful = $("nightlyGrateful").value.trim();
  const release = $("nightlyRelease").value.trim();
  const tomorrow = $("nightlyTomorrow").value.trim();

  if (!grateful && !release && !tomorrow) {
    toast("Write just one tiny thing before putting today to rest.");
    return;
  }

  const existing = todaysNightlyReflection();
  const record = {
    id: isoToday(),
    date: isoToday(),
    grateful,
    release,
    tomorrow,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now()
  };

  try {
    await diaryRepository.save("nightlyReflections", record);
    const index = state.nightlyReflections.findIndex(item => item.id === record.id);
    if (index >= 0) state.nightlyReflections[index] = record;
    else state.nightlyReflections.push(record);

    renderAll();
    renderNightlyHistory();
    toast(existing ? "Tonight's wind-down updated 🌙" : "Today can rest now 🌙");
  } catch (error) {
    console.error("Could not save nightly reflection.", error);
    toast("Fuwa couldn't save tonight's wind-down.");
  }
}

function skipNightlyReflection() {
  navigate("home");
  toast("That's okay. Tonight can stay quiet. ☁️");
}


const MEMORY_DRIFT_MILESTONES = [
  { months: 0, years: 1, label: "One year ago today" },
  { months: 0, years: 2, label: "Two years ago today" },
  { months: 0, years: 3, label: "Three years ago today" },
  { months: 6, years: 0, label: "Six months ago" },
  { months: 3, years: 0, label: "Three months ago" },
  { months: 1, years: 0, label: "One month ago" }
];

let activeMemoryDriftEntryId = null;
let activeMemoryDriftLabel = "";
let wallpaperObjectUrl = "";
let pendingWallpaperFile = null;
let cropObjectUrl = "";
let cropScale = 1;
let cropX = 0;
let cropY = 0;
let cropDragStart = null;

// Sleep audio is generated locally with Web Audio so Fuwa does not ship large audio files.
// Only one AudioContext and a small reusable noise buffer are kept alive.
let sleepAudioContext = null;
let sleepMasterGain = null;
let sleepNodes = [];
let sleepNoiseBuffer = null;
let sleepTimerInterval = null;
let sleepTimerEndAt = 0;
let sleepTimerStartedAt = 0;
let sleepTimerDurationMs = 0;
let sleepIsPlaying = false;
let sleepIsPaused = false;
let sleepRemainingMs = 0;
let sleepFadeTimeout = null;


function shiftIsoDate(dateString, years = 0, months = 0) {
  const [year, month, day] = dateString.split("-").map(Number);
  const shifted = new Date(year, month - 1, day, 12, 0, 0);
  shifted.setFullYear(shifted.getFullYear() - years);
  shifted.setMonth(shifted.getMonth() - months);
  return shifted.toISOString().slice(0, 10);
}

function dayDistance(a, b) {
  const one = new Date(`${a}T12:00:00`);
  const two = new Date(`${b}T12:00:00`);
  return Math.abs(Math.round((one - two) / 86400000));
}

function findMemoryDrift() {
  if (!state.entries.length) return null;
  const today = isoToday();

  // Prefer meaningful calendar milestones, with a gentle ±3 day window
  // so the feature still works when the user did not write on the exact day.
  for (const milestone of MEMORY_DRIFT_MILESTONES) {
    const target = shiftIsoDate(today, milestone.years, milestone.months);
    const candidates = state.entries
      .filter(entry => entry.date < today && dayDistance(entry.date, target) <= 3)
      .sort((a, b) => {
        const distance = dayDistance(a.date, target) - dayDistance(b.date, target);
        if (distance) return distance;
        return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
      });

    if (candidates.length) {
      return { entry: candidates[0], label: milestone.label, target };
    }
  }

  // Once Fuwa has older history, occasionally surface an older memory even
  // when there is no exact milestone. Deterministic per day so it does not
  // jump around every refresh.
  const older = state.entries
    .filter(entry => dayDistance(entry.date, today) >= 21)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!older.length) return null;

  const seed = today.split("-").join("").split("").reduce((sum, n) => sum + Number(n), 0);
  // Show the fallback surprise on roughly 2 of every 3 calendar days.
  if (seed % 3 === 0) return null;

  const entry = older[seed % older.length];
  const days = dayDistance(entry.date, today);
  const label = days >= 365 ? "From a past chapter" : days >= 90 ? "A few months ago" : "From a little while ago";
  return { entry, label, target: entry.date };
}

function memoryDriftPreviewText(entry, max = 180) {
  const raw = (entry.body || "").replace(/\s+/g, " ").trim();
  if (!raw) return "A little memory from this day.";
  return raw.length > max ? `${raw.slice(0, max).trim()}…` : raw;
}

function renderMemoryDriftHome() {
  const host = $("memoryDriftHome");
  const section = $("memoryDriftHomeSection");
  if (!host || !section) return;

  const drift = findMemoryDrift();
  if (!drift) {
    // Memory Drift should feel like a surprise, not an empty dashboard card.
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  const { entry, label } = drift;
  host.innerHTML = `
    <button class="memory-drift-card" type="button" id="openMemoryDrift">
      <div class="memory-drift-top">
        <div class="memory-drift-mini-cloud" aria-hidden="true"><span></span></div>
        <div>
          <span class="memory-drift-kicker">A memory drifted back</span>
          <strong>${escapeHtml(label)}</strong>
        </div>
      </div>
      <time>${escapeHtml(formatDate(entry.date))}</time>
      <blockquote>“${escapeHtml(memoryDriftPreviewText(entry))}”</blockquote>
      <div class="memory-drift-bottom">
        <span>${moodIconMarkup(entry.mood, "mini")} ${escapeHtml(moodLabels[entry.mood] || "Memory")}</span>
        <strong>Read this memory →</strong>
      </div>
    </button>`;

  $("openMemoryDrift").addEventListener("click", () => {
    activeMemoryDriftEntryId = entry.id;
    activeMemoryDriftLabel = label;
    renderMemoryDriftDetail();
    navigate("memoryDrift");
  });
}

function renderMemoryDriftDetail() {
  const host = $("memoryDriftDetail");
  const entry = state.entries.find(item => item.id === activeMemoryDriftEntryId);
  if (!host || !entry) return;

  $("memoryDriftHeading").textContent = activeMemoryDriftLabel || "From another day";
  const photos = state.media?.filter?.(item => item.entryId === entry.id) || [];

  host.innerHTML = `
    <article class="memory-drift-detail-card">
      <div class="memory-drift-detail-meta">
        <span>${moodIconMarkup(entry.mood, "mini")} ${escapeHtml(moodLabels[entry.mood] || "")}</span>
        <time>${escapeHtml(formatDate(entry.date))}</time>
      </div>
      <h3>${escapeHtml(entry.title || "Untitled memory")}</h3>
      <div class="memory-drift-entry-text">${escapeHtml(entry.body || "").replace(/\n/g, "<br>")}</div>
      ${entry.tags?.length ? `<div class="tag-row">${entry.tags.map(tag => `<span>#${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      ${entry.afterthought ? `
        <div class="memory-drift-afterthought">
          <span>Afterthought</span>
          <p>${escapeHtml(entry.afterthought)}</p>
        </div>` : ""}
      <div class="memory-drift-actions">
        <button class="primary-btn compact" type="button" id="memoryDriftOpenEntry">Open original entry</button>
      </div>
    </article>
    <div class="memory-drift-soft-note">
      <div class="memory-drift-mini-cloud" aria-hidden="true"><span></span></div>
      <p>You don't have to do anything with an old memory. Sometimes it's enough just to meet it again.</p>
    </div>`;

  $("memoryDriftOpenEntry").addEventListener("click", () => openEditor(entry.id));
}


function addMonthsToIsoDate(dateString, months) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

function bookmarkStatus(bookmark) {
  if (bookmark.archived) return "archived";
  return bookmark.revisitDate <= isoToday() ? "ready" : "waiting";
}

function bookmarkEntry(bookmark) {
  return state.entries.find(entry => entry.id === bookmark.entryId) || null;
}

function sortedBookmarks() {
  return [...state.bookmarks].sort((a, b) => {
    const statusOrder = { ready: 0, waiting: 1, archived: 2 };
    const statusDiff = statusOrder[bookmarkStatus(a)] - statusOrder[bookmarkStatus(b)];
    if (statusDiff) return statusDiff;
    return a.revisitDate.localeCompare(b.revisitDate);
  });
}

function renderHomeBookmarks() {
  const host = $("homeBookmarkPreview");
  if (!host) return;

  const ready = sortedBookmarks().filter(item => bookmarkStatus(item) === "ready");
  const waiting = sortedBookmarks().filter(item => bookmarkStatus(item) === "waiting");

  if (ready.length) {
    const bookmark = ready[0];
    const entry = bookmarkEntry(bookmark);
    host.innerHTML = `
      <button class="past-you-card ready" type="button" data-bookmark-open="${escapeHtml(bookmark.id)}">
        <div class="past-you-ribbon">A thought from Past You</div>
        <blockquote>“${escapeHtml(bookmark.quote)}”</blockquote>
        <div class="past-you-meta">${escapeHtml(formatDate(entry?.date || bookmark.createdDate))} · Ready for you</div>
        <strong>Is this still true? →</strong>
      </button>`;
  } else if (waiting.length) {
    const bookmark = waiting[0];
    host.innerHTML = `
      <button class="past-you-card waiting" type="button" data-bookmark-open="${escapeHtml(bookmark.id)}">
        <div class="past-you-ribbon">Tucked away for later</div>
        <blockquote>“${escapeHtml(bookmark.quote)}”</blockquote>
        <div class="past-you-meta">Returns ${escapeHtml(formatDate(bookmark.revisitDate))}</div>
        <strong>Open Bookmarks →</strong>
      </button>`;
  } else {
    host.innerHTML = `
      <button class="past-you-card empty" type="button" id="emptyBookmarkOpen">
        <div class="past-you-bookmark-icon">🔖</div>
        <strong>Save a sentence for Future You</strong>
        <span>Choose a thought from any diary entry and let Fuwa bring it back later.</span>
      </button>`;
    $("emptyBookmarkOpen")?.addEventListener("click", () => navigate("bookmarks"));
  }

  host.querySelectorAll("[data-bookmark-open]").forEach(button => {
    button.addEventListener("click", () => openBookmarkDetail(button.dataset.bookmarkOpen));
  });
}

function renderBookmarks() {
  const host = $("bookmarksList");
  if (!host) return;
  const items = sortedBookmarks();

  if (!items.length) {
    host.innerHTML = `<div class="empty-state bookmark-empty-state"><div>🔖</div><strong>No Fuwa Bookmarks yet</strong><p>Open a diary entry, select a sentence, and tuck it away for Future You.</p></div>`;
    return;
  }

  host.innerHTML = items.map(bookmark => {
    const entry = bookmarkEntry(bookmark);
    const status = bookmarkStatus(bookmark);
    const responseCount = Array.isArray(bookmark.responses) ? bookmark.responses.length : 0;
    return `
      <article class="bookmark-card ${status}">
        <button type="button" data-bookmark-open="${escapeHtml(bookmark.id)}">
          <div class="bookmark-card-top">
            <span class="bookmark-status-pill">${status === "ready" ? "☁️ Ready now" : status === "archived" ? "♡ Kept" : "🔖 Waiting"}</span>
            <time>${status === "ready" ? "From " + escapeHtml(formatDate(entry?.date || bookmark.createdDate)) : "Returns " + escapeHtml(formatDate(bookmark.revisitDate))}</time>
          </div>
          <blockquote>“${escapeHtml(bookmark.quote)}”</blockquote>
          ${bookmark.note ? `<p>${escapeHtml(bookmark.note)}</p>` : ""}
          <small>${responseCount ? `${responseCount} ${responseCount === 1 ? "reply" : "replies"} across time` : entry ? escapeHtml(entry.title) : "Saved thought"}</small>
        </button>
      </article>`;
  }).join("");

  host.querySelectorAll("[data-bookmark-open]").forEach(button => {
    button.addEventListener("click", () => openBookmarkDetail(button.dataset.bookmarkOpen));
  });
}

function renderEntryBookmarks(entryId) {
  const host = $("entryBookmarks");
  if (!host) return;
  bookmarkEditorEntryId = entryId;
  if (!entryId) {
    host.innerHTML = `<p class="muted bookmark-editor-hint">Save the diary entry first, then you can bookmark a sentence from it.</p>`;
    $("addBookmarkButton").disabled = true;
    return;
  }
  $("addBookmarkButton").disabled = false;
  const items = state.bookmarks.filter(item => item.entryId === entryId).sort((a, b) => b.createdAt - a.createdAt);
  host.innerHTML = items.length ? items.map(bookmark => `
    <button class="entry-bookmark-chip" type="button" data-bookmark-open="${escapeHtml(bookmark.id)}">
      <span>🔖</span>
      <span>“${escapeHtml(bookmark.quote.slice(0, 64))}${bookmark.quote.length > 64 ? "…" : ""}”</span>
      <small>${bookmarkStatus(bookmark) === "ready" ? "Ready" : formatDate(bookmark.revisitDate, { month: "short", day: "numeric" })}</small>
    </button>
  `).join("") : `<p class="muted bookmark-editor-hint">Select a sentence from your entry and save it for later.</p>`;

  host.querySelectorAll("[data-bookmark-open]").forEach(button => {
    button.addEventListener("click", () => openBookmarkDetail(button.dataset.bookmarkOpen));
  });
}

function selectedEntryText() {
  const textarea = $("entryBody");
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? 0;
  return start !== end ? textarea.value.slice(start, end).trim() : "";
}

function openBookmarkComposer() {
  if (!bookmarkEditorEntryId) {
    toast("Save this diary entry first, then add a Fuwa Bookmark.");
    return;
  }
  const selected = selectedEntryText();
  $("bookmarkQuoteInput").value = selected;
  $("bookmarkNoteInput").value = "";
  $("bookmarkRevisitDate").value = addMonthsToIsoDate(isoToday(), 1);
  $("bookmarkComposer").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  setTimeout(() => (selected ? $("bookmarkNoteInput") : $("bookmarkQuoteInput")).focus(), 80);
}

function closeBookmarkComposer() {
  $("bookmarkComposer").classList.add("hidden");
  document.body.style.overflow = "";
}

function setBookmarkPreset(months) {
  $("bookmarkRevisitDate").value = addMonthsToIsoDate(isoToday(), months);
}

async function saveBookmarkFromComposer(event) {
  event.preventDefault();
  const quote = $("bookmarkQuoteInput").value.trim();
  const revisitDate = $("bookmarkRevisitDate").value;

  if (!quote) {
    toast("Add the sentence you want Future You to see.");
    return;
  }
  if (!revisitDate || revisitDate < isoToday()) {
    toast("Choose today or a future date.");
    return;
  }

  const entry = state.entries.find(item => item.id === bookmarkEditorEntryId);
  if (!entry) {
    toast("Fuwa couldn't find that diary entry.");
    return;
  }

  const record = {
    id: uid("bookmark"),
    entryId: entry.id,
    quote,
    note: $("bookmarkNoteInput").value.trim(),
    revisitDate,
    createdDate: entry.date,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archived: false,
    responses: []
  };

  try {
    await diaryRepository.save("bookmarks", record);
    state.bookmarks.push(record);
    closeBookmarkComposer();
    renderAll();
    renderEntryBookmarks(entry.id);
    toast("Tucked away for Future You 🔖");
  } catch (error) {
    console.error("Could not save Fuwa Bookmark.", error);
    toast("Fuwa couldn't save that bookmark.");
  }
}

function openBookmarkDetail(bookmarkId) {
  activeBookmarkId = bookmarkId;
  renderBookmarkDetail();
  navigate("bookmarkDetail");
}

function renderBookmarkDetail() {
  const bookmark = state.bookmarks.find(item => item.id === activeBookmarkId);
  if (!bookmark) return;
  const entry = bookmarkEntry(bookmark);
  const status = bookmarkStatus(bookmark);
  const responses = Array.isArray(bookmark.responses) ? bookmark.responses : [];

  $("bookmarkDetailContent").innerHTML = `
    <div class="bookmark-detail-card ${status}">
      <div class="bookmark-detail-ribbon">${status === "ready" ? "A thought from Past You" : status === "archived" ? "A thought you kept" : "Waiting for Future You"}</div>
      <blockquote>“${escapeHtml(bookmark.quote)}”</blockquote>
      ${bookmark.note ? `<p class="bookmark-note">${escapeHtml(bookmark.note)}</p>` : ""}
      <div class="bookmark-origin">
        <span>${escapeHtml(formatDate(entry?.date || bookmark.createdDate))}</span>
        ${entry ? `<button class="text-btn" type="button" id="openBookmarkEntry">Open original entry</button>` : ""}
      </div>
      <div class="bookmark-return-date">Returns: <strong>${escapeHtml(formatDate(bookmark.revisitDate))}</strong></div>
    </div>

    <section class="bookmark-replies">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Across time</p>
          <h3>Your replies</h3>
        </div>
      </div>
      <div class="bookmark-response-list">
        ${responses.length ? responses.map(response => `
          <div class="bookmark-response">
            <time>${escapeHtml(formatDate(response.date))}</time>
            <p>${escapeHtml(response.text)}</p>
          </div>
        `).join("") : `<div class="empty-state compact">No replies yet.</div>`}
      </div>
      ${status === "ready" ? `
        <form class="bookmark-reply-form" id="bookmarkReplyForm">
          <label>Is this still true?</label>
          <textarea id="bookmarkReplyInput" rows="4" maxlength="800" placeholder="Write back to Past You…"></textarea>
          <button class="primary-btn compact" type="submit">Save my reply</button>
        </form>
      ` : ""}
      <div class="bookmark-detail-actions">
        <button class="secondary-btn" type="button" id="bookmarkRescheduleButton">Change return date</button>
        <button class="secondary-btn" type="button" id="bookmarkArchiveButton">${bookmark.archived ? "Restore bookmark" : "Keep & archive"}</button>
        <button class="danger-btn" type="button" id="bookmarkDeleteButton">Delete</button>
      </div>
    </section>`;

  $("openBookmarkEntry")?.addEventListener("click", () => openEditor(bookmark.entryId));
  $("bookmarkReplyForm")?.addEventListener("submit", saveBookmarkReply);
  $("bookmarkRescheduleButton").addEventListener("click", rescheduleActiveBookmark);
  $("bookmarkArchiveButton").addEventListener("click", toggleArchiveActiveBookmark);
  $("bookmarkDeleteButton").addEventListener("click", deleteActiveBookmark);
}

async function saveBookmarkReply(event) {
  event.preventDefault();
  const bookmark = state.bookmarks.find(item => item.id === activeBookmarkId);
  const input = $("bookmarkReplyInput");
  const text = input.value.trim();
  if (!bookmark || !text) return;

  const updated = {
    ...bookmark,
    responses: [...(bookmark.responses || []), { id: uid("reply"), date: isoToday(), text, createdAt: Date.now() }],
    updatedAt: Date.now()
  };
  try {
    await diaryRepository.save("bookmarks", updated);
    state.bookmarks = state.bookmarks.map(item => item.id === updated.id ? updated : item);
    renderAll();
    renderBookmarkDetail();
    toast("Reply saved for this thread through time ☁️");
  } catch (error) {
    console.error("Could not save bookmark reply.", error);
    toast("Fuwa couldn't save your reply.");
  }
}

async function rescheduleActiveBookmark() {
  const bookmark = state.bookmarks.find(item => item.id === activeBookmarkId);
  if (!bookmark) return;
  const next = prompt("Return this thought on (YYYY-MM-DD):", bookmark.revisitDate);
  if (!next) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || next < isoToday()) {
    toast("Choose today or a future date.");
    return;
  }
  const updated = { ...bookmark, revisitDate: next, archived: false, updatedAt: Date.now() };
  try {
    await diaryRepository.save("bookmarks", updated);
    state.bookmarks = state.bookmarks.map(item => item.id === updated.id ? updated : item);
    renderAll();
    renderBookmarkDetail();
    toast("Return date changed 🔖");
  } catch (error) {
    console.error("Could not reschedule bookmark.", error);
  }
}

async function toggleArchiveActiveBookmark() {
  const bookmark = state.bookmarks.find(item => item.id === activeBookmarkId);
  if (!bookmark) return;
  const updated = { ...bookmark, archived: !bookmark.archived, updatedAt: Date.now() };
  try {
    await diaryRepository.save("bookmarks", updated);
    state.bookmarks = state.bookmarks.map(item => item.id === updated.id ? updated : item);
    renderAll();
    renderBookmarkDetail();
  } catch (error) {
    console.error("Could not update bookmark.", error);
  }
}

async function deleteActiveBookmark() {
  const bookmark = state.bookmarks.find(item => item.id === activeBookmarkId);
  if (!bookmark || !confirm("Delete this Fuwa Bookmark?")) return;
  try {
    await diaryRepository.remove("bookmarks", bookmark.id);
    state.bookmarks = state.bookmarks.filter(item => item.id !== bookmark.id);
    activeBookmarkId = null;
    renderAll();
    navigate("bookmarks");
    toast("Bookmark deleted");
  } catch (error) {
    console.error("Could not delete bookmark.", error);
  }
}

function dueBookmarkCount() {
  return state.bookmarks.filter(item => bookmarkStatus(item) === "ready").length;
}

const moodLabels = {
  amazing: "Amazing",
  good: "Good",
  neutral: "Neutral",
  tired: "Tired",
  sad: "Sad",
  angry: "Angry"
};

const moodBeadClass = {
  amazing: "bead-amazing",
  good: "bead-good",
  neutral: "bead-neutral",
  tired: "bead-tired",
  sad: "bead-sad",
  angry: "bead-angry"
};

function monthKeyFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function moodCheckinsForMonth(date) {
  const prefix = `${monthKeyFromDate(date)}-`;
  return [...state.moodCheckins]
    .filter(item => item.date.startsWith(prefix))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function getTodayMoodCheckin() {
  return state.moodCheckins.find(item => item.date === isoToday()) || null;
}

function moodBeadsMarkup(checkins, max = 31) {
  return checkins.slice(0, max).map((item, index) => `
    <span class="mood-bead ${moodBeadClass[item.mood] || "bead-neutral"}"
      style="--bead-i:${index}"
      title="${escapeHtml(formatDate(item.date))} · ${escapeHtml(moodLabels[item.mood] || item.mood)}"></span>
  `).join("");
}

function renderHomeMoodJar() {
  const checkins = moodCheckinsForMonth(new Date());
  const today = getTodayMoodCheckin();
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date());
  $("moodJarMonthLabel").textContent = monthName;
  $("homeMoodJarBeads").innerHTML = moodBeadsMarkup(checkins);
  $("moodJarSummary").textContent = checkins.length
    ? `${checkins.length} check-in${checkins.length === 1 ? "" : "s"} tucked into your jar.`
    : "No check-ins yet. Your first little bead is waiting.";
  $("moodJarTodayStatus").textContent = today
    ? `${moodIconMarkup(today.mood, "mini")} <span class="mood-status-copy">Today: ${moodLabels[today.mood]} · tap to open</span>`
    : "♡ Check in today";
}

function renderMoodJarView() {
  const checkins = moodCheckinsForMonth(moodJarCursor);
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(moodJarCursor);
  $("moodJarViewMonth").textContent = monthName;
  $("moodJarLargeBeads").innerHTML = moodBeadsMarkup(checkins);
  $("moodJarCheckinCount").textContent = `${checkins.length} check-in${checkins.length === 1 ? "" : "s"}`;

  const counts = Object.keys(moodEmoji).reduce((acc, mood) => {
    acc[mood] = checkins.filter(item => item.mood === mood).length;
    return acc;
  }, {});
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  $("moodJarMostCommon").textContent = top && top[1] > 0
    ? `Most common: ${moodIconMarkup(top[0], "mini")} <span>${moodLabels[top[0]]}</span>`
    : "Your jar is waiting for its first mood.";

  $("moodCountGrid").innerHTML = Object.keys(moodEmoji).map(mood => `
    <div class="mood-count-card">
      ${moodIconMarkup(mood)}
      <strong>${counts[mood]}</strong>
      <small>${moodLabels[mood]}</small>
    </div>
  `).join("");

  renderMoodCalendar();
  const next = new Date(moodJarCursor.getFullYear(), moodJarCursor.getMonth() + 1, 1);
  const current = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  $("moodJarNextMonth").disabled = next > current;
}

function renderMoodCalendar() {
  const grid = $("moodCalendarGrid");
  grid.innerHTML = "";
  const year = moodJarCursor.getFullYear();
  const month = moodJarCursor.getMonth();
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < startOffset; i++) {
    const blank = document.createElement("span");
    blank.className = "calendar-day empty";
    grid.appendChild(blank);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const checkin = state.moodCheckins.find(item => item.date === date);
    const cell = document.createElement("div");
    cell.className = "mood-calendar-day";
    if (date === isoToday()) cell.classList.add("today");
    cell.innerHTML = `<span>${day}</span><strong>${checkin ? moodIconMarkup(checkin.mood, "calendar-mini") : ""}</strong>`;
    if (checkin) cell.title = `${formatDate(date)} · ${moodLabels[checkin.mood]}`;
    grid.appendChild(cell);
  }
}

function openMoodCheckin(force = false) {
  const today = getTodayMoodCheckin();
  document.querySelectorAll("[data-checkin-mood]").forEach(button => {
    button.classList.toggle("selected", today?.mood === button.dataset.checkinMood);
  });
  $("moodCheckinTitle").textContent = today ? "How are you feeling now?" : "How are you feeling today?";
  $("skipMoodCheckin").textContent = today ? "Keep current mood" : "Skip for now";
  $("moodCheckinModal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeMoodCheckin() {
  $("moodCheckinModal").classList.add("hidden");
  document.body.style.overflow = "";
}

async function saveMoodCheckin(mood) {
  if (!moodEmoji[mood]) return;
  const date = isoToday();
  const existing = getTodayMoodCheckin();
  const record = {
    id: date,
    date,
    mood,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now()
  };

  try {
    await diaryRepository.save("moodCheckins", record);
    const index = state.moodCheckins.findIndex(item => item.id === date);
    if (index >= 0) state.moodCheckins[index] = record;
    else state.moodCheckins.push(record);
    closeMoodCheckin();
    renderAll();
    toast(existing ? "Today's mood updated ☁️" : "A little mood tucked into your jar 🫙");
  } catch (error) {
    console.error("Could not save mood check-in.", error);
    toast("Fuwa couldn't save that check-in. Please try again.");
  }
}

function maybeShowDailyMoodCheckin() {
  if (getTodayMoodCheckin()) return;
  setTimeout(() => openMoodCheckin(), 350);
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 1800);
}

function navigate(view) {
  currentView = view;

  document.querySelectorAll(".view").forEach(section => {
    section.classList.toggle("active", section.id === `${view}View`);
  });

  document.querySelectorAll(".nav-item[data-nav]").forEach(button => {
    button.classList.toggle("active", button.dataset.nav === view);
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

const themeNames = {
  peach: "Peach Pink",
  pink: "Sakura Pink",
  lavender: "Lavender Purple",
  blue: "Sky Blue",
  mint: "Mint Green",
  yellow: "Soft Yellow"
};

function applyTheme() {
  document.body.classList.remove(
    "theme-lavender",
    "theme-peach",
    "theme-blue",
    "theme-mint",
    "theme-yellow"
  );

  if (state.theme === "lavender") document.body.classList.add("theme-lavender");
  if (state.theme === "peach") document.body.classList.add("theme-peach");
  if (state.theme === "blue") document.body.classList.add("theme-blue");
  if (state.theme === "mint") document.body.classList.add("theme-mint");
  if (state.theme === "yellow") document.body.classList.add("theme-yellow");

  renderAppearanceControls();
}

async function applyWallpaper() {
  const saved = await diaryRepository.getSetting("custom-wallpaper");

  if (wallpaperObjectUrl) {
    URL.revokeObjectURL(wallpaperObjectUrl);
    wallpaperObjectUrl = "";
  }

  document.documentElement.style.removeProperty("--fuwa-wallpaper-image");
  document.body.classList.remove("wallpaper-active", "wallpaper-overlay-light", "wallpaper-overlay-medium", "wallpaper-overlay-strong");

  if (saved?.blob && state.wallpaperEnabled) {
    wallpaperObjectUrl = URL.createObjectURL(saved.blob);
    document.documentElement.style.setProperty("--fuwa-wallpaper-image", `url("${wallpaperObjectUrl}")`);
    document.body.classList.add("wallpaper-active", `wallpaper-overlay-${state.wallpaperOverlay}`);
  }

  renderAppearanceControls(saved);
}

function renderAppearanceControls(savedWallpaper = null) {
  const currentLabel = $("currentThemeLabel");
  if (currentLabel) currentLabel.textContent = themeNames[state.theme] || themeNames.pink;

  document.querySelectorAll("[data-theme-choice]").forEach(button => {
    button.classList.toggle("selected", button.dataset.themeChoice === state.theme);
  });

  const toggle = $("wallpaperToggle");
  if (toggle) toggle.checked = !!state.wallpaperEnabled;

  document.querySelectorAll("[data-overlay]").forEach(button => {
    button.classList.toggle("selected", button.dataset.overlay === state.wallpaperOverlay);
  });

  const status = $("wallpaperStatus");
  if (status) status.textContent = state.wallpaperEnabled ? "On" : "Off";

  if (savedWallpaper !== null) updateWallpaperPreview(savedWallpaper);
  else if ($("wallpaperPreview")) {
    diaryRepository.getSetting("custom-wallpaper").then(updateWallpaperPreview).catch(console.error);
  }
}

function updateWallpaperPreview(saved) {
  const preview = $("wallpaperPreview");
  const empty = $("wallpaperPreviewEmpty");
  if (!preview || !empty) return;

  const old = preview.querySelector(".wallpaper-preview-image");
  if (old) old.remove();

  if (!saved?.blob) {
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");
  const url = URL.createObjectURL(saved.blob);
  const img = document.createElement("img");
  img.className = "wallpaper-preview-image";
  img.alt = "Saved Fuwa wallpaper";
  img.src = url;
  img.onload = () => URL.revokeObjectURL(url);
  preview.appendChild(img);
}

function openAppearance() {
  $("appearanceModal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  renderAppearanceControls();
}

function closeAppearance() {
  $("appearanceModal").classList.add("hidden");
  document.body.style.overflow = "";
}

async function selectTheme(theme) {
  if (!themeNames[theme]) return;
  state.theme = theme;
  savePreferences();
  applyTheme();
}

async function toggleWallpaperEnabled() {
  const saved = await diaryRepository.getSetting("custom-wallpaper");
  if (!saved?.blob && $("wallpaperToggle").checked) {
    $("wallpaperToggle").checked = false;
    toast("Choose a wallpaper photo first.");
    return;
  }
  state.wallpaperEnabled = $("wallpaperToggle").checked;
  savePreferences();
  await applyWallpaper();
}

async function setWallpaperOverlay(level) {
  if (!["light", "medium", "strong"].includes(level)) return;
  state.wallpaperOverlay = level;
  savePreferences();
  await applyWallpaper();
}

function openWallpaperPicker() {
  $("wallpaperFileInput").click();
}

function imageNaturalSize(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const result = { width: image.naturalWidth, height: image.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(result);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read wallpaper image."));
    };
    image.src = url;
  });
}

async function beginWallpaperCrop(file) {
  if (!file || !file.type.startsWith("image/")) {
    toast("Choose an image file.");
    return;
  }

  pendingWallpaperFile = file;
  if (cropObjectUrl) URL.revokeObjectURL(cropObjectUrl);
  cropObjectUrl = URL.createObjectURL(file);

  cropScale = 1;
  cropX = 0;
  cropY = 0;
  cropDragStart = null;

  $("wallpaperCropImage").src = cropObjectUrl;
  $("wallpaperZoomRange").value = "1";
  updateCropTransform();

  $("wallpaperCropModal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeWallpaperCrop() {
  $("wallpaperCropModal").classList.add("hidden");
  pendingWallpaperFile = null;
  cropDragStart = null;
  if (cropObjectUrl) {
    URL.revokeObjectURL(cropObjectUrl);
    cropObjectUrl = "";
  }
  if (!$("appearanceModal").classList.contains("hidden")) document.body.style.overflow = "hidden";
  else document.body.style.overflow = "";
}

function updateCropTransform() {
  const image = $("wallpaperCropImage");
  if (!image) return;
  image.style.transform = `translate(${cropX}px, ${cropY}px) scale(${cropScale})`;
}

function cropPointerDown(event) {
  event.preventDefault();
  cropDragStart = { x: event.clientX, y: event.clientY, cropX, cropY };
  $("wallpaperCropStage").setPointerCapture?.(event.pointerId);
}

function cropPointerMove(event) {
  if (!cropDragStart) return;
  cropX = cropDragStart.cropX + (event.clientX - cropDragStart.x);
  cropY = cropDragStart.cropY + (event.clientY - cropDragStart.y);
  updateCropTransform();
}

function cropPointerUp() {
  cropDragStart = null;
}

async function createCroppedWallpaperBlob() {
  const image = $("wallpaperCropImage");
  const stage = $("wallpaperCropStage");
  if (!image || !stage || !pendingWallpaperFile) throw new Error("No wallpaper selected.");

  const source = await imageFromBlob(pendingWallpaperFile);
  const outputWidth = 1170;
  const outputHeight = 2532;
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext("2d", { alpha: false });

  const stageRect = stage.getBoundingClientRect();
  const fitScale = Math.max(stageRect.width / source.naturalWidth, stageRect.height / source.naturalHeight);
  const displayWidth = source.naturalWidth * fitScale * cropScale;
  const displayHeight = source.naturalHeight * fitScale * cropScale;

  const ratioX = outputWidth / stageRect.width;
  const ratioY = outputHeight / stageRect.height;

  const drawWidth = displayWidth * ratioX;
  const drawHeight = displayHeight * ratioY;
  const drawX = ((stageRect.width - displayWidth) / 2 + cropX) * ratioX;
  const drawY = ((stageRect.height - displayHeight) / 2 + cropY) * ratioY;

  context.fillStyle = "#fff8fa";
  context.fillRect(0, 0, outputWidth, outputHeight);
  context.drawImage(source, drawX, drawY, drawWidth, drawHeight);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error("Wallpaper crop failed.")),
      "image/jpeg",
      0.86
    );
  });
}

async function saveCroppedWallpaper() {
  try {
    $("saveWallpaperCrop").disabled = true;
    $("saveWallpaperCrop").textContent = "Saving…";
    const blob = await createCroppedWallpaperBlob();
    await diaryRepository.saveSetting({
      key: "custom-wallpaper",
      blob,
      updatedAt: Date.now()
    });
    state.wallpaperEnabled = true;
    savePreferences();
    closeWallpaperCrop();
    await applyWallpaper();
    toast("Wallpaper saved ☁️");
  } catch (error) {
    console.error("Could not save wallpaper.", error);
    toast("Fuwa couldn't save that wallpaper.");
  } finally {
    $("saveWallpaperCrop").disabled = false;
    $("saveWallpaperCrop").textContent = "Save";
  }
}

async function resetAppearance() {
  if (!confirm("Reset Fuwa's appearance to the default cozy pink theme?")) return;
  state.theme = "pink";
  state.wallpaperEnabled = false;
  state.wallpaperOverlay = "medium";
  savePreferences();
  await diaryRepository.removeSetting("custom-wallpaper");
  applyTheme();
  await applyWallpaper();
  toast("Appearance reset");
}

function renderMoodPicker() {
  document.querySelectorAll("#moodPicker button").forEach(button => {
    button.classList.toggle("selected", button.dataset.mood === state.selectedMood);
  });
}

function renderCalendar() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  $("monthTitle").textContent = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric"
  }).format(today);

  const grid = $("calendarGrid");
  grid.innerHTML = "";

  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < startOffset; i++) {
    const blank = document.createElement("span");
    blank.className = "calendar-day empty";
    grid.appendChild(blank);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const hasEntry = state.entries.some(entry => entry.date === date);

    const button = document.createElement("button");
    button.className = "calendar-day";
    if (hasEntry) button.classList.add("has-entry");
    if (date === isoToday()) button.classList.add("today");
    button.textContent = day;

    if (hasEntry) {
      button.addEventListener("click", () => {
        const entry = state.entries.find(item => item.date === date);
        openEditor(entry.id);
      });
    }

    grid.appendChild(button);
  }
}

function entryCard(entry) {
  const tags = (entry.tags || []).slice(0, 3)
    .map(tag => `<span class="tag">#${escapeHtml(tag)}</span>`).join("");

  return `
    <article class="entry-card">
      <button data-entry-id="${entry.id}">
        <div class="soft-label">${formatDate(entry.date)} · ${moodIconMarkup(entry.mood, "mini")}</div>
        <h4>${escapeHtml(entry.title)}</h4>
        <p>${escapeHtml(entry.body.slice(0, 120))}${entry.body.length > 120 ? "…" : ""}</p>
        <div class="meta">${tags}</div>
      </button>
    </article>
  `;
}

function bindEntryCards(container) {
  container.querySelectorAll("[data-entry-id]").forEach(button => {
    button.addEventListener("click", () => openEditor(button.dataset.entryId));
  });
}

function renderRecentEntries() {
  const container = $("recentEntries");
  const recent = [...state.entries]
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt)
    .slice(0, 3);

  container.innerHTML = recent.length
    ? recent.map(entryCard).join("")
    : `<div class="empty-state">Your first memory will appear here 🌸</div>`;

  bindEntryCards(container);
}

function renderEntries(query = "") {
  const normalized = query.trim().toLowerCase();

  const entries = [...state.entries]
    .filter(entry => {
      if (!normalized) return true;
      return [
        entry.title,
        entry.body,
        entry.mood,
        ...(entry.tags || [])
      ].join(" ").toLowerCase().includes(normalized);
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);

  const container = $("entriesList");
  container.innerHTML = entries.length
    ? entries.map(entryCard).join("")
    : `<div class="empty-state">No matching memories yet.</div>`;

  bindEntryCards(container);
}

function renderTinyJoys() {
  const container = $("tinyJoyList");
  const joys = [...state.tinyJoys].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);

  container.innerHTML = joys.length
    ? joys.map(joy => `
      <div class="joy-item">
        <span>🌷</span>
        <div>
          <div>${escapeHtml(joy.text)}</div>
          <time>${new Date(joy.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
        </div>
      </div>
    `).join("")
    : `<div class="empty-state">Add one tiny happy thing from today.</div>`;
}

function renderLetters() {
  const container = $("lettersList");
  const today = isoToday();

  const letters = [...state.letters].sort((a, b) => a.openDate.localeCompare(b.openDate));

  container.innerHTML = letters.length
    ? letters.map(letter => {
      const unlocked = letter.openDate <= today;
      return `
        <article class="letter-card ${unlocked ? "open-letter" : "locked-letter"}">
          <div class="soft-label">${unlocked ? "Ready to open" : "Sealed until"} ${formatDate(letter.openDate)}</div>
          <h4>${escapeHtml(letter.title)}</h4>
          <p>${unlocked ? escapeHtml(letter.body) : "This letter is waiting quietly for Future You. ✉️"}</p>
        </article>
      `;
    }).join("")
    : `<div class="empty-state">Write something for Future You ✉️</div>`;
}

function renderStats() {
  $("entryCount").textContent = state.entries.length;
  $("joyCount").textContent = state.tinyJoys.length;
  $("letterCount").textContent = state.letters.length;
  if ($("bookmarkCount")) $("bookmarkCount").textContent = state.bookmarks.length;
  if ($("nightlyCount")) $("nightlyCount").textContent = state.nightlyReflections.length;
}

function renderAll() {
  $("todayLabel").textContent = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric"
  }).format(new Date());

  renderMoodPicker();
  renderHomeMoodJar();
  renderMoodJarView();
  renderHomeThreads();
  renderThreads();
  renderSleepHome();
  renderNightlyHome();
  renderMemoryDriftHome();
  renderHomeBookmarks();
  renderBookmarks();
  if (activeThreadId) renderThreadDetail();
  renderCalendar();
  renderRecentEntries();
  renderEntries($("entrySearch")?.value || "");
  renderTinyJoys();
  renderLetters();
  renderStats();
  applyTheme();
}

async function openEditor(entryId = null, dateOverride = null) {
  const entry = entryId ? state.entries.find(item => item.id === entryId) : null;

  cleanupEditorMediaPreviews();

  if (entry) {
    try {
      const storedMedia = await diaryRepository.getMediaForEntry(entry.id);
      editorMedia = storedMedia
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(record => ({ ...record, isNew: false, previewUrl: URL.createObjectURL(record.blob) }));
    } catch (error) {
      console.error("Could not load entry photos.", error);
      toast("Fuwa couldn't load this entry's photos.");
    }
  }

  $("entryId").value = entry?.id || "";
  $("entryDate").value = entry?.date || dateOverride || isoToday();
  $("entryMood").value = entry?.mood || state.selectedMood || "good";
  $("entryTitle").value = entry?.title || "";
  $("entryBody").value = entry?.body || "";
  $("entryTags").value = (entry?.tags || []).join(", ");
  $("entryAfterthought").value = entry?.afterthought || "";

  $("editorHeading").textContent = entry ? "Edit Entry" : "New Entry";
  $("deleteEntryButton").classList.toggle("hidden", !entry);
  renderEditorMedia();
  renderEntryThreadPicker(entry?.threadIds || []);
  renderEntryBookmarks(entry?.id || null);

  navigate("editor");
  setTimeout(() => $("entryTitle").focus(), 80);
}

async function saveEntry() {
  const id = $("entryId").value;
  const title = $("entryTitle").value.trim();
  const body = $("entryBody").value.trim();

  if (!title || !body) {
    toast("Add a title and a little something first.");
    return;
  }

  const data = {
    id: id || uid("entry"),
    date: $("entryDate").value || isoToday(),
    mood: $("entryMood").value,
    title,
    body,
    tags: $("entryTags").value.split(",").map(t => t.trim().replace(/^#/, "")).filter(Boolean),
    threadIds: selectedEditorThreadIds(),
    afterthought: $("entryAfterthought").value.trim(),
    createdAt: id ? (state.entries.find(e => e.id === id)?.createdAt || Date.now()) : Date.now(),
    updatedAt: Date.now()
  };

  try {
    const newMediaRecords = editorMedia.filter(item => item.isNew).map(item => ({
      id: item.id,
      entryId: data.id,
      blob: item.blob,
      type: item.type,
      width: item.width,
      height: item.height,
      originalName: item.originalName,
      createdAt: item.createdAt
    }));
    await diaryRepository.saveEntryWithMedia(data, newMediaRecords, [...removedMediaIds]);
    if (id) state.entries = state.entries.map(entry => entry.id === id ? data : entry);
    else state.entries.push(data);
    state.selectedMood = data.mood;
    saveState();
    cleanupEditorMediaPreviews();
    navigate("entries");
    toast("Memory saved 🌸");
  } catch (error) {
    console.error("Could not save diary entry.", error);
    toast("Fuwa couldn't save that memory. Please try again.");
  }
}

async function deleteEntry() {
  const id = $("entryId").value;
  if (!id) return;

  if (!confirm("Delete this diary entry?")) return;

  try {
    await diaryRepository.deleteEntryWithMedia(id);
    state.entries = state.entries.filter(entry => entry.id !== id);
    cleanupEditorMediaPreviews();
    saveState();
    navigate("entries");
    toast("Entry deleted");
  } catch (error) {
    console.error("Could not delete diary entry.", error);
    toast("Fuwa couldn't delete that entry. Please try again.");
  }
}

async function addTinyJoy(event) {
  event.preventDefault();
  const input = $("tinyJoyInput");
  const text = input.value.trim();
  if (!text) return;

  const joy = {
    id: uid("joy"),
    text,
    createdAt: Date.now()
  };

  try {
    await diaryRepository.save("tinyJoys", joy);
    state.tinyJoys.push(joy);
    input.value = "";
    saveState();
    toast("Tiny joy saved ✨");
  } catch (error) {
    console.error("Could not save Tiny Joy.", error);
    toast("Fuwa couldn't save that joy. Please try again.");
  }
}

function toggleLetterComposer(show) {
  $("letterComposer").classList.toggle("hidden", !show);
  if (show) {
    $("letterTitle").value = "";
    $("letterBody").value = "";

    const future = new Date();
    future.setMonth(future.getMonth() + 1);
    const offset = future.getTimezoneOffset();
    $("letterOpenDate").value = new Date(future.getTime() - offset * 60000).toISOString().slice(0, 10);
  }
}

async function saveLetter() {
  const title = $("letterTitle").value.trim();
  const body = $("letterBody").value.trim();
  const openDate = $("letterOpenDate").value;

  if (!title || !body || !openDate) {
    toast("Finish the letter before sealing it.");
    return;
  }

  const letter = {
    id: uid("letter"),
    title,
    body,
    openDate,
    createdAt: Date.now()
  };

  try {
    await diaryRepository.save("letters", letter);
    state.letters.push(letter);
    saveState();
    toggleLetterComposer(false);
    toast("Letter sealed ✉️");
  } catch (error) {
    console.error("Could not save letter.", error);
    toast("Fuwa couldn't seal that letter. Please try again.");
  }
}

async function exportBackup() {
  try {
    const currentData = await diaryRepository.readCurrentData();
    const mediaRecords = await diaryRepository.readAllMedia();
    const media = [];

    for (const record of mediaRecords) {
      media.push({
        id: record.id,
        entryId: record.entryId,
        type: record.type || record.blob?.type || "image/jpeg",
        width: record.width || null,
        height: record.height || null,
        originalName: record.originalName || "photo",
        createdAt: record.createdAt || Date.now(),
        dataUrl: await blobToDataUrl(record.blob)
      });
    }

    const payload = {
      app: "Fuwa",
      version: 7,
      exportedAt: new Date().toISOString(),
      data: { ...currentData, media, selectedMood: state.selectedMood, theme: state.theme, wallpaperEnabled: state.wallpaperEnabled, wallpaperOverlay: state.wallpaperOverlay, sleepSound: state.sleepSound, sleepMinutes: state.sleepMinutes, sleepVolume: state.sleepVolume }
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fuwa-backup-${isoToday()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Could not create Fuwa backup.", error);
    toast("Fuwa couldn't create a backup. Please try again.");
  }
}

function importBackup(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      const incoming = parsed.data || parsed;
      validateContentData(incoming);
      incoming.moodCheckins = validateMoodCheckins(incoming.moodCheckins);
      incoming.threads = validateThreads(incoming.threads);
      incoming.bookmarks = validateBookmarks(incoming.bookmarks);
      incoming.nightlyReflections = validateNightlyReflections(incoming.nightlyReflections);
      incoming.thenNow = validateSimpleStore(incoming.thenNow, "thenNow");
      incoming.comfortItems = validateSimpleStore(incoming.comfortItems, "comfortItems");
      incoming.unsentLetters = validateSimpleStore(incoming.unsentLetters, "unsentLetters");
      incoming.thoughtBubbles = validateSimpleStore(incoming.thoughtBubbles, "thoughtBubbles");
      incoming.dreams = validateSimpleStore(incoming.dreams, "dreams");
      const backupMedia = validateMediaBackup(incoming.media);
      const mediaRecords = backupMedia.map(record => ({
        id: record.id,
        entryId: record.entryId,
        blob: dataUrlToBlob(record.dataUrl),
        type: record.type || "image/jpeg",
        width: record.width || null,
        height: record.height || null,
        originalName: record.originalName || "photo",
        createdAt: record.createdAt || Date.now()
      }));
      await diaryRepository.replaceContent(incoming, mediaRecords);
      state = {
        ...structuredClone(defaultState),
        entries: incoming.entries,
        tinyJoys: incoming.tinyJoys,
        letters: incoming.letters,
        moodCheckins: Array.isArray(incoming.moodCheckins) ? incoming.moodCheckins : [],
        threads: Array.isArray(incoming.threads) ? incoming.threads : [],
        bookmarks: Array.isArray(incoming.bookmarks) ? incoming.bookmarks : [],
        nightlyReflections: Array.isArray(incoming.nightlyReflections) ? incoming.nightlyReflections : [],
        thenNow: Array.isArray(incoming.thenNow) ? incoming.thenNow : [],
        comfortItems: Array.isArray(incoming.comfortItems) ? incoming.comfortItems : [],
        unsentLetters: Array.isArray(incoming.unsentLetters) ? incoming.unsentLetters : [],
        thoughtBubbles: Array.isArray(incoming.thoughtBubbles) ? incoming.thoughtBubbles : [],
        dreams: Array.isArray(incoming.dreams) ? incoming.dreams : [],
        selectedMood: typeof incoming.selectedMood === "string" ? incoming.selectedMood : state.selectedMood,
        theme: typeof incoming.theme === "string" ? incoming.theme : state.theme,
        wallpaperEnabled: typeof incoming.wallpaperEnabled === "boolean" ? incoming.wallpaperEnabled : state.wallpaperEnabled,
        wallpaperOverlay: ["light", "medium", "strong"].includes(incoming.wallpaperOverlay) ? incoming.wallpaperOverlay : state.wallpaperOverlay,
        sleepSound: typeof incoming.sleepSound === "string" ? incoming.sleepSound : state.sleepSound,
        sleepMinutes: Number.isFinite(incoming.sleepMinutes) ? incoming.sleepMinutes : state.sleepMinutes,
        sleepVolume: Number.isFinite(incoming.sleepVolume) ? incoming.sleepVolume : state.sleepVolume
      };
      saveState();
      toast("Backup imported 🌸");
    } catch (error) {
      console.error("Could not import Fuwa backup.", error);
      alert("That file does not look like a valid Fuwa backup.");
    }
  };
  reader.onerror = () => alert("Fuwa could not read that backup file.");
  reader.readAsText(file);
}

async function clearAll() {
  if (!confirm("Clear all Fuwa entries, joys, and letters stored on this device?")) return;
  if (!confirm("This cannot be undone unless you exported a backup. Continue?")) return;

  try {
    await diaryRepository.clearDiaryData();
    state = structuredClone(defaultState);
    saveState();
    navigate("home");
    toast("Local data cleared");
  } catch (error) {
    console.error("Could not clear Fuwa data.", error);
    toast("Fuwa couldn't clear local data. Please try again.");
  }
}


function installIOSZoomGuard() {
  const editableSelector = 'input, textarea, select, [contenteditable="true"]';

  // Safari exposes gesture* events for pinch zoom.
  ["gesturestart", "gesturechange", "gestureend"].forEach(type => {
    document.addEventListener(type, event => {
      event.preventDefault();
    }, { passive: false });
  });

  // Prevent multi-touch pinch gestures before Safari can scale the page.
  document.addEventListener("touchmove", event => {
    if (event.touches && event.touches.length > 1) {
      event.preventDefault();
    }
  }, { passive: false });

  // Prevent double-tap page zoom on non-editable UI.
  let lastTouchEnd = 0;
  document.addEventListener("touchend", event => {
    if (event.target.closest(editableSelector)) {
      lastTouchEnd = 0;
      return;
    }

    const now = Date.now();
    if (now - lastTouchEnd <= 320) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });
}


document.addEventListener("DOMContentLoaded", async () => {
  installIOSZoomGuard();
  document.body.classList.add("fuwa-loading");
  try {
    state = { ...state, ...loadPreferences() };
    await diaryRepository.initialize();
    await diaryRepository.migrateLegacyData();
    await loadState();
    renderAll();
    await applyWallpaper();
    renderSleepControls();
    maybeShowDailyMoodCheckin();
    document.body.classList.remove("fuwa-loading");
  } catch (error) {
    console.error("Fuwa could not initialize its local database.", error);
    alert("Fuwa could not open its local diary. Please reload and try again.");
    return;
  }

  document.querySelectorAll("[data-nav]").forEach(button => {
    button.addEventListener("click", () => navigate(button.dataset.nav));
  });

  document.querySelectorAll("#moodPicker button").forEach(button => {
    button.addEventListener("click", () => {
      state.selectedMood = button.dataset.mood;
      saveState();
    });
  });







  $("openExploreButton").addEventListener("click", () => navigate("explore"));
  $("exploreHomeCard").addEventListener("click", () => navigate("explore"));

  document.querySelectorAll("#exploreView [data-nav]").forEach(button => {
    button.addEventListener("click", () => navigate(button.dataset.nav));
  });

  $("featureCancelButton").addEventListener("click", closeFeatureModal);
  $("featureForm").addEventListener("submit", saveFeatureModal);
  $("featureModal").addEventListener("click", event => {
    if (event.target === $("featureModal")) closeFeatureModal();
  });

  $("comfortAddButton").addEventListener("click", () => openFeatureModal("comfort"));
  $("comfortRandomButton").addEventListener("click", randomComfort);
  $("unsentAddButton").addEventListener("click", () => openFeatureModal("unsent"));
  $("bubbleForm").addEventListener("submit", saveThoughtBubble);
  $("bubbleRandomButton").addEventListener("click", randomBubble);
  $("dreamAddButton").addEventListener("click", () => openFeatureModal("dream"));

  $("monthlyPrev").addEventListener("click", () => {
    monthlyCursor = new Date(monthlyCursor.getFullYear(), monthlyCursor.getMonth()-1, 1);
    renderMonthlyStory(true);
  });
  $("monthlyNext").addEventListener("click", () => {
    const next = new Date(monthlyCursor.getFullYear(), monthlyCursor.getMonth()+1, 1);
    const current = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    if (next <= current) { monthlyCursor = next; renderMonthlyStory(); }
  });

  $("weatherPrev").addEventListener("click", () => {
    weatherCursor = new Date(weatherCursor.getFullYear(), weatherCursor.getMonth()-1, 1);
    renderEmotionalWeather(true);
  });
  $("weatherNext").addEventListener("click", () => {
    const next = new Date(weatherCursor.getFullYear(), weatherCursor.getMonth()+1, 1);
    const current = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    if (next <= current) { weatherCursor = next; renderEmotionalWeather(); }
  });

  $("openSleepCornerButton").addEventListener("click", openSleepCorner);
  $("sleepHomeCard").addEventListener("click", openSleepCorner);
  $("sleepBackButton").addEventListener("click", () => navigate("home"));

  document.querySelectorAll("[data-sleep-sound]").forEach(button => {
    button.addEventListener("click", () => selectSleepSound(button.dataset.sleepSound));
  });

  document.querySelectorAll("[data-sleep-minutes]").forEach(button => {
    button.addEventListener("click", () => setSleepTimerPreset(Number(button.dataset.sleepMinutes)));
  });

  $("sleepCustomMinutes").addEventListener("change", setSleepCustomTimer);
  $("sleepVolumeSlider").addEventListener("input", event => setSleepVolume(event.target.value));
  $("sleepPlayPauseButton").addEventListener("click", toggleSleepPlayback);
  $("sleepStopButton").addEventListener("click", () => stopSleepSound(false));

  $("openNightlyButton").addEventListener("click", openNightlyView);
  $("nightlyCard").addEventListener("click", openNightlyView);
  $("nightlyBackButton").addEventListener("click", () => navigate("home"));
  $("nightlyForm").addEventListener("submit", saveNightlyReflection);
  $("nightlySkipButton").addEventListener("click", skipNightlyReflection);

  $("memoryDriftBackButton").addEventListener("click", () => navigate("home"));
  $("openBookmarksButton").addEventListener("click", () => navigate("bookmarks"));
  $("bookmarksHomeCard").addEventListener("click", event => {
    if (!event.target.closest("[data-bookmark-open]")) navigate("bookmarks");
  });
  $("bookmarksBackButton").addEventListener("click", () => navigate("bookmarks"));
  $("addBookmarkButton").addEventListener("click", openBookmarkComposer);
  $("cancelBookmarkComposer").addEventListener("click", closeBookmarkComposer);
  $("bookmarkComposerForm").addEventListener("submit", saveBookmarkFromComposer);
  document.querySelectorAll("[data-bookmark-months]").forEach(button => {
    button.addEventListener("click", () => setBookmarkPreset(Number(button.dataset.bookmarkMonths)));
  });
  $("bookmarkComposer").addEventListener("click", event => {
    if (event.target === $("bookmarkComposer")) closeBookmarkComposer();
  });

  $("openThreadsButton").addEventListener("click", () => navigate("threads"));
  $("newThreadButton").addEventListener("click", () => openThreadModal());
  $("editorNewThreadButton").addEventListener("click", () => openThreadModal());
  $("threadDetailBack").addEventListener("click", () => navigate("threads"));
  $("threadForm").addEventListener("submit", saveThreadFromForm);
  $("cancelThreadButton").addEventListener("click", closeThreadModal);
  $("deleteThreadButton").addEventListener("click", deleteCurrentThread);
  $("threadEmojiInput").addEventListener("input", () => {
    $("threadEmojiPreview").textContent = $("threadEmojiInput").value.trim() || "🧵";
  });
  $("threadModal").addEventListener("click", event => {
    if (event.target === $("threadModal")) closeThreadModal();
  });

  $("openMoodJarButton").addEventListener("click", () => {
    moodJarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    renderMoodJarView();
    navigate("moodjar");
  });
  $("moodJarCard").addEventListener("click", () => {
    moodJarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    renderMoodJarView();
    navigate("moodjar");
  });
  $("moodJarCheckInButton").addEventListener("click", () => openMoodCheckin(true));
  $("moodJarPrevMonth").addEventListener("click", () => {
    moodJarCursor = new Date(moodJarCursor.getFullYear(), moodJarCursor.getMonth() - 1, 1);
    renderMoodJarView();
  });
  $("moodJarNextMonth").addEventListener("click", () => {
    const candidate = new Date(moodJarCursor.getFullYear(), moodJarCursor.getMonth() + 1, 1);
    const current = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    if (candidate <= current) {
      moodJarCursor = candidate;
      renderMoodJarView();
    }
  });
  document.querySelectorAll("[data-checkin-mood]").forEach(button => {
    button.addEventListener("click", () => saveMoodCheckin(button.dataset.checkinMood));
  });
  $("skipMoodCheckin").addEventListener("click", closeMoodCheckin);
  $("moodCheckinModal").addEventListener("click", event => {
    if (event.target === $("moodCheckinModal")) closeMoodCheckin();
  });

  $("writeTodayButton").addEventListener("click", () => openEditor(null, isoToday()));
  $("newEntryButton").addEventListener("click", () => openEditor());
  $("navCreate").addEventListener("click", () => openEditor());
  $("saveEntryButton").addEventListener("click", saveEntry);
  $("cancelEditor").addEventListener("click", () => {
    cleanupEditorMediaPreviews();
    navigate("entries");
  });
  $("deleteEntryButton").addEventListener("click", deleteEntry);
  $("addPhotosButton").addEventListener("click", () => $("entryPhotosInput").click());
  $("entryPhotosInput").addEventListener("change", addEntryPhotos);
  $("closePhotoViewer").addEventListener("click", closePhotoViewer);
  $("photoViewer").addEventListener("click", event => {
    if (event.target === $("photoViewer")) closePhotoViewer();
  });

  $("tinyJoyForm").addEventListener("submit", addTinyJoy);
  $("entrySearch").addEventListener("input", event => renderEntries(event.target.value));

  $("newLetterButton").addEventListener("click", () => toggleLetterComposer(true));
  $("cancelLetterButton").addEventListener("click", () => toggleLetterComposer(false));
  $("saveLetterButton").addEventListener("click", saveLetter);


  $("appearanceCloseButton").addEventListener("click", closeAppearance);
  $("appearanceDoneButton").addEventListener("click", closeAppearance);
  $("appearanceModal").addEventListener("click", event => {
    if (event.target === $("appearanceModal")) closeAppearance();
  });

  document.querySelectorAll("[data-theme-choice]").forEach(button => {
    button.addEventListener("click", () => selectTheme(button.dataset.themeChoice));
  });

  $("chooseWallpaperButton").addEventListener("click", openWallpaperPicker);
  $("wallpaperFileInput").addEventListener("change", event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) beginWallpaperCrop(file);
  });

  $("wallpaperToggle").addEventListener("change", toggleWallpaperEnabled);

  document.querySelectorAll("[data-overlay]").forEach(button => {
    button.addEventListener("click", () => setWallpaperOverlay(button.dataset.overlay));
  });

  $("resetAppearanceButton").addEventListener("click", resetAppearance);

  $("cancelWallpaperCrop").addEventListener("click", closeWallpaperCrop);
  $("saveWallpaperCrop").addEventListener("click", saveCroppedWallpaper);
  $("wallpaperZoomRange").addEventListener("input", event => {
    cropScale = Number(event.target.value);
    updateCropTransform();
  });

  $("wallpaperCropStage").addEventListener("pointerdown", cropPointerDown);
  $("wallpaperCropStage").addEventListener("pointermove", cropPointerMove);
  $("wallpaperCropStage").addEventListener("pointerup", cropPointerUp);
  $("wallpaperCropStage").addEventListener("pointercancel", cropPointerUp);

  $("themeButton").addEventListener("click", openAppearance);
  $("exportButton").addEventListener("click", exportBackup);
  $("importInput").addEventListener("change", event => importBackup(event.target.files[0]));
  $("clearAllButton").addEventListener("click", clearAll);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(console.error);
    });
  }
});