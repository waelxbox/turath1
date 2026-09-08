import express from "express";
import { getStripe, syncCustomer } from "./stripe";

export function registerStripeWebhook(app: express.Application) {
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json", limit: "1mb" }),
    async (req, res) => {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret)
        return res.status(503).json({ error: "Webhook not configured" });
      let event;
      try {
        const signature = req.headers["stripe-signature"];
        if (typeof signature !== "string")
          return res.status(400).json({ error: "Missing signature" });
        event = getStripe().webhooks.constructEvent(
          req.body,
          signature,
          secret
        );
      } catch {
        return res.status(400).json({ error: "Invalid webhook signature" });
      }
      const handled = [
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "invoice.paid",
        "invoice.payment_failed",
        "invoice.payment_action_required",
      ];
      if (!handled.includes(event.type)) return res.json({ received: true });
      try {
        const object = event.data.object as {
          customer?: string | { id: string } | null;
        };
        const customerId =
          typeof object.customer === "string"
            ? object.customer
            : object.customer?.id;
        if (customerId) await syncCustomer(customerId);
        return res.json({ received: true });
      } catch {
        console.error("[Stripe] Reconciliation failed; provider should retry", {
          eventId: event.id,
          type: event.type,
        });
        return res.status(500).json({ error: "Reconciliation failed" });
      }
    }
  );
}
