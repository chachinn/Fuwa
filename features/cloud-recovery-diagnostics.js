// FUWA V112 — ZERO-BACKUP RECOVERY DIAGNOSTICS
// Read-only diagnostics for distinguishing account mismatch from a genuinely
// overwritten/empty singleton cloud backup. This module never writes Firestore.

const FUWA_DIAGNOSTIC_KEYS = [
  "fuwaCloudBaselineV1",
  "fuwaCloudRestoreGuardV1",
  "fuwaDailyCloudBackupV1"
];

let fuwaDiagnosticAuthDetail = window.__fuwaCloudSafetyLastAuthDetail || null;
let fuwaDiagnosticRunning = false;

function fuwaDiagnosticReadMap(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function fuwaDiagnosticShortId(value = "") {
  const text = String(value || "");
  if (!text) return "—";
  if (text.length <= 14) return text;
  return `${text.slice(0, 6)}…${text.slice(-6)}`;
}

function fuwaDiagnosticProvider(user) {
  const providers = Array.isArray(user?.providerData)
    ? user.providerData.map(item => item?.providerId).filter(Boolean)
    : [];
  if (providers.includes("google.com")) return "Google";
  if (providers.includes("password")) return "Email & password";
  return providers.length ? providers.join(", ") : "Firebase account";
}

function fuwaDiagnosticFormatTime(value) {
  if (!value) return "—";
  try {
    const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
    if (!Number.isFinite(date.getTime())) return "—";
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  } catch (_) {
    return "—";
  }
}

function fuwaDiagnosticKnownUids(currentUid = "") {
  const ids = new Set();
  FUWA_DIAGNOSTIC_KEYS.forEach(key => {
    const map = fuwaDiagnosticReadMap(key);
    Object.keys(map || {}).forEach(uid => uid && ids.add(uid));
  });
  if (currentUid) ids.delete(currentUid);
  return [...ids];
}

function fuwaDiagnosticEnsureStyles() {
  if (document.getElementById("fuwaRecoveryDiagnosticStyles")) return;
  const style = document.createElement("style");
  style.id = "fuwaRecoveryDiagnosticStyles";
  style.textContent = `
    #fuwaRecoveryDiagnostics{margin:12px 0 2px;border:1px solid rgba(192,132,151,.28);border-radius:14px;background:rgba(255,249,251,.82);overflow:hidden}
    #fuwaRecoveryDiagnostics summary{cursor:pointer;padding:12px 14px;font-weight:700;color:#765760;list-style:none}
    #fuwaRecoveryDiagnostics summary::-webkit-details-marker{display:none}
    #fuwaRecoveryDiagnostics summary::after{content:'＋';float:right;font-weight:500}
    #fuwaRecoveryDiagnostics[open] summary::after{content:'−'}
    .fuwa-recovery-diagnostic-body{padding:0 14px 14px;display:grid;gap:8px}
    .fuwa-recovery-diagnostic-note{font-size:12px;line-height:1.45;color:#846d74;margin:0 0 2px}
    .fuwa-recovery-diagnostic-warning{font-size:12px;line-height:1.45;color:#7a4c58;background:#fff1f5;border-radius:10px;padding:9px 10px;margin:0}
    .fuwa-recovery-diagnostic-grid{display:grid;gap:6px}
    .fuwa-recovery-diagnostic-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:10px;align-items:start;font-size:12px;padding:5px 0;border-bottom:1px solid rgba(192,132,151,.12)}
    .fuwa-recovery-diagnostic-row span{color:#8b747b}
    .fuwa-recovery-diagnostic-row strong{color:#674f57;text-align:right;overflow-wrap:anywhere}
    #fuwaRecoveryDiagnosticCopy{width:100%;margin-top:4px;border:1px solid rgba(192,132,151,.35);border-radius:10px;background:#fff;color:#765760;padding:9px 12px;font:inherit;font-weight:700}
  `;
  document.head.appendChild(style);
}

function fuwaDiagnosticEnsurePanel() {
  const modal = document.getElementById("cloudRestoreModal");
  if (!modal) return null;
  let panel = document.getElementById("fuwaRecoveryDiagnostics");
  if (panel) return panel;

  fuwaDiagnosticEnsureStyles();
  panel = document.createElement("details");
  panel.id = "fuwaRecoveryDiagnostics";
  panel.innerHTML = `
    <summary>Recovery diagnostics</summary>
    <div class="fuwa-recovery-diagnostic-body">
      <p class="fuwa-recovery-diagnostic-note">Read-only. Fuwa is not backing up, restoring, deleting, or changing cloud data while this panel is checked.</p>
      <p class="fuwa-recovery-diagnostic-warning" id="fuwaRecoveryDiagnosticWarning" hidden></p>
      <div class="fuwa-recovery-diagnostic-grid" id="fuwaRecoveryDiagnosticGrid"></div>
      <button type="button" id="fuwaRecoveryDiagnosticCopy">Copy diagnostics</button>
    </div>`;

  const anchor = modal.querySelector(".cloud-restore-details");
  if (anchor?.parentNode) anchor.insertAdjacentElement("afterend", panel);
  else modal.querySelector(".cloud-restore-sheet")?.appendChild(panel);

  panel.querySelector("#fuwaRecoveryDiagnosticCopy")?.addEventListener("click", async () => {
    const text = panel.dataset.copyText || "Fuwa recovery diagnostics unavailable.";
    try {
      await navigator.clipboard.writeText(text);
      const button = panel.querySelector("#fuwaRecoveryDiagnosticCopy");
      if (button) {
        const original = button.textContent;
        button.textContent = "Copied ✓";
        window.setTimeout(() => { button.textContent = original; }, 1400);
      }
    } catch (_) {
      window.prompt("Copy these Fuwa recovery diagnostics:", text);
    }
  });

  return panel;
}

function fuwaDiagnosticBuild(state) {
  const user = fuwaDiagnosticAuthDetail?.user || null;
  const currentUid = user?.uid || "";
  const remote = state?.remote || null;
  const otherUids = fuwaDiagnosticKnownUids(currentUid);
  const actualCount = Number(state?.actualCount || 0);
  const declaredCount = state?.declaredCount == null ? "—" : String(state.declaredCount);
  const localCount = Number(state?.localCount || 0);
  const legacyCount = Number(state?.legacyCount || 0);
  const cloudWriteTime = fuwaDiagnosticFormatTime(remote?.backedUpAtClient || remote?.backedUpAt);

  const rows = [
    ["Signed-in email", user?.email || "—"],
    ["Sign-in method", fuwaDiagnosticProvider(user)],
    ["Current Fuwa account ID", fuwaDiagnosticShortId(currentUid)],
    ["Cloud actual records", String(actualCount)],
    ["Cloud saved count", declaredCount],
    ["Cloud last write", cloudWriteTime],
    ["Cloud backup ID", fuwaDiagnosticShortId(remote?.backupId)],
    ["Cloud source device", fuwaDiagnosticShortId(remote?.sourceDeviceId)],
    ["Local journal records", String(localCount)],
    ["Older local-copy records", String(legacyCount)],
    ["Other Fuwa account IDs remembered here", otherUids.length ? otherUids.map(fuwaDiagnosticShortId).join(", ") : "None found"]
  ];

  let warning = "";
  if (otherUids.length > 0) {
    warning = `This device remembers ${otherUids.length} other Fuwa account ID${otherUids.length === 1 ? "" : "s"}. Your earlier cloud backup may belong to a different Firebase account/login.`;
  } else if (actualCount === 0 && remote && cloudWriteTime !== "—") {
    warning = `The current cloud document is genuinely empty and was last written ${cloudWriteTime}. Compare that with the day/time you last restored successfully; if this write is newer, the singleton cloud copy was replaced afterward.`;
  } else if (actualCount === 0) {
    warning = "No alternate Fuwa account ID is remembered in Fuwa's local safety metadata, and the current cloud arrays are empty.";
  }

  const copyText = [
    "Fuwa Recovery Diagnostics v112",
    `Email: ${user?.email || "—"}`,
    `Provider: ${fuwaDiagnosticProvider(user)}`,
    `Current UID: ${currentUid || "—"}`,
    `Cloud actual records: ${actualCount}`,
    `Cloud saved count: ${declaredCount}`,
    `Cloud last write: ${cloudWriteTime}`,
    `Cloud backup ID: ${remote?.backupId || "—"}`,
    `Cloud source device: ${remote?.sourceDeviceId || "—"}`,
    `Local journal records: ${localCount}`,
    `Older local-copy records: ${legacyCount}`,
    `Other remembered UIDs: ${otherUids.length ? otherUids.join(", ") : "none"}`,
    `Recovery mode: ${state?.mode || "unknown"}`
  ].join("\n");

  return { rows, warning, copyText, shouldOpen: actualCount === 0 };
}

function fuwaDiagnosticRender(state) {
  const panel = fuwaDiagnosticEnsurePanel();
  if (!panel || !state) return;
  const diagnostic = fuwaDiagnosticBuild(state);
  const grid = panel.querySelector("#fuwaRecoveryDiagnosticGrid");
  const warning = panel.querySelector("#fuwaRecoveryDiagnosticWarning");

  if (grid) {
    grid.replaceChildren(...diagnostic.rows.map(([label, value]) => {
      const row = document.createElement("div");
      row.className = "fuwa-recovery-diagnostic-row";
      const key = document.createElement("span");
      const val = document.createElement("strong");
      key.textContent = label;
      val.textContent = value;
      row.append(key, val);
      return row;
    }));
  }

  if (warning) {
    warning.hidden = !diagnostic.warning;
    warning.textContent = diagnostic.warning;
  }
  panel.dataset.copyText = diagnostic.copyText;
  if (diagnostic.shouldOpen) panel.open = true;
}

async function fuwaDiagnosticRefresh(reason = "manual") {
  if (fuwaDiagnosticRunning) return;
  const recovery = window.FuwaCloudRestoreRecovery;
  if (!recovery?.scan) return;
  fuwaDiagnosticRunning = true;
  try {
    const state = await recovery.scan();
    if (state) fuwaDiagnosticRender(state);
  } catch (error) {
    console.warn(`Fuwa recovery diagnostics deferred (${reason}).`, error?.message || error);
  } finally {
    fuwaDiagnosticRunning = false;
  }
}

window.addEventListener("fuwa-auth-ready", event => {
  fuwaDiagnosticAuthDetail = event?.detail || null;
});

window.addEventListener("fuwa-firestore-ready", () => {
  window.setTimeout(() => void fuwaDiagnosticRefresh("firestore-ready"), 50);
});

document.addEventListener("click", event => {
  if (!event.target?.closest?.("#cloudRestoreButton")) return;
  window.setTimeout(() => void fuwaDiagnosticRefresh("restore-open"), 80);
});

window.addEventListener("pageshow", () => {
  const modal = document.getElementById("cloudRestoreModal");
  if (modal && !modal.classList.contains("hidden")) void fuwaDiagnosticRefresh("pageshow");
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => fuwaDiagnosticEnsurePanel(), { once: true });
} else {
  fuwaDiagnosticEnsurePanel();
}

window.FuwaRecoveryDiagnostics = {
  refresh: () => fuwaDiagnosticRefresh("manual-debug"),
  knownOtherUids: () => fuwaDiagnosticKnownUids(fuwaDiagnosticAuthDetail?.user?.uid || "")
};
