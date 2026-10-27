<?php
// Administrace ceníku Kovošrot Strečko.
// Ukládá ceny do ../data/cenik.json, ze kterého je načítá web.
// Při prvním otevření si administrace nechá nastavit uživatelské jméno a heslo (heslo se uloží jako hash do auth.php).

declare(strict_types=1);
date_default_timezone_set('Europe/Prague');

const DATA_FILE     = __DIR__ . '/../data/cenik.json';
const BACKUP_DIR    = __DIR__ . '/../data/backup';
const AUTH_FILE     = __DIR__ . '/auth.php';
const ATTEMPTS_FILE = __DIR__ . '/var/attempts.json';
const MAX_BACKUPS   = 30;
const MAX_FAILS     = 5;
const LOCK_SECONDS  = 600;

$https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
session_name('kovosrot_admin');
session_set_cookie_params([
    'lifetime' => 0,
    'path'     => rtrim(dirname($_SERVER['SCRIPT_NAME']), '/') . '/',
    'httponly' => true,
    'samesite' => 'Strict',
    'secure'   => $https,
]);
session_start();

header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('Cache-Control: no-store');


// ---------- pomocné funkce ----------

function h(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }

function auth(): ?array {
    $a = is_file(AUTH_FILE) ? (include AUTH_FILE) : null;
    return is_array($a) && isset($a['user'], $a['hash']) ? $a : null;
}

function clean_user(string $u): string { return mb_strtolower(trim($u)); }

function csrf(): string {
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
    return $_SESSION['csrf'];
}

function csrf_ok(mixed $token): bool {
    return is_string($token) && !empty($_SESSION['csrf']) && hash_equals($_SESSION['csrf'], $token);
}

function logged_in(): bool { return !empty($_SESSION['admin']); }

function flash(string $type, string $msg): void { $_SESSION['flash'] = [$type, $msg]; }

function back(): never {
    header('Location: ' . strtok($_SERVER['REQUEST_URI'], '?'), true, 303);
    exit;
}

function json_out(int $code, array $body): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

function write_atomic(string $file, string $content): bool {
    $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (file_put_contents($tmp, $content, LOCK_EX) === false) return false;
    if (!rename($tmp, $file)) { @unlink($tmp); return false; }
    return true;
}

function load_data(): array {
    $d = json_decode((string) @file_get_contents(DATA_FILE), true);
    return is_array($d) ? $d : ['updated' => date('Y-m-d'), 'categories' => [], 'prices' => [], 'gas' => []];
}

function clean_number(float $n): int|float {
    $n = round($n, 2);
    return floor($n) == $n ? (int) $n : $n;
}

function is_num(mixed $v): bool { return is_int($v) || is_float($v); }

// Zkontroluje data z formuláře. Kategorie se v administraci nemění, berou se z uloženého souboru.
function validate(mixed $in, array $categories): array {
    if (!is_array($in)) return [null, 'Neplatná data.'];

    $updated = (string) ($in['updated'] ?? '');
    $dt = DateTime::createFromFormat('!Y-m-d', $updated);
    if (!$dt || $dt->format('Y-m-d') !== $updated) return [null, 'Zadejte platné datum „Platí od“.'];

    $catIds = array_column($categories, 'id');
    $prices = [];
    $featured = 0;
    foreach ((array) ($in['prices'] ?? []) as $p) {
        if (!is_array($p)) return [null, 'Neplatná položka ceníku.'];
        $name = trim((string) preg_replace('/\s+/u', ' ', (string) ($p['name'] ?? '')));
        if ($name === '') return [null, 'Některá položka nemá vyplněný název.'];
        if (mb_strlen($name) > 100) return [null, "Název „" . mb_substr($name, 0, 30) . "…“ je moc dlouhý (max. 100 znaků)."];
        if (!in_array($p['cat'] ?? null, $catIds, true)) return [null, 'Neznámá kategorie u položky „' . $name . '“.'];
        $price = $p['price'] ?? null;
        if (!is_num($price) || $price < 0 || $price > 100000) return [null, 'Položka „' . $name . '“ nemá platnou cenu.'];

        $row = ['cat' => $p['cat'], 'name' => $name, 'price' => clean_number((float) $price)];
        if (!empty($p['featured'])) { $row['featured'] = true; $featured++; }
        $prices[] = $row;
    }
    if (!$prices) return [null, 'Ceník musí obsahovat aspoň jednu položku.'];
    if (count($prices) > 300) return [null, 'Ceník může mít nejvýše 300 položek.'];
    if ($featured > 4) return [null, 'Do úvodu webu lze vybrat nejvýše 4 položky.'];

    $gas = [];
    foreach ((array) ($in['gas'] ?? []) as $g) {
        $kg = $g['kg'] ?? null;
        $price = $g['price'] ?? null;
        if (!is_num($kg) || $kg <= 0 || $kg > 100) return [null, 'Propan-butan: zadejte platnou velikost lahve v kg.'];
        if (!is_num($price) || $price < 0 || $price > 100000) return [null, 'Propan-butan: zadejte platnou cenu lahve.'];
        $gas[] = ['kg' => clean_number((float) $kg), 'price' => clean_number((float) $price)];
    }
    if (count($gas) > 10) return [null, 'Propan-butan: nejvýše 10 velikostí lahví.'];

    return [['updated' => $updated, 'categories' => $categories, 'prices' => $prices, 'gas' => $gas], null];
}

