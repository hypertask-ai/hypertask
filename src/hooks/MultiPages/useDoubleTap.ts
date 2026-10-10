import {
    MouseEvent,
    MouseEventHandler,
    useCallback,
    useEffect,
    useRef,
} from 'react';

type EmptyCallback = () => void;

export type CallbackFunction<Target = Element> = MouseEventHandler<Target> | EmptyCallback;

export type DoubleTapCallback<Target = Element> = CallbackFunction<Target> | null;

export interface DoubleTapOptions<Target = Element> {
    onSingleTap?: CallbackFunction<Target>;
    shouldHandleEvent?: (event: MouseEvent<Target>) => boolean;
}

export type DoubleTapResult<Target, Callback> = Callback extends CallbackFunction<Target>
    ? {
          onClick: CallbackFunction<Target>;
          onDoubleClick: CallbackFunction<Target>;
      }
    : Callback extends null
    ? {}
    : never;

export function useDoubleTap<
    Target = Element,
    Callback extends DoubleTapCallback<Target> = DoubleTapCallback<Target>
>(
    callback: Callback,
    threshold: number = 300,
    options: DoubleTapOptions<Target> = {}
): DoubleTapResult<Target, Callback> {
    const timer = useRef<NodeJS.Timeout | null>(null);
    const lastDoubleTapAt = useRef<number | null>(null);
    const openingClickAccepted = useRef(false);

    const runDoubleTap = useCallback(
        (event: MouseEvent<Target>) => {
            lastDoubleTapAt.current = event.timeStamp;
            callback && callback(event);
        },
        [callback]
    );

    const handler = useCallback<CallbackFunction<Target>>(
        (event: MouseEvent<Target>) => {
            const accepted = !options.shouldHandleEvent || options.shouldHandleEvent(event);
            if (options.shouldHandleEvent && event.detail <= 1) {
                openingClickAccepted.current = accepted;
            }
            if (!accepted) {
                // A control tap must also break a pending text double tap.
                if (timer.current) clearTimeout(timer.current);
                timer.current = null;
                return;
            }
            if (!timer.current) {
                timer.current = setTimeout(() => {
                    if (options.onSingleTap) {
                        options.onSingleTap(event);
                    }
                    timer.current = null;
                }, threshold);
            } else {
                clearTimeout(timer.current);
                timer.current = null;
                runDoubleTap(event);
            }
        },
        [options, runDoubleTap, threshold]
    );

    const nativeDoubleClickHandler = useCallback<CallbackFunction<Target>>(
        (event: MouseEvent<Target>) => {
            if (timer.current) {
                clearTimeout(timer.current);
                timer.current = null;
            }
            if (options.shouldHandleEvent && (!openingClickAccepted.current || !options.shouldHandleEvent(event))) return;
            if (
                lastDoubleTapAt.current !== null &&
                Math.abs(event.timeStamp - lastDoubleTapAt.current) <= threshold
            ) return;
            runDoubleTap(event);
        },
        [options, runDoubleTap, threshold]
    );

    useEffect(
        () => () => {
            if (timer.current) clearTimeout(timer.current);
        },
        []
    );

    return (callback
        ? {
              onClick: handler,
              onDoubleClick: nativeDoubleClickHandler,
          }
        : {}) as DoubleTapResult<Target, Callback>;
}
