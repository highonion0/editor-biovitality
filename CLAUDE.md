# BioVitality Editor — note pentru Claude

- Aplicație locală pentru Windows: server Python (`app.py`, `core.py`, `assistant.py`, `script_align.py`)
  + interfață în browser (`ui.html`, `static/*.js`). Motorul opțional de randare e în `remotion/`.
- Utilizatoarea nu e programatoare. Interfața, mesajele și documentația sunt în **română**.
  Pașii de instalare se fac prin fișiere `.bat`, cu dublu-click.
- Se lucrează direct pe `main`. Utilizatoarea primește actualizările cu `git pull`.
- Nu se urcă niciodată în repo: `asistent.json` (cheia API Claude), setările locale `*.json` și conținutul din `input/` / `output/`.
- `static/graphics.js` e un bundle compilat din `remotion/src/` (preview). Comanda de build nu e în repo.
- Ce a rămas de făcut: `docs/ROADMAP.md`.
