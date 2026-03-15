require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');

async function createDb() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL not found in .env.local');
    process.exit(1);
  }
  
  // Replace the database name at the end with 'postgres' to connect to default DB
  let adminUrl = dbUrl;
  const lastSlashIndex = dbUrl.lastIndexOf('/');
  if (lastSlashIndex !== -1) {
    adminUrl = dbUrl.substring(0, lastSlashIndex) + '/postgres';
  }

  const client = new Client({ connectionString: adminUrl });
  
  try {
    await client.connect();
    console.log('Connected to default postgres DB.');
    await client.query('CREATE DATABASE joe_cafeteria;');
    console.log('Database joe_cafeteria created successfully.');
  } catch (error) {
    if (error.code === '42P04') {
      console.log('Database joe_cafeteria already exists.');
    } else {
      console.error('Error creating database:', error.message);
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

createDb();
