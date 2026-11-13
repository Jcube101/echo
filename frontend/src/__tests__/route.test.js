import { describe, expect, it } from 'vitest'
import { appIntent, isAppPath, wantsAutoRecord } from '../lib/route.js'

describe('isAppPath', () => {
  it('routes /app and anything under it to the app', () => {
    expect(isAppPath('/app')).toBe(true)
    expect(isAppPath('/app/')).toBe(true)
    expect(isAppPath('/app/clips/abc')).toBe(true)
  })

  it('routes everything else to the landing page', () => {
    expect(isAppPath('/')).toBe(false)
    expect(isAppPath('/about')).toBe(false)
    expect(isAppPath('/apple')).toBe(false)
  })
})

describe('wantsAutoRecord', () => {
  it('is true only for record=1', () => {
    expect(wantsAutoRecord('?record=1')).toBe(true)
    expect(wantsAutoRecord('?x=2&record=1')).toBe(true)
    expect(wantsAutoRecord('')).toBe(false)
    expect(wantsAutoRecord('?record=0')).toBe(false)
  })
})

describe('appIntent', () => {
  it('reads record, sample and samples from the query string', () => {
    expect(appIntent('')).toEqual({ record: false, sample: null, samples: false, owner: false })
    expect(appIntent('?owner=1')).toMatchObject({ owner: true })
    expect(appIntent('?record=1')).toMatchObject({ record: true })
    expect(appIntent('?sample=asian-koel')).toMatchObject({ sample: 'asian-koel' })
    expect(appIntent('?samples=1')).toMatchObject({ samples: true })
  })

  it('ignores a sample id that is not a plain slug', () => {
    expect(appIntent('?sample=../etc/passwd').sample).toBeNull()
    expect(appIntent('?sample=').sample).toBeNull()
  })
})
