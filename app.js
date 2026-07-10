const DATA_URL = "data/conferences.json";
const VIEW_STORAGE_KEY = "conference-radar-view";
const FAVORITES_STORAGE_KEY = "conference-radar-favorites";
const NO_RANK_FILTER_VALUE = "__no_rank__";
const STOP_WORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);
const CORE_AREAS = [
  { value: "privacy", label: "Privacy", aliases: ["privacy", "data protection", "gdpr", "identity", "anonymity"] },
  { value: "security", label: "Security", aliases: ["security", "cybersecurity", "attack", "malware", "intrusion", "usable security"] },
  { value: "crypto", label: "Crypto", aliases: ["crypto", "cryptography", "blockchain", "zero-knowledge", "financial cryptography"] },
  { value: "energy", label: "Energy", aliases: ["energy", "smart grid", "smart grids", "power systems", "sustainability"] },
  { value: "iot", label: "IoT", aliases: ["iot", "cyber-physical", "embedded", "edge", "sensor", "rfid"] },
  { value: "systems", label: "Systems", aliases: ["systems", "distributed systems", "operating systems", "software systems", "dependable systems"] },
  { value: "software", label: "Software Engineering", aliases: ["software engineering", "program repair", "code generation", "code comprehension", "software testing", "repository mining", "software maintenance", "developer tools"] },
  { value: "ai", label: "AI / ML", aliases: ["artificial intelligence", "machine learning", "large language model", "llm", "foundation model", "agentic"] },
  { value: "networking", label: "Networking", aliases: ["networking", "network", "wireless", "communications", "internet", "service management"] },
  { value: "hci", label: "HCI", aliases: ["hci", "human factors", "human-centered", "usable privacy", "usable security", "user studies"] },
  { value: "policy", label: "Policy", aliases: ["policy", "law", "regulation", "governance", "compliance", "digital rights"] },
];
const today = startOfDay(new Date());
let favoritesCalendarUrl = "";

const state = {
  conferences: [],
  filtered: [],
  matching: [],
  matchingWithClosed: [],
  hiddenClosed: 0,
  summaryMode: "all",
  view: loadSavedView(),
  favorites: loadSavedFavorites(),
};

const els = {
  search: document.querySelector("#searchInput"),
  topic: document.querySelector("#topicFilter"),
  month: document.querySelector("#monthFilter"),
  type: document.querySelector("#typeFilter"),
  rank: document.querySelector("#rankFilter"),
  sort: document.querySelector("#sortSelect"),
  includeClosed: document.querySelector("#includeClosedToggle"),
  includeClosedTitle: document.querySelector("#includeClosedTitle"),
  includeClosedCount: document.querySelector("#includeClosedCount"),
  exportFavorites: document.querySelector("#exportFavoritesButton"),
  viewButtons: document.querySelectorAll(".view-toggle"),
  reset: document.querySelector("#resetButton"),
  results: document.querySelector("#results"),
  resultsMeta: document.querySelector("#resultsMeta"),
  template: document.querySelector("#conferenceTemplate"),
  summaryAllButton: document.querySelector("#summaryAllButton"),
  summaryUpcomingButton: document.querySelector("#summaryUpcomingButton"),
  summaryTbaButton: document.querySelector("#summaryTbaButton"),
  summaryFavoritesButton: document.querySelector("#summaryFavoritesButton"),
  summaryTotal: document.querySelector("#summaryTotal"),
  summaryUpcoming: document.querySelector("#summaryUpcoming"),
  summaryTba: document.querySelector("#summaryTba"),
  summaryFavorites: document.querySelector("#summaryFavorites"),
  addConference: document.querySelector("#addConferenceButton"),
  addDialog: document.querySelector("#addConferenceDialog"),
  closeAddDialog: document.querySelector("#closeAddDialogButton"),
  addForm: document.querySelector("#addConferenceForm"),
  singleDeadlineField: document.querySelector("#singleDeadlineField"),
  multipleDeadlinesToggle: document.querySelector("#multipleDeadlinesToggle"),
  deadlineEntriesSection: document.querySelector("#deadlineEntriesSection"),
  deadlineEntriesList: document.querySelector("#deadlineEntriesList"),
  addDeadlineEntryButton: document.querySelector("#addDeadlineEntryButton"),
  deadlineEntryTemplate: document.querySelector("#deadlineEntryTemplate"),
  addOutput: document.querySelector("#conferenceJsonOutput"),
  copyConferenceJson: document.querySelector("#copyConferenceJsonButton"),
  detailsDialog: document.querySelector("#conferenceDetailsDialog"),
  detailsAcronym: document.querySelector("#conferenceDetailsAcronym"),
  detailsTitle: document.querySelector("#conferenceDetailsTitle"),
  detailsContent: document.querySelector("#conferenceDetailsContent"),
  closeDetails: document.querySelector("#closeConferenceDetailsButton"),
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
  [els.search, els.topic, els.month, els.type, els.rank, els.sort, els.includeClosed].forEach((input) => {
    input.addEventListener("input", applyFilters);
  });

  els.exportFavorites.addEventListener("click", (event) => {
    if (els.exportFavorites.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
    }
  });

  els.viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view === "table" ? "table" : "cards";
      saveView(state.view);
      updateViewButtons();
      renderResults(state.filtered);
    });
  });

  els.summaryAllButton.addEventListener("click", () => {
    state.summaryMode = "all";
    applyFilters();
  });

  els.summaryUpcomingButton.addEventListener("click", () => {
    state.summaryMode = "upcoming";
    applyFilters();
  });

  els.summaryTbaButton.addEventListener("click", () => {
    state.summaryMode = "tba";
    applyFilters();
  });

  els.summaryFavoritesButton.addEventListener("click", () => {
    state.summaryMode = "favorites";
    applyFilters();
  });

  els.reset.addEventListener("click", () => {
    els.search.value = "";
    els.topic.value = "";
    els.month.value = "";
    els.type.value = "";
    els.rank.value = "";
    els.sort.value = "deadline";
    els.includeClosed.checked = false;
    state.summaryMode = "all";
    applyFilters();
  });

  els.closeDetails.addEventListener("click", () => {
    els.detailsDialog.close();
  });

  els.detailsDialog.addEventListener("click", (event) => {
    if (event.target === els.detailsDialog) {
      els.detailsDialog.close();
    }
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

function loadSavedFavorites() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function saveFavorites() {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...state.favorites]));
  } catch {
    // Favorites still work for this page session if the browser blocks local storage.
  }
}

