// ============================================================
//  FAMILY HUB — App v4
//  Added: edit existing events (single occurrence or all)
//  All existing event fields unchanged — fully backwards compatible
// ============================================================

const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${CONFIG.JSONBIN_BIN_ID}`;
const JSONBIN_HEADERS = {
  "Content-Type": "application/json",
  "X-Master-Key": CONFIG.JSONBIN_API_KEY,
  "X-Bin-Versioning": "false",
};

const MEMBER_COLORS = [
  { bg: "#EEEDFE", text: "#534AB7" },
  { bg: "#E1F5EE", text: "#0F6E56" },
  { bg: "#FAECE7", text: "#993C1D" },
  { bg: "#FAEEDA", text: "#854F0B" },
  { bg: "#E6F1FB", text: "#185FA5" },
  { bg: "#FBEAF0", text: "#993556" },
  { bg: "#EAF3DE", text: "#3B6D11" },
  { bg: "#dbeafe", text: "#1e40af" },
];

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS = ["Su","Mo","Tu","We","Th","Fr","Sa"];
const REMINDER_OPTIONS = [
  { label: "At the time", minutes: 0 },
  { label: "5 minutes before", minutes: 5 },
  { label: "15 minutes before", minutes: 15 },
  { label: "30 minutes before", minutes: 30 },
  { label: "1 hour before", minutes: 60 },
  { label: "2 hours before", minutes: 120 },
  { label: "1 day before", minutes: 1440 },
];

// NEW: recurring options
const RECUR_OPTIONS = [
  { label: "Does not repeat", value: "none" },
  { label: "Weekly", value: "weekly" },
  { label: "Fortnightly", value: "fortnightly" },
];

let state = { events: [], todos: [], members: [], users: [] };
let currentUser = null;
let curYear, curMonth;
let saveTimeout = null;
let activeTab = "cal";

// Edit state — null when adding, populated when editing
let editingEventId = null;      // id of the event being edited
let editingOccurrenceDate = null; // date of the specific occurrence (for recurring)

// ── Data layer ────────────────────────────────────────────────

async function loadData() {
  try {
    const res = await fetch(JSONBIN_URL + "/latest", { headers: JSONBIN_HEADERS });
    if (!res.ok) throw new Error("Load failed");
    const json = await res.json();
    state = json.record || {};
  } catch (e) {
    console.warn("Could not load data:", e);
    state = {};
  }
  if (!state.events) state.events = [];
  if (!state.todos) state.todos = [];
  if (!state.members) state.members = [];
  if (!state.users) state.users = [];

  const session = Auth.getSession();
  if (session && state.users.find((u) => u.email === session.email)) {
    currentUser = session;
  }

  const now = new Date();
  curYear = now.getFullYear();
  curMonth = now.getMonth();

  render();
  if (currentUser) checkReminders();
}

async function saveData() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      await fetch(JSONBIN_URL, {
        method: "PUT",
        headers: JSONBIN_HEADERS,
        body: JSON.stringify(state),
      });
      updateSyncBadge("☁️ Saved");
      setTimeout(() => updateSyncBadge("☁️ Shared"), 2000);
    } catch (e) {
      console.warn("Save failed:", e);
    }
  }, 500);
}

function updateSyncBadge(text) {
  const b = document.getElementById("sync-badge");
  if (b) b.textContent = text;
}

setInterval(async () => {
  if (!currentUser) return;
  try {
    const res = await fetch(JSONBIN_URL + "/latest", { headers: JSONBIN_HEADERS });
    if (!res.ok) return;
    const json = await res.json();
    if (JSON.stringify(json.record) !== JSON.stringify(state)) {
      state = json.record;
      if (!state.events) state.events = [];
      if (!state.todos) state.todos = [];
      if (!state.users) state.users = [];
      rerenderCurrentPanel();
    }
  } catch (e) {}
}, 30000);

// ── Recurring events ──────────────────────────────────────────
//
// Recurring events are stored ONCE in state.events with extra fields:
//   recurring: "weekly" | "fortnightly" | "none"
//   recurringEnd: "YYYY-MM-DD"  (last date to generate occurrences up to)
//
// When rendering, expandRecurringEvents() generates virtual occurrence
// objects on the fly for display. These are never saved to JSONBin —
// only the original "template" event is stored.
//
// Each virtual occurrence carries the original event's id plus an
// occurrenceDate so the calendar can display it correctly.

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  // Use local date parts to avoid UTC timezone shift (important for AU timezones)
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function expandRecurringEvents(events, fromDate, toDate) {
  const result = [];

  events.forEach((ev) => {
    // Non-recurring: include as-is if within range
    if (!ev.recurring || ev.recurring === "none") {
      if (ev.date >= fromDate && ev.date <= toDate) result.push(ev);
      return;
    }

    const intervalDays = ev.recurring === "weekly" ? 7 : 14;
    const endDate = ev.recurringEnd || addDays(ev.date, 365); // default 1 year if no end set
    let current = ev.date;

    while (current <= endDate && current <= toDate) {
      if (current >= fromDate) {
        // Create a virtual occurrence — same as original but with occurrenceDate
        result.push({ ...ev, date: current, isOccurrence: true });
      }
      current = addDays(current, intervalDays);
    }
  });

  return result;
}

// Get all events visible to the current user, expanded for a given month
function getExpandedEventsForMonth(year, month) {
  const fromDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const toDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const myEvents = state.events.filter((e) =>
    e.doer === currentUser.name ||
    (e.seers && e.seers.includes(currentUser.name))
  );

  return expandRecurringEvents(myEvents, fromDate, toDate);
}

// Get upcoming expanded events from today onwards (for the list below the calendar)
function getExpandedUpcoming() {
  const today = todayStr();
  // Look ahead 6 months
  const future = addDays(today, 180);

  const myEvents = state.events.filter((e) =>
    e.doer === currentUser.name ||
    (e.seers && e.seers.includes(currentUser.name))
  );

  return expandRecurringEvents(myEvents, today, future)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || "").localeCompare(b.startTime || ""));
}

// ── Reminders ─────────────────────────────────────────────────

function checkReminders() {
  if (!currentUser) return;
  const now = new Date();
  const upcoming = [];

  // Use expanded events for reminder checking (covers recurring occurrences)
  const today = todayStr();
  const future = addDays(today, 2);
  const myEvents = state.events.filter((e) =>
    e.doer === currentUser.name || (e.seers && e.seers.includes(currentUser.name))
  );
  const expanded = expandRecurringEvents(myEvents, today, future);

  expanded.forEach((ev) => {
    if (!ev.reminder || ev.reminder === "none") return;
    if (!ev.startTime) return;

    const [year, month, day] = ev.date.split("-").map(Number);
    const [hour, min] = ev.startTime.split(":").map(Number);
    const eventDt = new Date(year, month - 1, day, hour, min);
    const reminderDt = new Date(eventDt.getTime() - ev.reminder * 60000);
    const diffMins = (eventDt - now) / 60000;

    if (diffMins > 0 && now >= reminderDt) {
      upcoming.push({ ev, diffMins: Math.round(diffMins) });
    }
  });

  if (upcoming.length > 0) showReminderBanner(upcoming);
}

function showReminderBanner(items) {
  const existing = document.getElementById("reminder-banner");
  if (existing) existing.remove();

  const banner = document.createElement("div");
  banner.id = "reminder-banner";
  banner.className = "reminder-banner";

  const lines = items.map((r) => {
    const mins = r.diffMins;
    const timeLabel = mins < 60
      ? `in ${mins} minute${mins !== 1 ? "s" : ""}`
      : mins < 1440
        ? `in ${Math.round(mins / 60)} hour${Math.round(mins / 60) !== 1 ? "s" : ""}`
        : "tomorrow";
    return `<div class="reminder-item">⏰ <strong>${r.ev.name}</strong> ${timeLabel}${r.ev.startTime ? " at " + formatTime(r.ev.startTime) : ""}</div>`;
  }).join("");

  banner.innerHTML = `
    <div class="reminder-content">
      <div class="reminder-title">Upcoming reminders</div>
      ${lines}
    </div>
    <button class="reminder-close" onclick="this.parentElement.remove()">✕</button>`;

  document.getElementById("app").prepend(banner);
}

// ── Helpers ───────────────────────────────────────────────────

function getMember(name) {
  const u = state.users.find((u) => u.name === name);
  if (u) return u;
  const m = state.members.find((m) => m.name === name);
  return m || { name, colorIdx: 0 };
}
function memberColor(name) {
  const m = getMember(name);
  return MEMBER_COLORS[(m.colorIdx || 0) % MEMBER_COLORS.length];
}
function initials(name) {
  return (name || "?").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}
function avatarHtml(name, size = 26) {
  const c = memberColor(name);
  return `<span class="avatar" style="width:${size}px;height:${size}px;background:${c.bg};color:${c.text};font-size:${Math.round(size * 0.4)}px;">${initials(name)}</span>`;
}
function whoPill(name, role) {
  const c = memberColor(name);
  const roleIcon = role === "do" ? "✅" : "👁";
  return `<span class="who-pill" style="background:${c.bg};color:${c.text};">${avatarHtml(name, 14)} ${name} <span class="role-icon">${roleIcon}</span></span>`;
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}
function formatTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")}${ampm}`;
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function allMemberNames() {
  return state.users.map((u) => u.name);
}
function rerenderCurrentPanel() {
  if (activeTab === "cal") renderCalPanel();
  if (activeTab === "todo") renderTodoPanel();
}

