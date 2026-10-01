// Node 24.11 `fs.rmSync(..., { recursive: true })` crashes on Windows paths with
// non-ASCII characters (e.g. D:\個人專案\...), and Vite's emptyOutDir uses it.
// Delete dist/ with non-recursive calls instead.
import fs from "node:fs";
import path from "node:path";

function remove(target) {
  if (!fs.existsSync(target)) return;
  if (fs.lstatSync(target).isDirectory()) {
    for (const entry of fs.readdirSync(target)) remove(path.join(target, entry));
    fs.rmdirSync(target);
  } else {
    fs.unlinkSync(target);
  }
}

remove(path.resolve(import.meta.dirname, "..", "dist"));
