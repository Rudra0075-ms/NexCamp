import { MongoMemoryServer } from 'mongodb-memory-server';

async function main() {
  const mongod = await MongoMemoryServer.create({
    instance: {
      port: 27018,
      dbName: 'campus-intelligence'
    }
  });
  console.log('MONGODB_MEMORY_SERVER_READY: ' + mongod.getUri());

  // Keep alive until process terminated
  process.on('SIGINT', async () => {
    await mongod.stop();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await mongod.stop();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('FAILED TO START MONGODB MEMORY SERVER:', err);
  process.exit(1);
});
