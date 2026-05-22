// ============================================================
//  FAMILY HUB — App (no AI version)
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
const DAYS = ["Su","Mo","Tu","We","Th","Fr","Sa"];

let state = { events: [], todos: [], members: [] };
let currentUser = null;
let curYear, curMonth;
let saveTimeout = null;
let lastSyncTime = null;

// ── Data layer ────────────────────────────────────────────────

async function loadData() {
  try {
    const res = await fetch(JSONBIN_URL + "/latest", { headers: JSONBIN_HEADERS });
    if (!res.ok) throw new Error("Load failed");
    const json = await res.json();
    state = json.record || { events: [], todos: [], members: [] };
  } catch (e) {
    console.warn("Could not load data:", e);
    state = { events: [], todos: [], members: [] };
  }
  if (!state.events) state.events = [];
  if (!state.todos) state.todos = [];
  if (!state.members || !state.members.length) {
    state.members = [
      { name: "Dad", colorIdx: 0 },
      { name: "Mum", colorIdx: 1 },
      { name: "Kids", colorIdx: 2 },
    ];
  }

  // Remember who was last logged in on this device
  const saved = localStorage.getItem("familyhub-user");
  if (saved && state.members.find((m) => m.name === saved)) {
    currentUser = saved;
  }

  lastSyncTime = new Date();
  render();
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
      lastSyncTime = new Date();
      updateSyncBadge();
    } catch (e) {
      console.warn("Save failed:", e);
    }
  }, 500);
}

function updateSyncBadge() {
  const badge = document.getElementById("sync-badge");
  if (badge && lastSyncTime) {
    badge.textContent = "☁️ Saved";
    setTimeout(() => { if (badge) badge.textContent = "☁️ Shared"; }, 2000);
  }
}

// Poll for changes from other family members every 30 seconds
setInterval(async () => {
  if (!currentUser) return;
  try {
    const res = await fetch(JSONBIN_URL + "/latest", { headers: JSONBIN_HEADERS });
    if (!res.ok) return;
    const json = await res.json();
    const fresh = json.record;
    if (JSON.stringify(fresh) !== JSON.stringify(state)) {
      state = fresh;
      rerenderCurrentPanel();
    }
  } catch (e) {}
}, 30000);

// ── Helpers ───────────────────────────────────────────────────

function getMember(name) {
  return state.members.find((m) => m.name === name) || { name, colorIdx: 0 };
}
function memberColor(name) {
  const m = getMember(name);
  return MEMBER_COLORS[m.colorIdx % MEMBER_COLORS.length];
}
function initials(name) {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}
function avatarHtml(name, size = 26) {
  const c = memberColor(name);
  return `<span class="avatar" style="width:${size}px;height:${size}px;background:${c.bg};color:${c.text};font-size:${Math.round(size * 0.42)}px;">${initials(name)}</span>`;
}
function whoPill(name) {
  const c = memberColor(name);
  return `<span class="who-pill" style="background:${c.bg};color:${c.text};">${avatarHtml(name, 14)} ${name}</span>`;
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

let activeTab = "cal";

function rerenderCurrentPanel() {
  if (activeTab === "cal") renderCalPanel();
  if (activeTab === "todo") renderTodoPanel();
}

// ── Render ────────────────────────────────────────────────────

function render() {
  const app = document.getElementById("app");
  document.getElementById("loading")?.remove();
  if (!currentUser) {
    renderSetup(app);
  } else {
    const now = new Date();
    if (!curYear) { curYear = now.getFullYear(); curMonth = now.getMonth(); }
    renderApp(app);
  }
}

function renderSetup(app) {
  const grid = state.members.map((m) => `
    <button class="member-btn" onclick="selectUser('${m.name}')">
      ${avatarHtml(m.name, 34)}
      <span>${m.name}</span>
    </button>`).join("");

  app.innerHTML = `
    <div class="setup-screen">
      <div class="setup-icon">🏠</div>
      <h1>${CONFIG.FAMILY_NAME} Hub</h1>
      <p>Who are you? Tap your name to open the calendar.</p>
      <div class="member-grid">${grid}</div>
      <div class="divider-line"></div>
      <p class="add-label">Add a family member</p>
      <div class="add-member-row">
        <input type="text" id="new-member" placeholder="Name…" />
        <button onclick="addMember()">Add</button>
      </div>
      <p class="shared-note">☁️ Everyone shares the same calendar and tasks</p>
    </div>`;

  document.getElementById("new-member")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addMember();
  });
}

