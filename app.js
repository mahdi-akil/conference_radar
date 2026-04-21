const DATA_URL = "data/conferences.json";
const VIEW_STORAGE_KEY = "conference-radar-view";
const STOP_WORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);
const CORE_AREAS = [
  { value: "privacy", label: "Privacy", aliases: ["privacy", "data protection", "gdpr", "identity", "anonymity"] },
  { value: "security", label: "Security", aliases: ["security", "cybersecurity", "attack", "malware", "intrusion", "usable security"] },
  { value: "crypto", label: "Crypto", aliases: ["crypto", "cryptography", "blockchain", "zero-knowledge", "financial cryptography"] },
  { value: "energy", label: "Energy", aliases: ["energy", "smart grid", "smart grids", "power systems", "sustainability"] },
  { value: "iot", label: "IoT", aliases: ["iot", "cyber-physical", "embedded", "edge", "sensor", "rfid"] },
];
const today = startOfDay(new Date());

const state = {
  conferences: [],
  filtered: [],
  view: loadSavedView(),
};

const els = {
  search: document.querySelector("#searchInput"),
  topic: document.querySelector("#topicFilter"),
  month: document.querySelector("#monthFilter"),
  type: document.querySelector("#typeFilter"),
  sort: document.querySelector("#sortSelect"),
  viewButtons: document.querySelectorAll(".view-toggle"),
  reset: document.querySelector("#resetButton"),
  results: document.querySelector("#results"),
  template: document.querySelector("#conferenceTemplate"),
  summaryTotal: document.querySelector("#summaryTotal"),
  summaryUpcoming: document.querySelector("#summaryUpcoming"),
  summarySoon: document.querySelector("#summarySoon"),
  addConference: document.querySelector("#addConferenceButton"),
  addDialog: document.querySelector("#addConferenceDialog"),
  closeAddDialog: document.querySelector("#closeAddDialogButton"),
  addForm: document.querySelector("#addConferenceForm"),
  addOutput: document.querySelector("#conferenceJsonOutput"),
  copyConferenceJson: document.querySelector("#copyConferenceJsonButton"),
};

init();

async function init() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) {
      throw new Error(`Could not load ${DATA_URL}`);
    }
    const payload = await response.json();
    state.conferences = payload.conferences.map(normalizeConference);
    hydrateFilters(state.conferences);
    bindEvents();
    bindAdminHelper();
    applyFilters();
  } catch (error) {
    els.results.innerHTML = `<div class="empty-state">Could not load conference data.</div>`;
    console.error(error);
  }
}

function bindEvents() {
  [els.search, els.topic, els.month, els.type, els.sort].forEach((input) => {
    input.addEventListener("input", applyFilters);
  });

  els.viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view === "table" ? "table" : "cards";
      saveView(state.view);
      updateViewButtons();
      renderResults(state.filtered);
    });
  });

  els.reset.addEventListener("click", () => {
    els.search.value = "";
    els.topic.value = "";
    els.month.value = "";
    els.type.value = "";
    els.sort.value = "deadline";
    applyFilters();
  });

  updateViewButtons();
}

function loadSavedView() {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === "table" ? "table" : "cards";
  } catch {
    return "cards";
  }
}

function saveView(view) {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // The view switch still works if the browser blocks local storage.
  }
}

function bindAdminHelper() {
  if (!els.addConference || !els.addDialog || !els.addForm) return;

  els.addConference.addEventListener("click", () => {
    updateConferenceJsonOutput();
    if (typeof els.addDialog.showModal === "function") {
      els.addDialog.showModal();
    } else {
      els.addDialog.setAttribute("open", "");
    }
  });

  els.closeAddDialog.addEventListener("click", () => {
    els.addDialog.close();
  });

  els.addForm.addEventListener("input", updateConferenceJsonOutput);
  els.addForm.addEventListener("submit", (event) => {
    event.preventDefault();
    updateConferenceJsonOutput();
  });

  els.copyConferenceJson.addEventListener("click", async () => {
    updateConferenceJsonOutput();
    const text = els.addOutput.value;
    try {
      await navigator.clipboard.writeText(text);
      els.copyConferenceJson.textContent = "Copied";
      window.setTimeout(() => {
        els.copyConferenceJson.textContent = "Copy JSON";
      }, 1400);
    } catch {
      els.addOutput.select();
      document.execCommand("copy");
    }
  });
}

