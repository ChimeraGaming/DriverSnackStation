(function () {
  "use strict";

  var STORAGE_KEY = "driverSnackStationAdminPasscode";

  var state = {
    supabase: null,
    passcode: "",
    dashboard: null,
    configured: false,
    catalogFilter: "all",
    catalogEditSnackId: "",
    elements: {}
  };

  document.addEventListener("DOMContentLoaded", initializeAdmin);

  function initializeAdmin() {
    cacheElements();
    wireEvents();
    initializeSupabase();

    var savedPasscode = sessionStorage.getItem(STORAGE_KEY);
    if (savedPasscode) {
      state.elements.adminPasscode.value = savedPasscode;
      unlockAdmin(savedPasscode);
    }
  }

  function cacheElements() {
    state.elements = {
      gateForm: document.getElementById("admin-gate-form"),
      adminPasscode: document.getElementById("admin-passcode"),
      gateStatus: document.getElementById("admin-gate-status"),
      adminApp: document.getElementById("admin-app"),
      summaryPanel: document.getElementById("admin-summary-panel"),
      summaryGrid: document.getElementById("admin-summary-grid"),
      pendingPanel: document.getElementById("pending-snacks-panel"),
      pendingList: document.getElementById("pending-snacks-list"),
      reviewPanel: document.getElementById("review-panel"),
      reviewList: document.getElementById("review-list"),
      catalogPanel: document.getElementById("catalog-panel"),
      catalogList: document.getElementById("catalog-list"),
      commentsPanel: document.getElementById("comments-panel"),
      commentsList: document.getElementById("comments-list"),
      submissionsPanel: document.getElementById("submissions-panel"),
      submissionsList: document.getElementById("submissions-list"),
      refreshButton: document.getElementById("admin-refresh-button"),
      statusMessage: document.getElementById("admin-status-message"),
      exportCsvButton: document.getElementById("export-csv-button")
    };
  }

  function wireEvents() {
    state.elements.gateForm.addEventListener("submit", handleGateSubmit);
    state.elements.refreshButton.addEventListener("click", loadDashboard);
    state.elements.exportCsvButton.addEventListener("click", exportSubmissionsCsv);
  }

  function initializeSupabase() {
    var config = window.DRIVER_SNACK_CONFIG || {};
    var hasUrl = typeof config.supabaseUrl === "string" && config.supabaseUrl !== "" && config.supabaseUrl.indexOf("YOUR_") !== 0;
    var hasKey = typeof config.supabaseAnonKey === "string" && config.supabaseAnonKey !== "" && config.supabaseAnonKey.indexOf("YOUR_") !== 0;

    if (!hasUrl || !hasKey || !window.supabase || !window.supabase.createClient) {
      state.configured = false;
      state.elements.gateStatus.textContent = "Add your Supabase URL and anon key in admin.html before using the admin page.";
      return;
    }

    state.supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    state.configured = true;
    state.elements.gateStatus.textContent = "Supabase is ready. Enter the passcode you set with the SQL helper.";
  }

  function handleGateSubmit(event) {
    event.preventDefault();
    unlockAdmin(cleanText(state.elements.adminPasscode.value, 120));
  }

  async function unlockAdmin(passcode) {
    if (!state.configured || !state.supabase) {
      state.elements.gateStatus.textContent = "Supabase is not configured on this page yet.";
      return;
    }

    if (!passcode) {
      state.elements.gateStatus.textContent = "Enter the admin passcode first.";
      return;
    }

    state.passcode = passcode;
    sessionStorage.setItem(STORAGE_KEY, passcode);
    state.elements.gateStatus.textContent = "Checking passcode...";

    try {
      await loadDashboard();
      state.elements.gateStatus.textContent = "Admin tools unlocked.";
      revealAdminPanels();
    } catch (error) {
      sessionStorage.removeItem(STORAGE_KEY);
      state.passcode = "";
      state.elements.gateStatus.textContent = "Passcode check failed. Make sure the passcode is correct and the SQL setup is complete.";
    }
  }

  async function loadDashboard() {
    if (!state.supabase || !state.passcode) {
      throw new Error("Admin access is not ready.");
    }

    state.elements.refreshButton.disabled = true;
    state.elements.statusMessage.textContent = "Loading dashboard...";

    try {
      var response = await state.supabase.rpc("admin_get_dashboard", {
        p_passcode: state.passcode
      });

      if (response.error) {
        throw response.error;
      }

      state.dashboard = response.data || {};
      renderDashboard(state.dashboard);
      state.elements.statusMessage.textContent = "Dashboard updated.";
    } catch (error) {
      console.error("Unable to load admin dashboard.", error);
      state.elements.statusMessage.textContent = "Dashboard could not be loaded.";
      throw error;
    } finally {
      state.elements.refreshButton.disabled = false;
    }
  }

  function revealAdminPanels() {
    state.elements.adminApp.classList.remove("hidden");
  }

  function renderDashboard(dashboard) {
    renderSummary(dashboard.summary || {});
    renderModerationSnackTable(state.elements.pendingPanel, state.elements.pendingList, dashboard.pendingSnacks || []);
    renderModerationSnackTable(state.elements.reviewPanel, state.elements.reviewList, dashboard.needsReviewSnacks || []);
    renderCatalogTable(dashboard.snacks || []);
    renderComments(dashboard.comments || []);
    renderSubmissions(dashboard.submissions || []);
  }

  function renderSummary(summary) {
    clearElement(state.elements.summaryGrid);

    var cards = [
      { label: "Approved", value: Number(summary.approvedSnackCount || 0) },
      { label: "Pending", value: Number(summary.pendingSnackCount || 0) },
      { label: "Review", value: Number(summary.needsReviewCount || 0) },
      { label: "Submissions", value: Number(summary.submissionCount || 0) },
      { label: "Comments", value: Number(summary.pendingCommentCount || 0) }
    ].filter(function (item) {
      return item.value > 0;
    });

    state.elements.summaryPanel.classList.toggle("hidden", cards.length === 0);

    if (!cards.length) {
      return;
    }

    var fragment = document.createDocumentFragment();

    cards.forEach(function (item) {
      var card = document.createElement("article");
      card.className = "stat-card admin-summary-card";

      var label = document.createElement("p");
      label.className = "stat-label";
      label.textContent = item.label;
      card.appendChild(label);

      var value = document.createElement("p");
      value.className = "stat-value";
      value.textContent = String(item.value);
      card.appendChild(value);

      fragment.appendChild(card);
    });

    state.elements.summaryGrid.appendChild(fragment);
  }

  function renderSnackList(container, snacks, emptyMessage) {
    clearElement(container);

    var panel = container === state.elements.pendingList
      ? state.elements.pendingPanel
      : container === state.elements.reviewList
        ? state.elements.reviewPanel
        : container === state.elements.catalogList
          ? state.elements.catalogPanel
          : null;

    if (panel && container !== state.elements.catalogList) {
      panel.classList.toggle("hidden", !snacks.length);
    }

    if (!snacks.length) {
      renderEmptyState(container, emptyMessage);
      return;
    }

    var fragment = document.createDocumentFragment();
    var allSnacks = state.dashboard && Array.isArray(state.dashboard.snacks) ? state.dashboard.snacks.slice() : [];
    var sortedSnacks = snacks.slice().sort(compareSnacksForAdmin);

    sortedSnacks.forEach(function (snack) {
      var card = document.createElement("article");
      card.className = "admin-card admin-snack-card";

      var path = document.createElement("p");
      path.className = "admin-snack-path";
      path.textContent = buildSnackPath(snack);
      card.appendChild(path);

      var aliasText = buildSnackAliasSummary(snack);
      if (aliasText) {
        var aliasSummary = document.createElement("p");
        aliasSummary.className = "admin-snack-aliases";
        aliasSummary.textContent = aliasText;
        card.appendChild(aliasSummary);
      }

      var chipRow = document.createElement("div");
      chipRow.className = "admin-chip-row";
      buildSnackChips(snack).forEach(function (chipText) {
        var chip = document.createElement("span");
        chip.className = "admin-chip";
        chip.textContent = chipText;
        chipRow.appendChild(chip);
      });
      card.appendChild(chipRow);

      var meta = document.createElement("p");
      meta.className = "admin-meta";
      meta.textContent = buildSnackMeta(snack);
      card.appendChild(meta);

      var editPanel = document.createElement("div");
      editPanel.className = "admin-edit-panel hidden";

      var editGrid = document.createElement("div");
      editGrid.className = "admin-edit-grid";

      var renameInput = document.createElement("input");
      renameInput.className = "text-input";
      renameInput.type = "text";
      renameInput.value = snack.title || "";
      renameInput.maxLength = 80;
      renameInput.placeholder = "Snack name";
      editGrid.appendChild(renameInput);

      var categoryInput = document.createElement("input");
      categoryInput.className = "text-input";
      categoryInput.type = "text";
      categoryInput.value = snack.category || "";
      categoryInput.maxLength = 60;
      categoryInput.placeholder = "Category";
      editGrid.appendChild(categoryInput);

      var aliasInput = document.createElement("input");
      aliasInput.className = "text-input admin-alias-input";
      aliasInput.type = "text";
      aliasInput.value = Array.isArray(snack.aliases) ? snack.aliases.join(", ") : "";
      aliasInput.maxLength = 200;
      aliasInput.placeholder = "Aliases or option names";
      editGrid.appendChild(aliasInput);

      editPanel.appendChild(editGrid);

      var actions = document.createElement("div");
      actions.className = "admin-actions admin-actions-compact";

      var saveButton = createSnackActionButton("Save Details", function () {
        return runAdminSnackAction(snack.id, "save_meta", {
          title: cleanText(renameInput.value, 80),
          category: cleanText(categoryInput.value, 60),
          aliases: parseAliasString(aliasInput.value)
        });
      }, false, true);

      var toggleButton = document.createElement("button");
      toggleButton.className = "admin-button admin-button-toggle";
      toggleButton.type = "button";
      toggleButton.textContent = "[+] Edit";
      toggleButton.addEventListener("click", function () {
        var isHidden = editPanel.classList.contains("hidden");
        editPanel.classList.toggle("hidden", !isHidden);
        saveButton.classList.toggle("hidden", !isHidden);
        toggleButton.textContent = isHidden ? "[-] Close" : "[+] Edit";
      });
      actions.appendChild(toggleButton);
      actions.appendChild(saveButton);

      actions.appendChild(createSnackActionButton(snack.approved ? "Hide Snack" : "Approve Snack", function () {
        return runAdminSnackAction(snack.id, snack.approved ? "hide" : "approve", {});
      }));

      actions.appendChild(createSnackActionButton(snack.needsReview ? "Clear Review" : "Mark Review", function () {
        return runAdminSnackAction(snack.id, "review", {
          needsReview: !snack.needsReview
        });
      }));

      actions.appendChild(createSnackActionButton("Delete Snack", function () {
        var confirmed = window.confirm("Delete this snack entry?");
        if (!confirmed) {
          return Promise.resolve();
        }
        return runAdminSnackAction(snack.id, "delete", {});
      }, true));

      card.appendChild(actions);

      var mergeRow = document.createElement("div");
      mergeRow.className = "merge-row merge-row-compact";

      var mergeSelect = document.createElement("select");
      mergeSelect.className = "select-input";
      var blankOption = document.createElement("option");
      blankOption.value = "";
      blankOption.textContent = "Merge into another snack";
      mergeSelect.appendChild(blankOption);

      allSnacks.sort(compareSnacksForAdmin).forEach(function (targetSnack) {
        if (targetSnack.id === snack.id) {
          return;
        }
        var option = document.createElement("option");
        option.value = targetSnack.id;
        option.textContent = buildSnackPath(targetSnack);
        mergeSelect.appendChild(option);
      });
      mergeRow.appendChild(mergeSelect);

      var mergeButton = createSnackActionButton("Merge", function () {
        if (!mergeSelect.value) {
          state.elements.statusMessage.textContent = "Choose a target snack before merging.";
          return Promise.resolve();
        }
        return runAdminMergeAction(snack.id, mergeSelect.value);
      });

      mergeRow.appendChild(mergeButton);
      editPanel.appendChild(mergeRow);
      card.appendChild(editPanel);

      fragment.appendChild(card);
    });

    container.appendChild(fragment);
  }

  function renderModerationSnackTable(panel, container, snacks) {
    clearElement(container);
    panel.classList.toggle("hidden", !snacks.length);

    if (!snacks.length) {
      return;
    }

    var allSnacks = state.dashboard && Array.isArray(state.dashboard.snacks) ? state.dashboard.snacks.slice().sort(compareSnacksForAdmin) : [];
    var shell = document.createElement("div");
    shell.className = "admin-compact-table-shell";
    shell.appendChild(createCompactTableHead([
      "Snack",
      "Category",
      "Options",
      "Created",
      "Actions"
    ], "admin-compact-snack-head"));

    snacks.slice().sort(compareSnacksForAdmin).forEach(function (snack) {
      shell.appendChild(createCompactSnackRow(snack));
      if (state.catalogEditSnackId === snack.id) {
        shell.appendChild(createCompactSnackEditor(snack, allSnacks));
      }
    });

    container.appendChild(shell);
  }

  function renderCatalogTable(snacks) {
    clearElement(state.elements.catalogList);
    state.elements.catalogPanel.classList.remove("hidden");

    if (!snacks.length) {
      renderEmptyState(state.elements.catalogList, "No snacks are in the catalog yet.");
      return;
    }

    var sortedSnacks = snacks.slice().sort(compareSnacksForAdmin);
    var filteredSnacks = sortedSnacks.filter(function (snack) {
      return snackMatchesCatalogFilter(snack, state.catalogFilter);
    });
    var allSnacks = sortedSnacks.slice();

    var layout = document.createElement("div");
    layout.className = "admin-catalog-layout";

    layout.appendChild(createCatalogFilterRail(sortedSnacks));
    layout.appendChild(createCatalogTableShell(filteredSnacks, allSnacks));

    state.elements.catalogList.appendChild(layout);
  }

  function createCatalogFilterRail(snacks) {
    var rail = document.createElement("aside");
    rail.className = "admin-catalog-rail";

    var filters = buildCatalogFilters(snacks);

    filters.forEach(function (filter) {
      var button = document.createElement("button");
      button.className = "admin-catalog-filter";
      if (filter.id === state.catalogFilter) {
        button.classList.add("active");
      }
      button.type = "button";
      button.addEventListener("click", function () {
        state.catalogFilter = filter.id;
        renderCatalogTable(state.dashboard && Array.isArray(state.dashboard.snacks) ? state.dashboard.snacks : []);
      });

      var label = document.createElement("span");
      label.textContent = filter.label;
      button.appendChild(label);

      var count = document.createElement("span");
      count.className = "admin-catalog-filter-count";
      count.textContent = String(filter.count);
      button.appendChild(count);

      rail.appendChild(button);
    });

    return rail;
  }

  function createCatalogTableShell(snacks, allSnacks) {
    var shell = document.createElement("div");
    shell.className = "admin-catalog-shell";

    var header = document.createElement("div");
    header.className = "admin-catalog-head";
    [
      "Snack Name",
      "Category",
      "Options",
      "Status",
      "Created",
      "Actions"
    ].forEach(function (labelText) {
      var cell = document.createElement("div");
      cell.className = "admin-catalog-head-cell";
      cell.textContent = labelText;
      header.appendChild(cell);
    });
    shell.appendChild(header);

    if (!snacks.length) {
      var empty = document.createElement("div");
      empty.className = "admin-catalog-empty";
      empty.textContent = getCatalogEmptyMessage(state.catalogFilter);
      shell.appendChild(empty);
      return shell;
    }

    snacks.forEach(function (snack) {
      shell.appendChild(createCatalogSnackRow(snack, allSnacks));
      if (state.catalogEditSnackId === snack.id) {
        shell.appendChild(createCatalogSnackEditor(snack, allSnacks));
      }
    });

    return shell;
  }

  function createCatalogSnackRow(snack, allSnacks) {
    var row = document.createElement("div");
    row.className = "admin-catalog-row";

    var nameCell = document.createElement("div");
    nameCell.className = "admin-catalog-cell admin-catalog-name";
    var title = document.createElement("p");
    title.className = "admin-catalog-title";
    title.textContent = snack.title;
    nameCell.appendChild(title);
    row.appendChild(nameCell);

    row.appendChild(createCatalogTextCell(snack.category || "None"));
    row.appendChild(createCatalogOptionsCell(snack));
    row.appendChild(createCatalogStatusCell(snack));
    row.appendChild(createCatalogTextCell(formatDateTime(snack.createdAt)));

    var actionsCell = document.createElement("div");
    actionsCell.className = "admin-catalog-cell admin-catalog-actions";
    actionsCell.appendChild(createCatalogActionButton(state.catalogEditSnackId === snack.id ? "Close" : "Edit", function () {
      state.catalogEditSnackId = state.catalogEditSnackId === snack.id ? "" : snack.id;
      renderCatalogTable(state.dashboard && Array.isArray(state.dashboard.snacks) ? state.dashboard.snacks : []);
    }));
    actionsCell.appendChild(createCatalogActionButton(snack.approved ? "Hide" : "Approve", function () {
      return runAdminSnackAction(snack.id, snack.approved ? "hide" : "approve", {});
    }));
    actionsCell.appendChild(createCatalogActionButton(snack.needsReview ? "Clear" : "Review", function () {
      return runAdminSnackAction(snack.id, "review", {
        needsReview: !snack.needsReview
      });
    }));
    actionsCell.appendChild(createCatalogActionButton("Delete", function () {
      var confirmed = window.confirm("Delete this snack entry?");
      if (!confirmed) {
        return Promise.resolve();
      }
      return runAdminSnackAction(snack.id, "delete", {});
    }, true));
    row.appendChild(actionsCell);

    return row;
  }

  function createCompactSnackRow(snack) {
    var row = document.createElement("div");
    row.className = "admin-compact-table-row admin-compact-snack-row";

    row.appendChild(createCompactTableCell(snack.title || "Untitled", "admin-compact-strong"));
    row.appendChild(createCompactTableCell(snack.category || "None"));
    row.appendChild(createCompactOptionsCell(snack));
    row.appendChild(createCompactTableCell(formatDateTime(snack.createdAt)));

    var actions = document.createElement("div");
    actions.className = "admin-compact-table-cell admin-compact-actions";
    actions.appendChild(createCatalogActionButton(state.catalogEditSnackId === snack.id ? "Close" : "Edit", function () {
      state.catalogEditSnackId = state.catalogEditSnackId === snack.id ? "" : snack.id;
      renderDashboard(state.dashboard || {});
    }));
    actions.appendChild(createCatalogActionButton(snack.approved ? "Hide" : "Approve", function () {
      return runAdminSnackAction(snack.id, snack.approved ? "hide" : "approve", {});
    }));
    actions.appendChild(createCatalogActionButton(snack.needsReview ? "Clear" : "Review", function () {
      return runAdminSnackAction(snack.id, "review", {
        needsReview: !snack.needsReview
      });
    }));
    actions.appendChild(createCatalogActionButton("Delete", function () {
      var confirmed = window.confirm("Delete this snack entry?");
      if (!confirmed) {
        return Promise.resolve();
      }
      return runAdminSnackAction(snack.id, "delete", {});
    }, true));
    row.appendChild(actions);

    return row;
  }

  function createCatalogSnackEditor(snack, allSnacks) {
    var editor = document.createElement("div");
    editor.className = "admin-catalog-editor";

    var renameInput = document.createElement("input");
    renameInput.className = "text-input";
    renameInput.type = "text";
    renameInput.value = snack.title || "";
    renameInput.maxLength = 80;

    var categoryInput = document.createElement("input");
    categoryInput.className = "text-input";
    categoryInput.type = "text";
    categoryInput.value = snack.category || "";
    categoryInput.maxLength = 60;

    var aliasInput = document.createElement("input");
    aliasInput.className = "text-input admin-catalog-editor-wide";
    aliasInput.type = "text";
    aliasInput.value = Array.isArray(snack.aliases) ? snack.aliases.join(", ") : "";
    aliasInput.maxLength = 200;
    aliasInput.placeholder = "Aliases or option names";

    editor.appendChild(createCatalogEditorField("Snack Name", renameInput));
    editor.appendChild(createCatalogEditorField("Category", categoryInput));
    editor.appendChild(createCatalogEditorField("Options", aliasInput));

    var mergeSelect = document.createElement("select");
    mergeSelect.className = "select-input";
    var blankOption = document.createElement("option");
    blankOption.value = "";
    blankOption.textContent = "Merge into another snack";
    mergeSelect.appendChild(blankOption);

    allSnacks.forEach(function (targetSnack) {
      if (targetSnack.id === snack.id) {
        return;
      }
      var option = document.createElement("option");
      option.value = targetSnack.id;
      option.textContent = buildSnackPath(targetSnack);
      mergeSelect.appendChild(option);
    });

    editor.appendChild(createCatalogEditorField("Merge", mergeSelect));

    var actionRow = document.createElement("div");
    actionRow.className = "admin-catalog-editor-actions";

    actionRow.appendChild(createCatalogActionButton("Save", function () {
      return runAdminSnackAction(snack.id, "save_meta", {
        title: cleanText(renameInput.value, 80),
        category: cleanText(categoryInput.value, 60),
        aliases: parseAliasString(aliasInput.value)
      });
    }));

    actionRow.appendChild(createCatalogActionButton("Cancel", function () {
      state.catalogEditSnackId = "";
      renderCatalogTable(state.dashboard && Array.isArray(state.dashboard.snacks) ? state.dashboard.snacks : []);
    }));

    actionRow.appendChild(createCatalogActionButton("Merge", function () {
      if (!mergeSelect.value) {
        state.elements.statusMessage.textContent = "Choose a target snack before merging.";
        return Promise.resolve();
      }
      return runAdminMergeAction(snack.id, mergeSelect.value);
    }));

    editor.appendChild(actionRow);

    return editor;
  }

  function createCompactSnackEditor(snack, allSnacks) {
    var editor = document.createElement("div");
    editor.className = "admin-compact-editor";

    var renameInput = document.createElement("input");
    renameInput.className = "text-input";
    renameInput.type = "text";
    renameInput.value = snack.title || "";
    renameInput.maxLength = 80;

    var categoryInput = document.createElement("input");
    categoryInput.className = "text-input";
    categoryInput.type = "text";
    categoryInput.value = snack.category || "";
    categoryInput.maxLength = 60;

    var aliasInput = document.createElement("input");
    aliasInput.className = "text-input admin-catalog-editor-wide";
    aliasInput.type = "text";
    aliasInput.value = Array.isArray(snack.aliases) ? snack.aliases.join(", ") : "";
    aliasInput.maxLength = 200;
    aliasInput.placeholder = "Aliases or option names";

    editor.appendChild(createCatalogEditorField("Snack Name", renameInput));
    editor.appendChild(createCatalogEditorField("Category", categoryInput));
    editor.appendChild(createCatalogEditorField("Options", aliasInput));

    var mergeSelect = document.createElement("select");
    mergeSelect.className = "select-input";
    var blankOption = document.createElement("option");
    blankOption.value = "";
    blankOption.textContent = "Merge into another snack";
    mergeSelect.appendChild(blankOption);

    allSnacks.forEach(function (targetSnack) {
      if (targetSnack.id === snack.id) {
        return;
      }
      var option = document.createElement("option");
      option.value = targetSnack.id;
      option.textContent = buildSnackPath(targetSnack);
      mergeSelect.appendChild(option);
    });

    editor.appendChild(createCatalogEditorField("Merge", mergeSelect));

    var actionRow = document.createElement("div");
    actionRow.className = "admin-catalog-editor-actions";
    actionRow.appendChild(createCatalogActionButton("Save", function () {
      return runAdminSnackAction(snack.id, "save_meta", {
        title: cleanText(renameInput.value, 80),
        category: cleanText(categoryInput.value, 60),
        aliases: parseAliasString(aliasInput.value)
      });
    }));
    actionRow.appendChild(createCatalogActionButton("Cancel", function () {
      state.catalogEditSnackId = "";
      renderDashboard(state.dashboard || {});
    }));
    actionRow.appendChild(createCatalogActionButton("Merge", function () {
      if (!mergeSelect.value) {
        state.elements.statusMessage.textContent = "Choose a target snack before merging.";
        return Promise.resolve();
      }
      return runAdminMergeAction(snack.id, mergeSelect.value);
    }));
    editor.appendChild(actionRow);

    return editor;
  }

  function createCatalogEditorField(labelText, control) {
    var field = document.createElement("label");
    field.className = "admin-catalog-editor-field";

    var label = document.createElement("span");
    label.className = "admin-catalog-editor-label";
    label.textContent = labelText;
    field.appendChild(label);

    field.appendChild(control);
    return field;
  }

  function createCatalogTextCell(textValue) {
    var cell = document.createElement("div");
    cell.className = "admin-catalog-cell";
    cell.textContent = textValue || "None";
    return cell;
  }

  function createCompactTableHead(labels, className) {
    var head = document.createElement("div");
    head.className = "admin-compact-table-head " + className;

    labels.forEach(function (labelText) {
      var cell = document.createElement("div");
      cell.className = "admin-compact-table-head-cell";
      cell.textContent = labelText;
      head.appendChild(cell);
    });

    return head;
  }

  function createCompactTableCell(textValue, extraClassName) {
    var cell = document.createElement("div");
    cell.className = "admin-compact-table-cell";
    if (extraClassName) {
      cell.classList.add(extraClassName);
    }
    cell.textContent = textValue || "None";
    return cell;
  }

  function createCompactOptionsCell(snack) {
    var cell = document.createElement("div");
    cell.className = "admin-compact-table-cell";

    var path = document.createElement("p");
    path.className = "admin-catalog-path";
    path.textContent = buildSnackPath(snack);
    cell.appendChild(path);

    return cell;
  }

  function createCatalogStatusCell(snack) {
    var cell = document.createElement("div");
    cell.className = "admin-catalog-cell admin-catalog-status";

    buildSnackChips(snack).forEach(function (chipText) {
      var chip = document.createElement("span");
      chip.className = "admin-catalog-badge";
      if (chipText === "Approved") {
        chip.classList.add("approved");
      } else if (chipText === "Pending") {
        chip.classList.add("pending");
      } else if (chipText === "Hidden") {
        chip.classList.add("hidden-badge");
      } else if (chipText === "Review") {
        chip.classList.add("review");
      }
      chip.textContent = chipText;
      cell.appendChild(chip);
    });

    return cell;
  }

  function createCatalogOptionsCell(snack) {
    var cell = document.createElement("div");
    cell.className = "admin-catalog-cell admin-catalog-options";

    var path = document.createElement("p");
    path.className = "admin-catalog-path";
    path.textContent = buildSnackPath(snack);
    cell.appendChild(path);

    return cell;
  }

  function createCatalogActionButton(label, action, isDanger) {
    var button = document.createElement("button");
    button.className = "admin-catalog-action";
    if (isDanger) {
      button.classList.add("danger");
    }
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", function () {
      button.disabled = true;
      Promise.resolve(action()).finally(function () {
        button.disabled = false;
      });
    });
    return button;
  }

  function buildCatalogFilters(snacks) {
    var categoryCounts = {};

    snacks.forEach(function (snack) {
      var categoryKey = getCatalogCategoryGroup(snack);
      categoryCounts[categoryKey] = (categoryCounts[categoryKey] || 0) + 1;
    });

    var filters = [
      { id: "all", label: "All Snacks", count: snacks.length },
      { id: "chips", label: "Chips", count: categoryCounts.chips || 0 },
      { id: "cookies", label: "Cookies", count: categoryCounts.cookies || 0 },
      { id: "crackers", label: "Crackers", count: categoryCounts.crackers || 0 },
      { id: "drinks", label: "Drinks", count: categoryCounts.drinks || 0 },
      { id: "other", label: "Other", count: categoryCounts.other || 0 },
      { id: "approved", label: "Approved", count: snacks.filter(function (snack) { return !!snack.approved && !snack.hidden; }).length },
      { id: "review", label: "Review", count: snacks.filter(function (snack) { return !!snack.needsReview; }).length },
      { id: "hidden", label: "Hidden", count: snacks.filter(function (snack) { return !!snack.hidden; }).length },
      { id: "pending", label: "Pending", count: snacks.filter(function (snack) { return !snack.approved && !snack.hidden; }).length }
    ];

    return filters.filter(function (filter) {
      return filter.id === "all" || filter.id === "review" || filter.count > 0;
    });
  }

  function getCatalogEmptyMessage(filterId) {
    if (filterId === "review") {
      return "No items to review.";
    }
    if (filterId === "hidden") {
      return "No hidden snacks.";
    }
    if (filterId === "pending") {
      return "No pending snacks.";
    }
    if (filterId === "approved") {
      return "No approved snacks.";
    }
    return "No snacks match this filter.";
  }

  function snackMatchesCatalogFilter(snack, filterId) {
    if (filterId === "all") {
      return true;
    }
    if (filterId === "hidden") {
      return !!snack.hidden;
    }
    if (filterId === "review") {
      return !!snack.needsReview;
    }
    if (filterId === "approved") {
      return !!snack.approved && !snack.hidden;
    }
    if (filterId === "pending") {
      return !snack.approved && !snack.hidden;
    }
    return getCatalogCategoryGroup(snack) === filterId;
  }

  function getCatalogCategoryGroup(snack) {
    var category = String(snack.category || "").toLowerCase();

    if (category.indexOf("chip") !== -1) {
      return "chips";
    }
    if (category.indexOf("cookie") !== -1) {
      return "cookies";
    }
    if (category.indexOf("cracker") !== -1) {
      return "crackers";
    }
    if (category.indexOf("drink") !== -1 || category.indexOf("water") !== -1) {
      return "drinks";
    }
    return "other";
  }


  function renderComments(comments) {
    clearElement(state.elements.commentsList);
    state.elements.commentsPanel.classList.toggle("hidden", !comments.length);

    if (!comments.length) {
      return;
    }

    var shell = document.createElement("div");
    shell.className = "admin-compact-table-shell";
    shell.appendChild(createCompactTableHead([
      "Driver",
      "Comment",
      "Status",
      "Created",
      "Actions"
    ], "admin-compact-comment-head"));

    comments.forEach(function (comment) {
      var row = document.createElement("div");
      row.className = "admin-compact-table-row admin-compact-comment-row";
      row.appendChild(createCompactTableCell(comment.nickname || "Anonymous driver", "admin-compact-strong"));
      row.appendChild(createCompactTableCell(comment.commentText || "None"));
      row.appendChild(createCompactTableCell(buildCommentStatusText(comment)));
      row.appendChild(createCompactTableCell(formatDateTime(comment.createdAt)));

      var actions = document.createElement("div");
      actions.className = "admin-compact-table-cell admin-compact-actions";
      actions.appendChild(createCatalogActionButton(comment.approved ? "Hide" : "Approve", function () {
        return runAdminCommentAction(comment.id, comment.approved ? "hide" : "approve");
      }));
      actions.appendChild(createCatalogActionButton("Delete", function () {
        var confirmed = window.confirm("Delete this comment?");
        if (!confirmed) {
          return Promise.resolve();
        }
        return runAdminCommentAction(comment.id, "delete");
      }, true));
      row.appendChild(actions);
      shell.appendChild(row);
    });

    state.elements.commentsList.appendChild(shell);
  }

  function renderSubmissions(submissions) {
    clearElement(state.elements.submissionsList);
    state.elements.submissionsPanel.classList.toggle("hidden", !submissions.length);

    if (!submissions.length) {
      return;
    }

    var shell = document.createElement("div");
    shell.className = "admin-compact-table-shell";
    shell.appendChild(createCompactTableHead([
      "Submission",
      "Picked",
      "Suggestion",
      "Note",
      "Created",
      "Actions"
    ], "admin-compact-submission-head"));

    submissions.forEach(function (submission) {
      var row = document.createElement("div");
      row.className = "admin-compact-table-row admin-compact-submission-row";
      row.appendChild(createCompactTableCell("Submission " + String(submission.id || "").slice(0, 8), "admin-compact-strong"));
      row.appendChild(createCompactTableCell(((submission.selectedSnackTitles || []).join(", ") || "None")));
      row.appendChild(createCompactTableCell(submission.customSnackOriginal || submission.wantsAdded || "None"));
      row.appendChild(createCompactTableCell(submission.message || submission.dislikes || "None"));
      row.appendChild(createCompactTableCell(formatDateTime(submission.createdAt)));

      var actions = document.createElement("div");
      actions.className = "admin-compact-table-cell admin-compact-actions";
      actions.appendChild(createCatalogActionButton("Delete", function () {
        var confirmed = window.confirm("Delete this submission?");
        if (!confirmed) {
          return Promise.resolve();
        }
        return runAdminDeleteSubmission(submission.id);
      }, true));
      row.appendChild(actions);
      shell.appendChild(row);
    });

    state.elements.submissionsList.appendChild(shell);
  }

  function createParagraph(textValue) {
    var paragraph = document.createElement("p");
    paragraph.textContent = textValue;
    return paragraph;
  }

  function createSnackActionButton(label, action, isDanger, startsHidden) {
    var button = document.createElement("button");
    button.className = "admin-button";
    if (isDanger) {
      button.classList.add("danger");
    }
    if (startsHidden) {
      button.classList.add("hidden");
    }
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", function () {
      button.disabled = true;
      Promise.resolve(action()).finally(function () {
        button.disabled = false;
      });
    });
    return button;
  }

  async function runAdminSnackAction(snackId, action, payload) {
    await callAdminRpc("admin_update_snack", {
      p_passcode: state.passcode,
      p_snack_id: snackId,
      p_action: action,
      p_payload: payload || {}
    });
    state.elements.statusMessage.textContent = "Snack updated.";
    await loadDashboard();
  }

  async function runAdminMergeAction(sourceSnackId, targetSnackId) {
    await callAdminRpc("admin_merge_snacks", {
      p_passcode: state.passcode,
      p_source_snack_id: sourceSnackId,
      p_target_snack_id: targetSnackId
    });
    state.elements.statusMessage.textContent = "Snack merge complete.";
    await loadDashboard();
  }

  async function runAdminCommentAction(commentId, action) {
    await callAdminRpc("admin_update_comment", {
      p_passcode: state.passcode,
      p_comment_id: commentId,
      p_action: action
    });
    state.elements.statusMessage.textContent = "Comment updated.";
    await loadDashboard();
  }

  async function runAdminDeleteSubmission(submissionId) {
    await callAdminRpc("admin_delete_submission", {
      p_passcode: state.passcode,
      p_submission_id: submissionId
    });
    state.elements.statusMessage.textContent = "Submission deleted.";
    await loadDashboard();
  }

  async function callAdminRpc(functionName, params) {
    if (!state.supabase || !state.passcode) {
      throw new Error("Admin access is locked.");
    }

    var response = await state.supabase.rpc(functionName, params);
    if (response.error) {
      throw response.error;
    }
    return response.data;
  }

  function exportSubmissionsCsv() {
    var submissions = state.dashboard && Array.isArray(state.dashboard.submissions) ? state.dashboard.submissions : [];
    if (!submissions.length) {
      state.elements.statusMessage.textContent = "There are no submissions to export yet.";
      return;
    }

    var headers = [
      "id",
      "createdAt",
      "selectedSnackTitles",
      "customSnackOriginal",
      "preferredWaterBrand",
      "wantsAdded",
      "dislikes",
      "deliveryFrequency",
      "areaDelivery",
      "neighborhoodSighting",
      "wasillaSighting",
      "message",
      "nickname",
      "needsReview"
    ];

    var rows = [headers.join(",")];

    submissions.forEach(function (submission) {
      var values = [
        submission.id,
        submission.createdAt,
        (submission.selectedSnackTitles || []).join(" | "),
        submission.customSnackOriginal,
        submission.preferredWaterBrand,
        submission.wantsAdded,
        submission.dislikes,
        submission.deliveryFrequency,
        submission.areaDelivery,
        submission.neighborhoodSighting,
        submission.wasillaSighting,
        submission.message,
        submission.nickname,
        submission.needsReview
      ];

      rows.push(values.map(csvEscape).join(","));
    });

    var blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "driver-snack-station-submissions.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    state.elements.statusMessage.textContent = "CSV exported.";
  }

  function csvEscape(value) {
    var safeValue = value === null || value === undefined ? "" : String(value);
    return "\"" + safeValue.replace(/"/g, "\"\"") + "\"";
  }

  function buildSnackMeta(snack) {
    return "Created " + formatDateTime(snack.createdAt);
  }

  function buildCommentStatusText(comment) {
    var parts = [comment.approved ? "Approved" : "Pending"];
    if (comment.hidden) {
      parts.push("Hidden");
    }
    return parts.join(" | ");
  }

  function buildSnackPath(snack) {
    var segments = [snack.category || "Snack", snack.title || "Untitled"];
    return segments.filter(Boolean).join(" > ");
  }

  function buildSnackAliasSummary(snack) {
    var aliases = Array.isArray(snack.aliases) ? snack.aliases.filter(Boolean) : [];
    if (!aliases.length) {
      return "";
    }
    return "Options: " + aliases.join(", ");
  }

  function buildSnackChips(snack) {
    var chips = [snack.approved ? "Approved" : "Pending"];
    var voteCount = Number(snack.voteCount || 0);

    if (snack.hidden) {
      chips.push("Hidden");
    }

    if (snack.needsReview) {
      chips.push("Review");
    }

    if (voteCount > 0) {
      chips.push("Votes " + String(voteCount));
    }

    return chips;
  }

  function compareSnacksForAdmin(left, right) {
    var leftPath = buildSnackPath(left).toLowerCase();
    var rightPath = buildSnackPath(right).toLowerCase();
    return leftPath.localeCompare(rightPath);
  }

  function parseAliasString(value) {
    return cleanText(value, 200)
      .split(",")
      .map(function (alias) {
        return alias.trim();
      })
      .filter(Boolean);
  }

  function cleanText(value, maxLength) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  }

  function formatDateTime(value) {
    if (!value) {
      return "Unknown";
    }

    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "Unknown";
    }

    return date.toLocaleString();
  }

  function clearElement(element) {
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function renderEmptyState(container, message) {
    var empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = message;
    container.appendChild(empty);
  }
}());
