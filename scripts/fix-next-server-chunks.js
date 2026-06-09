const fs = require("fs");
const path = require("path");

const serverDir = path.join(process.cwd(), ".next", "server");
const chunksDir = path.join(serverDir, "chunks");

if (!fs.existsSync(serverDir) || !fs.existsSync(chunksDir)) {
  process.exit(0);
}

for (const entry of fs.readdirSync(chunksDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
  const source = path.join(chunksDir, entry.name);
  const target = path.join(serverDir, entry.name);
  fs.copyFileSync(source, target);
}

