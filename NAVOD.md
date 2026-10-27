# Kovošrot Strečko – web a administrace ceníku

## Co je kde

- `index.html`, `style.css`, `script.js` – web
- `data/cenik.json` – ceny a propan-butan, web je načítá odsud
- `admin/` – administrace ceníku (PHP)

Provozní doba je napevno v `script.js` (proměnná `HOURS`).

## Nasazení

1. Nahrajte celou složku na hosting s PHP 8.1 nebo novějším (Wedos, Forpsi, Active24 apod.).
2. Složky `data/` a `admin/` musí mít právo zápisu pro PHP (obvykle 755, případně 775).
3. Hned po nahrání otevřete `https://vase-domena.cz/admin/` a nastavte uživatelské jméno a heslo.
   Dokud to neuděláte, může je nastavit kdokoli, kdo stránku otevře jako první.

## Používání administrace

- Adresa: `/admin/`
- Ceny lze měnit, přidávat, mazat a řadit šipkami. Desetinná čárka i tečka fungují.
- Zaškrtnutím „Úvod“ se položka ukáže na velké dlaždici na úvodní stránce (max. 4).
- Uložit lze tlačítkem dole nebo Ctrl+S / Cmd+S.
- Před každým uložením se starý ceník zazálohuje do `data/backup/` (posledních 30), obnovit jde v sekci „Zálohy“.
- Jméno a heslo jde změnit v sekci „Přihlašovací údaje“.

## Zapomenuté heslo

Smažte na hostingu soubor `admin/auth.php` a otevřete `/admin/` – administrace se zeptá na nové jméno a heslo.

## Při aktualizaci webu

Nepřepisujte na hostingu `admin/auth.php` (přihlašovací údaje) a `data/cenik.json` (aktuální ceny).
Po změně `style.css` nebo `script.js` zvyšte číslo `?v=` v `index.html`, aby se návštěvníkům načetla nová verze.
