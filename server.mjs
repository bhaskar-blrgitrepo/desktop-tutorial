import { createServer } from "node:http";
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { databaseType, db, transaction } from "./database.mjs";

const scrypt = promisify(scryptCallback);
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const SESSION_HOURS = 8;
const DEMO_PASSWORD = "DemoPass123!";
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const SESSION_COOKIE = "impact360_session";
const loginAttempts = new Map();
const csvPreviews = new Map();
const MAX_IMPORT_ROWS = 100;
const roleValues = new Set(["tenant_admin", "employee", "manager", "department_leader", "hr_admin", "executive", "ceo", "platform_admin"]);
const departmentNames = ["Engineering", "Finance", "Customer Support", "Marketing", "Sales"];
const csvTemplates = {
  employees: "name,email,department,job_title,role,manager_email\r\nFictional Learner,learner@example.invalid,Engineering,Software Engineer,employee,user001@northstar.example.invalid\r\n",
  kpis: "department,name,target,unit,direction\r\nEngineering,Sample Reliability KPI,90,percent,higher\r\n",
  submissions: "employee_email,kpi_name,period,actual,evidence_note\r\nuser003@northstar.example.invalid,Release reliability,2026-Q3,99,Fictional demo report reference\r\n",
};
const departmentsForSeed = [
  ["Engineering", "Release reliability", "percent", 99.5, "higher"],
  ["Engineering", "Defect reduction", "percent", 90, "higher"],
  ["Engineering", "Delivery commitments", "percent", 90, "higher"],
  ["Finance", "Forecast accuracy", "percent", 95, "higher"],
  ["Finance", "Close cycle time", "days", 5, "lower"],
  ["Finance", "Cost savings", "USD", 10000, "higher"],
  ["Customer Support", "Resolution time", "hours", 4, "lower"],
  ["Customer Support", "Customer satisfaction", "percent", 90, "higher"],
  ["Customer Support", "First-contact resolution", "percent", 75, "higher"],
  ["Marketing", "Qualified leads", "count", 40, "higher"],
  ["Marketing", "Conversion rate", "percent", 5, "higher"],
  ["Marketing", "Acquisition cost", "USD", 120, "lower"],
  ["Sales", "Revenue attainment", "percent", 100, "higher"],
  ["Sales", "Qualified pipeline", "USD", 250000, "higher"],
  ["Sales", "Retention", "percent", 92, "higher"],
];
const employeeSeed = [
  ["Avery Chen", "Engineering", "Engineering Manager", "manager"],
  ["Devon Patel", "Engineering", "Department Leader", "department_leader"],
  ["Morgan Ellis", "Engineering", "Software Engineer", "employee"],
  ["Priya Nair", "Finance", "Finance Manager", "manager"],
  ["Ethan Brooks", "Finance", "Department Leader", "department_leader"],
  ["Casey Morgan", "Finance", "Financial Analyst", "employee"],
  ["Lena Ortiz", "Customer Support", "Support Manager", "manager"],
  ["Noah Bennett", "Customer Support", "Department Leader", "department_leader"],
  ["Riley Shah", "Customer Support", "Support Specialist", "employee"],
  ["Samira Khan", "Marketing", "Marketing Manager", "manager"],
  ["Owen Clarke", "Marketing", "Department Leader", "department_leader"],
  ["Jamie Rivera", "Marketing", "Marketing Specialist", "employee"],
  ["Mateo Silva", "Sales", "Sales Manager", "manager"],
  ["Zoe Park", "Sales", "Department Leader", "department_leader"],
  ["Alex Kim", "Sales", "Account Executive", "employee"],
];

