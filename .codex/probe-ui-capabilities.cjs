const fs = require("fs");
const path = require("path");
const p = path.join(process.env.HOME || process.env.USERPROFILE, ".nearbytes", "desktop-session.json");
const s = JSON.parse(fs.readFileSync(p, "utf8"));
const out = path.join(process.cwd(), ".codex", "ui-capabilities-probe.json");
const url = "http://127.0.0.1:" + s.port + "/__debug/ui/capabilities";
(async () => {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  try {
    const response = await fetch(url, { headers: { "x-nearbytes-desktop-token": s.token } });
    fs.writeFileSync(out, JSON.stringify({ ok: response.ok, status: response.status, text: await response.text() }, null, 2));
  } catch (error) {
    fs.writeFileSync(out, JSON.stringify({ error: error && error.stack || String(error) }, null, 2));
    process.exit(1);
  }
})();
