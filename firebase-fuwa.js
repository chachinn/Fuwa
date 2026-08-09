// Fuwa Firebase Authentication + Firestore Backup/Restore — V31
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

function setAuthBusy(busy) {
  ["loginButton", "signupButton", "forgotPasswordButton", "authSwitchButton", "googleSignInButton"].forEach(id => {
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

function revealSignedOut() {
  document.body.classList.remove("auth-pending", "auth-signed-in");
  document.body.classList.add("auth-signed-out");
  $auth("fuwaAuthGate")?.classList.remove("hidden");
}

function revealSignedIn(user) {
  document.body.classList.remove("auth-pending", "auth-signed-out");
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
      loadCloudBackupStatus(user);

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

async function initializeFirebaseAuth() {
  try {
    const [appModule, authModule, firestoreModule] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`)
    ]);

    const firebaseApp = appModule.initializeApp(firebaseConfig);
    auth = authModule.getAuth(firebaseApp);
    firestore = firestoreModule.getFirestore(firebaseApp);
    authApi = authModule;
    firestoreApi = firestoreModule;

    // Be explicit: keep the user signed in across Safari/PWA reopenings.
    await authModule.setPersistence(auth, authModule.browserLocalPersistence);

    authModule.onAuthStateChanged(auth, user => {
      authReady = true;
      clearAuthMessage();
      setAuthBusy(false);

      if (user) {
        revealSignedIn(user);
        verifyFirestoreConnection(user);
      } else {
        setCloudConnectionStatus("Sign in to connect", "neutral");
        setAuthMode("login");
        revealSignedOut();
      }
    }, error => {
      console.error("Fuwa auth-state observer failed.", error);
      showAuthMessage("Fuwa couldn't check your account. Please reload while online.");
      revealSignedOut();
    });
  } catch (error) {
    console.error("Firebase Authentication could not initialize.", error);
    authReady = false;
    setCloudConnectionStatus("Unavailable", "error");
    revealSignedOut();
    showAuthMessage("Fuwa couldn't reach its login service. Check your internet connection and reload.");
  }
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
  if (!user?.uid || !firestore || !firestoreApi) {
    window.alert("Fuwa's cloud connection is not ready yet. Check your internet connection and try again.");
    return;
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

    // Firestore documents have a strict size limit. This first cloud-backup
    // milestone intentionally excludes photo blobs and refuses oversized data.
    const serialized = JSON.stringify(payload);
    const approximateBytes = new TextEncoder().encode(serialized).byteLength;
    const safeDocumentLimit = 900000;
    if (approximateBytes > safeDocumentLimit) {
      throw new Error("cloud-backup-too-large");
    }

    const backupRef = firestoreApi.doc(firestore, "users", user.uid, "backups", "current");
    const cloudDocument = {
      ...payload,
      ownerUid: user.uid,
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

    setCloudBackupUI({
      busy: false,
      status: "Backed up ✓",
      lastBackup: verified.backedUpAt || verified.backedUpAtClient,
      recordCount: Number(verified.recordCount || payload.recordCount || 0)
    });

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
  if (!user?.uid || !firestore || !firestoreApi) {
    throw new Error("cloud-not-ready");
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

    if (button) button.textContent = "Restoring & verifying…";

    const result = await window.fuwaApplyCloudRestorePayload(backup);
    if (!result?.ok) throw new Error("restore-verification-failed");

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

async function handleSignOut() {
  if (!auth || !authApi) return;

  const confirmed = window.confirm("Log out of Fuwa on this device?");
  if (!confirmed) return;

  try {
    await authApi.signOut(auth);
  } catch (error) {
    console.error("Fuwa sign-out failed.", error);
    window.alert("Fuwa couldn't log out just now. Please try again.");
  }
}

function bindAuthUI() {
  $auth("loginForm")?.addEventListener("submit", handleLogin);
  $auth("signupForm")?.addEventListener("submit", handleSignup);
  $auth("forgotPasswordButton")?.addEventListener("click", handleForgotPassword);
  $auth("googleSignInButton")?.addEventListener("click", handleGoogleSignIn);
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
initializeFirebaseAuth();