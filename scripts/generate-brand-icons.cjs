/*
 * Rebuild the application/tray assets from their SVG sources.
 * Install the optional artwork tool locally with:
 * npm install --prefix .cache/brand-tools --no-save --package-lock=false sharp
 * Then: node scripts/generate-brand-icons.cjs
 */
const { readFile, writeFile } = require('node:fs/promises')
const { join, resolve } = require('node:path')
const root = resolve(__dirname, '..')
const sharp = require(require.resolve('sharp', { paths: [join(root, '.cache/brand-tools'), root] }))

function makeIco(images) {
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16
    header[entry] = size === 256 ? 0 : size
    header[entry + 1] = size === 256 ? 0 : size
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...images.map(({ png }) => png)])
}

function makeIcns(images) {
  const types = new Map([
    [16, 'icp4'],
    [32, 'icp5'],
    [64, 'icp6'],
    [128, 'ic07'],
    [256, 'ic08'],
    [512, 'ic09'],
    [1024, 'ic10']
  ])
  const entries = images.map(({ size, png }) => {
    const header = Buffer.alloc(8)
    header.write(types.get(size), 0, 'ascii')
    header.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([header, png])
  })
  const header = Buffer.alloc(8)
  header.write('icns', 0, 'ascii')
  header.writeUInt32BE(8 + entries.reduce((sum, entry) => sum + entry.length, 0), 4)
  return Buffer.concat([header, ...entries])
}

async function main() {
  const source = await readFile(join(root, 'resources/branding/supersonic-cleaner.svg'))
  const tray = await readFile(join(root, 'resources/branding/supersonic-tray.svg'))
  const render = (svg, size) => sharp(svg).resize(size, size).png().toBuffer()
  const iconImages = new Map()
  for (const [file, size] of [
    ['resources/icon.png', 1024],
    ['logo.png', 512],
    ['src/renderer/src/assets/logo.png', 256]
  ]) {
    const png = await render(source, size)
    iconImages.set(size, png)
    await writeFile(join(root, file), png)
  }
  for (const size of [16, 32, 48, 64, 128, 256, 512]) {
    const png = iconImages.get(size) ?? (await render(source, size))
    iconImages.set(size, png)
    await writeFile(join(root, `resources/icons/${size}x${size}.png`), png)
  }
  for (const size of [16, 20, 24, 28, 32, 36, 40, 48]) {
    await writeFile(
      join(root, `resources/icons/tray/${size}x${size}.png`),
      await render(tray, size)
    )
  }
  await writeFile(join(root, 'resources/icons/tray/master.png'), await render(tray, 256))
  iconImages.set(1024, iconImages.get(1024) ?? (await render(source, 1024)))
  await writeFile(
    join(root, 'resources/icon.ico'),
    makeIco([16, 32, 48, 256].map((size) => ({ size, png: iconImages.get(size) })))
  )
  await writeFile(
    join(root, 'resources/icon.icns'),
    makeIcns([16, 32, 64, 128, 256, 512, 1024].map((size) => ({ size, png: iconImages.get(size) })))
  )
  console.log('Generated SuperSonicCleaner application, installer and tray icons.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