function renderApp(app) {
  app.innerHTML = `
    <div class="top-bar">
      <div class="app-title">🏠 ${CONFIG.FAMILY_NAME}</div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="sync-badge" id="sync-badge">☁️ Shared</span>
        <button class="me-chip" onclick="switchUser()">
          ${avatarHtml(currentUser)} <span>${currentUser}</span> ▾
        </button>
      </div>
    </div>
    <nav class="tabs">
      <button class="tab active" id="tab-cal" onclick="showTab('cal')">📅 Calendar</button>
      <button class="tab" id="tab-todo" onclick="showTab('todo')">✅ To-do</button>
    </nav>
    <main>
      <div id="panel-cal" class="panel active"></div>
      <div id="panel-todo" class="panel"></div>
    </main>`;

  renderCalPanel();
  renderTodoPanel();
}

// ── Calendar panel ────────────────────────────────────────────

function renderCalPanel() {
  const panel = document.getElementById("panel-cal");
  if (!panel) return;

  const firstDay = new Date(curYear, curMonth, 1).getDay();
  const daysInMonth = new Date(curYear, curMonth + 1, 0).getDate();
  const prevDays = new Date(curYear, curMonth, 0).getDate();
  const today = new Date();

  let dayHeaders = DAYS.map((d) => `<div class="day-lbl">${d}</div>`).join("");
  let cells = "";

  for (let i = 0; i < firstDay; i++) {
    cells += `<div class="cal-day other"><span class="day-num">${prevDays - firstDay + 1 + i}</span></div>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${curYear}-${String(curMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const isToday = today.getFullYear() === curYear && today.getMonth() === curMonth && today.getDate() === d;
    const dayEvs = state.events.filter((e) => e.date === ds);
    const pips = dayEvs.slice(0, 3).map((e) => {
      const c = memberColor(e.owner);
      return `<span class="ev-pip" style="background:${c.text};"></span>`;
    }).join("");
    cells += `<div class="cal-day${isToday ? " today" : ""}"><span class="day-num">${d}</span>${pips}</div>`;
  }
  const total = firstDay + daysInMonth;
  const rem = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let i = 1; i <= rem; i++) cells += `<div class="cal-day other"><span class="day-num">${i}</span></div>`;

  const memberOpts = state.members.map((m) =>
    `<option value="${m.name}"${m.name === currentUser ? " selected" : ""}>${m.name}</option>`
  ).join("");

  const upcoming = state.events
    .filter((e) => e.date >= todayStr())
    .sort((a, b) => a.date.localeCompare(b.date));

  const past = state.events
    .filter((e) => e.date < todayStr())
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);

  const evHtml = (arr, emptyMsg) => arr.length
    ? arr.map((e) => `
      <div class="event-item">
        <div class="event-body">
          <div class="event-title">${e.name}</div>
          <div class="event-meta">
            <span class="date-pill">📅 ${formatDate(e.date)}</span>
            ${whoPill(e.owner)}
            ${e.notes ? `<span class="event-notes">${e.notes}</span>` : ""}
          </div>
        </div>
        <button class="del-btn" onclick="deleteEvent('${e.id}')" aria-label="Delete event">✕</button>
      </div>`).join("")
    : `<p class="empty-msg">${emptyMsg}</p>`;

  panel.innerHTML = `
    <div class="month-nav">
      <button class="nav-btn" onclick="changeMonth(-1)">‹</button>
      <span class="month-title">${MONTHS[curMonth]} ${curYear}</span>
      <button class="nav-btn" onclick="changeMonth(1)">›</button>
    </div>

    <div class="cal-grid">${dayHeaders}${cells}</div>

    <div class="section-card">
      <h3>Add event</h3>
      <div class="form-stack">
        <input type="text" id="ev-name" placeholder="Event name" />
        <div class="form-row-2">
          <input type="date" id="ev-date" value="${todayStr()}" />
          <select id="ev-owner">${memberOpts}</select>
        </div>
        <input type="text" id="ev-notes" placeholder="Notes (optional)" />
        <button class="btn-primary" onclick="addEvent()">Add to calendar</button>
      </div>
    </div>

    <div class="section-label">Upcoming (${upcoming.length})</div>
    ${evHtml(upcoming, "No upcoming events — add one above!")}

    ${past.length ? `
      <div class="section-label" style="margin-top:1.5rem;">Recent past</div>
      ${evHtml(past, "")}` : ""}`;

  document.getElementById("ev-name")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addEvent();
  });
}

// ── To-do panel ───────────────────────────────────────────────

function renderTodoPanel() {
  const panel = document.getElementById("panel-todo");
  if (!panel) return;

  const memberOpts = state.members.map((m) =>
    `<option value="${m.name}"${m.name === currentUser ? " selected" : ""}>${m.name}</option>`
  ).join("");

  // Group pending todos by owner
  const pending = state.todos.filter((t) => !t.done);
  const done = state.todos.filter((t) => t.done);

  // Build a "my tasks" section and "everyone else" section
  const myTasks = pending.filter((t) => t.owner === currentUser);
  const otherTasks = pending.filter((t) => t.owner !== currentUser);

  const todoItemHtml = (t) => `
    <div class="todo-item">
      <button class="check-btn" onclick="toggleTodo('${t.id}')" aria-label="Mark done">
        <span class="check-inner"></span>
      </button>
      <div class="todo-body">
        <div class="todo-title">${t.text}</div>
        <div class="todo-meta">${whoPill(t.owner)}</div>
      </div>
      <button class="del-btn" onclick="deleteTodo('${t.id}')" aria-label="Delete">✕</button>
    </div>`;

  const doneItemHtml = (t) => `
    <div class="todo-item done-item">
      <button class="check-btn done" onclick="toggleTodo('${t.id}')" aria-label="Mark undone">
        <span class="check-inner">✓</span>
      </button>
      <div class="todo-body">
        <div class="todo-title done-text">${t.text}</div>
        <div class="todo-meta">${whoPill(t.owner)}</div>
      </div>
      <button class="del-btn" onclick="deleteTodo('${t.id}')" aria-label="Delete">✕</button>
    </div>`;

  panel.innerHTML = `
    <div class="section-card">
      <h3>Add task</h3>
      <div class="form-stack">
        <input type="text" id="todo-text" placeholder="What needs doing?" />
        <select id="todo-owner">${memberOpts}</select>
        <button class="btn-primary" onclick="addTodo()">Add task</button>
      </div>
    </div>

    ${myTasks.length ? `
      <div class="section-label">My tasks — ${currentUser} (${myTasks.length})</div>
      ${myTasks.map(todoItemHtml).join("")}` : `
      <div class="section-label">My tasks — ${currentUser}</div>
      <p class="empty-msg">Nothing on your list 🎉</p>`}

    ${otherTasks.length ? `
      <div class="section-label" style="margin-top:1.25rem;">Rest of the family (${otherTasks.length})</div>
      ${otherTasks.map(todoItemHtml).join("")}` : ""}

    ${done.length ? `
      <div class="section-label" style="margin-top:1.25rem;">Completed (${done.length})</div>
      ${done.map(doneItemHtml).join("")}` : ""}`;

  document.getElementById("todo-text")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addTodo();
  });
}

// ── Actions ───────────────────────────────────────────────────

function selectUser(name) {
  currentUser = name;
  localStorage.setItem("familyhub-user", name);
  render();
}

function switchUser() {
  currentUser = null;
  localStorage.removeItem("familyhub-user");
  render();
}

async function addMember() {
  const inp = document.getElementById("new-member");
  const name = inp.value.trim();
  if (!name || state.members.find((m) => m.name === name)) return;
  state.members.push({ name, colorIdx: state.members.length });
  await saveData();
  renderSetup(document.getElementById("app"));
}

function changeMonth(dir) {
  curMonth += dir;
  if (curMonth > 11) { curMonth = 0; curYear++; }
  if (curMonth < 0) { curMonth = 11; curYear--; }
  renderCalPanel();
}

async function addEvent() {
  const name = document.getElementById("ev-name")?.value.trim();
  const date = document.getElementById("ev-date")?.value;
  const owner = document.getElementById("ev-owner")?.value;
  const notes = document.getElementById("ev-notes")?.value.trim() || "";
  if (!name || !date) return;
  state.events.push({ id: uid(), name, date, owner, notes, addedBy: currentUser });
  await saveData();
  renderCalPanel();
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
  state.todos.push({ id: uid(), text, owner, done: false, addedBy: currentUser });
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

function showTab(name) {
  activeTab = name;
  ["cal", "todo"].forEach((n) => {
    document.getElementById("tab-" + n)?.classList.toggle("active", n === name);
    document.getElementById("panel-" + n)?.classList.toggle("active", n === name);
  });
}

// ── Boot ──────────────────────────────────────────────────────
loadData();
