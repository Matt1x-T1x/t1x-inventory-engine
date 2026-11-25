import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { openDatabase } from "../src/db/database";
import { createApp } from "../src/app";

describe("T1x Inventory Engine — Transações, Concorrência e Validação", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    app = createApp(db);
  });

  it("rejeita criação de produto com estoque negativo (validação Zod)", async () => {
    const res = await request(app).post("/api/products").send({
      sku: "IPHONE-15",
      name: "iPhone 15 128GB",
      priceCents: 450000,
      initialStock: -3,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
  });

  it("cria pedido no caminho feliz, deduz estoque e registra trilha no ledger", async () => {
    const prod = await request(app).post("/api/products").send({
      sku: "AIRPODS-PRO",
      name: "AirPods Pro 2",
      priceCents: 180000,
      initialStock: 5,
    });
    expect(prod.status).toBe(201);
    const productId = prod.body.data.id;

    const order = await request(app).post("/api/orders").send({
      customerName: "Matheus",
      items: [{ productId, quantity: 2 }],
    });

    expect(order.status).toBe(201);
    expect(order.body.data.total_cents).toBe(360000);

    const updated = await request(app).get(`/api/products/${productId}`);
    expect(updated.body.data.stock).toBe(3);

    const ledger = await request(app).get(`/api/ledger?productId=${productId}`);
    expect(ledger.body.data).toHaveLength(2); // INITIAL_STOCK (+5) + ORDER_SALE (-2)
  });

  it("CONCORRÊNCIA: 10 compras simultâneas do último item permitem apenas 1 sucesso (zero overselling)", async () => {
    const prod = await request(app).post("/api/products").send({
      sku: "GPU-RTX-LAST",
      name: "RTX Última Unidade",
      priceCents: 500000,
      initialStock: 1,
    });
    const productId = prod.body.data.id;

    // Dispara 10 requisições simultâneas disputando a última unidade
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, idx) =>
        request(app)
          .post("/api/orders")
          .send({
            customerName: `Cliente ${idx + 1}`,
            items: [{ productId, quantity: 1 }],
          })
      )
    );

    const successes = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409);

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(9);

    const finalProduct = await request(app).get(`/api/products/${productId}`);
    expect(finalProduct.body.data.stock).toBe(0);

    const orders = await request(app).get("/api/orders");
    expect(orders.body.data).toHaveLength(1);
  });

  it("ATOMICIDADE: se o 2º item do pedido falhar, o 1º item sofre ROLLBACK integral", async () => {
    const p1 = await request(app).post("/api/products").send({
      sku: "ITEM-A",
      name: "Item Com Estoque",
      priceCents: 10000,
      initialStock: 5,
    });
    const p2 = await request(app).post("/api/products").send({
      sku: "ITEM-B",
      name: "Item Sem Estoque",
      priceCents: 20000,
      initialStock: 0,
    });

    const failedOrder = await request(app).post("/api/orders").send({
      customerName: "Cliente Rollback",
      items: [
        { productId: p1.body.data.id, quantity: 2 },
        { productId: p2.body.data.id, quantity: 1 },
      ],
    });

    expect(failedOrder.status).toBe(409);
    expect(failedOrder.body.error).toBe("INSUFFICIENT_STOCK");

    // Item A deve permanecer intacto com 5 unidades!
    const checkP1 = await request(app).get(`/api/products/${p1.body.data.id}`);
    expect(checkP1.body.data.stock).toBe(5);

    const orders = await request(app).get("/api/orders");
    expect(orders.body.data).toHaveLength(0);
  });

  it("permite reposição de estoque e expõe especificação OpenAPI", async () => {
    const prod = await request(app).post("/api/products").send({
      sku: "CABO-USBC",
      name: "Cabo USB-C",
      priceCents: 5000,
      initialStock: 0,
    });

    const restock = await request(app)
      .post(`/api/products/${prod.body.data.id}/restock`)
      .send({ quantity: 12, reason: "FORNECEDOR_LOTE_01" });

    expect(restock.status).toBe(200);
    expect(restock.body.data.stock).toBe(12);

    const openapi = await request(app).get("/openapi.json");
    expect(openapi.status).toBe(200);
    expect(openapi.body.openapi).toBe("3.0.3");
  });
});
