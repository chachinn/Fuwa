const STORAGE_KEY = "fuwaDataV1";

const defaultState = {
  entries: [],
  tinyJoys: [],
  letters: [],
  selectedMood: "good",
  theme: "pink"
};

let state = loadState();
let currentView = "home";

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

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaultState, ...JSON.parse(raw) } : structuredClone(defaultState);
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
}

function renderAll() {
  $("todayLabel").textContent = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric"
  }).format(new Date());

  renderMoodPicker();
  renderCalendar();
  renderRecentEntries();
  renderEntries($("entrySearch")?.value || "");
  renderTinyJoys();
  renderLetters();
  renderStats();
  applyTheme();
}

function openEditor(entryId = null, dateOverride = null) {
  const entry = entryId ? state.entries.find(item => item.id === entryId) : null;

  $("entryId").value = entry?.id || "";
  $("entryDate").value = entry?.date || dateOverride || isoToday();
  $("entryMood").value = entry?.mood || state.selectedMood || "good";
  $("entryTitle").value = entry?.title || "";
  $("entryBody").value = entry?.body || "";
  $("entryTags").value = (entry?.tags || []).join(", ");
  $("entryAfterthought").value = entry?.afterthought || "";

  $("editorHeading").textContent = entry ? "Edit Entry" : "New Entry";
  $("deleteEntryButton").classList.toggle("hidden", !entry);

  navigate("editor");
  setTimeout(() => $("entryTitle").focus(), 80);
}

function saveEntry() {
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
    afterthought: $("entryAfterthought").value.trim(),
    createdAt: id ? (state.entries.find(e => e.id === id)?.createdAt || Date.now()) : Date.now(),
    updatedAt: Date.now()
  };

  if (id) {
    state.entries = state.entries.map(entry => entry.id === id ? data : entry);
  } else {
    state.entries.push(data);
  }

  state.selectedMood = data.mood;
  saveState();
  navigate("entries");
  toast("Memory saved 🌸");
}

function deleteEntry() {
  const id = $("entryId").value;
  if (!id) return;

  if (!confirm("Delete this diary entry?")) return;

  state.entries = state.entries.filter(entry => entry.id !== id);
  saveState();
  navigate("entries");
  toast("Entry deleted");
}

function addTinyJoy(event) {
  event.preventDefault();
  const input = $("tinyJoyInput");
  const text = input.value.trim();
  if (!text) return;

  state.tinyJoys.push({
    id: uid("joy"),
    text,
    createdAt: Date.now()
  });

  input.value = "";
  saveState();
  toast("Tiny joy saved ✨");
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

function saveLetter() {
  const title = $("letterTitle").value.trim();
  const body = $("letterBody").value.trim();
  const openDate = $("letterOpenDate").value;

  if (!title || !body || !openDate) {
    toast("Finish the letter before sealing it.");
    return;
  }

  state.letters.push({
    id: uid("letter"),
    title,
    body,
    openDate,
    createdAt: Date.now()
  });

  saveState();
  toggleLetterComposer(false);
  toast("Letter sealed ✉️");
}

function exportBackup() {
  const payload = {
    app: "Fuwa",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: state
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fuwa-backup-${isoToday()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importBackup(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const incoming = parsed.data || parsed;

      if (!incoming.entries || !incoming.tinyJoys || !incoming.letters) {
        throw new Error("Invalid Fuwa backup");
      }

      state = { ...defaultState, ...incoming };
      saveState();
      toast("Backup imported 🌸");
    } catch {
      alert("That file does not look like a valid Fuwa backup.");
    }
  };
  reader.readAsText(file);
}

function clearAll() {
  if (!confirm("Clear all Fuwa entries, joys, and letters stored on this device?")) return;
  if (!confirm("This cannot be undone unless you exported a backup. Continue?")) return;

  state = structuredClone(defaultState);
  saveState();
  navigate("home");
  toast("Local data cleared");
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-nav]").forEach(button => {
    button.addEventListener("click", () => navigate(button.dataset.nav));
  });

  document.querySelectorAll("#moodPicker button").forEach(button => {
    button.addEventListener("click", () => {
      state.selectedMood = button.dataset.mood;
      saveState();
    });
  });

  $("writeTodayButton").addEventListener("click", () => openEditor(null, isoToday()));
  $("newEntryButton").addEventListener("click", () => openEditor());
  $("navCreate").addEventListener("click", () => openEditor());
  $("saveEntryButton").addEventListener("click", saveEntry);
  $("cancelEditor").addEventListener("click", () => navigate("entries"));
  $("deleteEntryButton").addEventListener("click", deleteEntry);

  $("tinyJoyForm").addEventListener("submit", addTinyJoy);
  $("entrySearch").addEventListener("input", event => renderEntries(event.target.value));

  $("newLetterButton").addEventListener("click", () => toggleLetterComposer(true));
  $("cancelLetterButton").addEventListener("click", () => toggleLetterComposer(false));
  $("saveLetterButton").addEventListener("click", saveLetter);

  $("themeButton").addEventListener("click", cycleTheme);
  $("exportButton").addEventListener("click", exportBackup);
  $("importInput").addEventListener("change", event => importBackup(event.target.files[0]));
  $("clearAllButton").addEventListener("click", clearAll);

  renderAll();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(console.error);
    });
  }
});
