import 'dotenv/config';

import { Prisma } from '../src/generated/prisma/client';
import { db } from '../src/lib/db';
import { UserRole } from '../src/generated/prisma/enums';

/**
 * Dev data: user + store + one demo `products` row (raw SQL) so cart APIs work after reset.
 */
async function main() {
  let user = await db.user.findFirst({ orderBy: { id: 'asc' } });
  if (!user) {
    user = await db.user.create({
      data: {
        name: 'Seed Demo User',
        phoneNumber: `+seed${Date.now()}`,
        role: UserRole.USER,
        profile: { create: {} },
      },
    });
    console.log('Created user id', user.id);
  } else {
    console.log('Using existing user id', user.id);
  }

  const storeSlug = 'demo-cart-store';
  let store = await db.store.findFirst({ where: { storeSlug } });
  if (!store) {
    store = await db.store.create({
      data: {
        sellerUserId: user.id,
        storeName: 'Demo Cart Store',
        storeSlug,
        isActive: true,
      },
    });
    console.log('Created store id', store.id.toString());
  } else {
    console.log('Using existing store id', store.id.toString());
  }

  const productTitle = 'Demo Product (seed)';
  const existing = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
    SELECT id FROM products
    WHERE store_id = ${store.id} AND title = ${productTitle} AND deleted_at IS NULL
    LIMIT 1
  `);

  if (!existing.length) {
    await db.$executeRaw(Prisma.sql`
      INSERT INTO products (store_id, title, base_price, stock_qty, is_active, deleted_at, created_at, updated_at)
      VALUES (${store.id}, ${productTitle}, 99.99, 100, 1, NULL, NOW(), NOW())
    `);
    console.log('Inserted demo product row');
  }

  const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
    SELECT id FROM products
    WHERE store_id = ${store.id} AND title = ${productTitle} AND deleted_at IS NULL
    LIMIT 1
  `);
  const productId = rows[0]?.id;
  if (!productId) {
    throw new Error('Could not resolve demo product id after seed');
  }
  console.log('Product id', productId.toString());

  console.log('\nPOST /api/v1/cart/items example body:');
  console.log(
    JSON.stringify(
      {
        store_id: Number(store.id),
        product_id: Number(productId),
        qty: 1,
      },
      null,
      2,
    ),
  );
}

async function run() {
  try {
    await main();
  } catch (e) {
    console.error(e);
    throw e;
  } finally {
    await db.$disconnect();
  }
}

void run();
