import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { compareVersions, nextVersion, planRelease } from './automatic-release'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    expect(dirname(directory)).toBe(realpathSync(tmpdir()))
    rmSync(directory, { recursive: true, force: true })
  }
})

function repository() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'supersonic-cleaner-release-')))
  directories.push(directory)
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Release Test')
  git('config', 'user.email', 'release@example.com')
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ version: '3.4.0' }))
  git('add', 'package.json')
  git('commit', '-m', 'chore(release): 3.4.0')
  git('tag', 'v3.4.0')
  const commit = (message: string) => {
    git('commit', '--allow-empty', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  return { directory, git, commit }
}

const release = (tag_name: string, draft = false, target_commitish = 'main') => ({
  tag_name,
  draft,
  target_commitish,
  prerelease: false
})

describe('fork automatic release planning', { timeout: 30_000 }, () => {
  it('compares numeric components and classifies Conventional Commits', () => {
    expect(compareVersions('3.10.0', '3.9.9')).toBeGreaterThan(0)
    expect(nextVersion('3.4.0', ['fix(updates): retry'])).toBe('3.4.1')
    expect(nextVersion('3.4.0', ['feat(ui): refresh'])).toBe('3.5.0')
    expect(nextVersion('3.4.0', ['feat(ui)!: replace shell'])).toBe('4.0.0')
    expect(nextVersion('3.4.0', ['fix: change\n\nBREAKING CHANGE: removed support'])).toBe('4.0.0')
  })

  it('does not treat inherited upstream tags as published fork releases', () => {
    const repo = repository()
    repo.commit('fix(updates): point at fork')
    const plan = planRelease({ cwd: repo.directory, releases: [] })
    expect(plan.skip).toBe(false)
    expect(plan.version).toBe('3.4.1')
    expect(plan.previousTag).toBeNull()
    expect(plan.commits).toHaveLength(1)
  })

  it('uses the latest published version even when package.json remains unchanged', () => {
    const repo = repository()
    repo.commit('fix: first fork release')
    repo.git('tag', 'v3.4.1')
    repo.commit('feat(ui): new dashboard')
    const plan = planRelease({ cwd: repo.directory, releases: [release('v3.4.1')] })
    expect(plan.version).toBe('3.5.0')
    expect(plan.previousTag).toBe('v3.4.1')
    expect(plan.commits).toHaveLength(1)
  })

  it('skips reruns and commits already covered by a newer release', () => {
    const repo = repository()
    const earlier = repo.git('rev-parse', 'HEAD')
    repo.commit('fix: release')
    repo.git('tag', 'v3.4.1')
    expect(planRelease({ cwd: repo.directory, releases: [release('v3.4.1')] }).skip).toBe(true)
    expect(
      planRelease({ cwd: repo.directory, releases: [release('v3.4.1')], sha: earlier }).skip
    ).toBe(true)
  })

  it('reuses an unfinished draft only for the same source commit', () => {
    const repo = repository()
    const head = repo.commit('fix: release')
    const plan = planRelease({ cwd: repo.directory, releases: [release('v3.4.1', true, head)] })
    expect(plan.tag).toBe('v3.4.1')
    expect(plan.commit).toBe(head)
    const next = repo.commit('fix: followup')
    const later = planRelease({ cwd: repo.directory, releases: [release('v3.4.1', true, head)] })
    expect(later.tag).toBe('v3.4.2')
    expect(later.commit).toBe(next)
  })

  it('rejects a published release from an unrelated branch', () => {
    const repo = repository()
    repo.git('checkout', '-b', 'other')
    repo.commit('fix: unrelated')
    repo.git('tag', 'v3.4.1')
    repo.git('checkout', 'main')
    repo.commit('fix: main')
    expect(() => planRelease({ cwd: repo.directory, releases: [release('v3.4.1')] })).toThrow(
      'not an ancestor'
    )
  })

  it('does not reuse a draft whose tag points at another commit', () => {
    const repo = repository()
    repo.git('tag', 'v3.4.1')
    const head = repo.commit('fix: main')
    expect(() =>
      planRelease({ cwd: repo.directory, releases: [release('v3.4.1', true, head)] })
    ).toThrow('another commit')
  })
})
