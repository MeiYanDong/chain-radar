import { isAddress } from 'viem';

export const DEFAULT_DIRECT_MARKET_ADDRESS = '0x1A540088125d00dD3990f9dA45CA0859af4d3B01';

export type ExitBackendPolicy = 'direct' | 'okx_quote_only' | 'alert_only';
export type RouteExecutionMode = 'live' | 'dry_run' | 'alert_only';
export type RouteIssueLevel = 'error' | 'warning';

export interface TokenRoute {
  tokenAddress: string;
  symbol: string;
  decimals: number | null;
  marketAddress: string;
  approvalSpenderAddress: string;
  backendPolicy: ExitBackendPolicy;
  verifiedSell: boolean;
  allowancePreapproved: boolean;
  executionMode: RouteExecutionMode;
}

export interface TokenRouteRegistry {
  routes: TokenRoute[];
  routesByToken: Map<string, TokenRoute>;
}

export interface RouteValidationIssue {
  level: RouteIssueLevel;
  code:
    | 'route_missing'
    | 'invalid_token'
    | 'invalid_market'
    | 'invalid_spender'
    | 'missing_decimals'
    | 'market_mismatch'
    | 'spender_mismatch'
    | 'route_unverified'
    | 'allowance_not_preapproved'
    | 'route_not_live';
  message: string;
}

export interface RouteValidationResult {
  ok: boolean;
  route?: TokenRoute;
  issues: RouteValidationIssue[];
}

type EnvLike = Record<string, string | undefined>;

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

function shortAddress(value: string): string {
  if (value.length < 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function parseAddressValueEnv(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of (raw ?? '').split(',')) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(':');
    if (separator <= 0) continue;
    const address = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    if (!address || !value) continue;
    map.set(normalizeAddress(address), value.trim());
  }
  return map;
}

function parseAddressNumberEnv(raw: string | undefined): Map<string, number> {
  const map = new Map<string, number>();
  for (const [address, value] of parseAddressValueEnv(raw)) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 255) map.set(address, parsed);
  }
  return map;
}

function parsePreapprovedPairs(raw: string | undefined): Set<string> {
  const pairs = new Set<string>();
  for (const item of (raw ?? '').split(',')) {
    const [token, spender] = item.split(':').map((part) => part?.trim()).filter(Boolean);
    if (!token || !spender) continue;
    pairs.add(`${normalizeAddress(token)}:${normalizeAddress(spender)}`);
  }
  return pairs;
}

function parseVerifiedRoutes(raw: string | undefined): Set<string> {
  const routes = new Set<string>();
  for (const item of (raw ?? '').split(',')) {
    const [token, market, spender] = item.split(':').map((part) => part?.trim()).filter(Boolean);
    if (!token || !market || !spender) continue;
    routes.add(`${normalizeAddress(token)}:${normalizeAddress(market)}:${normalizeAddress(spender)}`);
  }
  return routes;
}

function normalizeBackendPolicy(value: string | undefined): ExitBackendPolicy {
  const normalized = (value ?? '').trim().toLowerCase().replaceAll('-', '_');
  if (normalized === 'okx_quote_only' || normalized === 'okx_quote') return 'okx_quote_only';
  if (normalized === 'alert_only' || normalized === 'alert') return 'alert_only';
  return 'direct';
}

function unverifiedRouteMode(env: EnvLike): RouteExecutionMode {
  const mode = (env.EXIT_ENGINE_UNVERIFIED_ROUTE_MODE ?? '').trim().toLowerCase().replaceAll('-', '_');
  return mode === 'dry_run' ? 'dry_run' : 'alert_only';
}

function routeExecutionMode(
  route: Pick<TokenRoute, 'backendPolicy' | 'verifiedSell' | 'allowancePreapproved' | 'decimals' | 'tokenAddress' | 'marketAddress' | 'approvalSpenderAddress'>,
  env: EnvLike,
): RouteExecutionMode {
  if (route.backendPolicy === 'alert_only') return 'alert_only';
  if (route.backendPolicy === 'okx_quote_only') return 'dry_run';
  if (
    route.decimals === null ||
    !route.verifiedSell ||
    !route.allowancePreapproved ||
    !isAddress(route.tokenAddress) ||
    !isAddress(route.marketAddress) ||
    !isAddress(route.approvalSpenderAddress)
  ) {
    return unverifiedRouteMode(env);
  }
  return 'live';
}