function bindAdminHelper() {
  if (!els.addConference || !els.addDialog || !els.addForm) return;

  els.addConference.addEventListener("click", () => {
    syncDeadlineMode();
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
    if (!els.addForm.reportValidity()) {
      updateConferenceJsonOutput();
      return;
    }
    updateConferenceJsonOutput();
  });

  els.multipleDeadlinesToggle?.addEventListener("change", () => {
    if (els.multipleDeadlinesToggle.checked && !els.deadlineEntriesList.children.length) {
      addDeadlineEntryRow();
    }
    syncDeadlineMode();
    updateConferenceJsonOutput();
  });

  els.addDeadlineEntryButton?.addEventListener("click", () => {
    addDeadlineEntryRow();
    updateConferenceJsonOutput();
  });

  syncDeadlineMode();

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

function syncDeadlineMode() {
  if (!els.multipleDeadlinesToggle || !els.deadlineEntriesSection || !els.singleDeadlineField) return;
  const multiple = els.multipleDeadlinesToggle.checked;
  els.deadlineEntriesSection.hidden = !multiple;
  els.singleDeadlineField.hidden = multiple;
}

function addDeadlineEntryRow(entry = {}) {
  if (!els.deadlineEntryTemplate || !els.deadlineEntriesList) return;
  const node = els.deadlineEntryTemplate.content.cloneNode(true);
  const row = node.querySelector(".deadline-entry-row");
  row.querySelector(".entry-label").value = entry.label || "";
  row.querySelector(".entry-date").value = entry.date || "";
  row.querySelector(".entry-kind").value = entry.kind || "paper submission";
  row.querySelector(".entry-timezone").value = entry.timezone || "AoE";
  row.querySelector(".remove-deadline-entry").addEventListener("click", () => {
    row.remove();
    updateConferenceJsonOutput();
  });
  els.deadlineEntriesList.appendChild(row);
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
  const ranks = uniqueSorted(conferences.map((item) => item.rank).filter(Boolean));

  addAreaOptions(els.topic);
  addOptions(els.type, types);
  addOptions(els.rank, ranks, formatRank);
  addOptions(els.rank, [NO_RANK_FILTER_VALUE], () => "No rank");
}

function addAreaOptions(select) {
  CORE_AREAS.forEach((area) => {
    const option = document.createElement("option");
    option.value = area.value;
    option.textContent = area.label;
    select.appendChild(option);
  });
}

function addOptions(select, values, formatter = toTitle) {
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = formatter(value);
    select.appendChild(option);
  });
}