async function initializeDatabase() {
  await db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    UNIQUE(tenant_id, name),
    UNIQUE(tenant_id, id)
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    department_id TEXT,
    employee_id TEXT,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE(tenant_id, email),
    UNIQUE(tenant_id, id),
    FOREIGN KEY (tenant_id, department_id) REFERENCES departments(tenant_id, id)
  );
  CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    department_id TEXT NOT NULL,
    manager_employee_id TEXT,
    job_title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(tenant_id, user_id),
    UNIQUE(tenant_id, id),
    FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id),
    FOREIGN KEY (tenant_id, department_id) REFERENCES departments(tenant_id, id),
    FOREIGN KEY (tenant_id, manager_employee_id) REFERENCES employees(tenant_id, id)
  );
  CREATE TABLE IF NOT EXISTS kpis (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    department_id TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    target REAL NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('higher','lower')),
    created_at TEXT NOT NULL,
    UNIQUE(tenant_id, id),
    FOREIGN KEY (tenant_id, department_id) REFERENCES departments(tenant_id, id)
  );
  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id TEXT NOT NULL,
    kpi_id TEXT NOT NULL,
    period TEXT NOT NULL,
    actual REAL NOT NULL,
    evidence_note TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitted',
    submitted_at TEXT NOT NULL,
    reviewed_by TEXT,
    review_note TEXT,
    FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, id),
    FOREIGN KEY (tenant_id, kpi_id) REFERENCES kpis(tenant_id, id),
    FOREIGN KEY (tenant_id, reviewed_by) REFERENCES users(tenant_id, id)
  );
  CREATE TABLE IF NOT EXISTS nominations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    nominee_employee_id TEXT NOT NULL,
    nominator_user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('impact_award','promotion')),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    stage TEXT NOT NULL DEFAULT 'manager_review',
    created_at TEXT NOT NULL,
    FOREIGN KEY (tenant_id, nominee_employee_id) REFERENCES employees(tenant_id, id),
    FOREIGN KEY (tenant_id, nominator_user_id) REFERENCES users(tenant_id, id)
  );
  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    actor_user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    details TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (tenant_id, actor_user_id) REFERENCES users(tenant_id, id)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_employees_tenant ON employees(tenant_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_kpi_tenant_department_name ON kpis(tenant_id, department_id, lower(name));
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_global_email ON users(lower(email));
  CREATE INDEX IF NOT EXISTS idx_submissions_tenant ON submissions(tenant_id, submitted_at);
  CREATE INDEX IF NOT EXISTS idx_nominations_tenant ON nominations(tenant_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_events(tenant_id, created_at);
`);
}

const statements = {
  tenantByName: db.prepare("SELECT * FROM tenants WHERE name = ?"),
  userByEmail: db.prepare("SELECT * FROM users WHERE tenant_id = ? AND lower(email) = lower(?)"),
  sessionUser: db.prepare(`SELECT u.id, u.tenant_id, u.email, u.display_name, u.role, u.department_id, u.employee_id, d.name AS department_name
    FROM sessions s JOIN users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
    LEFT JOIN departments d ON d.id = u.department_id AND d.tenant_id = u.tenant_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`),
  departments: db.prepare("SELECT id, name FROM departments WHERE tenant_id = ? ORDER BY name"),
  employees: db.prepare(`SELECT e.id, e.user_id, e.department_id, e.manager_employee_id, e.job_title, u.display_name AS name, u.email, u.role, d.name AS department_name,
      (SELECT e2.display_name FROM employees e1 JOIN users e2 ON e2.id = e1.user_id AND e2.tenant_id = e1.tenant_id WHERE e1.id = e.manager_employee_id AND e1.tenant_id = e.tenant_id) AS manager_name
    FROM employees e JOIN users u ON u.id = e.user_id AND u.tenant_id = e.tenant_id
    JOIN departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
    WHERE e.tenant_id = ? ORDER BY d.name, u.display_name`),
  kpis: db.prepare(`SELECT k.id, k.department_id, d.name AS department_name, k.name, k.unit, k.target, k.direction,
      (SELECT AVG(s.actual) FROM submissions s WHERE s.tenant_id = k.tenant_id AND s.kpi_id = k.id) AS actual
    FROM kpis k JOIN departments d ON d.id = k.department_id AND d.tenant_id = k.tenant_id
    WHERE k.tenant_id = ? ORDER BY d.name, k.name`),
  submissions: db.prepare(`SELECT s.id, s.employee_id, u.display_name AS employee_name, d.name AS department_name,
      s.kpi_id, k.name AS kpi_name, k.unit, k.target, k.direction, s.period, s.actual,
      s.evidence_note, s.status, s.submitted_at, s.review_note, reviewer.display_name AS reviewer_name
    FROM submissions s
    JOIN employees e ON e.id = s.employee_id AND e.tenant_id = s.tenant_id
    JOIN users u ON u.id = e.user_id AND u.tenant_id = e.tenant_id
    JOIN departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
    JOIN kpis k ON k.id = s.kpi_id AND k.tenant_id = s.tenant_id
    LEFT JOIN users reviewer ON reviewer.id = s.reviewed_by AND reviewer.tenant_id = s.tenant_id
    WHERE s.tenant_id = ? ORDER BY s.submitted_at DESC LIMIT 250`),
  nominations: db.prepare(`SELECT n.id, n.nominee_employee_id, nominee.display_name AS nominee_name,
      d.name AS department_name, n.nominator_user_id, nominator.display_name AS nominator_name,
      n.type, n.reason, n.status, n.stage, n.created_at
    FROM nominations n
    JOIN employees e ON e.id = n.nominee_employee_id AND e.tenant_id = n.tenant_id
    JOIN users nominee ON nominee.id = e.user_id AND nominee.tenant_id = e.tenant_id
    JOIN departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
    JOIN users nominator ON nominator.id = n.nominator_user_id AND nominator.tenant_id = n.tenant_id
    WHERE n.tenant_id = ? ORDER BY n.created_at DESC`),
};

const now = () => new Date().toISOString();
const id = () => randomUUID();
const hashToken = token => createHash("sha256").update(token).digest("hex");
const normalizeEmail = value => String(value || "").trim().toLowerCase();
const isText = (value, min, max) => typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
const isPositive = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isUniqueError = error => error.code === "23505" || /UNIQUE/i.test(String(error.message));
const scryptHash = async password => {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `${salt.toString("hex")}:${Buffer.from(key).toString("hex")}`;
};
const verifyPassword = async (password, encoded) => {
  const [saltHex, keyHex] = String(encoded).split(":");
  if (!saltHex || !keyHex) return false;
  const key = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(keyHex, "hex");
  return expected.length === key.length && timingSafeEqual(expected, key);
};
const audit = async (context, action, entityType, entityId, details = "") =>
  db.prepare(`INSERT INTO audit_events (id, tenant_id, actor_user_id, action, entity_type, entity_id, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id(), context.tenant_id, context.id, action, entityType, entityId, details.slice(0, 500), now());
const publicUser = user => ({
  id: user.id,
  tenant_id: user.tenant_id,
  email: user.email,
  display_name: user.display_name,
  role: user.role,
  department_id: user.department_id,
  department_name: user.department_name || null,
  employee_id: user.employee_id || null,
});

async function seedIfNeeded() {
  if (databaseType === "postgresql") return;
  const tenantName = "Northstar Demo Company";
  if (await statements.tenantByName.get(tenantName)) return;
  const tenantId = id();
  const createdAt = now();
  const passwordHash = await scryptHash(DEMO_PASSWORD);
  await transaction(async () => {
    await db.prepare("INSERT INTO tenants (id,name,created_at) VALUES (?,?,?)").run(tenantId, tenantName, createdAt);
    const deptIds = new Map();
    const insertDepartment = db.prepare("INSERT INTO departments (id,tenant_id,name) VALUES (?,?,?)");
    for (const name of departmentNames) {
      const deptId = id();
      deptIds.set(name, deptId);
      await insertDepartment.run(deptId, tenantId, name);
    }
    const insertUser = db.prepare(`INSERT INTO users (id,tenant_id,department_id,employee_id,email,display_name,role,password_hash,active,created_at)
      VALUES (?,?,?,?,?,?,?,?,1,?)`);
    const insertEmployee = db.prepare(`INSERT INTO employees (id,tenant_id,user_id,department_id,manager_employee_id,job_title,created_at)
      VALUES (?,?,?,?,?,?,?)`);
    const people = [];
    for (let index = 0; index < employeeSeed.length; index++) {
      const [name, department, title, role] = employeeSeed[index];
      const userId = id();
      const employeeId = id();
      const email = `user${String(index + 1).padStart(3, "0")}@northstar.example.invalid`;
      await insertUser.run(userId, tenantId, deptIds.get(department), employeeId, email, name, role, passwordHash, createdAt);
      const managerIndex = index % 3 === 0 ? null : Math.floor(index / 3) * 3;
      await insertEmployee.run(employeeId, tenantId, userId, deptIds.get(department), managerIndex === null ? null : people[managerIndex].employeeId, title, createdAt);
      people.push({ userId, employeeId, name, department });
    }
    const insertPrivilegedUser = db.prepare(`INSERT INTO users (id,tenant_id,email,display_name,role,password_hash,active,created_at)
      VALUES (?,?,?,?,?,?,1,?)`);
    for (const [email, displayName, role] of [
      ["hr@northstar.example.invalid", "Harper Lane", "hr_admin"],
      ["executive@northstar.example.invalid", "Quinn Taylor", "executive"],
      ["ceo@northstar.example.invalid", "Rowan Blake", "ceo"],
    ]) {
      await insertPrivilegedUser.run(id(), tenantId, email, displayName, role, passwordHash, createdAt);
    }
    const adminId = id();
    await db.prepare(`INSERT INTO users (id,tenant_id,email,display_name,role,password_hash,active,created_at)
      VALUES (?,?,?,?,?,?,1,?)`).run(adminId, tenantId, "admin@northstar.example.invalid", "Demo Tenant Admin", "tenant_admin", passwordHash, createdAt);
    const insertKpi = db.prepare(`INSERT INTO kpis (id,tenant_id,department_id,name,unit,target,direction,created_at)
      VALUES (?,?,?,?,?,?,?,?)`);
    const kpiRecords = [];
    for (const [department, name, unit, target, direction] of departmentsForSeed) {
      const kpiId = id();
      await insertKpi.run(kpiId, tenantId, deptIds.get(department), name, unit, target, direction, createdAt);
      kpiRecords.push({ id: kpiId, department, name, unit, target, direction });
    }
    const insertSubmission = db.prepare(`INSERT INTO submissions
      (id,tenant_id,employee_id,kpi_id,period,actual,evidence_note,status,submitted_at,reviewed_by,review_note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const insertsByRole = new Map();
    for (let personIndex = 0; personIndex < people.length; personIndex++) {
      const person = people[personIndex];
      const group = Math.floor(personIndex / 3);
      for (let localKpi = 0; localKpi < 3; localKpi++) {
        const kpi = kpiRecords[group * 3 + localKpi];
        const factor = [0.94, 0.99, 1.03, 1.07, 1.11][(personIndex + localKpi) % 5];
        const actual = Number((kpi.target * factor).toFixed(kpi.unit === "USD" ? 0 : 2));
        const status = (personIndex + localKpi) % 4 === 0 ? "approved" : "submitted";
        const reviewer = people[group * 3].userId;
        await insertSubmission.run(id(), tenantId, person.employeeId, kpi.id, "2026-Q3", actual,
          `Fictional demo evidence reference for ${kpi.name}.`, status,
          new Date(Date.now() - (personIndex * 45 + localKpi * 12) * 3600000).toISOString(),
          status === "approved" ? reviewer : null,
          status === "approved" ? "Fictional sample review recorded." : null);
      }
    }
    const insertNomination = db.prepare(`INSERT INTO nominations
      (id,tenant_id,nominee_employee_id,nominator_user_id,type,reason,status,stage,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    const nominationSeeds = [
      [2, 1, "impact_award", "Fictional nomination for improving a sample release process.", "pending", "manager_review"],
      [5, 4, "promotion", "Fictional case for a promotion discussion.", "declined", "closed"],
      [8, 7, "impact_award", "Fictional nomination for helpful customer support.", "pending", "hr_governance"],
      [11, 10, "promotion", "Fictional promotion nomination awaiting department review.", "pending", "department_review"],
      [14, 13, "impact_award", "Fictional finalist for consistent customer impact.", "approved", "closed"],
    ];
    for (const [nominee, nominator, type, reason, status, stage] of nominationSeeds) {
      await insertNomination.run(id(), tenantId, people[nominee].employeeId, people[nominator].userId, type, reason, status, stage, createdAt);
    }
    const adminContext = { id: adminId, tenant_id: tenantId };
    await audit(adminContext, "demo_tenant_seeded", "tenant", tenantId, "Fictional starter data created.");
  });
}

function sendJson(response, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    ...extraHeaders,
  });
  response.end(body);
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message });
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Expected an object.");
    return parsed;
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
}

