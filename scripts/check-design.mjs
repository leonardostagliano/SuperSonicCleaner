#!/usr/bin/env node
// Design rules for the renderer and the it/en copy. See the spec, section 7.
//   node scripts/check-design.mjs                 compare with the baseline; fail on any increase
//   node scripts/check-design.mjs --list          list every violation with file:line
//   node scripts/check-design.mjs --strict a b …  fail if the given files/dirs have any violation
//   node scripts/check-design.mjs --update-baseline   rewrite the baseline (refuses increases)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const renderer = path.join(repo, 'src', 'renderer', 'src')
const baselineFile = path.join(repo, 'scripts', 'check-design.baseline.json')
const rel = (p) => path.relative(repo, p).split(path.sep).join('/')

const AI_FILES = [
  /^src\/renderer\/src\/components\/ai\//,
  /^src\/renderer\/src\/pages\/AiAnalysisPage\.tsx$/,
  /^src\/renderer\/src\/pages\/PerformanceDiagnosticsPage\.tsx$/
]
const ACRONYMS = new Set([
  'CPU',
  'GPU',
  'RAM',
  'SSD',
  'HDD',
  'NVME',
  'DNS',
  'SFC',
  'DISM',
  'SMART',
  'USB',
  'BIOS',
  'UEFI',
  'WPAD',
  'LLMNR',
  'IPV4',
  'IPV6',
  'TCP',
  'UDP',
  'VPN',
  'CVE',
  'MIT',
  'UAC',
  'PATH',
  'HTTP',
  'HTTPS',
  'JSON',
  'CSV',
  'WMI',
  'NTFS',
  'FAT32',
  'EXFAT',
  'MSI',
  'EXE',
  'DLL',
  'LNK',
  'TEMP',
  'ID',
  'OK',
  'CLI',
  'API',
  'URL',
  'PC',
  'OS',
  'TRIM',
  'SMB',
  'NTP',
  'MB',
  'GB',
  'TB',
  'KB'
])

const codeRules = [
  // Issue references such as `issue #269` or `(#462)` in comments are not colours.
  {
    id: 'colour-literal',
    re: /#[0-9a-fA-F]{3,8}\b(?<!issue #\d+)(?:(?<!\(#\d+)|(?!\)))|\brgba?\(|\bhsla?\(/g,
    skip: (f) => f.endsWith('design-tokens.css') || f.endsWith('.svg')
  },
  {
    id: 'gradient',
    re: /(?:linear|radial|conic)-gradient\(/g,
    skip: (f) => f.endsWith('design-tokens.css')
  },
  { id: 'backdrop', re: /backdrop-filter|backdrop-blur/g },
  { id: 'transition-all', re: /transition-all|transition:\s*all\b/g },
  { id: 'text-px', re: /text-\[\d+(?:\.\d+)?px\]/g, only: (f) => /\.(tsx|ts)$/.test(f) },
  {
    id: 'uppercase',
    re: /\buppercase\b|text-transform:\s*uppercase/g,
    skip: (f) => f.endsWith('brand-wordmark.css')
  },
  {
    id: 'sparkles',
    re: /\bSparkles\b/g,
    only: (f) => /\.(tsx|ts)$/.test(f),
    skip: (f) => AI_FILES.some((r) => r.test(f))
  },
  { id: 'forbidden-icon', re: /\b(?:Rocket|Flame|Wand2)\b/g, only: (f) => /\.(tsx|ts)$/.test(f) }
]

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return ['locales', 'dev-preview', 'assets'].includes(e.name) ? [] : walk(p)
    return /\.(tsx|ts|css)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : []
  })
}

function codeViolations(file) {
  const f = rel(file)
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const out = []
  for (const rule of codeRules) {
    if (rule.only && !rule.only(f)) continue
    if (rule.skip && rule.skip(f)) continue
    lines.forEach((line, i) => {
      if (line.includes('design-allow')) return
      for (const _ of line.matchAll(rule.re))
        out.push({ file: f, line: i + 1, rule: rule.id, text: line.trim().slice(0, 120) })
    })
  }
  return out
}

function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]
  )
}

