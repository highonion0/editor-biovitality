import React from 'react';
import {Composition} from 'remotion';
import {Main} from './Main';
import type {Project} from './types';

const demo: Project = {
  width: 1080, height: 1920, fps: 30, source: '', segments: [], captions: null, fonts: [], overlays: [],
};

export const Root: React.FC = () => (
  <Composition
    id="Main"
    component={Main as unknown as React.FC<Record<string, unknown>>}
    defaultProps={demo as unknown as Record<string, unknown>}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={30}
    calculateMetadata={({props}) => {
      const p = props as unknown as Project;
      const frames = p.segments.reduce(
        (n, s) => n + Math.max(1, Math.round(s.to * p.fps) - Math.round(s.from * p.fps)), 0);
      return {width: p.width, height: p.height, fps: p.fps, durationInFrames: Math.max(1, frames)};
    }}
  />
);
