/* Internship Applications Tracker
   Everything on screen is built from APPLICATIONS below, so search,
   sort, and filter all run against real records. */

/* Stand in for a real mail deep link: opens a Gmail search for that company. */
const inbox = (query) =>
  "https://mail.google.com/mail/u/0/#search/" + encodeURIComponent(query);

const SECTIONS = [
  { key: "accepted", label: "Accepted",    icon: "circle-check" },
  { key: "progress", label: "In Progress", icon: "clock" },
  { key: "applied",  label: "Applied",     icon: "list" },
  { key: "rejected", label: "Rejected",    icon: "ban" },
];

const APPLICATIONS = [
  /* Accepted */
  {
    status: "accepted", company: "Hooli", role: "Software Engineering Internship",
    season: "Summer", year: 2027, updated: "2027-02-14", domain: "hooli.com",
    emails: [
      { title: "Application Confirmation", date: "2026-10-02", kind: "link" },
      { title: "Final Round Invitation",   date: "2027-01-28", kind: "mail" },
      { title: "Offer Letter",             date: "2027-02-09", kind: "mail" },
      { title: "Acceptance Email from Hooli", date: "2027-02-14", kind: "mail" },
    ],
  },

  /* In Progress */
  {
    status: "progress", company: "Capital One", role: "Technology Intern Program",
    season: "Summer", year: 2027, updated: "2027-02-03", domain: "capitalone.com",
    emails: [
      { title: "Application Confirmation",  date: "2026-11-12", kind: "link" },
      { title: "Recruiter Screen Invite",   date: "2027-01-22", kind: "mail" },
      { title: "Power Day Interview Details", date: "2027-02-03", kind: "mail" },
    ],
  },
  {
    status: "progress", company: "BlackRock", role: "Technology Intern",
    season: "Spring", year: 2027, updated: "2027-01-30", domain: "blackrock.com",
    emails: [
      { title: "Application Confirmation", date: "2026-11-30", kind: "link" },
      { title: "Technical Assessment Link", date: "2027-01-30", kind: "mail" },
    ],
  },

  /* Applied */
  {
    status: "applied", company: "Google", role: "Product Manager Intern",
    season: "Summer", year: 2027, updated: "2027-01-21", domain: "google.com",
    emails: [
      { title: "Application Confirmation Email", date: "2027-01-15", kind: "link" },
      { title: "Interview Request Email",        date: "2027-01-20", kind: "mail" },
      { title: "Interview Instructions Email",   date: "2027-01-21", kind: "mail" },
    ],
  },
  {
    status: "applied", company: "Amazon", role: "SDE Intern",
    season: "Summer", year: 2027, updated: "2027-01-18", domain: "amazon.com",
    emails: [
      { title: "Application Received", date: "2027-01-18", kind: "link" },
    ],
  },
  {
    status: "applied", company: "Stripe", role: "Backend Engineering Intern",
    season: "Summer", year: 2027, updated: "2027-01-12", domain: "stripe.com",
    emails: [
      { title: "Application Received",   date: "2027-01-10", kind: "link" },
      { title: "Work Sample Invitation", date: "2027-01-12", kind: "mail" },
    ],
  },
  {
    status: "applied", company: "Figma", role: "Product Design Intern",
    season: "Fall", year: 2026, updated: "2026-09-27", domain: "figma.com",
    emails: [
      { title: "Portfolio Received", date: "2026-09-27", kind: "link" },
    ],
  },
  {
    status: "applied", company: "Datadog", role: "Site Reliability Intern",
    season: "Summer", year: 2027, updated: "2027-01-08", domain: "datadoghq.com",
    emails: [
      { title: "Application Confirmation", date: "2027-01-08", kind: "link" },
    ],
  },
  {
    status: "applied", company: "Databricks", role: "Machine Learning Intern",
    season: "Summer", year: 2027, updated: "2026-12-19", domain: "databricks.com",
    emails: [
      { title: "Application Confirmation", date: "2026-12-19", kind: "link" },
      { title: "Recruiter Follow-Up",      date: "2026-12-21", kind: "mail" },
    ],
  },
  {
    status: "applied", company: "Ramp", role: "Software Engineering Intern",
    season: "Spring", year: 2027, updated: "2026-12-04", domain: "ramp.com",
    emails: [
      { title: "Application Received", date: "2026-12-04", kind: "link" },
    ],
  },

  /* Rejected */
  {
    status: "rejected", company: "Microsoft", role: "Software Engineering Intern",
    season: "Summer", year: 2027, updated: "2027-01-26", domain: "microsoft.com",
    emails: [
      { title: "Application Confirmation", date: "2026-10-14", kind: "link" },
      { title: "Application Update",       date: "2027-01-26", kind: "mail" },
    ],
  },
  {
    status: "rejected", company: "Netflix", role: "Content Strategy Intern",
    season: "Summer", year: 2027, updated: "2027-01-19", domain: "netflix.com",
    emails: [{ title: "Thank You for Applying", date: "2027-01-19", kind: "mail" }],
  },
  {
    status: "rejected", company: "Meta", role: "Product Analyst Intern",
    season: "Summer", year: 2027, updated: "2027-01-16", domain: "meta.com",
    emails: [
      { title: "Application Confirmation", date: "2026-11-02", kind: "link" },
      { title: "Decision Notification",    date: "2027-01-16", kind: "mail" },
    ],
  },
  {
    status: "rejected", company: "Apple", role: "Hardware Engineering Intern",
    season: "Summer", year: 2027, updated: "2027-01-11", domain: "apple.com",
    emails: [{ title: "Update on Your Application", date: "2027-01-11", kind: "mail" }],
  },
  {
    status: "rejected", company: "NVIDIA", role: "Deep Learning Intern",
    season: "Summer", year: 2027, updated: "2027-01-09", domain: "nvidia.com",
    emails: [{ title: "Application Status Update", date: "2027-01-09", kind: "mail" }],
  },
  {
    status: "rejected", company: "Palantir", role: "Forward Deployed Intern",
    season: "Summer", year: 2027, updated: "2027-01-05", domain: "palantir.com",
    emails: [
      { title: "Application Received", date: "2026-11-20", kind: "link" },
      { title: "Hiring Decision",      date: "2027-01-05", kind: "mail" },
    ],
  },
  {
    status: "rejected", company: "Airbnb", role: "Frontend Engineering Intern",
    season: "Spring", year: 2027, updated: "2026-12-22", domain: "airbnb.com",
    emails: [{ title: "Application Outcome", date: "2026-12-22", kind: "mail" }],
  },
  {
    status: "rejected", company: "Snowflake", role: "Data Platform Intern",
    season: "Summer", year: 2027, updated: "2026-12-15", domain: "snowflake.com",
    emails: [{ title: "Application Update", date: "2026-12-15", kind: "mail" }],
  },
  {
    status: "rejected", company: "Uber", role: "Mobile Engineering Intern",
    season: "Summer", year: 2027, updated: "2026-12-08", domain: "uber.com",
    emails: [
      { title: "Application Confirmation", date: "2026-10-30", kind: "link" },
      { title: "Application Update",       date: "2026-12-08", kind: "mail" },
    ],
  },
  {
    status: "rejected", company: "Coinbase", role: "Security Engineering Intern",
    season: "Fall", year: 2026, updated: "2026-11-27", domain: "coinbase.com",
    emails: [{ title: "Thanks for Your Interest", date: "2026-11-27", kind: "mail" }],
  },
  {
    status: "rejected", company: "Two Sigma", role: "Quantitative Research Intern",
    season: "Summer", year: 2027, updated: "2026-11-18", domain: "twosigma.com",
    emails: [
      { title: "Online Assessment Invite", date: "2026-11-04", kind: "mail" },
      { title: "Application Decision",     date: "2026-11-18", kind: "mail" },
    ],
  },
  {
    status: "rejected", company: "Jane Street", role: "Software Engineering Intern",
    season: "Summer", year: 2027, updated: "2026-11-06", domain: "janestreet.com",
    emails: [{ title: "Application Decision", date: "2026-11-06", kind: "mail" }],
  },
  {
    status: "rejected", company: "Notion", role: "Design Engineering Intern",
    season: "Fall", year: 2026, updated: "2026-09-30", domain: "notion.so",
    emails: [
      { title: "Application Confirmation", date: "2026-09-08", kind: "link" },
      { title: "Application Update",       date: "2026-09-30", kind: "mail" },
    ],
  },
].map((app, i) => ({ id: "app-" + i, ...app }));

