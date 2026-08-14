// Fuwa Firebase Authentication + Firestore Backup/Restore + Auto Sync — V46 Optional Login
// Authentication only. Diary content remains in local IndexedDB.

const firebaseConfig = {
  apiKey: "AIzaSyCR6DxhxXCVNds_08vjx_wEpV9ICgZG8xk",
  authDomain: "fuwa-854cd.firebaseapp.com",
  projectId: "fuwa-854cd",
  storageBucket: "fuwa-854cd.firebasestorage.app",
  messagingSenderId: "1011901581076",
  appId: "1:1011901581076:web:1084728c1d56042a9e6401"
};

const FIREBASE_VERSION = "12.16.0";

const $auth = id => document.getElementById(id);

let authApi = null;
let firestoreApi = null;
let auth = null;
let firestore = null;
let authMode = "login";
let authReady = false;
let firestoreCheckPromise = null;
let autoSyncTimer = null;
let autoSyncInFlight = false;
let autoSyncQueued = false;
let suppressAutoSyncUntil = 0;
let startupReconciliationDoneForUid = null;
let startupReconciliationInFlight = false;
let cloudConflictDetected = false;

const FUWA_CLOUD_DEVICE_ID_KEY = "fuwaCloudDeviceIdV1";
const FUWA_CLOUD_BASELINE_KEY = "fuwaCloudBaselineV1";
const FUWA_CLOUD_PENDING_KEY = "fuwaCloudPendingV1";
const FUWA_LOCAL_MODE_KEY = "fuwaLocalModeV1";
let firebaseInitialized = false;

/* FUWA V87 — LOCAL MODE AUTO-SYNC SAFETY */
function stopAutoSync() {
  window.clearTimeout(autoSyncTimer);
  autoSyncTimer = null;
  autoSyncQueued = false;
}

function isLocalModeChosen(){try{return localStorage.getItem(FUWA_LOCAL_MODE_KEY)==="1"}catch(_){return false}}
function setLocalModeChosen(value){try{if(value)localStorage.setItem(FUWA_LOCAL_MODE_KEY,"1");else localStorage.removeItem(FUWA_LOCAL_MODE_KEY)}catch(_){}}


function setPendingCloudSync(pending) {
  try {
    if (pending) localStorage.setItem(FUWA_CLOUD_PENDING_KEY, "1");
    else localStorage.removeItem(FUWA_CLOUD_PENDING_KEY);
  } catch (_) {}
}

function hasPendingCloudSync() {
  try {
    return localStorage.getItem(FUWA_CLOUD_PENDING_KEY) === "1";
  } catch (_) {
    return false;
  }
}

