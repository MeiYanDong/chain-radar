import 'dotenv/config';

export const RPC_URL = process.env.RPC_URL || 'https://mainnet.base.org';
export const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || '';
export const BLOCK_RANGE_SIZE = BigInt(process.env.BLOCK_RANGE_SIZE || '10000');

export const FAT_TOKEN = '0x3781934F9CC3B5157EAb5F663B144103409CFfFB' as const;
export const VIRTUAL_TOKEN = '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b' as const;
export const PAIR_POOL = '0xd331e7Bdce240342E452ab8C808E26f24DbBcffB' as const;
export const BONDING_V5 = '0x1A540088125d00dD3990f9dA45CA0859af4d3B01' as const;
export const FROUTER_V3 = '0x02FE8eC3d9BBf7318eb54590bcC39198a8b47deD' as const;
export const AGENT_TAX_V2 = '0x617Fd668c5b0d1906C0B3E7E3E49d1409Df0a528' as const;

export const FAT_DEPLOY_BLOCK = 44094087n;
export const TAX_RATE = 0.01;
export const DECIMALS = 18;

export const KNOWN_CONTRACTS = new Set([
  FAT_TOKEN.toLowerCase(),
  VIRTUAL_TOKEN.toLowerCase(),
  PAIR_POOL.toLowerCase(),
  BONDING_V5.toLowerCase(),
  FROUTER_V3.toLowerCase(),
  AGENT_TAX_V2.toLowerCase(),
  '0x0000000000000000000000000000000000000000',
]);
