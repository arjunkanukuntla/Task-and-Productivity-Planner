const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const bcrypt = require("bcrypt");
const mysql = require("mysql2/promise");
const {
  normalizeEmail,
  validateCredentials,
  validateTask,
} = require("./validation");

loadEnvironment(path.resolve(__dirname, "..", ".env"));

const app = express();
const port = Number(process.env.PORT) || 3002;
const sessionCookie = "task_planner_session";
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;
const focusDurationSeconds = 25 * 60;
const authAttemptLimit = 8;
const authAttemptWindowMinutes = 15;
const frontendPath = path.resolve(__dirname, "..", "frontend");
const databaseConfig = getDatabaseConfig();
const pool = mysql.createPool({
  ...databaseConfig,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: "Z",
  dateStrings: true,
  charset: "utf8mb4",
});

app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  );
  if (process.env.NODE_ENV === "production") {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  if (request.path.startsWith("/api/")) {
    response.setHeader("Cache-Control", "no-store");
  }
  next();
});
app.use(express.json({ limit: "32kb" }));
app.use(requireSameOrigin);

function requireSameOrigin(request, response, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    return next();
  }

  const origin = request.get("origin");
  if (!origin) {
    return response.status(403).json({ error: "This request must come from the planner site." });
  }

  try {
    const originUrl = new URL(origin);
    const requestOrigin = `${request.protocol}://${request.get("host")}`;
    if (originUrl.origin !== requestOrigin) {
      return response.status(403).json({ error: "Cross-site requests are not allowed." });
    }
  } catch {
    return response.status(403).json({ error: "Invalid request origin." });
  }

  next();
}

function loadEnvironment(filePath) {
  if (!fs.existsSync(filePath)) return;

  const contents = fs.readFileSync(filePath, "utf8");
  contents.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) return;

    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }

    process.env[match[1]] = value;
  });
}

function getDatabaseConfig() {
  const connectionUrl = process.env.DATABASE_URL || process.env.DB_URL;
  if (connectionUrl) {
    let parsedUrl;
    try {
      parsedUrl = new URL(connectionUrl);
    } catch {
      throw new Error("DATABASE_URL must be a valid MySQL connection URL.");
    }

    if (!["mysql:", "mysql2:"].includes(parsedUrl.protocol)) {
      throw new Error("DATABASE_URL must use the mysql:// scheme.");
    }

    return {
      host: parsedUrl.hostname,
      port: Number(parsedUrl.port) || 3306,
      user: decodeURIComponent(parsedUrl.username),
      password: decodeURIComponent(parsedUrl.password),
      database: decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, "")),
    };
  }

  const { DB_HOST, DB_USER, DB_NAME } = process.env;
  if (!DB_HOST && !DB_USER && !DB_NAME && process.env.db) {
    let legacyConfig;
    try {
      legacyConfig = JSON.parse(process.env.db);
    } catch {
      legacyConfig = null;
    }

    if (
      legacyConfig &&
      typeof legacyConfig === "object" &&
      !Array.isArray(legacyConfig)
    ) {
      const { host, port, user, password, database } = legacyConfig;
      if (!host || !user || !database) {
        throw new Error(
          "The db setting must include host, user, and database fields.",
        );
      }

      return {
        host,
        port: Number(port) || 3306,
        user,
        password: password || "",
        database,
      };
    }

    const values = process.env.db.split(",").map((value) => value.trim());
    if (values.length !== 5) {
      throw new Error(
        "Set the db setting to a JSON object or user,password,host,port,database.",
      );
    }

    const [user, password, host, port, database] = values;
    if (!user || !host || !database) {
      throw new Error("The db setting is missing a required MySQL field.");
    }
    return {
      host,
      port: Number(port) || 3306,
      user,
      password,
      database,
    };
  }

  if (!DB_HOST || !DB_USER || !DB_NAME) {
    throw new Error(
      "MySQL is not configured. Set DB_HOST, DB_USER, DB_PASSWORD, and DB_NAME (or DATABASE_URL) in the project .env file.",
    );
  }

  return {
    host: DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: DB_USER,
    password: process.env.DB_PASSWORD || "",
    database: DB_NAME,
  };
}

