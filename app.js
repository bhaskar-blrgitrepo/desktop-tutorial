"use strict";

const state = { user: null, view: "overview", data: null, importPreview: null };
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));
const roleNames = {
  tenant_admin: "Tenant admin",
  employee: "Employee",
  manager: "Manager",
  department_leader: "Department leader",
  hr_admin: "HR administrator",
  executive: "Executive approver",
  ceo: "CEO / executive approver",
  platform_admin: "Platform administrator"
};
const canManagePeople = () => ["tenant_admin", "hr_admin"].includes(state.user?.role);
const canManageKpis = () => ["tenant_admin", "hr_admin", "department_leader"].includes(state.user?.role);
const formatDate = value => value ? new Date(value).toLocaleDateString() : "—";

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !["/api/login", "/api/register"].includes(path)) showLogin();
    throw new Error(body.error || `Request failed (${response.status}).`);
  }
  return body;
}
const post = (path, value) => api(path, { method: "POST", body: JSON.stringify(value) });
function toast(message, isError = false) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.toggle("error", isError);
  node.classList.add("visible");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove("visible"), 4000);
}
function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.oldLabel = button.textContent;
    button.textContent = label || "Please wait...";
    button.disabled = true;
  } else {
    button.textContent = button.dataset.oldLabel || button.textContent;
    button.disabled = false;
    delete button.dataset.oldLabel;
  }
}
function showLogin() {
  state.user = null;
  state.data = null;
  $("#app-shell").classList.add("hidden");
  $("#auth-screen").classList.remove("hidden");
  $("#auth-error").textContent = "";
}
function showApp() {
  $("#auth-screen").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
  $("#user-name").textContent = state.user.display_name;
  $("#user-role").textContent = roleNames[state.user.role] || state.user.role;
  $("#tenant-name").textContent = "Impact360";
  renderNavigation();
  loadData();
}
function renderNavigation() {
  const items = [
    ["overview", "▦", "Overview"],
    ["employees", "♙", "Employees"],
    ["performance", "↗", "Performance"],
    ["recognition", "☆", "Recognition"]
  ];
  if (["tenant_admin", "hr_admin"].includes(state.user.role)) items.push(["audit", "◷", "Audit log"]);
  if (["tenant_admin", "hr_admin"].includes(state.user.role)) items.push(["import", "⇧", "Import CSV"]);
  $("#navigation").innerHTML = items.map(([view, icon, label]) =>
    `<button class="nav-button ${state.view === view ? "active" : ""}" data-view="${view}"><span class="nav-icon">${icon}</span>${label}</button>`
  ).join("");
}
function setView(view) {
  state.view = view;
  document.querySelectorAll(".view").forEach(section => section.classList.toggle("active", section.id === `view-${view}`));
  renderNavigation();
  render();
}
async function loadData() {
  try {
    const [departments, employees, kpis, submissions, nominations] = await Promise.all([
      api("/api/departments"), api("/api/employees"), api("/api/kpis"),
      api("/api/submissions"), api("/api/nominations")
    ]);
    state.data = { departments: departments.departments, employees: employees.employees, kpis: kpis.kpis, submissions: submissions.submissions, nominations: nominations.nominations };
    render();
  } catch (error) {
    if (state.user) toast(error.message, true);
  }
}
function badge(status) {
  const normalized = String(status).toLowerCase();
  const style = normalized.includes("approv") ? "approved"
    : normalized.includes("declin") ? "declined"
    : normalized.includes("change") || normalized.includes("information") ? "info"
    : "pending";
  return `<span class="badge ${style}">${escapeHtml(String(status).replaceAll("_", " "))}</span>`;
}
function departmentOptions(selected = "") {
  return (state.data?.departments || []).map(item =>
    `<option value="${escapeHtml(item.id)}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.name)}</option>`
  ).join("");
}
function employeeOptions(selected = "") {
  return (state.data?.employees || []).map(item =>
    `<option value="${escapeHtml(item.id)}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.name)} · ${escapeHtml(item.department_name)}</option>`
  ).join("");
}
function setOptions(selector, options, selectedValue) {
  const select = $(selector);
  const previous = selectedValue ?? select.value;
  select.innerHTML = options;
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}
function kpiOptions(departmentId = "") {
  return (state.data?.kpis || []).filter(item => !departmentId || item.department_id === departmentId)
    .map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(item.department_name)}</option>`).join("");
}
function progressFor(kpi) {
  if (kpi.actual === null || kpi.actual === undefined || !Number(kpi.actual)) return 0;
  return Math.max(0, Math.min(100, Math.round((kpi.direction === "lower" ? Number(kpi.target) / Number(kpi.actual) : Number(kpi.actual) / Number(kpi.target)) * 100)));
}
function renderStats() {
  const { employees, kpis, submissions, nominations } = state.data;
  const pending = nominations.filter(item => item.status === "pending").length;
  const reviewed = submissions.filter(item => item.status !== "submitted").length;
  const average = kpis.length ? Math.round(kpis.reduce((total, item) => total + progressFor(item), 0) / kpis.length) : 0;
  const cards = [
    ["Employees", employees.length, "Company directory", "♙", "var(--blue)"],
    ["Department KPIs", kpis.length, `${state.data.departments.length} departments`, "▦", "var(--purple)"],
    ["KPI progress", `${average}%`, `${reviewed} results reviewed`, "↗", "var(--green)"],
    ["Pending nominations", pending, "Awaiting next review", "☆", "var(--amber)"]
  ];
  $("#stats").innerHTML = cards.map(([label, value, note, icon, color]) =>
    `<article class="stat"><div class="stat-top"><span>${label}</span><span class="stat-icon" style="color:${color}">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-caption">${note}</div></article>`
  ).join("");
}
function renderKpis(target, departmentId = "all") {
  const items = state.data.kpis.filter(item => departmentId === "all" || item.department_id === departmentId);
  $(target).innerHTML = items.length ? items.map(kpi => {
    const progress = progressFor(kpi);
    const actual = kpi.actual === null || kpi.actual === undefined ? "No results" : `${Number(kpi.actual).toFixed(1)} / ${Number(kpi.target)} ${escapeHtml(kpi.unit)}`;
    return `<div class="kpi-row"><div class="kpi-name">${escapeHtml(kpi.name)}<span class="kpi-dept">${escapeHtml(kpi.department_name)} · target ${Number(kpi.target)} ${escapeHtml(kpi.unit)}</span></div><div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div><div class="kpi-number">${actual}</div></div>`;
  }).join("") : `<div class="empty">No KPIs have been created yet.</div>`;
}
function filteredEmployees(search, department) {
  const query = $(search).value.trim().toLowerCase();
  const departmentId = $(department).value;
  return state.data.employees.filter(item =>
    (departmentId === "all" || item.department_id === departmentId) &&
    `${item.name} ${item.job_title} ${item.department_name}`.toLowerCase().includes(query)
  );
}
function employeeRows(items, includeManager = false) {
  if (!items.length) return `<tr><td colspan="${includeManager ? 6 : 5}" class="empty">No employees match this filter.</td></tr>`;
  return items.map(item => {
    const kpi = state.data.kpis.find(record => record.department_id === item.department_id);
    const progress = kpi ? progressFor(kpi) : 0;
    const status = progress >= 100 ? "On track" : progress >= 85 ? "In progress" : "Needs review";
    return `<tr>
      <td><div class="person-cell"><span class="avatar">${escapeHtml(item.name.split(/\s+/).map(part => part[0]).slice(0,2).join(""))}</span><span><span class="person-name">${escapeHtml(item.name)}</span><span class="person-title">${escapeHtml(item.job_title)} · ${escapeHtml(roleNames[item.role] || item.role)}</span></span></div></td>
      <td>${escapeHtml(item.department_name)}</td>${includeManager ? `<td>${escapeHtml(item.manager_name || "—")}</td>` : ""}
      <td>${escapeHtml(kpi?.name || "No KPI")}</td><td>${badge(`${progress}%`)}</td><td>${badge(status)}</td>
    </tr>`;
  }).join("");
}
function renderEmployeeTable(search, department, rows, count, includeManager = false) {
  const items = filteredEmployees(search, department);
  $(rows).innerHTML = employeeRows(items, includeManager);
  $(count).textContent = `Showing ${items.length} of ${state.data.employees.length} employees`;
}
function renderOverview() {
  renderStats();
  renderKpis("#overview-kpis", $("#overview-department").value || "all");
  const queue = state.data.nominations.filter(item => item.status === "pending").slice(0, 4);
  $("#overview-queue").innerHTML = queue.length ? queue.map(item =>
    `<div class="queue-item"><div><div class="queue-name">${escapeHtml(item.nominee_name)} · ${escapeHtml(item.type.replaceAll("_", " "))}</div><div class="queue-detail">${escapeHtml(item.department_name)} · ${escapeHtml(item.stage.replaceAll("_", " "))}</div></div>${badge(item.status)}</div>`
  ).join("") : `<div class="empty">No pending nominations.</div>`;
  renderEmployeeTable("#overview-search", "#overview-table-department", "#overview-employee-rows", "#overview-table-count");
}
function renderEmployees() {
  renderEmployeeTable("#employees-search", "#employees-department", "#employee-rows", "#employees-count", true);
  $("#employee-create-panel").classList.toggle("hidden", !canManagePeople());
  $("#kpi-create-panel").classList.toggle("hidden", !canManageKpis());
  const choices = `<option value="all">All departments</option>${state.data.departments.map(item =>
    `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}`;
  for (const selector of ["#overview-department", "#overview-table-department", "#employees-department"]) {
    setOptions(selector, choices);
  }
  const departments = departmentOptions();
  setOptions("#new-department", departments);
  setOptions("#new-kpi-department", departments);
  const managers = state.data.employees.filter(person => ["manager", "department_leader"].includes(person.role));
  setOptions("#new-manager", `<option value="">No manager assigned</option>${managers.map(person => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`).join("")}`);
}
function renderPerformance() {
  renderKpis("#performance-kpis");
  $("#submission-employee-field").classList.toggle("hidden", state.user.role === "employee");
  const employees = state.data.employees;
  $("#submission-employee").innerHTML = employeeOptions(state.user.employee_id || employees[0]?.id || "");
  const chosen = $("#submission-employee").value;
  const person = employees.find(item => item.id === chosen);
  $("#submission-kpi").innerHTML = kpiOptions(person?.department_id || "");
  const reviewAllowed = ["tenant_admin", "hr_admin", "manager", "department_leader"].includes(state.user.role);
  const rows = state.data.submissions;
  $("#performance-rows").innerHTML = rows.length ? rows.map(item => {
    const canReviewThis = ["tenant_admin", "hr_admin"].includes(state.user.role) ||
      item.employee_id !== state.user.employee_id;
    const controls = reviewAllowed && canReviewThis && item.status === "submitted"
      ? `<div class="row-actions"><button class="btn small primary" data-review="${escapeHtml(item.id)}" data-decision="approved">Approve</button><button class="btn small" data-review="${escapeHtml(item.id)}" data-decision="needs_changes">Request changes</button></div>`
      : `<span class="muted">${escapeHtml(item.reviewer_name ? `Reviewed by ${item.reviewer_name}` : "Awaiting review")}</span>`;
    return `<tr><td>${escapeHtml(item.employee_name)}</td><td>${escapeHtml(item.department_name)}</td><td>${escapeHtml(item.kpi_name)}</td><td>${Number(item.actual)} ${escapeHtml(item.unit)}</td><td>${escapeHtml(item.period)}</td><td>${badge(item.status)}</td><td>${controls}${item.review_note ? `<div class="review-note">${escapeHtml(item.review_note)}</div>` : ""}</td></tr>`;
  }).join("") : `<tr><td colspan="7" class="empty">No performance results yet. Add the first submission above.</td></tr>`;
  $("#performance-count").textContent = `${rows.length} performance submissions`;
}
function nominationActions(item) {
  if (item.status === "needs_information" &&
      (item.nominator_user_id === state.user.id || ["tenant_admin", "hr_admin"].includes(state.user.role))) {
    return `<div class="row-actions"><button class="btn small primary" data-nomination="${escapeHtml(item.id)}" data-decision="resubmit">Update and resubmit</button></div>`;
  }
  if (item.status !== "pending") return "";
  const role = state.user.role;
  const canAct = role === "tenant_admin" ||
    (item.stage === "manager_review" && role === "manager") ||
    (item.stage === "department_review" && role === "department_leader") ||
    (item.stage === "hr_governance" && role === "hr_admin") ||
    (item.stage === "executive_shortlist" && role === "executive") ||
    (item.stage === "ceo_decision" && role === "ceo");
  if (!canAct) return `<span class="muted">Waiting for ${escapeHtml(item.stage.replaceAll("_", " "))}</span>`;
  return `<div class="row-actions"><button class="btn small primary" data-nomination="${escapeHtml(item.id)}" data-decision="approve">Approve / advance</button><button class="btn small" data-nomination="${escapeHtml(item.id)}" data-decision="request_info">Request info</button><button class="btn small danger" data-nomination="${escapeHtml(item.id)}" data-decision="decline">Decline</button></div>`;
}
function renderRecognition() {
  $("#nomination-employee").innerHTML = employeeOptions(state.user.employee_id || "");
  const items = state.data.nominations;
  $("#nomination-grid").innerHTML = items.length ? items.map(item =>
    `<article class="nomination-card"><div class="nomination-head"><div><h3>${escapeHtml(item.nominee_name)} · ${escapeHtml(item.type.replaceAll("_", " "))}</h3><div class="queue-detail">${escapeHtml(item.department_name)} · submitted by ${escapeHtml(item.nominator_name)}</div></div>${badge(item.status)}</div>
      <p><strong>Stage:</strong> ${escapeHtml(item.stage.replaceAll("_", " "))}<br>${escapeHtml(item.reason)}</p><div class="nomination-actions">${nominationActions(item)}</div></article>`
  ).join("") : `<div class="empty">No nominations yet.</div>`;
}
async function renderAudit() {
  if (!["tenant_admin", "hr_admin"].includes(state.user.role)) return;
  const result = await api("/api/audit");
  $("#audit-rows").innerHTML = result.events.length ? result.events.map(event =>
    `<tr><td>${formatDate(event.created_at)}</td><td>${escapeHtml(event.actor_name)}</td><td>${escapeHtml(event.action.replaceAll("_", " "))}</td><td>${escapeHtml(event.entity_type)}</td><td>${escapeHtml(event.details)}</td></tr>`
  ).join("") : `<tr><td colspan="5" class="empty">No audit events yet.</td></tr>`;
}
function renderImportPreview(result) {
  state.importPreview = result.valid ? result : null;
  const output = $("#import-preview");
  const errors = $("#import-errors");
  const commitButton = $("#import-commit");
  if (!result.valid) {
    output.classList.add("hidden");
    errors.classList.remove("hidden");
    errors.innerHTML = `<strong>Fix these rows before importing:</strong><ul>${result.errors.map(item =>
      `<li>Row ${Number(item.row)} · ${escapeHtml(item.field)}: ${escapeHtml(item.message)}</li>`
    ).join("")}</ul>`;
    commitButton.disabled = true;
    return;
  }
  errors.classList.add("hidden");
  errors.textContent = "";
  output.classList.remove("hidden");
  $("#import-preview-summary").textContent = `${result.row_count} ${result.type} row(s) passed validation. Preview sample:`;
  $("#import-preview-table").innerHTML = `<thead><tr>${result.columns.map(column => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${result.sample_rows.map(row =>
    `<tr>${result.columns.map(column => `<td>${escapeHtml(row[column] || "—")}</td>`).join("")}</tr>`
  ).join("")}</tbody>`;
  $("#import-preview-note").textContent = result.message;
  commitButton.disabled = false;
}
function render() {
  if (!state.data || !state.user) return;
  renderOverview();
  renderEmployees();
  renderPerformance();
  renderRecognition();
  if (state.view === "audit") renderAudit().catch(error => toast(error.message, true));
  if (!["tenant_admin", "hr_admin"].includes(state.user.role) && state.view === "import") setView("overview");
}

