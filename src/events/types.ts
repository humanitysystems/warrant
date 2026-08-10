export type ProxyEventKind =
  | 'server.connected'
  | 'server.disconnected'
  | 'server.error'
  | 'request.started'
  | 'request.succeeded'
  | 'request.failed';

export type ProxyEvent = {
  id: string;
  timestamp: string;
  kind: ProxyEventKind;
  requestId?: string;
  serverName?: string;
  method?: string;
  name?: string;
  durationMs?: number;
  error?: { message: string; code?: string | number };
};
