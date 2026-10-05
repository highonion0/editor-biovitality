# BioVitality Editor

Aplicație locală care, pentru fiecare video: **taie pauzele → transcrie vorba → arde subtitrările**.
Vezi totul live, într-o interfață în browser. Rulează doar pe calculatorul tău, gratis.

## Instalare (o singură dată)
1. Dublu-click pe **`setup_windows.bat`** → la final apare pe Desktop scurtătura **BioVitality Editor**.
2. Opțional, pentru placa NVIDIA: dublu-click pe **`instaleaza_gpu.bat`** (~1,2 GB de descărcat).

3. Opțional, pentru motorul Remotion: dublu-click pe **`instaleaza_remotion.bat`** (~300 MB de descărcat).
   Fără el, aplicația folosește motorul clasic.

## Folosire
- Dublu-click pe **BioVitality Editor** de pe Desktop → se deschide interfața în browser.
- Trage video-urile în fereastră. Se procesează pe rând.
- Rezultatele sunt în folderul **`output`**, câte un folder pentru fiecare video:
  `video_taiat.mp4`, `video_final.mp4` (cu subtitrări), `subtitrari.srt`, `transcript.txt`.
- Închizi aplicația din butonul de pornire/oprire din dreapta sus.

## 📎 Materiale obligatorii (la încărcare)
Pe ecranul unde adaugi scriptul, înainte de „▶ Pornește”, tragi pozele / clipurile care trebuie să apară sigur.
- La fiecare poți scrie **unde**: „când zic de ashwagandha”, „la început”, „la final”, „0:12”.
- Alegi **cum apare**: ▣ Mic peste video, ⛶ Tot ecranul sau 🧍 Tu peste el.
- După transcriere, aplicația le pune singură pe timeline. Fără indicație, locul îl alege Claude (cu cheia API).
- Ce nu-și găsește locul apare în Timeline, la Proprietăți, ca „📎 de pus”: muți cursorul și apeși pe nume.

## 🧍 Tu peste el (video-uri explicative pe o poză)
Selectezi o poză sau un clip din Timeline și apeși **🧍 Tu peste el**. Poza / clipul umple ecranul în spate,
iar tu apari într-o fereastră: ▭ dreptunghi, ● cerc sau ▯ vertical, cu mărimea și poziția alese. Fereastra intră și iese lin.
La **🖼 Poza din spate** alegi: **Se vede toată** (implicit) sau **Umple ecranul**, mărimea și poziția pozei,
plus **culoarea fundalului** (negru implicit), care se vede unde poza nu ajunge.
Varianta cu tine **decupat** de fundal (ca efectul green screen de pe TikTok) vine cu „scoaterea fundalului” (punctul 1 din listă).

## 📚 Biblioteca ta (tabul „📚 Bibliotecă”)
- **🖼 Poze și clipuri:** alegi folderul cu materialele tale (logo, produse, ingrediente, ambalaje, B-roll).
  Fiecare subfolder devine o categorie. Click pe o poză = o pui la cursor, în modul ales.
- Dă fișierelor nume care spun ce e în ele. După nume le găsește și Claude, care le propune în „💡 Propuneri” înainte de B-roll-ul de generat.
- **♪ Sunete:** biblioteca de efecte sonore, ca înainte.

## Video-uri lungi (10 minute sau mai mult)
Merg. Un video de 10 minute, cu ~150 de bucăți după tăierea pauzelor, se lipește folosind cam 2 GB de memorie.
Durează mai mult decât un video scurt: transcrierea, randarea și propunerile lui Claude cresc odată cu durata.

## Mutarea bucăților (reordonare)
În Timeline, **trage o bucată de pe pista VIDEO** în stânga sau în dreapta. Un semn galben arată unde ajunge.
Alternativ, selectează bucata și apasă **◀ Mută mai devreme / Mută mai târziu ▶** sau **Alt+← / Alt+→**.
- Subtitrările merg singure cu bucata lor.
- Pozele, graficele, zoom-urile și sunetele aflate **în întregime** pe bucata mutată se mută odată cu ea.
  Cele care trec peste mai multe bucăți (de ex. muzica de fundal) rămân pe loc.
- Între două bucăți mutate una lângă alta apare semnul **⋮**: click pe el ca să pui o tranziție.

## 📣 Publicare (în Timeline, tabul „📣 Publicare”)
**✍ Captionul tău** (fără cheie API): scrii textul postării în tab. Se salvează singur în `caption.txt`, în folderul video-ului, și îl deschizi cu Notepad.
Îl descarci și din pagina video-ului, cu butonul **Caption .txt**. Dacă ceri apoi pachetul de la Claude, el pornește de la captionul tău.

