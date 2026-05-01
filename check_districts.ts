import { sqlQuery } from './src/lib/sql';

async function check() {
  try {
    const rows = await sqlQuery(
      'SELECT district, COUNT(*) as count FROM products GROUP BY district',
    );
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

check();
