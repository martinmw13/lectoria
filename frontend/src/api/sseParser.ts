// Dependency-free Server-Sent Events parsing for the book-processing stream.
//
// Two units, kept pure/isolated so they are unit-testable against canned chunk
// streams once a frontend test runner lands (deferred to #66):
//   - parseSSEStream:        bytes -> { event, data } frames (the wire format)
//   - interpretProgressEvent: a frame -> the Lectoria progress protocol
//
// Why hand-rolled rather than EventSource: see
// docs/adr/0001-frontend-streaming-uses-fetch-not-eventsource.md.

export interface SSEFrame {
  /** The `event:` field; defaults to 'message' per the SSE spec when absent. */
  event: string;
  /** Multi-line `data:` payloads joined with '\n' (trailing newline stripped). */
  data: string;
}

export type ProgressUpdate =
  | { type: 'ping' } // keepalive — caller drops it
  | { type: 'progress'; message: string }
  | { type: 'done'; bookId: string }
  | { type: 'error'; message: string }; // in-stream pipeline failure (no HTTP status)

const LINE_TERMINATOR = /\r\n|\r|\n/;

interface FrameState {
  event: string;
  data: string[];
}

// Feed one decoded line into the in-progress frame. Returns a completed frame
// when `line` is the blank-line event terminator, otherwise null while the
// frame is still accumulating. Mutates `state`.
function feedLine(line: string, state: FrameState): SSEFrame | null {
  if (line === '') {
    if (state.event === '' && state.data.length === 0) return null;
    const frame: SSEFrame = { event: state.event || 'message', data: state.data.join('\n') };
    state.event = '';
    state.data = [];
    return frame;
  }
  if (line.startsWith(':')) return null; // comment line
  const colon = line.indexOf(':');
  const field = colon === -1 ? line : line.slice(0, colon);
  let value = colon === -1 ? '' : line.slice(colon + 1);
  if (value.startsWith(' ')) value = value.slice(1); // strip one optional leading space
  if (field === 'event') state.event = value;
  else if (field === 'data') state.data.push(value);
  // id / retry / unknown fields are ignored
  return null;
}

// Generic SSE frame reader. Handles chunk-boundary buffering (including a `\r\n`
// split across two reads), blank-line event separation, and multi-line `data:`.
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEFrame> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const state: FrameState = { event: '', data: [] };
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const match = LINE_TERMINATOR.exec(buffer);
        if (match === null) break;
        // A lone trailing '\r' may be the first half of a '\r\n' split across
        // chunks — hold it back until the next read resolves the ambiguity.
        if (match[0] === '\r' && match.index + 1 === buffer.length) break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const frame = feedLine(line, state);
        if (frame) yield frame;
      }
    }
  } finally {
    // Tear down the underlying connection on early consumer return (done/error).
    reader.cancel().catch(() => {});
  }
}

// Pure interpreter: map a frame to the Lectoria progress protocol. Keys off the
// `data:` prefix (the backend re-encodes the real type there — see ADR-0001) and
// drops `event: ping` keepalives.
export function interpretProgressEvent(frame: SSEFrame): ProgressUpdate {
  if (frame.event === 'ping') return { type: 'ping' };
  const { data } = frame;
  if (data.startsWith('done:')) {
    return { type: 'done', bookId: data.slice('done:'.length).trim() };
  }
  if (data.startsWith('error:')) {
    return { type: 'error', message: data.slice('error:'.length).trim() };
  }
  return { type: 'progress', message: data };
}
