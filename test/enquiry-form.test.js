import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createSmtpServer } from "node:net";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const smtpPort = 18281;
const appPort = 18282;

function startMockSmtp(messages) {
  return createSmtpServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("220 localhost STC Mitra test SMTP\r\n");
    let buffer = "";
    let dataMode = false;
    let message = "";

    socket.on("data", (chunk) => {
      buffer += chunk;

      if (dataMode) {
        const endIndex = buffer.indexOf("\r\n.\r\n");
        if (endIndex < 0) return;
        message += buffer.slice(0, endIndex);
        messages.push(message);
        buffer = buffer.slice(endIndex + 5);
        dataMode = false;
        message = "";
        socket.write("250 2.0.0 queued\r\n");
      }

      while (!dataMode) {
        const lineEnd = buffer.indexOf("\r\n");
        if (lineEnd < 0) break;
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        const command = line.split(/\s+/, 1)[0].toUpperCase();

        if (command === "EHLO" || command === "HELO") {
          socket.write("250-localhost\r\n250 PIPELINING\r\n");
        } else if (command === "DATA") {
          dataMode = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (command === "QUIT") {
          socket.write("221 2.0.0 closing connection\r\n");
          socket.end();
        } else {
          socket.write("250 2.0.0 OK\r\n");
        }
      }
    });
  });
}

function waitForListening(process) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Test server did not start")), 5000);
    process.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("listening")) return;
      clearTimeout(timer);
      resolve();
    });
    process.once("error", reject);
  });
}

test("enquiry endpoint validates, rate-limits and delivers through configured SMTP", async (context) => {
  const messages = [];
  const smtpServer = startMockSmtp(messages);
  await new Promise((resolve, reject) => {
    smtpServer.once("error", reject);
    smtpServer.listen(smtpPort, "127.0.0.1", resolve);
  });
  context.after(() => new Promise((resolve) => smtpServer.close(resolve)));

  const app = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(appPort),
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(smtpPort),
      SMTP_SECURE: "false",
      SMTP_FROM: "STC Mitra website <website@stc-mitra.com>",
      ENQUIRY_TO: "info@stc-mitra.com",
      ENQUIRY_RATE_LIMIT: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  context.after(() => app.kill());
  await waitForListening(app);

  const pageResponse = await fetch(`http://127.0.0.1:${appPort}/`);
  const pageHtml = await pageResponse.text();
  assert.equal(pageResponse.status, 200);
  assert.equal((pageHtml.match(/<script[^>]+src=["']\/?assets\/site\.js(?:\?[^"']*)?["'][^>]*>/gi) || []).length, 1);

  const validPayload = {
    name: "Site Engineer",
    company: "Project Team",
    email: "engineer@example.com",
    phone: "+998 90 000 00 00",
    project: "Test Tower",
    message: "Verify an as-built column offset before the next concrete pour.",
    website: ""
  };
  const response = await fetch(`http://127.0.0.1:${appPort}/api/enquiries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validPayload)
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Test Tower/);
  assert.match(messages[0], /engineer@example\.com/);
  assert.match(messages[0], /as-built column offset/);

  const repeated = await fetch(`http://127.0.0.1:${appPort}/api/enquiries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validPayload)
  });
  assert.equal(repeated.status, 429);
  assert.equal(messages.length, 1);

  const invalid = await fetch(`http://127.0.0.1:${appPort}/api/enquiries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "", email: "invalid", message: "" })
  });
  const invalidPayload = await invalid.json();
  assert.equal(invalid.status, 422);
  assert.ok(invalidPayload.fields.name);
  assert.ok(invalidPayload.fields.email);
  assert.ok(invalidPayload.fields.message);

  const honeypot = await fetch(`http://127.0.0.1:${appPort}/api/enquiries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...validPayload, website: "https://spam.invalid" })
  });
  assert.equal(honeypot.status, 200);
  assert.equal(messages.length, 1);
});
