const { Client } = require("pg");

let connected = false;
let client = new Client({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});

export default async function getClient() {
  if (!connected) {
    connected = true;
    try {
      await client.connect();
    } catch (e) {
      connected = false;
    }
  }

  return client;
}

export function closeConnection() {
  if (connected) {
    client.end();
  }
}