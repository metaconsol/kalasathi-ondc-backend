import { PrismaClient } from './src/generated/prisma/client/index.js';
const db = new PrismaClient();
async function run() {
  try {
    const stores = await db.store.findMany();
    console.log('Stores:', stores);
  } catch (e) {
    console.error(e);
  } finally {
    await db.$disconnect();
  }
}
run();
