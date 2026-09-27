const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const {
  verifyReleaseArtifacts,
  verifyUploadedAssets,
  writeChecksumManifest
} = require('./release-artifacts')

const FORK = 'leonardostagliano/SuperSonicCleaner'
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function compareVersions(left, right) {
  assert(stable.test(left) && stable.test(right), 'Expected stable semantic versions')
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

function nextVersion(version, messages) {
  const parts = version.split('.').map(Number)
  assert(stable.test(version), 'Expected a stable semantic version')
  if (
    messages.some((message) => /^(?:\w+(?:\([^\r\n)]+\))?!:|BREAKING[ -]CHANGE:)/m.test(message))
  ) {
    return `${parts[0] + 1}.0.0`
  }
  if (messages.some((message) => /^feat(?:\([^\r\n)]+\))?:/m.test(message))) {
    return `${parts[0]}.${parts[1] + 1}.0`
  }
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`
}

// Use published releases, not inherited upstream tags, as the version history.
function planRelease({ cwd = process.cwd(), releases, sha = 'HEAD' }) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  const ancestor = (before, after) => {
    const result = spawnSync('git', ['merge-base', '--is-ancestor', before, after], { cwd })
    assert(result.status === 0 || result.status === 1, 'Cannot verify release ancestry')
    return result.status === 0
  }
  const commit = git('rev-parse', `${sha}^{commit}`)
  const packageVersion = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8')).version
  assert(stable.test(packageVersion), 'package.json must contain a stable semantic version')
  const tags = new Set(git('tag', '--list').split('\n').filter(Boolean))
  const candidates = releases
    .filter(
      (release) =>
        !release.prerelease &&
        stable.test(release.tag_name?.replace(/^v/, '')) &&
        release.tag_name.startsWith('v')
    )
    .sort((a, b) => compareVersions(b.tag_name.slice(1), a.tag_name.slice(1)))
  const published = candidates.filter((release) => !release.draft)
  for (const release of published) {
    if (ancestor(commit, git('rev-parse', `${release.tag_name}^{commit}`))) {
      return { skip: true, tag: release.tag_name, commit }
    }
  }
  const previous = published[0]
  if (previous)
    assert(ancestor(previous.tag_name, commit), 'Latest release is not an ancestor of this commit')
  const baselineTag =
    previous?.tag_name ??
    (tags.has(`v${packageVersion}`) && ancestor(`v${packageVersion}`, commit)
      ? `v${packageVersion}`
      : null)
  const records = git(
    'log',
    '--format=%H%x00%B%x00',
    baselineTag ? `${baselineTag}..${commit}` : commit
  ).split('\0')
  const commits = []
  for (let index = 0; index + 1 < records.length; index += 2) {
    commits.push({ sha: records[index].trim(), message: records[index + 1].trim() })
  }
  const previousVersion = previous?.tag_name.slice(1)
  const base =
    previousVersion && compareVersions(previousVersion, packageVersion) > 0
      ? previousVersion
      : packageVersion
  const reusable = candidates.find(
    (release) => release.draft && release.target_commitish === commit
  )
  let version =
    reusable?.tag_name.slice(1) ??
    (previousVersion
      ? nextVersion(
          base,
          commits.map((entry) => entry.message)
        )
      : packageVersion)
  if (reusable)
    assert(
      compareVersions(version, base) >= (previousVersion ? 1 : 0),
      'Draft version is older than the release baseline'
    )
  while (
    !reusable &&
    (tags.has(`v${version}`) || candidates.some((release) => release.tag_name === `v${version}`))
  ) {
    version = nextVersion(version, [])
  }
  if (reusable && tags.has(`v${version}`)) {
    assert.equal(
      git('rev-parse', `v${version}^{commit}`),
      commit,
      'Draft tag belongs to another commit'
    )
  }
  return {
    skip: false,
    commit,
    version,
    tag: `v${version}`,
    previousTag: previous?.tag_name ?? null,
    commits
  }
}

function gh(...args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024
  }).trim()
}

function listReleases(repo) {
  return JSON.parse(
    gh('api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`)
  ).flat()
}

