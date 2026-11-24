
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

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

let walletsMemory = networks.map((name) => ({
  network_name: name,
  wallet_address: "",
  status: "En attente de configuration"
}));

function checkAdmin(req, res, next) {
  const password = req.headers["x-admin-password"];
  const expected = process.env.ADMIN_PASSWORD || "MadaLucky2026!";
  if (!password || password !== expected) {
    return res.status(401).json({ error: "Mot de passe incorrect" });
  }
  next();
}

app.get("/api/status", (req, res) => {
  res.json({ platform: "MADA LUCKY INTERNATIONAL JEUX", status: "online" });
});

app.get("/api/admin/wallets", checkAdmin, (req, res) => {
  res.json(walletsMemory);
});

app.put("/api/admin/wallets", checkAdmin, (req, res) => {
  const wallets = req.body.wallets;
  if (!Array.isArray(wallets)) return res.status(400).json({ error: "Donnees invalides" });
  for (const w of wallets) {
    const found = walletsMemory.find(x => x.network_name === w.network_name);
    if (found) { found.wallet_address = w.wallet_address; found.status = w.status; }
  }
  res.json({ success: true, message: "Adresses sauvegardees" });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