function getCookieValue(request, name) {
  const cookieHeader = request.headers.cookie || "";
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  return cookie ? cookie.slice(name.length + 1) : "";
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(response, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${sessionCookie}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionLifetime / 1000}${secure}`,
  );
}

function clearSessionCookie(response) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${sessionCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`,
  );
}

async function requireAuthentication(request, response, next) {
  const token = getCookieValue(request, sessionCookie);
  if (!token) {
    return response.status(401).json({ error: "Please sign in to continue." });
  }

  try {
    const [rows] = await pool.execute(
      "SELECT user_id FROM auth_sessions WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP(3) LIMIT 1",
      [hashToken(token)],
    );
    if (!rows[0]) {
      return response.status(401).json({ error: "Please sign in to continue." });
    }

    request.userId = rows[0].user_id;
    next();
  } catch (error) {
    next(error);
  }
}

function getClientKey(request) {
  return crypto.createHash("sha256").update(request.ip || "unknown").digest("hex");
}

async function isAuthRateLimited(request) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS attempt_count FROM auth_attempts WHERE ip_hash = ? AND created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ${authAttemptWindowMinutes} MINUTE)`,
    [getClientKey(request)],
  );
  return Number(rows[0].attempt_count) >= authAttemptLimit;
}

async function recordAuthAttempt(request) {
  await pool.execute(
    "INSERT INTO auth_attempts (ip_hash, created_at) VALUES (?, UTC_TIMESTAMP(3))",
    [getClientKey(request)],
  );
}

async function clearAuthAttempts(request) {
  await pool.execute("DELETE FROM auth_attempts WHERE ip_hash = ?", [
    getClientKey(request),
  ]);
}

async function createSession(response, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + sessionLifetime)
    .toISOString()
    .replace("T", " ")
    .replace("Z", "");
  await pool.execute(
    "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
    [hashToken(token), userId, expiresAt],
  );
  setSessionCookie(response, token);
}

function serializeUser(user) {
  const serializedUser = {
    id: String(user.id),
    username: user.username,
    email: user.email,
  };
  if (user.member_since) serializedUser.memberSince = user.member_since;
  return serializedUser;
}

function parseChecklist(value) {
  try {
    const checklist = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(checklist)) return [];
    return checklist
      .filter(
        (step) =>
          step &&
          typeof step.id === "string" &&
          typeof step.text === "string" &&
          typeof step.completed === "boolean",
      )
      .map((step) => ({
        id: step.id,
        text: step.text,
        completed: step.completed,
      }));
  } catch {
    return [];
  }
}

function serializeTask(row) {
  const deadline = String(row.deadline).replace(" ", "T");
  return {
    id: String(row.id),
    title: row.title,
    deadline: deadline.endsWith("Z") ? deadline : `${deadline}Z`,
    priority: row.priority,
    completed: Boolean(row.completed),
    checklist: parseChecklist(row.checklist),
    focusSessionsCompleted: Number(row.focus_sessions_completed) || 0,
  };
}

function serializeFocusSession(row) {
  const startedAt = String(row.started_at).replace(" ", "T");
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    startedAt: startedAt.endsWith("Z") ? startedAt : `${startedAt}Z`,
    durationSeconds: Number(row.duration_seconds),
  };
}

function deadlineForDatabase(deadline) {
  return new Date(deadline).toISOString().replace("T", " ").replace("Z", "");
}

app.post("/api/auth/signup", async (request, response, next) => {
  if (await isAuthRateLimited(request)) {
    response.setHeader("Retry-After", String(authAttemptWindowMinutes * 60));
    return response.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
  }
  await recordAuthAttempt(request);
  const validationError = validateCredentials(request.body, true);
  if (validationError) return response.status(400).json({ error: validationError });

  const email = normalizeEmail(request.body.email);
  const username = request.body.username.trim();
  try {
    const passwordHash = await bcrypt.hash(request.body.password, 12);
    const [result] = await pool.execute(
      "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
      [username, email, passwordHash],
    );
    const user = { id: result.insertId, username, email };
    await createSession(response, user.id);
    response.status(201).json({ user: serializeUser(user) });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return response.status(409).json({ error: "An account with that email already exists." });
    }
    next(error);
  }
});

app.post("/api/auth/signin", async (request, response, next) => {
  if (await isAuthRateLimited(request)) {
    response.setHeader("Retry-After", String(authAttemptWindowMinutes * 60));
    return response.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
  }
  await recordAuthAttempt(request);
  const validationError = validateCredentials(request.body, false);
  if (validationError) return response.status(400).json({ error: validationError });

  try {
    const email = normalizeEmail(request.body.email);
    const [rows] = await pool.execute(
      "SELECT id, username, email, password_hash FROM users WHERE email = ? LIMIT 1",
      [email],
    );
    const user = rows[0];
    const passwordMatches = user
      ? await bcrypt.compare(request.body.password, user.password_hash)
      : false;

    if (!passwordMatches) {
      return response.status(401).json({ error: "Email or password is incorrect." });
    }

    await clearAuthAttempts(request);
    await createSession(response, user.id);
    response.json({ user: serializeUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", async (request, response, next) => {
  const token = getCookieValue(request, sessionCookie);
  try {
    if (token) {
      await pool.execute("DELETE FROM auth_sessions WHERE token_hash = ?", [
        hashToken(token),
      ]);
    }
    clearSessionCookie(response);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", requireAuthentication, async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, username, email, DATE_FORMAT(created_at, '%Y-%m-%d') AS member_since FROM users WHERE id = ? LIMIT 1",
      [request.userId],
    );
    if (!rows[0]) {
      return response.status(401).json({ error: "Please sign in to continue." });
    }
    response.json({ user: serializeUser(rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/tasks", requireAuthentication, async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT t.id, t.title, t.deadline, t.priority, t.completed, t.checklist,
        (SELECT COUNT(*) FROM focus_sessions f WHERE f.task_id = t.id AND f.user_id = t.user_id AND f.status = 'completed') AS focus_sessions_completed
      FROM tasks t WHERE t.user_id = ? ORDER BY t.completed ASC, t.deadline ASC`,
      [request.userId],
    );
    response.json({ tasks: rows.map(serializeTask) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks", requireAuthentication, async (request, response, next) => {
  const validationError = validateTask(request.body);
  if (validationError) return response.status(400).json({ error: validationError });

  const taskId = crypto.randomUUID();
  const task = {
    id: taskId,
    title: request.body.title.trim(),
    deadline: request.body.deadline,
    priority: request.body.priority,
    completed: request.body.completed,
    checklist: request.body.checklist || [],
    focusSessionsCompleted: 0,
  };
  try {
    await pool.execute(
      "INSERT INTO tasks (id, user_id, title, deadline, priority, completed, checklist) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        taskId,
        request.userId,
        task.title,
        deadlineForDatabase(task.deadline),
        task.priority,
        task.completed,
        JSON.stringify(task.checklist || []),
      ],
    );
    response.status(201).json({ task });
  } catch (error) {
    next(error);
  }
});

