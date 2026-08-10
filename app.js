const STORAGE_KEY = "fuwaDataV1";
const PREFERENCES_KEY = "fuwaPreferencesV1";
const DATABASE_NAME = "FuwaDB";
const DATABASE_VERSION = 12;
const MAX_PHOTOS_PER_ENTRY = 8;
const MAX_PHOTO_DIMENSION = 1800;
const PHOTO_JPEG_QUALITY = 0.82;
const CONTENT_STORES = ["entries", "tinyJoys", "letters"];
const ALL_STORES = [...CONTENT_STORES, "media", "chapters", "threads", "moodCheckins", "bookmarks", "nightlyReflections", "thenNow", "comfortItems", "unsentLetters", "thoughtBubbles", "dreams", "dailyCheckins", "lifeCollections", "habitDefinitions", "moments", "randomThoughts", "journalCanvases", "stickerAssets", "scrapbookPhotos", "settings"];
const LOCAL_ONLY_STORES = new Set(["media", "journalCanvases", "stickerAssets", "scrapbookPhotos", "settings"]);
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
let journalCanvasReturnView = "scrapbook";
let journalCanvasSaveTimer = null;
let journalCanvasState = null;
let selectedJournalCanvasItemId = null;
let journalCanvasAssetUrls = new Map();
let journalCanvasMediaUrls = new Map();
let activePhotoViewerId = null;
let moodJarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let editingThreadId = null;
let activeThreadId = null;
let activeBookmarkId = null;
let bookmarkEditorEntryId = null;
let editingLetterId = null;
let editingNightlyId = null;
let moodCheckinSaving = false;
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
const defaultSanctuaryPreferences = { theme: "rose", visibleObjects: ["lamp","plant","books","stars","cushion","tea","garland","frame"] };
let sanctuaryPreferences = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(SANCTUARY_PREFS_KEY) || "{}");
    return {
      theme: ["rose","lavender","sky"].includes(saved.theme) ? saved.theme : "rose",
      visibleObjects: Array.isArray(saved.visibleObjects)
        ? saved.visibleObjects.filter(id => defaultSanctuaryPreferences.visibleObjects.includes(id))
        : [...defaultSanctuaryPreferences.visibleObjects]
    };
  } catch (_) {
    return structuredClone(defaultSanctuaryPreferences);
  }
})();
let activeSanctuaryMemoryEntryId = null;

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

  async deleteScrapbookPage(scrapbookId) {
    const photos = await this.getScrapbookPhotos(scrapbookId);
    const transaction = this.db.transaction(["journalCanvases", "scrapbookPhotos"], "readwrite");
    transaction.objectStore("journalCanvases").delete(scrapbookId);
    const photoStore = transaction.objectStore("scrapbookPhotos");
    photos.forEach(record => photoStore.delete(record.id));
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
    const [mediaRecords, bookmarkRecords, linkedCanvas] = await Promise.all([
      this.getMediaForEntry(entryId),
      this.getBookmarksForEntry(entryId),
      this.get("journalCanvases", entryId)
    ]);

    // Scrapbook pages are independent now. If an older page was linked to this
    // entry, preserve the page and copy only the photos it actually uses into
    // scrapbook-local storage before the entry media is removed.
    const migratedScrapbookPhotos = [];
    let preservedCanvas = null;
    if (linkedCanvas) {
      const mediaById = new Map(mediaRecords.map(record => [record.id, record]));
      const migratedItems = (linkedCanvas.items || []).map(item => {
        if (item.type !== "photo" || (item.mediaSource && item.mediaSource !== "entry")) return item;
        const source = mediaById.get(item.mediaId);
        if (!source?.blob) return item;
        const newId = uid("scrapphoto");
        migratedScrapbookPhotos.push({
          id: newId,
          scrapbookId: linkedCanvas.id,
          blob: source.blob,
          type: source.type || source.blob.type || "image/jpeg",
          width: source.width || 0,
          height: source.height || 0,
          originalName: source.originalName || "Scrapbook photo",
          createdAt: source.createdAt || Date.now()
        });
        return { ...item, mediaId: newId, mediaSource: "scrapbook" };
      });
      const { entryId: _removedEntryId, ...rest } = linkedCanvas;
      preservedCanvas = {
        ...rest,
        title: linkedCanvas.title || "Scrapbook page",
        items: migratedItems,
        updatedAt: Date.now()
      };
    }

    const transaction = this.db.transaction(["entries", "media", "bookmarks", "journalCanvases", "scrapbookPhotos"], "readwrite");
    transaction.objectStore("entries").delete(entryId);
    if (preservedCanvas) transaction.objectStore("journalCanvases").put(preservedCanvas);
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
    if (localScrapbookData) stores.push("journalCanvases", "stickerAssets", "scrapbookPhotos");
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
    const stores = [...CONTENT_STORES, "media", "moodCheckins", "threads", "bookmarks", "nightlyReflections", "thenNow", "comfortItems", "unsentLetters", "thoughtBubbles", "dreams", "dailyCheckins", "lifeCollections", "habitDefinitions", "moments", "randomThoughts", "journalCanvases", "stickerAssets", "scrapbookPhotos"];
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
      }, 220);
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
  list.innerHTML = items.length ? items.map(item => `
    ${swipeActionShell(`<article class="feature-card comfort-item-card">
      <span>${escapeHtml(item.type || "comfort")}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.body || "")}</p>
    </article>`, "comfort", item.id)}`).join("") : `<div class="empty-state">Add little things that make life feel softer.</div>`;
  bindSwipeActions(list);
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
    ${swipeActionShell(`<article class="feature-card unsent-card"><span>${escapeHtml(formatDate(item.date))}</span><strong>To ${escapeHtml(item.to)}</strong><p>${escapeHtml(item.body.slice(0,220))}${item.body.length>220?"…":""}</p></article>`, "unsent", item.id)}
  `).join("") : `<div class="empty-state">Some words are meant to be written, not sent.</div>`;
  bindSwipeActions(host);
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
  host.innerHTML = items.length ? items.map(item => swipeActionShell(`<div class="thought-bubble"><span>${escapeHtml(formatDate(item.date))}</span><p>${escapeHtml(item.text)}</p></div>`, "bubble", item.id)).join("") : `<div class="empty-state">Tiny thoughts can live here without becoming diary entries.</div>`;
  bindSwipeActions(host);
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

function renderSanctuary(force=false) {
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

async function saveMoodCheckin(mood) {
  if (!moodEmoji[mood] || moodCheckinSaving) return;
  moodCheckinSaving = true;
  document.querySelectorAll("[data-checkin-mood]").forEach(button => {
    button.disabled = true;
  });
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
    $("moodCheckinModal").classList.add("hidden");
    document.body.style.overflow = "";
    renderAll();
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
const JOURNAL_PAGES = [{id:"mood",label:"Mood"},{id:"rating",label:"Rate My Day"},{id:"highlight",label:"Highlight"},{id:"energy",label:"Energy & Social Battery"},{id:"sleep",label:"Sleep"},{id:"wellness",label:"Body & Wellness"},{id:"mind",label:"Mind"},{id:"adulting",label:"Adulting"},{id:"habits",label:"Habits"},{id:"reading",label:"Reading"},{id:"watching",label:"Watching"},{id:"listening",label:"Listening"},{id:"weather",label:"Weather"},{id:"dreams",label:"Dreams"},{id:"gratitude",label:"Gratitude"},{id:"learned",label:"Something I Learned"},{id:"cup",label:"Fill My Cup"},{id:"win",label:"Little Win"},{id:"memory",label:"Memory of the Day"},{id:"tomorrow",label:"Tomorrow"},{id:"free",label:"Free Page"}];
let lifeActiveTab="today", lifeTrackerYear=new Date().getFullYear(), lifeTrackerMetric="rating", lifeCollectionCategory="cup", journalPageIndex=0;
let lifeDraft={rating:0,mood:"",movement:"",weather:"",dream:"",cycle:"",habits:{},customHabits:{}};
let journalPreferences=(()=>{try{const saved=JSON.parse(localStorage.getItem(JOURNAL_PREFS_KEY)||"{}");const enabled=Array.isArray(saved.enabledPages)?saved.enabledPages.filter(id=>JOURNAL_PAGES.some(p=>p.id===id)):JOURNAL_PAGES.map(p=>p.id);return{enabledPages:enabled.length?enabled:JOURNAL_PAGES.map(p=>p.id)}}catch(_){return{enabledPages:JOURNAL_PAGES.map(p=>p.id)}}})();
function saveJournalPreferences(){try{localStorage.setItem(JOURNAL_PREFS_KEY,JSON.stringify(journalPreferences))}catch(e){console.warn("Could not save Fuwa journal preferences.",e)}}
function enabledJournalPages(){return JOURNAL_PAGES.filter(p=>journalPreferences.enabledPages.includes(p.id))}
function ensureLifeHabits(){if(!state.habitDefinitions.length){state.habitDefinitions=LIFE_DEFAULT_HABITS.map((name,i)=>({id:`adult_${i+1}`,name,kind:"adulting",active:true,createdAt:Date.now()+i}));state.habitDefinitions.push(...LIFE_DEFAULT_CUSTOM_HABITS.map((name,i)=>({id:`habit_${i+1}`,name,kind:"habit",active:true,createdAt:Date.now()+100+i})));Promise.all(state.habitDefinitions.map(r=>diaryRepository.save("habitDefinitions",r))).catch(console.error)}else if(!state.habitDefinitions.some(h=>h.kind==="habit")){const add=LIFE_DEFAULT_CUSTOM_HABITS.map((name,i)=>({id:uid("habit"),name,kind:"habit",active:true,createdAt:Date.now()+i}));state.habitDefinitions=state.habitDefinitions.map(h=>({...h,kind:h.kind||"adulting"})).concat(add);Promise.all(state.habitDefinitions.map(r=>diaryRepository.save("habitDefinitions",r))).catch(console.error)}}
function lifeTodayRecord(){return state.dailyCheckins.find(r=>r.date===isoToday())||null}
function lifeSetChoice(group,value){lifeDraft[group]=value;document.querySelectorAll(`[data-life-choice="${group}"]`).forEach(b=>b.classList.toggle("selected",b.dataset.value===value))}
function setInputValue(id,value){const el=$(id);if(el)el.value=value??""}function setChecked(id,value){const el=$(id);if(el)el.checked=!!value}
function loadLifeTodayForm(){ensureLifeHabits();const r=lifeTodayRecord();journalPageIndex=Math.min(Number(r?.lastPageIndex||0),Math.max(0,enabledJournalPages().length-1));lifeDraft={rating:Number(r?.rating||0),mood:r?.mood||"",movement:r?.movement||"",weather:r?.weather||"",dream:r?.dream||"",cycle:r?.cycle||"",habits:{...(r?.habits||{})},customHabits:{...(r?.customHabits||{})}};$("lifeTodayDateLabel").textContent=new Intl.DateTimeFormat("en-US",{weekday:"long",month:"long",day:"numeric"}).format(new Date());$("lifeSaveStatus").textContent=r?"Saved ✓":"Not checked in";[["lifeRatingReason",r?.ratingReason],["lifeHighlight",r?.highlight],["lifeEnergy",r?.energy],["lifeSocial",r?.social],["lifeSleepHours",r?.sleepHours],["lifeSleepQuality",r?.sleepQuality],["lifeWater",r?.water],["lifeOutside",r?.outside],["lifeMovementMinutes",r?.movementMinutes],["lifeStress",r?.stress],["lifeCalm",r?.calm],["lifeMindNote",r?.mindNote],["lifeReadingTitle",r?.readingTitle],["lifeReadingPages",r?.readingPages],["lifeReadingMinutes",r?.readingMinutes],["lifeWatchedTitle",r?.watchedTitle],["lifeWatchedEpisode",r?.watchedEpisode],["lifeWatchedRating",r?.watchedRating],["lifeSong",r?.song],["lifeTemperature",r?.temperature],["lifeDreamNote",r?.dreamNote],["lifeGratitude1",Array.isArray(r?.gratitude)?r.gratitude[0]:r?.gratitude],["lifeGratitude2",Array.isArray(r?.gratitude)?r.gratitude[1]:""],["lifeGratitude3",Array.isArray(r?.gratitude)?r.gratitude[2]:""],["lifeLearned",r?.learned],["lifeCupToday",r?.cupToday],["lifeLittleWin",r?.littleWin],["lifeMemory",r?.memory],["lifeLookingForward",r?.lookingForward],["lifeTomorrowIntention",r?.tomorrowIntention],["lifeNote",r?.note]].forEach(([id,v])=>setInputValue(id,v));setChecked("lifeSongRepeat",r?.songRepeat);document.querySelectorAll("#lifeDayRating button").forEach(b=>{const a=Number(b.dataset.rating)<=lifeDraft.rating;b.classList.toggle("selected",a);b.textContent=a?"★":"☆"});document.querySelectorAll("#lifeMoodPicker button").forEach(b=>b.classList.toggle("selected",b.dataset.lifeMood===lifeDraft.mood));["movement","weather","dream","cycle"].forEach(g=>lifeSetChoice(g,lifeDraft[g]||""));renderLifeHabits();renderJournalPage();$("journalClosingPage")?.classList.add("hidden");$("lifeDailyForm")?.classList.remove("hidden")}
function renderLifeHabits(){const a=$("lifeHabitGrid"),h=$("lifeCustomHabitGrid");if(a){const items=state.habitDefinitions.filter(x=>(x.kind||"adulting")==="adulting"&&x.active!==false);a.innerHTML=items.map(x=>`<button type="button" class="${lifeDraft.habits?.[x.id]?"done":""}" data-adult-habit="${escapeHtml(x.id)}"><span>${lifeDraft.habits?.[x.id]?"✓":"○"}</span><strong>${escapeHtml(x.name)}</strong></button>`).join("");a.querySelectorAll("[data-adult-habit]").forEach(b=>b.addEventListener("click",()=>{const id=b.dataset.adultHabit;lifeDraft.habits[id]=!lifeDraft.habits[id];renderLifeHabits()}))}if(h){const items=state.habitDefinitions.filter(x=>x.kind==="habit"&&x.active!==false);h.innerHTML=items.map(x=>`<button type="button" class="${lifeDraft.customHabits?.[x.id]?"done":""}" data-custom-habit="${escapeHtml(x.id)}"><span>${lifeDraft.customHabits?.[x.id]?"✓":"○"}</span><strong>${escapeHtml(x.name)}</strong></button>`).join("");h.querySelectorAll("[data-custom-habit]").forEach(b=>b.addEventListener("click",()=>{const id=b.dataset.customHabit;lifeDraft.customHabits[id]=!lifeDraft.customHabits[id];renderLifeHabits()}))}}
async function editHabitKind(kind,label){const current=state.habitDefinitions.filter(h=>(h.kind||"adulting")===kind&&h.active!==false).map(h=>h.name).join(", ");const value=window.prompt(`${label} — separate each with a comma.`,current);if(value===null)return;const names=value.split(",").map(v=>v.trim()).filter(Boolean).slice(0,12);if(!names.length)return toast("Keep at least one item.");const existing=state.habitDefinitions.filter(h=>(h.kind||"adulting")===kind),byName=new Map(existing.map(h=>[h.name.toLowerCase(),h]));const next=names.map((name,i)=>{const f=byName.get(name.toLowerCase());return f?{...f,name,kind,active:true,updatedAt:Date.now()}:{id:uid(kind),name,kind,active:true,createdAt:Date.now()+i}}),keep=new Set(next.map(h=>h.id)),removed=existing.filter(h=>!keep.has(h.id)).map(h=>({...h,active:false,updatedAt:Date.now()}));state.habitDefinitions=state.habitDefinitions.filter(h=>(h.kind||"adulting")!==kind).concat(next,removed);await Promise.all([...next,...removed].map(r=>diaryRepository.save("habitDefinitions",r)));renderLifeHabits();toast(`${label} updated ♡`)}
function manageLifeHabits(){return editHabitKind("adulting","Adulting list")}function manageCustomLifeHabits(){return editHabitKind("habit","Personal habits")}
function renderJournalPage(){const pages=enabledJournalPages();if(!pages.length)return;journalPageIndex=Math.max(0,Math.min(journalPageIndex,pages.length-1));const id=pages[journalPageIndex].id;document.querySelectorAll(".journal-page").forEach(p=>p.classList.toggle("active",p.dataset.journalPage===id));$("journalPageCounter").textContent=`Page ${journalPageIndex+1} of ${pages.length}`;$("journalBackButton").disabled=journalPageIndex===0;$("journalNextButton").classList.toggle("hidden",journalPageIndex===pages.length-1);$("journalSkipButton").classList.toggle("hidden",journalPageIndex===pages.length-1);$("journalFinishButton").classList.toggle("hidden",journalPageIndex!==pages.length-1);$("journalProgressDots").innerHTML=pages.map((p,i)=>`<button type="button" class="${i===journalPageIndex?"active":i<journalPageIndex?"visited":""}" data-journal-jump="${i}" aria-label="${escapeHtml(p.label)}"></button>`).join("");$("journalProgressDots").querySelectorAll("[data-journal-jump]").forEach(b=>b.addEventListener("click",()=>{journalPageIndex=Number(b.dataset.journalJump);renderJournalPage()}))}
function journalNext(){if(journalPageIndex<enabledJournalPages().length-1){journalPageIndex++;renderJournalPage()}}function journalBack(){if(journalPageIndex>0){journalPageIndex--;renderJournalPage()}}
function valueOrNull(id,num=false){const el=$(id);if(!el||el.value==="")return null;return num?Number(el.value):el.value.trim()}
async function saveLifeToday(event){event.preventDefault();const e=lifeTodayRecord(),gratitude=[valueOrNull("lifeGratitude1"),valueOrNull("lifeGratitude2"),valueOrNull("lifeGratitude3")].filter(Boolean);const r={id:e?.id||`daily_${isoToday()}`,date:isoToday(),rating:Number(lifeDraft.rating||0),ratingReason:valueOrNull("lifeRatingReason")||"",mood:lifeDraft.mood||"",highlight:valueOrNull("lifeHighlight")||"",energy:valueOrNull("lifeEnergy",true),social:valueOrNull("lifeSocial",true),sleepHours:valueOrNull("lifeSleepHours",true),sleepQuality:valueOrNull("lifeSleepQuality",true),water:valueOrNull("lifeWater",true),outside:valueOrNull("lifeOutside",true),movementMinutes:valueOrNull("lifeMovementMinutes",true),movement:lifeDraft.movement||"",stress:valueOrNull("lifeStress",true),calm:valueOrNull("lifeCalm",true),mindNote:valueOrNull("lifeMindNote")||"",habits:{...lifeDraft.habits},customHabits:{...lifeDraft.customHabits},readingTitle:valueOrNull("lifeReadingTitle")||"",readingPages:valueOrNull("lifeReadingPages",true),readingMinutes:valueOrNull("lifeReadingMinutes",true),watchedTitle:valueOrNull("lifeWatchedTitle")||"",watchedEpisode:valueOrNull("lifeWatchedEpisode")||"",watchedRating:valueOrNull("lifeWatchedRating",true),song:valueOrNull("lifeSong")||"",songRepeat:!!$("lifeSongRepeat")?.checked,weather:lifeDraft.weather||"",temperature:valueOrNull("lifeTemperature",true),dream:lifeDraft.dream||"",dreamNote:valueOrNull("lifeDreamNote")||"",gratitude,learned:valueOrNull("lifeLearned")||"",cupToday:valueOrNull("lifeCupToday")||"",littleWin:valueOrNull("lifeLittleWin")||"",memory:valueOrNull("lifeMemory")||"",lookingForward:valueOrNull("lifeLookingForward")||"",tomorrowIntention:valueOrNull("lifeTomorrowIntention")||"",note:valueOrNull("lifeNote")||"",cycle:lifeDraft.cycle||"",lastPageIndex:0,completedAt:Date.now(),createdAt:e?.createdAt||Date.now(),updatedAt:Date.now()};await diaryRepository.save("dailyCheckins",r);state.dailyCheckins=e?state.dailyCheckins.map(x=>x.id===r.id?r:x):[...state.dailyCheckins,r];$("lifeSaveStatus").textContent="Saved ✓";renderLifeTracker();renderLifeHistory();showJournalClosing(r)}
function showJournalClosing(r){$("lifeDailyForm").classList.add("hidden");$("journalClosingPage").classList.remove("hidden");$("journalClosingDate").textContent=formatDate(r.date);const stars=r.rating?`${"★".repeat(r.rating)}${"☆".repeat(5-r.rating)}`:"";$("journalClosingSummary").textContent=[r.mood?(moodLabels[r.mood]||r.mood):"",stars,r.highlight||""].filter(Boolean).join(" · ")||"Today is safely tucked away."}
function closeJournal(){$("journalClosingPage").classList.add("hidden");$("lifeDailyForm").classList.remove("hidden");journalPageIndex=0;renderJournalPage();navigate("home")}
function openJournalCustomizer(){const host=$("journalPageSettingsList");host.innerHTML=JOURNAL_PAGES.map(p=>`<label class="journal-page-setting"><input type="checkbox" value="${p.id}" ${journalPreferences.enabledPages.includes(p.id)?"checked":""}><span>${escapeHtml(p.label)}</span></label>`).join("");$("journalCustomizeSheet").classList.remove("hidden")}
function closeJournalCustomizer(){$("journalCustomizeSheet").classList.add("hidden")}function saveJournalCustomizer(){const selected=[...$("journalPageSettingsList").querySelectorAll('input[type="checkbox"]:checked')].map(i=>i.value);if(!selected.length)return toast("Keep at least one journal page.");journalPreferences.enabledPages=selected;saveJournalPreferences();closeJournalCustomizer();journalPageIndex=0;renderJournalPage();toast("Your journal pages are saved ♡")}
function lifeMetricValue(r,m){if(m==="rating")return r.rating||null;if(m==="mood")return({amazing:5,good:4,neutral:3,tired:2,sad:1,angry:1})[r.mood]||null;if(m==="sleep")return r.sleepHours??null;if(m==="energy")return r.energy??null;if(m==="stress")return r.stress??null;if(m==="reading")return r.readingPages??null;if(m==="movement")return r.movement?({none:1,walk:2,yoga:3,cardio:4,strength:5})[r.movement]||2:null;if(m==="weather")return r.weather?({stormy:1,rainy:1,cloudy:2,partly:3,sunny:4})[r.weather]||2:null;if(m==="dream")return r.dream?({none:1,scary:2,sad:2,weird:3,romantic:4,happy:5})[r.dream]||3:null;if(m==="cycle")return r.cycle?({none:1,spotting:2,light:3,regular:4,heavy:5})[r.cycle]||1:null;return null}
function lifeMetricLevel(m,v){if(v==null||v==="")return 0;if(m==="sleep")return v>=8?5:v>=7?4:v>=6?3:v>=5?2:1;if(m==="reading")return v>=80?5:v>=50?4:v>=20?3:v>0?2:1;return Math.max(1,Math.min(5,Math.round(Number(v))))}
function renderLifeTracker(){const host=$("lifeYearTracker");if(!host)return;$("lifeTrackerYear").textContent=lifeTrackerYear;const records=new Map(state.dailyCheckins.filter(r=>String(r.date).startsWith(`${lifeTrackerYear}-`)).map(r=>[r.date,r])),months=["J","F","M","A","M","J","J","A","S","O","N","D"];let html=`<div class="tracker-corner"></div>${months.map(m=>`<div class="tracker-month-label">${m}</div>`).join("")}`;for(let day=1;day<=31;day++){html+=`<div class="tracker-day-label">${day}</div>`;for(let month=1;month<=12;month++){const max=new Date(lifeTrackerYear,month,0).getDate();if(day>max){html+=`<div class="tracker-cell invalid"></div>`;continue}const date=`${lifeTrackerYear}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`,r=records.get(date),v=r?lifeMetricValue(r,lifeTrackerMetric):null,l=lifeMetricLevel(lifeTrackerMetric,v);html+=`<button type="button" class="tracker-cell level-${l}" data-life-history-date="${date}"></button>`}}host.innerHTML=html;host.querySelectorAll("[data-life-history-date]").forEach(b=>b.addEventListener("click",()=>showLifeHistoryDate(b.dataset.lifeHistoryDate)));renderLifeTrackerLegend()}
function renderLifeTrackerLegend(){const labels={rating:["No entry","1","2","3","4","5"],mood:["No entry","Heavy","Low","Okay","Good","Amazing"],sleep:["No entry","<5h","5–6h","6–7h","7–8h","8h+"],energy:["No entry","Very low","Low","Okay","Good","High"],stress:["No entry","Peaceful","Low","Moderate","High","Overwhelmed"],reading:["No entry","0","1–19","20–49","50–79","80+"],movement:["No entry","Rest","Walk","Yoga","Cardio","Strength"],weather:["No entry","Rain","Cloud","Partly","Sunny","Sunny"],dream:["No entry","No dream","Heavy","Weird","Good","Happy"],cycle:["No entry","None","Spotting","Light","Regular","Heavy"]}[lifeTrackerMetric]||[];$("lifeTrackerLegend").innerHTML=labels.map((x,i)=>`<span><i class="level-${i}"></i>${x}</span>`).join("")}
function showLifeHistoryDate(date){const r=state.dailyCheckins.find(x=>x.date===date);if(!r)return;const item=$("lifeHistoryList");item.innerHTML=`<article class="life-history-card"><span>${escapeHtml(formatDate(date))}</span><strong>${escapeHtml(r.highlight||r.memory||"A daily check-in")}</strong><p>${escapeHtml(r.note||r.learned||"")}</p><small>${r.rating?`${"★".repeat(r.rating)} `:""}${r.mood?moodLabels[r.mood]||r.mood:""}</small></article>`}
function renderLifeHistory(){const host=$("lifeHistoryList");if(!host)return;const items=[...state.dailyCheckins].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,8);host.innerHTML=items.length?items.map(r=>`<article class="life-history-card"><span>${escapeHtml(formatDate(r.date))}</span><strong>${escapeHtml(r.highlight||r.memory||"Daily check-in")}</strong><p>${escapeHtml((Array.isArray(r.gratitude)?r.gratitude.join(" · "):r.gratitude)||r.note||"")}</p><small>${r.rating?`${"★".repeat(r.rating)} `:""}${r.mood?moodLabels[r.mood]||r.mood:""}</small></article>`).join(""):`<div class="empty-state">Your tracker starts with your first Daily Life journal.</div>`}
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

function setLifeTab(tab){lifeActiveTab=tab;document.querySelectorAll("[data-life-tab]").forEach(b=>b.classList.toggle("active",b.dataset.lifeTab===tab));$("lifeTodayPanel").classList.toggle("active",tab==="today");$("lifeTrackersPanel").classList.toggle("active",tab==="trackers");$("lifeMomentsPanel").classList.toggle("active",tab==="moments");$("lifeCollectionsPanel").classList.toggle("active",tab==="collections");if(tab==="today")loadLifeTodayForm();if(tab==="trackers"){renderLifeTracker();renderLifeHistory()}if(tab==="collections")renderLifeCollections()}
function renderLifePages(){if(!$("lifeView"))return;if(currentView==="life")setLifeTab(lifeActiveTab)}
function bindLifePages(){document.querySelectorAll("[data-life-tab]").forEach(b=>b.addEventListener("click",()=>setLifeTab(b.dataset.lifeTab)));document.querySelectorAll("#lifeDayRating button").forEach(b=>b.addEventListener("click",()=>{lifeDraft.rating=Number(b.dataset.rating);document.querySelectorAll("#lifeDayRating button").forEach(x=>{const a=Number(x.dataset.rating)<=lifeDraft.rating;x.classList.toggle("selected",a);x.textContent=a?"★":"☆"})}));document.querySelectorAll("#lifeMoodPicker button").forEach(b=>b.addEventListener("click",()=>{lifeDraft.mood=b.dataset.lifeMood;document.querySelectorAll("#lifeMoodPicker button").forEach(x=>x.classList.toggle("selected",x===b))}));document.querySelectorAll("[data-life-choice]").forEach(b=>b.addEventListener("click",()=>lifeSetChoice(b.dataset.lifeChoice,b.dataset.value)));$("lifeManageHabitsButton")?.addEventListener("click",manageLifeHabits);$("lifeManageCustomHabitsButton")?.addEventListener("click",manageCustomLifeHabits);$("journalNextButton")?.addEventListener("click",journalNext);$("journalSkipButton")?.addEventListener("click",journalNext);$("journalBackButton")?.addEventListener("click",journalBack);$("journalCustomizeButton")?.addEventListener("click",openJournalCustomizer);$("journalCustomizeClose")?.addEventListener("click",closeJournalCustomizer);$("journalCustomizeSave")?.addEventListener("click",saveJournalCustomizer);$("journalCloseButton")?.addEventListener("click",closeJournal);$("lifeDailyForm")?.addEventListener("submit",saveLifeToday);$("lifeTrackerMetric")?.addEventListener("change",e=>{lifeTrackerMetric=e.target.value;renderLifeTracker()});$("lifeTrackerPrevYear")?.addEventListener("click",()=>{lifeTrackerYear--;renderLifeTracker()});$("lifeTrackerNextYear")?.addEventListener("click",()=>{lifeTrackerYear++;renderLifeTracker()});$("lifeCollectionCategories")?.querySelectorAll("[data-collection-category]").forEach(b=>b.addEventListener("click",()=>{lifeCollectionCategory=b.dataset.collectionCategory;document.querySelectorAll("[data-collection-category]").forEach(x=>x.classList.toggle("active",x===b));renderLifeCollections()}));$("lifeCollectionForm")?.addEventListener("submit",saveLifeCollection);
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
  if (view === "unsent") return renderUnsent();
  if (view === "bubbles") return renderBubbles();
  if (view === "dreams") return renderDreams();
  if (view === "sanctuary") return renderSanctuary();
  if (view === "nightly") return renderNightlyHistory();
  if (view === "memoryDrift") return renderMemoryDriftDetail();
}

function renderAll() {
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


const FUWA_BUILTIN_STICKERS = [
  "🌸","🌷","🌼","🎀","☁️","✨","⭐","🌙","💗","💌","🍓","🍰",
  "☕","🧸","🐰","🐱","🫧","🌿","🍀","🕯️","📖","📎","✈️","🎧"
];

const FUWA_JOURNAL_DECOR = [
  { id: "washi-blush", kind: "washi", variant: "blush", label: "Blush tape" },
  { id: "washi-lavender", kind: "washi", variant: "lavender", label: "Lavender tape" },
  { id: "washi-daisy", kind: "washi", variant: "daisy", label: "Daisy tape" },
  { id: "washi-grid", kind: "washi", variant: "grid", label: "Grid tape" },
  { id: "scrap-rose", kind: "scrap", variant: "rose", label: "Rose paper" },
  { id: "scrap-cream", kind: "scrap", variant: "cream", label: "Cream paper" },
  { id: "scrap-lavender", kind: "scrap", variant: "lavender", label: "Lavender paper" },
  { id: "scrap-note", kind: "scrap", variant: "note", label: "Note paper" },
  { id: "label-today", kind: "label", variant: "blush", text: "TODAY", label: "Today label" },
  { id: "label-memory", kind: "label", variant: "lavender", text: "MEMORY", label: "Memory label" },
  { id: "label-love", kind: "label", variant: "cream", text: "♡ LITTLE THING", label: "Little thing label" },
  { id: "label-date", kind: "label", variant: "rose", text: "DATE", label: "Date label" }
];

let journalPaletteLoaded = { mine: false, photos: false };

function queueJournalCanvasSave() {
  if (!journalCanvasState || !activeJournalCanvasId) return;
  clearTimeout(journalCanvasSaveTimer);
  journalCanvasSaveTimer = setTimeout(() => {
    journalCanvasSaveTimer = null;
    saveJournalCanvas({ quiet: true }).catch(error => console.error("Could not auto-save scrapbook page.", error));
  }, 700);
}

function defaultJournalCanvas({ id = uid("scrapbook"), entryId = null, title = "Untitled page", date = isoToday() } = {}) {
  const record = {
    id,
    title: title || "Untitled page",
    date: date || isoToday(),
    background: "blush",
    items: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
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
    return `<button type="button" class="journal-canvas-item sticker-item${selected}" data-canvas-item="${escapeHtml(item.id)}" style="${style}" aria-label="Sticker">${escapeHtml(item.content || "✨")}</button>`;
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
    const allowedKinds = ["washi", "scrap", "label"];
    const allowedVariants = ["blush", "lavender", "daisy", "grid", "rose", "cream", "note"];
    const kind = allowedKinds.includes(item.decorKind) ? item.decorKind : "label";
    const variant = allowedVariants.includes(item.variant) ? item.variant : "blush";
    const text = kind === "label" ? escapeHtml(item.text || "NOTE") : "";
    return `<button type="button" class="journal-canvas-item decor-item decor-${kind} decor-${variant}${selected}" data-canvas-item="${escapeHtml(item.id)}" style="${style}" aria-label="Journal decoration">${text ? `<span>${text}</span>` : ""}</button>`;
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
  canvas.dataset.paper = journalCanvasState.background || "blush";
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
  event.preventDefault();
  const element = event.currentTarget;
  const id = element.dataset.canvasItem;
  const item = journalCanvasState.items.find(x => x.id === id);
  const paper = $("journalCanvasPaper");
  if (!item || !paper) return;
  selectedJournalCanvasItemId = id;
  const rect = paper.getBoundingClientRect();
  element.setPointerCapture?.(event.pointerId);

  const move = moveEvent => {
    item.x = Math.max(0.03, Math.min(0.97, (moveEvent.clientX - rect.left) / rect.width));
    item.y = Math.max(0.03, Math.min(0.97, (moveEvent.clientY - rect.top) / rect.height));
    element.style.left = `${item.x * 100}%`;
    element.style.top = `${item.y * 100}%`;
  };
  const end = () => {
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", end);
    element.removeEventListener("pointercancel", end);
    renderJournalCanvasControls();
    queueJournalCanvasSave();
  };
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", end, { once: true });
  element.addEventListener("pointercancel", end, { once: true });
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

function renderBuiltinStickerPalette() {
  const host = $("builtinStickerPalette");
  if (!host) return;
  host.innerHTML = FUWA_BUILTIN_STICKERS.map(sticker => `<button type="button" class="sticker-palette-button" data-add-builtin-sticker="${escapeHtml(sticker)}">${escapeHtml(sticker)}</button>`).join("");
  host.querySelectorAll("[data-add-builtin-sticker]").forEach(button => {
    button.addEventListener("click", () => addJournalCanvasItem({ type: "builtin", content: button.dataset.addBuiltinSticker }));
  });
}

function renderJournalDecorPalette() {
  const host = $("journalDecorPalette");
  if (!host) return;
  host.innerHTML = FUWA_JOURNAL_DECOR.map(item => `
    <button type="button" class="journal-decor-palette-item ${escapeHtml(`preview-${item.kind}`)} ${escapeHtml(`preview-${item.variant}`)}" data-add-journal-decor="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.label)}">
      ${item.kind === "label" ? `<span>${escapeHtml(item.text || "NOTE")}</span>` : ""}
    </button>`).join("");
  host.querySelectorAll("[data-add-journal-decor]").forEach(button => {
    button.addEventListener("click", () => {
      const decor = FUWA_JOURNAL_DECOR.find(item => item.id === button.dataset.addJournalDecor);
      if (!decor) return;
      addJournalCanvasItem({
        type: "decor",
        decorKind: decor.kind,
        variant: decor.variant,
        text: decor.text || "",
        scale: decor.kind === "washi" ? 1.15 : decor.kind === "scrap" ? 1.05 : .9
      });
    });
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
  const maxDimension = 1200;
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

  // Estimate the background from edge pixels. This is deliberately local and
  // lightweight rather than an AI upload. It works best for plain/light backdrops.
  const sample = context.getImageData(0, 0, width, height);
  const pixels = sample.data;
  const edgeColors = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 60));
  const pushPixel = (x, y) => {
    const index = (y * width + x) * 4;
    if (pixels[index + 3] > 20) edgeColors.push([pixels[index], pixels[index + 1], pixels[index + 2]]);
  };
  for (let x = 0; x < width; x += step) { pushPixel(x, 0); pushPixel(x, height - 1); }
  for (let y = 0; y < height; y += step) { pushPixel(0, y); pushPixel(width - 1, y); }
  if (!edgeColors.length) return blob;

  const background = edgeColors.reduce((acc, color) => [acc[0] + color[0], acc[1] + color[1], acc[2] + color[2]], [0, 0, 0]).map(total => total / edgeColors.length);
  const clearDistance = 34;
  const featherDistance = 82;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    const dr = pixels[i] - background[0];
    const dg = pixels[i + 1] - background[1];
    const db = pixels[i + 2] - background[2];
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    if (distance <= clearDistance) {
      pixels[i + 3] = 0;
    } else if (distance < featherDistance) {
      const factor = (distance - clearDistance) / (featherDistance - clearDistance);
      pixels[i + 3] = Math.round(pixels[i + 3] * factor);
    }
  }
  context.putImageData(sample, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error("Background removal failed.")), "image/png");
  });
}

async function importCustomSticker(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) return toast("Choose an image for your sticker.");
  if (file.size > 6 * 1024 * 1024) return toast("Keep sticker images under 6 MB.");
  const removeBackground = $("removeStickerBackground")?.checked === true;

  try {
    if (removeBackground) {
      toast("Removing the background on this device…");
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
    }
    const processedBlob = removeBackground ? await removeStickerBackgroundLocally(file) : file;
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
    const url = URL.createObjectURL(record.blob);
    journalCanvasAssetUrls.set(record.id, url);
    await renderMyStickerPalette();
    addJournalCanvasItem({ type: "custom", assetId: record.id });
    toast(removeBackground ? "Sticker saved with its background removed 🎀" : "Sticker added to My Stickers 🎀");
  } catch (error) {
    console.error("Could not save custom sticker.", error);
    toast(removeBackground ? "Fuwa couldn't remove that background. Try a simpler image or import it normally." : "Fuwa couldn't save that sticker on this device.");
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
  host.innerHTML = `<p class="journal-palette-empty">Loading photos…</p>`;

  const [entryMedia, scrapbookMedia] = await Promise.all([
    activeJournalCanvasEntryId ? diaryRepository.getMediaForEntry(activeJournalCanvasEntryId) : Promise.resolve([]),
    diaryRepository.getScrapbookPhotos(activeJournalCanvasId)
  ]);

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
  const inUse = (journalCanvasState?.items || []).some(item => item.type === "photo" && item.mediaSource === "scrapbook" && item.mediaId === photoId);
  if (!confirm(inUse ? "Delete this photo? It will also be removed from the scrapbook page." : "Delete this page-only photo from this device?")) return;
  try {
    await diaryRepository.remove("scrapbookPhotos", photoId);
    const key = `scrapbook:${photoId}`;
    const url = journalCanvasMediaUrls.get(key);
    if (url) URL.revokeObjectURL(url);
    journalCanvasMediaUrls.delete(key);
    if (journalCanvasState) {
      journalCanvasState.items = journalCanvasState.items.filter(item => !(item.type === "photo" && item.mediaSource === "scrapbook" && item.mediaId === photoId));
      if (!journalCanvasState.items.some(item => item.id === selectedJournalCanvasItemId)) selectedJournalCanvasItemId = null;
      renderJournalCanvas();
      queueJournalCanvasSave();
    }
    journalPaletteLoaded.photos = false;
    await renderJournalPhotoPalette();
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
  const existing = await diaryRepository.getScrapbookPhotos(activeJournalCanvasId);
  const room = Math.max(0, 12 - existing.length);
  if (!room) return toast("Keep up to 12 page-only photos in one scrapbook page.");
  const selected = files.slice(0, room);
  if (files.length > room) toast(`Fuwa will add the first ${room} photos to keep this page light.`);

  try {
    toast("Preparing scrapbook photos…");
    const records = [];
    for (const file of selected) {
      const compressed = await compressPhoto(file);
      records.push({
        id: uid("scrapphoto"),
        scrapbookId: activeJournalCanvasId,
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
  return linkedEntry?.title || "Scrapbook page";
}

async function openScrapbookCanvas(record, { returnView = "scrapbook" } = {}) {
  if (!record?.id) return;
  activeJournalCanvasId = record.id;
  const linkedEntry = record.entryId ? state.entries.find(entry => entry.id === record.entryId) : null;
  activeJournalCanvasEntryId = linkedEntry?.id || null;
  journalCanvasReturnView = returnView;
  selectedJournalCanvasItemId = null;
  journalPaletteLoaded = { mine: false, photos: false };
  journalCanvasState = { ...record, title: scrapbookTitleForRecord(record) };
  if (record.entryId && !linkedEntry) delete journalCanvasState.entryId;

  renderBuiltinStickerPalette();
  renderJournalDecorPalette();
  if ($("journalCanvasTitleInput")) $("journalCanvasTitleInput").value = journalCanvasState.title || "Untitled page";
  if ($("journalCanvasEyebrow")) $("journalCanvasEyebrow").textContent = activeJournalCanvasEntryId ? "Linked to a journal memory" : "Your standalone scrapbook page";
  if ($("journalPhotoPaletteNote")) $("journalPhotoPaletteNote").textContent = activeJournalCanvasEntryId ? "Use linked-entry photos or add photos just for this scrapbook page." : "Import photos just for this scrapbook page.";
  if ($("myStickerPalette")) $("myStickerPalette").innerHTML = `<p class="journal-palette-empty">Open this tab to load My Stickers.</p>`;
  if ($("journalPhotoPalette")) $("journalPhotoPalette").innerHTML = `<p class="journal-palette-empty">Open this tab to load photos.</p>`;
  switchJournalPalette("stickers");
  renderJournalCanvas();
  navigate("journalCanvas");

  // Load only assets already used by this page. Full libraries remain lazy.
  try {
    const expectedId = record.id;
    await loadJournalCanvasReferencedUrls();
    if (activeJournalCanvasId === expectedId) renderJournalCanvas();
  } catch (error) {
    console.error("Could not load scrapbook page assets.", error);
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
    let record = await diaryRepository.get("journalCanvases", entryId);
    if (!record) {
      record = defaultJournalCanvas({
        id: entryId,
        entryId,
        title: entry?.title || "Scrapbook page",
        date: entry?.date || isoToday()
      });
      await diaryRepository.save("journalCanvases", record);
    } else if (!record.title) {
      record = { ...record, title: entry?.title || "Scrapbook page", date: record.date || entry?.date || isoToday() };
    }
    await openScrapbookCanvas(record, { returnView: "editor" });
  } catch (error) {
    console.error("Could not open linked scrapbook page.", error);
    toast("Fuwa couldn't open that scrapbook page.");
  }
}


async function createStandaloneScrapbookPage() {
  const record = defaultJournalCanvas({ title: "Untitled page", date: isoToday() });
  try {
    await diaryRepository.save("journalCanvases", record);
    await openScrapbookCanvas(record, { returnView: "scrapbook" });
  } catch (error) {
    console.error("Could not create scrapbook page.", error);
    toast("Fuwa couldn't create that scrapbook page.");
  }
}

async function openScrapbookPageById(id) {
  try {
    const record = await diaryRepository.get("journalCanvases", id);
    if (!record) return toast("That scrapbook page could not be found.");
    await openScrapbookCanvas(record, { returnView: "scrapbook" });
  } catch (error) {
    console.error("Could not open scrapbook page.", error);
    toast("Fuwa couldn't open that scrapbook page.");
  }
}


async function renderScrapbookLibrary() {
  const grid = $("scrapbookLibraryGrid");
  if (!grid) return;
  try {
    const pages = await diaryRepository.getAll("journalCanvases");
    const sort = $("scrapbookSort")?.value || "newest";
    pages.sort((a, b) => sort === "oldest" ? Number(a.createdAt || 0) - Number(b.createdAt || 0) : Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
    $("scrapbookPageCount").textContent = `${pages.length} page${pages.length === 1 ? "" : "s"}`;
    $("scrapbookEmptyState")?.classList.toggle("hidden", pages.length > 0);
    grid.innerHTML = pages.map(page => {
      const linkedEntry = page.entryId ? state.entries.find(entry => entry.id === page.entryId) : null;
      const title = scrapbookTitleForRecord(page);
      const date = page.date || linkedEntry?.date || "";
      const itemCount = Array.isArray(page.items) ? page.items.length : 0;
      return `<article class="scrapbook-library-card" data-scrapbook-card="${escapeHtml(page.id)}">
        <button type="button" class="scrapbook-card-open" data-open-scrapbook="${escapeHtml(page.id)}">
          <span class="scrapbook-card-paper" data-paper="${escapeHtml(page.background || "blush")}"><i>🎀</i><b>${itemCount}</b></span>
          <span class="scrapbook-card-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(date || "No date")}${linkedEntry ? " · Linked memory" : " · Standalone"}</small></span>
        </button>
        <button type="button" class="scrapbook-card-delete" data-delete-scrapbook="${escapeHtml(page.id)}" aria-label="Delete scrapbook page">×</button>
      </article>`;
    }).join("");
    grid.querySelectorAll("[data-open-scrapbook]").forEach(button => button.addEventListener("click", () => openScrapbookPageById(button.dataset.openScrapbook)));
    grid.querySelectorAll("[data-delete-scrapbook]").forEach(button => button.addEventListener("click", async () => {
      const id = button.dataset.deleteScrapbook;
      if (!confirm("Delete this scrapbook page? Its page-only photos will also be removed from this device.")) return;
      try {
        await diaryRepository.deleteScrapbookPage(id);
        await renderScrapbookLibrary();
        toast("Scrapbook page deleted.");
      } catch (error) {
        console.error("Could not delete scrapbook page.", error);
        toast("Fuwa couldn't delete that scrapbook page.");
      }
    }));
  } catch (error) {
    console.error("Could not load scrapbook library.", error);
    $("scrapbookPageCount").textContent = "Scrapbook unavailable";
    $("scrapbookEmptyState")?.classList.add("hidden");
    grid.innerHTML = `<div class="scrapbook-load-error">Fuwa couldn't load your scrapbook pages. Your local data was not changed. Try reopening Scrapbook.</div>`;
  }
}


