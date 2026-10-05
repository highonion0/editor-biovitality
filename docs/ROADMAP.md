# Ce a rămas de făcut

Preluat din chatul vechi în care a fost dezvoltată aplicația (2 octombrie 2026).

## Din lista inițială
1. **Scoaterea fundalului** — *următorul pas pentru „🧍 Tu peste el” decupat (ca efectul green screen de pe TikTok)*
   - Pe poze (logo, produse), unde merge rapid.
   - Pe video-ul cu persoana filmată, ca să fie pusă peste alt fundal: culoare, poză, alt video sau fundalul original estompat.
   - Rulează local pe RTX 4070, fără costuri pe cerere.
   - Modelele de decupare (~0,5 GB) se descarcă o singură dată, ca opțiune separată (un `.bat` propriu, ca la GPU și Remotion).
2. **Biblioteca de muzică**
   - Muzica trending de pe TikTok/Instagram e licențiată doar în aplicațiile lor. Conturile de business au acces doar la biblioteca comercială.
   - Arsă direct în video, o astfel de melodie riscă sunet dezactivat sau reclamații de copyright.
   - Soluția: o bibliotecă dintr-un folder local cu muzică licențiată (Epidemic Sound, Artlist, YouTube Audio Library, Pixabay), cu etichete de stare.
   - Sunetul trending se adaugă direct în aplicația platformei, la publicare.
3. **Generare automată de video prin API (varianta B)**
   - Varianta A (DaVinci asistat) există deja.
   - B: un serviciu cu API (fal.ai, Google Veo, OpenAI Sora). Claude scrie prompt-ul, aplicația generează clipul, iar clipul apare singur pe timeline.
   - Structura e pregătită, deci se poate adăuga fără refaceri.
   - Cost estimat: ~1–3 $ per video.

## Din brainstorming
5. **Șabloane de serie + procesare în lot** — *cel mai valoros punct (ritm de ~30 video/zi)*
   - Se salvează un format recurent: look, stil de subtitrări, intro, final, grafice tipice.
   - Formatul se aplică pe toate video-urile pregătite, iar propunerile se generează automat.
   - Utilizatorul doar aprobă, apoi randarea merge în coadă, inclusiv peste noapte.
## Făcute
- **Reordonarea bucăților** din video-ul principal (tragere pe timeline, butoane ◀ ▶, Alt+←/→).
- **4. Pachet de publicare** (tabul 📣 Publicare): descriere, hashtag-uri, text de copertă și primul comentariu pe platformă + coperta.
- **6. Variante de cârlig (A/B)** (tabul 📣 Publicare): `varianta_A.mp4`, `varianta_B.mp4`…
- **7. Biblioteca de poze și clipuri** (tabul 📚 Bibliotecă); Claude le propune în 💡 Propuneri.
- **Materiale obligatorii** urcate odată cu video-ul, puse automat pe timeline.
- **🧍 Tu peste el**: poză / clip ca fundal, tu într-o fereastră (dreptunghi / cerc / vertical). Varianta decupată = punctul 1.
- **Captionul tău** în `caption.txt`; video-uri lungi (10+ min) fără probleme de memorie.

## Excluse explicit (se ocupă utilizatorul)
- Verificarea afirmațiilor de sănătate.
- Versiunile în italiană și engleză.

## Limitări cunoscute
- Reducerea zgomotului folosește filtrul ffmpeg: bun pe zgomot constant, slab pe zgomote bruște.
  RNNoise nu are licență clară pentru uz comercial, deci nu e inclus.
- Zoom-ul, keyframes-urile, tranzițiile și grafica animată merg doar cu motorul Remotion.
- Licența Remotion e gratuită pentru persoane fizice și firme mici. Amalbo Consulting SRL trebuie să verifice pragul la remotion.dev/license.
