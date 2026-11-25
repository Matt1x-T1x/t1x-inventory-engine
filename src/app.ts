import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { DomainError, InventoryService } from "./services/inventory.service";
import { OPENAPI_SPEC } from "./openapi";

const createProductSchema = z.object({
  sku: z.string().min(2).max(40),
  name: z.string().min(2).max(120),
  priceCents: z.number().int().nonnegative(),
  initialStock: z.number().int().nonnegative(),
});

const restockSchema = z.object({
  quantity: z.number().int().positive(),
  reason: z.string().min(2).max(80).optional(),
});

const createOrderSchema = z.object({
  customerName: z.string().min(2).max(120),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive(),
      })
    )
    .min(1),
});

export function createApp(db: DatabaseSync) {
  const app = express();
  app.use(express.json());

  const service = new InventoryService(db);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "t1x-inventory-engine" });
  });

  app.get("/openapi.json", (_req, res) => {
    res.json(OPENAPI_SPEC);
  });

  app.get("/api/products", (_req, res) => {
    res.json({ data: service.listProducts() });
  });

  app.get("/api/products/:id", (req, res, next) => {
    try {
      res.json({ data: service.getProduct(req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/products", (req, res, next) => {
    try {
      const parsed = createProductSchema.parse(req.body);
      const product = service.createProduct(parsed);
      res.status(201).json({ data: product });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/products/:id/restock", (req, res, next) => {
    try {
      const parsed = restockSchema.parse(req.body);
      const product = service.restockProduct(req.params.id, parsed.quantity, parsed.reason);
      res.json({ data: product });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/orders", (_req, res) => {
    res.json({ data: service.listOrders() });
  });

  app.post("/api/orders", (req, res, next) => {
    try {
      const parsed = createOrderSchema.parse(req.body);
      const order = service.createOrder(parsed);
      res.status(201).json({ data: order });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/ledger", (req, res) => {
    const productId = typeof req.query.productId === "string" ? req.query.productId : undefined;
    res.json({ data: service.listLedger(productId) });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
      return;
    }
    if (err instanceof DomainError) {
      res.status(err.statusCode).json({ error: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro interno inesperado." });
  });

  return app;
}
