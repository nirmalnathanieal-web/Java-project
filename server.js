const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const cookieParser = require("cookie-parser");
const Database = require("better-sqlite3");

const app = express();
const port = Number(process.env.PORT) || 3000;
const sessionCookie = "mediCareSession";
const sessionDurationMs = 7 * 24 * 60 * 60 * 1000;
const dataDirectory = path.join(__dirname, "data");

fs.mkdirSync(dataDirectory, { recursive: true });

const db = new Database(path.join(dataDirectory, "medireminder.sqlite"));
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_salt BLOB NOT NULL,
    password_hash BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS medicines (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    dosage TEXT NOT NULL,
    type TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    frequency TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    taken INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'upcoming',
    PRIMARY KEY (user_id, id)
  );

  CREATE TABLE IF NOT EXISTS profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    phone TEXT NOT NULL DEFAULT '',
    dob TEXT NOT NULL DEFAULT '',
    gender TEXT NOT NULL DEFAULT '',
    blood_group TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    emergency TEXT NOT NULL DEFAULT '',
    caregiver TEXT NOT NULL DEFAULT ''
  );

  DELETE FROM sessions WHERE expires_at <= ${Date.now()};
`);

app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + sessionDurationMs;
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(crypto.createHash("sha256").update(token).digest("hex"), userId, expiresAt);
  res.cookie(sessionCookie, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionDurationMs
  });
}

function requireSession(req, res, next) {
  const token = req.cookies[sessionCookie];
  if (!token) return sendError(res, 401, "Please log in to continue.");

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const session = db.prepare(`
    SELECT users.id, users.email, users.name
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(tokenHash, Date.now());

  if (!session) {
    res.clearCookie(sessionCookie, { httpOnly: true, sameSite: "strict", path: "/" });
    return sendError(res, 401, "Your session has expired. Please log in again.");
  }

  req.user = session;
  next();
}

function requirePageSession(req, res, next) {
  const token = req.cookies[sessionCookie];
  if (!token) return res.redirect("/login.html");

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const session = db.prepare("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?")
    .get(tokenHash, Date.now());
  if (!session) {
    res.clearCookie(sessionCookie, { httpOnly: true, sameSite: "strict", path: "/" });
    return res.redirect("/login.html");
  }
  next();
}

function hashPassword(password, salt = crypto.randomBytes(16)) {
  return {
    salt,
    hash: crypto.scryptSync(password, salt, 64)
  };
}

function isValidEmail(email) {
  return typeof email === "string"
    && email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getProfile(userId, name, email) {
  const saved = db.prepare("SELECT * FROM profiles WHERE user_id = ?").get(userId);
  return {
    name,
    email,
    phone: saved?.phone || "",
    dob: saved?.dob || "",
    gender: saved?.gender || "",
    bloodGroup: saved?.blood_group || "",
    address: saved?.address || "",
    emergency: saved?.emergency || "",
    caregiver: saved?.caregiver || ""
  };
}

function validateMedicineList(medicines) {
  if (!Array.isArray(medicines) || medicines.length > 500) return null;

  const fields = ["id", "name", "dosage", "type", "date", "time", "frequency"];
  const normalized = [];
  for (const medicine of medicines) {
    if (!medicine || typeof medicine !== "object" || Array.isArray(medicine)) return null;
    for (const field of fields) {
      if (typeof medicine[field] !== "string" || medicine[field].trim() === "") return null;
    }
    if (medicine.id.length > 80
      || medicine.name.length > 120
      || medicine.dosage.length > 80
      || medicine.type.length > 40
      || medicine.frequency.length > 80
      || !/^\d{4}-\d{2}-\d{2}$/.test(medicine.date)
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(medicine.time)) {
      return null;
    }
    if (medicine.notes !== undefined && (typeof medicine.notes !== "string" || medicine.notes.length > 2000)) {
      return null;
    }
    normalized.push({
      id: medicine.id,
      name: medicine.name.trim(),
      dosage: medicine.dosage.trim(),
      type: medicine.type.trim(),
      date: medicine.date,
      time: medicine.time,
      frequency: medicine.frequency.trim(),
      notes: medicine.notes || "",
      taken: medicine.taken === true,
      status: medicine.taken === true ? "taken" : ["missed", "upcoming"].includes(medicine.status) ? medicine.status : "upcoming"
    });
  }
  return normalized;
}

function validateProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
  const fields = ["name", "phone", "dob", "gender", "bloodGroup", "address", "emergency", "caregiver"];
  const limits = { name: 120, phone: 40, dob: 10, gender: 40, bloodGroup: 10, address: 1000, emergency: 40, caregiver: 120 };
  for (const field of fields) {
    const value = profile[field] ?? "";
    if (typeof value !== "string" || value.length > limits[field]) return null;
  }
  return Object.fromEntries(fields.map((field) => [field, (profile[field] || "").trim()]));
}

