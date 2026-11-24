const express = require("express");
const helmet = require("helmet");
const path = require("path");
const { Pool } = require("pg");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

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

function checkAdmin(req, res, next) {
  const password = req.headers["x-admin-password"];
  const expected = process.env.ADMIN_PASSWORD;

  if (!expected || typeof password !== "string") {
    return res.status(401).json({ error: "Accès refusé" });
  }

  const a = Buffer.from(password);
  const b = Buffer.from(expected);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Mot de passe incorrect" });
  }

  next();
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crypto_wallets (
      id SERIAL PRIMARY KEY,
      network_name VARCHAR(100) UNIQUE NOT NULL,
      wallet_address TEXT NOT NULL DEFAULT '',
      status VARCHAR(30) NOT NULL DEFAULT 'En attente de configuration',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  for (const name of networks) {
    await pool.query(
      `INSERT INTO crypto_wallets (network_name)
       VALUES ($1)
       ON CONFLICT (network_name) DO NOTHING`,
      [name]
    );
  }

  console.log("Wallet database ready");
}

app.get("/api/status", (req, res) => {
  res.json({
    platform: "MADA LUCKY INTERNATIONAL JEUX",
    status: "online"
  });
});

app.get("/api/admin/wallets", checkAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT network_name, wallet_address, status
       FROM crypto_wallets ORDER BY id ASC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.put("/api/admin/wallets", checkAdmin, async (req, res) => {
  const wallets = req.body.wallets;

  if (!Array.isArray(wallets) || wallets.length > networks.length) {
    return res.status(400).json({ error: "Données invalides" });
  }

  const allowedStatuses = [
    "En attente de configuration",
    "Activé",
    "Désactivé"
  ];

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const wallet of wallets) {
      if (
        !networks.includes(wallet.network_name) ||
        typeof wallet.wallet_address !== "string" ||
        wallet.wallet_address.length > 300 ||
        !allowedStatuses.includes(wallet.status)
      ) {
        throw new Error("Données invalides");
      }

      await client.query(
        `UPDATE crypto_wallets
         SET wallet_address = $1,
             status = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE network_name = $3`,
        [
          wallet.wallet_address.trim(),
          wallet.status,
          wallet.network_name
        ]
      );
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Adresses sauvegardées"
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(400).json({ error: "Impossible de sauvegarder" });
  } finally {
    client.release();
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

initializeDatabase()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(error => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });
