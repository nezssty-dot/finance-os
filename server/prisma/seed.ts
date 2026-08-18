import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

type Dataset = {
  tags: { id: string; name: string; color: string }[];
  transactions: { id: string; type: "income" | "expense"; currency: string; date: string; desc: string; tagId: string; amount: number }[];
};

async function main() {
  const email = "demo@financeos.app";
  const password = "demo1234";

  await prisma.user.deleteMany({ where: { email } });

  const user = await prisma.user.create({
    data: { email, name: "Gabriel", passwordHash: await bcrypt.hash(password, 12) },
  });

  const cash = await prisma.account.create({
    data: { userId: user.id, name: "Efectivo", type: "CASH", currency: "ARS" },
  });
  await prisma.account.create({
    data: { userId: user.id, name: "Mercado Pago", type: "MERCADO_PAGO", currency: "ARS", provider: "mercadopago" },
  });

  const raw = fs.readFileSync(path.join(__dirname, "data", "dataset.json"), "utf8");
  const data: Dataset = JSON.parse(raw);

  const tagToCat: Record<string, string> = {};
  for (const tag of data.tags) {
    const cat = await prisma.category.create({ data: { userId: user.id, name: tag.name, color: tag.color } });
    tagToCat[tag.id] = cat.id;
  }

  let count = 0;
  for (const tx of data.transactions) {
    await prisma.movement.create({
      data: {
        userId: user.id, accountId: cash.id, categoryId: tagToCat[tx.tagId] ?? null,
        type: tx.type === "income" ? "INCOME" : "EXPENSE",
        amount: tx.amount, currency: tx.currency || "ARS",
        description: tx.desc, counterpart: tx.desc,
        date: new Date(tx.date + "T12:00:00"), source: "MANUAL",
      },
    });
    count++;
  }

  await prisma.goal.create({ data: { userId: user.id, name: "Ahorro 2026", target: 2000000, saved: 0 } });

  console.log(`\n  Seed listo. ${email} / ${password}`);
  console.log(`  ${data.tags.length} categorías, ${count} movimientos.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