// ── Render ────────────────────────────────────────────────────

function render() {
  const app = document.getElementById("app");
  document.getElementById("loading")?.remove();
  if (!currentUser) {
    renderAuthScreen(app);
  } else {
    renderApp(app);
  }
}

// ── Auth screen ───────────────────────────────────────────────

function renderAuthScreen(app, mode = "login") {
  const isLogin = mode === "login";
  app.innerHTML = `
    <div class="auth-screen">
      <div class="auth-icon">🏠</div>
      <h1>${CONFIG.FAMILY_NAME}</h1>
      <p class="auth-subtitle">${isLogin ? "Sign in to your account" : "Create your family account"}</p>
      <div class="auth-card">
        <div class="auth-toggle">
          <button class="auth-toggle-btn ${isLogin ? "active" : ""}" onclick="renderAuthScreen(document.getElementById('app'), 'login')">Sign in</button>
          <button class="auth-toggle-btn ${!isLogin ? "active" : ""}" onclick="renderAuthScreen(document.getElementById('app'), 'register')">Register</button>
        </div>
        <div id="auth-error" class="auth-error" style="display:none;"></div>
        <div class="form-stack">
          ${!isLogin ? `<input type="text" id="auth-name" placeholder="Your name (e.g. Dad, Sarah)" autocomplete="name" />` : ""}
          <input type="email" id="auth-email" placeholder="Email address" autocomplete="email" />
          <input type="password" id="auth-password" placeholder="Password${!isLogin ? " (min. 6 characters)" : ""}" autocomplete="${isLogin ? "current-password" : "new-password"}" />
          <button class="btn-primary" onclick="${isLogin ? "doLogin()" : "doRegister()"}">
            ${isLogin ? "Sign in" : "Create account"}
          </button>
        </div>
      </div>
      <p class="auth-note">☁️ All family members share the same calendar and tasks</p>
    </div>`;

  app.querySelectorAll("input").forEach((inp) => {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") isLogin ? doLogin() : doRegister();
    });
  });
}