function applyFilters() {
  const query = els.search.value.trim().toLowerCase();
  const words = query.split(/\s+/).filter((word) => word && !STOP_WORDS.has(word));
  const selectedTopic = els.topic.value;
  const selectedMonth = els.month.value;
  const selectedType = els.type.value;
  const selectedRank = els.rank.value;

  const matchingBeforeClosed = state.conferences.filter((conference) => {
    const matchesQuery = words.every((word) => conference.searchText.includes(word));
    const matchesTopic = !selectedTopic || (conference.areas || []).includes(selectedTopic);
    const matchesType = !selectedType || conference.type === selectedType;
    const matchesRank =
      !selectedRank ||
      (selectedRank === NO_RANK_FILTER_VALUE ? !conference.rank : conference.rank === selectedRank);
    const matchesMonth = !selectedMonth || monthKey(conference.deadlineDate) === selectedMonth;
    return matchesQuery && matchesTopic && matchesType && matchesRank && matchesMonth;
  });

  const sortedMatching = sortConferences(matchingBeforeClosed, els.sort.value);
  const expiredCount = sortedMatching.filter(isClosedConference).length;
  state.hiddenClosed = els.includeClosed.checked ? 0 : expiredCount;
  const filtered = els.includeClosed.checked
    ? sortedMatching
    : sortedMatching.filter((conference) => !isClosedConference(conference));
  const upcoming = filtered.filter(isUpcomingConference);
  const tba = filtered.filter(isTbaConference);
  const favorites = sortedMatching.filter(isFavoriteConference);
  const visible = pickSummaryResults(filtered, upcoming, tba, favorites);
  state.matching = filtered;
  state.matchingWithClosed = sortedMatching;
  state.filtered = visible;

  updateExpiredControl(expiredCount);
  renderSummary(filtered, upcoming, tba, favorites);
  renderResultsMeta(filtered, visible, upcoming, tba, favorites);
  renderResults(visible);
}

function pickSummaryResults(allConferences, upcomingConferences, tbaConferences, favoriteConferences) {
  if (state.summaryMode === "upcoming") return upcomingConferences;
  if (state.summaryMode === "tba") return tbaConferences;
  if (state.summaryMode === "favorites") return favoriteConferences;
  return allConferences;
}

function sortConferences(conferences, sortMode) {
  const items = [...conferences];

  if (sortMode === "name") {
    return items.sort((a, b) => a.name.localeCompare(b.name));
  }

  return items.sort(compareDeadline);
}

function compareDeadline(a, b) {
  const aTime = a.deadlineDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const bTime = b.deadlineDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const aClosed = daysUntil(a.deadlineDate) < 0;
  const bClosed = daysUntil(b.deadlineDate) < 0;

  if (aClosed !== bClosed) {
    return aClosed ? 1 : -1;
  }

  return aClosed ? bTime - aTime : aTime - bTime;
}

function renderSummary(matchingConferences, upcomingConferences, tbaConferences, favoriteConferences) {
  els.summaryTotal.textContent = matchingConferences.length;
  els.summaryUpcoming.textContent = upcomingConferences.length;
  els.summaryTba.textContent = tbaConferences.length;
  els.summaryFavorites.textContent = favoriteConferences.length;
  els.summaryAllButton.classList.toggle("active", state.summaryMode === "all");
  els.summaryUpcomingButton.classList.toggle("active", state.summaryMode === "upcoming");
  els.summaryTbaButton.classList.toggle("active", state.summaryMode === "tba");
  els.summaryFavoritesButton.classList.toggle("active", state.summaryMode === "favorites");
  els.summaryAllButton.setAttribute("aria-pressed", String(state.summaryMode === "all"));
  els.summaryUpcomingButton.setAttribute("aria-pressed", String(state.summaryMode === "upcoming"));
  els.summaryTbaButton.setAttribute("aria-pressed", String(state.summaryMode === "tba"));
  els.summaryFavoritesButton.setAttribute("aria-pressed", String(state.summaryMode === "favorites"));
  els.summaryUpcomingButton.disabled = upcomingConferences.length === 0;
  els.summaryTbaButton.disabled = tbaConferences.length === 0;
  els.summaryFavoritesButton.disabled = favoriteConferences.length === 0;
  updateFavoriteExportButton();
}

function renderResultsMeta(matchingConferences, visibleConferences, upcomingConferences, tbaConferences, favoriteConferences) {
  if (!els.resultsMeta) return;
  const closedNote = state.hiddenClosed
    ? ` ${state.hiddenClosed} expired ${state.hiddenClosed === 1 ? "conference is" : "conferences are"} hidden.`
    : "";

  if (state.summaryMode === "upcoming") {
    els.resultsMeta.textContent = `Showing ${visibleConferences.length} of ${matchingConferences.length} conferences with deadlines in the next 30 days.${closedNote}`;
    return;
  }

  if (state.summaryMode === "tba") {
    els.resultsMeta.textContent = `Showing ${visibleConferences.length} of ${matchingConferences.length} conferences with deadline TBA or still expected.${closedNote}`;
    return;
  }

  if (state.summaryMode === "favorites") {
    const label = visibleConferences.length === 1 ? "favorite conference" : "favorite conferences";
    const expiredFavorites = favoriteConferences.filter(isClosedConference).length;
    const expiredNote = expiredFavorites
      ? ` ${expiredFavorites} expired ${expiredFavorites === 1 ? "favorite is" : "favorites are"} included.`
      : "";
    els.resultsMeta.textContent = `Showing ${visibleConferences.length} ${label}.${expiredNote}`;
    return;
  }

  els.resultsMeta.textContent = `Showing ${visibleConferences.length} matching conferences.${closedNote}`;
}

