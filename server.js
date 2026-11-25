
const express = require("express");
const helmet = require("helmet");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) {
  throw new Error("ADMIN_PASSWORD and SESSION_SECRET are required");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});

app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
  store: new PgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000
  }
}));

const networks = [
  "T.BEP20 - USD",
  "T.TRC20 - USD",
  "BNB",
  "TRX",
  "S.BEP20 - USD",
  "T.POLYGON - USD",
  "T.ETH - USD",
  "S.POLYGON - USD",
  "S.ETH - USD",
  "ETH",
  "POLYGON",
  "ETH - PYUSD"
];

function requireUser(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Connexion requise" });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: "Accès administrateur refusé" });
  }
  next();
}

function validText(value, max = 1000) {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max;
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(60) UNIQUE NOT NULL,
      email VARCHAR(150) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS wallet_addresses (
      id SERIAL PRIMARY KEY,
      network_name VARCHAR(100) UNIQUE NOT NULL,
      wallet_address TEXT NOT NULL DEFAULT '',
      status VARCHAR(100) NOT NULL DEFAULT 'En attente de configuration',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS deposit_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      amount NUMERIC(18,2) NOT NULL,
      currency VARCHAR(10) NOT NULL,
      payment_reference TEXT DEFAULT '',
      status VARCHAR(30) DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      amount_usd NUMERIC(18,2) NOT NULL,
      currency VARCHAR(10) NOT NULL,
      destination TEXT NOT NULL,
      status VARCHAR(30) DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      subject VARCHAR(200) NOT NULL,
      message TEXT NOT NULL,
      admin_reply TEXT DEFAULT '',
      status VARCHAR(30) DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS exchange_rates (
      currency VARCHAR(10) PRIMARY KEY,
      deposit_rate NUMERIC(18,6) NOT NULL,
      withdrawal_rate NUMERIC(18,6) NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      details TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  for (const name of networks) {
    await pool.query(
      `INSERT INTO wallet_addresses
       (network_name, wallet_address, status)
       VALUES ($1, '', 'En attente de configuration')
       ON CONFLICT (network_name) DO NOTHING`,
      [name]
    );
  }

  await pool.query(`
    INSERT INTO exchange_rates
      (currency, deposit_rate, withdrawal_rate)
    VALUES ('MGA', 4500, 4200)
    ON CONFLICT (currency) DO NOTHING
  `);

  await pool.query(`
    INSERT INTO exchange_rates
      (currency, deposit_rate, withdrawal_rate)
    VALUES ('USD', 1, 1)
    ON CONFLICT (currency) DO NOTHING
  `);
}

async function logAction(action, details = "") {
  await pool.query(
    "INSERT INTO audit_logs (action, details) VALUES ($1, $2)",
    [action, details]
  );
}

// STATUS
app.get("/api/status", (req, res) => {
  res.json({
    platform: "MAD LUCKY JEUX",
    status: "online"
  });
});

// REGISTER
app.post("/api/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!validText(username, 60) ||
        !validText(email, 150) ||
        !validText(password, 100) ||
        password.length < 8) {
      return res.status(400).json({
        error: "Fenoy tsara ny formulaire. Mot de passe 8 caractères farafahakeliny."
      });
    }

    const hash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email`,
      [username.trim(), email.trim().toLowerCase(), hash]
    );

    req.session.userId = result.rows[0].id;

    res.json({
      success: true,
      user: result.rows[0]
    });

  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "Efa ampiasain'olona io email na username io."
      });
    }
    console.error(error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// LOGIN
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!validText(email, 150) || !validText(password, 100)) {
      return res.status(400).json({ error: "Données invalides" });
    }

    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email.trim().toLowerCase()]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: "Identifiants incorrects" });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ error: "Identifiants incorrects" });
    }

    req.session.userId = user.id;

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// CURRENT USER
app.get("/api/me", requireUser, async (req, res) => {
  const result = await pool.query(
    "SELECT id, username, email, created_at FROM users WHERE id = $1",
    [req.session.userId]
  );

  if (!result.rows.length) {
    return res.status(404).json({ error: "Utilisateur introuvable" });
  }

  res.json(result.rows[0]);
});

// LOGOUT
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

// WALLET LIST - PUBLIC ADDRESSES ONLY
app.get("/api/wallets", async (req, res) => {
  const result = await pool.query(
    `SELECT network_name, wallet_address, status
     FROM wallet_addresses ORDER BY id`
  );
  res.json(result.rows);
});

// MEMBER DEPOSIT REQUEST
app.post("/api/deposit", requireUser, async (req, res) => {
  try {
    const { amount, currency, reference } = req.body;
    const value = Number(amount);

    if (!Number.isFinite(value) || value < 1 ||
        value > 100000000 ||
        !validText(currency, 10)) {
      return res.status(400).json({ error: "Montant na devise tsy mety" });
    }

    const result = await pool.query(
      `INSERT INTO deposit_requests
       (user_id, amount, currency, payment_reference)
       VALUES ($1, $2, $3, $4)
       RETURNING id, amount,