async function doLogin() {
  const email = document.getElementById("auth-email")?.value;
  const password = document.getElementById("auth-password")?.value;
  showAuthError("");
  const result = await Auth.login(email, password, state);
  if (!result.ok) { showAuthError(result.error); return; }
  currentUser = result.user;
  render();
  checkReminders();
}

async function doRegister() {
  const name = document.getElementById("auth-name")?.value;
  const email = document.getElementById("auth-email")?.value;
  const password = document.getElementById("auth-password")?.value;
  showAuthError("");
  const result = await Auth.register(name, email, password, state, saveData);
  if (!result.ok) { showAuthError(result.error); return; }
  currentUser = result.user;
  render();
}

function showAuthError(msg) {
  const el = document.getElementById("auth-error");
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? "block" : "none";
}

function doLogout() {
  Auth.logout();
  currentUser = null;
  render();
}

// ── App shell ─────────────────────────────────────────────────

function renderApp(app) {
  app.innerHTML = `
    <div class="top-bar">
      <div class="app-title">🏠 ${CONFIG.FAMILY_NAME}</div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="sync-badge" id="sync-badge">☁️ Shared</span>
        <button class="me-chip" onclick="showUserMenu()">
          ${avatarHtml(currentUser.name)} <span>${currentUser.name}</span> ▾
        </button>
      </div>
    </div>
    <div id="user-menu" class="user-menu" style="display:none;">
      <div class="user-menu-name">${currentUser.name}</div>
      <div class="user-menu-email">${currentUser.email}</div>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:8px 0;" />
      <button class="user-menu-item" onclick="doLogout()">Sign out</button>
    </div>
    <nav class="tabs">
      <button class="tab active" id="tab-cal" onclick="showTab('cal')">📅 Calendar</button>
      <button class="tab" id="tab-todo" onclick="showTab('todo')">✅ To-do</button>
    </nav>
    <main id="main-content">
      <div id="panel-cal" class="panel active"></div>
      <div id="panel-todo" class="panel"></div>
    </main>`;

  renderCalPanel();
  renderTodoPanel();
  document.addEventListener("click", closeUserMenuOnOutsideClick);
}

