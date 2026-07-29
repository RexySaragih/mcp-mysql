function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function mask(value: string): string {
  if (value.length <= 4) return '***';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

async function main(): Promise<void> {
  const { MysqlClient } = await import('../clients/mysql-client.js');

  const url = optionalEnv('MYSQL_URL');
  if (url) {
    console.error(`Smoke: MYSQL_URL=${mask(url)}`);
  } else {
    const host = optionalEnv('MYSQL_HOST') ?? '127.0.0.1';
    const user = optionalEnv('MYSQL_USER');
    if (!user) {
      console.error('Missing MYSQL_URL or MYSQL_USER');
      process.exit(1);
    }
    console.error(
      `Smoke: host=${host} user=${user} database=${optionalEnv('MYSQL_DATABASE') ?? '(none)'}`,
    );
  }

  const client = new MysqlClient();
  try {
    await client.ping();
    const databases = await client.listDatabases();
    console.error(`OK: connected; databases visible=${databases.length}`);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error('FAIL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
