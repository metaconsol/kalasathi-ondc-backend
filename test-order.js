const fetch = require('node-fetch');

async function run() {
  const res = await fetch('http://localhost:5001/api/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cart_id: '1',
      billing_address: {
        type: 'billing',
        full_name: 'Test User',
        phone: '9999999999',
        address_line1: '123 Test St',
        city: 'Test City',
        state: 'Test State',
        country: 'India',
        pincode: '123456',
      },
    }),
  });
  console.log(res.status);
  console.log(await res.text());
}
run();
