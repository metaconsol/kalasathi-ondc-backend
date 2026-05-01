import { sqlQuery } from './src/lib/sql';

async function check() {
  const tables = await sqlQuery('SHOW TABLES');
  console.log(JSON.stringify(tables, null, 2));
  process.exit(0);
}

check();
