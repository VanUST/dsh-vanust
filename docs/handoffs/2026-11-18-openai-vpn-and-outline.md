# 2026-11-18 — OpenAI/Codex, VPN для него, outline как форсируемое чтение

Продолжение `2026-11-18-impeccable-and-audit.md`. Всё ниже проверено в этой сессии; коммиты на `origin/main`.

## Сделано и запушено

| Коммит | Что |
|---|---|
| `56cf304` | новый плагин `@cc/dsh-openai-codex` 0.1.1 (провайдер OpenAI/Codex против `ctx.llm`) + `outline` разрешён всем восьми ролям |
| `68fed05` | записи анализа: `agent-surface-and-shell` (BR1 отложен), `kit-tool-surface` (FR7) |
| `b997bf1` | панель `0.1.16`: `State` в верхней панели сессии, адаптация к светлой/тёмной теме |
| `1ed26aa` | `scripts/outline-bench.mjs` и `scripts/outline-audit.mjs`, правило промпта с порогом, orchestrator 0.1.57 |

Доказательства:
- адаптер: `node --test plugins/openai-codex/test/*.test.mjs` → 4/4 на поддельном OpenAI-эндпойнте (текст, tool-call, usage 12/7/2, модели `gpt-5`, `gpt-5-codex`, `o4-mini`); `make verify` 17/17.
- outline: `outline` 30 013 Б против 460 341 Б (−93%), +медианное тело 34 606 Б (−92%), +крупнейшее 233 654 Б (−49%); негативный контроль «найди функцию» 7 826 Б против 124 455 Б (15.9×); аудит — базовая линия 675 сессий, 0 вызовов, 130 191 479 Б read.
- панель: `State` открывается из `conversation.session.header.actions` (x=660), в левой колонке нет; axe 0 в обеих темах, hit-targets ≥24 px, 760 px без переполнения; sha256 483 файлов `state/` до/после совпали.

Записи анализа: `docs/analysis/agent-surface-and-shell.json` (7 proven, 1 deferred), `docs/analysis/kit-tool-surface.json` (7/7 proven).

## Что осталось

1. **Живая сессия на модели OpenAI** (BR1 в `agent-surface-and-shell`, отложен). Блокер — сеть: `api.openai.com` с машины недоступен (прямой запрос `000`).
2. **B3 `task-mwm0hkio-hge31m`** (открыт, не делегирован): прокси в адаптере — HTTP через `createRouteDispatcher` из `@deepseek-ai/dsh-http-proxy`, SOCKS5 отдельным коннектором; чтобы через VPN шёл только OpenAI.
3. **Обновление установленного профиля** (за владельцем): в живом профиле `orchestrator 0.1.45`, панель `0.1.14`, нет `@cc/dsh-outline` и `@cc/dsh-openai-codex`. После обновления — повторить `node scripts/outline-audit.mjs` и сравнить с базовой линией.

## Следующий шаг: поднять OpenVPN

Готово: `~/Downloads/rsv.FIN.ovpn`, файл авторизации `~/.redshield.auth` (600, логин + пароль). `openvpn 2.5.11` установлен. `sudo` спрашивает пароль — **root у агента нет**, туннель поднимает владелец.

Ловушка: в `rsv.FIN.ovpn` **нет `redirect-gateway`** — это split tunnel, и `api.openai.com` через него не пойдёт. Нужна копия с `redirect-gateway def1`:

```bash
cp ~/Downloads/rsv.FIN.ovpn ~/.redshield-full.ovpn
echo 'redirect-gateway def1 bypass-dhcp' >> ~/.redshield-full.ovpn
sudo openvpn --config ~/.redshield-full.ovpn --auth-user-pass ~/.redshield.auth \
  --daemon --writepid /tmp/redshield.pid --log /tmp/redshield.log
ip -brief addr show tun0
curl -sS -m 10 -o /dev/null -w '%{http_code}\n' https://api.openai.com/v1/models   # 401 = канал есть
```

После этого: снять живую проверку адаптера на `gpt-5` (ключ OpenAI владелец даст заново; в репозиторий его не писать), закрыть BR1, затем опустить туннель `sudo kill "$(cat /tmp/redshield.pid)"`.

## Ловушки, которые иначе повторятся

- **Rootless-туннель невозможен:** в новом network namespace нет сети, а veth без root не создать. Не тратить время на `unshare -Urn`.
- **Browsec — расширение браузера:** Brave не слушает ни одного порта, `--proxy-server` не задан, в профиле расширения нет. Другой процесс его VPN использовать не может; запросы через CDP упираются в CORS `api.openai.com`.
- **Прокси в DSH — политика процесса:** `@deepseek-ai/dsh-http-proxy` ставит диспетчер на глобальный `fetch` из окружения или `$DSH_HOME/.env` (файла сейчас нет). SOCKS/PAC он не поддерживает. Адаптер OpenAI использует обычный `fetch`, поэтому при глобальном `HTTPS_PROXY` проксируется автоматически; для «только OpenAI» нужен B3.
- **Ключи в чате:** ключ OpenAI и пароль RedShield были присланы сообщением — считать раскрытыми, рекомендовать перевыпуск. В git их нет (`grep` чист).
- **Push флейки:** ретраить с `http.version=HTTP/1.1`/`1.0`, статус не читать через пайп, сверять `ls-remote`.
- **Серверы от прошлых задач:** `:3092`, `:3093`, `:3094` (второй профиль для доказательств), живой `:3080` (pid 3160705) не трогать.
- **Один BACKEND — одна сессия:** второй бриф, отправленный до завершения первого, попадает в работающий child.
