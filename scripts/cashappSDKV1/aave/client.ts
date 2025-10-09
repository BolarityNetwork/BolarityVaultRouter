import { AaveClient } from "@aave/client";

type CreateConfig = Parameters<typeof AaveClient.create>[0];

type ResolvedConfig = CreateConfig extends undefined ? Record<string, unknown> : CreateConfig;

/**
 * Create an AaveClient instance using optional override configuration.
 * 如果你不设置 `AAVE_API_KEY` 也没关系，本函数会直接使用默认的公共配置；
 * 如果你有私有 key，只要放在环境变量里就会自动带上，便于提升配额或做追踪。
 */
export function buildAaveClient(config?: ResolvedConfig) {
    const finalConfig: Record<string, unknown> = { ...(config as Record<string, unknown> | undefined) };

    if (finalConfig.apiKey == null && process.env.AAVE_API_KEY) {
        finalConfig.apiKey = process.env.AAVE_API_KEY;
    }

    return AaveClient.create(finalConfig as ResolvedConfig);
}

/**
 * Default shared client used by examples/tests. Override locally if needed.
 */
export const client = buildAaveClient();