/* ===============================================================
   Shared helpers
   =============================================================== */
const $ = (sel) => document.querySelector(sel);

/* Lucide replaces every [data-lucide] placeholder with an svg.
   Call this after any markup change that adds icons. */
const drawIcons = () => { if (window.lucide) lucide.createIcons(); };

/* Add the value if missing, remove it if present. */
const toggleIn = (set, value) => {
  if (!set.delete(value)) set.add(value);
};

const escapeHtml = (str) =>
  str.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ===============================================================
   View state
   =============================================================== */
const state = {
  query: "",
  sort: "recent",
  filters: { season: new Set(), year: new Set() },
  open: new Set(),        /* ids of expanded applications */
  collapsed: new Set(),   /* keys of folded sections */
};

const els = {
  board:       $("#board"),
  search:      $("#search"),
  empty:       $("#empty"),
  emptyTerm:   $("#emptyTerm"),
  tally:       $("#tally"),
  toggleAll:   $("#toggleAll"),
  filterCount: $("#filterCount"),
  blank:       $("#disconnected"),
  page:        $(".page"),
  refreshBtn:  $("#refreshBtn"),
  showBlank:   $("#showBlank"),
};

/* ===============================================================
   Search, filter, sort
   =============================================================== */

/* Wrap every search hit in a mark tag. */
function highlight(text) {
  const safe = escapeHtml(text);
  if (!state.query) return safe;
  const needle = state.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safe.replace(new RegExp(needle, "gi"), (hit) => "<mark>" + hit + "</mark>");
}

