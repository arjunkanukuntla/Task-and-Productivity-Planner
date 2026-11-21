// Task state and page elements
const PRIORITIES = ["High", "Medium", "Low"];
let tasks = [];
let editingTaskId = null;
let activeFocusSession = null;
let focusTimerInterval = null;
let completingFocusSession = false;
let focusCompletionNeedsRetry = false;
let editingChecklistText = "";
const openChecklistTaskIds = new Set();

const planner = document.querySelector("#planner-app");
const taskForm = document.querySelector("#task-form");
const titleInput = document.querySelector("#task-title");
const deadlineInput = document.querySelector("#task-deadline");
const priorityInput = document.querySelector("#task-priority");
const checklistInput = document.querySelector("#task-checklist");
const submitButton = document.querySelector("#submit-task");
const cancelButton = document.querySelector("#cancel-edit");
const titleError = document.querySelector("#title-error");
const deadlineError = document.querySelector("#deadline-error");
const taskList = document.querySelector("#task-list");
const emptyState = document.querySelector("#empty-state");
const appNotice = document.querySelector("#app-notice");
const taskSortInput = document.querySelector("#task-sort");

async function apiRequest(url, options = {}) {
  const headers = { Accept: "application/json", ...options.headers };
  if (options.body) headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "same-origin",
  });

  if (response.status === 204) return null;

  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || "The request could not be completed.");
    error.status = response.status;
    throw error;
  }
  return result;
}

function showNotice(message) {
  appNotice.textContent = message;
  appNotice.hidden = false;
}

function clearNotice() {
  appNotice.textContent = "";
  appNotice.hidden = true;
}

function isValidTaskList(value) {
  return (
    Array.isArray(value) &&
    value.every(
      (task) =>
        task &&
        typeof task.id === "string" &&
        typeof task.title === "string" &&
        task.title.length > 0 &&
        typeof task.deadline === "string" &&
        Number.isFinite(Date.parse(task.deadline)) &&
        PRIORITIES.includes(task.priority) &&
        typeof task.completed === "boolean" &&
        Array.isArray(task.checklist) &&
        Number.isInteger(task.focusSessionsCompleted) &&
        task.focusSessionsCompleted >= 0,
    )
  );
}

// Task manager (add/edit/delete/toggle)
function resetForm() {
  taskForm.reset();
  priorityInput.value = "Medium";
  checklistInput.value = "";
  editingChecklistText = "";
  editingTaskId = null;
  submitButton.textContent = "Add task";
  cancelButton.hidden = true;
  clearErrors();
}

function clearErrors() {
  titleError.textContent = "";
  deadlineError.textContent = "";
  titleInput.removeAttribute("aria-invalid");
  deadlineInput.removeAttribute("aria-invalid");
}

function validateForm() {
  clearErrors();
  let isValid = true;

  if (!titleInput.value.trim()) {
    titleError.textContent = "Enter a task title.";
    titleInput.setAttribute("aria-invalid", "true");
    isValid = false;
  }

  if (
    !deadlineInput.value ||
    !Number.isFinite(new Date(deadlineInput.value).getTime())
  ) {
    deadlineError.textContent = "Choose a deadline.";
    deadlineInput.setAttribute("aria-invalid", "true");
    isValid = false;
  }

  return isValid;
}

function parseChecklistInput() {
  return checklistInput.value
    .split(/\r?\n/)
    .map((text) => text.trim())
    .filter(Boolean)
    .slice(0, 50)
    .map((text) => ({
      id: crypto.randomUUID(),
      text: text.slice(0, 100),
      completed: false,
    }));
}

function createTask(title, deadline, priority) {
  return {
    title,
    deadline,
    priority,
    completed: false,
    checklist: parseChecklistInput(),
  };
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!validateForm()) return;

  const taskValues = {
    title: titleInput.value.trim(),
    deadline: new Date(deadlineInput.value).toISOString(),
    priority: priorityInput.value,
  };
  submitButton.disabled = true;
  clearNotice();

  try {
    if (editingTaskId) {
      const currentTask = tasks.find((task) => task.id === editingTaskId);
      if (!currentTask) throw new Error("This task is no longer available.");
      let checklist = currentTask.checklist;
      if (checklistInput.value !== editingChecklistText) {
        const existingSteps = new Map(
          currentTask.checklist.map((step) => [step.text, step]),
        );
        checklist = checklistInput.value
          .split(/\r?\n/)
          .map((text) => text.trim())
          .filter(Boolean)
          .slice(0, 50)
          .map((text) =>
            existingSteps.get(text) || {
              id: crypto.randomUUID(),
              text: text.slice(0, 100),
              completed: false,
            },
          );
      }
      const updatedTask = await saveTask({
        ...currentTask,
        ...taskValues,
        checklist,
      });
      tasks = tasks.map((task) =>
        task.id === updatedTask.id ? updatedTask : task,
      );
    } else {
      const result = await apiRequest("/api/tasks", {
        method: "POST",
        body: JSON.stringify(
          createTask(taskValues.title, taskValues.deadline, taskValues.priority),
        ),
      });
      tasks.push(result.task);
    }

    resetForm();
    refreshView();
  } catch (error) {
    showNotice(error.message);
  } finally {
    submitButton.disabled = false;
  }
}

