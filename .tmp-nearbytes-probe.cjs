const fs = require("fs");
const path = require("path");
const sessionPath = path.join(process.env.HOME || process.env.USERPROFILE, ".nearbytes", "desktop-session.json");
const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
const endpoint = process.argv[2];
const outPath = process.argv[3];
const bodyArg = process.argv[4];
(async () => {
  try {
    const init = {
      method: bodyArg ? "POST" : "GET",
      headers: {
        "x-nearbytes-desktop-token": session.token,
      },
    };
    if (bodyArg) {
      init.headers["content-type"] = "application/json";
      init.body = bodyArg;
    }
    const response = await fetch(`http://127.0.0.1:${session.port}${endpoint}`, init);
    const text = await response.text();
    fs.writeFileSync(outPath, JSON.stringify({ ok: response.ok, status: response.status, text }, null, 2));
  } catch (error) {
    fs.writeFileSync(outPath, JSON.stringify({ error: String(error && error.stack || error) }, null, 2));
    process.exitCode = 1;
  }
})();
