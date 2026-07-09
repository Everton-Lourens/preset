const { withAndroidManifest } = require('@expo/config-plugins');

function ensurePackageQuery(manifest, packageName) {
  const queries = Array.isArray(manifest.queries) ? manifest.queries : [];
  const alreadyExists = queries.some((query) => {
    const packages = Array.isArray(query.package) ? query.package : [];
    return packages.some((entry) => entry?.$?.['android:name'] === packageName);
  });

  if (!alreadyExists) {
    queries.push({
      package: [{ $: { 'android:name': packageName } }],
    });
  }

  manifest.queries = queries;
  return manifest;
}

module.exports = function withTermuxQueries(config) {
  return withAndroidManifest(config, (config) => {
    config.modResults.manifest = ensurePackageQuery(config.modResults.manifest, 'com.termux');
    return config;
  });
};
