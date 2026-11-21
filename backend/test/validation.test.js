const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeEmail,
  validateCredentials,
  validateTask,
} = require("../validation");

const validTask = {
  title: "Read a chapter",
  deadline: "2026-11-18T12:30:00.000Z",
  priority: "Medium",
  completed: false,
  checklist: [
    { id: "step-1", text: "Read the notes", completed: false },
  ],
};

test("normalizes email addresses before account lookup", () => {
  assert.equal(normalizeEmail("  STUDENT@example.com "), "student@example.com");
});

test("rejects passwords that exceed bcrypt's byte limit", () => {
  const credentials = {
    username: "Student",
    email: "student@example.com",
    password: "é".repeat(37),
  };
  assert.match(validateCredentials(credentials, true), /72 bytes/);
});

test("requires a real ISO UTC deadline and allowed task values", () => {
  assert.equal(validateTask(validTask), "");
  assert.match(
    validateTask({ ...validTask, deadline: "tomorrow" }),
    /valid deadline/,
  );
  assert.match(
    validateTask({ ...validTask, priority: "Urgent" }),
    /valid priority/,
  );
});

test("rejects malformed or oversized checklist steps", () => {
  assert.match(
    validateTask({
      ...validTask,
      checklist: [{ id: "", text: "Read", completed: false }],
    }),
    /checklist step/,
  );
  assert.match(
    validateTask({
      ...validTask,
      checklist: Array.from({ length: 51 }, (_, index) => ({
        id: `step-${index}`,
        text: "Read",
        completed: false,
      })),
    }),
    /up to 50/,
  );
});
