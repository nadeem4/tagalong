/* The React wrapper. One component, SSR-safe: it renders a plain div and
   mounts the mascot in an effect. Forked from wobnimo (MIT, see LICENSE);
   it takes a spec only, and a mood may be one of the spec's own names.

     <Mascot character={spec} state="reading" />
     <Mascot character={spec} status={status} />   // chat status drives the mood */

import { useEffect, useRef } from 'react';
import { Mascot as Engine, type MascotMood, type MascotOptions } from './runtime/mascot';
import { driveFromStatus, type ChatStatus } from './runtime/status';
import type { Palette } from './runtime/customize';
import type { CharacterSpec } from './spec/types';

export interface MascotProps extends Omit<MascotOptions, 'state' | 'palette'> {
  character: CharacterSpec;
  /** The mood. Ignored while `status` is set. */
  state?: MascotMood;
  /** A chat status; drives the mood for you. */
  status?: ChatStatus;
  /** Recolour materials by name, e.g. `{ shell: '#e0457b' }`. */
  palette?: Palette;
  /** Fired when the mascot is clicked or poked. */
  onPoke?: () => void;
  /** Fired the first time a frame is on screen; use it to fade the mascot in. */
  onReady?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export function Mascot({
  character: spec,
  state,
  status,
  palette,
  onPoke,
  onReady,
  className,
  style,
  ...options
}: MascotProps) {
  const host = useRef<HTMLDivElement>(null);
  const mascot = useRef<Engine | null>(null);

  /* latest callbacks, without rebuilding the mascot when they change */
  const poke = useRef(onPoke);
  const ready = useRef(onReady);
  poke.current = onPoke;
  ready.current = onReady;

  useEffect(() => {
    if (!host.current) return;
    const m = new Engine(host.current.appendChild(document.createElement('canvas')), spec, {
      ...options,
      state: status ? 'idle' : state,
      palette,
    });
    m.canvas.style.cssText = 'display:block;width:100%;height:100%';
    const offPoke = m.on('poke', () => poke.current?.());
    const offReady = m.on('ready', () => ready.current?.());
    mascot.current = m;
    return () => {
      offPoke();
      offReady();
      m.dispose();
      m.canvas.remove();
      mascot.current = null;
    };
  }, [spec]);

  useEffect(() => {
    if (mascot.current && status) driveFromStatus(mascot.current, status);
  }, [status]);

  useEffect(() => {
    if (mascot.current && state && !status) mascot.current.setState(state);
  }, [state, status]);

  useEffect(() => {
    mascot.current?.setPalette(palette);
  }, [JSON.stringify(palette)]);

  return <div ref={host} className={className} style={{ width: 160, height: 160, ...style }} />;
}
