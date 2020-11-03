import { ExpoConfig } from '../Config.types';
import { ConfigPlugin } from '../Plugin.types';
import { addWarningAndroid } from '../WarningAggregator';
import { withAppBuildGradle } from '../plugins/android-plugins';

const DEFAULT_VERSION_NAME = '1.0';
const DEFAULT_VERSION_CODE = '1';

export const withVersion: ConfigPlugin<void> = config => {
  return withAppBuildGradle(config, config => {
    if (config.modResults.language === 'groovy') {
      config.modResults.contents = setVersionCode(config, config.modResults.contents);
      config.modResults.contents = setVersionName(config, config.modResults.contents);
    } else {
      addWarningAndroid(
        'android-version',
        `Cannot automatically configure app build.gradle if it's not groovy`
      );
    }
    return config;
  });
};

export function getVersionName(config: ExpoConfig) {
  return config.version ?? null;
}

export function setVersionName(
  config: ExpoConfig,
  buildGradle: string,
  versionToReplace = DEFAULT_VERSION_NAME
) {
  const versionName = getVersionName(config);
  if (versionName === null) {
    return buildGradle;
  }

  const pattern = new RegExp(`versionName "${versionToReplace}"`);
  return buildGradle.replace(pattern, `versionName "${versionName}"`);
}

export function getVersionCode(config: ExpoConfig) {
  return config.android?.versionCode ? config.android.versionCode : null;
}

export function setVersionCode(
  config: ExpoConfig,
  buildGradle: string,
  versionCodeToReplace = DEFAULT_VERSION_CODE
) {
  const versionCode = getVersionCode(config);
  if (versionCode === null) {
    return buildGradle;
  }

  const pattern = new RegExp(`versionCode ${versionCodeToReplace}`);
  return buildGradle.replace(pattern, `versionCode ${versionCode}`);
}