function cookieToken(request) {
  const raw = request.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === SESSION_COOKIE) return value.join("=");
  }
  return "";
}

function parseCsv(input) {
    const text = String(input || "").replace(/^\uFEFF/, "");
    const records = [];
    let record = [], field = "", quoted = false;
    for (let index = 0; index < text.length; index++) {
      const character = text[index];
      if (quoted) {
        if (character === '"' && text[index + 1] === '"') { field += '"'; index++; }
        else if (character === '"') quoted = false;
        else field += character;
      } else if (character === '"') {
        if (field.length) throw new Error(`Unexpected quote near character ${index + 1}.`);
        quoted = true;
      } else if (character === ",") {
        record.push(field); field = "";
      } else if (character === "\n" || character === "\r") {
        if (character === "\r" && text[index + 1] === "\n") index++;
        record.push(field); field = "";
        if (record.some(value => value.trim() !== "")) records.push(record);
        record = [];
      } else field += character;
    }
    if (quoted) throw new Error("A quoted CSV field is not closed.");
    record.push(field);
    if (record.some(value => value.trim() !== "")) records.push(record);
    if (records.length < 2) throw new Error("The CSV needs a header row and at least one data row.");
    const headers = records[0].map(value => value.trim().toLowerCase());
    if (headers.some(value => !value) || new Set(headers).size !== headers.length) {
      throw new Error("The CSV header contains an empty or repeated column name.");
    }
    const rows = records.slice(1).map((values, index) => {
      if (values.length !== headers.length) throw new Error(`Row ${index + 2} has ${values.length} values; expected ${headers.length}.`);
      return Object.fromEntries(headers.map((header, column) => [header, values[column].trim()]));
    });
    if (rows.length > MAX_IMPORT_ROWS) throw new Error(`A single upload can contain at most ${MAX_IMPORT_ROWS} data rows.`);
    return rows;
}

