import express from "express";
import Stripe from "stripe";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export function registerStripeWebhook(app: express.Application) {
  // MUST be registered BEFORE express.json() middleware
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key || "", {
        apiVersion: "2024-12-18.acacia" as any,
      });

      const sig = req.headers["stripe-signature"] as string;
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      let event: Stripe.Event;

      try {
        if (webhookSecret) {
          event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        } else {
          // In dev without webhook secret, parse directly
          event = JSON.parse(req.body.toString()) as Stripe.Event;
        }
      } catch (err: any) {
        console.error("[Stripe Webhook] Signature verification failed:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      // Handle test events
      if (event.id.startsWith("evt_test_")) {
        console.log("[Stripe Webhook] Test event detected");
        return res.json({ verified: true });
      }

      const db = await getDb();
      if (!db) return res.status(500).json({ error: "DB not available" });

      try {
        switch (event.type) {
          case "checkout.session.completed": {
            const session = event.data.object as Stripe.Checkout.Session;
            const userId = parseInt(session.metadata?.user_id || session.client_reference_id || "0");
            const planId = session.metadata?.plan_id || "pro";
            const customerId = session.customer as string;

            if (userId) {
              await db.update(users).set({
                stripeCustomerId: customerId,
                plan: planId as any,
              }).where(eq(users.id, userId));
              console.log(`[Stripe] User ${userId} upgraded to ${planId}`);
            }
            break;
          }

          case "customer.subscription.updated": {
            const subscription = event.data.object as Stripe.Subscription;
            const customerId = subscription.customer as string;

            if (subscription.status === "active") {
              // Plan stays active
            } else if (subscription.status === "canceled" || subscription.status === "unpaid") {
              // Downgrade to free
              const [user] = await db.select().from(users).where(eq(users.stripeCustomerId, customerId));
              if (user) {
                await db.update(users).set({ plan: "free" }).where(eq(users.id, user.id));
                console.log(`[Stripe] User ${user.id} downgraded to free (subscription ${subscription.status})`);
              }
            }
            break;
          }

          case "customer.subscription.deleted": {
            const subscription = event.data.object as Stripe.Subscription;
            const customerId = subscription.customer as string;
            const [user] = await db.select().from(users).where(eq(users.stripeCustomerId, customerId));
            if (user) {
              await db.update(users).set({ plan: "free" }).where(eq(users.id, user.id));
              console.log(`[Stripe] User ${user.id} subscription deleted, downgraded to free`);
            }
            break;
          }

          default:
            console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
        }
      } catch (err) {
        console.error("[Stripe Webhook] Error processing event:", err);
      }

      res.json({ received: true });
    }
  );
}