Pentru restul tabului ai nevoie de cheia API Claude (tabul Asistent).

**Pachetul de publicare**
- Bifezi platformele (TikTok, Instagram, YouTube Shorts, Facebook). Opțional, scrii indicații pentru Claude.
- Apeși **✦ Scrie pachetul**. Claude scrie, pentru fiecare platformă, descrierea, hashtag-urile, textul de pe copertă și primul comentariu, doar din ce spui în video.
- Poți modifica orice text. Butonul 📋 îl copiază. Totul se salvează și în `publicare.txt`, în folderul video-ului.
- **Coperta:** muți cursorul pe cadrul dorit și apeși **🖼 Fă coperta**. Se salvează ca `coperta.jpg`, cu textul în culorile brandului.

**Variante de cârlig (A/B)**
- Același video, cu alt început: o frază puternică din video pusă la început și/sau alt titlu mare în primele secunde.
- **✦ Propune 3 cârlige**: Claude alege frazele și titlurile. Sau adaugi tu variante: **+ Variantă cu fraza de la cursor** ori **+ Doar alt titlu**.
- **▶ Ascultă** redă fraza aleasă. Titlul și cuvântul colorat se pot modifica.
- **🎬 Randează variantele** creează `varianta_A.mp4`, `varianta_B.mp4`… lângă video-ul final. Video-ul final rămâne neschimbat.
- Titlul mare apare animat doar cu motorul Remotion. Cu motorul clasic apare ca un card fix.

## Mișcare: zoom, keyframes, tranziții (doar cu motorul Remotion)
- **🔍 Zoom** (sau tasta **Z**): bloc de zoom pe pista lui, la cursor. Stil **Punch / Lin / Apropiere**, cât de mult (1,05–1,6×),
  iar cu zoom-ul selectat **click pe video** alege punctul pe care se centrează. Claude îl poate propune și pune.
- **◆ Keyframes** pe poze, clipuri și grafice: pui un keyframe la cursor, muți cursorul, muți/redimensionezi elementul —
  între ele trece lin. Plus animații de **Intrare / Ieșire** (apariție, glisare, pop).
- **⇄ Tranziții**: click pe ✂ între două bucăți → Dizolvare / Prin negru / Flash / Zoom / Blur, cu durata lor.
  Nu schimbă durata video-ului, deci subtitrările rămân pe aceleași cuvinte.

## Subtitrări animate, cuvânt cu cuvânt
În stilul subtitrărilor (editorul de subtitrări → Stil, sau Timeline → Aa Subtitrări → Stil): **Animație**
Fără / **Evidențiere** (cuvântul rostit colorat — sobru) / **Pop** / **Apariție** (cuvintele apar pe rând) /
**Fundal** (pastilă pe cuvântul rostit) / **Un cuvânt**, plus culoarea animației. Merge pe ambele motoare de randare.
Timpii cuvintelor vin din transcriere; la proiectele vechi și la cuvintele rescrise sunt estimați automat.

## Zone sigure și salvare automată
- Sub video în Timeline: **Zone sigure** Oprit / TikTok / Reels / Shorts / Toate → vezi ce acoperă interfața aplicației.
  În Proprietăți (nimic selectat) apare lista elementelor care intră sub interfață, cu **Mută în zona sigură**.
  Valorile sunt conservatoare; platformele își mai schimbă interfața, deci verifică și la publicare.
- **Salvare automată**: fiecare modificare din Timeline se păstrează ca ciornă după ~1 s. Dacă închizi aplicația sau pică,
  la redeschidere apare **🛟 Recuperează-le**. La „Salvează și randează” ciorna se șterge singură.

## 🎨 Look: culoare și sunet (tab în Timeline)
- **Culoare** (doar pe video-ul tău): filtre Original / Natural / Cald / Luminos / Cinematic / Alb-negru, apoi
  luminozitate, contrast, saturație, temperatură, nuanță. Se vede instant; „Ține apăsat: înainte” compară cu originalul.
- **Sunet**: reducere zgomot (Ușor / Mediu / Puternic), **Voce clară**, **Volum uniform −14 LUFS** (standardul TikTok/IG).
  **🎧 Aplică și ascultă** îl pune în previzualizare.
- **★ Păstrează look-ul pentru video-urile noi** → toate video-urile următoare pornesc cu aceeași culoare și același sunet.
Totul intră în Ctrl+Z și se salvează cu „Salvează și randează”.

