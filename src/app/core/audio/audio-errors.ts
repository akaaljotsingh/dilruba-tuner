export type AudioErrorCode =
  | 'insecure-context'
  | 'unsupported'
  | 'permission-denied'
  | 'no-device'
  | 'device-busy'
  | 'audio-context'
  | 'worklet-load'
  | 'stream-ended'
  | 'unknown';

export interface AudioError {
  readonly code: AudioErrorCode;
  readonly title: string;
  readonly message: string;
  /** Whether trying again (e.g. tapping "Start") can help. */
  readonly retryable: boolean;
}

const MESSAGES: Record<AudioErrorCode, Omit<AudioError, 'code'>> = {
  'insecure-context': {
    title: 'Secure connection required',
    message:
      'Browsers only allow microphone access on HTTPS pages (or localhost). Open the tuner from its https:// address or the installed app.',
    retryable: false,
  },
  unsupported: {
    title: 'Browser not supported',
    message:
      'This browser lacks the audio features the tuner needs (microphone capture and AudioWorklet). Please use a current version of Chrome, Edge or Safari.',
    retryable: false,
  },
  'permission-denied': {
    title: 'Microphone access is blocked',
    message:
      'Allow microphone access for this site in your browser’s settings (usually the icon beside the address bar), then tap Start Listening again.',
    retryable: true,
  },
  'no-device': {
    title: 'No microphone found',
    message: 'Connect or enable a microphone and try again.',
    retryable: true,
  },
  'device-busy': {
    title: 'Microphone is in use',
    message:
      'Another app may be using the microphone. Close it, or check your system’s privacy settings, then try again.',
    retryable: true,
  },
  'audio-context': {
    title: 'Audio could not start',
    message: 'The browser could not start audio processing. Tap Start Listening to try again.',
    retryable: true,
  },
  'worklet-load': {
    title: 'Audio engine failed to load',
    message:
      'The audio analysis module could not be loaded. Reload the page while online once so it can be cached.',
    retryable: true,
  },
  'stream-ended': {
    title: 'Microphone disconnected',
    message:
      'The microphone stopped sending audio (it may have been unplugged or taken by another app). Tap Start Listening to reconnect.',
    retryable: true,
  },
  unknown: {
    title: 'Something went wrong',
    message: 'An unexpected audio error occurred. Tap Start Listening to try again.',
    retryable: true,
  },
};

export function audioError(code: AudioErrorCode, detail?: string): AudioError {
  const base = MESSAGES[code];
  return { code, ...base, message: detail ? `${base.message} (${detail})` : base.message };
}

/** Maps a getUserMedia / AudioContext exception to a user-facing error. */
export function classifyMediaError(error: unknown): AudioError {
  const name = (error as { name?: string })?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return audioError('permission-denied');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return audioError('no-device');
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return audioError('device-busy');
    default:
      return audioError('unknown', name || undefined);
  }
}