function updateExpiredControl(expiredCount) {
  const isShowingExpired = els.includeClosed.checked;
  els.includeClosed.closest(".filter-toggle")?.classList.toggle("showing-expired", isShowingExpired);
  els.includeClosedTitle.textContent = isShowingExpired ? "Hide expired conferences" : "Show expired conferences";
  els.includeClosedCount.textContent = expiredCount
    ? `${expiredCount} matching ${expiredCount === 1 ? "conference" : "conferences"} ${isShowingExpired ? "shown" : "hidden"}`
    : "No expired conferences match the current filters";
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
    applyStatusBadge(card.querySelector(".status-badge"), conference);
    applyRankBadge(card.querySelector(".rank-badge"), conference);
    setFavoriteButton(card.querySelector(".favorite-button"), conference);

    card.querySelector(".date-chip").textContent = formatDeadline(conference);
    const daysChip = card.querySelector(".days-chip");
    daysChip.textContent = formatDays(conference.deadlineDate);
    const dayState = dayClass(conference.deadlineDate);
    if (dayState) {
      daysChip.classList.add(dayState);
    }
    populateTrustRow(card.querySelector(".trust-row"), conference);
    card.querySelector(".details").textContent = conference.description || "";

    const tagRow = card.querySelector(".tag-row");
    const tags = getCardTags(conference);
    tags.visible.forEach((tag) => {
      tagRow.appendChild(buildTag(tag));
    });
    if (tags.hidden.length > 0) {
      tagRow.appendChild(buildMoreTagButton(tags.hidden, tagRow));
    }

    card.querySelector(".location").textContent = conference.location || "TBA";
    card.querySelector(".conference-date").textContent = conference.conference_dates || "TBA";

    setLink(card.querySelector(".website-link"), conference.website_url);
    setLink(card.querySelector(".cfp-link"), conference.cfp_url || conference.website_url);
    setCalendarButton(card.querySelector(".calendar-button"), conference);
    card.querySelector(".details-button").addEventListener("click", () => {
      openConferenceDetails(conference);
    });
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
  ["Deadline", "Venue", "Rank", "Areas", "Location", "Links"].forEach((heading) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = heading;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  const tbody = document.createElement("tbody");
  conferences.forEach((conference) => {
    const row = document.createElement("tr");
    const status = getConferenceStatus(conference);

    const deadlineCell = tableCell("deadline-cell");
    const deadline = document.createElement("span");
    deadline.className = "table-date";
    deadline.textContent = formatDeadline(conference);
    const days = document.createElement("span");
    days.className = `table-days ${dayClass(conference.deadlineDate)}`;
    days.textContent = formatDays(conference.deadlineDate);
    const statusBadge = document.createElement("span");
    statusBadge.className = `status-badge ${status.className}`;
    statusBadge.textContent = status.label;
    deadlineCell.append(deadline, days, statusBadge);

    const venueCell = tableCell("venue-cell");
    const acronym = document.createElement("span");
    acronym.className = "table-acronym";
    acronym.textContent = conference.acronym || "Conference";
    const name = document.createElement("span");
    name.className = "table-name";
    name.textContent = conference.name;
    const meta = document.createElement("span");
    meta.className = "table-meta";
    meta.textContent = conference.conference_dates ? `Conference: ${conference.conference_dates}` : "Conference: TBA";
    venueCell.append(acronym, name, meta, buildTrustRow(conference, "table-trust"));

    const areasCell = tableCell("areas-cell");
    if ((conference.areas || []).length) {
      (conference.areas || []).forEach((area) => {
        areasCell.appendChild(buildTag(toTitle(area), "table-tag"));
      });
    } else {
      areasCell.textContent = "TBA";
    }

    const rankCell = tableCell("rank-cell");
    rankCell.appendChild(buildTag(formatRank(conference.rank), "rank-tag table-rank-tag"));

    const locationCell = tableCell();
    locationCell.textContent = conference.location || "TBA";

    const linksCell = tableCell();
    const actions = document.createElement("div");
    actions.className = "table-actions";
    const favoriteButton = document.createElement("button");
    favoriteButton.className = "favorite-button compact";
    favoriteButton.type = "button";
    favoriteButton.innerHTML = `<span aria-hidden="true">☆</span>`;
    setFavoriteButton(favoriteButton, conference);
    actions.appendChild(favoriteButton);
    const calendarButton = document.createElement("button");
    calendarButton.className = "calendar-button compact";
    calendarButton.type = "button";
    calendarButton.textContent = "Add to calendar";
    setCalendarButton(calendarButton, conference);
    actions.appendChild(calendarButton);
    const detailsButton = document.createElement("button");
    detailsButton.className = "secondary-button compact";
    detailsButton.type = "button";
    detailsButton.textContent = "Details";
    detailsButton.addEventListener("click", () => {
      openConferenceDetails(conference);
    });
    actions.appendChild(detailsButton);
    appendTableLink(actions, "Website", conference.website_url);
    appendTableLink(actions, "CFP", conference.cfp_url || conference.website_url);
    linksCell.appendChild(actions);

    row.append(deadlineCell, venueCell, rankCell, areasCell, locationCell, linksCell);
    tbody.appendChild(row);
  });

  table.append(thead, tbody);
  shell.appendChild(table);
  els.results.appendChild(shell);
}

function setFavoriteButton(button, conference) {
  button.dataset.conferenceId = conference.id;
  setFavoriteButtonState(button, conference);

  button.addEventListener("click", () => {
    toggleFavorite(conference.id);
  });
}

function setFavoriteButtonState(button, conference) {
  const isFavorite = state.favorites.has(conference.id);
  button.classList.toggle("active", isFavorite);
  button.setAttribute("aria-pressed", String(isFavorite));
  button.setAttribute("aria-label", `${isFavorite ? "Remove" : "Add"} ${conference.acronym || conference.name} ${isFavorite ? "from" : "to"} favorites`);
  button.title = isFavorite ? "Remove from favorites" : "Add to favorites";
  button.querySelector("span").textContent = isFavorite ? "★" : "☆";
}

function toggleFavorite(conferenceId) {
  if (state.favorites.has(conferenceId)) {
    state.favorites.delete(conferenceId);
  } else {
    state.favorites.add(conferenceId);
  }
  saveFavorites();

  if (state.summaryMode === "favorites") {
    applyFilters();
    updateFavoriteControls();
    return;
  }

  updateFavoriteControls();
  renderCurrentSummary();
}

function updateFavoriteControls() {
  document.querySelectorAll(".favorite-button[data-conference-id]").forEach((button) => {
    const conference = state.conferences.find((item) => item.id === button.dataset.conferenceId);
    if (conference) {
      setFavoriteButtonState(button, conference);
    }
  });
}

function renderCurrentSummary() {
  const upcoming = state.matching.filter(isUpcomingConference);
  const tba = state.matching.filter(isTbaConference);
  const favorites = state.matchingWithClosed.filter(isFavoriteConference);
  renderSummary(state.matching, upcoming, tba, favorites);
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

function isUpcomingConference(conference) {
  const days = daysUntil(conference.deadlineDate);
  return days >= 0 && days <= 30;
}

function isTbaConference(conference) {
  return !conference.deadlineDate;
}

function isClosedConference(conference) {
  return Boolean(conference.deadlineDate) && daysUntil(conference.deadlineDate) < 0;
}

function isFavoriteConference(conference) {
  return state.favorites.has(conference.id);
}

function getConferenceStatus(conference) {
  if (!conference.deadlineDate) {
    return {
      label: conference.expected_deadline_months?.length ? "Expected" : "TBA",
      className: "tba",
    };
  }
  const days = daysUntil(conference.deadlineDate);
  if (days < 0) {
    return { label: "Closed", className: "closed" };
  }
  if (days <= 30) {
    return { label: "Next 30 days", className: "soon" };
  }
  return { label: "Open", className: "open" };
}

function applyStatusBadge(element, conference) {
  const status = getConferenceStatus(conference);
  element.className = `status-badge ${status.className}`;
  element.textContent = status.label;
}

function applyRankBadge(element, conference) {
  element.hidden = false;
  element.textContent = `Rank ${formatRank(conference.rank)}`;
}

function buildTrustRow(conference, extraClass = "") {
  const row = document.createElement("div");
  row.className = extraClass ? `trust-row ${extraClass}` : "trust-row";
  populateTrustRow(row, conference);
  return row;
}

function populateTrustRow(row, conference) {
  const confidence = getConfidenceInfo(conference.deadline_confidence);
  const confidenceBadge = document.createElement("span");
  confidenceBadge.className = `confidence-badge ${confidence.className}`;
  confidenceBadge.textContent = confidence.label;
  confidenceBadge.title = confidence.title;

  const freshness = getFreshnessInfo(conference.last_checked);
  const freshnessLabel = document.createElement("span");
  freshnessLabel.className = `freshness-label ${freshness.className}`.trim();
  freshnessLabel.textContent = freshness.label;
  freshnessLabel.title = freshness.title;

  row.replaceChildren(confidenceBadge, freshnessLabel);
}

function getConfidenceInfo(value) {
  const confidence = String(value || "").trim().toLowerCase();
  if (confidence === "official") {
    return { label: "Official source", className: "official", title: "Deadline taken from an official conference source" };
  }
  if (confidence === "manual") {
    return { label: "Manually checked", className: "manual", title: "Deadline was entered or verified manually" };
  }
  if (confidence === "expected") {
    return { label: "Expected", className: "expected", title: "Deadline is an estimate and still needs confirmation" };
  }
  return { label: "Unverified", className: "unverified", title: "Deadline source has not been classified" };
}

function getFreshnessInfo(value) {
  const checkedDate = parseDate(value);
  if (!checkedDate) {
    return { label: "Not checked", className: "stale", title: "No last-checked date is available" };
  }

  const age = Math.max(0, -daysUntil(checkedDate));
  const stale = age > 90;
  return {
    label: `Checked ${formatDate(checkedDate)}`,
    className: stale ? "stale" : "",
    title: stale ? `Last checked ${age} days ago` : `Last checked ${age === 0 ? "today" : `${age} days ago`}`,
  };
}

function openConferenceDetails(conference) {
  els.detailsAcronym.textContent = conference.acronym || "Conference";
  els.detailsTitle.textContent = conference.name;
  els.detailsContent.replaceChildren();

  const overview = document.createElement("div");
  overview.className = "details-overview";
  const statusBadge = document.createElement("span");
  applyStatusBadge(statusBadge, conference);
  const rankBadge = document.createElement("span");
  rankBadge.className = "rank-badge";
  applyRankBadge(rankBadge, conference);
  overview.append(statusBadge, rankBadge, buildTrustRow(conference, "details-trust"));
  els.detailsContent.appendChild(overview);

  const deadlineSection = buildDetailsSection("Deadlines");
  const deadlineList = document.createElement("div");
  deadlineList.className = "details-deadline-list";
  if (conference.deadlineEntries.length) {
    conference.deadlineEntries.forEach((entry) => {
      const item = document.createElement("div");
      item.className = `details-deadline-item ${daysUntil(entry.date) < 0 ? "closed" : ""}`.trim();
      const heading = document.createElement("strong");
      heading.textContent = entry.label || entry.kind || "Submission deadline";
      const date = document.createElement("span");
      date.textContent = formatDate(entry.date);
      const metadata = document.createElement("small");
      metadata.textContent = [entry.kind, entry.timezone].filter(Boolean).join(" · ") || "Exact date";
      item.append(heading, date, metadata);
      deadlineList.appendChild(item);
    });
  } else {
    const expected = document.createElement("p");
    expected.className = "detail-copy";
    expected.textContent = conference.expected_deadline_months?.length
      ? `Expected ${conference.expected_deadline_months.map(toTitle).join(", ")}; no exact date has been published yet.`
      : "No deadline has been published yet.";
    deadlineList.appendChild(expected);
  }
  deadlineSection.appendChild(deadlineList);
  els.detailsContent.appendChild(deadlineSection);

  const factsSection = buildDetailsSection("Conference information");
  const facts = document.createElement("dl");
  facts.className = "details-facts";
  [
    ["Type", toTitle(conference.type || "conference")],
    ["Rank", formatRank(conference.rank)],
    ["Conference dates", conference.conference_dates || "TBA"],
    ["Location", conference.location || "TBA"],
    ["Notification", formatOptionalDate(conference.notification_date)],
    ["Deadline timezone", conference.nextDeadline?.timezone || conference.deadline_timezone || "TBA"],
  ].forEach(([label, value]) => {
    facts.appendChild(buildDetailsFact(label, value));
  });
  factsSection.appendChild(facts);
  els.detailsContent.appendChild(factsSection);

  if (conference.description) {
    const descriptionSection = buildDetailsSection("About");
    const description = document.createElement("p");
    description.className = "detail-copy";
    description.textContent = conference.description;
    descriptionSection.appendChild(description);
    els.detailsContent.appendChild(descriptionSection);
  }

  if (conference.notes) {
    const notesSection = buildDetailsSection("Notes");
    const notes = document.createElement("p");
    notes.className = "detail-copy";
    notes.textContent = conference.notes;
    notesSection.appendChild(notes);
    els.detailsContent.appendChild(notesSection);
  }

  const topics = uniqueSorted([...(conference.areas || []), ...(conference.topics || [])]);
  if (topics.length) {
    const topicsSection = buildDetailsSection("Areas");
    const tags = document.createElement("div");
    tags.className = "tag-row";
    topics.forEach((topic) => tags.appendChild(buildTag(toTitle(topic))));
    topicsSection.appendChild(tags);
    els.detailsContent.appendChild(topicsSection);
  }

  const actions = document.createElement("div");
  actions.className = "details-actions";
  const favoriteButton = document.createElement("button");
  favoriteButton.className = "favorite-button";
  favoriteButton.type = "button";
  favoriteButton.innerHTML = '<span aria-hidden="true">☆</span>';
  setFavoriteButton(favoriteButton, conference);
  actions.appendChild(favoriteButton);
  const calendarButton = document.createElement("button");
  calendarButton.className = "calendar-button has-symbol";
  calendarButton.dataset.symbol = "calendar";
  calendarButton.type = "button";
  calendarButton.textContent = "Add to calendar";
  setCalendarButton(calendarButton, conference);
  actions.appendChild(calendarButton);
  appendTableLink(actions, "Website", conference.website_url);
  appendTableLink(actions, "CFP", conference.cfp_url || conference.website_url);
  els.detailsContent.appendChild(actions);

  if (typeof els.detailsDialog.showModal === "function") {
    els.detailsDialog.showModal();
  } else {
    els.detailsDialog.setAttribute("open", "");
  }
}

function buildDetailsSection(title) {
  const section = document.createElement("section");
  section.className = "details-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.appendChild(heading);
  return section;
}

function buildDetailsFact(label, value) {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = value;
  wrapper.append(term, detail);
  return wrapper;
}

function formatOptionalDate(value) {
  const date = parseDate(value);
  return date ? formatDate(date) : "TBA";
}

function buildTag(text, className = "") {
  const tag = document.createElement("span");
  tag.className = className ? `tag ${className}` : "tag";
  tag.textContent = text;
  return tag;
}

function getCardTags(conference) {
  const preferred = (conference.areas || []).length
    ? (conference.areas || []).map(toTitle)
    : (conference.topics || []).map(toTitle);
  const unique = [];
  const seen = new Set();

  preferred.forEach((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(item);
  });

  return {
    visible: unique.slice(0, 3),
    hidden: unique.slice(3),
  };
}

function buildMoreTagButton(hiddenTags, tagRow) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tag more-tag more-tag-button";
  button.textContent = `+${hiddenTags.length} more`;
  button.title = hiddenTags.join(", ");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", `Show ${hiddenTags.length} more topics: ${hiddenTags.join(", ")}`);

  let expanded = false;
  const extraTags = hiddenTags.map((tag) => {
    const element = buildTag(tag, "extra-tag");
    element.hidden = true;
    return element;
  });

  button.addEventListener("click", () => {
    expanded = !expanded;
    extraTags.forEach((tag) => {
      tag.hidden = !expanded;
    });
    button.textContent = expanded ? "Show less" : `+${hiddenTags.length} more`;
    button.setAttribute("aria-expanded", String(expanded));
  });

  extraTags.forEach((tag) => {
    tagRow.appendChild(tag);
  });

  return button;
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
  const multipleDeadlines = formData.get("has_multiple_deadlines") === "on";
  const deadline = clean(formData.get("submission_deadline"));
  const expectedDeadlineMonths = splitList(formData.get("expected_deadline_months"));
  const areas = formData.getAll("areas").map(clean).filter(Boolean);
  const topics = areas.length ? areas : inferTopicsFromText(`${name} ${acronym} ${clean(formData.get("description"))}`);
  const deadlineEntries = multipleDeadlines ? collectDeadlineEntries(true) : [];
  const derivedDeadline = multipleDeadlines ? derivePrimaryDeadline(deadlineEntries) : deadline;
  const primaryEntry = deadlineEntries.find((entry) => entry.date) || deadlineEntries[0] || null;
  const idParts = [acronym || name || "conference", derivedDeadline ? derivedDeadline.slice(0, 4) : new Date().getFullYear()];

  const record = {
    id: slugify(idParts.join("-")),
    name,
    acronym,
    type: clean(formData.get("type")) || "conference",
    areas,
    topics,
    keywords: [],
    submission_deadline: derivedDeadline,
    expected_deadline_months: expectedDeadlineMonths,
    deadline_kind: primaryEntry?.kind || "paper",
    deadline_timezone: primaryEntry?.timezone || "AoE",
    conference_dates: clean(formData.get("conference_dates")),
    expected_conference_months: [],
    location: clean(formData.get("location")) || "TBA",
    website_url: clean(formData.get("website_url")),
    cfp_url: clean(formData.get("cfp_url")),
    description: clean(formData.get("description")),
    rank: clean(formData.get("rank")),
    notes: clean(formData.get("notes")),
    last_checked: formatIsoDate(new Date()),
    deadline_confidence: derivedDeadline ? "manual" : "expected",
  };

  if (multipleDeadlines) {
    record.deadline_entries = deadlineEntries;
  }

  return record;
}

function collectDeadlineEntries(includeSkeleton = false) {
  if (!els.deadlineEntriesList) return [];
  const rows = [...els.deadlineEntriesList.querySelectorAll(".deadline-entry-row")].map((row) => ({
    label: clean(row.querySelector(".entry-label")?.value),
    date: clean(row.querySelector(".entry-date")?.value),
    kind: clean(row.querySelector(".entry-kind")?.value) || "paper submission",
    timezone: clean(row.querySelector(".entry-timezone")?.value) || "AoE",
  }));

  const filled = rows.filter((entry) => entry.label || entry.date || entry.kind || entry.timezone);
  if (filled.length) return filled;
  if (!includeSkeleton) return [];
  return [
    {
      label: "",
      date: "",
      kind: "paper submission",
      timezone: "AoE",
    },
  ];
}

function derivePrimaryDeadline(deadlineEntries) {
  const datedEntries = deadlineEntries
    .map((entry) => entry.date)
    .filter(Boolean)
    .sort();
  return datedEntries[0] || "";
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
  const deadlineText = conference.nextDeadline?.dateText || formatIsoDate(conference.deadlineDate);
  const filename = `${slugify(conference.acronym || conference.name)}-${deadlineText}-deadline.ics`;
  downloadCalendarFile(filename, buildCalendarEvent(conference));
}

function updateFavoriteExportButton() {
  const items = getFavoriteCalendarItems();
  const favoriteCount = new Set(items.map((item) => item.conference.id)).size;
  const isDisabled = items.length === 0;

  if (favoritesCalendarUrl) {
    URL.revokeObjectURL(favoritesCalendarUrl);
    favoritesCalendarUrl = "";
  }

  if (isDisabled) {
    els.exportFavorites.removeAttribute("href");
    els.exportFavorites.removeAttribute("download");
  } else {
    const blob = new Blob([buildFavoritesCalendar(items)], {
      type: "text/calendar;charset=utf-8",
    });
    favoritesCalendarUrl = URL.createObjectURL(blob);
    els.exportFavorites.href = favoritesCalendarUrl;
    els.exportFavorites.download = "conference-radar-favorites.ics";
  }

  els.exportFavorites.classList.toggle("disabled", isDisabled);
  els.exportFavorites.setAttribute("aria-disabled", String(isDisabled));
  els.exportFavorites.title = items.length
    ? `Download ${items.length} deadline${items.length === 1 ? "" : "s"} from ${favoriteCount} favorite conference${favoriteCount === 1 ? "" : "s"}`
    : "Favorite conferences with exact deadlines can be exported";
  els.exportFavorites.setAttribute("aria-label", els.exportFavorites.title);
}

function getFavoriteCalendarItems() {
  return state.conferences
    .filter(isFavoriteConference)
    .flatMap((conference) =>
      conference.deadlineEntries
        .map((entry) => ({ conference, entry })),
    );
}

function downloadCalendarFile(filename, contents) {
  const blob = new Blob([contents], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildCalendarEvent(conference) {
  return buildCalendar([{ conference, entry: conference.nextDeadline }]);
}

function buildFavoritesCalendar(items) {
  return buildCalendar(items);
}

function buildCalendar(items) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Conference Radar//Deadline Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...items.map(({ conference, entry }) => buildCalendarEventBlock(conference, entry)),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

function buildCalendarEventBlock(conference, entry) {
  const deadline = entry?.date || conference.deadlineDate;
  const deadlineText = entry?.dateText || formatIsoDate(deadline);
  const start = formatIcsDate(deadline);
  const end = formatIcsDate(addDays(deadline, 1));
  const created = formatIcsDateTime(new Date());
  const sourceUrl = conference.cfp_url || conference.website_url || "";
  const deadlineLabel = entry?.label || conference.deadline_kind || "Submission deadline";
  const title = `${deadlineLabel}: ${conference.acronym || conference.name}`;
  const description = [
    `${conference.name} (${conference.acronym || "conference"})`,
    entry?.kind ? `Deadline type: ${entry.kind}` : conference.deadline_kind ? `Deadline type: ${conference.deadline_kind}` : "",
    entry?.timezone ? `Timezone: ${entry.timezone}` : conference.deadline_timezone ? `Timezone: ${conference.deadline_timezone}` : "",
    conference.conference_dates ? `Conference dates: ${conference.conference_dates}` : "",
    conference.location ? `Location: ${conference.location}` : "",
    sourceUrl ? `Source: ${sourceUrl}` : "",
    conference.notes ? `Notes: ${conference.notes}` : "",
  ]
    .filter(Boolean)
    .join("\\n");

  return [
    "BEGIN:VEVENT",
    `UID:${conference.id}-${deadlineText}-${slugify(deadlineLabel)}@conference-radar`,
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

function formatRank(value) {
  return String(value || "").trim().toUpperCase() || "N/A";
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
  if (!Number.isFinite(days)) return "tba";
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
