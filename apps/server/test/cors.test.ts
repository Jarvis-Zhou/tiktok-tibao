import assert from "node:assert/strict";
import test from "node:test";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { corsOptionsDelegate } from "../src/cors.js";
import { handleVideoRouteError } from "../src/video/routes.js";

async function createTestApp() {
  const app = Fastify();
  await app.register(cors, { delegator: corsOptionsDelegate });
  app.setErrorHandler(handleVideoRouteError);
  app.post("/probe", async () => ({ ok: true }));
  return app;
}

test("CORS allows an HTTP origin matching the request Host", async (t) => {
  const app = await createTestApp();
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/probe",
    headers: {
      host: "10.37.103.221:3210",
      origin: "http://10.37.103.221:3210",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["access-control-allow-origin"], "http://10.37.103.221:3210");
});

test("CORS rejects a remote origin that does not match the request Host", async (t) => {
  const app = await createTestApp();
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/probe",
    headers: {
      host: "10.37.103.221:3210",
      origin: "https://attacker.example",
    },
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json().error, {
    code: "CORS_ORIGIN_FORBIDDEN",
    message: "Origin not allowed",
    retryable: false,
  });
});

test("CORS keeps localhost, Chrome extension, and non-browser requests working", async (t) => {
  const app = await createTestApp();
  t.after(() => app.close());

  for (const origin of ["http://localhost:5173", "chrome-extension://abcdefghijklmnopabcdefghijklmnop"]) {
    const response = await app.inject({
      method: "POST",
      url: "/probe",
      headers: { host: "127.0.0.1:3210", origin },
    });
    assert.equal(response.statusCode, 200, origin);
    assert.equal(response.headers["access-control-allow-origin"], origin);
  }

  const response = await app.inject({ method: "POST", url: "/probe" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["access-control-allow-origin"], undefined);
});

test("CORS rejects malformed origins", async (t) => {
  const app = await createTestApp();
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/probe",
    headers: { host: "10.37.103.221:3210", origin: "not a URL" },
  });

  assert.equal(response.statusCode, 403);
});
