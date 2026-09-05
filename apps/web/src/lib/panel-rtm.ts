import type { RTMEngine } from "agora-agent-client-toolkit";

/** The toolkit labels ALL user ASR as local. Only feed it the candidate agent.
 * Human-listener transcripts are role-labelled by the backend instead.
 */
export function panelRtmEngine(engine: RTMEngine, agentUid: string): RTMEngine {
  type Listener = Parameters<RTMEngine["addEventListener"]>[1];
  const wrapped = new Map<Listener, Listener>();
  return {
    publish: (channel, message, options) => engine.publish(channel, message, options),
    addEventListener(event, listener) {
      if (event !== "message") return engine.addEventListener(event, listener);
      const filter: Listener = (message, ...args) => {
        if (String(message?.publisher) === agentUid) listener(message, ...args);
      };
      wrapped.set(listener, filter);
      engine.addEventListener(event, filter);
    },
    removeEventListener(event, listener) {
      engine.removeEventListener(event, wrapped.get(listener) ?? listener);
      wrapped.delete(listener);
    },
  };
}
