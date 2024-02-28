import express from "express";
import Router from "express-promise-router";
import {
  createBackendPlugin,
  coreServices,
  LoggerService,
  SchedulerService,
} from "@backstage/backend-plugin-api";
import {
  CatalogClient,
  CatalogRequestOptions,
} from "@backstage/catalog-client";
import {
  PluginEndpointDiscovery,
  TokenManager,
} from "@backstage/backend-common";
import { Config } from "@backstage/config";
import { ingest } from "./api";
import { TaskScheduleDefinition } from "@backstage/backend-tasks";

// TODO: Test with this new backend-plugin model
export const dxBackendPlugin = createBackendPlugin({
  pluginId: "@get-dx/backstage-backend-plugin",
  register(env) {
    env.registerInit({
      deps: {
        // Declare dependencies to services that you want to consume
        logger: coreServices.logger,
        scheduler: coreServices.scheduler,
        discovery: coreServices.discovery,
        config: coreServices.rootConfig,
      },
      init({
        // Requested service instances get injected as per above
        logger,
        scheduler,
        discovery,
        config,
      }) {
        return scheduleTask({ logger, scheduler, discovery, config });
      },
    });
  },
});

export interface Options {
  logger: LoggerService;
  scheduler: SchedulerService;
  discovery: PluginEndpointDiscovery;
  config: Config;
  schedule?: Partial<TaskScheduleDefinition>;
  tokenManager?: TokenManager;
}

export async function createRouter(options: Options): Promise<express.Router> {
  const router = Router();
  router.use(express.json());

  router.get("/health", (_, response) => {
    response.send({ status: "ok" });
  });

  await scheduleTask(options);

  return router;
}

function scheduleTask({
  logger,
  scheduler,
  discovery,
  config,
  schedule,
  tokenManager,
}: Options) {
  return scheduler.scheduleTask({
    id: "dx-ingestion",
    frequency: schedule?.frequency ?? { hours: 1 },
    timeout: schedule?.timeout ?? { seconds: 30 },
    // A 3 second delay gives the backend server a chance to initialize before
    // any collators are executed, which may attempt requests against the API.
    initialDelay: schedule?.initialDelay ?? { seconds: 3 },
    scope: schedule?.scope ?? "global",
    fn: async () => {
      const disable = config.getOptionalBoolean("dx.disableDataCollection");

      if (disable) {
        logger.info("DX Catalog sync is disabled");
        return;
      }

      logger.info("Starting DX Catalog sync");

      // TODO: Filter entities with extentionApi?
      const catalogApi = new CatalogClient({ discoveryApi: discovery });

      const opts: CatalogRequestOptions = {};

      if (tokenManager) {
        const token = await tokenManager.getToken();
        opts.token = token.token;
      }

      const { items: entities } = await catalogApi.getEntities(undefined, opts);

      await ingest({ entities, discovery, config, tokenManager });
      logger.info("Finished DX Catalog sync");
    },
  });
}
