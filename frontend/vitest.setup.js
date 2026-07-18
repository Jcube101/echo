import '@testing-library/jest-dom/vitest'

// jsdom implements neither ResizeObserver nor a real <canvas> 2D backend.
// Components that use them (Spectrogram.jsx, Scene.jsx's Resizer) only need
// these to exist and not throw for DOM-level unit tests — actual pixel
// output is E2E's job (a real browser), not these tests'.
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// jsdom doesn't implement real media playback; stub the methods PlaybackBar
// calls so effects/handlers run without "Not implemented" console noise.
HTMLMediaElement.prototype.play = function () { return Promise.resolve() }
HTMLMediaElement.prototype.pause = function () {}
HTMLMediaElement.prototype.load = function () {}

HTMLCanvasElement.prototype.getContext = () => ({
  createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  putImageData: () => {},
  clearRect: () => {},
  drawImage: () => {},
  imageSmoothingEnabled: true,
  imageSmoothingQuality: 'high',
})
