import React, { useContext, useEffect, useRef, useState } from "react";
import Tooltip from "@/components/Common/Tooltip";
import { Check, ChevronDown, Loader2, Mic, X } from "lucide-react";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { cn } from "@/utils/undoActions/helperFuncs";
import type { Editor } from "@tiptap/react";
import { aiTaskWriterConfig } from "@/lib/configs/aiTaskWriter.config";
import { audioTranscriptRoute } from "@/lib/constants/APIRouteConstants";
import { currentProjectAtom } from "@/store";
import { useRecoilValue } from "@/lib/state";
import toast from "react-hot-toast";
import { createTapGuard } from "@/lib/utils/deliberateTap";
import { MAX_DICTATION_AUDIO_BYTES } from "@/lib/dictationLimits";
import { collectDictationTranscriptFromSse } from "@/lib/dictationSse";
import { mobileMicPresentation } from "./mobileAudioButtonPresentation";
import type { MobileMicPresentation } from "./mobileAudioButtonPresentation";
import type {
  DictationCoordinator,
  DictationLease,
} from "@/lib/dictationCoordinator";

interface IProp {
  callbackHandler: (text: string, setContent?: boolean) => void;
  toggleRecording: (val: boolean) => void;
  editor: Editor | null;
  defaultContent?: string;
  id: string;
  visualizerClassName?: string;
  // True while ANY recorder in this composer is capturing, so a peer mic (the
  // comment mic while the description records) is not shown as a purple CTA
  // next to the live visualizer.
  globalRecording?: boolean;
  hasText?: boolean;
  onProcessingChange?: (processing: boolean) => void;
  /** Extra classes on the mic container, for callers that need a bigger touch target. */
  className?: string;
  /** Classes on the root .audio-recorder element — the flex-row child. Flex
      `order` must land HERE, not on className: the inner mic div is not a
      direct flex child, so order there is silently ignored. */
  wrapperClassName?: string;
  /** Optional visible copy for standalone composer actions such as feedback. */
  idleLabel?: string;
  /** Makes non-task-writer instances keyboard accessible with a specific name. */
  ariaLabel?: string;
  /** Explicit mobile hierarchy for field-level mics that must not become a primary CTA. */
  mobilePresentation?: MobileMicPresentation;
  /** Serializes recorder instances that write into the same draft. */
  dictationCoordinator?: DictationCoordinator;
  disabled?: boolean;
}

const DEVICE_STORAGE_KEY = "ht-dictation-deviceId";
// Below this the blob is empty/garbage (silence or a dropped stream); posting it
// makes the transcribe route 500. Cancel silently instead.
const MIN_BLOB_BYTES = 1200;

type AudioCtor = typeof AudioContext;
const getAudioContextCtor = (): AudioCtor | undefined =>
  window.AudioContext ||
  (window as typeof window & { webkitAudioContext?: AudioCtor })
    .webkitAudioContext;

