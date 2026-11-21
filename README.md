# Task and Productivity Planner

**Author:** Arjun

## Overview

Task and Productivity Planner is a full-stack coursework planning application. It combines deadline and priority tracking, per-task progress checklists, and task-linked focus sessions in an authenticated workspace.

The project is implemented with a browser-based frontend, a Node.js and Express application server, and a MySQL database.

## Features

- Create, edit, complete, filter, sort, and delete tasks.
- Assign deadlines and High, Medium, or Low priority.
- Add up to 50 progress checklist steps to a task and track each step independently.
- Review task completion, pending work, overdue tasks, and focus-session totals.
- Start a 25-minute focus session associated with a task. Completion is recorded after server-side elapsed-time validation.
- Register and sign in to a personal account; task data is persisted in MySQL.
- Save the preferred task sort order in the browser.
- Use a responsive interface for desktop and mobile viewport sizes.

## Architecture

| Layer | Technologies | Responsibilities |
| --- | --- | --- |
| Frontend | HTML, CSS, vanilla JavaScript | Landing page, account forms, planner, profile, and browser preferences |
| Application server | Node.js, Express | Authentication, validation, task APIs, focus-session lifecycle, and security middleware |
| Persistence | MySQL, InnoDB | User accounts, tasks, sessions, authentication attempts, and focus-session records |

## Requirements

- Node.js 18 or newer
- npm
- MySQL 8 or a compatible MySQL server

## Local development

### 1. Create a database

Create a database in MySQL:

```sql
CREATE DATABASE task_planner
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

### 2. Configure the application

Create a `.env` file in the project root, alongside this README:

```dotenv
DB_HOST=localhost
DB_PORT=3306
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
DB_NAME=task_planner
PORT=3002
```

The server reads the database settings from this file. `.env` is excluded by `.gitignore` and must not be committed.

### 3. Install dependencies and start the server

Run these commands from the project root in PowerShell:

```powershell
Set-Location backend
npm install
npm start
```

The server listens on `http://localhost:3002` by default. Open that address in a browser to access the application.

In development mode, the server creates the required tables at startup and adds the checklist column to an older `tasks` table if needed.

## Production database setup

In production, set `NODE_ENV=production` and provide the database connection through environment variables. Production startup verifies the schema but does not create or alter tables. Apply [`backend/schema.sql`](backend/schema.sql) to the target database before starting the server.

Production deployment requires HTTPS, a dedicated least-privilege database account, secure secret management, backups, and operational monitoring.

## Tests

The backend validation tests use Node.js's built-in test runner. Run them from the `backend` directory:

```powershell
npm test
```

## Repository structure

```text
.
├── backend/
│   ├── index.js
│   ├── schema.sql
│   ├── validation.js
│   └── test/
├── frontend/
│   ├── index.html
│   ├── app.html
│   ├── profile.html
│   ├── signin.html
│   ├── signup.html
│   └── ...
├── Task_and_Productivity_Planner_Presentation.pptx
└── Task_and_Productivity_Planner_Project_Report.docx
```

## Security

- Passwords are hashed with bcrypt.
- Random session tokens are stored as hashes and issued in HttpOnly, SameSite cookies.
- Database operations use parameterized queries, and task access is scoped to the authenticated user.
- Server-side validation, same-origin checks for write requests, and authentication-attempt limits are applied.

These controls do not replace production deployment requirements such as HTTPS and secure database and secret configuration.

## Scope and limitations

The application is a coursework planning prototype. It does not integrate with a learning management system or provide email verification or password recovery. A completed focus session indicates that the configured duration elapsed; it does not verify user activity or measure learning outcomes.

## Project documentation

- [Project presentation](Task_and_Productivity_Planner_Presentation.pptx)
- [Project report](Task_and_Productivity_Planner_Project_Report.docx)
