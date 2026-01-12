import { CosmosClient, Container } from "@azure/cosmos";

const endpoint = process.env.COSMOS_ENDPOINT!;
const key = process.env.COSMOS_KEY!;
if (!endpoint || !key) {
  throw new Error("Cosmos DB endpoint or key not set in environment variables");
}

export const cosmos = new CosmosClient({ endpoint: endpoint, key: key });

export const dbName = "short-url-cosmosdb";
export const linksContainerId = "Links";
export const usersContainerId = "Users";
export const clickEventsContainerId = "ClickEvents";

export const db = cosmos.database(dbName);
export const linkContainer: Container = db.container(linksContainerId);
export const usersContainer: Container = db.container(usersContainerId);
export const clickEventsContainer: Container = db.container(clickEventsContainerId);
