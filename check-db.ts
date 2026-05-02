import { sqlQuery } from './src/lib/sql';

async function check() {
  const districts = await sqlQuery(
    'SELECT district, count(*) as count FROM products GROUP BY district',
  );
  console.log(JSON.stringify(districts, null, 2));
  process.exit(0);
}

check();
