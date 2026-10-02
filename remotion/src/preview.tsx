// Pachet pentru previzualizarea din aplicatie (static/graphics.js): aceleasi sabloane ca la randare.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Thumbnail} from '@remotion/player';
import {Graphic, TEMPLATES} from './Graphic';

(window as unknown as {BVGraphics: unknown}).BVGraphics = {
  templates: TEMPLATES,
  mount(el: HTMLElement) {
    const root = createRoot(el);
    return {
      render(template: string, props: Record<string, string | boolean>, frame: number, dur: number, fps: number) {
        const ar = TEMPLATES.find((t) => t.id === template)?.ar ?? 0.5;
        const d = Math.max(1, Math.round(dur));
        root.render(
          <Thumbnail component={Graphic as unknown as React.FC<Record<string, unknown>>}
            inputProps={{template, props, dur: d}} compositionWidth={1000} compositionHeight={Math.round(1000 * ar)}
            durationInFrames={d} fps={fps} frameToDisplay={Math.max(0, Math.min(d - 1, Math.round(frame)))}
            style={{width: '100%', height: '100%'}} />);
      },
      unmount() { root.unmount(); },
    };
  },
};
