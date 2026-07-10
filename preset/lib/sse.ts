type AnyEventHandler = ((event: any) => void) | null;

type ListenerMap = Map<string, Set<(event: any) => void>>;

export type EventSourceLike = {
  readyState: number;
  onopen: AnyEventHandler;
  onmessage: AnyEventHandler;
  onerror: AnyEventHandler;
  addEventListener: (type: string, listener: (event: any) => void) => void;
  removeEventListener: (type: string, listener: (event: any) => void) => void;
  close: () => void;
};

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

class NativeEventSourceAdapter implements EventSourceLike {
  private inner: any;
  public readyState = CONNECTING;
  public onopen: AnyEventHandler = null;
  public onmessage: AnyEventHandler = null;
  public onerror: AnyEventHandler = null;

  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.inner = new EventSource(url, init);
    this.readyState = this.inner.readyState;

    this.inner.onopen = (event) => {
      this.readyState = this.inner.readyState;
      this.onopen?.(event);
    };
    this.inner.onmessage = (event) => {
      this.readyState = this.inner.readyState;
      this.onmessage?.(event);
    };
    this.inner.onerror = (event) => {
      this.readyState = this.inner.readyState;
      this.onerror?.(event);
    };
  }

  addEventListener(type: string, listener: (event: any) => void) {
    this.inner.addEventListener(type, listener as EventListener);
  }

  removeEventListener(type: string, listener: (event: any) => void) {
    this.inner.removeEventListener(type, listener as EventListener);
  }

  close() {
    this.inner.close();
    this.readyState = CLOSED;
  }
}

class FetchEventSourceAdapter implements EventSourceLike {
  public readyState = CONNECTING;
  public onopen: AnyEventHandler = null;
  public onmessage: AnyEventHandler = null;
  public onerror: AnyEventHandler = null;
  private listeners: ListenerMap = new Map();
  private abortController: AbortController | null = null;
  private closed = false;
  private url: string;
  private init?: { withCredentials?: boolean };

  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.init = init;
    void this.start();
  }

  addEventListener(type: string, listener: (event: any) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: any) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.closed = true;
    this.readyState = CLOSED;
    this.abortController?.abort();
    this.abortController = null;
    this.listeners.clear();
  }

  private emit(type: string, event: any) {
    const handler = type === 'open' ? this.onopen : type === 'error' ? this.onerror : type === 'message' ? this.onmessage : null;
    handler?.(event);

    const listeners = this.listeners.get(type);
    if (listeners) {
      for (const listener of listeners) listener(event);
    }
  }

  private async start() {
    this.abortController = new AbortController();

    try {
      const response = await fetch(this.url, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        credentials: this.init?.withCredentials ? 'include' : 'same-origin',
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      this.readyState = OPEN;
      this.emit('open', { type: 'open', target: this });

      if (!response.body) {
        throw new Error('SSE body stream unavailable');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let eventName = 'message';
      let dataBuffer: string[] = [];
      let lastEventId = '';

      const dispatch = () => {
        if (!dataBuffer.length && eventName === 'message') return;
        const data = dataBuffer.join('\n');
        const event = {
          type: eventName,
          data,
          lastEventId,
          target: this,
        };
        if (eventName === 'message') {
          this.emit('message', event);
        } else {
          this.emit(eventName, event);
        }
        dataBuffer = [];
        eventName = 'message';
      };

      while (!this.closed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let lineEnd = buffer.indexOf('\n');
        while (lineEnd >= 0) {
          let line = buffer.slice(0, lineEnd);
          buffer = buffer.slice(lineEnd + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);

          if (line === '') {
            dispatch();
          } else if (line.startsWith(':')) {
            // comment / heartbeat
          } else {
            const colonIndex = line.indexOf(':');
            const field = colonIndex >= 0 ? line.slice(0, colonIndex) : line;
            let value = colonIndex >= 0 ? line.slice(colonIndex + 1) : '';
            if (value.startsWith(' ')) value = value.slice(1);

            switch (field) {
              case 'event':
                eventName = value || 'message';
                break;
              case 'data':
                dataBuffer.push(value);
                break;
              case 'id':
                lastEventId = value;
                break;
              case 'retry':
                break;
              default:
                break;
            }
          }

          lineEnd = buffer.indexOf('\n');
        }
      }

      this.readyState = CLOSED;
      if (!this.closed) {
        this.emit('error', { type: 'error', target: this });
      }
    } catch (error) {
      if (!this.closed) {
        this.readyState = CLOSED;
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      this.abortController = null;
    }
  }
}

export function createEventSource(url: string, init?: { withCredentials?: boolean }): EventSourceLike {
  const NativeEventSource = (globalThis as any).EventSource as any;

  if (typeof NativeEventSource === 'function') {
    return new NativeEventSourceAdapter(url, init);
  }

  return new FetchEventSourceAdapter(url, init);
}
