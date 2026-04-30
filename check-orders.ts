import { db } from './src/lib/db';
import { createOrder } from './src/service/order.service';

async function main() {
  const userId = 1; // arjita@test.com
  const cartId = '1'; // Cart #1 belonging to user 1

  console.log('Attempting to create order for user', userId, 'with cart', cartId);

  try {
    const result = await createOrder(userId, {
      cart_id: cartId,
      billing_address: {
        full_name: 'Test User',
        phone: '+919876543210',
        address_line1: '123 Test Street',
        address_line2: 'Apt 4B',
        city: 'Bhopal',
        state: 'Madhya Pradesh',
        country: 'India',
        pincode: '462001',
      },
    });

    console.log('\n Order created successfully!');
    console.log('Order ID:', result.id.toString());
    console.log('Order No:', result.order_no);
    console.log('Status:', result.status);
    console.log('Total:', result.total_amount.toString());

    // Verify addresses were created
    const order = await db.order.findUnique({
      where: { id: result.id },
      include: { addresses: true, items: true },
    });

    console.log('\nItems:', order?.items.length);
    console.log('Addresses:', order?.addresses.length);
    for (const a of order?.addresses ?? []) {
      console.log(`  [${a.type}] ${a.full_name}, ${a.city} ${a.pincode}`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('\n Order creation FAILED:', message);
    console.error('Full error:', error);
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
