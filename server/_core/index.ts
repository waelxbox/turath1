import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { createServer, type Server } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { registerStorageProxy } from "./storageProxy";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerStripeWebhook } from "../billing/webhook";
import { closeDb } from "../db";
import { beginShutdown, getReadiness, registerHealthRoutes } from "./health";
import { logEvent } from "./logger";
import { assertRuntimeConfig } from "./runtimeConfig";

const SHUTDOWN_TIMEOUT_MS = 10_000;

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

function parsePort(value: string | undefined): number {
  const port = Number.parseInt(value || "3000", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port);
  });
}

function installShutdownHandlers(server: Server): void {
  let shutdownStarted = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    beginShutdown();
    logEvent("info", "server.shutdown.started", { signal });

    server.closeIdleConnections?.();
    const forceShutdown = setTimeout(() => {
      logEvent("error", "server.shutdown.timeout", {
        timeoutMs: SHUTDOWN_TIMEOUT_MS,
      });
      server.closeAllConnections?.();
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceShutdown.unref();

    try {
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
      await closeDb();
      clearTimeout(forceShutdown);
      logEvent("info", "server.shutdown.completed", { signal });
      process.exit(0);
    } catch (error) {
      clearTimeout(forceShutdown);
      logEvent("error", "server.shutdown.failed", {
        signal,
        message: error instanceof Error ? error.message : "Unknown error",
      });
      process.exit(1);
    }
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

export async function startServer() {
  const configIssues = assertRuntimeConfig();
  if (configIssues.length > 0) {
    logEvent("warn", "server.configuration.incomplete", {
      issues: configIssues.map(issue => ({
        key: issue.key,
        message: issue.message,
      })),
    });
  }

  const app = express();
  const server = createServer(app);
  app.disable("x-powered-by");

  registerHealthRoutes(app);

  // Security headers
  app.use(
    helmet({
      contentSecurityPolicy: false, // Disabled — Vite injects inline scripts in dev; tune CSP separately for production
      crossOriginEmbedderPolicy: false, // Allow loading external images (S3, Google Maps)
    })
  );

  // Stripe webhook (MUST be before express.json())
  registerStripeWebhook(app);

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const startupReadiness = await getReadiness({ bypassCache: true });
  if (!startupReadiness.ok && process.env.NODE_ENV === "production") {
    throw new Error("Startup readiness checks failed");
  }

  const preferredPort = parsePort(process.env.PORT);
  const port =
    process.env.NODE_ENV === "production"
      ? preferredPort
      : await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    logEvent("warn", "server.port.fallback", { preferredPort, port });
  }

  await listen(server, port);
  installShutdownHandlers(server);
  logEvent("info", "server.started", {
    port,
    environment: process.env.NODE_ENV || "development",
    pid: process.pid,
  });

  return { app, server, port };
}

startServer().catch(async error => {
  logEvent("error", "server.startup.failed", {
    message: error instanceof Error ? error.message : "Unknown error",
  });
  await closeDb().catch(closeError => {
    logEvent("error", "database.shutdown.failed", {
      message:
        closeError instanceof Error ? closeError.message : "Unknown error",
    });
  });
  process.exitCode = 1;
});
