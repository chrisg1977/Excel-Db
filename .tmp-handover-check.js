
    const AUTH_STORAGE_KEY = "empinfo.auth.v1";
    const API_ORIGIN_STORAGE_KEY = "empinfo.api_origin.v1";
    const DEFAULT_API_ORIGIN = window.location.port === "8055" ? window.location.origin : `${window.location.protocol}//${window.location.hostname}:8055`;
    const PAGE_QUERY = new URLSearchParams(window.location.search);

    const refs = {
      statusLine: document.getElementById("statusLine"),
      btnRefresh: document.getElementById("btnRefresh"),
      btnBackHub: document.getElementById("btnBackHub"),
      btnAdd: document.getElementById("btnAdd"),
      btnApplyFilters: document.getElementById("btnApplyFilters"),
      handoverCountValue: document.getElementById("handoverCountValue"),
      handoverCountMeta: document.getElementById("handoverCountMeta"),
      todoCountValue: document.getElementById("todoCountValue"),
      todoCountMeta: document.getElementById("todoCountMeta"),
      claimedByOthersValue: document.getElementById("claimedByOthersValue"),
      claimedByOthersMeta: document.getElementById("claimedByOthersMeta"),
      visibleItemsValue: document.getElementById("visibleItemsValue"),
      visibleItemsMeta: document.getElementById("visibleItemsMeta"),
      filterSource: document.getElementById("filterSource"),
      filterRecipient: document.getElementById("filterRecipient"),
      filterSearch: document.getElementById("filterSearch"),
      groupList: document.getElementById("groupList"),
      itemsBody: document.getElementById("itemsBody"),
      entryModal: document.getElementById("entryModal"),
      btnCloseModal: document.getElementById("btnCloseModal"),
      btnCancelEntry: document.getElementById("btnCancelEntry"),
      btnSaveEntry: document.getElementById("btnSaveEntry"),
      createdAtDisplay: document.getElementById("createdAtDisplay"),
      dueAt: document.getElementById("dueAt"),
      entryNote: document.getElementById("entryNote"),
      targetUser: document.getElementById("targetUser"),
      targetGroup: document.getElementById("targetGroup"),
      groupCompletionMode: document.getElementById("groupCompletionMode"),
      userRecipientField: document.getElementById("userRecipientField"),
      groupRecipientField: document.getElementById("groupRecipientField"),
      groupModeField: document.getElementById("groupModeField"),
      entrySourceRadios: Array.from(document.querySelectorAll('input[name="entrySource"]')),
      recipientModeRadios: Array.from(document.querySelectorAll('input[name="recipientMode"]'))
    };

    const state = { apiOrigin: "", token: "", busy: false, bootstrap: null };

    function normalizeApiOrigin(value) { return String(value || "").trim().replace(/\/$/, ""); }
    function getApiOrigin() {
      const queryOrigin = normalizeApiOrigin(PAGE_QUERY.get("api_origin"));
      if (queryOrigin) return queryOrigin;
      try {
        const stored = normalizeApiOrigin(localStorage.getItem(API_ORIGIN_STORAGE_KEY));
        if (stored) return stored;
      } catch {}
      return DEFAULT_API_ORIGIN;
    }
    function persistApiOrigin(value) {
      state.apiOrigin = normalizeApiOrigin(value);
      try { localStorage.setItem(API_ORIGIN_STORAGE_KEY, state.apiOrigin); } catch {}
    }
    function getAuthToken() {
      try {
        const record = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "{}");
        return String(record?.access_token || "").trim();
      } catch {
        return "";
      }
    }
    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }
    function formatDateTime(value) {
      if (!value) return "-";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString("en-MT");
    }
    function setStatus(message, tone) {
      refs.statusLine.textContent = message;
      refs.statusLine.classList.remove("ok", "err");
      if (tone) refs.statusLine.classList.add(tone);
    }
    function setBusy(value, message) {
      state.busy = Boolean(value);
      document.querySelectorAll("button, input, select, textarea").forEach((node) => {
        node.disabled = state.busy;
      });
      if (message) setStatus(message);
    }
    function getHeaders(hasBody) {
      const headers = { Accept: "application/json" };
      if (state.token) headers.Authorization = `Bearer ${state.token}`;
      if (hasBody) headers["Content-Type"] = "application/json";
      return headers;
    }
    async function fetchJson(path, options) {
      const opts = options || {};
      const hasBody = Object.prototype.hasOwnProperty.call(opts, "body");
      const response = await fetch(`${state.apiOrigin}${path}`, {
        method: opts.method || "GET",
        headers: getHeaders(hasBody),
        body: hasBody ? JSON.stringify(opts.body) : undefined,
        cache: "no-store"
      });
      const text = await response.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (!response.ok) {
        const message = data?.errors?.[0]?.message || data?.error || data?.message || data?.raw || `Request failed (${response.status})`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }
      return data;
    }
    function getSelectedValue(name) {
      const selected = document.querySelector(`input[name="${name}"]:checked`);
      return String(selected?.value || "").trim().toLowerCase();
    }
    function getVisibleItems() {
      const items = Array.isArray(state.bootstrap?.items) ? state.bootstrap.items : [];
      const sourceFilter = String(refs.filterSource.value || "").trim().toLowerCase();
      const recipientFilter = String(refs.filterRecipient.value || "").trim().toLowerCase();
      const search = String(refs.filterSearch.value || "").trim().toLowerCase();
      return items.filter((item) => {
        const haystack = `${String(item.title || "")} ${String(item.details || "")} ${String(item.target_label || "")}`.toLowerCase();
        if (sourceFilter && String(item.source || "").toLowerCase() !== sourceFilter) return false;
        if (recipientFilter && String(item.target_type || "").toLowerCase() !== recipientFilter) return false;
        if (search && !haystack.includes(search)) return false;
        return true;
      });
    }
    function renderSummary() {
      const summary = state.bootstrap?.summary || {};
      refs.handoverCountValue.textContent = String(Number(summary.handover_count || 0));
      refs.todoCountValue.textContent = String(Number(summary.todo_count || 0));
      refs.claimedByOthersValue.textContent = String(Number(summary.group_claimed_by_others || 0));
      refs.handoverCountMeta.textContent = "Open handover items";
      refs.todoCountMeta.textContent = "Open to-do items";
      refs.claimedByOthersMeta.textContent = "Group items partly done by others";
    }
    function renderGroups() {
      const groups = Array.isArray(state.bootstrap?.available_groups) ? state.bootstrap.available_groups : [];
      refs.groupList.innerHTML = groups.length
        ? groups.map((group) => {
            const suffix = Number(group.member_count || 0) > 0 ? `${group.member_count} active user(s)` : "no active app users";
            return `<span class="badge">${escapeHtml(group.label)} - ${escapeHtml(suffix)}</span>`;
          }).join("")
        : "<span class=\"muted\">No recipient groups available.</span>";
    }
    function renderItems() {
      const items = getVisibleItems();
      refs.visibleItemsValue.textContent = String(items.length);
      refs.visibleItemsMeta.textContent = items.length ? "Rows currently shown below" : "No rows match the current filters";
      if (!items.length) {
        refs.itemsBody.innerHTML = "<tr><td colspan=\"9\" class=\"muted\">No handover or to-do items are available for this view.</td></tr>";
        return;
      }
      refs.itemsBody.innerHTML = items.map((item) => {
        const noteText = String(item.details || "").trim() || String(item.title || "").trim() || "-";
        const progressClass = String(item.status || "").toLowerCase() === "in progress" ? "badge warn" : "badge";
        return `
          <tr>
            <td>${escapeHtml(String(item.id || "-"))}</td>
            <td><span class="badge">${escapeHtml(String(item.source || "").toLowerCase() === "todo" ? "To Do" : "Handover")}</span></td>
            <td>${escapeHtml(noteText)}</td>
            <td>${escapeHtml(String(item.target_label || "-"))}</td>
            <td>${escapeHtml(formatDateTime(item.due_at))}</td>
            <td>${escapeHtml(formatDateTime(item.created_at))}</td>
            <td>${escapeHtml(String(item.created_by_label || "-"))}</td>
            <td><span class="${progressClass}">${escapeHtml(String(item.completion_progress_label || "Open"))}</span></td>
            <td>
              <label class="done-cell">
                <input type="checkbox" data-complete-id="${escapeHtml(String(item.id || ""))}" ${item.current_user_completed ? "checked" : ""} ${!item.current_user_can_complete || item.current_user_completed ? "disabled" : ""} />
                <span>${item.current_user_completed ? "Done" : "Mark done"}</span>
              </label>
            </td>
          </tr>
        `;
      }).join("");
    }
    function renderAll() {
      refs.btnBackHub.href = `./app-hub.html?api_origin=${encodeURIComponent(state.apiOrigin)}`;
      renderSummary();
      renderGroups();
      renderItems();
    }
    function populateSelects() {
      const users = Array.isArray(state.bootstrap?.available_users) ? state.bootstrap.available_users : [];
      refs.targetUser.innerHTML = users.map((user) => {
        const suffix = user.job_label ? ` (${user.job_label})` : "";
        return `<option value="${escapeHtml(user.email)}">${escapeHtml(String(user.label || "") + suffix)}</option>`;
      }).join("");
      const groups = Array.isArray(state.bootstrap?.available_groups) ? state.bootstrap.available_groups : [];
      refs.targetGroup.innerHTML = groups.map((group) => {
        const suffix = ` (${Number(group.member_count || 0)})`;
        return `<option value="${escapeHtml(group.key)}">${escapeHtml(String(group.label || "") + suffix)}</option>`;
      }).join("");
    }
    function syncModalState() {
      const source = getSelectedValue("entrySource");
      const selfRadio = refs.recipientModeRadios.find((node) => String(node.value) === "self");
      if (selfRadio) {
        selfRadio.disabled = source !== "todo";
        if (source !== "todo" && selfRadio.checked) {
          const userRadio = refs.recipientModeRadios.find((node) => String(node.value) === "user");
          if (userRadio) userRadio.checked = true;
        }
      }
      const mode = getSelectedValue("recipientMode");
      refs.userRecipientField.classList.toggle("hidden", mode !== "user");
      refs.groupRecipientField.classList.toggle("hidden", mode !== "group");
      refs.groupModeField.classList.toggle("hidden", mode !== "group");
    }
    function openModal() {
      refs.createdAtDisplay.textContent = formatDateTime(new Date().toISOString());
      refs.dueAt.value = "";
      refs.entryNote.value = "";
      const handoverRadio = refs.entrySourceRadios.find((node) => String(node.value) === "handover");
      const userRadio = refs.recipientModeRadios.find((node) => String(node.value) === "user");
      if (handoverRadio) handoverRadio.checked = true;
      if (userRadio) userRadio.checked = true;
      syncModalState();
      refs.entryModal.classList.remove("hidden");
      refs.entryNote.focus();
    }
    function closeModal() { refs.entryModal.classList.add("hidden"); }
    async function refreshData() {
      setBusy(true, "Loading handover data...");
      try {
        state.bootstrap = await fetchJson("/handover/bootstrap");
        populateSelects();
        renderAll();
        const name = String(state.bootstrap?.current_user?.label || "User");
        const count = Array.isArray(state.bootstrap?.items) ? state.bootstrap.items.length : 0;
        setStatus(`Signed in as ${name}. Loaded ${count} open handover / to-do item(s).`, "ok");
      } finally {
        setBusy(false);
      }
    }
    async function saveEntry() {
      const note = String(refs.entryNote.value || "").trim();
      if (!note) {
        setStatus("Write a note before saving.", "err");
        refs.entryNote.focus();
        return;
      }
      const mode = getSelectedValue("recipientMode");
      const payload = {
        source: getSelectedValue("entrySource"),
        recipient_mode: mode,
        target_user_email: mode === "user" ? refs.targetUser.value : null,
        group_key: mode === "group" ? refs.targetGroup.value : null,
        group_completion_mode: mode === "group" ? refs.groupCompletionMode.value : null,
        due_at: refs.dueAt.value ? new Date(refs.dueAt.value).toISOString() : null,
        note
      };
      setBusy(true, "Saving handover entry...");
      try {
        await fetchJson("/handover/items", { method: "POST", body: payload });
        closeModal();
        await refreshData();
        setStatus("Handover / To Do item added.", "ok");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Failed to save handover entry.", "err");
      } finally {
        setBusy(false);
      }
    }
    async function completeItem(itemId) {
      setBusy(true, "Updating handover item...");
      try {
        await fetchJson(`/handover/items/${encodeURIComponent(itemId)}/complete`, { method: "POST", body: {} });
        await refreshData();
        setStatus("Item marked done.", "ok");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Failed to update item.", "err");
      } finally {
        setBusy(false);
      }
    }
    function bindEvents() {
      refs.btnRefresh.addEventListener("click", () => { void refreshData(); });
      refs.btnApplyFilters.addEventListener("click", () => {
        renderAll();
        setStatus("Updated the handover view filters.", "ok");
      });
      refs.btnAdd.addEventListener("click", openModal);
      refs.btnCloseModal.addEventListener("click", closeModal);
      refs.btnCancelEntry.addEventListener("click", closeModal);
      refs.btnSaveEntry.addEventListener("click", () => { void saveEntry(); });
      refs.entrySourceRadios.forEach((node) => node.addEventListener("change", syncModalState));
      refs.recipientModeRadios.forEach((node) => node.addEventListener("change", syncModalState));
      refs.entryModal.addEventListener("click", (event) => {
        if (event.target === refs.entryModal) closeModal();
      });
      refs.itemsBody.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        const itemId = String(target.dataset.completeId || "").trim();
        if (!itemId || !target.checked) return;
        void completeItem(itemId);
      });
    }
    async function bootstrap() {
      persistApiOrigin(getApiOrigin());
      state.token = getAuthToken();
      bindEvents();
      if (!state.token) {
        setStatus("No active Directus session found. Log in again to open Handover.", "err");
        return;
      }
      try {
        await refreshData();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Failed to initialise the handover page.", "err");
      }
    }
    bootstrap();
  
