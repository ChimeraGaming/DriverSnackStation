(function () {
  "use strict";

  var STORAGE_KEY = "driverSnackStationAdminPasscode";

  var state = {
    supabase: null,
    passcode: "",
    dashboard: null,
    configured: false,
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
      statusForm: document.getElementById("status-form"),
      statusInput: document.getElementById("station-status-input"),
      statusMessage: document.getElementById("admin-status-message"),
      exportCsvButton: document.getElementById("export-csv-button")
    };
  }

  function wireEvents() {
    state.elements.gateForm.addEventListener("submit", handleGateSubmit);
    state.elements.refreshButton.addEventListener("click", loadDashboard);
    state.elements.statusForm.addEventListener("submit", handleStatusSave);
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
    state.elements.summaryPanel.classList.remove("hidden");
    state.elements.pendingPanel.classList.remove("hidden");
    state.elements.reviewPanel.classList.remove("hidden");
    state.elements.catalogPanel.classList.remove("hidden");
    state.elements.commentsPanel.classList.remove("hidden");
    state.elements.submissionsPanel.classList.remove("hidden");
  }

  function renderDashboard(dashboard) {
    state.elements.statusInput.value = dashboard.stationStatus || "";
    renderSummary(dashboard.summary || {});
    renderSnackList(state.elements.pendingList, dashboard.pendingSnacks || [], "No pending snacks.");
    renderSnackList(state.elements.reviewList, dashboard.needsReviewSnacks || [], "No snacks are marked for review.");
    renderSnackList(state.elements.catalogList, dashboard.snacks || [], "No snacks are in the catalog yet.");
    renderComments(dashboard.comments || []);
    renderSubmissions(dashboard.submissions || []);
  }

  function renderSummary(summary) {
    clearElement(state.elements.summaryGrid);

    var cards = [
      { label: "Current status", value: summary.currentStatus || "None" },
      { label: "Approved snacks", value: summary.approvedSnackCount || 0 },
      { label: "Pending snacks", value: summary.pendingSnackCount || 0 },
      { label: "Needs review", value: summary.needsReviewCount || 0 },
      { label: "Recent submissions", value: summary.submissionCount || 0 },
      { label: "Pending comments", value: summary.pendingCommentCount || 0 }
    ];

    var fragment = document.createDocumentFragment();

    cards.forEach(function (item) {
      var card = document.createElement("article");
      card.className = "stat-card";

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

    if (!snacks.length) {
      renderEmptyState(container, emptyMessage);
      return;
    }

    var fragment = document.createDocumentFragment();
    var allSnacks = state.dashboard && Array.isArray(state.dashboard.snacks) ? state.dashboard.snacks : [];

    snacks.forEach(function (snack) {
      var card = document.createElement("article");
      card.className = "admin-card";

      var title = document.createElement("h3");
      title.textContent = snack.title;
      card.appendChild(title);

      var meta = document.createElement("p");
      meta.className = "admin-meta";
      meta.textContent = buildSnackMeta(snack);
      card.appendChild(meta);

      var renameInput = document.createElement("input");
      renameInput.className = "text-input";
      renameInput.type = "text";
      renameInput.value = snack.title || "";
      renameInput.maxLength = 80;
      card.appendChild(renameInput);

      var categoryInput = document.createElement("input");
      categoryInput.className = "text-input";
      categoryInput.type = "text";
      categoryInput.value = snack.category || "";
      categoryInput.maxLength = 60;
      card.appendChild(categoryInput);

      var aliasInput = document.createElement("input");
      aliasInput.className = "text-input";
      aliasInput.type = "text";
      aliasInput.value = Array.isArray(snack.aliases) ? snack.aliases.join(", ") : "";
      aliasInput.maxLength = 200;
      aliasInput.placeholder = "Comma separated aliases";
      card.appendChild(aliasInput);

      var actions = document.createElement("div");
      actions.className = "admin-actions";

      actions.appendChild(createSnackActionButton("Save Details", function () {
        return runAdminSnackAction(snack.id, "save_meta", {
          title: cleanText(renameInput.value, 80),
          category: cleanText(categoryInput.value, 60),
          aliases: parseAliasString(aliasInput.value)
        });
      }));

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
      mergeRow.className = "merge-row";

      var mergeLabel = document.createElement("label");
      mergeLabel.className = "field-label";
      mergeLabel.textContent = "Merge into another snack";
      mergeRow.appendChild(mergeLabel);

      var mergeSelect = document.createElement("select");
      mergeSelect.className = "select-input";
      var blankOption = document.createElement("option");
      blankOption.value = "";
      blankOption.textContent = "Choose target snack";
      mergeSelect.appendChild(blankOption);

      allSnacks.forEach(function (targetSnack) {
        if (targetSnack.id === snack.id) {
          return;
        }
        var option = document.createElement("option");
        option.value = targetSnack.id;
        option.textContent = targetSnack.title;
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
      card.appendChild(mergeRow);

      fragment.appendChild(card);
    });

    container.appendChild(fragment);
  }

  function renderComments(comments) {
    clearElement(state.elements.commentsList);

    if (!comments.length) {
      renderEmptyState(state.elements.commentsList, "No comments to review.");
      return;
    }

    var fragment = document.createDocumentFragment();

    comments.forEach(function (comment) {
      var card = document.createElement("article");
      card.className = "admin-card";

      var title = document.createElement("h3");
      title.textContent = comment.nickname || "Anonymous driver";
      card.appendChild(title);

      var text = document.createElement("p");
      text.textContent = comment.commentText || "";
      card.appendChild(text);

      var meta = document.createElement("p");
      meta.className = "admin-meta";
      meta.textContent = "Approved: " + (comment.approved ? "Yes" : "No") + " | Hidden: " + (comment.hidden ? "Yes" : "No") + " | Created: " + formatDateTime(comment.createdAt);
      card.appendChild(meta);

      var actions = document.createElement("div");
      actions.className = "admin-actions";

      actions.appendChild(createSnackActionButton(comment.approved ? "Hide Comment" : "Approve Comment", function () {
        return runAdminCommentAction(comment.id, comment.approved ? "hide" : "approve");
      }));

      actions.appendChild(createSnackActionButton("Delete Comment", function () {
        var confirmed = window.confirm("Delete this comment?");
        if (!confirmed) {
          return Promise.resolve();
        }
        return runAdminCommentAction(comment.id, "delete");
      }, true));

      card.appendChild(actions);
      fragment.appendChild(card);
    });

    state.elements.commentsList.appendChild(fragment);
  }

  function renderSubmissions(submissions) {
    clearElement(state.elements.submissionsList);

    if (!submissions.length) {
      renderEmptyState(state.elements.submissionsList, "No submissions yet.");
      return;
    }

    var fragment = document.createDocumentFragment();

    submissions.forEach(function (submission) {
      var card = document.createElement("article");
      card.className = "admin-card";

      var title = document.createElement("h3");
      title.textContent = "Submission " + String(submission.id || "").slice(0, 8);
      card.appendChild(title);

      card.appendChild(createParagraph("Selected snacks: " + ((submission.selectedSnackTitles || []).join(", ") || "None")));
      card.appendChild(createParagraph("Custom snack: " + (submission.customSnackOriginal || "None")));
      card.appendChild(createParagraph("Preferred water brand: " + (submission.preferredWaterBrand || "None")));
      card.appendChild(createParagraph("Requested additions: " + (submission.wantsAdded || "None")));
      card.appendChild(createParagraph("Dislikes: " + (submission.dislikes || "None")));
      card.appendChild(createParagraph("Message: " + (submission.message || "None")));

      var meta = document.createElement("p");
      meta.className = "admin-meta";
      meta.textContent = "Nickname: " + (submission.nickname || "Anonymous") + " | Frequency: " + (submission.deliveryFrequency || "None") + " | Area: " + (submission.areaDelivery || "None") + " | Created: " + formatDateTime(submission.createdAt);
      card.appendChild(meta);

      var deleteButton = createSnackActionButton("Delete Submission", function () {
        var confirmed = window.confirm("Delete this submission?");
        if (!confirmed) {
          return Promise.resolve();
        }
        return runAdminDeleteSubmission(submission.id);
      }, true);

      card.appendChild(deleteButton);
      fragment.appendChild(card);
    });

    state.elements.submissionsList.appendChild(fragment);
  }

  function createParagraph(textValue) {
    var paragraph = document.createElement("p");
    paragraph.textContent = textValue;
    return paragraph;
  }

  function createSnackActionButton(label, action, isDanger) {
    var button = document.createElement("button");
    button.className = "admin-button";
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

  async function handleStatusSave(event) {
    event.preventDefault();

    var nextStatus = cleanText(state.elements.statusInput.value, 120);
    if (!nextStatus) {
      state.elements.statusMessage.textContent = "Enter a station status first.";
      return;
    }

    try {
      await callAdminRpc("admin_update_station_status", {
        p_passcode: state.passcode,
        p_status: nextStatus
      });
      state.elements.statusMessage.textContent = "Station status saved.";
      await loadDashboard();
    } catch (error) {
      console.error("Unable to save station status.", error);
      state.elements.statusMessage.textContent = "Station status could not be saved.";
    }
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
    var parts = [
      "Approved: " + (snack.approved ? "Yes" : "No"),
      "Hidden: " + (snack.hidden ? "Yes" : "No"),
      "Needs review: " + (snack.needsReview ? "Yes" : "No"),
      "Votes: " + Number(snack.voteCount || 0),
      "Created: " + formatDateTime(snack.createdAt)
    ];
    return parts.join(" | ");
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
