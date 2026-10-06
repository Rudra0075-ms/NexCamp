// Camera QR scanning.
//
// getUserMedia for the frame source and jsQR for the decode — both free, both
// running entirely in the page. No frame ever leaves the browser: the video is
// drawn to an off-screen canvas, one ImageData is read per tick, and nothing is
// retained after the decode attempt.

import jsQR from "jsqr";

const SCAN_INTERVAL_MS = 180;

/** Plain-language reasons for the three ways a camera can refuse. */
function describe(error) {
  const name = error?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera permission was denied. Allow camera access in your browser, or enter the pass code by hand below.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera was found on this device. Enter the pass code by hand below.";
  }
  if (name === "NotReadableError") {
    return "The camera is already in use by another application. Close it and try again.";
  }
  return error?.message || "The camera could not be started. Enter the pass code by hand below.";
}

export function cameraSupported() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

/**
 * Starts a scan session against a <video> element.
 *
 * Returns a handle with stop(); onResult fires once with the decoded text and
 * the session stops itself, so a single scan cannot be submitted twice.
 */
export async function startScan(video, { onResult, onError } = {}) {
  if (!cameraSupported()) {
    onError?.("This browser cannot open a camera. Enter the pass code by hand below.");
    return { stop() {} };
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
  } catch (error) {
    onError?.(describe(error));
    return { stop() {} };
  }

  let stopped = false;
  let timer = null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    stream.getTracks().forEach((track) => track.stop());
    if (video) video.srcObject = null;
    // Drop the last frame rather than leaving it sitting in a canvas.
    canvas.width = 0;
    canvas.height = 0;
  };

  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  video.muted = true;
  try {
    await video.play();
  } catch {
    /* some browsers resolve the frame loop without an explicit play() */
  }

  const tick = () => {
    if (stopped) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      let frame = null;
      try {
        frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } catch {
        /* a tainted canvas cannot be read; fall through and try again */
      }
      if (frame) {
        const found = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" });
        if (found?.data) {
          stop();
          onResult?.(found.data);
          return;
        }
      }
    }
    timer = setTimeout(tick, SCAN_INTERVAL_MS);
  };

  timer = setTimeout(tick, SCAN_INTERVAL_MS);
  return { stop };
}
