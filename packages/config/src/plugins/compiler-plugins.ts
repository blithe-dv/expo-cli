import { ExpoConfig } from '@expo/config-types';
import { JSONObject } from '@expo/json-file';
import plist from '@expo/plist';
import { readFile, writeFile } from 'fs-extra';
import path from 'path';
import { XcodeProject } from 'xcode';

import { ConfigPlugin, ExportedConfig, ExportedConfigWithProps } from '../Plugin.types';
import { addWarningIOS } from '../WarningAggregator';
import { getEntitlementsPath } from '../ios/Entitlements';
import { InfoPlist } from '../ios/IosConfig.types';
import { getPbxproj, getProjectName } from '../ios/utils/Xcodeproj';
import { withInterceptedMod } from './core-plugins';

export function withCoreMods(config: ExportedConfig, projectRoot: string): ExportedConfig {
  config = applyIOSCoreMods(projectRoot, config);
  config = applyAndroidCoreMods(projectRoot, config);
  return config;
}

export function resolveModResults(results: any, platformName: string, modName: string) {
  // If the results came from a mod, they'd be in the form of [config, data].
  // Ensure the results are an array and omit the data since it should've been written by a data provider plugin.
  const ensuredResults = results;

  // Sanity check to help locate non compliant mods.
  if (!ensuredResults || typeof ensuredResults !== 'object' || !ensuredResults?.mods) {
    throw new Error(
      `Mod \`mods.${platformName}.${modName}\` evaluated to an object that is not a valid project config. Instead got: ${JSON.stringify(
        ensuredResults
      )}`
    );
  }
  return ensuredResults;
}

function applyAndroidCoreMods(projectRoot: string, config: ExportedConfig): ExportedConfig {
  // TODO: Support android mods
  return config;
}

function applyIOSCoreMods(projectRoot: string, config: ExportedConfig): ExportedConfig {
  const { iosProjectDirectory, supportingDirectory } = getIOSPaths(projectRoot, config);

  // Append a rule to supply Info.plist data to mods on `mods.ios.infoPlist`
  config = withInterceptedMod<InfoPlist>(config, {
    platform: 'ios',
    mod: 'infoPlist',
    async action({ modRequest: { nextMod, ...modRequest }, ...config }) {
      let results: ExportedConfigWithProps<JSONObject> = {
        ...config,
        modRequest,
      };

      // Apply all of the Info.plist values to the expo.ios.infoPlist object
      // TODO: Remove this in favor of just overwriting the Info.plist with the Expo object. This will enable people to actually remove values.
      if (!config.ios) {
        config.ios = {};
      }
      if (!config.ios.infoPlist) {
        config.ios.infoPlist = {};
      }

      const filePath = path.resolve(iosProjectDirectory, 'Info.plist');
      let data = plist.parse(await readFile(filePath, 'utf8'));

      config.ios.infoPlist = {
        ...(data || {}),
        ...config.ios.infoPlist,
      };
      // TODO: Fix type
      results = await nextMod!({
        ...config,
        modRequest,
        modResults: config.ios.infoPlist as InfoPlist,
      });
      resolveModResults(results, modRequest.platform, modRequest.modName);
      data = results.modResults;

      await writeFile(filePath, plist.build(data));

      return results;
    },
  });

  // Append a rule to supply Expo.plist data to mods on `mods.ios.expoPlist`
  config = withInterceptedMod<JSONObject>(config, {
    platform: 'ios',
    mod: 'expoPlist',
    async action({ modRequest: { nextMod, ...modRequest }, ...config }) {
      let results: ExportedConfigWithProps<JSONObject> = {
        ...config,
        modRequest,
      };

      try {
        const filePath = path.resolve(supportingDirectory, 'Expo.plist');
        let modResults = plist.parse(await readFile(filePath, 'utf8'));

        // TODO: Fix type
        results = await nextMod!({
          ...config,
          modResults,
          modRequest,
        });
        resolveModResults(results, modRequest.platform, modRequest.modName);
        modResults = results.modResults;

        await writeFile(filePath, plist.build(modResults));
      } catch (error) {
        addWarningIOS(
          'updates',
          'Expo.plist configuration could not be applied. You will need to create Expo.plist if it does not exist and add Updates configuration manually.',
          'https://docs.expo.io/bare/updating-your-app/#configuration-options'
        );
      }
      return results;
    },
  });

  // Append a rule to supply .xcodeproj data to mods on `mods.ios.xcodeproj`
  config = withInterceptedMod<XcodeProject>(config, {
    platform: 'ios',
    mod: 'xcodeproj',
    async action({ modRequest: { nextMod, ...modRequest }, ...config }) {
      const modResults = getPbxproj(projectRoot);
      // TODO: Fix type
      const results = await nextMod!({
        ...config,
        modResults,
        modRequest,
      });
      resolveModResults(results, modRequest.platform, modRequest.modName);
      const resultData = results.modResults;
      await writeFile(resultData.filepath, resultData.writeSync());
      return results;
    },
  });

  config = withEntitlementsBaseMod(config);

  return config;
}

