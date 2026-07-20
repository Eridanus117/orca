import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('main entry bootstrap order', () => {
  it('runs the Fork bootstrap without moving the main bundle under chunks', () => {
    const mainSource = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const bootstrapSource = readFileSync(join(process.cwd(), 'src/main/bootstrap.ts'), 'utf8')
    const viteConfigSource = readFileSync(join(process.cwd(), 'electron.vite.config.ts'), 'utf8')

    expect(mainSource.indexOf("import './bootstrap'")).toBeLessThan(
      mainSource.indexOf("from 'node:fs'")
    )
    expect(bootstrapSource).not.toContain("import('./index')")
    expect(viteConfigSource).toContain("index: resolve('src/main/index.ts')")
    expect(viteConfigSource).not.toContain("index: resolve('src/main/bootstrap.ts')")
  })
})
