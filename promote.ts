import { db } from './src/lib/db';

async function promote() {
  try {
    const phoneNumber = '+918718916673';

    const user = await db.user.update({
      where: { phoneNumber },
      data: { role: 'ADMIN' },
    });

    console.log(`✅ Successfully promoted ${user.name} (${phoneNumber}) to ADMIN!`);
    console.log('Now log in again in Postman to get your new Admin token.');
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error('❌ Error promoting user:', error.message);
    } else {
      console.error('❌ An unknown error occurred:', error);
    }
    console.log('\nTip: Make sure you have Registered this phone number first!');
  } finally {
    await db.$disconnect();
  }
}

promote();
