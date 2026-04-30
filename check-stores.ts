import { db } from './src/lib/db';
async function run() {
  try {
    const stores = await db.store.findMany();
    console.log('Stores:', stores);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
