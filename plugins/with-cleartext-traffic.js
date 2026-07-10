const { withAndroidManifest } = require('@expo/config-plugins');

function ensureCleartextTraffic(manifest) {
  const application = Array.isArray(manifest.application) ? manifest.application : [];
  if (!application.length) {
    manifest.application = [{ $: {} }];
  }

  const appNode = manifest.application[0];
  appNode.$ = appNode.$ || {};
  appNode.$['android:usesCleartextTraffic'] = 'true';

  return manifest;
}

module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, (config) => {
    config.modResults.manifest = ensureCleartextTraffic(config.modResults.manifest);
    return config;
  });
};
