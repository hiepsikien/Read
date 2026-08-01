const { withAppDelegate, WarningAggregator } = require("@expo/config-plugins");

const MARKER = "READ_METRO_HOST_FROM_IP_TXT";

const SET_JS_LOCATION_SNIPPET = `
#if DEBUG
    // ${MARKER}
    if let ipPath = Bundle.main.path(forResource: "ip", ofType: "txt"),
       let ip = try? String(contentsOfFile: ipPath).trimmingCharacters(in: .whitespacesAndNewlines),
       !ip.isEmpty {
      RCTBundleURLProvider.sharedSettings().jsLocation = ip
    }
#endif
`;

const BUNDLE_URL_SNIPPET = `
  override func bundleURL() -> URL? {
#if DEBUG
    // ${MARKER}
    let settings = RCTBundleURLProvider.sharedSettings()
    if settings.jsLocation == nil || settings.jsLocation?.isEmpty == true,
       let ipPath = Bundle.main.path(forResource: "ip", ofType: "txt"),
       let ip = try? String(contentsOfFile: ipPath).trimmingCharacters(in: .whitespacesAndNewlines),
       !ip.isEmpty {
      settings.jsLocation = ip
    }
    return settings.jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
`;

/**
 * Avoid first-launch "No script URL provided" on physical devices by seeding
 * RCTBundleURLProvider from the Metro host written into ip.txt at build time.
 */
function withMetroHostFromIpTxt(config) {
  return withAppDelegate(config, (config) => {
    if (config.modResults.language !== "swift") {
      WarningAggregator.addWarningIOS(
        "withMetroHostFromIpTxt",
        "AppDelegate is not Swift; skipped Metro host fix",
      );
      return config;
    }

    let contents = config.modResults.contents;
    if (contents.includes(MARKER)) {
      return config;
    }

    if (!contents.includes("factory.startReactNative(")) {
      WarningAggregator.addWarningIOS(
        "withMetroHostFromIpTxt",
        "Could not find factory.startReactNative; skipped Metro host seed",
      );
    } else {
      contents = contents.replace(
        "    factory.startReactNative(",
        `${SET_JS_LOCATION_SNIPPET}\n    factory.startReactNative(`,
      );
    }

    const bundleUrlMatch = contents.match(
      /  override func bundleURL\(\) -> URL\? \{[\s\S]*?\n  \}/,
    );
    if (!bundleUrlMatch) {
      WarningAggregator.addWarningIOS(
        "withMetroHostFromIpTxt",
        "Could not find bundleURL(); skipped Metro host fallback",
      );
    } else {
      contents = contents.replace(bundleUrlMatch[0], BUNDLE_URL_SNIPPET.trimEnd());
    }

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = withMetroHostFromIpTxt;
