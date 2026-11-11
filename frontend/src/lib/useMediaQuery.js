import { useEffect, useState } from 'react'

// True while the CSS media query matches. Used to RENDER one layout or the
// other (not just hide one with CSS), so the same text never exists twice in
// the DOM. Safe where matchMedia is missing (jsdom): reports false.
export function useMediaQuery(query) {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}
