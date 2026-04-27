import { PrismaClient } from './src/generated/prisma/client';
const prisma = new PrismaClient();

async function check() {
  const carts = await prisma.cart.findMany({
    include: { items: true },
  });
  console.dir(
    carts.map((c) => ({
      ...c,
      id: c.id.toString(),
      userId: c.userId?.toString(),
      items: c.items.map((i) => ({
        ...i,
        id: i.id.toString(),
        cartId: i.cartId.toString(),
        priceSnapshot: i.priceSnapshot?.toString(),
      })),
    })),
    { depth: null },
  );
}

check()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
