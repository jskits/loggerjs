// Runs the previous published release (installed under an npm alias) so
// upgrade tests can check that the current code reads what it stored.
import {
  browserHttpTransport,
  createLogger,
  indexedDbBrowserHttpOfflineQueue,
  indexedDbTransport,
} from "@loggerjs/browser-previous";

export interface PreviousReleaseFixture {
  writeSupportLogs: (dbName: string, sessionId: string, messages: string[]) => Promise<void>;
  queueOfflineLogs: (dbName: string, url: string, messages: string[]) => Promise<number>;
}

declare global {
  interface Window {
    loggerjsPrevious: PreviousReleaseFixture;
  }
}

window.loggerjsPrevious = {
  async writeSupportLogs(dbName, sessionId, messages) {
    const transport = indexedDbTransport({ dbName, session: sessionId, flushIntervalMs: 0 });
    const logger = createLogger({ category: ["previous"], transports: [transport] });
    // Flush each event: 0.6.0 could drop events logged during an in-flight
    // write, and this fixture must store all of them.
    for (const message of messages) {
      logger.info(message, { release: "previous" });
      // oxlint-disable-next-line no-await-in-loop -- Store one event at a time.
      await logger.flush();
    }
    await logger.close();
  },

  async queueOfflineLogs(dbName, url, messages) {
    const offlineQueue = indexedDbBrowserHttpOfflineQueue({ dbName });
    const logger = createLogger({
      category: ["previous"],
      transports: [
        browserHttpTransport({
          url,
          flushIntervalMs: 0,
          maxBatchSize: 100,
          offlineQueue,
          offlineReplayOnStart: false,
          useBeaconOnPageHide: false,
        }),
      ],
    });
    for (const message of messages) logger.info(message);
    await logger.flush().catch(() => {});
    const size = await offlineQueue.size();
    offlineQueue.close();
    return size;
  },
};
