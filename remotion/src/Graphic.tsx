// Grafica animata BioVitality. Fiecare sablon deseneaza intr-o cutie de 1000 px latime x (1000 * ar) inaltime;
// aplicatia o scaleaza la marimea aleasa pe video. Acelasi cod ruleaza in previzualizare si la randare.
import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing} from 'remotion';
import templates from './templates.json';

type Props = Record<string, string | boolean>;
export type GraphicProps = {template: string; props: Props; dur: number};
export const TEMPLATES = templates as {id: string; ar: number; fields: {k: string; d: string | boolean}[]}[];

const CREAM = '#F3EDDD', MUTED = 'rgba(243,237,221,.72)', CARD = 'rgba(15,26,20,.88)';
const SANS = "'Montserrat', 'Poppins', Arial, sans-serif", SERIF = "'DM Serif Display', Georgia, serif";

const withDefaults = (id: string, p: Props): Props => {
  const t = TEMPLATES.find((x) => x.id === id);
  const out: Props = {};
  (t?.fields ?? []).forEach((f) => { out[f.k] = p?.[f.k] ?? f.d; });
  return out;
};
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

// intrare lina + iesire in ultimele 10 cadre
function useInOut(dur: number, delay = 0) {
  const frame = useCurrentFrame(), {fps} = useVideoConfig();
  const enter = spring({frame: frame - delay, fps, config: {damping: 200, mass: 0.7}});
  const exit = interpolate(frame, [dur - 10, dur], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return {frame, fps, enter, exit, vis: Math.min(enter, exit)};
}
const Card: React.FC<{show: boolean; children: React.ReactNode; style?: React.CSSProperties}> = ({show, children, style}) => (
  <div style={{background: show ? CARD : 'transparent', borderRadius: 44, padding: '36px 52px', boxSizing: 'border-box',
    boxShadow: show ? '0 30px 80px -30px rgba(0,0,0,.6)' : 'none', ...style}}>{children}</div>
);

const Hook: React.FC<{p: Props; dur: number}> = ({p, dur}) => {
  const {frame, fps, exit} = useInOut(dur);
  const text = String(p.text), words = text.split(/\s+/).filter(Boolean);
  const acc = new Set(String(p.accent).split(',').map((w) => norm(w)).filter(Boolean));
  const size = Math.max(60, Math.min(112, 128 - text.length * 1.6));
  const bg = spring({frame, fps, config: {damping: 200}});
  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', opacity: exit}}>
      <Card show={!!p.card} style={{transform: `scale(${0.9 + 0.1 * bg})`, opacity: bg, maxWidth: 1000, textAlign: 'center'}}>
        <div style={{fontFamily: SANS, fontWeight: 700, fontSize: size, lineHeight: 1.12, color: String(p.color), letterSpacing: -1}}>
          {words.map((w, i) => {
            const s = spring({frame: frame - 4 - i * 3, fps, config: {damping: 14, mass: 0.6}});
            const on = acc.has(norm(w));
            return <span key={i} style={{display: 'inline-block', margin: '0 .14em', opacity: Math.min(1, s * 1.5),
              transform: `translateY(${(1 - s) * 40}px) scale(${0.8 + 0.2 * s})`, color: on ? String(p.accent_color) : undefined}}>{w}</span>;
          })}
        </div>
      </Card>
    </AbsoluteFill>
  );
};

const Stat: React.FC<{p: Props; dur: number}> = ({p, dur}) => {
  const {frame, fps, enter, exit} = useInOut(dur);
  const raw = String(p.value), num = /^\d+([.,]\d+)?$/.test(raw) ? parseFloat(raw.replace(',', '.')) : null;
  const k = interpolate(frame, [4, 4 + fps * 1.1], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const dec = raw.includes(',') || raw.includes('.') ? 1 : 0;
  const shown = p.count && num !== null ? (num * k).toFixed(dec).replace('.', ',') : raw;
  const lab = spring({frame: frame - 14, fps, config: {damping: 200}});
  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', opacity: exit}}>
      <Card show style={{transform: `scale(${0.85 + 0.15 * enter})`, opacity: enter, textAlign: 'center', minWidth: 560}}>
        <div style={{fontFamily: SANS, fontWeight: 700, color: String(p.accent_color), fontSize: 230, lineHeight: 0.95, letterSpacing: -6,
          fontVariantNumeric: 'tabular-nums'}}>{shown}</div>
        <div style={{fontFamily: SERIF, fontStyle: 'italic', color: String(p.color), fontSize: 76, lineHeight: 1.05, marginTop: 6}}>{String(p.unit)}</div>
        <div style={{fontFamily: SANS, fontWeight: 400, color: MUTED, fontSize: 40, marginTop: 18, opacity: lab,
          transform: `translateY(${(1 - lab) * 20}px)`}}>{String(p.label)}</div>
      </Card>
    </AbsoluteFill>
  );
};