app.put("/api/tasks/:id", requireAuthentication, async (request, response, next) => {
  const validationError = validateTask(request.body);
  if (validationError) return response.status(400).json({ error: validationError });

  const task = {
    id: request.params.id,
    title: request.body.title.trim(),
    deadline: request.body.deadline,
    priority: request.body.priority,
    completed: request.body.completed,
    checklist: request.body.checklist || [],
  };
  try {
    const [result] = await pool.execute(
      "UPDATE tasks SET title = ?, deadline = ?, priority = ?, completed = ?, checklist = ? WHERE id = ? AND user_id = ?",
      [
        task.title,
        deadlineForDatabase(task.deadline),
        task.priority,
        task.completed,
        JSON.stringify(task.checklist || []),
        request.params.id,
        request.userId,
      ],
    );
    if (result.affectedRows === 0) {
      return response.status(404).json({ error: "Task not found." });
    }
    const [sessionCount] = await pool.execute(
      "SELECT COUNT(*) AS focus_sessions_completed FROM focus_sessions WHERE task_id = ? AND user_id = ? AND status = 'completed'",
      [request.params.id, request.userId],
    );
    task.focusSessionsCompleted = Number(sessionCount[0].focus_sessions_completed);
    response.json({ task });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/tasks/:id", requireAuthentication, async (request, response, next) => {
  try {
    const [result] = await pool.execute(
      "DELETE FROM tasks WHERE id = ? AND user_id = ?",
      [request.params.id, request.userId],
    );
    if (result.affectedRows === 0) {
      return response.status(404).json({ error: "Task not found." });
    }
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/focus/active", requireAuthentication, async (request, response, next) => {
  try {
    await pool.execute(
      `UPDATE focus_sessions
       SET status = 'completed',
           completed_at = DATE_ADD(started_at, INTERVAL duration_seconds SECOND)
       WHERE user_id = ? AND status = 'running'
         AND DATE_ADD(started_at, INTERVAL duration_seconds SECOND) <= UTC_TIMESTAMP(3)`,
      [request.userId],
    );
    const [rows] = await pool.execute(
      "SELECT id, task_id, started_at, duration_seconds FROM focus_sessions WHERE user_id = ? AND status = 'running' LIMIT 1",
      [request.userId],
    );
    response.json({ session: rows[0] ? serializeFocusSession(rows[0]) : null });
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks/:id/focus", requireAuthentication, async (request, response, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute(
      "SELECT id FROM users WHERE id = ? FOR UPDATE",
      [request.userId],
    );
    if (!users[0]) {
      await connection.rollback();
      return response.status(401).json({ error: "Please sign in to continue." });
    }

    const [tasksForUser] = await connection.execute(
      "SELECT id FROM tasks WHERE id = ? AND user_id = ? LIMIT 1",
      [request.params.id, request.userId],
    );
    if (!tasksForUser[0]) {
      await connection.rollback();
      return response.status(404).json({ error: "Task not found." });
    }

    await connection.execute(
      `UPDATE focus_sessions
       SET status = 'completed',
           completed_at = DATE_ADD(started_at, INTERVAL duration_seconds SECOND)
       WHERE user_id = ? AND status = 'running'
         AND DATE_ADD(started_at, INTERVAL duration_seconds SECOND) <= UTC_TIMESTAMP(3)`,
      [request.userId],
    );
    const [activeSessions] = await connection.execute(
      "SELECT id FROM focus_sessions WHERE user_id = ? AND status = 'running' LIMIT 1 FOR UPDATE",
      [request.userId],
    );
    if (activeSessions[0]) {
      await connection.rollback();
      return response.status(409).json({ error: "Finish or end your current focus block first." });
    }

    const sessionId = crypto.randomUUID();
    await connection.execute(
      "INSERT INTO focus_sessions (id, user_id, task_id, started_at, duration_seconds, status) VALUES (?, ?, ?, UTC_TIMESTAMP(3), ?, 'running')",
      [sessionId, request.userId, request.params.id, focusDurationSeconds],
    );
    await connection.commit();
    const [rows] = await pool.execute(
      "SELECT id, task_id, started_at, duration_seconds FROM focus_sessions WHERE id = ?",
      [sessionId],
    );
    response.status(201).json({ session: serializeFocusSession(rows[0]) });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.post("/api/focus/:id/complete", requireAuthentication, async (request, response, next) => {
  try {
    const [result] = await pool.execute(
      `UPDATE focus_sessions
       SET status = 'completed', completed_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND user_id = ? AND status = 'running'
         AND started_at <= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL duration_seconds SECOND)`,
      [request.params.id, request.userId],
    );
    const [rows] = await pool.execute(
      "SELECT id, task_id, started_at, duration_seconds, status FROM focus_sessions WHERE id = ? AND user_id = ? LIMIT 1",
      [request.params.id, request.userId],
    );
    if (!rows[0]) return response.status(404).json({ error: "Focus block not found." });
    if (!result.affectedRows && rows[0].status !== "completed") {
      return response.status(409).json({ error: "This focus block is not finished yet." });
    }

    response.json({ session: serializeFocusSession(rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/focus/:id", requireAuthentication, async (request, response, next) => {
  try {
    const [result] = await pool.execute(
      "UPDATE focus_sessions SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'running'",
      [request.params.id, request.userId],
    );
    if (!result.affectedRows) {
      return response.status(404).json({ error: "Active focus block not found." });
    }
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.use(express.static(frontendPath));
app.use((request, response) => {
  response.status(404).json({ error: "Not found." });
});

app.use((error, request, response, next) => {
  console.error("Request failed:", error.message);
  if (response.headersSent) return next(error);
  response.status(500).json({ error: "The request could not be completed." });
});

async function startServer() {
  try {
    if (
      process.env.NODE_ENV === "production" &&
      String(databaseConfig.user).toLowerCase() === "root"
    ) {
      throw new Error("Production requires a dedicated, least-privilege MySQL user.");
    }

    if (process.env.NODE_ENV === "production") {
      await verifyProductionSchema();
    } else {
      await initializeDevelopmentSchema();
    }

    await pool.execute(
      "DELETE FROM auth_sessions WHERE expires_at <= UTC_TIMESTAMP(3)",
    );
    await pool.execute(
      "DELETE FROM auth_attempts WHERE created_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY)",
    );

    app.listen(port, () => {
      console.log(`Task Planner server listening on http://localhost:${port}`);
    });
  } catch (error) {
    console.error("Unable to start the Task Planner server:", error.message);
    process.exitCode = 1;
    await pool.end();
  }
}

async function initializeDevelopmentSchema() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(40) NOT NULL,
      email VARCHAR(254) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS tasks (
      id CHAR(36) NOT NULL PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      title VARCHAR(100) NOT NULL,
      deadline DATETIME(3) NOT NULL,
      priority ENUM('High', 'Medium', 'Low') NOT NULL,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      checklist JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX tasks_user_deadline (user_id, completed, deadline),
      CONSTRAINT tasks_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [checklistColumns] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'checklist'`,
  );
  if (checklistColumns.length === 0) {
    await pool.execute("ALTER TABLE tasks ADD COLUMN checklist JSON NULL");
    await pool.execute("UPDATE tasks SET checklist = JSON_ARRAY()");
    await pool.execute("ALTER TABLE tasks MODIFY checklist JSON NOT NULL");
  }
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash CHAR(64) NOT NULL PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      expires_at DATETIME(3) NOT NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX auth_sessions_user_expiry (user_id, expires_at),
      CONSTRAINT auth_sessions_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS auth_attempts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ip_hash CHAR(64) NOT NULL,
      created_at DATETIME(3) NOT NULL,
      INDEX auth_attempts_ip_time (ip_hash, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS focus_sessions (
      id CHAR(36) NOT NULL PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      task_id CHAR(36) NOT NULL,
      started_at DATETIME(3) NOT NULL,
      duration_seconds SMALLINT UNSIGNED NOT NULL,
      status ENUM('running', 'completed', 'cancelled') NOT NULL,
      completed_at DATETIME(3) NULL,
      INDEX focus_sessions_user_status (user_id, status),
      INDEX focus_sessions_task_status (task_id, status),
      CONSTRAINT focus_sessions_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT focus_sessions_task_fk FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function verifyProductionSchema() {
  const requiredTables = [
    ["users", "id"],
    ["tasks", "id"],
    ["tasks", "checklist"],
    ["auth_sessions", "token_hash"],
    ["auth_attempts", "id"],
    ["focus_sessions", "id"],
  ];

  try {
    for (const [table, column] of requiredTables) {
      await pool.execute(`SELECT ${column} FROM ${table} LIMIT 0`);
    }
  } catch {
    throw new Error(
      "Production tables are missing. Run backend/schema.sql before starting the server.",
    );
  }
}

setInterval(async () => {
  try {
    await pool.execute(
      "DELETE FROM auth_sessions WHERE expires_at <= UTC_TIMESTAMP(3)",
    );
    await pool.execute(
      "DELETE FROM auth_attempts WHERE created_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY)",
    );
  } catch (error) {
    console.error("Could not clean up expired authentication data:", error.message);
  }
}, 6 * 60 * 60 * 1000).unref();

startServer();
