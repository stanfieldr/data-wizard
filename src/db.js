const { Client } = require("pg");

let connected = false;
let client = new Client({
  host: "localhost",
  port: 4545,
  user: "",
  password: "",
});

export default async function getClient() {
  console.log('connected', connected);
  if (!connected) {
    connected = true;
    await client.connect();
  }

  return client;
}

export function closeConnection() {
  if (connected) {
    client.end();
  }
}