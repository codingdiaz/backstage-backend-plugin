import {
  PluginEndpointDiscovery,
  TokenManager,
} from "@backstage/backend-common";
import { Entity } from "@backstage/catalog-model";
import { JsonObject } from "@backstage/types";
import fetch from "node-fetch";

import { chunk } from "./utils";
import { Config } from "@backstage/config";

const CHUNK_SIZE = 1000;

interface Options {
  entities: Entity[];
  discovery: PluginEndpointDiscovery;
  config: Config;
  tokenManager?: TokenManager;
}

export async function ingest({
  entities,
  discovery,
  config,
  tokenManager,
}: Options) {
  const baseUrl = await getBaseUrl(discovery);

  const application = {
    id: config.getOptionalString("dx.appId"),
    title: config.getOptionalString("app.title"),
    baseUrl: config.getOptionalString("app.baseUrl"),
  };

  for (const entityChunk of chunk(entities, CHUNK_SIZE)) {
    await post(
      `${baseUrl}/api/backstage.ingestCatalog`,
      {
        application,
        entities: entityChunk,
      },
      tokenManager,
    );
  }
}

// TODO: Include a version header so we know what type of body structure to expect?
async function post(
  path: string,
  body: JsonObject,
  tokenManager?: TokenManager,
) {
  if (tokenManager) {
    const token = await tokenManager.getToken();
    return fetch(path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token.token}`,
      },
    });
  }
  return fetch(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function getBaseUrl(discovery: PluginEndpointDiscovery) {
  const proxyBaseUrl = await discovery.getBaseUrl("proxy");
  return `${proxyBaseUrl}/dx`;
}
