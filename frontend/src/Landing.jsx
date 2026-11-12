import React, { useEffect } from 'react'
import {
  ArrowRight, ExternalLink, Library, ListMusic, Mic, Move3d, Play, Plus, Upload,
} from 'lucide-react'
import Wordmark from './components/Wordmark.jsx'
import { SAMPLES, thumbFor, providerName } from './lib/sampleArt.js'
import heroTrails from './assets/landing/hero-trails.svg?raw'
import viewTrail from './assets/landing/view-trail.svg?raw'
import viewSpectral from './assets/landing/view-spectral.svg?raw'

// Landing page (DESIGN_V2.md §4.1–4.2, copy from §5). Static: no API calls, no
// 3D — the illustrations and sample details are generated once by
// build_landing_art.py. One responsive component covers desktop and phone.
//
// Copy rule (Job, 2026-11-12): no bird / species / identification language
// here. Sample names and credits are the only exception.

const APP = '/app'
const RECORD = '/app?record=1'
const LIBRARY = '/app?samples=1'
const sampleHref = (id) => `/app?sample=${id}`

// The four samples shown as cards; the rest become chips.
const FEATURED_IDS = ['asian-koel', 'lion-roar', 'wolf-howl', 'cricket-chirp']
const FEATURED = FEATURED_IDS.map((id) => SAMPLES.find((s) => s.id === id)).filter(Boolean)
const OTHERS = SAMPLES.filter((s) => !FEATURED.includes(s))

const FAQ = [
  ['What am I looking at?',
    'Each point is one moment of sound, about fifty every second. Where it sits shows its pitch (high or low), timbre (bright or dark) and motion (steady or busy). Bigger, brighter points are louder.'],
  ['Does it tell me what made the sound?',
    'No. Echo shows the shape of any sound, whatever made it. It doesn’t try to name the source.'],
  ['What can I put in?',
    'Record up to 60 seconds in your browser, or upload MP3, WAV, M4A, Opus, or a video file, up to 20 MB.'],
  ['How long does it take?',
    'A few seconds for most clips. Even a full minute is ready in under ten seconds.'],
  ['Is my audio kept?',
    'Only a small copy for playback. The original file is discarded after analysis, the mic is never left on, and History keeps your last 50 clips.'],
  ['Can I compare two sounds?',
    'Yes, by eye. Every clip is drawn in the same fixed box, so a high note sits high in every one of them.'],
  ['Where do the sample sounds come from?',
    'Xeno-canto and Freesound, used under Creative Commons licences. Each sample shows its recordist and licence.'],
]

const WRAP = 'mx-auto w-full max-w-[1280px] px-5 sm:px-10'
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2'
const BTN = 'inline-flex h-[52px] items-center justify-center gap-2.5 rounded-full px-6 text-base font-semibold transition-colors ' + FOCUS
const BTN_RUST = BTN + ' bg-rust text-white hover:bg-[#A44A25] focus-visible:ring-rust'

function Eyebrow({ className = '', children }) {
  return (
    <div className={'font-mono text-[13px] uppercase tracking-[0.12em] ' + className}>{children}</div>
  )
}

