import JsonFile from '@expo/json-file';
import { spawnSync } from 'child_process';

import { AppJSONConfig, ConfigContext, ExpoConfig } from './Config.types';
import { ConfigError, errorFromJSON } from './Errors';
import { serializeAndEvaluate } from './Serialize';
import { DynamicConfigResults } from './evalConfig';

function isMissingFileCode(code: string): boolean {
  return ['ENOENT', 'MODULE_NOT_FOUND', 'ENOTDIR'].includes(code);
}

let _cachedConfig: DynamicConfigResults | null = null;

// Force re-evaluation of dynamic config
export function clearDynamicConfigCache() {
  _cachedConfig = null;
}

// We cannot use async config resolution right now because Next.js doesn't support async configs.
// If they don't add support for async Webpack configs then we may need to pull support for Next.js.
function readConfigFile(configFile: string, context: ConfigContext): null | DynamicConfigResults {
  try {
    if (context.useDynamicEval) {
      return spawnAndEvalConfig(configFile, context);
    } else if (!context.useDynamicEval && _cachedConfig === null) {
      _cachedConfig = spawnAndEvalConfig(configFile, context);
    }

    return _cachedConfig;
  } catch (error) {
    // If the file doesn't exist then we should skip it and continue searching.
    if (!isMissingFileCode(error.code)) {
      throw error;
    }
  }

  return null;
}

export function getDynamicConfig(configPath: string, request: ConfigContext): DynamicConfigResults {
  const config = readConfigFile(configPath, request);
  if (config) {
    // The config must be serialized and evaluated ahead of time so the spawned process can send it over.
    return config;
  }
  // TODO: It seems this is only thrown if the file cannot be found (which may never happen).
  // If so we should throw a more helpful error.
  throw new ConfigError(`Failed to read config at: ${configPath}`, 'INVALID_CONFIG');
}

export function getStaticConfig(configPath: string): AppJSONConfig | ExpoConfig {
  const config = JsonFile.read(configPath, { json5: true });
  if (config) {
    return config as any;
  }
  throw new ConfigError(`Failed to read config at: ${configPath}`, 'INVALID_CONFIG');
}

function spawnAndEvalConfig(configFile: string, request: ConfigContext): DynamicConfigResults {
  const spawnResults = spawnSync(
    'node',
    [
      require.resolve('@expo/config/build/scripts/read-config.js'),
      '--colors',
      configFile,
      JSON.stringify({ ...request, config: serializeAndEvaluate(request.config) }),
    ],
    { cwd: request.projectRoot || process.cwd() }
  );

  if (spawnResults.status === 0) {
    const spawnResultString = spawnResults.stdout.toString('utf8').trim();
    const logs = spawnResultString.split('\n');
    // Get the last console log to prevent parsing anything logged in the config.
    const lastLog = logs.pop()!;
    for (const log of logs) {
      // Log out the logs from the config
      console.log(log);
    }
    // Parse the final log of the script, it's the serialized config and exported object type.
    const results = JSON.parse(lastLog);
    return results;
  } else {
    // Parse the error data and throw it as expected
    const errorData = JSON.parse(spawnResults.stderr.toString('utf8'));
    throw errorFromJSON(errorData);
  }
}
