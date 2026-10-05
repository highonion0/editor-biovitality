// Proiectul trimis de aplicatie. Timpii din `segments` sunt in video-ul sursa (secunde);
// timpii din `captions` si `overlays` sunt pe timeline-ul final (secunde).
export type Keyframe = {t: number; x?: number; y?: number; w?: number; opacity?: number; rotation?: number};
export type AnimKind = 'none' | 'fade' | 'slide_up' | 'slide_down' | 'slide_left' | 'slide_right' | 'pop';
export type TransKind = 'none' | 'dissolve' | 'fade' | 'flash' | 'zoom' | 'blur';
export type Zoom = {id?: string; start: number; end: number; scale: number; x: number; y: number; style: 'punch' | 'smooth' | 'creep'};
export type Word = {t: string; color?: string; b?: boolean; i?: boolean; u?: boolean; s?: number; e?: number};
export type Cue = {start: number; end: number; words: Word[]; hidden?: boolean};
export type CaptionStyle = {
  font: string; size: number; color: string; bold: boolean; italic: boolean; uppercase: boolean;
  mode: 'outline' | 'box' | 'none'; outline: number; outline_color: string;
  box_color: string; box_opacity: number; pos_x: number; pos_y: number;
  anim?: 'none' | 'highlight' | 'pop' | 'reveal' | 'pill' | 'single'; anim_color?: string;
};
export type Pip = {shape: 'rect' | 'circle' | 'tall'; w: number; x: number; y: number};
export type FontDef = {id: string; ratio: number; files: [string, number, string][]};
export type Overlay = {
  type: 'image' | 'video' | 'graphic'; src?: string; start: number; end: number;
  template?: string; props?: Record<string, string | boolean>;
  x: number; y: number; w: number; opacity?: number; muted?: boolean; source_start?: number;
  rotation?: number; radius?: number; ar?: number; lane?: number; fit?: 'cover' | 'free' | 'bg';
  pip?: Pip;            // doar pentru fit = 'bg': fereastra in care apari tu, peste acest fundal
  keys?: Keyframe[]; anim_in?: AnimKind; anim_out?: AnimKind; anim_dur?: number;
};
export type AudioItem = {
  src: string; start: number; end: number; source_start: number;
  volume: number; fade_in: number; fade_out: number;
};
export type Project = {
  width: number; height: number; fps: number;
  source: string;
  segments: {from: number; to: number}[];
  captions: {style: CaptionStyle; cues: Cue[]} | null;
  fonts: FontDef[];
  overlays: Overlay[];
  audio?: AudioItem[];
  zooms?: Zoom[];
  transitions?: Record<string, {kind: TransKind; dur: number}>;
  grade?: number[] | null;       // matricea de culoare 4x5, ca feColorMatrix
  main_audio?: string | null;    // sunetul curatat, pe timpul sursei
};
