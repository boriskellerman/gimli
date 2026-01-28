import type { GimliPluginApi } from "gimli/plugin-sdk";
import { emptyPluginConfigSchema } from "gimli/plugin-sdk";

import { createDiagnosticsOtelService } from "./src/service.js";

const plugin = {
  id: "diagnostics-otel",
  name: "Diagnostics OpenTelemetry",
  description: "Export diagnostics events to OpenTelemetry",
  configSchema: emptyPluginConfigSchema(),
  register(api: GimliPluginApi) {
    api.registerService(createDiagnosticsOtelService());
  },
};

export default plugin;
