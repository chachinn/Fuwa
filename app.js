const STORAGE_KEY = "fuwaDataV1";
const PREFERENCES_KEY = "fuwaPreferencesV1";
const DATABASE_NAME = "FuwaDB";
const DATABASE_VERSION = 13;
const MAX_PHOTOS_PER_ENTRY = 8;
const MAX_SCRAPBOOK_PAGES = 50;
const MAX_SCRAPBOOK_PHOTOS_PER_PAGE = 12;
const SCRAPBOOK_BOOK_MIGRATION_KEY = "scrapbook-books-v1";
const MAX_PHOTO_DIMENSION = 1800;
const PHOTO_JPEG_QUALITY = 0.82;
const CONTENT_STORES = ["entries", "tinyJoys", "letters"];
const ALL_STORES = [...CONTENT_STORES, "media", "chapters", "threads", "moodCheckins", "bookmarks", "nightlyReflections", "thenNow", "comfortItems", "unsentLetters", "thoughtBubbles", "dreams", "dailyCheckins", "lifeCollections", "habitDefinitions", "moments", "randomThoughts", "journalCanvases", "stickerAssets", "scrapbookPhotos", "scrapbookBooks", "settings"];
const LOCAL_ONLY_STORES = new Set(["media", "journalCanvases", "stickerAssets", "scrapbookPhotos", "scrapbookBooks", "settings"]);
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
  dailyCheckins: [],
  lifeCollections: [],
  habitDefinitions: [],
  moments: [],
  randomThoughts: [],
  selectedMood: "good",
  profileName: "Little Cloud",
  theme: "pink",
  wallpaperEnabled: false,
  wallpaperOverlay: "medium",
  sleepSound: "rain",
  sleepMinutes: 30,
  sleepVolume: 45,
  privacyLockEnabled: false,
  privacyAutoLockMinutes: 5,
  privacyLockOnReopen: false,
  biometricEnabled: false
};

let state = structuredClone(defaultState);
let currentView = "home";
let editorMedia = [];
let removedMediaIds = new Set();
let activeJournalCanvasId = null;
let activeJournalCanvasEntryId = null;
let activeScrapbookBookId = null;
let activeScrapbookBook = null;
let scrapbookPageSwitching = false;
let journalCanvasReturnView = "scrapbook";
let journalCanvasSaveTimer = null;
let journalCanvasState = null;
let selectedJournalCanvasItemId = null;
let journalCanvasAssetUrls = new Map();
let journalCanvasMediaUrls = new Map();
let pendingStickerImportFile = null;
let pendingStickerImportPreviewUrl = "";
let pendingStickerProcessedBlob = null;
let pendingStickerProcessedUrl = "";
let stickerImportPreviewToken = 0;
let stickerImportProcessing = false;
let activePhotoViewerId = null;
let moodJarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let editingThreadId = null;
let activeThreadId = null;
let activeBookmarkId = null;
let bookmarkEditorEntryId = null;
let editingLetterId = null;
let editingNightlyId = null;
let moodCheckinSaving = false;
let homeMoodSyncRunning = false;
let pendingHomeMoodSync = "";
let moodPersistenceChain = Promise.resolve();
let moodJarPhysicsFrame = null;
let moodJarOrientationBound = false;
let moodJarOrientationPermissionRequested = false;
let moodJarGravity = { x: 0, y: 0.78 };

const FUWA_NOTIFICATION_PREFS_KEY = "fuwaNotificationPreferencesV1";

const defaultNotificationPreferences = {
  enabled: false,
  time: "20:00",
  style: "rotate"
};

let notificationPreferences = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(FUWA_NOTIFICATION_PREFS_KEY) || "{}");
    return {
      enabled: typeof saved.enabled === "boolean" ? saved.enabled : false,
      time: /^\d{2}:\d{2}$/.test(saved.time || "") ? saved.time : "20:00",
      style: ["rotate","checkin","remember","soft"].includes(saved.style) ? saved.style : "rotate"
    };
  } catch (_) {
    return { ...defaultNotificationPreferences };
  }
})();

function saveNotificationPreferences() {
  try {
    localStorage.setItem(FUWA_NOTIFICATION_PREFS_KEY, JSON.stringify(notificationPreferences));
  } catch (error) {
    console.warn("Fuwa could not save notification preferences.", error);
  }
}

function isStandalonePWA() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
}

function notificationSupported() {
  return "Notification" in window && "serviceWorker" in navigator;
}

function reminderCopy(style = notificationPreferences.style) {
  const rotating = [
    { title: "How was your day? 🌙", body: "Your Fuwa notebook is waiting for today's pages." },
    { title: "One tiny check-in 🌷", body: "Turn a few pages and tuck today into Fuwa." },
    { title: "Your day is waiting ☁️", body: "Finish today’s mood, habits, sleep, and little highlight." },
    { title: "Before the day slips away", body: "Keep one small piece of today." }
  ];

  if (style === "checkin") return { title: "Fuwa is here ☁️", body: "How was your day?" };
  if (style === "remember") return { title: "Anything to remember? 🌷", body: "Keep one small piece of today in Fuwa." };
  if (style === "soft") return { title: "A little moment for yourself ☁️", body: "Your soft little diary is waiting." };

  return rotating[new Date().getDate() % rotating.length];
}

async function showFuwaNotification({ test = false } = {}) {
  if (!notificationSupported()) throw new Error("notifications-unsupported");
  if (Notification.permission !== "granted") throw new Error("notifications-not-granted");

  const registration = await navigator.serviceWorker.ready;
  const copy = reminderCopy();

  await registration.showNotification(
    test ? "Fuwa notification test ☁️" : copy.title,
    {
      body: test ? "Notifications are working on this device." : copy.body,
      icon: "./icon/icon-192.png",
      badge: "./icon/favicon-32.png",
      tag: test ? "fuwa-test-notification" : "fuwa-daily-reminder",
      renotify: false,
      data: { url: "./?view=life" }
    }
  );
}

function refreshNotificationSettingsUI() {
  const supported = notificationSupported();
  const permission = supported ? Notification.permission : "unsupported";
  const standalone = isStandalonePWA();

  const badge = $("notificationPermissionBadge");
  const note = $("notificationSupportNote");
  const toggle = $("dailyReminderToggle");
  const time = $("dailyReminderTime");
  const style = $("dailyReminderStyle");
  const enable = $("enableNotificationsButton");
  const test = $("testNotificationButton");

  if (toggle) toggle.checked = !!notificationPreferences.enabled;
  if (time) time.value = notificationPreferences.time;
  if (style) style.value = notificationPreferences.style;

  if (!supported) {
    if (badge) badge.textContent = "Unavailable";
    if (note) note.textContent = "This browser does not support web notifications.";
    if (enable) enable.disabled = true;
    if (test) test.disabled = true;
    if (toggle) toggle.disabled = true;
    return;
  }

  if (badge) {
    badge.textContent = permission === "granted" ? "Allowed ✓" : permission === "denied" ? "Blocked" : "Not enabled";
  }

  if (note) {
    if (!standalone && /iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      note.textContent = "Install Fuwa to your Home Screen first.";
    } else if (permission === "granted") {
      note.textContent = "Permission is ready. Daily scheduling still needs push delivery.";
    } else if (permission === "denied") {
      note.textContent = "Notifications are blocked in iPhone settings.";
    } else {
      note.textContent = "Tap Enable Notifications when you're ready.";
    }
  }

  if (enable) {
    enable.disabled = permission === "granted";
    enable.textContent = permission === "granted" ? "Notifications Enabled" : "Enable Notifications";
  }

  if (test) test.disabled = permission !== "granted";
}

async function enableFuwaNotifications() {
  if (!notificationSupported()) {
    toast("Notifications aren't supported on this device.");
    return;
  }

  if (/iPhone|iPad|iPod/i.test(navigator.userAgent) && !isStandalonePWA()) {
    window.alert("On iPhone, install Fuwa to your Home Screen first. Then open the installed Fuwa app and enable notifications from Me.");
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      notificationPreferences.enabled = true;
      saveNotificationPreferences();
      toast("Fuwa notifications are enabled ☁️");
    } else if (permission === "denied") {
      notificationPreferences.enabled = false;
      saveNotificationPreferences();
      toast("Notifications are blocked for Fuwa.");
    }
    refreshNotificationSettingsUI();
  } catch (error) {
    console.error("Fuwa notification permission failed.", error);
    toast("Fuwa couldn't enable notifications.");
  }
}

async function sendFuwaTestNotification() {
  try {
    await showFuwaNotification({ test: true });
    toast("Test notification sent ☁️");
  } catch (error) {
    console.error("Fuwa test notification failed.", error);
    toast("Enable notifications first.");
    refreshNotificationSettingsUI();
  }
}

function bindNotificationSettings() {
  refreshNotificationSettingsUI();

  $("enableNotificationsButton")?.addEventListener("click", enableFuwaNotifications);
  $("testNotificationButton")?.addEventListener("click", sendFuwaTestNotification);

  $("dailyReminderToggle")?.addEventListener("change", event => {
    notificationPreferences.enabled = !!event.target.checked;
    saveNotificationPreferences();

    if (notificationPreferences.enabled && Notification.permission !== "granted") {
      enableFuwaNotifications();
    } else {
      refreshNotificationSettingsUI();
    }
  });

  $("dailyReminderTime")?.addEventListener("change", event => {
    if (/^\d{2}:\d{2}$/.test(event.target.value)) {
      notificationPreferences.time = event.target.value;
      saveNotificationPreferences();
      toast(`Reminder preference saved for ${event.target.value}.`);
    }
  });

  $("dailyReminderStyle")?.addEventListener("change", event => {
    notificationPreferences.style = event.target.value;
    saveNotificationPreferences();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshNotificationSettingsUI();
  });
}

const SANCTUARY_PREFS_KEY = "fuwaSanctuaryPreferencesV2";
const SANCTUARY_V3_NEW_OBJECT_IDS = ["desk","blanket","flowers","moon","notes","album"];
const defaultSanctuaryPreferences = {
  version: 3,
  theme: "rose",
  ambience: "auto",
  season: "auto",
  companionName: "Fuwa",
  visibleObjects: ["lamp","plant","books","stars","cushion","tea","garland","frame",...SANCTUARY_V3_NEW_OBJECT_IDS]
};
let sanctuaryPreferences = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(SANCTUARY_PREFS_KEY) || "{}");
    const allowedObjects = defaultSanctuaryPreferences.visibleObjects;
    const savedObjects = Array.isArray(saved.visibleObjects)
      ? saved.visibleObjects.filter(id => allowedObjects.includes(id))
      : [...allowedObjects];
    const upgradedObjects = Number(saved.version) >= 3
      ? savedObjects
      : [...new Set([...savedObjects, ...SANCTUARY_V3_NEW_OBJECT_IDS])];
    return {
      version: 3,
      theme: ["rose","lavender","sky"].includes(saved.theme) ? saved.theme : "rose",
      ambience: ["auto","morning","day","golden","night","rain"].includes(saved.ambience) ? saved.ambience : "auto",
      season: ["auto","spring","summer","autumn","winter"].includes(saved.season) ? saved.season : "auto",
      companionName: typeof saved.companionName === "string" && saved.companionName.trim()
        ? saved.companionName.replace(/[<>]/g, "").trim().slice(0, 18)
        : "Fuwa",
      visibleObjects: upgradedObjects
    };
  } catch (_) {
    return structuredClone(defaultSanctuaryPreferences);
  }
})();
let activeSanctuaryMemoryEntryId = null;
let sanctuaryActivePanel = "memories";
let sanctuaryMemoryShelfOffset = 0;

function saveSanctuaryPreferences() {
  try { localStorage.setItem(SANCTUARY_PREFS_KEY, JSON.stringify(sanctuaryPreferences)); }
  catch (error) { console.warn("Fuwa could not save Sanctuary preferences.", error); }
}

const moodJarPhysicsWorlds = new Map();


// Diary content belongs in IndexedDB. Only these two tiny UI preferences remain
// in localStorage so the content database and display preferences stay separate.
function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "{}");
    return {
      selectedMood: typeof saved.selectedMood === "string" ? saved.selectedMood : defaultState.selectedMood,
      profileName: typeof saved.profileName === "string" && saved.profileName.trim() ? saved.profileName.trim().slice(0, 28) : defaultState.profileName,
      theme: typeof saved.theme === "string" ? saved.theme : defaultState.theme,
      wallpaperEnabled: typeof saved.wallpaperEnabled === "boolean" ? saved.wallpaperEnabled : defaultState.wallpaperEnabled,
      wallpaperOverlay: ["light", "medium", "strong"].includes(saved.wallpaperOverlay) ? saved.wallpaperOverlay : defaultState.wallpaperOverlay,
      sleepSound: typeof saved.sleepSound === "string" ? saved.sleepSound : defaultState.sleepSound,
      sleepMinutes: Number.isFinite(saved.sleepMinutes) ? saved.sleepMinutes : defaultState.sleepMinutes,
      sleepVolume: Number.isFinite(saved.sleepVolume) ? saved.sleepVolume : defaultState.sleepVolume,
      // v49: PIN exists independently from locking. Fuwa only locks when the user taps "Lock Fuwa".
      privacyLockEnabled: false,
      privacyAutoLockMinutes: defaultState.privacyAutoLockMinutes,
      privacyLockOnReopen: false,
      biometricEnabled: typeof saved.biometricEnabled === "boolean" ? saved.biometricEnabled : defaultState.biometricEnabled
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
      profileName: state.profileName,
      theme: state.theme,
      wallpaperEnabled: state.wallpaperEnabled,
      wallpaperOverlay: state.wallpaperOverlay,
      sleepSound: state.sleepSound,
      sleepMinutes: state.sleepMinutes,
      sleepVolume: state.sleepVolume,
      privacyLockEnabled: false,
      privacyAutoLockMinutes: state.privacyAutoLockMinutes,
      privacyLockOnReopen: false,
      biometricEnabled: state.biometricEnabled
    }));
  } catch (error) {
    console.error("Could not save Fuwa preferences.", error);
  }
}

function normalizedProfileName(value) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim().slice(0, 28);
  return cleaned || defaultState.profileName;
}

function renderProfileName() {
  state.profileName = normalizedProfileName(state.profileName);
  if ($("homeGreetingName")) $("homeGreetingName").textContent = state.profileName;
  if ($("profileDisplayName")) $("profileDisplayName").textContent = state.profileName;
}

function editProfileName() {
  const current = normalizedProfileName(state.profileName);
  const value = window.prompt("What should Fuwa call you?", current);
  if (value === null) return;

  const next = normalizedProfileName(value);
  state.profileName = next;
  savePreferences();
  renderProfileName();
  toast(`Fuwa will call you ${next} ☁️`);
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

function announceLocalDataChange(detail = {}) {
  window.dispatchEvent(new CustomEvent("fuwa-local-data-changed", {
    detail: {
      source: "local",
      at: Date.now(),
      ...detail
    }
  }));
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

      const canvasStore = request.transaction.objectStore("journalCanvases");
      if (!canvasStore.indexNames.contains("entryId")) {
        canvasStore.createIndex("entryId", "entryId", { unique: true });
      }
      if (!canvasStore.indexNames.contains("bookId")) {
        canvasStore.createIndex("bookId", "bookId", { unique: false });
      }

      const scrapbookBookStore = request.transaction.objectStore("scrapbookBooks");
      if (!scrapbookBookStore.indexNames.contains("entryId")) {
        scrapbookBookStore.createIndex("entryId", "entryId", { unique: true });
      }

      const scrapbookPhotoStore = request.transaction.objectStore("scrapbookPhotos");
      if (!scrapbookPhotoStore.indexNames.contains("scrapbookId")) {
        scrapbookPhotoStore.createIndex("scrapbookId", "scrapbookId", { unique: false });
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
    if (!LOCAL_ONLY_STORES.has(storeName)) {
      announceLocalDataChange({ action: "save", storeName, recordId: record?.id || null });
    }
  },

  async remove(storeName, id) {
    const transaction = this.db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(id);
    await transactionDone(transaction);
    if (!LOCAL_ONLY_STORES.has(storeName)) {
      announceLocalDataChange({ action: "remove", storeName, recordId: id });
    }
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

  async getScrapbookPhotos(scrapbookId) {
    const transaction = this.db.transaction("scrapbookPhotos", "readonly");
    const store = transaction.objectStore("scrapbookPhotos");
    if (store.indexNames.contains("scrapbookId")) {
      return requestResult(store.index("scrapbookId").getAll(scrapbookId));
    }
    const all = await requestResult(store.getAll());
    return all.filter(record => record.scrapbookId === scrapbookId);
  },

  async saveScrapbookPhotos(records) {
    if (!records?.length) return;
    const transaction = this.db.transaction("scrapbookPhotos", "readwrite");
    const store = transaction.objectStore("scrapbookPhotos");
    records.forEach(record => store.put(record));
    await transactionDone(transaction);
  },

  async getScrapbookBookByEntry(entryId) {
    if (!entryId) return null;
    const transaction = this.db.transaction("scrapbookBooks", "readonly");
    const store = transaction.objectStore("scrapbookBooks");
    if (!store.indexNames.contains("entryId")) return null;
    return requestResult(store.index("entryId").get(entryId));
  },

  async getScrapbookPagesForBook(bookId) {
    if (!bookId) return [];
    const transaction = this.db.transaction("journalCanvases", "readonly");
    const store = transaction.objectStore("journalCanvases");
    if (store.indexNames.contains("bookId")) {
      return requestResult(store.index("bookId").getAll(bookId));
    }
    const all = await requestResult(store.getAll());
    return all.filter(record => record.bookId === bookId);
  },

  async migrateLegacyScrapbookBooks() {
    if (await this.getSetting(SCRAPBOOK_BOOK_MIGRATION_KEY)) return;

    const [pages, existingBooks] = await Promise.all([
      this.getAll("journalCanvases"),
      this.getAll("scrapbookBooks")
    ]);
    const booksById = new Map(existingBooks.map(book => [book.id, structuredClone(book)]));
    const now = Date.now();

    pages.forEach((page, index) => {
      const bookId = page.bookId || `book_${page.id}`;
      const normalizedPage = page.bookId ? page : { ...page, bookId };
      if (!page.bookId) pages[index] = normalizedPage;

      let book = booksById.get(bookId);
      if (!book) {
        book = {
          id: bookId,
          title: page.title || "Scrapbook",
          pages: [],
          createdAt: page.createdAt || now,
          updatedAt: page.updatedAt || page.createdAt || now
        };
        if (page.entryId) book.entryId = page.entryId;
        booksById.set(bookId, book);
      }

      if (!Array.isArray(book.pages)) book.pages = [];
      if (!book.pages.some(meta => meta.id === page.id)) {
        book.pages.push({
          id: page.id,
          title: page.title || `Page ${book.pages.length + 1}`,
          date: page.date || isoToday(),
          background: page.background || "blush",
          createdAt: page.createdAt || now,
          updatedAt: page.updatedAt || page.createdAt || now
        });
      }
      book.updatedAt = Math.max(Number(book.updatedAt || 0), Number(page.updatedAt || page.createdAt || 0));
    });

    for (const book of booksById.values()) {
      book.pages = (book.pages || [])
        .filter(meta => meta?.id)
        .sort((a, b) => Number(a.order ?? a.createdAt ?? 0) - Number(b.order ?? b.createdAt ?? 0))
        .map((meta, order) => ({ ...meta, order }));
    }

    const transaction = this.db.transaction(["journalCanvases", "scrapbookBooks", "settings"], "readwrite");
    const canvasStore = transaction.objectStore("journalCanvases");
    pages.forEach(page => canvasStore.put(page));
    const bookStore = transaction.objectStore("scrapbookBooks");
    booksById.forEach(book => bookStore.put(book));
    transaction.objectStore("settings").put({ key: SCRAPBOOK_BOOK_MIGRATION_KEY, migratedAt: now });
    await transactionDone(transaction);
  },

  async saveScrapbookPageAndBook(page, book, photoRecords = []) {
    const stores = ["journalCanvases", "scrapbookBooks"];
    if (photoRecords?.length) stores.push("scrapbookPhotos");
    const transaction = this.db.transaction(stores, "readwrite");
    transaction.objectStore("journalCanvases").put(page);
    transaction.objectStore("scrapbookBooks").put(book);
    if (photoRecords?.length) {
      const photoStore = transaction.objectStore("scrapbookPhotos");
      photoRecords.forEach(record => photoStore.put(record));
    }
    await transactionDone(transaction);
  },

  async deleteScrapbookPage(scrapbookId) {
    const photos = await this.getScrapbookPhotos(scrapbookId);
    const transaction = this.db.transaction(["journalCanvases", "scrapbookPhotos"], "readwrite");
    transaction.objectStore("journalCanvases").delete(scrapbookId);
    const photoStore = transaction.objectStore("scrapbookPhotos");
    photos.forEach(record => photoStore.delete(record.id));
    await transactionDone(transaction);
  },

  async deleteScrapbookPageAndUpdateBook(scrapbookId, book) {
    const photos = await this.getScrapbookPhotos(scrapbookId);
    const transaction = this.db.transaction(["journalCanvases", "scrapbookPhotos", "scrapbookBooks"], "readwrite");
    transaction.objectStore("journalCanvases").delete(scrapbookId);
    const photoStore = transaction.objectStore("scrapbookPhotos");
    photos.forEach(record => photoStore.delete(record.id));
    transaction.objectStore("scrapbookBooks").put(book);
    await transactionDone(transaction);
  },

  async deleteScrapbookBook(bookId) {
    const book = await this.get("scrapbookBooks", bookId);
    const pageIds = Array.isArray(book?.pages) ? book.pages.map(page => page.id).filter(Boolean) : [];
    const fallbackPages = pageIds.length ? [] : await this.getScrapbookPagesForBook(bookId);
    if (!pageIds.length) fallbackPages.forEach(page => pageIds.push(page.id));
    const photoGroups = await Promise.all(pageIds.map(pageId => this.getScrapbookPhotos(pageId)));
    const transaction = this.db.transaction(["scrapbookBooks", "journalCanvases", "scrapbookPhotos"], "readwrite");
    transaction.objectStore("scrapbookBooks").delete(bookId);
    const canvasStore = transaction.objectStore("journalCanvases");
    pageIds.forEach(pageId => canvasStore.delete(pageId));
    const photoStore = transaction.objectStore("scrapbookPhotos");
    photoGroups.flat().forEach(record => photoStore.delete(record.id));
    await transactionDone(transaction);
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
    announceLocalDataChange({ action: "save-entry", storeName: "entries", recordId: entry?.id || null });
  },

  async deleteEntryWithMedia(entryId) {
    const [mediaRecords, bookmarkRecords, linkedBook, legacyLinkedCanvas] = await Promise.all([
      this.getMediaForEntry(entryId),
      this.getBookmarksForEntry(entryId),
      this.getScrapbookBookByEntry(entryId),
      this.get("journalCanvases", entryId)
    ]);

    const mediaById = new Map(mediaRecords.map(record => [record.id, record]));
    const migratedScrapbookPhotos = [];
    const preservedPages = [];

    let pagesToPreserve = [];
    if (linkedBook?.pages?.length) {
      pagesToPreserve = (await Promise.all(linkedBook.pages.map(meta => this.get("journalCanvases", meta.id)))).filter(Boolean);
    } else if (legacyLinkedCanvas) {
      pagesToPreserve = [legacyLinkedCanvas];
    }

    for (const page of pagesToPreserve) {
      const migratedItems = (page.items || []).map(item => {
        if (item.type !== "photo" || (item.mediaSource && item.mediaSource !== "entry")) return item;
        const source = mediaById.get(item.mediaId);
        if (!source?.blob) return item;
        const newId = uid("scrapphoto");
        migratedScrapbookPhotos.push({
          id: newId,
          scrapbookId: page.id,
          blob: source.blob,
          type: source.type || source.blob.type || "image/jpeg",
          width: source.width || 0,
          height: source.height || 0,
          originalName: source.originalName || "Scrapbook photo",
          createdAt: source.createdAt || Date.now()
        });
        return { ...item, mediaId: newId, mediaSource: "scrapbook" };
      });
      const { entryId: _removedEntryId, ...rest } = page;
      preservedPages.push({
        ...rest,
        items: migratedItems,
        updatedAt: Date.now()
      });
    }

    let preservedBook = null;
    if (linkedBook) {
      const { entryId: _removedBookEntryId, ...rest } = linkedBook;
      preservedBook = {
        ...rest,
        pages: (linkedBook.pages || []).map(meta => {
          const page = preservedPages.find(item => item.id === meta.id);
          return page ? { ...meta, title: page.title || meta.title, background: page.background || meta.background, updatedAt: page.updatedAt } : meta;
        }),
        updatedAt: Date.now()
      };
    }

    const stores = ["entries", "media", "bookmarks", "journalCanvases", "scrapbookPhotos", "scrapbookBooks"];
    const transaction = this.db.transaction(stores, "readwrite");
    transaction.objectStore("entries").delete(entryId);
    const canvasStore = transaction.objectStore("journalCanvases");
    preservedPages.forEach(page => canvasStore.put(page));
    if (preservedBook) transaction.objectStore("scrapbookBooks").put(preservedBook);
    const scrapbookPhotoStore = transaction.objectStore("scrapbookPhotos");
    migratedScrapbookPhotos.forEach(record => scrapbookPhotoStore.put(record));
    const mediaStore = transaction.objectStore("media");
    mediaRecords.forEach(record => mediaStore.delete(record.id));
    const bookmarkStore = transaction.objectStore("bookmarks");
    bookmarkRecords.forEach(record => bookmarkStore.delete(record.id));
    await transactionDone(transaction);
    announceLocalDataChange({ action: "delete-entry", storeName: "entries", recordId: entryId });
  },

  async readCurrentData() {
    const [entries, tinyJoys, letters, moodCheckins, threads, bookmarks, nightlyReflections, thenNow, comfortItems, unsentLetters, thoughtBubbles, dreams, dailyCheckins, lifeCollections, habitDefinitions, moments, randomThoughts] = await Promise.all([
      ...CONTENT_STORES.map(store => this.getAll(store)),
      this.getAll("moodCheckins"),
      this.getAll("threads"),
      this.getAll("bookmarks"),
      this.getAll("nightlyReflections"),
      this.getAll("thenNow"),
      this.getAll("comfortItems"),
      this.getAll("unsentLetters"),
      this.getAll("thoughtBubbles"),
      this.getAll("dreams"),
      this.getAll("dailyCheckins"),
      this.getAll("lifeCollections"),
      this.getAll("habitDefinitions"),
      this.getAll("moments"),
      this.getAll("randomThoughts")
    ]);
    return { entries, tinyJoys, letters, moodCheckins, threads, bookmarks, nightlyReflections, thenNow, comfortItems, unsentLetters, thoughtBubbles, dreams, dailyCheckins, lifeCollections, habitDefinitions, moments, randomThoughts };
  },

  async replaceContent(data, mediaRecords = [], localScrapbookData = null) {
    const stores = [...CONTENT_STORES, "media", "moodCheckins", "threads", "bookmarks", "nightlyReflections", "thenNow", "comfortItems", "unsentLetters", "thoughtBubbles", "dreams", "dailyCheckins", "lifeCollections", "habitDefinitions", "moments", "randomThoughts"];
    if (localScrapbookData) stores.push("journalCanvases", "stickerAssets", "scrapbookPhotos", "scrapbookBooks");
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

    ["thenNow", "comfortItems", "unsentLetters", "thoughtBubbles", "dreams", "dailyCheckins", "lifeCollections", "habitDefinitions", "moments", "randomThoughts"].forEach(storeName => {
      const store = transaction.objectStore(storeName);
      store.clear();
      (data[storeName] || []).forEach(record => store.put(record));
    });

    if (localScrapbookData) {
      const canvasStore = transaction.objectStore("journalCanvases");
      canvasStore.clear();
      (localScrapbookData.journalCanvases || []).forEach(record => canvasStore.put(record));
      const stickerStore = transaction.objectStore("stickerAssets");
      stickerStore.clear();
      (localScrapbookData.stickerAssets || []).forEach(record => stickerStore.put(record));
      const scrapbookPhotoStore = transaction.objectStore("scrapbookPhotos");
      scrapbookPhotoStore.clear();
      (localScrapbookData.scrapbookPhotos || []).forEach(record => scrapbookPhotoStore.put(record));
      const scrapbookBookStore = transaction.objectStore("scrapbookBooks");
      scrapbookBookStore.clear();
      (localScrapbookData.scrapbookBooks || []).forEach(record => scrapbookBookStore.put(record));
    }

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
    announceLocalDataChange({ action: "delete-thread", storeName: "threads", recordId: threadId });
  },

  async clearDiaryData() {
    const stores = [...CONTENT_STORES, "media", "moodCheckins", "threads", "bookmarks", "nightlyReflections", "thenNow", "comfortItems", "unsentLetters", "thoughtBubbles", "dreams", "dailyCheckins", "lifeCollections", "habitDefinitions", "moments", "randomThoughts", "journalCanvases", "stickerAssets", "scrapbookPhotos", "scrapbookBooks"];
    const transaction = this.db.transaction(stores, "readwrite");
    stores.forEach(storeName => transaction.objectStore(storeName).clear());
    await transactionDone(transaction);
    announceLocalDataChange({ action: "clear-diary", storeName: "all" });
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
  const palettes = {
    amazing: ["#fff8fb", "#f6cbd9", "#e894ad"],
    good: ["#fffafb", "#f4d6e0", "#dda0b4"],
    neutral: ["#fffaf3", "#f3dfc2", "#d5ad78"],
    tired: ["#fbf8ff", "#ded4ef", "#a997c8"],
    sad: ["#f8fcff", "#d6e8f5", "#8eb8d8"],
    angry: ["#fff8f7", "#f4d2d0", "#dd9598"]
  };
  const [top, bottom, stroke] = palettes[safeMood];

  const faces = {
    amazing: `<path d="M27 32 Q31 36 35 32" class="mood-eye-line"/><path d="M45 32 Q49 36 53 32" class="mood-eye-line"/><path d="M33 39 Q40 46 47 39" class="mood-mouth-line"/><path d="M61 13 C61 9 67 8 69 12 C71 8 77 9 77 14 C77 18 69 23 69 23 C69 23 61 18 61 13Z" class="mood-heart"/>`,
    good: `<path d="M27 32 Q31 36 35 32" class="mood-eye-line"/><path d="M45 32 Q49 36 53 32" class="mood-eye-line"/><path d="M34 39 Q40 44 46 39" class="mood-mouth-line"/>`,
    neutral: `<circle cx="31" cy="34" r="1.8" class="mood-face-fill"/><circle cx="49" cy="34" r="1.8" class="mood-face-fill"/><path d="M36 41 H44" class="mood-mouth-line"/>`,
    tired: `<path d="M27 34 Q31 31 35 34" class="mood-eye-line"/><path d="M45 34 Q49 31 53 34" class="mood-eye-line"/><path d="M37 41 Q40 39 43 41" class="mood-mouth-line"/><text x="60" y="18" class="mood-z">z</text>`,
    sad: `<circle cx="31" cy="34" r="1.8" class="mood-face-fill"/><circle cx="49" cy="34" r="1.8" class="mood-face-fill"/><path d="M34 43 Q40 37 46 43" class="mood-mouth-line"/><path d="M53 38 C58 43 58 47 54 49 C50 47 50 43 53 38Z" class="mood-tear"/>`,
    angry: `<path d="M26 29 L35 33" class="mood-brow-line"/><path d="M54 29 L45 33" class="mood-brow-line"/><circle cx="31" cy="35" r="1.8" class="mood-face-fill"/><circle cx="49" cy="35" r="1.8" class="mood-face-fill"/><path d="M34 44 Q40 38 46 44" class="mood-mouth-line"/>`
  };

  const gradientId = `mood-grad-${safeMood}-${Math.random().toString(36).slice(2, 7)}`;
  return `<span class="fuwa-mood-svg mood-${safeMood} ${extraClass}" aria-hidden="true"><svg viewBox="0 0 80 56" focusable="false"><defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><path d="M18 48C9 48 4 42 4 34C4 25 10 19 19 19C22 10 30 6 39 7C48 7 54 13 56 20C66 19 75 26 75 35C75 43 69 48 60 48Z" fill="url(#${gradientId})" stroke="${stroke}" stroke-width="1.7"/><ellipse cx="24" cy="39" rx="4" ry="2.2" class="mood-cheek-svg"/><ellipse cx="56" cy="39" rx="4" ry="2.2" class="mood-cheek-svg"/>${faces[safeMood]}</svg></span>`;
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

  try {
    if (localStorage.getItem("fuwaPhotoLocalOnlyNoticeV1") !== "seen") {
      window.alert("Photo reminder: attached photos stay on this device and are not included in Fuwa Cloud backup. For important photos, open the photo in Fuwa and use Save Photo to keep a separate copy in your Photos library.");
      localStorage.setItem("fuwaPhotoLocalOnlyNoticeV1", "seen");
    }
  } catch (_) {}

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
  activePhotoViewerId = id;
  $("photoViewerImage").src = item.previewUrl;
  $("photoViewer").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closePhotoViewer() {
  activePhotoViewerId = null;
  $("photoViewer").classList.add("hidden");
  $("photoViewerImage").removeAttribute("src");
  document.body.style.overflow = "";
  maybeShowDailyMoodCheckin();
}

function safePhotoFilename(item) {
  const original = String(item?.originalName || "").trim();
  const stem = original ? original.replace(/\.[^.]+$/, "") : `fuwa-photo-${isoToday()}`;
  const cleaned = stem.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || `fuwa-photo-${isoToday()}`;
  return `${cleaned}.jpg`;
}

async function saveActivePhotoToDevice() {
  const item = editorMedia.find(photo => photo.id === activePhotoViewerId);
  if (!item?.blob) {
    toast("Fuwa couldn't find that photo.");
    return;
  }

  const filename = safePhotoFilename(item);
  const file = new File([item.blob], filename, { type: item.type || item.blob.type || "image/jpeg" });

  try {
    // iOS PWAs generally expose Photos through the native share sheet rather
    // than granting a website direct write access to the Photos library.
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({
        files: [file],
        title: "Fuwa photo"
      });
      toast("Choose Save Image to keep it in Photos.");
      return;
    }

    const url = URL.createObjectURL(item.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast("Photo prepared for saving.");
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.error("Could not save Fuwa photo.", error);
    toast("Fuwa couldn't open the save options for that photo.");
  }
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


function validateScrapbookBackupArray(value, name, { withDataUrl = false } = {}) {
  if (value === undefined) return null;
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  const ids = new Set();
  value.forEach(record => {
    if (!record || typeof record.id !== "string" || !record.id) throw new Error(`${name} contains an invalid record`);
    if (ids.has(record.id)) throw new Error(`${name} contains duplicate IDs`);
    ids.add(record.id);
    if (withDataUrl && typeof record.dataUrl !== "string") throw new Error(`${name} record is missing image data`);
  });
  return value;
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

function safeThreadIcon(value) {
  const raw = String(value || "").trim();
  if (!raw) return "🧵";

  // Thread icons are meant to be a single visual symbol, not a word.
  // If older data contains text (for example "Something"), fall back cleanly.
  if (/^[A-Za-z0-9]/.test(raw)) return "🧵";

  try {
    if (Intl?.Segmenter) {
      const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      const first = [...segmenter.segment(raw)][0]?.segment;
      return first || "🧵";
    }
  } catch (_) {}

  return Array.from(raw)[0] || "🧵";
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
      <span>${escapeHtml(safeThreadIcon(thread.emoji))}</span>
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
      ${swipeActionShell(`<article class="thread-card">
        <button class="thread-card-main" type="button" data-thread-open="${escapeHtml(thread.id)}">
          <span class="thread-card-emoji">${escapeHtml(safeThreadIcon(thread.emoji))}</span>
          <div>
            <h3>${escapeHtml(thread.title)}</h3>
            <p>${escapeHtml(thread.description || "An ongoing story in your life.")}</p>
            <small>${entries.length} ${entries.length === 1 ? "memory" : "memories"} · ${escapeHtml(range)}</small>
          </div>
        </button>
      </article>`, "thread", thread.id)}`;
  }).join("");
  grid.querySelectorAll("[data-thread-open]").forEach(button => button.addEventListener("click", () => openThreadDetail(button.dataset.threadOpen)));
  bindSwipeActions(grid);
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
      <span>${escapeHtml(safeThreadIcon(thread.emoji))} ${escapeHtml(thread.title)}</span>
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
  $("threadEmojiInput").value = safeThreadIcon(thread?.emoji);
  $("threadEmojiPreview").textContent = safeThreadIcon(thread?.emoji);
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
    emoji: safeThreadIcon($("threadEmojiInput").value),
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
    <div class="thread-detail-icon">${escapeHtml(safeThreadIcon(thread.emoji))}</div>
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
    return thread ? `<span class="tag thread-tag">${escapeHtml(safeThreadIcon(thread.emoji))} ${escapeHtml(thread.title)}</span>` : "";
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
  return [
    collectionSignature(state.entries), collectionSignature(state.moodCheckins),
    collectionSignature(state.nightlyReflections), collectionSignature(state.dreams),
    collectionSignature(state.thoughtBubbles), collectionSignature(state.tinyJoys),
    collectionSignature(state.comfortItems), sanctuaryPreferences.theme,
    [...sanctuaryPreferences.visibleObjects].sort().join(",")
  ].join("|");
}


function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function hashPrivacyPin(pin, saltBytes) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: 120000,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );

  return bytesToBase64(new Uint8Array(bits));
}

async function getPrivacyCredential() {
  return diaryRepository.getSetting("privacy-pin");
}

async function savePrivacyCredential(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPrivacyPin(pin, salt);
  await diaryRepository.saveSetting({
    key: "privacy-pin",
    salt: bytesToBase64(salt),
    hash,
    updatedAt: Date.now()
  });
}

async function verifyPrivacyPin(pin) {
  const credential = await getPrivacyCredential();
  if (!credential?.salt || !credential?.hash) return false;
  const salt = base64ToBytes(credential.salt);
  const hash = await hashPrivacyPin(pin, salt);
  return hash === credential.hash;
}

function focusPinInput(inputId) {
  const input = $(inputId);
  if (!input) return;
  try {
    input.focus({ preventScroll: true });
  } catch (_) {
    input.focus();
  }
}

function renderPinDots(inputId, dotsId) {
  const input = $(inputId);
  const dots = $(dotsId);
  if (!input || !dots) return;
  const length = input.value.length;
  [...dots.children].forEach((dot, index) => {
    dot.classList.toggle("filled", index < length);
    dot.classList.toggle("unused", index >= Math.max(4, length) && index >= 4);
  });
}

function openPrivacyPinSetup({ lockAfterSetup = false } = {}) {
  privacyLockAfterPinSetup = !!lockAfterSetup;
  privacySetupStage = "new";
  privacyFirstPin = "";
  $("privacyPinTitle").textContent = "Set Fuwa PIN";
  $("privacyPinHelp").textContent = "Choose a 4–6 digit PIN.";
  $("privacyPinInput").value = "";
  renderPinDots("privacyPinInput", "privacyPinDots");
  $("privacyPinModal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  focusPinInput("privacyPinInput");
  setTimeout(() => focusPinInput("privacyPinInput"), 120);
}

function closePrivacyPinSetup() {
  $("privacyPinModal").classList.add("hidden");
  document.body.style.overflow = privacyIsLocked ? "hidden" : "";
  privacySetupStage = "new";
  privacyFirstPin = "";
  privacyLockAfterPinSetup = false;
  $("privacyPinInput").value = "";
}

async function handlePrivacyPinSetup(event) {
  event.preventDefault();
  const pin = $("privacyPinInput").value.trim();

  if (!/^\d{4,6}$/.test(pin)) {
    $("privacyPinHelp").textContent = "Use 4–6 numbers only.";
    return;
  }

  if (privacySetupStage === "new") {
    privacyFirstPin = pin;
    privacySetupStage = "confirm";
    $("privacyPinTitle").textContent = "Confirm Fuwa PIN";
    $("privacyPinHelp").textContent = "Enter the same PIN one more time.";
    $("privacyPinInput").value = "";
    renderPinDots("privacyPinInput", "privacyPinDots");
    focusPinInput("privacyPinInput");
    return;
  }

  if (pin !== privacyFirstPin) {
    privacySetupStage = "new";
    privacyFirstPin = "";
    $("privacyPinTitle").textContent = "Set Fuwa PIN";
    $("privacyPinHelp").textContent = "Those didn't match. Choose your PIN again.";
    $("privacyPinInput").value = "";
    renderPinDots("privacyPinInput", "privacyPinDots");
    return;
  }

  try {
    $("privacyPinSubmit").disabled = true;
    $("privacyPinSubmit").textContent = "Saving…";
    await savePrivacyCredential(pin);
    // Save the PIN, but do not turn on automatic/reopen locking.
    state.privacyLockEnabled = false;
    state.privacyLockOnReopen = false;
    savePreferences();
    const shouldLockNow = privacyLockAfterPinSetup;
    closePrivacyPinSetup();
    renderPrivacySettings();
    if (shouldLockNow) {
      setTimeout(() => lockFuwa("manual"), 80);
    } else {
      toast("Fuwa lock is ready 🔒");
    }
  } catch (error) {
    console.error("Could not save privacy PIN.", error);
    $("privacyPinHelp").textContent = "Fuwa couldn't save the PIN on this device.";
  } finally {
    $("privacyPinSubmit").disabled = false;
    $("privacyPinSubmit").textContent = "Continue";
  }
}

async function detectBiometricAvailability() {
  privacyBiometricAvailable = false;
  try {
    if (
      window.PublicKeyCredential &&
      typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function"
    ) {
      privacyBiometricAvailable = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
  } catch (error) {
    console.info("Platform authenticator check unavailable.", error);
  }

  $("biometricSettingRow")?.classList.toggle("hidden", !privacyBiometricAvailable);
  renderPrivacySettings();
}

function renderPrivacySettings() {
  if (!$("privacyLockToggle")) return;
  $("privacyLockToggle").checked = !!state.privacyLockEnabled;
  $("privacyReopenToggle").checked = !!state.privacyLockOnReopen;
  $("privacyAutoLockSelect").value = String(state.privacyAutoLockMinutes);
  $("biometricToggle").checked = !!state.biometricEnabled;
  $("biometricSettingRow")?.classList.toggle("hidden", !privacyBiometricAvailable);

  const biometricButton = $("unlockBiometricButton");
  if (biometricButton) {
    biometricButton.classList.toggle("hidden", !(privacyBiometricAvailable && state.biometricEnabled));
  }
}

async function enableOrDisablePrivacyLock() {
  const shouldEnable = $("privacyLockToggle").checked;

  if (shouldEnable) {
    const credential = await getPrivacyCredential();
    if (!credential?.hash) {
      $("privacyLockToggle").checked = false;
      openPrivacyPinSetup();
      return;
    }
  }

  state.privacyLockEnabled = shouldEnable;
  savePreferences();
  renderPrivacySettings();
}

function shouldPrivacyAutoLock() {
  if (!state.privacyLockEnabled) return false;
  if (privacyIsLocked) return false;

  const elapsedMs = Date.now() - privacyLastActiveAt;
  const minutes = Number(state.privacyAutoLockMinutes) || 0;

  if (minutes === 0) return elapsedMs > 1500;
  return elapsedMs >= minutes * 60000;
}

function lockFuwa(reason = "manual") {
  if (!["manual", "quick-hide"].includes(reason) && !state.privacyLockEnabled) return;

  privacyIsLocked = true;
  $("privacyLockScreen").classList.remove("hidden");
  $("unlockPinInput").value = "";
  $("privacyUnlockError").classList.add("hidden");
  renderPinDots("unlockPinInput", "unlockDots");
  renderPrivacySettings();

  document.body.classList.add("privacy-locked");
  document.body.style.overflow = "hidden";

  focusPinInput("unlockPinInput");
  setTimeout(() => focusPinInput("unlockPinInput"), 120);
}

function unlockFuwaSuccess() {
  privacyIsLocked = false;
  privacyLastActiveAt = Date.now();
  $("privacyLockScreen").classList.add("hidden");
  $("unlockPinInput").value = "";
  $("privacyUnlockError").classList.add("hidden");
  document.body.classList.remove("privacy-locked");
  document.body.style.overflow = "";
}

async function unlockWithPin() {
  const pin = $("unlockPinInput").value.trim();
  if (!/^\d{4,6}$/.test(pin)) {
    $("privacyUnlockError").textContent = "Enter your 4–6 digit PIN.";
    $("privacyUnlockError").classList.remove("hidden");
    return;
  }

  try {
    $("unlockPinButton").disabled = true;
    const valid = await verifyPrivacyPin(pin);
    if (valid) {
      unlockFuwaSuccess();
    } else {
      $("privacyUnlockError").textContent = "That PIN didn't match.";
      $("privacyUnlockError").classList.remove("hidden");
      $("unlockPinInput").value = "";
      renderPinDots("unlockPinInput", "unlockDots");
      $("unlockPinInput").focus();
    }
  } catch (error) {
    console.error("Could not verify privacy PIN.", error);
    $("privacyUnlockError").textContent = "Fuwa couldn't verify the PIN right now.";
    $("privacyUnlockError").classList.remove("hidden");
  } finally {
    $("unlockPinButton").disabled = false;
  }
}

async function registerBiometricCredential() {
  if (!privacyBiometricAvailable) return false;

  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "Fuwa" },
        user: {
          id: userId,
          name: "fuwa-local-user",
          displayName: "Fuwa"
        },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred"
        },
        timeout: 60000,
        attestation: "none"
      }
    });

    if (!credential) return false;

    await diaryRepository.saveSetting({
      key: "privacy-biometric",
      credentialId: bytesToBase64(new Uint8Array(credential.rawId)),
      createdAt: Date.now()
    });

    return true;
  } catch (error) {
    console.info("Biometric registration did not complete.", error);
    return false;
  }
}

async function tryBiometricUnlock() {
  if (!privacyBiometricAvailable || !state.biometricEnabled) return;

  const saved = await diaryRepository.getSetting("privacy-biometric");
  if (!saved?.credentialId) {
    toast("Set up Face ID / device unlock first.");
    return;
  }

  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const credentialId = base64ToBytes(saved.credentialId);

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{
          id: credentialId,
          type: "public-key",
          transports: ["internal"]
        }],
        userVerification: "required",
        timeout: 60000
      }
    });

    if (assertion) unlockFuwaSuccess();
  } catch (error) {
    console.info("Biometric unlock was cancelled or unavailable.", error);
  }
}

async function toggleBiometric() {
  const desired = $("biometricToggle").checked;

  if (desired) {
    const ok = await registerBiometricCredential();
    if (!ok) {
      $("biometricToggle").checked = false;
      state.biometricEnabled = false;
      savePreferences();
      toast("Device unlock couldn't be set up here.");
      return;
    }
  } else {
    await diaryRepository.removeSetting("privacy-biometric");
  }

  state.biometricEnabled = desired;
  savePreferences();
  renderPrivacySettings();
}

function updatePrivacyActivity() {
  if (!privacyIsLocked && !quickHideActive) privacyLastActiveAt = Date.now();
}

function handleVisibilityPrivacy() {
  // v49: opening, refreshing, backgrounding, or returning to Fuwa never locks it.
  // A lock appears only after the user explicitly chooses "Lock Fuwa".
  if (document.visibilityState === "hidden") privacyLastActiveAt = Date.now();
}

function installPrivacyActivityWatch() {
  ["pointerdown", "keydown", "scroll", "touchstart"].forEach(type => {
    document.addEventListener(type, updatePrivacyActivity, { passive: true });
  });

  document.addEventListener("visibilitychange", handleVisibilityPrivacy);
  window.addEventListener("pagehide", () => {
    privacyLastActiveAt = Date.now();
  });
}

async function lockFuwaFromDrawer() {
  const credential = await getPrivacyCredential();

  if (!credential?.hash) {
    openPrivacyPinSetup({ lockAfterSetup: true });
    return;
  }

  // Manual lock only. Do not persist automatic locking.
  state.privacyLockEnabled = false;
  state.privacyLockOnReopen = false;
  savePreferences();
  renderPrivacySettings();
  lockFuwa("manual");
}

function quickHideFuwa() {
  lockFuwaFromDrawer();
}

function exitQuickHide() {
  // Retained for backwards compatibility only.
  // v47 no longer uses a tap-to-return privacy cover.
}


const COMFORT_TYPES = Object.freeze({
  reminder: { label: "Reminder", icon: "☁️" },
  quote: { label: "Quote", icon: "❝" },
  place: { label: "Place", icon: "📍" },
  person: { label: "Person", icon: "💗" },
  memory: { label: "Memory", icon: "🌸" },
  "looking-forward": { label: "Looking Forward To", icon: "✨" }
});

function comfortTypeMeta(type) {
  return COMFORT_TYPES[type] || { label: type || "Comfort", icon: "♡" };
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
        <select id="featureType">${Object.entries(COMFORT_TYPES).map(([value, meta]) => `<option value="${escapeHtml(value)}">${escapeHtml(meta.icon)} ${escapeHtml(meta.label)}</option>`).join("")}</select>
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


function swipeActionShell(content, type, id, options = {}) {
  const safeType = escapeHtml(type);
  const safeId = escapeHtml(id);
  const editLabel = escapeHtml(options.editLabel || "Edit");
  const deleteLabel = escapeHtml(options.deleteLabel || "Delete");
  return `
    <div class="fuwa-swipe-row" data-swipe-type="${safeType}" data-swipe-id="${safeId}">
      <div class="fuwa-swipe-actions fuwa-swipe-actions-left" aria-hidden="true">
        <button class="fuwa-swipe-action edit" type="button" data-swipe-edit="${safeType}:${safeId}">${editLabel}</button>
      </div>
      <div class="fuwa-swipe-actions fuwa-swipe-actions-right" aria-hidden="true">
        <button class="fuwa-swipe-action delete" type="button" data-swipe-delete="${safeType}:${safeId}">${deleteLabel}</button>
      </div>
      <div class="fuwa-swipe-content">${content}</div>
    </div>`;
}

function closeOtherSwipeRows(activeRow = null) {
  document.querySelectorAll(".fuwa-swipe-row.is-open-left, .fuwa-swipe-row.is-open-right").forEach(row => {
    if (row === activeRow) return;
    row.classList.remove("is-open-left", "is-open-right");
    const content = row.querySelector(".fuwa-swipe-content");
    if (content) content.style.transform = "";
  });
}

function parseSwipeAction(value = "") {
  const separator = value.indexOf(":");
  if (separator < 0) return { type: "", id: "" };
  return { type: value.slice(0, separator), id: value.slice(separator + 1) };
}

async function editSimpleTextRecord(type, id) {
  const config = {
    tinyJoy: { store: "tinyJoys", stateKey: "tinyJoys", field: "text", label: "Edit Tiny Joy" },
    bubble: { store: "thoughtBubbles", stateKey: "thoughtBubbles", field: "text", label: "Edit Thought Bubble" }
  }[type];
  if (!config) return;

  const item = state[config.stateKey].find(record => record.id === id);
  if (!item) return;

  const next = window.prompt(config.label, item[config.field] || "");
  if (next === null) return;
  const value = next.trim();
  if (!value) return toast("Keep a little text here, or swipe left to delete it.");

  const updated = { ...item, [config.field]: value, updatedAt: Date.now() };
  await diaryRepository.save(config.store, updated);
  state[config.stateKey] = state[config.stateKey].map(record => record.id === id ? updated : record);
  renderAll();
  toast("Updated softly ☁️");
}

function openLetterEditor(letterId) {
  const letter = state.letters.find(item => item.id === letterId);
  if (!letter) return;
  editingLetterId = letter.id;
  $("letterTitle").value = letter.title || "";
  $("letterBody").value = letter.body || "";
  $("letterOpenDate").value = letter.openDate || isoToday();
  $("letterComposer").classList.remove("hidden");
  $("letterTitle")?.focus();
}

function openNightlyReflectionEditor(id) {
  const item = state.nightlyReflections.find(record => record.id === id);
  if (!item) return;
  editingNightlyId = item.id;
  $("nightlyGrateful").value = item.grateful || "";
  $("nightlyRelease").value = item.release || "";
  $("nightlyTomorrow").value = item.tomorrow || "";
  renderNightlyHistory();
  navigate("nightly");
}

async function handleSwipeEdit(type, id) {
  closeOtherSwipeRows();
  try {
    if (type === "entry") return openEditor(id);
    if (type === "thread") return openThreadModal(id);
    if (type === "bookmark") return openBookmarkDetail(id);
    if (type === "thenNow") return openFeatureModal("thenNow", id);
    if (type === "comfort") return openFeatureModal("comfort", id);
    if (type === "unsent") return openFeatureModal("unsent", id);
    if (type === "dream") return openFeatureModal("dream", id);
    if (type === "letter") return openLetterEditor(id);
    if (type === "nightly") return openNightlyReflectionEditor(id);
    if (type === "tinyJoy" || type === "bubble") return editSimpleTextRecord(type, id);
  } catch (error) {
    console.error("Fuwa swipe edit failed.", error);
    toast("Fuwa couldn't open that item for editing.");
  }
}

async function deleteSwipeRecord(type, id) {
  const config = {
    tinyJoy: { store: "tinyJoys", stateKey: "tinyJoys", name: "Tiny Joy" },
    letter: { store: "letters", stateKey: "letters", name: "letter" },
    nightly: { store: "nightlyReflections", stateKey: "nightlyReflections", name: "wind-down" },
    thenNow: { store: "thenNow", stateKey: "thenNow", name: "Then & Now reflection" },
    comfort: { store: "comfortItems", stateKey: "comfortItems", name: "comfort item" },
    unsent: { store: "unsentLetters", stateKey: "unsentLetters", name: "unsent letter" },
    bubble: { store: "thoughtBubbles", stateKey: "thoughtBubbles", name: "thought bubble" },
    dream: { store: "dreams", stateKey: "dreams", name: "dream" },
    bookmark: { store: "bookmarks", stateKey: "bookmarks", name: "bookmark" }
  }[type];

  if (type === "entry") {
    if (!confirm("Delete this diary entry?")) return;
    await diaryRepository.deleteEntryWithMedia(id);
    state.entries = state.entries.filter(item => item.id !== id);
    renderAll();
    toast("Entry deleted");
    return;
  }

  if (type === "thread") {
    const thread = state.threads.find(item => item.id === id);
    if (!thread || !confirm(`Delete "${thread.title}"? Your diary entries will stay safe.`)) return;
    await diaryRepository.deleteThreadAndUnlink(id);
    state.threads = state.threads.filter(item => item.id !== id);
    state.entries = state.entries.map(entry => ({
      ...entry,
      threadIds: Array.isArray(entry.threadIds) ? entry.threadIds.filter(threadId => threadId !== id) : []
    }));
    renderAll();
    toast("Thread removed. Your memories are still here.");
    return;
  }

  if (!config) return;
  if (!confirm(`Delete this ${config.name}?`)) return;

  await diaryRepository.remove(config.store, id);
  state[config.stateKey] = state[config.stateKey].filter(item => item.id !== id);

  if (type === "bookmark" && activeBookmarkId === id) activeBookmarkId = null;
  if (type === "nightly" && editingNightlyId === id) editingNightlyId = null;
  if (type === "letter" && editingLetterId === id) editingLetterId = null;

  renderAll();
  toast("Deleted");
}

function bindSwipeActions(container) {
  if (!container) return;

  container.querySelectorAll(".fuwa-swipe-row").forEach(row => {
    const content = row.querySelector(".fuwa-swipe-content");
    if (!content) return;

    let startX = 0;
    let startY = 0;
    let deltaX = 0;
    let dragging = false;
    let horizontal = false;
    const maxReveal = 92;

    const resetInline = () => {
      content.style.transition = "";
      content.style.transform = "";
    };

    row.addEventListener("pointerdown", event => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (event.target.closest(".fuwa-swipe-action")) return;
      closeOtherSwipeRows(row);
      startX = event.clientX;
      startY = event.clientY;
      deltaX = 0;
      dragging = true;
      horizontal = false;
      content.style.transition = "none";
      try { row.setPointerCapture(event.pointerId); } catch (_) {}
    });

    row.addEventListener("pointermove", event => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;

      if (!horizontal) {
        if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          dragging = false;
          row.classList.remove("is-swiping");
          resetInline();
          return;
        }
        horizontal = true;
        row.classList.add("is-swiping");
      }

      deltaX = Math.max(-maxReveal, Math.min(maxReveal, dx));
      content.style.transform = `translate3d(${deltaX}px,0,0)`;
    });

    const finish = () => {
      if (!dragging && !horizontal) return;
      dragging = false;
      content.style.transition = "";

      const threshold = 42;
      row.classList.remove("is-swiping", "is-open-left", "is-open-right");

      if (deltaX <= -threshold) {
        row.classList.add("is-open-left");
        content.style.transform = `translate3d(-${maxReveal}px,0,0)`;
      } else if (deltaX >= threshold) {
        row.classList.add("is-open-right");
        content.style.transform = `translate3d(${maxReveal}px,0,0)`;
      } else {
        content.style.transform = "";
      }

      window.setTimeout(() => {
        content.style.transition = "";
      }, 370);
    };

    row.addEventListener("pointerup", finish);
    row.addEventListener("pointercancel", finish);
  });

  container.querySelectorAll("[data-swipe-edit]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      const { type, id } = parseSwipeAction(button.dataset.swipeEdit);
      handleSwipeEdit(type, id);
    });
  });

  container.querySelectorAll("[data-swipe-delete]").forEach(button => {
    button.addEventListener("click", async event => {
      event.stopPropagation();
      const { type, id } = parseSwipeAction(button.dataset.swipeDelete);
      try {
        await deleteSwipeRecord(type, id);
      } catch (error) {
        console.error("Fuwa swipe delete failed.", error);
        toast("Fuwa couldn't delete that item.");
      }
    });
  });
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
    return swipeActionShell(`<article class="feature-card"><span>${escapeHtml(formatDate(item.date))} · ${escapeHtml(label)}</span><strong>${escapeHtml(entry?.title || "Past memory")}</strong><p>${escapeHtml(item.response || "")}</p></article>`, "thenNow", item.id);
  }).join("") : "";
  bindSwipeActions(history);
}

function renderComfort() {
  const list = $("comfortList");
  if (!list) return;
  const items = [...state.comfortItems].sort((a,b) => b.updatedAt - a.updatedAt);
  list.innerHTML = items.length ? items.map(item => {
    const meta = comfortTypeMeta(item.type);
    return swipeActionShell(`<article class="feature-card comfort-item-card">
      <span>${escapeHtml(meta.icon)} ${escapeHtml(meta.label)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.body || "")}</p>
    </article>`, "comfort", item.id);
  }).join("") : `<div class="empty-state">Add little things that make life feel softer—or something lovely you are looking forward to.</div>`;
  bindSwipeActions(list);
}

function randomComfort() {
  const host = $("comfortSpotlight");
  if (!state.comfortItems.length) {
    host.innerHTML = `<div class="empty-state compact">Add something comforting first.</div>`;
    return;
  }
  const item = state.comfortItems[Math.floor(Math.random()*state.comfortItems.length)];
  const meta = comfortTypeMeta(item.type);
  host.innerHTML = `<div class="comfort-spotlight"><span>${escapeHtml(meta.icon)} ${escapeHtml(meta.label)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body || "")}</p></div>`;
}

function renderUnsent() {
  const host = $("unsentList");
  if (!host) return;
  const items = [...state.unsentLetters].sort((a,b)=>b.updatedAt-a.updatedAt);
  host.innerHTML = items.length ? items.map(item => `
    ${swipeActionShell(`<article class="feature-card unsent-card"><span>${escapeHtml(formatDate(item.date))}</span><strong>To ${escapeHtml(item.to)}</strong><p>${escapeHtml(item.body.slice(0,220))}${item.body.length>220?"…":""}</p></article>`, "unsent", item.id)}
  `).join("") : `<div class="empty-state">Some words are meant to be written, not sent.</div>`;
  bindSwipeActions(host);
}

async function saveThoughtBubble(event) {
  event.preventDefault();
  const input = $("bubbleInput");
  const text = input.value.trim();
  if (!text) return;
  const now = Date.now();
  const record = { id:uid("bubble"), text, date:isoToday(), releasedAt:null, createdAt:now, updatedAt:now };
  await diaryRepository.save("thoughtBubbles", record);
  state.thoughtBubbles.push(record);
  input.value = "";
  renderBubbles();
  toast("Thought kept floating 💭");
}

async function toggleThoughtBubbleFloating(id) {
  const item = state.thoughtBubbles.find(record => record.id === id);
  if (!item) return;
  const floating = !item.releasedAt;
  const updated = {
    ...item,
    releasedAt: floating ? Date.now() : null,
    updatedAt: Date.now()
  };
  try {
    await diaryRepository.save("thoughtBubbles", updated);
    state.thoughtBubbles = state.thoughtBubbles.map(record => record.id === id ? updated : record);
    renderBubbles();
    if (floating) {
      $("bubbleSpotlight").innerHTML = "";
      toast("Released softly ☁️");
    } else {
      toast("This thought can float back again 💭");
    }
  } catch (error) {
    console.error("Could not update Thought Bubble state.", error);
    toast("Fuwa couldn't update that bubble.");
  }
}

function renderBubbles() {
  const host = $("bubbleList");
  if (!host) return;
  const items = [...state.thoughtBubbles]
    .sort((a,b) => {
      const aReleased = a.releasedAt ? 1 : 0;
      const bReleased = b.releasedAt ? 1 : 0;
      if (aReleased !== bReleased) return aReleased - bReleased;
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    })
    .slice(0,60);

  host.innerHTML = items.length ? items.map(item => {
    const released = !!item.releasedAt;
    return swipeActionShell(`<div class="thought-bubble${released ? " released" : ""}">
      <div class="thought-bubble-meta">
        <span>${escapeHtml(formatDate(item.date))}</span>
        <em>${released ? "Released" : "Floating"}</em>
      </div>
      <p>${escapeHtml(item.text)}</p>
      <button class="thought-bubble-state" type="button" data-bubble-toggle="${escapeHtml(item.id)}">${released ? "Float again" : "Release"}</button>
    </div>`, "bubble", item.id);
  }).join("") : `<div class="empty-state">Put something here when you want Fuwa to hold onto a thought and bring it back later.</div>`;

  bindSwipeActions(host);
  host.querySelectorAll("[data-bubble-toggle]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      toggleThoughtBubbleFloating(button.dataset.bubbleToggle);
    });
  });
}

function randomBubble() {
  const host = $("bubbleSpotlight");
  const floating = state.thoughtBubbles.filter(item => !item.releasedAt);
  if (!floating.length) {
    host.innerHTML = `<div class="empty-state compact">${state.thoughtBubbles.length ? "All your Thought Bubbles have been released." : "No bubbles to float back yet."}</div>`;
    return;
  }
  const item = floating[Math.floor(Math.random()*floating.length)];
  host.innerHTML = `<div class="bubble-spotlight"><span>A thought floated back · ${escapeHtml(formatDate(item.date))}</span><p>“${escapeHtml(item.text)}”</p></div>`;
}

function renderDreams() {
  const host = $("dreamList");
  if (!host) return;
  const items = [...state.dreams].sort((a,b)=>b.date.localeCompare(a.date));
  host.innerHTML = items.length ? items.map(item => swipeActionShell(`<article class="feature-card dream-card"><span>${escapeHtml(formatDate(item.date))} · ${escapeHtml(item.feeling)}${item.recurring?" · recurring":""}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.body.slice(0,220))}${item.body.length>220?"…":""}</p></article>`, "dream", item.id)).join("") : `<div class="empty-state">Catch your next dream here before morning steals it.</div>`;
  bindSwipeActions(host);
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

const SANCTUARY_STAGES = [
  { min:0, name:"A Quiet Corner", copy:"The room is here. It does not need anything from you." },
  { min:8, name:"A Soft Glow", copy:"A little warmth has begun to collect here." },
  { min:20, name:"A Lived-In Nook", copy:"Small traces of your days are starting to stay." },
  { min:40, name:"A Story Room", copy:"The room has learned how to hold your stories." },
  { min:70, name:"A Dreamy Hideaway", copy:"There is enough of you here for the room to feel familiar." },
  { min:110, name:"A Gentle Home", copy:"Fuwa has become somewhere your days know how to return to." },
  { min:170, name:"Your Sanctuary", copy:"This room has grown around the life you have been leaving here." }
];

const SANCTUARY_OBJECTS = [
  { id:"lamp", min:8, label:"Warm lamp", memory:"nightly" },
  { id:"plant", min:20, label:"Little plant", memory:"joy" },
  { id:"books", min:40, label:"Story shelf", memory:"entry" },
  { id:"stars", min:70, label:"Star lights", memory:"dream" },
  { id:"cushion", min:90, label:"Soft cushion", memory:"comfort" },
  { id:"tea", min:110, label:"Tea corner", memory:"mood" },
  { id:"garland", min:140, label:"Paper garland", memory:"bubble" },
  { id:"frame", min:170, label:"Memory frame", memory:"entry" }
];

function sanctuaryMomentCount() {
  return state.entries.length + state.moodCheckins.length + state.nightlyReflections.length +
    state.dreams.length + state.thoughtBubbles.length + state.tinyJoys.length + state.comfortItems.length;
}
function sanctuaryStageIndex(total=sanctuaryMomentCount()) {
  let index=0; SANCTUARY_STAGES.forEach((stage,i)=>{ if(total>=stage.min) index=i; }); return index;
}
function sanctuaryLevel() { return sanctuaryStageIndex()+1; }
function sanctuaryObjectUnlocked(object,total=sanctuaryMomentCount()) { return total>=object.min; }
function sanctuaryObjectVisible(object,total=sanctuaryMomentCount()) {
  return sanctuaryObjectUnlocked(object,total) && sanctuaryPreferences.visibleObjects.includes(object.id);
}

function sanctuaryMemoryFor(type) {
  const choose = items => items.length ? items[Math.floor(Math.random()*items.length)] : null;
  if(type==="entry"){ const x=choose(state.entries); return x?{label:"A page from your room",title:x.title||"A memory",text:memoryDriftPreviewText(x,260),entryId:x.id,icon:"book"}:null; }
  if(type==="nightly"){ const x=choose(state.nightlyReflections); return x?{label:"A quiet night",title:formatDate(x.date),text:x.grateful||x.release||x.tomorrow||"",icon:"lamp"}:null; }
  if(type==="dream"){ const x=choose(state.dreams); return x?{label:"A dream that stayed",title:x.title||"Dream Pocket",text:x.body||"",icon:"star"}:null; }
  if(type==="joy"){ const x=choose(state.tinyJoys); return x?{label:"A tiny joy",title:"Something small that mattered",text:x.text||"",icon:"leaf"}:null; }
  if(type==="comfort"){ const x=choose(state.comfortItems); return x?{label:"Something comforting",title:x.title||"Comfort Corner",text:x.body||"",icon:"heart"}:null; }
  if(type==="bubble"){ const x=choose(state.thoughtBubbles); return x?{label:"A thought that floated back",title:formatDate(x.date),text:x.text||"",icon:"bubble"}:null; }
  if(type==="mood"){
    const x=choose(state.moodCheckins);
    return x?{label:"A feeling your room remembers",title:`${moodLabels[x.mood]||"A day"} · ${formatDate(x.date)}`,text:x.note||"You checked in with yourself on this day.",icon:"tea"}:null;
  }
  return null;
}

function showSanctuaryMemory(type) {
  const card=$("sanctuaryMemoryCard"); if(!card) return;
  const memory=sanctuaryMemoryFor(type);
  activeSanctuaryMemoryEntryId=memory?.entryId||null;
  if(!memory){
    $("sanctuaryMemoryLabel").textContent="This little corner is still waiting";
    $("sanctuaryMemoryTitle").textContent="Nothing tucked here yet";
    $("sanctuaryMemoryText").textContent="As you use more of Fuwa, this object will begin bringing small pieces of your past back to you.";
    $("sanctuaryMemoryOpenEntry").classList.add("hidden");
  } else {
    $("sanctuaryMemoryLabel").textContent=memory.label;
    $("sanctuaryMemoryTitle").textContent=memory.title;
    $("sanctuaryMemoryText").textContent=memory.text||"A small piece of your Fuwa.";
    $("sanctuaryMemoryOpenEntry").classList.toggle("hidden",!memory.entryId);
  }
  card.classList.remove("hidden");
}

function renderSanctuaryLegacy(force=false) {
  const host=$("sanctuaryRoom"), unlocks=$("sanctuaryUnlocks"), objectOptions=$("sanctuaryObjectOptions"), themeOptions=$("sanctuaryThemeOptions");
  if(!host||!unlocks||!objectOptions||!themeOptions) return;
  const signature=sanctuarySignature();
  if(!force && renderCache.sanctuary===signature) return;
  renderCache.sanctuary=signature;

  const total=sanctuaryMomentCount(), stageIndex=sanctuaryStageIndex(total), stage=SANCTUARY_STAGES[stageIndex];
  const next=SANCTUARY_STAGES.find(s=>s.min>total)||null, level=stageIndex+1;
  $("sanctuaryStageName").textContent=stage.name;
  $("sanctuaryStageCount").textContent=`${total} ${total===1?"moment":"moments"}`;
  $("sanctuaryProgressCopy").textContent=next?`${next.min-total} more gentle moment${next.min-total===1?"":"s"} and the room may change again.`:stage.copy;
  const progress=next?Math.max(0,Math.min(100,((total-stage.min)/(next.min-stage.min))*100)):100;
  $("sanctuaryProgressBar").style.width=`${progress}%`;

  const visible=Object.fromEntries(SANCTUARY_OBJECTS.map(o=>[o.id,sanctuaryObjectVisible(o,total)]));
  host.innerHTML=`
    <div class="room-scene sanctuary-theme-${escapeHtml(sanctuaryPreferences.theme)} level-${level}">
      <div class="room-window"><div class="room-sky"></div></div>
      <div class="room-rug"></div><div class="room-bed"><span></span></div>
      <button class="room-cloud-pet sanctuary-memory-object" type="button" data-sanctuary-memory="mood" aria-label="Cloud pet memory"><span></span></button>
      ${visible.lamp?'<button class="room-lamp sanctuary-memory-object" type="button" data-sanctuary-memory="nightly" aria-label="Lamp memory"></button>':""}
      ${visible.plant?'<button class="room-plant sanctuary-memory-object" type="button" data-sanctuary-memory="joy" aria-label="Plant memory"></button>':""}
      ${visible.books?'<button class="room-books sanctuary-memory-object" type="button" data-sanctuary-memory="entry" aria-label="Bookshelf memory"></button>':""}
      ${visible.stars?'<button class="room-stars sanctuary-memory-object" type="button" data-sanctuary-memory="dream" aria-label="Star memory"></button>':""}
      ${visible.cushion?'<button class="room-cushion sanctuary-memory-object" type="button" data-sanctuary-memory="comfort" aria-label="Cushion memory"></button>':""}
      ${visible.tea?'<button class="room-tea sanctuary-memory-object" type="button" data-sanctuary-memory="mood" aria-label="Tea memory"></button>':""}
      ${visible.garland?'<button class="room-garland sanctuary-memory-object" type="button" data-sanctuary-memory="bubble" aria-label="Garland memory"></button>':""}
      ${visible.frame?'<button class="room-frame sanctuary-memory-object" type="button" data-sanctuary-memory="entry" aria-label="Frame memory"></button>':""}
      <div class="sanctuary-room-hint">Tap room objects to let them remember.</div>
    </div>`;
  host.querySelectorAll("[data-sanctuary-memory]").forEach(b=>b.addEventListener("click",()=>showSanctuaryMemory(b.dataset.sanctuaryMemory)));

  const themes=[{id:"rose",label:"Rose"},{id:"lavender",label:"Lavender"},{id:"sky",label:"Morning Sky"}];
  themeOptions.innerHTML=themes.map(t=>`<button class="sanctuary-theme-choice ${sanctuaryPreferences.theme===t.id?"selected":""}" type="button" data-sanctuary-theme="${t.id}"><span class="sanctuary-theme-swatch ${t.id}"></span><strong>${t.label}</strong></button>`).join("");
  themeOptions.querySelectorAll("[data-sanctuary-theme]").forEach(b=>b.addEventListener("click",()=>{
    sanctuaryPreferences.theme=b.dataset.sanctuaryTheme; saveSanctuaryPreferences(); renderCache.sanctuary=""; renderSanctuary(true);
  }));

  objectOptions.innerHTML=SANCTUARY_OBJECTS.map(o=>{
    const unlocked=sanctuaryObjectUnlocked(o,total), shown=sanctuaryPreferences.visibleObjects.includes(o.id);
    return `<button class="sanctuary-object-choice ${unlocked?"unlocked":"locked"} ${unlocked&&shown?"selected":""}" type="button" data-sanctuary-object="${o.id}" ${unlocked?"":"disabled"}><span class="sanctuary-object-dot ${o.id}"></span><strong>${o.label}</strong><small>${unlocked?(shown?"In room":"Tucked away"):`At ${o.min} moments`}</small></button>`;
  }).join("");
  objectOptions.querySelectorAll("[data-sanctuary-object]:not(:disabled)").forEach(b=>b.addEventListener("click",()=>{
    const id=b.dataset.sanctuaryObject, set=new Set(sanctuaryPreferences.visibleObjects); set.has(id)?set.delete(id):set.add(id);
    sanctuaryPreferences.visibleObjects=[...set]; saveSanctuaryPreferences(); renderCache.sanctuary=""; renderSanctuary(true);
  }));

  unlocks.innerHTML=SANCTUARY_OBJECTS.map(o=>{
    const unlocked=sanctuaryObjectUnlocked(o,total);
    return `<div class="sanctuary-unlock ${unlocked?"unlocked":""}"><span>${unlocked?"♡":"○"}</span><div><strong>${o.label}</strong><small>${unlocked?"Found its way into your room.":`${o.min-total} moments away`}</small></div></div>`;
  }).join("");
}

function bindSanctuaryStaticControls() {
  $("sanctuaryMemoryClose")?.addEventListener("click",()=>{ activeSanctuaryMemoryEntryId=null; $("sanctuaryMemoryCard")?.classList.add("hidden"); });
  $("sanctuaryMemoryOpenEntry")?.addEventListener("click",()=>{ if(activeSanctuaryMemoryEntryId) openEditor(activeSanctuaryMemoryEntryId); });
}

function renderExpansionFeatures() {
  renderThenNow();
  renderComfort();
  renderUnsent();
  renderBubbles();
  renderDreams();
  renderMonthlyStory();
  renderEmotionalWeather();
}


const sleepSoundNames = {
  rain: "Gentle Rain",
  waves: "Ocean Drift",
  fireplace: "Warm Hearth",
  wind: "Evening Breeze",
  forest: "Quiet Forest",
  cafe: "Cozy Room",
  brown: "Deep Hush",
  white: "Soft Air"
};

const sleepAudioFiles = {
  rain: "./audio/sleep/gentle-rain.mp3",
  waves: "./audio/sleep/ocean-drift.mp3",
  fireplace: "./audio/sleep/warm-hearth.mp3",
  wind: "./audio/sleep/evening-breeze.mp3",
  forest: "./audio/sleep/quiet-forest.mp3",
  cafe: "./audio/sleep/cozy-room.mp3",
  brown: "./audio/sleep/deep-hush.mp3",
  white: "./audio/sleep/soft-air.mp3"
};

function sleepBaseVolume() {
  return Math.max(0, Math.min(1, Number(state.sleepVolume || 0) / 100));
}

function cancelSleepAudioTransition() {
  sleepAudioTransitionToken += 1;
  if (sleepAudioTransitionFrame !== null) {
    cancelAnimationFrame(sleepAudioTransitionFrame);
    sleepAudioTransitionFrame = null;
  }
}

function ensureSleepAudioElement() {
  if (!sleepAudioElement) {
    sleepAudioElement = new Audio();
    sleepAudioElement.loop = true;
    sleepAudioElement.preload = "metadata";
    sleepAudioElement.playsInline = true;
    sleepAudioElement.setAttribute("playsinline", "");
    sleepAudioElement.setAttribute("webkit-playsinline", "");
    sleepAudioElement.addEventListener("error", () => {
      const now = Date.now();
      if (sleepIsPlaying && now - sleepAudioErrorToastAt > 5000) {
        sleepAudioErrorToastAt = now;
        toast("Fuwa couldn't load this sound.");
      }
    });
  }
  return sleepAudioElement;
}

function loadSleepAudio(sound = state.sleepSound, { reset = true } = {}) {
  const path = sleepAudioFiles[sound] || sleepAudioFiles.rain;
  const audio = ensureSleepAudioElement();
  if (audio.dataset.sleepSound !== sound) {
    audio.pause();
    audio.src = path;
    audio.dataset.sleepSound = sound;
    audio.load();
    if (reset) {
      try { audio.currentTime = 0; } catch (_) {}
    }
  }
  return audio;
}

function setSleepAudioVolume(volume) {
  const audio = ensureSleepAudioElement();
  audio.volume = Math.max(0, Math.min(1, volume));
}

function rampSleepAudioVolume(target, duration = 450) {
  const audio = ensureSleepAudioElement();
  cancelSleepAudioTransition();
  const token = sleepAudioTransitionToken;
  const from = Number(audio.volume || 0);
  const to = Math.max(0, Math.min(1, target));
  const start = performance.now();

  return new Promise(resolve => {
    const tick = now => {
      if (token !== sleepAudioTransitionToken) {
        resolve(false);
        return;
      }
      const progress = Math.min(1, Math.max(0, (now - start) / Math.max(1, duration)));
      audio.volume = from + (to - from) * progress;
      if (progress < 1) {
        sleepAudioTransitionFrame = requestAnimationFrame(tick);
      } else {
        sleepAudioTransitionFrame = null;
        resolve(true);
      }
    };
    sleepAudioTransitionFrame = requestAnimationFrame(tick);
  });
}

async function playSelectedSleepAudio({ fadeIn = true } = {}) {
  const audio = loadSleepAudio(state.sleepSound);
  const target = sleepBaseVolume();
  cancelSleepAudioTransition();
  audio.volume = fadeIn ? 0 : target;
  await audio.play();
  if (fadeIn) await rampSleepAudioVolume(target, 900);
  return audio;
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
  renderPrivacySettings();
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
    $("sleepHomeText").textContent = "Gentle rain, ocean drift, warm hearth, breeze, quiet forest, cozy room, deep hush, and soft air.";
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

  if (sleepAudioElement && sleepRemainingMs <= 20000 && sleepRemainingMs > 0) {
    sleepAudioElement.volume = sleepBaseVolume() * Math.max(0, sleepRemainingMs / 20000);
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
    if (sleepFadeTimeout) {
      clearTimeout(sleepFadeTimeout);
      sleepFadeTimeout = null;
    }

    const minutes = selectedSleepMinutes();
    state.sleepMinutes = minutes;
    savePreferences();

    await playSelectedSleepAudio({ fadeIn: true });
    sleepIsPlaying = true;
    sleepIsPaused = false;
    startSleepTimer(minutes);
    renderSleepControls();
  } catch (error) {
    console.error("Could not start Fuwa sleep sound.", error);
    sleepIsPlaying = false;
    sleepIsPaused = false;
    renderSleepControls();
    toast("Fuwa couldn't start audio on this device.");
  }
}

async function pauseSleepSound() {
  if (!sleepAudioElement || !sleepIsPlaying) return;

  sleepRemainingMs = Math.max(0, sleepTimerEndAt - Date.now());
  sleepIsPlaying = false;
  sleepIsPaused = true;
  clearInterval(sleepTimerInterval);
  sleepTimerInterval = null;
  cancelSleepAudioTransition();
  sleepAudioElement.pause();
  renderSleepControls();
}

async function resumeSleepSound() {
  if (!sleepAudioElement || !sleepIsPaused) {
    await startSleepSound();
    return;
  }

  try {
    cancelSleepAudioTransition();
    sleepAudioElement.volume = sleepBaseVolume();
    await sleepAudioElement.play();
  } catch (error) {
    console.error("Could not resume Fuwa sleep sound.", error);
    toast("Fuwa couldn't resume this sound.");
    return;
  }

  sleepIsPaused = false;
  sleepIsPlaying = true;
  sleepTimerEndAt = Date.now() + sleepRemainingMs;
  clearInterval(sleepTimerInterval);
  sleepTimerInterval = setInterval(updateSleepCountdown, 1000);
  renderSleepControls();
}

async function stopSleepSound(fromTimer = false) {
  sleepSoundSwitchToken += 1;
  clearInterval(sleepTimerInterval);
  sleepTimerInterval = null;
  cancelSleepAudioTransition();

  if (sleepAudioElement) {
    sleepAudioElement.pause();
    try { sleepAudioElement.currentTime = 0; } catch (_) {}
    sleepAudioElement.volume = sleepBaseVolume();
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
  const switchToken = ++sleepSoundSwitchToken;
  state.sleepSound = sound;
  savePreferences();

  if (sleepIsPlaying) {
    const audio = ensureSleepAudioElement();
    await rampSleepAudioVolume(0, 320);
    if (!sleepIsPlaying || switchToken !== sleepSoundSwitchToken) return;

    audio.pause();
    loadSleepAudio(sound);
    audio.volume = 0;
    try {
      await audio.play();
      if (!sleepIsPlaying || switchToken !== sleepSoundSwitchToken) {
        audio.pause();
        return;
      }
      await rampSleepAudioVolume(sleepBaseVolume(), 650);
    } catch (error) {
      console.error("Could not switch Fuwa sleep sound.", error);
      sleepIsPlaying = false;
      sleepIsPaused = false;
      toast("Fuwa couldn't switch to this sound.");
    }
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

  if (sleepAudioElement) {
    const baseVolume = sleepBaseVolume();
    if (sleepIsPlaying && sleepRemainingMs > 0 && sleepRemainingMs <= 20000) {
      sleepAudioElement.volume = baseVolume * (sleepRemainingMs / 20000);
    } else if (sleepAudioTransitionFrame === null) {
      sleepAudioElement.volume = baseVolume;
    }
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
  editingNightlyId = null;
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

  host.innerHTML = items.map(item => swipeActionShell(`
    <article class="nightly-history-card">
      <time>${escapeHtml(formatDate(item.date))}</time>
      ${item.grateful ? `<div><span>♡ Grateful</span><p>${escapeHtml(item.grateful)}</p></div>` : ""}
      ${item.release ? `<div><span>⌁ Left here</span><p>${escapeHtml(item.release)}</p></div>` : ""}
      ${item.tomorrow ? `<div><span>☾ Tomorrow</span><p>${escapeHtml(item.tomorrow)}</p></div>` : ""}
    </article>
  `, "nightly", item.id)).join("");
  bindSwipeActions(host);
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

  const existing = editingNightlyId
    ? state.nightlyReflections.find(item => item.id === editingNightlyId)
    : todaysNightlyReflection();
  const recordDate = existing?.date || isoToday();
  const record = {
    id: existing?.id || recordDate,
    date: recordDate,
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

    editingNightlyId = null;

    // The saved reflection now lives in history, so leave the capture area
    // visually fresh instead of making it look like the form failed to clear.
    $("nightlyGrateful").value = "";
    $("nightlyRelease").value = "";
    $("nightlyTomorrow").value = "";

    renderAll();
    renderNightlyHistory();
    toast(existing ? "Wind-down updated 🌙" : "Today can rest now 🌙");
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

// Sleep Corner uses local recorded audio files. Nothing is generated at app startup;
// the audio element is created lazily only after the user opens/plays Sleep Corner.
let sleepAudioElement = null;
let sleepAudioTransitionFrame = null;
let sleepAudioTransitionToken = 0;
let sleepAudioErrorToastAt = 0;
let sleepTimerInterval = null;
let sleepTimerEndAt = 0;
let sleepTimerStartedAt = 0;
let sleepTimerDurationMs = 0;
let sleepIsPlaying = false;
let sleepIsPaused = false;
let sleepRemainingMs = 0;
let sleepFadeTimeout = null;
let sleepSoundSwitchToken = 0;

// Privacy Lock
let privacySetupStage = "new";
let privacyFirstPin = "";
let privacyLastActiveAt = Date.now();
let privacyIsLocked = false;
let privacyBiometricAvailable = false;
let privacyLockAfterPinSetup = false;
let quickHideActive = false;



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
  bindSwipeActions(host);
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
      ${swipeActionShell(`<article class="bookmark-card ${status}">
        <button type="button" data-bookmark-open="${escapeHtml(bookmark.id)}">
          <div class="bookmark-card-top">
            <span class="bookmark-status-pill">${status === "ready" ? "☁️ Ready now" : status === "archived" ? "♡ Kept" : "🔖 Waiting"}</span>
            <time>${status === "ready" ? "From " + escapeHtml(formatDate(entry?.date || bookmark.createdDate)) : "Returns " + escapeHtml(formatDate(bookmark.revisitDate))}</time>
          </div>
          <blockquote>“${escapeHtml(bookmark.quote)}”</blockquote>
          ${bookmark.note ? `<p>${escapeHtml(bookmark.note)}</p>` : ""}
          <small>${responseCount ? `${responseCount} ${responseCount === 1 ? "reply" : "replies"} across time` : entry ? escapeHtml(entry.title) : "Saved thought"}</small>
        </button>
      </article>`, "bookmark", bookmark.id)}`;
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
  return checkins.slice(0, max).map((item, index) => {
    const mood = moodLabels[item.mood] ? item.mood : "neutral";
    const label = moodLabels[mood] || mood;
    return `
      <span class="jar-mood-item"
        data-jar-mood-index="${index}"
        style="--jar-mood-i:${index}"
        title="${escapeHtml(formatDate(item.date))} · ${escapeHtml(label)}"
        aria-label="${escapeHtml(formatDate(item.date))}: ${escapeHtml(label)}">
        ${moodIconMarkup(mood, "jar-mood-icon")}
      </span>
    `;
  }).join("");
}


function moodJarSensorGravity(event) {
  const beta = Number.isFinite(event?.beta) ? event.beta : 90;
  const gamma = Number.isFinite(event?.gamma) ? event.gamma : 0;
  const x = Math.sin(Math.max(-90, Math.min(90, gamma)) * Math.PI / 180);
  const y = Math.sin(Math.max(-90, Math.min(90, beta)) * Math.PI / 180);

  moodJarGravity.x = Math.max(-1, Math.min(1, x));
  moodJarGravity.y = Math.max(-1, Math.min(1, y));
}

function bindMoodJarOrientation() {
  if (moodJarOrientationBound) return;
  window.addEventListener("deviceorientation", moodJarSensorGravity, { passive: true });
  moodJarOrientationBound = true;
}

async function requestMoodJarMotionPermission() {
  if (moodJarOrientationPermissionRequested) return;
  moodJarOrientationPermissionRequested = true;

  try {
    if (typeof DeviceOrientationEvent !== "undefined"
      && typeof DeviceOrientationEvent.requestPermission === "function") {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission === "granted") bindMoodJarOrientation();
      return;
    }
    bindMoodJarOrientation();
  } catch (error) {
    console.warn("Fuwa Mood Jar motion permission was not granted.", error);
  }
}

function buildMoodJarWorld(container) {
  if (!container) return null;

  const rect = container.getBoundingClientRect();
  if (rect.width < 12 || rect.height < 12) return null;

  const elements = [...container.querySelectorAll(".jar-mood-item")];
  const isLarge = container.id === "moodJarLargeBeads";
  const radius = isLarge ? 18 : 10;
  const padding = isLarge ? 7 : 4;

  const bodies = elements.map((element, index) => {
    const usableWidth = Math.max(radius * 2, rect.width - padding * 2 - radius * 2);
    const x = padding + radius + ((index * 37 + 17) % Math.max(1, usableWidth));
    const y = Math.max(radius + padding, -radius - index * (isLarge ? 11 : 7));
    return {
      element,
      x,
      y,
      vx: ((index % 3) - 1) * 0.16,
      vy: 0,
      radius,
      rotation: ((index % 5) - 2) * 3
    };
  });

  const world = {
    container,
    width: rect.width,
    height: rect.height,
    padding,
    radius,
    bodies,
    lastTime: performance.now(),
    sleepingFrames: 0
  };

  moodJarPhysicsWorlds.set(container.id, world);
  return world;
}

function ensureMoodJarWorld(containerId) {
  const container = $(containerId);
  if (!container || !container.querySelector(".jar-mood-item")) {
    moodJarPhysicsWorlds.delete(containerId);
    return null;
  }

  const oldWorld = moodJarPhysicsWorlds.get(containerId);
  const rect = container.getBoundingClientRect();
  const count = container.querySelectorAll(".jar-mood-item").length;

  if (!oldWorld
    || oldWorld.bodies.length !== count
    || Math.abs(oldWorld.width - rect.width) > 2
    || Math.abs(oldWorld.height - rect.height) > 2) {
    return buildMoodJarWorld(container);
  }

  return oldWorld;
}

function resolveMoodJarCollisions(world) {
  const bodies = world.bodies;

  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      const a = bodies[i];
      const b = bodies[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distance = Math.hypot(dx, dy);
      const minDistance = a.radius + b.radius - 1;

      if (distance <= 0.001) {
        dx = 0.01;
        dy = 0;
        distance = 0.01;
      }

      if (distance < minDistance) {
        const nx = dx / distance;
        const ny = dy / distance;
        const overlap = (minDistance - distance) * 0.5;

        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;

        const relativeVelocity = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (relativeVelocity < 0) {
          const impulse = -relativeVelocity * 0.36;
          a.vx -= impulse * nx;
          a.vy -= impulse * ny;
          b.vx += impulse * nx;
          b.vy += impulse * ny;
        }
      }
    }
  }
}

function stepMoodJarWorld(world, dt) {
  const gravityStrength = 0.0017 * dt;
  const gx = moodJarGravity.x * gravityStrength;
  const gy = moodJarGravity.y * gravityStrength;
  const left = world.padding + world.radius;
  const right = world.width - world.padding - world.radius;
  const top = world.padding + world.radius;
  const bottom = world.height - world.padding - world.radius;

  world.bodies.forEach(body => {
    body.vx += gx;
    body.vy += gy;
    body.vx *= 0.992;
    body.vy *= 0.992;

    const speed = Math.hypot(body.vx, body.vy);
    if (speed > 1.8) {
      body.vx = (body.vx / speed) * 1.8;
      body.vy = (body.vy / speed) * 1.8;
    }

    body.x += body.vx * dt * 0.06;
    body.y += body.vy * dt * 0.06;

    if (body.x < left) {
      body.x = left;
      body.vx = Math.abs(body.vx) * 0.48;
    } else if (body.x > right) {
      body.x = right;
      body.vx = -Math.abs(body.vx) * 0.48;
    }

    if (body.y < top) {
      body.y = top;
      body.vy = Math.abs(body.vy) * 0.45;
    } else if (body.y > bottom) {
      body.y = bottom;
      body.vy = -Math.abs(body.vy) * 0.36;
      if (Math.abs(body.vy) < 0.035) body.vy = 0;
    }
  });

  resolveMoodJarCollisions(world);

  world.bodies.forEach(body => {
    body.rotation += body.vx * dt * 0.035;
    body.element.style.transform = `translate3d(${body.x - body.radius}px, ${body.y - body.radius}px, 0) rotate(${body.rotation}deg)`;
  });
}

function moodJarPhysicsTick(now) {
  moodJarPhysicsFrame = null;
  if (document.hidden) return;

  const activeIds = currentView === "moodjar"
    ? ["moodJarLargeBeads"]
    : currentView === "home"
      ? ["homeMoodJarBeads"]
      : [];

  activeIds.forEach(containerId => {
    const world = ensureMoodJarWorld(containerId);
    if (!world) return;
    const dt = Math.min(34, Math.max(8, now - world.lastTime || 16));
    world.lastTime = now;
    stepMoodJarWorld(world, dt);
  });

  if (activeIds.length) moodJarPhysicsFrame = requestAnimationFrame(moodJarPhysicsTick);
}

function startMoodJarPhysics() {
  if (moodJarPhysicsFrame || document.hidden) return;
  moodJarPhysicsFrame = requestAnimationFrame(moodJarPhysicsTick);
}

function refreshMoodJarPhysics(containerId) {
  const existing = moodJarPhysicsWorlds.get(containerId);
  if (existing) moodJarPhysicsWorlds.delete(containerId);

  requestAnimationFrame(() => {
    ensureMoodJarWorld(containerId);
    startMoodJarPhysics();
  });
}

function renderHomeMoodJar() {
  const checkins = moodCheckinsForMonth(new Date());
  const today = getTodayMoodCheckin();
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date());
  $("moodJarMonthLabel").textContent = monthName;
  $("homeMoodJarBeads").innerHTML = moodBeadsMarkup(checkins);
  refreshMoodJarPhysics("homeMoodJarBeads");
  $("moodJarSummary").textContent = checkins.length
    ? `${checkins.length} check-in${checkins.length === 1 ? "" : "s"} tucked into your jar.`
    : "No check-ins yet. Your first little bead is waiting.";
  $("moodJarTodayStatus").innerHTML = today
    ? `${moodIconMarkup(today.mood, "mini")} <span class="mood-status-copy">Today: ${moodLabels[today.mood]} · tap to open</span>`
    : "♡ Check in today";
}

function renderMoodJarView() {
  const checkins = moodCheckinsForMonth(moodJarCursor);
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(moodJarCursor);
  $("moodJarViewMonth").textContent = monthName;
  $("moodJarLargeBeads").innerHTML = moodBeadsMarkup(checkins);
  refreshMoodJarPhysics("moodJarLargeBeads");
  $("moodJarCheckinCount").textContent = `${checkins.length} check-in${checkins.length === 1 ? "" : "s"}`;

  const counts = Object.keys(moodEmoji).reduce((acc, mood) => {
    acc[mood] = checkins.filter(item => item.mood === mood).length;
    return acc;
  }, {});
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  $("moodJarMostCommon").innerHTML = top && top[1] > 0
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
  if (moodCheckinSaving) return;
  $("moodCheckinModal").classList.add("hidden");
  document.body.style.overflow = "";
}

async function persistTodayMoodCheckin(mood) {
  if (!moodEmoji[mood]) throw new Error("Invalid mood.");

  const date = isoToday();
  const sameDay = state.moodCheckins.filter(item => item.date === date);
  const existing = sameDay.find(item => item.id === date) || sameDay[0] || null;

  const record = {
    id: existing?.id || date,
    date,
    mood,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now()
  };

  await diaryRepository.save("moodCheckins", record);

  // v79 QA: older builds could theoretically leave more than one check-in
  // for the same date if a legacy record used a non-date ID. Keep one bead/day.
  const duplicateIds = sameDay
    .filter(item => item.id !== record.id)
    .map(item => item.id);

  for (const duplicateId of duplicateIds) {
    try {
      await diaryRepository.remove("moodCheckins", duplicateId);
    } catch (error) {
      console.warn("Could not clean up a duplicate Mood Jar check-in.", error);
    }
  }

  state.moodCheckins = state.moodCheckins.filter(item => item.date !== date);
  state.moodCheckins.push(record);

  // Home and Mood Jar should always describe the same mood for today.
  state.selectedMood = mood;
  savePreferences();

  return { record, existed: !!existing };
}

function queueTodayMoodPersistence(mood) {
  const run = () => persistTodayMoodCheckin(mood);
  const queued = moodPersistenceChain.catch(() => {}).then(run);
  moodPersistenceChain = queued.catch(() => {});
  return queued;
}

async function syncHomeMoodToJar(mood) {
  if (!moodEmoji[mood]) return;

  const previousCheckin = getTodayMoodCheckin();
  const previousMood = previousCheckin?.mood || state.selectedMood || defaultState.selectedMood;

  // Update Home immediately, but serialize the actual IndexedDB write
  // with Mood Jar writes so both surfaces cannot race each other.
  state.selectedMood = mood;
  savePreferences();
  renderMoodPicker();
  showMoodReaction(mood, true);

  // Latest Home tap wins instead of queueing every intermediate tap.
  pendingHomeMoodSync = mood;
  if (homeMoodSyncRunning) return;

  homeMoodSyncRunning = true;
  let savedAny = false;

  try {
    while (pendingHomeMoodSync) {
      const nextMood = pendingHomeMoodSync;
      pendingHomeMoodSync = "";
      await queueTodayMoodPersistence(nextMood);
      savedAny = true;
    }

    renderMoodPicker();
    renderHomeMoodJar();
    renderStats();
    if (currentView === "moodjar") renderMoodJarView();

    if (savedAny) toast("Today's mood is tucked into your jar ☁️");
  } catch (error) {
    console.error("Could not sync Home mood to Mood Jar.", error);

    // Never leave Home showing a mood that failed to reach IndexedDB.
    const authoritative = getTodayMoodCheckin()?.mood || previousMood;
    state.selectedMood = authoritative;
    savePreferences();
    renderMoodPicker();
    renderHomeMoodJar();
    if (currentView === "moodjar") renderMoodJarView();

    toast("Fuwa couldn't add that mood to the jar. Your previous mood was kept.");
  } finally {
    homeMoodSyncRunning = false;

    if (pendingHomeMoodSync) {
      const queuedMood = pendingHomeMoodSync;
      pendingHomeMoodSync = "";
      syncHomeMoodToJar(queuedMood);
    }
  }
}

async function saveMoodCheckin(mood) {
  if (!moodEmoji[mood] || moodCheckinSaving) return;

  moodCheckinSaving = true;
  document.querySelectorAll("[data-checkin-mood]").forEach(button => {
    button.disabled = true;
  });

  const existing = getTodayMoodCheckin();

  try {
    await queueTodayMoodPersistence(mood);

    $("moodCheckinModal").classList.add("hidden");
    document.body.style.overflow = "";

    // Targeted renders keep the two mood surfaces synchronized without
    // refreshing unrelated heavy views.
    renderMoodPicker();
    renderHomeMoodJar();
    renderStats();
    if (currentView === "moodjar") renderMoodJarView();

    toast(existing ? "Today's mood updated ☁️" : "A little mood tucked into your jar 🫙");
  } catch (error) {
    console.error("Could not save mood check-in.", error);
    toast("Fuwa couldn't save that check-in. Please try again.");
  } finally {
    moodCheckinSaving = false;
    document.querySelectorAll("[data-checkin-mood]").forEach(button => {
      button.disabled = false;
    });
  }
}

function maybeShowDailyMoodCheckin() {
  if (getTodayMoodCheckin() || homeMoodSyncRunning || pendingHomeMoodSync) return;
  setTimeout(() => {
    if (getTodayMoodCheckin() || homeMoodSyncRunning || pendingHomeMoodSync) return;
    openMoodCheckin();
  }, 350);
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 1800);
}


function openFuwaDrawer() {
  const drawer = $("fuwaDrawer");
  const backdrop = $("fuwaDrawerBackdrop");
  if (!drawer || !backdrop) return;
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  backdrop.classList.remove("hidden");
  requestAnimationFrame(() => backdrop.classList.add("visible"));
  $("menuButton")?.setAttribute("aria-expanded", "true");
  document.body.classList.add("drawer-open");
  document.body.style.overflow = "hidden";
}

function closeFuwaDrawer() {
  const drawer = $("fuwaDrawer");
  const backdrop = $("fuwaDrawerBackdrop");
  if (!drawer || !backdrop) return;
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  backdrop.classList.remove("visible");
  $("menuButton")?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("drawer-open");
  if (!privacyIsLocked) document.body.style.overflow = "";
  setTimeout(() => {
    if (!backdrop.classList.contains("visible")) backdrop.classList.add("hidden");
  }, 230);
}

function toggleFuwaDrawer() {
  $("fuwaDrawer")?.classList.contains("open") ? closeFuwaDrawer() : openFuwaDrawer();
}

function navigate(view) {
  closeFuwaDrawer();
  currentView = view;

  document.querySelectorAll(".view").forEach(section => {
    section.classList.toggle("active", section.id === `${view}View`);
  });

  document.querySelectorAll(".nav-item[data-nav]").forEach(button => {
    button.classList.toggle("active", button.dataset.nav === view);
  });

  renderViewOnDemand(view);

  if (view === "home" || view === "moodjar") startMoodJarPhysics();

  window.scrollTo({ top: 0, behavior: "smooth" });
  maybeShowFeatureTutorial(view);
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

  // Keep normal renders lightweight. Appearance controls (and their IndexedDB
  // wallpaper read) are refreshed only when Appearance is actually opened or
  // when wallpaper/theme settings change.
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
  const chooseButton = $("chooseWallpaperButton");
  const removeButton = $("removeWallpaperButton");
  if (!preview || !empty) return;

  const old = preview.querySelector(".wallpaper-preview-image");
  if (old) old.remove();

  const hasWallpaper = !!saved?.blob;
  empty.classList.toggle("hidden", hasWallpaper);
  if (chooseButton) chooseButton.textContent = hasWallpaper ? "Change Photo" : "Choose Photo";
  removeButton?.classList.toggle("hidden", !hasWallpaper);
  preview.classList.toggle("has-wallpaper", hasWallpaper);

  if (!hasWallpaper) return;

  const url = URL.createObjectURL(saved.blob);
  const img = document.createElement("img");
  img.className = "wallpaper-preview-image";
  img.alt = "Saved Fuwa wallpaper";
  img.src = url;
  img.onload = () => URL.revokeObjectURL(url);
  preview.prepend(img);
}

function openAppearance() {
  $("appearanceModal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  renderAppearanceControls();
  maybeShowFeatureTutorial("appearance");
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
  renderAppearanceControls();
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

async function removeCustomWallpaper() {
  const saved = await diaryRepository.getSetting("custom-wallpaper");
  if (!saved?.blob) return;
  if (!confirm("Remove your custom wallpaper from this device?")) return;

  state.wallpaperEnabled = false;
  savePreferences();
  await diaryRepository.removeSetting("custom-wallpaper");
  await applyWallpaper();
  toast("Wallpaper removed");
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

const moodReactionCopy = {
  amazing: { word: "Amazing", copy: "You're glowing a little brighter today." },
  good: { word: "Good", copy: "Soft and steady today." },
  neutral: { word: "Neutral", copy: "Just taking the day as it comes." },
  tired: { word: "Tired", copy: "You can move gently today." },
  sad: { word: "Sad", copy: "A softer day deserves extra care." },
  angry: { word: "Angry", copy: "Big feelings can rest here too." }
};

function showMoodReaction(mood, animate = true) {
  const reaction = $("moodReaction");
  if (!reaction) return;
  const safeMood = moodReactionCopy[mood] ? mood : "good";
  const content = moodReactionCopy[safeMood];

  $("moodReactionIcon").innerHTML = moodIconMarkup(safeMood, "reaction-icon");
  $("moodReactionWord").textContent = content.word;
  $("moodReactionCopy").textContent = content.copy;
  reaction.dataset.mood = safeMood;
  reaction.classList.add("visible");

  if (animate) {
    reaction.classList.remove("mood-reaction-pop");
    void reaction.offsetWidth;
    reaction.classList.add("mood-reaction-pop");

    const selectedButton = document.querySelector(`#moodPicker button[data-mood="${safeMood}"]`);
    if (selectedButton) {
      selectedButton.classList.remove("mood-button-pop");
      void selectedButton.offsetWidth;
      selectedButton.classList.add("mood-button-pop");
    }
  }
}

function renderMoodPicker() {
  document.querySelectorAll("#moodPicker button").forEach(button => {
    button.classList.toggle("selected", button.dataset.mood === state.selectedMood);
  });
  showMoodReaction(state.selectedMood, false);
}

function renderCalendar() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  $("monthTitle").textContent = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(today);
  const grid = $("calendarGrid");
  grid.innerHTML = "";

  const entryByDate = new Map();
  for (const entry of state.entries) {
    if (!entry?.date) continue;
    const current = entryByDate.get(entry.date);
    if (!current || Number(entry.updatedAt || entry.createdAt || 0) > Number(current.updatedAt || current.createdAt || 0)) {
      entryByDate.set(entry.date, entry);
    }
  }

  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < startOffset; i++) {
    const blank = document.createElement("span");
    blank.className = "calendar-day empty";
    fragment.appendChild(blank);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const entry = entryByDate.get(date);
    const button = document.createElement("button");
    button.className = "calendar-day";
    if (entry) button.classList.add("has-entry");
    if (date === isoToday()) button.classList.add("today");
    button.textContent = day;
    if (entry) button.addEventListener("click", () => openEditor(entry.id));
    fragment.appendChild(button);
  }
  grid.appendChild(fragment);
}

function entryCard(entry) {
  const tags = (entry.tags || []).slice(0, 3)
    .map(tag => `<span class="tag">#${escapeHtml(tag)}</span>`).join("");

  return swipeActionShell(`
    <article class="entry-card">
      <button data-entry-id="${entry.id}">
        <div class="soft-label">${formatDate(entry.date)} · ${moodIconMarkup(entry.mood, "mini")}</div>
        <h4>${escapeHtml(entry.title)}</h4>
        <p>${escapeHtml(entry.body.slice(0, 120))}${entry.body.length > 120 ? "…" : ""}</p>
        <div class="meta">${tags}</div>
      </button>
    </article>
  `, "entry", entry.id);
}

function bindEntryCards(container) {
  container.querySelectorAll("[data-entry-id]").forEach(button => {
    button.addEventListener("click", () => openEditor(button.dataset.entryId));
  });
  bindSwipeActions(container);
}

const ENTRY_LIST_BATCH_SIZE = 40;
let entryListRenderLimit = ENTRY_LIST_BATCH_SIZE;
let entryListSearchQuery = "";
let entryListResultsCache = [];
let entrySearchDebounceTimer = 0;

function compareEntryRecency(a, b) {
  return String(b.date || "").localeCompare(String(a.date || "")) ||
    Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0);
}

function getMostRecentEntries(limit = 3) {
  const top = [];
  for (const entry of state.entries) {
    let insertAt = top.findIndex(existing => compareEntryRecency(entry, existing) < 0);
    if (insertAt < 0) insertAt = top.length;
    top.splice(insertAt, 0, entry);
    if (top.length > limit) top.pop();
  }
  return top;
}

function renderRecentEntries() {
  const container = $("recentEntries");
  if (!container) return;
  const recent = getMostRecentEntries(3);
  container.innerHTML = recent.length
    ? recent.map(entryCard).join("")
    : `<div class="empty-state">Your first memory will appear here 🌸</div>`;
  bindEntryCards(container);
}

function buildEntryListResults(query = "") {
  const normalized = query.trim().toLowerCase();
  const entries = state.entries.filter(entry => {
    if (!normalized) return true;
    return [entry.title, entry.body, entry.mood, ...(entry.tags || [])]
      .join(" ").toLowerCase().includes(normalized);
  });
  entries.sort(compareEntryRecency);
  return entries;
}

function renderEntries(query = "", { reset = true } = {}) {
  const normalized = query.trim().toLowerCase();
  if (reset || normalized !== entryListSearchQuery) {
    entryListSearchQuery = normalized;
    entryListRenderLimit = ENTRY_LIST_BATCH_SIZE;
    entryListResultsCache = buildEntryListResults(query);
  }

  const entries = entryListResultsCache;
  const visible = entries.slice(0, entryListRenderLimit);
  const container = $("entriesList");
  if (!container) return;
  container.innerHTML = visible.length
    ? visible.map(entryCard).join("")
    : `<div class="empty-state">No matching memories yet.</div>`;
  bindEntryCards(container);

  const progress = $("entriesProgress");
  const more = $("entriesLoadMore");
  if (progress) {
    progress.textContent = entries.length > visible.length
      ? `Showing ${visible.length} of ${entries.length} memories`
      : entries.length ? `${entries.length} ${entries.length === 1 ? "memory" : "memories"}` : "";
    progress.classList.toggle("hidden", !entries.length);
  }
  if (more) {
    const remaining = Math.max(0, entries.length - visible.length);
    more.classList.toggle("hidden", remaining === 0);
    more.textContent = remaining ? `Show more memories · ${remaining} left` : "Show more memories";
  }
}

function showMoreEntries() {
  entryListRenderLimit += ENTRY_LIST_BATCH_SIZE;
  renderEntries(entryListSearchQuery, { reset: false });
}

function scheduleEntrySearch(query) {
  clearTimeout(entrySearchDebounceTimer);
  entrySearchDebounceTimer = window.setTimeout(() => {
    if (currentView !== "entries") return;
    renderEntries(query, { reset: true });
  }, 140);
}

function littleThingDate(item) {
  if (item?.date) return item.date;
  const stamp = Number(item?.createdAt || 0);
  if (!stamp) return "";
  const d = new Date(stamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getTodayRandomThoughts() {
  return [...state.randomThoughts]
    .filter(item => littleThingDate(item) === isoToday())
    .sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
}

async function addRandomThought(event) {
  event?.preventDefault?.();
  const input = event?.currentTarget?.id === "randomThoughtPageForm"
    ? $("randomThoughtPageInput")
    : $("randomThoughtInput");
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  const item = { id: uid("thought"), text, date: isoToday(), createdAt: Date.now(), updatedAt: Date.now() };
  await diaryRepository.save("randomThoughts", item);
  state.randomThoughts.push(item);
  input.value = "";
  renderRandomThoughtsHome();
  if (currentView === "thoughts") renderRandomThoughtHistory();
  toast("Thought tucked away 💭");
}

async function editRandomThought(id) {
  const item = state.randomThoughts.find(x => x.id === id);
  if (!item) return;
  const next = window.prompt("Edit thought", item.text);
  if (next === null) return;
  const text = next.trim();
  if (!text) return;
  const updated = { ...item, text, updatedAt: Date.now() };
  await diaryRepository.save("randomThoughts", updated);
  state.randomThoughts = state.randomThoughts.map(x => x.id === id ? updated : x);
  renderRandomThoughtsHome();
  if (currentView === "thoughts") renderRandomThoughtHistory();
}

async function deleteRandomThought(id) {
  if (!confirm("Delete this thought?")) return;
  await diaryRepository.remove("randomThoughts", id);
  state.randomThoughts = state.randomThoughts.filter(x => x.id !== id);
  renderRandomThoughtsHome();
  if (currentView === "thoughts") renderRandomThoughtHistory();
}

function renderRandomThoughtsHome() {
  const host = $("randomThoughtList");
  if (!host) return;
  const items = getTodayRandomThoughts().slice(0,3);

  host.innerHTML = items.length
    ? items.map(item => `<button type="button" class="little-thing-item" data-thought-id="${escapeHtml(item.id)}">
        <span>💭</span><div><strong>${escapeHtml(item.text)}</strong><small>${new Intl.DateTimeFormat("en-US",{hour:"numeric",minute:"2-digit"}).format(new Date(item.createdAt))}</small></div>
      </button>`).join("")
    : `<div class="little-things-empty">No thoughts yet today.</div>`;

  host.querySelectorAll("[data-thought-id]").forEach(button => {
    button.addEventListener("click", () => editRandomThought(button.dataset.thoughtId));
  });

  $("randomThoughtSeeAllButton")?.classList.toggle("hidden", state.randomThoughts.length === 0);
}

function renderRandomThoughtHistory() {
  const host = $("randomThoughtHistoryList");
  if (!host) return;
  const items = [...state.randomThoughts].sort((a,b) =>
    String(b.date).localeCompare(String(a.date)) || (b.createdAt||0) - (a.createdAt||0)
  );

  host.innerHTML = items.length ? items.map(item => `<article class="thought-history-card">
      <div><span>${escapeHtml(formatDate(item.date))} · ${new Intl.DateTimeFormat("en-US",{hour:"numeric",minute:"2-digit"}).format(new Date(item.createdAt))}</span><strong>${escapeHtml(item.text)}</strong></div>
      <div class="thought-history-actions">
        <button type="button" data-thought-edit="${escapeHtml(item.id)}">Edit</button>
        <button type="button" data-thought-delete="${escapeHtml(item.id)}">Delete</button>
      </div>
    </article>`).join("") : `<div class="empty-state">No random thoughts yet.</div>`;

  host.querySelectorAll("[data-thought-edit]").forEach(button => button.addEventListener("click", () => editRandomThought(button.dataset.thoughtEdit)));
  host.querySelectorAll("[data-thought-delete]").forEach(button => button.addEventListener("click", () => deleteRandomThought(button.dataset.thoughtDelete)));
}

function renderLittleThingsHome() {
  renderTinyJoys();
  renderRandomThoughtsHome();
}

function renderTinyJoys() {
  const container = $("tinyJoyList");
  if (!container) return;

  const joys = [...state.tinyJoys]
    .filter(item => littleThingDate(item) === isoToday())
    .sort((a,b) => (b.createdAt||0) - (a.createdAt||0))
    .slice(0,3);

  container.innerHTML = joys.length
    ? joys.map(joy => `<div class="little-thing-item">
        <span>🌷</span>
        <div><strong>${escapeHtml(joy.text)}</strong><small>${new Intl.DateTimeFormat("en-US",{hour:"numeric",minute:"2-digit"}).format(new Date(joy.createdAt))}</small></div>
      </div>`).join("")
    : `<div class="little-things-empty">No tiny joys yet today.</div>`;

  $("tinyJoySeeAllButton")?.classList.toggle("hidden", state.tinyJoys.length === 0);
}

async function editTinyJoyHistory(id) {
  const item = state.tinyJoys.find(x => x.id === id);
  if (!item) return;
  const next = window.prompt("Edit tiny joy", item.text || "");
  if (next === null) return;
  const text = next.trim();
  if (!text) return;
  const updated = { ...item, text, date: littleThingDate(item) || isoToday(), updatedAt: Date.now() };
  await diaryRepository.save("tinyJoys", updated);
  state.tinyJoys = state.tinyJoys.map(x => x.id === id ? updated : x);
  saveState();
  renderTinyJoys();
  renderTinyJoyHistory();
}

async function deleteTinyJoyHistory(id) {
  if (!confirm("Delete this tiny joy?")) return;
  await diaryRepository.remove("tinyJoys", id);
  state.tinyJoys = state.tinyJoys.filter(x => x.id !== id);
  saveState();
  renderTinyJoys();
  renderTinyJoyHistory();
}

function renderTinyJoyHistory() {
  const host = $("tinyJoyHistoryList");
  if (!host) return;
  const items = [...state.tinyJoys].sort((a,b) =>
    String(littleThingDate(b)).localeCompare(String(littleThingDate(a))) ||
    (b.createdAt||0) - (a.createdAt||0)
  );

  host.innerHTML = items.length ? items.map(item => {
    const date = littleThingDate(item);
    const time = item.createdAt
      ? new Intl.DateTimeFormat("en-US",{hour:"numeric",minute:"2-digit"}).format(new Date(item.createdAt))
      : "";
    return `<article class="thought-history-card">
      <div><span>${date ? escapeHtml(formatDate(date)) : "Saved joy"}${time ? ` · ${time}` : ""}</span><strong>${escapeHtml(item.text || "")}</strong></div>
      <div class="thought-history-actions">
        <button type="button" data-joy-edit="${escapeHtml(item.id)}">Edit</button>
        <button type="button" data-joy-delete="${escapeHtml(item.id)}">Delete</button>
      </div>
    </article>`;
  }).join("") : `<div class="empty-state">No tiny joys yet.</div>`;

  host.querySelectorAll("[data-joy-edit]").forEach(button => button.addEventListener("click", () => editTinyJoyHistory(button.dataset.joyEdit)));
  host.querySelectorAll("[data-joy-delete]").forEach(button => button.addEventListener("click", () => deleteTinyJoyHistory(button.dataset.joyDelete)));
}

function renderLetters() {
  const container = $("lettersList");
  const today = isoToday();

  const letters = [...state.letters].sort((a, b) => a.openDate.localeCompare(b.openDate));

  container.innerHTML = letters.length
    ? letters.map(letter => {
      const unlocked = letter.openDate <= today;
      return `
        ${swipeActionShell(`<article class="letter-card ${unlocked ? "open-letter" : "locked-letter"}">
          <div class="soft-label">${unlocked ? "Ready to open" : "Sealed until"} ${formatDate(letter.openDate)}</div>
          <h4>${escapeHtml(letter.title)}</h4>
          <p>${unlocked ? escapeHtml(letter.body) : "This letter is waiting quietly for Future You. ✉️"}</p>
        </article>`, "letter", letter.id)}
      `;
    }).join("")
    : `<div class="empty-state">Write something for Future You ✉️</div>`;
  bindSwipeActions(container);
}


const LIFE_DEFAULT_HABITS = ["Made bed","Vitamins","Sunscreen","Flossed","Dishes","Read","Outside","Meditated"];
const LIFE_DEFAULT_CUSTOM_HABITS = ["Skincare","Stretch","Japanese","No-spend day"];
const JOURNAL_PREFS_KEY = "fuwaNotebookJournalPrefsV1";
const LIFE_MOVEMENT_LABELS_KEY = "fuwaMovementLabelsV1";
const LIFE_DEFAULT_MOVEMENT_LABELS = Object.freeze({
  none: "Rest",
  walk: "Walk",
  cardio: "Cardio",
  strength: "Strength",
  yoga: "Yoga"
});
const JOURNAL_SECTION_ORDER = ["Check In","Day & Routine","Little Life","Reflect & Remember"];
const JOURNAL_PAGES = [
  {id:"mood",label:"Mood",group:"Check In"},
  {id:"rating",label:"Rate My Day",group:"Check In"},
  {id:"energy",label:"Energy & Social Battery",group:"Check In"},
  {id:"sleep",label:"Sleep",group:"Check In"},
  {id:"wellness",label:"Body & Wellness",group:"Check In"},
  {id:"mind",label:"Mind",group:"Check In"},

  {id:"highlight",label:"Highlight",group:"Day & Routine"},
  {id:"adulting",label:"Adulting",group:"Day & Routine"},
  {id:"habits",label:"Habits",group:"Day & Routine"},
  {id:"work",label:"Work / Study",group:"Day & Routine"},
  {id:"money",label:"Money",group:"Day & Routine"},
  {id:"screen",label:"Screen & Scroll",group:"Day & Routine"},

  {id:"reading",label:"Reading",group:"Little Life"},
  {id:"watching",label:"Watching",group:"Little Life"},
  {id:"listening",label:"Listening",group:"Little Life"},
  {id:"weather",label:"Weather",group:"Little Life"},
  {id:"food",label:"Food & Appetite",group:"Little Life"},
  {id:"connection",label:"Connection",group:"Little Life"},
  {id:"selfcare",label:"Self-Care",group:"Little Life"},
  {id:"creativity",label:"Creativity & Hobbies",group:"Little Life"},

  {id:"dreams",label:"Dreams",group:"Reflect & Remember"},
  {id:"gratitude",label:"Gratitude",group:"Reflect & Remember"},
  {id:"learned",label:"Something I Learned",group:"Reflect & Remember"},
  {id:"cup",label:"Fill My Cup",group:"Reflect & Remember"},
  {id:"win",label:"Little Win",group:"Reflect & Remember"},
  {id:"memory",label:"Memory of the Day",group:"Reflect & Remember"},
  {id:"tomorrow",label:"Tomorrow",group:"Reflect & Remember"},
  {id:"anticipation",label:"Looking Forward To",group:"Reflect & Remember"},
  {id:"dayword",label:"One Word",group:"Reflect & Remember"},
  {id:"free",label:"Free Page",group:"Reflect & Remember"}
];

const JOURNAL_PRESETS = Object.freeze({
  gentle: ["mood","rating","highlight","energy","sleep","gratitude","memory","tomorrow"],
  everyday: ["mood","rating","highlight","energy","sleep","wellness","mind","habits","weather","gratitude","cup","win","memory","tomorrow","selfcare"],
  all: JOURNAL_PAGES.map(page => page.id)
});

let lifeActiveTab="journal", lifeTrackerYear=new Date().getFullYear(), lifeTrackerMetric="rating", lifeCollectionCategory="cup", journalPageIndex=0;
let activeLifeJournalDate=isoToday(), lifeHistoryVisibleCount=12, lifeHistorySelectedDate="";
let lifeDraft={rating:0,mood:"",movement:"",weather:"",dream:"",cycle:"",habits:{},customHabits:{}};
const LEGACY_JOURNAL_PAGE_IDS = ["mood","rating","highlight","energy","sleep","wellness","mind","adulting","habits","reading","watching","listening","weather","dreams","gratitude","learned","cup","win","memory","tomorrow","free"];
let journalPreferences=(()=>{try{const saved=JSON.parse(localStorage.getItem(JOURNAL_PREFS_KEY)||"{}");let enabled=Array.isArray(saved.enabledPages)?saved.enabledPages.filter(id=>JOURNAL_PAGES.some(p=>p.id===id)):JOURNAL_PAGES.map(p=>p.id);const wasUsingAllLegacyPages=LEGACY_JOURNAL_PAGE_IDS.every(id=>enabled.includes(id))&&enabled.length===LEGACY_JOURNAL_PAGE_IDS.length;if(wasUsingAllLegacyPages)enabled=JOURNAL_PAGES.map(p=>p.id);return{enabledPages:enabled.length?enabled:JOURNAL_PAGES.map(p=>p.id)}}catch(_){return{enabledPages:JOURNAL_PAGES.map(p=>p.id)}}})();
function saveJournalPreferences(){try{localStorage.setItem(JOURNAL_PREFS_KEY,JSON.stringify(journalPreferences))}catch(e){console.warn("Could not save Fuwa journal preferences.",e)}}

function loadMovementLabels(){
  try {
    const saved=JSON.parse(localStorage.getItem(LIFE_MOVEMENT_LABELS_KEY)||"{}");
    return Object.fromEntries(Object.entries(LIFE_DEFAULT_MOVEMENT_LABELS).map(([key,label])=>[
      key,
      typeof saved[key]==="string"&&saved[key].trim()?saved[key].trim().slice(0,24):label
    ]));
  } catch (_) {
    return {...LIFE_DEFAULT_MOVEMENT_LABELS};
  }
}
let lifeMovementLabels=loadMovementLabels();

function applyMovementLabels(){
  document.querySelectorAll('#lifeMovementChoices [data-life-choice="movement"]').forEach(button=>{
    button.textContent=lifeMovementLabels[button.dataset.value]||LIFE_DEFAULT_MOVEMENT_LABELS[button.dataset.value]||button.dataset.value;
  });
}

function editMovementLabels(){ openLifeListEditor("movement"); }

function enabledJournalPages(){return JOURNAL_PAGES.filter(p=>journalPreferences.enabledPages.includes(p.id))}
function ensureLifeHabits(){
  const legacy=state.habitDefinitions.filter(h=>!h.kind);
  if(!legacy.length)return;
  const now=Date.now();
  const changed=[];
  state.habitDefinitions=state.habitDefinitions.map(h=>{
    if(h.kind)return h;
    const normalized={...h,kind:"adulting",updatedAt:now};
    changed.push(normalized);
    return normalized;
  });
  Promise.all(changed.map(record=>diaryRepository.save("habitDefinitions",record))).catch(error=>console.warn("Could not normalize older Fuwa habits.",error));
}
function lifeRecordForDate(date=activeLifeJournalDate){return state.dailyCheckins.find(r=>r.date===date)||null}
function lifeTodayRecord(){return lifeRecordForDate(isoToday())}
function lifeSetChoice(group,value){lifeDraft[group]=value;document.querySelectorAll(`[data-life-choice="${group}"]`).forEach(b=>b.classList.toggle("selected",b.dataset.value===value))}
function setInputValue(id,value){const el=$(id);if(el)el.value=value??""}
function setChecked(id,value){const el=$(id);if(el)el.checked=!!value}

function loadLifeJournalForm(date=activeLifeJournalDate){
  ensureLifeHabits();
  applyMovementLabels();

  activeLifeJournalDate=date||isoToday();
  const r=lifeRecordForDate(activeLifeJournalDate);
  journalPageIndex=Math.min(Number(r?.lastPageIndex||0),Math.max(0,enabledJournalPages().length-1));

  lifeDraft={
    rating:Number(r?.rating||0),
    mood:r?.mood||"",
    movement:r?.movement||"",
    weather:r?.weather||"",
    dream:r?.dream||"",
    cycle:r?.cycle||"",
    habits:{...(r?.habits||{})},
    customHabits:{...(r?.customHabits||{})}
  };

  const isToday=activeLifeJournalDate===isoToday();
  $("lifeTodayDateLabel").textContent=formatDate(activeLifeJournalDate,{weekday:"long",month:"long",day:"numeric"});
  $("lifeSaveStatus").textContent=r?(isToday?"Saved ✓":"Past journal"):(isToday?"Not checked in":"Unsaved");
  $("journalTodayButton")?.classList.toggle("hidden",isToday);
  if($("journalFinishButton"))$("journalFinishButton").textContent=isToday?"Finish for today ♡":"Save changes ♡";
  if($("journalCloseButton"))$("journalCloseButton").textContent=isToday?"Close Journal ♡":"Back to History ♡";

  [
    ["lifeRatingReason",r?.ratingReason],["lifeHighlight",r?.highlight],["lifeEnergy",r?.energy],["lifeSocial",r?.social],
    ["lifeSleepHours",r?.sleepHours],["lifeSleepQuality",r?.sleepQuality],["lifeWater",r?.water],["lifeOutside",r?.outside],
    ["lifeMovementMinutes",r?.movementMinutes],["lifeStress",r?.stress],["lifeCalm",r?.calm],["lifeMindNote",r?.mindNote],
    ["lifeReadingTitle",r?.readingTitle],["lifeReadingPages",r?.readingPages],["lifeReadingMinutes",r?.readingMinutes],
    ["lifeWatchedTitle",r?.watchedTitle],["lifeWatchedEpisode",r?.watchedEpisode],["lifeWatchedRating",r?.watchedRating],
    ["lifeSong",r?.song],["lifeTemperature",r?.temperature],["lifeDreamNote",r?.dreamNote],
    ["lifeGratitude1",Array.isArray(r?.gratitude)?r.gratitude[0]:r?.gratitude],
    ["lifeGratitude2",Array.isArray(r?.gratitude)?r.gratitude[1]:""],
    ["lifeGratitude3",Array.isArray(r?.gratitude)?r.gratitude[2]:""],
    ["lifeLearned",r?.learned],["lifeCupToday",r?.cupToday],["lifeLittleWin",r?.littleWin],["lifeMemory",r?.memory],
    ["lifeLookingForward",r?.lookingForward],["lifeTomorrowIntention",r?.tomorrowIntention],["lifeFoodMoment",r?.foodMoment],
    ["lifeFocus",r?.focus],["lifeWorkStudy",r?.workStudy],["lifeConnection",r?.connection],
    ["lifeConnectionNote",r?.connectionNote],["lifeMoneyNote",r?.moneyNote],["lifeScreenHours",r?.screenHours],
    ["lifeScreenFeeling",r?.screenFeeling],["lifeSelfCare",r?.selfCare],["lifeCreativeMinutes",r?.creativeMinutes],
    ["lifeCreativeNote",r?.creativeNote],["lifeAnticipation",r?.anticipation],["lifeDayWord",r?.dayWord],["lifeNote",r?.note]
  ].forEach(([id,v])=>setInputValue(id,v));

  setChecked("lifeSongRepeat",r?.songRepeat);
  setChecked("lifeNoSpend",r?.noSpend);

  document.querySelectorAll("#lifeDayRating button").forEach(b=>{
    const active=Number(b.dataset.rating)<=lifeDraft.rating;
    b.classList.toggle("selected",active);
    b.textContent=active?"★":"☆";
  });
  document.querySelectorAll("#lifeMoodPicker button").forEach(b=>b.classList.toggle("selected",b.dataset.lifeMood===lifeDraft.mood));
  ["movement","weather","dream","cycle"].forEach(group=>lifeSetChoice(group,lifeDraft[group]||""));

  renderLifeHabits();
  renderJournalPage();
  $("journalClosingPage")?.classList.add("hidden");
  $("lifeDailyForm")?.classList.remove("hidden");
}

function loadLifeTodayForm(){
  activeLifeJournalDate=isoToday();
  loadLifeJournalForm(activeLifeJournalDate);
}

function renderLifeHabits(){
  const renderGroup=(host,items,draftKey,dataAttr,emptyCopy)=>{
    if(!host)return;
    if(!items.length){host.innerHTML=`<p class="life-habit-empty">${escapeHtml(emptyCopy)}</p>`;return;}
    host.innerHTML=items.map(item=>`<button type="button" class="${lifeDraft[draftKey]?.[item.id]?"done":""}" ${dataAttr}="${escapeHtml(item.id)}"><span>${lifeDraft[draftKey]?.[item.id]?"✓":"○"}</span><strong>${escapeHtml(item.name)}</strong></button>`).join("");
    host.querySelectorAll(`[${dataAttr}]`).forEach(button=>button.addEventListener("click",()=>{
      const id=button.getAttribute(dataAttr);
      lifeDraft[draftKey]=lifeDraft[draftKey]||{};
      lifeDraft[draftKey][id]=!lifeDraft[draftKey][id];
      renderLifeHabits();
    }));
  };
  const adultItems=state.habitDefinitions.filter(item=>(item.kind||"adulting")==="adulting"&&item.active!==false);
  const personalItems=state.habitDefinitions.filter(item=>item.kind==="habit"&&item.active!==false);
  renderGroup($("lifeHabitGrid"),adultItems,"habits","data-adult-habit","Nothing here yet. Add the everyday things you actually want to track.");
  renderGroup($("lifeCustomHabitGrid"),personalItems,"customHabits","data-custom-habit","No personal habits yet. Add only the ones that matter to you.");
}

let lifeListEditorMode="";
let lifeListEditorPreviousOverflow="";

function parseLifeListEditor(value,limit=12){
  const names=[];
  const seen=new Set();
  String(value||"").split(/[\n,]+/).forEach(raw=>{
    const name=raw.replace(/\s+/g," ").trim().slice(0,48);
    const key=name.toLowerCase();
    if(!name||seen.has(key)||names.length>=limit)return;
    seen.add(key);
    names.push(name);
  });
  return names;
}

function lifeListEditorConfig(mode){
  if(mode==="movement"){
    const order=["none","walk","cardio","strength","yoga"];
    return {mode,title:"Movement choices",help:"Keep exactly five choices. Put one on each line, or separate them with commas.",max:5,exact:5,items:order.map(key=>lifeMovementLabels[key]),order};
  }
  const label=mode==="adulting"?"Adulting list":"Personal habits";
  const items=state.habitDefinitions.filter(item=>(item.kind||"adulting")===mode&&item.active!==false).map(item=>item.name);
  return {mode,title:label,help:"Write one item per line, or separate items with commas. You can also leave this list empty.",max:12,items};
}

function renderLifeListEditorPreview(){
  const config=lifeListEditorConfig(lifeListEditorMode);
  const input=$("lifeListEditorInput"),preview=$("lifeListEditorPreview"),count=$("lifeListEditorCount"),save=$("lifeListEditorSave");
  if(!input||!preview||!count||!save)return;
  const names=parseLifeListEditor(input.value,config.max);
  preview.innerHTML=names.length?names.map(name=>`<span>${escapeHtml(name)}</span>`).join(""):'<em>No items yet — that is okay.</em>';
  count.textContent=config.exact?`${names.length}/${config.exact} choices`:`${names.length}/${config.max} items`;
  save.disabled=!!config.exact&&names.length!==config.exact;
}

function closeLifeListEditor(){
  const modal=$("lifeListEditorModal");
  if(modal)modal.classList.add("hidden");
  document.body.classList.remove("life-list-editor-open");
  document.body.style.overflow=lifeListEditorPreviousOverflow;
  lifeListEditorMode="";
}

function openLifeListEditor(mode){
  const config=lifeListEditorConfig(mode);
  const modal=$("lifeListEditorModal"),input=$("lifeListEditorInput");
  if(!modal||!input)return;
  lifeListEditorMode=mode;
  lifeListEditorPreviousOverflow=document.body.style.overflow;
  $("lifeListEditorTitle").textContent=config.title;
  $("lifeListEditorHelp").textContent=config.help;
  input.value=config.items.join("\n");
  input.oninput=renderLifeListEditorPreview;
  $("lifeListEditorClose").onclick=closeLifeListEditor;
  $("lifeListEditorCancel").onclick=closeLifeListEditor;
  $("lifeListEditorSave").onclick=saveLifeListEditor;
  modal.onclick=event=>{if(event.target===modal)closeLifeListEditor();};
  modal.classList.remove("hidden");
  document.body.classList.add("life-list-editor-open");
  document.body.style.overflow="hidden";
  renderLifeListEditorPreview();
  window.setTimeout(()=>{try{input.focus({preventScroll:true});input.setSelectionRange(input.value.length,input.value.length);}catch(_){input.focus();}},120);
}

async function saveLifeListEditor(){
  const config=lifeListEditorConfig(lifeListEditorMode);
  const input=$("lifeListEditorInput");
  if(!input)return;
  const names=parseLifeListEditor(input.value,config.max);
  if(config.exact&&names.length!==config.exact)return toast(`Please keep exactly ${config.exact} movement choices.`);
  const saveButton=$("lifeListEditorSave");
  if(saveButton)saveButton.disabled=true;
  try{
    if(config.mode==="movement"){
      lifeMovementLabels=Object.fromEntries(config.order.map((key,index)=>[key,names[index].slice(0,24)]));
      try{localStorage.setItem(LIFE_MOVEMENT_LABELS_KEY,JSON.stringify(lifeMovementLabels));}catch(error){console.warn("Could not save movement labels.",error);}
      applyMovementLabels();
      lifeSetChoice("movement",lifeDraft.movement||"");
      closeLifeListEditor();
      toast("Movement choices updated ♡");
      return;
    }
    const kind=config.mode;
    const existing=state.habitDefinitions.filter(item=>(item.kind||"adulting")===kind);
    const byName=new Map(existing.map(item=>[String(item.name||"").toLowerCase(),item]));
    const now=Date.now();
    const next=names.map((name,index)=>{
      const found=byName.get(name.toLowerCase());
      return found?{...found,name,kind,active:true,updatedAt:now}:{id:uid(kind),name,kind,active:true,createdAt:now+index,updatedAt:now};
    });
    const keep=new Set(next.map(item=>item.id));
    const removed=existing.filter(item=>!keep.has(item.id)).map(item=>({...item,active:false,updatedAt:now}));
    state.habitDefinitions=state.habitDefinitions.filter(item=>(item.kind||"adulting")!==kind).concat(next,removed);
    await Promise.all([...next,...removed].map(record=>diaryRepository.save("habitDefinitions",record)));
    renderLifeHabits();
    closeLifeListEditor();
    toast(names.length?`${config.title} updated ♡`:`${config.title} cleared ♡`);
  }catch(error){
    console.error("Could not save Daily Life list.",error);
    toast("Fuwa couldn't save that list. Please try again.");
    renderLifeListEditorPreview();
  }finally{
    if(saveButton&&!lifeListEditorMode)saveButton.disabled=false;
    else renderLifeListEditorPreview();
  }
}

function editHabitKind(kind){openLifeListEditor(kind);}
function manageLifeHabits(){return editHabitKind("adulting");}
function manageCustomLifeHabits(){return editHabitKind("habit");}

function renderJournalSectionNavigation(pages,currentPage){
  const sectionTabs=$("journalSectionTabs");
  const pageList=$("journalPageJumpList");
  if(!sectionTabs||!pageList)return;

  const availableSections=JOURNAL_SECTION_ORDER.filter(group=>pages.some(page=>page.group===group));
  const currentGroup=currentPage.group;

  sectionTabs.innerHTML=availableSections.map(group=>`
    <button type="button" class="${group===currentGroup?"active":""}" data-journal-section="${escapeHtml(group)}">${escapeHtml(group)}</button>
  `).join("");

  sectionTabs.querySelectorAll("[data-journal-section]").forEach(button=>{
    button.addEventListener("click",()=>{
      const targetGroup=button.dataset.journalSection;
      const targetIndex=pages.findIndex(page=>page.group===targetGroup);
      if(targetIndex>=0){journalPageIndex=targetIndex;renderJournalPage()}
    });
  });

  const sectionPages=pages.filter(page=>page.group===currentGroup);
  pageList.innerHTML=sectionPages.map(page=>{
    const index=pages.findIndex(candidate=>candidate.id===page.id);
    return `<button type="button" class="${page.id===currentPage.id?"active":""}" data-journal-page-id="${escapeHtml(page.id)}"><span>${index+1}</span>${escapeHtml(page.label)}</button>`;
  }).join("");

  pageList.querySelectorAll("[data-journal-page-id]").forEach(button=>{
    button.addEventListener("click",()=>{
      const targetIndex=pages.findIndex(page=>page.id===button.dataset.journalPageId);
      if(targetIndex>=0){journalPageIndex=targetIndex;renderJournalPage()}
    });
  });

  sectionTabs.querySelector(".active")?.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"});
  pageList.querySelector(".active")?.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"});
}

function renderJournalPage(){
  const pages=enabledJournalPages();
  if(!pages.length)return;
  journalPageIndex=Math.max(0,Math.min(journalPageIndex,pages.length-1));
  const currentPage=pages[journalPageIndex];
  const id=currentPage.id;

  document.querySelectorAll(".journal-page").forEach(section=>{
    const active=section.dataset.journalPage===id;
    section.classList.toggle("active",active);
    if(active){
      const eyebrow=section.querySelector(":scope > .eyebrow");
      if(eyebrow)eyebrow.textContent=`${currentPage.group} · ${currentPage.label}`;
    }
  });

  $("journalPageCounter").textContent=`Page ${journalPageIndex+1} of ${pages.length}`;
  $("journalBackButton").disabled=journalPageIndex===0;
  $("journalNextButton").classList.toggle("hidden",journalPageIndex===pages.length-1);
  $("journalSkipButton").classList.toggle("hidden",journalPageIndex===pages.length-1);
  $("journalFinishButton").classList.remove("hidden");

  $("journalProgressDots").innerHTML=pages.map((page,index)=>`<button type="button" class="${index===journalPageIndex?"active":index<journalPageIndex?"visited":""}" data-journal-jump="${index}" aria-label="${escapeHtml(page.label)}"></button>`).join("");
  $("journalProgressDots").querySelectorAll("[data-journal-jump]").forEach(button=>button.addEventListener("click",()=>{
    journalPageIndex=Number(button.dataset.journalJump);
    renderJournalPage();
  }));

  renderJournalSectionNavigation(pages,currentPage);
}
function journalNext(){if(journalPageIndex<enabledJournalPages().length-1){journalPageIndex++;renderJournalPage()}}function journalBack(){if(journalPageIndex>0){journalPageIndex--;renderJournalPage()}}
function valueOrNull(id,num=false){const el=$(id);if(!el||el.value==="")return null;return num?Number(el.value):el.value.trim()}
async function saveLifeToday(event){
  event.preventDefault();
  const date=activeLifeJournalDate||isoToday();
  const existing=lifeRecordForDate(date);
  const gratitude=[valueOrNull("lifeGratitude1"),valueOrNull("lifeGratitude2"),valueOrNull("lifeGratitude3")].filter(Boolean);

  const record={
    id:existing?.id||`daily_${date}`,
    date,
    rating:Number(lifeDraft.rating||0),
    ratingReason:valueOrNull("lifeRatingReason")||"",
    mood:lifeDraft.mood||"",
    highlight:valueOrNull("lifeHighlight")||"",
    energy:valueOrNull("lifeEnergy",true),
    social:valueOrNull("lifeSocial",true),
    sleepHours:valueOrNull("lifeSleepHours",true),
    sleepQuality:valueOrNull("lifeSleepQuality",true),
    water:valueOrNull("lifeWater",true),
    outside:valueOrNull("lifeOutside",true),
    movementMinutes:valueOrNull("lifeMovementMinutes",true),
    movement:lifeDraft.movement||"",
    stress:valueOrNull("lifeStress",true),
    calm:valueOrNull("lifeCalm",true),
    mindNote:valueOrNull("lifeMindNote")||"",
    habits:{...lifeDraft.habits},
    customHabits:{...lifeDraft.customHabits},
    readingTitle:valueOrNull("lifeReadingTitle")||"",
    readingPages:valueOrNull("lifeReadingPages",true),
    readingMinutes:valueOrNull("lifeReadingMinutes",true),
    watchedTitle:valueOrNull("lifeWatchedTitle")||"",
    watchedEpisode:valueOrNull("lifeWatchedEpisode")||"",
    watchedRating:valueOrNull("lifeWatchedRating",true),
    song:valueOrNull("lifeSong")||"",
    songRepeat:!!$("lifeSongRepeat")?.checked,
    weather:lifeDraft.weather||"",
    temperature:valueOrNull("lifeTemperature",true),
    dream:lifeDraft.dream||"",
    dreamNote:valueOrNull("lifeDreamNote")||"",
    gratitude,
    learned:valueOrNull("lifeLearned")||"",
    cupToday:valueOrNull("lifeCupToday")||"",
    littleWin:valueOrNull("lifeLittleWin")||"",
    memory:valueOrNull("lifeMemory")||"",
    lookingForward:valueOrNull("lifeLookingForward")||"",
    tomorrowIntention:valueOrNull("lifeTomorrowIntention")||"",
    foodMoment:valueOrNull("lifeFoodMoment")||"",
    focus:valueOrNull("lifeFocus",true),
    workStudy:valueOrNull("lifeWorkStudy")||"",
    connection:valueOrNull("lifeConnection",true),
    connectionNote:valueOrNull("lifeConnectionNote")||"",
    noSpend:!!$("lifeNoSpend")?.checked,
    moneyNote:valueOrNull("lifeMoneyNote")||"",
    screenHours:valueOrNull("lifeScreenHours",true),
    screenFeeling:valueOrNull("lifeScreenFeeling")||"",
    selfCare:valueOrNull("lifeSelfCare")||"",
    creativeMinutes:valueOrNull("lifeCreativeMinutes",true),
    creativeNote:valueOrNull("lifeCreativeNote")||"",
    anticipation:valueOrNull("lifeAnticipation")||"",
    dayWord:valueOrNull("lifeDayWord")||"",
    note:valueOrNull("lifeNote")||"",
    cycle:lifeDraft.cycle||"",
    lastPageIndex:0,
    completedAt:existing?.completedAt||Date.now(),
    createdAt:existing?.createdAt||Date.now(),
    updatedAt:Date.now()
  };

  await diaryRepository.save("dailyCheckins",record);
  state.dailyCheckins=existing
    ? state.dailyCheckins.map(item=>item.id===record.id?record:item)
    : [...state.dailyCheckins,record];

  $("lifeSaveStatus").textContent="Saved ✓";
  renderLifeTracker();
  renderLifeHistory();
  renderLifeDashboard();
  showJournalClosing(record);
}

function showJournalClosing(record){
  $("lifeDailyForm").classList.add("hidden");
  $("journalClosingPage").classList.remove("hidden");
  $("journalClosingDate").textContent=formatDate(record.date);
  const stars=record.rating?`${"★".repeat(record.rating)}${"☆".repeat(5-record.rating)}`:"";
  $("journalClosingTitle").textContent=record.date===isoToday()?"You showed up for your day.":"That day is updated.";
  $("journalClosingSummary").textContent=[
    record.mood?(moodLabels[record.mood]||record.mood):"",
    stars,
    record.highlight||""
  ].filter(Boolean).join(" · ")||"This day is safely tucked away.";
}

function closeJournal(){
  const wasPast=activeLifeJournalDate!==isoToday();
  $("journalClosingPage").classList.add("hidden");
  $("lifeDailyForm").classList.remove("hidden");
  journalPageIndex=0;

  if(wasPast){
    activeLifeJournalDate=isoToday();
    setLifeTab("history",{preserveDate:true});
    return;
  }

  activeLifeJournalDate=isoToday();
  renderJournalPage();
  navigate("home");
}

function returnLifeJournalToToday(){
  activeLifeJournalDate=isoToday();
  loadLifeJournalForm(activeLifeJournalDate);
}

function updateJournalSelectionCount(){
  const count=$("journalPageSettingsList")?.querySelectorAll('input[type="checkbox"]:checked').length||0;
  if($("journalPageSelectionCount"))$("journalPageSelectionCount").textContent=`${count} of ${JOURNAL_PAGES.length} pages selected`;
}
function applyJournalPreset(name){
  const preset=JOURNAL_PRESETS[name];
  if(!preset)return;
  const selected=new Set(preset);
  $("journalPageSettingsList")?.querySelectorAll('input[type="checkbox"]').forEach(input=>{input.checked=selected.has(input.value)});
  document.querySelectorAll("[data-journal-preset]").forEach(button=>button.classList.toggle("active",button.dataset.journalPreset===name));
  updateJournalSelectionCount();
}
function openJournalCustomizer(){
  const host=$("journalPageSettingsList");
  const groups=JOURNAL_SECTION_ORDER;
  host.innerHTML=groups.map(group=>{
    const pages=JOURNAL_PAGES.filter(page=>page.group===group);
    return `<section class="journal-settings-group"><p>${escapeHtml(group)}</p>${pages.map(p=>`<label class="journal-page-setting"><input type="checkbox" value="${p.id}" ${journalPreferences.enabledPages.includes(p.id)?"checked":""}><span>${escapeHtml(p.label)}</span></label>`).join("")}</section>`;
  }).join("");
  host.querySelectorAll('input[type="checkbox"]').forEach(input=>input.addEventListener("change",()=>{document.querySelectorAll("[data-journal-preset]").forEach(button=>button.classList.remove("active"));updateJournalSelectionCount()}));
  document.querySelectorAll("[data-journal-preset]").forEach(button=>{button.onclick=()=>applyJournalPreset(button.dataset.journalPreset)});
  updateJournalSelectionCount();
  $("journalCustomizeSheet").classList.remove("hidden");
}
function closeJournalCustomizer(){$("journalCustomizeSheet").classList.add("hidden")}
function saveJournalCustomizer(){
  const selected=[...$("journalPageSettingsList").querySelectorAll('input[type="checkbox"]:checked')].map(i=>i.value);
  if(!selected.length)return toast("Keep at least one journal page.");
  journalPreferences.enabledPages=selected;
  saveJournalPreferences();
  closeJournalCustomizer();
  journalPageIndex=0;
  renderJournalPage();
  toast(`${selected.length} Daily Life pages saved ♡`);
}
function lifeMetricValue(r,m){if(m==="rating")return r.rating||null;if(m==="mood")return({amazing:5,good:4,neutral:3,tired:2,sad:1,angry:1})[r.mood]||null;if(m==="sleep")return r.sleepHours??null;if(m==="energy")return r.energy??null;if(m==="stress")return r.stress??null;if(m==="reading")return r.readingPages??null;if(m==="movement")return r.movement?({none:1,walk:2,yoga:3,cardio:4,strength:5})[r.movement]||2:null;if(m==="weather")return r.weather?({stormy:1,rainy:1,cloudy:2,partly:3,sunny:4})[r.weather]||2:null;if(m==="dream")return r.dream?({none:1,scary:2,sad:2,weird:3,romantic:4,happy:5})[r.dream]||3:null;if(m==="cycle")return r.cycle?({none:1,spotting:2,light:3,regular:4,heavy:5})[r.cycle]||1:null;return null}
function lifeMetricLevel(m,v){if(v==null||v==="")return 0;if(m==="sleep")return v>=8?5:v>=7?4:v>=6?3:v>=5?2:1;if(m==="reading")return v>=80?5:v>=50?4:v>=20?3:v>0?2:1;return Math.max(1,Math.min(5,Math.round(Number(v))))}
function renderLifeTracker(){const host=$("lifeYearTracker");if(!host)return;$("lifeTrackerYear").textContent=lifeTrackerYear;const records=new Map(state.dailyCheckins.filter(r=>String(r.date).startsWith(`${lifeTrackerYear}-`)).map(r=>[r.date,r])),months=["J","F","M","A","M","J","J","A","S","O","N","D"];let html=`<div class="tracker-corner"></div>${months.map(m=>`<div class="tracker-month-label">${m}</div>`).join("")}`;for(let day=1;day<=31;day++){html+=`<div class="tracker-day-label">${day}</div>`;for(let month=1;month<=12;month++){const max=new Date(lifeTrackerYear,month,0).getDate();if(day>max){html+=`<div class="tracker-cell invalid"></div>`;continue}const date=`${lifeTrackerYear}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`,r=records.get(date),v=r?lifeMetricValue(r,lifeTrackerMetric):null,l=lifeMetricLevel(lifeTrackerMetric,v);html+=`<button type="button" class="tracker-cell level-${l}" data-life-history-date="${date}"></button>`}}host.innerHTML=html;host.querySelectorAll("[data-life-history-date]").forEach(b=>b.addEventListener("click",()=>{setLifeTab("history",{preserveDate:true});showLifeHistoryDate(b.dataset.lifeHistoryDate)}));renderLifeTrackerLegend()}
function renderLifeTrackerLegend(){const movementLegend=["No entry",lifeMovementLabels.none,lifeMovementLabels.walk,lifeMovementLabels.yoga,lifeMovementLabels.cardio,lifeMovementLabels.strength];const labels={rating:["No entry","1","2","3","4","5"],mood:["No entry","Heavy","Low","Okay","Good","Amazing"],sleep:["No entry","<5h","5–6h","6–7h","7–8h","8h+"],energy:["No entry","Very low","Low","Okay","Good","High"],stress:["No entry","Peaceful","Low","Moderate","High","Overwhelmed"],reading:["No entry","0","1–19","20–49","50–79","80+"],movement:movementLegend,weather:["No entry","Rain","Cloud","Partly","Sunny","Sunny"],dream:["No entry","No dream","Heavy","Weird","Good","Happy"],cycle:["No entry","None","Spotting","Light","Regular","Heavy"]}[lifeTrackerMetric]||[];$("lifeTrackerLegend").innerHTML=labels.map((x,i)=>`<span><i class="level-${i}"></i>${escapeHtml(x)}</span>`).join("")}
function lifeValueLabel(value,labels={}){
  if(value===null||value===undefined||value==="")return "";
  return labels[value]||labels[String(value)]||String(value);
}

function lifeHabitNames(record,kind){
  const source=kind==="habit"?record.customHabits:record.habits;
  if(!source||typeof source!=="object")return [];
  const chosen=new Set(Object.entries(source).filter(([,done])=>done).map(([id])=>id));
  return state.habitDefinitions
    .filter(item=>(item.kind||"adulting")===kind&&chosen.has(item.id))
    .map(item=>item.name);
}

function lifeHistorySections(record){
  const movement=lifeMovementLabels[record.movement]||record.movement||"";
  const weather=lifeValueLabel(record.weather,{sunny:"Sunny",partly:"Partly cloudy",cloudy:"Cloudy",rainy:"Rainy",stormy:"Stormy"});
  const dream=lifeValueLabel(record.dream,{none:"No dream",scary:"Scary",sad:"Sad",weird:"Weird",romantic:"Romantic",happy:"Happy"});
  const cycle=lifeValueLabel(record.cycle,{none:"None",spotting:"Spotting",light:"Light",regular:"Regular",heavy:"Heavy"});
  const screenFeeling=lifeValueLabel(record.screenFeeling,{intentional:"Intentional",fine:"Fine",restful:"Restful","too-much":"A bit too much",draining:"Draining"});
  const adulting=lifeHabitNames(record,"adulting");
  const habits=lifeHabitNames(record,"habit");

  const sections=[
    {
      title:"Check In",
      rows:[
        ["Mood",record.mood?(moodLabels[record.mood]||record.mood):""],
        ["Day rating",record.rating?`${record.rating}/5`:""],
        ["Why",record.ratingReason],
        ["Energy",record.energy?`${record.energy}/5`:""],
        ["Social battery",record.social?`${record.social}/5`:""],
        ["Sleep",record.sleepHours!==null&&record.sleepHours!==undefined&&record.sleepHours!==""?`${record.sleepHours} hours`:""],
        ["Sleep quality",record.sleepQuality?`${record.sleepQuality}/5`:""],
        ["Water",record.water!==null&&record.water!==undefined&&record.water!==""?`${record.water} glasses`:""],
        ["Outside time",lifeValueLabel(record.outside,{0:"None",1:"<30 min",2:"30–60 min",3:"1h+"})],
        ["Movement",movement],
        ["Movement minutes",record.movementMinutes!==null&&record.movementMinutes!==undefined&&record.movementMinutes!==""?`${record.movementMinutes} min`:""],
        ["Stress",record.stress?`${record.stress}/5`:""],
        ["Calmness",record.calm?`${record.calm}/5`:""],
        ["On my mind",record.mindNote]
      ]
    },
    {
      title:"Day & Routine",
      rows:[
        ["Highlight",record.highlight],
        ["Adulting",adulting.join(" · ")],
        ["Habits",habits.join(" · ")],
        ["Work / Study",record.workStudy],
        ["Focus",record.focus?`${record.focus}/5`:""],
        ["Money",record.moneyNote],
        ["No-spend day",record.noSpend?"Yes":""],
        ["Screen time",record.screenHours!==null&&record.screenHours!==undefined&&record.screenHours!==""?`${record.screenHours} hours`:""],
        ["Screen felt",screenFeeling]
      ]
    },
    {
      title:"Little Life",
      rows:[
        ["Reading",record.readingTitle],
        ["Reading pages",record.readingPages!==null&&record.readingPages!==undefined&&record.readingPages!==""?String(record.readingPages):""],
        ["Reading minutes",record.readingMinutes!==null&&record.readingMinutes!==undefined&&record.readingMinutes!==""?`${record.readingMinutes} min`:""],
        ["Watching",record.watchedTitle],
        ["Episode / part",record.watchedEpisode],
        ["Watch rating",record.watchedRating?`${record.watchedRating}/5`:""],
        ["Listening",record.song],
        ["On repeat",record.songRepeat?"Yes":""],
        ["Weather",weather],
        ["Temperature",record.temperature!==null&&record.temperature!==undefined&&record.temperature!==""?String(record.temperature):""],
        ["Food & appetite",record.foodMoment],
        ["Connection",record.connection?`${record.connection}/5`:""],
        ["With",record.connectionNote],
        ["Self-care",record.selfCare],
        ["Creativity",record.creativeNote],
        ["Creative minutes",record.creativeMinutes!==null&&record.creativeMinutes!==undefined&&record.creativeMinutes!==""?`${record.creativeMinutes} min`:""]
      ]
    },
    {
      title:"Reflect & Remember",
      rows:[
        ["Dream",dream],
        ["Dream note",record.dreamNote],
        ["Gratitude",Array.isArray(record.gratitude)?record.gratitude.join(" · "):(record.gratitude||"")],
        ["Something I learned",record.learned],
        ["Filled my cup",record.cupToday],
        ["Little win",record.littleWin],
        ["Memory",record.memory],
        ["Tomorrow",record.tomorrowIntention],
        ["Looking forward to",record.anticipation||record.lookingForward],
        ["One word",record.dayWord],
        ["Free page",record.note],
        ["Cycle note",cycle]
      ]
    }
  ];

  return sections
    .map(section=>({...section,rows:section.rows.filter(([,value])=>value!==null&&value!==undefined&&String(value).trim()!=="")}))
    .filter(section=>section.rows.length);
}

function showLifeHistoryDate(date){
  const record=state.dailyCheckins.find(item=>item.date===date);
  const host=$("lifeHistoryDetail");
  if(!record||!host)return;

  lifeHistorySelectedDate=date;
  const sections=lifeHistorySections(record);

  host.innerHTML=`
    <div class="life-history-detail-head">
      <div>
        <p class="eyebrow">Saved Daily Life journal</p>
        <h3>${escapeHtml(formatDate(record.date,{weekday:"long",month:"long",day:"numeric",year:"numeric"}))}</h3>
      </div>
      <button type="button" data-life-history-close aria-label="Close past journal">×</button>
    </div>
    <div class="life-history-detail-summary">
      ${record.mood?`<span>${escapeHtml(moodLabels[record.mood]||record.mood)}</span>`:""}
      ${record.rating?`<span>${"★".repeat(record.rating)}${"☆".repeat(5-record.rating)}</span>`:""}
      ${record.highlight?`<span>${escapeHtml(record.highlight)}</span>`:""}
    </div>
    ${sections.length?sections.map(section=>`
      <section class="life-history-section">
        <h4>${escapeHtml(section.title)}</h4>
        ${section.rows.map(([label,value])=>`
          <div class="life-history-answer"><span>${escapeHtml(label)}</span><p>${escapeHtml(String(value))}</p></div>
        `).join("")}
      </section>
    `).join(""):`<div class="empty-state compact">This journal was saved with no written answers.</div>`}
    <button type="button" class="life-history-edit-main" data-life-history-edit="${escapeHtml(record.date)}">Edit this journal</button>
  `;
  host.classList.remove("hidden");
  host.querySelector("[data-life-history-close]")?.addEventListener("click",closeLifeHistoryDetail);
  host.querySelector("[data-life-history-edit]")?.addEventListener("click",()=>editLifeHistoryDate(record.date));
  host.scrollIntoView({behavior:"smooth",block:"start"});
}

function closeLifeHistoryDetail(){
  lifeHistorySelectedDate="";
  const host=$("lifeHistoryDetail");
  if(host){host.classList.add("hidden");host.innerHTML=""}
}

function editLifeHistoryDate(date){
  if(!state.dailyCheckins.some(item=>item.date===date))return;
  activeLifeJournalDate=date;
  closeLifeHistoryDetail();
  setLifeTab("journal",{preserveDate:true});
}

function renderLifeHistory(){
  const host=$("lifeHistoryList");
  if(!host)return;

  const items=[...state.dailyCheckins].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  if($("lifeHistoryCount"))$("lifeHistoryCount").textContent=`${items.length} saved`;

  const shown=items.slice(0,lifeHistoryVisibleCount);
  host.innerHTML=shown.length?shown.map(record=>`
    <article class="life-history-card">
      <div class="life-history-card-main">
        <span>${escapeHtml(formatDate(record.date))}</span>
        <strong>${escapeHtml(record.highlight||record.memory||record.dayWord||"Daily check-in")}</strong>
        <p>${escapeHtml((Array.isArray(record.gratitude)?record.gratitude.join(" · "):record.gratitude)||record.note||record.learned||"")}</p>
        <small>${record.rating?`${"★".repeat(record.rating)} `:""}${record.mood?escapeHtml(moodLabels[record.mood]||record.mood):""}</small>
      </div>
      <div class="life-history-card-actions">
        <button type="button" data-life-history-view="${escapeHtml(record.date)}">View</button>
        <button type="button" data-life-history-edit="${escapeHtml(record.date)}">Edit</button>
      </div>
    </article>
  `).join(""):`<div class="empty-state">Your first completed Daily Life journal will appear here.</div>`;

  host.querySelectorAll("[data-life-history-view]").forEach(button=>button.addEventListener("click",()=>showLifeHistoryDate(button.dataset.lifeHistoryView)));
  host.querySelectorAll("[data-life-history-edit]").forEach(button=>button.addEventListener("click",()=>editLifeHistoryDate(button.dataset.lifeHistoryEdit)));

  const more=$("lifeHistoryLoadMore");
  if(more){
    more.classList.toggle("hidden",items.length<=lifeHistoryVisibleCount);
    more.textContent=`Show older journals${items.length>lifeHistoryVisibleCount?` · ${items.length-lifeHistoryVisibleCount} more`:""}`;
  }
}

function averageDaily(records,key){
  const values=records.map(record=>Number(record[key])).filter(value=>Number.isFinite(value)&&value>0);
  return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
}

function renderLifeDashboard(){
  const stats=$("lifeDashboardStats");
  const note=$("lifeDashboardNote");
  const recent=$("lifeDashboardRecent");
  if(!stats||!note||!recent)return;

  const now=new Date();
  const prefix=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const monthRecords=state.dailyCheckins.filter(record=>String(record.date||"").startsWith(prefix));
  const rating=averageDaily(monthRecords,"rating");
  const sleep=averageDaily(monthRecords,"sleepHours");
  const energy=averageDaily(monthRecords,"energy");

  const moodCounts={};
  monthRecords.forEach(record=>{if(record.mood)moodCounts[record.mood]=(moodCounts[record.mood]||0)+1});
  const topMood=Object.entries(moodCounts).sort((a,b)=>b[1]-a[1])[0]?.[0]||"";

  if($("lifeDashboardMonth")){
    $("lifeDashboardMonth").textContent=new Intl.DateTimeFormat("en-US",{month:"long",year:"numeric"}).format(now);
  }

  stats.innerHTML=[
    ["Check-ins",String(monthRecords.length),"days saved"],
    ["Avg. day",rating?`${rating.toFixed(1)}/5`:"—","from rated days"],
    ["Avg. sleep",sleep?`${sleep.toFixed(1)}h`:"—","when logged"],
    ["Avg. energy",energy?`${energy.toFixed(1)}/5`:"—","when logged"]
  ].map(([label,value,copy])=>`
    <div class="life-dashboard-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(copy)}</small></div>
  `).join("");

  if(!monthRecords.length){
    note.innerHTML=`<span>☁️</span><div><strong>Your dashboard is waiting.</strong><p>Complete even a short journal and Fuwa will begin showing your month here.</p></div>`;
  }else{
    const topMoodCopy=topMood?` Your most common logged mood has been ${moodLabels[topMood]||topMood}.`:"";
    note.innerHTML=`<span>✦</span><div><strong>${monthRecords.length===1?"One day is already enough to begin.":`${monthRecords.length} days are tucked into this month.`}</strong><p>${escapeHtml(topMoodCopy.trim()||"Keep checking in only when it feels useful.")}</p></div>`;
  }

  const lastSeven=[...state.dailyCheckins].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,7).reverse();
  recent.innerHTML=lastSeven.length?`
    <div class="life-dashboard-recent-head"><span>Recent rhythm</span><small>Last ${lastSeven.length} saved days</small></div>
    <div class="life-dashboard-days">${lastSeven.map(record=>`
      <button type="button" data-dashboard-history="${escapeHtml(record.date)}" title="${escapeHtml(formatDate(record.date))}">
        <span>${escapeHtml(new Intl.DateTimeFormat("en-US",{weekday:"narrow"}).format(new Date(`${record.date}T12:00:00`)))}</span>
        <i class="dashboard-mood mood-${escapeHtml(record.mood||"empty")}"></i>
        <small>${escapeHtml(String(Number(record.date.slice(-2))))}</small>
      </button>
    `).join("")}</div>
  `:"";

  recent.querySelectorAll("[data-dashboard-history]").forEach(button=>button.addEventListener("click",()=>{
    setLifeTab("history",{preserveDate:true});
    showLifeHistoryDate(button.dataset.dashboardHistory);
  }));
}

function lifeCollectionCategoryLabel(c){return({cup:"Fill My Cup",wishlist:"Wishlist",playlist:"Playlist",watched:"Shows & Movies",reminder:"Reminders"})[c]||"Collection"}
function renderLifeCollections(){const host=$("lifeCollectionList");if(!host)return;const items=state.lifeCollections.filter(i=>i.category===lifeCollectionCategory).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));$("lifeCollectionRatingWrap").classList.toggle("hidden",lifeCollectionCategory!=="watched");host.innerHTML=items.length?items.map(i=>`<article class="life-collection-item"><div><span>${escapeHtml(lifeCollectionCategoryLabel(i.category))}</span><strong>${escapeHtml(i.title)}</strong>${i.note?`<p>${escapeHtml(i.note)}</p>`:""}${i.rating?`<small>${"★".repeat(Number(i.rating))}</small>`:""}</div><button type="button" data-life-collection-delete="${escapeHtml(i.id)}">×</button></article>`).join(""):`<div class="empty-state">Nothing here yet. Add the first little thing.</div>`;host.querySelectorAll("[data-life-collection-delete]").forEach(b=>b.addEventListener("click",async()=>{if(!confirm("Remove this item?"))return;await diaryRepository.remove("lifeCollections",b.dataset.lifeCollectionDelete);state.lifeCollections=state.lifeCollections.filter(x=>x.id!==b.dataset.lifeCollectionDelete);renderLifeCollections()}))}
async function saveLifeCollection(e){e.preventDefault();const title=$("lifeCollectionTitle").value.trim();if(!title)return;const r={id:uid("collection"),category:lifeCollectionCategory,title,note:$("lifeCollectionNote").value.trim(),rating:lifeCollectionCategory==="watched"?Number($("lifeCollectionRating").value||0):0,createdAt:Date.now(),updatedAt:Date.now()};await diaryRepository.save("lifeCollections",r);state.lifeCollections.push(r);e.target.reset();renderLifeCollections();toast("Added to your Fuwa pages ♡")}

const MOMENT_TYPES={food:{label:"Food / Restaurant",icon:"🍜"},purchase:{label:"Purchase",icon:"🛍"},trip:{label:"Trip",icon:"✈️"},first:{label:"First",icon:"🌱"},achievement:{label:"Achievement",icon:"🏆"},quote:{label:"Funny Quote",icon:"😂"},event:{label:"Event",icon:"🎉"},person:{label:"Person",icon:"💗"},gift:{label:"Gift",icon:"🎁"},place:{label:"Place",icon:"📍"},other:{label:"Other",icon:"✨"}};
let momentFilter="all";
function momentTypeMeta(type){return MOMENT_TYPES[type]||MOMENT_TYPES.other;}

function renderMomentAdaptiveFields(){
  const type=$("momentType")?.value||"other",host=$("momentAdaptiveFields");if(!host)return;
  let html="";
  if(type==="food")html=`<div class="moment-two-field"><label>Dish / order<input id="momentExtraA" maxlength="160" placeholder="What did you have?"></label><label>Rating<select id="momentRating"><option value="">—</option><option value="1">★</option><option value="2">★★</option><option value="3">★★★</option><option value="4">★★★★</option><option value="5">★★★★★</option></select></label></div>`;
  else if(type==="purchase")html=`<div class="moment-two-field"><label>Item<input id="momentExtraA" maxlength="160" placeholder="What did you buy?"></label><label>Amount<input id="momentAmount" type="number" min="0" step="0.01" inputmode="decimal"></label></div>`;
  else if(type==="quote")html=`<label>Who said it?<input id="momentExtraA" maxlength="120" placeholder="Name or nickname"></label><label>Exact quote<textarea id="momentQuote" rows="4" maxlength="500" placeholder="“...”"></textarea></label>`;
  else if(type==="trip")html=`<div class="moment-two-field"><label>Destination<input id="momentExtraA" maxlength="160"></label><label>Trip note<input id="momentExtraB" maxlength="160" placeholder="Day trip, vacation…"></label></div>`;
  else if(type==="first")html=`<label>First time doing…<input id="momentExtraA" maxlength="180"></label>`;
  else if(type==="achievement")html=`<label>What did you accomplish?<input id="momentExtraA" maxlength="180"></label>`;
  else html=`<label>Extra detail<input id="momentExtraA" maxlength="180" placeholder="Optional"></label>`;
  host.innerHTML=html;
}

function openMomentModal(id=null){
  const item=id?state.moments.find(x=>x.id===id):null;
  $("momentModalTitle").textContent=item?"Edit Moment":"Add a little moment";
  $("momentId").value=item?.id||"";$("momentTitle").value=item?.title||"";$("momentType").value=item?.type||"food";$("momentDate").value=item?.date||isoToday();$("momentPlace").value=item?.place||"";$("momentNote").value=item?.note||"";$("momentTags").value=(item?.tags||[]).join(", ");$("momentIncludeWrapped").checked=item?.includeWrapped!==false;$("momentDeleteButton").classList.toggle("hidden",!item);
  renderMomentAdaptiveFields();
  queueMicrotask(()=>{if($("momentExtraA"))$("momentExtraA").value=item?.extraA||"";if($("momentExtraB"))$("momentExtraB").value=item?.extraB||"";if($("momentAmount"))$("momentAmount").value=item?.amount??"";if($("momentRating"))$("momentRating").value=item?.rating??"";if($("momentQuote"))$("momentQuote").value=item?.quote||"";});
  $("momentModal").classList.remove("hidden");document.body.style.overflow="hidden";
}
function closeMomentModal(){$("momentModal").classList.add("hidden");document.body.style.overflow="";}

async function saveMoment(event){
  event.preventDefault();const id=$("momentId").value,existing=id?state.moments.find(x=>x.id===id):null;
  const amountEl=$("momentAmount"),ratingEl=$("momentRating");
  const record={id:existing?.id||uid("moment"),title:$("momentTitle").value.trim(),type:$("momentType").value,date:$("momentDate").value||isoToday(),place:$("momentPlace").value.trim(),extraA:$("momentExtraA")?.value?.trim?.()||"",extraB:$("momentExtraB")?.value?.trim?.()||"",amount:amountEl&&amountEl.value!==""?Number(amountEl.value):null,rating:ratingEl&&ratingEl.value!==""?Number(ratingEl.value):null,quote:$("momentQuote")?.value?.trim?.()||"",note:$("momentNote").value.trim(),tags:$("momentTags").value.split(",").map(v=>v.trim().replace(/^#/,"")).filter(Boolean),includeWrapped:$("momentIncludeWrapped").checked,createdAt:existing?.createdAt||Date.now(),updatedAt:Date.now()};
  if(!record.title)return toast("Add what happened first.");
  await diaryRepository.save("moments",record);state.moments=existing?state.moments.map(x=>x.id===record.id?record:x):[...state.moments,record];closeMomentModal();renderMoments();renderWrappedPreview();toast("Little moment saved ✦");
}
async function deleteMoment(){const id=$("momentId").value;if(!id||!confirm("Delete this little moment?"))return;await diaryRepository.remove("moments",id);state.moments=state.moments.filter(x=>x.id!==id);closeMomentModal();renderMoments();renderWrappedPreview();}

function renderMoments(){
  const host=$("momentsList");if(!host)return;
  const items=[...state.moments].filter(x=>momentFilter==="all"||x.type===momentFilter).sort((a,b)=>String(b.date).localeCompare(String(a.date))||(b.createdAt||0)-(a.createdAt||0));
  host.innerHTML=items.length?items.map(item=>{const meta=momentTypeMeta(item.type),extra=item.quote?`“${escapeHtml(item.quote)}”`:item.extraA?escapeHtml(item.extraA):item.note?escapeHtml(item.note):"";return `<article class="moment-card"><button type="button" data-moment-open="${escapeHtml(item.id)}"><span class="moment-type-icon">${meta.icon}</span><div><small>${escapeHtml(formatDate(item.date))}${item.place?` · ${escapeHtml(item.place)}`:""}</small><strong>${escapeHtml(item.title)}</strong>${extra?`<p>${extra}</p>`:""}<span class="moment-type-label">${escapeHtml(meta.label)}${item.includeWrapped===false?" · Hidden from Wrapped":""}</span></div></button></article>`;}).join(""):`<div class="empty-state">No little moments yet. Add something Future You would smile at.</div>`;
  host.querySelectorAll("[data-moment-open]").forEach(button=>button.addEventListener("click",()=>openMomentModal(button.dataset.momentOpen)));
}
function momentYearItems(year){return state.moments.filter(item=>String(item.date||"").startsWith(`${year}-`)&&item.includeWrapped!==false);}
function wrappedStats(year){const items=momentYearItems(year),byType={};items.forEach(x=>byType[x.type]=(byType[x.type]||0)+1);const ratings=items.filter(x=>Number(x.rating)>0).sort((a,b)=>Number(b.rating)-Number(a.rating));const quote=items.find(x=>x.type==="quote"&&x.quote)||null,places=new Set(items.map(x=>x.place).filter(Boolean));return{items,byType,topRated:ratings[0]||null,quote,places:places.size};}
function renderWrappedPreview(){const year=new Date().getFullYear(),s=wrappedStats(year);$("wrappedYearLabel").textContent=year;$("wrappedPreviewStats").innerHTML=`<span><strong>${s.items.length}</strong> moments</span><span><strong>${s.byType.first||0}</strong> firsts</span><span><strong>${s.byType.achievement||0}</strong> wins</span><span><strong>${s.places}</strong> places</span>`;}
function wrappedDailySummary(year){const checkins=state.dailyCheckins.filter(x=>String(x.date||"").startsWith(`${year}-`)),moods={};checkins.forEach(x=>{if(x.mood)moods[x.mood]=(moods[x.mood]||0)+1;});const topMood=Object.entries(moods).sort((a,b)=>b[1]-a[1])[0]?.[0]||"";const rated=checkins.filter(x=>x.rating);return{count:checkins.length,topMood,avgRating:rated.length?(rated.reduce((s,x)=>s+Number(x.rating),0)/rated.length).toFixed(1):null};}
function openWrapped(){const year=new Date().getFullYear(),s=wrappedStats(year),daily=wrappedDailySummary(year),topFood=s.items.filter(x=>x.type==="food"&&x.rating).sort((a,b)=>(b.rating||0)-(a.rating||0))[0];$("wrappedStory").innerHTML=`<section class="wrapped-slide intro"><span>☁️</span><p class="eyebrow">Fuwa Wrapped</p><h2>Your ${year}</h2><p>You kept <strong>${s.items.length}</strong> little moments.</p></section><section class="wrapped-slide"><span>🌱</span><p class="eyebrow">A year of firsts</p><h2>${s.byType.first||0}</h2><p>things you did for the first time.</p></section><section class="wrapped-slide"><span>🏆</span><p class="eyebrow">Things you did</p><h2>${s.byType.achievement||0}</h2><p>achievements worth remembering.</p></section><section class="wrapped-slide"><span>✈️</span><p class="eyebrow">Places & trips</p><h2>${s.byType.trip||0} trips · ${s.places} places</h2><p>little corners of the world that made it into Fuwa.</p></section><section class="wrapped-slide"><span>🍜</span><p class="eyebrow">Your food year</p><h2>${s.byType.food||0} food moments</h2><p>${topFood?`Most-loved: ${escapeHtml(topFood.title)} · ${"★".repeat(topFood.rating)}`:"Add restaurant ratings to see a favorite here."}</p></section><section class="wrapped-slide quote"><span>😂</span><p class="eyebrow">Quote of the year</p><h2>${s.quote?`“${escapeHtml(s.quote.quote)}”`:"Still waiting for a quote that deserves this spot."}</h2><p>${s.quote?.extraA?`— ${escapeHtml(s.quote.extraA)}`:""}</p></section><section class="wrapped-slide"><span>🌸</span><p class="eyebrow">Your Fuwa year</p><h2>${daily.count} daily journals</h2><p>${daily.topMood?`Most common mood: ${escapeHtml(moodLabels[daily.topMood]||daily.topMood)}.`:""} ${daily.avgRating?`Average day rating: ${daily.avgRating}/5.`:""}</p></section><section class="wrapped-slide outro"><span>♡</span><p class="eyebrow">${year} in little pieces</p><h2>You were here.</h2><p>Not every day needs to be big to be worth remembering.</p></section>`;$("wrappedSheet").classList.remove("hidden");document.body.style.overflow="hidden";}
function closeWrapped(){$("wrappedSheet").classList.add("hidden");document.body.style.overflow="";}

function setLifeTab(tab,options={}){
  const valid=["journal","history","dashboard","moments","collections"];
  if(!valid.includes(tab))tab="journal";
  lifeActiveTab=tab;

  document.querySelectorAll("[data-life-tab]").forEach(button=>button.classList.toggle("active",button.dataset.lifeTab===tab));
  $("lifeTodayPanel").classList.toggle("active",tab==="journal");
  $("lifeHistoryPanel").classList.toggle("active",tab==="history");
  $("lifeDashboardPanel").classList.toggle("active",tab==="dashboard");
  $("lifeMomentsPanel").classList.toggle("active",tab==="moments");
  $("lifeCollectionsPanel").classList.toggle("active",tab==="collections");

  if(tab==="journal"){
    if(!options.preserveDate)activeLifeJournalDate=isoToday();
    loadLifeJournalForm(activeLifeJournalDate);
  }
  if(tab==="history"){
    renderLifeHistory();
  }
  if(tab==="dashboard"){
    renderLifeDashboard();
    renderLifeTracker();
  }
  if(tab==="moments"){
    renderMoments();
  }
  if(tab==="collections"){
    renderLifeCollections();
  }
}

function renderLifePages(){
  if(!$("lifeView"))return;
  if(currentView==="life")setLifeTab(lifeActiveTab,{preserveDate:true});
}

function bindLifePages(){document.querySelectorAll("[data-life-tab]").forEach(b=>b.addEventListener("click",()=>setLifeTab(b.dataset.lifeTab)));document.querySelectorAll("#lifeDayRating button").forEach(b=>b.addEventListener("click",()=>{lifeDraft.rating=Number(b.dataset.rating);document.querySelectorAll("#lifeDayRating button").forEach(x=>{const a=Number(x.dataset.rating)<=lifeDraft.rating;x.classList.toggle("selected",a);x.textContent=a?"★":"☆"})}));document.querySelectorAll("#lifeMoodPicker button").forEach(b=>b.addEventListener("click",()=>{lifeDraft.mood=b.dataset.lifeMood;document.querySelectorAll("#lifeMoodPicker button").forEach(x=>x.classList.toggle("selected",x===b))}));document.querySelectorAll("[data-life-choice]").forEach(b=>b.addEventListener("click",()=>lifeSetChoice(b.dataset.lifeChoice,b.dataset.value)));$("lifeManageHabitsButton")?.addEventListener("click",manageLifeHabits);$("lifeManageCustomHabitsButton")?.addEventListener("click",manageCustomLifeHabits);$("lifeEditMovementButton")?.addEventListener("click",editMovementLabels);$("journalNextButton")?.addEventListener("click",journalNext);$("journalSkipButton")?.addEventListener("click",journalNext);$("journalBackButton")?.addEventListener("click",journalBack);$("journalTodayButton")?.addEventListener("click",returnLifeJournalToToday);$("lifeHistoryLoadMore")?.addEventListener("click",()=>{lifeHistoryVisibleCount+=12;renderLifeHistory()});document.querySelectorAll("[data-life-open-panel]").forEach(button=>button.addEventListener("click",()=>setLifeTab(button.dataset.lifeOpenPanel,{preserveDate:true})));document.querySelectorAll("[data-life-back-dashboard]").forEach(button=>button.addEventListener("click",()=>setLifeTab("dashboard",{preserveDate:true})));$("journalCustomizeButton")?.addEventListener("click",openJournalCustomizer);$("journalCustomizeClose")?.addEventListener("click",closeJournalCustomizer);$("journalCustomizeSave")?.addEventListener("click",saveJournalCustomizer);$("journalCloseButton")?.addEventListener("click",closeJournal);$("lifeDailyForm")?.addEventListener("submit",saveLifeToday);$("lifeTrackerMetric")?.addEventListener("change",e=>{lifeTrackerMetric=e.target.value;renderLifeTracker()});$("lifeTrackerPrevYear")?.addEventListener("click",()=>{lifeTrackerYear--;renderLifeTracker()});$("lifeTrackerNextYear")?.addEventListener("click",()=>{lifeTrackerYear++;renderLifeTracker()});$("lifeCollectionCategories")?.querySelectorAll("[data-collection-category]").forEach(b=>b.addEventListener("click",()=>{lifeCollectionCategory=b.dataset.collectionCategory;document.querySelectorAll("[data-collection-category]").forEach(x=>x.classList.toggle("active",x===b));renderLifeCollections()}));$("lifeCollectionForm")?.addEventListener("submit",saveLifeCollection);
  $("momentAddButton")?.addEventListener("click",()=>openMomentModal());
  $("momentModalClose")?.addEventListener("click",closeMomentModal);
  $("momentType")?.addEventListener("change",renderMomentAdaptiveFields);
  $("momentForm")?.addEventListener("submit",saveMoment);
  $("momentDeleteButton")?.addEventListener("click",deleteMoment);
  $("momentFilterRow")?.querySelectorAll("[data-moment-filter]").forEach(button=>button.addEventListener("click",()=>{momentFilter=button.dataset.momentFilter;document.querySelectorAll("[data-moment-filter]").forEach(b=>b.classList.toggle("active",b===button));renderMoments();}));
  $("openWrappedButton")?.addEventListener("click",openWrapped);
  $("wrappedCloseButton")?.addEventListener("click",closeWrapped);loadLifeTodayForm()}

function renderStats() {
  $("entryCount").textContent = state.entries.length;
  $("joyCount").textContent = state.tinyJoys.length;
  $("letterCount").textContent = state.letters.length;
  if ($("bookmarkCount")) $("bookmarkCount").textContent = state.bookmarks.length;
  if ($("nightlyCount")) $("nightlyCount").textContent = state.nightlyReflections.length;
}

const RELEASE_RITUAL_SETTING_KEY = "release-ritual-draft-v1";
let releaseRitualItems = [];
let releaseRitualLoaded = false;
let releaseRitualBurning = false;

async function loadReleaseRitual() {
  if (releaseRitualLoaded) return;
  try {
    const saved = await diaryRepository.getSetting(RELEASE_RITUAL_SETTING_KEY);
    releaseRitualItems = Array.isArray(saved?.items)
      ? saved.items.filter(item => item && typeof item.text === "string").slice(-24)
      : [];
  } catch (error) {
    console.error("Could not load Release Ritual.", error);
    releaseRitualItems = [];
  }
  releaseRitualLoaded = true;
}

async function saveReleaseRitualDraft() {
  if (!releaseRitualItems.length) {
    await diaryRepository.removeSetting(RELEASE_RITUAL_SETTING_KEY);
    return;
  }
  await diaryRepository.saveSetting({
    key: RELEASE_RITUAL_SETTING_KEY,
    items: releaseRitualItems.map(item => ({ id: item.id, text: item.text, createdAt: item.createdAt })),
    updatedAt: Date.now()
  });
}

function renderReleaseRitualItems() {
  const host = $("releasePaperStack");
  const burnButton = $("releaseBurnButton");
  if (!host) return;

  host.innerHTML = releaseRitualItems.length
    ? releaseRitualItems.map((item,index)=>`
        <article class="release-slip" style="--slip-rotate:${((index%5)-2)*1.2}deg" data-release-slip="${escapeHtml(item.id)}">
          <p>${escapeHtml(item.text)}</p>
          <button type="button" data-release-remove="${escapeHtml(item.id)}" aria-label="Remove this slip">×</button>
        </article>
      `).join("")
    : `<div class="release-empty"><span>☁️</span><strong>Nothing to carry here right now.</strong><small>Add one thought at a time. You decide when it is ready to go.</small></div>`;

  host.querySelectorAll("[data-release-remove]").forEach(button=>{
    button.addEventListener("click",async()=>{
      if(releaseRitualBurning)return;
      const id=button.dataset.releaseRemove;
      releaseRitualItems=releaseRitualItems.filter(item=>item.id!==id);
      try{await saveReleaseRitualDraft()}catch(error){console.error("Could not update Release Ritual.",error)}
      renderReleaseRitualItems();
    });
  });

  if (burnButton) burnButton.disabled = !releaseRitualItems.length || releaseRitualBurning;
}

async function renderReleaseRitual() {
  await loadReleaseRitual();
  renderReleaseRitualItems();
}

async function addReleaseRitualItem(event) {
  event.preventDefault();
  if(releaseRitualBurning)return;
  const input=$("releaseRitualInput");
  const text=input?.value.trim();
  if(!text)return;
  const item={id:uid("release"),text:text.slice(0,500),createdAt:Date.now()};
  releaseRitualItems=[...releaseRitualItems,item].slice(-24);
  try {
    await saveReleaseRitualDraft();
    input.value="";
    if($("releaseRitualNote"))$("releaseRitualNote").textContent="Nothing is sent anywhere. Unburned slips stay only on this device.";
    renderReleaseRitualItems();
    toast("Added to the pile ✦");
  } catch(error) {
    console.error("Could not save Release Ritual slip.",error);
    releaseRitualItems=releaseRitualItems.filter(record=>record.id!==item.id);
    toast("Fuwa couldn't keep that slip.");
  }
}

async function burnReleaseRitual() {
  if(releaseRitualBurning||!releaseRitualItems.length)return;
  const stage=$("releaseStage");
  const button=$("releaseBurnButton");
  releaseRitualBurning=true;
  if(button){button.disabled=true;button.textContent="Letting go…"}
  stage?.classList.add("burning");

  await new Promise(resolve=>setTimeout(resolve,1250));

  try {
    await diaryRepository.removeSetting(RELEASE_RITUAL_SETTING_KEY);
    releaseRitualItems=[];
    stage?.classList.remove("burning");
    renderReleaseRitualItems();
    if($("releaseRitualNote"))$("releaseRitualNote").textContent="Gone from Fuwa. You do not have to carry it here anymore.";
    toast("Released ✦");
  } catch(error) {
    console.error("Could not finish Release Ritual.",error);
    stage?.classList.remove("burning");
    toast("Fuwa couldn't clear the slips yet.");
  } finally {
    releaseRitualBurning=false;
    if(button){button.textContent="Burn & release";button.disabled=!releaseRitualItems.length}
  }
}

function bindReleaseRitual() {
  $("releaseRitualForm")?.addEventListener("submit",addReleaseRitualItem);
  $("releaseBurnButton")?.addEventListener("click",burnReleaseRitual);
}

function renderViewOnDemand(view = currentView) {
  if (view === "home") {
    renderMoodPicker();
    renderHomeMoodJar();
    renderHomeThreads();
    renderNightlyHome();
    renderMemoryDriftHome();
    renderCalendar();
    renderRecentEntries();
    renderLittleThingsHome();
    return;
  }
  if (view === "me") return renderRecentEntries();
  if (view === "entries") return renderEntries($("entrySearch")?.value || "");
  if (view === "scrapbook") return renderScrapbookLibrary();
  if (view === "thoughts") { renderTinyJoyHistory(); return renderRandomThoughtHistory(); }
  if (view === "letters") return renderLetters();
  if (view === "threads") return renderThreads();
  if (view === "threadDetail" && activeThreadId) return renderThreadDetail();
  if (view === "bookmarks") return renderBookmarks();
  if (view === "bookmarkDetail" && activeBookmarkId) return renderBookmarkDetail();
  if (view === "moodjar") return renderMoodJarView();
  if (view === "life") return renderLifePages();
  if (view === "monthly") return renderMonthlyStory();
  if (view === "weather") return renderEmotionalWeather();
  if (view === "thenNow") return renderThenNow();
  if (view === "comfort") return renderComfort();
  if (view === "release") { renderReleaseRitual().catch(console.error); return; }
  if (view === "unsent") return renderUnsent();
  if (view === "bubbles") return renderBubbles();
  if (view === "dreams") return renderDreams();
  if (view === "sanctuary") return renderSanctuary();
  if (view === "nightly") return renderNightlyHistory();
  if (view === "memoryDrift") return renderMemoryDriftDetail();
}



// =========================================================
// FUWA V85 — SANCTUARY: A LIVING ROOM MADE FROM YOUR FUWA
// Derived from existing Fuwa content. No new database store or grind economy.
// =========================================================
const SANCTUARY_V3_STAGES = [
  { min:0, name:"A Quiet Corner", copy:"The room is here. It does not need anything from you." },
  { min:8, name:"A Soft Glow", copy:"A little warmth has begun to collect here." },
  { min:20, name:"A Lived-In Nook", copy:"Small traces of your days are starting to stay." },
  { min:40, name:"A Story Room", copy:"The room has learned how to hold your stories." },
  { min:70, name:"A Dreamy Hideaway", copy:"There is enough of you here for the room to feel familiar." },
  { min:110, name:"A Gentle Home", copy:"Fuwa has become somewhere your days know how to return to." },
  { min:170, name:"Your Sanctuary", copy:"This room has grown around the life you have been leaving here." },
  { min:260, name:"A Room with Seasons", copy:"The room has watched enough days pass to have a rhythm of its own." },
  { min:400, name:"A Place That Knows You", copy:"So many small pieces of your life have found somewhere to stay." },
  { min:650, name:"A Little World of Your Own", copy:"Fuwa feels less like a room now and more like somewhere you have lived." }
];

const SANCTUARY_V3_OBJECTS = [
  { id:"lamp", min:8, label:"Warm lamp", memory:"nightly" },
  { id:"plant", min:20, label:"Little plant", memory:"joy" },
  { id:"books", min:40, label:"Story shelf", memory:"entry" },
  { id:"stars", min:70, label:"Star lights", memory:"dream" },
  { id:"cushion", min:90, label:"Soft cushion", memory:"comfort" },
  { id:"tea", min:110, label:"Tea corner", memory:"mood" },
  { id:"garland", min:140, label:"Paper garland", memory:"bubble" },
  { id:"frame", min:170, label:"Memory frame", memory:"entry" },
  { id:"desk", min:190, label:"Writing desk", memory:"entry", metric:"entries", metricMin:20, metricLabel:"journal entries" },
  { id:"blanket", min:220, label:"Cloud blanket", memory:"comfort", metric:"comfortItems", metricMin:8, metricLabel:"comfort keepsakes" },
  { id:"flowers", min:260, label:"Joy flowers", memory:"joy", metric:"tinyJoys", metricMin:20, metricLabel:"tiny joys" },
  { id:"moon", min:310, label:"Dream mobile", memory:"dream", metric:"dreams", metricMin:10, metricLabel:"dreams" },
  { id:"notes", min:360, label:"Floating notes", memory:"bubble", metric:"thoughtBubbles", metricMin:12, metricLabel:"thought bubbles" },
  { id:"album", min:430, label:"Memory album", memory:"entry", metric:"entries", metricMin:40, metricLabel:"journal entries" }
];
const SANCTUARY_V3_THEMES = [{id:"rose",label:"Rose"},{id:"lavender",label:"Lavender"},{id:"sky",label:"Morning Sky"}];
const SANCTUARY_V3_AMBIENCES = [
  {id:"auto",label:"Auto",icon:"◌"},{id:"morning",label:"Morning",icon:"☼"},{id:"day",label:"Daylight",icon:"◇"},
  {id:"golden",label:"Golden",icon:"✦"},{id:"night",label:"Night",icon:"☾"},{id:"rain",label:"Rainy",icon:"⌇"}
];
const SANCTUARY_V3_SEASONS = [{id:"auto",label:"Auto"},{id:"spring",label:"Spring"},{id:"summer",label:"Summer"},{id:"autumn",label:"Autumn"},{id:"winter",label:"Winter"}];
const SANCTUARY_V3_PRESETS = [
  {id:"cozy",label:"Soft & Cozy",note:"Warm light, tea and soft corners."},{id:"dreamy",label:"Dreamy Night",note:"Lavender, stars and quieter light."},
  {id:"fresh",label:"Fresh Morning",note:"Sky tones, plants and spring air."},{id:"lived",label:"Lived In",note:"Put every unlocked keepsake back."}
];

function sanctuaryV3MomentCount() {
  return [state.entries,state.moodCheckins,state.nightlyReflections,state.dreams,state.thoughtBubbles,state.tinyJoys,state.comfortItems,state.randomThoughts,state.moments,state.dailyCheckins,state.thenNow,state.unsentLetters,state.bookmarks,state.letters]
    .reduce((total,items)=>total+(Array.isArray(items)?items.length:0),0);
}
function sanctuaryV3StageIndex(total=sanctuaryV3MomentCount()){let index=0;SANCTUARY_V3_STAGES.forEach((stage,i)=>{if(total>=stage.min)index=i;});return index;}
function sanctuaryV3ResolvedAmbience(){if(sanctuaryPreferences.ambience!=="auto")return sanctuaryPreferences.ambience;const hour=new Date().getHours();if(hour>=5&&hour<11)return"morning";if(hour>=11&&hour<16)return"day";if(hour>=16&&hour<19)return"golden";return"night";}
function sanctuaryV3ResolvedSeason(){if(sanctuaryPreferences.season!=="auto")return sanctuaryPreferences.season;const month=new Date().getMonth();if(month>=2&&month<=4)return"spring";if(month>=5&&month<=7)return"summer";if(month>=8&&month<=10)return"autumn";return"winter";}
function sanctuaryV3MetricCount(metric){const items=state[metric];return Array.isArray(items)?items.length:0;}
function sanctuaryV3ObjectUnlocked(object,total=sanctuaryV3MomentCount()){if(total>=object.min)return true;return!!(object.metric&&sanctuaryV3MetricCount(object.metric)>=Number(object.metricMin||Infinity));}
function sanctuaryV3ObjectVisible(object,total=sanctuaryV3MomentCount()){return sanctuaryV3ObjectUnlocked(object,total)&&sanctuaryPreferences.visibleObjects.includes(object.id);}
function sanctuaryV3UnlockCopy(object,total){if(sanctuaryV3ObjectUnlocked(object,total))return"Found its way into your room.";const momentRemaining=Math.max(0,object.min-total);if(object.metric){const metricRemaining=Math.max(0,object.metricMin-sanctuaryV3MetricCount(object.metric));return`${metricRemaining} more ${object.metricLabel} or ${momentRemaining} room moments`;}return`${momentRemaining} room moment${momentRemaining===1?"":"s"} away`;}
function sanctuaryV3Latest(items){
  if(!Array.isArray(items)||!items.length)return null;
  const score=item=>{
    const numeric=Number(item?.updatedAt||item?.createdAt||0);
    if(Number.isFinite(numeric)&&numeric>0)return numeric;
    if(item?.date){const parsed=new Date(`${item.date}T12:00:00`).getTime();if(Number.isFinite(parsed))return parsed;}
    return 0;
  };
  let latest=null,latestScore=-1;
  for(const item of items){const itemScore=score(item);if(latest===null||itemScore>=latestScore){latest=item;latestScore=itemScore;}}
  return latest;
}

function sanctuaryV3ShelfMemories(){
  const memories=[];
  const entry=sanctuaryV3Latest(state.entries);if(entry)memories.push({label:"Latest journal page",title:entry.title||"A memory",text:memoryDriftPreviewText(entry,210),entryId:entry.id,icon:"📖",type:"entry"});
  const joy=sanctuaryV3Latest(state.tinyJoys);if(joy)memories.push({label:"A tiny joy",title:"Something small that stayed",text:joy.text||"A little bright thing.",icon:"🌷",type:"joy"});
  const dream=sanctuaryV3Latest(state.dreams);if(dream)memories.push({label:"From Dream Pocket",title:dream.title||"A dream",text:dream.body||"A dream that stayed long enough to write down.",icon:"☾",type:"dream"});
  const comfort=sanctuaryV3Latest(state.comfortItems);if(comfort)memories.push({label:"From Comfort Corner",title:comfort.title||"Something soft",text:comfort.body||"Something you wanted to keep close.",icon:"♡",type:"comfort"});
  const nightly=sanctuaryV3Latest(state.nightlyReflections);if(nightly)memories.push({label:"A quiet night",title:nightly.date?formatDate(nightly.date):"Nightly Wind-Down",text:nightly.grateful||nightly.release||nightly.tomorrow||"A night you put down gently.",icon:"✦",type:"nightly"});
  const bubble=sanctuaryV3Latest(state.thoughtBubbles);if(bubble)memories.push({label:"A thought floating nearby",title:bubble.date?formatDate(bubble.date):"Thought Bubble",text:bubble.text||"A thought you wanted to meet again.",icon:"◌",type:"bubble"});
  const mood=sanctuaryV3Latest(state.moodCheckins);if(mood)memories.push({label:"A feeling the room remembers",title:`${moodLabels[mood.mood]||"A day"}${mood.date?` · ${formatDate(mood.date)}`:""}`,text:mood.note||"You checked in with yourself on this day.",icon:"☁️",type:"mood"});
  return memories;
}
function sanctuaryV3ShowMemoryValue(memory){const card=$("sanctuaryMemoryCard");if(!card||!memory)return;activeSanctuaryMemoryEntryId=memory.entryId||null;if($("sanctuaryMemoryIcon"))$("sanctuaryMemoryIcon").textContent=memory.icon||"☁️";if($("sanctuaryMemoryLabel"))$("sanctuaryMemoryLabel").textContent=memory.label||"Something your room remembered";if($("sanctuaryMemoryTitle"))$("sanctuaryMemoryTitle").textContent=memory.title||"A memory";if($("sanctuaryMemoryText"))$("sanctuaryMemoryText").textContent=memory.text||"A small piece of your Fuwa.";$("sanctuaryMemoryOpenEntry")?.classList.toggle("hidden",!memory.entryId);card.classList.remove("hidden");}
function sanctuaryV3MemoryTypesAvailable(){const types=[];if(state.entries.length)types.push("entry");if(state.nightlyReflections.length)types.push("nightly");if(state.dreams.length)types.push("dream");if(state.tinyJoys.length)types.push("joy");if(state.comfortItems.length)types.push("comfort");if(state.thoughtBubbles.length)types.push("bubble");if(state.moodCheckins.length)types.push("mood");return types;}
function sanctuaryV3CompanionCopy(){const name=sanctuaryPreferences.companionName||"Fuwa",hour=new Date().getHours(),todayMood=state.moodCheckins.find(item=>item.date===isoToday())?.mood||state.selectedMood;const greeting=hour<12?`Good morning from ${name}.`:hour<18?`${name} kept your corner warm.`:`It is quiet in here with ${name}.`;const moodCopy={amazing:"The room feels a little brighter with you here.",good:"There is a soft kind of ease in the room today.",neutral:"Nothing needs to happen here. You can simply be.",tired:"You can just sit here for a while. The room can stay quiet.",sad:"A heavy day can have somewhere gentle to land.",angry:"You do not have to soften anything before coming in."}[todayMood]||"Your room is here exactly as you left it.";return{greeting,moodCopy,mood:todayMood};}
function sanctuaryV3Signature(){return[collectionSignature(state.entries),collectionSignature(state.moodCheckins),collectionSignature(state.nightlyReflections),collectionSignature(state.dreams),collectionSignature(state.thoughtBubbles),collectionSignature(state.tinyJoys),collectionSignature(state.comfortItems),collectionSignature(state.randomThoughts),collectionSignature(state.moments),collectionSignature(state.dailyCheckins),collectionSignature(state.thenNow),collectionSignature(state.unsentLetters),collectionSignature(state.bookmarks),collectionSignature(state.letters),sanctuaryPreferences.theme,sanctuaryPreferences.ambience,sanctuaryPreferences.season,sanctuaryPreferences.companionName,[...sanctuaryPreferences.visibleObjects].sort().join(","),sanctuaryV3ResolvedAmbience(),sanctuaryV3ResolvedSeason(),isoToday()].join("|");}

function sanctuaryV3SetPanel(panel){if(!["memories","customize","story"].includes(panel))panel="memories";sanctuaryActivePanel=panel;document.querySelectorAll("[data-sanctuary-panel]").forEach(button=>{const selected=button.dataset.sanctuaryPanel===panel;button.classList.toggle("selected",selected);button.setAttribute("aria-selected",selected?"true":"false");});["memories","customize","story"].forEach(key=>{$("sanctuaryPanel"+key[0].toUpperCase()+key.slice(1))?.classList.toggle("hidden",key!==panel);});}
function sanctuaryV3ApplyPreset(id){const allIds=SANCTUARY_V3_OBJECTS.map(object=>object.id),presets={cozy:{theme:"rose",ambience:"golden",season:"auto",visibleObjects:["lamp","plant","cushion","tea","blanket","flowers","books"]},dreamy:{theme:"lavender",ambience:"night",season:"winter",visibleObjects:["lamp","stars","garland","frame","moon","album","cushion"]},fresh:{theme:"sky",ambience:"morning",season:"spring",visibleObjects:["plant","books","desk","flowers","frame","tea"]},lived:{theme:sanctuaryPreferences.theme,ambience:"auto",season:"auto",visibleObjects:allIds}};const preset=presets[id];if(!preset)return;sanctuaryPreferences={...sanctuaryPreferences,...preset,version:3};saveSanctuaryPreferences();renderCache.sanctuary="";renderSanctuary(true);toast("Your Sanctuary shifted softly ☁️");}

function sanctuaryV3RenderShelf(){const host=$("sanctuaryMemoryShelf");if(!host)return;const all=sanctuaryV3ShelfMemories();if(!all.length){host.innerHTML=`<div class="sanctuary-shelf-empty">As you use Fuwa, little memories will begin resting on this shelf.</div>`;return;}const offset=all.length?sanctuaryMemoryShelfOffset%all.length:0,rotated=[...all.slice(offset),...all.slice(0,offset)].slice(0,4);host.innerHTML=rotated.map((memory,index)=>`<button class="sanctuary-shelf-memory" type="button" data-sanctuary-shelf-index="${index}"><span>${escapeHtml(memory.icon||"☁️")}</span><small>${escapeHtml(memory.label)}</small><strong>${escapeHtml(memory.title)}</strong><p>${escapeHtml(String(memory.text||"").replace(/\s+/g," ").slice(0,105))}${String(memory.text||"").length>105?"…":""}</p></button>`).join("");host.querySelectorAll("[data-sanctuary-shelf-index]").forEach(button=>{button.onclick=()=>sanctuaryV3ShowMemoryValue(rotated[Number(button.dataset.sanctuaryShelfIndex)]);});}

function renderSanctuary(force=false){
  const host=$("sanctuaryRoom"),unlocks=$("sanctuaryUnlocks"),objectOptions=$("sanctuaryObjectOptions"),themeOptions=$("sanctuaryThemeOptions"),ambienceOptions=$("sanctuaryAmbienceOptions"),seasonOptions=$("sanctuarySeasonOptions"),presetOptions=$("sanctuaryPresetOptions"),stageTimeline=$("sanctuaryStageTimeline"),statsHost=$("sanctuaryRoomStats");
  if(!host||!unlocks||!objectOptions||!themeOptions||!ambienceOptions||!seasonOptions||!presetOptions||!stageTimeline||!statsHost)return;
  const signature=sanctuaryV3Signature();if(!force&&renderCache.sanctuary===signature){sanctuaryV3SetPanel(sanctuaryActivePanel);return;}renderCache.sanctuary=signature;
  const total=sanctuaryV3MomentCount(),stageIndex=sanctuaryV3StageIndex(total),stage=SANCTUARY_V3_STAGES[stageIndex],next=SANCTUARY_V3_STAGES[stageIndex+1]||null,ambience=sanctuaryV3ResolvedAmbience(),season=sanctuaryV3ResolvedSeason(),companion=sanctuaryV3CompanionCopy();
  if($("sanctuaryStageName"))$("sanctuaryStageName").textContent=stage.name;if($("sanctuaryStageCount"))$("sanctuaryStageCount").textContent=`${total} ${total===1?"moment":"moments"}`;if($("sanctuaryProgressCopy"))$("sanctuaryProgressCopy").textContent=next?`${Math.max(0,next.min-total)} more gentle moment${next.min-total===1?"":"s"} and the room may change again.`:stage.copy;const progress=next?Math.max(0,Math.min(100,((total-stage.min)/Math.max(1,next.min-stage.min))*100)):100;if($("sanctuaryProgressBar"))$("sanctuaryProgressBar").style.width=`${progress}%`;
  if($("sanctuaryCompanionGreeting"))$("sanctuaryCompanionGreeting").textContent=companion.greeting;if($("sanctuaryCompanionNote"))$("sanctuaryCompanionNote").textContent=companion.moodCopy;if($("sanctuaryAtmosphereLabel"))$("sanctuaryAtmosphereLabel").textContent=ambience==="golden"?"Golden hour":ambience[0].toUpperCase()+ambience.slice(1);if($("sanctuarySeasonLabel"))$("sanctuarySeasonLabel").textContent=season[0].toUpperCase()+season.slice(1);
  const visible=Object.fromEntries(SANCTUARY_V3_OBJECTS.map(object=>[object.id,sanctuaryV3ObjectVisible(object,total)])),particles='<i></i><i></i><i></i><i></i><i></i><i></i>';
  host.innerHTML=`<div class="room-scene sanctuary-v3-scene sanctuary-theme-${escapeHtml(sanctuaryPreferences.theme)} ambience-${escapeHtml(ambience)} season-${escapeHtml(season)} level-${stageIndex+1}"><div class="room-window"><div class="room-sky"><span class="room-sun"></span><span class="room-moon-sky"></span><span class="room-rain-lines"></span></div></div><div class="room-curtain room-curtain-left"></div><div class="room-curtain room-curtain-right"></div><div class="room-season-particles" aria-hidden="true">${particles}</div><div class="room-rug"></div><div class="room-bed"><span></span></div><button class="room-cloud-pet sanctuary-memory-object mood-${escapeHtml(companion.mood||"good")}" type="button" data-sanctuary-memory="mood" aria-label="${escapeHtml(sanctuaryPreferences.companionName||"Fuwa")} cloud memory"><span></span><small>${escapeHtml(sanctuaryPreferences.companionName||"Fuwa")}</small></button>${visible.lamp?'<button class="room-lamp sanctuary-memory-object" type="button" data-sanctuary-memory="nightly" aria-label="Lamp memory"></button>':""}${visible.plant?'<button class="room-plant sanctuary-memory-object" type="button" data-sanctuary-memory="joy" aria-label="Plant memory"></button>':""}${visible.books?'<button class="room-books sanctuary-memory-object" type="button" data-sanctuary-memory="entry" aria-label="Bookshelf memory"></button>':""}${visible.stars?'<button class="room-stars sanctuary-memory-object" type="button" data-sanctuary-memory="dream" aria-label="Star memory"></button>':""}${visible.cushion?'<button class="room-cushion sanctuary-memory-object" type="button" data-sanctuary-memory="comfort" aria-label="Cushion memory"></button>':""}${visible.tea?'<button class="room-tea sanctuary-memory-object" type="button" data-sanctuary-memory="mood" aria-label="Tea memory"></button>':""}${visible.garland?'<button class="room-garland sanctuary-memory-object" type="button" data-sanctuary-memory="bubble" aria-label="Garland memory"></button>':""}${visible.frame?'<button class="room-frame sanctuary-memory-object" type="button" data-sanctuary-memory="entry" aria-label="Frame memory"></button>':""}${visible.desk?'<button class="room-desk sanctuary-memory-object" type="button" data-sanctuary-memory="entry" aria-label="Writing desk memory"></button>':""}${visible.blanket?'<button class="room-blanket sanctuary-memory-object" type="button" data-sanctuary-memory="comfort" aria-label="Blanket memory"></button>':""}${visible.flowers?'<button class="room-flowers sanctuary-memory-object" type="button" data-sanctuary-memory="joy" aria-label="Flower memory"></button>':""}${visible.moon?'<button class="room-dream-mobile sanctuary-memory-object" type="button" data-sanctuary-memory="dream" aria-label="Dream mobile memory"></button>':""}${visible.notes?'<button class="room-floating-notes sanctuary-memory-object" type="button" data-sanctuary-memory="bubble" aria-label="Floating note memory"></button>':""}${visible.album?'<button class="room-album sanctuary-memory-object" type="button" data-sanctuary-memory="entry" aria-label="Memory album"></button>':""}<div class="sanctuary-room-hint">Tap anything with a little memory in it.</div></div>`;
  host.querySelectorAll("[data-sanctuary-memory]").forEach(button=>{button.onclick=()=>showSanctuaryMemory(button.dataset.sanctuaryMemory);});
  themeOptions.innerHTML=SANCTUARY_V3_THEMES.map(theme=>`<button class="sanctuary-theme-choice ${sanctuaryPreferences.theme===theme.id?"selected":""}" type="button" data-sanctuary-theme="${theme.id}"><span class="sanctuary-theme-swatch ${theme.id}"></span><strong>${theme.label}</strong></button>`).join("");themeOptions.querySelectorAll("[data-sanctuary-theme]").forEach(button=>{button.onclick=()=>{sanctuaryPreferences.theme=button.dataset.sanctuaryTheme;saveSanctuaryPreferences();renderCache.sanctuary="";renderSanctuary(true);};});
  ambienceOptions.innerHTML=SANCTUARY_V3_AMBIENCES.map(option=>`<button class="sanctuary-v3-option ${sanctuaryPreferences.ambience===option.id?"selected":""}" type="button" data-sanctuary-ambience="${option.id}"><span>${option.icon}</span><strong>${option.label}</strong></button>`).join("");ambienceOptions.querySelectorAll("[data-sanctuary-ambience]").forEach(button=>{button.onclick=()=>{sanctuaryPreferences.ambience=button.dataset.sanctuaryAmbience;saveSanctuaryPreferences();renderCache.sanctuary="";renderSanctuary(true);};});
  seasonOptions.innerHTML=SANCTUARY_V3_SEASONS.map(option=>`<button class="sanctuary-season-choice ${sanctuaryPreferences.season===option.id?"selected":""}" type="button" data-sanctuary-season="${option.id}">${option.label}</button>`).join("");seasonOptions.querySelectorAll("[data-sanctuary-season]").forEach(button=>{button.onclick=()=>{sanctuaryPreferences.season=button.dataset.sanctuarySeason;saveSanctuaryPreferences();renderCache.sanctuary="";renderSanctuary(true);};});
  presetOptions.innerHTML=SANCTUARY_V3_PRESETS.map(preset=>`<button class="sanctuary-preset-card" type="button" data-sanctuary-preset="${preset.id}"><strong>${preset.label}</strong><small>${preset.note}</small></button>`).join("");presetOptions.querySelectorAll("[data-sanctuary-preset]").forEach(button=>{button.onclick=()=>sanctuaryV3ApplyPreset(button.dataset.sanctuaryPreset);});
  objectOptions.innerHTML=SANCTUARY_V3_OBJECTS.map(object=>{const unlocked=sanctuaryV3ObjectUnlocked(object,total),shown=sanctuaryPreferences.visibleObjects.includes(object.id);return`<button class="sanctuary-object-choice ${unlocked?"unlocked":"locked"} ${unlocked&&shown?"selected":""}" type="button" data-sanctuary-object="${object.id}" ${unlocked?"":"disabled"}><span class="sanctuary-object-dot ${object.id}"></span><strong>${object.label}</strong><small>${unlocked?(shown?"In room":"Tucked away"):sanctuaryV3UnlockCopy(object,total)}</small></button>`;}).join("");objectOptions.querySelectorAll("[data-sanctuary-object]:not(:disabled)").forEach(button=>{button.onclick=()=>{const id=button.dataset.sanctuaryObject,set=new Set(sanctuaryPreferences.visibleObjects);set.has(id)?set.delete(id):set.add(id);sanctuaryPreferences.visibleObjects=[...set];saveSanctuaryPreferences();renderCache.sanctuary="";renderSanctuary(true);};});
  unlocks.innerHTML=SANCTUARY_V3_OBJECTS.map(object=>{const unlocked=sanctuaryV3ObjectUnlocked(object,total);return`<div class="sanctuary-unlock ${unlocked?"unlocked":""}"><span>${unlocked?"♡":"○"}</span><div><strong>${object.label}</strong><small>${sanctuaryV3UnlockCopy(object,total)}</small></div></div>`;}).join("");
  stageTimeline.innerHTML=SANCTUARY_V3_STAGES.map((item,index)=>{const reached=total>=item.min,current=index===stageIndex;return`<div class="sanctuary-stage-step ${reached?"reached":""} ${current?"current":""}"><span>${reached?"♡":item.min}</span><div><strong>${item.name}</strong><small>${current?item.copy:reached?"This chapter already lives in your room.":`${Math.max(0,item.min-total)} moments away`}</small></div></div>`;}).join("");
  statsHost.innerHTML=[["Journal pages",state.entries.length],["Tiny joys",state.tinyJoys.length],["Dreams",state.dreams.length],["Quiet nights",state.nightlyReflections.length]].map(([label,value])=>`<div><strong>${value}</strong><span>${label}</span></div>`).join("");
  sanctuaryV3RenderShelf();
  document.querySelectorAll("[data-sanctuary-panel]").forEach(button=>{button.onclick=()=>sanctuaryV3SetPanel(button.dataset.sanctuaryPanel);});if($("sanctuaryMemoryShelfRefresh"))$("sanctuaryMemoryShelfRefresh").onclick=()=>{sanctuaryMemoryShelfOffset+=1;sanctuaryV3RenderShelf();};if($("sanctuarySurpriseMemoryButton"))$("sanctuarySurpriseMemoryButton").onclick=()=>{const types=sanctuaryV3MemoryTypesAvailable();if(!types.length)return toast("Your room is still waiting for its first memory ☁️");const button=$("sanctuarySurpriseMemoryButton");button?.setAttribute("aria-busy","true");showSanctuaryMemory(types[Math.floor(Math.random()*types.length)]);requestAnimationFrame(()=>{const card=$("sanctuaryMemoryCard");if(card&&!card.classList.contains("hidden")){const reduceMotion=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;card.scrollIntoView({behavior:reduceMotion?"auto":"smooth",block:"nearest"});}button?.removeAttribute("aria-busy");});};if($("sanctuaryCompanionName"))$("sanctuaryCompanionName").value=sanctuaryPreferences.companionName||"Fuwa";if($("sanctuaryCompanionNameSave"))$("sanctuaryCompanionNameSave").onclick=()=>{const input=$("sanctuaryCompanionName"),next=String(input?.value||"Fuwa").replace(/[<>]/g,"").replace(/\s+/g," ").trim().slice(0,18)||"Fuwa";sanctuaryPreferences.companionName=next;saveSanctuaryPreferences();renderCache.sanctuary="";renderSanctuary(true);toast(`${next} knows its name now ☁️`);};
  sanctuaryV3SetPanel(sanctuaryActivePanel);
}

function renderAll() {
  renderProfileName();
  $("todayLabel").textContent = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric"
  }).format(new Date());

  renderViewOnDemand(currentView);
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


const FUWA_SCRAPBOOK_FALLBACK_LIBRARY = Object.freeze({
  stickerCategories: [{ id: "favorites", label: "Favorites", icon: "🎀", order: 10 }],
  stickers: [
    "🌸","🌷","🌼","🎀","☁️","✨","⭐","🌙","💗","💌","🍓","🍰",
    "☕","🧸","🐰","🐱","🫧","🌿","🍀","🕯️","📖","📎","✈️","🎧"
  ].map((emoji, index) => ({ id: `fallback-${index + 1}`, emoji, label: "Sticker", category: "favorites", tags: [] })),
  journalBitGroups: [
    { id: "washi", label: "Washi", icon: "🎀", order: 10 },
    { id: "paper-scraps", label: "Scraps", icon: "📄", order: 20 },
    { id: "labels", label: "Labels", icon: "🏷️", order: 30 }
  ],
  journalBits: [
    { id: "washi-blush", kind: "washi", group: "washi", variant: "blush", label: "Blush tape", defaultScale: 1.15, defaultRotation: 0, style: { base: "#efb2c6", pattern: "solid" } },
    { id: "washi-lavender", kind: "washi", group: "washi", variant: "lavender", label: "Lavender tape", defaultScale: 1.15, defaultRotation: -3, style: { base: "#d8c8ea", pattern: "solid" } },
    { id: "washi-daisy", kind: "washi", group: "washi", variant: "daisy", label: "Daisy tape", defaultScale: 1.15, defaultRotation: 2, style: { base: "#f4cad8", pattern: "daisy" } },
    { id: "scrap-rose", kind: "scrap", group: "paper-scraps", variant: "rose", label: "Rose paper", defaultScale: 1.05, defaultRotation: -2, style: { base: "#f3c7d3", pattern: "torn" } },
    { id: "scrap-cream", kind: "scrap", group: "paper-scraps", variant: "cream", label: "Cream paper", defaultScale: 1.05, defaultRotation: 2, style: { base: "#f7ead0", pattern: "torn" } },
    { id: "label-today", kind: "label", group: "labels", variant: "blush", text: "TODAY", label: "Today label", defaultScale: .9, defaultRotation: 0, style: { palette: "blush" } },
    { id: "label-memory", kind: "label", group: "labels", variant: "lavender", text: "MEMORY", label: "Memory label", defaultScale: .9, defaultRotation: 0, style: { palette: "lavender" } }
  ],
  paperCategories: [{ id: "soft", label: "Soft", order: 10 }, { id: "notebook", label: "Notebook", order: 20 }],
  papers: [
    { id: "blush", name: "Blush", category: "soft", backgroundColor: "#fff4f7", backgroundImage: "linear-gradient(180deg,rgba(255,255,255,.65),rgba(255,234,241,.55))", backgroundSize: "auto", backgroundPosition: "0 0" },
    { id: "cream", name: "Cream", category: "soft", backgroundColor: "#fffaf0", backgroundImage: "linear-gradient(180deg,rgba(255,255,255,.65),rgba(250,239,214,.38))", backgroundSize: "auto", backgroundPosition: "0 0" },
    { id: "lavender", name: "Lavender", category: "soft", backgroundColor: "#faf6ff", backgroundImage: "linear-gradient(180deg,rgba(255,255,255,.62),rgba(232,220,247,.42))", backgroundSize: "auto", backgroundPosition: "0 0" },
    { id: "grid", name: "Grid", category: "notebook", backgroundColor: "#fffafc", backgroundImage: "linear-gradient(rgba(220,193,207,.24) 1px,transparent 1px),linear-gradient(90deg,rgba(220,193,207,.24) 1px,transparent 1px)", backgroundSize: "22px 22px", backgroundPosition: "0 0" }
  ]
});

const FUWA_SCRAPBOOK_LIBRARY =
  window.FUWA_SCRAPBOOK_LIBRARY &&
  Array.isArray(window.FUWA_SCRAPBOOK_LIBRARY.stickers) &&
  Array.isArray(window.FUWA_SCRAPBOOK_LIBRARY.journalBits) &&
  Array.isArray(window.FUWA_SCRAPBOOK_LIBRARY.papers)
    ? window.FUWA_SCRAPBOOK_LIBRARY
    : FUWA_SCRAPBOOK_FALLBACK_LIBRARY;

let activeStickerCategory = FUWA_SCRAPBOOK_LIBRARY.stickerCategories?.[0]?.id || "favorites";
let activeJournalBitGroup = FUWA_SCRAPBOOK_LIBRARY.journalBitGroups?.[0]?.id || "washi";
let activePaperCategory = FUWA_SCRAPBOOK_LIBRARY.paperCategories?.[0]?.id || "soft";
let journalPaletteLoaded = { mine: false, photos: false };

function orderedScrapbookGroups(groups = []) {
  return [...groups].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

function scrapbookPaperById(id) {
  return FUWA_SCRAPBOOK_LIBRARY.papers.find(paper => paper.id === id)
    || FUWA_SCRAPBOOK_FALLBACK_LIBRARY.papers.find(paper => paper.id === id)
    || FUWA_SCRAPBOOK_LIBRARY.papers[0]
    || FUWA_SCRAPBOOK_FALLBACK_LIBRARY.papers[0];
}

function applyJournalPaperToElement(element, paperId) {
  if (!element) return;
  const paper = scrapbookPaperById(paperId);
  if (!paper) return;
  element.dataset.paper = paperId || paper.id;
  element.style.backgroundColor = paper.backgroundColor || "";
  element.style.backgroundImage = paper.backgroundImage || "none";
  element.style.backgroundSize = paper.backgroundSize || "auto";
  element.style.backgroundPosition = paper.backgroundPosition || "0 0";
  element.style.backgroundRepeat = paper.backgroundRepeat || "repeat";
}

function safeDecorToken(value, fallback = "plain") {
  const token = String(value || "").toLowerCase();
  return /^[a-z0-9-]+$/.test(token) ? token : fallback;
}

function safeDecorBase(value) {
  const color = String(value || "").trim();
  return /^(#[0-9a-f]{3,8}|rgba?\([0-9.,%\s]+\)|hsla?\([0-9.,%\s]+\))$/i.test(color) ? color : "#f2c8d5";
}

function journalDecorDefinition(item) {
  const found = item?.decorId
    ? FUWA_SCRAPBOOK_LIBRARY.journalBits.find(bit => bit.id === item.decorId)
    : null;
  if (found) return found;

  const legacyBase = {
    blush: "#efb2c6",
    lavender: "#d8c8ea",
    rose: "#f3c7d3",
    cream: "#f7ead0",
    daisy: "#f4cad8",
    grid: "#f3dce5",
    note: "#fffaf0"
  };
  const variant = safeDecorToken(item?.variant || "blush", "blush");
  return {
    id: item?.decorId || "",
    kind: safeDecorToken(item?.decorKind || "label", "label"),
    variant,
    text: item?.text || "",
    label: "Journal decoration",
    style: {
      base: legacyBase[variant] || "#f2c8d5",
      pattern: ["daisy", "grid"].includes(variant) ? variant : "solid",
      palette: ["blush", "lavender", "rose", "cream"].includes(variant) ? variant : ""
    }
  };
}

function journalDecorVisualMeta(definition) {
  const kind = safeDecorToken(definition?.kind || "label", "label");
  const variant = safeDecorToken(definition?.variant || "", "");
  const inferredPattern = kind === "frame" && ["film","polaroid","dashed"].includes(variant) ? variant : "plain";
  const pattern = safeDecorToken(definition?.style?.pattern || inferredPattern, inferredPattern);
  const palette = safeDecorToken(definition?.style?.palette || definition?.variant || "blush", "blush");
  const base = safeDecorBase(definition?.style?.base || "");
  const text = String(definition?.text || "");
  return { kind, pattern, palette, base, text };
}

function journalDecorVisualClass(definition) {
  const meta = journalDecorVisualMeta(definition);
  return `decor-visual decor-${meta.kind} decor-pattern-${meta.pattern} decor-palette-${meta.palette}`;
}

function journalDecorVisualStyle(definition) {
  const rawBase = String(definition?.style?.base || "").trim();
  return rawBase ? `--decor-base:${safeDecorBase(rawBase)};` : "";
}

const FUWA_ORIGINAL_STICKER_ART = Object.freeze({
  bow: `<path class="fuwa-svg-fill" d="M31 50C12 31 9 19 18 14c10-6 24 6 32 22C58 20 72 8 82 14c9 5 6 17-13 36 19 19 22 31 13 36-10 6-24-6-32-22-8 16-22 28-32 22-9-5-6-17 13-36Z"/><circle class="fuwa-svg-core" cx="50" cy="50" r="10"/>`,
  heart: `<path class="fuwa-svg-soft" d="M50 84C39 75 17 60 13 39 9 19 34 9 50 28c16-19 41-9 37 11-4 21-26 36-37 45Z"/><path class="fuwa-svg-line" d="M50 80C38 70 21 57 18 40c-2-12 12-19 22-12 4 3 7 7 10 12 3-5 6-9 10-12 10-7 24 0 22 12-3 17-20 30-32 40Z"/>`,
  cloud: `<path class="fuwa-svg-soft" d="M25 69h50c12 0 18-8 18-17 0-10-8-18-19-18-3-13-14-22-28-22-16 0-29 12-30 28C6 42 3 50 6 58c3 7 10 11 19 11Z"/><path class="fuwa-svg-line" d="M22 68h55c10 0 16-7 16-16 0-10-8-18-19-18-3-13-14-22-28-22-16 0-29 12-30 28C7 42 3 50 6 58c3 7 8 10 16 10Z"/>`,
  sakura: `<g class="fuwa-svg-soft"><ellipse cx="50" cy="24" rx="12" ry="19"/><ellipse cx="50" cy="24" rx="12" ry="19" transform="rotate(72 50 50)"/><ellipse cx="50" cy="24" rx="12" ry="19" transform="rotate(144 50 50)"/><ellipse cx="50" cy="24" rx="12" ry="19" transform="rotate(216 50 50)"/><ellipse cx="50" cy="24" rx="12" ry="19" transform="rotate(288 50 50)"/></g><circle class="fuwa-svg-core" cx="50" cy="50" r="8"/><circle class="fuwa-svg-paper" cx="50" cy="50" r="3"/>`,
  daisy: `<g class="fuwa-svg-paper fuwa-svg-stroke"><ellipse cx="50" cy="22" rx="9" ry="18"/><ellipse cx="50" cy="22" rx="9" ry="18" transform="rotate(45 50 50)"/><ellipse cx="50" cy="22" rx="9" ry="18" transform="rotate(90 50 50)"/><ellipse cx="50" cy="22" rx="9" ry="18" transform="rotate(135 50 50)"/></g><circle class="fuwa-svg-core" cx="50" cy="50" r="11"/>`,
  sparkles: `<path class="fuwa-svg-fill" d="M50 7 57 35 84 42 57 49 50 78 43 49 16 42 43 35Z"/><path class="fuwa-svg-soft" d="M76 61 80 74 93 78 80 82 76 95 72 82 59 78 72 74ZM21 13l4 12 12 4-12 4-4 12-4-12-12-4 12-4Z"/>`,
  ribbon: `<path class="fuwa-svg-soft" d="M20 18h60v18H20z"/><path class="fuwa-svg-fill" d="m50 36 18 50-18-13-18 13Z"/><path class="fuwa-svg-line" d="M20 18h60v18H20zm30 18 18 50-18-13-18 13Z"/>`,
  envelope: `<rect class="fuwa-svg-paper fuwa-svg-stroke" x="12" y="25" width="76" height="52" rx="8"/><path class="fuwa-svg-line" d="m16 31 34 27 34-27"/><path class="fuwa-svg-fill" d="M50 65c-8-6-15-11-15-18 0-8 10-11 15-4 5-7 15-4 15 4 0 7-7 12-15 18Z"/>`,
  cat: `<path class="fuwa-svg-soft fuwa-svg-stroke" d="M22 35 18 14l20 12a39 39 0 0 1 24 0l20-12-4 21c8 8 11 19 8 30-4 17-19 25-36 25S18 82 14 65c-3-11 0-22 8-30Z"/><circle class="fuwa-svg-core" cx="37" cy="52" r="3"/><circle class="fuwa-svg-core" cx="63" cy="52" r="3"/><path class="fuwa-svg-line" d="m46 62 4 3 4-3m-4 3v5m-8-4-15 3m15-8-16-2m32 7 15 3m-15-8 16-2"/>`,
  bunny: `<ellipse class="fuwa-svg-soft fuwa-svg-stroke" cx="35" cy="24" rx="12" ry="25" transform="rotate(-8 35 24)"/><ellipse class="fuwa-svg-soft fuwa-svg-stroke" cx="65" cy="24" rx="12" ry="25" transform="rotate(8 65 24)"/><circle class="fuwa-svg-soft fuwa-svg-stroke" cx="50" cy="59" r="34"/><circle class="fuwa-svg-core" cx="38" cy="56" r="3"/><circle class="fuwa-svg-core" cx="62" cy="56" r="3"/><path class="fuwa-svg-line" d="m46 67 4 3 4-3m-4 3v5"/>`,
  strawberry: `<path class="fuwa-svg-fill fuwa-svg-stroke" d="M50 88C28 77 17 55 23 36c5-15 18-20 27-9 9-11 22-6 27 9 6 19-5 41-27 52Z"/><path class="fuwa-svg-leaf" d="m50 28-10-15 12 6 10-7-3 15 13 4-15 5Z"/><g class="fuwa-svg-paper"><circle cx="38" cy="46" r="2"/><circle cx="57" cy="43" r="2"/><circle cx="48" cy="58" r="2"/><circle cx="62" cy="62" r="2"/><circle cx="39" cy="69" r="2"/></g>`,
  cup: `<path class="fuwa-svg-paper fuwa-svg-stroke" d="M20 34h54v34c0 12-10 20-27 20S20 80 20 68Z"/><path class="fuwa-svg-line" d="M74 42h8c11 0 13 20 0 22h-8"/><path class="fuwa-svg-fill" d="M47 67c-7-5-12-9-12-15 0-7 8-9 12-3 4-6 12-4 12 3 0 6-5 10-12 15Z"/><path class="fuwa-svg-line" d="M32 23c-5-7 6-9 1-17m15 17c-5-7 6-9 1-17m15 17c-5-7 6-9 1-17"/>`,
  camera: `<rect class="fuwa-svg-soft fuwa-svg-stroke" x="12" y="30" width="76" height="52" rx="9"/><path class="fuwa-svg-fill" d="m31 30 7-12h24l7 12"/><circle class="fuwa-svg-paper fuwa-svg-stroke" cx="50" cy="56" r="16"/><circle class="fuwa-svg-core" cx="50" cy="56" r="7"/><path class="fuwa-svg-fill" d="M78 47c-5-4-10-1-10 4 0 5 5 9 10 13 5-4 10-8 10-13 0-5-5-8-10-4Z"/>`,
  plane: `<path class="fuwa-svg-fill" d="m88 17-31 34 14 8-7 7-15-4-13 15 7 4 18-12 8 15 7-7-5-20 24-33c5-7 1-13-7-7Z"/><path class="fuwa-svg-line" d="M10 82c17-5 24-13 31-23"/>`,
  ticket: `<path class="fuwa-svg-paper fuwa-svg-stroke" d="M13 28h74v15c-8 1-8 13 0 14v15H13V57c8-1 8-13 0-14Z"/><path class="fuwa-svg-line" d="M62 31v38" stroke-dasharray="4 5"/><path class="fuwa-svg-fill" d="M38 61c-7-5-12-9-12-15 0-7 8-9 12-3 4-6 12-4 12 3 0 6-5 10-12 15Z"/>`,
  book: `<path class="fuwa-svg-paper fuwa-svg-stroke" d="M12 22c15-5 28-2 38 7v55c-10-9-23-12-38-7Zm76 0c-15-5-28-2-38 7v55c10-9 23-12 38-7Z"/><path class="fuwa-svg-fill" d="M50 61c-7-5-12-9-12-15 0-7 8-9 12-3 4-6 12-4 12 3 0 6-5 10-12 15Z"/>`,
  moon: `<path class="fuwa-svg-soft fuwa-svg-stroke" d="M62 12c-24 8-29 43-7 58 11 8 25 7 35 0-8 16-23 24-39 20C28 85 16 61 24 39 30 23 45 13 62 12Z"/><path class="fuwa-svg-fill" d="m73 22 3 10 10 3-10 3-3 10-3-10-10-3 10-3Zm12 33 2 7 7 2-7 2-2 7-2-7-7-2 7-2Z"/>`,
  flowerstamp: `<rect class="fuwa-svg-paper fuwa-svg-stroke" x="17" y="17" width="66" height="66" rx="5" stroke-dasharray="4 4"/><g class="fuwa-svg-soft"><ellipse cx="50" cy="38" rx="8" ry="14"/><ellipse cx="50" cy="38" rx="8" ry="14" transform="rotate(72 50 52)"/><ellipse cx="50" cy="38" rx="8" ry="14" transform="rotate(144 50 52)"/><ellipse cx="50" cy="38" rx="8" ry="14" transform="rotate(216 50 52)"/><ellipse cx="50" cy="38" rx="8" ry="14" transform="rotate(288 50 52)"/></g><circle class="fuwa-svg-core" cx="50" cy="52" r="6"/>`
});

function forceTextPresentation(value) {
  const text = String(value || "").replace(/\uFE0F/g, "").replace(/\uFE0E/g, "");
  return text ? `${text}\uFE0E` : "";
}

function builtInStickerDefinition(item) {
  if (!item) return null;
  if (item.builtInStickerId) {
    const found = FUWA_SCRAPBOOK_LIBRARY.stickers.find(sticker => sticker.id === item.builtInStickerId);
    if (found) return found;
  }
  if (item.stickerType === "fuwa-art" && item.stickerArt) {
    return {
      id: item.builtInStickerId || "",
      type: "fuwa-art",
      art: item.stickerArt,
      palette: item.stickerPalette || "pink",
      label: "Fuwa Original"
    };
  }
  return null;
}

function fuwaOriginalStickerMarkup(sticker) {
  const art = FUWA_ORIGINAL_STICKER_ART[sticker?.art];
  if (!art) return "";
  const palette = ["pink","lavender","cream","mint","sky"].includes(sticker?.palette) ? sticker.palette : "pink";
  return `<span class="fuwa-original-sticker palette-${palette}"><svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">${art}</svg></span>`;
}

function builtInStickerVisualMarkup(sticker, fallback = "✨") {
  if (sticker?.type === "fuwa-art") {
    const art = fuwaOriginalStickerMarkup(sticker);
    if (art) return art;
  }
  const raw = sticker?.emoji || fallback || "✨";
  const isSymbol = sticker?.category === "symbols";
  const glyph = isSymbol ? forceTextPresentation(raw) : raw;
  return `<span class="${isSymbol ? "symbol-sticker-glyph" : "emoji-sticker-glyph"}">${escapeHtml(glyph)}</span>`;
}

function queueJournalCanvasSave() {
  if (!journalCanvasState || !activeJournalCanvasId) return;
  clearTimeout(journalCanvasSaveTimer);
  journalCanvasSaveTimer = setTimeout(() => {
    journalCanvasSaveTimer = null;
    saveJournalCanvas({ quiet: true }).catch(error => console.error("Could not auto-save scrapbook page.", error));
  }, 700);
}

function defaultJournalCanvas({ id = uid("scrapbook"), entryId = null, bookId = null, title = "Untitled page", date = isoToday() } = {}) {
  const record = {
    id,
    title: title || "Untitled page",
    date: date || isoToday(),
    background: "blush",
    items: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  if (bookId) record.bookId = bookId;
  // Omit entryId entirely for standalone pages so the legacy unique IndexedDB
  // index never treats multiple standalone pages as the same linked page.
  if (entryId) record.entryId = entryId;
  return record;
}

function cleanupJournalCanvasUrls() {
  for (const url of journalCanvasAssetUrls.values()) URL.revokeObjectURL(url);
  for (const url of journalCanvasMediaUrls.values()) URL.revokeObjectURL(url);
  journalCanvasAssetUrls.clear();
  journalCanvasMediaUrls.clear();
}

async function loadJournalCanvasReferencedUrls() {
  cleanupJournalCanvasUrls();
  const items = journalCanvasState?.items || [];
  const customIds = [...new Set(items.filter(item => item.type === "custom" && item.assetId).map(item => item.assetId))];
  const entryMediaIds = [...new Set(items.filter(item => item.type === "photo" && item.mediaId && item.mediaSource !== "scrapbook").map(item => item.mediaId))];
  const scrapbookMediaIds = [...new Set(items.filter(item => item.type === "photo" && item.mediaId && item.mediaSource === "scrapbook").map(item => item.mediaId))];

  const [assets, entryMedia, scrapbookMedia] = await Promise.all([
    Promise.all(customIds.map(id => diaryRepository.get("stickerAssets", id))),
    Promise.all(entryMediaIds.map(id => diaryRepository.get("media", id))),
    Promise.all(scrapbookMediaIds.map(id => diaryRepository.get("scrapbookPhotos", id)))
  ]);

  assets.filter(Boolean).forEach(asset => {
    if (asset?.blob) journalCanvasAssetUrls.set(asset.id, URL.createObjectURL(asset.blob));
  });
  entryMedia.filter(Boolean).forEach(record => {
    if (record?.blob) journalCanvasMediaUrls.set(`entry:${record.id}`, URL.createObjectURL(record.blob));
  });
  scrapbookMedia.filter(Boolean).forEach(record => {
    if (record?.blob) journalCanvasMediaUrls.set(`scrapbook:${record.id}`, URL.createObjectURL(record.blob));
  });
}

function journalPhotoUrlKey(item) {
  return `${item?.mediaSource === "scrapbook" ? "scrapbook" : "entry"}:${item?.mediaId || ""}`;
}


function journalCanvasItemMarkup(item) {
  const style = `left:${Math.max(0, Math.min(1, Number(item.x ?? .5))) * 100}%;top:${Math.max(0, Math.min(1, Number(item.y ?? .5))) * 100}%;transform:translate(-50%,-50%) rotate(${Number(item.rotation || 0)}deg) scale(${Number(item.scale || 1)});z-index:${Number(item.z || 1)};`;
  const selected = item.id === selectedJournalCanvasItemId ? " selected" : "";
  if (item.type === "builtin") {
    const sticker = builtInStickerDefinition(item);
    const symbolClass = sticker?.category === "symbols" ? " symbol-sticker-item" : "";
    const originalClass = sticker?.type === "fuwa-art" ? " fuwa-original-item" : "";
    return `<button type="button" class="journal-canvas-item sticker-item${symbolClass}${originalClass}${selected}" data-canvas-item="${escapeHtml(item.id)}" style="${style}" aria-label="${escapeHtml(sticker?.label || "Sticker")}">${builtInStickerVisualMarkup(sticker, item.content || "✨")}</button>`;
  }
  if (item.type === "custom") {
    const src = journalCanvasAssetUrls.get(item.assetId) || "";
    return `<button type="button" class="journal-canvas-item image-item${selected}" data-canvas-item="${escapeHtml(item.id)}" style="${style}" aria-label="Custom sticker"><img src="${src}" alt="Custom sticker"></button>`;
  }
  if (item.type === "photo") {
    const src = journalCanvasMediaUrls.get(journalPhotoUrlKey(item)) || "";
    const photoStyle = journalPhotoStyle(item);
    return `<button type="button" class="journal-canvas-item photo-item photo-style-${photoStyle}${selected}" data-canvas-item="${escapeHtml(item.id)}" style="${style}" aria-label="Entry photo"><img src="${src}" alt="Entry photo"></button>`;
  }
  if (item.type === "decor") {
    const definition = journalDecorDefinition(item);
    const meta = journalDecorVisualMeta(definition);
    const text = escapeHtml(meta.text || item.text || "");
    return `<button type="button" class="journal-canvas-item decor-item ${journalDecorVisualClass(definition)}${selected}" data-canvas-item="${escapeHtml(item.id)}" style="${style}${journalDecorVisualStyle(definition)}" aria-label="${escapeHtml(definition.label || "Journal decoration")}">${text ? `<span>${text}</span>` : ""}</button>`;
  }
  return `<button type="button" class="journal-canvas-item text-item ${journalTextClassNames(item)}${selected}" data-canvas-item="${escapeHtml(item.id)}" style="${style}">${escapeHtml(item.text || "Little note")}</button>`;
}

const JOURNAL_PHOTO_STYLES = ["classic", "plain", "polaroid", "rounded", "taped", "circle"];

function journalPhotoStyle(item) {
  return JOURNAL_PHOTO_STYLES.includes(item?.photoStyle) ? item.photoStyle : "classic";
}

const JOURNAL_TEXT_FONTS = ["journal", "soft", "typewriter"];
const JOURNAL_TEXT_SIZES = ["small", "medium", "large"];
const JOURNAL_TEXT_ALIGNS = ["left", "center", "right"];
const JOURNAL_TEXT_COLORS = ["ink", "rose", "lavender", "cocoa"];
const JOURNAL_TEXT_BACKGROUNDS = ["paper", "none", "blush", "lavender"];

function journalTextStyle(item) {
  return {
    font: JOURNAL_TEXT_FONTS.includes(item?.textFont) ? item.textFont : "journal",
    size: JOURNAL_TEXT_SIZES.includes(item?.textSize) ? item.textSize : "medium",
    align: JOURNAL_TEXT_ALIGNS.includes(item?.textAlign) ? item.textAlign : "center",
    color: JOURNAL_TEXT_COLORS.includes(item?.textColor) ? item.textColor : "ink",
    background: JOURNAL_TEXT_BACKGROUNDS.includes(item?.textBackground) ? item.textBackground : "paper",
    bold: item?.textBold === true,
    italic: item?.textItalic === true
  };
}

function journalTextClassNames(item) {
  const style = journalTextStyle(item);
  return [
    `text-font-${style.font}`,
    `text-size-${style.size}`,
    `text-align-${style.align}`,
    `text-color-${style.color}`,
    `text-bg-${style.background}`,
    style.bold ? "text-bold" : "",
    style.italic ? "text-italic" : ""
  ].filter(Boolean).join(" ");
}

function journalCanvasTransformStyle(item) {
  return `translate(-50%,-50%) rotate(${Number(item.rotation || 0)}deg) scale(${Number(item.scale || 1)})`;
}

function updateJournalCanvasItemElement(item) {
  if (!item) return;
  const element = [...document.querySelectorAll("[data-canvas-item]")].find(node => node.dataset.canvasItem === item.id);
  if (!element) return;
  element.style.left = `${Math.max(0, Math.min(1, Number(item.x ?? .5))) * 100}%`;
  element.style.top = `${Math.max(0, Math.min(1, Number(item.y ?? .5))) * 100}%`;
  element.style.transform = journalCanvasTransformStyle(item);
  element.style.zIndex = String(Number(item.z || 1));
}


function bindJournalCanvasItems() {
  document.querySelectorAll("[data-canvas-item]").forEach(element => {
    element.addEventListener("click", event => {
      event.stopPropagation();
      selectJournalCanvasItem(element.dataset.canvasItem);
    });
    element.addEventListener("pointerdown", beginJournalCanvasDrag);
  });
}

function renderJournalCanvas() {
  const canvas = $("journalCanvasPaper");
  if (!canvas || !journalCanvasState) return;
  applyJournalPaperToElement(canvas, journalCanvasState.background || "blush");
  canvas.innerHTML = journalCanvasState.items.map(journalCanvasItemMarkup).join("");
  bindJournalCanvasItems();
  renderJournalCanvasControls();
}

function renderJournalCanvasControls() {
  const item = journalCanvasState?.items.find(x => x.id === selectedJournalCanvasItemId) || null;
  $("journalCanvasItemControls")?.classList.toggle("hidden", !item);
  if (!item) return;
  if ($("journalCanvasScale")) $("journalCanvasScale").value = String(Math.round((item.scale || 1) * 100));
  if ($("journalCanvasRotation")) $("journalCanvasRotation").value = String(Number(item.rotation || 0));

  const photoControls = $("journalPhotoStyleControls");
  const textControls = $("journalTextStyleControls");
  const isPhoto = item.type === "photo";
  const isText = item.type === "text";
  photoControls?.classList.toggle("hidden", !isPhoto);
  textControls?.classList.toggle("hidden", !isText);

  if (isPhoto) {
    const activeStyle = journalPhotoStyle(item);
    document.querySelectorAll("[data-journal-photo-style]").forEach(button => {
      const active = button.dataset.journalPhotoStyle === activeStyle;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  if (isText) syncJournalTextControls(item);
}

function selectJournalCanvasItem(id) {
  selectedJournalCanvasItemId = id;
  document.querySelectorAll("[data-canvas-item]").forEach(element => {
    element.classList.toggle("selected", element.dataset.canvasItem === id);
  });
  renderJournalCanvasControls();
}

function beginJournalCanvasDrag(event) {
  if (!journalCanvasState) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;

  event.preventDefault();
  event.stopPropagation();

  const element = event.currentTarget;
  const id = element.dataset.canvasItem;
  const item = journalCanvasState.items.find(x => x.id === id);
  const paper = $("journalCanvasPaper");
  if (!item || !paper) return;

  selectedJournalCanvasItemId = id;
  document.querySelectorAll("[data-canvas-item]").forEach(node => {
    node.classList.toggle("selected", node.dataset.canvasItem === id);
  });
  renderJournalCanvasControls();

  const pointerId = event.pointerId;
  const rect = paper.getBoundingClientRect();
  let moved = false;

  try { element.setPointerCapture?.(pointerId); } catch {}

  const move = moveEvent => {
    if (moveEvent.pointerId !== pointerId) return;
    moveEvent.preventDefault();

    const nextX = (moveEvent.clientX - rect.left) / Math.max(1, rect.width);
    const nextY = (moveEvent.clientY - rect.top) / Math.max(1, rect.height);

    item.x = Math.max(0.03, Math.min(0.97, nextX));
    item.y = Math.max(0.03, Math.min(0.97, nextY));
    element.style.left = `${item.x * 100}%`;
    element.style.top = `${item.y * 100}%`;
    moved = true;
  };

  const end = endEvent => {
    if (endEvent?.pointerId != null && endEvent.pointerId !== pointerId) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    try { element.releasePointerCapture?.(pointerId); } catch {}
    if (moved) queueJournalCanvasSave();
    renderJournalCanvasControls();
  };

  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

function addJournalCanvasItem(item) {
  if (!journalCanvasState) return;
  const maxZ = journalCanvasState.items.reduce((max, current) => Math.max(max, Number(current.z || 0)), 0);
  const record = {
    ...item,
    id: uid("canvas"),
    x: Number.isFinite(Number(item.x)) ? Number(item.x) : .5,
    y: Number.isFinite(Number(item.y)) ? Number(item.y) : .46,
    scale: Number.isFinite(Number(item.scale)) ? Number(item.scale) : 1,
    rotation: Number.isFinite(Number(item.rotation)) ? Number(item.rotation) : 0,
    z: maxZ + 1
  };
  journalCanvasState.items.push(record);
  selectedJournalCanvasItemId = record.id;
  renderJournalCanvas();
  queueJournalCanvasSave();
}

function renderStickerCategoryBar() {
  const host = $("stickerCategoryBar");
  if (!host) return;
  const groups = orderedScrapbookGroups(FUWA_SCRAPBOOK_LIBRARY.stickerCategories || []);
  if (!groups.some(group => group.id === activeStickerCategory)) activeStickerCategory = groups[0]?.id || "";
  host.innerHTML = groups.map(group => `
    <button type="button" class="${group.id === activeStickerCategory ? "active" : ""}" data-sticker-category="${escapeHtml(group.id)}">
      <span>${escapeHtml(group.icon || "•")}</span>${escapeHtml(group.label || group.id)}
    </button>`).join("");
  host.querySelectorAll("[data-sticker-category]").forEach(button => {
    button.addEventListener("click", () => {
      activeStickerCategory = button.dataset.stickerCategory;
      renderBuiltinStickerPalette();
    });
  });
}

function renderBuiltinStickerPalette() {
  const host = $("builtinStickerPalette");
  if (!host) return;
  renderStickerCategoryBar();
  const stickers = FUWA_SCRAPBOOK_LIBRARY.stickers.filter(sticker => sticker.category === activeStickerCategory);
  host.innerHTML = stickers.map(sticker => {
    const symbolClass = sticker.category === "symbols" ? " symbol-sticker-button" : "";
    const originalClass = sticker.type === "fuwa-art" ? " fuwa-original-button" : "";
    return `
      <button type="button" class="sticker-palette-button${symbolClass}${originalClass}" data-add-builtin-sticker="${escapeHtml(sticker.id)}" title="${escapeHtml(sticker.label || "Sticker")}" aria-label="${escapeHtml(sticker.label || "Sticker")}">
        ${builtInStickerVisualMarkup(sticker)}
      </button>`;
  }).join("");
  host.querySelectorAll("[data-add-builtin-sticker]").forEach(button => {
    button.addEventListener("click", () => {
      const sticker = FUWA_SCRAPBOOK_LIBRARY.stickers.find(item => item.id === button.dataset.addBuiltinSticker);
      if (!sticker) return;
      addJournalCanvasItem({
        type: "builtin",
        builtInStickerId: sticker.id,
        content: sticker.emoji || "",
        stickerType: sticker.type || "unicode",
        stickerArt: sticker.art || "",
        stickerPalette: sticker.palette || ""
      });
    });
  });
}

function renderJournalBitGroupBar() {
  const host = $("journalBitGroupBar");
  if (!host) return;
  const groups = orderedScrapbookGroups(FUWA_SCRAPBOOK_LIBRARY.journalBitGroups || []);
  if (!groups.some(group => group.id === activeJournalBitGroup)) activeJournalBitGroup = groups[0]?.id || "";
  host.innerHTML = groups.map(group => `
    <button type="button" class="${group.id === activeJournalBitGroup ? "active" : ""}" data-journal-bit-group="${escapeHtml(group.id)}">
      <span>${escapeHtml(group.icon || "•")}</span>${escapeHtml(group.label || group.id)}
    </button>`).join("");
  host.querySelectorAll("[data-journal-bit-group]").forEach(button => {
    button.addEventListener("click", () => {
      activeJournalBitGroup = button.dataset.journalBitGroup;
      renderJournalDecorPalette();
    });
  });
}

function renderJournalDecorPalette() {
  const host = $("journalDecorPalette");
  if (!host) return;
  renderJournalBitGroupBar();
  const bits = FUWA_SCRAPBOOK_LIBRARY.journalBits.filter(item => item.group === activeJournalBitGroup);
  host.innerHTML = bits.map(item => {
    const meta = journalDecorVisualMeta(item);
    const text = escapeHtml(meta.text || "");
    return `
      <button type="button" class="journal-decor-palette-item" data-add-journal-decor="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.label || "Journal decoration")}">
        <span class="journal-decor-preview ${journalDecorVisualClass(item)}" style="${journalDecorVisualStyle(item)}">${text ? `<b>${text}</b>` : ""}</span>
        <small>${escapeHtml(item.label || "Journal Bit")}</small>
      </button>`;
  }).join("");
  host.querySelectorAll("[data-add-journal-decor]").forEach(button => {
    button.addEventListener("click", () => {
      const decor = FUWA_SCRAPBOOK_LIBRARY.journalBits.find(item => item.id === button.dataset.addJournalDecor);
      if (!decor) return;
      addJournalCanvasItem({
        type: "decor",
        decorId: decor.id,
        decorKind: decor.kind,
        variant: decor.variant || "",
        text: decor.text || "",
        scale: Number.isFinite(Number(decor.defaultScale)) ? Number(decor.defaultScale) : 1,
        rotation: Number.isFinite(Number(decor.defaultRotation)) ? Number(decor.defaultRotation) : 0
      });
    });
  });
}

function renderPaperCategoryBar() {
  const host = $("paperCategoryBar");
  if (!host) return;
  const groups = orderedScrapbookGroups(FUWA_SCRAPBOOK_LIBRARY.paperCategories || []);
  if (!groups.some(group => group.id === activePaperCategory)) activePaperCategory = groups[0]?.id || "";
  host.innerHTML = groups.map(group => `
    <button type="button" class="${group.id === activePaperCategory ? "active" : ""}" data-paper-category="${escapeHtml(group.id)}">
      ${escapeHtml(group.label || group.id)}
    </button>`).join("");
  host.querySelectorAll("[data-paper-category]").forEach(button => {
    button.addEventListener("click", () => {
      activePaperCategory = button.dataset.paperCategory;
      renderJournalPaperPalette({ preserveCategory: true });
    });
  });
}

function renderJournalPaperPalette({ preserveCategory = false } = {}) {
  const host = $("journalPaperOptions");
  if (!host) return;
  const currentPaper = scrapbookPaperById(journalCanvasState?.background || "blush");
  if (!preserveCategory && currentPaper?.category) activePaperCategory = currentPaper.category;
  renderPaperCategoryBar();
  let papers = FUWA_SCRAPBOOK_LIBRARY.papers.filter(paper => paper.category === activePaperCategory);
  if (
    currentPaper &&
    currentPaper.category === activePaperCategory &&
    !papers.some(paper => paper.id === currentPaper.id)
  ) {
    papers = [currentPaper, ...papers];
  }
  host.innerHTML = papers.map(paper => `
    <button type="button" class="${journalCanvasState?.background === paper.id ? "active" : ""}" data-journal-paper="${escapeHtml(paper.id)}">
      <span class="paper-swatch" data-paper-preview="${escapeHtml(paper.id)}"></span>
      <span>${escapeHtml(paper.name || paper.id)}</span>
    </button>`).join("");
  host.querySelectorAll("[data-paper-preview]").forEach(preview => {
    applyJournalPaperToElement(preview, preview.dataset.paperPreview);
  });
  host.querySelectorAll("[data-journal-paper]").forEach(button => {
    button.addEventListener("click", () => setJournalPaper(button.dataset.journalPaper));
  });
}

async function renderMyStickerPalette() {
  const host = $("myStickerPalette");
  if (!host) return;
  host.innerHTML = `<p class="journal-palette-empty">Loading My Stickers…</p>`;
  const assets = await diaryRepository.getAll("stickerAssets");
  assets.forEach(asset => {
    if (asset?.blob && !journalCanvasAssetUrls.has(asset.id)) {
      journalCanvasAssetUrls.set(asset.id, URL.createObjectURL(asset.blob));
    }
  });
  host.innerHTML = assets.length ? assets.sort((a,b) => b.createdAt - a.createdAt).map(asset => {
    const src = journalCanvasAssetUrls.get(asset.id) || "";
    return `<div class="my-sticker-chip"><button type="button" data-add-custom-sticker="${escapeHtml(asset.id)}"><img loading="lazy" decoding="async" src="${src}" alt="${escapeHtml(asset.name || "My sticker")}"></button><button type="button" class="my-sticker-delete" data-delete-custom-sticker="${escapeHtml(asset.id)}" aria-label="Delete sticker">×</button></div>`;
  }).join("") : `<p class="journal-palette-empty">Import PNG, JPG, or WebP stickers from your device. Transparent PNG/WebP works best.</p>`;
  host.querySelectorAll("[data-add-custom-sticker]").forEach(button => button.addEventListener("click", () => addJournalCanvasItem({ type: "custom", assetId: button.dataset.addCustomSticker })));
  host.querySelectorAll("[data-delete-custom-sticker]").forEach(button => button.addEventListener("click", () => deleteCustomSticker(button.dataset.deleteCustomSticker)));
  journalPaletteLoaded.mine = true;
}

async function removeStickerBackgroundLocally(blob) {
  const image = await imageFromBlob(blob);
  const maxDimension = 900;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!context) throw new Error("Canvas is unavailable.");

  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const frame = context.getImageData(0, 0, width, height);
  const pixels = frame.data;
  const pixelCount = width * height;

  const colorAt = pixelIndex => {
    const offset = pixelIndex * 4;
    return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
  };

  const colorDistanceSq = (a, b) => {
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
  };

  /*
   * V72 gentle removal:
   * Learn the background mostly from corner regions instead of the complete
   * image border. People, clothing and objects often touch the bottom edge,
   * so treating that entire edge as "background" can eat into the subject.
   */
  const buckets = new Map();
  const quantize = value => Math.min(255, Math.round(value / 20) * 20);
  const addSample = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 4;
    if (pixels[offset + 3] < 20) return;
    const qr = quantize(pixels[offset]);
    const qg = quantize(pixels[offset + 1]);
    const qb = quantize(pixels[offset + 2]);
    const key = `${qr},${qg},${qb}`;
    const current = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    current.count += 1;
    current.r += pixels[offset];
    current.g += pixels[offset + 1];
    current.b += pixels[offset + 2];
    buckets.set(key, current);
  };

  const sampleStep = Math.max(1, Math.floor(Math.min(width, height) / 100));
  const cornerW = Math.max(2, Math.round(width * 0.16));
  const cornerH = Math.max(2, Math.round(height * 0.16));

  const sampleRegion = (xStart, yStart, xEnd, yEnd) => {
    for (let y = yStart; y < yEnd; y += sampleStep) {
      for (let x = xStart; x < xEnd; x += sampleStep) {
        addSample(x, y);
      }
    }
  };

  sampleRegion(0, 0, cornerW, cornerH);
  sampleRegion(Math.max(0, width - cornerW), 0, width, cornerH);
  sampleRegion(0, Math.max(0, height - cornerH), cornerW, height);
  sampleRegion(Math.max(0, width - cornerW), Math.max(0, height - cornerH), width, height);

  // A few sparse samples along the top and side edges help with gradients,
  // while deliberately avoiding the central bottom edge.
  for (let x = 0; x < width; x += sampleStep * 2) addSample(x, 0);
  for (let y = 0; y < height; y += sampleStep * 2) {
    addSample(0, y);
    addSample(width - 1, y);
  }

  const palette = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 14)
    .map(bucket => [
      bucket.r / bucket.count,
      bucket.g / bucket.count,
      bucket.b / bucket.count
    ]);

  if (!palette.length) throw new Error("Fuwa could not detect a background.");

  const distanceToPaletteSq = pixelIndex => {
    const color = colorAt(pixelIndex);
    let best = Infinity;
    for (const backgroundColor of palette) {
      const distance = colorDistanceSq(color, backgroundColor);
      if (distance < best) best = distance;
    }
    return best;
  };

  const buildConnectedBackgroundMask = async tolerance => {
    const toleranceSq = tolerance * tolerance;
    const neighborToleranceSq = 46 * 46;
    const mask = new Uint8Array(pixelCount);
    const queue = new Int32Array(pixelCount);
    let head = 0;
    let tail = 0;

    const trySeed = pixelIndex => {
      if (pixelIndex < 0 || pixelIndex >= pixelCount || mask[pixelIndex]) return;
      const alpha = pixels[pixelIndex * 4 + 3];
      if (alpha <= 10 || distanceToPaletteSq(pixelIndex) <= toleranceSq) {
        mask[pixelIndex] = 1;
        queue[tail++] = pixelIndex;
      }
    };

    const tryGrow = (fromIndex, pixelIndex) => {
      if (pixelIndex < 0 || pixelIndex >= pixelCount || mask[pixelIndex]) return;

      const alpha = pixels[pixelIndex * 4 + 3];
      if (alpha <= 10) {
        mask[pixelIndex] = 1;
        queue[tail++] = pixelIndex;
        return;
      }

      if (distanceToPaletteSq(pixelIndex) > toleranceSq) return;

      // Do not jump across a strong local color edge. This helps preserve
      // pale clothes, skin and hair even when they resemble the background.
      const localDistance = colorDistanceSq(colorAt(fromIndex), colorAt(pixelIndex));
      if (localDistance > neighborToleranceSq) return;

      mask[pixelIndex] = 1;
      queue[tail++] = pixelIndex;
    };

    // Seed from corners, top edge, side edges, and only the outer portions
    // of the bottom edge. The central bottom is intentionally protected.
    const seedInset = Math.max(1, Math.round(Math.min(width, height) * 0.02));

    for (let x = 0; x < width; x++) {
      trySeed(x);
      if (x < width * 0.24 || x > width * 0.76) {
        trySeed((height - 1) * width + x);
      }
    }
    for (let y = 1; y < height - 1; y++) {
      trySeed(y * width);
      trySeed(y * width + width - 1);
    }

    // Reinforce the four corner blocks.
    for (let y = 0; y < Math.min(cornerH, height); y += seedInset) {
      for (let x = 0; x < Math.min(cornerW, width); x += seedInset) {
        trySeed(y * width + x);
        trySeed(y * width + (width - 1 - x));
        trySeed((height - 1 - y) * width + x);
        trySeed((height - 1 - y) * width + (width - 1 - x));
      }
    }

    while (head < tail) {
      const pixelIndex = queue[head++];
      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);

      if (x > 0) tryGrow(pixelIndex, pixelIndex - 1);
      if (x < width - 1) tryGrow(pixelIndex, pixelIndex + 1);
      if (y > 0) tryGrow(pixelIndex, pixelIndex - width);
      if (y < height - 1) tryGrow(pixelIndex, pixelIndex + width);

      if (head % 42000 === 0) {
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    }

    return { mask, removed: tail, tolerance };
  };

  // Conservative by default. Unlike v71, Fuwa no longer jumps to a very
  // aggressive 108 tolerance just because a small amount was removed.
  let result = await buildConnectedBackgroundMask(54);
  let ratio = result.removed / pixelCount;

  if (ratio < 0.025) {
    result = await buildConnectedBackgroundMask(66);
    ratio = result.removed / pixelCount;
  }

  // If the result still tries to remove too much, retreat instead of trusting
  // it. Subject preservation is more important than a perfectly clean cutout.
  if (ratio > 0.66) {
    result = await buildConnectedBackgroundMask(42);
    ratio = result.removed / pixelCount;
  }

  if (ratio < 0.008) {
    throw new Error("Fuwa could not confidently separate this background.");
  }

  const mask = result.mask;

  // A flood fill can still cross a soft edge into pale skin, white clothing,
  // or illustrated hair. Reject that result instead of saving a damaged
  // subject; the import sheet will safely fall back to the original image.
  let centerPixels = 0;
  let centerRemoved = 0;
  const centerLeft = Math.floor(width * 0.2);
  const centerRight = Math.ceil(width * 0.8);
  const centerTop = Math.floor(height * 0.08);
  const centerBottom = Math.ceil(height * 0.95);
  for (let y = centerTop; y < centerBottom; y++) {
    for (let x = centerLeft; x < centerRight; x++) {
      centerPixels += 1;
      if (mask[y * width + x]) centerRemoved += 1;
    }
  }
  const centerRemovalRatio = centerPixels ? centerRemoved / centerPixels : 0;
  if (ratio > 0.68 || centerRemovalRatio > 0.72) {
    throw new Error("Fuwa could not preserve the subject confidently.");
  }

  const featherEnd = result.tolerance + 22;
  const featherToleranceSq = featherEnd * featherEnd;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
    const offset = pixelIndex * 4;

    if (mask[pixelIndex]) {
      pixels[offset + 3] = 0;
      continue;
    }

    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    const touchesBackground =
      (x > 0 && mask[pixelIndex - 1]) ||
      (x < width - 1 && mask[pixelIndex + 1]) ||
      (y > 0 && mask[pixelIndex - width]) ||
      (y < height - 1 && mask[pixelIndex + width]);

    if (touchesBackground) {
      const distanceSq = distanceToPaletteSq(pixelIndex);

      if (distanceSq < featherToleranceSq) {
        const distance = Math.sqrt(distanceSq);
        const start = result.tolerance;
        const factor = Math.max(
          0.62,
          Math.min(1, (distance - start) / Math.max(1, featherEnd - start))
        );
        pixels[offset + 3] = Math.round(pixels[offset + 3] * factor);
      }
    }

    if (pixelIndex > 0 && pixelIndex % 120000 === 0) {
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }

  context.putImageData(frame, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      resultBlob => resultBlob ? resolve(resultBlob) : reject(new Error("Background removal failed.")),
      "image/png"
    );
  });
}

function cleanupPendingStickerImport() {
  stickerImportPreviewToken += 1;
  if (pendingStickerImportPreviewUrl) URL.revokeObjectURL(pendingStickerImportPreviewUrl);
  if (pendingStickerProcessedUrl) URL.revokeObjectURL(pendingStickerProcessedUrl);
  pendingStickerImportPreviewUrl = "";
  pendingStickerProcessedUrl = "";
  pendingStickerProcessedBlob = null;
  pendingStickerImportFile = null;
  if ($("stickerImportPreview")) $("stickerImportPreview").removeAttribute("src");
  if ($("stickerImportRemoveBackground")) $("stickerImportRemoveBackground").checked = false;
  if ($("stickerImportStatus")) $("stickerImportStatus").textContent = "Previewing the original photo.";
}

function closeStickerImportSheet(options = {}) {
  if (stickerImportProcessing && options?.force !== true) return;
  $("stickerImportSheet")?.classList.add("hidden");
  cleanupPendingStickerImport();
}

function openStickerImportSheet(file) {
  cleanupPendingStickerImport();
  pendingStickerImportFile = file;
  pendingStickerImportPreviewUrl = URL.createObjectURL(file);
  if ($("stickerImportPreview")) $("stickerImportPreview").src = pendingStickerImportPreviewUrl;
  if ($("stickerImportRemoveBackground")) $("stickerImportRemoveBackground").checked = false;
  if ($("stickerImportStatus")) $("stickerImportStatus").textContent = "Previewing the original photo.";
  $("stickerImportSheet")?.classList.remove("hidden");
}

async function refreshStickerBackgroundPreview() {
  const file = pendingStickerImportFile;
  const checkbox = $("stickerImportRemoveBackground");
  const preview = $("stickerImportPreview");
  const status = $("stickerImportStatus");
  const saveButton = $("stickerImportSave");
  if (!file || !checkbox || !preview) return;

  const token = ++stickerImportPreviewToken;

  if (!checkbox.checked) {
    pendingStickerProcessedBlob = null;
    if (pendingStickerProcessedUrl) URL.revokeObjectURL(pendingStickerProcessedUrl);
    pendingStickerProcessedUrl = "";
    preview.src = pendingStickerImportPreviewUrl;
    if (status) status.textContent = "Previewing the original photo.";
    if (saveButton) saveButton.disabled = false;
    return;
  }

  if (status) status.textContent = "Removing the background gently while preserving the subject…";
  if (saveButton) saveButton.disabled = true;

  try {
    const processed = await removeStickerBackgroundLocally(file);
    if (token !== stickerImportPreviewToken || !pendingStickerImportFile) return;

    pendingStickerProcessedBlob = processed;
    if (pendingStickerProcessedUrl) URL.revokeObjectURL(pendingStickerProcessedUrl);
    pendingStickerProcessedUrl = URL.createObjectURL(processed);
    preview.src = pendingStickerProcessedUrl;
    if (status) status.textContent = "Gentle transparent preview ready. The checkerboard shows removed areas.";
  } catch (error) {
    console.error("Could not preview background removal.", error);
    if (token !== stickerImportPreviewToken) return;
    pendingStickerProcessedBlob = null;
    checkbox.checked = false;
    preview.src = pendingStickerImportPreviewUrl;
    if (status) status.textContent = "This background was too difficult to separate safely. The original photo is shown.";
    toast("Fuwa couldn't cleanly remove this background.");
  } finally {
    if (token === stickerImportPreviewToken && saveButton) saveButton.disabled = false;
  }
}

async function importCustomSticker(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) return toast("Choose an image for your sticker.");
  if (file.size > 6 * 1024 * 1024) return toast("Keep sticker images under 6 MB.");
  openStickerImportSheet(file);
}

async function savePreparedCustomSticker() {
  const file = pendingStickerImportFile;
  if (!file) return;
  const removeBackground = $("stickerImportRemoveBackground")?.checked === true;
  const targetPageId = activeJournalCanvasId;
  const saveButton = $("stickerImportSave");
  const cancelButton = $("stickerImportCancel");
  const closeButton = $("stickerImportClose");

  try {
    stickerImportProcessing = true;
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = removeBackground ? "Removing…" : "Saving…";
    }
    if (cancelButton) cancelButton.disabled = true;
    if (closeButton) closeButton.disabled = true;
    if (removeBackground) {
      toast("Removing this photo's background on your device…");
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
    }
    const processedBlob = removeBackground
      ? (pendingStickerProcessedBlob || await removeStickerBackgroundLocally(file))
      : file;
    if (processedBlob.size > 8 * 1024 * 1024) throw new Error("Processed sticker is too large.");
    const record = {
      id: uid("sticker"),
      name: file.name.replace(/\.[^.]+$/, "") || "My sticker",
      blob: processedBlob,
      type: processedBlob.type || file.type,
      backgroundRemoved: removeBackground,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await diaryRepository.save("stickerAssets", record);

    const existingUrl = journalCanvasAssetUrls.get(record.id);
    if (existingUrl) URL.revokeObjectURL(existingUrl);
    journalCanvasAssetUrls.set(record.id, URL.createObjectURL(record.blob));

    stickerImportProcessing = false;
    closeStickerImportSheet({ force: true });
    await renderMyStickerPalette();

    if (targetPageId && activeJournalCanvasId === targetPageId && journalCanvasState) {
      addJournalCanvasItem({ type: "custom", assetId: record.id });
      toast(removeBackground ? "Sticker added with this photo's background removed 🎀" : "Sticker added to My Stickers 🎀");
    } else {
      toast("Sticker saved to My Stickers on this device 🎀");
    }
  } catch (error) {
    console.error("Could not save custom sticker.", error);
    toast(removeBackground ? "Fuwa couldn't remove this background. Try a simpler photo or add it without background removal." : "Fuwa couldn't save that sticker on this device.");
  } finally {
    stickerImportProcessing = false;
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = "Add Sticker";
    }
    if (cancelButton) cancelButton.disabled = false;
    if (closeButton) closeButton.disabled = false;
  }
}


async function deleteCustomSticker(assetId) {
  if (!confirm("Delete this sticker from My Stickers? Existing decorated pages using it will show a missing sticker.")) return;
  try {
    await diaryRepository.remove("stickerAssets", assetId);
    const url = journalCanvasAssetUrls.get(assetId);
    if (url) URL.revokeObjectURL(url);
    journalCanvasAssetUrls.delete(assetId);
    await renderMyStickerPalette();
    renderJournalCanvas();
  } catch (error) {
    console.error("Could not delete custom sticker.", error);
    toast("Fuwa couldn't delete that sticker.");
  }
}

async function renderJournalPhotoPalette() {
  const host = $("journalPhotoPalette");
  if (!host || !activeJournalCanvasId) return;
  const expectedPageId = activeJournalCanvasId;
  const expectedEntryId = activeJournalCanvasEntryId;
  host.innerHTML = `<p class="journal-palette-empty">Loading photos…</p>`;

  const [entryMedia, scrapbookMedia] = await Promise.all([
    expectedEntryId ? diaryRepository.getMediaForEntry(expectedEntryId) : Promise.resolve([]),
    diaryRepository.getScrapbookPhotos(expectedPageId)
  ]);
  if (activeJournalCanvasId !== expectedPageId) return;

  entryMedia.forEach(record => {
    const key = `entry:${record.id}`;
    if (record?.blob && !journalCanvasMediaUrls.has(key)) journalCanvasMediaUrls.set(key, URL.createObjectURL(record.blob));
  });
  scrapbookMedia.forEach(record => {
    const key = `scrapbook:${record.id}`;
    if (record?.blob && !journalCanvasMediaUrls.has(key)) journalCanvasMediaUrls.set(key, URL.createObjectURL(record.blob));
  });

  const blocks = [];
  if (entryMedia.length) {
    blocks.push(`<div class="journal-photo-source-label">From linked journal entry</div><div class="journal-photo-source-grid">${entryMedia.map(record => `<button type="button" class="journal-photo-chip" data-add-entry-photo="${escapeHtml(record.id)}"><img loading="lazy" decoding="async" src="${journalCanvasMediaUrls.get(`entry:${record.id}`) || ""}" alt="Entry photo"></button>`).join("")}</div>`);
  }
  if (scrapbookMedia.length) {
    blocks.push(`<div class="journal-photo-source-label">Added to this scrapbook page</div><div class="journal-photo-source-grid">${scrapbookMedia.map(record => `<div class="journal-photo-palette-wrap"><button type="button" class="journal-photo-chip" data-add-scrapbook-photo="${escapeHtml(record.id)}"><img loading="lazy" decoding="async" src="${journalCanvasMediaUrls.get(`scrapbook:${record.id}`) || ""}" alt="Scrapbook photo"></button><button type="button" class="journal-photo-palette-delete" data-delete-scrapbook-photo="${escapeHtml(record.id)}" aria-label="Delete scrapbook photo">×</button></div>`).join("")}</div>`);
  }
  host.innerHTML = blocks.length ? blocks.join("") : `<p class="journal-palette-empty">No photos here yet. Tap Add Photos to bring some onto this page.</p>`;
  host.querySelectorAll("[data-add-entry-photo]").forEach(button => button.addEventListener("click", () => addJournalCanvasItem({ type: "photo", mediaId: button.dataset.addEntryPhoto, mediaSource: "entry", scale: .9, photoStyle: "classic" })));
  host.querySelectorAll("[data-add-scrapbook-photo]").forEach(button => button.addEventListener("click", () => addJournalCanvasItem({ type: "photo", mediaId: button.dataset.addScrapbookPhoto, mediaSource: "scrapbook", scale: .9, photoStyle: "classic" })));
  host.querySelectorAll("[data-delete-scrapbook-photo]").forEach(button => button.addEventListener("click", () => deleteScrapbookPhoto(button.dataset.deleteScrapbookPhoto)));
  journalPaletteLoaded.photos = true;
}

async function deleteScrapbookPhoto(photoId) {
  if (!photoId || !activeJournalCanvasId) return;
  const targetPageId = activeJournalCanvasId;
  const inUse = (journalCanvasState?.items || []).some(item => item.type === "photo" && item.mediaSource === "scrapbook" && item.mediaId === photoId);
  if (!confirm(inUse ? "Delete this photo? It will also be removed from the scrapbook page." : "Delete this page-only photo from this device?")) return;
  try {
    await diaryRepository.remove("scrapbookPhotos", photoId);
    const key = `scrapbook:${photoId}`;
    const url = journalCanvasMediaUrls.get(key);
    if (url) URL.revokeObjectURL(url);
    journalCanvasMediaUrls.delete(key);
    if (journalCanvasState && activeJournalCanvasId === targetPageId) {
      journalCanvasState.items = journalCanvasState.items.filter(item => !(item.type === "photo" && item.mediaSource === "scrapbook" && item.mediaId === photoId));
      if (!journalCanvasState.items.some(item => item.id === selectedJournalCanvasItemId)) selectedJournalCanvasItemId = null;
      renderJournalCanvas();
      queueJournalCanvasSave();
    }
    if (activeJournalCanvasId === targetPageId) {
      journalPaletteLoaded.photos = false;
      await renderJournalPhotoPalette();
    }
    toast("Scrapbook photo removed.");
  } catch (error) {
    console.error("Could not delete scrapbook photo.", error);
    toast("Fuwa couldn't delete that scrapbook photo.");
  }
}

async function importScrapbookPhotos(event) {
  const files = [...(event.target.files || [])].filter(file => file.type.startsWith("image/"));
  event.target.value = "";
  if (!files.length || !activeJournalCanvasId || !journalCanvasState) return;
  const targetPageId = activeJournalCanvasId;
  const existing = await diaryRepository.getScrapbookPhotos(targetPageId);
  const room = Math.max(0, MAX_SCRAPBOOK_PHOTOS_PER_PAGE - existing.length);
  if (!room) return toast(`Keep up to ${MAX_SCRAPBOOK_PHOTOS_PER_PAGE} page-only photos in one scrapbook page.`);
  const selected = files.slice(0, room);
  if (files.length > room) toast(`Fuwa will add the first ${room} photos to keep this page light.`);

  try {
    toast("Preparing scrapbook photos…");
    const records = [];
    for (const file of selected) {
      const compressed = await compressPhoto(file);
      records.push({
        id: uid("scrapphoto"),
        scrapbookId: targetPageId,
        blob: compressed.blob,
        type: compressed.type,
        width: compressed.width,
        height: compressed.height,
        originalName: file.name,
        createdAt: Date.now()
      });
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
    }
    await diaryRepository.saveScrapbookPhotos(records);
    if (activeJournalCanvasId !== targetPageId || !journalCanvasState) {
      toast(`${records.length} photo${records.length === 1 ? "" : "s"} saved to that scrapbook page 📷`);
      return;
    }
    const maxZ = journalCanvasState.items.reduce((max, current) => Math.max(max, Number(current.z || 0)), 0);
    records.forEach((record, index) => {
      const key = `scrapbook:${record.id}`;
      journalCanvasMediaUrls.set(key, URL.createObjectURL(record.blob));
      journalCanvasState.items.push({
        id: uid("canvas"),
        type: "photo",
        mediaId: record.id,
        mediaSource: "scrapbook",
        photoStyle: "classic",
        x: Math.min(.82, .42 + index * .05),
        y: Math.min(.82, .42 + index * .05),
        scale: .9,
        rotation: index % 2 ? 2 : -2,
        z: maxZ + index + 1
      });
    });
    selectedJournalCanvasItemId = records.length ? journalCanvasState.items[journalCanvasState.items.length - 1].id : null;
    renderJournalCanvas();
    queueJournalCanvasSave();
    journalPaletteLoaded.photos = false;
    await renderJournalPhotoPalette();
    toast(`${records.length} photo${records.length === 1 ? "" : "s"} added locally 📷`);
  } catch (error) {
    console.error("Could not add scrapbook photos.", error);
    toast("Fuwa couldn't add those photos.");
  }
}

function switchJournalPalette(tab) {
  document.querySelectorAll("[data-journal-palette-tab]").forEach(button => button.classList.toggle("active", button.dataset.journalPaletteTab === tab));
  document.querySelectorAll("[data-journal-palette-panel]").forEach(panel => panel.classList.toggle("active", panel.dataset.journalPalettePanel === tab));

  // Heavy local image palettes are intentionally loaded only when opened.
  if (tab === "mine" && !journalPaletteLoaded.mine) renderMyStickerPalette().catch(console.error);
  if (tab === "photos" && !journalPaletteLoaded.photos) renderJournalPhotoPalette().catch(console.error);
}

function scrapbookTitleForRecord(record) {
  if (record?.title?.trim()) return record.title.trim();
  const linkedEntry = record?.entryId ? state.entries.find(entry => entry.id === record.entryId) : null;
  return linkedEntry?.title || "Scrapbook";
}

function scrapbookPageMeta(record, order = 0) {
  return {
    id: record.id,
    title: record.title || `Page ${order + 1}`,
    date: record.date || isoToday(),
    background: record.background || "blush",
    itemCount: Array.isArray(record.items) ? record.items.length : Number(record.itemCount || 0),
    createdAt: record.createdAt || Date.now(),
    updatedAt: record.updatedAt || record.createdAt || Date.now(),
    order
  };
}

function normalizeScrapbookBook(book) {
  const normalized = {
    ...book,
    title: book?.title?.trim() || "Untitled scrapbook",
    pages: Array.isArray(book?.pages) ? book.pages.filter(page => page?.id) : [],
    createdAt: book?.createdAt || Date.now(),
    updatedAt: book?.updatedAt || book?.createdAt || Date.now()
  };
  normalized.pages = normalized.pages
    .slice()
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
    .map((page, order) => ({ ...page, order }));
  return normalized;
}

function currentScrapbookPageIndex() {
  if (!activeScrapbookBook || !activeJournalCanvasId) return -1;
  return activeScrapbookBook.pages.findIndex(page => page.id === activeJournalCanvasId);
}

function updateActiveBookPageMeta(record = journalCanvasState) {
  if (!activeScrapbookBook || !record?.id) return;
  const index = activeScrapbookBook.pages.findIndex(page => page.id === record.id);
  const meta = scrapbookPageMeta(record, index >= 0 ? index : activeScrapbookBook.pages.length);
  if (index >= 0) activeScrapbookBook.pages[index] = meta;
  else activeScrapbookBook.pages.push(meta);
  activeScrapbookBook.pages = activeScrapbookBook.pages.map((page, order) => ({ ...page, order }));
}

async function ensureScrapbookBookForPage(record) {
  if (!record?.id) throw new Error("invalid-scrapbook-page");
  let book = record.bookId ? await diaryRepository.get("scrapbookBooks", record.bookId) : null;
  const bookId = record.bookId || `book_${record.id}`;
  const page = record.bookId ? record : { ...record, bookId };

  if (!book) {
    book = {
      id: bookId,
      title: scrapbookTitleForRecord(record),
      pages: [scrapbookPageMeta(page, 0)],
      createdAt: record.createdAt || Date.now(),
      updatedAt: record.updatedAt || record.createdAt || Date.now()
    };
    if (record.entryId) book.entryId = record.entryId;
  } else {
    book = normalizeScrapbookBook(book);
    if (!book.pages.some(meta => meta.id === page.id)) {
      book.pages.push(scrapbookPageMeta(page, book.pages.length));
    }
    if (!book.entryId && record.entryId) book.entryId = record.entryId;
  }

  await diaryRepository.saveScrapbookPageAndBook(page, book);
  return { book: normalizeScrapbookBook(book), page };
}

function renderScrapbookPageNavigator() {
  const book = activeScrapbookBook ? normalizeScrapbookBook(activeScrapbookBook) : null;
  const strip = $("scrapbookPageStrip");
  if (!book || !strip) return;
  activeScrapbookBook = book;

  const index = currentScrapbookPageIndex();
  const count = book.pages.length;
  const current = index >= 0 ? index : 0;

  if ($("scrapbookPagePosition")) $("scrapbookPagePosition").textContent = `Page ${current + 1} of ${count}`;
  if ($("scrapbookPrevPage")) $("scrapbookPrevPage").disabled = current <= 0 || scrapbookPageSwitching;
  if ($("scrapbookNextPage")) $("scrapbookNextPage").disabled = current >= count - 1 || scrapbookPageSwitching;
  if ($("scrapbookMovePageLeft")) $("scrapbookMovePageLeft").disabled = current <= 0 || scrapbookPageSwitching;
  if ($("scrapbookMovePageRight")) $("scrapbookMovePageRight").disabled = current >= count - 1 || scrapbookPageSwitching;
  if ($("scrapbookDeletePage")) $("scrapbookDeletePage").disabled = count <= 1 || scrapbookPageSwitching;
  if ($("scrapbookAddPage")) $("scrapbookAddPage").disabled = count >= MAX_SCRAPBOOK_PAGES || scrapbookPageSwitching;
  if ($("scrapbookDuplicatePage")) $("scrapbookDuplicatePage").disabled = count >= MAX_SCRAPBOOK_PAGES || scrapbookPageSwitching;

  strip.innerHTML = book.pages.map((page, pageIndex) => `
    <button type="button" class="scrapbook-page-thumb${page.id === activeJournalCanvasId ? " active" : ""}" data-open-book-page="${escapeHtml(page.id)}" aria-label="Open page ${pageIndex + 1}">
      <span class="scrapbook-page-thumb-paper" data-paper="${escapeHtml(page.background || "blush")}"><b>${pageIndex + 1}</b></span>
      <small>${escapeHtml(page.title || `Page ${pageIndex + 1}`)}</small>
    </button>`).join("");

  strip.querySelectorAll(".scrapbook-page-thumb-paper").forEach(preview => {
    applyJournalPaperToElement(preview, preview.dataset.paper || "blush");
  });
  strip.querySelectorAll("[data-open-book-page]").forEach(button => {
    button.addEventListener("click", () => switchScrapbookPage(button.dataset.openBookPage));
  });
}

function updateScrapbookCanvasHeader() {
  if (!activeScrapbookBook || !journalCanvasState) return;
  const index = currentScrapbookPageIndex();
  const linked = activeScrapbookBook.entryId && state.entries.some(entry => entry.id === activeScrapbookBook.entryId);
  if ($("journalBookTitleInput")) $("journalBookTitleInput").value = activeScrapbookBook.title || "Untitled scrapbook";
  if ($("journalCanvasTitleInput")) $("journalCanvasTitleInput").value = journalCanvasState.title || `Page ${Math.max(1, index + 1)}`;
  if ($("journalCanvasEyebrow")) $("journalCanvasEyebrow").textContent = linked ? "Scrapbook linked to a journal memory" : "Your standalone scrapbook";
  if ($("journalPhotoPaletteNote")) $("journalPhotoPaletteNote").textContent = linked ? "Use linked-entry photos or add photos just for this scrapbook page." : "Import photos just for this scrapbook page.";
}

async function activateScrapbookPage(record, { navigateView = false } = {}) {
  if (!record?.id || !activeScrapbookBook) return;
  activeJournalCanvasId = record.id;
  activeJournalCanvasEntryId = activeScrapbookBook.entryId && state.entries.some(entry => entry.id === activeScrapbookBook.entryId) ? activeScrapbookBook.entryId : null;
  selectedJournalCanvasItemId = null;
  journalPaletteLoaded = { mine: false, photos: false };
  journalCanvasState = { ...record, bookId: activeScrapbookBook.id };

  renderBuiltinStickerPalette();
  renderJournalDecorPalette();
  renderJournalPaperPalette();
  updateScrapbookCanvasHeader();
  renderScrapbookPageNavigator();
  if ($("myStickerPalette")) $("myStickerPalette").innerHTML = `<p class="journal-palette-empty">Open this tab to load My Stickers.</p>`;
  if ($("journalPhotoPalette")) $("journalPhotoPalette").innerHTML = `<p class="journal-palette-empty">Open this tab to load photos.</p>`;
  switchJournalPalette("stickers");
  renderJournalCanvas();

  if (navigateView) navigate("journalCanvas");
  else window.scrollTo({ top: 0, behavior: "smooth" });

  try {
    const expectedId = record.id;
    await loadJournalCanvasReferencedUrls();
    if (activeJournalCanvasId === expectedId) renderJournalCanvas();
  } catch (error) {
    console.error("Could not load scrapbook page assets.", error);
  }
}

async function openScrapbookCanvas(record, { returnView = "scrapbook", book = null } = {}) {
  if (!record?.id) return;
  let resolvedBook = book;
  let resolvedPage = record;
  if (!resolvedBook) {
    const ensured = await ensureScrapbookBookForPage(record);
    resolvedBook = ensured.book;
    resolvedPage = ensured.page;
  }

  activeScrapbookBook = normalizeScrapbookBook(resolvedBook);
  activeScrapbookBookId = activeScrapbookBook.id;
  journalCanvasReturnView = returnView;
  await activateScrapbookPage(resolvedPage, { navigateView: true });
}

async function openScrapbookBook(bookId, { pageId = null, returnView = "scrapbook" } = {}) {
  try {
    let book = await diaryRepository.get("scrapbookBooks", bookId);
    if (!book) return toast("That scrapbook could not be found.");
    book = normalizeScrapbookBook(book);
    if (!book.pages.length) return toast("That scrapbook has no pages.");
    const targetMeta = book.pages.find(page => page.id === pageId) || book.pages[0];
    const page = await diaryRepository.get("journalCanvases", targetMeta.id);
    if (!page) return toast("That scrapbook page could not be found.");
    await openScrapbookCanvas(page, { returnView, book });
  } catch (error) {
    console.error("Could not open scrapbook.", error);
    toast("Fuwa couldn't open that scrapbook.");
  }
}

async function openJournalCanvas() {
  const entryId = $("entryId")?.value;
  if (!entryId) {
    toast("Save this entry first, then add it to your scrapbook 🎀");
    return;
  }

  try {
    const entry = state.entries.find(item => item.id === entryId);
    let book = await diaryRepository.getScrapbookBookByEntry(entryId);

    if (!book) {
      const legacyPage = await diaryRepository.get("journalCanvases", entryId);
      if (legacyPage) {
        const ensured = await ensureScrapbookBookForPage(legacyPage);
        book = ensured.book;
      }
    }

    if (!book) {
      const bookId = uid("scrapbookbook");
      const page = defaultJournalCanvas({
        id: entryId,
        entryId,
        bookId,
        title: entry?.title || "Page 1",
        date: entry?.date || isoToday()
      });
      book = {
        id: bookId,
        entryId,
        title: entry?.title || "Scrapbook",
        pages: [scrapbookPageMeta(page, 0)],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await diaryRepository.saveScrapbookPageAndBook(page, book);
    }

    await openScrapbookBook(book.id, { returnView: "editor" });
  } catch (error) {
    console.error("Could not open linked scrapbook.", error);
    toast("Fuwa couldn't open that scrapbook.");
  }
}

async function createStandaloneScrapbookPage() {
  if (scrapbookPageSwitching) return;
  const bookId = uid("scrapbookbook");
  const page = defaultJournalCanvas({ bookId, title: "Page 1", date: isoToday() });
  const book = {
    id: bookId,
    title: "Untitled scrapbook",
    pages: [scrapbookPageMeta(page, 0)],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  try {
    await diaryRepository.saveScrapbookPageAndBook(page, book);
    await openScrapbookCanvas(page, { returnView: "scrapbook", book });
  } catch (error) {
    console.error("Could not create scrapbook.", error);
    toast("Fuwa couldn't create that scrapbook.");
  }
}

async function openScrapbookPageById(id) {
  try {
    const record = await diaryRepository.get("journalCanvases", id);
    if (!record) return toast("That scrapbook page could not be found.");
    const ensured = await ensureScrapbookBookForPage(record);
    await openScrapbookCanvas(ensured.page, { returnView: "scrapbook", book: ensured.book });
  } catch (error) {
    console.error("Could not open scrapbook page.", error);
    toast("Fuwa couldn't open that scrapbook page.");
  }
}

async function renderScrapbookLibrary() {
  const grid = $("scrapbookLibraryGrid");
  if (!grid) return;

  try {
    await diaryRepository.migrateLegacyScrapbookBooks();
    const books = (await diaryRepository.getAll("scrapbookBooks")).map(normalizeScrapbookBook);
    const sort = $("scrapbookSort")?.value || "newest";
    books.sort((a, b) => sort === "oldest"
      ? Number(a.createdAt || 0) - Number(b.createdAt || 0)
      : Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));

    if ($("scrapbookPageCount")) $("scrapbookPageCount").textContent = `${books.length} scrapbook${books.length === 1 ? "" : "s"}`;
    $("scrapbookEmptyState")?.classList.toggle("hidden", books.length > 0);

    grid.innerHTML = books.map(book => {
      const cover = book.pages[0] || {};
      const linkedEntry = book.entryId ? state.entries.find(entry => entry.id === book.entryId) : null;
      const pageCount = book.pages.length;
      const date = cover.date || linkedEntry?.date || "";
      return `<article class="scrapbook-library-card" data-scrapbook-card="${escapeHtml(book.id)}">
        <button type="button" class="scrapbook-card-open" data-open-scrapbook-book="${escapeHtml(book.id)}">
          <span class="scrapbook-card-paper" data-paper="${escapeHtml(cover.background || "blush")}"><i>🎀</i><b>${pageCount}p</b></span>
          <span class="scrapbook-card-copy"><strong>${escapeHtml(book.title || "Untitled scrapbook")}</strong><small>${escapeHtml(date || "No date")} · ${pageCount} page${pageCount === 1 ? "" : "s"}${linkedEntry ? " · Linked memory" : ""}</small></span>
        </button>
        <button type="button" class="scrapbook-card-delete" data-delete-scrapbook-book="${escapeHtml(book.id)}" aria-label="Delete scrapbook">×</button>
      </article>`;
    }).join("");

    grid.querySelectorAll("[data-open-scrapbook-book]").forEach(button => {
      button.addEventListener("click", () => openScrapbookBook(button.dataset.openScrapbookBook));
    });
    grid.querySelectorAll("[data-delete-scrapbook-book]").forEach(button => {
      button.addEventListener("click", async () => {
        const id = button.dataset.deleteScrapbookBook;
        const book = books.find(item => item.id === id);
        const pages = book?.pages?.length || 0;
        if (!confirm(`Delete this scrapbook and its ${pages} page${pages === 1 ? "" : "s"}? Page-only photos will also be removed from this device.`)) return;
        try {
          await diaryRepository.deleteScrapbookBook(id);
          await renderScrapbookLibrary();
          toast("Scrapbook deleted.");
        } catch (error) {
          console.error("Could not delete scrapbook.", error);
          toast("Fuwa couldn't delete that scrapbook.");
        }
      });
    });
  } catch (error) {
    console.error("Could not load scrapbook library.", error);
    if ($("scrapbookPageCount")) $("scrapbookPageCount").textContent = "Scrapbook unavailable";
    $("scrapbookEmptyState")?.classList.add("hidden");
    grid.innerHTML = `<div class="scrapbook-load-error">Fuwa couldn't load your scrapbook. Your local data was not changed. Try reopening Scrapbook.</div>`;
  }
}

async function switchScrapbookPage(pageId) {
  if (!pageId || pageId === activeJournalCanvasId || scrapbookPageSwitching || !activeScrapbookBook) return;
  scrapbookPageSwitching = true;
  renderScrapbookPageNavigator();
  try {
    await saveJournalCanvas({ quiet: true });
    const page = await diaryRepository.get("journalCanvases", pageId);
    if (!page) throw new Error("scrapbook-page-missing");
    cleanupJournalCanvasUrls();
    await activateScrapbookPage(page, { navigateView: false });
  } catch (error) {
    console.error("Could not switch scrapbook pages.", error);
    toast("Fuwa couldn't switch pages, so your current page stayed open.");
  } finally {
    scrapbookPageSwitching = false;
    renderScrapbookPageNavigator();
  }
}

async function addScrapbookPage() {
  if (!activeScrapbookBook || scrapbookPageSwitching) return;
  if (activeScrapbookBook.pages.length >= MAX_SCRAPBOOK_PAGES) {
    toast(`Keep up to ${MAX_SCRAPBOOK_PAGES} pages in one scrapbook.`);
    return;
  }

  scrapbookPageSwitching = true;
  try {
    await saveJournalCanvas({ quiet: true });
    const order = activeScrapbookBook.pages.length;
    const page = defaultJournalCanvas({
      bookId: activeScrapbookBook.id,
      title: `Page ${order + 1}`,
      date: isoToday()
    });
    const nextBook = structuredClone(activeScrapbookBook);
    nextBook.pages.push(scrapbookPageMeta(page, order));
    nextBook.updatedAt = Date.now();
    await diaryRepository.saveScrapbookPageAndBook(page, nextBook);
    activeScrapbookBook = normalizeScrapbookBook(nextBook);
    cleanupJournalCanvasUrls();
    await activateScrapbookPage(page, { navigateView: false });
    toast(`Page ${order + 1} added 🎀`);
  } catch (error) {
    console.error("Could not add scrapbook page.", error);
    toast("Fuwa couldn't add that page.");
  } finally {
    scrapbookPageSwitching = false;
    renderScrapbookPageNavigator();
  }
}

async function duplicateScrapbookPage() {
  if (!activeScrapbookBook || !journalCanvasState || scrapbookPageSwitching) return;
  if (activeScrapbookBook.pages.length >= MAX_SCRAPBOOK_PAGES) {
    toast(`Keep up to ${MAX_SCRAPBOOK_PAGES} pages in one scrapbook.`);
    return;
  }

  scrapbookPageSwitching = true;
  try {
    await saveJournalCanvas({ quiet: true });
    const source = structuredClone(journalCanvasState);
    const newPageId = uid("scrapbook");
    const localPhotos = await diaryRepository.getScrapbookPhotos(source.id);
    const photoIdMap = new Map();
    const copiedPhotos = localPhotos.map(record => {
      const id = uid("scrapphoto");
      photoIdMap.set(record.id, id);
      return { ...record, id, scrapbookId: newPageId, createdAt: Date.now() };
    });

    const order = activeScrapbookBook.pages.length;
    const duplicate = {
      ...source,
      id: newPageId,
      bookId: activeScrapbookBook.id,
      title: `${source.title || `Page ${order}`} copy`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      items: (source.items || []).map(item => ({
        ...item,
        id: uid("canvas"),
        mediaId: item.type === "photo" && item.mediaSource === "scrapbook" && photoIdMap.has(item.mediaId)
          ? photoIdMap.get(item.mediaId)
          : item.mediaId
      }))
    };
    delete duplicate.entryId;

    const nextBook = structuredClone(activeScrapbookBook);
    nextBook.pages.push(scrapbookPageMeta(duplicate, order));
    nextBook.updatedAt = Date.now();
    await diaryRepository.saveScrapbookPageAndBook(duplicate, nextBook, copiedPhotos);
    activeScrapbookBook = normalizeScrapbookBook(nextBook);
    cleanupJournalCanvasUrls();
    await activateScrapbookPage(duplicate, { navigateView: false });
    toast("Page duplicated 🎀");
  } catch (error) {
    console.error("Could not duplicate scrapbook page.", error);
    toast("Fuwa couldn't duplicate that page.");
  } finally {
    scrapbookPageSwitching = false;
    renderScrapbookPageNavigator();
  }
}

async function moveCurrentScrapbookPage(direction) {
  if (!activeScrapbookBook || scrapbookPageSwitching) return;
  const index = currentScrapbookPageIndex();
  const target = index + direction;
  if (index < 0 || target < 0 || target >= activeScrapbookBook.pages.length) return;

  try {
    await saveJournalCanvas({ quiet: true });
    const pages = activeScrapbookBook.pages.slice();
    [pages[index], pages[target]] = [pages[target], pages[index]];
    const nextBook = {
      ...structuredClone(activeScrapbookBook),
      pages: pages.map((page, order) => ({ ...page, order })),
      updatedAt: Date.now()
    };
    await diaryRepository.save("scrapbookBooks", structuredClone(nextBook));
    activeScrapbookBook = normalizeScrapbookBook(nextBook);
    renderScrapbookPageNavigator();
    toast("Page order updated.");
  } catch (error) {
    console.error("Could not reorder scrapbook pages.", error);
    toast("Fuwa couldn't reorder those pages.");
  }
}

async function deleteCurrentScrapbookPage() {
  if (!activeScrapbookBook || !journalCanvasState || scrapbookPageSwitching) return;
  clearTimeout(journalCanvasSaveTimer);
  journalCanvasSaveTimer = null;
  if (activeScrapbookBook.pages.length <= 1) {
    toast("A scrapbook needs at least one page. Delete the scrapbook from the library instead.");
    return;
  }
  if (!confirm("Delete this scrapbook page? Its page-only photos will also be removed from this device.")) return;

  scrapbookPageSwitching = true;
  try {
    const index = currentScrapbookPageIndex();
    const remaining = activeScrapbookBook.pages.filter(page => page.id !== activeJournalCanvasId);
    const nextMeta = remaining[Math.min(index, remaining.length - 1)];
    const nextBook = {
      ...structuredClone(activeScrapbookBook),
      pages: remaining.map((page, order) => ({ ...page, order })),
      updatedAt: Date.now()
    };
    await diaryRepository.deleteScrapbookPageAndUpdateBook(activeJournalCanvasId, nextBook);
    activeScrapbookBook = normalizeScrapbookBook(nextBook);
    const nextPage = await diaryRepository.get("journalCanvases", nextMeta.id);
    if (!nextPage) throw new Error("next-scrapbook-page-missing");
    cleanupJournalCanvasUrls();
    await activateScrapbookPage(nextPage, { navigateView: false });
    toast("Page deleted.");
  } catch (error) {
    console.error("Could not delete scrapbook page.", error);
    toast("Fuwa couldn't delete that page.");
  } finally {
    scrapbookPageSwitching = false;
    renderScrapbookPageNavigator();
  }
}

async function goToAdjacentScrapbookPage(direction) {
  if (!activeScrapbookBook) return;
  const index = currentScrapbookPageIndex();
  const target = activeScrapbookBook.pages[index + direction];
  if (target) await switchScrapbookPage(target.id);
}

async function closeJournalCanvas() {
  closeStickerImportSheet();
  clearTimeout(journalCanvasSaveTimer);
  journalCanvasSaveTimer = null;
  try {
    await saveJournalCanvas({ quiet: true });
  } catch (error) {
    console.error("Could not save scrapbook page before closing.", error);
    toast("Fuwa couldn't save this page yet, so it stayed open. Please try Save again.");
    return;
  }
  cleanupJournalCanvasUrls();
  selectedJournalCanvasItemId = null;
  journalCanvasState = null;
  const entryId = activeJournalCanvasEntryId;
  const returnView = journalCanvasReturnView;
  activeJournalCanvasId = null;
  activeJournalCanvasEntryId = null;
  activeScrapbookBookId = null;
  activeScrapbookBook = null;
  journalCanvasReturnView = "scrapbook";
  if (returnView === "editor" && entryId) openEditor(entryId);
  else navigate("scrapbook");
}

async function saveJournalCanvas(options = {}) {
  if (!journalCanvasState || !activeJournalCanvasId || !activeScrapbookBook) return;
  const quiet = options?.quiet === true;
  clearTimeout(journalCanvasSaveTimer);
  journalCanvasSaveTimer = null;
  try {
    const pageTitle = $("journalCanvasTitleInput")?.value.trim() || journalCanvasState.title || "Untitled page";
    const bookTitle = $("journalBookTitleInput")?.value.trim() || activeScrapbookBook.title || "Untitled scrapbook";
    journalCanvasState.title = pageTitle;
    journalCanvasState.bookId = activeScrapbookBook.id;
    journalCanvasState.updatedAt = Date.now();
    activeScrapbookBook.title = bookTitle;
    activeScrapbookBook.updatedAt = journalCanvasState.updatedAt;
    updateActiveBookPageMeta(journalCanvasState);
    await diaryRepository.saveScrapbookPageAndBook(structuredClone(journalCanvasState), structuredClone(activeScrapbookBook));
    renderScrapbookPageNavigator();
    if (!quiet) toast("Scrapbook saved locally 🎀");
  } catch (error) {
    console.error("Could not save scrapbook.", error);
    if (!quiet) toast("Fuwa couldn't save this scrapbook.");
    throw error;
  }
}

function updateSelectedJournalItem(patch) {
  const item = journalCanvasState?.items.find(x => x.id === selectedJournalCanvasItemId);
  if (!item) return;
  Object.assign(item, patch);
  updateJournalCanvasItemElement(item);
  queueJournalCanvasSave();
}

function setSelectedJournalPhotoStyle(style) {
  if (!JOURNAL_PHOTO_STYLES.includes(style)) return;
  const item = journalCanvasState?.items.find(x => x.id === selectedJournalCanvasItemId);
  if (!item || item.type !== "photo") return;

  item.photoStyle = style;
  const element = [...document.querySelectorAll("[data-canvas-item]")].find(node => node.dataset.canvasItem === item.id);
  if (element) {
    JOURNAL_PHOTO_STYLES.forEach(name => element.classList.remove(`photo-style-${name}`));
    element.classList.add(`photo-style-${style}`);
  }

  document.querySelectorAll("[data-journal-photo-style]").forEach(button => {
    const active = button.dataset.journalPhotoStyle === style;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  queueJournalCanvasSave();
}

function syncJournalTextControls(item) {
  const style = journalTextStyle(item);
  const groups = [
    ["[data-journal-text-font]", "journalTextFont", style.font],
    ["[data-journal-text-size]", "journalTextSize", style.size],
    ["[data-journal-text-align]", "journalTextAlign", style.align],
    ["[data-journal-text-color]", "journalTextColor", style.color],
    ["[data-journal-text-background]", "journalTextBackground", style.background]
  ];
  groups.forEach(([selector, datasetKey, value]) => {
    document.querySelectorAll(selector).forEach(button => {
      const active = button.dataset[datasetKey] === value;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  });
  const boldButton = $("journalTextBold");
  const italicButton = $("journalTextItalic");
  if (boldButton) {
    boldButton.classList.toggle("active", style.bold);
    boldButton.setAttribute("aria-pressed", style.bold ? "true" : "false");
  }
  if (italicButton) {
    italicButton.classList.toggle("active", style.italic);
    italicButton.setAttribute("aria-pressed", style.italic ? "true" : "false");
  }
}

function refreshSelectedJournalTextElement(item) {
  if (!item || item.type !== "text") return;
  const element = [...document.querySelectorAll("[data-canvas-item]")].find(node => node.dataset.canvasItem === item.id);
  if (!element) return;
  const wasSelected = element.classList.contains("selected");
  element.className = `journal-canvas-item text-item ${journalTextClassNames(item)}${wasSelected ? " selected" : ""}`;
  element.textContent = item.text || "Little note";
}

function setSelectedJournalTextStyle(property, value) {
  const item = journalCanvasState?.items.find(x => x.id === selectedJournalCanvasItemId);
  if (!item || item.type !== "text") return;

  const allowed = {
    textFont: JOURNAL_TEXT_FONTS,
    textSize: JOURNAL_TEXT_SIZES,
    textAlign: JOURNAL_TEXT_ALIGNS,
    textColor: JOURNAL_TEXT_COLORS,
    textBackground: JOURNAL_TEXT_BACKGROUNDS
  };
  if (!allowed[property]?.includes(value)) return;

  item[property] = value;
  refreshSelectedJournalTextElement(item);
  syncJournalTextControls(item);
  queueJournalCanvasSave();
}

function toggleSelectedJournalTextStyle(property) {
  const item = journalCanvasState?.items.find(x => x.id === selectedJournalCanvasItemId);
  if (!item || item.type !== "text" || !["textBold", "textItalic"].includes(property)) return;
  item[property] = item[property] !== true;
  refreshSelectedJournalTextElement(item);
  syncJournalTextControls(item);
  queueJournalCanvasSave();
}

function editSelectedJournalText() {
  const item = journalCanvasState?.items.find(x => x.id === selectedJournalCanvasItemId);
  if (!item || item.type !== "text") return;
  const text = window.prompt("Edit this little text:", item.text || "Little note");
  if (text == null || !text.trim()) return;
  item.text = text.trim();
  refreshSelectedJournalTextElement(item);
  queueJournalCanvasSave();
}

function removeSelectedJournalItem() {
  if (!journalCanvasState || !selectedJournalCanvasItemId) return;
  journalCanvasState.items = journalCanvasState.items.filter(x => x.id !== selectedJournalCanvasItemId);
  selectedJournalCanvasItemId = null;
  renderJournalCanvas();
  queueJournalCanvasSave();
}

function duplicateSelectedJournalItem() {
  const item = journalCanvasState?.items.find(x => x.id === selectedJournalCanvasItemId);
  if (!item) return;
  addJournalCanvasItem({ ...structuredClone(item), id: undefined, x: Math.min(.92, (item.x || .5) + .06), y: Math.min(.92, (item.y || .5) + .06) });
}

function moveSelectedJournalItemLayer(direction) {
  const item = journalCanvasState?.items.find(x => x.id === selectedJournalCanvasItemId);
  if (!item) return;
  const zValues = journalCanvasState.items.map(x => Number(x.z || 1));
  item.z = direction > 0 ? Math.max(...zValues, 1) + 1 : Math.min(...zValues, 1) - 1;
  renderJournalCanvas();
  queueJournalCanvasSave();
}

function addJournalText() {
  const text = window.prompt("Add a little text to the page:", "Little note");
  if (text == null || !text.trim()) return;
  addJournalCanvasItem({
    type: "text",
    text: text.trim(),
    scale: .9,
    textFont: "journal",
    textSize: "medium",
    textAlign: "center",
    textColor: "ink",
    textBackground: "paper",
    textBold: false,
    textItalic: false
  });
}

function setJournalPaper(name) {
  if (!journalCanvasState || !scrapbookPaperById(name)) return;
  journalCanvasState.background = name;
  applyJournalPaperToElement($("journalCanvasPaper"), name);
  document.querySelectorAll("[data-journal-paper]").forEach(button => {
    button.classList.toggle("active", button.dataset.journalPaper === name);
  });
  if (activeScrapbookBook?.pages) {
    const pageMeta = activeScrapbookBook.pages.find(page => page.id === activeJournalCanvasId);
    if (pageMeta) pageMeta.background = name;
  }
  renderScrapbookPageNavigator();
  queueJournalCanvasSave();
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
    date: isoToday(),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  try {
    await diaryRepository.save("tinyJoys", joy);
    state.tinyJoys.push(joy);
    input.value = "";
    saveState();
    renderTinyJoys();
    if (currentView === "thoughts") renderTinyJoyHistory();
    toast("Tiny joy saved ✨");
  } catch (error) {
    console.error("Could not save Tiny Joy.", error);
    toast("Fuwa couldn't save that joy. Please try again.");
  }
}

function toggleLetterComposer(show) {
  $("letterComposer").classList.toggle("hidden", !show);
  if (!show) {
    editingLetterId = null;
    return;
  }

  if (!editingLetterId) {
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

  const existing = editingLetterId ? state.letters.find(item => item.id === editingLetterId) : null;
  const letter = {
    id: existing?.id || uid("letter"),
    title,
    body,
    openDate,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now()
  };

  try {
    await diaryRepository.save("letters", letter);
    if (existing) state.letters = state.letters.map(item => item.id === letter.id ? letter : item);
    else state.letters.push(letter);
    saveState();
    editingLetterId = null;
    toggleLetterComposer(false);
    toast(existing ? "Letter updated ✉️" : "Letter sealed ✉️");
  } catch (error) {
    console.error("Could not save letter.", error);
    toast("Fuwa couldn't seal that letter. Please try again.");
  }
}


function cloudBackupRecordCount(data) {
  return [
    "entries",
    "tinyJoys",
    "letters",
    "moodCheckins",
    "threads",
    "bookmarks",
    "nightlyReflections",
    "thenNow",
    "comfortItems",
    "unsentLetters",
    "thoughtBubbles",
    "dreams",
    "dailyCheckins",
    "lifeCollections",
    "habitDefinitions",
    "moments",
    "randomThoughts"
  ].reduce((total, storeName) => total + (Array.isArray(data?.[storeName]) ? data[storeName].length : 0), 0);
}

async function createCloudBackupPayload() {
  const currentData = await diaryRepository.readCurrentData();

  // Validate the same core stores Fuwa already trusts for local backup/import.
  validateContentData(currentData);
  validateMoodCheckins(currentData.moodCheckins);
  validateThreads(currentData.threads);
  validateBookmarks(currentData.bookmarks);
  validateNightlyReflections(currentData.nightlyReflections);
  validateSimpleStore(currentData.thenNow, "thenNow");
  validateSimpleStore(currentData.comfortItems, "comfortItems");
  validateSimpleStore(currentData.unsentLetters, "unsentLetters");
  validateSimpleStore(currentData.thoughtBubbles, "thoughtBubbles");
  validateSimpleStore(currentData.dreams, "dreams");
  validateSimpleStore(currentData.dailyCheckins, "dailyCheckins");
  validateSimpleStore(currentData.lifeCollections, "lifeCollections");
  validateSimpleStore(currentData.habitDefinitions, "habitDefinitions");
  validateSimpleStore(currentData.moments, "moments");
  validateSimpleStore(currentData.randomThoughts, "randomThoughts");

  const data = {
    ...currentData,
    selectedMood: state.selectedMood,
    theme: state.theme,
    wallpaperEnabled: state.wallpaperEnabled,
    wallpaperOverlay: state.wallpaperOverlay,
    sleepSound: state.sleepSound,
    sleepMinutes: state.sleepMinutes,
    sleepVolume: state.sleepVolume,
    privacyLockEnabled: state.privacyLockEnabled,
    privacyAutoLockMinutes: state.privacyAutoLockMinutes,
    privacyLockOnReopen: state.privacyLockOnReopen,
    biometricEnabled: false
  };

  return {
    app: "Fuwa",
    backupFormat: "fuwa-cloud-v1",
    schemaVersion: DATABASE_VERSION,
    backupId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    mediaIncluded: false,
    recordCount: cloudBackupRecordCount(data),
    data
  };
}

window.fuwaGetLocalCloudSummary = async function () {
  const currentData = await diaryRepository.readCurrentData();
  const recordCount = cloudBackupRecordCount(currentData);

  const latestModifiedAt = Object.values(currentData)
    .filter(Array.isArray)
    .flat()
    .reduce((latest, record) => {
      if (!record || typeof record !== "object") return latest;
      const candidates = [
        Number(record.updatedAt),
        Number(record.createdAt)
      ].filter(Number.isFinite);
      return Math.max(latest, ...candidates, 0);
    }, 0);

  return {
    recordCount,
    hasJournalData: recordCount > 0,
    latestModifiedAt
  };
};

window.fuwaCreateCloudBackupPayload = createCloudBackupPayload;


async function createFullLocalBackupPayload() {
  const currentData = await diaryRepository.readCurrentData();
  const [mediaRecords, journalCanvases, stickerRecords, scrapbookPhotoRecords, scrapbookBooks] = await Promise.all([
    diaryRepository.readAllMedia(),
    diaryRepository.getAll("journalCanvases"),
    diaryRepository.getAll("stickerAssets"),
    diaryRepository.getAll("scrapbookPhotos"),
    diaryRepository.getAll("scrapbookBooks")
  ]);
  const media = [];
  const stickerAssets = [];
  const scrapbookPhotos = [];

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

  for (const record of stickerRecords) {
    if (!record?.blob) continue;
    stickerAssets.push({
      id: record.id,
      name: record.name || "My sticker",
      type: record.type || record.blob.type || "image/png",
      backgroundRemoved: record.backgroundRemoved === true,
      createdAt: record.createdAt || Date.now(),
      updatedAt: record.updatedAt || record.createdAt || Date.now(),
      dataUrl: await blobToDataUrl(record.blob)
    });
  }

  for (const record of scrapbookPhotoRecords) {
    if (!record?.blob) continue;
    scrapbookPhotos.push({
      id: record.id,
      scrapbookId: record.scrapbookId,
      type: record.type || record.blob.type || "image/jpeg",
      width: record.width || null,
      height: record.height || null,
      originalName: record.originalName || "Scrapbook photo",
      createdAt: record.createdAt || Date.now(),
      dataUrl: await blobToDataUrl(record.blob)
    });
  }

  return {
    app: "Fuwa",
    version: DATABASE_VERSION,
    exportedAt: new Date().toISOString(),
    localScrapbookIncluded: true,
    data: {
      ...currentData,
      media,
      journalCanvases,
      stickerAssets,
      scrapbookPhotos,
      scrapbookBooks,
      selectedMood: state.selectedMood,
      profileName: state.profileName,
      theme: state.theme,
      wallpaperEnabled: state.wallpaperEnabled,
      wallpaperOverlay: state.wallpaperOverlay,
      sleepSound: state.sleepSound,
      sleepMinutes: state.sleepMinutes,
      sleepVolume: state.sleepVolume,
      privacyLockEnabled: state.privacyLockEnabled,
      privacyAutoLockMinutes: state.privacyAutoLockMinutes,
      privacyLockOnReopen: state.privacyLockOnReopen,
      biometricEnabled: false
    }
  };
}


function downloadBackupPayload(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function createRestoreSafetyBackup() {
  // Keep the safety snapshot in memory while restore runs. On iOS, triggering
  // the file download before the IndexedDB write can navigate away from Fuwa.
  return createFullLocalBackupPayload();
}

async function restoreSafetyBackup(payload) {
  if (!payload || payload.app !== "Fuwa" || !payload.data) {
    throw new Error("invalid-restore-safety-backup");
  }

  const incoming = normalizeCloudValue(payload.data);
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
  incoming.dailyCheckins = validateSimpleStore(incoming.dailyCheckins, "dailyCheckins");
  incoming.lifeCollections = validateSimpleStore(incoming.lifeCollections, "lifeCollections");
  incoming.habitDefinitions = validateSimpleStore(incoming.habitDefinitions, "habitDefinitions");
  incoming.moments = validateSimpleStore(incoming.moments, "moments");
  incoming.randomThoughts = validateSimpleStore(incoming.randomThoughts, "randomThoughts");

  const existingMedia = await diaryRepository.readAllMedia();
  await diaryRepository.replaceContent(incoming, existingMedia);

  const verification = await verifyRestoredContent(incoming);
  const expectedCount = restoredRecordCount(incoming);
  if (verification.recordCount !== expectedCount) {
    throw new Error(`safety-rollback-verification-failed:${verification.recordCount}/${expectedCount}`);
  }

  try {
    await loadState();
    renderAll();
  } catch (renderError) {
    console.error("Fuwa restored the safety snapshot but could not refresh the interface immediately.", renderError);
  }

  return { ok: true, recordCount: verification.recordCount };
}

function downloadRestoreSafetyBackup(payload) {
  if (!payload) return;
  downloadBackupPayload(payload, `fuwa-before-cloud-restore-${isoToday()}.json`);
}

function normalizeCloudValue(value) {
  if (value == null) return value;

  // Firestore Timestamp instances are SDK objects. Convert them to ISO strings
  // before IndexedDB writes so restore stays portable on iOS/WebKit.
  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date?.getTime?.()) ? null : date.toISOString();
  }

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) return value.map(normalizeCloudValue);

  if (typeof value === "object") {
    const plain = {};
    for (const [key, child] of Object.entries(value)) {
      plain[key] = normalizeCloudValue(child);
    }
    return plain;
  }

  return value;
}

function restoredRecordCount(data) {
  return cloudBackupRecordCount(data);
}

async function verifyRestoredContent(expected) {
  const actual = await diaryRepository.readCurrentData();
  const storeNames = [
    "entries",
    "tinyJoys",
    "letters",
    "moodCheckins",
    "threads",
    "bookmarks",
    "nightlyReflections",
    "thenNow",
    "comfortItems",
    "unsentLetters",
    "thoughtBubbles",
    "dreams",
    "dailyCheckins",
    "lifeCollections",
    "habitDefinitions",
    "moments",
    "randomThoughts"
  ];

  for (const storeName of storeNames) {
    const expectedRecords = Array.isArray(expected?.[storeName]) ? expected[storeName] : [];
    const actualRecords = Array.isArray(actual?.[storeName]) ? actual[storeName] : [];

    if (actualRecords.length !== expectedRecords.length) {
      throw new Error(`restore-verification-failed:${storeName}:count`);
    }

    const expectedIds = expectedRecords.map(record => record.id).sort();
    const actualIds = actualRecords.map(record => record.id).sort();
    if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) {
      throw new Error(`restore-verification-failed:${storeName}:ids`);
    }
  }

  return {
    recordCount: restoredRecordCount(actual),
    data: actual
  };
}

async function applyCloudRestorePayload(payload) {
  if (!payload || payload.app !== "Fuwa" || payload.backupFormat !== "fuwa-cloud-v1" || !payload.data) {
    throw new Error("invalid-cloud-backup");
  }

  // Do NOT structuredClone Firestore SDK objects directly into IndexedDB.
  // Normalize the snapshot first to plain values.
  const incoming = normalizeCloudValue(payload.data);

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
  incoming.dailyCheckins = validateSimpleStore(incoming.dailyCheckins, "dailyCheckins");
  incoming.lifeCollections = validateSimpleStore(incoming.lifeCollections, "lifeCollections");
  incoming.habitDefinitions = validateSimpleStore(incoming.habitDefinitions, "habitDefinitions");
  incoming.moments = validateSimpleStore(incoming.moments, "moments");
  incoming.randomThoughts = validateSimpleStore(incoming.randomThoughts, "randomThoughts");

  const incomingRecordCount = cloudBackupRecordCount(incoming);
  const declaredRecordCount = Number(payload.recordCount);
  if (Number.isFinite(declaredRecordCount) && declaredRecordCount !== incomingRecordCount) {
    throw new Error(`invalid-cloud-backup:record-count:${incomingRecordCount}/${declaredRecordCount}`);
  }

  const existingMedia = await diaryRepository.readAllMedia();

  await diaryRepository.replaceContent(incoming, existingMedia);

  // A restore is only successful after IndexedDB can read the exact stores/IDs back.
  const verification = await verifyRestoredContent(incoming);
  const expectedCount = Number(payload.recordCount || restoredRecordCount(incoming));
  if (verification.recordCount !== expectedCount) {
    throw new Error(`restore-verification-failed:record-count:${verification.recordCount}/${expectedCount}`);
  }

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
    dailyCheckins: Array.isArray(incoming.dailyCheckins) ? incoming.dailyCheckins : [],
    lifeCollections: Array.isArray(incoming.lifeCollections) ? incoming.lifeCollections : [],
    habitDefinitions: Array.isArray(incoming.habitDefinitions) ? incoming.habitDefinitions : [],
    moments: Array.isArray(incoming.moments) ? incoming.moments : [],
    randomThoughts: Array.isArray(incoming.randomThoughts) ? incoming.randomThoughts : [],
    selectedMood: incoming.selectedMood || defaultState.selectedMood,
    profileName: typeof incoming.profileName === "string" && incoming.profileName.trim() ? normalizedProfileName(incoming.profileName) : normalizedProfileName(state.profileName),
    theme: incoming.theme || defaultState.theme,
    wallpaperEnabled: typeof incoming.wallpaperEnabled === "boolean" ? incoming.wallpaperEnabled : defaultState.wallpaperEnabled,
    wallpaperOverlay: ["light", "medium", "strong"].includes(incoming.wallpaperOverlay) ? incoming.wallpaperOverlay : defaultState.wallpaperOverlay,
    sleepSound: incoming.sleepSound || defaultState.sleepSound,
    sleepMinutes: Number(incoming.sleepMinutes) || defaultState.sleepMinutes,
    sleepVolume: Number.isFinite(Number(incoming.sleepVolume)) ? Number(incoming.sleepVolume) : defaultState.sleepVolume,
    privacyLockEnabled: Boolean(incoming.privacyLockEnabled),
    privacyAutoLockMinutes: Number(incoming.privacyAutoLockMinutes) || defaultState.privacyAutoLockMinutes,
    privacyLockOnReopen: Boolean(incoming.privacyLockOnReopen),
    biometricEnabled: false
  };

  savePreferences();
  await loadState();
  renderAll();

  return {
    ok: true,
    recordCount: verification.recordCount
  };
}

window.fuwaCreateRestoreSafetyBackup = createRestoreSafetyBackup;
window.fuwaRestoreSafetyBackup = restoreSafetyBackup;
window.fuwaDownloadRestoreSafetyBackup = downloadRestoreSafetyBackup;
window.fuwaApplyCloudRestorePayload = applyCloudRestorePayload;

async function exportBackup() {
  try {
    const payload = await createFullLocalBackupPayload();
    downloadBackupPayload(payload, `fuwa-backup-${isoToday()}.json`);
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
      incoming.dailyCheckins = validateSimpleStore(incoming.dailyCheckins, "dailyCheckins");
      incoming.lifeCollections = validateSimpleStore(incoming.lifeCollections, "lifeCollections");
      incoming.habitDefinitions = validateSimpleStore(incoming.habitDefinitions, "habitDefinitions");
      incoming.moments = validateSimpleStore(incoming.moments, "moments");
      incoming.randomThoughts = validateSimpleStore(incoming.randomThoughts, "randomThoughts");
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

      const canvasBackup = validateScrapbookBackupArray(incoming.journalCanvases, "journalCanvases");
      const stickerBackup = validateScrapbookBackupArray(incoming.stickerAssets, "stickerAssets", { withDataUrl: true });
      const scrapbookPhotoBackup = validateScrapbookBackupArray(incoming.scrapbookPhotos, "scrapbookPhotos", { withDataUrl: true });
      const scrapbookBookBackup = validateScrapbookBackupArray(incoming.scrapbookBooks, "scrapbookBooks");
      const hasScrapbookBackup = canvasBackup !== null || stickerBackup !== null || scrapbookPhotoBackup !== null || scrapbookBookBackup !== null;
      const localScrapbookData = hasScrapbookBackup ? {
        journalCanvases: canvasBackup || [],
        scrapbookBooks: scrapbookBookBackup || [],
        stickerAssets: (stickerBackup || []).map(record => ({
          id: record.id,
          name: record.name || "My sticker",
          blob: dataUrlToBlob(record.dataUrl),
          type: record.type || "image/png",
          backgroundRemoved: record.backgroundRemoved === true,
          createdAt: record.createdAt || Date.now(),
          updatedAt: record.updatedAt || record.createdAt || Date.now()
        })),
        scrapbookPhotos: (scrapbookPhotoBackup || []).map(record => ({
          id: record.id,
          scrapbookId: record.scrapbookId,
          blob: dataUrlToBlob(record.dataUrl),
          type: record.type || "image/jpeg",
          width: record.width || null,
          height: record.height || null,
          originalName: record.originalName || "Scrapbook photo",
          createdAt: record.createdAt || Date.now()
        }))
      } : null;

      await diaryRepository.replaceContent(incoming, mediaRecords, localScrapbookData);
      if (localScrapbookData) await diaryRepository.removeSetting(SCRAPBOOK_BOOK_MIGRATION_KEY);
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
        dailyCheckins: Array.isArray(incoming.dailyCheckins) ? incoming.dailyCheckins : [],
        lifeCollections: Array.isArray(incoming.lifeCollections) ? incoming.lifeCollections : [],
        habitDefinitions: Array.isArray(incoming.habitDefinitions) ? incoming.habitDefinitions : [],
        moments: Array.isArray(incoming.moments) ? incoming.moments : [],
        randomThoughts: Array.isArray(incoming.randomThoughts) ? incoming.randomThoughts : [],
        selectedMood: typeof incoming.selectedMood === "string" ? incoming.selectedMood : state.selectedMood,
        profileName: typeof incoming.profileName === "string" && incoming.profileName.trim() ? normalizedProfileName(incoming.profileName) : normalizedProfileName(state.profileName),
        theme: typeof incoming.theme === "string" ? incoming.theme : state.theme,
        wallpaperEnabled: typeof incoming.wallpaperEnabled === "boolean" ? incoming.wallpaperEnabled : state.wallpaperEnabled,
        wallpaperOverlay: ["light", "medium", "strong"].includes(incoming.wallpaperOverlay) ? incoming.wallpaperOverlay : state.wallpaperOverlay,
        sleepSound: typeof incoming.sleepSound === "string" ? incoming.sleepSound : state.sleepSound,
        sleepMinutes: Number.isFinite(incoming.sleepMinutes) ? incoming.sleepMinutes : state.sleepMinutes,
        sleepVolume: Number.isFinite(incoming.sleepVolume) ? incoming.sleepVolume : state.sleepVolume,
        privacyLockEnabled: typeof incoming.privacyLockEnabled === "boolean" ? incoming.privacyLockEnabled : state.privacyLockEnabled,
        privacyAutoLockMinutes: Number.isFinite(incoming.privacyAutoLockMinutes) ? incoming.privacyAutoLockMinutes : state.privacyAutoLockMinutes,
        privacyLockOnReopen: typeof incoming.privacyLockOnReopen === "boolean" ? incoming.privacyLockOnReopen : state.privacyLockOnReopen,
        biometricEnabled: false
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
  if (!confirm("Clear all Fuwa journal and scrapbook content on this device, including photos and imported stickers?")) return;
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
  // Safari exposes gesture* events for pinch zoom. Keep only the gesture guards.
  // Do not prevent touchend globally: on iPhone/PWA that can suppress the
  // synthetic click and make ordinary buttons appear randomly unresponsive.
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
}



const FUWA_TUTORIAL_SEEN_KEY = "fuwaTutorialSeenV1";
let tutorialStepIndex = 0;
let tutorialOpenedAutomatically = false;


const FUWA_FEATURE_TUTORIAL_VERSION = "v1";
const FUWA_FEATURE_TUTORIAL_PREFIX = `fuwaFeatureTutorial:${FUWA_FEATURE_TUTORIAL_VERSION}:`;

const FUWA_FEATURE_TUTORIALS = {
  home: {
    icon: "☁️",
    eyebrow: "YOUR GARDEN GATE",
    title: "Home is your gentle daily starting point",
    copy: "Home keeps your daily essentials first. Your mood and Mood Jar stay visible, while the deeper pieces of your garden wait under one calm More section.",
    how: [
      "Tap a mood cloud when you want a quick emotional check-in.",
      "Open More from your garden for memories, calendar, Nightly Wind-Down, Tiny Joys, and Random Thoughts.",
      "Open ☰ for the deeper corners of Fuwa."
    ]
  },
  entries: {
    icon: "📖",
    eyebrow: "YOUR JOURNAL",
    title: "Entries hold the fuller stories",
    copy: "This is where your proper journal entries live. Old entries stay here, so Home never has to become crowded.",
    how: [
      "Tap an entry to open it.",
      "Use search to find an older memory.",
      "Tap + in the bottom navigation when you want to write something new."
    ]
  },
  editor: {
    icon: "✎",
    eyebrow: "WRITE FREELY",
    title: "This is your full journal page",
    copy: "Write as much or as little as you want. Fuwa keeps the entry in your local diary first.",
    how: [
      "Add a title only if you want one.",
      "Choose a mood, tags, and photos when they help.",
      "Tap Save when the memory feels finished."
    ]
  },
  letters: {
    icon: "💌",
    eyebrow: "WORDS FOR LATER",
    title: "Letters Through Time keeps messages for Future You",
    copy: "Write a letter now and choose when it should become available. It can be for yourself or simply a message you want to meet again later.",
    how: [
      "Create a letter and choose its open date.",
      "Locked letters stay tucked away until their time comes.",
      "Your existing letters remain listed here."
    ]
  },
  me: {
    icon: "♡",
    eyebrow: "YOUR FUWA",
    title: "Me is where Fuwa becomes yours",
    copy: "Your account, backup tools, privacy controls, reminders, stats, and device-specific settings live here.",
    how: [
      "Local users can keep journaling without an account.",
      "Use cloud backup only when you choose to sign in.",
      "Appearance and privacy settings stay device-focused."
    ]
  },
  life: {
    icon: "✦",
    eyebrow: "YOUR EVERYDAY NOTEBOOK",
    title: "Daily Life Pages is your page-by-page check-in",
    copy: "Fuwa has 30 Daily Life pages, but they are a library rather than a checklist. Use Gentle 8, Everyday 15, All 30, or choose your own set.",
    how: [
      "Use Customize to choose how many pages appear in your routine.",
      "Use Next, Back, or Skip—blank pages are completely okay.",
      "Trackers build only from the answers you actually save."
    ]
  },
  moodjar: {
    icon: "🫙",
    eyebrow: "YOUR LITTLE WEATHER",
    title: "Mood Jar keeps one tiny feeling from each day",
    copy: "Your daily moods collect here like little objects in a jar. The jar is meant to feel playful, not like a streak you have to maintain.",
    how: [
      "Choose a mood whenever you want to check in.",
      "Missing days are completely okay.",
      "Tilt or move your phone and the jar pieces can react naturally."
    ]
  },
  threads: {
    icon: "🧵",
    eyebrow: "STORIES THAT RETURN",
    title: "Memory Threads connects related moments across time",
    copy: "Use a thread when different journal entries belong to the same continuing story: a hobby, relationship, goal, trip, project, or season of life.",
    how: [
      "Create a thread and give it a name.",
      "Attach related memories to it over time.",
      "Open a thread to see that story as one timeline."
    ]
  },
  threadDetail: {
    icon: "🧵",
    eyebrow: "ONE STORY, MANY DAYS",
    title: "A Thread timeline gathers connected memories",
    copy: "This page shows the memories you have connected to one Memory Thread, even when they were written far apart.",
    how: [
      "Read the story in chronological context.",
      "Add more related entries as the story continues.",
      "The original journal entries stay unchanged."
    ]
  },
  bookmarks: {
    icon: "🔖",
    eyebrow: "FOR FUTURE YOU",
    title: "Bookmarks save a thought you want to meet again",
    copy: "A Fuwa Bookmark is lighter than a full journal entry. Keep a sentence, idea, reminder, or thought that deserves another visit later.",
    how: [
      "Save a short thought rather than writing a whole entry.",
      "Open an old bookmark when it resurfaces.",
      "Think of these as notes tucked between the pages of your garden."
    ]
  },
  bookmarkDetail: {
    icon: "🔖",
    eyebrow: "A NOTE RETURNED",
    title: "This is one saved Bookmark",
    copy: "Here you can meet the thought again with the context Fuwa kept for you.",
    how: [
      "Read what Past You wanted to preserve.",
      "Return to all Bookmarks when you're done.",
      "Keep or remove it whenever it no longer needs saving."
    ]
  },
  memoryDrift: {
    icon: "🍃",
    eyebrow: "SOMETHING DRIFTED BACK",
    title: "Memory Drift resurfaces an older piece of your life",
    copy: "Fuwa occasionally brings an older memory forward so you can notice what still feels the same — or what has quietly changed.",
    how: [
      "Read it without needing to respond.",
      "Use it as a reflection prompt if you feel like it.",
      "Your original memory is never rewritten."
    ]
  },
  thenNow: {
    icon: "🪞",
    eyebrow: "PAST YOU, PRESENT YOU",
    title: "Then & Now lets you answer an older version of yourself",
    copy: "Choose an older memory and reflect on what feels different today without editing what you originally wrote.",
    how: [
      "Pick a past memory.",
      "Write what Present You notices now.",
      "Fuwa keeps both points in time."
    ]
  },
  monthly: {
    icon: "📚",
    eyebrow: "YOUR MONTH, GATHERED",
    title: "Monthly Story turns scattered days into one chapter",
    copy: "Fuwa gathers the things you recorded during a month so you can look back without opening every single entry.",
    how: [
      "Use the arrows to move between months.",
      "The story becomes richer as you use Fuwa.",
      "It is a reflection, not a score."
    ]
  },
  weather: {
    icon: "🌦️",
    eyebrow: "NO SCORES, JUST PATTERNS",
    title: "Emotional Weather shows the shape of a month",
    copy: "This turns your mood history into a softer visual pattern. It is meant to help you notice, not judge, how your days felt.",
    how: [
      "Move between months with the arrows.",
      "Look for patterns rather than perfect streaks.",
      "Blank days simply mean nothing was logged."
    ]
  },
  bubbles: {
    icon: "💭",
    eyebrow: "ONE SENTENCE IS ENOUGH",
    title: "Thought Bubbles keeps a thought floating until you are done with it",
    copy: "Random Thoughts are passing notes. Use a Thought Bubble for an idea, question, worry, or daydream you want Fuwa to intentionally bring back later.",
    how: [
      "Write one short thought you may want to revisit.",
      "Use Float one back to me to meet an active Bubble again.",
      "Tap Release when the thought no longer needs to keep floating."
    ]
  },
  dreams: {
    icon: "🌙",
    eyebrow: "BEFORE IT FADES",
    title: "Dream Pocket keeps the pieces you remember",
    copy: "Dreams disappear quickly. Drop in whatever survived the morning, even if it is only one image, feeling, or bizarre detail.",
    how: [
      "Tap + to save a dream.",
      "It does not need to make sense.",
      "Come back later when you want to reread your dream history."
    ]
  },
  nightly: {
    icon: "☾",
    eyebrow: "PUT THE DAY DOWN",
    title: "Nightly Wind-Down is a soft end-of-day reflection",
    copy: "Use this corner when you want to close the day gently rather than write a full journal entry.",
    how: [
      "Answer only the prompts that help.",
      "Use it as a nightly ritual or only occasionally.",
      "Past reflections remain available in the history."
    ]
  },
  sleep: {
    icon: "😴",
    eyebrow: "A QUIETER CORNER",
    title: "Sleep Corner gives you soft sounds with a timer",
    copy: "Choose a sound, set how long you want it to play, then leave Fuwa beside you while you settle down.",
    how: [
      "Choose the sound that feels comfortable.",
      "Set a timer before you start.",
      "Fuwa fades the sound gently when the timer ends."
    ]
  },
  comfort: {
    icon: "🫶",
    eyebrow: "KEEP SOFT THINGS CLOSE",
    title: "Comfort Corner is your personal comfort shelf",
    copy: "Save words, reminders, places, people, memories, and even future things that give you something warm to look forward to.",
    how: [
      "Tap + and choose the kind of comfort you are saving.",
      "Use Looking Forward To for trips, plans, celebrations, and future joys.",
      "Use I need something soft when you want Fuwa to pick one."
    ]
  },
  sanctuary: {
    icon: "🏡",
    eyebrow: "YOUR LITTLE ROOM",
    title: "Fuwa Sanctuary grows quietly with your journal",
    copy: "This is not a game you have to grind. Your room becomes more lived-in as Fuwa fills with real days and memories.",
    how: [
      "Visit whenever you want a cozy visual break.",
      "New details can appear as your Fuwa history grows.",
      "There are no streaks, coins, or pressure."
    ]
  },
  unsent: {
    icon: "✉️",
    eyebrow: "WORDS THAT NEED NO DESTINATION",
    title: "Unsent Letters is for things you need to say, not send",
    copy: "Write to a person, place, version of yourself, or anyone else without needing the letter to go anywhere.",
    how: [
      "Tap + to write one.",
      "Nothing is actually sent.",
      "Keep it, reread it, or delete it when you're ready."
    ]
  },
  thoughts: {
    icon: "🌷",
    eyebrow: "YOUR LITTLE THINGS, KEPT",
    title: "Little Things is the history behind your Home cards",
    copy: "Today's Tiny Joys and Random Thoughts stay compact on Home. Previous days live here instead of disappearing.",
    how: [
      "Browse Little Things grouped by day.",
      "Tiny Joys stay positive; Random Thoughts can be anything.",
      "Older days remain part of your Fuwa history."
    ]
  },
  explore: {
    icon: "🗺️",
    eyebrow: "FIND YOUR WAY AROUND",
    title: "Explore Fuwa is a map of the deeper features",
    copy: "If you forget where something lives, this page groups Fuwa's reflection, memory, comfort, and letter tools in one place.",
    how: [
      "Tap any card to open that feature.",
      "You can also reach the same features from ☰.",
      "Home stays intentionally simpler."
    ]
  },
  appearance: {
    icon: "🎨",
    eyebrow: "MAKE THE GARDEN YOURS",
    title: "Appearance changes Fuwa only on this device",
    copy: "Pick a pastel theme, choose a wallpaper, and adjust how softly it shows through. These choices are intentionally device-specific.",
    how: [
      "Themes change Fuwa's overall color mood.",
      "Custom wallpaper stays local to this device.",
      "Overlay controls help keep text readable."
    ]
  }
};

let activeFeatureTutorialKey = null;
let pendingFeatureTutorialKey = null;
let featureTutorialTimer = null;

function featureTutorialStorageKey(key) {
  return `${FUWA_FEATURE_TUTORIAL_PREFIX}${key}`;
}

function featureTutorialWasSeen(key) {
  try { return localStorage.getItem(featureTutorialStorageKey(key)) === "1"; }
  catch (_) { return false; }
}

function markFeatureTutorialSeen(key) {
  if (!key) return;
  try { localStorage.setItem(featureTutorialStorageKey(key), "1"); } catch (_) {}
}

function featureTutorialCanOpen() {
  const featureGuide = $("featureTutorial");
  const mainGuide = $("fuwaTutorial");
  return !!featureGuide &&
         featureGuide.hidden === true &&
         !!mainGuide &&
         mainGuide.classList.contains("hidden") &&
         !$("privacyLockScreen")?.classList.contains("active");
}

function renderFeatureTutorial(key) {
  const guide = FUWA_FEATURE_TUTORIALS[key];
  if (!guide) return false;

  activeFeatureTutorialKey = key;
  if ($("featureTutorialIcon")) $("featureTutorialIcon").textContent = guide.icon;
  if ($("featureTutorialEyebrow")) $("featureTutorialEyebrow").textContent = guide.eyebrow;
  if ($("featureTutorialTitle")) $("featureTutorialTitle").textContent = guide.title;
  if ($("featureTutorialCopy")) $("featureTutorialCopy").textContent = guide.copy;

  const how = $("featureTutorialHow");
  if (how) {
    how.innerHTML = guide.how.map((item, index) =>
      `<div class="feature-tutorial-tip"><span>${index + 1}</span><p>${escapeHtml(item)}</p></div>`
    ).join("");
  }

  return true;
}

function openFeatureTutorial(key, { force = false } = {}) {
  if (!FUWA_FEATURE_TUTORIALS[key]) return;
  if (!force && featureTutorialWasSeen(key)) return;

  if (!featureTutorialCanOpen()) {
    pendingFeatureTutorialKey = key;
    return;
  }

  if (!renderFeatureTutorial(key)) return;
  pendingFeatureTutorialKey = null;
  const modal = $("featureTutorial");
  if (!modal) return;
  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeFeatureTutorial({ markSeen = true } = {}) {
  if (markSeen) markFeatureTutorialSeen(activeFeatureTutorialKey);
  const modal = $("featureTutorial");
  if (modal) {
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
  }
  activeFeatureTutorialKey = null;

  if (!privacyIsLocked && !$("fuwaDrawer")?.classList.contains("open") &&
      $("fuwaTutorial")?.classList.contains("hidden")) {
    document.body.style.overflow = "";
  }
}

function maybeShowFeatureTutorial(key) {
  if (featureTutorialTimer) {
    window.clearTimeout(featureTutorialTimer);
    featureTutorialTimer = null;
  }
  if (!key || featureTutorialWasSeen(key)) return;

  featureTutorialTimer = window.setTimeout(() => {
    featureTutorialTimer = null;
    // A delayed guide must never open over a view the user has already left.
    if (currentView !== key && key !== "appearance") return;
    openFeatureTutorial(key);
  }, 180);
}

function flushPendingFeatureTutorial() {
  if (!pendingFeatureTutorialKey) return;
  const key = pendingFeatureTutorialKey;
  pendingFeatureTutorialKey = null;
  maybeShowFeatureTutorial(key);
}

const FUWA_TUTORIAL_STEPS = [
  {
    icon: "🌷",
    eyebrow: "WELCOME TO YOUR GARDEN",
    title: "Welcome to Fuwa ☁️",
    copy: "Fuwa is your soft little place for memories, thoughts, moods, letters, and the everyday things you want to keep. There is no right way to use it — add as much or as little as you want.",
    chips: ["Private by default", "Works offline", "No streak pressure"]
  },
  {
    icon: "🏡",
    eyebrow: "START WITH TODAY",
    title: "Home is your daily landing place",
    copy: "Check in with your mood, add a Tiny Joy, or drop a Random Thought without writing a full journal entry. Home stays focused on today so it never becomes overwhelming.",
    chips: ["Mood check-in", "Tiny Joys 🌷", "Random Thoughts 💭"]
  },
  {
    icon: "📖",
    eyebrow: "KEEP THE STORY",
    title: "Entries hold the fuller memories",
    copy: "Use Entries when you want to write more. Add a title, your memory, mood, tags, and photos. Your past entries stay searchable, so yesterday never disappears.",
    chips: ["Journal entries", "Photos", "Search & tags"]
  },
  {
    icon: "✦",
    eyebrow: "LIFE, ALL IN ONE PLACE",
    title: "Daily Life Pages turn check-ins into patterns",
    copy: "Open Daily Life Pages from the hamburger menu to track things like mood, sleep, habits, reading, health, highlights, entertainment, and more. You finish the day's page in one flow.",
    chips: ["Trackers", "Daily check-in", "Moments & Wrapped"]
  },
  {
    icon: "💌",
    eyebrow: "WORDS FOR LATER",
    title: "Write letters and keep returning memories",
    copy: "Letters Through Time lets you write to your future self or someone else. Memory Threads, Bookmarks, Then & Now, Dream Pocket, and other tools help you keep the things that matter in different ways.",
    chips: ["Letters", "Memory Threads", "Bookmarks"]
  },
  {
    icon: "☾",
    eyebrow: "YOUR QUIETER CORNERS",
    title: "The hamburger holds the deeper features",
    copy: "Open ☰ whenever you want the rest of your garden: Nightly Wind-Down, Sleep Corner, Comfort Corner, Sanctuary, Dream Pocket, Emotional Weather, and more. Home stays clean while these remain close by.",
    chips: ["Sleep Corner", "Sanctuary", "Nightly Wind-Down"]
  },
  {
    icon: "🔒",
    eyebrow: "MAKE FUWA YOURS",
    title: "Private, customizable, and yours",
    copy: "Use Appearance for themes and wallpaper, Lock Fuwa when you want PIN protection, and Settings for reminders, account, and cloud backup. You can use Fuwa without logging in, and this tutorial is always available again from ☰ → How to Use Fuwa.",
    chips: ["Optional login", "App Lock", "Cloud backup"]
  }
];

function hasMeaningfulFuwaContent() {
  const keys = [
    "entries","tinyJoys","letters","moodCheckins","threads","bookmarks",
    "nightlyReflections","thenNow","comfortItems","unsentLetters","thoughtBubbles",
    "dreams","dailyCheckins","lifeCollections","moments","randomThoughts"
  ];
  return keys.some(key => Array.isArray(state?.[key]) && state[key].length > 0);
}

function markTutorialSeen() {
  try { localStorage.setItem(FUWA_TUTORIAL_SEEN_KEY, "1"); } catch (_) {}
}

function tutorialWasSeen() {
  try { return localStorage.getItem(FUWA_TUTORIAL_SEEN_KEY) === "1"; }
  catch (_) { return false; }
}

function renderTutorialStep() {
  const step = FUWA_TUTORIAL_STEPS[tutorialStepIndex];
  if (!step) return;

  $("tutorialVisual")?.setAttribute("data-icon", step.icon);
  if ($("tutorialEyebrow")) $("tutorialEyebrow").textContent = step.eyebrow;
  if ($("tutorialTitle")) $("tutorialTitle").textContent = step.title;
  if ($("tutorialCopy")) $("tutorialCopy").textContent = step.copy;
  if ($("tutorialStepCount")) $("tutorialStepCount").textContent = `${tutorialStepIndex + 1} of ${FUWA_TUTORIAL_STEPS.length}`;

  const chips = $("tutorialFeatureChips");
  if (chips) chips.innerHTML = step.chips.map(item => `<span>${escapeHtml(item)}</span>`).join("");

  const dots = $("tutorialDots");
  if (dots) {
    dots.innerHTML = FUWA_TUTORIAL_STEPS.map((_, index) =>
      `<button type="button" class="tutorial-dot ${index === tutorialStepIndex ? "active" : ""}" data-tutorial-dot="${index}" aria-label="Go to tutorial step ${index + 1}"></button>`
    ).join("");
    dots.querySelectorAll("[data-tutorial-dot]").forEach(button => {
      button.addEventListener("click", () => {
        tutorialStepIndex = Number(button.dataset.tutorialDot);
        renderTutorialStep();
      });
    });
  }

  $("tutorialBackButton")?.classList.toggle("hidden", tutorialStepIndex === 0);
  if ($("tutorialNextButton")) {
    $("tutorialNextButton").textContent =
      tutorialStepIndex === FUWA_TUTORIAL_STEPS.length - 1 ? "Enter Fuwa" : "Next";
  }
}

function openFuwaTutorial({ automatic = false } = {}) {
  tutorialOpenedAutomatically = automatic;
  tutorialStepIndex = 0;
  renderTutorialStep();
  $("fuwaTutorial")?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeFuwaTutorial({ markSeen = true } = {}) {
  $("fuwaTutorial")?.classList.add("hidden");
  if (markSeen) markTutorialSeen();
  tutorialOpenedAutomatically = false;
  if (!privacyIsLocked && !$("fuwaDrawer")?.classList.contains("open")) document.body.style.overflow = "";

  if (pendingFeatureTutorialKey) {
    window.setTimeout(flushPendingFeatureTutorial, 280);
  } else if (tutorialOpenedAutomatically === false) {
    window.setTimeout(() => maybeShowFeatureTutorial(currentView || "home"), 320);
  }
}

function goNextTutorialStep() {
  if (tutorialStepIndex >= FUWA_TUTORIAL_STEPS.length - 1) {
    closeFuwaTutorial({ markSeen: true });
    return;
  }
  tutorialStepIndex += 1;
  renderTutorialStep();
}

function goBackTutorialStep() {
  if (tutorialStepIndex <= 0) return;
  tutorialStepIndex -= 1;
  renderTutorialStep();
}

function maybeOpenFirstUseTutorial() {
  if (hasPendingFuwaReleaseNotes()) return;
  if (tutorialWasSeen()) return;

  // Existing journals upgrading to v55 should not suddenly get first-use onboarding.
  if (hasMeaningfulFuwaContent()) {
    markTutorialSeen();
    return;
  }

  const insideApp =
    document.body.classList.contains("auth-local") ||
    document.body.classList.contains("auth-signed-in") ||
    (!document.body.classList.contains("auth-pending") &&
     !document.body.classList.contains("auth-signed-out"));

  if (!insideApp) return;

  setTimeout(() => {
    if (!tutorialWasSeen() && !$("fuwaTutorial")?.classList.contains("hidden")) return;
    if (!tutorialWasSeen()) openFuwaTutorial({ automatic: true });
  }, 250);
}

function openSettingsSheet() {
  $("settingsSheet")?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeSettingsSheet() {
  $("settingsSheet")?.classList.add("hidden");
  document.body.style.overflow = "";
}

const FUWA_RELEASE_KEY = "fuwa-v1.1.10-2026-08-14";
const FUWA_PENDING_RELEASE_NOTES_KEY = "fuwaPendingReleaseNotes";
const FUWA_SEEN_RELEASE_NOTES_KEY = "fuwaSeenReleaseNotes";
const FUWA_RELEASE_MARKER_CACHE = "fuwa-release-state";
const FUWA_RELEASE_MARKER_REQUEST = "./__fuwa_release_marker__";
let pendingFuwaServiceWorker = null;
let fuwaServiceWorkerRefreshing = false;
let fuwaUpdateWatchdog = 0;

function hasPendingFuwaReleaseNotes() {
  try {
    return localStorage.getItem(FUWA_PENDING_RELEASE_NOTES_KEY) === FUWA_RELEASE_KEY &&
      localStorage.getItem(FUWA_SEEN_RELEASE_NOTES_KEY) !== FUWA_RELEASE_KEY;
  } catch (_) { return false; }
}

async function adoptFuwaServiceWorkerReleaseMarker() {
  if (!("caches" in window)) return false;

  try {
    const markerCache = await caches.open(FUWA_RELEASE_MARKER_CACHE);
    const response = await markerCache.match(FUWA_RELEASE_MARKER_REQUEST);
    if (!response) return false;

    const releaseKey = (await response.text()).trim();
    await markerCache.delete(FUWA_RELEASE_MARKER_REQUEST);

    if (releaseKey !== FUWA_RELEASE_KEY) return false;
    if (localStorage.getItem(FUWA_SEEN_RELEASE_NOTES_KEY) === FUWA_RELEASE_KEY) return false;

    localStorage.setItem(FUWA_PENDING_RELEASE_NOTES_KEY, FUWA_RELEASE_KEY);
    return true;
  } catch (error) {
    console.warn("Fuwa could not read its update handoff marker.", error);
    return false;
  }
}


function showFuwaUpdateBanner(worker) {
  if (!worker || !navigator.serviceWorker?.controller) return;
  pendingFuwaServiceWorker = worker;
  const button = $("appUpdateButton");
  if (button) { button.disabled = false; button.textContent = "Refresh"; }
  $("appUpdateBanner")?.classList.remove("hidden");
}

function hideFuwaUpdateBanner() { $("appUpdateBanner")?.classList.add("hidden"); }

function applyFuwaUpdate() {
  const worker = pendingFuwaServiceWorker;
  if (!worker) return;
  const button = $("appUpdateButton");
  if (button) { button.disabled = true; button.textContent = "Refreshing…"; }
  try { localStorage.setItem(FUWA_PENDING_RELEASE_NOTES_KEY, FUWA_RELEASE_KEY); } catch (_) {}
  worker.postMessage({ type: "SKIP_WAITING" });
  clearTimeout(fuwaUpdateWatchdog);
  fuwaUpdateWatchdog = window.setTimeout(() => {
    if (fuwaServiceWorkerRefreshing) return;
    if (button) { button.disabled = false; button.textContent = "Refresh"; }
    toast("The update is still preparing. Tap Refresh again in a moment.");
  }, 8000);
}

function watchFuwaServiceWorkerRegistration(registration) {
  if (!registration) return;
  if (registration.waiting && navigator.serviceWorker.controller) showFuwaUpdateBanner(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) showFuwaUpdateBanner(worker);
    });
  });
}

function showFuwaReleaseNotes() {
  if (!hasPendingFuwaReleaseNotes()) return false;
  $("fuwaReleaseNotesModal")?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  return true;
}

function closeFuwaReleaseNotes() {
  $("fuwaReleaseNotesModal")?.classList.add("hidden");
  try {
    localStorage.setItem(FUWA_SEEN_RELEASE_NOTES_KEY, FUWA_RELEASE_KEY);
    localStorage.removeItem(FUWA_PENDING_RELEASE_NOTES_KEY);
  } catch (_) {}
  if (!privacyIsLocked && !$("fuwaDrawer")?.classList.contains("open")) document.body.style.overflow = "";
  window.setTimeout(() => {
    maybeOpenFirstUseTutorial();
    window.setTimeout(() => {
      if (!state.privacyLockEnabled && $("fuwaTutorial")?.classList.contains("hidden")) maybeShowDailyMoodCheckin();
    }, 420);
  }, 180);
}

document.addEventListener("DOMContentLoaded", async () => {
  installIOSZoomGuard();

  $("openSettingsButton")?.addEventListener("click", openSettingsSheet);
  $("closeSettingsButton")?.addEventListener("click", closeSettingsSheet);
  $("settingsSheet")?.addEventListener("click", event => {
    if (event.target === $("settingsSheet")) closeSettingsSheet();
  });
  $("tutorialButton")?.addEventListener("click", () => {
    closeFuwaDrawer();
    openFuwaTutorial({ automatic: false });
  });
  $("tutorialNextButton")?.addEventListener("click", goNextTutorialStep);
  $("tutorialBackButton")?.addEventListener("click", goBackTutorialStep);
  $("tutorialSkipButton")?.addEventListener("click", () => closeFuwaTutorial({ markSeen: true }));
  $("tutorialCloseButton")?.addEventListener("click", () => closeFuwaTutorial({ markSeen: true }));
  $("featureTutorialGotIt")?.addEventListener("click", () => closeFeatureTutorial({ markSeen: true }));
  $("featureTutorialClose")?.addEventListener("click", () => closeFeatureTutorial({ markSeen: true }));
  $("featureTutorialLater")?.addEventListener("click", () => closeFeatureTutorial({ markSeen: false }));
  $("featureTutorial")?.addEventListener("click", event => {
    if (event.target === $("featureTutorial")) closeFeatureTutorial({ markSeen: true });
  });

  document.body.classList.add("fuwa-loading");
  try {
    state = { ...state, ...loadPreferences() };
    await diaryRepository.initialize();
    await diaryRepository.migrateLegacyData();
    await loadState();
    await adoptFuwaServiceWorkerReleaseMarker();

    // If today's Mood Jar already has a check-in, it is the authoritative
    // Home mood after reopening the app.
    const todayMoodCheckin = getTodayMoodCheckin();
    if (todayMoodCheckin && moodEmoji[todayMoodCheckin.mood]) {
      state.selectedMood = todayMoodCheckin.mood;
      savePreferences();
    }

    renderAll();
    const requestedView = new URLSearchParams(window.location.search).get("view");
    if (requestedView === "life") { navigate("life"); history.replaceState(null, "", window.location.pathname); }
    await applyWallpaper();
    renderSleepControls();

    // Show the usable shell before nonessential capability checks. This keeps
    // startup responsive as the local diary grows.
    document.body.classList.remove("fuwa-loading");
    const runDeferredStartup = () => {
      detectBiometricAvailability().catch(error => console.warn("Biometric availability check failed.", error));
      installPrivacyActivityWatch();
    };
    if ("requestIdleCallback" in window) window.requestIdleCallback(runDeferredStartup, { timeout: 1200 });
    else window.setTimeout(runDeferredStartup, 60);

    if (!hasPendingFuwaReleaseNotes()) maybeOpenFirstUseTutorial();

    window.addEventListener("fuwa-auth-ready", () => {
      if (!hasPendingFuwaReleaseNotes()) maybeOpenFirstUseTutorial();
    }, { once: true });
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
      syncHomeMoodToJar(button.dataset.mood);
    });
    button.addEventListener("animationend", () => button.classList.remove("mood-button-pop"));
  });







  $("openExploreButton")?.addEventListener("click", () => navigate("explore"));
  $("exploreHomeCard")?.addEventListener("click", () => navigate("explore"));

  $("menuButton")?.addEventListener("click", toggleFuwaDrawer);
  $("drawerCloseButton")?.addEventListener("click", closeFuwaDrawer);
  $("fuwaDrawerBackdrop")?.addEventListener("click", closeFuwaDrawer);

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (!$("fuwaTutorial")?.classList.contains("hidden")) {
      closeFuwaTutorial({ markSeen: true });
      return;
    }
    if ($("fuwaDrawer")?.classList.contains("open")) closeFuwaDrawer();
  });

  $("quickHideButton").addEventListener("click", async () => { closeFuwaDrawer(); await lockFuwaFromDrawer(); });

  $("privacyLockToggle")?.addEventListener("change", enableOrDisablePrivacyLock);
  $("setPrivacyPinButton")?.addEventListener("click", openPrivacyPinSetup);
  $("testPrivacyLockButton")?.addEventListener("click", () => {
    if (!state.privacyLockEnabled) {
      toast("Turn App Lock on first.");
      return;
    }
    lockFuwa("manual");
  });

  $("privacyAutoLockSelect")?.addEventListener("change", event => {
    state.privacyAutoLockMinutes = Number(event.target.value);
    savePreferences();
  });

  $("privacyReopenToggle")?.addEventListener("change", event => {
    event.target.checked = false;
    state.privacyLockOnReopen = false;
    savePreferences();
    toast("Fuwa locks only when you choose Lock Fuwa.");
  });

  $("biometricToggle")?.addEventListener("change", toggleBiometric);

  $("privacyPinCancel").addEventListener("click", closePrivacyPinSetup);
  $("privacyPinForm").addEventListener("submit", handlePrivacyPinSetup);
  $("privacyPinInput").addEventListener("input", event => {
    event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6);
    renderPinDots("privacyPinInput", "privacyPinDots");
  });
  $("privacyPinDots")?.addEventListener("click", () => focusPinInput("privacyPinInput"));
  $("privacyPinDots")?.addEventListener("touchend", () => focusPinInput("privacyPinInput"), { passive: true });
  $("unlockDots")?.addEventListener("click", () => focusPinInput("unlockPinInput"));
  $("unlockDots")?.addEventListener("touchend", () => focusPinInput("unlockPinInput"), { passive: true });

  $("unlockPinInput").addEventListener("input", () => renderPinDots("unlockPinInput", "unlockDots"));
  $("unlockPinInput").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      unlockWithPin();
    }
  });
  $("unlockPinButton").addEventListener("click", unlockWithPin);
  $("unlockBiometricButton").addEventListener("click", tryBiometricUnlock);

  bindSanctuaryStaticControls();
  bindNotificationSettings();
  bindLifePages();
  bindReleaseRitual();

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
  $("bookmarksHomeCard")?.addEventListener("click", event => {
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
    $("threadEmojiPreview").textContent = safeThreadIcon($("threadEmojiInput").value);
  });
  $("threadModal").addEventListener("click", event => {
    if (event.target === $("threadModal")) closeThreadModal();
  });

  $("openMoodJarButton").addEventListener("click", async () => {
    requestMoodJarMotionPermission();
    moodJarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    renderMoodJarView();
    navigate("moodjar");
    startMoodJarPhysics();
  });
  $("moodJarCard").addEventListener("click", async () => {
    requestMoodJarMotionPermission();
    moodJarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    renderMoodJarView();
    navigate("moodjar");
    startMoodJarPhysics();
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
  $("decorateEntryButton")?.addEventListener("click", openJournalCanvas);
  $("journalCanvasBack")?.addEventListener("click", closeJournalCanvas);
  $("saveJournalCanvasButton")?.addEventListener("click", saveJournalCanvas);
  $("journalCanvasPaper")?.addEventListener("click", () => { selectedJournalCanvasItemId = null; renderJournalCanvas(); });
  $("importStickerButton")?.addEventListener("click", () => $("customStickerInput")?.click());
  $("customStickerInput")?.addEventListener("change", importCustomSticker);
  $("stickerImportClose")?.addEventListener("click", closeStickerImportSheet);
  $("stickerImportCancel")?.addEventListener("click", closeStickerImportSheet);
  $("stickerImportSave")?.addEventListener("click", savePreparedCustomSticker);
  $("stickerImportRemoveBackground")?.addEventListener("change", refreshStickerBackgroundPreview);
  $("stickerImportSheet")?.addEventListener("click", event => {
    if (event.target === $("stickerImportSheet")) closeStickerImportSheet();
  });
  $("importScrapbookPhotoButton")?.addEventListener("click", () => $("scrapbookPhotosInput")?.click());
  $("scrapbookPhotosInput")?.addEventListener("change", importScrapbookPhotos);
  $("newScrapbookPageButton")?.addEventListener("click", createStandaloneScrapbookPage);
  $("scrapbookEmptyCreateButton")?.addEventListener("click", createStandaloneScrapbookPage);
  $("scrapbookSort")?.addEventListener("change", renderScrapbookLibrary);
  $("journalBookTitleInput")?.addEventListener("input", event => {
    if (!activeScrapbookBook) return;
    activeScrapbookBook.title = event.target.value;
    queueJournalCanvasSave();
  });
  $("journalCanvasTitleInput")?.addEventListener("input", event => {
    if (!journalCanvasState) return;
    journalCanvasState.title = event.target.value;
    queueJournalCanvasSave();
  });
  $("scrapbookPrevPage")?.addEventListener("click", () => goToAdjacentScrapbookPage(-1));
  $("scrapbookNextPage")?.addEventListener("click", () => goToAdjacentScrapbookPage(1));
  $("scrapbookAddPage")?.addEventListener("click", addScrapbookPage);
  $("scrapbookDuplicatePage")?.addEventListener("click", duplicateScrapbookPage);
  $("scrapbookMovePageLeft")?.addEventListener("click", () => moveCurrentScrapbookPage(-1));
  $("scrapbookMovePageRight")?.addEventListener("click", () => moveCurrentScrapbookPage(1));
  $("scrapbookDeletePage")?.addEventListener("click", deleteCurrentScrapbookPage);
  $("addJournalTextButton")?.addEventListener("click", addJournalText);
  document.querySelectorAll("[data-journal-palette-tab]").forEach(button => button.addEventListener("click", () => switchJournalPalette(button.dataset.journalPaletteTab)));
  document.querySelectorAll("[data-journal-paper]").forEach(button => button.addEventListener("click", () => setJournalPaper(button.dataset.journalPaper)));
  $("journalCanvasScale")?.addEventListener("input", event => updateSelectedJournalItem({ scale: Number(event.target.value) / 100 }));
  $("journalCanvasRotation")?.addEventListener("input", event => updateSelectedJournalItem({ rotation: Number(event.target.value) }));
  document.querySelectorAll("[data-journal-photo-style]").forEach(button => {
    button.addEventListener("click", () => setSelectedJournalPhotoStyle(button.dataset.journalPhotoStyle));
  });
  document.querySelectorAll("[data-journal-text-font]").forEach(button => button.addEventListener("click", () => setSelectedJournalTextStyle("textFont", button.dataset.journalTextFont)));
  document.querySelectorAll("[data-journal-text-size]").forEach(button => button.addEventListener("click", () => setSelectedJournalTextStyle("textSize", button.dataset.journalTextSize)));
  document.querySelectorAll("[data-journal-text-align]").forEach(button => button.addEventListener("click", () => setSelectedJournalTextStyle("textAlign", button.dataset.journalTextAlign)));
  document.querySelectorAll("[data-journal-text-color]").forEach(button => button.addEventListener("click", () => setSelectedJournalTextStyle("textColor", button.dataset.journalTextColor)));
  document.querySelectorAll("[data-journal-text-background]").forEach(button => button.addEventListener("click", () => setSelectedJournalTextStyle("textBackground", button.dataset.journalTextBackground)));
  $("journalTextBold")?.addEventListener("click", () => toggleSelectedJournalTextStyle("textBold"));
  $("journalTextItalic")?.addEventListener("click", () => toggleSelectedJournalTextStyle("textItalic"));
  $("journalTextEdit")?.addEventListener("click", editSelectedJournalText);
  $("journalCanvasDuplicate")?.addEventListener("click", duplicateSelectedJournalItem);
  $("journalCanvasForward")?.addEventListener("click", () => moveSelectedJournalItemLayer(1));
  $("journalCanvasBackward")?.addEventListener("click", () => moveSelectedJournalItemLayer(-1));
  $("journalCanvasDelete")?.addEventListener("click", removeSelectedJournalItem);
  $("cancelEditor").addEventListener("click", () => {
    cleanupEditorMediaPreviews();
    navigate("entries");
  });
  $("deleteEntryButton").addEventListener("click", deleteEntry);
  $("addPhotosButton").addEventListener("click", () => $("entryPhotosInput").click());
  $("entryPhotosInput").addEventListener("change", addEntryPhotos);
  $("savePhotoButton")?.addEventListener("click", saveActivePhotoToDevice);
  $("closePhotoViewer").addEventListener("click", closePhotoViewer);
  $("photoViewer").addEventListener("click", event => {
    if (event.target === $("photoViewer")) closePhotoViewer();
  });

  $("tinyJoyForm").addEventListener("submit", addTinyJoy);
  $("randomThoughtForm")?.addEventListener("submit", addRandomThought);
  $("randomThoughtPageForm")?.addEventListener("submit", addRandomThought);
  $("randomThoughtSeeAllButton")?.addEventListener("click", () => navigate("thoughts"));
  $("tinyJoySeeAllButton")?.addEventListener("click", () => navigate("thoughts"));
  $("entrySearch").addEventListener("input", event => scheduleEntrySearch(event.target.value));
  $("entriesLoadMore")?.addEventListener("click", showMoreEntries);

  $("newLetterButton").addEventListener("click", () => toggleLetterComposer(true));
  $("cancelLetterButton").addEventListener("click", () => toggleLetterComposer(false));
  $("saveLetterButton").addEventListener("click", saveLetter);


  $("editProfileNameButton")?.addEventListener("click", editProfileName);

  $("appearanceCloseButton").addEventListener("click", closeAppearance);
  $("appearanceDoneButton").addEventListener("click", closeAppearance);
  $("appearanceModal").addEventListener("click", event => {
    if (event.target === $("appearanceModal")) closeAppearance();
  });

  document.querySelectorAll("[data-theme-choice]").forEach(button => {
    button.addEventListener("click", () => selectTheme(button.dataset.themeChoice));
  });

  $("chooseWallpaperButton").addEventListener("click", openWallpaperPicker);
  $("removeWallpaperButton")?.addEventListener("click", removeCustomWallpaper);
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

  $("themeButton").addEventListener("click", () => { closeFuwaDrawer(); openAppearance(); });
  $("exportButton").addEventListener("click", exportBackup);
  $("importInput").addEventListener("change", event => importBackup(event.target.files[0]));
  $("clearAllButton").addEventListener("click", clearAll);

  // Open the daily check-in only after every control has its listener. This
  // avoids a slow-device race where the modal could appear during binding.
  if (!state.privacyLockEnabled && !hasPendingFuwaReleaseNotes()) maybeShowDailyMoodCheckin();

  bindMoodJarOrientation();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) startMoodJarPhysics();
  });
  let moodJarResizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(moodJarResizeTimer);
    moodJarResizeTimer = setTimeout(() => {
      moodJarPhysicsWorlds.clear();
      if (currentView === "home" || currentView === "moodjar") startMoodJarPhysics();
    }, 120);
  }, { passive: true });

  $("fuwaReleaseNotesClose")?.addEventListener("click", closeFuwaReleaseNotes);
  $("fuwaReleaseNotesGotIt")?.addEventListener("click", closeFuwaReleaseNotes);
  $("appUpdateButton")?.addEventListener("click", applyFuwaUpdate);
  if (hasPendingFuwaReleaseNotes()) window.setTimeout(showFuwaReleaseNotes, 120);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (fuwaServiceWorkerRefreshing) return;
      fuwaServiceWorkerRefreshing = true;
      clearTimeout(fuwaUpdateWatchdog);
      hideFuwaUpdateBanner();
      window.location.reload();
    });

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" })
        .then(registration => {
          watchFuwaServiceWorkerRegistration(registration);
          return registration.update();
        })
        .catch(console.error);
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      navigator.serviceWorker.getRegistration()
        .then(registration => registration?.update())
        .catch(() => {});
    });
  }
});


/* FUWA V91: legacy v87 player re-parenting removed.
   Now Playing stays above Soundscape in the Sleep Corner source order. */