function showUserMenu() {
  const menu = document.getElementById("user-menu");
  if (menu) menu.style.display = menu.style.display === "none" ? "block" : "none";
}
function closeUserMenuOnOutsideClick(e) {
  const menu = document.getElementById("user-menu");
  const chip = document.querySelector(".me-chip");
  if (menu && !menu.contains(e.target) && chip && !chip.contains(e.target)) {
    menu.style.display = "none";
  }
}
function showTab(name) {
  activeTab = name;
  ["cal", "todo"].forEach((n) => {
    document.getElementById("tab-" + n)?.classList.toggle("active", n === name);
    document.getElementById("panel-" + n)?.classList.toggle("active", n === name);
  });
}

// ── Calendar panel ────────────────────────────────────────────

function renderCalPanel() {
  const panel = document.getElementById("panel-cal");
  if (!panel) return;

  const today = new Date();
  const expandedThisMonth = getExpandedEventsForMonth(curYear, curMonth);

  const firstDay = new Date(curYear, curMonth, 1).getDay();
  const daysInMonth = new Date(curYear, curMonth + 1, 0).getDate();
  const prevDays = new Date(curYear, curMonth, 0).getDate();

  let dayHeaders = DAYS.map((d) => `<div class="day-lbl">${d}</div>`).join("");
  let cells = "";

  for (let i = 0; i < firstDay; i++) {
    cells += `<div class="cal-day other"><span class="day-num">${prevDays - firstDay + 1 + i}</span></div>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${curYear}-${String(curMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const isToday = today.getFullYear() === curYear && today.getMonth() === curMonth && today.getDate() === d;
    const dayEvs = expandedThisMonth.filter((e) => e.date === ds);
    const pips = dayEvs.slice(0, 3).map((e) => {
      const isDoer = e.doer === currentUser.name;
      const c = memberColor(currentUser.name);
      return `<span class="ev-pip${isDoer ? "" : " ev-pip-see"}" style="background:${isDoer ? c.text : "#9ca3af"};"></span>`;
    }).join("");
    cells += `<div class="cal-day${isToday ? " today" : ""}"><span class="day-num">${d}</span>${pips}</div>`;
  }
  const total = firstDay + daysInMonth;
  const rem = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let i = 1; i <= rem; i++) cells += `<div class="cal-day other"><span class="day-num">${i}</span></div>`;

  const members = allMemberNames();
  const memberChecks = members.map((name) => `
    <label class="member-check">
      <input type="checkbox" name="seer" value="${name}" ${name === currentUser.name ? "checked" : ""} />
      ${avatarHtml(name, 18)} ${name}
    </label>`).join("");

  const reminderOpts = REMINDER_OPTIONS.map((r) =>
    `<option value="${r.minutes}">${r.label}</option>`
  ).join("");

  // NEW: recurring options
  const recurOpts = RECUR_OPTIONS.map((r) =>
    `<option value="${r.value}">${r.label}</option>`
  ).join("");

  // Default recurring end date = 1 year from today
  const defaultEndDate = addDays(todayStr(), 365);

  // Upcoming expanded events split by do/see
  const allUpcoming = getExpandedUpcoming();
  const upcomingDo = allUpcoming.filter((e) => e.doer === currentUser.name);
  const upcomingSee = allUpcoming.filter((e) => e.doer !== currentUser.name);

  panel.innerHTML = `
    <div class="month-nav">
      <button class="nav-btn" onclick="changeMonth(-1)">‹</button>
      <span class="month-title">${MONTHS[curMonth]} ${curYear}</span>
      <button class="nav-btn" onclick="changeMonth(1)">›</button>
    </div>
    <div class="cal-grid">${dayHeaders}${cells}</div>

    <div class="legend-row">
      <span class="legend-item"><span class="legend-pip" style="background:#534AB7;"></span> My events (Do)</span>
      <span class="legend-item"><span class="legend-pip" style="background:#9ca3af;"></span> Aware of (See)</span>
      <span class="legend-item">🔁 Recurring</span>
    </div>

    <div class="section-card" id="event-form-card">
      <h3 id="event-form-title">Add event</h3>
      <div class="form-stack">
        <input type="text" id="ev-name" placeholder="Event name" />

        <div class="form-row-2">
          <div>
            <label class="field-label">Date</label>
            <input type="date" id="ev-date" value="${todayStr()}" />
          </div>
          <div>
            <label class="field-label">Responsible (Do)</label>
            <select id="ev-doer">
              ${members.map((n) => `<option value="${n}"${n === currentUser.name ? " selected" : ""}>${n}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="form-row-2">
          <div>
            <label class="field-label">Start time (optional)</label>
            <input type="time" id="ev-start" />
          </div>
          <div>
            <label class="field-label">End time (optional)</label>
            <input type="time" id="ev-end" />
          </div>
        </div>

        <div class="form-row-2">
          <div>
            <label class="field-label">Repeat</label>
            <select id="ev-recur" onchange="toggleRecurEnd()">
              ${recurOpts}
            </select>
          </div>
          <div id="recur-end-wrap" style="display:none;">
            <label class="field-label">Repeat ends</label>
            <input type="date" id="ev-recur-end" value="${defaultEndDate}" />
          </div>
        </div>

        <div>
          <label class="field-label">Who should see this event?</label>
          <div class="member-checks" id="seer-checks">${memberChecks}</div>
        </div>

        <div>
          <label class="field-label">Reminder</label>
          <select id="ev-reminder">
            <option value="none">No reminder</option>
            ${reminderOpts}
          </select>
        </div>

        <input type="text" id="ev-notes" placeholder="Notes (optional)" />
        <div class="form-row-2" id="form-buttons">
          <button class="btn-primary" id="ev-submit-btn" onclick="submitEventForm()">Add to calendar</button>
          <button class="btn-cancel" id="ev-cancel-btn" onclick="cancelEdit()" style="display:none;">Cancel</button>
        </div>
      </div>
    </div>

    ${upcomingDo.length ? `
      <div class="section-label">My upcoming events — I'm doing (${upcomingDo.length})</div>
      ${upcomingDo.map((e) => eventItemHtml(e, "do")).join("")}` : `
      <div class="section-label">My upcoming events</div>
      <p class="empty-msg">Nothing coming up — add one above!</p>`}

    ${upcomingSee.length ? `
      <div class="section-label aware-label" style="margin-top:1.5rem;">Events I'm aware of — others are doing (${upcomingSee.length})</div>
      ${upcomingSee.map((e) => eventItemHtml(e, "see")).join("")}` : ""}`;

  document.getElementById("ev-name")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addEvent();
  });
}

// Show/hide the "repeat ends" date picker based on recur selection
function toggleRecurEnd() {
  const val = document.getElementById("ev-recur")?.value;
  const wrap = document.getElementById("recur-end-wrap");
  if (wrap) wrap.style.display = val && val !== "none" ? "block" : "none";
}

function eventItemHtml(e, role) {
  const isSee = role === "see";
  const timeStr = e.startTime
    ? `${formatTime(e.startTime)}${e.endTime ? " – " + formatTime(e.endTime) : ""}`
    : "";
  const reminderLabel = e.reminder && e.reminder !== "none"
    ? REMINDER_OPTIONS.find((r) => r.minutes == e.reminder)?.label || ""
    : "";

  // NEW: recurring badge
  const isRecurring = e.recurring && e.recurring !== "none";
  const recurLabel = isRecurring
    ? `<span class="recur-badge">🔁 ${e.recurring === "weekly" ? "Weekly" : "Fortnightly"}</span>`
    : "";

  const doerPill = whoPill(e.doer, "do");
  const seerPills = (e.seers || [])
    .filter((s) => s !== e.doer)
    .map((s) => whoPill(s, "see"))
    .join("");

  // Delete button — for recurring events offer choice; for one-off just delete
  const deleteBtn = !isSee ? (isRecurring
    ? `<button class="del-btn" onclick="confirmDeleteRecurring('${e.id}', '${e.date}')" aria-label="Delete">✕</button>`
    : `<button class="del-btn" onclick="deleteEvent('${e.id}')" aria-label="Delete">✕</button>`)
    : "";

  // Edit button — only shown for doer, not seers
  const editBtn = !isSee
    ? `<button class="edit-btn" onclick="startEdit('${e.id}', '${e.date}')" aria-label="Edit">✏️</button>`
    : "";

  return `
    <div class="event-item${isSee ? " event-item-see" : ""}">
      ${isSee ? `<div class="see-indicator" title="You're aware of this event">👁</div>` : ""}
      <div class="event-body">
        <div class="event-title">${e.name} ${recurLabel}</div>
        <div class="event-meta">
          <span class="date-pill">📅 ${formatDate(e.date)}${timeStr ? " · " + timeStr : ""}</span>
          ${doerPill}
          ${seerPills}
        </div>
        ${e.notes ? `<div class="event-notes">${e.notes}</div>` : ""}
        ${reminderLabel ? `<div class="reminder-label">⏰ ${reminderLabel}</div>` : ""}
      </div>
      <div class="event-actions">
        ${editBtn}
        ${deleteBtn}
      </div>
    </div>`;
}

// ── Edit events ───────────────────────────────────────────────

function startEdit(id, occurrenceDate) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return;

  const isRecurring = ev.recurring && ev.recurring !== "none";

  if (isRecurring) {
    // Ask whether to edit just this occurrence or all
    confirmEditRecurring(id, occurrenceDate);
  } else {
    // Non-recurring — edit directly
    editingEventId = id;
    editingOccurrenceDate = null;
    fillEditForm(ev, occurrenceDate);
  }
}

function confirmEditRecurring(id, occurrenceDate) {
  const existing = document.getElementById("delete-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "delete-modal";
  modal.className = "delete-modal";
  modal.innerHTML = `
    <div class="delete-modal-box">
      <p class="delete-modal-title">Edit recurring event</p>
      <p class="delete-modal-sub">Do you want to edit just this occurrence, or all occurrences?</p>
      <div class="delete-modal-btns">
        <button class="delete-modal-btn" onclick="editOccurrence('${id}', '${occurrenceDate}')">This occurrence only</button>
        <button class="delete-modal-btn delete-modal-btn-danger" onclick="editAllOccurrences('${id}', '${occurrenceDate}')">All occurrences</button>
        <button class="delete-modal-btn delete-modal-btn-cancel" onclick="document.getElementById('delete-modal').remove()">Cancel</button>
      </div>
    </div>`;

  document.getElementById("main-content").prepend(modal);
}

function editOccurrence(id, occurrenceDate) {
  document.getElementById("delete-modal")?.remove();
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return;
  editingEventId = id;
  editingOccurrenceDate = occurrenceDate;
  // Fill form with this occurrence's date, but treat as a one-off edit
  fillEditForm(ev, occurrenceDate, true);
}

function editAllOccurrences(id, occurrenceDate) {
  document.getElementById("delete-modal")?.remove();
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return;
  editingEventId = id;
  editingOccurrenceDate = null;
  fillEditForm(ev, occurrenceDate, false);
}

function fillEditForm(ev, dateOverride, isSingleOccurrence = false) {
  // Scroll to form
  document.getElementById("event-form-card")?.scrollIntoView({ behavior: "smooth", block: "start" });

  // Update form title and button
  const title = document.getElementById("event-form-title");
  const btn = document.getElementById("ev-submit-btn");
  const cancelBtn = document.getElementById("ev-cancel-btn");
  if (title) title.textContent = "Edit event";
  if (btn) btn.textContent = "Save changes";
  if (cancelBtn) cancelBtn.style.display = "block";

  // Fill in all the fields
  const name = document.getElementById("ev-name");
  const date = document.getElementById("ev-date");
  const doer = document.getElementById("ev-doer");
  const start = document.getElementById("ev-start");
  const end = document.getElementById("ev-end");
  const recur = document.getElementById("ev-recur");
  const recurEnd = document.getElementById("ev-recur-end");
  const recurEndWrap = document.getElementById("recur-end-wrap");
  const reminder = document.getElementById("ev-reminder");
  const notes = document.getElementById("ev-notes");

  if (name) name.value = ev.name;
  if (date) date.value = dateOverride || ev.date;
  if (doer) doer.value = ev.doer;
  if (start) start.value = ev.startTime || "";
  if (end) end.value = ev.endTime || "";
  if (notes) notes.value = ev.notes || "";
  if (reminder) reminder.value = ev.reminder || "none";

  // For single occurrence edits, hide recurring options
  if (isSingleOccurrence) {
    if (recur) { recur.value = "none"; recur.disabled = true; }
    if (recurEndWrap) recurEndWrap.style.display = "none";
  } else {
    if (recur) { recur.value = ev.recurring || "none"; recur.disabled = false; }
    if (recurEnd) recurEnd.value = ev.recurringEnd || addDays(ev.date, 365);
    if (recurEndWrap) recurEndWrap.style.display = (ev.recurring && ev.recurring !== "none") ? "block" : "none";
  }

  // Tick the right seers
  document.querySelectorAll('input[name="seer"]').forEach((cb) => {
    cb.checked = (ev.seers || []).includes(cb.value);
  });
}

function cancelEdit() {
  editingEventId = null;
  editingOccurrenceDate = null;
  // Reset form title and button
  const title = document.getElementById("event-form-title");
  const btn = document.getElementById("ev-submit-btn");
  const cancelBtn = document.getElementById("ev-cancel-btn");
  const recur = document.getElementById("ev-recur");
  if (title) title.textContent = "Add event";
  if (btn) btn.textContent = "Add to calendar";
  if (cancelBtn) cancelBtn.style.display = "none";
  if (recur) recur.disabled = false;
  // Clear all fields
  ["ev-name", "ev-start", "ev-end", "ev-notes"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  document.getElementById("ev-date").value = todayStr();
  document.getElementById("ev-reminder").value = "none";
  document.getElementById("ev-recur").value = "none";
  document.getElementById("recur-end-wrap").style.display = "none";
  document.querySelectorAll('input[name="seer"]').forEach((cb) => {
    cb.checked = cb.value === currentUser.name;
  });
}

// Single submit handler for both add and edit
function submitEventForm() {
  if (editingEventId) {
    saveEdit();
  } else {
    addEvent();
  }
}

async function saveEdit() {
  const name = document.getElementById("ev-name")?.value.trim();
  const date = document.getElementById("ev-date")?.value;
  const doer = document.getElementById("ev-doer")?.value;
  const startTime = document.getElementById("ev-start")?.value || "";
  const endTime = document.getElementById("ev-end")?.value || "";
  const notes = document.getElementById("ev-notes")?.value.trim() || "";
  const reminder = document.getElementById("ev-reminder")?.value || "none";
  const recur = document.getElementById("ev-recur");
  const recurring = recur?.disabled ? "none" : (recur?.value || "none");
  const recurringEnd = recurring !== "none"
    ? (document.getElementById("ev-recur-end")?.value || "")
    : "";

  const seerChecks = document.querySelectorAll('input[name="seer"]:checked');
  const seers = Array.from(seerChecks).map((c) => c.value);
  if (!seers.includes(doer)) seers.push(doer);

  if (!name || !date) return;

  if (editingOccurrenceDate) {
    // Editing a single occurrence of a recurring event —
    // split the series: end the original before this date, add a one-off
    const originalEv = state.events.find((e) => e.id === editingEventId);
    if (originalEv) {
      if (editingOccurrenceDate === originalEv.date) {
        // First occurrence — move original start forward by one interval
        const days = originalEv.recurring === "weekly" ? 7 : 14;
        originalEv.date = addDays(originalEv.date, days);
      } else {
        // Later occurrence — trim end of original to day before
        originalEv.recurringEnd = addDays(editingOccurrenceDate, -1);
      }
    }
    // Add the edited occurrence as a standalone event
    state.events.push({
      id: uid(), name, date, doer, seers,
      startTime, endTime, notes, reminder,
      recurring: "none", recurringEnd: "",
      addedBy: currentUser.name,
    });
  } else {
    // Editing all occurrences — update in place
    const idx = state.events.findIndex((e) => e.id === editingEventId);
    if (idx !== -1) {
      state.events[idx] = {
        ...state.events[idx],
        name, date, doer, seers,
        startTime, endTime, notes, reminder,
        recurring, recurringEnd,
      };
    }
  }

  editingEventId = null;
  editingOccurrenceDate = null;
  await saveData();
  renderCalPanel();
  checkReminders();
}



function confirmDeleteRecurring(id, occurrenceDate) {
  // Show a small inline confirmation instead of browser confirm()
  const existing = document.getElementById("delete-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "delete-modal";
  modal.className = "delete-modal";
  modal.innerHTML = `
    <div class="delete-modal-box">
      <p class="delete-modal-title">Delete recurring event</p>
      <p class="delete-modal-sub">Do you want to delete just this occurrence, or all future occurrences?</p>
      <div class="delete-modal-btns">
        <button class="delete-modal-btn" onclick="deleteOccurrence('${id}', '${occurrenceDate}')">This occurrence only</button>
        <button class="delete-modal-btn delete-modal-btn-danger" onclick="deleteAllRecurring('${id}')">All occurrences</button>
        <button class="delete-modal-btn delete-modal-btn-cancel" onclick="document.getElementById('delete-modal').remove()">Cancel</button>
      </div>
    </div>`;

  document.getElementById("main-content").prepend(modal);
}

// Delete a single occurrence by setting recurringEnd to the day before
async function deleteOccurrence(id, occurrenceDate) {
  document.getElementById("delete-modal")?.remove();
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return;

  if (occurrenceDate === ev.date) {
    // Deleting the first occurrence — move start date forward by one interval
    const days = ev.recurring === "weekly" ? 7 : 14;
    ev.date = addDays(ev.date, days);
  } else {
    // Deleting a later occurrence — set end date to day before this occurrence
    ev.recurringEnd = addDays(occurrenceDate, -1);
  }

  await saveData();
  renderCalPanel();
}

// Delete the whole recurring series
async function deleteAllRecurring(id) {
  document.getElementById("delete-modal")?.remove();
  state.events = state.events.filter((e) => e.id !== id);
  await saveData();
  renderCalPanel();
}

// ── To-do panel ───────────────────────────────────────────────

function renderTodoPanel() {
  const panel = document.getElementById("panel-todo");
  if (!panel) return;

  const members = allMemberNames();
  const memberOpts = members.map((n) =>
    `<option value="${n}"${n === currentUser.name ? " selected" : ""}>${n}</option>`
  ).join("");

  const myPending = state.todos.filter((t) => !t.done && t.owner === currentUser.name);
  const otherPending = state.todos.filter((t) => !t.done && t.owner !== currentUser.name);
  const done = state.todos.filter((t) => t.done);

  const todoItemHtml = (t, isDone) => `
    <div class="todo-item${isDone ? " done-item" : ""}">
      <button class="check-btn${isDone ? " done" : ""}" onclick="toggleTodo('${t.id}')" aria-label="${isDone ? "Mark undone" : "Mark done"}">
        <span class="check-inner">${isDone ? "✓" : ""}</span>
      </button>
      <div class="todo-body">
        <div class="todo-title${isDone ? " done-text" : ""}">${t.text}</div>
        <div class="todo-meta">${whoPill(t.owner, "do")}</div>
      </div>
      <button class="del-btn" onclick="deleteTodo('${t.id}')" aria-label="Delete">✕</button>
    </div>`;

  panel.innerHTML = `
    <div class="section-card">
      <h3>Add task</h3>
      <div class="form-stack">
        <input type="text" id="todo-text" placeholder="What needs doing?" />
        <div>
          <label class="field-label">Assign to</label>
          <select id="todo-owner">${memberOpts}</select>
        </div>
        <button class="btn-primary" onclick="addTodo()">Add task</button>
      </div>
    </div>
    <div class="section-label">My tasks (${myPending.length})</div>
    ${myPending.length ? myPending.map((t) => todoItemHtml(t, false)).join("") : `<p class="empty-msg">Nothing on your list 🎉</p>`}
    ${otherPending.length ? `
      <div class="section-label" style="margin-top:1.25rem;">Rest of the family (${otherPending.length})</div>
      ${otherPending.map((t) => todoItemHtml(t, false)).join("")}` : ""}
    ${done.length ? `
      <div class="section-label" style="margin-top:1.25rem;">Completed (${done.length})</div>
      ${done.map((t) => todoItemHtml(t, true)).join("")}` : ""}`;

  document.getElementById("todo-text")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addTodo();
  });
}

// ── Actions ───────────────────────────────────────────────────

function changeMonth(dir) {
  curMonth += dir;
  if (curMonth > 11) { curMonth = 0; curYear++; }
  if (curMonth < 0) { curMonth = 11; curYear--; }
  renderCalPanel();
}

async function addEvent() {
  const name = document.getElementById("ev-name")?.value.trim();
  const date = document.getElementById("ev-date")?.value;
  const doer = document.getElementById("ev-doer")?.value;
  const startTime = document.getElementById("ev-start")?.value || "";
  const endTime = document.getElementById("ev-end")?.value || "";
  const notes = document.getElementById("ev-notes")?.value.trim() || "";
  const reminder = document.getElementById("ev-reminder")?.value || "none";
  const recurring = document.getElementById("ev-recur")?.value || "none";
  const recurringEnd = recurring !== "none"
    ? (document.getElementById("ev-recur-end")?.value || addDays(date, 365))
    : "";

  const seerChecks = document.querySelectorAll('input[name="seer"]:checked');
  const seers = Array.from(seerChecks).map((c) => c.value);
  if (!seers.includes(doer)) seers.push(doer);

  if (!name || !date) return;

  state.events.push({
    id: uid(), name, date, doer, seers,
    startTime, endTime, notes, reminder,
    recurring, recurringEnd,
    addedBy: currentUser.name,
  });

  await saveData();
  renderCalPanel();
  checkReminders();
}

async function deleteEvent(id) {
  state.events = state.events.filter((e) => e.id !== id);
  await saveData();
  renderCalPanel();
}

async function addTodo() {
  const text = document.getElementById("todo-text")?.value.trim();
  const owner = document.getElementById("todo-owner")?.value;
  if (!text) return;
  state.todos.push({ id: uid(), text, owner, done: false, addedBy: currentUser.name });
  await saveData();
  renderTodoPanel();
}

async function toggleTodo(id) {
  const t = state.todos.find((t) => t.id === id);
  if (t) { t.done = !t.done; await saveData(); }
  renderTodoPanel();
}

async function deleteTodo(id) {
  state.todos = state.todos.filter((t) => t.id !== id);
  await saveData();
  renderTodoPanel();
}

// ── Boot ──────────────────────────────────────────────────────
loadData();