function releaseNotes(plan, repo) {
  return [
    `SuperSonicCleaner ${plan.version} for Windows, macOS and Linux.`,
    '',
    '## Changes',
    '',
    ...plan.commits.map(
      (entry) => `- ${entry.message.split(/\r?\n/)[0]} (${entry.sha.slice(0, 7)})`
    ),
    '',
    ...(plan.previousTag
      ? [
          `[Compare changes](https://github.com/${repo}/compare/${plan.previousTag}...${plan.tag})`,
          ''
        ]
      : []),
    '## Installation and updates',
    '',
    `- Install with SuperSonicCleaner-Setup-${plan.version}.exe. Installed copies receive updates from this repository.`,
    `- Portable: use SuperSonicCleaner-Portable-${plan.version}.exe or SuperSonicCleaner-Portable-${plan.version}-x64.zip. Close SuperSonicCleaner before replacing the portable files; settings are retained.`,
    '- In-app: About > Check for updates, download, then restart and install. Updates preserve your settings.',
    '- macOS: use the matching Intel/Apple Silicon DMG. Linux: choose AppImage for in-app updates, or the DEB for your package manager.',
    '- SHA256SUMS.txt lists checksums. Unsigned builds can trigger Windows SmartScreen; signing is optional for this fork.',
    '',
    `Source commit: ${plan.commit}`,
    ''
  ].join('\n')
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY
  assert.equal(repo, FORK, 'This release workflow publishes only to the configured fork')
  const planPath = process.env.RELEASE_PLAN
  assert(planPath, 'RELEASE_PLAN is required')
  const command = process.argv[2]
  if (command === 'prepare') {
    const plan = planRelease({
      releases: listReleases(repo),
      sha: process.env.GITHUB_SHA || 'HEAD'
    })
    writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`)
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `skip=${plan.skip}\nversion=${plan.version ?? ''}\ntag=${plan.tag}\n`
      )
    if (plan.skip) return
    console.log(`Prepared ${plan.tag} at ${plan.commit}`)
    return
  }
  const plan = JSON.parse(readFileSync(planPath, 'utf8'))
  if (plan.skip) return
  assert(stable.test(plan.version), 'Invalid planned version')
  assert.equal(plan.tag, `v${plan.version}`, 'Planned tag must match the version')
  assert.equal(
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    plan.commit,
    'Release plan does not match checkout'
  )
  if (command === 'version') {
    // CI-only changes: no bot commit, branch write, or tag push. The release creates the tag.
    for (const file of ['package.json', 'package-lock.json']) {
      const data = JSON.parse(readFileSync(file, 'utf8'))
      data.version = plan.version
      if (data.packages?.['']) data.packages[''].version = plan.version
      writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
    }
    console.log(`Prepared ${plan.tag} at ${plan.commit}`)
    return
  }
  assert.equal(
    command,
    'publish',
    'Usage: node scripts/automatic-release.js prepare|version|publish'
  )

  const directory = resolve('release-artifacts')
  const assets = await verifyReleaseArtifacts(directory, plan.tag)
  assets.push(await writeChecksumManifest(directory, assets))
  const existing = listReleases(repo).find((release) => release.tag_name === plan.tag)
  assert(
    !existing || (existing.draft && existing.target_commitish === plan.commit),
    'Release already published or draft belongs to another commit'
  )
  const notesPath = `${planPath}.md`
  writeFileSync(notesPath, releaseNotes(plan, repo))
  if (!existing)
    gh(
      'release',
      'create',
      plan.tag,
      '--repo',
      repo,
      '--draft',
      '--target',
      plan.commit,
      '--title',
      plan.tag,
      '--notes-file',
      notesPath
    )
  else gh('release', 'edit', plan.tag, '--repo', repo, '--notes-file', notesPath)
  gh(
    'release',
    'upload',
    plan.tag,
    '--repo',
    repo,
    ...assets.map((asset) => asset.path),
    '--clobber'
  )
  const release = listReleases(repo).find((entry) => entry.tag_name === plan.tag)
  const uploaded = JSON.parse(
    gh('api', '--paginate', '--slurp', `repos/${repo}/releases/${release.id}/assets?per_page=100`)
  ).flat()
  verifyUploadedAssets(assets, uploaded)
  gh('release', 'edit', plan.tag, '--repo', repo, '--draft=false', '--latest')
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `Published [${plan.tag}](https://github.com/${repo}/releases/tag/${plan.tag})\n`
    )
}

module.exports = { compareVersions, nextVersion, planRelease, releaseNotes }
if (require.main === module)
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