function list_backups(): array {
    $files = glob(BACKUP_DIR . '/cenik-*.json') ?: [];
    rsort($files);
    return array_map(function ($f) {
        $b = basename($f);
        $label = preg_match('/^cenik-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/', $b, $m)
            ? (int) $m[3] . '. ' . (int) $m[2] . '. ' . $m[1] . ' ' . $m[4] . ':' . $m[5]
            : $b;
        return ['file' => $b, 'label' => $label];
    }, array_slice($files, 0, 10));
}

function save_data(array $data): bool {
    if (!is_dir(BACKUP_DIR)) @mkdir(BACKUP_DIR, 0755, true);
    // dvě uložení ve stejné sekundě nesmí přepsat starší zálohu
    $backup = BACKUP_DIR . '/cenik-' . date('Ymd-His') . '.json';
    if (is_file(DATA_FILE) && !is_file($backup)) @copy(DATA_FILE, $backup);

    $old = glob(BACKUP_DIR . '/cenik-*.json') ?: [];
    rsort($old);
    foreach (array_slice($old, MAX_BACKUPS) as $f) @unlink($f);

    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    return $json !== false && write_atomic(DATA_FILE, $json . "\n");
}

// ochrana proti zkoušení hesel: po 5 chybách z jedné adresy je přihlášení na 10 minut zablokované
function attempts(): array {
    $a = json_decode((string) @file_get_contents(ATTEMPTS_FILE), true);
    if (!is_array($a)) return [];
    return array_filter($a, fn($r) => time() - ($r['t'] ?? 0) < LOCK_SECONDS);
}
function attempt_key(): string { return hash('sha256', 'kovosrot|' . ($_SERVER['REMOTE_ADDR'] ?? '')); }
function locked(): bool { $r = attempts()[attempt_key()] ?? null; return $r && $r['n'] >= MAX_FAILS; }
function note_fail(): void {
    $a = attempts();
    $k = attempt_key();
    $a[$k] = ['n' => ($a[$k]['n'] ?? 0) + 1, 't' => time()];
    if (!is_dir(dirname(ATTEMPTS_FILE))) @mkdir(dirname(ATTEMPTS_FILE), 0755, true);
    write_atomic(ATTEMPTS_FILE, json_encode($a));
}
function clear_fails(): void {
    $a = attempts();
    unset($a[attempt_key()]);
    if (is_dir(dirname(ATTEMPTS_FILE))) write_atomic(ATTEMPTS_FILE, json_encode($a));
}

function store_login(string $user, string $password): bool {
    $php = "<?php\n// Vygenerováno administrací. Obsahuje uživatelské jméno a hash hesla.\nreturn " .
        var_export(['user' => $user, 'hash' => password_hash($password, PASSWORD_DEFAULT)], true) . ";\n";
    return write_atomic(AUTH_FILE, $php);
}

function login(): void {
    session_regenerate_id(true);
    $_SESSION['admin'] = true;
    unset($_SESSION['csrf']);
}


// ---------- požadavky z editoru (JSON) ----------

