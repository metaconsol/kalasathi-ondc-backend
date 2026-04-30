import { PrismaClient } from './src/generated/prisma/client/index.js';
const prisma = new PrismaClient();
async function main() {
  const carts = await prisma.cart.findMany({ include: { items: true } });
  console.log(
    JSON.stringify(
      carts,
      (key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2,
    ),
  );
}
main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
