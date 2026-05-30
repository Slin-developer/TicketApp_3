import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

export type CameraStatus = 'idle' | 'starting' | 'scanning' | 'error'

interface UseQrCameraOptions {
  /**
   * Called once per decoded QR payload. Decoding auto-pauses the moment this
   * fires (so the caller can show a result without re-triggering) — call
   * `resume()` to scan the next code. The hook also guards against firing twice
   * for the same code in frame: a different code fires immediately, while the
   * *same* code only fires again after the frame has been cleared in between.
   */
  onDetect: (value: string) => void
}

interface UseQrCamera {
  videoRef: React.RefObject<HTMLVideoElement | null>
  status: CameraStatus
  error: string | null
  /** Acquire the camera and begin decoding. */
  start: () => Promise<void>
  /** Stop decoding and release the camera stream. */
  stop: () => void
  /** Resume decoding after onDetect auto-paused it. */
  resume: () => void
}

// Square edge length (px) of the off-screen buffer we hand to jsQR. The camera
// frame is centre-cropped to a square before decoding so the visible viewport
// and the scanned area line up.
const SAMPLE_SIZE = 400

/**
 * Encapsulates the imperative camera + jsQR machinery (getUserMedia, the
 * requestAnimationFrame decode loop, centre-cropping) behind a small declarative
 * surface. This is device/visual state only — the decoded token is handed to the
 * caller, which feeds it through the normal scan hook → service → RPC chain.
 */
export function useQrCamera({ onDetect }: UseQrCameraOptions): UseQrCamera {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const pausedRef = useRef(false)

  // De-duplication state for the decode loop (see onDetect docs above).
  const lastValueRef = useRef<string | null>(null)
  const sawEmptyRef = useRef(true)

  // Keep the latest callback without restarting the loop on every render.
  const onDetectRef = useRef(onDetect)
  useEffect(() => {
    onDetectRef.current = onDetect
  }, [onDetect])

  const [status, setStatus] = useState<CameraStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const getCanvas = useCallback(() => {
    if (!canvasRef.current) {
      const c = document.createElement('canvas')
      c.width = SAMPLE_SIZE
      c.height = SAMPLE_SIZE
      canvasRef.current = c
    }
    return canvasRef.current
  }, [])

  // Decode one frame. Returns nothing; side-effects fire onDetect + flip refs.
  const decodeFrame = useCallback(() => {
    const video = videoRef.current
    if (!video || video.readyState < video.HAVE_ENOUGH_DATA) return

    const canvas = getCanvas()
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    // Centre-crop the camera frame to a square so it maps 1:1 to the canvas.
    const side = Math.min(video.videoWidth, video.videoHeight)
    const sx = (video.videoWidth - side) / 2
    const sy = (video.videoHeight - side) / 2
    ctx.drawImage(video, sx, sy, side, side, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)

    const image = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
    const code = jsQR(image.data, image.width, image.height, {
      inversionAttempts: 'dontInvert',
    })

    if (code && code.data) {
      const value = code.data
      const isNew = value !== lastValueRef.current || sawEmptyRef.current
      if (isNew) {
        lastValueRef.current = value
        sawEmptyRef.current = false
        // Auto-pause so a held code doesn't re-fire while the caller reacts.
        pausedRef.current = true
        onDetectRef.current(value)
      }
    } else {
      // Frame cleared — allow the same code to be accepted again next time.
      sawEmptyRef.current = true
    }
  }, [getCanvas])

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    pausedRef.current = false
    setStatus('idle')
  }, [])

  const start = useCallback(async () => {
    setError(null)
    setStatus('starting')
    try {
      // iOS Safari requires these specific constraints
      const constraints = {
        video: {
          facingMode: 'environment',
          width: { ideal: 640 },
          height: { ideal: 640 },
        },
        audio: false,
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      const video = videoRef.current
      if (!video) {
        // Component unmounted between the await and here — don't leak the stream.
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        return
      }
      
      video.srcObject = stream
      video.setAttribute('playsinline', 'true')
      // Ensure autoplay for iOS Safari
      video.setAttribute('autoplay', 'true')
      video.setAttribute('webkit-playsinline', 'true')
      
      await video.play()

      pausedRef.current = false
      lastValueRef.current = null
      sawEmptyRef.current = true
      setStatus('scanning')

      // Local loop function: a normal declaration so it can reference itself for
      // the next frame without tripping React's "value used before declared" rule.
      const loop = () => {
        if (!pausedRef.current) decodeFrame()
        rafRef.current = requestAnimationFrame(loop)
      }
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(loop)
    } catch (err) {
      console.error('Camera access failed:', err)
      const errorMessage = err instanceof DOMException 
        ? err.name === 'NotAllowedError'
          ? 'Kamerazugriff verweigert. Bitte in den Browsereinstellungen erlauben.'
          : err.name === 'NotFoundError'
          ? 'Keine Kamera auf diesem Gerät gefunden.'
          : err.name === 'NotReadableError'
          ? 'Kamera wird von einer anderen App verwendet.'
          : 'Kamera konnte nicht gestartet werden.'
        : 'Kamera konnte nicht gestartet werden.'
      setError(errorMessage)
      setStatus('error')
    }
  }, [decodeFrame])

  const resume = useCallback(() => {
    // Keep lastValueRef so the just-handled code, if still in frame, is ignored
    // until it clears — staff move to the next ticket rather than re-firing this one.
    pausedRef.current = false
  }, [])

  // Release the camera if the component unmounts mid-scan.
  useEffect(() => stop, [stop])

  return { videoRef, status, error, start, stop, resume }
}