function copyViolations(lang) {
  const dir = path.join(renderer, 'locales', lang)
  const out = []
  for (const name of fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    const f = rel(path.join(dir, name))
    for (const [key, value] of flatten(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')))) {
      if (typeof value !== 'string') continue
      const text = value.replace(/\{\{[^}]*\}\}/g, '').replace(/<[^>]+>/g, '')
      // Identifiers such as HKEY_CLASSES_ROOT are names, not shouting.
      const prose = text.replace(/\b[A-Z0-9]+(?:_[A-Z0-9]+)+\b/g, '')
      const words = prose.match(/[A-ZÀ-ÖØ-Ý]{4,}/g) || []
      const letters = prose.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '')
      const shouting =
        (letters.length >= 5 &&
          letters === letters.toUpperCase() &&
          !ACRONYMS.has(letters.toUpperCase())) ||
        words.filter((w) => !ACRONYMS.has(w)).length >= 2
      const push = (rule) => out.push({ file: f, line: key, rule, text: value.slice(0, 120) })
      if (shouting) push('copy-caps')
      if (/!(\s|$)/.test(text)) push('copy-exclaim')
      const lead = /^([^—]{2,40}) — /.exec(value)
      if (lead && !lead[1].includes('{{')) push('copy-lead-dash')
      if (lang === 'it' && /\bcur[ae]\b/i.test(text)) push('copy-cura')
    }
  }
  return out
}

function collect() {
  return [
    ...walk(renderer).flatMap(codeViolations),
    ...copyViolations('it'),
    ...copyViolations('en')
  ]
}

const count = (violations) => {
  const c = {}
  for (const v of violations) c[`${v.file}|${v.rule}`] = (c[`${v.file}|${v.rule}`] || 0) + 1
  return Object.fromEntries(Object.entries(c).sort(([a], [b]) => a.localeCompare(b)))
}
const readBaseline = () =>
  fs.existsSync(baselineFile) ? JSON.parse(fs.readFileSync(baselineFile, 'utf8')).counts : {}
const print = (vs) => vs.forEach((v) => console.log(`${v.file}:${v.line}  ${v.rule}  ${v.text}`))

const args = process.argv.slice(2)
const violations = collect()

if (args[0] === '--list') {
  print(violations)
  console.log(`${violations.length} violation(s)`)
} else if (args[0] === '--strict') {
  const targets = args.slice(1).map((a) => rel(path.resolve(repo, a)))
  const hits = violations.filter((v) =>
    targets.some((t) => v.file === t || v.file.startsWith(t.endsWith('/') ? t : `${t}/`))
  )
  print(hits)
  console.log(
    hits.length
      ? `FAIL: ${hits.length} violation(s) in the given files`
      : 'OK: no violations in the given files'
  )
  process.exit(hits.length ? 1 : 0)
} else {
  const now = count(violations)
  const base = readBaseline()
  const grown = Object.entries(now).filter(([k, n]) => n > (base[k] || 0))
  if (args[0] === '--update-baseline') {
    if (grown.length && !args.includes('--allow-increase')) {
      grown.forEach(([k, n]) => console.log(`increase: ${k} ${base[k] || 0} -> ${n}`))
      console.log('Refusing to raise the baseline.')
      process.exit(1)
    }
    // Two-space JSON is what Prettier (format:check) expects.
    fs.writeFileSync(baselineFile, JSON.stringify({ version: 1, counts: now }, null, 2) + '\n')
    console.log(
      `baseline: ${Object.values(now).reduce((a, b) => a + b, 0)} violation(s) in ${Object.keys(now).length} file/rule pair(s)`
    )
  } else {
    if (grown.length) {
      grown.forEach(([k, n]) => {
        console.log(`increase: ${k} ${base[k] || 0} -> ${n}`)
        const [file, rule] = k.split('|')
        print(violations.filter((v) => v.file === file && v.rule === rule))
      })
      console.log('FAIL: design violations increased (see the spec, section 7)')
      process.exit(1)
    }
    const total = Object.values(now).reduce((a, b) => a + b, 0)
    const baseTotal = Object.values(base).reduce((a, b) => a + b, 0)
    console.log(`OK: ${total} violation(s), baseline ${baseTotal}`)
  }
}