const withEntitlementsBaseMod: ConfigPlugin<void> = config => {
  // Append a rule to supply .entitlements data to mods on `mods.ios.entitlements`
  return withInterceptedMod<JSONObject>(config, {
    platform: 'ios',
    mod: 'entitlements',
    async action({ modRequest: { nextMod, ...modRequest }, ...config }) {
      const entitlementsPath = getEntitlementsPath(modRequest.projectRoot);

      let results: ExportedConfigWithProps<JSONObject> = {
        ...config,
        modRequest,
      };

      try {
        const data = plist.parse(await readFile(entitlementsPath, 'utf8'));
        // Apply all of the .entitlements values to the expo.ios.entitlements object
        // TODO: Remove this in favor of just overwriting the .entitlements with the Expo object. This will enable people to actually remove values.
        if (!config.ios) {
          config.ios = {};
        }
        if (!config.ios.entitlements) {
          config.ios.entitlements = {};
        }

        config.ios.entitlements = {
          ...(data || {}),
          ...config.ios.entitlements,
        };

        // TODO: Fix type
        results = await nextMod!({
          ...config,
          modRequest,
          modResults: config.ios.entitlements as JSONObject,
        });
        resolveModResults(results, modRequest.platform, modRequest.modName);
        await writeFile(entitlementsPath, plist.build(results.modResults));
      } catch (error) {
        addWarningIOS('entitlements', `${entitlementsPath} configuration could not be applied.`);
      }
      return results;
    },
  });
};

// TODO: come up with a better solution for using app.json expo.name in various places
function sanitizedName(name: string) {
  return name
    .replace(/[\W_]+/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// TODO: it's silly and kind of fragile that we look at app config to determine
// the ios project paths. Overall this function needs to be revamped, just a
// placeholder for now! Make this more robust when we support applying config
// at any time (currently it's only applied on eject).
function getIOSPaths(projectRoot: string, exp: ExpoConfig) {
  let projectName: string | null = null;

  // Attempt to get the current ios folder name (apply).
  try {
    projectName = getProjectName(projectRoot);
  } catch {
    // If no iOS project exists then create a new one (eject).
    projectName = exp.name;
    if (!projectName) {
      throw new Error('Your project needs a name in app.json/app.config.js.');
    }
    projectName = sanitizedName(projectName);
  }

  const iosProjectDirectory = path.join(projectRoot, 'ios', projectName);
  const iconPath = path.join(iosProjectDirectory, 'Assets.xcassets', 'AppIcon.appiconset');
  const supportingDirectory = path.join(iosProjectDirectory, 'Supporting');
  return {
    projectName,
    supportingDirectory,
    iosProjectDirectory,
    iconPath,
  };
}
