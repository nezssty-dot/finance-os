/**
 * Tests for the code that decides how much money the user has.
 *
 * Run:  npm run test
 *
 * These are not ceremony. The previous design stored the balance in a column that
 * nothing ever updated, so net worth was silently wrong forever. The invariants
 * below are the ones that must never break again.
 */
import assert from "node:assert/strict";
import { deriveBalances, balancesByCurrency, type MovementLike } from "../src/lib/balance-math";

const mov = (p: Partial<MovementLike>): MovementLike => ({
  accountId: null,
  transferAccountId: null,
  type: "EXPENSE",
  amount: 0,
  ...p,
});

const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

// ─────────────────────────────────────────────────────────────

test("una cuenta nueva vale exactamente su saldo inicial", () => {
  const { balance } = deriveBalances([{ id: "mp", openingBalance: 5000 }], []);
  assert.equal(balance.mp, 5000);
});

test("los ingresos suman y los gastos restan, sin tocar nada a mano", () => {
  const { balance } = deriveBalances(
    [{ id: "mp", openingBalance: 1000 }],
    [
      mov({ accountId: "mp", type: "INCOME", amount: 500 }),
      mov({ accountId: "mp", type: "EXPENSE", amount: 200 }),
    ]
  );
  assert.equal(balance.mp, 1300);
});

test("sincronizar Mercado Pago mueve el saldo solo (el bug que rompía el patrimonio)", () => {
  // 382 movimientos importados, como los reales de 2026.
  const imported = Array.from({ length: 382 }, (_, i) =>
    mov({ accountId: "mp", type: i % 3 === 0 ? "INCOME" : "EXPENSE", amount: 100 })
  );
  const { balance } = deriveBalances([{ id: "mp", openingBalance: 0 }], imported);

  const ingresos = Math.ceil(382 / 3); // i % 3 === 0
  const gastos = 382 - ingresos;
  assert.equal(balance.mp, ingresos * 100 - gastos * 100);
  assert.notEqual(balance.mp, 0, "el saldo NO puede quedar en cero después de sincronizar");
});

test("una transferencia entre cuentas propias no crea ni destruye plata", () => {
  const accounts = [
    { id: "mp", openingBalance: 10000 },
    { id: "reserva", openingBalance: 0 },
  ];
  const antes = deriveBalances(accounts, []);
  const netoAntes = antes.balance.mp + antes.balance.reserva;

  const despues = deriveBalances(accounts, [
    mov({ accountId: "mp", transferAccountId: "reserva", type: "TRANSFER", amount: 3000 }),
  ]);

  assert.equal(despues.balance.mp, 7000, "sale de la cuenta de origen");
  assert.equal(despues.balance.reserva, 3000, "entra en la de destino");
  assert.equal(
    despues.balance.mp + despues.balance.reserva,
    netoAntes,
    "EL PATRIMONIO NO SE MUEVE UN PESO"
  );
});

test("pagar una deuda baja el saldo (y el patrimonio queda igual porque la deuda baja lo mismo)", () => {
  const { balance } = deriveBalances(
    [{ id: "mp", openingBalance: 5000 }],
    [mov({ accountId: "mp", type: "DEBT_PAYMENT", amount: 1500 })]
  );
  assert.equal(balance.mp, 3500);
  // neto = disponible + porCobrar − deudas
  //      = 3500 + 0 − (deuda original 1500 − pagado 1500 = 0)  → 3500
  // antes: 5000 + 0 − 1500 = 3500. Igual. ✔
});

test("cobrar lo que te deben sube el saldo (y el patrimonio tampoco se mueve)", () => {
  const { balance } = deriveBalances(
    [{ id: "mp", openingBalance: 1000 }],
    [mov({ accountId: "mp", type: "COLLECTION", amount: 800 })]
  );
  assert.equal(balance.mp, 1800);
});

test("comprar una inversión saca plata de la cuenta", () => {
  const { balance } = deriveBalances(
    [{ id: "mp", openingBalance: 9000 }],
    [mov({ accountId: "mp", type: "INVESTMENT", amount: 4000 })]
  );
  assert.equal(balance.mp, 5000);
});

test("un movimiento INTERNAL no altera ningún saldo", () => {
  const { balance } = deriveBalances(
    [{ id: "mp", openingBalance: 2000 }],
    [mov({ accountId: "mp", type: "INTERNAL", amount: 999 })]
  );
  assert.equal(balance.mp, 2000);
});

test("un movimiento sin cuenta asignada no rompe ni ensucia nada", () => {
  const { balance } = deriveBalances(
    [{ id: "mp", openingBalance: 100 }],
    [mov({ accountId: null, type: "EXPENSE", amount: 50 })]
  );
  assert.equal(balance.mp, 100);
});

test("borrar un movimiento devuelve el saldo exacto de antes (nada queda pegado)", () => {
  const accounts = [{ id: "mp", openingBalance: 1000 }];
  const conMovimiento = deriveBalances(accounts, [
    mov({ accountId: "mp", type: "EXPENSE", amount: 250 }),
  ]);
  const sinMovimiento = deriveBalances(accounts, []);

  assert.equal(conMovimiento.balance.mp, 750);
  assert.equal(sinMovimiento.balance.mp, 1000, "al derivar, borrar revierte perfecto");
});

test("el orden de los movimientos no cambia el resultado", () => {
  const accounts = [{ id: "a", openingBalance: 0 }, { id: "b", openingBalance: 0 }];
  const ms = [
    mov({ accountId: "a", type: "INCOME", amount: 1000 }),
    mov({ accountId: "a", transferAccountId: "b", type: "TRANSFER", amount: 400 }),
    mov({ accountId: "b", type: "EXPENSE", amount: 100 }),
  ];
  const forward = deriveBalances(accounts, ms);
  const backward = deriveBalances(accounts, [...ms].reverse());
  assert.deepEqual(forward.balance, backward.balance);
  assert.equal(forward.balance.a, 600);
  assert.equal(forward.balance.b, 300);
});

// ───────────── Monedas: nunca se mezclan ─────────────

test("balancesByCurrency separa pesos y dólares en totales distintos", () => {
  const out = balancesByCurrency([
    { currency: "ARS", balance: 1_000_000 },
    { currency: "USD", balance: 500 },
    { currency: "ARS", balance: 250_000 },
  ]);
  assert.equal(out.ARS, 1_250_000, "los pesos se suman entre sí");
  assert.equal(out.USD, 500, "los dólares quedan aparte");
  // Lo que nunca puede pasar: un solo número mezclado.
  assert.equal(Object.keys(out).sort().join(","), "ARS,USD");
});

test("sin cuentas, el desglose por moneda es un objeto vacío (no rompe)", () => {
  assert.deepEqual(balancesByCurrency([]), {});
});

test("una sola moneda da un solo total", () => {
  const out = balancesByCurrency([
    { currency: "ARS", balance: 100 },
    { currency: "ARS", balance: -30 },
  ]);
  assert.deepEqual(out, { ARS: 70 });
});

test("un saldo en dólares negativo se respeta, no se fuerza a cero", () => {
  const out = balancesByCurrency([{ currency: "USD", balance: -120 }]);
  assert.equal(out.USD, -120);
});

// ─────────────────────────────────────────────────────────────

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
  }
}

console.log(`\n${tests.length - failed}/${tests.length} tests pasaron`);
if (failed) process.exit(1);
