const appJson = require("./app.json");

const IS_DEV = process.env.APP_VARIANT === "development";

module.exports = {
  expo: {
    ...appJson.expo,
    name: IS_DEV ? "Read Dev" : appJson.expo.name,
    scheme: IS_DEV ? "read-dev" : appJson.expo.scheme,
    ios: {
      ...appJson.expo.ios,
      bundleIdentifier: IS_DEV
        ? "com.nguyendinhanh.read.dev"
        : appJson.expo.ios.bundleIdentifier,
    },
    android: {
      ...appJson.expo.android,
      package: IS_DEV
        ? "com.nguyendinhanh.read.dev"
        : appJson.expo.android.package,
    },
  },
};