function getCloudDeviceId() {
  let id = localStorage.getItem(FUWA_CLOUD_DEVICE_ID_KEY);
  if (!id) {
    id = (crypto?.randomUUID?.() || `device_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
    localStorage.setItem(FUWA_CLOUD_DEVICE_ID_KEY, id);
  }
  return id;
}

function readCloudBaseline(uid) {
  try {
    const all = JSON.parse(localStorage.getItem(FUWA_CLOUD_BASELINE_KEY) || "{}");
    return all?.[uid] || null;
  } catch (_) {
    return null;
  }
}

function writeCloudBaseline(uid, backup = {}) {
  try {
    const all = JSON.parse(localStorage.getItem(FUWA_CLOUD_BASELINE_KEY) || "{}");
    all[uid] = {
      backupId: backup.backupId || null,
      backedUpAtClient: backup.backedUpAtClient || null,
      sourceDeviceId: backup.sourceDeviceId || null,
      savedAt: Date.now()
    };
    localStorage.setItem(FUWA_CLOUD_BASELINE_KEY, JSON.stringify(all));
  } catch (error) {
    console.warn("Fuwa could not save its cloud baseline.", error);
  }
}

function setAuthBusy(busy) {
  ["loginButton", "signupButton", "forgotPasswordButton", "authSwitchButton", "googleSignInButton", "continueLocalButton"].forEach(id => {
    const control = $auth(id);
    if (control) control.disabled = busy;
  });

  if ($auth("loginButton")) $auth("loginButton").textContent = busy && authMode === "login" ? "Opening Fuwa…" : "Log in";
  if ($auth("signupButton")) $auth("signupButton").textContent = busy && authMode === "signup" ? "Making your cloud…" : "Create account";
}

function showAuthMessage(message, kind = "error") {
  const box = $auth("authMessage");
  if (!box) return;

  box.textContent = message;
  box.classList.remove("hidden", "success");
  box.classList.toggle("success", kind === "success");
}

function clearAuthMessage() {
  const box = $auth("authMessage");
  if (!box) return;
  box.textContent = "";
  box.classList.add("hidden");
  box.classList.remove("success");
}

function friendlyAuthError(error) {
  switch (error?.code) {
    case "auth/invalid-email":
      return "That email address doesn't look quite right.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That email or password didn't match.";
    case "auth/email-already-in-use":
      return "That email already has a Fuwa account. Try logging in instead.";
    case "auth/weak-password":
      return "Choose a password with at least 6 characters.";
    case "auth/too-many-requests":
      return "Too many tries for now. Give it a little while and try again.";
    case "auth/network-request-failed":
      return "Fuwa couldn't reach Firebase. Check your connection and try again.";
    case "auth/user-disabled":
      return "This account is currently disabled.";
    default:
      return "Fuwa couldn't complete that just now. Please try again.";
  }
}

function setAuthMode(mode) {
  authMode = mode === "signup" ? "signup" : "login";
  clearAuthMessage();

  const isSignup = authMode === "signup";
  $auth("loginForm")?.classList.toggle("hidden", isSignup);
  $auth("signupForm")?.classList.toggle("hidden", !isSignup);
  $auth("googleSignInButton")?.classList.toggle("hidden", isSignup);
  $auth("authProviderDivider")?.classList.toggle("hidden", isSignup);
  $auth("authLocalDivider")?.classList.toggle("hidden", isSignup);
  $auth("continueLocalButton")?.classList.toggle("hidden", isSignup);

  if ($auth("authTitle")) $auth("authTitle").textContent = isSignup ? "Make your Fuwa" : "Welcome back to Fuwa";
  if ($auth("authSubtitle")) {
    $auth("authSubtitle").textContent = isSignup
      ? "A quiet little place for moments, feelings, and future you."
      : "Your soft little diary is waiting.";
  }
  if ($auth("authSwitchCopy")) $auth("authSwitchCopy").textContent = isSignup ? "Already have an account?" : "New to Fuwa?";
  if ($auth("authSwitchButton")) $auth("authSwitchButton").textContent = isSignup ? "Log in instead" : "Create an account";

  setTimeout(() => {
    (isSignup ? $auth("signupEmail") : $auth("loginEmail"))?.focus();
  }, 60);
}

function revealLocalMode(){
  document.body.classList.remove("auth-pending","auth-signed-out","auth-signed-in");
  document.body.classList.add("auth-local");
  $auth("fuwaAuthGate")?.classList.add("hidden");
  stopAutoSync();

  document.querySelector(".firebase-account-panel")?.classList.add("local-mode");
  if($auth("firebaseSessionPill"))$auth("firebaseSessionPill").textContent="Local";
  if($auth("firebaseAccountEmail"))$auth("firebaseAccountEmail").textContent="Using Fuwa without an account";
  if($auth("firebaseAccountProviderDrawer"))$auth("firebaseAccountProviderDrawer").textContent="Stored on this device";
  if($auth("firebaseAccountEmailProfile"))$auth("firebaseAccountEmailProfile").textContent="Using Fuwa without an account";
  if($auth("firebaseLocalDataTitle"))$auth("firebaseLocalDataTitle").textContent="Using Fuwa without an account";
  if($auth("firebaseLocalDataCopy"))$auth("firebaseLocalDataCopy").textContent="Your journal is stored on this device. You can log in later without deleting your local journal.";
  $auth("firebaseProfileLoginButton")?.classList.remove("hidden");
  $auth("firebaseProfileSignOutButton")?.classList.add("hidden");
  $auth("cloudBackupCard")?.classList.add("local-hidden");

  window.dispatchEvent(new CustomEvent("fuwa-auth-ready",{detail:{user:null,mode:"local"}}));
}

function prepareSignedInAccountUI(){
  document.querySelector(".firebase-account-panel")?.classList.remove("local-mode");
  if($auth("firebaseSessionPill"))$auth("firebaseSessionPill").textContent="Signed in";
  if($auth("firebaseLocalDataTitle"))$auth("firebaseLocalDataTitle").textContent="Your diary is stored locally first.";
  if($auth("firebaseLocalDataCopy"))$auth("firebaseLocalDataCopy").textContent="Fuwa Cloud can back up your journal text and records. Device-specific appearance stays on this device.";
  $auth("firebaseProfileLoginButton")?.classList.add("hidden");
  $auth("firebaseProfileSignOutButton")?.classList.remove("hidden");
  $auth("cloudBackupCard")?.classList.remove("local-hidden");
}

function revealSignedOut() {
  document.body.classList.remove("auth-pending", "auth-signed-in");
  document.body.classList.add("auth-signed-out");
  $auth("fuwaAuthGate")?.classList.remove("hidden");
}

function revealSignedIn(user) {
  setLocalModeChosen(false);
  prepareSignedInAccountUI();
  document.body.classList.remove("auth-pending", "auth-signed-out", "auth-local");
  document.body.classList.add("auth-signed-in");
  $auth("fuwaAuthGate")?.classList.add("hidden");

  const providerIds = Array.isArray(user?.providerData)
    ? user.providerData.map(item => item?.providerId).filter(Boolean)
    : [];
  const providerLabel = providerIds.includes("google.com")
    ? "Google"
    : providerIds.includes("password")
      ? "Email & password"
      : "Firebase account";

  const accountEmail = user?.email || "Signed-in account";
  if ($auth("firebaseAccountEmail")) $auth("firebaseAccountEmail").textContent = accountEmail;
  if ($auth("firebaseAccountEmailProfile")) $auth("firebaseAccountEmailProfile").textContent = accountEmail;
  if ($auth("firebaseAccountProviderProfile")) $auth("firebaseAccountProviderProfile").textContent = providerLabel;
  if ($auth("firebaseAccountProviderDrawer")) $auth("firebaseAccountProviderDrawer").textContent = `Signed in with ${providerLabel}`;

  window.dispatchEvent(new CustomEvent("fuwa-auth-ready", {
    detail: {
      user: user ? {
        uid: user.uid,
        email: user.email,
        provider: providerLabel,
        providerIds
      } : null
    }
  }));
}


function setCloudConnectionStatus(message, kind = "neutral") {
  const status = $auth("firebaseCloudConnectionStatus");
  if (!status) return;

  status.textContent = message;
  status.dataset.status = kind;
}

async function verifyFirestoreConnection(user) {
  if (!user?.uid || !firestore || !firestoreApi) return false;

  if (firestoreCheckPromise) return firestoreCheckPromise;

  firestoreCheckPromise = (async () => {
    setCloudConnectionStatus("Checking Firestore…", "checking");

    const testRef = firestoreApi.doc(
      firestore,
      "users",
      user.uid,
      "system",
      "connection-test"
    );

    const testPayload = {
      purpose: "fuwa-firestore-connection-test",
      uid: user.uid,
      checkedAt: firestoreApi.serverTimestamp()
    };

    try {
      await firestoreApi.setDoc(testRef, testPayload);
      const snapshot = await firestoreApi.getDoc(testRef);

      if (!snapshot.exists()) {
        throw new Error("Firestore test document could not be read back.");
      }

      await firestoreApi.deleteDoc(testRef);
      setCloudConnectionStatus("Connected ✓", "success");
      setAutoSyncStatus(hasPendingCloudSync() ? "On · finishing sync…" : "On · waiting for changes");
      loadCloudBackupStatus(user);
      reconcileStartupCloudState(user);
      retryPendingCloudSync("resume");

      window.dispatchEvent(new CustomEvent("fuwa-firestore-ready", {
        detail: { uid: user.uid, connected: true }
      }));

      return true;
    } catch (error) {
      console.error("Fuwa Firestore connection check failed.", error);
      setCloudConnectionStatus("Connection failed", "error");

      window.dispatchEvent(new CustomEvent("fuwa-firestore-ready", {
        detail: { uid: user.uid, connected: false, code: error?.code || null }
      }));

      return false;
    } finally {
      firestoreCheckPromise = null;
    }
  })();

  return firestoreCheckPromise;
}

let firebaseAppInstance = null;
let firestoreInitPromise = null;

async function ensureFirestoreReady() {
  if (firestore && firestoreApi) return true;
  if (!firebaseAppInstance) return false;
  if (firestoreInitPromise) return firestoreInitPromise;

  firestoreInitPromise = (async () => {
    try {
      const firestoreModule = await import(
        `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`
      );
      firestore = firestoreModule.getFirestore(firebaseAppInstance);
      firestoreApi = firestoreModule;
      return true;
    } catch (error) {
      console.error("Fuwa Firestore could not initialize.", error);
      setCloudConnectionStatus("Connection failed", "error");
      return false;
    } finally {
      firestoreInitPromise = null;
    }
  })();

  return firestoreInitPromise;
}

async function initializeFirebaseAuth() {
  if (firebaseInitialized) return;
  firebaseInitialized = true;
  try {
    // Load only the modules required to determine the saved login first.
    // Firestore is intentionally deferred until after Home is visible.
    const [appModule, authModule] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`)
    ]);

    firebaseAppInstance = appModule.initializeApp(firebaseConfig);
    auth = authModule.getAuth(firebaseAppInstance);
    authApi = authModule;

    // Firebase Auth web persistence is LOCAL by default. Previous Fuwa versions
    // already explicitly set local persistence, so there is no reason to block
    // startup by copying the persistence state again on every app launch.
    authModule.onAuthStateChanged(auth, user => {
      authReady = true;
      clearAuthMessage();
      setAuthBusy(false);

      if (user) {
        // Reveal Fuwa immediately once Auth knows the saved user.
        revealSignedIn(user);

        // Cloud setup continues in the background and must never block Home.
        setCloudConnectionStatus("Connecting…", "checking");
        window.setTimeout(async () => {
          const ready = await ensureFirestoreReady();
          if (ready) verifyFirestoreConnection(user);
        }, 0);
      } else {
        cloudConflictDetected = false;
        startupReconciliationDoneForUid = null;
        setCloudConnectionStatus("Sign in to connect", "neutral");
        if (isLocalModeChosen()) revealLocalMode();
        else { setAuthMode("login"); revealSignedOut(); }
      }
    }, error => {
      console.error("Fuwa auth-state observer failed.", error);
      showAuthMessage("Fuwa couldn't check your account. Please reload while online.");
      revealSignedOut();
    });
  } catch (error) {
    firebaseInitialized = false;
    console.error("Firebase Authentication could not initialize.", error);
    authReady = false;
    setCloudConnectionStatus("Unavailable", "error");
    revealSignedOut();
    showAuthMessage("Fuwa couldn't reach its login service. Check your internet connection and reload.");
  }
}