## Sunete (tabul „♪ Sunete” din Timeline)
Alegi o dată folderul (sau folderele) cu efecte sonore; fiecare subfolder devine o categorie. Cauți după nume
(„woosh” găsește și „whoosh”/„swoosh”), ▶ asculți, **+** sau dublu-click pune sunetul la cursor pe o pistă audio
(volum 80%). Folderele alese se țin minte în `biblioteci.json`.

## Subtitrările în Timeline (tabul „Aa Subtitrări”)
Click pe o frază din pista **Text** (sau tabul Aa Subtitrări): selectezi cuvinte (Shift = mai multe), **B / I / U**, culori,
**✎ Rescrie** fraza, **👁 Ascunde** o frază (rămâne în listă, nu apare pe video sau în .srt), **🗑** șterge fraza,
**Delete** șterge cuvintele selectate; în „Stil pentru toate”: font, mărime, culoare, contur/fundal, poziție, majuscule. Pe previzualizare
tragi subtitrarea ca s-o muți (toate odată). Totul intră în Ctrl+Z și se salvează cu **Salvează și randează**.

## B-roll cu DaVinci
1. Un **loc de B-roll** apare din 💡 Propuneri, din ✦ Asistent („pune un B-roll cu digestia la secunda 10”) sau din
   butonul **⬚ Loc B-roll** din Timeline.
2. În panoul locului: **📋 Copiază prompt-ul** (scris de Claude în engleză, în stilul vizual BioVitality) sau
   **✦ Scrie / Rescrie cu Claude**. Îl poți edita.
3. În DaVinci: format **vertical 9:16**, durată cel puțin cât locul. Generezi, descarci.
4. **Tragi clipul pe loc** (în Timeline sau pe video) sau **🎬 Alege clipul descărcat** → se pune pe tot ecranul,
   fără sunet, pe durata locului. Locurile goale sunt sărite la randare (primești avertisment).
Pentru orice video sau poză: **⛶ Tot ecranul** și colțurile **↖ ↗ ↙ ↘** (picture-in-picture).
Verifică exactitatea științifică a clipurilor generate și marchează conținutul AI unde platforma o cere.

## 💡 Propuneri („cum aș edita eu”)
În Timeline, tabul **💡 Propuneri** → **Analizează și propune**. Claude citește transcrierea și îți propune: grafică pe cifre
și idei, cuvinte evidențiate în subtitrări, efecte sonore din biblioteca ta, tăieturi pentru bâlbe, plus idei de B-roll
și zoom (de făcut manual). Click pe o propunere = arată momentul pe video. Bifezi ce-ți place → **Aplică selectate**.
Tăieturile vin nebifate. Un singur **Ctrl+Z** anulează tot ce ai aplicat. O analiză = o cerere (câțiva cenți).

## Grafică animată și asistentul Claude (etapa 3)
- **✦ Grafică** (în Timeline): Titlu mare, Cifră mare (numărătoare animată), Punct numerotat, Pași / proces,
  Nume și rol, Final / îndemn — în culorile BioVitality. Textele, culorile, mărimea și poziția le schimbi din panou;
  pe previzualizare o muți, o mărești din colțuri, o rotești din bulina de sus.
- **✦ Asistent** (tab în panoul din dreapta): îi scrii ce vrei („pune cifrele importante ca grafică”, „adaugă un final
  cu Urmărește-ne”, „mută subtitrările mai jos”). Vede transcrierea cu timpii și tot ce e pe timeline, apoi face
  modificările. **Ctrl+Z** anulează tot ce a făcut la o cerere.
- Ai nevoie de o **cheie API Anthropic** (console.anthropic.com → API Keys), plătită separat de abonamentul Claude,
  după consum. Cheia se salvează doar local, în `asistent.json`. Modelul îl alegi din tab (implicit Claude Sonnet 5).
- Grafica animată apare în video-ul final **doar cu motorul Remotion** (`instaleaza_remotion.bat`).

## Scriptul (pasul „Pregătit”)
După drag & drop, video-ul **așteaptă**: vezi video-ul, lipești scriptul (opțional) și apeși **„Pornește”**
(sau „Pornește toate pregătitele” când ai mai multe). Cu script, programul:
- **scoate reluările** — dacă ai spus o frază de mai multe ori, păstrează ultima variantă;
- **scoate ce nu e în script** — bâlbe, fraze abandonate, „stai, o iau de la capăt”;
- pune în **subtitrări textul exact din script** (diacritice, punctuație).
Fiecare opțiune se poate opri. Dacă scriptul se potrivește cu mai puțin de jumătate din video, nu taie nimic
în afara lui (doar reluări și pauze). Orice tăietură se poate readuce din Timeline (✂).
Pentru zile cu multe video-uri: Setări → „Pornește automat după încărcare”.