export const AudioButton = ({
  callbackHandler,
  editor,
  id,
  toggleRecording,
  visualizerClassName,
  defaultContent,
  globalRecording,
  hasText,
  onProcessingChange,
  className,
  wrapperClassName,
  idleLabel,
  ariaLabel,
  mobilePresentation,
  dictationCoordinator,
  disabled = false,
}: IProp) => {
  const [recording, setRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  // Only a deliberate tap that starts AND ends on the mic may open the recorder.
  // Sending a comment collapses the composer and the mic slides into the slot the
  // send button just vacated, so the click from that tap lands on the mic and
  // started recording. A click with no touch of its own is that stray, not a tap.
  const micTap = useRef(createTapGuard()).current;
  const onMicTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    if (touch) micTap.start(touch.clientX, touch.clientY);
  };
  const onMicTouchMove = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    if (touch) micTap.move(touch.clientX, touch.clientY);
  };
  const onMicActivate = () => {
    if (micTap.isStray()) return;
    startRecording(false);
  };
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(DEVICE_STORAGE_KEY);
  });

  const isApple = useDeviceContext();
  // Picking an input device is a desktop-only affordance; mobile has no mic
  // selector, so hide the caret + popover on the mobile viewport.
  const isMobileView = useContext(MobileViewContext);
  const isMobileCreateComment =
    isMobileView && id === "create-comment-audio-button";
  const isMobileTaskWriter =
    isMobileView && id === "ai-writer-audio-button";
  const isMobileNewTask =
    isMobileView && id === "create-task-modal-audio-button";
  const isMobileAiChat = isMobileView && id === "ai-chat-audio-button";
  const isKeyboardAccessible =
    isMobileTaskWriter || Boolean(ariaLabel || idleLabel);
  const dictationAriaLabel = isKeyboardAccessible
    ? ariaLabel || idleLabel || "Start dictation"
    : undefined;
  // Desktop AI composers: emphasise dictation with a filled mic in a pill.
  // Scoped to the comment composer, AI Task Writer, and AI chat; other mics
  // (description, task modal) keep the plain outline icon.
  const isDesktopAiMic =
    !isMobileView &&
    [
      "create-comment-audio-button",
      "ai-writer-audio-button",
      "ai-chat-audio-button",
      "inline-draft-ai-audio-button",
    ].includes(id);
  const currentProject = useRecoilValue(currentProjectAtom);

  // Audio graph + capture, all kept out of render so the rAF loop reads live values.
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const shouldImprove = useRef<boolean>(false);

  const rafRef = useRef<number | null>(null);
  const barsRef = useRef<number[]>([]);
  const gainRef = useRef<number>(1);
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const menuWrapRef = useRef<HTMLDivElement | null>(null);
  const dictationLeaseRef = useRef<DictationLease | null>(null);

  // Refs mirror state so the rAF closure and getUserMedia callbacks read fresh values.
  const recordingRef = useRef(false);
  const menuOpenRef = useRef(false);
  const selectedDeviceIdRef = useRef<string | null>(selectedDeviceId);
  selectedDeviceIdRef.current = selectedDeviceId;

  // Open a fresh stream on the chosen device and (re)build the analyser. The
  // AudioContext is reused across recordings; only the stream/source churns.
  const ensureStream = async (
    deviceId: string | null,
  ): Promise<MediaStream> => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
    } catch (error) {
      if (!deviceId) throw error;
      // The persisted mic is gone (unplugged, or the browser rotated its id):
      // an `exact` constraint then rejects instantly and every mic entry point
      // goes silently dead. Fall back to the default device and forget the
      // stale selection (HTPR-4583).
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setSelectedDeviceId(null);
      selectedDeviceIdRef.current = null;
      try {
        localStorage.removeItem(DEVICE_STORAGE_KEY);
      } catch {
        // localStorage can be unavailable (private mode); in-memory reset is enough.
      }
    }
    streamRef.current = stream;

    const Ctor = getAudioContextCtor();
    if (Ctor) {
      if (!audioContextRef.current || audioContextRef.current.state === "closed") {
        audioContextRef.current = new Ctor();
      }
      const ac = audioContextRef.current;
      if (ac.state === "suspended") await ac.resume();
      const source = ac.createMediaStreamSource(stream);
      const analyser = ac.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      analyserRef.current = analyser;
    }
    return stream;
  };

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    // Close the AudioContext too, not just the tracks: on the mobile WebView a
    // running context keeps the OS audio session (and the mic) captured after
    // dictation ends, blocking dictation in other apps (HTPR-4948).
    // ensureStream recreates a closed context on the next recording.
    analyserRef.current = null;
    const ac = audioContextRef.current;
    if (ac && ac.state !== "closed") {
      void ac.close().catch(() => undefined);
    }
    audioContextRef.current = null;
  };

  // RMS of the time-domain frame with a rolling auto-gain so normal speech fills
  // the bars (no shouting). Ported from the approved prototype.
  const computeLevel = (): number => {
    const analyser = analyserRef.current;
    if (!analyser) return 0;
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    const target = 0.6;
    if (rms > 0.02) {
      gainRef.current = gainRef.current * 0.92 + (target / Math.max(rms, 0.04)) * 0.08;
    }
    gainRef.current = Math.min(gainRef.current, 6);
    return Math.min(1, rms * gainRef.current);
  };

  const drawBars = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(rect.width * dpr) ||
        canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    // Theme-aware: the canvas inherits a muted foreground text color via its class.
    ctx.fillStyle = getComputedStyle(canvas).color || "#999a9d";

    const bw = 3;
    const gap = 2;
    const step = bw + gap;
    const n = Math.max(1, Math.floor(rect.width / step));
    const mid = rect.height / 2;
    const arr = barsRef.current;
    // Right-anchor: the newest sample sits at the right edge and history scrolls
    // left. Before the buffer fills, the missing history is on the LEFT (negative
    // idx -> 0), so the wave reads as live-at-the-right immediately instead of
    // filling in left-to-right (which looked like the bar sliding out slowly).
    for (let i = 0; i < n; i++) {
      const idx = arr.length - n + i;
      const val = idx >= 0 ? arr[idx] || 0 : 0;
      const h = Math.max(2, val * (rect.height - 4));
      const x = i * step;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, mid - h / 2, bw, h, 1.5);
      else ctx.rect(x, mid - h / 2, bw, h);
      ctx.fill();
    }
  };

  const drawFrame = () => {
    const v = computeLevel();
    barsRef.current.push(v);
    if (barsRef.current.length > 2000) {
      barsRef.current = barsRef.current.slice(-1500);
    }
    if (recordingRef.current && waveCanvasRef.current) drawBars(waveCanvasRef.current);
    if (menuOpenRef.current && miniCanvasRef.current) drawBars(miniCanvasRef.current);

    if (!recordingRef.current && !menuOpenRef.current) {
      rafRef.current = null;
      return;
    }
    rafRef.current = requestAnimationFrame(drawFrame);
  };

  const ensureLoop = () => {
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(drawFrame);
    }
  };

  const releaseDictationLease = (lease = dictationLeaseRef.current) => {
    if (!lease) return;
    dictationCoordinator?.release(lease);
    if (dictationLeaseRef.current === lease) dictationLeaseRef.current = null;
  };

  const resetToIdle = () => {
    recordingRef.current = false;
    setRecording(false);
    if (!dictationCoordinator) toggleRecording(false);
    setIsProcessing(false);
    shouldImprove.current = false;
    audioChunksRef.current = [];
    stopStream();
    releaseDictationLease();
  };

  const startRecording = async (improve: boolean = false) => {
    if (disabled || recordingRef.current || isProcessing) return;
    const lease = dictationCoordinator?.acquire();
    if (dictationCoordinator && !lease) return;
    if (lease) dictationLeaseRef.current = lease;
    try {
      shouldImprove.current = improve;
      const stream = await ensureStream(selectedDeviceIdRef.current);
      if (lease && !dictationCoordinator?.owns(lease)) {
        stopStream();
        return;
      }

      audioChunksRef.current = [];
      const mimeType =
        ["audio/webm", "audio/mp4", "audio/m4a"].find((t) =>
          MediaRecorder.isTypeSupported(t),
        ) || "";
      const mediaRecorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      });
      // No timeslice: start(200) produced a fragmented container Android could
      // not decode. Let the final blob come from the stop-time dataavailable.
      mediaRecorder.start();

      barsRef.current = [];
      // Seed the auto-gain mid-range so the first frames already show visible
      // bars (speech-level RMS converges to ~6). Starting at 1 left the wave flat
      // for ~a second while it ramped, which read as a slow reveal.
      gainRef.current = 3;
      menuOpenRef.current = false;
      setMenuOpen(false);
      recordingRef.current = true;
      setRecording(true);
      if (!dictationCoordinator) toggleRecording(true);
      ensureLoop();
    } catch (error) {
      console.error("dictation: could not start recording", error);
      toast.error("Microphone unavailable - check mic permissions");
      resetToIdle();
    }
  };

  const stopRecording = (send = false) => {
    const mediaRecorder = mediaRecorderRef.current;
    recordingRef.current = false;
    setRecording(false);
    if (!dictationCoordinator) toggleRecording(false);

    if (!mediaRecorder) {
      stopStream();
      releaseDictationLease();
      return;
    }
    // Hide Send and show the processing spinner the instant the user confirms,
    // before the async stop/transcribe begins: a partial/old transcript can't be
    // sent in the gap, and there is no dead window where the mic looks idle while
    // the recorder is still flushing (HTPR-4677).
    if (send) {
      onProcessingChange?.(true);
      setIsProcessing(true);
    }

    const onStop = () => {
      mediaRecorder.removeEventListener("stop", onStop);
      const blobType = mediaRecorder.mimeType || "audio/webm";
      const audioBlob = new Blob(audioChunksRef.current, { type: blobType });
      stopStream();

      if (!send || audioBlob.size < MIN_BLOB_BYTES) {
        // Empty/garbage audio: silently drop it, never POST, never prompt.
        onProcessingChange?.(false);
        setIsProcessing(false);
        audioChunksRef.current = [];
        mediaRecorderRef.current = null;
        shouldImprove.current = false;
        releaseDictationLease();
        return;
      }
      sendAudioToServer(audioBlob, dictationLeaseRef.current);
    };

    mediaRecorder.addEventListener("stop", onStop);
    try {
      mediaRecorder.requestData();
    } catch {
      // requestData can throw if already inactive; the stop event still flushes.
    }
    mediaRecorder.stop();
  };

  const closeHandler = () => stopRecording(false);

  const sendAudioToServer = async (
    audioBlob: Blob,
    lease: DictationLease | null,
  ) => {
    if (audioBlob.size > MAX_DICTATION_AUDIO_BYTES) {
      toast.error("Recording is too long. Send a shorter dictation.");
      onProcessingChange?.(false);
      mediaRecorderRef.current = null;
      resetToIdle();
      return;
    }

    const readBlobAsBase64 = () =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
      });

    const htmlContent = editor?.getHTML();
    const textContent = defaultContent ?? editor?.getText();

    try {
      const base64Audio = await readBlobAsBase64();
      const response = await fetch(audioTranscriptRoute, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioFile: base64Audio,
          improve: shouldImprove.current,
          projectId: currentProject?.id,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "Dictation failed. Try again.",
        );
      }

      const canDeliver = () =>
        !dictationCoordinator ||
        Boolean(lease && dictationCoordinator.owns(lease));

      if (shouldImprove.current) {
        const data = await response.json();
        const audioImproved = data.response_html;
        let newContent = "";
        if (textContent && textContent.length > 0)
          newContent = htmlContent + audioImproved;
        else newContent = audioImproved;
        if (canDeliver()) callbackHandler(newContent, true);
      } else {
        const decoder = new TextDecoder();
        const streamReader = response.body?.getReader();
        const sseChunks: string[] = [];

        while (streamReader) {
          const result = await streamReader.read();
          if (!result) break;
          const { done, value } = result;
          if (done) break;
          sseChunks.push(decoder.decode(value, { stream: true }));
        }
        sseChunks.push(decoder.decode());

        const transcript = collectDictationTranscriptFromSse(sseChunks);
        if (transcript && canDeliver()) {
          const prefix =
            textContent && textContent.length > 0 ? " " : "";
          callbackHandler(prefix + transcript);
        }
      }
    } catch (error) {
      console.error("dictation: audio processing failed", error);
      toast.error(
        error instanceof Error ? error.message : "Dictation failed. Try again.",
      );
    } finally {
      setIsProcessing(false);
      mediaRecorderRef.current = null;
      shouldImprove.current = false;
      audioChunksRef.current = [];
      releaseDictationLease(lease);
    }
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && recordingRef.current) {
      e.preventDefault();
      stopRecording(false);
    }
    // Enter sends the recording.
    if (e.keyCode === 13 && recordingRef.current) {
      e.preventDefault();
      stopRecording(true);
    }
  };

  // The document listener registers once, but it must dispatch to the LATEST
  // render's handleKeydown. The send path (stopRecording -> sendAudioToServer
  // -> callbackHandler) closes over the editor prop, which is null on first
  // render (useEditor with immediatelyRender: false). With the first render's
  // closure, Enter stopped the recording and transcribed fine, but every
  // transcript chunk hit a null editor and was silently dropped — the Check
  // button worked because its onClick is always a fresh closure.
  const handleKeydownRef = useRef(handleKeydown);
  handleKeydownRef.current = handleKeydown;

  useEffect(() => {
    const listener = (e: KeyboardEvent) => handleKeydownRef.current(e);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  useEffect(() => {
    if (!isMobileCreateComment || !editor) return;
    // emitUpdate:false — see TipTapTaskDetail: a setEditable "update" is not an edit.
    editor.setEditable(!isProcessing, false);
    return () => editor.setEditable(true, false);
  }, [editor, isMobileCreateComment, isProcessing]);

  // Mirror processing state up so the composer can hide Send while the
  // transcript is still streaming in (prevents sending a partial transcript).
  useEffect(() => {
    onProcessingChange?.(isProcessing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProcessing]);

  // Safety: if this mic unmounts mid-transcription, release the Send lock so
  // the parent never gets stuck hiding Send.
  useEffect(() => {
    return () => onProcessingChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup on unmount: kill the loop, the stream, and the shared AudioContext.
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      stopStream();
      releaseDictationLease();
      const ac = audioContextRef.current;
      if (ac && ac.state !== "closed") {
        void ac.close().catch(() => undefined);
      }
      audioContextRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const listDevices = async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all.filter((d) => d.kind === "audioinput");
      setDevices(inputs);
      if (!selectedDeviceIdRef.current && inputs[0]?.deviceId) {
        setSelectedDeviceId(inputs[0].deviceId);
      }
    } catch (error) {
      console.error("dictation: could not list microphones", error);
    }
  };

  const openMenu = async () => {
    menuOpenRef.current = true;
    setMenuOpen(true);
    try {
      await ensureStream(selectedDeviceIdRef.current);
      await listDevices();
      ensureLoop();
    } catch (error) {
      console.error("dictation: microphone unavailable", error);
    }
  };

  const closeMenu = () => {
    menuOpenRef.current = false;
    setMenuOpen(false);
    if (!recordingRef.current) stopStream();
  };

  const selectDevice = async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    selectedDeviceIdRef.current = deviceId;
    try {
      localStorage.setItem(DEVICE_STORAGE_KEY, deviceId);
    } catch {
      // localStorage can be unavailable (private mode); selection still applies in-memory.
    }
    try {
      await ensureStream(deviceId);
      await listDevices();
    } catch (error) {
      console.error("dictation: could not switch microphone", error);
    }
  };

  // Close the mic menu on an outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen]);

  return (
    <div className={cn("audio-recorder", recording && "w-full", wrapperClassName)}>
      {!recording ? (
        <div
          ref={menuWrapRef}
          className={cn(
            "relative flex items-center",
            // Desktop composer: mic + device chevron grouped, no backdrop,
            // matching the de-chromed input bar (HTPR-5004).
            isDesktopAiMic && "gap-0.5",
          )}
        >
          {/* Hidden anchor: keyboard shortcut + audioInputHandler click this by id to dictate-and-improve. */}
          <div
            id={id + "-improve"}
            className="h-0 w-0"
            onClick={() => startRecording(true)}
          />
          {/* Primary anchor: click() by id starts normal dictation. The filled
              slot belongs to whatever you would do next: the mic on an empty
              composer, Send once there is text. So `hasText` demotes the mic to
              a bare glyph in every prominent mode, the comment composer
              included (HTPR-5684, reversing the earlier carve-out that kept it
              filled and left two competing primaries side by side). */}
          {(() => {
            const { prominent, className: prominentClassName } =
              mobileMicPresentation({
                isMobileCreateComment,
                isMobileTaskWriter,
                isMobileNewTask,
                isMobileAiChat,
                globalRecording,
                hasText,
                isProcessing,
                mobilePresentation,
              });
            return (
              <div
                id={id}
                className={cn(
                  "group relative flex cursor-pointer items-center touch-manipulation",
                  prominent ? prominentClassName : "h-[32px]",
                  disabled && "cursor-not-allowed opacity-50",
                  className,
                )}
                onClick={onMicActivate}
                onMouseEnter={() => setHover(true)}
                onMouseLeave={() => setHover(false)}
                onTouchStart={onMicTouchStart}
                onTouchMove={onMicTouchMove}
                role={isKeyboardAccessible ? "button" : undefined}
                tabIndex={isKeyboardAccessible && !disabled ? 0 : undefined}
                aria-disabled={isKeyboardAccessible ? disabled : undefined}
                aria-label={isMobileTaskWriter ? "Start dictation" : dictationAriaLabel}
                onKeyDown={(event) => {
                  if (
                    !isKeyboardAccessible ||
                    (event.key !== "Enter" && event.key !== " ")
                  ) {
                    return;
                  }
                  event.preventDefault();
                  void startRecording(false);
                }}
              >
                {isProcessing ? (
                  // Transcribing: replace the mic with a spinner everywhere so the
                  // few-second wait reads as "working", not frozen (HTPR-4677).
                  <>
                    <Loader2
                      size={18}
                      strokeWidth={2}
                      className={cn(
                        "animate-spin",
                        "keep-stroke",
                        isDesktopAiMic
                          ? "text-hypertasks-ai-purple"
                          : "text-icon-dark-gray",
                      )}
                      aria-label="Transcribing"
                    />
                    {prominent && !isMobileView && (
                      <span className="text-meta text-hypertasks-ai-purple">
                        Transcribing...
                      </span>
                    )}
                    {!prominent && idleLabel && (
                      <span className="text-dense">Transcribing...</span>
                    )}
                  </>
                ) : isDesktopAiMic ? (
                  // Desktop comment composer: filled mic so it reads as the primary action in the pill.
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="animated-icon text-icon-dark-gray hover:text-white-black"
                  >
                    <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" />
                    <path d="M19 11a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V21H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-3.08A7 7 0 0 0 19 11z" />
                  </svg>
                ) : (
                  <Mic
                    size={isMobileTaskWriter || isMobileNewTask ? 20 : 18}
                    className={cn(
                      "animated-icon",
                      prominent
                        ? hasText
                          ? "text-icon-dark-gray"
                          : "text-white-black-inverted"
                        : "text-icon-dark-gray hover:text-white-black",
                    )}
                    style={{ fontSize: aiTaskWriterConfig.fontSizes.moderateIcon }}
                    strokeWidth={1.75}
                  />
                )}
                {!isProcessing && idleLabel && (
                  <span className="text-dense">{idleLabel}</span>
                )}
                {hover &&
                  !isProcessing &&
                  id !== "ai-chat-audio-button" &&
                  id !== "inline-draft-ai-audio-button" && (
                  <>
                    <Tooltip
                      left={0}
                      bottom={-45}
                      keyCombination={[isApple ? "CMD" : "CTRL", "SHIFT", "D"]}
                      text={"Speech to text"}
                    />
                    <Tooltip
                      left={0}
                      bottom={-80}
                      keyCombination={[isApple ? "CMD" : "CTRL", "SHIFT", "F"]}
                      text={"Dictate and Improve"}
                    />
                  </>
                )}
              </div>
            );
          })()}

          {!isMobileView && (
            <button
              type="button"
              aria-label="Choose microphone"
              className="flex h-[32px] w-[16px] items-center justify-center text-icon-dark-gray hover:text-white-black"
              onClick={(e) => {
                e.stopPropagation();
                menuOpen ? closeMenu() : openMenu();
              }}
            >
              <ChevronDown size={14} strokeWidth={1.75} />
            </button>
          )}

          {!isMobileView && menuOpen && (
            <div className="absolute bottom-[38px] right-0 z-[9999] w-[260px] rounded-[4px] bg-modalBackground p-1.5 text-white-black shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
              <div className="mx-1.5 mb-2 mt-1 h-[24px] overflow-hidden rounded-[3px]">
                <canvas
                  ref={miniCanvasRef}
                  className="block h-full w-full text-icon-dark-gray"
                />
              </div>
              {devices.map((device, i) => {
                const selected = selectedDeviceId
                  ? device.deviceId === selectedDeviceId
                  : i === 0;
                return (
                  <div
                    key={device.deviceId || i}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-[3px] px-2.5 py-2 text-dense hover:bg-hoverCardBackground",
                      selected && "font-semibold text-white-black",
                    )}
                    onClick={() => selectDevice(device.deviceId)}
                  >
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                      {device.label || "Microphone " + (i + 1)}
                    </span>
                    {selected && (
                      <Check
                        size={19}
                        className="ml-auto shrink-0 text-hypertasks-ai-purple keep-stroke"
                        strokeWidth={2.5}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div
          className={cn(
            isMobileView
              ? "flex w-full items-center gap-2 rounded-[4px] z-[9999]"
              : "flex items-center gap-2 rounded-[4px] bg-newComment-container px-2 py-[6px] z-[9999] mb-3 md:!mb-0",
            visualizerClassName,
          )}
        >
          <div className="relative h-[34px] flex-1 overflow-hidden rounded-[4px]">
            <canvas
              ref={waveCanvasRef}
              className="block h-full w-full text-icon-dark-gray"
              aria-hidden="true"
            />
          </div>
          <button
            type="button"
            onClick={closeHandler}
            aria-label="Cancel"
            className={cn(
              "flex items-center justify-center rounded-[4px] text-icon-dark-gray hover:text-white-black hover:bg-hover-active",
              isMobileView ? "h-11 w-11" : "h-[28px] w-[28px]",
            )}
          >
            <X size={18} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => stopRecording(true)}
            aria-label="Send"
            className={cn(
              "group relative flex items-center justify-center rounded-[4px]",
              isMobileView
                ? "h-11 w-12 bg-white-black text-white-black-inverted"
                : "h-[28px] w-[28px] bg-hypertasks-ai-purple text-white",
            )}
          >
            <Check size={18} strokeWidth={2.2} className="keep-stroke" />
            <Tooltip
              left={0}
              bottom={-45}
              keyCombination={["ENTER"]}
              text={"Send recording"}
            />
          </button>
        </div>
      )}
    </div>
  );
};

export default AudioButton;