function handleContinueLocal(){
  clearAuthMessage();
  setLocalModeChosen(true);
  revealLocalMode();
}

async function handleOpenLoginFromSettings(){
  setLocalModeChosen(false);
  setAuthMode("login");
  revealSignedOut();
  if(!firebaseInitialized) await initializeFirebaseAuth();
}

async function handleLogin(event) {
  event.preventDefault();
  if (!auth || !authApi) {
    showAuthMessage("Fuwa's login service is still loading. Try again in a moment.");
    return;
  }

  const email = $auth("loginEmail")?.value.trim() || "";
  const password = $auth("loginPassword")?.value || "";

  if (!email || !password) {
    showAuthMessage("Enter your email and password first.");
    return;
  }

  clearAuthMessage();
  setAuthBusy(true);

  try {
    await authApi.signInWithEmailAndPassword(auth, email, password);
    if ($auth("loginPassword")) $auth("loginPassword").value = "";
  } catch (error) {
    console.error("Fuwa login failed.", error);
    showAuthMessage(friendlyAuthError(error));
    setAuthBusy(false);
  }
}

async function handleSignup(event) {
  event.preventDefault();
  if (!auth || !authApi) {
    showAuthMessage("Fuwa's login service is still loading. Try again in a moment.");
    return;
  }

  const email = $auth("signupEmail")?.value.trim() || "";
  const password = $auth("signupPassword")?.value || "";
  const confirm = $auth("signupPasswordConfirm")?.value || "";

  if (!email || !password || !confirm) {
    showAuthMessage("Fill in all three fields first.");
    return;
  }

  if (password.length < 6) {
    showAuthMessage("Your password needs at least 6 characters.");
    return;
  }

  if (password !== confirm) {
    showAuthMessage("Those passwords don't match yet.");
    return;
  }

  clearAuthMessage();
  setAuthBusy(true);

  try {
    await authApi.createUserWithEmailAndPassword(auth, email, password);
    if ($auth("signupPassword")) $auth("signupPassword").value = "";
    if ($auth("signupPasswordConfirm")) $auth("signupPasswordConfirm").value = "";
  } catch (error) {
    console.error("Fuwa signup failed.", error);
    showAuthMessage(friendlyAuthError(error));
    setAuthBusy(false);
  }
}

