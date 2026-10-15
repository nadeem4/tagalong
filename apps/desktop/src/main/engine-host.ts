import { app, screen, shell } from 'electron';
import { isSignInPage } from './links';
import { Engine } from '@tagalong/core';
import type { SecretStore } from '@tagalong/core';
import type {
  CaptureExclusions,
  PerceptionDiffParams,
  PerceptionRecallParams,
} from '@tagalong/protocol';
import { captureNotice } from './capture-notice';
import { DESKTOP_CAPABILITIES, answerCapture, capturePatch } from './context';
import { EngineClient } from './engine-client';
import type { EngineNotification } from './engine-client';
import type { Platform } from './platform/index';
import { answerPointAt } from './platform/point-target';
import type { PointTarget } from './platform/point-target';
import type { CaptureNotice } from '../shared/ipc';

export interface EngineHost {
  engine: Engine;
  client: EngineClient;
  shutdown: () => Promise<void>;
}

export interface StartEngineHostOptions {
  dataDir: string;
  secrets: SecretStore;
  platform: Platform;
  onNotification: (notification: EngineNotification) => void;
  /** Read at capture time rather than at boot, so an edited exclusion list takes effect. */
  captureExclusions: () => CaptureExclusions;
  /** A pet's own tool can ask to look; that capture must be as visible as the hotkey's. */
  onCapture: (notice: CaptureNotice) => void;
  /** Phase 3B: rolling memory and the watch diff, answered from in-memory frames. */
  recall: (params: PerceptionRecallParams) => Promise<unknown>;
  diff: (params: PerceptionDiffParams) => Promise<unknown>;
  /** Point, don't click: draws the ring on the overlay. Only draws. */
  showRing: (ring: PointTarget & { label: string }) => void;
}

/**
 * Boots the engine inside the main process and dials it as an ordinary host.
 *
 * In-process is an optimisation, not a shortcut: the host still speaks the protocol over
 * the loopback socket, so nothing here can come to depend on engine internals that the
 * Chrome host will not have.
 */
export async function startEngineHost(options: StartEngineHostOptions): Promise<EngineHost> {
  const { dataDir } = options;

  const engine = await Engine.boot({
    dataDir,
    secretStore: options.secrets,
    engineVersion: app.getVersion(),
    env: process.env,
    // A connected app's sign-in, in the system browser; it comes back to a loopback.
    openBrowser: async (url) => {
      if (!isSignInPage(url)) throw new Error('That sign-in page is not https.');
      await shell.openExternal(url);
    },
  });

  const client = await EngineClient.connect({
    port: engine.port,
    token: engine.pairingToken,
    hostVersion: app.getVersion(),
    capabilities: DESKTOP_CAPABILITIES,
    readText: async (params) => {
      const reading = await options.platform.readWindowText(params, options.captureExclusions());
      // Read from a picture means a picture was taken: announced like any screenshot.
      if (reading.source === 'ocr') {
        options.onCapture(
          captureNotice({ at: new Date(), screenshot: true, blocked: null, paused: false }),
        );
      }
      return reading;
    },
    listWindows: async () => {
      const { windows, displays } = await options.platform.listWindows(options.captureExclusions());
      return displays === undefined ? { windows } : { windows, displays };
    },
    captureRegion: async (params) => {
      const image = await options.platform.captureRegion(params, options.captureExclusions());
      if (image === null) {
        // A refusal the pet can repeat: the tool result says which display could not be
        // cropped. A blocked display lands here too, without saying what blocked it.
        throw new Error(`no crop available for display ${params.displayId}`);
      }
      return { image: { mime: 'image/png', ...image } };
    },
    captureWindow: async (params) => {
      const shot = await options.platform.lookAtWindow(params, options.captureExclusions());
      // A window screenshot is a capture like any other: the badge and the tray say so.
      options.onCapture(
        captureNotice({
          at: new Date(),
          screenshot: true,
          blocked: shot.blocked ?? null,
          paused: false,
        }),
      );
      return shot;
    },
    capture: async (what) => {
      const captured = await capturePatch(options.platform, what, {
        exclusions: options.captureExclusions(),
      });
      const { blocked, paused } = captured;
      options.onCapture(
        captureNotice({
          at: new Date(),
          screenshot: what.includes('screenshot'),
          blocked,
          paused,
        }),
      );
      return answerCapture(what, captured);
    },
    recall: options.recall,
    diff: options.diff,
    pointAt: (params) =>
      answerPointAt(
        {
          findElement: (asked) => options.platform.findElement(asked, options.captureExclusions()),
          displays: () => screen.getAllDisplays(),
          // UI Automation reports screen pixels; Windows knows each monitor's scale.
          toDip: (rect) => screen.screenToDipRect(null, rect),
          show: options.showRing,
        },
        params,
      ),
    onNotification: options.onNotification,
  });

  console.log(`[engine-host] engine listening on 127.0.0.1:${engine.port}, data dir ${dataDir}`);

  return {
    engine,
    client,
    shutdown: async () => {
      client.close();
      await engine.shutdown();
    },
  };
}
