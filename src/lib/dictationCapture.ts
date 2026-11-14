export const DICTATION_CAPTURE_TIMESLICE_MS = 250;

export function resolveDictationProjectId(
  projectIdProp: number | null | undefined,
  currentProjectId: number | null | undefined,
  taskProjectId: number | null | undefined,
  routed: boolean,
): number | undefined {
  if (projectIdProp !== undefined) return projectIdProp ?? undefined;
  if (!routed) return currentProjectId ?? undefined;
  return currentProjectId ?? taskProjectId ?? undefined;
}

export function openDictationGraph(
  audioContext: AudioContext,
  micStream: MediaStream,
  routed: boolean,
): { analyser: AnalyserNode; recordStream: MediaStream } {
  const source = audioContext.createMediaStreamSource(micStream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.75;
  source.connect(analyser);
  if (!routed) return { analyser, recordStream: micStream };
  const destination = audioContext.createMediaStreamDestination();
  analyser.connect(destination);
  return { analyser, recordStream: destination.stream };
}