if ($_SERVER['REQUEST_METHOD'] === 'POST' && str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) {
    if (!logged_in()) json_out(401, ['error' => 'Přihlášení vypršelo. Obnovte stránku a přihlaste se znovu.']);
    if (!csrf_ok($_SERVER['HTTP_X_CSRF'] ?? null)) json_out(403, ['error' => 'Neplatný požadavek. Obnovte stránku.']);

    $req = json_decode((string) file_get_contents('php://input'), true);
    $current = load_data();

    if (($req['action'] ?? '') === 'save') {
        [$data, $err] = validate($req['data'] ?? null, $current['categories'] ?? []);
        if ($err) json_out(422, ['error' => $err]);
        if (!save_data($data)) json_out(500, ['error' => 'Soubor s ceníkem se nepodařilo uložit. Zkontrolujte práva zápisu do složky data.']);
        json_out(200, ['ok' => true, 'data' => $data, 'backups' => list_backups()]);
    }

    if (($req['action'] ?? '') === 'restore') {
        $file = (string) ($req['file'] ?? '');
        if (!preg_match('/^cenik-\d{8}-\d{6}\.json$/', $file) || !is_file(BACKUP_DIR . '/' . $file)) {
            json_out(404, ['error' => 'Záloha nebyla nalezena.']);
        }
        $backup = json_decode((string) file_get_contents(BACKUP_DIR . '/' . $file), true);
        [$data, $err] = validate($backup, $current['categories'] ?? []);
        if ($err) json_out(422, ['error' => 'Záloha je poškozená: ' . $err]);
        if (!save_data($data)) json_out(500, ['error' => 'Zálohu se nepodařilo obnovit.']);
        json_out(200, ['ok' => true, 'data' => $data, 'backups' => list_backups()]);
    }

    json_out(400, ['error' => 'Neznámá akce.']);
}


// ---------- formuláře (přihlášení, heslo) ----------

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrf_ok($_POST['csrf'] ?? null)) { flash('err', 'Formulář vypršel, zkuste to prosím znovu.'); back(); }
    $action = $_POST['action'] ?? '';
    $password = (string) ($_POST['password'] ?? '');
    $user = clean_user((string) ($_POST['user'] ?? ''));
    $userOk = (bool) preg_match('/^[\p{L}0-9._-]{3,40}$/u', $user);

    if ($action === 'setup' && auth() === null) {
        if (!$userOk) { flash('err', 'Uživatelské jméno musí mít 3 až 40 znaků (písmena, číslice, tečka, pomlčka).'); back(); }
        if (mb_strlen($password) < 8) { flash('err', 'Heslo musí mít aspoň 8 znaků.'); back(); }
        if ($password !== ($_POST['password2'] ?? '')) { flash('err', 'Hesla se neshodují.'); back(); }
        if (!store_login($user, $password)) { flash('err', 'Přihlašovací údaje se nepodařilo uložit. Zkontrolujte práva zápisu do složky admin.'); back(); }
        login();
        flash('ok', 'Přihlašovací údaje jsou nastavené. Vítejte v administraci.');
        back();
    }

    if ($action === 'login' && ($auth = auth())) {
        if (locked()) { flash('err', 'Příliš mnoho pokusů. Zkuste to znovu za 10 minut.'); back(); }
        // heslo se ověřuje vždy, aby podle doby odpovědi nešlo poznat, jestli sedí jméno
        $passOk = password_verify($password, $auth['hash']);
        if (!hash_equals($auth['user'], $user) || !$passOk) {
            note_fail();
            usleep(400000);
            flash('err', 'Nesprávné uživatelské jméno nebo heslo.');
            back();
        }
        clear_fails();
        login();
        back();
    }

    if ($action === 'logout') {
        $_SESSION = [];
        session_destroy();
        back();
    }

    if ($action === 'password' && logged_in() && ($auth = auth())) {
        if (!password_verify((string) ($_POST['current'] ?? ''), $auth['hash'])) { flash('err', 'Současné heslo není správně.'); back(); }
        if (!$userOk) { flash('err', 'Uživatelské jméno musí mít 3 až 40 znaků (písmena, číslice, tečka, pomlčka).'); back(); }
        if (mb_strlen($password) < 8) { flash('err', 'Nové heslo musí mít aspoň 8 znaků.'); back(); }
        if ($password !== ($_POST['password2'] ?? '')) { flash('err', 'Nová hesla se neshodují.'); back(); }
        if (!store_login($user, $password)) { flash('err', 'Přihlašovací údaje se nepodařilo uložit.'); back(); }
        flash('ok', 'Přihlašovací údaje byly změněny.');
        back();
    }

    back();
}


// ---------- stránka ----------

$auth = auth();
$view = $auth === null ? 'setup' : (logged_in() ? 'editor' : 'login');
$flash = $_SESSION['flash'] ?? null;
unset($_SESSION['flash']);
$token = csrf();
?>
<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="csrf" content="<?= h($token) ?>">
  <title>Administrace ceníku | Kovošrot Strečko</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800;900&family=Saira+Stencil+One&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="admin.css?v=2">