app.post("/api/register", (req, res) => {
  const body = req.body || {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = body.password;
  if (!name || name.length > 120 || !isValidEmail(email) || typeof password !== "string" || password.length < 8 || password.length > 128) {
    return sendError(res, 400, "Enter a name, valid email, and password of at least 8 characters.");
  }

  const credentials = hashPassword(password);
  try {
    const createUser = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO users (email, name, password_salt, password_hash, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(email, name, credentials.salt, credentials.hash, Date.now());
      db.prepare("INSERT INTO profiles (user_id) VALUES (?)").run(result.lastInsertRowid);
      return result.lastInsertRowid;
    });
    const userId = createUser();
    createSession(res, userId);
    return res.status(201).json({ user: { id: userId, email, name } });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return sendError(res, 409, "An account with this email already exists.");
    }
    console.error("Account registration failed:", error);
    return sendError(res, 500, "Could not create the account.");
  }
});

app.post("/api/login", (req, res) => {
  const body = req.body || {};
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const user = db.prepare("SELECT id, email, name, password_salt, password_hash FROM users WHERE email = ?").get(email);
  if (!user || password.length > 128) return sendError(res, 401, "Invalid email or password.");

  const candidate = hashPassword(password, user.password_salt).hash;
  if (!crypto.timingSafeEqual(candidate, user.password_hash)) return sendError(res, 401, "Invalid email or password.");

  createSession(res, user.id);
  return res.json({ user: { id: user.id, email: user.email, name: user.name } });
});

app.post("/api/logout", (req, res) => {
  const token = req.cookies[sessionCookie];
  if (token) {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }
  res.clearCookie(sessionCookie, { httpOnly: true, sameSite: "strict", path: "/" });
  return res.status(204).end();
});

app.get("/api/session", requireSession, (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name } });
});

app.get("/api/data", requireSession, (req, res) => {
  const medicines = db.prepare(`
    SELECT id, name, dosage, type, date, time, frequency, notes, taken, status
    FROM medicines WHERE user_id = ? ORDER BY date, time
  `).all(req.user.id).map((medicine) => ({ ...medicine, taken: Boolean(medicine.taken) }));
  res.json({ medicines, profile: getProfile(req.user.id, req.user.name, req.user.email) });
});

app.put("/api/data", requireSession, (req, res) => {
  const body = req.body || {};
  const medicines = validateMedicineList(body.medicines);
  const profile = validateProfile(body.profile);
  if (!medicines || !profile) return sendError(res, 400, "The medicine or profile data is invalid.");

  const saveData = db.transaction(() => {
    const updateUser = db.prepare("UPDATE users SET name = ? WHERE id = ?");
    updateUser.run(profile.name || req.user.name, req.user.id);

    db.prepare("DELETE FROM medicines WHERE user_id = ?").run(req.user.id);
    const insertMedicine = db.prepare(`
      INSERT INTO medicines (user_id, id, name, dosage, type, date, time, frequency, notes, taken, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const medicine of medicines) {
      insertMedicine.run(
        req.user.id,
        medicine.id,
        medicine.name,
        medicine.dosage,
        medicine.type,
        medicine.date,
        medicine.time,
        medicine.frequency,
        medicine.notes,
        Number(medicine.taken),
        medicine.status
      );
    }

    db.prepare(`
      UPDATE profiles
      SET phone = ?, dob = ?, gender = ?, blood_group = ?, address = ?, emergency = ?, caregiver = ?
      WHERE user_id = ?
    `).run(
      profile.phone,
      profile.dob,
      profile.gender,
      profile.bloodGroup,
      profile.address,
      profile.emergency,
      profile.caregiver,
      req.user.id
    );
  });

  try {
    saveData();
  } catch (error) {
    console.error("Saving account data failed:", error);
    return sendError(res, 500, "Could not save your data.");
  }
  res.json({ ok: true });
});

app.get("/", requirePageSession, (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/index.html", requirePageSession, (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/profile.html", requirePageSession, (req, res) => res.redirect("/index.html"));
app.get("/dashboard.html", requirePageSession, (req, res) => res.redirect("/index.html"));
app.get("/history.html", requirePageSession, (req, res) => res.redirect("/index.html"));
app.get("/login.html", (req, res) => res.sendFile(path.join(__dirname, "login.html")));
app.get("/script.js", (req, res) => res.sendFile(path.join(__dirname, "script.js")));
app.get("/style.css", (req, res) => res.sendFile(path.join(__dirname, "style.css")));
app.use((req, res) => sendError(res, 404, "Not found."));

app.listen(port, "127.0.0.1", () => {
  console.log(`MediReminder is running at http://localhost:${port}`);
});