async function handleForgotPassword() {
  if (!auth || !authApi) {
    showAuthMessage("Fuwa's login service is still loading. Try again in a moment.");
    return;
  }

  const email = $auth("loginEmail")?.value.trim() || "";
  if (!email) {
    showAuthMessage("Type your email above first, then tap Forgot password.");
    $auth("loginEmail")?.focus();
    return;
  }

  clearAuthMessage();
  setAuthBusy(true);

  try {
    await authApi.sendPasswordResetEmail(auth, email);
    showAuthMessage("Password reset email sent. Check your inbox. ☁️", "success");
  } catch (error) {
    console.error("Password reset failed.", error);
    showAuthMessage(friendlyAuthError(error));
  } finally {
    setAuthBusy(false);
  }
}

async function handleGoogleSignIn() {
  if (!auth || !authApi) {
    showAuthMessage("Fuwa's login service is still loading. Try again in a moment.");
    return;
  }

  clearAuthMessage();
  setAuthBusy(true);

  try {
    const provider = new authApi.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await authApi.signInWithPopup(auth, provider);
  } catch (error) {
    console.error("Fuwa Google sign-in failed.", error);

    if (error?.code === "auth/popup-closed-by-user") {
      showAuthMessage("Google sign-in was closed before it finished.");
    } else if (error?.code === "auth/popup-blocked") {
      showAuthMessage("Your browser blocked the Google sign-in window. Allow pop-ups for Fuwa and try again.");
    } else if (error?.code === "auth/cancelled-popup-request") {
      // A second rapid tap can cancel the first popup. No extra warning needed.
    } else if (error?.code === "auth/account-exists-with-different-credential") {
      showAuthMessage("That email already has a Fuwa account using another sign-in method.");
    } else {
      showAuthMessage(friendlyAuthError(error));
    }
  } finally {
    setAuthBusy(false);
  }
}



function setAutoSyncStatus(message) {
  const el = $auth("cloudAutoSyncStatus");
  if (el) el.textContent = message;
}