## Editarea subtitrărilor
După ce un video e gata, apasă **„Editează subtitrările”**:
- **Text și cuvinte**: click pe cuvinte ca să le selectezi (Shift = mai multe), apoi **B / I / U** sau o culoare.
  Dublu-click pe o frază (sau „Rescrie”) ca să schimbi textul. Ctrl+B / Ctrl+I / Ctrl+U merg și ele.
- **Stil**: font, mărime, culoare, majuscule, contur sau fundal, poziție. Poziția o poți schimba și trăgând textul pe video.
- **Salvează și arde pe video** → iese `video_final_2.mp4`, `_3` etc. (se păstrează doar cea mai nouă).
- **Păstrează stilul pentru video-urile noi** → următoarele video-uri pornesc direct cu stilul tău.

Fonturile incluse (Montserrat, Poppins, Bebas Neue, Anton, DM Serif Display) sunt gratuite, licență OFL (în `fonts/licente`).

## Timeline (etapa 2)
După ce un video e gata, apasă **„Timeline”**:
- **Pista Video**: bucățile păstrate, cu miniaturi și forma sunetului. Trage de margini ca să lungești sau să scurtezi
  (poți intra și în porțiunea tăiată). **S** = taie la cursor, **Delete** = șterge bucata selectată.
- **✂** între bucăți = o pauză tăiată. Click pe ea → „Readuce toată pauza” sau „Readuce doar 0,2 s”.
- **Poză / video**: butonul sau tras direct în fereastră. Le muți în timp trăgând de ele, le scurtezi de la capete,
  le urci pe altă pistă (ce e mai sus stă deasupra). Pe previzualizare le muți cu mouse-ul; lățimea, opacitatea
  și sunetul din panoul din dreapta.
- Pe previzualizare, poza/video-ul selectat are **mânere**: colțurile = mărime, bulina de sus = rotire
  (se lipește de 0°/90°; cu Shift merge din 15 în 15°). **Colțuri rotunjite** și **rotire** și din panou.
- **Muzică / sunete** (MP3, WAV, M4A…): apar pe pistele ♪ de sub video. Volum, intrare/ieșire lină,
  de unde pornește din melodie, „Pe tot video-ul”. Poți pune mai multe melodii una după alta sau suprapuse.
- **Ctrl+C / Ctrl+V** = copiază poza, video-ul sau melodia selectată și o lipește la cursor. **Ctrl+D** = duplică.
- **Space** = play/pauză, **← →** = un cadru, **Ctrl+Z / Ctrl+Y** = anulează / refă.
- **Salvează și randează** → reface copia tăiată și video-ul final. Materialele stau în `output/<video>/assets`.

## Cum lucrează acum (etapa 1)
Fiecare video are un fișier **`project.json`** în folderul lui: bucățile păstrate (în timpul video-ului original),
subtitrările și locul pentru poze / video-uri suprapuse. Video-ul final se randează din acest proiect —
cu **Remotion** dacă e instalat (subtitrările ies identic cu editorul), altfel cu motorul clasic.
`video_taiat.mp4` e doar copia pentru previzualizare.

Licență Remotion: gratuită pentru persoane fizice și firme mici; firmele peste pragul lor au nevoie de licență
(detalii pe remotion.dev/license).

## Dacă ceva nu merge
Deschide „Jurnal tehnic” în aplicație sau fișierul `jurnal.log` din folder și trimite-l lui Claude.

## Actualizare din GitHub
Codul stă în repo-ul `highonion0/editor-biovitality`. Cheia API (`asistent.json`), setările tale
și video-urile din `input`/`output` **nu** se urcă pe GitHub (vezi `.gitignore`).

- **Prima dată:** instalează [Git for Windows](https://git-scm.com/download/win), apoi într-un folder:
  `git clone https://github.com/highonion0/editor-biovitality.git`
- **De fiecare dată când există o versiune nouă:** închide aplicația, apoi în folderul aplicației:
  `git pull` → pornește aplicația din nou.
  Dacă s-a schimbat `requirements.txt` rulează din nou `setup_windows.bat`; dacă s-a schimbat
  `remotion/package.json` rulează din nou `instaleaza_remotion.bat`.
