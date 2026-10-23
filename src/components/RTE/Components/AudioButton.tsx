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
import type {
  MobileMicPresentation,
  MobileMicPrimaryTone,
} from "./mobileAudioButtonPresentation";
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
  globalRecording?: boolean;
  hasText?: boolean;
  onProcessingChange?: (processing: boolean) => void;
  className?: string;
  wrapperClassName?: string;
  idleLabel?: string;
  ariaLabel?: string;
  mobilePresentation?: MobileMicPresentation;
  mobilePrimaryTone?: MobileMicPrimaryTone;
  dictationCoordinator?: DictationCoordinator;
  disabled?: boolean;
  active?: boolean;
  projectId?: number | null;
}

const DEVICE_STORAGE_KEY = "ht-dictation-deviceId";
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
  projectId: projectIdProp,
  idleLabel,
  ariaLabel,
  mobilePresentation,
  mobilePrimaryTone = "default",
  dictationCoordinator,
  disabled = false,
  active = true,
}: IProp) => {
  const activeRef = useRef(active);
  activeRef.current = active;
  const [recording, setRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
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
  const isMobileView = useContext(MobileViewContext);
  const isMobileCreateComment =
    isMobileView && id === "create-comment-audio-button";
  const isMobileTaskWriter =
    isMobileView && id === "ai-writer-audio-button";
  const isMobileNewTask =
    isMobileView && id === "create-task-modal-audio-button";
  const isAiChat = id === "ai-chat-audio-button" || id.startsWith("ai-chat-audio-button-");
  const isMobileAiChat = isMobileView && isAiChat;
  const isKeyboardAccessible =
    isMobileTaskWriter || Boolean(ariaLabel || idleLabel);
  const dictationAriaLabel = isKeyboardAccessible
    ? ariaLabel || idleLabel || "Start dictation"
    : undefined;
  const isDesktopAiMic =
    !isMobileView &&
    (isAiChat || [
      "create-comment-audio-button",
      "ai-writer-audio-button",
      "inline-draft-ai-audio-button",
    ].includes(id));
  const currentProject = useRecoilValue(currentProjectAtom);
  const resolvedProjectId =
    projectIdProp === undefined ? currentProject?.id : projectIdProp ?? undefined;

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

  const recordingRef = useRef(false);
  const menuOpenRef = useRef(false);
  const selectedDeviceIdRef = useRef<string | null>(selectedDeviceId);
  selectedDeviceIdRef.current = selectedDeviceId;

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
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setSelectedDeviceId(null);
      selectedDeviceIdRef.current = null;
      try {
        localStorage.removeItem(DEVICE_STORAGE_KEY);
      } catch {
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
    analyserRef.current = null;
    const ac = audioContextRef.current;
    if (ac && ac.state !== "closed") {
      void ac.close().catch(() => undefined);
    }
    audioContextRef.current = null;
  };

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
    ctx.fillStyle = getComputedStyle(canvas).color || "#999a9d";

    const bw = 3;
    const gap = 2;
    const step = bw + gap;
    const n = Math.max(1, Math.floor(rect.width / step));
    const mid = rect.height / 2;
    const arr = barsRef.current;
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
    if (!activeRef.current || disabled || recordingRef.current || isProcessing) return;
    const lease = dictationCoordinator?.acquire();
    if (dictationCoordinator && !lease) return;
    if (lease) dictationLeaseRef.current = lease;
    try {
      shouldImprove.current = improve;
      const stream = await ensureStream(selectedDeviceIdRef.current);
      if (!activeRef.current || (lease && !dictationCoordinator?.owns(lease))) {
        stopStream();
        releaseDictationLease(lease);
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
      mediaRecorder.start();

      barsRef.current = [];
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

    const htmlContent = editor?.getHTML() ?? "";
    const textContent = defaultContent ?? editor?.getText();

    try {
      const base64Audio = await readBlobAsBase64();
      const response = await fetch(audioTranscriptRoute, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioFile: base64Audio,
          improve: shouldImprove.current,
          projectId: resolvedProjectId,
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
        activeRef.current &&
        (!dictationCoordinator || Boolean(lease && dictationCoordinator.owns(lease)));

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
    if (!activeRef.current || disabled) return;
    if (e.key === "Escape" && recordingRef.current) {
      e.preventDefault();
      stopRecording(false);
    }
    if (e.keyCode === 13 && recordingRef.current) {
      e.preventDefault();
      stopRecording(true);
    }
  };

  const handleKeydownRef = useRef(handleKeydown);
  handleKeydownRef.current = handleKeydown;

  useEffect(() => {
    const listener = (e: KeyboardEvent) => handleKeydownRef.current(e);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  useEffect(() => {
    if (!isMobileCreateComment || !editor) return;
    editor.setEditable(!isProcessing, false);
    return () => editor.setEditable(true, false);
  }, [editor, isMobileCreateComment, isProcessing]);

  useEffect(() => {
    onProcessingChange?.(isProcessing);

  }, [isProcessing]);

  useEffect(() => {
    return () => onProcessingChange?.(false);

  }, []);

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
    if (!activeRef.current) return;
    menuOpenRef.current = true;
    setMenuOpen(true);
    try {
      await ensureStream(selectedDeviceIdRef.current);
      if (!activeRef.current) {
        stopStream();
        return;
      }
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

  useEffect(() => {
    if (active) return;
    if (recordingRef.current) closeHandler();
    closeMenu();
  }, [active]);

  const selectDevice = async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    selectedDeviceIdRef.current = deviceId;
    try {
      localStorage.setItem(DEVICE_STORAGE_KEY, deviceId);
    } catch {
    }
    try {
      await ensureStream(deviceId);
      await listDevices();
    } catch (error) {
      console.error("dictation: could not switch microphone", error);
    }
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);

  }, [menuOpen]);

  const tooltipsOpenUpward = id === "agent-chat-audio-button";

  let recordingSubmitClassName =
    "h-[28px] w-[28px] bg-hypertasks-ai-purple text-white";
  if (isMobileView) {
    recordingSubmitClassName =
      "h-11 w-12 bg-white-black text-white-black-inverted";
    if (mobilePrimaryTone === "ai") {
      recordingSubmitClassName = "h-11 w-12 bg-hypertasks-ai-purple text-white";
    } else if (mobilePrimaryTone === "primary") {
      recordingSubmitClassName =
        "h-11 w-12 bg-shadcn-primary text-primary-foreground";
    }
  }

  return (
    <div className={cn("audio-recorder", recording && "w-full", wrapperClassName)}>
      {!recording ? (
        <div
          ref={menuWrapRef}
          className={cn(
            "relative flex items-center",
            isDesktopAiMic && "gap-0.5",
          )}
        >
          <div
            id={id + "-improve"}
            className="h-0 w-0"
            onClick={() => startRecording(true)}
          />
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
                primaryTone: mobilePrimaryTone,
              });
            let micColorClassName = "text-icon-dark-gray hover:text-white-black";
            if (prominent) {
              micColorClassName = "text-icon-dark-gray";
              if (!hasText) {
                micColorClassName = "text-white-black-inverted";
                if (mobilePrimaryTone === "ai") {
                  micColorClassName = "text-white";
                } else if (mobilePrimaryTone === "primary") {
                  micColorClassName = "text-primary-foreground";
                }
              }
            }
            return (
              <div
                id={id}
                data-ai-chat-recorder={isAiChat || undefined}
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
                  <>
                    <Loader2
                      size={18}
                      strokeWidth={2}
                      className={cn(
                        "animate-spin",
                        "keep-stroke",
                        isDesktopAiMic || mobilePrimaryTone === "ai"
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
                    className={cn("animated-icon", micColorClassName)}
                    style={{ fontSize: aiTaskWriterConfig.fontSizes.moderateIcon }}
                    strokeWidth={1.75}
                  />
                )}
                {!isProcessing && idleLabel && (
                  <span className="text-dense">{idleLabel}</span>
                )}
                {hover &&
                  !isProcessing &&
                  !isAiChat &&
                  id !== "inline-draft-ai-audio-button" && (
                  <>
                    <Tooltip
                      left={0}
                      bottom={tooltipsOpenUpward ? 45 : -45}
                      keyCombination={[isApple ? "CMD" : "CTRL", "SHIFT", "D"]}
                      text={"Speech to text"}
                    />
                    <Tooltip
                      left={0}
                      bottom={tooltipsOpenUpward ? 80 : -80}
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
              recordingSubmitClassName,
            )}
          >
            <Check size={18} strokeWidth={2.2} className="keep-stroke" />
            <Tooltip
              left={0}
              bottom={tooltipsOpenUpward ? 45 : -45}
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
