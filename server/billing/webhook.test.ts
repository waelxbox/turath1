import express from "express";
import Stripe from "stripe";
import type { Server } from "node:http";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
const { sync } = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock("./stripe", async original => ({
  ...(await original<any>()),
  syncCustomer: sync,
}));
import { registerStripeWebhook } from "./webhook";
let server: Server;
let url: string;
const secret = "whsec_test_fixture";
const stripe = new Stripe("sk_test_fixture");
beforeAll(async () => {
  const app = express();
  registerStripeWebhook(app);
  app.use(express.json());
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  url = `http://127.0.0.1:${address.port}/api/stripe/webhook`;
});
afterAll(async () => {
  if (server?.listening)
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  vi.unstubAllEnvs();
});
beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
  sync.mockReset();
  sync.mockResolvedValue(undefined);
});
async function send(type = "invoice.paid", signature = true) {
  const body = JSON.stringify({
    id: "evt_test_fixture",
    type,
    data: { object: { customer: "cus_fixture" } },
  });
  const header = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret,
  });
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "stripe-signature": header } : {}),
    },
    body,
  });
}
describe("payment webhook boundary", () => {
  it("rejects unsigned requests and absent signing configuration", async () => {
    expect((await send("invoice.paid", false)).status).toBe(400);
    expect(sync).not.toHaveBeenCalled();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect((await send()).status).toBe(503);
  });
  it("reconciles even test-prefixed events after verification", async () => {
    expect((await send()).status).toBe(200);
    expect(sync).toHaveBeenCalledWith("cus_fixture");
  });
  it("returns failure so Stripe retries database/provider errors", async () => {
    sync.mockRejectedValue(new Error("database offline"));
    expect((await send()).status).toBe(500);
  });
  it("ignores unrelated events", async () => {
    expect((await send("payment_intent.created")).status).toBe(200);
    expect(sync).not.toHaveBeenCalled();
  });
});