/* hit says whether the row shows at all. viaEmail says the only match
   was inside an email, which is why that row auto expands. */
function matchQuery(app) {
  const q = state.query.toLowerCase();
  if (!q) return { hit: true, viaEmail: false };

  const inHeader = [app.company, app.role, app.season, app.year]
    .join(" ").toLowerCase().includes(q);
  const inEmails = app.emails.some((email) => email.title.toLowerCase().includes(q));

  return { hit: inHeader || inEmails, viaEmail: inEmails && !inHeader };
}

function passesFilters(app) {
  const { season, year } = state.filters;
  return (!season.size || season.has(app.season)) &&
         (!year.size || year.has(String(app.year)));
}

const SORTERS = {
  "company-asc":  (a, b) => a.company.localeCompare(b.company),
  "company-desc": (a, b) => b.company.localeCompare(a.company),
  "recent":       (a, b) => b.updated.localeCompare(a.updated),
  "emails":       (a, b) => b.emails.length - a.emails.length ||
                            a.company.localeCompare(b.company),
};

const isNarrowed = () =>
  Boolean(state.query) || state.filters.season.size > 0 || state.filters.year.size > 0;

/* ===============================================================
   Render
   =============================================================== */
function render() {
  /* Match once per application and carry the result into the template. */
  const visible = APPLICATIONS
    .map((app) => ({ app, match: matchQuery(app) }))
    .filter(({ app, match }) => match.hit && passesFilters(app));

  els.board.innerHTML = SECTIONS.map((section, index) => {
    const rows = visible
      .filter(({ app }) => app.status === section.key)
      .sort((a, b) => SORTERS[state.sort](a.app, b.app));

    const total = APPLICATIONS.filter((app) => app.status === section.key).length;
    const collapsed = state.collapsed.has(section.key);
    const count = rows.length === total ? total : rows.length + " / " + total;

    return `
      <section class="section section--${section.key}${collapsed ? " collapsed" : ""}"
               style="--i:${index}" data-section="${section.key}" ${rows.length ? "" : "hidden"}>
        <button class="section__head" type="button" aria-expanded="${!collapsed}">
          <i data-lucide="${section.icon}" class="section__icon"></i>
          <span class="section__title">${section.label}</span>
          <span class="section__count">${count}</span>
          <i data-lucide="chevron-down" class="section__fold"></i>
        </button>
        <div class="section__body">
          <ul>${rows.map(itemTemplate).join("")}</ul>
        </div>
      </section>`;
  }).join("");

  els.empty.hidden = visible.length > 0;
  els.emptyTerm.textContent = state.query ? `"${state.query}"` : "the current filters";

  els.tally.textContent = `${visible.length} of ${APPLICATIONS.length} applications` +
    (isNarrowed() ? " shown" : " tracked");

  els.toggleAll.textContent = state.open.size ? "Collapse All" : "Expand All";

  const activeFilters = state.filters.season.size + state.filters.year.size;
  els.filterCount.hidden = activeFilters === 0;
  els.filterCount.textContent = activeFilters;

  drawIcons();
}

