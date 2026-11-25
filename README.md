# 📦 T1x Inventory Engine

> **Projeto 1 da Trilha de Engenharia Matt1x** — Sistema de gerenciamento de estoque focado em **transações atômicas, controle de concorrência (zero overselling), migrations versionadas, auditoria (ledger), Docker e CI**.

## 🎯 Problema Resolvido

Em sistemas de vendas e estoque, o "caminho feliz" é simples — o problema real acontece quando **dois ou mais clientes compram a última unidade no mesmo milissegundo** ou quando uma etapa do pedido falha no meio do caminho. Sem controle de concorrência e atomicidade, o banco acaba com estoque negativo ou pedidos órfãos.

Este projeto resolve isso garantindo:
- **Transações atômicas (`BEGIN IMMEDIATE ... COMMIT / ROLLBACK`)**: baixa de estoque, criação do pedido, itens e trilha no `inventory_ledger` acontecem em "tudo ou nada".
- **Proteção contra *race condition***: dedução condicional (`WHERE id = ? AND stock >= ?`) + constraint `CHECK (stock >= 0)` no banco.
- **Trilha imutável de auditoria (`inventory_ledger`)**: toda entrada ou saída de estoque fica registrada com motivo e referência.
- **Validação estrita na borda** com `Zod` + documentação OpenAPI em `/openapi.json`.

## 🛠️ Stack

- **Node.js 24 + TypeScript** (usando `node:sqlite` nativo com WAL mode)
- **Express + Zod** (API REST + validação)
- **Vitest + Supertest** (testes automatizados incluindo simulação de 10 compras simultâneas)
- **Docker Compose + GitHub Actions CI**

## 🚀 Como Rodar

### Localmente
```bash
cp .env.example .env
npm ci
npm run dev
```

### Com Docker Compose
```bash
docker compose up --build
```

Acesse:
- Healthcheck: `GET http://localhost:3001/health`
- Documentação OpenAPI: `GET http://localhost:3001/openapi.json`

## 🧪 Como Rodar os Testes

```bash
npm test
```

Os testes validam:
1. Rejeição de payloads inválidos (`Zod`).
2. Caminho feliz de pedido + baixa de estoque + registro no `inventory_ledger`.
3. **Teste de Concorrência:** 10 requisições simultâneas disputando a última unidade → exatamente **1 sucesso (`201`)** e **9 conflitos (`409 INSUFFICIENT_STOCK`)**, estoque final `0`.
4. **Teste de Atomicidade (Rollback):** pedido com 2 itens onde o segundo não tem saldo → rollback integral preservando o estoque do primeiro item.

## ⚠️ Limitações Conhecidas

- **SQLite single-writer:** ideal para operações locais, protótipos sólidos e serviços single-instance. Para escala horizontal com múltiplas réplicas simultâneas, o próximo passo seria migrar o driver para **PostgreSQL** usando `SELECT ... FOR UPDATE` ou locks distribuídos.
- **Autenticação/Autorização:** propositalmente fora do escopo para manter o foco em integridade transacional e concorrência; em produção seria protegida por JWT/API Keys.
- **Reserva temporária de carrinho:** o estoque é baixado na confirmação do pedido; um e-commerce de alto giro adicionaria reservas com TTL (ex.: Redis + job de expiração).

---

*Construído por **Matheus Machado · Matt1x** como parte da abordagem transparente de **AI Product Builder** (arquitetura, requisitos de produção, revisão de falhas e QA conduzidos com apoio de IA).*
