import { useEffect, useMemo, type ReactNode } from "react";
import { Provider, createStore, useSetAtom } from "jotai";
import type { TraceClient } from "./traceClient.js";
import { bindTraceVersion, traceClientAtom, traceVersionAtom } from "./atoms/trace.js";

/**
 * Jotai Provider + {@link bindTraceVersion} for the extension/embed shells.
 * Keeps jotai as a devtools dependency so consumers need not declare it.
 */
export function TraceProvider({ client, children }: { client: TraceClient; children: ReactNode }) {
  const jotaiStore = useMemo(() => createStore(), []);
  return (
    <Provider store={jotaiStore}>
      <TraceBinder client={client} />
      {children}
    </Provider>
  );
}

function TraceBinder({ client }: { client: TraceClient }) {
  const setTraceClient = useSetAtom(traceClientAtom);
  const bumpTraceVersion = useSetAtom(traceVersionAtom);
  useEffect(() => {
    setTraceClient(client);
    const unbind = bindTraceVersion(client, () => bumpTraceVersion());
    return () => {
      unbind();
      setTraceClient(null);
    };
  }, [client, setTraceClient, bumpTraceVersion]);
  return null;
}