async function validateImport(tenantId, type, rows) {
    const errors = [];
    const requireHeaders = {
      employees: ["name", "email", "department", "job_title", "role"],
      kpis: ["department", "name", "target", "unit", "direction"],
      submissions: ["employee_email", "kpi_name", "period", "actual", "evidence_note"],
    }[type];
    if (!requireHeaders) return { errors: [{ row: 1, field: "type", message: "Choose employees, KPIs, or submissions." }] };
    const headers = new Set(Object.keys(rows[0] || {}));
    for (const header of requireHeaders) {
      if (!headers.has(header)) errors.push({ row: 1, field: header, message: `Required column "${header}" is missing.` });
    }
    if (errors.length) return { errors };
    const departments = await db.prepare("SELECT id,name FROM departments WHERE tenant_id = ?").all(tenantId);
    const departmentByName = new Map(departments.map(row => [row.name.toLowerCase(), row]));
    const seenEmails = new Set();
    const seenKpis = new Set();
    const normalized = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const line = index + 2;
      if (type === "employees") {
        const name = row.name.trim(), email = normalizeEmail(row.email);
        const jobTitle = row.job_title.trim(), role = row.role.trim();
        const department = departmentByName.get(row.department.trim().toLowerCase());
        if (!isText(name, 2, 80)) errors.push({ row: line, field: "name", message: "Enter a name of 2 to 80 characters." });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push({ row: line, field: "email", message: "Enter a valid email address." });
        else if (seenEmails.has(email) || await db.prepare("SELECT 1 FROM users WHERE lower(email) = lower(?)").get(email)) errors.push({ row: line, field: "email", message: "This email already has an account." });
        seenEmails.add(email);
        if (!department) errors.push({ row: line, field: "department", message: "Choose a department in this company." });
        if (!isText(jobTitle, 2, 100)) errors.push({ row: line, field: "job_title", message: "Enter a job title of 2 to 100 characters." });
        if (!roleValues.has(role) || role === "tenant_admin" || role === "platform_admin") errors.push({ row: line, field: "role", message: "Choose employee, manager, department_leader, hr_admin, executive, or ceo." });
        const managerEmail = normalizeEmail(row.manager_email);
        let manager = null;
        if (managerEmail) {
          manager = await db.prepare(`SELECT e.id, e.department_id, u.role FROM employees e
            JOIN users u ON u.id = e.user_id AND u.tenant_id = e.tenant_id
            WHERE e.tenant_id = ? AND lower(u.email) = lower(?)`).get(tenantId, managerEmail);
          if (!manager || !["manager", "department_leader"].includes(manager.role)) {
            errors.push({ row: line, field: "manager_email", message: "Manager email must belong to an existing manager or department leader in this company." });
          }
        }
        normalized.push({ name, email, job_title: jobTitle, role, department_id: department?.id, manager_employee_id: manager?.id || null });
      } else if (type === "kpis") {
        const department = departmentByName.get(row.department.trim().toLowerCase());
        const name = row.name.trim(), unit = row.unit.trim(), direction = row.direction.trim().toLowerCase();
        const target = Number(row.target);
        if (!department) errors.push({ row: line, field: "department", message: "Choose a department in this company." });
        if (!isText(name, 2, 100)) errors.push({ row: line, field: "name", message: "Enter a KPI name of 2 to 100 characters." });
        if (!isPositive(target)) errors.push({ row: line, field: "target", message: "Target must be a non-negative number." });
        if (!isText(unit, 1, 20)) errors.push({ row: line, field: "unit", message: "Enter a short unit, for example percent, count, or USD." });
        if (!["higher", "lower"].includes(direction)) errors.push({ row: line, field: "direction", message: 'Direction must be "higher" or "lower".' });
        const kpiKey = `${department?.id || ""}:${name.toLowerCase()}`;
        if (department && (seenKpis.has(kpiKey) || await db.prepare("SELECT 1 FROM kpis WHERE tenant_id = ? AND department_id = ? AND lower(name) = lower(?)").get(tenantId, department.id, name))) {
          errors.push({ row: line, field: "name", message: "A KPI with this name already exists in that department." });
        }
        seenKpis.add(kpiKey);
        normalized.push({ department_id: department?.id, name, target, unit, direction });
      } else {
        const email = normalizeEmail(row.employee_email);
        const employee = await db.prepare(`SELECT e.id, e.department_id FROM employees e
          JOIN users u ON u.id = e.user_id AND u.tenant_id = e.tenant_id
          WHERE e.tenant_id = ? AND lower(u.email) = lower(?)`).get(tenantId, email);
        if (!employee) errors.push({ row: line, field: "employee_email", message: "Employee email was not found in this company." });
        const kpiName = row.kpi_name.trim();
        const kpi = employee && await db.prepare("SELECT id FROM kpis WHERE tenant_id = ? AND department_id = ? AND lower(name) = lower(?)")
          .get(tenantId, employee.department_id, kpiName);
        if (!kpi) errors.push({ row: line, field: "kpi_name", message: "KPI was not found in the employee's department." });
        const actual = Number(row.actual);
        if (!isPositive(actual)) errors.push({ row: line, field: "actual", message: "Actual result must be a non-negative number." });
        if (!/^\d{4}-Q[1-4]$/.test(row.period.trim())) errors.push({ row: line, field: "period", message: "Use a period such as 2026-Q3." });
        if (!isText(row.evidence_note, 3, 500)) errors.push({ row: line, field: "evidence_note", message: "Enter a fictional evidence note of 3 to 500 characters." });
        normalized.push({ employee_id: employee?.id, kpi_id: kpi?.id, actual, period: row.period.trim(), evidence_note: row.evidence_note.trim() });
      }
    }
    return { errors, normalized };
}

async function getContext(request) {
  const token = cookieToken(request);
  if (!token) return null;
  return await statements.sessionUser.get(hashToken(token), now()) || null;
}

function canManagePeople(context) {
  return ["tenant_admin", "hr_admin"].includes(context.role);
}
function canManageKpis(context) {
  return ["tenant_admin", "hr_admin", "department_leader"].includes(context.role);
}
async function canReviewSubmission(context, submission) {
  if (["tenant_admin", "hr_admin"].includes(context.role)) return true;
  if (!["manager", "department_leader"].includes(context.role)) return false;
  const row = await db.prepare(`SELECT e.manager_employee_id, reviewer.department_id
    FROM employees e JOIN users reviewer ON reviewer.id = ?
    WHERE e.id = ? AND e.tenant_id = ? AND reviewer.tenant_id = ?`)
    .get(context.id, submission.employee_id, context.tenant_id, context.tenant_id);
  if (!row) return false;
  return context.role === "manager"
    ? row.manager_employee_id === context.employee_id
    : row.department_id === context.department_id && submission.employee_id !== context.employee_id;
}
const stageRoles = {
  manager_review: new Set(["manager", "tenant_admin"]),
  department_review: new Set(["department_leader", "tenant_admin"]),
  hr_governance: new Set(["hr_admin", "tenant_admin"]),
  executive_shortlist: new Set(["executive", "tenant_admin"]),
  ceo_decision: new Set(["ceo", "tenant_admin"]),
};
const nextStage = {
  manager_review: "department_review",
  department_review: "hr_governance",
  hr_governance: "executive_shortlist",
  executive_shortlist: "ceo_decision",
  ceo_decision: "closed",
};

async function serveStatic(pathname, response) {
  const allowed = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/index.html", ["index.html", "text/html; charset=utf-8"]],
    ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ]);
  const entry = allowed.get(pathname);
  if (!entry) return false;
  const [filename, contentType] = entry;
  const path = normalize(join(ROOT, filename));
  if (!path.startsWith(resolve(ROOT) + sep) || !existsSync(path)) {
    sendError(response, 404, "Page not found.");
    return true;
  }
  const { readFile } = await import("node:fs/promises");
  const body = await readFile(path);
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  });
  response.end(body);
  return true;
}

