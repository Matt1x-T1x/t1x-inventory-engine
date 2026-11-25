export const OPENAPI_SPEC = {
  openapi: "3.0.3",
  info: {
    title: "T1x Inventory Engine API",
    version: "1.0.0",
    description:
      "API de controle de estoque com transações atômicas, proteção contra concorrência (overselling) e trilha de auditoria (ledger).",
  },
  paths: {
    "/health": {
      get: { summary: "Healthcheck do serviço", responses: { "200": { description: "OK" } } },
    },
    "/api/products": {
      get: { summary: "Lista produtos e saldos atuais", responses: { "200": { description: "Lista de produtos" } } },
      post: {
        summary: "Cadastra um novo produto com saldo inicial",
        responses: {
          "201": { description: "Produto criado" },
          "400": { description: "Payload inválido" },
          "409": { description: "SKU duplicado" },
        },
      },
    },
    "/api/products/{id}/restock": {
      post: {
        summary: "Adiciona estoque de forma transacional",
        responses: {
          "200": { description: "Estoque atualizado" },
          "404": { description: "Produto não encontrado" },
        },
      },
    },
    "/api/orders": {
      get: { summary: "Lista pedidos confirmados", responses: { "200": { description: "Lista de pedidos" } } },
      post: {
        summary: "Cria pedido com baixa atômica e segura contra concorrência",
        responses: {
          "201": { description: "Pedido confirmado" },
          "400": { description: "Payload inválido" },
          "409": { description: "Estoque insuficiente (rollback completo)" },
        },
      },
    },
    "/api/ledger": {
      get: { summary: "Consulta histórico imutável de movimentações de estoque", responses: { "200": { description: "Entradas do ledger" } } },
    },
  },
};
