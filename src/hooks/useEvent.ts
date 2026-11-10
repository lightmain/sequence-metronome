import { useCallback, useLayoutEffect, useRef } from 'react';

/** 稳定的事件入口，调用最近一次渲染的处理函数，不重新注册全局监听。 */
export function useEvent<Args extends unknown[], Result>(handler: (...args: Args) => Result) {
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}