function startEditing(task) {
  editingTaskId = task.id;
  titleInput.value = task.title;
  deadlineInput.value = toLocalInputValue(task.deadline);
  priorityInput.value = task.priority;
  editingChecklistText = task.checklist.map((step) => step.text).join("\n");
  checklistInput.value = editingChecklistText;
  submitButton.textContent = "Save changes";
  cancelButton.hidden = false;
  clearErrors();
  clearNotice();
  titleInput.focus();
}

async function saveTask(task) {
  const result = await apiRequest(
    `/api/tasks/${encodeURIComponent(task.id)}`,
    {
      method: "PUT",
      body: JSON.stringify(task),
    },
  );
  return result.task;
}

async function deleteTask(taskId) {
  try {
    await apiRequest(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: "DELETE",
    });
    tasks = tasks.filter((task) => task.id !== taskId);
    openChecklistTaskIds.delete(taskId);
    if (activeFocusSession && activeFocusSession.taskId === taskId) {
      activeFocusSession = null;
      focusCompletionNeedsRetry = false;
      window.clearInterval(focusTimerInterval);
      focusTimerInterval = null;
    }
    if (editingTaskId === taskId) resetForm();
    clearNotice();
    refreshView();
  } catch (error) {
    showNotice(error.message);
  }
}

async function updateTask(taskId, changes) {
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return;

  try {
    const updatedTask = await saveTask({ ...task, ...changes });
    tasks = tasks.map((item) =>
      item.id === taskId ? updatedTask : item,
    );
    clearNotice();
    refreshView();
  } catch (error) {
    showNotice(error.message);
    renderTasks();
  }
}

function toggleTask(taskId, isComplete) {
  return updateTask(taskId, { completed: isComplete });
}

function toggleChecklistStep(task, stepId, isComplete) {
  const checklist = task.checklist.map((step) =>
    step.id === stepId ? { ...step, completed: isComplete } : step,
  );
  return updateTask(task.id, { checklist });
}

function addChecklistStep(task, text) {
  const trimmedText = text.trim();
  if (!trimmedText || task.checklist.length >= 50) return;
  const checklist = [
    ...task.checklist,
    {
      id: crypto.randomUUID(),
      text: trimmedText,
      completed: false,
    },
  ];
  return updateTask(task.id, { checklist });
}

function removeChecklistStep(task, stepId) {
  const checklist = task.checklist.filter((step) => step.id !== stepId);
  return updateTask(task.id, { checklist });
}

async function startFocusSession(taskId) {
  try {
    const result = await apiRequest(
      `/api/tasks/${encodeURIComponent(taskId)}/focus`,
      { method: "POST" },
    );
    activeFocusSession = result.session;
    focusCompletionNeedsRetry = false;
    clearNotice();
    renderTasks();
    startFocusTimer();
  } catch (error) {
    showNotice(error.message);
  }
}

async function cancelFocusSession() {
  if (!activeFocusSession) return;

  try {
    await apiRequest(
      `/api/focus/${encodeURIComponent(activeFocusSession.id)}`,
      { method: "DELETE" },
    );
    activeFocusSession = null;
    focusCompletionNeedsRetry = false;
    window.clearInterval(focusTimerInterval);
    focusTimerInterval = null;
    clearNotice();
    renderTasks();
  } catch (error) {
    showNotice(error.message);
  }
}

