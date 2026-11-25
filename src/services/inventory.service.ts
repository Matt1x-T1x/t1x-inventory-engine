import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  price_cents: number;
  stock: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface OrderResult {
  id: string;
  customer_name: string;
  status: string;
  total_cents: number;
  items: { product_id: string; quantity: number; unit_price_cents: number }[];
}

export class InventoryService {
  constructor(private readonly db: DatabaseSync) {}

  createProduct(input: {
    sku: string;
    name: string;
    priceCents: number;
    initialStock: number;
  }): Product {
    const id = crypto.randomUUID();
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      this.db
        .prepare(
          `INSERT INTO products (id, sku, name, price_cents, stock)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(id, input.sku.trim().toUpperCase(), input.name.trim(), input.priceCents, input.initialStock);

      if (input.initialStock > 0) {
        this.db
          .prepare(
            `INSERT INTO inventory_ledger (id, product_id, delta, reason, reference_id)
             VALUES (?, ?, ?, 'INITIAL_STOCK', ?)`
          )
          .run(crypto.randomUUID(), id, input.initialStock, id);
      }

      this.db.exec("COMMIT;");
    } catch (err: unknown) {
      this.db.exec("ROLLBACK;");
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("UNIQUE constraint failed")) {
        throw new DomainError("DUPLICATE_SKU", 409, `SKU '${input.sku}' já cadastrado.`);
      }
      throw err;
    }

    return this.getProduct(id);
  }

  listProducts(): Product[] {
    return this.db
      .prepare("SELECT * FROM products ORDER BY created_at DESC")
      .all() as unknown as Product[];
  }

  getProduct(id: string): Product {
    const row = this.db
      .prepare("SELECT * FROM products WHERE id = ?")
      .get(id) as unknown as Product | undefined;
    if (!row) {
      throw new DomainError("PRODUCT_NOT_FOUND", 404, `Produto '${id}' não encontrado.`);
    }
    return row;
  }

  restockProduct(productId: string, quantity: number, reason = "MANUAL_RESTOCK"): Product {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const res = this.db
        .prepare(
          `UPDATE products
           SET stock = stock + ?, version = version + 1, updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(quantity, productId);

      if (res.changes === 0) {
        throw new DomainError("PRODUCT_NOT_FOUND", 404, `Produto '${productId}' não encontrado.`);
      }

      this.db
        .prepare(
          `INSERT INTO inventory_ledger (id, product_id, delta, reason)
           VALUES (?, ?, ?, ?)`
        )
        .run(crypto.randomUUID(), productId, quantity, reason);

      this.db.exec("COMMIT;");
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }

    return this.getProduct(productId);
  }

  /**
   * Cria um pedido de forma ATÔMICA e segura contra concorrência.
   * Usa BEGIN IMMEDIATE + UPDATE condicional (WHERE stock >= qty).
   * Se qualquer item não tiver saldo suficiente, toda a transação sofre ROLLBACK.
   */
  createOrder(input: {
    customerName: string;
    items: { productId: string; quantity: number }[];
  }): OrderResult {
    // Agrupa itens repetidos no mesmo pedido para evitar checagem fragmentada
    const grouped = new Map<string, number>();
    for (const item of input.items) {
      grouped.set(item.productId, (grouped.get(item.productId) ?? 0) + item.quantity);
    }

    const orderId = crypto.randomUUID();
    const resolvedItems: { product_id: string; quantity: number; unit_price_cents: number }[] = [];
    let totalCents = 0;

    this.db.exec("BEGIN IMMEDIATE;");
    try {
      for (const [productId, quantity] of grouped.entries()) {
        const product = this.db
          .prepare("SELECT id, name, price_cents, stock FROM products WHERE id = ?")
          .get(productId) as
          | { id: string; name: string; price_cents: number; stock: number }
          | undefined;

        if (!product) {
          throw new DomainError("PRODUCT_NOT_FOUND", 404, `Produto '${productId}' não encontrado.`);
        }

        // Baixa condicional atômica: impossibilita estoque negativo mesmo sob concorrência
        const updateRes = this.db
          .prepare(
            `UPDATE products
             SET stock = stock - ?, version = version + 1, updated_at = datetime('now')
             WHERE id = ? AND stock >= ?`
          )
          .run(quantity, productId, quantity);

        if (updateRes.changes === 0) {
          throw new DomainError(
            "INSUFFICIENT_STOCK",
            409,
            `Estoque insuficiente para '${product.name}' (disponível: ${product.stock}, solicitado: ${quantity}).`
          );
        }

        totalCents += product.price_cents * quantity;
        resolvedItems.push({
          product_id: productId,
          quantity,
          unit_price_cents: product.price_cents,
        });
      }

      this.db
        .prepare(
          `INSERT INTO orders (id, customer_name, status, total_cents)
           VALUES (?, ?, 'CONFIRMED', ?)`
        )
        .run(orderId, input.customerName.trim(), totalCents);

      const insertItem = this.db.prepare(
        `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents)
         VALUES (?, ?, ?, ?, ?)`
      );
      const insertLedger = this.db.prepare(
        `INSERT INTO inventory_ledger (id, product_id, delta, reason, reference_id)
         VALUES (?, ?, ?, 'ORDER_SALE', ?)`
      );

      for (const item of resolvedItems) {
        insertItem.run(
          crypto.randomUUID(),
          orderId,
          item.product_id,
          item.quantity,
          item.unit_price_cents
        );
        insertLedger.run(crypto.randomUUID(), item.product_id, -item.quantity, orderId);
      }

      this.db.exec("COMMIT;");
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }

    return {
      id: orderId,
      customer_name: input.customerName.trim(),
      status: "CONFIRMED",
      total_cents: totalCents,
      items: resolvedItems,
    };
  }

  listOrders() {
    return this.db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
  }

  listLedger(productId?: string) {
    if (productId) {
      return this.db
        .prepare("SELECT * FROM inventory_ledger WHERE product_id = ? ORDER BY created_at DESC")
        .all(productId);
    }
    return this.db
      .prepare("SELECT * FROM inventory_ledger ORDER BY created_at DESC LIMIT 100")
      .all();
  }
}
