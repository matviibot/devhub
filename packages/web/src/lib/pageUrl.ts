import type { ServiceView } from "@devhub/shared";

/** What "Open page" opens. When any launcher declares a `url`, only a running
 *  declared one counts; otherwise the first port of a running devhub-launched
 *  process, else of anything running. */
export function pageUrl(services: ServiceView[]): string | undefined {
  const live = services.filter((service) => service.status === "running" || service.status === "starting");
  if (services.some((service) => service.url)) return live.find((service) => service.url)?.url;
  const withPort = live.find((service) => service.kind === "process" && service.ports.length > 0) ?? live.find((service) => service.ports.length > 0);
  return withPort ? `http://localhost:${withPort.ports[0]}` : undefined;
}
