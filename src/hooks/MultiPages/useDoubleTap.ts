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

    const runDoubleTap = useCallback(
        (event: MouseEvent<Target>) => {
            lastDoubleTapAt.current = event.timeStamp;
            callback && callback(event);
        },
        [callback]
    );

    const handler = useCallback<CallbackFunction<Target>>(
        (event: MouseEvent<Target>) => {
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
            if (
                lastDoubleTapAt.current !== null &&
                Math.abs(event.timeStamp - lastDoubleTapAt.current) <= threshold
            ) return;
            runDoubleTap(event);
        },
        [runDoubleTap, threshold]
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
