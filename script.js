(function () {
  "use strict";

  var DEFAULT_SNACKS = [
    {
      id: "fallback-oreo",
      title: "Oreo Cookies",
      normalizedTitle: "oreo cookies",
      category: "Snacks",
      aliases: ["oreo", "oreos"],
      voteCount: 0,
      approved: true,
      createdByUser: false,
      needsReview: false,
      userHasVoted: false,
      isOwnSubmission: false
    },
    {
      id: "fallback-doritos",
      title: "Doritos",
      normalizedTitle: "doritos",
      category: "Chips",
      aliases: ["dorritos"],
      voteCount: 0,
      approved: true,
      createdByUser: false,
      needsReview: false,
      userHasVoted: false,
      isOwnSubmission: false
    },
    {
      id: "fallback-water",
      title: "Water",
      normalizedTitle: "water",
      category: "Drinks",
      aliases: ["bottled water", "h20"],
      voteCount: 0,
      approved: true,
      createdByUser: false,
      needsReview: false,
      userHasVoted: false,
      isOwnSubmission: false
    },
    {
      id: "fallback-gatorade",
      title: "Gatorade",
      normalizedTitle: "gatorade",
      category: "Sports Drink",
      aliases: ["gatoraid", "gatoraide"],
      voteCount: 0,
      approved: true,
      createdByUser: false,
      needsReview: false,
      userHasVoted: false,
      isOwnSubmission: false
    },
    {
      id: "fallback-powerade",
      title: "Powerade",
      normalizedTitle: "powerade",
      category: "Sports Drink",
      aliases: ["poweraid", "poweraide"],
      voteCount: 0,
      approved: true,
      createdByUser: false,
      needsReview: false,
      userHasVoted: false,
      isOwnSubmission: false
    },
    {
      id: "fallback-goldfish",
      title: "Goldfish Crackers",
      normalizedTitle: "goldfish crackers",
      category: "Crackers",
      aliases: ["goldfish"],
      voteCount: 0,
      approved: true,
      createdByUser: false,
      needsReview: false,
      userHasVoted: false,
      isOwnSubmission: false
    }
  ];

  var STORAGE_KEYS = {
    sessionId: "driverSnackStationSessionId",
    votes: "driverSnackStationVotes"
  };

  var state = {
    supabase: null,
    sessionId: "",
    configured: false,
    emailReady: false,
    snacks: [],
    snackMap: {},
    selectedSnackIds: new Set(),
    localVotes: new Set(),
    latestMatches: [],
    selectedMatch: null,
    customDecision: "none",
    votePendingSnackId: "",
    elements: {}
  };

  document.addEventListener("DOMContentLoaded", initializeApp);

  function initializeApp() {
    state.sessionId = getOrCreateSessionId();
    state.localVotes = getStoredVoteSet();
    cacheElements();
    wireEvents();
    initializeSupabase();
    initializeEmail();
    renderSnapshot(buildFallbackSnapshot());
    loadStationData();
  }

  function cacheElements() {
    state.elements = {
      setupPanel: document.getElementById("setup-panel"),
      setupMessage: document.getElementById("setup-message"),
      stationStatus: document.getElementById("station-status"),
      stationStatusNote: document.getElementById("station-status-note"),
      snackGrid: document.getElementById("snack-grid"),
      customSnackInput: document.getElementById("custom-snack-input"),
      customHelpText: document.getElementById("custom-help-text"),
      matchPanel: document.getElementById("match-panel"),
      matchTitle: document.getElementById("match-title"),
      matchOptions: document.getElementById("match-options"),
      matchYesButton: document.getElementById("match-yes-button"),
      matchKeepButton: document.getElementById("match-keep-button"),
      matchMoreButton: document.getElementById("match-more-button"),
      form: document.getElementById("snack-form"),
      submitButton: document.getElementById("submit-button"),
      preferredWaterBrand: document.getElementById("preferred-water-brand"),
      wantsAdded: document.getElementById("wants-added"),
      dislikes: document.getElementById("dislikes"),
      deliveryFrequency: document.getElementById("delivery-frequency"),
      areaDelivery: document.getElementById("area-delivery"),
      neighborhoodSighting: document.getElementById("neighborhood-sighting"),
      wasillaSighting: document.getElementById("wasilla-sighting"),
      optionalMessage: document.getElementById("optional-message"),
      optionalNickname: document.getElementById("optional-nickname"),
      feedbackPanel: document.getElementById("feedback-panel"),
      feedbackMessage: document.getElementById("feedback-message"),
      refreshButton: document.getElementById("refresh-status-button"),
      recentGrabs: document.getElementById("recent-grabs"),
      recentGrabsPanel: document.getElementById("recent-grabs-panel"),
      popularSnacks: document.getElementById("popular-snacks"),
      popularSnacksPanel: document.getElementById("popular-snacks-panel"),
      requestedSnacks: document.getElementById("requested-snacks"),
      requestedSnacksPanel: document.getElementById("requested-snacks-panel"),
      dislikedSnacks: document.getElementById("disliked-snacks"),
      dislikedSnacksPanel: document.getElementById("disliked-snacks-panel"),
      sightingsGrid: document.getElementById("sightings-grid"),
      sightingsPanel: document.getElementById("sightings-panel"),
      communityStats: document.getElementById("community-stats"),
      communityStatsPanel: document.getElementById("community-stats-panel"),
      publicComments: document.getElementById("public-comments"),
      publicCommentsPanel: document.getElementById("public-comments-panel")
    };
  }

  function wireEvents() {
    state.elements.form.addEventListener("submit", handleFormSubmit);
    state.elements.customSnackInput.addEventListener("input", handleCustomInputChange);
    state.elements.matchYesButton.addEventListener("click", handleUseSuggestedSnack);
    state.elements.matchKeepButton.addEventListener("click", handleKeepTypedSnack);
    state.elements.matchMoreButton.addEventListener("click", handleShowMoreMatches);
    state.elements.refreshButton.addEventListener("click", loadStationData);
    wireAutoResize(state.elements.wantsAdded);
    wireAutoResize(state.elements.dislikes);
    wireAutoResize(state.elements.optionalMessage);
  }

  function initializeSupabase() {
    var config = window.DRIVER_SNACK_CONFIG || {};
    var hasUrl = typeof config.supabaseUrl === "string" && config.supabaseUrl !== "" && config.supabaseUrl.indexOf("YOUR_") !== 0;
    var hasKey = typeof config.supabaseAnonKey === "string" && config.supabaseAnonKey !== "" && config.supabaseAnonKey.indexOf("YOUR_") !== 0;

    if (!hasUrl || !hasKey || !window.supabase || !window.supabase.createClient) {
      state.configured = false;
      showSetupMessage("Add your Supabase URL and anon key in index.html to save live submissions and trends.");
      disableSubmit(true);
      return;
    }

    state.supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    state.configured = true;
    disableSubmit(false);
    hideSetupMessage();
  }

  function initializeEmail() {
    var config = window.DRIVER_SNACK_CONFIG || {};
    var emailConfig = config.emailjs || {};
    if (!emailConfig.enabled || !window.emailjs || !emailConfig.publicKey) {
      state.emailReady = false;
      return;
    }

    try {
      window.emailjs.init({
        publicKey: emailConfig.publicKey
      });
      state.emailReady = true;
    } catch (error) {
      state.emailReady = false;
      console.error("Email setup failed.", error);
    }
  }

  async function loadStationData() {
    if (!state.supabase) {
      renderSnapshot(buildFallbackSnapshot());
      return;
    }

    state.elements.refreshButton.disabled = true;

    try {
      var response = await state.supabase.rpc("get_public_station_snapshot", {
        p_session_id: state.sessionId
      });

      if (response.error) {
        throw response.error;
      }

      hideSetupMessage();
      disableSubmit(false);
      renderSnapshot(normalizeSnapshot(response.data));
    } catch (error) {
      console.error("Unable to load station data.", error);
      showSetupMessage("Live data could not be loaded right now. The starter snack list is still shown below.");
      renderSnapshot(buildFallbackSnapshot());
    } finally {
      state.elements.refreshButton.disabled = false;
    }
  }

  function normalizeSnapshot(snapshot) {
    var safeSnapshot = snapshot || {};
    safeSnapshot.snacks = Array.isArray(safeSnapshot.snacks) ? safeSnapshot.snacks : DEFAULT_SNACKS.slice();
    safeSnapshot.recentGrabs = Array.isArray(safeSnapshot.recentGrabs) ? safeSnapshot.recentGrabs : [];
    safeSnapshot.popularSnacks = Array.isArray(safeSnapshot.popularSnacks) ? safeSnapshot.popularSnacks : [];
    safeSnapshot.requestedSnacks = Array.isArray(safeSnapshot.requestedSnacks) ? safeSnapshot.requestedSnacks : [];
    safeSnapshot.dislikedSnacks = Array.isArray(safeSnapshot.dislikedSnacks) ? safeSnapshot.dislikedSnacks : [];
    safeSnapshot.comments = Array.isArray(safeSnapshot.comments) ? safeSnapshot.comments : [];
    safeSnapshot.sightings = safeSnapshot.sightings || {};
    safeSnapshot.communityStats = safeSnapshot.communityStats || {};
    return safeSnapshot;
  }

  function buildFallbackSnapshot() {
    return {
      stationStatus: "Fresh snacks added today",
      stationStatusNote: "Live updates appear here after Supabase is connected.",
      snacks: DEFAULT_SNACKS.slice(),
      recentGrabs: [],
      popularSnacks: [],
      requestedSnacks: [],
      dislikedSnacks: [],
      comments: [],
      sightings: {
        neighborhood: { yes: 0, no: 0, notSure: 0 },
        wasilla: { yes: 0, no: 0, notSure: 0 }
      },
      communityStats: {
        totalSubmissions: 0,
        totalGrabReports: 0,
        anonymousSubmissions: 0,
        regularDrivers: 0,
        approvedComments: 0
      }
    };
  }

  function renderSnapshot(snapshot) {
    state.snacks = snapshot.snacks.slice();
    state.snackMap = {};
    state.snacks.forEach(function (snack) {
      state.snackMap[snack.id] = snack;
    });

    state.elements.stationStatus.textContent = snapshot.stationStatus || "Fresh snacks added today";
    state.elements.stationStatusNote.textContent = snapshot.stationStatusNote || "Live updates come from Supabase when the site is connected.";

    renderSnackGrid(snapshot.snacks);
    renderTrendList(state.elements.recentGrabsPanel, state.elements.recentGrabs, snapshot.recentGrabs, "title", "count");
    renderTrendList(state.elements.popularSnacksPanel, state.elements.popularSnacks, snapshot.popularSnacks, "title", "count");
    renderTrendList(state.elements.requestedSnacksPanel, state.elements.requestedSnacks, snapshot.requestedSnacks, "title", "count");
    renderTrendList(state.elements.dislikedSnacksPanel, state.elements.dislikedSnacks, snapshot.dislikedSnacks, "title", "count");
    renderSightings(snapshot.sightings);
    renderCommunityStats(snapshot.communityStats);
    renderComments(snapshot.comments);

    if (state.elements.customSnackInput.value.trim() !== "") {
      updateMatchPanel(state.elements.customSnackInput.value);
    }
  }

  function renderSnackGrid(snacks) {
    clearElement(state.elements.snackGrid);

    if (!snacks.length) {
      renderEmptyState(state.elements.snackGrid, "No approved snacks are listed yet.");
      return;
    }

    var groupedSnacks = groupSnacksForDisplay(snacks);
    var pickerGrid = document.createElement("div");
    pickerGrid.className = "grabbed-picker-grid";

    pickerGrid.appendChild(createGrabbedPickerPanel("Snacks", "Select a snack", groupedSnacks.snacks));
    pickerGrid.appendChild(createGrabbedPickerPanel("Drinks", "Select a drink", groupedSnacks.drinks));

    state.elements.snackGrid.appendChild(pickerGrid);
  }

  function groupSnacksForDisplay(snacks) {
    return snacks.reduce(function (groups, snack) {
      if (isDrinkSnack(snack)) {
        groups.drinks.push(snack);
      } else {
        groups.snacks.push(snack);
      }
      return groups;
    }, {
      snacks: [],
      drinks: []
    });
  }

  function isDrinkSnack(snack) {
    var rawCategory = snack && snack.category ? String(snack.category) : "";
    var normalizedCategory = rawCategory.toLowerCase();
    return normalizedCategory.indexOf("drink") !== -1
      || normalizedCategory.indexOf("water") !== -1
      || normalizedCategory.indexOf("soda") !== -1
      || normalizedCategory.indexOf("juice") !== -1
      || normalizedCategory.indexOf("tea") !== -1
      || normalizedCategory.indexOf("coffee") !== -1
      || normalizedCategory.indexOf("sports") !== -1;
  }

  function createGrabbedPickerPanel(groupTitle, placeholder, snacks) {
    var panel = document.createElement("section");
    panel.className = "grabbed-picker-panel";

    var heading = document.createElement("p");
    heading.className = "grabbed-picker-title";
    heading.textContent = groupTitle;
    panel.appendChild(heading);

    var select = document.createElement("select");
    select.className = "select-input grabbed-select";
    select.setAttribute("aria-label", groupTitle);

    var placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = placeholder;
    select.appendChild(placeholderOption);

    snacks.forEach(function (snack) {
      var option = document.createElement("option");
      option.value = snack.id;
      option.textContent = snack.title;
      option.disabled = state.selectedSnackIds.has(snack.id);
      select.appendChild(option);
    });

    select.addEventListener("change", function () {
      if (!select.value) {
        return;
      }

      state.selectedSnackIds.add(select.value);
      renderSnackGrid(state.snacks);
    });

    panel.appendChild(select);

    var selectedItems = snacks.filter(function (snack) {
      return state.selectedSnackIds.has(snack.id);
    });

    if (selectedItems.length) {
      var selectedSummary = document.createElement("div");
      selectedSummary.className = "selected-summary";

      var selectedHeading = document.createElement("p");
      selectedHeading.className = "selected-summary-title";
      selectedHeading.textContent = "Selected";
      selectedSummary.appendChild(selectedHeading);

      var list = document.createElement("div");
      list.className = "selected-list";

      selectedItems.forEach(function (snack) {
        list.appendChild(createSelectedItem(snack));
      });

      selectedSummary.appendChild(list);
      panel.appendChild(selectedSummary);
    }
    return panel;
  }

  function createSelectedItem(snack) {
    var item = document.createElement("div");
    item.className = "selected-item";

    var label = document.createElement("span");
    label.className = "selected-item-label";
    label.textContent = snack.title;
    item.appendChild(label);

    var removeButton = document.createElement("button");
    removeButton.className = "selected-item-remove";
    removeButton.type = "button";
    removeButton.textContent = "X";
    removeButton.setAttribute("aria-label", "Remove " + snack.title);
    removeButton.addEventListener("click", function () {
      state.selectedSnackIds.delete(snack.id);
      renderSnackGrid(state.snacks);
    });
    item.appendChild(removeButton);

    return item;
  }

  function renderTrendList(panel, container, items, labelKey, valueKey) {
    clearElement(container);

    var filteredItems = filterPositiveItems(items, valueKey);
    if (!filteredItems.length) {
      togglePanel(panel, false);
      return;
    }

    togglePanel(panel, true);
    renderChartRows(container, filteredItems, labelKey, valueKey);
  }

  function renderSightings(sightings) {
    clearElement(state.elements.sightingsGrid);

    var neighborhood = sightings && sightings.neighborhood ? sightings.neighborhood : {};
    var wasilla = sightings && sightings.wasilla ? sightings.wasilla : {};

    var cards = [
      { label: "Neighborhood yes", value: neighborhood.yes || 0 },
      { label: "Neighborhood no", value: neighborhood.no || 0 },
      { label: "Neighborhood not sure", value: neighborhood.notSure || 0 },
      { label: "Wasilla yes", value: wasilla.yes || 0 },
      { label: "Wasilla no", value: wasilla.no || 0 },
      { label: "Wasilla not sure", value: wasilla.notSure || 0 }
    ];

    renderStatCards(state.elements.sightingsPanel, state.elements.sightingsGrid, cards);
  }

  function renderCommunityStats(stats) {
    clearElement(state.elements.communityStats);

    var cards = [
      { label: "Total submissions", value: stats.totalSubmissions || 0 },
      { label: "Grab reports", value: stats.totalGrabReports || 0 },
      { label: "Anonymous submissions", value: stats.anonymousSubmissions || 0 },
      { label: "Regular drivers", value: stats.regularDrivers || 0 },
      { label: "Approved comments", value: stats.approvedComments || 0 }
    ];

    renderStatCards(state.elements.communityStatsPanel, state.elements.communityStats, cards);
  }

  function renderStatCards(panel, container, cards) {
    clearElement(container);

    var filteredCards = filterPositiveItems(cards, "value");
    if (!filteredCards.length) {
      togglePanel(panel, false);
      return;
    }

    togglePanel(panel, true);
    renderChartRows(container, filteredCards, "label", "value");
  }

  function renderComments(comments) {
    clearElement(state.elements.publicComments);

    if (!comments || !comments.length) {
      togglePanel(state.elements.publicCommentsPanel, false);
      return;
    }

    togglePanel(state.elements.publicCommentsPanel, true);
    var fragment = document.createDocumentFragment();

    comments.forEach(function (comment) {
      var card = document.createElement("article");
      card.className = "comment-card";

      var name = document.createElement("p");
      name.className = "comment-name";
      name.textContent = comment.nickname || "Anonymous driver";
      card.appendChild(name);

      var text = document.createElement("p");
      text.className = "comment-text";
      text.textContent = comment.commentText || "";
      card.appendChild(text);

      fragment.appendChild(card);
    });

    state.elements.publicComments.appendChild(fragment);
  }

  function renderChartRows(container, items, labelKey, valueKey) {
    var fragment = document.createDocumentFragment();
    var maxValue = getMaxValue(items, valueKey);

    items.forEach(function (item) {
      var row = document.createElement("article");
      row.className = "chart-row";

      var top = document.createElement("div");
      top.className = "chart-row-top";

      var label = document.createElement("p");
      label.className = "chart-row-label";
      label.textContent = item[labelKey] || "Unknown";
      top.appendChild(label);

      var value = document.createElement("p");
      value.className = "chart-row-value";
      value.textContent = String(item[valueKey] || 0);
      top.appendChild(value);

      row.appendChild(top);

      var track = document.createElement("div");
      track.className = "chart-track";

      var fill = document.createElement("div");
      fill.className = "chart-fill";
      fill.style.width = getChartWidth(item[valueKey], maxValue);
      track.appendChild(fill);

      row.appendChild(track);
      fragment.appendChild(row);
    });

    container.appendChild(fragment);
  }

  function filterPositiveItems(items, valueKey) {
    return (Array.isArray(items) ? items : []).filter(function (item) {
      return Number(item && item[valueKey]) > 0;
    });
  }

  function getMaxValue(items, valueKey) {
    return items.reduce(function (maxValue, item) {
      return Math.max(maxValue, Number(item && item[valueKey]) || 0);
    }, 0);
  }

  function getChartWidth(value, maxValue) {
    if (!maxValue || !value) {
      return "0%";
    }

    return Math.max(12, Math.round((Number(value) / maxValue) * 100)) + "%";
  }

  function togglePanel(panel, shouldShow) {
    if (!panel) {
      return;
    }

    panel.classList.toggle("hidden", !shouldShow);
  }

  function handleCustomInputChange(event) {
    var rawValue = event.target.value;
    state.selectedMatch = null;
    state.customDecision = "none";

    if (rawValue.trim() === "") {
      resetMatchPanel();
      return;
    }

    updateMatchPanel(rawValue);
  }

  function updateMatchPanel(rawValue) {
    var matches = findLocalMatches(rawValue);
    state.latestMatches = matches;

    if (!matches.length || matches[0].score < 0.62) {
      resetMatchPanel();
      return;
    }

    state.selectedMatch = matches[0];
    state.customDecision = "unresolved";
    state.elements.matchTitle.textContent = "Did you mean " + matches[0].title + "?";
    state.elements.matchPanel.classList.remove("hidden");
    state.elements.matchMoreButton.classList.toggle("hidden", matches.length < 2);
    state.elements.matchOptions.classList.add("hidden");
    clearElement(state.elements.matchOptions);
    state.elements.customHelpText.textContent = "We found a likely match. You can use it, keep your wording, or look at more options.";
  }

  function handleUseSuggestedSnack() {
    if (!state.selectedMatch) {
      return;
    }

    state.customDecision = "matched-existing";
    selectSnackIfMissing(state.selectedMatch.id);
    state.elements.customHelpText.textContent = "Your custom entry will be linked to " + state.selectedMatch.title + ".";
    state.elements.matchPanel.classList.add("hidden");
    renderSnackGrid(state.snacks);
  }

  function handleKeepTypedSnack() {
    state.customDecision = "keep-typed";
    state.elements.customHelpText.textContent = "Your wording will be saved and reviewed if it looks close to an existing snack.";
    state.elements.matchOptions.classList.add("hidden");
  }

  function handleShowMoreMatches() {
    if (!state.latestMatches.length) {
      return;
    }

    clearElement(state.elements.matchOptions);

    state.latestMatches.slice(0, 5).forEach(function (match) {
      var button = document.createElement("button");
      button.className = "match-option";
      button.type = "button";
      button.textContent = match.title + " (" + match.category + ")";
      button.addEventListener("click", function () {
        state.selectedMatch = match;
        state.customDecision = "matched-existing";
        selectSnackIfMissing(match.id);
        state.elements.customHelpText.textContent = "Your custom entry will be linked to " + match.title + ".";
        state.elements.matchPanel.classList.add("hidden");
        renderSnackGrid(state.snacks);
      });
      state.elements.matchOptions.appendChild(button);
    });

    state.elements.matchOptions.classList.remove("hidden");
  }

  function resetMatchPanel() {
    state.latestMatches = [];
    state.selectedMatch = null;
    state.customDecision = "none";
    state.elements.matchPanel.classList.add("hidden");
    state.elements.matchOptions.classList.add("hidden");
    clearElement(state.elements.matchOptions);
    state.elements.customHelpText.textContent = "Names are checked against existing snacks, aliases, and close spellings before a new request is saved.";
  }

  function findLocalMatches(rawValue) {
    var normalizedInput = normalizeSnackText(rawValue);
    if (!normalizedInput) {
      return [];
    }

    var results = [];

    state.snacks.forEach(function (snack) {
      var bestScore = 0;
      var bestReason = "fuzzy";

      getSnackTerms(snack).forEach(function (term) {
        var scoreData = scoreSnackCandidate(normalizedInput, normalizeSnackText(term));
        if (scoreData.score > bestScore) {
          bestScore = scoreData.score;
          bestReason = scoreData.reason;
        }
      });

      if (bestScore >= 0.45) {
        results.push({
          id: snack.id,
          title: snack.title,
          category: snack.category,
          score: bestScore,
          reason: bestReason
        });
      }
    });

    results.sort(function (left, right) {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.title.localeCompare(right.title);
    });

    return results;
  }

  function scoreSnackCandidate(input, term) {
    if (!input || !term) {
      return { score: 0, reason: "none" };
    }

    var inputBase = singularize(input);
    var termBase = singularize(term);

    if (input === term || inputBase === termBase) {
      return { score: 1, reason: "exact" };
    }

    if (term.indexOf(input) === 0 || input.indexOf(term) === 0) {
      return { score: 0.88, reason: "starts-with" };
    }

    if (term.indexOf(input) !== -1 || input.indexOf(term) !== -1) {
      return { score: 0.8, reason: "contains" };
    }

    var distance = levenshteinDistance(input, term);
    var maxLength = Math.max(input.length, term.length);
    var closeness = maxLength ? 1 - distance / maxLength : 0;

    if (distance <= 2 && maxLength >= 4) {
      return { score: Math.max(0.76, closeness), reason: "close-spelling" };
    }

    if (distance <= 3 && maxLength >= 7) {
      return { score: Math.max(0.64, closeness), reason: "fuzzy" };
    }

    if (closeness >= 0.58) {
      return { score: closeness, reason: "fuzzy" };
    }

    return { score: 0, reason: "none" };
  }

  async function handleFormSubmit(event) {
    event.preventDefault();

    if (!state.supabase) {
      showFeedback("This page is not connected yet. Add your Supabase keys first.", true);
      showSetupMessage("Add your Supabase URL and anon key in index.html to turn on live submissions.");
      return;
    }

    var payload;

    try {
      payload = collectSubmissionPayload();
    } catch (error) {
      showFeedback(error.message, true);
      return;
    }

    disableSubmit(true);
    showFeedback("Sending your feedback...", false);

    try {
      var response = await state.supabase.rpc("submit_snack_feedback", {
        p_payload: payload
      });

      if (response.error) {
        throw response.error;
      }

      var result = response.data || {};
      var successMessage = result.message || "Thanks. Your snack note has been saved.";

      if (payload.customSnackOriginal && result.createdSnackId) {
        successMessage = "Your snack request was saved and is waiting for approval before it shows in the public list.";
      } else if (payload.customSnackOriginal && result.matchedSnackId) {
        successMessage = "Your snack note was saved.";
      }

      if (result.createdSnackId) {
        state.localVotes.delete(result.createdSnackId);
        saveVoteSet();
      }

      await sendEmailNotification(payload, result);
      clearFormState();
      showFeedback(successMessage, false);
      await loadStationData();
    } catch (error) {
      console.error("Unable to submit feedback.", error);
      showFeedback("That note could not be saved right now. Please try again in a moment.", true);
    } finally {
      disableSubmit(false);
    }
  }

  function collectSubmissionPayload() {
    var customSnackOriginal = cleanText(state.elements.customSnackInput.value, 80);
    var selectedSnackIds = Array.from(state.selectedSnackIds);
    var selectedSnackTitles = selectedSnackIds.map(function (snackId) {
      return state.snackMap[snackId] ? state.snackMap[snackId].title : "";
    }).filter(Boolean);

    var payload = {
      sessionId: state.sessionId,
      selectedSnackIds: selectedSnackIds,
      selectedSnackTitles: selectedSnackTitles,
      customSnackOriginal: customSnackOriginal,
      customSnackNormalized: normalizeSnackText(customSnackOriginal),
      matchedSnackId: state.customDecision === "matched-existing" && state.selectedMatch ? state.selectedMatch.id : null,
      customSnackDecision: state.customDecision,
      preferredWaterBrand: cleanText(state.elements.preferredWaterBrand.value, 80),
      wantsAdded: cleanText(state.elements.wantsAdded.value, 250),
      dislikes: cleanText(state.elements.dislikes.value, 250),
      deliveryFrequency: state.elements.deliveryFrequency.value,
      areaDelivery: state.elements.areaDelivery.value,
      neighborhoodSighting: state.elements.neighborhoodSighting.value,
      wasillaSighting: state.elements.wasillaSighting.value,
      message: cleanText(state.elements.optionalMessage.value, 350),
      nickname: cleanText(state.elements.optionalNickname.value, 40),
      submittedAnonymously: cleanText(state.elements.optionalNickname.value, 40) === "",
      needsReview: shouldMarkNeedsReview(customSnackOriginal)
    };

    var hasMeaningfulContent = payload.selectedSnackIds.length || payload.customSnackOriginal || payload.preferredWaterBrand || payload.wantsAdded || payload.dislikes || payload.message;
    if (!hasMeaningfulContent) {
      throw new Error("Please pick a snack, add a request, or leave a short note before sending.");
    }

    return payload;
  }

  function shouldMarkNeedsReview(customSnackOriginal) {
    if (!customSnackOriginal) {
      return false;
    }

    var matches = findLocalMatches(customSnackOriginal);
    if (!matches.length) {
      return true;
    }

    if (state.customDecision === "matched-existing") {
      return false;
    }

    if (matches[0].score >= 0.76 && state.customDecision !== "matched-existing") {
      return true;
    }

    return matches[0].score >= 0.62;
  }

  async function handleVote(snackId) {
    if (!state.supabase) {
      showFeedback("Voting turns on after the site is connected to Supabase.", true);
      return;
    }

    if (state.localVotes.has(snackId)) {
      showFeedback("You already used your plus one for that snack.", true);
      return;
    }

    state.votePendingSnackId = snackId;
    renderSnackGrid(state.snacks);

    try {
      var response = await state.supabase.rpc("submit_snack_vote", {
        p_snack_id: snackId,
        p_session_id: state.sessionId
      });

      if (response.error) {
        throw response.error;
      }

      var result = response.data || {};

      if (result.code === "own_snack") {
        showFeedback("Thanks for the suggestion. You cannot plus one your own snack, but others can vote for it once it is approved.", true);
      } else if (result.code === "duplicate") {
        rememberLocalVote(snackId);
        showFeedback(result.message || "You already used your plus one for that snack.", false);
      } else {
        rememberLocalVote(snackId);
        showFeedback(result.message || "Your plus one was counted.", false);
      }

      await loadStationData();
    } catch (error) {
      console.error("Unable to save vote.", error);
      showFeedback("That plus one could not be saved right now. Please try again shortly.", true);
    } finally {
      state.votePendingSnackId = "";
      renderSnackGrid(state.snacks);
    }
  }

  function toggleSnackSelection(snackId) {
    if (state.selectedSnackIds.has(snackId)) {
      state.selectedSnackIds.delete(snackId);
    } else {
      state.selectedSnackIds.add(snackId);
    }

    renderSnackGrid(state.snacks);
  }

  function selectSnackIfMissing(snackId) {
    if (!state.selectedSnackIds.has(snackId)) {
      state.selectedSnackIds.add(snackId);
    }
  }

  function clearFormState() {
    state.elements.form.reset();
    state.selectedSnackIds.clear();
    resetMatchPanel();
    resetAutoResize(state.elements.wantsAdded);
    resetAutoResize(state.elements.dislikes);
    resetAutoResize(state.elements.optionalMessage);
    renderSnackGrid(state.snacks);
  }

  function showFeedback(message, isError) {
    state.elements.feedbackPanel.classList.remove("hidden");
    state.elements.feedbackPanel.classList.toggle("error-state", !!isError);
    state.elements.feedbackMessage.textContent = message;
  }

  function disableSubmit(disabled) {
    state.elements.submitButton.disabled = !!disabled;
  }

  function showSetupMessage(message) {
    state.elements.setupPanel.classList.remove("hidden");
    state.elements.setupMessage.textContent = message;
  }

  function hideSetupMessage() {
    state.elements.setupPanel.classList.add("hidden");
  }

  function renderEmptyState(container, message) {
    var empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = message;
    container.appendChild(empty);
  }

  function clearElement(element) {
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function cleanText(value, maxLength) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  }

  function normalizeSnackText(value) {
    return cleanText(value, 120)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function singularize(value) {
    if (!value) {
      return "";
    }

    if (value.endsWith("ies") && value.length > 3) {
      return value.slice(0, -3) + "y";
    }

    if (value.endsWith("s") && !value.endsWith("ss") && value.length > 3) {
      return value.slice(0, -1);
    }

    return value;
  }

  function getSnackTerms(snack) {
    var terms = [snack.title];
    if (Array.isArray(snack.aliases)) {
      snack.aliases.forEach(function (alias) {
        if (alias) {
          terms.push(alias);
        }
      });
    }
    return terms;
  }

  function levenshteinDistance(left, right) {
    if (left === right) {
      return 0;
    }

    var leftLength = left.length;
    var rightLength = right.length;

    if (!leftLength) {
      return rightLength;
    }

    if (!rightLength) {
      return leftLength;
    }

    var matrix = [];
    var rowIndex;
    var columnIndex;

    for (rowIndex = 0; rowIndex <= rightLength; rowIndex += 1) {
      matrix[rowIndex] = [rowIndex];
    }

    for (columnIndex = 0; columnIndex <= leftLength; columnIndex += 1) {
      matrix[0][columnIndex] = columnIndex;
    }

    for (rowIndex = 1; rowIndex <= rightLength; rowIndex += 1) {
      for (columnIndex = 1; columnIndex <= leftLength; columnIndex += 1) {
        if (right.charAt(rowIndex - 1) === left.charAt(columnIndex - 1)) {
          matrix[rowIndex][columnIndex] = matrix[rowIndex - 1][columnIndex - 1];
        } else {
          matrix[rowIndex][columnIndex] = Math.min(
            matrix[rowIndex - 1][columnIndex - 1] + 1,
            matrix[rowIndex][columnIndex - 1] + 1,
            matrix[rowIndex - 1][columnIndex] + 1
          );
        }
      }
    }

    return matrix[rightLength][leftLength];
  }

  function getOrCreateSessionId() {
    var existing = localStorage.getItem(STORAGE_KEYS.sessionId);
    if (existing) {
      return existing;
    }

    var created;
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      created = window.crypto.randomUUID();
    } else {
      created = "session-" + Date.now() + "-" + Math.random().toString(16).slice(2, 10);
    }

    localStorage.setItem(STORAGE_KEYS.sessionId, created);
    return created;
  }

  function getStoredVoteSet() {
    try {
      var raw = localStorage.getItem(STORAGE_KEYS.votes);
      if (!raw) {
        return new Set();
      }

      var parsed = JSON.parse(raw);
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch (error) {
      console.error("Unable to read stored votes.", error);
      return new Set();
    }
  }

  function rememberLocalVote(snackId) {
    state.localVotes.add(snackId);
    saveVoteSet();
  }

  function saveVoteSet() {
    localStorage.setItem(STORAGE_KEYS.votes, JSON.stringify(Array.from(state.localVotes)));
  }

  function wireAutoResize(textarea) {
    if (!textarea) {
      return;
    }

    textarea.addEventListener("input", function () {
      autoResizeTextarea(textarea);
    });
    autoResizeTextarea(textarea);
  }

  function autoResizeTextarea(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + "px";
  }

  function resetAutoResize(textarea) {
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    autoResizeTextarea(textarea);
  }

  async function sendEmailNotification(payload, result) {
    var config = window.DRIVER_SNACK_CONFIG || {};
    var emailConfig = config.emailjs || {};

    if (!state.emailReady || !emailConfig.serviceId || !emailConfig.templateId) {
      return;
    }

    var templateParams = {
      session_id: state.sessionId,
      selected_snacks: payload.selectedSnackTitles.join(", "),
      custom_snack: payload.customSnackOriginal || "None",
      preferred_water_brand: payload.preferredWaterBrand || "None",
      wants_added: payload.wantsAdded || "None",
      dislikes: payload.dislikes || "None",
      delivery_frequency: payload.deliveryFrequency,
      area_delivery: payload.areaDelivery,
      neighborhood_sighting: payload.neighborhoodSighting,
      wasilla_sighting: payload.wasillaSighting,
      message: payload.message || "None",
      nickname: payload.nickname || "Anonymous driver",
      submission_id: result.submissionId || ""
    };

    try {
      await window.emailjs.send(emailConfig.serviceId, emailConfig.templateId, templateParams);
    } catch (error) {
      console.error("Email notification failed.", error);
    }
  }
}());
