const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const apiClientRoot = path.resolve(projectRoot, "../../packages/api-client");

const config = getDefaultConfig(projectRoot);

// `@read/api-client` is linked with `file:` and its source lives outside the
// Expo project root, so Metro has to watch it explicitly and resolve it by path
// instead of relying on node_modules symlink traversal.
config.watchFolders = [apiClientRoot];
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "@read/api-client": apiClientRoot,
};

module.exports = config;
