import { describe, expect, it } from 'vitest'
import { isAppPath, wantsAutoRecord } from '../lib/route.js'

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