export function buildTokenRouteRegistryFromEnv(env: EnvLike = process.env): TokenRouteRegistry {
  const symbolsByToken = parseAddressValueEnv(env.EXIT_ENGINE_TOKEN_SYMBOLS ?? env.AUTO_SELL_TOKEN_SYMBOLS);
  const decimalsByToken = parseAddressNumberEnv(env.EXIT_ENGINE_TOKEN_DECIMALS ?? env.AUTO_SELL_TOKEN_DECIMALS);
  const marketsByToken = parseAddressValueEnv(env.EXIT_ENGINE_TOKEN_MARKETS ?? env.AUTO_SELL_TOKEN_MARKETS);
  const spendersByToken = parseAddressValueEnv(env.EXIT_ENGINE_TOKEN_SPENDERS ?? env.AUTO_SELL_TOKEN_SPENDERS);
  const backendByToken = parseAddressValueEnv(env.EXIT_ENGINE_BACKEND_POLICIES);
  const preapprovedPairs = parsePreapprovedPairs(env.EXIT_ENGINE_PREAPPROVED_ALLOWANCES ?? env.AUTO_SELL_PREAPPROVED_ALLOWANCES);
  const verifiedRoutes = parseVerifiedRoutes(env.EXIT_ENGINE_VERIFIED_SELL_ROUTES);
  const globalMarket = env.AUTO_SELL_MARKET_ADDRESS || DEFAULT_DIRECT_MARKET_ADDRESS;
  const globalSpender = env.AUTO_SELL_APPROVAL_SPENDER_ADDRESS || globalMarket;

  const tokens = new Set<string>([
    ...symbolsByToken.keys(),
    ...decimalsByToken.keys(),
    ...marketsByToken.keys(),
    ...spendersByToken.keys(),
    ...backendByToken.keys(),
  ]);
  for (const pair of preapprovedPairs) tokens.add(pair.split(':')[0]);
  for (const route of verifiedRoutes) tokens.add(route.split(':')[0]);

  const routes = [...tokens].sort().map((tokenAddress): TokenRoute => {
    const marketAddress = normalizeAddress(marketsByToken.get(tokenAddress) ?? globalMarket);
    const approvalSpenderAddress = normalizeAddress(spendersByToken.get(tokenAddress) ?? globalSpender);
    const verifiedSell = verifiedRoutes.has(`${tokenAddress}:${marketAddress}:${approvalSpenderAddress}`);
    const allowancePreapproved = preapprovedPairs.has(`${tokenAddress}:${approvalSpenderAddress}`);
    const routeBase = {
      tokenAddress,
      symbol: (symbolsByToken.get(tokenAddress) ?? 'UNKNOWN').trim().toUpperCase(),
      decimals: decimalsByToken.get(tokenAddress) ?? null,
      marketAddress,
      approvalSpenderAddress,
      backendPolicy: normalizeBackendPolicy(backendByToken.get(tokenAddress) ?? env.EXIT_ENGINE_BACKEND_POLICY),
      verifiedSell,
      allowancePreapproved,
    };
    return {
      ...routeBase,
      executionMode: routeExecutionMode(routeBase, env),
    };
  });

  return {
    routes,
    routesByToken: new Map(routes.map((route) => [route.tokenAddress, route])),
  };
}

export function getTokenRoute(registry: TokenRouteRegistry, tokenAddress: string): TokenRoute | undefined {
  return registry.routesByToken.get(normalizeAddress(tokenAddress));
}

export function validateTokenRoute(
  registry: TokenRouteRegistry,
  tokenAddress: string,
  options: {
    marketAddress?: string | null;
    approvalSpenderAddress?: string | null;
    requireVerifiedSell?: boolean;
    requirePreapprovedAllowance?: boolean;
    requireLive?: boolean;
  } = {},
): RouteValidationResult {
  const token = normalizeAddress(tokenAddress);
  const route = registry.routesByToken.get(token);
  const issues: RouteValidationIssue[] = [];
  const addIssue = (level: RouteIssueLevel, code: RouteValidationIssue['code'], message: string) => {
    issues.push({ level, code, message });
  };

  if (!route) {
    addIssue('error', 'route_missing', `route missing for token ${shortAddress(token)}`);
    return { ok: false, issues };
  }

  if (!isAddress(route.tokenAddress)) addIssue('error', 'invalid_token', `invalid token ${route.tokenAddress}`);
  if (!isAddress(route.marketAddress)) addIssue('error', 'invalid_market', `invalid market ${route.marketAddress}`);
  if (!isAddress(route.approvalSpenderAddress)) {
    addIssue('error', 'invalid_spender', `invalid spender ${route.approvalSpenderAddress}`);
  }
  if (route.decimals === null) addIssue('error', 'missing_decimals', `missing decimals for ${route.symbol}`);

  if (options.marketAddress && normalizeAddress(options.marketAddress) !== route.marketAddress) {
    addIssue('error', 'market_mismatch', `expected market ${shortAddress(route.marketAddress)}, got ${shortAddress(options.marketAddress)}`);
  }
  if (options.approvalSpenderAddress && normalizeAddress(options.approvalSpenderAddress) !== route.approvalSpenderAddress) {
    addIssue(
      'error',
      'spender_mismatch',
      `expected spender ${shortAddress(route.approvalSpenderAddress)}, got ${shortAddress(options.approvalSpenderAddress)}`,
    );
  }
  if (!route.verifiedSell) {
    addIssue(options.requireVerifiedSell ? 'error' : 'warning', 'route_unverified', `${route.symbol} route has no verified sell receipt`);
  }
  if (!route.allowancePreapproved) {
    addIssue(
      options.requirePreapprovedAllowance ? 'error' : 'warning',
      'allowance_not_preapproved',
      `${route.symbol} allowance is not marked as preapproved`,
    );
  }
  if (options.requireLive && route.executionMode !== 'live') {
    addIssue('error', 'route_not_live', `${route.symbol} execution mode is ${route.executionMode}`);
  }

  return {
    ok: issues.every((issue) => issue.level !== 'error'),
    route,
    issues,
  };
}
