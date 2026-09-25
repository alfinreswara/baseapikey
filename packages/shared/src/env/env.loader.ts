import { parseDashboardEnv, DashboardEnv } from './dashboard.env';
import { parseGatewayEnv, GatewayEnv } from './gateway.env';

export interface AppEnv {
  gateway: GatewayEnv;
  dashboard: DashboardEnv;
}

export function loadEnv(inputEnv: Record<string, string | undefined> = process.env): AppEnv {
  const gateway = parseGatewayEnv(inputEnv);
  const dashboard = parseDashboardEnv(inputEnv);
  return { gateway, dashboard };
}
