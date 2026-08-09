const STORAGE_KEY = "fuwaDataV1";
const PREFERENCES_KEY = "fuwaPreferencesV1";
const DATABASE_NAME = "FuwaDB";
const DATABASE_VERSION = 5;
const MAX_PHOTOS_PER_ENTRY = 8;
const MAX_PHOTO_DIMENSION = 1800;
const PHOTO_JPEG_QUALITY = 0.82;
const CONTENT_STORES = ["entries", "tinyJoys", "letters"];
const ALL_STORES = [...CONTENT_STORES, "media", "chapters", "threads", "moodCheckins", "bookmarks", "settings"];
const LEGACY_MIGRATION_KEY = "legacy-fuwaDataV1-imported";

const defaultState = {
  entries: [],
  tinyJoys: [],
  letters: [],
  moodCheckins: [],
  threads: [],
  bookmarks: [],
  selectedMood: "good",
  theme: "pink"
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
      theme: typeof saved.theme === "string" ? saved.theme : defaultState.theme
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
      theme: state.theme
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
    const [entries, tinyJoys, letters, moodCheckins, threads, bookmarks] = await Promise.all([
      ...CONTENT_STORES.map(store => this.getAll(store)),
      this.getAll("moodCheckins"),
      this.getAll("threads"),
      this.getAll("bookmarks")
    ]);
    return { entries, tinyJoys, letters, moodCheckins, threads, bookmarks };
  },

  async replaceContent(data, mediaRecords = []) {
    const stores = [...CONTENT_STORES, "media", "moodCheckins", "threads", "bookmarks"];
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
    const stores = [...CONTENT_STORES, "media", "moodCheckins", "threads", "bookmarks"];
    const transaction = this.db.transaction(stores, "readwrite");
    stores.forEach(storeName => transaction.objectStore(storeName).clear());
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
      <div class="thread-timeline-dot">${moodEmoji[entry.mood] || "☁️"}</div>
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
    ? `${moodEmoji[today.mood]} Today: ${moodLabels[today.mood]} · tap to open`
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
    ? `Most common: ${moodEmoji[top[0]]} ${moodLabels[top[0]]}`
    : "Your jar is waiting for its first mood.";

  $("moodCountGrid").innerHTML = Object.keys(moodEmoji).map(mood => `
    <div class="mood-count-card">
      <span>${moodEmoji[mood]}</span>
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
    cell.innerHTML = `<span>${day}</span><strong>${checkin ? moodEmoji[checkin.mood] : ""}</strong>`;
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

function applyTheme() {
  document.body.classList.remove("theme-lavender", "theme-peach");
  if (state.theme === "lavender") document.body.classList.add("theme-lavender");
  if (state.theme === "peach") document.body.classList.add("theme-peach");
}

function cycleTheme() {
  const order = ["pink", "lavender", "peach"];
  state.theme = order[(order.indexOf(state.theme) + 1) % order.length];
  saveState();
  applyTheme();
  toast(`Theme: ${state.theme}`);
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
        <div class="soft-label">${formatDate(entry.date)} · ${moodEmoji[entry.mood] || "🙂"}</div>
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
      version: 5,
      exportedAt: new Date().toISOString(),
      data: { ...currentData, media, selectedMood: state.selectedMood, theme: state.theme }
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
        selectedMood: typeof incoming.selectedMood === "string" ? incoming.selectedMood : state.selectedMood,
        theme: typeof incoming.theme === "string" ? incoming.theme : state.theme
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

document.addEventListener("DOMContentLoaded", async () => {
  try {
    state = { ...state, ...loadPreferences() };
    await diaryRepository.initialize();
    await diaryRepository.migrateLegacyData();
    await loadState();
    renderAll();
    maybeShowDailyMoodCheckin();
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

  $("themeButton").addEventListener("click", cycleTheme);
  $("exportButton").addEventListener("click", exportBackup);
  $("importInput").addEventListener("change", event => importBackup(event.target.files[0]));
  $("clearAllButton").addEventListener("click", clearAll);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(console.error);
    });
  }
});