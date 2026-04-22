interface CommunityLink {
  id: string;
  name: string;
  url: string;
  description?: string;
}

interface Window {
  windowControls: {
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
    onMaximizeChange: (cb: (isMax: boolean) => void) => void;
  };
  zoom: {
    get: () => number;
    set: (factor: number) => void;
  };
  links: {
    open: (url: string) => void;
  };
  favicon: {
    get: (url: string) => Promise<string | null>;
  };
  appData: {
    reset: () => Promise<void>;
  };
  ldplayer: {
    find: () => Promise<Array<{ key: string; pid: number; title: string }>>;
    pick: () => Promise<string | null>;
    stopTracking: () => Promise<void>;
    getTracked: () => Promise<{ key: string; title: string } | null>;
    onTrackedChange: (cb: (info: { key: string; title: string } | null) => void) => void;
  };
  craft: {
    getCatalog: () => Promise<string[]>;
    getInitialState: () => Promise<CraftSessionState>;
    start: (config: CraftConfigDto) => Promise<{ ok: boolean; reason?: string }>;
    stop: () => Promise<{ ok: boolean }>;
    onEvent: (cb: (e: CraftEventDto) => void) => void;
  };
}

interface CraftConfigDto {
  valuable: string[];
  template: [number, number, number, number];
  maxIter: number;
  assumedHitRate: number;
}

interface CraftSessionState {
  totalAttempts: number;
  totalHits: number;
  currentStreak: number;
  longestStreak: number;
  lastHitAt: string | null;
}

interface CraftScanRow {
  row: 1 | 2 | 3 | 4;
  stat: string | null;
  rank: number;
  nameScore: number;
  nameSecondScore: number;
  pctScore: number;
  pctType: 'yes' | 'no';
  complete: boolean;
}

/**
 * Renderer-side mirror of CraftEvent. Main strips the `canonical` Buffer
 * from detection-failure events before sending, so this omits those fields.
 */
type CraftEventDto =
  | {
      type: 'iteration';
      iter: number;
      maxIter: number;
      rows: CraftScanRow[];
      logLine: string;
    }
  | { type: 'settled'; settleMs: number; timedOut: boolean }
  | {
      type: 'hit';
      iter: number;
      rows: CraftScanRow[];
      state: CraftSessionState;
      elapsedMs: number;
    }
  | {
      type: 'detection-failure';
      iter: number;
      rows: CraftScanRow[];
      failedRows: number[];
    }
  | { type: 'limit'; state: CraftSessionState; elapsedMs: number }
  | { type: 'fail'; reason: string; screenFailedRois?: string[] }
  | { type: 'done'; state: CraftSessionState; elapsedMs: number };
