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

test("local fragment links point to existing section ids", async () => {
  const broken = [];
  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    for (const match of html.matchAll(/\bhref=["']([^"']*#[^"']+)["']/gi)) {
      const reference = match[1];
      if (/^https?:/i.test(reference)) continue;
      const [pathname, fragment] = reference.split("#", 2);
      if (!fragment) continue;
      const target = pathname ? path.resolve(path.dirname(file), pathname) : file;
      try {
        const targetHtml = await readFile(target, "utf8");
        const escapedFragment = fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (!new RegExp(`\\bid=["']${escapedFragment}["']`, "i").test(targetHtml)) {
          broken.push(`${path.relative(root, file)} -> ${reference}`);
        }
      } catch {
        broken.push(`${path.relative(root, file)} -> ${reference}`);
      }
    }
  }
  assert.deepEqual(broken, []);
});

test("all pages expose consistent navigation and complete social metadata", async () => {
  const problems = [];
  const requiredLabels = ["Projects", "Specialisms", "Services", "Track record", "Site issues", "Contact"];
  const requiredHeadPatterns = [
    /<title>[^<]+<\/title>/i,
    /<meta name=["']description["'] content=["'][^"']+["']>/i,
    /<link rel=["']canonical["'] href=["']https:\/\/stc-mitra\.com\//i,
    /<meta property=["']og:title["'] content=["'][^"']+["']>/i,
    /<meta property=["']og:description["'] content=["'][^"']+["']>/i,
    /<meta property=["']og:url["'] content=["']https:\/\/stc-mitra\.com\//i,
    /<meta property=["']og:image["'] content=["']https:\/\/stc-mitra\.com\//i
  ];

  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    const relative = path.relative(root, file).split(path.sep).join("/");
    const expectedUrl = `https://stc-mitra.com/${relative === "index.html" ? "" : relative}`;
    const nav = html.match(/<nav class=["']nav["'][^>]*>([\s\S]*?)<\/nav>/i)?.[1] || "";
    for (const label of requiredLabels) {
      if (!nav.includes(`>${label}<`)) {
        problems.push(`${path.relative(root, file)}: navigation missing ${label}`);
      }
    }
    for (const pattern of requiredHeadPatterns) {
      if (!pattern.test(html)) {
        problems.push(`${path.relative(root, file)}: missing ${pattern}`);
      }
    }
    const canonical = html.match(/<link rel=["']canonical["'] href=["']([^"']+)["']>/i)?.[1];
    const ogUrl = html.match(/<meta property=["']og:url["'] content=["']([^"']+)["']>/i)?.[1];
    if (canonical !== expectedUrl) problems.push(`${relative}: canonical ${canonical} != ${expectedUrl}`);
    if (ogUrl !== expectedUrl) problems.push(`${relative}: og:url ${ogUrl} != ${expectedUrl}`);
  }
  assert.deepEqual(problems, []);
});

test("lazy-loaded project images declare intrinsic dimensions", async () => {
  const missing = [];
  for (const page of ["index.html", "projects.html"]) {
    const html = await readFile(path.join(root, page), "utf8");
    for (const match of html.matchAll(/<img\b[^>]*\bloading=["']lazy["'][^>]*>/gi)) {
      if (!/\bwidth=["']\d+["']/i.test(match[0]) || !/\bheight=["']\d+["']/i.test(match[0])) {
        missing.push(`${page}: ${match[0]}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("homepage exposes exactly eight selected projects and full portfolio remains filterable without JavaScript", async () => {
  const homepage = await readFile(path.join(root, "index.html"), "utf8");
  const projects = await readFile(path.join(root, "projects.html"), "utf8");

  const selectedProjects =
    homepage.split('<div class="experience-gallery experience-gallery-featured">')[1]?.split('<div class="projects-actions">')[0] || "";
  assert.equal((selectedProjects.match(/<article\b/gi) || []).length, 8);
  assert.equal((projects.match(/\bdata-project-category=["'][^"']+["']/gi) || []).length, 19);
  assert.equal((projects.match(/\bdata-project-filter=["'][^"']+["']/gi) || []).length, 8);
  assert.doesNotMatch(projects, /<article[^>]+\bdata-project-category=[^>]+\bhidden\b/i);
  assert.match(homepage, /href=["']projects\.html["'][^>]*>View all projects</i);
});

test("public pages provide a skip link and main target", async () => {
  const problems = [];
  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    if (!/<a class=["']skip-link["'] href=["']#main-content["']>/i.test(html)) {
      problems.push(`${path.relative(root, file)}: missing skip link`);
    }
    if (!/<main\b[^>]*\bid=["']main-content["']/i.test(html)) {
      problems.push(`${path.relative(root, file)}: missing main target`);
    }
  }
  assert.deepEqual(problems, []);
});

test("sitemap contains every indexable HTML page and excludes noindex pages", async () => {
  const sitemap = await readFile(path.join(root, "sitemap.xml"), "utf8");
  const listed = new Set([...sitemap.matchAll(/<loc>https:\/\/stc-mitra\.com\/([^<]*)<\/loc>/gi)]
    .map((match) => match[1] || "index.html"));
  const expected = new Set();
  const noindex = [];

  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (/<meta name=["']robots["'] content=["'][^"']*noindex/i.test(html)) {
      noindex.push(relative);
    } else {
      expected.add(relative);
    }
  }

  assert.deepEqual([...listed].sort(), [...expected].sort());
  for (const relative of noindex) assert.equal(listed.has(relative), false);
});
