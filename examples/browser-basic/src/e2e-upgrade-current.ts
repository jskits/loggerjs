// The current code opening stores written by the previous release.
import {
  browserHttpTransport,
  createLogger,
  indexedDbBrowserHttpOfflineQueue,
  indexedDbTransport,
} from "@loggerjs/browser";

export interface UpgradedSupportLogs {
  messages: string[];
  sessions: Array<{ sessionId: string; count: number }>;
}

declare global {
  interface Window {
    loggerjsCurrent: {
      readAndExtendSupportLogs: (
        dbName: string,
        sessionId: string,
        message: string,
      ) => Promise<UpgradedSupportLogs>;
      replayOfflineLogs: (dbName: string, url: string) => Promise<number>;
    };
  }
}

window.loggerjsCurrent = {
  async readAndExtendSupportLogs(dbName, sessionId, message) {
    const transport = indexedDbTransport({ dbName, session: sessionId, flushIntervalMs: 0 });
    const logger = createLogger({ category: ["current"], transports: [transport] });
    logger.info(message, { release: "current" });
    await logger.flush();
    const messages: string[] = [];
    for await (const event of transport.query()) messages.push(event.message);
    const sessions = (await transport.sessions()).map(({ sessionId: id, count }) => ({
      sessionId: id,
      count,
    }));
    await logger.close();
    return { messages, sessions };
  },

  async replayOfflineLogs(dbName, url) {
    const offlineQueue = indexedDbBrowserHttpOfflineQueue({ dbName });
    const logger = createLogger({
      category: ["current"],
      transports: [
        browserHttpTransport({
          url,
          flushIntervalMs: 0,
          offlineQueue,
          offlineReplayOnStart: false,
          useBeaconOnPageHide: false,
        }),
      ],
    });
    // An explicit flush with nothing queued replays stored payloads.
    await logger.flush();
    const size = await offlineQueue.size();
    await logger.close();
    offlineQueue.close();
    return size;
  },
};
