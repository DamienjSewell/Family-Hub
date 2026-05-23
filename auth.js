// ============================================================
//  FAMILY HUB — Auth
//  Simple email + password auth stored in JSONBin.
//  Passwords are hashed with a basic digest before storage.
//  For a family app this is practical; not bank-level security.
// ============================================================

const Auth = (() => {

  // Simple hash — converts a password string to a hex digest
  async function hashPassword(password) {
    const msgBuffer = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Session stored in localStorage — just the user's email + name
  function getSession() {
    try {
      const s = localStorage.getItem("familyhub-session");
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  }

  function setSession(user) {
    localStorage.setItem("familyhub-session", JSON.stringify({
      email: user.email,
      name: user.name,
      colorIdx: user.colorIdx,
    }));
  }

  function clearSession() {
    localStorage.removeItem("familyhub-session");
  }

  // Register a new user — adds them to the shared users list
  async function register(name, email, password, state, saveData) {
    email = email.trim().toLowerCase();
    name = name.trim();
    if (!name || !email || !password) return { ok: false, error: "Please fill in all fields." };
    if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
    if (!email.includes("@")) return { ok: false, error: "Please enter a valid email address." };
    if (state.users && state.users.find((u) => u.email === email)) {
      return { ok: false, error: "An account with that email already exists." };
    }
    const hash = await hashPassword(password);
    const colorIdx = (state.users || []).length % 8;
    const newUser = { email, name, hash, colorIdx };
    if (!state.users) state.users = [];
    state.users.push(newUser);
    // Also add to members list for backwards compat
    if (!state.members) state.members = [];
    if (!state.members.find((m) => m.name === name)) {
      state.members.push({ name, colorIdx });
    }
    await saveData();
    setSession(newUser);
    return { ok: true, user: newUser };
  }

  // Login — check email + password against stored users
  async function login(email, password, state) {
    email = email.trim().toLowerCase();
    if (!state.users) return { ok: false, error: "No accounts found. Please register first." };
    const user = state.users.find((u) => u.email === email);
    if (!user) return { ok: false, error: "No account found with that email." };
    const hash = await hashPassword(password);
    if (hash !== user.hash) return { ok: false, error: "Incorrect password." };
    setSession(user);
    return { ok: true, user };
  }

  function logout() {
    clearSession();
  }

  return { register, login, logout, getSession, setSession };
})();