function normalizeConference(conference) {
  const deadlineEntries = normalizeDeadlineEntries(conference);
  const nextDeadline = chooseDisplayDeadline(deadlineEntries);
  const deadline = nextDeadline?.date || null;
  const sourceText = [
    conference.name,
    conference.acronym,
    conference.description,
    conference.location,
    conference.type,
    conference.deadline_kind,
    conference.deadline_timezone,
    conference.conference_dates,
    ...(conference.expected_conference_months || []),
    ...(conference.expected_deadline_months || []),
    ...deadlineEntries.flatMap((entry) => [entry.label, entry.kind, entry.dateText]),
    ...(conference.topics || []),
    ...(conference.keywords || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const areas = normalizeAreas(conference.areas, sourceText);
  const expectedDeadlineTerms = (conference.expected_deadline_months || []).flatMap((month) => [
    month,
    `${month} deadline`,
    "expected deadline",
  ]);
  const deadlineTerms = deadline
    ? [
        conference.submission_deadline,
        monthKey(deadline),
        String(deadline.getFullYear()),
        deadline.toLocaleString("en", { month: "long" }),
        deadline.toLocaleString("en", { month: "short" }),
        "deadline",
      ]
    : [];
  return {
    ...conference,
    areas,
    deadlineEntries,
    nextDeadline,
    deadlineDate: deadline,
    searchText: [
      sourceText,
      ...areas,
      ...(conference.topics || []),
      ...(conference.keywords || []),
      ...deadlineTerms,
      ...expectedDeadlineTerms,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  };
}

function normalizeDeadlineEntries(conference) {
  const entries = Array.isArray(conference.deadline_entries)
    ? conference.deadline_entries
    : conference.submission_deadline
      ? [
          {
            label: conference.deadline_kind || "Submission deadline",
            date: conference.submission_deadline,
            kind: conference.deadline_kind || "paper",
            timezone: conference.deadline_timezone || "",
          },
        ]
      : [];

  return entries
    .map((entry) => {
      const date = parseDate(entry.date);
      if (!date) return null;
      return {
        ...entry,
        date,
        dateText: entry.date,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

function chooseDisplayDeadline(entries) {
  if (!entries.length) return null;
  return entries.find((entry) => daysUntil(entry.date) >= 0) || entries[entries.length - 1];
}

function normalizeAreas(existingAreas, sourceText) {
  const explicit = Array.isArray(existingAreas) ? existingAreas.filter(Boolean) : [];
  const inferred = CORE_AREAS
    .filter((area) => area.aliases.some((alias) => sourceText.includes(alias)))
    .map((area) => area.value);
  return uniqueSorted([...explicit, ...inferred]);
}

function hydrateFilters(conferences) {
  const types = uniqueSorted(conferences.map((item) => item.type).filter(Boolean));

  addAreaOptions(els.topic);
  addOptions(els.type, types);
}

function addAreaOptions(select) {
  CORE_AREAS.forEach((area) => {
    const option = document.createElement("option");
    option.value = area.value;
    option.textContent = area.label;
    select.appendChild(option);
  });
}

function addOptions(select, values) {
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = toTitle(value);
    select.appendChild(option);
  });
}

function applyFilters() {
  const query = els.search.value.trim().toLowerCase();
  const words = query.split(/\s+/).filter((word) => word && !STOP_WORDS.has(word));
  const selectedTopic = els.topic.value;
  const selectedMonth = els.month.value;
  const selectedType = els.type.value;

  let filtered = state.conferences.filter((conference) => {
    const matchesQuery = words.every((word) => conference.searchText.includes(word));
    const matchesTopic = !selectedTopic || (conference.areas || []).includes(selectedTopic);
    const matchesType = !selectedType || conference.type === selectedType;
    const matchesMonth = !selectedMonth || monthKey(conference.deadlineDate) === selectedMonth;
    return matchesQuery && matchesTopic && matchesType && matchesMonth;
  });

  filtered = sortConferences(filtered, els.sort.value, words);
  const displayable = filtered.filter(isDisplayableConference);
  state.filtered = displayable;

  renderSummary(displayable);
  renderResults(displayable);
}

function sortConferences(conferences, sortMode, words) {
  const items = [...conferences];

  if (sortMode === "name") {
    return items.sort((a, b) => a.name.localeCompare(b.name));
  }

  if (sortMode === "relevance" && words.length) {
    return items.sort((a, b) => score(b, words) - score(a, words) || compareDeadline(a, b));
  }

  return items.sort(compareDeadline);
}

function compareDeadline(a, b) {
  const aTime = a.deadlineDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const bTime = b.deadlineDate?.getTime() ?? Number.POSITIVE_INFINITY;
  return aTime - bTime;
}

function score(conference, words) {
  return words.reduce((total, word) => {
    const acronymHit = conference.acronym?.toLowerCase().includes(word) ? 4 : 0;
    const topicHit = [...(conference.areas || []), ...(conference.topics || [])].some((topic) => topic.includes(word)) ? 3 : 0;
    const generalHit = conference.searchText.includes(word) ? 1 : 0;
    return total + acronymHit + topicHit + generalHit;
  }, 0);
}

function renderSummary(conferences) {
  const upcoming = conferences.filter((conference) => daysUntil(conference.deadlineDate) >= 0);
  const soon = upcoming.filter((conference) => daysUntil(conference.deadlineDate) <= 60);
  els.summaryTotal.textContent = conferences.length;
  els.summaryUpcoming.textContent = upcoming.length;
  els.summarySoon.textContent = soon.length;
}

function renderResults(conferences) {
  els.results.replaceChildren();
  els.results.classList.toggle("table-view", state.view === "table");
  els.results.classList.toggle("card-view", state.view !== "table");

  if (!conferences.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No conferences match the current filters.";
    els.results.appendChild(empty);
    return;
  }

  if (state.view === "table") {
    renderTableResults(conferences);
    return;
  }

  conferences.forEach((conference) => {
    const node = els.template.content.cloneNode(true);
    const card = node.querySelector(".conference-card");
    card.querySelector(".acronym").textContent = conference.acronym || "Conference";
    card.querySelector("h2").textContent = conference.name;

    card.querySelector(".date-chip").textContent = formatDeadline(conference);
    const daysChip = card.querySelector(".days-chip");
    daysChip.textContent = formatDays(conference.deadlineDate);
    daysChip.classList.add(dayClass(conference.deadlineDate));
    card.querySelector(".details").textContent = conference.description || "";

    const tagRow = card.querySelector(".tag-row");
    (conference.topics || []).forEach((topic) => {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = toTitle(topic);
      tagRow.appendChild(tag);
    });

    card.querySelector(".location").textContent = conference.location || "TBA";
    card.querySelector(".conference-date").textContent = conference.conference_dates || "TBA";
    card.querySelector(".checked-date").textContent = conference.last_checked || "Not checked";

    setLink(card.querySelector(".website-link"), conference.website_url);
    setLink(card.querySelector(".cfp-link"), conference.cfp_url || conference.website_url);
    setCalendarButton(card.querySelector(".calendar-button"), conference);
    els.results.appendChild(node);
  });
}

function renderTableResults(conferences) {
  const shell = document.createElement("div");
  shell.className = "table-shell";

  const table = document.createElement("table");
  table.className = "conference-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["Deadline", "Days", "Venue", "Areas", "Location", "Conference", "Links"].forEach((heading) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = heading;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  const tbody = document.createElement("tbody");
  conferences.forEach((conference) => {
    const row = document.createElement("tr");

    const deadlineCell = tableCell("deadline-cell");
    const deadline = document.createElement("span");
    deadline.className = "table-date";
    deadline.textContent = formatDeadline(conference);
    deadlineCell.appendChild(deadline);

    const daysCell = tableCell();
    const days = document.createElement("span");
    days.className = `table-days ${dayClass(conference.deadlineDate)}`;
    days.textContent = formatDays(conference.deadlineDate);
    daysCell.appendChild(days);

    const venueCell = tableCell("venue-cell");
    const acronym = document.createElement("span");
    acronym.className = "table-acronym";
    acronym.textContent = conference.acronym || "Conference";
    const name = document.createElement("span");
    name.className = "table-name";
    name.textContent = conference.name;
    venueCell.append(acronym, name);

    const areasCell = tableCell();
    areasCell.textContent = (conference.areas || []).map(toTitle).join(", ") || "TBA";

    const locationCell = tableCell();
    locationCell.textContent = conference.location || "TBA";

    const dateCell = tableCell();
    dateCell.textContent = conference.conference_dates || "TBA";

    const linksCell = tableCell("table-actions");
    const calendarButton = document.createElement("button");
    calendarButton.className = "calendar-button compact";
    calendarButton.type = "button";
    calendarButton.textContent = "Add deadline";
    setCalendarButton(calendarButton, conference);
    linksCell.appendChild(calendarButton);
    appendTableLink(linksCell, "Website", conference.website_url);
    appendTableLink(linksCell, "CFP", conference.cfp_url || conference.website_url);

    row.append(deadlineCell, daysCell, venueCell, areasCell, locationCell, dateCell, linksCell);
    tbody.appendChild(row);
  });

  table.append(thead, tbody);
  shell.appendChild(table);
  els.results.appendChild(shell);
}

function tableCell(className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  return cell;
}

function appendTableLink(container, label, url) {
  if (!url) return;
  const link = document.createElement("a");
  link.className = "text-link";
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = label;
  container.appendChild(link);
}

function updateViewButtons() {
  els.viewButtons.forEach((button) => {
    const isActive = button.dataset.view === state.view;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function isDisplayableConference(conference) {
  return Boolean(conference.deadlineDate);
}

function setLink(anchor, url) {
  if (!url) {
    anchor.remove();
    return;
  }
  anchor.href = url;
}

function updateConferenceJsonOutput() {
  if (!els.addForm || !els.addOutput) return;
  const record = buildConferenceRecord(new FormData(els.addForm));
  els.addOutput.value = JSON.stringify(record, null, 2);
}

function buildConferenceRecord(formData) {
  const name = clean(formData.get("name"));
  const acronym = clean(formData.get("acronym"));
  const deadline = clean(formData.get("submission_deadline"));
  const expectedDeadlineMonths = splitList(formData.get("expected_deadline_months"));
  const areas = formData.getAll("areas").map(clean).filter(Boolean);
  const topics = areas.length ? areas : inferTopicsFromText(`${name} ${acronym} ${clean(formData.get("description"))}`);
  const idParts = [acronym || name || "conference", deadline ? deadline.slice(0, 4) : new Date().getFullYear()];

  return {
    id: slugify(idParts.join("-")),
    name,
    acronym,
    type: clean(formData.get("type")) || "conference",
    areas,
    topics,
    keywords: [],
    submission_deadline: deadline,
    expected_deadline_months: expectedDeadlineMonths,
    deadline_kind: "paper",
    deadline_timezone: "AoE",
    notification_date: clean(formData.get("notification_date")),
    conference_dates: clean(formData.get("conference_dates")),
    expected_conference_months: [],
    location: clean(formData.get("location")) || "TBA",
    website_url: clean(formData.get("website_url")),
    cfp_url: clean(formData.get("cfp_url")),
    description: clean(formData.get("description")),
    rank: clean(formData.get("rank")),
    notes: clean(formData.get("notes")),
    auto_check: formData.get("auto_check") === "on",
    last_checked: formatIsoDate(new Date()),
    deadline_confidence: deadline ? "manual" : "expected",
  };
}

function inferTopicsFromText(text) {
  const source = text.toLowerCase();
  return CORE_AREAS.filter((area) => area.aliases.some((alias) => source.includes(alias))).map((area) => area.value);
}

function splitList(value) {
  return clean(value)
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function clean(value) {
  return String(value || "").trim();
}

function setCalendarButton(button, conference) {
  if (!conference.deadlineDate) {
    button.hidden = true;
    return;
  }

  button.addEventListener("click", () => {
    downloadCalendarEvent(conference);
  });
}

function downloadCalendarEvent(conference) {
  const filename = `${slugify(conference.acronym || conference.name)}-${conference.submission_deadline}-deadline.ics`;
  const blob = new Blob([buildCalendarEvent(conference)], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function buildCalendarEvent(conference) {
  const start = formatIcsDate(conference.deadlineDate);
  const end = formatIcsDate(addDays(conference.deadlineDate, 1));
  const created = formatIcsDateTime(new Date());
  const sourceUrl = conference.cfp_url || conference.website_url || "";
  const deadlineLabel = conference.nextDeadline?.label || conference.deadline_kind || "Submission deadline";
  const title = `${deadlineLabel}: ${conference.acronym || conference.name}`;
  const description = [
    `${conference.name} (${conference.acronym || "conference"})`,
    conference.nextDeadline?.kind ? `Deadline type: ${conference.nextDeadline.kind}` : conference.deadline_kind ? `Deadline type: ${conference.deadline_kind}` : "",
    conference.nextDeadline?.timezone ? `Timezone: ${conference.nextDeadline.timezone}` : conference.deadline_timezone ? `Timezone: ${conference.deadline_timezone}` : "",
    conference.conference_dates ? `Conference dates: ${conference.conference_dates}` : "",
    conference.location ? `Location: ${conference.location}` : "",
    sourceUrl ? `Source: ${sourceUrl}` : "",
    conference.notes ? `Notes: ${conference.notes}` : "",
  ]
    .filter(Boolean)
    .join("\\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Conference Radar//Deadline Event//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${conference.id}-${conference.submission_deadline}@conference-radar`,
    `DTSTAMP:${created}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${escapeIcs(title)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    sourceUrl ? `URL:${escapeIcs(sourceUrl)}` : "",
    conference.location ? `LOCATION:${escapeIcs(conference.location)}` : "",
    "TRANSP:TRANSPARENT",
    buildAlarm("P30D", "Conference deadline in 30 days"),
    buildAlarm("P14D", "Conference deadline in 14 days"),
    buildAlarm("P3D", "Conference deadline in 3 days"),
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .filter(Boolean)
    .join("\r\n");
}

function buildAlarm(trigger, description) {
  return [
    "BEGIN:VALARM",
    `TRIGGER:-${trigger}`,
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcs(description)}`,
    "END:VALARM",
  ].join("\r\n");
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function toTitle(value) {
  return value
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : startOfDay(date);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function daysUntil(date) {
  if (!date) return Number.POSITIVE_INFINITY;
  return Math.ceil((date.getTime() - today.getTime()) / 86_400_000);
}

function monthKey(date) {
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatDate(date) {
  if (!date) return "Deadline TBA";
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDeadline(conference) {
  if (conference.nextDeadline) {
    const label = conference.nextDeadline.label ? `${conference.nextDeadline.label}: ` : "";
    return `${label}${formatDate(conference.nextDeadline.date)}`;
  }
  if (conference.expected_deadline_months?.length) {
    return `Expected ${conference.expected_deadline_months.map(toTitle).join(", ")}`;
  }
  return "Deadline TBA";
}

function formatDays(date) {
  const days = daysUntil(date);
  if (!Number.isFinite(days)) return "TBA";
  if (days < 0) return "closed";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `${days} days`;
}

function dayClass(date) {
  const days = daysUntil(date);
  if (days < 0) return "closed";
  if (days <= 60) return "soon";
  return "";
}

function formatIcsDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
}

function formatIsoDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatIcsDateTime(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}