function formatAutoSyncClock(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

async function performAutomaticCloudSync() {
  const user = auth?.currentUser;

  if (!navigator.onLine) {
    setPendingCloudSync(true);
    setAutoSyncStatus("Offline · changes safe on device");
    return false;
  }

  if (!user?.uid || !firestore || !firestoreApi) {
    setAutoSyncStatus("On · waiting for cloud");
    return false;
  }

  if (Date.now() < suppressAutoSyncUntil) return false;

  if (autoSyncInFlight) {
    autoSyncQueued = true;
    return false;
  }

  if (typeof window.fuwaCreateCloudBackupPayload !== "function") {
    setAutoSyncStatus("On · preparing local data");
    return false;
  }

  autoSyncInFlight = true;
  autoSyncQueued = false;
  setAutoSyncStatus("Syncing…");

  try {
    const payload = await window.fuwaCreateCloudBackupPayload();
    if (!payload || payload.app !== "Fuwa" || !payload.data) {
      throw new Error("invalid-auto-sync-payload");
    }

    const backupRef = firestoreApi.doc(firestore, "users", user.uid, "backups", "current");
    const remoteSnapshot = await firestoreApi.getDoc(backupRef);
    const remote = remoteSnapshot.exists() ? remoteSnapshot.data() : null;
    const baseline = readCloudBaseline(user.uid);
    const thisDeviceId = getCloudDeviceId();

    // If another device changed the cloud since this device last saw it,
    // pause automatic sync rather than silently overwriting newer cloud data.
    if (
      remote
      && baseline?.backupId
      && remote.backupId
      && remote.backupId !== baseline.backupId
      && remote.sourceDeviceId
      && remote.sourceDeviceId !== thisDeviceId
    ) {
      cloudConflictDetected = true;
      setAutoSyncStatus("Paused · newer cloud copy found");
      throw new Error("cloud-conflict");
    }

    const serialized = JSON.stringify(payload);
    const approximateBytes = new TextEncoder().encode(serialized).byteLength;
    if (approximateBytes > 900000) {
      throw new Error("cloud-backup-too-large");
    }

    const cloudDocument = {
      ...payload,
      ownerUid: user.uid,
      sourceDeviceId: thisDeviceId,
      backedUpAt: firestoreApi.serverTimestamp(),
      backedUpAtClient: new Date().toISOString(),
      approximateBytes,
      syncReason: "automatic-local-change"
    };

    await firestoreApi.setDoc(backupRef, cloudDocument);
    writeCloudBaseline(user.uid, cloudDocument);
    cloudConflictDetected = false;
    setPendingCloudSync(false);

    setCloudBackupUI({
      busy: false,
      status: "Backed up ✓",
      lastBackup: cloudDocument.backedUpAtClient,
      recordCount: Number(payload.recordCount || 0)
    });
    setAutoSyncStatus(`On · synced ${formatAutoSyncClock()}`);

    return true;
  } catch (error) {
    console.error("Fuwa automatic cloud sync failed.", error);
    setAutoSyncStatus(
      error?.message === "cloud-conflict"
        ? "Paused · newer cloud copy found"
        : error?.message === "cloud-backup-too-large"
          ? "On · manual backup needed"
          : "On · will retry"
    );
    return false;
  } finally {
    autoSyncInFlight = false;

    if (autoSyncQueued) {
      autoSyncQueued = false;
      window.setTimeout(() => performAutomaticCloudSync(), 700);
    }
  }
}

function scheduleAutomaticCloudSync() {
  // Local-only mode must never start cloud timers. Once a user signs in,
  // auth.currentUser becomes available and normal automatic backup resumes.
  if (isLocalModeChosen() || !auth?.currentUser?.uid) return;
  if (Date.now() < suppressAutoSyncUntil) return;

  setPendingCloudSync(true);
  window.clearTimeout(autoSyncTimer);

  if (!navigator.onLine) {
    setAutoSyncStatus("Offline · changes safe on device");
    return;
  }

  setAutoSyncStatus("On · changes waiting");
  autoSyncTimer = window.setTimeout(() => {
    performAutomaticCloudSync();
  }, 1200);
}

window.addEventListener("fuwa-local-data-changed", event => {
  if (event?.detail?.source !== "local") return;
  scheduleAutomaticCloudSync();
});

function formatCloudBackupTime(value) {
  if (!value) return "No cloud backup yet";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "Cloud backup available";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function setCloudBackupUI({ busy = false, status = "Ready", lastBackup = null, recordCount = null } = {}) {
  const button = $auth("cloudBackupNowButton");
  const badge = $auth("cloudBackupBadge");
  const lastTime = $auth("cloudBackupLastTime");
  const count = $auth("cloudBackupRecordCount");

  if (button) {
    button.disabled = busy;
    button.textContent = busy ? "Backing up safely…" : "Back up to Fuwa Cloud";
  }
  if (badge) badge.textContent = status;
  if (lastTime && lastBackup !== undefined) lastTime.textContent = formatCloudBackupTime(lastBackup);
  if (count && recordCount !== undefined && recordCount !== null) {
    count.textContent = `${recordCount} record${recordCount === 1 ? "" : "s"}`;
  }
}


async function reconcileStartupCloudState(user = auth?.currentUser) {
  if (!user?.uid || !firestore || !firestoreApi) return;
  if (startupReconciliationInFlight || startupReconciliationDoneForUid === user.uid) return;

  startupReconciliationInFlight = true;
  setAutoSyncStatus("On · checking cloud…");

  try {
    const backupRef = firestoreApi.doc(firestore, "users", user.uid, "backups", "current");
    const snapshot = await firestoreApi.getDoc(backupRef);

    if (!snapshot.exists()) {
      startupReconciliationDoneForUid = user.uid;
      setAutoSyncStatus("On · waiting for changes");
      return;
    }

    const cloud = snapshot.data() || {};
    const cloudCount = Number(cloud.recordCount || 0);
    const local = typeof window.fuwaGetLocalCloudSummary === "function"
      ? await window.fuwaGetLocalCloudSummary()
      : { recordCount: 0, hasJournalData: false, latestModifiedAt: 0 };

    const baseline = readCloudBaseline(user.uid);
    const thisDeviceId = getCloudDeviceId();
    const changedSinceLastSeen = Boolean(
      baseline?.backupId
      && cloud.backupId
      && baseline.backupId !== cloud.backupId
    );
    const fromAnotherDevice = Boolean(
      cloud.sourceDeviceId
      && cloud.sourceDeviceId !== thisDeviceId
    );

    if (!local.hasJournalData && cloudCount > 0) {
      cloudConflictDetected = false;
      setAutoSyncStatus("Cloud backup found · restore available");
      setCloudBackupUI({
        busy: false,
        status: "Cloud copy found",
        lastBackup: cloud.backedUpAt || cloud.backedUpAtClient || cloud.createdAt,
        recordCount: cloudCount
      });
    } else if (changedSinceLastSeen && fromAnotherDevice && local.hasJournalData) {
      cloudConflictDetected = true;
      setAutoSyncStatus("Paused · newer cloud copy found");
      setCloudBackupUI({
        busy: false,
        status: "Review cloud copy",
        lastBackup: cloud.backedUpAt || cloud.backedUpAtClient || cloud.createdAt,
        recordCount: cloudCount
      });
    } else {
      cloudConflictDetected = false;
      setAutoSyncStatus("On · local data protected");
      writeCloudBaseline(user.uid, cloud);
    }

    startupReconciliationDoneForUid = user.uid;
  } catch (error) {
    console.error("Fuwa startup reconciliation failed.", error);
    setAutoSyncStatus("On · cloud check will retry");
  } finally {
    startupReconciliationInFlight = false;
  }
}

async function loadCloudBackupStatus(user = auth?.currentUser) {
  if (!user?.uid || !firestore || !firestoreApi) return;

  try {
    const backupRef = firestoreApi.doc(firestore, "users", user.uid, "backups", "current");
    const snapshot = await firestoreApi.getDoc(backupRef);

    if (!snapshot.exists()) {
      setCloudBackupUI({ status: "Ready", lastBackup: null });
      return;
    }

    const backup = snapshot.data();
    setCloudBackupUI({
      status: "Backed up",
      lastBackup: backup.backedUpAt || backup.backedUpAtClient || null,
      recordCount: Number(backup.recordCount || 0)
    });
  } catch (error) {
    console.error("Fuwa could not read cloud backup status.", error);
    setCloudBackupUI({ status: "Check failed" });
  }
}

async function handleCloudBackupRequest(event) {
  event?.preventDefault?.();

  const user = auth?.currentUser;
  if (!user?.uid) {
    window.alert("Sign in to Fuwa first.");
    return;
  }

  if (!firestore || !firestoreApi) {
    setCloudConnectionStatus("Connecting…", "checking");
    const ready = await ensureFirestoreReady();
    if (!ready) {
      window.alert("Fuwa's cloud connection is not ready yet. Check your internet connection and try again.");
      return;
    }
  }

  if (typeof window.fuwaCreateCloudBackupPayload !== "function") {
    window.alert("Fuwa is still preparing your local diary. Try again in a moment.");
    return;
  }

  setCloudBackupUI({ busy: true, status: "Backing up…" });

  try {
    const payload = await window.fuwaCreateCloudBackupPayload();

    if (!payload || payload.app !== "Fuwa" || !payload.data) {
      throw new Error("Fuwa produced an invalid cloud backup payload.");
    }

    const backupRef = firestoreApi.doc(firestore, "users", user.uid, "backups", "current");
    const currentCloudSnapshot = await firestoreApi.getDoc(backupRef);
    const currentCloud = currentCloudSnapshot.exists() ? currentCloudSnapshot.data() : null;
    const baseline = readCloudBaseline(user.uid);
    const thisDeviceId = getCloudDeviceId();

    const cloudChangedElsewhere = Boolean(
      currentCloud
      && baseline?.backupId
      && currentCloud.backupId
      && currentCloud.backupId !== baseline.backupId
      && currentCloud.sourceDeviceId
      && currentCloud.sourceDeviceId !== thisDeviceId
    );

    if (cloudChangedElsewhere) {
      const overwrite = window.confirm(
        "A newer Fuwa cloud copy was saved from another device. Backing up now will replace that cloud copy with this device's diary. Continue?"
      );
      if (!overwrite) {
        setCloudBackupUI({ busy: false, status: "Cloud copy kept" });
        setAutoSyncStatus("Paused · newer cloud copy found");
        return;
      }
    }

    // Firestore documents have a strict size limit. This first cloud-backup
    // milestone intentionally excludes photo blobs and refuses oversized data.
    const serialized = JSON.stringify(payload);
    const approximateBytes = new TextEncoder().encode(serialized).byteLength;
    const safeDocumentLimit = 900000;
    if (approximateBytes > safeDocumentLimit) {
      throw new Error("cloud-backup-too-large");
    }

    const cloudDocument = {
      ...payload,
      ownerUid: user.uid,
      sourceDeviceId: thisDeviceId,
      backedUpAt: firestoreApi.serverTimestamp(),
      backedUpAtClient: new Date().toISOString(),
      approximateBytes
    };

    await firestoreApi.setDoc(backupRef, cloudDocument);

    const verify = await firestoreApi.getDoc(backupRef);
    if (!verify.exists()) throw new Error("Cloud backup could not be verified.");

    const verified = verify.data();
    if (verified.ownerUid !== user.uid || verified.backupId !== payload.backupId) {
      throw new Error("Cloud backup verification did not match this device backup.");
    }

    writeCloudBaseline(user.uid, verified);
    cloudConflictDetected = false;
    setPendingCloudSync(false);

    setCloudBackupUI({
      busy: false,
      status: "Backed up ✓",
      lastBackup: verified.backedUpAt || verified.backedUpAtClient,
      recordCount: Number(verified.recordCount || payload.recordCount || 0)
    });
    setAutoSyncStatus(`On · synced ${formatAutoSyncClock()}`);

    window.dispatchEvent(new CustomEvent("fuwa-cloud-backup-complete", {
      detail: {
        backupId: payload.backupId,
        recordCount: payload.recordCount,
        approximateBytes
      }
    }));
  } catch (error) {
    console.error("Fuwa cloud backup failed.", error);
    const message = error?.message === "cloud-backup-too-large"
      ? "This Fuwa backup has grown too large for the safe first cloud-backup format. Nothing was changed in the cloud."
      : "Fuwa couldn't finish the cloud backup. Your diary on this device is unchanged.";
    setCloudBackupUI({ busy: false, status: "Backup failed" });
    window.alert(message);
  }
}


function closeCloudRestoreModal() {
  $auth("cloudRestoreModal")?.classList.add("hidden");
}

async function getVerifiedCloudBackup(user = auth?.currentUser) {
  if (!user?.uid) throw new Error("cloud-not-ready");

  if (!firestore || !firestoreApi) {
    const ready = await ensureFirestoreReady();
    if (!ready) throw new Error("cloud-not-ready");
  }

  const backupRef = firestoreApi.doc(firestore, "users", user.uid, "backups", "current");
  const snapshot = await firestoreApi.getDoc(backupRef);
  if (!snapshot.exists()) throw new Error("no-cloud-backup");

  const backup = snapshot.data();
  if (
    backup?.ownerUid !== user.uid
    || backup?.app !== "Fuwa"
    || backup?.backupFormat !== "fuwa-cloud-v1"
    || !backup?.data
  ) {
    throw new Error("invalid-cloud-backup");
  }

  return backup;
}

async function openCloudRestoreModal() {
  const modal = $auth("cloudRestoreModal");
  if (!modal) return;

  modal.classList.remove("hidden");
  if ($auth("cloudRestoreSummary")) $auth("cloudRestoreSummary").textContent = "Checking your cloud backup…";
  if ($auth("cloudRestoreDate")) $auth("cloudRestoreDate").textContent = "Checking…";
  if ($auth("cloudRestoreRecords")) $auth("cloudRestoreRecords").textContent = "Checking…";
  if ($auth("cloudRestoreConfirmButton")) $auth("cloudRestoreConfirmButton").disabled = true;

  try {
    const backup = await getVerifiedCloudBackup();
    modal.dataset.backupId = backup.backupId || "";
    if ($auth("cloudRestoreSummary")) {
      $auth("cloudRestoreSummary").textContent = "Fuwa found a valid backup for this signed-in account.";
    }
    if ($auth("cloudRestoreDate")) {
      $auth("cloudRestoreDate").textContent = formatCloudBackupTime(backup.backedUpAt || backup.backedUpAtClient);
    }
    if ($auth("cloudRestoreRecords")) {
      const count = Number(backup.recordCount || 0);
      $auth("cloudRestoreRecords").textContent = `${count} record${count === 1 ? "" : "s"}`;
    }
    if ($auth("cloudRestoreConfirmButton")) $auth("cloudRestoreConfirmButton").disabled = false;
  } catch (error) {
    console.error("Fuwa could not prepare cloud restore.", error);
    const noBackup = error?.message === "no-cloud-backup";
    if ($auth("cloudRestoreSummary")) {
      $auth("cloudRestoreSummary").textContent = noBackup
        ? "There isn't a Fuwa cloud backup for this account yet."
        : "Fuwa couldn't verify this cloud backup. Nothing on your device was changed.";
    }
    if ($auth("cloudRestoreDate")) $auth("cloudRestoreDate").textContent = "Unavailable";
    if ($auth("cloudRestoreRecords")) $auth("cloudRestoreRecords").textContent = "—";
  }
}

async function handleCloudRestoreConfirm() {
  const button = $auth("cloudRestoreConfirmButton");
  const cancel = $auth("cloudRestoreCancelButton");
  if (button?.disabled) return;

  if (button) {
    button.disabled = true;
    button.textContent = "Protecting this device…";
  }
  if (cancel) cancel.disabled = true;

  try {
    // Re-read immediately before restore instead of trusting stale modal data.
    const backup = await getVerifiedCloudBackup();

    if (typeof window.fuwaCreateRestoreSafetyBackup !== "function"
      || typeof window.fuwaApplyCloudRestorePayload !== "function") {
      throw new Error("restore-engine-not-ready");
    }

    const safetyBackup = await window.fuwaCreateRestoreSafetyBackup();
    suppressAutoSyncUntil = Date.now() + 5000;

    if (button) button.textContent = "Restoring & verifying…";

    const result = await window.fuwaApplyCloudRestorePayload(backup);
    if (!result?.ok) throw new Error("restore-verification-failed");

    writeCloudBaseline(auth.currentUser.uid, backup);
    cloudConflictDetected = false;
    setPendingCloudSync(false);
    startupReconciliationDoneForUid = auth.currentUser.uid;

    closeCloudRestoreModal();

    // The in-memory safety snapshot already protected this restore attempt.
    // Do not auto-download it after success; on iPhone that opens a JSON preview
    // and interrupts the Fuwa experience. Users can still export a local backup
    // manually from Me whenever they want a file copy.
    window.alert(`Fuwa restored ${result.recordCount} cloud records successfully. ☁️`);
    window.setTimeout(() => window.location.reload(), 250);
  } catch (error) {
    console.error("Fuwa cloud restore failed.", error?.name || "Error", error?.message || error);
    window.alert("Fuwa couldn't complete the restore. Your existing device data was kept as safely as possible. Please don't clear Fuwa data.");
    if (button) {
      button.disabled = false;
      button.textContent = "Restore safely";
    }
    if (cancel) cancel.disabled = false;
  }
}

async function handleSignOut(){
  const confirmed=window.confirm("Log out of your Fuwa account on this device? Your local journal will stay here.");
  if(!confirmed)return;
  try{
    stopAutoSync();
    setLocalModeChosen(true);
    if(auth&&authApi)await authApi.signOut(auth);
    revealLocalMode();
  }catch(error){
    console.error("Fuwa sign-out failed.",error);
    window.alert("Fuwa couldn't log out just now. Please try again.");
  }
}

function retryPendingCloudSync(reason = "resume") {
  if (!hasPendingCloudSync()) return;
  if (!navigator.onLine) {
    setAutoSyncStatus("Offline · changes safe on device");
    return;
  }
  if (cloudConflictDetected) {
    setAutoSyncStatus("Paused · newer cloud copy found");
    return;
  }

  window.clearTimeout(autoSyncTimer);
  setAutoSyncStatus(reason === "online" ? "Back online · syncing…" : "On · finishing sync…");
  autoSyncTimer = window.setTimeout(() => performAutomaticCloudSync(), 450);
}

window.addEventListener("online", () => retryPendingCloudSync("online"));
window.addEventListener("offline", () => {
  if (hasPendingCloudSync()) setAutoSyncStatus("Offline · changes safe on device");
  else setAutoSyncStatus("Offline · local mode");
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") retryPendingCloudSync("resume");
});

// iOS PWAs can be restored from a suspended state without a normal reload.
window.addEventListener("pageshow", () => retryPendingCloudSync("resume"));

function bindAuthUI() {
  $auth("loginForm")?.addEventListener("submit", handleLogin);
  $auth("signupForm")?.addEventListener("submit", handleSignup);
  $auth("forgotPasswordButton")?.addEventListener("click", handleForgotPassword);
  $auth("googleSignInButton")?.addEventListener("click", handleGoogleSignIn);
  $auth("continueLocalButton")?.addEventListener("click", handleContinueLocal);
  $auth("firebaseProfileLoginButton")?.addEventListener("click", handleOpenLoginFromSettings);
  $auth("firebaseSignOutButton")?.addEventListener("click", handleSignOut);
  $auth("firebaseProfileSignOutButton")?.addEventListener("click", handleSignOut);
  $auth("cloudBackupNowButton")?.addEventListener("click", handleCloudBackupRequest);
  $auth("cloudRestoreButton")?.addEventListener("click", openCloudRestoreModal);
  $auth("cloudRestoreCancelButton")?.addEventListener("click", closeCloudRestoreModal);
  $auth("cloudRestoreConfirmButton")?.addEventListener("click", handleCloudRestoreConfirm);
  $auth("cloudRestoreModal")?.addEventListener("click", event => {
    if (event.target === $auth("cloudRestoreModal")) closeCloudRestoreModal();
  });

  $auth("authSwitchButton")?.addEventListener("click", () => {
    setAuthMode(authMode === "login" ? "signup" : "login");
  });
}

bindAuthUI();
if(isLocalModeChosen()) revealLocalMode();
else initializeFirebaseAuth();