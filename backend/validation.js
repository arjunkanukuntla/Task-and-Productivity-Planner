const priorities = new Set(["High", "Medium", "Low"]);
const isoDeadlinePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateCredentials(body, needsUsername) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Enter your account details.";
  }

  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) return "Enter a valid email address.";

  if (needsUsername) {
    const username = typeof body.username === "string" ? body.username.trim() : "";
    if (username.length < 2 || username.length > 40) {
      return "Name must be between 2 and 40 characters.";
    }
  }

  if (typeof body.password !== "string" || body.password.length < 8) {
    return "Password must be at least 8 characters.";
  }
  if (Buffer.byteLength(body.password, "utf8") > 72) {
    return "Password must be no more than 72 bytes.";
  }

  return "";
}

function validateTask(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Enter the task details.";
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 100) {
    return "Title must be between 1 and 100 characters.";
  }
  if (
    typeof body.deadline !== "string" ||
    !isoDeadlinePattern.test(body.deadline) ||
    !Number.isFinite(Date.parse(body.deadline))
  ) {
    return "Choose a valid deadline.";
  }
  if (!priorities.has(body.priority)) return "Choose a valid priority.";
  if (typeof body.completed !== "boolean") {
    return "Choose the task completion status.";
  }

  const checklist = body.checklist === undefined ? [] : body.checklist;
  if (!Array.isArray(checklist) || checklist.length > 50) {
    return "A task can have up to 50 checklist steps.";
  }

  for (const step of checklist) {
    if (
      !step ||
      typeof step.id !== "string" ||
      !step.id ||
      step.id.length > 80 ||
      typeof step.text !== "string" ||
      !step.text.trim() ||
      step.text.trim().length > 100 ||
      typeof step.completed !== "boolean"
    ) {
      return "Each checklist step needs a title of 1 to 100 characters.";
    }
  }

  return "";
}

module.exports = { normalizeEmail, validateCredentials, validateTask };