// Inline (not <img>) so the SVG's labels use the page's own fonts.
function Art({ svg, label, className = '' }) {
  return (
    <div
      role="img"
      aria-label={label}
      className={'[&>svg]:block [&>svg]:h-auto [&>svg]:w-full ' + className}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

function Nav() {
  return (
    <header className="border-b border-paper-line">
      <div className={WRAP + ' flex h-[72px] items-center justify-between gap-6'}>
        <Wordmark as="span" className="min-h-11 text-ink" />
        <nav aria-label="Sections" className="hidden items-center gap-8 text-[15px] font-medium text-ink md:flex">
          {[['How it works', '#how-it-works'], ['Two views', '#two-views'], ['Samples', '#samples'], ['FAQ', '#faq']].map(([t, h]) => (
            <a key={h} href={h} className={'inline-flex min-h-11 items-center rounded hover:text-rust-link focus-visible:ring-rust ' + FOCUS}>{t}</a>
          ))}
        </nav>
        <a href={APP} className={'inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-[15px] font-semibold text-paper hover:bg-black focus-visible:ring-ink ' + FOCUS}>
          <span className="sm:hidden">Open</span>
          <span className="hidden sm:inline">Open Echo</span>
          <ArrowRight className="h-4 w-4" aria-hidden />
        </a>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className={WRAP + ' grid items-center gap-10 py-10 sm:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16 lg:py-20'}>
      <div>
        <Eyebrow className="text-rust-link">Sound, made visible</Eyebrow>
        <h1 className="mt-4 font-display text-[52px] font-semibold leading-[1.02] tracking-tight text-ink lg:text-[92px]">
          Every sound has a shape.
        </h1>
        <p className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-ink-2 lg:text-[21px]">
          <span className="sm:hidden">
            Record a sound in the park or drop in a clip. Echo traces it as a path you can turn and replay.
          </span>
          <span className="hidden sm:inline">
            Record a sound in the park, drop in a clip, or start with a sample. Echo traces the sound as a
            path through pitch, timbre and motion, and plays it back in step.
          </span>
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a href={RECORD} className={BTN_RUST}>
            <Mic className="h-[18px] w-[18px]" aria-hidden />
            Record a sound
          </a>
          <a href={APP} className={BTN + ' border border-ink text-ink hover:bg-paper-2 focus-visible:ring-ink'}>
            <Upload className="h-[18px] w-[18px]" aria-hidden />
            Upload a clip
          </a>
        </div>
        <p className="mt-5 text-center text-sm text-ink-3 sm:text-left">
          <span className="sm:hidden">Up to 60 s · audio or video · 20 MB max</span>
          <span className="hidden sm:inline">Up to 60 seconds · MP3, WAV, M4A, Opus or video · Up to 20 MB</span>
        </p>
      </div>

      <figure className="rounded-[28px] bg-night p-5 text-cream shadow-[0_24px_60px_-20px_rgba(31,42,34,0.45)] sm:p-6">
        <div className="flex items-center justify-between font-mono text-xs uppercase tracking-[0.12em] text-[#A9B0A0]">
          <span>Five samples · one box</span>
          <span className="hidden normal-case tracking-normal sm:inline">fixed scale</span>
        </div>
        <Art
          svg={heroTrails}
          label="Five sample sounds — Lion, Wolf, Common Myna, Asian Koel and Cricket — each drawn as a cluster of points in a different part of the same three-dimensional box."
          className="mt-2"
        />
        <figcaption className="text-sm text-[#A9B0A0]">
          Every clip shares the same box, so any two can be compared at a glance.
        </figcaption>
      </figure>
    </section>
  )
}

const STEPS = [
  [Mic, 'Record or upload', 'Up to a minute of any sound'],
  [ListMusic, 'Echo listens', 'Ready in a few seconds'],
  [Move3d, 'Turn it in your hands', 'Orbit, scrub and replay'],
]
const READING = [['Pitch', 'high or low'], ['Timbre', 'bright or dark'], ['Motion', 'steady or busy'], ['Size', 'loud or soft']]

function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-h" className="scroll-mt-4 bg-paper-2">
      <div className={WRAP + ' py-10 sm:py-12'}>
        <h2 id="how-h" className="sr-only">How it works</h2>
        <ol className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
          {STEPS.map(([Icon, title, sub], i) => (
            <React.Fragment key={title}>
              {i > 0 && <li aria-hidden className="hidden text-ink-3 lg:block"><ArrowRight className="h-5 w-5" /></li>}
              <li className="flex items-center gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-paper text-ink">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span>
                  <span className="block font-display text-xl font-semibold text-ink">{title}</span>
                  <span className="block text-[15px] text-ink-2">{sub}</span>
                </span>
              </li>
            </React.Fragment>
          ))}
        </ol>
        <div className="mt-8 flex flex-col gap-4 border-t border-paper-line pt-6 lg:flex-row lg:items-center lg:gap-6">
          <Eyebrow className="text-rust-link">Reading the trail</Eyebrow>
          <ul className="flex flex-wrap gap-2.5">
            {READING.map(([k, v]) => (
              <li key={k} className="rounded-full border border-paper-line bg-paper px-4 py-2 text-[15px] text-ink-2">
                <span className="font-semibold text-ink">{k}</span> {v}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function TwoViews() {
  const CARD = 'rounded-[24px] border border-night-line bg-night-2 p-5 sm:p-6'
  return (
    <section id="two-views" aria-labelledby="views-h" className="scroll-mt-4 bg-night text-cream">
      <div className={WRAP + ' py-14 sm:py-20'}>
        <Eyebrow className="text-amber">Two ways to look</Eyebrow>
        <h2 id="views-h" className="mt-4 max-w-[16em] font-display text-[30px] font-semibold leading-[1.1] tracking-tight lg:text-[56px]">
          Turn it in 3D, or read it line by line
        </h2>
        <div className="mt-8 grid gap-5 lg:mt-12 lg:grid-cols-2">
          <article className={CARD}>
            <Art svg={viewTrail} label="A single sound drawn as a trail of points inside a box, with a ring marking the moment being played." />
            <h3 className="mt-4 font-display text-2xl font-semibold">3D Trail</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-[#A9B0A0] sm:text-base">
              The whole clip as one path. Drag to orbit, and watch the glowing point travel as it plays.
            </p>
          </article>
          <article className={CARD}>
            <Art svg={viewSpectral} label="Seven coloured lines stacked in lanes over the same time axis, crossed by a vertical playhead." />
            <h3 className="mt-4 font-display text-2xl font-semibold">Spectral panel</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-[#A9B0A0] sm:text-base">
              Seven finer measures over time — spread, crest, contrast, slope, flatness, harmonics-to-noise
              and tonality. Hover for exact values.
            </p>
          </article>
        </div>
      </div>
    </section>
  )
}

function Thumb({ id, className }) {
  const src = thumbFor(id)
  if (!src) return <div className={className + ' bg-[#16201A]'} aria-hidden />
  // Decorative: the card text already names the sound.
  return <img src={src} alt="" width="168" height="48" loading="lazy" decoding="async" className={className + ' object-cover'} />
}

function SampleCard({ s }) {
  return (
    <li className="flex flex-col rounded-[20px] bg-night-3 p-4">
      <Thumb id={s.id} className="h-[84px] w-full rounded-[10px]" />
      <h3 className="mt-4 font-display text-xl font-semibold text-cream">{s.species}</h3>
      {s.sci_name && <div className="text-sm italic text-[#A9B0A0]">{s.sci_name}</div>}
      <div className="mt-3 text-[13px] leading-relaxed text-[#A9B0A0]">
        <div>{s.duration_s.toFixed(1)} s · rec. {s.recordist}</div>
        <div>
          <a href={s.license_url} target="_blank" rel="noopener noreferrer" className={'rounded underline decoration-dotted underline-offset-2 hover:text-cream focus-visible:ring-amber focus-visible:ring-offset-night-3 ' + FOCUS}>{s.license}</a>
          {' · '}
          <a href={s.source_url} target="_blank" rel="noopener noreferrer" className={'inline-flex items-center gap-1 rounded text-amber hover:underline focus-visible:ring-amber focus-visible:ring-offset-night-3 ' + FOCUS}>
            {providerName(s)}
            <ExternalLink className="h-3 w-3" aria-hidden />
            <span className="sr-only">(source page for {s.species}, opens in a new tab)</span>
          </a>
        </div>
      </div>
      <a
        href={sampleHref(s.id)}
        className={'mt-4 inline-flex h-11 items-center gap-2 self-start rounded-full border border-night-line px-4 text-sm font-semibold text-cream hover:bg-night-2 focus-visible:ring-amber focus-visible:ring-offset-night-3 ' + FOCUS}
      >
        <Play className="h-3 w-3 fill-current" aria-hidden />
        {/* The accessible name must contain the visible words (Lighthouse:
            label-content-name-mismatch), so the sample name is appended
            for screen readers rather than replacing the label. */}
        See its shape<span className="sr-only">: {s.species}</span>
      </a>
    </li>
  )
}

function SampleRow({ s }) {
  return (
    <li>
      <a
        href={sampleHref(s.id)}
        className={'flex items-center gap-4 rounded-[16px] bg-night-3 p-3 focus-visible:ring-amber focus-visible:ring-offset-night-2 ' + FOCUS}
      >
        <Thumb id={s.id} className="h-12 w-[92px] shrink-0 rounded-lg" />
        <span className="min-w-0 flex-1">
          <span className="sr-only">See its shape: </span>
          <span className="block font-display text-lg font-semibold text-cream">{s.species}</span>
          <span className="block text-sm text-[#A9B0A0]">{Math.round(s.duration_s)} s · {providerName(s)}</span>
        </span>
        <Play className="mr-2 h-3.5 w-3.5 shrink-0 fill-current text-amber" aria-hidden />
      </a>
    </li>
  )
}

function Samples() {
  const LIB_LINK = 'inline-flex min-h-11 items-center gap-2 rounded text-base font-semibold text-amber hover:underline focus-visible:ring-amber focus-visible:ring-offset-night-2 ' + FOCUS
  return (
    <section id="samples" aria-labelledby="samples-h" className="scroll-mt-4 border-t border-night-line bg-night-2 text-cream">
      <div className={WRAP + ' py-14 sm:py-20'}>
        <Eyebrow className="hidden text-amber sm:block">Nothing to record yet?</Eyebrow>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 sm:mt-4">
          <h2 id="samples-h" className="max-w-[14em] font-display text-[32px] font-semibold leading-[1.1] tracking-tight lg:text-[56px]">
            <span className="sm:hidden">Start with a sample</span>
            <span className="hidden sm:inline">Start with one of {SAMPLES.length} sample sounds</span>
          </h2>
          <a href={LIBRARY} className={LIB_LINK + ' hidden sm:inline-flex'}>
            Open the sample library <ArrowRight className="h-4 w-4" aria-hidden />
          </a>
        </div>

        {/* Desktop/tablet: four cards + chips for the rest */}
        <ul className="mt-10 hidden gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-4">
          {FEATURED.map((s) => <SampleCard key={s.id} s={s} />)}
        </ul>
        <div className="mt-8 hidden flex-wrap items-center gap-2.5 sm:flex">
          <span className="mr-1 text-sm text-[#A9B0A0]" id="also-h">Also in the library:</span>
          <ul aria-labelledby="also-h" className="contents">
            {OTHERS.map((s) => (
              <li key={s.id}>
                <a href={sampleHref(s.id)} className={'inline-flex h-11 items-center rounded-full border border-night-line px-4 text-sm font-medium text-cream hover:bg-night-3 focus-visible:ring-amber focus-visible:ring-offset-night-2 ' + FOCUS}>
                  {s.species}
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* Phone: a compact list */}
        <ul className="mt-6 space-y-3 sm:hidden">
          {FEATURED.map((s) => <SampleRow key={s.id} s={s} />)}
        </ul>
        <div className="mt-6 text-center sm:hidden">
          <a href={LIBRARY} className={LIB_LINK + ' h-11'}>
            All {SAMPLES.length} samples <ArrowRight className="h-4 w-4" aria-hidden />
          </a>
        </div>
      </div>
    </section>
  )
}

function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-h" className="scroll-mt-4">
      <div className={WRAP + ' grid gap-8 py-14 sm:py-20 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)] lg:gap-16'}>
        <div>
          <Eyebrow className="hidden text-rust-link sm:block">Questions</Eyebrow>
          <h2 id="faq-h" className="font-display text-[32px] font-semibold leading-[1.1] tracking-tight text-ink sm:mt-4 lg:text-[56px]">
            Good to know
          </h2>
        </div>
        <div className="border-t border-paper-line">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group border-b border-paper-line">
              <summary className={'flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 rounded py-3 text-[17px] font-semibold text-ink focus-visible:ring-rust [&::-webkit-details-marker]:hidden ' + FOCUS}>
                {q}
                <Plus className="h-5 w-5 shrink-0 transition-transform group-open:rotate-45" aria-hidden />
              </summary>
              <p className="max-w-[40rem] pb-5 text-base leading-relaxed text-ink-2">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

function Closing() {
  return (
    <section aria-labelledby="closing-h" className={WRAP + ' pb-14 sm:pb-20'}>
      <div className="flex flex-col gap-6 rounded-[28px] bg-ink p-7 text-paper sm:p-10 lg:flex-row lg:items-center lg:justify-between">
        <h2 id="closing-h" className="font-display text-[28px] font-semibold leading-tight tracking-tight lg:text-[40px]">
          Hear something? See its shape.
        </h2>
        <div className="flex flex-col gap-3 sm:flex-row">
          <a href={RECORD} className={BTN_RUST + ' focus-visible:ring-offset-ink'}>
            <Mic className="h-[18px] w-[18px]" aria-hidden />
            Record a sound
          </a>
          <a href={LIBRARY} className={BTN + ' hidden border border-paper/60 text-paper hover:bg-white/10 focus-visible:ring-paper focus-visible:ring-offset-ink sm:inline-flex'}>
            <Library className="h-[18px] w-[18px]" aria-hidden />
            Try a sample
          </a>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  const LINK = 'inline-flex min-h-11 items-center rounded hover:text-ink focus-visible:ring-rust ' + FOCUS
  return (
    <footer className="border-t border-paper-line">
      <div className={WRAP + ' flex flex-col gap-5 py-10 sm:flex-row sm:items-start sm:justify-between'}>
        <div>
          <div className="font-display text-xl font-semibold text-ink">Echo</div>
          <p className="mt-2 max-w-[30rem] text-sm leading-relaxed text-ink-3">
            Sample recordings from Xeno-canto and Freesound, used under Creative Commons licences.
          </p>
        </div>
        <nav aria-label="Footer" className="flex gap-6 text-sm text-ink-3 sm:-mt-2.5">
          <a href="#how-it-works" className={LINK}>About</a>
          <a href={LIBRARY} className={LINK}>Credits</a>
          <a href="https://job-joseph.com" className={LINK}>job-joseph.com</a>
        </nav>
      </div>
    </footer>
  )
}

export default function Landing() {
  // The landing page is light (paper); the app is dark (night). Match the page
  // background and the browser's address-bar colour while it is shown.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    const prevTheme = meta?.getAttribute('content')
    const prevBg = document.body.style.background
    meta?.setAttribute('content', '#F4EFE4')
    document.body.style.background = '#F4EFE4'
    return () => {
      if (meta && prevTheme) meta.setAttribute('content', prevTheme)
      document.body.style.background = prevBg
    }
  }, [])

  return (
    <div className="min-h-full bg-paper font-sans text-ink">
      <a href="#main" className={'sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-paper'}>
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero />
        <HowItWorks />
        <TwoViews />
        <Samples />
        <Faq />
        <Closing />
      </main>
      <Footer />
    </div>
  )
}
