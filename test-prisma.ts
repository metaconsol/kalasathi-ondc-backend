import { db } from './src/lib/db.js';

async function main() {
  try {
    const addresses = await db.userAddress.findMany();
    console.log('Connected to Prisma successfully. User addresses count:', addresses.length);
    process.exit(0);
  } catch (error) {
    console.error('Prisma query failed:', error);
    process.exit(1);
  }
}

main();