async function closeJournalCanvas() {
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
  journalCanvasReturnView = "scrapbook";
  if (returnView === "editor" && entryId) openEditor(entryId);
  else navigate("scrapbook");
}

async function saveJournalCanvas(options = {}) {
  if (!journalCanvasState || !activeJournalCanvasId) return;
  const quiet = options?.quiet === true;
  clearTimeout(journalCanvasSaveTimer);
  journalCanvasSaveTimer = null;
  try {
    const title = $("journalCanvasTitleInput")?.value.trim() || journalCanvasState.title || "Untitled page";
    journalCanvasState.title = title;
    journalCanvasState.updatedAt = Date.now();
    await diaryRepository.save("journalCanvases", structuredClone(journalCanvasState));
    if (!quiet) toast("Scrapbook page saved locally 🎀");
  } catch (error) {
    console.error("Could not save scrapbook page.", error);
    if (!quiet) toast("Fuwa couldn't save this scrapbook page.");
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
  if (!journalCanvasState) return;
  journalCanvasState.background = name;
  document.querySelectorAll("[data-journal-paper]").forEach(button => button.classList.toggle("active", button.dataset.journalPaper === name));
  renderJournalCanvas();
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
  const [mediaRecords, journalCanvases, stickerRecords, scrapbookPhotoRecords] = await Promise.all([
    diaryRepository.readAllMedia(),
    diaryRepository.getAll("journalCanvases"),
    diaryRepository.getAll("stickerAssets"),
    diaryRepository.getAll("scrapbookPhotos")
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
  return [
    "entries", "tinyJoys", "letters", "moodCheckins", "threads", "bookmarks",
    "nightlyReflections", "thenNow", "comfortItems", "unsentLetters",
    "thoughtBubbles", "dreams", "dailyCheckins", "lifeCollections", "habitDefinitions"
  ].reduce((total, key) => total + (Array.isArray(data?.[key]) ? data[key].length : 0), 0);
}

async function verifyRestoredContent(expected) {
  const actual = await diaryRepository.readCurrentData();
  const storeNames = [
    "entries", "tinyJoys", "letters", "moodCheckins", "threads", "bookmarks",
    "nightlyReflections", "thenNow", "comfortItems", "unsentLetters",
    "thoughtBubbles", "dreams", "dailyCheckins", "lifeCollections", "habitDefinitions"
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
      const hasScrapbookBackup = canvasBackup !== null || stickerBackup !== null || scrapbookPhotoBackup !== null;
      const localScrapbookData = hasScrapbookBackup ? {
        journalCanvases: canvasBackup || [],
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
    copy: "Use Home for the things you may want most often: a mood check-in, recent memories, Tiny Joys, Random Thoughts, and little pieces of your day.",
    how: [
      "Tap a mood cloud when you want a quick emotional check-in.",
      "Use Little Things for Tiny Joys and passing Random Thoughts.",
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
    copy: "Instead of filling one giant form, move through your little notebook one page at a time. Answer only what feels useful that day.",
    how: [
      "Use Next, Back, or Skip as you move through today's pages.",
      "Trackers build from the answers you save.",
      "Moments and Collections keep other little pieces of your life."
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
    title: "Thought Bubbles catches a thought before it disappears",
    copy: "Use this when something is worth saving but does not need a full entry. Short, strange, serious, funny — all of it counts.",
    how: [
      "Write one quick sentence.",
      "Use Float one back to me to revisit an older thought.",
      "A Thought Bubble can stay tiny."
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
    copy: "Save words, activities, reminders, places, foods, or tiny things that reliably make a difficult moment a little softer.",
    how: [
      "Tap + to add something comforting.",
      "Use I need something soft when you want Fuwa to pick one.",
      "Build the list around what actually works for you."
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

document.addEventListener("DOMContentLoaded", async () => {
  setTimeout(() => sessionStorage.removeItem("fuwa-sw-reloaded"), 2500);
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

    maybeOpenFirstUseTutorial();

    window.addEventListener("fuwa-auth-ready", () => {
      maybeOpenFirstUseTutorial();
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
      state.selectedMood = button.dataset.mood;
      saveState();
      renderMoodPicker();
      showMoodReaction(state.selectedMood, true);
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
  $("importScrapbookPhotoButton")?.addEventListener("click", () => $("scrapbookPhotosInput")?.click());
  $("scrapbookPhotosInput")?.addEventListener("change", importScrapbookPhotos);
  $("newScrapbookPageButton")?.addEventListener("click", createStandaloneScrapbookPage);
  $("scrapbookEmptyCreateButton")?.addEventListener("click", createStandaloneScrapbookPage);
  $("scrapbookSort")?.addEventListener("change", renderScrapbookLibrary);
  $("journalCanvasTitleInput")?.addEventListener("input", event => {
    if (!journalCanvasState) return;
    journalCanvasState.title = event.target.value;
    queueJournalCanvasSave();
  });
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
  if (!state.privacyLockEnabled) maybeShowDailyMoodCheckin();

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

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (sessionStorage.getItem("fuwa-sw-reloaded") === "1") return;
      sessionStorage.setItem("fuwa-sw-reloaded", "1");
      window.location.reload();
    });

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" })
        .then(registration => registration.update())
        .catch(console.error);
    });
  }
});