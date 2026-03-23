import { unprocessable } from "../errors.js";
import { metaLeadgenPlugin } from "./meta-leadgen.js";
import { metaWhatsAppBusinessPlugin } from "./meta-whatsapp-business.js";
import type { ExternalIngestionPlugin } from "./types.js";

const plugins: ExternalIngestionPlugin[] = [metaLeadgenPlugin, metaWhatsAppBusinessPlugin];

const pluginById = new Map<string, ExternalIngestionPlugin>(
  plugins.map((plugin) => [plugin.metadata.pluginId, plugin]),
);

export function listExternalIngestionPlugins() {
  return plugins.map((plugin) => plugin.metadata);
}

export function getExternalIngestionPlugin(pluginId: string) {
  const plugin = pluginById.get(pluginId);
  if (!plugin) {
    throw unprocessable(`Unsupported external ingestion plugin: ${pluginId}`);
  }
  return plugin;
}