</head>
<body class="view-<?= $view ?>">

<header class="top">
  <div class="top__inner">
    <a href="../" class="logo"><span class="logo__top">Kovošrot</span><span class="logo__name">Strečko</span></a>
    <span class="top__title">Administrace ceníku</span>
    <?php if ($view === 'editor'): ?>
      <a href="../#cenik" target="_blank" rel="noopener" class="top__link">Zobrazit web ↗</a>
      <form method="post" class="top__logout">
        <input type="hidden" name="csrf" value="<?= h($token) ?>">
        <button name="action" value="logout">Odhlásit</button>
      </form>
    <?php endif; ?>
  </div>
</header>

<?php if ($flash): ?>
  <p class="flash flash--<?= h($flash[0]) ?>"><?= h($flash[1]) ?></p>
<?php endif; ?>

<?php if ($view === 'setup'): ?>
  <main class="box">
    <h1>První spuštění</h1>
    <p>Administrace zatím nemá přihlašovací údaje. Zvolte si uživatelské jméno a heslo, budete je potřebovat při každém přihlášení.</p>
    <form method="post">
      <input type="hidden" name="csrf" value="<?= h($token) ?>">
      <input type="hidden" name="action" value="setup">
      <label>Uživatelské jméno<input type="text" name="user" minlength="3" maxlength="40" required autocomplete="username" autocapitalize="none" autofocus></label>
      <label>Heslo (aspoň 8 znaků)<input type="password" name="password" minlength="8" required autocomplete="new-password"></label>
      <label>Heslo znovu<input type="password" name="password2" minlength="8" required autocomplete="new-password"></label>
      <button class="btn">Uložit a přihlásit</button>
    </form>
  </main>

<?php elseif ($view === 'login'): ?>
  <main class="box">
    <h1>Přihlášení</h1>
    <form method="post">
      <input type="hidden" name="csrf" value="<?= h($token) ?>">
      <input type="hidden" name="action" value="login">
      <label>Uživatelské jméno<input type="text" name="user" required autocomplete="username" autocapitalize="none" autofocus></label>
      <label>Heslo<input type="password" name="password" required autocomplete="current-password"></label>
      <button class="btn">Přihlásit</button>
    </form>
  </main>

<?php else: ?>
  <main class="editor">
    <section class="card card--date">
      <div>
        <h2>Platnost ceníku</h2>
        <p class="hint">Datum se na webu zobrazí jako „Platí od“.</p>
      </div>
      <div class="date">
        <input type="date" id="updated">
        <button type="button" class="btn btn--line" id="today">Dnes</button>
      </div>
    </section>

    <section id="categories"></section>

    <section class="card">
      <h2>Propan-butan</h2>
      <p class="hint">Velikost lahve v kg a cena za lahev.</p>
      <div id="gas"></div>
      <button type="button" class="add" id="addGas">+ Přidat lahev</button>
    </section>

    <details class="card">
      <summary><h2>Zálohy</h2></summary>
      <p class="hint">Před každým uložením se starý ceník automaticky zazálohuje. Uchovává se posledních 30 záloh.</p>
      <ul class="backups" id="backups"></ul>
    </details>

    <details class="card">
      <summary><h2>Přihlašovací údaje</h2></summary>
      <form method="post" class="pwd">
        <input type="hidden" name="csrf" value="<?= h($token) ?>">
        <input type="hidden" name="action" value="password">
        <label>Současné heslo<input type="password" name="current" required autocomplete="current-password"></label>
        <label>Uživatelské jméno<input type="text" name="user" value="<?= h($auth['user'] ?? '') ?>" minlength="3" maxlength="40" required autocomplete="username" autocapitalize="none"></label>
        <label>Nové heslo (aspoň 8 znaků)<input type="password" name="password" minlength="8" required autocomplete="new-password"></label>
        <label>Nové heslo znovu<input type="password" name="password2" minlength="8" required autocomplete="new-password"></label>
        <button class="btn btn--line">Uložit přihlašovací údaje</button>
      </form>
    </details>
  </main>

  <div class="savebar">
    <div class="savebar__inner">
      <span class="savebar__msg" id="msg" role="status">Vše uloženo</span>
      <button type="button" class="btn" id="save">Uložit ceník</button>
    </div>
  </div>

  <script type="application/json" id="initial"><?= json_encode(
      ['data' => load_data(), 'backups' => list_backups()],
      JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
  ) ?></script>
  <script src="admin.js?v=1"></script>
<?php endif; ?>

</body>
</html>