const Point: React.FC<{p: Props; dur: number}> = ({p, dur}) => {
  const {frame, fps, enter, exit} = useInOut(dur);
  const txt = spring({frame: frame - 10, fps, config: {damping: 200}});
  return (
    <AbsoluteFill style={{justifyContent: 'center', opacity: exit}}>
      <Card show style={{display: 'flex', alignItems: 'center', gap: 40, opacity: enter, transform: `translateX(${(1 - enter) * -80}px)`}}>
        <div style={{flex: 'none', width: 170, height: 170, borderRadius: '50%', background: String(p.accent_color), display: 'grid',
          placeItems: 'center', fontFamily: SANS, fontWeight: 700, fontSize: 104, color: '#1b1204',
          transform: `scale(${spring({frame: frame - 3, fps, config: {damping: 10, mass: 0.6}})})`}}>{String(p.num)}</div>
        <div>
          <div style={{fontFamily: SANS, fontWeight: 700, fontSize: 30, letterSpacing: 4, color: String(p.accent_color), textTransform: 'uppercase'}}>
            {String(p.num)} / {String(p.total)}</div>
          <div style={{fontFamily: SANS, fontWeight: 700, fontSize: 62, lineHeight: 1.08, color: CREAM, marginTop: 4}}>{String(p.title)}</div>
          <div style={{fontFamily: SANS, fontSize: 34, lineHeight: 1.3, color: MUTED, marginTop: 10, opacity: txt}}>{String(p.text)}</div>
        </div>
      </Card>
    </AbsoluteFill>
  );
};

const Flow: React.FC<{p: Props; dur: number}> = ({p, dur}) => {
  const {frame, fps, exit} = useInOut(dur);
  const steps = String(p.steps).split(/\s*(?:→|->|>|\n)\s*/).map((s) => s.trim()).filter(Boolean).slice(0, 4);
  // marimea se adapteaza ca pasii sa incapa pe un rand
  const chars = steps.reduce((n, s) => n + s.length, 0);
  const size = Math.max(26, Math.min(58, Math.floor(1350 / (chars * 0.62 + steps.length * 3.2 + (steps.length - 1) * 2.4))));
  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', opacity: exit}}>
      <div style={{display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: size * 0.4, maxWidth: 990}}>
        {steps.map((s, i) => {
          const a = spring({frame: frame - 3 - i * 12, fps, config: {damping: 16, mass: 0.6}});
          const last = i === steps.length - 1 && !!p.highlight_last;
          return (
            <React.Fragment key={i}>
              {i > 0 ? <span style={{fontFamily: SANS, fontWeight: 700, fontSize: size * 1.1, color: String(p.accent_color), opacity: a}}>→</span> : null}
              <span style={{fontFamily: SANS, fontWeight: 700, fontSize: size, padding: `${size * 0.45}px ${size * 0.65}px`, borderRadius: 999,
                background: last ? String(p.accent_color) : CARD, color: last ? '#1b1204' : CREAM,
                border: last ? 'none' : '3px solid rgba(243,237,221,.25)', opacity: a, transform: `scale(${0.7 + 0.3 * a})`,
                display: 'inline-block', boxShadow: '0 20px 50px -24px rgba(0,0,0,.6)'}}>{s}</span>
            </React.Fragment>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const LowerThird: React.FC<{p: Props; dur: number}> = ({p, dur}) => {
  const {frame, fps, enter, exit} = useInOut(dur);
  const bar = interpolate(frame, [0, 12], [0, 1], {extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const txt = spring({frame: frame - 6, fps, config: {damping: 200}});
  return (
    <AbsoluteFill style={{justifyContent: 'center', opacity: exit}}>
      <div style={{display: 'flex', alignItems: 'stretch', gap: 26, opacity: enter}}>
        <div style={{width: 14, borderRadius: 7, background: String(p.accent_color), transform: `scaleY(${bar})`}} />
        <div style={{background: CARD, borderRadius: 30, padding: '26px 44px', clipPath: `inset(0 ${(1 - txt) * 100}% 0 0 round 30px)`}}>
          <div style={{fontFamily: SANS, fontWeight: 700, fontSize: 70, color: CREAM, lineHeight: 1.05}}>{String(p.name)}</div>
          <div style={{fontFamily: SANS, fontSize: 34, color: MUTED, marginTop: 6}}>{String(p.role)}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Cta: React.FC<{p: Props; dur: number}> = ({p, dur}) => {
  const {frame, fps, enter, exit} = useInOut(dur);
  const pulse = 1 + 0.03 * Math.sin((frame / fps) * Math.PI * 2);
  const t2 = spring({frame: frame - 10, fps, config: {damping: 200}});
  const brand = String(p.brand), cut = brand.toLowerCase().startsWith('bio') ? 3 : 0;
  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', opacity: exit}}>
      <Card show style={{textAlign: 'center', opacity: enter, transform: `scale(${0.88 + 0.12 * enter})`, padding: '56px 70px'}}>
        <div style={{fontFamily: SERIF, fontSize: 104, color: CREAM, lineHeight: 1}}>
          {brand.slice(0, cut)}<span style={{color: String(p.accent_color)}}>{brand.slice(cut)}</span></div>
        <div style={{display: 'inline-block', marginTop: 40, padding: '24px 54px', borderRadius: 999, background: String(p.accent_color),
          fontFamily: SANS, fontWeight: 700, fontSize: 58, color: '#1b1204', transform: `scale(${pulse * t2})`}}>{String(p.title)}</div>
        <div style={{fontFamily: SANS, fontSize: 36, color: MUTED, marginTop: 30, opacity: t2}}>{String(p.subtitle)}</div>
      </Card>
    </AbsoluteFill>
  );
};

const MAP: Record<string, React.FC<{p: Props; dur: number}>> = {hook: Hook, stat: Stat, point: Point, flow: Flow, lower_third: LowerThird, cta: Cta};

export const Graphic: React.FC<GraphicProps> = ({template, props, dur}) => {
  const C = MAP[template];
  if (!C) return null;
  return <C p={withDefaults(template, props)} dur={Math.max(12, dur)} />;
};
