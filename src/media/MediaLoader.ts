function hasVideoFrameCallback(video: HTMLVideoElement): boolean {
  return 'requestVideoFrameCallback' in video;
}

function waitForEvent(target: EventTarget, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    const onSuccess = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error(`Failed while waiting for ${event}`));
    };

    const cleanup = () => {
      window.clearTimeout(timeout);
      target.removeEventListener(event, onSuccess);
      target.removeEventListener('error', onError);
    };

    target.addEventListener(event, onSuccess, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

function waitForVideoCondition(
  video: HTMLVideoElement,
  events: Array<'loadedmetadata' | 'loadeddata' | 'canplay' | 'canplaythrough' | 'seeked' | 'error'>,
  timeoutMs: number,
  ready: () => boolean,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (ready()) {
      resolve(true);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve(ready());
    }, timeoutMs);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      for (const eventName of events) {
        video.removeEventListener(eventName, onEvent);
      }
    };

    const onEvent = () => {
      if (!ready()) {
        return;
      }
      cleanup();
      resolve(true);
    };

    for (const eventName of events) {
      video.addEventListener(eventName, onEvent);
    }
  });
}

async function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  if (hasVideoFrameCallback(video)) {
    await new Promise<void>((resolve) => {
      let resolved = false;
      const timeoutId = window.setTimeout(() => {
        if (resolved) return;
        resolved = true;
        resolve();
      }, 250);

      video.requestVideoFrameCallback(() => {
        if (resolved) return;
        resolved = true;
        window.clearTimeout(timeoutId);
        resolve();
      });
    });
    return;
  }

  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 32);
  });
}

/**
 * Force the decoder to produce at least one real frame before export seeks.
 * Without this, importExternalTexture often returns black on a cold video element.
 */
export async function warmUpVideoForExport(video: HTMLVideoElement): Promise<void> {
  if (video.readyState < 1) {
    await waitForVideoCondition(
      video,
      ['loadedmetadata', 'error'],
      10_000,
      () => video.readyState >= 1,
    );
  }

  const prime = async () => {
    try {
      video.currentTime = 0.001;
    } catch {
      // ignore
    }

    if (hasVideoFrameCallback(video)) {
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          video.pause();
          resolve();
        };
        window.setTimeout(finish, 500);
        (video as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => number })
          .requestVideoFrameCallback(() => finish());
        video.play().catch(() => finish());
      });
    } else {
      await waitForVideoCondition(
        video,
        ['loadeddata', 'canplay', 'seeked', 'error'],
        2_000,
        () => video.readyState >= 2,
      );
      video.pause();
    }
  };

  await prime();
}

async function ensureVideoReadyForExport(video: HTMLVideoElement, targetTime: number): Promise<void> {
  if (!video.src && !video.currentSrc) {
    return;
  }

  if (video.readyState < 1) {
    try {
      video.load();
    } catch {
      // ignore
    }
    await waitForVideoCondition(
      video,
      ['loadedmetadata', 'error'],
      4_000,
      () => video.readyState >= 1,
    );
  }

  if (video.readyState < 2 && !video.seeking) {
    await waitForVideoCondition(
      video,
      ['loadeddata', 'canplay', 'canplaythrough', 'seeked', 'error'],
      2_000,
      () => !video.seeking && video.readyState >= 2,
    );
  }

  // Muted paused videos often never decode without a brief play().
  if (video.readyState < 2 && !video.seeking && video.muted) {
    try {
      await Promise.race([
        video.play().catch(() => undefined),
        new Promise((resolve) => window.setTimeout(resolve, 150)),
      ]);
      video.pause();
    } catch {
      // ignore
    }

    if (Math.abs(video.currentTime - targetTime) > 0.01) {
      try {
        video.currentTime = targetTime;
      } catch {
        // ignore
      }
      await waitForEvent(video, 'seeked', 2_000).catch(() => undefined);
    }
  }

  if (!video.seeking && video.readyState >= 2) {
    await waitForVideoFrame(video);
  }
}

export async function loadVideo(url: string): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.src = url;
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.load();
  await waitForEvent(video, 'loadedmetadata', 15_000);
  await warmUpVideoForExport(video);
  return video;
}

export async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = url;
  await waitForEvent(image, 'load', 15_000);
  return image;
}

export async function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const maxSeekTime = duration > 0 ? Math.max(0, duration - 0.001) : 0;
  const targetTime = duration > 0
    ? Math.max(0, Math.min(time, maxSeekTime))
    : Math.max(0, time);

  video.pause();

  if (Math.abs(video.currentTime - targetTime) < 0.01 && !video.seeking) {
    await ensureVideoReadyForExport(video, targetTime);
    return;
  }

  await new Promise<void>((resolve) => {
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve();
    };

    const timeoutId = window.setTimeout(finish, 2_000);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onReady);
    };

    const onReady = () => {
      if (!video.seeking && video.readyState >= 2) {
        finish();
      }
    };

    const onSeeked = () => finish();

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('canplay', onReady);
    video.addEventListener('error', onReady);

    try {
      video.currentTime = targetTime;
    } catch {
      finish();
    }
  });

  await ensureVideoReadyForExport(video, targetTime);
}
