# Impact360 starter SaaS

A small, functional, single-process SaaS learning MVP. It adds a Node.js API, local SQLite or hosted PostgreSQL storage, password-based sign-in, company-scoped records, role checks, review workflows, and audit events to the original browser demo. It makes no AI, paid API, or analytics calls.

## Requirements

- Node.js 22.5 or newer (Node 26 is already installed in the trainer environment).
- A modern browser.

No PostgreSQL server or cloud account is needed for local use. `npm ci` installs the PostgreSQL driver used when `DATABASE_URL` is configured.

## Start the app

From this folder, run:

```powershell
npm ci
npm start
```

Then open <http://127.0.0.1:3000>. Stop the server with `Ctrl+C`.

The first run creates `.data/impact360.sqlite` and seeds a fictional Northstar demo company. The database persists between server restarts. Demo users share the password below:

- Tenant administrator: `admin@northstar.example.invalid`
- Engineering manager: `user001@northstar.example.invalid`
- HR administrator: `hr@northstar.example.invalid`
- Executive approver: `executive@northstar.example.invalid`
- CEO: `ceo@northstar.example.invalid`
- Demo password: `DemoPass123!`

The `.example.invalid` email domain is reserved for examples; those addresses cannot receive email. Create a workspace from the sign-in screen for a separate tenant. New workspaces start with five departments and an administrator account.

## Hosted training demo

The included `render.yaml` prepares a Render Node web service. Connect this project to a GitHub repository, create a PostgreSQL project (for example, Supabase), and set `DATABASE_URL` in Render to that database's connection URI. Use the provider's SSL-enabled connection string and keep it in Render's secret settings; never commit it or paste it into chat. Render supplies `PORT`, and the app binds to the host interface when that variable is set.

When `DATABASE_URL` is set, the app initializes the PostgreSQL schema and uses PostgreSQL for all persisted records. The local SQLite demo seed users are intentionally not created in PostgreSQL. Visitors should create their own fictional training workspace; each registration becomes the administrator of a separate tenant. A database migration from a previously used local SQLite file is not included.

Free hosting and database plans have provider-specific limits and may sleep, pause, or change their terms. Confirm current pricing, quotas, backup, network, and connection-pooling requirements with each provider before deploying. This configuration is for a public training demo with synthetic data, not a production HR service. Public signup is open, and the MVP lacks email verification, account recovery, durable rate limiting, and a formal security review.

## Included workflows

- Create a tenant and sign in; passwords are stored as salted scrypt hashes.
- Eight-hour HttpOnly, SameSite session cookies and sign out.
- Tenant-scoped departments, users, employee records, KPIs, submissions, nominations, and audit events.
- Demo company with fictional departments, employee profiles, KPIs, submissions, and nomination cases.
- Add employee accounts and KPIs using role-checked forms.
- Submit KPI results with a period and an evidence text reference.
- Preview and validate CSV imports for employees, department KPIs, and performance submissions before committing them.
- Generate one-time temporary passwords for imported employee accounts; show the credentials once and let users change passwords after signing in.
- Review submissions with approval, follow-up, or decline decisions.
- Submit nominations and progress them through manager, department, HR, executive, and CEO stages.
- Request more nomination information and resubmit the case.
- Search and filter the employee directory and inspect the tenant audit log.

All primary records and workflow actions are saved in the configured database. Upload supports small CSV files (up to 100 rows and 1 MB) for employee accounts, KPIs, and performance submissions. CSV import is previewed and checked before the all-or-nothing save. Employee CSVs do not contain passwords; the server generates unique temporary passwords and displays them once after import. Share those securely.

## Roles

The starter roles are employee, manager, department leader, HR administrator, executive approver, CEO, and tenant administrator. API handlers enforce role and tenant checks on actions. The app uses role-specific views, but it is a teaching MVP—not a security certification or a substitute for a professional authorization review.

## Data and reset

The local SQLite database is stored in `.data/`. To preserve the demo, back up that folder while the server is stopped. To reset the local demo, stop the server, then remove only the `.data` folder and run the app again; it will recreate the sample company. Set `IMPACT360_DATA_DIR` or `IMPACT360_DB_PATH` to use a different SQLite database location. In hosted PostgreSQL mode, back up the database using the database provider's tools.

## Important production limitations

This local MVP is not ready for real HR data or public internet deployment. Before production use, it needs, at minimum:

- HTTPS termination, secure environment/secret management, password reset and account recovery, email verification, and stronger operational login protection.
- A formal privacy/retention policy, security testing, backups and restore drills, monitoring, and an incident-response plan.
- Review of authorization rules, audit-event integrity, data export/deletion, and employment-law requirements.
- A managed, backed-up database and deployment architecture appropriate for concurrent users and availability requirements.
- Attachment scanning/storage if real evidence uploads are added.

The app is intended for fictional-data training. Do not use it with real HR information or treat a free-tier deployment as production-ready; have the security and privacy model professionally reviewed before considering a production service.
