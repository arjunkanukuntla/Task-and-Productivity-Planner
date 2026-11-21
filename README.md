# Task and Productivity Planner

A web-based planner for organizing coursework, tracking assignment progress, and protecting focused study time. Add deadlines and priorities, break work into checklist steps, and keep a task-linked record of completed focus sessions.

**Project by Arjun**

## Features

- **Task management:** Create, edit, complete, and delete tasks with deadlines and High, Medium, or Low priority.
- **Process and progress steps:** Add up to 50 checklist steps per task, one step per line. Check steps off as work progresses.
- **Deadline awareness:** See upcoming, due-soon, and overdue status, with a summary of pending work.
- **Focus sessions:** Start a 25-minute focus block linked to a task. The server verifies elapsed time before recording completion.
- **Accounts and persistence:** Sign up and sign in to a personal planner. Tasks and focus-session data are stored in MySQL.
- **Planner preferences:** Save the default task sort order in the browser.
- **Responsive interface:** Use the planner on desktop or mobile-sized screens.

## Technology

- Frontend: HTML, CSS, and vanilla JavaScript
- Backend: Node.js and Express
- Database: MySQL with InnoDB
- Authentication: bcrypt password hashing and server-managed sessions

## Requirements

- Node.js 18 or newer
- MySQL 8 or a compatible MySQL server
- npm (included with Node.js)

## Local setup

1. **Create a database** in MySQL:

   ```sql
   CREATE DATABASE task_planner
     CHARACTER SET utf8mb4
     COLLATE utf8mb4_unicode_ci;
   ```

2. **Configure the database connection.** Create a `.env` file in the project root (next to this README) with your local values:

   ```dotenv
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=your_mysql_user
   DB_PASSWORD=your_mysql_password
   DB_NAME=task_planner
   PORT=3002
   ```

   Keep `.env` private. It is excluded from Git by `.gitignore`; do not commit credentials.

3. **Install dependencies and start the application:**

   ```powershell
   cd backend
   npm install
   npm start
   ```

4. Open [http://localhost:3002](http://localhost:3002) in your browser and create an account.

In development mode, the server creates the required tables automatically. Existing task tables are also updated to include the checklist column when needed.

## Production database setup

For production, set `NODE_ENV=production` and configure the database connection through environment variables. The server verifies that the schema exists but does not create it. Run [`backend/schema.sql`](backend/schema.sql) against the selected database before starting the server.

Use a dedicated database account with least-privilege access, configure HTTPS and secure secret storage, and arrange appropriate backups and monitoring before deploying.

## Tests

Run the backend validation tests from the `backend` directory:

```powershell
npm test
```

## Project files

```text
.
├── backend/
│   ├── index.js                 # Express app, API, and database setup
│   ├── schema.sql               # Production database schema
│   ├── validation.js            # Input validation
│   └── test/                    # Backend tests
├── frontend/
│   ├── index.html               # Public landing page
│   ├── app.html                 # Authenticated planner
│   └── ...                      # Authentication, profile, styles, and scripts
├── Task_and_Productivity_Planner_Presentation.pptx
└── Task_and_Productivity_Planner_Project_Report.docx
```

## Scope and limitations

This is a coursework planning prototype. It does not integrate with an LMS and does not provide email verification or password recovery. A completed focus session records that its duration elapsed; it does not measure learning outcomes or verify activity during the session.

## Project materials

- [Project presentation](Task_and_Productivity_Planner_Presentation.pptx)
- [Project report](Task_and_Productivity_Planner_Project_Report.docx)
