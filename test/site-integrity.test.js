import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

async function collectHtmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectHtmlFiles(fullPath));
    if (entry.isFile() && entry.name.endsWith(".html")) files.push(fullPath);
  }
  return files;
}

const htmlFiles = await collectHtmlFiles(root);

test("local links and assets point to existing files", async () => {
  const missing = [];
  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    for (const match of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
      const reference = match[1];
      if (/^(?:https?:|mailto:|tel:|#|data:)/i.test(reference)) continue;
      const pathname = reference.split(/[?#]/)[0];
      if (!pathname) continue;
      const target = path.resolve(path.dirname(file), pathname);
      try {
        if (!(await stat(target)).isFile()) missing.push(`${path.relative(root, file)} -> ${reference}`);
      } catch {
        missing.push(`${path.relative(root, file)} -> ${reference}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("each public page has one h1 and no duplicate ids", async () => {
  const problems = [];
  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    const h1Count = (html.match(/<h1\b/gi) || []).length;
    if (h1Count !== 1) problems.push(`${path.relative(root, file)}: h1=${h1Count}`);

    const ids = [...html.matchAll(/\bid=["']([^"']+)["']/gi)].map((match) => match[1]);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicates.length) problems.push(`${path.relative(root, file)}: duplicate ids ${[...new Set(duplicates)].join(", ")}`);
  }
  assert.deepEqual(problems, []);
});
