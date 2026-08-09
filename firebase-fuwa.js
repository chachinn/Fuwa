// Fuwa Firebase Authentication — V24
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
let auth = null;
let authMode = "login";
let authReady = false;

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

  const accountEmail = $auth("firebaseAccountEmail");
  if (accountEmail) accountEmail.textContent = user?.email || "Signed-in account";

  window.dispatchEvent(new CustomEvent("fuwa-auth-ready", {
    detail: { user: user ? { uid: user.uid, email: user.email } : null }
  }));
}

async function initializeFirebaseAuth() {
  try {
    const [appModule, authModule] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`)
    ]);

    const firebaseApp = appModule.initializeApp(firebaseConfig);
    auth = authModule.getAuth(firebaseApp);
    authApi = authModule;

    // Be explicit: keep the user signed in across Safari/PWA reopenings.
    await authModule.setPersistence(auth, authModule.browserLocalPersistence);

    authModule.onAuthStateChanged(auth, user => {
      authReady = true;
      clearAuthMessage();
      setAuthBusy(false);

      if (user) {
        revealSignedIn(user);
      } else {
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

  $auth("authSwitchButton")?.addEventListener("click", () => {
    setAuthMode(authMode === "login" ? "signup" : "login");
  });
}

bindAuthUI();
initializeFirebaseAuth();