async function handleApi(request, response, url) {
  const method = request.method || "GET";
  const path = url.pathname;
  if (method === "GET" && path === "/api/health") {
    return sendJson(response, 200, { status: "ok", database: databaseType, demo_login_available: databaseType === "sqlite", ai_enabled: false });
  }
  if (method === "GET" && path === "/api/import/template") {
    const type = url.searchParams.get("type");
    const csv = csvTemplates[type];
    if (!csv) return sendError(response, 400, "Choose an employees, kpis, or submissions template.");
    response.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="impact360-${type}-template.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    });
    return response.end(csv);
  }

  if (method === "POST" && path === "/api/register") {
    const body = await readJson(request);
    const tenantName = String(body.company_name || "").trim();
    const email = normalizeEmail(body.email);
    const name = String(body.name || "").trim();
    const password = String(body.password || "");
    if (!isText(tenantName, 2, 100) || !isText(name, 2, 80) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 200) {
      return sendError(response, 400, "Enter a company, valid email, name, and password of at least 12 characters.");
    }
    if (await db.prepare("SELECT 1 FROM users WHERE lower(email) = lower(?)").get(email)) {
      return sendError(response, 409, "That email already has an account. Try signing in.");
    }
    const tenantId = id();
    const userId = id();
    const createdAt = now();
    const passwordHash = await scryptHash(password);
    try {
      await transaction(async () => {
        await db.prepare("INSERT INTO tenants (id,name,created_at) VALUES (?,?,?)").run(tenantId, tenantName, createdAt);
        const insertDepartment = db.prepare("INSERT INTO departments (id,tenant_id,name) VALUES (?,?,?)");
        for (const departmentName of departmentNames) await insertDepartment.run(id(), tenantId, departmentName);
        await db.prepare(`INSERT INTO users (id,tenant_id,email,display_name,role,password_hash,active,created_at)
          VALUES (?,?,?,?,'tenant_admin',?,1,?)`).run(userId, tenantId, email, name, passwordHash, createdAt);
        const context = { id: userId, tenant_id: tenantId };
        await audit(context, "tenant_registered", "tenant", tenantId, "New tenant registered.");
      });
    } catch (error) {
      if (isUniqueError(error)) return sendError(response, 409, "That email or company name already exists.");
      throw error;
    }
    const token = randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + SESSION_HOURS * 3600000).toISOString();
    await db.prepare("INSERT INTO sessions (token_hash,tenant_id,user_id,expires_at) VALUES (?,?,?,?)")
      .run(hashToken(token), tenantId, userId, expires);
    const cookie = `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
    return sendJson(response, 201, { user: publicUser({ id: userId, tenant_id: tenantId, email, display_name: name, role: "tenant_admin" }) }, { "Set-Cookie": cookie });
  }

  if (method === "POST" && path === "/api/login") {
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    const attemptKey = `${request.socket.remoteAddress || "unknown"}:${email}`;
    const attempt = loginAttempts.get(attemptKey) || { count: 0, since: Date.now() };
    if (Date.now() - attempt.since > 60000) { attempt.count = 0; attempt.since = Date.now(); }
    attempt.count++;
    loginAttempts.set(attemptKey, attempt);
    if (attempt.count > 10) return sendError(response, 429, "Too many sign-in attempts. Wait one minute and try again.");
    const users = await db.prepare("SELECT * FROM users WHERE lower(email) = lower(?) AND active = 1").all(email);
    let user = null;
    for (const candidate of users) {
      if (await verifyPassword(String(body.password || ""), candidate.password_hash)) { user = candidate; break; }
    }
    if (!user) return sendError(response, 401, "Email or password is incorrect.");
    loginAttempts.delete(attemptKey);
    const token = randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + SESSION_HOURS * 3600000).toISOString();
    await db.prepare("INSERT INTO sessions (token_hash,tenant_id,user_id,expires_at) VALUES (?,?,?,?)")
      .run(hashToken(token), user.tenant_id, user.id, expires);
    const cookie = `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
    return sendJson(response, 200, { user: publicUser(user) }, { "Set-Cookie": cookie });
  }

  if (method === "POST" && path === "/api/logout") {
    const token = cookieToken(request);
    if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
    return sendJson(response, 200, { ok: true }, { "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
  }

  const context = await getContext(request);
  if (!context && method === "GET" && path === "/api/me") return sendJson(response, 200, { user: null });
  if (!context) return sendError(response, 401, "Sign in to continue.");
  if (method === "GET" && path === "/api/me") return sendJson(response, 200, { user: publicUser(context) });
  if (method === "POST" && path === "/api/change-password") {
    const body = await readJson(request);
    const currentPassword = String(body.current_password || "");
    const newPassword = String(body.new_password || "");
    const user = await db.prepare("SELECT password_hash FROM users WHERE id = ? AND tenant_id = ?").get(context.id, context.tenant_id);
    if (!user || !(await verifyPassword(currentPassword, user.password_hash))) return sendError(response, 400, "Current password is incorrect.");
    if (newPassword.length < 12 || newPassword.length > 200) return sendError(response, 400, "New password must be 12 to 200 characters.");
    const token = cookieToken(request);
    const newHash = await scryptHash(newPassword);
    await transaction(async () => {
      await db.prepare("UPDATE users SET password_hash = ? WHERE id = ? AND tenant_id = ?").run(newHash, context.id, context.tenant_id);
      await db.prepare("DELETE FROM sessions WHERE user_id = ? AND tenant_id = ? AND token_hash != ?").run(context.id, context.tenant_id, hashToken(token));
      await audit(context, "password_changed", "user", context.id, "User changed their password.");
    });
    return sendJson(response, 200, { ok: true });
  }
  if (method === "GET" && path === "/api/departments") {
    return sendJson(response, 200, { departments: await statements.departments.all(context.tenant_id) });
  }
  if (method === "POST" && path === "/api/import/preview") {
    const body = await readJson(request);
    const type = String(body.type || "");
    if ((type === "employees" && !canManagePeople(context)) ||
        (type === "kpis" && !canManageKpis(context)) ||
        (type === "submissions" && !canManagePeople(context))) {
      return sendError(response, 403, "Your role is not allowed to import this data type.");
    }
    let rows;
    try { rows = parseCsv(body.csv); }
    catch (error) { return sendError(response, 400, error.message); }
    const validation = await validateImport(context.tenant_id, type, rows);
    if (validation.errors.length) {
      return sendJson(response, 200, { valid: false, row_count: rows.length, errors: validation.errors });
    }
    const previewId = randomBytes(24).toString("base64url");
    for (const [key, preview] of csvPreviews) if (preview.expires <= Date.now()) csvPreviews.delete(key);
    csvPreviews.set(previewId, {
      tenant_id: context.tenant_id,
      user_id: context.id,
      type,
      rows,
      expires: Date.now() + 15 * 60 * 1000,
    });
    return sendJson(response, 200, {
      valid: true,
      preview_id: previewId,
      type,
      row_count: rows.length,
      columns: Object.keys(rows[0]),
      sample_rows: rows.slice(0, 5),
      message: type === "employees"
        ? "A unique temporary password will be generated for each account and shown once after import."
        : "All rows passed validation. Nothing has been saved yet.",
    });
  }
  if (method === "POST" && path === "/api/import/commit") {
    const body = await readJson(request);
    const previewId = String(body.preview_id || "");
    const preview = csvPreviews.get(previewId);
    if (!preview || preview.expires <= Date.now() || preview.tenant_id !== context.tenant_id || preview.user_id !== context.id) {
      if (preview && preview.expires <= Date.now()) csvPreviews.delete(previewId);
      return sendError(response, 410, "Import preview expired. Upload and preview the CSV again.");
    }
    if ((preview.type === "employees" && !canManagePeople(context)) ||
        (preview.type === "kpis" && !canManageKpis(context)) ||
        (preview.type === "submissions" && !canManagePeople(context))) {
      return sendError(response, 403, "Your role is not allowed to import this data type.");
    }
    const validation = await validateImport(context.tenant_id, preview.type, preview.rows);
    if (validation.errors.length) {
      csvPreviews.delete(previewId);
      return sendJson(response, 409, { error: "The data changed after preview. Review the errors and upload the CSV again.", errors: validation.errors });
    }
    const credentials = [];
    if (preview.type === "employees") {
      for (const row of validation.normalized) {
        const temporaryPassword = randomBytes(18).toString("base64url");
        credentials.push({ email: row.email, temporary_password: temporaryPassword, password_hash: await scryptHash(temporaryPassword) });
      }
    }
    const insertEmployeeUser = db.prepare(`INSERT INTO users (id,tenant_id,department_id,employee_id,email,display_name,role,password_hash,active,created_at)
      VALUES (?,?,?,?,?,?,?,?,1,?)`);
    const insertEmployee = db.prepare(`INSERT INTO employees (id,tenant_id,user_id,department_id,manager_employee_id,job_title,created_at)
      VALUES (?,?,?,?,?,?,?)`);
    const insertKpi = db.prepare(`INSERT INTO kpis (id,tenant_id,department_id,name,unit,target,direction,created_at)
      VALUES (?,?,?,?,?,?,?,?)`);
    const insertSubmission = db.prepare(`INSERT INTO submissions
      (id,tenant_id,employee_id,kpi_id,period,actual,evidence_note,status,submitted_at)
      VALUES (?,?,?,?,?,?,?,'submitted',?)`);
    try {
      await transaction(async () => {
        for (const [index, row] of validation.normalized.entries()) {
          if (preview.type === "employees") {
            const userId = id(), employeeId = id();
            await insertEmployeeUser.run(userId, context.tenant_id, row.department_id, employeeId, row.email, row.name, row.role, credentials[index].password_hash, now());
            await insertEmployee.run(employeeId, context.tenant_id, userId, row.department_id, row.manager_employee_id, row.job_title, now());
          } else if (preview.type === "kpis") {
            await insertKpi.run(id(), context.tenant_id, row.department_id, row.name, row.unit, row.target, row.direction, now());
          } else {
            await insertSubmission.run(id(), context.tenant_id, row.employee_id, row.kpi_id, row.period, row.actual, row.evidence_note, now());
          }
        }
        await audit(context, "csv_import_completed", preview.type, previewId, `Imported ${validation.normalized.length} ${preview.type} rows.`);
      });
    } catch (error) {
      if (isUniqueError(error)) return sendError(response, 409, "One or more records now conflict with existing data. Preview the CSV again.");
      throw error;
    }
    csvPreviews.delete(previewId);
    return sendJson(response, 200, {
      ok: true,
      type: preview.type,
      imported: validation.normalized.length,
      credentials: credentials.map(({ email, temporary_password }) => ({ email, temporary_password })),
    });
  }
  if (method === "GET" && path === "/api/employees") {
    if (context.role === "platform_admin") return sendError(response, 403, "Platform administrators do not have access to employee records.");
    const employees = await statements.employees.all(context.tenant_id);
    return sendJson(response, 200, { employees: employees.map(row => ({ ...row, email: canManagePeople(context) ? row.email : undefined })) });
  }
  if (method === "POST" && path === "/api/employees") {
    if (!canManagePeople(context)) return sendError(response, 403, "Only a tenant administrator or HR administrator can add employee accounts.");
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    const name = String(body.name || "").trim();
    const role = String(body.role || "");
    const title = String(body.job_title || "").trim();
    const password = String(body.password || "");
    const departmentId = String(body.department_id || "");
    const managerId = body.manager_employee_id ? String(body.manager_employee_id) : null;
    if (!isText(name, 2, 80) || !isText(title, 2, 100) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        password.length < 12 || password.length > 200 || !roleValues.has(role) || role === "tenant_admin" || role === "platform_admin" ||
        !(await statements.departments.all(context.tenant_id)).some(row => row.id === departmentId)) {
      return sendError(response, 400, "Provide a name, valid email, role, title, department, and a password of at least 12 characters.");
    }
    if (managerId && !await db.prepare("SELECT 1 FROM employees WHERE id = ? AND tenant_id = ?").get(managerId, context.tenant_id)) {
      return sendError(response, 400, "The selected manager is not in this company.");
    }
    if (await db.prepare("SELECT 1 FROM users WHERE tenant_id = ? AND lower(email) = lower(?)").get(context.tenant_id, email)) {
      return sendError(response, 409, "That email already exists in this company.");
    }
    const userId = id(), employeeId = id();
    const passwordHash = await scryptHash(password);
    await transaction(async () => {
      await db.prepare(`INSERT INTO users (id,tenant_id,department_id,employee_id,email,display_name,role,password_hash,active,created_at)
        VALUES (?,?,?,?,?,?,?,?,1,?)`).run(userId, context.tenant_id, departmentId, employeeId, email, name, role, passwordHash, now());
      await db.prepare(`INSERT INTO employees (id,tenant_id,user_id,department_id,manager_employee_id,job_title,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(employeeId, context.tenant_id, userId, departmentId, managerId, title, now());
      await audit(context, "employee_created", "employee", employeeId, `Created ${email} with role ${role}.`);
    });
    return sendJson(response, 201, { employee: { id: employeeId, user_id: userId, name, email, role, department_id: departmentId, job_title: title } });
  }
  if (method === "GET" && path === "/api/kpis") {
    return sendJson(response, 200, { kpis: await statements.kpis.all(context.tenant_id) });
  }
  if (method === "POST" && path === "/api/kpis") {
    if (!canManageKpis(context)) return sendError(response, 403, "Only a department leader, HR administrator, or tenant administrator can create KPIs.");
    const body = await readJson(request);
    const name = String(body.name || "").trim();
    const unit = String(body.unit || "").trim();
    const target = Number(body.target);
    const direction = String(body.direction || "higher");
    const departmentId = String(body.department_id || "");
    if (!isText(name, 2, 100) || !isText(unit, 1, 20) || !isPositive(target) ||
        !["higher", "lower"].includes(direction) ||
        !(await statements.departments.all(context.tenant_id)).some(row => row.id === departmentId)) {
      return sendError(response, 400, "Provide a KPI name, unit, non-negative target, direction, and department.");
    }
    if (await db.prepare("SELECT 1 FROM kpis WHERE tenant_id = ? AND department_id = ? AND lower(name) = lower(?)").get(context.tenant_id, departmentId, name)) {
      return sendError(response, 409, "A KPI with this name already exists in that department.");
    }
    const kpiId = id();
    await db.prepare(`INSERT INTO kpis (id,tenant_id,department_id,name,unit,target,direction,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(kpiId, context.tenant_id, departmentId, name, unit, target, direction, now());
    await audit(context, "kpi_created", "kpi", kpiId, `Created KPI ${name}.`);
    return sendJson(response, 201, { kpi: { id: kpiId, department_id: departmentId, name, unit, target, direction, actual: null } });
  }
  if (method === "GET" && path === "/api/submissions") {
    if (context.role === "platform_admin") return sendError(response, 403, "Platform administrators do not have access to performance records.");
    let rows = await statements.submissions.all(context.tenant_id);
    if (context.role === "employee" && context.employee_id) rows = rows.filter(row => row.employee_id === context.employee_id);
    if (context.role === "manager" && context.employee_id) {
      const reports = await db.prepare("SELECT id FROM employees WHERE tenant_id = ? AND manager_employee_id = ?")
        .all(context.tenant_id, context.employee_id);
      const reportIds = new Set(reports.map(row => row.id));
      rows = rows.filter(row => row.employee_id === context.employee_id || reportIds.has(row.employee_id));
    }
    if (context.role === "department_leader") rows = rows.filter(row => row.department_name === context.department_name);
    if (context.role === "executive" || context.role === "ceo") rows = [];
    return sendJson(response, 200, { submissions: rows });
  }
  if (method === "POST" && path === "/api/submissions") {
    if (context.role === "platform_admin" || context.role === "executive" || context.role === "ceo") {
      return sendError(response, 403, "Your role cannot submit performance results.");
    }
    const body = await readJson(request);
    const employee = context.employee_id
      ? await db.prepare("SELECT id,department_id,user_id FROM employees WHERE id = ? AND tenant_id = ?").get(context.employee_id, context.tenant_id)
      : null;
    let employeeId = employee?.id;
    if (["tenant_admin", "hr_admin", "manager", "department_leader"].includes(context.role) && body.employee_id) {
      employeeId = String(body.employee_id);
    }
    const targetEmployee = employeeId
      ? await db.prepare("SELECT id,department_id FROM employees WHERE id = ? AND tenant_id = ?").get(employeeId, context.tenant_id)
      : null;
    const kpiId = String(body.kpi_id || "");
    const kpi = await db.prepare("SELECT id,department_id FROM kpis WHERE id = ? AND tenant_id = ?").get(kpiId, context.tenant_id);
    const actual = Number(body.actual);
    const period = String(body.period || "").trim();
    const evidence = String(body.evidence_note || "").trim();
    if (!targetEmployee || !kpi || targetEmployee.department_id !== kpi.department_id ||
        !isPositive(actual) || !/^\d{4}-Q[1-4]$/.test(period) || !isText(evidence, 3, 500)) {
      return sendError(response, 400, "Choose an employee and their department KPI, a non-negative result, a period such as 2026-Q3, and an evidence note.");
    }
    if (context.role === "employee" && targetEmployee.id !== context.employee_id) {
      return sendError(response, 403, "Employees can submit results only for their own profile.");
    }
    const submissionId = id();
    await db.prepare(`INSERT INTO submissions (id,tenant_id,employee_id,kpi_id,period,actual,evidence_note,status,submitted_at)
      VALUES (?,?,?,?,?,?,?,'submitted',?)`).run(submissionId, context.tenant_id, employeeId, kpiId, period, actual, evidence, now());
    await audit(context, "performance_submitted", "submission", submissionId, `Submitted result for ${period}.`);
    return sendJson(response, 201, { submission: { id: submissionId, status: "submitted" } });
  }
  const submissionReview = path.match(/^\/api\/submissions\/([^/]+)\/review$/);
  if (method === "POST" && submissionReview) {
    const submissionId = decodeURIComponent(submissionReview[1]);
    const submission = await db.prepare("SELECT * FROM submissions WHERE id = ? AND tenant_id = ?").get(submissionId, context.tenant_id);
    if (!submission) return sendError(response, 404, "Submission not found.");
    if (!await canReviewSubmission(context, submission)) return sendError(response, 403, "You are not allowed to review this submission.");
    if (submission.status !== "submitted") return sendError(response, 409, "This submission has already been reviewed.");
    const body = await readJson(request);
    const decision = String(body.decision || "");
    const note = String(body.note || "").trim();
    if (!["approved", "needs_changes", "declined"].includes(decision) || !isText(note, 3, 500)) {
      return sendError(response, 400, "Choose approved, needs_changes, or declined and add a short review note.");
    }
    await db.prepare("UPDATE submissions SET status = ?, reviewed_by = ?, review_note = ? WHERE id = ? AND tenant_id = ?")
      .run(decision, context.id, note, submissionId, context.tenant_id);
    await audit(context, `submission_${decision}`, "submission", submissionId, note);
    return sendJson(response, 200, { ok: true, status: decision });
  }
  if (method === "GET" && path === "/api/nominations") {
    if (context.role === "platform_admin") return sendError(response, 403, "Platform administrators do not have access to HR nomination records.");
    let rows = await statements.nominations.all(context.tenant_id);
    if (context.role === "employee" && context.employee_id) {
      rows = rows.filter(row => row.nominee_employee_id === context.employee_id || row.nominator_user_id === context.id);
    } else if (context.role === "manager" && context.employee_id) {
      const reportRows = await db.prepare("SELECT id FROM employees WHERE tenant_id = ? AND manager_employee_id = ?")
        .all(context.tenant_id, context.employee_id);
      const reports = new Set(reportRows.map(row => row.id));
      rows = rows.filter(row => reports.has(row.nominee_employee_id));
    } else if (context.role === "department_leader") {
      rows = rows.filter(row => row.department_name === context.department_name);
    } else if (context.role === "executive") {
      rows = rows.filter(row => ["executive_shortlist", "ceo_decision", "closed"].includes(row.stage));
    } else if (context.role === "ceo") {
      rows = rows.filter(row => row.stage === "ceo_decision" || row.status === "approved" || row.status === "declined");
    }
    return sendJson(response, 200, { nominations: rows });
  }
  if (method === "POST" && path === "/api/nominations") {
    const body = await readJson(request);
    const nomineeId = String(body.nominee_employee_id || "");
    const type = String(body.type || "");
    const reason = String(body.reason || "").trim();
    const nominee = await db.prepare("SELECT id FROM employees WHERE id = ? AND tenant_id = ?").get(nomineeId, context.tenant_id);
    if (!nominee || !["impact_award", "promotion"].includes(type) || !isText(reason, 10, 1000)) {
      return sendError(response, 400, "Choose a valid employee and nomination type, and provide a reason of 10 to 1,000 characters.");
    }
    if (context.role === "employee" && nomineeId === context.employee_id) {
      return sendError(response, 400, "You cannot nominate yourself in this demo workflow.");
    }
    const nominationId = id();
    await db.prepare(`INSERT INTO nominations (id,tenant_id,nominee_employee_id,nominator_user_id,type,reason,status,stage,created_at)
      VALUES (?,?,?,?,?,?,'pending','manager_review',?)`).run(nominationId, context.tenant_id, nomineeId, context.id, type, reason, now());
    await audit(context, "nomination_submitted", "nomination", nominationId, `Submitted ${type} nomination.`);
    return sendJson(response, 201, { nomination: { id: nominationId, status: "pending", stage: "manager_review" } });
  }
  const nominationReview = path.match(/^\/api\/nominations\/([^/]+)\/review$/);
  if (method === "POST" && nominationReview) {
    const nominationId = decodeURIComponent(nominationReview[1]);
    const nomination = await db.prepare("SELECT * FROM nominations WHERE id = ? AND tenant_id = ?").get(nominationId, context.tenant_id);
    if (!nomination) return sendError(response, 404, "Nomination not found.");
    if (nomination.status !== "pending") return sendError(response, 409, "This nomination is already closed or awaiting information.");
    if (!stageRoles[nomination.stage]?.has(context.role)) return sendError(response, 403, "Your role cannot review this workflow stage.");
    if (["manager", "department_leader"].includes(context.role)) {
      const ownDepartment = await db.prepare("SELECT department_id FROM employees WHERE id = ? AND tenant_id = ?").get(nomination.nominee_employee_id, context.tenant_id);
      if (!ownDepartment || ownDepartment.department_id !== context.department_id) return sendError(response, 403, "This nomination is outside your department.");
      if (context.role === "manager") {
        const nominee = await db.prepare("SELECT manager_employee_id FROM employees WHERE id = ? AND tenant_id = ?").get(nomination.nominee_employee_id, context.tenant_id);
        if (nominee?.manager_employee_id !== context.employee_id) return sendError(response, 403, "This nomination is not for your direct report.");
      }
    }
    const body = await readJson(request);
    const decision = String(body.decision || "");
    const note = String(body.note || "").trim();
    if (!["approve", "request_info", "decline"].includes(decision) || !isText(note, 3, 500)) {
      return sendError(response, 400, "Choose approve, request_info, or decline and add a short review note.");
    }
    let status = "pending";
    let stage = nomination.stage;
    if (decision === "decline") { status = "declined"; stage = "closed"; }
    else if (decision === "request_info") { status = "needs_information"; }
    else if (nomination.stage === "ceo_decision") { status = "approved"; stage = "closed"; }
    else { stage = nextStage[nomination.stage]; }
    await db.prepare("UPDATE nominations SET status = ?, stage = ? WHERE id = ? AND tenant_id = ?")
      .run(status, stage, nominationId, context.tenant_id);
    await audit(context, `nomination_${decision}`, "nomination", nominationId, `${nomination.stage}: ${note}`);
    return sendJson(response, 200, { ok: true, status, stage });
  }
  const nominationResubmit = path.match(/^\/api\/nominations\/([^/]+)\/resubmit$/);
  if (method === "POST" && nominationResubmit) {
    const nominationId = decodeURIComponent(nominationResubmit[1]);
    const nomination = await db.prepare("SELECT * FROM nominations WHERE id = ? AND tenant_id = ?").get(nominationId, context.tenant_id);
    if (!nomination) return sendError(response, 404, "Nomination not found.");
    if (nomination.status !== "needs_information" ||
        (nomination.nominator_user_id !== context.id && context.role !== "tenant_admin" && context.role !== "hr_admin")) {
      return sendError(response, 403, "Only the nominator can update a case that needs information.");
    }
    const body = await readJson(request);
    const reason = String(body.reason || "").trim();
    if (!isText(reason, 10, 1000)) return sendError(response, 400, "Provide an updated reason of 10 to 1,000 characters.");
    await db.prepare("UPDATE nominations SET reason = ?, status = 'pending' WHERE id = ? AND tenant_id = ?")
      .run(reason, nominationId, context.tenant_id);
    await audit(context, "nomination_resubmitted", "nomination", nominationId, "Updated requested information and resubmitted.");
    return sendJson(response, 200, { ok: true, status: "pending", stage: nomination.stage });
  }
  if (method === "GET" && path === "/api/audit") {
    if (!["tenant_admin", "hr_admin"].includes(context.role)) return sendError(response, 403, "Only HR or a tenant administrator can view the audit log.");
    const events = await db.prepare(`SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at,
        u.display_name AS actor_name
      FROM audit_events a JOIN users u ON u.id = a.actor_user_id AND u.tenant_id = a.tenant_id
      WHERE a.tenant_id = ? ORDER BY a.created_at DESC LIMIT 200`).all(context.tenant_id);
    return sendJson(response, 200, { events });
  }

  return sendError(response, 404, "API route not found.");
}

await initializeDatabase();
await seedIfNeeded();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`);
    const isApi = url.pathname.startsWith("/api/");
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method || "") && request.headers.origin) {
      const expectedOrigin = `http://${request.headers.host}`;
      const secureOrigin = `https://${request.headers.host}`;
      if (request.headers.origin !== expectedOrigin && request.headers.origin !== secureOrigin) {
        return sendError(response, 403, "Cross-origin requests are not allowed.");
      }
    }
    if (isApi) return await handleApi(request, response, url);
    if (request.method !== "GET" && request.method !== "HEAD") return sendError(response, 405, "Method not allowed.");
    if (request.method === "HEAD") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return response.end();
    }
    const served = await serveStatic(url.pathname, response);
    if (!served) sendError(response, 404, "Page not found.");
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ${request.method} ${request.url}:`, error);
    if (!response.headersSent) sendError(response, error.status || 500, error.status ? error.message : "The request could not be completed.");
    else response.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Impact360 running at http://${HOST}:${PORT}`);
  console.log(`Database: ${databaseType}`);
  console.log("AI/API integrations are disabled.");
  if (process.env.NODE_ENV !== "production") {
    console.log(`Demo tenant login: admin@northstar.example.invalid / ${DEMO_PASSWORD}`);
    console.log(`Demo manager login: user001@northstar.example.invalid / ${DEMO_PASSWORD}`);
  }
});

function shutdown() {
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
