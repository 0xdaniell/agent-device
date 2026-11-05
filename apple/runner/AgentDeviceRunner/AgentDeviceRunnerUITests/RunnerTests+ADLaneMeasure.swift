import Foundation

// MEASUREMENT ONLY (AD lane, 2026-11-05): never part of a PR. A file under ad-lane/toggles selects the
// base behaviour of one change at runtime, so base and candidate run in one runner session, interleaved.
func adLaneBase(_ name: String) -> Bool {
  FileManager.default.fileExists(atPath: "/Users/dev/ad-lane/toggles/base-\(name)")
}

func adLaneMark(_ label: String, _ startUptime: TimeInterval) {
  NSLog("AD_LANE_T %@ ms=%.1f", label, (ProcessInfo.processInfo.systemUptime - startUptime) * 1000)
}
