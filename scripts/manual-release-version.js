const assert = require('node:assert/strict')
const { compareVersions } = require('./automatic-release')

// Automatic CI releases do not write their version back to package.json.
// Calculate before changing files so a manual release never reuses an existing tag.
function manualReleaseVersion(currentVersion, bump, tags) {
  assert(['patch', 'minor', 'major'].includes(bump), 'Expected patch, minor or major')
  const versions = tags
    .filter((tag) => /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag))
    .map((tag) => tag.slice(1))
  const baseline = [currentVersion, ...versions].sort(compareVersions).at(-1)
  const [major, minor, patch] = baseline.split('.').map(Number)
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

module.exports = { manualReleaseVersion }
