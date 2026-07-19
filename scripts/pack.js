/**
 * 打包扩展为 xpi / zip / jar。
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "manifest.json"), "utf8")
);
const version = manifest.version;
const dist = path.join(root, "dist");
const stage = path.join(dist, "_stage");
const INCLUDE = ["manifest.json", "README.md", "_locales", "src"];

/**
 * 递归复制文件或目录。
 * @param {string} src 源路径
 * @param {string} dest 目标路径
 */
function copyRecursive(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

/**
 * 删除目录。
 * @param {string} dir 目录
 */
function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

rmrf(stage);
fs.mkdirSync(stage, { recursive: true });
fs.mkdirSync(dist, { recursive: true });

for (const rel of INCLUDE) {
  const from = path.join(root, rel);
  if (!fs.existsSync(from)) continue;
  copyRecursive(from, path.join(stage, rel));
}

const base = "thunderbird-translate-" + version;
const zipPath = path.join(dist, base + ".zip");
const xpiPath = path.join(dist, base + ".xpi");
const jarPath = path.join(dist, base + ".jar");

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const ps =
  "$ErrorActionPreference='Stop';" +
  "if (Test-Path -LiteralPath " + q(zipPath) + ") { Remove-Item -LiteralPath " + q(zipPath) + " -Force };" +
  "Compress-Archive -Path (Join-Path " + q(stage) + " '*') -DestinationPath " + q(zipPath) + " -Force";

execFileSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "inherit" });
fs.copyFileSync(zipPath, xpiPath);
fs.copyFileSync(zipPath, jarPath);
rmrf(stage);

console.log("已生成:");
console.log(" -", xpiPath);
console.log(" -", zipPath);
console.log(" -", jarPath);