document.addEventListener("click", async event => {
  const navigation = event.target.closest("[data-view]");
  if (navigation) return setView(navigation.dataset.view);
  const review = event.target.closest("[data-review]");
  if (review) {
    try {
      const note = window.prompt(review.dataset.decision === "approved" ? "Add a short approval note:" : "Explain what should change:");
      if (note === null) return;
      await post(`/api/submissions/${encodeURIComponent(review.dataset.review)}/review`, { decision: review.dataset.decision, note });
      toast("Review saved.");
      await loadData();
    } catch (error) { toast(error.message, true); }
  }
  const nomination = event.target.closest("[data-nomination]");
  if (nomination) {
    try {
      const isResubmit = nomination.dataset.decision === "resubmit";
      const note = window.prompt(isResubmit ? "Update the nomination reason (at least 10 characters):" : "Add a short review note:");
      if (note === null) return;
      if (isResubmit) {
        await post(`/api/nominations/${encodeURIComponent(nomination.dataset.nomination)}/resubmit`, { reason: note });
      } else {
        await post(`/api/nominations/${encodeURIComponent(nomination.dataset.nomination)}/review`, { decision: nomination.dataset.decision, note });
      }
      toast("Nomination review saved.");
      await loadData();
    } catch (error) { toast(error.message, true); }
  }
});
for (const [input, department] of [
  ["#overview-search", "#overview-table-department"],
  ["#overview-table-department", "#overview-search"],
  ["#employees-search", "#employees-department"],
  ["#employees-department", "#employees-search"]
]) {
  $(input).addEventListener(input.includes("search") ? "input" : "change", () => {
    if (input.startsWith("#overview")) renderEmployeeTable("#overview-search", "#overview-table-department", "#overview-employee-rows", "#overview-table-count");
    else renderEmployeeTable("#employees-search", "#employees-department", "#employee-rows", "#employees-count", true);
  });
}
$("#overview-department").addEventListener("change", event => renderKpis("#overview-kpis", event.target.value));
$("#submission-employee").addEventListener("change", event => {
  const person = state.data.employees.find(item => item.id === event.target.value);
  $("#submission-kpi").innerHTML = kpiOptions(person?.department_id || "");
});
$("#submission-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, "Submitting...");
  try {
    await post("/api/submissions", {
      employee_id: $("#submission-employee").value,
      kpi_id: $("#submission-kpi").value,
      actual: Number($("#submission-actual").value),
      period: $("#submission-period").value.trim(),
      evidence_note: $("#submission-evidence").value.trim()
    });
    event.target.reset();
    toast("Performance submission saved.");
    await loadData();
  } catch (error) { toast(error.message, true); }
  finally { setBusy(button, false); }
});
$("#nomination-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, "Submitting...");
  try {
    await post("/api/nominations", {
      nominee_employee_id: $("#nomination-employee").value,
      type: $("#nomination-type").value,
      reason: $("#nomination-reason").value.trim()
    });
    event.target.reset();
    toast("Nomination submitted for manager review.");
    await loadData();
  } catch (error) { toast(error.message, true); }
  finally { setBusy(button, false); }
});
$("#employee-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, "Creating...");
  try {
    await post("/api/employees", {
      name: $("#new-name").value.trim(),
      email: $("#new-email").value.trim(),
      password: $("#new-password").value,
      job_title: $("#new-title").value.trim(),
      role: $("#new-role").value,
      department_id: $("#new-department").value,
      manager_employee_id: $("#new-manager").value || null
    });
    event.target.reset();
    toast("Employee account created. Share the sign-in email and temporary password securely.");
    await loadData();
  } catch (error) { toast(error.message, true); }
  finally { setBusy(button, false); }
});
$("#kpi-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, "Creating...");
  try {
    await post("/api/kpis", {
      name: $("#new-kpi-name").value.trim(),
      department_id: $("#new-kpi-department").value,
      target: Number($("#new-kpi-target").value),
      unit: $("#new-kpi-unit").value.trim(),
      direction: $("#new-kpi-direction").value
    });
    event.target.reset();
    toast("KPI created.");
    await loadData();
  } catch (error) { toast(error.message, true); }
  finally { setBusy(button, false); }
});
$("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, "Signing in...");
  $("#auth-error").textContent = "";
  try {
    const result = await post("/api/login", { email: $("#login-email").value.trim(), password: $("#login-password").value });
    state.user = result.user;
    showApp();
  } catch (error) { $("#auth-error").textContent = error.message; }
  finally { setBusy(button, false); }
});
$("#csv-file").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  state.importPreview = null;
  $("#import-preview").classList.add("hidden");
  $("#import-errors").classList.add("hidden");
  $("#import-commit").disabled = true;
  if (!file) return;
  if (file.size > 1024 * 1024) {
    toast("CSV file must be 1 MB or smaller.", true);
    event.target.value = "";
    return;
  }
  try {
    const csv = await file.text();
    const result = await post("/api/import/preview", { type: $("#import-type").value, csv });
    renderImportPreview(result);
  } catch (error) { toast(error.message, true); }
});
$("#import-type").addEventListener("change", () => {
  state.importPreview = null;
  $("#import-preview").classList.add("hidden");
  $("#import-errors").classList.add("hidden");
  $("#import-commit").disabled = true;
  $("#csv-file").value = "";
});
$("#import-commit").addEventListener("click", async event => {
  if (!state.importPreview?.preview_id) return;
  const button = event.currentTarget;
  setBusy(button, true, "Importing...");
  try {
    const result = await post("/api/import/commit", { preview_id: state.importPreview.preview_id });
    state.importPreview = null;
    $("#import-preview").classList.add("hidden");
    $("#csv-file").value = "";
    $("#import-result").classList.remove("hidden");
    $("#import-result").innerHTML = `<strong>Imported ${Number(result.imported)} ${escapeHtml(result.type)} row(s).</strong>${
      result.credentials?.length
        ? `<p>Save these one-time temporary credentials securely and share them with the new users. They will not be shown again.</p><div class="table-scroll"><table><thead><tr><th>EMAIL</th><th>TEMPORARY PASSWORD</th></tr></thead><tbody>${result.credentials.map(item => `<tr><td>${escapeHtml(item.email)}</td><td><code>${escapeHtml(item.temporary_password)}</code></td></tr>`).join("")}</tbody></table></div>`
        : ""
    }`;
    toast("CSV import completed.");
    await loadData();
  } catch (error) { toast(error.message, true); }
  finally { setBusy(button, false); }
});
$("#download-template").addEventListener("click", () => {
  const type = $("#import-type").value;
  const link = document.createElement("a");
  link.href = `/api/import/template?type=${encodeURIComponent(type)}`;
  link.click();
});
$("#change-password-button").addEventListener("click", () => $("#password-dialog").showModal());
$("#cancel-password-button").addEventListener("click", () => $("#password-dialog").close());
$("#password-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, "Saving...");
  try {
    await post("/api/change-password", {
      current_password: $("#current-password").value,
      new_password: $("#new-password-change").value
    });
    event.target.reset();
    $("#password-dialog").close();
    toast("Password changed. Other sign-in sessions were signed out.");
  } catch (error) { toast(error.message, true); }
  finally { setBusy(button, false); }
});
$("#register-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, "Creating company...");
  $("#auth-error").textContent = "";
  try {
    const result = await post("/api/register", {
      company_name: $("#register-company").value.trim(),
      name: $("#register-name").value.trim(),
      email: $("#register-email").value.trim(),
      password: $("#register-password").value
    });
    state.user = result.user;
    showApp();
  } catch (error) { $("#auth-error").textContent = error.message; }
  finally { setBusy(button, false); }
});
$("#auth-tabs").addEventListener("click", event => {
  const tab = event.target.closest("[data-auth]");
  if (!tab) return;
  const register = tab.dataset.auth === "register";
  $("#login-panel").classList.toggle("hidden", register);
  $("#register-panel").classList.toggle("hidden", !register);
  $("#auth-error").textContent = "";
  document.querySelectorAll("[data-auth]").forEach(button => button.classList.toggle("active", button === tab));
});
$("#logout-button").addEventListener("click", async () => {
  try { await post("/api/logout", {}); } finally { showLogin(); }
});
api("/api/health").then(result => {
  if (!result.demo_login_available) return;
  $("#demo-login").textContent = "Training workspace login — administrator: admin@northstar.example.invalid; manager: user001@northstar.example.invalid; password: DemoPass123!";
  $("#demo-login").classList.remove("hidden");
}).catch(error => console.error("Could not load app configuration:", error));
api("/api/me").then(result => {
  if (!result.user) return showLogin();
  state.user = result.user;
  showApp();
}).catch(() => showLogin());
