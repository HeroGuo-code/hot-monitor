import type { Hotspot } from './api';

export interface EventHandlers {
  onConnected?: (connected: boolean) => void;
  onHotspot?: (hotspot: Hotspot) => void;
  onCheckDone?: (payload: { found: number; at: string }) => void;
  onCheckError?: (payload: { message: string }) => void;
}

/**
 * 订阅服务端 SSE 推送（/api/events），返回取消订阅函数。
 * EventSource 断线自动重连（服务端下发 retry: 5000）。
 */
export function connectEvents(handlers: EventHandlers): () => void {
  const es = new EventSource('/api/events');

  es.addEventListener('connected', () => handlers.onConnected?.(true));
  es.onopen = () => handlers.onConnected?.(true);
  es.onerror = () => handlers.onConnected?.(false);

  es.addEventListener('hotspot:new', e => {
    try { handlers.onHotspot?.(JSON.parse(e.data)); } catch { /* 忽略坏帧 */ }
  });
  es.addEventListener('check:done', e => {
    try { handlers.onCheckDone?.(JSON.parse(e.data)); } catch { /* 忽略坏帧 */ }
  });
  es.addEventListener('check:error', e => {
    try { handlers.onCheckError?.(JSON.parse(e.data)); } catch { /* 忽略坏帧 */ }
  });

  return () => es.close();
}