function formatTimeRemaining(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function updateFocusTimer() {
  if (!activeFocusSession) return;

  const endTime =
    Date.parse(activeFocusSession.startedAt) +
    activeFocusSession.durationSeconds * 1000;
  const secondsRemaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
  const countdown = document.querySelector("[data-focus-countdown]");
  if (countdown) countdown.textContent = formatTimeRemaining(secondsRemaining);

  if (secondsRemaining === 0 && !completingFocusSession) {
    completeFocusSession();
  }
}

function startFocusTimer() {
  window.clearInterval(focusTimerInterval);
  updateFocusTimer();
  focusTimerInterval = window.setInterval(updateFocusTimer, 1000);
}

async function completeFocusSession() {
  if (!activeFocusSession || completingFocusSession) return;
  completingFocusSession = true;
  focusCompletionNeedsRetry = false;
  const session = activeFocusSession;

  try {
    await apiRequest(
      `/api/focus/${encodeURIComponent(session.id)}/complete`,
      { method: "POST" },
    );
    if (!activeFocusSession || activeFocusSession.id !== session.id) return;
    const task = tasks.find((item) => item.id === session.taskId);
    if (task) task.focusSessionsCompleted += 1;
    activeFocusSession = null;
    focusCompletionNeedsRetry = false;
    window.clearInterval(focusTimerInterval);
    focusTimerInterval = null;
    showNotice("Focus block complete. Your study session has been recorded.");
    refreshView();
  } catch (error) {
    if (error.status === 409) {
      startFocusTimer();
    } else {
      showNotice(error.message);
      focusCompletionNeedsRetry = true;
      window.clearInterval(focusTimerInterval);
      focusTimerInterval = null;
      renderTasks();
    }
  } finally {
    completingFocusSession = false;
  }
}

// Priority (filter/sort)
function getVisibleTasks() {
  const selectedPriority = document.querySelector("#priority-filter").value;
  const selectedSort = document.querySelector("#task-sort").value;
  const priorityOrder = { High: 0, Medium: 1, Low: 2 };

  return tasks
    .filter(
      (task) =>
        selectedPriority === "All" || task.priority === selectedPriority,
    )
    .slice()
    .sort((first, second) => {
      if (first.completed !== second.completed)
        return Number(first.completed) - Number(second.completed);

      if (selectedSort === "priority") {
        const priorityDifference =
          priorityOrder[first.priority] - priorityOrder[second.priority];
        if (priorityDifference !== 0) return priorityDifference;
      }

      return Date.parse(first.deadline) - Date.parse(second.deadline);
    });
}

// Deadline checker
function getDeadlineStatus(deadline, now = Date.now()) {
  const timeRemaining = Date.parse(deadline) - now;
  if (timeRemaining < 0) return "Overdue";
  if (timeRemaining <= 24 * 60 * 60 * 1000) return "Due soon";
  return "Upcoming";
}

function formatDeadline(deadline) {
  const date = new Date(deadline);
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value("weekday")} ${value("day")} ${value("month")}, ${value("hour")}:${value("minute")} ${value("dayPeriod")}`;
}

function toLocalInputValue(deadline) {
  const date = new Date(deadline);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

function updateDeadlineAlert() {
  const now = Date.now();
  const openTasks = tasks.filter((task) => !task.completed);
  const overdueCount = openTasks.filter(
    (task) => Date.parse(task.deadline) < now,
  ).length;
  const dueSoonCount = openTasks.filter((task) => {
    const remaining = Date.parse(task.deadline) - now;
    return remaining >= 0 && remaining <= 24 * 60 * 60 * 1000;
  }).length;
  const messages = [];

  if (overdueCount)
    messages.push(
      `${overdueCount} task${overdueCount === 1 ? "" : "s"} overdue`,
    );
  if (dueSoonCount) messages.push(`${dueSoonCount} due within 24 hours`);

  const alert = document.querySelector("#deadline-alert");
  alert.textContent = messages.join(", ");
  alert.hidden = messages.length === 0;
}

// Progress
function updateProgress() {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.completed).length;
  const pending = total - completed;
  const focusSessions = tasks.reduce(
    (count, task) => count + task.focusSessionsCompleted,
    0,
  );
  const overdue = tasks.filter(
    (task) => !task.completed && Date.parse(task.deadline) < Date.now(),
  ).length;
  const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);
  const progressCopy = document.querySelector("#progress-copy");
  const progressBar = document.querySelector(".progress-track");

  progressCopy.replaceChildren();
  const summary = document.createElement("span");
  summary.append(
    document.createTextNode("Total "),
    createStrongText(total),
    document.createTextNode(" · Completed "),
    createStrongText(completed),
    document.createTextNode(" · Pending "),
    createStrongText(pending),
    document.createTextNode(" · Overdue "),
    createStrongText(overdue),
    document.createTextNode(" · Focus blocks "),
    createStrongText(focusSessions),
  );
  const percent = document.createElement("strong");
  percent.textContent = `${percentage}% complete`;
  progressCopy.append(summary, percent);

  document.querySelector("#progress-fill").style.width = `${percentage}%`;
  progressBar.setAttribute("aria-valuenow", String(percentage));
}

function createStrongText(text) {
  const strong = document.createElement("strong");
  strong.textContent = String(text);
  return strong;
}

// Rendering
function createTaskElement(task) {
  const item = document.createElement("li");
  item.className = `task-item${task.completed ? " is-complete" : ""}`;

  const main = document.createElement("div");
  main.className = "task-main";

  const checkLabel = document.createElement("label");
  checkLabel.className = "task-check-label";
  checkLabel.setAttribute(
    "aria-label",
    `${task.completed ? "Mark incomplete" : "Mark complete"}: ${task.title}`,
  );
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "task-check";
  checkbox.checked = task.completed;
  checkbox.addEventListener("change", () =>
    toggleTask(task.id, checkbox.checked),
  );
  checkLabel.append(checkbox);

  const copy = document.createElement("div");
  copy.className = "task-copy";
  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = task.title;
  copy.append(title);

  const meta = document.createElement("div");
  meta.className = "task-meta";
  const tag = document.createElement("span");
  tag.className = `priority-tag priority-${task.priority.toLowerCase()}`;
  tag.textContent = task.priority;
  const date = document.createElement("time");
  date.dateTime = task.deadline;
  date.textContent = formatDeadline(task.deadline);
  meta.append(tag, date);

  if (!task.completed) {
    const status = getDeadlineStatus(task.deadline);
    const statusText = document.createElement("span");
    statusText.className = `deadline-status${status === "Overdue" ? " overdue" : status === "Due soon" ? " due-soon" : ""}`;
    statusText.textContent = status;
    meta.append(statusText);
  }
  copy.append(meta);
  copy.append(createChecklist(task));
  copy.append(createFocusPanel(task));
  main.append(checkLabel, copy);

  const actions = document.createElement("div");
  actions.className = "task-actions";
  const editButton = createActionButton("Edit", () => startEditing(task));
  const deleteButton = createActionButton("Delete", () =>
    showDeleteConfirmation(item, task.id),
  );
  actions.append(editButton, deleteButton);
  item.append(main, actions);
  return item;
}

function createChecklist(task) {
  const details = document.createElement("details");
  details.className = "task-checklist";
  details.open = openChecklistTaskIds.has(task.id);
  details.addEventListener("toggle", () => {
    if (details.open) openChecklistTaskIds.add(task.id);
    else openChecklistTaskIds.delete(task.id);
  });
  const summary = document.createElement("summary");
  const completedSteps = task.checklist.filter((step) => step.completed).length;
  summary.textContent = `Progress steps (${completedSteps}/${task.checklist.length})`;
  details.append(summary);

  const content = document.createElement("div");
  content.className = "checklist-content";
  const list = document.createElement("ul");
  list.className = "checklist-list";

  task.checklist.forEach((step) => {
    const item = document.createElement("li");
    item.className = `checklist-step${step.completed ? " is-complete" : ""}`;
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = step.completed;
    checkbox.setAttribute("aria-label", `Complete step: ${step.text}`);
    checkbox.addEventListener("change", () =>
      toggleChecklistStep(task, step.id, checkbox.checked),
    );
    const text = document.createElement("span");
    text.textContent = step.text;
    label.append(checkbox, text);

    const removeButton = document.createElement("button");
    removeButton.className = "checklist-remove";
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.setAttribute("aria-label", `Remove step: ${step.text}`);
    removeButton.addEventListener("click", () =>
      removeChecklistStep(task, step.id),
    );
    item.append(label, removeButton);
    list.append(item);
  });
  content.append(list);

  if (task.checklist.length < 50) {
    const form = document.createElement("form");
    form.className = "checklist-add";
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 100;
    input.required = true;
    input.placeholder = "Add a progress step";
    input.setAttribute("aria-label", `New progress step for ${task.title}`);
    const addButton = document.createElement("button");
    addButton.type = "submit";
    addButton.textContent = "Add";
    form.append(input, addButton);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      addChecklistStep(task, text);
    });
    content.append(form);
  }

  details.append(content);
  return details;
}

function createFocusPanel(task) {
  const panel = document.createElement("div");
  panel.className = "focus-panel";
  const count = document.createElement("span");
  count.className = "focus-count";
  count.textContent = `Focus blocks: ${task.focusSessionsCompleted}`;
  panel.append(count);

  if (activeFocusSession && activeFocusSession.taskId === task.id) {
    const countdown = document.createElement("span");
    countdown.className = "focus-countdown";
    countdown.setAttribute("data-focus-countdown", "");
    countdown.setAttribute("aria-label", "Time remaining in focus block");
    countdown.textContent = "25:00";
    const actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.className = "focus-button";
    actionButton.textContent = focusCompletionNeedsRetry
      ? "Retry saving focus block"
      : "End focus block";
    actionButton.disabled = completingFocusSession;
    actionButton.addEventListener(
      "click",
      focusCompletionNeedsRetry ? completeFocusSession : cancelFocusSession,
    );
    panel.append(countdown, actionButton);
  } else if (activeFocusSession) {
    const activeMessage = document.createElement("span");
    activeMessage.className = "focus-active-message";
    activeMessage.textContent = "A focus block is active on another task.";
    panel.append(activeMessage);
  } else {
    const startButton = document.createElement("button");
    startButton.type = "button";
    startButton.className = "focus-button";
    startButton.textContent = "Start 25-minute focus";
    startButton.addEventListener("click", () => startFocusSession(task.id));
    panel.append(startButton);
  }

  return panel;
}

function createActionButton(label, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "task-action";
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function showDeleteConfirmation(item, taskId) {
  if (item.querySelector(".delete-confirmation")) return;

  const confirmation = document.createElement("div");
  confirmation.className = "delete-confirmation";
  const prompt = document.createElement("span");
  prompt.textContent = "Delete?";
  const yesButton = createActionButton("Yes", () => deleteTask(taskId));
  const noButton = createActionButton("No", () => confirmation.remove());
  confirmation.append(
    prompt,
    yesButton,
    document.createTextNode("/"),
    noButton,
  );
  item.append(confirmation);
  yesButton.focus();
}

function renderTasks() {
  taskList.replaceChildren();
  const visibleTasks = getVisibleTasks();
  emptyState.textContent =
    tasks.length === 0
      ? "No tasks yet. Add your first task above."
      : "No tasks match this priority.";
  emptyState.hidden = visibleTasks.length > 0;
  taskList.hidden = visibleTasks.length === 0;

  visibleTasks.forEach((task) => taskList.append(createTaskElement(task)));
}

function refreshView() {
  renderTasks();
  updateProgress();
  updateDeadlineAlert();
}

function setTodayDate() {
  document.querySelector("#today-date").textContent = new Intl.DateTimeFormat(
    "en-GB",
    {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    },
  ).format(new Date());
}

async function initializePlanner() {
  setTodayDate();
  const preferences = window.taskPlannerPreferences.read();
  taskSortInput.value = preferences.sort;
  if (preferences.notice) showNotice(preferences.notice);

  try {
    const account = await apiRequest("/api/auth/me");
    document.querySelector("#account-name").textContent =
      account.user.username;
    planner.hidden = false;
    const focusResult = await apiRequest("/api/focus/active");
    activeFocusSession = focusResult.session;
    const result = await apiRequest("/api/tasks");
    if (!isValidTaskList(result.tasks)) {
      throw new Error("The server returned invalid task data.");
    }
    tasks = result.tasks;
    refreshView();
    if (activeFocusSession) startFocusTimer();
  } catch (error) {
    if (error.status === 401) {
      window.location.replace("/signin.html");
      return;
    }
    planner.hidden = false;
    showNotice(
      error instanceof TypeError
        ? "Could not connect to the planner server. Please try again."
        : error.message,
    );
    refreshView();
  }
}

taskForm.addEventListener("submit", handleSubmit);
cancelButton.addEventListener("click", resetForm);
titleInput.addEventListener("input", () => {
  titleError.textContent = "";
  titleInput.removeAttribute("aria-invalid");
});
deadlineInput.addEventListener("input", () => {
  deadlineError.textContent = "";
  deadlineInput.removeAttribute("aria-invalid");
});
document
  .querySelector("#priority-filter")
  .addEventListener("change", renderTasks);
taskSortInput.addEventListener("change", renderTasks);

initializePlanner();
window.setInterval(() => {
  if (!planner.hidden) {
    updateDeadlineAlert();
    updateProgress();
    renderTasks();
  }
}, 60000);
