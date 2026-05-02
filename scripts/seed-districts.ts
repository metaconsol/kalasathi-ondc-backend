/// <reference types="node" />
import { sqlExec, sqlQuery } from '../src/lib/sql';

const DISTRICT_DATA = [
  { name: 'Ashoknagar', region: 'bundelkhand', icon: '🧶' },
  { name: 'Bhopal', region: 'central', icon: '🏛️' },
  { name: 'Dhar', region: 'malwa', icon: '🏺' },
  { name: 'Indore', region: 'malwa', icon: '🏙️' },
  { name: 'Jabalpur', region: 'mahakoshal', icon: '🌊' },
  { name: 'Ujjain', region: 'malwa', icon: '🛕' },
  { name: 'Gwalior', region: 'gwalior', icon: '🏰' },
  { name: 'Sagar', region: 'bundelkhand', icon: '📚' },
  { name: 'Rewa', region: 'baghelkhand', icon: '🐯' },
];

async function main() {
  console.log('Deep-seeding districts, dummy products, and verifications...');

  const stores = await sqlQuery('SELECT id FROM stores WHERE is_active = 1 LIMIT 1');
  const categories = await sqlQuery('SELECT id FROM categories WHERE is_active = 1 LIMIT 1');

  if (stores.length === 0 || categories.length === 0) {
    console.error('ERROR: Database must have at least one active store and one active category.');
    process.exit(1);
  }

  const storeId = stores[0].id;
  const categoryId = categories[0].id;

  for (const district of DISTRICT_DATA) {
    let productId: number;
    const existing = await sqlQuery('SELECT id FROM products WHERE district = ? LIMIT 1', [
      district.name,
    ]);

    if (existing.length === 0) {
      console.log(`Inserting dummy product for ${district.name}...`);
      const res = await sqlExec(
        `INSERT INTO products (store_id, category_id, product_name, district, region, district_icon, default_price, mrp, publish_status, visibility, description, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'publish', 'PUBLIC', ?, NOW(), NOW())`,
        [
          storeId,
          categoryId,
          `${district.name} Special Craft`,
          district.name,
          district.region,
          district.icon,
          1200 + Math.floor(Math.random() * 5000),
          7000,
          `Authentic handmade craft from the heart of ${district.name}.`,
        ],
      );
      productId = res.insertId;
    } else {
      productId = existing[0].id;
      await sqlExec(`UPDATE products SET region = ?, district_icon = ? WHERE id = ?`, [
        district.region,
        district.icon,
        productId,
      ]);
    }

    // Ensure product_verification exists and is approved
    const verification = await sqlQuery(
      'SELECT id FROM product_verification WHERE product_id = ?',
      [productId],
    );
    if (verification.length === 0) {
      console.log(`Approving product ID ${productId}...`);
      await sqlExec(
        `INSERT INTO product_verification (product_id, store_id, approval_status, created_at, updated_at) VALUES (?, ?, 'approved', NOW(), NOW())`,
        [productId, storeId],
      );
    } else {
      await sqlExec(
        `UPDATE product_verification SET approval_status = 'approved', updated_at = NOW() WHERE product_id = ?`,
        [productId],
      );
    }
  }

  console.log('Seeding and verification completed successfully!');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