function itemTemplate({ app, match }) {
  const open = state.open.has(app.id) || match.viaEmail;

  const emails = app.emails.length
    ? app.emails.map((email) => `
        <li class="email">
          <a href="${inbox("from:" + app.domain + " " + email.title)}"
             target="_blank" rel="noopener noreferrer">
            <i data-lucide="${email.kind === "link" ? "link" : "mail"}"></i>
            <span class="email__title">${highlight(email.title)}</span>
            <span class="email__date">${email.date}</span>
          </a>
        </li>`).join("")
    : `<li class="email__none">No emails yet.</li>`;

  return `
    <li class="item${open ? " open" : ""}" data-id="${app.id}">
      <button class="item__row" type="button" aria-expanded="${open}">
        <span class="item__chevron"><i data-lucide="chevron-right"></i></span>
        <span class="item__label">
          <span class="item__company">${highlight(app.company)}</span>,
          ${highlight(app.role)}
        </span>
        <span class="tags">
          <span class="tag">${app.season}</span>
          <span class="tag tag--year">${app.year}</span>
        </span>
      </button>
      <div class="item__drawer">
        <div><ul class="emails">${emails}</ul></div>
      </div>
    </li>`;
}

/* ===============================================================
   Board interactions
   =============================================================== */

/* One listener covers every row and section header, rebuilt or not. */
els.board.addEventListener("click", (event) => {
  const row = event.target.closest(".item__row");
  if (row) {
    toggleIn(state.open, row.closest(".item").dataset.id);
    render();
    return;
  }

  const head = event.target.closest(".section__head");
  if (head) {
    toggleIn(state.collapsed, head.closest(".section").dataset.section);
    render();
  }
});

els.toggleAll.addEventListener("click", () => {
  if (state.open.size) state.open.clear();
  else APPLICATIONS.forEach((app) => state.open.add(app.id));
  render();
});

els.search.addEventListener("input", () => {
  state.query = els.search.value.trim();
  render();
});

/* ===============================================================
   Sort and filter menus
   =============================================================== */
function openMenu(button, menu, open) {
  menu.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
}

function closeMenus() {
  document.querySelectorAll(".menu-wrap").forEach((wrap) =>
    openMenu(wrap.querySelector(".ctrl"), wrap.querySelector(".menu"), false));
}

/* Clicks inside a menu must not reach the document handler that closes it. */
function wireMenu(buttonId, menuId) {
  const button = $(buttonId);
  const menu = $(menuId);

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const shouldOpen = menu.hidden;
    closeMenus();
    openMenu(button, menu, shouldOpen);
  });
  menu.addEventListener("click", (event) => event.stopPropagation());

  return menu;
}

const markChecked = (menu, selector, isOn) =>
  menu.querySelectorAll(selector).forEach((option) =>
    option.setAttribute("aria-checked", String(isOn(option))));

const sortMenu = wireMenu("#sortBtn", "#sortMenu");
const filterMenu = wireMenu("#filterBtn", "#filterMenu");

