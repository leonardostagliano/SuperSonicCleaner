const { spawnSync } = require('node:child_process')

function packageRelease(args, env = process.env, run = spawnSync) {
  const buildEnv = { ...env }
  const builderArgs = [...args]
  const hasCertificate = Boolean(buildEnv.CSC_LINK?.trim())

  if (!hasCertificate) {
    // electron-builder resolves an empty CSC_LINK to the checkout directory.
    delete buildEnv.CSC_LINK
    delete buildEnv.CSC_KEY_PASSWORD
  }

  if (
    buildEnv.RUNNER_OS === 'macOS' &&
    (!hasCertificate ||
      !buildEnv.APPLE_ID?.trim() ||
      !buildEnv.APPLE_APP_SPECIFIC_PASSWORD?.trim() ||
      !buildEnv.APPLE_TEAM_ID?.trim())
  ) {
    builderArgs.push('-c.mac.notarize=false')
  }

  const result = run(
    process.execPath,
    [require.resolve('electron-builder/cli.js'), ...builderArgs],
    {
      env: buildEnv,
      stdio: 'inherit'
    }
  )
  if (result.error) throw result.error
  return result.status ?? 1
}

if (require.main === module) {
  try {
    process.exitCode = packageRelease(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = { packageRelease }
