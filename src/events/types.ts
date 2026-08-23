export type ProxyEventKind =
  | 'server.connected'
  | 'server.disconnected'
  | 'server.error'
  | 'request.started'
  | 'request.succeeded'
  | 'request.failed'
  | 'request.blocked';

export type ProxyEvent = {
  seq?: number;
  id: string;
  timestamp: string;
  kind: ProxyEventKind;
  requestId?: string;
  serverName?: string;
  method?: string;
  name?: string;
  durationMs?: number;
  ruleId?: string;
  error?: { message: string; code?: string | number };
};