const syncSortMenu = () =>
  markChecked(sortMenu, "[data-sort]", (o) => o.dataset.sort === state.sort);

const syncFilterMenu = () =>
  markChecked(filterMenu, "[data-filter]",
    (o) => state.filters[o.dataset.filter].has(o.dataset.value));

sortMenu.addEventListener("click", (event) => {
  const option = event.target.closest("[data-sort]");
  if (!option) return;
  state.sort = option.dataset.sort;
  syncSortMenu();
  render();
});

filterMenu.addEventListener("click", (event) => {
  const option = event.target.closest("[data-filter]");
  if (option) toggleIn(state.filters[option.dataset.filter], option.dataset.value);

  if (event.target.closest("#clearFilters")) {
    state.filters.season.clear();
    state.filters.year.clear();
  }

  if (option || event.target.closest("#clearFilters")) {
    syncFilterMenu();
    render();
  }
});

document.addEventListener("click", closeMenus);

/* ===============================================================
   Settings: API key and how far back emails are read
   =============================================================== */
const STORE = "tracker.settings";
const CAP_MONTHS = 12;   /* the window can never reach back further */

const modal     = $("#settings");
const keyField  = $(".field--key");
const keyInput  = $("#apiKey");
const keyStatus = $("#keyStatus");
const checkBtn  = $("#checkKey");
const saveBtn   = $("#saveSettings");
const startIn   = $("#startDate");

const settings = { apiKey: "", start: "" };   /* start is a YYYY-MM-DD string */
let verifiedKey = "";                         /* the exact text that last passed */

const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const iso = (d) => d.getFullYear() +
  "-" + String(d.getMonth() + 1).padStart(2, "0") +
  "-" + String(d.getDate()).padStart(2, "0");
const monthsAgo = (n) => { const d = today(); d.setMonth(d.getMonth() - n); return d; };

const earliest = () => iso(monthsAgo(CAP_MONTHS));

/* Keep any date inside the allowed window, whether typed, picked, or stored. */
function clampDate(date) {
  const floor = earliest();
  const ceil = iso(today());
  if (!date || date < floor) return floor;
  return date > ceil ? ceil : date;
}

const setStartDate = (date) => { startIn.value = clampDate(date); };
startIn.addEventListener("change", () => setStartDate(startIn.value));

/* Stub. Swap the body for a real request to the mail provider.
   Anything not shaped like a key is rejected, which is what shows the error. */
function verifyApiKey(key) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(/^sk-[A-Za-z0-9_-]{12,}$/.test(key)), 850);
  });
}

/* The field reports its own verdict through the leading icon and border,
   so only a failure needs a written message. */
const KEY_ICONS = {
  idle:     "key-round",
  checking: "loader-circle",
  valid:    "circle-check",
  invalid:  "circle-alert",
};

function setKeyState(phase, message = "") {
  keyField.classList.toggle("is-valid", phase === "valid");
  keyField.classList.toggle("is-invalid", phase === "invalid");
  keyField.classList.toggle("is-checking", phase === "checking");

  /* Lucide has already replaced the placeholder, so swap in a fresh one. */
  const icon = document.createElement("i");
  icon.className = "field__icon";
  icon.dataset.lucide = KEY_ICONS[phase];
  keyField.querySelector(".field__icon").replaceWith(icon);

  keyStatus.dataset.state = phase;
  keyStatus.textContent = message;
  drawIcons();
}

/* Save stays locked until the text in the box is the text that passed. */
function syncKeyControls() {
  const value = keyInput.value.trim();
  checkBtn.disabled = value.length < 4;
  saveBtn.disabled = !(value && value === verifiedKey);
}

keyInput.addEventListener("input", () => {
  if (keyInput.value.trim() !== verifiedKey) setKeyState("idle");
  syncKeyControls();
});

$("#revealKey").addEventListener("click", (event) => {
  const shown = keyInput.type === "text";
  keyInput.type = shown ? "password" : "text";
  event.currentTarget.innerHTML = `<i data-lucide="${shown ? "eye" : "eye-off"}"></i>`;
  drawIcons();
});

checkBtn.addEventListener("click", async () => {
  const key = keyInput.value.trim();
  checkBtn.disabled = true;
  setKeyState("checking");

  if (await verifyApiKey(key)) {
    verifiedKey = key;
    setKeyState("valid");
  } else {
    verifiedKey = "";
    setKeyState("invalid", "Key rejected. Check it and try again.");
  }
  syncKeyControls();
});

/* ===============================================================
   Connected and disconnected views
   =============================================================== */

/* With no inbox to read, the board gives way to the blank state. */
function syncConnection() {
  const connected = !els.showBlank.checked;
  els.blank.hidden = connected;
  els.page.classList.toggle("is-disconnected", !connected);
  els.refreshBtn.disabled = !connected;
  els.refreshBtn.title = connected ? "Refresh" : "Add an API key first";
  drawIcons();
}

els.refreshBtn.addEventListener("click", () => {
  els.refreshBtn.classList.add("is-spinning");
  els.refreshBtn.disabled = true;
  setTimeout(() => {
    els.refreshBtn.classList.remove("is-spinning");
    els.refreshBtn.disabled = false;
    render();
  }, 1000);
});

/* ===============================================================
   Settings modal open and close
   =============================================================== */

/* The modal can always be dismissed. Leaving it unfinished simply
   leaves the app disconnected. */
function openSettings() {
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  startIn.min = earliest();
  startIn.max = iso(today());
  syncKeyControls();
  drawIcons();
  setTimeout(() => keyInput.focus(), 40);
}

/* Closing drops any unsaved edits back to what is stored. */
function closeSettings() {
  modal.hidden = true;
  document.body.style.overflow = "";
  keyInput.value = settings.apiKey;
  verifiedKey = settings.apiKey;
  setKeyState(settings.apiKey ? "valid" : "idle");
  setStartDate(settings.start);
  syncKeyControls();
  syncConnection();
}

$("#settingsBtn").addEventListener("click", openSettings);
$("#openFromBlank").addEventListener("click", openSettings);
modal.querySelectorAll("[data-close]").forEach((el) =>
  el.addEventListener("click", closeSettings));

saveBtn.addEventListener("click", () => {
  settings.apiKey = keyInput.value.trim();
  settings.start = clampDate(startIn.value);
  try {
    localStorage.setItem(STORE, JSON.stringify(settings));
  } catch (err) { /* storage can be blocked in private mode */ }

  els.showBlank.checked = false;   /* a saved key means the list is live */
  closeSettings();
});

/* ===============================================================
   Keyboard
   =============================================================== */
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMenus();
    if (!modal.hidden) closeSettings();
    else if (document.activeElement === els.search) {
      els.search.value = "";
      state.query = "";
      render();
    }
    return;
  }

  /* Slash jumps to search, the way most list apps do. */
  if (event.key === "/" && document.activeElement !== els.search) {
    event.preventDefault();
    els.search.focus();
  }
});

/* ===============================================================
   Start up
   =============================================================== */

/* Prototype switch: show the blank state or the list. */
els.showBlank.addEventListener("change", syncConnection);

(function init() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORE));
  } catch (err) { /* unreadable storage falls back to defaults */ }

  settings.start = (saved && saved.start) || iso(monthsAgo(6));
  setStartDate(settings.start);

  if (saved && saved.apiKey) {
    settings.apiKey = verifiedKey = keyInput.value = saved.apiKey;
    setKeyState("valid");
    syncKeyControls();
  } else {
    openSettings();
  }

  els.showBlank.checked = !settings.apiKey;
  syncConnection();

  /* Open two rows on the first paint so the expand pattern is visible. */
  [APPLICATIONS[1], APPLICATIONS[3]].forEach((app) => state.open.add(app.id));
  syncSortMenu();
  syncFilterMenu();

  els.board.classList.add("board--intro");
  render();
  setTimeout(() => els.board.classList.remove("board--intro"), 900);
})();
